# Plan

## Summary

Address all remaining strategic recommendations and deferred optimization items from the Ledger Tool Simplification rework-1 synthesis. This covers six items across four concerns: lock path normalization (synthesis #1), `note_only` guard robustness (synthesis #2), AC terminology hygiene process (synthesis #4), `getNextActionsCollector` eager-loading optimization (deferred #6), `workflow-next-action.ts` file split (deferred #7), and `computeHandoffStatus` I/O overhead reduction (deferred #9).

## Architectural Context

The MCP server ([mcp-server/src/](mcp-server/src/)) uses a Repository Pattern backed by JSON files under `storage/ledger/{slug}/`. Concurrent-write protection is handled by `withLock()` from [mcp-server/src/storage/file-lock.ts](mcp-server/src/storage/file-lock.ts). Key files affected by this plan:

- **[mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts)** — 1,527 lines. Contains both single-action logic (`getProjectManagerAction`, `getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction`), batch logic (`getNextActionsCollector`, `buildBatchNextSteps`), and the WAIT-embedding utility (`embedHandoffStatusInWait`). Registered tool: `ledger_get_next_action`.
- **[mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts)** — 1,055 lines. Contains per-agent handoff functions and `computeHandoffStatus()`, which creates a new `LedgerStore` to call the full `getHandoffStatus()` pipeline for each WAIT response.
- **[mcp-server/src/storage/file-lock.ts](mcp-server/src/storage/file-lock.ts)** — 76 lines. `withLock(dir, fn)` implementation.
- **[mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts)** — Uses `withLock(this.storageDir, ...)` internally.
- **8 `withLock` call sites** across tools: `ledger-store.ts` (1, `storageDir`), `observations.ts` (1, `projectPath`), `project-lifecycle.ts` (3, `store.storageDir`), `work-package.ts` (3, `ledgerRoot ?? projectPath`).
- **[scripts/build-personas.js](scripts/build-personas.js)** — Persona build system with `note_only` regression guard at lines 645–660 using `string.includes()` heuristic.

## Approach / Architecture

The plan groups the six items into four work packages, ordered by dependency and risk:

1. **WP-1: Lock path normalization audit** — Normalize all `withLock` call sites to use `store.storageDir` consistently, fixing the `observations.ts` and `work-package.ts` inconsistencies.
2. **WP-2: `workflow-next-action.ts` file split** — Extract batch logic (`getNextActionsCollector`, `buildBatchNextSteps`) and the `embedHandoffStatusInWait` utility into a new `workflow-next-action-batch.ts` module, reducing the main file by ~300 lines. This creates the natural seam needed for deferred #9.
3. **WP-3: `computeHandoffStatus` I/O optimization + `getNextActionsCollector` early-exit** — Thread a pre-loaded `LedgerStore` instance through the `embedHandoffStatusInWait` → `computeHandoffStatus` call chain to avoid redundant I/O. Refactor `getNextActionsCollector` to an early-exit sequential fetch pattern.
4. **WP-4: Persona build guard robustness + AC hygiene documentation** — Replace the `string.includes()` heuristic in the `note_only` guard with a regex-based pattern that survives table format changes. Add a constraint documenting the AC field-name verification practice.

## Rationale

- **Lock normalization first** (WP-1) because it touches multiple files and establishes a clean pattern that later WPs must follow. It's also the lowest risk — purely mechanical.
- **File split before I/O optimization** (WP-2 before WP-3) because WP-3 modifies `embedHandoffStatusInWait` and `getNextActionsCollector`, both of which move in WP-2. Splitting first avoids merge-conflict churn.
- **I/O optimizations together** (WP-3) because `computeHandoffStatus` and `getNextActionsCollector` share the pattern of creating unnecessary `LedgerStore` instances or `Promise.all` calls. Solving them together enables a coherent store-threading pattern.
- **Guard robustness and documentation** (WP-4) is independent and low-risk — scheduled last to allow the higher-value structural work to complete first.

## Detailed Steps

### WP-1: Lock Path Normalization Audit

**Assigned to:** Developer

**Description:** Audit all 8 `withLock` call sites and normalize them to use `store.storageDir` (the canonical lock directory). Two sites currently use `projectPath` directly:

1. **`observations.ts` line 144** — `withLock(projectPath, ...)` — should use `store.storageDir` from the `LedgerStore` created at line 142.
2. **`work-package.ts` lines 248, 910, 978** — `withLock(_ledgerRoot ?? projectPath, ...)` / `withLock(ledgerRoot ?? projectPath, ...)`. These use a fallback pattern. Normalize to `store.storageDir` since a `LedgerStore` is available in scope.

**Implementation:**
1. In `observations.ts`: change `withLock(projectPath, ...)` to `withLock(store.storageDir, ...)`.
2. In `work-package.ts`: for each of the three call sites, replace the `ledgerRoot ?? projectPath` / `_ledgerRoot ?? projectPath` pattern with `store.storageDir`. Confirm that a `LedgerStore` instance is in scope for all three sites (it is — already constructed earlier in each handler).
3. Remove the now-unused `ledgerRoot` / `_ledgerRoot` local variables if they were only used as the lock directory (verify other usages first).
4. Run full test suite to verify no behavioral change.
5. Update `constraints.md` — strengthen Constraint 2 to explicitly state that `store.storageDir` is the *only* acceptable lock path.

**Dependencies:** None

**Acceptance Criteria:**
- All `withLock` call sites use `store.storageDir`.
- No `projectPath` or `ledgerRoot` is passed as the first argument to `withLock` anywhere in `src/tools/`.
- `constraints.md` Constraint 2 documents the normalization rule.
- All existing tests pass (973+).

---

### WP-2: `workflow-next-action.ts` File Split

**Assigned to:** Developer

**Description:** Extract the batch/collector logic and the WAIT-embedding utility from `workflow-next-action.ts` into a new `workflow-next-action-batch.ts` module, reducing the main file from ~1,527 to ~1,200 lines.

**Implementation:**
1. Create `mcp-server/src/tools/workflow-next-action-batch.ts` containing:
   - `getNextActionsCollector()` (currently lines 1362–1512)
   - `buildBatchNextSteps()` (currently lines 1231–1360)
   - `embedHandoffStatusInWait()` (currently lines 284–313)
   - All necessary imports (types, schemas, constants from `workflow-helpers.ts`, `pipeline-maps.ts`, `computeHandoffStatus` from `workflow-handoff.ts`)
2. In `workflow-next-action.ts`:
   - Remove the extracted functions.
   - Import `embedHandoffStatusInWait` and `getNextActionsCollector` from the new module.
   - Update the `_internal` export to re-export the moved functions (backward compatibility for tests).
3. Update `workflow-next-action.test.ts` — verify imports still resolve. The `_internal` re-export should make this transparent.
4. Update manifest docs:
   - `file-tree.md` — add `workflow-next-action-batch.ts` entry.
   - `api-surface.md` — document new module's exports.
   - `tech-stack.md` line referencing batch logic location (if applicable).

**Dependencies:** None (but must complete before WP-3)

**Acceptance Criteria:**
- New file `workflow-next-action-batch.ts` exists and exports `getNextActionsCollector`, `buildBatchNextSteps`, `embedHandoffStatusInWait`.
- `workflow-next-action.ts` is reduced by ~300 lines.
- `_internal` export in `workflow-next-action.ts` continues to expose all previously-exported internals.
- All existing tests pass without modification to test imports.
- `file-tree.md` and `api-surface.md` updated.

---

### WP-3: I/O Optimization — `computeHandoffStatus` Store Threading + `getNextActionsCollector` Early Exit

**Assigned to:** Developer

**Description:** Two related I/O optimizations:

**Part A — `computeHandoffStatus` store threading:**

Currently, `computeHandoffStatus()` in `workflow-handoff.ts` (line 1028) creates a new `LedgerStore` internally by calling `getHandoffStatus()` which constructs one at line 46. When called from `embedHandoffStatusInWait`, the caller (`getNextAction` in `workflow-next-action.ts`) already has a `LedgerStore` and the loaded `rootIndex` + all WP details available. The optimization:

1. Add an optional `store` + `rootIndex` + `wpDetails` parameter set to `computeHandoffStatus`.
2. When provided, skip the `getHandoffStatus()` call and directly invoke the per-role handoff function (which already accepts `wpDetails`, `projectPath`, `store`).
3. Update `embedHandoffStatusInWait` (now in `workflow-next-action-batch.ts` after WP-2) to accept and thread through the store, rootIndex, and wpDetails.
4. Update all call sites of `embedHandoffStatusInWait` in `workflow-next-action.ts` to pass the already-loaded store and WP details.

**Part B — `getNextActionsCollector` early exit:**

Currently, `getNextActionsCollector` loads all WP details via `Promise.all` before iterating. Refactor to sequential fetching with early exit:

1. Replace `const wpDetails = await Promise.all(...)` with a `for...of` loop that reads one WP at a time via `store.readWorkPackage()`.
2. After each WP is processed, check `if (actions.length >= limit) break`.
3. This eliminates unnecessary I/O when the first actionable WP appears early in the list.

**Dependencies:** WP-2 (file split must be done first since both functions move)

**Acceptance Criteria:**
- `computeHandoffStatus` accepts optional `store`/`rootIndex`/`wpDetails` parameters.
- When called from `embedHandoffStatusInWait`, no new `LedgerStore` is created — the existing store is reused.
- When called standalone (from `ledger_get_handoff_status` tool), behavior is unchanged.
- `getNextActionsCollector` fetches WPs sequentially and exits early when `limit` is reached.
- All existing tests pass.
- New test: verify `getNextActionsCollector` stops fetching after `limit` actions found (mock `store.readWorkPackage` to count calls).
- `api-surface.md` updated with new `computeHandoffStatus` signature.

---

### WP-4: Persona Build Guard Robustness + AC Hygiene Documentation

**Assigned to:** Developer

**Description:** Two documentation/tooling improvements:

**Part A — `note_only` guard robustness:**

The `note_only` regression guard in `build-personas.js` (lines 645–660) uses `output.includes('| \`${toolName}\` |')` — a string heuristic coupled to the current Markdown table format. Replace with a regex that tolerates column-spacing and format variations:

1. Replace the `string.includes()` check with a regex: `/\|\s*`toolName`\s*\|/` (escaped backtick boundaries with optional whitespace).
2. Add a unit-style `--check` test in the build system that validates the guard catches a deliberately injected `note_only` tool in test output.

**Part B — AC field-name verification convention:**

Synthesis #4 identified that acceptance criteria text can drift from actual implementation field names. Add a constraint documenting the practice:

1. Add a new constraint to `mcp-server/docs/agents/project-manifest/constraints.md` (next available number) documenting: "Acceptance criteria that reference specific JSON/object field names must be verified against the implementation source before committing the AC text."
2. Add a corresponding note to `personas/docs/agents/project-manifest/constraints.md` for persona-related ACs.

**Dependencies:** None

**Acceptance Criteria:**
- `build-personas.js` `note_only` guard uses regex instead of `string.includes`.
- `--check` mode still detects `note_only` violations correctly.
- New constraint added to `constraints.md` (both MCP server and personas).
- `personas/docs/agents/project-manifest/constraints.md` references the updated guard approach.

---

## Dependencies

- WP-2 must complete before WP-3 (file split before I/O optimization).
- WP-1 and WP-4 are independent and can proceed in parallel with any other WP.
- WP-1 should ideally complete first so WP-3's store-threading work follows the normalized lock pattern.

```
WP-1 (lock normalization) ──→ WP-2 (file split) ──→ WP-3 (I/O optimization)
WP-4 (guard + docs)       ──→ (independent, any time)
```

## Required Components

### Existing files (to modify)
- [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) — extract batch functions (WP-2), update `embedHandoffStatusInWait` call sites (WP-3)
- [mcp-server/src/tools/workflow-handoff.ts](mcp-server/src/tools/workflow-handoff.ts) — update `computeHandoffStatus` signature (WP-3)
- [mcp-server/src/tools/observations.ts](mcp-server/src/tools/observations.ts) — normalize lock path (WP-1)
- [mcp-server/src/tools/work-package.ts](mcp-server/src/tools/work-package.ts) — normalize lock paths (WP-1)
- [scripts/build-personas.js](scripts/build-personas.js) — improve `note_only` guard (WP-4)
- [mcp-server/docs/agents/project-manifest/constraints.md](mcp-server/docs/agents/project-manifest/constraints.md) — new constraints (WP-1, WP-4)
- [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) — new file entry (WP-2)
- [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) — new module exports (WP-2, WP-3)
- [personas/docs/agents/project-manifest/constraints.md](personas/docs/agents/project-manifest/constraints.md) — updated guard doc + AC convention (WP-4)

### New files
- **`mcp-server/src/tools/workflow-next-action-batch.ts`** (NEW, WP-2) — batch logic extracted from `workflow-next-action.ts`

### Test files (to modify/add)
- [mcp-server/tests/tools/workflow-next-action.test.ts](mcp-server/tests/tools/workflow-next-action.test.ts) — verify imports, add early-exit test (WP-3)
- [mcp-server/tests/tools/workflow-handoff.test.ts](mcp-server/tests/tools/workflow-handoff.test.ts) — verify `computeHandoffStatus` with optional params (WP-3)

## Assumptions

- The `observations.ts` lock path inconsistency (`projectPath` vs `store.storageDir`) has not caused production bugs because agents don't issue concurrent writes on the same project, but it is still a correctness concern to normalize.
- The `work-package.ts` `ledgerRoot ?? projectPath` fallback pattern exists for historical reasons; a `LedgerStore` instance is always available at the lock call sites.
- Test count is currently at 973 and all passing.
- `embedHandoffStatusInWait` is called ~10 times in `workflow-next-action.ts` — all call sites must be updated in WP-3 to thread through store/rootIndex/wpDetails.

## Constraints

- **No behavioral changes to MCP tool outputs** — all optimizations are internal. Tool responses must remain byte-identical for the same inputs.
- **Lock ordering** — `propagateDependencyUnblock` calls (Constraint §12.2 Gotcha 8) must remain outside the main lock scope. WP-1 normalization must not change lock ordering.
- **Backward-compatible exports** — `_internal` in `workflow-next-action.ts` must continue to expose all functions for test access.
- **`computeHandoffStatus` standalone path** — the function must still work when called without optional parameters (from `ledger_get_handoff_status` tool).

## Out of Scope

- Refactoring per-agent `get*Action` functions (they remain in `workflow-next-action.ts`).
- Changing `LedgerStore` internal locking (the `updateWorkPackageWithSync` pattern is already correct).
- Performance benchmarking — these optimizations are structural; trigger conditions for measurable impact do not yet exist.
- Changes to `pipeline.ts` lock patterns (already uses `store.storageDir` correctly).

## Acceptance Criteria

- All `withLock` call sites in `src/tools/` use `store.storageDir` exclusively.
- `workflow-next-action.ts` is ≤ 1,250 lines.
- `workflow-next-action-batch.ts` exists and contains batch + WAIT-embedding logic.
- `computeHandoffStatus` reuses the caller's `LedgerStore` when provided.
- `getNextActionsCollector` fetches WPs sequentially with early exit.
- `build-personas.js` `note_only` guard uses regex-based matching.
- Constraints added to both `constraints.md` files.
- Full test suite passes (973+ tests, 0 failures).
- Manifest documents updated: `file-tree.md`, `api-surface.md`, `constraints.md`.

## Testing Strategy

- **WP-1:** Run full test suite after each lock path normalization. No new tests needed — existing concurrent-write tests validate correctness.
- **WP-2:** Run full test suite after extraction. The `_internal` re-export strategy means existing tests should pass without import changes. Verify by running `npm test` with no test modifications.
- **WP-3:** Add 2–3 new tests: (a) `computeHandoffStatus` with pre-loaded store skips `getHandoffStatus`, (b) `getNextActionsCollector` early-exit stops fetching at limit, (c) `embedHandoffStatusInWait` threads store correctly. Verify all 973+ existing tests pass.
- **WP-4:** Run `node scripts/build-personas.js --check` to validate the updated guard catches violations. Manually verify by temporarily removing the `.filter(t => !t.note_only)` line and confirming the guard reports an error.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Lock path change introduces deadlock** | `storageDir` is always a subdirectory of any `projectPath` used previously; `proper-lockfile` uses file-level locks, not directory-level. No concurrent lock holders exist in practice. Run integration tests to validate. |
| **File split breaks imports** | Use `_internal` re-export pattern to maintain backward compatibility. Run full test suite without modifying test files as gate condition. |
| **`computeHandoffStatus` optional param introduces regression** | Standalone path (no params) must remain fully functional. Add explicit regression test for standalone mode. |
| **`getNextActionsCollector` sequential fetch changes response ordering** | WP ordering is deterministic (same `rootIndex.work_packages` array). Sequential fetch preserves insertion order. |
| **Regex guard has edge cases** | Test with various table formats including extra whitespace. The regex `/\|\s*`toolName`\s*\|/` is more permissive than the current heuristic. |
