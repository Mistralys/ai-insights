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
                └── constraints.md

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
| **Constraints & Conventions** | [project-manifest/constraints.md](constraints.md) | Numbered constraints and conventions governing orchestrator development: prompt architecture rules, LLM boundaries, circuit-breaker, cross-platform policy |
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
│   │       ├── constraints.md  # Numbered constraint catalogue (11 rules)
│   │       └── api-surface.md  # JSONL event types, enriched fields, utility refs
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

The schema supports **19 event types** across three emitters. For the full field reference,
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
| `dry_run_no_ledger` | `destination`, `detail` | **New.** Emitted in `--dry-run` mode when the ledger is missing (expected). Replaces `mcp_error` at INFO level. |
| `dry_run_complete` | `destination=END`, `reason` | **New.** Emitted in `--dry-run` mode on second iteration with no WPs — clean termination signal. |

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
###  Path: `/orchestrator/docs/agents/project-manifest/constraints.md`

```md
# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas for the **AI Insights Orchestrator**.

### Constraint Entry Format

New constraint entries should follow this structure:

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Prompt Architecture Constraints

### 1. Persona Files Are the Source of Truth for Agent Behaviour

**Rule:** All identity declarations, workflow step enumerations, and MCP tool-call instructions live exclusively in persona system prompts (`personas/ledger/claude-code/`). User-turn prompts in `_build_*_prompt()` functions must contain only runtime context that the persona file cannot know: concrete `project_path`, `wp_id`, and plan content. All prompt builders delegate to the centralized :func:`build_stage_prompt` in `src/nodes/__init__.py`. Any change to agent behaviour must be made in the persona source files, **not** in prompt builder functions.

**Rationale:** Splitting identity from runtime context keeps persona files reviewable, versionable, and reusable across different orchestration surfaces without coupling them to Python implementation details.

**Anti-pattern:**
```python
# ❌ WRONG — workflow instructions embedded in the user-turn prompt
def _build_developer_prompt(project_path: str, wp_id: str) -> str:
    return f"""
    CRITICAL — EVERY MCP TOOL CALL MUST include `project_path='{project_path}'`.

    Your workflow:
    1. Call ledger_get_next_action with agent_role: "Developer"
    2. Read the WP spec
    3. Implement the changes
    ...
    """
```

**Correct pattern:**
```python
# ✅ CORRECT — delegate to the centralized helper
from . import build_stage_prompt

def _build_developer_prompt(state: WorkflowState) -> str:
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),
    )
```

---

### 2. The `project_path` Reminder Is Permanent

**Rule:** The user-turn prompt must always include a reminder to use the specified `project_path` for all ledger tool calls. The reminder text is defined once in `build_stage_prompt()` (`src/nodes/__init__.py`) and must never be removed. Persona Markdown files are static and cannot contain runtime values, so this runtime reminder lives in the user-turn prompt.

**Rationale:** Without the reminder the agent may omit `project_path` from MCP tool calls, causing every ledger operation to fail.

---

### 3. Prompt Templates Are Structurally Uniform Within Their Category

**Rule:** The six WP-scoped prompt builder functions (`_build_developer_prompt`, `_build_qa_prompt`, `_build_security_auditor_prompt`, `_build_reviewer_prompt`, `_build_release_engineer_prompt`, `_build_docs_prompt`) must all delegate to the centralized `build_stage_prompt()` helper in `src/nodes/__init__.py`. Any change to the minimal prompt pattern must be applied in that single helper. The PM and synthesis templates are documented exceptions with justified divergences (PM adds plan content via the `preamble`/`extra` parameters; synthesis omits `wp_id`).

**Rationale:** Structural uniformity makes the prompt layer auditable at a glance and prevents silent divergence between nodes that should behave identically.

---

## Supervisor & Routing Constraints

### 4. No LLM Calls in the Supervisor

**Rule:** The supervisor node must not make LLM calls. All routing decisions must come from the MCP server's `ledger_get_next_action` tool. The supervisor is a pure-Python router.

**Rationale:** LLM-based routing introduces non-determinism into an otherwise deterministic pipeline. Delegating routing to the ledger tools ensures the supervisor's behaviour is fully specified by the workflow manifest.

---

### 5. Manifest-Derived Constants

**Rule:** `PIPELINE_ROLES`, `PIPELINE_SEQUENCE`, and action→role maps in `src/config.py` must be derived from `shared/workflow-manifest.json` at import time. Never hardcode role names or pipeline ordering as bare string literals.

**Rationale:** The workflow manifest is the canonical source of pipeline ordering and role naming. Hardcoded constants drift silently when the manifest is updated.

---

### 6. Circuit-Breaker Threshold: 3 Consecutive Failures

**Rule:** A work package that accumulates ≥3 consecutive stage failures must be skipped for the remainder of the run. The threshold value must be read from configuration, not hardcoded.

**Rationale:** Without a circuit-breaker a pathologically failing WP will stall the entire orchestration run indefinitely.

---

## Node Implementation Constraints

### 7. Stage Node Isolation

**Rule:** Each stage node must create its own Deep Agent instance per invocation. No state — including LLM client instances, MCP connections, or tool objects — may be shared between stage invocations.

**Rationale:** Shared state between stage invocations introduces subtle coupling that makes failures hard to diagnose and prevents clean retry semantics.

---

### 8. Cross-Platform File Locking

**Rule:** File locking for the JSONL run log must use `msvcrt` on Windows and `fcntl` on Unix. All path construction must use `pathlib.Path`, never bare string concatenation.

**Rationale:** The orchestrator must run in CI environments on both Linux and Windows. Platform-specific locking ensures log integrity without blocking on a missing system call.

---

## LangGraph-Specific Constraints

### 9. LangGraph Config Annotations Require `Optional[RunnableConfig]`

**Rule:** In files that use `from __future__ import annotations`, always annotate LangGraph config parameters as `Optional[RunnableConfig]`, **not** `RunnableConfig | None`.

**Rationale:** `from __future__ import annotations` causes Python to stringify all type hints at parse time. The union syntax `RunnableConfig | None` becomes the string `"RunnableConfig | None"`, which LangGraph's config injection does not recognise. `Optional[RunnableConfig]` produces `"Optional[RunnableConfig]"`, which is in the allowlist.

**Symptom:** `get_run_logger: config is None` warnings; JSONL events only flushed at run end rather than incrementally.

**Anti-pattern:**
```python
# ❌ WRONG — union syntax is stringified to an unrecognised form
from __future__ import annotations
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: RunnableConfig | None = None) -> WorkflowState:
    ...
```

**Correct pattern:**
```python
# ✅ CORRECT — Optional[] form is in LangGraph's annotation allowlist
from __future__ import annotations
from typing import Optional
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: Optional[RunnableConfig] = None) -> WorkflowState:
    ...
```

---

## Review & Documentation Conventions

### 10. `documentation-forward` Is the Named Review-to-Documentation Handoff Convention

**Rule:** When a code-review pipeline identifies documentation gaps, the reviewer must record them as structured pipeline comments with type `documentation-forward`. The documentation stage resolves these comments. This is the standard cross-pipeline handoff mechanism for documentation work identified during review.

**Format:** Comment objects in the code-review pipeline result must use:
```json
{
  "type": "documentation-forward",
  "priority": "medium",
  "note": "[documentation-forward] <description of documentation gap and suggested resolution>"
}
```

**Rationale:** Naming the convention enforces a consistent, machine-readable handoff signal between the reviewer and documentation agents, preventing documentation gaps from being silently dropped when the code-review pipeline completes.

**Who resolves it:** The documentation stage agent reads open `documentation-forward` comments from the most recent code-review pipeline and addresses each one before marking the WP complete.

---

## MCP Server Dependency

### 11. MCP Server Must Be Pre-Built

**Rule:** The orchestrator spawns the MCP server as a subprocess. `mcp-server/dist/index.js` must exist before any orchestration run begins. Use `node scripts/run-orchestrator.js` for automatic build-freshness checks rather than launching `orchestrator` directly.

**Rationale:** The orchestrator has no fallback if the MCP server subprocess fails to start — all ledger operations will fail silently or with unhelpful errors.

```