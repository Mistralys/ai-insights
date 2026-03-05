# Plan

## Summary

Allow users to independently rename a project's **display title** (pretty name) and its **slug** (storage identifier) from the GUI project detail page. The title rename already exists but has two bugs: (1) it is fragile in a subtle display-fallback edge case (see Architectural Context), and (2) it incorrectly updates `last_updated`, causing the renamed project to float to the top of the sorted list. The slug rename is new: it renames the ledger storage directory on disk and updates the `slug` field in `.meta.json`, then navigates the browser to the new URL. Both fields will be inline-editable side-by-side in the detail page metadata card, keeping the heading area for the display title only. Neither rename operation touches `last_updated` — renaming is a cosmetic/structural change, not a content update.

---

## Architectural Context

### Storage model

| Concept | Location | Format |
|---------|----------|--------|
| Ledger storage dir | `mcp-server/storage/ledger/{slug}/` | Filesystem directory |
| Project slug | `slug` field in `storage/ledger/{slug}/.meta.json` | String — basename of the storage dir |
| Display title | `title` field in `storage/ledger/{slug}/.meta.json` | Optional string |
| Plan folder | Wherever the original plan lives (e.g. `docs/agents/plans/{slug}/`) | Separate from ledger storage |

The slug is derived from the basename of `projectPath` via `projectSlugFromPath()` (`mcp-server/src/utils/ledger-root.ts`). When the GUI constructs a `LedgerStore` it passes the raw slug as the first argument; `this.planPath = slug` and `this.storageDir = join(ledgerRoot, slug)`.

### Relevant files

| File | Role |
|------|------|
| `mcp-server/src/storage/ledger-store.ts` | `LedgerStore` class — all storage primitives |
| `mcp-server/src/schema/project-meta.ts` | `ProjectMetaSchema` / `ProjectMeta` type |
| `mcp-server/gui/api.ts` | `handleRenameProject`, `assertSafeSlug`, all API handlers |
| `mcp-server/gui/server.ts` | HTTP router — `PATCH /api/projects/:slug` route |
| `mcp-server/gui/public/app.js` | SPA — inline title edit logic, API client |
| `mcp-server/gui/public/styles.css` | Styles for edit UI |
| `mcp-server/tests/gui/api.test.ts` | GUI API unit tests |
| `mcp-server/tests/storage/ledger-store.test.ts` | `LedgerStore` unit tests |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | API surface manifest |

### Current title-rename behaviour

`PATCH /api/projects/:slug` accepts `{ title: string }`, calls `LedgerStore.updateTitle()`, persists `title` in `.meta.json`. The `handleListProjects` and detail page both read `meta.title` and prefer it over the slug-derived auto-name.

**Bug:** `updateTitle()` sets `last_updated: new Date().toISOString()` on every title save. This causes the project to sort to the top of the list (list is ordered by `last_updated` descending from `LedgerStore.listAllProjects`). The fix is to omit the `last_updated` touch from both `updateTitle()` and the new `renameSlug()`.

### The "pretty name reverts to slug" bug

The revert is a **display fallback**, not a persistence failure. The detail page sets:

```javascript
var displayTitle = (meta.title && meta.title.trim()) ? meta.title : slug;
```

If the detail page is loaded before `meta.title` was ever set (e.g. a project initialized without a title), `displayTitle === slug`. The user edits the heading, saves successfully, and sees the new title — but only in memory. If the page is then navigated away and back **before the title is re-initialized in `.meta.json`** it shows the slug again.

More importantly: the current rename widget edits the **title only**. The project in the list shows `project_name`, which is computed from `meta.title` (highest priority), then the plan manifest, then slug-stripping. When `meta.title` is not set, the slug-derived name appears in the list *and* on the detail page. Users seeing a slug-like name in the heading assume they are editing that value — but they are actually creating a separate `title` overlay. The slug itself (the folder name, the URL key) cannot currently be changed at all. This plan fixes both the confusion and the missing capability.

### Lock behaviour and rename safety

`withLock` creates `{storageDir}/.lock` inside the directory. Using `fs.rename` while holding a lock on `oldStorageDir` would move the lock file to the new location, and `proper-lockfile` would fail to release it at the old path. Therefore, `renameSlug()` must **not** run under `withLock` — consistent with the existing `updateTitle()` pattern and justified by the same low-concurrency reasoning documented in the synthesis for the previous project.

---

## Approach / Architecture

### Unified PATCH body schema

Extend the existing `PATCH /api/projects/:slug` endpoint body schema from `{ title: string }` to:

```typescript
{ title?: string; slug?: string }  // .refine() — at least one field must be present
```

This keeps the API surface minimal: one endpoint handles both rename types. The response always returns the final `ProjectMeta` (which includes the new slug when changed), giving the frontend everything it needs to redirect.

### `LedgerStore.renameSlug(newSlug)`

New storage method that:
1. Validates `newSlug` (safe characters: `^[a-z0-9][a-z0-9-]*$`, max 200 chars).
2. Guards: old dir exists; new dir does NOT already exist.
3. Calls `rename(oldStorageDir, newStorageDir)` — atomic on POSIX, effectively atomic on Windows for same-drive renames.
4. Reads `.meta.json` from the new path, patches `slug → newSlug`, writes back with `atomicWriteJson`. **Does not touch `last_updated`.**
5. Returns the updated `ProjectMeta`.

`plan_path` is intentionally **not** changed — the original plan folder is independent of ledger storage.

### Frontend UX

| Field | Where | Trigger |
|-------|-------|---------|
| **Display title** | `<h1>` heading area (existing `✎` pencil) | Click pencil → inline input → Enter/blur |
| **Slug** | Metadata card below heading (new `✎` pencil next to `<code>` slug value) | Click pencil → inline input → Enter/blur |

After a successful slug rename the SPA navigates to `#/projects/{newSlug}` (the detail page re-initialises automatically). The slug edit input should validate the pattern client-side before calling the API to give immediate feedback.

---

## Rationale

- **Single PATCH endpoint** — avoids adding a new route and keeps HTTP semantics consistent (`PATCH` = partial update).
- **Storage-only rename** — the plan folder is authored content; renaming it would break filesystem history and MCP tool state. Only the ledger storage directory (fully owned by the server) is renamed.
- **No `withLock` for rename** — documented as acceptable for low-concurrency GUI paths; aligns with `updateTitle()` approach.
- **Client-side slug pattern validation** — catches invalid characters before a round trip, matching UX patterns already used in other inputs.
- **Tech debt fix (RenameBodySchema hoisting)** — hoisting the Zod schema to module level is a natural by-product of extending it, addressing Observation #2 from the previous synthesis.
- **`last_updated` not touched by either rename** — renaming is a cosmetic/structural operation, not a content update. Touching `last_updated` would distort sort order and mislead users about when work was actually done on the project. `date_created`, `status`, and `last_updated` all stay intact.

---

## Detailed Steps

### WP-001 — Storage Layer: fix `updateTitle()` + add `LedgerStore.renameSlug()`

1. **Fix `updateTitle()`** in `mcp-server/src/storage/ledger-store.ts`: remove the `last_updated: new Date().toISOString()` line. The method should spread `...meta` and set only `title`, preserving `last_updated` as stored.
2. Add `rename` to the `fs/promises` import in `mcp-server/src/storage/ledger-store.ts`.
3. Define and export a `SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/` constant (or place it in `mcp-server/src/utils/constants.ts` alongside `AGENT_ROLES` — preferred for reuse).
4. Add `async renameSlug(newSlug: string): Promise<ProjectMeta>` to `LedgerStore`:
   - Validate `newSlug.length <= 200` and `SAFE_SLUG_REGEX.test(newSlug)`.
   - Check `newSlug !== this.slug` (no-op guard; throw if same).
   - Await `access(newStorageDir)` — if it succeeds, throw a conflict error ("slug already in use").
   - `await rename(this.storageDir, newStorageDir)`.
   - Read `.meta.json` from new path, parse, merge `{ slug: newSlug }` (**do not update `last_updated`**), write back with `atomicWriteJson`.
   - Return validated `ProjectMeta`.
5. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — updated `updateTitle()` note and new `renameSlug()` entry; note the `SAFE_SLUG_REGEX` export.

### WP-002 — API Layer: extend `handleRenameProject`

1. Hoist `RenameBodySchema` to module level (resolve Tech Debt #2):
   ```typescript
   const RenameBodySchema = z.object({
     title: z.string().min(1).max(200).optional(),
     slug:  z.string().min(1).max(200).optional(),
   }).refine(d => d.title !== undefined || d.slug !== undefined, {
     message: 'At least one of title or slug must be provided.',
   });
   ```
2. Update `handleRenameProject` logic:
   - If `title` is present → `store.updateTitle(title)` (update `latestMeta`).
   - If `slug` is present → `store.renameSlug(newSlug)` (update `latestMeta`; note: the store is constructed with the *old* slug and `ledgerRoot`, so the directory rename works from the old path).
   - Return `latestMeta`.
3. The response `ProjectMeta.slug` will carry the new slug when changed; the frontend uses this to detect a slug change.
4. Update the JSDoc of `handleRenameProject`.
5. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — update the `handleRenameProject` entry.

### WP-003 — Frontend: Slug Edit UI

1. **API client** (`app.js`): add `renameSlug(slug, newSlug)` alongside the existing `renameProject`:
   ```javascript
   renameSlug: function (slug, newSlug) {
     return request('PATCH', '/projects/' + encodeURIComponent(slug), { slug: newSlug });
   },
   ```
2. **Metadata card** (`app.js`): add a slug row to the `.card` div in the project detail view:
   ```html
   <strong>Slug:</strong>
   <span class="monospace" id="project-slug-value">{slug}</span>
   <button class="edit-slug-btn" id="edit-slug-btn" title="Rename slug">✎</button>
   ```
3. **Inline slug edit** (`app.js`): implement an IIFE analogous to the title edit block:
   - Input pre-filled with current slug value.
   - Client-side validation against `/^[a-z0-9][a-z0-9-]*$/` — show an inline error div (`id="slug-edit-error"`) without API call.
   - On success → update `<code>` value locally and navigate: `window.location.hash = '#/projects/' + encodeURIComponent(newSlug)`. (Navigation triggers a full detail page reload at the new URL.)
   - `inputDone` flag (same double-save prevention pattern as title edit).
4. **CSS** (`styles.css`): add `.edit-slug-btn` (can share styles with `.edit-title-btn`) and `.slug-edit-input` / `.slug-edit-error`.
5. No routing changes needed — navigating to `#/projects/{newSlug}` reuses the existing `showProject(slug)` call path.

### WP-004 — Tests

**`mcp-server/tests/storage/ledger-store.test.ts` — `describe('LedgerStore.renameSlug')`:**
1. Renames the storage directory on disk (old dir gone, new dir exists).
2. Updates `slug` field in `.meta.json` of the new directory.
3. Preserves `title`, `plan_path`, `status`, `date_created`, and **`last_updated`** fields.
4. Rejects the same slug as current (no-op guard error).
5. Rejects an invalid slug pattern (e.g. `"my slug!"`, `"../escape"`, `""`).
6. Rejects when target slug directory already exists (conflict error).
7. Returns the updated `ProjectMeta` with correct `slug`.

**`mcp-server/tests/storage/ledger-store.test.ts` — extend `describe('LedgerStore.updateTitle')`:**
8. `last_updated` is identical before and after `updateTitle()` (assert strict equality of the stored ISO string).

**`mcp-server/tests/gui/api.test.ts` — extend `describe('handleRenameProject')`:**
1. `{ slug: newSlug }` alone — directory renamed, meta updated, response slug matches.
2. `{ title, slug }` together — both applied; response has correct title and new slug.
3. `{ slug: newSlug }` where target already exists — structured conflict error (not a 500).
4. Invalid slug pattern in body — `VALIDATION_ERROR`.
5. Empty body `{}` — `VALIDATION_ERROR` (existing behaviour preserved; confirm with new schema).

---

## Dependencies

- `fs/promises.rename` (Node.js built-in — already imported from the same module in `ledger-store.ts`; just add `rename` to the destructure).
- No new npm packages required.

---

## Required Components

| Component | Status | Location |
|-----------|--------|----------|
| `LedgerStore.renameSlug()` | **New** | `mcp-server/src/storage/ledger-store.ts` |
| `SAFE_SLUG_REGEX` | **New** | `mcp-server/src/utils/constants.ts` |
| Extended `RenameBodySchema` | Modified | `mcp-server/gui/api.ts` (hoisted to module level) |
| `handleRenameProject` extended logic | Modified | `mcp-server/gui/api.ts` |
| `renameSlug()` API client method | **New** | `mcp-server/gui/public/app.js` |
| Slug display + inline edit | **New** | `mcp-server/gui/public/app.js` |
| `.edit-slug-btn`, `.slug-edit-input`, `.slug-edit-error` CSS | **New** | `mcp-server/gui/public/styles.css` |
| Test cases (7 storage + 5 API) | **New** | `mcp-server/tests/storage/ledger-store.test.ts`, `mcp-server/tests/gui/api.test.ts` |
| `api-surface.md` updates | Modified | `mcp-server/docs/agents/project-manifest/api-surface.md` |

---

## Assumptions

- The slug renamed by the user applies **only to the ledger storage directory** (`storage/ledger/{slug}/`); the plan folder (e.g. `docs/agents/plans/{slug}/`) is **not** touched.
- Valid slugs follow `^[a-z0-9][a-z0-9-]*$` (lowercase alphanumeric and hyphens, starting with alphanumeric). This is intentionally more restrictive than the current `assertSafeSlug` check (which only blocks `/` and `..`) to keep slugs URL-safe without encoding.
- `fs.rename` on the same drive (which covers the only realistic deployment scenario) is effectively atomic.
- The frontend re-loads the project detail by navigating to the new hash — no explicit cache-busting needed.
- The "pretty name reverts to slug" bug described by the user is a display fallback issue (title was never set, or a failed save was not surfaced visually) rather than a persistence regression. This plan addresses the root confusion by making the slug itself editable, so users are no longer unsure which field they are editing.

---

## Constraints

- `withLock` must **not** wrap `renameSlug()` — the `.lock` file lives inside the storage dir and would move with it, breaking `proper-lockfile`'s release path.
- `plan_path` in `.meta.json` must remain unchanged after a slug rename.
- `last_updated` in `.meta.json` must **not** be modified by either `updateTitle()` or `renameSlug()` — renaming is cosmetic and must not distort sort order.
- The `SAFE_SLUG_REGEX` placed in `constants.ts` must not conflict with `AGENT_ROLES` or `KNOWN_ROLES` — it is a utility constant, not a role name.
- `server.ts` router requires **no changes** — the existing `PATCH /api/projects/:slug` route already passes the slug and body to `handleRenameProject`.
- All new and modified test cases must pass with `tsc --noEmit` emitting 0 errors (TypeScript strict mode).

---

## Out of Scope

- Renaming the plan folder on disk (e.g. `docs/agents/plans/{slug}/`) — this is authored content outside ledger ownership.
- Updating `plan_path` in `.meta.json` after a slug rename.
- Renaming the slug via MCP tools (only the GUI exposes this action).
- Case-insensitive slug normalization (the schema already stores slugs as-typed; forcing lowercase would be an additive constraint that could be done later).
- A "slug history" or redirect table for old slugs — out of scope for a single-user local tool.

---

## Acceptance Criteria

- [ ] The project detail page metadata card displays the current slug with an inline `✎` edit button.
- [ ] Clicking the slug pencil shows an input pre-filled with the current slug.
- [ ] Entering a slug that doesn't match `^[a-z0-9][a-z0-9-]*$` shows a client-side error without an API call.
- [ ] A valid slug rename calls `PATCH /api/projects/{oldSlug}` with `{ slug: newSlug }`, renames `storage/ledger/{oldSlug}/` to `storage/ledger/{newSlug}/`, updates `.meta.json`, and navigates the browser to `#/projects/{newSlug}`.
- [ ] Trying to rename to an already-existing slug returns a structured error (not a 500).
- [ ] The display title pencil (heading area) still works and only affects `meta.title`, not the slug.
- [ ] Providing both `{ title, slug }` in one PATCH applies both changes.
- [ ] `PATCH` with an empty body returns `VALIDATION_ERROR`.
- [ ] Renaming the title does **not** change `last_updated` in `.meta.json`; the project's sort position in the list is unchanged.
- [ ] Renaming the slug does **not** change `last_updated` in `.meta.json`.
- [ ] All 14 new test cases pass.
- [ ] `tsc --noEmit` — 0 errors.
- [ ] Full test suite passes with no regressions.

---

## Testing Strategy

- **Unit (storage layer):** 7 cases for `LedgerStore.renameSlug()` and 2 additional cases for the `updateTitle()` fix (see below) — uses temp directory fixtures identical to existing `LedgerStore` tests.
- **Unit (API layer):** 5 cases added to the existing `describe('handleRenameProject')` block — covers slug-only, combined title+slug, conflict, invalid pattern, and empty-body scenarios.
- **`last_updated` regression tests (2 new):** (a) `updateTitle()` — assert `last_updated` is identical before and after the call; (b) `renameSlug()` — assert `last_updated` is identical before and after. These are added to the Ledger Store test file.
- **Manual smoke test:** Start GUI, open the "Gui Rename And Repo Column" project, rename its title, return to the project list and confirm the project has not moved position; then rename the slug and confirm the same.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`fs.rename` fails mid-operation (e.g. disk error) leaving no directory** | After a `rename` failure the old directory is still intact (rename is atomic at the OS level on the same drive). The error propagates as a 500 and is surfaced in the GUI. |
| **Concurrent agent write to old slug while rename is in progress** | Same low-risk assumption as `updateTitle()` — accepted for GUI low-concurrency path. Document in JSDoc. |
| **User renames slug to match another existing project** | `renameSlug()` calls `access(newStorageDir)` before `rename()` and throws a structured conflict error. The API handler converts this to a 409 / `CONFLICT` response. |
| **Invalid characters in new slug reach the API** | Client-side validation (`/^[a-z0-9][a-z0-9-]*$/`) catches this before the API call. API-layer Zod schema (`slug: z.string().min(1).max(200)`) combined with `assertSafeSlug` server-side provides defence in depth; `renameSlug()` performs a final regex check as the storage-layer guard. |
| **Old hash `#/projects/{oldSlug}` still bookmarked by user** | The old ledger directory is gone; `handleGetProject` returns 404 for the old slug if re-requested. No breaking side-effects beyond the expected 404. |
