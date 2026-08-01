# Synthesis: Multi-Store Ledger Sync — Rework 1

**Project:** 2026-07-24-cross-device-ledger-sync-rework-1  
**Date:** 2026-07-24  
**Status:** COMPLETE  
**Work Packages:** 12 / 12 COMPLETE  

---

## Executive Summary

This project completed the multi-store ledger architecture by resolving every actionable item from the prior `2026-07-24-cross-device-ledger-sync` synthesis. The core deliverable was extending `resolveProjectPath()` with multi-store awareness, closing the last functional gap where 28 call sites across 7 tool files would silently miss projects in non-default stores. Alongside this, 11 additional work packages addressed GUI consolidation, knowledge insight ID scoping, schema hygiene, CLI test isolation, edge case hardening, and pagination correctness — all with full pipeline coverage (implementation → QA → code review → documentation).

The project ran entirely within a single session (2026-07-24) with zero regressions: the test suite grew from 3,842 to 3,883+ tests, all passing. Every WP passed all pipeline stages on the first attempt. Twelve WPs were tracked and all are marked COMPLETE.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 12 / 12 COMPLETE |
| Pipeline Health | 12 / 12 WPs with all stages passing |
| Tests at Start | 3,842 |
| Tests at End | 3,883+ |
| Net New Tests | ~41 |
| Tests Failed | 0 |
| TypeScript Errors | 0 throughout |
| Rework Cycles | 0 (all WPs passed on first attempt) |

### Tests Added per WP

| WP | Focus | New Tests |
|----|-------|-----------|
| WP-001 | `SLUG_REGEX` → `schema/common.ts` | +4 |
| WP-002 | Store-scoped `formatted_id` + error normalization | +17 |
| WP-003 | `resolveProjectPath()` multi-store + bypass removal | +8 |
| WP-004 | `expandStorePath()` `~username` guard | +2 |
| WP-005 | `handleOrchestratorStart()` null root codification | +1 |
| WP-006 | GUI repo listing consolidation | +3 |
| WP-007 | `getRepositoryContext` multi-store integration tests | +4 |
| WP-008 | CLI `_storesDirOverride` + `storeRemove()` null-clear | +1 |
| WP-009 | Global multi-store pagination fix | +5 |
| WP-010 | Strategy page single-store guard | +0 (frontend-only) |
| WP-011 | GUI repo write-handler multi-store routing tests | +9 |
| WP-012 | `StoreListItem` schema layer migration | +1 |

---

## Work Package Outcomes

### WP-001 — Extract `SLUG_REGEX` to `schema/common.ts`
Created `mcp-server/src/schema/common.ts` as the zero-import canonical source for `SLUG_REGEX`. Updated `store-config.ts`, `repository-registry.ts`, and `gui/api-repos.ts` to import from `common.ts`. A `@deprecated` re-export in `knowledge.ts` preserves backward compatibility for two legacy consumers (`knowledge-store.ts`, `tools/knowledge.ts`), documented in `api-surface.md` as known migration candidates.

### WP-002 — Store-Scoped Insight IDs + Error Normalization
Introduced `formatted_id` with the scheme `{storeId}:KN-NNNN` in multi-store mode (bare `KN-NNNN` in legacy). All five insight operations (`add`, `search`, `list`, `update`, `delete`) now return store-tagged identifiers. Normalized `deleteInsight()` to use `throw new Error()` on loop exhaustion — matching `updateInsight()`'s existing pattern — and removed the `lastError` variable. Replaced `MultiStoreManager.searchKnowledge/listKnowledge` calls in knowledge.ts with direct per-store iteration to capture per-insight `storeId`.

### WP-003 — `resolveProjectPath()` Multi-Store Detection
Extended `resolveProjectPath()` with a `isStoreContextInitialized() && isMultiStoreMode()` compound guard that delegates to `MultiStoreManager.detectProjectByCwd()`. Handles all four statuses: `FOUND`, `MULTI_STORE_AMBIGUOUS` (with store-tagged candidate list), `AMBIGUOUS`, and `NOT_FOUND`. Removed the ~55-line manual bypass from `getProjectStatus()` — the last tool using its own duplicate detection logic. All 28 call sites now get multi-store detection automatically.

### WP-004 — `expandStorePath()` `~username` Guard
Added a two-line guard in `expandStorePath()` that throws a descriptive error for `~username` patterns (`~bob`, `~bob/data`). The `~/path` and bare `~` paths continue to expand normally. The JSDoc was updated in both source and `api-surface.md` to accurately describe the new throwing behavior.

### WP-005 — `handleOrchestratorStart()` Null Root Test
Added 1 behavioral codification test to `tests/gui/api-orchestrator.test.ts` confirming that `handleOrchestratorStart()` proceeds normally when `inferProjectRootFromPlanPath()` returns `null` (plan path without `/docs/agents/` segment). No implementation changes were required — existing behavior was already correct.

### WP-006 — GUI Repo Listing Consolidation
Removed `taggedEntryToRepoListItem()` (~25 lines) from `gui/server.ts` and simplified `buildRepoRoutes()` GET `/api/repos` to a single-line delegation to `handleListRepos()`. Removed three now-unused imports (`isStoreContextInitialized`, `getMultiStoreManager`, `TaggedRepositoryEntry`) from `server.ts`. `handleListRepos()` in `api-repos.ts` already handled the multi-store merged view correctly — the dead split-brain code path is eliminated.

### WP-007 — `getRepositoryContext` Multi-Store Integration Tests
Created `tests/tools/repository-context-multi-store.test.ts` with 4 integration tests: cross-store project resolution, cross-store insight aggregation (with ID deduplication workaround documented), `max_projects` cap with sort-order verification, and `setStoreContext()` lifecycle correctness.

### WP-008 — CLI Test Isolation + `storeRemove()` Fix
Added `_storesDirOverride` parameter to `saveConfig()` and `storeInit()` in `store-commands.js`, ensuring tests never write to `~/.ai-insights/`. The third `storeInit()` test was upgraded to directly assert the `stores/` sub-directory is created inside the temp directory. Fixed `storeRemove()` to set `default_store: null` when the last store is removed (previously left a dangling reference to a removed store). Updated `AGENTS.md` to document both changes.

### WP-009 — Multi-Store Knowledge Pagination Fix
Fixed `MultiStoreManager.searchKnowledge()` and `listKnowledge()` to apply `limit`/`offset` globally after merging the deduplicated result set, not per-store. The `{ limit, offset, ...storeOptions }` destructure strips pagination from per-store calls; filters (`scope`, `repository_name`, `category`, `tags`) continue to be forwarded per-store for efficient pre-filtering. With `limit=5` and stores A=3 + B=4, the merged result is exactly 5.

### WP-010 — Strategy Page Single-Store Guard
Updated `renderStrategyList()` and `refreshConflicts()` in `gui/public/views/strategy.js` to skip the `getStoreConflicts()` fetch when `stores.length <= 1`. In single-store mode, the Conflicts tab is omitted from the DOM entirely; in multi-store mode, behavior is unchanged. Verified via Playwright browser testing (network interception confirmed no `/api/store-conflicts` call in single-store mode).

### WP-011 — GUI Repo Write-Handler Multi-Store Routing Tests
Added 9 integration tests to `api-repos.test.ts` covering `handleCreateRepo` (store_id routing to non-default store, default store fallback, invalid store_id rejection), `handleUpdateRepo` (findEntryInStores resolution, store isolation, NOT_FOUND), and `handleDeleteRepo` (same pattern). Production routing code was already correct from prior WPs. Reviewer applied a Fix-Forward merging duplicate `repository-registry.js` import lines.

### WP-012 — `StoreListItem` Schema Layer Migration
Moved `StoreListItem` interface from `gui/api.ts` to `src/schema/store-config.ts`, co-located with `StoreEntry` and `StoresConfig`. `gui/api.ts` re-exports the type for backward compatibility. A shape-verification test was added to `tests/schema/store-config.test.ts`. The stale `Migration candidate` blockquote in `api-surface.md` was removed (Reviewer Fix-Forward) and replaced with an accurate `Location` note.

---

## Strategic Recommendations (Gold Nuggets)

1. **`resetStoreContext()` for test teardown.** The current `restoreLegacyContext()` helper calls `setStoreContext(StoreRouter(null))`, which leaves `isStoreContextInitialized()` returning `true`. Any tool guarding only on `isStoreContextInitialized()` (without the compound `&& isMultiStoreMode()` check) will behave differently in tests vs. production after a teardown. Exporting a `resetStoreContext()` function that sets `_storeRouter = undefined` would be a semantically correct teardown primitive and eliminate this subtle test/production divergence. (Flagged in WP-003 and WP-008.)

2. **Empty `stores.json` should be deleted, not left invalid.** When `storeRemove()` removes the last store, it writes `{ stores: [], default_store: null }`. On next server load, `loadStoresConfig()` rejects this via TypeScript/Zod schema validation (`stores` min(1), `default_store` non-null) and falls back to legacy single-store mode — but emits a stderr warning that will confuse users. Deleting `stores.json` when the last store is removed would be a cleaner transition to legacy mode with no warning. (WP-008 Reviewer, medium-priority.)

3. **`knowledge.ts` direct-iteration path still has per-store limit/offset.** WP-009 fixed `MultiStoreManager.searchKnowledge()` and `listKnowledge()` to apply pagination globally after merge. However, `knowledge.ts` introduced a separate direct-iteration path (WP-002) to capture per-insight `storeId` for `formatted_id`. This path still passes `limit`/`offset` per-store and has no global post-merge slice. A correct fix requires either threading `limit`/`offset` through the direct-iteration path as a post-merge step, or adding a `storeId`-tagged variant to `MultiStoreManager` and dropping the direct-iteration path. (WP-009 Reviewer, medium-priority.)

4. **`{ limit, offset, ...storeOptions }` destructure pattern is canonical.** This pattern, established in WP-009 for `MultiStoreManager`, is the idiomatic way to separate "per-store filter parameters" from "global pagination parameters" in any multi-store aggregation function. Apply it consistently wherever multiple stores are merged and paginated.

5. **`findEntryInStores()` first-match semantics must be documented at creation boundaries.** If a repository ID is accidentally registered in two stores, all GET/PUT/DELETE operations silently target the first-matched store. The JSDoc was updated in WP-011, but the creation path (`handleCreateRepo`) should validate uniqueness across stores before writing, or at minimum surface a warning. Use `GET /api/stores/conflicts` to surface duplicates after the fact. (WP-011 QA edge-case.)

6. **Reviewer Fix-Forward pattern is working well.** Across 10 implementation WPs, reviewers applied 6 in-place Fix-Forward changes (adding explanatory comments, updating stale JSDoc, correcting test comments, merging import lines). None required re-opening a pipeline. This pattern — Reviewer applies non-behavioral fixes directly rather than sending back to Developer — significantly reduces cycle time for low-risk clarity improvements.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed for a future WP)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| D-1 | WP-009 review | Reviewer | Fix `knowledge.ts` direct-iteration path to apply `limit`/`offset` globally after merge (asymmetry with WP-009 fix in `MultiStoreManager`). Requires a rework of the direct-iteration loop in `knowledge.ts`. | Medium |
| D-2 | WP-008 review | Reviewer | When `storeRemove()` removes the last store, delete `stores.json` instead of leaving `{ stores: [], default_store: null }` — the invalid file causes a TypeScript validation warning on next server load. | Medium |
| D-3 | WP-003 dev | Developer | Export `resetStoreContext()` from `store-context.ts` that sets `_storeRouter = undefined` — a semantically correct teardown primitive for tests, replacing the current `restoreLegacyContext()` workaround. | Medium |
| D-4 | WP-001 docs | Documentation | Migrate `src/storage/knowledge-store.ts` and `src/tools/knowledge.ts` from the deprecated `knowledge.ts` re-export of `SLUG_REGEX` to the canonical `schema/common.ts` import. No urgency — the re-export is functional and marked `@deprecated`. | Low |
| D-5 | WP-002 review | Reviewer | `addInsight()` repo-scope branch manually crafts an error message (`'not registered in any store'`) that must stay in sync with `resolveStoreForWrite()`'s own message. Extract to a shared constant in `store-router.ts`. | Low |

### Out-of-Scope (beyond this plan's boundaries)

| # | Source | Agent | Description |
|---|--------|-------|-------------|
| O-1 | WP-010 | Reviewer | GUI Strategy page has no automated test coverage by design. If a test harness is added for the vanilla JS frontend, cover: (a) `getStoreConflicts()` suppression in single-store mode, (b) Conflicts tab DOM presence in multi-store mode. |
| O-2 | WP-011 QA | QA | Cross-store duplicate repo ID detection at creation time — `handleCreateRepo` does not validate uniqueness across stores. `GET /api/stores/conflicts` detects post-creation duplicates. A pre-creation guard would be a dedicated hardening WP. |
| O-3 | WP-011 review | Reviewer | Pre-existing race condition in `handleUpdateRepo`: `findEntryInStores()` finds the entry, then `loadRegistry()` reloads the registry, then `findIndex()` re-locates it. A concurrent deletion between the two reads would produce `registry.repositories[-1]!` → `undefined`. Extremely unlikely in single-writer use, but a future hardening item. |
| O-4 | WP-003 | Reviewer | Error-construction helpers for `AMBIGUOUS` and `NOT_FOUND` cases in `resolveProjectPath()` are duplicated between the multi-store and single-store branches. A `formatCwdNotFoundError()` / `formatAmbiguousError()` helper would reduce duplication if a third branch is ever added. |
| O-5 | WP-012 | Developer/Reviewer | `gui/api.ts` uses both `export type { StoreListItem } from '...'` (re-export) and `import type { StoreListItem } from '...'` (local binding). No other file currently imports `StoreListItem` from `gui/api.ts` — the re-export is precautionary only. Consider removing it if the type is intended to be schema-layer-only going forward. |

---

## Files Modified (All WPs)

**Production source:**
- `mcp-server/src/schema/common.ts` *(new)*
- `mcp-server/src/schema/knowledge.ts`
- `mcp-server/src/schema/store-config.ts`
- `mcp-server/src/schema/repository-registry.ts`
- `mcp-server/src/tools/knowledge.ts`
- `mcp-server/src/utils/project-resolver.ts`
- `mcp-server/src/tools/project-lifecycle.ts`
- `mcp-server/src/storage/store-registry.ts`
- `mcp-server/src/storage/multi-store-manager.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/api-repos.ts`
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/views/strategy.js`
- `scripts/lib/store-commands.js`

**Tests (new or modified):**
- `mcp-server/tests/schema/common.test.ts` *(new)*
- `mcp-server/tests/schema/store-config.test.ts`
- `mcp-server/tests/tools/knowledge-multi-store.test.ts`
- `mcp-server/tests/tools/project-lifecycle-multi-store.test.ts`
- `mcp-server/tests/utils/project-resolver.test.ts`
- `mcp-server/tests/storage/store-registry.test.ts`
- `mcp-server/tests/storage/multi-store-manager.test.ts`
- `mcp-server/tests/gui/api-repos.test.ts`
- `mcp-server/tests/gui/api-orchestrator.test.ts`
- `mcp-server/tests/tools/repository-context-multi-store.test.ts` *(new)*
- `scripts/tests/store-commands.test.js`

**Documentation:**
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/gui/api-repos.ts` *(JSDoc)*
- `AGENTS.md`

---

## Next Steps

The Planner's next cycle should prioritize the three medium-priority deferred items:

1. **D-1 (WP-009 asymmetry):** Fix `knowledge.ts` direct-iteration path to apply global pagination after merge. This is the most impactful remaining correctness gap — callers of `ledger_list_insights` / `ledger_search_insights` in multi-store mode may receive more results than requested.

2. **D-2 (empty stores.json):** Clean up `stores.json` on last-store removal. The current behavior produces a noisy stderr warning on server start — user-visible and confusing.

3. **D-3 (resetStoreContext):** Introduce `resetStoreContext()` for test teardown. Reduces subtle test/production divergence risk that has been flagged repeatedly across multiple WPs.

The low-priority items (D-4, D-5, O-5) can be batched into a housekeeping WP when convenient. The out-of-scope items (O-1 through O-4) are hardening/edge-case candidates for a dedicated robustness pass once the medium-priority items are resolved.
