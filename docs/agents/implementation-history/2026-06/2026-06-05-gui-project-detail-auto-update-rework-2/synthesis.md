# Project Synthesis Report

**Plan:** `2026-06-05-gui-project-detail-auto-update-rework-2`
**Status:** COMPLETE
**Date:** 2026-06-12
**Series:** Third cycle — `rework-2` of `2026-06-05-gui-project-detail-auto-update`

---

## Executive Summary

This rework cycle delivered four purely internal improvements to the MCP Server GUI sub-project, addressing all 8 deferred items and 4 follow-up recommendations left by `rework-1`. No new product features were introduced. The four work packages covered: (1) a targeted micro-cleanup batch adding documentation, defensive null checks, and guard simplifications to `project-detail.js`; (2) strict TypeScript typing for the shared `MakeProjectOpts` fixture interface; (3) splitting the 1479-line `project-detail-runs.test.ts` into three focused test files; and (4) decomposing the 1886-line `project-detail.js` monolith into four sub-modules with clear responsibility boundaries. All 4 WPs completed every pipeline stage (implementation → QA → code-review → documentation) on the first attempt with zero rework cycles. The test suite remained green throughout — 3,214 tests across 109 files, 0 failures.

---

## Metrics Summary

| Metric | Value |
|---|---|
| Work Packages | 4 / 4 COMPLETE |
| Pipeline Stages Total | 16 / 16 PASS |
| Rework Cycles | 0 |
| Tests Passed (final) | 3,214 |
| Tests Failed | 0 |
| Test Files | 109 |
| TypeScript Type Errors | 0 |
| Acceptance Criteria Met | 23 / 23 |

### Per-WP Pipeline Summary

| WP | Title | Stages | Tests |
|---|---|---|---|
| WP-001 | Source micro-cleanup batch | impl ✅ qa ✅ review ✅ docs ✅ | 3,214 pass |
| WP-002 | `MakeProjectOpts` strict typing | impl ✅ qa ✅ review ✅ docs ✅ | 3,214 pass |
| WP-003 | Test file split (`project-detail-runs`) | impl ✅ qa ✅ review ✅ docs ✅ | 3,214 pass |
| WP-004 | `project-detail.js` module decomposition | impl ✅ qa ✅ review ✅ docs ✅ | 3,214 pass |

---

## Work Package Outcomes

### WP-001 — Source Micro-Cleanup Batch
**Files Modified:** `project-detail.js`, `data-flows.md`, `constraints.md`

Four targeted edits applied to `project-detail.js`:
1. **JSDoc on `_pdLogPreviewCleanups`** — Documents both drain sites (renderRunsList pre-rebuild, renderProjectDetail pre-full-render) and the `.length=0` invariant required by WP-004.
2. **Comment on `_patchSynthesisLink` guard** — Explains the empty-div pre-render path when `synthesis_generated` is `false`, making a previously opaque guard self-documenting.
3. **Scroll anchor guard simplification** — Replaced `scrollAnchor ? scrollAnchor.scrollTop : 0` with direct `scrollAnchor.scrollTop`; the redundant `if (scrollAnchor)` restore guard was removed. Safe because `_findScrollAnchor` always returns a non-null element.
4. **`if (cleanup)` null guard** — Defensive guard added before `_pdLogPreviewCleanups.push(cleanup)` to protect against a null/undefined return from `OrchestratorWidgets.renderLogPreview`. Purely defensive — current callee always returns a function.

External docs (`data-flows.md §9`, `constraints.md §11`) updated to reflect the dual-drain-site invariant and the null-guard convention for cleanup consumers.

---

### WP-002 — `MakeProjectOpts` Strict Typing
**Files Modified:** `make-project.ts`, `README.md`

Replaced the `[key: string]: unknown` index signature in `MakeProjectOpts` with 8 explicit optional fields (`meta`, `work_packages`, `project_comments`, `project_name`, `timing`, `server_version`, `ledger_version`, `synthesis_generated`). The function body was updated to destructure all 8 fields explicitly (no rest spread). The "Type-safety tradeoff" JSDoc advisory was replaced with a "Type safety" confirmation section. The type-safety advisory blockquote was removed from `tests/gui/README.md`.

**Impact:** Root-level key typos (`makeProject({ statues: 'COMPLETE' })`) are now compile-time errors across all 8 consumer test files. `tsc --noEmit` passes clean.

Side effect found and fixed by Documentation: the `tests/gui/README.md` consumer table listed only 6 project-detail test files; 2 were missing (`project-detail-poll.test.ts`, `project-detail-scroll.test.ts`). Corrected; also updated `renderWithAPI` sync callout from "three files" to "four files".

---

### WP-003 — Test File Split: `project-detail-runs.test.ts`
**Files Modified:** `project-detail-runs.test.ts` (trimmed), `project-detail-resume.test.ts` (new), `project-detail-poll-modes.test.ts` (new), `README.md`

Split the 1,479-line monolith into three focused, self-contained test files:

| File | Describe Blocks | Lines |
|---|---|---|
| `project-detail-runs.test.ts` (trimmed) | Orchestrator Runs section, queue-aware active run | 712 |
| `project-detail-resume.test.ts` (new) | showResumeError helper, Resume Run button | 544 |
| `project-detail-poll-modes.test.ts` (new) | Inline edit survives poll ticks, Single-interval invariant, Modal and archive/unarchive under polling | 575 |

Each file is fully self-contained with its own imports, `beforeAll`/`beforeEach` setup, `declare global` block, and `renderWithAPI` helper (~40 lines, intentionally duplicated per WP spec to avoid coupling). Files pass both in isolation and in combination. `README.md` updated with a project-detail Test File Map and stub-key sync notes for `renderWithAPI`.

---

### WP-004 — `project-detail.js` Module Decomposition
**Files Modified:** `project-detail-helpers.js` (new), `project-detail-orch.js` (new), `project-detail-modal.js` (new), `project-detail.js` (trimmed), `index.html`, 10 test files, `work-package.js`, `file-tree.md`, `data-flows.md`, `constraints.md`

Decomposed the 1,886-line monolith into 4 files loaded in dependency order:

| File | Contents | Lines |
|---|---|---|
| `project-detail-helpers.js` | `extractSynopsis`, `STAGE_ABBREV`, `buildPipelineTrack`, `buildRunBadges`, `_findScrollAnchor`, `_snapshotProjectState`, `_diffProjectState` | ~240 |
| `project-detail-orch.js` | `renderOrchToolbar`, `renderRunsList`, `_orchRunsStructureKey`, `_patchOrchStatusCard` | ~310 |
| `project-detail-modal.js` | `PIPELINE_STAGES`, `showResetModal` | ~270 |
| `project-detail.js` (main) | Module header, `_pdLogPreviewCleanups` init + globalThis promotion, patch functions, `_pollProjectDetail`, `renderProjectDetail` | ~1,041 |

The `_pdLogPreviewCleanups` array is initialized in `project-detail.js` and promoted to `globalThis._pdLogPreviewCleanups`. The orch module accesses it exclusively via `globalThis`. All drain sites use `.length = 0` (in-place mutation) to preserve array identity across module boundaries.

All 9 GUI test files updated to load the 3 new sub-modules via `vm.runInThisContext` in dependency order before `project-detail.js`. A bonus fix: `client-rendering.test.ts` (outside the 9-file scope) was updated to load only `project-detail-helpers.js` instead of the full `project-detail.js` (more precise minimal dependency).

Reviewer fix-forward: stale dependency comment in `work-package.js` (`STAGE_ABBREV (project-detail.js)` → `STAGE_ABBREV (project-detail-helpers.js)`) corrected.

Documentation updated: `file-tree.md` (4 new sub-module entries), `data-flows.md §3` (new §3a documenting 4-file load order and `globalThis` shared-state invariant), `constraints.md §3` (new subsection on cross-module shared state and `.length=0` drain requirement).

---

## Strategic Recommendations (Gold Nuggets)

### Architecture

1. **Existing section comment boundaries are reliable decomposition guides.** WP-004 confirmed that the pre-existing section comments in `project-detail.js` exactly delineated the final module boundaries. When planning future splits of large non-ESM view files, trust the existing inline structure — mechanical extraction with no boundary ambiguity is achievable when the original author already documented responsibility zones.

2. **`globalThis` promotion + in-place drain is the correct cross-module shared-state pattern for non-ESM browser scripts.** The `_pdLogPreviewCleanups` pattern (init in main, promote to `globalThis`, use `.length=0` at all drain sites) preserves array identity across module boundaries and is now fully documented in `constraints.md §3`. Apply this pattern consistently for any future shared mutable state in this codebase.

3. **Pre-document WP-forward constraints at the declaration site.** WP-001 added a JSDoc on `_pdLogPreviewCleanups` documenting the `.length=0` invariant before WP-004 existed in the code. The Reviewer rated this "a good pattern: document constraints at the declaration site before the consuming WP arrives." Adopt this proactively for future multi-WP plans.

### Testing

4. **Self-contained test files with duplicated `renderWithAPI` outperform shared test helpers at this scale.** The decision to duplicate `renderWithAPI` (~40 lines × 3 files) rather than extract a shared module was validated by QA and Review: no cross-contamination in concurrent runs, each file can evolve its stub shape independently, and the duplication cost is low-maintenance. Reserve shared test helper extraction for helpers >100 lines or referenced by >5 files.

5. **Use a `README.md` Test File Map as the single discovery point for large test suites.** The `tests/gui/README.md` `### project-detail Test File Map` section (added in WP-003/WP-002 documentation passes) gives contributors a navigable overview of all 8 project-detail test files with their feature areas and describe blocks. This is more effective than relying on cross-references in individual file headers.

6. **Stub-key sync notes in `renderWithAPI` JSDoc prevent silent omission on API expansion.** The stub-key enumeration + "update all N files" instruction added to all three sibling files' `renderWithAPI` JSDoc is a low-cost mechanism to prevent a contributor from adding a new API method and only stubbing it in one file. Apply this pattern whenever a helper is intentionally duplicated.

### Type Safety

7. **Explicit interface fields are strictly preferable to index signatures for shared test fixture factories.** WP-002 confirmed the upgrade path from `[key: string]: unknown` to explicit optional fields is mechanical, zero-runtime-overhead, and immediately active across all consumers. Avoid index signature escape hatches in new `make-*` fixture helpers from the outset.

---

## Deferred & Follow-Up Items

No items were explicitly deferred or marked out-of-scope during this cycle. All 8 deferred items and 4 follow-up recommendations from `rework-1` were fully addressed. The following forward items emerged from pipeline comments and should seed the next cycle's plan:

### Documentation-Forward (Low Priority)

| Source | Agent | Description | Priority |
|---|---|---|---|
| WP-001 / documentation pipeline | Documentation | After WP-004 was implemented, the `_pdLogPreviewCleanups` JSDoc forward-reference language ("WP-004 requirement") was left in place. A future documentation pass should update the JSDoc to remove the forward-reference wording and reflect the actual state (globalThis promotion complete). | Low |
| WP-003 / code-review | Reviewer | `renderWithAPI` stub keys are duplicated verbatim across the three sibling test files (runs, resume, poll-modes). If a new API method is added, a contributor must update all three (now four, per WP-002 doc fix). The stub-key sync JSDoc mitigates this, but a shared type definition or `TESTING.md` extract for the stub shape would eliminate the risk entirely. | Low |

### Stale Reference Fixed In-Cycle

- `work-package.js` line 5 stale comment (`STAGE_ABBREV (project-detail.js)`) was detected by QA and fixed by the Reviewer as a fix-forward during WP-004. No action needed.

### Minor Correctness Issue (Fixed In-Cycle)

- `tests/gui/README.md` consumer table was missing `project-detail-poll.test.ts` and `project-detail-scroll.test.ts` from the `makeProject` consumers list (6 listed, 8 actual). Fixed during WP-003/WP-002 documentation passes. No further action needed.

---

## Files Changed This Cycle

### New Files
- `mcp-server/gui/public/views/project-detail-helpers.js`
- `mcp-server/gui/public/views/project-detail-orch.js`
- `mcp-server/gui/public/views/project-detail-modal.js`
- `mcp-server/tests/gui/project-detail-resume.test.ts`
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts`

### Modified Files
- `mcp-server/gui/public/views/project-detail.js` (WP-001 micro-cleanup + WP-004 trim)
- `mcp-server/gui/public/index.html` (WP-004 script tags)
- `mcp-server/gui/public/views/work-package.js` (WP-004 reviewer fix-forward)
- `mcp-server/tests/gui/project-detail-runs.test.ts` (WP-003 trim + WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-resume.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-poll-modes.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-snapshot.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-diff.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-poll.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-scroll.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-auto-update.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/project-detail-helpers.test.ts` (WP-004 multi-script load)
- `mcp-server/tests/gui/client-rendering.test.ts` (WP-004 bonus precision fix)
- `mcp-server/tests/gui/helpers/make-project.ts` (WP-002 interface narrowing)
- `mcp-server/tests/gui/README.md` (WP-002 + WP-003 documentation)
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` (WP-001 + WP-004)
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` (WP-001 + WP-004)
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` (WP-004)

---

## Next Steps for the Planner

1. **No urgent follow-up WPs are required.** All deferred items from `rework-1` are resolved. The two documentation-forward items above are cosmetic and low-priority — they can be addressed opportunistically or batched into the next plan touching `project-detail.js`.

2. **`project-detail.js` main is now ~1,041 lines.** The module decomposition goal was to reduce cognitive load; the main file is within acceptable range for a non-ESM view. No further split is recommended unless new functionality grows it significantly.

3. **The next structural improvement candidates in this codebase are likely:** (a) similar test file splits for other large `project-detail-*.test.ts` files if they grow beyond 1,000 lines; (b) a module decomposition pass on `work-package.js` (no immediate pressure, but it is now the largest remaining single-file view); (c) extending strict `MakeProjectOpts`-style typing to other fixture factories in `tests/gui/helpers/` if new helpers are added with index signatures.

4. **Consider a formal `TESTING.md`** (not just `README.md`) to house the stub-key inventory and cross-file sync instructions as the test suite continues to grow. The current `README.md` is doing double duty as both an onboarding guide and a technical reference.

---

*Report generated by Head of Operations (Synthesis Agent) — 2026-06-12*
