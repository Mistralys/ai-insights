## Synthesis

### Completion Status
- Date: 2026-05-28
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- **Step 1 — `deriveRepoName()` migration:** Replaced `SAFE_SLUG_REGEX.test(name)` with
  `assertSafeSegment(name)` in `mcp-server/src/utils/ledger-root.ts`. Removed the now-unused
  `SAFE_SLUG_REGEX` import. Updated the JSDoc `{@link}` reference from `SAFE_SLUG_REGEX` to
  `assertSafeSegment`. `src/utils/ledger-root.ts` no longer imports from `./constants.js`.
- **Step 2 — `assertSafeSlug` `ApiError` tests:** Added two focused tests to
  `mcp-server/tests/gui/run-log-handlers.test.ts` asserting `instanceof ApiError` (not just
  `code: 'NOT_FOUND'`) for an invalid slug and an invalid repoName. Test count: 41 → 43.
- **Step 3 — Python 3.14 test fixes:** Diagnosed and fixed the 3 failing tests in
  `orchestrator/tests/test_streaming_capture.py`. The root cause was **not** the
  `StopIteration` pattern described in the synthesis — it was a stale path assertion. After
  Sprint 1 namespaced the ledger storage layout, `_derive_slug_dir()` began writing chunk
  files under `{ledgerRoot}/{repo_name}/{slug}/…` (using `"unknown"` as the fallback
  repo_name for the shallow `/some/ledger/root/…` project path used in tests). The three
  `TestChunkFileCreation` tests still checked the old flat `{ledgerRoot}/{slug}/…` path.
  Fixed by updating the expected path to use `"unknown"/{slug}/` in all three assertions.
- **Step 4 — `_derive_ledger_log_dir()` extraction:** Extracted the inline 8-line derivation
  block from `orchestrator/src/cli.py` into a named module-level private function
  `_derive_ledger_log_dir(plan_dir, workspace_root)`. Replaced the inline block with a
  single-line call. Updated `orchestrator/tests/test_slug_dir.py` to import the production
  function (`from src.cli import _derive_ledger_log_dir`) and removed the local mirror
  implementation (31 lines). Updated the module docstring to remove the stale `cli.py`
  line-range reference.
- **Step 5 — Test helper consolidation:** Added a single `createNsProject(slug)` helper at
  the outer `describe('gui/api.ts', …)` scope in `mcp-server/tests/gui/api.test.ts`.
  Removed the four duplicate `createNs{Dialogues,DialogueFile,Chunks,ChunkFile}Project`
  function definitions and replaced all 8 call sites with `createNsProject`. Test count
  remains 170 — no semantic change.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/constraints.md` — Updated KL-3 resolution note
  to reflect complete consolidation: `deriveRepoName()` now also delegates to
  `assertSafeSegment()`. Removed the statement that `ledger-root.ts` retains the
  `SAFE_SLUG_REGEX` import. Updated the ongoing invariant paragraph accordingly.
- `mcp-server/docs/agents/project-manifest/constraints.md` (KL-1) — Updated the
  trigger-condition paragraph to replace "validates it against `SAFE_SLUG_REGEX`" with
  "delegates to `assertSafeSegment()` (which encapsulates `SAFE_SLUG_REGEX`)".
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Removed
  `src/utils/ledger-root.ts` from the `SAFE_SLUG_REGEX` importers list. Updated the
  `deriveRepoName()` signature comment to reference `assertSafeSegment()` instead of
  `SAFE_SLUG_REGEX`.

### Verification Summary
- Tests run:
  - `mcp-server/` full suite: `npx vitest run` — **2344 passed, 79 test files**
  - `orchestrator/` full suite: `python -m pytest tests/` — **1004 passed, 6 skipped**
- Static analysis run:
  - `mcp-server/` TypeScript: `npx tsc --noEmit` — **0 errors**
- Result: **PASS** — all acceptance criteria met

### Code Insights

- [low] (debt) `orchestrator/tests/test_streaming_capture.py`: ~~The root cause of the 3
  "pre-existing failures" was not Python 3.14 async semantics but stale path assertions
  left behind after the Sprint 1 namespaced-storage migration. The synthesis that originated
  this plan incorrectly diagnosed the failures. The test file's `_base_state()` helper still
  uses `project_path="/some/ledger/root/2026-04-10-streaming-test"`, which has only 3
  ancestor levels and therefore always produces `repo_name="unknown"`. Consider updating the
  `_base_state()` default to a path with a realistic 4-level ancestry (e.g.
  `/workspaces/ai-insights/docs/agents/plans/2026-04-10-streaming-test`) so the tests
  exercise the non-fallback code path.~~ **DONE** — Updated `_base_state()` default to
  `/workspaces/ai-insights/docs/agents/plans/2026-04-10-streaming-test`; updated all three
  `TestChunkFileCreation` path assertions to use `"ai-insights"` instead of `"unknown"`.

- [low] (convention) `orchestrator/tests/test_slug_dir.py`: The class
  `TestLedgerLogCopyPath` now tests a production function imported from `src.cli`. Its
  parametrize fixtures include tuple strings with the expected repo as a concatenated suffix
  (e.g. `"2026-05-27-my-feature-ai-insights"`), which was left over from a previous test
  helper style. The parametrize IDs are slightly confusing but do not affect correctness.

- [low] (improvement) `mcp-server/src/utils/ledger-root.ts`: The local `assertSafeSlug`
  function (lines ~130–134) is now the only remaining consumer of `assertSafeSegment` in
  this file, alongside `deriveRepoName`. Both call `assertSafeSegment()` but with different
  throw semantics. A brief inline comment explaining this pattern would aid future readers,
  though the JSDoc block already covers it.

### Additional Comments
- Step 3's actual root cause (path assertion mismatch, not async semantics) should be noted
  in the project's `history/key-learnings.md` as a reminder that synthesis descriptions of
  pre-existing failures can be incorrect — always run tests and inspect actual tracebacks
  before assuming a cause.
