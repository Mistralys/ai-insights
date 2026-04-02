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

    # --- Fatal error (immediate termination, bypasses iteration loop) ---
    fatal_error: str  # Non-empty when an unrecoverable error occurred (e.g. auth failure)

    # --- Progress tracking ---
    prev_wp_summaries: list  # Previous iteration's WP list for status-change diffing (WP-003)
    run_start_ts: str        # ISO timestamp of run start, set once by CLI (WP-001)

    # --- Delta counters ---
    wps_completed_this_run: int  # WPs fully done during this execution (resets to 0 on fresh run)

    # --- Observability (append-only) ---
    run_log: Annotated[list, add]
    errors: Annotated[list, add]
