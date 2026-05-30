# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.3.1
- Architectural Reviews: 1 — Plan Architect Reviewer v1.4.0

## Summary

Implement the deferred **Phase 6 — GUI Knowledge Page** from the Knowledge Accumulation
System plan (see
[`docs/agents/implementation-history/2026-05/2026-05-28-knowledge-accumulation-system/plan.md`](../../implementation-history/2026-05/2026-05-28-knowledge-accumulation-system/plan.md)).
The backend is fully implemented: `KnowledgeStoreManager` (`mcp-server/src/storage/knowledge-store.ts`),
Zod schemas (`mcp-server/src/schema/knowledge.ts`), and 4 MCP tools (`mcp-server/src/tools/knowledge.ts`).
This plan delivers the missing GUI layer: 5 REST endpoints backed by `KnowledgeStoreManager`, route
wiring in `gui/server.ts`, SPA view in `views/knowledge.js`, API client methods, nav link, and CSS.
The existing Insights page (`views/insights.js`, `/api/insights`) remains untouched.

## Architectural Context

**Backend storage (fully implemented):**
- `mcp-server/src/schema/knowledge.ts` — `InsightSchema` and `KnowledgeStoreSchema` (Zod)
- `mcp-server/src/storage/knowledge-store.ts` — `KnowledgeStoreManager` with `listInsights()`,
  `searchInsights()`, `addInsight()`, `updateInsight()`, `deleteInsight()`, `readGlobalStore()`,
  `readProjectStore()` — all atomic under a single `.knowledge/` lock

**Key schema facts (diverge from the original plan):**
- `id: z.number().int()` — stored as numeric integer; display-format `KN-NNNN` is MCP-layer only;
  URLs use the raw integer (e.g. `/api/knowledge/42`)
- `confidence: z.number().min(0).max(1)` — a float 0–1; not the `'low'|'medium'|'high'` enum the
  original plan described; GUI renders as percentage with a bucketed label
- `source: z.string()` — plain string; not the structured object the original plan described
- `superseded_by: z.number().int().optional()` — numeric reference (no string ID)

**GUI SPA architecture:**
- All JavaScript is vanilla (no framework); IIFE module pattern throughout
- `gui/api.ts` — pure async handler functions, imported by `gui/server.ts`
- `gui/server.ts` — two-tier routing:
  - `matchRoute()` — segment-count dispatch for routes that need only path params or query strings
  - `handleRequest()` — special-case blocks for routes requiring body parsing
- `gui/public/api-client.js` — IIFE `API` object, single `request()` helper
- `gui/public/router.js` — hash-based routing; `renderXxx(app)` view functions
- `gui/public/styles.css` — single CSS file; existing utility classes (`.card`, `.btn`, `.badge`,
  `.filter-bar`, `.form-control`) are reusable; no CSS framework

**Relevant existing routes (for ordering reference in `matchRoute()`):**
- `GET /api/insights` — rest.length === 1, rest[0] === 'insights'
- `PATCH /api/projects/...` — special case in `handleRequest()` matching `path.startsWith('/api/projects/')`
- `DELETE /api/projects/:slug` — rest.length === 2, rest[0] === 'projects'

The knowledge routes (`/api/knowledge/...`) have a unique first segment; they do not conflict
with any existing route.

## Approach / Architecture

Five REST endpoints delegate to `KnowledgeStoreManager`:

| Method | Path | Body? | Dispatch tier | Handler |
|--------|------|-------|---------------|---------|
| `GET` | `/api/knowledge` | — | `matchRoute()` | `handleListKnowledge` |
| `PATCH` | `/api/knowledge/:id` | JSON | `handleRequest()` special case | `handleUpdateKnowledge` |
| `DELETE` | `/api/knowledge/:id` | — | `matchRoute()` | `handleDeleteKnowledge` |
| `POST` | `/api/knowledge/:id/promote` | — | `matchRoute()` | `handlePromoteKnowledge` |
| `POST` | `/api/knowledge/:id/move` | JSON | `handleRequest()` special case | `handleMoveKnowledge` |

**Promote and move** are composed at the REST handler level using existing storage primitives:
read insight → `addInsight()` (new scope) → `deleteInsight()` (original). The `addInsight()` call
runs first so the insight is never lost if the delete fails.

**ID validation** for `:id` URL parameters: `parseInt(rawId, 10)` with `isNaN` / `<= 0` guard,
returning `VALIDATION_ERROR` on failure. Knowledge IDs are not slugs, so `SAFE_SLUG_REGEX` does
not apply.

The SPA view (`renderKnowledge(app)`) renders a **tab bar** with two tabs — "Global" and
"Repository" — followed by a per-tab filter bar and a card list. Switching tabs is a
client-side scope filter on the already-loaded `allInsights` array; no additional API call
is made. Each tab has its own filter bar:

- **Global tab:** category dropdown + free-text search
- **Repository tab:** project dropdown + category dropdown + free-text search

Each card shows title, scope badge, category, tags, confidence percentage, source, and
timestamps. An inline edit form expands in-place (no separate modal). Delete shows an inline
confirmation prompt within the card. Promote and Move are action buttons on eligible cards.

No polling is added — the knowledge store is human-curated and changes rarely.

## Rationale

- **Promote-then-delete ordering:** If `deleteInsight()` fails after `addInsight()` succeeds, the
  insight exists in both old and new scope (a detectable duplicate). Reversing the order would
  risk silent data loss if `addInsight()` fails after deletion.
- **No new `KnowledgeStoreManager` methods:** `promote` and `move` are composed from existing
  primitives at the REST handler level, consistent with the original plan's stated design.
- **Inline edit (not separate page):** All other CRUD-like views in the GUI (config, reset modal)
  use inline expansion rather than navigation. Knowledge editing follows the same pattern.
- **Integer IDs in URLs:** The `KN-NNNN` display format is MCP-layer only; storing display strings
  in URLs would require parsing them back. Raw integers are unambiguous and consistent with the
  stored schema type.
- **Confidence as percentage with bucket label:** The float 0–1 storage value is implementation
  detail. The UI shows `80% (High)` — familiar to users and aligns with the Synthesis persona's
  heuristic documented in the knowledge-collection partial.
- **No polling:** Unlike project status (which changes during active agent runs), knowledge insights
  are written by agents after synthesis completes. The page is authoritative on first load; a
  manual refresh is sufficient.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Promote/move in storage layer | Compose at REST handler level | Add `promoteInsight()` / `moveInsight()` to `KnowledgeStoreManager` | REST composition is simpler and the original plan explicitly reserved this for the GUI layer; no other consumer needs promote/move |
| Confidence display | Percentage + bucket label (e.g. "80% (High)") | Enum label only (Low/Medium/High); raw float | Percentage is more informative than a bucket alone; raw float is too technical for the GUI; bucketing matches the Synthesis heuristic already documented |
| Delete confirmation | Inline within card (show confirm button on click) | Separate modal overlay | The existing reset modal is the only modal in the codebase and it manages complex state; a simple inline confirm avoids that complexity for a one-step delete |
| Pagination | Client-side slice via `limit`/`offset` API params | Server-driven pagination with prev/next state | Knowledge stores are expected to stay small (< 1 000 entries); client-side slice on the full list avoids round-trip complexity; `limit`/`offset` are already on `listInsights()` |
| Edit UX | Inline expand (toggle card → form) | Navigate to `/knowledge/:id/edit` | No other view in the SPA navigates to an entity-edit URL; inline expansion matches the reset modal and config patterns already present |
| Scope navigation | Tab bar ("Global" / "Repository") | Scope dropdown in a unified filter bar; separate routes (`#/knowledge/global`, `#/knowledge/project`) | Tab bar gives immediate visual separation of the two knowledge classes; a scope dropdown on a unified list hides the structural distinction; separate routes add hash-router complexity for no benefit — both tabs share the same `allInsights` payload loaded once |

## Pattern Alignment

- **Handler functions in `gui/api.ts`:** New handlers follow the existing function signature pattern
  (`export async function handleXxx(ledgerRoot: string, ...): Promise<T>`) — consistent with
  `handleGetInsights`, `handleDeleteProject`, etc.
- **Dispatch tier selection:** Body-free routes in `matchRoute()`; body-parsing routes as special
  cases in `handleRequest()` — follows the established two-tier pattern documented in
  `gui/server.ts` comments and `file-tree.md`
- **Zod body validation in handlers:** Follows the pattern in `handleRenameProject` and
  `handleResetProject` — parse with a local Zod schema, throw `ApiError('VALIDATION_ERROR', ...)`
  on failure
- **Frontend view:** `renderKnowledge(app)` follows the `renderInsights(app)` / `renderConfig(app)`
  pattern — synchronous HTML build from fetched data, event delegation, no framework
- **CSS:** Reuses existing utility classes (`.card`, `.badge`, `.btn`, `.btn-sm`, `.filter-bar`,
  `.form-control`, `.form-group`, `.page-header`, `.text-muted`); new classes are narrowly scoped
  to knowledge-specific layout needs
- **Cache-busting version params:** Modified static files (`api-client.js`, `router.js`) must have
  their `?v=N` query param incremented in `index.html`; new file `views/knowledge.js` gets `?v=1`
- **No OS-specific paths:** All path operations in new handlers via `path.join()` (Node.js)

## Detailed Steps

### Step 1 — Handler functions in `gui/api.ts`

1. Add imports at the top of `gui/api.ts`:
   ```ts
   import { KnowledgeStoreManager } from '../src/storage/knowledge-store.js';
   import { InsightScope, InsightSchema, PROJECT_SLUG_REGEX } from '../src/schema/knowledge.js';
   import type { Insight } from '../src/schema/knowledge.js';
   ```

2. Add a module-level Zod schema constant for the PATCH body:
   ```ts
   const KnowledgeUpdateBodySchema = z.object({
     scope: z.enum(['global', 'project']),
     project_slug: z.string().optional(),
     title: z.string().optional(),
     content: z.string().optional(),
     category: z.string().optional(),
     tags: z.array(z.string()).optional(),
     confidence: z.number().min(0).max(1).optional(),
     superseded_by: z.number().int().optional().nullable(),
   }).strict();
   ```
   `scope` is required; `project_slug` is required when `scope === 'project'`. The handler
   extracts and strips these discriminator fields before forwarding the remainder to
   `manager.updateInsight()`.

3. Add a private helper `parseKnowledgeId(raw: string): number` that calls
   `parseInt(raw, 10)`, guards against `isNaN` and `<= 0`, and throws
   `ApiError('VALIDATION_ERROR', 'Invalid insight id.')` on failure.

   Add a private helper `findInsightById(manager: KnowledgeStoreManager, id: number, filter?: { scope?: InsightScope; project_slug?: string }): Promise<Insight>` that:
   - Calls `manager.listInsights(filter ?? {})`
   - Finds the insight with `.find(i => i.id === id)` within the filtered result
   - Throws `ApiError('NOT_FOUND', 'Insight not found.')` if not found
   - Returns the insight

   Using `findInsightById` with an explicit `filter` ensures that when two stores both
   contain an insight with the same numeric id, only the store matching the requested scope
   is searched — preventing cross-store collisions (see Assumptions).

4. Implement `handleListKnowledge(ledgerRoot, params)`:
   - Accepts `{ scope?, category?, tags?, project_slug?, query?, limit?, offset? }` from query string
   - `scope` arrives as `string | undefined` from the query string; validate and coerce it to
     `InsightScope | undefined` before use:
     ```ts
     const scopeResult = InsightScope.safeParse(params.scope);
     const scope = scopeResult.success ? scopeResult.data : undefined;
     ```
     An unrecognised scope value is silently treated as "no scope filter" (safe fallback);
     `InsightScope` is already imported in sub-step 1.
   - If `query` is present (non-empty), calls `manager.searchInsights(query, { scope, category, project_slug })`
   - Otherwise calls `manager.listInsights({ scope, category, tags, project_slug, limit, offset })`
   - `tags` is comma-separated in the query string — split on `,` before passing to `listInsights`
   - Returns the insight array

5. Implement `handleUpdateKnowledge(ledgerRoot, rawId, body)`:
   - Parse and validate id via `parseKnowledgeId(rawId)`
   - Parse body with `KnowledgeUpdateBodySchema.safeParse(body)` — throw `VALIDATION_ERROR` on failure
   - Extract and remove `scope` and `project_slug` from the parsed result; the remainder is
     the update payload forwarded to storage
   - Map `superseded_by: null` to `undefined` (allows clearing the field)
   - Call `manager.updateInsight(id, updates, { scope, project_slug })` passing the discriminator
     fields as a filter — catch missing-insight error and rethrow as `ApiError('NOT_FOUND', ...)`
   - Return the updated insight

6. Implement `handleDeleteKnowledge(ledgerRoot, rawId, scope, project_slug?)`:
   - Parse id
   - `scope` is a required query parameter; `project_slug` is required when `scope === 'project'`
   - Call `manager.deleteInsight(id, { scope, project_slug })` passing the discriminator fields
     as a filter — catch missing-insight error and rethrow as `ApiError('NOT_FOUND', ...)`
   - Return `null` (204 No Content — consistent with existing delete handlers)

7. Implement `handlePromoteKnowledge(ledgerRoot, rawId, scope, project_slug?)`:
   - Parse id
   - `scope` is a required query parameter; `project_slug` is required when `scope === 'project'`
   - Call `findInsightById(manager, id, { scope, project_slug })` to locate the target in the
     correct store — throws `NOT_FOUND` if not present
   - If `insight.scope === 'global'` → `VALIDATION_ERROR: 'Insight is already global.'`
   - Call `manager.addInsight({ ...insight, scope: 'global', project_slug: undefined, updated_at: undefined })`
     (add-first ordering to protect against data loss)
   - Call `manager.deleteInsight(id, { scope, project_slug })` for the original
   - Return the new insight

   **Note:** `addInsight()` assigns a new ID from the global store's `next_id` counter; the
   returned insight has a **different ID** than the original. The view must replace the old
   entry in `allInsights` by matching the pre-promote ID, not update in place by the new ID.
   Any `superseded_by` references pointing to the old ID become dangling (see Risks & Mitigations).

8. Implement `handleMoveKnowledge(ledgerRoot, rawId, body)`:
   - Parse id
   - Parse body: `z.object({ source_scope: z.enum(['global', 'project']), source_project_slug: z.string().optional(), project_slug: z.string().regex(PROJECT_SLUG_REGEX) })`;
     throw `VALIDATION_ERROR` on failure (also rejects path-traversal slugs at the schema boundary);
     `source_project_slug` is required when `source_scope === 'project'`
   - Call `findInsightById(manager, id, { scope: source_scope, project_slug: source_project_slug })`
     to locate the source insight in the correct store — throws `NOT_FOUND` if not present
   - If `insight.scope === 'project' && insight.project_slug === project_slug` →
     `VALIDATION_ERROR: 'Insight is already in this project.'`
   - `addInsight(...)` with `scope: 'project'` and new `project_slug`, then
     `deleteInsight(id, { scope: source_scope, project_slug: source_project_slug })`
   - Return the new insight

   **Note:** `addInsight()` assigns a new ID from the target store's `next_id` counter; the
   returned insight has a **different ID** than the original. The view must replace the old
   entry in `allInsights` by matching the pre-move ID, not update in place by the new ID.
   Any `superseded_by` references pointing to the old ID become dangling (see Risks & Mitigations).

### Step 2 — Route wiring in `gui/server.ts`

9. Add imports for the 5 new handlers in the import block at the top of `server.ts`:
   ```ts
   import {
     handleListKnowledge,
     handleUpdateKnowledge,
     handleDeleteKnowledge,
     handlePromoteKnowledge,
     handleMoveKnowledge,
   } from './api.js';
   ```

10. In `matchRoute()`, add before `return null` (after all project routes):

    ```ts
    // GET /api/knowledge
    if (method === 'GET' && rest.length === 1 && rest[0] === 'knowledge') {
      const qIdx = url.indexOf('?');
      const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
      const sp = new URLSearchParams(qStr);
      const params = {
        scope: sp.get('scope') ?? undefined,
        category: sp.get('category') ?? undefined,
        tags: sp.get('tags') ?? undefined,        // comma-separated string
        project_slug: sp.get('project_slug') ?? undefined,
        query: sp.get('query') ?? undefined,
        limit: sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
        offset: sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
      };
      return () => handleListKnowledge(ledgerRoot, params);
    }

    // DELETE /api/knowledge/:id
    if (method === 'DELETE' && rest.length === 2 && rest[0] === 'knowledge') {
      const rawId = rest[1]!;
      const dQIdx = url.indexOf('?');
      const dSp = new URLSearchParams(dQIdx !== -1 ? url.slice(dQIdx + 1) : '');
      const scope = dSp.get('scope') ?? undefined;
      const project_slug = dSp.get('project_slug') ?? undefined;
      return () => handleDeleteKnowledge(ledgerRoot, rawId, scope, project_slug).then(() => null);
    }

    // POST /api/knowledge/:id/promote
    if (method === 'POST' && rest.length === 3 && rest[0] === 'knowledge' && rest[2] === 'promote') {
      const rawId = rest[1]!;
      const pQIdx = url.indexOf('?');
      const pSp = new URLSearchParams(pQIdx !== -1 ? url.slice(pQIdx + 1) : '');
      const scope = pSp.get('scope') ?? undefined;
      const project_slug = pSp.get('project_slug') ?? undefined;
      return () => handlePromoteKnowledge(ledgerRoot, rawId, scope, project_slug);
    }
    ```

    **Note on DELETE response:** `handleDeleteKnowledge` returns `null`; `sendJson(res, 200, null, port)`
    sends `null` as JSON. For consistency with existing delete handlers (which return 200 not 204 via
    `matchRoute()`), this is the correct approach. A 204 would require a special case in `handleRequest()`.

11. In `handleRequest()`, add two special-case blocks **before** the final `matchRoute()` call:

    **`PATCH /api/knowledge/:id`** (after the PATCH /api/projects block):
    ```ts
    if (method === 'PATCH' && path.startsWith('/api/knowledge/')) {
      const rawId = decodeURIComponent(path.slice('/api/knowledge/'.length));
      try {
        const body = await readJsonBody(req);
        // body includes `scope` and `project_slug` discriminator fields alongside the update
        // payload; handleUpdateKnowledge validates the full body via KnowledgeUpdateBodySchema
        // and extracts the discriminators before forwarding the update payload to storage.
        const result = await handleUpdateKnowledge(ledgerRoot, rawId, body);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in PATCH /api/knowledge/:id: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
    ```

    **`POST /api/knowledge/:id/move`** (as part of the existing `if (method === 'POST')` block or as
    a separate guard — follow the same style as the orchestrator start special case):
    ```ts
    if (method === 'POST' && path.match(/^\/api\/knowledge\/[^/]+\/move$/)) {
      const rawId = decodeURIComponent(path.split('/')[3]!);
      try {
        const body = await readJsonBody(req);
        const result = await handleMoveKnowledge(ledgerRoot, rawId, body);
        sendJson(res, 200, result, port);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload Too Large.', port);
        } else if (err instanceof ApiError) {
          sendError(res, apiErrorToStatus(err.code), err.code, err.message, port);
        } else {
          process.stderr.write(`[server] Unhandled error in POST /api/knowledge/:id/move: ${String(err)}\n`);
          sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.', port);
        }
      }
      return;
    }
    ```

### Step 3 — API client (`gui/public/api-client.js`)

12. Add 5 methods to the `API` return object. The `scope` and `project_slug` parameters are
    always available from the `allInsights` array in the view, which carries these fields on
    every insight object:
    ```js
    getKnowledge: function (params) {
      return request('GET', '/knowledge' + buildQueryString(params));
    },
    updateKnowledge: function (id, scope, projectSlug, data) {
      return request('PATCH', '/knowledge/' + encodeURIComponent(id),
        Object.assign({ scope: scope, project_slug: projectSlug || undefined }, data));
    },
    deleteKnowledge: function (id, scope, projectSlug) {
      var qs = '?scope=' + encodeURIComponent(scope);
      if (projectSlug) qs += '&project_slug=' + encodeURIComponent(projectSlug);
      return request('DELETE', '/knowledge/' + encodeURIComponent(id) + qs);
    },
    promoteKnowledge: function (id, scope, projectSlug) {
      var qs = '?scope=' + encodeURIComponent(scope);
      if (projectSlug) qs += '&project_slug=' + encodeURIComponent(projectSlug);
      return request('POST', '/knowledge/' + encodeURIComponent(id) + '/promote' + qs);
    },
    moveKnowledge: function (id, sourceScope, sourceProjectSlug, targetProjectSlug) {
      return request('POST', '/knowledge/' + encodeURIComponent(id) + '/move', {
        source_scope: sourceScope,
        source_project_slug: sourceProjectSlug || undefined,
        project_slug: targetProjectSlug,
      });
    },
    ```

### Step 4 — Router (`gui/public/router.js`)

13. Add the `/knowledge` route before the orchestrator dispatch (and after the insights dispatch),
    within the `dispatch()` function:
    ```js
    if (path === '/knowledge') {
      renderKnowledge(app);
      return;
    }
    ```

### Step 5 — HTML shell (`gui/public/index.html`)

14. Add the Knowledge nav link between Insights and Orchestrator:
    ```html
    <a href="#/knowledge">Knowledge</a>
    ```

15. Add the script tag after `views/insights.js`:
    ```html
    <script src="/views/knowledge.js?v=1"></script>
    ```

16. Bump version params on **modified** files to bust the browser cache:
    - `api-client.js?v=2` → `?v=3`
    - `router.js?v=2` → `?v=3`

### Step 6 — View (`gui/public/views/knowledge.js`)

17. Implement `renderKnowledge(app)` following the `renderInsights(app)` structure.

    **State variables:**
    - `allInsights` — raw array from the last API response
    - `activeTab` — `'global' | 'project'` (defaults to `'global'`)
    - `filterCategory` — `'ALL' | string` (independent per tab; reset when switching tabs)
    - `filterProject` — `'ALL' | string` (Repository tab only)
    - `filterQuery` — free-text string (independent per tab; reset when switching tabs)
    - `editingId` — numeric id of the insight currently in edit mode, or `null`
    - `confirmDeleteId` — numeric id awaiting delete confirmation, or `null`

    **Tab bar HTML** (rendered above the filter bar):
    ```html
    <div class="knowledge-tabs">
      <button class="knowledge-tab active" data-tab="global">Global</button>
      <button class="knowledge-tab" data-tab="project">Repository</button>
    </div>
    ```
    Clicking a tab updates `activeTab`, resets `filterCategory`, `filterProject`, and
    `filterQuery` to `'ALL'` / `''`, clears `editingId` and `confirmDeleteId`, and re-renders
    the full view.

    **Per-tab filter bars:**

    - **Global tab:** category dropdown (populated from distinct categories in global insights)
      + free-text `<input>` for title/content/tag search.
    - **Repository tab:** project dropdown (populated from distinct `project_slug` values in
      project-scoped insights) + category dropdown + free-text `<input>`.

    Both filter bars follow the `.filter-bar` layout used on the Insights page.

    **Helper: `formatConfidence(value)`** — multiply by 100, round to 0 decimal places, append `%`;
    append bucket label: 0–33 → `(Low)`, 34–67 → `(Medium)`, 68–100 → `(High)`.

    **Helper: `buildKnowledgeHtml(insights)`** — renders the full card list. For each insight:
    - Scope badge: `<span class="badge badge-scope-global">global</span>` or
      `<span class="badge badge-scope-project">project</span>`
    - Category pill: `<span class="category-pill">{category}</span>`
    - Tags: `<span class="tag-chip">{tag}</span>` for each tag
    - Content preview: first 200 characters + ellipsis (full content shown in edit form)
    - Confidence: `<span class="confidence-label">{formatConfidence(confidence)}</span>`
    - Source and timestamps in a muted row
    - Actions row: Edit button (always), Delete button (shows inline confirm if `confirmDeleteId === id`),
      Promote to Global (only when `scope === 'project'`), Move to Project (always)
    - If `editingId === id`, render an inline edit form replacing the card body

    **Inline edit form** fields: title (`input.form-control`), content (`textarea.form-control`, 6 rows),
    category (`input.form-control`), tags (`input.form-control`, comma-separated display),
    confidence (`input[type=range]` min=0 max=1 step=0.01 with live `formatConfidence` display).
    Save and Cancel buttons.

    **Move to Project** interaction: clicking "Move" shows a small inline `<input>` for the target
    project slug within the card actions row, with a Confirm button. No separate modal.

    **Filter logic (`applyFilters()`):** client-side filter on `allInsights` scoped to the active
    tab's `scope` value, then additionally by category, project (Repository tab), and free-text
    query (substring match on title, content, tags). Re-renders the card list via
    `document.getElementById('knowledge-list').innerHTML = buildKnowledgeHtml(filtered)`.

    **load() function:**
    ```js
    function load() {
      API.getKnowledge({}).then(function (data) {
        render(data || []);
      }).catch(function (err) {
        showError(app, 'Failed to load knowledge: ' + (err.message || String(err)));
      });
    }
    ```
    No `Router._setPolling()` call — knowledge is not auto-refreshed.

    **Event handlers** (wired via `document.getElementById` or event delegation within the
    `#knowledge-list` container):
    - Tab buttons → update `activeTab`, reset per-tab filters, re-render full view
    - Filter selects and search input → call `applyFilters()` and re-render list
    - Edit button → set `editingId`, re-render list
    - Save button → call `API.updateKnowledge(id, insight.scope, insight.project_slug, formValues)`
      (where `insight` is retrieved from `allInsights` by matching `id`); on success update
      `allInsights`, clear `editingId`, re-render
    - Cancel → clear `editingId`, re-render
    - Delete button (first click) → set `confirmDeleteId`, re-render (shows Confirm/Cancel in-place)
    - Delete confirm → call `API.deleteKnowledge(id, insight.scope, insight.project_slug)`, remove
      from `allInsights`, re-render
    - Delete cancel → clear `confirmDeleteId`, re-render
    - Promote button → call `API.promoteKnowledge(id, insight.scope, insight.project_slug)`, replace
      insight in `allInsights` (match by pre-promote id), re-render
    - Move confirm → call `API.moveKnowledge(id, insight.scope, insight.project_slug, targetSlug)`,
      replace insight in `allInsights` (match by pre-move id), re-render

### Step 7 — CSS (`gui/public/styles.css`)

18. Add a `/* Knowledge Page */` section near the bottom of `styles.css` (after the Insights section)
    with only the classes not covered by existing utilities:

    ```css
    /* Tab navigation */
    .knowledge-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 2px solid var(--color-border);
      margin-bottom: 20px;
    }

    .knowledge-tab {
      padding: 8px 20px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-muted);
      border-radius: var(--radius) var(--radius) 0 0;
      transition: color 0.15s, border-color 0.15s;
    }

    .knowledge-tab:hover  { color: var(--color-text); }
    .knowledge-tab.active { color: var(--color-ready); border-bottom-color: var(--color-ready); }

    /* Scope badges — extends .badge */
    .badge-scope-global  { background: #dbeafe; color: #1d4ed8; }
    .badge-scope-project { background: #dcfce7; color: #166534; }

    /* Category pill */
    .category-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      background: #f3f4f6;
      color: var(--color-text-muted);
      font-size: 11px;
      font-weight: 500;
    }

    /* Tag chips */
    .tag-chip {
      display: inline-block;
      padding: 2px 7px;
      border-radius: var(--radius-pill);
      background: #ede9fe;
      color: #5b21b6;
      font-size: 11px;
      margin-right: 4px;
    }

    /* Confidence label */
    .confidence-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    /* Knowledge card actions */
    .knowledge-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    /* Inline move input */
    .knowledge-move-input {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }

    .knowledge-move-input input {
      padding: 4px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 12px;
      width: 180px;
      background: var(--color-surface);
      color: var(--color-text);
    }

    /* Dark-mode overrides */
    [data-theme="dark"] .badge-scope-global  { background: #1e3a5f; color: #93c5fd; }
    [data-theme="dark"] .badge-scope-project { background: #14532d; color: #86efac; }
    [data-theme="dark"] .category-pill       { background: #374151; color: #9ca3af; }
    [data-theme="dark"] .tag-chip            { background: #2e1065; color: #c4b5fd; }
    [data-theme="dark"] .knowledge-move-input input {
      background: var(--color-surface);
      color: var(--color-text);
    }
    ```

### Step 8 — Tests (`tests/gui/knowledge-api.test.ts`)

19. Create a new test file at `mcp-server/tests/gui/knowledge-api.test.ts` following the pattern
    of `tests/gui/api.test.ts`:
    - `beforeEach` creates a temp ledger directory via `mkdtemp(join(tmpdir(), 'knowledge-test-'))`
    - `afterEach` removes it with `rm(tempDir, { recursive: true })`
    - Fixtures built with `KnowledgeStoreManager` (write insights directly into the test store)
    - Handlers called with the temp `ledgerRoot`

    See Test Plan section for the complete enumeration of test cases.

### Step 9 — Documentation

20. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — add the 5 new REST endpoints
    with their signatures, parameters, and return shapes
21. Update `mcp-server/docs/agents/project-manifest/file-tree.md` — add `views/knowledge.js` to the
    GUI static assets section; update the one-line descriptions for `api.ts` and `server.ts`
22. Update `mcp-server/changelog.md` — new entry for the GUI knowledge page

## Dependencies

- Phase 1–2 of the Knowledge Accumulation System plan (already complete): `KnowledgeStoreManager`,
  `InsightSchema`, `KnowledgeStoreSchema`
- Existing GUI infrastructure: `ApiError`, `readJsonBody`, `sendJson`, `sendError`, `matchRoute`,
  `handleRequest`, `buildQueryString` in `api-client.js`

## Required Components

### New Files
- `mcp-server/gui/public/views/knowledge.js` — SPA view (`renderKnowledge`)
- `mcp-server/tests/gui/knowledge-api.test.ts` — handler unit tests

### Modified Files
- `mcp-server/gui/api.ts` — 5 new handler functions + 2 imports + 1 Zod schema constant
- `mcp-server/gui/server.ts` — `matchRoute()` additions + `handleRequest()` special cases + imports
- `mcp-server/gui/public/api-client.js` — 5 new API methods; bump version in `index.html`
- `mcp-server/gui/public/router.js` — 1 new route dispatch; bump version in `index.html`
- `mcp-server/gui/public/index.html` — nav link, script tag, version bumps on modified files
- `mcp-server/gui/public/styles.css` — new Knowledge section (~40 lines)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — 5 new REST endpoint entries
- `mcp-server/docs/agents/project-manifest/file-tree.md` — updated GUI section
- `mcp-server/docs/agents/project-manifest/data-flows.md` — new data flow entries for all 5 knowledge endpoints
- `mcp-server/changelog.md` — new changelog entry

## Assumptions

- The `KnowledgeStoreManager.listInsights({})` call (no filters) is efficient enough for the
  promote/move "find by id" pattern — knowledge stores are expected to stay well under 10 K entries
- `KnowledgeStoreManager.updateInsight()`, `deleteInsight()`, and `listInsights()` each accept an
  optional filter argument (e.g. `{ scope, project_slug }`) that restricts the operation to a
  specific store; if the insight is not found within that store, the method reports "not found" as
  normal — this is the mechanism that prevents cross-store numeric ID collisions
- Browser caching of static assets is based on `?v=N` query string invalidation, consistent with
  the current SPA setup
- Concurrent promote/move for the same insight ID is an edge case not worth adding a distributed
  lock for — the add-first ordering prevents data loss in the degenerate case
- The `PROJECT_SLUG_REGEX` imported from `mcp-server/src/schema/knowledge.ts` is the correct
  validation source for `project_slug` in `handleMoveKnowledge`

## Constraints

- No new npm dependencies (zero-dependency GUI constraint)
- No new `KnowledgeStoreManager` methods — use existing primitives
- All path operations via `path.join()` / `path.resolve()` (cross-platform policy)
- STDIO discipline in `gui/api.ts` handlers — no `process.stdout.write()`; use `process.stderr.write()`
  only for unexpected errors, consistent with existing handlers
- The existing Insights page and `/api/insights` endpoint must not be touched
- CSS changes must include dark-mode overrides for any new colour-dependent classes

## Out of Scope

- Pagination UI controls — the API supports `limit`/`offset` but the initial view loads all insights
  client-side (consistent with the existing Insights page); a pagination UI can be added later
- Global knowledge stats / aggregations (counts by category, project)
- Insight export (CSV, JSON download)
- Insight creation from the GUI — insights are created by agents via MCP tools; the GUI is
  read-and-curate only
- Bulk operations (select multiple, bulk delete)
- Search ranking or relevance scoring — substring match is sufficient for current store sizes

## Acceptance Criteria

1. `GET /api/knowledge` returns all insights when called with no filters; returns correct subsets
   when `scope`, `category`, `tags`, `project_slug`, `query` filters are applied
2. `PATCH /api/knowledge/:id` updates the specified insight in the correct store (identified
   by the required `scope` and `project_slug` discriminator fields in the body) and returns
   the updated record; returns 404 for unknown IDs or wrong scope; returns 400 for invalid body
3. `DELETE /api/knowledge/:id` removes the insight from the correct store (identified by the
   required `scope` and optional `project_slug` query parameters) and returns 200 with null;
   returns 404 for unknown IDs or wrong scope
4. `POST /api/knowledge/:id/promote` converts a project-scoped insight to global scope using
   `scope` and `project_slug` query params to identify the source store unambiguously; returns
   400 if already global; returns 404 for unknown IDs or wrong scope
5. `POST /api/knowledge/:id/move` moves an insight to the specified project using `source_scope`
   and `source_project_slug` body fields to identify the source store unambiguously; returns 400
   for invalid or identical destination slug; returns 404 for unknown IDs or wrong source scope
6. The Knowledge nav link appears between Insights and Orchestrator in the GUI header
7. The Knowledge page renders a tab bar ("Global" / "Repository"); switching tabs immediately
   filters the card list to the corresponding scope without a round-trip
8. Each tab renders its own filter bar: Global tab has category + text search; Repository tab
   has project + category + text search; filtering works client-side without a round-trip
9. Inline editing saves changes and updates the card in-place without a page reload
10. Delete shows an inline confirmation step before removing the card
11. Promote to Global moves a project-scoped card to global scope and re-renders in-place
12. Move to Project accepts a target slug input and re-renders the card with the new scope
13. Invalid IDs (non-integer, negative, zero) are rejected with a 400 `VALIDATION_ERROR` response
14. The existing Insights page (`/api/insights`, `#/insights`) remains fully functional

## Testing Strategy

Unit tests exercise all 5 REST handler functions directly (no HTTP server) using real temp
directories and `KnowledgeStoreManager` to seed fixtures — identical to the pattern in
`tests/gui/api.test.ts`. The GUI view (`views/knowledge.js`) is manually verified (consistent with
all other SPA views in the codebase, which have no automated DOM tests).

## Test Plan

- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — no filters returns all insights` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — scope:global returns only global` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — scope:project + project_slug filters to one project` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — category filter` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — tags filter (comma-separated string parsed correctly)` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — query triggers searchInsights, returns text matches` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleListKnowledge — empty store returns empty array` — AC #1
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — updates title and returns updated insight` — AC #2
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — clears superseded_by when null is passed` — AC #2
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — throws NOT_FOUND for unknown id` — AC #2
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — throws VALIDATION_ERROR for non-integer id` — AC #2, #13
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — throws VALIDATION_ERROR for extra body fields` — AC #2
- `tests/gui/knowledge-api.test.ts` → `handleDeleteKnowledge — removes insight from store` — AC #3
- `tests/gui/knowledge-api.test.ts` → `handleDeleteKnowledge — throws NOT_FOUND for unknown id` — AC #3
- `tests/gui/knowledge-api.test.ts` → `handleDeleteKnowledge — throws VALIDATION_ERROR for id=0` — AC #3, #13
- `tests/gui/knowledge-api.test.ts` → `handlePromoteKnowledge — project insight appears in global store` — AC #4
- `tests/gui/knowledge-api.test.ts` → `handlePromoteKnowledge — original project insight is removed` — AC #4
- `tests/gui/knowledge-api.test.ts` → `handlePromoteKnowledge — throws VALIDATION_ERROR if already global` — AC #4
- `tests/gui/knowledge-api.test.ts` → `handlePromoteKnowledge — throws NOT_FOUND for unknown id` — AC #4
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — global insight moves to named project` — AC #5
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — project insight moves to different project` — AC #5
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — throws VALIDATION_ERROR for same destination` — AC #5
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — throws VALIDATION_ERROR for invalid slug (path-traversal attempt)` — AC #5, #13
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — throws NOT_FOUND for unknown id` — AC #5
- `tests/gui/knowledge-api.test.ts` → `parseKnowledgeId — throws VALIDATION_ERROR for negative id` — AC #13
- `tests/gui/knowledge-api.test.ts` → `parseKnowledgeId — throws VALIDATION_ERROR for floating-point string` — AC #13
- `tests/gui/knowledge-api.test.ts` → `handleUpdateKnowledge — updates insight in global store, not same-id insight in project store (scope disambiguation)` — AC #2
- `tests/gui/knowledge-api.test.ts` → `handleDeleteKnowledge — deletes insight in project store, not same-id insight in global store (scope disambiguation)` — AC #3
- `tests/gui/knowledge-api.test.ts` → `handlePromoteKnowledge — promotes correct insight when two stores share the same numeric id` — AC #4
- `tests/gui/knowledge-api.test.ts` → `handleMoveKnowledge — moves correct insight when two stores share the same numeric id` — AC #5

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add REST endpoint table rows for all 5
  new knowledge endpoints: path, method, query/body params, return shape, errors
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add `views/knowledge.js` entry to the
  GUI static assets block; update one-line annotation for `gui/api.ts` (knowledge handlers) and
  `gui/server.ts` (knowledge routes); add `tests/gui/knowledge-api.test.ts` to the tests section
- `mcp-server/docs/agents/project-manifest/data-flows.md` — add entries for the five new
  `GET/PATCH/DELETE/POST /api/knowledge` flows (client request → handler → `KnowledgeStoreManager`
  → store file)
- `mcp-server/changelog.md` — new version entry covering the Knowledge GUI page

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Promote/move atomicity:** add-first ordering prevents data loss but may produce a duplicate if the delete call fails | Duplicate cleanup is detectable (two insights with identical title/content/source); `handleDeleteKnowledge` can be called manually; a full atomic swap would require a new `KnowledgeStoreManager` method and is not warranted for a human-initiated low-frequency operation |
| **Promote/move invalidates `superseded_by` references:** `addInsight()` assigns a new ID in the target store; any insight with `superseded_by` pointing to the moved insight's old ID becomes a dangling reference | Document as a known limitation. The GUI displays a warning badge on the Promote/Move action button when a card has `superseded_by` set, so the user is aware. The user must update any `superseded_by` references manually via PATCH after a promote/move. |
| **Version param drift:** forgetting to bump `?v=N` on modified files causes browsers to serve stale JS | Plan explicitly enumerates which files need bumping (Step 16); the Engineer must verify any additional modified files |
| **Confidence range rendering edge cases:** `confidence = 0.335` lands in "Medium" bucket only if the threshold is `>= 0.34` | Define bucket thresholds as named constants in `views/knowledge.js` so they can be adjusted without a search-and-replace |
| **Large knowledge stores:** loading all insights into memory for client-side filtering may be slow if the store grows unexpectedly large | The `GET /api/knowledge` endpoint supports `limit`/`offset`; pagination UI can be added as a follow-up without API changes |
| **`SAFE_SLUG_REGEX` vs `PROJECT_SLUG_REGEX`:** the server uses `SAFE_SLUG_REGEX` for project slugs (`/^[a-z0-9][a-z0-9-]*$/`) but `KnowledgeStoreManager` uses `PROJECT_SLUG_REGEX` (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`) which is more permissive | Validate the `project_slug` in `handleMoveKnowledge` using `PROJECT_SLUG_REGEX` (from `src/schema/knowledge.ts`) — the same regex the storage layer uses, ensuring no slug accepted by the handler is rejected by the store |
