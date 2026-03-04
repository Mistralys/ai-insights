"""
nodes/developer.py — Developer node.

Creates a Deep Agent with the Developer persona prompt and MCP tools, invokes
it to implement the current work package:

1. Claim the WP via ``ledger_claim_work_package``.
2. Start the implementation pipeline via ``ledger_start_pipeline``.
3. Implement the required code changes.
4. Complete the pipeline via ``ledger_complete_pipeline``.

Public factory
--------------
:func:`make_developer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_developer_prompt(state: "WorkflowState") -> str:
    """Construct the developer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Developer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package details by calling "
        f"`ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Claim the work package and start the implementation pipeline atomically "
        f"by calling `ledger_begin_work` with `project_path={project_path!r}`, "
        f"`work_package_id={wp_id!r}`, `type='implementation'`, and `agent_role='Developer'`.\n"
        f"3. Implement all required code changes to satisfy the acceptance "
        f"criteria listed in the work package.\n"
        f"4. Run any relevant tests to verify correctness.\n"
        f"5. Complete the pipeline by calling `ledger_complete_pipeline` with "
        f"`project_path={project_path!r}`, "
        f"`status='PASS'` (or `'FAIL'` if tests do not pass), including a "
        f"summary of changes, artifacts, and any observations.\n"
        f"   Mark acceptance criteria as met in `acceptance_criteria_updates`.\n"
    )


def make_developer_node(config: "Config", mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Developer stage.

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
    return create_stage_node("developer", _build_developer_prompt, config, mcp_tools)
