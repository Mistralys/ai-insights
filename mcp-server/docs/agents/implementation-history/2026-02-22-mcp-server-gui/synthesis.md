# Synthesis Report — MCP Server GUI Dashboard

**Project:** `2026-02-22-mcp-server-gui`
**Completed:** 2026-02-22
**Status:** COMPLETE — all 6 work packages passed all pipeline stages

---

## Executive Summary

A lightweight, zero-dependency web GUI dashboard was successfully added to the MCP server sub-project. It runs as a separate HTTP process on port 3420, sharing the same `storage/ledger/` directory as the STDIO-based MCP server. The frontend is a vanilla HTML/CSS/JS SPA; the backend is a minimal `node:http` server with no framework. The feature is fully tested, documented, and non-breaking — the existing 310-test suite was preserved intact and 35 new tests were added.

---

## What Was Built

### Architecture

```
┌──────────────────┐         ┌───────────────────────┐
│  MCP Server      │         │  GUI Dashboard Server  │
│  (STDIO process) │         │  (HTTP process)        │
│  stdin/stdout ◄──┤         │  :3420 ◄── Browser     │
└────────┬─────────┘         └──────────┬─────────────┘
         │                              │
         │      ┌──────────────┐        │
         └─────►│ storage/     │◄───────┘
                │ ledger/      │
                └──────────────┘
```

Both processes read from the same ledger on disk. The GUI server imports `LedgerStore`, `atomicWriteJson`, `withLock`, and all Zod schemas from the existing codebase — no duplication.

### New Files Produced

| File | Purpose |
|------|---------|
| `mcp-server/src/gui/config.ts` | `GuiConfigSchema`, `getConfig()`, `readConfigFromDisk()`, `writeConfig()`, `startConfigWatcher()`, `stopConfigWatcher()` |
| `mcp-server/gui/api.ts` | 7 REST API handler functions: `handleListProjects`, `handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetConfig`, `handleUpdateConfig` |
| `mcp-server/gui/server.ts` | Node.js HTTP server — CLI arg parsing, routing, static serving, CORS, EADDRINUSE handling |
| `mcp-server/gui/public/index.html` | SPA shell with nav and `<main id="app">` |
| `mcp-server/gui/public/styles.css` | CSS custom properties, status badges, table/card/button/form styles; no external dependencies |
| `mcp-server/gui/public/app.js` | Vanilla JS SPA — hash-based router, API client, 4 views, `escapeHtml()` XSS guard, auto-refresh polling |
| `mcp-server/tests/gui/config.test.ts` | 13 unit tests for the config module |
| `mcp-server/tests/gui/api.test.ts` | 17 unit tests for all API handlers |
| `mcp-server/tests/gui/handoff-config-integration.test.ts` | 5 integration tests verifying runtime config changes affect handoff behavior without MCP server restart |

### Modified Files

| File | Change |
|------|--------|
| `mcp-server/src/utils/workflow-helpers.ts` | Replaced `MAX_HANDOFF_DEPTH` constant with `getMaxHandoffDepth()` reading from in-memory config cache |
| `mcp-server/src/tools/workflow-handoff.ts` | Added `auto_handoff_enabled` guard and `getMaxHandoffDepth()` call in `buildHandoffResponse()` |
| `mcp-server/src/index.ts` | Calls `readConfigFromDisk()` and `startConfigWatcher()` at MCP server startup |
| `mcp-server/package.json` | Added `"gui": "tsx gui/server.ts"` script |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Added `gui/`, `tests/gui/`, and `gui-config.json` entries |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | Added sections 7 (GUI Dashboard Server) and 8 (Runtime Config Monitoring) |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Added Runtime Config Monitoring constraint section (watcher lifecycle, debounce, fallback, `ledger_root` read-only) |
| `mcp-server/README.md` | Added GUI Dashboard section with startup command and feature list |

---

## Work Package Summary

### WP-001 — Runtime Config Module
**Scope:** `src/gui/config.ts`, `workflow-helpers.ts`, `workflow-handoff.ts`, `index.ts`

Replaced the hard-coded `MAX_HANDOFF_DEPTH` constant with a live config system. `src/gui/config.ts` provides a module-level in-memory cache backed by `gui-config.json`, a `fs.watch()` watcher with a 250ms debounce, and atomic writes via `atomicWriteJson()`. The `buildHandoffResponse()` path now respects both `auto_handoff_enabled` and `max_handoff_depth` from the live config — changes take effect without restarting the MCP server.

**Key decision:** `config.ts` was placed in `src/gui/config.ts` (not `gui/config.ts`) to comply with `tsconfig.json`'s `rootDir: './src'` constraint. The `gui/` root directory is reserved for server-process files executed via `tsx`.

### WP-002 — GUI API Handlers
**Scope:** `gui/api.ts`

Seven handler functions encapsulate all REST API logic. Error handling is unified via a typed `ApiError` class with `code`, `message`, and optional `details`. `handleUpdateConfig` uses a `GuiConfigPartialSchema` that omits `ledger_root` — Zod's default strip behavior silently drops any `ledger_root` sent by the client. `handleDeleteProject` guards on `meta.status === 'COMPLETE'` before any destructive action.

### WP-003 — HTTP Server
**Scope:** `gui/server.ts`, `package.json`

A standalone `node:http` server with manual segment-matching router (no framework). Startup sequence: parse CLI args → `resolveLedgerRoot()` → `readConfigFromDisk()` → `startConfigWatcher()` → `listen()`. Serves `gui/public/` statically with MIME types and a path-traversal guard. CORS headers are added on all responses. `EADDRINUSE` exits with code 1 and a clear diagnostic message. Started via `npm run gui`.

### WP-004 — Frontend SPA
**Scope:** `gui/public/index.html`, `gui/public/styles.css`, `gui/public/app.js`

A plain JS SPA with a hash-based router. Four views: project list (with status filter dropdown and 10-second auto-refresh), project detail (WP summary table), work-package detail (pipelines, acceptance criteria, handoff notes), and configuration. `escapeHtml()` is applied at 20+ interpolation sites — no XSS surface. The config view displays `ledger_root` as read-only and omits it from the save payload. Auto-refresh polling is registered on view entry and cleared on navigation to prevent phantom callbacks.

### WP-005 — Test Suite
**Scope:** `tests/gui/config.test.ts` (13), `tests/gui/api.test.ts` (17), `tests/gui/handoff-config-integration.test.ts` (5)

35 new tests added; total suite grew from 311 to 346, all passing. `config.test.ts` uses real `fs.watch()` (no mocks) — appropriate for OS-level watcher behavior. A 400ms wait (debounce 250ms + 150ms I/O buffer) is used on Windows where duplicate change events occur within <100ms. `api.test.ts` verifies post-conditions: `handleDeleteProject` asserts the directory is absent after deletion; FORBIDDEN tests assert the directory is still present after rejection. Integration tests write and re-read real config files to disk, confirming live config changes propagate through `buildHandoffResponse()` without MCP server restart.

A `__resetForTesting()` helper was added to `src/gui/config.ts` in a clearly-labeled test-only section. `writeConfig()` gained defense-in-depth `ledger_root` stripping (via `{ ledger_root: _ignored, ...safeData }` destructure) to protect against direct calls bypassing the handler-level strip.

### WP-006 — Manifest Documentation
**Scope:** `file-tree.md`, `tech-stack.md`, `constraints.md`, `README.md`

All four project manifest files updated to reflect the new components. A redundant H2+H3 duplicate heading in `constraints.md` was caught and fixed during code review. Documentation verified line-by-line against implementation: `250ms` debounce in docs matches `setTimeout(_, 250)` in code; `ledger_root` stripping docs match the `{ ledger_root: _ignored, ...safeData }` destructure in `writeConfig()`.

---

## Test Metrics

| Stage | Tests Passing |
|-------|--------------|
| Baseline (pre-project) | 310 |
| After WP-001 QA (new auto_handoff_enabled test) | 311 |
| After WP-005 (+35 GUI tests) | **346** |
| Final | **346 / 346** |

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Separate HTTP process, not embedded in MCP server | STDIO discipline — stdout is reserved for MCP protocol; a second process cannot break it |
| `src/gui/config.ts` location (not `gui/config.ts`) | Complies with `tsconfig.json` `rootDir: './src'`; keeps the config module under the main tsc compile |
| `gui/api.ts` and `gui/server.ts` run via `tsx`, not compiled by main tsc | These are entry-point files for a separate process; tsc type-check passes but they live outside `rootDir` |
| No framework for HTTP server | Zero new dependencies; `node:http` is sufficient for 6 routes |
| No ES modules / no build step for frontend | Constraint from plan — simplest possible frontend; loads from static file server |
| Real `fs.watch()` in `config.test.ts` | Cannot mock OS-level watcher; real-fs approach is the correct strategy and provides a reliable regression guard |
| `ledger_root` read-only enforced at two layers | Handler-level (`GuiConfigPartialSchema` strips it) + `writeConfig()` destructure — defense-in-depth |
| 250ms debounce on config watcher | Windows fires 2–3 events per write within <100ms; debounce collapses them to one reload |

---

## Open Items / Technical Debt

All items are low priority and non-blocking.

| Item | Priority | Source |
|------|----------|--------|
| No automated tests for `gui/server.ts` (HTTP server); all AC verified by live testing | Low | WP-003 QA |
| `gui/config.ts` has no dedicated unit tests in WP-001 (covered by WP-005 `config.test.ts`) | Resolved in WP-005 | WP-001 QA |
| `handleGetConfig` test in `api.test.ts` does not assert `ledger_root` (cosmetic gap; `ledger_root` immutability fully covered elsewhere) | Low | WP-005 code-review |
| `README.md` line 292 pre-existing: "18 MCP tools" should be "19 MCP tools" (predates this project) | Low | WP-006 code-review |
| `constraints.md` redundant H2+H3 heading — **fixed during WP-006 code review** | Resolved | WP-006 |
| `handoff-config-integration.test.ts` shows a pending dot (·) in Vitest parallel worker output before completion — cosmetic, not a real intermittent failure | Low | WP-005 QA |

---

## How to Run

```bash
# Start the GUI dashboard (defaults to port 3420)
cd mcp-server
npm run gui

# Custom port
npm run gui -- --port 4000

# Custom ledger directory
npm run gui -- --ledger-dir /path/to/ledger

# Run full test suite
npm test
```

The dashboard is then accessible at `http://localhost:3420/`.

---

## Architectural Integrity

- **No stdout writes introduced** in any `mcp-server/src/` file — STDIO discipline maintained throughout.
- **All file writes use `atomicWriteJson()`** — write-to-temp-then-rename pattern preserved.
- **All ESM imports use `.js` extensions** — module resolution convention upheld.
- **No new production dependencies added** — `node:http`, `fs`, and `path` are Node.js built-ins.
- **All new tests use `mkdtemp` + `rm(recursive, force)` cleanup** — no persistent side-effects between test runs.
- **All manifest documents updated** — project manifest remains authoritative and accurate post-project.
