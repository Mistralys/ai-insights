# Plan

## Summary

Fix a production-observed infinite routing loop in `ledger_get_next_action` caused by `resolvePrerequisite` returning `null` for first-active-stage compositions. The fix spans three phases: workflow specification amendments (7 changes across 4 spec documents), a narrowly scoped code fix (4 lines in `workflow-next-action.ts`), and regression test coverage for all affected agent functions. This plan originates from the audit report at `docs/agents/projects/audit-report-2026-03-16.md`.

## Architectural Context

The workflow recommendation engine (`mcp-server/src/tools/workflow-next-action.ts`) uses per-agent `getNextAction` functions that evaluate a priority chain to determine the next action for each work package. The function `resolvePrerequisite` (defined in `mcp-server/src/utils/pipeline-maps.ts`, specified in `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` §8.1.1) resolves the effective upstream pipeline type for a given stage based on the WP's `active_pipeline_stages`.

When a pipeline type is the **first active stage** (e.g., `qa` in `["qa", "code-review"]`), `resolvePrerequisite` returns `null`. This is correct and expected. However, at priority 4 (P4) in each agent's action logic — the **re-engagement** path — the code treats `null` as `true` ("always re-engage"). This creates an infinite loop: after the first-active-stage pipeline PASSes, P4 fires again immediately because "has upstream re-passed?" evaluates to `true` unconditionally.

**Key files:**

- **Spec:** `mcp-server/docs/agents/workflow-specification/recommendations.md` (§14.3, §14.4, §14.5b, §14.5c)
- **Spec:** `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` (§8.1.1)
- **Spec:** `mcp-server/docs/agents/workflow-specification/edge-cases.md` (needs new §21.66)
- **Spec:** `mcp-server/docs/agents/workflow-specification/handoff.md` (§13.1)
- **Implementation:** `mcp-server/src/tools/workflow-next-action.ts` (lines ~743, ~937, ~1120, ~1329)
- **Handoff implementation:** `mcp-server/src/tools/workflow-handoff.ts` (lines ~527, ~713 — hardcoded upstreams, immune to bug)
- **Tests:** `mcp-server/tests/utils/pipeline-maps.test.ts`, `mcp-server/tests/integration/full-workflow.test.ts`

**Key distinction — P4 vs P6:** At P6 (first-run), `null` → `true` is correct: "no prerequisite needed to start." At P4 (re-engagement), `null` → `true` is wrong: "re-engagement after upstream rework" is meaningless when no upstream exists.

## Approach / Architecture

Three sequential phases, each building on the previous:

1. **Phase 1 — Spec Amendments:** Update the workflow specification to close the documentation gap. This establishes the authoritative rule before code changes.
2. **Phase 2 — Code Fix:** Change 4 null-guard expressions in `workflow-next-action.ts` from `true` to `false`.
3. **Phase 3 — Regression Tests:** Add targeted tests for first-active-stage compositions in each affected agent function.

The fix is deliberately narrow: it only changes behavior when `resolvePrerequisite` returns `null` (first-active-stage). Standard 4-stage (`["implementation", "qa", "code-review", "documentation"]`) and 6-stage compositions always have non-null prerequisites at P4, so existing behavior is completely unchanged.

## Rationale

- **Spec-first:** The workflow specification is the source of truth (per AGENTS.md failure protocol). Amending it first ensures the code fix has an authoritative basis and prevents future regressions from "fixing" the code back to the buggy behavior.
- **Minimal code change:** Changing `true` to `false` in 4 locations is the smallest possible fix. No new functions, no refactoring, no additional control flow.
- **Handoff divergence is safe:** The handoff functions (`workflow-handoff.ts`) use hardcoded upstream types (`'implementation'`, `'qa'`) rather than `resolvePrerequisite`, making them immune to this bug. The plan documents this divergence in the spec but does not change the handoff implementation, as the hardcoded approach is a safe conservative pattern.

## Detailed Steps

### Phase 1: Spec Amendments

1. **`pipeline-routing.md` §8.1.1** — Change the comment on the final `return null` from `"No active predecessor (should not happen for well-formed activeStages)"` to `"First active stage — no active predecessor"`. This aligns with §21.60 which already acknowledges `null` as valid.

2. **`recommendations.md` §14.3 P4** — Add a null-guard note after the P4 description. The current text says: `hasNewUpstreamPassSince("implementation", "qa")`. Add a note: *"When `resolvePrerequisite("qa", activeStages)` returns `null` (qa is the first active stage), priority 4 does not fire — re-engagement requires an upstream stage to have re-passed. Control falls through to priority 5/6."* Also note that the hardcoded `"implementation"` should conceptually be `resolvePrerequisite("qa", activeStages)` for consistency with §14.4's dynamic pattern.

3. **`recommendations.md` §14.4 P4** — Add the same null-guard note for Reviewer: *"When `effectiveUpstream` is `null` (code-review is the first active stage), priority 4 does not fire — re-engagement requires an upstream stage to have re-passed. Control falls through to priority 5/6."*

4. **`recommendations.md` §14.5b P4** — Add the null-guard note for Security Auditor. Additionally, update the hardcoded `"qa"` to `resolvePrerequisite("security-audit", activeStages)` for consistency with the dynamic resolution pattern established in §14.4.

5. **`recommendations.md` §14.5c P5** — Add the null-guard note for Release Engineer re-engagement. §14.5c P5 currently says: `hasNewUpstreamPassSince("code-review", "release-engineering")`. Add a note that when the resolved prerequisite is `null`, the re-engagement condition does not fire.

6. **`edge-cases.md`** — Add new §21.66 "First-Active-Stage Re-engagement Loop" documenting:
   - The footgun pattern: P4 `null` → `true` causing an infinite `RUN_*` loop
   - The resolution: P4 must treat `null` prerequisite as `false`
   - The distinction from P6 (`null` → `true` is correct at first-run)
   - Affected agent functions: QA P4, Reviewer P4, Security Auditor P4, Release Engineer P5
   - Immune agent functions: Documentation P4 and Release Engineer P4 (self-rework pattern where the null collapse is safe because the condition includes `isMostRecentPipelineFail`)
   - Affected compositions: any `active_pipeline_stages` where a non-`implementation` stage is first

7. **`handoff.md` §13.1** — Add an implementation note at the QA and Reviewer handoff sections documenting that the handoff implementation uses hardcoded upstream types (`'implementation'` for QA, `'qa'` for Reviewer) rather than `resolvePrerequisite`. Note that this makes handoffs immune to the null-prerequisite issue but also non-adaptive to unusual stage compositions. Document this as an intentional simplification — the hardcoded approach fails gracefully (returns `false`, falls through) rather than creating a loop.

### Phase 2: Code Fix

For each affected agent function in `mcp-server/src/tools/workflow-next-action.ts`, change the P4/P5 re-engagement null-guard from `true` to `false`:

8. **QA P4** (~line 743): Change `qaPrerequisite === null ? true` to `qaPrerequisite === null ? false`. Update the comment from `"qa is the first active stage, no prerequisite needed"` to `"qa is the first active stage — no upstream to re-engage from"`.

9. **Reviewer P4** (~line 937): Change `reviewPrerequisite === null ? true` to `reviewPrerequisite === null ? false`. Add similar comment.

10. **Security Auditor P4** (~line 1120): Change `auditPrerequisite === null ? true` to `auditPrerequisite === null ? false`. Add similar comment.

11. **Release Engineer P5** (~line 1329): Change `releasePrerequisite === null ? true` to `releasePrerequisite === null ? false`. Add similar comment.

**Leave unchanged** (correct as-is):
- All P6 first-run checks (`prerequisite === null ? true`) — ~lines 784, 978, 1161, 1356
- Documentation P4 (self-rework: `isMostRecentPipelineFail && (null || !hasNewUpstreamPassSince)` collapses to `isMostRecentPipelineFail`)
- Release Engineer P4 (same safe self-rework pattern, ~line 1306)

### Phase 3: Regression Tests

12. Add regression tests in a new or existing test file under `mcp-server/tests/tools/` covering:
    - **Reviewer loop test:** WP with `active_pipeline_stages: ["code-review", "documentation"]`, a PASS code-review pipeline already exists. Call `getNextAction` for Reviewer → expect **not** `RUN_REVIEW` (should fall through to P5/P6 or `WAIT`/`FINALIZE_WP`).
    - **QA loop test:** WP with `active_pipeline_stages: ["qa", "code-review"]`, a PASS qa pipeline exists. Call `getNextAction` for QA → expect **not** `RUN_QA` at P4.
    - **Security Auditor loop test:** WP with `active_pipeline_stages: ["security-audit", "code-review"]`, a PASS security-audit pipeline exists. Call `getNextAction` for Security Auditor → expect **not** `RUN_SECURITY_AUDIT` at P4.
    - **Release Engineer loop test:** WP with `active_pipeline_stages: ["release-engineering", "documentation"]`, a PASS release-engineering pipeline exists. Call `getNextAction` for Release Engineer → expect **not** `RUN_RELEASE_ENGINEERING` at P5.

13. Verify existing tests still pass by running the full test suite (`npm test` from `mcp-server/`).

## Dependencies

- Phase 2 depends on Phase 1 (spec establishes the rule before code implements it)
- Phase 3 depends on Phase 2 (tests validate the fix)
- No external dependencies

## Required Components

- `mcp-server/docs/agents/workflow-specification/pipeline-routing.md` (edit §8.1.1 comment)
- `mcp-server/docs/agents/workflow-specification/recommendations.md` (edit §14.3, §14.4, §14.5b, §14.5c)
- `mcp-server/docs/agents/workflow-specification/edge-cases.md` (add §21.66)
- `mcp-server/docs/agents/workflow-specification/handoff.md` (add implementation note at §13.1)
- `mcp-server/src/tools/workflow-next-action.ts` (4-line code fix)
- `mcp-server/tests/tools/` (new regression tests — **new test file or additions to existing**)

## Assumptions

- The canonical pipeline ordering in `resolvePrerequisite` is unchanged (implementation → qa → security-audit → code-review → release-engineering → documentation)
- First-active-stage compositions (e.g., `["qa", "code-review"]`, `["code-review", "documentation"]`) are valid per the spec (confirmed by §21.60–§21.65)
- The P6 first-run semantics (`null` → `true`) are correct and must not be changed
- The self-rework pattern at Documentation P4 and Release Engineer P4 is correct and must not be changed
- Handoff functions' hardcoded upstream types are an intentional safe pattern

## Constraints

- **Spec-first:** All spec amendments must land before or alongside the code fix — never code-only
- **No behavioral change for standard compositions:** The fix must not alter behavior for default 4-stage or full 6-stage WPs (all have non-null prerequisites at P4/P5)
- **Workflow spec is source of truth:** Per AGENTS.md failure protocol, when spec and code conflict, trust the spec

## Out of Scope

- Refactoring handoff functions to use `resolvePrerequisite` (documented as intentional simplification; separate future work if needed)
- Testing all possible `active_pipeline_stages` permutations (combinatorial; the 4 regression tests cover the representative cases)
- Changes to `resolvePrerequisite` itself (the function is correct; the issue is in callers)
- FINALIZE_WP behavior for non-Documentation terminal agents in unusual compositions (§14.5a — related but separate concern, documented in §21.65)

## Acceptance Criteria

- All 7 spec amendments are applied to the workflow specification documents
- The 4 null-guard expressions in `workflow-next-action.ts` return `false` instead of `true` at P4/P5 re-engagement checks
- All P6 first-run checks remain `true` (unchanged)
- The 4 regression tests pass, proving that first-active-stage compositions do not create infinite loops
- The full existing test suite passes with no regressions (`npm test` from `mcp-server/`)
- The new edge case §21.66 clearly documents the footgun, resolution, and P4-vs-P6 distinction

## Testing Strategy

- **Unit tests:** 4 new regression tests covering each affected agent function with a first-active-stage composition where the pipeline has already PASSed
- **Existing suite:** Run full `npm test` to confirm no regressions in standard 4-stage and 6-stage flows
- **Manual verification (optional):** Run the audit-triggering scenario (`["code-review", "documentation"]` WP, Reviewer calls `getNextAction` after code-review PASS) and confirm no loop

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Fix introduces regressions in standard compositions** | Standard 4-stage and 6-stage WPs always have non-null prerequisites at P4/P5, so the changed code path is never reached. Full test suite validates this. |
| **Spec amendment creates ambiguity** | Each amendment uses identical phrasing ("priority N does not fire — re-engagement requires an upstream stage to have re-passed") for consistency across all affected sections. |
| **Untested unusual compositions surface new bugs** | The 4 regression tests cover representative cases. §21.66 documents the pattern so future agents are aware. Edge cases like FINALIZE_WP for non-Documentation terminal agents (§14.5a) are explicitly scoped out. |
| **Handoff divergence causes future issues** | Documented in handoff.md as intentional simplification. Hardcoded upstream types are a safe conservative pattern — they fail gracefully (return `false`) rather than looping. |
