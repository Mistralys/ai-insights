# Plan — Phase 1: Schema & Type Foundations

## Summary

Update all Zod schemas, TypeScript types, and enums in the MCP Ledger Server to match the Agent Workflow Specification v1.3.1 data model (§3). This is the first of six phases in the [Ledger Specification Alignment](../../projects/ledger-specification-alignment.md) project. All later phases depend on these type definitions being correct and specification-compliant. Changes include adding `auto_cancelled` to pipelines, replacing the scalar `rework_count` with a per-pipeline-type `rework_counts` map, adding `status_changed_at` to work package detail, fixing `revision` initial value from 1 to 0, making `assigned_to` nullable, fixing WP ID regex inconsistencies in tool schemas, and adding a backward-compatible migration path in `LedgerStore.readWorkPackage()`.

## Architectural Context

The MCP server follows a layered architecture: `schema/` → `storage/` → `utils/` → `tools/`. Phase 1 touches the first two layers only.

**Schema layer** ([mcp-server/src/schema/](mcp-server/src/schema/)):
- [work-package.ts](mcp-server/src/schema/work-package.ts) — defines `PipelineSchema`, `WorkPackageDetailSchema`, and all supporting types. Currently 116 lines.
- [root-index.ts](mcp-server/src/schema/root-index.ts) — defines `WorkPackageSummarySchema`, `RootIndexSchema`. Currently 46 lines.
- [validators.ts](mcp-server/src/schema/validators.ts) — business rule validators including `isValidStatusTransition`. Currently 129 lines.
- [enums.ts](mcp-server/src/schema/enums.ts) — Zod enum definitions. No changes needed.

**Storage layer** ([mcp-server/src/storage/](mcp-server/src/storage/)):
- [ledger-store.ts](mcp-server/src/storage/ledger-store.ts) — central storage abstraction. `readWorkPackage()` at line 120 parses JSON through `WorkPackageDetailSchema.parse()`. Migration logic will be injected here.

**Tool layer** (touched minimally):
- [pipeline.ts](mcp-server/src/tools/pipeline.ts) — `StartPipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` all use `/^WP-\d{3}$/` (exactly 3 digits) instead of the spec's `/^WP-\d{3,}$/` (3+ digits).
- [work-package.ts](mcp-server/src/tools/work-package.ts) — `createWorkPackage()` sets `revision: 1` (should be 0) and sets `assigned_to` from input (should allow null).

**Test suite:** 27 test files, ~10,003 lines. At least 50+ test fixtures use `revision: 1` across 17 test files. The `assigned_to` field appears in test fixtures across all tool and integration test files.

## Approach / Architecture

This phase makes **additive schema changes** with backward compatibility. The existing layered architecture is preserved. No new files are created in `src/` — all changes modify existing files. One new test file will be created for schema-level tests of the new fields.

The approach follows three tracks:

1. **Schema widening** — Add new optional fields (`auto_cancelled`, `status_changed_at`, `rework_counts`) and relax existing validators (`revision` from `.positive()` to `.nonnegative()`, `assigned_to` from `.string()` to `.string().nullable()`). Both old and new formats pass validation during the transition.
2. **Creation defaults** — Update `createWorkPackage()` to set `revision: 0` and `assigned_to: null` for spec compliance.
3. **Read migration** — Add a post-parse migration step in `LedgerStore.readWorkPackage()` that converts legacy `rework_count` to `rework_counts.implementation` transparently.

The test fixture update strategy uses a **factory helper** (`makeWorkPackageDetail()` / `makePipeline()`) to centralize fixture creation, reducing future churn when later phases add more fields.

## Rationale

- **Schema-first sequencing**: All six phases depend on correct types. Getting the data model right first prevents cascading rework in later phases.
- **Backward compatibility via dual-field schema**: Keeping legacy `rework_count` readable during transition avoids breaking existing ledger files. The migration runs lazily on read; ledger files are updated on next write.
- **Nullable `assigned_to` over optional**: The spec says `assigned_to` is `null` (not absent) when unassigned. Using `.nullable()` rather than `.optional()` preserves the field's presence in serialized JSON, matching the spec's data model.
- **Factory helpers for test fixtures**: With 50+ fixture sites to update, a shared factory reduces maintenance burden and ensures consistency for Phases 2–6.

## Detailed Steps

### Step 1: Add `auto_cancelled` flag to PipelineSchema

**File:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)

Add `auto_cancelled: z.boolean().optional()` to the `PipelineSchema` object. Per §3.4, this field is `false` or absent for normal pipelines and set to `true` only by system automation (cascade reblock §15.5, manual IN_PROGRESS→BLOCKED §6.2).

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

**Target code:**
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
  auto_cancelled: z.boolean().optional(),
});
```

### Step 2: Replace scalar `rework_count` with per-pipeline `rework_counts` map

**File:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)

Define a new `ReworkCountsSchema` and add both `rework_counts` (new) and `rework_count` (legacy compat) to `WorkPackageDetailSchema`.

**New schema to add before `WorkPackageDetailSchema`:**
```typescript
export const ReworkCountsSchema = z.object({
  implementation: z.number().int().nonnegative().optional(),
  qa: z.number().int().nonnegative().optional(),
  'code-review': z.number().int().nonnegative().optional(),
  documentation: z.number().int().nonnegative().optional(),
});
export type ReworkCounts = z.infer<typeof ReworkCountsSchema>;
```

**In `WorkPackageDetailSchema`:**
- Keep `rework_count: z.number().int().nonnegative().optional()` for read compatibility
- Add `rework_counts: ReworkCountsSchema.optional()` as the new canonical field

Per §16.2, the map is absent until first rework, then lazily created with all-zero entries. Each pipeline type's counter increments independently.

### Step 3: Add `status_changed_at` field to WorkPackageDetailSchema

**File:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)

Add `status_changed_at: z.string().optional()` to `WorkPackageDetailSchema`. Per §10b.1, this timestamp is updated on every status transition and is used by the `REVIEW_ABANDONED` PM action (§14.1.2) to measure the grace period.

### Step 4: Fix `revision` initial value and validator

**File:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)

Change the Zod validator from `.positive()` to `.nonnegative()`:

```typescript
// Before:
revision: z.number().int().positive(),
// After:
revision: z.number().int().nonnegative(),
```

**File:** [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) (line ~252)

Change the creation default:
```typescript
// Before:
revision: 1,
// After:
revision: 0,
```

Per §3.3 and §21.4, `revision` starts at `0` and is incremented only on COMPLETE → IN_PROGRESS.

### Step 5: Make `assigned_to` nullable

**File:** [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts)

```typescript
// Before:
assigned_to: z.string(),
// After:
assigned_to: z.string().nullable(),
```

**File:** [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts)

```typescript
// Before (in WorkPackageSummarySchema):
assigned_to: z.string(),
// After:
assigned_to: z.string().nullable(),
```

**File:** [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts)

Update `createWorkPackage()` to set `assigned_to: null` in the `WorkPackageDetail` and `WorkPackageSummary` objects (lines ~249 and ~260). The `CreateWorkPackageSchema` tool input can keep `assigned_to` as a required string parameter — the tool maps this to the internal nullable type.

**Impact analysis:** All code that compares `assigned_to` (e.g., `wp.assigned_to === agentRole`) must handle `null`. Search for all `assigned_to` references in `src/` and update comparisons. Key locations:
- `workflow-next-action.ts` — CLAIM_WP logic checks `assigned_to`
- `workflow-handoff.ts` — handoff routing checks `assigned_to`
- `work-package.ts` — claim guard checks current assignment
- `pipeline.ts` — no `assigned_to` usage (safe)

### Step 6: Fix WP ID regex in tool schemas

**File:** [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts)

Three schemas use `/^WP-\d{3}$/` (exactly 3 digits). Update to `/^WP-\d{3,}$/` (3+ digits) to match §3.6 and the detail/summary schemas.

**Locations:**
- `StartPipelineSchema` (line ~91): `work_package_id` regex
- `CancelPipelineSchema` (line ~390): `work_package_id` regex
- `UpdatePipelineProgressSchema` (line ~455): `work_package_id` regex

### Step 7: Add post-parse migration in `LedgerStore.readWorkPackage()`

**File:** [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) (line ~120)

After `WorkPackageDetailSchema.parse(data)`, add migration logic:

```typescript
async readWorkPackage(wpId: string): Promise<WorkPackageDetail> {
  const path = this.wpDetailPath(wpId);
  const content = await readFile(path, 'utf-8');
  const data = JSON.parse(content);
  const wp = WorkPackageDetailSchema.parse(data);

  // Migration: rework_count (legacy scalar) → rework_counts (per-pipeline map)
  if (wp.rework_count !== undefined && wp.rework_counts === undefined) {
    wp.rework_counts = {
      implementation: wp.rework_count,
      qa: 0,
      'code-review': 0,
      documentation: 0,
    };
    delete wp.rework_count;
  }

  return wp;
}
```

The migrated value is not immediately persisted — it will be written on the next `updateWorkPackageWithSync()` call, which is the standard write path. This avoids unnecessary disk writes during read-only operations.

### Step 8: Create test fixture factory helper

**File:** [mcp-server/tests/helpers/fixtures.ts](mcp-server/tests/helpers/fixtures.ts) (NEW)

Create a centralized fixture factory for `WorkPackageDetail`, `Pipeline`, and `WorkPackageSummary` objects. This factory provides spec-compliant defaults (`revision: 0`, `assigned_to: null`) while allowing overrides:

```typescript
import type { WorkPackageDetail } from '../../src/schema/work-package.js';
import type { Pipeline } from '../../src/schema/work-package.js';
import type { WorkPackageSummary } from '../../src/schema/root-index.js';

export function makeWorkPackageDetail(
  overrides: Partial<WorkPackageDetail> = {}
): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'All tests pass', met: false }],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

export function makePipeline(
  overrides: Partial<Pipeline> = {}
): Pipeline {
  return {
    type: 'implementation',
    status: 'IN_PROGRESS',
    started_at: new Date().toISOString(),
    summary: [],
    ...overrides,
  };
}

export function makeWorkPackageSummary(
  overrides: Partial<WorkPackageSummary> = {}
): WorkPackageSummary {
  return {
    work_package_id: 'WP-001',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    file: 'ledger/WP-001.json',
    ...overrides,
  };
}
```

### Step 9: Update test fixtures across all test files

Update all test files that construct `WorkPackageDetail` or `WorkPackageSummary` objects:

1. **`revision: 1` → `revision: 0`** — 50+ occurrences across 17 test files. Use find-and-replace within the `mcp-server/tests/` directory, then verify no runtime test logic depends on `revision === 1`.

2. **Schema validation tests** — Add new test cases in [mcp-server/tests/schema/validators.test.ts](mcp-server/tests/schema/validators.test.ts) (or a new `schema/work-package.test.ts` file) for:
   - `auto_cancelled` field: present (true/false) and absent should all parse
   - `rework_counts` map: valid object, partial object, absent
   - `rework_count` legacy field: still parses for backward compatibility
   - `status_changed_at`: present and absent
   - `revision: 0` parses successfully (was previously rejected by `.positive()`)
   - `assigned_to: null` parses successfully

3. **Migration test** — Add test in [mcp-server/tests/storage/ledger-store.test.ts](mcp-server/tests/storage/ledger-store.test.ts) for the `rework_count → rework_counts` migration:
   - Legacy file with `rework_count: 3` reads back as `rework_counts: { implementation: 3, qa: 0, ... }`
   - File with both fields: `rework_counts` takes precedence
   - File with neither field: no migration needed

4. **Regex test** — Verify `WP-0001` (4+ digits) is accepted by `StartPipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` after the regex fix.

### Step 10: Verify test suite passes

Run `npm test` from the `mcp-server/` directory to verify all existing tests pass with the schema changes. Fix any breakage caused by:
- `revision: 0` vs `revision: 1` mismatches in assertions
- `assigned_to` null comparisons
- Schema validation that was testing the old `.positive()` constraint

## Dependencies

- **Specification documents:** [mcp-server/docs/agents/workflow-specification/data-model.md](mcp-server/docs/agents/workflow-specification/data-model.md) (§3.1–§3.6)
- **Specification edge cases:** [mcp-server/docs/agents/workflow-specification/edge-cases.md](mcp-server/docs/agents/workflow-specification/edge-cases.md) (§21.4, §21.16, §21.27)
- No external package additions required
- No dependency on other phases (Phase 1 is the foundation)

## Required Components

### Modified Files

| File | Changes |
|------|---------|
| [mcp-server/src/schema/work-package.ts](mcp-server/src/schema/work-package.ts) | Add `auto_cancelled` to `PipelineSchema`; add `ReworkCountsSchema` + `rework_counts` to `WorkPackageDetailSchema`; add `status_changed_at`; fix `revision` validator to `.nonnegative()`; make `assigned_to` nullable |
| [mcp-server/src/schema/root-index.ts](mcp-server/src/schema/root-index.ts) | Make `assigned_to` nullable on `WorkPackageSummarySchema` |
| [mcp-server/src/tools/pipeline.ts](mcp-server/src/tools/pipeline.ts) | Fix WP ID regex from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/` in `StartPipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` |
| [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) | Change `revision: 1` to `revision: 0`; handle nullable `assigned_to` in creation |
| [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) | Add post-parse migration for `rework_count` → `rework_counts` in `readWorkPackage()` |

### New Files

| File | Purpose |
|------|---------|
| [mcp-server/tests/helpers/fixtures.ts](mcp-server/tests/helpers/fixtures.ts) | Centralized test fixture factory for `WorkPackageDetail`, `Pipeline`, `WorkPackageSummary` |

### Test Files to Update

| File | Scope of Change |
|------|----------------|
| [mcp-server/tests/schema/validators.test.ts](mcp-server/tests/schema/validators.test.ts) | Add schema parsing tests for new/changed fields |
| [mcp-server/tests/storage/ledger-store.test.ts](mcp-server/tests/storage/ledger-store.test.ts) | Add migration tests for `rework_count` → `rework_counts` |
| [mcp-server/tests/gui/api.test.ts](mcp-server/tests/gui/api.test.ts) | Update `revision: 1` → `revision: 0` in fixtures |
| [mcp-server/tests/storage/project-meta.test.ts](mcp-server/tests/storage/project-meta.test.ts) | Update `revision: 1` → `revision: 0` in fixtures |
| [mcp-server/tests/tools/pipeline.test.ts](mcp-server/tests/tools/pipeline.test.ts) | Update `revision: 1` → `revision: 0`; add regex acceptance test for 4+ digit WP IDs |
| [mcp-server/tests/tools/work-package.test.ts](mcp-server/tests/tools/work-package.test.ts) | Update `revision: 1` → `revision: 0`; test `revision: 0` on creation |
| [mcp-server/tests/tools/claim-guard.test.ts](mcp-server/tests/tools/claim-guard.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/cancelled-status.test.ts](mcp-server/tests/tools/cancelled-status.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/rework-circuit-breaker.test.ts](mcp-server/tests/tools/rework-circuit-breaker.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/workflow-rework-loop.test.ts](mcp-server/tests/tools/workflow-rework-loop.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/workflow-batch-actions.test.ts](mcp-server/tests/tools/workflow-batch-actions.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/cascade-reblock.test.ts](mcp-server/tests/tools/cascade-reblock.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/integration/full-workflow.test.ts](mcp-server/tests/integration/full-workflow.test.ts) | Update `revision: 1` → `revision: 0`; update `assigned_to` assertions if creation tests check the value |
| [mcp-server/tests/integration/auto-handoff.test.ts](mcp-server/tests/integration/auto-handoff.test.ts) | Update `revision: 1` → `revision: 0` |
| [mcp-server/tests/tools/synthesis-terminal.test.ts](mcp-server/tests/tools/synthesis-terminal.test.ts) | Verify no fixture changes needed (check for `revision: 1`) |

## Assumptions

- Existing ledger files in `mcp-server/storage/ledger/` may contain `rework_count` (scalar). The migration in `readWorkPackage()` handles this transparently.
- No existing ledger files use `revision: 0` — all were created under the current code with `revision: 1`. The schema relaxation from `.positive()` to `.nonnegative()` is purely additive.
- The `assigned_to` field in existing ledger files is always a non-null string. Making it nullable in the schema is a widening change that does not break existing data.
- The test fixture update for `revision: 1` → `revision: 0` is a mechanical replacement. No test logic depends on the specific value `1` vs `0` for correctness (the value is just a fixture default, not a computation target).
- Tool-level input schemas (e.g., `CreateWorkPackageSchema`) can keep `assigned_to` as a required string — the tool handler maps this to the internal nullable type. This avoids breaking the MCP tool API surface for callers.

## Constraints

- **Atomic writes** (constraint §1): All file writes must use `atomicWriteJson()`. The migration does not write — it only transforms on read.
- **Dual-file locking** (constraint §2): The migration runs inside `readWorkPackage()`, which is always called within a `withLock()` scope when writes are involved. No new locking needed.
- **STDIO discipline** (constraint §7): No `console.log` in source code. Migration logging (if any) must use `console.error`.
- **Schema backward compatibility**: Both `rework_count` (legacy) and `rework_counts` (new) must be accepted by the schema during the transition period.
- **No breaking changes to MCP tool API**: Tool input schemas retain their current parameter names and types. Internal type changes are transparent to callers.

## Out of Scope

- **Prerequisite check fix** (`.some()` → `.last()`) — Phase 2
- **Re-validation guard** — Phase 2
- **`updateWorkPackageStatus` rewrite** — Phase 3
- **CANCELLED self-transition fix in `isValidStatusTransition`** — Phase 3 (noted here because it's in `validators.ts`, but the change is a Phase 3 behavioral change, not a schema change)
- **`COMPLETE → CANCELLED` transition addition** — Phase 3
- **Recommendation engine changes** — Phase 4
- **Handoff engine changes** — Phase 5
- **New MCP tools** (`ledger_reset_rework_count`, `ledger_update_acceptance_criteria`) — Phase 6
- **Manifest updates** — Will be performed by the Documentation agent after implementation

## Acceptance Criteria

1. `PipelineSchema` accepts objects with and without `auto_cancelled: boolean`
2. `WorkPackageDetailSchema` accepts objects with `rework_counts` map (new format)
3. `WorkPackageDetailSchema` accepts objects with `rework_count` scalar (legacy format)
4. `WorkPackageDetailSchema` accepts objects with `status_changed_at: string`
5. `WorkPackageDetailSchema` accepts `revision: 0`
6. `WorkPackageDetailSchema` and `WorkPackageSummarySchema` accept `assigned_to: null`
7. `createWorkPackage()` sets `revision: 0` on new work packages
8. `createWorkPackage()` sets `assigned_to` from the tool input (not null) — null assignment is used by other operations (unclaim), not creation
9. `LedgerStore.readWorkPackage()` transparently migrates `rework_count: N` to `rework_counts: { implementation: N, qa: 0, 'code-review': 0, documentation: 0 }`
10. `StartPipelineSchema`, `CancelPipelineSchema`, and `UpdatePipelineProgressSchema` accept WP IDs with 3+ digits (e.g., `WP-0001`, `WP-12345`)
11. All existing tests pass after fixture updates
12. New schema validation tests cover all added/changed fields
13. Migration test verifies legacy → new rework count conversion

## Testing Strategy

### Unit Tests — Schema Validation
- Parse `PipelineSchema` with `auto_cancelled: true`, `auto_cancelled: false`, and without the field
- Parse `WorkPackageDetailSchema` with `rework_counts` map (full, partial keys, empty object)
- Parse `WorkPackageDetailSchema` with legacy `rework_count` scalar
- Parse `WorkPackageDetailSchema` with `status_changed_at` string
- Parse with `revision: 0` (should pass) and `revision: -1` (should fail)
- Parse with `assigned_to: null` (should pass) and `assigned_to: ''` (should pass — empty string is valid per Zod .string())

### Unit Tests — Migration
- Read a fixture file with `rework_count: 3` → verify `rework_counts.implementation === 3`
- Read a fixture file with both fields → verify `rework_counts` takes precedence
- Read a fixture file with neither field → verify no migration (both undefined)

### Regression Tests
- All existing 27 test files must pass after the `revision: 1 → 0` fixture update
- Integration tests in `full-workflow.test.ts` must pass end-to-end

### Regex Tests
- `StartPipelineSchema.parse({ ..., work_package_id: 'WP-0001' })` succeeds
- `CancelPipelineSchema.parse({ ..., work_package_id: 'WP-12345' })` succeeds
- `WP-01` (2 digits) still fails

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Test fixture cascade** — 50+ `revision: 1` occurrences must change to `revision: 0`. Missed sites cause test failures. | Use workspace-wide find-and-replace within `mcp-server/tests/`. Run full test suite to catch any misses. Create factory helper to prevent this problem in future phases. |
| **`assigned_to` null ripple** — Making `assigned_to` nullable may cause runtime `TypeError` in code that does string operations on it (e.g., `.toLowerCase()`). | Search all `assigned_to` references in `src/` before changing the type. Add null guards where needed. Use a helper function `isAssignedTo(wp, agent)` if many comparison sites exist. |
| **Legacy ledger data incompatibility** — Existing ledger files with `revision: 1` will have a higher revision than newly created WPs with `revision: 0`. | This is expected and correct behavior. Existing WPs were created under the old code. The `revision` value is not compared across WPs — it's per-WP metadata. No migration needed for existing revision values. |
| **Migration code path untested in production** — The `rework_count → rework_counts` migration only fires for legacy data that may not exist in test environments. | Write explicit test fixtures with legacy format. The migration is simple (map one integer to one field), limiting risk surface. |
| **Schema widening breaks strict consumers** — External tools that read ledger JSON and use strict schema validation may reject new fields. | All new fields are optional (`.optional()`). JSON consumers using `additionalProperties: false` would need updates, but the MCP server's own schemas use Zod's default (allow extra). Document the schema change in the changelog. |
