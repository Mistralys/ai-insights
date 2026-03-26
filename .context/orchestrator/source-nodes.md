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

Shared helpers
--------------
- :func:`build_stage_prompt` — Assemble the user-turn prompt for any stage.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from langchain_core.runnables import RunnableConfig

from src.utils.dialogue_writer import serialize_messages_to_markdown, write_dialogue
from src.utils.logging import get_run_logger
from src.utils.mcp_parse import parse_tool_response
from src.utils.tool_wrappers import inject_project_path, log_tool_calls, restrict_to_wp

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

log = logging.getLogger(__name__)

_PROJECT_PATH_REMINDER = "Always use the project path above for all ledger tool calls."
_WP_SCOPE_REMINDER = (
    "CRITICAL: Every MCP tool call MUST use `work_package_id={wp_id}`. "
    "Do NOT reference or operate on any other work package."
)

# Maps orchestrator stage names to the MCP pipeline type used by ledger_begin_work.
# Used to determine which pipeline type to cancel during error-path rollback.
_STAGE_PIPELINE_TYPE: dict[str, str] = {
    "developer": "implementation",
    "qa": "qa",
    "reviewer": "code-review",
    "docs": "documentation",
    "security_auditor": "security-audit",
    "release_engineer": "release-engineering",
}


def _install_begin_work_tracker(tools: list[Any], tracker: dict) -> None:
    """Wrap ``ledger_begin_work`` to record when it is invoked and which pipeline type was used.

    Sets ``tracker["called"] = True`` and ``tracker["pipeline_type"] = <type>`` on
    the first invocation.  Idempotent: a sentinel attribute ``_tracking_begin_work``
    prevents double-wrapping when called multiple times on the same tool objects.
    """
    for tool in tools:
        if tool.name != "ledger_begin_work":
            continue
        if hasattr(tool, "_tracking_begin_work"):
            break  # already wrapped; do not stack
        if not hasattr(tool, "_orig_ainvoke_bw"):
            object.__setattr__(tool, "_orig_ainvoke_bw", tool.ainvoke)
        _orig = tool._orig_ainvoke_bw  # type: ignore[attr-defined]

        async def _tracked_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _orig,
            _tracker: dict = tracker,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                target = (
                    input["args"]
                    if "args" in input and isinstance(input["args"], dict)
                    else input
                )
                pipeline_type = target.get("type")
                if pipeline_type:
                    _tracker["pipeline_type"] = pipeline_type
            _tracker["called"] = True
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _tracked_ainvoke)
        object.__setattr__(tool, "_tracking_begin_work", True)
        break


def build_stage_prompt(
    project_path: str,
    *,
    wp_id: str = "",
    preamble: str = "",
    extra: str = "",
) -> str:
    """Assemble a slim user-turn prompt for any pipeline stage.

    Parameters
    ----------
    project_path:
        Absolute path passed to every MCP tool call.
    wp_id:
        Work-package identifier (omit for project-scoped stages like synthesis).
    preamble:
        Optional text placed *before* the project/WP fields (e.g. "Please start…").
    extra:
        Optional content appended *after* the reminder (e.g. the plan document).
    """
    lines: list[str] = []
    if preamble:
        lines.append(f"{preamble}\n")
    lines.append(f"**Project:** `{project_path}`")
    if wp_id:
        lines.append(f"**Work package:** {wp_id}")
    lines.append(f"\n{_PROJECT_PATH_REMINDER}")
    if wp_id:
        lines.append(f"\n{_WP_SCOPE_REMINDER.format(wp_id=wp_id)}")
    if extra:
        lines.append(f"\n{extra}")
    return "\n".join(lines) + "\n"


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

    Wrapper layers
    --------------
    Four defensive wrappers are applied to `mcp_tools` inside the node function,
    in this canonical order:

    1. :func:`~src.utils.tool_wrappers.inject_project_path` — Layer 2 safety net.
       Auto-injects ``project_path`` into every call when the argument is absent.
    2. :func:`~src.utils.tool_wrappers.restrict_to_wp` — Layer 3 safety net
       (skipped when ``_wp_id`` is empty, e.g. synthesis stages).  Auto-injects
       ``work_package_id`` and raises :exc:`ValueError` on cross-WP calls.
    3. :func:`_install_begin_work_tracker` — Internal tracker (skipped when
       ``_wp_id`` is empty).  Wraps ``ledger_begin_work`` to record when it fires
       and which pipeline type was requested; enables automatic pipeline rollback
       on error (see the ``except`` block).
    4. :func:`~src.utils.tool_wrappers.log_tool_calls` — Outermost wrapper.
       Applied last, so ``_logged_ainvoke`` executes *first* on each call —
       before inner wrappers inject ``project_path`` or ``work_package_id``.
       Emits a ``tool_call`` JSONL event (``level: DEBUG``) recording
       ``stage``, ``wp_id``, ``tool_name``, and ``tool_wp_id``; full argument
       payloads are never logged (privacy constraint).
    """

    # Capture the app-level Config in a closure variable so it doesn't clash
    # with the LangGraph ``config`` parameter passed to the node at runtime.
    _app_config = config

    async def node_fn(state: WorkflowState, config: Optional[RunnableConfig] = None) -> dict:  # noqa: UP045
        from deepagents import create_deep_agent  # type: ignore[import]
        from deepagents.backends import LocalShellBackend  # type: ignore[import]

        from src.utils.persona import load_persona

        run_logger = get_run_logger(config)
        _wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]

        # Tracks whether ledger_begin_work was called during this stage invocation.
        # Populated by the tracker installed in _install_begin_work_tracker below.
        # Declared before `try` so it is accessible in the `except` rollback path.
        _begin_work_state: dict = {"called": False, "pipeline_type": None}
        wrapped_tools: list[Any] = []

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
            if _wp_id:
                restrict_to_wp(wrapped_tools, _wp_id)

            # Install tracker so the except block can detect whether
            # ledger_begin_work was called before the error occurred.
            if _wp_id:
                _install_begin_work_tracker(wrapped_tools, _begin_work_state)

            # Wire tool-call logging as the outermost wrapper (applied last).
            # Being outermost, _logged_ainvoke executes first on every call,
            # capturing tool_name and the wp_id argument as the agent supplied
            # them — before inner wrappers inject project_path or wp_id.
            log_tool_calls(wrapped_tools, stage, _wp_id, run_logger)

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

            # ── dialogue capture (optional, non-fatal) ────────────────
            dialogue_captured_entry: dict | None = None
            if _app_config.capture_dialogues and _wp_id:
                try:
                    # Derive slug_dir from workspace_root + mcp-server/storage/ledger/<slug>
                    # where slug is the last path segment of the ledger plan directory.
                    project_path_obj = state["project_path"]  # type: ignore[index]
                    slug = Path(project_path_obj).name
                    slug_dir = (
                        _app_config.workspace_root
                        / "mcp-server"
                        / "storage"
                        / "ledger"
                        / slug
                    )
                    ts_str = stage_start_time.isoformat()
                    content = serialize_messages_to_markdown(_msgs, stage, _wp_id, ts_str)
                    written_path = write_dialogue(content, slug_dir, _wp_id, stage)
                    dialogue_captured_entry = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "action": "dialogue_captured",
                        "stage": stage,
                        "wp_id": _wp_id,
                        "file_path": str(written_path),
                        "level": "INFO",
                    }
                    if run_logger:
                        run_logger.stream_entry(dialogue_captured_entry)
                except Exception:  # noqa: BLE001
                    log.debug(
                        "Dialogue capture failed for stage %s; continuing normally.",
                        stage,
                        exc_info=True,
                    )

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

            # Append dialogue_captured to run_log when present.
            if dialogue_captured_entry is not None:
                extra_log_entries.append(dialogue_captured_entry)

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

            # ── pipeline rollback ─────────────────────────────────────
            # If ledger_begin_work was called before the error, cancel the
            # orphaned IN_PROGRESS pipeline so the next run attempt is not
            # blocked by a stale pipeline. auto_cancelled=True prevents the
            # cancellation from counting toward the rework budget (§21.27).
            rollback_log_entries: list[dict] = []
            if _begin_work_state["called"] and _wp_id and wrapped_tools:
                _pipeline_type = (
                    _begin_work_state.get("pipeline_type") or _STAGE_PIPELINE_TYPE.get(stage)
                )
                if _pipeline_type:
                    _cancel_tool = next(
                        (t for t in wrapped_tools if t.name == "ledger_cancel_pipeline"),
                        None,
                    )
                    if _cancel_tool:
                        try:
                            await _cancel_tool.ainvoke({
                                "work_package_id": _wp_id,
                                "type": _pipeline_type,
                                "reason": f"Orchestrator stage error: {exc}",
                                "auto_cancelled": True,
                            })
                            log.info(
                                "Pipeline rollback: cancelled IN_PROGRESS %s pipeline for %s",
                                _pipeline_type,
                                _wp_id,
                            )
                            rollback_entry: dict = {
                                "timestamp": datetime.now(UTC).isoformat(),
                                "stage": stage,
                                "wp_id": _wp_id,
                                "action": "pipeline_rollback",
                                "pipeline_type": _pipeline_type,
                                "level": "INFO",
                            }
                            rollback_log_entries.append(rollback_entry)
                            if run_logger:
                                run_logger.stream_entry(rollback_entry)
                        except Exception as rollback_exc:  # noqa: BLE001
                            log.warning(
                                "Pipeline rollback failed for %s %s: %s",
                                _wp_id,
                                _pipeline_type,
                                rollback_exc,
                            )

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
                "run_log": [start_entry, log_entry] + rollback_log_entries,
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

```
###  Path: `/orchestrator/src/nodes/docs.py`

```py
"""
nodes/docs.py — Documentation node.

Creates a Deep Agent with the Documentation persona prompt and MCP tools,
invokes it to update project documentation for the current work package.

Slim prompt strategy
--------------------
``_build_docs_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Documentation persona
system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_docs_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import build_stage_prompt, create_stage_node


def _build_docs_prompt(state: WorkflowState) -> str:
    """Construct the documentation agent's user-turn prompt."""
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),  # type: ignore[call-overload]
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

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the PM persona system
prompt loaded from ``personas/ledger/claude-code/``.

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

from . import build_stage_prompt, create_stage_node


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

    return build_stage_prompt(
        project_path,
        preamble=f"Please start your work on the project.\n\n**Plan file:** {plan_file}",
        extra=f"---\n\n# Plan Document\n\n{plan_content}",
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

Slim prompt strategy
--------------------
``_build_qa_prompt()`` produces a minimal user-turn prompt containing only
immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the QA persona system
prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_qa_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import build_stage_prompt, create_stage_node


def _build_qa_prompt(state: WorkflowState) -> str:
    """Construct the QA agent's user-turn prompt."""
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

Slim prompt strategy
--------------------
``_build_release_engineer_prompt()`` produces a minimal user-turn prompt
containing only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Release Engineer
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

from . import build_stage_prompt, create_stage_node


def _build_release_engineer_prompt(state: WorkflowState) -> str:
    """Construct the Release Engineer agent's user-turn prompt."""
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),  # type: ignore[call-overload]
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

```
###  Path: `/orchestrator/src/nodes/security_auditor.py`

```py
"""
nodes/security_auditor.py — Security Auditor node.

Creates a Deep Agent with the Security Auditor persona prompt and MCP tools,
invokes it to run OWASP/dependency checks and complete the security-audit
pipeline for the current work package.

Slim prompt strategy
--------------------
``_build_security_auditor_prompt()`` produces a minimal user-turn prompt
containing only immediate runtime context:

- ``project_path`` — concrete path for every MCP tool call.
- ``wp_id`` — active work package identifier.

The prompt is assembled by :func:`~src.nodes.build_stage_prompt`, the
single source of truth for user-turn prompt structure. Identity declarations,
workflow steps, and MCP tool call guidance live in the Security Auditor
persona system prompt loaded from ``personas/ledger/claude-code/``.

Public factory
--------------
:func:`make_security_auditor_node`
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

from . import build_stage_prompt, create_stage_node


def _build_security_auditor_prompt(state: WorkflowState) -> str:
    """Construct the Security Auditor agent's user-turn prompt."""
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),  # type: ignore[call-overload]
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

```