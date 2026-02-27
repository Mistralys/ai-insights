"""
nodes/reviewer.py — Reviewer node.

Creates a Deep Agent with the Reviewer persona prompt and MCP tools, invokes
it to perform a structured code review for the current work package.

The reviewer agent starts a code-review pipeline, evaluates code quality,
architecture, and adherence to acceptance criteria, then completes the pipeline
with PASS or FAIL. A FAIL causes the supervisor to route back to the developer.

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


def _build_reviewer_prompt(state: "WorkflowState") -> str:
    """Construct the reviewer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Reviewer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the code-review pipeline by calling `ledger_start_pipeline` "
        f"with `type='code-review'`.\n"
        f"3. Review the implementation for:\n"
        f"   - Correctness and alignment with acceptance criteria.\n"
        f"   - Code quality, readability, and idiomatic style.\n"
        f"   - Architectural consistency with the existing codebase.\n"
        f"   - Missing edge cases, error handling, or security concerns.\n"
        f"4. Complete the code-review pipeline by calling "
        f"`ledger_complete_pipeline` with `status='PASS'` if the code meets "
        f"standards, or `'FAIL'` if significant issues require rework. "
        f"Include detailed `comments` for the developer.\n"
    )


def make_reviewer_node(config: "Config", mcp_tools: list[Any]):
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
