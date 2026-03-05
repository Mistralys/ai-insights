# Synthesis — Project Reset: Strategic Recommendations Rework

**Project:** `2026-03-04-project-reset-rework-1`
**Completed:** 2026-03-05
**MCP Server version delivered:** v1.10.0
**Status:** ✅ COMPLETE — All 4 work packages delivered, all 43 acceptance criteria met.

---

## Executive Summary

This project implemented the four strategic recommendations from the [2026-03-04-project-reset synthesis](../2026-03-04-project-reset/synthesis.md) as additive, non-breaking enhancements to the semi-intelligent project reset feature. All changes landed in a single session on 2026-03-05 with zero regressions against the 1040-test baseline and 12 new targeted tests added (1052 total). TypeScript compilation is clean at 0 errors throughout.

The three code WPs (SR-1, SR-2, SR-4) were each fully implemented before the relevant agents began their pipelines — a pattern that compressed the session timeline significantly. The smoke-test WP (SR-3) executed the healthy-path, confirming the full stack (GUI server, health endpoint, `pipeline_health` MCP field) behaves correctly on a real project.

---

## Work Package Outcomes

### WP-001 — SR-1: `reset_at` Timestamp on WP Detail ✅

**Changes:**
- Added `reset_at: z.string().optional()` to `WorkPackageDetailSchema` in `src/schema/work-package.ts` (after `status_changed_at`).
- Set `wp.reset_at = timestamp` in the `reset` action block of `applyProjectReset()` in `src/utils/project-reset.ts` — `cancel` and `skip` actions do not set this field.

**Tests added:** 4 (3 unit in `project-reset.test.ts`, 1 integration in `api-reset.test.ts`). Total: 1044 passing.

**AC result:** 10/10 met. No deviations.

**Key facts:**
- The field is optional with no default; all existing WP JSON files parse without modification.
- `reset_at` equals `status_changed_at` on the same reset — they are set from the same `timestamp` variable in the same mutation block.
- `api-surface.md` updated to document semantics.

---

### WP-002 — SR-2: Pipeline Health Badge on Project Detail Page ✅

**Changes:**
- **`src/utils/project-reset.ts`** — Exported `getPassedStages` (pure export, no logic change).
- **`gui/api.ts`** — Added `handleGetProjectHealth()` (lines ~611–651): validates slug via `assertSafeSlug`, guards with `ledgerDirExists()`, reads all WP detail files in parallel via `Promise.all()`, delegates to `analyzeProjectForReset()`, returns `ProjectHealthSummary` (`{ work_packages_needing_reset, work_packages_healthy, work_packages_skipped, total_work_packages }`). Pure read — no writes.
- **`gui/server.ts`** — Wired `GET /api/projects/:slug/health` at line ~201, **before** the more general `GET /api/projects/:slug` route (prevents `"health"` being interpreted as a WP ID).
- **`gui/public/app.js`** — Added `API.getProjectHealth(slug)` method. In `renderProjectDetail()`, a `<span id="health-badge">` placeholder is rendered synchronously in the header; an async call fires after `innerHTML` is assigned; on success, the badge transitions to green (`✓ All pipelines complete`) or amber (`⚠ N WPs need attention`); a silent `.catch()` removes the badge without crashing the page.
- **`gui/public/styles.css`** — Added `.health-badge`, `.health-badge.healthy`, `.health-badge.attention` — pill-shaped using `var(--radius-pill)`, `var(--color-text-muted)`, `var(--color-complete)`, `var(--color-in-progress)` plus hardcoded hex backgrounds consistent with other badge patterns in the file.

**Tests added:** 4 integration tests in `api-reset.test.ts` (healthy project, broken project, non-existent slug → 404, path-traversal slug → 404). Plus 4 from WP-001 carried forward. Total: 1052 passing.

**AC result:** 15/15 met. One wording imprecision in AC-4 noted but not a defect (see Deviations).

---

### WP-003 — SR-4: Aggregate Pipeline Health in `get_project_status` ✅

**Changes:**
- **`src/tools/project-lifecycle.ts`** — Added `computePipelineHealth()` private helper: iterates all non-CANCELLED WP detail files via `for...of` with a silent `catch` on unreadable files; calls `getPassedStages()` per WP; computes `wps_with_all_stages_pass`, `wps_missing_stages`, `total_stages_missing` using `PIPELINE_TYPES.length - passed.size`. Called in **both** response branches of `getProjectStatus()` (healed and unchanged).

**Tests added:** 4 integration tests in `project-lifecycle.test.ts` covering healthy project, broken project (only `implementation` PASS), CANCELLED WP exclusion, and unreadable WP skip. Total: 1052 passing (unchanged from WP-002 — WP-003 implementation was already in place).

**AC result:** 11/11 met. No deviations.

**Key behavior:**
- CANCELLED WPs contribute to neither `wps_with_all_stages_pass` nor `wps_missing_stages`.
- Unreadable WP files are silently skipped; the response always succeeds.
- A "broken" WP with only `implementation PASS` out of 4 pipeline types has `total_stages_missing = 3`.

---

### WP-004 — SR-3: Manual Smoke-Test ✅

**Outcome: Healthy-path executed.**

The target project (`2026-03-04-preserve-index-metadata`) was already fully healed by a prior reset (admin_action comment dated `2026-03-05T08:23:43Z`). This exercised the healthy-state path:

| Verification | Result |
|---|---|
| GUI server starts (`npm run gui`, port 24679) | ✅ |
| `GET /api/projects/2026-03-04-preserve-index-metadata/health` | `{ needing_reset: 0, healthy: 6, skipped: 0, total: 6 }` |
| MCP `pipeline_health` (computed via `tsx`) | `{ wps_with_all_stages_pass: 6, wps_missing_stages: 0, total_stages_missing: 0 }` |
| `GUI` health badge state | Green — "All pipelines complete" |
| Errors or UI crashes | None |

**AC result:** 7/7 met. No code changes required.

---

## Files Modified

| File | Change |
|---|---|
| `mcp-server/src/schema/work-package.ts` | `reset_at: z.string().optional()` added to `WorkPackageDetailSchema` |
| `mcp-server/src/utils/project-reset.ts` | `getPassedStages` exported; `wp.reset_at = timestamp` in reset action block |
| `mcp-server/src/tools/project-lifecycle.ts` | `computePipelineHealth()` helper + `pipeline_health` on `getProjectStatus` response |
| `mcp-server/gui/api.ts` | `handleGetProjectHealth()` added |
| `mcp-server/gui/server.ts` | `GET /api/projects/:slug/health` route wired |
| `mcp-server/gui/public/app.js` | `API.getProjectHealth()` method + async health badge in `renderProjectDetail()` |
| `mcp-server/gui/public/styles.css` | `.health-badge` pill CSS variants |
| `mcp-server/tests/utils/project-reset.test.ts` | 3 new unit tests for `reset_at` field |
| `mcp-server/tests/gui/api-reset.test.ts` | 5 new integration tests (1 for `reset_at`, 4 for `/health` endpoint) |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | 4 new integration tests for `pipeline_health` |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `reset_at`, `ProjectHealthSummary`, `/health` route, `pipeline_health` documented |
| `mcp-server/docs/agents/project-manifest/constraints.md` | AC-authoring note added to constraint 40 (slug validation → 404 NOT_FOUND) |
| `mcp-server/changelog.md` | v1.10.0 entry covering all project-reset features (base + rework-1) |
| `mcp-server/package.json` | Version bumped to 1.10.0 via `sync-version.js` |

No new files were created. All changes are additive edits to existing files.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages | 4 / 4 COMPLETE |
| Acceptance criteria | 43 / 43 met |
| Tests at project start | 1,040 |
| Tests at project end | **1,052** (+12) |
| Test failures | 0 |
| TypeScript errors | 0 |
| New files created | 0 |
| Files modified | 14 |

---

## Deviations & Observations

### AC-4 Wording Imprecision (WP-002)

The original plan states: *"Invalid slug characters return 400 VALIDATION_ERROR."* The actual behavior — and the behavior of every other slug-bearing handler in `api.ts` — is **404 NOT_FOUND**. This is a deliberate security choice: `assertSafeSlug` intentionally masks traversal detection by returning `NOT_FOUND` rather than signalling that the input was identified as a traversal attempt.

**Verdict:** Not a defect. The behavior is correct and safe. The AC wording is imprecise relative to the implementation. Future plans should use `"Invalid slug returns 404 NOT_FOUND"` to match reality.

### Sequential WP Detail Reads in `handleGetProjectHealth()` (WP-002) — Resolved

`handleGetProjectHealth()` originally used a `for...of` sequential loop. Replaced with `Promise.all()` on 2026-03-05 as part of the post-project follow-up. The `.filter((wp): wp is WorkPackageDetail => wp !== null)` guard preserves the silent-skip behaviour for unreadable files.

**Verdict:** Resolved.

---

## Strategic Recommendations for Future Work

The four strategic recommendations from the parent synthesis are now fully implemented. The project-reset feature — both the core reset pipeline (from `2026-03-04-project-reset`) and these health-visibility extensions — is production-complete.

Two minor follow-up items identified during this project — both implemented 2026-03-05:

1. ✅ **Parallelize `handleGetProjectHealth()` reads** — replaced the `for...of` loop with `Promise.all()` + `.filter()` in `gui/api.ts`. All WP files are now fetched concurrently; errored reads are still silently skipped. TypeScript compiles clean.

2. ✅ **Update plan template AC wording for slug validation** — added an explicit AC-authoring note to constraint 40 in `mcp-server/docs/agents/project-manifest/constraints.md`: use `"Invalid slug returns 404 NOT_FOUND"` (not `"400 VALIDATION_ERROR"`) in future plans that exercise `assertSafeSlug` rejection.

No architectural changes or new features are recommended at this time.
