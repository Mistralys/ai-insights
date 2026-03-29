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

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from langchain_core.runnables import RunnableConfig

from src.utils.dialogue_writer import serialize_messages_to_markdown, write_dialogue
from src.utils.logging import get_run_logger
from src.utils.mcp_parse import parse_tool_response
from src.utils.tool_wrappers import inject_project_path, log_tool_calls, restrict_to_wp

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

log = logging.getLogger(__name__)

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


def _install_begin_work_tracker(tools: list[Any], tracker: dict) -> None:
    """Wrap ``ledger_begin_work`` to record when it is invoked and which pipeline type was used.

    Sets ``tracker["called"] = True`` and ``tracker["pipeline_type"] = <type>`` on
    the first invocation.  Idempotent: a sentinel attribute ``_tracking_begin_work``
    prevents double-wrapping when called multiple times on the same tool objects.
    """
    for tool in tools:
        if tool.name != "ledger_begin_work":
            continue
        # If the current ainvoke is our own tracker from a previous call,
        # reuse the saved delegation target.  Otherwise inner layers were
        # re-wrapped — capture the fresh inner wrapper.
        _prev_bw = getattr(tool, "_bw_wrapper_ref", None)
        if _prev_bw is not None and tool.ainvoke is _prev_bw:
            _orig = tool._orig_ainvoke_bw  # type: ignore[attr-defined]
        else:
            object.__setattr__(tool, "_orig_ainvoke_bw", tool.ainvoke)
            _orig = tool.ainvoke

        async def _tracked_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _orig,
            _tracker: dict = tracker,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                target = (
                    input["args"]
                    if "args" in input and isinstance(input["args"], dict)
                    else input
                )
                pipeline_type = target.get("type")
                if pipeline_type:
                    _tracker["pipeline_type"] = pipeline_type
            _tracker["called"] = True
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _tracked_ainvoke)
        object.__setattr__(tool, "_bw_wrapper_ref", _tracked_ainvoke)
        object.__setattr__(tool, "_tracking_begin_work", True)
        break


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
        Application config (provides ``model_name``, ``workspace_root``).
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

    Error-path dialogue capture
    ---------------------------
    When ``capture_dialogues=True``, dialogue capture acts as a debugging safety
    net even when an exception interrupts the node (e.g. LLM context overflow or
    MCP token limit). If the agent crash occurs *after* ``_msgs`` starts
    collecting turns, the ``except`` block writes a partial dialogue file and
    emits a ``dialogue_captured`` JSONL event tagged with ``partial: True``.
    This operation is entirely non-fatal: any file-system failure during capture
    is logged at DEBUG but swallowed so it never obscures the original exception
    that took down the pipeline.
    """

    # Capture the app-level Config in a closure variable so it doesn't clash
    # with the LangGraph ``config`` parameter passed to the node at runtime.
    _app_config = config

    async def node_fn(state: WorkflowState, config: Optional[RunnableConfig] = None) -> dict:  # noqa: UP045
        from deepagents import create_deep_agent  # type: ignore[import]
        from deepagents.backends import LocalShellBackend  # type: ignore[import]

        from src.utils.persona import load_persona

        run_logger = get_run_logger(config)
        _wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

        # Tracks whether ledger_begin_work was called during this stage invocation.
        # Populated by the tracker installed in _install_begin_work_tracker below.
        # Declared before `try` so it is accessible in the `except` rollback path.
        _begin_work_state: dict = {"called": False, "pipeline_type": None}
        wrapped_tools: list[Any] = []
        # Pre-declared before `try` so that messages collected before a crash are
        # accessible in the `except` block for error-path dialogue capture.
        _msgs: list = []

        # ── stage_start ───────────────────────────────────────────────
        stage_start_time = datetime.now(UTC)
        start_entry: dict = {
            "timestamp": stage_start_time.isoformat(),
            "stage": stage,
            "wp_id": _wp_id,
            "action": "stage_start",
            "level": "INFO",
            "iteration": state.get("iteration", 0),  # type: ignore[call-overload]
        }
        if run_logger:
            run_logger.stream_entry(start_entry)

        try:
            persona_prompt = load_persona(stage, workspace_root=_app_config.workspace_root)
            user_prompt = build_prompt(state)

            target_path: str = state.get("target_project_path", "")  # type: ignore[call-overload]
            project_path: str = state["project_path"]  # type: ignore[index]
            backend = LocalShellBackend(root_dir=target_path or None)

            wrapped_tools = inject_project_path(list(mcp_tools), project_path)
            if _wp_id:
                restrict_to_wp(wrapped_tools, _wp_id)

            # Install tracker so the except block can detect whether
            # ledger_begin_work was called before the error occurred.
            if _wp_id:
                _install_begin_work_tracker(wrapped_tools, _begin_work_state)

            # Wire tool-call logging as the outermost wrapper (applied last).
            # Being outermost, _logged_ainvoke executes first on every call,
            # capturing tool_name and the wp_id argument as the agent supplied
            # them — before inner wrappers inject project_path or wp_id.
            log_tool_calls(wrapped_tools, stage, _wp_id, run_logger)

            agent = create_deep_agent(
                model=_app_config.model_name,
                backend=backend,
                system_prompt=persona_prompt,
                tools=wrapped_tools,
            )

            # Use ainvoke so LangGraph's inner ToolNode takes the async path
            # (a_run) for MCP StructuredTools, which don't implement sync _run.
            result = await agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]})
            _msgs = result.get("messages") or []
            last_msg = _msgs[-1] if _msgs else None
            final_content: str = last_msg.content if last_msg is not None else ""  # type: ignore[union-attr]
            tokens_used = getattr(last_msg, "usage_metadata", None)

            # ── dialogue capture (optional, non-fatal) ────────────────
            dialogue_captured_entry: dict | None = None
            if _app_config.capture_dialogues and _wp_id:
                try:
                    # Derive slug_dir from workspace_root + mcp-server/storage/ledger/<slug>
                    # where slug is the last path segment of the ledger plan directory.
                    project_path_obj = state["project_path"]  # type: ignore[index]
                    slug = Path(project_path_obj).name
                    slug_dir = (
                        _app_config.workspace_root
                        / "mcp-server"
                        / "storage"
                        / "ledger"
                        / slug
                    )
                    ts_str = stage_start_time.isoformat()
                    content = serialize_messages_to_markdown(_msgs, stage, _wp_id, ts_str)
                    written_path = write_dialogue(content, slug_dir, _wp_id, stage)
                    dialogue_captured_entry = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "action": "dialogue_captured",
                        "stage": stage,
                        "wp_id": _wp_id,
                        "file_path": str(written_path),
                        "level": "INFO",
                    }
                    if run_logger:
                        run_logger.stream_entry(dialogue_captured_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Dialogue capture failed for stage %s; continuing normally.",
                        stage,
                        exc_info=True,
                    )

            # ── duration ──────────────────────────────────────────────
            stage_end_time = datetime.now(UTC)
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)

            log.info("Stage %s completed successfully.", stage)
            log_entry = {
                "timestamp": stage_end_time.isoformat(),
                "stage": stage,
                "wp_id": _wp_id,
                "action": "stage_complete",
                "result": "PASS",
                "level": "INFO",
                "tokens_used": tokens_used,
                "duration_s": duration_s,
            }
            if run_logger:
                run_logger.stream_entry(log_entry)

            # ── pipeline_result read-back (best-effort) ───────────────
            extra_log_entries: list = []
            if _wp_id and wrapped_tools:
                try:
                    get_wp_tool = next(
                        (t for t in wrapped_tools if t.name == "ledger_get_work_package"),
                        None,
                    )
                    if get_wp_tool:
                        raw = await get_wp_tool.ainvoke(
                            {"work_package_id": _wp_id, "project_path": project_path}
                        )
                        wp_detail = parse_tool_response(raw)
                        if isinstance(wp_detail, dict):
                            pipelines = wp_detail.get("pipelines", [])
                            if pipelines:
                                latest = pipelines[-1]
                                pipeline_duration_s = None
                                if latest.get("duration_ms") is not None:
                                    pipeline_duration_s = round(
                                        latest["duration_ms"] / 1000, 1
                                    )
                                pipeline_result_entry: dict = {
                                    "timestamp": datetime.now(UTC).isoformat(),
                                    "stage": stage,
                                    "wp_id": _wp_id,
                                    "action": "pipeline_result",
                                    "level": "INFO",
                                    "pipeline_type": latest.get("type", ""),
                                    "pipeline_status": latest.get("status", ""),
                                    "files_modified": (
                                        latest.get("artifacts") or {}
                                    ).get("files_modified", []),
                                    "metrics": latest.get("metrics"),
                                    "summary": latest.get("summary", []),
                                    "duration_s": pipeline_duration_s,
                                }
                                if run_logger:
                                    run_logger.stream_entry(pipeline_result_entry)
                                extra_log_entries.append(pipeline_result_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Could not read back WP detail for pipeline_result event",
                        exc_info=True,
                    )

            # Append dialogue_captured to run_log when present.
            if dialogue_captured_entry is not None:
                extra_log_entries.append(dialogue_captured_entry)

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
            ts = stage_end_time.isoformat()
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)
            log.error("Stage %s failed: %s", stage, exc, exc_info=True)
            log_entry = {
                "timestamp": ts,
                "stage": stage,
                "wp_id": _wp_id,
                "action": "stage_error",
                "result": "FAIL",
                "error": str(exc),
                "level": "ERROR",
                "duration_s": duration_s,
            }
            if run_logger:
                run_logger.stream_entry(log_entry)

            # ── pipeline rollback ─────────────────────────────────────
            # If ledger_begin_work was called before the error, cancel the
            # orphaned IN_PROGRESS pipeline so the next run attempt is not
            # blocked by a stale pipeline. auto_cancelled=True prevents the
            # cancellation from counting toward the rework budget (§21.27).
            rollback_log_entries: list[dict] = []
            if _begin_work_state["called"] and _wp_id and wrapped_tools:
                _pipeline_type = (
                    _begin_work_state.get("pipeline_type") or _STAGE_PIPELINE_TYPE.get(stage)
                )
                if _pipeline_type:
                    _cancel_tool = next(
                        (t for t in wrapped_tools if t.name == "ledger_cancel_pipeline"),
                        None,
                    )
                    if _cancel_tool:
                        try:
                            await _cancel_tool.ainvoke({
                                "work_package_id": _wp_id,
                                "type": _pipeline_type,
                                "reason": f"Orchestrator stage error: {exc}",
                                "auto_cancelled": True,
                            })
                            log.info(
                                "Pipeline rollback: cancelled IN_PROGRESS %s pipeline for %s",
                                _pipeline_type,
                                _wp_id,
                            )
                            rollback_entry: dict = {
                                "timestamp": datetime.now(UTC).isoformat(),
                                "stage": stage,
                                "wp_id": _wp_id,
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
                                _wp_id,
                                _pipeline_type,
                                rollback_exc,
                            )

            # ── error-path dialogue capture (best-effort) ─────────────
            # Write a partial dialogue file when the stage accumulated messages
            # before the crash.  Non-fatal: any write failure is silently logged
            # and the stage-error result is returned unchanged.
            if _app_config.capture_dialogues and _wp_id and _msgs:
                try:
                    project_path_obj = state["project_path"]  # type: ignore[index]
                    slug = Path(project_path_obj).name
                    slug_dir = (
                        _app_config.workspace_root
                        / "mcp-server"
                        / "storage"
                        / "ledger"
                        / slug
                    )
                    ts_str = stage_start_time.isoformat()
                    err_content = serialize_messages_to_markdown(_msgs, stage, _wp_id, ts_str)
                    written_path = write_dialogue(err_content, slug_dir, _wp_id, stage)
                    err_dialogue_entry: dict = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "action": "dialogue_captured",
                        "stage": stage,
                        "wp_id": _wp_id,
                        "file_path": str(written_path),
                        "level": "INFO",
                        "partial": True,
                    }
                    if run_logger:
                        run_logger.stream_entry(err_dialogue_entry)
                    rollback_log_entries.append(err_dialogue_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Error-path dialogue capture failed for %s", stage, exc_info=True
                    )

            return {
                "stage_result": "",
                "stage_success": False,
                "errors": [
                    {
                        "timestamp": ts,
                        "stage": stage,
                        "wp_id": _wp_id,
                        "message": str(exc),
                    }
                ],
                "run_log": [start_entry, log_entry] + rollback_log_entries,
            }

    node_fn.__name__ = f"{stage}_node"
    node_fn.__qualname__ = f"{stage}_node"
    return node_fn
