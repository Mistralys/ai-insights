# Orchestrator - Stage Nodes
_SOURCE: Pipeline stage node factories (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis)_
# Pipeline stage node factories (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis)
```
// Structure of documents
└── orchestrator/
    └── src/
        └── nodes/
            └── __init__.py
            └── developer.py
            └── docs.py
            └── pm.py
            └── prompt_renderer.py
            └── qa.py
            └── release_engineer.py
            └── reviewer.py
            └── security_auditor.py
            └── synthesis.py

```
###  Path: `/orchestrator/src/nodes/__init__.py`

```py
"""
nodes — One module per pipeline stage.

Each node module exposes a ``make_<stage>_node(config, mcp_tools)`` factory
that returns a LangGraph node function.  The generic scaffolding lives here in
:func:`create_stage_node`; individual modules provide stage-specific prompt
builders using the template-based prompt renderer.

Public factories
----------------
- :func:`create_stage_node` — Generic factory used internally by each module.

Template-based prompts
----------------------
Stage prompts are assembled by each module using ``render_prompt`` and
``load_template`` from :mod:`src.nodes.prompt_renderer`.
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from random import random as _random
from typing import TYPE_CHECKING, Any, Optional

from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig

from src.utils.chunk_writer import ChunkWriter
from src.utils.logging import get_run_logger
from src.utils.mcp_parse import parse_tool_response
from src.utils.tool_wrappers import (
    _make_tool_response,
    inject_project_path,
    log_tool_calls,
    restrict_to_wp,
)

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fatal error detection
# ---------------------------------------------------------------------------
# HTTP status codes that indicate an unrecoverable authentication/authorisation
# failure.  When an LLM provider raises one of these, the orchestrator should
# terminate immediately instead of burning through all remaining iterations.
_FATAL_HTTP_STATUSES: frozenset[int] = frozenset({401, 403})


def _is_fatal_error(exc: BaseException, visited: set[int] | None = None) -> bool:
    """Return True when *exc* is an unrecoverable error that should stop the run.

    Detects authentication / permission errors from any LLM provider library
    (Anthropic, OpenAI, Google, generic HTTP clients) by inspecting the
    ``status_code`` attribute that all major SDKs attach to their error classes.
    """
    if visited is None:
        visited = set()
    visited.add(id(exc))
    status = getattr(exc, "status_code", None)
    if status is not None and int(status) in _FATAL_HTTP_STATUSES:
        return True
    # Walk the exception chain — the SDK error may be wrapped.
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc and id(cause) not in visited:
        return _is_fatal_error(cause, visited)
    return False


# ---------------------------------------------------------------------------
# Retryable error detection
# ---------------------------------------------------------------------------

def _is_retryable_api_error(exc: BaseException, visited: set[int] | None = None) -> bool:
    """Return True when *exc* is a transient API error that warrants a retry.

    Classifies the following as retryable:

    * Anthropic ``overloaded_error`` — HTTP 529
    * Rate-limit errors — HTTP 429
    * Generic server errors — HTTP 5xx (status >= 500)
    * Network-layer errors from ``httpx`` (connection failures, timeouts) that
      carry no ``status_code`` attribute

    Fatal errors (401, 403) detected by :func:`_is_fatal_error` are always
    classified as **non-retryable**, even when they arrive wrapped in another
    exception.

    Uses duck-typing (``getattr(exc, "status_code", None)``) so that no direct
    SDK import is required — the check works with Anthropic, OpenAI, Google,
    and any other provider that follows the same convention.

    Walks the exception chain using the same pattern as :func:`_is_fatal_error`
    so that errors wrapped in ``RuntimeError`` or similar are still detected.
    """
    if visited is None:
        visited = set()
    visited.add(id(exc))
    # Fatal errors must never be retried, regardless of any other attribute.
    if _is_fatal_error(exc):
        return False

    # Check HTTP status code via duck-typing (no SDK import needed).
    status = getattr(exc, "status_code", None)
    if status is not None:
        status_int = int(status)
        if status_int >= 500 or status_int == 429:
            return True

    # Detect httpx transport-level errors (ConnectError, TimeoutException,
    # RemoteProtocolError, etc.) without importing httpx.  These exceptions
    # carry no ``status_code`` but live in the ``httpx`` package namespace.
    exc_module = type(exc).__module__ or ""
    if exc_module == "httpx" or exc_module.startswith("httpx."):
        # httpx.HTTPStatusError carries a status_code; those are already
        # handled by the block above.  Anything else from httpx that reaches
        # here is a transport/network error — treat as retryable.
        if status is None:
            return True

    # Walk the exception chain — the retryable error may be wrapped.
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc and id(cause) not in visited:
        return _is_retryable_api_error(cause, visited)

    return False


def _is_cross_wp_error(exc: BaseException) -> bool:
    """Return True when *exc* is the cross-WP contamination guard error.

    These are expected errors raised by the WP-ID guard in tool_wrappers
    when an agent targets the wrong work package. They do not warrant a
    full traceback in the log output.
    """
    return isinstance(exc, ValueError) and "cross-WP contamination" in str(exc)


def _derive_slug_dir(project_path: str, workspace_root: Path) -> Path | None:
    """Return the ledger slug directory for *project_path*, or None on failure.

    Computes ``workspace_root / "mcp-server" / "storage" / "ledger" / <slug>``
    where ``<slug>`` is the last path segment (stem) of *project_path*.

    Returns ``None`` when *project_path* is falsy or any path operation fails,
    so callers can treat ``None`` as "capture disabled" without further guards.
    """
    try:
        slug = Path(project_path).name
        if not slug:
            return None
        return workspace_root / "mcp-server" / "storage" / "ledger" / slug
    except Exception:  # noqa: BLE001
        return None


# Maps orchestrator stage names to the MCP pipeline type used by ledger_begin_work.
# Used to determine which pipeline type to cancel during error-path rollback.
_STAGE_PIPELINE_TYPE: dict[str, str] = {
    "developer": "implementation",
    "qa": "qa",
    "reviewer": "code-review",
    "docs": "documentation",
    "security_auditor": "security-audit",
    "release_engineer": "release-engineering",
}


def _install_tracker(
    tools: list[Any],
    tool_name: str,
    prefix: str,
    tracker: dict,
    *,
    on_call: Callable[[Any, dict], None] | None = None,
    on_success: Callable[[Any, dict], None] | None = None,
) -> None:
    """Generic tool invocation tracker installer.

    Wraps the named tool's ``ainvoke`` with a sentinel-guarded idempotent wrapper.

    Parameters
    ----------
    tools:
        The list of tool objects to scan.
    tool_name:
        The ``tool.name`` value that identifies the target tool.
    prefix:
        Short string used to derive the sentinel attribute names, e.g. ``"bw"``
        produces ``_orig_ainvoke_bw``, ``_bw_wrapper_ref``, ``_tracking_bw``.
    tracker:
        Mutable dict shared with the caller; callbacks may update it.
    on_call:
        Optional ``(input, tracker) -> None`` called synchronously *before*
        ``await _orig(…)``.  Useful for recording inputs or pre-call state.
    on_success:
        Optional ``(result, tracker) -> None`` called synchronously *after*
        a successful return of ``_orig``.  A raised exception prevents this
        callback from running.
    """
    orig_attr = f"_orig_ainvoke_{prefix}"
    ref_attr = f"_{prefix}_wrapper_ref"
    sentinel_attr = f"_tracking_{prefix}"

    for tool in tools:
        if tool.name != tool_name:
            continue
        _prev = getattr(tool, ref_attr, None)
        if _prev is not None and tool.ainvoke is _prev:
            _orig = getattr(tool, orig_attr)  # type: ignore[attr-defined]
        else:
            object.__setattr__(tool, orig_attr, tool.ainvoke)
            _orig = tool.ainvoke

        async def _tracked_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _orig,
            _tracker: dict = tracker,
            _on_call: Any = on_call,
            _on_success: Any = on_success,
            **kwargs: Any,
        ) -> Any:
            if _on_call is not None:
                _on_call(input, _tracker)
            result = await _orig(input, *args, **kwargs)
            if _on_success is not None:
                _on_success(result, _tracker)
            return result

        object.__setattr__(tool, "ainvoke", _tracked_ainvoke)
        object.__setattr__(tool, ref_attr, _tracked_ainvoke)
        object.__setattr__(tool, sentinel_attr, True)
        break


def _install_begin_work_tracker(tools: list[Any], tracker: dict) -> None:
    """Wrap ``ledger_begin_work`` to record when it is invoked and which pipeline type was used.

    Sets ``tracker["called"] = True`` and ``tracker["pipeline_type"] = <type>`` on
    the first invocation.  Idempotent: a sentinel attribute ``_tracking_bw``
    prevents double-wrapping when called multiple times on the same tool objects.
    """

    def _on_call(input: Any, tracker: dict) -> None:
        if isinstance(input, dict):
            target = (
                input["args"]
                if "args" in input and isinstance(input["args"], dict)
                else input
            )
            if pipeline_type := target.get("type"):
                tracker["pipeline_type"] = pipeline_type
        tracker["called"] = True

    _install_tracker(tools, "ledger_begin_work", "bw", tracker, on_call=_on_call)


def _install_complete_pipeline_tracker(tools: list[Any], tracker: dict) -> None:
    """Wrap ``ledger_complete_pipeline`` to record when it completes successfully.

    Sets ``tracker["completed"] = True`` after the first successful invocation.
    Idempotent: a sentinel attribute ``_tracking_cp`` prevents double-wrapping
    when called multiple times on the same tool objects.  The flag is only set
    *after* the underlying call succeeds; a raised exception leaves it ``False``.
    """

    def _on_success(result: Any, tracker: dict) -> None:
        tracker["completed"] = True

    _install_tracker(tools, "ledger_complete_pipeline", "cp", tracker, on_success=_on_success)


def _install_post_completion_guard(tools: list[Any], completion_tracker: dict) -> None:
    """Wrap ``ledger_get_next_action`` to return a synthetic WAIT after pipeline completion.

    After ``_install_complete_pipeline_tracker`` sets ``completion_tracker["completed"]``
    to ``True``, every subsequent call to ``ledger_get_next_action`` is intercepted and
    returns a synthetic ``{"action": "WAIT"}`` response.  This prevents the agent from
    self-routing to the next work package after completing the active one.

    Pre-completion calls are delegated transparently to the original ``ainvoke``.
    Idempotent: a sentinel attribute ``_post_completion_guard`` prevents double-wrapping.
    """
    for tool in tools:
        if tool.name != "ledger_get_next_action":
            continue
        _prev_pcg = getattr(tool, "_pcg_wrapper_ref", None)
        if _prev_pcg is not None and tool.ainvoke is _prev_pcg:
            _orig = tool._orig_ainvoke_pcg  # type: ignore[attr-defined]
        else:
            object.__setattr__(tool, "_orig_ainvoke_pcg", tool.ainvoke)
            _orig = tool.ainvoke

        _tool_name = tool.name

        async def _guarded_gna_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _orig,
            _tracker: dict = completion_tracker,
            _name: str = _tool_name,
            **kwargs: Any,
        ) -> Any:
            if _tracker["completed"]:
                payload = _json.dumps({
                    "action": "WAIT",
                    "reason": (
                        "Pipeline completed for the active work package. "
                        "The orchestrator will route the next work package."
                    ),
                })
                return _make_tool_response(payload, input, _name, status="success")
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _guarded_gna_ainvoke)
        object.__setattr__(tool, "_pcg_wrapper_ref", _guarded_gna_ainvoke)
        object.__setattr__(tool, "_post_completion_guard", True)
        break


# ---------------------------------------------------------------------------
# Log-entry builders (pure dict constructors)
# ---------------------------------------------------------------------------


def _build_start_log_entry(
    stage: str,
    wp_id: str,
    model: str,
    iteration: int,
    timestamp: datetime,
) -> dict:
    """Return the ``stage_start`` JSONL log entry dict."""
    return {
        "timestamp": timestamp.isoformat(),
        "stage": stage,
        "wp_id": wp_id,
        "action": "stage_start",
        "level": "INFO",
        "model": model,
        "iteration": iteration,
    }


def _build_success_log_entry(
    stage: str,
    wp_id: str,
    model: str,
    tokens_used: Any,
    duration_s: float,
    timestamp: datetime,
) -> dict:
    """Return the ``stage_complete`` JSONL log entry dict."""
    return {
        "timestamp": timestamp.isoformat(),
        "stage": stage,
        "wp_id": wp_id,
        "action": "stage_complete",
        "result": "PASS",
        "level": "INFO",
        "model": model,
        "tokens_used": tokens_used,
        "duration_s": duration_s,
    }


def _build_error_log_entry(
    stage: str,
    wp_id: str,
    model: str,
    exc: BaseException,
    duration_s: float,
    timestamp: datetime,
) -> dict:
    """Return the ``stage_error`` JSONL log entry dict."""
    return {
        "timestamp": timestamp.isoformat(),
        "stage": stage,
        "wp_id": wp_id,
        "action": "stage_error",
        "result": "FAIL",
        "error": str(exc),
        "level": "ERROR",
        "model": model,
        "duration_s": duration_s,
    }


# ---------------------------------------------------------------------------
# Stream accumulation
# ---------------------------------------------------------------------------


async def _accumulate_stream(
    agent: Any,
    user_prompt: str,
    slug_dir: Path | None,
    wp_id: str,
    stage: str,
    max_retries: int = 0,
    base_delay_s: float = 10.0,
    run_logger: Any = None,
) -> tuple[list, Path | None]:
    """Run the ``astream()`` loop, accumulate messages, and write JSONL chunks.

    Parameters
    ----------
    agent:
        Deep Agent instance whose ``astream()`` is iterated.
    user_prompt:
        The user-turn content string.
    slug_dir:
        Ledger slug directory for ChunkWriter output.  When ``None``, chunk
        capture is skipped.
    wp_id:
        Active work-package ID; passed to
        :class:`~src.utils.chunk_writer.ChunkWriter`.
    stage:
        Stage name; used for logging and ChunkWriter file naming.
    max_retries:
        Maximum number of retry attempts on transient API errors.  ``0``
        disables retry entirely.  Each retry resets the accumulator and opens
        a fresh ChunkWriter file; the partial file from the failed attempt is
        removed by :meth:`~src.utils.chunk_writer.ChunkWriter.delete`.
    base_delay_s:
        Base delay in seconds for exponential backoff between retries.  The
        actual delay per attempt is
        ``base_delay_s * 2**attempt * (0.5 + random() * 0.5)``.
    run_logger:
        Optional run-scoped JSONL logger (from
        :func:`~src.utils.logging.get_run_logger`).  When provided, a
        ``stage_retry`` entry is streamed to the log on every retry attempt.
        When ``None``, retry attempts are only recorded via the standard
        Python logger.

    Returns
    -------
    tuple[list, Path | None]
        ``(msgs, chunk_file_path)`` where *msgs* is the list of reconstructed
        LangChain messages in stream order and *chunk_file_path* is the Path of
        the written JSONL chunk file, or ``None`` if chunk capture was not active.
    """
    for attempt in range(max_retries + 1):
        _chunk_writer: ChunkWriter | None = None
        _chunk_file_path: Path | None = None
        _chunk_accumulator: dict[str, AIMessageChunk] = {}
        _msg_order: list[Any] = []

        try:
            if slug_dir is not None:
                try:
                    _chunk_writer = ChunkWriter(slug_dir=slug_dir, wp_id=wp_id, stage=stage)
                    _chunk_file_path = _chunk_writer.path
                except OSError:
                    log.warning(
                        "Could not open chunk file for %s/%s; "
                        "chunk capture disabled for this run.",
                        wp_id,
                        stage,
                    )

            async for _stream_item in agent.astream(
                {"messages": [{"role": "user", "content": user_prompt}]},
                stream_mode="messages",
                subgraphs=True,
            ):
                # Unpack the (ns, (msg, metadata)) structure yielded by
                # subgraph-aware message streaming.
                _ns, _inner = _stream_item
                _msg, _meta = _inner

                # Write raw chunk to JSONL immediately (flush guaranteed
                # by ChunkWriter.write_chunk).
                if _chunk_writer is not None:
                    _chunk_writer.write_chunk({
                        "ns": list(_ns),
                        "msg": _msg.model_dump(),
                        "metadata": _meta,
                    })

                # Accumulate AIMessageChunk fragments; pass other types through.
                if isinstance(_msg, AIMessageChunk):
                    _msg_id = _msg.id
                    # AIMessageChunk with id=None is rare (modern LangGraph
                    # always assigns IDs) and is safely dropped during
                    # message reconstruction below.
                    if _msg_id is None:
                        log.debug(
                            "AIMessageChunk with id=None received (stage %s); "
                            "chunk will be dropped during message reconstruction.",
                            stage,
                        )
                    if _msg_id and _msg_id in _chunk_accumulator:
                        _chunk_accumulator[_msg_id] = (
                            _chunk_accumulator[_msg_id] + _msg
                        )
                    else:
                        _chunk_accumulator[_msg_id] = _msg
                        _msg_order.append(("chunk", _msg_id))
                else:
                    _msg_order.append(("direct", _msg))

        except BaseException as _exc:
            # Clean up the partial chunk file before deciding whether to retry.
            if _chunk_writer is not None:
                _chunk_writer.delete()

            # Fatal errors are never retried — propagate immediately.
            if not _is_retryable_api_error(_exc):
                raise

            # Retries exhausted — propagate the last error.
            if attempt >= max_retries:
                raise

            # Compute exponential backoff with jitter in [0.5, 1.0).
            delay = base_delay_s * (2 ** attempt) * (0.5 + _random() * 0.5)
            log.warning(
                "Stream attempt %d/%d failed with transient error (%s); "
                "retrying in %.1fs.",
                attempt + 1,
                max_retries + 1,
                type(_exc).__name__,
                delay,
            )
            if run_logger:
                _retry_entry: dict = {
                    "timestamp": datetime.now(UTC).isoformat(),
                    "action": "stage_retry",
                    "stage": stage,
                    "wp_id": wp_id,
                    "attempt": attempt + 1,
                    "max_attempts": max_retries + 1,
                    "error": str(_exc),
                    "delay_s": round(delay, 1),
                    "level": "WARNING",
                }
                run_logger.stream_entry(_retry_entry)
            await asyncio.sleep(delay)
            continue

        # Success path — close the writer and reconstruct messages in stream order.
        if _chunk_writer is not None:
            _chunk_writer.close()

        msgs: list = []
        for _entry in _msg_order:
            if _entry[0] == "chunk":
                _mid = _entry[1]
                if _mid is not None and _mid in _chunk_accumulator:
                    msgs.append(_chunk_accumulator[_mid])
            else:
                msgs.append(_entry[1])

        return msgs, _chunk_file_path

    # Unreachable in practice (the loop always returns or re-raises),
    # but satisfies the type checker.
    return [], None  # pragma: no cover


# ---------------------------------------------------------------------------
# Error-path pipeline rollback
# ---------------------------------------------------------------------------


async def _handle_rollback(
    begin_work_state: dict,
    complete_pipeline_state: dict,
    wp_id: str,
    wrapped_tools: list,
    stage: str,
    exc: BaseException,
    run_logger: Any,
) -> list[dict]:
    """Cancel any orphaned IN_PROGRESS pipeline on stage error.

    Invokes ``ledger_cancel_pipeline`` when ``ledger_begin_work`` was called
    before the error but ``ledger_complete_pipeline`` did not succeed.  The
    cancellation uses ``auto_cancelled=True`` so it does not consume the rework
    budget (§21.27).

    Parameters
    ----------
    begin_work_state:
        Mutable dict populated by :func:`_install_begin_work_tracker`;
        ``{"called": bool, "pipeline_type": str | None}``.
    complete_pipeline_state:
        Mutable dict populated by :func:`_install_complete_pipeline_tracker`;
        ``{"completed": bool}``.
    wp_id:
        Active work-package ID.
    wrapped_tools:
        Tool list with ``ledger_cancel_pipeline`` accessible by name.
    stage:
        Stage name; used for log entries and fallback pipeline-type lookup.
    exc:
        The exception that terminated the stage.
    run_logger:
        Optional run-scoped JSONL logger; may be ``None``.

    Returns
    -------
    list[dict]
        Zero or one ``pipeline_rollback`` log entry dicts.
    """
    rollback_log_entries: list[dict] = []
    if (
        begin_work_state["called"]
        and not complete_pipeline_state["completed"]
        and wp_id
        and wrapped_tools
    ):
        _pipeline_type = (
            begin_work_state.get("pipeline_type") or _STAGE_PIPELINE_TYPE.get(stage)
        )
        if _pipeline_type:
            _cancel_tool = next(
                (t for t in wrapped_tools if t.name == "ledger_cancel_pipeline"),
                None,
            )
            if _cancel_tool:
                try:
                    await _cancel_tool.ainvoke({
                        "work_package_id": wp_id,
                        "type": _pipeline_type,
                        "reason": f"Orchestrator stage error: {exc}",
                        "auto_cancelled": True,
                    })
                    log.info(
                        "Pipeline rollback: cancelled IN_PROGRESS %s pipeline for %s",
                        _pipeline_type,
                        wp_id,
                    )
                    rollback_entry: dict = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "stage": stage,
                        "wp_id": wp_id,
                        "action": "pipeline_rollback",
                        "pipeline_type": _pipeline_type,
                        "level": "INFO",
                    }
                    rollback_log_entries.append(rollback_entry)
                    if run_logger:
                        run_logger.stream_entry(rollback_entry)
                except Exception as rollback_exc:  # noqa: BLE001
                    log.warning(
                        "Pipeline rollback failed for %s %s: %s",
                        wp_id,
                        _pipeline_type,
                        rollback_exc,
                    )
    return rollback_log_entries


async def _read_pipeline_result(
    wp_id: str,
    wrapped_tools: list,
    stage: str,
    project_path: str,
    run_logger: Any,
) -> list[dict]:
    """Read back the latest pipeline result from the ledger (best-effort).

    Invokes ``ledger_get_work_package`` and extracts the most recent pipeline
    entry.  Any exception is swallowed and logged at DEBUG so that a transient
    read failure never masks a successful stage completion.

    Parameters
    ----------
    wp_id:
        Active work-package ID.
    wrapped_tools:
        Wrapped tool list; must contain ``ledger_get_work_package``.
    stage:
        Stage name; recorded in the emitted ``pipeline_result`` entry.
    project_path:
        Project path string; injected into the tool call.
    run_logger:
        Optional run-scoped JSONL logger; may be ``None``.

    Returns
    -------
    list[dict]
        Zero or one ``pipeline_result`` log entry dicts.
    """
    if not (wp_id and wrapped_tools):
        return []
    try:
        get_wp_tool = next(
            (t for t in wrapped_tools if t.name == "ledger_get_work_package"),
            None,
        )
        if not get_wp_tool:
            return []
        raw = await get_wp_tool.ainvoke(
            {"work_package_id": wp_id, "project_path": project_path}
        )
        wp_detail = parse_tool_response(raw)
        if not isinstance(wp_detail, dict):
            return []
        pipelines = wp_detail.get("pipelines", [])
        if not pipelines:
            return []
        latest = pipelines[-1]
        pipeline_duration_s = None
        if latest.get("duration_ms") is not None:
            pipeline_duration_s = round(latest["duration_ms"] / 1000, 1)
        entry: dict = {
            "timestamp": datetime.now(UTC).isoformat(),
            "stage": stage,
            "wp_id": wp_id,
            "action": "pipeline_result",
            "level": "INFO",
            "pipeline_type": latest.get("type", ""),
            "pipeline_status": latest.get("status", ""),
            "files_modified": (latest.get("artifacts") or {}).get("files_modified", []),
            "metrics": latest.get("metrics"),
            "summary": latest.get("summary", []),
            "duration_s": pipeline_duration_s,
        }
        if run_logger:
            run_logger.stream_entry(entry)
        return [entry]
    except Exception:  # noqa: BLE001
        log.debug(
            "Could not read back WP detail for pipeline_result event",
            exc_info=True,
        )
        return []


def create_stage_node(
    stage: str,
    build_prompt: Callable[[WorkflowState], str],
    config: Config,
    mcp_tools: list[Any],
) -> Callable[[WorkflowState], dict]:
    """
    Generic LangGraph node factory.

    Parameters
    ----------
    stage:
        Stage name matching a key in :data:`~src.config.PERSONA_FILES`
        (e.g. ``"developer"``).
    build_prompt:
        Callable ``(state) -> str`` that produces the user-turn prompt for
        this stage.  Receives the full :class:`~src.state.WorkflowState`.
    config:
        Application config (provides ``stage_models``, ``workspace_root``).
    mcp_tools:
        LangChain tool objects from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
        A LangGraph node function that creates a Deep Agent, invokes it, and
        returns a state-update dict.

    Wrapper layers
    --------------
    Four defensive wrappers are applied to `mcp_tools` inside the node function,
    in this canonical order:

    1. :func:`~src.utils.tool_wrappers.inject_project_path` — Layer 2 safety net.
       Auto-injects ``project_path`` into every call when the argument is absent.
    2. :func:`~src.utils.tool_wrappers.restrict_to_wp` — Layer 3 safety net
       (skipped when ``_wp_id`` is empty, e.g. synthesis stages).  Auto-injects
       ``work_package_id``; returns a descriptive error string to the agent for
       the first two cross-WP violations (soft-fail) and raises
       :exc:`ValueError` on the third (hard kill).
    3. :func:`_install_begin_work_tracker` — Internal tracker (skipped when
       ``_wp_id`` is empty).  Wraps ``ledger_begin_work`` to record when it fires
       and which pipeline type was requested; enables automatic pipeline rollback
       on error (see the ``except`` block).
    4. :func:`~src.utils.tool_wrappers.log_tool_calls` — Outermost wrapper.
       Applied last, so ``_logged_ainvoke`` executes *first* on each call —
       before inner wrappers inject ``project_path`` or ``work_package_id``.
       Emits a ``tool_call`` JSONL event (``level: DEBUG``) recording
       ``stage``, ``wp_id``, ``tool_name``, and ``tool_wp_id``; full argument
       payloads are never logging (privacy constraint).

    Error-path behaviour
    --------------------
    When an exception propagates out of the streaming loop,
    :func:`_accumulate_stream` closes the ChunkWriter and reconstructs any
    partially collected messages in its ``finally`` block before the exception
    reaches the outer ``except`` handler.  The ``except`` block emits a
    ``stage_error`` JSONL event and calls :func:`_handle_rollback` to cancel
    any orphaned IN_PROGRESS pipeline.
    """

    # Capture the app-level Config in a closure variable so it doesn't clash
    # with the LangGraph ``config`` parameter passed to the node at runtime.
    _app_config = config

    async def node_fn(state: WorkflowState, config: Optional[RunnableConfig] = None) -> dict:  # noqa: UP045
        from deepagents import create_deep_agent  # type: ignore[import]
        from deepagents.backends import LocalShellBackend  # type: ignore[import]

        from src.utils.persona import load_persona
        from src.utils.subagents import load_subagents

        run_logger = get_run_logger(config)
        _wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

        # Tracks whether ledger_begin_work was called during this stage invocation.
        # Populated by the tracker installed via _install_begin_work_tracker below.
        # Declared before `try` so it is accessible in the `except` rollback path.
        _begin_work_state: dict = {"called": False, "pipeline_type": None}
        # Tracks whether ledger_complete_pipeline completed successfully.
        _complete_pipeline_state: dict = {"completed": False}
        wrapped_tools: list[Any] = []

        # ── stage_start ───────────────────────────────────────────────
        stage_start_time = datetime.now(UTC)
        # Intentionally called before `try`: an unrecognised stage name raises
        # KeyError here (programming error) and must propagate as-is, not be
        # swallowed and converted into a stage_error log entry.
        resolved_model: str = _app_config.resolve_model_for_stage(stage)
        start_entry = _build_start_log_entry(
            stage, _wp_id, resolved_model,
            state.get("iteration", 0),  # type: ignore[call-overload]
            stage_start_time,
        )
        if run_logger:
            run_logger.stream_entry(start_entry)

        try:
            persona_prompt = load_persona(stage, workspace_root=_app_config.workspace_root)
            user_prompt = build_prompt(state)

            target_path: str = state.get("target_project_path", "")  # type: ignore[call-overload]
            project_path: str = state["project_path"]  # type: ignore[index]
            # SECURITY DECISION (2026-03-30): inherit_env=True exposes all host
            # environment variables to agent subprocesses. Acceptable for local
            # development; curated-env hardening is tracked in
            # docs/agents/deferred-topics.md § Orchestrator.
            backend = LocalShellBackend(root_dir=target_path or None, inherit_env=True)

            wrapped_tools = inject_project_path(list(mcp_tools), project_path)
            if _wp_id:
                restrict_to_wp(wrapped_tools, _wp_id)
                _install_begin_work_tracker(wrapped_tools, _begin_work_state)
                _install_complete_pipeline_tracker(wrapped_tools, _complete_pipeline_state)
                _install_post_completion_guard(wrapped_tools, _complete_pipeline_state)

            # Wire tool-call logging as the outermost wrapper (applied last).
            # Being outermost, _logged_ainvoke executes first on every call,
            # capturing tool_name and the wp_id argument as the agent supplied
            # them — before inner wrappers inject project_path or wp_id.
            log_tool_calls(wrapped_tools, stage, _wp_id, run_logger)

            # Load subagent definitions for stages that delegate sub-tasks.
            # Returns an empty list (→ None) for stages with no subagent config.
            stage_subagents = load_subagents(stage, workspace_root=_app_config.workspace_root)

            agent = create_deep_agent(
                model=resolved_model,
                backend=backend,
                system_prompt=persona_prompt,
                tools=wrapped_tools,
                subagents=stage_subagents or None,
            )

            # Derive slug_dir once; passed to _accumulate_stream for ChunkWriter.
            _slug_dir: Path | None = None
            if _app_config.capture_dialogues and _wp_id:
                _slug_dir = _derive_slug_dir(
                    state.get("project_path", ""),  # type: ignore[call-overload]
                    _app_config.workspace_root,
                )
                if _slug_dir is None:
                    log.debug(
                        "Could not derive slug_dir for ChunkWriter (stage %s); "
                        "chunk capture disabled for this run.",
                        stage,
                    )

            _msgs, _chunk_file_path = await _accumulate_stream(
                agent,
                user_prompt,
                _slug_dir,
                _wp_id,
                stage,
                max_retries=_app_config.stream_max_retries,
                base_delay_s=_app_config.stream_retry_base_delay_s,
                run_logger=run_logger,
            )

            last_msg = _msgs[-1] if _msgs else None
            final_content: str = last_msg.content if last_msg is not None else ""  # type: ignore[union-attr]
            tokens_used = getattr(last_msg, "usage_metadata", None)

            # ── dialogue capture (optional, non-fatal) ────────────────
            chunk_captured_entry: dict | None = None
            if _app_config.capture_dialogues and _wp_id and _chunk_file_path is not None:
                try:
                    chunk_captured_entry = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "action": "dialogue_captured",
                        "stage": stage,
                        "wp_id": _wp_id,
                        "file_path": str(_chunk_file_path),
                        "format": "chunks",
                        "level": "INFO",
                    }
                    if run_logger:
                        run_logger.stream_entry(chunk_captured_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Chunk capture event failed for stage %s; continuing normally.",
                        stage,
                        exc_info=True,
                    )

            # ── duration + stage_complete ──────────────────────────────
            stage_end_time = datetime.now(UTC)
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)
            log.info("Stage %s completed successfully.", stage)
            log_entry = _build_success_log_entry(
                stage, _wp_id, resolved_model, tokens_used, duration_s, stage_end_time
            )
            if run_logger:
                run_logger.stream_entry(log_entry)

            # ── pipeline_result read-back (best-effort) ───────────────
            extra_log_entries: list = await _read_pipeline_result(
                _wp_id, wrapped_tools, stage, project_path, run_logger
            )

            # Append chunk_captured to run_log when present.
            if chunk_captured_entry is not None:
                extra_log_entries.append(chunk_captured_entry)

            return {
                "stage_result": final_content,
                # True = agent ran to completion without error. At this level the best
                # proxy for "at least one PASS pipeline was produced" is that the agent
                # finished without raising an exception. The supervisor's circuit breaker
                # treats this as a successful stage turn.
                "stage_success": True,
                "run_log": [start_entry, log_entry] + extra_log_entries,
            }

        except Exception as exc:  # noqa: BLE001
            stage_end_time = datetime.now(UTC)
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)
            log.error("Stage %s failed: %s", stage, exc, exc_info=not _is_cross_wp_error(exc))
            log_entry = _build_error_log_entry(
                stage, _wp_id, resolved_model, exc, duration_s, stage_end_time
            )
            if run_logger:
                run_logger.stream_entry(log_entry)

            rollback_log_entries = await _handle_rollback(
                _begin_work_state, _complete_pipeline_state,
                _wp_id, wrapped_tools, stage, exc, run_logger,
            )

            result_dict: dict = {
                "stage_result": "",
                "stage_success": False,
                "errors": [
                    {
                        "timestamp": stage_end_time.isoformat(),
                        "stage": stage,
                        "wp_id": _wp_id,
                        "message": str(exc),
                    }
                ],
                "run_log": [start_entry, log_entry] + rollback_log_entries,
            }

            # Mark fatal errors so the supervisor terminates immediately
            # instead of burning through remaining iterations.
            if _is_fatal_error(exc):
                result_dict["fatal_error"] = str(exc)
                log.error(
                    "Fatal error detected (stage %s) — run will terminate: %s",
                    stage,
                    exc,
                )

            return result_dict

    node_fn.__name__ = f"{stage}_node"
    node_fn.__qualname__ = f"{stage}_node"
    return node_fn

```
###  Path: `/orchestrator/src/nodes/developer.py`

```py
"""
nodes/developer.py — Developer node.

Creates a Deep Agent with the Developer persona prompt and MCP tools, invokes
it to implement the current work package.

Slim prompt strategy
--------------------
``_build_developer_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``developer`` Markdown template.  Identity declarations, workflow
steps, and MCP tool call guidance live in the Developer persona system prompt
loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_developer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("developer")


def _build_developer_prompt(state: WorkflowState) -> str:
    """Construct the developer agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_developer_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Developer stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("developer", _build_developer_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/docs.py`

```py
"""
nodes/docs.py — Documentation node.

Creates a Deep Agent with the Documentation persona prompt and MCP tools,
invokes it to update project documentation for the current work package.

Slim prompt strategy
--------------------
``_build_docs_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``docs`` Markdown template.  Identity declarations, workflow steps,
and MCP tool call guidance live in the Documentation persona system prompt
loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_docs_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("docs")


def _build_docs_prompt(state: WorkflowState) -> str:
    """Construct the documentation agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_docs_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Documentation stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("docs", _build_docs_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/pm.py`

```py
"""
nodes/pm.py — Project Manager node.

Creates a Deep Agent with the PM persona prompt and MCP tools, invokes it
to analyse the plan document and create work packages in the ledger.

Slim prompt strategy
--------------------
``_build_pm_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``plan_file`` — relative path of the plan document within the project.
- **Plan document content** — the full text of the plan file is embedded
  directly in the prompt. This is legitimate runtime data that the persona
  system prompt cannot know at build time and is therefore the only
  substantive content beyond the three slim fields above.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``pm`` Markdown template.  Identity declarations, workflow steps,
and MCP tool call guidance live in the PM persona system prompt loaded from
``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_pm_node`
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("pm")


def _build_pm_prompt(state: WorkflowState) -> str:
    """Construct the PM agent's user-turn prompt from the plan document."""
    project_path: str = state["project_path"]
    plan_file: str = state.get("plan_file", "plan.md")  # type: ignore[call-overload]

    # Read the plan document so the PM agent has full context.
    plan_path = Path(project_path) / plan_file
    try:
        plan_content = plan_path.read_text(encoding="utf-8")
    except OSError as exc:
        plan_content = f"[Could not read plan file at {plan_path}: {exc}]"

    return render_prompt(_TEMPLATE, {
        "project_path": project_path,
        "plan_file": plan_file,
        "extra": f"---\n\n# Plan Document\n\n{plan_content}",
    })


def make_pm_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Project Manager stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("pm", _build_pm_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/prompt_renderer.py`

```py
"""
nodes/prompt_renderer.py — Lightweight template renderer for stage prompts.

Provides:
- ``load_template(stage)`` — loads and caches a ``.md`` template from the
  ``templates/`` directory relative to this module.
- ``load_partial(name)`` — loads and caches a ``.md`` partial from the
  ``templates/partials/`` directory relative to this module.
- ``render_prompt(template, variables)`` — processes ``{{> partial}}`` includes,
  ``{{#if}}…{{/if}}`` conditional blocks, and substitutes ``{variable}``
  placeholders.
- ``clear_template_cache()`` — resets both in-memory caches for test support.

Template syntax
---------------
``{variable}``
    Substituted from the variables dict.  Missing keys resolve to empty string
    via ``defaultdict(str)``.

``{{`` / ``}}``
    Literal brace escape sequences used by ``str.format_map``.  ``{{``
    renders as ``{`` and ``}}`` renders as ``}`` in the output.  This means
    that inline ``{{#if}}`` or ``{{> …}}`` markers that are *not* on their
    own line are passed through this step unchanged and will appear as
    ``{#if}`` / ``{> …}`` in the final output rather than being evaluated
    as conditional or include directives.

``{{#if variable}}`` … ``{{/if}}``
    Conditional block.  The block (including its marker lines) is included only
    when ``variables[variable]`` is truthy; otherwise the entire block is
    removed.  Nesting is not supported.  Both marker lines must appear on their
    own line.

``{{> partial-name}}``
    Include directive.  Must appear on its own line (no preceding text).
    Replaced with the content of ``templates/partials/{partial-name}.md``
    before conditional evaluation.  Variables inside partials are substituted
    in the variable-substitution step.  Recursive includes within partial
    files are not resolved.

Post-processing
---------------
After substitution, consecutive blank lines (3+ ``\\n`` chars) are collapsed
to a single blank line (``\\n\\n``).

Uses only Python stdlib: ``re``, ``pathlib``, ``collections.defaultdict``.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

_TEMPLATES_DIR: Path = Path(__file__).parent / "templates"
_PARTIALS_DIR: Path = _TEMPLATES_DIR / "partials"

_cache: dict[str, str] = {}
_partial_cache: dict[str, str] = {}

# Matches a full {{#if var}} … {{/if}} block where both markers appear at the
# start of a line.  The trailing \n? after {{/if}} is consumed so the blank
# line following a removed block is not left behind.
# (\w+) — no hyphens: conditional variable names are Python identifiers
# (letters, digits, underscores only; hyphens are not valid identifier chars).
_IF_BLOCK_RE: re.Pattern[str] = re.compile(
    r"^\{\{#if\s+(\w+)\}\}\n(.*?)^\{\{/if\}\}\n?",
    re.DOTALL | re.MULTILINE,
)

# Matches a {{> partial-name}} include directive on its own line.  The marker
# must appear at the start of a line; inline occurrences (preceded by other
# text) do not match.  The trailing \n? consumes the line break so the partial
# content is inserted cleanly in its place.
# ([\w-]+) — hyphens allowed: partial file names follow kebab-case convention
# (e.g. "wp-scope-reminder"), unlike template variable names captured above.
_INCLUDE_RE: re.Pattern[str] = re.compile(
    r"^\{\{>\s*([\w-]+)\s*\}\}\n?",
    re.MULTILINE,
)

# Three or more consecutive newlines → collapse to two (one blank line).
_MULTI_BLANK_RE: re.Pattern[str] = re.compile(r"\n{3,}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_template(stage: str) -> str:
    """Load and cache the Markdown template for *stage*.

    Reads ``orchestrator/src/nodes/templates/{stage}.md`` relative to this
    module.  The result is cached in-process; subsequent calls for the same
    stage return the cached string without re-reading the file.

    Parameters
    ----------
    stage:
        Stage name matching the template filename, e.g. ``"developer"``.
        Must consist of word characters and hyphens only (``[\\w-]+``); no
        path separators or dots are permitted.

    Returns
    -------
    str
        Raw template content (UTF-8).

    Raises
    ------
    ValueError
        If *stage* does not match ``[\\w-]+`` (i.e. contains path separators,
        dots, spaces, or is empty).
    FileNotFoundError
        If no template file exists for *stage*.
    """
    if not re.fullmatch(r"[\w-]+", stage):
        raise ValueError(
            f"Invalid template name {stage!r}: must match [\\w-]+ "
            "(word characters and hyphens only; no path separators, dots, or spaces)"
        )
    if stage not in _cache:
        path = _TEMPLATES_DIR / f"{stage}.md"
        _cache[stage] = path.read_text(encoding="utf-8")
    return _cache[stage]


def load_partial(name: str) -> str:
    """Load and cache the Markdown partial *name*.

    Reads ``orchestrator/src/nodes/templates/partials/{name}.md`` relative to
    this module.  The result is cached in-process; subsequent calls for the
    same name return the cached string without re-reading the file.

    Parameters
    ----------
    name:
        Partial name matching the file stem, e.g. ``"wp-scope-reminder"``.
        Must consist of word characters and hyphens only (``[\\w-]+``); no
        path separators or dots are permitted.

    Returns
    -------
    str
        Raw partial content (UTF-8).

    Raises
    ------
    ValueError
        If *name* does not match ``[\\w-]+`` (i.e. contains path separators,
        dots, spaces, or is empty).
    FileNotFoundError
        If no partial file exists for *name*.
    """
    if not re.fullmatch(r"[\w-]+", name):
        raise ValueError(
            f"Invalid partial name {name!r}: must match [\\w-]+ "
            "(word characters and hyphens only; no path separators, dots, or spaces)"
        )
    if name not in _partial_cache:
        path = _PARTIALS_DIR / f"{name}.md"
        _partial_cache[name] = path.read_text(encoding="utf-8")
    return _partial_cache[name]


def clear_template_cache() -> None:
    """Clear the in-memory template and partial caches.

    Intended for test support.  Allows tests to inject fresh template or
    partial content, or verify that :func:`load_template` and
    :func:`load_partial` re-read from disk.
    """
    _cache.clear()
    _partial_cache.clear()


def render_prompt(template: str, variables: dict[str, str]) -> str:
    """Render *template* with *variables* and return the resulting string.

    Processing is applied in four sequential steps:

    0. **Include resolution** — Each ``{{> partial-name}}`` marker on its own
       line is replaced with the content of the corresponding partial file
       (loaded via :func:`load_partial`).  A single additional pass then
       expands any ``{{> partial}}`` directives found within the loaded
       partial content (one level deep).  Directives inside the second-level
       partials are not resolved.  Variables inside included content are
       substituted in step 2.

    1. **Conditional blocks** — Each ``{{#if var}} … {{/if}}`` block is
       evaluated: if ``variables[var]`` is truthy the block body is kept and
       both marker lines are removed; if falsy the entire block (markers and
       body) is removed.

    2. **Variable substitution** — ``{variable}`` placeholders are replaced
       using ``str.format_map`` backed by a ``defaultdict(str)`` so that
       missing keys silently become empty strings.  ``{{`` and ``}}`` are
       the ``format_map`` escape sequences for literal braces: ``{{`` →
       ``{``, ``}}`` → ``}``.  As a side-effect, any inline ``{{#if}}`` or
       ``{{> …}}`` markers that survived step 0 and step 1 (because they
       were not on their own line) will be reduced to ``{#if}`` / ``{> …}``
       in the output — not evaluated as directives.

    3. **Blank-line collapse** — Three or more consecutive newlines are
       reduced to two (preserving at most one blank line between sections).

    Parameters
    ----------
    template:
        Raw template string, typically returned by :func:`load_template`.
    variables:
        Mapping of variable names to their string values.

    Returns
    -------
    str
        The fully rendered prompt string.
    """
    # Build a defaultdict so missing {placeholders} → "" during format_map.
    _vars: defaultdict[str, str] = defaultdict(str, variables)

    def _process_block(match: re.Match[str]) -> str:
        """Return block body when variable is truthy, else empty string."""
        var_name = match.group(1)
        body: str = match.group(2)
        return body if _vars[var_name] else ""

    # Step 0 — resolve {{> partial}} includes (one-level-deep expansion in partials)
    def _expand_partial(name: str) -> str:
        """Load partial and expand any first-level {{> include}} within it."""
        content = load_partial(name)
        return _INCLUDE_RE.sub(lambda m: load_partial(m.group(1)), content)

    result = _INCLUDE_RE.sub(lambda m: _expand_partial(m.group(1)), template)

    # Step 1 — evaluate {{#if}} … {{/if}} blocks
    result = _IF_BLOCK_RE.sub(_process_block, result)

    # Step 2 — substitute {variable} placeholders
    result = result.format_map(_vars)

    # Step 3 — collapse runs of 3+ newlines to a single blank line
    result = _MULTI_BLANK_RE.sub("\n\n", result)

    return result

```
###  Path: `/orchestrator/src/nodes/qa.py`

```py
"""
nodes/qa.py — QA node.

Creates a Deep Agent with the QA persona prompt and MCP tools, invokes it to
run the test suite and complete the QA pipeline for the current work package.

Slim prompt strategy
--------------------
``_build_qa_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``qa`` Markdown template.  Identity declarations, workflow steps,
and MCP tool call guidance live in the QA persona system prompt loaded from
``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_qa_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("qa")


def _build_qa_prompt(state: WorkflowState) -> str:
    """Construct the QA agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_qa_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the QA stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("qa", _build_qa_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/release_engineer.py`

```py
"""
nodes/release_engineer.py — Release Engineer node.

Creates a Deep Agent with the Release Engineer persona prompt and MCP tools,
invokes it to curate the release and complete the release-engineering pipeline
for the current work package.

Slim prompt strategy
--------------------
``_build_release_engineer_prompt()`` produces a minimal user-turn prompt
containing only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``release_engineer`` Markdown template.  Identity declarations,
workflow steps, and MCP tool call guidance live in the Release Engineer
persona system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_release_engineer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("release_engineer")


def _build_release_engineer_prompt(state: WorkflowState) -> str:
    """Construct the Release Engineer agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_release_engineer_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Release Engineer stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("release_engineer", _build_release_engineer_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/reviewer.py`

```py
"""
nodes/reviewer.py — Reviewer node.

Creates a Deep Agent with the Reviewer persona prompt and MCP tools, invokes
it to perform a structured code review for the current work package.

Slim prompt strategy
--------------------
``_build_reviewer_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``reviewer`` Markdown template.  Identity declarations, workflow
steps, and MCP tool call guidance live in the Reviewer persona system prompt
loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_reviewer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("reviewer")


def _build_reviewer_prompt(state: WorkflowState) -> str:
    """Construct the reviewer agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_reviewer_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Reviewer stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("reviewer", _build_reviewer_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/security_auditor.py`

```py
"""
nodes/security_auditor.py — Security Auditor node.

Creates a Deep Agent with the Security Auditor persona prompt and MCP tools,
invokes it to run OWASP/dependency checks and complete the security-audit
pipeline for the current work package.

Slim prompt strategy
--------------------
``_build_security_auditor_prompt()`` produces a minimal user-turn prompt
containing only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``security_auditor`` Markdown template.  Identity declarations,
workflow steps, and MCP tool call guidance live in the Security Auditor
persona system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_security_auditor_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("security_auditor")


def _build_security_auditor_prompt(state: WorkflowState) -> str:
    """Construct the Security Auditor agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_security_auditor_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Security Auditor stage.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("security_auditor", _build_security_auditor_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/synthesis.py`

```py
"""
nodes/synthesis.py — Synthesis node.

Creates a Deep Agent with the Synthesis persona prompt and MCP tools, invokes
it to produce the final project synthesis report once all work packages are
complete.

Slim prompt strategy
--------------------
``_build_synthesis_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

``wp_id`` is intentionally omitted — synthesis is a **project-scoped** stage
that operates across all completed work packages rather than a single WP.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``synthesis`` Markdown template.  Identity declarations, workflow
steps, and MCP tool call guidance live in the Synthesis persona system prompt
loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_synthesis_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("synthesis")


def _build_synthesis_prompt(state: WorkflowState) -> str:
    """
    Construct the synthesis agent's user-turn prompt.

    No ``current_wp_id`` is required — synthesis operates on the full project.
    """
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_synthesis_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Synthesis stage.

    .. note::
        The synthesis node does **not** require ``current_wp_id`` in state.
        It operates on the full project and should be the final node before END.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        MCP ledger tools from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
    """
    return create_stage_node("synthesis", _build_synthesis_prompt, config, mcp_tools)

```