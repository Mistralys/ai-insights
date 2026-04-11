# Orchestrator — Project Manifest

> Manifest hub for the **AI Insights Orchestrator** — a headless, deterministic alternative to IDE-based agent workflows using LangGraph + Deep Agents.

---

## Quick Reference

| Property | Value |
|----------|-------|
| **Language** | Python 3.11+ |
| **Runtime** | CPython |
| **Architecture** | LangGraph StateGraph + Deep Agents |
| **Package Manager** | pip (setuptools) |
| **Test Framework** | pytest (374 tests) |
| **Entry Point** | `orchestrate` CLI (`src/cli.py`) |

### Development Commands

```bash
cd orchestrator
pip install -e ".[dev,anthropic]"   # Install with dev + Anthropic extras
pytest                               # Run all tests
pytest -m "not live"                 # Skip tests requiring API keys
ruff check src/ tests/               # Lint
```

---

## Manifest Sections

The orchestrator's documentation lives in `orchestrator/docs/`. The documents below together form its project manifest.

| Section | Document | Contents |
|---------|----------|----------|
| **Overview & Usage** | [README.md](../../../README.md) | Prerequisites, installation, configuration, CLI reference, architecture overview, troubleshooting |
| **Architecture & Data Flows** | [architecture.md](../../architecture.md) | Stage node lifecycle, MCP tool wrapping, `WorkflowState` fields, JSONL log entry types |
| **Routing Logic** | [supervisor-routing.md](../../supervisor-routing.md) | Deterministic supervisor algorithm, special exits, action sets, circuit-breaker mechanics |
| **Public API Surface** | [public-api.md](../../public-api.md) | CLI entry point, graph construction, supervisor factory, utility functions |
| **Constraints & Conventions** | [project-manifest/constraints.md](constraints.md) | Numbered constraints and conventions governing orchestrator development: prompt architecture rules, LLM boundaries, circuit-breaker, cross-platform policy |
| **API Surface (manifest)** | [project-manifest/api-surface.md](api-surface.md) | Quick-reference: JSONL event types, enriched fields, `ChunkWriter`, `_format_duration`, `parse_tool_response`, progress-tracking state fields |
| **Data Flows** | [project-manifest/data-flows.md](data-flows.md) | Dialogue capture, chunk writing, chunk rendering, chunk discovery flows |
| **File Tree** | [project-manifest/file-tree.md](file-tree.md) | Annotated file listing for all orchestrator source files |
| **Tech Stack** | [project-manifest/tech-stack.md](tech-stack.md) | Runtime, dependencies (incl. `langgraph>=1.1,<2.0`), architectural patterns |
| **Log Schema** | [jsonl-log-schema.md](../../jsonl-log-schema.md) | JSONL schema reference: 16 event types, full field reference, duration conventions, JSON examples |
| **Smoke Testing** | [smoke-testing.md](../../smoke-testing.md) | Dispatch loop verification runbook |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Graph framework | LangGraph ≥1.1,<2.0 | StateGraph-based workflow with deterministic routing |
| Agent execution | Deep Agents ≥0.3 (via LangChain) | Coding-agent execution within each pipeline stage |
| MCP integration | langchain-mcp-adapters ≥0.2 | Wraps MCP tools for LangChain tool interface |
| LLM providers | langchain-anthropic / langchain-google-genai | Claude (Anthropic) or Gemini (Google) |
| Checkpointing | langgraph-checkpoint-sqlite | SQLite-backed run resume via `--resume` |
| Configuration | python-dotenv | `.env`-based config with auto-detected LLM provider |
| Testing | pytest + pytest-asyncio | Async-aware tests with integration and live marks |
| Linting | ruff | Line-length 100, target Python 3.11 |

### Architectural Patterns

- **Deterministic supervisor**: Pure-Python router with no LLM calls — delegates all routing to the MCP server's `ledger_get_next_action` tool.
- **Stage node factories**: Each of the 8 stages (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis) is a factory-generated node that loads a persona prompt, wraps MCP tools, and creates a Deep Agent.
- **Manifest-derived constants**: Pipeline routing maps and role names are derived from `shared/workflow-manifest.json` at import time.
- **Cross-platform file locking**: `msvcrt` (Windows) / `fcntl` (Unix) for the JSONL run log.

---

## Constraints & Conventions

The authoritative constraint list has been promoted to a dedicated file:

> **[project-manifest/constraints.md](constraints.md)** — 11 numbered constraints covering persona authority, injection-safety, prompt uniformity, LLM routing, manifest-derived constants, MCP pre-build, circuit-breaker, stage isolation, cross-platform locking, documentation-forward convention, and LangGraph config annotations.

---

## File Tree

```
orchestrator/
├── pyproject.toml              # Package metadata, extras, scripts
├── README.md                   # Full user-facing documentation
├── requirements.txt            # Pinned dependencies
├── changelog.md                # Version history
├── module-context.yaml         # CTX Generator config
├── docs/
│   ├── agents/
│   │   └── project-manifest/
│   │       ├── README.md       # ← You are here
│   │       ├── api-surface.md  # JSONL event types, enriched fields, ChunkWriter, utility refs
│   │       ├── constraints.md  # Numbered constraint catalogue (11 rules)
│   │       ├── data-flows.md   # Dialogue capture, chunk writing, chunk rendering flows
│   │       ├── file-tree.md    # Annotated file listing
│   │       └── tech-stack.md   # Runtime, dependencies, architectural patterns
│   ├── architecture.md         # Stage nodes, state management, log types
│   ├── supervisor-routing.md   # Routing algorithm, exits, circuit-breaker
│   ├── public-api.md           # Public functions and entry points
│   ├── jsonl-log-schema.md     # Run log field reference
│   └── smoke-testing.md        # Dispatch loop verification
├── src/
│   ├── __init__.py
│   ├── cli.py                  # CLI entry point (orchestrate command)
│   ├── config.py               # .env loading, provider detection, constants
│   ├── graph.py                # StateGraph assembly and compilation
│   ├── state.py                # WorkflowState TypedDict with reducers
│   ├── supervisor.py           # Deterministic router (no LLM)
│   ├── mcp_client.py           # MCP server subprocess lifecycle
│   ├── nodes/                  # Stage node factories (8 stages)
│   └── utils/                  # Tool wrappers, persona loader, logger, filelock
├── tests/                      # 374 tests (unit, integration, live)
└── checkpoints/                # SQLite checkpoint storage
```
