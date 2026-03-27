"""
nodes/qa.py — QA node.

Creates a Deep Agent with the QA persona prompt and MCP tools, invokes it to
run the test suite and complete the QA pipeline for the current work package.

Slim prompt strategy
--------------------
``_build_qa_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``qa`` Markdown template.  Identity declarations, workflow steps,
and MCP tool call guidance live in the QA persona system prompt loaded from
``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_qa_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("qa")


def _build_qa_prompt(state: WorkflowState) -> str:
    """Construct the QA agent's user-turn prompt."""
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })


def make_qa_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the QA stage.

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
    return create_stage_node("qa", _build_qa_prompt, config, mcp_tools)
