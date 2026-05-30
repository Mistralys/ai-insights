# Plan

## Plan Audit Cycles
- Audits: 3 (cycle 1: FAIL → rework; cycle 2: PASS WITH FINDINGS/Major → rework; cycle 3: PASS WITH FINDINGS/Minor → converged) — Plan Auditor v1.3.1
- Architectural Reviews: 1 (2026-05-29) — Plan Architect Reviewer v1.4.0

## Summary

This rework addresses all actionable items from the synthesis report for plan
`2026-05-28-knowledge-gui`. The synthesis identified seven concrete improvements
across four concern areas: (1) UX degradation in the Knowledge view caused by
filter-bar DOM rebuild resetting the search-input focus, and duplicated
`getDistinctValues` logic; (2) a TOCTOU window in the promote/move handlers
caused by two sequential `withLock` spans; (3) incomplete search forwarding in
`handleListKnowledge` (tags and pagination ignored when a free-text query is
present); (4) `unsafe-inline` in the Content-Security-Policy, introduced
pre-existing but never addressed; and (5) maintainability debt in `gui/api.ts`
(~1,959 lines) and a style inconsistency in the `PATCH /api/projects/` route
guard. Six work packages address all findings. Documentation consolidation
lands as WP-006.

---

## Architectural Context

All changes are within the **MCP Server sub-project** (`mcp-server/`). Key
modules affected:

| Module | Path | Role |
|--------|------|------|
| Knowledge SPA view | `gui/public/views/knowledge.js` | Client-side JS view (no build step — plain ES5) |
| GUI API handlers | `gui/api.ts` (~2,145 lines) | Exports handler functions; called by `gui/server.ts` |
| HTTP server | `gui/server.ts` | Two-tier dispatch: `matchRoute()` (body-free) + `handleRequest()` (body-parsing special cases) |
| Knowledge store | `src/storage/knowledge-store.ts` | `KnowledgeStoreManager` — all CRUD operations; uses `withLock` for read-modify-write |
| Storage lock | `src/storage/file-lock.ts` | Cross-platform `withLock(dir, fn)` — locks `.knowledge/` directory |
| Tests | `tests/storage/knowledge-store.test.ts`, `tests/gui/api-knowledge.test.ts`, `tests/gui/server-knowledge-routes.test.ts` | Existing test suites to extend |

The storage lock constraint is the key architectural fact for WP-002:
`withLock(dir, fn)` acquires a lock on a directory. All CRUD methods acquire
the lock on `.knowledge/`. A single `withLock` span can therefore atomically
read, modify, and write *multiple* store files, provided the writes go to the
same `.knowledge/` directory.

---

## Approach / Architecture

### WP-001 — Knowledge view UX fixes

Two minimal changes to `gui/public/views/knowledge.js`:

1. **Focus-loss fix.** In `renderList()`, capture `document.activeElement`
   before the filter-bar DOM rebuild to record whether the search input
   (`#kn-query`) held focus. After `wireFilterBarEvents(filterBarEl)` completes,
   re-focus `#kn-query` only if it was the active element before the rebuild.
   This conditional approach is required because `renderList()` is called from
   every card action (edit, cancel, delete, confirm-delete, move, cancel-move)
   and every tab-change, not only from filter-bar key input. An unconditional
   `.focus()` call would steal focus in card-action contexts (e.g., from an
   Edit button before the user can interact with the edit form).
   Since `#kn-query` is the only text input in the filter bar, the guard is:
   `var hadFocus = document.activeElement && document.activeElement.id === 'kn-query';`
   captured before the DOM rebuild, and `if (hadFocus && qEl) qEl.focus();`
   after `wireFilterBarEvents` completes.

2. **`getDistinctValues()` helper.** `render()` and `wireFilterBarEvents()`
   both independently iterate `allInsights` to collect distinct categories and
   project slugs. Extract this logic into a private `getDistinctValues()`
   function scoped inside `renderKnowledge()`. Both call sites replace their
   inline loops with a single `getDistinctValues()` call.

### WP-002 — `KnowledgeStoreManager.moveInsight()` atomic method

Add a new `async moveInsight(id, sourceFilter, targetScope, targetProjectSlug?)` method to `KnowledgeStoreManager`. The method acquires **one** `withLock` span that:

1. Resolves the source store path from `sourceFilter` (scope + project_slug).
2. Finds the insight by `id` in the source store.
3. Constructs the target insight (changing `scope`/`project_slug`, resetting
   `updated_at`).
4. Writes the new insight to the target store (incrementing its `next_id`).
5. Deletes the original insight from the source store.
6. Writes both stores atomically via `atomicWriteJson`.

All six steps execute under a single `withLock(this.knowledgeDir(), ...)` call,
eliminating the TOCTOU window. Error before step 4 completes leaves both stores
unchanged (the new insight is not yet written). A panic after step 4 but before
step 5 completes would leave a duplicate; this window is orders of magnitude
smaller than the current two-lock pattern and represents a partial-write failure
mode equivalent to the existing handler behaviour.

### WP-003 — Handler wiring + `gui/api-knowledge.ts` extraction

Two changes in one WP to avoid doing two consecutive large edits to `api.ts`:

1. **Wire handlers through `moveInsight()`.** Update `handlePromoteKnowledge`
   and `handleMoveKnowledge` to call `manager.moveInsight()` instead of the
   current `addInsight → deleteInsight` compose pattern. The handler API surface
   does not change.

2. **Extract to `gui/api-knowledge.ts`.** Move all knowledge-specific exports
   (the 5 handlers, 2 Zod schemas, `parseKnowledgeId` helper) from `gui/api.ts`
   into a new `gui/api-knowledge.ts`. Update `gui/server.ts` to import from
   `./api-knowledge.js`. No exports are re-exported from `api.ts`; the move is
   a clean cut.

### WP-004 — `searchInsights()` tag + pagination forwarding

Two coordinated changes:

1. **`KnowledgeStoreManager.searchInsights()`.** Extend the method signature to
   accept `limit?`, `offset?`, and `tags?` alongside the existing `filters`
   parameter. Apply tag filtering and slicing after the existing substring
   match, mirroring the pattern already used in `listInsights()`.

2. **`handleListKnowledge()`.** The handler currently ignores `limit`, `offset`,
   and `tags` when `query` is present (documented ⚠ in `api-surface.md`).
   After the storage change, forward these parameters through in the
   `searchInsights()` code path. Remove the ⚠ note from the JSDoc and update
   `api-surface.md`.

### WP-005 — CSP hardening + PATCH route-matching cleanup

1. **Inline script extraction (CSP fix).** The sole `'unsafe-inline'` source
   in `script-src` is the theme-initialisation inline `<script>` block in
   `gui/public/index.html` (lines 8–14). Extract it to
   `gui/public/theme-init.js`, add a `<script src="/theme-init.js?v=1"></script>`
   tag in `index.html` at the same position, and tighten the CSP header in
   `server.ts` to remove `'unsafe-inline'` from `script-src` only.
   `style-src` must retain `'unsafe-inline'` because six view JS files
   (`config.js`, `knowledge.js`, `project-detail.js`, `project-list.js`,
   `run-log.js`, `work-package.js`) generate HTML via `innerHTML` with
   `style=""` attributes; modern browsers enforce `style-src` on inline style
   attributes in `innerHTML`-injected content, and removing `'unsafe-inline'`
   from `style-src` would break the entire SPA. Hardening `style-src` requires
   converting those inline attributes to CSS classes — a separate effort
   deferred from this rework.
   The server must serve `theme-init.js` as a static file — the existing
   static-file handler in `server.ts` already serves all files under
   `gui/public/` so no routing change is needed.

2. **PATCH /api/projects/ regex alignment.** Replace the `path.startsWith('/api/projects/')` guard with a boolean regex test consistent with the knowledge route pattern: `if (method === 'PATCH' && /^\/api\/projects\/.+$/.test(path))`. Unlike the knowledge routes (which use `.exec()` to extract a capture group), this guard only tests the boolean result, so `.test()` is idiomatic. Behaviour is identical; style is now consistent.

### WP-006 — Documentation

Update manifest documents and changelog to reflect all changes from WP-001–005.

---

## Rationale

- **WP-001:** The focus-loss issue is a confirmed UX regression on the primary interactive control of the Knowledge page. The `getDistinctValues` duplication was already flagged as a drift risk. Both fixes are cosmetic/structural with no API surface change.
- **WP-002:** Eliminating the TOCTOU window is the architecturally correct fix. The storage layer already provides a single lock covering the entire `.knowledge/` directory, so a multi-store atomic move requires zero new infrastructure.
- **WP-003:** The extraction is pure refactoring: no logic changes, no API changes. The handler wiring is the immediate consumer of WP-002. Combining both in one WP avoids two sequential large edits to `api.ts` and leaves a clean `api-knowledge.ts` for WP-004 to extend.
- **WP-004:** The `searchInsights()` limitation was explicitly marked as open in the original plan. Tag + pagination forwarding rounds out the search path to match the list path's capabilities.
- **WP-005 (inline script extraction):** Extracting the 6-line theme-init script to a file is strictly simpler than nonce injection and achieves the same security result for `script-src`. Nonce injection would require dynamic HTML serving per-request, contradicting the static-file architecture. Hash-based CSP is another option but requires a build step to recompute hashes on every script change. Only `script-src 'unsafe-inline'` is removed; `style-src` retains `'unsafe-inline'` because view JS files generate inline styles via `innerHTML`, and removing it would break the entire SPA.
- **WP-005 (PATCH regex):** Style consistency with no behaviour change. Low-risk.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| CSP hardening mechanism | Extract inline script to `theme-init.js` (removes `unsafe-inline`) | Nonce per-request (requires dynamic HTML serving); hash-based CSP (requires build step to recompute on script changes) | Extraction is a one-time change with no runtime overhead and no tooling requirements. Nonce injection contradicts the static-file serving architecture. Hash is fragile on every script edit. |
| Atomic move implementation | Single `withLock` span in new `moveInsight()` method | Keep add→delete compose in handlers but add compensating delete-on-failure logic | `moveInsight()` eliminates the window entirely and is the canonical place for this knowledge in the storage layer. Compensating logic in the handler is complex and error-prone. |
| `api.ts` split scope | Extract only knowledge symbols to `api-knowledge.ts` | Split by all functional domains (projects, health, orchestrator, etc.) | The synthesis flags `api.ts` size but does not mandate a full split. A targeted extraction resolves the immediate maintainability issue without a risky large-scale refactor. |
| `searchInsights()` extension | Add `limit`/`offset`/`tags` directly to the existing method signature | Add a new `searchInsightsPaginated()` overload | Extending the existing signature (all new params optional) is backward-compatible and avoids a proliferation of near-identical methods. |

---

## Pattern Alignment

| Pattern | Alignment |
|---------|-----------|
| `withLock` for all read-modify-write sequences | `moveInsight()` follows this pattern exactly — confirmed by `addInsight`, `updateInsight`, `deleteInsight` in `knowledge-store.ts` |
| `atomicWriteJson` for all writes | `moveInsight()` calls `atomicWriteJson` for each mutated store, consistent with all other write methods |
| Regex guard in `handleRequest()` body-parsing tier | WP-005 PATCH /api/projects/ uses `.test()` for a pure boolean guard; knowledge routes use `.exec()` because they extract a capture group (`match[1]`). Both follow the regex-over-`startsWith` convention established in the original plan. |
| Static-file serving from `gui/public/` | `theme-init.js` is placed in `gui/public/` and served by the existing static handler — no new routing needed |
| `tests/storage/` for storage-layer tests, `tests/gui/` for API and HTTP tests | WP-002 and WP-004 tests added to `tests/storage/knowledge-store.test.ts`; WP-003 and WP-004 handler tests added to `tests/gui/api-knowledge.test.ts` |
| Plain ES5 in `gui/public/` JS files (no build step) | `theme-init.js` uses the same `(function() { … })();` IIFE pattern as the existing inline script |

---

## Detailed Steps

### WP-001 — Knowledge view UX fixes

1. Open `mcp-server/gui/public/views/knowledge.js`.
2. Add `getDistinctValues(insights)` private helper inside `renderKnowledge()`:
   iterates `insights`, returns `{ categories, projects }` sorted arrays.
3. Replace the two inline collection loops in `render()` with a single
   `getDistinctValues(allInsights)` call.
4. Replace the two inline collection loops in `wireFilterBarEvents()` with a
   single `getDistinctValues(allInsights)` call.
5. In `renderList()`, immediately before the filter-bar DOM rebuild, capture
   whether the search input currently holds focus:
   ```js
   var hadFocus = document.activeElement && document.activeElement.id === 'kn-query';
   ```
   Then, after the `wireFilterBarEvents(filterBarEl)` call, conditionally
   restore focus:
   ```js
   var qEl = document.getElementById('kn-query');
   if (hadFocus && qEl) qEl.focus();
   ```
   The conditional guard is required because `renderList()` is triggered by
   every card action (edit, cancel, delete, move, etc.) — an unconditional
   `.focus()` would steal focus from card-action contexts.

### WP-002 — `KnowledgeStoreManager.moveInsight()`

6. Open `mcp-server/src/storage/knowledge-store.ts`.
7. Add the following public method after `deleteInsight`:
   ```typescript
   async moveInsight(
     id: number,
     sourceFilter: { scope: InsightScope; project_slug?: string },
     targetScope: InsightScope,
     targetProjectSlug?: string
   ): Promise<Insight>
   ```
8. Inside the method body, acquire a single `withLock(this.knowledgeDir(), async () => { … })` span.
9. Within the lock:
   a. Resolve the source store path: call `_storePathsForFilter(sourceFilter)`
      (returns `Promise<string[]>`); take `paths[0]`. The method yields a single
      element when a specific scope+slug pair is provided. Throw if the array is
      empty (the insight cannot exist without a store file).
   b. Read the source store; locate the insight by `id`; throw if not found.
   c. Construct the moved insight: copy all fields, replace `scope`,
      `project_slug`, and `updated_at = now()`.
   d. Validate the moved insight with `InsightSchema.parse(...)`.
   e. Resolve the target store path (`globalStorePath()` or
      `projectStorePath(targetProjectSlug!)`).
   f. Read the target store; assign `id = store.next_id`, increment counter.
   g. Push the new insight, update `last_updated`, validate, atomically write
      the target store.
   h. Remove the original from the source store array, update `last_updated`,
      validate, atomically write the source store.
   i. Return the new insight.
10. Add the `@warning Do NOT call from inside a withLock callback` JSDoc note,
    consistent with the other write methods.
11. Add tests in `mcp-server/tests/storage/knowledge-store.test.ts`:
    - `moveInsight()` happy path (global → project)
    - `moveInsight()` happy path (project → global)
    - `moveInsight()` not-found throws
    - `moveInsight()` result has new id, correct scope, updated `updated_at`
    - `moveInsight()` source store no longer contains original insight
    - `moveInsight()` target store next_id incremented

### WP-003 — Handler wiring + `gui/api-knowledge.ts` extraction

12. Open `mcp-server/gui/api.ts`.
13. Update `handlePromoteKnowledge`: replace the `addInsight` + `deleteInsight`
    compose with a single `await manager.moveInsight(id, { scope: validatedScope, project_slug }, 'global')`.
    (`validatedScope` is the Zod-validated `InsightScope` value; `scope` is the raw
    `string | undefined` parameter and is not assignable to `InsightScope`.)
14. Update `handleMoveKnowledge`: replace compose with
    `await manager.moveInsight(id, { scope: source_scope, project_slug: source_project_slug }, 'project', project_slug)`.
    The destructured variables from `parseResult.data` are `source_scope`,
    `source_project_slug` (the origin), and `project_slug` (the destination).
    Using `scope` or `project_slug` as the source filter would be a semantic
    error — `scope` does not exist as a local variable and `project_slug` is
    the destination slug, not the source.
15. Create `mcp-server/gui/api-knowledge.ts` as a new file.
    **`validationError` dependency:** The `validationError` private function in
    `api.ts` (a 3-line wrapper around `new ApiError(400, ...)`) is called by
    all four non-list handlers being extracted. It is not exported and must not
    be re-exported from `api.ts` (the extraction is a clean cut). Re-define
    `validationError` locally inside `api-knowledge.ts`, importing `ApiError`
    directly. This keeps the module self-contained.
16. Move from `gui/api.ts` to `gui/api-knowledge.ts`:
    - Exported interface: `KnowledgeListParams`
    - Zod schemas: `KnowledgeUpdateBodySchema`, `KnowledgeMoveBodySchema`
    - Private helper: `parseKnowledgeId(rawId: string): number`
    - Exported handlers: `handleListKnowledge`, `handleUpdateKnowledge`,
      `handleDeleteKnowledge`, `handlePromoteKnowledge`, `handleMoveKnowledge`
    - Required imports (subset of `gui/api.ts` imports relevant to knowledge)
17. In `gui/api.ts`, remove all moved symbols and their imports (if no longer
    used elsewhere in `api.ts`). Additionally, remove the private
    `findInsightById` helper function: its only two call sites
    (`handlePromoteKnowledge`, `handleMoveKnowledge`) are replaced by
    `moveInsight()` in steps 13–14, making it dead code.
18. In `gui/server.ts`, update the import block to import the 5 knowledge
    handlers from `./api-knowledge.js` instead of `./api.js`.
19. Update import paths in both knowledge-handler test files:
    - `mcp-server/tests/gui/api-knowledge.test.ts`: update import of the 5
      knowledge handlers from `../../gui/api.js` to `../../gui/api-knowledge.js`.
    - `mcp-server/tests/gui/knowledge-api.test.ts`: update the same 5 handler
      imports from `../../gui/api.js` to `../../gui/api-knowledge.js`.
      Any import of `ApiError` or other `api.ts`-resident symbols must remain
      pointed at `../../gui/api.js`.
    Run a grep for `from '../../gui/api'` across `tests/gui/` immediately before
    the extraction to confirm no additional test files are affected.
20. Verify all existing tests pass (`npm test` from `mcp-server/`).

### WP-004 — `searchInsights()` tag + pagination forwarding

21. Open `mcp-server/src/storage/knowledge-store.ts`.
22. Extend `searchInsights()` signature to:
    ```typescript
    async searchInsights(
      query: string,
      filters?: {
        scope?: InsightScope;
        project_slug?: string;
        category?: string;
        tags?: string[];
        limit?: number;
        offset?: number;
      }
    ): Promise<Insight[]>
    ```
23. After the existing substring filter, apply tag filter (mirror
    `listInsights` pattern: `tagFilter.every(tag => insight.tags.includes(tag))`).
24. Apply `offset`/`limit` slicing after tag filtering.
25. Open `mcp-server/gui/api-knowledge.ts` (created in WP-003).
26. In `handleListKnowledge`, update the `searchInsights()` call path to
    forward `tags`, `limit`, and `offset` from the parsed query parameters.
27. Remove the `@note` warning about tags/limit/offset being ignored in search
    mode from the handler JSDoc.
28. Add tests in `mcp-server/tests/storage/knowledge-store.test.ts`:
    - `searchInsights()` with `tags` filter narrows results
    - `searchInsights()` with `limit`/`offset` paginates results
    - `searchInsights()` with `tags` + `query` combined
29. Add tests in `mcp-server/tests/gui/api-knowledge.test.ts`:
    - `handleListKnowledge` passes `tags` to `searchInsights` when `query` is present
    - `handleListKnowledge` passes `limit`/`offset` to `searchInsights` when `query` is present

### WP-005 — CSP hardening + PATCH route-matching cleanup

30. Create `mcp-server/gui/public/theme-init.js`:
    ```js
    (function () {
      var saved = localStorage.getItem('mcp-theme');
      if (saved !== 'light') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
    ```
31. In `mcp-server/gui/public/index.html`, replace the inline `<script>` block
    (lines 8–15) with:
    ```html
    <script src="/theme-init.js?v=1"></script>
    ```
32. In `mcp-server/gui/server.ts`, update the CSP header value to:
    ```
    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
    ```
33. In `mcp-server/gui/server.ts`, locate the `PATCH /api/projects/` guard:
    ```typescript
    if (method === 'PATCH' && path.startsWith('/api/projects/')) {
    ```
    Replace with a boolean regex test (`.test()` is idiomatic here because no
    capture group is consumed — the PATCH handler extracts the path via
    `path.slice(...)` independently):
    ```typescript
    if (method === 'PATCH' && /^\/api\/projects\/.+$/.test(path)) {
    ```
    The `rawPath` extraction (`path.slice('/api/projects/'.length)`) remains
    unchanged; only the guard condition is updated.
34. Update the route-map comment block in `matchRoute()` if it references the
    PATCH guard pattern wording.
35. Verify the HTTP integration tests pass. The CSP change is asserted in
    `tests/gui/security-headers.test.ts` (L82) and `tests/gui/server-info.test.ts`
    (L184) — not in `server-knowledge-routes.test.ts` (which contains no CSP
    assertions). Both files use partial `toMatch(/default-src 'self'/)` assertions
    that will continue to pass after the change without modification; no test
    update is required. Add a `script-src 'self'` specific assertion to
    `tests/gui/security-headers.test.ts` to fully lock in AC-10.

### WP-006 — Documentation

36. `mcp-server/docs/agents/project-manifest/api-surface.md`:
    - Add `moveInsight()` method signature to `KnowledgeStoreManager` section.
    - Update `searchInsights()` signature with new optional params.
    - Update `handleListKnowledge` note to remove the ⚠ tag/pagination warning.
    - Add `gui/api-knowledge.ts` file description and handler ownership table.
    - Add `gui/public/theme-init.js` to the static file asset table.
    - Update CSS convention note (already present) to reference the bottom-grouped dark-mode approach as the established convention.
37. `mcp-server/docs/agents/project-manifest/file-tree.md`:
    - Add entries for `gui/api-knowledge.ts` and `gui/public/theme-init.js`.
38. `mcp-server/docs/agents/project-manifest/data-flows.md`:
    - Update Flow O (knowledge endpoint flows) to show the single-lock
      `moveInsight()` path for promote/move instead of the two-lock compose.
    - Update the `handleListKnowledge` data-flow note to reflect tag/pagination
      forwarding in search mode.
39. `mcp-server/docs/agents/project-manifest/constraints.md`:
    - Add constraint: `gui/api-knowledge.ts` is the canonical location for
      knowledge handler functions; do not add new knowledge handlers to `api.ts`.
    - Add constraint: knowledge-route body-parsing handlers in `handleRequest()`
      use regex path matching (not `startsWith`); new body-parsing routes should
      follow the same pattern.
    - Update CSP constraint note to reflect `'unsafe-inline'` removal.
40. `mcp-server/README.md`: Update the Security section (if present) to note
    that the CSP no longer uses `'unsafe-inline'`.
41. `mcp-server/changelog.md`: Add a new version entry summarising all six WPs.
42. Run `node scripts/cli.js ctx-generate` from the workspace root to regenerate
    `.context/mcp-server/` context documents.

---

## Dependencies

- WP-001 is independent; it can run in parallel with WP-002.
- WP-003 depends on WP-002 (calls `moveInsight()`).
- WP-004 depends on WP-003 (targets `api-knowledge.ts`).
- WP-005 is independent of WP-002–004 but should run after WP-003 to avoid
  updating a `server.ts` import that WP-003 will also edit.
- WP-006 depends on all prior WPs.

**Recommended execution order:** WP-001 → WP-002 → WP-003 → WP-004 → WP-005 → WP-006

---

## Required Components

### New Files
- `mcp-server/gui/api-knowledge.ts` — extracted knowledge handler module (WP-003)
- `mcp-server/gui/public/theme-init.js` — extracted theme-initialisation script (WP-005)

### Modified Files
- `mcp-server/gui/public/views/knowledge.js` — focus-loss fix + `getDistinctValues` helper (WP-001)
- `mcp-server/src/storage/knowledge-store.ts` — `moveInsight()` new method + `searchInsights()` extended (WP-002, WP-004)
- `mcp-server/gui/api.ts` — knowledge symbols removed; promote/move handlers updated (WP-003)
- `mcp-server/gui/server.ts` — import updated; PATCH guard regex; CSP header tightened (WP-003, WP-005)
- `mcp-server/gui/public/index.html` — inline script replaced with external tag (WP-005)
- `mcp-server/tests/storage/knowledge-store.test.ts` — `moveInsight` + extended `searchInsights` tests (WP-002, WP-004)
- `mcp-server/tests/gui/api-knowledge.test.ts` — import path updated; new handler tests (WP-003, WP-004)
- `mcp-server/tests/gui/knowledge-api.test.ts` — import path for 5 knowledge handlers updated (WP-003)

### Documentation
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/README.md`
- `mcp-server/changelog.md`
- `.context/mcp-server/` (regenerated)

---

## Assumptions

- The existing `withLock(dir, fn)` implementation in `file-lock.ts` is
  re-entrant-safe within a single async call chain (i.e., calling it twice on
  the same directory from within the same lock callback would deadlock, as
  documented in the `@warning` JSDoc on `writeGlobalStore` / `writeProjectStore`).
  `moveInsight()` must therefore use `atomicWriteJson` directly inside the lock
  callback, not call `writeGlobalStore()` or `writeProjectStore()`.
- The static-file handler in `server.ts` already serves all files placed in
  `gui/public/` without requiring routing changes; confirmed by the existing
  pattern of serving `api-client.js`, `router.js`, etc.
- `gui/public/index.html` contains no `<style>` blocks. However, this does
  not make removing `'unsafe-inline'` from `style-src` safe: six view JS
  files (`config.js`, `knowledge.js`, `project-detail.js`, `project-list.js`,
  `run-log.js`, `work-package.js`) generate HTML via `innerHTML` with
  `style=""` attributes, which modern browsers (Chrome 84+, Firefox 72+)
  enforce under `style-src`. WP-005 therefore removes `'unsafe-inline'` from
  `script-src` only; `style-src` retains it.
- `tests/gui/api-knowledge.test.ts` and `tests/gui/knowledge-api.test.ts` both
  import the 5 knowledge handlers from `../../gui/api.js`; WP-003 step 19
  updates both files to import from `../../gui/api-knowledge.js`.
- The `SAFE_SLUG_REGEX` used inside the PATCH /api/projects/ handler body is
  already imported and available; the guard change in step 33 does not affect
  how `rawPath`/`patchSegs` are derived.

---

## Constraints

- `moveInsight()` must not call `writeGlobalStore()` or `writeProjectStore()` from inside the lock callback (would deadlock). It must call `atomicWriteJson` directly, consistent with the pattern in `addInsight`, `updateInsight`, and `deleteInsight`.
- `gui/public/` JavaScript files use plain ES5 (no `const`, `let`, arrow functions, template literals). `theme-init.js` must follow this convention.
- No new npm dependencies may be introduced.
- The `api-knowledge.ts` extraction must not change any public handler signatures or their exported names — `server.ts` import paths change, but the function identifiers do not.
- CSP changes must not break the existing test assertions in `tests/gui/security-headers.test.ts` and `tests/gui/server-info.test.ts`. Both use partial `toMatch` checks that already pass after the change; a new specific `script-src 'self'` assertion should be added to `security-headers.test.ts` per step 35.

---

## Out of Scope

- A full split of `gui/api.ts` into additional domain modules (projects, health, orchestrator, etc.); only the knowledge section is extracted.
- Nonce-per-request CSP infrastructure; the extract-to-file approach achieves the same `script-src 'unsafe-inline'` removal more simply.
- Replacing inline `style=""` attributes in view JS files with CSS classes to enable `style-src` hardening — a larger-scope effort that WP-005 intentionally defers.
- `KnowledgeStoreManager.searchInsights()` full-text ranking or scoring.
- `gui/api.ts` overall refactor beyond removing the knowledge section.
- CSS module splitting (`knowledge.css`, `orchestrator.css`) — flagged in synthesis as low-priority housekeeping.
- Paginating `handleListKnowledge` responses at the HTTP layer (the new `limit`/`offset` parameters are forwarded from query string but no paging envelope is added to the response shape).

---

## Acceptance Criteria

1. Typing in the Knowledge page search input does not cause the input to lose focus between keystrokes.
2. `getDistinctValues()` is a single private helper inside `renderKnowledge()`; no inline category/project collection loops remain in `render()` or `wireFilterBarEvents()`.
3. `KnowledgeStoreManager.moveInsight()` exists and completes the full promote/move operation under a single `withLock` span — verified by unit tests.
4. `handlePromoteKnowledge` and `handleMoveKnowledge` delegate to `moveInsight()` with no residual add→delete compose logic.
5. All knowledge-specific handler functions and Zod schemas reside in `gui/api-knowledge.ts`; `gui/api.ts` contains no knowledge-handler code.
6. `mcp-server/gui/server.ts` imports knowledge handlers from `./api-knowledge.js`.
7. `searchInsights()` accepts `tags`, `limit`, and `offset` and applies them correctly — verified by unit tests.
8. `handleListKnowledge` forwards `tags`, `limit`, and `offset` to `searchInsights()` when a `query` parameter is present.
9. `mcp-server/gui/public/index.html` contains no inline `<script>` blocks; the theme-init logic is served from `theme-init.js`.
10. The CSP header in `server.ts` reads `script-src 'self'` (no `'unsafe-inline'`) and `style-src 'self' 'unsafe-inline'`.
11. `PATCH /api/projects/` guard in `handleRequest()` uses a regex pre-match.
12. All existing tests pass with zero regressions.

---

## Testing Strategy

Tests are added to existing test files. The Vitest runner and `mkdtemp`-based
integration test fixture pattern established by the original plan are used
throughout. No new test frameworks or JSDOM setup are introduced. The
`views/knowledge.js` changes (WP-001) are verified by manual browser testing;
the logic changes (`getDistinctValues`) are pure refactors with no observable
output difference testable at the unit level. AC-5 (all knowledge code in
`api-knowledge.ts`) and AC-9 (no inline scripts in `index.html`) are verified
by code review and TypeScript compilation, not automated tests — consistent
with how AC-1 and AC-2 are handled.

---

## Test Plan

### WP-002 — Storage: `moveInsight()`
- `tests/storage/knowledge-store.test.ts` › `moveInsight() — global → project move` — asserts source global store no longer contains original; target project store contains new insight with correct scope and project_slug — AC-3
- `tests/storage/knowledge-store.test.ts` › `moveInsight() — project → global move` — asserts project store emptied; global store contains moved insight — AC-3
- `tests/storage/knowledge-store.test.ts` › `moveInsight() — not-found throws` — asserts rejects with "not found" message — AC-3
- `tests/storage/knowledge-store.test.ts` › `moveInsight() — returned insight has correct id and updated_at` — asserts new id from target store next_id, updated_at > created_at — AC-3
- `tests/storage/knowledge-store.test.ts` › `moveInsight() — target store next_id incremented` — asserts target `next_id` is 2 after move — AC-3

### WP-003 — Handlers via `moveInsight()`
- `tests/gui/api-knowledge.test.ts` › `handlePromoteKnowledge — promotes insight via moveInsight` — asserts returned insight has scope 'global'; source project store is empty — AC-4
- `tests/gui/api-knowledge.test.ts` › `handleMoveKnowledge — moves insight to target project via moveInsight` — asserts returned insight has new project_slug — AC-4

### WP-004 — Storage: extended `searchInsights()`
- `tests/storage/knowledge-store.test.ts` › `searchInsights() — tags filter applied when query present` — asserts tag mismatch excluded — AC-7
- `tests/storage/knowledge-store.test.ts` › `searchInsights() — limit and offset applied` — asserts paginated slice returned — AC-7
- `tests/storage/knowledge-store.test.ts` › `searchInsights() — combined query + tags` — asserts both conditions apply — AC-7
- `tests/gui/api-knowledge.test.ts` › `handleListKnowledge — forwards tags to searchInsights` — calls handler with query + tags params; asserts tags-only match excluded — AC-8
- `tests/gui/api-knowledge.test.ts` › `handleListKnowledge — forwards limit/offset to searchInsights` — asserts paginated result length — AC-8

### WP-005 — CSP / route cleanup
- `tests/gui/security-headers.test.ts` — add a specific `script-src 'self'` assertion to lock in the tightened `script-src` policy — AC-10
- `tests/gui/server-info.test.ts` — existing partial CSP assertion continues to pass after the change (no update needed) — AC-10
- `tests/gui/server-knowledge-routes.test.ts` — existing `/api/knowledge/:id` route tests continue to pass without modification — AC-12
- **AC-11** (`PATCH /api/projects/` regex guard): this is a pure style change (`.test()` replaces `.startsWith()`; identical behaviour). Verified by code review only; no HTTP-layer test exercises `PATCH /api/projects/` in the current test suite.

---

## Documentation Updates

- `mcp-server/src/tools/knowledge.ts` — Update the stale inline comment at line ~121 (`searchInsights supports scope/category/project_slug only`) to reflect the new `tags`/`limit`/`offset` parameter support added by WP-004
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `moveInsight()` signature; update `searchInsights()` signature; remove ⚠ note from `handleListKnowledge`; document `gui/api-knowledge.ts`; document `theme-init.js` static asset
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add entries for `gui/api-knowledge.ts` and `gui/public/theme-init.js`
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update Flow O promote/move to single-lock path; update `handleListKnowledge` search note
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add knowledge-handler ownership constraint (`api-knowledge.ts`); add regex body-parsing guard convention; update CSP constraint
- `mcp-server/README.md` — Update security note to reflect CSP hardening
- `mcp-server/changelog.md` — New version entry for all WP-001–005 changes
- `.context/mcp-server/` — Regenerated via `node scripts/cli.js ctx-generate`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`moveInsight()` double-write leaves inconsistent state on partial failure** | The target write (step g) precedes the source delete (step h). A panic between the two leaves a detectable duplicate. This is the same partial-write risk that existed in the two-lock compose pattern; the single-lock approach makes the window smaller. Atomic cross-filesystem transactions are not available in the storage layer. Document as a known limitation in the JSDoc. |
| **`api.ts` imports used by `api-knowledge.ts` are also still needed in `api.ts`** | During extraction (WP-003), each import moved must be checked against the remaining `api.ts` content. Remove from `api.ts` only if no other symbol in `api.ts` uses it. The `KnowledgeStoreManager` import is likely only needed in `api-knowledge.ts` after the move. |
| **CSP change breaks theme-toggle on first paint** | The inline script was the earliest possible dark-mode initialisation (before any external script loads). `theme-init.js` served as an external file preserves the execution order: the `<script>` tag replaces the inline block at the same position in `<head>`, so the browser requests and executes it before rendering `<body>`. No flash-of-light-mode is introduced provided the script tag is in `<head>`. |
| **Test import paths break after WP-003 extraction** | Step 19 explicitly updates `tests/gui/api-knowledge.test.ts`. If other test files import from `gui/api.ts` for knowledge types, they must also be updated. A grep for `from '../../gui/api'` in `tests/gui/` before the extraction confirms the complete list. |
| **`searchInsights()` signature change breaks existing callers** | All new params are optional; the change is backward-compatible. The existing `ledger_search_insights` MCP tool handler (in `src/tools/knowledge.ts`) calls `searchInsights` — verify its call site compiles after the signature change. No behavioural change for existing callers. |
