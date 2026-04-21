# Plan

## Summary

Follow-up rework from the `2026-04-21-pm-pipeline-routing` synthesis. This plan addresses five actionable items identified during the session: extracting a shared pipeline-lookup helper to eliminate code duplication, fixing a stale JSDoc cross-reference, adding orchestrator supervisor support for the new `ROUTE_PIPELINE_AGENT` action, adding an `assigned_to` override to the `makeWp` test helper, and investigating the orchestrator's WP-guard behavior that caused a transient claim rejection during the session.

## Architectural Context

The prior plan inserted step 2b routing logic into both PM dispatch functions (`getProjectManagerHandoff()` in `workflow-handoff.ts` and `getProjectManagerAction()` in `workflow-next-action.ts`). Both functions now emit `ROUTE_PIPELINE_AGENT` signals when an IN_PROGRESS WP has a pending pipeline stage. The implementation introduced duplicated filter patterns and surfaced pre-existing debt.

Key files:

- [mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts) — PM handoff function (step 2b at lines 380–420)
- [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) — PM recommendation engine (Priority 3d at lines 475–510)
- [mcp-server/src/utils/workflow-helpers.ts](mcp-server/src/utils/workflow-helpers.ts) — Shared pipeline-state helpers (`isMostRecentPipelineFail`, `mostRecentEffectivePipeline`, etc.)
- [orchestrator/src/supervisor.py](orchestrator/src/supervisor.py) — Deterministic routing supervisor
- [orchestrator/src/utils/tool_wrappers.py](orchestrator/src/utils/tool_wrappers.py) — WP-scoped tool guards (`restrict_to_wp`)
- [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts) — Handoff test suite with `makeWp` helper

## Approach / Architecture

Five independent work items, ordered by risk (lowest first):

1. **Extract `latestNonCancelledPipeline()` helper** — Pure refactor in `workflow-helpers.ts`; callers in both PM dispatch files updated to use the shared helper.
2. **Fix stale §5.5 JSDoc** — Single-line comment fix in `workflow-handoff.ts`.
3. **Add `assigned_to` override to `makeWp` test helper** — Test-only change in `workflow-handoff.test.ts`.
4. **Add `ROUTE_PIPELINE_AGENT` to orchestrator supervisor** — Register the new action in `_DISPATCH_ACTIONS` and implement `next_agent`-based routing.
5. **Document orchestrator WP-guard behavior** — The "active work package" claim rejection originates from the orchestrator's `restrict_to_wp` guard, not from MCP server caching. Document the finding and assess whether the guard needs adjustment.

## Rationale

- **Helper extraction** eliminates 4 duplicated `filter(p => p.type === stage && !p.auto_cancelled).at(-1)` patterns. The existing `isMostRecentPipelineFail()` already performs the same filter internally — the new helper generalizes it, and `isMostRecentPipelineFail` can delegate to it.
- **JSDoc fix** is a trivial correctness fix with zero behavioral risk.
- **`makeWp` override** reduces test boilerplate and makes test intent clearer.
- **Orchestrator `ROUTE_PIPELINE_AGENT` support** is the most impactful item: without it, the new PM action is silently treated as WAIT by the supervisor (forward-compatibility fallback at line ~587), generating warning logs and preventing the supervisor from using PM-provided routing hints. Currently, the supervisor compensates because it queries each role individually — the downstream agent (QA, Reviewer, etc.) returns its own actionable signal. However, adding explicit support enables direct routing and eliminates unnecessary queries.
- **WP-guard documentation** closes the investigation recommended by the synthesis incident report.

## Detailed Steps

### Step 1: Extract `latestNonCancelledPipeline()` Helper

**File:** `mcp-server/src/utils/workflow-helpers.ts`

Add a new exported helper:

```typescript
/**
 * Returns the most recent non-auto-cancelled pipeline matching the given type,
 * or null if none exists. Equivalent to:
 *   pipelines.filter(p => p.type === type && !p.auto_cancelled).at(-1) ?? null
 */
export function latestNonCancelledPipeline(
  pipelines: Pipeline[],
  type: string
): Pipeline | null {
  return pipelines.filter((p) => p.type === type && !p.auto_cancelled).at(-1) ?? null;
}
```

**Refactor `isMostRecentPipelineFail()`** (same file) to delegate:

```typescript
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const latest = latestNonCancelledPipeline(pipelines, pipelineType);
  return latest?.status === 'FAIL';
}
```

**Update callers in `workflow-handoff.ts`** (step 2b, lines ~391–405):

Replace the two inline `filter+at(-1)` patterns:
- `const matching = wp.pipelines.filter(p => p.type === stage && !p.auto_cancelled); const mostRecent = matching.at(-1);` → `const mostRecent = latestNonCancelledPipeline(wp.pipelines, stage);`
- `const upstreamPipelines = wp.pipelines.filter(p => p.type === upstream && !p.auto_cancelled); if (upstreamPipelines.at(-1)?.status === 'IN_PROGRESS') break;` → `if (latestNonCancelledPipeline(wp.pipelines, upstream)?.status === 'IN_PROGRESS') break;`

**Update callers in `workflow-next-action.ts`** (Priority 3d, lines ~484–497):

Same two patterns:
- `const matching = wpDetail.pipelines.filter((p) => p.type === stage && !p.auto_cancelled); const mostRecent = matching.at(-1);` → `const mostRecent = latestNonCancelledPipeline(wpDetail.pipelines, stage);`
- `const upstreamPipelines = wpDetail.pipelines.filter((p) => p.type === upstream && !p.auto_cancelled); if (upstreamPipelines.at(-1)?.status === 'IN_PROGRESS') break;` → `if (latestNonCancelledPipeline(wpDetail.pipelines, upstream)?.status === 'IN_PROGRESS') break;`

**Add import** to both files: `import { latestNonCancelledPipeline } from '../utils/workflow-helpers.js';`

**Tests:** Add unit tests for `latestNonCancelledPipeline()` in the workflow-helpers test suite. Run the full test suite to confirm zero regressions (existing 1,863 tests cover the behavior).

### Step 2: Fix Stale §5.5 JSDoc Cross-Reference

**File:** `mcp-server/src/tools/workflow-handoff.ts`, line 320

Change:
```typescript
 * Get handoff status for Project Manager (§5.5)
```
To:
```typescript
 * Get handoff status for Project Manager (§13.1)
```

Scan for any other stale `§5.5` references in the source tree and correct them. (Verified: only one instance exists at this location.)

### Step 3: Add `assigned_to` Override to `makeWp` Test Helper

**File:** `mcp-server/tests/tools/workflow-handoff.test.ts`, lines 45–66

Add an optional `assignedTo` parameter to the `makeWp` helper:

```typescript
function makeWp(
  id: string,
  status: string,
  pipelines: Array<{ type: string; status: string }> = [],
  deps: string[] = [],
  assignedTo: string = 'Developer'
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: assignedTo,
    // ... rest unchanged
  };
}
```

No existing test call sites need updating — the default value preserves backward compatibility. New tests written for step 2b scenarios that need a different `assigned_to` (e.g., routing to QA after implementation PASS) can use the parameter directly instead of spreading and overriding.

### Step 4: Add `ROUTE_PIPELINE_AGENT` to Orchestrator Supervisor

**Context:** The supervisor at `orchestrator/src/supervisor.py` queries each agent role via `ledger_get_next_action` and dispatches based on the returned action. The new `ROUTE_PIPELINE_AGENT` action (returned by PM's Priority 3d) is currently unrecognized — it falls through to the forward-compatibility handler and is silently treated as WAIT (line ~587). While the supervisor compensates because it queries each role individually (the downstream agent returns its own action), this produces spurious warning logs and prevents direct routing.

**4a. Register the action**

Add `ROUTE_PIPELINE_AGENT` to `_DISPATCH_ACTIONS` in `orchestrator/src/supervisor.py`:

```python
_DISPATCH_ACTIONS: frozenset[str] = frozenset({
    # PM
    "UNBLOCK_WP", "REVIEW_REWORK_LIMIT", "REVIEW_STALE", "REVIEW_ABANDONED",
    "REPAIR_ORPHAN_BLOCKED", "ROUTE_PIPELINE_AGENT",
    # ...
})
```

**4b. Implement `next_agent` routing**

In the supervisor's dispatch loop, after extracting `action` and `wp_id`, add a special case for `ROUTE_PIPELINE_AGENT` that reads the `next_agent` field from the action response and routes to the corresponding stage destination instead of the queried role's destination:

```python
# Special case: PM's ROUTE_PIPELINE_AGENT provides an explicit
# next_agent field — route to that agent's stage, not to PM.
if action == "ROUTE_PIPELINE_AGENT":
    next_agent = action_data.get("next_agent", "")
    if next_agent and next_agent in _ROLE_STAGE_MAP:
        destination = _ROLE_STAGE_MAP[next_agent]
    # else: fall through to default destination (PM stage)
```

This block should be placed after `destination = _ROLE_STAGE_MAP.get(role)` and before the log entry emission, so that the log correctly captures the overridden destination.

**4c. Tests**

Add a test case in the orchestrator test suite that verifies:
- `ROUTE_PIPELINE_AGENT` with `next_agent: "QA"` routes to the QA stage, not PM.
- `ROUTE_PIPELINE_AGENT` with `next_agent: "Developer"` routes to the Developer stage.
- `ROUTE_PIPELINE_AGENT` with an unknown/missing `next_agent` falls back to the queried role's stage.

### Step 5: Document Orchestrator WP-Guard Behavior

**Context:** The synthesis incident report describes WP-004's claim being rejected with "active work package is WP-003" despite WP-003 being COMPLETE. Investigation reveals this error originates from the orchestrator's `restrict_to_wp` guard in `tool_wrappers.py` (lines 370–395), not from MCP server caching.

The guard is a client-side safety net that prevents cross-WP tool calls within a single stage execution. When a PM stage calls `ledger_claim_work_package` targeting WP-004, but the stage was invoked with `wp_id="WP-003"`, the guard rejects the call because it targets a different WP than the one the stage is scoped to.

**This is correct behavior for pipeline agent stages** (Developer, QA, Reviewer) which should never cross WP boundaries. However, **the PM stage is orchestrating** — it may need to claim or manipulate a different WP than the one it was dispatched for.

**5a. Document the finding**

Add a comment in `orchestrator/src/utils/tool_wrappers.py` at the `restrict_to_wp` function documenting that PM stages may legitimately need cross-WP tool calls, and this is handled by the supervisor re-dispatching with the correct `wp_id` on the next iteration.

**5b. Assess impact**

The current architecture handles this correctly: PM stages complete their pipeline work on the active WP, then return WAIT. The supervisor re-enters, queries `ledger_get_next_action`, gets the next action (now potentially `ROUTE_PIPELINE_AGENT`), and dispatches a new stage invocation with the correct `wp_id`. The transient error observed in the synthesis was likely a retry within the same stage invocation — the PM agent attempted to claim WP-004 within a stage scoped to WP-003.

No code change is required. The guard behavior is by-design and the synthesis incident was a correct rejection. Add a brief note to `orchestrator/docs/agents/project-manifest/constraints.md` documenting this invariant if the constraint is not already captured.

## Dependencies

- Steps 1–3 are independent (MCP server only) and can be parallelized.
- Step 4 depends on step 1 being merged first (so the orchestrator is tested against the final MCP server behavior), but can be developed in parallel.
- Step 5 is documentation-only and independent of all other steps.

## Required Components

- `mcp-server/src/utils/workflow-helpers.ts` — New helper function
- `mcp-server/src/tools/workflow-handoff.ts` — Caller update + JSDoc fix
- `mcp-server/src/tools/workflow-next-action.ts` — Caller update
- `mcp-server/tests/tools/workflow-handoff.test.ts` — `makeWp` parameter addition
- `mcp-server/tests/utils/workflow-helpers.test.ts` — New helper tests (if test file exists; otherwise add to appropriate test file)
- `orchestrator/src/supervisor.py` — `ROUTE_PIPELINE_AGENT` support
- `orchestrator/src/utils/tool_wrappers.py` — Documentation comment
- `orchestrator/docs/agents/project-manifest/constraints.md` — WP-guard invariant documentation
- Manifest updates: `mcp-server/docs/agents/project-manifest/api-surface.md` (new helper in §workflow-helpers)

## Assumptions

- The 4 duplicated `filter+at(-1)` patterns in step 2b are the only callers that should use the new helper. Other `filter(p => p.type === ... && !p.auto_cancelled)` patterns in the codebase (20+ instances) have different semantics (e.g., checking `.some()`, filtering by additional status, or using `.find()`) and should NOT be migrated to preserve readability.
- The orchestrator supervisor's role-iteration approach remains the primary dispatch mechanism. `ROUTE_PIPELINE_AGENT` routing is an optimization, not a correctness requirement.
- The `makeWp` helper change is backward-compatible; no existing tests use a non-default `assigned_to` value via spread override (to be verified during implementation).

## Constraints

- The `latestNonCancelledPipeline()` helper must be a pure function with no side effects (engine-layer constraint).
- The `isMostRecentPipelineFail()` delegation refactor must preserve its exact boolean semantics.
- Orchestrator changes must work on Windows, macOS, and Linux (cross-platform policy).
- The supervisor's forward-compatibility behavior for truly unknown actions must be preserved — only `ROUTE_PIPELINE_AGENT` should be added to `_DISPATCH_ACTIONS`.

## Out of Scope

- Migrating the 20+ other `filter(p => p.type === ... && !p.auto_cancelled)` patterns across the codebase to use the new helper. These have varying semantics (`.some()`, `.find()`, additional status filters) and are better left as-is.
- Refactoring the orchestrator's `restrict_to_wp` guard to exempt PM stages. The current architecture handles PM's cross-WP needs via supervisor re-dispatch.
- The upstream IN_PROGRESS guard unreachability observation (Synthesis Rec #2) — informational only, no action needed.
- The PM comment numbering convention (Synthesis Rec #4) — already resolved by the Reviewer's fix-forward in the prior session.

## Acceptance Criteria

- `latestNonCancelledPipeline()` is exported from `workflow-helpers.ts` and used in all 4 step-2b call sites.
- `isMostRecentPipelineFail()` delegates to the new helper with identical behavior.
- The `§5.5` JSDoc reference is corrected to `§13.1`.
- `makeWp` in `workflow-handoff.test.ts` accepts an optional `assignedTo` parameter defaulting to `'Developer'`.
- The orchestrator supervisor recognizes `ROUTE_PIPELINE_AGENT` and routes to the `next_agent`'s stage destination.
- No warning logs are emitted for `ROUTE_PIPELINE_AGENT` actions in the supervisor.
- The orchestrator WP-guard behavior is documented in constraints or code comments.
- All 1,863+ existing tests pass with zero regressions.
- New unit tests cover `latestNonCancelledPipeline()` and the supervisor's `ROUTE_PIPELINE_AGENT` routing.

## Testing Strategy

- **Unit tests:** New tests for `latestNonCancelledPipeline()` covering: empty pipelines, single match, multiple matches (returns last), auto-cancelled exclusion, no match for type, mixed statuses.
- **Regression tests:** Full MCP server test suite (1,863 tests) must pass after the refactor. The `isMostRecentPipelineFail` delegation is covered by existing tests.
- **Orchestrator tests:** New test for supervisor routing with `ROUTE_PIPELINE_AGENT` action.
- **Integration verification:** After merging, run a test orchestrator session to confirm `ROUTE_PIPELINE_AGENT` flows correctly through the supervisor without warnings.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`isMostRecentPipelineFail` delegation changes semantics** | The refactored implementation is `latest?.status === 'FAIL'` which is identical to `matching.at(-1)!.status === 'FAIL'` when `matching.length > 0`. The `length === 0` early return maps to `latest === null`, which yields `null?.status === 'FAIL'` → `false`. Semantics are preserved. Existing 1,863 tests provide safety net. |
| **Orchestrator `ROUTE_PIPELINE_AGENT` routing to wrong stage** | The `next_agent` value comes from `PIPELINE_AGENT_MAP[stage]` in the MCP server, which maps to canonical role names. The supervisor's `_ROLE_STAGE_MAP` uses the same canonical names. Fallback to queried-role destination prevents breakage if `next_agent` is unexpected. |
| **`makeWp` default parameter breaks existing test calls** | Default value `'Developer'` matches the current hardcoded value. No existing call site is affected. |
| **Other callers of `filter+at(-1)` pattern are missed** | The 4 locations are specifically the step-2b blocks added in the prior session. Grep confirmed no other callers use the exact same pattern with `.at(-1)`. Other patterns use `.some()`, `.find()`, or check additional conditions. |
