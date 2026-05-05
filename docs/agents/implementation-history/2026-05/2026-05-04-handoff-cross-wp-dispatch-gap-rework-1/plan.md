# Plan

## Summary

Follow-up rework addressing the five actionable strategic recommendations
from the `2026-05-04-handoff-cross-wp-dispatch-gap` synthesis. Verification
against the codebase confirmed four of the five items; one (test comment
precision) was found to already be accurate and is dropped. An additional
defect was discovered during verification: `getDocumentationHandoff` is
missing the `.length > 0` guard on its all-terminal early-exit, making it
the only handoff function that would return `READY_FOR_SYNTHESIS` on an
empty `wpDetails` array.

## Architectural Context

### Handoff Functions (`mcp-server/src/tools/workflow-handoff.ts`)

Nine exported handoff functions implement per-role routing logic. Five of
them (`getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`,
`getReleaseEngineerHandoff`, `getDocumentationHandoff`) were updated in
the parent session to add cross-WP dispatch via `findNextReadyDispatch()`.

All five have an "all-terminal early-exit" guard that returns
`READY_FOR_SYNTHESIS` when every WP is in a terminal state. Four use
`wpDetails.every()` (all WPs); one (`getReleaseEngineerHandoff`) uses
`releaseWps.every()` (scoped to release-stage WPs only). The spec
(`handoff.md` §13.1) documents this asymmetry as a MAY-fix.

### API Surface Documentation (`mcp-server/docs/agents/project-manifest/api-surface.md`)

Documents public MCP tool signatures but is missing many exported internal
helpers: all eight per-role handoff functions, `buildHandoffResponse`,
`nextAgentFromStatus`, `computeHandoffStatus`, plus numerous exports from
`workflow-helpers.ts`, `pipeline-maps.ts`, and `project-reset.ts`.

### Orchestrator Documentation (`orchestrator/docs/`)

The supervisor's polling loop handles WAIT re-dispatch independently of
the IDE's `findNextReadyDispatch` mechanism. This invariant is documented
in `mcp-server/docs/agents/workflow-specification/edge-cases.md` §21.71
and Constraint 55, but has no corresponding callout in orchestrator-layer
documentation.

## Approach / Architecture

Five independent work items, all low-risk:

1. **Spec-then-code fix** for the Release Engineer all-terminal asymmetry
   (update `handoff.md` pseudocode, then implementation, then tests).
2. **Defensive guard fix** for the Documentation handoff missing
   `.length > 0` check.
3. **Documentation audit** of `api-surface.md` internal helpers section.
4. **Housekeeping fix** to correct AC7 wording in the parent plan's
   `work/WP-005.md`.
5. **Cross-project doc update** adding a cross-WP dispatch callout to
   orchestrator documentation.

## Rationale

- **Items 1–2** eliminate architectural inconsistencies between handoff
  functions that could confuse future contributors and mask edge-case bugs.
- **Item 3** closes a documentation health gap flagged when two of nine
  handoff functions were found missing from `api-surface.md`.
- **Item 4** prevents confusion when future contributors read the WP-005
  acceptance criteria.
- **Item 5** ensures the orchestrator's independence from IDE-specific
  dispatch is explicitly documented at the orchestrator layer, not only in
  the MCP server workflow specification.

## Detailed Steps

### Step 1 — Harmonize `getReleaseEngineerHandoff` All-Terminal Check

**Files:**
- `mcp-server/docs/agents/workflow-specification/handoff.md`
- `mcp-server/src/tools/workflow-handoff.ts` (line ~1198)
- `mcp-server/tests/tools/workflow-handoff.test.ts`

1. **Update spec first.** In `handoff.md`, update the Release Engineer
   pseudocode to change the all-terminal check from
   `releaseWps.every(isTerminal)` to `all WPs are terminal` (matching the
   QA / Security / Reviewer / Documentation pattern). Remove or revise
   the "All-terminal scope asymmetry" implementation note at line ~221
   to reflect the change.
2. **Update implementation.** In `getReleaseEngineerHandoff` (line ~1198),
   change:
   ```typescript
   if (releaseWps.length > 0 && releaseWps.every((wp) => isTerminalStatus(wp.status)))
   ```
   to:
   ```typescript
   if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status)))
   ```
   Move this check **above** the `scopeToStage()` call (or keep it after,
   since `wpDetails` is available before scoping — follow the pattern of
   `getDocumentationHandoff`).
3. **Add/update tests.** Add a regression test confirming that
   `getReleaseEngineerHandoff` returns `READY_FOR_SYNTHESIS` when all WPs
   are terminal, even when none have `release-engineering` in their active
   stages (the previously untested edge case the asymmetry masked).

### Step 2 — Fix `getDocumentationHandoff` Missing `.length > 0` Guard

**Files:**
- `mcp-server/src/tools/workflow-handoff.ts` (line ~1282)
- `mcp-server/tests/tools/workflow-handoff.test.ts`

1. **Update implementation.** In `getDocumentationHandoff` (line ~1282),
   change:
   ```typescript
   if (wpDetails.every((wp) => isTerminalStatus(wp.status)))
   ```
   to:
   ```typescript
   if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status)))
   ```
   This matches the pattern used by all other handoff functions.
2. **Add test.** Add a test confirming that `getDocumentationHandoff([])`
   does NOT return `READY_FOR_SYNTHESIS` (it should fall through to WAIT
   or the `findNextReadyDispatch` fallback).

### Step 3 — Audit and Update `api-surface.md` Internals

**Files:**
- `mcp-server/docs/agents/project-manifest/api-surface.md`

Audit identified the following undocumented exported helpers. Add
signature-only entries to the Internal Helpers section:

**From `workflow-handoff.ts`:**
- `getPlannerHandoff(wpDetails, projectPath?, store?)`
- `getProjectManagerHandoff(wpDetails, projectPath?, store?)`
- `getDeveloperHandoff(wpDetails, projectPath?, store?)`
- `getQaHandoff(wpDetails, projectPath?, store?)`
- `getSecurityAuditorHandoff(wpDetails, projectPath?, store?)`
- `getReviewerHandoff(wpDetails, projectPath?, store?)`
- `getReleaseEngineerHandoff(wpDetails, projectPath?, store?)`
- `getDocumentationHandoff(wpDetails, projectPath?, store?)`
- `buildHandoffResponse(role, status, reason, ...)`
- `nextAgentFromStatus(status)`
- `computeHandoffStatus(wpDetails, projectPath?, store?)`

**From `workflow-helpers.ts`:**
- `buildHandoffPrompt()`
- `hasDownstreamReengagedSince()`
- `hasNewUpstreamPassSince()`
- `checkRevalidationGuard()`
- `isStalePipeline()`

**From `pipeline-maps.ts`:**
- `resolvePrerequisite()`, `resolveNextAgent()`, `resolveFailAgent()`
- `getDownstreamTypes()`, `getUpstreamTypes()`
- `firstActiveStage()`, `lastActiveStage()`, `scopeToStage()`
- `validateActiveStages()`

**From `project-reset.ts`:**
- `getPassedStages()`, `analyzeProjectForReset()`,
  `applyProjectReset()`, `markProjectComplete()`

Read each function's actual signature from source before documenting.
Group by module. Follow existing `api-surface.md` formatting conventions.

### Step 4 — Correct AC7 Wording in WP-005

**File:**
- `docs/agents/plans/2026-05-04-handoff-cross-wp-dispatch-gap/work/WP-005.md`

Update AC7 from:
> Test case 9 asserts self-routing: `getDocumentationHandoff` returns
> `READY_FOR_DOCUMENTATION` for a WP with
> `active_pipeline_stages: [documentation]`

To:
> Test case 9 asserts self-routing: `getQaHandoff` returns
> `READY_FOR_QA` for a WP with
> `active_pipeline_stages: ['qa', 'code-review']`

This matches the actual test implementation at line ~3042 of
`mcp-server/tests/tools/workflow-handoff.test.ts`.

### Step 5 — Document Cross-WP Dispatch Invariant in Orchestrator Docs

**File:**
- `orchestrator/docs/agents/project-manifest/constraints.md`

Add a new constraint (next available number) documenting:
- The `findNextReadyDispatch()` mechanism is an IDE-only, best-effort
  optimization.
- The orchestrator's supervisor polling loop handles READY WP re-dispatch
  independently and does not rely on `findNextReadyDispatch`.
- Orchestrator implementations must not assume cross-WP dispatch fires
  from non-PM handoff functions.

Reference `mcp-server/docs/agents/workflow-specification/edge-cases.md`
§21.71 and MCP server Constraint 55 as the authoritative sources.

### Step 6 — Regenerate Context Files

Run `node scripts/cli.js ctx-generate` to update `.context/` files
reflecting the changes made in steps 1–5.

## Dependencies

- Steps 1 and 2 are independent of each other but both must complete
  before step 6.
- Step 3 depends on steps 1–2 completing (so the documented signatures
  reflect the final code).
- Steps 4 and 5 are independent of all other steps.
- Step 6 depends on all other steps completing.

## Required Components

- `mcp-server/src/tools/workflow-handoff.ts` — implementation changes
- `mcp-server/tests/tools/workflow-handoff.test.ts` — new/updated tests
- `mcp-server/docs/agents/workflow-specification/handoff.md` — spec update
- `mcp-server/docs/agents/project-manifest/api-surface.md` — doc audit
- `orchestrator/docs/agents/project-manifest/constraints.md` — new
  constraint
- `docs/agents/plans/2026-05-04-handoff-cross-wp-dispatch-gap/work/WP-005.md`
  — AC7 correction

## Assumptions

- The `.length > 0` guard semantics are intentional across all handoff
  functions (preventing `READY_FOR_SYNTHESIS` on empty `wpDetails`). The
  spec pseudocode is silent on the empty-array edge case, so the guard is
  treated as a defensive invariant.
- The spec's "MAY replace" language for the Release Engineer asymmetry
  permits the harmonization without a breaking change.
- The synthesis's recommendation #3 (test comment precision) was verified
  as already accurate and is intentionally excluded from this plan.

## Constraints

- Spec-first workflow: `handoff.md` must be updated before any
  implementation changes (Step 1).
- All 1,912+ existing tests must continue to pass after steps 1–2.
- `api-surface.md` entries must use signature-only format matching
  existing conventions (Step 3).

## Out of Scope

- Refactoring the handoff functions beyond the specific all-terminal
  guard changes.
- Adding new cross-WP dispatch behavior or changing
  `findNextReadyDispatch` semantics.
- Updating the spec version number (no behavioral change to external
  consumers — this is an internal consistency fix).

## Acceptance Criteria

- `getReleaseEngineerHandoff` uses `wpDetails.every()` for its
  all-terminal check, matching the other four handoff functions.
- `getDocumentationHandoff` includes the `.length > 0` guard on its
  all-terminal check.
- New regression tests cover: (a) Release Engineer returning
  `READY_FOR_SYNTHESIS` when all WPs terminal but none have
  `release-engineering` active, (b) Documentation handoff with empty
  `wpDetails` not returning `READY_FOR_SYNTHESIS`.
- `api-surface.md` documents all exported helpers from
  `workflow-handoff.ts`, `workflow-helpers.ts`, `pipeline-maps.ts`,
  and `project-reset.ts`.
- AC7 in `work/WP-005.md` accurately describes test case 9.
- Orchestrator `constraints.md` documents the cross-WP dispatch
  IDE-only invariant.
- All existing tests pass (zero regressions).
- `.context/` files are regenerated.

## Testing Strategy

- **Unit tests** for steps 1–2: verify the specific edge cases each fix
  addresses (empty array, no-release-WPs-but-all-terminal).
- **Full suite regression**: run `npm test` in `mcp-server/` after
  implementation changes — all 1,912+ tests must pass.
- **Manual verification** for steps 3–5: review the documentation changes
  for accuracy and formatting consistency.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Release Engineer all-terminal change breaks existing tests** | The change is strictly additive — it fires in a superset of the previous cases. Existing tests that passed `releaseWps` also pass with `wpDetails`. Run full suite to confirm. |
| **Documentation `.length > 0` guard changes behavior for empty-array callers** | Verify that no caller currently passes an empty array expecting `READY_FOR_SYNTHESIS`. The caller (`getHandoffStatus`) only invokes handoff functions when WPs exist. |
| **`api-surface.md` audit misses helpers** | Cross-reference with `grep -rn 'export ' mcp-server/src/` to ensure completeness. |
| **Orchestrator constraint number collides** | Read existing constraints to determine the next available number before adding. |
