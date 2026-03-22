# Synthesis — GUI Rename and Repository Column

**Project:** `2026-03-05-gui-rename-and-repo-column`
**Date:** 2026-03-05
**Status:** COMPLETE — all 4 work packages passed all pipeline stages (implementation → QA → code-review → documentation)
**Test baseline at close:** 1,093 tests across 36 files — 0 failures; `tsc --noEmit` — 0 errors

---

## Executive Summary

This project delivered two new features to the Ledger GUI dashboard:

1. **Project Rename** — users can click an edit icon on the project detail page to rename a project inline. The new title persists to `.meta.json` via a new `PATCH /api/projects/:slug` endpoint and takes priority over the auto-detected manifest name wherever the project appears.

2. **Repository Column** — the project list table now includes a "Repository" column showing the repository folder name derived server-side from each project's `plan_path`. The value participates in text-filter searches.

All changes were implemented cleanly across the full stack: storage layer (`LedgerStore`), API handler layer (`gui/api.ts`), HTTP server router (`gui/server.ts`), frontend SPA (`gui/public/app.js` + `styles.css`), tests, and documentation.

---

## What Was Built

### WP-001 — `LedgerStore.updateTitle()` (Storage Layer)

- Added `updateTitle(title: string): Promise<ProjectMeta>` as a public async method on `LedgerStore` in `mcp-server/src/storage/ledger-store.ts`.
- Follows the established read-modify-write pattern: reads existing `.meta.json` via `readProjectMeta()`, merges the new title and a fresh `last_updated` timestamp, validates through `ProjectMetaSchema.parse()`, and writes atomically via `atomicWriteJson()`.
- Returns the validated `ProjectMeta` object, giving callers an immediate, type-safe result.
- Input validation (min/max length) is deliberately delegated to the API layer, keeping the storage method a simple, composable primitive.

### WP-002 — API Handler, Route, and `repository_name` (API + Server Layer)

- Added `handleRenameProject(ledgerRoot, slug, body)` to `gui/api.ts`.
  - Body validated with `z.object({ title: z.string().min(1).max(200) })` via `safeParse`.
  - Guards: `assertSafeSlug()` → `ledgerDirExists()` → `store.updateTitle()`.
  - Returns the updated `ProjectMeta` on success; structured `VALIDATION_ERROR` or `NOT_FOUND` on failure.
- Added `PATCH /api/projects/:slug` route to `gui/server.ts` with body-parsing, consistent `ApiError` dispatch, and correct placement before the POST reset handler.
- Added `PATCH` to the `Access-Control-Allow-Methods` CORS header.
- Extended `ProjectSummary` interface with `repository_name: string | null`.
- Updated `handleListProjects` to compute `repository_name` from `inferProjectRootFromPlanPath()` and to prioritise a persisted `meta.title` over any auto-detected manifest name.

### WP-003 — Frontend (SPA + CSS)

- Added `renameProject(slug, title)` to the API client object (PATCH, `encodeURIComponent` on slug, consistent with all other methods).
- Added **Repository column** to `buildTable()`: `data-repo` attribute on `<tr>`, `<th>Repository</th>` header, `<td class="repo-col">` with `escapeHtml(p.repository_name || '—')`.
- Updated `applyFilter()` to include `data-repo` in the text-filter search chain.
- Updated the project detail view so `<h1>` and breadcrumb show `meta.title` when set, falling back to the slug.
- Implemented fully-functional **inline title edit**:
  - Pencil icon (`.edit-title-btn`) adjacent to the heading.
  - Click → `<input class="title-edit-input">` replaces `<h1>`, pre-filled with current title, auto-focused and selected.
  - Enter or blur calls `API.renameProject()` and updates heading + breadcrumb on success.
  - Escape cancels without saving.
  - Errors surfaced in `.title-edit-error` div; `inputDone` flag prevents blur+Enter double-save race without any `setTimeout` hack.
  - `currentTitle` updated to the new title before `exitEdit()`, so re-opening the editor preloads the latest saved value.
- Added all supporting CSS classes to `styles.css` (`.page-heading-wrapper`, `.edit-title-btn`, `.title-edit-input`, `.title-edit-error`, `.repo-col`). `title-edit-input` inherits `h1` typography (font-size, font-weight) for visual cohesion.

### WP-004 — Tests

- Added `describe('handleRenameProject')` block in `mcp-server/tests/gui/api.test.ts` — 7 cases:
  - Success (returns updated meta, asserts `last_updated` timestamp advancement)
  - Empty title → `VALIDATION_ERROR`
  - Title exceeding 200 chars → `VALIDATION_ERROR`
  - Boundary: exactly 200 chars → success (confirms `max(200)` is inclusive)
  - Non-existent slug → `NOT_FOUND`
  - Path-traversal slugs (`../escape`, `a/b`, `''`) → rejection
  - Persistence round-trip verified via `handleGetProject`
- Added `describe('handleListProjects — repository_name')` — 2 cases: depth-4 typical path derives the correct repo folder name; shallow path returns `null` gracefully.
- Added `describe('handleListProjects — title priority')` — 2 cases: persisted `meta.title` overrides slug-derived name; fallback to slug-derived when no title set.
- Added `describe('LedgerStore.updateTitle')` in `mcp-server/tests/storage/ledger-store.test.ts` — 4 cases: sets `title` field, updates `last_updated`, persists to disk (verified by raw JSON re-read), overwrites a previous title.
- **Net new tests added: 16.** Total suite on completion: 1,093 / 36 files.

---

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/src/storage/ledger-store.ts` | Added `updateTitle()` method |
| `mcp-server/gui/api.ts` | Added `handleRenameProject`, `repository_name` field, `meta.title` priority in `handleListProjects` |
| `mcp-server/gui/server.ts` | Added `PATCH /api/projects/:slug` route; updated CORS header |
| `mcp-server/gui/public/app.js` | API client method, Repository column, inline rename UI |
| `mcp-server/gui/public/styles.css` | Styles for heading wrapper, edit button, title input, error div, repo column |
| `mcp-server/tests/gui/api.test.ts` | `handleRenameProject`, `repository_name`, and title-priority test suites |
| `mcp-server/tests/storage/ledger-store.test.ts` | `LedgerStore.updateTitle()` unit tests |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `updateTitle()` signature, `handleRenameProject` entry, `repository_name` on `ProjectSummary`, updated CORS table, PATCH route row |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Expanded descriptions for `api.test.ts` and `ledger-store.test.ts` |

---

## Quality Signal

| Stage | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| Full test suite (`npm test`) | ✅ 1,093 passed / 0 failed |
| All WP acceptance criteria | ✅ 22/22 met across 4 WPs |
| Pipeline health | ✅ 4/4 WPs with all stages PASS |

---

## Observations and Follow-Up Items

The following items were raised during QA and code review but were **not blockers** — all acceptance criteria were met. They are recorded here for future consideration.

### 1. `updateTitle()` runs without `withLock()` (Low Risk)
**Raised by:** QA (WP-001), Code Review (WP-001)
**File:** `mcp-server/src/storage/ledger-store.ts` ~line 295

`updateTitle()` performs a read-modify-write using only `atomicWriteJson()` for the write half, consistent with `writeProjectMeta()` and `initializeProject()` elsewhere in the class. The lock pattern in this codebase (`withLock`) applies only to multi-file atomic operations (root-index + meta file together). For a GUI rename endpoint with inherently low concurrent write volume, this is sufficient. **Revisit if `updateTitle()` is ever called from a high-concurrency path.**

### 2. `RenameBodySchema` defined inline (Low Priority, Style)
**Raised by:** Code Review (WP-002)
**File:** `mcp-server/gui/api.ts` ~line 623

All other Zod schemas in `api.ts` (`GuiConfigPartialSchema`, `WpDecisionSchema`, `ResetRequestSchema`) are module-level consts. `RenameBodySchema` is defined inline inside `handleRenameProject`. Hoisting it to module level would restore consistency and eliminate per-call re-instantiation. **Low-priority cosmetic fix.**

### 3. `max(200)` lacks an explanatory comment (Cosmetic)
**Raised by:** Code Review (WP-002)
**File:** `mcp-server/gui/api.ts`

The `z.string().max(200)` cap has no inline comment explaining why 200. A brief note — e.g. `// matches ProjectMetaSchema title field assumption` — would help future maintainers. **Cosmetic only.**

---

## Architectural Decisions Made

| Decision | Rationale |
|----------|-----------|
| `PATCH` (not `PUT`) for the rename endpoint | Partial update semantics; only `title` changes |
| Persist title in `.meta.json` `title` field | Field already existed in `ProjectMetaSchema`; no schema migration needed |
| Server-side `repository_name` derivation | Keeps path logic centralized in `inferProjectRootFromPlanPath()`; avoids exposing raw filesystem paths to browser parsing |
| Prioritise `meta.title` over manifest-detected name in list | Explicit user renames should always win over auto-detection |
| Inline edit UX rather than modal | Minimal UI surface, matches modern dashboard conventions |
| Input validation at API layer, not storage layer | `LedgerStore.updateTitle()` remains a composable primitive; guards are applied as close to the untrusted boundary as possible |
| `inputDone` flag for double-save prevention | Eliminates blur+Enter race cleanly without `setTimeout`; resettable on error to allow retry |

---

*Synthesis generated by Synthesis Agent on 2026-03-05.*
