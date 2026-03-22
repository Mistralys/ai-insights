# Plan: Consolidate WP Writes — Follow-up Hardening

**Source:** Synthesis recommendations 1-3 from `2026-03-17-consolidate-wp-writes`
**Priority:** Low
**Risk:** Low — efficiency fix, admin utility migration, and documentation-only change
**Branch:** `feature-extended-workflow` (current)

---

## Problem Statement

The "Consolidate WP Writes" project successfully routed all WP write paths through sync methods. Three low-priority follow-up items remain:

1. `propagateDependencyUnblock` performs a no-op disk write (lock, read, write root index, meta sync) when no BLOCKED WPs are candidates — the most common call path
2. `project-reset.ts` still calls `writeWorkPackage` directly, bypassing `last_updated` auto-stamp and Zod validation
3. The `@internal` JSDoc on `writeRootIndex` only names the project-lifecycle.ts exception, not the other 4 legitimate direct callers

---

## Work Packages

### WP-001: Early-Return Guard in `propagateDependencyUnblock`

**Scope:** Add an early-return check before calling `batchUpdateWorkPackagesWithSync` when no BLOCKED dependents exist for the completed WP. This avoids acquiring the lock, reading/writing root index, and syncing meta when there's nothing to propagate.

**Files:** `work-package.ts`
**Tests:** Verify existing propagation tests still pass; optionally add a test confirming no disk write on empty candidate list
**Acceptance Criteria:**
- `propagateDependencyUnblock` returns early without calling `batchUpdateWorkPackagesWithSync` when no candidates exist
- All existing propagation and dependency tests pass unchanged
- No behavioral change for cases where candidates do exist

### WP-002: Migrate `project-reset.ts` to `batchUpdateWorkPackagesWithSync`

**Scope:** Replace the 3 direct `writeWorkPackage` calls in `project-reset.ts` (lines ~401, ~415, ~511) with `batchUpdateWorkPackagesWithSync`, gaining auto-stamp and Zod validation guarantees. The existing `withLock` scope should be replaced by the batch method's internal lock.

**Files:** `project-reset.ts`, potentially `project-reset.test.ts`
**Tests:** All existing project-reset tests pass; verify `last_updated` is now set on reset WPs
**Acceptance Criteria:**
- No direct `writeWorkPackage` calls remain in `project-reset.ts`
- Reset WPs have `last_updated` auto-stamped after reset operations
- All existing project-reset tests pass unchanged
- Zod validation applied to all WP writes during reset

### WP-003: Expand `@internal` JSDoc Caller Enumeration

**Scope:** Update the `@internal` JSDoc on `writeRootIndex` in `ledger-store.ts` to enumerate all 5 legitimate direct callers: project-lifecycle.ts (self-healing), project-reset.ts, auto-archive.ts, observations.ts, workflow-handoff.ts. Similarly verify `writeWorkPackage` JSDoc is complete (should only list project-reset.ts after WP-002 migration, plus internal sync methods).

**Files:** `ledger-store.ts`
**Tests:** None (documentation-only change)
**Dependencies:** WP-002 (the caller list for `writeWorkPackage` depends on whether project-reset.ts is migrated)
**Acceptance Criteria:**
- `writeRootIndex` JSDoc lists all 5 legitimate direct callers by file name
- `writeWorkPackage` JSDoc is updated to reflect post-migration caller list
- No code changes beyond JSDoc comments

---

## Execution Strategy

- **WP-001 and WP-002** are independent and can be executed in parallel
- **WP-003** depends on WP-002 (needs final caller list after migration)
- All WPs use the standard 4-stage pipeline
- Estimated complexity: Very low
