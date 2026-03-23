# Project Synthesis Report

**Plan:** 2026-02-28-synthesis-strategic-recommendations  
**Date:** 2026-02-28  
**Status:** COMPLETE  
**Prepared by:** Synthesis Agent (Head of Operations)

---

## Executive Summary

This sprint delivered a systematic technical debt remediation targeting the `mcp-server` codebase. Nine work packages were executed across a single day, eliminating three structural classes of debt:

1. **Duplicate data** — Retired the legacy `rework_count` scalar, making `rework_counts` (map) the exclusive source for circuit-breaker state.
2. **Hardcoded constant replicas** — Replaced all inline pipeline-type arrays and role-name string literals with derivations from `PIPELINE_TYPES` and `AGENT_ROLES` constants, making the codebase structurally drift-proof.
3. **Test infrastructure duplication** — Eliminated in-test production replicas (`applyStatusHealing`, `applyDepthResetOnComplete`) and local fixture helpers, migrating all test files to the centralized `tests/helpers/fixtures.ts` and the new `tests/helpers/test-utils.ts`.

Alongside the debt remediation, one **correctness bug** was fixed: `getDocumentationAction` was the only role-action function missing the `hasDependencyBlocked` guard, which could have caused incorrect `WRITE_DOCS` actions when a WP's dependency was blocked. This is now symmetric with the other three role functions. Additionally, `buildBatchNextSteps` was expanded with 10 explicit case branches to eliminate silent empty-array fall-through for known action types.

All pipelines passed all 9 WPs. Zero regressions. Zero TypeScript errors.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 9 / 9 COMPLETE |
| Implementation pipelines | 9 / 9 PASS |
| QA pipelines | 9 / 9 PASS |
| Code-review pipelines | 9 / 9 PASS |
| Documentation pipelines | 9 / 9 PASS |
| Tests passing | 865 / 865 |
| Tests failing | 0 |
| TypeScript errors | 0 |
| Security issues | 0 |
| Net test delta | −2 (−5 stale tests removed, +3 new coverage added) |

---

## Work Package Summary

| WP | Title | Outcome |
|----|-------|---------|
| WP-001 | Retire `rework_count` scalar dual-write | PASS — `effectiveReworkCount` reads exclusively from `rework_counts` map |
| WP-002 | Replace inline pipeline-type arrays with `PIPELINE_TYPES` | PASS — `workflow-next-action.ts` derives types structurally, filter is future-proof |
| WP-003 | Derive role error messages from `AGENT_ROLES` | PASS — `claimWorkPackage` and `completeSynthesis` guards are drift-free |
| WP-004 | Eliminate test production replicas | PASS — `computeHealedStatus` called directly; `applyStatusHealing` replica deleted; 3 stale assertions corrected |
| WP-005 | `getDocumentationAction` symmetry + `buildBatchNextSteps` completeness | PASS — bug fix applied; 10 explicit branches added; no action falls through silently |
| WP-006 | Shared test infrastructure (`test-utils.ts`, fixture migration) | PASS — `test-utils.ts` created; `ledger-store.test.ts` and `workflow-helpers.test.ts` migrated |
| WP-007 | Stale test labels and obsolete action name cleanup | PASS — `WAIT_FOR_REWORK` labels fixed; `MARK_COMPLETE` → `FINALIZE_WP`; `revision:1` comment added |
| WP-008 | Multi-item code quality fixes (C-1 through C-6) | PASS — DRY cancel helper, API parameter narrowing, Zod whitespace validation, redundant casts removed, `let result!` replaced |
| WP-009 | `_schemas` → `_internal` rename + §53/§54 constraints | PASS — naming convention codified; `modify_text` preservation documented |

---

## Files Modified

### Production Source
- `mcp-server/src/tools/pipeline.ts`
- `mcp-server/src/tools/work-package.ts`
- `mcp-server/src/tools/project-lifecycle.ts`
- `mcp-server/src/tools/workflow-next-action.ts`
- `mcp-server/src/tools/workflow-batch-actions.ts`
- `mcp-server/src/tools/observations.ts`
- `mcp-server/src/utils/workflow-helpers.ts`

### Tests
- `mcp-server/tests/helpers/test-utils.ts` *(new)*
- `mcp-server/tests/helpers/fixtures.ts`
- `mcp-server/tests/tools/start-pipeline-guards.test.ts`
- `mcp-server/tests/tools/project-lifecycle.test.ts`
- `mcp-server/tests/tools/work-package.test.ts`
- `mcp-server/tests/tools/workflow-rework-loop.test.ts`
- `mcp-server/tests/tools/pipeline.test.ts`
- `mcp-server/tests/tools/observations.test.ts`
- `mcp-server/tests/integration/full-workflow.test.ts`
- `mcp-server/tests/storage/ledger-store.test.ts`
- `mcp-server/tests/utils/workflow-helpers.test.ts`

### Documentation
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`

---

## Strategic Recommendations (Gold Nuggets)

### 1. Single-Source-of-Truth Is Now Structural, Not Conventional
**Reviewer comment (cross-cutting, high signal):** The sprint systematically enforced single-source-of-truth at the *type system level* rather than by convention. `PIPELINE_TYPES → PipelineTypeEnum → PipelineType` is a compile-time exhaustiveness chain; adding a new pipeline type automatically propagates through the entire codebase. `AGENT_ROLES → CLAIMABLE_ROLES → error messages` is the same pattern for roles.

**Recommendation:** Adopt this derivation-chain pattern as the standard for all future constant-driven features. Any time you introduce a new enumeration (action types, status values, etc.), derive it from a single tuple constant rather than maintaining parallel literals.

### 2. Adopt `tests/helpers/` Infrastructure for All New Test Files
`tests/helpers/fixtures.ts` and the new `tests/helpers/test-utils.ts` are now the canonical test infrastructure. `injectLedgerDir` and `nowFloor` solve two recurring boilerplate patterns that previously caused per-file divergence.

**Recommendation:** The next session should add a `constraints.md` entry (or a `tests/helpers/README.md`) formally mandating that new test files import from `tests/helpers/` rather than defining local factories. The infrastructure is built; the mandate is not yet documented.

### 3. One Medium-Priority Business Logic Bug Corrected (WP-005 — hasDependencyBlocked)
`getDocumentationAction` was silently missing the `hasDependencyBlocked` guard that all three other role-action functions had. This is a behavioral gap, not just debt: a WP that is `IN_PROGRESS` with a `BLOCKED` dependency could have been routed to `WRITE_DOCS` instead of being skipped. The fix is now in place and the four functions are symmetric.

**Recommendation:** Add a dedicated integration test for `getDocumentationAction` with a WP where the dependency is `BLOCKED` (the QA agent flagged this coverage gap). The hasDependencyBlocked utility has six isolated unit tests, but an end-to-end path through `getDocumentationAction` is missing.

### 4. CLAIM_WP Batch Step Guidance Bug (Low Severity, Not Yet Fixed)
`buildBatchNextSteps` CLAIM_WP case (WP-005 Reviewer) interpolates `pipelineType` (e.g., `"implementation"`) in the `agent:` field of the guidance text instead of the already-computed `agentRole` (e.g., `"Developer"`). This produces agent instructions like `agent: "implementation"` which may confuse downstream agents following the batch step literally. The fix is a one-line change: replace `pipelineType` with `agentRole` in the CLAIM_WP branch of `workflow-batch-actions.ts` (~L147).

**Recommendation:** Add this as a WP-001 in the next sprint. It is a guidance-only bug (no ledger state is corrupted) but it degrades the quality of batch step instructions.

### 5. Two Low-Priority Orphans Remain (Acceptable Defer)
Both were identified and explicitly deferred by the Developer and confirmed safe by QA/Reviewer:
- `mcp-server/src/tools/work-package.ts` L754: `wp.rework_count = undefined` in the `COMPLETE→IN_PROGRESS` reset path is orphaned backward-compat code. Safe to remove once confident no stored WPs carry the scalar field.
- `mcp-server/tests/tools/rework-circuit-breaker.test.ts` L37: `makeWpDetail` fixture still sets `rework_count` alongside `rework_counts`. Test-only; safe for a follow-up cleanup.

### 6. Invariant Guard Pattern Is Now Codified
WP-008 (C-6) replaced `let result!` with `let result: ... | undefined` + an explicit `throw` invariant guard in `completeSynthesis`, matching the pattern already used in `detectProject`. This is now the documented idiom for `withLock` callbacks.

**Recommendation:** Extend this review to the remaining `withLock` usages in the codebase to ensure none still use the `!` non-null assertion pattern for their result accumulator.

---

## Known Gaps and Deferred Items

| Item | Priority | WP Origin | Notes |
|------|----------|-----------|-------|
| Integration test: `getDocumentationAction` with dependency-blocked WP | Low | WP-005 QA | `hasDependencyBlocked` tested in isolation; not yet tested through `getDocumentationAction` end-to-end |
| Fix `CLAIM_WP` batch step `pipelineType` → `agentRole` in `workflow-batch-actions.ts` | Low | WP-005 Reviewer | One-line fix; guidance text only |
| Remove `wp.rework_count = undefined` from COMPLETE→IN_PROGRESS reset | Low | WP-001 Developer | Only safe after confirming no stored WPs carry the scalar |
| Remove `rework_count` from `rework-circuit-breaker.test.ts` fixture | Low | WP-001 Developer | Test-only cleanup |
| Mandate `tests/helpers/` usage in constraints.md or a README | Medium | WP-006 | Infrastructure exists; enforcement convention not yet documented |
| Audit remaining `withLock` callbacks for `let result!` pattern | Low | WP-008 | Pattern fixed in `completeSynthesis`; others not yet reviewed |

---

## Next Steps for Planner/Manager

1. **Highest value item:** Add a `tests/helpers/` usage mandate to `constraints.md` (§55 or similar). The shared fixture infrastructure built this sprint will drift unless its adoption is required. This is a 15-minute documentation task.

2. **Bug fix:** Assign a micro-WP to fix the `CLAIM_WP` batch step guidance bug in `workflow-batch-actions.ts` (~L147). One-line change, high confidence.

3. **Coverage gap:** Assign a micro-WP to add a `getDocumentationAction` integration test for the `hasDependencyBlocked` path. The fix exists (WP-005); the test coverage for it does not.

4. **Health check:** Run a project-wide scan for remaining `let variable!` (non-null assertion) patterns in `withLock` callbacks. WP-008 fixed `completeSynthesis`; the same smell may exist in other handlers.

5. **Lower priority cleanup:** After confirming no live ledger files contain the `rework_count` scalar, remove the orphaned `wp.rework_count = undefined` reset line and the stale fixture field. These can be bundled into a single micro-WP.

---

## Project Health Assessment

The codebase exits this sprint in the best structural shape it has been in. All three classes of technical debt targeted by the Planner have been eliminated. The test suite is smaller (865 vs 867) but of higher quality — it now tests production behavior directly rather than maintaining diverging replicas. The constraint catalogue has been extended with two new enforceable conventions (§53, §54).

No blocking issues. No failed pipelines. No regressions.
