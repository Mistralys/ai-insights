# Project Manifest — AI Insights Workspace

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

## Hub Documents

Documents that belong to the workspace hub itself, beside this index.

| Document | Purpose |
|----------|---------|
| [cross-system-dependencies.md](cross-system-dependencies.md) | Synchronisation points between sub-projects, root scripts and shared files, plus the validation commands that check them |
| [root-tooling.md](root-tooling.md) | Root-level scripts, shared libraries and shared configuration (`scripts/`, `shared/`, `context.yaml`) |
| [generated-artefacts.md](generated-artefacts.md) | Tracked and ignored generated files across the repository, what writes each, and when a modified copy can be discarded |
| [curation-log.md](curation-log.md) | Standing decisions about how this hub manifest is arranged, plus the dated trail of curation passes |

---

## Module Manifests

Each sub-project has its own detailed manifest following a consistent structure:

### MCP Server

**Location:** [`mcp-server/docs/agents/project-manifest/`](../../../mcp-server/docs/agents/project-manifest/README.md)

| Document | Purpose |
|----------|---------|
| [README.md](../../../mcp-server/docs/agents/project-manifest/README.md) | Project overview, MCP server purpose, development commands |
| [tech-stack.md](../../../mcp-server/docs/agents/project-manifest/tech-stack.md) | TypeScript runtime, Zod, MCP SDK, architectural patterns |
| [constraints.md](../../../mcp-server/docs/agents/project-manifest/constraints.md) | **Core** — atomic writes, file locking, STDIO discipline, schema rules, manifest authoring |
| [constraints-workflow.md](../../../mcp-server/docs/agents/project-manifest/constraints-workflow.md) | Status transitions, claiming, pipelines, handoffs, workflow gotchas |
| [constraints-testing.md](../../../mcp-server/docs/agents/project-manifest/constraints-testing.md) | Test isolation, fixtures, helper mandate, mocking policy |
| [constraints-code-style.md](../../../mcp-server/docs/agents/project-manifest/constraints-code-style.md) | Naming, loops, compiler strictness, JSDoc, Zod schema shape |
| [constraints-storage.md](../../../mcp-server/docs/agents/project-manifest/constraints-storage.md) | Knowledge store, multi-store architecture, known limitations |
| [file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for mcp-server/ |
| [api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) | MCP tools, LedgerStore class, utility functions |
| [data-flows.md](../../../mcp-server/docs/agents/project-manifest/data-flows.md) | Initialization, pipeline execution, handoff, detection flows |

**See also:** [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) — state machines, routing, handoffs, and edge cases.

### MCP Server GUI

**Location:** [`mcp-server/gui/docs/agents/project-manifest/`](../../../mcp-server/gui/docs/agents/project-manifest/README.md)

The GUI maintains its own manifest for the vanilla-JS frontend and the standalone HTTP server.
Changes under `mcp-server/gui/` are documented here, not in the MCP server manifest.

| Document | Purpose |
|----------|---------|
| [README.md](../../../mcp-server/gui/docs/agents/project-manifest/README.md) | GUI manifest hub |
| [constraints.md](../../../mcp-server/gui/docs/agents/project-manifest/constraints.md) | No-build-step rule, ES5 frontend, routing, security headers, route table, port convention |
| [api-surface.md](../../../mcp-server/gui/docs/agents/project-manifest/api-surface.md) | REST routes and handler signatures |
| [data-flows.md](../../../mcp-server/gui/docs/agents/project-manifest/data-flows.md) | Request dispatch, polling, rendering flows |
| [ui-components.md](../../../mcp-server/gui/docs/agents/project-manifest/ui-components.md) | View and widget inventory |
| [file-tree.md](../../../mcp-server/gui/docs/agents/project-manifest/file-tree.md) | Annotated directory structure for gui/ |

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
| [constraints.md](../../../orchestrator/docs/agents/project-manifest/constraints.md) | Prompt architecture, supervisor routing, LangGraph specifics, storage paths |
| [decisions.md](../../../orchestrator/docs/agents/project-manifest/decisions.md) | Rejected alternatives and IDE/orchestrator divergences |
| [architecture.md](../../../orchestrator/docs/architecture.md) | Stage nodes, MCP tool wrapping, workflow state management |
| [supervisor-routing.md](../../../orchestrator/docs/supervisor-routing.md) | Deterministic supervisor dispatch model |
| [public-api.md](../../../orchestrator/docs/public-api.md) | CLI, graph construction, supervisor, and utility entry points |
| [jsonl-log-schema.md](../../../orchestrator/docs/jsonl-log-schema.md) | Run log field reference |
| [smoke-testing.md](../../../orchestrator/docs/smoke-testing.md) | Dispatch loop verification runbook |

---

## Cross-System Dependencies

The synchronisation points that span sub-projects, and the validation scripts that check them, are in [cross-system-dependencies.md](cross-system-dependencies.md). Breaking any of them causes silent failures.

---

## Shared Infrastructure

The root-level scripts, `shared/workflow-manifest.json` and its schema, and `context.yaml` are inventoried in [root-tooling.md](root-tooling.md).

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
| Look up a cross-system sync point | [Cross-System Dependencies](cross-system-dependencies.md) |
| Find a root-level script | [Root-Level Tooling](root-tooling.md) |
| Understand how agents should operate | [AGENTS.md](../../../AGENTS.md) |
| Look up an MCP tool signature | [MCP server api-surface.md](../../../mcp-server/docs/agents/project-manifest/api-surface.md) |
| Look up template syntax | [Personas api-surface.md](../../../personas/docs/agents/project-manifest/api-surface.md) |
| Find a file in mcp-server | [MCP server file-tree.md](../../../mcp-server/docs/agents/project-manifest/file-tree.md) |
| Understand workflow state machines | [Workflow Specification](../../../mcp-server/docs/agents/workflow-specification/README.md) |
| Understand orchestrator routing | [Supervisor Routing](../../../orchestrator/docs/supervisor-routing.md) |
| Browse agent reference docs | [References Index](../references/README.md) |
| Understand the ledger agent workflow | [Ledger Suite Guide](../../../personas/ledger/README.md) |
| See an end-to-end visual workflow map | [Ledger Workflow Visual Guide](../references/ledger-workflow-visual-guide.md) |
| Review deferred implementation decisions | [Deferred Topics](../deferred-topics.md) |
| Get a full codebase snapshot | `.context/` (run `node scripts/cli.js ctx-generate`) |
