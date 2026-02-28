# Plan

## Summary

Phase 4 resolves the technical debt and code quality gaps identified during Phase 3 (Tool Guards & Status Transitions). The work targets two medium-priority architectural issues — `CLAIMABLE_ROLES` drift risk and a stale test simulator — plus a cluster of low-priority correctness fixes, documentation improvements, and a missing multi-pipeline test. No new features are introduced; this is a targeted hardening pass that tightens invariants, removes false-positive test coverage, and improves maintainability across `constants.ts`, `work-package.ts`, and the test suite.

---

## Architectural Context

- **`mcp-server/src/utils/constants.ts`** — Declares `AGENT_ROLES` as the single source of truth for the seven canonical agent role names. Currently exports nothing about which roles are "orchestrating" vs. "claimable".
- **`mcp-server/src/tools/work-package.ts`** — Declares `CLAIMABLE_ROLES` as a standalone string array (10 entries: 5 canonical + 5 `*Agent` aliases). The array cannot be mechanically derived from `AGENT_ROLES` without an explicit exclusion set (Planner, Synthesis). The `claimWorkPackage` function evaluates the role guard at step 2c — after the assignment and override-auth checks — which masks the role error when a WP has an explicit `assigned_to`.
- **`mcp-server/tests/tools/rework-circuit-breaker.test.ts`** — Contains a `simulateStartPipeline` function that mirrors `pipeline.ts` logic at the point in time it was written. WP-002 (Phase 3) introduced per-type rework counting (`rework_counts`), making the simulator stale: it hardcodes the `implementation` counter regardless of the `pipelineType` argument. The tests pass only because they validate their own simulator — **not** the live `_internal.startPipeline` code path.
- **`mcp-server/src/tools/work-package.ts` — `propagateDependencyReblock`** — Transitions dependent WPs to BLOCKED but omits `status_changed_at = now()` on the cascade write. Every direct status mutation in `updateWorkPackageStatus` sets this field. Same gap exists in `propagateDependencyUnblock` (pre-existing).
- **`mcp-server/src/tools/pipeline.ts` — `startPipeline`** — The `rework_counts[type]` increment occurs at step 6b before the circuit-breaker check. The `throw` aborts the write, so the increment is never persisted — but the ordering is non-obvious to future maintainers.

---

## Approach / Architecture

Six self-contained work packages, ordered by priority and dependency:

1. **WP-001 (Medium) — Derive CLAIMABLE_ROLES from AGENT_ROLES:** Add an `ORCHESTRATING_ROLES` exclusion set to `constants.ts`. Derive `CLAIMABLE_ROLES` in `work-package.ts` via filter + alias expansion rather than hardcoding. Add a Vitest regression assertion that every non-orchestrating `AGENT_ROLES` entry is represented in `CLAIMABLE_ROLES`.

2. **WP-002 (Low, depends on WP-001) — Reorder role guard in `claimWorkPackage`:** Move the `CLAIMABLE_ROLES` check from step 2c to step 1b so it fires before assignment and override-auth guards. This ensures non-claimable roles always receive the role error regardless of `assigned_to` state.

3. **WP-003 (Medium) — Replace stale `simulateStartPipeline` with live `_internal.startPipeline`:** Port all circuit-breaker test scenarios in `rework-circuit-breaker.test.ts` to call `_internal.startPipeline` directly (with `_ledgerRoot` injection). Remove the `simulateStartPipeline` and `simulateCompletePipeline` local helpers. The new tests must exercise the actual per-type rework counting and circuit-breaker logic end-to-end.

4. **WP-004 (Low) — Set `status_changed_at` in cascade writes:** Add `wpDetail.status_changed_at = now()` in the re-block candidate loop inside `propagateDependencyReblock`, and in the unblock candidate loop inside `propagateDependencyUnblock`. Add targeted tests asserting the field is set on cascade transitions.

5. **WP-005 (Low) — Multi-pipeline auto-cancellation test:** Add a test exercising two concurrent IN_PROGRESS pipelines on the same WP being auto-cancelled when `propagateDependencyReblock` fires. This closes the implicit single-pipeline coverage assumption flagged in Phase 3 Next Steps.

6. **WP-006 (Low) — Code quality & documentation improvements:** A batch of five small, independent fixes:
   - **G-5:** Inline comment at step 6b of `startPipeline` explaining post-increment/abort sequencing.
   - **G-6:** JSDoc on `propagateDependencyReblock` noting the intentional lossy `p.summary` replacement.
   - **TD-3:** Update `UpdateWorkPackageStatusSchema .describe()` to mention `BLOCKED→BLOCKED` blocker-replacement.
   - **TD-5:** DRY unification of the near-identical steps 8a/8b auto-cancel blocks in `updateWorkPackageStatus`.
   - **TD-6:** Include the failing criterion index in the `acceptance_criteria` whitespace-validation error message.

---

## Rationale

- **WP-001 before WP-002:** WP-002 moves the guard that reads `CLAIMABLE_ROLES`. If `CLAIMABLE_ROLES` derivation changes shape (e.g., becomes a `Set`), the guard call may need to change too. Sequencing WP-001 first avoids touching the guard twice.
- **WP-003 is independent of WP-001/WP-002:** The circuit-breaker test file does not touch `CLAIMABLE_ROLES`; it can land in any order.
- **WP-004 + WP-005 are independent:** Both touch `propagateDependencyReblock` but in different dimensions (source fix vs. new test). They can be developed in parallel and sequenced as the engineer chooses.
- **WP-006 is a pure batch:** None of the six sub-items are structurally related; they are bundled to avoid micro-PRs for one-line changes.

---

## Detailed Steps

### WP-001: Derive CLAIMABLE_ROLES from AGENT_ROLES

1. In `mcp-server/src/utils/constants.ts`, add:
   ```ts
   // Roles that orchestrate the workflow but do not directly execute implementation work.
   // Used to derive CLAIMABLE_ROLES in work-package.ts.
   export const ORCHESTRATING_ROLES = ['Planner', 'Synthesis'] as const;
   export type OrchestratingRole = typeof ORCHESTRATING_ROLES[number];
   ```
2. In `mcp-server/src/tools/work-package.ts`:
   - Import `ORCHESTRATING_ROLES` from `../utils/constants.js`.
   - Replace the hardcoded `CLAIMABLE_ROLES` array with:
     ```ts
     const CLAIMABLE_ROLES: string[] = [
       ...AGENT_ROLES.filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r)),
       ...AGENT_ROLES
         .filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r))
         .map((r) => `${r} Agent`),
     ];
     ```
   - Preserve the existing comment explaining Planner/Synthesis exclusion.
3. In `mcp-server/tests/tools/work-package.test.ts` (or a new `constants.test.ts`), add:
   ```ts
   it('CLAIMABLE_ROLES contains every non-orchestrating AGENT_ROLE', () => {
     const nonOrchestrating = AGENT_ROLES.filter(
       (r) => !ORCHESTRATING_ROLES.includes(r as any)
     );
     for (const role of nonOrchestrating) {
       expect(CLAIMABLE_ROLES).toContain(role);
     }
   });
   ```
4. Run `npm test` — all existing tests must pass; the new regression assertion must pass.

### WP-002: Reorder role guard in `claimWorkPackage`

1. In `mcp-server/src/tools/work-package.ts`, locate `claimWorkPackage`.
2. Move the `CLAIMABLE_ROLES` check (currently step 2c, lines ~447–453) to become step 1b — immediately after the `wp.status !== 'READY'` guard (step 1) and before the assignment guard (step 2).
3. Renumber the step comments to reflect the new order (1 → status check; 1b → role guard; 2 → assignment guard; 2b → override-auth; 3 → dependency check; 4 → transition validation; 5 → mutation).
4. Update or add tests asserting that a non-claimable role (e.g., `Planner`) receives the role error even when the WP is assigned to a different agent (scenario that previously masked into the assignment error).
5. Run `npm test`.

### WP-003: Replace stale `simulateStartPipeline`

1. Read the current `_internal.startPipeline` signature (requires `agent_role`, `work_package_id`, `project_path`, `pipeline_type`, `_ledgerRoot`).
2. In `rework-circuit-breaker.test.ts`:
   - Add an import for `_internal` from `../../src/tools/pipeline.js`.
   - Replace every `await simulateStartPipeline(wpId, type)` call with `await _internal.startPipeline({ agent_role: 'Developer', work_package_id: wpId, project_path: PLAN_PATH, pipeline_type: type }, tempDir)`.
   - Replace every `await simulateCompletePipeline(wpId, type, status)` call with `await _internal.completePipeline({ agent_role: 'Developer', work_package_id: wpId, project_path: PLAN_PATH, pipeline_type: type, status }, tempDir)`.
   - Delete the `simulateStartPipeline` and `simulateCompletePipeline` function definitions.
3. Ensure WP detail setup includes `rework_counts: { implementation: N }` where the test previously used `rework_count: N`, because Phase 3 migrated to per-type counts.
4. Run `npm test` — all circuit-breaker scenarios must pass against live code.

### WP-004: Set `status_changed_at` in cascade writes

1. In `mcp-server/src/tools/work-package.ts`, inside `propagateDependencyReblock`, in the re-block candidate loop (after setting `wpDetail.status = 'BLOCKED'`), add:
   ```ts
   wpDetail.status_changed_at = now();
   ```
2. In `propagateDependencyUnblock`, in the unblock candidate loop (after setting `wpDetail.status = 'READY'` or equivalent), add the same field.
3. Add tests in the `propagateDependencyReblock` / `propagateDependencyUnblock` integration test blocks (in `work-package.test.ts` or `start-pipeline-guards.test.ts`) asserting `status_changed_at` is set after a cascade transition.
4. Run `npm test`.

### WP-005: Multi-pipeline auto-cancellation test

1. In an appropriate test file (suggest: `mcp-server/tests/tools/work-package.test.ts` in the `propagateDependencyReblock` describe block, or a new `reblock-multi-pipeline.test.ts`), add a test that:
   - Creates a WP with two IN_PROGRESS pipelines (e.g., `implementation` and `qa`).
   - Invokes `_internal.propagateDependencyReblock`.
   - Asserts both pipelines have `status: 'FAIL'` and `auto_cancelled: true`.
2. Run `npm test`.

### WP-006: Code quality & documentation batch

Apply the following independently:

- **G-5 (`startPipeline` comment):** In `mcp-server/src/tools/pipeline.ts` at step 6b (rework count increment before circuit-breaker check), add:
  ```ts
  // Uses post-increment count; throw below aborts the write, so the
  // increment is never persisted if the circuit breaker fires.
  ```
- **G-6 (`propagateDependencyReblock` JSDoc):** Add to the function's leading comment:
  ```
  * NOTE: When auto-cancelling IN_PROGRESS pipelines (Phase 1), the entire
  * `summary` array is replaced. Any partial progress notes recorded via
  * ledger_update_pipeline_progress are intentionally discarded — the work
  * is considered void and must restart on re-claim.
  ```
- **TD-3 (`UpdateWorkPackageStatusSchema .describe()`):** Extend the `status` parameter description to mention `BLOCKED→BLOCKED` for blocker replacement.
- **TD-5 (DRY steps 8a/8b):** In `updateWorkPackageStatus`, extract the inline pipeline-auto-cancel block (currently duplicated in ~lines 8a and 8b) into a private helper function `autoCancelActivePipelines(wp: WorkPackageDetail, reason: string): void`.
- **TD-6 (`acceptance_criteria` error message):** When the whitespace validation throws, include the zero-based index of the offending criterion: `acceptance_criteria[${i}] is empty or whitespace-only`.

---

## Dependencies

- WP-002 depends on WP-001 (uses the derived `CLAIMABLE_ROLES`).
- WP-003, WP-004, WP-005, WP-006 are independent and can be parallelized.

---

## Required Components

### Modified Files
- `mcp-server/src/utils/constants.ts` — Add `ORCHESTRATING_ROLES` (WP-001)
- `mcp-server/src/tools/work-package.ts` — Derive `CLAIMABLE_ROLES` (WP-001); reorder guard (WP-002); `status_changed_at` in cascade writes (WP-004); DRY auto-cancel helper (WP-006 TD-5); schema description (WP-006 TD-3); error message (WP-006 TD-6)
- `mcp-server/src/tools/pipeline.ts` — Inline comment at step 6b (WP-006 G-5); JSDoc on `propagateDependencyReblock` (WP-006 G-6)
- `mcp-server/tests/tools/rework-circuit-breaker.test.ts` — Replace simulator with live `_internal` calls (WP-003)
- `mcp-server/tests/tools/work-package.test.ts` — New/updated tests for WP-002 guard ordering, WP-004 `status_changed_at`, WP-005 multi-pipeline cancellation

### New Files (optional)
- `mcp-server/tests/utils/constants.test.ts` — Drift-prevention assertion for `CLAIMABLE_ROLES` (WP-001); can alternatively be added to an existing test file

---

## Assumptions

- `_internal.startPipeline` and `_internal.completePipeline` accept a `_ledgerRoot` injection parameter (confirmed in Phase 3 architecture).
- `rework_counts` (per-type map) is the canonical field as of Phase 3; `rework_count` (legacy scalar) is compatibility-only.
- `propagateDependencyUnblock` transitions dependents to `READY` (confirmed by reading the function signature; no behavioral change proposed).
- The `simulateCompletePipeline` helper in `rework-circuit-breaker.test.ts` is also safe to remove once the tests use `_internal.completePipeline`.

---

## Constraints

- All 703 existing tests must remain green throughout.
- No new dependencies may be added.
- `AGENT_ROLES` in `constants.ts` must not be modified (it is the source of truth).
- No changes to the MCP tool schemas that would constitute a breaking change to external callers.
- Manifest documents must be updated if the public API surface or constraints change (WP-001 adds a new export to `constants.ts` → `api-surface.md`; WP-006 TD-5 adds a private helper → no manifest update needed).

---

## Out of Scope

- Evaluating external callers (orchestrator, persona templates) for `agent_role` compliance — flagged in Phase 3 but deferred to a dedicated audit pass.
- Any changes to the 7-stage workflow schema or pipeline type definitions.
- GUI / REST API layer changes.
- Orchestrator changes.

---

## Acceptance Criteria

- `ORCHESTRATING_ROLES` is exported from `constants.ts` and contains exactly `['Planner', 'Synthesis']`.
- `CLAIMABLE_ROLES` in `work-package.ts` is derived programmatically; no hardcoded role name strings remain in the array literal.
- A Vitest assertion confirms every non-orchestrating `AGENT_ROLES` entry appears in `CLAIMABLE_ROLES` (drift guard).
- A Planner role attempting to claim a WP assigned to Developer receives the role error (not the assignment error).
- `rework-circuit-breaker.test.ts` contains no `simulateStartPipeline` or `simulateCompletePipeline` definitions; all tests call `_internal.startPipeline` / `_internal.completePipeline` directly.
- `wpDetail.status_changed_at` is set in both `propagateDependencyReblock` and `propagateDependencyUnblock` cascade loops; tests assert this.
- A test covers two concurrent IN_PROGRESS pipelines both being auto-cancelled on re-block.
- The inline comment at step 6b of `startPipeline` is present.
- `propagateDependencyReblock` JSDoc notes the intentional lossy summary replacement.
- `UpdateWorkPackageStatusSchema` `.describe()` mentions `BLOCKED→BLOCKED` blocker replacement.
- Auto-cancel logic is extracted into a single `autoCancelActivePipelines` helper (no duplication between steps 8a/8b).
- `acceptance_criteria` validation error includes the zero-based index of the offending criterion.
- All tests pass: `npm test` exits 0.
- TypeScript compilation is clean: `npm run build` exits 0.

---

## Testing Strategy

Each WP includes co-located test additions:
- **WP-001:** Drift-prevention Vitest assertion for `CLAIMABLE_ROLES` completeness.
- **WP-002:** Guard-ordering test: non-claimable role + cross-assigned WP → role error surfaced.
- **WP-003:** Existing circuit-breaker scenarios rewritten to exercise live code; all must pass.
- **WP-004:** Integration assertions on `status_changed_at` after cascade re-block and unblock.
- **WP-005:** Standalone scenario with two IN_PROGRESS pipelines; both confirmed cancelled.
- **WP-006:** No new tests required for pure documentation/comment changes. TD-5 refactor is behaviour-preserving (existing tests provide coverage). TD-6 error message change may require updating one existing error-text assertion.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`_internal.startPipeline` requires WP to be IN_PROGRESS** — may need more setup scaffolding in `rework-circuit-breaker.test.ts` | Read `start-pipeline-guards.test.ts` (added in Phase 3) for the exact WP setup pattern; replicate it |
| **`rework_counts` field may be absent on legacy WP fixtures** — live `startPipeline` initializes it dynamically; simulator did not | Ensure test fixtures initialize `rework_counts: {}` (or omit and let the tool initialize it); verify no TypeScript type errors |
| **Deriving `CLAIMABLE_ROLES` at module load time** — must not produce a different result than the hardcoded list | Snapshot-test the derived array against the known expected values as part of WP-001 |
| **DRY refactor of steps 8a/8b (TD-5) introduces a regression** | The extracted helper must be covered by existing `updateWorkPackageStatus` BLOCKED/CANCELLED tests; run full suite before merging |
| **`propagateDependencyUnblock` `status_changed_at` gap (WP-004)** — pre-existing; fixing it may change timestamps observed in other tests | Search for tests asserting absence of `status_changed_at` on unblock cascade; update expectations if found |
