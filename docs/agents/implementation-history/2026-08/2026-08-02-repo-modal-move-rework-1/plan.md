# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
This plan addresses the actionable items from the `2026-08-02-repo-modal-move` synthesis, which replaced the strategy detail page with a modal dialog. Two high-priority test regressions (D-1, D-2) were identified post-facto. Seven of nine deferred items are promoted into scope — most are trivial fixes where ongoing deferral has more overhead than resolution.

## Summary
Fix two test regressions from the repo-modal-move project, replace the "Folder Names" table column with a "Store" column, extract a shared modal utility from two duplicate implementations, fix `doAddFolder` block-scoped declaration, add a race guard to `refreshTable`, add a warning log for `handleGetRepo` store_id edge case, document all missing API client groups in `api-surface.md`, update `file-tree.md`, and regenerate CTX snapshots.

## Architectural Context
The MCP GUI is a vanilla-JS SPA served by the MCP server. The Strategy page (`strategy.js`) renders a repository table via `buildTableHtml()` with data from `API.listRepos()` and `API.getStores()`. In multi-store mode, each `RepoListItem` already includes a `store_id` field, and the stores array (with `{ id, label, path }` shape) is already fetched and mapped to a `storeLabels` dictionary in `renderList()`. The router (`router.js`) dispatches hash routes to view functions; the `#/strategy/:repoId` route was removed in the prior project but two tests still reference it. Two modal implementations (`renderRepoModal` in `strategy.js` and `csRenderStoreModal` in `config-stores.js`) share identical lifecycle patterns (focus trap, Escape, overlay click, focus restoration) but duplicate the code independently.

## Approach / Architecture
1. **Test fixes:** Delete stale router dispatch tests and update the project-list link assertion.
2. **Store column:** Hoist `storeLabels`/`isMultiStore` to closure scope; replace "Folder Names" column with "Store" column, hidden in single-store mode.
3. **Shared modal utility:** Extract a new `gui/public/modal.js` file with `openModal()`, `closeModal()`, and `wireModalEvents()` functions. Refactor both `renderRepoModal` and `csRenderStoreModal` to delegate lifecycle to the shared utility.
4. **Code quality fixes:** Convert `doAddFolder` to `var` expression; add in-flight guard to `refreshTable`; add `console.warn` for `handleGetRepo` store_id omission.
5. **Documentation:** Fill missing API groups in `api-surface.md`; update `file-tree.md`; regenerate CTX.

## Rationale
- Promoting trivial deferred items eliminates the overhead of re-triaging them in every future synthesis cycle.
- The shared modal utility prevents drift between the two existing modal implementations and provides a ready-made foundation when a third modal is needed.
- An in-flight guard on `refreshTable` prevents a real (if low-probability) race condition from producing incorrect UI state.
- Documenting the 6 missing API groups in `api-surface.md` brings the manifest back to its role as the authoritative API reference.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Store label access in `buildTableHtml` | Pass `storeLabels` + `isMultiStore` as function parameters | (A) Module-level variable; (B) Re-fetch stores in `refreshTable` | Parameters keep data flow explicit; re-fetching adds latency on every checkbox toggle. |
| Column visibility in single-store | Hide the Store column entirely | (A) Show column with "Default" label | Hiding is consistent with the established pattern (tab bar, conflicts tab hidden in single-store). |
| Modal extraction shape | `modal.js` with `openModal`, `closeModal`, `wireModalEvents` | (A) Extract only `wireModalEvents`; (B) Full class-based Modal component | Three functions cover the shared lifecycle without over-abstracting. Class-based adds unnecessary ceremony for vanilla JS. |
| refreshTable race guard | Closure-scoped counter (increment on call, skip stale in `.then`) | (A) Debounce with timer; (B) AbortController | Counter is the simplest pattern, zero dependencies, no timing assumptions. AbortController not available in ES5. |
| handleGetRepo store_id | Add `console.warn` | (A) Throw error; (B) Return `store_id: 'unknown'` | A warn logs the edge case for debugging without breaking the response. Throwing would be a breaking change for an unlikely race condition. |

## Pattern Alignment
- Multi-store UI visibility gating via `isMultiStore = stores.length > 1` — follows existing pattern in `renderList()` L443.
- Closure-scoped state variables — follows existing pattern (`currentStores` in `renderStrategyList()`).
- Plain-function module pattern for `modal.js` — follows the convention of `gui/public/utils.js` (utility functions, no classes).
- `var ... = function()` for block-scoped helpers — standard ES5 pattern, avoids sloppy-mode function hoisting ambiguity.
- Router test structure (mock globals + `dispatchHash` + assert) — follows existing pattern throughout `router-utils.test.ts`.

## Detailed Steps

### Step 1: Remove stale `renderStrategyDetail` tests and mock from `router-utils.test.ts`

**File:** `mcp-server/tests/gui/router-utils.test.ts`

1. Delete the global declaration `var renderStrategyDetail: (...args: unknown[]) => void;` at L63.
2. Delete the mock assignment `globalThis.renderStrategyDetail = vi.fn();` at L86.
3. Delete the test `'dispatches #/strategy/:repoId to renderStrategyDetail with decoded repoId'` (L237–244).
4. Delete the test `'URL-decodes the repoId in #/strategy/:repoId'` (L246–249).

### Step 2: Update stale link assertion in `project-list.test.ts`

**File:** `mcp-server/tests/gui/project-list.test.ts`

1. Change the test description from `'label is a link pointing to #/strategy/:repoId'` to `'label is a link pointing to #/strategy'`.
2. Change the assertion to `expect(link!.getAttribute('href')).toBe('#/strategy')`.

### Step 3: Run the full MCP server test suite

Run `npm test` inside `mcp-server/` to confirm zero failures and no other stale references.

### Step 4: Extract shared modal utility — `gui/public/modal.js`

**New file:** `mcp-server/gui/public/modal.js`

Create a shared utility file with three functions:

1. **`openModal(html, triggerEl)`** — Creates the `.cs-modal-overlay` div, sets `innerHTML` to the modal HTML template wrapped in a `.cs-modal` container, appends to `document.body`, stores `triggerEl` for focus restoration, returns the overlay element.

2. **`closeModal(overlay)`** — Removes the overlay from DOM, restores focus to the stored trigger element.

3. **`wireModalEvents(overlay, opts)`** — Wires the standard lifecycle onto the overlay:
   - Close on Escape keydown
   - Close on overlay click (outside modal)
   - Focus trap (Tab/Shift+Tab cycling within `.cs-modal`)
   - Enter-to-submit: calls `opts.onSubmit()` when Enter is pressed on a non-BUTTON element. If `opts.excludeTextarea` is true (default: false), also excludes TEXTAREA elements.
   - Wires `opts.onClose` to close buttons (`.cs-modal-close`, cancel buttons).

The trigger element is stored as module-level state (like `csRenderStoreModal` does with `csTriggerElement`).

### Step 5: Refactor `renderRepoModal` to use shared modal utility

**File:** `mcp-server/gui/public/views/strategy.js`

1. Replace the inline modal DOM creation (overlay div, innerHTML, body.append) with a call to `openModal(modalHtml, triggerEl)`.
2. Replace the inline `closeModal()` function with a call to the shared `closeModal(overlay)`.
3. Replace the inline focus trap, Escape, overlay click, and Enter-to-submit wiring with a single call to `wireModalEvents(overlay, { onSubmit: handleSave, excludeTextarea: true, onClose: closeModal })`.
4. The remaining function body (field rendering, folder widget, store dropdown, save logic) stays in `renderRepoModal`.

### Step 6: Refactor `csRenderStoreModal` to use shared modal utility

**File:** `mcp-server/gui/public/views/config-stores.js`

1. Replace the inline overlay creation with `openModal(modalHtml, csTriggerElement)`.
2. Replace `csCloseModal()` with a call to the shared `closeModal(overlay)`. Delete the `csCloseModal` function and the module-level `csTriggerElement` variable (now managed by `modal.js`).
3. Replace `csWireModalEvents(overlay, modal)` with `wireModalEvents(overlay, { onSubmit: csHandleModalSave, excludeTextarea: false, onClose: function() { closeModal(overlay); } })`. Delete the `csWireModalEvents` function.
4. `csValidateModalFields()` and `csHandleModalSave()` remain unchanged.

### Step 7: Register `modal.js` in the HTML script tags

**File:** `mcp-server/gui/public/index.html` (or wherever script tags are defined)

Add `<script src="modal.js"></script>` before the view scripts that depend on it (`strategy.js`, `config-stores.js`).

### Step 8: Replace "Folder Names" column with "Store" column in `strategy.js`

**File:** `mcp-server/gui/public/views/strategy.js`

1. **Hoist state variables:** Add `var storeLabels = {};` and `var isMultiStore = false;` to the `renderStrategyList()` closure scope (alongside `currentStores`). In `renderList()`, assign them instead of declaring new locals.

2. **Update `buildTableHtml` signature:** Add `isMultiStore` parameter. Inside:
   - Replace `<th>Folder Names</th>` with `(isMultiStore ? '<th>Store</th>' : '')`.
   - For declared rows: replace the folder names `<td>` with `(isMultiStore ? '<td>' + escapeHtml(storeLabels[r.store_id] || r.store_id || '\u2014') + '</td>' : '')`.
   - For undeclared rows: same pattern.

3. **Update call sites:** `buildTableHtml(repos, isMultiStore)` in both `renderList()` and `refreshTable()`.

### Step 9: Fix `doAddFolder` block-scoped function declaration

**File:** `mcp-server/gui/public/views/strategy.js`

Change `function doAddFolder() {` to `var doAddFolder = function() {` at L738. Update the comment at L736 to reflect the fix.

### Step 10: Add race guard to `refreshTable`

**File:** `mcp-server/gui/public/views/strategy.js`

1. Add a closure-scoped counter `var refreshSeq = 0;` in the `renderStrategyList()` scope.
2. In `refreshTable()`, increment the counter at the top: `var seq = ++refreshSeq;`.
3. In the `.then()` callback, guard with `if (seq !== refreshSeq) return;` — skip rendering if a newer call has been issued.

### Step 11: Add warning log for `handleGetRepo` store_id omission

**File:** `mcp-server/gui/api-repos.ts`

In `handleGetRepo()`, after the `getAllStores().find()` call, add a `console.warn` when `match` is undefined in multi-store mode:
```typescript
if (!match) {
  console.warn(`handleGetRepo: no store found for storePath '${found.storePath}' — store_id omitted from response`);
}
```

### Step 12: Document missing API groups in `api-surface.md`

**File:** `mcp-server/docs/agents/project-manifest/api-surface.md`

Add entries for the 6 missing groups in the API client section, plus the missing individual methods in partially-documented groups:

- **Knowledge group:** `getKnowledge(repoId)`, `updateKnowledge(repoId, insightId, data)`, `deleteKnowledge(repoId, insightId)`, `promoteKnowledge(repoId, insightId)`, `moveKnowledge(repoId, insightId, targetRepoId)`
- **Orchestrator (missing methods):** `orchestratorGetRunStatus(slug)`
- **Model Registry group:** `getModels()`, `saveModels(models)`, `loadDefaultModels()`
- **Personas group:** `getPersonas()`
- **Model Assignments group:** `getAssignments()`, `updateAssignments(assignments)`, `replaceAssignedModel(oldSlug, newSlug)`, `rebuildPersonas()`
- **Repos (missing):** `moveRepo(repoId, storeId)`
- **Chunks (missing):** `getChunkText(slug, filename)`

Read each method from `api-client.js` to capture exact parameter names and return semantics.

### Step 13: Update `file-tree.md` — strategy.js annotation + `modal.js` entry

**File:** `mcp-server/docs/agents/project-manifest/file-tree.md`

1. Update the `strategy.js` entry to reference `renderRepoModal` and the Store column (replacing the stale "Add Repository form" annotation).
2. Add a `modal.js` entry: shared modal lifecycle utility (openModal, closeModal, wireModalEvents).

### Step 14: Regenerate CTX snapshots

Run `node scripts/cli.js ctx-generate` from the workspace root to remove stale `renderStrategyDetail` references from `.context/` files.

### Step 15: Final full test suite run

Run `npm test` inside `mcp-server/` to confirm all changes pass. Grep for `renderStrategyDetail` and `#/strategy/` across the codebase to confirm zero stale references.

## Dependencies
- Steps 1–3: Test fixes — sequential (modify tests, then run suite).
- Step 4: Modal utility — independent of test fixes. Must precede Steps 5–6.
- Steps 5–6: Modal refactors — depend on Step 4. Can be parallelized with each other.
- Step 7: Script registration — depends on Step 4.
- Step 8: Store column — depends on Step 4 being complete (both modify `strategy.js`; sequencing avoids conflicts). Also requires hoisted `storeLabels`/`isMultiStore`.
- Steps 9–10: `doAddFolder` fix and race guard — modify `strategy.js`, should be sequenced with Steps 5 and 8.
- Step 11: `handleGetRepo` warning — independent of all other steps.
- Step 12: API docs — independent of all code steps.
- Step 13: `file-tree.md` — depends on Steps 4 and 8 (documents new file and column change).
- Step 14: CTX regen — should run after all code and doc changes are complete.
- Step 15: Final verification — last step.

## Required Components
- `mcp-server/tests/gui/router-utils.test.ts` — existing test file (modification)
- `mcp-server/tests/gui/project-list.test.ts` — existing test file (modification)
- `mcp-server/gui/public/modal.js` — **new file** (shared modal lifecycle utility)
- `mcp-server/gui/public/views/strategy.js` — existing frontend view (modification)
- `mcp-server/gui/public/views/config-stores.js` — existing frontend view (modification)
- `mcp-server/gui/public/index.html` — existing HTML (modification: add script tag)
- `mcp-server/gui/api-repos.ts` — existing backend handler (modification)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — existing manifest (modification)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — existing manifest (modification)

## Assumptions
- The "Folder Names" column has no other consumers beyond the Strategy table. The `folder_names` data remains available in the repo modal for editing.
- The shared modal utility will be loaded globally via a `<script>` tag, making `openModal`, `closeModal`, and `wireModalEvents` available as global functions — consistent with the existing `escapeHtml`, `showError`, etc. pattern.
- The `console.warn` in `handleGetRepo` is acceptable for a low-probability edge case — no structured logging infrastructure exists in the GUI API layer.

## Constraints
- The GUI frontend uses ES5 sloppy-mode JavaScript — no arrow functions, no `let`/`const`, no template literals.
- No automated frontend tests exist for `gui/public/views/*.js` — verification is via the backend test suite and browser testing.
- CTX regeneration requires `ctx` on PATH.

## Out of Scope
- Non-atomic cross-store move hardening in `handleMoveRepo()` (synthesis D-6 / strategic rec #1) — requires write-ahead log or journaling infrastructure design; a genuinely architectural initiative that deserves its own plan.
- Frontend test harness for `gui/public/views/*.js` (synthesis strategic rec #2) — infrastructure project requiring jsdom setup, test boilerplate design, and coverage strategy; deserves its own plan.

## Acceptance Criteria

- AC-01: The full MCP server test suite (`npm test` in `mcp-server/`) passes with zero failures.
- AC-02: No test or production code references `renderStrategyDetail` or the `#/strategy/:repoId` route pattern.
- AC-03: The `project-list.test.ts` link assertion expects `#/strategy` (flat URL, no repo ID parameter).
- AC-04: In multi-store mode, the Strategy Repositories table displays a "Store" column showing the store label for each repository.
- AC-05: In single-store mode, the "Store" column is not rendered.
- AC-06: The "Folder Names" column is no longer displayed in the Strategy Repositories table.
- AC-07: A shared `modal.js` utility file exists with `openModal`, `closeModal`, and `wireModalEvents` functions.
- AC-08: `renderRepoModal` in `strategy.js` delegates modal lifecycle to `modal.js`.
- AC-09: `csRenderStoreModal` in `config-stores.js` delegates modal lifecycle to `modal.js`.
- AC-10: `doAddFolder` in `strategy.js` uses a `var` function expression, not a block-scoped function declaration.
- AC-11: `refreshTable` in `strategy.js` uses an in-flight guard that discards stale API responses.
- AC-12: `handleGetRepo` logs a warning when `store_id` cannot be resolved in multi-store mode.
- AC-13: `api-surface.md` documents all API client method groups including Knowledge, Model Registry, Personas, Model Assignments, and all previously missing individual methods.
- AC-14: `file-tree.md` includes an entry for `modal.js` and an updated annotation for `strategy.js`.
- AC-15: `.context/` snapshots are regenerated and contain no `renderStrategyDetail` references.

## Testing Strategy
The test regression fixes (Steps 1–3) are self-verifying via the full test suite. The modal extraction (Steps 4–7), Store column (Step 8), `doAddFolder` fix (Step 9), race guard (Step 10), and `handleGetRepo` warning (Step 11) require browser verification for frontend changes and a test suite run for the backend change. Documentation steps are verified by reading the updated files. CTX regeneration is verified by grepping the output.

## Test Plan
- `mcp-server/tests/gui/router-utils.test.ts` — Verify deleted tests no longer appear; remaining `#/strategy` dispatch test passes — covers AC-01, AC-02.
- `mcp-server/tests/gui/project-list.test.ts` — Verify updated assertion passes with `#/strategy` — covers AC-01, AC-03.
- Full suite run — covers AC-01.
- Browser: Strategy page in multi-store mode — Store column with correct labels — covers AC-04.
- Browser: Strategy page in single-store mode — Store column absent — covers AC-05.
- Browser: Folder Names column absent in both modes — covers AC-06.
- Browser: Open repo modal from Strategy page — modal opens, focus traps, Escape closes, overlay click closes, Enter submits, save works — covers AC-08.
- Browser: Open store modal from Config page — same lifecycle verification — covers AC-09.
- Browser: Rapid checkbox toggling on Strategy page — table shows correct final state — covers AC-11.
- Grep: `renderStrategyDetail` and `#/strategy/` across codebase — zero matches — covers AC-02, AC-15.
- Read: `modal.js` exists with three exported functions — covers AC-07.
- Read: `doAddFolder` uses `var ... = function()` — covers AC-10.
- Read: `handleGetRepo` contains `console.warn` for missing store match — covers AC-12.
- Read: `api-surface.md` contains all API groups — covers AC-13.
- Read: `file-tree.md` contains `modal.js` entry and updated `strategy.js` annotation — covers AC-14.

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add 6 missing API client groups + individual missing methods (Step 12) — covers AC-13.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `modal.js` entry; update `strategy.js` annotation (Step 13) — covers AC-14.
- `.context/` — Regenerate via `node scripts/cli.js ctx-generate` (Step 14) — covers AC-15.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Non-atomic cross-store writes in `handleMoveRepo()` | Synthesis D-6 / Strategic Rec #1 | Requires write-ahead log or journaling infrastructure — genuinely architectural initiative | Deserves its own plan when reliability hardening is prioritized |
| 2 | Frontend test harness for `gui/public/views/*.js` | Strategic Rec #2 | Infrastructure project requiring jsdom setup, test boilerplate, coverage strategy | Most valuable next investment for GUI quality; deserves its own plan |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Modal extraction breaks existing behavior** | Both modals currently work identically. The shared utility is a pure extract-and-delegate refactor. Browser testing verifies both modals post-refactor. |
| **Other stale test references exist beyond D-1/D-2** | Step 3 and Step 15 run the full test suite; grep confirms zero stale references. |
| **Store column shows raw IDs instead of labels** | Fallback chain: `storeLabels[r.store_id] \|\| r.store_id \|\| '\u2014'` handles missing mappings. |
| **`modal.js` script load order** | Script tag placed before view scripts in `index.html`. Both consumers call utility functions synchronously during render — they execute after DOM ready. |
| **`api-surface.md` method signatures drift** | Read each method directly from `api-client.js` during Step 12 to capture exact current signatures. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are within the `mcp-server` module following established patterns. The modal extraction is a refactor, not new architecture. A single developer session with self-review suffices.
