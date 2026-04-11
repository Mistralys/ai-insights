# Plan

## Summary

Follow-up rework addressing the QA-reported residual defect in `getQaHandoff` (`wpsStillNeedingImpl` missing `active_pipeline_stages` guard), three synthesis-identified cleanup items (duplicate test keys, dead code, pattern duplication), and one confirmed-resolved item (documentation already complete). Four concrete steps fix actual bugs and reduce maintenance burden; the `scopeToStage()` extraction is the only structural refactor.

## Architectural Context

- **Primary fix target:** `mcp-server/src/tools/workflow-handoff.ts` — the five per-role handoff handlers (Developer, QA, Reviewer, Documentation, PM) that were scope-filtered in the preceding plan `2026-04-10-handoff-active-stage-scoping`.
- **Test file with duplicate keys:** `mcp-server/tests/tools/workflow-next-action.test.ts` — lines 806/810 and 819/823 contain duplicate `acceptance_criteria` keys in object literals (second definition silently overrides the first).
- **Dead code location:** `mcp-server/src/tools/workflow-handoff.ts`, line 365 — `targetAgent ?? 'Developer'` in `getProjectManagerHandoff` message string. `targetAgent` is always a `string` because `firstActiveStage()` and `PIPELINE_AGENT_MAP` both guarantee non-null returns.
- **Scope-filter duplication:** The pattern `wpDetails.filter(wp => (wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES).includes('stage'))` appears 6 times across the handoff handlers at lines 425, 554, 734, 868, 1049, and 1121.
- **Workflow Specification:** `mcp-server/docs/agents/workflow-specification/handoff.md` §13.1 QA Handoff pseudocode — the spec scopes all pipeline-specific conditions to WPs with `"qa"` in `activeStages`. The `wpsStillNeedingImpl` variable violates this by not also checking whether `"implementation"` is in the WP's active stages.
- **hasPassedEffectiveUpstream documentation:** Confirmed complete — documented in `handoff.md` line 222, `edge-cases.md` line 689, and `README.md` line 14. No action required (synthesis recommendation #1 resolved).

## Approach / Architecture

Four independent work streams:

1. **Bug fix (high priority):** Guard `wpsStillNeedingImpl` in `getQaHandoff` with an `active_pipeline_stages` check so WPs without `implementation` in their active stages are not erroneously counted as "needing implementation." Add targeted test coverage for the specific failure scenario (QA+code-review-only WP incorrectly routed to `READY_FOR_DEVELOPER`).

2. **Test cleanup (low priority):** Remove the first (dead) `acceptance_criteria: []` from two object literals in `workflow-next-action.test.ts`, eliminating the duplicate-key warnings from vite/esbuild.

3. **Dead code removal (low priority):** Remove the `?? 'Developer'` fallback from the message template string in `getProjectManagerHandoff`. The `targetAgent` variable is always a `string` at that point; the fallback is misleading.

4. **Structural refactor (medium priority):** Extract a shared `scopeToStage(wpDetails, stage)` helper to eliminate the 6-way duplication of the scope-filter pattern. Place it alongside the existing pipeline-maps utilities.

## Rationale

- The `wpsStillNeedingImpl` defect is a correctness bug that produces incorrect routing (`READY_FOR_DEVELOPER` instead of proceeding to review/next stage) for WPs with `active_pipeline_stages: ['qa', 'code-review']` (no implementation stage). It was created during the scope-filter implementation in the preceding plan — `qaWps` was correctly scoped, but the downstream `wpsStillNeedingImpl` derivation didn't inherit the implementation-stage guard.
- The duplicate-key and dead-code items are noise that misleads future maintainers. Both are trivial single-line fixes.
- The `scopeToStage()` extraction reduces 6 copy-pasted filter expressions to a single helper call, making the intent clearer and reducing the risk of future inconsistencies (as demonstrated by the `wpsStillNeedingImpl` defect itself).

## Detailed Steps

### Step 1: Fix `wpsStillNeedingImpl` in `getQaHandoff` *(high priority — correctness bug)*

In `mcp-server/src/tools/workflow-handoff.ts`, lines 588–591, the current code:

```typescript
const wpsStillNeedingImpl = qaWps.filter(
  (wp) => !wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
);
```

Must be changed to also verify that `implementation` is in the WP's active stages:

```typescript
const wpsStillNeedingImpl = qaWps.filter((wp) => {
  const activeStages =
    (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
  return (
    activeStages.includes('implementation') &&
    !wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );
});
```

**Effect:** WPs with `active_pipeline_stages: ['qa', 'code-review']` (no `implementation` stage) will no longer be counted as "still needing implementation," so they won't trigger the false `READY_FOR_DEVELOPER` routing at lines 618 and 706.

**Test coverage required:** Add at least one test case in `mcp-server/tests/integration/auto-handoff.test.ts` verifying:
- A WP with `active_pipeline_stages: ['qa', 'code-review']` and no implementation pipeline → QA handoff does NOT return `READY_FOR_DEVELOPER`.
- The WP is correctly routed after QA passes (should proceed to code-review, not loop back to Developer).

### Step 2: Remove duplicate `acceptance_criteria` keys *(low priority — cleanup)*

In `mcp-server/tests/tools/workflow-next-action.test.ts`:

**Case 6 (lines 806–810):** Remove the first `acceptance_criteria: []` from the `makeWorkPackageDetail` call, keeping only the second (meaningful) definition:

```typescript
// Before:
const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
    makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    makePipeline('documentation',  'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
  ], acceptance_criteria: [{ criterion: 'All docs updated', met: true }], });

// After:
const wp: WorkPackageDetail = makeWorkPackageDetail({ pipelines: [
    makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    makePipeline('documentation',  'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
  ], acceptance_criteria: [{ criterion: 'All docs updated', met: true }], });
```

**Case 7 (lines 819–823):** Same fix — remove the first `acceptance_criteria: []`.

### Step 3: Remove dead `?? 'Developer'` fallback *(low priority — cleanup)*

In `mcp-server/src/tools/workflow-handoff.ts`, line 365, the `getProjectManagerHandoff` message string currently reads:

```typescript
`Work package ${wp.work_package_id} is READY. Routing to ${targetAgent ?? 'Developer'} (${wp.assigned_to ? 'assigned' : 'first active stage'}).`,
```

`targetAgent` is derived from `wp.assigned_to ?? PIPELINE_AGENT_MAP[firstActiveStage(...)]`. Since `firstActiveStage()` always returns a `PipelineType` (never null/undefined) and `PIPELINE_AGENT_MAP` maps all `PipelineType` values to strings, `targetAgent` is guaranteed to be a `string`. The `?? 'Developer'` fallback cannot fire.

Change to:

```typescript
`Work package ${wp.work_package_id} is READY. Routing to ${targetAgent} (${wp.assigned_to ? 'assigned' : 'first active stage'}).`,
```

### Step 4: Extract shared `scopeToStage()` helper *(medium priority — refactor)*

Create a typed helper function in `mcp-server/src/utils/pipeline-maps.ts` (where `DEFAULT_PIPELINE_STAGES`, `firstActiveStage()`, and `resolvePrerequisite()` already live):

```typescript
/**
 * Filter WP details to those whose active_pipeline_stages includes the given stage.
 * Falls back to DEFAULT_PIPELINE_STAGES when the WP has no explicit stages.
 */
export function scopeToStage(
  wpDetails: readonly WorkPackageDetail[],
  stage: PipelineType
): WorkPackageDetail[] {
  return wpDetails.filter((wp) =>
    ((wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES)
      .includes(stage)
  );
}
```

Then replace the 6 inline filter expressions in `workflow-handoff.ts`:

| Current Variable | Line | Stage | Replacement |
|-----------------|------|-------|-------------|
| `implWps` | 425 | `'implementation'` | `scopeToStage(wpDetails, 'implementation')` |
| `qaWps` | 554 | `'qa'` | `scopeToStage(wpDetails, 'qa')` |
| `auditWps` | 734 | `'security-audit'` | `scopeToStage(wpDetails, 'security-audit')` |
| `reviewWps` | 868 | `'code-review'` | `scopeToStage(wpDetails, 'code-review')` |
| `releaseWps` | 1049 | `'release-engineering'` | `scopeToStage(wpDetails, 'release-engineering')` |
| `docWps` | 1121 | `'documentation'` | `scopeToStage(wpDetails, 'documentation')` |

**Import:** Add `scopeToStage` to the existing import from `../utils/pipeline-maps.js` in `workflow-handoff.ts`.

**Type import:** The `WorkPackageDetail` type must be importable in `pipeline-maps.ts`. If this creates a circular dependency, move the helper to a new utility file (e.g., `mcp-server/src/utils/scope-helpers.ts`) or keep it co-located in `workflow-handoff.ts` as a module-level function.

### Step 5: Update documentation

- Update `mcp-server/docs/agents/project-manifest/api-surface.md` to document `scopeToStage()` in the pipeline-maps section.
- If a new file is created (scope-helpers.ts), update `mcp-server/docs/agents/project-manifest/file-tree.md`.
- Regenerate CTX context files: `node scripts/cli.js ctx-generate`.

## Dependencies

- Step 1 is independent and should be completed first (highest priority).
- Steps 2 and 3 are independent of each other and of Step 1.
- Step 4 depends on Step 1 (the `wpsStillNeedingImpl` fix should land first, then the extraction can include the corrected `qaWps` filter).
- Step 5 depends on Step 4 (documentation reflects final API surface).

## Required Components

- `mcp-server/src/tools/workflow-handoff.ts` — Steps 1, 3, 4
- `mcp-server/tests/tools/workflow-next-action.test.ts` — Step 2
- `mcp-server/tests/integration/auto-handoff.test.ts` — Step 1 (new test cases)
- `mcp-server/src/utils/pipeline-maps.ts` — Step 4 (new helper function)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Step 5

## Assumptions

- The `WorkPackageDetail` type is importable in `pipeline-maps.ts` without creating a circular dependency. If it does create a cycle, the helper should be placed in a separate utility file or kept module-level in `workflow-handoff.ts`.
- The Workflow Specification (§13.1 QA Handoff pseudocode) is the source of truth. The `wpsStillNeedingImpl` logic is an implementation violation of the spec's scoping rule.
- Removing the `?? 'Developer'` fallback is purely cosmetic — no runtime behavior changes.

## Constraints

- Step 1 must not change behavior for WPs that DO have `implementation` in their `active_pipeline_stages` (backward compatibility).
- Step 4 refactor must be a pure extraction — no behavioral change beyond calling the helper instead of inline filter.
- All existing 1,750 tests must continue to pass after each step.

## Out of Scope

- `hasPassedEffectiveUpstream` documentation (synthesis recommendation #1) — confirmed already complete in the workflow specification.
- Orchestrator Python implementation of the same fix (separate codebase, separate plan).
- Further handoff handler refactoring beyond `scopeToStage()` extraction.
- Additional mixed-composition test scenarios beyond the specific defect being fixed.

## Acceptance Criteria

- A WP with `active_pipeline_stages: ['qa', 'code-review']` (no implementation stage) does NOT trigger `READY_FOR_DEVELOPER` from `getQaHandoff` when QA passes.
- No vite/esbuild warnings about duplicate `acceptance_criteria` keys in `workflow-next-action.test.ts`.
- The `getProjectManagerHandoff` message string no longer contains the unreachable `?? 'Developer'` fallback.
- A `scopeToStage(wpDetails, stage)` helper exists and is used by all 6 handoff handlers.
- `scopeToStage()` is documented in `api-surface.md`.
- All 1,750+ tests pass. Build is clean.

## Testing Strategy

- **Step 1:** Add a targeted integration test in `auto-handoff.test.ts` for a QA+code-review-only WP (no implementation stage). Verify QA handoff does NOT return `READY_FOR_DEVELOPER`. Verify correct forward routing after QA PASS.
- **Step 2:** Run `npm test` in `mcp-server/` and confirm zero duplicate-key warnings in console output.
- **Step 3:** No new tests needed — existing tests cover PM routing. Verify build passes.
- **Step 4:** No new tests needed — pure extraction refactor. Full `npm test` regression run confirms no behavioral change.
- **Step 5:** Manual verification of documentation accuracy.
- **Final gate:** `npm run build` clean + `npm test` → all tests pass.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`scopeToStage()` import creates circular dependency** | Check import graph before placing in `pipeline-maps.ts`. Fall back to a separate `scope-helpers.ts` file or a module-level function in `workflow-handoff.ts`. |
| **`wpsStillNeedingImpl` fix changes behavior for default-stage WPs** | Default WPs have `implementation` in `DEFAULT_PIPELINE_STAGES`, so the added `activeStages.includes('implementation')` check is vacuously true for them. Regression test (T7 from preceding plan) already covers this. |
| **Removing `?? 'Developer'` breaks TypeScript narrowing** | `targetAgent` is already typed as `string` (both `wp.assigned_to` and `PIPELINE_AGENT_MAP[...]` return `string`). Template literal interpolation accepts `string` without the nullish coalescing. |
| **Duplicate-key removal changes test semantics** | The second definition already overrides the first in JS object literals. Removing the first definition makes the code match the runtime behavior — no semantic change. |
