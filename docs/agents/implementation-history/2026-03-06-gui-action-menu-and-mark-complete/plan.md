# Plan

## Summary

Two GUI enhancements for the MCP Server Dashboard SPA. First, the per-row action buttons in the project list table will be collapsed into a compact kebab (⋮) dropdown menu to reduce visual noise and row height. Second, the Reset Project modal in the project detail screen will gain a "Mark Project as Complete" bulk action that forcibly sets all non-CANCELLED work packages and the project itself to `COMPLETE` status — useful when a project is finished but its WP pipeline state is inconsistent or incomplete.

---

## Architectural Context

The GUI is a vanilla-JS SPA served by `mcp-server/gui/server.ts` (http server) using `mcp-server/gui/api.ts` (pure async handlers). The front-end lives in `mcp-server/gui/public/`:

| File | Role |
|------|------|
| `views/project-list.js` | Renders the project table; builds per-row action buttons inline in HTML strings via `buildTable()` |
| `views/project-detail.js` | Renders the project detail page (header, WP table, comments) and the Reset Project modal via `showResetModal()` |
| `api-client.js` | Thin AJAX wrapper; one method per API endpoint |
| `styles.css` | All styling — no CSS framework |
| `gui/api.ts` | Handler functions: `handleArchiveProject`, `handleDeleteProject`, `handleResetProject`, etc. |
| `gui/server.ts` | HTTP routing — maps method + path segments to handler calls |
| `src/utils/project-reset.ts` | `applyProjectReset()` — bulk WP mutation under `withLock`; establishes the pattern for the new complete handler |

Relevant patterns:
- Action buttons use `data-action` attributes + event delegation in `project-list.js`.
- The reset modal is built as an injected `div` via `insertAdjacentHTML`; its state is held in a local `state` object.
- Bulk mutations on WPs follow the `withLock(store.storageDir, async () => { ... })` pattern established in `project-reset.ts`.
- New API routes follow the shape in `server.ts`: a `POST /api/projects/:slug/<action>` segment check returning a handler closure.

---

## Approach / Architecture

### Feature 1 — Kebab action menu in project list

Replace the `<td>` that currently contains multiple inline `<button>` and `<a>` elements with a single **kebab trigger button** (⋮) that, on click, opens an absolutely-positioned dropdown listing the same actions (View, Archive, Unarchive, Delete).

- **No new files** — changes confined to `project-list.js` and `styles.css`.
- The dropdown is a `div.action-menu` inside a `div.action-menu-wrapper` (position: relative). The trigger toggles a `.is-open` class on the wrapper; CSS makes the menu visible.
- **One open at a time**: a module-level variable tracks the currently open wrapper. Opening a second one closes the first.
- **Close-on-blur**: a single `mousedown` listener on `document` closes any open menu when a click lands outside.
- **Close on scroll**: `scroll` listener on the table wrapper closes any open menu (prevents position drift).
- The existing `data-action` event delegation pattern is preserved; only the HTML structure around it changes.
- The "View" link stays as the first menu item so the row's primary action remains discoverable.
- Accessibility: the trigger has `aria-haspopup="menu"` and `aria-expanded`; menu items are `role="menuitem"`.

### Feature 2 — Mark Project as Complete (via reset modal)

Add a **"Mark All as Complete"** button to the reset modal bulk-controls bar. When clicked, it:

1. Sets a `markCompleteMode` flag in local modal state.
2. Replaces the modal summary line with a distinct warning (e.g., _"All X non-cancelled WPs will be forced to COMPLETE — Project → COMPLETE"_).
3. Changes the "Apply Reset" button label to **"Mark as Complete"**.
4. On confirm, calls a new `API.markProjectComplete(slug)` method instead of `applyProjectReset`.

**Backend (`api.ts`)** — new `handleMarkProjectComplete`:
- Acquires `withLock` on `store.storageDir`.
- Reads `rootIndex` + all WP detail files (same pattern as `applyProjectReset`).
- Sets `status = 'COMPLETE'` on every non-`CANCELLED` WP; writes each WP file.
- Updates the root index: sets every WP entry's status to `COMPLETE`, sets `rootIndex.status = 'COMPLETE'`.
- Calls `store.writeProjectMeta('', 'COMPLETE', {})` to sync `.meta.json`.
- Appends a project comment summarizing the action (consistent with `applyProjectReset`).
- Returns `{ marked_complete: true, work_packages_completed: string[], project_comment_added: string }`.

**Server (`server.ts`)** — new route:
```
POST /api/projects/:slug/complete
```
Follows the same bodyless-POST pattern as `/archive` and `/unarchive`.

**API client (`api-client.js`)**:
```js
markProjectComplete: function (slug) {
  return request('POST', '/projects/' + encodeURIComponent(slug) + '/complete');
}
```

---

## Rationale

- **Kebab menu**: Multiple buttons in a narrow table cell are visually cluttered and can cause line-wrapping at moderate viewport widths. A single dropdown trigger is a well-established pattern for per-row actions in data tables.
- **CSS-only toggle (no library)**: The existing codebase has zero front-end dependencies beyond `marked.js`. A lightweight data-attribute + class-toggle approach keeps parity with that philosophy.
- **Mark Complete in reset modal**: The reset modal is already the designated place for bulk WP state corrections, so surfacing a "nuclear" override here is contextually appropriate. It avoids adding a second top-level button to the already-busy page header.
- **Separate API endpoint (`/complete`)**: Semantically distinct from `/reset` (which analyses breakage and selectively reopens WPs). Keeping them separate avoids overloading the reset payload schema and makes the operation independently auditable.
- **`withLock` bulk write**: Consistent with `applyProjectReset` — single lock acquisition for the whole batch prevents partial writes if the process is interrupted.

---

## Detailed Steps

### Feature 1 — Kebab menu

1. **`styles.css`** — Add styles for:
   - `.action-menu-wrapper` — `position: relative; display: inline-block`
   - `.action-menu-btn` — icon-only button, neutral style, `aria-haspopup="menu"`
   - `.action-menu` — `position: absolute; right: 0; top: 100%; z-index: 200; min-width: 130px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow); display: none`
   - `.action-menu-wrapper.is-open .action-menu` — `display: block`
   - `.action-menu-item` — `display: block; padding: 8px 14px; ...` hover state
   - `.action-menu-item.danger` — destructive color for Delete

2. **`views/project-list.js` — `buildTable()`** — Replace the `<td>` action cell:
   - Remove inline `deleteBtn`, `archiveBtn`, `unarchiveBtn` variables.
   - Build a single `.action-menu-wrapper` containing:
     - A `<button class="action-menu-btn" aria-haspopup="menu" aria-expanded="false">⋮</button>`
     - A `<div class="action-menu" role="menu">` with items:
       - `<a role="menuitem" href="...">View</a>`
       - `<button role="menuitem" data-action="archive" ...>Archive</button>` (conditional)
       - `<button role="menuitem" data-action="unarchive" ...>Unarchive</button>` (conditional)
       - `<button role="menuitem" data-action="delete" class="action-menu-item danger" ...>Delete</button>` (conditional)

3. **`views/project-list.js` — event wiring in `render()`**:
   - Add a delegated `mousedown` handler on `app` that toggles `.is-open` on the clicked wrapper (and closes any previously open wrapper).
   - Register a single `mousedown` on `document` to close open menus on outside click.
   - The existing `data-action` delete/archive/unarchive handlers remain — they only need their `e.stopPropagation()` calls to also close the parent menu after action.

### Feature 2 — Mark as Complete

4. **`src/utils/project-reset.ts`** (or `gui/api.ts`) — new exported function `markProjectComplete`:
   ```typescript
   export async function markProjectComplete(
     store: LedgerStore,
     slug: string
   ): Promise<MarkProjectCompleteResult>
   ```
   - Acquires `withLock(store.storageDir, ...)`.
   - Reads rootIndex; iterates `rootIndex.work_packages`.
   - For each non-`CANCELLED` WP entry: reads WP detail, sets `status = 'COMPLETE'`, writes WP.
   - Updates rootIndex WP entries' statuses; sets `rootIndex.status = 'COMPLETE'`; calls `store.writeRootIndex(rootIndex)`.
   - Calls `store.writeProjectMeta('', 'COMPLETE', {})`.
   - Appends a project comment (agent: `gui`, type: `observation`, note summarising how many WPs were completed).
   - Returns `{ marked_complete: true, work_packages_completed: string[], project_comment_added: string }`.
   - Export interface `MarkProjectCompleteResult`.

5. **`gui/api.ts`** — new handler `handleMarkProjectComplete`:
   - Calls `markProjectComplete(store, slug)`.
   - Follows same guard pattern: `assertSafeSlug`, confirm project exists, then call utility.
   - Guard: if project is already `ARCHIVED`, throw `FORBIDDEN` (consistent with archive/delete guards).

6. **`gui/server.ts`** — new route:
   - Import `handleMarkProjectComplete`.
   - Add guard block:
     ```
     if (method === 'POST' && rest.length === 3 && rest[0] === 'projects' && rest[2] === 'complete')
     ```
   - Return `() => handleMarkProjectComplete(ledgerRoot, slug)`.

7. **`gui/public/api-client.js`** — add:
   ```js
   markProjectComplete: function (slug) {
     return request('POST', '/projects/' + encodeURIComponent(slug) + '/complete');
   },
   ```

8. **`views/project-detail.js` — `showResetModal()`**:
   - Add a `markCompleteMode` boolean to local state (initially `false`).
   - Add **"Mark All as Complete"** button to `.reset-bulk-controls` HTML.
   - Wire `click` handler: toggle `markCompleteMode = true`; call `updateSummary()`.
   - Adapt `buildSummary()`:  when `markCompleteMode`, return a warning string (e.g., `"⚠ All non-cancelled WPs → COMPLETE — Project → COMPLETE"`).
   - Adapt "Apply Reset" button: when `markCompleteMode`, label changes to **"Mark as Complete"**, styling changes to `btn-primary` (already the class, no change needed).
   - Adapt the apply-click handler: when `markCompleteMode`, call `API.markProjectComplete(slug)` instead of `API.applyProjectReset`; on success, show the same toast + refresh.
   - Add a "Cancel override" affordance: clicking "Mark All as Complete" a second time (or a separate "Reset to Manual" link) reverts `markCompleteMode = false`.

---

## Dependencies

- No new npm packages required.
- `withLock` from `src/storage/file-lock.ts` — already used in `project-reset.ts`.
- `LedgerStore` from `src/storage/ledger-store.ts` — already used.

---

## Required Components

**Modified (existing files):**
- `mcp-server/gui/public/styles.css` — dropdown styles
- `mcp-server/gui/public/views/project-list.js` — kebab menu HTML + event wiring
- `mcp-server/gui/public/views/project-detail.js` — reset modal additions
- `mcp-server/gui/public/api-client.js` — new `markProjectComplete` method
- `mcp-server/gui/api.ts` — new `handleMarkProjectComplete` handler
- `mcp-server/gui/server.ts` — new `/complete` route

**New or extended (TypeScript utility):**
- `mcp-server/src/utils/project-reset.ts` — new `markProjectComplete` function + `MarkProjectCompleteResult` interface (preferred location for consistency with `applyProjectReset`; alternatively the handler can be self-contained in `api.ts` if the engineer judges the logic too simple to warrant extraction)

---

## Assumptions

- The `⋮` kebab pattern is acceptable — no explicit icon library is required; a Unicode character or a CSS `::after` pseudo-element suffices.
- "Mark as Complete" skips all normal pipeline-stage validation intentionally — it is a manual override, not a workflow step.
- A project that is already `ARCHIVED` should not be mark-completable from the GUI (it must be unarchived first). A project that is already `COMPLETE` can still be re-confirmed (idempotent).
- The reset modal is always opened via `analyzeProjectReset`, so when "Mark as Complete" is invoked from inside the modal, the project slug is already validated and accessible.
- The `markProjectComplete` function does not need to update individual WP pipeline records (such as appending a synthetic PASS pipeline stage) — it only updates the top-level `status` field of each WP. This keeps the implementation simple and avoids polluting pipeline history.

---

## Constraints

- STDIO discipline: `handleMarkProjectComplete` and `markProjectComplete` must never write to `process.stdout`.
- Atomic writes: all WP + rootIndex writes inside `withLock` — no partial-commit state.
- No new npm dependencies.
- The existing CSS variable palette (`--color-surface`, `--color-border`, etc.) must be used for the dropdown; no hardcoded colours.
- Dropdown z-index must exceed the table's `overflow-x: auto` wrapper — use at least `z-index: 200` and ensure the table wrapper does not clip with `overflow: hidden`. (The current `.table-wrapper` only has `overflow-x: auto`, so this should be safe, but the engineer should verify at build time.)

---

## Out of Scope

- Adding a "Mark as Complete" button directly to the project detail page header (outside the reset modal).
- Marking individual work packages as complete from the list view.
- Undo / revert for the mark-complete action.
- Auto-triggering archive after mark-complete.
- Any changes to the Work Package detail view (`work-package.js`).
- Changes to the MCP tools layer (TypeScript tools in `src/tools/`).

---

## Acceptance Criteria

**Feature 1 (Kebab menu):**
- [ ] Each project row in the list has a single `⋮` button replacing the previous multi-button cell.
- [ ] Clicking the `⋮` button opens a dropdown with the same conditional actions (View, Archive/Unarchive, Delete) that were previously shown as separate buttons.
- [ ] Only one dropdown is open at any time; clicking a second row's `⋮` closes the first.
- [ ] Clicking outside any dropdown (or pressing Escape) closes it.
- [ ] All existing delete / archive / unarchive actions continue to function identically.
- [ ] The Actions column visually narrows — the table row height does not increase.

**Feature 2 (Mark as Complete):**
- [ ] The reset modal's bulk controls bar contains a "Mark All as Complete" button.
- [ ] Activating it updates the summary to clearly convey the override intent.
- [ ] The apply button, when in Mark Complete mode, calls `POST /api/projects/:slug/complete`.
- [ ] The backend sets all non-CANCELLED WPs to `COMPLETE` and sets project status to `COMPLETE`.
- [ ] A project comment is recorded documenting the action.
- [ ] On success, the modal closes and the detail page refreshes showing the new COMPLETE status.
- [ ] An already-ARCHIVED project returns a meaningful error (FORBIDDEN).

---

## Testing Strategy

- **Feature 1**: Manual visual verification in browser — open the project list, confirm layout, verify all three conditional buttons appear correctly in the menu for projects in COMPLETE, ARCHIVED, and ACTIVE states. Verify outside-click and multi-menu closure.
- **Feature 2 (backend)**: Add a unit test in `tests/utils/` (or `tests/integration/`) mirroring the existing `project-reset` test structure:
  - Given a project with WPs in READY, IN_PROGRESS, COMPLETE, and CANCELLED states, calling `markProjectComplete` sets all non-CANCELLED WPs and the project to COMPLETE.
  - CANCELLED WPs remain unchanged.
  - The function is idempotent (calling twice on an already-COMPLETE project succeeds without error).
- **Feature 2 (API route)**: Verify the new `POST /api/projects/:slug/complete` route in `tests/gui/` following existing GUI API test patterns.
- **Feature 2 (frontend)**: Manual test — open a project, trigger Reset modal, click "Mark All as Complete", confirm the summary warning, apply, verify the detail page shows COMPLETE.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Dropdown clipped by `overflow-x: auto` on `.table-wrapper`** | Verify at runtime; if clipped, switch to a portalled approach (append menu to `document.body` with absolute positioning calculated from the trigger's `getBoundingClientRect`) |
| **`markProjectComplete` bypasses pipeline validation** | The UI copy must clearly label this as a manual override; consider a visual warning colour on the button |
| **Partial write if process killed mid-batch WP loop** | Mitigated by `withLock`; worst case a subsequent health check will flag the remaining WPs as needing attention |
| **`writeProjectMeta` contract differences from `applyProjectReset`** | Review `writeProjectMeta` signature — it takes `(planFile, status, extra)` where `planFile=''` means "update only"; this is the same call used by `handleArchiveProject` and `handleUnarchiveProject`, so it is safe |
| **Mark Complete mode not obviously cancelable** | Provide a visible "cancel override" affordance (e.g., clicking the button again or a small ✕ label link) before a user accidentally applies |
