# Ledger Workflow — Visual Reference Guide

A visual overview of the AI Insights ledger-enabled agentic workflow: pipeline structure, inter-agent communication via the centralized ledger, knowledge-store integration, and supporting personas.

---

## The 9-Agent Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LEDGER-ENABLED WORKFLOW                              │
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────────────────────────────────────┐  │
│  │    1    │    │    2    │    │        PIPELINE (per Work Package)      │  │
│  │ PLANNER │───▶│   PM    │───▶│                                         │  │
│  │         │    │         │    │  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐      │  │
│  └─────────┘    └─────────┘    │  │ 3 │─▶│ 4 │─▶│ 5 │─▶│ 6 │─▶│ 7 │      │  │
│                                │  │DEV│  │QA │  │SEC│  │REV│  │REL│      │  │
│                                │  └───┘  └───┘  └───┘  └───┘  └───┘      │  │
│                                │    │                            │       │  │
│                                │    │      ┌───┐                 │       │  │
│                                │    └─────▶│ 8 │◀────────────────┘       │  │
│                                │           │DOC│                         │  │
│                                │           └───┘                         │  │
│                                └─────────────────────────────────────────┘  │
│                                                    │                        │
│                                                    ▼                        │
│                                               ┌─────────┐                   │
│                                               │    9    │                   │
│                                               │SYNTHESIS│                   │
│                                               └─────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Agent Roles

| # | Agent | Responsibility |
|---|-------|----------------|
| 1 | **Planner** | Creates the implementation plan; consults knowledge base and project history |
| 2 | **Project Manager** | Decomposes plan into Work Packages (WPs); initializes the ledger |
| 3 | **Developer** | Implements each WP; records artifacts and observations |
| 4 | **QA** | Validates acceptance criteria; triggers rework on failure |
| 5 | **Security Auditor** | Reviews for vulnerabilities and security concerns |
| 6 | **Reviewer** | Code quality and architecture review |
| 7 | **Release Engineer** | Changelogs, versioning, and release artifacts |
| 8 | **Documentation** | Updates project documentation; finalizes WP on completion |
| 9 | **Synthesis** | Consolidates results; extracts knowledge; archives the project |

---

## The Centralized Ledger

The ledger is the single source of truth for all workflow state. Agents never communicate directly — all coordination happens through ledger reads and writes via MCP tools.

```
                         ┌──────────────────────────────────┐
                         │         MCP SERVER               │
                         │        (central_pm)              │
                         │                                  │
                         │  ┌────────────────────────────┐  │
                         │  │     PROJECT LEDGER         │  │
                         │  │                            │  │
                         │  │  • Project status          │  │
                         │  │  • WP states & pipelines   │  │
                         │  │  • Artifacts & metrics     │  │
                         │  │  • Blockers & comments     │  │
                         │  │  • Pipeline routing        │  │
                         │  │  • Handoff decisions       │  │
                         │  └────────────────────────────┘  │
                         │                                  │
                         │  ┌────────────────────────────┐  │
                         │  │     KNOWLEDGE STORE        │  │
                         │  │                            │  │
                         │  │  • Global insights         │  │
                         │  │  • Repository insights     │  │
                         │  │  • Strategy & vision       │  │
                         │  │  • Project history         │  │
                         │  └────────────────────────────┘  │
                         └──────────────┬───────────────────┘
                                        │
            ┌───────────────────────────┼──────────────────────────┐
            │            │              │              │           │
            ▼            ▼              ▼              ▼           ▼
       ┌─────────┐ ┌─────────┐    ┌─────────┐    ┌─────────┐ ┌─────────┐
       │ Planner │ │   PM    │    │ Dev/QA/ │    │  Docs   │ │Synthesis│
       │         │ │         │    │ Sec/Rev │    │         │ │         │
       │ READS:  │ │ WRITES: │    │         │    │ WRITES: │ │ READS:  │
       │ history │ │ project │    │ WRITES: │    │pipeline │ │ all WPs │
       │ insights│ │ WPs     │    │pipeline │    │complete │ │ WRITES: │
       │         │ │         │    │ results │    │(→ final)│ │ insights│
       └─────────┘ └─────────┘    └─────────┘    └─────────┘ └─────────┘
```

### Inter-Agent Communication Pattern

Agents operate in isolated chat sessions. The ledger provides continuity:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   AGENT HANDOFF PROTOCOL                                 │
│                                                                          │
│  Agent N finishes work                                                   │
│       │                                                                  │
│       ├─ 1. Writes results to ledger (pipeline pass/fail, artifacts)     │
│       │                                                                  │
│       ├─ 2. Calls ledger_get_handoff_status                              │
│       │         → Ledger computes: "Next agent = Agent M"                │
│       │                                                                  │
│       └─ 3. Outputs: AGENT: <role>  STATUS: <status>                     │
│                            │                                             │
│                            ▼                                             │
│  Agent M starts (new session)                                            │
│       │                                                                  │
│       ├─ 1. Calls ledger_detect_project (identifies active project)      │
│       │                                                                  │
│       ├─ 2. Calls ledger_get_next_action                                 │
│       │         → Ledger responds: "Work on WP-003, stage: qa"           │
│       │                                                                  │
│       ├─ 3. Calls ledger_begin_work (claims the pipeline stage)          │
│       │                                                                  │
│       └─ 4. Performs work → writes results → handoff                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Rework Loop (Failure Routing)

When a pipeline stage fails (QA, Security, or Review), the ledger routes back to the Developer:

```
                    ┌──────────┐
                    │Developer │◀───────────────────────────────┐
                    │(stage 3) │                                │
                    └────┬─────┘                                │
                         │ completes                            │
                         ▼                                      │
                    ┌──────────┐     FAIL                       │
                    │   QA     │─────────────────────┐          │
                    │(stage 4) │                     │          │
                    └────┬─────┘                     │          │
                         │ PASS                      │          │
                         ▼                           ▼          │
                    ┌──────────┐     FAIL        ┌────────┐     │
                    │ Security │────────────────▶│ LEDGER │─────┘
                    │(stage 5) │                 │ routes │
                    └────┬─────┘                 │  back  │
                         │ PASS                  └────────┘
                         ▼                           ▲
                    ┌──────────┐     FAIL            │
                    │ Reviewer │─────────────────────┘
                    │(stage 6) │
                    └────┬─────┘
                         │ PASS
                         ▼
                    (continues to next stage)

    Max rework cycles: 5 per pipeline stage
```

---

## Pipeline Stage Ordering

Stages are always executed in canonical order. The PM selects which stages apply per WP, but the sequence never changes:

```
    ┌────────────────┐     ┌──────┐     ┌────────────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌───────────────┐
    │ implementation │────▶│  qa  │────▶│ security-audit │────▶│ code-review │────▶│ release-engineering │────▶│ documentation │
    └────────────────┘     └──────┘     └────────────────┘     └─────────────┘     └─────────────────────┘     └───────────────┘
          Agent 3           Agent 4          Agent 5               Agent 6               Agent 7                    Agent 8

    Stages may be OMITTED but never REORDERED.
```

### Common Pipeline Compositions

```
    Standard:         [impl] → [qa] → [review] → [docs]
    Full:             [impl] → [qa] → [security] → [review] → [release] → [docs]
    Security-focused: [impl] → [qa] → [security] → [review] → [docs]
    Doc-only:         [docs]
    Verification:     [qa] → [review]
```

---

## Knowledge Store Integration

The knowledge store provides institutional memory across projects. It operates at two points in the workflow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     KNOWLEDGE FLOW                                      │
│                                                                         │
│    ┌──────────────────────────────────────────────────────┐             │
│    │               KNOWLEDGE STORE                        │             │
│    │                                                      │             │
│    │  Global Insights         Repository Insights         │             │
│    │  (cross-project)         (codebase-specific)         │             │
│    │                                                      │             │
│    │  • Architecture patterns • Module conventions        │             │
│    │  • Testing strategies    • Known pitfalls            │             │
│    │  • Security principles   • Build quirks              │             │
│    │  • Workflow lessons       • Dependency notes         │             │
│    └───────────┬──────────────────────────┬───────────────┘             │
│                │                          │                             │
│       ┌────────┘                          └────────┐                    │
│       │ READ                                WRITE  │                    │
│       ▼                                            ▼                    │
│  ┌──────────┐                                ┌──────────┐               │
│  │ PLANNER  │                                │SYNTHESIS │               │
│  │(stage 1) │                                │(stage 9) │               │
│  │          │                                │          │               │
│  │ Searches │                                │ Extracts │               │
│  │ insights │                                │ insights │               │
│  │ to inform│                                │ from the │               │
│  │ design   │                                │ completed│               │
│  │ decisions│                                │ project  │               │
│  └──────────┘                                └──────────┘               │
│                                                                         │
│  PLANNER reads:                     SYNTHESIS writes:                   │
│   • ledger_get_repository_context    • ledger_add_insight (global)      │
│   • ledger_search_insights           • ledger_add_insight (repository)  │
│                                      • ledger_search_insights (dedup)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Knowledge Lifecycle

```
    Project N completes
         │
         ▼
    Synthesis extracts insights ──▶ Knowledge Store
         │                              │
         │                              │ (persists across projects)
         │                              │
         ▼                              ▼
    Project N+1 starts           Planner searches
         │                       relevant insights
         └───────────────────────────────┘
              Informed design decisions
```

---

## Strategy & Planning Phase

The Planner uses the ledger to ground decisions in project history and accumulated wisdom:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PLANNING PHASE (Agent 1)                            │
│                                                                         │
│  1. User describes feature/task                                         │
│       │                                                                 │
│       ▼                                                                 │
│  2. Gather strategic context                                            │
│       │                                                                 │
│       ├── ledger_get_repository_context ─────────────────────┐          │
│       │     Returns:                                         │          │
│       │       • Strategic vision (short/mid/long-term)       │          │
│       │       • Prior project timeline                       │          │
│       │       • Outcome summaries                            │          │
│       │                                                      │          │
│       ▼                                                      │          │
│  3. Research the codebase                                    │          │
│       │                                                      │          │
│       ├── Read AGENTS.md / project manifest                  │          │
│       ├── Explore directory structure                        │          │
│       └── Identify relevant modules & patterns               │          │
│                                                              │          │
│       ▼                                                      │          │
│  4. Search for relevant insights                             │          │
│       │                                                      ▼          │
│       ├── ledger_search_insights ───────────────────▶ Knowledge         │
│       │     Targeted queries per area:                Store             │
│       │       • Frontend patterns                                       │
│       │       • Backend architecture                                    │
│       │       • Testing conventions                                     │
│       │       • Known pitfalls                                          │
│       │                                                                 │
│       ▼                                                                 │
│  5. Produce plan (grounded in context + insights)                       │
│       │                                                                 │
│       ▼                                                                 │
│  Output: docs/agents/plans/YYYY-MM-DD-feature/plan.md                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Sub-Agent Decomposition

Two ledger agents delegate complex tasks to specialized sub-agents:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  AGENT 2: PROJECT MANAGER                    AGENT 9: SYNTHESIS             │
│                                                                             │
│  ┌─────────────────────────┐                 ┌───────────────────────────┐  │
│  │ Decomposes plan into    │                 │ Consolidates project      │  │
│  │ WPs and initializes     │                 │ results and extracts      │  │
│  │ the ledger              │                 │ reusable knowledge        │  │
│  └──────────┬──────────────┘                 └─────────────┬─────────────┘  │
│             │                                              │                │
│             │ dispatches                                   │ dispatches     │
│             ▼                                              ▼                │
│  ┌──────────────────────┐                     ┌────────────────────────┐    │
│  │ WP Decomposer        │                     │ Knowledge Archiver     │    │
│  │ Breaks plan into     │                     │ Extracts insights from │    │
│  │ atomic WPs           │                     │ completed projects     │    │
│  └──────────────────────┘                     └────────────────────────┘    │
│  ┌──────────────────────┐                                                   │
│  │ Dependency Sequencer │                                                   │
│  │ Orders WPs by        │                                                   │
│  │ dependency topology  │                                                   │
│  └──────────────────────┘                                                   │
│  ┌──────────────────────┐                                                   │
│  │ Pipeline Configurator│                                                   │
│  │ Selects active       │                                                   │
│  │ stages per WP        │                                                   │
│  └──────────────────────┘                                                   │
│  ┌──────────────────────┐                                                   │
│  │ Ledger Bootstrapper  │                                                   │
│  │ Writes WPs to the    │                                                   │
│  │ MCP ledger           │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Plan Refinement Pipeline

Before the PM decomposes a plan, the Planner may optionally invoke the Plan Refiner for iterative quality improvement:

```
                    ┌──────────┐
                    │ PLANNER  │
                    │(stage 1) │
                    └────┬─────┘
                         │ invokes (optional)
                         ▼
              ┌─────────────────────┐
              │    PLAN REFINER     │
              │  (orchestrates      │
              │   refinement loop)  │
              └──────────┬──────────┘
                         │
            ┌────────────┼────────────┐
            │                         │
            ▼                         ▼
   ┌─────────────────┐     ┌──────────────────┐
   │ Plan Architect  │     │   Plan Auditor   │
   │    Reviewer     │     │                  │
   │                 │     │ Checks for:      │
   │ Challenges:     │     │ • Hallucinated   │
   │ • Design shape  │     │   references     │
   │ • Simplifi-     │     │ • Missing steps  │
   │   cations       │     │ • Infeasible     │
   │ • Ecosystem     │     │   sequencing     │
   │   alternatives  │     │ • Pattern        │
   │                 │     │   violations     │
   └────────┬────────┘     └────────┬─────────┘
            │                       │
            └───────────┬───────────┘
                        │ findings
                        ▼
              ┌─────────────────────┐
              │  Planner integrates │
              │  findings → revised │
              │  plan               │
              └─────────────────────┘

    Repeats until audit-clean or ceiling reached.
```

---

## Supporting Standalone Personas

These personas operate independently of the 9-stage pipeline but support the ledger ecosystem:

| Persona | Purpose | Ledger Relationship |
|---------|---------|---------------------|
| **Ledger Claude Coordinator** | Automates the full pipeline dispatch loop | Reads ledger state; dispatches agents 1–9 in sequence |
| **Ledger Orchestrator Runner** | Pre-flight + launch headless orchestrator runs | Launches the Python orchestrator against a plan |
| **Ledger Knowledge Archiver** | Extracts insights from completed projects | Writes to knowledge store via MCP |
| **Ledger Knowledge Curator** | Audits knowledge base quality | Reads/edits/deletes knowledge entries via MCP |
| **Ledger WP Decomposer** | Breaks plans into atomic WPs | Sub-agent of PM (stage 2) |
| **Ledger Dependency Sequencer** | Orders WPs by dependency graph | Sub-agent of PM (stage 2) |
| **Ledger Pipeline Configurator** | Selects active pipeline stages per WP | Sub-agent of PM (stage 2) |
| **Ledger Bootstrapper** | Registers WPs in ledger via MCP | Sub-agent of PM (stage 2) |
| **Ledger Doctor** | Diagnoses and repairs ledger issues | Fixes state corruption, deadlocks, stalled pipelines |
| **Plan Refiner** | Orchestrates iterative plan improvement | Pre-pipeline; improves plan quality before PM |
| **Plan Auditor** | Audits plans for technical defects | Sub-agent of Plan Refiner |
| **Plan Architect Reviewer** | Advisory architectural review | Sub-agent of Plan Refiner |
| **Planner (Standalone)** | Creates plans without ledger dependency | Standalone alternative to ledger Planner |
| **Developer (Standalone)** | Implements plans without ledger | Standalone alternative to ledger Developer |
| **Git Committer** | Organizes changes into commits | Post-implementation; traces to plan |
| **Changelog Curator** | Maintains changelogs | Post-release-engineering |

---

## End-to-End Workflow Timeline

```
    TIME ─────────────────────────────────────────────────────────────────▶

    ┌────────┐  ┌──────────────┐  ┌──────────────────────────────┐  ┌─────────┐
    │PLANNING│  │   PROJECT    │  │     PIPELINE EXECUTION       │  │SYNTHESIS│
    │        │  │  MANAGEMENT  │  │     (per Work Package)       │  │         │
    └───┬────┘  └──────┬───────┘  └──────────────┬───────────────┘  └────┬────┘
        │              │                         │                       │
        │  ┌───────┐   │  ┌───────────────────┐  │  ┌─────────────────┐  │
        ├─▶│Planner│   ├─▶│PM + sub-agents    │  │  │ Repeat for each │  │
        │  └───────┘   │  │• WP Decomposer    │  ├─▶│ WP in order:    │  │
        │              │  │• Dep. Sequencer   │  │  │                 │  │
        │  ┌────────┐  │  │• Pipeline Config  │  │  │ Dev → QA → Sec  │  │
        ├─▶│Refiner │  │  │• Bootstrapper     │  │  │ → Rev → Rel     │  │
        │  │(opt.)  │  │  └───────────────────┘  │  │ → Docs          │  │
        │  └────────┘  │                         │  │                 │  │
        │              │                         │  │ (rework loops   │  │
        │              │                         │  │  on failure)    │  │
        │              │                         │  └─────────────────┘  │
        │              │                         │                       │
        ▼              ▼                         ▼                       ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │                    CENTRALIZED LEDGER (MCP)                          │
    │                                                                      │
    │  Stores: project status, WP states, pipeline results, artifacts,     │
    │  blockers, comments, handoff routing, knowledge insights             │
    └──────────────────────────────────────────────────────────────────────┘
```

---

## Execution Modes

The workflow supports two execution modes:

### Manual (IDE-driven)

Each agent is invoked manually by pasting the persona into a new chat session. The user controls pacing and can intervene between stages.

### Automated (Orchestrator-driven)

Two automation options:

| Mode | Tool | How |
|------|------|-----|
| **IDE Coordinator** | Ledger Claude Coordinator | Dispatches agents via `runSubagent` within the IDE |
| **Headless Orchestrator** | Python LangGraph pipeline | Runs all stages programmatically without IDE interaction |

Both read the ledger to determine next actions and respect the same routing, rework, and ordering constraints as manual execution.

---

## Storage Architecture

```
    {ledger-root}/
    ├── {repo-name}/
    │   └── {project-slug}/
    │       ├── index.json           ← Project status, metadata
    │       ├── work-packages/
    │       │   ├── WP-001.json      ← Individual WP state
    │       │   ├── WP-002.json
    │       │   └── ...
    │       └── orchestrator/
    │           └── logs/            ← Orchestrator run logs
    │
    └── .knowledge/
        ├── global-insights.json     ← Cross-project knowledge
        └── {repo-name}-insights.json ← Repository-specific knowledge
```

Split-file architecture: each WP is a separate JSON file. A corruption in one WP does not affect others. The MCP server enforces schema validation and atomic writes via file locking.
