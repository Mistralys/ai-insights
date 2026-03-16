"""
nodes/security_auditor.py — Security Auditor node.

Creates a Deep Agent with the Security Auditor persona prompt and MCP tools,
invokes it to run OWASP/dependency checks and complete the security-audit
pipeline for the current work package.

Public factory
--------------
:func:`make_security_auditor_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_security_auditor_prompt(state: "WorkflowState") -> str:
    """Construct the Security Auditor agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Security Auditor agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the security-audit pipeline by calling `ledger_begin_work` with "
        f"`project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='security-audit'`, and `agent_role='Security Auditor'`.\n"
        f"3. Run security checks: OWASP Top 10 review, dependency vulnerability scan, "
        f"threat model review.\n"
        f"4. Complete the security-audit pipeline by calling `ledger_complete_pipeline` "
        f"with `project_path={project_path!r}`, "
        f"`status='PASS'` if no critical issues found, or `'FAIL'` if issues require "
        f"remediation. Include findings in `metrics` and observations in `comments`.\n"
    )


def make_security_auditor_node(config: "Config", mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Security Auditor stage.

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
    return create_stage_node("security_auditor", _build_security_auditor_prompt, config, mcp_tools)
