# Plan (Rework 1) — Dynamic Pipeline Engine Post-Synthesis Cleanup

## Summary

This rework plan addresses all actionable items identified in the [synthesis report](../2026-03-14-dynamic-pipeline-engine/synthesis.md) for the Dynamic Pipeline Engine plan (`2026-03-14-dynamic-pipeline-engine`). Each item has been cross-referenced against the [Workflow Specification v2.4.0](../../../../mcp-server/docs/agents/workflow-specification/README.md) to confirm canon compliance. Three items are spec violations that must be fixed; four are code-quality improvements; and three synthesis recommendations are excluded with documented rationale.

## Architectural Context

The Dynamic Pipeline Engine (Plan 1) extended the pipeline system from 4 fixed stages to 6 composable stages. The core routing functions (`resolveNextAgent`, `resolveFailAgent`, `resolvePrerequisite`) now accept an optional `activeStages` parameter. However, several peripheral codepaths — Zod schema annotations, the re-validation guard, and the reset-rework-count tool — were not fully updated to reflect the 6-type model. These are the remnants that this rework addresses.

**Key files involved:**

| File | Role |
|------|------|
| `mcp-server/src/tools/pipeline.ts` | Pipeline tool schemas + `buildCompletionGuidance` |
| `mcp-server/src/tools/begin-work.ts` | BeginWork tool schema |
| `mcp-server/src/tools/work-package.ts` | WP tools including `ledger_reset_rework_count` |
| `mcp-server/src/utils/workflow-helpers.ts` | Re-validation guard (`checkRevalidationGuard`) |
| `mcp-server/src/tools/workflow-next-action.ts` | Per-agent next-action functions |
| `mcp-server/tests/tools/pipeline.test.ts` | Pipeline tool tests |
| `mcp-server/tests/utils/pipeline-maps.test.ts` | Pipeline routing utility tests |
| `orchestrator/tests/test_graph.py` | Orchestrator graph topology tests |

## Approach / Architecture

This is a focused cleanup pass — no new features, no architectural changes. All fixes are localized to the files listed above. The approach:

1. **Fix spec violations** — 3 items that contradict the workflow specification, prioritized first
2. **Extract shared helper** — Deduplicate the `CANONICAL_PIPELINE_ORDERING.filter()` pattern into a utility
3. **Clean up tests** — Remove dead code, fix invalid test inputs, remove redundant assertions

No changes to the workflow specification itself are required — it is already at v2.4.0 and correctly documents all 6 pipeline types and composable routing.

## Rationale

- **Spec compliance is non-negotiable.** The `.describe()` annotations are surfaced to AI clients via MCP JSON Schema — agents see "4 types" when 6 exist. The re-validation guard gap silently degrades protection for custom-stage WPs. The reset-rework-count enum blocks PMs from resetting counts on the two new stages.
- **Deduplication prevents future drift.** The `CANONICAL_PIPELINE_ORDERING.filter()` pattern was duplicated 5 times during Plan 1. A shared helper makes future stage additions safer.
- **Test hygiene keeps the suite trustworthy.** Out-of-canonical-order inputs in tests normalize invalid data, and dead code/redundant tests add noise.

## Detailed Steps

### Phase 1: MCP Server Spec-Violation Fixes

#### Step 1 — Zod `.describe()` annotation cleanup (5 schemas)

Update all 5 `.describe()` calls that enumerate pipeline types to list all 6 canonical types.

**Files:** `mcp-server/src/tools/pipeline.ts`, `mcp-server/src/tools/begin-work.ts`

| Schema | File | Line | Current | Target |
|--------|------|------|---------|--------|
| `StartPipelineSchema.type` | `pipeline.ts` | ~130 | `"implementation", "qa", "code-review", or "documentation"` | `"implementation", "qa", "security-audit", "code-review", "release-engineering", or "documentation"` |
| `CompletePipelineSchema.type` | `pipeline.ts` | ~301 | Same pattern | Same fix |
| `CancelPipelineSchema.type` | `pipeline.ts` | ~592 | Same pattern | Same fix |
| `UpdatePipelineProgressSchema.type` | `pipeline.ts` | ~662 | Same pattern | Same fix |
| `BeginWorkSchema.type` | `begin-work.ts` | ~33 | Same pattern | Same fix |

**Spec reference:** §4.2 — `PipelineType = implementation | qa | security-audit | code-review | release-engineering | documentation`

**Verification:** `npm run build` (no type errors), `npm test` (no regressions). No behavioral change — `.describe()` annotations are metadata only.

#### Step 2 — `checkRevalidationGuard` activeStages forwarding

Fix the one-line gap in `mcp-server/src/utils/workflow-helpers.ts` at line ~209.

**Current code:**
```typescript
const upstreamTypes = getUpstreamTypes(pipelineType);
```

**Target code:**
```typescript
const upstreamTypes = getUpstreamTypes(pipelineType, activeStages ?? DEFAULT_PIPELINE_STAGES);
```

**Spec reference:** §11.1 — The re-validation guard's upstream rework check explicitly uses `getUpstreamTypes(pipelineType, activeStages)`. Without `activeStages`, the function defaults to `DEFAULT_PIPELINE_STAGES`, producing incorrect upstream type lists for WPs with custom stages (e.g., WPs including `security-audit` or `release-engineering` would not check those stages for upstream rework).

**Verification:** `npm test` — existing tests should pass. Add a targeted test in `mcp-server/tests/utils/workflow-helpers.test.ts` (or the appropriate test file) that exercises `checkRevalidationGuard` with a custom `activeStages` array where the upstream rework occurs on a non-default stage (e.g., `security-audit` rework invalidating `code-review`).

#### Step 3 — `ledger_reset_rework_count` pipeline_type enum

Migrate the hardcoded 4-type `.enum()` in `ResetReworkCountSchema` to use `PipelineTypeEnum`.

**File:** `mcp-server/src/tools/work-package.ts` at line ~1199

**Current code:**
```typescript
pipeline_type: z
  .enum(['implementation', 'qa', 'code-review', 'documentation'])
  .describe('Which pipeline type rework count to reset'),
```

**Target code:**
```typescript
pipeline_type: PipelineTypeEnum
  .describe('Which pipeline type rework count to reset'),
```

`PipelineTypeEnum` is already imported/available in this file (used by other schemas in the same file). It covers all 6 types per spec §3.5.

**Spec reference:** §3.5 — `ReworkCounts` defines fields for all 6 pipeline types. The reset operation must support all types.

**Verification:** `npm run build`, `npm test`. Existing tests for `ledger_reset_rework_count` should continue to pass. Optionally add a test that resets `security-audit` or `release-engineering` rework counts.

### Phase 2: Code Quality — Shared Helper Extraction

#### Step 4 — Extract `getOrderedActiveStages` helper

Extract the repeated `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t))` pattern into a named utility function.

**New function** in `mcp-server/src/utils/pipeline-maps.ts`:
```typescript
export function getOrderedActiveStages(
  activeStages: readonly PipelineType[]
): PipelineType[] {
  return CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
}
```

**Location:** `pipeline-maps.ts` — alongside the existing `getDownstreamTypes`, `getUpstreamTypes`, `resolveNextAgent`, `resolveFailAgent`, and `resolvePrerequisite` functions.

**Callers to update (5 sites):**

| File | Line | Context |
|------|------|---------|
| `pipeline.ts` | ~46 | `buildCompletionGuidance` |
| `pipeline.ts` | ~473 | `completePipeline` handler |
| `workflow-next-action.ts` | ~871 | `getDeveloperAction` rework guidance |
| `workflow-next-action.ts` | ~1241 | `getReviewerAction` rework guidance |
| `workflow-next-action.ts` | ~1445 | `getDocumentationAction` rework guidance |

Each site currently has:
```typescript
const orderedActive = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
```
Replace with:
```typescript
const orderedActive = getOrderedActiveStages(activeStages);
```

**Verification:** `npm run build`, `npm test`. Pure refactor — zero behavioral change. All existing tests must pass identically.

### Phase 3: Test Cleanup

#### Step 5 — Fix pipeline.test.ts dead-code double-write

In `mcp-server/tests/tools/pipeline.test.ts` at line ~1437, the 'rejects pipeline type not active' test writes WP-001 twice — the first write (with an IN_PROGRESS documentation pipeline) is immediately overwritten by the second write (clean WP). Remove the first redundant write.

**Verification:** Test continues to pass with identical behavior.

#### Step 6 — Fix pipeline-maps.test.ts out-of-canonical-order input

In `mcp-server/tests/utils/pipeline-maps.test.ts` at line ~237, the test passes `['qa', 'implementation']` to `resolveFailAgent`. Per spec §8.1, active stages must be a subsequence of the canonical ordering — `qa` cannot precede `implementation`. Change to `['implementation', 'qa']`.

**Current:**
```typescript
const stages: readonly PipelineType[] = ['qa', 'implementation'];
expect(resolveFailAgent('qa', stages)).toBe('Developer');
```

**Target:**
```typescript
const stages: readonly PipelineType[] = ['implementation', 'qa'];
expect(resolveFailAgent('qa', stages)).toBe('Developer');
```

The assertion remains the same — with `implementation` active, `resolveFailAgent('qa', ...)` still returns `'Developer'` (no fallback needed).

**Verification:** Test continues to pass with the same assertion.

#### Step 7 — Remove redundant orchestrator spot-check tests

In `orchestrator/tests/test_graph.py`, remove `test_supervisor_node_present` (line ~109) and `test_synthesis_node_present` (line ~115). Both are fully subsumed by `test_graph_has_nine_nodes` (line ~93), which asserts the exact set of all 9 nodes.

**Verification:** `pytest orchestrator/tests/test_graph.py` — remaining tests pass.

### Phase 4: Manifest & Documentation Updates

#### Step 8 — Update api-surface.md

Update the `ledger_reset_rework_count` tool entry in `mcp-server/docs/agents/project-manifest/api-surface.md` to reflect the 6-type enum and remove the TODO annotation noted in the synthesis.

#### Step 9 — Update api-surface.md (pipeline-maps utility)

Add `getOrderedActiveStages` to the utilities section of `mcp-server/docs/agents/project-manifest/api-surface.md`.

## Dependencies

- All steps are independent within each phase
- Phase 2 (Step 4) should be done before or alongside Phase 1 Steps 1-3, so that the new helper can be used in the `buildCompletionGuidance` refactor in Step 1 — or, done after Phase 1 as a separate pass (either order works)
- Phase 3 has no dependencies on Phase 1 or 2
- Phase 4 follows all code changes

## Required Components

**Existing files to modify:**
- `mcp-server/src/tools/pipeline.ts` — Steps 1, 4
- `mcp-server/src/tools/begin-work.ts` — Step 1
- `mcp-server/src/tools/work-package.ts` — Step 3
- `mcp-server/src/utils/workflow-helpers.ts` — Step 2
- `mcp-server/src/utils/pipeline-maps.ts` — Step 4 (add `getOrderedActiveStages`)
- `mcp-server/src/tools/workflow-next-action.ts` — Step 4
- `mcp-server/tests/tools/pipeline.test.ts` — Step 5
- `mcp-server/tests/utils/pipeline-maps.test.ts` — Step 6
- `orchestrator/tests/test_graph.py` — Step 7
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Steps 8, 9

**No new files are created.**

## Assumptions

- The workflow specification v2.4.0 is the authoritative source for all behavior — it was updated in Plan 1 Phase 0 and is correct
- `PipelineTypeEnum` is already available in `work-package.ts` (used by other schemas in the same file)
- The `CANONICAL_PIPELINE_ORDERING` and `DEFAULT_PIPELINE_STAGES` constants are already exported from `pipeline-maps.ts`
- The orchestrator tests can be run independently from the MCP server tests

## Constraints

- **No behavioral changes** — all fixes must preserve existing behavior for default (4-stage) WPs
- **No workflow spec changes** — the spec is correct as-is at v2.4.0
- **No new dependencies** — this is a cleanup pass only
- **Backward compatibility** — existing ledger files must continue to work unmodified

## Out of Scope

| Item | Reason |
|------|--------|
| **`resolveFailAgent` QA self-rework guidance text** (Synthesis Gold Nugget #3) | Verified against spec §9.3.1 — the self-referential fallback is explicitly documented as canonical behavior: "This follows the same self-referential handoff pattern as Documentation (§21.29) and Release Engineering (§21.56)." The routing and guidance text are spec-compliant. No code change needed. |
| **pytest-asyncio installation** (Synthesis Gold Nugget #8) | Already declared in `orchestrator/pyproject.toml` `[project.optional-dependencies]` dev group. The dependency is present — the issue is environmental (install procedure), not codebase. |
| **Orchestrator supervisor.py wiring for new roles** (Synthesis Gold Nugget #6) | Documented as Plan 2 scope per synthesis. Requires design work beyond a cleanup rework. |
| **Full persona content for Security Auditor / Release Engineer** (Synthesis Gold Nugget #7) | Documented as Plan 2 scope per synthesis. Requires operational protocol design. |
| **Orchestrator `PIPELINE_PREREQUISITES` hardcoding** (Synthesis debt table) | Documented as Plan 2 scope per synthesis. Tied to the supervisor.py wiring work. |
| **Test pattern replication** (Synthesis Gold Nugget #9) | Observational guidance, not an actionable fix. |
| **GUI inactive-stage rendering pattern** (Synthesis Gold Nugget #10) | Observational guidance, not an actionable fix. |

## Acceptance Criteria

1. All 5 Zod `.describe()` annotations list all 6 canonical pipeline types
2. `checkRevalidationGuard` forwards `activeStages` to `getUpstreamTypes`; a new test validates the fix with a custom-stages WP
3. `ledger_reset_rework_count` accepts all 6 pipeline types via `PipelineTypeEnum`
4. A new `getOrderedActiveStages` utility function replaces all 5 duplicated `CANONICAL_PIPELINE_ORDERING.filter()` call sites
5. Dead-code double-write removed from pipeline.test.ts
6. Out-of-canonical-order `['qa', 'implementation']` replaced with `['implementation', 'qa']` in pipeline-maps.test.ts
7. Redundant `test_supervisor_node_present` and `test_synthesis_node_present` removed from test_graph.py
8. `api-surface.md` updated: `ledger_reset_rework_count` entry corrected, `getOrderedActiveStages` added
9. MCP server: `npm run build` succeeds with 0 errors, full test suite passes (1,272+ tests, 0 failures)
10. Orchestrator: `pytest orchestrator/tests/test_graph.py` passes

## Testing Strategy

- **Unit tests:** Existing suites cover all modified codepaths. One new test is needed for Step 2 (re-validation guard with custom activeStages).
- **Build verification:** `npm run build` confirms type-correctness after all changes.
- **Full regression:** `npm test` runs all 1,272+ tests — no failures permitted.
- **Orchestrator:** `pytest orchestrator/tests/test_graph.py` confirms the spot-check removal doesn't break anything.
- **No integration testing needed** — all changes are either metadata (`.describe()`), one-line fixes, or pure refactoring.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`getOrderedActiveStages` export breaks downstream imports** | The function is additive — no existing exports are renamed or removed. Import it only at the call sites that currently inline the pattern. |
| **`checkRevalidationGuard` fix changes behavior for default-stage WPs** | It cannot — `getUpstreamTypes(type)` defaults to `DEFAULT_PIPELINE_STAGES`, identical to `getUpstreamTypes(type, DEFAULT_PIPELINE_STAGES)`. The fix only changes behavior for custom-stage WPs, which is the intended correction. |
| **`PipelineTypeEnum` migration changes validation behavior** | `PipelineTypeEnum` is a superset of the old 4-type enum. All previously valid inputs remain valid. The migration strictly widens the accepted set. |
| **Removing redundant orchestrator tests hides a future regression** | `test_graph_has_nine_nodes` is strictly more comprehensive — it asserts the exact node set (set equality), not just membership. Any node removal would fail this test. |
