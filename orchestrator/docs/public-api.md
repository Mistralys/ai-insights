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
| `PERSONA_FILES` | `src.config` | `dict[str, str]` — stage ID → relative path to the deep-agents persona Markdown. Derived from `persona_file_deep_agents` in `shared/workflow-manifest.json` roles. All 9 roles are expected to carry this field; its optionality in the JSON Schema is for backward-compatibility only. |
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
| `load_subagents(stage, workspace_root)` | `src.utils.subagents` | Returns a list of SubAgent spec dicts (`name`, `description`, `system_prompt`) for *stage*. Reads the `subagents` field from the ledger persona YAML for *stage*, then resolves each slug against `personas/ledger-support/src/meta/{slug}.yaml` first (falling back to `personas/standalone/src/meta/{slug}.yaml`) for `description`, and `personas/ledger-support/deep-agents/{slug}.md` first (falling back to `personas/standalone/deep-agents/{slug}.md`) for `system_prompt`. `name` is the kebab-case slug itself. Returns `[]` for stages with no `subagents` key or unknown stage IDs. Raises `FileNotFoundError` if a slug has no matching file in either suite. Raises `ValueError` for a YAML missing `description`. Results cached per `(stage, slug)` for the process lifetime (`workspace_root` excluded from key — single-workspace assumption). |
| `clear_cache()` | `src.utils.subagents` | Clears the in-memory subagent `(stage, name)` cache. For test use only. |
| `WorkflowLogger` | `src.utils.logging` | JSONL + console logger. Use `WorkflowLogger.create(label=...)` context manager. `stream_entry(entry)` writes a pre-built log-entry dict to the JSONL file and emits rich, event-type-specific console output for 9 named action types: `stage_start`, `stage_complete` (with duration + token count), `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`, `dialogue_captured` (formatted as `[{stage}] {wp_id} dialogue saved → {filename}`), and `tool_call` (formatted as `[{stage}] 🔧 {tool_name} ({tool_wp_id})`, parenthetical omitted when `tool_wp_id` is empty); all other event types fall through to the generic `action → result` format. `log(...)` writes a freeform entry and emits a generic console line. `flush_unstreamed(run_log)` compares the count of entries already persisted via `stream_entry` against the full `run_log` list from the LangGraph state, and writes any un-persisted tail entries — this is the end-of-run safety net called by `cli.py` to guarantee JSONL completeness even when `get_run_logger()` returned `None` inside graph nodes. |
| `lock_exclusive(fd)` | `src.utils.filelock` | Acquire a non-blocking exclusive lock on an open file descriptor. Raises `OSError` on contention. Uses `msvcrt.locking` on Windows, `fcntl.flock` on Unix. **Windows invariant:** the lock file must be opened in `'w'` mode so the file pointer stays at 0. **Not re-entrant on Windows:** calling twice on the same fd without an intervening `unlock` raises `OSError(EACCES)`. |
| `unlock(fd)` | `src.utils.filelock` | Release the lock on an open file descriptor. Silently swallows `OSError` if the fd is not locked (idempotent). |
| `serialize_messages_to_markdown(messages, stage, wp_id, timestamp=None)` | `src.utils.dialogue_writer` | Convert a LangChain message sequence to a Markdown document. Renders a header table (stage/WP ID/timestamp), per-message `## Human` / `## Assistant` / `## Tool Result` / `## System` sections, tool call JSON in fenced code blocks, and an optional token-usage footer. Returns a `str`. |
| `write_dialogue(content, slug_dir, wp_id, stage)` | `src.utils.dialogue_writer` | Write *content* to `{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md`, creating the `orchestrator/dialogues/` subdirectory if needed. Revision number *N* is auto-incremented from existing files (first call writes `r0`). Returns the `Path` of the written file. |
| `ChunkWriter(slug_dir, wp_id, stage)` | `src.utils.chunk_writer` | Opens (or creates) a JSONL file at `{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl`, writing a version-header line (`chunk_format`, `stream_mode`, `langgraph_stream_version`) as the very first entry. The `orchestrator/chunks/` directory is created automatically. Revision *N* is auto-incremented from existing files (mirrors `write_dialogue`). Raises `OSError` if the directory cannot be created or the file cannot be opened. |
| `ChunkWriter.write_chunk(chunk)` | `src.utils.chunk_writer` | Append *chunk* as one JSON line and `flush()` immediately (durability contract). Only `OSError` (I/O failures) is caught, logged at `DEBUG`, and swallowed — `TypeError` from non-JSON-serialisable values **propagates to the caller**. Callers passing untrusted chunk data from upstream LangGraph streams should validate values before calling this method. No-op when the writer is already closed. |
| `ChunkWriter.close()` | `src.utils.chunk_writer` | Close the underlying file handle. Idempotent — safe to call multiple times without raising. |
| `ChunkWriter.path` | `src.utils.chunk_writer` | `pathlib.Path` property. Absolute path to the JSONL file being written. |

> **`_CHUNK_HEADER` mutation warning:** `_CHUNK_HEADER` is a module-level mutable `dict` and a private implementation detail. Do **not** mutate it from outside `chunk_writer.py` — external mutation silently corrupts the header line of every subsequently opened chunk file. It is exposed at module scope only so tests can assert on its contents.
