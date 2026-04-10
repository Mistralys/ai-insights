"""
test_nodes.py — Unit tests for the eight Deep Agent stage nodes.

These tests verify module structure, factory return types, state-update
conformance, error handling, and stage-specific requirements (PM plan content,
synthesis no WP ID) — without making any real LLM or MCP calls.

All Deep Agent invocations are patched at the ``deepagents.create_deep_agent``
import level so tests run without API keys.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Minimal config stub
# ---------------------------------------------------------------------------

class _FakeConfig:
    """Minimal Config-like object for test injection."""
    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent  # ai-insights root
    capture_dialogues = False  # Default off; override in specific test classes

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


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

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_start_contains_model_field(self, module_name, factory_name):
        """stage_start log entry must contain the resolved model identifier."""
        result = await self._invoke_node(module_name, factory_name)
        start_entries = [e for e in result["run_log"] if e.get("action") == "stage_start"]
        assert start_entries, "run_log must contain a stage_start entry"
        entry = start_entries[0]
        assert "model" in entry, "stage_start entry must have a 'model' field"
        assert entry["model"], "stage_start model field must be non-empty"

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_complete_contains_model_field(self, module_name, factory_name):
        """stage_complete log entry must contain the resolved model identifier."""
        result = await self._invoke_node(module_name, factory_name)
        complete_entries = [e for e in result["run_log"] if e.get("action") == "stage_complete"]
        assert complete_entries, "run_log must contain a stage_complete entry"
        entry = complete_entries[0]
        assert "model" in entry, "stage_complete entry must have a 'model' field"
        assert entry["model"], "stage_complete model field must be non-empty"


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

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_error_log_contains_model_field(self, module_name, factory_name):
        """stage_error log entry must contain the resolved model identifier."""
        result = await self._invoke_with_error(module_name, factory_name)
        error_entries = [e for e in result["run_log"] if e.get("action") == "stage_error"]
        assert error_entries, "run_log must contain a stage_error entry"
        entry = error_entries[0]
        assert "model" in entry, "stage_error entry must have a 'model' field"
        assert entry["model"], "stage_error model field must be non-empty"


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
    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = True

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _NoCaptureConfig:
    """Config stub with capture_dialogues=False."""
    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = False

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


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


# ---------------------------------------------------------------------------
# Tests: error-path dialogue capture (WP-002)
# ---------------------------------------------------------------------------


class TestErrorPathDialogueCapture:
    """Error-path dialogue capture: partial dialogue written when stage crashes
    after agent.ainvoke() populates _msgs."""

    class _BrokenMsg:
        """Message stub whose .content access raises, simulating a post-ainvoke crash."""

        @property
        def content(self) -> str:
            raise RuntimeError("Simulated failure in success path after ainvoke")

        usage_metadata = None

    async def _invoke_with_post_ainvoke_error(
        self, capture: bool = True, wp_id: str = "WP-001"
    ) -> dict:
        """Invoke developer node where agent.ainvoke() returns messages but
        subsequent .content access raises, driving the except path."""
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig() if capture else _NoCaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(
            return_value={"messages": [self._BrokenMsg()]}
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.nodes.write_dialogue", return_value=Path("/tmp/partial.md")), \
             patch("src.nodes.serialize_messages_to_markdown", return_value="# Partial"):
            return await node_fn(base_state(current_wp_id=wp_id))

    async def test_dialogue_captured_when_msgs_populated(self):
        """dialogue_captured must appear in run_log (partial=True) on the error
        path when _msgs contains messages collected before the crash."""
        result = await self._invoke_with_post_ainvoke_error()

        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert dc_entries, (
            "dialogue_captured must appear in run_log when _msgs is non-empty on error path"
        )
        entry = dc_entries[0]
        assert entry.get("partial") is True, (
            "Error-path dialogue_captured entry must have partial=True"
        )
        assert entry.get("level") == "INFO"
        assert entry.get("wp_id") == "WP-001"
        assert entry.get("file_path"), "file_path must be a non-empty string"

    async def test_stage_fails_even_when_partial_dialogue_written(self):
        """Stage must still return stage_success=False when error-path dialogue is written."""
        result = await self._invoke_with_post_ainvoke_error()

        assert result["stage_success"] is False

    async def test_no_dialogue_when_msgs_empty(self):
        """No dialogue_captured when exception occurs before agent.ainvoke()
        (empty _msgs — e.g. create_deep_agent raises)."""
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]

        with _patch_persona(), \
             patch(
                 "deepagents.create_deep_agent",
                 side_effect=RuntimeError("Pre-ainvoke crash"),
             ), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.nodes.write_dialogue", return_value=Path("/tmp/partial.md")), \
             patch("src.nodes.serialize_messages_to_markdown", return_value="# Partial"):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must NOT appear when _msgs is empty (exception before ainvoke)"
        )
        assert result["stage_success"] is False

    async def test_error_path_dialogue_failure_is_non_fatal(self):
        """write_dialogue failure on the error path must not crash the stage or
        change the returned stage_success or error values."""
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(
            return_value={"messages": [self._BrokenMsg()]}
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch(
                 "src.nodes.write_dialogue",
                 side_effect=PermissionError("disk full"),
             ), \
             patch("src.nodes.serialize_messages_to_markdown", return_value="# Partial"):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        # Stage must still return stage_success=False (original error preserved).
        assert result["stage_success"] is False
        # No dialogue_captured entry because write_dialogue raised.
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must not appear when write_dialogue raises on error path"
        )

    async def test_no_dialogue_when_capture_flag_false(self):
        """Error-path dialogue capture must respect capture_dialogues=False."""
        result = await self._invoke_with_post_ainvoke_error(capture=False)

        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must not appear when capture_dialogues=False"
        )

    async def test_no_dialogue_when_wp_id_empty(self):
        """Error-path dialogue capture must not fire when wp_id is empty."""
        result = await self._invoke_with_post_ainvoke_error(wp_id="")

        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must not appear when wp_id is empty"
        )


# ---------------------------------------------------------------------------
# Tests: slug derivation uses Path(...).name (WP-002)
# ---------------------------------------------------------------------------


class TestSlugDerivation:
    """create_stage_node must use Path(project_path_obj).name to derive the slug,
    which handles trailing-slash paths and pathlib.Path-typed inputs correctly."""

    async def _invoke_and_capture_slug_dir(self, project_path: Any) -> list[Path]:
        """Invoke developer node with the given project_path; return every
        slug_dir passed to write_dialogue."""
        from src.nodes.developer import make_developer_node

        captured_slug_dirs: list[Path] = []

        # write_dialogue(content, slug_dir, wp_id, stage) — positional signature.
        def _fake_write_dialogue(
            content: str, slug_dir: Path, wp_id: str, stage: str
        ) -> Path:
            captured_slug_dirs.append(slug_dir)
            return slug_dir / f"{wp_id}-{stage}-r0.md"

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.write_dialogue", side_effect=_fake_write_dialogue), \
             patch("src.nodes.serialize_messages_to_markdown", return_value="# Dialogue"):
            await node_fn(base_state(project_path=project_path, current_wp_id="WP-001"))

        return captured_slug_dirs

    async def test_trailing_slash_path_extracts_correct_slug(self):
        """Path with a trailing '/' must still produce the correct slug segment."""
        slug_dirs = await self._invoke_and_capture_slug_dir(
            "/some/ledger/root/2026-03-20-my-project/"
        )
        assert slug_dirs, "write_dialogue was not called (capture_dialogues must be True)"
        # slug_dir is workspace_root / "mcp-server" / "storage" / "ledger" / slug
        # — the last component must be the project slug, not an empty string.
        assert slug_dirs[0].name == "2026-03-20-my-project", (
            f"Expected slug '2026-03-20-my-project', got '{slug_dirs[0].name}'"
        )

    async def test_pathlib_path_typed_input_extracts_correct_slug(self):
        """A pathlib.Path-typed project_path must produce the correct slug segment."""
        slug_dirs = await self._invoke_and_capture_slug_dir(
            Path("/some/ledger/root/2026-03-20-my-project")
        )
        assert slug_dirs, "write_dialogue was not called (capture_dialogues must be True)"
        assert slug_dirs[0].name == "2026-03-20-my-project", (
            f"Expected slug '2026-03-20-my-project', got '{slug_dirs[0].name}'"
        )


# ---------------------------------------------------------------------------
# Tests: slim prompt content (WP-005)
# ---------------------------------------------------------------------------
# AC3: slim fields (project_path, wp_id where applicable, injection-safety
#      warning) are present in each _build_*_prompt() return value.
# AC4: identity/role declaration text is absent from each prompt.
# ---------------------------------------------------------------------------

_IDENTITY_PHRASES = [
    "You are the",
    "You are a",
    "As the ",
    "As a ",
    "Your role is",
    "Your task is to",
    "Your job is",
]

_SLIM_PROJECT_PATH = "/test/project/path"
_SLIM_WP_ID = "WP-099"


def _build_slim_state(**overrides) -> dict:
    """Minimal state dict for slim-prompt unit tests."""
    s = base_state(
        project_path=_SLIM_PROJECT_PATH,
        current_wp_id=_SLIM_WP_ID,
    )
    s.update(overrides)
    return s


class TestSlimPromptContent:
    """Direct unit tests on each _build_*_prompt() function.

    Verifies that the slimmed prompts (introduced in WP-001/002/003):
    - Include the mandatory runtime context fields (AC3).
    - Do not contain identity/role declaration phrases (AC4).
    """

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _assert_slim_fields_present(self, prompt: str, *, expect_wp: bool = True) -> None:
        """Assert all mandatory slim fields appear in *prompt*."""
        assert _SLIM_PROJECT_PATH in prompt, (
            f"project_path {_SLIM_PROJECT_PATH!r} must be present in prompt"
        )
        assert "ledger tool calls" in prompt, (
            "project_path reminder must be present in prompt"
        )
        if expect_wp:
            assert _SLIM_WP_ID in prompt, (
                f"wp_id {_SLIM_WP_ID!r} must be present in prompt"
            )

    def _assert_no_identity_phrases(self, prompt: str, node: str) -> None:
        """Assert none of the known identity/role declaration phrases appear."""
        for phrase in _IDENTITY_PHRASES:
            assert phrase not in prompt, (
                f"{node}: identity/role phrase {phrase!r} must not appear in slim prompt"
            )

    # ------------------------------------------------------------------
    # Developer node
    # ------------------------------------------------------------------

    def test_developer_prompt_has_slim_fields(self):
        """_build_developer_prompt must include project_path and project_path reminder."""
        from src.nodes.developer import _build_developer_prompt

        prompt = _build_developer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_developer_prompt_has_no_identity_declarations(self):
        """_build_developer_prompt must not contain identity/role declaration text."""
        from src.nodes.developer import _build_developer_prompt

        prompt = _build_developer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "developer")

    # ------------------------------------------------------------------
    # QA node
    # ------------------------------------------------------------------

    def test_qa_prompt_has_slim_fields(self):
        """_build_qa_prompt must include project_path and project_path reminder."""
        from src.nodes.qa import _build_qa_prompt

        prompt = _build_qa_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_qa_prompt_has_no_identity_declarations(self):
        """_build_qa_prompt must not contain identity/role declaration text."""
        from src.nodes.qa import _build_qa_prompt

        prompt = _build_qa_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "qa")

    # ------------------------------------------------------------------
    # Reviewer node
    # ------------------------------------------------------------------

    def test_reviewer_prompt_has_slim_fields(self):
        """_build_reviewer_prompt must include project_path and project_path reminder."""
        from src.nodes.reviewer import _build_reviewer_prompt

        prompt = _build_reviewer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_reviewer_prompt_has_no_identity_declarations(self):
        """_build_reviewer_prompt must not contain identity/role declaration text."""
        from src.nodes.reviewer import _build_reviewer_prompt

        prompt = _build_reviewer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "reviewer")

    # ------------------------------------------------------------------
    # Security Auditor node
    # ------------------------------------------------------------------

    def test_security_auditor_prompt_has_slim_fields(self):
        """_build_security_auditor_prompt must include project_path
        and project_path reminder."""
        from src.nodes.security_auditor import _build_security_auditor_prompt

        prompt = _build_security_auditor_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_security_auditor_prompt_has_no_identity_declarations(self):
        """_build_security_auditor_prompt must not contain identity/role declaration text."""
        from src.nodes.security_auditor import _build_security_auditor_prompt

        prompt = _build_security_auditor_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "security_auditor")

    # ------------------------------------------------------------------
    # Release Engineer node
    # ------------------------------------------------------------------

    def test_release_engineer_prompt_has_slim_fields(self):
        """_build_release_engineer_prompt must include project_path
        and project_path reminder."""
        from src.nodes.release_engineer import _build_release_engineer_prompt

        prompt = _build_release_engineer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_release_engineer_prompt_has_no_identity_declarations(self):
        """_build_release_engineer_prompt must not contain identity/role declaration text."""
        from src.nodes.release_engineer import _build_release_engineer_prompt

        prompt = _build_release_engineer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "release_engineer")

    # ------------------------------------------------------------------
    # Docs node
    # ------------------------------------------------------------------

    def test_docs_prompt_has_slim_fields(self):
        """_build_docs_prompt must include project_path and project_path reminder."""
        from src.nodes.docs import _build_docs_prompt

        prompt = _build_docs_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_docs_prompt_has_no_identity_declarations(self):
        """_build_docs_prompt must not contain identity/role declaration text."""
        from src.nodes.docs import _build_docs_prompt

        prompt = _build_docs_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "docs")

    # ------------------------------------------------------------------
    # PM node (special: embeds plan content; no wp_id)
    # ------------------------------------------------------------------

    def test_pm_prompt_has_slim_fields(self, tmp_path):
        """_build_pm_prompt must embed plan_file reference and plan content.

        The PM is the first agent in the chain — it determines the project
        path from the plan's location rather than consuming it from the
        prompt.  Therefore the prompt intentionally omits project_path and
        the project-path-reminder partial.
        """
        from src.nodes.pm import _build_pm_prompt

        plan_file = tmp_path / "plan.md"
        plan_file.write_text("# Plan\nContent.", encoding="utf-8")

        state = _build_slim_state(project_path=str(tmp_path), plan_file="plan.md")
        prompt = _build_pm_prompt(state)  # type: ignore[arg-type]

        assert "plan.md" in prompt, "plan_file reference must be present in PM prompt"
        assert "# Plan" in prompt, "plan content must be embedded in PM prompt"

    def test_pm_prompt_has_no_identity_declarations(self, tmp_path):
        """_build_pm_prompt must not contain identity/role declaration text."""
        from src.nodes.pm import _build_pm_prompt

        plan_file = tmp_path / "plan.md"
        plan_file.write_text("# Plan\nContent.", encoding="utf-8")

        state = _build_slim_state(project_path=str(tmp_path), plan_file="plan.md")
        prompt = _build_pm_prompt(state)  # type: ignore[arg-type]

        self._assert_no_identity_phrases(prompt, "pm")

    # ------------------------------------------------------------------
    # Synthesis node (no wp_id)
    # ------------------------------------------------------------------

    def test_synthesis_prompt_has_slim_fields(self):
        """_build_synthesis_prompt must include project_path and project_path
        reminder (no wp_id)."""
        from src.nodes.synthesis import _build_synthesis_prompt

        state = _build_slim_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)  # type: ignore[arg-type]

        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_synthesis_prompt_has_no_identity_declarations(self):
        """_build_synthesis_prompt must not contain identity/role declaration text."""
        from src.nodes.synthesis import _build_synthesis_prompt

        state = _build_slim_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)  # type: ignore[arg-type]

        self._assert_no_identity_phrases(prompt, "synthesis")


# ---------------------------------------------------------------------------
# Tests: pipeline rollback when begin_work is called before a stage error
# ---------------------------------------------------------------------------

class TestPipelineRollback:
    """
    Verify the orphaned-pipeline rollback logic in create_stage_node.

    When the Deep Agent errors after calling ledger_begin_work, the node must
    automatically call ledger_cancel_pipeline with auto_cancelled=True so that
    the orphaned IN_PROGRESS pipeline does not block the next run attempt.
    """

    class _RecordingTool:
        """Plain tool stub with call recording. MagicMock is intentionally avoided
        because its auto-attribute creation breaks the ``hasattr`` sentinel checks
        used by inject_project_path, restrict_to_wp, and _install_begin_work_tracker."""

        def __init__(self, name: str, raises: Exception | None = None) -> None:
            self.name = name
            self._raises = raises
            self.calls: list[Any] = []

        async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> Any:  # noqa: A002
            self.calls.append(input)
            if self._raises is not None:
                raise self._raises
            return {"content": [{"type": "text", "text": "{}"}]}

    async def test_rollback_called_when_begin_work_invoked_before_error(self):
        """When begin_work is called and the agent then crashes, cancel_pipeline
        must be called with auto_cancelled=True."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        # Fake agent: calls ledger_begin_work (to trigger the tracker),
        # then raises RuntimeError to exercise the rollback path.
        async def _fake_agent_ainvoke(inputs: dict) -> dict:  # noqa: ARG001
            # Call begin_work via the tool reference which, after node_fn runs
            # inject_project_path + restrict_to_wp + _install_begin_work_tracker,
            # points to the tracker-wrapped ainvoke.
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("Simulated agent crash after begin_work")

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(side_effect=_fake_agent_ainvoke)

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False

        assert cancel_tool.calls, "ledger_cancel_pipeline must have been called"
        call_args = cancel_tool.calls[-1]
        assert call_args.get("auto_cancelled") is True
        assert call_args.get("work_package_id") == "WP-001"
        assert call_args.get("type") == "implementation"

    async def test_rollback_not_called_when_begin_work_not_invoked(self):
        """When the agent crashes without calling begin_work, cancel_pipeline
        must NOT be called."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        # Fake agent: crashes immediately without calling begin_work.
        async def _fake_agent_ainvoke(inputs: dict) -> dict:  # noqa: ARG001
            raise RuntimeError("Simulated crash without begin_work")

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(side_effect=_fake_agent_ainvoke)

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False
        assert not cancel_tool.calls, "ledger_cancel_pipeline must NOT have been called"

    async def test_rollback_run_log_contains_pipeline_rollback_entry(self):
        """Successful rollback must append a pipeline_rollback entry to run_log."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        async def _fake_agent_ainvoke(inputs: dict) -> dict:  # noqa: ARG001
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("crash")

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(side_effect=_fake_agent_ainvoke)

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        rollback_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_rollback"]
        assert rollback_entries, "run_log must contain a pipeline_rollback entry after rollback"
        entry = rollback_entries[0]
        assert entry["level"] == "INFO"
        assert entry["wp_id"] == "WP-001"
        assert entry["pipeline_type"] == "implementation"

    async def test_rollback_original_error_preserved_when_cancel_fails(self):
        """When cancel_pipeline itself raises, the original error must still
        appear in the returned errors list."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool(
            "ledger_cancel_pipeline", raises=RuntimeError("cancel_pipeline failed")
        )
        tools = [begin_work_tool, cancel_tool]

        async def _fake_agent_ainvoke(inputs: dict) -> dict:  # noqa: ARG001
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("Original agent crash")

        agent_mock = MagicMock()
        agent_mock.ainvoke = AsyncMock(side_effect=_fake_agent_ainvoke)

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False
        errors = result.get("errors", [])
        assert errors, "errors must be non-empty"
        assert "Original agent crash" in errors[0]["message"]


# ---------------------------------------------------------------------------
# Tests: log_tool_calls wiring inside create_stage_node
# ---------------------------------------------------------------------------


class TestCreateStageNodeWiring:
    """Verify that create_stage_node wires log_tool_calls with the correct
    stage, wp_id, and logger arguments (WP-002 integration coverage)."""

    async def test_log_tool_calls_is_wired_with_correct_args(self):
        """create_stage_node must call log_tool_calls exactly once, passing
        the correct stage, wp_id, and run_logger (None in unit tests)."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.log_tool_calls") as mock_log:
            await node_fn(base_state(current_wp_id="WP-003"))

        mock_log.assert_called_once()
        args = mock_log.call_args.args
        # args: (wrapped_tools, stage, wp_id, run_logger)
        assert args[1] == "developer", (
            f"log_tool_calls called with wrong stage: {args[1]!r}"
        )
        assert args[2] == "WP-003", (
            f"log_tool_calls called with wrong wp_id: {args[2]!r}"
        )
        # run_logger is None in unit tests (no RunnableConfig provided)
        assert args[3] is None, (
            f"log_tool_calls called with unexpected logger: {args[3]!r}"
        )

    async def test_log_tool_calls_wired_for_synthesis_empty_wp_id(self):
        """Synthesis stages have empty wp_id; log_tool_calls must still fire
        with wp_id='' so the wrapper can handle project-scoped calls."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="synthesis",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.log_tool_calls") as mock_log:
            await node_fn(base_state(current_wp_id=""))

        mock_log.assert_called_once()
        args = mock_log.call_args.args
        assert args[1] == "synthesis", (
            f"log_tool_calls called with wrong stage: {args[1]!r}"
        )
        assert args[2] == "", (
            f"log_tool_calls called with non-empty wp_id for synthesis: {args[2]!r}"
        )
        assert args[3] is None


# ---------------------------------------------------------------------------
# Tests: LocalShellBackend receives inherit_env=True
# ---------------------------------------------------------------------------


class TestLocalShellBackendInheritEnv:
    """LocalShellBackend must be constructed with inherit_env=True so that
    agent subprocesses can access host CLI tools (python, npm, git, etc.)."""

    async def test_stage_node_passes_inherit_env_true(self):
        """create_stage_node must call LocalShellBackend(inherit_env=True)."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        backend_cls_mock = MagicMock(return_value=MagicMock())

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=_make_agent_mock()), \
             patch("deepagents.backends.LocalShellBackend", backend_cls_mock):
            await node_fn(base_state())

        backend_cls_mock.assert_called_once()
        _, kwargs = backend_cls_mock.call_args
        assert kwargs.get("inherit_env") is True, (
            f"LocalShellBackend must be called with inherit_env=True, "
            f"got kwargs={kwargs!r}"
        )


# ---------------------------------------------------------------------------
# Tests: subagent wiring (WP-013)
# ---------------------------------------------------------------------------

class TestSubagentWiring:
    """Verify that create_stage_node passes subagents to create_deep_agent for
    stages that have subagent configuration, and passes None for those that do
    not (WP-013 acceptance criteria)."""

    async def test_pm_node_passes_subagents_to_create_deep_agent(self):
        """AC-1: PM agent's create_deep_agent() call includes subagents with
        at least WP Decomposer."""
        from src.nodes import create_stage_node

        fake_subagent = {
            "name": "WP Decomposer",
            "description": "Analyze a plan document and decompose it into Work Packages.",
            "system_prompt": "# WP Decomposer\nYou decompose plans into WPs.",
        }

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = create_stage_node(
            stage="pm",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[fake_subagent]):
            await node_fn(base_state(current_wp_id=""))

        assert captured.get("subagents") is not None, (
            "create_deep_agent must receive subagents for the pm stage"
        )
        assert isinstance(captured["subagents"], list), (
            "subagents must be a list"
        )
        assert len(captured["subagents"]) >= 1, (
            "subagents list must contain at least one entry (WP Decomposer)"
        )
        names = [s["name"] for s in captured["subagents"]]
        assert "WP Decomposer" in names, (
            f"WP Decomposer must be in subagents; got {names!r}"
        )

    async def test_pm_subagent_definition_contains_system_prompt(self):
        """AC-2: Subagent definition includes persona content (system_prompt field)."""
        from src.nodes import create_stage_node

        persona_content = "# WP Decomposer\nYou analyze plans and decompose them."
        fake_subagent = {
            "name": "WP Decomposer",
            "description": "Decompose plan into WPs.",
            "system_prompt": persona_content,
        }

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = create_stage_node(
            stage="pm",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[fake_subagent]):
            await node_fn(base_state(current_wp_id=""))

        subagents = captured.get("subagents") or []
        assert subagents, "subagents must be non-empty for pm stage"
        wp_decomposer = next((s for s in subagents if s["name"] == "WP Decomposer"), None)
        assert wp_decomposer is not None, "WP Decomposer entry must be present"
        assert "system_prompt" in wp_decomposer, (
            "SubAgent dict must contain system_prompt"
        )
        assert wp_decomposer["system_prompt"] == persona_content, (
            "system_prompt must match the loaded persona content"
        )

    @pytest.mark.parametrize("module_name,factory_name,stage", [
        ("src.nodes.developer", "make_developer_node", "developer"),
        ("src.nodes.qa", "make_qa_node", "qa"),
        ("src.nodes.reviewer", "make_reviewer_node", "reviewer"),
        ("src.nodes.docs", "make_docs_node", "docs"),
        ("src.nodes.synthesis", "make_synthesis_node", "synthesis"),
    ])
    async def test_non_subagent_stages_pass_none(
        self, module_name: str, factory_name: str, stage: str
    ):
        """AC-4: Stages without subagent config receive subagents=None."""
        import importlib
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[]):
            await node_fn(base_state(current_wp_id=""))

        assert captured.get("subagents") is None, (
            f"Stage {stage!r} must pass subagents=None to create_deep_agent; "
            f"got {captured.get('subagents')!r}"
        )
