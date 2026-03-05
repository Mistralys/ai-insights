# Plan

## Summary

Add two features to the Ledger GUI dashboard: (1) the ability to rename projects on the project detail page via an inline-edit interaction that persists to the `title` field of `.meta.json`, and (2) a new "Repository" column on the project list table that displays the repository folder name derived from each project's `plan_path`.

## Architectural Context

The GUI is a plain-JavaScript SPA ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js)) backed by a Node.js HTTP server ([mcp-server/gui/server.ts](mcp-server/gui/server.ts)) that delegates to pure async handler functions in [mcp-server/gui/api.ts](mcp-server/gui/api.ts).

**Key files and patterns:**

- **Schema:** `ProjectMetaSchema` in [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts) defines project metadata. It already has an optional `title: z.string().optional()` field.
- **Storage:** `LedgerStore` in [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) manages per-project `.meta.json` files via `readProjectMeta()` and `writeProjectMeta()`. The `writeProjectMeta()` method currently preserves an existing `title` but has no mechanism to *set* a new one.
- **API layer:** [mcp-server/gui/api.ts](mcp-server/gui/api.ts) exports handler functions (`handleListProjects`, `handleGetProject`, etc.) that the server calls. Write operations (e.g. `handleDeleteProject`, `handleUpdateConfig`, `handleResetProject`) follow a consistent pattern: validate slug → load store → guard preconditions → perform mutation → return result.
- **Server router:** [mcp-server/gui/server.ts](mcp-server/gui/server.ts) dispatches routes via `matchRoute()` for GET/DELETE and handles body-parsing routes (PUT, POST) as special cases in `handleRequest()`.
- **Frontend:** `renderProjectList()` in [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) builds the project table. `renderProjectDetail()` renders the detail page with a `<h1>` showing the slug.
- **API client:** The `API` object in [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) wraps `fetch()` calls.
- **Project name resolution:** `handleListProjects` already resolves a `project_name` from manifest files (package.json, composer.json, pyproject.toml) or by title-casing the slug. This is display-only and not persisted.
- **Path utilities:** `inferProjectRootFromPlanPath()` in [mcp-server/src/utils/ledger-root.ts](mcp-server/src/utils/ledger-root.ts) walks 4 levels up from `plan_path` to get the project root (e.g. `F:\repos\my-project`).

**Test infrastructure:** [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts) uses real temp directories with `LedgerStore` to build fixtures, then calls handler functions directly.

## Approach / Architecture

### Feature 1: Project Rename

Add a new `PATCH /api/projects/:slug` endpoint that accepts `{ title: string }` and updates the `title` field in the project's `.meta.json`. On the frontend, the project detail page heading becomes an inline-editable element (click to edit, Enter/blur to save, Escape to cancel).

The `title` field already exists in `ProjectMetaSchema` as optional. The rename operation writes directly to `.meta.json` via a new `updateProjectTitle()` method on `LedgerStore` (or a targeted `writeProjectMeta` variant). The `handleListProjects` handler will prioritize the persisted `title` over the auto-detected `project_name` from manifest files.

### Feature 2: Repository Column

Derive the repository name from the project's `plan_path` using the existing `inferProjectRootFromPlanPath()` utility, then extracting the last path segment (the directory name). This is computed server-side in `handleListProjects` and returned as a new `repository_name` field on `ProjectSummary`. The frontend adds a "Repository" column to the project list table.

## Rationale

- **PATCH over PUT** for the rename endpoint: partial update semantics are the correct HTTP verb; only `title` is being changed.
- **Persist title in `.meta.json`** rather than a separate file: the field already exists in the schema and the storage layer already preserves it. No schema migration needed.
- **Server-side repo name derivation** rather than client-side path parsing: keeps path logic centralized and avoids exposing raw filesystem paths to parsing in the browser.
- **Inline edit UX** (click-to-edit heading) rather than a modal or separate form: matches modern dashboard conventions and requires minimal UI changes.
- **Prioritize persisted title** in the project list: when a user has explicitly renamed a project, that name should take precedence over auto-detected manifest names.

## Detailed Steps

### Backend

1. **Add `updateTitle()` method to `LedgerStore`** ([mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts))
   - New method: `async updateTitle(title: string): Promise<ProjectMeta>`
   - Reads existing `.meta.json`, sets `title`, updates `last_updated`, validates with `ProjectMetaSchema`, writes atomically.
   - Returns the updated `ProjectMeta`.

2. **Add `handleRenameProject()` handler** ([mcp-server/gui/api.ts](mcp-server/gui/api.ts))
   - Signature: `handleRenameProject(ledgerRoot: string, slug: string, body: unknown): Promise<ProjectMeta>`
   - Validates slug via `assertSafeSlug()`.
   - Validates body with a Zod schema: `z.object({ title: z.string().min(1).max(200) })`.
   - Creates `LedgerStore`, checks `ledgerDirExists()`, calls `store.updateTitle(title)`.
   - Returns updated `ProjectMeta`.

3. **Add `PATCH /api/projects/:slug` route** ([mcp-server/gui/server.ts](mcp-server/gui/server.ts))
   - Add as a body-parsing special case in `handleRequest()` (same pattern as PUT /api/config and POST reset).
   - Import `handleRenameProject` from `./api.js`.

4. **Enrich `ProjectSummary` with `repository_name`** ([mcp-server/gui/api.ts](mcp-server/gui/api.ts))
   - Add `repository_name: string | null` to the `ProjectSummary` interface.
   - In `handleListProjects`, after resolving `project_name`, compute repository name:
     ```ts
     const projectRoot = inferProjectRootFromPlanPath(meta.plan_path);
     const repository_name = projectRoot.split('/').pop() || null;
     ```
   - Import `inferProjectRootFromPlanPath` from the utils.

5. **Prioritize persisted `title` in project list** ([mcp-server/gui/api.ts](mcp-server/gui/api.ts))
   - In `handleListProjects`, after computing `project_name`, read the meta's `title` field.
   - If `meta.title` is a non-empty string, set `project_name = meta.title` (overrides auto-detected name).

### Frontend

6. **Add `renameProject` to API client** ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js))
   - Add: `renameProject: function (slug, title) { return request('PATCH', '/projects/' + encodeURIComponent(slug), { title: title }); }`

7. **Add "Repository" column to project list table** ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js))
   - In `buildTable()`: add `<th>Repository</th>` to the `<thead>`.
   - In the row template: add `<td>` with `escapeHtml(p.repository_name || '—')`.
   - Update `data-name` attribute on `<tr>` to also include repository name for search filtering.
   - Update `applyFilter()` to also search against the repository name (add a `data-repo` attribute).

8. **Make project title editable on detail page** ([mcp-server/gui/public/app.js](mcp-server/gui/public/app.js))
   - In `renderProjectDetail()`:
     - Change the `<h1>` to show the meta `title` (if set) or slug, with a pencil icon/button.
     - On click: replace `<h1>` content with an `<input>` pre-filled with current title.
     - On Enter or blur: call `API.renameProject(slug, newTitle)`. On success, update the heading.
     - On Escape: revert to original text without saving.
   - Also update the breadcrumb to show the title when set.

9. **Add CSS for inline edit** ([mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css))
   - Style the edit button/pencil icon.
   - Style the inline input to match the heading size.

### Tests

10. **Add `handleRenameProject` tests** ([mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts))
    - Test: successful rename updates title and returns updated meta.
    - Test: empty title string returns VALIDATION_ERROR.
    - Test: non-existent slug returns NOT_FOUND.
    - Test: path-traversal slug returns NOT_FOUND.
    - Test: title persists across subsequent `handleGetProject()` calls.

11. **Add `repository_name` assertion to existing list tests** ([mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts))
    - Verify that `handleListProjects` returns `repository_name` derived from `plan_path`.

12. **Add `updateTitle` unit test** ([mcp-server/tests/storage/ledger-store.test.ts](mcp-server/tests/storage/ledger-store.test.ts) or alongside GUI tests)
    - Test that `updateTitle()` sets the title field and updates `last_updated`.

## Dependencies

- `inferProjectRootFromPlanPath` from [mcp-server/src/utils/ledger-root.ts](mcp-server/src/utils/ledger-root.ts) — already exists, no changes needed.
- `ProjectMetaSchema` in [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts) — already has optional `title` field, no schema changes needed.
- `atomicWriteJson` from [mcp-server/src/storage/atomic-writer.ts](mcp-server/src/storage/atomic-writer.ts) — used by the new `updateTitle()` method.

## Required Components

### Modified Files
- [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) — new `updateTitle()` method
- [mcp-server/gui/api.ts](mcp-server/gui/api.ts) — new `handleRenameProject()` handler + `repository_name` enrichment + title priority logic
- [mcp-server/gui/server.ts](mcp-server/gui/server.ts) — new PATCH route + import
- [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) — API client method + repository column + inline edit UI
- [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) — inline edit styles
- [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts) — new test cases

### No New Files Required

## Assumptions

- The `title` field in `ProjectMetaSchema` is the correct storage location for user-defined project names. It is already optional and persisted.
- The convention `{project-root}/docs/agents/plans/{slug}` is reliable for deriving the repository name from `plan_path`.
- The `PATCH` HTTP method is appropriate; the existing CORS configuration already allows it (the server sets `Access-Control-Allow-Methods: 'GET, POST, PUT, DELETE, OPTIONS'` — **PATCH must be added**).

## Constraints

- **Atomic writes:** All `.meta.json` writes must use `atomicWriteJson` (existing constraint from [mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md)).
- **STDIO discipline:** The GUI API module must not write to `process.stdout` (existing constraint).
- **Path safety:** The `assertSafeSlug()` guard must be applied to the rename endpoint (consistent with all other slug-based handlers).
- **No breaking schema changes:** The `title` field is already optional in `ProjectMetaSchema`; adding a value is backward-compatible.

## Out of Scope

- Renaming the project *slug* (the directory name). Only the display title changes.
- Renaming from the project list page (only the detail page gets the edit UI).
- Persisting `repository_name` to disk (it is computed on-the-fly from `plan_path`).
- Adding repository name to the project detail page (only the list table).
- Bulk rename operations.
- MCP tool changes (no new MCP tools are needed; this is GUI-only).

## Acceptance Criteria

- **AC1:** On the project detail page, clicking the project title (or a pencil icon next to it) reveals an inline text input. Pressing Enter or blurring the input saves the new title via `PATCH /api/projects/:slug`. The heading updates immediately.
- **AC2:** Pressing Escape while editing cancels the rename without saving.
- **AC3:** The renamed title appears in the project list's "Project" column on subsequent loads, taking precedence over auto-detected manifest names.
- **AC4:** The project list table has a new "Repository" column showing the repository folder name (last segment of the project root path).
- **AC5:** The repository name column correctly displays for all projects, showing "—" when the path cannot be resolved.
- **AC6:** The search filter on the project list page also searches against repository names.
- **AC7:** Empty or whitespace-only titles are rejected with a validation error.
- **AC8:** All existing GUI API tests continue to pass.
- **AC9:** New tests cover the rename handler (success, validation, not-found, path-traversal) and the `repository_name` field on list responses.

## Testing Strategy

- **Unit tests** for the new `LedgerStore.updateTitle()` method: verify title persists, `last_updated` changes, and validation rejects invalid data.
- **Handler tests** for `handleRenameProject`: test success path, validation errors (empty title), NOT_FOUND for missing projects, path-traversal rejection. Verify title persists by reading it back with `handleGetProject`.
- **Integration assertion** on `handleListProjects`: verify `repository_name` is present and correct, and that a persisted `title` overrides the auto-detected `project_name`.
- **Manual smoke test** of the frontend inline-edit interaction (click, type, Enter, Escape, blur).
- Run full test suite with `npm test` from `mcp-server/`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CORS rejection of PATCH method** | Add `PATCH` to the `Access-Control-Allow-Methods` header in `corsHeaders()`. |
| **Race condition on `.meta.json` writes** | The `updateTitle()` method should use `withLock()` for file locking, consistent with `writeRootIndexWithLock()`. |
| **Title field lost by `writeProjectMeta()`** | The existing method already preserves `existing.title` — no regression expected. Verify with a test that a rename followed by a status update does not erase the title. |
| **Long titles breaking layout** | Apply CSS `text-overflow: ellipsis` and `max-width` on the project name cell and the detail page heading input. |
| **Repository name derivation fails for non-standard plan paths** | Gracefully fall back to `null` (displayed as "—") when the path has fewer than 4 segments. |
