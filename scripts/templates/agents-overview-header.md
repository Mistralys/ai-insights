# AI Insights — Agent Persona Overview

> **See also:** [workflow-and-ledger.md](workflow-and-ledger.md) — companion document explaining how the ledger and orchestrator work together, the two execution modes (VS Code Chat and the Orchestrator), and the knowledge store.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Ledger Pipeline Personas (9-Stage Workflow)](#ledger-pipeline-personas-9-stage-workflow)
- [Standalone Personas](#standalone-personas)
- [Ledger-Support Personas](#ledger-support-personas)

---

## Architecture Overview

The persona system is organized into three suites:

| Suite | Count | Purpose |
|-------|-------|---------|
| **Ledger Pipeline** | 9 | The core 9-stage sequential development workflow. Each stage has a dedicated agent that processes Work Packages through the pipeline. |
| **Standalone** | 23 | Independent utility agents invoked on demand for specific tasks (planning, code review, documentation, etc.). |
| **Ledger-Support** | 11 | Infrastructure agents that manage the ledger workflow itself — bootstrapping projects, sequencing dependencies, diagnosing issues, and archiving results. |

### How the Ledger Pipeline Works

The ledger pipeline is a structured development workflow where a plan is decomposed into Work Packages (WPs), and each WP flows through up to 9 sequential stages. Each stage is handled by a dedicated agent persona. The `central_pm` MCP server tracks state, and agents read/write via MCP tools.

```
Plan → [1] Planner → [2] Project Manager → [3] Developer → [4] QA
     → [5] Security Auditor → [6] Reviewer → [7] Release Engineer
     → [8] Documentation → [9] Synthesis
```

Not every WP goes through every stage — the Pipeline Configurator determines which stages are active per WP.

### Standalone Personas

Standalone personas operate independently of the ledger workflow. They are invoked directly by the user for specific tasks — writing a changelog, auditing a plan, generating documentation, etc. Some standalone personas are also used as sub-agents by ledger pipeline personas or the orchestrator.

### Ledger-Support Personas

These agents manage the ledger workflow infrastructure: initializing projects, decomposing plans into Work Packages, sequencing dependencies, diagnosing stalled workflows, and archiving completed projects.

---
