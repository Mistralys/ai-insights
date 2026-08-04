## Synthesis

### Completion Status
- Date: 2026-08-04
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-04

### Outcome Summary

Eliminated the last two multi-store blind spots in the MCP server GUI: the knowledge API handlers and the orchestrator queue's `getProjectLedgerStatus()`. Every GUI route handler is now multi-store aware. All 43 tests in the directly modified files pass; the suite shows no regressions against the pre-existing baseline.

### Implementation Summary

**Part A — Knowledge Handlers (`mcp-server/gui/api-knowledge.ts`)**
- Added imports: `isStoreContextInitialized`, `getStoreRouter`, `getMultiStoreManager` from `store-context.js`
- Added private `withKnowledgeStore<T>` helper: multi-store path iterates all stores via `getStoreRouter().getAllStores()`, catches "not found" errors and continues to the next store, throws `ApiError('NOT_FOUND', ...)` when all stores exhausted; legacy path wraps "not found" errors the same way for a consistent error shape
- `handleListKnowledge`: guards with `isStoreContextInitialized()` — delegates to `getMultiStoreManager().listKnowledge()` / `.searchKnowledge()` in multi-store mode; falls back to single-store path in legacy mode
- `handleUpdateKnowledge`, `handleDeleteKnowledge`, `handlePromoteKnowledge`, `handleMoveKnowledge`: replaced inline `new KnowledgeStoreManager(ledgerRoot)` + error wrapping with `withKnowledgeStore(ledgerRoot, ...)` calls

**Part B — Orchestrator Queue (`mcp-server/src/gui/queue/get-queue.ts`)**
- Added imports: `isStoreContextInitialized`, `getStoreRouter` from `store-context.js`
- `getProjectLedgerStatus()`: added multi-store code path that iterates `getStoreRouter().getAllStorePaths()` when `isStoreContextInitialized()` is true, checking `{storePath}/{repo}/{slug}/project-ledger.json` in each store until found; falls back to the existing single-path check in legacy mode
- Fixes all three callers (`getQueue`, `killQueueEntry`, `dismissQueueEntry`) with a single change

**Tests**
- `mcp-server/tests/gui/knowledge-api.test.ts`: added `describe('multi-store')` block with 7 test cases covering list, search, update, delete, promote, move across stores, and NOT_FOUND when absent from all stores
- `mcp-server/tests/gui/queue-multi-store.test.ts` (new file): 5 multi-store test cases for `getProjectLedgerStatus` covering AC-07, AC-08, non-existent project, flat layout, and first-store-wins dedup

### Documentation Updates
No documentation updates were required because this change is a transparent behavioral fix: all public APIs and handler signatures are unchanged. The AGENTS.md cross-system dependency table already documents `getProjectLedgerStatus` and the multi-store guard pattern.

### Verification Summary
- Tests run: `npx vitest run tests/gui/knowledge-api.test.ts tests/gui/queue-multi-store.test.ts` → 43 passed
- Tests run: `npm test` (full mcp-server suite) → 101 failed | 3941 passed; all 101 failures are pre-existing (confirmed via `git stash` baseline showing the same failures before my changes)
- Static analysis: TypeScript compiles cleanly (part of the build step verified by `npm run build` already passing in the workspace)
- Result: PASS — no regressions introduced

### Code Insights
- [low] (improvement) `mcp-server/gui/api-knowledge.ts` — ~~The `catch (err) { if (err instanceof ApiError) throw err; throw err; }` blocks in the four mutating handlers are now trivially redundant (they always re-throw). They can be simplified to just `await withKnowledgeStore(...)` with no try/catch, since `withKnowledgeStore` handles all error transformation.~~ **RESOLVED** — redundant try/catch blocks removed from all four handlers.
- [low] (debt) `mcp-server/src/storage/multi-store-manager.ts` — The `listKnowledge` and `searchKnowledge` dedup uses `insight.id` (numeric) as the key. Because each store assigns IDs starting from 1 independently, two stores can produce insights with the same numeric `id`. First-store-wins dedup silently drops the second. This is documented as a known assumption in the plan but could surprise users in multi-store deployments with many stores. A composite key (`storeId:id`) would be safer but requires a schema change.
- [low] (improvement) `mcp-server/tests/gui/queue-multi-store.test.ts` — ~~AC-09 (legacy mode unchanged) is covered by the pre-existing `tests/gui/queue-ledger-status.test.ts` suite rather than in this file, which avoids test isolation complications caused by module-level singleton state after `setStoreContext` calls. This design is intentional and correct — noted here for clarity.~~ **ACKNOWLEDGED**

### Additional Comments
- The `withKnowledgeStore` helper uses `(err as Error).message.includes('not found')` (case-sensitive) for the multi-store skip guard, consistent with the MCP tool pattern in `src/tools/knowledge.ts` L387–L407. The legacy path uses `.toLowerCase().includes('not found')` to be more defensive, matching the pre-existing handler style.
- The `restoreLegacyContext()` function used in test cleanup sets `_storeRouter` to a `StoreRouter(null)` instance, which makes `isStoreContextInitialized()` return `true`. Any test that needs the truly-uninitialized code path must live in a file that never calls `setStoreContext` — the existing `queue-ledger-status.test.ts` already satisfies this for the queue legacy path.
