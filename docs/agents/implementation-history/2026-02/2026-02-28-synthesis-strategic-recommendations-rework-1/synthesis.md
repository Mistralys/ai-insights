# Project Status Report — 2026-02-28-synthesis-strategic-recommendations-rework-1

**Date:** 2026-02-28
**Status:** COMPLETE
**Work Packages:** 5 / 5 COMPLETE

---

## Executive Summary

This sprint delivered all five actionable items surfaced by the previous sprint's strategic recommendations. The scope was deliberately narrow: one documentation mandate, one one-line production bug fix, one test-coverage addition, one formal audit close-out, and one dead-code removal. Every work package was targeted, non-speculative, and linked to a concrete finding from the prior review cycle.

The net result is a tighter codebase: `constraints.md` now formally mandates the shared test helper infrastructure (§55), a guidance bug that produced `agent: "implementation"` instead of `agent: "Developer"` in `get_next_actions` output is fixed, the `getDocumentationAction` function has an integration test for its BLOCKED-dependency guard path, the `withLock` non-null assertion pattern health check is formally closed with a written audit, and the orphaned `rework_count` backward-compat scalar has been fully retired from both production source and test fixtures.

All 870 tests pass across 32 test files with zero failures. TypeScript compilation is clean.

---

## Metrics

| WP | Description | Tests | Coverage Files | Failures |
|----|-------------|-------|----------------|----------|
| WP-001 | §55 test helper mandate (docs-only) | 870 | 32 | 0 |
| WP-002 | CLAIM_WP agent-field bug fix | 870 | 32 | 0 |
| WP-003 | getDocumentationAction BLOCKED-dependency test | 870 | 32 | 0 |
| WP-004 | withLock non-null assertion audit | 870 | 32 | 0 |
| WP-005 | rework_count orphan removal | 870 | 32 | 0 |

**Aggregate: 870 tests, 0 failures, 0 TypeScript errors, 0 security issues.**

### Rework Events

| WP | Count | Root Cause |
|----|-------|-----------|
| WP-003 | 1 | First implementation used the local `makePipeline` factory (shadowing the import from `tests/helpers/fixtures.ts`) and a local `makeWpDetail()` — violating the §55 mandate the sprint itself introduced. QA caught the AC3 failure; second implementation removed the local shadow and switched to `makeWorkPackageDetail()`. |

---

## Artifacts Modified

| File | Changed By |
|------|-----------|
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-001 (§55 added), WP-004 (Gotcha 12 expanded), WP-005 (§21 updated) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-002 (`_internal.buildBatchNextSteps` section added) |
| `mcp-server/src/tools/workflow-batch-actions.ts` | WP-002 (bug fix: `${pipelineType}` → `${agentRole}`) |
| `mcp-server/tests/tools/workflow-batch-actions.test.ts` | WP-002 (3 regression tests for CLAIM_WP guidance) |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | WP-003 (BLOCKED-dependency + positive-path tests; local `makePipeline` shadow removed) |
| `mcp-server/src/tools/work-package.ts` | WP-005 (`wp.rework_count = undefined` orphan line removed) |
| `mcp-server/tests/tools/rework-circuit-breaker.test.ts` | WP-005 (stale `rework_count: reworkCount` fixture property removed) |
| `work/WP-004-audit.md` | WP-004 (new audit document: 8 withLock sites, all CLEAN) |
| `mcp-server/src/tools/workflow-next-action.ts` | Gold Nugget §1 (dead `hasDependencyBlocked` guard removed from `getDocumentationAction`) |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | Gold Nugget §2 (local `makeWpDetail` removed; 70 call-sites migrated to `makeWorkPackageDetail`; `Pipeline` unused type import removed) |

---

## Strategic Recommendations — Gold Nuggets

### 1. `hasDependencyBlocked` in `getDocumentationAction` is architecturally suspect dead code

**Priority:** Low | **Flagged by:** Developer (WP-003 implementation), Reviewer (WP-003 code-review) | **Status: RESOLVED 2026-02-28**

The `hasDependencyBlocked` guard at `workflow-next-action.ts` line ~947 is never reachable: the preceding `status === BLOCKED` check already short-circuits all BLOCKED work packages before the function reaches `hasDependencyBlocked`. The `hasDependencyBlocked` function's first statement is `if (wpDetail.status !== 'BLOCKED') return false`, so it can never return `true` after the upstream status-guard `continue`.

**Action taken:** The dead code (comment + guard) was removed from `getDocumentationAction`. The import of `hasDependencyBlocked` in `workflow-next-action.ts` is retained — it is still used by three other action functions (`getDeveloperAction`, `getQaAction`, `getReviewerAction`) at lines 411, 599, and 771. All 870 tests pass.

---

### 2. §55 compliance gap in `workflow-next-action.test.ts` — ~70 pre-existing local factory call-sites

**Priority:** Low | **Flagged by:** Developer (WP-003 × 2), Reviewer (WP-003 code-review) | **Status: RESOLVED 2026-02-28**

The local `makeWpDetail()` function and its pre-existing call-sites in `mcp-server/tests/tools/workflow-next-action.test.ts` (70 call-sites, not ~20 as previously estimated) predate §55 and violated the mandate introduced in this sprint.

**Action taken:** The local `makeWpDetail(id, status, pipelines)` factory was removed and all 70 call-sites were mechanically migrated to `makeWorkPackageDetail({ ... })` from `tests/helpers/fixtures.ts`. The `Pipeline` type-only import was also removed as it was no longer referenced. Spread patterns (`{ ...makeWpDetail(...), extraProp: val }`) were collapsed into direct `makeWorkPackageDetail({ ..., extraProp: val })` overrides. Spurious `work_package_file` template literals (`\`work/${'WP-XXX'}.md\``) were rewritten as plain string literals (`'work/WP-XXX.md'`). All 870 tests pass with zero TypeScript errors. This closes the last known §55 violation in the test suite.

---

### 3. `pipelineAgentRoleMap` fallback (`?? pipelineType`) provides graceful degradation for future pipeline types

**Priority:** Low | **Flagged by:** Reviewer (WP-002 code-review)

The `buildBatchNextSteps` function in `workflow-batch-actions.ts` resolves agent roles via `pipelineAgentRoleMap[type] ?? type`. The `?? pipelineType` fallback is intentional: if a new pipeline type is added to the system but not yet to the map, the guidance degrades gracefully to the raw type string rather than throwing.

**Recommendation:** When adding a new pipeline type, remember to add an entry to `pipelineAgentRoleMap` in `workflow-batch-actions.ts`. Add a regression test asserting the correct agent role is produced for the new type — the WP-002 tests provide a direct template.

---

### 4. `| undefined` union pattern now documented in Gotcha 12 alongside the empty-string default

**Priority:** Low | **Flagged by:** Reviewer (WP-004 code-review), Documentation (WP-004)

`project-lifecycle.ts` L522 (`completeSynthesis`) correctly uses `let result: { … } | undefined` instead of the prohibited `let result!` non-null assertion. This was the only `withLock` site using the `| undefined` union alternative — previously undocumented in Gotcha 12. Documentation agent added a new block covering when to prefer `| undefined` over a zero-value default.

**Recommendation:** No immediate action needed. The updated Gotcha 12 is now the canonical reference. When writing new `withLock` callbacks, prefer `| undefined` for optional object returns (check `if (!result)` after the lock) and an empty-string or zero default for primitive returns.

---

## Deferred / Out of Scope

| Item | Status | Notes |
|------|--------|-------|
| Migrate pre-existing `makeWpDetail` call-sites in `workflow-next-action.test.ts` | **Completed** | 70 call-sites migrated. See Gold Nugget §2 above. |
| Assess whether `hasDependencyBlocked` is dead code | **Completed** | Dead guard confirmed and removed. See Gold Nugget §1 above. |

---

## Next Steps

1. ~~**File a WP** to migrate the ~20 pre-existing `makeWpDetail()` call-sites in `workflow-next-action.test.ts` to `makeWorkPackageDetail()`.~~ **Completed.** All 70 call-sites migrated; §55 violation closed.

2. ~~**Track `hasDependencyBlocked`** as a low-priority item.~~ **Completed.** Dead guard confirmed and removed from `getDocumentationAction`.

3. **Maintain `pipelineAgentRoleMap`** discipline: any new pipeline type additions must be accompanied by a map entry and a regression test mirroring the WP-002 pattern.

---

*Generated by Synthesis Agent — 2026-02-28*
