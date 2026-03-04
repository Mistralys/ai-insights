# JSONL Log Schema

> **Parent:** [orchestrator/README.md](../README.md) · **Source of truth:** `orchestrator/src/utils/logging.py`

Every run writes a JSONL file to `orchestrator/logs/` (path printed at run start). Each line is a JSON object.

---

## Full Field Reference

| Field | Present In | Type | Description |
|-------|-----------|------|-------------|
| `timestamp` | all entries | ISO 8601 string | Wall-clock time of the event (UTC) |
| `stage` | all entries | string | Node/stage name (e.g. `"supervisor"`, `"developer"`, `"cli"`) |
| `wp_id` | stage events | string | Work package ID being processed (e.g. `"WP-003"`); empty string for supervisor-level events |
| `action` | all entries | string | Event type (e.g. `"route"`, `"stage_complete"`, `"halt"`, `"run_start"`, `"run_end"`) |
| `destination` | routing events | string | Next LangGraph node name (e.g. `"developer"`, `"__end__"`) |
| `result` | `stage_complete` | string | `"PASS"` or `"FAIL"` |
| `level` | all entries | string | `"INFO"` for normal events; `"WARNING"` for safety/circuit-breaker halts; `"ERROR"` for MCP or stage errors |
| `error` | error entries | string | Error message (only present when `level` is `"ERROR"`) |
| `tokens_used` | `stage_complete` | dict or null | `{"input_tokens": N, "output_tokens": N, "total_tokens": N}` when the LLM returns usage metadata; `null` when absent |
| `thread_id` | `run_start`, `run_end` | string | LangGraph thread identifier (UUID) for checkpoint/resume |
| `dry_run` | `run_start` | boolean | `true` when `--dry-run` flag was passed |
