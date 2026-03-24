"""
nodes/developer.py — Developer node.

Creates a Deep Agent with the Developer persona prompt and MCP tools, invokes
it to implement the current work package.

Slim prompt strategy
--------------------
``_build_developer_prompt()`` produces a minimal user-turn prompt containing
only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.
- ``pipeline_type`` — explicit instruction to start an ``implementation``
  pipeline, reinforcing the persona system prompt on every invocation.
- ``project_path`` injection-safety warning — critical reminder that every MCP
  tool call must include the ``project_path`` parameter.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Developer persona
system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_developer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import build_stage_prompt, create_stage_node


def _build_developer_prompt(state: WorkflowState) -> str:
    """Construct the developer agent's user-turn prompt."""
    wp_id = state.get("current_wp_id", "")  # type: ignore[call-overload]
    extra = (
        f'**Step 1 — BEFORE writing any code:** Call `ledger_begin_work` with '
        f'work_package_id={wp_id}, type="implementation", agent_role="Developer".\n\n'
        "**Pipeline to start:** `implementation`\n\n"
        f"**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}. "
        "Do NOT call any MCP tool with a different work_package_id.**"
    )
    return build_stage_prompt(
        state["project_path"],
        wp_id=wp_id,
        extra=extra,
    )


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
