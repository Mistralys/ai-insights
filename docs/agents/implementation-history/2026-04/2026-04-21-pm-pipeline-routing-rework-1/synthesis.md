## Synthesis

### Completion Status
- Date: 2026-04-21
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Extracted `latestNonCancelledPipeline(pipelines, type)` as a new exported helper in
  `mcp-server/src/utils/workflow-helpers.ts`. The helper returns the last non-auto-cancelled
  pipeline of a given type, or `null`. It replaces the duplicated `filter+at(-1) ?? null`
  pattern that appeared in four places across the two PM dispatch functions.
- Refactored `isMostRecentPipelineFail()` to delegate to `latestNonCancelledPipeline()`
  instead of reimplementing the same filter inline.
- Updated callers in `workflow-handoff.ts` (step 2b) and `workflow-next-action.ts`
  (Priority 3d): both inline `filter+at(-1)` patterns replaced with the shared helper.
  Both files now import `latestNonCancelledPipeline` from `workflow-helpers.js`.
- Fixed the stale `§5.5` JSDoc cross-reference on `getProjectManagerHandoff()` to `§13.1`.
- Added optional `assignedTo: string = 'Developer'` parameter to the `makeWp` test helper
  in `workflow-handoff.test.ts`. All existing call sites continue to compile unchanged;
  new tests for step-2b scenarios can now pass an explicit `assigned_to` value without
  spreading and overriding.
- Added `ROUTE_PIPELINE_AGENT` to `_DISPATCH_ACTIONS` in `orchestrator/src/supervisor.py`
  and implemented `next_agent`-based routing: when the action is `ROUTE_PIPELINE_AGENT`
  and `next_agent` is a known role in `_ROLE_STAGE_MAP`, the destination is overridden to
  that role's stage. Unknown or absent `next_agent` falls back to the queried role's stage.
- Added documentation comment to `restrict_to_wp()` in `tool_wrappers.py` explaining why
  PM cross-WP claim rejections are correct behavior, and how the supervisor re-dispatch
  cycle handles legitimate PM orchestration needs.
- Added constraint §21 to `orchestrator/docs/agents/project-manifest/constraints.md`
  documenting the PM WP-guard invariant: the guard must not be relaxed for PM stages.
- Updated `mcp-server/docs/agents/project-manifest/api-surface.md` to document the new
  `latestNonCancelledPipeline` function and updated the `isMostRecentPipelineFail` entry
  to note that it now delegates to the new helper.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — new `latestNonCancelledPipeline`
  entry added to the `workflow-helpers.ts` section; `isMostRecentPipelineFail` comment
  updated to reflect delegation.
- `orchestrator/docs/agents/project-manifest/constraints.md` — new constraint §21 added
  documenting the PM WP-guard invariant.
- `orchestrator/src/utils/tool_wrappers.py` — inline docstring note added to
  `restrict_to_wp()` explaining the PM orchestration model.

### Verification Summary
- Tests run:
  - `npm test` (MCP server, Vitest) — **1,871 passed**, 0 failed (62 test files)
  - `python3 -m pytest tests/test_supervisor.py -v` — **104 passed**, 0 failed
    (includes 4 new `TestRoutePipelineAgent` tests and the updated `TestDirectActionRouting`
    parametrize entry for `ROUTE_PIPELINE_AGENT`)
- Static analysis run:
  - `python3 -m ruff check src/supervisor.py src/utils/tool_wrappers.py` — **all checks passed**
- Result: PASS

### Code Insights
- [low] (convention) `mcp-server/src/tools/workflow-handoff.ts` — The step-2b `for` loop
  uses `break` to exit on FAIL/IN_PROGRESS guards, which silently skips all remaining stages
  for that WP. This is intentional and correct, but a brief comment above each `break` would
  make the branching intent clearer to future readers. (Already present on the FAIL line;
  the IN_PROGRESS line has none in the handoff version.)
- [low] (debt) `orchestrator/tests/test_supervisor.py` — The `_derive_next_action` simulation
  helper does not model `ROUTE_PIPELINE_AGENT` (it is not required to — the helper is only
  used by simulation-based tests). Future tests that exercise PM-to-pipeline routing via the
  simulation path would need to extend the helper or use `make_mcp_tools_with_actions` directly
  (as the new `TestRoutePipelineAgent` tests do).
- [low] (improvement) `mcp-server/src/utils/workflow-helpers.ts` — `isMostRecentPipelineFail`
  now uses optional-chaining: `latestNonCancelledPipeline(...)?.status === 'FAIL' ?? false`.
  The `?? false` is technically redundant because `undefined === 'FAIL'` is already `false`,
  but it makes the intent explicit and mirrors the defensive style of the surrounding code.
  No behavior change.

### Additional Comments
- The `ROUTE_PIPELINE_AGENT` parametrize entry added to `TestDirectActionRouting` tests the
  no-`next_agent` fallback path (routes to `pm`). The dedicated `TestRoutePipelineAgent` class
  covers the positive routing cases (QA, Developer) and both fallback scenarios (unknown and
  missing `next_agent`).
- Step 5 (WP-guard documentation) required no code change. The constraint entry in
  `constraints.md` and the `tool_wrappers.py` docstring addition fully capture the finding.
