# Architecture Deep-Dive

> **Parent:** [orchestrator/README.md](../README.md)

This document covers the internal mechanics of stage nodes, MCP tool wrapping, and workflow state management. For the high-level graph topology and supervisor routing summary, see the [README](../README.md#architecture).

---

## Stage Nodes (Deep Agents)

Each stage node follows a uniform lifecycle managed by `create_stage_node()` in `src/nodes/__init__.py`:

1. **Emit `stage_start`** — records `timestamp`, `stage`, `wp_id`, and `iteration` before any LLM work begins.
2. **Load persona** — reads the persona Markdown from `personas/ledger/claude-code/<N>-<role>.md` (cached in memory after first load).
3. **Build prompt** — a stage-specific prompt builder assembles the user message from `WorkflowState` fields (e.g. `current_wp_id`, plan content).
4. **Wrap tools** — `inject_project_path(list(mcp_tools), project_path)` patches all MCP tools with the Layer 2 safety net (see below). `_install_begin_work_tracker(wrapped_tools, _begin_work_state)` then mounts a thin async wrapper around `ledger_begin_work` to record when it fires and which pipeline type was requested (see **Pipeline Rollback** below).
5. **Create Deep Agent** — `create_deep_agent(model, backend, system_prompt, tools)` with a `LocalShellBackend(root_dir=target_project_path)`.
6. **Invoke** — `agent.ainvoke({"messages": [{"role": "user", "content": user_prompt}]})`.
7. **Emit `stage_complete`** — records `result="PASS"`, `tokens_used`, and `duration_s` (wallclock seconds from step 1). On exception, emits **`stage_error`** with `result="FAIL"`, `error`, and `duration_s`, then runs the **pipeline rollback** path if `ledger_begin_work` was called (see **Pipeline Rollback** below).
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

### Pipeline Rollback (Orphaned Pipeline Cleanup)

When a stage node raises an exception *after* `ledger_begin_work` was called, the MCP ledger contains an orphaned `IN_PROGRESS` pipeline. Without cleanup, the next run attempt for the same WP receives a "duplicate in-progress pipeline" error from the MCP server.

The `except` block in `create_stage_node()` automatically resolves this:

1. **Detect invocation** — `_begin_work_state["called"]` is `True`, set by the `_install_begin_work_tracker` wrapper installed in step 4 of the lifecycle.
2. **Resolve pipeline type** — from `_begin_work_state["pipeline_type"]` (captured from the `type` argument passed to `ledger_begin_work`), or as a fallback from `_STAGE_PIPELINE_TYPE` keyed on the stage name.
3. **Cancel the orphan** — calls `ledger_cancel_pipeline` with `auto_cancelled=True`. The flag prevents this system-initiated cancellation from counting toward the rework budget.
4. **Emit `pipeline_rollback`** — appended to `run_log` and streamed immediately via `run_logger`.
5. **Preserve original error** — rollback is fire-and-forget; if cancellation itself raises, the failure is logged at `WARNING` level and the original `stage_error` is returned unchanged.

This mechanism activates automatically for any stage that uses `ledger_begin_work` — no per-stage configuration required.

---

## Prompt Architecture

The orchestrator's prompt system is built on a single design principle: **persona files own agent identity; user-turn prompts carry only runtime context.** This clean separation was established by the slim-prompts project and is now a permanent architectural constraint (see `orchestrator/docs/agents/project-manifest/constraints.md`, Constraints 1–3).

### Design Principle: Persona Owns Identity, User-Turn Owns Runtime Context

Each stage node loads a persona Markdown file from `personas/ledger/claude-code/` as the system prompt. These files are **static**: they contain the agent's identity declarations, step-by-step workflow instructions, and MCP tool call guidance — everything that does not change between runs. Persona files are never modified at runtime.

The user-turn prompt produced by `_build_*_prompt()` is **dynamic**: it contains only the concrete values the persona file cannot know — the `project_path` for this specific run, the `wp_id` for the current work package, and the injection-safety warning. Nothing else.

This boundary keeps persona files independently reviewable, versionable, and reusable across different orchestration surfaces (headless orchestrator, VS Code, etc.) without coupling them to Python implementation details.

### Three Prompt Templates

There are three structurally distinct user-turn prompt templates, one for each category of stage node:

**WP-scoped template** (6 nodes: `developer`, `qa`, `security_auditor`, `reviewer`, `release_engineer`, `docs`)

All six nodes share the minimal WP-scoped template. Each `_build_*_prompt()` function delegates to the centralized `build_stage_prompt()` helper in `src/nodes/__init__.py`:

```python
from . import build_stage_prompt

def _build_developer_prompt(state: WorkflowState) -> str:
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),
    )
```

Which produces:

```
**Project:** `/path/to/project`
**Work package:** WP-001

Always use the project path above for all ledger tool calls.
```

**PM template** (`pm` node)

The PM template is a documented exception: it embeds the full plan document content so the PM agent has the complete spec before creating work packages. It includes all WP-scoped fields plus a `# Plan Document` section with the full plan file text read from disk at invocation time.

**Synthesis template** (`synthesis` node)

The synthesis template is the other documented exception: it omits `wp_id` entirely because synthesis is project-scoped and operates across all completed work packages rather than a single WP.

### Field Reference

| Template | `project_path` | `wp_id` | `project_path` reminder | Plan document content |
|----------|:--------------:|:-------:|:------------------------:|:---------------------:|
| WP-scoped (×6) | ✅ | ✅ | ✅ | ❌ |
| PM | ✅ | ❌ | ✅ | ✅ |
| Synthesis | ✅ | ❌ | ✅ | ❌ |

### `project_path` Reminder

Every user-turn prompt includes a reminder to use the specified project path for all ledger tool calls. The reminder text is defined once in `build_stage_prompt()` (`src/nodes/__init__.py`), so changes only need to happen in one place.

**Why it exists:** Persona Markdown files are static and cannot embed runtime values like the concrete `project_path` for a given run. The user-turn prompt is the only place this runtime value can appear.

**Why it's permanent:** Removing the reminder risks the agent omitting `project_path` from MCP tool calls, causing every ledger operation to fail. The Layer 2 `inject_project_path()` tool wrapper (see **MCP Tool Wrapping** below) provides a fallback injection mechanism, but the user-turn reminder is the primary guide.

### Relationship to Persona Files

Persona source files live in `personas/ledger/claude-code/` (one `.md` file per agent role). They are compiled into the format expected by each orchestration surface using `node scripts/build-personas.js` (script lives at the workspace root — run it from there whenever you edit source files under `personas/ledger/src/`). **Never edit generated persona output files** — always edit the source files in `personas/ledger/src/` and rebuild.

The persona file is the single source of truth for what an agent does — its role identity, multi-step workflow, MCP tool usage instructions, rework handling, and handoff protocol. Any change to agent behaviour must be made in the persona source file, not in the Python `_build_*_prompt()` function.

---

## MCP Tool Wrapping (`src/utils/tool_wrappers.py`)

`inject_project_path(tools, project_path)` monkeypatches each tool's `ainvoke` to auto-inject `project_path` when the argument is absent from the tool call. It acts as a **Layer 2 safety net**: even if the LLM-driven agent ignores explicit prompt instructions to supply `project_path`, the argument still reaches the MCP server.

`restrict_to_wp(tools, wp_id)` is a **Layer 3 safety net** applied in WP-scoped stage nodes. It auto-injects the active `work_package_id` into any tool call that omits it, and raises `ValueError` on any tool call that explicitly passes a *different* `work_package_id`. This prevents a confused LLM from accidentally operating on the wrong work package. Passing an empty `wp_id` is a no-op (synthesis stages, which operate at project scope, are unaffected). Both wrappers are idempotent via sentinel attributes and handle flat-dict and ToolCall nested-dict structures.

> **Single-WP-per-tool-instance invariant:** `restrict_to_wp` stores the original `ainvoke` on first wrap (sentinel `_orig_ainvoke_wp`). Tool instances **must not** be shared across concurrent pipeline stages that target different work packages — only the most recent guard's `wp_id` would be enforced. In the current pipeline design each tool instance is created fresh per stage node invocation, satisfying this invariant.

The **Layer 3 prompt companion** is `_WP_SCOPE_REMINDER` (in `src/nodes/__init__.py`). `build_stage_prompt()` appends a `CRITICAL` scope line (`Every MCP tool call MUST use work_package_id={wp_id}`) to the user-turn prompt for any stage that has a non-empty `wp_id`. It reinforces the wrapper guard at the prompt level.

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
| `pipeline_rollback` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `level="INFO"` — emitted when error-path rollback successfully cancels an orphaned IN_PROGRESS pipeline |
| `wp_status_change` | `supervisor.py` | `wp_id`, `old_status`, `new_status`, `level="INFO"` |
| `wp_complete` | `supervisor.py` | `wp_id`, `level="INFO"` |
| `progress_snapshot` | `supervisor.py` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, `elapsed_s` (optional), `run_start_ts` |
| `rework_detected` | `supervisor.py` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count`, `level="INFO"` |
| `halted_wp_cancelled` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `destination`, `reason`, `level="WARNING"` — emitted for each halted WP cancelled before synthesis dispatch |
| `route` | `supervisor.py` | `destination`, `prev_stage`, `prev_wp_id`, `prev_result`, `level` (`"INFO"` / `"WARNING"`) |
| `run_error` | `cli.py` | `stage="cli"`, `level="ERROR"`, `error` (message string), `thread_id` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `level` (`"INFO"` / `"ERROR"`), `thread_id`, `total_duration_s` (float, optional — omitted if `run_start_ts` unavailable) |

**`tokens_used`** on `stage_complete` entries: a dict with LangChain `usage_metadata` keys (`input_tokens`, `output_tokens`, `total_tokens`) when the LLM returns usage data, or `null` when metadata is absent (e.g. streaming responses or providers that omit token counts).

**`level`** on `run_end` entries: `"INFO"` when the workflow completed without error; `"ERROR"` when errors were captured in `outside_errors` before the run finished.

For the complete per-field type table, see [jsonl-log-schema.md](jsonl-log-schema.md).
