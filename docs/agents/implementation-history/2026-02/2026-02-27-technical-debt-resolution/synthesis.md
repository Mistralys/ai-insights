# Project Status Report — Technical Debt Resolution (Phase 4)

**Plan:** 2026-02-27-technical-debt-resolution
**Date:** 2026-02-27
**Status:** COMPLETE
**Work Packages:** 6 / 6 COMPLETE

---

## Executive Summary

Phase 4 successfully resolved all technical debt and code quality gaps identified during Phase 3 (Tool Guards & Status Transitions). Six work packages were completed across `constants.ts`, `work-package.ts`, `pipeline.ts`, and the test suite, with zero regressions. The session introduced no new features — it was a targeted hardening pass that:

- **Eliminated drift risk** by deriving `CLAIMABLE_ROLES` programmatically from `AGENT_ROLES` (removing a hardcoded array that would silently diverge on role additions)
- **Fixed guard ordering** in `claimWorkPackage` so non-claimable roles always receive the role error, regardless of assignment state or override flag
- **Replaced a stale test simulator** with live `_internal.startPipeline` calls, ensuring circuit-breaker tests validate actual production code paths
- **Patched missing `status_changed_at` writes** in cascade block/unblock transitions
- **Added multi-pipeline auto-cancellation coverage** and a batch of code quality and documentation improvements

Final test count: **709 / 709 passing**. TypeScript compiles clean (`tsc --noEmit` exit 0).

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 6 / 6 |
| Tests at session start | 706 |
| Tests at session end | **709** |
| Tests failed | **0** |
| TypeScript errors | **0** |
| Security issues | 0 |
| Pipelines run | 24 (4 per WP × 6 WPs) |
| Pipeline failures | 0 |
| Production files modified | 3 (`constants.ts`, `work-package.ts`, `pipeline.ts`) |
| Test files modified | 2 (`work-package.test.ts`, `rework-circuit-breaker.test.ts`) |
| Manifest files updated | 4 (`api-surface.md`, `constraints.md`, `data-flows.md`, `operations.md`) |

---

## Work Package Outcomes

### WP-001 — Derive `CLAIMABLE_ROLES` from `AGENT_ROLES` ✅

**Problem:** `CLAIMABLE_ROLES` was a standalone hardcoded array that would silently diverge if a new role was added to `AGENT_ROLES`.

**Solution:** Introduced `ORCHESTRATING_ROLES = ['Planner', 'Synthesis'] as const` in `constants.ts`. Replaced the hardcoded `CLAIMABLE_ROLES` literal in `work-package.ts` with a programmatic derivation via `AGENT_ROLES.filter(r => !ORCHESTRATING_ROLES.includes(r))`. Exported `CLAIMABLE_ROLES` as a named export. Added a 3-assertion drift guard test.

**Tests added:** 3 (drift guard: contains all non-orchestrating roles, excludes Planner, excludes Synthesis)

---

### WP-002 — Reorder Role Guard in `claimWorkPackage` ✅ *(depends on WP-001)*

**Problem:** The `CLAIMABLE_ROLES` guard was evaluated at step 2c (after assignment and override-auth checks), meaning a non-claimable role (e.g., Planner) could receive the assignment error rather than the role error if the WP had an explicit `assigned_to`.

**Solution:** Moved the guard from step 2c to step 1b — immediately after the READY check, before the assignment guard and override-auth guard. The role check now fires unconditionally regardless of WP state or override flag. Step comments renumbered (1, 1b, 2, 2b, 3, 4, 5, 6).

**Tests added:** 3 (Planner claiming Developer-assigned WP receives role error; Planner + override receives role error; negative assertion `not.toContain('assigned to')` pins ordering)

---

### WP-003 — Replace Stale `simulateStartPipeline` Simulator ✅

**Problem:** `rework-circuit-breaker.test.ts` contained a local `simulateStartPipeline` helper that mirrored `pipeline.ts` logic at a point in time. After WP-002 (Phase 3) introduced per-type `rework_counts`, the simulator became stale — tests validated their own local copy, not the live production code path.

**Solution:** Removed `simulateStartPipeline` and `simulateCompletePipeline` (dead code), imported `_internal` from `pipeline.ts`, rewrote all circuit-breaker describe block tests to call `_internal.startPipeline` directly with `process.argv` injection for `tempDir` routing. Error-surface assertions updated from `.rejects.toThrow()` to `.resolves + isError + content[0].text` to match how `_internal.startPipeline` returns errors.

**Tests affected:** All existing circuit-breaker tests now exercise live production code paths including per-type `rework_counts`.

---

### WP-004 — Set `status_changed_at` in Cascade Writes ✅

**Problem:** `propagateDependencyReblock` and `propagateDependencyUnblock` transitioned dependent WPs without setting `status_changed_at = now()` — a gap inconsistent with every direct status mutation in `updateWorkPackageStatus`.

**Solution:** Added `wpDetail.status_changed_at = now()` before `writeWorkPackage` in both cascade functions (lines 875 and 932 of `work-package.ts`).

**Tests added:** 2 (one per cascade direction: unblock→READY and reblock→BLOCKED, each asserting `status_changed_at` is a string within the expected time window)

---

### WP-005 — Multi-Pipeline Auto-Cancellation Test ✅

**Problem:** Existing auto-cancellation tests assumed a single IN_PROGRESS pipeline on the re-blocked WP. The production filter loop in `propagateDependencyReblock` handled multiple concurrent pipelines, but this was untested.

**Solution:** Added a test to the WP-007 describe block that creates two concurrent IN_PROGRESS pipelines (implementation + qa) on a dependent WP, fires `propagateDependencyReblock`, and asserts both receive `status: FAIL`, `auto_cancelled: true`, and `completed_at` set. No production code changes required — the existing loop was already correct.

**Tests added:** 1

---

### WP-006 — Code Quality & Documentation Improvements ✅

**Five independent fixes delivered in one batch:**

| Sub-item | Change |
|----------|--------|
| **G-5** | Inline comment at step 6b of `startPipeline` explaining post-increment / abort sequencing for the circuit breaker |
| **G-6** | JSDoc NOTE on `propagateDependencyReblock` documenting intentional lossy `p.summary` replacement on auto-cancel |
| **TD-3** | `UpdateWorkPackageStatusSchema` `.describe()` extended to mention `BLOCKED→BLOCKED` replaces existing blocker |
| **TD-5** | Steps 8a/8b inline auto-cancel blocks in `updateWorkPackageStatus` extracted into `autoCancelActivePipelines(wp, reason)` private helper (DRY) |
| **TD-6** | `acceptance_criteria` whitespace-validation error now includes failing criterion index: `acceptance_criteria[${i}] is empty or whitespace-only` |

---

## Strategic Recommendations (Gold Nuggets)

These observations were collected from pipeline comments across the session and represent actionable follow-up work.

### 1. Shared Vitest Test Helper Module (Medium Priority)

**Identified by:** Reviewer (WP-003, code-review), Developer (WP-003, WP-006)

Two patterns are now duplicated across at least two test files and will compound as coverage grows:

- **`process.argv` injection pattern** (`push --ledger-dir` in `beforeEach`, restore `originalArgv` in `afterEach`) — currently in `start-pipeline-guards.test.ts` and `rework-circuit-breaker.test.ts`. An `injectLedgerDir(dir)` helper returning a cleanup function would be self-documenting and prevent flag-name drift.
- **`Math.floor(Date.now()/1000)*1000` lower-bound pattern** for second-precision timestamp assertions — currently in `rework-circuit-breaker.test.ts` and `work-package.test.ts` (WP-004 tests). A `nowFloor()` export would prevent copy-paste errors.

**Recommended action:** Create `mcp-server/tests/helpers/test-utils.ts` exporting `injectLedgerDir(dir)` and `nowFloor()`. Update existing duplicated usages.

---

### 2. Derive the `CLAIMABLE_ROLES` Error Message String at Runtime (Low Priority)

**Identified by:** Reviewer (WP-002, code-review)

In `claimWorkPackage` (~line 421 of `work-package.ts`), the error message hardcodes `"Valid roles: Developer, QA, Reviewer, Documentation, Project Manager."` This string can silently diverge from `CLAIMABLE_ROLES` if a new claimable role is ever added without updating the message.

**Recommended fix:**
```ts
`Valid roles: ${CLAIMABLE_ROLES.filter(r => !r.endsWith(' Agent')).join(', ')}.`
```
Non-blocking today (CLAIMABLE_ROLES is stable), but warrants tightening before the next role addition.

---

### 3. Extend `autoCancelActivePipelines` to `propagateDependencyReblock` (Low Priority)

**Identified by:** Reviewer (WP-006, code-review)

`autoCancelActivePipelines(wp, reason)` was extracted to DRY the two auto-cancel call sites in `updateWorkPackageStatus`. However, `propagateDependencyReblock` (lines 939–948) retains an identical inline block rather than calling the same helper. This creates 3 call sites with only 2 DRYed.

The dynamic reason string used there (`Auto-cancelled: dependency ${reopenedWpId} was reopened`) fits the helper's signature cleanly.

**Recommended action:** Replace the inline block in `propagateDependencyReblock` with `autoCancelActivePipelines(wpDetail, \`Auto-cancelled: dependency ${reopenedWpId} was reopened\`)`.

---

### 4. Extend `CLAIMABLE_ROLES` Drift Guard to Cover `*Agent` Aliases (Low Priority)

**Identified by:** QA (WP-001, qa)

The drift guard tests cover only bare role names (no `*Agent` suffix), per the acceptance criteria. However, `CLAIMABLE_ROLES` also includes aliased variants (`Developer Agent`, etc.). If an orchestrating role ever gained an alias, the alias would not be caught.

**Recommended action:** Consider extending the guard to assert no `ORCHESTRATING_ROLES[i] + ' Agent'` variant is present in `CLAIMABLE_ROLES`, or add a comment in the test documenting the intentional scope limit.

---

### 5. `for` Loop Index Access Pattern with `noUncheckedIndexedAccess` (Low Priority)

**Identified by:** Developer (WP-006, implementation)

`tsconfig.json` enables `noUncheckedIndexedAccess`. For-loop index access (e.g., `args.acceptance_criteria[i]`) requires a non-null assertion (`!`) since TypeScript cannot narrow to in-bounds despite the `< .length` guard. This will recur.

**Recommended convention:** Standardise on `for-of` loops where the element is needed, or consistently apply `!` with an explanatory comment when `for (let i …)` is required. Document in constraints.md.

---

## Next Steps for Planner / Manager

1. **Consider creating `mcp-server/tests/helpers/test-utils.ts`** as a follow-up ticket (Recommendation 1). This is the highest-value housekeeping item — two patterns are already duplicated and will compound.
2. **Derive the CLAIMABLE_ROLES error message string** (Recommendation 2) before the next role addition. Low effort, prevents a silent divergence bug.
3. **Extend `autoCancelActivePipelines` to `propagateDependencyReblock`** (Recommendation 3) for full DRY consistency. One-line change.
4. **Phase 5 direction:** All Phase 4 debt is resolved. The codebase is clean. The natural next focus areas are: new feature work from the product backlog, or a test-infrastructure improvement sprint targeting Recommendations 1–3 above.
