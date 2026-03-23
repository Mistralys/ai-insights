# Synthesis Report

**Project:** GUI Action Menu and Mark Complete  
**Date:** 2026-03-06  
**Status:** COMPLETE  
**Work Packages:** 3 / 3 COMPLETE  
**Pipeline Health:** All stages PASS across all WPs

---

## Executive Summary

This project delivered two GUI enhancements to the MCP Server Dashboard SPA. The first collapses per-row action buttons in the project list table into a compact kebab (⋮) dropdown menu. The second adds a "Mark Project as Complete" bulk action to the Reset Project modal, enabling operators to force all non-CANCELLED work packages and the project itself to `COMPLETE` status when pipeline state is inconsistent or partially stale.

All three work packages completed the full implementation → QA → code-review → documentation pipeline with PASS status and zero regressions.

---

## Work Package Outcomes

### WP-001 — Kebab Action Menu (Project List)

**Scope:** Replace per-row inline action buttons in `project-list.js` with a single ⋮ trigger opening a dropdown.

**Files modified:**
- `mcp-server/gui/public/views/project-list.js`
- `mcp-server/gui/public/styles.css`

**What was built:**
- `buildTable()` now renders a single `.action-menu-btn` trigger (⋮) per row inside a `.action-menu-wrapper` container.
- An absolutely-positioned `.action-menu` dropdown contains the same actions: View (link), Archive/Unarchive (conditional), Delete (always visible with danger styling).
- A `closeOpenMenu()` helper and `openMenuWrapper` closure variable enforce mutual exclusion — only one dropdown can be open at a time.
- A single `document` `mousedown` listener (installed once per `renderProjectList()` call) closes the open menu on outside clicks.
- A `scroll` listener on `.table-wrapper` dismisses open menus on table scroll, preventing position drift.
- `stopPropagation` on the trigger button prevents the document sentinel from immediately closing a newly opened menu.
- `aria-haspopup="menu"`, `aria-expanded`, and `role="menuitem"` are correctly wired.
- All five new CSS class families (`.action-menu-wrapper`, `.action-menu-btn`, `.action-menu`, `.action-menu-item`, `.action-menu-item.danger`) use the existing custom-property design system.

**QA:** 9/9 acceptance criteria met. 1209/1209 tests green.

**Known follow-up items (logged, non-blocking):**
1. `docHandlerInstalled` is closure-scoped per `renderProjectList()` call; each SPA navigation to the project list registers a new `document mousedown` handler. Stale handlers are benign (captured `openMenuWrapper` is always `null`) but accumulate. Fix: promote to module-level singleton.
2. No keyboard navigation inside the open menu (ArrowUp/Down, Escape). Flagged for a future accessibility pass — consistent with WAI-ARIA Menu Button pattern requirements.

---

### WP-002 — Mark Project Complete (Backend + Server)

**Scope:** Implement `markProjectComplete()` utility, `handleMarkProjectComplete` API handler, `POST /api/projects/:slug/complete` server route, and `api-client.js` method.

**Files modified:**
- `mcp-server/src/utils/project-reset.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/api-client.js`

**What was built:**
- `MarkProjectCompleteResult` interface and `markProjectComplete(store, slug)` exported from `project-reset.ts`. The function wraps all writes in `withLock()`, iterates non-CANCELLED WP summaries, writes each WP detail file with `status='COMPLETE'`, zeroes `pending_work_packages`, updates the root index to `status='COMPLETE'`, appends an `admin_action` project comment with `agent='GUI'`, then calls `store.writeRootIndex()` (which auto-syncs `.meta.json`).
- `handleMarkProjectComplete` in `api.ts` applies `assertSafeSlug`, NOT_FOUND guard, ARCHIVED FORBIDDEN (403) guard, and delegates to the utility. Import of both the function and result type added.
- `POST /api/projects/:slug/complete` route registered in `server.ts` `matchRoute()`, following the identical pattern as `/archive` and `/unarchive`.
- `markProjectComplete(slug)` added to `api-client.js` (→ POST `/projects/:slug/complete`).
- TypeScript compiles cleanly; no `process.stdout` writes in new code.

**QA:** 11/11 acceptance criteria met. 1209/1209 tests green.

**Known follow-up items (logged, non-blocking):**
1. Duplicate note-string construction — the summary text is built identically inside `withLock()` (for the project comment) and once more outside it (for the return value). A DRY fix: capture a variable inside the lock and reference it in the return.
2. `rootIndex!` non-null assertion in `api.ts` — acceptable, but could be eliminated by typing `notFound()` as returning `never`, which would benefit all handlers using the same guard pattern.
3. `void slug;` idiom used to document that the parameter is not needed beyond call-site clarity. Fine as-is; may be worth a module-level getter if the pattern recurs across additional utilities.
4. No test currently covers `POST /api/projects/:slug/complete` end-to-end via `tests/gui/api.test.ts`. Recommend extending that suite with: happy path (mixed WP statuses), 404 (missing slug), 403 (ARCHIVED project), CANCELLED exclusion.

---

### WP-003 — Mark Project Complete (Front-End UI)

**Scope:** Wire the "Mark All as Complete" toggle button and confirm path inside `showResetModal()` in `project-detail.js`.

**Files modified:**
- `mcp-server/gui/public/views/project-detail.js`

**What was built:**
- `var markCompleteMode = false` state variable injected into `showResetModal()` closure.
- `buildSummary()` returns a `⚠` warning line in mark-complete mode: "All N non-cancelled WPs will be forced to COMPLETE — Project → COMPLETE".
- A "Mark All as Complete" `btn-warning` button (id `reset-mark-complete-btn`) added to `.reset-bulk-controls`.
- Toggle click listener: first click sets `markCompleteMode=true`, relabels button to "Cancel Override", adds `.active` class; second click reverts all state.
- `updateSummary()` branches on `markCompleteMode`: active state sets apply-button label to "Mark as Complete" + enables it; inactive state restores "Apply Reset" + normal enable/disable logic.
- Apply-button click handler branches on `markCompleteMode` before the async call. Mark-complete path: calls `API.markProjectComplete(slug)` → on success: `closeModal()` + success toast + `renderProjectDetail(app, slug)` re-render; on error: error toast. Normal path: `API.applyProjectReset(slug)` unchanged.
- Apply button is re-disabled at the start of both async branches — double-submit guard.
- Pre-existing `applyProjectReset` error path used `alert()` — replaced with an error toast for UI consistency.

**QA:** 10/10 acceptance criteria met. 1209/1209 tests green.  
Success path uses SPA re-render (`renderProjectDetail`) rather than `location.reload()` — superior UX; AC's "refreshes/reloads" criterion satisfied.

**Known follow-up items (logged, non-blocking):**
1. "Mark All as Complete" toggle button has no `aria-pressed` attribute — consistent with the rest of the modal's approach but worth an accessibility pass.
2. No automated unit tests for the new UI logic — consistent with the existing coverage strategy for browser-side view JS.

---

## Documentation Updates

All manifest and changelog updates were delivered by the Documentation pipeline:

| File | Changes |
|------|---------|
| `mcp-server/docs/agents/project-manifest/api-surface.md` | New `.action-menu-*` CSS class table; updated `renderProjectList` description (kebab dropdown, close/mutual-exclusion logic, aria); added `MarkProjectCompleteResult` interface and `markProjectComplete()` to project-reset section; added `handleMarkProjectComplete` to the API handlers section and `assertSafeSlug` handler list; added `POST /api/projects/:slug/complete` to the route table; bumped API client from 13 → 14 endpoints; documented `markProjectComplete(slug)` API client method; expanded `showResetModal` description with full mark-complete mode detail |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Updated `project-detail.js` annotation with `markCompleteMode` toggle, Mark All as Complete button, force-complete behaviour, and cancel-override revert |
| `mcp-server/changelog.md` | v1.10.3 entry covering all three features (GUI action menu, backend complete handler, front-end modal enhancement) |

---

## Test Coverage Summary

| WP | Tests Passed | Tests Failed | Build |
|----|-------------|-------------|-------|
| WP-001 | 1209 | 0 | Clean |
| WP-002 | 1209 | 0 | Clean |
| WP-003 | 1209 | 0 | Clean |

The test suite is entirely Vitest unit + integration tests for the TypeScript server layer. Front-end SPA interactions (kebab dropdown, reset modal) are not covered by automated tests — consistent with the project's existing coverage strategy.

---

## Consolidated Follow-Up Recommendations

The following items are tracked in their respective pipeline observations and do not block release. They are collected here for future planning:

| Priority | Area | Item |
|----------|------|------|
| Medium | project-list.js | Stale `document mousedown` handlers accumulate across SPA navigations. Promote `docHandlerInstalled` + listener reference to module-level singletons. |
| Low | project-list.js | Add keyboard navigation (ArrowUp/Down, Escape) inside open `.action-menu` for WAI-ARIA Menu Button compliance. |
| Low | project-reset.ts | Deduplicate note-string construction across the `withLock` boundary (DRY fix). |
| Low | gui/api.ts | Type `notFound()` as returning `never` to eliminate `rootIndex!` non-null assertions across all handlers. |
| Low | project-detail.js | Add `aria-pressed` to the "Mark All as Complete" toggle button. |
| Low | tests/gui/api.test.ts | Extend GUI API tests to cover happy path + 404 + 403 + CANCELLED-exclusion for `POST /api/projects/:slug/complete`. |
| Low | E2E coverage | Consider Playwright smoke tests for kebab dropdown interactions (open/close, outside-click, scroll-dismiss, aria-expanded toggle). |

---

## Architectural Notes

- The kebab menu feature introduced no new files — all changes are confined to two existing front-end assets. The pattern (`.action-menu-wrapper` + `is-open` toggle + document sentinel) follows the same conventions as the rest of the SPA.
- The `markProjectComplete()` backend utility is a clean addition to `project-reset.ts`, following the established `withLock` + `writeRootIndex` pattern. The `writeRootIndex()` call auto-syncs `.meta.json`, so no separate `writeProjectMeta()` call was needed — this is consistent with how `applyProjectReset` works.
- The front-end modal enhancement is entirely self-contained within `showResetModal()`'s closure — `markCompleteMode` is not exposed to the outer scope, preventing any global state pollution.
- The project now has 14 documented API client methods (up from 13).
