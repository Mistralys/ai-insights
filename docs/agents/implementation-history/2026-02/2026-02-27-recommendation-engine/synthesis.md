# Project Synthesis Report

**Project:** Phase 4 — Recommendation Engine Rewrite (`getNextAction` spec alignment)
**Plan Path:** `docs/agents/plans/2026-02-27-recommendation-engine/`
**Report Date:** 2026-02-28
**Status:** COMPLETE — All 6 Work Packages Delivered

---

## Executive Summary

Phase 4 completed a comprehensive rewrite of the `getNextAction` recommendation engine in `mcp-server/src/tools/workflow-next-action.ts` to achieve full compliance with §14.1–§14.5 of the Agent Workflow Specification.

Prior to this phase, every role-specific action function was either structurally incomplete (missing priorities), incorrectly ordered, using non-spec action names, or (in the case of the PM) almost entirely absent. Phases 1–3 had pre-built all the necessary algorithmic helpers; Phase 4 was a **wiring and completeness** phase.

The scope spanned five role-specific action functions (PM, Developer, QA, Reviewer, Documentation) plus a new shared utility (`isActivePipeline`), totalling nine new action types, corrected priority orderings across two roles, removal of two deprecated action names (`RESOLVE_BLOCKERS`, `MARK_COMPLETE`), an end-to-end integration smoke test, and full manifest documentation updates.

The final test suite count grew from **621 tests** (Phase 3 baseline) to **774 tests** — an increase of 153 new test cases — with zero failures and zero TypeScript errors.

---

## Deliverables by Work Package

| WP | Title | Status | Tests Added | Key Deliverable |
|----|-------|--------|-------------|-----------------|
| WP-001 | `isActivePipeline` & `mostRecentEffectivePipeline` helpers | COMPLETE | +9 | Two workflow-helpers.ts utilities; foundation for all downstream WPs |
| WP-002 | PM Action (5-priority algorithm) | COMPLETE | +9 | Full `getProjectManagerAction` rewrite; `RESOLVE_BLOCKERS` removed |
| WP-003 | Developer Action (7-priority algorithm) | COMPLETE | +9 + fixture updates | `getDeveloperAction` full rewrite; `CONTINUE_PIPELINE`, `WAIT_FOR_DOWNSTREAM`, `CLAIM_WP` added |
| WP-004 | QA + Reviewer Actions (7+1b priorities each) | COMPLETE | +15 | Both functions rewritten; `WAIT_FOR_REWORK`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT` added |
| WP-005 | Documentation Action (7+1b priorities) | COMPLETE | +11 | `getDocumentationAction` full rewrite; `FINALIZE_WP`, `UPDATE_CRITERIA` replace `MARK_COMPLETE` |
| WP-006 | Integration Hardening & Verification | COMPLETE | +10 (integration) | Smoke test for impl→qa-fail→rework→qa-pass lifecycle; `RESOLVE_BLOCKERS`/`MARK_COMPLETE` absence confirmed |

---

## Metrics

| Metric | Value |
|--------|-------|
| **Final test count** | 774 / 774 passed |
| **Test failures** | 0 |
| **TypeScript errors** | 0 (`npx tsc --noEmit`) |
| **New test cases added** | 63 unit + 10 integration = **73** |
| **New action types introduced** | 9 (`CONTINUE_PIPELINE`, `WAIT_FOR_DOWNSTREAM`, `WAIT_FOR_REWORK`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, `BLOCK_FOR_REWORK_LIMIT`, `UNBLOCK_WP`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`, `FINALIZE_WP`, `UPDATE_CRITERIA`, `CLAIM_WP`) |
| **Deprecated action types removed** | 2 (`RESOLVE_BLOCKERS`, `MARK_COMPLETE`) |
| **All acceptance criteria met** | 6/6 WPs, all AC ✓ |
| **Pipeline passes (total across WPs)** | 24 pipelines (implementation × 6, qa × 6, code-review × 6, documentation × 6) |
| **Pipeline failures** | 0 |

---

## Files Modified

| File | Role |
|------|------|
| `mcp-server/src/tools/workflow-next-action.ts` | Core implementation (all 5 action functions rewritten) |
| `mcp-server/src/utils/workflow-helpers.ts` | `isActivePipeline` + `mostRecentEffectivePipeline` added |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | 73 new test cases + integration describe block |
| `mcp-server/tests/tools/rework-circuit-breaker.test.ts` | CLAIM_WP expectation update (READY WP routing) |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | Sequential timestamp fix + 5 expectation updates |
| `mcp-server/tests/tools/workflow-rework-loop.test.ts` | WAIT → WAIT_FOR_REWORK expectation update |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Full documentation of all 5 action functions |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Flow 7 + Flow 9 expanded; full action type enum |
| `mcp-server/changelog.md` | v1.8.0 entry |

---

## Strategic Recommendations (Gold Nuggets)

### 🥇 GN-1 — Standardize the State-Machine Timeline Pattern for Integration Tests

The integration test added in WP-006 (`tests/tools/workflow-next-action.test.ts`) introduces an inline timeline header with semantic labels (`T1=08:00 impl-1 started`, `T2=09:00 impl-1 completed`, etc.) and per-state rationale comments explaining *why* each agent should return a specific action at each point in the lifecycle.

**This is the clearest test documentation in the entire test suite.** The Reviewer flagged it as exemplary: each state comment effectively serves as a mini-specification that the test can be audited against without tracing through source logic.

**Recommendation:** Adopt this pattern as a project test convention for all multi-state or temporal integration tests. Apply it retroactively to any existing complex tests in `workflow-handoff.test.ts` and `workflow-rework-loop.test.ts` during the next maintenance pass.

---

### 🥈 GN-2 — Extract `PIPELINE_TYPES` Constant to Guard Against Drift

Three separate sites in `workflow-next-action.ts` hardcode the pipeline type array as inline string literals:
1. `allPipelineTypes` in `getProjectManagerAction` (Priority 3 stale-check loop)
2. `['implementation', 'qa', 'code-review']` upstream types array in `getDocumentationAction` P1b
3. The same pattern in `getReviewerAction` P1b OR condition

All three were independently flagged by Developer, QA, and Reviewer across WP-002, WP-004, and WP-005. If a new pipeline type is added in the future (e.g., `performance` or `security`), all three sites must be found and updated manually — or they will silently omit the new type.

**Recommendation:** Define a `PIPELINE_TYPES` typed constant in `mcp-server/src/utils/constants.ts` and derive all three inline arrays from it. This is a single-file change with no behavioral impact, eliminates a class of silent drift bugs, and is straightforward to validate with TypeScript's exhaustive type system.

---

### 🥉 GN-3 — Align `getDocumentationAction` Loop Guard for Architectural Consistency

`getDeveloperAction`, `getQaAction`, and `getReviewerAction` all call `hasDependencyBlocked(wpDetail, rootIndex)` at the top of their WP evaluation loop as an explicit skip guard. `getDocumentationAction` omits this guard, relying on `canStartWorkPackage` at P7 and the BLOCKED-WP loop filter instead.

This is **functionally correct** but creates an architectural inconsistency that the Reviewer flagged as medium priority. Future developers auditing the action functions by reading them in parallel will find three functions with an explicit guard and one without, introducing an unwarranted cognitive burden.

**Recommendation:** Add `hasDependencyBlocked(wpDetail, rootIndex)` at the top of the WP loop in `getDocumentationAction`, or add an explicit comment documenting the intentional deviation. The loop-guard approach matches the project's established pattern and requires no behavioral changes.

---

## Technical Debt Register

The following non-blocking items were logged across pipelines and warrant follow-up WPs:

| Priority | Location | Debt |
|----------|----------|------|
| Medium | `workflow-next-action.ts` — `getDocumentationAction` | Missing `hasDependencyBlocked` loop guard (GN-3 above) |
| Medium | `workflow-next-action.ts` — all 3 pipeline type arrays | Inline string arrays should derive from `PIPELINE_TYPES` constant (GN-2 above) |
| Medium | `tests/tools/workflow-handoff.test.ts` | `setupAndGetDevAction` helper assumes sequential pipeline timestamps; future non-sequential test cases would require helper extension |
| Low | `workflow-batch-actions.ts` — `buildBatchNextSteps()` | `default: return []` branch silently discards `next_steps` for unrecognised action types (WAIT_FOR_REWORK, WAIT_FOR_DOWNSTREAM, BLOCK_FOR_REWORK_LIMIT, etc.). Should add explicit cases for each new action type or emit structured WAIT guidance |
| Low | `tests/tools/workflow-rework-loop.test.ts` | Stale `describe` and `it()` strings still say "returns WAIT" after `WAIT_FOR_REWORK` rename. Expectations pass but descriptions mislead |
| Low | `tests/integration/full-workflow.test.ts:922` | Stale comment references removed `MARK_COMPLETE` action (`// This condition should trigger the MARK_COMPLETE action in getDocumentationAction`) |
| Low | `tests/utils/workflow-helpers.test.ts` | Local `makePipeline`/`makeWp` helpers defined inline instead of importing from `tests/helpers/fixtures.ts` — pre-existing convention gap |
| Low | `workflow-next-action.ts` — getProjectManagerAction P3 | Double-parse coupling: `extractStalePipelineAction` result is immediately `JSON.parse`'d to extract `age_hours` with an unsafe type cast. Consider exposing a typed helper or separating computation from serialization |

---

## Spec Alignment Status

All 22 gaps documented in the Phase 4 plan's gap audit table have been resolved:

| Role | Gaps Entering Phase 4 | Gaps Remaining |
|------|----------------------|----------------|
| PM | 1 (ALL — complete rewrite) | 0 |
| Developer | 5 | 0 |
| QA | 5 | 0 |
| Reviewer | 5 | 0 |
| Documentation | 5 | 0 |
| **Total** | **22** | **0** |

The `getNextAction` recommendation engine now fully complies with §14.1–§14.5, §21.33, §21.34, §21.40, §21.52, and §21.53 of the Agent Workflow Specification.

---

## Next Steps for Planner/Manager

1. **Follow-up Refactor WP (Recommended):** Create a single WP targeting the two cross-cutting structural items from GN-2 and GN-3: (a) extract `PIPELINE_TYPES` constant, (b) add `hasDependencyBlocked` guard to `getDocumentationAction`. These are non-breaking, low-risk, and eliminate real future drift risk.

2. **Batch-Actions Gap WP:** The `default: return []` branch in `workflow-batch-actions.ts` now silently handles 9+ new action types without guidance. This affects the developer experience for agents consuming `get_next_actions`. A dedicated WP to add explicit `next_steps` for each new action type would unlock the full value of the batch tool.

3. **Test Housekeeping WP:** Combine the stale `describe`/`it()` string fixes, the `MARK_COMPLETE` comment cleanup, and the `workflow-helpers.test.ts` fixture consolidation into a single low-effort housekeeping WP. Small quality-of-life improvement that prevents future confusion.

4. **Phase 5 Planning:** The plan references Phase 5 (Synthesis Agent and `GENERATE_SYNTHESIS` action logic). Now that all 5 per-role action functions are correct and tested, Phase 5 can proceed on a solid foundation.

5. **api-surface.md Deferred Update:** WP-006 explicitly deferred updating `api-surface.md` with the 13 new action types and `isActivePipeline()` helper to "Phase 6 Documentation agent." Ensure this is tracked as a Phase 6 task to keep the manifest current.
