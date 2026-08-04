# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The ai-insights repository has 176 completed projects. Recent GUI work (repo-modal-move, repo-modal-move-rework-1) established the multi-store collation pattern for repositories and projects. A full audit of all GUI route handlers revealed two subsystems that still operate on a single `ledgerRoot` rather than collating across all configured stores: the knowledge API handlers and the orchestrator queue's project-ledger-status checks. The `MultiStoreManager` already has `listKnowledge()` and `searchKnowledge()` methods, but no GUI consumer uses them. The queue module's `getProjectLedgerStatus()` has never been multi-store aware.

## Full Multi-Store Audit

Every GUI handler file was audited for multi-store awareness. The following table summarizes the results:

| File | Status | Method |
|------|--------|--------|
| `gui/api.ts` — `handleListProjects` | Multi-store aware | `getMultiStoreManager().listAllProjects()` |
| `gui/api.ts` — `resolveProjectStore` | Multi-store aware | Iterates `getAllStorePaths()` |
| `gui/api.ts` — all project CRUD handlers | Multi-store aware | Delegate to `resolveProjectStore()` |
| `gui/api.ts` — `handleOrchestratorStart` | Multi-store aware | Uses `getStoreRouter().resolveStoreForRepo()` |
| `gui/api.ts` — `handleGetOrchestratorQueue` | **NOT aware** | Passes `ledgerRoot` to `getQueue()` |
| `gui/api.ts` — `handleOrchestratorKill` | **NOT aware** | Passes `ledgerRoot` to `killQueueEntry()` |
| `gui/api.ts` — `handleOrchestratorDismiss` | **NOT aware** | Passes `ledgerRoot` to `dismissQueueEntry()` |
| `gui/api-knowledge.ts` — all 5 handlers | **NOT aware** | `new KnowledgeStoreManager(ledgerRoot)` |
| `gui/api-repos.ts` — all repo handlers | Multi-store aware | `findEntryInStores()` / `getMultiStoreManager()` |
| `gui/api-stores.ts` — all store handlers | Multi-store aware | `loadStoresConfig()` / `getMultiStoreManager()` |
| `gui/api-models.ts` | N/A (workspace-scoped) | No `ledgerRoot` usage |
| `gui/orchestrator-manager.ts` — kill/dismiss | **NOT aware** | `getProjectLedgerStatus(ledgerRoot, ...)` |
| `src/gui/queue/get-queue.ts` — `getProjectLedgerStatus` | **NOT aware** | Single-path `{ledgerRoot}/{repo}/{slug}` check |
| `src/gui/auto-archive.ts` | Multi-store aware | `getMultiStoreManager().listAllProjects()` |
| `src/gui/handlers/run-log-handlers.ts` | Multi-store aware | Receives pre-resolved paths |
| `server.ts` namespaced run-log routes | Multi-store aware | `getStoreRouter().resolveStoreForRepo()` |
| `server.ts` deprecated/legacy routes | Intentionally single-store | Backward compat for pre-namespace projects |

**Result:** 8 handler call sites across 2 subsystems are not multi-store aware.

## Summary
Eliminate the last two multi-store blind spots in the GUI: the knowledge API and the orchestrator queue's project-status checks. After this plan, every GUI route handler will be multi-store aware — no handler will operate exclusively on the default `ledgerRoot`.

**Knowledge (5 handlers):** `handleListKnowledge` instantiates `new KnowledgeStoreManager(ledgerRoot)`, so insights from non-default stores never appear. The four mutating handlers (update, delete, promote, move) have the same blind spot: they cannot find or modify insights living in non-default stores.

**Orchestrator queue (3 call sites):** `getProjectLedgerStatus()` checks only `{ledgerRoot}/{repo}/{slug}/project-ledger.json`. Projects living in non-default stores are invisible, causing queue entries to show incorrect lifecycle status (pending/dead instead of started) and completed runs to escape the synthesis-generated filter.

## Architectural Context
The GUI server (`mcp-server/gui/server.ts`) builds routes via domain sub-builders, each receiving `ledgerRoot`. Most sub-builders already use multi-store infrastructure:

- `buildProjectRoutes` → `resolveProjectStore()` iterates all stores.
- `buildRepoRoutes` → `findEntryInStores()` / `getMultiStoreManager()`.
- `buildStoreRoutes` → `loadStoresConfig()` / `getMultiStoreManager()`.
- `auto-archive.ts` → `getMultiStoreManager().listAllProjects()`.

Two subsystems were never updated:

1. `buildKnowledgeRoutes` → all 5 handlers in `api-knowledge.ts` use `new KnowledgeStoreManager(ledgerRoot)`.
2. `buildOrchestratorRoutes` → `getQueue()`, `killQueueEntry()`, `dismissQueueEntry()` all call `getProjectLedgerStatus(ledgerRoot, ...)` in `src/gui/queue/get-queue.ts`.

The `MultiStoreManager` (`src/storage/multi-store-manager.ts`) already provides `listKnowledge()` and `searchKnowledge()`. The store-context module (`src/storage/store-context.ts`) exports `isStoreContextInitialized()`, `getStoreRouter()`, and `getMultiStoreManager()`.

## Approach / Architecture

### Part A — Knowledge handlers
1. **Read path (list/search):** In `handleListKnowledge`, guard with `isStoreContextInitialized()` — when true, delegate to `getMultiStoreManager().listKnowledge()` / `.searchKnowledge()`. When false, fall back to the existing single-store path.
2. **Write path (update/delete/promote/move):** Use the iterate-and-try pattern already proven in `src/tools/knowledge.ts` (L387–L407): iterate all stores via `getStoreRouter().getAllStores()`, try the operation per store, catch "not found" and continue to the next store. This avoids redundant I/O (no pre-read to locate the insight) and uses only the public `KnowledgeStoreManager` API. Extract a shared `withKnowledgeStore<T>(ledgerRoot, fn)` helper to avoid duplicating the loop across 4 handlers.

### Part B — Orchestrator queue
3. **`getProjectLedgerStatus()`:** Add a multi-store code path that iterates all store paths (via `getStoreRouter().getAllStorePaths()`) when `isStoreContextInitialized()` is true. Check `{storePath}/{repo}/{slug}/project-ledger.json` in each store until found. Fall back to the existing single-path check in legacy mode.

### Frontend
No changes needed in either subsystem. The knowledge view (`views/knowledge.js`) is store-agnostic. The queue view receives enriched entries from the API and does not construct filesystem paths.

## Rationale
- The `MultiStoreManager` already encapsulates multi-store knowledge collation — reusing it avoids duplicating iteration and dedup logic.
- `getProjectLedgerStatus` is a low-level read utility called by 3 consumers — fixing it once fixes all three (getQueue, killQueueEntry, dismissQueueEntry).
- The established pattern (`isStoreContextInitialized()` guard + multi-store delegation + legacy fallback) is consistent with every other multi-store-aware handler.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Knowledge read collation | Delegate to `getMultiStoreManager()` | Inline store iteration in handler | `MultiStoreManager` already has tested `listKnowledge()`/`searchKnowledge()` — inlining would duplicate logic. |
| Knowledge write store resolution | Iterate-and-try pattern (try operation per store, catch "not found", continue) | `resolveKnowledgeStorePath` pre-read helper; pass `store_id` from frontend | Iterate-and-try matches the proven MCP tool pattern (`src/tools/knowledge.ts` L387–L407), avoids redundant I/O, and uses only the public `KnowledgeStoreManager` API (which lacks an "insight exists?" method). Pre-read helper would double-read store files. Frontend `store_id` would require schema migration. |
| Queue multi-store fix location | Fix inside `getProjectLedgerStatus` | Fix in each caller (getQueue, killQueueEntry, dismissQueueEntry) | Fixing the leaf function is DRY — one change fixes all 3 callers. |
| Queue store resolution method | Import store-context into `get-queue.ts` | Pass all store paths as parameter | Importing store-context matches the pattern in every other multi-store-aware module. Passing paths would require changing the function signature across 3 callers + tests. |

## Pattern Alignment
- **Multi-store guard pattern** — follows `api.ts` L347–349 (`isStoreContextInitialized()` → `getMultiStoreManager()` → fallback). No departure.
- **STDIO discipline** — `api-knowledge.ts` and `get-queue.ts` never write to `process.stdout`. No departure.
- **Route dispatch** — no route changes needed. No departure.
- **Handler signature** — all handlers keep `ledgerRoot: string` as their first parameter (used in legacy fallback). No departure.

## Detailed Steps

### Part A — Knowledge Handlers

#### Step 1: Add multi-store imports to `api-knowledge.ts`
Import `isStoreContextInitialized` and `getMultiStoreManager` from `../../src/storage/store-context.js` and `getStoreRouter` from `../../src/storage/store-context.js`.

#### Step 2: Update `handleListKnowledge` for multi-store reads
Add the multi-store guard at the point where `manager.listInsights()` / `manager.searchInsights()` is called:
- When `isStoreContextInitialized()` is true, delegate to `getMultiStoreManager().listKnowledge(filters)` or `.searchKnowledge(query, filters)`.
- When false, retain the existing `new KnowledgeStoreManager(ledgerRoot)` path.

Both paths produce the same `Insight[]` return type, so no interface changes are needed.

#### Step 3: Add a `withKnowledgeStore` helper
Create a private async generic helper in `api-knowledge.ts` that encapsulates the iterate-and-try pattern (matching `src/tools/knowledge.ts` L387–L407):

```ts
async function withKnowledgeStore<T>(
  ledgerRoot: string,
  fn: (manager: KnowledgeStoreManager) => Promise<T>
): Promise<T> {
  if (isStoreContextInitialized()) {
    const stores = getStoreRouter().getAllStores();
    for (const store of stores) {
      const manager = new KnowledgeStoreManager(store.path);
      try {
        return await fn(manager);
      } catch (err) {
        if ((err as Error).message.includes('not found')) continue;
        throw err;
      }
    }
    throw new ApiError('NOT_FOUND', 'Insight not found.');
  }
  return fn(new KnowledgeStoreManager(ledgerRoot));
}
```

This avoids redundant I/O (no pre-read to locate the owning store) and works with the public `KnowledgeStoreManager` API, which has no "insight exists?" method.

#### Step 4: Update `handleUpdateKnowledge` to use `withKnowledgeStore`
Replace `const manager = new KnowledgeStoreManager(ledgerRoot)` + the try/catch block with a call to `withKnowledgeStore(ledgerRoot, (manager) => manager.updateInsight(id, updates, { scope, repository_name }))`.

#### Step 5: Update `handleDeleteKnowledge` to use `withKnowledgeStore`
Same pattern as Step 4.

#### Step 6: Update `handlePromoteKnowledge` to use `withKnowledgeStore`
Same pattern: wrap the `manager.moveInsight()` call.

#### Step 7: Update `handleMoveKnowledge` to use `withKnowledgeStore`
Same pattern: wrap the `manager.moveInsight()` call. The destination is always within the same store root (move operates within a single `.knowledge/` directory).

### Part B — Orchestrator Queue

#### Step 8: Make `getProjectLedgerStatus` multi-store aware
In `mcp-server/src/gui/queue/get-queue.ts`:
1. Import `isStoreContextInitialized` and `getStoreRouter` from `../../storage/store-context.js`.
2. In `getProjectLedgerStatus`, when `isStoreContextInitialized()` is true, iterate `getStoreRouter().getAllStorePaths()` and check `{storePath}/{repo}/{slug}/project-ledger.json` (or `{storePath}/{slug}/project-ledger.json` for flat layout) in each store until found.
3. When false (legacy mode), retain the existing single-path check with `ledgerRoot`.

This automatically fixes all 3 callers: `getQueue()`, `killQueueEntry()`, `dismissQueueEntry()`.

### Part C — Tests

#### Step 9: Add multi-store knowledge test coverage
In `tests/gui/knowledge-api.test.ts`, add a new `describe('multi-store')` block:
1. Creates two temp directories (store A and store B), each with a `.knowledge/` directory.
2. Seeds insights into both stores.
3. Calls `setStoreContext()` with a `StoreRouter` configured for both stores.
4. Verifies `handleListKnowledge` returns insights from both stores.
5. Verifies `handleListKnowledge` with search query returns insights from both stores.
6. Verifies `handleUpdateKnowledge` can update an insight in store B.
7. Verifies `handleDeleteKnowledge` can delete an insight in store B.
8. Tears down the store context after tests.

#### Step 10: Add multi-store queue test coverage
In `tests/gui/queue-multi-store.test.ts` (new file):
1. Creates two temp directories (store A and store B), seeds a `project-ledger.json` in store B only.
2. Calls `setStoreContext()` with a `StoreRouter` configured for both stores.
3. Verifies `getProjectLedgerStatus(storeA, slug, repo)` returns `{ exists: true }` (found in store B despite `ledgerRoot` pointing to store A).
4. Verifies `synthesisGenerated` is correctly read from the non-default store.
5. Verifies `getProjectLedgerStatus` in legacy mode checks only `ledgerRoot`.
6. Tears down the store context after tests.

#### Step 11: Run full test suite
Execute `npm test` in `mcp-server/` to verify no regressions.

## Dependencies
- No new npm dependencies required.
- All infrastructure (`MultiStoreManager`, `StoreRouter`, store-context module) already exists.

## Required Components
- `mcp-server/gui/api-knowledge.ts` — modify all 5 handler functions + add `withKnowledgeStore` helper.
- `mcp-server/src/gui/queue/get-queue.ts` — modify `getProjectLedgerStatus` to iterate stores.
- `mcp-server/tests/gui/knowledge-api.test.ts` — add multi-store test block.
- `mcp-server/tests/gui/queue-multi-store.test.ts` — new file for queue multi-store tests.

## Assumptions
- The `MultiStoreManager.listKnowledge()` and `searchKnowledge()` methods are correct and tested (verified: `tests/storage/multi-store-manager.test.ts` has 12 test cases).
- The `setStoreContext()` function is the standard way to wire store context in tests (verified: used in MCP tool tests).
- Insights in different stores can share the same numeric ID (dedup is first-store-wins, consistent with `MultiStoreManager` behaviour).
- The orchestrator always writes `project-ledger.json` in the store that the MCP server resolves for the repo — so checking all stores is the correct behaviour for status detection.

## Constraints
- The `resolveKnowledgeStorePath` helper performs an I/O read per store to locate the insight. For typical deployments (1–3 stores), this is negligible.
- `getProjectLedgerStatus` now performs up to N file reads (one per store) instead of 1. With 1–3 stores, the overhead is negligible — the function is already I/O-bound on a single read.
- Mutating handlers must not hold locks across stores — each `KnowledgeStoreManager` instance locks only its own `.knowledge/` directory.

## Out of Scope
- Data quality fixes for insights with `scope: "project"` (pre-existing issue, separate concern).
- Adding `store_id` to the insight response or UI display (the frontend is store-agnostic by design).
- Knowledge creation via GUI (no create endpoint exists today).
- Changes to the MCP tool handlers (already multi-store aware).
- Deprecated/legacy routes in `server.ts` — these use `ledgerRoot` by design for pre-namespace projects and are already documented as deprecated.

## Acceptance Criteria

- AC-01: In multi-store mode, `GET /api/knowledge` returns insights from all configured stores, not just the default store.
- AC-02: In single-store (legacy) mode, `GET /api/knowledge` continues to work unchanged.
- AC-03: In multi-store mode, `PATCH /api/knowledge/:id` can update an insight that lives in a non-default store.
- AC-04: In multi-store mode, `DELETE /api/knowledge/:id` can delete an insight that lives in a non-default store.
- AC-05: In multi-store mode, `POST /api/knowledge/:id/promote` can promote an insight from a non-default store.
- AC-06: In multi-store mode, `POST /api/knowledge/:id/move` can move an insight that lives in a non-default store.
- AC-07: In multi-store mode, `getProjectLedgerStatus` returns `{ exists: true }` when the project's `project-ledger.json` exists in a non-default store.
- AC-08: In multi-store mode, orchestrator queue entries for projects in non-default stores show correct effective status (`started`, not `pending` or `dead`).
- AC-09: In single-store (legacy) mode, `getProjectLedgerStatus` continues to work unchanged.
- AC-10: All existing tests continue to pass without modification.
- AC-11: New multi-store test cases cover knowledge list, update, delete, promote, and move across stores plus queue status across stores.
- AC-12: The full `mcp-server` test suite passes with no regressions.

## Testing Strategy
Unit tests using real temp directories (following the established pattern in `knowledge-api.test.ts`). Multi-store tests use `setStoreContext()` to wire a `StoreRouter` with two temp stores, seed data into both, and verify cross-store operations.

## Test Plan
- `tests/gui/knowledge-api.test.ts` — `describe('multi-store')` block:
  - `handleListKnowledge returns insights from all stores` — AC-01
  - `handleListKnowledge with scope filter works across stores` — AC-01
  - `handleListKnowledge with query search works across stores` — AC-01
  - `handleListKnowledge in legacy mode returns single-store insights` — AC-02
  - `handleUpdateKnowledge updates insight in non-default store` — AC-03
  - `handleDeleteKnowledge deletes insight in non-default store` — AC-04
  - `handlePromoteKnowledge promotes insight from non-default store` — AC-05
  - `handleMoveKnowledge moves insight from non-default store` — AC-06
  - All existing 30 tests remain unchanged — AC-10

- `tests/gui/queue-multi-store.test.ts` (new file):
  - `getProjectLedgerStatus finds project in non-default store` — AC-07
  - `getProjectLedgerStatus returns { exists: false } when project is absent from all stores` — AC-07
  - `getProjectLedgerStatus in legacy mode checks only ledgerRoot` — AC-09
  - `getProjectLedgerStatus reads synthesisGenerated from non-default store` — AC-08

## Documentation Updates
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Update §7 (Knowledge CRUD Flow) to note multi-store collation for the list endpoint and store-resolution for mutating endpoints. Add a note about multi-store-aware queue status checks.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add an entry for `tests/gui/queue-multi-store.test.ts` annotated with its purpose (multi-store queue `getProjectLedgerStatus` checks) and a reference to this plan.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Data quality fix for insights with `scope: "project"` | MCP tool search returning validation error | Pre-existing issue unrelated to multi-store routing | Should be a separate data migration plan |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Store path resolution adds latency to knowledge mutations** | At most 2–3 store reads per mutation (typical deployment). Negligible against file-lock acquisition overhead. |
| **Store path resolution adds latency to queue status checks** | At most 2–3 file reads per queue entry per store. Queue entries are typically single-digit; overhead is negligible. |
| **Dedup by numeric ID could hide insights** | Same dedup strategy as `MultiStoreManager` and MCP tools — first-store-wins. No change to the dedup rule. |
| **Importing store-context into `get-queue.ts` couples queue module to store infrastructure** | This coupling already exists for every other multi-store-aware module. The alternative (passing all store paths through the call chain) would require changing function signatures across 3 callers + 2 test files — disproportionate to the benefit. |
| **Test teardown leaks store context** | Use `afterEach` to clear store context via the same pattern as `tests/tools/knowledge-multi-store.test.ts`. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Changes touch only `mcp-server/gui/` and `mcp-server/src/gui/queue/`, following well-established multi-store patterns. No cross-project concerns, no new architecture, and self-review is adequate.
