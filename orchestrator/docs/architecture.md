# Architecture Deep-Dive

> **Parent:** [orchestrator/README.md](../README.md)

This document covers the internal mechanics of stage nodes, MCP tool wrapping, and workflow state management. For the high-level graph topology and supervisor routing summary, see the [README](../README.md#architecture).

---

## Stage Nodes (Deep Agents)

Each stage node follows a uniform lifecycle managed by `create_stage_node()` in `src/nodes/__init__.py`:

1. **Load persona** — reads the persona Markdown from `personas/ledger/vs-code/<N>-<role>.md` (cached in memory after first load).
2. **Build prompt** — a stage-specific prompt builder assembles the user message from `WorkflowState` fields (e.g. `current_wp_id`, plan content).
3. **Wrap tools** — `inject_project_path(list(mcp_tools), project_path)` patches all MCP tools with the Layer 2 safety net (see below).
4. **Create Deep Agent** — `create_deep_agent(model, backend, system_prompt, tools)` with a `LocalShellBackend(root_dir=target_project_path)`.
5. **Invoke** — `agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]})`.
6. **Return state update** — `{"stage_result", "stage_success", "run_log"}` on success; adds `"errors"` on failure.

The supervisor's MCP tool calls handle all ledger mutations (start pipelines, complete pipelines, mark WPs COMPLETE).

### Individual Stage Modules

| Module | Factory | Key Behaviour |
|--------|---------|---------------|
| `src/nodes/pm.py` | `make_pm_node` | Reads plan file, initializes project, creates WPs |
| `src/nodes/developer.py` | `make_developer_node` | Calls `ledger_begin_work`, implements code, completes pipeline |
| `src/nodes/qa.py` | `make_qa_node` | Calls `ledger_begin_work`, runs tests, validates acceptance criteria |
| `src/nodes/reviewer.py` | `make_reviewer_node` | Calls `ledger_begin_work`, reviews code quality and architecture |
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

All 16 fields with their types and reducers are documented in the source: `orchestrator/src/state.py`.

---

## JSONL Log Entry Types

Each run writes a JSONL file to `orchestrator/logs/` (path printed at run start). Key entry types:

| `action` value | Emitted by | Key fields |
|---|---|---|
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result` (`"PASS"` / `"FAIL"`), `tokens_used` (dict or `null`) |
| `route` | `supervisor.py` | `stage`, `level` (`"INFO"` / `"WARNING"`), `destination` |
| `run_error` | `cli.py` | `stage="cli"`, `level="ERROR"`, `error` (message string), `thread_id` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `level` (`"INFO"` / `"ERROR"`), `thread_id` |

**`tokens_used`** on `stage_complete` entries: a dict with LangChain `usage_metadata` keys (`input_tokens`, `output_tokens`, `total_tokens`) when the LLM returns usage data, or `null` when metadata is absent (e.g. streaming responses or providers that omit token counts).

**`level`** on `run_end` entries: `"INFO"` when the workflow completed without error; `"ERROR"` when errors were captured in `outside_errors` before the run finished.

For the complete per-field type table, see [jsonl-log-schema.md](jsonl-log-schema.md).
