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

    def _call_tool(name: str, **kwargs: Any) -> Any:
        """Invoke an MCP tool by name and return the parsed JSON response."""
        tool = tools_by_name.get(name)
        if tool is None:
            raise RuntimeError(
                f"MCP tool {name!r} not found. "
                f"Available: {sorted(tools_by_name)}"
            )
        raw = tool.invoke(kwargs)
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
        Return which stage should handle *wp_detail* next, or ``None`` if done.

        Implements the pipeline-state decision tree from the WP-003 spec.
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
        if impl_status == "FAIL":
            return _DEST_DEVELOPER
        if impl_status == "PASS" and qa_status is None:
            return _DEST_QA
        if qa_status == "FAIL":
            return _DEST_DEVELOPER
        if qa_status == "PASS" and cr_status is None:
            return _DEST_REVIEWER
        if cr_status == "FAIL":
            return _DEST_DEVELOPER
        if cr_status == "PASS" and doc_status is None:
            return _DEST_DOCS
        if doc_status == "FAIL":
            return _DEST_DOCS
        # All pipelines PASS — WP is complete.
        return None

    # ------------------------------------------------------------------
    # The node function itself
    # ------------------------------------------------------------------

    def supervisor_node(state: WorkflowState) -> Command:
        """Deterministic routing node — pure Python, no LLM calls."""
        project_path: str = state["project_path"]
        new_iteration: int = state.get("iteration", 0) + 1  # type: ignore[call-overload]
        max_iterations: int = state.get("max_iterations", 100)  # type: ignore[call-overload]

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
            status_data = _call_tool("ledger_get_project_status", project_path=project_path)
        except Exception as exc:
            log.error("Failed to read project status: %s", exc)
            ts = datetime.now(timezone.utc).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="mcp_error",
                destination=str(END),
                error=str(exc),
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
            wp_list_data = _call_tool("ledger_list_work_packages", project_path=project_path)
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
        for wp_summary in actionable:
            wp_id: str = wp_summary.get("work_package_id", "")
            try:
                wp_detail = _call_tool(
                    "ledger_get_work_package",
                    project_path=project_path,
                    work_package_id=wp_id,
                )
            except Exception as exc:
                log.warning("Failed to fetch WP %s detail: %s; skipping.", wp_id, exc)
                continue

            destination = _route_for_wp(wp_detail)
            if destination is None:
                # WP is done — continue to the next one.
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
                    "run_log": [log_entry],
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
                "run_log": [log_entry],
            },
        )

    return supervisor_node
