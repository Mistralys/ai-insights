# Orchestrator - Documentation
_SOURCE: Technical deep-dives (architecture, routing, log schema, smoke tests, public API)_
# Technical deep-dives (architecture, routing, log schema, smoke tests, public API)
```
// Structure of documents
└── orchestrator/
    └── docs/
        └── architecture.md
        └── jsonl-log-schema.md
        └── public-api.md
        └── smoke-testing.md
        └── supervisor-routing.md

```
###  Path: `/orchestrator/docs/architecture.md`

```md
# Architecture Deep-Dive

> **Parent:** [orchestrator/README.md](../README.md)

This document covers the internal mechanics of stage nodes, MCP tool wrapping, and workflow state management. For the high-level graph topology and supervisor routing summary, see the [README](../README.md#architecture).

---

## Stage Nodes (Deep Agents)

Each stage node follows a uniform lifecycle managed by `create_stage_node()` in `src/nodes/__init__.py`:

1. **Emit `stage_start`** — records `timestamp`, `stage`, `wp_id`, and `iteration` before any LLM work begins.
2. **Load persona** — reads the persona Markdown from `personas/ledger/vs-code/<N>-<role>.md` (cached in memory after first load).
3. **Build prompt** — a stage-specific prompt builder assembles the user message from `WorkflowState` fields (e.g. `current_wp_id`, plan content).
4. **Wrap tools** — `inject_project_path(list(mcp_tools), project_path)` patches all MCP tools with the Layer 2 safety net (see below).
5. **Create Deep Agent** — `create_deep_agent(model, backend, system_prompt, tools)` with a `LocalShellBackend(root_dir=target_project_path)`.
6. **Invoke** — `agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]})`.
7. **Emit `stage_complete`** — records `result="PASS"`, `tokens_used`, and `duration_s` (wallclock seconds from step 1). On exception, emits **`stage_error`** instead with `result="FAIL"`, `error`, and `duration_s`.
8. **Best-effort `pipeline_result` read-back** — calls `ledger_get_work_package` using `wrapped_tools` to emit a `pipeline_result` event with `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, and `duration_s`. Any failure is caught silently at `DEBUG` level; stage success is never affected.
9. **Return state update** — `{"stage_result", "stage_success", "run_log"}` on success; adds `"errors"` on failure.

The supervisor's MCP tool calls handle all ledger mutations (start pipelines, complete pipelines, mark WPs COMPLETE).

### Individual Stage Modules

| Module | Factory | Key Behaviour |
|--------|---------|---------------|
| `src/nodes/pm.py` | `make_pm_node` | Reads plan file, initializes project, creates WPs |
| `src/nodes/developer.py` | `make_developer_node` | Calls `ledger_begin_work`, implements code, completes pipeline |
| `src/nodes/qa.py` | `make_qa_node` | Calls `ledger_begin_work`, runs tests, validates acceptance criteria |
| `src/nodes/security_auditor.py` | `make_security_auditor_node` | Calls `ledger_begin_work`, runs OWASP/dependency checks, completes security-audit pipeline |
| `src/nodes/reviewer.py` | `make_reviewer_node` | Calls `ledger_begin_work`, reviews code quality and architecture |
| `src/nodes/release_engineer.py` | `make_release_engineer_node` | Calls `ledger_begin_work`, curates the release, completes release-engineering pipeline |
| `src/nodes/docs.py` | `make_docs_node` | Calls `ledger_begin_work`, updates docs, handles auto-finalize |
| `src/nodes/synthesis.py` | `make_synthesis_node` | Calls `ledger_complete_synthesis`, writes `synthesis.md` |

---

## MCP Tool Wrapping (`src/utils/tool_wrappers.py`)

`inject_project_path(tools, project_path)` monkeypatches each tool's `ainvoke` to auto-inject `project_path` when the argument is absent from the tool call. It acts as a **Layer 2 safety net**: even if the LLM-driven agent ignores explicit prompt instructions to supply `project_path`, the argument still reaches the MCP server.

### Design Properties

| Property | Detail |
|----------|--------|
| **Idempotent** | A sentinel attribute `_orig_ainvoke` is stored on the tool object on the first wrap. Repeated calls — which occur because `list(mcp_tools)` in `node_fn` is a shallow copy referencing the same tool objects — always delegate to the true original `ainvoke`. Wrapper chains never grow beyond one level. |
| **Non-destructive** | Only `ainvoke` is patched. All other attributes (`name`, `description`, `args_schema`) remain untouched, so schema introspection and tool discovery work normally. |
| **`setdefault` semantics** | An explicitly-provided `project_path` already present in the tool-call arguments is never overwritten. Injection is also skipped when `cwd_path` is present (used by `ledger_detect_project`). |

---

## WorkflowState Fields

The full state is defined as a `TypedDict` in `src/state.py`. Key fields for understanding supervisor and stage-node behaviour:

| Field | Type | Description |
|-------|------|-------------|
| `consecutive_failures` | `dict` | Per-WP consecutive failure counter (`{wp_id: count}`). Reset on success. The supervisor halts a WP after ≥ 3 consecutive failures. |
| `run_log` | `list` (append-only) | JSONL-style log entries. Each entry carries a `level` field: `"INFO"` for normal routing, `"WARNING"` for safety/circuit-breaker halts, `"ERROR"` for MCP or stage errors. |
| `wps_completed_this_run` | `int` | Running total of work packages completed during this execution. Printed in the run summary. |
| `stage_success` | `bool` | Set by each stage node after execution. `True` = agent finished without exception. `False` = stage raised an error. Read by the supervisor circuit-breaker. |
| `pending_wp_count` | `int` | Count of WPs in a non-terminal status (not COMPLETE and not CANCELLED). Used by the supervisor to determine whether all work is done. |
| `prev_wp_summaries` | `list` | Previous supervisor iteration's WP summary list. Diffed against the current `wp_summaries` on each iteration to emit `wp_status_change` and `wp_complete` events. |
| `run_start_ts` | `str` | ISO 8601 timestamp of run start (UTC), captured by the CLI before the first log write. Used to compute `total_duration_s` in the `run_end` log entry. |

All 18 fields with their types and reducers are documented in the source: `orchestrator/src/state.py`.

---

## Platform Support

**Supported platforms:** Windows, macOS, and Linux. The orchestrator must work on all three.

- **File locking:** `src/utils/filelock.py` provides `lock_exclusive()` and `unlock()` using `msvcrt.locking` on Windows and `fcntl.flock` on Unix. No third-party dependencies.
- **Path handling:** Use `pathlib.Path` / `os.path.join()` — never hardcode separators.
- **Temp directories:** Tests must use `tempfile.mkdtemp()` — never hardcode `/tmp/`.
- **Shell commands:** The orchestrator invokes the MCP server via `node dist/index.js`. Ensure any subprocess invocations work on all three OSs (no Unix-only shell syntax).

See root `AGENTS.md` → Cross-Platform Policy for the full workspace-wide policy.

---

## JSONL Log Entry Types

Each run writes a JSONL file to `orchestrator/logs/` during execution. At run completion it is **copied** to `mcp-server/storage/ledger/{slug}/orchestrator/logs/` (path printed at run end); the original remains in `orchestrator/logs/` so that directory is never silently emptied. Key entry types:

| `action` value | Emitted by | Key fields |
|---|---|---|
| `stage_start` | `nodes/__init__.py` | `stage`, `wp_id`, `iteration` (int), `level="INFO"` |
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result="PASS"`, `tokens_used` (dict or `null`), `duration_s` (float) |
| `stage_error` | `nodes/__init__.py` | `stage`, `wp_id`, `result="FAIL"`, `error`, `duration_s` (float), `level="ERROR"` |
| `pipeline_result` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified` (list), `metrics` (dict or null), `summary` (list), `duration_s` (float or null) |
| `wp_status_change` | `supervisor.py` | `wp_id`, `old_status`, `new_status`, `level="INFO"` |
| `wp_complete` | `supervisor.py` | `wp_id`, `level="INFO"` |
| `progress_snapshot` | `supervisor.py` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, `elapsed_s` (optional), `run_start_ts` |
| `rework_detected` | `supervisor.py` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count`, `level="INFO"` |
| `route` | `supervisor.py` | `destination`, `prev_stage`, `prev_wp_id`, `prev_result`, `level` (`"INFO"` / `"WARNING"`) |
| `run_error` | `cli.py` | `stage="cli"`, `level="ERROR"`, `error` (message string), `thread_id` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `level` (`"INFO"` / `"ERROR"`), `thread_id`, `total_duration_s` (float, optional — omitted if `run_start_ts` unavailable) |

**`tokens_used`** on `stage_complete` entries: a dict with LangChain `usage_metadata` keys (`input_tokens`, `output_tokens`, `total_tokens`) when the LLM returns usage data, or `null` when metadata is absent (e.g. streaming responses or providers that omit token counts).

**`level`** on `run_end` entries: `"INFO"` when the workflow completed without error; `"ERROR"` when errors were captured in `outside_errors` before the run finished.

For the complete per-field type table, see [jsonl-log-schema.md](jsonl-log-schema.md).

```
###  Path: `/orchestrator/docs/jsonl-log-schema.md`

```md
# JSONL Log Schema

> **Parent:** [orchestrator/README.md](../README.md) · **Sources:** `orchestrator/src/utils/logging.py` (logger), `orchestrator/src/nodes/__init__.py` (stage events), `orchestrator/src/supervisor.py` (routing events), `orchestrator/src/cli.py` (run lifecycle events)

Every run writes a JSONL file to `orchestrator/logs/` during execution. At run completion it is **copied** to `mcp-server/storage/ledger/{slug}/orchestrator/logs/` (path printed at run end); the original remains in `orchestrator/logs/`. Each line is a JSON object. The schema supports **20 event types** across three emitters: the CLI (run lifecycle), the supervisor (routing and project progress), and stage nodes (pipeline execution).

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
| `dialogue_captured` | `nodes/__init__.py` | `stage`, `wp_id`, `file_path` (non-empty absolute path), `level="INFO"` — emitted by default; suppressed when `capture_dialogues=False` |
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
| `heartbeat` | `utils/logging.py` | `stage="heartbeat"`, `silence_s`, `level="INFO"` |
| `run_start` | `cli.py` | `stage="cli"`, `thread_id`, `dry_run`, `plan`, `run_start_ts` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `thread_id`, `total_duration_s` |
| `run_error` | `cli.py` | `stage="cli"`, `error`, `thread_id`, `level="ERROR"` |

### `stage_start` / `stage_complete` / `stage_error` ordering

For every stage invocation, three to five entries are written in order:

1. **`stage_start`** — emitted immediately before the Deep Agent is created
2. **`stage_complete`** (or **`stage_error`** on exception) — emitted after the agent finishes
3. **`pipeline_result`** *(optional)* — emitted after `stage_complete` when the WP still exists and carries at least one pipeline record; omitted on read-back failure or when `wp_id` is empty
4. **`dialogue_captured`** *(optional)* — emitted by default when `wp_id` is non-empty (suppressed when `capture_dialogues=False`); records the path of the Markdown dialogue file written to disk. A write failure is caught silently and this entry is omitted.

`pipeline_result.duration_s` will be `null` until `ledger_complete_pipeline` stores `duration_ms` in the WP record (separate MCP server work package).

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

```
###  Path: `/orchestrator/docs/public-api.md`

```md
# Public API / Entry Points

> **Parent:** [orchestrator/README.md](../README.md)

High-level list of the primary functions and classes meant for external use or extension.

---

## CLI Entry Point

| Symbol | Module | Description |
|--------|--------|-------------|
| `main(argv=None)` | `src.cli` | Script entry point (`orchestrate` command). Parses args, builds graph, runs workflow. |

---

## Graph Construction

| Symbol | Module | Description |
|--------|--------|-------------|
| `build_graph(config, mcp_tools, *, interrupt_before=None)` | `src.graph` | Assembles the 7-node LangGraph `StateGraph`, compiles with SQLite or in-memory checkpointer. Returns `CompiledGraph`. |

---

## Supervisor

| Symbol | Module | Description |
|--------|--------|-------------|
| `make_supervisor_node(mcp_tools, *, dry_run=False)` | `src.supervisor` | Factory returning the async `supervisor_node` function. Closes over MCP tools for testability. When `dry_run=True`, tolerates missing ledger state and terminates cleanly after one PM pass instead of looping. |

---

## Stage Node Factories

All follow the same pattern via `create_stage_node()`:

| Factory | Module | Stage |
|---------|--------|-------|
| `make_pm_node(config, mcp_tools)` | `src.nodes.pm` | `pm` |
| `make_developer_node(config, mcp_tools)` | `src.nodes.developer` | `developer` |
| `make_qa_node(config, mcp_tools)` | `src.nodes.qa` | `qa` |
| `make_security_auditor_node(config, mcp_tools)` | `src.nodes.security_auditor` | `security_auditor` |
| `make_reviewer_node(config, mcp_tools)` | `src.nodes.reviewer` | `reviewer` |
| `make_release_engineer_node(config, mcp_tools)` | `src.nodes.release_engineer` | `release_engineer` |
| `make_docs_node(config, mcp_tools)` | `src.nodes.docs` | `docs` |
| `make_synthesis_node(config, mcp_tools)` | `src.nodes.synthesis` | `synthesis` |

---

## MCP Client

| Symbol | Module | Description |
|--------|--------|-------------|
| `MCPToolkit` | `src.mcp_client` | Async context manager that starts and manages the MCP server subprocess. |
| `MCPToolkit.from_config(config)` | `src.mcp_client` | Factory: extracts `config.mcp_server_cmd` to create the toolkit. |
| `get_mcp_tools(config)` | `src.mcp_client` | Convenience coroutine returning the list of LangChain tool objects. |

---

## Configuration

| Symbol | Module | Description |
|--------|--------|-------------|
| `Config` | `src.config` | Dataclass holding all runtime settings (model, provider, paths, limits). Includes `capture_dialogues: bool` (default `True`) — set `CAPTURE_DIALOGUES=false` (or `0`/`no`) in the environment to disable dialogue capture. |
| `load_config(*, workspace_root=None)` | `src.config` | Loads `.env`, resolves provider, returns `Config`. |
| `get_chat_model()` | `src.config` | Returns the configured LangChain `BaseChatModel` instance. || `PIPELINE_PREREQUISITES` | `src.config` | `dict[str, str \| None]` — enforced pipeline execution order (prerequisite chain). Derived from `shared/workflow-manifest.json`. |
| `PIPELINE_AGENT_MAP` | `src.config` | `dict[str, str]` — pipeline type → owning agent role name. Derived from manifest. |
| `FAIL_ROUTING_AGENT_MAP` | `src.config` | `dict[str, str]` — pipeline type → agent role name responsible for FAIL rework. Derived from `pipelines.fail_routing` in `shared/workflow-manifest.json`. |
| `PIPELINE_ROLE_NAMES` | `src.config` | `list[str]` — non-orchestrating role names in manifest order. Used by the supervisor to derive `_ROLES` and `_ROLE_STAGE_MAP`. |
| `ROLE_IDS` | `src.config` | `dict[str, str]` — role name → role ID for every role (e.g. `'Project Manager'` → `'pm'`). Used by the supervisor to derive `_DEST_*` constants. |
| `WP_TERMINAL_STATUSES` | `src.config` | `frozenset[str]` — work-package statuses requiring no further agent action (`COMPLETE`, `CANCELLED`). Derived from manifest. |
| `NEXT_STAGE_MAP` | `src.config` | `dict[str, str]` — graph stage → next stage in sequential order (e.g. `'developer'` → `'qa'`). Derived from manifest. |
| `STAGE_TO_PIPELINE` | `src.config` | `dict[str, str]` — graph stage name → pipeline type it owns. Derived from manifest. |
| `PIPELINE_TO_STAGE` | `src.config` | `dict[str, str]` — inverse of `STAGE_TO_PIPELINE`. Derived from manifest. |
| `PERSONA_FILES` | `src.config` | `dict[str, str]` — stage ID → relative path to persona Markdown. Derived from manifest. |
| `PIPELINE_TYPES` | `src.config` | `tuple[str, ...]` — valid pipeline type names in canonical execution order. Derived from manifest. |
---

## Utilities

| Symbol | Module | Description |
|--------|--------|-------------|
| `inject_project_path(tools, project_path)` | `src.utils.tool_wrappers` | Monkeypatches `ainvoke` on each tool to auto-inject `project_path`. |
| `load_persona(stage)` | `src.utils.persona` | Reads and caches the persona Markdown for a given stage. |
| `parse_plan(path)` | `src.utils.plan_parser` | Extracts title, summary, and content from a plan `.md` file. Returns `PlanMetadata`. |
| `parse_tool_response(raw)` | `src.utils.mcp_parse` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, ToolMessage objects, and direct dicts. Returns `dict \| list \| str \| None`. |
| `WorkflowLogger` | `src.utils.logging` | JSONL + console logger. Use `WorkflowLogger.create(label=...)` context manager. `stream_entry(entry)` writes a pre-built log-entry dict to the JSONL file and emits rich, event-type-specific console output for `stage_start`, `stage_complete` (with duration + token count), `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`, and `dialogue_captured` (formatted as `[{stage}] {wp_id} dialogue saved → {filename}`); all other event types fall through to the generic `action → result` format. `log(...)` writes a freeform entry and emits a generic console line. `flush_unstreamed(run_log)` compares the count of entries already persisted via `stream_entry` against the full `run_log` list from the LangGraph state, and writes any un-persisted tail entries — this is the end-of-run safety net called by `cli.py` to guarantee JSONL completeness even when `get_run_logger()` returned `None` inside graph nodes. |
| `lock_exclusive(fd)` | `src.utils.filelock` | Acquire a non-blocking exclusive lock on an open file descriptor. Raises `OSError` on contention. Uses `msvcrt.locking` on Windows, `fcntl.flock` on Unix. **Windows invariant:** the lock file must be opened in `'w'` mode so the file pointer stays at 0. **Not re-entrant on Windows:** calling twice on the same fd without an intervening `unlock` raises `OSError(EACCES)`. |
| `unlock(fd)` | `src.utils.filelock` | Release the lock on an open file descriptor. Silently swallows `OSError` if the fd is not locked (idempotent). |
| `serialize_messages_to_markdown(messages, stage, wp_id, timestamp=None)` | `src.utils.dialogue_writer` | Convert a LangChain message sequence to a Markdown document. Renders a header table (stage/WP ID/timestamp), per-message `## Human` / `## Assistant` / `## Tool Result` / `## System` sections, tool call JSON in fenced code blocks, and an optional token-usage footer. Returns a `str`. |
| `write_dialogue(content, slug_dir, wp_id, stage)` | `src.utils.dialogue_writer` | Write *content* to `{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md`, creating the `orchestrator/dialogues/` subdirectory if needed. Revision number *N* is auto-incremented from existing files (first call writes `r0`). Returns the `Path` of the written file. |

```
###  Path: `/orchestrator/docs/smoke-testing.md`

```md
# Smoke-Testing the Dispatch Loop

> **Parent:** [orchestrator/README.md](../README.md)

Use this runbook to verify the supervisor dispatch loop is working correctly against a fresh ledger project without running the full agent pipeline.

> **Pre-flight:** Before any smoke test, run `node scripts/preflight-orchestrator.js` from the workspace root to verify the environment is ready (venv, `.env`, MCP dist). See [orchestrator/README.md](../README.md) for details.

---

## 1. Prepare a Test Ledger Project

Create a dedicated plan directory with 2–3 work packages in `READY` state and no in-flight pipelines. Use the MCP server tools (or create `.json` files directly under `.ledger/`) to initialise a minimal project:

```bash
# Example: use the orchestrator CLI in dry-run mode against an existing plan
orchestrate docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

Alternatively, use the Node.js launcher from the workspace root:

```bash
source orchestrator/.venv/bin/activate
node scripts/run-orchestrator.js docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

---

## 2. Expected Console Output (dry-run)

### With an existing ledger (WPs already created)

For a project with two `READY` WPs (WP-001, WP-002, no dependencies):

```
[INFO] Supervisor iteration 1: routing WP-001 → developer
[INFO] Supervisor iteration 2: routing WP-002 → developer
[INFO] Supervisor iteration 3: all WPs COMPLETE → synthesis
```

### Without a ledger (fresh plan, no project initialised)

The supervisor validates the PM routing path once and terminates cleanly:

```
[dry-run] Starting orchestrator in dry-run mode.
[dry-run] Plan   : /path/to/plan.md
[dry-run] Project: /path/to/project
[dry-run] Thread : <uuid>

  [dry-run] pm: WP=—
```

No MCP error messages appear — the missing ledger is expected and logged at INFO level (`dry_run_no_ledger`). The run exits with `Result: SUCCESS`.

In `--dry-run` mode no agents are called — only the routing decisions are executed.

---

## 3. Inspect the JSONL Log

The JSONL log is written to `orchestrator/logs/` during the run and **copied** to `mcp-server/storage/ledger/<slug>/orchestrator/logs/<timestamp>-<plan-title>.jsonl` at run completion (path printed at run end; the original remains in `orchestrator/logs/`). To verify routing decisions:

```bash
# Print all routing events
grep '"action": "route"' mcp-server/storage/ledger/<slug>/orchestrator/logs/<your-log-file>.jsonl | python3 -m json.tool

# Check for any WARNING or ERROR level entries
grep -E '"level": "(WARNING|ERROR)"' mcp-server/storage/ledger/<slug>/orchestrator/logs/<your-log-file>.jsonl

# Count stage dispatches
grep '"action": "route"' mcp-server/storage/ledger/<slug>/orchestrator/logs/<your-log-file>.jsonl | wc -l
```

---

## 4. Verifying Dispatch Correctness

| What to check | How |
|---|---|
| Correct first dispatch | First `"action": "route"` entry should have `"destination": "developer"` for a fresh WP |
| No duplicate dispatches | Each WP ID should appear at most once per routing sweep |
| Safety limit behaviour | Run with `--max-iterations 2`; verify the log ends with `"action": "safety_limit"` at `"level": "WARNING"` |
| Circuit-breaker halt | Manually set `consecutive_failures` ≥ 3 in state; verify `"action": "halted_repeated_failure"` |

```
###  Path: `/orchestrator/docs/supervisor-routing.md`

```md
# Supervisor Routing Model

> **Parent:** [orchestrator/README.md](../README.md) · **Source of truth:** `orchestrator/src/supervisor.py`

The supervisor is a pure-Python deterministic router — no LLM calls are made here. It delegates all routing decisions to the MCP server via **`ledger_get_next_action`** and returns a LangGraph `Command` routing the graph to the next stage.

`ledger_get_project_status` is called for observability context. `ledger_list_work_packages` is queried to detect two boundary conditions (empty project and all-terminal) before entering the per-role dispatch loop.

---

## Special Exits (checked first, in order)

```
supervisor_node
  ├─ iteration > max_iterations                      → __end__    (safety limit; level=WARNING)
  ├─ dry_run + get_project_status error               → __end__    (dry_run_no_ledger; level=INFO)
  ├─ dry_run + no WPs + iteration > 1                 → __end__    (dry_run_complete; level=INFO)
  ├─ No WPs in ledger                                 → pm         (create work packages)
  └─ All WPs terminal (COMPLETE or CANCELLED)         → synthesis  (final report)
```

### Dry-Run Mode

When `make_supervisor_node(mcp_tools, dry_run=True)` is used (set automatically by `--dry-run`), the supervisor tolerates missing ledger state:

- **Missing ledger errors** are logged at INFO level (`dry_run_no_ledger`) instead of WARNING/ERROR (`mcp_error`). No entries are added to the `errors` list.
- **First iteration with no WPs**: routes to PM (validates the routing path).
- **Second iteration with no WPs**: terminates cleanly to `__end__` (`dry_run_complete`) since PM stubs cannot create a ledger.
- **Existing ledger**: routing proceeds normally regardless of `dry_run`.

---

## Standard Routing (per role — first dispatchable action wins)

The supervisor calls `ledger_get_next_action` for each agent role in priority order
(`Project Manager` → `Developer` → `QA` → `Security Auditor` → `Reviewer` → `Release Engineer` → `Documentation`).
The **role** determines the destination; the **action** determines dispatch vs. skip:

```
For each role in priority order:
  action ∈ _SKIP_ACTIONS            → skip this role
    (_SKIP_ACTIONS includes WAIT, WAIT_FOR_REWORK, WAIT_FOR_DOWNSTREAM,
     WAIT_FOR_UPSTREAM_REWORK_LIMIT, BLOCK_FOR_REWORK_LIMIT)

  action not in _DISPATCH_ACTIONS    → treat as WAIT (forward-compatibility guard)

  action ∈ _DISPATCH_ACTIONS and circuit-breaker (≥ 3 consecutive failures)
                                     → skip WP, record WARNING entry

  action ∈ _DISPATCH_ACTIONS         → dispatch to role's stage:
    "Project Manager"   → pm               (_DISPATCH_ACTIONS includes REPAIR_ORPHAN_BLOCKED,
    "Developer"         → developer         UNBLOCK_WP, REVIEW_REWORK_LIMIT, REVIEW_STALE,
    "QA"                → qa                REVIEW_ABANDONED, IMPLEMENT, REWORK, CLAIM_WP,
    "Security Auditor"  → security_auditor  CONTINUE_PIPELINE, RESUME_OR_CANCEL, RUN_QA,
    "Reviewer"          → reviewer          RUN_SECURITY_AUDIT, RUN_REVIEW,
    "Release Engineer"  → release_engineer  RUN_RELEASE_ENGINEERING, WRITE_DOCS,
    "Documentation"     → docs              FINALIZE_WP, UPDATE_CRITERIA)

All roles returned WAIT/skip          → synthesis
```

> `_SKIP_ACTIONS`, `_DISPATCH_ACTIONS`, and `_ROLE_STAGE_MAP` in
> `orchestrator/src/supervisor.py` are the source of truth for the action-to-stage
> mapping. `_ROLE_STAGE_MAP` and `_ROLES` are now derived from the manifest-derived
> `PIPELINE_ROLE_NAMES` constant in `config.py`. Adding a new action from the MCP
> server only requires updating `_DISPATCH_ACTIONS` — no other routing logic changes
> are needed.

---

## Circuit-Breaker

The `consecutive_failures` field in `WorkflowState` tracks per-WP failure counts. Each supervisor pass:
- **Increments** the counter for the previous WP if `stage_success` is `False`.
- **Resets** the counter when `stage_success` is `True`.

A WP that accumulates **≥ 3 consecutive failures** is skipped for the remainder of the run (its `ledger_get_next_action` dispatch is bypassed). Skipped WPs do not terminate the run — the supervisor continues checking the remaining roles. Only when all roles return `WAIT` or are circuit-broken does the supervisor fall through to `synthesis`.

```