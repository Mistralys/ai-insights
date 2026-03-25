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

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

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
            patch(
                "src.supervisor.make_supervisor_node",
                side_effect=lambda tools: _noop_node("supervisor"),
            ),
            patch("src.nodes.pm.make_pm_node", side_effect=lambda cfg, tools: _noop_node("pm")),
            patch(
                "src.nodes.developer.make_developer_node",
                side_effect=lambda cfg, tools: _noop_node("developer"),
            ),
            patch("src.nodes.qa.make_qa_node", side_effect=lambda cfg, tools: _noop_node("qa")),
            patch(
                "src.nodes.reviewer.make_reviewer_node",
                side_effect=lambda cfg, tools: _noop_node("reviewer"),
            ),
            patch(
                "src.nodes.docs.make_docs_node",
                side_effect=lambda cfg, tools: _noop_node("docs"),
            ),
            patch(
                "src.nodes.synthesis.make_synthesis_node",
                side_effect=lambda cfg, tools: _noop_node("synthesis"),
            ),
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
