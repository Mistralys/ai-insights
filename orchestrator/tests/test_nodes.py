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
        ("src.nodes.docs", "make_docs_node"),
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
        ("src.nodes.docs", "make_docs_node"),
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
        ("src.nodes.docs", "make_docs_node"),
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
        entry = result["run_log"][0]
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
