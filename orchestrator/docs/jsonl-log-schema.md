# JSONL Log Schema

> **Parent:** [orchestrator/README.md](../README.md) · **Sources:** `orchestrator/src/utils/logging.py` (logger), `orchestrator/src/nodes/__init__.py` (stage events), `orchestrator/src/supervisor.py` (routing events), `orchestrator/src/cli.py` (run lifecycle events)

Every run writes a JSONL file to `orchestrator/logs/` during execution. At run completion it is **copied** to `mcp-server/storage/ledger/{slug}/orchestrator/logs/` (path printed at run end); the original remains in `orchestrator/logs/`. Each line is a JSON object. The schema supports **23 event types** across three emitters: the CLI (run lifecycle), the supervisor (routing and project progress), and stage nodes (pipeline execution and tool-call activity).

> **Streaming guarantee:** Graph nodes call `stream_entry()` to persist events in real time via the `WorkflowLogger` instance passed through LangGraph's `configurable` dict (key: `run_logger`). For LangGraph to inject this, node functions must annotate their `config` parameter as `Optional[RunnableConfig]` — using `RunnableConfig | None` with `from __future__ import annotations` produces a string annotation that LangGraph's signature inspector does not recognise. When the logger is successfully injected, events appear in the JSONL file immediately as they occur. If the `WorkflowLogger` is unreachable inside graph nodes (e.g. incorrect annotation or the configurable key was stripped), events accumulate only in the LangGraph state's `run_log` list. At run exit, `cli.py` calls `flush_unstreamed(run_log)` to write any un-persisted entries as a batch before the `run_end` sentinel. In this fallback scenario, stage and supervisor events appear immediately before `run_end` rather than interleaved with heartbeats.

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
| `plan` | `run_start` | string | Resolved path of the plan file passed via `--plan` |
| `run_start_ts` | `run_start` | ISO 8601 string | ISO timestamp of the run's start (UTC). Also stored in `WorkflowState.run_start_ts` for computing `total_duration_s`. |
| `total_duration_s` | `run_end` (optional) | float | Wall-clock duration of the run in seconds (rounded to 1 decimal place). Omitted when `run_start_ts` is unavailable or could not be parsed. |
| `silence_s` | `heartbeat` | float | Seconds elapsed since the last log entry was emitted (rounded to 1 decimal place) |
| `file_path` | `dialogue_captured` | string | Absolute path to the Markdown dialogue file written to disk (non-empty when capture succeeds) |
| `partial` | `dialogue_captured` | boolean | (Optional) `true` if the dialogue capture occurred during an error-path rollback (crash before stage completed). |
| `tool_name` | `tool_call` | string | The MCP tool name from `tool.name` (e.g. `"ledger_create_work_package"`) |
| `tool_wp_id` | `tool_call` | string | The `work_package_id` argument extracted from the call arguments; empty string when absent. **Never** includes the full argument payload (privacy constraint). |
| `detail` | `dry_run_no_ledger` | string | The underlying error message from the missing ledger (logged at INFO, not treated as an error) |
| `reason` | `dry_run_complete` | string | Human-readable reason for clean termination (e.g. `"dry-run: PM stub executed; no ledger expected"`) |

---

## Action Values

| `action` | Emitted by | Key fields added |
|----------|-----------|------------------|
| `stage_start` | `nodes/__init__.py` | `stage`, `wp_id`, `iteration`, `level="INFO"` |
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, `duration_s` |
| `stage_error` | `nodes/__init__.py` | `stage`, `wp_id`, `result="FAIL"`, `error`, `duration_s`, `level="ERROR"` |
| `pipeline_result` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` |
| `pipeline_rollback` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `level="INFO"` — emitted when error-path rollback successfully cancels an orphaned IN_PROGRESS pipeline |
| `tool_call` | `utils/tool_wrappers.py` | `stage`, `wp_id`, `action="tool_call"`, `tool_name`, `tool_wp_id`, `level="DEBUG"` — emitted before every MCP tool `ainvoke`; argument payload excluded (privacy constraint) |
| `dialogue_captured` | `nodes/__init__.py` | `stage`, `wp_id`, `file_path` (non-empty absolute path), `partial` (optional boolean, `true` for error-path captures), `level="INFO"` — emitted by default; suppressed when `capture_dialogues=False` |
| `wp_status_change` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `old_status`, `new_status`, `level="INFO"` |
| `wp_complete` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `level="INFO"` |
| `progress_snapshot` | `supervisor.py` | `stage="supervisor"`, `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, `elapsed_s` (optional), `run_start_ts` |
| `rework_detected` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `agent_role`, `pipeline_type`, `rework_count`, `level="INFO"` |
| `route` | `supervisor.py` | `stage="supervisor"`, `destination`, `prev_stage`, `prev_wp_id`, `prev_result`, `level` (`"INFO"` / `"WARNING"`) |
| `halt` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `level="WARNING"` |
| `safety_limit` | `supervisor.py` | `stage="supervisor"`, `destination=END`, `iteration`, `level="WARNING"` |
| `mcp_error` | `supervisor.py` | `stage="supervisor"`, `destination` (END or PM), `error`, `level` (`"ERROR"` / `"WARNING"`). **Suppressed in dry-run mode** — replaced by `dry_run_no_ledger` at INFO level. |
| `dry_run_no_ledger` | `supervisor.py` | `stage="supervisor"`, `destination` (END or PM), `detail`, `level="INFO"`. Emitted in `--dry-run` mode when the ledger is missing (expected). Replaces `mcp_error` to avoid false-positive error noise. |
| `dry_run_complete` | `supervisor.py` | `stage="supervisor"`, `destination=END`, `reason`, `level="INFO"`. Emitted in `--dry-run` mode on the second supervisor iteration when no WPs exist — signals clean termination (PM stub cannot create a ledger). |
| `halted_repeated_failure` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `destination=END`, `consecutive_failures`, `level="WARNING"` |
| `halted_wp_cancelled` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `destination` (synthesis), `reason`, `level="WARNING"` — emitted for each halted WP cancelled before synthesis dispatch |
| `heartbeat` | `utils/logging.py` | `stage="heartbeat"`, `silence_s`, `level="INFO"` |
| `run_start` | `cli.py` | `stage="cli"`, `thread_id`, `dry_run`, `plan`, `run_start_ts` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `thread_id`, `total_duration_s` |
| `run_error` | `cli.py` | `stage="cli"`, `error`, `thread_id`, `level="ERROR"` |

### `stage_start` / `stage_complete` / `stage_error` ordering

For every stage invocation, three to five entries are written in order:

1. **`stage_start`** — emitted immediately before the Deep Agent is created
2. **`tool_call`** *(0–N)* — emitted once before each MCP tool `ainvoke`; high-frequency at `level: "DEBUG"` (one per tool call during the stage); never includes argument payloads
3. **`stage_complete`** (or **`stage_error`** on exception) — emitted after the agent finishes
4. **`pipeline_result`** *(optional)* — emitted after `stage_complete` when the WP still exists and carries at least one pipeline record; omitted on read-back failure or when `wp_id` is empty
5. **`dialogue_captured`** *(optional)* — emitted by default when `wp_id` is non-empty (suppressed when `capture_dialogues=False`); records the path of the Markdown dialogue file written to disk. Includes `partial: true` if captured in the error path after a crash. A write failure is caught silently and this entry is omitted.

`pipeline_result.duration_s` will be `null` until `ledger_complete_pipeline` stores `duration_ms` in the WP record (separate MCP server work package).

### `tool_call` — level and privacy notes

**`level: "DEBUG"`** — `tool_call` events are high-frequency (one per MCP tool invocation during a stage). Using `"DEBUG"` level allows consumers to filter them out of normal console output and summary views without losing them from the JSONL record. The `scripts/read-log.js` reader and the `WorkflowLogger` console renderer both suppress `DEBUG` entries from default output.

**Argument payload exclusion (privacy)** — Only `tool_name` and `tool_wp_id` are captured. The full `input` dict passed to `ainvoke` is deliberately **not logged**. This prevents plan content, work package descriptions, and any other sensitive data the LLM passes to tools from appearing in the JSONL log. `tool_wp_id` is the sole exception: it is a non-sensitive identifier extracted specifically to provide WP-level routing visibility in the log stream.

### Supervisor event ordering per iteration

Every supervisor iteration writes entries in this order:

1. **`wp_status_change`** (0–N) — one per WP that changed status since the previous iteration
2. **`wp_complete`** (0–N) — one per WP that transitioned to COMPLETE
3. **`rework_detected`** (0 or 1) — emitted when the current action is `REWORK`
4. **`route`** — always present; carries `prev_stage`, `prev_wp_id`, `prev_result`
5. **`progress_snapshot`** — always last in the iteration's entries; carries cumulative totals

---

## Duration Conventions

Three duration fields appear across events, each measuring a different scope:

| Field | Unit | Precision | Scope | Present On |
|-------|------|-----------|-------|------------|
| `duration_s` | seconds (float) | 1 decimal place | Single stage or pipeline execution | `stage_complete`, `stage_error`, `pipeline_result` |
| `elapsed_s` | seconds (float) | 1 decimal place | Time since run start (`run_start_ts`) | `progress_snapshot` |
| `total_duration_s` | seconds (float) | 1 decimal place | Entire run (CLI entry to exit) | `run_end` |

### `duration_s`

Computed by the **node factory** (`nodes/__init__.py`) as the wallclock delta
between the `stage_start` timestamp and the `stage_complete`/`stage_error`
timestamp. Present on both `stage_complete` (success) and `stage_error`
(failure) — in the error case it represents the time elapsed before the
exception was raised. Also present on `pipeline_result` events where it is
derived from the `duration_ms` field stored by `ledger_complete_pipeline` on
the MCP server; it is `null` when `duration_ms` is not yet available on the
pipeline record.

### `elapsed_s`

Computed by the **supervisor** each iteration as
`(now - run_start_ts).total_seconds()`, rounded to 1 decimal. Provides a
running wall-clock for long orchestrator runs. Omitted (not set to `null`)
when `run_start_ts` is absent from state or cannot be parsed.

### `total_duration_s`

Computed by the **CLI** at run exit as
`(run_end_ts - run_start_ts).total_seconds()`, rounded to 1 decimal. Omitted
when `run_start_ts` was never stored in state or is unparseable.

---

## JSON Examples

### `stage_start`

```json
{"timestamp": "2026-03-22T10:05:00.123Z", "stage": "developer", "wp_id": "WP-003", "action": "stage_start", "level": "INFO", "iteration": 4}
```

### `stage_complete` (with `duration_s`)

```json
{"timestamp": "2026-03-22T10:08:24.456Z", "stage": "developer", "wp_id": "WP-003", "action": "stage_complete", "result": "PASS", "level": "INFO", "tokens_used": {"input_tokens": 12500, "output_tokens": 3400, "total_tokens": 15900}, "duration_s": 204.3}
```

### `stage_error` (with `duration_s`)

```json
{"timestamp": "2026-03-22T10:07:11.789Z", "stage": "qa", "wp_id": "WP-003", "action": "stage_error", "result": "FAIL", "level": "ERROR", "error": "MCP server returned unexpected response", "duration_s": 71.6}
```

### `pipeline_result`

```json
{"timestamp": "2026-03-22T10:08:25.012Z", "stage": "developer", "wp_id": "WP-003", "action": "pipeline_result", "level": "INFO", "pipeline_type": "implementation", "pipeline_status": "PASS", "files_modified": ["orchestrator/src/supervisor.py", "orchestrator/src/state.py"], "metrics": {"tests_passed": 42, "test_coverage": "88%"}, "summary": ["Added wp_status_change detection", "Added progress_snapshot emission"], "duration_s": 201.7}
```

### `wp_status_change`

```json
{"timestamp": "2026-03-22T10:08:26.000Z", "stage": "supervisor", "wp_id": "WP-003", "action": "wp_status_change", "level": "INFO", "old_status": "READY", "new_status": "IN_PROGRESS", "destination": ""}
```

### `wp_complete`

```json
{"timestamp": "2026-03-22T10:45:00.000Z", "stage": "supervisor", "wp_id": "WP-003", "action": "wp_complete", "level": "INFO", "destination": ""}
```

### `progress_snapshot`

> **Note:** `wps_completed_this_run` in this example shows the intended non-zero value. The current supervisor always emits `0` for this field — see the field table above.

```json
{"timestamp": "2026-03-22T10:45:01.000Z", "stage": "supervisor", "wp_id": "", "action": "progress_snapshot", "level": "INFO", "destination": "", "total_wps": 5, "status_breakdown": {"COMPLETE": 2, "IN_PROGRESS": 1, "READY": 2}, "pending": 3, "wps_completed_this_run": 2, "iteration": 18, "max_iterations": 100, "elapsed_s": 2401.3}
```

### `rework_detected`

```json
{"timestamp": "2026-03-22T10:30:00.000Z", "stage": "supervisor", "wp_id": "WP-004", "action": "rework_detected", "level": "INFO", "destination": "developer", "agent_role": "Developer", "pipeline_type": "implementation", "rework_count": 2}
```

### `route` (enriched with previous-stage context)

```json
{"timestamp": "2026-03-22T10:08:27.000Z", "stage": "supervisor", "wp_id": "WP-003", "action": "route", "level": "INFO", "destination": "qa", "prev_stage": "developer", "prev_wp_id": "WP-003", "prev_result": "PASS"}
```

### `run_start` (with `run_start_ts`)

```json
{"timestamp": "2026-03-22T10:00:01.000Z", "stage": "cli", "wp_id": "", "action": "run_start", "level": "INFO", "thread_id": "b3c7e1a2-4f5d-4a8b-9c0e-1d2f3a4b5c6d", "dry_run": false, "run_start_ts": "2026-03-22T10:00:01.000Z"}
```

### `run_end` (with `total_duration_s`)

```json
{"timestamp": "2026-03-22T11:12:34.000Z", "stage": "cli", "wp_id": "", "action": "run_end", "level": "INFO", "result": "COMPLETE", "thread_id": "b3c7e1a2-4f5d-4a8b-9c0e-1d2f3a4b5c6d", "total_duration_s": 4353.0}
```

### `heartbeat`

```json
{"timestamp": "2026-03-22T10:12:00.000Z", "stage": "heartbeat", "action": "heartbeat", "level": "INFO", "silence_s": 120.3}
```

### `dry_run_no_ledger`

```json
{"timestamp": "2026-03-23T17:38:51.000Z", "stage": "supervisor", "wp_id": "", "action": "dry_run_no_ledger", "level": "INFO", "destination": "pm", "detail": "Error: Root index not found — no project ledger exists at /path/to/project-ledger.json."}
```

### `dry_run_complete`

```json
{"timestamp": "2026-03-23T17:38:51.200Z", "stage": "supervisor", "wp_id": "", "action": "dry_run_complete", "level": "INFO", "destination": "__end__", "reason": "dry-run: PM stub executed; no ledger expected"}
```

### `tool_call` (with `tool_wp_id`; PM stage)

```json
{"timestamp": "2026-03-26T10:05:32.000000+00:00", "stage": "pm", "wp_id": "", "action": "tool_call", "level": "DEBUG", "tool_name": "ledger_create_work_package", "tool_wp_id": "WP-003"}
```

> **Note:** `tool_wp_id` is empty when the tool call does not include a `work_package_id` argument. Argument payloads are never logged — only `tool_name` and `tool_wp_id` are captured.

```json
{"timestamp": "2026-03-26T10:05:33.000000+00:00", "stage": "developer", "wp_id": "WP-003", "action": "tool_call", "level": "DEBUG", "tool_name": "ledger_complete_pipeline", "tool_wp_id": "WP-003"}
```

---

## Backward Compatibility

All new event types and enriched fields are **strictly additive**:

- **New event types** (`stage_start`, `wp_status_change`, `progress_snapshot`,
  `pipeline_result`, `wp_complete`, `rework_detected`, `dry_run_no_ledger`,
  `dry_run_complete`) — existing log consumers
  that filter by `action` (e.g. look for `stage_complete` only) will simply
  skip these new entries. No existing event type has been removed or renamed.
  In `--dry-run` mode, `mcp_error` is **replaced** by `dry_run_no_ledger`
  (INFO level) when the ledger is missing — this is a behavioural change for
  dry-run only; non-dry-run `mcp_error` events are unaffected.
- **New fields on existing events** (`duration_s` on `stage_complete` /
  `stage_error`, `run_start_ts` on `run_start`, `total_duration_s` on `run_end`,
  `prev_stage` / `prev_wp_id` / `prev_result` on `route`) — consumers that do
  not read these fields are unaffected. The fields are absent on events emitted
  by older orchestrator versions; consumers should guard with `entry.get("duration_s")`.
- **`total_duration_s` and `elapsed_s` are optional** — both are omitted (not
  set to `null`) when `run_start_ts` is absent from state. Consumers should
  use `entry.get("total_duration_s")` / `entry.get("elapsed_s")`.
- **Old JSONL files** retain their original schema. There is no migration
  requirement for historical log files.
