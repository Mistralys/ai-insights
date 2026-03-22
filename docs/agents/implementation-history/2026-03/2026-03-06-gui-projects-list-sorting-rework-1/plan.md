# Plan

## Summary

Address all five known debt items recorded in the synthesis for `2026-03-06-gui-projects-list-sorting`. The items divide naturally into two categories: JavaScript correctness / accessibility fixes in `mcp-server/gui/public/app.js`, and CSS polish in `mcp-server/gui/public/styles.css`. No API, backend, schema, or test changes are required. All work is purely client-side.

---

## Architectural Context

All changes are confined to the static GUI client shipped with the MCP server:

- `mcp-server/gui/public/app.js` — Single-file vanilla-JS client. The `renderProjectList()` closure (line 241) owns the sort state (`sortKey`, `sortDir`), the search state (`searchValue`), and all table-building helpers (`sortProjects()`, `thSort()`, `buildTable()`).
- `mcp-server/gui/public/styles.css` — Single-file stylesheet. The `/* Tables */` section begins at line 163. The `/* Sortable column headers */` section currently sits at line 510, after the progress-bar block.

No build step transforms these files; they are served as-is by `mcp-server/gui/server.ts` from the `public/` directory.

---

## Approach / Architecture

Two work packages, one per file type, in sequencing order:

**WP-001 — JS correctness and accessibility (`app.js`)**

Three independent micro-fixes inside `renderProjectList()`:

1. **Search trim leakage (debt item 1):** Introduce a companion `searchRaw` closure variable that stores the verbatim user input. On re-render, restore `searchEl.value = searchRaw` instead of the normalised `searchValue`. The normalisation (`.toLowerCase().trim()`) continues to apply only when computing `searchValue` for `applyFilter()` — no filter behavior changes.

2. **Keyboard accessibility (debt item 2):** Update `thSort()` to emit `tabindex="0"` and `role="columnheader"` on each sortable `<th>`. Add a `keydown` delegated listener on `<thead>` (alongside the existing `click` listener) that triggers sort on `Enter` or `Space` key, with `e.preventDefault()` for `Space` to prevent page scroll.

3. **`localeCompare` collation (debt item 4):** Pass explicit collation arguments `('en', { sensitivity: 'base' })` to the `localeCompare()` call in `sortProjects()` so string sort order is locale-deterministic across browser environments.

**WP-002 — CSS polish (`styles.css`)**

Two independent micro-fixes:

4. **Hover color transition (debt item 3):** Add `transition: color 0.15s ease;` to the existing `th.sortable` rule at line 513.

5. **CSS section placement (debt item 5):** Move the entire `/* Sortable column headers */` comment block (currently lines 510–524) to immediately after the closing of the `/* Tables */` block (currently ending at approximately line 210), keeping all four rules intact. The progress-bar block is unaffected.

---

## Rationale

- **Two WPs** — Grouping by file type mirrors the previous project's structure and keeps diffs easy to review independently.
- **`searchRaw` companion variable** — The simplest fix that avoids touching the `applyFilter()` logic. Keeping `searchValue` normalised internally preserves all existing filtering contracts.
- **Delegated `keydown` on `<thead>`** — Matches the existing delegated `click` pattern; a single listener handles all columns without per-`<th>` bindings.
- **`'en', { sensitivity: 'base' }`** — `sensitivity: 'base'` treats accented variants as equal, which is appropriate for identifier/project-name sorting in a developer tool. Explicit `'en'` locale makes the sort order deterministic across machines.
- **CSS move, not rewrite** — The four sortable-header rules are correct as written; only their position in the file is suboptimal.

---

## Detailed Steps

### WP-001 — JS correctness and accessibility

1. Open `mcp-server/gui/public/app.js`.
2. **Search trim fix:** Immediately after `var searchValue = '';` (line 246), add `var searchRaw = '';`. In the `searchEl.addEventListener('input', ...)` handler (line 411), add `searchRaw = this.value;` before the existing `searchValue = this.value.toLowerCase().trim();` line. On the restore line (line 409), change `searchEl.value = searchValue` to `searchEl.value = searchRaw`.
3. **`localeCompare` fix:** On line 274, change `aStr.localeCompare(bStr)` to `aStr.localeCompare(bStr, 'en', { sensitivity: 'base' })`.
4. **Keyboard accessibility:** In `thSort()` (line 300), update the `<th>` template string to include `tabindex="0"` on sortable headers. Below the existing `click` listener on `<thead>`, add a parallel `keydown` listener that calls the same sort-toggle and re-render logic when `e.key === 'Enter' || e.key === ' '`, calling `e.preventDefault()` for Space.

### WP-002 — CSS polish

5. Open `mcp-server/gui/public/styles.css`.
6. **Hover transition:** Add `transition: color 0.15s ease;` as a third property inside the `th.sortable { ... }` rule (currently lines 513–515).
7. **CSS block relocation:** Cut the entire `/* Sortable column headers */` comment and the four rules that follow it (lines 510–524). Paste them immediately after the closing of the `/* Tables */` block (after the `tbody tr.clickable` rule, before the `/* Cards / Panels */` comment). The progress-bar and filter-actions rules above the current position close up without a gap.

---

## Dependencies

- No new npm dependencies.
- No changes to `mcp-server/src/`, `mcp-server/gui/server.ts`, or any schema/storage files.

---

## Required Components

**Modified files:**
- `mcp-server/gui/public/app.js` — WP-001 changes (3 micro-edits)
- `mcp-server/gui/public/styles.css` — WP-002 changes (1 property addition + 1 block move)

**Documentation updates (post-implementation):**
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Update inline annotations for `app.js` and `styles.css` to reflect keyword accessibility and the corrected CSS section order.
- `mcp-server/changelog.md` — New patch version entry.

---

## Assumptions

- The GUI is a single-file vanilla-JS client with no transpilation; edits take effect immediately on page reload.
- `'en'` locale with `sensitivity: 'base'` is acceptable for this developer tool — no multi-language project name requirements exist.
- Keyboard accessibility via `tabindex` + `keydown` is sufficient for this codebase's a11y bar; ARIA role `columnheader` is already implied by `<th>` semantics but made explicit for screen-reader clarity.
- No visual regression tests exist for the GUI; manual verification in the running server is the accepted QA method.

---

## Constraints

- Follow the GUI's no-framework, no-build-step convention (`app.js` is plain ES5-compatible JavaScript).
- Do not alter any existing table-rendering logic beyond the targeted lines.
- CSS edits must not break the existing light/dark theme behavior.
- The `/* Tables */` block boundaries must be preserved; only the `/* Sortable column headers */` block moves.

---

## Out of Scope

- Full WCAG 2.1 AA compliance audit of the GUI.
- Converting sort headers to `<button>` elements (would require larger structural refactor of `thSort()`).
- Internationalisation or multi-locale sort support beyond deterministic `'en'` collation.
- Changes to the MCP server backend, API routes, or storage layer.
- Automated browser tests for GUI behavior.

---

## Acceptance Criteria

1. After a sort click, the search input field retains any leading or trailing spaces the user typed.
2. Pressing Tab moves focus to each sortable column header in DOM order; pressing Enter or Space on a focused header triggers the sort (same behavior as a click).
3. The sort indicator arrow appears on the active column when navigating by keyboard.
4. String column sort order (`project`, `repository`, `status`) is identical across browsers with different default locales.
5. Hovering over a sortable column header produces a smooth color fade rather than an instant snap, consistent with other interactive elements in the UI.
6. The `/* Sortable column headers */` CSS rules appear directly after the `/* Tables */` block in `styles.css`.
7. All previously verified sorting AC (WP-001 / WP-002 original AC 1–15) continue to pass unmodified.

---

## Testing Strategy

Manual verification against the running GUI server (`node mcp-server/dist/gui/server.js --port 24679 --ledger-dir mcp-server/storage/ledger`):

- Open the Projects list page with at least two projects present.
- Type `" test "` (with spaces) into the search box, click a sort header, and confirm the spaces are still visible in the input field.
- Tab to a sortable header and press Enter; confirm sort direction changes. Tab back and press Space; confirm toggle. Confirm Actions column is skipped / inert.
- Inspect the `localeCompare` call in DevTools or via code review diff.
- Hover over a sort header in both light and dark themes and confirm a visible color transition (not instant).
- Open DevTools Sources, inspect `styles.css`, and confirm the `/* Sortable column headers */` block is positioned after `/* Tables */` and before `/* Cards / Panels */`.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`tabindex` on `<th>` elements causes unexpected Tab-stop ordering** | `thSort()` renders headers in DOM order (Project → Repository → … → Updated), which is the expected tab sequence; validate manually. |
| **`keydown` Space triggering page scroll** | `e.preventDefault()` is called inside the Space branch of the listener, suppressing the default scroll behavior. |
| **CSS block move introduces a cascade conflict** | The four sortable-header rules are self-contained selectors; no specificity conflicts with the `/* Tables */` block rules. Visually verify before and after screenshots. |
| **`sensitivity: 'base'` changes existing sort order for some users** | Only affects string columns when two values differ only by case or accent — effectively no visible change for typical project/repository names. |
