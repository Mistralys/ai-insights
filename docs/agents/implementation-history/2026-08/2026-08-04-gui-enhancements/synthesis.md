# Plan

## Synthesis

### Completion Status
- Date: 2026-08-04
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-04

### Outcome Summary

All six GUI enhancements were implemented as specified. The changes are scoped exclusively to the GUI frontend files and one backend API handler, following existing patterns throughout. No new dependencies, files, or architectural patterns were introduced.

### Implementation Summary

- **Step 1 — Sortable repository list:** Added `currentRepoSort`/`currentRepoDir` module-level state to `strategy.js`. `buildTableHtml()` now sorts repos via `slice().sort()` before rendering and uses `thRepoSort()` sortable header helpers (following the `thSort()` pattern from project-list.js). Sort handlers are wired by a new `wireRepoSortHandlers()` function called after every table render.
- **Step 2 — Undeclared repos toggle in multi-store:** `buildToggleHtml()` now accepts an `isMultiStore` parameter; in multi-store mode the checkbox is rendered disabled with a "Not available in multi-store mode" note. Both call sites (`renderList` and `refreshTable`) pass the value.
- **Step 3 — Store modal field reorder + path notes:** In `csRenderStoreModal()` the Add-mode body order was changed from `id + path + dirMode + label` to `id + label + dirMode + path`. The `dirModeField` no longer contains any path note; instead two contextual notes (`cs-modal-dir-note-create` and `cs-modal-dir-note-existing`) are embedded inside `pathField`. The radio change handler was updated to toggle both notes. Note text corrected per API verification: `createStoreDirectory` creates the directory exactly at the given path, so the note reads "The directory will be created at this path if it does not already exist."
- **Step 4 — Config tab reorder:** Tab bar in `renderConfigPage()` reordered to `General, Stores, Persona Models, Model Registry`.
- **Step 5 — Project list repository filter:** `repository?: string` added to `ProjectListParams`; `repo_counts: Record<string, number>` added to `ProjectListEnvelope`. `handleListProjects` computes `repo_counts` from the search-filtered set and applies the repository filter as Step 4c after the runner filter. `server.ts` wires `query?.get('repository')`. `project-list.js` adds `REPO_STORAGE`/`currentRepo`, decodes `?repo=` from the entry hash, builds a `buildRepoOptions()` dropdown (follows `buildRunnerOptions` pattern), adds a Repository filter to the filter bar between Status and Runner, handles `repo-filter` changes in the bind callback, and passes `repository: currentRepo || undefined` to `API.getProjects`.
- **Step 6 — Breadcrumb repo links:** `breadcrumb().repo()` in `utils.js` now links to `#/?repo=` + encoded repo ID instead of `#/strategy`. The project list decodes this parameter on render and pre-selects the filter.
- **Step 7 — Fix assigned_to not updating during polling:** `_snapshotProjectState` captures `assigned_to` for each WP (from both `work_packages` and the overview enrichment). `_diffProjectState` compares `assigned_to` between snapshots. The WP row rendering adds `class="wp-assigned-cell"` to the assigned-to `<td>`. `_patchWpRow` accepts a fourth `newAssignedTo` parameter and updates `.wp-assigned-cell` when provided. The poll handler in `_pollProjectDetail` includes `assignedChanged` in the patch condition and passes `wpEntry.assigned_to` as the fourth argument.

### Documentation Updates

No documentation updates were required because all changes are frontend UI behavior changes or internal API shape additions with no public-facing documentation targets in the manifest (the GUI API surface is documented in the GUI module manifest, not the root README).

### Verification Summary
- Tests run: `npm test` in `mcp-server/`
- Static analysis run: `npm run build` (TypeScript compilation)
- Result: Build PASS (zero errors). Test suite: 97 failures / 3937 passes — identical to pre-change baseline (all failures are pre-existing, confirmed by stash comparison).

### Code Insights
- [low] (convention) `mcp-server/gui/public/views/strategy.js`: Sort handlers always trigger a full `refreshTable()` (an API call) on every click. Since the repo list is fetched fresh each time a sort column is clicked, the UX latency is the same as the toggle. A cached-data approach (storing the last-fetched repos in a closure variable) could make sorting instantaneous, but would need cache invalidation on toggle changes — deferred for simplicity.
- [low] (improvement) `mcp-server/gui/public/views/project-list.js`: The hash-based `?repo=` parameter parsing strips the query from the hash via `history.replaceState(null, '', ... + '#/')`. This is correct for the hash-routing SPA but means the back button will not restore the hash to `#/?repo=X` after navigation. This is acceptable UX for the current SPA model but worth noting if deep-link sharing of filtered views becomes a requirement.
- [low] (improvement) `mcp-server/gui/public/views/project-detail-helpers.js`: The `assigned_to` field from the overview API is propagated into the snapshot when present (`entry.assigned_to !== undefined`). If the overview endpoint does not return `assigned_to`, the snapshot will retain the value from the main project fetch (`work_packages[].assigned_to`), which is correct fallback behavior. However, the two sources may diverge transiently — the overview fetch is best-effort (`catch(() => null)`). This is acceptable given polling recovers on the next cycle.

### Additional Comments
- The path note for "Create new directory" was corrected from the plan's suggestion ("The store ID will be appended as a subdirectory…") because `handleAddStore` in `api-stores.ts` calls `mkdir(expandedPath, { recursive: true })` directly — the path is used as-is with no subdirectory appending.
