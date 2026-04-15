# Orchestrator — API Surface

> **Parent:** [project-manifest/README.md](README.md) · **Detailed refs:** [public-api.md](../../public-api.md) · [jsonl-log-schema.md](../../jsonl-log-schema.md)

Quick-reference for public symbols, JSONL event types, and utility functions.
For complete signatures and full field descriptions see the linked documents above.

---

## JSONL Event Types — Logging Module (`src/utils/logging.py`)

The schema supports **23 event types** across three emitters. For the full field reference,
duration conventions, JSON examples, and backward-compatibility notes see
[jsonl-log-schema.md](../../jsonl-log-schema.md).

### Node factory events (`src/nodes/__init__.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `stage_start` | `stage`, `wp_id`, `iteration`, `model` | **New.** Emitted before Deep Agent creation. Always first entry in a stage's log sequence. |
| `stage_complete` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, **`duration_s`**, `model` | `duration_s` — wallclock seconds from `stage_start` to completion (float, 1 dp). |
| `stage_error` | `stage`, `wp_id`, `result="FAIL"`, `error`, **`duration_s`**, `model` | `duration_s` — time elapsed before the exception was raised. |
| `pipeline_result` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` | **New.** Best-effort read-back of latest WP pipeline after success. `duration_s` derived from `pipeline.duration_ms`; `null` when absent. Omitted on read-back failure. |
| `pipeline_rollback` | `stage`, `wp_id`, `pipeline_type`, `level="INFO"` | Emitted when error-path rollback successfully cancels an orphaned IN_PROGRESS pipeline after an unhandled stage exception. Only fires when `ledger_begin_work` was called before the crash. |

#### Node factory private helpers (`src/nodes/__init__.py`)

Module-level helper functions extracted from `node_fn()` for readability.
All are private (prefixed `_`) but documented here for agent navigation.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `_build_start_log_entry` | `(stage, wp_id, model, iteration, timestamp) -> dict` | Constructs the `stage_start` JSONL log entry dict. |
| `_build_success_log_entry` | `(stage, wp_id, model, tokens_used, duration_s, timestamp) -> dict` | Constructs the `stage_complete` JSONL log entry dict. |
| `_build_error_log_entry` | `(stage, wp_id, model, exc, duration_s, timestamp) -> dict` | Constructs the `stage_error` JSONL log entry dict. |
| `_accumulate_stream` | `async (agent, user_prompt, slug_dir, wp_id, stage) -> tuple[list, Path \| None]` | Runs the `astream()` loop, writes JSONL chunks via `ChunkWriter`, accumulates and reconstructs `msgs` in stream order. Returns `(msgs, chunk_file_path)`. Closes `ChunkWriter` in `finally` so partial messages survive stream errors. |
| `_handle_rollback` | `async (begin_work_state, complete_pipeline_state, wp_id, wrapped_tools, stage, exc, run_logger) -> list[dict]` | Cancels any orphaned IN_PROGRESS pipeline using `ledger_cancel_pipeline` when `ledger_begin_work` fired before the error but `ledger_complete_pipeline` did not succeed. Returns zero or one `pipeline_rollback` log entry dicts. |
| `_read_pipeline_result` | `async (wp_id, wrapped_tools, stage, project_path, run_logger) -> list[dict]` | Best-effort read-back of the latest WP pipeline via `ledger_get_work_package`. Swallows all exceptions (logged at DEBUG). Returns zero or one `pipeline_result` log entry dicts. |

### Tool wrapper events (`src/utils/tool_wrappers.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `tool_call` | `stage`, `wp_id`, `tool_name`, `tool_wp_id`, `level="DEBUG"` | Emitted before every MCP tool `ainvoke` by `log_tool_calls()`. `tool_wp_id` is extracted from call arguments; the full argument payload is **never** logged (privacy constraint). Filtered out of normal console output due to `level: DEBUG`. |

### Supervisor events (`src/supervisor.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `wp_status_change` | `wp_id`, `old_status`, `new_status` | **New.** Fired when a WP's status differs between consecutive iterations. |
| `wp_complete` | `wp_id` | **New.** Subset of `wp_status_change` — fired specifically on `→ COMPLETE` transitions. |
| `progress_snapshot` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, **`elapsed_s`**, `run_start_ts` (optional) | **New.** Emitted every iteration. `elapsed_s` — seconds since `run_start_ts`; omitted when `run_start_ts` absent. `run_start_ts` — echoes `WorkflowState.run_start_ts`; `None` when unavailable. |
| `rework_detected` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count` | **New.** Fired when supervisor dispatches a `REWORK` action. |
| `halted_wp_cancelled` | `stage="supervisor"`, `wp_id`, `destination`, `reason`, `level="WARNING"` | Emitted for each halted WP transitioned to CANCELLED before synthesis dispatch (when all remaining WPs exceeded the 3-consecutive-failure threshold). |
| `route` | `destination`, `agent_role`, `ledger_action`, **`prev_stage`**, **`prev_wp_id`**, **`prev_result`** | Enriched: `prev_stage`, `prev_wp_id`, `prev_result` (`"PASS"` / `"FAIL"` / `""`) added to provide previous-stage context. |
| `dry_run_no_ledger` | `destination`, `detail` | **New.** Emitted in `--dry-run` mode when the ledger is missing (expected). Replaces `mcp_error` at INFO level. |
| `dry_run_complete` | `destination=END`, `reason` | **New.** Emitted in `--dry-run` mode on second iteration with no WPs — clean termination signal. |

### Heartbeat events (`src/utils/logging.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `heartbeat` | `stage="heartbeat"`, `silence_s` | Emitted by `WorkflowLogger._heartbeat_loop` when no log entry has been written for `HEARTBEAT_INTERVAL_S` seconds. Console line: `[heartbeat] ♥ alive (quiet for 2m 0s)`. Configure via `HEARTBEAT_INTERVAL_S` env var (default `120`, `0` to disable). |

### CLI events (`src/cli.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `run_start` | `thread_id`, `dry_run`, `plan`, **`run_start_ts`**, `stage_models` | Enriched: `run_start_ts` — ISO 8601 UTC timestamp stored in state for elapsed-time math. `plan` — resolved path of the plan file passed as `--plan`. `stage_models` — snapshot of `Config.stage_models` at run start (dict of stage name → model slug). |
| `signal_shutdown` | `stage="cli"`, `result="INTERRUPTED"`, `level="WARNING"`, `thread_id` | Emitted when SIGTERM/SIGINT triggers the graceful shutdown race path in `_run()`. The graph task is cancelled, the run is **not** marked terminal (resumable via `--resume`), and the process exits with code `1`. Integration-tested by `TestSignalInterruptedRun` in `tests/test_cli.py` (Unix-only; skipped on Windows). |
| `run_end` | `result`, `thread_id`, **`total_duration_s`** | Enriched: `total_duration_s` — wallclock seconds for the full run (float, 1 dp); omitted when `run_start_ts` unavailable. |

### Duration field conventions

| Field | Scope | Present on |
|-------|-------|-----------|
| `duration_s` | Single stage or pipeline execution | `stage_complete`, `stage_error`, `pipeline_result` |
| `elapsed_s` | Time since run start | `progress_snapshot` |
| `total_duration_s` | Entire run | `run_end` |

All duration values are floats rounded to 1 decimal place.

---

## Template Renderer (`src/nodes/prompt_renderer.py`)

Shared by all stage node modules to assemble user-turn prompts from `.md` templates.
Template files live at `src/nodes/templates/<stage>.md`.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `load_template` | `load_template(stage: str) -> str` | Reads and caches the Markdown template for *stage* from `src/nodes/templates/{stage}.md`. *stage* must match `[\w-]+`; raises `ValueError` for invalid names (empty string, path separators, dots, spaces). Raises `FileNotFoundError` if the file is missing. Cached in-process; subsequent calls for the same stage bypass disk I/O. |
| `render_prompt` | `render_prompt(template: str, variables: dict[str, str]) -> str` | Four-step pipeline: (0) resolve `{{> partial-name}}` include directives — partials are expanded with one additional pass for nested `{{> ...}}` within partial content (one level deep; directives inside second-level partials are not resolved); (1) evaluate `{{#if var}}`…`{{/if}}` conditional blocks; (2) substitute `{variable}` placeholders (`defaultdict(str)` fallback for missing keys); (3) collapse 3+ consecutive newlines to one blank line. |
| `clear_template_cache` | `clear_template_cache() -> None` | Resets the in-memory cache. For test use only. |
| `load_partial` | `load_partial(name: str) -> str` | Reads and caches a Markdown partial for *name* from `src/nodes/templates/partials/{name}.md`. *name* must match `[\w-]+`; raises `ValueError` for invalid names (empty string, path separators, dots, spaces). Raises `FileNotFoundError` if the file is missing. Cached in-process alongside templates. |

### Template Partials (`src/nodes/templates/partials/`)

Shared Markdown fragments included in stage templates via `{{> partial-name}}`. Variables
listed are resolved from the enclosing template's variable dict after inlining.

| Partial file | Placeholder variables | Used by |
|---|---|---|
| `project-path-reminder.md` | _(none)_ | All WP-scoped templates + `synthesis` (7 of 8; `pm` inlines its content) |

---

## Utilities

### `src/utils/logging.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `WorkflowLogger` | `WorkflowLogger.create(label)` → context manager | JSONL + console logger. `stream_entry(entry)` writes a log entry dict to JSONL and emits event-type-specific console output for 9 named action types: `stage_start`, `stage_complete` (with duration + token count), `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`, `dialogue_captured`, and `tool_call` (`[stage] 🔧 tool_name (tool_wp_id)`, parenthetical omitted when `tool_wp_id` is empty); all other event types fall through to the generic `action → result` format. `log(...)` writes a freeform entry. `flush_unstreamed(run_log)` writes any `run_log` entries not already persisted via `stream_entry` (safety net for when the logger is unreachable inside graph nodes). `start_heartbeat(interval_s)` / `stop_heartbeat()` — async methods managing a background heartbeat task. |
| `_format_duration` | `_format_duration(seconds: float \| None) -> str` | Formats a float of seconds as a human-readable string. Examples: `"3m 24s"`, `"1h 12m"`, `"45s"`, `"0s"`. Returns `"0s"` for `None` or zero. Used internally by `stream_entry` for console output of `stage_complete`, `progress_snapshot`, and `pipeline_result` events. **Private** — not part of the public API but documented here as it drives all human-readable duration display. |

---

### `src/utils/_revision.py`

Shared revision-numbering helper used by both `chunk_writer.py` and `dialogue_writer.py`.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `next_revision` | `next_revision(directory: Path, wp_id: str, stage: str, ext: str) -> int` | Globs `{wp_id}-{stage}-r*{ext}` in *directory*, parses revision numbers from matching filenames, and returns `max + 1` (or `0` when no prior files exist). `ext` includes the leading dot (e.g. `".jsonl"`, `".md"`). |

---

### `src/utils/chunk_writer.py`

Writes raw LangGraph stream chunks to JSONL files in the project's `orchestrator/chunks/` subdirectory. Used during streaming stages to persist the full token-level stream for later GUI rendering via the MCP server's `chunk-renderer.ts`.

**JSONL file layout**

| Line | Content |
|------|---------|
| 0 (header) | `{"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}` |
| 1–N (chunks) | One JSON object per streaming event (e.g. `{"type": "ai", "content": "…", …}`) |

**File naming convention:** `{wp_id}-{stage}-r{N}.jsonl` (revision `N` auto-increments — mirrors `dialogue_writer.write_dialogue`). Files are written to `{slug_dir}/orchestrator/chunks/`.

**Module-level constant**

| Symbol | Value | Notes |
|--------|-------|-------|
| `_CHUNK_HEADER` | `MappingProxyType({"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"})` | Written as line 0 of every chunk file. Immutable at runtime (`MappingProxyType`). Shared singleton across all `ChunkWriter` instances. |

**`ChunkWriter` class**

```python
class ChunkWriter:
    def __init__(self, slug_dir: Path, wp_id: str, stage: str) -> None: ...
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `slug_dir` | `Path` | Root directory for the project's ledger storage (e.g. `{workspace_root}/mcp-server/storage/ledger/{slug}`). |
| `wp_id` | `str` | Work-package identifier (e.g. `"WP-001"`). |
| `stage` | `str` | Pipeline stage name (e.g. `"developer"`). |

Raises `OSError` if the `orchestrator/chunks/` directory cannot be created or the file cannot be opened. Opens (or creates) the JSONL file and writes the version-header line immediately on construction.

**Public methods**

| Method | Signature | Description |
|--------|-----------|-------------|
| `path` *(property)* | `-> Path` | Absolute path to the JSONL file being written. |
| `write_chunk` | `write_chunk(chunk: dict[str, Any]) -> None` | Appends *chunk* as a JSON line and flushes immediately. Both `OSError` (file I/O) and `TypeError` (non-serialisable values) are caught and logged at `DEBUG` — the caller is never interrupted. No-op when the writer is closed. |
| `close` | `close() -> None` | Closes the underlying file handle. Idempotent — safe to call more than once. |

**Context manager usage**

```python
from pathlib import Path
from src.utils.chunk_writer import ChunkWriter

with ChunkWriter(slug_dir=Path("/storage/my-project"), wp_id="WP-001", stage="developer") as cw:
    for chunk in stream:
        cw.write_chunk(chunk)

# path property exposes the file that was written
print(cw.path)
```

`__enter__` returns `self`; `__exit__` calls `close()`.
| `get_run_logger` | `get_run_logger(config) -> WorkflowLogger \| None` | Extracts the `WorkflowLogger` instance from a LangGraph `RunnableConfig`. Returns `None` when no logger is attached (e.g. in unit tests). |

### `src/utils/mcp_parse.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `parse_tool_response` | `parse_tool_response(raw: Any) -> dict \| list \| str \| None` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, `ToolMessage` objects, and direct dicts. Used by the supervisor's `_call_tool` helper and the node factory's `pipeline_result` read-back. |

### `src/utils/persona_models.py`

Stdlib-only utility that reads persona YAML metadata and returns the API model slug for
each orchestrator stage. Uses hand-rolled `_extract_yaml_scalar()` / `_extract_yaml_list()` /
`_strip_inline_comment()` helpers to avoid a PyYAML dependency.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `find_ledger_yaml_for_stage` | `find_ledger_yaml_for_stage(stage_id: str, workspace_root: Path \| str) -> tuple[Path, str] \| None` | Locates the ledger persona YAML file for *stage_id*. Reads `shared/workflow-manifest.json` to map *stage_id* to a role number, then scans `personas/ledger/src/meta/[1-9]-*.yaml` for the matching file. Returns a `(yaml_path, yaml_text)` tuple, or `None` if *stage_id* is not in the manifest or no matching YAML file exists. **Constraint:** the glob pattern `[1-9]-*.yaml` only matches single-digit numeric prefixes (roles 1–9); a role file with prefix `10-` or higher would be silently skipped. Consumed by `extract_persona_model_slugs()` and `load_subagents()` (via `subagents.py`). |
| `extract_persona_model_slugs` | `extract_persona_model_slugs(workspace_root: Path \| str) -> dict[str, str]` | Resolves the API model slug for every orchestrator stage. Resolution order: (1) per-persona `model_slug` field if present; (2) `default_model_slug` from `_shared.yaml`. Delegates per-stage file lookup to `find_ledger_yaml_for_stage()`. Returns a `{stage_id: model_slug}` mapping — one entry per manifest role that has a matching YAML file; roles with no YAML file are skipped with a `WARNING` log. Raises `OSError` if the metadata directory does not exist; `FileNotFoundError` if `_shared.yaml` or `workflow-manifest.json` is missing; `ValueError` if `default_model_slug` is absent from `_shared.yaml` or the `roles` key is missing from the manifest. |
| `_extract_yaml_list` | `_extract_yaml_list(text: str, key: str) -> list[str]` | **Private helper.** Parses a flat dash-prefixed block list under *key* from raw YAML *text*. Handles block lists (`key:\n  - item1\n  - item2`), missing keys (returns `[]`), empty keys (returns `[]`), quoted item values (strips outer single or double quotes), and inline comments (stripped from each item). Returns `[]` when *key* has an inline scalar value rather than a block list. Only processes top-level keys — nested structures are not supported. Used by `load_subagents()` to read the `subagents` field from the PM persona YAML. |

---

### `src/config.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `Config` | `@dataclass Config` | Immutable configuration bundle populated by `load_config()`. Key fields: `stage_models` (`dict[str, str]`) — map of stage name → model slug for the run (populated from persona YAML by `extract_persona_model_slugs()`); `max_iterations`, `checkpoint_dir`, `mcp_server_cmd`, `workspace_root`, `log_level`, `heartbeat_interval_s`, `capture_dialogues`. |
| `Config.resolve_model_for_stage` | `resolve_model_for_stage(stage: str) -> str` | Returns the model slug for *stage* from `Config.stage_models`. Raises `KeyError` when *stage* is not present — this is a programming error (all valid stages must be populated at config load time by `extract_persona_model_slugs()`). Called by `create_stage_node()` **before** the try block so that an unrecognised stage name fails loudly rather than producing a silent `stage_error` log entry. |



---

### `src/utils/subagents.py`

Builds SubAgent spec dicts for stages that delegate sub-tasks to specialised subagents.
Used by the node factory in `src/nodes/__init__.py` before `create_deep_agent()` is called.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `load_subagents` | `load_subagents(stage: str, workspace_root: Path \| str) -> list[dict[str, Any]]` | Returns a list of SubAgent spec dicts (`name`, `description`, `system_prompt` keys) for *stage*. Reads the `subagents` field from the ledger persona YAML for *stage* (via `find_ledger_yaml_for_stage()`), then resolves each slug against `personas/standalone/src/meta/{slug}.yaml` (for `description`) and `personas/standalone/deep-agents/{slug}.md` (for `system_prompt`). Returns `[]` for stages with no `subagents` key, unknown stage IDs, or when the workflow manifest is inaccessible. Raises `FileNotFoundError` if any declared slug has no matching standalone YAML or deep-agents file. Raises `ValueError` if a standalone YAML lacks a `description` field. Results cached per `(stage, slug)` pair for the process lifetime — cache key excludes `workspace_root` (single-workspace assumption). |
| `clear_cache` | `clear_cache() -> None` | Clears the in-memory `(stage, slug)` cache. For test use only. |

---

Three defensive wrappers applied to every MCP tool in a stage node. **Canonical application order:**

```
inject_project_path(tools, project_path)
    → restrict_to_wp(tools, wp_id)
        → log_tool_calls(tools, stage, wp_id, logger)
```

All three functions are **idempotent** (sentinel attributes prevent closure stacking) and handle both flat-dict and ToolCall `{"args": {...}}` input structures.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `inject_project_path` | `inject_project_path(tools: list[Any], project_path: str) -> list[Any]` | **Layer 2 safety net.** Auto-injects `project_path` into every tool call when absent. Uses `setdefault` semantics — explicit `project_path` values are never overwritten. Strips redundant `cwd_path` from call arguments. Sentinel: `_orig_ainvoke`. |
| `restrict_to_wp` | `restrict_to_wp(tools: list[Any], wp_id: str) -> list[Any]` | **Layer 3 safety net (write tools only).** Auto-injects `work_package_id` when absent; soft-fails cross-WP calls (2 strikes) before raising `ValueError`. Read-only tools (in `_READ_ONLY_TOOLS`) are exempt — no wrapping, no injection, no rejection. No-op when `wp_id` is empty (synthesis stages). Sentinel: `_orig_ainvoke_wp`. |
| `log_tool_calls` | `log_tool_calls(tools: list[Any], stage: str, wp_id: str, logger: WorkflowLogger \| None) -> list[Any]` | Emits a `tool_call` JSONL event (`level: "DEBUG"`) before each `ainvoke` call. Records `stage`, `wp_id`, `tool_name`, and `tool_wp_id`; full argument payload excluded (privacy constraint). Returns tools unchanged when `logger` is `None`. Sentinel: `_orig_ainvoke_log`. |

### Writing a New Tool Wrapper

Before adding a fourth wrapper, check the three-wrapper threshold note below. If a new
wrapper is justified, follow this canonical pattern:

```python
def my_new_wrapper(tools: list[Any], extra_arg: str) -> list[Any]:
    """One-line description.

    Idempotent — sentinel attribute ``_orig_ainvoke_<suffix>`` prevents stacking.
    """
    SENTINEL = "_orig_ainvoke_<suffix>"          # unique per wrapper

    for tool in tools:
        if hasattr(tool, SENTINEL):
            continue                              # already wrapped; skip

        if not hasattr(tool, "_orig_ainvoke_<suffix>"):
            object.__setattr__(tool, SENTINEL, tool.ainvoke)
        _orig = getattr(tool, SENTINEL)

        async def _wrapped_ainvoke(
            input: Any,                          # noqa: A002
            *args: Any,
            _orig: Any = _orig,                  # closure capture — avoids late-binding bug
            _extra: str = extra_arg,
            **kwargs: Any,
        ) -> Any:
            # ... wrapper logic using _extra ...
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _wrapped_ainvoke)

    return tools
```

**Invariants every wrapper must satisfy:**

- **Sentinel naming:** `_orig_ainvoke_<suffix>` — choose a unique suffix, never reuse one.
- **Idempotency check:** `if hasattr(tool, SENTINEL): continue` — prevents double-wrapping when
  the factory is called more than once on the same tool object.
- **Closure capture:** pass loop-local variables as default arguments (e.g. `_orig=_orig`) to
  avoid the Python late-binding closure bug.
- **Frozen attributes:** use `object.__setattr__` — LangChain tool objects are often Pydantic
  models whose `__setattr__` is overridden or frozen.
- **Application order = execution order (reversed):** the wrapper applied *last* executes *first*.
  `log_tool_calls` is applied last so it fires before inner wrappers inject `project_path` or
  `work_package_id`, capturing the arguments as the agent supplied them.
- **Three-wrapper threshold:** if this would be the fourth wrapper, extract a shared
  `_wrap_ainvoke(tool, sentinel_attr, async_factory)` helper instead of repeating the pattern a
  fourth time.

---

## State Fields (progress-tracking additions)

These `WorkflowState` fields support the new event types. See
[architecture.md](../../architecture.md) for the full state schema.

| Field | Type | Description |
|-------|------|-------------|
| `prev_wp_summaries` | `list` | Previous supervisor iteration's WP summary list. Diffed against `wp_summaries` to emit `wp_status_change` / `wp_complete` events. |
| `run_start_ts` | `str` | ISO 8601 UTC timestamp of run start. Set once by CLI. Used to compute `elapsed_s` in `progress_snapshot` and `total_duration_s` in `run_end`. |
| `wps_completed_this_run` | `int` | WPs that transitioned to COMPLETE during this run. Included in `progress_snapshot`. |
