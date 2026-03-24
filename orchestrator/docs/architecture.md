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
