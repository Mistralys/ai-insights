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

from src.config import FAIL_ROUTING_AGENT_MAP, PIPELINE_AGENT_MAP
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


def _derive_next_action(
    agent_role: str, wp_list: list, wp_details: dict[str, dict]
) -> dict:
    """
    Simulate what ``ledger_get_next_action`` would return for a given
    agent role based on WP pipeline state.

    Used exclusively by test mocks — not production code.

    **Drift risk:** This helper re-implements a subset of the MCP server's
    ``ledger_get_next_action`` routing logic.  One sync point must be kept
    up to date whenever the workflow changes:

    1. **Action vocabulary** (``IMPLEMENT``, ``RUN_QA``, ``REWORK``, etc.):
       authoritative source is ``mcp-server/src/utils/constants.ts``
       (``AGENT_ACTIONS`` / ``_DISPATCH_ACTIONS``).

    Both PASS-branch and FAIL-branch routing targets are derived
    programmatically from ``PIPELINE_AGENT_MAP`` /
    ``FAIL_ROUTING_AGENT_MAP`` (``shared/workflow-manifest.json``) and
    do not require manual synchronisation.
    """

    def latest(pipelines: list, ptype: str) -> str | None:
        for p in reversed(pipelines):
            if p.get("type") == ptype:
                return p.get("status")
        return None

    non_terminal = [
        wp
        for wp in wp_list
        if wp.get("status") not in ("COMPLETE", "CANCELLED")
    ]

    # All non-terminal WPs BLOCKED → PM handles repair.
    if non_terminal and all(wp.get("status") == "BLOCKED" for wp in non_terminal):
        if agent_role == "Project Manager":
            return {"action": "REPAIR_ORPHAN_BLOCKED"}
        return {"action": "WAIT"}

    # IN_PROGRESS WPs first (matches MCP server priority), then READY.
    ordered = (
        [wp for wp in wp_list if wp.get("status") == "IN_PROGRESS"]
        + [wp for wp in wp_list if wp.get("status") == "READY"]
    )

    for wp_summary in ordered:
        wp_id = wp_summary.get("work_package_id", "")
        if wp_summary.get("status") in ("COMPLETE", "CANCELLED", "BLOCKED"):
            continue

        wp_detail = wp_details.get(wp_id, wp_summary)
        pipelines = wp_detail.get("pipelines", [])

        impl = latest(pipelines, "implementation")
        qa = latest(pipelines, "qa")
        sa = latest(pipelines, "security-audit")
        cr = latest(pipelines, "code-review")
        re = latest(pipelines, "release-engineering")
        doc = latest(pipelines, "documentation")

        if impl is None:
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "IMPLEMENT"
        elif impl == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "CONTINUE_PIPELINE"
        elif impl == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["implementation"], "REWORK"
        elif impl == "PASS" and qa is None:
            next_role, action = PIPELINE_AGENT_MAP["qa"], "RUN_QA"
        elif qa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["qa"], "CONTINUE_PIPELINE"
        elif qa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["qa"], "REWORK"
        elif qa == "PASS" and sa is None:
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "RUN_SECURITY_AUDIT"
        elif sa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "CONTINUE_PIPELINE"
        elif sa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["security-audit"], "REWORK"
        elif sa == "PASS" and cr is None:
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "RUN_REVIEW"
        elif cr == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "CONTINUE_PIPELINE"
        elif cr == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["code-review"], "REWORK"
        elif cr == "PASS" and re is None:
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "RUN_RELEASE_ENGINEERING"
        elif re == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "CONTINUE_PIPELINE"
        elif re == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["release-engineering"], "REWORK"
        elif re == "PASS" and doc is None:
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "WRITE_DOCS"
        elif doc == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "CONTINUE_PIPELINE"
        elif doc == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["documentation"], "REWORK"
        else:
            continue  # WP fully done

        if next_role == agent_role:
            return {"action": action, "work_package_id": wp_id}

    return {"action": "WAIT"}


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

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        result = _derive_next_action(role, wp_list, wp_details)
        return json.dumps(result)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


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
                        pipeline("security-audit", "PASS"),
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
        """A PASS QA and security-audit with no code-review pipeline routes to reviewer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "reviewer"


# ---------------------------------------------------------------------------
# Tests: routing to "security_auditor"
# ---------------------------------------------------------------------------

class TestRouteToSecurityAuditor:
    async def test_pass_qa_no_security_audit_routes_to_security_auditor(self):
        """A PASS QA with no security-audit pipeline routes to security_auditor."""
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

        assert cmd.goto == "security_auditor"

    async def test_security_audit_fail_routes_to_developer(self):
        """A FAIL security-audit pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "release_engineer"
# ---------------------------------------------------------------------------

class TestRouteToReleaseEngineer:
    async def test_pass_code_review_no_release_engineering_routes_to_release_engineer(self):
        """A PASS code-review with no release-engineering pipeline routes to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"

    async def test_release_engineering_fail_routes_to_release_engineer(self):
        """A FAIL release-engineering pipeline causes rework route to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"


# ---------------------------------------------------------------------------
# Tests: routing to "docs"
# ---------------------------------------------------------------------------

class TestDocumentationFail:
    async def test_documentation_fail_routes_to_docs(self):
        """A FAIL documentation pipeline causes rework route to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


class TestRouteToDocs:
    async def test_pass_review_no_docs_routes_to_docs(self):
        """A PASS code-review and release-engineering with no documentation
        pipeline routes to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
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
        assert cmd.update.get("current_wp_id") == ""

    async def test_routes_to_synthesis_when_all_wps_mix_of_complete_and_cancelled(self):
        """WPs that are a mix of COMPLETE and CANCELLED should route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
                wp_summary("WP-003", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_pending_count_excludes_cancelled_wps(self):
        """CANCELLED WPs must not be counted as pending (pending_count should be 0)."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update["pending_wp_count"] == 0
        assert cmd.update.get("current_wp_id") == ""

    async def test_all_pipelines_pass_routes_to_synthesis(self):
        """All six pipelines PASS → WP considered done → synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_synthesis_all_terminal_clears_stale_wp_id(self):
        """All-WPs-terminal synthesis path clears a stale current_wp_id."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-STALE"

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_synthesis_all_wait_clears_stale_wp_id(self):
        """All-roles-WAIT synthesis path clears a stale current_wp_id.

        WP-001 is IN_PROGRESS but circuit-broken (3 consecutive failures),
        so all roles skip it and the supervisor falls through to the
        all-roles-WAIT synthesis route.
        """
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-STALE"
        state["consecutive_failures"] = {"WP-001": 3}  # circuit-breaks WP-001 → all roles WAIT

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""


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
    async def test_all_blocked_routes_to_pm(self):
        """When all WPs are BLOCKED, ledger_get_next_action returns
        REPAIR_ORPHAN_BLOCKED for PM, routing to the pm stage."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "BLOCKED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"


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

        # WP-001 is BLOCKED (skipped by mock); WP-002 routes to developer.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-002"

    async def test_in_progress_processed_before_ready(self):
        """IN_PROGRESS WP is prioritised over READY WP by ledger_get_next_action."""
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

        # WP-002 (IN_PROGRESS) is prioritised — ledger returns it first.
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
    async def test_wp_with_in_progress_impl_routes_to_developer(
        self,
    ):
        """WP with an IN_PROGRESS implementation pipeline now routes to
        developer with CONTINUE_PIPELINE (ledger-driven) instead of being
        skipped to END as in the old hardcoded routing."""
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

        # Ledger returns CONTINUE_PIPELINE → routes to developer, not END.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_in_progress_impl_routed_first(self):
        """WP-001 has impl=IN_PROGRESS; both WPs need Developer.
        Ledger returns WP-001 first (IN_PROGRESS priority), so supervisor
        routes to developer for WP-001 not WP-002."""
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
        assert cmd.update["current_wp_id"] == "WP-001"


# ---------------------------------------------------------------------------
# Tests: circuit breaker (consecutive failures)
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    async def test_wp_halted_after_three_consecutive_failures(self):
        """After 3 consecutive failures for the only WP, supervisor
        circuit-breaks it, all roles return WAIT, and routes to synthesis."""
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

        # WP-001 circuit-broken → all roles skip it → route to synthesis.
        assert cmd.goto == "synthesis"
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
# Tests: halted WP cancellation before synthesis dispatch
# ---------------------------------------------------------------------------

class TestHaltedWPCancellation:
    """
    When all roles return WAIT/skip due to circuit-broken WPs, the supervisor
    must call ledger_update_work_package_status(CANCELLED) for each halted WP
    before routing to synthesis (§16.3 — automated circuit-breaker escalation).
    """

    def _make_tools_with_update_status(
        self,
        wp_list: list,
        wp_details: dict,
        update_status_calls: list,
        *,
        update_raises: Exception | None = None,
    ) -> list:
        """
        Build mock tools including ledger_update_work_package_status.
        The *update_status_calls* list is populated with each call's kwargs.
        """
        base_tools = make_mcp_tools(wp_list=wp_list, wp_details=wp_details)

        async def _update_status_side_effect(kwargs: dict) -> str:
            update_status_calls.append(dict(kwargs))
            if update_raises is not None:
                raise update_raises
            return json.dumps({"status": "CANCELLED"})

        update_tool = MagicMock()
        update_tool.name = "ledger_update_work_package_status"
        update_tool.ainvoke = AsyncMock(side_effect=_update_status_side_effect)

        return base_tools + [update_tool]

    async def test_halted_wp_is_cancelled_before_synthesis(self):
        """Halted WP (3 consecutive failures, IN_PROGRESS) is cancelled before
        routing to synthesis."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert update_calls, "ledger_update_work_package_status must have been called"
        call = update_calls[0]
        assert call.get("work_package_id") == "WP-001"
        assert call.get("status") == "CANCELLED"
        assert call.get("agent") == "Project Manager"

    async def test_cancellation_logged_as_warning(self):
        """Each cancelled WP must produce a WARNING-level run_log entry with
        action 'halted_wp_cancelled'."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        cancel_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "halted_wp_cancelled"
        ]
        assert cancel_entries, "run_log must contain a halted_wp_cancelled entry"
        entry = cancel_entries[0]
        assert entry["level"] == "WARNING"
        assert entry["wp_id"] == "WP-001"

    async def test_already_cancelled_wp_is_skipped_idempotent(self):
        """A WP that is already CANCELLED must not trigger another status update."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "CANCELLED")],  # already CANCELLED
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}

        # All WPs CANCELLED → hits the "all terminal" path; no update needed.
        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert not update_calls, (
            "ledger_update_work_package_status must NOT be called for already-CANCELLED WPs"
        )

    async def test_cancellation_failure_does_not_block_synthesis(self):
        """If ledger_update_work_package_status raises, synthesis routing must
        still proceed (graceful degradation)."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
            update_raises=RuntimeError("ledger tool failure"),
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        # Synthesis must still be reached despite the cancellation failure.
        assert cmd.goto == "synthesis"

    async def test_multiple_halted_wps_all_cancelled(self):
        """All halted WPs (not just the first) must be cancelled."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[
                wp_summary("WP-001", "IN_PROGRESS"),
                wp_summary("WP-002", "IN_PROGRESS"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3, "WP-002": 3}

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        cancelled_wp_ids = {c.get("work_package_id") for c in update_calls}
        assert "WP-001" in cancelled_wp_ids
        assert "WP-002" in cancelled_wp_ids


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


# ---------------------------------------------------------------------------
# Helper: direct action override (WP-005 additions)
# ---------------------------------------------------------------------------

def make_mcp_tools_with_actions(
    next_actions: dict[str, dict] | None = None,
    *,
    has_wps: bool = True,
) -> list[MagicMock]:
    """
    Build mock MCP tools where ``ledger_get_next_action`` returns explicit
    per-role responses from *next_actions*.  Roles not in the dict get
    ``{"action": "WAIT"}``.

    This lets action-routing tests bypass the ``_derive_next_action`` helper
    and directly exercise each action constant → stage mapping.

    Parameters
    ----------
    next_actions:
        Mapping ``{role: {"action": "...", "work_package_id": "..."}}`` for
        roles that should return a real action.  Defaults to ``{}`` (all WAIT).
    has_wps:
        When ``True`` a single non-terminal WP is included so the supervisor
        doesn't short-circuit to PM (no-WPs path) or synthesis (all-terminal).
        Set to ``False`` to test the no-WP → PM path independently.
    """
    _actions = next_actions or {}

    wp_list: list = (
        [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}] if has_wps else []
    )

    status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        return json.dumps({"work_package_id": wp_id, "pipelines": []})

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        response = _actions.get(role, {"action": "WAIT"})
        return json.dumps(response)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


# ---------------------------------------------------------------------------
# Tests: direct action → stage mapping (WP-005 AC3)
# ---------------------------------------------------------------------------

class TestDirectActionRouting:
    """Verify that every action constant in ``_DISPATCH_ACTIONS`` is routed
    to the correct pipeline stage by the supervisor.

    Each test uses ``make_mcp_tools_with_actions`` to inject a deterministic
    ``ledger_get_next_action`` response, bypassing the
    ``_derive_next_action`` simulation helper used elsewhere in this file.
    """

    @pytest.mark.parametrize("role,action,expected_stage", [
        # Developer actions
        ("Developer", "IMPLEMENT",          "developer"),
        ("Developer", "REWORK",             "developer"),
        ("Developer", "RESUME_OR_CANCEL",   "developer"),
        ("Developer", "CONTINUE_PIPELINE",  "developer"),
        ("Developer", "CLAIM_WP",           "developer"),
        # QA actions
        ("QA",        "RUN_QA",             "qa"),
        # Security Auditor actions
        ("Security Auditor",  "RUN_SECURITY_AUDIT",      "security_auditor"),
        # Reviewer actions
        ("Reviewer",  "RUN_REVIEW",         "reviewer"),
        # Release Engineer actions
        ("Release Engineer",  "RUN_RELEASE_ENGINEERING",  "release_engineer"),
        ("Release Engineer",  "REWORK",                   "release_engineer"),
        # Documentation actions
        ("Documentation", "WRITE_DOCS",     "docs"),
        ("Documentation", "FINALIZE_WP",    "docs"),
        ("Documentation", "UPDATE_CRITERIA","docs"),
        # PM actions
        ("Project Manager", "UNBLOCK_WP",          "pm"),
        ("Project Manager", "REVIEW_REWORK_LIMIT",  "pm"),
        ("Project Manager", "REPAIR_ORPHAN_BLOCKED","pm"),
        ("Project Manager", "REVIEW_STALE",         "pm"),
        ("Project Manager", "REVIEW_ABANDONED",     "pm"),
        ("Project Manager", "ROUTE_PIPELINE_AGENT", "pm"),  # fallback: no next_agent
    ])
    async def test_action_routes_to_correct_stage(
        self, role: str, action: str, expected_stage: str
    ):
        """Each (role, action) pair must dispatch to the correct stage."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == expected_stage, (
            f"role={role!r}, action={action!r}: expected {expected_stage!r}, "
            f"got {cmd.goto!r}"
        )

    @pytest.mark.parametrize("role,action,expected_stage", [
        ("Developer", "IMPLEMENT", "developer"),
        ("Documentation", "WRITE_DOCS", "docs"),
    ])
    async def test_current_wp_id_is_set_in_update(
        self, role: str, action: str, expected_stage: str
    ):
        """Supervisor must set current_wp_id to the WP ID from the action data."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-042"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update.get("current_wp_id") == "WP-042", (
            f"current_wp_id should be 'WP-042', got {cmd.update.get('current_wp_id')!r}"
        )

    async def test_first_dispatchable_role_wins(self):
        """When multiple roles have dispatchable actions, the first one in the
        role iteration order (PM → Developer → QA → Reviewer → Docs) wins."""
        # PM and Developer both have actions; PM is first in the loop.
        tools = make_mcp_tools_with_actions({
            "Project Manager": {"action": "UNBLOCK_WP", "work_package_id": "WP-001"},
            "Developer":       {"action": "IMPLEMENT",  "work_package_id": "WP-002"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # PM comes first in _ROLES order, so it should win.
        assert cmd.goto == "pm"


# ---------------------------------------------------------------------------
# Tests: ROUTE_PIPELINE_AGENT direct routing
# ---------------------------------------------------------------------------

class TestRoutePipelineAgent:
    """Verify that ROUTE_PIPELINE_AGENT uses the next_agent field to route
    directly to the target stage rather than back to PM."""

    async def test_route_pipeline_agent_qa_routes_to_qa_stage(self):
        """ROUTE_PIPELINE_AGENT with next_agent='QA' must route to 'qa' stage."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "QA",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "qa", (
            f"ROUTE_PIPELINE_AGENT next_agent='QA' should route to 'qa', got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_developer_routes_to_developer_stage(self):
        """ROUTE_PIPELINE_AGENT with next_agent='Developer' must route to 'developer' stage."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "Developer",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer", (
            f"ROUTE_PIPELINE_AGENT next_agent='Developer' should route to 'developer', "
            f"got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_unknown_next_agent_falls_back_to_pm(self):
        """ROUTE_PIPELINE_AGENT with an unknown next_agent must fall back to
        the queried role's stage (PM → 'pm')."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "UnknownRole",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm", (
            f"ROUTE_PIPELINE_AGENT with unknown next_agent should fall back to 'pm', "
            f"got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_missing_next_agent_falls_back_to_pm(self):
        """ROUTE_PIPELINE_AGENT with no next_agent field must fall back to
        the queried role's stage (PM → 'pm')."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                # no next_agent field
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm", (
            f"ROUTE_PIPELINE_AGENT with missing next_agent should fall back to 'pm', "
            f"got {cmd.goto!r}"
        )


# ---------------------------------------------------------------------------
# Tests: all-roles WAIT → synthesis (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestAllRolesWait:
    async def test_all_roles_wait_routes_to_synthesis(self):
        """When every role returns WAIT, supervisor falls through to synthesis."""
        # All roles get default WAIT (empty next_actions dict).
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis", (
            f"All-WAIT should route to synthesis, got {cmd.goto!r}"
        )

    async def test_all_roles_wait_with_in_progress_wp(self):
        """Even with an IN_PROGRESS WP, all-WAIT must route to synthesis."""
        tools = make_mcp_tools_with_actions({}, has_wps=True)
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_all_roles_wait_log_entry_records_reason(self):
        """All-WAIT routing log entry must mention 'all roles returned WAIT'."""
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        log_entries = cmd.update.get("run_log", [])
        assert any(
            "wait" in str(entry).lower() or "WAIT" in str(entry)
            for entry in log_entries
        ), f"No WAIT-related log entry found in: {log_entries}"


# ---------------------------------------------------------------------------
# Tests: WAIT-class action variants are skipped (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestWaitVariantsSkipped:
    """All actions in the _SKIP_ACTIONS frozenset must be treated exactly like
    WAIT — the role is skipped, no dispatch happens."""

    @pytest.mark.parametrize("skip_action", [
        "WAIT",
        "WAIT_FOR_REWORK",
        "WAIT_FOR_DOWNSTREAM",
        "WAIT_FOR_UPSTREAM_REWORK_LIMIT",
        "BLOCK_FOR_REWORK_LIMIT",
    ])
    async def test_skip_action_treated_as_wait(self, skip_action: str):
        """A SKIP-class action causes the role to be skipped; other roles or
        synthesis picks up the routing."""
        # Only Developer has an action; all others WAIT.
        # Developer's action is a SKIP variant → should not dispatch to developer.
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": skip_action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer action was skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"SKIP action {skip_action!r} should not dispatch; "
            f"expected synthesis, got {cmd.goto!r}"
        )


# ---------------------------------------------------------------------------
# Tests: unrecognised action treated as WAIT, no crash (WP-005 AC6)
# ---------------------------------------------------------------------------

class TestUnknownAction:
    async def test_unknown_action_does_not_crash(self):
        """An action string not in _DISPATCH_ACTIONS or _SKIP_ACTIONS must be
        treated as WAIT — no ValueError, no KeyError, no crash."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "FUTURE_ACTION_FROM_V99", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        # Must not raise.
        cmd = await node(base_state())

        # Unknown actions are skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis"

    async def test_unknown_action_all_roles_still_queried(self):
        """After one unknown action, remaining roles are still queried."""
        # Developer has unknown action, Documentation has real action.
        tools = make_mcp_tools_with_actions({
            "Developer":     {"action": "MYSTERY_ACTION",  "work_package_id": "WP-001"},
            "Documentation": {"action": "WRITE_DOCS",      "work_package_id": "WP-001"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer skipped (unknown) → Documentation dispatches → docs.
        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: circuit breaker skips recommended WP (WP-005 AC5)
# ---------------------------------------------------------------------------

class TestCircuitBreakerDirect:
    async def test_circuit_breaker_skips_wp_even_when_ledger_recommends(self):
        """When WP-001 has ≥3 consecutive failures, it must be skipped even if
        ledger_get_next_action returns IMPLEMENT for it."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        # WP-001 is circuit-broken → loop continues → all idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"Circuit-broken WP should cause synthesis fallback, got {cmd.goto!r}"
        )

    async def test_circuit_breaker_errors_list_contains_halted_message(self):
        """A circuit-broken WP must produce an error entry mentioning 'halted'."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-007"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-007": 3}

        cmd = await node(state)

        errors = cmd.update.get("errors", [])
        assert any("WP-007" in str(e) for e in errors), (
            f"Expected error mentioning WP-007 in {errors}"
        )
        assert any("halted" in str(e).lower() for e in errors), (
            f"Expected 'halted' in error messages; got: {errors}"
        )

    async def test_circuit_breaker_threshold_is_three(self):
        """Two consecutive failures (below threshold) must NOT trigger the breaker."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 2}  # one below threshold

        cmd = await node(state)

        # Not circuit-broken yet → dispatches to developer.
        assert cmd.goto == "developer"

    async def test_non_broken_wp_dispatches_while_broken_wp_skipped(self):
        """WP-002 (not broken) must be dispatched even if WP-001 is broken."""
        # Override to give WP-002 for second role, but that's hard in
        # the simple helper.  Instead use the state-based approach:
        # simulate Developer returning WP-002 after WP-001 is broken.
        # We monkey-patch the returned value to WP-001 only.
        seen_calls: list[str] = []

        async def _action_side_effect(kwargs: dict) -> str:
            role = kwargs.get("agent_role", "")
            seen_calls.append(role)
            # Return WP-001 for Developer (it will be circuit-broken).
            if role == "Developer":
                return json.dumps({"action": "IMPLEMENT", "work_package_id": "WP-001"})
            # QA gets a fully-new WP-002 (not broken).
            if role == "QA":
                return json.dumps({"action": "RUN_QA", "work_package_id": "WP-002"})
            return json.dumps({"action": "WAIT"})

        wp_list = [
            {"work_package_id": "WP-001", "status": "IN_PROGRESS"},
            {"work_package_id": "WP-002", "status": "IN_PROGRESS"},
        ]
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = make_tool("ledger_list_work_packages", wp_list)
        detail_tool = MagicMock()
        detail_tool.name = "ledger_get_work_package"
        detail_tool.ainvoke = AsyncMock(side_effect=lambda k: json.dumps(
            {"work_package_id": k.get("work_package_id", ""), "pipelines": []}
        ))
        next_action_tool = MagicMock()
        next_action_tool.name = "ledger_get_next_action"
        next_action_tool.ainvoke = AsyncMock(side_effect=_action_side_effect)

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool]
        )
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}  # WP-001 broken

        cmd = await node(state)

        # WP-001 skipped, WP-002/QA dispatches → qa.
        assert cmd.goto == "qa"
        assert cmd.update.get("current_wp_id") == "WP-002"


# ---------------------------------------------------------------------------
# Tests: progress_snapshot — WP-004 AC3, AC4
# ---------------------------------------------------------------------------

class TestProgressSnapshot:
    """progress_snapshot must be in every iteration's run_log."""

    async def test_progress_snapshot_in_run_log(self):
        """progress_snapshot must appear in run_log on every supervisor call."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots, "progress_snapshot entry expected in run_log"

    async def test_progress_snapshot_has_required_fields(self):
        """progress_snapshot must contain total_wps, status_breakdown, pending,
        iteration, max_iterations."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS"), wp_summary("WP-002", "READY")],
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state(iteration=2))

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        snap = snapshots[0]
        assert "total_wps" in snap
        assert snap["total_wps"] == 2
        assert "status_breakdown" in snap
        assert "pending" in snap
        assert snap["iteration"] == 3  # incremented from 2

    async def test_progress_snapshot_elapsed_s_omitted_without_run_start_ts(self):
        """elapsed_s must be absent (None) when run_start_ts is not in state."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        # No run_start_ts key.
        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        # elapsed_s should be None (not a number) when run_start_ts is absent.
        assert snapshots[0].get("elapsed_s") is None

    async def test_progress_snapshot_elapsed_s_computed_when_run_start_ts_set(self):
        """elapsed_s must be a non-negative float when run_start_ts is valid."""
        from datetime import UTC, datetime, timedelta

        # Set run_start_ts to 60 seconds ago.
        past_ts = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = past_ts

        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        elapsed = snapshots[0].get("elapsed_s")
        assert elapsed is not None, "elapsed_s must be present when run_start_ts is valid"
        assert isinstance(elapsed, (int, float))
        assert elapsed >= 0


# ---------------------------------------------------------------------------
# Tests: wp_status_change and wp_complete — WP-004 AC1, AC2
# ---------------------------------------------------------------------------

class TestWPStatusChangeEvents:
    """wp_status_change and wp_complete must fire on transitions."""

    async def test_wp_status_change_emitted_when_status_differs(self):
        """wp_status_change must appear when a WP's status differs from prev."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Simulate a previous iteration where WP-001 was READY.
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "READY"}]

        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_status_change"
        ]
        assert sc_entries, "wp_status_change entry expected in run_log"
        entry = sc_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["old_status"] == "READY"
        assert entry["new_status"] == "IN_PROGRESS"

    async def test_wp_status_change_not_emitted_when_unchanged(self):
        """wp_status_change must NOT fire when status is the same as previous."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Same status as current iteration.
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}]

        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_status_change"
        ]
        assert not sc_entries, "No wp_status_change expected when status unchanged"

    async def test_wp_complete_emitted_when_wp_transitions_to_complete(self):
        """wp_complete must be emitted when new_status == COMPLETE."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "COMPLETE")],
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}]

        cmd = await node(state)

        wc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_complete"
        ]
        assert wc_entries, "wp_complete entry expected when WP transitions to COMPLETE"
        assert wc_entries[0]["wp_id"] == "WP-001"

    async def test_wp_status_change_not_emitted_on_first_iteration(self):
        """No wp_status_change when prev_wp_summaries is empty (first iteration)."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # No prev_wp_summaries → first iteration.
        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") in ("wp_status_change", "wp_complete")
        ]
        assert not sc_entries, "No status-change events expected on first iteration"


# ---------------------------------------------------------------------------
# Tests: prev_wp_summaries stored in state — WP-004 AC7
# ---------------------------------------------------------------------------

class TestPrevWPSummariesStored:
    async def test_prev_wp_summaries_stored_in_base_update(self):
        """supervisor must store current wp_summaries as prev_wp_summaries."""
        wp_list = [wp_summary("WP-001", "READY"), wp_summary("WP-002", "IN_PROGRESS")]
        tools = make_mcp_tools(
            wp_list=wp_list,
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", [pipeline("implementation", "IN_PROGRESS")]),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        stored = cmd.update.get("prev_wp_summaries")
        assert stored is not None, "prev_wp_summaries must be in state update"
        # Should match what ledger_list_work_packages returned.
        stored_ids = {w.get("work_package_id") for w in stored}
        assert "WP-001" in stored_ids
        assert "WP-002" in stored_ids


# ---------------------------------------------------------------------------
# Tests: enriched route events — WP-004 AC5
# ---------------------------------------------------------------------------

class TestEnrichedRouteEvents:
    async def test_route_includes_prev_stage_and_prev_wp_id(self):
        """route log entry must include prev_stage and prev_wp_id."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_stage"] = "developer"
        state["current_wp_id"] = "WP-001"

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        assert route_entries
        entry = route_entries[0]
        assert "prev_stage" in entry, "route entry must include prev_stage"
        assert "prev_wp_id" in entry, "route entry must include prev_wp_id"
        assert "prev_result" in entry, "route entry must include prev_result"

    async def test_route_prev_result_pass_when_stage_success(self):
        """prev_result must be 'PASS' when prev stage succeeded and wp_id is set."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", [pipeline("implementation", "PASS")])
            },
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = True
        state["current_wp_id"] = "WP-001"

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        if route_entries:
            assert route_entries[0].get("prev_result") == "PASS"


# ---------------------------------------------------------------------------
# Tests: rework_detected event — WP-004 AC6
# ---------------------------------------------------------------------------

class TestReworkDetectedEvent:
    async def test_rework_detected_emitted_on_rework_action(self):
        """rework_detected must appear in run_log when supervisor dispatches REWORK."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "REWORK", "work_package_id": "WP-001",
                           "pipeline_type": "qa", "rework_count": 2}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        rd_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "rework_detected"
        ]
        assert rd_entries, "rework_detected entry expected in run_log for REWORK action"
        entry = rd_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["agent_role"] == "Developer"

    async def test_rework_detected_not_emitted_for_implement(self):
        """rework_detected must NOT appear for a normal IMPLEMENT action."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        rd_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "rework_detected"
        ]
        assert not rd_entries, "rework_detected must not appear for IMPLEMENT action"


# ---------------------------------------------------------------------------
# Tests: prev_result=FAIL and malformed run_start_ts — WP-006 AC2 / AC3
# ---------------------------------------------------------------------------

class TestEnrichedRouteEventsFailResult:
    """Extra coverage for enriched route-event fields added in WP-006."""

    async def test_route_prev_result_fail_when_stage_failed_with_wp_id(self):
        """prev_result must be 'FAIL' when stage_success=False and prev_wp_id
        is non-empty.  This exercises the 'FAIL if prev_wp_id' branch in the
        supervisor's _log_entry call for route events."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-002", "IN_PROGRESS")],
            wp_details={"WP-002": wp_with_pipelines("WP-002", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Simulate the previous stage having failed for WP-001.
        state["stage_success"] = False
        state["current_wp_id"] = "WP-001"  # non-empty prev_wp_id

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        assert route_entries, "route entry expected in run_log"
        entry = route_entries[0]
        assert entry.get("prev_result") == "FAIL", (
            f"Expected prev_result='FAIL', got {entry.get('prev_result')!r}"
        )

    async def test_route_prev_result_empty_when_stage_failed_but_no_prev_wp_id(self):
        """prev_result must be '' (empty string) when stage_success=False but
        prev_wp_id is also empty (first routing iteration with no prior WP).

        Uses a READY WP so the supervisor emits a role-dispatch route entry
        (the 'no work packages' path doesn't include prev_result at all).
        """
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = False
        state["current_wp_id"] = ""  # no previous wp_id

        cmd = await node(state)

        # Filter to the role-dispatch route entry (has prev_result).
        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route" and "prev_result" in e
        ]
        assert route_entries, "role-dispatch route entry with prev_result expected"
        entry = route_entries[0]
        assert entry.get("prev_result") == "", (
            f"Expected prev_result='', got {entry.get('prev_result')!r}"
        )


class TestProgressSnapshotMalformedTs:
    """elapsed_s must be None (not raise) when run_start_ts is a malformed string."""

    async def test_elapsed_s_none_when_run_start_ts_malformed(self):
        """Malformed run_start_ts must cause elapsed_s=None in progress_snapshot
        rather than raising ValueError."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = "not-a-valid-iso-timestamp"

        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots, "progress_snapshot entry expected in run_log"
        elapsed = snapshots[0].get("elapsed_s")
        assert elapsed is None, (
            f"Expected elapsed_s=None for malformed timestamp, got {elapsed!r}"
        )

    async def test_supervisor_does_not_raise_on_malformed_run_start_ts(self):
        """A malformed run_start_ts must not propagate as an exception."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = "2026-99-99T99:99:99"  # invalid date parts

        # Must not raise.
        cmd = await node(state)
        assert cmd is not None


# ---------------------------------------------------------------------------
# Tests: dry-run mode — no MCP error spam, clean termination
# ---------------------------------------------------------------------------

class TestDryRunMode:
    """In dry-run mode the supervisor should tolerate a missing ledger
    gracefully: no MCP error log entries, and clean termination after
    routing to PM once."""

    async def test_dry_run_no_wps_first_iteration_routes_to_pm(self):
        """First iteration with no WPs in dry-run still routes to PM."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == "pm"

    async def test_dry_run_no_wps_second_iteration_routes_to_end(self):
        """Second iteration with no WPs in dry-run terminates cleanly."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=1))

        assert cmd.goto == END

    async def test_dry_run_no_mcp_error_entries(self):
        """Dry-run must not produce mcp_error log entries for missing ledger."""
        # Simulate ledger_list_work_packages throwing (no ledger).
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        # Should route to PM (first iteration), but with no mcp_error entries.
        assert cmd.goto == "pm"
        mcp_errors = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "mcp_error"
        ]
        assert not mcp_errors, f"Unexpected mcp_error entries in dry-run: {mcp_errors}"

    async def test_dry_run_no_error_list_entries(self):
        """Dry-run with missing ledger must not populate the errors list."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        errors = cmd.update.get("errors", [])
        assert not errors, f"Unexpected errors in dry-run: {errors}"

    async def test_dry_run_uses_info_level_for_missing_ledger(self):
        """The dry_run_no_ledger log entry must use INFO level."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        no_ledger_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "dry_run_no_ledger"
        ]
        assert no_ledger_entries, "Expected dry_run_no_ledger entry"
        assert no_ledger_entries[0]["level"] == "INFO"

    async def test_dry_run_complete_log_entry_on_termination(self):
        """When dry-run terminates on second iteration, it logs dry_run_complete."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=1))

        assert cmd.goto == END
        complete_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "dry_run_complete"
        ]
        assert complete_entries, "Expected dry_run_complete entry"
        assert complete_entries[0]["level"] == "INFO"

    async def test_dry_run_get_project_status_error_routes_to_end_cleanly(self):
        """If ledger_get_project_status throws in dry-run, route to END
        at INFO level without errors list."""
        from langgraph.constants import END  # type: ignore[import]

        status_tool = MagicMock()
        status_tool.name = "ledger_get_project_status"
        status_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        list_tool = make_tool("ledger_list_work_packages", [])
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == END
        # Must use dry_run_no_ledger action, not mcp_error.
        actions = [e.get("action") for e in cmd.update.get("run_log", [])]
        assert "dry_run_no_ledger" in actions
        assert "mcp_error" not in actions
        assert not cmd.update.get("errors", [])

    async def test_non_dry_run_still_produces_mcp_error(self):
        """Without dry_run=True, missing ledger must still produce mcp_error."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=False,
        )
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == "pm"
        mcp_errors = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "mcp_error"
        ]
        assert mcp_errors, "Non-dry-run should produce mcp_error entries"

    async def test_dry_run_with_existing_wps_routes_normally(self):
        """Dry-run with an existing ledger (WPs present) routes normally."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state())

        # Normal routing — WP-001 needs implementation → developer.
        assert cmd.goto == "developer"
