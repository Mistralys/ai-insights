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
| `write_dialogue(content, slug_dir, wp_id, stage)` | `src.utils.dialogue_writer` | Write *content* to `{slug_dir}/dialogues/{wp_id}-{stage}-r{N}.md`, creating the `dialogues/` subdirectory if needed. Revision number *N* is auto-incremented from existing files (first call writes `r0`). Returns the `Path` of the written file. |
