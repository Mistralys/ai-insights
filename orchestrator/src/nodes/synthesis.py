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

``wp_id`` is intentionally omitted — synthesis is a **project-scoped** stage
that operates across all completed work packages rather than a single WP.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Synthesis persona
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

from . import build_stage_prompt, create_stage_node


def _build_synthesis_prompt(state: WorkflowState) -> str:
    """
    Construct the synthesis agent's user-turn prompt.

    No ``current_wp_id`` is required — synthesis operates on the full project.
    """
    return build_stage_prompt(state["project_path"])


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
