## Synthesis

### Completion Status
- Date: 2026-08-02
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-04

### Outcome Summary

The two test regressions from the prior session were fixed, a shared `modal.js` utility was extracted to consolidate duplicate modal lifecycle code from `strategy.js` and `config-stores.js`, and the Strategy page repository table was updated to show a conditional "Store" column in multi-store mode. Supporting changes included a refreshTable race guard, a `doAddFolder` scope fix, a warning log in `handleGetRepo`, and documentation updates to `api-surface.md` and `file-tree.md`.

### Implementation Summary
- Fixed `router-utils.test.ts`: removed stale `renderStrategyDetail` global declaration, mock assignment, and two tests
- Fixed `project-list.test.ts`: updated link assertion from `#/strategy/:repoId` to flat `#/strategy`
- Created `mcp-server/gui/public/modal.js`: shared utility exposing `openModal(html, triggerEl)`, `closeModal(overlay)`, and `wireModalEvents(overlay, opts)` with focus trap, Escape, overlay-click, Enter-to-submit, and close-button wiring
- Refactored `renderRepoModal` in `strategy.js` to delegate to `modal.js`; extracted `handleSave` as a named function wired to the save button; replaced three inline `closeModal()` calls with `closeModal(overlay)`
- Replaced "Folder Names" table column with a conditional "Store" column in `buildTableHtml(repos, isMultiStore)`; hoisted `storeLabels`, `isMultiStore`, and `refreshSeq` to the `renderStrategyList` closure; changed `renderList` to assign (not redeclare) those variables
- Added `refreshSeq` race guard to `refreshTable` preventing stale renders after rapid store-tab navigation
- Changed `doAddFolder` from a `function` declaration to a `var` expression to eliminate block-scoped declaration issues in sloppy mode
- Refactored `csRenderStoreModal` in `config-stores.js` to call `openModal`/`wireModalEvents`/`closeModal`; deleted `csCloseModal` and `csWireModalEvents` functions and the `csTriggerElement` module-level variable; updated three `csCloseModal()` call sites in `csHandleModalSave` with inline close + state reset
- Added `<script src="/modal.js?v=1"></script>` to `index.html` before `project-list.js` (loads before both consumers)
- Added `console.warn` to `handleGetRepo` in `api-repos.ts` for the multi-store path where no matching store is found for a repo's `storePath`
- Updated `api-surface.md`: documented Knowledge group (`getKnowledge`, `updateKnowledge`, `deleteKnowledge`, `promoteKnowledge`, `moveKnowledge`), Orchestrator group (`orchestratorGetRunStatus`), and Chunks group (`getChunkText`)
- Updated `file-tree.md`: added `modal.js` entry, updated `strategy.js` and `config-stores.js` annotations to reflect modal delegation and removal of `csCloseModal`/`csWireModalEvents`
- Regenerated CTX snapshots via `node scripts/cli.js ctx-generate`

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — added three previously undocumented API groups (Knowledge CRUD, Orchestrator run-status, Chunks text endpoint)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — added `modal.js` entry; updated `config-stores.js` and `strategy.js` annotations to remove stale function references and reflect modal.js delegation
- `.context/mcp-server/manifest-file-tree.md` and `.context/mcp-server/manifest-api-surface.md` — regenerated via CTX generator

### Verification Summary
- Tests run: `npm test` in `mcp-server/` — 4029/4029 passed (two rounds: after test fixes, and after all implementation steps)
- Static analysis run: none configured (no ESLint / tsc watch on GUI scripts); checked ES5 constraint manually — no arrow functions, template literals, let/const, or class syntax introduced
- Grep: `renderStrategyDetail` — zero matches in source and test files after cleanup
- Result: PASS

### Code Insights
- [medium] (refactor) `mcp-server/gui/public/views/config-stores.js`: `csHandleModalSave` now closes the modal via `closeModal(document.getElementById('cs-modal-overlay'))` at three separate call sites. A tiny local `doClose()` helper inside that function would reduce this repetition to a single expression. Low effort, but deferred since it is functionally correct as-is.
- [low] (code-smell) `mcp-server/gui/public/views/strategy.js`: `buildTableHtml` now receives `isMultiStore` as a parameter, but `storeLabels` is still accessed via closure from the parent `renderStrategyList` scope. Passing `storeLabels` as a second parameter would make the function's dependencies explicit and easier to test in isolation.
- [low] (debt) `mcp-server/gui/public/views/strategy.js`: The `renderStrategyList` function is now ~350 lines. The modal logic (`renderRepoModal`) is already extracted; the conflict-tab logic (`buildConflictsHtml`, `resolveConflict`, `refreshConflicts`, `wireConflictActions`) could further be split into a `strategy-conflicts.js` companion module to match the `config`/`config-stores.js` pattern used elsewhere in the GUI.
- [low] (improvement) `mcp-server/gui/api-repos.ts` `handleGetRepo`: The new `console.warn` for an unmatched `storePath` correctly identifies when a repository entry cannot be correlated to a configured store. A future improvement would be to surface this as a structured API warning (adding `store_warning` to the response body) so that the frontend can display a tooltip rather than silently omitting `store_id`.

### Additional Comments
- The `modal.js` script tag was placed before `project-list.js` in `index.html`, which loads before both `config-stores.js` and `strategy.js`. This is correct for the load-order dependency.
- The CTX normalizer (`scripts/normalize-ctx-paths.js`) automatically ran after generation and normalized the absolute path in `.context/mcp-server/manifest-file-tree.md`.
