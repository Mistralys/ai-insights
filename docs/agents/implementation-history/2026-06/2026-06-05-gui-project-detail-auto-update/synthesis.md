# Project Synthesis Report
**Plan:** `2026-06-05-gui-project-detail-auto-update`
**Date:** 2026-06-09
**Status:** COMPLETE
**Work Packages:** 5 / 5 complete — all 4 pipeline stages (implementation → QA → code-review → documentation) passed on all WPs.

---

## Executive Summary

This project delivered a fully dynamic GUI project detail page for the ai-insights MCP server. The page previously required a manual browser refresh to reflect changes to WP statuses, pipeline stages, synthesis availability, health badges, and timing info. The solution introduced periodic 5-second polling backed by a compare-and-swap DOM patching layer, a render-scoped poll state machine (`pollController`), and a snapshot/diff engine — all without any new external dependencies. In parallel, the orchestrator runs section was upgraded from a full `innerHTML` rebuild every 5 seconds to a flicker-free, scroll-preserving in-place patch strategy.

### What Was Built

| Component | Description |
|-----------|-------------|
| **DOM Patch Functions** (WP-001) | Five `_patch*` helpers: `_patchProjectStatus`, `_patchWpRow`, `_patchSynthesisLink`, `_patchHealthBadge`, `_patchTimingInfo` — each performs fresh DOM queries per invocation with compare-and-swap guards |
| **Snapshot / Diff Engine** (WP-002) | `_snapshotProjectState()` and `_diffProjectState()` — pure functions that classify API responses as `none`, `data` (in-place patchable), or `structural` (full re-render) |
| **Combined Poll Loop** (WP-003) | `_pollProjectDetail()` + render-scoped `pollController` state machine with `combined` / `resume` modes; orchestrator run polling integrated into the same 5s tick |
| **Flicker-Free Runs Section** (WP-004) | `_orchRunsStructureKey()` + `_patchOrchStatusCard()` for status card in-place updates; `renderRunsList()` scroll preservation via `scrollTop` save/restore |
| **Integration Test Suite** (WP-005) | 22 new integration tests (12 in `project-detail-auto-update.test.ts` + 10 in `project-detail-runs.test.ts`) verifying DOM identity preservation, inline-edit survival, and single-interval invariant |

---

## Metrics

| Metric | Value |
|--------|-------|
| **Work packages completed** | 5 / 5 |
| **Pipeline stages passed** | 20 / 20 (all WPs × all 4 stages) |
| **Tests passing (final state)** | 1,339 GUI tests / 46 test files (0 failures) |
| **New test files created** | 4 (`project-detail-snapshot.test.ts`, `project-detail-diff.test.ts`, `project-detail-poll.test.ts`, `project-detail-auto-update.test.ts`) |
| **New tests added** | 22 (auto-update integration) + 36 (snapshot/diff unit) + 23 (poll unit) + 19 (scroll unit) = **100 new tests** |
| **Regressions introduced** | 0 |
| **TypeScript type check** | ✅ exit 0 |
| **Syntax check (`node --check`)** | ✅ exit 0 |
| **Primary file modified** | `mcp-server/gui/public/views/project-detail.js` |
| **Documentation files updated** | `tests/gui/README.md`, `gui/docs/agents/project-manifest/data-flows.md`, `gui/docs/agents/project-manifest/constraints.md`, `module-context.yaml` |

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Consolidate `_patchHealthBadge` with the initial render path
**Priority: Low | Source: WP-001, WP-002, WP-003 (Reviewer + QA)**
`_patchHealthBadge` duplicates the inline health-badge rendering block in `renderProjectDetail` (lines ~758–771). Both blocks use identical CSS class names, textContent strings, and plural-form logic. A future pass should have the initial render delegate to `_patchHealthBadge` after element creation, eliminating the duplication and making the health badge a single-source-of-truth render path.

### 2. Extract `renderRunsList` to a module-level function
**Priority: Low | Source: WP-003, WP-004 (Developer)**
`renderRunsList` is a deeply nested closure inside `getRunLogs().then()` that closes over `sorted`, `repo`, `slug`, `activeFilename`, and `lastRunsStructureKey`. The existing refactor-candidate comment acknowledges this. Extracting it as a named function accepting those parameters would improve testability (the scroll-ancestor walk and in-place patch logic currently can't be unit-tested in isolation) and reduce closure depth throughout the orchestrator runs section.

### 3. Extract scroll-ancestor walk into a testable helper
**Priority: Low | Source: WP-004 (Reviewer + Developer)**
The `overflowY`-based ancestor walk in `renderRunsList` is correct for browsers but untestable in jsdom because `window.getComputedStyle` returns empty objects there. Extracting this as a pure helper with an injectable `getStyle` callback would allow direct unit testing of the scroll detection logic without a real browser.

### 4. Address `_pdLogPreviewCleanups` double-drain
**Priority: Low | Source: WP-004 (QA + Reviewer)**
Structural rebuild callers (`pollQueue`, `onKillDone`, `catch` handler) all drain `_pdLogPreviewCleanups` before calling `renderRunsList`, which also drains it internally. The second drain is always a no-op today, but the implicit invariant ("caller must drain before calling `renderRunsList`") is undocumented. A future cleanup should either (a) remove the drain from all callers and leave it solely in `renderRunsList`, or (b) add a comment at the `renderRunsList` drain site explicitly marking it as defensive.

### 5. Document `STAGE_ABBREV` map maintenance contract (completed this cycle)
**Status: RESOLVED in WP-002**
A JSDoc block was added to `STAGE_ABBREV` explaining its role (maps ledger pipeline type strings to display abbreviations), the slice fallback behaviour, and the maintenance contract: any new pipeline type added to the ledger must also be added here to avoid a raw-slice badge label in the GUI.

### 6. `makeProject()` fixture helper divergence in test suite
**Priority: Medium | Source: WP-005 (Reviewer)**
The `makeProject()` helper is defined independently in 5+ test files and has diverged: `project-detail-auto-update.test.ts` uses an escape-hatch `_metaOverrides`/`_rootOverrides` pattern, while `project-detail-runs.test.ts` uses a flat spread that leaks top-level sentinel keys into the `meta` object. No tests break today (the extra keys are ignored), but this will mislead future test authors reading the API shape from fixtures. A shared `tests/gui/helpers/makeProject.ts` fixture should be extracted in the next testing-infrastructure WP.

### 7. `pollController.settleResumePolling` invalidates caller reference
**Status: DOCUMENTED in WP-003**
The JSDoc for `pollController.settleResumePolling` now includes a NOTE block explaining that calling this method triggers a full `renderProjectDetail` re-render, creating a new `pollController` closure — effectively invalidating the caller's reference. Callers must not invoke further `pollController` methods after `settleResumePolling` returns.

---

## Deferred & Follow-Up Items

| ID | Source | Agent | Description | Type | Priority |
|----|--------|-------|-------------|------|----------|
| D-01 | WP-001 | Developer / Reviewer | `_patchSynthesisLink` injection fallback (`document.querySelector('.card-title')`) is dead code — synthesis-link-row is always pre-rendered. Should be removed or replaced with a more specific anchor if the pre-render contract ever changes. | **deferred** | Low |
| D-02 | WP-001 | Developer | `buildRunBadges` still uses raw `<span class="badge badge-in-progress">` strings rather than `UI.badge()` — pre-existing inconsistency with the helper convention. | **deferred** | Low |
| D-03 | WP-002 | Developer | `_snapshotProjectState` uses `s.rework_count || 0` — silently coerces `null`/`undefined` to 0. Future hardening: `s.rework_count != null ? s.rework_count : 0`. | **deferred** | Low |
| D-04 | WP-002 | QA | No test exercises the case where a WP appears in the overview result but has a `null work_package_id`. The guard handles it silently; a defensive test would round out edge coverage. | **deferred** | Low |
| D-05 | WP-003 | Developer | `renderProjectDetail` health badge initial render (lines ~1078–1093) still uses a direct inline callback rather than delegating to `_patchHealthBadge`. Consolidation deferred to avoid scope creep. | **deferred** | Low |
| D-06 | WP-003 | Developer | `pollController.settleResumePolling` does not re-register the combined poll if `renderProjectDetail` fails on the initial `getProject` call (e.g. network error). Future hardening: add an error-state poll that retries periodically. | **deferred** | Low |
| D-07 | WP-003 | QA | `_diffProjectState` has no null-guard on the `prev` argument — null would throw on `Object.keys(prev.wpStatuses)`. Initialization ordering (line 940 before 945) and 5s delay make this safe today. Hardening candidate: add a defensive null-guard or a null-ref unit test. | **deferred** | Low |
| D-08 | WP-003 | QA | Interactive-state guard is captured synchronously before the `Promise.all` fetch. If the user opens a modal *during* the fetch (~50–100ms TOCTOU window), the check will miss it and patches may fire on resolve. Negligible in practice but noted for future hardening if modal interactions grow more complex. | **deferred** | Low |
| D-09 | WP-004 | Developer | `pollQueue` calls `renderOrchToolbar` on every tick (both in-place and structural paths), rebuilding the entire toolbar DOM including Kill/Resume buttons. A future pass could add in-place patch for button enabled/disabled state when the queue entry hasn't structurally changed. | **deferred** | Low |
| D-10 | WP-004 | Developer | `_pollProjectDetail` fetches `getProjectHealth` on every poll cycle even when only `synthesis_generated` or `last_updated` changed. Minor over-fetch (health is cheap). Future: skip health fetch when diff shows no health-relevant changes. | **deferred** | Low |
| D-11 | WP-005 | Reviewer | `makeProject()` in `project-detail-auto-update.test.ts` spreads full overrides into `meta`, causing leakage of sentinel keys (`_metaOverrides`, `synthesis_generated`) as meta properties. No tests break today; consolidate into a shared fixture helper in a future testing-infrastructure WP. | **deferred** | Medium |
| D-12 | WP-005 | Reviewer | Pre-existing: `project-detail-runs.test.ts` global `beforeEach` installs mock implementations first, then calls `vi.clearAllMocks()` — immediately resetting them. `project-detail-auto-update.test.ts` correctly reverses this order. The inconsistency is cosmetic but could confuse future contributors. | **deferred** | Low |

---

## Next Steps (Recommendations for Planner / Manager)

1. **Shared GUI test fixture module** — Extract `makeProject()` and related helpers into `mcp-server/tests/gui/helpers/` to resolve the fixture divergence across 5+ test files (D-11, WP-002 Reviewer). This is the highest-priority testing-infrastructure debt from this cycle.

2. **Health badge consolidation** — Have the initial `renderProjectDetail` render delegate to `_patchHealthBadge` instead of duplicating the inline health-badge render block (D-05, Recommendation §1). Small, self-contained refactor.

3. **`renderRunsList` extraction** — Extract the deeply nested closure as a module-level named function to improve testability of the scroll and in-place patch logic (Recommendation §2). Medium complexity; would enable proper jsdom testing of the scroll-ancestor walk.

4. **`buildRunBadges` UI.badge() migration** — Migrate the two raw badge strings in `buildRunBadges` to `UI.badge()` (D-02) for full consistency with the component library convention.

5. **`_patchSynthesisLink` dead-code cleanup** — Remove or document the injection fallback path in `_patchSynthesisLink` (D-01); the synthesis-link-row is always pre-rendered so the fallback never fires.

6. **End-to-end browser test** — The jsdom test suite cannot assert `document.activeElement` focus state directly. A Playwright / Cypress E2E test for the inline-edit + poll interaction would provide the final confidence layer that the interactive-state guard works correctly in a real browser.

---

*Generated by Head of Operations (Synthesis) — 2026-06-09*
