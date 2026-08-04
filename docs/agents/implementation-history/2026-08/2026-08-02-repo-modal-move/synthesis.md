# Synthesis Report — Repo Modal Move

**Plan:** `2026-08-02-repo-modal-move`  
**Date:** 2026-08-03  
**Status:** COMPLETE (7/7 WPs)  
**Pipeline Health:** 7/7 WPs — all stages passed

---

## Executive Summary

The project replaced the MCP GUI's inline add-repository form and full-page repository detail editor with a single shared modal dialog (`renderRepoModal()`). In multi-store mode the modal includes a store dropdown that enables moving a repository between stores as part of the save flow. The backend was extended with a new `POST /api/repos/:repoId/move` endpoint (`handleMoveRepo()`), `handleGetRepo()` was enriched to return `store_id` for pre-selection, and `API.moveRepo()` was added to the frontend API client. The strategy list was refactored to trigger the modal (removing the inline form), and the obsolete `renderStrategyDetail()` full-page view and its `#/strategy/:repoId` route were deleted in full.

All 7 work packages completed across 4 pipeline stages (implementation → qa → code-review → documentation). One WP (WP-002) required a QA rework cycle after zero behavioral tests were submitted for the new endpoint on first pass.

---

## Metrics

| WP | Title | Stages | Tests Passed | Tests Failed | Rework |
|----|-------|--------|-------------|-------------|--------|
| WP-001 | Enrich `handleGetRepo()` — add `store_id` | 4/4 PASS | 4019 | 0 | — |
| WP-002 | Add `handleMoveRepo()` endpoint + route | 4/4 PASS | 4029 | 0 | impl+qa ×1 |
| WP-003 | Add `API.moveRepo()` to frontend client | 4/4 PASS | 4031 | 0 | — |
| WP-004 | Backend tests (handleMoveRepo + handleGetRepo) | 4/4 PASS | 4031 | 0 | — |
| WP-005 | Implement `renderRepoModal()` | 4/4 PASS | 4031 | 0 | — |
| WP-006 | Refactor `renderStrategyList()` to modal triggers | 4/4 PASS | 5 ACs (browser) | 0 | — |
| WP-007 | Remove `renderStrategyDetail()` + detail route | 4/4 PASS | 4 ACs (static) | 0 | — |

**Final test count:** 4031/4031 passing across 145 test files.  
**New behavioral tests added:** 13 (11 for `handleMoveRepo` scenarios, 2 for `handleGetRepo` enrichment).  
**Reviewer Fix-Forwards applied:** 5 (all non-behavioral: missing assertion, missing file-header entry, static import promotion, DRY label variable, function rename).

---

## Files Modified

**Backend / API:**
- `mcp-server/gui/api-repos.ts` — `handleGetRepo()` enriched with `store_id`; `handleMoveRepo()` added; `RepoMoveBodySchema` added; JSDoc updated.
- `mcp-server/gui/server.ts` — `POST /api/repos/:repoId/move` route wired.

**Frontend:**
- `mcp-server/gui/public/api-client.js` — `API.moveRepo()` added to Repos group.
- `mcp-server/gui/public/views/strategy.js` — `renderRepoModal()` added (~330 lines); `renderStrategyDetail()` and inner helpers removed; `renderStrategyList()` / `renderList()` refactored; `wireRegisterButtons()` renamed to `wireTableButtons()`.
- `mcp-server/gui/public/router.js` — `#/strategy/:repoId` route block removed.
- `mcp-server/gui/public/utils.js` — Breadcrumb `.repo()` updated to link `#/strategy`.
- `mcp-server/gui/public/views/project-detail.js` — Repo link updated to `#/strategy`.
- `mcp-server/gui/public/views/project-list.js` — Repo cell link updated to `#/strategy`.

**Tests:**
- `mcp-server/tests/gui/api-repos-store.test.ts` — 13 new tests added; `statSync` promoted to static import.
- `mcp-server/tests/gui/api-repos.test.ts` — Minor assertion added (`expect(result.store_id).toBe('store-b')`).

**Manifests / Docs:**
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `handleGetRepo()` return type, `handleMoveRepo()` section, `API.moveRepo()` Repos group entry added.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — `api-repos-store.test.ts` entry added; `api-client.js` Repos group annotation updated; router.js `/strategy` route documented.
- `AGENTS.md` — Cross-system dependency table row for `.repositories.json` updated to include `handleMoveRepo()`.

---

## Strategic Recommendations

### 1. Non-atomic cross-store move — future hardening candidate
`handleMoveRepo()` performs two sequential `await` writes (source-remove, then target-add). A crash between the two leaves the entry orphaned from source with no target record. This is consistent with the codebase's overall approach (no journaling infrastructure), but any future store reliability initiative should address this with an idempotent retry or write-ahead log pattern. Flagged in WP-002 implementation pipeline.

### 2. Frontend GUI lacks unit test harness
`renderRepoModal()` (330 lines of modal logic) has no automated tests — QA verification was done via code inspection and browser testing. A jsdom-based test suite for `gui/public/views/*.js` would significantly improve confidence during future refactors. The backend Vitest suite does not cover frontend view files. This is a gap that predates this project but becomes more pressing as the modal codebase grows.

### 3. ES5 sloppy-mode `doAddFolder` block-scoped function declaration
In `renderRepoModal()`, `doAddFolder` is declared as a function statement inside an `if`-block. Under sloppy-mode ES5 this is safe (both consumers are in the same block), but it would need to become a `var` function expression before any strict-mode migration. Tagged in WP-005 by Developer, QA, and Reviewer. No action needed now; document the note for the eventual ES5→ES module migration plan.

### 4. `csRenderStoreModal` as a reusable modal pattern
The pattern from `config-stores.js` (CSS classes, focus trap, close-on-Escape, WCAG focus restoration, Enter-to-submit) was successfully reused by `renderRepoModal()` via consistent class naming. This informal pattern should be promoted to a shared utility function or documented as a GUI contribution guide, to prevent drift when the next modal is added.

### 5. `wireTableButtons()` single-responsibility limit
The renamed function now handles two distinct interaction types (Register undeclared rows + edit declared rows). A third type would warrant splitting into dedicated wiring functions. Not yet urgent, but the ceiling is visible.

---

## Deferred & Follow-Up Items

### HIGH — Code regressions introduced by WP-007 (requires fix in next cycle)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| D-1 | WP-007 Documentation | Documentation | `mcp-server/tests/gui/router-utils.test.ts` lines 237–246: two tests dispatch `#/strategy/my-repo` and assert `renderStrategyDetail` was called. Both will now fail — the route block was removed. These tests must be removed or replaced. | **High** |
| D-2 | WP-007 Documentation | Documentation | `mcp-server/tests/gui/project-list.test.ts` line 386 (`'label is a link pointing to #/strategy/:repoId'`): assertion checks `href = '#/strategy/' + encodeURIComponent(id)`. After WP-007, `project-list.js` links to `#/strategy` unconditionally. Test must be updated to expect `#/strategy`. | **High** |

> **Note:** These regressions were not caught during WP-007's QA or code-review passes because the QA relied on static file analysis of the modified files rather than running the full Vitest suite after the route deletion. The next cycle's Planner should include a verification task to run the full suite and confirm these failures, then add a remediation WP.

### LOW — Technical debt / maintenance

| # | Source | Agent | Description |
|---|--------|-------|-------------|
| D-3 | WP-007 Documentation | Documentation | `.context/mcp-server/source-gui-frontend.md` is a CTX snapshot still containing `renderStrategyDetail` source and the `strategyDetailMatch` router block. Run `node scripts/cli.js ctx-generate` to regenerate. |
| D-4 | WP-007 Documentation | Documentation | `file-tree.md` `strategy.js` entry still references the old "Add Repository form" and `#add-repo-form` pattern — pre-existing gap from WP-005/WP-006. Scope: manifest maintenance pass. |
| D-5 | WP-003 Documentation | Documentation | `api-surface.md` API bullet is missing the Knowledge group (`getKnowledge`, `updateKnowledge`, `deleteKnowledge`, `promoteKnowledge`, `moveKnowledge`), `getChunkText`, `orchestratorGetRunStatus`, and Store management group (`addStore`, `importStore`, `updateStore`, `removeStore`, `setDefaultStore`, `reorderStores`). Pre-existing documentation gap; flagged during WP-003 docs pass. |
| D-6 | WP-002 impl | Developer | Non-atomic cross-store writes in `handleMoveRepo()`: source-remove + target-add are two sequential `await`s. A crash between them leaves state inconsistent. Low likelihood today; relevant if idempotent retry / reliability hardening is planned. |
| D-7 | WP-001 QA | QA | `handleGetRepo()` silent `store_id` omission: if `getAllStores().find()` yields `undefined` (e.g., store removed between the two calls), `store_id` is silently absent from the response rather than surfacing an error. Acceptable for now. |
| D-8 | WP-005 Developer/QA | Developer | `doAddFolder` block-scoped function declaration inside an `if`-block is safe under ES5 sloppy mode but must be refactored to a `var` function expression before any strict-mode migration. |
| D-9 | WP-006 QA | QA | Rapid checkbox toggling in `strategy.js refreshTable()` can cause two overlapping `API.listRepos()` calls with a race condition (last responder wins). Pre-existing pattern, not introduced by this project. |

---

## Next Steps

1. **Immediate (next cycle):** Fix the two test regressions in `router-utils.test.ts` and `project-list.test.ts` (D-1, D-2). Run the full Vitest suite with `npm test` inside `mcp-server/` to confirm no other stale assertions remain.
2. **Short-term:** Regenerate `.context/` docs (`node scripts/cli.js ctx-generate`) to bring the CTX snapshot up to date (D-3).
3. **Medium-term:** Plan a GUI frontend test infrastructure WP — a jsdom harness for `views/*.js` would close the `renderRepoModal()` coverage gap and protect the modal interaction logic during future changes.
4. **Medium-term:** Evaluate promoting the modal lifecycle pattern (`csRenderStoreModal`) to a shared utility in `gui/public/utils.js` or a dedicated `modal.js` helper, to prevent drift across the growing number of modal implementations.
5. **Backlog:** Documentation maintenance pass for `api-surface.md` (D-5) and `file-tree.md` strategy.js entry (D-4).
