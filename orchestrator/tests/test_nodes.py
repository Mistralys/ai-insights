"""
test_nodes.py — Unit tests for the six Deep Agent stage nodes.

These tests verify module structure, factory return types, state-update
conformance, error handling, and stage-specific requirements (PM plan content,
synthesis no WP ID) — without making any real LLM or MCP calls.

All Deep Agent invocations are patched at the ``deepagents.create_deep_agent``
import level so tests run without API keys.
"""

from __future__ import annotations

import importlib
import textwrap
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Minimal config stub
# ---------------------------------------------------------------------------

class _FakeConfig:
    """Minimal Config-like object for test injection."""
    model_name = "claude-test"
    workspace_root = Path(__file__).resolve().parent.parent.parent  # ai-insights root
    capture_dialogues = False  # Default off; override in specific test classes


FAKE_CONFIG = _FakeConfig()
FAKE_TOOLS: list[Any] = []  # MCP tools not needed for unit tests of nodes


# ---------------------------------------------------------------------------
# Base state fixture
# ---------------------------------------------------------------------------

def base_state(
    *,
    project_path: str = "/project",
    target_project_path: str = "/target",
    current_wp_id: str = "WP-001",
    plan_file: str = "plan.md",
) -> dict:
    return {
        "project_path": project_path,
        "plan_file": plan_file,
        "target_project_path": target_project_path,
        "current_stage": "",
        "current_wp_id": current_wp_id,
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


# ---------------------------------------------------------------------------
# Mock factory helpers
# ---------------------------------------------------------------------------

def _make_agent_mock(response: str = "Done.") -> MagicMock:
    """Return a mock compiled Deep Agent that returns *response* as last message."""
    msg = MagicMock()
    msg.content = response
    agent = MagicMock()
    agent.ainvoke = AsyncMock(return_value={"messages": [msg]})
    return agent


def _patch_deep_agent(response: str = "Done."):
    """Context manager: patches deepagents.create_deep_agent and LocalShellBackend."""
    agent_mock = _make_agent_mock(response)
    create_patch = patch(
        "deepagents.create_deep_agent",
        return_value=agent_mock,
    )
    backend_patch = patch(
        "deepagents.backends.LocalShellBackend",
        return_value=MagicMock(),
    )
    return create_patch, backend_patch


def _patch_persona(content: str = "Persona content"):
    """Context manager: patches src.utils.persona.load_persona."""
    return patch("src.utils.persona.load_persona", return_value=content)


# ---------------------------------------------------------------------------
# Tests: all 6 modules importable with correct factory functions
# ---------------------------------------------------------------------------

class TestModuleStructure:
    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    def test_module_importable_and_has_factory(self, module_name, factory_name):
        """Each of the 6 modules must be importable and export the factory."""
        mod = importlib.import_module(module_name)
        assert hasattr(mod, factory_name), (
            f"{module_name} missing {factory_name}"
        )
        factory = getattr(mod, factory_name)
        assert callable(factory), f"{factory_name} must be callable"

    def test_nodes_init_exposes_create_stage_node(self):
        """nodes/__init__.py must expose create_stage_node."""
        from src.nodes import create_stage_node
        assert callable(create_stage_node)

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    def test_factory_returns_callable(self, module_name, factory_name):
        """Each factory must return a callable (the node function)."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)
        assert callable(node_fn)


# ---------------------------------------------------------------------------
# Tests: successful invocation returns correct state-update fields
# ---------------------------------------------------------------------------

class TestNodeSuccessPath:
    async def _invoke_node(self, module_name: str, factory_name: str, **state_kwargs) -> dict:
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        create_p, backend_p = _patch_deep_agent("Agent completed successfully.")
        with _patch_persona(), create_p, backend_p:
            return await node_fn(base_state(**state_kwargs))

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_sets_stage_success_true(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result["stage_success"] is True

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_sets_stage_result(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result["stage_result"] == "Agent completed successfully."

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_appends_run_log_entry(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result.get("run_log"), "run_log must be non-empty on success"
        # stage_start is now at index 0; find the stage_complete entry by action.
        complete_entries = [
            e for e in result["run_log"] if e.get("action") == "stage_complete"
        ]
        assert complete_entries, "run_log must contain a stage_complete entry"
        entry = complete_entries[0]
        assert entry["result"] == "PASS"
        assert "stage" in entry
        assert "timestamp" in entry


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------

class TestNodeErrorHandling:
    async def _invoke_with_error(self, module_name: str, factory_name: str) -> dict:
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("Simulated agent crash"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            return await node_fn(base_state())

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_sets_stage_success_false(self, module_name, factory_name):
        """Any exception in the node must set stage_success=False, not crash."""
        result = await self._invoke_with_error(module_name, factory_name)
        assert result["stage_success"] is False

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_appends_to_errors(self, module_name, factory_name):
        result = await self._invoke_with_error(module_name, factory_name)
        assert result.get("errors"), "errors must be non-empty on exception"
        error = result["errors"][0]
        assert "Simulated agent crash" in error["message"]

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_does_not_propagate(self, module_name, factory_name):
        """Stage exceptions must be caught; the graph must not crash."""
        # Calling _invoke_with_error should complete without raising.
        result = await self._invoke_with_error(module_name, factory_name)
        assert result is not None


# ---------------------------------------------------------------------------
# Tests: stage-specific prompt requirements
# ---------------------------------------------------------------------------

class TestPMNodePromptIncludesPlanContent:
    async def test_pm_prompt_contains_plan_content(self, tmp_path):
        """PM node must include plan document content in the user prompt."""
        # Create a minimal plan file.
        plan_text = "# Test Plan\n\nThis is the plan content."
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_text, encoding="utf-8")

        from src.nodes.pm import make_pm_node

        captured_prompt: list[str] = []

        async def async_fake_invoke(inputs):
            """Capture the prompt from the first message."""
            captured_prompt.append(inputs["messages"][0]["content"])
            msg = MagicMock()
            msg.content = "PM done."
            return {"messages": [msg]}

        def fake_agent(*args, **kwargs):
            """Return a mock agent that captures prompt via ainvoke."""
            agent = MagicMock()
            agent.ainvoke = AsyncMock(side_effect=async_fake_invoke)
            return agent

        node_fn = make_pm_node(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona("PM Persona"), patch(
            "deepagents.create_deep_agent", side_effect=fake_agent
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(
                base_state(
                    project_path=str(tmp_path),
                    plan_file="plan.md",
                )
            )

        assert result["stage_success"] is True
        assert captured_prompt, "PM agent was not invoked"
        assert "This is the plan content." in captured_prompt[0], (
            "PM prompt must include plan document content"
        )


class TestSynthesisNodeNoWPRequired:
    def test_synthesis_prompt_does_not_use_wp_id(self):
        """Synthesis prompt must not require current_wp_id."""
        from src.nodes.synthesis import _build_synthesis_prompt

        # Call with an empty current_wp_id — should not raise or embed "WP-".
        state = base_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)

        assert "synthesis" in prompt.lower() or "project" in prompt.lower()
        # There should be no "WP-" reference in a synthesis prompt header.
        assert "Work package:" not in prompt, (
            "Synthesis prompt must not require or reference a specific WP ID"
        )

    async def test_synthesis_node_works_without_wp_id(self):
        """Synthesis node must succeed even when current_wp_id is empty."""
        from src.nodes.synthesis import make_synthesis_node

        node_fn = make_synthesis_node(FAKE_CONFIG, FAKE_TOOLS)
        state = base_state(current_wp_id="")

        create_p, backend_p = _patch_deep_agent("Synthesis complete.")
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(state)

        assert result["stage_success"] is True


# ---------------------------------------------------------------------------
# Tests: persona is loaded for the correct stage
# ---------------------------------------------------------------------------

class TestPersonaLoaded:
    @pytest.mark.parametrize("module_name,factory_name,expected_stage", [
        ("src.nodes.pm", "make_pm_node", "pm"),
        ("src.nodes.developer", "make_developer_node", "developer"),
        ("src.nodes.qa", "make_qa_node", "qa"),
        ("src.nodes.reviewer", "make_reviewer_node", "reviewer"),
        ("src.nodes.docs", "make_docs_node", "docs"),
        ("src.nodes.synthesis", "make_synthesis_node", "synthesis"),
    ])
    async def test_correct_stage_persona_is_loaded(
        self, module_name, factory_name, expected_stage
    ):
        """Each node must call load_persona with its own stage name."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        called_stages: list[str] = []

        def track_persona(stage, **kwargs):
            called_stages.append(stage)
            return f"Persona for {stage}"

        create_p, backend_p = _patch_deep_agent()
        with patch("src.utils.persona.load_persona", side_effect=track_persona), \
             create_p, backend_p:
            await node_fn(base_state())

        assert called_stages == [expected_stage], (
            f"{module_name} loaded persona for {called_stages!r}, "
            f"expected [{expected_stage!r}]"
        )


# ---------------------------------------------------------------------------
# Tests: return values only update allowed WorkflowState fields
# ---------------------------------------------------------------------------

class TestStateUpdateSchema:
    ALLOWED_UPDATE_KEYS = {
        "stage_result",
        "stage_success",
        "run_log",
        "errors",
        # Supervisor-owned fields may also be updated by nodes in principle,
        # but the generic factory only returns these four for stage nodes.
    }

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_update_keys_are_subset_of_allowed(
        self, module_name, factory_name
    ):
        """Successful node return must only include allowed WorkflowState keys."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state())

        unexpected = set(result) - self.ALLOWED_UPDATE_KEYS
        assert not unexpected, (
            f"{module_name} returned unexpected state keys: {unexpected}"
        )


# ---------------------------------------------------------------------------
# Tests: inject_project_path integration in create_stage_node
# ---------------------------------------------------------------------------

class TestToolWrappingInNode:
    """Verify that create_stage_node calls inject_project_path and passes the
    wrapped tools to create_deep_agent (WP-005 AC2)."""

    async def test_inject_project_path_is_called(self):
        """create_stage_node must call inject_project_path with the correct
        project_path from state."""
        from src.nodes import create_stage_node

        call_log: list[dict] = []

        def _fake_inject(tools: list, project_path: str) -> list:
            call_log.append({"tools": tools, "project_path": project_path})
            return tools  # pass through

        captured_tools: list[Any] = []

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured_tools.extend(kwargs.get("tools", []))
            return _make_agent_mock()

        fake_tools = [MagicMock()]
        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=fake_tools,
        )

        with _patch_persona(), \
             patch("src.nodes.inject_project_path", side_effect=_fake_inject), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(base_state(project_path="/myproject"))

        assert call_log, "inject_project_path was never called"
        assert call_log[0]["project_path"] == "/myproject", (
            f"inject_project_path called with wrong path: {call_log[0]['project_path']!r}"
        )

    async def test_wrapped_tools_injects_project_path_into_calls(self):
        """The wrapped tools returned by inject_project_path must auto-inject
        project_path into calls that omit it."""
        # Use real inject_project_path (not mocked) to verify end-to-end.
        from src.nodes import create_stage_node

        seen_inputs: list[Any] = []

        async def _tracking_ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            seen_inputs.append(input)
            return "ok"

        class _TrackingTool:
            """Plain class tool stub: MagicMock is intentionally avoided because
            MagicMock auto-creates any attribute on lookup, which would cause
            the hasattr(wrapped_tool, '_orig_ainvoke') assertion to pass as a
            false positive even if inject_project_path had not been called."""

            name = "tracking_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:  # noqa: A002
                return await _tracking_ainvoke(input, *args, **kwargs)

        real_tool = _TrackingTool()

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=[real_tool],
        )

        # Agent mock that calls tool.ainvoke({}) once during invocation.
        async def _agent_invokes_tool(inputs: dict) -> dict:
            # Simulate the agent calling the first wrapped tool with no project_path.
            wrapped = inputs.get("_wrapped_tools")
            msg = MagicMock()
            msg.content = "done"
            return {"messages": [msg]}

        # We need to capture what tools create_deep_agent receives.
        tools_passed_to_agent: list[Any] = []

        def _fake_create_agent(**kwargs: Any) -> MagicMock:
            tools_passed_to_agent.extend(kwargs.get("tools", []))
            agent = MagicMock()
            agent.ainvoke = AsyncMock(return_value={"messages": [MagicMock(content="done")]})
            return agent

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(base_state(project_path="/wrapped-path"))

        # Verify that create_deep_agent received exactly one tool.
        assert len(tools_passed_to_agent) == 1
        # Verify the tool has been monkeypatched (has the sentinel).
        wrapped_tool = tools_passed_to_agent[0]
        assert hasattr(wrapped_tool, "_orig_ainvoke"), (
            "Tool passed to create_deep_agent must have been wrapped by inject_project_path"
        )

    async def test_wrapped_tools_inject_project_path_on_invocation(self):
        """Wrapped tools must inject project_path when the caller omits it."""
        from src.utils.tool_wrappers import inject_project_path

        seen: list[Any] = []

        class _TrackingTool:
            """Plain class so _orig_ainvoke sentinel behaves correctly."""
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:
                seen.append(input)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], "/from-state")

        await tool.ainvoke({"agent_role": "Developer"})

        assert seen[0]["project_path"] == "/from-state"
        assert seen[0]["agent_role"] == "Developer"

    async def test_wrapped_tools_preserve_explicit_project_path(self):
        """Explicit project_path in tool call must not be overridden by wrapper."""
        from src.utils.tool_wrappers import inject_project_path

        seen: list[Any] = []

        class _TrackingTool:
            """Plain class so _orig_ainvoke sentinel behaves correctly."""
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:
                seen.append(input)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], "/default-path")

        await tool.ainvoke({"project_path": "/explicit-path", "type": "qa"})

        assert seen[0]["project_path"] == "/explicit-path"


# ---------------------------------------------------------------------------
# Tests: stage_start event
# ---------------------------------------------------------------------------

class TestStageStartEvent:
    """stage_start must be the first entry in run_log and carry required fields."""

    async def _invoke_developer(self) -> dict:
        from src.nodes.developer import make_developer_node
        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            return await node_fn(base_state(current_wp_id="WP-042"))

    async def test_stage_start_is_first_entry(self):
        result = await self._invoke_developer()
        assert result.get("run_log"), "run_log must be non-empty"
        assert result["run_log"][0]["action"] == "stage_start"

    async def test_stage_start_has_required_fields(self):
        result = await self._invoke_developer()
        entry = result["run_log"][0]
        assert entry["action"] == "stage_start"
        assert "stage" in entry
        assert "wp_id" in entry
        assert "iteration" in entry
        assert "timestamp" in entry
        assert "level" in entry

    async def test_stage_start_wp_id_matches_state(self):
        result = await self._invoke_developer()
        entry = result["run_log"][0]
        assert entry["wp_id"] == "WP-042"

    async def test_stage_start_emitted_on_error_path(self):
        """stage_start must be in run_log even when the agent raises."""
        from src.nodes.developer import make_developer_node
        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)
        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("boom"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-042"))

        assert result["run_log"][0]["action"] == "stage_start", (
            "stage_start must be first in run_log even on error path"
        )


# ---------------------------------------------------------------------------
# Tests: duration_s on stage_complete and stage_error
# ---------------------------------------------------------------------------

class TestDurationS:
    """duration_s must be present on stage_complete and stage_error entries."""

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_complete_has_duration_s(self, module_name, factory_name):
        """stage_complete entry must include duration_s as a float."""
        mod = __import__(module_name, fromlist=[factory_name])
        node_fn = getattr(mod, factory_name)(FAKE_CONFIG, FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state())

        entries = [e for e in result["run_log"] if e.get("action") == "stage_complete"]
        assert entries, "stage_complete entry missing from run_log"
        entry = entries[0]
        assert "duration_s" in entry, "stage_complete must include duration_s"
        assert isinstance(entry["duration_s"], (int, float)), (
            f"duration_s must be numeric, got {type(entry['duration_s'])}"
        )
        assert entry["duration_s"] >= 0

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_error_has_duration_s(self, module_name, factory_name):
        """stage_error entry must include duration_s (time until failure)."""
        mod = __import__(module_name, fromlist=[factory_name])
        node_fn = getattr(mod, factory_name)(FAKE_CONFIG, FAKE_TOOLS)
        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("agent crash"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state())

        entries = [e for e in result["run_log"] if e.get("action") == "stage_error"]
        assert entries, "stage_error entry missing from run_log"
        entry = entries[0]
        assert "duration_s" in entry, "stage_error must include duration_s"
        assert isinstance(entry["duration_s"], (int, float)), (
            f"duration_s must be numeric, got {type(entry['duration_s'])}"
        )
        assert entry["duration_s"] >= 0


# ---------------------------------------------------------------------------
# Tests: pipeline_result read-back
# ---------------------------------------------------------------------------

class TestPipelineResult:
    """pipeline_result must be emitted when ledger_get_work_package is available."""

    def _make_wp_tool(self, pipelines: list) -> Any:
        """Return a plain-class ledger_get_work_package tool returning *pipelines*.

        MagicMock is intentionally avoided: MagicMock auto-creates ``_orig_ainvoke``
        on attribute lookup, which causes ``inject_project_path`` to skip wrapping
        and call the wrong callable, silently breaking the read-back.
        """
        import json as _json

        return_value = _json.dumps({"work_package_id": "WP-001", "pipelines": pipelines})

        class _WPTool:
            """Plain-class stub so inject_project_path can wrap it correctly."""
            name = "ledger_get_work_package"

            def __init__(self, rv: str) -> None:
                self._rv = rv

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:  # noqa: A002
                return self._rv

        return _WPTool(return_value)

    async def test_pipeline_result_emitted_when_tool_available(self):
        """pipeline_result entry must appear in run_log when a WP tool is present."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {
                "type": "implementation",
                "status": "PASS",
                "artifacts": {"files_modified": ["src/foo.py"]},
                "metrics": {"tests_passed": 5},
                "summary": ["Implemented feature X"],
                "duration_ms": 5000,
            }
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries, "pipeline_result entry expected in run_log"
        entry = pr_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["pipeline_type"] == "implementation"
        assert entry["pipeline_status"] == "PASS"
        assert entry["files_modified"] == ["src/foo.py"]
        assert entry["metrics"] == {"tests_passed": 5}
        assert entry["summary"] == ["Implemented feature X"]
        assert entry["duration_s"] == 5.0

    async def test_pipeline_result_duration_s_from_duration_ms(self):
        """duration_s must be derived from duration_ms (ms / 1000, rounded to 1 dp)."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "qa", "status": "PASS", "duration_ms": 3700}
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries
        assert pr_entries[0]["duration_s"] == 3.7

    async def test_pipeline_result_none_duration_when_no_duration_ms(self):
        """duration_s must be None when duration_ms is absent from WP data."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "implementation", "status": "PASS"}
            # no duration_ms
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries
        assert pr_entries[0]["duration_s"] is None

    async def test_pipeline_result_not_emitted_when_no_wp_id(self):
        """pipeline_result must not be emitted when current_wp_id is empty."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "implementation", "status": "PASS"}
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id=""))  # empty wp_id

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries, "pipeline_result must not be emitted when wp_id is empty"

    async def test_pipeline_result_not_emitted_without_tool(self):
        """No pipeline_result when FAKE_TOOLS has no ledger_get_work_package tool."""
        from src.nodes.developer import make_developer_node

        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)  # FAKE_TOOLS = []
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries, "pipeline_result must not be emitted when no wp tool exists"

    async def test_read_back_failure_does_not_affect_stage_success(self):
        """Failure in ledger_get_work_package must not set stage_success=False."""
        from src.nodes.developer import make_developer_node

        class _FailingWPTool:
            """Plain-class stub that always raises on invocation."""
            name = "ledger_get_work_package"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> None:  # noqa: A002
                raise RuntimeError("MCP unavailable")

        node_fn = make_developer_node(FAKE_CONFIG, [_FailingWPTool()])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is True, (
            "Read-back failure must not affect stage_success"
        )
        # Also confirm no pipeline_result was emitted.
        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries

    async def test_pipeline_result_not_emitted_when_pipelines_list_is_empty(self):
        """No pipeline_result entry must appear when ledger_get_work_package
        returns a WP whose pipelines list is empty (no pipeline has run yet)."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([])  # empty pipelines list
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [
            e for e in result["run_log"] if e.get("action") == "pipeline_result"
        ]
        assert not pr_entries, (
            "pipeline_result must not be emitted when WP has no pipelines"
        )


# ---------------------------------------------------------------------------
# Tests: dialogue_captured event
# ---------------------------------------------------------------------------


class _CaptureConfig:
    """Config stub with capture_dialogues=True."""
    model_name = "claude-test"
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = True


class _NoCaptureConfig:
    """Config stub with capture_dialogues=False."""
    model_name = "claude-test"
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = False


class TestDialogueCaptured:
    """dialogue_captured must appear in run_log when capture_dialogues=True."""

    async def _invoke_with_capture(self, capture: bool, wp_id: str = "WP-001") -> dict:
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig() if capture else _NoCaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch(
                 "src.nodes.write_dialogue",
                 return_value=Path("/tmp/WP-001-developer-r0.md"),
             ), \
             patch(
                 "src.nodes.serialize_messages_to_markdown",
                 return_value="# Dialogue",
             ):
            return await node_fn(base_state(current_wp_id=wp_id))

    async def test_dialogue_captured_emitted_when_flag_true(self):
        """dialogue_captured must appear in run_log when capture_dialogues=True."""
        result = await self._invoke_with_capture(capture=True)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert dc_entries, "dialogue_captured entry expected in run_log when capture_dialogues=True"

    async def test_dialogue_captured_has_required_fields(self):
        """dialogue_captured entry must have action, stage, wp_id, file_path, level."""
        result = await self._invoke_with_capture(capture=True)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert dc_entries, "dialogue_captured entry missing"
        entry = dc_entries[0]
        assert entry["action"] == "dialogue_captured"
        assert "stage" in entry
        assert "wp_id" in entry
        assert entry.get("file_path"), "file_path must be a non-empty string"
        assert entry.get("level") == "INFO"

    async def test_dialogue_captured_not_emitted_when_flag_false(self):
        """No dialogue_captured entry when capture_dialogues=False."""
        result = await self._invoke_with_capture(capture=False)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when capture_dialogues=False"

    async def test_dialogue_captured_not_emitted_when_wp_id_empty(self):
        """No dialogue_captured entry when wp_id is empty (even if flag is True)."""
        result = await self._invoke_with_capture(capture=True, wp_id="")
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when wp_id is empty"

    async def test_write_dialogue_failure_does_not_affect_stage_success(self):
        """A PermissionError (or any exception) from write_dialogue must not
        cause stage_success=False or propagate as an exception."""
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch(
                 "src.nodes.serialize_messages_to_markdown",
                 return_value="# Dialogue",
             ), \
             patch(
                 "src.nodes.write_dialogue",
                 side_effect=PermissionError("disk full"),
             ):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is True, (
            "write_dialogue failure must not set stage_success=False"
        )
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must not appear in run_log when write_dialogue raises"
        )
