# AI Insights — Workflow, Ledger, and Orchestrator

> **Companion to:** [agents-overview.md](agents-overview.md)
> **Generated:** 2026-07-31

This document explains how the agentic workflow operates end-to-end: the role of the central ledger as the backbone of all coordination, the two supported execution modes (VS Code Chat and the Orchestrator), and why the workflow is designed the way it is.

---

## Table of Contents

- [The Problem This Solves](#the-problem-this-solves)
- [The Central Ledger](#the-central-ledger)
  - [Shared State and Session Continuity](#shared-state-and-session-continuity)
  - [Routing Authority](#routing-authority)
  - [Work Package Tracking](#work-package-tracking)
  - [Agent Observations and Artifacts](#agent-observations-and-artifacts)
  - [Knowledge Store](#knowledge-store)
  - [Strategy and Project History](#strategy-and-project-history)
- [The Agent Handoff Protocol](#the-agent-handoff-protocol)
- [Pipeline Stages and Rework Routing](#pipeline-stages-and-rework-routing)
- [Execution Modes](#execution-modes)
  - [VS Code Chat (Semi-Interactive)](#vs-code-chat-semi-interactive)
  - [The Orchestrator (Headless)](#the-orchestrator-headless)
  - [Choosing an Execution Mode](#choosing-an-execution-mode)
- [Why Claude Code Is Not Used for the Workflow](#why-claude-code-is-not-used-for-the-workflow)
- [How the Orchestrator Works Internally](#how-the-orchestrator-works-internally)
- [Knowledge Flow Across Projects](#knowledge-flow-across-projects)
- [Supporting Infrastructure](#supporting-infrastructure)

---

## The Problem This Solves

AI agents operate inside isolated chat sessions. Each session has no memory of previous sessions, no awareness of what other agents have done, and no reliable way to hand off work without human intervention. This creates three compounding problems for any non-trivial development workflow:

1. **Context loss** — every new session starts from zero. The agent must re-read files, re-understand the codebase, and re-discover constraints.
2. **No coordination** — without a shared source of truth, agents cannot divide work across sessions or resume where another left off.
3. **No auditability** — there is no record of what was decided, what was tried, what failed, and why.

The ledger-based workflow solves all three. The **centralized ledger** (managed by the `central_pm` MCP server) is a structured, file-backed store that persists project state, routing decisions, observations, and knowledge — independent of any chat session. Agents read from and write to the ledger rather than communicating with each other directly.

---

## The Central Ledger

The ledger is the single source of truth for everything that happens in a workflow run. Agents never coordinate by passing messages to each other. Instead, each agent reads the ledger to discover what to do next, does its work, and writes results back to the ledger for the next agent to consume.

### Shared State and Session Continuity

The ledger stores the complete project state on disk in a structured JSON hierarchy. When a new session starts — whether seconds or weeks after the previous one ended — any agent can call `ledger_detect_project` to locate the active project, then `ledger_get_project_status` to see exactly where things stand: which work packages exist, which are in progress, which are complete, and which stages remain.

This is what makes cross-session workflows possible. The ledger outlives any individual chat session.

### Routing Authority

The ledger does not just store state — it decides what happens next. Agents call `ledger_get_next_action` and receive a specific action directive:

| Action returned | Meaning |
|-----------------|---------|
| `IMPLEMENT` | There is a WP ready for the Developer to implement |
| `REWORK` | A WP was bounced back by QA, Security, or Review — back to Developer |
| `RUN_QA` | A WP is awaiting QA validation |
| `RUN_SECURITY_AUDIT` | A WP is awaiting security review |
| `RUN_REVIEW` | A WP is awaiting code review |
| `RUN_RELEASE_ENGINEERING` | A WP is awaiting release engineering |
| `WRITE_DOCS` / `FINALIZE_WP` | Documentation stage; finalizes the WP on completion |
| `BLOCK_FOR_REWORK_LIMIT` | A WP has hit the maximum rework count — needs PM intervention to cancel or restructure |
| `WAIT` | All WPs are either blocked, in progress, or complete — nothing to do right now |
| `REPAIR_ORPHAN_BLOCKED` | A WP is stuck and needs PM intervention to unblock |

No agent decides on its own what to do next. The ledger makes that decision based on project state, WP status, and pipeline configuration. This is what makes the workflow deterministic.

### Work Package Tracking

Each Work Package (WP) is a discrete, self-contained unit of work. The PM creates WPs during stage 2 by decomposing the plan into atomic tasks. Every WP carries:

- **ID** (`WP-001`, `WP-002`, …) — stable reference used by all agents
- **Title and description** — what needs to be done
- **Acceptance criteria** — the conditions that must be met for the WP to be considered complete
- **Dependencies** — which WPs must complete before this one can start
- **Active pipeline stages** — which of the 6 pipeline stages apply to this WP (not all WPs run all stages)
- **Status** — `READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`, or `CANCELLED`
- **Pipeline stage results** — per-stage pass/fail records with agent observations

The ledger enforces pipeline stage ordering. Stages within a WP always progress in canonical order (`implementation → qa → security-audit → code-review → release-engineering → documentation`). Stages may be omitted but never reordered.

### Agent Observations and Artifacts

During implementation, each agent records observations and artifacts directly to the ledger rather than only to files. This means:

- **Developer** records code insights encountered while working — code smells, technical debt, architectural observations
- **QA** records test results, edge cases covered, and rework instructions when failing a WP
- **Security Auditor** records findings by severity (Critical/High/Medium/Low/Info)
- **Reviewer** records code quality and architecture findings
- **Release Engineer** records versioning decisions and changelog entries
- **Documentation** records which files were updated

These observations persist in the ledger and are visible to the Synthesis agent at the end of the run. They also appear in the GUI dashboard for human review.

### Knowledge Store

The knowledge store is a separate, project-independent layer within the MCP server. It stores reusable insights that accumulate across multiple projects over time — effectively institutional memory for the codebase.

Knowledge is organized at two scopes:

| Scope | Storage | Contents |
|-------|---------|----------|
| **Global** | `.knowledge/global-insights.json` | Architecture patterns, testing strategies, security principles, workflow lessons that apply across projects |
| **Repository** | `.knowledge/{repository-name}-insights.json` | Module-specific conventions, known pitfalls, build quirks, dependency notes for a specific codebase |

Two agents have primary roles in the knowledge lifecycle:

- **Planner (stage 1)** — reads insights before producing the plan, using them to inform design decisions and avoid known pitfalls
- **Synthesis (stage 9)** — writes new insights after project completion, extracting what was learned that is worth preserving

Additionally, the **Developer**, **QA**, **Security Auditor**, and **Reviewer** can search the knowledge store via `ledger_search_insights` for in-context lookups during their pipeline work.

The knowledge store is designed to compound value over time. Each completed project makes the next project better, because the Planner starts with a richer understanding of what has worked and what has not.

### Strategy and Project History

Beyond knowledge insights, the Planner also reads the project history through `ledger_get_repository_context`. This returns:

- **Strategic vision** — short, mid, and long-term direction for the repository
- **Prior project timeline** — a chronological summary of past projects run against this repository
- **Outcome summaries** — what each past project achieved

This grounds the Planner's design decisions in the actual trajectory of the project rather than treating every feature request in isolation.

---

## The Agent Handoff Protocol

Agents in the workflow operate in isolation — they cannot call each other directly. Handoffs are mediated entirely through the ledger using a two-step protocol:

**Step 1: Outbound (current agent finishes)**

1. The agent writes its results to the ledger (pipeline pass/fail, artifacts, observations)
2. The agent calls `ledger_get_handoff_status` — the ledger computes which role should run next based on current project state
3. The agent outputs a structured handoff block:
   ```
   AGENT: Developer
   STATUS: COMPLETE
   ```
   This is a signal to whoever is running the workflow (human, Coordinator, or Orchestrator) about what to invoke next.

**Step 2: Inbound (next agent starts)**

1. The new agent calls `ledger_detect_project` to locate the active project
2. The agent calls `ledger_get_next_action` — the ledger responds with a specific action directive and WP to work on
3. The agent calls `ledger_begin_work` to claim the pipeline stage (preventing duplicate work)
4. The agent performs its work, writes results, and hands off

This protocol means any agent can be started in any session, at any time, and will correctly pick up exactly where the workflow left off — because the ledger always knows the current state.

---

## Pipeline Stages and Rework Routing

The 6 pipeline stages (`implementation → qa → security-audit → code-review → release-engineering → documentation`) are run per Work Package. The PM decides which stages apply to each WP; stages not selected are skipped automatically.

When a stage fails, the ledger routes back to a specific agent based on the stage. For the four implementation-side stages (`implementation`, `qa`, `security-audit`, `code-review`), failures route back to the Developer. For `release-engineering`, failure routes back to the Release Engineer. For `documentation`, failure routes back to the Documentation agent. The failed stage is then re-run. This continues until the stage passes or the rework limit is reached (maximum 5 cycles per stage), at which point the ledger surfaces `BLOCK_FOR_REWORK_LIMIT` for PM intervention.

```
Developer ──▶ QA ──▶ Security ──▶ Review ──▶ Release ──▶ Documentation
    ▲           │         │           │            │               │
    │           │ FAIL    │ FAIL      │ FAIL       │ FAIL          │ FAIL
    └───────────┴─────────┴───────────┘            │               │
                                            (Release Eng.)   (Docs agent)
                    (ledger routes back to stage owner)
```

The Documentation stage is terminal — when it completes, the WP is automatically finalized by the ledger. Once all WPs are finalized, the Synthesis agent runs and the project is archived as COMPLETE.

---

## Execution Modes

The same workflow, the same ledger, and the same agent personas run under two different execution models. The choice of model determines how agents are invoked and how much human intervention is required.

### VS Code Chat (Semi-Interactive)

In VS Code Chat mode, the user invokes agents manually in GitHub Copilot Chat by pasting or opening a persona `.agent.md` file. Each stage runs in a new conversation window (or the same window with context switches).

The **Ledger Claude Coordinator** is a meta-agent that automates this within VS Code Chat. Once invoked, it:

1. Calls `ledger_detect_project` to find the active project
2. Calls `ledger_get_handoff_status` to determine the next agent
3. Dispatches that agent via the `runSubagent` tool (VS Code's agent spawning mechanism)
4. After the sub-agent completes, reads the ledger again to determine the next step
5. Repeats until the project is COMPLETE

**Interactive mode** (default): The Coordinator reports the current project state and asks for confirmation before dispatching each agent. Good for first-time use or when human review between stages is desired.

**Autonomous mode**: Agents are dispatched continuously without per-stage confirmation. The Coordinator still pauses on errors, rework-limit hits, and repeated failures.

The key constraint in VS Code Chat mode is that the Coordinator reads ledger handoffs to determine routing. It does not make routing decisions on its own.

### The Orchestrator (Headless)

The Orchestrator is a Python command-line tool that runs the full 9-stage pipeline without any IDE involvement. It is the primary execution mode for unattended runs.

```bash
./menu.sh orchestrator path/to/plan.md
```

Internally, the Orchestrator is built on **LangGraph** (a graph-based workflow engine) and **Deep Agents** (LangChain-based coding agents). The graph has one node per pipeline stage plus a supervisor router:

```
START ──▶ supervisor ──▶ [pm | developer | qa | security_auditor |
                          reviewer | release_engineer | docs | synthesis]
                                          │
                     ◀─────────────────────┘
                     (loops back to supervisor after each stage)
```

The supervisor is a **pure-Python deterministic router — no LLM calls**. It calls `ledger_get_next_action` and routes to the appropriate stage node based on the action returned. This means the ledger is the routing authority even in the headless Orchestrator; the Orchestrator is simply a different way to invoke the same agents.

Each stage node:
1. Loads the persona prompt for that stage (from `orchestrator/src/nodes/templates/`)
2. Wraps the shared MCP tools (auto-injecting `project_path`)
3. Creates a Deep Agent with those tools and the persona prompt
4. Invokes the agent and waits for completion
5. Emits a structured JSONL log entry with stage metadata and timing

The Orchestrator uses the same MCP server (`central_pm`) and the same ledger as VS Code Chat. A project started in VS Code Chat can be continued in the Orchestrator, and vice versa — because the ledger is the source of truth, not the execution environment.

**Resumable runs:** The Orchestrator uses LangGraph's SQLite checkpoint system. If a run is interrupted (signal, crash, or intentional pause via `--interrupt-on`), it can be resumed from its last checkpoint:

```bash
./menu.sh orchestrator plan.md --resume <thread-id>
```

**GUI dashboard:** The Orchestrator integrates with the GUI (`./menu.sh gui`), which provides live run monitoring, JSONL log browsing, and the ability to launch and resume runs without touching the command line.

### Choosing an Execution Mode

| Mode | When to use |
|------|-------------|
| **VS Code Chat (manual)** | Fine-grained control — iterate on the plan with the Planner, review QA before the Reviewer runs, or inspect intermediate results at any stage |
| **VS Code Chat (Coordinator)** | Automated pipeline within the IDE — convenient when already in VS Code and wanting autonomous progression with occasional checkpoints |
| **Orchestrator** | Unattended runs, background processing, or when the full pipeline should run without IDE involvement. Preferred for long-running projects. |

Both modes produce the same ledger output and the same project artifacts. The choice is purely about how agents are invoked.

---

## Why Claude Code Is Not Used for the Workflow

Claude Code is **not a supported execution environment** for the ledger workflow. It is explicitly excluded for a reliability reason: Claude Code does not reliably follow ledger handoffs.

The workflow depends on agents following the ledger's routing decisions exactly — reading `ledger_get_handoff_status` at the end of each turn and dispatching the agent the ledger specifies. Claude Code will sometimes ignore these handoffs, decide on its own that a step is unnecessary, skip stages, or otherwise deviate from the ledger's routing without surfacing this as an error.

This is not a flaw that can be worked around with better instructions — it is a fundamental behavioral characteristic of how Claude Code handles agentic workflows. Because the ledger's routing authority is non-negotiable for the workflow to be correct, Claude Code is inadequate as a coordinator.

The two supported execution environments are:
- **GitHub Copilot Chat in VS Code** — via the Ledger Claude Coordinator or manual stage-by-stage invocation
- **The Python Orchestrator** — via `./menu.sh orchestrator`

Persona files are available for both environments (`personas/ledger/vs-code/` and `personas/ledger/deep-agents/`). Claude Code persona outputs are also generated (`personas/ledger/claude-code/`) for completeness, but they are not actively used for the ledger pipeline and should not be relied upon — Claude Code's routing behavior makes it unsuitable as a ledger coordinator.

---

## How the Orchestrator Works Internally

Understanding the Orchestrator's internals helps when debugging, monitoring, or extending the system.

### The Supervisor Router

The supervisor is the heart of the Orchestrator. It runs between every stage and makes the routing decision:

1. Calls `ledger_list_work_packages` — if no WPs exist, routes to PM
2. Calls `ledger_get_next_action` for each pipeline role in order
3. The first role that returns a non-`WAIT` action is the next stage to run
4. If all roles return `WAIT`, the Orchestrator routes to Synthesis (or END if Synthesis is complete)

Special conditions:
- **Safety limit:** If `iteration >= max_iterations`, the run exits (prevents infinite loops)
- **Circuit breaker:** If a WP accumulates 3 or more consecutive stage failures, it is skipped for the remainder of the run to prevent the workflow from getting stuck

### JSONL Run Log

Every run produces a structured JSONL log at `{slug}/orchestrator/logs/{timestamp}-{slug}.jsonl`. Each line is a JSON event:

| Event type | When emitted |
|------------|-------------|
| `run_start` | At the beginning of every run |
| `stage_start` | When a stage node begins executing |
| `stage_complete` | When a stage node finishes (includes `duration_s`) |
| `stage_error` | When a stage node raises an exception |
| `routing_decision` | After each supervisor routing call |
| `signal_shutdown` | When SIGTERM or SIGINT is received |
| `run_complete` | When the run exits normally |

When dialogue capture is enabled (the default), each stage also writes a full Markdown transcript of the agent's reasoning and tool calls to `{slug}/orchestrator/chunks/`.

The GUI, `scripts/read-log.js`, and `scripts/extract-dialogue.js` all consume these files.

### Model Selection

The Orchestrator reads model assignments at startup — it does not use a single `MODEL_NAME` environment variable. Each pipeline stage can use a different model. Resolution order:

1. Per-persona assignment from `personas/model-registry/assignments.json` (GUI-managed)
2. Per-persona `model_slug` field in the ledger YAML metadata
3. Default assignment from `assignments.json`
4. Shared default `default_model_slug` from `personas/ledger/src/meta/_shared.yaml`

The LLM provider is auto-detected from which API key is set.

---

## Knowledge Flow Across Projects

The knowledge store creates a feedback loop that compounds value across the lifetime of a codebase:

```
Project 1 completes
    │
    ▼
Synthesis extracts insights ──▶ Knowledge Store
    │                               │
    │                               │ (persists independently of any project)
    ▼                               │
Project 2 starts                    │
    │                               │
    ▼                               ▼
Planner calls ledger_search_insights
    │
    ▼
Plan is grounded in lessons from Project 1
    │
    ▼
Project 2 completes ──▶ More insights added ──▶ Knowledge Store grows
```

Insights are written at two scopes:

- **`scope: 'global'`** — applies across all repositories (architecture principles, workflow lessons, general patterns)
- **`scope: 'repository'`** — applies only to the specific codebase (module conventions, known pitfalls, build quirks)

When a project completes, the Synthesis agent dispatches the **Ledger Knowledge Archiver** sub-agent, which does the actual extraction and deduplication. New insights are compared against existing ones before writing to avoid redundancy.

---

## Supporting Infrastructure

### MCP Server (`central_pm`)

The MCP server is a Node.js/TypeScript process that runs alongside the IDE (or as a subprocess of the Orchestrator). It exposes all ledger operations as typed tools under the `central_pm` namespace. Agents interact with the ledger exclusively through these tools — never by reading or writing ledger files directly.

The server enforces:
- Schema validation on all reads and writes
- Atomic file writes (via lock files) to prevent corruption
- Pipeline stage ordering constraints
- WP status transition rules
- Rework count limits

### GUI Dashboard

The GUI (`./menu.sh gui`) provides a browser-based view of all ledger data:
- Project list with status badges
- Per-project WP table with pipeline stage results
- Per-WP observation log (agent notes, code insights, QA findings)
- Synthesis report viewer
- Knowledge store browser
- Orchestrator tab: preflight checks, run launcher, live log viewer, dialogue browser

The GUI reads directly from the ledger store. It does not modify ledger data (except through the Orchestrator launch integration).

### Ledger-Support Personas

Several support personas manage the workflow infrastructure rather than contributing to the product directly:

| Persona | Role |
|---------|------|
| **Ledger Bootstrapper** | Creates a new ledger project and registers WPs from the PM's decomposition |
| **Ledger WP Decomposer** | Breaks a plan document into atomic, actionable WP definitions |
| **Ledger Dependency Sequencer** | Maps dependencies between WPs and determines execution order |
| **Ledger Pipeline Configurator** | Selects which pipeline stages apply to each WP |
| **Ledger Doctor** | Diagnoses and repairs stuck, deadlocked, or corrupted ledger projects |
| **Ledger Knowledge Archiver** | Extracts and commits insights from completed projects into the knowledge store |
| **Ledger Knowledge Curator** | Audits knowledge store entries for quality and removes outdated insights |
| **Ledger Standalone Archiver** | Imports a completed standalone plan folder into the ledger for archival and project history |
| **Ledger Orchestrator Runner** | Pre-flight checks, launch, and monitoring for Orchestrator runs |
| **Ledger Orchestrator Archaeologist** | Post-run analysis of Orchestrator logs for issues and performance anomalies |
| **Ledger Claude Coordinator** | Automates the VS Code Chat pipeline — dispatches agents in order based on ledger state |

These personas are invoked as sub-agents by the main pipeline personas (PM, Synthesis) or by the user directly when workflow management is needed.
