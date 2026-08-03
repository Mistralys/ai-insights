# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context

The multi-store feature (cross-device ledger sync) was delivered across several recent projects: `2026-08-01-gui-store-management` (full CRUD GUI), its rework-1 (WCAG fixes, concurrency guards), and the earlier infrastructure plans that added `StoreRouter`, `MultiStoreManager`, and `store-context.ts`. The `resolveMultiStoreLedgerRoot` helper was added ad-hoc to `work-package.ts` during the `2026-08-02-repo-modal-move` PM session to unblock bootstrapping, but only 3 out of ~20 handlers were patched. This plan fixes the remaining 16 handlers systematically.

## Summary

Most MCP tool handlers construct `new LedgerStore(projectPath)` without resolving the correct ledger root for multi-store mode. When a project lives in a non-default store, these handlers silently fall back to the default store path, causing "file not found" errors for read operations and phantom directory creation for write operations (via `withLock`'s eager `mkdir`). The same defect affects three additional surfaces beyond the MCP tool layer:

1. **GUI HTTP handlers** (~20 functions in `gui/api.ts`) — `resolveProjectStore()` passes the default `ledgerRoot` to `resolveProjectDir()`, causing projects in non-default stores to appear in the list view but return 404 on every detail/action request.
2. **Auto-archive service** (`src/gui/auto-archive.ts`) — calls `LedgerStore.listAllProjects(ledgerRoot)` which scans only the default store, silently skipping non-default-store projects.
3. **Standalone-import tool** (`src/tools/standalone-import.ts`) — `importStandalone()` and `updateSynthesis()` create `new LedgerStore(planPath)` without multi-store resolution, always importing into the default store regardless of repo registration.

Additionally, the orchestrator's log/chunk file path helpers (`_derive_slug_dir` and `_derive_ledger_log_dir`) hardcode the default single-store path, causing run logs and dialogue chunks to be written to the wrong store directory.

This plan extracts the existing `resolveMultiStoreLedgerRoot` function into a shared utility module and applies it to all broken handlers across the MCP tool layer (16 handlers in 6 files), the GUI API layer, the auto-archive service, and the standalone-import tool. It also fixes the orchestrator's path helpers to read `stores.json` for store resolution, and adds targeted test coverage for all surfaces.

## Architectural Context

The MCP server uses a layered storage architecture:

- **`LedgerStore`** (`src/storage/ledger-store.ts`) — central I/O abstraction. Constructor accepts `(projectPath, ledgerRoot?)`. When `ledgerRoot` is omitted, falls back to `resolveLedgerRoot()` which returns the default storage path.
- **`StoreRouter`** (`src/storage/store-router.ts`) — resolves which store owns a repository by scanning per-store `.repositories.json` registries. Provides `resolveStoreForRepo(repoName)` (read) and `resolveStoreForWrite(repoName)` (write, throws on unregistered repo).
- **`store-context.ts`** (`src/storage/store-context.ts`) — process-level singleton holding the initialized `StoreRouter` and `MultiStoreManager`.
- **Tool handlers** (`src/tools/*.ts`) — each handler resolves `projectPath` via `resolveProjectPath()`, then constructs a `LedgerStore`. The missing step in most handlers is resolving the correct `ledgerRoot` from the store router before constructing `LedgerStore`.

The GUI HTTP server (`gui/server.ts` + `gui/api.ts`) runs as a separate process and initializes its own `StoreRouter` and `MultiStoreManager` at startup (`gui/server.ts` L1430–L1432). The project list endpoint correctly uses `getMultiStoreManager().listAllProjects()` to aggregate across stores, and `getStorePath(meta)` correctly extracts the per-project `store_path` for enrichment. However, every individual project handler receives `ledgerRoot = resolveLedgerRoot()` (the default store) and passes it to `resolveProjectStore()`, which delegates to `resolveProjectDir(slugOrQualified, ledgerRoot)` — a function that only searches the given `ledgerRoot` directory. For namespaced routes, `resolveRepoName(ledgerRoot, repo, slug)` reads `.meta.json` directly from `join(ledgerRoot, repo, slug)` — again only the default store. The result is that projects in non-default stores appear in the list but return 404 on every detail, action, dialogue, chunk, run-log, archive, rename, reset, delete, complete, and health request.

The auto-archive service (`src/gui/auto-archive.ts`) is called on GUI server startup and periodically. It calls `LedgerStore.listAllProjects(ledgerRoot)` — single-store scan — and passes `ledgerRoot` when constructing `LedgerStore` for each eligible project. Projects in non-default stores are invisible to auto-archive.

The standalone-import tool (`src/tools/standalone-import.ts`) has two handlers: `importStandalone()` (line 170) and `updateSynthesis()` (line 277). Both create `new LedgerStore(planPath)` without any `ledgerRoot` parameter, causing imports to always land in the default store. This is inconsistent with `initializeProject()` (in `project-lifecycle.ts` L562–L590) which correctly uses `resolveStoreForWrite(repoName)` for write routing.

The orchestrator (`orchestrator/src/`) is a separate Python process that launches the MCP server as a subprocess and interacts with it exclusively via MCP tool calls. All ledger state operations (claim WP, start pipeline, etc.) go through the MCP server and are automatically fixed by the handler-level changes above. However, the orchestrator also has two direct path computations for non-MCP I/O:

- **`_derive_slug_dir()`** (`orchestrator/src/nodes/__init__.py` L151–L176) — computes the ledger slug directory for `ChunkWriter` (dialogue capture). Hardcodes `workspace_root / "mcp-server" / "storage" / "ledger" / repo_name / slug`.
- **`_derive_ledger_log_dir()`** (`orchestrator/src/cli.py` L131–L150) — computes the ledger storage log directory for run log archiving. Same hardcoded path with `/orchestrator/logs` appended.
- **`_derive_repo_name()`** (`orchestrator/src/cli.py` L106–L128) — derives repo name from path ancestors. Shared by both helpers above.

All three hardcode the default store path and have no awareness of `~/.ai-insights/stores.json`.

The handler-level resolution pattern (already implemented in `getWorkPackage` and `createWorkPackage`) is:
```
1. extractLedgerRoot(testOverride)     → use if present (test injection)
2. isStoreContextInitialized()?        → skip if not (tests, single-store)
3. getStoreRouter().isMultiStoreMode() → skip if false (single-store config)
4. inferProjectRootFromPlanPath()      → derive project root
5. deriveRepoName()                    → derive repo name
6. resolveStoreForRepo(repoName)       → find owning store
7. pass storePath as ledgerRoot to new LedgerStore()
```

## Approach / Architecture

**Extract the shared utility, then apply it uniformly across all affected surfaces.**

1. Move `resolveMultiStoreLedgerRoot()` and `extractLedgerRoot()` from `src/tools/work-package.ts` to a new shared module `src/utils/store-resolution.ts`.
2. Update all 16 broken MCP tool handlers to call `resolveMultiStoreLedgerRoot()` before constructing `LedgerStore`.
3. Fix the GUI API layer: make `resolveProjectStore()` multi-store-aware by iterating all stores when the slug is not found in the default store. Fix `resolveRepoName()` similarly. Fix auto-archive to use `MultiStoreManager.listAllProjects()` and pass per-project `store_path`.
4. Fix standalone-import: add `resolveStoreForWrite()` resolution to `importStandalone()` (mirroring `initializeProject`) and `resolveMultiStoreLedgerRoot()` to `updateSynthesis()`.
5. Add multi-store integration tests for all fixed surfaces.
6. Update `work-package.ts` to import from the shared module instead of defining the functions locally.
7. Add a Python store-resolution utility (`orchestrator/src/utils/store_resolution.py`) that reads `~/.ai-insights/stores.json` and resolves the correct store path for a given repo name, with fallback to the default path.
8. Update `_derive_slug_dir()` and `_derive_ledger_log_dir()` to use the new Python store resolution instead of hardcoding the default path.

For handlers that currently accept `_ledgerRoot?: string` (test override), the shared utility replaces `extractLedgerRoot` — it handles both the test override guard (constraint 58) and the multi-store resolution in one call.

For handlers that currently have no `_ledgerRoot` parameter (e.g., `beginWork`, `startPipeline`), no parameter is added. The shared utility is called with `undefined` as the test override, which correctly falls through to multi-store resolution or the default.

## Rationale

**Option B (shared utility)** was chosen over Option A (centralizing in `LedgerStore` constructor) and Option C (middleware wrapper) because:

- **Preserves `LedgerStore` as a pure storage layer** — no dependency on `store-context.ts` in the storage module. This keeps the layered architecture intact and avoids circular import risks.
- **Minimal refactor** — the function already exists and works. The change is extraction + application, not new logic.
- **Async compatibility** — `resolveStoreForRepo()` is async. Making `LedgerStore` constructor async would require converting all `new LedgerStore()` calls to `await LedgerStore.create()` — a much larger change.
- **New handlers can still forget** — this is mitigated by test coverage and the documented pattern. A future improvement could add a lint rule or a startup validation. **Architectural debt note (from design review):** the "caller must remember" pattern is the exact root cause of this bug class. The design review found three additional surfaces (GUI, auto-archive, standalone-import) with the identical defect — demonstrating that manual audits miss call sites even during careful planning. A `LedgerStore.create()` static async factory would eliminate this defect class permanently but requires migrating ~188 call sites (26 production + 162 test). This is tracked as future architectural debt, not addressed in this fix.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Resolution location | Shared utility (`store-resolution.ts`) | `LedgerStore` constructor (Option A), Middleware wrapper (Option C) | Shared utility preserves the layered architecture and requires no async constructor refactor. Middleware is more complex and may not fit the MCP SDK handler pattern. |
| Utility placement | `src/utils/store-resolution.ts` | Inline in each handler, keep in `work-package.ts` | Dedicated module follows the `project-resolver.ts` extraction pattern. Inline would require duplicating the logic in 6 files. |
| Test approach | Integration tests in new file | Unit tests mocking `StoreRouter` | Integration tests with real temp directories match the established pattern in `project-lifecycle-multi-store.test.ts` and catch real I/O issues. |
| Orchestrator store resolution | Python utility reading `stores.json` + `.repositories.json` | Query MCP server via tool call, hardcode env var | Reading the same JSON files keeps the orchestrator self-contained without adding an MCP round-trip or a new env var to configure. |
| GUI multi-store project resolution | Multi-store-aware `resolveProjectStore()` — iterate stores via `StoreRouter` | Accept `store_path` from frontend as URL parameter | Server-side resolution is more robust: the frontend already has `store_path` from the list endpoint but passing it via URL adds attack surface and couples client to server internals. Server-side resolution keeps the security boundary clean. |
| Standalone-import store routing | `resolveStoreForWrite(repoName)` — mirror `initializeProject()` | `resolveMultiStoreLedgerRoot()` (read resolution) | Write routing is correct for `importStandalone()` (new project creation — must use `resolveStoreForWrite` which throws for unregistered repos). Read resolution is correct for `updateSynthesis()` (existing project — use `resolveMultiStoreLedgerRoot`). |
| Auto-archive multi-store scan | `MultiStoreManager.listAllProjects()` + per-project `store_path` | Iterate stores manually | `MultiStoreManager` already provides the aggregated list with `store_path` tagging — reusing it is simpler and consistent with `handleListProjects` in `gui/api.ts`. |

## Pattern Alignment

- **`project-resolver.ts` extraction pattern** — `src/utils/project-resolver.ts`: This module was extracted from `path-validator.ts` to share project path resolution across handlers. The new `store-resolution.ts` follows the same pattern for store-aware ledger root resolution.
- **`store-context.ts` singleton pattern** — `src/storage/store-context.ts`: The shared utility imports from `store-context.ts`, which is the established pattern for accessing the initialized `StoreRouter` from utility modules (already used by `project-resolver.ts`).
- **Constraint 58 two-layer defence** — `constraints.md` §58: The shared utility preserves both layers: the registration wrapper (no change needed) and the defensive type guard (embedded in the utility).

## Detailed Steps

### Step 1: Create `src/utils/store-resolution.ts`

Create a new shared utility module that exports:

- `extractLedgerRoot(val: unknown): string | undefined` — moved from `work-package.ts`. Guards against `RequestHandlerExtra` injection (constraint 58).
- `resolveMultiStoreLedgerRoot(projectPath: string, testOverride?: unknown): Promise<string | undefined>` — moved from `work-package.ts`. Combines the test override guard with multi-store resolution. Returns `undefined` to signal "use default" (single-store mode, store context not initialized, or repo not registered).

Both functions are pure re-exports of the existing logic — no behavior change.

### Step 2: Update `src/tools/work-package.ts`

- Remove the local `extractLedgerRoot()` and `resolveMultiStoreLedgerRoot()` definitions.
- Import both from `../utils/store-resolution.js`.
- Fix the 6 broken handlers in `work-package.ts`. Note: `listWorkPackages()` uses `new LedgerStore(projectPath)` with no ledger root parameter at all (same category as the handlers in Steps 3–7); the remaining 5 use `extractLedgerRoot` only and need the replacement below.
  - `listWorkPackages()` — add `const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, undefined)` before `new LedgerStore(projectPath)`, change to `new LedgerStore(projectPath, ledgerRoot)`.
  - `claimWorkPackage()` — replace `extractLedgerRoot(_ledgerRoot)` with `await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot)`.
  - `updateWorkPackageStatus()` — same replacement.
  - `resetReworkCount()` — same replacement.
  - `reopenCancelledWp()` — same replacement.
  - `updateAcceptanceCriteria()` — same replacement.

### Step 3: Update `src/tools/pipeline.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix all 4 handlers:
  - `startPipeline()` — add `const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, undefined)` before `new LedgerStore(projectPath)`, pass `ledgerRoot`.
  - `completePipeline()` — same.
  - `cancelPipeline()` — same.
  - `updatePipelineProgress()` — same.

### Step 4: Update `src/tools/begin-work.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix `beginWork()` — add resolution before `new LedgerStore(projectPath)`, pass `ledgerRoot`.

### Step 5: Update `src/tools/observations.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix both handlers:
  - `addObservation()` — add resolution before `new LedgerStore(projectPath)`, pass `ledgerRoot`.
  - `addProjectComment()` — same.

### Step 6: Update `src/tools/workflow-handoff.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix `getHandoffStatus()` — add resolution before `new LedgerStore(projectPath)`, pass `ledgerRoot`.

### Step 7: Update `src/tools/workflow-next-action.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix `getNextAction()` — add resolution before `new LedgerStore(projectPath)`, pass `ledgerRoot`.

### Step 8: Update `src/tools/project-lifecycle.ts`

- Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
- Fix `completeSynthesis()` — replace the inline `typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined` with `await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot)`.
- Leave `getProjectStatus()` as-is (already has correct inline multi-store resolution — refactoring it to use the shared utility is optional cleanup, not a bug fix).

### Step 9: Add comprehensive multi-store integration tests

The test audit reveals that existing multi-store tests cover the storage infrastructure layer (`StoreRouter`, `MultiStoreManager`, `store-context`) and a few tool-level entry points (`listProjects`, `initializeProject`, `detectProject`, `getProjectStatus`, knowledge tools, repository context). However, **16 tool handler functions have zero multi-store test coverage** — these are exactly the handlers being fixed. This bug went undetected precisely because of this gap.

Create two new test files to close the gap completely.

#### 9a. `tests/tools/multi-store-tool-resolution.test.ts` — exhaustive handler coverage

Integration tests that exercise **every** fixed handler against a non-default store. Uses the same test pattern established in `project-lifecycle-multi-store.test.ts`: temp dirs, 2-store config, `setStoreContext()`, repo registration, project initialization.

Test setup (shared across all tests in the file):
1. Create a 2-store configuration (default store at `tempDir/store-a` + secondary store at `tempDir/store-b`).
2. Register a test repo in the **secondary** (non-default) store's `.repositories.json`.
3. Initialize a project via `initializeProject()` routed to the secondary store.
4. Create a work package via `createWorkPackage()`.

Tool handler tests — **every** fixed handler gets at least one dedicated test:

**Work package handlers:**
- `listWorkPackages()` — reads WP list from non-default store, returns correct data.
- `getWorkPackage()` — reads WP detail from non-default store (already fixed, confirms no regression).
- `claimWorkPackage()` — writes WP status transition to non-default store, verify WP file on disk in secondary store.
- `updateWorkPackageStatus()` — transitions WP status in non-default store (e.g., IN_PROGRESS → BLOCKED → READY).
- `resetReworkCount()` — resets rework counter on a WP in non-default store.
- `reopenCancelledWp()` — reopens a CANCELLED WP in non-default store.
- `updateAcceptanceCriteria()` — modifies AC on a WP in non-default store.

**Pipeline handlers:**
- `beginWork()` — combined claim + start pipeline in non-default store.
- `startPipeline()` — starts a pipeline on an IN_PROGRESS WP in non-default store.
- `completePipeline()` — completes a pipeline (PASS) in non-default store.
- `cancelPipeline()` — cancels an IN_PROGRESS pipeline in non-default store.
- `updatePipelineProgress()` — updates pipeline progress summary in non-default store.

**Observation handlers:**
- `addObservation()` — adds a pipeline comment in non-default store.
- `addProjectComment()` — adds a project-level comment in non-default store.

**Workflow routing handlers:**
- `getHandoffStatus()` — reads handoff routing data from non-default store.
- `getNextAction()` — reads next-action recommendation from non-default store.

**Lifecycle handler:**
- `completeSynthesis()` — marks synthesis complete in non-default store.

**Phantom directory assertion (cross-cutting):**
- After all handler tests run, assert that `{defaultStore}/{repoName}/{slug}/` does **not** exist — confirms no phantom directories were created by any handler.

#### 9b. `tests/utils/store-resolution.test.ts` — shared utility unit tests

Unit tests for the extracted utility module:

- `extractLedgerRoot` returns string for string input.
- `extractLedgerRoot` returns `undefined` for non-string (object, null, undefined, number).
- `extractLedgerRoot` returns `undefined` for `RequestHandlerExtra`-shaped object (regression guard for constraint 58).
- `resolveMultiStoreLedgerRoot` returns the override string when a test override is provided (short-circuits all store logic).
- `resolveMultiStoreLedgerRoot` returns `undefined` when store context is not initialized (single-store/test fallback).
- `resolveMultiStoreLedgerRoot` returns `undefined` when `isMultiStoreMode()` is false (single-store config).
- `resolveMultiStoreLedgerRoot` returns the correct `storePath` when the repo is registered in a non-default store.
- `resolveMultiStoreLedgerRoot` returns `undefined` when the repo is not registered in any store (graceful fallback).
- `resolveMultiStoreLedgerRoot` handles `inferProjectRootFromPlanPath` returning `null` gracefully (returns `undefined`).

### Step 10: Create `orchestrator/src/utils/store_resolution.py`

Create a Python module that provides store-aware path resolution for the orchestrator's direct file I/O (log archiving, chunk capture). The module:

1. Reads `~/.ai-insights/stores.json` (same file the MCP server reads). Returns `None` if the file is absent or malformed (single-store fallback).
2. For a given repo name, iterates each store's `.repositories.json` in config order to find which store owns the repo (mirrors `StoreRouter.resolveStoreForRepo()` logic).
3. Returns the resolved store path, or falls back to the default `workspace_root / "mcp-server" / "storage" / "ledger"` path when `stores.json` is absent, the repo is unregistered, or any I/O error occurs.
4. Uses `pathlib.Path` and `json` from stdlib only — no new dependencies.
5. Expands `~` in store paths (mirrors `expandStorePath()` in `store-registry.ts`).

Exported function signature:
```python
def resolve_store_for_repo(
    repo_name: str,
    workspace_root: Path,
    _stores_config_path: Path | None = None,
) -> Path:
    """Return the store path that owns `repo_name`, or the default ledger path.

    `_stores_config_path` is a test-only override; when omitted the function
    reads from ``~/.ai-insights/stores.json``.
    """
```

The `_stores_config_path` parameter exists solely for test isolation. Production callers omit it; tests pass a `tmp_path / 'stores.json'` fixture. This mirrors the `setStoreContext()` injection mechanism used by the TypeScript multi-store tests.

### Step 11: Update orchestrator path helpers

- Update `_derive_slug_dir()` in `orchestrator/src/nodes/__init__.py` to call `resolve_store_for_repo(repo_name, workspace_root)` instead of hardcoding `workspace_root / "mcp-server" / "storage" / "ledger"`.
- Update `_derive_ledger_log_dir()` in `orchestrator/src/cli.py` to call `resolve_store_for_repo(repo_name, workspace_root)` instead of hardcoding the default path.
- Both functions retain their existing fallback behavior — if store resolution returns the default path, the output is identical to the current behavior.

### Step 12: Add orchestrator store resolution tests

Create `orchestrator/tests/test_store_resolution.py` with unit tests. Tests that require a non-default-store `stores.json` use `tmp_path` to write a fake config file and pass it via the `_stores_config_path` parameter:

1. Returns default path when `stores.json` is absent.
2. Returns default path when repo is not registered in any store.
3. Returns correct store path when repo is registered in a non-default store (uses `tmp_path` + `_stores_config_path`).
4. Returns first matching store path when repo appears in multiple stores (config-order priority; uses `tmp_path` + `_stores_config_path`).
5. Handles malformed `stores.json` gracefully (returns default path).
6. Expands `~` in store paths.

### Step 13: Update documentation

- Add `src/utils/store-resolution.ts` to `mcp-server/docs/agents/project-manifest/file-tree.md`.
- Add the exported functions to `mcp-server/docs/agents/project-manifest/api-surface.md`.
- Add a constraint to `constraints.md` documenting the mandatory pattern: "Every tool handler that constructs `LedgerStore` must call `resolveMultiStoreLedgerRoot()` first."
- Add `orchestrator/src/utils/store_resolution.py` to `orchestrator/docs/agents/project-manifest/` file tree and API surface.
- Update the cross-system dependency table in root `AGENTS.md`: add an entry documenting that the orchestrator's `store_resolution.py` reads the same `~/.ai-insights/stores.json` and per-store `.repositories.json` files as the MCP server's `store-registry.ts` / `store-router.ts`.

### Step 14: Fix GUI API — multi-store-aware `resolveProjectStore()`

The GUI's `resolveProjectStore()` (`gui/api.ts` L185) calls `resolveProjectDir(slugOrQualified, ledgerRoot)` which only searches the default store. In multi-store mode, projects in non-default stores are invisible to ~20 GUI handlers that use this function.

**Fix approach:** When `isStoreContextInitialized()` and `getStoreRouter().isMultiStoreMode()`, iterate all store paths via `getStoreRouter().getAllStorePaths()` and call `resolveProjectDir(slugOrQualified, storePath)` for each until a match is found. Pass the matched `storePath` (not the default `ledgerRoot`) to `new LedgerStore(meta.plan_path, storePath)`.

This is a single-function fix — all ~20 GUI handlers delegate to `resolveProjectStore()`, so fixing it once fixes all downstream handlers (detail, work packages, dialogues, chunks, health, archive/unarchive, delete, rename, reset, complete, run metadata).

**Also fix `resolveRepoName()`** (`gui/server.ts` L366) for the same reason — it reads `.meta.json` from `join(ledgerRoot, repo, slug)` which only works in the default store. In multi-store mode, iterate store paths to find the one containing `{repo}/{slug}/.meta.json`.

**Also fix run-log routes** (`gui/server.ts` L1002, L1020) — these construct `join(ledgerRoot, repo, slug, 'orchestrator', 'logs')` hardcoded to the default store. In multi-store mode, resolve the correct store path first.

### Step 15: Fix auto-archive — multi-store project scan

The auto-archive service (`src/gui/auto-archive.ts` L46) calls `LedgerStore.listAllProjects(ledgerRoot)` which only scans the default store.

**Fix approach:**

1. When `isStoreContextInitialized()`, call `getMultiStoreManager().listAllProjects()` instead of `LedgerStore.listAllProjects(ledgerRoot)`. This returns `TaggedProjectMeta[]` with `store_path` on each entry.
2. When constructing `LedgerStore` for archiving (line 75), pass `(meta as TaggedProjectMeta).store_path ?? ledgerRoot` as the `ledgerRoot` parameter.
3. Import `isStoreContextInitialized`, `getMultiStoreManager` from `../storage/store-context.js` and the `TaggedProjectMeta` type.
4. When `isStoreContextInitialized()` is false, fall back to the existing `LedgerStore.listAllProjects(ledgerRoot)` call — preserving single-store behavior.

### Step 16: Fix standalone-import — multi-store write routing

The standalone-import tool (`src/tools/standalone-import.ts`) has two handlers that create `new LedgerStore(planPath)` without multi-store resolution:

**`importStandalone()` (line 170):** This is a write operation (new project creation). Mirror the `initializeProject()` pattern:
1. Import `isStoreContextInitialized`, `getStoreRouter` from `../storage/store-context.js` and `inferProjectRootFromPlanPath`, `deriveRepoName` from `../utils/ledger-root.js`.
2. Before `new LedgerStore(planPath)`, check multi-store mode: if active, derive the repo name from `planPath` and call `getStoreRouter().resolveStoreForWrite(repoName)`.
3. Pass the resolved store path as `ledgerRoot` to `new LedgerStore(planPath, ledgerRoot)`.
4. If `resolveStoreForWrite` throws because the repo is not registered, return an error message matching the `initializeProject` pattern.
5. In single-store mode, fall through to the existing `new LedgerStore(planPath)` behavior.

**`updateSynthesis()` (line 277):** This is a read-then-write operation on an existing project. Use the shared `resolveMultiStoreLedgerRoot()`:
1. Import `resolveMultiStoreLedgerRoot` from `../utils/store-resolution.js`.
2. Before `new LedgerStore(planPath)`, call `const ledgerRoot = await resolveMultiStoreLedgerRoot(planPath, undefined)`.
3. Change to `new LedgerStore(planPath, ledgerRoot)`.

### Step 17: Add GUI and standalone-import multi-store tests

#### 17a. `tests/gui/multi-store-api.test.ts` — GUI multi-store integration tests

Tests verifying that GUI handlers work with projects in non-default stores. Uses the same 2-store temp-dir pattern.

- `resolveProjectStore finds project in non-default store` — verifies the core resolution function.
- `handleGetProject returns data for non-default store project` — end-to-end handler test.
- `handleListWorkPackages returns WPs for non-default store project` — verifies downstream delegation.
- `handleArchiveProject archives project in non-default store` — write operation via GUI.
- `no phantom directory in default store after GUI operations` — cross-cutting guard.

#### 17b. `tests/gui/auto-archive-multi-store.test.ts` — auto-archive multi-store test

- `runAutoArchive archives eligible projects across all stores` — creates COMPLETE projects in both default and non-default stores, verifies both are archived.
- `runAutoArchive does not skip non-default store projects` — creates an eligible project only in the non-default store, verifies it is archived.

#### 17c. `tests/tools/standalone-import-multi-store.test.ts` — standalone-import multi-store tests

- `importStandalone routes to non-default store when repo is registered there` — verifies the import lands in the correct store.
- `importStandalone rejects unregistered repo in multi-store mode` — verifies error message.
- `updateSynthesis reads from non-default store` — verifies synthesis update works for projects in non-default stores.
- `no phantom directory in default store after standalone import` — cross-cutting guard.

## Dependencies

- No external dependencies. All required MCP server infrastructure (`StoreRouter`, `store-context.ts`, `inferProjectRootFromPlanPath`, `deriveRepoName`) already exists.
- The orchestrator's Python store resolution reads the same `stores.json` and `.repositories.json` JSON files — both use stdlib `json` and `pathlib` only.

## Required Components

**MCP tool layer:**
- `src/utils/store-resolution.ts` (new) — shared utility module
- `src/tools/work-package.ts` (modify) — import shared utility, fix 6 handlers
- `src/tools/pipeline.ts` (modify) — import shared utility, fix 4 handlers
- `src/tools/begin-work.ts` (modify) — import shared utility, fix 1 handler
- `src/tools/observations.ts` (modify) — import shared utility, fix 2 handlers
- `src/tools/workflow-handoff.ts` (modify) — import shared utility, fix 1 handler
- `src/tools/workflow-next-action.ts` (modify) — import shared utility, fix 1 handler
- `src/tools/project-lifecycle.ts` (modify) — import shared utility, fix 1 handler
- `src/tools/standalone-import.ts` (modify) — add multi-store write routing to `importStandalone()`, read resolution to `updateSynthesis()`

**GUI layer:**
- `gui/api.ts` (modify) — make `resolveProjectStore()` multi-store-aware (iterate stores)
- `gui/server.ts` (modify) — make `resolveRepoName()` multi-store-aware, fix run-log route path construction
- `src/gui/auto-archive.ts` (modify) — use `MultiStoreManager.listAllProjects()`, pass per-project `store_path`

**Tests:**
- `tests/tools/multi-store-tool-resolution.test.ts` (new) — exhaustive multi-store handler integration tests (17 handler tests + 1 phantom-directory assertion)
- `tests/utils/store-resolution.test.ts` (new) — shared utility unit tests (11 tests)
- `tests/gui/multi-store-api.test.ts` (new) — GUI multi-store integration tests
- `tests/gui/auto-archive-multi-store.test.ts` (new) — auto-archive multi-store tests
- `tests/tools/standalone-import-multi-store.test.ts` (new) — standalone-import multi-store tests

**Orchestrator:**
- `orchestrator/src/utils/store_resolution.py` (new) — Python store resolution utility
- `orchestrator/src/nodes/__init__.py` (modify) — update `_derive_slug_dir()` to use store resolution
- `orchestrator/src/cli.py` (modify) — update `_derive_ledger_log_dir()` to use store resolution
- `orchestrator/tests/test_store_resolution.py` (new) — Python store resolution tests

## Assumptions

- The existing `resolveMultiStoreLedgerRoot()` logic in `work-package.ts` is correct and battle-tested (it was used successfully to fix `getWorkPackage` and `createWorkPackage` during the `2026-08-02-repo-modal-move` session).
- Handlers that currently lack `_ledgerRoot` parameters do not need one added — the shared utility handles the "no test override" case by accepting `undefined`.
- Tests that call internal handlers directly with explicit `_ledgerRoot` strings will continue to work unchanged (the shared utility's first check is the test override, which short-circuits multi-store resolution).

## Constraints

- **Constraint 58 must be preserved**: The `extractLedgerRoot` guard in the shared utility must remain the first check, before any multi-store logic.
- **No circular imports**: `src/utils/store-resolution.ts` imports from `src/storage/store-context.ts` and `src/utils/ledger-root.ts` — both are leaf modules or established import targets. No new circular dependency risk.
- **Cross-platform**: All path operations use `path.join`/`path.resolve`. No hardcoded separators.
- **STDIO discipline**: The shared utility must not write to `stdout` (reserved for MCP protocol).

## Out of Scope

- **Refactoring `getProjectStatus` to use the shared utility** — it already works correctly with inline resolution. Converting it is cosmetic cleanup, not a bug fix.
- **Making `LedgerStore` constructor multi-store-aware** (Option A) — this is a larger architectural change tracked as architectural debt. The design review confirmed it would eliminate this defect class permanently (~188 call sites) but is disproportionate for this fix.
- **Adding a lint rule to enforce the pattern** — desirable but out of scope for this fix. The design review recommends this as a near-term safeguard.
- **Cleaning up existing phantom directories** — users may have empty slug dirs in the wrong store from previous failed operations. A cleanup script could be added later but is not part of this fix.
- **Fixing deprecated run-log routes** (`gui/server.ts` ~L1149 and ~L1184, the deprecated `GET /api/projects/:slug/runs` and `GET /api/projects/:slug/runs/:filename` endpoints) — these call `resolveProjectDir(slug, ledgerRoot)` using the default store and carry the same multi-store bug as the non-deprecated routes at L1002/L1020. They are excluded here because they are marked `@deprecated` and users should migrate to the `/:repo/:slug/runs` variants being fixed in Step 14. A follow-up cleanup can fix or remove the deprecated routes.

## Acceptance Criteria

- AC-01: All 16 broken handler functions resolve the correct `ledgerRoot` via the shared `resolveMultiStoreLedgerRoot()` before constructing `LedgerStore`.
- AC-02: The shared utility `src/utils/store-resolution.ts` exports `extractLedgerRoot` and `resolveMultiStoreLedgerRoot` with the same signatures and behavior as the originals in `work-package.ts`.
- AC-03: Existing tests pass without modification (the shared utility preserves the test override mechanism).
- AC-04: Every fixed handler function has a dedicated multi-store integration test verifying it reads/writes from a non-default store correctly. A cross-cutting assertion verifies no phantom directories are created in the default store.
- AC-05: Project manifest documentation is updated (`file-tree.md`, `api-surface.md`, `constraints.md`).
- AC-06: The orchestrator's `_derive_slug_dir()` and `_derive_ledger_log_dir()` resolve the correct store path by reading `~/.ai-insights/stores.json` and per-store `.repositories.json`, falling back to the default path when `stores.json` is absent.
- AC-07: Orchestrator store resolution has unit test coverage for all fallback paths and the happy path.
- AC-08: GUI handlers return correct data for projects in non-default stores — `resolveProjectStore()` iterates all stores, `resolveRepoName()` finds `.meta.json` across stores, and run-log routes construct paths against the correct store.
- AC-09: Auto-archive scans all stores, not just the default — uses `MultiStoreManager.listAllProjects()` and passes per-project `store_path` when constructing `LedgerStore`.
- AC-10: `importStandalone()` routes to the correct store via `resolveStoreForWrite()` when in multi-store mode, and rejects unregistered repos with a clear error. `updateSynthesis()` resolves the correct store via `resolveMultiStoreLedgerRoot()`.
- AC-11: GUI, auto-archive, and standalone-import surfaces each have dedicated multi-store integration tests with phantom-directory assertions.

## Testing Strategy

This bug went undetected because multi-store test coverage stopped at the infrastructure layer — `StoreRouter`, `MultiStoreManager`, and a handful of lifecycle tools — while the tool handlers, GUI handlers, auto-archive, and standalone-import had zero multi-store tests. The testing strategy closes this gap exhaustively across all affected surfaces:

1. **Exhaustive MCP handler integration tests**: A new test file (`multi-store-tool-resolution.test.ts`) exercises **every** fixed handler (not a representative sample) against a non-default store. Each handler gets a dedicated test that verifies it reads from or writes to the correct store.
2. **Shared utility unit tests**: A new test file (`store-resolution.test.ts`) covers the extracted `extractLedgerRoot` and `resolveMultiStoreLedgerRoot` functions with unit tests for all code paths: test override, store-context-not-initialized, single-store mode, multi-store resolution, unregistered repo fallback, and null project root.
3. **GUI multi-store integration tests**: A new test file (`multi-store-api.test.ts`) verifies that `resolveProjectStore()`, `handleGetProject()`, `handleListWorkPackages()`, and `handleArchiveProject()` work with projects in non-default stores.
4. **Auto-archive multi-store tests**: A new test file (`auto-archive-multi-store.test.ts`) verifies that `runAutoArchive()` scans all stores and archives eligible projects regardless of which store they reside in.
5. **Standalone-import multi-store tests**: A new test file (`standalone-import-multi-store.test.ts`) verifies that imports route to the correct store and that `updateSynthesis()` resolves the correct store for existing projects.
6. **Phantom directory assertions**: Every integration test file explicitly checks that the default store does not contain the test project's slug directory after all handler operations complete — this catches any handler that still constructs `LedgerStore` without store resolution.
7. **Orchestrator store resolution tests**: Python unit tests cover all fallback paths and the happy path for the new `resolve_store_for_repo()` function.
8. **Regression testing**: The full existing test suite must pass without modification, confirming the shared utility preserves backward compatibility for single-store mode and test overrides.

## Test Plan

### `tests/tools/multi-store-tool-resolution.test.ts` — exhaustive handler coverage

Work package handlers:
- `listWorkPackages reads from non-default store` — AC-01, AC-04
- `getWorkPackage reads from non-default store` — AC-04 (regression guard for already-fixed handler)
- `claimWorkPackage writes to non-default store` — AC-01, AC-04
- `updateWorkPackageStatus transitions in non-default store` — AC-01, AC-04
- `resetReworkCount writes to non-default store` — AC-01, AC-04
- `reopenCancelledWp writes to non-default store` — AC-01, AC-04
- `updateAcceptanceCriteria writes to non-default store` — AC-01, AC-04

Pipeline handlers:
- `beginWork (claim+pipeline) in non-default store` — AC-01, AC-04
- `startPipeline starts pipeline in non-default store` — AC-01, AC-04
- `completePipeline completes pipeline in non-default store` — AC-01, AC-04
- `cancelPipeline cancels pipeline in non-default store` — AC-01, AC-04
- `updatePipelineProgress writes to non-default store` — AC-01, AC-04

Observation handlers:
- `addObservation writes to non-default store` — AC-01, AC-04
- `addProjectComment writes to non-default store` — AC-01, AC-04

Workflow routing handlers:
- `getHandoffStatus reads from non-default store` — AC-01, AC-04
- `getNextAction reads from non-default store` — AC-01, AC-04

Lifecycle handler:
- `completeSynthesis writes to non-default store` — AC-01, AC-04

Cross-cutting:
- `no phantom directories in default store` — AC-04

### `tests/utils/store-resolution.test.ts` — shared utility unit tests

- `extractLedgerRoot returns string for string input` — AC-02
- `extractLedgerRoot returns undefined for non-string (object)` — AC-02
- `extractLedgerRoot returns undefined for null` — AC-02
- `extractLedgerRoot returns undefined for undefined` — AC-02
- `extractLedgerRoot returns undefined for RequestHandlerExtra-shaped object` — AC-02
- `resolveMultiStoreLedgerRoot returns override when string provided` — AC-02
- `resolveMultiStoreLedgerRoot returns undefined when store context not initialized` — AC-02
- `resolveMultiStoreLedgerRoot returns undefined when isMultiStoreMode is false` — AC-02
- `resolveMultiStoreLedgerRoot returns storePath for registered repo` — AC-02
- `resolveMultiStoreLedgerRoot returns undefined for unregistered repo` — AC-02
- `resolveMultiStoreLedgerRoot handles null project root gracefully` — AC-02

### Regression
- Full existing test suite — All existing tests pass — AC-03
- `orchestrator/tests/test_store_resolution.py` — `returns default path when stores.json absent` — Asserts fallback behavior — AC-06, AC-07
- `orchestrator/tests/test_store_resolution.py` — `returns default path when repo unregistered` — Asserts unregistered-repo fallback — AC-06, AC-07
- `orchestrator/tests/test_store_resolution.py` — `returns correct store for registered repo` — Asserts multi-store resolution — AC-06, AC-07
- `orchestrator/tests/test_store_resolution.py` — `config-order priority when repo in multiple stores` — Asserts first-match wins — AC-06, AC-07
- `orchestrator/tests/test_store_resolution.py` — `handles malformed stores.json gracefully` — Asserts error resilience — AC-06, AC-07
- `orchestrator/tests/test_store_resolution.py` — `expands tilde in store paths` — Asserts path expansion — AC-06, AC-07

### `tests/gui/multi-store-api.test.ts` — GUI multi-store integration tests

- `resolveProjectStore finds project in non-default store` — AC-08, AC-11
- `handleGetProject returns data for non-default store project` — AC-08, AC-11
- `handleListWorkPackages returns WPs for non-default store project` — AC-08, AC-11
- `handleArchiveProject archives project in non-default store` — AC-08, AC-11
- `no phantom directory in default store after GUI operations` — AC-11

### `tests/gui/auto-archive-multi-store.test.ts` — auto-archive multi-store tests

- `runAutoArchive archives eligible projects across all stores` — AC-09, AC-11
- `runAutoArchive does not skip non-default store projects` — AC-09, AC-11

### `tests/tools/standalone-import-multi-store.test.ts` — standalone-import multi-store tests

- `importStandalone routes to non-default store when repo is registered there` — AC-10, AC-11
- `importStandalone rejects unregistered repo in multi-store mode` — AC-10, AC-11
- `updateSynthesis reads from non-default store` — AC-10, AC-11
- `no phantom directory in default store after standalone import` — AC-11

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `src/utils/store-resolution.ts` entry
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `extractLedgerRoot()` and `resolveMultiStoreLedgerRoot()` signatures; document the multi-store-aware behavior of `resolveProjectStore()` in the GUI API surface
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add new constraint: "Every code path constructing `LedgerStore` — tool handlers, GUI handlers, background services, and import tools — must resolve the correct store in multi-store mode before passing `ledgerRoot` to the constructor"
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update auto-archive data flow to reflect multi-store scan; add a note to the GUI project-detail data flow documenting that `resolveProjectStore()` now iterates all store paths in multi-store mode; add a note to the standalone-import data flow documenting that `importStandalone()` routes to the registered store via `resolveStoreForWrite()`
- `orchestrator/docs/agents/project-manifest/` — Add `src/utils/store_resolution.py` to file tree and API surface
- Root `AGENTS.md` cross-system dependency table — Add entry: orchestrator `store_resolution.py` reads `~/.ai-insights/stores.json` (shared with MCP server `store-registry.ts`) and per-store `.repositories.json` (shared with `repository-registry.ts`)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Missed handler** — a handler is overlooked during the fix | The grep search for `new LedgerStore(` across `src/tools/`, `gui/api.ts`, `gui/server.ts`, and `src/gui/` identifies all instances. The integration test's phantom-directory checks across all test files would catch any handler that still writes to the wrong store. The design review's audit of the entire codebase surfaced three additional surfaces (GUI, auto-archive, standalone-import) that the original plan missed — all are now included. |
| **Circular import introduced** — the new utility creates an import cycle | `store-resolution.ts` imports from `store-context.ts` (singleton) and `ledger-root.ts` (pure functions) — both are leaf modules already imported by `project-resolver.ts` with no issues. |
| **Test suite regression** — existing tests break due to changed import paths | The shared utility preserves identical function signatures. Tests that import `extractLedgerRoot` from `work-package.ts` would need import path updates, but this function is not currently exported or imported by tests — it's module-private. |
| **`resolveStoreForRepo` returns null for unregistered repo** — handler falls through to default store | This is the correct behavior for read operations (graceful degradation). For write operations, the write will go to the default store — same as single-store mode. `initializeProject` already uses `resolveStoreForWrite` which throws for unregistered repos. Other write operations write to existing projects, which were initialized in the correct store. |
| **Orchestrator Python resolution diverges from TypeScript** — the Python reimplementation of `stores.json` + `.repositories.json` parsing could drift from the TypeScript version | The JSON schemas are simple and stable (validated by Zod in TS, used as plain dicts in Python). The cross-system dependency entry in `AGENTS.md` documents the sync point. Both implementations degrade to the default path on any parse error, so a schema mismatch causes fallback rather than failure. |
| **GUI `resolveProjectStore` iteration perf** — iterating all stores on every request could be slow with many stores | In practice, users configure 2–3 stores (the feature is cross-device sync, not sharding). The iteration is sequential directory probes — sub-millisecond per store. No caching needed at this scale. |
| **`importStandalone` rejecting unregistered repos** — users may be surprised by the new error in multi-store mode | This matches the existing `initializeProject` behavior — both write operations require repo registration in multi-store mode. The error message instructs the user to register via the CLI, same as `initializeProject`. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The fix spans 10+ source files across 2 sub-projects (MCP server + orchestrator) plus tests and documentation, benefiting from formal QA and review stages to verify the mechanical changes don't introduce regressions.
