# Synthesis — Post-Archiving Technical Debt Remediation

**Project:** `2026-03-06-project-archiving-rework-1`
**Date Completed:** 2026-03-06
**Status:** COMPLETE — all 4 work packages delivered, all pipelines PASS

---

## Executive Summary

This project resolved five technical debt items identified in the post-archiving synthesis, spanning three backend schema/logic fixes and two frontend quality improvements. All changes were internal refactors with no new features or public API contract changes. The full test suite (1,209 tests across 41 files) remained green throughout, and a manual E2E verification of the GUI confirmed render parity after the frontend split.

---

## What Was Delivered

### WP-001 — `ProjectMetaSchema` Status Dedup

**Problem:** `ProjectMetaSchema.status` in `src/schema/project-meta.ts` was declared as a hardcoded `z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED'])`, duplicating the canonical `ProjectStatus` Zod enum already defined in `src/schema/enums.ts`. Adding a new status value required two edits.

**Solution:** Replaced the inline `z.enum(...)` with a direct reference to the imported `ProjectStatus` schema. The field is now single-source and automatically tracks future enum additions.

**Files changed:** `mcp-server/src/schema/project-meta.ts`, `mcp-server/docs/agents/project-manifest/api-surface.md`

---

### WP-002 — `GuiConfigPartialSchema` Derivation

**Problem:** `GuiConfigPartialSchema` in `gui/api.ts` was a hand-maintained 8-line `z.object({...})` definition mirroring three of the four fields from `GuiConfigSchema` (excluding `ledger_root`). Any field added to `GuiConfigSchema` required a parallel manual update in `api.ts` — a drift risk with no compiler enforcement.

**Solution:** Exported `GuiConfigPartialSchema = GuiConfigSchema.omit({ ledger_root: true }).partial()` from `src/gui/config.ts` (alongside a `GuiConfigPartial` type). The hand-maintained definition in `api.ts` was removed and replaced with this import. The schema now tracks `GuiConfigSchema` automatically.

**Files changed:** `mcp-server/src/gui/config.ts`, `mcp-server/gui/api.ts`, `mcp-server/docs/agents/project-manifest/api-surface.md`

---

### WP-003 — `initializeProject` Enrichment Resilience

**Problem:** Steps 4 (write root index), 5 (meta enrichment), and 6 (plan archival) in `initializeProject` shared a single `try/catch`. If step 5 failed — e.g. `readProjectName` threw — the tool returned `isError: true` even though the root index had already been persisted. Callers could not distinguish "enrichment failed but project was created" from "project creation itself failed."

**Solution:** Wrapped step 5 (the three enrichment calls: `readProjectName`, `inferProjectRootFromPlanPath`, `writeProjectMeta`) in a nested `try/catch` inside the outer handler. Enrichment failures are logged to `process.stderr` (preserving STDIO discipline) and set a `enrichmentCached` flag to `false`. The success response now includes an `enrichment_cached: boolean` field so callers can surface warnings without treating the initialization as a failure.

A new test file `tests/tools/enrichment-resilience.test.ts` (9 tests across 3 suites) covers the success path, an unmockable-error fallback path, and a forced `writeProjectMeta` failure path. A non-obvious `planFile !== ''` mock guard was required because `writeRootIndex` internally calls `writeProjectMeta('', ...)` — the pattern is documented in the test file.

**Files changed:** `mcp-server/src/tools/project-lifecycle.ts`, `mcp-server/docs/agents/project-manifest/api-surface.md`

---

### WP-004 — `app.js` Modular Extraction + `buildQueryString` Helper

**Problem:** `gui/public/app.js` was a 1,540-line plain-JavaScript monolith containing all view renderers, event wiring, utilities, and the API client in a single file with comment-delimited sections. `getProjects()` used manual `if`-chain concatenation to build query strings, with no reusable helper.

**Solution:** Split the monolith into 9 focused modules using the existing IIFE global pattern (required by the no-bundler script-tag loading strategy):

| Module | Location | Exposes |
|--------|----------|---------|
| `api-client.js` | `public/` | `window.API` + `buildQueryString()` helper |
| `theme.js` | `public/` | `window.Theme` |
| `router.js` | `public/` | `window.Router` |
| `utils.js` | `public/` | `window.Utils` |
| `views/project-list.js` | `public/views/` | `window.ProjectListView` |
| `views/project-detail.js` | `public/views/` | `window.ProjectDetailView` |
| `views/work-package.js` | `public/views/` | `window.WorkPackageView` |
| `views/config.js` | `public/views/` | `window.ConfigView` |
| `views/insights.js` | `public/views/` | `window.InsightsView` |

`app.js` was reduced to a 7-line Bootstrap entry point (`Theme.init()` + `Router.init()`). `buildQueryString(params)` was extracted into `api-client.js` and is used by `getProjects`. `index.html` loads all 10 scripts in the correct dependency order (`marked.min.js` → `api-client.js` → `theme.js` → `router.js` → `utils.js` → all views → `app.js`).

Manual E2E verification confirmed full render parity: Projects list (30 projects), Insights view, Configuration view, and Project detail view (WP table with status badges) all rendered correctly. No console errors.

**Files changed:** `mcp-server/gui/public/app.js`, `mcp-server/gui/public/index.html`, `mcp-server/docs/agents/project-manifest/file-tree.md`, plus 9 new module files under `mcp-server/gui/public/`

---

## Quality Metrics

| Metric | Value |
|--------|-------|
| Test files | 41 |
| Tests passing | 1,209 |
| Tests failing | 0 |
| Regressions | 0 |
| Pipeline failures | 0 |
| WPs with all stages PASS | 4 / 4 |

---

## Notable Patterns & Learnings

**Mock guard for `writeRootIndex` → `writeProjectMeta` call chain (WP-003):** `writeRootIndex` internally calls `writeProjectMeta('', ...)`. When testing a forced `writeProjectMeta` failure during step 5 enrichment, using `mockRejectedValueOnce` consumed that internal call before the enrichment step. The fix was to use `mockImplementation` with a `planFile !== ''` guard so only the enrichment call with a real path is rejected. This pattern is documented in `tests/tools/enrichment-resilience.test.ts` for future reference and logged in the WP-003 pipeline comments.

**IIFE globals are the right pattern for a no-bundler GUI (WP-004):** All 9 extracted modules expose their API via a single `window.*` global. Consistent naming (`window.Theme`, `window.Router`, etc.) makes dependency tracking easy without requiring a module bundler or import maps. This matches the existing architectural precedent.

**`process.stderr.write` for non-fatal MCP logging (WP-003):** MCP STDIO servers must not write to stdout outside of JSON-RPC message framing. Using `process.stderr.write` for the enrichment failure log is the correct channel and consistent with the rest of the codebase. `console.error` would have caused the same STDIO pollution as `console.log`.

---

## Changelog

All four changes were documented under **v1.10.2** in `mcp-server/changelog.md`, extended incrementally by each WP's Documentation pipeline:

- **WP-001:** `ProjectMetaSchema.status` now references the shared `ProjectStatus` enum from `enums.ts`
- **WP-002:** `GuiConfigPartialSchema` derived from `GuiConfigSchema.omit({ ledger_root: true }).partial()` in `src/gui/config.ts`
- **WP-003:** `initializeProject` enrichment step isolated in nested try/catch; `enrichment_cached: boolean` added to success response
- **WP-004:** `app.js` 1,540-line monolith split into 9 focused modules; `buildQueryString` helper extracted into `api-client.js`
