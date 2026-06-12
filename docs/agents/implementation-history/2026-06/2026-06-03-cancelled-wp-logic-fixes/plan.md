# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.4.0
- Architectural Reviews: none — Plan Architect Reviewer v1.5.0

## Summary

Fix two logic bugs in the MCP server's pipeline routing system that cause legitimate work to be incorrectly cancelled. Bug 1: `hasDownstreamReengagedSince` triggers on downstream pipelines that PASSed (not just FAILed), causing infinite rework loops when code-review FAILs but QA re-verifies successfully. Bug 2: The prerequisite check in `startPipeline` does not exclude `auto_cancelled` pipelines, causing permanently unrecoverable states when an agent accidentally starts and immediately cancels a duplicate pipeline.

## Architectural Context

The MCP server implements a multi-stage pipeline workflow where work packages progress through ordered stages (implementation → qa → code-review → documentation). Key modules involved:

- **`mcp-server/src/tools/pipeline.ts`** — `startPipeline` operation that enforces prerequisite ordering (§8.2). Line 194 performs the prerequisite check.
- **`mcp-server/src/utils/workflow-helpers.ts`** — Helper functions for workflow logic, including `hasDownstreamReengagedSince` (line 286) which detects whether a downstream agent has re-engaged after an upstream PASS.
- **`mcp-server/src/tools/workflow-next-action.ts`** — The recommendation engine that determines what action each agent should take. Priority 5 (P5) dispatches REWORK when downstream failure + re-engagement detected.
- **`mcp-server/docs/agents/workflow-specification/`** — Authoritative specification for all workflow logic.

The established pattern throughout the codebase is to exclude `auto_cancelled` pipelines from all pipeline lookups (§21.27). The prerequisite check is the only location that deviates from this pattern.

## Approach / Architecture

Two targeted fixes to existing functions, no new modules or abstractions:

1. **Bug 2 (Critical, one-line fix):** Add `&& !p.auto_cancelled` to the prerequisite pipeline filter in `startPipeline`, aligning it with the established pattern used in every other pipeline lookup.

2. **Bug 1 (Medium complexity):** Add `mostRecent.status === 'FAIL'` condition to the loop in `hasDownstreamReengagedSince`, so only downstream pipelines that actually FAILed trigger the rework signal. A PASS re-engagement means verification succeeded — the WP should advance to the next stage, not loop back to Developer.

Both fixes require corresponding updates to the workflow specification (spec-first development per Constraint 0) and new/updated tests.

## Rationale

- **Bug 2:** The `auto_cancelled` exclusion is already the universal pattern (§21.27). The prerequisite check's omission is clearly an oversight, not a design choice. The fix is a single filter predicate addition.
- **Bug 1:** The function `hasDownstreamReengagedSince` conflates "a downstream agent re-engaged" with "a downstream agent re-engaged and found problems." Only the latter requires Developer rework. A PASS re-engagement is verification that the fix worked — the WP should advance to the stage whose most-recent pipeline is FAIL (code-review in the identified scenario). Adding a status check to the re-engagement detection correctly separates "verified OK" from "found new issues."

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Bug 1: Where to add the FAIL check | Inside `hasDownstreamReengagedSince` (check `mostRecent.status === 'FAIL'`) | (A) Add correlation logic in P5 condition to match failing type with re-engaged type; (B) Add a separate `hasDownstreamReengagedAndFailed` function | Chosen shape is simplest — the function is only used in P5, and changing its semantics from "any re-engagement" to "failing re-engagement" matches its actual purpose. Alt (A) is more complex and spreads logic across two sites. Alt (B) adds unnecessary indirection for a single call site. |
| Bug 2: How to exclude auto-cancelled | Add `!p.auto_cancelled` to existing filter | (A) Extract to a `latestNonCancelledPipeline` call; (B) Create a shared helper for prerequisite lookup | Chosen shape keeps the change minimal and pattern-consistent. The existing code already has the filter inline; adding one predicate follows the same style. Extracting to a helper would be over-engineering for a single call site. |

## Pattern Alignment

- **§21.27 auto_cancelled exclusion pattern** (`mcp-server/src/utils/workflow-helpers.ts`, `mcp-server/src/tools/workflow-next-action.ts`): Bug 2 fix aligns with this established pattern. No departure.
- **Spec-first development** (`mcp-server/docs/agents/project-manifest/constraints.md` Constraint 0): Both fixes require spec update before code change. Followed.
- **Test traceability** (Constraint 0, workflow spec README §4): New tests reference spec sections. Followed.

## Detailed Steps

### Step 1: Update workflow specification — §8.2 prerequisite algorithm (Bug 2)

Update the pseudocode in `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` §8.2 to add auto-cancelled exclusion to the prerequisite filter:

```
prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite AND NOT p.auto_cancelled)
```

Add a note: "Consistent with §21.27, auto-cancelled pipelines are excluded from the prerequisite lookup to prevent erroneously cancelled pipelines from blocking downstream stages."

### Step 2: Update workflow specification — §14.13 algorithm (Bug 1)

Update the pseudocode and scenario table in `mcp-server/docs/agents/workflow-specification/recommendations.md` §14.13:

- Add `AND mostRecent.status == "FAIL"` to the condition inside the loop.
- Update the §14.13 scenario table to add a row: `impl-1 PASS → code-review FAIL → impl-2 PASS → qa-2 PASS` → `false` — QA verified the fix successfully; only failing re-engagements trigger rework.
- Update the existing row 3 (`qa-2 started / IN_PROGRESS`) to clarify that the function returns `false` for IN_PROGRESS (P5's outer `hasDownstreamFail` guard already prevents P5 from firing for IN_PROGRESS; the function no longer needs to return true for this case).

### Step 3: Fix prerequisite check in `startPipeline` (Bug 2)

**File:** `mcp-server/src/tools/pipeline.ts` line 194

Change:
```typescript
const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
```

To:
```typescript
const prereqPipelines = wp.pipelines.filter(
  (p) => p.type === prerequisite && !p.auto_cancelled
);
```

### Step 4: Fix `hasDownstreamReengagedSince` (Bug 1)

**File:** `mcp-server/src/utils/workflow-helpers.ts` line 310 (inside the for loop)

Change:
```typescript
if (mostRecent.started_at) {
  const dsStartedAt = parseTimestamp(mostRecent.started_at).getTime();
  if (dsStartedAt >= upstreamCompletedAt) {
    return true;
  }
}
```

To:
```typescript
if (mostRecent.status === 'FAIL' && mostRecent.started_at) {
  const dsStartedAt = parseTimestamp(mostRecent.started_at).getTime();
  if (dsStartedAt >= upstreamCompletedAt) {
    return true;
  }
}
```

Update the JSDoc comment on the function to reflect the refined semantics: "Returns true when a downstream agent (whose FAIL routes to Developer) has started a pipeline that resulted in FAIL since the most recent upstream PASS."

### Step 5: Update existing unit tests for `hasDownstreamReengagedSince`

**File:** `mcp-server/tests/utils/workflow-helpers.test.ts`

Update test "§14.13 row 3" (IN_PROGRESS scenario): change expected result from `true` to `false`. The function now only returns true for FAIL status. P5 is already protected by the outer `hasDownstreamFail` guard for IN_PROGRESS pipelines.

Update test "returns true when code-review (not QA) re-engaged after impl PASS": this test has code-review as FAIL, so it remains `true` — no change needed.

### Step 6: Add new unit tests for `hasDownstreamReengagedSince`

**File:** `mcp-server/tests/utils/workflow-helpers.test.ts`

Add tests:
1. "returns false when downstream re-engaged with PASS after impl PASS" — the core bug scenario (QA PASS re-engagement should not trigger rework).
2. "returns false when one downstream PASSed and another FAILed but hasn't re-engaged" — the cross-downstream correlation scenario (code-review FAIL, QA PASS re-engagement → false).
3. "returns true when downstream re-engaged with FAIL after impl PASS" — preserves the main rework case.

### Step 7: Add integration test for prerequisite + auto_cancelled (Bug 2)

**File:** `mcp-server/tests/tools/start-pipeline-guards.test.ts` (or `pipeline.test.ts`)

Add test: "allows QA to start when most recent non-cancelled implementation is PASS despite a trailing auto-cancelled FAIL" — directly tests the fix scenario from Project 2.

### Step 8: Add integration test for rework loop prevention (Bug 1)

**File:** `mcp-server/tests/tools/workflow-next-action.test.ts`

Add test in the Developer action section: "returns WAIT_FOR_DOWNSTREAM (not REWORK) when code-review is FAIL but QA re-engaged with PASS after impl PASS" — directly reproduces the Project 1 scenario.

This test should create pipelines: `[impl PASS, qa PASS, code-review FAIL, impl-2 PASS (rework), qa-2 PASS]` and assert that Developer gets `WAIT_FOR_DOWNSTREAM` (or is skipped in favor of Reviewer getting `RUN_REVIEW`).

### Step 9: Add regression test for handoff path (Bug 1)

**File:** `mcp-server/tests/tools/workflow-handoff.test.ts`

Add test in the Developer handoff section: "Developer handoff does NOT report rework-needed when downstream re-engaged with PASS after impl PASS" — confirms the `workflow-handoff.ts` call sites (L632, L638) are unaffected by the semantics change.

This test should create a WP with pipelines: `[impl PASS, qa PASS, code-review FAIL, impl-2 PASS (rework), qa-2 PASS]` and assert that the Developer handoff does NOT include this WP in the rework-needed list (since `isMostRecentPipelineFail` returns false for the QA PASS, the `hasDownstreamReengagedSince` check is never reached).

## Dependencies

- Step 1 and Step 2 (spec updates) must precede Steps 3 and 4 (code changes) per spec-first constraint.
- Steps 3 and 4 (code changes) must precede Steps 5–9 (test updates/additions), though tests can be written concurrently if assertions are known in advance.
- Steps 5–9 are independent of each other and can be implemented in any order.

## Required Components

- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` — §8.2 spec update
- `mcp-server/docs/agents/workflow-specification/recommendations.md` — §14.13 spec update
- `mcp-server/src/tools/pipeline.ts` — prerequisite filter fix (line 194)
- `mcp-server/src/utils/workflow-helpers.ts` — `hasDownstreamReengagedSince` status check (line 310)
- `mcp-server/tests/utils/workflow-helpers.test.ts` — unit test updates + additions
- `mcp-server/tests/tools/start-pipeline-guards.test.ts` — new integration test (Bug 2)
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new integration test (Bug 1)
- `mcp-server/tests/tools/workflow-handoff.test.ts` — new regression test (Bug 1, handoff path)

## Assumptions

- The `status` field on Pipeline objects is always populated for completed pipelines (PASS or FAIL). This is enforced by `completePipeline` which sets status from the input argument.
- The P5 outer guard (`hasDownstreamFail`) correctly returns FALSE when a downstream's most recent pipeline is IN_PROGRESS, making the IN_PROGRESS case in `hasDownstreamReengagedSince` a dead path from the P5 perspective.
- The Reviewer's recommendation engine (§14.4) already handles the "re-engage after QA PASS following code-review FAIL" scenario correctly — as evidenced by the existing test at line 123 of `workflow-next-action.test.ts`. The fix to Bug 1 ensures the Developer path no longer blocks the Reviewer path.

## Constraints

- Spec-first development: workflow specification must be updated before implementation code (Constraint 0).
- All pipeline lookups must exclude auto-cancelled pipelines (§21.27).
- Cross-platform: changes are pure TypeScript logic, no OS-specific concerns.

## Out of Scope

- Orchestrator-side safeguard for "same WP dispatched to same role N times in a row" (open question from research — separate enhancement).
- PM override logic enhancement for `ROUTE_PIPELINE_AGENT` (open question from research — separate enhancement).
- Circuit breaker threshold tuning — the failsafes are working correctly; the bugs that trigger them are being fixed.
- Orchestrator Python implementation of these fixes — the orchestrator delegates to MCP server tools; once the server is fixed, the orchestrator benefits automatically.

## Acceptance Criteria

1. A work package with pipeline history `[implementation PASS, implementation FAIL (auto_cancelled)]` allows QA to start successfully (Bug 2 fix).
2. A work package with pipeline history `[impl PASS, qa PASS, code-review FAIL, impl-2 PASS, qa-2 PASS]` does NOT route Developer to REWORK — Developer gets WAIT_FOR_DOWNSTREAM or no action (Bug 1 fix).
3. A work package with pipeline history `[impl PASS, qa FAIL (started after impl)]` still routes Developer to REWORK (preserves existing behavior).
4. A work package with pipeline history `[impl PASS, qa FAIL, impl-2 PASS, qa-2 FAIL (started after impl-2)]` still routes Developer to REWORK (preserves rework-after-repeated-failure).
5. The workflow specification §8.2 and §14.13 are updated to document the corrected algorithms.
6. All existing tests pass (with the one expected assertion change in row 3 test).
7. New tests cover both bug scenarios and their fix conditions.

## Testing Strategy

Both bugs are testable in isolation (unit tests on helper functions) and in integration (through the recommendation engine). The strategy is:

- **Unit level:** Test `hasDownstreamReengagedSince` with various pipeline histories covering PASS, FAIL, and mixed downstream statuses.
- **Integration level (start-pipeline):** Test that `startPipeline` allows a stage to begin when the most recent non-cancelled prerequisite is PASS, even if a later auto-cancelled FAIL exists.
- **Integration level (next-action):** Test the full P5 routing path with the specific pipeline histories from the research scenarios to confirm the infinite loop is broken.

## Test Plan

- `mcp-server/tests/utils/workflow-helpers.test.ts` — Update §14.13 row 3 test: change assertion from `true` to `false` for IN_PROGRESS downstream scenario — AC 6
- `mcp-server/tests/utils/workflow-helpers.test.ts` — New: "returns false when downstream re-engaged with PASS status" — AC 2
- `mcp-server/tests/utils/workflow-helpers.test.ts` — New: "returns false when QA PASSed but code-review is FAIL and hasn't re-engaged" (cross-downstream) — AC 2
- `mcp-server/tests/utils/workflow-helpers.test.ts` — New: "returns true when downstream re-engaged with FAIL status after impl PASS" (regression guard) — AC 3, AC 4
- `mcp-server/tests/tools/start-pipeline-guards.test.ts` — New: "prerequisite check ignores auto-cancelled FAIL, sees prior PASS" — AC 1
- `mcp-server/tests/tools/workflow-next-action.test.ts` — New: "Developer gets WAIT_FOR_DOWNSTREAM (not REWORK) when code-review FAIL + QA PASS re-engagement" — AC 2
- `mcp-server/tests/tools/workflow-handoff.test.ts` — New: "Developer handoff does NOT report rework-needed when downstream re-engaged with PASS after impl PASS" — AC 2 (handoff path regression)

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` — §8.2 pseudocode: add `AND NOT p.auto_cancelled` to prerequisite filter; add explanatory note.
- `mcp-server/docs/agents/workflow-specification/recommendations.md` — §14.13 pseudocode: add `AND mostRecent.status == "FAIL"` condition; update scenario table; update interaction note.
- `mcp-server/docs/agents/project-manifest/constraints.md` — No update needed (§21.27 already documents the auto_cancelled pattern; this fix aligns with it).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Changing `hasDownstreamReengagedSince` semantics breaks other call sites** | The function is called from 3 locations across 2 files: `workflow-next-action.ts` L619 (P5), `workflow-handoff.ts` L632, and `workflow-handoff.ts` L638. All three call sites are guarded by `isMostRecentPipelineFail` which requires FAIL status — so a PASS re-engagement never reaches the `hasDownstreamReengagedSince` check in practice. All existing test scenarios across both files use FAIL status for the re-engaged downstream, so they remain correct. The IN_PROGRESS test is the only one that changes, and P5 already has an outer guard for that case. A dedicated handoff regression test (Step 9) confirms the handoff path is unaffected. |
| **Auto-cancelled filter in prerequisite check could mask genuine FAIL** | An auto-cancelled FAIL is by definition not a real failure — it was cancelled immediately after accidental start. The `auto_cancelled` flag is only set explicitly by the agent via `cancelPipeline(auto_cancelled: true)`. Normal FAILs from `completePipeline` never set this flag. |
| **Spec update could introduce inconsistencies with other spec sections** | Both changes are scoped additions (one filter predicate, one status check). They don't alter the flow structure. The §14.13 interaction note already acknowledges the P5 outer guard for IN_PROGRESS. |
