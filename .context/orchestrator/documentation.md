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
| `stage_start` | `nodes/__init__.py` | `stage`, `wp_id`, `iteration` (int), `model` (str), `level="INFO"` |
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result="PASS"`, `tokens_used` (dict or `null`), `duration_s` (float), `model` (str) |
| `stage_error` | `nodes/__init__.py` | `stage`, `wp_id`, `result="FAIL"`, `error`, `duration_s` (float), `model` (str), `level="ERROR"` |
| `pipeline_result` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified` (list), `metrics` (dict or null), `summary` (list), `duration_s` (float or null) |
| `pipeline_rollback` | `nodes/__init__.py` | `stage`, `wp_id`, `pipeline_type`, `level="INFO"` — emitted when error-path rollback successfully cancels an orphaned IN_PROGRESS pipeline |
| `tool_call` | `utils/tool_wrappers.py` | `stage`, `wp_id`, `tool_name`, `tool_wp_id`, `level="DEBUG"` — emitted before every MCP tool `ainvoke`; argument payload excluded (privacy) |
| `wp_status_change` | `supervisor.py` | `wp_id`, `old_status`, `new_status`, `level="INFO"` |
| `wp_complete` | `supervisor.py` | `wp_id`, `level="INFO"` |
| `progress_snapshot` | `supervisor.py` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, `elapsed_s` (optional), `run_start_ts` |
| `rework_detected` | `supervisor.py` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count`, `level="INFO"` |
| `halted_wp_cancelled` | `supervisor.py` | `stage="supervisor"`, `wp_id`, `destination`, `reason`, `level="WARNING"` — emitted for each halted WP cancelled before synthesis dispatch |
| `route` | `supervisor.py` | `destination`, `prev_stage`, `prev_wp_id`, `prev_result`, `level` (`"INFO"` / `"WARNING"`) |
| `run_start` | `cli.py` | `stage="cli"`, `thread_id`, `dry_run`, `plan`, `run_start_ts`, `stage_models` (dict) |
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
| `model` | `stage_start`, `stage_complete`, `stage_error` | string | API model slug used for this stage invocation (e.g. `"claude-sonnet-4-6"`). Sourced from `Config.stage_models`. |
| `stage_models` | `run_start` | dict | Map of stage name → model slug for the entire run (e.g. `{"developer": "claude-sonnet-4-6", ...}`). Mirrors `Config.stage_models`. |
| `tool_name` | `tool_call` | string | The MCP tool name from `tool.name` (e.g. `"ledger_create_work_package"`) |
| `tool_wp_id` | `tool_call` | string | The `work_package_id` argument extracted from the call arguments; empty string when absent. **Never** includes the full argument payload (privacy constraint). |
| `detail` | `dry_run_no_ledger` | string | The underlying error message from the missing ledger (logged at INFO, not treated as an error) |
| `reason` | `dry_run_complete` | string | Human-readable reason for clean termination (e.g. `"dry-run: PM stub executed; no ledger expected"`) |

---

## Action Values

| `action` | Emitted by | Key fields added |
|----------|-----------|------------------|
| `stage_start` | `nodes/__init__.py` | `stage`, `wp_id`, `iteration`, `model`, `level="INFO"` |
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, `duration_s`, `model` |
| `stage_error` | `nodes/__init__.py` | `stage`, `wp_id`, `result="FAIL"`, `error`, `duration_s`, `model`, `level="ERROR"` |
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
| `run_start` | `cli.py` | `stage="cli"`, `thread_id`, `dry_run`, `plan`, `run_start_ts`, `stage_models` |
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
{"timestamp": "2026-03-22T10:05:00.123Z", "stage": "developer", "wp_id": "WP-003", "action": "stage_start", "level": "INFO", "iteration": 4, "model": "claude-sonnet-4-6"}
```

### `stage_complete` (with `duration_s`)

```json
{"timestamp": "2026-03-22T10:08:24.456Z", "stage": "developer", "wp_id": "WP-003", "action": "stage_complete", "result": "PASS", "level": "INFO", "tokens_used": {"input_tokens": 12500, "output_tokens": 3400, "total_tokens": 15900}, "duration_s": 204.3, "model": "claude-sonnet-4-6"}
```

### `stage_error` (with `duration_s`)

```json
{"timestamp": "2026-03-22T10:07:11.789Z", "stage": "qa", "wp_id": "WP-003", "action": "stage_error", "result": "FAIL", "level": "ERROR", "error": "MCP server returned unexpected response", "duration_s": 71.6, "model": "claude-sonnet-4-6"}
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
| `build_graph(config, mcp_tools, *, interrupt_before=None)` | `src.graph` | Assembles the 9-node LangGraph `StateGraph`, compiles with SQLite or in-memory checkpointer. Returns `CompiledGraph`. |

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

## Template Renderer

Shared by all stage node modules to assemble user-turn prompts from `.md` templates.

| Symbol | Module | Description |
|--------|--------|-------------|
| `load_template(stage)` | `src.nodes.prompt_renderer` | Reads and caches the Markdown template for *stage* from `src/nodes/templates/{stage}.md`. Raises `FileNotFoundError` if the template does not exist. Cached in-process; subsequent calls for the same stage return the cached string. |
| `render_prompt(template, variables)` | `src.nodes.prompt_renderer` | Processes `{{#if var}}`…`{{/if}}` conditional blocks, substitutes `{variable}` placeholders (missing keys → empty string via `defaultdict(str)`), and collapses 3+ consecutive newlines to a single blank line. Returns the rendered string. |
| `clear_template_cache()` | `src.nodes.prompt_renderer` | Resets the in-memory template cache. Intended for test support only. |
| `load_partial(name)` | `src.nodes.prompt_renderer` | Reads and caches a Markdown partial for *name* from `src/nodes/templates/partials/{name}.md`. *name* must match `[\w-]+`; raises `ValueError` for invalid names (empty string, path separators, dots, spaces). Raises `FileNotFoundError` if the file is missing. Cached in-process alongside templates. |

For the expected `variables` dict for each template (required vs optional fields, conditional rules, and usage examples), see [`src/nodes/templates/VARIABLES.md`](../src/nodes/templates/VARIABLES.md).

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
| `Config` | `src.config` | Dataclass holding all runtime settings (paths, limits, stage model slugs). Includes `stage_models: dict[str, str]` (per-stage model slugs sourced from persona metadata) and `capture_dialogues: bool` (default `True`) — set `CAPTURE_DIALOGUES=false` (or `0`/`no`) in the environment to disable. |
| `Config.stage_models` | `src.config` | `dict[str, str]` — maps each stage name (e.g. `"developer"`) to its API model slug (e.g. `"claude-sonnet-4-6"`). Populated by `load_config()` via `extract_persona_model_slugs()`. |
| `Config.resolve_model_for_stage(stage)` | `src.config` | Returns the model slug for *stage*. Raises `KeyError` for unknown stage names (programming error — all valid stages are populated at config load time). |
| `load_config(*, workspace_root=None)` | `src.config` | Loads `.env`, reads per-stage model slugs from persona metadata via `extract_persona_model_slugs()`, validates API keys, returns `Config`. |
| `extract_persona_model_slugs(workspace_root)` | `src.utils.persona_models` | Scans `personas/ledger/src/meta/` YAML files and returns `{stage_id: model_slug}`. Per-persona `model_slug` takes precedence over `default_model_slug` from `_shared.yaml`. Used by `load_config()`. |
| `get_default_config()` | `src.config` | Returns (and lazily initialises) the module-level default `Config`. Prefer passing `Config` explicitly in testable code. |
| `PIPELINE_PREREQUISITES` | `src.config` | `dict[str, str \| None]` — enforced pipeline execution order (prerequisite chain). Derived from `shared/workflow-manifest.json`. |
| `PIPELINE_AGENT_MAP` | `src.config` | `dict[str, str]` — pipeline type → owning agent role name. Derived from manifest. |
| `FAIL_ROUTING_AGENT_MAP` | `src.config` | `dict[str, str]` — pipeline type → agent role name responsible for FAIL rework. Derived from `pipelines.fail_routing` in `shared/workflow-manifest.json`. |
| `PIPELINE_ROLE_NAMES` | `src.config` | `list[str]` — non-orchestrating role names in manifest order. Used by the supervisor to derive `_ROLES` and `_ROLE_STAGE_MAP`. |
| `ROLE_IDS` | `src.config` | `dict[str, str]` — role name → role ID for every role (e.g. `'Project Manager'` → `'pm'`). Used by the supervisor to derive `_DEST_*` constants. |
| `WP_TERMINAL_STATUSES` | `src.config` | `frozenset[str]` — work-package statuses requiring no further agent action (`COMPLETE`, `CANCELLED`). Derived from manifest. |
| `VALID_STAGES` | `src.config` | `frozenset[str]` — all non-orchestrating stage IDs. Used to guard stage resolution at config load time. |
| `NEXT_STAGE_MAP` | `src.config` | `dict[str, str]` — graph stage → next stage in sequential order (e.g. `'developer'` → `'qa'`). Derived from manifest. |
| `STAGE_TO_PIPELINE` | `src.config` | `dict[str, str]` — graph stage name → pipeline type it owns. Derived from manifest. |
| `PIPELINE_TO_STAGE` | `src.config` | `dict[str, str]` — inverse of `STAGE_TO_PIPELINE`. Derived from manifest. |
| `PERSONA_FILES` | `src.config` | `dict[str, str]` — stage ID → relative path to persona Markdown. Derived from manifest. |
| `PIPELINE_TYPES` | `src.config` | `tuple[str, ...]` — valid pipeline type names in canonical execution order. Derived from manifest. |

## Utilities

| Symbol | Module | Description |
|--------|--------|-------------|
| `inject_project_path(tools, project_path)` | `src.utils.tool_wrappers` | Monkeypatches `ainvoke` on each tool to auto-inject `project_path`. |
| `restrict_to_wp(tools, wp_id)` | `src.utils.tool_wrappers` | Layer 3 WP-scope guard for **write tools only**: auto-injects `work_package_id` when absent; soft-fails cross-WP calls (2 strikes) before raising `ValueError`. Read-only tools (listed in `_READ_ONLY_TOOLS`) are exempt — no injection, no rejection. No-op when `wp_id` is empty (synthesis stages). |
| `log_tool_calls(tools, stage, wp_id, logger)` | `src.utils.tool_wrappers` | Emits a `tool_call` JSONL event before each `ainvoke` call. Records `stage`, `wp_id`, `tool_name`, and `tool_wp_id`; argument payload excluded (privacy). No-op when `logger` is `None`. Apply last in the wrapper chain: `inject_project_path → restrict_to_wp → log_tool_calls`. |
| `load_persona(stage)` | `src.utils.persona` | Reads and caches the persona Markdown for a given stage. |
| `parse_plan(path)` | `src.utils.plan_parser` | Extracts title, summary, and content from a plan `.md` file. Returns `PlanMetadata`. |
| `parse_tool_response(raw)` | `src.utils.mcp_parse` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, ToolMessage objects, and direct dicts. Returns `dict \| list \| str \| None`. |
| `WorkflowLogger` | `src.utils.logging` | JSONL + console logger. Use `WorkflowLogger.create(label=...)` context manager. `stream_entry(entry)` writes a pre-built log-entry dict to the JSONL file and emits rich, event-type-specific console output for 9 named action types: `stage_start`, `stage_complete` (with duration + token count), `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`, `dialogue_captured` (formatted as `[{stage}] {wp_id} dialogue saved → {filename}`), and `tool_call` (formatted as `[{stage}] 🔧 {tool_name} ({tool_wp_id})`, parenthetical omitted when `tool_wp_id` is empty); all other event types fall through to the generic `action → result` format. `log(...)` writes a freeform entry and emits a generic console line. `flush_unstreamed(run_log)` compares the count of entries already persisted via `stream_entry` against the full `run_log` list from the LangGraph state, and writes any un-persisted tail entries — this is the end-of-run safety net called by `cli.py` to guarantee JSONL completeness even when `get_run_logger()` returned `None` inside graph nodes. |
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

> **State clearing on synthesis routes:** Both synthesis routing paths (all-WPs-terminal and all-roles-WAIT) explicitly set `"current_wp_id": ""` in their `Command` update dicts. This ensures the `restrict_to_wp` tool wrapper does not activate in the synthesis stage, which is project-scoped and must not be constrained to a single WP. A stale `current_wp_id` (left over from the preceding stage) would otherwise cause every MCP tool call in synthesis to trigger cross-WP violations.

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

> **State clearing on synthesis fall-through:** Like the all-WPs-terminal path, this path also sets `"current_wp_id": ""` in the `Command` update dict to prevent the `restrict_to_wp` guard from activating in synthesis.

> **Test coverage gap (known):** The existing `test_supervisor.py` synthesis routing tests assert `goto == "synthesis"` but do not assert `current_wp_id == ""` in the Command update dict. Dedicated assertions verifying both synthesis paths clear `current_wp_id` (including with a stale non-empty value in input state) are missing and should be added in a follow-up task.

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