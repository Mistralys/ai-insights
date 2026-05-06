## Synthesis

### Completion Status
- Date: 2026-05-06
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- **WP-A:** Created `mcp-server/src/gui/queue/types.ts` — leaf module exporting `QUEUE_FILENAME` constant and all 6 interface/type definitions (`RawQueueEntry`, `QueueEntry`, `KillResult`, `PreflightResult`, `StartResult`, `RunStatus`). Imports only `EffectiveStatus` from `compute-effective-status.ts`.
- **WP-B:** Created `mcp-server/src/gui/queue/get-queue.ts` — exports `isProcessAlive`, `readQueueFile`, `getProjectLedgerStatus` (for use by `orchestrator-manager.ts`), and the public `getQueue()`. Internal `isRawQueueEntry` remains private. Plan gap resolved: `getProjectLedgerStatus` needed by `killQueueEntry`/`dismissQueueEntry` was also extracted and exported (plan listed it as "private", but it is required by the mutation functions).
- **WP-A/B:** Refactored `gui/orchestrator-manager.ts` from 806 lines to 551 lines (−255 lines). The file now: (a) imports from the new sub-modules, (b) re-exports everything for backward compatibility, and (c) retains only queue-mutation, preflight, and launch logic. All existing callers (`gui/api.ts`, `tests/gui/orchestrator-manager.test.ts`, `tests/gui/api-orchestrator.test.ts`) work unchanged.
- **WP-C:** Added 3 edge-case tests to `resolve-progress.test.ts`: malformed last JSONL line skipped, all-malformed file returns null summary with logFilename set, 0-byte log file returns null summary with logFilename set.
- **WP-D:** Froze `EMPTY_RESOLUTION` with `Object.freeze()` in `resolve-progress.ts`. Added explanatory comment to the dead `heartbeat` entry in `orchestrator-widgets.js`. Hardened `toolName` extraction in `format-progress-entry.ts` to explicitly reject empty strings via `.length > 0` guard. Added 1 new test for `tool_name: ""`.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md`: updated `queue/` directory entry to list `types.ts` and `get-queue.ts`; updated `orchestrator-manager.ts` description; updated test directory counts.
- `mcp-server/docs/agents/project-manifest/api-surface.md`: added full API sections for `types.ts` and `get-queue.ts`; updated `format-progress-entry.ts` note for WP-D; replaced the `orchestrator-manager.ts` type definitions block (now redundant) with a cross-reference to `types.ts`; updated the re-export chain description.

### Verification Summary
- Tests run: `npm test` (MCP server Vitest suite, 72 test files)
- Static analysis run: `npx tsc --noEmit`
- Result: **PASS** — 2173 tests (2169 original + 4 new), 0 TypeScript errors, 0 regressions

### Code Insights
- [low] (debt) `gui/orchestrator-manager.ts` `getRunStatus()`: the fallback expression `typeof d['slug'] === 'string' ? d['slug'] : slug` references `slug` which is not declared in the function scope. This is a pre-existing bug; since `d['slug']` is always a string in practice the fallback is unreachable, so it does not cause a runtime error. The identifier is probably a leftover from an earlier version of the function that accepted `slug` as a parameter. Suggested fix: replace the fallback with `''` or `statusFilename.split('-run-status.json')[0]`.
- [low] (improvement) `src/gui/queue/get-queue.ts`: `getProjectLedgerStatus` is exported for use by `orchestrator-manager.ts`'s mutation functions. If a future refactor moves kill/dismiss into the queue sub-module as well, this function could be made private again, completing the encapsulation of queue I/O.
- [low] (convention) `gui/orchestrator-manager.ts`: there is a double blank line after the re-export block (before `// Queue mutation helpers`). Minor whitespace inconsistency introduced by the replacement; safe to clean up.

### Additional Comments
- The plan listed `getProjectLedgerStatus` as "(private)" in `get-queue.ts` but did not account for its use by `killQueueEntry`/`dismissQueueEntry`. Exporting it is the correct resolution — one canonical location, no duplication.
- The `QUEUE_FILENAME` constant is both locally imported (needed by `writeQueueFileAtomic`) and re-exported from `orchestrator-manager.ts`. TypeScript handles both declarations independently; no lint issue arises in practice.
