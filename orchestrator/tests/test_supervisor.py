"""
test_supervisor.py — Unit tests for the supervisor routing logic.

Tests verify deterministic routing for all paths in the decision tree,
using mock MCP tools that return pre-configured ledger state.

No LLM calls, no MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.supervisor import make_supervisor_node


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_tool(name: str, return_value: Any) -> MagicMock:
    """Return a mock LangChain Tool that returns *return_value* when ainvoked."""
    tool = MagicMock()
    tool.name = name
    tool.ainvoke = AsyncMock(
        return_value=json.dumps(return_value) if not isinstance(return_value, str) else return_value
    )
    return tool


def make_mcp_tools(
    *,
    project_status: dict | None = None,
    wp_list: list | None = None,
    wp_details: dict[str, dict] | None = None,
) -> list[MagicMock]:
    """
    Build a minimal set of mock MCP tools: project_status, list_work_packages,
    and per-WP detail lookups.

    Parameters
    ----------
    project_status:
        Dict returned by ``ledger_get_project_status``.
    wp_list:
        List returned by ``ledger_list_work_packages``.
    wp_details:
        Dict mapping WP ID → detail dict returned by ``ledger_get_work_package``.
    """
    if project_status is None:
        project_status = {"status": "IN_PROGRESS"}
    if wp_list is None:
        wp_list = []
    if wp_details is None:
        wp_details = {}

    status_tool = make_tool("ledger_get_project_status", project_status)
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        detail = wp_details.get(wp_id, {"work_package_id": wp_id, "pipelines": []})
        return json.dumps(detail)

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    return [status_tool, list_tool, detail_tool]


def base_state(
    iteration: int = 0,
    max_iterations: int = 10,
    project_path: str = "/project",
) -> dict:
    """Minimal WorkflowState-compatible dict for test invocations."""
    return {
        "project_path": project_path,
        "plan_file": "plan.md",
        "target_project_path": "/target",
        "current_stage": "",
        "current_wp_id": "",
        "iteration": iteration,
        "max_iterations": max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "run_log": [],
        "errors": [],
    }


def wp_summary(wp_id: str, status: str = "READY") -> dict:
    return {"work_package_id": wp_id, "status": status}


def wp_with_pipelines(wp_id: str, pipelines: list[dict]) -> dict:
    return {"work_package_id": wp_id, "pipelines": pipelines}


def pipeline(type_: str, status: str) -> dict:
    return {"type": type_, "status": status}


# ---------------------------------------------------------------------------
# Tests: routing to "pm"
# ---------------------------------------------------------------------------

class TestRouteToPM:
    async def test_no_wps_routes_to_pm(self):
        """When no WPs exist, route to PM."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"
        assert cmd.update["current_stage"] == "pm"
        assert cmd.update["run_log"][0]["destination"] == "pm"


# ---------------------------------------------------------------------------
# Tests: routing to "developer"
# ---------------------------------------------------------------------------

class TestRouteToDeveloper:
    async def test_wp_with_no_pipelines_routes_to_developer(self):
        """A READY WP with no pipelines routes to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_implementation_fail_routes_to_developer(self):
        """A FAIL implementation pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "FAIL")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_qa_fail_routes_to_developer(self):
        """A FAIL QA pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_code_review_fail_routes_to_developer(self):
        """A FAIL code-review pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("code-review", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "qa"
# ---------------------------------------------------------------------------

class TestRouteToQA:
    async def test_pass_impl_no_qa_routes_to_qa(self):
        """A PASS implementation with no QA pipeline routes to qa."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "PASS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "qa"


# ---------------------------------------------------------------------------
# Tests: routing to "reviewer"
# ---------------------------------------------------------------------------

class TestRouteToReviewer:
    async def test_pass_qa_no_review_routes_to_reviewer(self):
        """A PASS QA with no code-review pipeline routes to reviewer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "reviewer"


# ---------------------------------------------------------------------------
# Tests: routing to "docs"
# ---------------------------------------------------------------------------

class TestRouteToDocs:
    async def test_pass_review_no_docs_routes_to_docs(self):
        """A PASS code-review with no documentation pipeline routes to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("code-review", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: routing to "synthesis"
# ---------------------------------------------------------------------------

class TestRouteToSynthesis:
    async def test_all_complete_routes_to_synthesis(self):
        """When all WPs are COMPLETE, route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_all_pipelines_pass_routes_to_synthesis(self):
        """All four pipelines PASS → WP considered done → synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("documentation", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"


# ---------------------------------------------------------------------------
# Tests: END conditions
# ---------------------------------------------------------------------------

class TestSafetyLimit:
    async def test_exceeds_max_iterations_routes_to_end(self):
        """When iteration > max_iterations, route to END with error."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # iteration=10, max_iterations=10 → new_iteration=11 > 10
        cmd = await node(base_state(iteration=10, max_iterations=10))

        assert cmd.goto == END
        assert cmd.update["errors"]
        assert "Safety limit" in cmd.update["errors"][0]["message"]

    async def test_at_max_iterations_still_routes_to_end(self):
        """Edge case: iteration == max_iterations triggers safety limit on next call."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # new_iteration will be max_iterations + 1 = 6
        cmd = await node(base_state(iteration=5, max_iterations=5))

        assert cmd.goto == END


class TestAllBlocked:
    async def test_all_blocked_routes_to_end(self):
        """When all WPs are BLOCKED and nothing is actionable, route to END."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "BLOCKED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == END
        assert cmd.update["errors"]


# ---------------------------------------------------------------------------
# Tests: BLOCKED WPs skipped, unblocked processed first
# ---------------------------------------------------------------------------

class TestBlockedSkipped:
    async def test_blocked_wp_is_skipped(self):
        """BLOCKED WPs are skipped; the READY WP gets processed."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Should route WP-002 (READY, no pipelines) to developer — not WP-001.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-002"

    async def test_in_progress_processed_before_ready(self):
        """IN_PROGRESS WP is prioritised over READY WP."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "READY"),
                wp_summary("WP-002", "IN_PROGRESS"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update["current_wp_id"] == "WP-002"


# ---------------------------------------------------------------------------
# Tests: run_log and state update
# ---------------------------------------------------------------------------

class TestRunLog:
    async def test_routing_decision_logged_in_run_log(self):
        """Every routing decision must be recorded in run_log."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update["run_log"], "run_log should be non-empty"
        entry = cmd.update["run_log"][0]
        assert "destination" in entry
        assert "timestamp" in entry
        assert "action" in entry

    async def test_state_iteration_incremented(self):
        """Supervisor must increment the iteration counter on every pass."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state(iteration=3))

        assert cmd.update["iteration"] == 4


# ---------------------------------------------------------------------------
# Tests: IN_PROGRESS pipeline skipping
# ---------------------------------------------------------------------------

class TestInFlightSkip:
    async def test_wp_with_in_progress_impl_skips_to_end(self):
        """WP with an IN_PROGRESS implementation pipeline is skipped; if it is
        the only actionable WP the supervisor routes to END (not synthesis)."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "IN_PROGRESS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Single actionable WP is in-flight → route to END, not synthesis.
        assert cmd.goto == END

    async def test_in_progress_wp_skipped_ready_wp_processed(self):
        """An in-flight WP is skipped; the other actionable READY WP is processed."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "IN_PROGRESS"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001", [pipeline("implementation", "IN_PROGRESS")]
                ),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-002"


# ---------------------------------------------------------------------------
# Tests: circuit breaker (consecutive failures)
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    async def test_wp_halted_after_three_consecutive_failures(self):
        """After 3 consecutive failures for a WP, supervisor halts → END."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}  # already at threshold

        cmd = await node(state)

        assert cmd.goto == END
        errors = cmd.update.get("errors", [])
        assert any("halted" in str(e).lower() or "WP-001" in str(e) for e in errors), (
            "Expected a halted error entry for WP-001"
        )

    async def test_consecutive_failures_counter_incremented_on_failure(self):
        """Counter in base_update['consecutive_failures'] increments on failure."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 1}  # already had 1 failure

        cmd = await node(state)

        # Supervisor reads from consecutive_failures, cf["WP-001"] should now be 2.
        cf = cmd.update.get("consecutive_failures", {})
        assert cf.get("WP-001", 0) == 2, f"Expected cf['WP-001']=2, got {cf}"

    async def test_consecutive_failures_reset_on_success(self):
        """Counter is reset in base_update when the previous stage succeeded."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = True  # succeeded
        state["consecutive_failures"] = {"WP-001": 2}  # had 2 prior failures

        cmd = await node(state)

        cf = cmd.update.get("consecutive_failures", {})
        assert "WP-001" not in cf, f"Expected WP-001 counter reset, got {cf}"


# ---------------------------------------------------------------------------
# Tests: level field in log entries
# ---------------------------------------------------------------------------

class TestLogEntryLevel:
    async def test_routing_log_entry_has_level_info(self):
        """All routing log entries must include 'level': 'INFO'."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        for entry in cmd.update.get("run_log", []):
            assert "level" in entry, f"Log entry missing 'level' field: {entry}"
            assert entry["level"] in ("INFO", "WARNING", "ERROR"), (
                f"Unexpected level value: {entry['level']}"
            )


# ---------------------------------------------------------------------------
# Tests: no-LLM guarantee (structural)
# ---------------------------------------------------------------------------

class TestNoLLMCalls:
    def test_supervisor_does_not_import_llm_libs(self):
        """supervisor module must not import anthropic/openai/google-genai."""
        import ast
        import inspect
        import src.supervisor as sup_module

        source = inspect.getsource(sup_module)
        tree = ast.parse(source)
        forbidden = {"anthropic", "openai", "langchain_anthropic", "langchain_google_genai"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else ([node.module] if node.module else [])
                )
                for name in names:
                    assert name not in forbidden, (
                        f"supervisor imports LLM library: {name}"
                    )
