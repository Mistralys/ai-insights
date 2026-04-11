# Plan

## Summary

Fix the systematic auto-handoff failure caused by 4 out of 7 per-role handoff handlers in `workflow-handoff.ts` not filtering work packages by `active_pipeline_stages`. This allows non-applicable WPs (e.g., documentation-only WPs visible to the Developer handler) to falsely return `IN_PROGRESS`, suppressing the `auto_handoff` block and stalling the entire workflow. A secondary fix corrects PM routing for unassigned READY WPs. All changes align with Workflow Specification v2.4.2 §13.1 and §21.69.

## Architectural Context

- **Handoff system:** `mcp-server/src/tools/workflow-handoff.ts` — 7 per-role handler functions dispatched via the `HANDOFF_DISPATCH` map. Each determines the `READY_FOR_*` / `IN_PROGRESS` / `WAIT` status for its agent.
- **Recommendation engine:** `mcp-server/src/tools/workflow-next-action.ts` — 6 per-role action functions that already correctly filter WPs by `active_pipeline_stages` before determining actions (the reference pattern).
- **Pipeline maps:** `mcp-server/src/utils/pipeline-maps.ts` — `DEFAULT_PIPELINE_STAGES`, `PIPELINE_AGENT_MAP`, `firstActiveStage()`, `resolvePrerequisite()`.
- **Auto-handoff eligibility (§18.6):** The `auto_handoff` block is only generated for `READY_FOR_*` statuses — `IN_PROGRESS`, `COMPLETE`, `BLOCKED`, and `WAIT` are excluded.
- **Correct pattern (already in codebase):** `getSecurityAuditorHandoff` and `getReleaseEngineerHandoff` filter WPs via `active_pipeline_stages.includes('<pipeline-type>')` before any pipeline-specific logic. This is the pattern to replicate.
- **Test suite:** `mcp-server/tests/integration/auto-handoff.test.ts` — `makeWp()` helper does not currently accept `active_pipeline_stages`. No mixed-composition test coverage exists.
- **Specification authority:** §13.1 pseudocode uses `with "<pipeline-type>" in activeStages` for all pipeline-specific conditions. §21.69 declares this an invariant.

## Approach / Architecture

Replicate the established scope-filtering pattern from `getSecurityAuditorHandoff` / `getReleaseEngineerHandoff` into the 4 affected handlers (Developer, QA, Reviewer, Documentation). Each handler will split its WP processing into:

1. **Unscoped checks** — terminal check, `assigned_to` check (apply to ALL WPs, per spec)
2. **Scoped checks** — pipeline-specific FAIL/PASS/progress checks (apply only to WPs with the handler's pipeline type in `active_pipeline_stages`)

The PM handler gets a targeted fix: unassigned READY WPs route via `PIPELINE_AGENT_MAP[firstActiveStage(wp)]` instead of hardcoded `READY_FOR_DEVELOPER`.

## Rationale

- The fix mirrors an existing, proven pattern in the same file (Security Auditor + Release Engineer handlers), minimizing design risk.
- The fix aligns with the specification verbatim (§13.1 pseudocode already includes the scoping statements).
- The `workflow-next-action.ts` action functions already implement this filtering — the handoff handlers are the only source of the mismatch.
- Mixed-composition WPs (`active_pipeline_stages` with non-default stages) are an existing feature already tested at the pipeline level (`full-workflow.test.ts`) but not at the handoff level.

## Detailed Steps

### Step 1: Extend `makeWp` test helper

In `mcp-server/tests/integration/auto-handoff.test.ts`, add an optional `active_pipeline_stages` parameter to the `makeWp` helper function. When omitted, the field should be absent from the returned object (preserving backward compatibility; the handlers will then use `?? DEFAULT_PIPELINE_STAGES` to resolve it, consistent with the convention established by the Security Auditor and Release Engineer handlers).

### Step 2: Fix `getDeveloperHandoff` (lines ~396–510)

**Specification ref:** §13.1 Developer Handoff — "Only considers non-terminal WPs that include `implementation` in their `active_pipeline_stages` for pipeline-specific conditions."

**Changes:**
1. After the terminal-check early exit (unscoped, applies to all WPs — correct as-is), add a scope filter for pipeline-specific logic:
   ```
   const implWps = wpDetails.filter(wp =>
     (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES)
     .includes('implementation')
   );
   ```
2. Replace `activeWps` with `activeWps` filtered from `implWps` (not `wpDetails`) in the temporal-guarded FAIL check.
3. Replace `nonBlockedWps` with a filtered set derived from `implWps` (not `wpDetails`) for `allImplemented` and `needsWork` checks.
4. Keep the terminal-check early exit and the fallback `READY_FOR_QA` using ALL `wpDetails` (unscoped, per spec).

### Step 3: Fix `getQaHandoff` (lines ~520–700)

**Specification ref:** §13.1 QA Handoff — "Only considers non-terminal WPs that include `qa` in their `active_pipeline_stages` for pipeline-specific conditions."

**Changes:**
1. After the terminal-check early exit (unscoped — correct), add a scope filter:
   ```
   const qaWps = wpDetails.filter(wp =>
     (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES)
     .includes('qa')
   );
   ```
2. Re-engagement check (Step 1 of §5.2): iterate `qaWps` instead of `wpDetails`.
3. `wpsWithImpl`, `wpsStillNeedingImpl`: derive from `qaWps` instead of `wpDetails`.
4. `wpsNeedingNewQa`, `wpsWithQaInProgress`, `wpsWithQaFail`: derive from `wpsWithImpl` (already filtered through `qaWps`).
5. Keep terminal check and final fallback using ALL `wpDetails`.

### Step 4: Fix `getReviewerHandoff` (lines ~820–1000)

**Specification ref:** §13.1 Reviewer Handoff — "Only considers non-terminal WPs that include `code-review` in their `active_pipeline_stages` for pipeline-specific conditions."

**Changes:**
1. After the terminal-check early exit (unscoped — correct), add a scope filter:
   ```
   const reviewWps = wpDetails.filter(wp =>
     (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES)
     .includes('code-review')
   );
   ```
2. Re-engagement check (Step 1 of §5.3): iterate `reviewWps` instead of `wpDetails`. (Note: the `resolvePrerequisite` call on `wp.active_pipeline_stages` is already correct here.)
3. `wpsWithQa`, `wpsNotYetQaPassed`: derive from `reviewWps` instead of `wpDetails`.
4. All downstream pipeline checks: derive from the scoped set.
5. Keep terminal check and final fallback using ALL `wpDetails`.

### Step 5: Fix `getDocumentationHandoff` (lines ~1060–1230)

**Specification ref:** §13.1 Documentation Handoff — "Only considers non-terminal WPs that include `documentation` in their `active_pipeline_stages` for pipeline-specific conditions."

**Changes:**
1. Add a scope filter at the top of the function:
   ```
   const docWps = wpDetails.filter(wp =>
     (wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES)
     .includes('documentation')
   );
   ```
2. `wpsWithReview`: derive from `docWps` instead of `wpDetails`. **However**, per spec §13.1 (null-prerequisite rule), when `resolvePrerequisite("documentation", wp.active_pipeline_stages)` returns `null` (documentation is the first/only active stage), `hasPassEffectiveUpstream` is vacuously true. This means documentation-only WPs (`active_pipeline_stages: ["documentation"]`) should match the "ready for docs" condition without requiring a code-review PASS. The current filtering by `code-review PASS` must be replaced with dynamic upstream resolution:
   - Compute `effectiveUpstream = resolvePrerequisite("documentation", wp.active_pipeline_stages)`.
   - When `effectiveUpstream` is not null: check for PASS of that type.
   - When `effectiveUpstream` is null: vacuously true (no prerequisite needed).
3. `wpsNotYetReviewed`: derive from `docWps`, applying the same dynamic upstream logic.
4. Keep terminal check using ALL `wpDetails`.

### Step 6: Fix `getProjectManagerHandoff` PM routing

**Specification ref:** §13.1 Project Manager Handoff — "Unassigned: route to the agent owning the WP's first active stage."

**Changes:**
1. In the Step 2 block (READY WPs), split the routing for assigned vs. unassigned WPs:
   ```typescript
   // Current (bug):
   const status = readyStatusForAgent(wp.assigned_to ?? null);
   
   // Fixed (per spec):
   const status = wp.assigned_to
     ? readyStatusForAgent(wp.assigned_to)
     : readyStatusForAgent(
         PIPELINE_AGENT_MAP[firstActiveStage(
           wp.active_pipeline_stages as PipelineType[] | undefined ?? null
         )]
       );
   ```
2. Import `firstActiveStage` and `PIPELINE_AGENT_MAP` (already imported: `DEFAULT_PIPELINE_STAGES` and `resolvePrerequisite`; check if `firstActiveStage` and `PIPELINE_AGENT_MAP` need adding to the import).

### Step 7: Add mixed-composition test cases

Add a new `describe` block in `mcp-server/tests/integration/auto-handoff.test.ts` for mixed-composition handoff tests. Minimum test cases:

1. **Developer handoff with impl-passed WP + documentation-only WP**  
   - WP-001: `active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation']`, impl PASS  
   - WP-002: `active_pipeline_stages: ['documentation']`, no pipelines  
   - Expected: `READY_FOR_QA` (not `IN_PROGRESS`)

2. **QA handoff with QA-passed WP + documentation-only WP**  
   - WP-001: impl PASS, qa PASS, `active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation']`  
   - WP-002: `active_pipeline_stages: ['documentation']`, no pipelines  
   - Expected: `READY_FOR_REVIEW` (not `IN_PROGRESS`)

3. **Reviewer handoff with review-passed WP + documentation-only WP**  
   - WP-001: impl PASS, qa PASS, code-review PASS, `active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation']`  
   - WP-002: `active_pipeline_stages: ['documentation']`, no pipelines  
   - Expected: `READY_FOR_DOCUMENTATION` (not `IN_PROGRESS`)

4. **Documentation handoff with documentation-only WP (no code-review required)**  
   - WP-001: `active_pipeline_stages: ['documentation']`, no pipelines  
   - Expected: `IN_PROGRESS` (docs work available — not `WAIT`)

5. **PM routing for unassigned documentation-only WP**  
   - WP-001: status `READY`, `assigned_to: null`, `active_pipeline_stages: ['documentation']`  
   - Expected: `READY_FOR_DOCS` (not `READY_FOR_DEVELOPER`)

6. **Full cycle regression: WP with all default stages + WP with documentation-only**  
   - Walk through impl PASS → auto_handoff fires `READY_FOR_QA` → qa PASS → `READY_FOR_REVIEW` → etc.  
   - Verify the documentation-only WP does not interfere at any stage.

7. **Legacy WP without `active_pipeline_stages` field**  
   - WP with no `active_pipeline_stages` set (undefined)  
   - Verify it falls through to `DEFAULT_PIPELINE_STAGES` and behaves identically to current behavior.

### Step 8: Run tests and verify

Run the full test suite (`npm test` in `mcp-server/`) to verify:
- All new tests pass.
- No existing tests regress (the `?? DEFAULT_PIPELINE_STAGES` fallback preserves backward compatibility).
- TypeScript compiles cleanly (`npm run build` in `mcp-server/`).

## Dependencies

- `firstActiveStage` and `PIPELINE_AGENT_MAP` — already exported from `mcp-server/src/utils/pipeline-maps.ts` (need to be added to import in `workflow-handoff.ts` if not already imported).
- `resolvePrerequisite` — already imported in `workflow-handoff.ts`.
- `DEFAULT_PIPELINE_STAGES` — already imported in `workflow-handoff.ts`.

## Required Components

- `mcp-server/src/tools/workflow-handoff.ts` — primary fix target (4 handler functions + PM routing)
- `mcp-server/tests/integration/auto-handoff.test.ts` — test updates (helper extension + new test cases)
- `mcp-server/src/utils/pipeline-maps.ts` — no changes needed, only imports consumed

## Assumptions

- The Workflow Specification v2.4.2 §13.1 pseudocode is the authoritative source of truth. The implementation is being aligned _to_ the spec, not the reverse.
- `active_pipeline_stages` may be `undefined` on legacy WPs; the `?? DEFAULT_PIPELINE_STAGES` fallback is the established convention (used by Security Auditor, Release Engineer, and all `workflow-next-action.ts` functions).
- The `WorkPackageDetail` type already includes `active_pipeline_stages` as an optional field (used by existing handlers).

## Constraints

- Must not change any behavior for WPs that use the default `active_pipeline_stages` (backward compatibility).
- Must not modify `workflow-next-action.ts` — it is already correct.
- Must not modify the workflow specification — it is already updated to v2.4.2.
- Cross-platform: no platform-specific code involved (pure logic changes).

## Out of Scope

- Fixing the orchestrator's Python implementation of the same handoff logic (separate task).
- Adding auto-cancellation or other pipeline lifecycle changes.
- Refactoring the handoff handlers into a shared abstraction (unnecessary — the pattern is clear enough to apply directly).
- Changes to `buildHandoffResponse` or auto-handoff depth mechanics (confirmed correct in the research).

## Acceptance Criteria

- All 4 affected handoff handlers (Developer, QA, Reviewer, Documentation) scope their pipeline-specific conditions to WPs with the handler's pipeline type in `active_pipeline_stages`, per §13.1 and §21.69.
- PM routing for unassigned READY WPs uses `firstActiveStage(wp)` to determine the target agent, per §13.1 PM Handoff pseudocode.
- A project with mixed-composition WPs (e.g., one full-pipeline WP + one documentation-only WP) produces correct `READY_FOR_*` handoff statuses at every stage transition.
- The `auto_handoff` block is generated when the handoff status is `READY_FOR_*` (no longer suppressed by false `IN_PROGRESS` returns).
- All existing tests pass without modification (backward compatibility via `?? DEFAULT_PIPELINE_STAGES`).
- New test cases cover all 7 scenarios listed in Step 7.

## Testing Strategy

- **Unit/integration tests:** Extend `auto-handoff.test.ts` with a dedicated mixed-composition describe block (7+ test cases).
- **Regression:** Full `npm test` in `mcp-server/` verifies no existing behavior changes.
- **Build verification:** `npm run build` in `mcp-server/` confirms TypeScript compilation.
- **Manual validation (optional):** Re-run the failing project (`2026-04-07-cross-platform-agent-plugin-phase-3b`) after the fix and verify auto-handoff fires correctly.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Scoping filter breaks handlers that rely on full WP set** | Terminal check and `assigned_to` fallback remain unscoped (per spec). Only pipeline-specific conditions are scoped. |
| **Documentation null-prerequisite not properly handled** | Use `resolvePrerequisite()` + vacuously-true logic, matching the spec §13.1 pseudocode and the existing `canStartPipeline` (§8.2) behavior. |
| **Legacy WPs without `active_pipeline_stages` field** | `?? DEFAULT_PIPELINE_STAGES` fallback ensures identical behavior to today. Regression test in Step 7 case 7. |
| **PM routing change breaks assigned WPs** | The change only affects `wp.assigned_to === null` path; assigned WPs continue using `readyStatusForAgent(wp.assigned_to)` unchanged. |
