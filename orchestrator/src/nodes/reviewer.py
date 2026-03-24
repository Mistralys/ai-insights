"""
nodes/reviewer.py — Reviewer node.

Creates a Deep Agent with the Reviewer persona prompt and MCP tools, invokes
it to perform a structured code review for the current work package.

Slim prompt strategy
--------------------
``_build_reviewer_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Reviewer persona
system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_reviewer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import build_stage_prompt, create_stage_node


def _build_reviewer_prompt(state: WorkflowState) -> str:
    """Construct the reviewer agent's user-turn prompt."""
    wp_id = state.get("current_wp_id", "")  # type: ignore[call-overload]
    extra = (
        f"**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}. "
        "Do NOT call any MCP tool with a different work_package_id.**"
    )
    return build_stage_prompt(
        state["project_path"],
        wp_id=wp_id,
        extra=extra,
    )


def make_reviewer_node(config: Config, mcp_tools: list[Any]):
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
