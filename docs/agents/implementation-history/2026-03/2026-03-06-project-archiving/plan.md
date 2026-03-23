# Plan: Project Archiving Feature

## Summary

Add an archiving feature to the ledger so that completed projects can be archived — either manually via the GUI or automatically after 6 days of inactivity. Archived projects gain a new `ARCHIVED` status, remain visible in the main project list with a distinguishing badge, and are filterable via the existing status filter dropdown. Archiving is reversible (unarchive restores the project to `COMPLETE`). A configurable auto-archive threshold runs on GUI server startup and periodically thereafter.

Alongside archiving, this plan introduces **scalability improvements** to prepare for 1000+ projects: an enriched `.meta.json` cache that eliminates per-project enrichment I/O in the listing endpoint, and server-side + frontend pagination to keep both API response size and DOM node count bounded.

## Architectural Context

### Current Storage Layout

Projects live in `mcp-server/storage/ledger/{slug}/` with three key files:
- `.meta.json` — `ProjectMeta` (slug, plan_path, status, date_created, last_updated, title?)
- `project-ledger.json` — `RootIndex` (status, WP array, counters, comments, etc.)
- `WP-###.json` — per-work-package detail files

### Current Status System

- **ProjectStatus enum** (`src/schema/enums.ts`): `READY | IN_PROGRESS | COMPLETE | BLOCKED`
- **ProjectMeta schema** (`src/schema/project-meta.ts`): `.status` uses a hardcoded `z.enum(...)` (not the shared `ProjectStatus` enum)
- **RootIndex schema** (`src/schema/root-index.ts`): `.status` uses the shared `ProjectStatus` zod enum

### Listing & Filtering

- `LedgerStore.listAllProjects()` scans `storage/ledger/`, skips entries starting with `.`, reads `.meta.json` for each slug directory.
- `ledger_list_projects` MCP tool accepts an optional `status` filter (`WorkPackageStatus` — note: this should arguably be `ProjectStatus`, but both include the needed values).
- GUI `handleListProjects()` (in `gui/api.ts`) enriches each `ProjectMeta` with WP counters, project name, and repository name.
- Frontend `app.js` renders the project list with a status filter dropdown (`ALL`, `READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`) and a search bar.

### Delete Flow

- `handleDeleteProject()` only allows deletion of `COMPLETE` projects. Deletion permanently removes the slug directory.

### Config System

- `gui-config.json` at `storage/ledger/gui-config.json`, managed by `src/gui/config.ts`
- Schema: `{ auto_handoff_enabled, max_handoff_depth, ledger_root }`
- Exposed via `GET /PUT /api/config` — persisted atomically via `atomicWriteJson`

### Scalability Bottlenecks (Current State)

The current architecture has several O(N) hot paths that become expensive at 1000+ projects:

1. **`listAllProjects()`** — Sequential `readFile` of `.meta.json` for every slug directory. Called by `GET /api/projects`, `GET /api/insights`, `detectProjectByCwd`, `ledger_list_projects`, and the future auto-archive scan. The 10-second frontend poll means N file reads every 10 seconds.

2. **`handleListProjects()` enrichment loop** — For *each* project, performs 2-4 additional file reads:
   - `project-ledger.json` (WP counters: `total_work_packages`, `pending_work_packages`)
   - `package.json` → `composer.json` → `pyproject.toml` (project name resolution from the managed workspace)
   - Path inference for `repository_name`
   
   At 1000 projects this is **3000-4000 extra file reads per API call**, repeated every 10 seconds by the poll.

3. **Frontend rendering** — All N projects are rendered as DOM `<tr>` nodes, sorted and filtered client-side, and fully re-rendered on every poll tick.

4. **`handleGetInsights()`** — Reads every project's full `project-ledger.json` to extract comments.

### MCP Tool Impact

- Agents interact with projects via MCP tools (`ledger_get_project_status`, `ledger_detect_project`, `ledger_list_projects`, etc.)
- Archived projects should be invisible to agents (excluded from `ledger_list_projects` default results and `ledger_detect_project` matching) — agents should not attempt to work on archived projects.

## Approach / Architecture

### 1. New `ARCHIVED` Status

Add `ARCHIVED` to the `ProjectStatus` Zod enum. This is the simplest approach — no directory relocation, no separate data store. An archived project is simply a project whose status is `ARCHIVED`. This change propagates through the type system:

- `src/schema/enums.ts` — add `'ARCHIVED'` to `ProjectStatus`
- `src/schema/project-meta.ts` — update the hardcoded status enum to include `'ARCHIVED'`
- `src/schema/root-index.ts` — already uses the shared `ProjectStatus`, inherits automatically

### 2. Archive / Unarchive Operations (Backend)

**New API handlers** in `gui/api.ts`:

- `handleArchiveProject(ledgerRoot, slug)` — Sets both `.meta.json` and `project-ledger.json` status to `ARCHIVED`. Only `COMPLETE` projects may be archived. Writes are performed under the project lock.
- `handleUnarchiveProject(ledgerRoot, slug)` — Restores both statuses to `COMPLETE`. Only `ARCHIVED` projects may be unarchived.

**New REST endpoints** in `gui/server.ts`:

- `POST /api/projects/:slug/archive` → `handleArchiveProject`
- `POST /api/projects/:slug/unarchive` → `handleUnarchiveProject`

### 3. Auto-Archive Service

A lightweight function in a new module `src/gui/auto-archive.ts`:

- `runAutoArchive(ledgerRoot: string, maxAgeDays: number): Promise<string[]>` — Scans all projects, archives those where status is `COMPLETE` AND `last_updated` is older than `maxAgeDays` days. Returns array of archived slug names. Logs activity to stderr.
- Called on GUI server startup and then every 10 minutes via `setInterval`.
- The `maxAgeDays` threshold is stored in `gui-config.json` as `auto_archive_days` (default: `6`, `0` disables auto-archiving).

### 4. Config Extension

Add to `GuiConfigSchema`:

- `auto_archive_days: z.number().int().min(0).default(6)` — `0` means disabled. Exposed in `GET /PUT /api/config`.

### 5. GUI Frontend Changes

**Status filter dropdown** — Add `ARCHIVED` option. Default filter changes from `ALL` to a new `ACTIVE` pseudo-filter that shows everything except `ARCHIVED`. This keeps the dashboard clean by default while allowing users to view archived projects on demand.

**Project list table** — Archived projects render with a muted/dimmed visual style and an `ARCHIVED` badge. The "Delete" button is available for archived projects (they were `COMPLETE` before archiving). An "Archive" button appears for `COMPLETE` projects. An "Unarchive" button appears for `ARCHIVED` projects.

**Project detail view** — Show an "Archived" banner at the top. All data remains read-only accessible (plan, synthesis, WPs, comments, insights).

**Config view** — Add an "Auto-archive after N days" numeric input (0 = disabled).

### 6. MCP Tool Isolation

- `ledger_list_projects` — Exclude `ARCHIVED` projects from default results. Add an optional `include_archived` boolean parameter.
- `LedgerStore.detectProjectByCwd()` — Skip archived projects when resolving by cwd (an archived project should not match).
- Other MCP tools (`ledger_get_project_status`, etc.) — Continue to work on archived projects when explicitly addressed by `project_path` (for diagnostic purposes), but `cwd_path` resolution skips them.

### 7. Delete Guard Update

`handleDeleteProject` currently requires `COMPLETE` status. Update to allow `ARCHIVED` status as well (since archived projects were complete).

### 8. `.meta.json` Enrichment Cache (Scalability)

The biggest scalability win is eliminating the per-project enrichment I/O in `handleListProjects`. Currently, for every project, the handler reads `project-ledger.json` (WP counters) and probes up to 3 manifest files (`package.json`, `composer.json`, `pyproject.toml`) to resolve the project name. At 1000 projects this is 3000-4000 extra file reads per listing request.

**Solution:** Extend `ProjectMeta` (`.meta.json`) with cached enrichment fields:

```typescript
// Added to ProjectMetaSchema:
total_work_packages: z.number().int().nonnegative().optional(),
pending_work_packages: z.number().int().nonnegative().optional(),
project_name: z.string().nullable().optional(),
repository_name: z.string().nullable().optional(),
```

These fields are **written** whenever the root index is updated (inside the existing lock scope — the `writeProjectMeta` call already happens there). They are **read** by `handleListProjects` as a fast-path: if the cached fields exist, skip the enrichment I/O entirely.

- `project_name` is resolved once at project initialization time (or on first meta-sync) via the existing `readProjectName()` logic, then cached. The `title` field still takes precedence when set (same logic, just reads from cache instead of re-probing the filesystem).
- `repository_name` is derived from `plan_path` at init time and cached.
- `total_work_packages` / `pending_work_packages` are synced from the root index whenever it's written (this already happens in the `writeProjectMeta` call path — we just add the two counter fields).

This turns `handleListProjects` from O(4N) file reads to O(N) (just the `.meta.json` scan), since the scan already reads each `.meta.json`.

**Backward compatibility:** All new fields use `.optional()`, so existing `.meta.json` files without them still validate. The enrichment loop falls back to the current I/O-based resolution when cached fields are missing, ensuring a graceful upgrade path.

### 9. Server-Side Pagination (Scalability)

Add pagination support to `GET /api/projects`:

```
GET /api/projects?page=1&limit=50&status=ACTIVE&search=foo&sort=last_updated&dir=desc
```

**Response shape** (extends current array response with envelope):

```json
{
  "projects": [ ...ProjectSummary[] ],
  "total": 1042,
  "page": 1,
  "limit": 50,
  "total_pages": 21
}
```

- `page` (default: 1), `limit` (default: 50, max: 200) — standard offset pagination.
- `status` — filter param; `ACTIVE` (default) excludes archived; `ALL` includes everything; or a specific status.
- `search` — case-insensitive substring match on slug, project_name, repository_name.
- `sort` / `dir` — server-side sorting (supports the same columns as the frontend: `project`, `repository`, `status`, `total_work_packages`, `done`, `date_created`, `last_updated`).

The scan + filter + sort happens on the full `ProjectMeta[]` array (fast — it's just in-memory structs from `.meta.json`), but only the requested page slice is enriched with any remaining I/O. Combined with the `.meta.json` cache (Step 8), even the enrichment step becomes a no-op for cached projects.

**Backward compatibility:** When no `page`/`limit` params are provided, the API returns the paginated envelope with all results (effectively `limit=Infinity`). The frontend is updated to use pagination, but any existing consumers that expect a raw array can be adapted.

### 10. Frontend Pagination (Scalability)

Replace the current "render all rows" approach with client-driven pagination:

- Page size selector (25 / 50 / 100) with localStorage persistence.
- Previous / Next / page-number navigation controls below the table.
- Sort and filter operations hit the server (query params) instead of doing client-side DOM manipulation.
- The 10-second poll refreshes only the current page, not all projects.
- Status counts (how many READY, IN_PROGRESS, etc.) are included in the paginated response metadata so the filter dropdown can show counts without loading all data.

This caps the DOM at ~50-100 `<tr>` nodes regardless of total project count.

## Rationale

- **Status field approach vs. directory relocation:** Adding a status value is non-breaking, keeps all files in place, requires no data migration, and leverages the existing schema validation pipeline. The `listAllProjects` already reads `.meta.json` status — filtering archived projects is trivial.
- **Same-table UX:** Avoids duplicating table rendering logic. The existing filter bar already supports per-status filtering — adding one more value is minimal work.
- **Default to ACTIVE filter:** Prevents dashboard clutter as projects accumulate, while keeping archived projects one click away.
- **Configurable threshold:** Different users/teams have different retention needs. The `0`-to-disable pattern is consistent with `max_handoff_depth`.
- **Reversibility:** Unarchive allows recovery from accidental or premature archiving without data loss.
- **`.meta.json` cache vs. separate index file:** Storing enrichment fields directly in `.meta.json` avoids introducing a new file with its own synchronization concerns. The meta file is already written atomically under lock whenever the root index changes — adding a few fields is zero additional I/O. A separate index file would need its own consistency guarantees and could drift.
- **Server-side pagination:** Client-side filtering/sorting of 1000+ records wastes bandwidth and CPU on both sides. Server-side pagination keeps the API response small (~50 items) and makes the poll lightweight. The sort/filter/search logic is simple in-memory work on the already-loaded `ProjectMeta[]` array.
- **No virtual scrolling:** While virtual scrolling avoids pagination UX, it requires significant DOM complexity for a vanilla JS SPA. Standard pagination is simpler, well-understood, and sufficient.

## Detailed Steps

### Step 1: Extend Status Enums and Schemas

1. In `src/schema/enums.ts`, add `'ARCHIVED'` to the `ProjectStatus` Zod enum.
2. In `src/schema/project-meta.ts`, add `'ARCHIVED'` to the hardcoded status enum string array.
3. Verify `RootIndexSchema` inherits the change automatically (it uses the shared `ProjectStatus`).

### Step 2: Extend Config Schema

1. In `src/gui/config.ts`, add `auto_archive_days: z.number().int().min(0).default(6)` to `GuiConfigSchema`.
2. Add `auto_archive_days: 6` to `DEFAULT_CONFIG`.
3. In `gui/api.ts`, add `auto_archive_days` to `GuiConfigPartialSchema` so it can be updated via `PUT /api/config`.

### Step 3: Implement Archive/Unarchive API Handlers

1. In `gui/api.ts`, add `handleArchiveProject(ledgerRoot, slug)`:
   - Validate slug safety.
   - Read `.meta.json` — verify status is `COMPLETE`.
   - Acquire lock via `withLock(store.storageDir, ...)`.
   - Inside lock: read root index, set `status = 'ARCHIVED'`, write root index, write `.meta.json` with `status = 'ARCHIVED'` and `last_updated` = now.
   - Return `{ archived: true, slug }`.

2. In `gui/api.ts`, add `handleUnarchiveProject(ledgerRoot, slug)`:
   - Same safety checks. Verify status is `ARCHIVED`.
   - Inside lock: set status back to `COMPLETE` on both files. Update `last_updated`.
   - Return `{ unarchived: true, slug }`.

### Step 4: Register New Routes

1. In `gui/server.ts`, add route handling for:
   - `POST /api/projects/:slug/archive` → body parsing not needed (no payload) → `handleArchiveProject`
   - `POST /api/projects/:slug/unarchive` → `handleUnarchiveProject`
2. These are POST routes with no body, so they can use the existing `matchRoute` pattern (return a handler thunk).

### Step 5: Implement Auto-Archive Module

1. Create `src/gui/auto-archive.ts`:
   - Export `runAutoArchive(ledgerRoot: string, maxAgeDays: number): Promise<string[]>`
   - Scan all projects via `LedgerStore.listAllProjects(ledgerRoot)`
   - For each project with `status === 'COMPLETE'`: parse `last_updated`, check if older than `maxAgeDays` days.
   - For eligible projects: perform the same archive operation as `handleArchiveProject` (set status to `ARCHIVED` in both files, under lock).
   - Return list of archived slugs. Log to stderr.
2. Export `startAutoArchiveTimer(ledgerRoot: string, intervalMs?: number): void` — reads `auto_archive_days` from config cache, calls `runAutoArchive` if `> 0`, sets interval.
3. Export `stopAutoArchiveTimer(): void` — clears the interval.

### Step 6: Integrate Auto-Archive into GUI Server

1. In `gui/server.ts` `main()`, after config initialization:
   - Import and call `startAutoArchiveTimer(ledgerRoot)`.
   - Optionally run `runAutoArchive` once immediately at startup.
2. Default interval: 10 minutes (600_000 ms).

### Step 7: Update MCP Tool Filtering

1. In `src/tools/project-lifecycle.ts` — `listProjects()`:
   - Exclude `ARCHIVED` projects from default results.
   - Add optional `include_archived: boolean` parameter to the schema (default `false`).
   - When `include_archived` is true, include all statuses.

2. In `src/storage/ledger-store.ts` — `detectProjectByCwd()`:
   - After collecting matches, filter out projects with `status === 'ARCHIVED'`.
   - This prevents agents from accidentally detecting and working on archived projects.

### Step 8: Update Delete Guard

1. In `gui/api.ts` — `handleDeleteProject()`:
   - Change the status check from `meta.status !== 'COMPLETE'` to `!['COMPLETE', 'ARCHIVED'].includes(meta.status)`.

### Step 9: Frontend — Status Filter & Default

1. In `gui/public/app.js` — `renderProjectList()`:
   - Add `ARCHIVED` to the status filter dropdown options.
   - Change initial `filterValue` from `'ALL'` to `'ACTIVE'`.
   - Add `ACTIVE` as a pseudo-option in the dropdown (shows all statuses except `ARCHIVED`).
   - Update `applyFilter()` to treat `ACTIVE` as "everything but ARCHIVED".

### Step 10: Frontend — Archive/Unarchive Buttons

1. In `renderProjectList()` `buildTable()`:
   - For `COMPLETE` projects: add an "Archive" button alongside the existing "Delete" button.
   - For `ARCHIVED` projects: show "Unarchive" and "Delete" buttons.
   - Wire up click handlers to call new API methods.
2. In the API client module:
   - Add `archiveProject(slug)` → `POST /projects/:slug/archive`
   - Add `unarchiveProject(slug)` → `POST /projects/:slug/unarchive`

### Step 11: Frontend — Visual Styling

1. In `gui/public/styles.css`:
   - Add `.badge-archived` style (e.g., grey/muted color scheme).
   - Add a muted row style for archived project rows (e.g., `tr[data-status="ARCHIVED"] { opacity: 0.65; }`).

### Step 12: Frontend — Config View

1. In `renderConfig()`:
   - Add a numeric input for "Auto-archive after N days" bound to `auto_archive_days`.
   - Label: "Auto-archive after (days) — set to 0 to disable".

### Step 13: Frontend — Project Detail Archive Banner

1. In `renderProjectDetail()`:
   - If project status is `ARCHIVED`, show an info banner: "This project is archived. [Unarchive]".

### Step 14: Enrich `.meta.json` with Cached Fields

1. In `src/schema/project-meta.ts`, add optional fields to `ProjectMetaSchema`:
   - `total_work_packages: z.number().int().nonnegative().optional()`
   - `pending_work_packages: z.number().int().nonnegative().optional()`
   - `project_name: z.string().nullable().optional()`
   - `repository_name: z.string().nullable().optional()`

2. In `src/storage/ledger-store.ts` — `writeProjectMeta()` (or wherever meta is synced after root index writes):
   - Accept optional enrichment fields to include in the meta write.
   - When the root index is written, pass `total_work_packages` and `pending_work_packages` from the root index.

3. In `src/tools/project-lifecycle.ts` — `initializeProject()`:
   - After creating the root index, resolve `project_name` (via `readProjectName`) and `repository_name` (via path inference) and write them into `.meta.json`.
   - Set `total_work_packages: 0`, `pending_work_packages: 0`.

4. In `src/storage/ledger-store.ts` — `writeRootIndex()` and `updateWorkPackageWithSync()`:
   - After writing the root index, sync `total_work_packages` and `pending_work_packages` into the meta file. This piggybacks on the existing `writeProjectMeta` call.

5. In `gui/api.ts` — `handleListProjects()`:
   - Refactor the enrichment loop: if `meta.total_work_packages !== undefined` and `meta.project_name !== undefined`, skip I/O (use cached values).
   - Fall back to current I/O-based enrichment for legacy meta files missing the cached fields.
   - This is a **transparent optimization** — the response shape is unchanged.

### Step 15: Server-Side Pagination for `GET /api/projects`

1. In `gui/api.ts` — `handleListProjects()`:
   - Accept query params: `page` (default 1), `limit` (default 50, max 200), `status` (default `'ACTIVE'`), `search`, `sort`, `dir`.
   - Parse and validate params (Zod or manual).
   - After loading all `ProjectMeta[]` from `listAllProjects()`:
     a. Filter by status (`ACTIVE` = exclude `ARCHIVED`; specific status; `ALL`).
     b. Filter by search string (case-insensitive match on slug, project_name, repository_name — all available from cached meta).
     c. Sort by requested column.
     d. Compute `total` (count after filter), `total_pages`.
     e. Slice the page window.
     f. Enrich only the sliced page (not all N projects).
   - Return `{ projects, total, page, limit, total_pages, status_counts }` envelope.
   - `status_counts` is an object like `{ READY: 5, IN_PROGRESS: 3, COMPLETE: 12, BLOCKED: 1, ARCHIVED: 8 }` computed from the full filtered set, so the frontend filter dropdown can display counts.

2. In `gui/server.ts` — Update the `GET /api/projects` route to pass query params to the handler.

### Step 16: Frontend Pagination

1. In `gui/public/app.js` — `renderProjectList()`:
   - Replace `API.getProjects()` with `API.getProjects({ page, limit, status, search, sort, dir })`.
   - Render pagination controls below the table: Previous / page numbers / Next, page-size selector (25/50/100).
   - Store `page` and `limit` in `localStorage`.
   - When sort column header is clicked, update `sort`/`dir` and re-fetch from server (instead of client-side re-sort).
   - When status filter or search input changes, reset to page 1 and re-fetch.
   - The 10-second poll re-fetches only the current page.

2. In the API client module — Update `getProjects()` to accept and pass query params.

3. In `gui/public/styles.css` — Add pagination control styling (`.pagination` container, active page indicator, disabled state for prev/next at bounds).

### Step 17: Tests

1. **Schema tests** — Verify `ARCHIVED` is accepted by `ProjectStatus`, `ProjectMetaSchema`, `RootIndexSchema`.
2. **API handler tests** (`tests/gui/api.test.ts`):
   - `handleArchiveProject`: happy path (COMPLETE → ARCHIVED), reject non-COMPLETE, reject NOT_FOUND.
   - `handleUnarchiveProject`: happy path (ARCHIVED → COMPLETE), reject non-ARCHIVED.
   - `handleDeleteProject`: verify ARCHIVED projects can be deleted.
   - `handleListProjects`: verify archived projects are included in results.
3. **Auto-archive tests** (new `tests/gui/auto-archive.test.ts`):
   - Archives COMPLETE projects older than threshold.
   - Skips non-COMPLETE projects.
   - Skips COMPLETE projects newer than threshold.
   - No-op when `maxAgeDays` is `0`.
4. **MCP tool tests** (`tests/tools/project-lifecycle.test.ts`):
   - `ledger_list_projects` excludes ARCHIVED by default.
   - `ledger_list_projects` includes ARCHIVED when `include_archived: true`.
5. **Detection tests** (`tests/storage/ledger-store.test.ts` or `tests/tools/project-lifecycle.test.ts`):
   - `detectProjectByCwd` skips archived projects.

### Step 18: Update Help Content

1. In `src/tools/help-content.ts`:
   - Update `ledger_list_projects` help text to mention that ARCHIVED projects are excluded by default and the `include_archived` parameter.
   - Add brief note about the archiving feature.

## Dependencies

- No new npm dependencies required. All changes use existing infrastructure (Zod, `atomicWriteJson`, `withLock`, `LedgerStore`).
- `gui-config.json` gains a new field — backward-compatible via Zod `.default()`.
- `.meta.json` gains optional cached fields — backward-compatible via Zod `.optional()`. Existing meta files without cached fields trigger fallback I/O-based enrichment on next list request.

## Required Components

### Modified Files

| File | Change |
|------|--------|
| `src/schema/enums.ts` | Add `'ARCHIVED'` to `ProjectStatus` |
| `src/schema/project-meta.ts` | Add `'ARCHIVED'` to hardcoded status enum + cached enrichment fields (`total_work_packages`, `pending_work_packages`, `project_name`, `repository_name`) |
| `src/gui/config.ts` | Add `auto_archive_days` to schema + default |
| `gui/api.ts` | Add `handleArchiveProject`, `handleUnarchiveProject`; update `handleDeleteProject` guard; update `GuiConfigPartialSchema`; refactor `handleListProjects` for pagination + cache |
| `gui/server.ts` | Register new POST routes; integrate auto-archive on startup; pass query params to list handler |
| `src/tools/project-lifecycle.ts` | Update `listProjects` to exclude archived; add `include_archived` param; write `project_name`/`repository_name` at init |
| `src/storage/ledger-store.ts` | Update `detectProjectByCwd` to skip archived; extend `writeProjectMeta` to accept enrichment fields; sync WP counters on root index writes |
| `src/tools/help-content.ts` | Update help text for `ledger_list_projects` |
| `gui/public/app.js` | Filter dropdown, archive/unarchive buttons, config view, detail banner, pagination controls, server-driven sort/filter |
| `gui/public/styles.css` | Archived badge + muted row styling + pagination controls |

### New Files

| File | Purpose |
|------|---------|
| `src/gui/auto-archive.ts` | Auto-archive service (scan + archive logic + timer) |
| `tests/gui/auto-archive.test.ts` | Unit tests for auto-archive |

## Assumptions

- Only `COMPLETE` projects are eligible for archiving (not `READY`, `IN_PROGRESS`, or `BLOCKED`).
- `ARCHIVED` is a terminal-like status: no outbound transitions except back to `COMPLETE` via explicit unarchive.
- The auto-archive timer lives in the GUI server process only — the MCP server process does not run auto-archive (it has no timer/scheduler infrastructure and must focus on STDIO communication).
- `last_updated` is the appropriate timestamp for the 6-day threshold (represents last meaningful activity).
- The `.meta.json` cache fields are best-effort — if they're missing (legacy data), the system falls back to I/O-based enrichment. Over time, all meta files will have cached fields as projects are created or updated.
- Pagination defaults (page 1, limit 50) provide a sensible experience out of the box. Users who want to see all projects can increase the page size or use `ALL` status filter.

## Constraints

- **Atomic writes** — All status mutations use `atomicWriteJson` under `withLock`.
- **Dual-file sync** — Both `.meta.json` and `project-ledger.json` must be updated in the same lock scope.
- **STDIO discipline** — The auto-archive module logs to `stderr` only (it runs in the GUI server process where `stdout` is allowed, but the module itself should remain STDIO-safe for reusability).
- **Schema backward compatibility** — Adding `ARCHIVED` to the enum is additive (old data without `ARCHIVED` continues to validate). New `auto_archive_days` config field uses `.default(6)` for seamless upgrade.
- **No breaking changes to MCP tool responses** — `include_archived` defaults to `false`, preserving existing behavior.
- **Paginated response envelope** — The `GET /api/projects` response shape changes from a raw array to an object envelope `{ projects, total, page, limit, total_pages, status_counts }`. The frontend is updated simultaneously, so this is not externally breaking (no third-party consumers exist). If backward compatibility is needed in the future, a `?format=array` escape hatch can be added.

## Out of Scope

- Bulk archive operations (archive multiple projects at once) — can be added later.
- Archive retention policies (auto-delete after N additional days) — future enhancement.
- Archive-specific storage optimization (e.g., compressing WP detail files) — not needed at current scale.
- Export/import of archived projects.
- Notification/webhook when auto-archive runs.
- Conditional polling (ETag / If-Modified-Since) — a further optimization that avoids full-page re-fetch when nothing changed. Deferred; pagination already reduces poll payload by ~95% at 1000 projects.
- Database migration (SQLite / LevelDB) — file-per-project scales to several thousand with the `.meta.json` cache and pagination. A DB migration is premature until we approach 10k+ projects.
- Virtual scrolling in the frontend — standard pagination is sufficient and much simpler for the vanilla JS SPA.

## Acceptance Criteria

1. A `COMPLETE` project can be manually archived via the GUI, transitioning to `ARCHIVED` status.
2. An `ARCHIVED` project can be manually unarchived via the GUI, transitioning back to `COMPLETE`.
3. Archived projects appear in the project list with a distinctive `ARCHIVED` badge and muted visual styling.
4. The project list defaults to showing active (non-archived) projects; an `ARCHIVED` filter option reveals them.
5. All project data (plan, synthesis, WPs, comments) remains fully accessible for archived projects in the GUI.
6. `COMPLETE` projects with `last_updated` older than 6 days (configurable) are automatically archived.
7. Auto-archive threshold is configurable via the GUI config view (0 = disabled).
8. Auto-archive runs on GUI server startup and every 10 minutes.
9. Archived projects are excluded from `ledger_list_projects` default MCP tool results.
10. Archived projects are excluded from `detectProjectByCwd` matching (agents cannot accidentally target them).
11. `ARCHIVED` projects can be deleted via the GUI (same as `COMPLETE`).
12. All changes are covered by unit tests.
13. `handleListProjects` uses cached `.meta.json` fields when available, falling back to I/O-based enrichment for legacy meta files.
14. `GET /api/projects` returns a paginated envelope `{ projects, total, page, limit, total_pages, status_counts }`.
15. Frontend renders paginated project list with Previous/Next controls and a page-size selector.
16. Frontend sort/filter/search operations re-fetch from the server instead of client-side manipulation.
17. The 10-second poll refreshes only the current page.

## Testing Strategy

- **Unit tests** for schema acceptance of `ARCHIVED` status.
- **Unit tests** for `handleArchiveProject` and `handleUnarchiveProject` — happy paths, guard rejections, NOT_FOUND.
- **Unit tests** for `handleDeleteProject` with `ARCHIVED` status.
- **Unit tests** for `runAutoArchive` — threshold logic, skip non-eligible, no-op on `0`.
- **Unit tests** for `ledger_list_projects` with and without `include_archived`.
- **Unit tests** for `detectProjectByCwd` skipping archived projects.
- **Integration tests** — Full archive/unarchive lifecycle via API handlers.
- **Unit tests** for `.meta.json` cache: verify cached fields are written on init and root-index updates; verify `handleListProjects` uses cached values and skips I/O.
- **Unit tests** for pagination: page/limit slicing, status filtering, search, sort, edge cases (empty results, last page, out-of-range page).
- **Unit tests** for `status_counts` in paginated response.
- No E2E browser tests (the GUI is a vanilla JS SPA without a test framework — manual verification is appropriate for UI changes, consistent with current practice).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Schema migration** — Existing `gui-config.json` files lack `auto_archive_days` | Zod `.default(6)` handles missing field gracefully. No migration script needed. |
| **Race condition on auto-archive** — Auto-archive timer could conflict with manual archive/unarchive | Both operations use `withLock()` on the project's `storageDir`. The lock serializes access. |
| **Agent confusion** — Agents may encounter `ARCHIVED` status in responses if they address a project by explicit `project_path` | Agents already handle unknown/unexpected statuses gracefully (they display the raw status text). `ARCHIVED` is descriptive. |
| **Default filter change** — Switching default from `ALL` to `ACTIVE` could confuse users who expect to see all projects | The `ACTIVE` filter label and `ALL` still being available makes the distinction clear. A brief tooltip or label clarification suffices. |
| **Validator broadening** — `ProjectStatus` is used in status transition validators | Archive/unarchive transitions are handled exclusively in the GUI API handlers, not in the MCP tool `status_transitions` validator logic. No existing status transition rules are affected. |
| **Paginated response breaking change** — `GET /api/projects` response shape changes from array to object | Frontend is updated simultaneously. No third-party consumers exist. A `?format=array` escape hatch can be added if needed later. |
| **Meta cache staleness** — cached `project_name` could become stale if the managed workspace's `package.json` changes | Acceptable: project name rarely changes, and `title` (manually set) takes precedence. A "refresh cache" admin action can be added later if needed. |
| **Readdir performance at 1000+ directories** — `readdir()` may slow on some filesystems with many entries | At 1000-2000 entries, `readdir` with `withFileTypes: true` is still sub-100ms on modern SSDs. Beyond 5000, consider a manifest index file. Deferred per out-of-scope. |
