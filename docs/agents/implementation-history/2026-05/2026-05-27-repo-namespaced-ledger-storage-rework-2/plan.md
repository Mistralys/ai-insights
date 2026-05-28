# Plan

## Plan Audit Cycles
- Audits: 4 — Plan Auditor v1.3.1
- Architectural Reviews: 1 — Plan Architect Reviewer v1.4.0

## Summary

This plan addresses the five strategic recommendations from the Sprint 1 synthesis
(`2026-05-27-repo-namespaced-ledger-storage-rework-1/synthesis.md`). The scope covers:
completing KL-3 closure by migrating `deriveRepoName()`'s inline regex to `assertSafeSegment()`,
adding a dedicated regression test for the run-log-handlers `assertSafeSlug` ApiError path,
fixing pre-existing Python 3.14 async test failures, extracting the inline log-copy derivation
in `cli.py` into a named function, and consolidating duplicate test helpers in `api.test.ts`.

## Architectural Context

- **`assertSafeSegment()`** lives in `mcp-server/src/utils/path-validator.ts` as the shared
  predicate. All `assertSafeSlug` wrappers already delegate to it.
- **`deriveRepoName()`** in `mcp-server/src/utils/ledger-root.ts` (line 103) still uses
  `SAFE_SLUG_REGEX.test(name)` directly rather than calling `assertSafeSegment(name)`.
- **`run-log-handlers.ts`** defines a local `assertSafeSlug` that throws `ApiError`. It is
  tested indirectly via `run-log-handlers.test.ts` (Sprint 1 AC2/AC3 assertions on `handleListRunLogs`),
  but there is no isolated test that the function throws `ApiError` specifically (vs. a plain
  `Error`).
- **`orchestrator/tests/test_streaming_capture.py`** has 3 pre-existing `RuntimeError:
  coroutine raised StopIteration` failures under Python 3.14's stricter async semantics.
- **`orchestrator/src/cli.py` lines 868–876** contain inline `repo_name` / `ledger_log_dir`
  derivation. The test file `test_slug_dir.py` mirrors this logic in a local
  `_derive_ledger_log_dir()` helper rather than importing the production function.
- **`mcp-server/tests/gui/api.test.ts`** has four nearly-identical `createNs*Project` helpers
  (lines 1343, 1483, 1627, 1758) that only differ in the subdirectory they create.

## Approach / Architecture

Five independent, low-coupling changes:

1. **deriveRepoName() migration** — Replace `SAFE_SLUG_REGEX.test(name)` with
   `assertSafeSegment(name)`. Remove `SAFE_SLUG_REGEX` import if no other usage remains in
   the file.
2. **run-log-handlers assertSafeSlug test** — Add a focused test asserting that an invalid
   slug/repoName produces an `ApiError` (not a generic `Error`), validating error type
   independence from the delegate.
3. **Python 3.14 async fix** — Diagnose the 3 pre-existing failures in
   `test_streaming_capture.py` by running the tests under Python 3.14 and inspecting the
   actual tracebacks. Apply a targeted fix based on the observed root cause.
4. **Extract `derive_ledger_log_dir()`** — Move the inline derivation from `cli.py` into a
   named function, update the test to import it directly, eliminating the mirror pattern.
5. **Consolidate test helpers** — Extract a single `createNsProject(slug)` helper in
   `api.test.ts` and refactor the four callers to use it.

## Rationale

- All five items are explicitly called out in the synthesis as strategic recommendations.
- Each item is independent and can be implemented/tested in isolation.
- Items 1, 2, and 5 are TypeScript-only (MCP server). Items 3 and 4 are Python-only
  (orchestrator). No cross-language dependency.
- The collective risk is low: items 1–2 and 4–5 are refactoring-grade changes with existing
  test coverage as safety nets. Item 3 fixes genuine test failures that contaminate CI.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| deriveRepoName validation | Call `assertSafeSegment()` | Keep inline regex; pass regex as param | `assertSafeSegment` is the codebase's canonical validation point — calling it eliminates the last holdout of direct regex usage outside `path-validator.ts`. |
| cli.py extraction scope | Module-level private function `_derive_ledger_log_dir()` | Public utility in `src/utils/` | The function is specific to cli.py's log-copy step; exposing it publicly would over-abstract a single-site concern. A private function co-located in `cli.py` is proportional. |
| Test helper consolidation | Single outer-scope factory in `api.test.ts` | Shared test-utils module | The helpers are only used in one file; extracting to a separate module adds indirection for zero reuse benefit. |
| Python 3.14 fix approach | Replace StopIteration pattern with async-native idioms | Pin Python < 3.14 in CI | Pinning delays the inevitable and prevents testing on newer runtimes. |

## Pattern Alignment

- `assertSafeSegment()` consolidation follows the pattern established in Sprint 1
  (`path-validator.ts` is the single delegate) — this plan completes the migration.
- Test structure in `run-log-handlers.test.ts` already uses `rejects.toMatchObject({ code: … })`
  — the new test follows the identical pattern.
- Orchestrator test classes use `pytest.mark.parametrize` extensively
  (`test_slug_dir.py::TestLedgerLogCopyPath`) — the fix in `test_streaming_capture.py` will
  preserve this convention.
- Private extraction in `cli.py` follows the existing pattern of underscore-prefixed helper
  functions visible in the same file (e.g. the existing inline derivation style).

## Detailed Steps

### Step 1 — Migrate `deriveRepoName()` to `assertSafeSegment()`

1. In `mcp-server/src/utils/ledger-root.ts`, replace line 103:
   ```typescript
   if (!name || !SAFE_SLUG_REGEX.test(name)) {
   ```
   with:
   ```typescript
   if (!name || !assertSafeSegment(name)) {
   ```
2. If `SAFE_SLUG_REGEX` has no remaining usages in `ledger-root.ts`, remove the import from
   line 5. Verify by checking that `assertSafeSlug` (the local function at ~line 130) already
   delegates to `assertSafeSegment()` and does not reference `SAFE_SLUG_REGEX` directly.
3. In `mcp-server/src/utils/ledger-root.ts`, update the JSDoc comment at line 87 that
   currently reads `{@link SAFE_SLUG_REGEX}` to instead reference `{@link assertSafeSegment}`.
4. Run existing tests to confirm no regressions:
   `npx vitest run tests/utils/path-validator.test.ts tests/storage/`

### Step 2 — Add dedicated assertSafeSlug ApiError test for run-log-handlers

1. In `mcp-server/tests/gui/run-log-handlers.test.ts`, add a focused describe block (or
   append to the existing validation section) with two tests:
   - Invalid `slug` produces an error with `code: 'NOT_FOUND'` and is an instance of `ApiError`
     (use the `ApiError` already imported at the top of the test file from `../../src/gui/log-resolver.js`).
   - Invalid `repoName` produces the same `ApiError NOT_FOUND`.
2. These complement the existing AC2/AC3 tests by asserting the error *type*, not just the
   code property.

### Step 3 — Fix Python 3.14 async failures in `test_streaming_capture.py`

1. Run the test file under Python 3.14 to observe the actual tracebacks:
   `cd orchestrator && python -m pytest tests/test_streaming_capture.py -v`
2. Inspect each failure's traceback to identify the precise root cause. The synthesis
   reports `RuntimeError: coroutine raised StopIteration`; validate this against the actual
   output before assuming a cause.
3. Apply a targeted fix based on the observed failures. Common patterns to check: sync
   generators wrapped in async contexts, `__next__`-based exhaustion instead of
   `StopAsyncIteration`, or mock objects that do not implement `__aiter__` / `__anext__`
   correctly.
4. Confirm all tests pass on both Python 3.11+ and 3.14.

### Step 4 — Extract `_derive_ledger_log_dir()` into a named function in `cli.py`

1. In `orchestrator/src/cli.py`, extract lines 868–876 into a module-level private function:
   ```python
   def _derive_ledger_log_dir(plan_dir: Path, workspace_root: Path) -> Path:
       """Derive the ledger storage log directory for a given plan."""
       slug = plan_dir.name
       try:
           repo_name = plan_dir.parents[3].name or "unknown"
       except IndexError:
           repo_name = "unknown"
       return (
           workspace_root / "mcp-server" / "storage" / "ledger"
           / repo_name / slug / "orchestrator" / "logs"
       )
   ```
2. Replace the inline block at lines 868–876 with a call:
   ```python
   ledger_log_dir = _derive_ledger_log_dir(plan_dir, config.workspace_root)
   ```
3. In `orchestrator/tests/test_slug_dir.py`, replace the local `_derive_ledger_log_dir`
   mirror with an import:
   ```python
   from src.cli import _derive_ledger_log_dir
   ```
   Remove the local implementation (lines 118–148).
4. In `orchestrator/tests/test_slug_dir.py`, remove the now-stale `cli.py` line-range
   references from the section header comment (line 116) and the `_derive_ledger_log_dir`
   docstring — the block has been extracted and the former `cli.py` location is no longer
   meaningful.
5. Run: `cd orchestrator && python -m pytest tests/test_slug_dir.py -v`

### Step 5 — Consolidate duplicate `createNs*Project` test helpers

1. In `mcp-server/tests/gui/api.test.ts`, create a single outer-scope helper above the
   namespaced test blocks:
   ```typescript
   async function createNsProject(slug: string): Promise<LedgerStore> {
     const planPath = join(tmpdir(), 'my-repo', 'docs', 'agents', 'plans', slug);
     const store = new LedgerStore(planPath, ledgerRoot);
     await store.writeRootIndex(makeRoot());
     return store;
   }
   ```
2. Replace all four `createNsDialoguesProject`, `createNsDialogueFileProject`,
   `createNsChunksProject`, and `createNsChunkFileProject` function definitions with calls
   to `createNsProject`.
3. Run the affected tests:
   `npx vitest run tests/gui/api.test.ts`

## Dependencies

- Steps 1–2 and 5 share the MCP server test suite but are otherwise independent.
- Steps 3–4 share the orchestrator test suite but are otherwise independent.
- No step depends on another step's output.

## Required Components

- `mcp-server/src/utils/ledger-root.ts` — modify `deriveRepoName()`
- `mcp-server/src/utils/path-validator.ts` — no changes (existing)
- `mcp-server/tests/gui/run-log-handlers.test.ts` — add tests
- `orchestrator/tests/test_streaming_capture.py` — fix async patterns
- `orchestrator/src/cli.py` — extract function
- `orchestrator/tests/test_slug_dir.py` — import production function
- `mcp-server/tests/gui/api.test.ts` — consolidate helpers

## Assumptions

- The 3 Python 3.14 failures are all caused by the `StopIteration` in coroutine issue
  (as stated in the synthesis). If the root cause differs, the fix will need adjustment
  but the scope remains the same file.
- `SAFE_SLUG_REGEX` is not used elsewhere in `ledger-root.ts` beyond `deriveRepoName()` and
  the already-migrated `assertSafeSlug()`. (Verified: only line 103 uses it directly.)
- The `_derive_ledger_log_dir` extraction in `cli.py` will not be made public (`def` without
  leading underscore) because no external module needs it.

## Constraints

- No new production dependencies.
- No behavioral changes — all steps are refactoring or test-only modifications.
- The `deriveRepoName()` change must produce identical output for all inputs (same `'unknown'`
  fallback semantics).
- Python fix must pass on both 3.11+ and 3.14 (no version-gated code).

## Out of Scope

- KL-1 (the `'unknown'` namespace collision) remains an accepted limitation.
- Behavioral change notice documentation (the `NOT_FOUND` vs `[]` change from Sprint 1 is
  already shipped and documented in the synthesis).
- Any new feature work unrelated to the synthesis recommendations.

## Acceptance Criteria

- AC1: `deriveRepoName()` no longer imports or references `SAFE_SLUG_REGEX` directly; calls
  `assertSafeSegment()` instead. All existing tests pass unchanged.
- AC2: `run-log-handlers.test.ts` contains at least 2 new tests asserting `ApiError` type
  (not just code property) for invalid slug and invalid repoName.
- AC3: All tests in `orchestrator/tests/test_streaming_capture.py` pass on Python 3.14 (0
  failures, where previously 3 failed).
- AC4: `cli.py` contains a named `_derive_ledger_log_dir()` function; the inline derivation
  is replaced by a call to it; `test_slug_dir.py` imports the production function directly.
- AC5: `api.test.ts` has a single `createNsProject` helper; the four former duplicates are
  removed. All 12 namespaced tests pass.

## Testing Strategy

All changes are covered by existing test infrastructure. Steps 1, 2, and 5 use Vitest (MCP
server). Steps 3 and 4 use pytest (orchestrator). No new test infrastructure is required.
Each step is verified by running the relevant test file(s) after modification.

## Test Plan

- `mcp-server/tests/utils/path-validator.test.ts` — existing 8 tests confirm
  `assertSafeSegment` still works after `deriveRepoName` migration — AC1
- `mcp-server/tests/storage/` — existing storage tests confirm `deriveRepoName` produces
  correct output — AC1
- `mcp-server/tests/gui/run-log-handlers.test.ts` — 2 new tests: "assertSafeSlug throws
  ApiError for invalid slug" and "assertSafeSlug throws ApiError for invalid repoName" — AC2
- `orchestrator/tests/test_streaming_capture.py` — all existing tests pass (previously 3
  failed) — AC3
- `orchestrator/tests/test_slug_dir.py` — existing 9 `TestLedgerLogCopyPath` tests pass using
  imported production function — AC4
- `mcp-server/tests/gui/api.test.ts` — all 12 namespaced tests pass with consolidated helper
  — AC5

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Update KL-3 resolution note to
  state `deriveRepoName()` also delegates to `assertSafeSegment` (complete consolidation).
  Remove mention of "retains its `SAFE_SLUG_REGEX` import for `deriveRepoName()`".
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `deriveRepoName()`
  signature/description to reflect the JSDoc `{@link}` reference change from `SAFE_SLUG_REGEX`
  to `assertSafeSegment`. Also remove the `src/utils/ledger-root.ts` entry from the
  `SAFE_SLUG_REGEX` importers list (line 1096); `ledger-store.ts` and `gui/api.ts` remain.
- `mcp-server/docs/agents/project-manifest/constraints.md` — Update KL-1 trigger-condition
  paragraph (line 1863): replace "validates it against `SAFE_SLUG_REGEX`" with "delegates to
  `assertSafeSegment()` (which encapsulates `SAFE_SLUG_REGEX`)" to stay accurate after the
  Step 1 implementation change.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Python 3.14 failures have a different root cause** | Step 3 instructs running tests locally first. If the StopIteration theory is wrong, diagnose from the actual traceback and adjust the fix. |
| **`SAFE_SLUG_REGEX` removal breaks an untested consumer** | Grep confirms only line 103 uses it directly; `assertSafeSlug` already delegates. Run full test suite after removal. |
| **Importing private `_derive_ledger_log_dir` from tests is fragile** | The function is stable (single-site, no expected changes). The test import is preferable to maintaining a mirrored implementation. |
| **Test helper consolidation causes subtle test isolation issues** | All four helpers are identical in behavior (same `tmpdir()`, same `'my-repo'` prefix). Consolidation changes no semantics. |
