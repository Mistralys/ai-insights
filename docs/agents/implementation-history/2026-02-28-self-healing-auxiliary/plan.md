# Plan

## Summary

Phase 6 of the Ledger Specification Alignment project completes the self-healing rules in `computeHealedStatus`, hardens the `completeSynthesis` guard sequence, introduces two new PM-only MCP tools (`ledger_reset_rework_count` and `ledger_update_acceptance_criteria`), and adds optional pipeline-ordering validation during self-healing. This is the final phase and brings the MCP server into full compliance with the workflow specification.

## Architectural Context

### Self-Healing (`computeHealedStatus` + `getProjectStatus`)

**File:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts)

The `computeHealedStatus` function is a **pure function** that receives a `RootIndex` and returns `{ totalWps, pendingWps, healedStatus, needsWrite }`. It is called by `getProjectStatus`, which implements the double-check write optimization (compute → lock → re-read → re-compute → write) per §17.3.

**Current state:** The function covers 5 of the specification's 16 healing rules:

| Rule | Status |
|------|--------|
| 1 (IN_PROGRESS/READY + pending==0 + synthesis_generated → COMPLETE) | ✅ Present |
| 2 (COMPLETE + pending>0 → IN_PROGRESS) | ✅ Present |
| 3 (READY + any WP IN_PROGRESS → IN_PROGRESS) | ✅ Present |
| BLOCKED + no WPs blocked → IN_PROGRESS/READY (partial 4/4b) | ✅ Partial |
| BLOCKED + pending==0 + synthesis_generated → COMPLETE (partial 5a) | ✅ Present |
| 1b, 1c, 2b, 3b, 3c, 4 (proper), 4b (proper), 5b, 6, 6b, 6c | ❌ Missing |

The function also lacks the `synthesis_generated` corruption mitigation (§17.2 known-gap note).

### Synthesis Completion (`completeSynthesis`)

**File:** [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts)

The function currently:
- ✅ Sets `synthesis_generated = true`
- ✅ Resets `auto_handoff_depth = 0` (§18.4)
- ✅ Transitions to COMPLETE when all WPs terminal
- ❌ Missing agent guard (only Synthesis or PM override per §19.1)
- ❌ Missing counter healing before pending check (§19.1)
- ❌ Missing at-least-one-WP guard (§19.1)

### New PM Tools

Neither `ledger_reset_rework_count` (§16.3b) nor `ledger_update_acceptance_criteria` (§12.3b) exist in the codebase. Both follow the established pattern in [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) — Zod input schema → async handler function → registration in `register(server)`.

### Tool Registration

New tools are registered in each module's `register(server)` function. The new PM tools belong in [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) since they operate on work package data. The log message in [mcp-server/src/index.ts](mcp-server/src/index.ts#L111) must be updated to include the two new tool names.

### Test Files

- Self-healing tests: [mcp-server/tests/tools/project-lifecycle.test.ts](mcp-server/tests/tools/project-lifecycle.test.ts) (289 lines)
- Work package tool tests: [mcp-server/tests/tools/work-package.test.ts](mcp-server/tests/tools/work-package.test.ts)

## Approach / Architecture

All changes are concentrated in two files — `project-lifecycle.ts` and `work-package.ts` — plus their test files. No schema changes are required (Phase 1 already added `auto_cancelled`, `rework_counts`, and `status_changed_at`). No new modules are created.

The self-healing rewrite replaces the body of `computeHealedStatus` with a first-match-wins rule chain that implements all 16 rules from §17.2 in the documented order. The function signature and return type remain unchanged.

The two new PM tools follow the established Zod-schema + handler + registration pattern used by all other tools in the codebase. They are added to `work-package.ts` rather than a new file, keeping the "work package operations" cohesion.

## Rationale

- **Self-healing completeness** is critical because every `getProjectStatus` call runs self-healing — incomplete rules leave projects in incorrect states that confuse the recommendation and handoff engines.
- **`completeSynthesis` hardening** prevents non-Synthesis agents from marking synthesis as done and catches stale-counter races.
- **PM tools for rework-count reset and criteria management** are the only missing operational tools — without them, the PM has no recovery path from tripped circuit breakers and no way to correct acceptance criteria text errors.
- **Keeping tools in `work-package.ts`** avoids a new module and follows the existing pattern where all WP-mutating operations live there.

## Detailed Steps

### 6.1 Rewrite `computeHealedStatus` to implement all 16 healing rules (§17.2)

**File:** `mcp-server/src/tools/project-lifecycle.ts`

Replace the `computeHealedStatus` function body with a first-match-wins rule chain. The pure function signature is unchanged:

```typescript
export function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: RootIndex['status'];
  needsWrite: boolean;
}
```

**Rule implementation order (first match wins):**

| # | Condition | Healed Status | Notes |
|---|-----------|---------------|-------|
| 1 | (IN_PROGRESS or READY) AND pending==0 AND total>0 AND synthesis_generated | COMPLETE | Existing — keep |
| 1b | READY AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | **New** — awaiting synthesis |
| 1c | IN_PROGRESS AND pending==0 AND total>0 AND NOT synthesis_generated | Preserve IN_PROGRESS | **New** — no-op, already correct |
| 2 | COMPLETE AND pending>0 | IN_PROGRESS | Existing — keep |
| 2b | COMPLETE AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | **New** — synthesis required for true completion |
| 3 | READY AND any WP IN_PROGRESS | IN_PROGRESS | Existing — keep |
| 3b | READY AND pending>0 AND no WP READY or IN_PROGRESS | BLOCKED | **New** — all remaining WPs blocked |
| 3c | IN_PROGRESS AND pending>0 AND no WP READY or IN_PROGRESS | BLOCKED | **New** — drift repair |
| 4 | BLOCKED AND any WP IN_PROGRESS | IN_PROGRESS | **New** (was partially covered) |
| 4b | BLOCKED AND any WP READY (none IN_PROGRESS) | READY | **New** (was partially covered) |
| 5a | BLOCKED AND pending==0 AND total>0 AND synthesis_generated | COMPLETE | Existing (partial) — fix condition ordering |
| 5b | BLOCKED AND pending==0 AND total>0 AND NOT synthesis_generated | IN_PROGRESS | **New** — all WPs done, awaiting synthesis |
| 6b | (IN_PROGRESS or BLOCKED) AND total==0 | READY | **New** — drift repair |
| 6c | COMPLETE AND total==0 | READY | **New** — drift repair |

**Rule 6** (empty project never auto-healed to COMPLETE) is an invariant enforced implicitly: no rule that produces COMPLETE has `total==0`.

**`synthesis_generated` corruption mitigation** (§17.2 known-gap note): Add a defensive pre-check at the top of the function — if `synthesis_generated == true` AND `pending > 0`, set `synthesis_generated = false` in the healed output and mark `needsWrite = true`.

**Implementation notes:**
- Pre-compute shared predicates once: `hasInProgressWp`, `hasReadyWp`, `hasBlockedWp` from `rootIndex.work_packages`
- The `CANCELLED` status is terminal and cannot be a project status — no rules handle it
- Rule 1c results in no status change but serves as documentation; in code this can be a block that simply falls through (keeping `healedStatus = rootIndex.status`)

### 6.2 Add optional pipeline ordering validation (§17.4)

**File:** `mcp-server/src/tools/project-lifecycle.ts`

Add a new helper function:

```typescript
function validatePipelineOrdering(rootIndex: RootIndex, store: LedgerStore): string[]
```

This reads each WP's pipelines and checks that `started_at` timestamps are monotonically non-decreasing. Returns an array of warning strings identifying affected WPs. Called from `getProjectStatus` after healing, only when corrections were written (piggyback on the existing write path to avoid extra reads).

**Emit warnings as project comments** with type `"warning"`, priority `"low"`, agent `"system"`. Do not attempt to reorder pipelines (spec explicitly says not to).

This is a **SHOULD-level** recommendation — implement it but do not block the phase on it if time is tight.

### 6.3 Harden `completeSynthesis` per §19.1

**File:** `mcp-server/src/tools/project-lifecycle.ts`

Add to the `CompleteSynthesisSchema`:
```typescript
agent_role: z.string().describe('The agent role completing synthesis (must be "Synthesis" or "Project Manager")')
```

Add the following guards **inside the lock**, after reading the root index:

1. **Agent guard:** `if (args.agent_role !== 'Synthesis' && args.agent_role !== 'Project Manager')` → error
2. **Counter healing:** Recompute `total_work_packages` and `pending_work_packages` from actual `work_packages` array before checking
3. **At-least-one-WP guard:** `if (rootIndex.work_packages.length === 0)` → error "Cannot complete synthesis: no work packages exist"
4. **Pending-WP guard:** `if (pendingWps > 0)` → error (current code checks this but against un-healed counters — must use freshly computed count)

The existing depth reset and `synthesis_generated = true` logic is correct — keep it.

### 6.4 Implement `ledger_reset_rework_count` tool (§16.3b)

**File:** `mcp-server/src/tools/work-package.ts`

**New Zod schema:**

```typescript
const ResetReworkCountSchema = z.object({
  project_path: z.string().describe('Absolute path to the project plan directory'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/).describe('ID of the work package'),
  pipeline_type: z.enum(['implementation', 'qa', 'code-review', 'documentation'])
    .describe('Which pipeline type rework count to reset'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  reason: z.string().min(1).describe('Mandatory reason for the reset (audit trail)'),
});
```

**Handler function `resetReworkCount`:**

1. Validate path, read WP detail + root index under lock
2. Guard: `agent_role !== 'Project Manager'` → error
3. Guard: `reason` is empty/whitespace → error
4. Read `wp.rework_counts[pipeline_type]` — if absent or 0, return no-op message
5. Store `previousValue`, set `wp.rework_counts[pipeline_type] = 0`
6. Append project comment:
   ```json
   {
     "type": "rework_reset",
     "priority": "high",
     "timestamp": "<now>",
     "agent": "Project Manager",
     "note": "Reset rework count for <pipeline_type> on <wp_id> from <previousValue> to 0. Reason: <reason>"
   }
   ```
7. Write WP detail + root index atomically

**Register as:**
```typescript
server.registerTool(
  'ledger_reset_rework_count',
  { description: '...', inputSchema: ResetReworkCountSchema.passthrough() },
  resetReworkCount as any
);
```

### 6.5 Implement `ledger_update_acceptance_criteria` tool (§12.3b)

**File:** `mcp-server/src/tools/work-package.ts`

**New Zod schema:**

```typescript
const UpdateAcceptanceCriteriaSchema = z.object({
  project_path: z.string().describe('Absolute path to the project plan directory'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/).describe('ID of the work package'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  operations: z.array(
    z.discriminatedUnion('action', [
      z.object({
        action: z.literal('remove'),
        criterion: z.string().describe('Exact text of the criterion to remove'),
      }),
      z.object({
        action: z.literal('modify_text'),
        old_criterion: z.string().describe('Exact text of the existing criterion'),
        new_criterion: z.string().min(1).describe('New criterion text (must be non-empty)'),
      }),
    ])
  ).min(1).describe('List of operations to apply'),
});
```

**Handler function `updateAcceptanceCriteria`:**

1. Validate path, read WP detail + root index under lock
2. Guard: `agent_role !== 'Project Manager'` → error
3. Guard: `wp.status === 'CANCELLED'` → error
4. Apply operations sequentially:
   - `remove`: find criterion by exact text match → error if not found → remove
   - `modify_text`: find criterion by `old_criterion` exact text → error if not found; validate `new_criterion` is non-empty/non-whitespace → update text
5. Post-operations guard: `wp.acceptance_criteria.length === 0` → error "At least one acceptance criterion is required" (rollback — do not write)
6. Update `root.last_updated = now()`
7. Write WP detail + root index atomically

**Register as:**
```typescript
server.registerTool(
  'ledger_update_acceptance_criteria',
  { description: '...', inputSchema: UpdateAcceptanceCriteriaSchema.passthrough() },
  updateAcceptanceCriteria as any
);
```

### 6.6 Register new tools and update tool count

**File:** `mcp-server/src/tools/work-package.ts` — add both `registerTool` calls to the existing `register(server)` function.

**File:** `mcp-server/src/index.ts` — update the log message (line ~111) to include `ledger_reset_rework_count` and `ledger_update_acceptance_criteria`.

### 6.7 Update manifest documentation

**Files to update:**
- `mcp-server/docs/agents/project-manifest/api-surface.md` — add signatures for the two new tools, update `computeHealedStatus` description
- `mcp-server/docs/agents/project-manifest/file-tree.md` — no new files, but confirm annotations are current
- `mcp-server/docs/agents/project-manifest/data-flows.md` — add acceptance criteria management flow if significant

## Dependencies

- **Phase 1** (schema): `rework_counts` map, `auto_cancelled` flag, `status_changed_at` — all must exist in schema
- **Phase 3** (tool guards): `updateWorkPackageStatus` must already emit `auto_cancelled` on pipeline closures for self-healing rule interactions
- **Phase 5** (handoff engine): `completeSynthesis` depth reset already moved there — verify no residual reset in `updateWorkPackageStatus`

## Required Components

| File | Role |
|------|------|
| `mcp-server/src/tools/project-lifecycle.ts` | Self-healing rewrite, `completeSynthesis` hardening, pipeline validation |
| `mcp-server/src/tools/work-package.ts` | New `resetReworkCount` and `updateAcceptanceCriteria` functions + registration |
| `mcp-server/src/index.ts` | Update tool log message |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | Comprehensive self-healing rule tests, `completeSynthesis` guard tests |
| `mcp-server/tests/tools/work-package.test.ts` | Tests for both new PM tools |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Document new tools |

## Assumptions

- Phases 1–5 are fully implemented and all tests pass
- The `rework_counts` map exists on `WorkPackageDetail` (Phase 1)
- The `auto_cancelled` flag exists on `Pipeline` (Phase 1)
- The `synthesis_generated` field exists on `RootIndex` (already present)
- The `status_changed_at` field exists on `WorkPackageDetail` (Phase 1)
- The auto-handoff depth reset was removed from `updateWorkPackageStatus` in Phase 5

## Constraints

- `computeHealedStatus` must remain a **pure function** (no I/O, no side effects) — it is called twice in the double-check write pattern (§17.3)
- Self-healing rules must be applied in the documented first-match-wins order — reordering changes behavior
- The `synthesis_generated` corruption mitigation is a defensive addition beyond the core spec — implement it but keep it clearly commented
- Both new PM tools must operate under the storage directory lock (dual-file write)
- The `updateAcceptanceCriteria` handler must not persist partial state if the post-operations guard fails (at-least-one-criterion check must happen before writing)

## Out of Scope

- Schema changes (completed in Phase 1)
- Core algorithm changes to `workflow-helpers.ts` (completed in Phase 2)
- Tool guard changes in `startPipeline` / `completePipeline` (completed in Phase 3)
- Recommendation engine changes (completed in Phase 4)
- Handoff engine changes (completed in Phase 5)
- GUI changes
- Recursive transitive reblock in `propagateDependencyReblock` (documented as a known limitation)

## Acceptance Criteria

- All 16 self-healing rules from §17.2 produce the correct healed status, verified by dedicated test cases per rule
- The `synthesis_generated` corruption mitigation resets the flag when `synthesis_generated == true AND pending > 0`
- `completeSynthesis` rejects non-Synthesis/non-PM agents with an error message
- `completeSynthesis` rejects calls when no WPs exist
- `completeSynthesis` uses freshly-healed counters for the pending check
- `ledger_reset_rework_count` resets the per-pipeline rework count to 0, records a project comment with type `"rework_reset"` and priority `"high"`, and requires a non-empty reason
- `ledger_reset_rework_count` is a no-op when the counter is already 0 or absent
- `ledger_reset_rework_count` rejects non-PM callers
- `ledger_update_acceptance_criteria` supports `remove` and `modify_text` operations
- `ledger_update_acceptance_criteria` rejects operations on CANCELLED WPs
- `ledger_update_acceptance_criteria` rejects removal that would leave zero criteria
- `ledger_update_acceptance_criteria` rejects empty/whitespace new criterion text
- `ledger_update_acceptance_criteria` rejects non-PM callers
- Both new tools appear in the registered tool log message
- All existing tests continue to pass
- Manifest documentation (`api-surface.md`) is updated with the two new tool signatures

## Testing Strategy

### Self-Healing Rules (16 test cases minimum)

Each of the 16 rules in §17.2 becomes at least one test case against the pure `computeHealedStatus` function. The existing test suite already covers rules 1, 2, 3, and partial BLOCKED handling — these tests must be preserved and expanded.

**Test structure:**
```typescript
describe('computeHealedStatus — §17.2 healing rules', () => {
  it('Rule 1: (IN_PROGRESS|READY) + pending=0 + total>0 + synthesis_generated → COMPLETE')
  it('Rule 1b: READY + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS')
  it('Rule 1c: IN_PROGRESS + pending=0 + total>0 + !synthesis_generated → preserve IN_PROGRESS')
  it('Rule 2: COMPLETE + pending>0 → IN_PROGRESS')
  it('Rule 2b: COMPLETE + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS')
  it('Rule 3: READY + any WP IN_PROGRESS → IN_PROGRESS')
  it('Rule 3b: READY + pending>0 + no WP READY/IN_PROGRESS → BLOCKED')
  it('Rule 3c: IN_PROGRESS + pending>0 + no WP READY/IN_PROGRESS → BLOCKED')
  it('Rule 4: BLOCKED + any WP IN_PROGRESS → IN_PROGRESS')
  it('Rule 4b: BLOCKED + any WP READY (none IN_PROGRESS) → READY')
  it('Rule 5a: BLOCKED + pending=0 + total>0 + synthesis_generated → COMPLETE')
  it('Rule 5b: BLOCKED + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS')
  it('Rule 6: empty project → no auto-heal to COMPLETE')
  it('Rule 6b: (IN_PROGRESS|BLOCKED) + total=0 → READY')
  it('Rule 6c: COMPLETE + total=0 → READY')
  it('synthesis_generated corruption: synthesis_generated + pending>0 → reset flag')
});
```

### completeSynthesis Guards (4+ test cases)

```typescript
describe('completeSynthesis — §19.1 guards', () => {
  it('rejects non-Synthesis, non-PM agent_role')
  it('rejects when no WPs exist')
  it('rejects when pending WPs remain (uses healed counter)')
  it('succeeds for Synthesis agent when all WPs terminal')
  it('succeeds for PM override when all WPs terminal')
});
```

### New PM Tools (10+ test cases)

```typescript
describe('ledger_reset_rework_count — §16.3b', () => {
  it('resets counter and records project comment')
  it('rejects non-PM callers')
  it('rejects empty reason')
  it('no-op when counter is already 0')
  it('no-op when rework_counts is absent')
});

describe('ledger_update_acceptance_criteria — §12.3b', () => {
  it('removes a criterion by exact text')
  it('modifies criterion text')
  it('rejects removal of last criterion')
  it('rejects empty new_criterion text')
  it('rejects non-PM callers')
  it('rejects operations on CANCELLED WP')
  it('rejects when criterion text not found')
});
```

### Integration Tests

- End-to-end: create project → create WP → manipulate status → verify self-healing produces correct status on `getProjectStatus`
- End-to-end: trip circuit breaker → reset rework count → verify `startPipeline` succeeds again

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Self-healing rule ordering sensitivity** | Implement rules as a sequence of if/else-if blocks in exact specification order. Add a comment header with the rule number for each block. |
| **`computeHealedStatus` purity violation** | The `synthesis_generated` corruption mitigation mutates the healed output but does NOT mutate the input `rootIndex`. Ensure the function creates a new value for the flag rather than modifying the input object. |
| **Existing test breakage from self-healing changes** | The current tests use an inline `applyStatusHealing` replica. After rewrite, update the tests to use the exported `computeHealedStatus` directly (the inline replica becomes redundant). Preserve all passing assertions. |
| **`updateAcceptanceCriteria` atomicity on guard failure** | Clone the criteria array before mutations. If the post-mutation check (≥1 criterion) fails, the original data is unmodified. Do not write to disk. |
| **Schema input for `agent_role` on `completeSynthesis`** | This is a **breaking change** to the tool's input schema (new required field). Existing callers that omit `agent_role` will get a Zod validation error. Mitigate by providing a clear error message and updating persona instructions. |
