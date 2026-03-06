# Plan

## Summary

Add interactive column sorting to the Projects list in the ledger GUI. Users will be able to click any column header (Project, Repository, % Done, Status, Created, Updated) to sort the table ascending or descending. The current sort key and direction will persist in `localStorage` across page loads. The default sort remains **Updated descending** to preserve existing behavior. All changes are purely client-side — no API or backend modifications are required.

---

## Architectural Context

The GUI is a plain-JavaScript SPA with no frontend framework. All relevant code lives in two files served as static assets:

| File | Role |
|------|------|
| `mcp-server/gui/public/app.js` | Single-file SPA — routing, data fetching, rendering |
| `mcp-server/gui/public/styles.css` | All styling |
| `mcp-server/gui/public/index.html` | Shell — loads `styles.css`, `marked.min.js`, `app.js` |

The Projects list is implemented entirely in `renderProjectList()` (`app.js`, approx. lines 232–390). Key internal structure:

- **State** — `allProjects`, `filterValue`, `searchValue` (closured variables)
- **`buildTable(projects)`** — renders the `<table>` HTML; currently hardcodes a `last_updated` descending sort
- **`applyFilter()`** — shows/hides rows by DOM attribute comparison; runs after every filter/search change
- **`render(projects)`** — builds the full page HTML, re-attaches event listeners
- **`load()`** — calls `API.getProjects()` then `render()`

The `GET /api/projects` endpoint (`api.ts` → `handleListProjects`) already returns all fields needed for every sort column:

| Column | Source field on `ProjectSummary` |
|--------|----------------------------------|
| Project | `project_name` (string \| null) |
| Repository | `repository_name` (string \| null) |
| % Done | derived: `(total_work_packages - pending_work_packages) / total_work_packages` |
| Status | `status` (string) |
| Created | `date_created` (ISO timestamp string) |
| Updated | `last_updated` (ISO timestamp string) |

The `th` elements in `buildTable` are plain, non-interactive HTML today.

---

## Approach / Architecture

**Client-side sort only.** All data is already fetched in one request; sorting in the browser avoids an additional round-trip and keeps API contracts unchanged.

### State additions (to `renderProjectList` closure)

```
var sortKey = 'last_updated';   // active column key
var sortDir = 'desc';           // 'asc' | 'desc'
```

Both are persisted to / restored from `localStorage` (keys `mcp-sort-key` and `mcp-sort-dir`) so the user's preference survives page reload.

### Sort logic in `buildTable`

Replace the hardcoded `last_updated` sort with a generic comparator driven by `sortKey` / `sortDir`:

- **String columns** (project, repository, status): locale-aware `localeCompare`, nulls last.
- **Numeric column** (% done): compare the float ratio `(total - pending) / total` (0 when `total === 0`).
- **Timestamp columns** (date_created, last_updated): compare epoch milliseconds.

### Clickable headers

Each `<th>` for a sortable column gets:
- A `data-sort` attribute naming the column key.
- An `aria-sort` attribute (`ascending` / `descending` / `none`) for screen-reader support.
- A CSS class `sortable` (always) plus `sort-asc` or `sort-desc` when it is the active column.

After `buildTable` inserts the table HTML, a single delegated `click` listener on `<thead>` reads `data-sort`, updates `sortKey` / `sortDir`, persists to `localStorage`, and calls `render(allProjects)` to rebuild.

### CSS additions (to `styles.css`)

```css
th.sortable            { cursor: pointer; user-select: none; }
th.sortable:hover      { color: var(--color-text); }
th.sort-asc::after     { content: ' ↑'; }
th.sort-desc::after    { content: ' ↓'; }
```

The `::after` pseudo-element appends an arrow indicator to the active column header without adding DOM nodes.

---

## Rationale

- **Pure client-side** — zero backend churn; all data is already in the response.
- **`localStorage` persistence** — respects the existing pattern used by `Theme` (key `mcp-theme`).
- **Delegated click listener on `<thead>`** — matches the existing pattern of attaching listeners after `innerHTML` assignment; no need for per-`th` listeners.
- **CSS `::after` indicator** — minimal DOM impact, consistent with the project's "no-framework" philosophy.
- **Default unchanged** — remaining on `last_updated` desc preserves current user expectations.

---

## Detailed Steps

1. **Add sort state variables** — inside `renderProjectList`, declare `sortKey` and `sortDir` alongside the existing `filterValue`/`searchValue`; initialize from `localStorage` with `'last_updated'`/`'desc'` fallbacks.

2. **Refactor `buildTable` sort logic** — replace the hardcoded `last_updated` descending sort with a generic `sortProjects(projects, sortKey, sortDir)` helper (or an inline block) that branches on column type (string / numeric / timestamp).

3. **Add `data-sort` and CSS classes to `<th>` elements** — update the `buildTable` header HTML to emit `data-sort="<key>"`, `class="sortable [sort-asc|sort-desc]"`, and `aria-sort` on the six sortable columns; the Actions column gets no `data-sort`.

4. **Attach sort click listener** — after `buildTable` inserts the table, attach one delegated listener on `thead` (or the individual `th` elements); on click, update `sortKey`/`sortDir`, persist to `localStorage`, and call `render(allProjects)`.

5. **Add CSS rules** — append sortable-column styles to `styles.css`: `cursor: pointer`, hover color, `::after` arrow indicators for `sort-asc` and `sort-desc`.

6. **Verify `applyFilter` is unaffected** — `applyFilter` operates on DOM attributes (`data-status`, `data-slug`, etc.); sort rebuilds the table via `render()`, so both can coexist without change.

---

## Dependencies

- No new npm packages.
- No changes to `api.ts`, `server.ts`, or any TypeScript source.
- No changes to `index.html`.

---

## Required Components

**Modified files:**

- `mcp-server/gui/public/app.js` — sort state, sort logic, header attributes, click listener
- `mcp-server/gui/public/styles.css` — `.sortable`, `.sort-asc`, `.sort-desc` CSS rules

**No new files required.**

---

## Assumptions

- The `GET /api/projects` response shape (`ProjectSummary`) will not change as part of this work.
- `localStorage` is available in all target browsers (it is used today for theme preference).
- The "Actions" column is intentionally non-sortable.
- `total_work_packages === 0` is treated as 0% done for sort purposes.

---

## Constraints

- No ES modules; `app.js` uses `var` and plain function declarations — new code must follow the same style.
- No external libraries may be introduced.
- `applyFilter()` must continue to work independently of sort state (it operates on rendered DOM rows, not on the data array).
- STDIO discipline: no `console.log` to stdout in server-side code — not applicable here (client JS only).

---

## Out of Scope

- Server-side sorting query parameters.
- Sorting within the Work Packages table on the project detail view.
- Sorting in the Insights view.
- Pagination.
- Column re-ordering or hiding.

---

## Acceptance Criteria

- Clicking a column header sorts the visible rows by that column.
- Clicking the same header again reverses the sort direction.
- Clicking a different header sorts by the new column (default ascending, except timestamps which default descending).
- The active sort column displays a ↑ or ↓ arrow; inactive sortable columns display no arrow.
- The sort preference (column + direction) persists across page reloads via `localStorage`.
- The default sort on first load (no `localStorage` value) is Updated descending — matching current behavior.
- Status filter and text search continue to work correctly after sorting.
- Auto-refresh (10 s polling) preserves the active sort key and direction.
- The Actions column header is not clickable / shows no sort indicator.

---

## Testing Strategy

Manual verification in the GUI (no automated tests exist for `app.js`):

1. Load the Projects page and confirm default sort is Updated descending.
2. Click each sortable column header once — confirm rows reorder correctly and arrow appears.
3. Click each header a second time — confirm direction reverses.
4. Set a status filter, then click a header — confirm only visible rows reorder, hidden rows remain hidden.
5. Type in the search box after sorting — confirm search still works.
6. Reload the page — confirm sort preference is restored from `localStorage`.
7. Wait for the 10 s auto-refresh — confirm sort is maintained after the poll.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`render(allProjects)` re-runs on every sort click, resetting filter/search UI values** | The existing `render` function already restores `filterValue` and `searchValue` from closured vars after re-rendering — same pattern can be followed for `sortKey`/`sortDir`. |
| **Null `project_name` or `repository_name` causes sort errors** | Comparator treats null as empty string `''` (sorts last on ascending, first on descending). |
| **`total_work_packages === 0` causes division by zero** | Comparator guards: ratio = `0` when `total_work_packages === 0`. |
| **`localStorage` quota exceeded** | Two short string values (~20 bytes total) — negligible risk. |
