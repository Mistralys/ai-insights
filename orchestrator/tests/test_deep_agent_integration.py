"""
test_deep_agent_integration.py — Integration tests for the orchestrator's Deep Agent pipeline.

These tests exercise the real ``create_deep_agent`` call with a
``ToolCallableFakeChatModel`` — no LLM API keys required.

``@pytest.mark.deepagent`` marks every test in this module.  Run the suite with::

    python -m pytest tests/test_deep_agent_integration.py -v -m deepagent

Architecture note
-----------------
Unlike ``test_nodes.py``, these tests do **not** patch ``deepagents.create_deep_agent``.
Exercising the real call is the entire point: the tests verify that the orchestrator's
tool wrappers, middleware stack, and stream accumulation function correctly when wired
through the actual Deep Agents harness.

StructuredTool requirement
--------------------------
Deep Agents' ``SubAgentMiddleware`` (added automatically by ``create_deep_agent``)
invokes LangGraph's ``ToolNode`` with the main agent's tools.  ``ToolNode`` requires
``BaseTool`` instances; plain ``_MockTool`` objects from
:mod:`tests.helpers.mock_tools` are not ``BaseTool`` subclasses and would raise
``ValueError`` during agent construction.

Both integration tests therefore use :class:`~langchain_core.tools.StructuredTool`
instances created by the :func:`_make_ledger_tool` and :func:`_make_read_file_tool`
helpers.  These are proper ``BaseTool`` subclasses and are fully compatible with
the LangGraph ``ToolNode`` / Deep Agents pipeline.

Note on schema and kwargs
--------------------------
When a ``StructuredTool`` is created with a schema that has **no declared fields**
(e.g. ``_AnyArgsSchema``), LangChain's ``_to_args_and_kwargs`` short-circuits and
passes ``**{}`` to the coroutine.  This is acceptable for call-count assertions
(the call is still recorded).  For value assertions (test 2), the tool coroutine
declares ``file_path: str`` explicitly so that LangChain infers a proper one-field
schema and passes the argument through correctly.

Dependencies
------------
- WP-002: ``tests/helpers/fake_chat_model.py``, ``tests/conftest._DeepAgentFakeConfig``

Version dependencies
--------------------
``test_error_rollback_cancels_pipeline_through_deep_agent`` relies on ``RuntimeError``
propagating out of Deep Agents' internal ``ToolNode`` uncaught (the exception is not
wrapped into a ``ToolMessage``).  This behavior was empirically confirmed with
**Deep Agents 0.5.2**.  If a future release adds ``handle_tool_errors=True`` to its
``ToolNode``, the ``RuntimeError`` would be absorbed into a ``ToolMessage`` and the
rollback path would never be reached — the test would produce a false-positive green
result while the production rollback mechanism silently stopped working.  If the
rollback test fails unexpectedly, check the installed Deep Agents version first.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict

from tests.conftest import _DeepAgentFakeConfig
from tests.helpers.fake_chat_model import ToolCallableFakeChatModel

# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

class _AnyArgsSchema(BaseModel):
    """Permissive schema with no declared fields.

    Used for ledger tools in test 1 where only the call *count* matters.
    LangChain short-circuits validation for schemas with no declared fields
    and passes ``**{}`` to the coroutine, so the ``calls`` list records empty
    dicts — but ``len(calls)`` still correctly reflects the number of
    invocations.
    """

    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------------------
# Tool factory helpers
# ---------------------------------------------------------------------------

def _make_ledger_tool(name: str, calls_store: list) -> StructuredTool:
    """Return a ``StructuredTool`` that appends to *calls_store* on each call.

    Uses ``_AnyArgsSchema`` (no declared fields) so the tool accepts any
    kwargs without a tight schema.  Suitable for call-count assertions.

    Parameters
    ----------
    name:
        The MCP tool name (e.g. ``"ledger_begin_work"``).
    calls_store:
        Mutable list to which each invocation appends its kwargs.

    Returns
    -------
    StructuredTool
        A ``BaseTool`` subclass compatible with Deep Agents / LangGraph ToolNode.
    """
    async def _run(**kwargs: Any) -> str:
        calls_store.append(kwargs)
        return '{"status": "ok"}'

    return StructuredTool.from_function(
        coroutine=_run,
        name=name,
        description=f"Mock {name} for integration testing",
        args_schema=_AnyArgsSchema,
    )


def _make_read_file_tool(calls_store: list) -> StructuredTool:
    """Return a ``StructuredTool`` for ``read_file`` with explicit ``file_path`` arg.

    Unlike :func:`_make_ledger_tool`, this declares ``file_path: str`` in the
    coroutine signature so LangChain infers a proper one-field schema.  This
    ensures that the ``file_path`` value (after middleware rewriting) is
    correctly forwarded to ``calls_store``.

    Parameters
    ----------
    calls_store:
        Mutable list to which each invocation appends ``{"file_path": value}``.

    Returns
    -------
    StructuredTool
        A ``BaseTool`` subclass compatible with Deep Agents / LangGraph ToolNode.
    """
    async def _run(file_path: str) -> str:
        calls_store.append({"file_path": file_path})
        return "file contents"

    return StructuredTool.from_function(
        coroutine=_run,
        name="read_file",
        description="Read a file",
    )


# ---------------------------------------------------------------------------
# Test 1 — Full stage-node lifecycle through real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_stage_node_completes_with_fake_model() -> None:
    """Exercises ``create_stage_node`` → ``create_deep_agent`` → tool-calling loop.

    Scripted model sequence:

    1. Tool call to ``ledger_begin_work``
    2. Tool call to ``ledger_complete_pipeline``
    3. Final text message (``"Implementation complete."``)

    The test verifies the happy-path lifecycle of a Developer pipeline stage
    end-to-end without consuming LLM API tokens:

    - ``node_fn`` returns ``stage_success=True``.
    - ``ledger_begin_work`` mock records exactly 1 call.
    - ``ledger_complete_pipeline`` mock records exactly 1 call.

    Configuration
    -------------
    ``_DeepAgentFakeConfig(model=fake_model)`` returns the ``ToolCallableFakeChatModel``
    instance from ``resolve_model_for_stage()``, which is passed directly to
    ``create_deep_agent(model=…)`` to bypass real LLM provider resolution.

    Tools
    -----
    ``StructuredTool`` instances (from :func:`_make_ledger_tool`) are used instead of
    plain ``_MockTool`` objects because Deep Agents' ``SubAgentMiddleware`` requires
    ``BaseTool`` instances when constructing its internal ``ToolNode``.
    """
    from src.nodes import create_stage_node

    # Per-tool call tracking lists.
    bw_calls: list = []
    cp_calls: list = []

    begin_work_tool = _make_ledger_tool("ledger_begin_work", bw_calls)
    complete_pipeline_tool = _make_ledger_tool("ledger_complete_pipeline", cp_calls)
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])
    get_work_package_tool = _make_ledger_tool("ledger_get_work_package", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [
        begin_work_tool,
        complete_pipeline_tool,
        get_next_action_tool,
        get_project_status_tool,
        get_work_package_tool,
        cancel_pipeline_tool,
    ]

    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_begin_work",
                "args": {
                    "work_package_id": "WP-001",
                    "type": "implementation",
                    "agent_role": "Developer",
                },
                "id": "call-begin-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_complete_pipeline",
                "args": {
                    "work_package_id": "WP-001",
                    "type": "implementation",
                    "status": "PASS",
                    "summary": "Done.",
                    "agent_role": "Developer",
                    "comments": [
                        {"type": "improvement", "priority": "low", "note": "Clean code."},
                    ],
                },
                "id": "call-complete-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(content="Implementation complete."),
    ]))

    config = _DeepAgentFakeConfig(model=fake_model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: "Implement WP-001.",
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/test/project",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": "WP-001",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-stage-node-001"}
    )

    result = await node_fn(state, langgraph_config)

    assert result["stage_success"] is True

    assert len(bw_calls) == 1, (
        f"ledger_begin_work must be called exactly once; got {len(bw_calls)}"
    )
    assert len(cp_calls) == 1, (
        f"ledger_complete_pipeline must be called exactly once; got {len(cp_calls)}"
    )


# ---------------------------------------------------------------------------
# Test 2 — PathNormalizationMiddleware rewrites paths through real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_path_middleware_rewrites_through_deep_agent() -> None:
    """Exercises ``create_deep_agent`` directly with ``PathNormalizationMiddleware``.

    A mock ``read_file`` tool is scripted to receive
    ``file_path="/Users/dev/project/src/main.py"`` from the LLM.  After
    middleware processing, the tool must record the rewritten value
    ``file_path="/src/main.py"``.

    This test verifies that ``PathNormalizationMiddleware`` correctly intercepts
    tool calls and rewrites absolute host paths to virtual ``/``-rooted paths
    *before* the tool's ``ainvoke`` receives the arguments — covering the real
    ``awrap_tool_call`` dispatch path inside Deep Agents.

    Tools
    -----
    :func:`_make_read_file_tool` creates a ``StructuredTool`` with an explicit
    ``file_path: str`` parameter so LangChain infers a proper schema and forwards
    the (rewritten) ``file_path`` value to the tracking list.
    """
    from deepagents import create_deep_agent
    from deepagents.backends import LocalShellBackend

    from src.utils.path_middleware import PathNormalizationMiddleware

    root_dir = "/Users/dev/project"

    rf_calls: list = []
    read_file_tool = _make_read_file_tool(rf_calls)

    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "read_file",
                "args": {"file_path": "/Users/dev/project/src/main.py"},
                "id": "call-read-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(content="Done."),
    ]))

    path_middleware = PathNormalizationMiddleware(root_dir)
    backend = LocalShellBackend(root_dir=None, virtual_mode=False)

    agent = create_deep_agent(
        model=fake_model,
        backend=backend,
        system_prompt="You are a helpful assistant.",
        tools=[read_file_tool],
        middleware=[path_middleware],
    )

    run_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-middleware-001"}
    )

    async for _stream_item in agent.astream(
        {"messages": [{"role": "user", "content": "Read /Users/dev/project/src/main.py"}]},
        stream_mode="messages",
        subgraphs=True,
        config=run_config,
    ):
        pass  # consume the stream; side-effects on rf_calls are what we verify

    assert len(rf_calls) >= 1, (
        "read_file tool must have been called at least once"
    )

    # The middleware rewrites the absolute host path to a virtual /-rooted path.
    file_path_received = rf_calls[0]["file_path"]
    assert file_path_received == "/src/main.py", (
        f"Expected file_path '/src/main.py' after PathNormalizationMiddleware rewriting, "
        f"got {file_path_received!r}"
    )


# ---------------------------------------------------------------------------
# Tool factory helper — project_path-aware ledger tool
# ---------------------------------------------------------------------------

def _make_project_status_tool(calls_store: list) -> StructuredTool:
    """Return a ``StructuredTool`` for ``ledger_get_project_status`` with an explicit
    ``project_path`` parameter.

    Unlike :func:`_make_ledger_tool` (which uses ``_AnyArgsSchema`` and causes
    LangChain to pass ``**{}`` to the coroutine), this helper declares
    ``project_path: str`` explicitly in the coroutine signature.  LangChain
    therefore infers a proper one-field schema and correctly forwards the
    (injected) ``project_path`` value to ``calls_store``.

    Parameters
    ----------
    calls_store:
        Mutable list to which each invocation appends ``{"project_path": value}``.
    """
    async def _run(project_path: str = "") -> str:
        calls_store.append({"project_path": project_path})
        return '{"status": "ok"}'

    return StructuredTool.from_function(
        coroutine=_run,
        name="ledger_get_project_status",
        description="Mock ledger_get_project_status for inject_project_path testing",
    )


# ---------------------------------------------------------------------------
# Tool factory helper — cancel_pipeline input-capturing tool
# ---------------------------------------------------------------------------

def _make_cancel_pipeline_tool(calls_store: list) -> StructuredTool:
    """Return a ``StructuredTool`` for ``ledger_cancel_pipeline`` that captures
    the raw ``ainvoke`` input dict *before* LangChain schema processing.

    ``_AnyArgsSchema`` causes LangChain's ``_to_args_and_kwargs`` to pass
    ``**{}`` to the coroutine, discarding ``auto_cancelled`` and other args.
    This helper intercepts at the ``ainvoke`` boundary (below
    ``inject_project_path`` / ``restrict_to_wp`` but above LangChain's schema
    validation) so that ``calls_store`` records the full dict — including
    ``auto_cancelled=True`` — as passed by :func:`_handle_rollback`.

    Parameters
    ----------
    calls_store:
        Mutable list to which each invocation appends the raw call dict.
        For flat-dict calls (how ``_handle_rollback`` invokes the tool),
        the entire dict is appended.  For ToolCall-structure calls, the
        nested ``args`` dict is appended.
    """
    async def _run(**kwargs: Any) -> str:
        return '{"status": "ok"}'

    tool = StructuredTool.from_function(
        coroutine=_run,
        name="ledger_cancel_pipeline",
        description="Mock ledger_cancel_pipeline for rollback integration testing",
        args_schema=_AnyArgsSchema,
    )

    # Capture the raw ainvoke input BEFORE LangChain schema processing strips
    # unknown fields.  This wrapper is installed BEFORE create_stage_node applies
    # its own wrappers (inject_project_path, restrict_to_wp), so it sits at the
    # bottom of the chain and sees the final dict after all outer wrappers have
    # added/modified fields.
    _original = tool.ainvoke

    async def _capturing_ainvoke(
        input: Any, *args: Any, **kwargs_inner: Any
    ) -> Any:
        if isinstance(input, dict):
            if "args" in input and isinstance(input["args"], dict):
                calls_store.append(dict(input["args"]))
            else:
                calls_store.append(dict(input))
        return await _original(input, *args, **kwargs_inner)

    object.__setattr__(tool, "ainvoke", _capturing_ainvoke)
    return tool


# ---------------------------------------------------------------------------
# Test 3 — inject_project_path wrapper injects project_path through real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_project_path_injected_through_deep_agent() -> None:
    """Verifies ``inject_project_path`` wrapper injects ``project_path`` through
    the real ``create_deep_agent`` pipeline.

    The scripted model calls ``ledger_get_project_status`` with **no**
    ``project_path`` argument.  After ``inject_project_path`` wrapping (applied
    automatically by ``create_stage_node``), the mock tool must receive
    ``project_path`` matching the state's ``project_path`` value.

    Tool schema note
    ----------------
    :func:`_make_project_status_tool` declares ``project_path: str`` explicitly
    so that LangChain infers a proper one-field schema and forwards the injected
    value to the coroutine.  Using ``_AnyArgsSchema`` (no declared fields) would
    cause LangChain to short-circuit and pass ``**{}`` to the coroutine,
    making the value assertion impossible.
    """
    from src.nodes import create_stage_node

    gps_calls: list = []

    get_project_status_tool = _make_project_status_tool(gps_calls)
    # Provide minimal required tools so the stage node can be constructed.
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [get_project_status_tool, get_next_action_tool, cancel_pipeline_tool]

    # The scripted model deliberately omits project_path from its tool call.
    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_get_project_status",
                "args": {},  # no project_path — inject_project_path must add it
                "id": "call-gps-inject-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(content="Project status checked."),
    ]))

    config = _DeepAgentFakeConfig(model=fake_model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: "Check project status.",
        config=config,
        mcp_tools=tools,
    )

    project_path = "/test/inject-project"
    state: dict = {
        "project_path": project_path,
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": "WP-001",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-inject-project-path-001"}
    )

    await node_fn(state, langgraph_config)

    assert len(gps_calls) >= 1, (
        f"ledger_get_project_status must be called at least once; got {len(gps_calls)}"
    )
    assert gps_calls[0]["project_path"] == project_path, (
        f"Expected inject_project_path to inject project_path={project_path!r}, "
        f"got {gps_calls[0].get('project_path')!r}"
    )


# ---------------------------------------------------------------------------
# Test 4 — restrict_to_wp blocks cross-WP write calls through real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_restrict_to_wp_blocks_cross_wp_through_deep_agent() -> None:
    """Verifies ``restrict_to_wp`` blocks cross-WP write calls through
    the real ``create_deep_agent`` pipeline.

    The stage is configured with ``current_wp_id="WP-001"``.  The scripted model
    attempts ``ledger_begin_work`` with ``work_package_id="WP-999"`` (a
    cross-WP write).  The ``restrict_to_wp`` wrapper must intercept the call
    and return a soft-fail error to the agent, so the mock ``ledger_begin_work``
    coroutine is **never executed**.

    Tool choice note
    ----------------
    ``ledger_get_work_package`` is in ``_READ_ONLY_TOOLS`` and is exempt from
    the cross-WP guard.  ``ledger_begin_work`` is a write tool and is therefore
    subject to the guard — making it the correct tool to test the restriction.
    """
    from src.nodes import create_stage_node

    bw_calls: list = []

    begin_work_tool = _make_ledger_tool("ledger_begin_work", bw_calls)
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [
        begin_work_tool,
        get_next_action_tool,
        get_project_status_tool,
        cancel_pipeline_tool,
    ]

    # The scripted model attempts to claim a different work package (WP-999)
    # than the active one (WP-001).  restrict_to_wp must block the call.
    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_begin_work",
                "args": {
                    "work_package_id": "WP-999",  # cross-WP attempt — must be blocked
                    "type": "implementation",
                    "agent_role": "Developer",
                },
                "id": "call-bw-cross-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(content="Done."),
    ]))

    config = _DeepAgentFakeConfig(model=fake_model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: "Implement WP-001.",
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/test/restrict-project",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": "WP-001",  # active WP — cross-WP call to WP-999 must be blocked
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-restrict-to-wp-001"}
    )

    await node_fn(state, langgraph_config)

    assert len(bw_calls) == 0, (
        f"ledger_begin_work must NOT be called for cross-WP attempt WP-999 "
        f"(active WP is WP-001); got {len(bw_calls)} call(s)"
    )


# ---------------------------------------------------------------------------
# Test 5 — post-completion guard intercepts ledger_get_next_action through
#           real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_post_completion_guard_through_deep_agent() -> None:
    """Verifies ``_install_post_completion_guard`` intercepts ``ledger_get_next_action``
    after ``ledger_complete_pipeline`` through the real ``create_deep_agent`` pipeline.

    Scripted model sequence:

    1. Tool call to ``ledger_begin_work``
    2. Tool call to ``ledger_complete_pipeline`` — sets ``completion_tracker["completed"]``
    3. Tool call to ``ledger_get_next_action`` — guard must intercept and return
       a synthetic ``{"action": "WAIT"}`` response without calling the original tool
    4. Final text message (``"Implementation complete."``)

    The test verifies that:

    - The stage completes successfully (``stage_success=True``).
    - The original ``ledger_get_next_action`` coroutine is **never** called (0 entries
      in ``gna_calls``).  The zero-call assertion is the functional proof that the
      guard intercepted the tool call and returned WAIT — the agent continued normally
      only because it received the synthetic response.
    """
    from src.nodes import create_stage_node

    # gna_calls tracks invocations of the ORIGINAL get_next_action coroutine.
    # The post-completion guard must prevent any coroutine calls after complete_pipeline.
    gna_calls: list = []

    begin_work_tool = _make_ledger_tool("ledger_begin_work", [])
    complete_pipeline_tool = _make_ledger_tool("ledger_complete_pipeline", [])
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", gna_calls)
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])
    get_work_package_tool = _make_ledger_tool("ledger_get_work_package", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [
        begin_work_tool,
        complete_pipeline_tool,
        get_next_action_tool,
        get_project_status_tool,
        get_work_package_tool,
        cancel_pipeline_tool,
    ]

    fake_model = ToolCallableFakeChatModel(messages=iter([
        # Step 1 — begin the pipeline
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_begin_work",
                "args": {
                    "work_package_id": "WP-001",
                    "type": "implementation",
                    "agent_role": "Developer",
                },
                "id": "call-bw-pcg-001",
                "type": "tool_call",
            }],
        ),
        # Step 2 — complete the pipeline; triggers completion_tracker["completed"] = True
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_complete_pipeline",
                "args": {
                    "work_package_id": "WP-001",
                    "type": "implementation",
                    "status": "PASS",
                    "summary": "Done.",
                    "agent_role": "Developer",
                    "comments": [
                        {"type": "improvement", "priority": "low", "note": "Clean code."},
                    ],
                },
                "id": "call-cp-pcg-001",
                "type": "tool_call",
            }],
        ),
        # Step 3 — attempt get_next_action; guard must intercept and return WAIT
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_get_next_action",
                "args": {"agent_role": "Developer"},
                "id": "call-gna-pcg-001",
                "type": "tool_call",
            }],
        ),
        # Step 4 — final text after receiving the synthetic WAIT response
        AIMessage(content="Implementation complete."),
    ]))

    config = _DeepAgentFakeConfig(model=fake_model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: "Implement WP-001.",
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/test/pcg-project",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": "WP-001",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-pcg-001"}
    )

    result = await node_fn(state, langgraph_config)

    assert result["stage_success"] is True

    assert len(gna_calls) == 0, (
        f"ledger_get_next_action original ainvoke must NOT be called after "
        f"ledger_complete_pipeline — post-completion guard must intercept and "
        f"return WAIT without delegating to the original tool. "
        f"Got {len(gna_calls)} call(s)."
    )


# ---------------------------------------------------------------------------
# Test 6 — error-path rollback cancels pipeline through real create_deep_agent
# ---------------------------------------------------------------------------

@pytest.mark.deepagent
async def test_error_rollback_cancels_pipeline_through_deep_agent() -> None:
    """Verifies that ``_handle_rollback`` calls ``ledger_cancel_pipeline`` with
    ``auto_cancelled=True`` through the real ``create_deep_agent`` pipeline.

    Scripted model sequence:

    1. Tool call to ``ledger_begin_work`` — sets ``begin_work_state["called"] = True``
    2. Tool call to ``crash_tool`` — raises ``RuntimeError`` from ``ainvoke``,
       propagating through Deep Agents to ``create_stage_node``'s exception handler

    The test verifies that:

    - The stage fails (``stage_success=False``).
    - ``ledger_cancel_pipeline`` is called exactly once with ``auto_cancelled=True``.

    Implementation note on ``_make_cancel_pipeline_tool``
    ------------------------------------------------------
    ``_AnyArgsSchema`` causes LangChain to short-circuit and pass ``**{}`` to the
    coroutine, discarding ``auto_cancelled``.  :func:`_make_cancel_pipeline_tool`
    captures the raw ``ainvoke`` input dict *before* schema processing, ensuring
    ``auto_cancelled=True`` is recorded in ``cp_calls``.

    Implementation note on ``crash_tool``
    --------------------------------------
    ``StructuredTool.ainvoke`` propagates coroutine exceptions directly (they are
    not wrapped in a ``ToolMessage`` — confirmed empirically with Deep Agents 0.5.2).
    The ``RuntimeError`` escapes ``_accumulate_stream`` (not retryable) and reaches
    ``create_stage_node``'s ``except Exception`` handler where rollback fires.
    """
    from src.nodes import create_stage_node

    # cp_calls records the raw ainvoke dict passed to ledger_cancel_pipeline,
    # captured below LangChain's schema validation by _make_cancel_pipeline_tool.
    cp_calls: list = []

    begin_work_tool = _make_ledger_tool("ledger_begin_work", [])
    cancel_pipeline_tool = _make_cancel_pipeline_tool(cp_calls)
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])

    # A StructuredTool whose coroutine raises RuntimeError — verified to propagate
    # through Deep Agents' pipeline to create_stage_node's exception handler.
    async def _crash(**kwargs: Any) -> str:
        raise RuntimeError("simulated tool crash for rollback integration testing")

    crash_tool = StructuredTool.from_function(
        coroutine=_crash,
        name="crash_tool",
        description="Crash tool for error-rollback integration testing",
        args_schema=_AnyArgsSchema,
    )

    tools = [
        begin_work_tool,
        cancel_pipeline_tool,
        get_next_action_tool,
        get_project_status_tool,
        crash_tool,
    ]

    # Step 1: begin_work is called (begin_work_state["called"] = True via tracker).
    # Step 2: crash_tool raises RuntimeError → exception reaches stage node → rollback.
    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "ledger_begin_work",
                "args": {
                    "work_package_id": "WP-001",
                    "type": "implementation",
                    "agent_role": "Developer",
                },
                "id": "call-bw-rollback-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "crash_tool",
                "args": {},
                "id": "call-crash-rollback-001",
                "type": "tool_call",
            }],
        ),
    ]))

    config = _DeepAgentFakeConfig(model=fake_model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: "Implement WP-001.",
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/test/rollback-project",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "",
        "current_wp_id": "WP-001",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-rollback-001"}
    )

    result = await node_fn(state, langgraph_config)

    # Stage must fail (exception was caught by create_stage_node's except block).
    assert result.get("stage_success") is False, (
        f"Stage must fail after crash_tool raises RuntimeError; "
        f"got stage_success={result.get('stage_success')!r}"
    )

    assert len(cp_calls) == 1, (
        f"ledger_cancel_pipeline must be called exactly once during error rollback; "
        f"got {len(cp_calls)} call(s)"
    )
    assert cp_calls[0].get("auto_cancelled") is True, (
        f"ledger_cancel_pipeline must be called with auto_cancelled=True; "
        f"got: {cp_calls[0]}"
    )


# ---------------------------------------------------------------------------
# Live test helpers
# ---------------------------------------------------------------------------

def _resolve_live_model() -> Any:
    """Resolve a real chat model from the environment.

    Checks for ``ANTHROPIC_API_KEY`` (prefers Anthropic) then
    ``GOOGLE_API_KEY`` (falls back to Google).  Calls ``pytest.skip`` when
    neither key is set, so the test is reported as skipped rather than
    failing.  Also skips when the matching provider package is not installed.

    Returns
    -------
    BaseChatModel
        A ``ChatAnthropic`` or ``ChatGoogleGenerativeAI`` instance.
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    google_key = os.environ.get("GOOGLE_API_KEY", "").strip()

    if not anthropic_key and not google_key:
        pytest.skip(
            "No LLM API key found — set ANTHROPIC_API_KEY or GOOGLE_API_KEY "
            "to run live tests"
        )

    if anthropic_key:
        try:
            from langchain_anthropic import ChatAnthropic  # type: ignore[import]
        except ImportError:
            pytest.skip(
                "langchain-anthropic not installed; run: pip install -e '.[anthropic]'"
            )
        model_slug = os.environ.get("LIVE_TEST_MODEL", "claude-sonnet-4-6")
        return ChatAnthropic(model=model_slug, api_key=anthropic_key)

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore[import]
    except ImportError:
        pytest.skip(
            "langchain-google-genai not installed; run: pip install -e '.[google]'"
        )
    model_slug = os.environ.get("LIVE_TEST_MODEL", "gemini-2.0-flash")
    return ChatGoogleGenerativeAI(model=model_slug, google_api_key=google_key)


class _LiveConfig:
    """Minimal Config-like stub for live tests.

    Accepts a real ``BaseChatModel`` instance and returns it from
    ``resolve_model_for_stage()``.  All other attributes are set to safe
    no-I/O defaults so the stage node does not attempt to write JSONL files
    during the smoke test.
    """

    capture_dialogues: bool = False
    stream_max_retries: int = 0
    stream_retry_base_delay_s: float = 10.0
    workspace_root: Path = Path(__file__).resolve().parent.parent.parent

    def __init__(self, model: Any) -> None:
        self._model = model

    def resolve_model_for_stage(self, stage: str) -> Any:  # noqa: ARG002
        """Return the injected model for any stage."""
        return self._model


# ---------------------------------------------------------------------------
# Test 7 — Developer stage live smoke test (real LLM + mock MCP tools)
# ---------------------------------------------------------------------------

@pytest.mark.live
async def test_developer_stage_live() -> None:
    """Live smoke test for the Developer stage with a real LLM and mock MCP tools.

    Skips gracefully when no LLM API key is set in the environment.  When run
    with a valid key (``pytest -m live``), exercises the full
    ``create_stage_node`` → ``create_deep_agent`` path and asserts:

    - At least one ``ledger_begin_work`` call was made.
    - No unhandled exception propagated out of the stage node.

    The test uses :class:`_LiveConfig` with a real ``ChatAnthropic`` (or
    ``ChatGoogleGenerativeAI``) model and ``StructuredTool`` mock tools that
    record call counts.  No MCP server build is required.

    Only structural properties are asserted (call count ≥ 1, no crash) rather
    than exact output, to tolerate LLM non-determinism.  Run on-demand before
    releases; not included in CI.
    """
    from src.nodes import create_stage_node

    model = _resolve_live_model()

    bw_calls: list = []
    begin_work_tool = _make_ledger_tool("ledger_begin_work", bw_calls)
    complete_pipeline_tool = _make_ledger_tool("ledger_complete_pipeline", [])
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    get_work_package_tool = _make_ledger_tool("ledger_get_work_package", [])
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [
        begin_work_tool,
        complete_pipeline_tool,
        get_next_action_tool,
        get_work_package_tool,
        get_project_status_tool,
        cancel_pipeline_tool,
    ]

    config = _LiveConfig(model=model)
    node_fn = create_stage_node(
        stage="developer",
        build_prompt=lambda state: (
            "You are the Developer agent.  Claim WP-001 by calling "
            "ledger_begin_work(work_package_id='WP-001', "
            "type='implementation', agent_role='Developer').  "
            "Then call ledger_complete_pipeline(work_package_id='WP-001', "
            "type='implementation', status='PASS', summary='Done.', "
            "agent_role='Developer', comments=[{type: improvement, "
            "priority: low, note: 'Smoke test — no real code written.'}]).  "
            "project_path is /smoke-test."
        ),
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/smoke-test",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "developer",
        "current_wp_id": "WP-001",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 1,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "live-test-developer-smoke-001"}
    )

    await node_fn(state, langgraph_config)

    assert len(bw_calls) >= 1, (
        f"test_developer_stage_live: expected at least one ledger_begin_work "
        f"call; got {len(bw_calls)}"
    )


# ---------------------------------------------------------------------------
# Test 8 — PM stage live smoke test (real LLM + mock MCP tools)
# ---------------------------------------------------------------------------

@pytest.mark.live
async def test_pm_stage_live() -> None:
    """Live smoke test for the PM stage with a real LLM and mock MCP tools.

    Skips gracefully when no LLM API key is set in the environment.  When run
    with a valid key (``pytest -m live``), exercises the full
    ``create_stage_node`` → ``create_deep_agent`` path and asserts:

    - At least one ``ledger_create_work_package`` call was made.
    - No unhandled exception propagated out of the stage node.

    Uses :class:`_LiveConfig` with a real LLM model and mock
    ``StructuredTool`` instances.  No MCP server build required.
    Run on-demand before releases; not included in CI.
    """
    from src.nodes import create_stage_node

    model = _resolve_live_model()

    cwp_calls: list = []
    create_wp_tool = _make_ledger_tool("ledger_create_work_package", cwp_calls)
    init_project_tool = _make_ledger_tool("ledger_initialize_project", [])
    get_next_action_tool = _make_ledger_tool("ledger_get_next_action", [])
    get_project_status_tool = _make_ledger_tool("ledger_get_project_status", [])
    cancel_pipeline_tool = _make_ledger_tool("ledger_cancel_pipeline", [])

    tools = [
        create_wp_tool,
        init_project_tool,
        get_next_action_tool,
        get_project_status_tool,
        cancel_pipeline_tool,
    ]

    config = _LiveConfig(model=model)
    node_fn = create_stage_node(
        stage="pm",
        build_prompt=lambda state: (
            "You are the Project Manager agent.  "
            "Call ledger_initialize_project to create the project ledger "
            "(plan_file='plan.md', "
            "project_path='/smoke-test').  "
            "Then call ledger_create_work_package to create WP-001 "
            "(assigned_to='Developer', dependencies=[], "
            "acceptance_criteria=['Implementation complete'], "
            "description='Smoke test WP', "
            "title='Smoke test WP').  "
            "project_path is /smoke-test."
        ),
        config=config,
        mcp_tools=tools,
    )

    state: dict = {
        "project_path": "/smoke-test",
        "plan_file": "plan.md",
        "target_project_path": "",
        "current_stage": "pm",
        "current_wp_id": "",
        "iteration": 1,
        "max_iterations": 10,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "run_log": [],
        "errors": [],
    }

    langgraph_config = RunnableConfig(
        configurable={"thread_id": "live-test-pm-smoke-001"}
    )

    await node_fn(state, langgraph_config)

    assert len(cwp_calls) >= 1, (
        f"test_pm_stage_live: expected at least one ledger_create_work_package "
        f"call; got {len(cwp_calls)}"
    )
