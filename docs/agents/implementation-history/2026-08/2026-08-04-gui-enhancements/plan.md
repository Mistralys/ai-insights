# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context

The repository's strategic vision prioritizes reducing friction in daily usage. These GUI enhancements directly serve the short-term goal: repository sorting, filtering, and live-updating data reduce the number of manual interactions and page reloads required during normal workflow monitoring.

## Summary

Implement six GUI enhancements for the MCP server dashboard: (1) sortable repository list with default label sort, (2) store modal field reordering with path guidance notes, (3) config tab reordering, (4) project list repository filter with server-side support, (5) breadcrumb repository links that filter the project list, and (6) fix the assigned_to column not updating during live polling on project detail pages.

## Architectural Context

The MCP server GUI is a vanilla JavaScript SPA served from `mcp-server/gui/public/`. Views are module-scoped functions (`renderProjectList`, `renderStrategyList`, etc.) that build HTML strings and wire event handlers. The project detail page uses a snapshot/diff/patch pattern for incremental DOM updates during polling, defined across `project-detail.js` and `project-detail-helpers.js`. The backend API handlers live in `mcp-server/gui/api.ts` with route wiring in `mcp-server/gui/server.ts`. Filter state is persisted via localStorage.

## Approach / Architecture

All changes are scoped to the existing GUI frontend files and one backend handler. No new files, dependencies, or architectural patterns are introduced. Each enhancement follows established patterns:

- **Sortable columns** use the `thSort()` pattern from `project-list.js`.
- **Filter dropdowns** follow the `buildRunnerOptions()` pattern with server-side counts.
- **DOM patching** extends the existing `_snapshotProjectState` / `_diffProjectState` / `_patchWpRow` chain.
- **Modal field ordering** is a straightforward HTML resequencing.
- **Server-side filtering** follows the existing `runner` filter pattern in `handleListProjects`.

## Rationale

Each enhancement addresses an observed friction point in the GUI. The changes are minimal and self-contained, following existing patterns throughout.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Repository filter location | Server-side in `handleListProjects` | Client-side JS filter | Server-side is required for correct pagination; client-side would only filter the current page's results |
| Undeclared repos in multi-store | Hide/disable the toggle | Implement multi-store filesystem scanning | Scanning every store is explicitly deferred in the codebase; hiding the non-functional toggle is the honest UX fix |
| Breadcrumb repo link target | Project list with `?repo=X` query in hash | Dedicated `/repos/{id}/projects` route | Reusing the project list with a filter avoids adding a new route and view; the filter dropdown makes the active filter visible and clearable |

## Pattern Alignment

- `thSort()` sortable header pattern — follows `mcp-server/gui/public/views/project-list.js`
- `buildRunnerOptions()` filter dropdown pattern — follows `mcp-server/gui/public/views/project-list.js`
- `_snapshotProjectState` / `_diffProjectState` DOM patch pattern — follows `mcp-server/gui/public/views/project-detail-helpers.js`
- `UI.filterBar()` filter bar composition — follows `mcp-server/gui/public/components.js`
- `localStorage` filter persistence — follows existing `SORT_KEY_STORAGE`, `STATUS_STORAGE`, `RUNNER_STORAGE` keys

## Detailed Steps

### Step 1: Strategy View — Sort repository list by label and add sortable columns

**File:** `mcp-server/gui/public/views/strategy.js`

1a. In `buildTableHtml()`, sort the `repos` array by label (case-insensitive) before building rows. Use `repos.slice().sort(...)` to avoid mutating the input.

1b. Add module-level sort state variables (`currentRepoSort = 'label'`, `currentRepoDir = 'asc'`).

1c. Replace the plain `<th>Label</th>` and `<th>ID</th>` headers with sortable headers using the `thSort()` pattern from project-list.js. The "Vision" column should remain unsortable.

1d. Wire click and keydown handlers on the table headers (after each `buildTableHtml` call) to update sort state and re-render the table via `refreshTable()`.

1e. Apply the sort in `buildTableHtml()` based on `currentRepoSort` and `currentRepoDir`. Sort by `r.label || r.id` for label, and `r.id` for ID.

### Step 2: Strategy View — Fix undeclared repositories toggle in multi-store mode

**File:** `mcp-server/gui/public/views/strategy.js`

2a. In `buildToggleHtml()`, accept an `isMultiStore` parameter. When true, disable the checkbox (`disabled`) and append a note: `"Not available in multi-store mode"`.

2b. Update the two call sites of `buildToggleHtml()` (in `renderList` and `refreshTable`) to pass the `isMultiStore` value.

### Step 3: Store Modal — Reorder fields and add path notes

**File:** `mcp-server/gui/public/views/config-stores.js`

3a. In `csRenderStoreModal()`, change the Add-mode modal body field order from `idField + pathField + dirModeField + labelField` to `idField + labelField + dirModeField + pathField`.

3b. In the `dirModeField` block for "Create new directory" mode, add a `<div class="cs-modal-dir-note">` note below the Path field (visible only when `csModalCreateDir` is true): `"The store ID will be appended as a subdirectory to this path automatically."`. Verify this by checking the `API.addStore` behavior — if the API creates a subdirectory named after the store ID inside the given path, the note is accurate. If the path is used as-is, adjust accordingly.

3c. Update the existing "Use existing directory" note for the Path field to: `"The directory must already exist and be the root containing project folders and .repositories.json."`.

3d. The note visibility toggling (via the radio change handler at L298) must account for both notes — show the create-mode note when `csModalCreateDir` is true, show the existing-mode note when false.

### Step 4: Config View — Move Stores tab after General

**File:** `mcp-server/gui/public/views/config.js`

4a. In `renderConfigPage()`, reorder the tab bar HTML from `Stores, General, Persona Models, Model Registry` to `General, Stores, Persona Models, Model Registry`.

### Step 5: Project List — Add repository filter

**Files:** `mcp-server/gui/api.ts`, `mcp-server/gui/server.ts`, `mcp-server/gui/public/api-client.js`, `mcp-server/gui/public/views/project-list.js`

**5a. Backend — Add `repository` param to `ProjectListParams`:**

In `mcp-server/gui/api.ts`:
- Add `repository?: string` to the `ProjectListParams` interface.
- Add `repo_counts: Record<string, number>` to the `ProjectListEnvelope` interface.
- In `handleListProjects()`, after the runner counts computation (Step 3), compute `repo_counts` from the search-filtered set: count projects per `repository_name`.
- After the runner filter step (Step 4b), add a Step 4c: if `repositoryFilter` is defined and non-empty, filter to projects where `p.repository_name === repositoryFilter`.
- Include `repo_counts` in the returned envelope.

**5b. Backend — Wire the query param:**

In `mcp-server/gui/server.ts`, in the `handleListProjects` call site, add `repository: query?.get('repository') ?? undefined` to the params object.

**5c. Frontend — Pass the filter:**

In `mcp-server/gui/public/views/project-list.js`:
- Add `var REPO_STORAGE = 'mcp-repo-filter';` and `var currentRepo = localStorage.getItem(REPO_STORAGE) || '';`.
- In `load()`, add `repository: currentRepo || undefined` to the `API.getProjects()` params.
- Add a `buildRepoOptions(repoCounts)` function following the `buildRunnerOptions` pattern. Use `repoFolderMap` to resolve folder names to labels. Include an "All" option.
- Add a `{ type: 'select', id: 'repo-filter', label: 'Repository:', optionsHtml: buildRepoOptions(repoCounts) }` entry to the `UI.filterBar()` call, positioned after the Status filter.
- In the `plFb.bind()` callback, handle `repo-filter` state changes: update `currentRepo`, persist to localStorage, reset page, and reload.

**5d. Handle incoming hash parameter:**

In `renderProjectList()`, at the top of the function, parse `window.location.hash` for a `?repo=` query parameter. If present, set `currentRepo` to the decoded value and persist it to localStorage. This enables the breadcrumb link (Step 6) to pre-select the repository filter.

### Step 6: Project Detail Breadcrumbs — Link repo to filtered project list

**File:** `mcp-server/gui/public/utils.js`

6a. Change the `breadcrumb().repo()` method's `href` from `'#/strategy'` to `'#/?repo=' + encodeURIComponent(repoId)`. This navigates to the project list with the repository filter pre-selected.

### Step 7: Project Detail — Fix assigned_to not updating during polling

**Files:** `mcp-server/gui/public/views/project-detail-helpers.js`, `mcp-server/gui/public/views/project-detail.js`

**7a. Add `assigned_to` to snapshot:**

In `_snapshotProjectState()` in `project-detail-helpers.js`:
- Add `assigned_to: wp.assigned_to || ''` to the `wpStatuses[id]` object alongside `status` and `pipelineStages`.
- When enriching from overview data, propagate `entry.assigned_to` into the wpStatuses entry as well.

**7b. Add `assigned_to` to diff:**

In `_diffProjectState()` in `project-detail-helpers.js`:
- After the pipeline stages comparison, add an `assigned_to` comparison:
  ```
  if (prevWp.assigned_to !== nextWp.assigned_to) {
    markData('wp.' + id + '.assigned_to', prevWp.assigned_to, nextWp.assigned_to);
  }
  ```

**7c. Add CSS class to assigned-to cell:**

In `project-detail.js`, in the WP row rendering (around L632), add a `wp-assigned-cell` class to the assigned-to `<td>`:
```
'<td class="wp-assigned-cell">' + escapeHtml(wp.assigned_to || '—') + '</td>'
```

**7d. Extend `_patchWpRow` to update assigned_to:**

In `project-detail.js`, extend the `_patchWpRow(wpId, newStatus, newPipelineTrack)` function signature to accept a fourth parameter `newAssignedTo`:
```
function _patchWpRow(wpId, newStatus, newPipelineTrack, newAssignedTo)
```
Add a block after the pipeline cell patch that updates `.wp-assigned-cell`:
```
var assignedCell = row.querySelector('.wp-assigned-cell');
if (assignedCell && newAssignedTo !== undefined) {
  var newAssignedHtml = escapeHtml(newAssignedTo || '—');
  if (assignedCell.innerHTML !== newAssignedHtml) {
    assignedCell.innerHTML = newAssignedHtml;
  }
}
```

**7e. Pass assigned_to through the poll handler:**

In the poll handler (around L477), where `_patchWpRow` is called, include `wpEntry.assigned_to` as the fourth argument:
```
_patchWpRow(id, wpEntry.status, newTrackHtml, wpEntry.assigned_to);
```

Also add `assigned_to` change detection to the condition that triggers patching:
```
var assignedChanged = !!changes['wp.' + id + '.assigned_to'];
if (statusChanged || pipelineChanged || assignedChanged) {
```

## Dependencies

- Step 6 depends on Step 5 (breadcrumb links to filtered project list require the repository filter).
- All other steps are independent and can be implemented in any order.

## Required Components

- `mcp-server/gui/public/views/strategy.js` — Steps 1, 2
- `mcp-server/gui/public/views/config-stores.js` — Step 3
- `mcp-server/gui/public/views/config.js` — Step 4
- `mcp-server/gui/api.ts` — Step 5a
- `mcp-server/gui/server.ts` — Step 5b
- `mcp-server/gui/public/api-client.js` — (no change needed; `buildQueryString` already forwards all params)
- `mcp-server/gui/public/views/project-list.js` — Step 5c, 5d
- `mcp-server/gui/public/utils.js` — Step 6
- `mcp-server/gui/public/views/project-detail-helpers.js` — Step 7a, 7b
- `mcp-server/gui/public/views/project-detail.js` — Step 7c, 7d, 7e

## Assumptions

- The store modal's "Create new directory" mode appends the store ID as a subdirectory to the given path (to be verified during implementation — adjust the note text accordingly).
- The `repo_counts` computation uses `repository_name` (raw folder name) as the key, matching the `repository` filter parameter semantics.
- The breadcrumb hash query `?repo=X` format is compatible with the SPA router's `dispatch()` function, which only inspects the path portion of the hash.

## Constraints

- No new files or dependencies.
- All changes follow existing GUI patterns.
- The undeclared repos feature remains unsupported in multi-store mode — only the misleading UI toggle is fixed.

## Out of Scope

- Implementing multi-store undeclared repository scanning (explicitly deferred in the codebase).
- Adding repository filter to non-project-list views.
- Sortable columns in the store list or other tables beyond the strategy repo table.

## Acceptance Criteria

- AC-01: The repository list on the Strategy page is sorted by label (ascending) by default.
- AC-02: The "Label" and "ID" columns in the repository list are clickable and toggle ascending/descending sort.
- AC-03: In multi-store mode, the "Show undeclared repositories" checkbox is disabled with an explanatory note.
- AC-04: The Store Add modal field order is: ID, Label, Directory, Path.
- AC-05: In "Create new directory" mode, a note appears below the Path field explaining automatic subdirectory creation.
- AC-06: In "Use existing directory" mode, a note appears below the Path field explaining that the folder must contain project folders and `.repositories.json`.
- AC-07: The Configuration page tab order is: General, Stores, Persona Models, Model Registry.
- AC-08: The project list has a "Repository" filter dropdown that filters projects by repository name.
- AC-09: The Repository filter dropdown shows only repositories that have at least one project, with counts.
- AC-10: The Repository filter selection is persisted in localStorage.
- AC-11: Navigating to `#/?repo=X` pre-selects the repository filter.
- AC-12: The breadcrumb repository component on project detail pages links to the project list filtered by that repository.
- AC-13: The "Assigned To" column in the project detail WP table updates dynamically during polling without requiring a page reload.

## Testing Strategy

The GUI has existing Vitest tests for the project detail helpers (`project-detail-helpers.test.ts`). The snapshot/diff changes (Step 7) should have test coverage. Steps 1–6 are primarily HTML rendering changes that are best validated by manual testing in the browser. The backend filter (Step 5a) should be covered by a unit test for `handleListProjects`.

## Test Plan

- `mcp-server/tests/gui/project-detail-helpers.test.ts` — Add tests for `assigned_to` in `_snapshotProjectState` and `_diffProjectState`: verify that assigned_to is captured in snapshots and that changes are detected as data-type diffs — covers AC-13
- `mcp-server/tests/gui/api-list-projects.test.ts` (or equivalent existing test file) — Add test for `handleListProjects` with `repository` filter param: verify filtering returns only matching projects and that `repo_counts` is populated correctly — covers AC-08, AC-09

## Documentation Updates

- No manifest or documentation updates required. These are GUI-only changes with no new APIs, public interfaces, or architectural patterns. The existing file tree, API surface, and constraints remain unchanged.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Hash query parsing conflicts with router** | The router's `dispatch()` only uses regex matching on the path portion; verify `?repo=X` does not interfere with route matching. If it does, strip query params before dispatching. |
| **Store modal path note accuracy** | Verify the `API.addStore` behavior during implementation — check whether the API creates a subdirectory or uses the path as-is. Adjust note text accordingly. |
| **Repository filter dropdown performance** | The `repo_counts` computation iterates the search-filtered project list once — negligible overhead on top of the existing enrichment pass. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are within the GUI frontend and one backend handler, following well-established patterns with no cross-project or architectural concerns.
