"""
nodes/synthesis.py — Synthesis node.

Creates a Deep Agent with the Synthesis persona prompt and MCP tools, invokes
it to produce the final project synthesis report once all work packages are
complete.

Synthesis is the **terminal stage** — no work package ID is required.  The
agent compiles outcomes from all completed WPs, summarises results and
lessons learned, and writes the final synthesis document.

Public factory
--------------
:func:`make_synthesis_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_synthesis_prompt(state: "WorkflowState") -> str:
    """
    Construct the synthesis agent's user-turn prompt.

    No ``current_wp_id`` is required — synthesis operates on the full project.
    """
    project_path: str = state["project_path"]

    return (
        f"You are the Synthesis agent.\n\n"
        f"**Project path:** {project_path}\n\n"
        f"**Your task:**\n"
        f"All work packages for this project are now COMPLETE. "
        f"Your job is to produce a comprehensive synthesis report.\n\n"
        f"1. Call `ledger_get_project_status` with "
        f"`project_path={project_path!r}` to get the final project overview.\n"
        f"2. For each completed work package, call "
        f"`ledger_get_work_package` to retrieve pipeline outcomes, "
        f"observations, and acceptance criteria results.\n"
        f"3. Write a synthesis document that includes:\n"
        f"   - Project summary and outcomes achieved.\n"
        f"   - Key technical decisions and their rationale.\n"
        f"   - Lessons learned and recurring patterns (from pipeline comments).\n"
        f"   - Any outstanding technical debt or follow-up items.\n"
        f"   - Metrics summary (tests passed, files modified, etc.).\n"
        f"4. Save the synthesis document as "
        f"`synthesis.md` inside `{project_path}`.\n"
    )


def make_synthesis_node(config: "Config", mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Synthesis stage.

    .. note::
        The synthesis node does **not** require ``current_wp_id`` in state.
        It operates on the full project and should be the final node before END.

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
    return create_stage_node("synthesis", _build_synthesis_prompt, config, mcp_tools)
