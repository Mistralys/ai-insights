# Project Synthesis — Tool Guards & Status Transitions

**Date:** 2026-02-27
**Plan:** [plan.md](plan.md)
**Status:** ✅ COMPLETE — 8/8 Work Packages

---

## Executive Summary

This session hardened the MCP Server's tool layer with comprehensive input validation, state machine enforcement, and a series of precision correctness fixes across all three primary tool functions. The work delivered:

- **Status Transition Enforcement:** The `isValidStatusTransition()` function now correctly rejects CANCELLED as a terminal status (no self-transition), and two previously missing transitions — `IN_PROGRESS→READY` (unclaim) and `COMPLETE→CANCELLED` (PM-only) — are now fully wired and tested.
- **`startPipeline` Guard System:** `agent_role` is now required; a PM Override bypass is implemented for all pipeline types; the revalidation guard (`checkRevalidationGuard`) is wired and triggered; rework detection is per-type (not hardcoded to `implementation`); `FAIL_ROUTING_MAP` derivation eliminates a long-standing drift risk.
- **`completePipeline` Guards:** `agent_role` required; WP status defense-in-depth guard (step 0); agent role match guard; PM Override propagates identity through `from_agent` in handoff notes.
- **`updateWorkPackageStatus` Guards:** Ten new or corrected transition behaviors — BLOCKED→BLOCKED blocker replacement with PM/assignee and dependency-type guards; READY→IN_PROGRESS redirect to `claimWorkPackage`; IN_PROGRESS→READY unclaim with pipeline safety guard; pipeline auto-cancellation on IN_PROGRESS→BLOCKED/CANCELLED; COMPLETE→IN_PROGRESS rework state reset; `→COMPLETE` freshness check; `status_changed_at` on every transition.
- **`claimWorkPackage` Role Guard:** `CLAIMABLE_ROLES` constant excludes Planner/Synthesis; actionable error message; `status_changed_at` set on claim.
- **`createWorkPackage` Guards:** `assigned_to` always `null` on creation; `blocked_by` auto-set for BLOCKED-initial WPs; `hasCycle()` BFS cycle detection; `acceptance_criteria` whitespace validation.
- **`propagateDependencyReblock` Enhancement:** Three-phase behavior — re-block non-terminal dependents (auto-cancel IN_PROGRESS pipelines), warn COMPLETE dependents (append warning comment to last pipeline), reset `synthesis_generated` on re-block.
- **Code Gold Nuggets (WP-008):** Four targeted code improvements — `hasDownstreamFail()` delegation refactor; explicit `index === -1` guard in `getUpstreamTypes()`; equal-timestamp boundary test for `checkRevalidationGuard`; trailing-alpha WP-ID negative schema tests.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 8 / 8 COMPLETE |
| Tests Passed | **703 / 703** |
| Tests Failed | 0 |
| TypeScript Errors | 0 |
| Net New Tests | ~79 (from ~624 baseline) |
| Pipeline Outcomes | 32 pipelines — all PASS |
| Manifest Docs Updated | 4 (api-surface.md, constraints.md, data-flows.md, file-tree.md) |
| New Constraints Added | 12 (constraints 40–52) |

### Test Growth by WP

| WP | Net New Tests | Running Total |
|----|--------------|---------------|
| WP-001 | 21 | ~645 |
| WP-002 | 13 | ~658 (+ schema guards) |
| WP-003 | 8 | ~666 |
| WP-004 | 34 | ~679 |
| WP-005 | 5 | ~685 |
| WP-006 | 7 | ~692 |
| WP-007 | 6 | ~698 |
| WP-008 | 5 | **703** |

---

## Files Modified

### Source Code
- `mcp-server/src/schema/validators.ts`
- `mcp-server/src/tools/work-package.ts`
- `mcp-server/src/tools/pipeline.ts`
- `mcp-server/src/utils/workflow-helpers.ts`
- `mcp-server/src/storage/pipeline-maps.ts`

### Tests
- `mcp-server/tests/schema/validators.test.ts`
- `mcp-server/tests/schema/pipeline.test.ts`
- `mcp-server/tests/schema/observations.test.ts`
- `mcp-server/tests/tools/cancelled-status.test.ts`
- `mcp-server/tests/tools/pipeline.test.ts`
- `mcp-server/tests/tools/work-package.test.ts`
- `mcp-server/tests/utils/workflow-helpers.test.ts`
- `mcp-server/tests/tools/start-pipeline-guards.test.ts` *(new)*
- `mcp-server/tests/tools/complete-pipeline-guards.test.ts` *(new)*

### Manifest Documentation
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`

---

## Strategic Recommendations (Gold Nuggets)

### 🔴 High Priority

*(None — no blocking issues or security concerns were identified.)*

### 🟡 Medium Priority

**G-1: Derive CLAIMABLE_ROLES computationally from AGENT_ROLES**
- **Source:** WP-005 (QA + Reviewer), WP-006/WP-007 (Reviewer), project-level comment
- **Detail:** `CLAIMABLE_ROLES` in `work-package.ts` is a standalone string array. `constants.ts` declares `AGENT_ROLES` as the single source of truth, but `CLAIMABLE_ROLES` cannot be simply derived (different semantics, Agent aliases, orchestrating exclusions). The current divergence creates silent drift risk when a new role is added to `AGENT_ROLES`.
- **Action:** Introduce an `ORCHESTRATING_ROLES` exclusion set in `constants.ts`. Derive `CLAIMABLE_ROLES` via `AGENT_ROLES.filter(r => !ORCHESTRATING_ROLES.includes(r))` plus alias expansion. Add a Vitest assertion that every non-orchestrating `AGENT_ROLES` entry appears in `CLAIMABLE_ROLES`.

**G-2: Update or deprecate `rework-circuit-breaker.test.ts` simulation stub**
- **Source:** WP-002 (Developer, QA, Reviewer — independently flagged by all three)
- **Detail:** `rework-circuit-breaker.test.ts` contains a `simulateStartPipeline` function that hardcodes `implementation` counter increments. After WP-002's per-type rework counting fix, these tests pass only because they test their own simulation — not the live code. The new `start-pipeline-guards.test.ts` provides direct `_internal.startPipeline` integration coverage.
- **Action:** Replace `simulateStartPipeline` with direct calls to `_internal.startPipeline`, or mark the file as deprecated and port its coverage to `start-pipeline-guards.test.ts`.

### 🟢 Low Priority

**G-3: Move `CLAIMABLE_ROLES` guard to step 1b in `claimWorkPackage`**
- **Source:** WP-005 Reviewer
- **Detail:** Currently the role guard fires at step 2c (after assignment and override-auth guards). A non-claimable role (e.g., Planner) claiming a WP assigned to Developer receives the assignment error — masking the role error. Moving the guard to step 1b ensures role validation is always surfaced regardless of assignment state.

**G-4: Set `status_changed_at` in `propagateDependencyReblock` cascade writes**
- **Source:** WP-004 Reviewer
- **Detail:** `propagateDependencyReblock` transitions dependent WPs to BLOCKED but does not set `status_changed_at = now()`. Every direct status mutation in `updateWorkPackageStatus` sets `status_changed_at` (including BLOCKED→BLOCKED early returns), making the cascade writes inconsistent with the established `status_changed_at` invariant. `propagateDependencyUnblock` has the same omission (pre-existing gap).
- **Action:** Add `wpDetail.status_changed_at = now()` in the re-block candidate loop inside `propagateDependencyReblock`.

**G-5: Add circuit breaker ordering comment in `startPipeline`**
- **Source:** WP-002 Reviewer
- **Detail:** `rework_counts` is incremented before the circuit-breaker check (step 6b), so the breaker fires on the post-increment count. The write is aborted by `throw` so the increment is not persisted — but this sequencing is non-obvious to future maintainers.
- **Action:** Add a brief inline comment at step 6b: *"Uses the post-increment count; throw aborts the write so the increment is not persisted on circuit-breaker fire."*

**G-6: Document `propagateDependencyReblock` auto-cancel summary replacement as intentional**
- **Source:** WP-007 Reviewer
- **Detail:** `p.summary` is replaced entirely on auto-cancel — any partial progress notes recorded via `ledger_update_pipeline_progress` are lost. This is correct behavior (the work is void) but should be documented in the function's JSDoc as an intentional lossy operation.

---

## Technical Debt Inventory

| ID | File | Description | Priority | WP |
|----|------|-------------|----------|-----|
| TD-1 | `tests/tools/rework-circuit-breaker.test.ts` | Stale `simulateStartPipeline` stub tests own simulation, not live code | Medium | WP-002 |
| TD-2 | `src/tools/work-package.ts` | `CLAIMABLE_ROLES` not derived from `AGENT_ROLES`; drift risk on new role addition | Medium | WP-005 |
| TD-3 | `src/tools/work-package.ts` | `UpdateWorkPackageStatusSchema` `.describe()` omits `BLOCKED→BLOCKED` blocker-replacement operation | Low | WP-004 |
| TD-4 | `src/tools/work-package.ts` | `propagateDependencyReblock` / `propagateDependencyUnblock` don't set `status_changed_at` on cascade writes | Low | WP-004 |
| TD-5 | `src/tools/work-package.ts` | Steps 8a/8b auto-cancel blocks are nearly identical; DRY unification opportunity | Low | WP-004 |
| TD-6 | `src/tools/work-package.ts` | `acceptance_criteria` whitespace validation error message omits failing criterion index | Low | WP-006 |
| TD-7 | `tests/tools/cancelled-status.test.ts` | Pre-existing test asserting `COMPLETE→CANCELLED` is invalid was silently masking the missing transition | Low (closed) | WP-001 |

---

## Notable Architecture Observations

1. **Consistent PM Override pattern:** The `isPmOverride = agent_role === 'Project Manager'` boolean is now consistently used in `startPipeline` and `completePipeline` for both the role bypass and identity propagation (summary annotation / `from_agent`). This is a clean pattern worth preserving across all future tool guards.

2. **`_internal` export pattern for integration testing:** All three tool functions (`startPipeline`, `completePipeline`, `updateWorkPackageStatus`, `claimWorkPackage`) now export via `_internal` with `_ledgerRoot` injection. This pattern avoids filesystem coupling in tests without a full DI refactor.

3. **`FAIL_ROUTING_MAP` as source of truth:** The M-1 Gold Nugget (WP-002) eliminated a hardcoded `['implementation', 'qa', 'code-review']` array in `hasDownstreamReengagedSince()`, replacing it with runtime derivation from `FAIL_ROUTING_MAP`. A regression guard test locks this derivation permanently.

4. **`hasCycle()` is a forward-reference guard:** The BFS cycle detector in `createWorkPackage` catches cycles at creation time using the stored root index state. It correctly handles sequential creation workflows but does not evaluate cycles among WPs being created in the same batch operation.

5. **`propagateDependencyReblock` three-phase model:** The function now follows an explicit Phase 1 / Phase 2 / Phase 3 structure. This separates concerns cleanly (re-block, warn, invalidate synthesis) and matches the documentation contracts in both `api-surface.md` and `data-flows.md`.

---

## Next Steps for Planner / Manager

1. **Address TD-1 (highest priority):** Update `rework-circuit-breaker.test.ts` to call `_internal.startPipeline` directly. This removes a silent false-positive test suite that could mask future regressions in rework counting.

2. **Address TD-2 (highest priority):** Introduce `ORCHESTRATING_ROLES` in `constants.ts` and derive `CLAIMABLE_ROLES` computationally. Add a Vitest assertion for drift prevention. This closes a systematic gap flagged independently by QA, Reviewer, and a project-level observation.

3. **Consider adding multi-pipeline auto-cancellation test:** The auto-cancellation code in `propagateDependencyReblock` and `updateWorkPackageStatus` correctly handles multiple concurrent IN_PROGRESS pipelines via `filter + for`, but only single-pipeline scenarios are tested. A two-pipeline test would remove the implicit coverage assumption.

4. **Evaluate `COMPLETE→CANCELLED` caller updates:** Both `startPipeline` and `completePipeline` now require `agent_role` as a required field (breaking change). Any external callers (scripts, orchestrator, and persona templates invoking these tools) must be audited to confirm they pass `agent_role`.

---

*Generated by Synthesis Agent — 2026-02-27*
