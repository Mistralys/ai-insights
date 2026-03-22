# Plan: Consolidate All WP Writes Through updateWorkPackageWithSync

**Source:** Synthesis Recommendation #1 from `2026-03-17-spec-sync-v2.3-v2.4-rework-1`
**Priority:** Medium
**Risk:** Low — internal refactoring only, no user-facing behavior change
**Branch:** `feature-extended-workflow` (current)

---

## Problem Statement

Three WP write paths bypass `LedgerStore.updateWorkPackageWithSync()`, each managing their own `withLock()` scope and manually writing WP detail + root index files:

1. **`createWorkPackage`** (work-package.ts:257) — constructs a new WP, writes both files via `store.writeWorkPackage()` + `store.writeRootIndex()` inside its own lock
2. **`propagateDependencyUnblock`** (work-package.ts:971) — transitions multiple BLOCKED→READY WPs, writes each via `store.writeWorkPackage()` + final `store.writeRootIndex()` inside its own lock
3. **`propagateDependencyReblock`** (work-package.ts:1037) — transitions multiple WPs to BLOCKED, auto-cancels pipelines, writes each via `store.writeWorkPackage()` + final `store.writeRootIndex()` inside its own lock

This means any future per-write side effects added to `updateWorkPackageWithSync` (like the `last_updated` auto-stamp from WP-002) must be manually replicated in all three bypass paths. This is a maintenance burden and a source of potential drift.

## Goal

Route all WP detail writes through `updateWorkPackageWithSync` (or a new sibling method on `LedgerStore`) so that:
- `last_updated` auto-stamping is guaranteed for every write
- Schema validation (`WorkPackageDetailSchema.parse`) is guaranteed for every write
- `.meta.json` sync is guaranteed for every write
- Future per-write side effects have a single place to live

## Challenges

### Challenge 1: `createWorkPackage` — WP doesn't exist yet
`updateWorkPackageWithSync` assumes the WP already exists (it calls `readWorkPackage(wpId)`). For creation, the WP file doesn't exist yet.

**Approach:** Add a new `createWorkPackageWithSync` method to `LedgerStore` that mirrors `updateWorkPackageWithSync` but accepts a pre-built `WorkPackageDetail` and `RootIndex` updater callback. It should share the same post-write guarantees (validation, meta sync, last_updated stamp).

### Challenge 2: Propagation functions operate on multiple WPs per lock
`propagateDependencyUnblock` and `propagateDependencyReblock` iterate over multiple candidate WPs within a single lock scope, writing each one, then writing the root index once at the end. `updateWorkPackageWithSync` operates on exactly one WP per call and acquires its own lock.

**Approach:** Add a new `updateMultipleWorkPackagesWithSync` method (or `batchUpdateWorkPackagesWithSync`) to `LedgerStore` that accepts a callback receiving the root index and a batch-write helper. This preserves the single-lock-scope semantics while routing all individual WP writes through validation and auto-stamping.

### Challenge 3: Propagation warning writes to COMPLETE WPs
`propagateDependencyReblock` also writes warning comments to COMPLETE dependent WPs without changing their status. These are WP writes that should also go through the choke point.

**Approach:** Include these in the batch operation — the callback can modify any WP it reads.

---

## Work Packages

### WP-001: Add `createWorkPackageWithSync` to LedgerStore

**Scope:** Add a new method to `LedgerStore` that handles atomic WP creation with the same guarantees as `updateWorkPackageWithSync`:
- Accepts a callback `(root: RootIndex) => { wp: WorkPackageDetail; root: RootIndex }`
- Validates both objects via schema `.parse()`
- Auto-stamps `last_updated` on the WP
- Writes both files atomically under a single lock
- Syncs `.meta.json`

Refactor `createWorkPackage` in work-package.ts to use this new method instead of raw `writeWorkPackage` + `writeRootIndex`.

**Files:** `ledger-store.ts`, `work-package.ts`
**Tests:** Unit test for the new method, verify `createWorkPackage` still passes all existing tests
**Acceptance Criteria:**
- `createWorkPackageWithSync` method exists on `LedgerStore`
- `createWorkPackage` tool function uses it instead of direct file writes
- All existing `createWorkPackage` tests pass unchanged
- New unit test verifies schema validation + last_updated auto-stamp on creation

### WP-002: Add `batchUpdateWorkPackagesWithSync` to LedgerStore

**Scope:** Add a batch-update method to `LedgerStore` that handles multi-WP updates in a single lock scope:
- Accepts a callback `(root: RootIndex, readWp: (id: string) => Promise<WorkPackageDetail>) => { updatedWps: Map<string, WorkPackageDetail>; root: RootIndex }`
- Validates all WP details and root index via schema `.parse()`
- Auto-stamps `last_updated` on each modified WP
- Writes all files atomically under a single lock
- Syncs `.meta.json` once at the end

Refactor `propagateDependencyUnblock` and `propagateDependencyReblock` to use this method.

**Files:** `ledger-store.ts`, `work-package.ts`
**Dependencies:** None (independent of WP-001)
**Tests:** Unit test for the new method, verify propagation functions still pass all existing tests
**Acceptance Criteria:**
- `batchUpdateWorkPackagesWithSync` method exists on `LedgerStore`
- `propagateDependencyUnblock` uses it instead of direct file writes
- `propagateDependencyReblock` uses it instead of direct file writes
- All existing propagation tests pass unchanged
- New unit test verifies schema validation + last_updated auto-stamp on batch updates
- Single lock acquisition per propagation call (no regression from current behavior)

### WP-003: Remove Direct Write Bypass Verification + Cleanup

**Scope:** After WP-001 and WP-002 are complete:
- Audit all remaining callers of `store.writeWorkPackage()` and `store.writeRootIndex()` outside of `LedgerStore` methods to confirm zero bypass paths remain
- Add a code comment / JSDoc on `writeWorkPackage` and `writeRootIndex` marking them as internal (should only be called from within `LedgerStore` sync methods)
- Remove any now-dead `last_updated = now()` manual stamps that are redundant with the auto-stamp in the sync methods

**Files:** `ledger-store.ts`, `work-package.ts`, potentially `pipeline.ts`, `project-lifecycle.ts`
**Dependencies:** WP-001, WP-002
**Tests:** Verify no test regressions, confirm `last_updated` is still correctly set via integration tests
**Acceptance Criteria:**
- No direct `store.writeWorkPackage()` calls exist outside `LedgerStore` sync methods (except `writeRootIndex` in project-lifecycle self-healing which has its own valid pattern)
- Redundant manual `last_updated = now()` assignments removed from bypass paths
- All 1418+ tests pass with zero failures

---

## Execution Strategy

- **WP-001 and WP-002** are independent and can be executed in parallel
- **WP-003** depends on both WP-001 and WP-002
- All WPs use the standard 4-stage pipeline: implementation → QA → code-review → documentation
- Estimated complexity: Low-Medium (internal plumbing, no new features)
