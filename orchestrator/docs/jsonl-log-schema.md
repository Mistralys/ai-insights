# JSONL Log Schema

> **Parent:** [orchestrator/README.md](../README.md) · **Sources:** `orchestrator/src/utils/logging.py` (logger), `orchestrator/src/nodes/__init__.py` (stage events), `orchestrator/src/supervisor.py` (routing events), `orchestrator/src/cli.py` (run lifecycle events)

Every run writes a JSONL file to `orchestrator/logs/` (path printed at run start). Each line is a JSON object. The schema supports **16 event types** across three emitters: the CLI (run lifecycle), the supervisor (routing and project progress), and stage nodes (pipeline execution).

---

## Full Field Reference

| Field | Present In | Type | Description |
|-------|-----------|------|-------------|
| `timestamp` | all entries | ISO 8601 string | Wall-clock time of the event (UTC) |
| `stage` | all entries | string | Node/stage name (e.g. `"supervisor"`, `"developer"`, `"cli"`) |
| `wp_id` | stage events | string | Work package ID being processed (e.g. `"WP-003"`); empty string for supervisor-level events |
| `action` | all entries | string | Event type — see [Action Values](#action-values) below |
| `destination` | routing events | string | Next LangGraph node name (e.g. `"developer"`, `"__end__"`) |
| `result` | `stage_complete`, `stage_error` | string | `"PASS"` on successful agent completion; `"FAIL"` on exception |
| `level` | all entries | string | `"INFO"` for normal events; `"WARNING"` for safety/circuit-breaker halts; `"ERROR"` for MCP or stage errors |
| `error` | `stage_error`, error entries | string | Error message (only present when `level` is `"ERROR"`) |
| `tokens_used` | `stage_complete` | dict or null | `{"input_tokens": N, "output_tokens": N, "total_tokens": N}` when the LLM returns usage metadata; `null` when absent |
| `duration_s` | `stage_complete`, `stage_error`, `pipeline_result` | float | Wallclock seconds from stage start to stage end (rounded to 1 decimal place). For `pipeline_result`, derived from `pipeline.duration_ms` when available; `null` otherwise. |
| `iteration` | `stage_start` | int | Supervisor loop iteration count at the time the stage was invoked |
| `pipeline_type` | `pipeline_result`, `rework_detected` | string | Pipeline type (e.g. `"implementation"`) |
| `pipeline_status` | `pipeline_result` | string | Status of the latest WP pipeline (e.g. `"PASS"`) |
| `files_modified` | `pipeline_result` | list | Files modified by the pipeline (from pipeline artifacts); empty list when not recorded |
| `metrics` | `pipeline_result` | dict or null | Test/coverage metrics from the pipeline (e.g. `{"tests_passed": 50, "test_coverage": "90%"}`) |
| `summary` | `pipeline_result` | list | Agent's summary lines from the pipeline |
| `old_status` | `wp_status_change` | string | Previous WP status before the transition |
| `new_status` | `wp_status_change` | string | New WP status after the transition |
| `total_wps` | `progress_snapshot` | int | Total number of work packages in the project |
| `status_breakdown` | `progress_snapshot` | dict | Status → count mapping (e.g. `{"COMPLETE": 2, "IN_PROGRESS": 1}`) |
| `pending` | `progress_snapshot` | int | Count of WPs in non-terminal status |
| `wps_completed_this_run` | `progress_snapshot` | int | WPs that transitioned to COMPLETE during this run (note: currently always `0` — pending fix in supervisor) |
| `max_iterations` | `progress_snapshot` | int | Configured safety-ceiling for supervisor loop iterations |
| `elapsed_s` | `progress_snapshot` | float | Seconds elapsed since `run_start_ts`; omitted when `run_start_ts` is unavailable or unparseable |
| `prev_stage` | `route` | string | Stage that was active before this routing decision (`state.current_stage`) |
| `prev_wp_id` | `route` | string | WP ID that was active before this routing decision |
| `prev_result` | `route` | string | `"PASS"` / `"FAIL"` / `""` result from the previous stage |
| `agent_role` | `rework_detected` | string | Agent role responsible for the rework (e.g. `"QA"`) |
| `rework_count` | `rework_detected` | int or null | Rework occurrence count from `action_data`; `null` when not provided |
| `thread_id` | `run_start`, `run_end` | string | LangGraph thread identifier (UUID) for checkpoint/resume |
| `dry_run` | `run_start` | boolean | `true` when `--dry-run` flag was passed |
| `run_start_ts` | `run_start` | ISO 8601 string | ISO timestamp of the run's start (UTC). Also stored in `WorkflowState.run_start_ts` for computing `total_duration_s`. |
| `total_duration_s` | `run_end` (optional) | float | Wall-clock duration of the run in seconds (rounded to 1 decimal place). Omitted when `run_start_ts` is unavailable or could not be parsed. |

---

## Action Values

| `action` | Emitted by | Key fields added |
|----------|-----------|------------------|
| `stage_start` | `nodes/__init__.py` | `stage`, `wp_id`, `iteration`, `level="INFO"` |
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, `duration_s` |
| `stage_error` | `nodes/__init__.py` | `stage`, `wp_id`, `result="FAIL"`, `error`, `duration_s`, `level="ERROR"` |
| `pipeline_result` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` |
| `wp_status_change` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `old_status`, `new_status`, `level="INFO"` |
| `wp_complete` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `level="INFO"` |
| `progress_snapshot` | `supervisor.py` | `stage="supervisor"`, `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, `elapsed_s` (optional), `run_start_ts` |
| `rework_detected` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `agent_role`, `pipeline_type`, `rework_count`, `level="INFO"` |
| `route` | `supervisor.py` | `stage="supervisor"`, `destination`, `prev_stage`, `prev_wp_id`, `prev_result`, `level` (`"INFO"` / `"WARNING"`) |
| `halt` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `level="WARNING"` |
| `run_start` | `cli.py` | `stage="cli"`, `thread_id`, `dry_run`, `run_start_ts` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `thread_id`, `total_duration_s` |
| `run_error` | `cli.py` | `stage="cli"`, `error`, `thread_id`, `level="ERROR"` |

### `stage_start` / `stage_complete` / `stage_error` ordering

For every stage invocation, three to four entries are written in order:

1. **`stage_start`** — emitted immediately before the Deep Agent is created
2. **`stage_complete`** (or **`stage_error`** on exception) — emitted after the agent finishes
3. **`pipeline_result`** *(optional)* — emitted after `stage_complete` when the WP still exists and carries at least one pipeline record; omitted on read-back failure or when `wp_id` is empty

`pipeline_result.duration_s` will be `null` until `ledger_complete_pipeline` stores `duration_ms` in the WP record (separate MCP server work package).

### Supervisor event ordering per iteration

Every supervisor iteration writes entries in this order:

1. **`wp_status_change`** (0–N) — one per WP that changed status since the previous iteration
2. **`wp_complete`** (0–N) — one per WP that transitioned to COMPLETE
3. **`rework_detected`** (0 or 1) — emitted when the current action is `REWORK`
4. **`route`** — always present; carries `prev_stage`, `prev_wp_id`, `prev_result`
5. **`progress_snapshot`** — always last in the iteration's entries; carries cumulative totals
