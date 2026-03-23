# Synthesis — GUI Projects List Sorting Rework 1

**Date:** 2026-03-06  
**Project:** `2026-03-06-gui-projects-list-sorting-rework-1`  
**Status:** COMPLETE  
**Work Packages:** WP-001 (JS Correctness & Accessibility), WP-002 (CSS Polish)  
**Version Delivered:** v1.10.2

---

## Purpose

This project addressed five debt items recorded in the synthesis for the preceding `2026-03-06-gui-projects-list-sorting` project. All five items were purely client-side, confined to `mcp-server/gui/public/app.js` (3 fixes) and `mcp-server/gui/public/styles.css` (2 fixes). No backend, schema, API, or test infrastructure was touched.

---

## What Was Delivered

### WP-001 — JS Correctness & Accessibility (`app.js`)

**Fix 1 — Search trim leakage (debt item 1)**  
Introduced `searchRaw` as a companion closure variable alongside `searchValue`. The input element is now restored to `searchRaw` (verbatim user text) on re-render, while `searchValue` (lowercased, trimmed) continues to drive `applyFilter()`. Leading and trailing spaces typed by the user are no longer silently stripped after a sort click.

**Fix 2 — Keyboard accessibility (debt item 2)**  
`thSort()` now emits `tabindex="0"` and `role="columnheader"` on every sortable `<th>`. A delegated `keydown` listener on `<thead>` — mirroring the existing `click` listener — triggers sort on Enter or Space, with `e.preventDefault()` on Space to suppress page scroll. The sort indicator arrow updates identically whether a header is activated by mouse or keyboard.

**Fix 3 — `localeCompare` collation (debt item 4)**  
The bare `localeCompare(bStr)` call in `sortProjects()` was updated to `localeCompare(bStr, 'en', { sensitivity: 'base' })`. String sort order for Project, Repository, and Status columns is now locale-deterministic across all browsers and operating system locales. `sensitivity: 'base'` treats accented variants as equal, appropriate for developer-tool project name lists.

---

### WP-002 — CSS Polish (`styles.css`)

**Fix 4 — Hover colour transition (debt item 3)**  
Added `transition: color 0.15s ease;` to the `th.sortable` rule. Hovering over a sortable column header now produces a smooth 150 ms colour fade consistent with the 0.15s timing used by every other interactive element in the stylesheet.

**Fix 5 — CSS section placement (debt item 5)**  
Relocated the entire `/* Sortable column headers */` block (four rules: `th.sortable`, `th.sortable:hover`, `th.sort-asc::after`, `th.sort-desc::after`) from its original position after the progress-bar block to immediately after `tbody tr.clickable` (end of the `/* Tables */` section), directly before `/* Cards / Panels */`. All four rules use CSS variables exclusively; no hard-coded colours, no `[data-theme=dark]` overrides required. The progress-bar region closed cleanly with no orphaned rules.

---

## Acceptance Criteria Outcome

### WP-001 — 5/5 met

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Search input retains leading/trailing spaces after sort | ✅ PASS |
| 2 | Tab → focus; Enter/Space triggers sort | ✅ PASS |
| 3 | Sort indicator arrow updates on keyboard sort | ✅ PASS |
| 4 | String sort is locale-deterministic across browsers | ✅ PASS |
| 5 | All 15 pre-existing sorting AC continue to pass | ✅ PASS |

### WP-002 — 4/4 met

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Hover produces ≈150 ms colour fade | ✅ PASS |
| 2 | Sortable header block directly after `/* Tables */`, before `/* Cards / Panels */` | ✅ PASS |
| 3 | All 15 pre-existing sorting AC continue to pass | ✅ PASS |
| 4 | Light and dark theme rendering visually unchanged (apart from transition) | ✅ PASS |

---

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/gui/public/app.js` | `searchRaw` variable; `tabindex`/`role`/`keydown` on sort headers; `localeCompare` locale + sensitivity |
| `mcp-server/gui/public/styles.css` | `transition: color 0.15s ease` on `th.sortable`; sortable block relocated to `/* Tables */` section |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Annotations updated for both `app.js` and `styles.css` |
| `mcp-server/changelog.md` | v1.10.2 entry with all 5 fix bullets |

---

## Quality Notes

All pipelines across both WPs passed without issue. No bugs, regressions, or high/medium-priority observations were raised. The following low-priority notes were recorded and remain open (non-blocking):

1. **Sort-toggle logic duplication** — The 6-line sort-toggle block (key comparison, direction assignment, localStorage writes, render call) is duplicated verbatim between the `click` and `keydown` handlers in `app.js`. Extraction to a shared named function would eliminate the duplication. Deferred given the ES5 no-module constraint; documented in `file-tree.md`.

2. **`sensitivity: 'base'` inline comment** — `sensitivity: 'base'` warrants an inline comment in `app.js` explaining why accented variants are sorted equivalently. Documented at the manifest level; an inline code comment remains a future nice-to-have.

---

## Architectural Notes

- **No build step** — `app.js` and `styles.css` are served as-is; all changes take effect on page reload with no compilation required.
- **ES5 constraint upheld** — No arrow functions, `const`/`let`, classes, or template literals were introduced. All additions follow the existing vanilla-JS ES5 style throughout the file.
- **CSS variable–only patterns preserved** — All four sortable-header rules use `var(--...)` tokens exclusively; the relocation introduces zero dark-theme breakage and requires no `[data-theme=dark]` overrides.
- **Delegated listener pattern** — The new `keydown` listener on `<thead>` follows the identical delegated pattern already established by the `click` listener, maintaining consistency in how the table handles interaction events.

---

## Relationship to Previous Project

This project directly consumed the debt backlog from `2026-03-06-gui-projects-list-sorting` (items 1–5). The two projects together constitute the complete implementation of sortable columns in the GUI projects list:
- First project: core sorting feature (clickable headers, localStorage persistence, sort indicators, aria-sort).
- This project: five quality/correctness fixes on top of that foundation.

The GUI sorting feature is now complete with no known pending debt.
