# Synthesis Report — Cancelled WP Logic Fixes

**Plan:** `2026-06-03-cancelled-wp-logic-fixes`
**Date:** 2026-06-03
**Status:** COMPLETE
**Work Packages:** 8 / 8 COMPLETE — all pipelines PASS

---

## Executive Summary

This session delivered two targeted correctness fixes to the MCP server's pipeline routing
system, eliminating two distinct bug classes that caused legitimate work to be incorrectly
blocked or misrouted.

**Bug 1 — False rework signals (`hasDownstreamReengagedSince`):** The downstream
re-engagement detector was returning `true` for any downstream pipeline that started after an
upstream PASS, regardless of whether that downstream pipeline itself PASSed or FAILed. This
caused the Developer to receive a REWORK recommendation when code-review FAILed but QA had
since re-verified the fix with a PASS — creating a spurious loop that should have advanced to
code-review. Fixed by adding `mostRecent.status === 'FAIL'` to the detection guard in
`workflow-helpers.ts`.

**Bug 2 — Auto-cancelled pipeline blocking (`startPipeline` prerequisite filter):** The
prerequisite check in `startPipeline` was the only pipeline lookup in the codebase that did not
exclude `auto_cancelled` pipelines, violating the §21.27 universal exclusion pattern. This meant
a crash-recovery sequence of `[impl PASS, impl FAIL (auto_cancelled)]` permanently blocked QA
from starting. Fixed by adding `&& !p.auto_cancelled` to the filter predicate in `pipeline.ts`.

Both fixes were preceded by workflow specification updates (spec-first per Constraint 0), each
fix is covered by new integration tests, and a changelog entry (v1.32.3) was committed.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 8 / 8 COMPLETE |
| Pipeline stages executed | 26 (2 × documentation-only + 6 × impl+qa+review+docs) |
| Pipelines passed | 26 / 26 |
| Pipelines failed | 0 |
| Tests at session start | 2,862 |
| Tests at session end | 2,868 |
| Net new tests | +6 |
| Tests failed | 0 |
| Source files changed | 2 |
| Test files changed | 3 |
| Spec files changed | 3 |
| Changelog entries added | 1 (v1.32.3) |

### Test Count Progression

| After WP | Count | Change |
|----------|-------|--------|
| WP-003 (Bug 2 fix) | 2,862 | — (baseline) |
| WP-004 (Bug 1 fix) | 2,862 | row-3 expectation flip only |
| WP-005 (+3 unit tests) | 2,865 | +3 |
| WP-006 (+1 integration) | 2,866 | +1 |
| WP-007 (+1 integration) | 2,867 | +1 |
| WP-008 (+1 integration) | 2,868 | +1 |

---

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/src/tools/pipeline.ts` | Bug 2: added `&& !p.auto_cancelled` to prerequisite filter |
| `mcp-server/src/utils/workflow-helpers.ts` | Bug 1: added `mostRecent.status === 'FAIL'` + JSDoc update |
| `mcp-server/tests/utils/workflow-helpers.test.ts` | Row-3 expectation flip + 3 new unit tests |
| `mcp-server/tests/tools/start-pipeline-guards.test.ts` | New Bug 2 integration test |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | New Case 5b Bug 1 integration test |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | New Bug 1 regression guard |
| `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` | §8.2 pseudocode + auto-cancelled note |
| `mcp-server/docs/agents/workflow-specification/recommendations.md` | §14.13 pseudocode, scenario table, row-3 update |
| `mcp-server/docs/agents/workflow-specification/edge-cases.md` | §21.27 stale bullet corrected (see below) |
| `mcp-server/changelog.md` | v1.32.3 entry |

---

## Strategic Recommendations

### Spec Staleness Caught in Flight

§21.27 in `edge-cases.md` contained the bullet: *"Auto-cancelled pipelines are NOT excluded
from prerequisite checks"* — which was directly contradicted by the Bug 2 fix and by the §8.2
algorithm updated in WP-001. This was caught during the WP-003 documentation phase and
corrected in the same session. **Takeaway:** the edge-cases.md file contains narrative prose
that can drift from the algorithmic spec. Periodic cross-validation between `edge-cases.md`
and the pseudocode sections (`pipeline-routing.md`, `recommendations.md`) is warranted.

### `hasDownstreamReengagedSince` Call-Site Safety

All three call sites of `hasDownstreamReengagedSince` (P5 in `workflow-next-action.ts`, two
in `workflow-handoff.ts`) are already guarded by `isMostRecentPipelineFail` before calling
this function. The Bug 1 fix improves the function's standalone contract: future call sites
that do not carry the outer guard will now behave correctly without silent reliance on the
caller. **Takeaway:** this is a good defence-in-depth improvement — the function now fully
encodes its own semantics.

### Dual-Assertion Regression Test Convention

The WP-007 and WP-008 integration tests adopted a `not.toBe(BUG_VALUE)` + `toBe(CORRECT_VALUE)`
assertion pattern, clearly documenting both the regression guard and the expected outcome.
The Reviewer explicitly endorsed this as a convention for bug regression tests. **Takeaway:**
adopt `not.toBe(X) + toBe(Y)` as the standard pattern for all future bug regression tests in
this codebase.

### CTX Regeneration Needed

`edge-cases.md` was updated (§21.27 correction), making `.context/mcp-server/workflow-spec-edge-cases.md`
stale. Run `node scripts/cli.js ctx-generate` to refresh the generated context snapshot.

---

## Open Items / Follow-Up Recommendations

| Priority | Item |
|----------|------|
| Low | Add explicit downstream PASS→false test for `hasDownstreamReengagedSince` AC #2 (flagged by WP-004 QA and Reviewer — the `=== 'FAIL'` condition is unambiguous, but a dedicated test would document the contract boundary precisely). |
| Low | WP-007/WP-008 have a ledger metadata swap (`work_package_file` values point to each other's `.md`). Non-blocking artefact; consider a housekeeping correction. |
| Low | Run `node scripts/cli.js ctx-generate` to refresh `.context/mcp-server/workflow-spec-edge-cases.md`. |
| Low | Documentation pipelines for WP-005 through WP-008 did not declare `artifacts.files_modified`. Consider enforcing artifact declarations for traceability (existing project comments flag this). |

---

## Conclusion

Both correctness bugs in the pipeline routing system are resolved. The codebase now
consistently applies the `auto_cancelled` exclusion pattern across all pipeline lookups
(§21.27), and the re-engagement detector correctly restricts rework signals to downstream
failures only. The workflow specification is fully aligned with the implementation, the §21.27
stale bullet was caught and corrected, and six new tests provide permanent regression coverage
for both bugs. All 2,868 tests pass with zero failures.
