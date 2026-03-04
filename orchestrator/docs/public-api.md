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
| `make_supervisor_node(mcp_tools)` | `src.supervisor` | Factory returning the async `supervisor_node` function. Closes over MCP tools for testability. |

---

## Stage Node Factories

All follow the same pattern via `create_stage_node()`:

| Factory | Module | Stage |
|---------|--------|-------|
| `make_pm_node(config, mcp_tools)` | `src.nodes.pm` | `pm` |
| `make_developer_node(config, mcp_tools)` | `src.nodes.developer` | `developer` |
| `make_qa_node(config, mcp_tools)` | `src.nodes.qa` | `qa` |
| `make_reviewer_node(config, mcp_tools)` | `src.nodes.reviewer` | `reviewer` |
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
| `Config` | `src.config` | Dataclass holding all runtime settings (model, provider, paths, limits). |
| `load_config(*, workspace_root=None)` | `src.config` | Loads `.env`, resolves provider, returns `Config`. |
| `get_chat_model()` | `src.config` | Returns the configured LangChain `BaseChatModel` instance. |

---

## Utilities

| Symbol | Module | Description |
|--------|--------|-------------|
| `inject_project_path(tools, project_path)` | `src.utils.tool_wrappers` | Monkeypatches `ainvoke` on each tool to auto-inject `project_path`. |
| `load_persona(stage)` | `src.utils.persona` | Reads and caches the persona Markdown for a given stage. |
| `parse_plan(path)` | `src.utils.plan_parser` | Extracts title, summary, and content from a plan `.md` file. Returns `PlanMetadata`. |
| `WorkflowLogger` | `src.utils.logging` | JSONL + console logger. Use `WorkflowLogger.create(label=...)` context manager. |
