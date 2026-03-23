# Orchestrator - Stage Nodes
_SOURCE: Pipeline stage node factories (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis)_
# Pipeline stage node factories (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis)
```
// Structure of documents
└── orchestrator/
    └── src/
        └── nodes/
            └── __init__.py
            └── developer.py
            └── docs.py
            └── pm.py
            └── qa.py
            └── release_engineer.py
            └── reviewer.py
            └── security_auditor.py
            └── synthesis.py

```
###  Path: `/orchestrator/src/nodes/__init__.py`

```py
"""
nodes — One module per pipeline stage.

Each node module exposes a ``make_<stage>_node(config, mcp_tools)`` factory
that returns a LangGraph node function.  The generic scaffolding lives here in
:func:`create_stage_node`; individual modules provide stage-specific prompt
builders.

Public factories
----------------
- :func:`create_stage_node` — Generic factory used internally by each module.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from langchain_core.runnables import RunnableConfig

from src.utils.logging import get_run_logger
from src.utils.mcp_parse import parse_tool_response
from src.utils.tool_wrappers import inject_project_path

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

log = logging.getLogger(__name__)


def create_stage_node(
    stage: str,
    build_prompt: Callable[[WorkflowState], str],
    config: Config,
    mcp_tools: list[Any],
) -> Callable[[WorkflowState], dict]:
    """
    Generic LangGraph node factory.

    Parameters
    ----------
    stage:
        Stage name matching a key in :data:`~src.config.PERSONA_FILES`
        (e.g. ``"developer"``).
    build_prompt:
        Callable ``(state) -> str`` that produces the user-turn prompt for
        this stage.  Receives the full :class:`~src.state.WorkflowState`.
    config:
        Application config (provides ``model_name``, ``workspace_root``).
    mcp_tools:
        LangChain tool objects from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
        A LangGraph node function that creates a Deep Agent, invokes it, and
        returns a state-update dict.
    """

    # Capture the app-level Config in a closure variable so it doesn't clash
    # with the LangGraph ``config`` parameter passed to the node at runtime.
    _app_config = config

    async def node_fn(state: WorkflowState, config: RunnableConfig | None = None) -> dict:
        from deepagents import create_deep_agent  # type: ignore[import]
        from deepagents.backends import LocalShellBackend  # type: ignore[import]

        from src.utils.persona import load_persona

        run_logger = get_run_logger(config)
        _wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

        # ── stage_start ───────────────────────────────────────────────
        stage_start_time = datetime.now(UTC)
        start_entry: dict = {
            "timestamp": stage_start_time.isoformat(),
            "stage": stage,
            "wp_id": _wp_id,
            "action": "stage_start",
            "level": "INFO",
            "iteration": state.get("iteration", 0),  # type: ignore[call-overload]
        }
        if run_logger:
            run_logger.stream_entry(start_entry)

        try:
            persona_prompt = load_persona(stage, workspace_root=_app_config.workspace_root)
            user_prompt = build_prompt(state)

            target_path: str = state.get("target_project_path", "")  # type: ignore[call-overload]
            project_path: str = state["project_path"]  # type: ignore[index]
            backend = LocalShellBackend(root_dir=target_path or None)

            wrapped_tools = inject_project_path(list(mcp_tools), project_path)

            agent = create_deep_agent(
                model=_app_config.model_name,
                backend=backend,
                system_prompt=persona_prompt,
                tools=wrapped_tools,
            )

            # Use ainvoke so LangGraph's inner ToolNode takes the async path
            # (a_run) for MCP StructuredTools, which don't implement sync _run.
            result = await agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]})
            _msgs = result.get("messages") or []
            last_msg = _msgs[-1] if _msgs else None
            final_content: str = last_msg.content if last_msg is not None else ""  # type: ignore[union-attr]
            tokens_used = getattr(last_msg, "usage_metadata", None)

            # ── duration ──────────────────────────────────────────────
            stage_end_time = datetime.now(UTC)
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)

            log.info("Stage %s completed successfully.", stage)
            log_entry = {
                "timestamp": stage_end_time.isoformat(),
                "stage": stage,
                "wp_id": _wp_id,
                "action": "stage_complete",
                "result": "PASS",
                "level": "INFO",
                "tokens_used": tokens_used,
                "duration_s": duration_s,
            }
            if run_logger:
                run_logger.stream_entry(log_entry)

            # ── pipeline_result read-back (best-effort) ───────────────
            extra_log_entries: list = []
            if _wp_id and wrapped_tools:
                try:
                    get_wp_tool = next(
                        (t for t in wrapped_tools if t.name == "ledger_get_work_package"),
                        None,
                    )
                    if get_wp_tool:
                        raw = await get_wp_tool.ainvoke(
                            {"work_package_id": _wp_id, "project_path": project_path}
                        )
                        wp_detail = parse_tool_response(raw)
                        if isinstance(wp_detail, dict):
                            pipelines = wp_detail.get("pipelines", [])
                            if pipelines:
                                latest = pipelines[-1]
                                pipeline_duration_s = None
                                if latest.get("duration_ms") is not None:
                                    pipeline_duration_s = round(
                                        latest["duration_ms"] / 1000, 1
                                    )
                                pipeline_result_entry: dict = {
                                    "timestamp": datetime.now(UTC).isoformat(),
                                    "stage": stage,
                                    "wp_id": _wp_id,
                                    "action": "pipeline_result",
                                    "level": "INFO",
                                    "pipeline_type": latest.get("type", ""),
                                    "pipeline_status": latest.get("status", ""),
                                    "files_modified": (
                                        latest.get("artifacts") or {}
                                    ).get("files_modified", []),
                                    "metrics": latest.get("metrics"),
                                    "summary": latest.get("summary", []),
                                    "duration_s": pipeline_duration_s,
                                }
                                if run_logger:
                                    run_logger.stream_entry(pipeline_result_entry)
                                extra_log_entries.append(pipeline_result_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Could not read back WP detail for pipeline_result event",
                        exc_info=True,
                    )

            return {
                "stage_result": final_content,
                # True = agent ran to completion without error. At this level the best
                # proxy for "at least one PASS pipeline was produced" is that the agent
                # finished without raising an exception. The supervisor's circuit breaker
                # treats this as a successful stage turn.
                "stage_success": True,
                "run_log": [start_entry, log_entry] + extra_log_entries,
            }

        except Exception as exc:  # noqa: BLE001
            stage_end_time = datetime.now(UTC)
            ts = stage_end_time.isoformat()
            duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)
            log.error("Stage %s failed: %s", stage, exc, exc_info=True)
            log_entry = {
                "timestamp": ts,
                "stage": stage,
                "wp_id": _wp_id,
                "action": "stage_error",
                "result": "FAIL",
                "error": str(exc),
                "level": "ERROR",
                "duration_s": duration_s,
            }
            if run_logger:
                run_logger.stream_entry(log_entry)
            return {
                "stage_result": "",
                "stage_success": False,
                "errors": [
                    {
                        "timestamp": ts,
                        "stage": stage,
                        "wp_id": _wp_id,
                        "message": str(exc),
                    }
                ],
                "run_log": [start_entry, log_entry],
            }

    node_fn.__name__ = f"{stage}_node"
    node_fn.__qualname__ = f"{stage}_node"
    return node_fn

```
###  Path: `/orchestrator/src/nodes/developer.py`

```py
"""
nodes/developer.py — Developer node.

Creates a Deep Agent with the Developer persona prompt and MCP tools, invokes
it to implement the current work package:

1. Claim the WP via ``ledger_claim_work_package``.
2. Start the implementation pipeline via ``ledger_start_pipeline``.
3. Implement the required code changes.
4. Complete the pipeline via ``ledger_complete_pipeline``.

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


def _build_developer_prompt(state: WorkflowState) -> str:
    """Construct the developer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Developer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package details by calling "
        f"`ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Claim the work package and start the implementation pipeline atomically "
        f"by calling `ledger_begin_work` with `project_path={project_path!r}`, "
        f"`work_package_id={wp_id!r}`, `type='implementation'`, and `agent_role='Developer'`.\n"
        f"3. Implement all required code changes to satisfy the acceptance "
        f"criteria listed in the work package.\n"
        f"4. Run any relevant tests to verify correctness.\n"
        f"5. Complete the pipeline by calling `ledger_complete_pipeline` with "
        f"`project_path={project_path!r}`, "
        f"`status='PASS'` (or `'FAIL'` if tests do not pass), including a "
        f"summary of changes, artifacts, and any observations.\n"
        f"   Mark acceptance criteria as met in `acceptance_criteria_updates`.\n"
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

```
###  Path: `/orchestrator/src/nodes/docs.py`

```py
"""
nodes/docs.py — Documentation node.

Creates a Deep Agent with the Documentation persona prompt and MCP tools,
invokes it to update project documentation for the current work package.

The documentation agent is responsible for the *final* pipeline stage before a
work package is marked COMPLETE:

1. Start the documentation pipeline.
2. Update README, API docs, changelogs, or other relevant documentation.
3. Complete the documentation pipeline via ``ledger_complete_pipeline`` (PASS).
4. The WP is automatically marked COMPLETE when ``ledger_complete_pipeline``
   is called with ``status=PASS`` and all acceptance criteria are met
   (``auto_finalized=true`` in the response).

Public factory
--------------
:func:`make_docs_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_docs_prompt(state: WorkflowState) -> str:
    """Construct the documentation agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Documentation agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the documentation pipeline by calling "
        f"`ledger_begin_work` with `project_path={project_path!r}`, "
        f"`work_package_id={wp_id!r}`, `type='documentation'`, and `agent_role='Documentation'`.\n"
        f"3. Update all relevant documentation for this work package:\n"
        f"   - README.md (if user-facing behaviour changed).\n"
        f"   - API/interface docs (docstrings, API reference pages).\n"
        f"   - Changelog (add an entry for the WP).\n"
        f"   - Any other docs referenced in the acceptance criteria.\n"
        f"4. Complete the documentation pipeline by calling "
        f"`ledger_complete_pipeline` with `project_path={project_path!r}`, "
        f"`status='PASS'` and include a list "
        f"of all files modified in `artifacts`. Mark acceptance criteria as "
        f"met in `acceptance_criteria_updates`.\n"
        f"   Note: When `ledger_complete_pipeline` records a PASS and all "
        f"acceptance criteria are met, the work package is automatically "
        f"transitioned to COMPLETE \u2014 you do not need to call "
        f"`ledger_update_work_package_status` separately.\n"
    )


def make_docs_node(config: Config, mcp_tools: list[Any]):
    """
    Return the LangGraph node function for the Documentation stage.

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
    return create_stage_node("docs", _build_docs_prompt, config, mcp_tools)

```
###  Path: `/orchestrator/src/nodes/pm.py`

```py
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

```
###  Path: `/orchestrator/src/nodes/qa.py`

```py
"""
nodes/qa.py — QA node.

Creates a Deep Agent with the QA persona prompt and MCP tools, invokes it to
run the test suite and complete the QA pipeline for the current work package.

The QA agent starts a QA pipeline, validates acceptance criteria, runs tests,
and completes the pipeline with PASS or FAIL. A FAIL result causes the
supervisor to route back to the developer for rework.

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


def _build_qa_prompt(state: WorkflowState) -> str:
    """Construct the QA agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the QA agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the QA pipeline by calling `ledger_begin_work` with "
        f"`project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='qa'`, and `agent_role='QA'`.\n"
        f"3. Run the project test suite (e.g. `pytest`, `npm test`).\n"
        f"4. Validate each acceptance criterion from the work package.\n"
        f"5. Complete the QA pipeline by calling `ledger_complete_pipeline` "
        f"with `project_path={project_path!r}`, "
        f"`status='PASS'` if all criteria pass, or `'FAIL'` if any "
        f"criterion is not met. Include test results in `metrics` and "
        f"observations in `comments`.\n"
    )


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

```
###  Path: `/orchestrator/src/nodes/release_engineer.py`

```py
"""
nodes/release_engineer.py — Release Engineer node.

Creates a Deep Agent with the Release Engineer persona prompt and MCP tools,
invokes it to curate the release and complete the release-engineering pipeline
for the current work package.

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
        f"You are the Release Engineer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the release-engineering pipeline by calling `ledger_begin_work` with "
        f"`project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='release-engineering'`, and `agent_role='Release Engineer'`.\n"
        f"3. Curate the release: version bump, changelog update, release notes, "
        f"package manifest validation.\n"
        f"4. Complete the release-engineering pipeline by calling `ledger_complete_pipeline` "
        f"with `project_path={project_path!r}`, "
        f"`status='PASS'` if release is ready, or `'FAIL'` if issues block release. "
        f"Include artifacts in `artifacts` and notes in `comments`.\n"
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

```
###  Path: `/orchestrator/src/nodes/reviewer.py`

```py
"""
nodes/reviewer.py — Reviewer node.

Creates a Deep Agent with the Reviewer persona prompt and MCP tools, invokes
it to perform a structured code review for the current work package.

The reviewer agent starts a code-review pipeline, evaluates code quality,
architecture, and adherence to acceptance criteria, then completes the pipeline
with PASS or FAIL. A FAIL causes the supervisor to route back to the developer.

Public factory
--------------
:func:`make_reviewer_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import create_stage_node


def _build_reviewer_prompt(state: WorkflowState) -> str:
    """Construct the reviewer agent's user-turn prompt."""
    project_path: str = state["project_path"]
    wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

    return (
        f"You are the Reviewer agent.\n\n"
        f"**Project path:** {project_path}\n"
        f"**Work package:** {wp_id}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"1. Read the work package by calling `ledger_get_work_package` with "
        f"`project_path={project_path!r}` and `work_package_id={wp_id!r}`.\n"
        f"2. Start the code-review pipeline by calling `ledger_begin_work` "
        f"with `project_path={project_path!r}`, `work_package_id={wp_id!r}`, "
        f"`type='code-review'`, and `agent_role='Reviewer'`.\n"
        f"3. Review the implementation for:\n"
        f"   - Correctness and alignment with acceptance criteria.\n"
        f"   - Code quality, readability, and idiomatic style.\n"
        f"   - Architectural consistency with the existing codebase.\n"
        f"   - Missing edge cases, error handling, or security concerns.\n"
        f"4. Complete the code-review pipeline by calling "
        f"`ledger_complete_pipeline` with `project_path={project_path!r}`, "
        f"`status='PASS'` if the code meets "
        f"standards, or `'FAIL'` if significant issues require rework. "
        f"Include detailed `comments` for the developer.\n"
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

```
###  Path: `/orchestrator/src/nodes/security_auditor.py`

```py
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


def _build_security_auditor_prompt(state: WorkflowState) -> str:
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


def make_security_auditor_node(config: Config, mcp_tools: list[Any]):
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

```
###  Path: `/orchestrator/src/nodes/synthesis.py`

```py
"""
nodes/synthesis.py — Synthesis node.

Creates a Deep Agent with the Synthesis persona prompt and MCP tools, invokes
it to produce the final project synthesis report once all work packages are
complete.

Synthesis is the **terminal stage** — no work package ID is required.  The
agent compiles outcomes from all completed WPs, summarises results and
lessons learned, and writes the final synthesis document.

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
        f"You are the Synthesis agent.\n\n"
        f"**Project path:** {project_path}\n\n"
        f"**CRITICAL \u2014 EVERY MCP TOOL CALL MUST include `project_path={project_path!r}`.**\n"
        f"Omitting `project_path` from any tool call will cause it to fail immediately.\n\n"
        f"**Your task:**\n"
        f"All work packages for this project are now COMPLETE. "
        f"Your job is to produce a comprehensive synthesis report.\n\n"
        f"1. Call `ledger_get_project_status` with "
        f"`project_path={project_path!r}` to get the final project overview.\n"
        f"2. For each completed work package, call "
        f"`ledger_get_work_package` with `project_path={project_path!r}` "
        f"to retrieve pipeline outcomes, "
        f"observations, and acceptance criteria results.\n"
        f"3. Write a synthesis document that includes:\n"
        f"   - Project summary and outcomes achieved.\n"
        f"   - Key technical decisions and their rationale.\n"
        f"   - Lessons learned and recurring patterns (from pipeline comments).\n"
        f"   - Any outstanding technical debt or follow-up items.\n"
        f"   - Metrics summary (tests passed, files modified, etc.).\n"
        f"4. Save the synthesis document as "
        f"`synthesis.md` inside `{project_path}`.\n"
        f"5. Call `ledger_complete_synthesis` with `project_path={project_path!r}` "
        f"and `agent_role='Synthesis'` to mark the project COMPLETE.\n"
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

```