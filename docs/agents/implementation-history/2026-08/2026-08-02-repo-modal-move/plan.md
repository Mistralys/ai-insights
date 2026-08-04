# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The `gui-store-management` project (2026-08-01) delivered full CRUD for the Stores tab in the Configuration screen, establishing the `cs-modal` pattern (overlay, focus trap, WCAG focus restoration, shared add/edit modal). This plan extends the same discipline to the repository domain. The `gui-store-management-rework-1` project (2026-08-01) fixed WCAG 2.1 modal focus restoration and ES5 event-listener accumulation patterns — lessons that apply directly here.

## Summary
Replace the inline "Add Repository" form and the full-page repository detail/editor with a single shared modal dialog. In multi-store mode, the modal includes a store dropdown that enables moving a repository declaration between stores as part of the save flow. A new `POST /api/repos/:repoId/move` backend endpoint handles the move atomically, and `GET /api/repos/:repoId` is enriched to return the owning `store_id` so the modal can pre-select the current store.

## Architectural Context

The Strategy page (`strategy.js`) currently has two rendering functions:
- `renderStrategyList()` — list view with an inline "Add Repository" card at the bottom.
- `renderStrategyDetail()` — full-page edit view at `#/strategy/:repoId` with label, folder names, and vision fields.

The `config-stores.js` companion module established a mature modal pattern (`csRenderStoreModal`) that uses the `.cs-modal-*` CSS class suite (overlay, focus trap, close-on-Escape, WCAG focus restoration). This plan reuses those CSS classes for the repository modal.

The backend (`api-repos.ts`) provides CRUD handlers using the domain-split pattern. `findEntryInStores()` already resolves which store owns a repo, but `handleGetRepo()` discards the `storePath` from the result. The CLI (`scripts/lib/store-commands.js`) has a synchronous `storeRepoMove()` reference implementation.

## Approach / Architecture

**Single modal, two modes:** A new `renderRepoModal(mode, repo, stores)` function renders an add/edit modal following the `csRenderStoreModal` pattern. In add mode: ID, Label, Folder Names, and Store (multi-store) are editable. In edit mode: ID is read-only, all other fields including vision and store are editable. The store dropdown is only rendered in multi-store mode (stores.length > 1).

**Move-on-save:** When the user changes the store dropdown in edit mode, saving the modal first calls `API.moveRepo(repoId, newStoreId)`, then calls `API.updateRepo(repoId, payload)` to apply field changes. This keeps the move operation separate from the update at the API level (clean separation of concerns) while presenting a unified "Save" action to the user.

**Detail route removal:** The `#/strategy/:repoId` route and `renderStrategyDetail()` function are removed entirely. Table row clicks and the "Register" button now open the modal.

**Backend enrichment:** `handleGetRepo()` returns `store_id` alongside the entry fields (only in multi-store mode). A new `handleMoveRepo()` handler at `POST /api/repos/:repoId/move` performs the atomic registry move.

## Rationale
- **Shared modal eliminates duplicate validation:** The add form and edit form currently implement the same validation independently. A single modal centralizes validation in one place.
- **Move-on-save reduces UI clutter:** Instead of a separate "Move to Store" button, the store dropdown integrates naturally into the existing field set. The user changes the store and clicks Save — intuitive and consistent with how the store is selected during creation.
- **Detail page removal:** The full-page detail view exists only because modals weren't used when the Strategy page was first built. The modal approach is more consistent with the rest of the GUI (store management, knowledge editing) and avoids a route navigation round-trip for simple edits.
- **Separate move endpoint over overloading PUT:** The move is a cross-registry operation (remove from one `.repositories.json`, add to another). Overloading PUT with implicit move semantics would violate the principle of least surprise and make the operation harder to reason about in tests.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Move trigger | Integrated in save flow (store dropdown) | Separate "Move to Store" button | Dropdown reuses the existing add-form pattern and avoids an extra action element. The user's mental model is "edit fields → save" rather than "move first, then edit". |
| Move API design | `POST /api/repos/:repoId/move` | Overload `PUT /api/repos/:repoId` with move semantics | Separate endpoint keeps the move (cross-store registry operation) distinct from the update (single-registry field mutation). Matches the established `POST /api/knowledge/:id/move` pattern. |
| Modal vs. full page for edit | Single modal (add/edit) | Keep detail page, add modal for add only | User confirmed modal-replaces-detail. Eliminates a route, reduces code, and aligns with the config-stores pattern. |
| Detail route handling | Remove `#/strategy/:repoId` route entirely | Keep route as redirect to list + open modal | Removing the route is simpler and avoids stale deep links. The modal is opened by JS action, not by URL. |

## Pattern Alignment
- Follows the `csRenderStoreModal(mode, store)` modal pattern — `mcp-server/gui/public/views/config-stores.js`. Reuses `.cs-modal-*` CSS classes verbatim.
- Follows the domain-split handler pattern — `mcp-server/gui/api-repos.ts`. New handler added in the same file.
- Follows the `POST /resource/:id/move` pattern — established by `POST /api/knowledge/:id/move` in `mcp-server/gui/api-knowledge.ts`.
- Follows the ES5-only frontend convention — no arrow functions, `let`/`const`, or template literals.
- Follows the `escapeHtml()` convention for all dynamic values in rendered HTML.

## Detailed Steps

### Step 1: Enrich `handleGetRepo()` to return `store_id`

**File:** `mcp-server/gui/api-repos.ts`

Modify `handleGetRepo()` to return the entry augmented with `store_id` when in multi-store mode. The function already calls `findEntryInStores()` which returns `{ storePath, entry }`. Resolve `storePath` to a `store_id` by matching against `getStoreRouter().getAllStores()`.

Change the return type from `RepositoryEntry` to `RepositoryEntry & { store_id?: string }`. Do not modify `RepositoryEntrySchema` — the `store_id` is a runtime-only enrichment, not a storage concern.

### Step 2: Add `handleMoveRepo()` endpoint

**File:** `mcp-server/gui/api-repos.ts`

Add a new exported async function `handleMoveRepo(ledgerRoot: string, repoId: string, body: unknown)`:

1. Parse body with a new `RepoMoveBodySchema`: `{ target_store_id: z.string() }`.
2. Validate multi-store mode is active (`isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`). If not, return a `VALIDATION_ERROR` ("Move is only available in multi-store mode").
3. Locate the source entry via `findEntryInStores(ledgerRoot, repoId)`. Throw `NOT_FOUND` if absent.
4. Resolve `target_store_id` to a store path via `getStoreRouter().getAllStores()`. Throw `VALIDATION_ERROR` if the target store doesn't exist.
5. If the source store path equals the target store path, return the entry unchanged (no-op).
6. Load the target registry. Check for ID conflicts (the same `repoId` already exists in the target store). Throw `VALIDATION_ERROR` if conflicting.
7. Check for folder_name conflicts in the target registry using `assertNoFolderNameConflicts()`.
8. Remove from source registry, add to target registry (with `last_modified` updated), save both.
9. Return the moved entry augmented with `store_id: target_store_id`.

This follows the CLI `storeRepoMove()` logic but uses ID-based lookup (not folder_name-based) and is async.

### Step 3: Wire the move route in `server.ts`

**File:** `mcp-server/gui/server.ts`

Add a new route to `buildRepoRoutes()`:

```
POST /api/repos/:repoId/move → handleMoveRepo(ledgerRoot, repoId, body)
```

This must be placed in Section A (body-parsing routes), before the `GET /api/repos/:repoId` route in Section B to ensure correct dispatch.

Import `handleMoveRepo` from `api-repos.ts`.

> After wiring the route, confirm `mcp-server/tests/gui/route-table.test.ts` still passes — it validates named-group usage and method+path uniqueness across the entire route table.

### Step 4: Add `API.moveRepo()` to the API client

**File:** `mcp-server/gui/public/api-client.js`

Add to the Repos group:

```js
moveRepo: function (repoId, targetStoreId) {
  return request('POST', '/repos/' + encodeURIComponent(repoId) + '/move', {
    target_store_id: targetStoreId
  });
}
```

### Step 5: Refactor `strategy.js` — Add `renderRepoModal()`

**File:** `mcp-server/gui/public/views/strategy.js`

Add a new function `renderRepoModal(mode, repo, stores, onSaved, prefill)`:

- `mode`: `'add'` or `'edit'`
- `repo`: null (add) or repo object from `API.getRepo()` (edit)
- `stores`: array from `API.getStores()` (may be empty/single in single-store mode)
- `onSaved`: callback invoked after successful save/create to refresh the list
- `prefill`: optional object `{ id?, label?, folder_names? }` — pre-populates add-mode fields when opening from a Register button; ignored in edit mode and when null/undefined

**Modal structure** (reuses `.cs-modal-*` CSS classes):
- **Header:** "Add Repository" or "Edit Repository"
- **Body fields (add mode):** ID input, Label input, Folder Names (same add/remove pattern as current detail page), Store dropdown (multi-store only)
- **Body fields (edit mode):** ID (read-only, `.cs-modal-readonly`), Label input, Folder Names (add/remove), Store dropdown (multi-store only, pre-selected to current `repo.store_id`), Vision — Short-term textarea, Vision — Mid-term textarea, Vision — Long-term textarea
- **Footer:** Save/Add button, Cancel button
- **Error area:** `<div id="repo-modal-error">` for API error display
- **Element IDs:** All elements in the repo modal must use the `repo-modal-` prefix (e.g., `repo-modal-overlay`, `repo-modal-save-btn`, `repo-modal-cancel-btn`, `repo-modal-close-btn`). The `.cs-modal-*` CSS classes are shared for visual consistency, but the element IDs must be distinct from `config-stores.js`'s `cs-modal-*` IDs to prevent DOM collision if both modals are ever mounted in the same session.

**Folder Names widget:** Reuse the existing pattern from `renderStrategyDetail()` — a list of `<input>` fields with Remove buttons, plus an "Add folder name" input with Add button. The add/remove logic is contained within the modal. All `.folder-name-input` queries must be scoped to the modal container (`modal.querySelectorAll('.folder-name-input')`, not `document.querySelectorAll(...)`) to avoid colliding with page inputs visible beneath the overlay.

**Save logic (add mode):**
1. Validate: ID required, at least one folder name.
2. Build payload: `{ id, label, folder_names, store_id? }`.
3. Call `API.createRepo(payload)`.
4. On success: close modal, invoke `onSaved()`.
5. On error: display in `#repo-modal-error`.

**Save logic (edit mode):**
1. Validate: at least one folder name.
2. Determine if the store changed (compare `repo.store_id` with selected store value).
3. Build update payload: `{ label, folder_names, vision }`.
4. Call `API.updateRepo(repoId, payload)` first. On failure, display error and abort.
5. If store changed: call `API.moveRepo(repoId, newStoreId)`. On failure, display error and abort.
6. On success: close modal, invoke `onSaved()`.

> **Ordering rationale (from design review):** Field update is applied before the move so that a partial failure leaves the user's typed values persisted. If `updateRepo` succeeds but `moveRepo` fails, the user re-opens the modal, sees the already-updated field values, and only needs to re-select the target store. `handleUpdateRepo()` uses `findEntryInStores()` on every call, so it locates the repo by ID at its current (pre-move) store — updating before moving is safe.

**Modal lifecycle:**
- Focus trap (Tab/Shift+Tab cycling within modal focusable elements).
- Close on Escape key.
- Close on overlay click.
- WCAG focus restoration: save `document.activeElement` before opening; restore on close.
- Enter key in non-textarea inputs submits the modal.
- Remove overlay element on close.

### Step 6: Update `renderStrategyList()` — Replace inline form with modal triggers

**File:** `mcp-server/gui/public/views/strategy.js`

1. **Remove the inline "Add Repository" card** (the `<div class="card mt-24">` containing `#add-repo-form`).
2. **Add an "Add Repository" button** in the page header area (alongside the toggle).
3. **Wire the Add button** to call `renderRepoModal('add', null, stores, function () { refreshTable(checked); })`.
4. **Wire table row clicks** to open the edit modal instead of navigating to `#/strategy/:repoId`. Replace the `<a href="#/strategy/...">` anchor in the label cell with `<button class="btn-link" data-edit-repo="[id]">` so keyboard users retain Tab + Enter access. Wire click handlers on all such buttons:
   - Fetch the repo via `API.getRepo(repoId)`.
   - Open `renderRepoModal('edit', repo, stores, function () { refreshTable(checked); })`.
5. **Update `wireRegisterButtons()`** to open the add modal with pre-filled values instead of scrolling to the inline form. Derive the pre-fill object from `data-register-folder` using the existing `sanitiseSlug()` logic: `renderRepoModal('add', null, stores, function () { refreshTable(checked); }, { id: sanitiseSlug(folderName), label: folderName, folder_names: [folderName] })`.
6. **Remove the `storeDropdown` variable** from `renderList()` — the store dropdown is now inside the modal.

### Step 7: Remove `renderStrategyDetail()` and its route

**Files:** `mcp-server/gui/public/views/strategy.js`, `mcp-server/gui/public/router.js`

1. Delete the entire `renderStrategyDetail()` function from `strategy.js`.
2. Remove the `#/strategy/:repoId` route from `router.js`. Keep the `/strategy` route.

### Step 8: Backend tests for `handleMoveRepo()`

**File:** `mcp-server/tests/gui/api-repos-store.test.ts` (extend existing file)

Add a new `describe('handleMoveRepo')` section covering:

1. **Happy path:** Move repo from store A to store B — entry disappears from source registry, appears in target registry with updated `last_modified`.
2. **No-op:** Move to same store — returns entry unchanged, no registry writes.
3. **Target store not found:** Invalid `target_store_id` → `VALIDATION_ERROR`.
4. **Repo not found:** Unknown `repoId` → `NOT_FOUND`.
5. **Single-store mode:** Move attempted → `VALIDATION_ERROR`.
6. **ID conflict in target:** Target store already has an entry with the same `id` → `VALIDATION_ERROR`.
7. **Folder name conflict in target:** Target store has an entry whose `folder_names` overlap → `VALIDATION_ERROR`.

### Step 9: Backend test for enriched `handleGetRepo()`

**File:** `mcp-server/tests/gui/api-repos-store.test.ts`

Add a test verifying `handleGetRepo()` returns `store_id` in multi-store mode and omits it in single-store mode.

## Dependencies
- Step 2 depends on Step 1 (move handler uses the same store resolution logic).
- Steps 3–4 depend on Step 2 (wiring and client need the endpoint to exist).
- Step 5 depends on Step 4 (modal save calls `API.moveRepo()`).
- Step 6 depends on Step 5 (list view uses the new modal function).
- Step 7 depends on Step 6 (detail page removed after modal replaces it).
- Steps 8–9 are independent of frontend steps; can run in parallel with Steps 5–7.

## Required Components
- `mcp-server/gui/api-repos.ts` — enriched GET, new move handler, new Zod schema
- `mcp-server/gui/server.ts` — new route in `buildRepoRoutes()`
- `mcp-server/gui/public/api-client.js` — new `moveRepo` method
- `mcp-server/gui/public/views/strategy.js` — modal function, list refactor, detail removal
- `mcp-server/gui/public/router.js` — route removal
- `mcp-server/tests/gui/api-repos-store.test.ts` — move and enriched GET tests

## Assumptions
- The `.cs-modal-*` CSS classes are generic enough to reuse without modification for the repository modal. No new CSS classes are needed.
- The move is registry-only (`.repositories.json` entries). Project data files are not relocated between stores — they remain at their original filesystem paths. This matches the CLI `storeRepoMove()` behavior.
- `handleGetRepo()` can return a superset of `RepositoryEntry` without breaking existing consumers. The frontend already handles unknown response fields gracefully.

## Constraints
- ES5-only in all `gui/public/` JavaScript — no `let`, `const`, arrow functions, or template literals.
- All dynamic values in rendered HTML must be escaped via `escapeHtml()`.
- The move is a cross-registry operation (source registry remove + target registry add). `RepoUpdateBodySchema` already contains `store_id` as an accepted-but-ignored optional field — updating via PUT cannot trigger a cross-store move, so the separate endpoint is an architectural choice, not a schema constraint.
- The modal must follow WCAG 2.1 SC 3.2.2: save the trigger element's focus before opening, restore it on close.
- Update-then-move is a two-step sequence with no atomic rollback: if `API.updateRepo()` succeeds but `API.moveRepo()` fails, the repo retains the new field values in the original store. The user can re-open the modal, verify their field changes are present, re-select the target store, and retry. This ordering is preferable to move-first because field values are preserved in the partial-failure case rather than requiring re-entry.
- The move endpoint must validate multi-store mode — reject gracefully in single-store mode rather than silently failing.

## Out of Scope
- Moving project data files between store directories (only the registry declaration moves).
- Undeclared repository support in the edit modal — undeclared repos have no registry entry and cannot be edited, only registered (which is an add operation).
- Polling / auto-refresh on the Strategy list page.
- Keyboard shortcuts beyond Escape (close) and Enter (submit).

## Acceptance Criteria

- AC-01: The inline "Add Repository" form is removed from the Strategy list page and replaced with an "Add Repository" button that opens a modal.
- AC-02: Clicking a declared repository row in the Strategy list opens an edit modal pre-filled with the repo's current field values (label, folder names, vision, and store in multi-store mode).
- AC-03: The add and edit modals share a single rendering function with mode-dependent field visibility (ID editable in add, read-only in edit; vision fields shown only in edit mode).
- AC-04: In multi-store mode, the edit modal shows a Store dropdown pre-selected to the repo's current store. Changing the store and saving triggers a move operation via `POST /api/repos/:repoId/move`.
- AC-05: The `POST /api/repos/:repoId/move` endpoint atomically moves a repository declaration from one store's registry to another, with proper validation (multi-store mode required, target store exists, no ID or folder_name conflicts in target).
- AC-06: `GET /api/repos/:repoId` returns `store_id` in the response when in multi-store mode.
- AC-07: The `#/strategy/:repoId` route and `renderStrategyDetail()` function are removed — all editing happens in the modal.
- AC-08: The "Register" button on undeclared repository rows opens the add modal with pre-filled values.
- AC-09: The modal follows the established WCAG 2.1 pattern: focus trap, close-on-Escape, close-on-overlay-click, trigger element focus restoration on close.
- AC-10: All backend move scenarios are covered by tests: happy path, no-op same-store, target not found, repo not found, single-store rejection, ID conflict, folder_name conflict.

## Testing Strategy
Backend tests use the established pattern: `vi.mock` for `store-context.js`, real temp directories for I/O, `readRegistry()` helper for post-mutation verification. Frontend testing is manual — no existing automated frontend test infrastructure for strategy.js.

## Test Plan
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` happy path (entry moves between registries) — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` no-op same store — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` invalid target store → VALIDATION_ERROR — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` repo not found → NOT_FOUND — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` single-store mode → VALIDATION_ERROR — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` ID conflict in target → VALIDATION_ERROR — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleMoveRepo` folder_name conflict in target → VALIDATION_ERROR — AC-05
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleGetRepo` returns store_id in multi-store — AC-06
- `mcp-server/tests/gui/api-repos-store.test.ts` — `handleGetRepo` omits store_id in single-store — AC-06

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `handleMoveRepo` handler, `RepoMoveBodySchema`, updated `handleGetRepo` return type, `API.moveRepo()` client method
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Update `api-repos.ts` inline annotation: add `handleMoveRepo` and `RepoMoveBodySchema` to the exports list; note enriched `handleGetRepo` return type (`RepositoryEntry & { store_id?: string }` in multi-store mode)
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add move-on-save flow description
- Root `AGENTS.md` — Update `api-repos.ts` annotation in the Cross-System Dependencies table

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Move + update is two API calls — partial failure if update fails after successful move.** | The move is a durable state change; if the subsequent update fails, the repo is in the correct store with its old field values — the user can retry the save. The error message will indicate the move succeeded but the update failed. |
| **Modal with vision textareas may feel cramped on small screens.** | The `.cs-modal` CSS uses `max-height: 90vh` with `overflow-y: auto` on the body — scrolling is built in. The `max-width` can be increased from 480px to 560px for the repo modal to accommodate the wider vision textareas. |
| **Removing the detail page route breaks existing bookmarks or shared links.** | Mitigated by the fact that the Strategy page is an admin tool with no external link sharing. The `#/strategy/:repoId` hash was never documented or exposed as a stable URL. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Multi-file change spanning backend and frontend with a new API endpoint, schema, route wiring, modal refactor, route removal, and test suite — benefits from formal QA and review stages.
