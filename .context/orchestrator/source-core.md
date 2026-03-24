# Orchestrator - Core Source
_SOURCE: Core modules: CLI, config, graph, state, supervisor, MCP client_
# Core modules: CLI, config, graph, state, supervisor, MCP client
```
// Structure of documents
└── orchestrator/
    └── src/
        └── __init__.py
        └── cli.py
        └── config.py
        └── graph.py
        └── mcp_client.py
        └── state.py
        └── supervisor.py

```
###  Path: `/orchestrator/src/__init__.py`

```py
"""
AI Insights Orchestrator — source package.

Provides the LangGraph-based orchestration system for the ledger agent workflow.
"""

```
###  Path: `/orchestrator/src/cli.py`

```py
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
import shutil
import sys
import time
import uuid
from datetime import UTC, datetime
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
    The supervisor node is always real (it performs only ledger reads, not agent
    calls) but receives ``dry_run=True`` so it tolerates missing ledger state
    and terminates cleanly instead of looping on MCP errors.

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

        supervisor_node = make_supervisor_node(mcp_tools, dry_run=True)
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
    await run_logger.start_heartbeat(config.heartbeat_interval_s)

    # ── Generate or reuse thread ID ─────────────────────────────────────────
    thread_id: str = args.resume if args.resume else str(uuid.uuid4())
    if args.resume:
        log.info("Resuming run: thread_id=%s", thread_id)
    else:
        log.info("Starting new run: thread_id=%s", thread_id)
    # Capture run start timestamp for duration tracking and progress snapshots.
    run_start_ts: str = datetime.now(UTC).isoformat()
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
        run_start_ts=run_start_ts,
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
        "prev_wp_summaries": [],
        "run_start_ts": run_start_ts,
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
    # Run-log entries from graph nodes are supposed to be streamed to the
    # JSONL file in real time (via run_logger passed through LangGraph
    # config).  However, if the run_logger was not accessible inside graph
    # nodes (e.g. the configurable key was stripped), the entries only exist
    # in the final LangGraph state's ``run_log`` list.  Flush any un-streamed
    # entries here as a safety net so the log file is always complete.
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
    ledger_log_dir = config.workspace_root / "mcp-server" / "storage" / "ledger" / slug / "orchestrator" / "logs"
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

```
###  Path: `/orchestrator/src/config.py`

```py
"""
config.py — Configuration module for the AI Insights Orchestrator.

Loads environment variables, derives pipeline routing constants from
``shared/workflow-manifest.json`` (the single source of truth for all
role and pipeline definitions across the workspace), and exposes a
validated ``Config`` dataclass with auto-detected LLM provider."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment loading
# ---------------------------------------------------------------------------

# Load .env from the orchestrator directory (the directory this file lives in)
# and fall back to the workspace root if not found.
_HERE = Path(__file__).resolve().parent
_ORCHESTRATOR_ROOT = _HERE.parent
load_dotenv(_ORCHESTRATOR_ROOT / ".env", override=False)


# ---------------------------------------------------------------------------
# Manifest loading
# ---------------------------------------------------------------------------

def _load_workflow_manifest() -> dict:
    """
    Load ``shared/workflow-manifest.json`` from the workspace root.

    Raises
    ------
    ImportError
        If the manifest file is missing or not valid JSON.
    """
    manifest_path = _ORCHESTRATOR_ROOT.parent / "shared" / "workflow-manifest.json"
    if not manifest_path.exists():
        raise ImportError(
            f"Shared workflow manifest not found: {manifest_path}\n"
            "The file 'shared/workflow-manifest.json' is required at the workspace "
            "root. Ensure the repository is fully checked out."
        )
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ImportError(
            f"Failed to parse workflow manifest at {manifest_path}: {exc}"
        ) from exc


_MANIFEST: dict = _load_workflow_manifest()
_roles: list = _MANIFEST["roles"]
_pipelines: dict = _MANIFEST["pipelines"]


# ---------------------------------------------------------------------------
# Pipeline routing constants (derived from manifest)
# ---------------------------------------------------------------------------

#: Enforced pipeline execution order.
#: A pipeline type may only start when its prerequisite has a PASS pipeline.
#: ``None`` means no prerequisite (can always start).
PIPELINE_PREREQUISITES: dict[str, str | None] = dict(_pipelines["prerequisites"])

#: Map of pipeline type → owning agent role name.
PIPELINE_AGENT_MAP: dict[str, str] = {
    r["pipeline"]: r["name"]
    for r in _roles
    if r.get("pipeline")
}


def _resolve_fail_routing_role(role_id: str) -> str:
    """Return the role name for a role ID found in ``fail_routing``."""
    try:
        return next(r["name"] for r in _roles if r["id"] == role_id)
    except StopIteration:
        raise ImportError(
            f"Workflow manifest integrity error: fail_routing references unknown "
            f"role ID {role_id!r}. Check shared/workflow-manifest.json."
        ) from None


#: Pipeline type → agent name responsible for FAIL rework.
#: Derived from ``pipelines.fail_routing`` in ``shared/workflow-manifest.json``.
FAIL_ROUTING_AGENT_MAP: dict[str, str] = {
    ptype: _resolve_fail_routing_role(role_id)
    for ptype, role_id in _pipelines["fail_routing"].items()
}

# Roles in manifest order excluding the planner (first, orchestrating).
# IMPORTANT: Synthesis is intentionally kept despite being orchestrating,
# because NEXT_STAGE_MAP needs the terminal "docs → synthesis" link.
# Filtering by `r.get("orchestrating")` would drop Synthesis and break
# the handoff chain — do NOT "fix" this to use the orchestrating flag.
_chain_roles: list = [r for r in _roles if r["id"] != "planner"]

#: Map of graph stage name → next stage name.
#: Provides sequential stage ordering for the supervisor routing logic.
NEXT_STAGE_MAP: dict[str, str] = {
    _chain_roles[i]["id"]: _chain_roles[i + 1]["id"]
    for i in range(len(_chain_roles) - 1)
}

#: Map of graph stage name → pipeline type it owns.
STAGE_TO_PIPELINE: dict[str, str] = {
    r["id"]: r["pipeline"]
    for r in _roles
    if r.get("pipeline")
}

#: Inverse of STAGE_TO_PIPELINE: pipeline type → graph stage name.
PIPELINE_TO_STAGE: dict[str, str] = {v: k for k, v in STAGE_TO_PIPELINE.items()}

#: Map of graph stage name → relative path to persona Markdown file.
#: Paths are relative to the workspace root (two levels above orchestrator/).
PERSONA_FILES: dict[str, str] = {r["id"]: r["persona_file"] for r in _roles}

#: All valid graph stage names — the set of all non-orchestrating role IDs.
VALID_STAGES: frozenset[str] = frozenset(
    r["id"] for r in _roles if not r.get("orchestrating")
)

#: Valid pipeline type names in canonical execution order.
PIPELINE_TYPES: tuple[str, ...] = tuple(_pipelines["canonical_order"])

#: Map of role name → role ID for every role in the manifest.
#: Used by supervisor.py to derive stage destinations without hardcoding strings.
ROLE_IDS: dict[str, str] = {r["name"]: r["id"] for r in _roles}

#: Non-orchestrating role names in manifest order.
#: The supervisor iterates this list to find the first role with actionable work.
PIPELINE_ROLE_NAMES: list[str] = [
    r["name"] for r in _roles if not r.get("orchestrating")
]

#: Terminal work-package statuses — no further agent action is required.
#: Derived from the manifest's terminal_work_package status vocabulary.
WP_TERMINAL_STATUSES: frozenset[str] = frozenset(
    _MANIFEST["statuses"]["terminal_work_package"]
)


# ---------------------------------------------------------------------------
# LLM provider detection helpers
# ---------------------------------------------------------------------------

_ANTHROPIC_PREFIXES = ("claude",)
_GOOGLE_PREFIXES = ("gemini", "models/gemini")

#: Environment variable values that disable ``capture_dialogues`` (matched after
#: ``.strip().lower()``). Kept as a module-level constant so it is visible
#: alongside the other private config constants and easy to extend.
_CAPTURE_DIALOGUES_FALSY: frozenset[str] = frozenset({"false", "0", "no"})


def _model_is_anthropic(model_name: str) -> bool:
    """Return True if *model_name* looks like an Anthropic model."""
    lower = model_name.lower()
    return any(lower.startswith(p) for p in _ANTHROPIC_PREFIXES)


def _model_is_google(model_name: str) -> bool:
    """Return True if *model_name* looks like a Google model."""
    lower = model_name.lower()
    return any(lower.startswith(p) for p in _GOOGLE_PREFIXES)


def _resolve_provider(model_name: str) -> str:
    """
    Determine the LLM provider from *model_name* and available API keys.

    Resolution rules (in priority order):
    1. If only one API key is set, use its provider (regardless of model name).
    2. If both keys are set, use the provider that matches the model name prefix:
       - ``claude-*`` → ``anthropic``
       - ``gemini-*`` → ``google``
    3. If both keys are set and the model name is ambiguous, raise ``ValueError``.
    4. If no keys are set, raise ``EnvironmentError``.

    Returns
    -------
    str
        One of ``"anthropic"`` or ``"google"``.
    """
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_google = bool(os.environ.get("GOOGLE_API_KEY"))

    if not has_anthropic and not has_google:
        raise OSError(
            "No LLM provider API key found. "
            "Set ANTHROPIC_API_KEY (Anthropic) or GOOGLE_API_KEY (Google AI Studio) "
            "in your .env file or environment. "
            "Install the matching provider extra: pip install -e '.[anthropic]' or "
            "pip install -e '.[google]'."
        )

    if has_anthropic and not has_google:
        return "anthropic"

    if has_google and not has_anthropic:
        return "google"

    # Both keys present — use model name prefix as the tiebreaker.
    if _model_is_anthropic(model_name):
        return "anthropic"
    if _model_is_google(model_name):
        return "google"

    raise ValueError(
        f"Both ANTHROPIC_API_KEY and GOOGLE_API_KEY are set, but MODEL_NAME "
        f"'{model_name}' does not start with a recognised prefix "
        f"({', '.join(_ANTHROPIC_PREFIXES + _GOOGLE_PREFIXES)}). "
        "Set MODEL_NAME to a model from one provider (e.g. 'claude-sonnet-4-6-20250929' "
        "or 'gemini-2.5-pro') to select the provider unambiguously."
    )


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------

@dataclass
class Config:
    """
    Validated runtime configuration for the orchestrator.

    Instantiate via :func:`load_config` (the public factory) rather than
    calling the constructor directly — ``load_config`` reads environment
    variables and applies all validation rules.

    Attributes
    ----------
    model_name:
        LLM model identifier (e.g. ``"claude-sonnet-4-6-20250929"``).
    provider:
        Auto-detected LLM provider: ``"anthropic"`` or ``"google"``.
    max_iterations:
        Safety ceiling on the total number of supervisor iterations.
    checkpoint_dir:
        Directory for LangGraph SQLite checkpoint files.
    mcp_server_cmd:
        Shell command list to launch the MCP server subprocess.
    workspace_root:
        Absolute path to the ai-insights workspace root (parent of
        ``orchestrator/``).
    log_level:
        Python logging level string (``"DEBUG"``, ``"INFO"``, etc.).
    heartbeat_interval_s:
        Seconds of console silence before emitting a heartbeat. ``0`` disables.
    capture_dialogues:
        When ``True``, the orchestrator writes agent dialogue artefacts to disk.
        Controlled by the ``CAPTURE_DIALOGUES`` environment variable (falsy
        values: ``"false"``, ``"0"``, ``"no"``; case-insensitive). Defaults to
        ``True``.
    """

    model_name: str
    provider: str
    max_iterations: int
    checkpoint_dir: Path
    mcp_server_cmd: list[str]
    workspace_root: Path
    log_level: str
    heartbeat_interval_s: int = 120
    capture_dialogues: bool = True

    def get_chat_model(self):
        """
        Return a provider-agnostic LangChain chat model instance.

        Uses ``langchain.chat_models.init_chat_model`` when available
        (LangChain >= 0.2), falling back to direct provider imports.

        Raises
        ------
        ImportError
            If the required provider package is not installed.
        """
        try:
            from langchain.chat_models import init_chat_model  # type: ignore[import]
            return init_chat_model(self.model_name)
        except ImportError:
            pass

        if self.provider == "anthropic":
            try:
                from langchain_anthropic import ChatAnthropic  # type: ignore[import]
                return ChatAnthropic(model=self.model_name)  # type: ignore[call-arg]
            except ImportError as exc:
                raise ImportError(
                    "langchain-anthropic is not installed. "
                    "Run: pip install -e '.[anthropic]'"
                ) from exc

        if self.provider == "google":
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore[import]
                return ChatGoogleGenerativeAI(model=self.model_name)  # type: ignore[call-arg]
            except ImportError as exc:
                raise ImportError(
                    "langchain-google-genai is not installed. "
                    "Run: pip install -e '.[google]'"
                ) from exc

        raise ValueError(f"Unknown provider: {self.provider!r}")  # pragma: no cover


def load_config(
    *,
    workspace_root: Path | None = None,
) -> Config:
    """
    Read environment variables and construct a validated :class:`Config`.

    Parameters
    ----------
    workspace_root:
        Override the auto-detected workspace root. Useful in tests.

    Raises
    ------
    EnvironmentError
        If required environment variables are missing or invalid.
    ValueError
        If configuration values are logically inconsistent.
    """
    # Determine the workspace root: two levels above this file
    # (orchestrator/src/config.py → orchestrator/ → workspace root).
    if workspace_root is None:
        workspace_root = _ORCHESTRATOR_ROOT.parent

    # --- model_name ---
    model_name = os.environ.get("MODEL_NAME", "").strip()
    if not model_name:
        raise OSError(
            "MODEL_NAME is not set. "
            "Add MODEL_NAME=<model-id> to your .env file. "
            "Examples: claude-sonnet-4-6-20250929, gemini-2.5-pro."
        )

    # --- provider (auto-detected) ---
    provider = _resolve_provider(model_name)

    # --- max_iterations ---
    raw_max_iter = os.environ.get("MAX_ITERATIONS", "100").strip()
    try:
        max_iterations = int(raw_max_iter)
        if max_iterations < 1:
            raise ValueError("must be a positive integer")
    except ValueError as exc:
        raise OSError(
            f"MAX_ITERATIONS must be a positive integer; got {raw_max_iter!r}."
        ) from exc

    # --- checkpoint_dir ---
    raw_checkpoint_dir = os.environ.get("CHECKPOINT_DIR", "./checkpoints").strip()
    checkpoint_dir = Path(raw_checkpoint_dir)
    if not checkpoint_dir.is_absolute():
        # Relative paths are resolved from the orchestrator root (where .env lives).
        checkpoint_dir = (_ORCHESTRATOR_ROOT / checkpoint_dir).resolve()

    # --- mcp_server_cmd ---
    # Default: launch the compiled MCP server from the workspace root.
    mcp_server_script = workspace_root / "mcp-server" / "dist" / "index.js"
    mcp_server_cmd: list[str] = ["node", str(mcp_server_script)]

    # --- log_level ---
    log_level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if log_level not in valid_levels:
        raise OSError(
            f"LOG_LEVEL must be one of {sorted(valid_levels)}; got {log_level!r}."
        )

    # --- capture_dialogues ---
    raw_capture = os.environ.get("CAPTURE_DIALOGUES", "").strip().lower()
    capture_dialogues = raw_capture not in _CAPTURE_DIALOGUES_FALSY if raw_capture else True

    # --- heartbeat_interval_s ---
    raw_heartbeat = os.environ.get("HEARTBEAT_INTERVAL_S", "120").strip()
    try:
        heartbeat_interval_s = int(raw_heartbeat)
        if heartbeat_interval_s < 0:
            raise ValueError("must be a non-negative integer")
    except ValueError as exc:
        raise OSError(
            f"HEARTBEAT_INTERVAL_S must be a non-negative integer; got {raw_heartbeat!r}."
        ) from exc

    return Config(
        model_name=model_name,
        provider=provider,
        max_iterations=max_iterations,
        checkpoint_dir=checkpoint_dir,
        mcp_server_cmd=mcp_server_cmd,
        workspace_root=workspace_root,
        log_level=log_level,
        capture_dialogues=capture_dialogues,
        heartbeat_interval_s=heartbeat_interval_s,
    )


# ---------------------------------------------------------------------------
# Module-level default config instance (only constructed when accessed).
# Call load_config() explicitly in application code.
# ---------------------------------------------------------------------------

def get_default_config() -> Config:
    """
    Return (and lazily initialise) the module-level default :class:`Config`.

    This is provided as a convenience for modules that need a single shared
    config instance without threading it explicitly. Prefer passing a
    ``Config`` object explicitly in testable code.
    """
    global _default_config  # noqa: PLW0603
    if _default_config is None:
        _default_config = load_config()
    return _default_config


_default_config: Config | None = None

```
###  Path: `/orchestrator/src/graph.py`

```py
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


async def build_graph(
    config: Config,
    mcp_tools: list[Any],
    *,
    interrupt_before: list[str] | None = None,
):
    """
    Build and compile the hub-and-spoke LangGraph ``StateGraph``.

    The graph is compiled with an async SQLite checkpointer so runs are
    resumable via ``--resume <thread_id>``.

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
    import aiosqlite
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    from langgraph.graph import END, START, StateGraph

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

    # ── Compile with async SQLite checkpointer ───────────────────────────
    config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    db_path = config.checkpoint_dir / "workflow.sqlite"

    conn = await aiosqlite.connect(str(db_path))
    checkpointer = AsyncSqliteSaver(conn)
    await checkpointer.setup()

    log.info(
        "Building graph: 9 nodes, %d loop edges, checkpoint=%s",
        len(_LOOP_STAGES),
        db_path,
    )

    return builder.compile(
        checkpointer=checkpointer,
        interrupt_before=interrupt_before if interrupt_before else None,
    )

```
###  Path: `/orchestrator/src/mcp_client.py`

```py
"""
mcp_client.py — MCP toolkit setup via langchain-mcp-adapters.

Provides :class:`MCPToolkit`, an async context manager that:

- Starts the compiled MCP server subprocess over STDIO transport.
- Exposes :meth:`MCPToolkit.get_tools` returning LangChain Tool objects for
  all 19 ledger tools.
- Runs a health check (``ledger_help`` invocation) immediately after startup
  to confirm MCP server connectivity.
- Cleans up the subprocess on both normal exit and unexpected crashes via an
  ``atexit`` handler and ``__aexit__``.

Typical one-shot usage (lifecycle managed internally)::

    tools = await get_mcp_tools(cfg)

Advanced usage — manage lifecycle explicitly when tools must remain alive
across multiple calls::

    async with MCPToolkit.from_config(cfg) as toolkit:
        tools = toolkit.get_tools()
        # … perform multiple tool invocations …

    # Or construct directly:
    toolkit = MCPToolkit(mcp_server_cmd=["node", "/path/to/dist/index.js"])
    async with toolkit:
        tools = toolkit.get_tools()

.. note::
    The :class:`~src.config.Config` import is gated behind
    ``TYPE_CHECKING`` to avoid a circular import at module load time.
    The actual ``Config`` object is only needed at runtime in
    :meth:`MCPToolkit.from_config`, which receives it as a parameter.
"""

from __future__ import annotations

import asyncio
import atexit
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import Config

log = logging.getLogger(__name__)

_SERVER_KEY = "ledger"


class MCPToolkit:
    """
    Async context manager that manages the MCP server lifecycle and exposes
    LangChain Tool objects for all ledger MCP tools.

    Parameters
    ----------
    mcp_server_cmd:
        Command list used to launch the MCP server subprocess
        (e.g. ``["node", "/path/to/dist/index.js"]``).
    """

    def __init__(self, mcp_server_cmd: list[str]) -> None:
        self._cmd = mcp_server_cmd
        self._client: Any = None
        self._session_ctx: Any = None  # langchain-mcp-adapters 0.1.0 session context
        self._tools: list | None = None

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, config: Config) -> MCPToolkit:
        """Construct an :class:`MCPToolkit` from a :class:`~src.config.Config`."""
        return cls(mcp_server_cmd=config.mcp_server_cmd)

    # ------------------------------------------------------------------
    # Async context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> MCPToolkit:
        from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import]
        from langchain_mcp_adapters.tools import load_mcp_tools  # type: ignore[import]

        cmd0, *args = self._cmd
        self._client = MultiServerMCPClient(
            {
                _SERVER_KEY: {
                    "command": cmd0,
                    "args": args,
                    "transport": "stdio",
                }
            }
        )
        # langchain-mcp-adapters 0.1.0: use session() to keep the MCP server
        # subprocess alive for the duration of this context manager.
        # get_tools() is one-shot and tears down the server; session() persists it.
        self._session_ctx = self._client.session(_SERVER_KEY)
        session = await self._session_ctx.__aenter__()
        self._tools = await load_mcp_tools(session)
        log.info("MCP server started; %d tools loaded.", len(self._tools))

        # Register atexit cleanup so the subprocess is killed even on crashes.
        atexit.register(self._sync_cleanup)

        # Health check — invoke ledger_help to confirm the server is responsive.
        await self._health_check()

        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        atexit.unregister(self._sync_cleanup)
        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(exc_type, exc, tb)
            except Exception:  # noqa: BLE001
                log.warning("Error shutting down MCP session.", exc_info=True)
        self._client = None
        self._session_ctx = None
        self._tools = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_tools(self) -> list:
        """
        Return the list of LangChain Tool objects for all MCP ledger tools.

        Must be called inside the async context (after ``__aenter__``).

        Raises
        ------
        RuntimeError
            If called before entering the async context manager.
        """
        if self._tools is None:
            raise RuntimeError(
                "MCPToolkit.get_tools() called outside of async context. "
                "Use 'async with MCPToolkit(...) as toolkit:' first."
            )
        return self._tools

    @property
    def is_connected(self) -> bool:
        """``True`` if the MCP client context is active."""
        return self._client is not None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _health_check(self) -> None:
        """Invoke ``ledger_help`` to verify the MCP server is responsive."""
        tools_by_name = {t.name: t for t in (self._tools or [])}
        help_tool = tools_by_name.get("ledger_help")
        if help_tool is None:
            raise RuntimeError(
                "Health check failed: 'ledger_help' tool not found in MCP tool list. "
                f"Available tools: {sorted(tools_by_name)}"
            )
        try:
            result = await help_tool.ainvoke({})
            log.debug("MCP health check passed: %s", str(result)[:300])
        except Exception as exc:
            raise RuntimeError(
                f"MCP server health check failed: {exc}"
            ) from exc

    def _sync_cleanup(self) -> None:
        """Best-effort synchronous cleanup registered via :mod:`atexit`."""
        if self._client is None:
            return
        try:
            if self._session_ctx is not None:
                aclose = getattr(self._session_ctx, "aclose", None)
                if aclose is not None:
                    try:
                        loop = asyncio.get_running_loop()
                    except RuntimeError:
                        loop = asyncio.new_event_loop()
                    if loop.is_running():
                        loop.create_task(aclose())
                    else:
                        loop.run_until_complete(aclose())
                        loop.close()
        except Exception:  # noqa: BLE001
            pass  # Best-effort; suppress all errors in atexit handlers.


# ---------------------------------------------------------------------------
# Convenience helper
# ---------------------------------------------------------------------------

async def get_mcp_tools(config: Config) -> list:
    """
    Convenience coroutine: start the MCP toolkit, run the health check, and
    return the tool list.

    .. note::
        The MCP server subprocess is started and **stopped** within this call
        (via the async context manager).  This helper is intended for
        one-shot tool-list retrieval in simple scripts where lifecycle
        management is not required.

    Parameters
    ----------
    config:
        Application config (provides ``mcp_server_cmd``).

    Returns
    -------
    list
        LangChain Tool objects for all 19 ledger MCP tools.
    """
    async with MCPToolkit.from_config(config) as toolkit:
        return toolkit.get_tools()

```
###  Path: `/orchestrator/src/state.py`

```py
"""
state.py — WorkflowState definition for the LangGraph StateGraph.

Defines the ``WorkflowState`` TypedDict that threads all mutable and immutable
fields through the LangGraph StateGraph.  The ``run_log`` and ``errors`` fields
use the ``operator.add`` reducer so that each node only needs to return the
*new* entries it wants to append; LangGraph merges them automatically.
"""

from __future__ import annotations

from operator import add
from typing import Annotated, TypedDict


class WorkflowState(TypedDict):
    """
    Full state schema for the AI Insights orchestrator graph.

    Immutable fields
    ----------------
    project_path : str
        Absolute path to the *plan* directory (the ``docs/agents/plans/…``
        folder that contains ``plan.md`` and the work-package files).
    plan_file : str
        File name of the plan document inside ``project_path`` (usually
        ``"plan.md"``).
    target_project_path : str
        Absolute path to the *codebase* being worked on.  Passed through to
        ledger tools as the project context.

    Mutable execution state
    -----------------------
    current_stage : str
        Name of the graph stage currently executing (``"pm"``, ``"developer"``,
        ``"qa"``, ``"reviewer"``, ``"docs"``, ``"synthesis"``).
    current_wp_id : str
        Ledger work-package ID being processed in the current stage (e.g.
        ``"WP-003"``).  Empty string when no WP is active.
    iteration : int
        Total supervisor iteration counter.  Incremented on each pass through
        the supervisor routing logic.
    max_iterations : int
        Safety ceiling.  The graph terminates with an error if ``iteration``
        reaches ``max_iterations``.

    Stage output
    ------------
    stage_result : str
        Human-readable summary produced by the most-recently-completed stage.
    stage_success : bool
        ``True`` when the agent's turn included at least one pipeline completed
        with status PASS.  ``False`` when the agent raised an error, produced no
        pipeline completions, or produced only FAIL pipeline completions.

    Ledger snapshot
    ---------------
    project_status : str
        JSON-encoded snapshot of the current project status returned by the
        ``ledger_get_project_status`` MCP tool.
    wp_summaries : list
        List of work-package summary dicts from the most-recent ledger poll.
    pending_wp_count : int
        Number of work packages that are not yet in a terminal status
        (COMPLETE or CANCELLED).  Used by the supervisor to decide whether
        to keep iterating.

    Observability (append-only)
    ---------------------------
    run_log : Annotated[list, add]
        Ordered sequence of log-entry dicts written by nodes as they execute.
        Uses the ``operator.add`` reducer so each node appends new entries
        without overwriting earlier ones.
    errors : Annotated[list, add]
        Ordered sequence of error dicts.  Same append-only semantics.
    """

    # --- Immutable ---
    project_path: str
    plan_file: str
    target_project_path: str

    # --- Mutable execution state ---
    current_stage: str
    current_wp_id: str
    iteration: int
    max_iterations: int

    # --- Stage output ---
    stage_result: str
    stage_success: bool  # True = at least one PASS pipeline this turn; False = error or all-FAIL

    # --- Ledger snapshot ---
    project_status: str
    wp_summaries: list
    pending_wp_count: int  # WPs not yet in a terminal status (COMPLETE or CANCELLED)

    # --- Circuit-breaker tracking ---
    consecutive_failures: dict  # wp_id → consecutive failure count; plain dict (no reducer)

    # --- Progress tracking ---
    prev_wp_summaries: list  # Previous iteration's WP list for status-change diffing (WP-003)
    run_start_ts: str        # ISO timestamp of run start, set once by CLI (WP-001)

    # --- Delta counters ---
    wps_completed_this_run: int  # WPs fully done during this execution (resets to 0 on fresh run)

    # --- Observability (append-only) ---
    run_log: Annotated[list, add]
    errors: Annotated[list, add]

```
###  Path: `/orchestrator/src/supervisor.py`

```py
"""
supervisor.py — Pure-Python routing brain.

Reads ledger state via MCP tools and returns a deterministic LangGraph
``Command`` routing the graph to the next appropriate pipeline stage,
replacing the prompt-based auto-handoff mechanism.

The public entry-point is :func:`make_supervisor_node`, a factory that
closes over a list of LangChain MCP tool objects and returns the LangGraph
node function.  This pattern keeps the node testable (inject mock tools)
and avoids global state.

No LLM calls are made here — routing is purely algorithmic.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from .config import PIPELINE_ROLE_NAMES, ROLE_IDS, WP_TERMINAL_STATUSES
from .state import WorkflowState
from .utils.logging import get_run_logger
from .utils.mcp_parse import parse_tool_response

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Routing destination constants
# ---------------------------------------------------------------------------

_DEST_PM = ROLE_IDS["Project Manager"]
_DEST_DEVELOPER = ROLE_IDS["Developer"]
_DEST_QA = ROLE_IDS["QA"]
_DEST_SECURITY_AUDITOR = ROLE_IDS["Security Auditor"]
_DEST_REVIEWER = ROLE_IDS["Reviewer"]
_DEST_RELEASE_ENGINEER = ROLE_IDS["Release Engineer"]
_DEST_DOCS = ROLE_IDS["Documentation"]
_DEST_SYNTHESIS = ROLE_IDS["Synthesis"]

# Work-package statuses considered terminal (no further agent action needed).
_TERMINAL_STATUSES: frozenset[str] = WP_TERMINAL_STATUSES

# Actions where the role has nothing to do this iteration.
_SKIP_ACTIONS: frozenset[str] = frozenset({
    "WAIT",
    "WAIT_FOR_REWORK",
    "WAIT_FOR_DOWNSTREAM",
    "WAIT_FOR_UPSTREAM_REWORK_LIMIT",
    "BLOCK_FOR_REWORK_LIMIT",
})

# All non-skip action strings known to this version of the supervisor.
# Any unrecognised action (not in _SKIP_ACTIONS and not here) is forwarded-
# compatible: treated as WAIT with a warning so future server additions don't
# crash the supervisor.
_DISPATCH_ACTIONS: frozenset[str] = frozenset({
    # PM
    "UNBLOCK_WP", "REVIEW_REWORK_LIMIT", "REVIEW_STALE", "REVIEW_ABANDONED",
    "REPAIR_ORPHAN_BLOCKED",
    # Developer
    "IMPLEMENT", "CLAIM_WP", "CONTINUE_PIPELINE", "RESUME_OR_CANCEL",
    # Multi-role (routed by fail_routing in workflow manifest)
    "REWORK",
    # QA
    "RUN_QA",
    # Security Auditor
    "RUN_SECURITY_AUDIT",
    # Reviewer
    "RUN_REVIEW",
    # Release Engineer
    "RUN_RELEASE_ENGINEERING",
    # Documentation
    "WRITE_DOCS", "FINALIZE_WP", "UPDATE_CRITERIA",
})

# Maps each agent role name (as used in ledger_get_next_action) to the
# corresponding LangGraph stage destination.
# Derived from the manifest: non-orchestrating role name → role ID.
_ROLE_STAGE_MAP: dict[str, str] = {
    name: ROLE_IDS[name]
    for name in PIPELINE_ROLE_NAMES
}

# All non-orchestrating agent role names in manifest order.
# The supervisor queries each role in turn to find the first with actionable work.
_ROLES: list[str] = list(PIPELINE_ROLE_NAMES)

# LangGraph END sentinel.
try:
    from langgraph.constants import END  # type: ignore[import]
except ImportError:
    END = "__end__"  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def make_supervisor_node(mcp_tools: list[Any], *, dry_run: bool = False):
    """
    Return a LangGraph node function (supervisor) closed over *mcp_tools*.

    The returned function is a deterministic pure-Python router: it reads
    ledger state via the provided MCP tools and returns a ``Command`` that
    routes the graph to the next appropriate stage.

    Parameters
    ----------
    mcp_tools:
        List of LangChain Tool objects returned by ``MCPToolkit.get_tools()``.
    dry_run:
        When ``True``, the supervisor tolerates missing ledger state
        (expected when stage nodes are stubs) and terminates cleanly
        instead of looping.

    Returns
    -------
    Callable[[WorkflowState], Command]
        The supervisor node function.
    """
    tools_by_name: dict[str, Any] = {t.name: t for t in mcp_tools}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _call_tool(name: str, **kwargs: Any) -> Any:
        """Invoke an MCP tool by name and return the parsed JSON response."""
        tool = tools_by_name.get(name)
        if tool is None:
            raise RuntimeError(
                f"MCP tool {name!r} not found. "
                f"Available: {sorted(tools_by_name)}"
            )
        raw = await tool.ainvoke(kwargs)
        return parse_tool_response(raw)

    def _log_entry(
        stage: str, wp_id: str, action: str, destination: str, **extra: Any
    ) -> dict:
        return {
            "timestamp": datetime.now(UTC).isoformat(),
            "stage": stage,
            "wp_id": wp_id,
            "action": action,
            "destination": destination,
            "level": "INFO",  # default; callers may override via **extra
            **extra,
        }

    # ------------------------------------------------------------------
    # The node function itself
    # ------------------------------------------------------------------

    async def supervisor_node(
        state: WorkflowState, config: RunnableConfig | None = None,
    ) -> Command:
        """Deterministic routing node — pure Python, no LLM calls."""
        run_logger = get_run_logger(config)
        project_path: str = state["project_path"]
        new_iteration: int = state.get("iteration", 0) + 1  # type: ignore[call-overload]
        max_iterations: int = state.get("max_iterations", 100)  # type: ignore[call-overload]

        # ── Update consecutive-failure circuit breaker ────────────────
        # Each supervisor iteration checks the result of the previous stage.
        # If the same WP failed, increment its counter; reset it on success.
        prev_wp_id: str = state.get("current_wp_id", "")  # type: ignore[call-overload]
        prev_success: bool = state.get("stage_success", True)  # type: ignore[call-overload]
        cf: dict = dict(state.get("consecutive_failures", {}))  # type: ignore[call-overload]
        if prev_wp_id:
            if not prev_success:
                cf[prev_wp_id] = cf.get(prev_wp_id, 0) + 1
                log.debug(
                    "Consecutive failure counter for WP %s: %d",
                    prev_wp_id,
                    cf[prev_wp_id],
                )
            else:
                # Reset counter when the WP completes a stage successfully.
                cf.pop(prev_wp_id, None)

        log.debug(
            "Supervisor iteration %d/%d for project %s",
            new_iteration,
            max_iterations,
            project_path,
        )

        # ── Safety limit ─────────────────────────────────────────────
        if new_iteration > max_iterations:
            ts = datetime.now(UTC).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="safety_limit",
                destination=str(END),
                iteration=new_iteration,
                level="WARNING",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=END,
                update={
                    "iteration": new_iteration,
                    "current_stage": "supervisor",
                    "run_log": [log_entry],
                    "errors": [
                        {
                            "timestamp": ts,
                            "message": (
                                f"Safety limit reached: iteration {new_iteration} "
                                f"exceeds max_iterations {max_iterations}."
                            ),
                        }
                    ],
                },
            )

        # ── Read ledger state ─────────────────────────────────────────
        try:
            status_data = await _call_tool("ledger_get_project_status", project_path=project_path)
        except Exception as exc:
            if dry_run:
                # Missing ledger is expected in dry-run mode — stubs don't
                # initialise a project.  Log once at INFO and terminate.
                log.info("[dry-run] Ledger not initialised (expected): %s", exc)
                log_entry = _log_entry(
                    stage="supervisor",
                    wp_id="",
                    action="dry_run_no_ledger",
                    destination=str(END),
                    detail=str(exc),
                    level="INFO",
                )
                if run_logger:
                    run_logger.stream_entry(log_entry)
                return Command(
                    goto=END,
                    update={
                        "iteration": new_iteration,
                        "current_stage": "supervisor",
                        "run_log": [log_entry],
                    },
                )
            log.error("Failed to read project status: %s", exc)
            ts = datetime.now(UTC).isoformat()
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="mcp_error",
                destination=str(END),
                error=str(exc),
                level="ERROR",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=END,
                update={
                    "iteration": new_iteration,
                    "current_stage": "supervisor",
                    "run_log": [log_entry],
                    "errors": [{"timestamp": ts, "message": str(exc)}],
                },
            )

        wp_list_error: str | None = None
        try:
            wp_list_data = await _call_tool("ledger_list_work_packages", project_path=project_path)
        except Exception as exc:
            log.error("Failed to list work packages: %s", exc)
            wp_list_error = str(exc)
            wp_list_data = []

        # Normalise: tool may return list or dict with "work_packages" key.
        if isinstance(wp_list_data, dict):
            wp_summaries: list = wp_list_data.get("work_packages", [])
        elif isinstance(wp_list_data, list):
            wp_summaries = wp_list_data
        else:
            wp_summaries = []

        pending_count = sum(
            1 for wp in wp_summaries if wp.get("status") not in _TERMINAL_STATUSES
        )

        base_update: dict[str, Any] = {
            "iteration": new_iteration,
            "current_stage": "supervisor",
            "project_status": json.dumps(status_data),
            "wp_summaries": wp_summaries,
            "pending_wp_count": pending_count,
            "consecutive_failures": cf,
            "prev_wp_summaries": wp_summaries,  # stored for next iteration's diff
        }

        # ── WP status-change detection ────────────────────────────────
        _prev_summaries: list = state.get("prev_wp_summaries", [])  # type: ignore[call-overload]
        _prev_status_map: dict[str, str] = {
            _w.get("work_package_id", ""): _w.get("status", "")
            for _w in _prev_summaries
            if _w.get("work_package_id")
        }
        status_change_entries: list = []
        for _w in wp_summaries:
            _wp_id_sc = _w.get("work_package_id", "")
            _new_st = _w.get("status", "")
            _old_st = _prev_status_map.get(_wp_id_sc)
            if _old_st is not None and _old_st != _new_st:
                _sc_entry = _log_entry(
                    stage="supervisor",
                    wp_id=_wp_id_sc,
                    action="wp_status_change",
                    destination="",
                    old_status=_old_st,
                    new_status=_new_st,
                )
                if run_logger:
                    run_logger.stream_entry(_sc_entry)
                status_change_entries.append(_sc_entry)
                if _new_st == "COMPLETE":
                    _wc_entry = _log_entry(
                        stage="supervisor",
                        wp_id=_wp_id_sc,
                        action="wp_complete",
                        destination="",
                    )
                    if run_logger:
                        run_logger.stream_entry(_wc_entry)
                    status_change_entries.append(_wc_entry)

        # ── Progress snapshot (all data from memory, no extra MCP calls) ──────
        _status_counts: dict[str, int] = {}
        for _w in wp_summaries:
            _s = _w.get("status", "UNKNOWN")
            _status_counts[_s] = _status_counts.get(_s, 0) + 1
        _elapsed_s: float | None = None
        _run_start_ts: str = state.get("run_start_ts", "")  # type: ignore[call-overload]
        if _run_start_ts:
            try:
                _elapsed_s = round(
                    (
                        datetime.now(UTC) - datetime.fromisoformat(_run_start_ts)
                    ).total_seconds(),
                    1,
                )
            except (ValueError, TypeError):
                pass
        progress_snapshot = _log_entry(
            stage="supervisor",
            wp_id="",
            action="progress_snapshot",
            destination="",
            total_wps=len(wp_summaries),
            status_breakdown=_status_counts,
            pending=pending_count,
            wps_completed_this_run=state.get("wps_completed_this_run", 0),  # type: ignore[call-overload]
            iteration=new_iteration,
            max_iterations=max_iterations,
            elapsed_s=_elapsed_s,
            run_start_ts=_run_start_ts or None,
        )
        if run_logger:
            run_logger.stream_entry(progress_snapshot)

        # ── No WPs → PM needs to create them ─────────────────────────
        if not wp_summaries:
            # In dry-run mode, PM stubs won't create a ledger.  Route to
            # PM on the very first iteration (to validate the path), then
            # terminate cleanly on subsequent iterations.
            if dry_run and new_iteration > 1:
                log_entry = _log_entry(
                    stage="supervisor",
                    wp_id="",
                    action="dry_run_complete",
                    destination=str(END),
                    reason="dry-run: PM stub executed; no ledger expected",
                    level="INFO",
                )
                if run_logger:
                    run_logger.stream_entry(log_entry)
                return Command(
                    goto=END,
                    update={
                        **base_update,
                        "current_stage": "supervisor",
                        "run_log": [log_entry, progress_snapshot],
                    },
                )

            extra_entries: list = []
            extra_errs: list = []
            if wp_list_error:
                if dry_run:
                    # Missing ledger is expected in dry-run — log at INFO,
                    # don't record as an error.
                    info_entry = _log_entry(
                        stage="supervisor",
                        wp_id="",
                        action="dry_run_no_ledger",
                        destination=_DEST_PM,
                        detail=wp_list_error,
                        level="INFO",
                    )
                    if run_logger:
                        run_logger.stream_entry(info_entry)
                    extra_entries.append(info_entry)
                else:
                    ts = datetime.now(UTC).isoformat()
                    err_entry = _log_entry(
                        stage="supervisor",
                        wp_id="",
                        action="mcp_error",
                        destination=_DEST_PM,
                        error=wp_list_error,
                        level="WARNING",
                    )
                    if run_logger:
                        run_logger.stream_entry(err_entry)
                    extra_entries.append(err_entry)
                    extra_errs.append({
                        "timestamp": ts,
                        "message": f"ledger_list_work_packages failed: {wp_list_error}",
                    })
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_PM,
                reason="no work packages found",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=_DEST_PM,
                update={
                    **base_update,
                    "current_stage": _DEST_PM,
                    "run_log": (
                        status_change_entries + extra_entries + [log_entry, progress_snapshot]
                    ),
                    "errors": extra_errs,
                },
            )

        # ── All WPs terminal (COMPLETE or CANCELLED) → synthesis ───────────────────
        if all(wp.get("status") in _TERMINAL_STATUSES for wp in wp_summaries):
            log_entry = _log_entry(
                stage="supervisor",
                wp_id="",
                action="route",
                destination=_DEST_SYNTHESIS,
                reason="all work packages terminal (COMPLETE or CANCELLED)",
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            return Command(
                goto=_DEST_SYNTHESIS,
                update={
                    **base_update,
                    "current_stage": _DEST_SYNTHESIS,
                    "run_log": status_change_entries + [log_entry, progress_snapshot],
                },
            )

        # ── Route via ledger_get_next_action (single source of truth) ────────
        # Query each agent role in turn.  The first role that returns a
        # dispatchable action wins; the supervisor routes to that stage.
        # All roles returning WAIT means nothing is actionable → synthesis.

        extra_log_entries: list = []
        extra_errors: list = []

        for role in _ROLES:
            try:
                action_data = await _call_tool(
                    "ledger_get_next_action",
                    project_path=project_path,
                    agent_role=role,
                )
            except Exception as exc:
                log.warning(
                    "Failed to get next action for role %s: %s; skipping.", role, exc
                )
                continue

            if not isinstance(action_data, dict):
                log.warning(
                    "Unexpected response shape from ledger_get_next_action for "
                    "role %s; treating as WAIT.",
                    role,
                )
                continue

            action: str = action_data.get("action", "") or ""
            wp_id: str = action_data.get("work_package_id", "") or ""

            # Nothing to do for this role right now.
            if action in _SKIP_ACTIONS:
                continue

            # Forward-compatibility: unrecognised action strings → WAIT.
            if action not in _DISPATCH_ACTIONS:
                log.warning(
                    "Unrecognised action %r for role %s; treating as WAIT.",
                    action,
                    role,
                )
                continue

            # Circuit breaker: skip WPs with too many consecutive failures.
            if wp_id:
                consecutive = cf.get(wp_id, 0)
                if consecutive >= 3:
                    ts = datetime.now(UTC).isoformat()
                    log.warning(
                        "WP %s halted: %d consecutive failures — skipping to prevent loop.",
                        wp_id,
                        consecutive,
                    )
                    entry = _log_entry(
                        stage="supervisor",
                        wp_id=wp_id,
                        action="halted_repeated_failure",
                        destination=str(END),
                        consecutive_failures=consecutive,
                        level="WARNING",
                    )
                    if run_logger:
                        run_logger.stream_entry(entry)
                    extra_log_entries.append(entry)
                    extra_errors.append({
                        "timestamp": ts,
                        "message": (
                            f"WP {wp_id} halted after {consecutive} consecutive failures — "
                            "it will not be re-dispatched in this run."
                        ),
                    })
                    continue

            destination = _ROLE_STAGE_MAP.get(role)
            if destination is None:
                log.warning("No stage mapped for role %r; skipping.", role)
                continue

            # Emit rework_detected when the ledger dispatches a REWORK action.
            if action == "REWORK":
                rework_entry = _log_entry(
                    stage="supervisor",
                    wp_id=wp_id,
                    action="rework_detected",
                    destination=destination,
                    agent_role=role,
                    pipeline_type=action_data.get("pipeline_type", ""),
                    rework_count=action_data.get("rework_count"),
                )
                if run_logger:
                    run_logger.stream_entry(rework_entry)
                extra_log_entries.append(rework_entry)

            log_entry = _log_entry(
                stage="supervisor",
                wp_id=wp_id,
                action="route",
                destination=destination,
                agent_role=role,
                ledger_action=action,
                prev_stage=state.get("current_stage", ""),  # type: ignore[call-overload]
                prev_wp_id=prev_wp_id,
                prev_result="PASS" if prev_success else ("FAIL" if prev_wp_id else ""),
            )
            if run_logger:
                run_logger.stream_entry(log_entry)
            log.info(
                "Routing WP %s (role=%s, action=%s) → %s", wp_id, role, action, destination
            )
            return Command(
                goto=destination,
                update={
                    **base_update,
                    "current_wp_id": wp_id,
                    "current_stage": destination,
                    "run_log": (
                        status_change_entries + extra_log_entries + [log_entry, progress_snapshot]
                    ),
                    "errors": extra_errors,
                },
            )

        # ── All roles returned WAIT/skip → route to synthesis ─────────────────
        log_entry = _log_entry(
            stage="supervisor",
            wp_id="",
            action="route",
            destination=_DEST_SYNTHESIS,
            reason="all roles returned WAIT",
        )
        if run_logger:
            run_logger.stream_entry(log_entry)
        return Command(
            goto=_DEST_SYNTHESIS,
            update={
                **base_update,
                "current_stage": _DEST_SYNTHESIS,
                "run_log": (
                    status_change_entries + extra_log_entries + [log_entry, progress_snapshot]
                ),
                "errors": extra_errors,
            },
        )

    return supervisor_node


```