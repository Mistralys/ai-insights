# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.3.1
- Architectural Reviews: 1 — Plan Architect Reviewer v1.4.0

## Summary

Address all actionable items from the `2026-05-27-repo-namespaced-ledger-storage` synthesis. The primary deliverable migrates the four remaining dialogue/chunk GUI handlers to use namespaced storage paths (KL-4). Secondary deliverables consolidate the duplicated `assertSafeSlug` into a shared utility (KL-3), harden `resolveRepoName()` with inline guards, and add missing test coverage for the orchestrator's `cli.py` ledger log copy path.

Note: Synthesis item #4 (add `@security` JSDoc to `resolveProjectStore()`) is already resolved — the function's JSDoc already contains the `@remarks **Security contract — AMBIGUOUS → NOT_FOUND downgrade**` block.

## Architectural Context

**Current state of the 4 dialogue/chunk handlers** (in `mcp-server/src/gui/api.ts`):

| Handler | Current path construction | Problem |
|---------|--------------------------|---------|
| `handleListDialogues` | `join(ledgerRoot, slug, DIALOGUES_DIR)` | Non-namespaced: ignores `repoName` param |
| `handleGetDialogueFile` | `join(ledgerRoot, slug, DIALOGUES_DIR)` | Same |
| `handleListChunks` | `join(ledgerRoot, slug, CHUNKS_DIR)` | Same |
| `handleGetChunkFile` | `join(ledgerRoot, slug, CHUNKS_DIR)` | Same |

All four handlers already accept `repoName?: string` as a forward-compatibility stub but ignore it.

**`resolveProjectStore()`** (in `gui/api.ts`, lines 161–207) resolves a `LedgerStore` from slug + optional repoName. It handles AMBIGUOUS → NOT_FOUND downgrade. All other slug-bearing handlers use it.

**`LedgerStore.storageDir`** is a `public readonly string` containing the fully-resolved `{ledgerRoot}/{repoName}/{slug}` path (line 59 of `ledger-store.ts`).

**Three `assertSafeSlug` implementations (KL-3 scope):**
- `src/utils/ledger-root.ts` — throws `Error` (storage layer)
- `src/gui/handlers/run-log-handlers.ts` — throws `ApiError('NOT_FOUND')` (GUI layer)
- `src/gui/api.ts` (~lines 107–111) — inline module-private guard: `if (!slug || !SAFE_SLUG_REGEX.test(slug)) { notFound(…) }` (GUI layer)

All three use `SAFE_SLUG_REGEX` from `constants.ts`. KL-3 in `constraints.md` currently documents only the first two; the third was identified during design review. KL-3 must be updated to reference all three after this plan is implemented.

**`resolveRepoName()`** (in `gui/server.ts`, lines 268–290) reads `.meta.json` but has no internal `assertSafeSlug()` guards — it relies entirely on callers to pre-validate URL params.

**Orchestrator `cli.py` log copy** (lines 860–878): Inline `repo_name = plan_dir.parents[3].name or "unknown"` derivation with no dedicated test. Existing test pattern: `TestDeriveSlugDirFallback` in `orchestrator/tests/test_slug_dir.py`.

## Approach / Architecture

### Step Group A: Migrate Dialogue/Chunk Handlers (KL-4)

Each handler will be updated to resolve the project's storage directory via `resolveProjectStore()`, then construct the subdirectory path using `store.storageDir`:

```typescript
// Before:
assertSafeSlug(slug); // existing guard — must be preserved
const dialoguesDir = join(ledgerRoot, slug, DIALOGUES_DIR);

// After:
assertSafeSlug(slug); // preserved — validates slug before resolveProjectStore
const store = await resolveProjectStore(ledgerRoot, slug, repoName);
const dialoguesDir = join(store.storageDir, DIALOGUES_DIR);
```

This follows the exact same pattern used by every other slug-bearing handler since WP-011. The `repoName` parameter (already in signatures) is now actively passed through.

### Step Group B: Extract Shared Segment Validator (KL-3)

Add a `assertSafeSegment()` function to `src/utils/path-validator.ts` that encapsulates the shared regex check. All three existing `assertSafeSlug` implementations become thin wrappers:

```typescript
// path-validator.ts (new export)
export function assertSafeSegment(segment: string): boolean {
  return !!segment && SAFE_SLUG_REGEX.test(segment);
}
```

Then each layer wraps it:
- Storage layer: `if (!assertSafeSegment(segment)) throw new Error(…);`
- GUI layer: `if (!assertSafeSegment(segment)) throw new ApiError(…);`

The layer error-type separation is preserved. The regex logic is deduplicated into a single testable function.

### Step Group C: Harden `resolveRepoName()`

Add `assertSafeSlug(repoUrlParam)` and `assertSafeSlug(slugUrlParam)` at the top of `resolveRepoName()` so it is safe-by-default if reused. Uses the GUI-layer `assertSafeSlug` already available in the same module scope.

### Step Group D: Orchestrator Log Copy Path Test

Add a `TestLedgerLogCopyPath` test class to `orchestrator/tests/test_slug_dir.py` following the existing `TestDeriveSlugDirFallback` pattern. Parametrize over plan_dir depths to assert the `repo_name` derivation and final `ledger_log_dir` shape.

## Rationale

- **Consistency:** All other handlers already use `resolveProjectStore()`. Keeping dialogue/chunk handlers on a different code path is a maintenance hazard and a data-access failure once flat paths are fully deprecated.
- **Proportionality:** Using `resolveProjectStore()` (rather than a new lighter helper) avoids introducing another abstraction. The overhead of one extra `.meta.json` read is negligible for infrequent GUI endpoints.
- **Defence-in-depth for `resolveRepoName()`:** Adding internal guards eliminates reliance on caller discipline — a single missed validation site elsewhere would not become exploitable.
- **DRY for segment validation:** The regex is already shared via `SAFE_SLUG_REGEX`; what's duplicated is the guard function structure. A shared boolean validator deduplicates without violating layer boundaries.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How to namespace dialogue/chunk paths | Call `resolveProjectStore()` and use `store.storageDir` | Call `resolveProjectDir()` directly (lighter, no LedgerStore) | Consistency with all 15+ other handlers wins over micro-optimization; one file read is negligible for GUI endpoints |
| Shared validator shape | Boolean `assertSafeSegment()` exported from `path-validator.ts` | Generic `assertSafeSlug<E>(segment, ErrorCtor)` with error factory parameter | Boolean return keeps the validator pure and avoids import dependency entanglement; each layer constructs its own error |
| Test location for cli.py | Extend existing `test_slug_dir.py` | New `test_cli_log_copy.py` file | All slug-dir derivation tests are co-located; no need for a separate file |

## Pattern Alignment

- **Handler resolution pattern:** All GUI handlers resolve storage via `resolveProjectStore()` → this plan extends that pattern to the 4 remaining handlers (`mcp-server/src/gui/api.ts`).
- **Layer separation for error types:** Storage layer throws plain `Error`, GUI layer throws `ApiError` — preserved by the boolean-return validator design (`mcp-server/src/utils/path-validator.ts`).
- **Test co-location for slug derivation:** All slug-dir tests live in `orchestrator/tests/test_slug_dir.py` — this plan adds to that file rather than creating a new one.

## Detailed Steps

### Step 1: Add `assertSafeSegment()` to `path-validator.ts`

Add a new exported function that returns a boolean indicating whether a segment passes `SAFE_SLUG_REGEX`. Import `SAFE_SLUG_REGEX` from `constants.ts`.

**File:** `mcp-server/src/utils/path-validator.ts`

### Step 2: Refactor storage-layer `assertSafeSlug` to use `assertSafeSegment()`

Replace the inline regex check with a call to `assertSafeSegment()`. Keep the `throw new Error(…)` unchanged.

**File:** `mcp-server/src/utils/ledger-root.ts`

### Step 3: Refactor GUI-layer `assertSafeSlug` to use `assertSafeSegment()`

Replace the inline regex check with a call to `assertSafeSegment()`. Keep the `throw new ApiError(…)` unchanged.

**File:** `mcp-server/src/gui/handlers/run-log-handlers.ts`

### Step 3a: Refactor inline `assertSafeSlug` guard in `gui/api.ts` to use `assertSafeSegment()`

The module-private inline slug guard at approximately lines 107–111 in `gui/api.ts` (`if (!slug || !SAFE_SLUG_REGEX.test(slug)) { notFound(…) }`) must also be updated to call `assertSafeSegment(slug)`. Import `assertSafeSegment` from `path-validator.ts`. This completes the KL-3 resolution across all three files — `ledger-root.ts` (Step 2), `run-log-handlers.ts` (Step 3), and `gui/api.ts` (this step).

**File:** `mcp-server/src/gui/api.ts`

### Step 4: Migrate `handleListDialogues` to namespaced path

Replace `join(ledgerRoot, slug, DIALOGUES_DIR)` with:
1. Call `resolveProjectStore(ledgerRoot, slug, repoName)` to get the store.
2. Construct `join(store.storageDir, DIALOGUES_DIR)`.

**Important:** Preserve the existing `assertSafeSlug(slug)` call that precedes the path construction — do not remove it. The slug validation guard must remain so that invalid slugs produce a 404 `ApiError` rather than a re-thrown plain `Error` from the storage layer (which would yield a 500 response).

**File:** `mcp-server/src/gui/api.ts`

### Step 5: Migrate `handleGetDialogueFile` to namespaced path

Same approach as Step 4. Replace `join(ledgerRoot, slug, DIALOGUES_DIR)` with `join(store.storageDir, DIALOGUES_DIR)`. The defence-in-depth `startsWith` prefix check uses the new resolved `dialoguesDir`.

**File:** `mcp-server/src/gui/api.ts`

### Step 6: Migrate `handleListChunks` to namespaced path

Replace `join(ledgerRoot, slug, CHUNKS_DIR)` with `join(store.storageDir, CHUNKS_DIR)` via `resolveProjectStore()`.

**File:** `mcp-server/src/gui/api.ts`

### Step 7: Migrate `handleGetChunkFile` to namespaced path

Same pattern as Step 6 for chunks.

**File:** `mcp-server/src/gui/api.ts`

### Step 8: Harden `resolveRepoName()` with `assertSafeSlug()` guards

Add `assertSafeSlug(repoUrlParam)` and `assertSafeSlug(slugUrlParam)` as the first two statements in `resolveRepoName()`.

**File:** `mcp-server/gui/server.ts`

### Step 9: Update `DIALOGUES_DIR` / `CHUNKS_DIR` JSDoc usage comments

The constants in `constants.ts` currently document usage as `path.join(ledgerRoot, slug, …)`. Update to `path.join(store.storageDir, …)` to reflect the namespaced pattern.

**File:** `mcp-server/src/utils/constants.ts`

### Step 10: Add `TestLedgerLogCopyPath` test class to orchestrator

Add parametrized tests asserting:
- `repo_name` derivation from `plan_dir.parents[3].name` for various depths.
- Correct `ledger_log_dir` shape: `{workspace_root}/mcp-server/storage/ledger/{repo_name}/{slug}/orchestrator/logs`.
- Fallback to `"unknown"` when path has fewer than 4 parents.

**File:** `orchestrator/tests/test_slug_dir.py`

### Step 11: Extend `tests/gui/api.test.ts` with namespaced handler tests

Add new `describe` blocks within the existing `mcp-server/tests/gui/api.test.ts` — one block per handler (`describe('handleListDialogues — namespaced', …)` and equivalents for `handleGetDialogueFile`, `handleListChunks`, `handleGetChunkFile`). These blocks sit alongside the existing flat-path handler tests, keeping all coverage for each handler co-located.

Each block verifies:
- The handler reads from the namespaced `{repo}/{slug}/` directory (not flat `{slug}/`).
- The `repoName` parameter is respected when provided.
- Missing project returns 404 (via `resolveProjectStore` NOT_FOUND).

**File:** `mcp-server/tests/gui/api.test.ts` (extend existing)

### Step 12: Remove KL-4 from `constraints.md`

Once the migration is complete, remove the KL-4 section (lines 1897–1910) from constraints.md — the known limitation is resolved. Update KL-3 to reflect the new `assertSafeSegment()` utility.

**File:** `mcp-server/docs/agents/project-manifest/constraints.md`

### Step 13: Update project manifest `api-surface.md`

Add `assertSafeSegment()` to the API surface documentation. Update the dialogue/chunk handler entries to reflect their new dependency on `resolveProjectStore()`. Note that the inline `assertSafeSlug` in `gui/api.ts` is now backed by `assertSafeSegment()` (Step 3a) — no API surface change for the guard itself (it remains module-private), but the documentation for the file should reflect this improvement.

**File:** `mcp-server/docs/agents/project-manifest/api-surface.md`

## Dependencies

- Steps 2, 3, and 3a depend on Step 1 (shared validator must exist before wrappers are refactored).
- Steps 4–7 depend on Steps 1 and 3a (`assertSafeSegment` must be imported in `gui/api.ts` before the inline guard is refactored, which is the same file visit as Steps 4–7).
- Step 8 is independent of all other steps.
- Step 10 is independent of all TypeScript steps.
- Step 11 depends on Steps 4–7.
- Steps 12–13 depend on all implementation steps being complete.

## Required Components

- `mcp-server/src/utils/path-validator.ts` — extend with `assertSafeSegment()`
- `mcp-server/src/utils/ledger-root.ts` — refactor `assertSafeSlug` wrapper
- `mcp-server/src/gui/handlers/run-log-handlers.ts` — refactor `assertSafeSlug` wrapper
- `mcp-server/src/gui/api.ts` — migrate 4 handlers
- `mcp-server/gui/server.ts` — harden `resolveRepoName()`
- `mcp-server/src/utils/constants.ts` — update JSDoc comments
- `mcp-server/docs/agents/project-manifest/constraints.md` — resolve KL-4, update KL-3
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document new export + handler changes
- `orchestrator/tests/test_slug_dir.py` — new test class
- `mcp-server/tests/gui/api.test.ts` — extend with namespaced handler `describe` blocks

## Assumptions

- `resolveProjectStore()` is already imported and available in scope within `gui/api.ts` (confirmed — it's a module-private function in the same file).
- `assertSafeSlug` is available (already imported from the same module or locally defined) in `gui/server.ts` for the hardening step.
- The orchestrator `cli.py` log copy derivation logic will not change shape — we are only adding test coverage, not refactoring the implementation.
- The existing test infrastructure (Vitest for MCP server, pytest for orchestrator) is functional.

## Constraints

- **Layer separation must be preserved:** `assertSafeSegment()` must not throw or import layer-specific error types. It returns a boolean only.
- **No breaking changes to handler signatures:** The 4 handlers already accept `repoName?: string`. The fix makes it functional without changing the public API.
- **Cross-platform compliance:** All path construction uses `join()` / `resolve()` (already the case).

## Out of Scope

- Python 3.14 async compatibility fix for `test_streaming_capture.py` (synthesis explicitly defers to a separate WP).
- Refactoring `resolveProjectStore()` into a lighter `resolveProjectStorageDir()` — deferred unless performance profiling shows the extra `.meta.json` read is problematic.
- Migration or removal of flat-layout backward-compatibility code (still needed for transition period).
- CTX regeneration (operational step after implementation, not a plan item).

## Acceptance Criteria

- AC1: `handleListDialogues`, `handleGetDialogueFile`, `handleListChunks`, `handleGetChunkFile` construct paths using `store.storageDir` from `resolveProjectStore()`.
- AC2: The `repoName` parameter in all 4 handlers is actively used (passed to `resolveProjectStore()`).
- AC3: A shared `assertSafeSegment()` function exists in `path-validator.ts` and is used by all three `assertSafeSlug` implementations (`ledger-root.ts`, `run-log-handlers.ts`, and `gui/api.ts`).
- AC4: `resolveRepoName()` rejects invalid `repoUrlParam` / `slugUrlParam` values before any filesystem access.
- AC5: `orchestrator/tests/test_slug_dir.py` contains a `TestLedgerLogCopyPath` class with parametrized tests covering the `cli.py` repo_name derivation.
- AC6: Integration tests verify the 4 handlers read from namespaced directories and return 404 for missing projects.
- AC7: KL-4 is removed from `constraints.md`, and KL-3 is updated to reference `assertSafeSegment()` — covering all three prior `assertSafeSlug` implementations in `ledger-root.ts`, `run-log-handlers.ts`, and `gui/api.ts`.
- AC8: All existing tests continue to pass (zero regressions).

## Testing Strategy

**Unit tests:**
- `assertSafeSegment()` — test with valid slugs, invalid slugs (traversal, empty, uppercase), edge cases.
- Orchestrator log copy path derivation — parametrized over shallow/deep plan paths.

**Integration tests:**
- Each of the 4 migrated handlers tested against a fixture project stored in a namespaced directory.
- Verify that bare-slug resolution still works (backward-compatible scan).
- Verify that invalid slug/repoName returns 404 not 500.

**Regression:**
- Full `npm test` in `mcp-server/` must pass after all changes.
- Full `pytest` in `orchestrator/` must pass (excluding pre-existing 3.14 failures).

## Test Plan

- `mcp-server/tests/utils/path-validator.test.ts` — `assertSafeSegment()` returns `true` for valid segments, `false` for traversal/empty/invalid — covers AC3
- `mcp-server/tests/gui/api.test.ts` (extend) — `handleListDialogues` reads from `{repo}/{slug}/orchestrator/dialogues/` — covers AC1, AC2, AC6
- `mcp-server/tests/gui/api.test.ts` (extend) — `handleGetDialogueFile` reads from namespaced path — covers AC1, AC2, AC6
- `mcp-server/tests/gui/api.test.ts` (extend) — `handleListChunks` reads from `{repo}/{slug}/orchestrator/chunks/` — covers AC1, AC2, AC6
- `mcp-server/tests/gui/api.test.ts` (extend) — `handleGetChunkFile` reads from namespaced path — covers AC1, AC2, AC6
- `mcp-server/tests/gui/api.test.ts` (extend) — handlers return 404 for non-existent project — covers AC6
- `mcp-server/tests/gui-server.test.ts` (extend) — `resolveRepoName()` rejects traversal input before file read — covers AC4
- `orchestrator/tests/test_slug_dir.py::TestLedgerLogCopyPath` — parametrized: derives `repo_name` from `plan_dir.parents[3]` — covers AC5
- `orchestrator/tests/test_slug_dir.py::TestLedgerLogCopyPath` — parametrized: falls back to `"unknown"` for short paths — covers AC5

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Remove KL-4 section; update KL-3 to document `assertSafeSegment()` consolidation
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `assertSafeSegment()` export; update dialogue/chunk handler entries to note `resolveProjectStore()` dependency
- `mcp-server/src/utils/constants.ts` — Update inline JSDoc usage comments for `DIALOGUES_DIR` and `CHUNKS_DIR` from `join(ledgerRoot, slug, …)` to `join(store.storageDir, …)`
- Root `AGENTS.md` — No changes needed (Cross-System Dependencies table already documents storage layout version and handler migration path)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`resolveProjectStore()` overhead in dialogue/chunk handlers** | Negligible: one `.meta.json` read per request. GUI endpoints are low-frequency. Defer optimization unless profiling shows a problem. |
| **Breaking existing bare-slug dialogue/chunk API calls** | `resolveProjectStore()` already handles bare-slug resolution via `resolveProjectDir()` scan. Backward compatibility is preserved. |
| **Import cycle from `path-validator.ts` importing `SAFE_SLUG_REGEX` from `constants.ts`** | `path-validator.ts` already imports from other modules (`ledger-store.ts`, `project-meta.ts`). `constants.ts` has no reverse dependency on `path-validator.ts`. No cycle risk. |
| **Orchestrator test relies on `plan_dir.parents[3]` index which is fragile** | Mirror the exact same derivation used in production code. If the production code changes depth, the test should be updated together (enforced by existing `_derive_slug_dir` test precedent). |
