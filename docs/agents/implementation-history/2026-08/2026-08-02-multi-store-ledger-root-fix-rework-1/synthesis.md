# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0 (findings M-1, M-2, m-1, m-2 addressed)
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

---

## Synthesis

### Completion Status
- Date: 2026-08-03
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-03

### Outcome Summary

All 11 actionable plan steps were implemented: `StoreNotRegisteredError` typed error class introduced in `store-router.ts` and propagated to all callers; `createWorkPackage` routing fixed to use `resolveStoreForWrite`; the auto-archive guard aligned to the two-condition pattern; debug logging added to Python `_load_json()`; `_stores_config_path` pass-through added to both Python helper functions; orchestrator tests updated to call actual helpers; autouse fixture pattern documented in the orchestrator test README; all manifest docs updated; and `.context/` snapshots regenerated.

### Implementation Summary
- **`StoreNotRegisteredError` class** (`mcp-server/src/storage/store-router.ts`): New exported typed error class extending `Error`. Thrown by `resolveStoreForWrite()` instead of anonymous `new Error(...)`. Carries `.repoName` property for direct access without string parsing.
- **Caller refactor** (`project-lifecycle.ts`, `standalone-import.ts`, `knowledge.ts`): All three callers now discriminate via `instanceof StoreNotRegisteredError` instead of `msg.includes('not registered in any store')`, eliminating the string-matching fragility.
- **`createWorkPackage` write routing** (`work-package.ts`): Replaced single `resolveMultiStoreLedgerRoot` call with the full write-routing pattern (matching `initializeProject`). Multi-store mode uses `resolveStoreForWrite` and rejects unregistered repos; single-store/legacy mode falls back to `resolveMultiStoreLedgerRoot` with the test-override path preserved.
- **Auto-archive guard** (`auto-archive.ts`): Added `getStoreRouter().isMultiStoreMode()` check to the two-condition guard pattern, consistent with `gui/api.ts` and `gui/server.ts`.
- **Python `_load_json()` debug logging** (`store_resolution.py`): Added module-level `_logger` and `logging.debug()` call in the `except` branch with `exc_info=True`.
- **`_stores_config_path` pass-through** (`cli.py`, `nodes/__init__.py`): Both `_derive_ledger_log_dir` and `_derive_slug_dir` now accept an optional `_stores_config_path` parameter forwarded to `resolve_store_for_repo()`, enabling direct multi-store test injection.
- **Orchestrator tests** (`test_store_resolution.py`): `TestDeriveSlugDirMultiStore` and `TestDeriveLedgerLogDirMultiStore` now call `_derive_slug_dir()` and `_derive_ledger_log_dir()` directly using the `_stores_config_path` override instead of calling `resolve_store_for_repo()` indirectly. Two new `TestLoadJsonDebugLogging` tests verify debug log output on missing and malformed files.
- **Orchestrator test README**: New "Store Resolution Isolation" section documents the autouse fixture pattern with code example, rationale, existing examples, and the alternative `_stores_config_path` injection approach.
- **Unit tests** (`store-router.test.ts`): New `StoreNotRegisteredError` describe block with 6 tests covering `instanceof Error`, `instanceof StoreNotRegisteredError`, `.repoName`, `.name`, `.message` format, and the throw from `resolveStoreForWrite()`.
- **Integration tests** (`multi-store-tool-resolution.test.ts`): New `createWorkPackage — write routing` describe block with 3 tests: unregistered repo rejection, registered repo in secondary store, and legacy mode with `_ledgerRoot` override.
- **Manifest docs**: Constraint 86 amended with write-routing exception paragraph; `api-surface.md` updated with `StoreNotRegisteredError` export and revised error contract; `data-flows.md` Flow 2 expanded with store-routing step.
- **CTX regeneration**: `node scripts/cli.js ctx-generate` run to completion.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/constraints.md`: Constraint 86 amended with write-routing exception paragraph explaining when `resolveStoreForWrite()` must be used instead of `resolveMultiStoreLedgerRoot()`.
- `mcp-server/docs/agents/project-manifest/api-surface.md`: Added `StoreNotRegisteredError` class export with JSDoc; updated `resolveStoreForWrite()` `@throws` annotation and the trailing "Error contract" paragraph to document `instanceof` as the canonical discrimination mechanism.
- `mcp-server/docs/agents/project-manifest/data-flows.md`: Flow 2 (Work Package Creation) expanded with a store-routing step at the entry point showing both multi-store and legacy paths.
- `orchestrator/tests/README.md`: New "Store Resolution Isolation" section before "Test Tiers".
- `.context/`: Full regeneration via `node scripts/cli.js ctx-generate`.

### Verification Summary
- Tests run: `mcp-server/tests/storage/store-router.test.ts` (30 tests), `mcp-server/tests/tools/multi-store-tool-resolution.test.ts` (21 tests), full `npm test` suite (3918 passed), `orchestrator/tests/test_store_resolution.py` (9 tests), full `python3 -m pytest tests/ -m "not live"` (1139 passed, 6 skipped)
- Static analysis run: TypeScript compile errors checked via `get_errors` throughout; ruff not run separately (no new Python files created)
- Result: All new and existing tests pass. The 101 pre-existing failures in `tests/storage/store-registry.test.ts`, `tests/gui/api-run-metadata.test.ts`, `tests/gui/dispatch-route.test.ts`, `tests/gui/route-structured-format.test.ts`, and `tests/gui/run-log-server.test.ts` were confirmed pre-existing by `git stash` verification — unrelated to this plan's scope.

### Code Insights
- [low] (debt) `mcp-server/src/tools/project-lifecycle.ts` → `initializeProject`: Unlike `createWorkPackage` and `importStandalone`, `initializeProject` does not accept a `_ledgerRoot` test-override parameter. This is intentional (multi-store mode is tested via the registry mechanism) but creates a small asymmetry: tests that want to isolate `initializeProject` to a specific ledger root must use the store-context injection pattern rather than a direct parameter. No action needed unless a new test scenario requires it.
- ~~[low] (improvement) `mcp-server/src/storage/store-router.ts`: Now that `StoreNotRegisteredError` is the first typed error class, the JSDoc comment on `resolveStoreForWrite` in the class body (line ~183) still says `@throws {Error}` rather than `@throws {StoreNotRegisteredError}`. The api-surface.md was updated, but the inline JSDoc in the source was not changed as part of this plan. Minor documentation debt in source code only.~~ **RESOLVED 2026-08-03:** JSDoc updated to `@throws {StoreNotRegisteredError}`.
- ~~[low] (debt) `orchestrator/tests/test_store_resolution.py` → `TestDeriveLedgerLogDirMultiStore`: The test uses `tmp_path / "my-repo" / "docs" / "agents" / "plans" / slug` as the `plan_dir` path, which relies on the implicit assumption that `_derive_repo_name` extracts `parents[3].name` — a depth-4 assumption. If the depth derivation changes, the test will break silently. Consider adding a comment noting this assumption.~~ **RESOLVED 2026-08-03:** Comment updated to document depth-4 assumption.
- [low] (convention) `mcp-server/src/storage/store-router.ts`: `StoreNotRegisteredError` is the only typed error class in the codebase. As noted in the plan's Deferred Items, a dedicated `errors.ts` module would be justified if a second typed error class is added. The current co-location with `store-router.ts` is correct per the plan decision.

### Additional Comments
- The `createWorkPackage` write-routing change is a correctness fix, not just a style alignment. Before this plan, a `createWorkPackage` call in multi-store mode for a repo registered in a non-default store would silently create the WP in the default store's ledger — a phantom write. After this plan, the call correctly routes to the owning store or rejects with an actionable error.
- The existing test in `store-router.test.ts` (`resolveStoreForWrite() — multi-store mode > throws containing "not registered in any store" for unregistered repo (AC 5)`) continues to pass because `StoreNotRegisteredError.message` still contains that string. This backward compatibility was a design requirement preserved by the implementation.
