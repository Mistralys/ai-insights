# Project: Ledger Specification Alignment

> **Purpose:** Bring the MCP Ledger Server codebase into full compliance with the [Agent Workflow Specification v1.3.1](/mcp-server/docs/agents/workflow-specification/README.md). This document provides six self-contained development phases, each producing a working codebase and passing test suite. Each phase is scoped for a single Planner → PM → Developer → QA → Reviewer → Documentation cycle.

**Date:** 2026-02-27  
**Scope:** `mcp-server/` sub-project only  
**Specification:** `mcp-server/docs/agents/workflow-specification/` (9 documents, ~3,170 lines)  
**Current Code:** ~6,368 lines of source across 23 files, ~10,003 lines of tests

---

## Table of Contents

- [Background](#background)
- [Phase 1 — Schema & Type Foundations](#phase-1--schema--type-foundations)
- [Phase 2 — Core Algorithms](#phase-2--core-algorithms)
- [Phase 3 — Tool Guards & Status Transitions](#phase-3--tool-guards--status-transitions)
- [Phase 4 — Recommendation Engine](#phase-4--recommendation-engine)
- [Phase 5 — Handoff Engine](#phase-5--handoff-engine)
- [Phase 6 — Self-Healing & Auxiliary Systems](#phase-6--self-healing--auxiliary-systems)
- [Cross-Phase Risks](#cross-phase-risks)
- [Test Strategy](#test-strategy)

---

## Background

### Why This Work Is Needed

The agentic workflow handled by the Project Ledger MCP server has recurring handoff bugs. Root causes include:
- **Prerequisite check uses `some()` instead of `.last()`** — accepts any historical PASS instead of requiring the most recent pipeline of the prerequisite type to be PASS (§8.2)
- **No re-validation guard** — a stale prerequisite PASS (e.g., QA-1 that validated implementation-1) is accepted after upstream rework (implementation-2 PASS), allowing code-review to skip the new QA run (§11.1.1)
- **No temporal guards on handoffs** — the handoff/recommendation engines lack `hasDownstreamReengagedSince` and don't properly use `hasNewUpstreamPassSince`, causing stalls in auto-handoff chains (§14.6, §14.13)
- **Legacy scalar `rework_count`** — the codebase uses a single counter instead of per-pipeline-type rework counts, causing documentation self-rework to consume the implementation budget (§16.2)
- **No `auto_cancelled` flag** — cascade reblock and manual BLOCKED transitions consume the rework budget because their pipeline closures are indistinguishable from quality failures (§21.27)
- **Incomplete `updateWorkPackageStatus`** — many guards from the specification's consolidated §10b.1 algorithm are missing (pipeline auto-cancellation on →BLOCKED, unclaim logic, blocker replacement rules, synthesis invalidation on reopen, CANCELLED self-transition prohibition)
- **Missing `propagateDependencyReblock` features** — the cascade reblock doesn't auto-cancel IN_PROGRESS pipelines or warn about COMPLETE dependents (§15.5)

### Architecture Assessment

The existing architecture is **sound and fully aligned** with the specification's structural design:
- **Layered modules:** `schema/` → `storage/` → `utils/` → `tools/` matches the spec's separation of data model, persistence, algorithms, and operations
- **Atomic writes** with temp-file-rename pattern matches §20.1
- **File locking** with stale timeout and retry matches §20.2
- **Pipeline routing maps** (`PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`, `FAIL_ROUTING_MAP`, `AGENT_PIPELINE_MAP`) are correctly defined and cross-validated
- **MCP server wiring**, agent registry, GUI configuration — all infrastructure works and should be preserved

**Conclusion: incremental update, not rebuild.** All changes are business-logic additions/corrections within the existing module boundaries.

### How to Use This Plan

Each phase is designed as an independent development cycle. The Planner should create one plan document per phase, then hand off to the PM for work package decomposition. Phases must be executed in order (1 → 2 → 3 → 4 → 5 → 6) because later phases depend on types and algorithms introduced in earlier ones.

**Specification cross-reference convention:** References like "§11.1" point to sections in the workflow specification documents. The spec section number maps to files as follows:
- §1–4 → `data-model.md`
- §5–7 → `state-machines.md`
- §8–9 → `pipeline-routing.md`
- §9b–12 → `operations.md`
- §13–14 → `handoff-and-recommendations.md`
- §15–16 → `dependencies-and-rework.md`
- §17–20 → `auxiliary-systems.md`
- §21 → `edge-cases.md`
- §22, Appendix A/B/C → `walkthrough.md`

---

## Phase 1 — Schema & Type Foundations

**Goal:** Update all Zod schemas, TypeScript types, and enums to match the specification's data model (§3). All later phases depend on these types being correct.

**Spec Sections:** §3.1–§3.6, §21.4, §21.16, §21.27

### 1.1 Add `auto_cancelled` flag to Pipeline schema

**File:** `mcp-server/src/schema/work-package.ts`  
**Current code (line ~82):**
```typescript
export const PipelineSchema = z.object({
  type: z.string(),
  status: PipelineStatus,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  summary: z.array(z.string()),
  artifacts: ArtifactsSchema.optional(),
  metrics: MetricsSchema.optional(),
  comments: z.array(PipelineCommentSchema).optional(),
});
```

**Required change:** Add `auto_cancelled: z.boolean().optional()` to the schema. Per §3.4, this flag is `false` or absent for normal pipelines and set to `true` only by system automation (cascade reblock §15.5, manual IN_PROGRESS→BLOCKED §6.2). It controls exclusion from rework detection, circuit breaker calculations, and all temporal comparison functions (§21.27).

### 1.2 Replace scalar `rework_count` with per-pipeline `rework_counts` map

**File:** `mcp-server/src/schema/work-package.ts`  
**Current code (line ~108):**
```typescript
export const WorkPackageDetailSchema = z.object({
  // ...
  rework_count: z.number().int().nonnegative().optional(),
  // ...
});
```

**Required change:** Replace `rework_count` with:
```typescript
rework_counts: z.object({
  implementation: z.number().int().nonnegative().optional(),
  qa: z.number().int().nonnegative().optional(),
  'code-review': z.number().int().nonnegative().optional(),
  documentation: z.number().int().nonnegative().optional(),
}).optional(),
```

Per §16.2, the map is absent until first rework, then lazily created with all-zero entries. Each pipeline type's counter increments independently.

**Backward compatibility (§16.2):** The migration path for existing ledger files with the legacy scalar `rework_count`: on read, if `rework_count` is present but `rework_counts` is absent, map `rework_count` to `rework_counts.implementation` and delete `rework_count` on next write. This can be handled in `LedgerStore.readWorkPackage()` as a post-parse migration.

The schema must accept both fields during the transition period:
```typescript
rework_count: z.number().int().nonnegative().optional(),   // Legacy — kept for read compat
rework_counts: z.object({ ... }).optional(),                // New per-pipeline map
```

### 1.3 Add `status_changed_at` field to WorkPackageDetail

**File:** `mcp-server/src/schema/work-package.ts`  
**Current code:** The field does not exist.

**Required change:** Add `status_changed_at: z.string().optional()` to `WorkPackageDetailSchema`. Per §10b.1, this timestamp is updated on every status transition and is used by the `REVIEW_ABANDONED` PM action (§14.1.2) to measure the grace period.

### 1.4 Fix `revision` initial value

**File:** `mcp-server/src/schema/work-package.ts`  
**Current code (line ~111):**
```typescript
revision: z.number().int().positive(),
```

**Current create code** in `work-package.ts` tool (line ~262):
```typescript
revision: 1,
```

**Required change:** Per §3.3 and §21.4, `revision` starts at `0` (not 1). Change the Zod schema to `.nonnegative()` and the creation code to `revision: 0`. The `revision` counter is incremented only on COMPLETE → IN_PROGRESS (§6.2).

### 1.5 Allow `assigned_to` to be nullable

**File:** `mcp-server/src/schema/work-package.ts` and `mcp-server/src/schema/root-index.ts`  
**Current code:**
```typescript
// work-package.ts
assigned_to: z.string(),

// root-index.ts (in WorkPackageSummarySchema)
assigned_to: z.string(),
```

**Required change:** Per §3.3 and §9b.1, `assigned_to` should be nullable (`null` when a WP is created with no initial assignment and when an IN_PROGRESS→READY unclaim clears assignment). Change to:
```typescript
assigned_to: z.string().nullable(),
```

**Impact:** This affects WP creation (§9b.1 sets `assigned_to: null` on creation), the unclaim transition (§21.13 clears `assigned_to`), and the BLOCKED→READY auto-unblock path (§15.4 preserves `assigned_to`). All existing code that reads `assigned_to` must handle `null`. The `CreateWorkPackageSchema` tool input currently requires `assigned_to` as a string — this can remain required at the tool level while the internal type allows null, or the tool can accept an optional parameter.

### 1.6 WP ID regex — already correct

**Current code:** The `WorkPackageDetailSchema` and `WorkPackageSummarySchema` use `/^WP-\d{3,}$/` which correctly matches 3+ digits. However, the `StartPipelineSchema` and `CancelPipelineSchema` in `pipeline.ts` use the more restrictive `/^WP-\d{3}$/` (exactly 3 digits).

**File:** `mcp-server/src/tools/pipeline.ts` (lines ~95, ~430)

**Required change:** Update all tool schemas that accept `work_package_id` to use `/^WP-\d{3,}$/` (3+ digits), matching the spec (§3.6) and the detail/summary schemas.

### 1.7 No schema change needed for `synthesis_generated` and `auto_handoff_depth`

Both fields already exist on `RootIndexSchema` as optional fields with correct types. No change needed.

### Expected Test Changes

- Update all test fixtures that create `WorkPackageDetail` objects to use `revision: 0` and nullable `assigned_to`
- Update test fixtures to use `rework_counts` map instead of `rework_count` scalar
- Add test cases for `auto_cancelled` field parsing (present, absent, truthy)
- Ensure schema validation passes for both legacy (with `rework_count`) and new (with `rework_counts`) formats

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/schema/work-package.ts` | Add `auto_cancelled`, `status_changed_at`, `rework_counts`; fix `revision` validator; nullable `assigned_to`; keep legacy `rework_count` for compat |
| `src/schema/root-index.ts` | Nullable `assigned_to` on `WorkPackageSummarySchema` |
| `src/tools/pipeline.ts` | Fix WP ID regex on `StartPipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` |
| `src/tools/work-package.ts` | Fix `revision: 0` in creation logic; handle nullable `assigned_to` |
| `src/storage/ledger-store.ts` | Add post-parse migration for `rework_count` → `rework_counts` in `readWorkPackage()` |
| Test fixtures | Mass update for schema changes |

---

## Phase 2 — Core Algorithms

**Goal:** Implement the stateless utility functions specified in the operations and pipeline-routing sections. These are pure functions called by tool handlers (Phase 3) and the recommendation/handoff engines (Phases 4–5).

**Spec Sections:** §8.2–§8.5, §11.1 (re-validation guard), §11.3, §14.6, §14.7, §14.13

### 2.1 Fix prerequisite check to use `.last()` instead of `some()`

**File:** `mcp-server/src/tools/pipeline.ts`, `startPipeline()` function  
**Current code (line ~145):**
```typescript
const hasPassPrerequisite = wp.pipelines.some(
  (p) => p.type === prerequisite && p.status === 'PASS'
);
```

**Required change:** Per §8.2, the algorithm must check the **most recent** pipeline of the prerequisite type, not any PASS. Replace with:
```typescript
const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
const mostRecentPrereq = prereqPipelines.at(-1);
const hasPassPrerequisite = mostRecentPrereq?.status === 'PASS';
```

This is critical: with the old code, after `impl-1 PASS → qa-1 FAIL → impl-2 PASS`, attempting `startPipeline(type=qa)` would succeed if impl-1 was still PASS — but the **most recent** prerequisite impl-2 must be checked. (In this case impl-2 is also PASS so the result is the same, but the pattern matters for scenarios where the most recent of a prerequisite type is FAIL.)

### 2.2 Implement `getDownstreamTypes()` and `getUpstreamTypes()`

**File:** `mcp-server/src/utils/pipeline-maps.ts`  
**Current code:** These functions do not exist.

**Required change:** Per §8.4 and §8.5:
```typescript
export function getDownstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index === -1 || index === PIPELINE_TYPES.length - 1) return [];
  return [...PIPELINE_TYPES.slice(index + 1)];
}

export function getUpstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index <= 0) return [];
  return [...PIPELINE_TYPES.slice(0, index)];
}
```

These are used by the re-validation guard (§11.1), `hasDownstreamFail` (§11.3), and upstream circuit breaker propagation (§21.53).

### 2.3 Implement `hasDownstreamFail()`

**File:** `mcp-server/src/utils/workflow-helpers.ts`  
**Current code:** Does not exist.

**Required change:** Per §11.3:
```typescript
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

This is used in:
- Rework count detection in `startPipeline` (§11.1 — downstream-triggered rework)
- Re-validation guard in `startPipeline` (§11.1)
- Developer recommendation engine (§14.2 priority 5)

### 2.4 Update `isMostRecentPipelineFail()` to exclude auto-cancelled

**File:** `mcp-server/src/utils/workflow-helpers.ts`  
**Current code (line ~110):**
```typescript
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const mostRecent = pipelines.filter((p) => p.type === pipelineType).at(-1);
  return mostRecent?.status === 'FAIL';
}
```

**Required change:** Per §14.7 and §21.27, auto-cancelled pipelines must be excluded:
```typescript
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const matching = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (matching.length === 0) return false;
  return matching.at(-1)!.status === 'FAIL';
}
```

### 2.5 Update `hasNewUpstreamPassSince()` to exclude auto-cancelled

**File:** `mcp-server/src/utils/workflow-helpers.ts`  
**Current code (line ~192):** The function exists but does not exclude auto-cancelled pipelines from the downstream history.

**Required change:** Per §14.6 and §21.27:
```typescript
// In the downstream lookup:
const downstreamLatest = pipelines
  .filter((p) => p.type === downstreamType && !p.auto_cancelled)
  .at(-1);
```

Also add the `>=` comparison (current code uses `>`) per the spec's conservative approach (§14.6 `>=` comparison note).

### 2.6 Implement `hasDownstreamReengagedSince()`

**File:** `mcp-server/src/utils/workflow-helpers.ts`  
**Current code:** Does not exist.

**Required change:** Per §14.13 (referenced by §14.2 priority 5, §21.52):
```typescript
/**
 * Returns true when a downstream agent has started a pipeline since the most
 * recent PASS of the given upstream pipeline type. Used by the Developer handoff
 * and recommendation engine to prevent churn after delivering a fix.
 */
export function hasDownstreamReengagedSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
): boolean {
  // Find the most recent upstream PASS
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS')
    .at(-1);
  if (!upstreamPass?.completed_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();

  // Check all downstream types for any pipeline started after the upstream PASS
  const downstreamTypes = getDownstreamTypes(upstreamType);
  for (const dsType of downstreamTypes) {
    const dsPipelines = pipelines.filter(
      (p) => p.type === dsType && !p.auto_cancelled
    );
    const hasReengaged = dsPipelines.some((p) => {
      if (!p.started_at) return false;
      return parseTimestamp(p.started_at).getTime() >= upstreamCompletedAt;
    });
    if (hasReengaged) return true;
  }
  return false;
}
```

### 2.7 Implement re-validation guard logic

**File:** `mcp-server/src/utils/workflow-helpers.ts` (or inline in `startPipeline`)  
**Current code:** Does not exist.

**Required change:** Per §11.1 and §11.1.1. This is the most complex algorithm — it prevents stage-skipping after upstream rework. The pseudocode in the spec (§11.1) should be translated directly. It can be implemented as a helper function:

```typescript
/**
 * Returns an error message if the re-validation guard fires (prerequisite is
 * stale after upstream rework), or null if the pipeline can start.
 */
export function checkRevalidationGuard(
  wp: WorkPackageDetail,
  pipelineType: PipelineType,
  prerequisite: PipelineType,
): string | null {
  const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
  const prereqPass = prereqPipelines.at(-1); // Already confirmed PASS by caller
  if (!prereqPass) return null;

  const effectiveSamePipelines = wp.pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (effectiveSamePipelines.length === 0) return null; // First run

  const lastSame = effectiveSamePipelines.at(-1)!;
  if (
    prereqPass.completed_at &&
    lastSame.completed_at &&
    parseTimestamp(prereqPass.completed_at).getTime() <
      parseTimestamp(lastSame.completed_at).getTime()
  ) {
    // Prerequisite PASSed before the current type last ran
    if (hasDownstreamFail(wp.pipelines, prerequisite)) {
      // Upstream activity check
      const upstreamTypes = getUpstreamTypes(pipelineType);
      const hasUpstreamRework = upstreamTypes.some((type) =>
        wp.pipelines.some(
          (p) =>
            p.type === type &&
            p.started_at &&
            parseTimestamp(p.started_at).getTime() >
              parseTimestamp(prereqPass.completed_at!).getTime()
        )
      );
      if (hasUpstreamRework) {
        return `Prerequisite '${prerequisite}' must re-PASS after upstream rework.`;
      }
    }
  }
  return null;
}
```

**Test scenarios from the spec:**
1. **Self-rework (documentation):** `impl-1 PASS → qa-1 PASS → review-1 PASS → doc-1 FAIL` → documentation retry should be allowed (guard does NOT fire)
2. **Stage-skipping (code-review after upstream rework):** `impl-1 PASS → qa-1 PASS → review-1 FAIL → impl-2 PASS` → code-review should be rejected (guard fires — QA must re-PASS)
3. **Normal progression:** No prior run of current type → guard doesn't fire

### Expected Test Changes

- New unit tests for `getDownstreamTypes()`, `getUpstreamTypes()`
- New unit tests for `hasDownstreamFail()` with various pipeline histories
- Update `isMostRecentPipelineFail()` tests to cover auto-cancelled exclusion
- Update `hasNewUpstreamPassSince()` tests to cover auto-cancelled exclusion and `>=` comparison
- New unit tests for `hasDownstreamReengagedSince()`
- New unit tests for `checkRevalidationGuard()` covering all three scenarios from §11.1.1

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/utils/pipeline-maps.ts` | Add `getDownstreamTypes()`, `getUpstreamTypes()` |
| `src/utils/workflow-helpers.ts` | Add `hasDownstreamFail()`, `hasDownstreamReengagedSince()`, `checkRevalidationGuard()`; update `isMostRecentPipelineFail()` and `hasNewUpstreamPassSince()` |
| `tests/utils/workflow-helpers.test.ts` | Major expansion |
| New: `tests/utils/pipeline-maps.test.ts` | New test file for routing helpers |

---

## Phase 3 — Tool Guards & Status Transitions

**Goal:** Update all MCP tool handlers to enforce the specification's guards, side effects, and transition rules. This phase uses the algorithms from Phase 2.

**Spec Sections:** §9b, §10, §10b, §11.1, §12.1, §15.4, §15.5, §19.1

### 3.1 Update `startPipeline` with full spec guards

**File:** `mcp-server/src/tools/pipeline.ts`, `startPipeline()` function

**Current deficiencies vs spec (§11.1):**

| Spec Requirement | Current State |
|-----------------|---------------|
| Prerequisite check uses `.last()` | Uses `.some()` (any PASS) — **CRITICAL** |
| Re-validation guard (§11.1.1) | Missing entirely — **CRITICAL** |
| Agent role is mandatory | Agent role is optional (`agent_role: z.string().optional()`) |
| PM override allowed | Missing |
| Rework detection includes downstream FAIL | Only checks direct FAIL of same type |
| Rework counting uses `rework_counts` map | Uses legacy scalar `rework_count` |
| Auto-cancelled pipelines excluded from rework detection | Not implemented |
| Circuit breaker is per-pipeline-type | Uses single global counter |

**Required changes (in order):**
1. Make `agent_role` required (remove `.optional()`)
2. Fix prerequisite check to use `.last()` (from Phase 2.1)
3. Add re-validation guard after prerequisite check (Phase 2.7)
4. Add PM override: if `agentRole === 'Project Manager'`, allow starting any pipeline type with a log note
5. Replace rework detection with full logic:
   - Filter to `effectiveSamePipelines` (exclude `auto_cancelled`)
   - Direct rework: most recent effective same-type pipeline is FAIL
   - Downstream rework: most recent effective same-type is PASS but `hasDownstreamFail(wp.pipelines, pipelineType)` is true
   - Combined: `needsRework = isDirectRework || isDownstreamRework`
6. Replace `rework_count` increment with `rework_counts[pipelineType]` increment
7. Circuit breaker check uses `rework_counts[pipelineType]` per pipeline type

### 3.2 Update `completePipeline` with agent role guard

**File:** `mcp-server/src/tools/pipeline.ts`, `completePipeline()` function

**Current deficiencies vs spec (§12.1):**

| Spec Requirement | Current State |
|-----------------|---------------|
| `agentRole` is mandatory | Not validated |
| Agent must match `PIPELINE_AGENT_MAP[type]` | Not validated |
| PM override allowed | Missing |
| WP must be IN_PROGRESS | Not validated (defense-in-depth per §12.1) |
| Pipeline status must be PASS or FAIL | Accepted from Zod enum but not explicitly guarded |
| Handoff note `from_agent` uses actual agent on PM override | Always uses pipeline owner |

**Required changes:**
1. Add `agent_role` as required parameter
2. Add WP status check: `wp.status !== 'IN_PROGRESS'` → error
3. Add agent role validation: must match `PIPELINE_AGENT_MAP[args.type]` or be PM
4. On PM override: set `from_agent` in handoff note to the actual agent (PM), not the pipeline owner

### 3.3 Consolidate `updateWorkPackageStatus` per §10b.1

**File:** `mcp-server/src/tools/work-package.ts`, `updateWorkPackageStatus()` function

This is the largest single change. The current function covers some guards but is missing many. Here's the complete delta:

**Missing guards/side effects:**

| Requirement | Spec Reference | Current State |
|-------------|---------------|---------------|
| CANCELLED → anything rejected (including self) | §21.32 | Missing — `isValidStatusTransition` returns `from === to` → true for CANCELLED→CANCELLED |
| Same-state BLOCKED → BLOCKED replaces blocker | §6.2, §21.17 | Missing — treated as no-op |
| Same-state BLOCKED → BLOCKED agent guard (PM or assignee) | §21.47 | Missing |
| BLOCKED → BLOCKED dependency→non-dependency replacement rule | §21.17 | Missing |
| Same-state COMPLETE → COMPLETE agent check only (no full guards) | §6.2 | Missing — full COMPLETE guards fire on every →COMPLETE |
| IN_PROGRESS → BLOCKED auto-cancels IN_PROGRESS pipelines | §10b.1 | Missing — **CRITICAL** for rework budget |
| IN_PROGRESS → CANCELLED auto-cancels IN_PROGRESS pipelines | §21.14b | Missing |
| IN_PROGRESS → READY unclaim: no IN_PROGRESS pipelines guard, clears `assigned_to` | §21.13 | Missing |
| BLOCKED → IN_PROGRESS/READY clears `blocked_by` | §21.12 | Present ✓ |
| COMPLETE → IN_PROGRESS resets `rework_counts` | §21.44 | Missing |
| COMPLETE → IN_PROGRESS resets `synthesis_generated` | §21.26 | Missing |
| COMPLETE → IN_PROGRESS increments `revision` | §21.4 | Present ✓ |
| Set `status_changed_at` on every transition | §10b.1, §14.12 | Missing |
| COMPLETE → IN_PROGRESS triggers `propagateDependencyReblock` | §15.5 | Present ✓ |
| →COMPLETE freshness check (doc PASS post-dates impl start) | §21.10 | Missing — **CRITICAL** |
| BLOCKED → READY is system-only | §6.5 | Missing — no system agent concept |
| COMPLETE → CANCELLED: no counter change, no cascade | §21.14 | Missing (counter logic is wrong) |

**Approach:** Rewrite the function body following the §10b.1 algorithm pseudocode directly. The current function's structure (validate → guard → side-effect → counter → persist → post-hooks) is correct — the body just needs comprehensive expansion.

**Special attention: `READY → IN_PROGRESS` redirect.** Per §10b.2, the `updateWorkPackageStatus` function should redirect READY→IN_PROGRESS requests to `claimWorkPackage` or reject with an error directing the caller to use the claiming operation.

### 3.4 Update `claimWorkPackage` with agent guard

**File:** `mcp-server/src/tools/work-package.ts`, `claimWorkPackage()` function

**Current deficiencies vs spec (§10.1, §21.49):**

| Spec Requirement | Current State |
|-----------------|---------------|
| Only pipeline-owning agents + PM can claim | No agent role restriction |
| Set `status_changed_at` on claim | Not set |

**Required changes:**
1. Add claimable role check:
```typescript
const CLAIMABLE_ROLES = ['Developer', 'QA', 'Reviewer', 'Documentation', 'Project Manager'];
if (!CLAIMABLE_ROLES.includes(args.agent)) {
  throw new Error(`Agent role '${args.agent}' cannot claim work packages.`);
}
```
2. Set `wp.status_changed_at = now()` on successful claim

### 3.5 Update `createWorkPackage` per §9b.1

**File:** `mcp-server/src/tools/work-package.ts`, `createWorkPackage()` function

**Current deficiencies:**

| Spec Requirement | Current State |
|-----------------|---------------|
| Set `revision: 0` (not 1) | Sets `revision: 1` |
| Set `assigned_to: null` initially | Sets from input param |
| Add `blocked_by` when created BLOCKED | Not set |
| Cycle detection on dependencies | Missing |
| Reset `synthesis_generated` on COMPLETE project | Missing (§21.51) |
| Empty/whitespace criteria text rejected | Not validated |

**Cycle detection (§15.2):** Implement the BFS/DFS `hasCycle` function. Note the spec's structural note that this is defense-in-depth only (sequential IDs + existing-ID-only invariants make cycles impossible normally).

### 3.6 Update `propagateDependencyReblock` per §15.5

**File:** `mcp-server/src/tools/work-package.ts`, `propagateDependencyReblock()` function

**Current deficiencies:**

| Spec Requirement | Current State |
|-----------------|---------------|
| Auto-cancel IN_PROGRESS pipelines with `auto_cancelled = true` | Missing — **CRITICAL** |
| Emit warning comments for COMPLETE dependents | Missing |
| Reset `synthesis_generated` as crash-recovery safety net | Missing |
| Recompute `pending_work_packages` | Present ✓ |

### 3.7 Update `propagateDependencyUnblock` per §15.4

**File:** `mcp-server/src/tools/work-package.ts`, `propagateDependencyUnblock()` function

**Current state:** Mostly correct. Minor gap: should also handle absent `blocked_by.type` (legacy data where `blocked_by` is null — spec says treat as dependency type).

### 3.8 Update `isValidStatusTransition` for CANCELLED self-transition

**File:** `mcp-server/src/schema/validators.ts`

**Current code (line ~38):**
```typescript
if (from === to) {
  return true;
}
```

**Required change:** Per §21.32, CANCELLED self-transitions are not valid:
```typescript
if (from === to) {
  return from !== 'CANCELLED';  // CANCELLED → CANCELLED is prohibited
}
```

Also add `COMPLETE → CANCELLED` transition:
```typescript
case 'COMPLETE':
  return to === 'IN_PROGRESS' || to === 'CANCELLED';
```

### Expected Test Changes

- Extensive new tests for `startPipeline` covering re-validation scenarios, PM override, per-pipeline circuit breaker
- New tests for `completePipeline` agent role guard and PM override
- Major expansion of `updateWorkPackageStatus` tests for all new transitions and side effects
- New tests for pipeline auto-cancellation on →BLOCKED and →CANCELLED
- New tests for CANCELLED self-transition rejection
- New tests for COMPLETE→CANCELLED transition
- New tests for dependency cycle detection
- Update cascade reblock tests for `auto_cancelled` flag and warning comments

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/tools/pipeline.ts` | Full `startPipeline` guard rewrite; `completePipeline` agent guard and WP status check |
| `src/tools/work-package.ts` | Major `updateWorkPackageStatus` rewrite; `claimWorkPackage` agent guard; `createWorkPackage` per §9b.1; `propagateDependencyReblock` auto-cancel + warnings; `propagateDependencyUnblock` null blocker handling |
| `src/schema/validators.ts` | CANCELLED self-transition fix; COMPLETE→CANCELLED addition |
| Tests | Major expansion across `tests/tools/pipeline.test.ts`, `tests/tools/work-package.test.ts` |

---

## Phase 4 — Recommendation Engine

**Goal:** Update `getNextAction` for all agent roles to match the specification's priority-ordered action logic, including new action types and temporal guards.

**Spec Sections:** §14.1–§14.13, §21.52, §21.53, Appendix B

### 4.1 New action types to implement

The current codebase supports these action types:
- `CREATE_WORK_PACKAGES`, `WAIT`, `IMPLEMENT`, `REWORK`, `CLAIM_WP`, `RESUME_OR_CANCEL`, `BLOCK_FOR_REWORK_LIMIT`, `RUN_QA`, `RUN_REVIEW`, `WRITE_DOCS`, `GENERATE_SYNTHESIS`, `UNBLOCK_WP`, `REVIEW_STALE`

**Missing per Appendix B:**
- `CONTINUE_PIPELINE` — Agent has active non-stale IN_PROGRESS pipeline; finish current work first (§21.33)
- `WAIT_FOR_REWORK` — QA/Reviewer: most recent pipeline FAIL and no upstream re-pass detected (§14.3 priority 5, §14.4 priority 5)
- `WAIT_FOR_DOWNSTREAM` — Developer: fix delivered but downstream hasn't re-engaged yet (§14.2 priority 5b, §21.52)
- `FINALIZE_WP` — Documentation: doc PASS, all criteria met, freshness passed; mark COMPLETE (§14.5 priority 5, §21.34)
- `UPDATE_CRITERIA` — Documentation: doc PASS + freshness OK, but criteria not fully met (§14.5 priority 5b)
- `REVIEW_ABANDONED` — PM: WP claimed but no pipeline activity within staleness threshold (§14.1.2 priority 3b, §21.40)
- `REPAIR_ORPHAN_BLOCKED` — PM: WP BLOCKED with dependency blocker but all deps terminal (§14.1.2 priority 3c, §21.20)
- `WAIT_FOR_UPSTREAM_REWORK_LIMIT` — QA/Reviewer/Docs: upstream circuit breaker engaged (§21.53)
- `REPAIR_TIMESTAMPS` — PM: null timestamp on pipeline (§21.18) — SHOULD-level, lower priority
- `BLOCK_FOR_REWORK_LIMIT` — Already exists but must use per-pipeline `rework_counts` (Phase 1 schema)

### 4.2 Update Developer action logic (§14.2)

**File:** `mcp-server/src/tools/workflow-next-action.ts`

**Current implementation:** Partially implements priorities 1, 2, 4, 6, 7 but missing:
- Priority 3: `CONTINUE_PIPELINE` — active non-stale implementation pipeline
- Priority 5: Downstream-triggered rework with `hasDownstreamReengagedSince` temporal guard
- Priority 5b: `WAIT_FOR_DOWNSTREAM` — fix delivered, downstream hasn't re-engaged
- `rework_counts[implementation]` check (uses legacy scalar)
- Dependency-blocked WP exclusion in FAIL checks

**Key behavioral change:** Currently, when QA fails and Developer has already re-PASSed implementation, the Developer is told to rework again (priority 5 fires without temporal guard). After this fix, the Developer will correctly get `WAIT_FOR_DOWNSTREAM`.

### 4.3 Update QA action logic (§14.3)

**File:** `mcp-server/src/tools/workflow-next-action.ts`

**Required priority order:**
1. `BLOCK_FOR_REWORK_LIMIT` — `rework_counts.qa >= MAX_REWORK_COUNT`
1b. `WAIT_FOR_UPSTREAM_REWORK_LIMIT` — `rework_counts.implementation >= MAX_REWORK_COUNT`
2. `RESUME_OR_CANCEL` — stale QA pipeline
3. `CONTINUE_PIPELINE` — active non-stale QA pipeline
4. `RUN_QA` (re-engagement) — prior QA exists AND `hasNewUpstreamPassSince("implementation", "qa")`
5. `WAIT_FOR_REWORK` — most recent QA FAIL AND NOT re-engagement
6. `RUN_QA` (first run) — PASS implementation, no QA yet
7. `CLAIM_WP` — READY WP assigned to QA

**Critical ordering note**: Priority 4 MUST come before priority 5 (§14.3 rationale). The "at least one prior QA pipeline" guard on priority 4 ensures first-run scenarios fall through to priority 6.

### 4.4 Update Reviewer action logic (§14.4)

Mirrors QA (§14.3) but for `code-review` pipelines, checking `hasNewUpstreamPassSince("qa", "code-review")`. Same priority structure with upstream rework limit checking both `implementation` and `qa` rework counts.

### 4.5 Update Documentation action logic (§14.5)

**File:** `mcp-server/src/tools/workflow-next-action.ts`

**Required priority order:**
1. `BLOCK_FOR_REWORK_LIMIT` — `rework_counts.documentation >= MAX_REWORK_COUNT`
1b. `WAIT_FOR_UPSTREAM_REWORK_LIMIT` — any of `implementation`, `qa`, `code-review` has `rework_counts[type] >= MAX_REWORK_COUNT`
2. `RESUME_OR_CANCEL` — stale documentation pipeline
3. `CONTINUE_PIPELINE` — active non-stale documentation pipeline
4. `REWORK` — most recent documentation FAIL (self-rework)
5. `FINALIZE_WP` — doc PASS, all criteria met, freshness check passed → mark WP COMPLETE
5b. `UPDATE_CRITERIA` — doc PASS, freshness OK, but not all criteria met
6. `WRITE_DOCS` — PASS code-review, no docs yet OR `hasNewUpstreamPassSince("code-review", "documentation")`
7. `CLAIM_WP` — READY WP assigned to Documentation

### 4.6 Update PM action logic (§14.1.2)

**File:** `mcp-server/src/tools/workflow-next-action.ts`

**Missing priorities:**
- Priority 3b: `REVIEW_ABANDONED` — WP IN_PROGRESS with no pipeline activity + grace period check using `status_changed_at`
- Priority 3c: `REPAIR_ORPHAN_BLOCKED` — WP BLOCKED with dependency/null blocker type, all dependencies terminal

**Current state for priority 1 (UNBLOCK_WP) and priority 3 (REVIEW_STALE):** Likely exist in some form but should be verified against the spec's exact conditions.

### 4.7 Helper: `mostRecentEffectivePipeline()`

**File:** `mcp-server/src/utils/workflow-helpers.ts`

Per §14.11 (referenced by §14.1.2 priority 3b):
```typescript
export function mostRecentEffectivePipeline(wp: WorkPackageDetail): Pipeline | null {
  const effective = wp.pipelines.filter((p) => !p.auto_cancelled);
  return effective.at(-1) ?? null;
}
```

### Expected Test Changes

- Comprehensive new tests for each action type in each role
- Temporal guard test scenarios (downstream re-engagement, upstream re-pass)
- Upstream circuit breaker propagation tests
- REVIEW_ABANDONED grace period tests
- REPAIR_ORPHAN_BLOCKED detection tests
- FINALIZE_WP and UPDATE_CRITERIA condition tests

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/tools/workflow-next-action.ts` | Major rewrite of all role-specific action logic |
| `src/utils/workflow-helpers.ts` | Add `mostRecentEffectivePipeline()`; potentially refactor shared action builders |
| Tests | Major expansion of `tests/tools/workflow-next-action.test.ts` |

---

## Phase 5 — Handoff Engine

**Goal:** Update all per-agent handoff functions to match §13.1, including temporal guards and re-engagement checks.

**Spec Sections:** §13.1–§13.4, §18.1–§18.6

### 5.1 Developer handoff (§13.1)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

**Required changes:**
- Add temporal guard on FAIL condition: only signal rework when `hasDownstreamReengagedSince(wp.pipelines, "implementation")` is true
- Add "needs QA" condition using `hasNewUpstreamPassSince`
- All-terminal check → READY_FOR_SYNTHESIS
- Active-work fallback → IN_PROGRESS

### 5.2 QA handoff (§13.1)

**Required changes:**
- Add re-engagement check BEFORE FAIL short-circuit: if most recent QA FAIL AND `hasNewUpstreamPassSince("implementation", "qa")` → IN_PROGRESS (QA re-engages)
- Only after re-engagement: stale FAIL → READY_FOR_DEVELOPER

### 5.3 Reviewer handoff (§13.1)

Same pattern as QA but checking `hasNewUpstreamPassSince("qa", "code-review")`.

### 5.4 Documentation handoff (§13.1)

- Ready-for-docs: PASS code-review, no doc pipeline yet OR `hasNewUpstreamPassSince("code-review", "documentation")`
- Self-rework: FAIL documentation (most recent)
- Needs upstream work
- All terminal → READY_FOR_SYNTHESIS

### 5.5 PM handoff (§13.1)

- Non-dependency blockers → IN_PROGRESS
- READY WPs: route to assigned agent or Developer (unassigned)
- All terminal → READY_FOR_SYNTHESIS

### 5.6 Auto-handoff depth: dynamic effective maximum

**File:** `mcp-server/src/utils/workflow-helpers.ts` and `mcp-server/src/tools/workflow-handoff.ts`

**Current code:** Uses `getMaxHandoffDepth()` which reads from config, defaulting to 10.

**Required change per §18.2.1:** The effective maximum should scale with project size:
```typescript
function effectiveMaxDepth(root: RootIndex): number {
  const staticFloor = getMaxHandoffDepth(); // Default 50, configurable
  return Math.max(staticFloor, root.total_work_packages * 20);
}
```

Also update `buildHandoffResponse` to use this dynamic calculation and emit a warning project comment when depth limit is reached (§18.5).

### 5.7 Auto-handoff depth: remove WP-COMPLETE reset

**Current code:** In `updateWorkPackageStatus`, the depth counter is reset when any WP reaches COMPLETE.

**Required change per §18.4:** The depth counter should only be reset in `completeSynthesis`, not on individual WP completions. Remove the reset from `updateWorkPackageStatus`.

### 5.8 Dependency-blocked WP exclusion in handoffs

**Current state:** The helpers `isBlockedByDependencies()` and `hasDependencyBlocked()` exist. Verify they are used consistently across all handoff functions to exclude dependency-blocked WPs from "work remaining" counts (§13.3).

**Note on canonical definition (§21.54):** The handoff functions should check `wp.status === 'BLOCKED' && wp.blocked_by?.type === 'dependency'` (or absent `blocked_by`), NOT the `dependencies` array. The current helpers check the `dependencies` array against terminal status — this needs to change to match the spec's metadata-based definition.

### Expected Test Changes

- New tests for each handoff function with temporal guard scenarios
- Tests for re-engagement before FAIL short-circuit ordering
- Dynamic depth limit tests
- Depth reset timing tests (only on synthesis, not WP completion)

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/tools/workflow-handoff.ts` | Rewrite all per-agent handoff functions; update `buildHandoffResponse` depth logic |
| `src/utils/workflow-helpers.ts` | Update `effectiveMaxDepth` helper; potentially update dependency-blocked helpers |
| Tests | Update/expand `tests/tools/workflow-handoff.test.ts` |

---

## Phase 6 — Self-Healing & Auxiliary Systems

**Goal:** Complete the self-healing rules, implement the synthesis completion guard, add the rework count reset PM tool, and handle remaining edge cases.

**Spec Sections:** §17.1–§17.4, §19.1–§19.3, §16.3b, §12.3b

### 6.1 Complete self-healing rules (§17.2)

**File:** `mcp-server/src/tools/project-lifecycle.ts` (or wherever `getProjectStatus` / `healProject` is implemented)

**Current state:** Some healing rules exist but the following are missing:

| Rule | Condition | Healed Status | Current State |
|------|-----------|---------------|---------------|
| 1 | (IN_PROGRESS or READY) AND pending==0 AND total>0 AND synthesis_generated | COMPLETE | Likely partial |
| 1b | READY AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | Missing |
| 1c | IN_PROGRESS AND pending==0 AND total>0 AND NOT synthesis_generated | Preserve IN_PROGRESS | Missing |
| 2 | COMPLETE AND pending>0 | IN_PROGRESS | Likely present |
| 2b | COMPLETE AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | Missing |
| 3 | READY AND any WP IN_PROGRESS | IN_PROGRESS | Likely present |
| 3b | READY AND pending>0 AND no WP READY or IN_PROGRESS | BLOCKED | Missing |
| 3c | IN_PROGRESS AND pending>0 AND no WP READY or IN_PROGRESS | BLOCKED | Missing |
| 4 | BLOCKED AND any WP IN_PROGRESS | IN_PROGRESS | Missing |
| 4b | BLOCKED AND any WP READY (none IN_PROGRESS) | READY | Missing |
| 5a | BLOCKED AND pending==0 AND total>0 AND synthesis_generated | COMPLETE | Missing |
| 5b | BLOCKED AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | Missing |
| 6 | Empty project | Never auto-healed to COMPLETE | Likely present |
| 6b | (IN_PROGRESS or BLOCKED) AND total==0 | READY | Missing |
| 6c | COMPLETE AND total==0 | READY | Missing |

**Implementation:** The healing rules must be applied in the documented order (first-match-wins). The double-check write optimization (§17.3) — compute → lock → re-read → re-compute → write — should be implemented.

### 6.2 Update `completeSynthesis` per §19.1

**File:** `mcp-server/src/tools/project-lifecycle.ts` (or wherever synthesis completion is handled)

**Current state needs verification.** Per §19.1, the following must be enforced:
1. Agent guard: only Synthesis agent or PM override
2. Heal counters before checking (guard against stale pending count)
3. All WPs must be terminal
4. At least one WP must exist
5. Set `synthesis_generated = true` and `status = 'COMPLETE'`
6. Reset `auto_handoff_depth` to 0 atomically (§18.4)

### 6.3 Implement rework count reset PM tool (§16.3b)

**File:** New function in `mcp-server/src/tools/work-package.ts` (or a new PM-tools file)

**New MCP tool:** `ledger_reset_rework_count`

Per §16.3b:
- PM only
- Requires a reason (audit trail)
- Resets `rework_counts[pipelineType]` to 0
- Records a project comment of type `"rework_reset"` with priority `"high"`
- No-op if counter is already 0 or absent

### 6.4 Implement acceptance criteria management PM tool (§12.3b)

**File:** New function in `mcp-server/src/tools/work-package.ts`

**New MCP tool:** `ledger_update_acceptance_criteria`

Per §12.3b:
- PM only
- Operations: `remove` (by criterion text) and `modify_text` (old_criterion → new_criterion)
- Guard: WP must not be CANCELLED
- Guard: at least one criterion must remain (§21.3)

### 6.5 Optional: Pipeline ordering validation in self-healing (§17.4)

SHOULD-level recommendation: during self-healing, verify that `started_at` timestamps across all pipelines are monotonically non-decreasing. Emit a warning project comment if violated.

### Expected Test Changes

- Comprehensive tests for all 16 self-healing rules
- Tests for `completeSynthesis` guards and atomic depth reset
- Tests for rework count reset tool
- Tests for acceptance criteria management tool

### Files Modified in This Phase

| File | Changes |
|------|---------|
| `src/tools/project-lifecycle.ts` | Complete self-healing rules; update `completeSynthesis` |
| `src/tools/work-package.ts` | New `resetReworkCount` and `updateAcceptanceCriteria` functions |
| `src/tools/workflow.ts` | Register new tools |
| Tests | New test files for self-healing rules and new PM tools |

---

## Cross-Phase Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Backward incompatibility with existing ledger files** | Existing projects may fail to parse after schema changes | Phase 1 includes migration logic in `readWorkPackage()` for `rework_count` → `rework_counts`. Test with existing fixtures. `revision: 0` vs `1` needs migration on read (treat 1 as 0 for existing files, or accept both). |
| **Test fixture cascade** | Schema changes in Phase 1 break many test fixtures | Allocate time for fixture updates — largest up-front cost. Use a helper factory for test WP/pipeline creation. |
| **`assigned_to` nullability ripple** | Making `assigned_to` nullable touches many comparison sites | Use a helper function `isAssignedTo(wp, agent)` to encapsulate null-safe comparison. Search for all `wp.assigned_to` and `summary.assigned_to` references. |
| **Re-validation guard complexity** | The most complex single algorithm — easy to get wrong | Cover all three test scenarios from §11.1.1 explicitly. The spec provides step-by-step traces for each. |
| **Auto-handoff depth change** | Removing the WP-COMPLETE reset changes auto-handoff behavior | Current default of 10 is too low; raising to 50 (spec default) with dynamic scaling compensates. |

---

## Test Strategy

### Guiding Principles

1. **Spec scenarios as test cases.** The specification includes step-by-step traces for many algorithms (§11.1.1 has three explicit scenarios; §21.52 has two). Each trace becomes a test case.
2. **Pipeline history fixtures.** Most algorithms operate on `wp.pipelines` arrays. Create a shared fixture factory:
   ```typescript
   function makePipeline(type, status, opts): Pipeline { ... }
   function makeHistory(...entries): Pipeline[] { ... }
   ```
3. **Integration tests for cascades.** The lock-gap behavior (§20.4) between `updateWorkPackageStatus` and `propagateDependencyUnblock`/`propagateDependencyReblock` needs integration tests that verify end-to-end multi-file state.
4. **Regression tests for current behavior.** Before modifying any function, ensure existing test coverage passes. Add regression tests for known-good behaviors that should be preserved.

### Test File Mapping

| Phase | Primary Test Files |
|-------|--------------------|
| 1 | `tests/schema/*.test.ts` (parse validation), fixture updates across all test files |
| 2 | `tests/utils/pipeline-maps.test.ts` (new), `tests/utils/workflow-helpers.test.ts` (expand) |
| 3 | `tests/tools/pipeline.test.ts` (expand), `tests/tools/work-package.test.ts` (major expand) |
| 4 | `tests/tools/workflow-next-action.test.ts` (expand or rewrite) |
| 5 | `tests/tools/workflow-handoff.test.ts` (expand) |
| 6 | `tests/tools/project-lifecycle.test.ts` (expand), new test files for PM tools |

### Existing Test Suite Size

Current test suite: ~10,003 lines across test files. Expected growth: ~3,000–5,000 additional lines across all six phases. The heaviest test additions are in Phases 3 (tool guards) and 4 (recommendation engine).

---

## Appendix: File Inventory

All source files in the MCP server, with their role in this plan:

| File | Lines | Phases Affected | Role |
|------|-------|----------------|------|
| `src/schema/enums.ts` | 33 | — | No changes needed |
| `src/schema/root-index.ts` | 46 | 1 | Nullable `assigned_to` |
| `src/schema/work-package.ts` | 116 | 1 | Major schema additions |
| `src/schema/validators.ts` | 129 | 3 | CANCELLED self-transition fix, COMPLETE→CANCELLED |
| `src/schema/project-meta.ts` | 12 | — | No changes needed |
| `src/storage/atomic-writer.ts` | 51 | — | No changes needed |
| `src/storage/file-lock.ts` | 76 | — | No changes needed |
| `src/storage/ledger-store.ts` | 385 | 1 | Migration logic for `rework_count` → `rework_counts` |
| `src/utils/constants.ts` | 18 | — | No changes needed |
| `src/utils/pipeline-maps.ts` | 94 | 2 | Add `getDownstreamTypes()`, `getUpstreamTypes()` |
| `src/utils/workflow-helpers.ts` | 305 | 2, 4, 5 | New algorithms, updated existing functions |
| `src/utils/agent-registry.ts` | 192 | — | No changes needed |
| `src/utils/ledger-root.ts` | 68 | — | No changes needed |
| `src/utils/path-validator.ts` | 71 | — | No changes needed |
| `src/utils/timestamp.ts` | 27 | — | No changes needed |
| `src/utils/wp-id.ts` | 27 | — | No changes needed |
| `src/utils/if-defined.ts` | 22 | — | No changes needed |
| `src/tools/pipeline.ts` | 548 | 3 | Guard rewrite for start/complete |
| `src/tools/work-package.ts` | 826 | 1, 3, 6 | Major: status transition rewrite, new PM tools |
| `src/tools/workflow-next-action.ts` | 797 | 4 | Major: recommendation engine rewrite |
| `src/tools/workflow-handoff.ts` | 812 | 5 | Major: handoff function rewrites |
| `src/tools/workflow-batch-actions.ts` | — | 4 | May need updates to match batch action spec |
| `src/tools/project-lifecycle.ts` | — | 6 | Self-healing rules, synthesis completion |
| `src/tools/workflow.ts` | 32 | 6 | Register new tools |
| `src/tools/help.ts` | — | — | No changes needed |
| `src/tools/help-content.ts` | — | — | No changes needed |
| `src/tools/observations.ts` | — | — | No changes needed |
| `src/index.ts` | — | — | No changes needed |
