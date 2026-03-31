"""
nodes/developer.py — Developer node.

Creates a Deep Agent with the Developer persona prompt and MCP tools, invokes
it to implement the current work package.

Slim prompt strategy
--------------------
``_build_developer_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``developer`` Markdown template.  Identity declarations, workflow
steps, and MCP tool call guidance live in the Developer persona system prompt
loaded from ``personas/ledger/claude-code/``.

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
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("developer")


def _build_developer_prompt(state: WorkflowState) -> str:
    """Construct the developer agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_developer_node(config: Config, mcp_tools: list[Any]):
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
