# Plan

## Summary

Four focused enhancements to the ledger GUI project-list view: a client-side fulltext search filter, a "% done" progress column derived from work-package counters, a "Project Name" column read from the project filesystem (`package.json` / `composer.json` / `pyproject.toml`), and a cleaner slug display that strips the date prefix and surfaces the full slug via a tooltip.

---

## Architectural Context

| Layer | File | Relevant detail |
|-------|------|-----------------|
| API handler | `mcp-server/gui/api.ts` | `handleListProjects` returns `ProjectMeta[]`. WP counters and project name are not currently exposed. |
| Data models | `mcp-server/src/schema/project-meta.ts` | `ProjectMeta`: `slug`, `plan_path`, `status`, `date_created`, `last_updated`, `title?` |
| Data models | `mcp-server/src/schema/root-index.ts` | `RootIndex`: `total_work_packages`, `pending_work_packages`, `work_packages[]`, … |
| Storage layer | `mcp-server/src/storage/ledger-store.ts` | `LedgerStore.listAllProjects()` reads `.meta.json` files; `store.readRootIndex()` reads the root index per project |
| Frontend SPA | `mcp-server/gui/public/app.js` | Plain ES5-compatible JS. `renderProjectList` → `buildTable` builds the table from the project list. |
| Styles | `mcp-server/gui/public/styles.css` | CSS custom properties, `.filter-bar`, `.table-wrapper` patterns |

The plan_path field in `ProjectMeta` is described as "Original project_path used during initialization" — i.e., the absolute workspace root of the project being managed, making it the correct base for resolving `package.json` and similar files.

---

## Approach / Architecture

### 1 — Backend: enriched project summary

Extend `handleListProjects` in `api.ts` to return a richer `ProjectSummary` type (a superset of `ProjectMeta`). For each project discovered by `LedgerStore.listAllProjects`, launch two parallel tasks inside a `Promise.all`:

- **WP counts**: call `store.readRootIndex()` → extract `total_work_packages`, `pending_work_packages`
- **Project name**: call a new `readProjectName(planPath)` helper that tries `package.json`, then `composer.json`, then `pyproject.toml` in order

Both tasks fail gracefully: per-project errors are caught and default to `0` / `null`, following the same pattern already used in `handleGetInsights`.

### 2 — Frontend: new columns + search

- **Fulltext search**: A text `<input>` added to the existing `.filter-bar` alongside the status `<select>`. The `applyFilter()` function is extended to also test each project's slug and project_name against the lowercased search term.
- **% done column**: Computed as `Math.round(((total − pending) / total) × 100)`. Rendered as a compact inline progress bar (track + fill) plus "XX%" label. Projects with no WPs show "—".
- **Project name column**: New column after the slug. Shows `project_name` or "—".
- **Slug display**: The date prefix (`YYYY-MM-DD-`) is stripped for display; the full slug is exposed via an HTML `title` attribute on the cell `<a>`.

### 3 — Styles

Add:
- `.progress-bar-track` / `.progress-bar-fill` for the compact progress indicator
- A `input[type="text"]` rule scoped to `.filter-bar` for consistent styling with the existing `<select>`

---

## Rationale

- Enriching `handleListProjects` server-side avoids N+1 client requests; all reads are concurrent via `Promise.all`, following the established `handleGetInsights` pattern.
- Client-side search requires no new API endpoint — the full list is already in memory after initial load.
- Defaulting project name reads to `null` on failure keeps the list endpoint robust against missing files.
- TOML parsing is intentionally simple (regex on well-formed `name = "..."` lines) to avoid adding a new dependency.

---

## Detailed Steps

1. **`api.ts`** — Add `readProjectName(planPath: string): Promise<string | null>` helper using `node:fs/promises` `readFile`. Try `package.json` → `.name`, then `composer.json` → `.name`, then `pyproject.toml` → simple regex for `name = "..."`. Return `null` on any error or if no file found.

2. **`api.ts`** — Define and export the `ProjectSummary` interface:
   ```typescript
   export interface ProjectSummary extends ProjectMeta {
     total_work_packages: number;
     pending_work_packages: number;
     project_name: string | null;
   }
   ```

3. **`api.ts`** — Replace `handleListProjects` implementation. After calling `LedgerStore.listAllProjects(ledgerRoot)`, run per-project enrichment concurrently:
   ```typescript
   await Promise.all(projects.map(async (meta) => { ... }))
   ```
   Each iteration reads the root index and project name; errors are caught and default to zero/null.

4. **`app.js`** — Update `buildTable` to use `ProjectSummary` fields:
   - Slug cell: strip `/^\d{4}-\d{2}-\d{2}-/` prefix; render `<a href="..." title="full-slug">short-slug</a>`
   - Add "Project" column (position 2, after slug) showing `project_name || '—'`
   - Add "% Done" column (position 3, after Project) with progress bar + percentage

5. **`app.js`** — Add search `<input type="text">` to the filter bar HTML. Wire an `input` event listener that updates a `searchValue` variable, then calls `applyFilter()`. Update `applyFilter()` to filter by both status and search term.

6. **`app.js`** — Update `<thead>` column headers to match the new columns: Slug, Project, % Done, Status, Created, Updated, Actions.

7. **`styles.css`** — Add:
   ```css
   .filter-bar input[type="text"] { /* same look as filter-bar select */ }
   .progress-bar-track { ... }
   .progress-bar-fill  { ... }
   ```

---

## Dependencies

- `node:fs/promises` (`readFile`) — already available, no new imports needed beyond what is in scope
- No new npm packages

---

## Required Components

| Component | Status |
|-----------|--------|
| `mcp-server/gui/api.ts` | Modify |
| `mcp-server/gui/public/app.js` | Modify |
| `mcp-server/gui/public/styles.css` | Modify |

---

## Assumptions

- `plan_path` in `ProjectMeta` is the absolute path to the project root (the managed workspace directory), making it a valid base for resolving manifest files.
- The date prefix pattern in slugs is always `YYYY-MM-DD-` (11 characters).
- TOML parsing is best-effort; a simple regex for `name = "..."` is sufficient.
- The GUI server runs on the same machine as the ledger, so `readFile` on `plan_path` is safe.

---

## Constraints

- STDIO discipline: no `process.stdout` writes introduced in `api.ts`.
- No new npm dependencies.
- `app.js` remains plain ES5-compatible JavaScript (var, function, Promises) matching the existing style.

---

## Out of Scope

- Sorting by project name or % done column.
- Editing or persisting project names in the ledger.
- Lazy-loading or pagination.
- Changes to the project detail or work-package views.
- Git operations.

---

## Acceptance Criteria

- [ ] A fulltext search input is visible in the filter bar and immediately filters displayed rows by slug and project name.
- [ ] A "% Done" column shows a compact progress bar + "XX%" for projects with at least one WP; shows "—" for zero-WP projects.
- [ ] A "Project" column shows the name from `package.json` / `composer.json` / `pyproject.toml`, or "—" if none found.
- [ ] The slug cell shows only the non-date portion; hovering reveals the full slug via a browser tooltip.
- [ ] All existing features (status filter, delete, auto-refresh, auto-polling) continue to work.
- [ ] Individual project-name read failures do not break the list endpoint.

---

## Testing Strategy

- **Manual**: Run `node scripts/run-gui.js`, open the dashboard, verify all four changes in the browser.
- **Type safety**: Run `npm run build` (or `npx tsc --noEmit`) inside `mcp-server/` to confirm the TypeScript changes compile clean.
- **Existing tests**: The Vitest suite in `mcp-server/tests/` should not be affected; the return-type change to `handleListProjects` is additive. Run `npm test` to confirm no regressions.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`plan_path` is not always the project filesystem root** | Fail gracefully (`project_name: null`) so the list still renders. |
| **Regex-based TOML parsing extracts wrong value** | Use a conservative regex (`/^name\s*=\s*"([^"]+)"/m`) and wrap in try/catch; return null on any mismatch. |
| **Concurrent root-index reads slow the list endpoint for many projects** | Same pattern accepted in `handleGetInsights`; acceptable for a local dev tool. |
| **Table becomes too wide with extra columns** | Rely on the existing `overflow-x: auto` in `.table-wrapper`; verify on a narrow viewport. |
