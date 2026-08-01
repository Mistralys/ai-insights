# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
The prior project `2026-07-24-cross-device-ledger-sync-rework-1` identified this as deferred item D-1 (medium priority) and strategic recommendation #3. WP-009 of that project fixed `MultiStoreManager.searchKnowledge()` and `listKnowledge()` to apply `limit`/`offset` globally after merge, but WP-002's direct-iteration path in `knowledge.ts` was left unfixed. The synthesis explicitly notes: _"callers of `ledger_list_insights` / `ledger_search_insights` in multi-store mode may receive more results than requested."_

## Summary
Fix `listInsights()` in `mcp-server/src/tools/knowledge.ts` to apply `limit` and `offset` globally after merging and deduplicating results from all stores, rather than forwarding them per-store. This closes the last pagination correctness gap: with the current code, a `limit=5` request against two stores each containing 5+ insights can return up to 10 results. After the fix, the caller receives at most 5.

## Architectural Context
The `knowledge.ts` tool file contains five MCP tool handler functions (`addInsight`, `searchInsights`, `listInsights`, `updateInsight`, `deleteInsight`). In multi-store mode (when `isStoreContextInitialized()` returns true), each handler iterates stores directly via `getStoreRouter().getAllStores()` to capture the owning `storeId` per insight — this is required for the `formatted_id` field (scheme `{storeId}:KN-NNNN`), introduced in WP-002.

The `MultiStoreManager` class in `mcp-server/src/storage/multi-store-manager.ts` provides equivalent `searchKnowledge()` / `listKnowledge()` methods with correct global pagination (fixed in WP-009). However, the tool handlers cannot delegate to `MultiStoreManager` because it does not tag results with `storeId` per insight. This is why the direct-iteration path exists.

The `searchInsights()` handler is already correct — it passes only filter parameters per-store and applies `args.limit` globally via `results.slice(0, args.limit)`. The `listInsights()` handler is the only one with the bug.

## Approach / Architecture
Apply the same `{ limit, offset, ...storeOptions }` destructure pattern established in `MultiStoreManager` (WP-009) to the `listInsights()` multi-store branch in `knowledge.ts`:

1. Strip `limit` and `offset` from the arguments before passing to per-store `manager.listInsights()`.
2. Pass only filter parameters (`scope`, `category`, `tags`, `repository_name`) per-store.
3. After the merge+dedup loop completes, apply `offset` then `limit` to the merged result set.

The legacy single-store branch is unchanged — `KnowledgeStoreManager.listInsights()` handles pagination correctly for a single store.

## Rationale
This is the simplest correct fix. The alternative — adding `storeId` tagging to `MultiStoreManager` methods and dropping the direct-iteration path entirely — would be architecturally cleaner but is a larger change that affects the `MultiStoreManager` API surface, its test suite, and all callers. The destructure pattern is a proven, minimal fix that aligns with the existing `searchInsights()` handler and the `MultiStoreManager` reference implementation.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Fix location | In-place destructure in `listInsights()` | Add `storeId` tagging to `MultiStoreManager.listKnowledge()` and drop the direct-iteration path | In-place fix is minimal and proven (mirrors `searchInsights()`); `MultiStoreManager` enhancement is a larger API change for a separate WP |

## Pattern Alignment
- **`{ limit, offset, ...storeOptions }` destructure** — follows the canonical pattern from `MultiStoreManager` (`mcp-server/src/storage/multi-store-manager.ts` L294–L300). No departure.
- **Global post-merge pagination** — follows the same pattern as `searchInsights()` in the same file (`mcp-server/src/tools/knowledge.ts` L195–L200). No departure.

## Detailed Steps

### Step 1: Fix `listInsights()` pagination in multi-store branch

**File:** `mcp-server/src/tools/knowledge.ts`

In the `listInsights()` function's multi-store branch (the `if (isStoreContextInitialized())` block):

1. **Destructure** `args` to separate pagination from filter parameters before the store loop. Extract `limit` and `offset` from `args`, leaving `scope`, `category`, `tags`, and `repository_name` as the per-store filter set.

2. **Strip pagination from per-store calls.** Change the `manager.listInsights()` call to pass only filter parameters:
   ```typescript
   const storeResults = await manager.listInsights({
     scope: args.scope,
     category: args.category,
     tags: args.tags,
     repository_name: args.repository_name,
   });
   ```

3. **Remove the stale comment.** Delete the four-line comment block that says _"Note: limit/offset are forwarded per-store (not applied globally after merge)…"_ — this is the explicit acknowledgement of the bug.

4. **Apply global pagination after the merge loop.** After the `for (const store of stores)` loop and before the `storeIdByInsightId = storeMap` assignment, add:
   ```typescript
   // Apply pagination globally after merge (canonical pattern from WP-009).
   const start = args.offset ?? 0;
   results = args.limit !== undefined
     ? results.slice(start, start + args.limit)
     : results.slice(start);
   ```

### Step 2: Add pagination integration tests

**File:** `mcp-server/tests/tools/knowledge-multi-store.test.ts`

Add a new test describe block `'D-1: listInsights — global pagination after merge'` with three tests:

1. **`limit caps the merged result set globally`** — Seed store-a with 3 real insights (IDs 1–3). Seed store-b with 3 filler insights (IDs 1–3, deduped away) then 3 real insights (IDs 4–6) using `KnowledgeStoreManager.addInsight()`. Merged+deduped set is 6 insights (IDs 1–6 in store-order). Call `listInsights({ limit: 4 })`. Assert result count is exactly 4 (not 6, not 3+3).

2. **`offset skips across the merged set`** — Same seeding as above (merged set: IDs 1, 2, 3, 4, 5, 6). Call `listInsights({ offset: 4 })`. Assert result count is 2. Assert the returned insights do not overlap with those from `listInsights({ limit: 4 })`.

3. **`limit + offset returns the correct window`** — Same seeding. Call `listInsights({ offset: 2, limit: 2 })`. Assert result count is exactly 2. Assert the returned IDs match positions 2–3 of the full merged list (IDs 3 and 4, from `listInsights({})`).

Use the existing test helpers (`initTwoStoreContext`, `parseResult`, `restoreLegacyContext`). Seed data via `KnowledgeStoreManager` directly. Each store's `next_id` counter is independent, so IDs start at 1 in both stores. Use the filler technique from the existing AC4 test (seed store-b with 3 filler insights first to consume IDs 1–3, matching store-a's range) — the 3 real store-b insights then receive IDs 4, 5, 6, which are unique across the merged set.

### Step 3: Verify `searchInsights()` pagination is already correct

**File:** `mcp-server/tests/tools/knowledge-multi-store.test.ts`

Add one confirmatory test in a describe block `'D-1: searchInsights — limit already applied globally'`:

1. **`limit caps the merged search result set globally`** — Seed both stores with insights matching a search term (e.g., "pagination" in title). Call `searchInsights({ query: 'pagination', limit: 3 })`. Assert result count is exactly 3 even though more than 3 matching insights exist across stores.

This test codifies the existing correct behavior and prevents regression.

## Dependencies
- None. All required infrastructure (`KnowledgeStoreManager`, store context helpers, test utilities) already exists.

## Required Components
- `mcp-server/src/tools/knowledge.ts` — modify `listInsights()` multi-store branch
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — add 4 new tests

## Assumptions
- Non-colliding insight IDs across stores can be achieved by seeding with the filler technique (consume overlapping IDs in one store so the real insights get unique IDs), as demonstrated in existing tests.
- The `searchInsights()` handler's existing global `limit` application via `results.slice(0, args.limit)` is correct and does not need an `offset` parameter (the schema does not define one).

## Constraints
- The `formatted_id` tagging via `storeIdByInsightId` map must continue to work correctly after the fix. All insights in the post-pagination `results` array must have their `storeId` present in the `storeMap`.
- The legacy single-store branch must remain unchanged — `KnowledgeStoreManager.listInsights()` handles its own pagination correctly.

## Out of Scope
- Adding `offset` to `SearchInsightsSchema` (separate feature request).
- Refactoring the direct-iteration path to delegate to `MultiStoreManager` with `storeId` tagging (larger architectural change, tracked as a potential follow-up).
- Changes to `MultiStoreManager.searchKnowledge()` / `listKnowledge()` (already correct from WP-009).

## Acceptance Criteria

- AC-01: `ledger_list_insights` with `limit=N` in multi-store mode returns at most N results, regardless of how many insights each store contains.
- AC-02: `ledger_list_insights` with `offset=M` in multi-store mode skips the first M results of the merged+deduped set, not M per-store.
- AC-03: `ledger_list_insights` with `limit=N, offset=M` returns the correct window of the merged set (positions M through M+N-1).
- AC-04: `formatted_id` continues to include the correct `storeId` prefix for all returned insights after pagination is applied.
- AC-05: Legacy single-store mode behavior is unchanged.
- AC-06: Existing `searchInsights()` global limit behavior is codified with a test and not regressed.

## Testing Strategy
Integration tests at the tool-handler level, calling the `listInsights()` and `searchInsights()` functions directly with a two-store context. Tests verify result counts and ID correctness against known seeded data.

## Test Plan

- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — `'D-1: listInsights — global pagination after merge' > 'limit caps the merged result set globally'` — Asserts `limit=4` returns exactly 4 from 6 total cross-store insights — AC-01
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — `'D-1: listInsights — global pagination after merge' > 'offset skips across the merged set'` — Asserts `offset=4` returns exactly 2 from 6 total — AC-02
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — `'D-1: listInsights — global pagination after merge' > 'limit + offset returns the correct window'` — Asserts `offset=2, limit=2` returns positions 2–3 of the full list — AC-03
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — `'D-1: searchInsights — limit already applied globally' > 'limit caps the merged search result set globally'` — Asserts `limit=3` returns exactly 3 from 5+ matching insights — AC-06

AC-04 is covered by the existing WP-002 test `'listInsights: each insight formatted_id reflects its owning store'` in the same test file, which remains unchanged. AC-05 is covered by the existing `knowledge.test.ts` single-store suite, which remains unchanged.

## Documentation Updates
- No manifest updates required — no public interface change (the `ListInsightsSchema` is unchanged; the fix corrects runtime behavior to match the already-documented semantics).
- The stale in-code comment acknowledging the bug is removed as part of Step 1.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Post-pagination `formatted_id` lookup miss** — If pagination slices away insights whose `storeId` was recorded in the map, the map entries become orphaned (harmless). If an insight survives the slice but its ID is missing from the map, `formatted_id` would lack the store prefix. | The `storeMap` is populated during the merge loop (before pagination), so every merged insight has an entry. Pagination only removes entries; it never adds new IDs. The lookup `storeIdByInsightId?.get(insight.id)` is safe. |
| **Dedup + pagination interaction** — If dedup removes many insights from the second store, the effective result count after pagination may be less than `limit` even though the total across stores exceeds it. | This is correct behavior — it mirrors `MultiStoreManager.listKnowledge()`. The caller receives up to `limit` results from the deduplicated set, not from the raw per-store sets. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-file bug fix with tests, within a well-understood pattern (WP-009 destructure), no cross-module or architectural changes.
