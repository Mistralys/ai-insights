# Synthesis Report — GUI Project Detail Auto-Update Rework 1

**Plan:** `2026-06-05-gui-project-detail-auto-update-rework-1`  
**Date:** 2026-06-11  
**Status:** COMPLETE — All 4 work packages passed all pipeline stages (16/16 stages PASS, 0 FAIL)

---

## Executive Summary

This project delivered a focused **code quality and testability rework** of
`mcp-server/gui/public/views/project-detail.js` and its GUI test suite. The
goals were: (1) eliminate 6 diverged local `makeProject()` fixture
implementations across the GUI test suite; (2) remove dead code, inline DOM
writes, and raw badge strings from the view script; and (3) extract two
significant inline closures (`renderRunsList` and `_findScrollAnchor`) into
module-level testable functions with dedicated unit tests.

No new product features were added. All changes are pure internal improvements
— dead-code removal, code-style normalisation, test infrastructure uplift, and
extracting untestable inline logic into named, injectable, directly-testable
helpers.

The full test suite grew from 3205 tests (106 files) to **3214 tests
(107 files)** — a net gain of 9 tests covering the two newly extracted helpers.
All tests passed at every WP boundary; zero regressions were introduced.

---

## Metrics Summary

| Metric | Value |
|---|---|
| Work packages | 4 |
| Pipeline stages total | 16 (4 WPs × 4 stages) |
| Pipeline stages PASS | 16 |
| Pipeline stages FAIL | 0 |
| Rework cycles | 0 |
| Tests at project start | 3205 / 106 files |
| Tests at project end | 3214 / 107 files |
| Net new tests added | 9 |
| Test failures at final state | 0 |
| Security issues | 0 |
| Source files changed | 12 |

### Per-WP Outcomes

| WP | Title | Tests at completion | Outcome |
|---|---|---|---|
| WP-001 | Shared makeProject() fixture helper | 3205 / 0 failures | COMPLETE |
| WP-002 | Source cleanup batch | 3205 / 0 failures | COMPLETE |
| WP-003 | Health badge consolidation | 3205 / 0 failures | COMPLETE |
| WP-004 | renderRunsList extraction + _findScrollAnchor | 3214 / 0 failures | COMPLETE |

---

## Artifacts Produced

| File | Change | WP |
|---|---|---|
| `mcp-server/tests/gui/helpers/make-project.ts` | **Created** — shared `makeProject()` fixture factory with `MakeProjectOpts` API | WP-001 |
| `mcp-server/tests/gui/project-detail-snapshot.test.ts` | Migrated to shared helper | WP-001 |
| `mcp-server/tests/gui/project-detail-diff.test.ts` | Migrated to shared helper | WP-001 |
| `mcp-server/tests/gui/project-detail-poll.test.ts` | Migrated to shared helper | WP-001 |
| `mcp-server/tests/gui/project-detail-scroll.test.ts` | Migrated to shared helper | WP-001 |
| `mcp-server/tests/gui/project-detail-runs.test.ts` | Migrated to shared helper + D-12 bug fix | WP-001 |
| `mcp-server/tests/gui/project-detail-auto-update.test.ts` | Migrated to shared helper | WP-001 |
| `mcp-server/tests/gui/README.md` | Updated documentation; removed stale Option A/B discussion; added type-safety advisory | WP-001 |
| `mcp-server/gui/public/views/project-detail.js` | Source cleanup (WP-002), health badge consolidation (WP-003), renderRunsList + _findScrollAnchor extraction (WP-004) | WP-002/003/004 |
| `mcp-server/tests/gui/project-detail-helpers.test.ts` | **Created** — 9 unit tests for `_findScrollAnchor` (×3) and `renderRunsList` (×6) | WP-004 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Added `tests/gui/helpers/make-project.ts`; updated `project-detail.js` and `project-detail-helpers.test.ts` entries | WP-001/004 |

---

## Strategic Recommendations (Gold Nuggets)

### 1. Delegate-to-helper pattern is now consistently enforced in project-detail.js

All four WPs applied the same pattern: inline DOM-write logic → named helper
call. `_patchHealthBadge`, `UI.badge()`, `_patchSynthesisLink`, and
`renderRunsList` now own their respective DOM concerns. Future contributors
should follow this pattern: if a callback body exceeds 3–4 lines and has a
clear responsibility, extract it into a named module-level function.

### 2. Shared fixture factory prevents future test drift

The 6 diverged local `makeProject()` implementations were the root cause of the
`D-12` mock-ordering bug and ongoing fixture-shape confusion. The new
`tests/gui/helpers/make-project.ts` factory with the `MakeProjectOpts`
meta/root separation is the single source of truth for GUI test fixture data.
Any future test file that needs a project fixture **must** import from this
helper — never define a local one.

### 3. globalThis exposure pattern enables direct testing of module-level helpers

Both `_findScrollAnchor` and `renderRunsList` are exposed via `globalThis` at
the end of `project-detail.js`, enabling direct test access via
`vm.runInThisContext`. This pattern (already established in the codebase) should
be the standard approach for any future module-level helper that needs direct
unit test coverage but lives in a non-ESM browser JS file.

### 4. Injectable _getStyle parameter for testability without mocking

`_findScrollAnchor(el, _getStyle)` defaults to `window.getComputedStyle` in
production but accepts an injectable style function in tests. This is a clean
alternative to global mock patching and should be the preferred pattern when
extracting helpers that depend on browser APIs.

### 5. D-12 root-cause documented: vi.clearAllMocks() placement matters

The `project-detail-runs.test.ts` `beforeEach` previously called
`vi.clearAllMocks()` after setting up mock implementations, silently clearing
the mocks it had just configured. The fix — moving `vi.clearAllMocks()` to
execute before all mock setup — is now the enforced pattern. Reviewers should
watch for this ordering pitfall in any `beforeEach` that both clears and
configures mocks.

---

## Deferred & Follow-Up Items

These items were explicitly noted as out-of-scope or deferred by agents during the project. The Planner should consider them as candidates for a follow-up WP.

| # | Source | Agent | Item | Priority | Type |
|---|---|---|---|---|---|
| 1 | WP-004 | Developer | `project-detail.js` is 1930+ lines. Consider splitting into sub-modules (e.g. `project-detail-orch.js`) to improve maintainability. | Low | deferred |
| 2 | WP-002 | Developer/QA/Reviewer | The outer `_pdLogPreviewCleanups` pre-drain at the pollQueue structural-change branch (lines 1424–1425) is now redundant — `renderRunsList` drains internally. Consolidate in a follow-up WP. | Low | deferred |
| 3 | WP-002 | Developer/Documentation | The inner `if (!row.querySelector('.synthesis-link') && repo && slug)` fallback guard inside `_patchSynthesisLink` may be dead code if `renderProjectDetail` always pre-renders the row with a populated href. Confirm and remove if so; update JSDoc. | Low | deferred |
| 4 | WP-001 | Developer | `project-detail-runs.test.ts` is ~1490 lines. Consider splitting into focused sub-files (e.g. `project-detail-resume-btn.test.ts`, `project-detail-polling.test.ts`). | Low | deferred |
| 5 | WP-001 | Developer/QA | `MakeProjectOpts` uses `[key: string]: unknown` as an index signature — TypeScript will not catch root-level key typos (e.g. `makeProject({ statues: 'COMPLETE' })`). A stricter type would give better feedback. Type-safety advisory added to README and JSDoc as interim mitigation. | Low | deferred |
| 6 | WP-003 | Developer | `var healthBadge` at line 1236 is now only referenced by the `.catch()` handler. If a future pass removes or refactors the catch, this `var` can also be removed. | Low | deferred |
| 7 | WP-004 | Reviewer | `_pdLogPreviewCleanups.push(cleanup)` does not guard against a null/undefined return from `renderLogPreview`. A minimal `if (cleanup)` guard would be slightly cleaner (current try-catch handles it silently). | Low | deferred |
| 8 | WP-004 | Reviewer | `_findScrollAnchor` always returns a non-null `Element` (`document.documentElement` minimum), so the `scrollAnchor ?` null guard in `renderRunsList` is redundant. Harmless defensive coding. | Low | deferred |

---

## Next Steps for Planner / Manager

1. **Redundant pre-drain consolidation (high-value, low-risk):** Item #2 above is a direct consequence of WP-004's `renderRunsList` extraction. A 1-WP follow-up to remove the outer drain call at lines 1424–1425 and confirm `_patchSynthesisLink`'s inner guard (item #3) would complete the cleanup series cleanly.

2. **project-detail.js file split:** At 1930+ lines, the file is approaching a size where modular decomposition would pay dividends. This is a more involved WP (requires careful module boundary design and test updates) but would significantly reduce cognitive load.

3. **Test file organisation:** `project-detail-runs.test.ts` at ~1490 lines is a similar case on the test side. Splitting it into focused files would improve discoverability without any production code changes.

4. **MakeProjectOpts type strengthening:** Low risk, high DX value — switching to a strict type (removing the `[key: string]: unknown` escape hatch) would give TypeScript callers full typo protection on fixture factory calls.
