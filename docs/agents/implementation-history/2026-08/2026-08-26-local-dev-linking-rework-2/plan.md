# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.9.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.0

## Prior Project Context

This plan addresses the single deferred item from `2026-08-25-local-dev-linking-rework-1`, which closed out six code insights from the prior local dev-linking project. The only remaining coverage gap was flagged by QA: `personaFreshness()` and `versionSync()` in `scripts/lib/precommit-guards.js` lack failure-path tests. All other items from that synthesis are fully resolved.

## Summary

Add unit tests for the `personaFreshness()` and `versionSync()` pre-commit guard functions in `scripts/tests/precommit-guards.test.js`, closing the coverage-symmetry gap identified in the prior rework cycle's synthesis. Both functions are currently untested (not even imported in the test file). The tests will exercise success paths, failure-with-output paths, and failure-without-script paths using the existing `{ cwd }` DI pattern — no mocking required.

## Architectural Context

The pre-commit guard module (`scripts/lib/precommit-guards.js`) was extracted from a POSIX-only shell hook in the prior project cycle. It exposes pure-ish, cross-platform guard functions that return structured `GuardResult` objects. Each guard that shells out to a subprocess accepts a `{ cwd }` option for testability — the existing test suite (`scripts/tests/precommit-guards.test.js`, 17 tests) uses this pattern with temp git repos created via `fs.mkdtempSync()`.

`personaFreshness()` delegates to `node scripts/build-personas.js --check` and `versionSync()` delegates to `node scripts/check-version-sync.js`, both via the private `spawnNodeScript()` helper. Neither function is imported or tested in the current test file.

## Approach / Architecture

Add two new `describe` blocks to `scripts/tests/precommit-guards.test.js` — one for `personaFreshness` and one for `versionSync` — following the established test patterns. Each block will contain three test cases:

1. **Failure when script doesn't exist:** Call with `{ cwd: repo }` (temp dir, no scripts directory) → `node` exits 1 with "Cannot find module" → verify `passed: false`, `blocking: true`, non-empty `messages`.
2. **Failure when script exits non-zero with output:** Create a minimal script at `scripts/{scriptName}` in the temp dir that writes to stderr and exits 1 → verify `passed: false`, `blocking: true`, output captured in `messages`.
3. **Success when script exits 0:** Create a minimal script that exits 0 → verify `passed: true`, `blocking: true`, `messages: []`.

This mirrors the approach used for `ruffLint` (DI-based, no mocking) and `noFileProtocolInLocks` (temp git repo with real files).

## Rationale

- **DI over mocking:** The `{ cwd }` option already provides the test seam. Mocking `spawnSync` would add vitest mock imports, create coupling to the internal `spawnNodeScript` call, and break the test file's current no-mock convention.
- **Three cases per guard:** Tests the full decision tree: no-script (exercises `subprocessOutputLines` returning an empty array → fallback message), script-fails-with-output (exercises message capture), and script-succeeds (exercises the happy path). This matches the coverage QA requested.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Test isolation mechanism | `{ cwd }` DI pointing to temp dir | vitest `vi.mock('child_process')` | DI avoids import-order coupling and matches all 17 existing tests; mocking would be the first mock in the file and introduce a pattern divergence. |
| Failure scenario | Create/omit real script files in temp dir | Stub `spawnNodeScript` as an exported testable wrapper | `spawnNodeScript` is intentionally private; exporting it solely for testing would widen the module's API surface for no production benefit. |

## Pattern Alignment

- Follows: temp-dir lifecycle via `beforeEach`/`afterEach` with `fs.mkdtempSync`/`fs.rmSync` — `scripts/tests/precommit-guards.test.js`
- Follows: DI via options object `{ cwd }` — `personaFreshness()`, `versionSync()`, `noFileProtocolInLocks()`, `ruffLint()`
- Follows: assertion shape (`result.blocking`, `result.passed`, `result.messages`) — all guard tests in the file
- Follows: no vitest mocking — entire test file

## Detailed Steps

1. **Import `personaFreshness` and `versionSync`** into `scripts/tests/precommit-guards.test.js` (add to the existing import destructuring).

2. **Add `describe('personaFreshness')` block** with three test cases:
   - `'fails when the delegated script does not exist'` — call `personaFreshness({ cwd: repo })`, assert `passed === false`, `blocking === true`, `messages.length > 0`.
   - `'fails with captured output when the script exits non-zero'` — call `fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })`, then create `scripts/build-personas.js` in `repo` containing `console.error('Stale persona output'); process.exit(1);`, call `personaFreshness({ cwd: repo })`, assert `passed === false`, `messages.join(' ')` contains `'Stale'`.
   - `'passes when the script exits 0'` — call `fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })`, then create `scripts/build-personas.js` in `repo` containing `process.exit(0);`, call `personaFreshness({ cwd: repo })`, assert `passed === true`, `messages` equals `[]`.

3. **Add `describe('versionSync')` block** with three test cases:
   - `'fails when the delegated script does not exist'` — call `versionSync({ cwd: repo })`, assert `passed === false`, `blocking === true`, `messages.length > 0`.
   - `'fails with captured output when the script exits non-zero'` — call `fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })`, then create `scripts/check-version-sync.js` in `repo` containing `console.error('Version mismatch detected'); process.exit(1);`, call `versionSync({ cwd: repo })`, assert `passed === false`, `messages.join(' ')` contains `'mismatch'`.
   - `'passes when the script exits 0'` — call `fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })`, then create `scripts/check-version-sync.js` in `repo` containing `process.exit(0);`, call `versionSync({ cwd: repo })`, assert `passed === true`, `messages` equals `[]`.

4. **Run the test suite** — `npm test` from the workspace root to verify all existing + new tests pass.

## Dependencies

- None. The test file and module under test already exist.

## Required Components

- `scripts/tests/precommit-guards.test.js` — existing file, modification only
- `scripts/lib/precommit-guards.js` — read-only reference (no changes)

## Assumptions

- The `repo` temp directory from the existing `beforeEach` is reusable for these tests (it provides an isolated filesystem with no `scripts/` subdirectory by default).
- `node` (via `process.execPath`) reliably exits non-zero when invoked with a non-existent module path on all platforms.

## Constraints

- No vitest mocking — matches the existing test file convention.
- No changes to `scripts/lib/precommit-guards.js` — the DI seam already exists.

## Out of Scope

- `npm publish` for `@mistraljs/cli-menu` — reserved for user-initiated release cycle.
- Any changes to the guard implementations themselves.
- Mocking infrastructure or test utilities.

## Acceptance Criteria

- AC-01: `personaFreshness()` has at least one test exercising the failure path (script exits non-zero) and one exercising the success path (script exits 0).
- AC-02: `versionSync()` has at least one test exercising the failure path (script exits non-zero) and one exercising the success path (script exits 0).
- AC-03: Failure-path tests verify that subprocess output is captured in `messages` when available.
- AC-04: All existing tests in the file continue to pass (no regressions).
- AC-05: The full workspace test suite (`npm test` from root) passes.

## Testing Strategy

The plan IS the testing strategy — it adds six new test cases to an existing, well-structured test file. Verification is running the test suite.

## Test Plan

- `scripts/tests/precommit-guards.test.js` → `personaFreshness` → `'fails when the delegated script does not exist'` — asserts failure-path behavior when no script exists — AC-01, AC-04
- `scripts/tests/precommit-guards.test.js` → `personaFreshness` → `'fails with captured output when the script exits non-zero'` — asserts message capture from subprocess stderr — AC-01, AC-03
- `scripts/tests/precommit-guards.test.js` → `personaFreshness` → `'passes when the script exits 0'` — asserts success path — AC-01
- `scripts/tests/precommit-guards.test.js` → `versionSync` → `'fails when the delegated script does not exist'` — asserts failure-path behavior when no script exists — AC-02, AC-04
- `scripts/tests/precommit-guards.test.js` → `versionSync` → `'fails with captured output when the script exits non-zero'` — asserts message capture from subprocess stderr — AC-02, AC-03
- `scripts/tests/precommit-guards.test.js` → `versionSync` → `'passes when the script exits 0'` — asserts success path — AC-02
- Full workspace suite (`npm test`) — asserts no regressions — AC-04, AC-05

## Documentation Updates

- No documentation updates required. This is a test-only change to an internal test file.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | cli-menu CHANGELOG entry + version bump for `formatEntry()` fix | Synthesis `2026-08-25-local-dev-linking-rework-1` → Next Steps #2 | The user explicitly reserved cli-menu release management; the fix is already functional via DEV-link | Schedule when a release cycle for `@mistraljs/cli-menu` is planned |
| 2 | cli-menu package.json version drift (v1.1.0 vs CHANGELOG v1.1.1) | Pre-existing, observed during research | Out of scope for this plan; should be addressed in the cli-menu release cycle | v1.1.1 CHANGELOG entry exists ("Bundle Documentation") but package.json was never bumped |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Temp-dir scripts behave differently across platforms** | `process.execPath` resolves the current Node binary identically on all OSes; `fs.mkdirSync` + `fs.writeFileSync` are cross-platform. The existing test suite already validates this pattern for `noFileProtocolInLocks`. |
| **Subprocess timing or output differences** | `spawnSync` is synchronous — no race conditions. Guard functions trim and filter empty lines, so minor whitespace differences in Node's error output across versions are handled. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-file, single-concern test addition within a well-understood pattern — no cross-cutting changes, no new architecture, self-review is adequate.
