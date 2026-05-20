## Synthesis

### Completion Status
- Date: 2026-05-20
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `.trim().length > 0` guard to the `id` check in `isRawQueueEntry()` — empty-string and
  whitespace-only `id` values are now rejected, matching the `expectedSlug` guard pattern at line 39.
- Added TC-18 (`id: ''`) and TC-19 (`id: '   '`) to `validate-entry.test.ts`; suite grows from 17 to
  19 passing tests.
- Added `orchestratorGetRunStatus: vi.fn().mockResolvedValue(null)` to the global API stub in
  `orchestrator-view.test.ts` (`beforeAll` + `beforeEach`), and updated the global type declaration.
- Added registry-separation regression test inside a new `describe` block in
  `orchestrator-view.test.ts`: uses fake timers, triggers a successful start run with a
  `runStatusFilename`, then invokes `refreshQueue()` directly via the captured `Router._setPolling`
  callback and asserts `vi.getTimerCount()` remains 1 — proving `_orchStatusPollCleanups` was NOT
  drained by `refreshQueue()`.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `isRawQueueEntry()` rule 2 updated to
  state `id` must be non-empty and non-whitespace-only; the stale note saying non-emptiness was
  unenforced has been removed.
- `mcp-server/changelog.md` — new `v1.30.5` entry documents both code changes and both test
  additions.

### Verification Summary
- Tests run: `npm test` in `mcp-server/` — 2226 tests across 74 test files, all pass.
- Targeted: `validate-entry.test.ts` (19 passed), `orchestrator-view.test.ts` (29 passed).
- Static analysis run: `npx tsc --noEmit` in `mcp-server/` — no type errors.
- Result: PASS

### Code Insights
- [low] (improvement) `mcp-server/tests/gui/orchestrator-view.test.ts`: The `flushPromises()` helper
  comment mentions "10 was chosen empirically" with advice to increase it for longer chains. As the
  test suite grows (now 29 tests), a shared constant or a dedicated microtask-drain utility would
  make the magic number easier to locate and adjust. Low priority — the current comment is clear
  enough for maintenance.
- [low] (convention) `mcp-server/tests/gui/orchestrator-view.test.ts`: The global `API` type
  declaration (`declare global { var API: {...} }`) is embedded inline in the test file. As more
  mock methods are added (now 5), extracting the type to a shared test-types file would avoid
  duplication if more test files reference the same `API` shape. Currently only one file uses it so
  deferral is justified.

### Additional Comments
- The `vi.getTimerCount()` approach was chosen over a `vi.spyOn(globalThis, 'clearInterval')` spy
  to directly measure timer survival (the actual invariant) rather than inferring it from a call
  count delta. Both approaches prove the same thing; `vi.getTimerCount()` is more readable.
- Per the plan, the `pollCount` off-by-one and `setLimitedInterval` helper remain out of scope;
  neither was touched.
