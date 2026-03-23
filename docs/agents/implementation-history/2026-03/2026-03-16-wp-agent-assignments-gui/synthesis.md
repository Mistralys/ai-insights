# Project Synthesis Report

**Project:** `2026-03-16-wp-agent-assignments-gui`
**Date:** 2026-03-16
**Status:** COMPLETE
**Version Released:** v1.12.0 (from v1.11.3)

---

## Executive Summary

This session delivered **pipeline stage visibility** across both views of the GUI dashboard. Three work packages were completed in a clean dependency chain:

1. **WP-001** — New backend API endpoint `GET /api/projects/:slug/work-packages/overview` returning typed `WpOverviewEntry[]` with per-stage status, agent assignment, AC progress, rework counts, and blocker data.
2. **WP-002** — Frontend redesign of the project detail table: replaced the redundant "Title" column with a colored pipeline stage badge track, with graceful degradation when the new endpoint is unavailable.
3. **WP-003** — WP detail view enhanced with a "Pipeline Progression" bar above the Pipelines section, deriving all data from the already-fetched WP detail (zero extra API calls).

One blocking rework cycle occurred in WP-003 (a mutation bug caught by the Reviewer, patched and re-reviewed in the same session). All three WPs are fully released and documented as of v1.12.0.

---

## Metrics

| Work Package | Tests Passed | Tests Failed | Security Issues | Rework Cycles |
|---|---|---|---|---|
| WP-001 | 21 (new) + 1302 total | 0 | 0 | 0 |
| WP-002 | 1302 | 0 | 0 | 0 |
| WP-003 | 1302 | 0 | 0 | 1 |
| **Totals** | **1302 passing** | **0** | **0** | **1** |

- **New test file:** `mcp-server/tests/gui/api-wp-overview.test.ts` — 21 tests covering all 6 ACs and edge cases (corrupt file skip, rework resolution, STDIO discipline, canonical stage ordering, empty project).
- **Pipeline health:** 3/3 WPs with all stages PASS.
- **All 19 acceptance criteria across 3 WPs confirmed met.**

---

## Rework Events

### WP-003 — Code Review FAIL → Rework PASS

**Bug:** `Array.prototype.reverse()` mutation in `renderWorkPackageDetail`. The line `(wp.pipelines || []).reverse().map(...)` mutated `wp.pipelines` in place before `buildWpDetailBar(wp)` consumed it downstream. For any WP with rework entries, the progression bar displayed the oldest pipeline status rather than the latest.

**Fix:** Changed to `(wp.pipelines || []).slice().reverse().map(...)` — one character addition, fully ES5-compatible, zero regressions.

**Root cause note:** The implementation session carried WP-003 forward alongside WP-002 (a natural forward-carry given shared CSS/constants), but the cross-function mutation dependency between `renderWorkPackageDetail`'s display-order reversal and `buildWpDetailBar`'s chronological iteration wasn't caught until the Reviewer's pass.

---

## Files Modified

| File | WP |
|---|---|
| `mcp-server/gui/api.ts` | WP-001 |
| `mcp-server/gui/server.ts` | WP-001 |
| `mcp-server/tests/gui/api-wp-overview.test.ts` | WP-001 (new) |
| `mcp-server/gui/public/api-client.js` | WP-002 |
| `mcp-server/gui/public/views/project-detail.js` | WP-002 |
| `mcp-server/gui/public/styles.css` | WP-002 |
| `mcp-server/gui/public/views/work-package.js` | WP-003 (×2) |
| `mcp-server/changelog.md` | WP-003 |
| `mcp-server/package.json` | WP-003 |
| `mcp-server/README.md` | WP-003 (docs) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-003 (docs) |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-003 (docs) |

---

## Strategic Recommendations

### 1. Client/Server Stage Default Duplication (Low — Deferred Debt)
`WP_DEFAULT_STAGES` in `work-package.js` is a hardcoded copy of `DEFAULT_PIPELINE_STAGES` from `pipeline-maps.ts`. If the default stage list changes server-side, the client fallback silently diverges. **Recommended fix:** expose the default stages in the WP detail API response (or a `/api/config` endpoint) so the client reads from the canonical source.

### 2. Missing jsdom Unit Tests for Client Rendering Functions (Low — Test Gap)
`buildWpDetailBar` and `buildPipelineTrack` have no automated unit tests — manual browser verification is the only test path. The rework mutation bug above was missed in the implementation pass because the relevant rendering path isn't covered by any test. **Recommended fix:** add lightweight jsdom-based tests for critical rendering branches (rework display, empty pipelines, stage ordering, graceful degradation fallback).

### 3. XSS Defence-in-Depth: escapeHtml for tooltip rawSt (Low — Convention Alignment)
In `work-package.js buildWpDetailBar`, `tooltip += ' — ' + rawSt` appends a raw status string without `escapeHtml()`. The value is schema-constrained so there is no current risk, but this is inconsistent with the rest of the codebase. **Recommended fix:** `tooltip += ' — ' + escapeHtml(rawSt)`.

### 4. WpPipelineStage and WpOverviewEntry Type Precision (Low — Type Safety)
In `gui/api.ts`, `WpPipelineStage.type` is typed as `string` and `WpOverviewEntry.status` as `string`. These could be narrowed to `PipelineType` and `WorkPackageStatus` respectively without any runtime change, giving downstream consumers compile-time safety. A short follow-up PR would suffice.

### 5. serveStatic Resolver Naming (Low — Pre-existing Mislead)
In `server.ts`, `const resolved = filePath` assigns `filePath` without calling `path.resolve()`, despite the variable name implying resolution. The guard relies on `path.join()`'s normalization of `..` components — functionally correct but misleading. **Recommended fix:** use `const resolved = resolve(filePath)` with the `resolve` import.

### 6. api-surface.md "app.js structure" Section Heading (Low — Doc Debt)
The api-surface.md document still groups frontend function descriptions under an "app.js structure" heading, but `app.js` is now only a 7-line bootstrap; the actual logic lives in `views/*.js` and `api-client.js`. A future documentation pass should update the section heading and attribute each function to its actual module file.

---

## Next Steps

| Priority | Action |
|---|---|
| Medium | Add jsdom-based unit tests for `buildWpDetailBar` and `buildPipelineTrack` — the rework mutation bug demonstrated the blind spot |
| Low | Expose `DEFAULT_PIPELINE_STAGES` via the WP detail or a config API endpoint to eliminate `WP_DEFAULT_STAGES` duplication |
| Low | Apply `escapeHtml(rawSt)` in `buildWpDetailBar` tooltip construction |
| Low | Narrow `WpPipelineStage.type` → `PipelineType` and `WpOverviewEntry.status` → `WorkPackageStatus` in `gui/api.ts` |
| Low | Refactor `api-surface.md` "app.js structure" section to reflect the current modular frontend layout |
| Low | Fix `serveStatic` resolver naming in `server.ts` |

---

*Synthesis generated by Head of Operations (Synthesis) — 2026-03-16*
