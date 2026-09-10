# MCP Server - Manifest (README)
<INSTRUCTION>
# MCP Server - Manifest: Project Overview
Project manifest README: module scope, architectural summary, and index of all manifest documents.
Includes the GUI sub-manifest hub — changes under mcp-server/gui/ are documented there, not in the MCP server manifest.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── project-manifest/
                └── README.md

```
###  Path: `/mcp-server/docs/agents/project-manifest/README.md`

```md
# Project Manifest: Project Ledger MCP Server

**Version:** 1.1.0  
**Last Updated:** 2026-05-30  
**Purpose:** MCP server for Project Ledger workflow coordination

---

## Overview

The **Project Ledger MCP Server** is a TypeScript-based Model Context Protocol (MCP) server that provides typed tools for managing project ledgers in AI agent workflows. It eliminates dual-file desync bugs by wrapping ledger operations with validation, atomicity, and consistency guarantees.

The server manages two types of JSON files:
- **Root Index** (`.ledger/project-ledger.json`): Project-level metadata and work package summaries
- **Work Package Details** (`.ledger/WP-###.json`): Per-work-package implementation details, pipelines, and acceptance criteria

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, frameworks, libraries, and architectural patterns |
| [File Tree](file-tree.md) | Visual directory structure with annotations |
| [Public API Surface](api-surface.md) | MCP tools, classes, types, and public methods |
| [Key Data Flows](data-flows.md) | Main interaction paths through the system |

### Constraints

Constraints are split by domain. Start with **Core**; the others are consulted when working in
their area.

| Document | Covers |
|----------|--------|
| [constraints.md](constraints.md) | **Core** — file I/O, storage layout, schema, module system, validation, concurrency, build, manifest authoring, cross-platform |
| [constraints-workflow.md](constraints-workflow.md) | Status transitions, claiming, pipelines, handoffs, workflow gotchas |
| [constraints-testing.md](constraints-testing.md) | Test isolation, fixtures, helper mandate, mocking policy |
| [constraints-code-style.md](constraints-code-style.md) | Naming, loops, compiler strictness, JSDoc, Zod schema shape |
| [constraints-storage.md](constraints-storage.md) | Knowledge store, multi-store architecture, known limitations |
| [GUI constraints](../../../gui/docs/agents/project-manifest/constraints.md) | Frontend and HTTP-server conventions — owned by the [GUI sub-manifest](../../../gui/docs/agents/project-manifest/README.md) |

> **Citation convention:** constraints are cited by heading, not by number. Numbers were removed
> after repeated collisions made references ambiguous.

---

## GUI Sub-Manifest

The GUI (`mcp-server/gui/`) maintains its own manifest covering the vanilla-JS frontend and the
standalone HTTP server: [gui/docs/agents/project-manifest/](../../../gui/docs/agents/project-manifest/README.md).
Changes to `gui/` are documented there, not in this manifest.

---

## Usage Context

This server is designed to be invoked via the MCP protocol over STDIO transport. It is used by AI agents following a 9-stage workflow (Planner, Project Manager, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis) to maintain consistency across multi-agent sessions.

---

## Development Commands

**Version Management:**
```bash
npm run sync-version   # Sync version from changelog.md to package.json
```

**Development:**
```bash
npm run dev           # Run server (auto-syncs version via predev hook)
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
```

**Important:** The version in `changelog.md` is the **source of truth**. When releasing a new version:
1. Update `changelog.md` first (add new version header at top)
2. Run `npm run sync-version` to update `package.json`
3. The MCP server displays its version at startup: `[project-ledger-mcp] Server v1.21.1 started successfully`

See [constraints.md](constraints.md#development--build-constraints) for more details.

---

## Setup (Global MCP Registration)

The recommended setup path is **global registration** via `scripts/install-mcp-global.js`,
invoked through the workspace CLI:

```bash
node scripts/cli.js install-mcp
```

This command installs a stable shim at `~/.ai-insights/bin/launch-server.js` and merges
the `central_pm` server key into the VS Code user-level `mcp.json`, making the MCP server
available across all workspaces without per-project configuration. A `--dry-run` flag previews
the changes without writing.

---

## Related Documentation

- **Ledger Schema:** `/personas/ledger/project-ledger-schema.md`
- **Workflow Plans:** `/docs/agents/plans/`
- **Agent Personas:** `/personas/ledger/`

```
_SOURCE: GUI sub-manifest hub (manifest index, architecture overview, key relationships)_
# GUI sub-manifest hub (manifest index, architecture overview, key relationships)
```
// Structure of documents
└── mcp-server/
    └── gui/
        └── docs/
            └── agents/
                └── project-manifest/
                    └── README.md

```
###  Path: `/mcp-server/gui/docs/agents/project-manifest/README.md`

```md
# Project Manifest — MCP Server GUI

> **Sub-project:** `mcp-server/gui/`
> **Type:** Vanilla JavaScript SPA + Node.js HTTP backend
> **Purpose:** Web-based dashboard for managing project ledgers, orchestrator runs, knowledge insights, and workflow state — served as a standalone process alongside the MCP server.

---

## Manifest Index

| Document | Contents |
|----------|----------|
| [tech-stack.md](tech-stack.md) | Runtime, architecture, serving model, dependencies, theming system. |
| [file-tree.md](file-tree.md) | Annotated directory structure of all GUI source files. |
| [api-surface.md](api-surface.md) | Backend REST API routes, frontend global namespaces, JS widget APIs. |
| [ui-components.md](ui-components.md) | CSS component library: theme tokens, buttons, badges, cards, tables, forms, and all view-specific classes. |
| [data-flows.md](data-flows.md) | Request lifecycle, SPA routing, polling, theme initialization. |
| [constraints.md](constraints.md) | Architectural invariants, naming conventions, security rules. |

---

## Architecture Overview

The GUI is a **zero-build-step** single-page application:

- **Backend:** A standalone Node.js HTTP server (`server.ts`) that serves static files from `public/` and exposes a REST API. It imports handlers from the parent MCP server's storage layer.
- **Frontend:** Vanilla JavaScript (ES5-compatible IIFE modules) loaded via `<script>` tags in `index.html`. No bundler, no transpiler, no framework.
- **Routing:** Hash-based client-side routing (`#/projects/repo/slug`, `#/orchestrator`, etc.).
- **Theming:** CSS custom properties with a `[data-theme="dark"]` toggle stored in `localStorage`.

The server is launched separately from the MCP server process (typically via `tsx gui/server.ts` or the `scripts/run-gui.js` wrapper) and listens on port 3420 by default.

---

## Key Relationships

| Dependency | Notes |
|------------|-------|
| `mcp-server/src/storage/` | Backend handlers use `LedgerStore`, `KnowledgeStoreManager`, file locks. |
| `mcp-server/src/utils/` | Imports `ledger-root.ts`, `constants.ts`, `pipeline-maps.ts`, `workspace-versions.ts`. |
| `mcp-server/src/schema/` | Zod schemas for validation (`ProjectMetaSchema`, `InsightScope`, etc.). |
| `mcp-server/src/gui/` | Config management (`config.ts`), auto-archive timer, queue helpers, error class. |
| `orchestrator/` | The GUI can start/kill/monitor orchestrator processes via `orchestrator-manager.ts`. |

---

## How to Run

```bash
# From the mcp-server/ directory:
npx tsx gui/server.ts --port 3420

# Or from the workspace root via the wrapper script:
node scripts/run-gui.js
```

The server logs to stdout (unlike the MCP server which must avoid stdout). Open `http://localhost:3420` in a browser.

```