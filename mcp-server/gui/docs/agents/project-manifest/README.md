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
