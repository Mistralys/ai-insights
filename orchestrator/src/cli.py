"""
cli.py — CLI entry point for the AI Insights Orchestrator.

Parses command-line arguments, loads configuration, manages the MCP server
subprocess lifecycle, invokes the LangGraph workflow, and prints a run summary.

Usage
-----
::

    orchestrate <plan-document-path> [options]

    # Or directly:
    python -m src.cli <plan-document-path> [options]

Options
-------
See :func:`_build_parser` for the full list of CLI options.

Exit Codes
----------
- ``0`` — Workflow completed successfully with no errors.
- ``1`` — One or more errors occurred during the run.
- ``2`` — Safety limit reached (iteration counter exceeded ``max_iterations``).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
import uuid
from datetime import UTC
from pathlib import Path
from typing import Any

from src.utils.filelock import lock_exclusive, unlock

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exit code constants
# ---------------------------------------------------------------------------

EXIT_SUCCESS = 0
EXIT_ERROR = 1
EXIT_SAFETY_LIMIT = 2

# ---------------------------------------------------------------------------
# Interrupt-on stage mapping
# Stage names that can be specified in --interrupt-on map to graph node names.
# "fail" is a meta-stage meaning: interrupt before developer when handling rework.
# ---------------------------------------------------------------------------

_INTERRUPT_STAGE_MAP: dict[str, str] = {
    "pm": "pm",
    "synthesis": "synthesis",
    "fail": "developer",  # Developer node handles all rework loops.
}


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Return the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="orchestrate",
        description=(
            "AI Insights Orchestrator — Run a LangGraph agent workflow driven "
            "by a plan document and the project ledger."
        ),
    )

    parser.add_argument(
        "plan",
        metavar="plan-document-path",
        help="Path to the plan .md file (e.g. docs/agents/plans/2026-01-01-feature/plan.md).",
    )

    parser.add_argument(
        "--project-path",
        metavar="PATH",
        default=None,
        help=(
            "Override the target project/codebase path. "
            "Defaults to the workspace root inferred from the plan directory."
        ),
    )

    parser.add_argument(
        "--max-iterations",
        metavar="N",
        type=int,
        default=None,
        help="Maximum supervisor iterations before aborting. Overrides config / .env value.",
    )

    parser.add_argument(
        "--model",
        metavar="MODEL",
        default=None,
        help="LLM model identifier. Overrides MODEL_NAME from .env.",
    )

    parser.add_argument(
        "--resume",
        metavar="THREAD_ID",
        default=None,
        help="Resume a previously checkpointed run using this thread ID.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help=(
            "Print routing decisions without executing agents. "
            "Stage nodes are replaced with no-op stubs."
        ),
    )

    parser.add_argument(
        "--log-level",
        metavar="LEVEL",
        default=None,
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging verbosity. Overrides LOG_LEVEL from .env. Default: INFO.",
    )

    parser.add_argument(
        "--interrupt-on",
        metavar="STAGES",
        default=None,
        help=(
            "Comma-separated list of checkpoints to pause at for human review. "
            "Valid values: pm, fail, synthesis. "
            "Example: --interrupt-on pm,synthesis"
        ),
    )

    return parser


def _parse_interrupt_stages(raw: str) -> list[str]:
    """
    Convert a ``--interrupt-on`` string to a list of LangGraph node names.

    Parameters
    ----------
    raw:
        Comma-separated stage names (e.g. ``"pm,fail,synthesis"``).

    Returns
    -------
    list[str]
        LangGraph node names to pass to ``compile(interrupt_before=...)``.

    Raises
    ------
    SystemExit
        If any stage name is not recognised.
    """
    stages = [s.strip() for s in raw.split(",") if s.strip()]
    unknown = [s for s in stages if s not in _INTERRUPT_STAGE_MAP]
    if unknown:
        sys.stderr.write(
            f"orchestrate: error: unknown --interrupt-on stages: "
            f"{', '.join(unknown)}. "
            f"Valid values: {', '.join(sorted(_INTERRUPT_STAGE_MAP))}.\n"
        )
        sys.exit(EXIT_ERROR)
    # De-duplicate: multiple meta-stages may map to the same node.
    seen: set[str] = set()
    result: list[str] = []
    for s in stages:
        node = _INTERRUPT_STAGE_MAP[s]
        if node not in seen:
            seen.add(node)
            result.append(node)
    return result


# ---------------------------------------------------------------------------
# Dry-run stub factory
# ---------------------------------------------------------------------------

def _make_dryrun_node(stage: str):
    """
    Return a no-op LangGraph node for ``--dry-run`` mode.

    The stub logs the stage name and returns a state update indicating
    success without invoking the Deep Agent.
    """
    from datetime import datetime

    from src.utils.logging import get_run_logger

    def _stub(state: Any, config: Any = None) -> dict:
        ts = datetime.now(UTC).isoformat()
        wp_id = state.get("current_wp_id", "") if hasattr(state, "get") else ""
        log.info("[DRY-RUN] Stage %r would execute (WP=%s).", stage, wp_id or "—")
        print(f"  [dry-run] {stage}: WP={wp_id or '—'}")
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


# ---------------------------------------------------------------------------
# Graph builder — wires dry-run stubs when requested
# ---------------------------------------------------------------------------

async def _build_graph_for_run(
    config: Any,
    mcp_tools: list,
    *,
    dry_run: bool,
    interrupt_before: list[str],
):
    """
    Build the LangGraph compiled graph, optionally with dry-run stubs.

    When *dry_run* is ``True``, all six pipeline-stage nodes are replaced with
    lightweight stubs that log routing decisions without invoking Deep Agents.
    The supervisor node is always real (it performs only ledger reads, not agent calls).

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        LangChain Tool objects from :class:`~src.mcp_client.MCPToolkit`.
    dry_run:
        Replace stage nodes with no-op stubs.
    interrupt_before:
        List of node names at which LangGraph should pause for human input.

    Returns
    -------
    CompiledGraph
    """
    if dry_run:
        # Build with dry-run stubs instead of real Deep Agent nodes.
        import aiosqlite
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from langgraph.graph import END, START, StateGraph

        from src.state import WorkflowState
        from src.supervisor import make_supervisor_node

        supervisor_node = make_supervisor_node(mcp_tools)
        builder = StateGraph(WorkflowState)
        builder.add_node("supervisor", supervisor_node)
        for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
            builder.add_node(stage, _make_dryrun_node(stage))
        builder.add_edge(START, "supervisor")
        for stage in ("pm", "developer", "qa", "reviewer", "docs"):
            builder.add_edge(stage, "supervisor")
        builder.add_edge("synthesis", END)

        config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        db_path = config.checkpoint_dir / "workflow.sqlite"
        conn = await aiosqlite.connect(str(db_path))
        checkpointer = AsyncSqliteSaver(conn)
        await checkpointer.setup()

        return builder.compile(
            checkpointer=checkpointer,
            interrupt_before=interrupt_before if interrupt_before else None,
        )
    else:
        from src.graph import build_graph
        return await build_graph(config, mcp_tools, interrupt_before=interrupt_before or None)


# ---------------------------------------------------------------------------
# Run summary printer
# ---------------------------------------------------------------------------

def _print_run_summary(
    final_state: dict | None,
    duration_s: float,
    *,
    thread_id: str,
    errors_raised: list[str] | None = None,
) -> int:
    """
    Print a human-readable run summary and return the appropriate exit code.

    Parameters
    ----------
    final_state:
        The final LangGraph state dict (may be ``None`` if graph crashed).
    duration_s:
        Total elapsed wall-clock time in seconds.
    thread_id:
        The LangGraph thread ID for this run (useful for ``--resume``).
    errors_raised:
        List of error messages from outside the graph (startup/shutdown errors).

    Returns
    -------
    int
        Exit code: ``EXIT_SUCCESS``, ``EXIT_ERROR``, or ``EXIT_SAFETY_LIMIT``.
    """
    print("\n" + "=" * 60)
    print("  ORCHESTRATOR RUN SUMMARY")
    print("=" * 60)
    print(f"  Thread ID  : {thread_id}")
    print(f"  Duration   : {duration_s:.1f}s")

    if final_state is None:
        print("  Status     : CRASHED (no final state)")
        for err in (errors_raised or []):
            print(f"  Error      : {err}")
        print("=" * 60)
        return EXIT_ERROR

    run_log: list = final_state.get("run_log", [])
    errors: list = final_state.get("errors", [])
    wp_summaries: list = final_state.get("wp_summaries", [])

    stages_executed = {
        entry.get("stage", "") for entry in run_log if entry.get("action") != "dry_run"
    }
    stages_executed.discard("")

    wps_complete = sum(1 for wp in wp_summaries if wp.get("status") == "COMPLETE")
    total_wps = len(wp_summaries)
    error_count = len(errors) + len(errors_raised or [])

    print(f"  Stages run : {', '.join(sorted(stages_executed)) or '—'}")
    print(f"  WPs done   : {wps_complete}/{total_wps}")
    wps_this_run: int = final_state.get("wps_completed_this_run", 0)
    print(f"  This run   : {wps_this_run} WP(s) completed this run")
    print(f"  Errors     : {error_count}")

    iteration: int = final_state.get("iteration", 0)
    max_iterations: int = final_state.get("max_iterations", 0)

    if error_count == 0 and (max_iterations == 0 or iteration < max_iterations):
        print("  Result     : SUCCESS")
        print("=" * 60)
        return EXIT_SUCCESS

    if max_iterations and iteration >= max_iterations:
        print("  Result     : SAFETY LIMIT REACHED")
        print(f"               iteration={iteration} >= max_iterations={max_iterations}")
        print(f"  Resume with: orchestrate --resume {thread_id}")
        print("=" * 60)
        return EXIT_SAFETY_LIMIT

    print("  Result     : COMPLETED WITH ERRORS")
    for err in (errors or [])[:5]:  # Show first 5 errors only.
        print(f"  ✗ {err.get('message', str(err))[:120]}")
    if len(errors) > 5:
        print(f"    … and {len(errors) - 5} more errors in run_log.")
    print(f"  Resume with: orchestrate --resume {thread_id}")
    print("=" * 60)
    return EXIT_ERROR


# ---------------------------------------------------------------------------
# Main async entry point
# ---------------------------------------------------------------------------

async def _run(args: argparse.Namespace, config: Any) -> int:
    """
    Execute the orchestrator workflow and return an exit code.

    Manages the complete lifecycle:
    1. Validate inputs.
    2. Start MCP server.
    3. Build and invoke graph.
    4. Print summary.
    5. Shut down MCP server.
    """
    from src.mcp_client import MCPToolkit

    # ── Resolve paths ───────────────────────────────────────────────────────
    plan_path = Path(args.plan).resolve()
    if not plan_path.exists():
        sys.stderr.write(f"orchestrate: error: plan file not found: {plan_path}\n")
        return EXIT_ERROR

    plan_dir = plan_path.parent if plan_path.is_file() else plan_path
    plan_file = plan_path.name if plan_path.is_file() else "plan.md"

    project_path = Path(args.project_path).resolve() if args.project_path else config.workspace_root

    # ── Acquire process lock (prevent concurrent runs on same plan) ──────
    lock_path = plan_dir / ".orchestrator.lock"
    lock_file = None
    try:
        lock_file = open(lock_path, "w")  # noqa: SIM115
        lock_exclusive(lock_file.fileno())
    except OSError:
        sys.stderr.write(
            f"orchestrate: error: another orchestrator process is already running "
            f"against {plan_dir}.\n"
            f"  Lock file: {lock_path}\n"
            f"  If no other process is running, delete the lock file and retry.\n"
        )
        if lock_file:
            lock_file.close()
        return EXIT_ERROR

    # ── Set up JSONL run logger ──────────────────────────────────────────────
    from src.utils.logging import WorkflowLogger
    run_logger = WorkflowLogger.create(label=plan_dir.name)
    log.info("JSONL log: %s", run_logger._path)

    # ── Generate or reuse thread ID ─────────────────────────────────────────
    thread_id: str = args.resume if args.resume else str(uuid.uuid4())
    if args.resume:
        log.info("Resuming run: thread_id=%s", thread_id)
    else:
        log.info("Starting new run: thread_id=%s", thread_id)
    # Write a run_start sentinel immediately so the JSONL file is never empty
    # even if the graph crashes before producing any state output.
    run_logger.log(
        stage="cli",
        action="run_start",
        result="",
        thread_id=thread_id,
        level="INFO",
        dry_run=args.dry_run,
        plan=str(plan_path),
    )
    # ── Parse --interrupt-on ────────────────────────────────────────────────
    interrupt_before: list[str] = []
    if args.interrupt_on:
        interrupt_before = _parse_interrupt_stages(args.interrupt_on)
        log.info("Interrupt-before nodes: %s", interrupt_before)

    # ── Build initial state ─────────────────────────────────────────────────
    initial_state: dict = {
        "project_path": str(plan_dir),
        "plan_file": plan_file,
        "target_project_path": str(project_path),
        "current_stage": "",
        "current_wp_id": "",
        "iteration": 0,
        "max_iterations": args.max_iterations or config.max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "wps_completed_this_run": 0,
        "run_log": [],
        "errors": [],
    }

    # ── Run via MCPToolkit ──────────────────────────────────────────────────
    start_time = time.monotonic()
    final_state: dict | None = None
    outside_errors: list[str] = []

    if args.dry_run:
        print("[dry-run] Starting orchestrator in dry-run mode.")
        print(f"[dry-run] Plan   : {plan_path}")
        print(f"[dry-run] Project: {project_path}")
        print(f"[dry-run] Thread : {thread_id}")
        print()

    try:
        async with MCPToolkit.from_config(config) as toolkit:
            mcp_tools = toolkit.get_tools()
            log.info("MCP server started with %d tools.", len(mcp_tools))

            graph = await _build_graph_for_run(
                config,
                mcp_tools,
                dry_run=args.dry_run,
                interrupt_before=interrupt_before,
            )

            run_config = {"configurable": {"thread_id": thread_id, "run_logger": run_logger}}

            try:
                if args.resume:
                    # For resume: invoke without an initial state so the
                    # graph continues from the last checkpoint.
                    result = await graph.ainvoke(None, run_config)
                else:
                    result = await graph.ainvoke(initial_state, run_config)
                final_state = result
            except KeyboardInterrupt:
                log.info("Interrupted by user. Run can be resumed with --resume %s.", thread_id)
                print(f"\n[interrupted] Resume with: orchestrate --resume {thread_id}")
                outside_errors.append("Interrupted by user.")
            except Exception as exc:
                log.error("Graph execution failed: %s", exc, exc_info=True)
                outside_errors.append(f"Graph error: {exc}")

    except KeyboardInterrupt:
        outside_errors.append("Interrupted during MCP server startup.")
    except Exception as exc:
        log.error("MCP server startup failed: %s", exc, exc_info=True)
        outside_errors.append(f"MCP server error: {exc}")

    # ── Write final entries to JSONL ────────────────────────────────────────
    # Run-log entries from graph nodes are already streamed to the JSONL file
    # in real time (via run_logger passed through LangGraph config).  Only
    # outside errors and the run_end sentinel still need to be written here.
    try:
        for err_msg in outside_errors:
            run_logger.log(
                stage="cli",
                action="run_error",
                result="ERROR",
                error=err_msg,
                level="ERROR",
                thread_id=thread_id,
            )
        # Always write a run-end sentinel entry.
        run_logger.log(
            stage="cli",
            action="run_end",
            result="COMPLETE" if not outside_errors else "ERROR",
            level="ERROR" if outside_errors else "INFO",
            thread_id=thread_id,
        )
    finally:
        run_logger.close()

    # ── Release process lock ────────────────────────────────────────────────
    if lock_file:
        try:
            unlock(lock_file.fileno())
            lock_file.close()
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass

    duration = time.monotonic() - start_time
    print(f"\n  Log file   : {run_logger._path}")
    return _print_run_summary(
        final_state,
        duration,
        thread_id=thread_id,
        errors_raised=outside_errors or None,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    """
    CLI entry point — ``orchestrate`` script target.

    Parses arguments, applies .env overrides, configures logging, and runs
    the async workflow via :func:`asyncio.run`.

    Parameters
    ----------
    argv:
        Argument list. Defaults to ``sys.argv[1:]``.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    # ── Apply CLI overrides before loading config ───────────────────────────
    if args.model:
        os.environ["MODEL_NAME"] = args.model
    if args.max_iterations is not None:
        os.environ["MAX_ITERATIONS"] = str(args.max_iterations)

    # ── Load config ─────────────────────────────────────────────────────────
    try:
        from src.config import load_config
        config = load_config()
    except (OSError, ValueError) as exc:
        sys.stderr.write(f"orchestrate: configuration error: {exc}\n")
        sys.exit(EXIT_ERROR)

    # ── Configure logging ────────────────────────────────────────────────────
    log_level = args.log_level or config.log_level
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    # ── Run ─────────────────────────────────────────────────────────────────
    try:
        exit_code = asyncio.run(_run(args, config))
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        exit_code = EXIT_ERROR

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
