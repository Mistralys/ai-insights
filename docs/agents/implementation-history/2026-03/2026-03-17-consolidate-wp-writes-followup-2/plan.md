# Plan: Consolidate WP Writes — Follow-up Hardening Round 2

**Source:** Synthesis recommendations 1-4 from `2026-03-17-consolidate-wp-writes-followup`
**Priority:** Low
**Risk:** Very low — single-function edits, test additions, and JSDoc updates
**Branch:** `feature-extended-workflow` (current)

---

## Work Packages

### WP-001: Early-Return Guard in `propagateDependencyReblock`

**Scope:** Mirror the WP-001 pattern from the prior project: add a pre-check read to `propagateDependencyReblock` (work-package.ts, ~line 1028) that returns early when no non-terminal, non-BLOCKED dependents exist for the reopened WP. Avoids lock acquisition, root index write, and meta sync on the common no-op path.

**Files:** `work-package.ts`, `api-surface.md`, `data-flows.md`
**Acceptance Criteria:**
- `propagateDependencyReblock` returns early without calling `batchUpdateWorkPackagesWithSync` when no candidates exist
- All existing propagation and dependency tests pass unchanged
- Manifest docs updated to reflect the new guard

### WP-002: Unit Test for `propagateDependencyUnblock` Early-Return Path

**Scope:** Add an explicit unit test that exercises the zero-BLOCKED-dependents scenario for `propagateDependencyUnblock`, asserting that `batchUpdateWorkPackagesWithSync` is NOT called when no candidates exist.

**Files:** Test file(s) in `mcp-server/tests/`
**Acceptance Criteria:**
- New test verifies `batchUpdateWorkPackagesWithSync` is not called when `propagateDependencyUnblock` has no BLOCKED dependents
- All existing tests pass unchanged

### WP-003: Refactor `project-reset.ts` to Use `isTerminalStatus()`

**Scope:** Replace the inline `nonTerminalStatuses = ['READY', 'IN_PROGRESS', 'BLOCKED']` array in `project-reset.ts` (line ~430) with the shared `isTerminalStatus()` helper from `validators.ts`. Single-line import + usage change.

**Files:** `project-reset.ts`
**Acceptance Criteria:**
- No inline `nonTerminalStatuses` array in `project-reset.ts`
- Uses `isTerminalStatus()` from validators.ts instead
- All existing project-reset tests pass unchanged

### WP-004: Enumerate `writeRootIndex` Callers at Function-Name Granularity

**Scope:** Expand the `writeRootIndex` `@internal` JSDoc in `ledger-store.ts` to name the specific functions in `workflow-handoff.ts` that call it (currently only listed at file level). Also update `api-surface.md` and `constraints.md` to match.

**Files:** `ledger-store.ts`, `api-surface.md`, `constraints.md`
**Acceptance Criteria:**
- `writeRootIndex` JSDoc names specific functions in `workflow-handoff.ts` (not just the file)
- Manifest docs updated to match
- No code changes beyond JSDoc/docs

---

## Execution Strategy

- All 4 WPs are independent and can be executed in parallel
- Estimated complexity: Very low — all are single-function or single-line changes
