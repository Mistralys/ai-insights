# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The parent project `2026-08-01-gui-store-management` delivered a full CRUD Stores tab for the MCP Server GUI. It completed 8/8 work packages with 3,944 passing tests and zero regressions. A notable 3-cycle rework on WP-006 established an ES5 event-listener lifecycle convention. This rework plan addresses all deferred items and out-of-scope observations from its synthesis.

## Summary
This rework addresses nine items carried forward from the `2026-08-01-gui-store-management` synthesis: five deferred items (modal focus restoration, label hint mode awareness, route dispatch ordering test, absent-label test case, `reloadStoreContext()` concurrency guard) and four out-of-scope observations (reorder-mode error target, Git helper cleanup, double-banner edge case, sync popover overflow). All items are small, independent fixes that improve accessibility, reliability, test coverage, and code quality of the newly delivered Stores tab.

## Architectural Context
The Stores tab spans:
- **Frontend:** `config-stores.js` — a 700-line ES5 module using event delegation, module-level state variables, and a modal lifecycle pattern with focus trapping.
- **Backend API:** `gui/api-stores.ts` — eight CRUD handlers following the domain-split pattern, with `runGit()` as a private helper for Git subprocess calls.
- **Backend service:** `store-context.ts` — module-level singleton pattern with `reloadStoreContext()` for hot-reload.
- **Routing:** `gui/server.ts` → `buildStoreRoutes()` — literal-path-before-parameterized ordering constraint.
- **Tests:** `tests/gui/api-stores.test.ts` — 58 assertions covering all handlers via mocked dependencies.

## Approach / Architecture
Each item is a self-contained fix within the existing architecture. No new files, no new patterns, no new dependencies. The changes break down into three categories:

1. **Frontend fixes** (Steps 1–4): ES5 modifications to `config-stores.js` and `styles.css` — modal focus restore, label hint conditionals, reorder error target, banner dedup, popover flip.
2. **Backend fixes** (Steps 5–6): TypeScript modifications to `api-stores.ts` (Git helper cleanup) and `store-context.ts` (concurrency guard).
3. **Test additions** (Steps 7–8): New test cases in `api-stores.test.ts` (absent-label) and a new or extended test for route dispatch ordering.

## Rationale
These items were explicitly tracked in the synthesis as deferred/out-of-scope rather than forgotten. Addressing them in a single rework plan is efficient because they all touch files from the same parent project, are independently implementable, and collectively close the last known quality gaps in the Stores tab.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Concurrency guard for `reloadStoreContext()` | Promise-based inflight guard (module-level `_pending` variable) | `proper-lockfile` (file-level), `Mutex` class, no guard | File locking is overkill for in-memory singleton swap; a class adds unnecessary lifecycle. A simple "if inflight, return existing promise" pattern is sufficient and transparent to callers. |
| Popover overflow fix | JS-based viewport check on show | CSS-only `transform` repositioning, CSS `anchor-positioning` | CSS-only approaches cannot reliably flip an absolutely-positioned tooltip without knowing the viewport boundary. A JS check at show-time is ~5 lines and handles all edge cases. No other GUI popovers have flip logic, so this establishes the minimal pattern. |
| Route dispatch test | Extend `route-table.test.ts` with `findIndex` ordering assertion | Server-level integration test, new dedicated test file | `route-table.test.ts` already imports `getRouteDescriptors()` and tests route invariants — adding ordering checks there follows the established pattern without a new file or HTTP harness. |

## Pattern Alignment
- ES5 module-level state pattern — followed (`config-stores.js` L22–L30)
- Event delegation with `removeEventListener` lifecycle — followed (`config-stores.js` L29)
- Domain-split handler file pattern — followed (`api-stores.ts`)
- Plain-function module for stateless storage helpers (KN-0005) — followed for concurrency guard in `store-context.ts`
- `showError(el, msg)` pattern from `components.js` — followed for reorder error target

## Detailed Steps

### Step 1: Modal focus restoration (WCAG 2.1 SC 3.2.2)

**Files:** `mcp-server/gui/public/views/config-stores.js`

1. Add a module-level variable `var csTriggerElement = null;` alongside the other state variables (after L30).
2. In `csRenderStoreModal()` (L253), capture `csTriggerElement = document.activeElement;` as the first statement before any DOM manipulation.
3. In `csCloseModal()` (L289), after removing the overlay and before nulling state, restore focus:
   ```
   if (csTriggerElement && typeof csTriggerElement.focus === 'function') {
     csTriggerElement.focus();
   }
   csTriggerElement = null;
   ```
4. Handle the edge case where `csTriggerElement` may be the `document.body` or a removed element — the `typeof .focus === 'function'` check covers this, and calling `.focus()` on a detached element is a harmless no-op.

### Step 2: Label "(optional)" hint — mode-aware rendering

**Files:** `mcp-server/gui/public/views/config-stores.js`

1. In `csRenderStoreModal()` (L248–L253), make the label field hint conditional on mode and existing label state:
   - In **add mode**: always show `(optional)` — the label is genuinely optional.
   - In **edit mode** with an existing label: show `(required — clear the store to remove)` or simply omit the `(optional)` text, since clearing a label on a labelled store triggers an error.
   - In **edit mode** without an existing label: show `(optional)` — the user can leave it empty.
2. Compute `var labelHint` before building `labelField`, using `isAdd`, `store`, and `store.label` to determine the appropriate hint text.
3. Replace the hardcoded `(optional)` span with the dynamic `labelHint` variable.

### Step 3: Reorder-mode error target

**Files:** `mcp-server/gui/public/views/config-stores.js`

1. In `csRenderReorderView()` (L172–L198), add an error placeholder element after the reorder list and before the action bar:
   ```
   '<div id="cs-reorder-error"></div>' +
   ```
2. Update `csShowTableError()` (L698–L700) to check both `#cs-table-error` and `#cs-reorder-error`:
   ```
   function csShowTableError(msg) {
     var el = document.getElementById('cs-table-error') || document.getElementById('cs-reorder-error');
     if (el) showError(el, msg);
   }
   ```
   This ensures that failed `API.reorderStores()` calls in `csMoveStore()` (L692) display their error message regardless of view mode.
3. Modify the `csMoveStore()` catch block (L691–L693) to stay in reorder mode on failure instead of refreshing the full tab. Currently the catch block calls `csShowTableError(msg)` then `csRefreshTab()` — the refresh replaces the entire tab content, wiping the error. Replace the catch-block body with the following sequence, **in this exact order**:
   1. Revert the optimistic array swap (restore `csStores` to its pre-move order).
   2. `contentEl.innerHTML = csRenderReorderView(csStores); csWireEvents();` — re-render the reorder view with a fresh, empty `#cs-reorder-error` element.
   3. `csShowTableError(msg)` — called **after** the re-render, so the error message lands in the freshly-created `#cs-reorder-error` element.
   - Do **not** call `csRefreshTab()` on the error path — the user stays in reorder mode with the error visible and can retry or cancel.
   - **Ordering invariant:** `csShowTableError()` must be the last call in the catch block (after the re-render and re-wiring), because the re-render creates the `#cs-reorder-error` target element that `csShowTableError()` writes into. Calling it before the re-render would inject the error into the old DOM, which the re-render then replaces.
4. Update the `csReorderMode` documentation comment at L14–18. The current comment states that `csShowTableError()` is a deliberate no-op during reorder mode and explains that `csRefreshTab()` in the catch block restores correct view state. After the changes above, both statements are false — `csShowTableError()` now targets `#cs-reorder-error`, and the catch block no longer calls `csRefreshTab()`. Rewrite the comment to reflect the new dual-target error display behavior.

### Step 4: Double-banner deduplication and popover overflow

**Files:** `mcp-server/gui/public/views/config-stores.js`, `mcp-server/gui/public/styles.css`

**4a — Double-banner fix:**
1. In `csRefreshWithStores()` (L455), after `contentEl.innerHTML = renderStoresTab(stores)` but before injecting the new banner, remove any existing notification banner that `renderStoresTab()` may have preserved:
   ```
   var existingBanner = document.getElementById('cs-notification-banner');
   if (existingBanner && warning) existingBanner.remove();
   ```
   This ensures at most one banner exists at any time.

**4b — Popover overflow guard:**
1. In the sync badge `mouseenter` / `focus` event handlers (L620–L636), after adding `cs-sync-popover-visible`, add a viewport overflow check:
   ```
   var rect = popover.getBoundingClientRect();
   if (rect.right > window.innerWidth) {
     popover.style.left = 'auto';
     popover.style.right = '0';
   }
   ```
2. In the corresponding `mouseleave` / `blur` handlers, reset the inline styles:
   ```
   popover.style.left = '';
   popover.style.right = '';
   ```
3. This keeps the default left-aligned positioning for most cases and only flips when the popover would overflow the viewport.

### Step 5: Git helper cleanup — remove redundant `-C` arguments

**Files:** `mcp-server/gui/api-stores.ts`

1. Remove the `-C storePath` arguments from both `runGit()` call sites in `detectGitStatus()` (L109, L117–L119), since `cwd: storePath` already sets the working directory:
   - `runGit(['rev-parse', '--git-dir'], storePath)` (was `['-C', storePath, 'rev-parse', '--git-dir']`)
   - `runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], storePath)` (was `['-C', storePath, 'rev-list', ...]`)
2. **(Optional refactor)** If the implementer judges it worthwhile, extract the `rev-list` parsing into a `gitRevList()` helper to consolidate the parsing surface. This is not required for correctness — the `-C` removal in sub-step 1 is the necessary bug fix. The extraction is a readability improvement:
   ```typescript
   async function gitRevList(cwd: string): Promise<{ ahead: number; behind: number } | null> {
     const raw = await runGit(
       ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
       cwd
     );
     const parts = raw.trim().split(/\s+/);
     const ahead = parseInt(parts[0] ?? '', 10);
     const behind = parseInt(parts[1] ?? '', 10);
     return !isNaN(ahead) && !isNaN(behind) ? { ahead, behind } : null;
   }
   ```
   If extracted, simplify `detectGitStatus()` to use `gitRevList()`:
   ```typescript
   try {
     const counts = await gitRevList(storePath);
     if (counts) return { is_git: true, ...counts };
   } catch { /* no upstream, timeout, or detached HEAD */ }
   return { is_git: true };
   ```

### Step 6: `reloadStoreContext()` concurrency guard

**Files:** `mcp-server/src/storage/store-context.ts`

1. Add a module-level variable to track an inflight reload:
   ```typescript
   let _pendingReload: Promise<StoresConfig | null> | undefined;
   ```
2. Wrap the body of `reloadStoreContext()` in an inflight guard:
   ```typescript
   export async function reloadStoreContext(
     configPath?: string
   ): Promise<StoresConfig | null> {
     if (_pendingReload) return _pendingReload;
     _pendingReload = (async () => {
       try {
         const config = await loadStoresConfig(configPath);
         const router = new StoreRouter(config, { skipDirCreate: true });
         const manager = new MultiStoreManager(router);
         setStoreContext(router, manager);
         return config;
       } finally {
         _pendingReload = undefined;
       }
     })();
     return _pendingReload;
   }
   ```
3. This ensures concurrent calls return the same promise, and the guard clears on completion (success or failure).

### Step 7: `handleUpdateStore` absent-label test case

**Files:** `mcp-server/tests/gui/api-stores.test.ts`

1. Add a new test case to the `handleUpdateStore()` describe block, after the existing "rejects whitespace-only label" test:
   ```typescript
   it('rejects absent label with VALIDATION_ERROR', async () => {
     const storeDir = join(ledgerRoot, 'my-store');
     mockLoadStoresConfig.mockResolvedValue(
       makeConfig([{ id: 'my-store', path: storeDir }])
     );

     await expect(
       handleUpdateStore('my-store', {})
     ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
   });
   ```
2. This tests the Zod schema validation path where `label` is entirely missing from the body (as opposed to whitespace-only).

### Step 8: Route dispatch ordering test

**Files:** `mcp-server/tests/gui/route-table.test.ts` (existing file)

1. Add test cases to the existing `route-table.test.ts` file, which already imports `getRouteDescriptors()` and tests route table invariants.
2. Use a `findIndex` comparison on the route descriptors array to assert that `PUT /api/stores/order` (literal) appears before the `PUT /api/stores/:storeId` regex in the route table:
   ```typescript
   const descriptors = getRouteDescriptors();
   const literalIdx = descriptors.findIndex(
     d => d.method === 'PUT' && d.path === '/api/stores/order'
   );
   const regexIdx = descriptors.findIndex(
     d => d.method === 'PUT' && d.path instanceof RegExp && d.path.test('/api/stores/some-id')
   );
   expect(literalIdx).toBeGreaterThanOrEqual(0);
   expect(regexIdx).toBeGreaterThanOrEqual(0);
   expect(literalIdx).toBeLessThan(regexIdx);
   ```
3. This validates the ordering constraint without requiring a full HTTP server test harness, using the same route descriptor inspection pattern already established in `route-table.test.ts`.

### Step 9: Documentation updates

**Files:** Various manifest and context documents

1. Update `mcp-server/docs/agents/project-manifest/api-surface.md`:
   - Document the `gitRevList()` helper in the `api-stores.ts` section.
   - Update `csCloseModal()` documentation to note focus restoration behavior.
   - Update `csShowTableError()` documentation to note dual-target behavior.
   - Remove or update the WCAG 2.1 SC 3.2.2 accessibility gap note (now resolved).
2. Update `mcp-server/gui/docs/agents/project-manifest/ui-components.md`:
   - Add `#cs-reorder-error` to the reorder sub-view class table.
   - Document the popover flip-left behavior.
3. After all code changes: run `node scripts/cli.js ctx-generate` to regenerate `.context/` snapshots.

## Dependencies
- All steps are independent and can be implemented in any order.
- Step 9 (documentation) should be done after all code changes are complete.
- CTX regeneration (final substep of Step 9) requires all prior documentation updates.

## Required Components
- `mcp-server/gui/public/views/config-stores.js` — Steps 1, 2, 3 (including `csMoveStore()` catch block and `csReorderMode` comment), 4
- `mcp-server/gui/public/styles.css` — Step 4b (popover overflow)
- `mcp-server/gui/api-stores.ts` — Step 5
- `mcp-server/src/storage/store-context.ts` — Step 6
- `mcp-server/tests/gui/api-stores.test.ts` — Step 7
- `mcp-server/tests/gui/route-table.test.ts` (existing) — Step 8
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Step 9
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Step 9

## Assumptions
- `document.activeElement` is reliably available in all target browsers for focus capture (standard DOM API, universally supported).
- The `buildStoreRoutes()` function's route ordering constraint is the only mechanism preventing `order` from being captured as a `:storeId` — no secondary guard exists.
- The concurrency guard on `reloadStoreContext()` only needs to coalesce overlapping calls, not queue them — first-inflight-wins semantics apply: concurrent callers receive the same promise from the first call, which reflects the state at the first caller's write time rather than the second caller's. This is acceptable because all callers intend to reload the current `stores.json` state.

## Constraints
- All frontend code must remain ES5-compatible (no `let`, `const`, arrow functions, template literals, `class`).
- `runGit()` (and `gitRevList()`, if extracted) must remain private to `api-stores.ts`.
- The concurrency guard must not change `reloadStoreContext()`'s return type or error semantics.

## Out of Scope
- `StoreRouterOptions` named interface extraction — trigger condition (second constructor option) has not occurred.
- Changelog updates — handled separately by the Changelog Curator.
- Performance optimization of `buildEnrichedMultiStoreList()` Git detection.

## Acceptance Criteria

- AC-01: `csCloseModal()` restores focus to the element that was focused when the modal was opened. Verifiable by keyboard-navigating to the Add/Edit button, opening the modal, closing it, and confirming focus returns to the button.
- AC-02: The label field hint in the store modal shows "(optional)" only when the label is genuinely optional (add mode, or edit mode without an existing label). In edit mode with an existing label, the hint is omitted or replaced with a mode-appropriate message.
- AC-03: `csShowTableError()` displays error messages in both main-table and reorder sub-view modes (via `#cs-table-error` or `#cs-reorder-error`). In reorder mode, a failed `csMoveStore()` call stays in the reorder view with the error visible — the catch block does not call `csRefreshTab()`.
- AC-04: At most one `cs-notification-banner` exists in the DOM after any call to `csRefreshWithStores()`, even when a banner was already present.
- AC-05: The sync popover does not overflow the right viewport edge. When it would overflow, it repositions to align its right edge with the cell.
- AC-06: `runGit()` calls in `detectGitStatus()` do not pass redundant `-C storePath` arguments. Optionally, a `gitRevList()` helper encapsulates the `rev-list` parsing (implementer's judgment).
- AC-07: Concurrent calls to `reloadStoreContext()` are coalesced — the second call returns the same promise as the first, and `setStoreContext()` is called exactly once.
- AC-08: `handleUpdateStore()` rejects a body with no `label` field (`{}`) with `VALIDATION_ERROR`. A test case in `api-stores.test.ts` asserts this.
- AC-09: A test in `route-table.test.ts` verifies that `PUT /api/stores/order` (literal) appears before `PUT /api/stores/:storeId` (regex) in the route descriptor array — proving the literal-path ordering constraint is necessary and functional.
- AC-10: Project manifest documents (`api-surface.md`, `ui-components.md`) are updated to reflect all changes. `.context/` snapshots are regenerated.

## Testing Strategy
Steps 1–5 are frontend/backend logic changes verified by manual testing and existing regression suite. Steps 6–8 add explicit automated tests. The full MCP server test suite (`npm test` in `mcp-server/`) must pass with zero regressions after all changes.

## Test Plan

- `mcp-server/tests/gui/api-stores.test.ts` — new test: `handleUpdateStore` rejects absent label with VALIDATION_ERROR — covers AC-08
- `mcp-server/tests/gui/route-table.test.ts` (existing) — add test: `PUT /api/stores/order` literal appears before `PUT /api/stores/:storeId` regex in route descriptors — covers AC-09
- `mcp-server/tests/storage/store-context-reload.test.ts` (existing) — add test case: concurrent `reloadStoreContext()` calls return same promise and result in single `setStoreContext()` call — covers AC-07
- Manual test: open modal via keyboard, close, verify focus returns — covers AC-01
- Manual test: open edit modal on labelled store, verify no "(optional)" hint — covers AC-02
- Manual test: trigger reorder API failure, verify error message appears — covers AC-03
- Manual test: import store (produces banner + warning), verify single banner — covers AC-04
- Manual test: scroll sync popover near right viewport edge, verify no overflow — covers AC-05
- Full regression: `npm test` in `mcp-server/` — all existing 3,944+ tests must pass — covers all ACs

## Documentation Updates

Per the `AGENTS.md` manifest maintenance rules:
- `mcp-server/docs/agents/project-manifest/api-surface.md` — if `gitRevList()` is extracted, document the helper; update `csCloseModal()` focus restoration, `csShowTableError()` dual-target, remove WCAG gap note
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — add `#cs-reorder-error` element, document popover flip behavior
- `.context/` snapshots — regenerate via `node scripts/cli.js ctx-generate` after all changes

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | `StoreRouterOptions` named interface extraction | WP-001 code-review | Trigger condition (second constructor option) has not occurred | Extract when the first additional option is added to `StoreRouter` constructor |
| 2 | Add `if (contentEl)` null guard to Step 3 catch-block DOM write | Audit cycle 3, minor m-01 | Does not block correctness for normal usage; guard prevents a `TypeError` only if user navigates away mid-flight | Before implementing Step 3, add `if (contentEl) { … }` around the re-render in the catch block — consistent with the `.then()` path at L683–L689 of `config-stores.js` |
| 3 | AC-07 wording correction | Audit cycle 3, minor m-02 | Does not block implementation; wording inaccuracy could cause misleading `expect(p1).toBe(p2)` assertion | Rewrite AC-07 as: "Concurrent calls coalesce onto a single underlying reload — both calls resolve to the same value and `setStoreContext()` is called exactly once" |
| 4 | Add conditional qualifier to Step 9.1 `gitRevList()` documentation instruction | Audit cycle 3, minor m-03 | Inconsistency between Step 9.1 (unconditional) and Documentation Updates section (qualifies as "if extracted") | Change Step 9.1 to read "If `gitRevList()` was extracted in Step 5, document the helper…" |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Popover flip logic introduces visual glitches on resize** | Reset inline styles on hide; re-check on next show. Keep the logic minimal (~5 lines). |
| **Concurrency guard masks errors from callers** | Guard uses `try/finally` to always clear `_pendingReload` — all callers receive the same resolution/rejection. |
| **Route dispatch test is fragile if route structure changes** | Test documents the ordering invariant explicitly. If routes are restructured, the test failure surfaces the constraint immediately. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Nine independent items spanning frontend, backend, and tests benefit from formal QA and review stages to validate the accessibility, concurrency, and routing fixes.
