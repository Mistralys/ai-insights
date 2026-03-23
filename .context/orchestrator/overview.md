# Orchestrator - Overview
_SOURCE: Overview_
# Overview
```
// Structure of documents
└── orchestrator/
    └── README.md

```
###  Path: `/orchestrator/README.md`

```md
# AI Insights Orchestrator

A headless, deterministic alternative to IDE-based agent workflows. The orchestrator uses **LangGraph** for graph-based supervisor routing and **Deep Agents** (via LangChain) for coding-agent execution within each pipeline stage. It is driven by the same MCP server and persona prompts as the IDE workflow.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Folder Overview](#folder-overview)
- [Documentation Index](#documentation-index)
- [CLI Reference](#cli-reference)
- [Troubleshooting](#troubleshooting)
- [Running Tests](#running-tests)
- [Linting](#linting)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Tested on 3.14+ |
| Node.js | 18+ | Required to run the MCP server subprocess; `node` must be on `PATH` |
| API key | — | Anthropic or Google AI Studio |

---

## Installation

```bash
# 1. Enter the orchestrator directory
cd orchestrator

# 2. Create a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
# source .venv/bin/activate

# 3. Install with your LLM provider
pip install -e ".[anthropic]"   # Anthropic (Claude)
# — or —
pip install -e ".[google]"      # Google AI Studio (Gemini)

# Checkpoint support (SQLite-backed) is included by default.

# 4. Configure environment
cp .env.example .env
# Edit .env with your API key (see Configuration section)

# 5. Build the MCP server (required — runs in a subprocess at runtime)
#    Always rebuild after pulling changes to mcp-server/src/ to avoid
#    silent failures caused by a stale dist.
cd ../mcp-server
npm install
npm run build
cd ../orchestrator
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```dotenv
# === LLM Provider (choose ONE) ===

# Option A: Anthropic (pip install -e ".[anthropic]")
ANTHROPIC_API_KEY=sk-ant-...
MODEL_NAME=claude-sonnet-4-6

# Option B: Google AI Studio (pip install -e ".[google]")
# GOOGLE_API_KEY=AIza...
# MODEL_NAME=gemini-2.5-pro

# === General settings ===
MAX_ITERATIONS=100        # Safety ceiling on supervisor loop iterations
CHECKPOINT_DIR=./checkpoints   # SQLite checkpoint directory (enable --resume)
LOG_LEVEL=INFO            # DEBUG | INFO | WARNING | ERROR | CRITICAL
```

### Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MODEL_NAME` | **yes** | — | LLM model identifier (e.g. `claude-sonnet-4-6`) |
| `ANTHROPIC_API_KEY` | one of | — | API key for Anthropic Chat models |
| `GOOGLE_API_KEY` | one of | — | API key for Google AI Studio / Gemini models |
| `MAX_ITERATIONS` | no | `100` | Maximum supervisor loop iterations before abort |
| `CHECKPOINT_DIR` | no | `./checkpoints` | Directory for LangGraph SQLite checkpoint files |
| `LOG_LEVEL` | no | `INFO` | Python logging verbosity |

The provider is **auto-detected** from which API key is set. If both are set, the `MODEL_NAME` prefix is used as a tiebreaker (`claude-*` → Anthropic, `gemini-*` → Google).

---

## Usage

### Recommended entry point

Before launching, run the dedicated **pre-flight script** to verify the environment is ready:

```bash
node scripts/preflight-orchestrator.js             # basic checks
node scripts/preflight-orchestrator.js --plan path/to/plan.md  # also verify plan exists
node scripts/preflight-orchestrator.js --json       # machine-readable output
```

This validates: venv + `orchestrate` binary, `.env` configuration (MODEL_NAME + API key), MCP server dist freshness, and no conflicting orchestrator process. It is also available via `node scripts/cli.js preflight`.

Then use `node scripts/run-orchestrator.js` as the canonical way to launch the orchestrator.
It performs a **build freshness check** — if any file under `mcp-server/src/`
is newer than `mcp-server/dist/index.js` (or if `dist/` does not yet exist),
it automatically rebuilds the MCP server before starting the orchestrator.
This prevents silent failures caused by a stale compiled dist.

> **Pre-requisite:** Your Python virtual environment must be activated so that `orchestrate` is on `PATH`. Run `source orchestrator/.venv/bin/activate` (or the Windows equivalent) before invoking the script, or add the activation step to your shell profile.

```bash
# Activate your virtualenv first
source orchestrator/.venv/bin/activate

# Run from the workspace root
node scripts/run-orchestrator.js path/to/plan.md
node scripts/run-orchestrator.js path/to/plan.md --dry-run
```

> **Note:** You can still call `orchestrate` directly if you know the MCP
> server dist is already up to date. `node scripts/run-orchestrator.js` is simply the safer default.

### Basic run

```bash
python -m src.cli path/to/plan.md
```

Or if installed as a package:

```bash
orchestrate path/to/plan.md
```

### Common examples

```bash
# Specify model and iteration limit
orchestrate plan.md --model claude-sonnet-4-6 --max-iterations 50

# Override the target project path
orchestrate plan.md --project-path /path/to/my-project

# Dry run (prints routing decisions without calling agents)
orchestrate plan.md --dry-run

# Resume a previous run from the last checkpoint
orchestrate plan.md --resume <thread-id>

# Pause for human review before specific stages
orchestrate plan.md --interrupt-on pm,fail,synthesis

# Verbose logging
orchestrate plan.md --log-level DEBUG
```

### Locating a run's thread ID

The thread ID is printed at the start of every run and in the run summary under `Thread ID`. It looks like a UUID: `3fa85f64-5717-4562-b3fc-2c963f66afa6`.

---

## Architecture

```
                        ┌───────────────────────────────────────┐
                        │             LangGraph graph           │
                        │                                       │
          START ──────→ │  supervisor (router — no LLM call)    │
                        │       │                               │
                        │       │  Command(goto=...)            │
                        │       ↓                               │
                        │  pm ──────────────────────────────┐   │
                        │  developer ────────────────────── │   │
                        │  qa ───────────────────────────── │   │
                        │  security_auditor ─────────────── │─────supervisor
                        │  reviewer ─────────────────────── │   │
                        │  release_engineer ─────────────── │   │
                        │  docs ─────────────────────────── ┘   │
                        │                                       │
                        │  synthesis ─────────────────────→ END │
                        └───────────────────────────────────────┘
```

### Supervisor (deterministic router)

The supervisor is a pure-Python deterministic router — **no LLM calls** are made here. All routing is delegated to the MCP server's `ledger_get_next_action` tool, making the ledger the single source of truth for workflow progression. `ledger_get_project_status` is called for observability. `ledger_list_work_packages` detects two boundary conditions (empty project → PM, all terminal → synthesis) before entering the per-role dispatch loop.

| Ledger state / action | Routes to |
|---|---|
| No WPs yet | `pm` (create work packages) |
| `IMPLEMENT` / `REWORK` / `CONTINUE_PIPELINE` / `CLAIM_WP` / `RESUME_OR_CANCEL` | `developer` |
| `RUN_QA` | `qa` |
| `RUN_SECURITY_AUDIT` | `security_auditor` |
| `RUN_REVIEW` | `reviewer` |
| `RUN_RELEASE_ENGINEERING` / `REWORK` | `release_engineer` |
| `WRITE_DOCS` / `FINALIZE_WP` / `UPDATE_CRITERIA` | `docs` |
| `REPAIR_ORPHAN_BLOCKED` / `UNBLOCK_WP` / `REVIEW_*` | `pm` (PM intervention) |
| All roles return `WAIT` | `synthesis` |
| All WPs COMPLETE or CANCELLED | `synthesis` (final report) |
| `iteration >= max_iterations` | `END` (safety limit) |
| WP accumulates ≥ 3 consecutive stage failures | Circuit-breaker: WP skipped for remainder of run |

For the full routing algorithm, action sets, and circuit-breaker mechanics, see [docs/supervisor-routing.md](docs/supervisor-routing.md).

### Stage nodes

Each stage node emits a `stage_start` event, loads a persona prompt, wraps the shared MCP tools (auto-injecting `project_path`), creates a **Deep Agent**, invokes it, and emits `stage_complete` (with `duration_s`) followed by a best-effort `pipeline_result` read-back. The 8 pipeline stages are: `pm`, `developer`, `qa`, `security_auditor`, `reviewer`, `release_engineer`, `docs`, `synthesis`. For internals, see [docs/architecture.md](docs/architecture.md).

---

## Folder Overview

| Path | Purpose |
|------|---------|
| `src/supervisor.py` | Pure-Python deterministic router (no LLM calls) |
| `src/graph.py` | LangGraph `StateGraph` assembly and compilation |
| `src/state.py` | `WorkflowState` TypedDict with annotated reducers |
| `src/cli.py` | CLI entry point (`orchestrate` command) |
| `src/config.py` | `.env` loading, provider auto-detection, pipeline routing constants derived from `shared/workflow-manifest.json` |
| `src/mcp_client.py` | MCP server subprocess lifecycle (`MCPToolkit`) |
| `src/nodes/` | Stage node factories (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis) |
| `src/utils/` | Tool wrappers, persona loader, plan parser, JSONL logger, cross-platform file locking, MCP response parser (`mcp_parse.py`) |
| `tests/` | 374 tests — unit, integration (ScriptedLedger), and live marks |
| `docs/` | Technical deep-dives (architecture, routing, log schema, smoke tests) |

---

## Documentation Index

| Document | Content |
|----------|---------|
| [docs/architecture.md](docs/architecture.md) | Stage node lifecycle, MCP tool wrapping, WorkflowState fields, JSONL log entry types |
| [docs/supervisor-routing.md](docs/supervisor-routing.md) | Full routing algorithm, special exits, action sets, circuit-breaker |
| [docs/jsonl-log-schema.md](docs/jsonl-log-schema.md) | Complete JSONL field reference (stage lifecycle events, routing events, run lifecycle events) |
| [docs/smoke-testing.md](docs/smoke-testing.md) | Runbook for verifying the dispatch loop |
| [docs/public-api.md](docs/public-api.md) | Public functions, classes, and entry points |


---

## CLI Reference

```
orchestrate <plan-document-path> [options]

Positional arguments:
  plan-document-path    Path to the plan .md file

Options:
  --project-path PATH   Override target codebase path
                        (default: workspace root inferred from plan directory)
  --max-iterations N    Override MAX_ITERATIONS from .env
  --model MODEL         Override MODEL_NAME from .env
  --resume THREAD_ID    Resume from a previous checkpoint
                        (requires the `checkpoint` extra: pip install -e ".[checkpoint]")
  --dry-run             Print routing decisions without calling agents
  --log-level LEVEL     DEBUG | INFO | WARNING | ERROR | CRITICAL
  --interrupt-on STAGES Comma-separated list of stages to pause at
                        Valid values: pm, fail, synthesis
                        Example: --interrupt-on pm,synthesis
  -h, --help            Show this help message
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Workflow completed successfully |
| `1` | One or more errors occurred |
| `2` | Safety limit reached (`--max-iterations` exceeded) |

---

## Troubleshooting

### `MCP server error: [Errno 2] No such file or directory`

The MCP server binary is not built. Run:
```bash
cd mcp-server && npm install && npm run build
```

### `Root index not found` or routing behaves unexpectedly

The MCP server `dist/` is stale — compiled before a recent change to `mcp-server/src/`. Rebuild:
```bash
cd mcp-server && npm run build
```
Always rebuild after pulling commits that touch `mcp-server/src/`.

### `node: command not found` when the orchestrator starts

The MCP server runs as a Node.js subprocess. Ensure `node` is on your `PATH`:
```bash
# macOS / Linux — example (adjust path as needed)
export PATH="/usr/local/bin:$PATH"
node --version   # should print v18 or higher
```
On macOS with Homebrew: `brew install node`. On Windows: use the Node.js installer from nodejs.org.

### `configuration error: MODEL_NAME is not set`

Add `MODEL_NAME=<model-id>` to `orchestrator/.env`.

### `No LLM provider API key found`

Add `ANTHROPIC_API_KEY=sk-ant-...` or `GOOGLE_API_KEY=AIza...` to `orchestrator/.env`.
Install the matching extra: `pip install -e ".[anthropic]"` or `pip install -e ".[google]"`.

### `Both ANTHROPIC_API_KEY and GOOGLE_API_KEY are set`

Use a `MODEL_NAME` with a clear prefix (`claude-*` or `gemini-*`) so the provider can be auto-detected, or remove the unused key from `.env`.

### Checkpoint corruption (Windows)

If a run crashes mid-checkpoint, delete `checkpoints/workflow.sqlite` before restarting.
SQLite WAL mode reduces but does not eliminate the risk of partial writes on Windows.

### `asyncio_mode` warning in pytest output

This is a harmless misconfiguration warning from `pyproject.toml` — pytest-anyio reads the option but it has no effect on non-async tests.

### `UserWarning: Core Pydantic V1 functionality isn't compatible with Python 3.14 or greater`

This warning is emitted by `langchain-core` on every import when running Python 3.14+. It originates from `pydantic`'s internal v1 compatibility shim, which the current `langchain-core` release still imports. The warning:

- **Does not affect correctness** — all tests pass and the orchestrator runs normally.
- **Is not a `CompatibilityWarning`** — it is a plain `UserWarning` from `pydantic.v1`, so it cannot be silenced with `-W error::CompatibilityWarning`.
- **Will resolve upstream** when `langchain-core` drops the pydantic v1 shim entirely.

To suppress the noise in test output in the meantime, add the following to `pyproject.toml` under `[tool.pytest.ini_options]`:

```toml
[tool.pytest.ini_options]
filterwarnings = [
    "ignore::UserWarning:pydantic.v1",
]
```

Alternatively, downgrade to Python 3.13 where pydantic's v1 shim does not emit the warning.

---

## Running Tests

> **Dev dependencies:** The full test suite requires `pytest-asyncio`, `aiosqlite`, and `langgraph-checkpoint-sqlite`. These are listed in `requirements.txt` as runtime dependencies but must be explicitly present in the test environment. If you see `"async functions are not natively supported"` or `ModuleNotFoundError` errors, install them manually:
> ```bash
> pip install pytest-asyncio aiosqlite langgraph-checkpoint-sqlite
> ```

```bash
cd orchestrator

# All unit tests (no MCP server or LLM required) — 375 tests, 1 skip, ~1 s
python -m pytest tests/ -v

# Integration tests only (ScriptedLedger — no MCP server or LLM required)
python -m pytest tests/test_integration.py -m integration -v

# Integration + unit tests together
python -m pytest tests/ -m "integration or not integration" -v

# Live infrastructure tests (requires built MCP server + valid API key)
python -m pytest tests/test_integration.py -m live -v

# Verbose output (shows supervisor routing decisions)
python -m pytest tests/test_integration.py -m integration -v -s
```

Tests are structured as:

| File | What it tests |
|------|---------------|
| `test_supervisor.py` | Supervisor routing paths: ledger-driven action dispatch (all action types × all roles), all-WAIT synthesis routing, circuit-breaker increment/reset/halt, unknown-action forward-compatibility guard (mocked MCP); `_derive_next_action` test helper — PASS-branch and FAIL-branch routing both manifest-derived via `PIPELINE_AGENT_MAP`/`FAIL_ROUTING_AGENT_MAP` (no hard-coded role strings); dedicated routing classes for all pipeline stages including `TestRouteToSecurityAuditor`, `TestRouteToReleaseEngineer`, and `TestDocumentationFail`; `TestProgressSnapshot` (4 tests — emitted every iteration with correct fields, elapsed_s guard); `TestWPStatusChangeEvents` (4 tests — change detection, wp_complete sub-event, first-iteration guard); `TestPrevWPSummariesStored` (1 test); `TestEnrichedRouteEvents` (2 tests — prev_stage/wp_id/result on route entries); `TestReworkDetectedEvent` (2 tests) |
| `test_config.py` | Manifest-derived config constants: `WP_TERMINAL_STATUSES`, `VALID_STAGES`, `PIPELINE_TYPES`, `ROLE_IDS`, `PIPELINE_ROLE_NAMES`, `FAIL_ROUTING_AGENT_MAP`, and `PIPELINE_AGENT_MAP` — structural assertions (type, non-emptiness, key membership, ordering) that tolerate future manifest additions; guards for orchestrating-role exclusion (Planner, Synthesis) and Release Engineer ID normalisation; `TestPipelineAgentMap` pins all pipeline-type-to-agent mappings and cross-validates against `PIPELINE_ROLE_NAMES` |
| `test_nodes.py` | 6 stage-node factories, prompt builders, and `inject_project_path` tool-wrapping integration; `TestStageStartEvent` (4 tests — `stage_start` emitted before agent invocation, correct fields); `TestDurationS` (12 parametrized tests — `duration_s` on both `stage_complete` and `stage_error` across all 6 factories); `TestPipelineResult` (7 tests — successful read-back emission, read-back failure isolation, no-pipeline guard) |
| `test_tool_wrappers.py` | `inject_project_path` behavioural contracts: injection when absent, no-override when present, `cwd_path` suppression, argument preservation, idempotency sentinel, non-dict passthrough, return-value identity, multi-tool |
| `test_graph.py` | Graph topology, edges, compilation |
| `test_cli.py` | Argument parsing, interrupt mapping, exit codes |
| `test_state.py` | WorkflowState schema and reducer semantics |
| `test_plan_parser.py` | Plan document parsing (title, summary, edge cases) |
| `test_filelock.py` | Cross-platform file locking: successful acquire, contention raises `OSError`, double-unlock idempotency |
| `test_logging.py` | `_format_duration` edge cases (None, 0, sub-minute, multi-minute, multi-hour); all 7 new event-type console format patterns (`stage_start`, `stage_complete`, `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`); existing event-type stability (generic fallback unchanged); robustness against missing/null fields — 48 tests |
| `test_integration.py` | End-to-end graph execution (7 scenarios, ScriptedLedger) |

### Integration Tests (`test_integration.py`)

Integration tests run the real LangGraph supervisor against scripted MCP-tool mocks (`ScriptedLedger`). **No MCP server build or LLM API key is required.** All 7 tests run in under 1 second total.

| Test | Covers |
|------|--------|
| `test_happy_path_full_pipeline` | PM → Developer → QA → Reviewer → Docs → Synthesis in order |
| `test_rework_loop_qa_fail_then_pass` | QA FAIL → Developer rework → QA PASS → Reviewer → Synthesis |
| `test_multi_wp_dependency_ordering` | WP-002 waits for WP-001 COMPLETE before it starts |
| `test_safety_limit_terminates_at_configured_limit` | `max_iterations=3` triggers the safety-limit halt at the configured ceiling |
| `test_checkpoint_resume` | Interrupt before `developer`, resume from checkpoint, verify continuation |
| `test_integration_marker_applied` | Meta-test: all integration tests carry `@pytest.mark.integration` |
| `test_in_memory_state_isolated_between_runs` | Each test gets an independent `ScriptedLedger`; no shared state |

**`ScriptedLedger`** is the key fixture. It accepts a list of pre-scripted state dicts that model realistic ledger responses (`project_status`, `wp_list`, `wp_details`). Each stage-node stub records its name in `execution_log` and calls `ledger.advance()` to move to the next scripted state, so the supervisor sees the correct post-execution result on its next iteration.

#### Marks

| Mark | Purpose | Run with |
|------|---------|----------|
| `@pytest.mark.integration` | ScriptedLedger tests (fast, no external services) | `-m integration` |
| `@pytest.mark.live` | Real MCP server + LLM — skipped by default | `-m live` |

---

## Linting

[ruff](https://docs.astral.sh/ruff/) is the linter and formatter for `orchestrator/src/`. It is included in the `dev` extras.

```bash
cd orchestrator

# Check for linting issues (zero warnings expected)
ruff check src/

# Auto-fix safe issues
ruff check --fix src/

# Format source files
ruff format src/
```

The project maintains a zero-warning `ruff` baseline. The active rule set is defined in `pyproject.toml` under `[tool.ruff.lint]`.

> **CI enforcement:** Both `pytest` and `ruff check src/` run on every push and pull request to `main` via `.github/workflows/ci.yml`. All tests must pass and `ruff` must exit 0 before a PR can be merged.


```