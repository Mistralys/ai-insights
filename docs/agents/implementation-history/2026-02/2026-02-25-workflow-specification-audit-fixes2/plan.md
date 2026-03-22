# Plan — Workflow Specification Audit Fixes

## Summary

Implement all fixes identified in the [Agent Workflow Specification Audit Synthesis](../../research/agent-workflow-specification-audit-synthesis.md) across three tiers: 5 critical workflow-breaking issues (C-1 through C-5), 7 design/correctness issues (D-1 through D-7), and 8 specification ambiguities (A-1 through A-8). Changes span the MCP server source code (`mcp-server/src/`), schemas (`mcp-server/src/schema/`), the agent workflow specification itself (`docs/agents/research/agent-workflow-specification.md`), and the project manifest documentation.

---

## Architectural Context

### Relevant Modules

| Module | Path | Role in This Plan |
|--------|------|-------------------|
| **Workflow next-action** | `mcp-server/src/tools/workflow-next-action.ts` | C-1 (remove REWORK_QA/REWORK_REVIEW), C-3 (synthesis terminal check), D-4 (circuit breaker), D-6 (docs FAIL routing) |
| **Workflow handoff** | `mcp-server/src/tools/workflow-handoff.ts` | C-1 (QA/Reviewer/Docs FAIL → READY_FOR_DEVELOPER) |
| **Workflow batch actions** | `mcp-server/src/tools/workflow-batch-actions.ts` | Mirrors next-action changes |
| **Workflow helpers** | `mcp-server/src/utils/workflow-helpers.ts` | Shared helpers for new logic |
| **Pipeline tools** | `mcp-server/src/tools/pipeline.ts` | C-1 (FAIL-aware handoff note routing), C-2 (rework_count fix) |
| **Work package tools** | `mcp-server/src/tools/work-package.ts` | C-5 (cascade-block on reopen), D-3 (CANCELLED status) |
| **Project lifecycle** | `mcp-server/src/tools/project-lifecycle.ts` | C-3 (synthesis-aware self-healing), D-7 (separate heal from write) |
| **Schema enums** | `mcp-server/src/schema/enums.ts` | C-3 (new project status), D-3 (CANCELLED WP status) |
| **Schema root-index** | `mcp-server/src/schema/root-index.ts` | C-3 (synthesis_generated flag), D-5 (WP ID regex) |
| **Schema work-package** | `mcp-server/src/schema/work-package.ts` | D-4 (max_rework_count), D-5 (WP ID regex) |
| **Schema validators** | `mcp-server/src/schema/validators.ts` | C-5 (new cascade-block validator), D-3 (CANCELLED transitions) |
| **Pipeline maps** | `mcp-server/src/utils/pipeline-maps.ts` | C-1 (failure routing map) |
| **File lock** | `mcp-server/src/storage/file-lock.ts` | D-1 (retry/stale alignment) |
| **Timestamp** | `mcp-server/src/utils/timestamp.ts` | D-2 (UTC timestamps) |
| **WP ID** | `mcp-server/src/utils/wp-id.ts` | D-5 (variable-width formatting) |
| **Spec document** | `docs/agents/research/agent-workflow-specification.md` | All issues — spec must be updated to match code fixes |

### Conventions

- All file I/O uses atomic writes via `atomicWriteJson()`.
- Dual-file updates use `LedgerStore.updateWorkPackageWithSync()` under lock.
- Tests live in `mcp-server/tests/` mirroring source structure.
- Every code change requires corresponding spec and manifest documentation updates.

---

## Approach / Architecture

The fixes are organized into three implementation tiers matching the audit's priority structure. Within each tier, changes are sequenced to avoid intermediate broken states:

- **Tier 1 (Critical):** Fix the rework loop (C-1), rework count semantics (C-2), synthesis terminal mechanism (C-3), and reopen cascade-blocking (C-5). C-4 (circular deps) is **excluded** — the current implementation prevents cycles by design (deps are immutable at creation and targets must pre-exist), making runtime detection unnecessary.
- **Tier 2 (Design):** Fix lock parameters (D-1), timestamps (D-2), add CANCELLED status (D-3), add rework circuit breaker (D-4), relax WP ID regex (D-5), add documentation FAIL routing (D-6), separate self-heal read from write (D-7).
- **Tier 3 (Ambiguities):** Resolve all A-1 through A-8 specification gaps.
- **Cross-cutting:** Update the agent workflow specification and project manifest documentation throughout.

---

## Rationale

- **Tier 1 first:** These are workflow-breaking. A FAIL handoff stall (C-1) means every pipeline failure requires human intervention. The synthesis infinite loop (C-3) means no project ever truly completes.
- **C-4 excluded from code changes:** The researcher confirmed that the current implementation prevents cycles by construction — dependencies must reference existing WPs and are immutable. Adding runtime cycle detection would be defensive but has no real failure scenario. We document this decision in the spec instead.
- **Spec updated alongside code:** The spec is the normative document. Every code change must be accompanied by a spec update to prevent future audits from finding the same contradictions.
- **Backward compatibility:** The timestamp change (D-2) requires a migration path since `parseTimestamp()` already handles both formats. New ledger files will use UTC; existing files continue to parse correctly.

---

## Detailed Steps

### Tier 1 — Critical Fixes

#### Step 1: C-1 — Fix FAIL handoff logic (rework loop stall)

**1a. Add failure routing map to pipeline-maps.ts**

In `mcp-server/src/utils/pipeline-maps.ts`, add a new `FAIL_ROUTING_MAP` that maps pipeline type → the agent who should fix it on FAIL:

```typescript
export const FAIL_ROUTING_MAP: Record<PipelineType, string> = {
  'implementation': 'Developer',   // own failure
  'qa': 'Developer',               // Developer must fix code
  'code-review': 'Developer',      // Developer must address review feedback
  'documentation': 'Documentation', // Documentation handles its own failures
};
```

**1b. Make `complete_pipeline` use FAIL_ROUTING_MAP for handoff note `to_agent` on FAIL**

In `mcp-server/src/tools/pipeline.ts` (around line 319), change the handoff note construction:

- When `status === 'PASS'`: use `NEXT_AGENT_MAP[type]` (existing behavior).
- When `status === 'FAIL'`: use `FAIL_ROUTING_MAP[type]` instead.

**1c. Fix QA/Reviewer/Documentation handoff to return READY_FOR_DEVELOPER on FAIL**

In `mcp-server/src/tools/workflow-handoff.ts`:
- In the QA handoff logic (around line 421-441): when non-BLOCKED WPs have FAIL `qa` pipelines and no work is in progress, return `READY_FOR_DEVELOPER` instead of `IN_PROGRESS`.
- Apply the same pattern to Reviewer (around line 554-574) and Documentation (around line 686-706) handoff logic.
- The key condition: if all applicable WPs either have PASS pipelines or FAIL pipelines (none actively IN_PROGRESS), and at least one has a most-recent FAIL, return `READY_FOR_DEVELOPER`.

**1d. Remove REWORK_QA, REWORK_REVIEW, REWORK_DOCS from next-action**

In `mcp-server/src/tools/workflow-next-action.ts`:
- Remove priority 3 from QA logic (around line 455-474) that returns `REWORK_QA`. QA should not self-rework — the Developer must fix code first.
- Remove priority 3 from Reviewer logic (around line 550-559) that returns `REWORK_REVIEW`.
- Remove priority 4 from Documentation logic (around line 692-701) that returns `REWORK_DOCS`.
- For QA and Reviewer: if their most-recent pipeline is FAIL, they should return `WAIT` (the Developer will address the issue via their own REWORK action from priority 4, and re-trigger QA via `hasNewUpstreamPassSince`).
- For Documentation: keep the self-rework action but rename it to `REWORK` for consistency (Documentation handles its own FAIL per D-6 decision).

Also apply the same changes to `mcp-server/src/tools/workflow-batch-actions.ts`.

**1e. Align walkthrough §13.2**

Update `docs/agents/research/agent-workflow-specification.md` §13.2 to match the corrected behavior:
- After QA FAIL, handoff returns `READY_FOR_DEVELOPER`.
- Handoff note `to_agent` on FAIL is `Developer` (via FAIL_ROUTING_MAP), not `Reviewer`.

---

#### Step 2: C-2 — Fix rework count semantics

**2a. Change rework_count increment logic in pipeline.ts**

In `mcp-server/src/tools/pipeline.ts` (line 155-160), change the condition from "any prior FAIL" (`some()`) to "most recent pipeline of same type is FAIL":

```typescript
// Current (wrong):
const hasPreviousFail = wp.pipelines.some(
  (p) => p.type === args.type && p.status === 'FAIL'
);

// Fixed:
const sameTypePipelines = wp.pipelines.filter((p) => p.type === args.type);
const mostRecent = sameTypePipelines.at(-1);
const mostRecentIsFail = mostRecent?.status === 'FAIL';
```

Only increment `rework_count` if `mostRecentIsFail` is true.

**2b. Handle absent rework_count field**

Ensure the absent-field case is handled: treat absent as `0`, then increment to `1` (the current code already does `(wp.rework_count ?? 0) + 1` — verify this is correct).

**2c. Update spec §7.1, §7.6**

Rewrite the rework_count semantics table to specify "most recent pipeline of same type is FAIL" as the only increment trigger. Remove the "at least one prior FAIL" language. Align §13.2 walkthrough annotation.

---

#### Step 3: C-3 — Add synthesis terminal mechanism

**3a. Add `synthesis_generated` flag to root index schema**

In `mcp-server/src/schema/root-index.ts`, add an optional boolean field `synthesis_generated` to the `RootIndexSchema`:

```typescript
synthesis_generated: z.boolean().optional(),
```

**3b. Guard GENERATE_SYNTHESIS with the flag**

In `mcp-server/src/tools/workflow-next-action.ts` (around line 89-103), modify the "all WPs COMPLETE" pre-check:

- If `rootIndex.synthesis_generated === true`: return `WAIT` (for Synthesis) or `COMPLETE` (for others), not `GENERATE_SYNTHESIS`.
- Only return `GENERATE_SYNTHESIS` if `synthesis_generated` is absent or `false`.

Apply same logic to `mcp-server/src/tools/workflow-batch-actions.ts`.

**3c. Synthesis must set the flag after generating its report**

This is a convention enforced by documentation, not server-side code: the Synthesis agent should call a new or existing tool to set `synthesis_generated: true`. Options:
- Add a dedicated `ledger_complete_synthesis` tool, OR
- Allow `get_project_status` to accept an optional `mark_synthesis_complete` parameter.

**Recommended:** Add a lightweight `ledger_complete_synthesis` tool in `mcp-server/src/tools/project-lifecycle.ts` that:
1. Reads root index under lock.
2. Sets `synthesis_generated = true`.
3. Sets project status to `COMPLETE` if `pending_work_packages === 0`.
4. Writes root index.

**3d. Fix self-healing to not mark COMPLETE until synthesis is done**

In `mcp-server/src/tools/project-lifecycle.ts` (around line 117-120), change the self-healing condition:

```typescript
// Current:
if (rootIndex.status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
  healedStatus = 'COMPLETE';
}

// Fixed: only heal to COMPLETE if synthesis has been generated
if (rootIndex.status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
  healedStatus = rootIndex.synthesis_generated ? 'COMPLETE' : 'IN_PROGRESS';
}
```

**3e. Update spec §8.1, §11.1, §13.1**

Document the `synthesis_generated` flag, the new `ledger_complete_synthesis` tool, and the updated self-healing rule.

---

#### Step 4: C-4 — Document cycle prevention (no code change)

**4a. Update spec §9.1**

Add a note explaining that circular dependencies are prevented by construction:
- Dependencies are immutable at creation time.
- All dependency targets must already exist in the root index.
- Therefore, a cycle would require WP-A to reference WP-B which references WP-A, but WP-B cannot reference WP-A because WP-A doesn't exist yet when WP-B is created.

**4b. Add to §14 Edge Cases**

Add §14.17: Circular dependency prevention — document that the creation-time existence check prevents cycles by construction.

---

#### Step 5: C-5 — Cascade-block dependents on WP reopen

**5a. Add `propagateDependencyReblock` function**

In `mcp-server/src/tools/work-package.ts`, add a new function (analogous to the existing `propagateDependencyUnblock`):

```typescript
async function propagateDependencyReblock(
  projectPath: string,
  reopenedWpId: string
): Promise<void>
```

Logic:
1. Acquire lock on storage directory.
2. Read root index.
3. Find all non-COMPLETE WPs whose `dependencies` include `reopenedWpId`.
4. For each candidate: if status is READY or IN_PROGRESS, transition to BLOCKED with `blocked_by: { type: 'dependency', description: 'Dependency {reopenedWpId} was reopened', blocking_work_package: reopenedWpId }`.
5. Update root index summaries.
6. Write all changes.
7. Release lock.

**5b. Call `propagateDependencyReblock` on reopen**

In the `ledger_update_work_package_status` handler in `mcp-server/src/tools/work-package.ts`, after the existing COMPLETE → IN_PROGRESS logic (around line 523-525), add:

```typescript
if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
  // After the primary lock is released...
  await propagateDependencyReblock(args.project_path, args.work_package_id);
}
```

This should be placed next to the existing `propagateDependencyUnblock` call pattern (after the main lock, acquires its own lock).

**5c. Update spec §6.6, §9**

Document the cascade-block behavior on reopen. Add a note about whether old pipelines are invalidated (decision: they are NOT invalidated — `hasNewUpstreamPassSince` temporal checks serve as the guard against stale assumptions).

---

### Tier 2 — Design/Correctness Fixes

#### Step 6: D-1 — Align lock retry window with stale timeout

In `mcp-server/src/storage/file-lock.ts` (line 11-17), update the lock parameters:

```typescript
const LOCK_OPTIONS = {
  stale: 10000,  // 10 seconds (unchanged)
  retries: {
    retries: 50,       // was 5 → now 50
    minTimeout: 200,   // unchanged (200ms)
    maxTimeout: 1000,  // unchanged (1s)
  },
};
```

This gives ~10-50 seconds of retry window (50 × 200ms minimum), properly covering the 10s stale timeout.

Update spec §12.2 to reflect the new parameters.

---

#### Step 7: D-2 — Switch to UTC timestamps

**7a. Update `now()` in timestamp.ts**

In `mcp-server/src/utils/timestamp.ts`, change `now()` to use UTC methods and append `Z`:

```typescript
export function now(): string {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  // ... etc, all getUTC*() methods
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}
```

**7b. Update `parseTimestamp()` for backward compatibility**

`parseTimestamp()` already normalizes legacy space-separated formats. Ensure it also handles timestamps with and without the trailing `Z`. The current `new Date(ts.replace(' ', 'T'))` should work for both.

**7c. Update spec §15 Invariant 4**

Change from "YYYY-MM-DD HH:MM:SS (local time, not UTC)" to "YYYY-MM-DDTHH:MM:SSZ (UTC, ISO 8601)".

---

#### Step 8: D-3 — Add CANCELLED work package status

**8a. Add CANCELLED to enums**

In `mcp-server/src/schema/enums.ts`:

```typescript
export const WorkPackageStatus = z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED']);
```

**8b. Add legal transitions**

In `mcp-server/src/schema/validators.ts`, add:
- `READY → CANCELLED` (PM only)
- `BLOCKED → CANCELLED` (PM only)
- `IN_PROGRESS → CANCELLED` (PM only)
- CANCELLED is terminal — no transitions out.

**8c. Add agent guard for CANCELLED**

In `mcp-server/src/tools/work-package.ts`, add a guard in the `update_work_package_status` handler: only Project Manager (or "Project Manager Agent") can transition to CANCELLED.

**8d. CANCELLED interaction with counters and dependencies**

- `pending_work_packages`: CANCELLED does NOT count as pending (decrement on transition to CANCELLED, same as COMPLETE).
- Dependencies: CANCELLED WPs are treated like COMPLETE for unblocking purposes (dependents should not be permanently blocked by a cancelled WP).
- Project completion: CANCELLED WPs do not block project completion.

**8e. Update spec §6.1, §6.2, add §6.7**

Document the CANCELLED status, its transitions, agent guards, and interaction with counters/dependencies.

---

#### Step 9: D-4 — Add rework circuit breaker

**9a. Add configurable `max_rework_count`**

Add `MAX_REWORK_COUNT` constant to `mcp-server/src/utils/workflow-helpers.ts` (default: 5).

**9b. Check rework_count in `start_pipeline`**

In `mcp-server/src/tools/pipeline.ts`, after the rework_count increment logic: if `wp.rework_count > MAX_REWORK_COUNT`, reject the pipeline start with an error message instructing the agent to block the WP.

**9c. Surface RESOLVE_BLOCKERS in next-action**

In the Developer's next-action logic (`mcp-server/src/tools/workflow-next-action.ts`), add a priority check: if any WP has `rework_count >= MAX_REWORK_COUNT` and is not BLOCKED, return `BLOCK_FOR_REWORK_LIMIT` action with guidance to block the WP and escalate to PM.

**9d. Update spec §7.1, §8.1**

Document the circuit breaker mechanism, the `MAX_REWORK_COUNT` constant, and the escalation path.

---

#### Step 10: D-5 — Relax WP ID regex to support 1000+ WPs

**10a. Update Zod schemas**

In `mcp-server/src/schema/root-index.ts` (line 9) and `mcp-server/src/schema/work-package.ts` (line 103):

```typescript
// Current:
work_package_id: z.string().regex(/^WP-\d{3}$/),

// Fixed:
work_package_id: z.string().regex(/^WP-\d{3,}$/),
```

**10b. Update `formatWpId` for dynamic padding**

In `mcp-server/src/utils/wp-id.ts`, change `formatWpId` to use minimum 3-digit padding but support wider numbers:

```typescript
export function formatWpId(n: number): string {
  return `WP-${String(n).padStart(3, '0')}`;
}
```

This already works — `padStart(3, '0')` produces `WP-1000` for n=1000 (4 digits, no truncation). No code change needed here, only the schema regex.

**10c. Update spec §15 Invariant 1**

Change from `/^WP-\d{3}$/` to `/^WP-\d{3,}$/`.

---

#### Step 11: D-6 — Add documentation FAIL routing to Developer

**11a. Update Developer's next-action priority 4**

In `mcp-server/src/tools/workflow-next-action.ts` (around line 345), extend the downstream FAIL check to include `documentation` pipeline type:

```typescript
// Current: only checks 'qa' and 'code-review'
const downstreamTypes = ['qa', 'code-review'] as const;

// Fixed: also check 'documentation'
const downstreamTypes = ['qa', 'code-review', 'documentation'] as const;
```

But ONLY route to Developer if the Documentation agent explicitly blocked the WP with a `technical` blocker indicating a code change is needed. If the documentation pipeline failed without a technical blocker, Documentation should handle its own rework.

**Alternative (simpler):** Keep the Developer check for qa/code-review only. Add explicit documentation in the spec that Documentation handles its own FAIL. If a code change is required, Documentation BLOCKs the WP with a `technical` blocker, and the PM resolves it.

**Recommended:** The simpler alternative. Document this as intentional behavior rather than adding complex conditional routing.

**11b. Update spec §8.1**

Document that Documentation handles its own FAIL pipeline. For code-change-dependent failures, Documentation blocks the WP with a `technical` blocker, routing to PM.

---

#### Step 12: D-7 — Separate self-heal compute from write

**12a. Extract `computeHealedStatus` pure function**

In `mcp-server/src/tools/project-lifecycle.ts`, extract the self-healing logic into a pure function:

```typescript
function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: ProjectStatus;
  needsWrite: boolean;
}
```

**12b. Use the pure function in `get_project_status`**

The existing handler calls `computeHealedStatus()`, and only writes if `needsWrite` is true. This separates the read-path computation from the write side-effect.

**12c. Ensure write happens under lock**

The current code writes without a lock. Wrap the corrective write in `withLock()`:

```typescript
if (healed.needsWrite) {
  await withLock(store.storageDir, async () => {
    // Re-read under lock to avoid race
    const fresh = await store.readRootIndex();
    Object.assign(fresh, { total_work_packages: healed.totalWps, ... });
    await store.writeRootIndex(fresh);
  });
}
```

**12d. Update spec §11.1**

Document that self-healing separates computation from persistence, and writes are performed under lock.

---

### Tier 3 — Ambiguity Resolutions

#### Step 13: Resolve A-1 through A-8

| # | Issue | Resolution | Code Change? |
|---|-------|------------|:------------:|
| **A-1** | COMPLETE→COMPLETE no-op vs role guard | Role guards DO apply even for same-status transitions. Document in spec §6.2. | No |
| **A-2** | Absent rework_count increment | Already handled: `(wp.rework_count ?? 0) + 1`. Document "absent = 0" in spec §3.3. | No |
| **A-3** | Unknown acceptance criterion text | Append as new criterion. Document in spec §7.2. | Verify in `pipeline.ts` |
| **A-4** | Empty acceptance_criteria vacuous pass | Require at least one acceptance criterion on WP creation. Add Zod `.min(1)` to the acceptance_criteria array in the create_work_package tool schema. | Yes |
| **A-5** | PM blocker resolution mechanism | PM calls `update_work_package_status(BLOCKED → READY)` which clears `blocked_by`. Already implemented. Document in spec §8.1. | No |
| **A-6** | `override: true` authorization model | Only PM and the assignee may override. Document in spec §6.4. | Verify guard |
| **A-7** | Multi-WP parallel processing | One WP per agent invocation. Document in spec §8.1. | No |
| **A-8** | Auto-unblock targets READY, losing IN_PROGRESS | Document as intentional: auto-unblock always sets READY (agent must re-claim). Document in spec §9.2. | No |

---

## Dependencies

- Steps 1–5 (Tier 1) should be implemented and tested before Tier 2 to avoid building on broken foundations.
- Step 3c (synthesis tool) depends on 3a (flag schema change).
- Step 8 (CANCELLED status) depends on Step 2 being complete (rework_count is affected by status changes).
- Step 9d (circuit breaker) depends on Step 2a (rework_count semantic fix).
- Steps 6, 7, 10, 11, 12 are independent of each other and can be parallelized.
- Step 13 (ambiguities) can be done in parallel with Tier 2 changes.

## Required Components

### New Files

| File | Purpose |
|------|---------|
| `mcp-server/tests/tools/workflow-rework-loop.test.ts` | Integration tests for the full FAIL → rework → retry cycle (C-1) |
| `mcp-server/tests/tools/synthesis-terminal.test.ts` | Tests for synthesis_generated flag and terminal mechanism (C-3) |
| `mcp-server/tests/tools/cascade-reblock.test.ts` | Tests for cascade-block on WP reopen (C-5) |
| `mcp-server/tests/tools/rework-circuit-breaker.test.ts` | Tests for max_rework_count enforcement (D-4) |
| `mcp-server/tests/tools/cancelled-status.test.ts` | Tests for CANCELLED status transitions and interactions (D-3) |

### Modified Files

| File | Changes |
|------|---------|
| `mcp-server/src/utils/pipeline-maps.ts` | Add `FAIL_ROUTING_MAP` |
| `mcp-server/src/tools/pipeline.ts` | FAIL-aware handoff notes, rework_count fix |
| `mcp-server/src/tools/workflow-next-action.ts` | Remove REWORK_QA/REWORK_REVIEW, synthesis guard, circuit breaker, docs FAIL |
| `mcp-server/src/tools/workflow-batch-actions.ts` | Mirror next-action changes |
| `mcp-server/src/tools/workflow-handoff.ts` | FAIL → READY_FOR_DEVELOPER for QA/Reviewer/Docs |
| `mcp-server/src/tools/work-package.ts` | Cascade-reblock, CANCELLED status, acceptance_criteria min(1) |
| `mcp-server/src/tools/project-lifecycle.ts` | Synthesis-aware self-healing, compute/write separation, ledger_complete_synthesis tool |
| `mcp-server/src/schema/enums.ts` | CANCELLED status |
| `mcp-server/src/schema/root-index.ts` | synthesis_generated field, WP ID regex |
| `mcp-server/src/schema/work-package.ts` | WP ID regex |
| `mcp-server/src/schema/validators.ts` | CANCELLED transitions, cascade-block validator |
| `mcp-server/src/utils/workflow-helpers.ts` | MAX_REWORK_COUNT constant |
| `mcp-server/src/storage/file-lock.ts` | Retry parameters |
| `mcp-server/src/utils/timestamp.ts` | UTC timestamps |
| `docs/agents/research/agent-workflow-specification.md` | All sections referenced in audit |

### Manifest Documents to Update

| Document | Sections |
|----------|----------|
| `mcp-server/docs/agents/project-manifest/api-surface.md` | New `ledger_complete_synthesis` tool, updated `ledger_update_work_package_status` (CANCELLED), updated `ledger_start_pipeline` (circuit breaker) |
| `mcp-server/docs/agents/project-manifest/constraints.md` | New status transition rules (CANCELLED), rework_count semantics, UTC timestamp requirement |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Updated FAIL handoff flow, synthesis completion flow, cascade-reblock flow |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | New test files |
| `mcp-server/src/tools/help-content.ts` | Update tool help text for changed/new tools |

---

## Assumptions

- The spec is normative: when code and spec disagree, we fix the code (per AGENTS.md policy).
- The researcher's finding on C-4 is correct: circular dependencies are prevented by construction and don't need runtime detection.
- D-2 (UTC timestamps) is a breaking change for cross-version temporal comparisons on existing ledgers. The `parseTimestamp()` backward-compat layer handles this gracefully.
- The CANCELLED status (D-3) is a new terminal state that existing tools/agents don't know about yet. Persona instructions may need updating.

---

## Constraints

- All changes must pass the existing test suite (`npm test`) before adding new tests.
- Dual-file writes must use `updateWorkPackageWithSync` or `withLock` patterns.
- No changes to persona source files `personas/ledger/src/` — those are a separate concern.
- The spec document update must be done in the same work package as the corresponding code change to avoid divergence.

---

## Out of Scope

- **C-4 runtime cycle detection** — prevented by design, documented instead.
- **F-1 through F-5 (future-proofing)** — schema versioning, audit logs, stale threshold per-type, retention policies, auto_handoff_depth contention. Tracked for a future plan.
- **Persona instructions updates** — changes to the generated agent persona Markdown files.
- **Orchestrator updates** — the Python orchestrator may need updates to handle new statuses/tools, but that's a separate plan.
- **GUI updates** — the dashboard may need to visualize CANCELLED status and synthesis_generated flag, but that's a separate concern.

---

## Acceptance Criteria

1. **C-1:** When a QA/Reviewer/Documentation pipeline FAILs, `get_handoff_status` returns `READY_FOR_DEVELOPER` (not `IN_PROGRESS`). Handoff notes on FAIL route `to_agent` to Developer (not the next-in-chain agent). QA/Reviewer do not have self-rework actions.
2. **C-2:** `rework_count` only increments when the most recent pipeline of the same type has `FAIL` status. The walkthrough §13.2 is consistent with the implementation.
3. **C-3:** After Synthesis generates its report and calls `ledger_complete_synthesis`, subsequent `get_next_action(Synthesis)` calls return `WAIT`. Self-healing does not mark the project COMPLETE until `synthesis_generated` is true.
4. **C-5:** When a COMPLETE WP is reopened, all dependent WPs that are READY or IN_PROGRESS are transitioned to BLOCKED.
5. **D-1:** Lock retry window covers at least the stale timeout duration.
6. **D-2:** `now()` produces UTC timestamps with trailing `Z`. Legacy timestamps parse correctly.
7. **D-3:** CANCELLED is a valid terminal WP status. Only PM can transition to it. CANCELLED WPs don't count as pending and unblock dependents.
8. **D-4:** Starting a pipeline when `rework_count >= MAX_REWORK_COUNT` is rejected with guidance to block the WP and escalate.
9. **D-5:** WP IDs `WP-1000` and above pass schema validation.
10. **D-6:** Documentation FAIL behavior is documented. Developer is not routed to fix documentation issues (Documentation handles its own FAIL; blocks with `technical` blocker if code changes needed).
11. **D-7:** `get_project_status` does not write to disk unless corrections are needed, and writes happen under lock.
12. **A-1–A-8:** All ambiguities are resolved in the spec document with clear normative language.
13. **All tests pass:** `npm test` passes with zero failures.
14. **Spec and manifest updated:** Every code change has a corresponding spec section update and manifest document update.

---

## Testing Strategy

### Unit Tests

- **C-1:** Test `complete_pipeline` with FAIL status routes `to_agent` via FAIL_ROUTING_MAP. Test QA/Reviewer handoff returns READY_FOR_DEVELOPER on FAIL. Test next-action for QA/Reviewer does not return REWORK_QA/REWORK_REVIEW.
- **C-2:** Test `start_pipeline` rework_count increment with various pipeline histories: `[FAIL]` → increment, `[FAIL, PASS]` → no increment, `[PASS, FAIL]` → increment.
- **C-3:** Test `get_next_action(Synthesis)` returns GENERATE_SYNTHESIS when flag absent, WAIT when flag present. Test `ledger_complete_synthesis` sets flag. Test self-healing doesn't mark COMPLETE without flag.
- **C-5:** Test reopen cascade-blocks dependents. Test COMPLETE dependents are not cascade-blocked.
- **D-1:** Test lock acquisition succeeds when holder takes 5+ seconds (within stale window).
- **D-2:** Test `now()` produces `Z`-suffixed UTC string. Test `parseTimestamp()` handles both formats.
- **D-3:** Test CANCELLED transitions, counter interactions, dependency unblocking.
- **D-4:** Test pipeline start rejected when rework_count exceeds limit.
- **D-5:** Test WP-1000 passes schema validation.

### Integration Tests

- **Full rework loop:** Developer PASS → QA FAIL → handoff to Developer → Developer rework → QA re-triggered → QA PASS → workflow continues.
- **Synthesis completion:** All WPs COMPLETE → Synthesis generates report → calls `ledger_complete_synthesis` → project status COMPLETE → no more GENERATE_SYNTHESIS actions.
- **Cascade-reblock:** WP-001 COMPLETE → WP-002 unblocked → WP-001 reopened → WP-002 re-blocked.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **D-2 (UTC) breaks existing ledger files** | `parseTimestamp()` already handles both formats. No migration needed — new writes use UTC, old timestamps parse correctly. |
| **CANCELLED status confuses existing agents** | Agents that don't know about CANCELLED will see it as an unknown status and likely WAIT. Persona updates can follow in a subsequent plan. |
| **FAIL_ROUTING_MAP adds a new routing abstraction** | Keep it simple (4 entries, same structure as NEXT_AGENT_MAP). No dynamic routing. |
| **Synthesis tool adds a 20th MCP tool** | Minimal surface area (one parameter: project_path). Well-scoped and necessary. |
| **Cascade-reblock may be heavy for large dependency graphs** | Same pattern as existing `propagateDependencyUnblock` — sequential under lock. Acceptable for current scale (<100 WPs). |
| **Circuit breaker may frustrate agents on legitimate complex rework** | Configurable `MAX_REWORK_COUNT` (default 5). PM can unblock and reset if needed. |

AGENT: Planning
STATUS: READY_FOR_PM
