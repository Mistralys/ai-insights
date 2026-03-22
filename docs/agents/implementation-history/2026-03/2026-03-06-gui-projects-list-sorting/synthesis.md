# Synthesis — GUI Projects List Sorting

**Project:** `2026-03-06-gui-projects-list-sorting`
**Date:** 2026-03-06
**Status:** COMPLETE — all 2 work packages passed all pipeline stages

---

## Executive Summary

This project added interactive column sorting to the Projects list table in the Ledger GUI dashboard. Users can now click any of the six data column headers (Project, Repository, % Done, Status, Created, Updated) to sort the visible rows ascending or descending. The active sort key and direction persist in `localStorage` across page reloads. The default sort on first load remains **Updated descending**, preserving prior behavior.

All changes were purely client-side — no API, backend, or schema modifications were required.

---

## What Was Built

### WP-001 — Client-Side Column Sorting Logic (`app.js` + `styles.css`)

**Files modified:**
- `mcp-server/gui/public/app.js`
- `mcp-server/gui/public/styles.css`

#### State additions

Two new closure variables inside `renderProjectList()` hold the active sort state:

```js
var SORT_KEY_STORAGE = 'mcp-sort-key';
var SORT_DIR_STORAGE = 'mcp-sort-dir';
var sortKey = localStorage.getItem(SORT_KEY_STORAGE) || 'last_updated';
var sortDir = localStorage.getItem(SORT_DIR_STORAGE) || 'desc';
```

Both values are restored from `localStorage` on page load and written back on every sort interaction, so the user's last sort preference survives navigation and page reloads.

#### `sortProjects(list, key, dir)` helper

A generic comparator that handles three column type branches:

| Column type | Keys | Comparator |
|---|---|---|
| **Numeric** | `done` | Float ratio `(total − pending) / total`; 0 when no work packages |
| **Timestamp** | `date_created`, `last_updated` | `Date.getTime()` epoch milliseconds; null → 0 |
| **String** | `project`, `repository`, `status` | `localeCompare`; null/undefined → empty string (sorts last) |

The `sign` value (`+1` for asc, `−1` for desc) is applied uniformly, so direction reversal requires no branch duplication.

#### `thSort(label, key)` helper (inside `buildTable`)

Generates sortable `<th>` elements with:
- `data-sort="<key>"` — read by the click handler
- `class="sortable [sort-asc|sort-desc]"` — drives CSS arrows
- `aria-sort="ascending|descending|none"` — screen-reader accessibility (AC9)

The **Actions** column uses a plain `<th>Actions</th>` with no `data-sort`, keeping it inert.

#### Delegated click listener

A single listener on `<thead>` (not per-cell) handles all sort interactions:

```js
thead.addEventListener('click', function (e) {
  var th = e.target.closest('th[data-sort]');
  if (!th) return;           // Actions column → early exit
  var key = th.getAttribute('data-sort');
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';   // toggle
  } else {
    sortKey = key;
    // Timestamps default descending; other columns default ascending
    sortDir = (key === 'date_created' || key === 'last_updated') ? 'desc' : 'asc';
  }
  localStorage.setItem(SORT_KEY_STORAGE, sortKey);
  localStorage.setItem(SORT_DIR_STORAGE, sortDir);
  render(allProjects);
});
```

Re-running `render(allProjects)` rebuilds the table with the new sort. Because `filterValue` and `searchValue` are closure variables restored after each render, filter and search results are preserved across sort changes.

#### CSS additions (`styles.css`)

Four rules appended after the existing progress-bar block:

```css
th.sortable            { cursor: pointer; user-select: none; }
th.sortable:hover      { color: var(--color-text); }
th.sort-asc::after     { content: ' ↑'; }
th.sort-desc::after    { content: ' ↓'; }
```

---

### WP-002 — Sortable Header CSS Styling (`styles.css`)

**Files modified:**
- `mcp-server/gui/public/styles.css`

WP-002 constituted a dedicated QA and review pass on the four CSS rules that were already delivered by WP-001. The rules are grouped under a `/* Sortable column headers */` comment at lines 511–524 of `styles.css`:

```css
th.sortable            { cursor: pointer; user-select: none; }
th.sortable:hover      { color: var(--color-text); }
th.sort-asc::after     { content: ' ↑'; }
th.sort-desc::after    { content: ' ↓'; }
```

**Verification notes:**
- `th.sortable:hover` overrides the default `--color-text-muted` (line 184) with `--color-text`, creating a visible lightening effect. Both variables are defined in the light `:root` block and the dark `@media` block, so the hover effect works correctly in both themes without extra overrides.
- `th.sort-asc::after` / `th.sort-desc::after` use CSS `::after` pseudo-elements. Because the `sort-asc` / `sort-desc` classes are applied exclusively to the active column by `thSort()`, the arrow is absent on all non-active sortable columns and on the inert Actions header.
- All existing `<table>` / `<th>` rules (lines 164–210) were confirmed untouched.

Documentation delivered by WP-002: `mcp-server/README.md` (new "Sortable columns" feature bullet) and `mcp-server/docs/agents/project-manifest/file-tree.md` (extended annotations for `styles.css` and `app.js`).

---

## Acceptance Criteria — Final Status

### WP-001

| # | Criterion | Met |
|---|-----------|-----|
| 1 | Clicking a column header sorts visible rows by that column | ✅ |
| 2 | Clicking the same header again reverses sort direction | ✅ |
| 3 | Clicking a different header sorts by that column (timestamps default desc, others default asc) | ✅ |
| 4 | `sortKey` and `sortDir` persist across page reloads via `localStorage` | ✅ |
| 5 | Default sort on first load is `last_updated` descending (unchanged from prior behavior) | ✅ |
| 6 | Status filter and text search continue to work correctly after sorting | ✅ |
| 7 | Auto-refresh (10 s polling) preserves active sort key and direction | ✅ |
| 8 | The Actions column header is not clickable and shows no sort indicator | ✅ |
| 9 | `aria-sort` attributes on `<th>` elements reflect the current sort state | ✅ |

### WP-002

| # | Criterion | Met |
|---|-----------|-----|
| 1 | Sortable column headers display a pointer cursor on hover | ✅ |
| 2 | Hovered sortable headers lighten from muted header color to full text color | ✅ |
| 3 | Active sort column displays ↑ (ascending) or ↓ (descending) immediately after the column label text | ✅ |
| 4 | Arrow is absent on non-active sortable columns and on the non-sortable Actions column | ✅ |
| 5 | Rules apply correctly in both light and dark themes | ✅ |
| 6 | No existing table styles are altered | ✅ |

---

## Known Debt Items

Five low-priority observations from the code-review passes are recorded here for future reference:

1. **Search input trimming visible to user** — `searchValue` is stored as `.toLowerCase().trim()` but restored verbatim to `searchEl.value` on re-render. A user who types leading/trailing spaces will see them silently removed after a sort click. Not a functional bug — `applyFilter()` uses the normalised closure value — but the input field behavior may surprise edge-case users. *(WP-001 review)*

2. **Sort headers not keyboard-accessible** — `<th>` elements with `data-sort` are click-driven but carry no `tabindex` and are not `<button>` elements. `aria-sort` is set correctly (AC9), but keyboard users cannot reach the sort action via Tab/Enter. Acceptable for this codebase's style but worth revisiting in a dedicated a11y pass. *(WP-001 review)*

3. **No color transition on hover** — `th.sortable` has no `transition: color` property; the hover color change is instant rather than a subtle fade. Adding `transition: color 0.15s ease;` would be minor UX polish. *(WP-002 review)*

4. **`localeCompare()` without explicit collation** — `sortProjects()` calls `localeCompare()` without an explicit locale or `sensitivity` option. For a local developer tool this is inconsequential, but explicit collation options would make sort order deterministic across different browser locale settings. *(WP-002 review)*

5. **CSS section placement** — The `/* Sortable column headers */` block landed at line 511 (after progress-bar rules) rather than directly after the `/* Tables */` block (line 164). Functionally irrelevant but grouping sort header rules with the rest of the table styles would improve CSS maintainability. *(WP-002 review)*

---

## Pipeline Summary

### WP-001

| Stage | Agent | Status | Key Notes |
|---|---|---|---|
| Implementation | Developer | PASS | All 7 components delivered: constants, closure vars, `sortProjects()`, `thSort()`, updated `<thead>`, click listener, CSS rules |
| QA | QA | PASS | All 9 AC verified by static code inspection; 0 failures |
| Code Review | Reviewer | PASS | Production-ready; 4 low-priority cosmetic/a11y observations noted, none blocking |
| Documentation | Documentation | PASS | `synthesis.md` (initial) + `mcp-server/changelog.md` v1.10.1 entry |

### WP-002

| Stage | Agent | Status | Key Notes |
|---|---|---|---|
| Implementation | Developer | PASS | Verified CSS rules already present from WP-001; `styles.css` lines 511–524 confirmed correct |
| QA | QA | PASS | All 6 AC verified; CSS variables confirmed correct for both light and dark themes |
| Code Review | Reviewer | PASS | Minimal, correctly scoped CSS; 3 low-priority cosmetic observations noted, none blocking |
| Documentation | Documentation | PASS | `mcp-server/README.md` and `mcp-server/docs/agents/project-manifest/file-tree.md` updated |
