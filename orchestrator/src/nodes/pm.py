"""
nodes/pm.py — Project Manager node.

Creates a Deep Agent with the PM persona prompt and MCP tools, invokes it
to analyse the plan document and create work packages in the ledger.

Slim prompt strategy
--------------------
``_build_pm_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``plan_file`` — relative path of the plan document within the project.
- **Plan document content** — the full text of the plan file is embedded
  directly in the prompt. This is legitimate runtime data that the persona
  system prompt cannot know at build time and is therefore the only
  substantive content beyond the three slim fields above.

The prompt is assembled by :func:`~src.nodes.prompt_renderer.render_prompt`
using the ``pm`` Markdown template.  Identity declarations, workflow steps,
and MCP tool call guidance live in the PM persona system prompt loaded from
``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_pm_node`
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node
from .prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("pm")


def _build_pm_prompt(state: WorkflowState) -> str:
    """Construct the PM agent's user-turn prompt from the plan document."""
    project_path: str = state["project_path"]
    plan_file: str = state.get("plan_file", "plan.md")  # type: ignore[call-overload]

    # Read the plan document so the PM agent has full context.
    plan_path = Path(project_path) / plan_file
    try:
        plan_content = plan_path.read_text(encoding="utf-8")
    except OSError as exc:
        plan_content = f"[Could not read plan file at {plan_path}: {exc}]"

    return render_prompt(_TEMPLATE, {
        "project_path": project_path,
        "plan_file": plan_file,
        "extra": f"---\n\n# Plan Document\n\n{plan_content}",
    })


def make_pm_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Project Manager stage.

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
    return create_stage_node("pm", _build_pm_prompt, config, mcp_tools)
