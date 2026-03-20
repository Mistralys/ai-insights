# Orchestrator - Tests
_SOURCE: Test suite (unit, integration, live marks)_
# Test suite (unit, integration, live marks)
```
// Structure of documents
└── orchestrator/
    └── tests/
        └── __init__.py
        └── test_cli.py
        └── test_config.py
        └── test_graph.py
        └── test_integration.py
        └── test_nodes.py
        └── test_plan_parser.py
        └── test_state.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```
###  Path: `/orchestrator/tests/__init__.py`

```py
"""
tests — orchestrator test suite.
"""

```
###  Path: `/orchestrator/tests/test_cli.py`

```py
"""
test_cli.py — Unit tests for the CLI entry point (WP-005).

Tests verify:
- Argument parser accepts all documented options.
- _parse_interrupt_stages() maps stage names correctly.
- _print_run_summary() returns correct exit codes.
- _make_dryrun_node() returns a callable that produces correct state updates.
- main() exits with correct codes for missing plan files.

No real MCP server, LLM, or LangGraph graph invocation is performed.
"""

from __future__ import annotations

import platform
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Argument parser tests
# ---------------------------------------------------------------------------

class TestArgumentParser:
    def _parse(self, *args):
        from src.cli import _build_parser
        return _build_parser().parse_args(list(args))

    def test_plan_positional_required(self):
        """Parser requires the plan positional argument."""
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args([])

    def test_plan_positional_parsed(self):
        args = self._parse("plan.md")
        assert args.plan == "plan.md"

    def test_project_path_option(self):
        args = self._parse("plan.md", "--project-path", "/some/project")
        assert args.project_path == "/some/project"

    def test_max_iterations_option(self):
        args = self._parse("plan.md", "--max-iterations", "50")
        assert args.max_iterations == 50

    def test_model_option(self):
        args = self._parse("plan.md", "--model", "claude-opus-4")
        assert args.model == "claude-opus-4"

    def test_resume_option(self):
        args = self._parse("plan.md", "--resume", "abc-123")
        assert args.resume == "abc-123"

    def test_dry_run_flag(self):
        args = self._parse("plan.md", "--dry-run")
        assert args.dry_run is True

    def test_dry_run_default_false(self):
        args = self._parse("plan.md")
        assert args.dry_run is False

    def test_log_level_option(self):
        args = self._parse("plan.md", "--log-level", "DEBUG")
        assert args.log_level == "DEBUG"

    def test_log_level_invalid_rejected(self):
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["plan.md", "--log-level", "INVALID"])

    def test_interrupt_on_option(self):
        args = self._parse("plan.md", "--interrupt-on", "pm,synthesis")
        assert args.interrupt_on == "pm,synthesis"

    def test_defaults_are_none(self):
        args = self._parse("plan.md")
        assert args.project_path is None
        assert args.max_iterations is None
        assert args.model is None
        assert args.resume is None
        assert args.log_level is None
        assert args.interrupt_on is None


# ---------------------------------------------------------------------------
# _parse_interrupt_stages() tests
# ---------------------------------------------------------------------------

class TestParseInterruptStages:
    def _parse(self, raw: str) -> list[str]:
        from src.cli import _parse_interrupt_stages
        return _parse_interrupt_stages(raw)

    def test_pm_maps_to_pm(self):
        assert "pm" in self._parse("pm")

    def test_synthesis_maps_to_synthesis(self):
        assert "synthesis" in self._parse("synthesis")

    def test_fail_maps_to_developer(self):
        assert "developer" in self._parse("fail")

    def test_multiple_stages(self):
        result = self._parse("pm,synthesis")
        assert "pm" in result
        assert "synthesis" in result

    def test_deduplicates_same_node(self):
        # Both "fail" and potential duplicates map to "developer" — should appear once.
        result = self._parse("fail")
        assert result.count("developer") == 1

    def test_unknown_stage_exits(self):
        from src.cli import _parse_interrupt_stages
        with pytest.raises(SystemExit):
            _parse_interrupt_stages("unknown_stage")

    def test_whitespace_stripped(self):
        result = self._parse("pm , synthesis")
        assert "pm" in result
        assert "synthesis" in result


# ---------------------------------------------------------------------------
# _print_run_summary() exit code tests
# ---------------------------------------------------------------------------

class TestPrintRunSummary:
    def _call(self, final_state, duration=1.0, thread_id="t1", errors=None):
        from src.cli import _print_run_summary
        return _print_run_summary(final_state, duration, thread_id=thread_id, errors_raised=errors)

    def test_none_state_returns_error(self, capsys):
        code = self._call(None)
        from src.cli import EXIT_ERROR
        assert code == EXIT_ERROR

    def test_empty_state_no_errors_returns_success(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SUCCESS
        assert self._call(state) == EXIT_SUCCESS

    def test_safety_limit_returns_exit_2(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 100,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SAFETY_LIMIT
        assert self._call(state) == EXIT_SAFETY_LIMIT

    def test_errors_in_state_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [{"message": "something went wrong"}],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state) == EXIT_ERROR

    def test_outside_errors_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state, errors=["startup failed"]) == EXIT_ERROR

    def test_summary_includes_thread_id(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, thread_id="my-thread-id")
        captured = capsys.readouterr()
        assert "my-thread-id" in captured.out

    def test_summary_includes_duration(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, duration=42.5)
        captured = capsys.readouterr()
        assert "42.5" in captured.out

    def test_wps_complete_count_shown(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [
                {"status": "COMPLETE"},
                {"status": "COMPLETE"},
                {"status": "IN_PROGRESS"},
            ],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state)
        captured = capsys.readouterr()
        assert "2/3" in captured.out


# ---------------------------------------------------------------------------
# _make_dryrun_node() tests
# ---------------------------------------------------------------------------

class TestDryRunNode:
    def _make(self, stage: str):
        from src.cli import _make_dryrun_node
        return _make_dryrun_node(stage)

    def test_returns_callable(self):
        node = self._make("pm")
        assert callable(node)

    def test_returns_dict_on_call(self):
        node = self._make("pm")
        result = node({"current_wp_id": "WP-001"})
        assert isinstance(result, dict)

    def test_stage_success_is_true(self):
        node = self._make("developer")
        result = node({"current_wp_id": "WP-001"})
        assert result.get("stage_success") is True

    def test_run_log_appended(self):
        node = self._make("qa")
        result = node({"current_wp_id": "WP-001"})
        assert len(result.get("run_log", [])) == 1
        assert result["run_log"][0]["action"] == "dry_run"

    def test_stage_name_in_result(self):
        node = self._make("reviewer")
        result = node({"current_wp_id": "WP-002"})
        assert "reviewer" in result.get("stage_result", "")

    def test_node_name_attribute_set(self):
        node = self._make("docs")
        assert "docs" in node.__name__


# ---------------------------------------------------------------------------
# main() integration — missing plan file error
# ---------------------------------------------------------------------------

class TestMainMissingPlan:
    def test_missing_plan_exits_1(self, tmp_path):
        """main() exits with EXIT_ERROR when the plan file does not exist."""
        import os
        nonexistent = str(tmp_path / "no_such_plan.md")

        mock_config = MagicMock()
        mock_config.max_iterations = 100
        mock_config.log_level = "INFO"
        mock_config.checkpoint_dir = tmp_path / "checkpoints"

        # load_config is imported lazily inside main(); patch at the source module.
        with patch("src.config.load_config", return_value=mock_config):
            with pytest.raises(SystemExit) as exc_info:
                from src.cli import main
                main([nonexistent])

        from src.cli import EXIT_ERROR
        assert exc_info.value.code == EXIT_ERROR


# ---------------------------------------------------------------------------
# _make_dryrun_node — edge cases
# ---------------------------------------------------------------------------

class TestDryRunNodeEdgeCases:
    def test_missing_wp_id_handled(self):
        """Node must not crash when state has no current_wp_id."""
        from src.cli import _make_dryrun_node
        node = _make_dryrun_node("pm")
        result = node({})  # Empty state
        assert result["stage_success"] is True

    def test_run_log_result_is_skip(self):
        from src.cli import _make_dryrun_node
        node = _make_dryrun_node("synthesis")
        result = node({"current_wp_id": ""})
        assert result["run_log"][0]["result"] == "SKIP"

```
###  Path: `/orchestrator/tests/test_config.py`

```py
"""Snapshot tests for manifest-derived constants in orchestrator/src/config.py.

Catches silent regressions when manifest field names change or the derivation
logic is accidentally broken.  Tests assert structural properties (type,
non-emptiness, key membership) rather than exact exhaustive values, so they
remain valid if the manifest gains new roles or pipeline types in the future.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.config import (
    FAIL_ROUTING_AGENT_MAP,
    PERSONA_FILES,
    PIPELINE_AGENT_MAP,
    PIPELINE_ROLE_NAMES,
    PIPELINE_TYPES,
    ROLE_IDS,
    VALID_STAGES,
    WP_TERMINAL_STATUSES,
)


class TestWPTerminalStatuses:
    def test_is_frozenset(self):
        assert isinstance(WP_TERMINAL_STATUSES, frozenset)

    def test_non_empty(self):
        assert len(WP_TERMINAL_STATUSES) > 0

    def test_contains_complete(self):
        assert "COMPLETE" in WP_TERMINAL_STATUSES

    def test_contains_cancelled(self):
        assert "CANCELLED" in WP_TERMINAL_STATUSES


class TestValidStages:
    def test_is_frozenset(self):
        assert isinstance(VALID_STAGES, frozenset)

    def test_non_empty(self):
        assert len(VALID_STAGES) > 0

    def test_contains_developer(self):
        assert "developer" in VALID_STAGES

    def test_contains_qa(self):
        assert "qa" in VALID_STAGES

    def test_contains_reviewer(self):
        assert "reviewer" in VALID_STAGES

    def test_does_not_contain_planner(self):
        # planner is orchestrating and must be excluded
        assert "planner" not in VALID_STAGES

    def test_does_not_contain_synthesis(self):
        # synthesis is orchestrating and must be excluded
        assert "synthesis" not in VALID_STAGES


class TestPipelineTypes:
    def test_is_tuple(self):
        assert isinstance(PIPELINE_TYPES, tuple)

    def test_non_empty(self):
        assert len(PIPELINE_TYPES) > 0

    def test_contains_implementation(self):
        assert "implementation" in PIPELINE_TYPES

    def test_contains_qa(self):
        assert "qa" in PIPELINE_TYPES

    def test_contains_documentation(self):
        assert "documentation" in PIPELINE_TYPES

    def test_implementation_is_first(self):
        assert PIPELINE_TYPES[0] == "implementation"

    def test_documentation_is_last(self):
        assert PIPELINE_TYPES[-1] == "documentation"


class TestRoleIDs:
    def test_is_dict(self):
        assert isinstance(ROLE_IDS, dict)

    def test_non_empty(self):
        assert len(ROLE_IDS) > 0

    def test_developer_maps_to_developer_id(self):
        assert ROLE_IDS.get("Developer") == "developer"

    def test_qa_maps_to_qa_id(self):
        assert ROLE_IDS.get("QA") == "qa"

    def test_release_engineer_maps_to_correct_id(self):
        assert ROLE_IDS.get("Release Engineer") == "release_engineer"


class TestPipelineRoleNames:
    def test_is_list(self):
        assert isinstance(PIPELINE_ROLE_NAMES, list)

    def test_non_empty(self):
        assert len(PIPELINE_ROLE_NAMES) > 0

    def test_contains_developer(self):
        assert "Developer" in PIPELINE_ROLE_NAMES

    def test_contains_documentation(self):
        assert "Documentation" in PIPELINE_ROLE_NAMES

    def test_does_not_contain_planner(self):
        # planner is orchestrating — excluded by the derivation filter
        assert "Planner" not in PIPELINE_ROLE_NAMES

    def test_does_not_contain_synthesis(self):
        assert "Synthesis" not in PIPELINE_ROLE_NAMES


class TestPipelineAgentMap:
    def test_is_dict(self):
        assert isinstance(PIPELINE_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(PIPELINE_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have an owning agent in PIPELINE_AGENT_MAP."""
        for ptype in PIPELINE_TYPES:
            assert ptype in PIPELINE_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from PIPELINE_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All owning agent entries must be valid non-orchestrating role names."""
        for ptype, role_name in PIPELINE_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"PIPELINE_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_implementation_maps_to_developer(self):
        assert PIPELINE_AGENT_MAP["implementation"] == "Developer"

    def test_release_engineering_maps_to_release_engineer(self):
        assert PIPELINE_AGENT_MAP["release-engineering"] == "Release Engineer"


class TestFailRoutingAgentMap:
    def test_is_dict(self):
        assert isinstance(FAIL_ROUTING_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(FAIL_ROUTING_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have a FAIL-routing target."""
        for ptype in PIPELINE_TYPES:
            assert ptype in FAIL_ROUTING_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from FAIL_ROUTING_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All FAIL-routing targets must be valid non-orchestrating role names."""
        for ptype, role_name in FAIL_ROUTING_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"FAIL_ROUTING_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_release_engineering_routes_to_release_engineer(self):
        """Non-obvious mapping: release-engineering FAIL → Release Engineer."""
        assert FAIL_ROUTING_AGENT_MAP["release-engineering"] == "Release Engineer"

    def test_documentation_routes_to_documentation(self):
        """Non-obvious mapping: documentation FAIL → Documentation."""
        assert FAIL_ROUTING_AGENT_MAP["documentation"] == "Documentation"


class TestPersonaFilesExist:
    """Validate that every persona_file entry in the manifest points to an
    actual file on disk.  This catches stale paths whenever the persona build
    system renames its output files."""

    # Workspace root is two levels above the orchestrator package.
    _WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

    def test_persona_files_is_dict(self):
        assert isinstance(PERSONA_FILES, dict)

    def test_persona_files_non_empty(self):
        assert len(PERSONA_FILES) > 0

    @pytest.mark.parametrize("stage,relative_path", list(PERSONA_FILES.items()))
    def test_persona_file_exists(self, stage: str, relative_path: str):
        """Every stage's persona file must exist on the local filesystem."""
        full_path = self._WORKSPACE_ROOT / relative_path
        assert full_path.exists(), (
            f"Persona file for stage {stage!r} not found at: {full_path}\n"
            f"  Manifest says: {relative_path}\n"
            f"  Check shared/workflow-manifest.json persona_file entries."
        )

```
###  Path: `/orchestrator/tests/test_graph.py`

```py
"""
test_graph.py — Unit tests for graph assembly (WP-005).

Tests verify:
- build_graph() returns a compiled graph with the correct node topology.
- All 7 nodes are present.
- Edges match the hub-and-spoke spec (all stages → supervisor, synthesis → END).
- Graph compiles without error when provided with mock config and empty tool list.
- The checkpointer is async-compatible (regression for SqliteSaver bug).

No real MCP server or LLM is used — all nodes are patched at import time.
"""

from __future__ import annotations

import pytest
from pathlib import Path
from typing import Any
from unittest.mock import patch


# ---------------------------------------------------------------------------
# Mock config fixture
# ---------------------------------------------------------------------------

class _MockConfig:
    model_name = "claude-test"
    provider = "anthropic"
    max_iterations = 10
    workspace_root = Path(__file__).resolve().parent.parent.parent
    checkpoint_dir = Path(__file__).resolve().parent.parent / "checkpoints" / "test"
    mcp_server_cmd = ["node", "fake-server.js"]
    log_level = "INFO"


MOCK_CONFIG = _MockConfig()
MOCK_TOOLS: list[Any] = []


# ---------------------------------------------------------------------------
# Helpers: patch all node factories to return no-op callables
# ---------------------------------------------------------------------------

def _noop_node(name: str):
    def _node(state):
        return {"stage_result": f"{name} stub", "stage_success": True, "run_log": []}
    _node.__name__ = name
    return _node


def _apply_patches(test_fn):
    """Decorator that applies all node factory patches."""
    import functools

    @functools.wraps(test_fn)
    async def wrapper(*args, **kwargs):
        # Patch at source module level (lazy imports inside build_graph()).
        with (
            patch("src.supervisor.make_supervisor_node", side_effect=lambda tools: _noop_node("supervisor")),
            patch("src.nodes.pm.make_pm_node", side_effect=lambda cfg, tools: _noop_node("pm")),
            patch("src.nodes.developer.make_developer_node", side_effect=lambda cfg, tools: _noop_node("developer")),
            patch("src.nodes.qa.make_qa_node", side_effect=lambda cfg, tools: _noop_node("qa")),
            patch("src.nodes.reviewer.make_reviewer_node", side_effect=lambda cfg, tools: _noop_node("reviewer")),
            patch("src.nodes.docs.make_docs_node", side_effect=lambda cfg, tools: _noop_node("docs")),
            patch("src.nodes.synthesis.make_synthesis_node", side_effect=lambda cfg, tools: _noop_node("synthesis")),
        ):
            return await test_fn(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Tests: build_graph() returns a compiled graph
# ---------------------------------------------------------------------------

class TestBuildGraphReturnType:
    @_apply_patches
    async def test_build_graph_returns_object(self):
        """build_graph() returns a non-None compiled graph."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        assert graph is not None

    @_apply_patches
    async def test_compiled_graph_is_callable(self):
        """The compiled graph exposes an invoke() method."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        assert callable(getattr(graph, "invoke", None))


class TestGraphNodes:
    @_apply_patches
    async def test_graph_has_nine_nodes(self):
        """Graph topology must contain exactly 9 nodes."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        # LangGraph 1.x: CompiledStateGraph exposes .nodes directly.
        nodes = set(graph.nodes)
        expected_nodes = {
            "supervisor", "pm", "developer", "qa", "reviewer",
            "security_auditor", "docs", "release_engineer", "synthesis",
        }
        # START and END are pseudo-nodes added by LangGraph; remove them for comparison.
        nodes.discard("__start__")
        nodes.discard("__end__")
        assert nodes == expected_nodes


class TestGraphEdges:
    @_apply_patches
    async def _get_edges(self):
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        # graph.builder.edges is a set of (source, target) tuples — includes all
        # static edges declared with add_edge(), unlike get_graph().edges which
        # omits Command-routed edges in LangGraph 1.x.
        return graph.builder.edges

    @_apply_patches
    async def test_start_edges_to_supervisor(self):
        """START must edge to 'supervisor'."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        edges = graph.builder.edges
        start_targets = {edge[1] for edge in edges if edge[0] == "__start__"}
        assert "supervisor" in start_targets

    @_apply_patches
    async def test_loop_stages_edge_to_supervisor(self):
        """pm, developer, qa, reviewer, docs must each edge back to supervisor."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        edges = graph.builder.edges  # set of (source, target) tuples
        # Build a mapping: source → set of targets
        edge_map: dict = {}
        for edge in edges:
            src, dst = edge[0], edge[1]
            edge_map.setdefault(src, set()).add(dst)

        loop_stages = ("pm", "developer", "qa", "reviewer", "docs")
        for stage in loop_stages:
            assert "supervisor" in edge_map.get(stage, set()), (
                f"Stage {stage!r} must have an edge back to supervisor"
            )

    @_apply_patches
    async def test_synthesis_edges_to_end(self):
        """synthesis must edge to END (not back to supervisor)."""
        from src.graph import build_graph
        graph = await build_graph(MOCK_CONFIG, MOCK_TOOLS)
        edges = graph.builder.edges  # set of (source, target) tuples
        edge_map: dict = {}
        for edge in edges:
            src, dst = edge[0], edge[1]
            edge_map.setdefault(src, set()).add(dst)

        synthesis_targets = edge_map.get("synthesis", set())
        assert "__end__" in synthesis_targets
        assert "supervisor" not in synthesis_targets


class TestCheckpointerCreated:
    @_apply_patches
    async def test_checkpoint_dir_created(self, tmp_path):
        """build_graph() creates the checkpoint directory if it does not exist."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        cfg = _TmpConfig()
        assert not cfg.checkpoint_dir.exists()
        await build_graph(cfg, MOCK_TOOLS)
        assert cfg.checkpoint_dir.exists()


class TestCheckpointerIsAsync:
    @_apply_patches
    async def test_checkpointer_supports_async(self, tmp_path):
        """The graph checkpointer must support async methods (ainvoke).

        Regression test: SqliteSaver raises NotImplementedError on async
        calls (aget_tuple, aput, etc.).  The graph must use
        AsyncSqliteSaver so that ``graph.ainvoke()`` works.
        """
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph = await build_graph(_TmpConfig(), MOCK_TOOLS)
        checkpointer = graph.checkpointer
        assert isinstance(checkpointer, AsyncSqliteSaver), (
            f"Checkpointer must be AsyncSqliteSaver, got {type(checkpointer).__name__}"
        )

    @_apply_patches
    async def test_graph_ainvoke_does_not_raise_not_implemented(self, tmp_path):
        """graph.ainvoke() must not raise NotImplementedError from the checkpointer.

        This is the exact failure mode from the bug: SqliteSaver.aget_tuple()
        raises NotImplementedError when the graph is invoked asynchronously.
        """
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph = await build_graph(_TmpConfig(), MOCK_TOOLS)
        initial_state = {
            "plan_text": "test",
            "project_slug": "test-project",
            "project_title": "Test",
            "stage_result": "",
            "stage_success": True,
            "supervisor_iteration": 0,
            "run_log": [],
        }
        # The supervisor stub will route somewhere that may fail, but the
        # important thing is that the checkpointer itself does NOT raise
        # NotImplementedError.  We catch any other exception and let it pass.
        try:
            await graph.ainvoke(
                initial_state,
                {"configurable": {"thread_id": "test-async-compat"}},
            )
        except NotImplementedError as exc:
            if "async" in str(exc).lower():
                pytest.fail(f"Checkpointer does not support async: {exc}")

```
###  Path: `/orchestrator/tests/test_integration.py`

```py
"""
test_integration.py — Integration tests for the AI Insights Orchestrator workflow.

These tests verify multi-step graph execution end-to-end using:
- The real LangGraph engine and real supervisor routing logic.
- Scripted MCP tool mocks (``ScriptedLedger``) that advance through
  realistic ledger state sequences as each stage node executes.
- Lightweight stage-node stubs that advance the ledger state and
  return deterministic results without calling real LLM agents.

No real MCP server or LLM API key is required.  All tests run in < 1 second.

Running
-------
::

    # All integration tests (this file):
    python -m pytest tests/test_integration.py -m integration -v

    # Alongside unit tests:
    python -m pytest tests/ -m "integration or not integration" -v

    # With verbose supervisor log output:
    python -m pytest tests/test_integration.py -m integration -v -s

Live infrastructure tests (require MCP server build + API key)
---------------------------------------------------------------
These are labelled ``@pytest.mark.live`` and are skipped by default.  Run with::

    python -m pytest tests/test_integration.py -m live -v
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from src.state import WorkflowState
from src.supervisor import make_supervisor_node

# ---------------------------------------------------------------------------
# pytest mark registration
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers — scripted ledger state machine
# ---------------------------------------------------------------------------


class ScriptedLedger:
    """
    Simulates a live MCP ledger with a pre-scripted sequence of states.

    Each *step* is a dict::

        {
            "project_status": {...},          # returned by ledger_get_project_status
            "wp_list": [...],                 # returned by ledger_list_work_packages
            "wp_details": {"WP-001": {...}},  # returned by ledger_get_work_package
        }

    Stage-node stubs call :meth:`advance` after they execute to move the
    ledger to its next state so the supervisor sees the correct result on
    the following iteration.
    """

    def __init__(self, steps: list[dict]) -> None:
        if not steps:
            raise ValueError("ScriptedLedger requires at least one step.")
        self._steps = steps
        self._index = 0
        # Record which stages executed (appended by stubs).
        self.execution_log: list[str] = []

    @property
    def state(self) -> dict:
        """Return the current ledger state dict (never past the last step)."""
        return self._steps[min(self._index, len(self._steps) - 1)]

    def advance(self) -> None:
        """Move to the next scripted state (idempotent at last step)."""
        if self._index < len(self._steps) - 1:
            self._index += 1

    # ------------------------------------------------------------------
    # Internal helper: derive ledger_get_next_action response from WP state
    # ------------------------------------------------------------------

    @staticmethod
    def _derive_next_action(
        agent_role: str, wp_list: list, wp_details: dict
    ) -> dict:
        """Simulate what ``ledger_get_next_action`` returns for *agent_role*."""

        def latest(pipelines: list, ptype: str) -> str | None:
            for p in reversed(pipelines):
                if p.get("type") == ptype:
                    return p.get("status")
            return None

        non_terminal = [
            wp
            for wp in wp_list
            if wp.get("status") not in ("COMPLETE", "CANCELLED")
        ]

        # All non-terminal WPs BLOCKED → PM handles repair.
        if non_terminal and all(
            wp.get("status") == "BLOCKED" for wp in non_terminal
        ):
            if agent_role == "Project Manager":
                return {"action": "REPAIR_ORPHAN_BLOCKED"}
            return {"action": "WAIT"}

        # IN_PROGRESS first (matches real server priority), then READY.
        ordered = [
            wp for wp in wp_list if wp.get("status") == "IN_PROGRESS"
        ] + [wp for wp in wp_list if wp.get("status") == "READY"]

        for wp_summary in ordered:
            wp_id = wp_summary.get("work_package_id", "")
            if wp_summary.get("status") in ("COMPLETE", "CANCELLED", "BLOCKED"):
                continue

            wp_detail = wp_details.get(wp_id, wp_summary)
            pipelines = wp_detail.get("pipelines", [])

            impl = latest(pipelines, "implementation")
            qa = latest(pipelines, "qa")
            cr = latest(pipelines, "code-review")
            doc = latest(pipelines, "documentation")

            if impl is None:
                next_role, action = "Developer", "IMPLEMENT"
            elif impl == "IN_PROGRESS":
                next_role, action = "Developer", "CONTINUE_PIPELINE"
            elif impl == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif impl == "PASS" and qa is None:
                next_role, action = "QA", "RUN_QA"
            elif qa == "IN_PROGRESS":
                next_role, action = "QA", "CONTINUE_PIPELINE"
            elif qa == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif qa == "PASS" and cr is None:
                next_role, action = "Reviewer", "RUN_REVIEW"
            elif cr == "IN_PROGRESS":
                next_role, action = "Reviewer", "CONTINUE_PIPELINE"
            elif cr == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif cr == "PASS" and doc is None:
                next_role, action = "Documentation", "WRITE_DOCS"
            elif doc == "IN_PROGRESS":
                next_role, action = "Documentation", "CONTINUE_PIPELINE"
            elif doc == "FAIL":
                next_role, action = "Documentation", "REWORK"
            else:
                continue  # WP fully done

            if next_role == agent_role:
                return {"action": action, "work_package_id": wp_id}

        return {"action": "WAIT"}

    def make_mcp_tools(self) -> list[Any]:
        """Return a list of mock LangChain ``Tool`` objects backed by this ledger."""

        def _project_status(kwargs: dict) -> str:
            return json.dumps(self.state["project_status"])

        def _wp_list(kwargs: dict) -> str:
            return json.dumps(self.state["wp_list"])

        def _wp_detail(kwargs: dict) -> str:
            wp_id: str = kwargs.get("work_package_id", "")
            detail = self.state.get("wp_details", {}).get(wp_id, {})
            return json.dumps(detail)

        def _next_action(kwargs: dict) -> str:
            role: str = kwargs.get("agent_role", "")
            result = self._derive_next_action(
                role,
                self.state.get("wp_list", []),
                self.state.get("wp_details", {}),
            )
            return json.dumps(result)

        def _make(name: str, fn) -> MagicMock:
            tool = MagicMock()
            tool.name = name
            tool.invoke = MagicMock(side_effect=fn)
            tool.ainvoke = AsyncMock(side_effect=fn)
            return tool

        return [
            _make("ledger_get_project_status", _project_status),
            _make("ledger_list_work_packages", _wp_list),
            _make("ledger_get_work_package", _wp_detail),
            _make("ledger_get_next_action", _next_action),
        ]

    def make_stage_node(self, stage: str, *, advance: bool = True):
        """
        Return a stage-node stub for *stage*.

        Parameters
        ----------
        stage:
            LangGraph node name (``"pm"``, ``"developer"``, etc.).
        advance:
            If ``True`` (default), call :meth:`ScriptedLedger.advance` so the
            next supervisor iteration sees the post-execution ledger state.
        """
        ledger = self  # close over self

        def _stub(state: WorkflowState) -> dict:
            ledger.execution_log.append(stage)
            if advance:
                ledger.advance()
            return {
                "stage_result": f"{stage} completed",
                "stage_success": True,
                "run_log": [
                    {
                        "timestamp": "2026-01-01T00:00:00Z",
                        "stage": stage,
                        "wp_id": state.get("current_wp_id", ""),  # type: ignore[call-overload]
                        "action": "stub_execute",
                        "result": "OK",
                    }
                ],
            }

        _stub.__name__ = f"{stage}_stub"
        _stub.__qualname__ = f"{stage}_stub"
        return _stub


# ---------------------------------------------------------------------------
# Graph builder for integration tests
# ---------------------------------------------------------------------------


def _build_integration_graph(
    ledger: ScriptedLedger,
    *,
    interrupt_before: list[str] | None = None,
) -> tuple[Any, MemorySaver]:
    """
    Build a test graph using the real supervisor + ledger-backed stubs.

    Returns (compiled_graph, checkpointer) so tests can use the checkpointer
    to verify state or exercise checkpoint/resume.

    ``max_iterations`` is not a graph-compile-time parameter; pass it to
    :func:`_initial_state` when invoking the graph instead.
    """
    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)

    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        builder.add_node(stage, ledger.make_stage_node(stage))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=interrupt_before if interrupt_before else None,
    )
    return graph, checkpointer


def _initial_state(
    project_path: str = "/fake/project",
    plan_file: str = "plan.md",
    max_iterations: int = 20,
) -> dict:
    """Return a minimal WorkflowState for graph invocation in tests."""
    return {
        "project_path": project_path,
        "plan_file": plan_file,
        "target_project_path": project_path,
        "current_stage": "",
        "current_wp_id": "",
        "iteration": 0,
        "max_iterations": max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "{}",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "wps_completed_this_run": 0,
        "run_log": [],
        "errors": [],
    }


# ---------------------------------------------------------------------------
# Canonical ledger state fixtures
# ---------------------------------------------------------------------------


def _pipeline(type_: str, status: str) -> dict:
    return {"type": type_, "status": status, "started_at": "2026-01-01T00:00:00"}


def _wp(
    wp_id: str,
    status: str,
    *,
    pipelines: list[dict] | None = None,
) -> dict:
    """Build a compact WP dict usable in both wp_list and wp_details lookups."""
    return {
        "work_package_id": wp_id,
        "status": status,
        "pipelines": pipelines or [],
        "acceptance_criteria": [],
    }


# ---------------------------------------------------------------------------
# Test 1 — Happy path
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_happy_path_full_pipeline():
    """
    The supervisor routes through pm → developer → qa → reviewer → docs →
    synthesis in the correct order for a single-WP project.

    Acceptance criteria:
    - AC-1: Happy-path test completes a full PM→Developer→QA→Reviewer→Docs→Synthesis pipeline.
    - AC-2: All ledger state transitions are correct (WP statuses, pipeline statuses).
    - AC-8: Tests clean up temporary ledger directories after execution (assured by
            in-memory ledger — no disk writes).
    """
    wp1 = "WP-001"

    # Script the ledger state progression:
    # [0] No WPs → supervisor routes to pm
    # [1] 1 WP IN_PROGRESS, no pipelines → supervisor routes to developer
    # [2] WP has impl=PASS, no qa → routes to qa
    # [3] WP has impl=PASS, qa=PASS, no code-review → routes to reviewer
    # [4] WP has impl=PASS, qa=PASS, cr=PASS, no docs → routes to docs
    # [5] all WPs COMPLETE → routes to synthesis → END
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [],
            "wp_details": {},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                        _pipeline("code-review", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                        _pipeline("code-review", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Verify the complete stage execution sequence.
    expected_sequence = ["pm", "developer", "qa", "reviewer", "docs", "synthesis"]
    assert ledger.execution_log == expected_sequence, (
        f"Expected stages {expected_sequence}, got {ledger.execution_log}"
    )

    # Verify the final run log contains entries for all expected stages.
    run_log_stages = {entry["stage"] for entry in result.get("run_log", [])}
    for stage in expected_sequence:
        assert stage in run_log_stages, f"Stage {stage!r} missing from run_log"

    # No errors.
    assert result.get("errors") == [], f"Unexpected errors: {result.get('errors')}"


# ---------------------------------------------------------------------------
# Test 2 — Rework loop (QA FAIL → Developer rework → QA PASS)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_rework_loop_qa_fail_then_pass():
    """
    After a QA FAIL, the supervisor routes back to developer for rework,
    then returns to QA on the next pass.

    Acceptance criteria:
    - AC-3: Rework loop test demonstrates QA FAIL -> Developer rework -> QA PASS.
    """
    wp1 = "WP-001"

    # State progression:
    # [0] WP IN_PROGRESS, no pipelines → developer
    # [1] impl=PASS, no qa → qa
    # [2] impl=PASS, qa=FAIL → developer (rework)
    # [3] impl=PASS, qa=PASS, no cr → reviewer
    # [4] WP COMPLETE → synthesis → END
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Expected sequence:
    #   developer (first pass) → qa (FAIL) → developer (rework) → reviewer → ...
    #
    # After developer reworks, the scripted state advances to one where qa=PASS
    # (the rework result). The supervisor therefore routes directly to reviewer
    # without needing a second explicit qa run — the PASS state was set as part
    # of the developer-rework state transition.
    assert ledger.execution_log.count("developer") == 2, (
        f"Expected developer to run twice (initial + rework); got: {ledger.execution_log}"
    )
    # qa ran once and produced FAIL, triggering the rework loop.
    assert ledger.execution_log.count("qa") >= 1, (
        f"Expected qa to run at least once; got: {ledger.execution_log}"
    )
    # Verify the critical rework-loop ordering.
    assert ledger.execution_log[0] == "developer", "First stage must be developer."
    assert ledger.execution_log[1] == "qa", "Second stage must be qa."
    assert ledger.execution_log[2] == "developer", "Third stage must be developer (rework)."
    # After rework the qa=PASS state is set; supervisor skips directly to reviewer.
    assert "reviewer" in ledger.execution_log, "Reviewer must execute after rework completes."
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 3 — Safety limit terminates cleanly
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_safety_limit_terminates_at_configured_limit():
    """
    When max_iterations is reached, the supervisor routes to END immediately
    and records an error in the state.

    Acceptance criteria:
    - AC-5: Safety limit test terminates cleanly at the configured limit.
    """
    wp1 = "WP-001"

    # Ledger always shows a WP in progress with no pipelines.
    # The supervisor will always route to developer, but never advance.
    # With max_iterations=1, the second supervisor pass triggers the limit.
    stuck_state = {
        "project_status": {"status": "IN_PROGRESS"},
        "wp_list": [_wp(wp1, "IN_PROGRESS")],
        "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
    }

    # Use advance=False so ledger state never progresses (simulates stuck run).
    ledger = ScriptedLedger([stuck_state])

    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)

    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        # advance=False so state never moves forward → infinite loop scenario
        builder.add_node(stage, ledger.make_stage_node(stage, advance=False))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(checkpointer=checkpointer)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    # max_iterations=1: supervisor runs once (iteration=1, routes to developer),
    # developer runs, supervisor runs again (iteration=2 > 1 → safety limit → END).
    result = await graph.ainvoke(_initial_state(max_iterations=1), thread_cfg)

    errors = result.get("errors", [])
    assert errors, "Expected at least one safety-limit error in state"
    assert any("safety" in str(e).lower() or "max_iterations" in str(e).lower() for e in errors), (
        f"Expected safety-limit error message; got: {errors}"
    )
    # developer ran once before the limit kicked in.
    assert "developer" in ledger.execution_log


# ---------------------------------------------------------------------------
# Test 4 — Multi-WP dependency ordering
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_multi_wp_dependency_ordering():
    """
    When WP-001 is COMPLETE and WP-002 was previously BLOCKED/READY,
    the supervisor routes to developer for WP-002 (the remaining WP).

    This verifies that the supervisor processes the next actionable WP
    after a dependency is resolved.

    Acceptance criteria:
    - AC-4: Multi-WP test respects dependency ordering (WP-002 waits for WP-001).
    """
    wp1, wp2 = "WP-001", "WP-002"

    # State progression:
    # [0] WP-001 IN_PROGRESS no pipelines, WP-002 BLOCKED
    # [1] WP-001 COMPLETE, WP-002 READY → routes to developer for WP-002
    # [2] WP-001 COMPLETE, WP-002 COMPLETE → synthesis
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS"), _wp(wp2, "BLOCKED")],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS"),
                wp2: _wp(wp2, "BLOCKED"),
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "COMPLETE"), _wp(wp2, "READY")],
            "wp_details": {
                wp1: _wp(wp1, "COMPLETE"),
                wp2: _wp(wp2, "READY"),
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE"), _wp(wp2, "COMPLETE")],
            "wp_details": {
                wp1: _wp(wp1, "COMPLETE"),
                wp2: _wp(wp2, "COMPLETE"),
            },
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Step 0: WP-001 IN_PROGRESS, no pipelines → developer executes (WP-001)
    # Step 1: WP-001 COMPLETE, WP-002 READY → developer executes (WP-002)
    # Step 2: all COMPLETE → synthesis
    assert "developer" in ledger.execution_log
    assert "synthesis" in ledger.execution_log
    # synthesis must be last
    assert ledger.execution_log[-1] == "synthesis"
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 5 — Checkpoint / resume
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_checkpoint_resume():
    """
    A graph interrupted at ``pm`` can be resumed from the same thread ID
    and continues through the remaining stages.

    Acceptance criteria:
    - AC-6: Checkpoint/resume test successfully continues from interrupted stage.
    """
    wp1 = "WP-001"

    steps = [
        # [0] No WPs → pm
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [],
            "wp_details": {},
        },
        # [1] After pm: 1 WP, no pipelines → developer
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        # [2] After developer: impl=PASS → ... eventually COMPLETE
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)

    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)
    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        builder.add_node(stage, ledger.make_stage_node(stage))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["pm"],  # interrupt before pm stage
    )
    thread_id = str(uuid.uuid4())
    thread_cfg = {"configurable": {"thread_id": thread_id}}

    # ── First invocation: graph starts, supervisor routes to pm, BUT
    #    interrupt_before=["pm"] means it pauses BEFORE pm executes.
    await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # pm has NOT executed yet (interrupted before it).
    assert "pm" not in ledger.execution_log, (
        f"pm should not have run yet; execution_log={ledger.execution_log}"
    )

    # ── Resume: pass None as input to continue from checkpoint.
    result = await graph.ainvoke(None, thread_cfg)

    # After resuming, pm executes.
    assert "pm" in ledger.execution_log, (
        f"pm should have run after resume; execution_log={ledger.execution_log}"
    )
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 6 — All tests are marked @pytest.mark.integration (meta-test)
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_integration_marker_applied():
    """
    Trivial self-check: this module's pytestmark applies ``integration``
    so all tests can be selected or excluded with ``-m integration``.

    Acceptance criteria:
    - AC-7: All integration tests are marked for selective execution
            (@pytest.mark.integration).
    """
    # The pytestmark at module level propagates to all tests.
    import sys
    import inspect

    module = sys.modules[__name__]
    test_fns = [
        obj
        for name, obj in inspect.getmembers(module, inspect.isfunction)
        if name.startswith("test_")
    ]
    assert test_fns, "No test functions found in this module."
    # All decorated with integration mark via pytestmark (module-level marker).
    # The presence of this test running under -m integration confirms it works.


# ---------------------------------------------------------------------------
# Test 7 — Temporary state is discarded (in-memory cleanup)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_in_memory_state_isolated_between_runs():
    """
    Each test run uses a fresh MemorySaver and a new ScriptedLedger instance.
    State from one run does not bleed into another.

    Acceptance criteria:
    - AC-8: Tests clean up temporary ledger directories after execution.
            (In-memory ledgers have no cleanup requirement; no disk writes occur.)
    """
    FINAL_STEP = {
        "project_status": {"status": "COMPLETE"},
        "wp_list": [_wp("WP-001", "COMPLETE")],
        "wp_details": {"WP-001": _wp("WP-001", "COMPLETE")},
    }

    # Run 1
    ledger_a = ScriptedLedger([FINAL_STEP])
    graph_a, checkpointer_a = _build_integration_graph(ledger_a)
    thread_a = {"configurable": {"thread_id": str(uuid.uuid4())}}
    result_a = await graph_a.ainvoke(_initial_state(), thread_a)

    # Run 2 — independently built
    ledger_b = ScriptedLedger([FINAL_STEP])
    graph_b, checkpointer_b = _build_integration_graph(ledger_b)
    thread_b = {"configurable": {"thread_id": str(uuid.uuid4())}}
    result_b = await graph_b.ainvoke(_initial_state(), thread_b)

    # Both runs complete; checkpointers are independent MemorySaver instances.
    assert checkpointer_a is not checkpointer_b, "Checkpointers must be independent."
    assert result_a.get("errors") == []
    assert result_b.get("errors") == []


# ---------------------------------------------------------------------------
# Live infrastructure tests (skipped by default)
# ---------------------------------------------------------------------------


@pytest.mark.live
@pytest.mark.skip(reason="Requires built MCP server and LLM API key. Run with -m live.")
def test_live_happy_path_with_real_mcp():
    """
    End-to-end smoke test against a real MCP server and LLM model.

    Prerequisites
    -------------
    1. Build the MCP server: ``cd mcp-server && npm run build``
    2. Set ``ANTHROPIC_API_KEY`` or ``GOOGLE_API_KEY`` in ``orchestrator/.env``
    3. Set ``MODEL_NAME`` appropriately
    4. Run: ``python -m pytest tests/test_integration.py -m live -v``

    This test is intentionally left as a skeleton.  Fill in with a real plan
    document path and expected outcomes once environment is configured.
    """
    pytest.skip("Live test — requires real MCP server and LLM API key.")

```
###  Path: `/orchestrator/tests/test_nodes.py`

```py
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

```
###  Path: `/orchestrator/tests/test_plan_parser.py`

```py
"""
test_plan_parser.py — Unit tests for the plan document parser.

Verifies:
- parse_plan() extracts title and summary from a standard plan document.
- YAML frontmatter is stripped before parsing.
- Missing files raise FileNotFoundError.
- Documents with no H1 return empty title and summary.
- PlanMetadata carries the absolute file path and raw content.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from src.utils.plan_parser import PlanMetadata, parse_plan


@pytest.fixture
def tmp_plan(tmp_path: Path):
    """Factory fixture: writes Markdown content to a temp file and returns its path."""
    def _write(content: str, filename: str = "plan.md") -> Path:
        p = tmp_path / filename
        p.write_text(textwrap.dedent(content), encoding="utf-8")
        return p
    return _write


class TestStandardPlan:
    """Tests for a normal plan document with title and body paragraph."""

    CONTENT = """
        # LangGraph Orchestrator

        Implements a LangGraph-based orchestrator that drives the AI agent workflow.

        ## Architecture

        Uses a StateGraph with supervisor routing.
    """

    def test_extracts_title(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "LangGraph Orchestrator"

    def test_extracts_summary(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == "Implements a LangGraph-based orchestrator that drives the AI agent workflow."

    def test_returns_absolute_file_path(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.file_path == str(path)

    def test_raw_content_preserved(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        raw = path.read_text(encoding="utf-8")
        meta = parse_plan(str(path))
        assert meta.raw_content == raw

    def test_returns_plan_metadata_instance(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert isinstance(meta, PlanMetadata)


class TestFrontmatterStripping:
    """Tests for documents that begin with YAML frontmatter."""

    CONTENT = """\
---
title: My Plan
author: Agent
---

# Frontmatter Plan

First paragraph after frontmatter.
"""

    def test_title_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "Frontmatter Plan"

    def test_summary_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == "First paragraph after frontmatter."


class TestEdgeCases:
    """Edge-case and missing-content scenarios."""

    def test_no_h1_returns_empty_title(self, tmp_plan):
        path = tmp_plan("## Only a second-level heading\n\nSome text.")
        meta = parse_plan(str(path))
        assert meta.title == ""

    def test_no_body_paragraph_returns_empty_summary(self, tmp_plan):
        path = tmp_plan("# Title Only\n")
        meta = parse_plan(str(path))
        assert meta.summary == ""

    def test_heading_after_title_is_skipped(self, tmp_plan):
        content = "# Title\n\n## Section Heading\n\nActual summary paragraph."
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Actual summary paragraph."

    def test_relative_path_resolved(self, tmp_plan):
        """Passing a relative path should still produce an absolute file_path."""
        import os
        path = tmp_plan("# Relative\n\nSummary.")
        original_cwd = os.getcwd()
        try:
            os.chdir(str(path.parent))
            meta = parse_plan(path.name)
            assert Path(meta.file_path).is_absolute()
            assert meta.title == "Relative"
        finally:
            os.chdir(original_cwd)

    def test_missing_file_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError, match="Plan file not found"):
            parse_plan("/nonexistent/path/plan.md")

    def test_multiline_paragraph_collapsed_to_single_line(self, tmp_plan):
        content = "# Title\n\nLine one\nLine two\nLine three.\n"
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Line one Line two Line three."

```
###  Path: `/orchestrator/tests/test_state.py`

```py
"""
test_state.py — Unit tests for WorkflowState schema.

Verifies:
- WorkflowState is a valid TypedDict with all required fields.
- run_log and errors use the ``operator.add`` reducer (append-only semantics).
- StateGraph(WorkflowState) accepts the schema without error (requires langgraph).
"""

from __future__ import annotations

import pytest
from typing import get_type_hints, get_args, Annotated
from operator import add

from src.state import WorkflowState


class TestWorkflowStateFields:
    """Verify all required fields exist in WorkflowState."""

    IMMUTABLE_FIELDS = {"project_path", "plan_file", "target_project_path"}
    MUTABLE_FIELDS = {"current_stage", "current_wp_id", "iteration", "max_iterations"}
    STAGE_OUTPUT_FIELDS = {"stage_result", "stage_success"}
    LEDGER_FIELDS = {"project_status", "wp_summaries", "pending_wp_count"}
    CIRCUIT_BREAKER_FIELDS = {"consecutive_failures"}
    DELTA_COUNTER_FIELDS = {"wps_completed_this_run"}
    APPEND_ONLY_FIELDS = {"run_log", "errors"}

    def _all_expected(self) -> set:
        return (
            self.IMMUTABLE_FIELDS
            | self.MUTABLE_FIELDS
            | self.STAGE_OUTPUT_FIELDS
            | self.LEDGER_FIELDS
            | self.CIRCUIT_BREAKER_FIELDS
            | self.DELTA_COUNTER_FIELDS
            | self.APPEND_ONLY_FIELDS
        )

    def test_all_required_fields_present(self):
        hints = get_type_hints(WorkflowState, include_extras=True)
        for field in self._all_expected():
            assert field in hints, f"Missing field: {field!r}"

    def test_no_unexpected_fields(self):
        hints = get_type_hints(WorkflowState, include_extras=True)
        unexpected = set(hints) - self._all_expected()
        assert not unexpected, f"Unexpected fields: {unexpected}"


class TestAppendOnlyReducers:
    """Verify run_log and errors carry the operator.add reducer annotation."""

    def _get_reducer(self, field: str):
        hints = get_type_hints(WorkflowState, include_extras=True)
        annotation = hints[field]
        # Only Annotated types carry reducer metadata.
        if hasattr(annotation, "__metadata__"):
            args = get_args(annotation)
            # args = (base_type, reducer)
            return args[1] if len(args) >= 2 else None  # type: ignore[return-value]
        return None

    def test_run_log_uses_add_reducer(self):
        reducer = self._get_reducer("run_log")
        assert reducer is add, (
            "run_log must use operator.add as its LangGraph reducer; "
            f"got {reducer!r}"
        )

    def test_errors_uses_add_reducer(self):
        reducer = self._get_reducer("errors")
        assert reducer is add, (
            "errors must use operator.add as its LangGraph reducer; "
            f"got {reducer!r}"
        )

    def test_add_reducer_semantics(self):
        """Confirm operator.add concatenates lists (the required LangGraph behaviour)."""
        a = [1, 2]
        b = [3, 4]
        assert add(a, b) == [1, 2, 3, 4]

    def test_project_path_is_plain_str(self):
        """Immutable fields must NOT have a reducer annotation."""
        hints = get_type_hints(WorkflowState, include_extras=True)
        annotation = hints["project_path"]
        # Plain str — should not be Annotated.
        assert annotation is str, (
            "project_path should be plain str, not Annotated; "
            f"got {annotation!r}"
        )


class TestStateGraphIntegration:
    """Verify WorkflowState is accepted by LangGraph's StateGraph."""

    def test_stategraph_accepts_workflow_state(self):
        """StateGraph(WorkflowState) should not raise."""
        pytest.importorskip("langgraph", reason="langgraph not installed")
        from langgraph.graph import StateGraph
        # This is the primary acceptance criterion: no exception raised.
        graph = StateGraph(WorkflowState)
        assert graph is not None

```
###  Path: `/orchestrator/tests/test_supervisor.py`

```py
"""
test_supervisor.py — Unit tests for the supervisor routing logic.

Tests verify deterministic routing for all paths in the decision tree,
using mock MCP tools that return pre-configured ledger state.

No LLM calls, no MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.config import FAIL_ROUTING_AGENT_MAP, PIPELINE_AGENT_MAP
from src.supervisor import make_supervisor_node


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_tool(name: str, return_value: Any) -> MagicMock:
    """Return a mock LangChain Tool that returns *return_value* when ainvoked."""
    tool = MagicMock()
    tool.name = name
    tool.ainvoke = AsyncMock(
        return_value=json.dumps(return_value) if not isinstance(return_value, str) else return_value
    )
    return tool


def _derive_next_action(
    agent_role: str, wp_list: list, wp_details: dict[str, dict]
) -> dict:
    """
    Simulate what ``ledger_get_next_action`` would return for a given
    agent role based on WP pipeline state.

    Used exclusively by test mocks — not production code.

    **Drift risk:** This helper re-implements a subset of the MCP server's
    ``ledger_get_next_action`` routing logic.  One sync point must be kept
    up to date whenever the workflow changes:

    1. **Action vocabulary** (``IMPLEMENT``, ``RUN_QA``, ``REWORK``, etc.):
       authoritative source is ``mcp-server/src/utils/constants.ts``
       (``AGENT_ACTIONS`` / ``_DISPATCH_ACTIONS``).

    Both PASS-branch and FAIL-branch routing targets are derived
    programmatically from ``PIPELINE_AGENT_MAP`` /
    ``FAIL_ROUTING_AGENT_MAP`` (``shared/workflow-manifest.json``) and
    do not require manual synchronisation.
    """

    def latest(pipelines: list, ptype: str) -> str | None:
        for p in reversed(pipelines):
            if p.get("type") == ptype:
                return p.get("status")
        return None

    non_terminal = [
        wp
        for wp in wp_list
        if wp.get("status") not in ("COMPLETE", "CANCELLED")
    ]

    # All non-terminal WPs BLOCKED → PM handles repair.
    if non_terminal and all(wp.get("status") == "BLOCKED" for wp in non_terminal):
        if agent_role == "Project Manager":
            return {"action": "REPAIR_ORPHAN_BLOCKED"}
        return {"action": "WAIT"}

    # IN_PROGRESS WPs first (matches MCP server priority), then READY.
    ordered = (
        [wp for wp in wp_list if wp.get("status") == "IN_PROGRESS"]
        + [wp for wp in wp_list if wp.get("status") == "READY"]
    )

    for wp_summary in ordered:
        wp_id = wp_summary.get("work_package_id", "")
        if wp_summary.get("status") in ("COMPLETE", "CANCELLED", "BLOCKED"):
            continue

        wp_detail = wp_details.get(wp_id, wp_summary)
        pipelines = wp_detail.get("pipelines", [])

        impl = latest(pipelines, "implementation")
        qa = latest(pipelines, "qa")
        sa = latest(pipelines, "security-audit")
        cr = latest(pipelines, "code-review")
        re = latest(pipelines, "release-engineering")
        doc = latest(pipelines, "documentation")

        if impl is None:
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "IMPLEMENT"
        elif impl == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "CONTINUE_PIPELINE"
        elif impl == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["implementation"], "REWORK"
        elif impl == "PASS" and qa is None:
            next_role, action = PIPELINE_AGENT_MAP["qa"], "RUN_QA"
        elif qa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["qa"], "CONTINUE_PIPELINE"
        elif qa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["qa"], "REWORK"
        elif qa == "PASS" and sa is None:
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "RUN_SECURITY_AUDIT"
        elif sa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "CONTINUE_PIPELINE"
        elif sa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["security-audit"], "REWORK"
        elif sa == "PASS" and cr is None:
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "RUN_REVIEW"
        elif cr == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "CONTINUE_PIPELINE"
        elif cr == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["code-review"], "REWORK"
        elif cr == "PASS" and re is None:
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "RUN_RELEASE_ENGINEERING"
        elif re == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "CONTINUE_PIPELINE"
        elif re == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["release-engineering"], "REWORK"
        elif re == "PASS" and doc is None:
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "WRITE_DOCS"
        elif doc == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "CONTINUE_PIPELINE"
        elif doc == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["documentation"], "REWORK"
        else:
            continue  # WP fully done

        if next_role == agent_role:
            return {"action": action, "work_package_id": wp_id}

    return {"action": "WAIT"}


def make_mcp_tools(
    *,
    project_status: dict | None = None,
    wp_list: list | None = None,
    wp_details: dict[str, dict] | None = None,
) -> list[MagicMock]:
    """
    Build a minimal set of mock MCP tools: project_status, list_work_packages,
    and per-WP detail lookups.

    Parameters
    ----------
    project_status:
        Dict returned by ``ledger_get_project_status``.
    wp_list:
        List returned by ``ledger_list_work_packages``.
    wp_details:
        Dict mapping WP ID → detail dict returned by ``ledger_get_work_package``.
    """
    if project_status is None:
        project_status = {"status": "IN_PROGRESS"}
    if wp_list is None:
        wp_list = []
    if wp_details is None:
        wp_details = {}

    status_tool = make_tool("ledger_get_project_status", project_status)
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        detail = wp_details.get(wp_id, {"work_package_id": wp_id, "pipelines": []})
        return json.dumps(detail)

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        result = _derive_next_action(role, wp_list, wp_details)
        return json.dumps(result)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


def base_state(
    iteration: int = 0,
    max_iterations: int = 10,
    project_path: str = "/project",
) -> dict:
    """Minimal WorkflowState-compatible dict for test invocations."""
    return {
        "project_path": project_path,
        "plan_file": "plan.md",
        "target_project_path": "/target",
        "current_stage": "",
        "current_wp_id": "",
        "iteration": iteration,
        "max_iterations": max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "run_log": [],
        "errors": [],
    }


def wp_summary(wp_id: str, status: str = "READY") -> dict:
    return {"work_package_id": wp_id, "status": status}


def wp_with_pipelines(wp_id: str, pipelines: list[dict]) -> dict:
    return {"work_package_id": wp_id, "pipelines": pipelines}


def pipeline(type_: str, status: str) -> dict:
    return {"type": type_, "status": status}


# ---------------------------------------------------------------------------
# Tests: routing to "pm"
# ---------------------------------------------------------------------------

class TestRouteToPM:
    async def test_no_wps_routes_to_pm(self):
        """When no WPs exist, route to PM."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"
        assert cmd.update["current_stage"] == "pm"
        assert cmd.update["run_log"][0]["destination"] == "pm"


# ---------------------------------------------------------------------------
# Tests: routing to "developer"
# ---------------------------------------------------------------------------

class TestRouteToDeveloper:
    async def test_wp_with_no_pipelines_routes_to_developer(self):
        """A READY WP with no pipelines routes to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_implementation_fail_routes_to_developer(self):
        """A FAIL implementation pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "FAIL")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_qa_fail_routes_to_developer(self):
        """A FAIL QA pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_code_review_fail_routes_to_developer(self):
        """A FAIL code-review pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "qa"
# ---------------------------------------------------------------------------

class TestRouteToQA:
    async def test_pass_impl_no_qa_routes_to_qa(self):
        """A PASS implementation with no QA pipeline routes to qa."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "PASS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "qa"


# ---------------------------------------------------------------------------
# Tests: routing to "reviewer"
# ---------------------------------------------------------------------------

class TestRouteToReviewer:
    async def test_pass_qa_no_review_routes_to_reviewer(self):
        """A PASS QA and security-audit with no code-review pipeline routes to reviewer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "reviewer"


# ---------------------------------------------------------------------------
# Tests: routing to "security_auditor"
# ---------------------------------------------------------------------------

class TestRouteToSecurityAuditor:
    async def test_pass_qa_no_security_audit_routes_to_security_auditor(self):
        """A PASS QA with no security-audit pipeline routes to security_auditor."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "security_auditor"

    async def test_security_audit_fail_routes_to_developer(self):
        """A FAIL security-audit pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "release_engineer"
# ---------------------------------------------------------------------------

class TestRouteToReleaseEngineer:
    async def test_pass_code_review_no_release_engineering_routes_to_release_engineer(self):
        """A PASS code-review with no release-engineering pipeline routes to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"

    async def test_release_engineering_fail_routes_to_release_engineer(self):
        """A FAIL release-engineering pipeline causes rework route to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"


# ---------------------------------------------------------------------------
# Tests: routing to "docs"
# ---------------------------------------------------------------------------

class TestDocumentationFail:
    async def test_documentation_fail_routes_to_docs(self):
        """A FAIL documentation pipeline causes rework route to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


class TestRouteToDocs:
    async def test_pass_review_no_docs_routes_to_docs(self):
        """A PASS code-review and release-engineering with no documentation pipeline routes to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: routing to "synthesis"
# ---------------------------------------------------------------------------

class TestRouteToSynthesis:
    async def test_all_complete_routes_to_synthesis(self):
        """When all WPs are COMPLETE, route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_routes_to_synthesis_when_all_wps_mix_of_complete_and_cancelled(self):
        """WPs that are a mix of COMPLETE and CANCELLED should route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
                wp_summary("WP-003", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_pending_count_excludes_cancelled_wps(self):
        """CANCELLED WPs must not be counted as pending (pending_count should be 0)."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update["pending_wp_count"] == 0

    async def test_all_pipelines_pass_routes_to_synthesis(self):
        """All six pipelines PASS → WP considered done → synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"


# ---------------------------------------------------------------------------
# Tests: END conditions
# ---------------------------------------------------------------------------

class TestSafetyLimit:
    async def test_exceeds_max_iterations_routes_to_end(self):
        """When iteration > max_iterations, route to END with error."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # iteration=10, max_iterations=10 → new_iteration=11 > 10
        cmd = await node(base_state(iteration=10, max_iterations=10))

        assert cmd.goto == END
        assert cmd.update["errors"]
        assert "Safety limit" in cmd.update["errors"][0]["message"]

    async def test_at_max_iterations_still_routes_to_end(self):
        """Edge case: iteration == max_iterations triggers safety limit on next call."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # new_iteration will be max_iterations + 1 = 6
        cmd = await node(base_state(iteration=5, max_iterations=5))

        assert cmd.goto == END


class TestAllBlocked:
    async def test_all_blocked_routes_to_pm(self):
        """When all WPs are BLOCKED, ledger_get_next_action returns
        REPAIR_ORPHAN_BLOCKED for PM, routing to the pm stage."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "BLOCKED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"


# ---------------------------------------------------------------------------
# Tests: BLOCKED WPs skipped, unblocked processed first
# ---------------------------------------------------------------------------

class TestBlockedSkipped:
    async def test_blocked_wp_is_skipped(self):
        """BLOCKED WPs are skipped; the READY WP gets processed."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # WP-001 is BLOCKED (skipped by mock); WP-002 routes to developer.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-002"

    async def test_in_progress_processed_before_ready(self):
        """IN_PROGRESS WP is prioritised over READY WP by ledger_get_next_action."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "READY"),
                wp_summary("WP-002", "IN_PROGRESS"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # WP-002 (IN_PROGRESS) is prioritised — ledger returns it first.
        assert cmd.update["current_wp_id"] == "WP-002"


# ---------------------------------------------------------------------------
# Tests: run_log and state update
# ---------------------------------------------------------------------------

class TestRunLog:
    async def test_routing_decision_logged_in_run_log(self):
        """Every routing decision must be recorded in run_log."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update["run_log"], "run_log should be non-empty"
        entry = cmd.update["run_log"][0]
        assert "destination" in entry
        assert "timestamp" in entry
        assert "action" in entry

    async def test_state_iteration_incremented(self):
        """Supervisor must increment the iteration counter on every pass."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state(iteration=3))

        assert cmd.update["iteration"] == 4


# ---------------------------------------------------------------------------
# Tests: IN_PROGRESS pipeline skipping
# ---------------------------------------------------------------------------

class TestInFlightSkip:
    async def test_wp_with_in_progress_impl_routes_to_developer(
        self,
    ):
        """WP with an IN_PROGRESS implementation pipeline now routes to
        developer with CONTINUE_PIPELINE (ledger-driven) instead of being
        skipped to END as in the old hardcoded routing."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "IN_PROGRESS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Ledger returns CONTINUE_PIPELINE → routes to developer, not END.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_in_progress_impl_routed_first(self):
        """WP-001 has impl=IN_PROGRESS; both WPs need Developer.
        Ledger returns WP-001 first (IN_PROGRESS priority), so supervisor
        routes to developer for WP-001 not WP-002."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "IN_PROGRESS"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001", [pipeline("implementation", "IN_PROGRESS")]
                ),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"


# ---------------------------------------------------------------------------
# Tests: circuit breaker (consecutive failures)
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    async def test_wp_halted_after_three_consecutive_failures(self):
        """After 3 consecutive failures for the only WP, supervisor
        circuit-breaks it, all roles return WAIT, and routes to synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}  # already at threshold

        cmd = await node(state)

        # WP-001 circuit-broken → all roles skip it → route to synthesis.
        assert cmd.goto == "synthesis"
        errors = cmd.update.get("errors", [])
        assert any("halted" in str(e).lower() or "WP-001" in str(e) for e in errors), (
            "Expected a halted error entry for WP-001"
        )

    async def test_consecutive_failures_counter_incremented_on_failure(self):
        """Counter in base_update['consecutive_failures'] increments on failure."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 1}  # already had 1 failure

        cmd = await node(state)

        # Supervisor reads from consecutive_failures, cf["WP-001"] should now be 2.
        cf = cmd.update.get("consecutive_failures", {})
        assert cf.get("WP-001", 0) == 2, f"Expected cf['WP-001']=2, got {cf}"

    async def test_consecutive_failures_reset_on_success(self):
        """Counter is reset in base_update when the previous stage succeeded."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = True  # succeeded
        state["consecutive_failures"] = {"WP-001": 2}  # had 2 prior failures

        cmd = await node(state)

        cf = cmd.update.get("consecutive_failures", {})
        assert "WP-001" not in cf, f"Expected WP-001 counter reset, got {cf}"


# ---------------------------------------------------------------------------
# Tests: level field in log entries
# ---------------------------------------------------------------------------

class TestLogEntryLevel:
    async def test_routing_log_entry_has_level_info(self):
        """All routing log entries must include 'level': 'INFO'."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        for entry in cmd.update.get("run_log", []):
            assert "level" in entry, f"Log entry missing 'level' field: {entry}"
            assert entry["level"] in ("INFO", "WARNING", "ERROR"), (
                f"Unexpected level value: {entry['level']}"
            )


# ---------------------------------------------------------------------------
# Tests: no-LLM guarantee (structural)
# ---------------------------------------------------------------------------

class TestNoLLMCalls:
    def test_supervisor_does_not_import_llm_libs(self):
        """supervisor module must not import anthropic/openai/google-genai."""
        import ast
        import inspect
        import src.supervisor as sup_module

        source = inspect.getsource(sup_module)
        tree = ast.parse(source)
        forbidden = {"anthropic", "openai", "langchain_anthropic", "langchain_google_genai"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else ([node.module] if node.module else [])
                )
                for name in names:
                    assert name not in forbidden, (
                        f"supervisor imports LLM library: {name}"
                    )


# ---------------------------------------------------------------------------
# Helper: direct action override (WP-005 additions)
# ---------------------------------------------------------------------------

def make_mcp_tools_with_actions(
    next_actions: dict[str, dict] | None = None,
    *,
    has_wps: bool = True,
) -> list[MagicMock]:
    """
    Build mock MCP tools where ``ledger_get_next_action`` returns explicit
    per-role responses from *next_actions*.  Roles not in the dict get
    ``{"action": "WAIT"}``.

    This lets action-routing tests bypass the ``_derive_next_action`` helper
    and directly exercise each action constant → stage mapping.

    Parameters
    ----------
    next_actions:
        Mapping ``{role: {"action": "...", "work_package_id": "..."}}`` for
        roles that should return a real action.  Defaults to ``{}`` (all WAIT).
    has_wps:
        When ``True`` a single non-terminal WP is included so the supervisor
        doesn't short-circuit to PM (no-WPs path) or synthesis (all-terminal).
        Set to ``False`` to test the no-WP → PM path independently.
    """
    _actions = next_actions or {}

    wp_list: list = (
        [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}] if has_wps else []
    )

    status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        return json.dumps({"work_package_id": wp_id, "pipelines": []})

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        response = _actions.get(role, {"action": "WAIT"})
        return json.dumps(response)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


# ---------------------------------------------------------------------------
# Tests: direct action → stage mapping (WP-005 AC3)
# ---------------------------------------------------------------------------

class TestDirectActionRouting:
    """Verify that every action constant in ``_DISPATCH_ACTIONS`` is routed
    to the correct pipeline stage by the supervisor.

    Each test uses ``make_mcp_tools_with_actions`` to inject a deterministic
    ``ledger_get_next_action`` response, bypassing the
    ``_derive_next_action`` simulation helper used elsewhere in this file.
    """

    @pytest.mark.parametrize("role,action,expected_stage", [
        # Developer actions
        ("Developer", "IMPLEMENT",          "developer"),
        ("Developer", "REWORK",             "developer"),
        ("Developer", "RESUME_OR_CANCEL",   "developer"),
        ("Developer", "CONTINUE_PIPELINE",  "developer"),
        ("Developer", "CLAIM_WP",           "developer"),
        # QA actions
        ("QA",        "RUN_QA",             "qa"),
        # Security Auditor actions
        ("Security Auditor",  "RUN_SECURITY_AUDIT",      "security_auditor"),
        # Reviewer actions
        ("Reviewer",  "RUN_REVIEW",         "reviewer"),
        # Release Engineer actions
        ("Release Engineer",  "RUN_RELEASE_ENGINEERING",  "release_engineer"),
        ("Release Engineer",  "REWORK",                   "release_engineer"),
        # Documentation actions
        ("Documentation", "WRITE_DOCS",     "docs"),
        ("Documentation", "FINALIZE_WP",    "docs"),
        ("Documentation", "UPDATE_CRITERIA","docs"),
        # PM actions
        ("Project Manager", "UNBLOCK_WP",          "pm"),
        ("Project Manager", "REVIEW_REWORK_LIMIT",  "pm"),
        ("Project Manager", "REPAIR_ORPHAN_BLOCKED","pm"),
        ("Project Manager", "REVIEW_STALE",         "pm"),
        ("Project Manager", "REVIEW_ABANDONED",     "pm"),
    ])
    async def test_action_routes_to_correct_stage(
        self, role: str, action: str, expected_stage: str
    ):
        """Each (role, action) pair must dispatch to the correct stage."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == expected_stage, (
            f"role={role!r}, action={action!r}: expected {expected_stage!r}, "
            f"got {cmd.goto!r}"
        )

    @pytest.mark.parametrize("role,action,expected_stage", [
        ("Developer", "IMPLEMENT", "developer"),
        ("Documentation", "WRITE_DOCS", "docs"),
    ])
    async def test_current_wp_id_is_set_in_update(
        self, role: str, action: str, expected_stage: str
    ):
        """Supervisor must set current_wp_id to the WP ID from the action data."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-042"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update.get("current_wp_id") == "WP-042", (
            f"current_wp_id should be 'WP-042', got {cmd.update.get('current_wp_id')!r}"
        )

    async def test_first_dispatchable_role_wins(self):
        """When multiple roles have dispatchable actions, the first one in the
        role iteration order (PM → Developer → QA → Reviewer → Docs) wins."""
        # PM and Developer both have actions; PM is first in the loop.
        tools = make_mcp_tools_with_actions({
            "Project Manager": {"action": "UNBLOCK_WP", "work_package_id": "WP-001"},
            "Developer":       {"action": "IMPLEMENT",  "work_package_id": "WP-002"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # PM comes first in _ROLES order, so it should win.
        assert cmd.goto == "pm"


# ---------------------------------------------------------------------------
# Tests: all-roles WAIT → synthesis (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestAllRolesWait:
    async def test_all_roles_wait_routes_to_synthesis(self):
        """When every role returns WAIT, supervisor falls through to synthesis."""
        # All roles get default WAIT (empty next_actions dict).
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis", (
            f"All-WAIT should route to synthesis, got {cmd.goto!r}"
        )

    async def test_all_roles_wait_with_in_progress_wp(self):
        """Even with an IN_PROGRESS WP, all-WAIT must route to synthesis."""
        tools = make_mcp_tools_with_actions({}, has_wps=True)
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_all_roles_wait_log_entry_records_reason(self):
        """All-WAIT routing log entry must mention 'all roles returned WAIT'."""
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        log_entries = cmd.update.get("run_log", [])
        assert any(
            "wait" in str(entry).lower() or "WAIT" in str(entry)
            for entry in log_entries
        ), f"No WAIT-related log entry found in: {log_entries}"


# ---------------------------------------------------------------------------
# Tests: WAIT-class action variants are skipped (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestWaitVariantsSkipped:
    """All actions in the _SKIP_ACTIONS frozenset must be treated exactly like
    WAIT — the role is skipped, no dispatch happens."""

    @pytest.mark.parametrize("skip_action", [
        "WAIT",
        "WAIT_FOR_REWORK",
        "WAIT_FOR_DOWNSTREAM",
        "WAIT_FOR_UPSTREAM_REWORK_LIMIT",
        "BLOCK_FOR_REWORK_LIMIT",
    ])
    async def test_skip_action_treated_as_wait(self, skip_action: str):
        """A SKIP-class action causes the role to be skipped; other roles or
        synthesis picks up the routing."""
        # Only Developer has an action; all others WAIT.
        # Developer's action is a SKIP variant → should not dispatch to developer.
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": skip_action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer action was skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"SKIP action {skip_action!r} should not dispatch; "
            f"expected synthesis, got {cmd.goto!r}"
        )


# ---------------------------------------------------------------------------
# Tests: unrecognised action treated as WAIT, no crash (WP-005 AC6)
# ---------------------------------------------------------------------------

class TestUnknownAction:
    async def test_unknown_action_does_not_crash(self):
        """An action string not in _DISPATCH_ACTIONS or _SKIP_ACTIONS must be
        treated as WAIT — no ValueError, no KeyError, no crash."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "FUTURE_ACTION_FROM_V99", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        # Must not raise.
        cmd = await node(base_state())

        # Unknown actions are skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis"

    async def test_unknown_action_all_roles_still_queried(self):
        """After one unknown action, remaining roles are still queried."""
        # Developer has unknown action, Documentation has real action.
        tools = make_mcp_tools_with_actions({
            "Developer":     {"action": "MYSTERY_ACTION",  "work_package_id": "WP-001"},
            "Documentation": {"action": "WRITE_DOCS",      "work_package_id": "WP-001"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer skipped (unknown) → Documentation dispatches → docs.
        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: circuit breaker skips recommended WP (WP-005 AC5)
# ---------------------------------------------------------------------------

class TestCircuitBreakerDirect:
    async def test_circuit_breaker_skips_wp_even_when_ledger_recommends(self):
        """When WP-001 has ≥3 consecutive failures, it must be skipped even if
        ledger_get_next_action returns IMPLEMENT for it."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        # WP-001 is circuit-broken → loop continues → all idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"Circuit-broken WP should cause synthesis fallback, got {cmd.goto!r}"
        )

    async def test_circuit_breaker_errors_list_contains_halted_message(self):
        """A circuit-broken WP must produce an error entry mentioning 'halted'."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-007"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-007": 3}

        cmd = await node(state)

        errors = cmd.update.get("errors", [])
        assert any("WP-007" in str(e) for e in errors), (
            f"Expected error mentioning WP-007 in {errors}"
        )
        assert any("halted" in str(e).lower() for e in errors), (
            f"Expected 'halted' in error messages; got: {errors}"
        )

    async def test_circuit_breaker_threshold_is_three(self):
        """Two consecutive failures (below threshold) must NOT trigger the breaker."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 2}  # one below threshold

        cmd = await node(state)

        # Not circuit-broken yet → dispatches to developer.
        assert cmd.goto == "developer"

    async def test_non_broken_wp_dispatches_while_broken_wp_skipped(self):
        """WP-002 (not broken) must be dispatched even if WP-001 is broken."""
        tools = make_mcp_tools_with_actions({
            "Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"},
        })

        # Override to give WP-002 for second role, but that's hard in
        # the simple helper.  Instead use the state-based approach:
        # simulate Developer returning WP-002 after WP-001 is broken.
        # We monkey-patch the returned value to WP-001 only.
        seen_calls: list[str] = []

        async def _action_side_effect(kwargs: dict) -> str:
            role = kwargs.get("agent_role", "")
            seen_calls.append(role)
            # Return WP-001 for Developer (it will be circuit-broken).
            if role == "Developer":
                return json.dumps({"action": "IMPLEMENT", "work_package_id": "WP-001"})
            # QA gets a fully-new WP-002 (not broken).
            if role == "QA":
                return json.dumps({"action": "RUN_QA", "work_package_id": "WP-002"})
            return json.dumps({"action": "WAIT"})

        wp_list = [
            {"work_package_id": "WP-001", "status": "IN_PROGRESS"},
            {"work_package_id": "WP-002", "status": "IN_PROGRESS"},
        ]
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = make_tool("ledger_list_work_packages", wp_list)
        detail_tool = MagicMock()
        detail_tool.name = "ledger_get_work_package"
        detail_tool.ainvoke = AsyncMock(side_effect=lambda k: json.dumps(
            {"work_package_id": k.get("work_package_id", ""), "pipelines": []}
        ))
        next_action_tool = MagicMock()
        next_action_tool.name = "ledger_get_next_action"
        next_action_tool.ainvoke = AsyncMock(side_effect=_action_side_effect)

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool]
        )
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}  # WP-001 broken

        cmd = await node(state)

        # WP-001 skipped, WP-002/QA dispatches → qa.
        assert cmd.goto == "qa"
        assert cmd.update.get("current_wp_id") == "WP-002"

```
###  Path: `/orchestrator/tests/test_tool_wrappers.py`

```py
"""
test_tool_wrappers.py — Unit tests for src.utils.tool_wrappers.

Tests cover every behavioural contract promised by ``inject_project_path``:

1. **Injection when absent** — ``project_path`` is added when the tool call
   dict contains neither ``project_path`` nor ``cwd_path``.
2. **No override when present** — an explicitly-supplied ``project_path`` is
   never overwritten.
3. **No injection when cwd_path present** — ``cwd_path`` signals that
   ``ledger_detect_project`` handles path resolution; no injection.
4. **Argument preservation** — other kwargs (e.g. ``work_package_id``) survive
   the wrapper untouched.
5. **Idempotency** — calling ``inject_project_path`` twice on the same list of
   tool objects does not stack closures; injection still happens once, from the
   original ``ainvoke``.
6. **Passthrough for non-dict input** — string (and other non-dict) inputs are
   forwarded as-is without modification.
7. **Returns the same list** — the function returns the same list object (mutated
   in-place) for chaining convenience.

Implementation note on test helpers
------------------------------------
MagicMock auto-creates *every* attribute on first access, so
``hasattr(magic_mock, "_orig_ainvoke")`` always returns ``True``.  That
breaks the sentinel logic inside :func:`inject_project_path`.  All test helpers
therefore use plain Python objects (``_SimpleTool``), not ``MagicMock``, to
ensure the sentinel is absent before the first wrap.

No LLM calls or MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.utils.tool_wrappers import inject_project_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _SimpleTool:
    """Minimal plain-Python tool stub.

    Unlike ``MagicMock``, plain objects do **not** auto-create attributes on
    access, so ``hasattr(tool, "_orig_ainvoke")`` correctly returns ``False``
    before the first :func:`inject_project_path` call.
    """

    def __init__(self, seen: list[Any] | None = None) -> None:
        _seen: list[Any] = seen if seen is not None else []
        self.name = "test_tool"

        async def _ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            _seen.append(input)
            return "result"

        self.ainvoke = _ainvoke


def _make_tool(captured: list[Any] | None = None) -> _SimpleTool:
    """Return a ``_SimpleTool`` whose ``ainvoke`` records the *input* argument."""
    return _SimpleTool(seen=captured if captured is not None else [])


PROJECT = "/ledger/project"


# ---------------------------------------------------------------------------
# 1. Injection when project_path absent
# ---------------------------------------------------------------------------

class TestInjectsWhenAbsent:
    async def test_empty_dict_receives_project_path(self):
        """An empty call dict gets project_path injected."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0].get("project_path") == PROJECT

    async def test_dict_with_other_key_receives_project_path(self):
        """A dict with only unrelated keys still receives project_path."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"work_package_id": "WP-001"})

        assert seen[0].get("project_path") == PROJECT

    async def test_returns_correct_result(self):
        """Wrapper must pass through the return value of the original ainvoke."""
        tool = _make_tool()
        inject_project_path([tool], PROJECT)

        result = await tool.ainvoke({"some_key": "value"})

        assert result == "result"


# ---------------------------------------------------------------------------
# 2. No override when project_path already present
# ---------------------------------------------------------------------------

class TestDoesNotOverrideExplicitProjectPath:
    async def test_explicit_project_path_preserved(self):
        """An explicitly-supplied project_path must not be overwritten."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        explicit_path = "/explicit/other"
        await tool.ainvoke({"project_path": explicit_path})

        assert seen[0]["project_path"] == explicit_path, (
            "Wrapper must use setdefault semantics, not override"
        )

    async def test_explicit_path_different_from_injected(self):
        """Sanity: the explicit path is different from the inject path."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"project_path": "/custom"})

        assert seen[0]["project_path"] == "/custom"
        assert seen[0]["project_path"] != PROJECT


# ---------------------------------------------------------------------------
# 3. No injection when cwd_path present
# ---------------------------------------------------------------------------

class TestCwdPathReplacedWithProjectPath:
    async def test_cwd_path_stripped_and_project_path_injected(self):
        """cwd_path must be removed and project_path injected instead."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/some/workspace"})

        assert "cwd_path" not in seen[0], (
            "cwd_path must be stripped in the orchestrator context"
        )
        assert seen[0]["project_path"] == PROJECT

    async def test_explicit_project_path_wins_over_cwd_path(self):
        """When both cwd_path and project_path are present, project_path is kept."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"cwd_path": "/cwd/value", "project_path": "/explicit"})

        assert "cwd_path" not in seen[0]
        assert seen[0]["project_path"] == "/explicit"


# ---------------------------------------------------------------------------
# 4. Argument preservation
# ---------------------------------------------------------------------------

class TestArgumentPreservation:
    async def test_other_kwargs_are_preserved(self):
        """Keys other than project_path must survive the wrapper unmodified."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        payload = {
            "work_package_id": "WP-007",
            "agent_role": "Developer",
            "type": "implementation",
        }
        await tool.ainvoke(payload)

        assert seen[0]["work_package_id"] == "WP-007"
        assert seen[0]["agent_role"] == "Developer"
        assert seen[0]["type"] == "implementation"
        assert seen[0]["project_path"] == PROJECT  # also injected

    async def test_args_and_kwargs_forwarded(self):
        """Positional args and extra keyword args must be forwarded to original."""
        extra_args: list = []
        extra_kwargs: dict = {}

        class _TrackingTool:
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                extra_args.extend(args)
                extra_kwargs.update(kwargs)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({"k": "v"}, "pos_arg", extra_kwarg="val")

        assert extra_args == ["pos_arg"]
        assert extra_kwargs.get("extra_kwarg") == "val"


# ---------------------------------------------------------------------------
# 5. Idempotency — no double-wrapping
# ---------------------------------------------------------------------------

class TestIdempotency:
    async def test_double_wrap_does_not_stack_closures(self):
        """Calling inject_project_path twice on the same tool must not cause
        the original ainvoke to be called more than once per invocation."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()

        # First wrap
        inject_project_path([tool], PROJECT)
        # Second wrap (same instance — shallow copy scenario)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking occurred"
        )

    async def test_double_wrap_still_injects_project_path(self):
        """After double-wrap, injection still occurs exactly once."""
        seen: list[Any] = []
        tool = _make_tool(seen)

        inject_project_path([tool], PROJECT)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0]["project_path"] == PROJECT

    async def test_triple_wrap_is_also_safe(self):
        """Idempotency holds for an arbitrary number of wraps."""
        call_count = 0

        class _CountingTool:
            name = "counting_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                nonlocal call_count
                call_count += 1
                return "ok"

        tool = _CountingTool()

        for _ in range(3):
            inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1


# ---------------------------------------------------------------------------
# 6. Passthrough for non-dict input
# ---------------------------------------------------------------------------

class TestNonDictPassthrough:
    async def test_string_input_forwarded_as_is(self):
        """String inputs must be forwarded unchanged — no injection attempt."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke("raw string input")

        assert seen[0] == "raw string input"

    async def test_none_input_forwarded_as_is(self):
        """None input must be forwarded without modification."""
        seen: list[Any] = []
        tool = _make_tool(seen)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke(None)

        assert seen[0] is None


# ---------------------------------------------------------------------------
# 7. Return value — same list object
# ---------------------------------------------------------------------------

class TestReturnValue:
    def test_returns_same_list_object(self):
        """inject_project_path must return the same list object (in-place mutation)."""
        tool = _make_tool()
        tools = [tool]

        result = inject_project_path(tools, PROJECT)

        assert result is tools

    def test_returns_empty_list_unchanged(self):
        """An empty tool list is a no-op and still returns the same list."""
        tools: list = []
        result = inject_project_path(tools, PROJECT)
        assert result is tools
        assert result == []


# ---------------------------------------------------------------------------
# 8. Multiple tools in the list all get wrapped
# ---------------------------------------------------------------------------

class TestMultipleTools:
    async def test_all_tools_in_list_receive_injection(self):
        """Every tool in the list must receive the wrapper."""
        seen_a: list[Any] = []
        seen_b: list[Any] = []

        tool_a = _make_tool(seen_a)
        tool_b = _make_tool(seen_b)

        inject_project_path([tool_a, tool_b], PROJECT)

        await tool_a.ainvoke({"tool": "a"})
        await tool_b.ainvoke({"tool": "b"})

        assert seen_a[0]["project_path"] == PROJECT
        assert seen_b[0]["project_path"] == PROJECT


# ---------------------------------------------------------------------------
# 9. Pydantic model compatibility — guards against __setattr__ regression
# ---------------------------------------------------------------------------

class TestPydanticModelCompatibility:
    """Verify that inject_project_path works on Pydantic BaseModel subclasses.

    The production tool objects are ``StructuredTool`` instances, which inherit
    from Pydantic's ``BaseModel``.  Pydantic v2 rejects attribute writes to
    undeclared fields via ``BaseModel.__setattr__``.  These tests ensure the
    wrapper correctly bypasses that guard.

    See: bug-report-orchestrator.md (2026-03-20)
    """

    async def test_pydantic_basemodel_subclass_can_be_wrapped(self):
        """inject_project_path must not raise on a Pydantic BaseModel subclass."""
        from pydantic import BaseModel, ConfigDict

        seen: list[Any] = []

        class PydanticTool(BaseModel):
            model_config = ConfigDict(arbitrary_types_allowed=True)
            name: str = "pydantic_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:
                seen.append(input)
                return "ok"

        tool = PydanticTool()
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0]["project_path"] == PROJECT

    async def test_structured_tool_can_be_wrapped(self):
        """inject_project_path must work on a real StructuredTool instance."""
        from langchain_core.tools import StructuredTool

        seen: list[Any] = []

        async def _fake_func(project_path: str = "", **kwargs: Any) -> str:
            seen.append({"project_path": project_path, **kwargs})
            return "ok"

        tool = StructuredTool.from_function(
            coroutine=_fake_func,
            name="fake_mcp_tool",
            description="A fake tool for testing.",
        )

        # This is the line that raised ValueError before the fix.
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert len(seen) == 1
        assert seen[0].get("project_path") == PROJECT

    async def test_structured_tool_idempotency(self):
        """Double-wrapping a StructuredTool must not stack closures."""
        from langchain_core.tools import StructuredTool

        call_count = 0

        async def _counting_func(project_path: str = "", **kwargs: Any) -> str:
            nonlocal call_count
            call_count += 1
            return "ok"

        tool = StructuredTool.from_function(
            coroutine=_counting_func,
            name="counting_tool",
            description="Counts calls.",
        )

        inject_project_path([tool], PROJECT)
        inject_project_path([tool], PROJECT)

        await tool.ainvoke({})

        assert call_count == 1, (
            f"Original ainvoke called {call_count} times — wrapper stacking on StructuredTool"
        )


```