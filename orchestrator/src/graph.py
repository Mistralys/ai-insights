"""
graph.py — LangGraph StateGraph construction and compilation.

Builds and returns the coordinator hub-and-spoke graph that plugs together:

- The deterministic :func:`~src.supervisor.make_supervisor_node` router.
- Eight pipeline-stage nodes from :mod:`src.nodes`.

Topology
--------
::

    START → supervisor
               ↓ (Command goto=...)
    ┌──────────────────────────────────────┐
    │                                      │
    pm ──────────────────────────────── supervisor
    developer ──────────────────────── supervisor
    qa ──────────────────────────────── supervisor
    security_auditor ───────────────── supervisor
    reviewer ────────────────────────── supervisor
    release_engineer ───────────────── supervisor
    docs ────────────────────────────── supervisor
    synthesis ──────────────────────────── END

No conditional edge functions are needed: the supervisor returns
``Command(goto=<stage>)`` so LangGraph routes dynamically from the return value.
``synthesis`` edges directly to END rather than back to the supervisor (terminal stage).

Public API
----------
:func:`build_graph`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.config import Config

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graph stage names (must match supervisor routing constants)
# ---------------------------------------------------------------------------

_STAGE_SUPERVISOR = "supervisor"
_STAGE_PM = "pm"
_STAGE_DEVELOPER = "developer"
_STAGE_QA = "qa"
_STAGE_SECURITY_AUDITOR = "security_auditor"
_STAGE_REVIEWER = "reviewer"
_STAGE_RELEASE_ENGINEER = "release_engineer"
_STAGE_DOCS = "docs"
_STAGE_SYNTHESIS = "synthesis"

# All stages that loop back to the supervisor after completion.
_LOOP_STAGES = (
    _STAGE_PM,
    _STAGE_DEVELOPER,
    _STAGE_QA,
    _STAGE_SECURITY_AUDITOR,
    _STAGE_REVIEWER,
    _STAGE_RELEASE_ENGINEER,
    _STAGE_DOCS,
)


# ---------------------------------------------------------------------------
# Dry-run stub factory
# ---------------------------------------------------------------------------

def _make_dryrun_node(stage: str):
    """
    Return a no-op LangGraph node for ``--dry-run`` mode.

    The stub logs the stage name and returns a state update indicating
    success without invoking the Deep Agent.
    """
    from src.utils.logging import get_run_logger

    def _stub(state: Any, config: Any = None) -> dict:
        ts = datetime.now(UTC).isoformat()
        wp_id = state.get("current_wp_id", "") if hasattr(state, "get") else ""
        log.info("[DRY-RUN] Stage %r would execute (WP=%s).", stage, wp_id or "\u2014")
        _em = "\u2014"
        print(f"  [dry-run] {stage}: WP={wp_id or _em}")
        log_entry = {
            "timestamp": ts,
            "stage": stage,
            "wp_id": wp_id,
            "action": "dry_run",
            "result": "SKIP",
        }
        run_logger = get_run_logger(config)
        if run_logger:
            run_logger.stream_entry(log_entry)
        return {
            "stage_result": f"[dry-run] {stage} stub",
            "stage_success": True,
            "run_log": [log_entry],
        }

    _stub.__name__ = f"{stage}_dryrun"
    _stub.__qualname__ = f"{stage}_dryrun"
    return _stub


async def build_graph(
    config: Config,
    mcp_tools: list[Any],
    *,
    interrupt_before: list[str] | None = None,
    dry_run: bool = False,
):
    """
    Build and compile the hub-and-spoke LangGraph ``StateGraph``.

    The graph is compiled with an async SQLite checkpointer so runs are
    resumable via ``--resume <thread_id>``.

    Parameters
    ----------
    config:
        Application configuration (provides ``checkpoint_dir``, ``stage_models``).
    mcp_tools:
        LangChain Tool objects returned by
        :class:`~src.mcp_client.MCPToolkit`.get_tools().
    interrupt_before:
        Optional list of LangGraph node names at which the graph should pause
        for human review (passed to ``compile(interrupt_before=...)``).
        Typical values: ``["pm"]``, ``["synthesis"]``, ``["developer"]``.
        ``None`` (default) compiles without any interrupts.
    dry_run:
        When ``True``, replace all pipeline-stage nodes with lightweight stubs
        that log routing decisions without invoking Deep Agents.  The supervisor
        receives ``dry_run=True`` so it tolerates missing ledger state.  The
        SQLite checkpoint backend is still wired identically to a live run.

    Returns
    -------
    tuple[CompiledGraph, aiosqlite.Connection]
        The compiled LangGraph state graph, ready to invoke or stream, and
        the open ``aiosqlite`` connection that backs the checkpointer.  The
        caller is responsible for awaiting ``conn.close()`` after the graph
        run completes so the background worker thread shuts down cleanly.
    """
    # Heavy deps are imported here rather than at module level so that CLI
    # commands that do not call build_graph() (e.g. --help, kill, preflight)
    # do not pay the langgraph / aiosqlite startup cost.
    import aiosqlite
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    from langgraph.graph import END, START, StateGraph

    from src.state import WorkflowState
    from src.supervisor import make_supervisor_node

    # ── Instantiate nodes ──────────────────────────────────────────────────
    supervisor_node = make_supervisor_node(mcp_tools, dry_run=dry_run)

    if dry_run:
        # Replace every pipeline stage with a no-op stub; skip real agent imports.
        stage_nodes = {
            stage: _make_dryrun_node(stage)
            for stage in (*_LOOP_STAGES, _STAGE_SYNTHESIS)
        }
    else:
        from src.nodes.developer import make_developer_node
        from src.nodes.docs import make_docs_node
        from src.nodes.pm import make_pm_node
        from src.nodes.qa import make_qa_node
        from src.nodes.release_engineer import make_release_engineer_node
        from src.nodes.reviewer import make_reviewer_node
        from src.nodes.security_auditor import make_security_auditor_node
        from src.nodes.synthesis import make_synthesis_node

        stage_nodes = {
            _STAGE_PM: make_pm_node(config, mcp_tools),
            _STAGE_DEVELOPER: make_developer_node(config, mcp_tools),
            _STAGE_QA: make_qa_node(config, mcp_tools),
            _STAGE_SECURITY_AUDITOR: make_security_auditor_node(config, mcp_tools),
            _STAGE_REVIEWER: make_reviewer_node(config, mcp_tools),
            _STAGE_RELEASE_ENGINEER: make_release_engineer_node(config, mcp_tools),
            _STAGE_DOCS: make_docs_node(config, mcp_tools),
            _STAGE_SYNTHESIS: make_synthesis_node(config, mcp_tools),
        }

    # ── Build graph ────────────────────────────────────────────────────────
    builder = StateGraph(WorkflowState)
    builder.add_node(_STAGE_SUPERVISOR, supervisor_node)
    for stage, node in stage_nodes.items():
        builder.add_node(stage, node)

    # START → supervisor (always enter via the router).
    builder.add_edge(START, _STAGE_SUPERVISOR)

    # Pipeline stages → supervisor (loop back after each stage completes).
    for stage in _LOOP_STAGES:
        builder.add_edge(stage, _STAGE_SUPERVISOR)

    # Synthesis → END (terminal; no further routing needed).
    builder.add_edge(_STAGE_SYNTHESIS, END)

    # ── Compile with async SQLite checkpointer ───────────────────────────
    config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    db_path = config.checkpoint_dir / "workflow.sqlite"

    conn = await aiosqlite.connect(str(db_path))
    checkpointer = AsyncSqliteSaver(conn)
    await checkpointer.setup()

    mode = "dry-run" if dry_run else "live"
    log.info(
        "Building graph (%s): %d nodes, %d loop edges, checkpoint=%s",
        mode,
        len(stage_nodes) + 1,  # +1 for supervisor
        len(_LOOP_STAGES),
        db_path,
    )

    return builder.compile(
        checkpointer=checkpointer,
        interrupt_before=interrupt_before if interrupt_before else None,
    ), conn
