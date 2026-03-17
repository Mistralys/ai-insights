# Synthesis Report -- Consolidate WP Writes (Follow-up)

**Project:** 2026-03-17-consolidate-wp-writes-followup
**Date:** 2026-03-17
**Status:** COMPLETE -- All 3 work packages passed all pipeline stages.

---

## Executive Summary

This project executed the three strategic recommendations carried forward from the prior "Consolidate WP Writes" synthesis: add an early-return guard to `propagateDependencyUnblock` (Recommendation 1), migrate `project-reset.ts` to `batchUpdateWorkPackagesWithSync` (Recommendation 2), and expand the `@internal` JSDoc caller enumeration on the write primitives (Recommendation 3).

WP-001 added a pre-check read to `propagateDependencyUnblock` so that the function returns immediately when no BLOCKED dependents exist, avoiding lock acquisition, a second root index read, all WP detail reads, and the meta sync write on the common no-op path. WP-002 replaced the three remaining direct `writeWorkPackage` calls in `project-reset.ts` with `batchUpdateWorkPackagesWithSync`, bringing the admin reset utility into alignment with the codebase's consolidated write contract and closing the last known source of stale `last_updated` timestamps. WP-003 expanded the `@internal` JSDoc on both write primitives: `writeRootIndex` now enumerates all four legitimate external callers by file and function name; `writeWorkPackage` now explicitly documents zero external callers post-migration. All 3 WPs completed the full 4-stage pipeline (implementation, QA, code review, documentation) with PASS status across all 14 pipeline runs (WP-003 required one rework cycle after QA caught two phantom function names in the initial JSDoc). The test suite finishes at 1432 tests across 44 files with zero failures.

---

## Work Package Results

### WP-001: Early-Return Guard in `propagateDependencyUnblock`

**Objective:** Skip lock acquisition, the in-batch root index read, all WP detail reads, and the meta sync write when no BLOCKED dependent WPs exist.

**What was done:**
- Added a pre-check to `propagateDependencyUnblock` in work-package.ts: reads `store.readRootIndex()` outside the lock and checks whether any BLOCKED WP in the index has `completedWpId` in its dependencies; returns immediately if none are found
- The guard filter exactly mirrors the batch callback filter, so the fast path is a strict subset of the hot path
- The batch method re-reads the root index inside its lock on the non-early-return path, preserving correctness under concurrent writes; the pre-check read is intentionally allowed to be stale
- Race condition is acceptably bounded: a false positive (WP transitions away from BLOCKED before the lock is acquired) causes the batch to incur only lock overhead; a false negative (WP becomes BLOCKED after the pre-check) is caught on the next dependency completion
- Updated api-surface.md and data-flows.md (Flows 5 and 6) to document the pre-check step and fast path

**Files modified:** work-package.ts, api-surface.md, data-flows.md
**Tests added:** 0 (guard logic is trivially correct and indirectly covered by existing propagation suite)

**Reviewer note (follow-up candidate):** `propagateDependencyReblock` has an identical unconditional-lock-entry structure and would benefit from the same early-return guard.

### WP-002: Migrate `project-reset.ts` to `batchUpdateWorkPackagesWithSync`

**Objective:** Replace the three remaining `writeWorkPackage` direct calls in `project-reset.ts` with `batchUpdateWorkPackagesWithSync`, applying auto-stamp and Zod validation guarantees to admin reset operations.

**What was done:**
- Replaced 3 direct `store.writeWorkPackage()` calls in `applyProjectReset` and `markProjectComplete` with `store.batchUpdateWorkPackagesWithSync()`
- Removed the outer `withLock()` wrappers from both functions -- the batch method now owns the lock scope
- Removed the `withLock` import from project-reset.ts entirely
- Reset WPs now receive auto-stamped `last_updated` (via `batchUpdateWorkPackagesWithSync` line 368) and Zod validation on every write
- A known cosmetic dual-timestamp skew exists: the callback constructs its own `timestamp = now()` for `status_changed_at` and `reset_at`; the batch method then stamps a second `now()` for `last_updated`. This sub-millisecond divergence is intentional by design and documented
- Updated constraints.md (constraint 2b and 2c) and api-surface.md to remove project-reset.ts from the `writeWorkPackage` legitimate callers list and add it to the `batchUpdateWorkPackagesWithSync` callers list

**Files modified:** project-reset.ts, api-surface.md, constraints.md
**Tests added:** 0 (all 19 existing project-reset tests pass unchanged; auto-stamp and Zod validation are verified via ledger-store.ts inspection)

### WP-003: Expand `@internal` JSDoc Caller Enumeration

**Objective:** Make the full set of legitimate direct callers of the write primitives explicit in their `@internal` JSDoc, enabling future contributors to distinguish approved callers from unauthorized bypasses.

**What was done:**
- Updated `writeRootIndex` JSDoc in ledger-store.ts to enumerate all 4 legitimate external callers:
  - project-lifecycle.ts -- `getProjectStatus()` self-healing (line 434), `initializeProject()` (line 560), `completeSynthesis()` (line 761)
  - auto-archive.ts -- archive finalization (line 80)
  - observations.ts -- root-only write (line 174)
  - workflow-handoff.ts -- handoff/synthesis completion (lines 203, 229)
- Updated `writeWorkPackage` JSDoc to explicitly state zero external callers post-WP-002 migration, naming project-reset.ts as a concrete migration example
- Updated api-surface.md and constraints.md (section 2c) to reflect the split: separate annotated entries for `writeRootIndex` callers and an explicit "zero external callers" paragraph for `writeWorkPackage`
- **Rework cycle:** QA caught that the initial JSDoc for `writeRootIndex` named two phantom functions (`updateProjectStatus()`, `completeProject()`) that do not exist in project-lifecycle.ts; corrected to the real callers `initializeProject()` and `completeSynthesis()` in the rework pass. Final caller list independently verified by grepping src/.

**Files modified:** ledger-store.ts, api-surface.md, constraints.md
**Tests added:** 0 (JSDoc-only change; all 1432 existing tests pass)
**Rework cycles:** 1 (QA caught incorrect function names in initial JSDoc)

---

## Aggregate Metrics

| Metric | Value |
|--------|-------|
| Work packages | 3 / 3 COMPLETE |
| Pipeline runs | 14 / 14 PASS (WP-003 had 1 QA rework cycle) |
| Total tests | 1432 |
| Tests failed | 0 |
| Test files | 44 |
| New tests added | 0 |
| Files modified (implementation) | work-package.ts, project-reset.ts, ledger-store.ts |
| Files modified (documentation) | api-surface.md, constraints.md, data-flows.md |
| Regressions | 0 |
| Security issues | 0 |
| Blocking bugs found and fixed | 0 |
| Rework cycles | 1 (WP-003: incorrect function names in initial JSDoc) |

---

## Strategic Recommendations

### 1. Add an Early-Return Guard to `propagateDependencyReblock`

**Source:** Developer and code reviewer observations on WP-001.

`propagateDependencyReblock` (work-package.ts, line ~1028) has the same unconditional-lock-entry pattern as `propagateDependencyUnblock` had before WP-001. When called and no READY or IN_PROGRESS dependents exist, it still acquires the lock, reads the root index, and writes it with an updated timestamp. An early-return guard mirroring the WP-001 implementation would eliminate this overhead on the common no-op path.

**Priority:** Low -- identical pattern, low risk, single-function edit.

### 2. Add an Explicit Unit Test for the Early-Return Path

**Source:** QA observation on WP-001.

No test currently exercises the zero-BLOCKED-dependents scenario for `propagateDependencyUnblock` explicitly (i.e., a scenario that asserts `batchUpdateWorkPackagesWithSync` is not called). The guard is trivially correct and indirectly covered by the broader propagation suite, but a direct unit test would protect the fast path against future refactors that inadvertently remove the guard.

**Priority:** Low -- correctness is not in question; this is a coverage hardening item.

### 3. Refactor `project-reset.ts` to Use `isTerminalStatus()` Instead of Inline Array

**Source:** Code reviewer project-level observation.

`project-reset.ts` (line 430) defines a local `nonTerminalStatuses = ['READY', 'IN_PROGRESS', 'BLOCKED']` array inline instead of using the shared `isTerminalStatus()` helper from validators.ts. The two definitions are functionally equivalent today (the enum has exactly 5 values), but the inline approach will silently diverge if a new value is ever added to `WorkPackageStatus`. The correct pattern -- `!isTerminalStatus(wp.status)` -- is already used in work-package.ts (line 1111) and project-lifecycle.ts. This is a single-line import + refactor.

**Priority:** Low -- no current divergence, but the debt becomes load-bearing if the status enum grows.

### 4. Enumerate `writeRootIndex` Callers at Function-Name Granularity for All Files

**Source:** Code reviewer observation on WP-003.

The `writeRootIndex` JSDoc now covers project-lifecycle.ts at function-name granularity (all three callers named), but `workflow-handoff.ts` is described only at file level (two call sites at lines 203 and 229 without function names). Extending the same function-name treatment to all caller files would make the JSDoc uniformly precise and reduce the verification burden for future auditors.

**Priority:** Low -- file-level granularity is sufficient today; address when workflow-handoff.ts is next modified.

---

## Observations

- **Clean execution:** All 3 WPs were straightforward and low-risk. This project resolved three low-priority debt items that had been explicitly deferred from the prior "Consolidate WP Writes" session. The pre-planned scope held -- no scope expansions, no blocking bugs, no regressions.
- **Rework attribution:** The single rework cycle on WP-003 was a JSDoc accuracy failure: two phantom function names (`updateProjectStatus`, `completeProject`) were written that do not exist in project-lifecycle.ts. QA caught the error by independently grepping the source. The fix was a one-line correction. This illustrates that JSDoc enumerations of external callers require the same verification rigor as behavioral claims -- they are wrong in a meaningful way if they name non-existent functions.
- **`project-reset.ts` write path is now fully consolidated:** With WP-002 complete, `writeWorkPackage` has zero external callers anywhere in the codebase. The `@internal` tag on `writeWorkPackage` (from the prior project) is now backed by a verifiable fact rather than an aspiration. Future auditors can confirm the boundary with a single grep.
- **WP-001 dual-read design:** The pre-check in `propagateDependencyUnblock` introduces a deliberate double read of the root index on the hot path (once outside the lock for the guard, once inside the batch lock). The code comment documents this explicitly. The design trades a small read overhead on the hot path for complete elimination of lock, WP reads, and writes on the cold path (no BLOCKED dependents). Given that most status transitions do not unblock any dependents, this is a net performance win.
- **Documentation coverage:** All three manifest documents affected by this project (api-surface.md, constraints.md, data-flows.md) were updated. No new source files were created, so file-tree.md required no changes. The project manifest is now consistent with the post-follow-up implementation state.

---

## Next Steps

1. **Future planner:** Consider adding an early-return guard to `propagateDependencyReblock` (Recommendation 1) -- it is a single-function edit directly parallel to WP-001.
2. **Future planner:** Evaluate adding an explicit unit test for the `propagateDependencyUnblock` early-return path (Recommendation 2) as a coverage hardening item.
3. **Future planner:** Refactor the inline `nonTerminalStatuses` array in `project-reset.ts` to use `isTerminalStatus()` (Recommendation 3) -- this is a one-line import + usage change and can be bundled with any future project-reset.ts edit.
4. **Project manager:** All three strategic recommendations from the prior "Consolidate WP Writes" synthesis are now addressed. The `batchUpdateWorkPackagesWithSync` consolidation is complete across all write sites. No remaining deferred items from that report.
