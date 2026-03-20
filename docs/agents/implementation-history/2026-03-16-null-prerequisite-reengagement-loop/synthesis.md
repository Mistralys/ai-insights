# Project Synthesis Report

**Plan:** `2026-03-16-null-prerequisite-reengagement-loop`  
**Date:** 2026-03-17  
**Status:** COMPLETE — 5/5 Work Packages PASS  

---

## Executive Summary

This plan resolved a production-observed infinite routing loop in `ledger_get_next_action` triggered by `resolvePrerequisite` returning `null` for **first-active-stage compositions** (e.g., a WP where `active_pipeline_stages` starts with `qa` rather than `implementation`). When null was returned, the re-engagement priority (P4/P5) in each agent's action function treated it as `true`, unconditionally filing a `RUN_*` action immediately after that pipeline PASSed — causing an infinite loop.

The fix was delivered across three sequential phases and was deliberately minimal:

1. **Phase 1 — Spec Amendments (WP-001, WP-002, WP-003):** Seven changes across four workflow specification documents established the authoritative rule (null → false at P4/P5) before any code touched.
2. **Phase 2 — Code Fix (WP-004):** A 4-line targeted change in `workflow-next-action.ts` corrected the null-guard ternary from `? true` to `? false` at all four affected P4/P5 re-engagement paths.
3. **Phase 3 — Regression Tests (WP-005):** Four new tests covering all four affected agent functions (QA, Reviewer, Security Auditor, Release Engineer) with first-active-stage compositions were added, bringing the total suite to 1325 passing tests.

Standard 4-stage and 6-stage compositions are completely unaffected — non-null prerequisites never reach the null branch. The fix is narrowly scoped by construction.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages Completed | 5 / 5 |
| Pipelines Run | 11 (2 × WP-001–003; 3 × WP-004–005) |
| Pipeline PASS Rate | 11 / 11 (100%) |
| Acceptance Criteria Met | 15 / 15 (100%) |
| Code Lines Changed | 4 (workflow-next-action.ts) — ternary values only |
| New Regression Tests | 4 |
| Test Suite After Fix (WP-004) | 1321 passed, 0 failed |
| Test Suite After New Tests (WP-005) | **1325 passed, 0 failed** |
| TypeScript Compilation | Clean (`tsc --noEmit`) |
| Regressions Introduced | 0 |

---

## Artifacts

| File | Change | WP |
|------|--------|----|
| `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` | §8.1.1 final return comment updated: `"should not happen"` → `"First active stage — no active predecessor"` | WP-001 |
| `mcp-server/docs/agents/workflow-specification/recommendations.md` | §14.3 P4, §14.4 P4, §14.5b P4, §14.5c P5 — null-guard notes added; §14.5b P4 hardcoded `"qa"` updated to `resolvePrerequisite` call | WP-001 |
| `mcp-server/docs/agents/workflow-specification/edge-cases.md` | New §21.66 "First-Active-Stage Re-engagement Loop" — 6 subsections covering footgun pattern, resolution, P4/P6 distinction, affected/immune agent functions, and affected compositions | WP-002 |
| `mcp-server/docs/agents/workflow-specification/handoff.md` | §13.1 — Implementation notes added to QA and Reviewer handoff sections documenting hardcoded-upstream vs dynamic trade-off and immunity to null-prerequisite loop | WP-003 |
| `mcp-server/src/tools/workflow-next-action.ts` | Lines 744, 938, 1121, 1330 — P4/P5 null-guard ternaries changed from `? true` to `? false`; consistent `// no upstream to re-engage from` comments added | WP-004 |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | 4 regression tests added (lines ~1800, ~1832, ~1864, ~1896) for QA P4, Reviewer P4, Security Auditor P4, Release Engineer P5 loop prevention | WP-005 |

---

## Strategic Recommendations

### Gold Nuggets

**1. P4/P6 Null Semantics are now a documented invariant**

The fix establishes a clear, tested rule: `resolvePrerequisite` returning `null` means "first active stage — no upstream exists." At P4/P5 (re-engagement), null must collapse to `false`; at P6 (first-run), null must collapse to `true`. This distinction is now documented in §8.1.1, §14.3–§14.5c, and §21.66 and enforced by 4 dedicated regression tests. Any future agent implementing the spec will find the invariant explicit rather than implicit.

**2. Dual-assertion test pattern (gold pattern)**

The 4 regression tests each assert both `not.toBe('RUN_*')` AND `toBe('WAIT')` — eliminating both false negatives (wrong action absent) and false positives (right action present). The section anchor comment at line ~1792 (`// §21.66 First-Active-Stage Re-engagement Loop Prevention`) is highlighted as a model for future regression test authorship.

---

### Future Work Items ~~(Low Priority)~~ — DONE

**3. ~~§14.5b P5 and §14.5c P5 hardcoded upstream references (consistency gap)~~** ✅ DONE

~~§14.5b P5 (`WAIT_FOR_REWORK`) still uses hardcoded `"qa"` in `hasNewUpstreamPassSince("qa", "security-audit")`, and §14.5c P5 still hardcodes `"code-review"` — while P4 in both sections now uses dynamic `resolvePrerequisite`. These are the wait paths (not the re-engagement paths), so they cannot cause the loop. However, the intra-section inconsistency between P4 (dynamic) and P5 (hardcoded) could mislead a future implementer. A follow-up pass to adopt `resolvePrerequisite` in these two P5 locations would complete the consistency story.~~

**4. ~~`makeReEngagementCheck()` helper for workflow-next-action.ts~~** ✅ DONE

~~The four agent-specific P4/P5 null-guard ternaries (`qaPrerequisite === null ? false : ...`, etc.) are structurally identical. A `makeReEngagementCheck(prerequisite, type)` helper function would reduce duplication across QA, Reviewer, Security Auditor, and Release Engineer blocks. Deliberately deferred from this plan as out of scope for a surgical fix; suitable for a standalone refactor WP.~~

**5. ~~"Spec vs. implementation" callout in handoff.md §13.1~~** ✅ DONE

~~The Reviewer handoff section in handoff.md contains pseudocode describing dynamic `effectiveUpstream = resolvePrerequisite(...)` resolution, but the actual implementation at `workflow-handoff.ts` line 713 hardcodes `'qa'`. The new implementation note documents this divergence after the rationale block. An additional short callout immediately above the pseudocode block (e.g., `> **Note:** Implementation uses hardcoded 'qa' — see implementation note below`) would prevent future readers from skipping the rationale.~~

**6. ~~Precision fix for Release Engineer P4 immunity note in §21.66~~** ✅ DONE

~~The current §21.66 immunity explanation for Release Engineer P4 says "no resolvePrerequisite null-collapse." The source code at line 1305–1308 does in fact reference `releasePrerequisite === null`, but in an OR-exit guard on the self-rework block, not as a ternary that unconditionally returns `true`. The immunity classification is correct; the phrasing is slightly imprecise. A one-sentence clarification (`"the null case appears in an OR-exit guard, not a ternary that collapses to true for re-engagement"`) would tighten the spec.~~

---

## Next Steps

1. **Immediate:** No blocking issues — the fix is shipped and the full regression suite passes. The loop is eliminated for all first-active-stage compositions.
2. ~~**Short-term:** Address items 3 and 5 above as a small follow-up documentation WP (spec consistency, handoff.md callout).~~ ✅ Done.
3. ~~**Medium-term:** Consider item 4 (`makeReEngagementCheck` refactor) as a standalone WP if the workflow-next-action.ts file undergoes broader refactoring.~~ ✅ Done.
4. **Ongoing:** The §21.66 edge case entry and the dual-assertion regression pattern should be referenced in future WPs that add or modify agent P4/P5 logic.
