# Orchestrator - Manifest
_SOURCE: Project manifest (overview, tech stack, constraints, API surface, architecture)_
# Project manifest (overview, tech stack, constraints, API surface, architecture)
```
// Structure of documents
└── orchestrator/
    └── docs/
        └── agents/
            └── project-manifest/
                └── README.md
                └── api-surface.md

```
###  Path: `/orchestrator/docs/agents/project-manifest/README.md`

```md
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
| **API Surface (manifest)** | [project-manifest/api-surface.md](api-surface.md) | Quick-reference: 16 JSONL event types, enriched fields, `_format_duration`, `parse_tool_response`, progress-tracking state fields |
| **Log Schema** | [jsonl-log-schema.md](../../jsonl-log-schema.md) | JSONL schema reference: 16 event types, full field reference, duration conventions, JSON examples |
| **Smoke Testing** | [smoke-testing.md](../../smoke-testing.md) | Dispatch loop verification runbook |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Graph framework | LangGraph ≥0.4 | StateGraph-based workflow with deterministic routing |
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

1. **No LLM calls in the supervisor.** All routing decisions come from the MCP server's ledger tools.
2. **Manifest-derived constants.** `PIPELINE_ROLES`, `PIPELINE_SEQUENCE`, and action→role maps in `src/config.py` are derived from `shared/workflow-manifest.json`.
3. **MCP server must be pre-built.** The orchestrator spawns the MCP server as a subprocess — `mcp-server/dist/index.js` must exist. Use `node scripts/run-orchestrator.js` for automatic build-freshness checks.
4. **Circuit-breaker.** A work package accumulating ≥3 consecutive stage failures is skipped for the remainder of the run.
5. **Stage node isolation.** Each stage node creates its own Deep Agent instance per invocation — no shared state between stages.
6. **Cross-platform.** File locking uses `msvcrt` on Windows and `fcntl` on Unix. All path handling uses `pathlib`.
7. **LangGraph config annotations.** With `from __future__ import annotations`, Python stringifies all type hints. LangGraph's config injection depends on exact annotation string matching — `RunnableConfig | None` becomes the string `"RunnableConfig | None"` which LangGraph does not recognise. Use `Optional[RunnableConfig]` instead (produces `"Optional[RunnableConfig]"` which is in the allowlist). Symptom: `get_run_logger: config is None` warnings, events only flushed at run end.

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
│   │       └── README.md       # ← You are here
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

```
###  Path: `/orchestrator/docs/agents/project-manifest/api-surface.md`

```md
# Orchestrator — API Surface

> **Parent:** [project-manifest/README.md](README.md) · **Detailed refs:** [public-api.md](../../public-api.md) · [jsonl-log-schema.md](../../jsonl-log-schema.md)

Quick-reference for public symbols, JSONL event types, and utility functions.
For complete signatures and full field descriptions see the linked documents above.

---

## JSONL Event Types — Logging Module (`src/utils/logging.py`)

The schema supports **17 event types** across three emitters. For the full field reference,
duration conventions, JSON examples, and backward-compatibility notes see
[jsonl-log-schema.md](../../jsonl-log-schema.md).

### Node factory events (`src/nodes/__init__.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `stage_start` | `stage`, `wp_id`, `iteration` | **New.** Emitted before Deep Agent creation. Always first entry in a stage's log sequence. |
| `stage_complete` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, **`duration_s`** | `duration_s` — wallclock seconds from `stage_start` to completion (float, 1 dp). |
| `stage_error` | `stage`, `wp_id`, `result="FAIL"`, `error`, **`duration_s`** | `duration_s` — time elapsed before the exception was raised. |
| `pipeline_result` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` | **New.** Best-effort read-back of latest WP pipeline after success. `duration_s` derived from `pipeline.duration_ms`; `null` when absent. Omitted on read-back failure. |

### Supervisor events (`src/supervisor.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `wp_status_change` | `wp_id`, `old_status`, `new_status` | **New.** Fired when a WP's status differs between consecutive iterations. |
| `wp_complete` | `wp_id` | **New.** Subset of `wp_status_change` — fired specifically on `→ COMPLETE` transitions. |
| `progress_snapshot` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, **`elapsed_s`**, `run_start_ts` (optional) | **New.** Emitted every iteration. `elapsed_s` — seconds since `run_start_ts`; omitted when `run_start_ts` absent. `run_start_ts` — echoes `WorkflowState.run_start_ts`; `None` when unavailable. |
| `rework_detected` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count` | **New.** Fired when supervisor dispatches a `REWORK` action. |
| `route` | `destination`, `agent_role`, `ledger_action`, **`prev_stage`**, **`prev_wp_id`**, **`prev_result`** | Enriched: `prev_stage`, `prev_wp_id`, `prev_result` (`"PASS"` / `"FAIL"` / `""`) added to provide previous-stage context. |

### Heartbeat events (`src/utils/logging.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `heartbeat` | `stage="heartbeat"`, `silence_s` | Emitted by `WorkflowLogger._heartbeat_loop` when no log entry has been written for `HEARTBEAT_INTERVAL_S` seconds. Console line: `[heartbeat] ♥ alive (quiet for 2m 0s)`. Configure via `HEARTBEAT_INTERVAL_S` env var (default `120`, `0` to disable). |

### CLI events (`src/cli.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `run_start` | `thread_id`, `dry_run`, `plan`, **`run_start_ts`** | Enriched: `run_start_ts` — ISO 8601 UTC timestamp stored in state for elapsed-time math. `plan` — resolved path of the plan file passed as `--plan`. |
| `run_end` | `result`, `thread_id`, **`total_duration_s`** | Enriched: `total_duration_s` — wallclock seconds for the full run (float, 1 dp); omitted when `run_start_ts` unavailable. |

### Duration field conventions

| Field | Scope | Present on |
|-------|-------|-----------|
| `duration_s` | Single stage or pipeline execution | `stage_complete`, `stage_error`, `pipeline_result` |
| `elapsed_s` | Time since run start | `progress_snapshot` |
| `total_duration_s` | Entire run | `run_end` |

All duration values are floats rounded to 1 decimal place.

---

## Utilities

### `src/utils/logging.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `WorkflowLogger` | `WorkflowLogger.create(label)` → context manager | JSONL + console logger. `stream_entry(entry)` writes a log entry dict to JSONL and emits event-type-specific console output. `log(...)` writes a freeform entry. `flush_unstreamed(run_log)` writes any `run_log` entries not already persisted via `stream_entry` (safety net for when the logger is unreachable inside graph nodes). `start_heartbeat(interval_s)` / `stop_heartbeat()` — async methods managing a background heartbeat task. |
| `_format_duration` | `_format_duration(seconds: float \| None) -> str` | Formats a float of seconds as a human-readable string. Examples: `"3m 24s"`, `"1h 12m"`, `"45s"`, `"0s"`. Returns `"0s"` for `None` or zero. Used internally by `stream_entry` for console output of `stage_complete`, `progress_snapshot`, and `pipeline_result` events. **Private** — not part of the public API but documented here as it drives all human-readable duration display. |
| `get_run_logger` | `get_run_logger(config) -> WorkflowLogger \| None` | Extracts the `WorkflowLogger` instance from a LangGraph `RunnableConfig`. Returns `None` when no logger is attached (e.g. in unit tests). |

### `src/utils/mcp_parse.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `parse_tool_response` | `parse_tool_response(raw: Any) -> dict \| list \| str \| None` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, `ToolMessage` objects, and direct dicts. Used by the supervisor's `_call_tool` helper and the node factory's `pipeline_result` read-back. |

---

## State Fields (progress-tracking additions)

These `WorkflowState` fields support the new event types. See
[architecture.md](../../architecture.md) for the full state schema.

| Field | Type | Description |
|-------|------|-------------|
| `prev_wp_summaries` | `list` | Previous supervisor iteration's WP summary list. Diffed against `wp_summaries` to emit `wp_status_change` / `wp_complete` events. |
| `run_start_ts` | `str` | ISO 8601 UTC timestamp of run start. Set once by CLI. Used to compute `elapsed_s` in `progress_snapshot` and `total_duration_s` in `run_end`. |
| `wps_completed_this_run` | `int` | WPs that transitioned to COMPLETE during this run. Included in `progress_snapshot`. |

```