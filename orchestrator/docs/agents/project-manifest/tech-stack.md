# Orchestrator — Tech Stack & Patterns

> **Parent:** [project-manifest/README.md](README.md)

---

## Runtime & Language

| Component | Version | Notes |
|-----------|---------|-------|
| **Language** | Python 3.11+ | CPython runtime |
| **Package Manager** | pip (setuptools) | Extras: `dev`, `anthropic` |
| **Test Framework** | pytest + pytest-asyncio | Async-aware; `live` mark for API-key tests |
| **Linter** | ruff | Line-length 100, target Python 3.11 |

---

## Core Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `langgraph` | `>=1.1,<2.0` | StateGraph-based workflow with deterministic routing |
| `langgraph-checkpoint-sqlite` | *(unpinned)* | SQLite-backed run resume via `--resume` |
| `langchain-mcp-adapters` | `>=0.2` | Wraps MCP tools for LangChain tool interface |
| `langchain-anthropic` | *(unpinned)* | Claude (Anthropic) LLM provider |
| `langchain-google-genai` | *(unpinned)* | Gemini (Google) LLM provider |
| `python-dotenv` | *(unpinned)* | `.env`-based config with auto-detected LLM provider |

### Development

| Package | Purpose |
|---------|---------|
| `pytest` | Test runner |
| `pytest-asyncio` | Async test support |
| `ruff` | Linting and formatting |

---

## Architectural Patterns

### 1. **LangGraph StateGraph**

The orchestrator is built as a **LangGraph `StateGraph`** with:
- A `WorkflowState` TypedDict carrying all inter-node state (thread ID, run log, WP ID, etc.)
- Stage nodes as factory-generated async functions
- A deterministic supervisor node that delegates all routing decisions to the MCP server's `ledger_get_next_action` tool — **no LLM calls in the router**

**Key Files:**
- `src/graph.py` — graph assembly and compilation
- `src/supervisor.py` — deterministic router
- `src/state.py` — `WorkflowState` TypedDict

---

### 2. **Stage Node Factories**

Each of the 8 pipeline stages (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis) is a **factory-generated async node** that:
1. Loads a Markdown persona prompt via `load_template` / `render_prompt`
2. Wraps MCP tools with `log_tool_calls()` for JSONL event emission
3. Creates a Deep Agent (LangChain `create_react_agent` equivalent)
4. Streams the agent run via `graph.astream(..., stream_mode="messages")`
5. Writes raw chunks to a JSONL file via `ChunkWriter` (see `src/utils/chunk_writer.py`)
6. Writes a rendered Markdown dialogue via `write_dialogue` (see `src/utils/dialogue_writer.py`)

**Key Files:**
- `src/nodes/__init__.py` — node factory + JSONL event emission
- `src/nodes/{stage}.py` — per-stage node modules
- `src/utils/chunk_writer.py` — `ChunkWriter` (JSONL streaming capture)
- `src/utils/dialogue_writer.py` — `write_dialogue` / `serialize_messages_to_markdown`

---

### 3. **JSONL Run Log**

All runtime events are written to a JSONL run log (one file per orchestrator invocation) by `WorkflowLogger`. The log supports structured events (23 types) for observability, progress tracking, and post-run analysis. See [api-surface.md](api-surface.md) for the full event type reference.

**Cross-platform file locking:** `msvcrt` (Windows) / `fcntl` (Unix) prevents concurrent writes to the JSONL run log.

**Key Files:**
- `src/utils/logging.py` — `WorkflowLogger`
- `src/utils/filelock.py` — cross-platform file lock

---

### 4. **Manifest-Derived Constants**

Pipeline routing maps and role names are derived from `shared/workflow-manifest.json` at import time — never hard-coded. This ensures the orchestrator stays in sync with the MCP server's schema automatically.

**Key Files:**
- `src/config.py` — manifest loading and constant derivation

---

### 5. **Template Renderer**

Stage prompts are assembled from `.md` template files at `src/nodes/templates/<stage>.md` via a four-step pipeline: partial resolution → conditional block evaluation → variable substitution → whitespace normalization.

**Key Files:**
- `src/nodes/prompt_renderer.py` — `load_template`, `render_prompt`, `load_partial`, `clear_template_cache`
