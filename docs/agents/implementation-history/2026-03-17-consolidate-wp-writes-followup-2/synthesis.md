# Synthesis Report: Consolidate WP Writes Follow-up 2

**Date:** 2026-03-17
**Status:** COMPLETE
**Branch:** feature-extended-workflow

---

## Executive Summary

This project addressed four targeted follow-up items from prior consolidation work on the `feature-extended-workflow` branch. The changes span a correctness guard, a unit test gap, an internal code quality refactor, and a JSDoc factual correction.

WP-001 verified and confirmed the `propagateDependencyReblock` early-return guard that mirrors the symmetric `propagateDependencyUnblock` guard — the implementation was already present on the branch from earlier work. WP-002 added a missing spy-based unit test for the `propagateDependencyUnblock` early-return path, explicitly documenting the performance contract that the batch lock is not acquired when no BLOCKED dependents exist. WP-003 eliminated the inline `nonTerminalStatuses` array in `project-reset.ts` in favour of the canonical `isTerminalStatus()` predicate from `validators.ts`. WP-004 corrected a factual inaccuracy in the `writeRootIndex` JSDoc: the prior entry incorrectly attributed `synthesis_generated` writes to `workflow-handoff.ts`, whereas those writes are performed exclusively by `completeSynthesis()` in `project-lifecycle.ts`; the entry now names `buildHandoffResponse()` specifically and describes its actual responsibility (auto-handoff depth tracking).

All 4 work packages passed all pipeline stages (implementation, QA, code review, documentation) without any blocking issues or rework cycles. The test suite grew by 1 test (the new early-return guard unit test in WP-002). The final suite stands at 1433 tests across 44 files with zero failures.

---

## Work Package Summary

| WP | Description | ACs | Tests Added | Key Files Modified |
|----|-------------|-----|-------------|-------------------|
| WP-001 | `propagateDependencyReblock` early-return guard (verification) | 3/3 met | 0 (already implemented) | None |
| WP-002 | Unit test for `propagateDependencyUnblock` early-return path | 2/2 met | 1 new test | `tests/tools/work-package.test.ts` |
| WP-003 | Refactor `project-reset.ts` to use `isTerminalStatus()` | 3/3 met | 0 (pure refactor) | `src/utils/project-reset.ts` |
| WP-004 | `writeRootIndex` JSDoc function-name granularity fix | 3/3 met | 0 (docs/JSDoc only) | `src/storage/ledger-store.ts`, `docs/agents/project-manifest/api-surface.md`, `docs/agents/project-manifest/constraints.md` |

**Total acceptance criteria:** 11/11 met
**Total new tests:** 1

---

## Metrics

| Metric | Value |
|--------|-------|
| Test suite size (start) | 1432 |
| Test suite size (end) | 1433 |
| Tests added | 1 |
| Tests failed | 0 |
| Regressions | 0 |
| Rework cycles | 0 |
| Pipeline stages completed | 16 (4 per WP x 4 WPs) |
| Pipeline stages PASS | 16/16 |
| Compilation errors | 0 |
| Security issues | 0 |
| Blocking issues | 0 |

---

## Files Modified

### Source files (2)
- `mcp-server/src/utils/project-reset.ts` — replaced inline `nonTerminalStatuses` array with `isTerminalStatus()` call
- `mcp-server/src/storage/ledger-store.ts` — corrected `writeRootIndex` JSDoc: named `buildHandoffResponse()` and corrected factual error re `synthesis_generated` attribution

### Test files (1)
- `mcp-server/tests/tools/work-package.test.ts` — new spy-based test for `propagateDependencyUnblock` early-return path

### Documentation files (2)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — updated to name `buildHandoffResponse()` with accurate description
- `mcp-server/docs/agents/project-manifest/constraints.md` — updated to name `buildHandoffResponse()` with accurate description

---

## Strategic Recommendations

### 1. Promote `ACTION_STATUSES` constant in `propagateDependencyReblock` to module level

**Priority:** Low
**Source:** Reviewer (WP-001)

The `ACTION_STATUSES = new Set(['READY', 'IN_PROGRESS', 'COMPLETE'])` set is declared as a `const` inside the function body of `propagateDependencyReblock` (`work-package.ts:1055`). Since it is a literal value and the function is module-private, it could be promoted to a module-level constant to avoid reallocation on each call. Non-blocking — the function is called only on `COMPLETE→IN_PROGRESS` transitions and the allocation cost is negligible — but the promotion would improve consistency with how similar guard sets are handled elsewhere.

### 2. Prevent mirror drift between JSDoc and manifest docs with a lint guard

**Priority:** Low
**Source:** Developer (WP-004)

The `writeRootIndex` JSDoc in `ledger-store.ts` and its mirrors in `api-surface.md` (line 584) and `constraints.md` (line 141) were out of sync, leading to a factual error that persisted until this WP. The comment structure duplicates information across three files. Consider either (a) a lint rule that compares the canonical JSDoc source against the manifest mirrors, or (b) treating the manifest as the single source of truth and removing the inline JSDoc detail. Without a guard, drift will recur as the codebase evolves.

---

## Technical Debt Identified

1. **Undocumented early-return test gap for `propagateDependencyReblock`** (WP-002 Developer): The symmetric guard in `propagateDependencyReblock` (verified in WP-001) does not yet have a spy-based early-return unit test analogous to the one added in WP-002 for `propagateDependencyUnblock`. This is a minor gap — the existing `propagateDependencyReblock` tests exercise the full path — but the early-return contract is not explicitly asserted.

2. **`synthesis_generated` write attribution** (WP-004): The factual error corrected in WP-004 (crediting `workflow-handoff.ts` with `synthesis_generated` writes that are actually performed by `completeSynthesis()` in `project-lifecycle.ts`) had been present since the synthesis lifecycle was first documented. This suggests the manifest documentation review process should include a cross-check of caller attribution claims against the actual call sites.

---

## Next Steps

1. **Merge to main:** All 4 WPs are complete with zero blocking issues. The `feature-extended-workflow` branch is in a clean state.
2. **Add early-return test for `propagateDependencyReblock`:** Mirror the WP-002 spy-based test for the symmetric `propagateDependencyReblock` guard to close the remaining unit-level coverage gap.
3. **Evaluate `ACTION_STATUSES` promotion:** Promote the function-scoped `ACTION_STATUSES` set in `propagateDependencyReblock` to module level (Strategic Recommendation 1) — low-effort, low-risk cleanup.
4. **Doc mirror lint guard:** Investigate a lightweight mechanism to prevent JSDoc-to-manifest drift for `writeRootIndex` and similar multi-location documented functions (Strategic Recommendation 2).
