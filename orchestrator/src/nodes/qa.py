"""
nodes/qa.py — QA node.

Creates a Deep Agent with the QA persona prompt and MCP tools, invokes it to
run the test suite and complete the QA pipeline for the current work package.

The QA agent starts a QA pipeline, validates acceptance criteria, runs tests,
and completes the pipeline with PASS or FAIL. A FAIL result causes the
supervisor to route back to the developer for rework.

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


def _build_qa_prompt(state: "WorkflowState") -> str:
    """Construct the QA agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the QA agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the QA pipeline by calling `ledger_begin_work` with "
        f"`project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='qa'`, and `agent_role='QA'`.\n"
        f"3. Run the project test suite (e.g. `pytest`, `npm test`).\n"
        f"4. Validate each acceptance criterion from the work package.\n"
        f"5. Complete the QA pipeline by calling `ledger_complete_pipeline` "
        f"with `project_path={project_path!r}`, "
        f"`status='PASS'` if all criteria pass, or `'FAIL'` if any "
        f"criterion is not met. Include test results in `metrics` and "
        f"observations in `comments`.\n"
    )


def make_qa_node(config: "Config", mcp_tools: list[Any]):
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
