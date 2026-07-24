
# Plan: Multi-Store Ledger Sync — Rework 1

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context

The `2026-07-24-cross-device-ledger-sync` project delivered a full multi-store ledger architecture across 15 work packages (3,838 MCP server tests, 152 workspace script tests, all passing). The synthesis identified 6 strategic recommendations, 4 deferred items, and 7 out-of-scope items. This rework plan addresses all of them.

The repository's strategic vision emphasizes minimal friction — completing multi-store coverage in `project-resolver.ts` removes the last functional gap where agents would silently fail to find projects in non-default stores. The GUI consolidation items align with the mid-term goal of preparing for public availability.

## Summary

Complete the multi-store architecture by addressing every actionable item from the `2026-07-24-cross-device-ledger-sync` synthesis: update `project-resolver.ts` to use `MultiStoreManager.detectProjectByCwd()` (closing the last tool-coverage gap), consolidate the GUI repo listing split-brain and wire `findEntryInStores()` into write handlers, introduce store-scoped insight IDs, extract `SLUG_REGEX` to a shared schema module, harden CLI test isolation, fix edge cases in `storeRemove()` / `expandStorePath()` / `handleOrchestratorStart()`, optimize the Strategy page for single-store mode, add integration tests for `repository-context.ts` multi-store paths, migrate `StoreListItem` to the schema layer, and normalize `updateInsight`/`deleteInsight` error propagation.

## Architectural Context

The multi-store architecture introduced four storage modules (`StoreRegistry`, `StoreRouter`, `MultiStoreManager`, `StoreContext`) and updated 7 MCP tool files, 3 GUI API handlers, and 10 CLI subcommands. The key gap is `project-resolver.ts` — the centralized path resolution utility used by 28 call sites across 7 tool files — which still calls `LedgerStore.detectProjectByCwd()` (single-store). One tool (`getProjectStatus` in `project-lifecycle.ts`) already has a manual multi-store bypass that duplicates the detection logic; all other tools using `resolveProjectPath()` silently fail to find projects in non-default stores.

On the GUI side, `buildRepoRoutes()` in `gui/server.ts` bypasses `handleListRepos()` in multi-store mode with an inline `taggedEntryToRepoListItem()` mapper, making the multi-store branch in `handleListRepos()` dead code. POST/PUT/DELETE routes still hardcode `ledgerRoot` instead of using `findEntryInStores()` (already implemented and working for GET single-repo).

## Approach / Architecture

### A. Complete Multi-Store Tool Coverage

Update `resolveProjectPath()` to detect store context and delegate to `MultiStoreManager.detectProjectByCwd()` when multi-store is active. This single change propagates multi-store awareness to all 28 call sites. Then remove the manual bypass in `getProjectStatus()` that duplicates this logic.

### B. Consolidate GUI Repo Handlers

Choose one canonical path for repo listing: update `buildRepoRoutes()` GET handler to delegate to `handleListRepos()` in all modes, extending `handleListRepos()` to return the multi-store merged view. Remove the inline `taggedEntryToRepoListItem()` from `server.ts`. For write handlers, replace the hardcoded `ledgerRoot` with `findEntryInStores()` lookups for PUT/DELETE, and add `store_id`-based routing for POST.

### C. Store-Scoped Insight IDs

Introduce a `formatted_id` scheme that prefixes the store ID to prevent cross-store collisions: `{store_id}:{counter}` (e.g., `default:1`, `work:3`). The numeric `id` field remains the storage key within each store; the `formatted_id` is a presentation-layer construct used for cross-store disambiguation. This avoids a breaking change to the storage format while eliminating the semantic collision.

### D. Schema & Code Hygiene

Extract `SLUG_REGEX` from `schema/knowledge.ts` to a new `schema/common.ts` (re-export from `knowledge.ts` for backward compatibility). Migrate `StoreListItem` from `gui/api.ts` to `src/schema/store-config.ts`. Normalize the `updateInsight`/`deleteInsight` error propagation to use the same pattern (throw `new Error(...)` on exhaustion in both).

### E. CLI & Edge Case Hardening

Add a `_storesDirOverride` parameter to `saveConfig()` and `storeInit()` so test suites never touch `~/.ai-insights/`. Fix `storeRemove()` to clear `default_store` when all stores are removed. Add an `expandStorePath()` guard rejecting `~username` patterns. Add a test for `handleOrchestratorStart()` with a null project root path. Add a guard in the Strategy page to skip the `getStoreConflicts()` fetch in single-store mode. Add cross-store pagination awareness to the knowledge `limit/offset` forwarding.

## Rationale

This rework plan addresses every item from the synthesis — strategic recommendations, deferred items, and out-of-scope items — because the user explicitly requested full coverage. The grouping combines related items to minimize context switching: project-resolver is standalone (highest priority), GUI repo changes form a natural cluster, schema/knowledge items share the same file surface, and CLI/edge-case fixes are independent.

The `resolveProjectPath()` approach (modifying the centralized utility vs. adding per-tool bypasses) was chosen because it eliminates 28 potential divergence points and removes the existing `getProjectStatus` duplication. The `formatted_id` approach for insight IDs was chosen over UUID migration because it avoids a storage-format breaking change while solving the presentation-layer collision.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Project-resolver multi-store | Modify `resolveProjectPath()` centrally | Per-tool bypass (as done in `getProjectStatus`) | Central change propagates to all 28 call sites automatically; per-tool bypass would require duplicating the multi-store detection logic in 7 files |
| Insight ID scoping | `{store_id}:{counter}` formatted_id | UUID replacement; numeric offset per store | UUID would break storage format and existing API responses; offset requires coordinating counters across independent stores. `formatted_id` is additive and presentation-only |
| GUI repo listing consolidation | Delegate `buildRepoRoutes()` GET to `handleListRepos()` | Keep inline mapper, remove dead code from `handleListRepos()` | Delegating preserves one canonical implementation; keeping inline creates divergence risk when the response shape changes |
| SLUG_REGEX location | New `schema/common.ts` with re-export | Move to `schema/repository-registry.ts`; keep in `knowledge.ts` | `common.ts` is schema-neutral; re-export preserves backward compat. Moving to `repository-registry.ts` trades one coupling for another |
| `saveConfig()` test isolation | `_storesDirOverride` parameter | Mocking `homedir()` globally; environment variable | Parameter override is explicit, hermetic, and matches the existing `configPath` pattern already used for config file location |

## Pattern Alignment

- `resolveProjectPath()` multi-store detection follows the exact pattern already established in `project-lifecycle.ts` (L347–400) — `mcp-server/src/tools/project-lifecycle.ts`
- `findEntryInStores()` usage in write handlers follows the pattern already used in GET single-repo — `mcp-server/gui/api-repos.ts` (L358)
- `schema/common.ts` follows the existing schema module convention — `mcp-server/src/schema/` directory contains focused schema files with Zod exports
- `_storesDirOverride` parameter follows the existing `configPath` override pattern — `scripts/lib/store-commands.js` (L169)

## Detailed Steps

### Step 1: Extract `SLUG_REGEX` to `schema/common.ts`

Create `mcp-server/src/schema/common.ts` containing `SLUG_REGEX`. Update `schema/knowledge.ts` to re-export from `common.ts`. Update `schema/store-config.ts` and `schema/repository-registry.ts` to import from `common.ts`. Update `gui/api-repos.ts` to import from `common.ts`.

**Files:** `mcp-server/src/schema/common.ts` (new), `mcp-server/src/schema/knowledge.ts` (modify), `mcp-server/src/schema/store-config.ts` (modify), `mcp-server/src/schema/repository-registry.ts` (modify), `mcp-server/gui/api-repos.ts` (modify)

### Step 2: Migrate `StoreListItem` to schema layer

Move the `StoreListItem` interface from `mcp-server/gui/api.ts` to `mcp-server/src/schema/store-config.ts` (co-located with the store configuration schema). Update `gui/api.ts` to import from `store-config.ts`. Update any test files that reference the type.

**Files:** `mcp-server/src/schema/store-config.ts` (modify), `mcp-server/gui/api.ts` (modify)

### Step 3: Update `resolveProjectPath()` for multi-store

Modify `mcp-server/src/utils/project-resolver.ts` to:
1. Import `getMultiStoreManager`, `isStoreContextInitialized` from `store-context.ts`.
2. Import `MultiStoreDetectResult` from `multi-store-manager.ts`.
3. In the `cwd_path` branch, check `isStoreContextInitialized()`. If true, call `getMultiStoreManager().detectProjectByCwd()` instead of `LedgerStore.detectProjectByCwd()`.
4. Handle the new `MULTI_STORE_AMBIGUOUS` status with a clear error message listing store-tagged candidates.
5. For `FOUND` and `AMBIGUOUS` statuses, map to the existing return/throw behavior.

Then remove the manual multi-store bypass block in `project-lifecycle.ts` `getProjectStatus()` (L347–400), replacing it with the standard `resolveProjectPath()` call that now handles multi-store internally. Note: `detectProject` is NOT included in this removal — it already calls `getMultiStoreManager().detectProjectByCwd()` directly and is already correct.

**Files:** `mcp-server/src/utils/project-resolver.ts` (modify), `mcp-server/src/tools/project-lifecycle.ts` (modify)

### Step 4: Consolidate GUI repo listing

> **Note (audit finding):** Sub-steps 1 and 3 are already implemented in the codebase. Only sub-step 2 requires implementation.

1. ~~Update `handleListRepos()` in `gui/api-repos.ts` to handle multi-store mode: when `isStoreContextInitialized()`, call `getMultiStoreManager().getMergedRegistry()` and map entries to `RepoListItem` shape (including a `store_id` field). This makes `handleListRepos()` the single canonical implementation.~~ **Already implemented** — `handleListRepos()` has its multi-store branch calling `getMergedRegistry()` with `store_id` mapping.
2. Update the GET `/api/repos` handler in `buildRepoRoutes()` (`gui/server.ts`) to always delegate to `handleListRepos()` — remove the inline `isStoreContextInitialized()` branch and the `taggedEntryToRepoListItem()` helper function.
3. ~~Add `store_id` to the `RepoListItem` type in `gui/api-repos.ts` (optional field, present only in multi-store mode).~~ **Already implemented** — `RepoListItem` already declares `store_id?: string`.

**Files:** `mcp-server/gui/api-repos.ts` (modify), `mcp-server/gui/server.ts` (modify)

### Step 5: Wire `findEntryInStores()` into write handlers

1. Update the PUT `/api/repos/:repoId` handler in `buildRepoRoutes()` (`gui/server.ts`): replace the hardcoded `handleUpdateRepo(ledgerRoot, ...)` call with a lookup using `findEntryInStores()` to locate the owning store, then pass that store path to `handleUpdateRepo()`.
2. Update the DELETE `/api/repos/:repoId` handler similarly.
3. Update the POST `/api/repos` handler to route to the store identified by `store_id` in the request body (already present in `RepoCreateBodySchema`); when omitted, use `getStoreRouter().resolveDefaultStore()`. In single-store mode, route to `ledgerRoot` as before.
4. Verify `handleCreateRepo()`, `handleUpdateRepo()`, `handleDeleteRepo()` in `gui/api-repos.ts` already accept the `storePath`/`ledgerRoot` parameter for their registry I/O — they do, so no handler signature changes are needed.

**Files:** `mcp-server/gui/server.ts` (modify), `mcp-server/gui/api-repos.ts` (modify — import adjustments if needed)

### Step 6: Store-scoped insight `formatted_id`

1. Update the `formatInsightId()` helper in `mcp-server/src/tools/knowledge.ts` to accept an optional `storeId` parameter. When provided, produce `{storeId}:KN-{NNNN}` instead of `KN-{NNNN}`.
2. In the multi-store branches of `addInsight`, `searchInsights`, `listInsights`, `updateInsight`, `deleteInsight`, pass the current store's `store.id` to `formatInsightId()`.
3. In single-store / legacy mode, continue producing the un-prefixed `KN-{NNNN}` format for backward compatibility.

**Files:** `mcp-server/src/tools/knowledge.ts` (modify)

### Step 7: Normalize `updateInsight`/`deleteInsight` error propagation

In `deleteInsight()` (`mcp-server/src/tools/knowledge.ts`, L413–460), replace the `lastError` re-throw pattern with a `throw new Error(...)` pattern matching `updateInsight()`:
- Remove the `lastError` variable.
- After the store iteration loop, if `!found`, throw `new Error(\`Insight with id ${args.id} not found\`)`.

**Files:** `mcp-server/src/tools/knowledge.ts` (modify)

### Step 8: Cross-store knowledge pagination awareness

In `MultiStoreManager.searchKnowledge()` and `listKnowledge()` (`mcp-server/src/storage/multi-store-manager.ts`), change the pagination strategy:
1. Remove the per-store `limit`/`offset` forwarding.
2. Fetch all matching insights from all stores (passing all filters **except** `limit` and `offset` to per-store calls — i.e., pass `scope`, `repository_name`, `category`, and `tags` as-is to preserve per-store filtering efficiency).
3. Apply `limit` and `offset` to the merged, deduplicated result set.
4. This ensures the caller gets exactly `limit` results (when available) regardless of distribution across stores.

**Files:** `mcp-server/src/storage/multi-store-manager.ts` (modify)

### Step 9: Harden `saveConfig()` and `storeInit()` test isolation

1. Add a `_storesDirOverride` parameter to `saveConfig()` in `scripts/lib/store-commands.js`. When provided, use it instead of `join(homedir(), AI_INSIGHTS_DIR)` for the `mkdirSync` call. When omitted, retain the existing behavior.
2. Add the same parameter to `storeInit()` and pass it through to `saveConfig()`. Also use it for the `storesDir` creation (`~/.ai-insights/stores/`).
3. Update existing test files that call `saveConfig()` or `storeInit()` to pass a temp-directory-based override.

**Files:** `scripts/lib/store-commands.js` (modify), `scripts/tests/store-commands.test.js` (modify)

### Step 10: Fix `storeRemove()` dangling `default_store`

In `storeRemove()` (`scripts/lib/store-commands.js`, L241–267), after `config.stores.splice(idx, 1)`, add a guard: if `config.stores.length === 0`, set `config.default_store` to `null` (or an empty string) instead of leaving it pointing to the deleted ID.

**Files:** `scripts/lib/store-commands.js` (modify)

### Step 11: Guard `expandStorePath()` against `~username`

In `expandStorePath()` (`mcp-server/src/storage/store-registry.ts`, L51–58), add a guard before the existing tilde check: if `pathStr` starts with `~` but not `~/` and is not exactly `~`, throw an error: `"Store path '${pathStr}' uses ~username syntax which is not supported. Use ~/path or an absolute path."`.

**Files:** `mcp-server/src/storage/store-registry.ts` (modify)

### Step 12: Add `handleOrchestratorStart()` null-path test

Add a test in the appropriate GUI test file verifying that when `inferProjectRootFromPlanPath(planPath)` returns `null` (e.g., plan path is `/some/path/plan.md` without `/docs/agents/`), the registration check is skipped and `startOrchestrator()` proceeds normally. This codifies the existing behavior documented in the synthesis D-03.

**Files:** `mcp-server/tests/gui/api-orchestrator.test.ts` (new or modify existing)

### Step 13: Skip `getStoreConflicts()` in single-store mode

In `mcp-server/gui/public/views/strategy.js`, update the `refreshConflicts()` function and the initial load to check whether multi-store mode is active before fetching conflicts. Use the `getStores()` response: if only one store exists, skip the `getStoreConflicts()` call and render an empty conflicts tab directly.

**Files:** `mcp-server/gui/public/views/strategy.js` (modify)

### Step 14: Integration tests for `repository-context.ts` multi-store paths

Add `_internal` integration tests (or unit tests with mocked store context) for `repository-context.ts` multi-store code paths:
1. Test that `getRepositoryContext` resolves repository data across multiple stores.
2. Test that insights are aggregated from all stores when `include_insights` is true.
3. Test that `max_projects` correctly limits the cross-store merged project list.

**Files:** `mcp-server/tests/tools/repository-context.test.ts` (new or modify existing)

### Step 15: Tests for all new/modified behavior

Add or update tests for:
1. `resolveProjectPath()` — multi-store detection, `MULTI_STORE_AMBIGUOUS` handling, single-store fallback.
2. `handleListRepos()` — multi-store merged response including `store_id`.
3. Write handler routing — PUT/DELETE via `findEntryInStores()`, POST via `store_id`.
4. `formatInsightId()` — store-scoped `formatted_id` output.
5. `deleteInsight()` — error thrown matches `updateInsight()` shape.
6. Cross-store pagination — merged `limit/offset` semantics.
7. `expandStorePath('~bob')` — throws error.
8. `storeRemove()` — `default_store` cleared when stores array empty.
9. `StoreListItem` import from `schema/store-config.ts`.
10. `SLUG_REGEX` import from `schema/common.ts`.

**Files:** `mcp-server/tests/utils/project-resolver.test.ts` (modify), `mcp-server/tests/gui/api-repos.test.ts` (modify), `mcp-server/tests/tools/knowledge.test.ts` (modify), `mcp-server/tests/storage/store-registry.test.ts` (modify), `mcp-server/tests/storage/multi-store-manager.test.ts` (modify), `scripts/tests/store-commands.test.js` (modify)

## Dependencies

- Step 1 (SLUG_REGEX extraction) must precede Step 2 (StoreListItem migration) since both touch schema files — ordering prevents merge conflicts.
- Step 3 (project-resolver) is independent of all other steps.
- Step 4 (repo listing consolidation) should precede Step 5 (write handler wiring) since both modify `gui/server.ts`.
- Step 6 (scoped insight IDs) should precede Step 7 (error normalization) since both modify `knowledge.ts`.
- Step 8 (pagination) depends on the multi-store knowledge setup from the original plan but is independent of Steps 6–7.
- Steps 9–13 are independent of each other.
- Step 14 (repository-context tests) is independent.
- Step 15 (tests) depends on all implementation steps.

## Required Components

- `mcp-server/src/schema/common.ts` (new)
- `mcp-server/src/schema/store-config.ts` (modify — add `StoreListItem`)
- `mcp-server/src/schema/knowledge.ts` (modify — re-export `SLUG_REGEX`)
- `mcp-server/src/schema/repository-registry.ts` (modify — import source)
- `mcp-server/src/utils/project-resolver.ts` (modify)
- `mcp-server/src/tools/project-lifecycle.ts` (modify — remove bypass)
- `mcp-server/src/tools/knowledge.ts` (modify)
- `mcp-server/src/storage/multi-store-manager.ts` (modify)
- `mcp-server/src/storage/store-registry.ts` (modify)
- `mcp-server/gui/api.ts` (modify — remove `StoreListItem`, import)
- `mcp-server/gui/api-repos.ts` (modify)
- `mcp-server/gui/server.ts` (modify)
- `mcp-server/gui/public/views/strategy.js` (modify)
- `scripts/lib/store-commands.js` (modify)
- Test files across `mcp-server/tests/` and `scripts/tests/`

## Assumptions

- The existing `MultiStoreManager.detectProjectByCwd()` implementation is correct and battle-tested (it was delivered in the original plan and passed all pipeline stages).
- `findEntryInStores()` in `api-repos.ts` is correct for all modes (verified by synthesis WP-013).
- The `taggedEntryToRepoListItem()` function in `server.ts` can be safely removed once `handleListRepos()` handles multi-store mode.
- Test infrastructure for mocking `StoreContext` (via `setStoreContext()`) is already established in the test suite from the original plan.

## Constraints

- No new MCP tool parameters may be added (multi-store routing remains transparent to agents).
- Backward compatibility: single-store / legacy mode must behave identically to before.
- `formatted_id` scoping is presentation-only — the storage format (`id: number`) is not changed.
- `SLUG_REGEX` re-export from `knowledge.ts` must be maintained for backward compatibility of external consumers.

## Out of Scope

- Actual cross-device sync mechanisms (rsync, Syncthing, cloud storage integration) — the MCP server is read-only collation + write routing only.
- GUI unit test framework (the vanilla JS frontend has no automated test coverage by design).
- Orchestrator-side multi-store changes (the orchestrator reads persona files and YAML metadata, not store configs).

## Acceptance Criteria

- AC-01: `resolveProjectPath()` detects projects in non-default stores when multi-store mode is active.
- AC-02: `resolveProjectPath()` returns `MULTI_STORE_AMBIGUOUS` error when the same cwd matches projects in multiple stores.
- AC-03: The manual multi-store bypass in `getProjectStatus()` is removed; the handler uses `resolveProjectPath()` like all other tools.
- AC-04: GET `/api/repos` returns merged results with `store_id` in multi-store mode, delegating to `handleListRepos()` exclusively.
- AC-05: The `taggedEntryToRepoListItem()` function is removed from `gui/server.ts`.
- AC-06: PUT and DELETE `/api/repos/:repoId` locate the correct store via `findEntryInStores()` in multi-store mode.
- AC-07: POST `/api/repos` routes to the store identified by `store_id` in the request body (or default store when omitted).
- AC-08: `formatted_id` includes store prefix in multi-store mode (e.g., `work:KN-0003`) and remains unprefixed in legacy mode.
- AC-09: `updateInsight` and `deleteInsight` use the same error propagation pattern for "not found" exhaustion.
- AC-10: Cross-store knowledge queries with `limit`/`offset` apply pagination to the merged result set, not per-store.
- AC-11: `SLUG_REGEX` is exported from `mcp-server/src/schema/common.ts` and re-exported from `knowledge.ts`.
- AC-12: `StoreListItem` is defined in `mcp-server/src/schema/store-config.ts` and imported by `gui/api.ts`.
- AC-13: `saveConfig()` and `storeInit()` accept a `_storesDirOverride` parameter; tests never create `~/.ai-insights/` directories.
- AC-14: `storeRemove()` sets `default_store` to `null` when all stores are removed.
- AC-15: `expandStorePath('~bob')` throws an error instead of resolving relative to CWD.
- AC-16: A test verifies `handleOrchestratorStart()` skips registration check when `inferProjectRootFromPlanPath()` returns null.
- AC-17: The Strategy page skips `getStoreConflicts()` fetch in single-store mode.
- AC-18: Integration tests cover `repository-context.ts` multi-store code paths (project aggregation, insight aggregation, `max_projects` limiting).
- AC-19: All existing tests continue to pass (no regressions).

## Testing Strategy

Testing follows the existing patterns established in the original multi-store plan:
- **Unit tests** for all modified utility functions (`resolveProjectPath`, `formatInsightId`, `expandStorePath`, `storeRemove`, `saveConfig`).
- **Integration tests** with mocked `StoreContext` for tool-level behavior (`knowledge.ts` multi-store, `repository-context.ts` multi-store).
- **GUI API tests** using the `createServer()/fetch` pattern for repo CRUD handlers.
- **Script tests** using temp directories for CLI store commands.

## Test Plan

- `mcp-server/tests/utils/project-resolver.test.ts` — test multi-store detection via `resolveProjectPath()` with mocked store context; test `MULTI_STORE_AMBIGUOUS` error message format; test single-store fallback unchanged — covers AC-01, AC-02
- `mcp-server/tests/tools/project-lifecycle.test.ts`, `mcp-server/tests/tools/project-lifecycle-multi-store.test.ts` — verify `getProjectStatus` uses `resolveProjectPath()` without manual bypass; verify behavior matches previous bypass; review and update any assertions that tested the bypass-specific code path (direct `getMultiStoreManager()` calls inside `getProjectStatus`) — covers AC-03
- `mcp-server/tests/gui/api-repos.test.ts` — test GET `/api/repos` returns `store_id` in multi-store mode; test PUT/DELETE route to correct store via `findEntryInStores()`; test POST routes to `store_id` target or default — covers AC-04, AC-05, AC-06, AC-07
- `mcp-server/tests/tools/knowledge.test.ts` — test `formatInsightId()` with store prefix; test `deleteInsight` throws consistent error; test cross-store pagination with merged limit/offset — covers AC-08, AC-09, AC-10
- `mcp-server/tests/schema/common.test.ts` — test `SLUG_REGEX` import from `common.ts` — covers AC-11
- `mcp-server/tests/schema/store-config.test.ts` — test `StoreListItem` type import — covers AC-12
- `scripts/tests/store-commands.test.js` — test `saveConfig()` with `_storesDirOverride` does not touch homedir; test `storeInit()` with override; test `storeRemove()` clears `default_store` when empty — covers AC-13, AC-14
- `mcp-server/tests/storage/store-registry.test.ts` — test `expandStorePath('~bob')` throws — covers AC-15
- `mcp-server/tests/gui/api-orchestrator.test.ts` — test `handleOrchestratorStart()` with plan path missing `/docs/agents/` — covers AC-16
- `mcp-server/tests/tools/repository-context.test.ts` — test multi-store project aggregation, insight aggregation, `max_projects` — covers AC-18
- Full test suite run (`npm test` in mcp-server + root) — covers AC-19

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — update `resolveProjectPath()` signature (new multi-store behavior), update `handleListRepos()` (multi-store delegation), update `findEntryInStores()` usage in write handlers, add `formatInsightId()` store-scoped variant, document `StoreListItem` new location, document `SLUG_REGEX` new location in `schema/common.ts`
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add `src/schema/common.ts`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — update write-routing flow for GUI repo CRUD, update project detection flow for multi-store
- `mcp-server/docs/agents/project-manifest/constraints.md` — add constraint for `expandStorePath ~username` rejection, update insight ID scoping constraint
- `mcp-server/src/storage/store-registry.ts` — update `expandStorePath()` JSDoc: remove the caller-responsibility note for `~username` and replace with a statement that the function now throws for `~username` patterns
- `AGENTS.md` (root) — update Cross-System Dependencies table: `SLUG_REGEX` source of truth is now `schema/common.ts`; add `StoreListItem` location; update `formatted_id` scoping note
- `mcp-server/AGENTS.md` — update navigation reference for `schema/common.ts`
- Regenerate `.context/` via `node scripts/cli.js ctx-generate` after all doc updates

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`resolveProjectPath()` change breaks all 28 call sites** | The change is additive (new branch for multi-store, existing single-store path unchanged). Comprehensive existing test suite covers all call sites. Run full test suite after the change. |
| **`handleListRepos()` consolidation changes response shape** | The `RepoListItem` shape is extended with an optional `store_id` field — no fields removed. Frontend code that doesn't use `store_id` is unaffected. |
| **`formatted_id` prefix breaks API consumers** | `formatted_id` is already a presentation-only field (not used as a lookup key). The numeric `id` remains stable. Agents use `id` for update/delete operations. |
| **SLUG_REGEX re-export breaks external consumers** | Re-export from `knowledge.ts` ensures all existing import paths continue to work. |
| **Cross-store pagination changes result counts** | Only affects queries that cross multiple stores with explicit `limit`/`offset`. The new behavior (merged pagination) is strictly more correct than the current one (per-store pagination producing fewer results). |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** 15 steps across 6 distinct codebase areas (schema, tools, storage, GUI, CLI, tests) with cross-cutting dependencies — benefits from formal QA, security audit, and code review stages.
