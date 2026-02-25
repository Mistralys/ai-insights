# Plan — Workflow Specification Audit Fixes

## Summary

Fix all 13 findings identified in [mcp-server/docs/agents/workflow-specification-audit.md](../../../../mcp-server/docs/agents/workflow-specification-audit.md) against the workflow specification `mcp-server/docs/agents/workflow-specification.md` (v1.0.0). This spans two CRITICALs, five HIGHs, two MEDIUMs, and four LOWs. Changes touch both the specification document and the TypeScript implementation code, plus corresponding tests.

## Architectural Context

The workflow system is implemented across three tool modules and several supporting files:

| Module | Path | Responsibility |
|--------|------|----------------|
| Next-action engine | [mcp-server/src/tools/workflow-next-action.ts](../../../../mcp-server/src/tools/workflow-next-action.ts) | Per-role action recommendation (§7) |
| Handoff engine | [mcp-server/src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts) | Inter-agent handoff routing (§8–§9) |
| Pipeline tools | [mcp-server/src/tools/pipeline.ts](../../../../mcp-server/src/tools/pipeline.ts) | Start/complete/cancel pipelines (§5) |
| WP tools + dep propagation | [mcp-server/src/tools/work-package.ts](../../../../mcp-server/src/tools/work-package.ts) | Status transitions + auto-unblocking (§4, §6) |
| Status validator | [mcp-server/src/schema/validators.ts](../../../../mcp-server/src/schema/validators.ts) | Transition guard (§4.1) |
| Project lifecycle | [mcp-server/src/tools/project-lifecycle.ts](../../../../mcp-server/src/tools/project-lifecycle.ts) | Self-healing counters/status (§10) |
| Workflow helpers | [mcp-server/src/utils/workflow-helpers.ts](../../../../mcp-server/src/utils/workflow-helpers.ts) | Shared pure helpers (stale detection, pipeline queries) |
| Pipeline maps | [mcp-server/src/utils/pipeline-maps.ts](../../../../mcp-server/src/utils/pipeline-maps.ts) | PIPELINE_AGENT_MAP, PIPELINE_PREREQUISITES, etc. |

Key conventions:
- All file I/O uses `atomicWriteJson()` + `withLock()` for dual-file updates.
- Status transitions are validated at runtime by `isValidStatusTransition()` in `validators.ts`.
- Pipeline prerequisites are checked in `pipeline.ts` `startPipeline()`.
- Tests live in `mcp-server/tests/` mirroring source structure. Test framework: Vitest.

## Approach / Architecture

The 13 fixes are organized into **four work packages** by dependency and functional grouping:

1. **WP-A: State Machine & Transition Guards** (Findings #1, #4, #5) — Schema/validator layer changes that other WPs depend on.
2. **WP-B: Next-Action Temporal Awareness + BLOCKED Guards** (Findings #2, #7) — Core logic rework to the next-action engine.
3. **WP-C: Handoff & Auto-Handoff Fixes** (Findings #6, #8, #9, #13) — Handoff engine corrections.
4. **WP-D: Specification Text Corrections** (Findings #3, #10, #11, #12) — Spec-only updates with LOW/MEDIUM effort.

WP-A should be implemented first (it unlocks the BLOCKED → READY transition that WP-B and WP-C depend on). WP-B, WP-C, and WP-D can then proceed in parallel.

## Rationale

- **Temporal comparison (Finding #2, Option A):** Minimal schema/code change — no new status value, no pipeline invalidation side effects. The `started_at` timestamp already exists on all pipelines and can be compared directly.
- **Auto-handoff depth reset per-WP completion (Finding #8, Option A):** Simplest behavioral change — reset counter each time *any* WP reaches COMPLETE. Avoids schema changes (no per-WP counters) and scales naturally with project size.
- **Grouping strategy:** Validators + transitions first (foundation), then parallel logic fixes, then spec text (low risk).

## Detailed Steps

### WP-A: State Machine & Transition Guards

#### Finding #1 — BLOCKED → READY in state machine (CRITICAL, Low effort)

**Spec change:**
1. In `mcp-server/docs/agents/workflow-specification.md` §4.1, add a row to the transition table:

   | From | To | Conditions | Side Effects |
   |------|----|------------|--------------|
   | `BLOCKED` | `READY` | All dependencies COMPLETE (auto-unblock) | Clear `blocked_by` |

2. Update the ASCII diagram in §4.1 to include a `BLOCKED → READY` arrow.

**Code change:**
3. In [mcp-server/src/schema/validators.ts](../../../../mcp-server/src/schema/validators.ts), update `isValidStatusTransition()`: the `BLOCKED` case should return `to === 'IN_PROGRESS' || to === 'READY'`.

4. In [mcp-server/src/tools/work-package.ts](../../../../mcp-server/src/tools/work-package.ts), update `getLegalTransitions('BLOCKED')` to return `'IN_PROGRESS, READY'`.

**Test:**
5. In [mcp-server/tests/schema/validators.test.ts](../../../../mcp-server/tests/schema/validators.test.ts), add test case: `BLOCKED → READY` should be valid.

#### Finding #4 — Role guard on pipeline start (HIGH, Low effort)

**Spec change:**
1. In §5.2, add precondition #4: "Agent role check: The requesting agent's role MUST match the pipeline type's owner (per §2.3 table)."

**Code change:**
2. In [mcp-server/src/tools/pipeline.ts](../../../../mcp-server/src/tools/pipeline.ts), add an `agent_role` parameter to the `StartPipelineSchema`:
   ```typescript
   agent_role: z.string().optional().describe('Agent role starting the pipeline. If provided, validated against the pipeline type owner.')
   ```
   Make it optional to maintain backward compatibility. When present, validate `PIPELINE_AGENT_MAP[type] === agent_role` (or a normalized variant). If mismatched, reject with: `"Pipeline type '{type}' can only be started by the {owner} agent."`

**Test:**
3. Add test in [mcp-server/tests/tools/pipeline.test.ts](../../../../mcp-server/tests/tools/pipeline.test.ts): calling `start_pipeline` with `agent_role: "Developer"` on `type: "qa"` should reject. Calling without `agent_role` should still succeed (backward compat).

#### Finding #5 — Agent guard on COMPLETE → IN_PROGRESS (HIGH, Low effort)

**Spec change:**
1. In §4.2.4, add a note: "Only the Project Manager and Documentation agents may perform the COMPLETE → IN_PROGRESS transition. All other agents MUST be rejected."

**Code change:**
2. In [mcp-server/src/tools/work-package.ts](../../../../mcp-server/src/tools/work-package.ts), in the `updateWorkPackageStatus` handler, add a guard when the transition is `COMPLETE → IN_PROGRESS`: check that `agent` matches "Project Manager" or "Documentation" (or their aliases). Reject otherwise.

**Test:**
3. Add test: Developer attempting COMPLETE → IN_PROGRESS should be rejected. PM and Documentation should be allowed.

---

### WP-B: Next-Action Temporal Awareness + BLOCKED Guards

#### Finding #2 — Downstream rework can't re-trigger QA/Review/Docs (CRITICAL, Medium effort)

**Design (Option A — Temporal comparison):**
The root cause is that the "new work" check in QA (§7.4 step 2), Reviewer (§7.5 step 2), and Documentation (§7.6 step 3) uses `!hasQaPipeline` / `!hasReviewPipeline` / `!hasDocsPipeline`. After a rework cycle, these pipelines exist (with old PASS status), so the check fails and the agent returns WAIT.

**Fix:** Change the "new work" check from:
```
WP has PASS {prerequisite}, no {current_type} pipeline
```
to:
```
WP has PASS {prerequisite}, AND (no {current_type} pipeline
  OR no {current_type} pipeline started AFTER the most recent PASS {prerequisite} pipeline)
```

This means: if a new upstream PASS pipeline was created *after* the last downstream pipeline, the downstream agent should re-engage.

**Spec change:**
1. In §7.4 step 2, §7.5 step 2, and §7.6 step 3, update "new work" definition to include the temporal condition:
   > "WP has PASS `{prerequisite}` pipeline, AND either (a) no `{current_type}` pipeline exists, OR (b) the most recent `{prerequisite}` PASS pipeline's `completed_at` is more recent than the most recent `{current_type}` pipeline's `started_at`."

2. Add a new §7.11 "Temporal Precedence Rule" explaining the rationale.

**Code change:**
3. In [mcp-server/src/utils/workflow-helpers.ts](../../../../mcp-server/src/utils/workflow-helpers.ts), add a new helper:
   ```typescript
   export function hasNewUpstreamPassSince(
     pipelines: Pipeline[],
     upstreamType: PipelineType,
     downstreamType: PipelineType
   ): boolean
   ```
   Returns `true` if the most recent PASS of `upstreamType` has a `completed_at` timestamp *after* the most recent pipeline of `downstreamType`'s `started_at`. Also returns `true` if no downstream pipeline exists at all.

4. In [mcp-server/src/tools/workflow-next-action.ts](../../../../mcp-server/src/tools/workflow-next-action.ts):
   - In `getQaAction()`: Replace `!hasQaPipeline` with `hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')`.
   - In `getReviewerAction()`: Replace `!hasReviewPipeline` with `hasNewUpstreamPassSince(pipelines, 'qa', 'code-review')`.
   - In `getDocumentationAction()` (new work check): Replace `!hasDocsPipeline` with `hasNewUpstreamPassSince(pipelines, 'code-review', 'documentation')`.

**Test:**
5. In `workflow-helpers` tests (new file or extend existing), test `hasNewUpstreamPassSince`:
   - No downstream pipeline → `true`
   - Downstream started *before* upstream completed → `true`
   - Downstream started *after* upstream completed → `false`

6. In workflow next-action tests, add integration scenario: after Developer reworks (new PASS implementation), QA should get `RUN_QA` even though an old QA PASS pipeline exists.

#### Finding #7 — New-work suggestions don't exclude BLOCKED WPs (HIGH, Low effort)

**Spec change:**
1. In §7.4 step 2, §7.5 step 2, and §7.6 step 3, add condition: "AND WP status is NOT `BLOCKED`".

**Code change:**
2. In [mcp-server/src/tools/workflow-next-action.ts](../../../../mcp-server/src/tools/workflow-next-action.ts):
   - In `getQaAction()`, new-work loop: add `wpDetail.status !== 'BLOCKED'` guard.
   - In `getReviewerAction()`, new-work loop: add `wpDetail.status !== 'BLOCKED'` guard.
   - In `getDocumentationAction()`, new-work loop: add `wpDetail.status !== 'BLOCKED'` guard.

**Test:**
3. Add test: BLOCKED WP with PASS implementation should NOT appear as `RUN_QA` for QA agent.

---

### WP-C: Handoff & Auto-Handoff Fixes

#### Finding #6 — Planner handoff status undefined (HIGH, Low effort)

**Spec change:**
1. In §8, add §8.0 or amend §8.1: "For the Planner role, `get_handoff_status` returns `READY_FOR_DEVELOPER` if work packages exist and any are READY/IN_PROGRESS, or an informational `WAIT` if no WPs exist."

**Code change:**
2. In [mcp-server/src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts), add a `case 'Planner':` to the switch statement that returns a meaningful response rather than falling through to the default `IN_PROGRESS`.

**Test:**
3. Add test: `get_handoff_status` with `current_agent: "Planner"` should return a defined response (not generic `IN_PROGRESS`).

#### Finding #8 — Auto-handoff depth stalls mid-project (HIGH, Medium effort)

**Spec change:**
1. In §9.3, change the depth reset event from:
   > "Project reaches COMPLETE status → Reset `auto_handoff_depth` to 0"
   
   to:
   > "Any work package reaches COMPLETE status → Reset `auto_handoff_depth` to 0"

**Code change:**
2. In [mcp-server/src/tools/work-package.ts](../../../../mcp-server/src/tools/work-package.ts), in the `updateWorkPackageStatus` handler: when transitioning to `COMPLETE`, after the main update, reset `root.auto_handoff_depth = 0` if it's currently non-zero. This happens inside the existing `updateWorkPackageWithSync` callback, so no additional lock is needed.

3. In [mcp-server/src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts), in `buildHandoffResponse()`: **remove** the project-COMPLETE-only depth reset (lines ~194–204) since the reset now happens at WP completion time.

**Test:**
4. Add test: after completing WP-001 (out of 3), `auto_handoff_depth` should be reset to 0 in the root index.
5. Add test: with 5 WPs, auto-handoff chain should not stall at depth 10 because WP completions reset the counter.

#### Finding #9 — Mixed BLOCKED + COMPLETE falls through handoff logic (MEDIUM, Low effort)

**Spec change:**
1. In §8.1, change the global precheck from:
   > "All BLOCKED (no READY/IN_PROGRESS, no COMPLETE)"
   
   to:
   > "If any WP is BLOCKED **and** no WP is READY or IN_PROGRESS"

**Code change:**
2. In [mcp-server/src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts), the global precheck (around line 62) currently checks:
   ```typescript
   blockedWps.length > 0 && readyOrInProgressWps.length === 0 && completeWps.length === 0
   ```
   Change to:
   ```typescript
   blockedWps.length > 0 && readyOrInProgressWps.length === 0
   ```
   This removes the `completeWps.length === 0` requirement, so the BLOCKED status is returned even when some WPs are COMPLETE (as long as none are READY or IN_PROGRESS).

**Test:**
3. Add test: mixed state (2 BLOCKED + 1 COMPLETE, 0 READY/IN_PROGRESS) should return `BLOCKED` handoff status routing to PM.

#### Finding #13 — Ambiguous Synthesis tool ordering (LOW, Low effort)

**Spec change:**
1. In §8.8, change from "Always returns `COMPLETE`" to: "Returns `COMPLETE` only after the synthesis report is generated. If all WPs are COMPLETE but no synthesis has been performed, returns `IN_PROGRESS`."

   *Alternatively* (simpler): Add explicit guidance in §8.8 stating Synthesis should call `get_next_action` first, then `get_handoff_status` after generating the report. Since the Synthesis agent only acts when all WPs are COMPLETE (and the current implementation simply returns COMPLETE unconditionally), the simplest fix is to document the expected call order.

**Code change (Option B — documentation-only approach):**
2. In `workflow-handoff.ts`, in the `case 'Synthesis':` handler, add a detail note in the response message: "Call `ledger_get_next_action` first to check if synthesis work is pending."

   OR (Option A — behavioral change): Check whether a synthesis has been generated (requires a new field or convention). Given the Synthesis agent doesn't actually write to the ledger, Option B (guidance) is simpler.

---

### WP-D: Specification Text Corrections

#### Finding #3 — Self-contradictory rework_count in §19.1 (MEDIUM, Trivial)

In `mcp-server/docs/agents/workflow-specification.md` §19.1, replace the confusing paragraph about `rework_count` with:

> "rework_count is **not** incremented for the new implementation pipeline (the previous implementation was PASS, not FAIL). However, when QA later starts a new qa pipeline, rework_count **is** incremented because the previous qa pipeline was FAIL."

#### Finding #10 — rework_count NaN risk (LOW, Trivial)

In §5.6, add an implementation note:
> "Implementations MUST treat absent `rework_count` as 0 for arithmetic purposes: `(rework_count ?? 0) + 1`."

Note: The current implementation in `pipeline.ts` already does this correctly (`wp.rework_count = (wp.rework_count ?? 0) + 1`), so no code change is needed — only the spec text.

#### Finding #11 — Self-healing gaps for READY/BLOCKED project status (LOW, Low effort)

**Spec change:**
1. In §10.2, add two new healing rules:

   | Current Status | Condition | Healed Status |
   |----------------|-----------|---------------|
   | `READY` | Any WP is `IN_PROGRESS` | `IN_PROGRESS` |
   | `BLOCKED` | No WPs are actually `BLOCKED` | `IN_PROGRESS` (if any WP is IN_PROGRESS) or `READY` (if any WP is READY) |

**Code change:**
2. In [mcp-server/src/tools/project-lifecycle.ts](../../../../mcp-server/src/tools/project-lifecycle.ts), in the self-healing section of `getProjectStatus`, add the two new auto-correction rules.

**Test:**
3. Add tests: project with status `READY` but WPs at `IN_PROGRESS` should heal to `IN_PROGRESS`. Project with status `BLOCKED` but no `BLOCKED` WPs should heal appropriately.

#### Finding #12 — Contradictory parenthetical in §8.6 (LOW, Trivial)

In §8.6, remove the incorrect parenthetical "(skip back to Developer)" from:
> "Dependency-blocked unreviewed WPs → `READY_FOR_DOCUMENTATION` (skip back to Developer)"

Replace with:
> "Dependency-blocked unreviewed WPs → `READY_FOR_DOCUMENTATION` (proceed forward past blocked WPs)"

## Dependencies

| Dependency | Reason |
|------------|--------|
| WP-A before WP-B | The `BLOCKED → READY` transition must be valid before temporal/next-action logic references it |
| WP-A before WP-C | The BLOCKED guard broadening in WP-C assumes the validator accepts `BLOCKED → READY` |
| WP-B and WP-C are independent | Can be parallelized |
| WP-D is independent | Spec-only text changes, can be done anytime |

## Required Components

### Modified Files

| File | Findings |
|------|----------|
| `mcp-server/docs/agents/workflow-specification.md` | #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13 (all findings update spec) |
| `mcp-server/src/schema/validators.ts` | #1 (BLOCKED → READY) |
| `mcp-server/src/tools/pipeline.ts` | #4 (role guard) |
| `mcp-server/src/tools/work-package.ts` | #5 (agent guard), #8 (depth reset on WP COMPLETE) |
| `mcp-server/src/tools/workflow-next-action.ts` | #2 (temporal comparison), #7 (BLOCKED WP guard) |
| `mcp-server/src/tools/workflow-handoff.ts` | #6 (Planner), #8 (remove project-only reset), #9 (broaden precheck), #13 (Synthesis guidance) |
| `mcp-server/src/tools/project-lifecycle.ts` | #11 (self-healing gaps) |
| `mcp-server/src/utils/workflow-helpers.ts` | #2 (new `hasNewUpstreamPassSince` helper) |

### New Files

None.

### Modified Test Files

| File | Findings |
|------|----------|
| `mcp-server/tests/schema/validators.test.ts` | #1 |
| `mcp-server/tests/tools/pipeline.test.ts` | #4 |
| `mcp-server/tests/tools/work-package.test.ts` | #5, #8 |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | #6, #8, #9, #13 |
| `mcp-server/tests/utils/workflow-helpers.test.ts` (new or extend) | #2 |
| `mcp-server/tests/tools/workflow-next-action.test.ts` (new) | #2, #7 |
| `mcp-server/tests/tools/project-lifecycle.test.ts` (extend) | #11 |

## Assumptions

- The `agent_role` parameter added to `start_pipeline` (Finding #4) is **optional** for backward compatibility. Existing callers that don't pass it will not be rejected.
- The `COMPLETE → IN_PROGRESS` role guard (Finding #5) allows "Project Manager" and "Documentation" (plus common aliases like "Documentation Agent").
- The temporal comparison for Finding #2 relies on `completed_at` and `started_at` timestamps being consistently set (which the existing spec/code already ensures).
- The auto-handoff depth reset (Finding #8) happens inside the existing `updateWorkPackageWithSync` callback, so it is atomic with the WP status change.

## Constraints

- All code changes must use `atomicWriteJson()` and `withLock()` for dual-file updates.
- Never log to `stdout`.
- Work package IDs match `/^WP-\d{3}$/`.
- Status transitions remain validated by `isValidStatusTransition()` — the only change is adding `BLOCKED → READY` as a legal transition.
- The `start_pipeline` role guard uses the existing `PIPELINE_AGENT_MAP` constant — no new constants or config.

## Out of Scope

- Changes to the persona instruction files for agent behavior guidance (these reference the spec but are generated from templates and will pick up spec compliance naturally).
- Changes to the orchestrator (Python) — it consumes MCP tools and will benefit from the fixes without code changes.
- Changes to the GUI dashboard.
- Bump of the spec version number (will be handled by the Documentation agent).
- Any changes to the Zod schemas for `RootIndex` or `WorkPackageDetail` (the `auto_handoff_depth` field and all other fields remain as-is).

## Acceptance Criteria

1. `isValidStatusTransition('BLOCKED', 'READY')` returns `true`.
2. After a Developer rework (new PASS implementation post code-review FAIL), QA's `get_next_action` returns `RUN_QA` (not WAIT).
3. `start_pipeline` with mismatched `agent_role` rejects with descriptive error.
4. `COMPLETE → IN_PROGRESS` by a Developer agent is rejected.
5. BLOCKED WPs are excluded from new-work suggestions for QA, Reviewer, and Documentation.
6. `auto_handoff_depth` resets to 0 when any WP reaches COMPLETE (not just when the project completes).
7. `get_handoff_status` for `"Planner"` returns a defined, non-generic response.
8. Mixed BLOCKED + COMPLETE state (no READY/IN_PROGRESS) returns `BLOCKED` handoff status.
9. Synthesis handoff response includes guidance to call `get_next_action` first.
10. Self-healing corrects READY → IN_PROGRESS and BLOCKED → IN_PROGRESS/READY project statuses.
11. All spec text corrections in Findings #3, #10, #12 are applied.
12. All existing tests continue to pass (`npm test` in `mcp-server/`).
13. New tests cover each behavioral change.

## Testing Strategy

- **Unit tests:** Each validator/helper change (validators.ts, workflow-helpers.ts) gets focused unit tests.
- **Tool-level tests:** Each tool behavior change (pipeline.ts, work-package.ts, workflow-next-action.ts, workflow-handoff.ts) gets tool-level tests using `createTempStore()` for isolated ledger state.
- **Integration scenario test:** Add a full rework-cycle integration test: Developer implements → QA passes → Reviewer rejects → Developer reworks → QA re-engages → Reviewer re-engages. This validates Finding #2 end-to-end.
- **Regression:** Run full `npm test` suite to ensure no existing behavior breaks.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Temporal comparison relies on consistent timestamps** | The `now()` utility and pipeline lifecycle already set `started_at`/`completed_at` consistently. Tests will validate with controlled timestamps. |
| **Optional `agent_role` on `start_pipeline` may be ignored by existing agents** | Intentionally optional for backward compat. Persona instructions can be updated later to always pass it. Once adoption is confirmed, it can be made required in a future version. |
| **Auto-handoff depth reset on WP completion may be too aggressive** | For projects with many WPs, frequent resets are actually beneficial — they prevent the stall. If needed, a minimum threshold can be added later. |
| **BLOCKED → READY transition added to validator may allow manual BLOCKED → READY transitions** | The spec explicitly limits this to auto-unblocking. Document in the transition table that manual BLOCKED transitions go to IN_PROGRESS only. The `propagateDependencyUnblock` function is the sole code path that uses BLOCKED → READY. |
| **Broadened handoff precheck (Finding #9) may route to PM when downstream agents could still work on COMPLETE WPs** | The PM can simply check and hand off to downstream agents. The BLOCKED status is informational ("there are blocked WPs that need attention") and does not prevent other agents from continuing. |
