# Plan

## Summary

Phase 3 implements the specification's tool-level guards, side effects, and status-transition rules across six MCP tool handlers (`startPipeline`, `completePipeline`, `updateWorkPackageStatus`, `claimWorkPackage`, `createWorkPackage`, `propagateDependencyReblock`) and the `isValidStatusTransition` validator. It also addresses five Gold Nuggets carried forward from the Phase 2 synthesis. All algorithmic building blocks (`checkRevalidationGuard`, `hasDownstreamFail`, `hasDownstreamReengagedSince`, per-pipeline rework tracking) are already implemented and tested from Phases 1–2. Phase 3 is therefore primarily a **wiring and completeness** phase: connecting existing algorithms to call sites, filling missing guards, and ensuring every status transition carries the correct side effects.

---

## Architectural Context

### Sub-project scope
All changes are confined to `mcp-server/` — specifically the `src/schema/validators.ts`, `src/tools/pipeline.ts`, and `src/tools/work-package.ts` modules. No new files need to be created, and no changes are needed to `src/storage/`, `src/utils/`, or the MCP server registration layer.

### Confirmed current state (post Phase 1 & 2)

**Schema (complete — no further changes needed):**
- `mcp-server/src/schema/work-package.ts` — `auto_cancelled`, `rework_counts`, `status_changed_at`, `revision: nonnegative()`, `assigned_to: nullable()` all present
- `mcp-server/src/schema/root-index.ts` — `assigned_to: nullable()` present

**Algorithms (complete — ready to wire):**
- `mcp-server/src/utils/workflow-helpers.ts` — `checkRevalidationGuard()`, `hasDownstreamFail()`, `hasDownstreamReengagedSince()`, `isMostRecentPipelineFail()` (auto_cancelled-aware), `hasNewUpstreamPassSince()` (>=, auto_cancelled-aware) all implemented and tested
- `mcp-server/src/utils/pipeline-maps.ts` — `getDownstreamTypes()`, `getUpstreamTypes()` implemented and tested

**Tools (gaps confirmed by source-read, 2026-02-27):**

| Tool | File | Line | Gap |
|------|------|------|-----|
| `startPipeline` | `pipeline.ts` | 94 | `agent_role` is `.optional()` — must be required or PM exception documented |
| `startPipeline` | `pipeline.ts` | 109 | `checkRevalidationGuard()` exists but is **not called** — no call site |
| `startPipeline` | `pipeline.ts` | 156 | Rework detection uses same-type FAIL only; `hasDownstreamFail()` not wired |
| `startPipeline` | `pipeline.ts` | 161 | Rework counter always reads/writes `implementation` regardless of pipeline type |
| `startPipeline` | `pipeline.ts` | 171 | Circuit breaker reads `implementation` counter for all pipeline types |
| `startPipeline` | `pipeline.ts` | — | No PM override path |
| `completePipeline` | `pipeline.ts` | — | No `agent_role` parameter or validation |
| `completePipeline` | `pipeline.ts` | — | No WP `IN_PROGRESS` status guard |
| `completePipeline` | `pipeline.ts` | — | No agent-role-matches-pipeline-type guard |
| `completePipeline` | `pipeline.ts` | — | No PM override |
| `updateWorkPackageStatus` | `work-package.ts` | 496 | `CANCELLED → CANCELLED` not rejected (validators.ts `from === to` returns true) |
| `updateWorkPackageStatus` | `work-package.ts` | — | `BLOCKED → BLOCKED` not handled as blocker replacement |
| `updateWorkPackageStatus` | `work-package.ts` | — | `IN_PROGRESS → BLOCKED` does not auto-cancel IN_PROGRESS pipelines |
| `updateWorkPackageStatus` | `work-package.ts` | — | `IN_PROGRESS → CANCELLED` does not auto-cancel IN_PROGRESS pipelines |
| `updateWorkPackageStatus` | `work-package.ts` | — | `IN_PROGRESS → READY` unclaim path missing (spec §21.13) |
| `updateWorkPackageStatus` | `work-package.ts` | — | `COMPLETE → IN_PROGRESS` does not reset `rework_counts` or `synthesis_generated` |
| `updateWorkPackageStatus` | `work-package.ts` | — | `→ COMPLETE` freshness check missing (doc PASS post-dates impl start) |
| `updateWorkPackageStatus` | `work-package.ts` | — | `status_changed_at` never set |
| `validators.ts` | `validators.ts` | 41 | `from === to` returns `true` — allows `CANCELLED → CANCELLED` |
| `validators.ts` | `validators.ts` | 56 | `COMPLETE → CANCELLED` not in transition table |
| `claimWorkPackage` | `work-package.ts` | 326 | No `CLAIMABLE_ROLES` restriction |
| `claimWorkPackage` | `work-package.ts` | — | `status_changed_at` never set on successful claim |
| `createWorkPackage` | `work-package.ts` | 255 | `assigned_to` uses `args.assigned_to` — spec says `null` initially (§9b.1) |
| `createWorkPackage` | `work-package.ts` | — | `blocked_by` not set when initial status is `BLOCKED` |
| `createWorkPackage` | `work-package.ts` | — | Cycle detection on `dependencies` missing |
| `createWorkPackage` | `work-package.ts` | — | Empty/whitespace `acceptance_criteria` items not rejected |
| `propagateDependencyReblock` | `work-package.ts` | 708 | IN_PROGRESS pipelines not auto-cancelled with `auto_cancelled: true` |
| `propagateDependencyReblock` | `work-package.ts` | — | COMPLETE dependents not warned via pipeline comment |
| `propagateDependencyReblock` | `work-package.ts` | — | `synthesis_generated` not reset |

**Test baseline:** 621 tests passing (post Phase 2), 0 TypeScript errors.

---

## Approach / Architecture

The plan follows the existing **layered architecture** of the codebase unchanged:

```
schema/validators.ts    ← transition table fixes (WP-001)
tools/pipeline.ts       ← startPipeline & completePipeline guards (WP-002, WP-003)
tools/work-package.ts   ← updateWorkPackageStatus, claimWorkPackage,
                           createWorkPackage, propagateDependencyReblock (WP-004–WP-007)
```

Work packages are ordered by dependency:

1. **WP-001** — Fix `validators.ts` first (other WPs depend on correct transition rules)
2. **WP-002** — Fix `startPipeline` (wires Phase 2 algorithms; self-contained)
3. **WP-003** — Fix `completePipeline` (independent of WP-002; agent guard and PM override)
4. **WP-004** — Major `updateWorkPackageStatus` rewrite (most complex; depends on WP-001 for correct transition table)
5. **WP-005** — Fix `claimWorkPackage` (small, stand-alone)
6. **WP-006** — Fix `createWorkPackage` (stand-alone, introduces cycle detection helper)
7. **WP-007** — Fix `propagateDependencyReblock` (depends on `auto_cancelled` schema from Phase 1, already present)
8. **WP-008** — Documentation consolidation (audit manifest files for all changes above)

WP-002 and WP-003 can run in parallel (different functions in the same file). WP-005, WP-006, WP-007 can run after WP-004 in parallel (different functions in `work-package.ts`, no mutual dependency).

---

## Rationale

- **Wiring-first approach:** Algorithms are already tested independently (Phase 2); Phase 3 focuses on call-site integration rather than reimplementation, reducing risk.
- **`validators.ts` first (WP-001):** The transition table fix is the foundation for a correct `updateWorkPackageStatus` rewrite; starting anywhere else risks writing guarded transitions against a broken table.
- **Per-pipeline rework tracking in `startPipeline` (WP-002):** The Phase 2 compatibility layer always reads/writes the `implementation` counter, which silently miscounts QA/code-review/documentation reworks. This must be fixed before Phase 4 (Recommendation Engine) reads `rework_counts[type]`.
- **Gold Nugget M-1 addressed in WP-002:** `developerReworkTypes` in `hasDownstreamReengagedSince` should be derived from `FAIL_ROUTING_MAP` before the rework detection wiring goes in, to prevent drift.

---

## Detailed Steps

### WP-001 — `validators.ts` transition table fixes

**File:** `mcp-server/src/schema/validators.ts`

1. Fix `CANCELLED → CANCELLED` self-transition: change the `from === to` early return to `return from !== 'CANCELLED'`
2. Add `COMPLETE → CANCELLED` to the `case 'COMPLETE':` branch: `return to === 'IN_PROGRESS' || to === 'CANCELLED'`
3. Update `getLegalTransitions()` helper in `work-package.ts` (line ~759) to reflect `COMPLETE → IN_PROGRESS, CANCELLED`
4. Add/update `UpdateWorkPackageStatusSchema` description string for the `status` parameter to include `COMPLETE→CANCELLED`
5. Tests: Add unit tests for `CANCELLED → CANCELLED` rejected; `CANCELLED → X` rejected for all X; `COMPLETE → CANCELLED` accepted; existing `COMPLETE → IN_PROGRESS` still passes

---

### WP-002 — `startPipeline` full spec guards

**File:** `mcp-server/src/tools/pipeline.ts`

**Pre-change (Gold Nugget M-1 from Phase 2 synthesis):**
Fix `developerReworkTypes` in `workflow-helpers.ts` to be derived from `FAIL_ROUTING_MAP` instead of hardcoded:
```typescript
// Before:
const developerReworkTypes: PipelineType[] = ['qa', 'code-review'];
// After:
const developerReworkTypes = (Object.entries(FAIL_ROUTING_MAP) as [PipelineType, string][])
  .filter(([, agent]) => agent === 'Developer')
  .map(([t]) => t);
```
Add cross-reference comment to `FAIL_ROUTING_MAP`. (No test change needed — existing tests still pass.)

**Changes to `startPipeline`:**

1. **Make `agent_role` required:** Change `z.string().optional()` to `z.string()` on the `StartPipelineSchema`. Retain the PM override gate: if `agent_role === 'Project Manager'`, bypass the role-match check and append a `[PM Override]` note to the pipeline summary.

2. **Wire `checkRevalidationGuard`:** After the prerequisite check (step 4), call `checkRevalidationGuard(wp, args.type, prerequisite)`. Return the error string as a thrown `Error` if non-null.

3. **Fix rework detection to include downstream-triggered rework:**
   ```typescript
   // Replace the simple "mostRecent?.status === 'FAIL'" check:
   const effectiveSamePipelines = wp.pipelines.filter(
     (p) => p.type === args.type && !p.auto_cancelled
   );
   const isDirectRework = effectiveSamePipelines.at(-1)?.status === 'FAIL';
   const isDownstreamRework = hasDownstreamFail(wp.pipelines, args.type);
   const needsRework = isDirectRework || isDownstreamRework;
   ```

4. **Fix rework counting to be per-pipeline-type:**
   ```typescript
   if (needsRework) {
     const current = wp.rework_counts?.[args.type] ?? 0;
     const newCount = current + 1;
     wp.rework_counts = { ...wp.rework_counts, [args.type]: newCount };
     // Legacy scalar — keep in sync only for implementation type (backward-compat)
     if (args.type === 'implementation') {
       wp.rework_count = newCount;
     }
   }
   ```

5. **Fix circuit breaker to use per-type counter:**
   ```typescript
   const effectiveReworkCount = wp.rework_counts?.[args.type] ?? wp.rework_count ?? 0;
   ```

**Tests:**
- Revalidation guard fires when QA re-runs after impl rework without new impl PASS
- PM override bypasses role check
- Rework counting increments correct per-type key (qa rework → `rework_counts.qa`, not `implementation`)
- Circuit breaker triggers on correct per-type count
- Auto-cancelled pipelines excluded from rework detection
- Downstream-triggered rework: impl PASS → qa FAIL → impl starts again → `rework_counts.implementation` increments
- Retain Gold Nugget M-2 note: add comment to old "Pipeline ordering enforcement" test block flagging that it tests inlined logic, not the live code path

---

### WP-003 — `completePipeline` agent guard and WP status check

**File:** `mcp-server/src/tools/pipeline.ts`

1. **Add `agent_role` to `CompletePipelineSchema`:** Required string field. Retained description matching `StartPipelineSchema`.

2. **Add WP status guard (defense-in-depth):**
   ```typescript
   if (wp.status !== 'IN_PROGRESS') {
     throw new Error(
       `Cannot complete pipeline for WP ${args.work_package_id}: WP status is ${wp.status}. Only IN_PROGRESS work packages may have pipelines completed.`
     );
   }
   ```

3. **Add agent role match guard:**
   ```typescript
   const expectedAgent = PIPELINE_AGENT_MAP[args.type];
   if (args.agent_role !== 'Project Manager' && args.agent_role !== expectedAgent) {
     throw new Error(
       `Pipeline type '${args.type}' must be completed by ${expectedAgent}. You provided agent_role: '${args.agent_role}'.`
     );
   }
   ```

4. **PM override: `from_agent` in handoff note:** When `agent_role === 'Project Manager'`, set `from_agent: 'Project Manager (PM Override)'` in the handoff note rather than the pipeline owner.

**Tests:**
- Agent role mismatch rejects (e.g., Developer completing QA pipeline)
- PM override allowed for all pipeline types; `from_agent` records PM identity
- WP not IN_PROGRESS rejects
- Existing happy-path tests still pass (update fixtures to include `agent_role`)

---

### WP-004 — `updateWorkPackageStatus` comprehensive rewrite

**File:** `mcp-server/src/tools/work-package.ts`

This is the largest WP. The function body is rewritten following the §10b.1 algorithm. The current structure (sequential guard blocks) is preserved; new blocks are inserted between existing ones.

**Changes in order:**

1. **CANCELLED self-transition:** After `isValidStatusTransition` check at step 1 (which now rejects CANCELLED → CANCELLED via WP-001), no further code needed — the error surfaces automatically.

2. **BLOCKED → BLOCKED blocker replacement (§21.17):** Add a dedicated same-status branch before the transition guards:
   ```typescript
   if (oldStatus === 'BLOCKED' && newStatus === 'BLOCKED') {
     // Validate agent: must be PM or current assignee
     const allowedReplaceAgents = ['Project Manager', 'Project Manager Agent'];
     if (!allowedReplaceAgents.includes(args.agent) && args.agent !== wp.assigned_to) {
       throw new Error(`Only the Project Manager or current assignee may replace the blocker.`);
     }
     // Validate blocker provided
     if (!args.blocked_by) {
       throw new Error('blocked_by is required when replacing a BLOCKED → BLOCKED blocker.');
     }
     // Dependency-replacement rule: cannot replace a dependency blocker with non-dependency
     if (wp.blocked_by?.type === 'dependency' && args.blocked_by.type !== 'dependency') {
       throw new Error('Cannot replace a dependency blocker with a non-dependency blocker. Resolve the dependency first.');
     }
     wp.blocked_by = args.blocked_by as Blocker;
     wp.status_changed_at = now();
     root.last_updated = now();
     return { wp, root };
   }
   ```

3. **`READY → IN_PROGRESS` redirect (§10b.2):** After transition validation, add:
   ```typescript
   if (oldStatus === 'READY' && newStatus === 'IN_PROGRESS') {
     throw new Error(
       `Use ledger_claim_work_package to transition ${args.work_package_id} from READY to IN_PROGRESS. ` +
       `This ensures proper dependency checking and agent assignment.`
     );
   }
   ```

4. **`IN_PROGRESS → BLOCKED` pipeline auto-cancellation (§10b.1, §21.27):**
   After the status mutation (step 6), when `oldStatus === 'IN_PROGRESS' && newStatus === 'BLOCKED'`:
   ```typescript
   const inProgressPipelines = wp.pipelines.filter((p) => p.status === 'IN_PROGRESS');
   for (const p of inProgressPipelines) {
     p.status = 'FAIL';
     p.completed_at = now();
     p.auto_cancelled = true;
     p.summary = [`Auto-cancelled: WP transitioned IN_PROGRESS → BLOCKED`];
   }
   ```

5. **`IN_PROGRESS → CANCELLED` pipeline auto-cancellation (§21.14b):**
   Same pattern for `oldStatus === 'IN_PROGRESS' && newStatus === 'CANCELLED'`:
   ```typescript
   const inProgressPipelines = wp.pipelines.filter((p) => p.status === 'IN_PROGRESS');
   for (const p of inProgressPipelines) {
     p.status = 'FAIL';
     p.completed_at = now();
     p.auto_cancelled = true;
     p.summary = [`Auto-cancelled: WP transitioned IN_PROGRESS → CANCELLED`];
   }
   ```

6. **`IN_PROGRESS → READY` unclaim (§21.13):**
   Add `IN_PROGRESS → READY` to the valid transitions returned by `isValidStatusTransition` by updating `validators.ts` (add to the `IN_PROGRESS` case). Then in `updateWorkPackageStatus`:
   ```typescript
   if (oldStatus === 'IN_PROGRESS' && newStatus === 'READY') {
     // Guard: no IN_PROGRESS pipelines
     const hasActivePipeline = wp.pipelines.some((p) => p.status === 'IN_PROGRESS');
     if (hasActivePipeline) {
       throw new Error(
         `Cannot unclaim ${args.work_package_id}: cancel all IN_PROGRESS pipelines before unclaiming.`
       );
     }
     wp.assigned_to = null;
     const summary = root.work_packages.find((s) => s.work_package_id === args.work_package_id);
     if (summary) summary.assigned_to = null;
   }
   ```

7. **`COMPLETE → IN_PROGRESS` resets (§21.26, §21.44):**
   Extend step 9 (revision increment):
   ```typescript
   if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
     wp.revision += 1;
     wp.rework_counts = undefined;        // §21.44: reset per-pipeline rework budget
     wp.rework_count = undefined;         // Legacy compat: clear scalar too
     if ('synthesis_generated' in wp) {   // §21.26: invalidate synthesis
       (wp as any).synthesis_generated = false;
     }
   }
   ```
   Note: `synthesis_generated` lives on the root index, not the WP detail. Correct placement:
   ```typescript
   // Reset root-level synthesis_generated for this WP's project on reopen
   if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
     root.synthesis_generated = false;
   }
   ```

8. **`→ COMPLETE` freshness check (§21.10):** Before accepting a COMPLETE transition, verify the most recent documentation pipeline PASS post-dates the most recent implementation pipeline start:
   ```typescript
   if (newStatus === 'COMPLETE') {
     const docPassPipeline = [...wp.pipelines]
       .filter((p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled)
       .at(-1);
     const implPipeline = [...wp.pipelines]
       .filter((p) => p.type === 'implementation' && !p.auto_cancelled)
       .at(-1);
     if (
       docPassPipeline &&
       implPipeline?.started_at &&
       docPassPipeline.completed_at &&
       docPassPipeline.completed_at < implPipeline.started_at
     ) {
       throw new Error(
         `Cannot mark ${args.work_package_id} as COMPLETE: the documentation PASS (${docPassPipeline.completed_at}) ` +
         `pre-dates the most recent implementation pipeline start (${implPipeline.started_at}). ` +
         `The documentation pipeline must be re-run after the latest implementation.`
       );
     }
   }
   ```

9. **Set `status_changed_at` on every transition:** At the point where `wp.status = newStatus` is set (step 6), append `wp.status_changed_at = now()`. Also set on claim (covered in WP-005).

**Tests (extensive):**
- `CANCELLED → CANCELLED` rejected
- `BLOCKED → BLOCKED` replaces blocker (PM or assignee)
- `BLOCKED → BLOCKED` from non-PM/non-assignee rejected
- `BLOCKED → BLOCKED` dependency-to-non-dependency replacement rejected
- `READY → IN_PROGRESS` redirects to claim error
- `IN_PROGRESS → BLOCKED` auto-cancels IN_PROGRESS pipelines with `auto_cancelled: true`
- `IN_PROGRESS → CANCELLED` auto-cancels IN_PROGRESS pipelines
- `IN_PROGRESS → READY` unclaim clears `assigned_to`; fails when pipeline IN_PROGRESS
- `COMPLETE → IN_PROGRESS` resets `rework_counts`, clears `synthesis_generated`, increments revision
- `→ COMPLETE` freshness check: stale doc PASS rejected; fresh doc PASS accepted
- `status_changed_at` set on every successful transition
- `COMPLETE → CANCELLED` accepted (requires WP-001 transition table fix)
- Existing tests updated: add `agent` param where missing; remove expectations that `READY → IN_PROGRESS` via `updateWorkPackageStatus` works

---

### WP-005 — `claimWorkPackage` agent guard and `status_changed_at`

**File:** `mcp-server/src/tools/work-package.ts`

1. **Add `CLAIMABLE_ROLES` guard after step 2 (assignment guard):**
   ```typescript
   const CLAIMABLE_ROLES = ['Developer', 'QA', 'Reviewer', 'Documentation', 'Project Manager',
                             'Developer Agent', 'QA Agent', 'Reviewer Agent', 'Documentation Agent',
                             'Project Manager Agent'];
   if (!CLAIMABLE_ROLES.includes(args.agent)) {
     throw new Error(`Agent role '${args.agent}' cannot claim work packages. Valid roles: Developer, QA, Reviewer, Documentation, Project Manager.`);
   }
   ```

2. **Set `status_changed_at`:**
   After `wp.status = 'IN_PROGRESS'` (step 5), add `wp.status_changed_at = now()`.

**Tests:**
- Unknown agent role rejected
- Known roles accepted (spot-test Developer + Project Manager)
- `status_changed_at` present on claimed WP

---

### WP-006 — `createWorkPackage` per §9b.1

**File:** `mcp-server/src/tools/work-package.ts`

1. **`assigned_to: null` initially:** In step 6, change `assigned_to: args.assigned_to` to `assigned_to: null`. Update `WorkPackageSummarySchema` construction similarly. (The tool's input schema can retain the old `assigned_to` field as an ignored forward-compat shim, or remove it entirely — remove it for clarity and spec compliance.)

2. **Set `blocked_by` on BLOCKED creation:** After `initialStatus` determination (step 4), if `initialStatus === 'BLOCKED'`, set `wpDetail.blocked_by = { type: 'dependency', description: 'Created BLOCKED: one or more dependencies not yet COMPLETE', blocking_work_package: first_unmet_dep }`.

3. **Cycle detection helper (§15.2):**
   ```typescript
   function hasCycle(newId: string, deps: string[], allWps: WorkPackageSummary[]): boolean {
     const visited = new Set<string>();
     const queue = [...deps];
     while (queue.length > 0) {
       const current = queue.shift()!;
       if (current === newId) return true;
       if (visited.has(current)) continue;
       visited.add(current);
       const wp = allWps.find((w) => w.work_package_id === current);
       if (wp) queue.push(...wp.dependencies);
     }
     return false;
   }
   ```
   Call before step 6: if `hasCycle(wpId, args.dependencies, rootIndex.work_packages)`, throw an error.

4. **Empty/whitespace criteria rejection:** Before step 5, validate:
   ```typescript
   for (const criterion of args.acceptance_criteria) {
     if (!criterion.trim()) {
       throw new Error('Acceptance criteria cannot be empty or whitespace-only.');
     }
   }
   ```

**Tests:**
- `assigned_to` is `null` on created WP
- `blocked_by` set when created BLOCKED; absent when created READY
- Cycle detection: A depends on B depends on A → rejected
- Empty criterion string rejected
- Whitespace-only criterion string rejected

---

### WP-007 — `propagateDependencyReblock` improvements

**File:** `mcp-server/src/tools/work-package.ts`

1. **Auto-cancel IN_PROGRESS pipelines (§15.5):** Inside the candidate loop, after transitioning `wpDetail.status = 'BLOCKED'`:
   ```typescript
   const activePipelines = wpDetail.pipelines.filter((p) => p.status === 'IN_PROGRESS');
   for (const p of activePipelines) {
     p.status = 'FAIL';
     p.completed_at = now();
     p.auto_cancelled = true;
     p.summary = [`Auto-cancelled: dependency ${reopenedWpId} was reopened`];
   }
   ```

2. **Warn COMPLETE dependents (§15.5):** Extend candidate search to include COMPLETE WPs that depend on `reopenedWpId`. For each COMPLETE candidate, add a pipeline comment (as a new `IN_PROGRESS` → immediately `FAIL` observation-like entry? — no, per spec §15.5 the correct approach is to add a comment to the WP's most recent pipeline):
   ```typescript
   const completeWps = rootIndex.work_packages.filter(
     (wp) => wp.status === 'COMPLETE' && wp.dependencies.includes(reopenedWpId)
   );
   for (const candidate of completeWps) {
     const wpDetail = await store.readWorkPackage(candidate.work_package_id);
     const lastPipeline = wpDetail.pipelines.at(-1);
     if (lastPipeline) {
       if (!lastPipeline.comments) lastPipeline.comments = [];
       lastPipeline.comments.push({
         type: 'warning',
         priority: 'medium',
         timestamp: now(),
         note: `Dependency ${reopenedWpId} was reopened. Review whether ${candidate.work_package_id} needs to be revisited.`,
       });
       await store.writeWorkPackage(candidate.work_package_id, wpDetail);
     }
   }
   ```

3. **Reset `synthesis_generated` (§21.26 crash-recovery safety net):**
   After re-blocking candidates, add:
   ```typescript
   if (candidates.length > 0) {
     root.synthesis_generated = false;
   }
   ```

**Tests:**
- IN_PROGRESS dependent: pipeline auto-cancelled with `auto_cancelled: true`; WP transitions to BLOCKED
- COMPLETE dependent: warning comment added to last pipeline; status unchanged
- `synthesis_generated` reset to false when at least one candidate blocked
- `synthesis_generated` not changed when no candidates

---

### WP-008 — Documentation consolidation

**Files:** `mcp-server/docs/agents/project-manifest/api-surface.md`, `constraints.md`, `file-tree.md`

1. **`api-surface.md`:**
   - Update `startPipeline` signature: `agent_role` now required; document PM override behaviour
   - Update `completePipeline` signature: add `agent_role` required param; document WP status guard
   - Update `updateWorkPackageStatus`: document new `BLOCKED → BLOCKED` blocker replacement, `IN_PROGRESS → READY` unclaim, `IN_PROGRESS → BLOCKED/CANCELLED` pipeline auto-cancel, `status_changed_at` side effect, `COMPLETE → IN_PROGRESS` reset logic, freshness check
   - Update `claimWorkPackage`: document CLAIMABLE_ROLES restriction and `status_changed_at`
   - Update `createWorkPackage`: document `assigned_to: null`, `blocked_by` on BLOCKED creation, cycle detection, empty criteria rejection
   - Update `propagateDependencyReblock`: document pipeline auto-cancel, COMPLETE warnings, `synthesis_generated` reset
   - Document `hasCycle()` as private utility in `work-package.ts`

2. **`constraints.md`:**
   - Add rule: "Auto-cancelled pipelines (`auto_cancelled: true`) must never be counted by rework detection, circuit breakers, or temporal comparison functions"
   - Add rule: "`READY → IN_PROGRESS` transitions must go through `claimWorkPackage` — `updateWorkPackageStatus` redirects to claim"
   - Add rule: "CANCELLED is terminal — no transitions (including self) are valid"
   - Update `startPipeline` section: `agent_role` is required; document PM override gate

3. **Address remaining Gold Nuggets from Phase 2 synthesis:**
   - **L-1:** Simplify `hasDownstreamFail()` to delegate to `isMostRecentPipelineFail()` (DRY fix in `workflow-helpers.ts`) — small code change, include in this WP as a cleanup
   - **L-2:** Add `index === -1` guard to `getUpstreamTypes()` for defensive symmetry with `getDownstreamTypes()`
   - **L-4:** Add equal-timestamp boundary test to `checkRevalidationGuard` tests
   - **L-6:** Add trailing-alpha negative test (`WP-123abc`) to `pipeline.test.ts` and `observations.test.ts`
   - **L-5:** Fix `file-tree.md` indentation inconsistency in `src/utils/` section

---

## Dependencies

- Phase 1 schema changes ✅ (confirmed in `work-package.ts` — `auto_cancelled`, `rework_counts`, `status_changed_at`, `revision: nonnegative`, `assigned_to: nullable` all present)
- Phase 2 algorithms ✅ (confirmed in `workflow-helpers.ts` — `checkRevalidationGuard`, `hasDownstreamFail`, `hasDownstreamReengagedSince`, updated `isMostRecentPipelineFail`, updated `hasNewUpstreamPassSince` all implemented and tested)
- WP-001 must complete before WP-004 (transition table correctness)

---

## Required Components

| File | WPs | Type |
|------|-----|------|
| `mcp-server/src/schema/validators.ts` | WP-001 | Existing — modify |
| `mcp-server/src/tools/pipeline.ts` | WP-002, WP-003 | Existing — modify |
| `mcp-server/src/tools/work-package.ts` | WP-004, WP-005, WP-006, WP-007 | Existing — modify |
| `mcp-server/src/utils/workflow-helpers.ts` | WP-002 (M-1 pre-change), WP-008 (L-1, L-2) | Existing — minor modify |
| `mcp-server/tests/schema/validators.test.ts` | WP-001 | Existing — expand |
| `mcp-server/tests/tools/pipeline.test.ts` | WP-002, WP-003 | Existing — expand |
| `mcp-server/tests/tools/work-package.test.ts` | WP-004, WP-005, WP-006, WP-007 | Existing — expand |
| `mcp-server/tests/utils/workflow-helpers.test.ts` | WP-008 (L-4) | Existing — minor expand |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-008 | Existing — update |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-008 | Existing — update |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-008 | Existing — minor fix |

No new files are required.

---

## Assumptions

- Phase 1 schema changes are fully deployed (confirmed by source read)
- Phase 2 algorithms are fully deployed (confirmed by source read + test count of 621)
- `synthesis_generated` lives on the **root index** (`RootIndexSchema`), not on `WorkPackageDetail` — the COMPLETE→IN_PROGRESS reset targets `root.synthesis_generated`
- The freshness check (WP-004 step 8) is timestamp-string comparison using ISO 8601 lexicographic ordering (already the pattern used throughout)
- `COMPLETE → CANCELLED` is a valid use case (PM-only, e.g., obsoleted WP) — this is new in Phase 3
- `IN_PROGRESS → READY` (unclaim) is added to the transition table in WP-001 / WP-004; it was previously absent from `isValidStatusTransition`

---

## Constraints

- All 621 existing tests must continue to pass after each WP
- No changes to `src/storage/`, `src/utils/pipeline-maps.ts`, or `src/schema/work-package.ts` beyond WP-008's minor `workflow-helpers.ts` cleanup
- Atomic write discipline (temp-file-rename) must be preserved — no new direct `fs.writeFile` calls
- No new npm dependencies
- The `assigned_to` removal from `CreateWorkPackageSchema` input (WP-006) is a breaking schema change for any caller that currently passes `assigned_to`. This must be flagged in the plan as a potential API break — the TPM should decide whether to remove the field or silently ignore it.

---

## Out of Scope

- Phase 4 (Recommendation Engine) — `getNextAction` updates
- Phase 5 (Handoff Engine) — `getHandoffStatus` updates
- Phase 6 (Self-Healing & Auxiliary Systems)
- GUI changes
- Orchestrator changes
- Any performance optimisation of the lock/retry pattern

---

## Acceptance Criteria

- All 621 existing tests pass with zero regressions
- `checkRevalidationGuard()` has at least one integration-level test wired through `startPipeline` (not just the unit test from Phase 2)
- `startPipeline` correctly increments the per-type rework counter (`rework_counts.qa` for QA, `rework_counts.code-review` for code-review, etc.)
- `completePipeline` rejects a call where `agent_role` does not match the pipeline type (unless PM)
- `updateWorkPackageStatus(BLOCKED → BLOCKED)` replaces the blocker instead of no-op
- `updateWorkPackageStatus(IN_PROGRESS → BLOCKED)` auto-cancels any IN_PROGRESS pipeline with `auto_cancelled: true`
- `updateWorkPackageStatus(COMPLETE → IN_PROGRESS)` resets `rework_counts` and `synthesis_generated`
- `status_changed_at` is populated on `claimWorkPackage` and all `updateWorkPackageStatus` transitions
- `createWorkPackage` sets `assigned_to: null` and populates `blocked_by` when initial status is BLOCKED
- `propagateDependencyReblock` sets `auto_cancelled: true` on cancelled pipelines and adds warning comments on COMPLETE dependents
- TypeScript compilation (`tsc --noEmit`) reports zero errors after all changes
- All project manifest documents (`api-surface.md`, `constraints.md`, `file-tree.md`) updated to reflect Phase 3 changes

---

## Testing Strategy

All tests are unit/integration tests using Vitest (Node.js in-process, temp directories for file I/O via the existing `createTempLedger` / `withTempDir` test helpers).

**Target:** +70–90 net new tests (estimated), bringing the total from 621 to ~690–710.

| WP | Estimated New Tests |
|----|---------------------|
| WP-001 | ~8 |
| WP-002 | ~18 |
| WP-003 | ~8 |
| WP-004 | ~30 |
| WP-005 | ~5 |
| WP-006 | ~10 |
| WP-007 | ~8 |
| WP-008 | ~4 (L-4, L-6 Gold Nuggets) |
| **Total** | **~91** |

Each WP must pass `tsc --noEmit` and `vitest run` before being marked PASS.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`createWorkPackage` removal of `assigned_to` input field breaks existing callers** | Treat as a soft-deprecation: accept the field in the schema but ignore it (instead of hard-remove). Log a `[deprecated]` comment in the returned WP. Revisit removal in Phase 6. |
| **`IN_PROGRESS → READY` addition changes the transition table for all callers** | Guard in `updateWorkPackageStatus` redirects to `claimWorkPackage` error immediately, so no partial-update risk. Existing tests that assert `READY → IN_PROGRESS` via `claimWorkPackage` are unaffected. |
| **Freshness check (§21.10) may fail on legacy ledger files** where doc PASS timestamps are absent | Treat absent `completed_at` or `started_at` as "passes freshness check" (permissive default). Document this assumption in `constraints.md`. |
| **Auto-cancel pipeline flood in `propagateDependencyReblock`** if a work package has many IN_PROGRESS pipelines (unlikely but possible with bugs) | The cascade is bounded by the number of pipelines in each WP. No additional mitigation needed. |
| **`BLOCKED → BLOCKED` dependency-replacement prohibition (§21.17)** may break PM workflows where a dependency blocker is superseded by a technical blocker | PM can first transition BLOCKED → IN_PROGRESS (which clears the blocker), then IN_PROGRESS → BLOCKED with the new blocker type. Document this in error messages. |
| **Per-pipeline rework counter migration in `startPipeline`** — existing WPs have `rework_count` (scalar) but no `rework_counts` map | The dual-write compatibility layer from Phase 2 handles this: `rework_counts` is lazily created on first write. WPs with only `rework_count` continue to work; their scalar is read for the `implementation` type. No data migration needed. |
