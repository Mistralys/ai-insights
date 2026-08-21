---
title: Orchestrator User Guide
---

# Orchestrator User Guide

This guide walks you through running the orchestrator end-to-end — from writing a plan document to reviewing the final synthesis report. For installation and environment setup, see the [orchestrator README](../../orchestrator/README.md#installation).

---

## Table of Contents

- [What the Orchestrator Does](#what-the-orchestrator-does)
- [When to Use the Orchestrator](#when-to-use-the-orchestrator)
- [Current Limitations](#current-limitations)
- [Preparing a Plan](#preparing-a-plan)
- [Running a Workflow](#running-a-workflow)
- [Understanding the Output](#understanding-the-output)
- [Pausing and Resuming](#pausing-and-resuming)
- [Monitoring a Run](#monitoring-a-run)
- [Example: End-to-End with the GUI](#example-end-to-end-with-the-gui)
- [Troubleshooting](#troubleshooting)

---

## What the Orchestrator Does

The orchestrator is a headless, automated alternative to the IDE-based agent workflow. Instead of manually pasting persona prompts and switching chat sessions for each stage, the orchestrator drives the full 9-stage pipeline unattended:

1. **Project Manager** — decomposes the plan into work packages and registers them in the ledger.
2. **Developer** — implements each work package.
3. **QA** — validates acceptance criteria and runs tests.
4. **Security Auditor** — performs vulnerability and dependency checks.
5. **Reviewer** — reviews code quality and architecture.
6. **Release Engineer** — curates changelogs, versioning, and release artifacts.
7. **Documentation** — updates project documentation.
8. **Synthesis** — consolidates results and writes a final project report.

A deterministic **supervisor** routes work between these stages. It makes no LLM calls of its own — all routing decisions come from the MCP server's `ledger_get_next_action` tool, so the ledger is always the single source of truth.

---

## When to Use the Orchestrator

The orchestrator works best when:

- You have a **complete plan document** and want hands-off execution.
- The work stays within a **single project** (single repository, single codebase root).
- You want **deterministic, repeatable** runs that produce structured JSONL logs.
- You prefer reviewing results after the pipeline finishes rather than supervising each stage interactively.

Use the **IDE-based workflow** (manual persona pasting or the Ledger Claude Coordinator) when you want fine-grained control over individual stages — for example, iterating on a plan with the Planner, or reviewing QA results before the Reviewer runs.

---

## Current Limitations

Keep these constraints in mind when deciding whether the orchestrator is the right tool for a task:

| Limitation | Detail |
|---|---|
| **Single-project scope** | The orchestrator targets one codebase root per run. Multi-repo workspaces and cross-repository plans are not supported — each plan should stay within the bounds of a single project. Use `--project-path` to point at the correct root if inference fails. |
| **No browser tool** | Agents running inside the orchestrator do not have access to a browser or web-search tool. They cannot fetch URLs, search the web, or interact with web pages. All information the agents need must be available locally — in the codebase, the plan document, or the MCP ledger. |
| **No interactive input** | Once a run starts, agents cannot ask you questions. Everything they need must be specified in the plan or discoverable from the project. If an agent gets stuck, it records an error and the supervisor moves on. |
| **No GUI interaction** | Agents operate through a shell backend and MCP tools only. They cannot open editors, launch applications, or interact with desktop UIs. |
| **API key required** | Every run requires a valid LLM provider API key (Anthropic or Google AI Studio) configured in `orchestrator/.env`. |

---

## Preparing a Plan

The orchestrator takes a Markdown plan document as its primary input. Plans follow the AI Insights convention and live at:

```
<project-root>/docs/agents/plans/<slug>/plan.md
```

The `<slug>` is typically a date-prefixed descriptor: `2026-07-17-add-search-feature`.

### Plan structure

A plan document should include:

- **Title** — a clear, concise name for the work.
- **Summary** — 2–3 sentences describing the goal (used as the project summary in the ledger).
- **Scope and requirements** — what needs to change, acceptance criteria, constraints.
- **Implementation details** — enough specificity that the Developer agent can act without ambiguity.

### Writing effective plans

- **Be explicit about file paths** — agents work from the plan text, so reference specific files and directories.
- **Include acceptance criteria** — the QA agent validates these, so vague criteria lead to vague validation.
- **Note what is out of scope** — this prevents agents from expanding beyond the intended work.
- **Mention testing expectations** — whether to add unit tests, integration tests, or update existing ones.
- **Keep it self-contained** — since agents have no browser or web access, all necessary context must be in the plan or the local codebase.

### Creating a plan with the Planner agent

You can write the plan manually or use the **Planner agent** (Stage 1 of the IDE workflow) to draft one interactively in your IDE before handing it to the orchestrator:

```bash
# In your IDE: paste the Planner persona, describe the feature,
# and review the generated plan at docs/agents/plans/<slug>/plan.md
```

---

## Running a Workflow

### Pre-flight check

Before your first run (or after pulling changes), verify the environment is ready:

```bash
./menu.sh preflight
```

This checks the Python virtual environment, `.env` configuration, MCP server build freshness, and the absence of conflicting processes.

### Starting a run

```bash
# Via the CLI menu (recommended)
./menu.sh orchestrator docs/agents/plans/2026-07-17-add-search/plan.md

# Direct invocation (requires venv activated)
orchestrate docs/agents/plans/2026-07-17-add-search/plan.md
```

The orchestrator will:
1. Parse the plan document.
2. Start the MCP server as a subprocess.
3. Route the plan through all configured pipeline stages.
4. Write a JSONL log and a `.orchestrator-run.json` sidecar file.
5. Print a summary when complete.

### Common options

| Option | Example | Purpose |
|---|---|---|
| `--dry-run` | `orchestrate plan.md --dry-run` | Print routing decisions without calling agents. Use this to verify the supervisor would route correctly. |
| `--project-path` | `orchestrate plan.md --project-path /path/to/repo` | Override the auto-inferred project root. Required when the plan does not live at `<project>/docs/agents/plans/<slug>/`. |
| `--max-iterations` | `orchestrate plan.md --max-iterations 50` | Cap the supervisor loop. The default is 100 (configurable via `MAX_ITERATIONS` in `.env`). |
| `--log-level` | `orchestrate plan.md --log-level DEBUG` | Increase console verbosity. Useful for diagnosing routing issues. |
| `--interrupt-on` | `orchestrate plan.md --interrupt-on pm,synthesis` | Pause for human review before specified stages (see [Pausing and Resuming](#pausing-and-resuming)). |
| `--resume` | `orchestrate plan.md --resume <thread-id>` | Resume a previously interrupted or paused run from its last checkpoint. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Workflow completed successfully. |
| `1` | One or more errors occurred during the run. |
| `2` | Safety limit reached (`--max-iterations` exceeded). |

---

## Understanding the Output

### Console output

During execution, the console shows supervisor routing decisions, stage start/complete events, and a final summary with the thread ID, duration, and result.

### JSONL log

Every run produces a structured JSONL log file:

- **During the run:** `orchestrator/logs/<timestamp>-<plan-title>.jsonl`
- **After completion:** copied to `mcp-server/storage/ledger/<repo-name>/<slug>/orchestrator/logs/`

Each line is a JSON object recording an event — stage starts, completions, routing decisions, errors, tool calls, and more. See [jsonl-log-schema.md](../../orchestrator/docs/jsonl-log-schema.md) for the full field reference.

Quick inspection:

```bash
# Human-readable colored output (via the workspace menu)
./menu.sh read-log <path-to-log.jsonl>

# Errors only
./menu.sh read-log <path-to-log.jsonl> --errors

# Raw JSON (for scripting)
node scripts/read-log.js <path-to-log.jsonl> --format json
```

### Run metadata sidecar

A `.orchestrator-run.json` file is written to the plan directory at run start and updated on completion. It records the thread ID, timing, result, and process ID — useful for the GUI dashboard and for scripting.

### Dialogue captures

By default (`CAPTURE_DIALOGUES=true`), the orchestrator writes the full agent dialogue for each stage to disk as a Markdown file. The path is logged as a `dialogue_captured` event in the JSONL log. Disable with `CAPTURE_DIALOGUES=false` in `.env` to save disk space.

### Synthesis report

When the workflow completes, the Synthesis agent writes a `synthesis.md` report in the plan directory summarising the work done, decisions made, and any insights collected.

---

## Pausing and Resuming

### Interrupt-on breakpoints

Use `--interrupt-on` to pause the run before specific stages for human review:

```bash
orchestrate plan.md --interrupt-on pm,synthesis
```

| Breakpoint | Pauses before | Use case |
|---|---|---|
| `pm` | The Project Manager stage | Review work package decomposition before implementation begins. |
| `fail` | The Developer stage (on rework) | Inspect QA or review failures before the developer attempts a fix. |
| `synthesis` | The Synthesis stage | Review all completed work before the final report is written. |

When a breakpoint is reached, the run exits cleanly (exit code 0) and the thread ID is printed. No terminal marker is written, so the run can be resumed.

### Resuming a paused run

```bash
orchestrate plan.md --resume <thread-id>
```

The thread ID is printed at run start and in every run summary. The orchestrator picks up from the last LangGraph checkpoint and continues.

### Signal interrupts

Pressing `Ctrl+C` (SIGINT) or sending SIGTERM triggers a graceful shutdown:

1. The current agent task is cancelled.
2. A `signal_shutdown` event is logged.
3. The process exits with code 1.

Because no terminal marker is written, signal-interrupted runs can also be resumed with `--resume`.

### Terminal runs

When a run completes fully without `--interrupt-on`, a `{thread_id}.terminal` marker is written. Attempting to `--resume` a terminal thread ID exits immediately with an error — start a fresh run instead.

---

## Monitoring a Run

### GUI dashboard

The workspace includes a browser-based dashboard for monitoring runs:

```bash
./menu.sh gui
```

The Orchestrator tab shows active and past runs, preflight status, and lets you browse JSONL logs — all without touching the command line.

For a full reference of what each dashboard view supports, see the [GUI Usage Scenarios](usage-scenarios/).

### Heartbeat

When `HEARTBEAT_INTERVAL_S` is set (default: 120 seconds), the orchestrator emits periodic heartbeat messages during long-running agent stages so you know the process is still alive.

### Process management

```bash
# List stale orchestrator processes
./menu.sh kill-orchestrator --json

# Terminate stale processes and clean up lock files
./menu.sh kill-orchestrator --force
```

---

## Example: End-to-End with the GUI

This walkthrough shows a complete orchestrator run driven entirely through the GUI dashboard. Launch the dashboard with:

```bash
./menu.sh gui
```

The dashboard opens in your default browser at `http://localhost:3000`. For detailed acceptance criteria for each dashboard view used in this walkthrough, see the [GUI Usage Scenarios](usage-scenarios/).

### Step 1: Write the plan

Before touching the GUI, create your plan document at the standard location:

```
<project-root>/docs/agents/plans/<slug>/plan.md
```

You can write this by hand or use the **Planner agent** in your IDE to draft it interactively. The orchestrator needs the plan file to exist on disk before it can run.

### Step 2: Run preflight checks

1. Navigate to the **Orchestrator** tab in the dashboard.
2. Paste the absolute path to your `plan.md` into the plan-path input field.
3. Click **Run Preflight**.

The dashboard runs environment checks (Python venv, `.env` configuration, MCP server build freshness, plan file existence) and displays a checklist. Each check shows a pass (✓) or fail (✗) indicator with a suggested fix command if something is wrong.

The **Start Run** button stays disabled until all checks pass.

### Step 3: Start the run

Once all preflight checks show green, click **Start Run**. The dashboard:

- Launches the orchestrator process in the background.
- Shows a confirmation banner with the process ID.
- Begins polling for the new run in the Run Queue below.

The plan-path input clears automatically after a successful launch. You cannot start a second run against the same plan while one is active — the file lock prevents it.

### Step 4: Monitor progress in the Orchestrator tab

The **Run Queue** table (below the Start panel) shows all active and recently completed runs. Each row displays:

- **Plan slug** — the plan directory name.
- **Status** — running, completed, interrupted, or error.
- **Progress** — a live summary line and a link to the full JSONL log viewer.

Expand a row to see a **live log preview** that streams the most recent JSONL events in real time — stage starts, routing decisions, completions, and errors scroll in as they happen.

### Step 5: Monitor progress in the Projects tab

Switch to the **Projects** tab (the default landing page) to see the project the orchestrator created in the ledger. Click the project name to open the **Project Detail** view, which shows:

- **Project header** — status badge (IN_PROGRESS → COMPLETE), timing info, health indicator.
- **Work packages** — a table of all WPs with their current status, pipeline track progress, and stage badges. Rows update live as stages complete.
- **Orchestrator status card** — when a run is active, a card at the top shows the current stage, elapsed time, and a live log preview.
- **Run history** — a list of all orchestrator runs against this project with links to the full JSONL log viewer.

You can drill into any work package to see its pipeline history, observations, and artifacts.

### Step 6: Review the synthesis report

When the orchestrator reaches the Synthesis stage and completes it, the project status changes to **COMPLETE**. A **Synthesis** link appears in the project header. Click it to open the rendered `synthesis.md` report directly in the dashboard.

The synthesis report summarises:

- Work completed across all work packages.
- Decisions made and trade-offs encountered.
- Knowledge insights extracted during the run.
- Any work packages that were skipped by the circuit breaker.

### Step 7: Iterate if needed

If the synthesis reveals issues or the result needs refinement:

1. **Edit the plan** — update `plan.md` with revised requirements, additional constraints, or scoping changes based on what the synthesis revealed.
2. **Start a fresh run** — go back to the Orchestrator tab, paste the plan path, run preflight, and start again. The orchestrator creates a new ledger project for the updated plan.

Alternatively, if the run was interrupted (via `--interrupt-on` or a signal) rather than completed:

1. Open the **Project Detail** view.
2. Click the **Resume** button in the orchestrator toolbar.
3. The dashboard launches a `--resume` run that picks up from the last checkpoint.

---

## Troubleshooting

### The orchestrator cannot infer the project root

The orchestrator expects plans to live at `<project-root>/docs/agents/plans/<slug>/plan.md`. If your plan is elsewhere, use `--project-path`:

```bash
orchestrate plan.md --project-path /path/to/your/project
```

### A work package keeps failing

The circuit breaker skips any work package that accumulates 3 or more consecutive stage failures. The supervisor continues with other work packages and eventually routes to synthesis. Check the JSONL log for `halt` events to identify which WP was skipped and why.

### "Another orchestrator process is already running"

The orchestrator acquires a file lock on `.orchestrator.lock` in the plan directory. If no other process is actually running (e.g. a previous run crashed), delete the lock file:

```bash
rm docs/agents/plans/<slug>/.orchestrator.lock
```

### Stale MCP server

If routing behaves unexpectedly or you see "Root index not found" errors, rebuild the MCP server:

```bash
cd mcp-server && npm run build
```

The menu's orchestrator launcher does this automatically, but direct `orchestrate` invocations do not.

### For more

See the [Troubleshooting section](../../orchestrator/README.md#troubleshooting) in the orchestrator README for additional scenarios (missing Node.js, API key issues, checkpoint corruption).
