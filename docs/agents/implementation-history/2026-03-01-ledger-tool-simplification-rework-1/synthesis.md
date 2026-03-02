# Project Synthesis Report

**Plan:** Ledger Tool Simplification — Rework 1
**Date:** 2026-03-01
**Status:** COMPLETE
**Work Packages:** 4 / 4 COMPLETE

---

## Executive Summary

This cycle addressed the ten strategic recommendations ("Gold Nuggets") from the previous Ledger Tool Simplification synthesis, grouped into four work packages. The single architectural bug was fixed (missing `propagateDependencyUnblock` call in the `completePipeline` auto-finalize path — a violation of workflow spec §6.3), three micro-debt items were cleaned up, two defensive hardening improvements were delivered (schema mutual-exclusivity enforcement and a persona build system regression guard), and four lower-priority items were triaged — one as a new integration test and three formally deferred with documented trigger conditions.

All work packages passed all four pipeline stages (implementation, QA, code-review, documentation) with no blocking issues. The test suite grew from **962 to 973 tests**, all passing.

---

## Work Package Summary

| WP | Scope | Synthesis Items | Tests Added | Result |
|----|-------|----------------|-------------|--------|
| WP-001 | `propagateDependencyUnblock` in auto-finalize path | #1 | +3 | PASS |
| WP-002 | Micro-debt cleanup bundle (stub deletion, legacy function removal, JSDoc convention) | #3, #4, #5 | 0 | PASS |
| WP-003 | Zod schema mutual-exclusivity refinement + persona build regression guard | #2, #8 | +10 | PASS |
| WP-004 | auto_handoff WAIT embedding test + deferred items documentation | #6, #7, #9, #10 | +1 | PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed | 973 |
| Tests failed | 0 |
| New tests added | 11 (WP-001: 3, WP-003: 10, WP-004: 1) |
| Blocking issues found | 0 |
| Security issues | 0 |
| All acceptance criteria met | 4 / 4 WPs (100%) |

---

## Achievements by Work Package

### WP-001 — `propagateDependencyUnblock` in Auto-Finalize Path (Architectural Bug Fix)

**Problem solved:** The `completePipeline` auto-finalize path transitioned a WP to `COMPLETE` without calling `propagateDependencyUnblock`, silently leaving dependent BLOCKED WPs stranded — a direct violation of workflow spec §6.3.

**Delivered:**
- `propagateDependencyUnblock` promoted to a named export in `work-package.ts` (backward-compatible via retained `_internal` reference).
- Call site added in `pipeline.ts` after the update lock scope, gated by `autoFinalizeResult === 'finalized'`. Lock ordering respects §12.2 Gotcha 8 (propagation call is outside the main lock scope).
- 3 new integration tests in `pipeline.test.ts`: BLOCKED dependent auto-unblocks, no-dependents no error, non-dependency-blocked stays BLOCKED.
- Manifest docs updated: `api-surface.md`, `data-flows.md` Flow 5, `constraints.md` §13b.

**Files modified:** `work-package.ts`, `pipeline.ts`, `pipeline.test.ts`, `api-surface.md`, `data-flows.md`, `constraints.md`.

---

### WP-002 — Micro-Debt Cleanup Bundle

**Delivered:**
- **`workflow-batch-actions.ts` deleted** — 13-line re-export stub with no logic; sole consumer (`workflow-batch-actions.test.ts`) redirected to import directly from `workflow-next-action.js`.
- **`validatePlanPathOrError` removed** from `path-validator.ts` — thin wrapper inlined at its single call site in `project-lifecycle.ts` (`validatePlanPath` called directly at line 390). The function was never listed in `api-surface.md`, confirming its internal-only status.
- **Constraint 56 added** to `constraints.md` documenting the captured-closure JSDoc pattern (using `autoFinalizeResult` as the concrete example).
- Manifest updated: `file-tree.md` (removed `workflow-batch-actions.ts` entries), `api-surface.md` (`AGENT_ROLES` importers list cleaned up).

**Files modified:** `path-validator.ts`, `project-lifecycle.ts`, `workflow-batch-actions.test.ts`, `file-tree.md`, `api-surface.md`, `constraints.md`.

---

### WP-003 — Zod Schema Mutual-Exclusivity + Persona Build Regression Guard

**Delivered:**
- **`mutuallyExclusivePaths` predicate** + `MUTUAL_EXCLUSIVITY_PATH_MSG` constant added to `path-validator.ts`. Logic: `!(args.project_path && args.cwd_path)` — only one real path value may be provided.
- **`.refine()` applied to all 17 tool schemas** that accept both optional `project_path` and `cwd_path` (7 in `work-package.ts`, 4 in `pipeline.ts`, 1 in `workflow-next-action.ts`, 2 in `observations.ts`, 1 in `workflow-handoff.ts`, 1 in `begin-work.ts`, 2 in `project-lifecycle.ts`). `.passthrough()` correctly removed from outer schemas only (incompatible with `ZodEffects`); retained on nested fields.
- **`build-personas.js --check` regression guard** added: verifies that no tool marked `note_only: true` appears as a table row in generated persona output.
- 10 new unit tests for `mutuallyExclusivePaths` (predicate edge cases + Zod refine integration).
- Manifest updated: `constraints.md` §57 (mutual exclusivity rule), `api-surface.md` (new exports), `personas/constraints.md` 32c (`note_only` guard).

**Files modified:** `path-validator.ts`, 7 tool files, `build-personas.js`, `path-validator.test.ts`, `constraints.md` (mcp-server and personas), `api-surface.md`.

---

### WP-004 — auto_handoff WAIT Embedding Test + Deferred Items

**Delivered:**
- **New test** in `workflow-next-action.test.ts`: `'handoff_status.auto_handoff present when agent registry is loaded (synthesis #10)'` — creates a temp agents directory, writes a mock QA `.agent.md`, calls `discoverAgents()`, triggers a Developer WAIT response, asserts `auto_handoff.agent_name` and `handoff_status.next_agent` are present. Cleaned up via nested `finally` blocks.
- `resetRegistry()` added to `afterEach` in the `handoff_status` describe block (constraint 28 compliance — prevents registry state leakage).
- **`deferred.md` created** in the plan folder documenting synthesis items #6 (`getNextActionsCollector` eager loading), #7 (`workflow-next-action.ts` file split), and #9 (`computeHandoffStatus` I/O overhead) with explicit trigger conditions.

**Files modified:** `workflow-next-action.test.ts`, `deferred.md` (new).

---

## Documentation Cleanup (Cross-WP)

The WP-001 Documentation pipeline also resolved the two stale `workflow-batch-actions.ts` references flagged by the Reviewer as out-of-scope for WP-002:
- `api-surface.md` lines 1081–1091 (backward-compat re-export section) — removed.
- `tech-stack.md` line 120 (deleted file entry) — updated to point to `workflow-next-action.ts` as canonical home for batch logic.

Additionally, the stale `_internal` signature for `propagateDependencyUnblock` in `api-surface.md` was corrected to match the new named export signature.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Lock Path Normalization Audit (Low Priority)
**Source:** WP-001 code-review observation.

`propagateDependencyUnblock` acquires its lock using `projectPath`, while the `LedgerStore`-internal lock calls in `updateWorkPackageWithSync` use `storageDir` (a subdirectory). This is a pre-existing pattern in the codebase (e.g., `work-package.ts` line 248 follows the same convention) and carries no deadlock risk as calls are sequential. However, a future audit to normalize all `withLock` call sites to a single canonical directory would improve consistency and eliminate potential confusion.

> **Trigger:** Next refactoring pass touching `withLock` call sites, or before introducing any concurrent pipeline execution.

---

### 2. `mutuallyExclusivePaths` Note_Only Guard Robustness (Low Priority)
**Source:** WP-003 implementation + code-review observation.

The `note_only` regression guard in `build-personas.js` (lines 645–656) uses a `string.includes('| \`toolName\` |')` heuristic to detect violations. This is accurate for the current Markdown table format produced by `renderMcpToolsTable()`, but would produce false negatives if the table format changes. The heuristic is documented in constraint 32c.

> **Trigger:** Any change to `renderMcpToolsTable()` output format, or if the guard starts missing violations.

---

### 3. Deferred Items Backlog (Low Priority)
**Source:** WP-004, documented in `deferred.md`.

Three items from the previous synthesis remain explicitly deferred:

| Item | Description | Trigger Condition |
|------|-------------|-------------------|
| #6 — `getNextActionsCollector` eager loading | Collector reads all WPs on initialization; lazy loading would reduce I/O for small projects | When `get_next_actions` performance becomes a concern on large ledgers |
| #7 — `workflow-next-action.ts` file split | File is 1,525+ lines; batch, handoff, and next-action logic are distinct enough to split | When adding new features to this file, or when onboarding new contributors to this area |
| #9 — `computeHandoffStatus` I/O overhead | Creates a new `LedgerStore` per WAIT response; sharing the store instance would reduce reads | When WAIT-response latency becomes measurable in production usage |

---

### 4. AC Terminology Slip (Documentation Hygiene)
**Source:** WP-004 convention observation (Reviewer + QA).

The WP-004 acceptance criterion said `auto_handoff contains agent_handle` but the actual implementation field is `agent_name` (per `buildHandoffResponse()` in `workflow-handoff.ts`). The test correctly asserts `agent_name`. This slip is non-blocking but suggests that acceptance criteria should be drafted by querying the actual implementation field names before writing the criterion text.

> **Recommendation:** When writing ACs referencing specific JSON/object field names, always verify against the source implementation before committing the AC text.

---

## Failed / Blocked Items

None. All 4 WPs completed with PASS status across all pipeline stages.

---

## Next Steps

1. **No immediate action required** — all architectural, hygiene, and defensive work from the previous synthesis is now resolved.
2. **Review `deferred.md`** in the plan folder for the three deferred optimization items and schedule them when their trigger conditions arise.
3. **Lock path audit** (Strategic Recommendation #1) should be scoped as a standalone micro-task if a refactoring pass over `withLock` call sites is planned.
4. **persona `note_only` guard** (Strategic Recommendation #2) — no action needed unless `renderMcpToolsTable()` output format changes.
