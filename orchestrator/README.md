# AI Insights Orchestrator

A headless, deterministic alternative to IDE-based agent workflows. The orchestrator uses **LangGraph** for graph-based supervisor routing and **Deep Agents** (via LangChain) for coding-agent execution within each pipeline stage. It is driven by the same MCP server and persona prompts as the IDE workflow.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Recommended entry point](#recommended-entry-point)
  - [Basic run](#basic-run)
  - [Common examples](#common-examples)
- [Architecture](#architecture)
- [Supervisor Routing Model](#supervisor-routing-model)
- [JSONL Log Schema](#jsonl-log-schema)
- [Smoke-Testing the Dispatch Loop](#smoke-testing-the-dispatch-loop)
- [CLI Reference](#cli-reference)
- [Troubleshooting](#troubleshooting)
- [Running Tests](#running-tests)

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

# Optional: enable --resume checkpoint support (SQLite-backed graph snapshots)
pip install -e ".[checkpoint]"

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

Use `./orchestrator/run.sh` as the canonical way to launch the orchestrator.
It performs a **pre-flight build check** — if any file under `mcp-server/src/`
is newer than `mcp-server/dist/index.js` (or if `dist/` does not yet exist),
it automatically rebuilds the MCP server before starting the orchestrator.
This prevents silent failures caused by a stale compiled dist.

> **Pre-requisite:** Your Python virtual environment must be activated so that `orchestrate` is on `PATH`. Run `source orchestrator/.venv/bin/activate` (or the Windows equivalent) before invoking `run.sh`, or add the activation step to your shell profile.

```bash
# Make executable once (after cloning or pulling)
chmod +x orchestrator/run.sh

# Activate your virtualenv first
source orchestrator/.venv/bin/activate

# Run from the workspace root
./orchestrator/run.sh path/to/plan.md
./orchestrator/run.sh path/to/plan.md --dry-run
```

> **Note:** You can still call `orchestrate` directly if you know the MCP
> server dist is already up to date. `./run.sh` is simply the safer default.

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
                        │             LangGraph graph            │
                        │                                        │
          START ──────→ │  supervisor (router — no LLM call)    │
                        │       │                                │
                        │       │  Command(goto=...)             │
                        │       ↓                                │
                        │  pm ──────────────────────────────┐   │
                        │  developer ────────────────────── │   │
                        │  qa ───────────────────────────── │── supervisor
                        │  reviewer ─────────────────────── │   │
                        │  docs ─────────────────────────── ┘   │
                        │                                        │
                        │  synthesis ──────────────────────→ END │
                        └───────────────────────────────────────┘
```

### Supervisor (deterministic router)

The supervisor reads the current ledger state (via MCP tools) and routes to
the next appropriate stage:

| Ledger state | Routes to |
|---|---|
| No WPs yet | `pm` (create work packages) |
| WP with no pipelines | `developer` (implement) |
| PASS implementation, no QA | `qa` |
| FAIL QA | `developer` (rework) |
| PASS QA, no code-review | `reviewer` |
| FAIL code-review | `developer` (rework) |
| PASS code-review, no docs | `docs` |
| PASS docs | synthesis (after marking WP COMPLETE) |
| All WPs COMPLETE | `synthesis` (final report) |
| All WPs BLOCKED | `END` (with error) |
| `iteration >= max_iterations` | `END` (safety limit) |
| Any pipeline `IN_PROGRESS` for a WP | Skip that WP this iteration |
| All actionable WPs skipped (in-flight or circuit-broken) | `END` (no dispatch possible) |
| WP accumulates ≥ 3 consecutive stage failures | `END` (circuit-breaker halt, `level=WARNING`) |

### Stage nodes (Deep Agents)

Each stage node:
1. Reads the persona Markdown from `personas/ledger/vs-code/<N>-<role>.md`.
2. Calls `llm.invoke([SystemMessage(persona), HumanMessage(prompt)])`.
3. Returns a state update with `stage_result`, `stage_success`, and a `run_log` entry.

The supervisor's MCP tool calls handle all ledger mutations (start pipelines, complete pipelines, mark WPs COMPLETE).

### WorkflowState fields (key additions)

| Field | Type | Description |
|-------|------|-------------|
| `consecutive_failures` | `dict` | Per-WP consecutive failure counter (`{wp_id: count}`). Reset to `{}` on success. The supervisor halts a WP after ≥ 3 consecutive failures. |
| `run_log` | `list` (append-only) | JSONL-style log entries. Each entry carries a `level` field: `"INFO"` for normal routing, `"WARNING"` for safety/circuit-breaker halts, `"ERROR"` for MCP or stage errors. |
| `wps_completed_this_run` | `int` | Running total of work packages completed during the current run. Incremented by the supervisor each pass when a WP transitions to COMPLETE. Printed in the run summary as "This run : N WP(s) completed this run". |
| `stage_success` | `bool` | Set by each stage node after execution. `True` means the agent finished without raising an exception (the best available proxy for “at least one PASS pipeline produced” at node level). `False` means the stage raised an error. Read by the supervisor circuit-breaker. |
| `pending_wp_count` | `int` | Count of WPs in a non-terminal status (i.e. not COMPLETE and not CANCELLED). Used by the supervisor to determine whether all work is done and synthesis routing is appropriate. |

All other `WorkflowState` fields are documented in `orchestrator/src/state.py`.

### JSONL log entry types

Each run writes a JSONL file to `orchestrator/logs/` (path printed at run start). Key entry types:

| `action` value | Emitted by | Key fields |
|---|---|---|
| `stage_complete` | `nodes/__init__.py` | `stage`, `wp_id`, `result` (`"PASS"` / `"FAIL"`), `tokens_used` (dict or `null`) |
| `supervisor_route` | `supervisor.py` | `stage`, `level` (`"INFO"` / `"WARNING"`), `next_node` |
| `run_error` | `cli.py` | `stage="cli"`, `level="ERROR"`, `error` (message string), `thread_id` |
| `run_end` | `cli.py` | `stage="cli"`, `result` (`"COMPLETE"` / `"ERROR"`), `level` (`"INFO"` / `"ERROR"`), `thread_id` |

**`tokens_used`** on `stage_complete` entries: a dict with LangChain `usage_metadata` keys (`input_tokens`, `output_tokens`, `total_tokens`) when the LLM returns usage data, or `null` when metadata is absent (e.g. streaming responses or providers that omit token counts).

**`level`** on `run_end` entries: `"INFO"` when the workflow completed without error; `"ERROR"` when errors were captured in `outside_errors` before the run finished.

> **Full field reference:** For the complete per-field type and description table (including all 11 fields), see the [JSONL Log Schema](#jsonl-log-schema) section.

---

## Supervisor Routing Model

The supervisor is a pure-Python deterministic router — no LLM calls are made here. It reads the current ledger state via three MCP tools (`ledger_get_project_status`, `ledger_list_work_packages`, `ledger_get_work_package`) and returns a LangGraph `Command` routing the graph to the next stage.

### Special Exits (checked first, in order)

```
supervisor_node
  ├─ iteration > max_iterations        → __end__   (safety limit; level=WARNING)
  ├─ All WPs terminal (COMPLETE or CANCELLED) → synthesis
  └─ All actionable WPs skipped        → __end__   (all in-flight or circuit-broken; level=WARNING)
```

### Standard Routing (per WP — first actionable WP wins)

```
  no WPs in ledger                     → pm
  no actionable WPs (all BLOCKED)      → __end__

  Per-WP pipeline state machine:
    no pipelines / impl FAIL           → developer
    impl IN_PROGRESS                   → skip (in-flight; do not re-dispatch)
    impl PASS, no qa                   → qa
    qa IN_PROGRESS                     → skip (in-flight)
    qa FAIL                            → developer  (rework)
    qa PASS, no code-review            → reviewer
    code-review IN_PROGRESS            → skip (in-flight)
    code-review FAIL                   → developer  (rework)
    code-review PASS, no docs          → docs
    docs IN_PROGRESS                   → skip (in-flight)
    docs FAIL                          → docs       (retry)
    docs PASS                          → WP fully done; continue to next WP
    circuit-breaker ≥ 3 failures       → skip WP, record error entry

  all actionable WPs processed         → synthesis
```

### Circuit-Breaker

The `consecutive_failures` field in `WorkflowState` tracks per-WP failure counts. Each supervisor pass:
- **Increments** the counter for the previous WP if `stage_success` is `False`.
- **Resets** the counter when `stage_success` is `True`.

A WP that accumulates **≥ 3 consecutive failures** is skipped for the remainder of the run. If all actionable WPs are skipped (all circuit-broken or all in-flight), the supervisor routes to `__end__` with a `level=WARNING` halt entry.

Source of truth: `orchestrator/src/supervisor.py`.

---

## JSONL Log Schema

Every run writes a JSONL file to `orchestrator/logs/` (path printed at run start). Each line is a JSON object. The full field reference:

| Field | Present In | Type | Description |
|-------|-----------|------|-------------|
| `timestamp` | all entries | ISO 8601 string | Wall-clock time of the event (UTC) |
| `stage` | all entries | string | Node/stage name (e.g. `"supervisor"`, `"developer"`, `"cli"`) |
| `wp_id` | stage events | string | Work package ID being processed (e.g. `"WP-003"`); empty string for supervisor-level events |
| `action` | all entries | string | Event type (e.g. `"route"`, `"stage_complete"`, `"halt"`, `"run_start"`, `"run_end"`) |
| `destination` | routing events | string | Next LangGraph node name (e.g. `"developer"`, `"__end__"`) |
| `result` | `stage_complete` | string | `"PASS"` or `"FAIL"` |
| `level` | all entries | string | `"INFO"` for normal events; `"WARNING"` for safety/circuit-breaker halts; `"ERROR"` for MCP or stage errors |
| `error` | error entries | string | Error message (only present when `level` is `"ERROR"`) |
| `tokens_used` | `stage_complete` | dict or null | `{"input_tokens": N, "output_tokens": N, "total_tokens": N}` when the LLM returns usage metadata; `null` when absent |
| `thread_id` | `run_start`, `run_end` | string | LangGraph thread identifier (UUID) for checkpoint/resume |
| `dry_run` | `run_start` | boolean | `true` when `--dry-run` flag was passed |

---

## Smoke-Testing the Dispatch Loop

Use this runbook to verify the supervisor dispatch loop is working correctly against a fresh ledger project without running the full agent pipeline.

### 1. Prepare a test ledger project

Create a dedicated plan directory with 2–3 work packages in `READY` state and no in-flight pipelines. Use the MCP server tools (or create `.json` files directly under `.ledger/`) to initialise a minimal project:

```bash
# Example: use the orchestrator CLI in dry-run mode against an existing plan
orchestrate docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

Alternatively, use `./orchestrator/run.sh` from the workspace root:

```bash
source orchestrator/.venv/bin/activate
./orchestrator/run.sh docs/agents/plans/my-test-plan/plan.md --dry-run --max-iterations 5
```

### 2. Expected console output (dry-run)

For a project with two `READY` WPs (WP-001, WP-002, no dependencies):

```
[INFO] Supervisor iteration 1: routing WP-001 → developer
[INFO] Supervisor iteration 2: routing WP-002 → developer
[INFO] Supervisor iteration 3: all WPs COMPLETE → synthesis
```

In `--dry-run` mode no agents are called — only the routing decisions are executed.

### 3. Inspect the JSONL log

The JSONL log is written to `orchestrator/logs/<timestamp>-<plan-title>.jsonl`. To verify routing decisions:

```bash
# Print all routing events
grep '"action": "route"' orchestrator/logs/<your-log-file>.jsonl | python3 -m json.tool

# Check for any WARNING or ERROR level entries
grep -E '"level": "(WARNING|ERROR)"' orchestrator/logs/<your-log-file>.jsonl

# Count stage dispatches
grep '"action": "route"' orchestrator/logs/<your-log-file>.jsonl | wc -l
```

### 4. Verifying dispatch correctness

| What to check | How |
|---|---|
| Correct first dispatch | First `"action": "route"` entry should have `"destination": "developer"` for a fresh WP |
| No duplicate dispatches | Each WP ID should appear at most once per routing sweep |
| Safety limit behaviour | Run with `--max-iterations 2`; verify the log ends with `"action": "safety_limit"` at `"level": "WARNING"` |
| Circuit-breaker halt | Manually set `consecutive_failures` ≥ 3 in state; verify `"action": "halted_repeated_failure"` |

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

```bash
cd orchestrator

# All unit tests (no MCP server or LLM required) — 160 tests, 1 skip, ~1 s
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
| `test_supervisor.py` | Supervisor routing paths: standard pipeline state machine, in-flight WP skip, all-in-flight halt, circuit-breaker increment/reset/halt (mocked MCP) |
| `test_nodes.py` | 6 stage-node factories and prompt builders |
| `test_graph.py` | Graph topology, edges, compilation |
| `test_cli.py` | Argument parsing, interrupt mapping, exit codes |
| `test_state.py` | WorkflowState schema and reducer semantics |
| `test_plan_parser.py` | Plan document parsing (title, summary, edge cases) |
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

