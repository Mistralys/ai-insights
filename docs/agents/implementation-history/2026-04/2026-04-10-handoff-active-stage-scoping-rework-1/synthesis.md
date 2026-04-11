## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Fixed correctness bug in `getQaHandoff`: `wpsStillNeedingImpl` now checks whether `'implementation'` is in the WP's `active_pipeline_stages` before counting it as "needing implementation." WPs with e.g. `['qa', 'code-review']` are no longer erroneously routed to `READY_FOR_DEVELOPER`.
- Removed duplicate `acceptance_criteria` keys in two test object literals (Cases 6 and 7 in `workflow-next-action.test.ts`), eliminating silent override warnings.
- Removed unreachable `?? 'Developer'` fallback from `getProjectManagerHandoff` message template.
- Extracted `scopeToStage(wpDetails, stage)` helper in `pipeline-maps.ts` and replaced all 6 inline filter expressions in `workflow-handoff.ts` with calls to it.
- Added 2 new integration tests (T8, T9) in `auto-handoff.test.ts` verifying that QA+code-review-only WPs do not trigger `READY_FOR_DEVELOPER`.

### Documentation Updates
- Updated `mcp-server/docs/agents/project-manifest/api-surface.md` to document `scopeToStage()` in the pipeline-maps section.
- No `file-tree.md` update was needed — no new files were created (the helper was placed in the existing `pipeline-maps.ts`).

### Verification Summary
- Tests run: `npm test` in `mcp-server/` — 1752 tests across 58 files
- Build run: `npm run build` (tsc) — clean, zero errors
- Static analysis: TypeScript strict mode via tsc — clean
- Result: All passing, no regressions

### Code Insights
- [medium] (code-smell) `mcp-server/src/tools/workflow-handoff.ts` — `getQaHandoff`: the downstream logic (`wpsNeedingNewQa`, `wpsWithQaInProgress`, `wpsWithQaFail`) all derive from `wpsWithImpl`, which filters for WPs with `implementation PASS`. A qa+code-review-only WP with no pipelines yet falls through all these checks to the default `READY_FOR_REVIEW`, even though QA work hasn't started. This is arguably incorrect for that composition but is outside the scope of this plan. Consider adding a parallel path that checks for WPs needing QA regardless of implementation status.
- [low] (convention) `mcp-server/src/tools/workflow-handoff.ts` — `getSecurityAuditorHandoff` and `getReleaseEngineerHandoff` had a subtly different parenthesization in their pre-existing inline scope filters: `(wp.active_pipeline_stages as PipelineType[] | undefined ?? DEFAULT_PIPELINE_STAGES)` — missing inner parens around the `??` operand. The `scopeToStage()` extraction now normalizes this, but it's worth noting the original code may have had an operator-precedence edge case (`as` binds tighter than `??`, so the `undefined` was effectively `as`-cast to `PipelineType[] | undefined` and then `??` applied, which happened to work correctly).
- [low] (refactor) `mcp-server/src/tools/workflow-handoff.ts` — The `(wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES` pattern still appears 4 times outside the scope filters (in `wpsStillNeedingImpl`, `getReviewerHandoff` upstream resolution, `getDocumentationHandoff` upstream resolution ×2). These could potentially use a small helper like `getActiveStages(wp)` to further reduce duplication, but is not in scope.

### Additional Comments
- The `WorkPackageDetail` type import added to `pipeline-maps.ts` does not create a circular dependency: `pipeline-maps.ts` → `work-package.ts` → `enums.ts` (no back-reference to pipeline-maps).
- CTX context regeneration (`node scripts/cli.js ctx-generate`) was not run — left for the user to execute when ready.
