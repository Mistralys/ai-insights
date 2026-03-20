"""
supervisor.py — Pure-Python routing brain.

Reads ledger state via MCP tools and returns a deterministic LangGraph
``Command`` routing the graph to the next appropriate pipeline stage,
replacing the prompt-based auto-handoff mechanism.

The public entry-point is :func:`make_supervisor_node`, a factory that
closes over a list of LangChain MCP tool objects and returns the LangGraph
node function.  This pattern keeps the node testable (inject mock tools)
and avoids global state.

No LLM calls are made here — routing is purely algorithmic.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from .config import PIPELINE_ROLE_NAMES, ROLE_IDS, WP_TERMINAL_STATUSES
from .state import WorkflowState
from .utils.logging import get_run_logger

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Routing destination constants
# ---------------------------------------------------------------------------

_DEST_PM = ROLE_IDS["Project Manager"]
_DEST_DEVELOPER = ROLE_IDS["Developer"]
_DEST_QA = ROLE_IDS["QA"]
_DEST_SECURITY_AUDITOR = ROLE_IDS["Security Auditor"]
_DEST_REVIEWER = ROLE_IDS["Reviewer"]
_DEST_RELEASE_ENGINEER = ROLE_IDS["Release Engineer"]
_DEST_DOCS = ROLE_IDS["Documentation"]
_DEST_SYNTHESIS = ROLE_IDS["Synthesis"]

# Work-package statuses considered terminal (no further agent action needed).
_TERMINAL_STATUSES: frozenset[str] = WP_TERMINAL_STATUSES

# Actions where the role has nothing to do this iteration.
_SKIP_ACTIONS: frozenset[str] = frozenset({
    "WAIT",
    "WAIT_FOR_REWORK",
    "WAIT_FOR_DOWNSTREAM",
    "WAIT_FOR_UPSTREAM_REWORK_LIMIT",
    "BLOCK_FOR_REWORK_LIMIT",
})

# All non-skip action strings known to this version of the supervisor.
# Any unrecognised action (not in _SKIP_ACTIONS and not here) is forwarded-
# compatible: treated as WAIT with a warning so future server additions don't
# crash the supervisor.
_DISPATCH_ACTIONS: frozenset[str] = frozenset({
    # PM
    "UNBLOCK_WP", "REVIEW_REWORK_LIMIT", "REVIEW_STALE", "REVIEW_ABANDONED",
    "REPAIR_ORPHAN_BLOCKED",
    # Developer
    "IMPLEMENT", "CLAIM_WP", "CONTINUE_PIPELINE", "RESUME_OR_CANCEL",
    # Multi-role (routed by fail_routing in workflow manifest)
    "REWORK",
    # QA
    "RUN_QA",
    # Security Auditor
    "RUN_SECURITY_AUDIT",
    # Reviewer
    "RUN_REVIEW",
    # Release Engineer
    "RUN_RELEASE_ENGINEERING",
    # Documentation
    "WRITE_DOCS", "FINALIZE_WP", "UPDATE_CRITERIA",
})

# Maps each agent role name (as used in ledger_get_next_action) to the
# corresponding LangGraph stage destination.
# Derived from the manifest: non-orchestrating role name → role ID.
_ROLE_STAGE_MAP: dict[str, str] = {
    name: ROLE_IDS[name]
    for name in PIPELINE_ROLE_NAMES
}

# All non-orchestrating agent role names in manifest order.
# The supervisor queries each role in turn to find the first with actionable work.
_ROLES: list[str] = list(PIPELINE_ROLE_NAMES)

# LangGraph END sentinel.
try:
    from langgraph.constants import END  # type: ignore[import]
except ImportError:
    END = "__end__"  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def make_supervisor_node(mcp_tools: list[Any]):
    """
    Return a LangGraph node function (supervisor) closed over *mcp_tools*.

    The returned function is a deterministic pure-Python router: it reads
    ledger state via the provided MCP tools and returns a ``Command`` that
    routes the graph to the next appropriate stage.

    Parameters
    ----------
    mcp_tools:
        List of LangChain Tool objects returned by ``MCPToolkit.get_tools()``.

    Returns
    -------
    Callable[[WorkflowState], Command]
        The supervisor node function.
    """
    tools_by_name: dict[str, Any] = {t.name: t for t in mcp_tools}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _call_tool(name: str, **kwargs: Any) -> Any:
        """Invoke an MCP tool by name and return the parsed JSON response."""
        tool = tools_by_name.get(name)
        if tool is None:
            raise RuntimeError(
                f"MCP tool {name!r} not found. "
                f"Available: {sorted(tools_by_name)}"
            )
        raw = await tool.ainvoke(kwargs)
        # langchain-mcp-adapters 0.1.0 returns a list of content objects:
        # [{"type": "text", "text": "<json-string>"}]
        # Extract and parse the text from the first text-type content block.
        if isinstance(raw, list):
            for block in raw:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block["text"]
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return text
            # No text block found; return the raw list (caller handles it).
            return raw
        if isinstance(raw, str):
            return json.loads(raw)
        return raw

    def _log_entry(
        stage: str, wp_id: str, action: str, destination: str, **extra: Any
    ) -> dict:
        return {
            "timestamp": datetime.now(UTC).isoformat(),
            "stage": stage,
            "wp_id": wp_id,
            "action": action,
            "destination": destination,
            "level": "INFO",  # default; callers may override via **extra
            **extra,
        }

    # ------------------------------------------------------------------
    # The node function itself
    # ------------------------------------------------------------------

    async def supervisor_node(
        state: WorkflowState, config: RunnableConfig | None = None,
    ) -> Command:
        """Deterministic routing node — pure Python, no LLM calls."""
        run_logger = get_run_logger(config)
        project_path: str = state["project_path"]
        new_iteration: int = state.get("iteration", 0) + 1  # type: ignore[call-overload]
        max_iterations: int = state.get("max_iterations", 100)  # type: ignore[call-overload]

        # ── Update consecutive-failure circuit breaker ────────────────
        # Each supervisor iteration checks the result of the previous stage.
        # If the same WP failed, increment its counter; reset it on success.
        prev_wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]
        prev_success: bool = state.get("stage_success", True)  # type: ignore[call-overload]
        cf: dict = dict(state.get("consecutive_failures", {}))  # type: ignore[call-overload]
        if prev_wp_id:
            if not prev_success:
                cf[prev_wp_id] = cf.get(prev_wp_id, 0) + 1
                log.debug(
                    "Consecutive failure counter for WP %s: %d",
                    prev_wp_id,
                    cf[prev_wp_id],
                )
            else:
                # Reset counter when the WP completes a stage successfully.
                cf.pop(prev_wp_id, None)

        log.debug(
            "Supervisor iteration %d/%d for project %s",
            new_iteration,
            max_iterations,
            project_path,
        )

        # ── Safety limit ─────────────────────────────────────────────
        if new_iteration > max_iterations:
            ts = datetime.now(UTC).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="safety_limit",
                destination=str(END),
                iteration=new_iteration,
                level="WARNING",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=END,
                update={
                    "iteration": new_iteration,
                    "current_stage": "supervisor",
                    "run_log": [log_entry],
                    "errors": [
                        {
                            "timestamp": ts,
                            "message": (
                                f"Safety limit reached: iteration {new_iteration} "
                                f"exceeds max_iterations {max_iterations}."
                            ),
                        }
                    ],
                },
            )

        # ── Read ledger state ─────────────────────────────────────────
        try:
            status_data = await _call_tool("ledger_get_project_status", project_path=project_path)
        except Exception as exc:
            log.error("Failed to read project status: %s", exc)
            ts = datetime.now(UTC).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="mcp_error",
                destination=str(END),
                error=str(exc),
                level="ERROR",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=END,
                update={
                    "iteration": new_iteration,
                    "current_stage": "supervisor",
                    "run_log": [log_entry],
                    "errors": [{"timestamp": ts, "message": str(exc)}],
                },
            )

        wp_list_error: str | None = None
        try:
            wp_list_data = await _call_tool("ledger_list_work_packages", project_path=project_path)
        except Exception as exc:
            log.error("Failed to list work packages: %s", exc)
            wp_list_error = str(exc)
            wp_list_data = []

        # Normalise: tool may return list or dict with "work_packages" key.
        if isinstance(wp_list_data, dict):
            wp_summaries: list = wp_list_data.get("work_packages", [])
        elif isinstance(wp_list_data, list):
            wp_summaries = wp_list_data
        else:
            wp_summaries = []

        pending_count = sum(
            1 for wp in wp_summaries if wp.get("status") not in _TERMINAL_STATUSES
        )

        base_update: dict[str, Any] = {
            "iteration": new_iteration,
            "current_stage": "supervisor",
            "project_status": json.dumps(status_data),
            "wp_summaries": wp_summaries,
            "pending_wp_count": pending_count,
            "consecutive_failures": cf,
        }

        # ── No WPs → PM needs to create them ─────────────────────────
        if not wp_summaries:
            extra_entries: list = []
            extra_errs: list = []
            if wp_list_error:
                ts = datetime.now(UTC).isoformat()
                err_entry = _log_entry(
                    stage="supervisor",
                    wp_id="",
                    action="mcp_error",
                    destination=_DEST_PM,
                    error=wp_list_error,
                    level="WARNING",
                )
                if run_logger:
                    run_logger.stream_entry(err_entry)
                extra_entries.append(err_entry)
                extra_errs.append({
                    "timestamp": ts,
                    "message": f"ledger_list_work_packages failed: {wp_list_error}",
                })
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_PM,
                reason="no work packages found",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=_DEST_PM,
                update={
                    **base_update,
                    "current_stage": _DEST_PM,
                    "run_log": extra_entries + [log_entry],
                    "errors": extra_errs,
                },
            )

        # ── All WPs terminal (COMPLETE or CANCELLED) → synthesis ───────────────────
        if all(wp.get("status") in _TERMINAL_STATUSES for wp in wp_summaries):
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_SYNTHESIS,
                reason="all work packages terminal (COMPLETE or CANCELLED)",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=_DEST_SYNTHESIS,
                update={
                    **base_update,
                    "current_stage": _DEST_SYNTHESIS,
                    "run_log": [log_entry],
                },
            )

        # ── Route via ledger_get_next_action (single source of truth) ────────
        # Query each agent role in turn.  The first role that returns a
        # dispatchable action wins; the supervisor routes to that stage.
        # All roles returning WAIT means nothing is actionable → synthesis.

        extra_log_entries: list = []
        extra_errors: list = []

        for role in _ROLES:
            try:
                action_data = await _call_tool(
                    "ledger_get_next_action",
                    project_path=project_path,
                    agent_role=role,
                )
            except Exception as exc:
                log.warning(
                    "Failed to get next action for role %s: %s; skipping.", role, exc
                )
                continue

            if not isinstance(action_data, dict):
                log.warning(
                    "Unexpected response shape from ledger_get_next_action for "
                    "role %s; treating as WAIT.",
                    role,
                )
                continue

            action: str = action_data.get("action", "") or ""
            wp_id: str = action_data.get("work_package_id", "") or ""

            # Nothing to do for this role right now.
            if action in _SKIP_ACTIONS:
                continue

            # Forward-compatibility: unrecognised action strings → WAIT.
            if action not in _DISPATCH_ACTIONS:
                log.warning(
                    "Unrecognised action %r for role %s; treating as WAIT.",
                    action,
                    role,
                )
                continue

            # Circuit breaker: skip WPs with too many consecutive failures.
            if wp_id:
                consecutive = cf.get(wp_id, 0)
                if consecutive >= 3:
                    ts = datetime.now(UTC).isoformat()
                    log.warning(
                        "WP %s halted: %d consecutive failures — skipping to prevent loop.",
                        wp_id,
                        consecutive,
                    )
                    entry = _log_entry(
                        stage="supervisor",
                        wp_id=wp_id,
                        action="halted_repeated_failure",
                        destination=str(END),
                        consecutive_failures=consecutive,
                        level="WARNING",
                    )
                    if run_logger:
                        run_logger.stream_entry(entry)
                    extra_log_entries.append(entry)
                    extra_errors.append({
                        "timestamp": ts,
                        "message": (
                            f"WP {wp_id} halted after {consecutive} consecutive failures — "
                            "it will not be re-dispatched in this run."
                        ),
                    })
                    continue

            destination = _ROLE_STAGE_MAP.get(role)
            if destination is None:
                log.warning("No stage mapped for role %r; skipping.", role)
                continue

            log_entry = _log_entry(
                stage="supervisor",
                wp_id=wp_id,
                action="route",
                destination=destination,
                agent_role=role,
                ledger_action=action,
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            log.info(
                "Routing WP %s (role=%s, action=%s) → %s", wp_id, role, action, destination
            )
            return Command(
                goto=destination,
                update={
                    **base_update,
                    "current_wp_id": wp_id,
                    "current_stage": destination,
                    "run_log": extra_log_entries + [log_entry],
                    "errors": extra_errors,
                },
            )

        # ── All roles returned WAIT/skip → route to synthesis ─────────────────
        log_entry = _log_entry(
            stage="supervisor",
            wp_id="",
            action="route",
            destination=_DEST_SYNTHESIS,
            reason="all roles returned WAIT",
        )
        if run_logger:
            run_logger.stream_entry(log_entry)
        return Command(
            goto=_DEST_SYNTHESIS,
            update={
                **base_update,
                "current_stage": _DEST_SYNTHESIS,
                "run_log": extra_log_entries + [log_entry],
                "errors": extra_errors,
            },
        )

    return supervisor_node

