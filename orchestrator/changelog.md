# Orchestrator Changelog

## v0.8.0 - Supervisor Progress & Status Events
- Supervisor: Emits `wp_status_change` (old_status, new_status) and `wp_complete` events when WP status changes between consecutive iterations.
- Supervisor: Emits `progress_snapshot` every iteration with total_wps, status_breakdown, pending, wps_completed_this_run, iteration, max_iterations, elapsed_s, run_start_ts. No additional MCP calls.
- Supervisor: Enriched `route` entries with prev_stage, prev_wp_id, prev_result fields.
- Supervisor: Emits `rework_detected` (wp_id, agent_role, pipeline_type, rework_count) when routing to REWORK.
- Supervisor: Stores prev_wp_summaries in base_update for status-change diffing on next iteration.
- Tests: Added `TestProgressSnapshot` (4), `TestWPStatusChangeEvents` (4), `TestPrevWPSummariesStored` (1), `TestEnrichedRouteEvents` (2), `TestReworkDetectedEvent` (2) to `test_supervisor.py`.
- Docs: Updated JSONL log schema, architecture deep-dive, and README for all new supervisor events.

## v0.7.0 - Stage Lifecycle Events & Pipeline Result Read-back
- Nodes: Emits `stage_start` event (timestamp, stage, wp_id, iteration) before every Deep Agent invocation.
- Nodes: Added `duration_s` (wallclock seconds) to `stage_complete` and `stage_error` log entries.
- Nodes: Added best-effort `pipeline_result` read-back after successful stage completion — emits pipeline type, status, files_modified, metrics, summary, and duration_s; failures caught silently at DEBUG level.
- Utils: Extracted `parse_tool_response()` to `src/utils/mcp_parse.py`; shared by both `supervisor.py` and `nodes/__init__.py`.
- Tests: Added `TestStageStartEvent` (4 tests), `TestDurationS` (12 parametrized tests), `TestPipelineResult` (7 tests) to `test_nodes.py`. Total: 322 tests.
- Docs: Updated JSONL log schema, architecture deep-dive, public API, and README to reflect new events and `mcp_parse` utility.

## v0.6.0 - Windows Cross-Platform Fix
- Fix: Replaced unconditional `import fcntl` in `cli.py` with a cross-platform `filelock` module; the orchestrator now starts on Windows without `ModuleNotFoundError`.
- Core: Added `src/utils/filelock.py` — stdlib-only file locking (`fcntl.flock` on Unix, `msvcrt.locking` on Windows, no third-party dependencies).
- Tests: Added `tests/test_filelock.py` with 3 platform-agnostic unit tests: acquire succeeds, contention raises `OSError`, `unlock` is idempotent.
- Docs: Created project manifest documentation.

## v0.5.0 - Checkpoint Support & Stability
- Core: Added checkpoint support for resumable runs.
- CLI: Added concurrency guard to prevent parallel runs against the same plan.
- CLI: Improved PM phase feedback.
- Fix: Fixed sqlite imports.
- Fix: Fixed a runtime bug in tool wrappers.
- Fix: Fixed async runtime errors in graph builder and checkpointer.
- Tests: Added tool wrapper tests.

## v0.4.0 - Manifest-Driven Configuration
- Config: Pipeline routing constants now derived from `shared/workflow-manifest.json` at startup.
- Supervisor: Updated routing to align with manifest-defined role and pipeline definitions.
- Tests: Added config test suite covering manifest-derived constants.
- Tests: Expanded supervisor routing test coverage.
- Docs: Added CTX Generator module context file.

## v0.3.0 - Nine-Stage Pipeline Support
- Nodes: Added stub implementations for the security auditor and release engineer stages.
- Config: Extended pipeline routing to include `security-audit` and `release-engineering` stages.
- Docs: Updated README and architecture documentation to reflect the expanded 9-stage pipeline.

## v0.2.1 - Documentation Structure
- Docs: Updated and split READMEs for clarity.

## v0.2.0 - Ledger Delegation Architecture (Breaking-S)
- Architecture: Delegated all logic execution to the ledger system.
- Scripts: Replaced the primary execution script.

### Breaking Changes
This release significantly refactors the orchestration logic, moving execution responsibility to the ledger. Previous local execution patterns may be deprecated.

## v0.1.1 - Logic Cycle Stabilization
- Logic: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial implementation of the LangGraph-based pipeline.
- Core: Completed post-development rework and stabilization.
- Config: Updated `.env.example`.
- Housekeeping: Removed temporary folders.
