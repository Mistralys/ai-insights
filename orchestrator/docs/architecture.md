# Architecture Deep-Dive

> **Parent:** [orchestrator/README.md](../README.md)

This document covers the internal mechanics of stage nodes, MCP tool wrapping, and workflow state management. For the high-level graph topology and supervisor routing summary, see the [README](../README.md#architecture).

---

## Stage Nodes (Deep Agents)

Each stage node follows a uniform lifecycle managed by `create_stage_node()` in `src/nodes/__init__.py`:

1. **Emit `stage_start`** — records `timestamp`, `stage`, `wp_id`, and `iteration` before any LLM work begins.
2. **Load persona** — reads the persona Markdown from `personas/ledger/claude-code/<N>-<role>.md` (cached in memory after first load).
3. **Build prompt** — a stage-specific prompt builder assembles the user message from `WorkflowState` fields (e.g. `current_wp_id`, plan content).
4. **Wrap tools** — Four wrappers are applied in sequence: (a) `inject_project_path(list(mcp_tools), project_path)` auto-injects `project_path` as a Layer 2 safety net. (b) `restrict_to_wp(wrapped_tools, _wp_id)` enforces WP scope as a Layer 3 safety net — guards write tools only; read-only tools are exempt (no-op when `_wp_id` is empty). (c) `_install_begin_work_tracker(wrapped_tools, _begin_work_state)` mounts a tracker around `ledger_begin_work` to record when it fires and which pipeline type was requested (enables **Pipeline Rollback** on error; skipped when `_wp_id` is empty). (d) `log_tool_calls(wrapped_tools, stage, _wp_id, run_logger)` applies the outermost wrapper, emitting a `tool_call` JSONL event before each invocation. See **MCP Tool Wrapping** below for full descriptions.
5. **Create Deep Agent** — `create_deep_agent(model, backend, system_prompt, tools)` with a `LocalShellBackend(root_dir=target_project_path, inherit_env=True)`.
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

All six nodes use the same minimal Python pattern. Each module caches its template at import time with `_TEMPLATE = load_template("<stage>")` and passes only `project_path` and `wp_id` to `render_prompt`. Scope reminders, the path reminder text, and stage-specific instructions (e.g. the `ledger_begin_work` call reminder for `developer`) are embedded in the respective template files via `{{> partial-name}}` includes — they are not passed as Python variables.

```python
from src.nodes.prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("security_auditor")

def _build_security_auditor_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

This pattern applies identically to all six WP-scoped nodes — only the string passed to `load_template` differs. Template-level differences (e.g. the scope-restriction block in `developer`, `qa`, `reviewer`, `docs`; the begin-work reminder in `developer`) are expressed as different `{{> partial-name}}` includes in the respective `.md` template files, not as different Python variable dicts.

**PM template** (`pm` node)

The PM template is a documented exception. It omits `wp_id` entirely (the PM stage initialises a project, not a WP). The `{{> pm-preamble}}` partial provides the static preamble text and plan file reference; `plan_file` and `extra` (the full plan document content read from disk at invocation time) are the only runtime variables passed.

**Synthesis template** (`synthesis` node)

The synthesis template is the other documented exception: it omits `wp_id`, `plan_file`, and `extra` — only `project_path` is passed. Synthesis is project-scoped and operates across all completed work packages rather than a single WP.

### Field Reference

**Key:** ✅ = always passed · opt = optional · — = not used by this template

| Template | `project_path` | `wp_id` | `plan_file` | `extra` |
|---|:---:|:---:|:---:|:---:|
| `developer`, `qa`, `security_auditor`, `reviewer`, `release_engineer`, `docs` | ✅ | opt | — | — |
| `pm` | ✅ | — | ✅ | ✅ |
| `synthesis` | ✅ | — | — | — |

`wp_id` in WP-scoped templates: when non-empty, the template's `{{#if wp_id}}` blocks render the work package header, scope reminders, and stage-specific partials; when empty, those blocks are omitted.

For accepted values and usage patterns, see [`src/nodes/templates/VARIABLES.md`](../src/nodes/templates/VARIABLES.md).

### `project_path` Reminder

Every user-turn prompt includes a reminder to use the specified project path for all ledger tool calls. The reminder text lives in `templates/partials/project-path-reminder.md` and is injected into every stage template via `{{> project-path-reminder}}`.

**Why it exists:** Persona Markdown files are static and cannot embed runtime values like the concrete `project_path` for a given run. The user-turn prompt is the only place this runtime value can appear.

**Why it's permanent:** Removing the reminder risks the agent omitting `project_path` from MCP tool calls, causing every ledger operation to fail. The Layer 2 `inject_project_path()` tool wrapper (see **MCP Tool Wrapping** below) provides a fallback injection mechanism, but the user-turn reminder is the primary guide.

The reminder text is embedded directly in each template file via a partial include — it is not a Python constant and must not be added back to variable dicts.

### Template Partials

Shared prompt fragments live in `templates/partials/` and are included in stage templates using `{{> partial-name}}` syntax (filename without the `.md` extension). The renderer expands all includes before evaluating `{{#if}}` blocks and substituting variables, so partial content participates fully in all downstream processing.

One partial is currently defined:

| Partial file | Content | Included by |
|---|---|---|
| `project-path-reminder.md` | "Always use the project path above for all ledger tool calls." | All WP-scoped templates + `synthesis` (7 of 8 stage templates; `pm` inlines its preamble content directly) |

> **Note:** Earlier documentation described additional partials (`wp-scope-reminder.md`, `scope-restriction.md`, `begin-work-developer.md`, `pm-preamble.md`) that were planned but never created. The PM preamble and scope-restriction text are embedded directly in their respective template `.md` files rather than extracted into partial files.

To edit a shared fragment, change its partial file. To add new shared content, create a new file under `templates/partials/` and reference it with `{{> your-partial-name}}` in the relevant template(s).

---

### Module-Level Template Caching

Each stage node module caches its compiled template at import time using a module-level constant named `_TEMPLATE`:

```python
_TEMPLATE = load_template("security_auditor")
```

`load_template` reads the template file once per Python process (it maintains an internal cache). Assigning the result to `_TEMPLATE` at module scope makes the caching intent explicit and provides a consistent, greppable entry point in every stage module. The `_build_*_prompt()` function references `_TEMPLATE` directly:

```python
def _build_security_auditor_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

**Convention:** the constant must always be named `_TEMPLATE`. Storing it under a stage-specific name (e.g. `_SECURITY_AUDITOR_TEMPLATE`) or calling `load_template` inside `_build_*_prompt()` are both anti-patterns — the former breaks grep consistency, the latter obscures the caching intent even though `load_template` itself caches internally.

---

### Relationship to Persona Files

Persona source files live in `personas/ledger/claude-code/` (one `.md` file per agent role). They are compiled into the format expected by each orchestration surface using `node scripts/build-personas.js` (script lives at the workspace root — run it from there whenever you edit source files under `personas/ledger/src/`). **Never edit generated persona output files** — always edit the source files in `personas/ledger/src/` and rebuild.

The persona file is the single source of truth for what an agent does — its role identity, multi-step workflow, MCP tool usage instructions, rework handling, and handoff protocol. Any change to agent behaviour must be made in the persona source file, not in the Python `_build_*_prompt()` function.

---

## MCP Tool Wrapping (`src/utils/tool_wrappers.py`)

Three defensive wrapper functions are applied to every MCP tool in a stage node. They must be applied in this canonical order:

```
inject_project_path(tools, project_path)
    → restrict_to_wp(tools, wp_id)
        → log_tool_calls(tools, stage, wp_id, logger)
```

Each wrapper is **idempotent** (sentinel attributes prevent closure stacking) and handles both flat-dict and ToolCall `{"args": {...}}` input structures.

`inject_project_path(tools, project_path)` monkeypatches each tool's `ainvoke` to auto-inject `project_path` when the argument is absent from the tool call. It acts as a **Layer 2 safety net**: even if the LLM-driven agent ignores explicit prompt instructions to supply `project_path`, the argument still reaches the MCP server.

`restrict_to_wp(tools, wp_id)` is a **Layer 3 safety net** applied in WP-scoped stage nodes. For **write tools** it auto-injects the active `work_package_id` into any tool call that omits it, and guards against explicit cross-WP calls via a **2-strike soft-fail**: the first two cross-WP write attempts return a descriptive error string to the agent so it can self-correct, while the third violation raises `ValueError` (hard kill). This prevents a confused LLM from accidentally writing to the wrong work package while enabling self-healing. Passing an empty `wp_id` is a no-op (synthesis stages, which operate at project scope, are unaffected).

**Read-only tools are exempt.** Tools listed in `_READ_ONLY_TOOLS` (e.g. `ledger_get_work_package`, `ledger_list_work_packages`, `ledger_get_project_status`) skip the guard entirely — no `ainvoke` wrapper is installed, no WP ID is injected, and no cross-WP rejection occurs. This allows agents to read other work packages for context (pipeline comments, handoff notes, dependency status) without triggering a stage-level error. Only *write* operations (e.g. `ledger_begin_work`, `ledger_complete_pipeline`, `ledger_add_observation`) are guarded.

> **Single-WP-per-tool-instance invariant:** `restrict_to_wp` stores the original `ainvoke` on first wrap (sentinel `_orig_ainvoke_wp`). Tool instances **must not** be shared across concurrent pipeline stages that target different work packages — only the most recent guard's `wp_id` would be enforced. In the current pipeline design each tool instance is created fresh per stage node invocation, satisfying this invariant.

`log_tool_calls(tools, stage, wp_id, logger)` emits a `tool_call` JSONL event (via `WorkflowLogger.stream_entry()`) before forwarding each `ainvoke` call to the underlying MCP tool. Records `stage`, `wp_id` (stage-level), `tool_name`, and `tool_wp_id` (extracted from call arguments) at `level: "DEBUG"`. Full argument payloads are deliberately **excluded** (privacy constraint). When `logger` is `None` the function returns tools unchanged — no wrapping is applied (e.g. in unit tests).

**Prompt scope reinforcement** operates alongside the `restrict_to_wp` wrapper:

The `restrict_to_wp` tool wrapper (Layer 3 safety net) handles WP-scope enforcement at the tool level. The persona files themselves contain scope guidance as part of the agent's static instructions. The user-turn prompt adds only the `{{> project-path-reminder}}` partial to remind the agent of the concrete project path for this run. No additional scope partials are included in user-turn prompts — the persona file's static instructions provide scope awareness, and the tool wrapper enforces it programmatically.

### Design Properties

| Property | Detail |
|----------|--------|
| **Idempotent** | Each wrapper stores a sentinel attribute on the tool object on the first wrap (`_orig_ainvoke`, `_orig_ainvoke_wp`, `_orig_ainvoke_log`). Repeated calls — which occur because `list(mcp_tools)` in `node_fn` is a shallow copy referencing the same tool objects — always delegate to the true original `ainvoke`. Wrapper chains never grow beyond one level per wrapper. |
| **Non-destructive** | Only `ainvoke` is patched. All other attributes (`name`, `description`, `args_schema`) remain untouched, so schema introspection and tool discovery work normally. |
| **`setdefault` semantics** | An explicitly-provided `project_path` already present in the tool-call arguments is never overwritten by `inject_project_path`. Injection is also skipped when `cwd_path` is present (used by `ledger_detect_project`). |
| **Privacy** | `log_tool_calls` captures only `tool.name` and `work_package_id`; the full argument payload is never logged. |

---

## WorkflowState Fields

The full state is defined as a `TypedDict` in `src/state.py`. Key fields for understanding supervisor and stage-node behaviour:

| Field | Type | Description |
|-------|------|-------------|
| `current_wp_id` | `str` | ID of the work package currently being processed (e.g. `"WP-003"`). Empty string when no WP is active — specifically cleared to `""` by both synthesis routing paths in `supervisor.py` so that the `restrict_to_wp` guard does not activate during the project-scoped synthesis stage. |
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
| `tool_call` | `utils/tool_wrappers.py` | `stage`, `wp_id`, `tool_name`, `tool_wp_id`, `level="DEBUG"` — emitted before every MCP tool `ainvoke`; argument payload excluded (privacy) |
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
