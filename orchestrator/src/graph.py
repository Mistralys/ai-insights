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


def build_graph(config: Config, mcp_tools: list[Any], *, interrupt_before: list[str] | None = None):
    """
    Build and compile the hub-and-spoke LangGraph ``StateGraph``.

    The graph is compiled with an SQLite checkpointer so runs are resumable
    via ``--resume <thread_id>``.

    Parameters
    ----------
    config:
        Application configuration (provides ``checkpoint_dir``, ``model_name``).
    mcp_tools:
        LangChain Tool objects returned by
        :class:`~src.mcp_client.MCPToolkit`.get_tools().
    interrupt_before:
        Optional list of LangGraph node names at which the graph should pause
        for human review (passed to ``compile(interrupt_before=...)``).
        Typical values: ``["pm"]``, ``["synthesis"]``, ``["developer"]``.
        ``None`` (default) compiles without any interrupts.

    Returns
    -------
    CompiledGraph
        The compiled LangGraph state graph, ready to invoke or stream.
    """
    import sqlite3

    from langgraph.graph import END, START, StateGraph

    from langgraph.checkpoint.sqlite import SqliteSaver

    from src.nodes.developer import make_developer_node
    from src.nodes.docs import make_docs_node
    from src.nodes.pm import make_pm_node
    from src.nodes.qa import make_qa_node
    from src.nodes.release_engineer import make_release_engineer_node
    from src.nodes.reviewer import make_reviewer_node
    from src.nodes.security_auditor import make_security_auditor_node
    from src.nodes.synthesis import make_synthesis_node
    from src.state import WorkflowState
    from src.supervisor import make_supervisor_node

    # ── Instantiate nodes ──────────────────────────────────────────────────
    supervisor_node = make_supervisor_node(mcp_tools)
    pm_node = make_pm_node(config, mcp_tools)
    developer_node = make_developer_node(config, mcp_tools)
    qa_node = make_qa_node(config, mcp_tools)
    security_auditor_node = make_security_auditor_node(config, mcp_tools)
    reviewer_node = make_reviewer_node(config, mcp_tools)
    release_engineer_node = make_release_engineer_node(config, mcp_tools)
    docs_node = make_docs_node(config, mcp_tools)
    synthesis_node = make_synthesis_node(config, mcp_tools)

    # ── Build graph ────────────────────────────────────────────────────────
    builder = StateGraph(WorkflowState)

    builder.add_node(_STAGE_SUPERVISOR, supervisor_node)
    builder.add_node(_STAGE_PM, pm_node)
    builder.add_node(_STAGE_DEVELOPER, developer_node)
    builder.add_node(_STAGE_QA, qa_node)
    builder.add_node(_STAGE_SECURITY_AUDITOR, security_auditor_node)
    builder.add_node(_STAGE_REVIEWER, reviewer_node)
    builder.add_node(_STAGE_RELEASE_ENGINEER, release_engineer_node)
    builder.add_node(_STAGE_DOCS, docs_node)
    builder.add_node(_STAGE_SYNTHESIS, synthesis_node)

    # START → supervisor (always enter via the router).
    builder.add_edge(START, _STAGE_SUPERVISOR)

    # Pipeline stages → supervisor (loop back after each stage completes).
    for stage in _LOOP_STAGES:
        builder.add_edge(stage, _STAGE_SUPERVISOR)

    # Synthesis → END (terminal; no further routing needed).
    builder.add_edge(_STAGE_SYNTHESIS, END)

    # ── Compile with SQLite checkpointer ─────────────────────────────────
    config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    db_path = config.checkpoint_dir / "workflow.sqlite"

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    checkpointer = SqliteSaver(conn)

    log.info(
        "Building graph: 9 nodes, %d loop edges, checkpoint=%s",
        len(_LOOP_STAGES),
        db_path,
    )

    return builder.compile(
        checkpointer=checkpointer,
        interrupt_before=interrupt_before if interrupt_before else None,
    )
