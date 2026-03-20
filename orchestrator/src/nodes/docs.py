"""
nodes/docs.py — Documentation node.

Creates a Deep Agent with the Documentation persona prompt and MCP tools,
invokes it to update project documentation for the current work package.

The documentation agent is responsible for the *final* pipeline stage before a
work package is marked COMPLETE:

1. Start the documentation pipeline.
2. Update README, API docs, changelogs, or other relevant documentation.
3. Complete the documentation pipeline via ``ledger_complete_pipeline`` (PASS).
4. The WP is automatically marked COMPLETE when ``ledger_complete_pipeline``
   is called with ``status=PASS`` and all acceptance criteria are met
   (``auto_finalized=true`` in the response).

Public factory
--------------
:func:`make_docs_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_docs_prompt(state: WorkflowState) -> str:
    """Construct the documentation agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Documentation agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the documentation pipeline by calling "
        f"`ledger_begin_work` with `project_path={project_path!r}`, "
        f"`work_package_id={wp_id!r}`, `type='documentation'`, and `agent_role='Documentation'`.\n"
        f"3. Update all relevant documentation for this work package:\n"
        f"   - README.md (if user-facing behaviour changed).\n"
        f"   - API/interface docs (docstrings, API reference pages).\n"
        f"   - Changelog (add an entry for the WP).\n"
        f"   - Any other docs referenced in the acceptance criteria.\n"
        f"4. Complete the documentation pipeline by calling "
        f"`ledger_complete_pipeline` with `project_path={project_path!r}`, "
        f"`status='PASS'` and include a list "
        f"of all files modified in `artifacts`. Mark acceptance criteria as "
        f"met in `acceptance_criteria_updates`.\n"
        f"   Note: When `ledger_complete_pipeline` records a PASS and all "
        f"acceptance criteria are met, the work package is automatically "
        f"transitioned to COMPLETE \u2014 you do not need to call "
        f"`ledger_update_work_package_status` separately.\n"
    )


def make_docs_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Documentation stage.

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
    return create_stage_node("docs", _build_docs_prompt, config, mcp_tools)
