"""
nodes/synthesis.py — Synthesis node.

Creates a Deep Agent with the Synthesis persona prompt and MCP tools, invokes
it to produce the final project synthesis report once all work packages are
complete.

Slim prompt strategy
--------------------
``_build_synthesis_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``project_path`` injection-safety warning — critical reminder that every MCP
  tool call must include the ``project_path`` parameter.

``wp_id`` is intentionally omitted — synthesis is a **project-scoped** stage
that operates across all completed work packages rather than a single WP.

Identity declarations, workflow step enumerations, and MCP tool call guidance
are intentionally omitted; those live exclusively in the Synthesis persona
system prompt loaded from ``personas/ledger/claude-code/``.

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


def _build_synthesis_prompt(state: WorkflowState) -> str:
    """
    Construct the synthesis agent's user-turn prompt.

    No ``current_wp_id`` is required — synthesis operates on the full project.
    """
    project_path: str = state["project_path"]

    return (
        f"**Project path:** {project_path}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n"
    )


def make_synthesis_node(config: Config, mcp_tools: list[Any]):
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
