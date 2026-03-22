# Synthesis Report -- Consolidate WP Writes

**Project:** 2026-03-17-consolidate-wp-writes
**Date:** 2026-03-17
**Status:** COMPLETE -- All 3 work packages passed all pipeline stages.

---

## Executive Summary

This project addressed Strategic Recommendation 1 from the prior "Spec Sync v2.3-v2.4 Rework" synthesis: consolidate all WP write paths through a single choke point to eliminate the maintenance burden of manually applying side effects (timestamps, Zod validation, meta sync) at each write site.

Three work packages were executed: WP-001 introduced `createWorkPackageWithSync` to cover the WP creation path; WP-002 introduced `batchUpdateWorkPackagesWithSync` to cover the batch-propagation paths (`propagateDependencyUnblock`, `propagateDependencyReblock`); and WP-003 confirmed the absence of remaining bypass paths and annotated the underlying write primitives with `@internal` JSDoc. All 3 WPs completed the full 4-stage pipeline (implementation, QA, code review, documentation) with PASS status across all 12 pipeline runs. The test suite finishes at 1432 tests across 44 files with zero failures.

A notable mid-project finding: the code reviewer identified a blocking atomicity bug in the initial `batchUpdateWorkPackagesWithSync` implementation -- the original single-loop design interleaved validation and disk writes, which could have left WP files partially written while the root index remained stale on a mid-batch validation failure. The reviewer introduced a two-pass validate-all-then-write-all structure and added a dedicated test to protect the guarantee. This is the central architectural invariant established by the project.

---

## Work Package Results

### WP-001: Add `createWorkPackageWithSync` to LedgerStore

**Objective:** Route `createWorkPackage` through a new sync method that provides the same lock, validation, auto-stamp, and meta-sync guarantees as `updateWorkPackageWithSync`.

**What was done:**
- Added `createWorkPackageWithSync` to LedgerStore mirroring `updateWorkPackageWithSync`: acquires lock on storageDir, invokes creator callback, auto-stamps `last_updated`, validates WP detail and root index via Zod, writes both atomically, syncs `.meta.json`
- Refactored `createWorkPackage` in work-package.ts to delegate entirely to `store.createWorkPackageWithSync()`, removing the raw `withLock + writeWorkPackage + writeRootIndex` pattern
- The Developer also landed `batchUpdateWorkPackagesWithSync` and fully migrated `propagateDependencyUnblock` and `propagateDependencyReblock` ahead of the WP-002 schedule, removing the `withLock` import from work-package.ts entirely
- Added 6 unit tests covering: atomic WP+root write, `last_updated` auto-stamp, schema validation rejection (no file written on failure), callback error rollback, `.meta.json` sync, and return value

**Files modified:** ledger-store.ts, work-package.ts, ledger-store.test.ts
**Tests added:** 6

### WP-002: Add `batchUpdateWorkPackagesWithSync` to LedgerStore

**Objective:** Route `propagateDependencyUnblock` and `propagateDependencyReblock` through a new batch sync method that acquires a single lock for all WPs in a propagation wave.

**What was done:**
- Added `batchUpdateWorkPackagesWithSync` to LedgerStore: single lock acquisition over storageDir, callback receives root index + `readWp` helper, auto-stamps `last_updated` with a shared timestamp across all batch WPs, validates each WP via `WorkPackageDetailSchema` and root index via `RootIndexSchema`, writes all WP files then root index, syncs `.meta.json` exactly once
- Refactored `propagateDependencyUnblock` and `propagateDependencyReblock` to use the batch method, removing all manual `withLock`, `writeWorkPackage`, `writeRootIndex`, and `last_updated` stamp calls
- Code reviewer identified and fixed a critical atomicity bug: the original implementation validated and wrote each WP in the same loop iteration, meaning a validation failure on WP-N could leave WP-1 through WP-(N-1) written while the root index was still stale. Fixed by splitting into two passes: Pass 1 validates all WPs and the root index; Pass 2 writes all pre-validated objects. A failure in Pass 1 aborts before any file is touched
- Added 7 unit tests (+ 1 added by code reviewer for mid-batch validation failure) covering: multi-WP atomic write, `last_updated` auto-stamp, Zod validation rejection, callback error rollback, empty `updatedWps` handling, `readWp` helper, meta sync, and mid-batch failure isolation

**Files modified:** ledger-store.ts, work-package.ts, ledger-store.test.ts, data-flows.md
**Tests added:** 8 (7 implementation + 1 code review)

### WP-003: Bypass Audit and `@internal` Cleanup

**Objective:** Confirm zero remaining bypass paths and annotate the write primitives as internal.

**What was done:**
- Audited all `store.writeWorkPackage()` and `store.writeRootIndex()` calls outside LedgerStore methods; confirmed the three former bypass paths in work-package.ts are fully eliminated
- Verified no redundant WP-detail `last_updated = now()` stamps remain on former bypass paths (root index `last_updated` stamps in the batch callbacks are on root index objects and are correctly retained)
- Added `@internal` JSDoc to both `writeWorkPackage` and `writeRootIndex` in ledger-store.ts, identifying them as callable only from LedgerStore sync methods and documenting the project-lifecycle.ts self-healing exception
- Confirmed remaining direct `writeRootIndex` calls in observations.ts, workflow-handoff.ts, project-lifecycle.ts, and auto-archive.ts are all legitimate root-only writes (no concurrent WP write); `writeWorkPackage` calls in project-reset.ts operate inside an explicit `withLock` admin utility
- Updated api-surface.md, constraints.md (new Constraint 2c), and data-flows.md to reflect the `@internal` boundary

**Files modified:** ledger-store.ts, api-surface.md, constraints.md, data-flows.md
**Tests added:** 0 (audit-only scope; all 1432 existing tests pass)

---

## Aggregate Metrics

| Metric | Value |
|--------|-------|
| Work packages | 3 / 3 COMPLETE |
| Pipeline runs | 12 / 12 PASS |
| Total tests | 1432 |
| Tests failed | 0 |
| Test files | 44 |
| New tests added | 14 (6 WP-001, 8 WP-002) |
| Files modified (implementation) | ledger-store.ts, work-package.ts, ledger-store.test.ts |
| Files modified (documentation) | api-surface.md, constraints.md, data-flows.md |
| Regressions | 0 |
| Security issues | 0 |
| Blocking bugs found and fixed | 1 (batchUpdateWorkPackagesWithSync atomicity) |

---

## Strategic Recommendations

### 1. Add an Early-Return Guard to `propagateDependencyUnblock` for Empty Candidates

**Source:** Developer, QA, and code reviewer observations on WP-002.

When `propagateDependencyUnblock` is called and no dependent WPs are in BLOCKED state (`candidates.length === 0`), the function still acquires the lock, reads the root index, stamps `last_updated`, writes the root index, and syncs `.meta.json`. This is a no-op disk write on what is likely the most common call path (most status transitions do not unblock any dependent WPs). An early-return guard before the `batchUpdateWorkPackagesWithSync` call would eliminate this overhead.

**Priority:** Low -- correctness is unaffected; purely an efficiency improvement.

### 2. Migrate `project-reset.ts` to `batchUpdateWorkPackagesWithSync`

**Source:** WP-003 implementation and code reviewer observations.

`project-reset.ts` calls `writeWorkPackage` directly within its own `withLock` scope at lines 401, 415, and 511. These calls predate the sync method consolidation and do not set `wp.last_updated` before writing, meaning WP files touched by admin reset operations carry a stale `last_updated` timestamp. Migrating these to `batchUpdateWorkPackagesWithSync` would apply the auto-stamp and Zod validation guarantees consistently. Since this is an admin/reset utility used infrequently, the risk is low.

**Priority:** Low -- admin reset context makes the stale timestamp low-risk today, but alignment becomes more important if WP-level activity timestamps become user-visible.

### 3. Enumerate All Legitimate `writeRootIndex` Callers in the `@internal` JSDoc

**Source:** WP-003 code reviewer.

The current `@internal` JSDoc on `writeRootIndex` identifies the project-lifecycle.ts self-healing exception but does not enumerate the other accepted direct callers (project-reset.ts, auto-archive.ts, observations.ts, workflow-handoff.ts). A future contributor reading the comment cannot distinguish a legitimate caller from a new bypass. Expanding the JSDoc (or adding a `// eslint-disable-next-line @internal` pattern at each call site) would make the full exception surface explicit.

**Priority:** Low -- all current callers are inside `withLock`; the risk of an accidental new bypass is low.

### 4. Consider a `writeRootIndexWithSync` Convenience Wrapper

**Source:** WP-003 implementation observations.

Several callers (observations.ts, workflow-handoff.ts, auto-archive.ts) need to write the root index without a concurrent WP write. They call `writeRootIndex` directly inside their own `withLock` scopes, duplicating the lock + write + meta-sync pattern. A `writeRootIndexWithSync` convenience method on LedgerStore would unify these root-only write paths and ensure meta sync happens consistently.

**Priority:** Low -- deferred until the pattern appears in more callers or a root-index side-effect (e.g., audit trail) needs to be applied uniformly.

---

## Observations

- **Atomicity bug caught in review:** The most consequential finding of the project was the code reviewer's identification of a validate-write interleaving bug in `batchUpdateWorkPackagesWithSync`. The two-pass fix and its accompanying "mid-batch validation failure" test are the primary correctness deliverables of WP-002 -- without them, the new batch method would have reintroduced exactly the WP-file/root-index desync it was designed to prevent.
- **Ahead-of-schedule scope:** The Developer completed the `propagateDependencyUnblock` and `propagateDependencyReblock` migrations during the WP-001 implementation pass, leaving WP-002 responsible only for tests and documentation. This reduced WP-002 to a verification and hardening task rather than a migration task.
- **Clean pipeline observations:** All 12 pipeline comment threads across 3 WPs were rated low priority / improvement. No bugs, regressions, edge cases, or code smells were identified by QA or code review outside the one blocking atomicity fix.
- **Documentation coverage:** All three manifest documents (api-surface.md, constraints.md, data-flows.md) were updated. No new source files were created, so file-tree.md required no changes.
- **`@internal` is documentation-only:** TypeScript does not enforce `@internal` at compile time. The tag documents intent but cannot prevent direct access. If the boundary becomes critical to enforce, renaming the methods with an underscore prefix (`_writeWorkPackage`, `_writeRootIndex`) is the idiomatic TypeScript signal for callers outside the class.

---

## Next Steps

1. **Future planner:** Consider the early-return guard for `propagateDependencyUnblock` (Recommendation 1) as a low-risk single-line change.
2. **Future planner:** Evaluate migrating `project-reset.ts` to `batchUpdateWorkPackagesWithSync` (Recommendation 2) as a standalone admin-tooling hardening task.
3. **Future planner:** Expand the `@internal` JSDoc caller enumeration (Recommendation 3) -- this is a documentation-only change and can be bundled with any future ledger-store.ts edit.
4. **Project manager:** Strategic Recommendation 1 from the "Spec Sync v2.3-v2.4 Rework" synthesis (consolidate all WP writes through `updateWorkPackageWithSync`) is now fully addressed. No remaining items from that report.
