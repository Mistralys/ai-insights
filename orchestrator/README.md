# AI Insights Orchestrator

A headless, deterministic alternative to IDE-based agent workflows. The orchestrator uses **LangGraph** for graph-based supervisor routing and **Deep Agents** (via LangChain) for coding-agent execution within each pipeline stage. It is driven by the same MCP server and persona prompts as the IDE workflow.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [CLI Reference](#cli-reference)
- [Troubleshooting](#troubleshooting)
- [Running Tests](#running-tests)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Tested on 3.13 |
| Node.js | 18+ | Required to run the MCP server |
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

# 4. Configure environment
cp .env.example .env
# Edit .env with your API key (see Configuration section)

# 5. Build the MCP server (required — runs in a subprocess at runtime)
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
MODEL_NAME=claude-sonnet-4-6-20250929

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
| `MODEL_NAME` | **yes** | — | LLM model identifier (e.g. `claude-sonnet-4-6-20250929`) |
| `ANTHROPIC_API_KEY` | one of | — | API key for Anthropic Chat models |
| `GOOGLE_API_KEY` | one of | — | API key for Google AI Studio / Gemini models |
| `MAX_ITERATIONS` | no | `100` | Maximum supervisor loop iterations before abort |
| `CHECKPOINT_DIR` | no | `./checkpoints` | Directory for LangGraph SQLite checkpoint files |
| `LOG_LEVEL` | no | `INFO` | Python logging verbosity |

The provider is **auto-detected** from which API key is set. If both are set, the `MODEL_NAME` prefix is used as a tiebreaker (`claude-*` → Anthropic, `gemini-*` → Google).

---

## Usage

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
orchestrate plan.md --model claude-sonnet-4-6-20250929 --max-iterations 50

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

### Stage nodes (Deep Agents)

Each stage node:
1. Reads the persona Markdown from `personas/ledger/vs-code/<N>-<role>.md`.
2. Calls `llm.invoke([SystemMessage(persona), HumanMessage(prompt)])`.
3. Returns a state update with `stage_result`, `stage_success`, and a `run_log` entry.

The supervisor's MCP tool calls handle all ledger mutations (start pipelines, complete pipelines, mark WPs COMPLETE).

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

---

## Running Tests

```bash
cd orchestrator

# All unit tests (no MCP server or LLM required) — 154 tests, ~1 s
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
| `test_supervisor.py` | All 12 supervisor routing paths (mocked MCP) |
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
| `test_safety_limit_terminates_cleanly` | `max_iterations=3` raises `RuntimeError` before runaway loop |
| `test_checkpoint_resume` | Interrupt before `developer`, resume from checkpoint, verify continuation |
| `test_integration_marker_applied` | Meta-test: all integration tests carry `@pytest.mark.integration` |
| `test_in_memory_state_isolation` | Each test gets an independent `ScriptedLedger`; no shared state |

**`ScriptedLedger`** is the key fixture. It accepts a list of pre-scripted state dicts that model realistic ledger responses (`project_status`, `wp_list`, `wp_details`). Each stage-node stub records its name in `execution_log` and calls `ledger.advance()` to move to the next scripted state, so the supervisor sees the correct post-execution result on its next iteration.

#### Marks

| Mark | Purpose | Run with |
|------|---------|----------|
| `@pytest.mark.integration` | ScriptedLedger tests (fast, no external services) | `-m integration` |
| `@pytest.mark.live` | Real MCP server + LLM — skipped by default | `-m live` |

