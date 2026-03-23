# Orchestrator — API Surface

> **Parent:** [project-manifest/README.md](README.md) · **Detailed refs:** [public-api.md](../../public-api.md) · [jsonl-log-schema.md](../../jsonl-log-schema.md)

Quick-reference for public symbols, JSONL event types, and utility functions.
For complete signatures and full field descriptions see the linked documents above.

---

## JSONL Event Types — Logging Module (`src/utils/logging.py`)

The schema supports **17 event types** across three emitters. For the full field reference,
duration conventions, JSON examples, and backward-compatibility notes see
[jsonl-log-schema.md](../../jsonl-log-schema.md).

### Node factory events (`src/nodes/__init__.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `stage_start` | `stage`, `wp_id`, `iteration` | **New.** Emitted before Deep Agent creation. Always first entry in a stage's log sequence. |
| `stage_complete` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, **`duration_s`** | `duration_s` — wallclock seconds from `stage_start` to completion (float, 1 dp). |
| `stage_error` | `stage`, `wp_id`, `result="FAIL"`, `error`, **`duration_s`** | `duration_s` — time elapsed before the exception was raised. |
| `pipeline_result` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` | **New.** Best-effort read-back of latest WP pipeline after success. `duration_s` derived from `pipeline.duration_ms`; `null` when absent. Omitted on read-back failure. |

### Supervisor events (`src/supervisor.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `wp_status_change` | `wp_id`, `old_status`, `new_status` | **New.** Fired when a WP's status differs between consecutive iterations. |
| `wp_complete` | `wp_id` | **New.** Subset of `wp_status_change` — fired specifically on `→ COMPLETE` transitions. |
| `progress_snapshot` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, **`elapsed_s`**, `run_start_ts` (optional) | **New.** Emitted every iteration. `elapsed_s` — seconds since `run_start_ts`; omitted when `run_start_ts` absent. `run_start_ts` — echoes `WorkflowState.run_start_ts`; `None` when unavailable. |
| `rework_detected` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count` | **New.** Fired when supervisor dispatches a `REWORK` action. |
| `route` | `destination`, `agent_role`, `ledger_action`, **`prev_stage`**, **`prev_wp_id`**, **`prev_result`** | Enriched: `prev_stage`, `prev_wp_id`, `prev_result` (`"PASS"` / `"FAIL"` / `""`) added to provide previous-stage context. |

### Heartbeat events (`src/utils/logging.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `heartbeat` | `stage="heartbeat"`, `silence_s` | Emitted by `WorkflowLogger._heartbeat_loop` when no log entry has been written for `HEARTBEAT_INTERVAL_S` seconds. Console line: `[heartbeat] ♥ alive (quiet for 2m 0s)`. Configure via `HEARTBEAT_INTERVAL_S` env var (default `120`, `0` to disable). |

### CLI events (`src/cli.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `run_start` | `thread_id`, `dry_run`, `plan`, **`run_start_ts`** | Enriched: `run_start_ts` — ISO 8601 UTC timestamp stored in state for elapsed-time math. `plan` — resolved path of the plan file passed as `--plan`. |
| `run_end` | `result`, `thread_id`, **`total_duration_s`** | Enriched: `total_duration_s` — wallclock seconds for the full run (float, 1 dp); omitted when `run_start_ts` unavailable. |

### Duration field conventions

| Field | Scope | Present on |
|-------|-------|-----------|
| `duration_s` | Single stage or pipeline execution | `stage_complete`, `stage_error`, `pipeline_result` |
| `elapsed_s` | Time since run start | `progress_snapshot` |
| `total_duration_s` | Entire run | `run_end` |

All duration values are floats rounded to 1 decimal place.

---

## Utilities

### `src/utils/logging.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `WorkflowLogger` | `WorkflowLogger.create(label)` → context manager | JSONL + console logger. `stream_entry(entry)` writes a log entry dict to JSONL and emits event-type-specific console output. `log(...)` writes a freeform entry. `flush_unstreamed(run_log)` writes any `run_log` entries not already persisted via `stream_entry` (safety net for when the logger is unreachable inside graph nodes). `start_heartbeat(interval_s)` / `stop_heartbeat()` — async methods managing a background heartbeat task. |
| `_format_duration` | `_format_duration(seconds: float \| None) -> str` | Formats a float of seconds as a human-readable string. Examples: `"3m 24s"`, `"1h 12m"`, `"45s"`, `"0s"`. Returns `"0s"` for `None` or zero. Used internally by `stream_entry` for console output of `stage_complete`, `progress_snapshot`, and `pipeline_result` events. **Private** — not part of the public API but documented here as it drives all human-readable duration display. |
| `get_run_logger` | `get_run_logger(config) -> WorkflowLogger \| None` | Extracts the `WorkflowLogger` instance from a LangGraph `RunnableConfig`. Returns `None` when no logger is attached (e.g. in unit tests). |

### `src/utils/mcp_parse.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `parse_tool_response` | `parse_tool_response(raw: Any) -> dict \| list \| str \| None` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, `ToolMessage` objects, and direct dicts. Used by the supervisor's `_call_tool` helper and the node factory's `pipeline_result` read-back. |

---

## State Fields (progress-tracking additions)

These `WorkflowState` fields support the new event types. See
[architecture.md](../../architecture.md) for the full state schema.

| Field | Type | Description |
|-------|------|-------------|
| `prev_wp_summaries` | `list` | Previous supervisor iteration's WP summary list. Diffed against `wp_summaries` to emit `wp_status_change` / `wp_complete` events. |
| `run_start_ts` | `str` | ISO 8601 UTC timestamp of run start. Set once by CLI. Used to compute `elapsed_s` in `progress_snapshot` and `total_duration_s` in `run_end`. |
| `wps_completed_this_run` | `int` | WPs that transitioned to COMPLETE during this run. Included in `progress_snapshot`. |
