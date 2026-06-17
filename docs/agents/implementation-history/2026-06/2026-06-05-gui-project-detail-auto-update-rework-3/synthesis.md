
## Synthesis

### Completion Status
- Date: 2026-06-17
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Created `mcp-server/tests/gui/helpers/api-stubs.ts` exporting the `ProjectDetailApiStubs`
  interface (8 required fields) and the `createApiStubs(overrides?)` factory function.
- Refactored `renderWithAPI` in all four test files (`project-detail-runs`, `project-detail-resume`,
  `project-detail-poll-modes`, `project-detail-scroll`) to import `createApiStubs` and
  `ProjectDetailApiStubs`, replace the inline parameter type with `Partial<ProjectDetailApiStubs>`,
  and replace the 8-line per-key `??` fallback block with a single `createApiStubs(apiStubs)` call.
- Per-file wait logic remains unchanged in every file (200 ms for runs/resume/poll-modes;
  400 ms + 10 extra micro-task flushes for scroll).
- No production code was modified.

### Documentation Updates
- `mcp-server/tests/gui/README.md` — Updated the `renderWithAPI stub keys` callout to reference
  `ProjectDetailApiStubs` in `helpers/api-stubs.ts` and `createApiStubs()` instead of the former
  "manual sync" instructions.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Added `api-stubs.ts` entry under
  `tests/gui/helpers/`; added missing `create-namespaced-project.ts` and
  `create-namespaced-project.test.ts` entries; corrected the stale "six" consumer count on
  `make-project.ts` to "eight".

### Verification Summary
- Tests run: `npx vitest run tests/gui/project-detail-runs.test.ts tests/gui/project-detail-resume.test.ts tests/gui/project-detail-poll-modes.test.ts tests/gui/project-detail-scroll.test.ts` — 72/72 passed
- Tests run: `npx vitest run tests/gui/` — 1338/1338 passed across 49 files
- Static analysis run: `npx tsc --noEmit` — 0 errors
- Result: PASS — all acceptance criteria met

### Code Insights
- [low] (improvement) **DONE** `mcp-server/tests/gui/helpers/make-project.ts` (JSDoc): The module-level
  JSDoc still reads "Replaces the six independent and diverged local `makeProject()` definitions".
  With the stub-key helper now in place and both the README and file-tree updated to "eight", this
  sentence is the only remaining "six" reference in the helpers directory. It is out of scope for
  this plan (the sentence accurately described the rework-1 motivation) but could be updated to
  reflect the current eight-file consumer count in a future cleanup pass.

### Additional Comments
- The `createApiStubs` factory follows the exact `makeProject(opts)` factory-with-overrides pattern
  established in rework-1 and strict-typed in rework-2, making the API instantly familiar to any
  developer who has worked with the existing helpers.
- No circular imports were introduced; `api-stubs.ts` imports from `make-project.ts` (same
  `helpers/` directory), which has no dependencies on `api-stubs.ts`.
