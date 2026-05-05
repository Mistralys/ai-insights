# Plan

## Summary

Fix the IDE workflow stall caused by five handoff functions (QA, Security Auditor, Reviewer, Release Engineer, Documentation) returning bare `WAIT` when their role-specific work is done but other READY work packages exist that haven't started any pipelines yet. Also fix the Synthesis handoff spec–code divergence (`WAIT` in spec vs. `COMPLETE` in code). All changes follow the specification-first workflow: spec → implementation → tests → constraints.

## Architectural Context

The handoff system lives in `mcp-server/src/tools/workflow-handoff.ts` (~1,250 lines). Nine per-agent handoff functions are registered in `HANDOFF_DISPATCH` and invoked by `getHandoffStatus()`. Each function receives `wpDetails: WorkPackageDetail[]` plus optional `projectPath` and `store`, and returns a `HandoffResult` via `buildHandoffResponse()`.

**Key existing patterns:**
- **PM handoff** (`getProjectManagerHandoff`, lines 408–507) already implements cross-WP dispatch: Step 2 routes READY WPs to the agent owning their first active pipeline stage via `PIPELINE_AGENT_MAP[firstActiveStage(wp)]`. Step 2b scans IN_PROGRESS WPs for pending stages. Step 3 detects all-terminal → `READY_FOR_SYNTHESIS`.
- **QA/Reviewer** handoff functions include a `partitionWpsAwaitingNextStage()` step that handles mixed-routing (multiple distinct next agents across WPs) by returning `WAIT` with a descriptive message.
- **Release Engineer/Documentation** handoff functions have a simpler structure: ready-for-work → FAIL self-rework → all-terminal → `WAIT`.

**Relevant helpers** (all already exist):
- `isTerminalStatus()` — `schema/validators.ts`
- `isBlockedByDependencies()` — `utils/workflow-helpers.ts`
- `firstActiveStage()` — `utils/pipeline-maps.ts`
- `PIPELINE_AGENT_MAP` — `utils/pipeline-maps.ts`
- `READY_STATUS_FOR_ROLE` — `utils/constants.ts`
- `scopeToStage()` — `utils/pipeline-maps.ts` (imported into `workflow-handoff.ts`)

**Specification:** The workflow specification lives in `mcp-server/docs/agents/workflow-specification/`, with handoff logic in `handoff.md` (§13.1). The spec uses named section headers (e.g., "QA Handoff", "Documentation Handoff") rather than numbered sub-sections.

**Tests:** `tests/tools/workflow-handoff.test.ts` (~2,930 lines, 90+ test cases) and `tests/integration/auto-handoff.test.ts` (~1,400 lines, 34+ test cases). Fixtures use a `makeWp()` helper for inline construction.

## Approach / Architecture

### A. Shared cross-WP dispatch helper

Extract a `findNextReadyDispatch()` function that encapsulates the PM's Step 2 / Step 3 pattern into a reusable tail block. This function:

1. Finds READY WPs whose dependencies are satisfied and routes to the agent owning the first active pipeline stage.
2. If all WPs are terminal, returns `READY_FOR_SYNTHESIS`.
3. Otherwise returns `null` (no deterministic dispatch → caller falls through to `WAIT`).

The helper is called as the **penultimate step** in each of the five affected handoff functions, just before the final `WAIT` return. This is purely additive — the existing priority order within each function is unchanged.

### B. Synthesis spec fix

Update the Synthesis Handoff pseudocode in `handoff.md` from `return WAIT` to `return COMPLETE`, matching the existing implementation.

### C. Edge case documentation

Add a new edge case to `edge-cases.md` documenting the cross-WP dispatch pattern and the mixed-routing `WAIT` safety net.

## Rationale

- **Spec-first:** AGENTS.md mandates workflow logic changes follow: spec → implementation → tests → constraints. Every code change has a corresponding spec change preceding it.
- **Reuse PM pattern:** The PM handoff already solves this exact problem. Extracting the logic into a shared helper avoids duplication and ensures consistency.
- **Additive, not destructive:** `WAIT` remains a valid status for genuinely unclassifiable states. The helper is inserted before the `WAIT` return, not replacing it.
- **No orchestrator changes:** The orchestrator already handles `WAIT` via its supervisor polling loop. This fix is IDE-only by design.
- **No constants changes:** `READY_FOR_SYNTHESIS` and all `READY_STATUS_FOR_ROLE` entries already exist.

## Detailed Steps

### Step 1: Update workflow specification — cross-WP dispatch

**File:** `mcp-server/docs/agents/workflow-specification/handoff.md`

Add a cross-WP dispatch step to each of the five affected handoff pseudocode blocks. Insert before the final `return WAIT` in each:

```pseudocode
// Cross-WP dispatch: if a READY WP exists whose dependencies are satisfied,
// route to the agent owning its first active pipeline stage.
// This prevents IDE workflow stalls when this agent's role-specific work is
// complete but other WPs need pipeline bootstrapping.
dispatch = findNextReadyDispatch(allWPs, currentRole)
if dispatch:
  return dispatch.status
```

Affected sections:
- **QA Handoff** — insert between `assigned_to` IN_PROGRESS check and final `return WAIT`
- **Security Auditor Handoff** — insert between `assigned_to` IN_PROGRESS check and final `return WAIT`
- **Reviewer Handoff** — insert between `assigned_to` IN_PROGRESS check and final `return WAIT`
- **Release Engineer Handoff** — insert between `all WPs terminal` check and final `return WAIT`
- **Documentation Handoff** — insert between `all WPs terminal` check and final `return WAIT`

### Step 2: Update workflow specification — Synthesis COMPLETE fix

**File:** `mcp-server/docs/agents/workflow-specification/handoff.md`

In the **Synthesis Handoff** section, change:
```pseudocode
return WAIT   // Chain terminates
```
to:
```pseudocode
return COMPLETE   // Chain terminates
```

Update the design note accordingly to reference `COMPLETE` instead of `WAIT`.

### Step 3: Add helper algorithm to spec

**File:** `mcp-server/docs/agents/workflow-specification/handoff.md`

Add a new subsection (e.g., §13.5 or append after §13.4) documenting the `findNextReadyDispatch` algorithm:

```pseudocode
function findNextReadyDispatch(allWPs, currentRole):
  // Step 1: Route to agent owning the first active pipeline stage of a READY WP.
  readyWPs = allWPs where status == "READY" AND NOT isBlockedByDependencies(wp)
  if readyWPs is not empty:
    wp = readyWPs[0]
    stages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
    stage = firstActiveStage(stages)
    targetRole = PIPELINE_AGENT_MAP[stage]
    // Self-routing is intentional: even if targetRole == currentRole,
    // return the dispatch so the IDE visibly starts a new handoff step.
    return { status: readyStatusForAgent[targetRole],
             reason: "{wp.id} is READY; routing to {targetRole} for {stage}." }

  // Step 2: All WPs terminal → READY_FOR_SYNTHESIS.
  if allWPs is not empty AND allWPs.every(wp => isTerminalStatus(wp.status)):
    return { status: "READY_FOR_SYNTHESIS",
             reason: "All work packages are terminal." }

  // No deterministic dispatch.
  return null
```

**Self-routing design decision:** The helper does NOT filter out `targetRole === currentRole`. Self-routing is allowed intentionally — it causes the IDE to visibly declare a new handoff step, making it explicit that a fresh work package is being bootstrapped even when the same agent continues. This improves auditability and keeps the orchestrator and IDE behaviors aligned (the orchestrator's supervisor loop already re-dispatches to the same stage actor when appropriate).

Note: The all-terminal check in the helper is a safety net for handoff functions that position the cross-WP dispatch step after their own all-terminal check. For functions where cross-WP dispatch is inserted before the all-terminal check (QA, Security Auditor, Reviewer), this provides redundancy. For functions where it's inserted after (Release Engineer, Documentation), the function's own all-terminal check fires first.

### Step 4: Add edge case to spec

**File:** `mcp-server/docs/agents/workflow-specification/edge-cases.md`

Add a new edge case (next available number, likely §21.7x) documenting:

- **Scenario:** Non-PM agent completes final pipeline stage of WP-001. WP-002 is READY with zero pipelines. Without cross-WP dispatch, the handoff returns `WAIT` and the IDE workflow stalls.
- **Resolution:** `findNextReadyDispatch()` detects WP-002 as READY and routes to the agent owning its first active pipeline stage.
- **Self-routing:** If WP-002's first active stage maps back to the calling agent's role, the dispatch still fires (no self-filter). This ensures the IDE visibly declares the new step rather than silently continuing.
- **Invariant:** Cross-WP dispatch is a best-effort optimization for IDE runners. The orchestrator does not depend on it.

### Step 5: Implement `findNextReadyDispatch` helper

**File:** `mcp-server/src/tools/workflow-handoff.ts`

Create the helper function near the existing `partitionWpsAwaitingNextStage()` helper (around line 363). The function takes `wpDetails: WorkPackageDetail[]` and `currentRole: string` and returns `{ status: string; reason: string } | null`.

Use existing helpers: `isTerminalStatus()`, `isBlockedByDependencies()`, `firstActiveStage()`, `PIPELINE_AGENT_MAP`, `READY_STATUS_FOR_ROLE`.

**Self-routing:** The helper does NOT skip cases where `targetRole === currentRole`. The `currentRole` parameter is retained for logging/debugging purposes in the `reason` string but is not used as a filter.

### Step 6: Apply helper in five handoff functions

**File:** `mcp-server/src/tools/workflow-handoff.ts`

Insert `findNextReadyDispatch()` call as the penultimate step before each `WAIT` return:

| Function | Insert before line | Current WAIT message |
|----------|--------------------|----------------------|
| `getQaHandoff` | ~805 | "No actionable work for QA." |
| `getSecurityAuditorHandoff` | ~938 | "No actionable work for Security Auditor." |
| `getReviewerHandoff` | ~1032 | "No actionable work for Reviewer." |
| `getReleaseEngineerHandoff` | ~1088 | "Release engineering complete or awaiting code review." |
| `getDocumentationHandoff` | ~1178 | "No actionable documentation work." |

Each insertion follows the same pattern:
```typescript
const dispatch = findNextReadyDispatch(wpDetails, '<RoleName>');
if (dispatch) {
  return buildHandoffResponse(
    '<RoleName>', dispatch.status, dispatch.reason,
    undefined, projectPath, store
  );
}
```

### Step 7: Fix Synthesis implementation (if needed)

**File:** `mcp-server/src/tools/workflow-handoff.ts`

Verify the inline Synthesis handler at line ~53 already returns `COMPLETE`. Per research, it does — no code change needed. The spec-only fix in Step 2 aligns the spec to the existing code.

### Step 8: Add regression tests

**File:** `mcp-server/tests/tools/workflow-handoff.test.ts`

Add a new `describe` block: **"Cross-WP dispatch from non-PM agents"** with test cases for:

1. **Documentation → READY WP dispatch:** WP-001 COMPLETE (all stages PASS), WP-002 READY (no explicit `active_pipeline_stages` → uses `DEFAULT_PIPELINE_STAGES`). Assert `getDocumentationHandoff` returns `READY_FOR_DEVELOPER` (WP-002's first active stage defaults to `implementation`).

2. **Documentation → READY_FOR_SYNTHESIS:** All WPs COMPLETE. Assert returns `READY_FOR_SYNTHESIS`.

3. **Documentation → WAIT (dependency-blocked):** WP-001 COMPLETE, WP-002 READY but dependency-blocked. Assert returns `WAIT`.

4. **QA → READY WP dispatch:** Same WP-001 COMPLETE / WP-002 READY pattern. Assert `getQaHandoff` returns `READY_FOR_DEVELOPER`.

5. **Security Auditor → READY WP dispatch:** Same pattern. Assert `getSecurityAuditorHandoff` returns `READY_FOR_DEVELOPER`.

6. **Reviewer → READY WP dispatch:** Same pattern. Assert `getReviewerHandoff` returns `READY_FOR_DEVELOPER`.

7. **Release Engineer → READY WP dispatch:** Same pattern. Assert `getReleaseEngineerHandoff` returns `READY_FOR_DEVELOPER`.

8. **Custom active_pipeline_stages:** WP-002 READY with `active_pipeline_stages: ["qa", "code-review"]`. Assert dispatch routes to `READY_FOR_QA` (first active stage is `qa`).

9. **Self-routing (same role):** WP-001 COMPLETE, WP-002 READY with `active_pipeline_stages: ["documentation"]`. Call `getDocumentationHandoff`. Assert returns `READY_FOR_DOCUMENTATION` (self-routing is allowed — the helper does not filter `targetRole === currentRole`).

### Step 9: Update constraints.md

**File:** `mcp-server/docs/agents/project-manifest/constraints.md`

Add a new constraint (next available number):

> **Constraint N — Cross-WP Dispatch Before WAIT:**
> Non-PM handoff functions (QA, Security Auditor, Reviewer, Release Engineer, Documentation) MUST attempt cross-WP dispatch via `findNextReadyDispatch()` before returning `WAIT`. This ensures IDE runners receive an `auto_handoff` payload when deterministic routing is possible, preventing workflow stalls.

### Step 10: Update api-surface.md

**File:** `mcp-server/docs/agents/project-manifest/api-surface.md`

Add `findNextReadyDispatch()` to the workflow-handoff module's function list with its signature.

## Dependencies

- Step 5 depends on Steps 1–4 (spec must be written first)
- Step 6 depends on Step 5 (helper must exist before applying it)
- Step 8 depends on Step 6 (tests validate the implementation)
- Steps 9–10 depend on Step 6 (manifest updates reflect final implementation)

## Required Components

- `mcp-server/docs/agents/workflow-specification/handoff.md` — spec update (Steps 1–3)
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` — new edge case (Step 4)
- `mcp-server/src/tools/workflow-handoff.ts` — helper + 5 insertion points (Steps 5–6)
- `mcp-server/tests/tools/workflow-handoff.test.ts` — regression tests (Step 8)
- `mcp-server/docs/agents/project-manifest/constraints.md` — new constraint (Step 9)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — new function entry (Step 10)

All files exist. No new files or directories are needed.

## Assumptions

- The `firstActiveStage()` function returns the correct first stage when given `active_pipeline_stages` or defaults to `DEFAULT_PIPELINE_STAGES`. Verified in `pipeline-maps.ts`.
- `READY_STATUS_FOR_ROLE` maps all agent roles correctly. Verified in `constants.ts`.
- The `buildHandoffResponse` function can attach `auto_handoff` for any status in `HANDOFF_STATUS_ROLE` (which includes all `READY_FOR_*` statuses). Verified in `workflow-handoff.ts` lines 138–186.
- The existing `partitionWpsAwaitingNextStage()` in QA/Reviewer/Security Auditor handles within-WP routing (PASS stage → next stage). The new cross-WP dispatch handles between-WP routing (done with current WP → route to next WP). These are orthogonal.

## Constraints

- Spec-first workflow: all spec changes (Steps 1–4) must be completed before implementation (Steps 5–7).
- No orchestrator changes. The orchestrator is explicitly out of scope.
- No `buildHandoffResponse` refactoring. Classification logic stays in per-role handoff functions.
- No changes to `WAIT` semantics. `WAIT` remains valid as a safety net.
- No changes to constants or enums. All required values already exist.
- Cross-platform: no OS-specific considerations for these changes.

## Out of Scope

- Orchestrator supervisor routing changes (already handles `WAIT` correctly).
- Eliminating `WAIT` as a status (valid signal, just misused in these five functions).
- `buildHandoffResponse` refactoring (wrong locus for classification logic).
- `WAIT_FOR_*` action-ladder changes in `workflow-next-action.ts`.
- `embedHandoffStatusInWait` changes (diagnostic, not routing).
- PM handoff changes (already correct).
- Developer handoff changes (never falls through to `WAIT`).

## Acceptance Criteria

- After Documentation completes WP-001's final stage, if WP-002 is READY with zero pipelines, `getDocumentationHandoff` returns a `READY_FOR_*` status (not `WAIT`) with a populated `auto_handoff` block.
- Same behavior for QA, Security Auditor, Reviewer, and Release Engineer handoff functions.
- When all WPs are terminal, all five functions return `READY_FOR_SYNTHESIS`.
- When the only READY WPs are dependency-blocked, functions return `WAIT` (no false dispatch).
- The Synthesis Handoff spec says `return COMPLETE`, matching the code.
- All existing tests continue to pass (no regressions).
- New regression tests cover the cross-WP dispatch path for all five affected roles.

## Testing Strategy

- **Unit tests** in `workflow-handoff.test.ts`: Test `findNextReadyDispatch()` directly with various WP configurations (READY, terminal, dependency-blocked, custom active stages).
- **Integration tests** in `workflow-handoff.test.ts`: Test each of the five affected handoff functions with the originating bug scenario (WP-001 COMPLETE, WP-002 READY, zero pipelines).
- **Regression guard**: Verify existing tests pass unchanged — the cross-WP dispatch is additive and should not alter any existing return path.
- **Run full test suite**: `cd mcp-server && npm test` to verify no cross-contamination.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Cross-WP dispatch fires when within-WP routing should take priority** | The helper is inserted as the *penultimate* step, after all role-specific checks. Existing priority order is unchanged. |
| **Mixed-routing scenario: multiple READY WPs route to different agents** | The helper routes to `readyWPs[0]` — first READY WP wins. This is consistent with PM Step 2 behavior. The orchestrator's per-role polling handles the remaining WPs. |
| **Dependency-blocked READY WPs cause false dispatch** | The helper explicitly filters `isBlockedByDependencies(wp)`. Blocked WPs are excluded. |
| **Synthesis spec change misinterpreted** | The code already returns `COMPLETE`; this is a spec-to-code alignment, not a behavior change. |
| **Test fragility from line-number shifts** | New code is inserted at the end of each function (before final `WAIT`). No existing code is moved or restructured. |
