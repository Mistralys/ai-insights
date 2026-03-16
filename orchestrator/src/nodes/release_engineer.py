"""
nodes/release_engineer.py — Release Engineer node.

Creates a Deep Agent with the Release Engineer persona prompt and MCP tools,
invokes it to curate the release and complete the release-engineering pipeline
for the current work package.

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


def _build_release_engineer_prompt(state: "WorkflowState") -> str:
    """Construct the Release Engineer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Release Engineer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the release-engineering pipeline by calling `ledger_begin_work` with "
        f"`project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='release-engineering'`, and `agent_role='Release Engineer'`.\n"
        f"3. Curate the release: version bump, changelog update, release notes, "
        f"package manifest validation.\n"
        f"4. Complete the release-engineering pipeline by calling `ledger_complete_pipeline` "
        f"with `project_path={project_path!r}`, "
        f"`status='PASS'` if release is ready, or `'FAIL'` if issues block release. "
        f"Include artifacts in `artifacts` and notes in `comments`.\n"
    )


def make_release_engineer_node(config: "Config", mcp_tools: list[Any]):
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
