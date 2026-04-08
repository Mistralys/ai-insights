# Personas - Standalone Suite Guide
_SOURCE: Standalone personas guide (PM sub-agent cluster, persona catalog, Claude Code injection)_
# Standalone personas guide (PM sub-agent cluster, persona catalog, Claude Code injection)
```
// Structure of documents
└── personas/
    └── standalone/
        └── README.md

```
###  Path: `/personas/standalone/README.md`

```md
# Standalone Personas

## Overview

Standalone personas are single-purpose tools that operate **independently of the 9-stage ledger workflow**. They have no `role` field, no workflow roster, and no agent-to-agent handoff mechanism. Each persona is a self-contained specialist invoked directly by the user or as a sub-agent within a larger orchestration.

Key differences from ledger workflow personas:

| Property | Ledger Personas | Standalone Personas |
|----------|----------------|-------------------|
| `role` field | Required (matches `AGENT_ROLES`) | Absent |
| Roster / handoff | Full 9-agent pipeline | None |
| `mcp_server_name` | In `_shared.yaml` | **Not allowed** ([constraint 19](../docs/agents/project-manifest/constraints.md#c19)) |
| File prefix | `N-name.md` (numbered) | Slug-based (e.g., `researcher.agent.md`) |

Standalone personas are built from sources in `personas/standalone/src/` and output to:
- `personas/standalone/vs-code/` — VS Code target (`.agent.md` extension)
- `personas/standalone/claude-code/` — Claude Code target (plain `.md` extension)

For build and sync instructions see [personas/docs/agents/project-manifest/](../docs/agents/project-manifest/README.md).

---

## PM Sub-Agent Cluster

Four standalone personas form the **Project Manager sub-agent cluster** — a sequential orchestration chain where each agent's output is the next agent's input. The PM persona (`2-project-manager`) invokes these in order when decomposing a plan into a ready-to-run ledger:

```
[Plan Document]
      │
      ▼
┌─────────────────┐
│  WP Decomposer  │  Analyze plan → produce atomic WP definitions
└────────┬────────┘
         │ WP definitions
         ▼
┌───────────────────────┐
│  Dependency Sequencer │  Map WP dependencies → determine execution order
└──────────┬────────────┘
           │ Ordered WP list with dependencies
           ▼
┌────────────────────────┐
│  Pipeline Configurator │  Select pipeline stages per WP (implementation, qa, etc.)
└───────────┬────────────┘
            │ WPs with active_pipeline_stages configured
            ▼
┌─────────────────────┐
│  Ledger Bootstrapper │  Create all WP entries via MCP tools; verify setup
└─────────────────────┘
```

Each step is a separate agent invocation. The PM passes structured output from one agent as input to the next. See [personas/ledger/README.md](../ledger/README.md) for the full ledger workflow context.

> **Claude Code note:** The `ledger-bootstrapper` persona requires MCP tool access (`central_pm/*`). Its generated Claude Code file includes `mcpServers: central_pm` automatically — see [Claude Code — MCP Server Auto-Injection](#claude-code--mcp-server-auto-injection).

---

## Persona Catalog

All 16 standalone personas, sourced from `personas/standalone/src/meta/*.yaml`:

### PM Sub-Agent Cluster

| Slug | Name | Description | VS Code file | Claude Code file |
|------|------|-------------|-------------|-----------------|
| `wp-decomposer` | WP Decomposer | Analyze a plan document and decompose it into atomic, actionable Work Package definitions. | `wp-decomposer.agent.md` | `wp-decomposer.md` |
| `dependency-sequencer` | Dependency Sequencer | Map dependencies between Work Packages, identify parallelization opportunities, and determine optimal execution ordering. | `dependency-sequencer.agent.md` | `dependency-sequencer.md` |
| `pipeline-configurator` | Pipeline Configurator | Determine which pipeline stages should be active for each Work Package based on the nature of the work. | `pipeline-configurator.agent.md` | `pipeline-configurator.md` |
| `ledger-bootstrapper` | Ledger Bootstrapper | Mechanically initialize the project ledger: create all Work Package entries via MCP tools and verify the setup is complete. | `ledger-bootstrapper.agent.md` | `ledger-bootstrapper.md` |

### General-Purpose Personas

| Slug | Name | Description | VS Code file | Claude Code file |
|------|------|-------------|-------------|-----------------|
| `agents-md-curator` | AGENTS.md Curator | Generate, update, and maintain AGENTS.md files — the operating manual for AI agents entering a codebase. | `agents-md-curator.agent.md` | `agents-md-curator.md` |
| `changelog-curator` | Changelog Curator | Produce clean, scannable changelogs from Git history or rewrite verbose agent-generated entries into a concise house style. | `changelog-curator.agent.md` | `changelog-curator.md` |
| `composer-curator` | Composer Curator | Verify that the project's composer.json file is set up correctly for agentic coding. | `composer-curator.agent.md` | `composer-curator.md` |
| `ctx-architect` | CTX Architect | Design, generate, and maintain CTX Generator context documentation configurations — from root project setup to per-module configs. | `ctx-architect.agent.md` | `ctx-architect.md` |
| `manifest-curator` | Manifest Curator | Create, update, and audit project manifests — the source of truth for AI agent sessions. | `manifest-curator.agent.md` | `manifest-curator.md` |
| `module-intent-architect` | Module Intent Architect | Infers and documents the purpose, role, and dependencies of specific code modules by analyzing the source. | `module-intent-architect.agent.md` | `module-intent-architect.md` |
| `orchestrator-runner` | Orchestrator Runner | Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run from a plan document. | `orchestrator-runner.agent.md` | `orchestrator-runner.md` |
| `readme-curator` | README Curator | Produces a human-optimized README.md that follows a landing-page funnel: Hook → Features → Requirements → Quick Start → Learn More. | `readme-curator.agent.md` | `readme-curator.md` |
| `researcher` | Researcher | Research solutions to complex problems through known patterns or creative thinking. | `researcher.agent.md` | `researcher.md` |
| `standalone-developer` | Standalone Developer | Implement scoped plan documents without ledger workflow, including code insights and a `synthesis.md` output in the plan folder. | `standalone-developer.agent.md` | `standalone-developer.md` |
| `unit-test-auditor` | Unit Test Auditor | Audit specific codebase parts. | `unit-test-auditor.agent.md` | `unit-test-auditor.md` |
| `whatsnew-curator` | WHATSNEW Curator | Write bilingual WHATSNEW.xml release note entries from the developer changelog, filtering to user-facing changes only. | `whatsnew-curator.agent.md` | `whatsnew-curator.md` |

---

## Claude Code — MCP Server Injection

### Conditional `mcpServers` in standalone CC output

`FRONTMATTER_STANDALONE_CC` conditionally injects a `mcpServers` block via `{{#if mcp_server_name}}`. Personas that set `mcp_server_name: central_pm` in their per-persona YAML receive the block; personas that omit the field produce no `mcpServers` entry.

**Result:** `ledger-bootstrapper.md` declares `mcpServers:\n  - central_pm` in its frontmatter. All other standalone CC personas with no `mcp_server_name` field produce no `mcpServers` block.

---

## Build & Sync

For detailed build commands, template syntax, and sync conventions, see:

- [personas/docs/agents/project-manifest/README.md](../docs/agents/project-manifest/README.md) — Quick reference
- [personas/docs/agents/project-manifest/api-surface.md](../docs/agents/project-manifest/api-surface.md) — Build script functions and template syntax
- [personas/docs/agents/project-manifest/constraints.md](../docs/agents/project-manifest/constraints.md) — All naming, editing, and cross-system constraints
- [personas/docs/agents/project-manifest/constraints.md](../docs/agents/project-manifest/constraints.md) — All naming, editing, and cross-system constraints (includes directory layout table)

**Quick commands:**

```bash
# Build standalone suite only
node scripts/build-personas.js --suite standalone

# Build all suites
node scripts/build-personas.js --suite all

# Build + deploy to VS Code and Claude Code
node scripts/sync-personas.js --suite standalone
```

```