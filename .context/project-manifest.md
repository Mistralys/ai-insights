# AI Insights - Project Manifest Hub
_SOURCE: Unified entry point linking all module manifests, cross-system dependencies, and shared infrastructure_
# Unified entry point linking all module manifests, cross-system dependencies, and shared infrastructure
```
// Structure of documents
└── docs/
    └── agents/
        └── project-manifest/
            └── README.md

```
###  Path: `/docs/agents/project-manifest/README.md`

```md
# Project Manifest — AI Insights Workspace

**Version:** 1.0.0
**Last Updated:** 2026-03-22

> **This is the unified entry point for understanding the AI Insights codebase.** Each sub-project maintains its own detailed manifest; this document provides workspace-level context and links everything together.

---

## Workspace Overview

AI Insights is a **monorepo-style workspace** containing three sub-projects and shared root-level tooling that together provide a multi-agent software development workflow:

| Sub-Project | Path | Language | Purpose |
|-------------|------|----------|---------|
| **Project Ledger MCP Server** | `mcp-server/` | TypeScript (ESM) | MCP server providing typed tools for managing project ledgers in AI agent workflows |
| **Ledger Personas Build System** | `personas/` | JavaScript (CJS) | Template engine that assembles persona Markdown files from YAML/Markdown sources |
| **Orchestrator** | `orchestrator/` | Python 3.11+ | LangGraph + Deep Agents headless pipeline executor — deterministic alternative to IDE-based workflows |

Root-level `scripts/` orchestrate cross-project operations. `shared/workflow-manifest.json` is the single source of truth for roles, pipelines, and status enums.

---

## Module Manifests

Each sub-project has its own detailed manifest following a consistent structure:

### MCP Server

**Location:** [`mcp-server/docs/agents/project-manifest/`](../../../mcp-server/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../mcp-server/docs/agents/project-manifest/README.md) | Project overview, MCP server purpose, development commands |
| [tech-stack.md](../../../mcp-server/docs/agents/project-manifest/tech-stack.md) | TypeScript runtime, Zod, MCP SDK, architectural patterns |
| [constraints.md](../../../mcp-server/docs/agents/project-manifest/constraints.md) | Atomic writes, file locking, STDIO discipline, schema rules |
| [file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for mcp-server/ |
| [api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) | 19 MCP tools, LedgerStore class, utility functions |
| [data-flows.md](../../../mcp-server/docs/agents/project-manifest/data-flows.md) | Initialization, pipeline execution, handoff, detection flows |

**See also:** [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases.

### Personas

**Location:** [`personas/docs/agents/project-manifest/`](../../../personas/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../personas/docs/agents/project-manifest/README.md) | Build system overview, quick reference commands |
| [tech-stack.md](../../../personas/docs/agents/project-manifest/tech-stack.md) | Node.js runtime, js-yaml, template engine patterns |
| [api-surface.md](../../../personas/docs/agents/project-manifest/api-surface.md) | Build script functions, template syntax, metadata schema, MCP tool allocation matrix |
| [data-flows.md](../../../personas/docs/agents/project-manifest/data-flows.md) | Build pipeline, sync pipeline, template resolution |
| [constraints.md](../../../personas/docs/agents/project-manifest/constraints.md) | Core rules: source editing, naming, versioning, safety guards |
| [constraints-build-system.md](../../../personas/docs/agents/project-manifest/constraints-build-system.md) | Template engine, build flags, log conventions, sync script rules |
| [constraints-cross-system.md](../../../personas/docs/agents/project-manifest/constraints-cross-system.md) | Synchronization contracts with MCP server and Agent Registry |

### Orchestrator

**Location:** [`orchestrator/docs/agents/project-manifest/`](../../../orchestrator/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../orchestrator/docs/agents/project-manifest/README.md) | Orchestrator manifest hub — links to topic-specific docs |
| [architecture.md](../../../orchestrator/docs/architecture.md) | Stage nodes, MCP tool wrapping, workflow state management |
| [supervisor-routing.md](../../../orchestrator/docs/supervisor-routing.md) | Deterministic supervisor dispatch model |
| [public-api.md](../../../orchestrator/docs/public-api.md) | CLI, graph construction, supervisor, and utility entry points |
| [jsonl-log-schema.md](../../../orchestrator/docs/jsonl-log-schema.md) | Run log field reference |
| [smoke-testing.md](../../../orchestrator/docs/smoke-testing.md) | Dispatch loop verification runbook |

---

## Cross-System Dependencies

These synchronization points span multiple sub-projects. Breaking any of them causes silent failures.

| Dependency | Source of Truth | Must Stay In Sync With |
|------------|----------------|------------------------|
| Agent role names | `shared/workflow-manifest.json` → `roles[].name` | `mcp-server/…/constants.ts` → `AGENT_ROLES` (auto-derived); `scripts/sync-personas.js` → `KNOWN_ROLES` (auto-derived); persona YAML → `role` field (validated by build) |
| MCP server name | `personas/ledger/src/meta/_shared.yaml` → `mcp_server_name` | `.mcp.json` → server key (default: `central_pm`) |
| Persona `vs_file_name` | Per-persona YAML | Agent Registry scan pattern (`*.agent.md`) in `mcp-server/src/utils/agent-registry.ts` |
| Version (MCP server) | `mcp-server/changelog.md` | `mcp-server/package.json` (via `npm run sync-version`) |
| Version (Personas) | `personas/changelog.md` | `personas/ledger/src/meta/_shared.yaml` → `default_version` |
| Orchestrator MCP server command | `orchestrator/.env` → `MCP_SERVER_CMD` | `mcp-server/` build output (`dist/index.js`) |
| Orchestrator persona files | `orchestrator/src/config.py` → `PERSONA_FILES` | `personas/ledger/claude-code/` filenames |
| Workflow logic | `mcp-server/docs/agents/workflow-specification/` | `mcp-server/src/`, `orchestrator/src/`, test assertions |
| Changelogs | Root `changelog.md` (Git-tagged) | `mcp-server/changelog.md`, `orchestrator/changelog.md`, `personas/changelog.md` |

### Validation Scripts

| Script | Purpose | Run From |
|--------|---------|----------|
| `node scripts/validate-workflow-manifest.js` | Validate `shared/workflow-manifest.json` structure and semantics | Workspace root |
| `node scripts/check-known-roles.js` | Delegates to manifest validation | Workspace root |
| `node scripts/build-personas.js --check` | Detect stale generated persona output | Workspace root |

---

## Shared Infrastructure

| File | Purpose |
|------|---------|
| `shared/workflow-manifest.json` | Single source of truth for roles, pipelines, status enums, and workflow constants |
| `shared/workflow-manifest.schema.json` | JSON Schema (Draft-07) enforcing structural constraints |
| `scripts/cli.js` | Interactive command center for all workspace operations |
| `scripts/sync-personas.js` | Build + deploy personas to VS Code and/or Claude Code |
| `scripts/build-personas.js` | Assemble persona files from template sources |
| `scripts/preflight-orchestrator.js` | Pre-flight readiness checks for the orchestrator |
| `context.yaml` | [CTX Generator](https://github.com/context-hub/generator) root config — generates `.context/` snapshots |
| [`docs/agents/deferred-topics.md`](../deferred-topics.md) | Tracks deliberately deferred implementation decisions with structured trigger/timeline fields |

---

## Generated Context (`.context/`)

The `.context/` directory contains auto-generated Markdown snapshots of the entire codebase, produced by the CTX Generator via `node scripts/cli.js ctx-generate`. These files are tracked in VCS and ideal for feeding into LLMs or external tools.

| Path | Contents |
|------|----------|
| `.context/README.md` | Workspace overview |
| `.context/workspace-structure.md` | Top-level directory tree |
| `.context/scripts.md` | All workspace scripts source |
| `.context/shared-manifest.md` | `workflow-manifest.json` + schema |
| `.context/mcp-server/…` | MCP server overview, manifest, source, tests, file tree |
| `.context/orchestrator/…` | Orchestrator overview, docs, source, tests, file tree |
| `.context/personas/…` | Personas overview, manifest, metadata, partials, file tree |

---

## Navigation Quick Reference

| I Need To… | Go Here |
|------------|---------|
| Understand the whole workspace | [README.md](../../../README.md) |
| Understand how agents should operate | [AGENTS.md](../../../AGENTS.md) |
| Look up an MCP tool signature | [MCP server api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [Personas api-surface.md](../../../personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [MCP server file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) |
| Understand workflow state machines | [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) |
| Understand orchestrator routing | [Supervisor Routing](../../../orchestrator/docs/supervisor-routing.md) |
| Understand the 9-agent pipeline | [Ledger Suite Guide](../../../personas/ledger/README.md) |
| Review deferred implementation decisions | [Deferred Topics](../deferred-topics.md) |
| Get a full codebase snapshot | `.context/` (run `node scripts/cli.js ctx-generate`) |

```