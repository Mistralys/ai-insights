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
