# Plan

## Summary

Add a stale-instance detection system to the GUI dashboard that compares a
version fingerprint captured at server boot with the current on-disk versions
of the MCP server, personas build system, and orchestrator. When any component
version changes after the GUI server has started, a prominent warning banner
is displayed at the top of every page telling the user to relaunch the GUI.

## Architectural Context

The GUI is a standalone Node.js HTTP server (`gui/server.ts`) launched with
`npm run gui` (`tsx gui/server.ts`). It imports shared modules from `src/`
(storage, config, utilities) and serves a vanilla-JS SPA from `gui/public/`.

Relevant files and patterns:

- **`gui/server.ts`** — HTTP server, route dispatch, startup logic (`main()`).
  Special-case routes (`GET/PUT /api/config`) are handled inline before the
  generic `matchRoute()` dispatcher.
- **`gui/api.ts`** — Pure async API handlers; the server maps results to HTTP.
- **`gui/public/api-client.js`** — `API` IIFE exposing REST methods consumed
  by all views.
- **`gui/public/app.js`** — SPA bootstrap: `Theme.init(); Router.init();`.
- **`gui/public/index.html`** — SPA shell with `<header>`, `<main id="app">`.
- **`gui/public/styles.css`** — Existing banner classes: `.error-banner`,
  `.success-banner`, `.info-banner` (with dark-mode overrides).
- **`src/utils/server-version.ts`** — `SERVER_VERSION` (captured at startup)
  and `readPackageVersion()` (re-reads `package.json` on each call). Already
  demonstrates the exact pattern we need.

Version sources:

| Component    | File                         | Field / Pattern         |
|--------------|------------------------------|-------------------------|
| MCP server   | `mcp-server/package.json`    | `version` (JSON)        |
| Personas     | `personas/package.json`      | `version` (JSON)        |
| Orchestrator | `orchestrator/pyproject.toml`| `version = "X.Y.Z"`    |

Path resolution: `src/utils/ledger-root.ts` already resolves `workspaceRoot`
as `join(__dirname, '..', '..')` from `src/utils/`, which equals the
`ai-insights/` root. The GUI server can use the same pattern (from `gui/` up
one level = `mcp-server/`, up two levels = workspace root).

## Approach / Architecture

### Server side

1. **New utility: `src/utils/workspace-versions.ts`**
   - `captureWorkspaceVersions(): WorkspaceVersions` — reads all three version
     sources from disk and returns a `{ mcpServer, personas, orchestrator }`
     record.
   - `WorkspaceVersions` type: `{ mcpServer: string; personas: string;
     orchestrator: string }`.
   - MCP server + personas versions: parse `package.json` → `.version`.
   - Orchestrator version: read `pyproject.toml`, extract with regex
     `/^version\s*=\s*"([^"]+)"/m`.
   - Path resolution uses `join(__dirname, ...)` relative to `src/utils/`,
     matching the existing `server-version.ts` pattern.

2. **New API endpoint: `GET /api/server-info`** (in `gui/server.ts`)
   - At startup (`main()`), call `captureWorkspaceVersions()` → store as
     `bootVersions`.
   - On each request, call `captureWorkspaceVersions()` → `diskVersions`.
   - Compare each field; if any differ → `stale: true`.
   - Response shape:
     ```json
     {
       "stale": false,
       "bootVersions": {
         "mcpServer": "1.24.0",
         "personas": "3.15.1",
         "orchestrator": "0.16.0"
       },
       "diskVersions": {
         "mcpServer": "1.24.0",
         "personas": "3.15.1",
         "orchestrator": "0.16.0"
       }
     }
     ```
   - Route is handled as a special case in `handleRequest()` (like
     `GET /api/config`), because it needs the `bootVersions` closure from
     `main()`.

### Client side

3. **API method: `API.getServerInfo()`** (in `api-client.js`)
   - `GET /server-info` → returns the server-info payload.

4. **Stale banner module: `gui/public/stale-check.js`**
   - `StaleCheck` IIFE, following the existing module pattern (`Theme`,
     `Router`, `API`).
   - `StaleCheck.init()`:
     - Calls `API.getServerInfo()` immediately on load.
     - Sets up a polling interval (every 30 seconds).
     - When `stale === true`: inserts a warning banner element before
       `<header>` (very top of the page, above the sticky nav).
     - Banner reads: "**Server version mismatch detected.** The GUI was
       started with different component versions than what is currently on
       disk. Please relaunch the GUI to pick up the latest changes."
     - Lists changed components below (e.g. "MCP Server: 1.24.0 → 1.25.0").
     - Once shown, stops polling (the banner is permanent until page reload /
       server restart).
   - Does NOT inject into `#app` — injects into `document.body` before the
     first child, so it is globally visible and survives route changes.

5. **HTML integration** (`index.html`)
   - Add `<script src="/stale-check.js"></script>` before `app.js`.
   - Call `StaleCheck.init()` from `app.js` after `Router.init()`.

6. **CSS: `.stale-banner`** (`styles.css`)
   - New warning-style banner class (amber/orange tones) with dark-mode
     override. Full-width, no border-radius (edge-to-edge at page top).
   - Sticky positioning so it stays visible while scrolling.
   - Should stand out visually from the existing `.info-banner` (blue) to
     convey urgency.

## Rationale

- **Version-based detection** is the simplest and most reliable signal. All
  three sub-projects follow strict version-sync conventions (changelogs →
  package manifests), so a version bump is a reliable indicator of meaningful
  change.
- **Composite fingerprint** across all three components catches changes in any
  part of the stack, not just the MCP server itself.
- **Polling interval of 30 s** is a reasonable balance: fast enough to notice
  quickly, cheap enough to be invisible (a single `readFileSync` per
  component).
- **Separate utility module** (`workspace-versions.ts`) keeps the version
  reading logic reusable across the MCP server entry point and the GUI server.
- **Warning banner above `<header>`** ensures maximum visibility without
  interfering with the SPA routing or view rendering.

## Detailed Steps

1. Create `src/utils/workspace-versions.ts`:
   - Define `WorkspaceVersions` type.
   - Implement `captureWorkspaceVersions()` using `readFileSync` for all three
     version sources.
   - Use `join(__dirname, ...)` path resolution.

2. Add `GET /api/server-info` route in `gui/server.ts`:
   - In `main()`, call `captureWorkspaceVersions()` to capture boot versions.
   - Pass `bootVersions` into `handleRequest()` (add parameter).
   - Add special-case route handling (like `GET /api/config`) that re-reads
     versions from disk, compares, and returns the response.

3. Add `API.getServerInfo()` method in `gui/public/api-client.js`.

4. Create `gui/public/stale-check.js`:
   - Implement `StaleCheck` IIFE with `init()` method.
   - Polling logic with 30-second interval.
   - Banner DOM insertion logic.
   - Stop polling once stale is detected.

5. Add `.stale-banner` CSS class in `gui/public/styles.css`:
   - Light-mode: amber background, dark amber text.
   - Dark-mode override: dark amber background, lighter amber text.
   - Full-width, sticky positioning at very top of page.

6. Wire up in `gui/public/index.html` and `gui/public/app.js`:
   - Add `<script>` tag for `stale-check.js`.
   - Call `StaleCheck.init()` from `app.js`.

7. Update `mcp-server/docs/agents/project-manifest/file-tree.md`:
   - Add `workspace-versions.ts` entry under `src/utils/`.
   - Add `stale-check.js` entry under `gui/public/`.

8. Update `mcp-server/docs/agents/project-manifest/api-surface.md`:
   - Add `GET /api/server-info` endpoint documentation.
   - Add `captureWorkspaceVersions()` and `WorkspaceVersions` type.

## Dependencies

- `src/utils/server-version.ts` — existing pattern to follow (not a code
  dependency; we create a parallel module).
- `gui/server.ts` `handleRequest()` — must add a new parameter for boot
  versions.
- `gui/public/api-client.js` — must add `getServerInfo` method.

## Required Components

- **New file:** `src/utils/workspace-versions.ts`
- **New file:** `gui/public/stale-check.js`
- **Modified:** `gui/server.ts` (startup + route handling)
- **Modified:** `gui/public/api-client.js` (new API method)
- **Modified:** `gui/public/app.js` (bootstrap call)
- **Modified:** `gui/public/index.html` (script tag)
- **Modified:** `gui/public/styles.css` (stale banner styles)
- **Modified:** `mcp-server/docs/agents/project-manifest/file-tree.md`
- **Modified:** `mcp-server/docs/agents/project-manifest/api-surface.md`

## Assumptions

- Version bumps in `package.json` and `pyproject.toml` are the canonical
  signal for meaningful changes. Source-file mtime tracking is not needed.
- The three version files are always present on disk at the expected relative
  paths from the `mcp-server/` directory.
- `readFileSync` is acceptable for the server-info endpoint (same pattern as
  `server-version.ts`).

## Constraints

- The orchestrator version lives in `pyproject.toml` (TOML format), not JSON.
  Use a regex extraction rather than adding a TOML parser dependency.
- The banner must work with both light and dark themes.
- The banner must be positioned above the sticky `<header>` so it is the
  absolute first visible element.
- Cross-platform: use `path.join()` for all path construction (per workspace
  cross-platform policy).

## Out of Scope

- Auto-restarting the GUI server (the user must manually relaunch).
- Watching for file changes via `fs.watch` / `chokidar` (polling is simpler
  and sufficient).
- Tracking source file mtimes or dist output freshness.
- Hot module replacement or live-reload.

## Acceptance Criteria

- When the GUI is running and any of the three component versions change on
  disk, a warning banner appears at the top of the page within 30 seconds.
- The banner lists which component(s) changed and their old → new versions.
- The banner persists across route navigation (not cleared by SPA view
  changes).
- The banner renders correctly in both light and dark themes.
- The banner does not appear when versions are unchanged.
- The `GET /api/server-info` endpoint returns the correct response shape.
- No new npm dependencies are introduced.

## Testing Strategy

- **Unit test** for `captureWorkspaceVersions()`: mock `readFileSync` with
  known version strings, verify correct extraction from JSON and TOML formats.
- **Unit test** for the stale comparison logic: boot versions vs. disk versions
  with matching/mismatching combinations.
- **Manual verification**: start the GUI, bump a version in one package
  manifest, wait 30 s, confirm banner appears.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`pyproject.toml` format changes** | Regex `/^version\s*=\s*"([^"]+)"/m` is robust for standard PEP 621 format; add a fallback returning `"unknown"` if regex fails. |
| **Version file missing or unreadable** | Wrap each read in try/catch; return `"unknown"` for unreadable components. Only flag stale when a version changes from a known value to a different known value (ignore `"unknown"`). |
| **Polling adds unnecessary requests** | 30 s interval is negligible; stops entirely once stale is detected. |
| **Banner pushes content down unexpectedly** | Use a fixed/sticky position that overlays or pushes the header, not the content area. Test with both short and long pages. |
