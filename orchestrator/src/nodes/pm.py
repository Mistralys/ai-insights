"""
nodes/pm.py — Project Manager node.

Creates a Deep Agent with the PM persona prompt and MCP tools, invokes it
to analyse the plan document and create work packages in the ledger.

The PM node is responsible for the *first pass* of a project: reading the
plan, calling ``ledger_initialize_project`` if required, and then calling
``ledger_create_work_package`` for each WP defined in the plan.

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

    return (
        f"You are the Project Manager agent.\n\n"
        f"**Project path:** {project_path}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the plan document below carefully.\n"
        f"2. If the project ledger has not been initialised yet, call "
        f"`ledger_initialize_project` with `project_path={project_path!r}` "
        f"and `plan_file={plan_file!r}`.\n"
        f"3. For each work package defined in the plan, call "
        f"`ledger_create_work_package` with `project_path={project_path!r}` "
        f"to register it in the ledger, "
        f"including correct dependencies and acceptance criteria.\n"
        f"4. Once all work packages are created, confirm by calling "
        f"`ledger_get_project_status` with `project_path={project_path!r}` "
        f"and report the final count.\n\n"
        f"---\n\n"
        f"# Plan Document\n\n"
        f"{plan_content}"
    )


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
