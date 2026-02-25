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
from datetime import datetime, timezone
from typing import Any

from langgraph.types import Command

from .state import WorkflowState

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Routing destination constants
# ---------------------------------------------------------------------------

_DEST_PM = "pm"
_DEST_DEVELOPER = "developer"
_DEST_QA = "qa"
_DEST_REVIEWER = "reviewer"
_DEST_DOCS = "docs"
_DEST_SYNTHESIS = "synthesis"

# Sentinel returned by _route_for_wp when a pipeline is actively IN_PROGRESS.
# Distinct from None ("WP is fully done") so the supervisor can distinguish
# between "skip this WP because it is finished" and "skip this WP because
# something is already running on it".
_SKIP_IN_FLIGHT = "__in_flight__"

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
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "wp_id": wp_id,
            "action": action,
            "destination": destination,
            "level": "INFO",  # default; callers may override via **extra
            **extra,
        }

    def _get_latest_pipeline(wp_detail: dict, pipeline_type: str) -> dict | None:
        """Return the most-recent pipeline of *pipeline_type*, or ``None``."""
        for pipeline in reversed(wp_detail.get("pipelines", [])):
            if pipeline.get("type") == pipeline_type:
                return pipeline
        return None

    def _route_for_wp(wp_detail: dict) -> str | None:
        """
        Return which stage should handle *wp_detail* next.

        Return values:
        - A destination string (e.g. ``_DEST_DEVELOPER``) — dispatch to that stage.
        - ``_SKIP_IN_FLIGHT`` — a pipeline is currently IN_PROGRESS; caller should
          skip this WP and NOT route to synthesis until the pipeline completes.
        - ``None`` — all pipelines are PASS; this WP is fully done.

        Implements the pipeline-state decision tree from the WP-001 spec.
        """

        def latest_status(ptype: str) -> str | None:
            p = _get_latest_pipeline(wp_detail, ptype)
            return p.get("status") if p else None

        pipelines = wp_detail.get("pipelines", [])
        impl_status = latest_status("implementation")
        qa_status = latest_status("qa")
        cr_status = latest_status("code-review")
        doc_status = latest_status("documentation")

        if not pipelines or impl_status is None:
            return _DEST_DEVELOPER
        if impl_status == "IN_PROGRESS":
            # Implementation pipeline is still running — do not re-dispatch.
            return _SKIP_IN_FLIGHT
        if impl_status == "FAIL":
            return _DEST_DEVELOPER
        if impl_status == "PASS" and qa_status is None:
            return _DEST_QA
        if qa_status == "IN_PROGRESS":
            return _SKIP_IN_FLIGHT
        if qa_status == "FAIL":
            return _DEST_DEVELOPER
        if qa_status == "PASS" and cr_status is None:
            return _DEST_REVIEWER
        if cr_status == "IN_PROGRESS":
            return _SKIP_IN_FLIGHT
        if cr_status == "FAIL":
            return _DEST_DEVELOPER
        if cr_status == "PASS" and doc_status is None:
            return _DEST_DOCS
        if doc_status == "IN_PROGRESS":
            return _SKIP_IN_FLIGHT
        if doc_status == "FAIL":
            return _DEST_DOCS
        # All pipelines PASS — WP is complete.
        return None

    # ------------------------------------------------------------------
    # The node function itself
    # ------------------------------------------------------------------

    async def supervisor_node(state: WorkflowState) -> Command:
        """Deterministic routing node — pure Python, no LLM calls."""
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
            ts = datetime.now(timezone.utc).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="safety_limit",
                destination=str(END),
                iteration=new_iteration,
                level="WARNING",
            )
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
            ts = datetime.now(timezone.utc).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="mcp_error",
                destination=str(END),
                error=str(exc),
                level="ERROR",
            )
            return Command(
                goto=END,
                update={
                    "iteration": new_iteration,
                    "current_stage": "supervisor",
                    "run_log": [log_entry],
                    "errors": [{"timestamp": ts, "message": str(exc)}],
                },
            )

        try:
            wp_list_data = await _call_tool("ledger_list_work_packages", project_path=project_path)
        except Exception as exc:
            log.error("Failed to list work packages: %s", exc)
            wp_list_data = []

        # Normalise: tool may return list or dict with "work_packages" key.
        if isinstance(wp_list_data, dict):
            wp_summaries: list = wp_list_data.get("work_packages", [])
        elif isinstance(wp_list_data, list):
            wp_summaries = wp_list_data
        else:
            wp_summaries = []

        pending_count = sum(
            1 for wp in wp_summaries if wp.get("status") != "COMPLETE"
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
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_PM,
                reason="no work packages found",
            )
            return Command(
                goto=_DEST_PM,
                update={**base_update, "current_stage": _DEST_PM, "run_log": [log_entry]},
            )

        # ── All WPs COMPLETE → synthesis ──────────────────────────────
        if all(wp.get("status") == "COMPLETE" for wp in wp_summaries):
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_SYNTHESIS,
                reason="all work packages COMPLETE",
            )
            return Command(
                goto=_DEST_SYNTHESIS,
                update={
                    **base_update,
                    "current_stage": _DEST_SYNTHESIS,
                    "run_log": [log_entry],
                },
            )

        # ── Collect actionable WPs (IN_PROGRESS first, then READY) ────
        actionable: list[dict] = [
            wp for wp in wp_summaries if wp.get("status") == "IN_PROGRESS"
        ] + [
            wp for wp in wp_summaries if wp.get("status") == "READY"
        ]

        # ── All BLOCKED with no actionable WPs ───────────────────────
        if not actionable:
            blocked_count = sum(
                1 for wp in wp_summaries if wp.get("status") == "BLOCKED"
            )
            ts = datetime.now(timezone.utc).isoformat()
            if blocked_count:
                log_entry = _log_entry(
                    stage="supervisor",
                    wp_id="",
                    action="halt",
                    destination=str(END),
                    reason="all work packages are BLOCKED",
                )
                return Command(
                    goto=END,
                    update={
                        **base_update,
                        "run_log": [log_entry],
                        "errors": [
                            {"timestamp": ts, "message": "All WPs blocked — no progress possible."}
                        ],
                    },
                )
            # Mixed state with no actionable and no BLOCKED → synthesise.
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_SYNTHESIS,
                reason="no actionable WPs remaining",
            )
            return Command(
                goto=_DEST_SYNTHESIS,
                update={
                    **base_update,
                    "current_stage": _DEST_SYNTHESIS,
                    "run_log": [log_entry],
                },
            )

        # ── Inspect each actionable WP ────────────────────────────────
        # Tracks WPs that were skipped because a pipeline is in-flight or
        # because the circuit breaker tripped.  If ALL actionable WPs end up
        # in this bucket the run should stop rather than route to synthesis.
        skip_count: int = 0
        wps_done_count: int = 0  # WPs confirmed fully done in this supervisor pass
        extra_log_entries: list = []
        extra_errors: list = []

        for wp_summary in actionable:
            wp_id: str = wp_summary.get("work_package_id", "")

            # ── Circuit breaker ──────────────────────────────────────────
            consecutive = cf.get(wp_id, 0)
            if consecutive >= 3:
                ts = datetime.now(timezone.utc).isoformat()
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
                extra_log_entries.append(entry)
                extra_errors.append({
                    "timestamp": ts,
                    "message": (
                        f"WP {wp_id} halted after {consecutive} consecutive failures — "
                        "it will not be re-dispatched in this run."
                    ),
                })
                skip_count += 1
                continue

            try:
                wp_detail = await _call_tool(
                    "ledger_get_work_package",
                    project_path=project_path,
                    work_package_id=wp_id,
                )
            except Exception as exc:
                log.warning("Failed to fetch WP %s detail: %s; skipping.", wp_id, exc)
                continue

            destination = _route_for_wp(wp_detail)

            if destination is None:
                # WP is fully done (all pipelines PASS) — continue to the next.
                wps_done_count += 1
                continue

            if destination == _SKIP_IN_FLIGHT:
                # A pipeline is currently running — don't re-dispatch.
                log.debug("WP %s has an in-flight pipeline; skipping this iteration.", wp_id)
                skip_count += 1
                continue

            log_entry = _log_entry(
                stage="supervisor",
                wp_id=wp_id,
                action="route",
                destination=destination,
                wp_status=wp_summary.get("status"),
            )
            log.info("Routing WP %s → %s", wp_id, destination)
            return Command(
                goto=destination,
                update={
                    **base_update,
                    "current_wp_id": wp_id,
                    "current_stage": destination,
                    "wps_completed_this_run": state.get("wps_completed_this_run", 0) + wps_done_count,  # type: ignore[call-overload]
                    "run_log": extra_log_entries + [log_entry],
                    "errors": extra_errors,
                },
            )

        # ── End of actionable WP loop ─────────────────────────────────
        # If every actionable WP was skipped (all in-flight or circuit-broken),
        # route to __end__ instead of synthesis so the run ends cleanly rather
        # than producing a misleading synthesis report.
        if skip_count == len(actionable) and skip_count > 0:
            ts = datetime.now(timezone.utc).isoformat()
            reason = "all actionable WPs have in-flight pipelines or repeated failures"
            log.info("Supervisor halting: %s", reason)
            halt_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="halt",
                destination=str(END),
                reason=reason,
                level="WARNING",
            )
            return Command(
                goto=END,
                update={
                    **base_update,
                    "wps_completed_this_run": state.get("wps_completed_this_run", 0) + wps_done_count,  # type: ignore[call-overload]
                    "run_log": extra_log_entries + [halt_entry],
                    "errors": extra_errors + [{
                        "timestamp": ts,
                        "message": f"Run halted: {reason}.",
                    }],
                },
            )

        # ── All actionable WPs processed → synthesis ──────────────────
        log_entry = _log_entry(
            stage="supervisor",
            wp_id="",
            action="route",
            destination=_DEST_SYNTHESIS,
            reason="all actionable WPs fully processed",
        )
        return Command(
            goto=_DEST_SYNTHESIS,
            update={
                **base_update,
                "current_stage": _DEST_SYNTHESIS,
                "wps_completed_this_run": state.get("wps_completed_this_run", 0) + wps_done_count,  # type: ignore[call-overload]
                "run_log": extra_log_entries + [log_entry],
                "errors": extra_errors,
            },
        )

    return supervisor_node
