# Personas - Ledger Support Suite Guide
<INSTRUCTION>
# Personas - Ledger Support Suite Guide
Ledger support personas user guide: PM sub-agent cluster, ledger workflow utilities, and MCP server dependency.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Ledger support personas guide (PM sub-agent cluster, ledger utilities, MCP dependency)_
# Ledger support personas guide (PM sub-agent cluster, ledger utilities, MCP dependency)
```
// Structure of documents
└── personas/
    └── ledger-support/
        └── README.md

```
###  Path: `/personas/ledger-support/README.md`

```md
# Ledger Support Personas

## Overview

Ledger Support personas are **utility agents** that depend on the `central_pm` MCP server and are designed to support the 9-stage ledger workflow. They are structurally distinct from both ledger workflow personas (which _are_ the 9 stages) and standalone personas (which are fully independent, MCP-agnostic tools).

| Property | Ledger Personas | Ledger Support Personas | Standalone Personas |
|----------|----------------|------------------------|-------------------|
| `role` field | Required (matches `AGENT_ROLES`) | Absent | Absent |
| Roster / handoff | Full 9-agent pipeline | None | None |
| `mcp_server_name` | In `_shared.yaml` | In `_shared.yaml` (`central_pm`) | **Not allowed** ([constraint 19](../docs/agents/project-manifest/constraints.md#c19)) |
| File prefix | `N-name.md` (numbered) | Slug-based (e.g., `ledger-bootstrapper.agent.md`) | Slug-based (e.g., `researcher.agent.md`) |
| MCP dependency | Yes | Yes | No |

Ledger Support personas are built from sources in `personas/ledger-support/src/` and output to:
- `personas/ledger-support/vs-code/` — VS Code target (`.agent.md` extension)
- `personas/ledger-support/claude-code/` — Claude Code target (plain `.md` extension)
- `personas/ledger-support/deep-agents/` — Deep Agents / headless pipeline target

For build and sync instructions see [personas/docs/agents/project-manifest/](../docs/agents/project-manifest/README.md).

---

## PM Sub-Agent Cluster

Four ledger-support personas form the **Project Manager sub-agent cluster** — a sequential orchestration chain where each agent's output is the next agent's input. The PM persona (`2-project-manager`) invokes these in order when decomposing a plan into a ready-to-run ledger:

```
[Plan Document]
      │
      ▼
┌─────────────────────┐
│  Ledger WP Decomposer  │  Analyze plan → produce atomic WP definitions
└─────────┬───────────┘
          │ WP definitions
          ▼
┌──────────────────────────────┐
│  Ledger Dependency Sequencer │  Map WP dependencies → determine execution order
└──────────────┬───────────────┘
               │ Ordered WP list with dependencies
               ▼
┌────────────────────────────────┐
│  Ledger Pipeline Configurator  │  Select pipeline stages per WP
└────────────────┬───────────────┘
                 │ WPs with active_pipeline_stages configured
                 ▼
┌──────────────────────┐
│  Ledger Bootstrapper │  Create all WP entries via MCP tools; verify setup
└──────────────────────┘
```

Each step is a separate agent invocation. The PM passes structured output from one agent as input to the next. See [personas/ledger/README.md](../ledger/README.md) for the full ledger workflow context.

---

## Persona Catalog

All 9 ledger-support personas, sourced from `personas/ledger-support/src/meta/*.yaml`:

### PM Sub-Agent Cluster

| Slug | Name | Description | VS Code file | Claude Code file |
|------|------|-------------|-------------|-----------------|
| `ledger-wp-decomposer` | Ledger WP Decomposer | Analyze a plan document and decompose it into atomic, actionable Work Package definitions. | `ledger-wp-decomposer.agent.md` | `ledger-wp-decomposer.md` |
| `ledger-dependency-sequencer` | Ledger Dependency Sequencer | Map dependencies between Work Packages, identify parallelization opportunities, and determine optimal execution ordering. | `ledger-dependency-sequencer.agent.md` | `ledger-dependency-sequencer.md` |
| `ledger-pipeline-configurator` | Ledger Pipeline Configurator | Determine which pipeline stages should be active for each Work Package based on the nature of the work. | `ledger-pipeline-configurator.agent.md` | `ledger-pipeline-configurator.md` |
| `ledger-bootstrapper` | Ledger Bootstrapper | Mechanically initialize the project ledger: create all Work Package entries via MCP tools and verify the setup is complete. | `ledger-bootstrapper.agent.md` | `ledger-bootstrapper.md` |

### Ledger Workflow Utilities

| Slug | Name | Description | VS Code file | Claude Code file |
|------|------|-------------|-------------|-----------------|
| `ledger-claude-coordinator` | Ledger Claude Coordinator | Coordinate the multi-stage agentic pipeline by consulting the central_pm ledger and dispatching work to the correct sub-agent. | `ledger-claude-coordinator.agent.md` | `ledger-claude-coordinator.md` |
| `ledger-doctor` | Ledger Doctor | Audit and repair ledger workflow projects: diagnose deadlocks, fix state corruption, unlock stalled pipelines, and resolve technical issues. | `ledger-doctor.agent.md` | `ledger-doctor.md` |
| `ledger-orchestrator-runner` | Ledger Orchestrator Runner | Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run from a plan document. | `ledger-orchestrator-runner.agent.md` | `ledger-orchestrator-runner.md` |
| `ledger-knowledge-archiver` | Ledger Knowledge Archiver | Extract and commit reusable knowledge from completed ledger project folders into the knowledge base. | `ledger-knowledge-archiver.agent.md` | `ledger-knowledge-archiver.md` |
| `ledger-knowledge-curator` | Ledger Knowledge Curator | Audit knowledge base entries for value, accuracy, and relevance — edit, merge, or delete entries that fail quality thresholds. | `ledger-knowledge-curator.agent.md` | `ledger-knowledge-curator.md` |

---

## MCP Server Dependency

All ledger-support personas share `mcp_server_name: central_pm` via the suite's `_shared.yaml`. The generated Claude Code frontmatter includes `mcpServers:\n  - central_pm` automatically for all personas in this suite.

Individual personas that require specific MCP tool access (e.g., `central_pm/*`) declare this in their `tools:` list. See each persona's YAML file for the full tool list.

---

## Build & Sync

Build the ledger-support suite:

```bash
# From workspace root
node scripts/build-personas.js --suite ledger-support --target all
```

Sync to VS Code and Claude Code:

```bash
# Full sync (all suites)
node scripts/sync-personas.js

# VS Code only
node scripts/sync-personas.js --target vscode

# Claude Code only
node scripts/sync-personas.js --target claude-code
```

### `id` Field Stability

All 9 personas in this suite carry `id` values with the `standalone-` prefix (e.g., `id: standalone-ledger-bootstrapper`). These IDs were assigned when the personas lived in the standalone suite and must **never change** — they are VS Code `@id` routing keys. The `standalone-*` prefix is a permanent historical artifact. New personas added to the `ledger-support` suite in the future must use the `ledger-support-{slug}` prefix convention.

```