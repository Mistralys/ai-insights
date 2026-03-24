"""
nodes/release_engineer.py — Release Engineer node.

Creates a Deep Agent with the Release Engineer persona prompt and MCP tools,
invokes it to curate the release and complete the release-engineering pipeline
for the current work package.

Slim prompt strategy
--------------------
``_build_release_engineer_prompt()`` produces a minimal user-turn prompt
containing only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.
- ``project_path`` injection-safety warning — critical reminder that every MCP
  tool call must include the ``project_path`` parameter.

Identity declarations, workflow step enumerations, and MCP tool call guidance
are intentionally omitted; those live exclusively in the Release Engineer
persona system prompt loaded from ``personas/ledger/claude-code/``.

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


def _build_release_engineer_prompt(state: WorkflowState) -> str:
    """Construct the Release Engineer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n"
    )


def make_release_engineer_node(config: Config, mcp_tools: list[Any]):
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
