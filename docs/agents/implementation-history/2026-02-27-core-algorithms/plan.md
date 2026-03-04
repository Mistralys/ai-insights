# Plan — Phase 2: Core Algorithms

**Project:** [Ledger Specification Alignment](../../projects/ledger-specification-alignment.md) — Phase 2 of 6  
**Date:** 2026-02-27  
**Predecessor:** [Phase 1 — Schema & Type Foundations](../2026-02-27-schema-type-foundations/) (COMPLETE)  
**Scope:** `mcp-server/` sub-project only  
**Specification:** `mcp-server/docs/agents/workflow-specification/` (primary: §8.2–§8.5, §11.1–§11.3, §14.6–§14.7, §14.13, §21.27)

---

## Summary

Implement the stateless utility functions specified in the pipeline-routing and operations sections of the Agent Workflow Specification v1.3.1. These are **pure functions** — no MCP tool registration, no file I/O, no locking — that form the algorithmic foundation for all subsequent phases. Phase 3 (Tool Guards & Status Transitions) and Phase 4 (Recommendation Engine) both depend on the functions introduced here.

Additionally, this phase addresses the **two remaining WP ID regex gaps** flagged as a high-priority gold nugget in the Phase 1 synthesis (`CompletePipelineSchema` in `pipeline.ts:234` and `AddObservationSchema` in `observations.ts:21`), treating them as a prerequisite micro-fix per the Phase 1 synthesis recommendation.

---

## Architectural Context

### Relevant Modules

| Module | Path | Role |
|--------|------|------|
| `pipeline-maps.ts` | [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) | Pipeline routing constants (`PIPELINE_TYPES`, `PIPELINE_PREREQUISITES`, maps). Currently has **no algorithmic functions** — only constants and type definitions. |
| `workflow-helpers.ts` | [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) | Stateless helpers shared by all workflow tool modules. Contains `isStalePipeline`, `isMostRecentPipelineFail`, `hasNewUpstreamPassSince`, `hasDependencyBlocked`, `isBlockedByDependencies`, response builders. **305 lines.** |
| `pipeline.ts` | [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) | `startPipeline`, `completePipeline`, `cancelPipeline`, `updatePipelineProgress`. The `startPipeline` function (line ~100) contains the prerequisite check that must be fixed (currently uses `.some()` instead of `.last()`). **565 lines.** |
| `observations.ts` | [mcp-server/src/tools/observations.ts](mcp-server/src/tools/observations.ts) | `AddObservationSchema` at line 21 has the 3-digit-only WP ID regex. |
| `work-package.ts` (schema) | [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts) | `Pipeline` type with `auto_cancelled` optional field (added in Phase 1). |
| Test helpers | [mcp-server/tests/helpers/fixtures.ts](mcp-server/tests/helpers/fixtures.ts) | `makePipeline()` factory (Phase 1). |

### Existing Helper Functions (Current State)

| Function | Location | Spec Alignment | Phase 2 Action |
|----------|----------|----------------|----------------|
| `isStalePipeline()` | `workflow-helpers.ts:103` | §14.8 — Correct | None |
| `isMostRecentPipelineFail()` | `workflow-helpers.ts:111` | §14.7 — **Missing `auto_cancelled` exclusion** | Update |
| `hasNewUpstreamPassSince()` | `workflow-helpers.ts:188` | §14.6 — **Missing `auto_cancelled` exclusion; uses `>` instead of `>=`** | Update |
| `hasDependencyBlocked()` | `workflow-helpers.ts:130` | Correct (summary-based) | None |
| `isBlockedByDependencies()` | `workflow-helpers.ts:155` | Correct (detail-based) | None |
| `getDownstreamTypes()` | — | §8.4 — **Missing entirely** | New |
| `getUpstreamTypes()` | — | §8.5 — **Missing entirely** | New |
| `hasDownstreamFail()` | — | §11.3 — **Missing entirely** | New |
| `hasDownstreamReengagedSince()` | — | §14.13 — **Missing entirely** | New |
| `checkRevalidationGuard()` | — | §11.1 re-validation guard — **Missing entirely** | New |

### Prerequisite Check in `startPipeline` (Current State)

```typescript
// pipeline.ts line ~145 — WRONG: uses .some() instead of .last()
const hasPassPrerequisite = wp.pipelines.some(
  (p) => p.type === prerequisite && p.status === 'PASS'
);
```

Per §8.2, this must use the **most recent** pipeline of the prerequisite type, not any historical PASS. This fix is included in this phase because the re-validation guard (`checkRevalidationGuard`) depends on the prerequisite check using `.last()` semantics.

### Existing Test Coverage

| Test File | Lines | Relevant to Phase 2 |
|-----------|-------|---------------------|
| [workflow-helpers.test.ts](mcp-server/tests/utils/workflow-helpers.test.ts) | 152 | Tests for `hasNewUpstreamPassSince` only. Must be expanded significantly. |
| No `pipeline-maps.test.ts` | — | New file needed for `getDownstreamTypes`, `getUpstreamTypes` |

---

## Approach / Architecture

All new functions are **pure/stateless** — they take pipeline arrays and type names as arguments and return computed results. No file I/O, no locks, no MCP registration.

**Placement strategy:**

- `getDownstreamTypes()` and `getUpstreamTypes()` → **`pipeline-maps.ts`** (they operate on `PIPELINE_TYPES` ordering, which lives in this module)
- `hasDownstreamFail()`, `hasDownstreamReengagedSince()`, `checkRevalidationGuard()` → **`workflow-helpers.ts`** (they operate on pipeline arrays, consistent with existing helpers in this module)
- `isMostRecentPipelineFail()` and `hasNewUpstreamPassSince()` updates → **in-place** in `workflow-helpers.ts`

**Prerequisite fix** in `startPipeline()` is a targeted 3-line change in `pipeline.ts`.

**WP ID regex fix** is 2 one-line changes in `pipeline.ts:234` and `observations.ts:21`.

This approach avoids creating new modules and keeps the algorithmic layer cleanly separated from the tool layer that Phase 3 will modify.

---

## Rationale

1. **Pure functions first:** Building these as tested pure functions before Phase 3 integrates them into tool handlers ensures the algorithms are correct in isolation. Phase 3 can then focus on wiring, guards, and side effects without debugging algorithmic logic.

2. **Prerequisite fix included:** The `.some()` → `.last()` fix in `startPipeline` is logically part of Phase 2's algorithmic scope (§8.2) and is a prerequisite for the re-validation guard. Deferring it to Phase 3 would create a dependency gap.

3. **WP ID regex micro-fix included:** The Phase 1 synthesis flagged this as HIGH-PRIORITY with consensus across Reviewer, QA, and the synthesis. Two one-line changes with no behavioral risk. Treating them as a Phase 2 prerequisite prevents workflow breaks for projects reaching WP-1000+.

4. **`>=` vs `>`:** The spec (§14.6) explicitly requires `>=` for `hasNewUpstreamPassSince` — coincident timestamps should trigger re-engagement. The current code uses `>`, which is a subtle correctness bug under low-resolution clocks or test scenarios.

---

## Detailed Steps

### Step 1: Fix Remaining WP ID Regexes (Phase 1 Synthesis Gold Nugget #1)

**Files:**
- [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) line 234 — `CompletePipelineSchema`
- [mcp-server/src/tools/observations.ts](mcp-server/src/tools/observations.ts) line 21 — `AddObservationSchema`

**Change:** Replace `/^WP-\d{3}$/` with `/^WP-\d{3,}$/` in both schemas.

**Tests:** Add regex acceptance test cases for `WP-1000`, `WP-12345` in existing pipeline and observation test files.

---

### Step 2: Implement `getDownstreamTypes()` and `getUpstreamTypes()` in `pipeline-maps.ts`

**File:** [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts)

**New exports:**

```typescript
/**
 * Returns all pipeline types that follow the given type in the pipeline ordering.
 * Per §8.4: getDownstreamTypes("implementation") → ["qa", "code-review", "documentation"]
 */
export function getDownstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index === -1 || index === PIPELINE_TYPES.length - 1) return [];
  return [...PIPELINE_TYPES.slice(index + 1)];
}

/**
 * Returns all pipeline types that precede the given type in the pipeline ordering.
 * Per §8.5: getUpstreamTypes("documentation") → ["implementation", "qa", "code-review"]
 */
export function getUpstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index <= 0) return [];
  return [...PIPELINE_TYPES.slice(0, index)];
}
```

**Tests (new file `tests/utils/pipeline-maps.test.ts`):**

| Test | Input | Expected Output |
|------|-------|-----------------|
| `getDownstreamTypes("implementation")` | `"implementation"` | `["qa", "code-review", "documentation"]` |
| `getDownstreamTypes("qa")` | `"qa"` | `["code-review", "documentation"]` |
| `getDownstreamTypes("code-review")` | `"code-review"` | `["documentation"]` |
| `getDownstreamTypes("documentation")` | `"documentation"` | `[]` |
| `getUpstreamTypes("implementation")` | `"implementation"` | `[]` |
| `getUpstreamTypes("qa")` | `"qa"` | `["implementation"]` |
| `getUpstreamTypes("code-review")` | `"code-review"` | `["implementation", "qa"]` |
| `getUpstreamTypes("documentation")` | `"documentation"` | `["implementation", "qa", "code-review"]` |

---

### Step 3: Implement `hasDownstreamFail()` in `workflow-helpers.ts`

**File:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts)

**New export:**

```typescript
import { getDownstreamTypes } from './pipeline-maps.js';

/**
 * Returns true if any pipeline type downstream of the given type has a most-recent
 * FAIL status (excluding auto-cancelled pipelines per §21.27).
 * Per §11.3.
 */
export function hasDownstreamFail(pipelines: Pipeline[], pipelineType: PipelineType): boolean {
  const downstreamTypes = getDownstreamTypes(pipelineType);
  for (const dsType of downstreamTypes) {
    const dsPipelines = pipelines.filter(
      (p) => p.type === dsType && !p.auto_cancelled
    );
    if (dsPipelines.length > 0 && dsPipelines.at(-1)!.status === 'FAIL') {
      return true;
    }
  }
  return false;
}
```

**Tests (added to `tests/utils/workflow-helpers.test.ts`):**

| Scenario | Pipeline History | Expected |
|----------|-----------------|----------|
| No downstream pipelines | `[impl-PASS]` | `false` |
| Downstream QA FAIL | `[impl-PASS, qa-FAIL]` | `true` (from implementation) |
| Downstream QA PASS after FAIL | `[impl-PASS, qa-FAIL, qa-PASS]` | `false` |
| Downstream review FAIL (from impl) | `[impl-PASS, qa-PASS, review-FAIL]` | `true` (from implementation) |
| Downstream review FAIL (from qa) | `[qa-PASS, review-FAIL]` | `true` (from qa) |
| Documentation FAIL (from code-review) | `[review-PASS, doc-FAIL]` | `true` (from code-review) |
| Documentation has no downstream | `[doc-FAIL]` | `false` (from documentation — no downstream types) |
| Auto-cancelled FAIL excluded | `[impl-PASS, qa-FAIL(auto_cancelled)]` | `false` |
| Auto-cancelled FAIL with real FAIL after | `[impl-PASS, qa-FAIL(auto_cancelled), qa-FAIL]` | `true` |

---

### Step 4: Update `isMostRecentPipelineFail()` to Exclude Auto-Cancelled Pipelines

**File:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) line ~111

**Current code:**
```typescript
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const mostRecent = pipelines.filter((p) => p.type === pipelineType).at(-1);
  return mostRecent?.status === 'FAIL';
}
```

**Updated code (per §14.7, §21.27):**
```typescript
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const matching = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (matching.length === 0) return false;
  return matching.at(-1)!.status === 'FAIL';
}
```

**Tests (added to `tests/utils/workflow-helpers.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Empty pipelines | `false` |
| Single FAIL | `true` |
| Single PASS | `false` |
| FAIL then PASS | `false` |
| PASS then FAIL | `true` |
| Only auto-cancelled FAIL | `false` |
| PASS then auto-cancelled FAIL | `false` (auto-cancelled filtered; effective last is PASS) |
| Auto-cancelled FAIL then real FAIL | `true` |

---

### Step 5: Update `hasNewUpstreamPassSince()` to Exclude Auto-Cancelled and Use `>=`

**File:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) line ~188

**Two changes required:**

1. **Exclude auto-cancelled pipelines from the downstream lookup** (per §14.6, §21.27):
   ```typescript
   // Current:
   const downstreamLatest = pipelines
     .filter((p) => p.type === downstreamType)
     .at(-1);
   
   // Updated:
   const downstreamLatest = pipelines
     .filter((p) => p.type === downstreamType && !p.auto_cancelled)
     .at(-1);
   ```

2. **Change `>` to `>=`** in the temporal comparison (per §14.6 `>=` comparison note):
   ```typescript
   // Current:
   return upstreamCompletedAt > downstreamStartedAt;
   
   // Updated:
   return upstreamCompletedAt >= downstreamStartedAt;
   ```

**Tests (added to existing `hasNewUpstreamPassSince` describe block):**

| Scenario | Expected |
|----------|----------|
| Downstream is auto-cancelled FAIL — treated as no downstream (first-run logic) | `true` |
| Coincident timestamps (upstream completed_at === downstream started_at) | `true` (conservative `>=`) |
| Real downstream after auto-cancelled — only real downstream considered | Depends on temporal ordering |

---

### Step 6: Implement `hasDownstreamReengagedSince()` in `workflow-helpers.ts`

**File:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts)

**New export (per §14.13):**

```typescript
/**
 * Returns true when a downstream agent (whose FAIL routes to Developer) has
 * started a pipeline since the most recent upstream PASS. Excludes auto-cancelled
 * pipelines from both upstream and downstream lookups (§21.27).
 *
 * Used by Developer recommendation engine (§14.2 priority 5) to prevent
 * redundant rework cycles (§21.52).
 */
export function hasDownstreamReengagedSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
): boolean {
  // Find most recent upstream PASS (excluding auto-cancelled)
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS' && !p.auto_cancelled)
    .at(-1);

  if (!upstreamPass?.completed_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();

  // Check downstream types whose FAIL routes to Developer
  const developerReworkTypes: PipelineType[] = ['qa', 'code-review'];
  for (const dsType of developerReworkTypes) {
    const dsPipelines = pipelines.filter(
      (p) => p.type === dsType && !p.auto_cancelled
    );
    if (dsPipelines.length > 0) {
      const mostRecent = dsPipelines.at(-1)!;
      if (mostRecent.started_at) {
        const dsStartedAt = parseTimestamp(mostRecent.started_at).getTime();
        if (dsStartedAt >= upstreamCompletedAt) {
          return true; // Downstream re-engaged since the fix
        }
      }
    }
  }

  return false;
}
```

**Tests (new describe block in `tests/utils/workflow-helpers.test.ts`):**

| Scenario | Expected | Spec Trace |
|----------|----------|------------|
| `impl-1 PASS → qa-1 FAIL` (no further activity) | `true` | §14.13 table row 1 |
| `impl-1 PASS → qa-1 FAIL → impl-2 PASS` (no QA re-engagement) | `false` | §14.13 table row 2 |
| `impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 started` | `true` | §14.13 table row 3 |
| `impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL` | `true` | §14.13 table row 4 |
| No upstream PASS exists | `false` | — |
| Upstream PASS has no `completed_at` | `false` | — |
| Only auto-cancelled downstream | `false` | §21.27 exclusion |
| Code-review re-engaged (not just QA) | `true` | §14.13 checks both qa and code-review |

---

### Step 7: Implement `checkRevalidationGuard()` in `workflow-helpers.ts`

**File:** [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts)

**New export (per §11.1 re-validation guard, §11.1.1, §21.22):**

```typescript
import { getDownstreamTypes, getUpstreamTypes } from './pipeline-maps.js';

/**
 * Returns an error message if the re-validation guard fires (prerequisite PASS
 * is stale relative to the current pipeline type's most recent run and upstream
 * rework has occurred), or null if the pipeline may proceed.
 *
 * Guard algorithm (§11.1):
 * 1. If no effective prior run of pipelineType exists → pass (first run)
 * 2. If prerequisite PASS predates the last effective run of pipelineType → check:
 *    a. If hasDownstreamFail(prerequisite) is false → pass (no downstream failure)
 *    b. If no upstream pipeline started after prerequisite PASS → pass (self-rework)
 *    c. Otherwise → BLOCK (prerequisite is stale after upstream rework)
 */
export function checkRevalidationGuard(
  wp: WorkPackageDetail,
  pipelineType: PipelineType,
  prerequisite: PipelineType,
): string | null {
  // ... implementation per §11.1 pseudocode ...
}
```

**Test scenarios (new describe block in `tests/utils/workflow-helpers.test.ts`):**

| Scenario | Guard Result | Spec Reference |
|----------|-------------|----------------|
| **First run** — no prior pipeline of current type | `null` (pass) | §11.1 |
| **Self-rework (documentation):** impl PASS → qa PASS → review PASS → doc FAIL → retry doc | `null` (pass) | §11.1.1 example 1 |
| **Stage-skipping:** impl-1 PASS → qa-1 PASS → review-1 FAIL → impl-2 PASS → try code-review | Error (guard fires) | §11.1.1 example 2 |
| **Normal progression:** impl PASS → qa started (prerequisite PASS post-dates any prior run) | `null` (pass) | §11.1 |
| **Auto-cancelled prior run excluded from baseline** | `null` (pass) | §21.27 |
| **Missing timestamps** — prerequisite `completed_at` is null | `null` (pass, conservative) | — |
| **Missing timestamps** — last same `completed_at` is null | `null` (pass, conservative) | — |

---

### Step 8: Fix `startPipeline` Prerequisite Check (`.some()` → `.last()`)

**File:** [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) line ~145

**Current code:**
```typescript
const hasPassPrerequisite = wp.pipelines.some(
  (p) => p.type === prerequisite && p.status === 'PASS'
);
if (!hasPassPrerequisite) {
```

**Updated code (per §8.2):**
```typescript
const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
const mostRecentPrereq = prereqPipelines.at(-1);
if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
```

**Tests:** Add test cases in `tests/tools/pipeline.test.ts` covering:
- Prerequisite with most-recent PASS → allowed
- Prerequisite with most-recent FAIL (despite earlier PASS) → rejected
- No prerequisite pipelines → rejected

---

## Dependencies

- **Phase 1 complete** — `auto_cancelled` field on Pipeline schema, `rework_counts` map, `ReworkCounts` type, `makePipeline()` fixture factory
- **No external dependencies** — all changes are within existing modules
- Steps 3, 6, 7 depend on Step 2 (`getDownstreamTypes`, `getUpstreamTypes`)
- Steps 4, 5 are independent of Steps 2–3 and can be parallelized

---

## Required Components

| Component | Status | Notes |
|-----------|--------|-------|
| [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) | Existing | Add `getDownstreamTypes()`, `getUpstreamTypes()` |
| [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) | Existing | Add `hasDownstreamFail()`, `hasDownstreamReengagedSince()`, `checkRevalidationGuard()`; update `isMostRecentPipelineFail()`, `hasNewUpstreamPassSince()` |
| [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) | Existing | Fix prerequisite `.some()` → `.last()`; fix WP ID regex on `CompletePipelineSchema` |
| [mcp-server/src/tools/observations.ts](mcp-server/src/tools/observations.ts) | Existing | Fix WP ID regex on `AddObservationSchema` |
| **New:** [mcp-server/tests/utils/pipeline-maps.test.ts](mcp-server/tests/utils/pipeline-maps.test.ts) | New | Tests for `getDownstreamTypes()`, `getUpstreamTypes()` |
| [mcp-server/tests/utils/workflow-helpers.test.ts](mcp-server/tests/utils/workflow-helpers.test.ts) | Existing | Major expansion: new describe blocks for all new/updated functions |
| [mcp-server/tests/tools/pipeline.test.ts](mcp-server/tests/tools/pipeline.test.ts) | Existing | New tests for prerequisite `.last()` fix, WP ID regex |
| [mcp-server/tests/helpers/fixtures.ts](mcp-server/tests/helpers/fixtures.ts) | Existing | Phase 1 `makePipeline()` factory — already supports `auto_cancelled` field |

---

## Assumptions

- The `auto_cancelled` field on `Pipeline` is accessible as `pipeline.auto_cancelled` (added in Phase 1 as an optional boolean on `PipelineSchema`)
- The `makePipeline()` fixture factory from Phase 1 already supports overrides including `auto_cancelled`
- `parseTimestamp()` in `utils/timestamp.ts` correctly handles all timestamp formats used in the codebase
- The `WorkPackageDetail` type includes the `rework_counts` map added in Phase 1 (used by `checkRevalidationGuard` signature but not by the guard logic itself — included for forward compatibility with Phase 3)

---

## Constraints

- **No tool registration changes** — this phase adds only pure utility functions and fixes existing tool schemas
- **No file I/O** — all new functions are stateless
- **Backward compatibility** — updated `isMostRecentPipelineFail()` and `hasNewUpstreamPassSince()` must handle pipelines without the `auto_cancelled` field (treat absent/falsy as `false`)
- **Import discipline** — `workflow-helpers.ts` may import from `pipeline-maps.ts` (sibling util) but not from `tools/` modules (would create a circular dependency)
- **`_internal` test-export convention** — if any new functions need test-only access patterns, use the `_internal` convention per mcp-server AGENTS.md (not `_schemas`)

---

## Out of Scope

- **Wiring new functions into tool handlers** — that is Phase 3 (Tool Guards & Status Transitions)
- **Wiring new functions into the recommendation engine** — that is Phase 4 (Recommendation Engine)
- **`completePipeline` agent role guard** — Phase 3
- **`updateWorkPackageStatus` rewrite** — Phase 3
- **New action types (`CONTINUE_PIPELINE`, `WAIT_FOR_DOWNSTREAM`, etc.)** — Phase 4
- **Handoff engine updates** — Phase 5
- **The `hasDownstreamFail` naming note** — §11.3 notes that `hasDownstreamFail` is sometimes called with the prerequisite type (not the current type). This is intentional per the spec and does not require special handling in the function itself; the caller controls scope.

---

## Acceptance Criteria

### WP ID Regex Fix
1. `CompletePipelineSchema` accepts `WP-1000` and `WP-12345`
2. `AddObservationSchema` accepts `WP-1000` and `WP-12345`
3. Both schemas still reject `WP-1`, `WP-12`, and empty strings

### `getDownstreamTypes` / `getUpstreamTypes`
4. All 8 input→output combinations from the §8.4/§8.5 tables pass
5. Functions are exported from `pipeline-maps.ts`
6. Return type is `PipelineType[]`

### `hasDownstreamFail`
7. Returns `false` for empty pipeline arrays
8. Returns `true` when the most recent non-auto-cancelled pipeline of a downstream type is FAIL
9. Returns `false` when only auto-cancelled FAILs exist downstream
10. Correctly identifies multi-hop downstream FAILs (e.g., review FAIL detected from implementation)

### `isMostRecentPipelineFail` Update
11. Returns `false` when only auto-cancelled FAILs exist for the type
12. Returns `false` when the effective most-recent (after filtering auto-cancelled) is PASS
13. All existing tests still pass (backward compatible)

### `hasNewUpstreamPassSince` Update
14. Uses `>=` comparison (coincident timestamps return `true`)
15. Excludes auto-cancelled pipelines from downstream lookup
16. Returns `true` when the only downstream pipeline is auto-cancelled (treated as first run)
17. All existing tests still pass (backward compatible — existing tests use `>` gaps)

### `hasDownstreamReengagedSince`
18. All 4 scenario rows from the §14.13 table produce correct results
19. Returns `false` when no upstream PASS exists
20. Excludes auto-cancelled pipelines from both upstream and downstream lookups

### `checkRevalidationGuard`
21. Returns `null` on first run (no prior pipeline of current type)
22. Returns `null` for self-rework (documentation retry after doc FAIL, no upstream rework)
23. Returns error string for stage-skipping (code-review after upstream rework without QA re-PASS)
24. Excludes auto-cancelled pipelines from the temporal baseline
25. Handles missing timestamps gracefully (returns `null`)

### Prerequisite Fix in `startPipeline`
26. `startPipeline` rejects when the most recent prerequisite is FAIL (even if an earlier one was PASS)
27. `startPipeline` allows when the most recent prerequisite is PASS
28. All existing `startPipeline` tests still pass

### General
29. Zero TypeScript errors (`npx tsc --noEmit`)
30. Full test suite passes (`npm test`)
31. Manifest documents updated (`api-surface.md`, `file-tree.md`)

---

## Testing Strategy

### Unit Tests (Primary)

All new functions are pure — unit tests are the primary validation strategy.

- **`tests/utils/pipeline-maps.test.ts`** (new) — Exhaustive table-driven tests for `getDownstreamTypes` and `getUpstreamTypes` (8 test cases)
- **`tests/utils/workflow-helpers.test.ts`** (expanded) — New describe blocks for:
  - `hasDownstreamFail` (~9 test cases)
  - `isMostRecentPipelineFail` auto-cancelled exclusion (~8 test cases)
  - `hasNewUpstreamPassSince` auto-cancelled + `>=` (~3+ new test cases added to existing block)
  - `hasDownstreamReengagedSince` (~8 test cases)
  - `checkRevalidationGuard` (~7 test cases including the two §11.1.1 walkthroughs)

### Integration Tests

- **`tests/tools/pipeline.test.ts`** — New tests for the prerequisite `.last()` fix and WP ID regex on `CompletePipelineSchema`
- **Existing integration tests** — Must remain green (regression validation)

### Estimated New Test Count

~45–50 new tests across 2 files. Existing 555 tests must continue to pass.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`>=` change in `hasNewUpstreamPassSince` breaks existing tests** | Existing tests use timestamps with >1 hour gaps — the `>` vs `>=` difference only matters for coincident timestamps. Low risk of regression. |
| **`isMostRecentPipelineFail` auto-cancelled filter changes behavior in existing recommendation engine calls** | Current codebase does not set `auto_cancelled` on any pipeline through normal flow (only Phase 1 schema support). No pipelines in existing test fixtures have `auto_cancelled: true`. Zero behavioral change until Phase 3 wires the flag into tool handlers. |
| **Import cycle between `workflow-helpers.ts` and `pipeline-maps.ts`** | `workflow-helpers.ts` imports from `pipeline-maps.ts` (one-way). `pipeline-maps.ts` has no imports from `workflow-helpers.ts`. No cycle risk. |
| **`checkRevalidationGuard` complexity** | The function translates §11.1 pseudocode directly. Comprehensive test coverage (7 scenarios including both §11.1.1 walkthroughs) provides confidence. |
| **Phase 3 integration mismatch** | All function signatures are designed to match Phase 3's expected calling patterns (pipeline array + type arguments). Phase 3 can import and call directly. |

---

*Generated by Planner Agent — 2026-02-27*
