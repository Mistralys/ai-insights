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

Signals / Shutdown
------------------
On Unix (Linux, macOS), both **SIGTERM** and **SIGINT** trigger a graceful
shutdown: the running graph task is cancelled, a ``signal_shutdown`` JSONL
entry is written with ``result="INTERRUPTED"``, and the process exits with
code ``1``.

On Windows, ``loop.add_signal_handler()`` is unavailable; the handler falls
back to ``signal.signal()`` for SIGTERM (which is effectively a no-op on
Windows but harmless).  SIGINT continues to be handled by the existing
``KeyboardInterrupt`` mechanism at all three call sites.

Signal-interrupted runs are **not** marked terminal, so they can be resumed
from the last checkpoint via ``--resume <thread-id>`` once the underlying
issue is resolved.  See :func:`_register_signal_handlers` for implementation
details.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import shutil
import signal
import sys
import time
import uuid
import warnings
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Suppress Pydantic V1 deprecation warning emitted by langchain_core on Python 3.14+.
warnings.filterwarnings("ignore", message="Core Pydantic V1 functionality", category=UserWarning)

import src.utils.subprocess_encoding  # noqa: E402, F401  # side-effect: safe text-mode defaults on Windows
from src.utils.filelock import lock_exclusive, unlock  # noqa: E402

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
# Signal handling
# ---------------------------------------------------------------------------

def _register_signal_handlers(
    loop: asyncio.AbstractEventLoop,
    shutdown_event: asyncio.Event,
    *,
    thread_id: str = "",
) -> None:
    """Register SIGTERM and SIGINT handlers on *loop* for graceful shutdown.

    On Unix (and macOS) the asyncio event-loop method
    ``loop.add_signal_handler()`` is used so the callback fires inside the
    running loop without disrupting ``await`` points.

    On Windows ``loop.add_signal_handler()`` is not implemented (raises
    ``NotImplementedError``).  We fall back to ``signal.signal()`` for
    SIGTERM (which is a no-op on Windows but harmless) and leave SIGINT to
    the existing ``KeyboardInterrupt`` mechanism.

    The handler sets *shutdown_event*, which callers can ``await`` on, and
    emits a WARNING-level log entry so the shutdown reason is always visible
    in the log stream.

    Parameters
    ----------
    loop:
        The running asyncio event loop.
    shutdown_event:
        An ``asyncio.Event`` that will be set when a signal is received.
    thread_id:
        The current run's thread ID, included in the log entry.
    """

    def _on_signal(sig: signal.Signals) -> None:  # type: ignore[name-defined]
        sig_name = sig.name if hasattr(sig, "name") else str(sig)
        log.warning(
            "Signal %s received — initiating graceful shutdown (thread_id=%s).",
            sig_name,
            thread_id or "<unknown>",
        )
        shutdown_event.set()

    if sys.platform == "win32":
        # add_signal_handler() is unavailable on Windows; use signal.signal()
        # as a best-effort fallback.  SIGTERM is effectively a no-op on
        # Windows but the registration itself must not crash.
        try:
            signal.signal(signal.SIGTERM, lambda signum, _frame: _on_signal(signal.SIGTERM))
        except (OSError, ValueError):
            # If even signal.signal() fails (e.g. not the main thread), swallow
            # silently — signal handling is defence-in-depth, not a hard requirement.
            log.debug("Could not register SIGTERM handler on Windows (non-main thread?).")
    else:
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, _on_signal, sig)
            except (OSError, RuntimeError, NotImplementedError):
                # Catch-all for environments where add_signal_handler() is
                # unavailable or we are not on the main thread.
                log.debug("Could not register %s handler via event loop.", sig)


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
# Graph builder
# ---------------------------------------------------------------------------

async def _build_graph_for_run(
    config: Any,
    mcp_tools: list,
    *,
    dry_run: bool,
    interrupt_before: list[str],
):
    """
    Thin wrapper around :func:`~src.graph.build_graph`.

    Delegates entirely to ``build_graph()``; dry-run stub wiring is handled
    there so that both modes share the same checkpoint boilerplate and graph
    topology.

    Parameters
    ----------
    config:
        Application configuration.
    mcp_tools:
        LangChain Tool objects from :class:`~src.mcp_client.MCPToolkit`.
    dry_run:
        Passed through to :func:`~src.graph.build_graph`; replaces stage nodes
        with no-op stubs when ``True``.
    interrupt_before:
        List of node names at which LangGraph should pause for human input.

    Returns
    -------
    tuple[CompiledGraph, aiosqlite.Connection]
    """
    from src.graph import build_graph
    return await build_graph(
        config, mcp_tools,
        interrupt_before=interrupt_before or None,
        dry_run=dry_run,
    )


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

    fatal_error: str = final_state.get("fatal_error", "")
    if fatal_error:
        print("  Result     : FATAL ERROR")
        print(f"               {fatal_error[:120]}")
        print("=" * 60)
        return EXIT_ERROR

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
# Checkpoint state helpers
# ---------------------------------------------------------------------------

def _thread_id_exists_in_checkpoint(db_path: Path, thread_id: str) -> bool:
    """Return True if *thread_id* already has at least one checkpoint row.

    Opens the SQLite database at *db_path* using the stdlib ``sqlite3`` module
    (no LangGraph dependency).  Returns ``False`` on any I/O error so that
    a corrupt or locked DB never blocks a new run.
    """
    try:
        import sqlite3
        with sqlite3.connect(str(db_path)) as conn:
            row = conn.execute(
                "SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1",
                (thread_id,),
            ).fetchone()
        return row is not None
    except Exception:
        return False


def _mark_run_terminal(checkpoint_dir: Path, thread_id: str) -> None:
    """Write an empty marker file indicating *thread_id* ran to completion.

    The file is named ``<thread_id>.terminal`` inside *checkpoint_dir*.  Its
    presence is the sole signal used by :func:`_is_run_terminal`; contents are
    intentionally empty.
    """
    try:
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        (checkpoint_dir / f"{thread_id}.terminal").touch()
    except OSError:
        pass


def _is_run_terminal(checkpoint_dir: Path, thread_id: str) -> bool:
    """Return True if *thread_id* is flagged as a fully-completed run."""
    return (checkpoint_dir / f"{thread_id}.terminal").exists()


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

    Terminal marker behaviour
    -------------------------
    When a run completes successfully *without* ``--interrupt-on``, a
    ``{thread_id}.terminal`` marker file is written via
    :func:`_mark_run_terminal`.  This prevents accidental re-execution via
    ``--resume``.

    **If ``--interrupt-on`` is active, the marker is intentionally suppressed**
    so that the interrupted run can be stepped and eventually resumed to
    completion.  As a side effect, a step-resumed run that reaches its natural
    end (graph returns normally) is also not marked terminal because
    ``interrupt_before`` is still non-empty at the call site.  This is
    correct: the user may want to resume again from the last checkpoint.
    Future maintainers should preserve this invariant — only unconditional
    (non-interrupt) runs should write the terminal marker.

    **Signal-interrupted runs** (SIGTERM / SIGINT via
    :func:`_register_signal_handlers`) are also intentionally **not** marked
    terminal.  The ``shutdown_event`` fires, the in-flight graph task is
    cancelled, and the run exits with code ``1`` (COMPLETED WITH ERRORS).
    Because no terminal marker is written, the same thread ID can be passed
    to ``--resume`` to restart from the last LangGraph checkpoint.
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

    try:  # ── try/finally guarantees lock cleanup on any exit path ────────────

        # ── Set up JSONL run logger ──────────────────────────────────────
        from src.utils.logging import WorkflowLogger
        run_logger = WorkflowLogger.create(label=plan_dir.name)
        log.info("JSONL log: %s", run_logger._path)
        await run_logger.start_heartbeat(config.heartbeat_interval_s)

        # ── Register signal handlers (graceful shutdown) ─────────────────
        # Create the shutdown event first; it will be populated with the
        # thread_id once the ID is resolved below.
        shutdown_event = asyncio.Event()

        # ── Generate or reuse thread ID ─────────────────────────────────
        if args.resume:
            thread_id: str = args.resume
            log.info("Resuming run: thread_id=%s", thread_id)
            # Guard: refuse to resume a run that already ran to completion.
            if _is_run_terminal(config.checkpoint_dir, thread_id):
                sys.stderr.write(
                    f"orchestrate: error: thread {thread_id!r} is a completed run\n"
                    "  (terminal checkpoint — nothing left to execute).\n"
                    "  To start a fresh run, omit --resume.\n"
                )
                return EXIT_ERROR
        else:
            thread_id = str(uuid.uuid4())
            # Guard against the statistically-improbable UUID v4 collision.
            ckpt_db = config.checkpoint_dir / "workflow.sqlite"
            if ckpt_db.exists():
                for _ in range(5):
                    if not _thread_id_exists_in_checkpoint(ckpt_db, thread_id):
                        break
                    log.warning(
                        "UUID collision detected for thread_id=%s; regenerating.",
                        thread_id,
                    )
                    thread_id = str(uuid.uuid4())
            log.info("Starting new run: thread_id=%s", thread_id)
        # Capture run start timestamp for duration tracking and progress
        # snapshots.
        run_start_ts: str = datetime.now(UTC).isoformat()
        # Write a run_start sentinel immediately so the JSONL file is
        # never empty even if the graph crashes before producing any
        # state output.
        run_logger.log(
            stage="cli",
            action="run_start",
            result="",
            thread_id=thread_id,
            level="INFO",
            dry_run=args.dry_run,
            plan=str(plan_path),
            run_start_ts=run_start_ts,
            stage_models=dict(config.stage_models),
        )
        # ── Register signal handlers now that thread_id is known ────────
        # Handlers set shutdown_event and emit a log entry; the graph
        # execution loop is responsible for honouring the event.
        # Registration is best-effort — failure never aborts the run.
        try:
            loop = asyncio.get_running_loop()
            _register_signal_handlers(loop, shutdown_event, thread_id=thread_id)
        except RuntimeError:
            log.debug("No running event loop; signal handlers not registered.")

        # ── Parse --interrupt-on ────────────────────────────────────────
        interrupt_before: list[str] = []
        if args.interrupt_on:
            interrupt_before = _parse_interrupt_stages(args.interrupt_on)
            log.info("Interrupt-before nodes: %s", interrupt_before)

        # ── Build initial state ─────────────────────────────────────────
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
            "prev_wp_summaries": [],
            "run_start_ts": run_start_ts,
            "run_log": [],
            "errors": [],
        }

        # ── Run via MCPToolkit ──────────────────────────────────────────
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

                graph, db_conn = await _build_graph_for_run(
                    config,
                    mcp_tools,
                    dry_run=args.dry_run,
                    interrupt_before=interrupt_before,
                )

                run_config = {"configurable": {"thread_id": thread_id, "run_logger": run_logger}}

                try:
                    try:
                        # Wrap the graph invocation so that a signal-triggered
                        # shutdown_event can cancel the task cleanly.
                        if args.resume:
                            # For resume: invoke without an initial state so
                            # the graph continues from the last checkpoint.
                            invoke_coro = graph.ainvoke(None, run_config)
                        else:
                            invoke_coro = graph.ainvoke(initial_state, run_config)

                        graph_task = asyncio.ensure_future(invoke_coro)
                        wait_task = asyncio.ensure_future(shutdown_event.wait())

                        done, pending = await asyncio.wait(
                            {graph_task, wait_task},
                            return_when=asyncio.FIRST_COMPLETED,
                        )

                        # Cancel the task that didn't finish.
                        for t in pending:
                            t.cancel()
                            try:
                                await t
                            except (asyncio.CancelledError, Exception):
                                pass

                        if shutdown_event.is_set():
                            # Signal-triggered shutdown — log the final entry.
                            log.warning(
                                "Shutdown signal received. Run interrupted (thread_id=%s). "
                                "Resume with: orchestrate --resume %s",
                                thread_id,
                                thread_id,
                            )
                            run_logger.log(
                                stage="cli",
                                action="signal_shutdown",
                                result="INTERRUPTED",
                                level="WARNING",
                                thread_id=thread_id,
                            )
                            print(
                                f"\n[signal] Graceful shutdown. "
                                f"Resume with: orchestrate --resume {thread_id}"
                            )
                            outside_errors.append("Interrupted by signal.")
                            # Retrieve any partial state from the graph task.
                            if graph_task in done:
                                try:
                                    final_state = graph_task.result()
                                except Exception:
                                    pass
                        else:
                            # Normal completion — retrieve result from graph_task.
                            result = graph_task.result()
                            final_state = result
                            # Mark as terminal when the graph ran to completion with no
                            # interrupt checkpoints configured.  Interrupted runs must
                            # remain re-resumable, so we only write the marker here.
                            if not interrupt_before:
                                _mark_run_terminal(config.checkpoint_dir, thread_id)

                    except KeyboardInterrupt:
                        log.info(
                            "Interrupted by user. Run can be resumed with --resume %s.",
                            thread_id,
                        )
                        print(f"\n[interrupted] Resume with: orchestrate --resume {thread_id}")
                        outside_errors.append("Interrupted by user.")
                    except Exception as exc:
                        log.error("Graph execution failed: %s", exc, exc_info=True)
                        outside_errors.append(f"Graph error: {exc}")
                finally:
                    await db_conn.close()

        except KeyboardInterrupt:
            outside_errors.append("Interrupted during MCP server startup.")
        except Exception as exc:
            log.error("MCP server startup failed: %s", exc, exc_info=True)
            outside_errors.append(f"MCP server error: {exc}")

        # ── Write final entries to JSONL ────────────────────────────────
        # Run-log entries from graph nodes are supposed to be streamed to
        # the JSONL file in real time (via run_logger passed through
        # LangGraph config).  However, if the run_logger was not
        # accessible inside graph nodes (e.g. the configurable key was
        # stripped), the entries only exist in the final LangGraph
        # state's ``run_log`` list.  Flush any un-streamed entries here
        # as a safety net so the log file is always complete.
        try:
            if final_state is not None:
                run_log_entries: list = final_state.get("run_log", [])
                run_logger.flush_unstreamed(run_log_entries)

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
            total_duration_s: float | None = None
            try:
                total_duration_s = round(
                    (datetime.now(UTC) - datetime.fromisoformat(run_start_ts)).total_seconds(), 1
                )
            except (ValueError, TypeError):
                pass
            run_end_kwargs: dict = {
                "stage": "cli",
                "action": "run_end",
                "result": "COMPLETE" if not outside_errors else "ERROR",
                "level": "ERROR" if outside_errors else "INFO",
                "thread_id": thread_id,
            }
            if total_duration_s is not None:
                run_end_kwargs["total_duration_s"] = total_duration_s
            run_logger.log(**run_end_kwargs)
        finally:
            await run_logger.stop_heartbeat()
            run_logger.close()

    # ── Release process lock ────────────────────────────────────────────────
    finally:
        if lock_file:
            try:
                unlock(lock_file.fileno())
                lock_file.close()
                lock_path.unlink(missing_ok=True)
            except OSError:
                pass

    # ── Copy run log to ledger storage ──────────────────────────────────────
    # Copy the JSONL file from orchestrator/logs/ into the project's ledger
    # storage folder so all project artefacts are co-located there.
    # The original file is kept in orchestrator/logs/ to avoid files
    # disappearing from there for seemingly no reason.
    log_final_path = run_logger._path
    slug = plan_dir.name
    ledger_log_dir = (
        config.workspace_root / "mcp-server" / "storage" / "ledger" / slug / "orchestrator" / "logs"
    )
    try:
        ledger_log_dir.mkdir(parents=True, exist_ok=True)
        dest = ledger_log_dir / run_logger._path.name
        shutil.copy2(run_logger._path, dest)
        log_final_path = dest
    except OSError as exc:
        log.warning("Could not copy run log to ledger storage: %s", exc)

    duration = time.monotonic() - start_time
    print(f"\n  Log file   : {log_final_path}")
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

    # Suppress noisy third-party loggers so orchestrator status lines
    # ([pm], [supervisor], Progress:) stay visible in the terminal.
    # When --log-level DEBUG is set, leave them unsuppressed for diagnosis.
    if log_level != "DEBUG":
        for noisy_logger in ("httpx", "httpcore", "mcp", "openai", "anthropic"):
            logging.getLogger(noisy_logger).setLevel(logging.WARNING)

    # ── Run ─────────────────────────────────────────────────────────────────
    try:
        exit_code = asyncio.run(_run(args, config))
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        exit_code = EXIT_ERROR

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
