# Plan: MCP Server GUI Dashboard

## Summary

Add a lightweight web-based GUI dashboard to the MCP server sub-project. The dashboard is a **separate HTTP server process** (not embedded in the STDIO-based MCP server) that reads from the same centralized ledger on disk. It provides four capabilities: listing active projects, permanently deleting finished projects, viewing project/work-package details, and editing server configuration (auto-handoff toggle + ledger root path).

The frontend uses vanilla HTML/CSS/JS — no framework, no build step. The backend is a minimal Node.js HTTP server using the existing `LedgerStore` class and Zod schemas for all data access.

## Architectural Context

### Existing Architecture

The MCP server (`mcp-server/`) is a TypeScript ESM project that communicates exclusively via STDIO. Key components relevant to this feature:

| Component | Path | Relevance |
|-----------|------|-----------|
| `LedgerStore` | [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) | Central storage abstraction — reads/writes project & WP data with Zod validation |
| `resolveLedgerRoot()` | [mcp-server/src/utils/ledger-root.ts](mcp-server/src/utils/ledger-root.ts) | Resolves the centralized `storage/ledger/` path |
| `ProjectMetaSchema` | [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts) | Schema for `.meta.json` per-project metadata |
| `RootIndexSchema` | [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts) | Schema for `project-ledger.json` (project overview + WP summaries) |
| `WorkPackageDetailSchema` | [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts) | Schema for `WP-###.json` files |
| `atomicWriteJson()` | [mcp-server/src/storage/atomic-writer.ts](mcp-server/src/storage/atomic-writer.ts) | Atomic write-to-temp-then-rename pattern |
| `withLock()` | [mcp-server/src/storage/file-lock.ts](mcp-server/src/storage/file-lock.ts) | File locking for concurrent writes |
| `auto_handoff_depth` | [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts) | Per-project handoff depth counter in root index |
| `MAX_HANDOFF_DEPTH` | [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) | Hard-coded constant (currently `10`) |

### Key Constraints

- **STDIO discipline**: `stdout` is reserved for MCP protocol. The GUI must be a separate process to avoid breaking protocol communication.
- **Atomic writes**: All file writes must use `atomicWriteJson()`.
- **Locking**: Writes to the ledger require `withLock()` on the project's `storageDir`.
- **Schema validation**: All reads/writes go through Zod schemas.
- **`.archive/` convention**: `LedgerStore.listAllProjects()` already skips entries starting with `.` — this means an `.archive/` directory would be isolated from normal enumeration (even though we are doing permanent delete, this is noted for future reference).

### Ledger Storage Layout

```
mcp-server/storage/ledger/
├── .gitkeep
├── {slug}/                     # Per-project folder
│   ├── .meta.json              # ProjectMeta (slug, plan_path, status, dates, title?)
│   ├── .lock                   # Lock file
│   ├── project-ledger.json     # RootIndex (status, WP summaries, comments)
│   └── WP-001.json             # WorkPackageDetail
```

## Approach / Architecture

### Process Architecture

```
┌──────────────────┐         ┌───────────────────────┐
│  MCP Server      │         │  GUI Dashboard Server  │
│  (STDIO process) │         │  (HTTP process)        │
│                  │         │                        │
│  stdin/stdout ◄──┤         │  :3420 ◄── Browser     │
│  (MCP protocol)  │         │                        │
└────────┬─────────┘         └──────────┬─────────────┘
         │                              │
         │      ┌──────────────┐        │
         └─────►│ storage/     │◄───────┘
                │ ledger/      │
                │ (JSON files) │
                └──────────────┘
```

Both processes share the same ledger directory on disk. The GUI server imports and reuses `LedgerStore`, `atomicWriteJson`, `withLock`, and all Zod schemas from the existing codebase — no duplication.

### Server Structure

A new `mcp-server/gui/` directory contains:

| File | Purpose |
|------|---------|
| `server.ts` | HTTP server entry point — routes, static file serving, API handlers |
| `api.ts` | REST API route handlers (projects CRUD, config read/write) |
| `config.ts` | Server configuration schema, read/write, and defaults |
| `public/index.html` | Single-page dashboard HTML |
| `public/styles.css` | Dashboard styles |
| `public/app.js` | Client-side JavaScript (fetch API calls, DOM manipulation) |

### API Design

All API endpoints are prefixed with `/api/` and return JSON. The frontend is served as static files from `/`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/projects` | List all projects (reuses `LedgerStore.listAllProjects()`) |
| `GET` | `/api/projects/:slug` | Get project detail (root index + meta) |
| `GET` | `/api/projects/:slug/work-packages` | List WP summaries for a project |
| `GET` | `/api/projects/:slug/work-packages/:wpId` | Get full WP detail |
| `DELETE` | `/api/projects/:slug` | Permanently delete a COMPLETE project's ledger folder |
| `GET` | `/api/config` | Read current server configuration |
| `PUT` | `/api/config` | Update server configuration |

### Configuration System

A new `gui-config.json` file in the ledger root (`mcp-server/storage/ledger/gui-config.json`) stores GUI-editable settings:

```json
{
  "auto_handoff_enabled": true,
  "max_handoff_depth": 10,
  "ledger_root": "F:\\Webserver\\www\\htdocs\\tools\\ai-insights\\mcp-server\\storage\\ledger"
}
```

**Why a separate config file?** The MCP server reads its configuration from CLI args and hard-coded constants. The GUI config file provides a persistent, human-readable store for settings that both the MCP server and GUI can reference. The MCP server watches this file at runtime using `fs.watch()` and updates its in-memory config immediately when the GUI saves changes — no restart required.

**Scope of config changes:**
- `auto_handoff_enabled` — When `false`, the MCP server skips the auto-handoff eligibility check in `buildHandoffResponse()`. This replaces toggling by setting `MAX_HANDOFF_DEPTH` to 0. **Takes effect at runtime** via file watcher.
- `max_handoff_depth` — The maximum handoff chain depth (currently hard-coded as `10` in `workflow-helpers.ts`). The GUI allows adjusting this value. **Takes effect at runtime** via file watcher.
- `ledger_root` — Display-only in the GUI (read from the resolved ledger root at startup). Changing this requires restarting both processes, so the GUI shows it as informational with a note about the `--ledger-dir` CLI flag.

### Runtime Config Monitoring

The MCP server monitors `gui-config.json` for changes using Node.js `fs.watch()`:

```
MCP Server startup
  ↓
readConfig() → populate in-memory config cache
  ↓
fs.watch(gui-config.json) → on change → re-read file → update cache
  ↓
buildHandoffResponse() reads from cache (never from disk)
```

**Design details:**
- The config module (`gui/config.ts`) maintains a **module-level singleton cache** of the parsed config.
- `startConfigWatcher(configPath)` — called once during MCP server startup. Uses `fs.watch()` with a 250ms debounce to avoid duplicate events (common on Windows). On change, re-reads and validates `gui-config.json`; on validation failure or ENOENT, the cache retains the last known good values and logs a warning to stderr.
- `getConfig()` — synchronous getter that returns the cached config object. Used by `buildHandoffResponse()` and `getMaxHandoffDepth()`. Never touches disk.
- `stopConfigWatcher()` — closes the `fs.FSWatcher`. Exported for test teardown.
- If `gui-config.json` does not exist at startup, the watcher is still started on the expected path. When the GUI eventually creates the file, the watcher fires and the cache is populated.

### Frontend Design

A single-page application with four views, navigated via client-side routing (hash-based):

1. **Project List** (`#/`) — Table of all projects with status badges, dates, and action buttons. Filters by status. Delete button shown only for COMPLETE projects.
2. **Project Detail** (`#/projects/:slug`) — Project overview (from root index) + work package summary table. Click a WP row to expand its detail.
3. **Work Package Detail** (`#/projects/:slug/wp/:wpId`) — Full WP info: status, assigned agent, pipelines, acceptance criteria, handoff notes, observations.
4. **Configuration** (`#/config`) — Form to toggle auto-handoff, adjust max depth. Shows ledger root (read-only).

The UI uses a clean, minimal design with:
- CSS custom properties for theming (light mode)
- Status badges with color coding (READY=blue, IN_PROGRESS=amber, COMPLETE=green, BLOCKED=red)
- Responsive layout (works on desktop browsers)
- No external dependencies — all vanilla JS

## Rationale

1. **Separate process** — The STDIO constraint (constraint #4) makes embedding HTTP in the MCP server dangerous. A separate process cleanly avoids any risk of breaking MCP protocol communication.

2. **Reuse existing storage layer** — By importing `LedgerStore`, schemas, atomic writer, and file locking directly, we avoid duplicating complex logic and ensure consistency. Both processes see the same validated data.

3. **Vanilla HTML/CSS/JS** — Zero build step keeps the project simple. The dashboard is a developer tool, not a consumer product — framework overhead is unjustified.

4. **Config file in ledger root** — Placing `gui-config.json` alongside the ledger data keeps all runtime state co-located. It's gitignored (like the rest of `storage/ledger/`).

5. **Permanent delete** — User's explicit choice. The project folder (`storage/ledger/{slug}/`) is removed recursively. Only COMPLETE projects can be deleted, preventing accidental deletion of in-progress work.

6. **No authentication** — This is a local developer tool running on localhost. Adding auth would be unnecessary complexity.

## Detailed Steps

### Phase 1: Configuration System

1. **Create `mcp-server/gui/config.ts`** — Define `GuiConfigSchema` (Zod), and the following exports:
   - `readConfigFromDisk(configPath)` — reads and validates `gui-config.json` from disk, returns parsed config or defaults if file is missing/invalid.
   - `writeConfig(configPath, data)` — validates with Zod, writes via `atomicWriteJson()`.
   - `getConfig()` — synchronous getter returning the in-memory cached config (never reads disk).
   - `startConfigWatcher(configPath)` — starts `fs.watch()` on the config file with 250ms debounce. On change: re-reads, validates, updates cache. On error: logs to stderr, retains last known good cache. Returns void.
   - `stopConfigWatcher()` — closes the `FSWatcher`. Exported for test teardown.
   - Default values: `{ auto_handoff_enabled: true, max_handoff_depth: 10, ledger_root: <resolved> }`.
   - Config file path: `{ledgerRoot}/gui-config.json`.

2. **Update `mcp-server/src/utils/workflow-helpers.ts`** — Change `MAX_HANDOFF_DEPTH` from a hard-coded constant to a function `getMaxHandoffDepth()` that calls `getConfig().max_handoff_depth` (reads from in-memory cache, never disk). Falls back to `10` if the config module hasn't been initialized yet.

3. **Update `mcp-server/src/tools/workflow-handoff.ts`** — Add an `auto_handoff_enabled` check in `buildHandoffResponse()` by calling `getConfig().auto_handoff_enabled`. If `false`, skip the handoff eligibility block entirely. Replace the `MAX_HANDOFF_DEPTH` constant reference with the new `getMaxHandoffDepth()` call.

4. **Update `mcp-server/src/index.ts`** — At startup (after resolving ledger root), call `readConfigFromDisk()` to populate the initial cache, then call `startConfigWatcher()` to begin monitoring. Log the initial config state and watcher status to stderr.

### Phase 2: API Layer

5. **Create `mcp-server/gui/api.ts`** — Implement route handlers:
   - `handleListProjects()` — Calls `LedgerStore.listAllProjects()`, returns JSON array
   - `handleGetProject(slug)` — Constructs a LedgerStore from the slug, reads root index + meta, returns combined JSON
   - `handleListWorkPackages(slug)` — Reads root index, returns `work_packages` array
   - `handleGetWorkPackage(slug, wpId)` — Reads WP detail file, returns full JSON
   - `handleDeleteProject(slug)` — Validates project is COMPLETE, then recursively deletes `{ledgerRoot}/{slug}/` using `fs.rm()` with `{ recursive: true, force: true }`
   - `handleGetConfig()` — Reads config, returns JSON
   - `handleUpdateConfig(body)` — Validates with Zod, writes config, returns updated JSON

### Phase 3: HTTP Server

6. **Create `mcp-server/gui/server.ts`** — A standalone Node.js HTTP server (`node:http`) that:
   - Parses incoming URLs and routes to API handlers or static file serving
   - Serves static files from `gui/public/` (with correct MIME types)
   - Handles CORS headers (permissive, localhost only)
   - Listens on port 3420 (configurable via `--port` CLI arg)
   - Logs to `stdout` (this is NOT the MCP server — STDIO discipline does not apply here)
   - Accepts `--ledger-dir` CLI arg (same semantics as the MCP server)
   - Resolves `ledgerRoot` at startup and passes it to all handlers

### Phase 4: Frontend

7. **Create `mcp-server/gui/public/index.html`** — Single HTML file with:
   - Navigation header (Projects | Configuration)
   - Main content area for view rendering
   - Script/style includes

8. **Create `mcp-server/gui/public/styles.css`** — CSS with:
   - CSS custom properties for colors
   - Status badge styles (READY=blue, IN_PROGRESS=amber, COMPLETE=green, BLOCKED=red)
   - Table styles, card layouts, form styles
   - Responsive container

9. **Create `mcp-server/gui/public/app.js`** — Client-side JS with:
   - Hash-based router (`#/`, `#/projects/:slug`, `#/projects/:slug/wp/:wpId`, `#/config`)
   - API client module (fetch wrapper for all `/api/` endpoints)
   - View renderers: `renderProjectList()`, `renderProjectDetail()`, `renderWorkPackageDetail()`, `renderConfig()`
   - Delete confirmation dialog (native `confirm()`)
   - Config form with save button
   - Auto-refresh on project list (polling every 10 seconds)

### Phase 5: Integration & Scripts

10. **Add npm scripts to `mcp-server/package.json`**:
   - `"gui"`: `"tsx gui/server.ts"` — Run the GUI server in development
   - `"gui:build"`: Not needed (no build step for vanilla JS)

11. **Update `mcp-server/.gitignore`** — Ensure `gui-config.json` inside `storage/ledger/` is already covered by the existing gitignore pattern for ledger runtime data.

### Phase 6: Delete Safety

12. **Implement delete guard in `handleDeleteProject()`** — Before deleting:
    - Read `.meta.json` and verify `status === 'COMPLETE'`
    - If not COMPLETE, return `403 Forbidden` with an explanatory message
    - Use `fs.rm(projectDir, { recursive: true, force: true })` for deletion
    - No lock needed — we're removing the entire directory (and lock file with it)

### Phase 7: Documentation

13. **Update `mcp-server/docs/agents/project-manifest/file-tree.md`** — Add the `gui/` directory tree with annotations.

14. **Update `mcp-server/docs/agents/project-manifest/tech-stack.md`** — Document the GUI server as a new architectural component and the file-watcher config pattern under a new section.

15. **Update `mcp-server/README.md`** — Add a "GUI Dashboard" section with usage instructions.

16. **Update `mcp-server/docs/agents/project-manifest/constraints.md`** — Add a new constraint documenting the runtime config monitoring pattern (watcher lifecycle, debounce, fallback behavior).

## Dependencies

- **No new production dependencies** — The GUI server uses only Node.js built-in modules (`node:http`, `node:fs`, `node:path`, `node:url`) plus the existing project dependencies (`zod` for config validation).
- **No new dev dependencies** — `tsx` already handles running TypeScript files.
- Existing: `LedgerStore`, `atomicWriteJson`, `withLock`, all Zod schemas from `src/schema/`.

## Required Components

### New Files

| File | Type | Purpose |
|------|------|---------|
| `mcp-server/gui/server.ts` | **NEW** | HTTP server entry point |
| `mcp-server/gui/api.ts` | **NEW** | REST API route handlers |
| `mcp-server/gui/config.ts` | **NEW** | Config schema, read/write functions |
| `mcp-server/gui/public/index.html` | **NEW** | Dashboard HTML |
| `mcp-server/gui/public/styles.css` | **NEW** | Dashboard CSS |
| `mcp-server/gui/public/app.js` | **NEW** | Client-side JavaScript |

### Modified Files

| File | Change |
|------|--------|
| `mcp-server/src/utils/workflow-helpers.ts` | Replace `MAX_HANDOFF_DEPTH` constant with `getMaxHandoffDepth()` function that reads from in-memory config cache |
| `mcp-server/src/tools/workflow-handoff.ts` | Add `auto_handoff_enabled` check; use `getMaxHandoffDepth()` |
| `mcp-server/src/index.ts` | Add config initialization + `startConfigWatcher()` call at startup |
| `mcp-server/package.json` | Add `"gui"` npm script |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Add `gui/` tree |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | Document GUI server pattern + file-watcher config pattern |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Add runtime config monitoring constraint |
| `mcp-server/README.md` | Add GUI usage section |

## Assumptions

- The GUI will only be accessed from `localhost` — no authentication or TLS is needed.
- Port 3420 is available and a reasonable default. A `--port` CLI arg provides an escape hatch.
- The user interacts with the dashboard in a standard web browser.
- Both the MCP server and GUI server point to the same `storage/ledger/` directory (ensured by accepting the same `--ledger-dir` CLI arg).
- The MCP server monitors `gui-config.json` via `fs.watch()` and updates an in-memory cache on change. The handoff check reads from this cache (never disk) for zero-latency config access.
- `fs.watch()` is reliable for single-file monitoring on Windows (NTFS) and macOS/Linux. The 250ms debounce handles the duplicate-event edge case on Windows.

## Constraints

- **No `stdout` in MCP server process** — The GUI is a separate process; this constraint applies ONLY to `src/index.ts` and MCP tool handlers.
- **Atomic writes for config** — `gui-config.json` must be written with `atomicWriteJson()` to prevent partial reads.
- **COMPLETE-only deletion** — The delete endpoint must reject deletion of non-COMPLETE projects.
- **No build step for frontend** — Vanilla JS/CSS/HTML only. No bundler, no transpiler.
- **ESM imports with `.js` extensions** — All TypeScript imports must use `.js` extensions per existing convention.
- **Ledger root read-only in GUI** — The ledger root path is informational in the config UI. Changing it requires restarting with `--ledger-dir`.

## Out of Scope

- Authentication / authorization (localhost-only tool)
- WebSocket real-time updates (polling is sufficient for a dev tool)
- Creating or modifying projects/work packages via the GUI (this is an MCP tool concern)
- Dark mode (can be added later)
- Mobile responsiveness (desktop-only use case)
- Build/bundle step for frontend assets
- Editing individual work package fields
- Project archiving (user chose permanent delete over archive)

## Acceptance Criteria

- Running `npm run gui` from `mcp-server/` starts an HTTP server on port 3420
- Navigating to `http://localhost:3420` shows the project list dashboard
- Project list displays all projects from `storage/ledger/` with correct status, title, and dates
- Clicking a project navigates to its detail view showing root index data and WP summary table
- Clicking a WP in the detail view shows the full work package detail (pipelines, acceptance criteria, etc.)
- A "Delete" button appears on COMPLETE projects only; clicking it shows a confirmation, then permanently removes the project folder
- Attempting to delete a non-COMPLETE project returns a 403 error
- The Configuration page shows the current auto-handoff enabled state, max handoff depth, and ledger root path
- Toggling auto-handoff to `false` and saving causes the MCP server to skip auto-handoff on subsequent handoff checks **without restarting the MCP server** (runtime config monitoring)
- Changing max handoff depth and saving updates the `gui-config.json` file and affects subsequent handoff depth checks **without restarting the MCP server**
- The MCP server logs config changes to stderr when the file watcher detects a modification
- The ledger root path is displayed as read-only
- The GUI works correctly when both the MCP server and GUI server are running simultaneously
- All API endpoints validate input with Zod and return appropriate HTTP status codes
- No new production dependencies are added to `package.json`
- Manifest documentation is updated (file-tree, tech-stack, README)

## Testing Strategy

### Manual Testing
- Start both MCP server and GUI server, verify they coexist without interference
- Create a project via MCP tools, verify it appears in the GUI
- Complete a project via MCP tools, delete it via the GUI, verify it's gone from both GUI and disk
- Toggle auto-handoff via GUI, trigger a handoff via MCP tools, verify behavior changes

### Automated Testing
- **API handler unit tests** (`tests/gui/api.test.ts`) — Test each handler with `createTempStore()` fixtures: list projects, get project, get WP, delete project (happy path + COMPLETE guard), config read/write
- **Config module tests** (`tests/gui/config.test.ts`) — Test default creation, read, write, validation of invalid config, watcher lifecycle (`startConfigWatcher` / `stopConfigWatcher`), and cache update on file change
- **Integration test** — Verify the handoff behavior changes when `auto_handoff_enabled` is toggled in config (write to `gui-config.json`, wait for watcher debounce, then invoke handoff and assert changed behavior)

### Coverage Focus
- Delete guard (only COMPLETE projects)
- Config validation (Zod rejects invalid values)
- API error handling (missing slug, missing WP, invalid config)
- Concurrent access (GUI reading while MCP server is writing)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Race condition: GUI deletes while MCP writes** | Delete removes the entire directory. `atomicWriteJson` will fail with ENOENT if the directory was just deleted — MCP tools already handle this error gracefully. The likelihood is low since delete is manual and only for COMPLETE projects. |
| **Config file read/write races** | Use `atomicWriteJson()` for writes. The MCP server reads the file only when the watcher fires (not on every request), so the window is narrow. On parse failure the cache retains last known good values. |
| **`fs.watch()` reliability** | `fs.watch()` can emit duplicate events or miss events in edge cases. The 250ms debounce handles duplicates. If a change is missed, the next GUI save will trigger the watcher again. As a fallback, restarting the MCP server re-reads the config from disk. |
| **Port conflict on 3420** | Allow `--port <n>` CLI override. Log a clear error message if the port is in use. |
| **Stale UI state** | Auto-refresh via polling (10-second interval on project list). Manual refresh button on detail views. |
| **Breaking `MAX_HANDOFF_DEPTH` refactor** | The change from a constant to a function is small and localized. Existing tests for handoff behavior will catch regressions. Add a dedicated test for the config-driven depth. |
| **Watcher not cleaned up on MCP server crash** | `fs.watch()` is cleaned up by the OS when the process exits. No manual cleanup needed for abnormal termination. `stopConfigWatcher()` is provided for graceful shutdown and test teardown. |
| **Frontend bugs without type checking** | Keep `app.js` simple and well-structured. Use JSDoc comments for documentation. The scope is small enough that vanilla JS is manageable. |
| **Config file missing on fresh install** | `readConfig()` creates the file with defaults if it doesn't exist. This mirrors the self-healing pattern used elsewhere in the codebase. |
