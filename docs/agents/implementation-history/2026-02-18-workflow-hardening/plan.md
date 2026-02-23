# Plan

## Summary

Harden the Project Ledger MCP Server's handoff workflow logic by fixing 9 identified issues (1 correctness bug, 2 logic gaps, 6 refinements) and adding 4 missing capabilities. The changes span the workflow engine, pipeline tools, work-package tools, schema layer, validators, and documentation. All changes are backward-compatible — existing ledger files remain valid and no tool signatures change in breaking ways.

## Approach / Architecture

The work is organized into three tiers:

1. **Correctness fixes** — Bug fixes and logic error corrections in existing code. These are the highest priority, affecting runtime behavior today.
2. **Workflow enhancements** — New behaviors that close gaps in the state machine (auto-unblocking, stale pipeline detection, project completion, pipeline ordering enforcement).
3. **Capability additions** — New schema fields and tools that expand what agents can do (rework tracking, partial progress, inter-agent handoff notes, batch `get_next_action`).

All changes use the existing architectural patterns:
- Mutations go through `updateWorkPackageWithSync` (dual-file sync under lock)
- Schema changes use Zod and are additive (new optional fields)
- Validation happens on both read and write
- Error messages remain detailed and actionable

The `PIPELINE_TYPE_MAP` constant already maps agent roles to pipeline types. The new pipeline ordering enforcement leverages this map as well, defining a prerequisite chain: `implementation` → `qa` → `code-review` → `documentation`.

### Project-Level Status Lifecycle (New)

The root index `status` field will gain a complete lifecycle:

```
READY → IN_PROGRESS → COMPLETE → IN_PROGRESS (reopen)
  ↓         ↓
BLOCKED → IN_PROGRESS
```

`get_project_status` will auto-heal project status to `COMPLETE` when all WPs are `COMPLETE`, mirroring the existing counter self-healing pattern.

### Stale Pipeline Detection (New)

`get_next_action` handlers will detect pipelines that have been `IN_PROGRESS` for longer than a configurable threshold (default: 24 hours). When detected, the response will include the stale pipeline information so the agent can decide to complete or restart it.

A new `ledger_cancel_pipeline` tool will allow agents to abort a stuck pipeline, transitioning it to `FAIL` with a cancellation reason.

## Rationale

- **Tier ordering** ensures the most impactful changes are made first. The FAIL pipeline detection bug (Issue 1) produces wrong recommendations in production today.
- **Backward compatibility** is critical — existing ledger files from completed projects must remain valid. All schema changes are additive (new optional fields), so existing files pass validation without modification.
- **Strict pipeline ordering** was chosen over the flexible approach because the user prefers enforcement over convention. The implementation will reject out-of-order pipelines with a clear error message explaining the required sequence.
- **`assigned_to` tracks current activity** rather than ownership, because the primary consumer of this field is the PM listing work packages to see who is working on what.
- **WP ID generation hardening** is low cost now and prevents a class of bugs if deletion is ever introduced.
- **All 4 missing capabilities** are included per user request. They are additive features with no impact on existing flows.

## Detailed Steps

### Tier 1: Correctness Fixes

1. **Fix FAIL pipeline detection bug (Issue 1)**
   - In `src/tools/workflow.ts`, modify `getDeveloperAction`, `getQaAction`, `getReviewerAction`, and `getDocumentationAction`
   - Replace the `.filter().reverse().find(status === 'FAIL')` pattern with checking only the most recent pipeline of each type: `.filter(type).at(-1)` and then check if its status is `FAIL`
   - This affects 4 code locations, all following the same pattern
   - Add unit tests in `tests/tools/workflow-handoff.test.ts` covering the `[FAIL, PASS]` scenario (reworked WP should NOT recommend REWORK)

2. **Fix Documentation handoff dependency check (Issue 7)**
   - In `src/tools/workflow.ts`, modify `getDocumentationHandoff`
   - When `wpsNotYetReviewed` is non-empty, apply `isBlockedByDependencies` to distinguish dependency-blocked WPs from genuinely-waiting WPs
   - Mirror the exact pattern used in `getQaHandoff` and `getReviewerHandoff`: if all unreviewed WPs are dependency-blocked, return `READY_FOR_SYNTHESIS` instead of `READY_FOR_DEVELOPER`
   - Add unit test in `tests/tools/workflow-handoff.test.ts` for Documentation handoff with dependency-blocked WPs

### Tier 2: Workflow Enhancements

3. **Add automatic unblocking of dependent WPs (Issue 2)**
   - In `src/tools/work-package.ts`, modify the `updateWorkPackageStatus` handler
   - After a WP transitions to `COMPLETE`, within the same `updateWorkPackageWithSync` lock:
     - Scan `root.work_packages` for all WPs that list the completed WP ID in their `dependencies`
     - For each dependent WP with `status === 'BLOCKED'`:
       - Read the WP detail file
       - Check if ALL of its dependencies are now `COMPLETE` (using `canStartWorkPackage` validator)
       - If yes, update WP status to `READY` in both the detail file and root summary
       - Clear the `blocked_by` field if present
   - This requires modifying the updater function signature in `updateWorkPackageWithSync` to support writing multiple WP files within a single lock, OR performing the scan inside the existing updater by reading additional WP details and writing them via `atomicWriteJson` within the lock
   - The cleaner approach: after the main WP update in the updater, call a new helper `propagateUnblock(completedWpId, root, store)` that reads and updates dependent WPs while still inside the lock
   - However, `updateWorkPackageWithSync` currently only reads/writes one WP detail file. The propagation logic needs to read and write additional WP files. The best approach is to perform the propagation **after** `updateWorkPackageWithSync` returns, using a separate `withLock` call that reads the root index, identifies dependent WPs, and updates them. Since both operations use the same lock path, they are serialized
   - **Revised approach:** After the main `updateWorkPackageWithSync` call in `updateWorkPackageStatus`, if the new status is `COMPLETE`, call a new function `propagateDependencyUnblock(projectPath, completedWpId)` that:
     1. Acquires the lock via `withLock`
     2. Reads the root index
     3. Finds all WPs with `status === 'BLOCKED'` that depend on `completedWpId`
     4. For each, reads the WP detail, checks all dependencies via `canStartWorkPackage`
     5. If all dependencies are COMPLETE, updates the WP detail status to `READY`, clears `blocked_by`, and updates the root summary
     6. Writes all modified files atomically within the lock
   - Add integration test in `tests/integration/full-workflow.test.ts` verifying that completing WP-001 auto-unblocks dependent WP-002

4. **Add stale pipeline detection and cancellation tool (Issue 3)**
   - In `src/tools/workflow.ts`, add a stale pipeline check at the start of each agent-specific action handler:
     - Before checking for work to do, scan all WP pipelines for IN_PROGRESS pipelines of the agent's type
     - Parse `started_at` timestamp and compare with `now()`
     - If the pipeline has been IN_PROGRESS for > 24 hours, return a `RESUME_OR_CANCEL` action with the stale pipeline details instead of the normal recommendation
     - Include the WP ID, pipeline type, and how long it has been stale
   - Add a new `ledger_cancel_pipeline` tool in `src/tools/pipeline.ts`:
     - Schema: `{ project_path, work_package_id, type, reason }`
     - Finds the most recent IN_PROGRESS pipeline of the given type
     - Sets status to `FAIL`, `completed_at` to `now()`, summary to cancellation reason
     - Registered as `ledger_cancel_pipeline`
   - Add the stale threshold as a constant (e.g., `STALE_PIPELINE_HOURS = 24`) in `workflow.ts`
   - Add unit tests for stale detection and cancellation tool
   - Update `ledger_help` tool with the new tool reference

5. **Add project-level COMPLETE status (Issue 4)**
   - In `src/tools/project-lifecycle.ts`, modify `getProjectStatus`:
     - After the existing counter self-healing logic, add a project status self-healing check:
       - If `status === 'IN_PROGRESS'` and `pending_work_packages === 0` and `work_packages.length > 0`, set `status` to `COMPLETE`
       - If `status === 'COMPLETE'` and `pending_work_packages > 0`, set `status` back to `IN_PROGRESS`
     - Write the corrected root index (same pattern as counter self-healing)
   - This approach is preferred over a Synthesis-specific tool because it follows the established self-healing pattern and works regardless of whether Synthesis runs

6. **Add strict pipeline ordering enforcement (Issue 8)**
   - In `src/tools/pipeline.ts`, modify `startPipeline`:
     - Define a prerequisite map:
       ```
       const PIPELINE_PREREQUISITES: Record<string, string | null> = {
         'implementation': null,          // no prerequisite
         'qa': 'implementation',          // requires PASS implementation
         'code-review': 'qa',             // requires PASS qa
         'documentation': 'code-review',  // requires PASS code-review
       };
       ```
     - After the existing `IN_PROGRESS` status check and duplicate check, add a prerequisite check:
       - Look up the prerequisite type for `args.type`
       - If a prerequisite exists, check that the WP has at least one PASS pipeline of that type
       - If not, throw a clear error: `"Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. Pipeline order: implementation → qa → code-review → documentation."`
     - This is strict — no pipeline can be started out of order
   - Add unit tests for out-of-order pipeline rejection
   - Update `constraints.md` with new constraint documenting pipeline ordering enforcement

7. **Update `assigned_to` on pipeline start (Issue 5)**
   - In `src/tools/pipeline.ts`, modify `startPipeline`:
     - After creating the new pipeline entry, update `wp.assigned_to` to the agent name inferred from the pipeline type using the existing `PIPELINE_TYPE_MAP` (reversed: `implementation → Developer`, `qa → QA`, etc.)
     - Also update the corresponding root index summary's `assigned_to`
   - Define a reverse map in `pipeline.ts`:
     ```
     const PIPELINE_AGENT_MAP: Record<string, string> = {
       'implementation': 'Developer',
       'qa': 'QA',
       'code-review': 'Reviewer',
       'documentation': 'Documentation',
     };
     ```
   - Add test verifying `assigned_to` updates on pipeline start

8. **Harden WP ID generation (Issue 9)**
   - In `src/tools/work-package.ts`, modify `createWorkPackage`:
     - Replace `rootIndex.work_packages.length + 1` with:
       ```typescript
       const existingNumbers = rootIndex.work_packages.map(wp =>
         parseInt(wp.work_package_id.replace('WP-', ''), 10)
       );
       const nextWpNumber = existingNumbers.length > 0
         ? Math.max(...existingNumbers) + 1
         : 1;
       ```
   - Add unit test verifying ID generation with non-sequential IDs (simulate deletion gap)

9. **Remove dead `READY` pipeline status (Issue 6)**
   - In `src/schema/enums.ts`, remove `'READY'` from the `PipelineStatus` enum:
     - Current: `z.enum(['READY', 'IN_PROGRESS', 'PASS', 'FAIL'])`
     - New: `z.enum(['IN_PROGRESS', 'PASS', 'FAIL'])`
   - This is a **breaking schema change** for any existing ledger files that happen to contain `READY` pipelines. Since pipelines are never created with `READY` status, no existing files should be affected. However, as a safety measure:
     - Search existing ledger files in the implementation-history for any `"status": "READY"` in pipeline objects to confirm no files are affected
     - If any are found, keep `READY` in the schema and document it as deprecated instead
   - Update `api-surface.md` to reflect the updated enum

### Tier 3: New Capabilities

10. **Add rework cycle tracking (Missing 1)**
    - In `src/schema/work-package.ts`, add an optional `rework_count` field to `WorkPackageDetailSchema`:
      ```typescript
      rework_count: z.number().int().nonnegative().optional(),
      ```
    - In `src/tools/pipeline.ts`, modify `startPipeline`:
      - When starting a pipeline of a type that already has a previous FAIL pipeline, increment `wp.rework_count` (initialize to 0 if absent, then increment)
    - In `src/tools/pipeline.ts`, modify `completePipeline`:
      - When completing a pipeline with `FAIL` status, this is the trigger point — but the rework cycle is only "counted" when the agent starts a new pipeline after a failure. So the increment belongs in `startPipeline`, not `completePipeline`
    - The Synthesis agent can read `rework_count` to report on process quality
    - Add unit test verifying rework count increments correctly

11. **Add partial progress within a pipeline (Missing 2)**
    - Add a new `ledger_update_pipeline_progress` tool in `src/tools/pipeline.ts`:
      - Schema: `{ project_path, work_package_id, type, summary }`
      - Finds the most recent IN_PROGRESS pipeline of the given type
      - Replaces the pipeline's `summary` array with the provided array
      - Allows agents to record progress notes while working
    - This is a lightweight alternative to completing and re-starting pipelines
    - Register as `ledger_update_pipeline_progress`
    - Add unit test verifying summary updates on IN_PROGRESS pipelines
    - Update `ledger_help` with the new tool

12. **Add inter-agent handoff notes (Missing 3)**
    - In `src/schema/work-package.ts`, add an optional `handoff_notes` field to `WorkPackageDetailSchema`:
      ```typescript
      handoff_notes: z.array(z.object({
        from_agent: z.string(),
        to_agent: z.string(),
        timestamp: z.string(),
        notes: z.array(z.string()),
      })).optional(),
      ```
    - In `src/tools/pipeline.ts`, modify `completePipeline`:
      - Add an optional `handoff_notes` parameter to the schema:
        ```typescript
        handoff_notes: z.array(z.string()).optional()
          .describe('Notes for the next agent in the pipeline. E.g., QA leaving notes for Developer on rework.')
        ```
      - When provided, append a handoff note entry to `wp.handoff_notes` with `from_agent` derived from the pipeline type, `to_agent` derived from the next pipeline type in the chain, and the provided notes
    - The next agent's `get_next_action` can include these notes in its recommendation
    - In `src/tools/workflow.ts`, modify each agent action handler:
      - When recommending work on a WP, check for handoff notes addressed to that agent
      - If found, include them in the response so the agent has immediate context
    - Add unit tests for handoff note creation and retrieval-

13. **Add batch `get_next_action` (Missing 4)**
    - Add a new `ledger_get_next_actions` tool (plural) in `src/tools/workflow.ts`:
      - Schema: `{ project_path, agent_role, max_results? }` (default max_results: 5)
      - Instead of returning after the first actionable WP, collect ALL actionable WPs for the agent's role
      - Return an array of action recommendations
      - This reduces tool calls for projects with many independent WPs
    - Register as `ledger_get_next_actions`
    - The existing `ledger_get_next_action` (singular) remains unchanged for backward compatibility
    - Add unit test verifying batch results
    - Update `ledger_help` with the new tool

### Tier 4: Documentation & Manifest Updates

14. **Update project manifest**
    - Update `docs/agents/project-manifest/api-surface.md`:
      - Add `ledger_cancel_pipeline` tool signature
      - Add `ledger_update_pipeline_progress` tool signature
      - Add `ledger_get_next_actions` tool signature
      - Update `PipelineStatus` enum (remove `READY` or mark deprecated)
      - Update `WorkPackageDetailSchema` with new fields (`rework_count`, `handoff_notes`)
      - Update `startPipeline` signature notes (pipeline ordering, `assigned_to` update)
      - Update `completePipeline` signature notes (`handoff_notes` parameter)
    - Update `docs/agents/project-manifest/constraints.md`:
      - Add new constraint: "Pipeline Ordering Is Enforced" — document the prerequisite chain and error behavior
      - Add new constraint: "`assigned_to` Tracks Current Activity" — document that `start_pipeline` updates this field
      - Add new constraint: "Automatic Dependency Unblocking" — document the propagation behavior
      - Add new constraint: "Project Status Self-Heals to COMPLETE" — document the lifecycle
    - Update `docs/agents/project-manifest/data-flows.md`:
      - Add Flow 9: Dependency Propagation (on COMPLETE)
      - Add Flow 10: Pipeline Cancellation
      - Add Flow 11: Pipeline Progress Update
      - Update Flow 4 (Starting a Pipeline) with ordering enforcement and `assigned_to` update
      - Update Flow 8 (Self-Healing) with project status auto-healing
    - Update `docs/agents/project-manifest/file-tree.md` if any new files are added

15. **Update help tool**
    - In `src/tools/help.ts`, update the `TOOL_HELP` record:
      - Add entries for `ledger_cancel_pipeline`, `ledger_update_pipeline_progress`, `ledger_get_next_actions`
      - Update the overview table with the 3 new tools
      - Update the "Common Mistakes" section with pipeline ordering info
      - Update the "Workflow Order" section to note `assigned_to` auto-update

16. **Update changelog**
    - Add version entry in `changelog.md` documenting all changes
    - Run `npm run sync-version` to update `package.json`

## Dependencies

- Steps 1-2 are independent and can be done in parallel
- Step 3 (auto-unblocking) depends on no other step but touches `work-package.ts` which is also modified by Step 8; sequence them
- Step 4 (stale pipeline) is independent
- Step 5 (project COMPLETE) is independent
- Step 6 (pipeline ordering) and Step 7 (`assigned_to`) both modify `pipeline.ts`; combine into one WP or sequence them
- Step 9 (remove READY enum) should be done after Step 6 to avoid conflicts in `enums.ts`
- Steps 10-13 (new capabilities) depend on schema changes being in place (Step 9/10/12 touch `work-package.ts` schema)
- Step 14 (manifest updates) must be done LAST, after all code changes are finalized
- Step 15 (help tool) can be done alongside Step 14
- Step 16 (changelog) must be the very last step

## Required Components

- `src/tools/workflow.ts` — Issues 1, 3, 7, Missing 3 (handoff note retrieval), Missing 4 (batch action)
- `src/tools/pipeline.ts` — Issues 3 (cancel tool), 6, 7, 8, Missing 1 (rework count), Missing 2 (progress update), Missing 3 (handoff notes on complete)
- `src/tools/work-package.ts` — Issues 2, 9
- `src/tools/project-lifecycle.ts` — Issue 4
- `src/tools/help.ts` — Step 15
- `src/schema/enums.ts` — Issue 6
- `src/schema/work-package.ts` — Missing 1 (rework_count field), Missing 3 (handoff_notes field)
- `src/schema/validators.ts` — Possibly extend for pipeline ordering validation
- `tests/tools/workflow-handoff.test.ts` — Tests for Issues 1, 7, Missing 4
- `tests/integration/full-workflow.test.ts` — Tests for Issues 2, 3, 4, 5, 6, 8
- `tests/tools/pipeline.test.ts` — New test file for pipeline ordering, cancel, progress update
- `docs/agents/project-manifest/api-surface.md` — Step 14
- `docs/agents/project-manifest/constraints.md` — Step 14
- `docs/agents/project-manifest/data-flows.md` — Step 14
- `docs/agents/project-manifest/file-tree.md` — Step 14 (if new files added)
- `changelog.md` — Step 16

## Assumptions

- Existing ledger files in `docs/agents/implementation-history/` do not contain pipelines with `"status": "READY"` (must be verified before removing from enum)
- The 24-hour stale pipeline threshold is appropriate for the user's workflow cadence — sessions typically don't span more than a few hours
- The strict pipeline ordering (implementation → QA → review → docs) is always desired — there's no use case for skipping a stage
- `assigned_to` updating on pipeline start won't break any external tooling that relies on the previous ownership semantic
- Adding optional fields to schemas (`rework_count`, `handoff_notes`) doesn't require migration of existing ledger files (Zod schemas with `.optional()` will accept files without these fields)

## Constraints

- **Backward compatibility**: All schema changes must be additive (optional fields). Existing `.ledger/` files must remain valid
- **No breaking tool signatures**: Existing tool parameters remain unchanged. New parameters are optional. New tools have new names
- **Atomic consistency**: All multi-file mutations must go through `updateWorkPackageWithSync` or `withLock` — no exceptions
- **STDIO discipline**: No `console.log` — all logs to `stderr`
- **Test coverage**: Every behavior change must have a corresponding test

## Out of Scope

- UI or dashboard for project status visualization
- Cross-project query or index capabilities
- Parallel agent execution coordination (agents can work in parallel, but the server doesn't schedule them)
- Migration tooling for existing ledger files (schema changes are additive, so no migration needed)
- Changes to agent persona prompts — personas may need updates to reference new tools, but that is a separate effort
- Performance optimization of lock contention (not a concern at current scale)

## Acceptance Criteria

- All existing tests pass without modification (except tests updated to cover new behavior)
- FAIL pipeline detection: A WP with pipelines `[impl:FAIL, impl:PASS]` does NOT trigger a REWORK recommendation
- Auto-unblocking: Completing WP-001 automatically transitions dependent WP-002 from `BLOCKED` to `READY`
- Documentation handoff: With dependency-blocked WPs, Documentation handoff returns `READY_FOR_SYNTHESIS` (not `READY_FOR_DEVELOPER`)
- Stale pipeline: A pipeline IN_PROGRESS for >24h triggers a `RESUME_OR_CANCEL` action
- Cancel pipeline: `ledger_cancel_pipeline` transitions an IN_PROGRESS pipeline to `FAIL` with cancellation metadata
- Project COMPLETE: When all WPs are COMPLETE, `get_project_status` auto-heals project status to `COMPLETE`
- Pipeline ordering: Starting a `qa` pipeline without a PASS `implementation` pipeline throws a clear error
- `assigned_to`: Starting a QA pipeline updates `assigned_to` to `"QA"` in both WP detail and root summary
- WP ID generation: After simulated deletion creating a gap, the next WP ID is `max(existing) + 1`, not `length + 1`
- Dead enum: `PipelineStatus` no longer includes `READY` (or it's documented as deprecated)
- Rework count: Starting a second implementation pipeline after a FAIL sets `rework_count` to 1
- Partial progress: `ledger_update_pipeline_progress` updates summary on an IN_PROGRESS pipeline
- Handoff notes: `completePipeline` with `handoff_notes` creates a note entry; `get_next_action` includes relevant notes
- Batch action: `ledger_get_next_actions` returns multiple actionable WPs
- All manifest documents are updated to reflect changes
- `ledger_help` includes documentation for all new tools
- Changelog is updated and version is synced

## Testing Strategy

Testing follows the existing patterns established in the codebase:

1. **Unit tests** (fast, isolated):
   - `tests/tools/workflow-handoff.test.ts` — Handoff logic tests using `_internal` exports. Tests use stub WP objects (no file I/O). Cover Issues 1, 7, Missing 4
   - `tests/tools/pipeline.test.ts` — New file for pipeline ordering, cancellation, progress update, and `assigned_to` update tests
   - `tests/schema/validators.test.ts` — If any new validators are added

2. **Integration tests** (real file I/O):
   - `tests/integration/full-workflow.test.ts` — End-to-end scenarios with temp directories. Cover Issues 2, 3, 4, 5, 8, 9, Missing 1, 2, 3
   - Each test creates a temp directory, exercises the full flow, and cleans up

3. **Regression tests**: Ensure no existing behavior is broken by running `npm test` after each step

4. **Manual validation**: After all changes, verify with a real MCP server session:
   - Initialize a project, create WPs with dependencies
   - Walk through a full agent workflow
   - Verify stale pipeline detection by starting a pipeline and not completing it
   - Verify `assigned_to` updates across pipeline handoffs

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Removing `READY` from PipelineStatus breaks existing ledger files** | Verify no existing files use `READY` pipeline status before removing. If any do, mark as deprecated instead of removing |
| **Auto-unblocking race condition** | Propagation uses `withLock` on the same project path, serializing with other operations. No concurrent modification risk |
| **Stale pipeline false positives** | 24-hour threshold is conservative. Agents can dismiss the warning and continue. Threshold is a constant that can be tuned |
| **Strict pipeline ordering breaks valid edge cases** | If users need to skip stages (e.g., skip QA for docs-only changes), they'll need a workaround. This is accepted as the user explicitly requested strict enforcement. Can be revisited if it causes friction |
| **`assigned_to` update breaks PM filtering assumptions** | The PM previously could filter by `assigned_to: "Developer"` to find all developer-owned WPs. After this change, a WP in QA would show `assigned_to: "QA"`. Mitigated by documenting the semantic change |
| **Schema additions increase JSON file size** | New fields are optional and only populated when used. Negligible size impact |
| **3 new tools increase API surface** | Each tool is documented in `ledger_help`. Tool count goes from 14 to 17 — manageable |
