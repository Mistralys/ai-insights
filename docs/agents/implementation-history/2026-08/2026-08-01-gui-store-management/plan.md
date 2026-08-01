
# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0
- GUI Reviews: 3 - Web GUI Specialist v1.0.1

## Prior Project Context

The multi-store ledger feature was delivered in two project cycles: `2026-07-24-cross-device-ledger-sync` (15 WPs, 3838 tests) and its rework `2026-07-24-cross-device-ledger-sync-rework-1` (12 WPs). Both cycles established the full backend (TypeScript storage modules, Zod schemas, CLI commands) and read-only GUI awareness (store-aware repo listing, conflicts tab). The GUI CRUD gap was a known gap carried forward from both cycles. The repository's short-term strategic vision — "make the whole project as easy as possible to set up and use by developers with as little friction as possible" — directly motivates closing this gap.

## Summary

Add a full CRUD "Stores" tab to the Configuration screen in the MCP Server GUI, enabling users to view, add, import from disk, edit, remove, reorder, and set the default store without CLI commands. Each store displays its type (Git repository vs. loose folder), Git sync status, project/repository counts, sync metadata, and default-store designation. The backend is extended with new write endpoints and a hot-reload mechanism that reinitializes the in-memory store context after configuration changes, so the running server reflects store mutations immediately without restart.

## Architectural Context

The GUI is a zero-build-step SPA (`mcp-server/gui/public/`) using ES5-compatible JavaScript with a global namespace pattern. The Configuration screen (`config.js`) coordinates three tab modules (`config-model-registry.js`, `config-persona-models.js`, and the General tab inline) via a shared `configDirty` object for unsaved-changes tracking. Tab modules are loaded before `config.js` and expose render/wire functions as bare globals.

The backend route table is declared in `server.ts` via domain sub-builder functions (`buildStoreRoutes`, `buildRepoRoutes`, etc.) spread into a single `Route[]`. Store configuration lives in `~/.ai-insights/stores.json`, validated by `StoresConfigSchema` (Zod). The `store-registry.ts` module provides `loadStoresConfig()` and `saveStoresConfig()` (atomic write under file lock). The runtime store context (`StoreRouter` + `MultiStoreManager`) is set once at startup via `setStoreContext()` and must be re-created when `stores.json` changes.

Existing read-only store endpoints (`GET /api/stores`, `GET /api/stores/conflicts`) are handled in `api.ts` within `buildStoreRoutes()`. The domain-split handler pattern (one `api-{domain}.ts` file per API domain) is established by `api-repos.ts` and `api-knowledge.ts`.

## Approach / Architecture

1. **New backend handler file** `api-stores.ts` following the domain-split pattern. Contains handlers for enriched GET (with Git status), POST (add store), POST (import existing store from disk), PUT (update label), DELETE (remove store), PUT (reorder stores), and POST (set default). Each write handler calls `saveStoresConfig()` then triggers a `reloadStoreContext()` helper that re-creates and re-sets the `StoreRouter` and `MultiStoreManager`.

2. **Enriched store list response** — extend `StoreListItem` with `is_git`, `ahead`, `behind`, `default`, and `sync` fields so the frontend can render store type badges and sync status without additional requests.

3. **New frontend tab module** `config-stores.js` following the established config tab companion pattern. Renders a store list table with detail rows, a shared store modal (for add, import, and edit), default-store toggle, store reorder view, and remove with confirmation. Shares dirty tracking via `configDirty.stores`.

4. **Hot-reload mechanism** — a new `reloadStoreContext()` function in `store-context.ts` that re-reads `stores.json`, constructs fresh `StoreRouter` and `MultiStoreManager` instances, and updates the module-level singletons. Called by every write handler in `api-stores.ts` after a successful `saveStoresConfig()`.

## Rationale

- **Domain-split handler file** rather than adding to `api.ts`: Follows the established pattern (`api-repos.ts`, `api-knowledge.ts`, `api-models.ts`). Keeps handler files focused and manageable.
- **Enriched GET response** rather than separate detail endpoint: Avoids N+1 requests. Git status detection is fast (~5ms per store via `git rev-parse`) and the store count is typically 1–3.
- **Hot-reload via `reloadStoreContext()`** rather than server restart: The GUI must reflect changes immediately. `setStoreContext()` already supports idempotent re-initialization ("subsequent calls overwrite the stored references" per its JSDoc). The reload approach is the minimal mechanism that achieves live updates.
- **`store init` excluded from GUI**: This is a one-time bootstrap operation that creates `stores.json` from scratch. The GUI server already starts in single-store mode when no `stores.json` exists, and the first "Add Store" action in the GUI can create the file. Exposing `store init` would duplicate this with confusing UX ("init then add" vs. "just add").

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Store type detection | Server-side Git detection via `child_process.execFile` in enriched GET | Client-side detection via separate endpoint; store-type field in stores.json | Server-side avoids extra round-trips and keeps the frontend simple. A stored field in stores.json would go stale if a user initializes Git after adding the store. |
| Hot-reload mechanism | `reloadStoreContext()` in store-context.ts | Restart server after config change; file-watcher on stores.json | Restart is disruptive (kills active polling/connections). File-watcher adds complexity and race conditions with the atomic write. Direct reload after write is deterministic. |
| Store init in GUI | Excluded — first "Add Store" creates stores.json implicitly | Dedicated "Initialize" button on empty state | The "Add Store" flow already handles the first-store case by creating `stores.json` with the new store as default. A separate init step adds no value. |
| Store reordering | Dedicated reorder sub-view with move-up/move-down buttons | Drag-and-drop reorder in the table; inline reorder in the main table | A dedicated sub-view avoids the complexity of reorderable table rows in the main list. Move-up/move-down buttons are simple, accessible, and unambiguous. Drag-and-drop can be added as a progressive enhancement later. |
| Store add/edit interaction | Shared modal form for add, import, and edit | Inline table editing for label; separate card forms for add and import | A modal gives room for future store properties beyond label (description, sync config, tags). Sharing one form between add/import/edit avoids duplicating validation and rendering. Inline editing is too constrained for multi-field editing. Follows existing GUI modal patterns (`reset-modal`, `dialogue-modal`). |

## Pattern Alignment

- **Domain-split handler file** — follows `mcp-server/gui/api-repos.ts` and `mcp-server/gui/api-knowledge.ts` patterns.
- **Config tab companion module** — follows `mcp-server/gui/public/views/config-model-registry.js` and `config-persona-models.js` patterns (module-level state vars, `render*Tab()`, `*WireEvents()`, `*DoSave()`, dirty tracking via shared `configDirty`).
- **Modal form** — follows existing GUI modal patterns in `project-detail-modal.js` (`reset-modal-overlay`) and `project-detail-dialogues.js` (`dialogue-modal-overlay`): fixed overlay, centered container via flexbox, header/body/footer structure, close-on-Escape, close-on-overlay-click, `insertAdjacentHTML('beforeend')` into `document.body`.
- **ES5-compatible frontend JavaScript** — follows `mcp-server/gui/docs/agents/project-manifest/constraints.md` §1–§2 (var, function declarations, string concatenation, .then() chains).
- **Route table ordering** — `POST /api/stores` (add store) and `PUT /api/stores/:storeId` (update label) are body-parsing and placed in Section A. `DELETE /api/stores/:storeId` and `POST /api/stores/:storeId/default` take no request body and are placed in Section B with `noBody: true`, consistent with existing `DELETE /api/repos/:repoId` and `POST /api/orchestrator/kill/:id` patterns. Existing read-only routes stay in Section B. Follows the Section A/B/C ordering invariant from `server.ts`.
- **Route ordering safety** — literal-path routes (`/api/stores/import`, `/api/stores/order`, `/api/stores/conflicts`) must precede parameterized `:storeId` routes to avoid shadowing. The existing `GET /api/stores/conflicts` route already precedes the `GET /api/stores` catch-all; new `:storeId` routes use regex named capture groups and are placed after all literal routes.
- **Atomic config writes** — follows `saveStoresConfig()` pattern (Zod validation + `withLock()` + `atomicWriteJson()`).
- **Plain-function module for stateless helpers** — `reloadStoreContext()` is a plain function, not a class method. Follows KN-0005 insight.

## Detailed Steps

### Step 1: Enrich `StoreListItem` schema

Extend the `StoreListItem` interface in `mcp-server/src/schema/store-config.ts` with new optional fields:

```typescript
export interface StoreListItem {
  id: string;
  label: string;
  path: string;
  project_count: number;
  repository_count: number;
  is_default: boolean;       // NEW
  is_git: boolean;           // NEW
  ahead?: number;            // NEW — only when is_git && has upstream
  behind?: number;           // NEW — only when is_git && has upstream
  sync?: StoreSyncMeta;      // NEW — from StoreEntry.sync
}
```

### Step 2: Add `reloadStoreContext()` to `store-context.ts` and add `skipDirCreate` option to `StoreRouter`

**`StoreRouter` constructor change:** Add an optional `options` parameter to the `StoreRouter` constructor: `constructor(config: StoresConfig | null, options?: { skipDirCreate?: boolean })`. Gate the existing `mkdirSync(store.path, { recursive: true })` loop on `!options?.skipDirCreate`. This prevents `mkdirSync` from throwing when a store path is temporarily unavailable (unmounted drive, offline NFS) during a post-save reload — `saveStoresConfig()` has already committed the change, and a constructor failure would leave the in-memory context stale while the client receives a 500. Startup calls in `gui/server.ts` and `src/index.ts` omit the option (directories created on startup as before). `handleAddStore()` already creates the directory explicitly before saving config, so the `skipDirCreate` flag is safe there too.

**`reloadStoreContext()` function:** Add a new exported async function that re-reads `stores.json`, constructs fresh `StoreRouter` and `MultiStoreManager` instances (with `skipDirCreate: true` — reload is not responsible for directory creation), and calls `setStoreContext()`. Returns the new `StoresConfig | null` so callers can use it.

```typescript
export async function reloadStoreContext(): Promise<StoresConfig | null> {
  const config = await loadStoresConfig();
  // null → stores.json absent, malformed, or schema-invalid.
  // Construct a legacy-mode router (single-store fallback) so the
  // server keeps working even when the file is externally corrupted.
  const router = new StoreRouter(config, { skipDirCreate: true });
  const manager = new MultiStoreManager(router);
  setStoreContext(router, manager);
  return config;
}
```

`StoreRouter` already accepts `null` config (falls back to single-store mode), so no special null-guard is needed beyond passing the value through. If `stores.json` was deleted or corrupted externally (e.g. by the CLI setting `default_store: null` after removing the last store), the GUI degrades to legacy single-store mode and the Stores tab shows the empty state — the user can recover by adding a new store.

This requires adding imports for `loadStoresConfig`, `StoreRouter`, and `MultiStoreManager` to `store-context.ts`. Since these are all within the storage layer, there are no circular dependency concerns.

### Step 3: Create `api-stores.ts` handler file

New file `mcp-server/gui/api-stores.ts` with the following handlers:

**`handleGetStoresEnriched(ledgerRoot: string): Promise<StoreListItem[]>`**
Replaces the existing `handleGetStores()` in `api.ts`. Must preserve the existing label fallback logic from `StoreRouter.getAllStores()`: when `StoreEntry.label` is undefined, fall back to the store's `id` as the display label (ensures `StoreListItem.label` is always a non-empty string). Enriches each store entry with:
- `is_default` — whether the store's id matches `default_store` in config
- `is_git` — detected via `execFile('git', ['-C', storePath, 'rev-parse', '--git-dir'])` (async)
- `ahead` / `behind` — via `execFile('git', ['-C', storePath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])` (only when `is_git`)
- `sync` — pass through from the `StoreEntry.sync` field

**Legacy-mode (single-store) branch:** When `loadStoresConfig()` returns `null` (no `stores.json`), the handler returns the same synthesized entry as today (`id: 'default'`, `label: 'Default Store'`, `path: ledgerRoot`) but with enriched fields: `is_default: true`, `is_git` via Git detection on `ledgerRoot`, `ahead`/`behind` from Git detection on `ledgerRoot`, `sync: undefined`.

**Git detection resilience:**
- Git enrichment for all stores runs **concurrently via `Promise.all`** (not a sequential loop). With `Promise.all`, worst-case response time with 5 stores and 5-second timeouts is 5 seconds, not 25 seconds. This mirrors how the existing `handleGetStores()` already uses `Promise.all` for project/registry loading across stores.
- All `execFile('git', ...)` calls use a **5-second timeout** (`{ timeout: 5000 }`) to prevent hangs when remotes are unreachable (VPN down, SSH agent not running, HTTP timeouts). On timeout, the call is treated as a failure — `is_git` remains the result of `rev-parse`, and `ahead`/`behind` are omitted.
- If `git` is not installed (`ENOENT` error from `execFile`), the handler catches the error and returns `is_git: false` for all stores. The enriched GET must never return 500 due to missing Git — it degrades gracefully.
- The `ahead`/`behind` detection silently returns `undefined` for both fields when there is no upstream tracking branch (exit code 128 from `rev-list`). This is distinct from `ahead: 0, behind: 0` (which means an upstream exists and is in sync).

**`handleAddStore(body): Promise<StoreListItem[]>`**
Validates body (`{ id, path, label? }`). Loads current config (or creates new if none exists — first-store scenario). Checks for duplicate id. Expands and validates path. Creates store directory + empty `.repositories.json`. Saves config via `saveStoresConfig()`. Calls `reloadStoreContext()`. Returns updated store list.

**Input validation details:**
- **Label trimming:** If `label` is provided, trim whitespace. Reject with 400 if the trimmed result is empty (prevents whitespace-only labels that pass `z.string().min(1)` but are semantically blank).
- **Path validation:** Expand via `expandStorePath()` inside a try/catch — `~username` syntax throws, and relative paths resolve against the server's unpredictable CWD. Reject relative paths explicitly (must start with `/` or `~/`). Return 400 with the specific error message on failure.
- **Duplicate path detection:** After expansion, check whether any existing store already uses the same resolved absolute path. Return 409 if a path collision is detected (different ID, same directory). This prevents ambiguous project ownership.
- **Existing directory:** If the target directory already exists, the handler still creates `.repositories.json` only if it does not already exist (no overwrite). This avoids data loss when the user accidentally points at an existing store directory. The directory creation uses `mkdir` with `{ recursive: true }` so it is a no-op for existing directories.
- **Permission errors:** If `mkdir` or `.repositories.json` creation fails with `EACCES`/`EPERM`, return 500 with a user-facing message: "Cannot create store directory: permission denied at {path}". Do not expose raw stack traces.
- **Reserved IDs:** After the `SLUG_REGEX` check, reject IDs that equal `"import"`, `"order"`, or `"conflicts"` — these collide with literal API path suffixes and cause silent routing failures (e.g. `PUT /api/stores/order` hits the reorder handler instead of updating the store's label). Return 400 with message: `'Store ID "{id}" is reserved. Choose a different identifier.'`

**`handleImportStore(body): Promise<{ stores: StoreListItem[], warning?: string }>`**
Validates body (`{ id, path, label? }`). Loads current config (or creates new if none exists). Checks for duplicate id. Expands and validates path — the directory **must already exist** (returns 400 if not found). Detects and preserves any existing `.repositories.json` in the directory (does not overwrite). Saves config + reloads context. Returns a wrapped response with the updated store list and an optional `warning` string. The key difference from `handleAddStore`: it requires an existing directory and never creates one, making the intent explicit (import vs. create). The wrapped response shape mirrors `handleRemoveStore`'s `{ stores, warned }` convention.

**Input validation details:**
- Same label trimming, path expansion, `~username` rejection, reserved-ID rejection, and duplicate-path checks as `handleAddStore`.
- **Corrupted `.repositories.json`:** If the file exists but contains malformed JSON or fails `RepositoryRegistrySchema` validation, the import still succeeds (the file is preserved as-is). The `warning` field in the response is set to: `"Existing .repositories.json is present but could not be validated — it may need manual repair."` This avoids blocking a legitimate import due to a cosmetic data issue while surfacing the problem to the user. The frontend displays the warning as a non-blocking notification banner above the store list after re-render.

**`handleUpdateStore(storeId, body): Promise<StoreListItem[]>`**
Validates body (`{ label? }`). Loads config, finds store by id, updates label (trimmed — rejects whitespace-only with 400). Saves + reloads. Returns updated store list.

**`handleRemoveStore(storeId): Promise<{ stores: StoreListItem[], warned: boolean }>`**
Loads config, finds store by id. Checks if the store has repos (warning). Removes from config (does NOT delete directory). Reassigns `default_store` if it pointed at the removed store — **reassignment strategy:** the first remaining store in the array becomes the new default (matches CLI `storeRemove` behavior in `scripts/lib/store-commands.js`). Saves + reloads. Returns updated store list + `warned` flag.

**`handleSetDefaultStore(storeId): Promise<StoreListItem[]>`**
Loads config, validates the id exists. Sets `default_store`. Saves + reloads. Returns updated store list.

**`handleReorderStores(body): Promise<StoreListItem[]>`**
Validates body (`{ order: string[] }`) — an array of store IDs in the desired order. Loads config, validates that:
1. `order.length === config.stores.length` (rejects arrays with duplicate IDs like `['a', 'a', 'b']` that would pass a set-based comparison against `['a', 'b']`).
2. Every ID in `order` exists in `config.stores` (no unknown IDs).
3. Every ID in `config.stores` appears in `order` (no omissions).

Reorders `config.stores` to match. Saves + reloads. Returns updated store list. Store order determines conflict-resolution priority: the first store in the array wins when the same repository appears in multiple stores.

### Step 4: Move existing handlers from `api.ts` to `api-stores.ts`

Move `handleGetStores()` and `handleGetStoreConflicts()` from `api.ts` to `api-stores.ts`. Export the handlers from `api-stores.ts` directly (not from `api.ts` — do not create a cross-dependency). Update `server.ts` to import from `./api-stores.js`. Remove the handlers and any related `export type` re-exports for them from `api.ts`. This consolidates all store handlers in one domain file.

Update the existing `tests/gui/api-stores.test.ts` — change the import from `'../../gui/api.js'` to `'../../gui/api-stores.js'`, update the handler reference from `handleGetStores` to `handleGetStoresEnriched`, and update the mock setup / assertions accordingly to cover the enriched response fields.

Update `tests/gui/api-store-conflicts.test.ts` — change the import path from `'../../gui/api.js'` to `'../../gui/api-stores.js'` (the `handleGetStoreConflicts` handler is moved to `api-stores.ts` in this step).

### Step 5: Update `buildStoreRoutes()` in `server.ts`

Extend the route builder to include the new write endpoints. Update the JSDoc from "Section B body-free only — both routes are read-only" to reflect the new Section A/B split.

```
Section A (body-parsing):
  POST   /api/stores                → handleAddStore(body)
  POST   /api/stores/import         → handleImportStore(body)
  PUT    /api/stores/order           → handleReorderStores(body)
  PUT    /api/stores/:storeId       → handleUpdateStore(storeId, body)

Section B (body-free):
  DELETE /api/stores/:storeId       → handleRemoveStore(storeId)        [noBody: true]
  POST   /api/stores/:storeId/default → handleSetDefaultStore(storeId)  [noBody: true]
  GET    /api/stores/conflicts      → handleGetStoreConflicts()         [noBody: true, existing]
  GET    /api/stores                → handleGetStoresEnriched(ledgerRoot) [noBody: true, existing]
```

⚠️ **Ordering constraint:** `GET /api/stores/conflicts` (literal path) must precede `GET /api/stores` (catch-all) — this ordering already exists and must be preserved. Literal-path routes (`/api/stores/import`, `/api/stores/order`, `/api/stores/conflicts`) must precede parameterized `:storeId` routes. The parameterized `:storeId` routes should use regex named groups (`/^\/api\/stores\/(?<storeId>[^/]+)$/`) to avoid shadowing.

Update imports from `api-stores.ts` instead of `api.ts`.

### Step 6: Add store API client methods in `api-client.js`

Bump the cache-busting version parameter for `api-client.js` in `index.html`: `api-client.js?v=4` → `api-client.js?v=5`.

Add the following methods to the `API` namespace:

```javascript
// Existing (already present):
getStores: function () { return request('GET', '/stores'); },
getStoreConflicts: function () { return request('GET', '/stores/conflicts'); },

// New:
addStore: function (data) { return request('POST', '/stores', data); },
importStore: function (data) { return request('POST', '/stores/import', data); },
updateStore: function (storeId, data) { return request('PUT', '/stores/' + encodeURIComponent(storeId), data); },
removeStore: function (storeId) { return request('DELETE', '/stores/' + encodeURIComponent(storeId)); },
setDefaultStore: function (storeId) { return request('POST', '/stores/' + encodeURIComponent(storeId) + '/default'); },
reorderStores: function (order) { return request('PUT', '/stores/order', { order: order }); },
```

### Step 7: Create `config-stores.js` frontend tab module

New file `mcp-server/gui/public/views/config-stores.js` following the companion tab module pattern. Module prefix: `cs` (config-stores).

**Module-level state:**
- `csStores` — working copy of store list (from server)
- `csOriginal` — snapshot for dirty comparison
- `csReorderMode` — boolean, true when the reorder sub-view is active
- `csModalMode` — `null` (closed), `'add'`, or `'edit'` (controls which fields are editable in the modal)
- `csModalStoreId` — store ID being edited (only set when `csModalMode === 'edit'`; null in add mode)
- `csModalCreateDir` — boolean toggle inside the modal: `true` = create new directory (Add), `false` = use existing directory (Import). Defaults to `true` when opening in add mode. Hidden when `csModalMode === 'edit'`.

**Rendering — `renderStoresTab(stores)`:**
At the start of `renderStoresTab(stores)`, set `csStores = stores.slice(0)` and `csOriginal = stores.slice(0)` so module-level state is always initialized before event handlers run.

The table is wrapped in the existing `.table-wrapper` container (which provides `overflow-x: auto` for horizontal scrolling on narrow viewports). This is a GUI-wide pattern already used by project-list, model-registry, dialogues, and work-package tables — not a store-specific addition.

Produces a table with columns:
- **Default** — star icon (filled for default, outline for others; clickable to set default)
- **Label** — display name
- **ID** — slug identifier
- **Path** — filesystem path, truncated via CSS `text-overflow: ellipsis` with a click-to-copy button (copies the full path to the clipboard). Native `title` tooltips are avoided because they are invisible on touch devices and inaccessible to screen readers.
- **Type** — badge: "Git" (with ahead/behind if available) or "Folder"
- **Projects** — count
- **Repositories** — count
- **Sync** — provider badge if sync metadata is present; hovering the badge shows a popover with `remote_path` and `notes` when available. If no sync metadata is present, show "—".
- **Actions** — Edit / Remove buttons

Below the table:

- **"Add Store" button** — opens the store modal in add mode.
- **"Reorder Stores" button** — opens a dedicated reorder sub-view (see below).

An empty state is shown when no stores are configured: "No stores configured. Add your first store to get started." with an "Add Store" button.

**Store modal — `csRenderStoreModal(mode, store)`:**
A shared modal form used for both adding and editing stores. Follows the existing GUI modal pattern (`reset-modal-overlay` / `dialogue-modal-overlay`): fixed overlay, centered container, header with title + close button, scrollable body, footer with action buttons.

- **Title:** "Add Store" (add mode) / "Edit Store" (edit mode)
- **Fields:**
  - **ID** — text input. Editable in add mode, shown as read-only text in edit mode (IDs are immutable).
  - **Path** — text input. Editable in add mode, shown as read-only text in edit mode (path changes are destructive — out of scope).
  - **Directory mode** — radio group, visible only in add mode: "Create new directory" (default) / "Use existing directory". When "Use existing directory" is selected, a note appears: "The directory must already exist. Any existing `.repositories.json` will be preserved." This replaces the separate Import form — Add and Import are unified into one modal with the directory mode toggle determining the API endpoint (`POST /api/stores` vs. `POST /api/stores/import`).
  - **Label** — text input (optional). Editable in both add and edit modes.
  - _(Future properties slot here — the modal layout accommodates additional fields without structural changes.)_
- **Footer:** "Save" / "Add Store" button + "Cancel" button. Button text reflects the mode.
- **Keyboard:** Enter submits, Escape closes. Focus is trapped inside the modal while open.
- **Validation:** Client-side validation mirrors the server: ID against `SLUG_REGEX`, Path non-empty and absolute (`/` or `~/`), Label trimmed (whitespace-only rejected). Validation errors appear as inline messages below each field.

**Mutation loading states:**
All mutating actions (Add Store, Remove, Set Default, Save label, Reorder) must disable the triggering button and show a brief loading indicator (e.g., the button text changes to "Saving..." / "Removing...") during the API round-trip. This prevents double-submission and provides visual feedback. On API error, the button re-enables and an error message is shown inline (inside the modal for add/edit, below the table for other actions). This pattern should be consistent across all config tabs, not just the Stores tab.

**Reorder sub-view — `csRenderReorderView(stores)`:**
A focused view that replaces the main table while active. Shows a vertical list of stores (label + ID) with **Move Up** (↑) and **Move Down** (↓) buttons on each row. The first row's Move Up and last row's Move Down buttons are disabled. Each move sends a `PUT /api/stores/order` request with the full reordered array and re-renders. A **Done** button returns to the main store list. A banner explains: "Store order determines priority — when the same repository is registered in multiple stores, the first store wins."

**Event wiring — `csWireEvents()`:**
- Add Store button → opens modal in add mode (`csModalMode = 'add'`, `csModalCreateDir = true`)
- Edit button (per row) → opens modal in edit mode (`csModalMode = 'edit'`, `csModalStoreId = store.id`), pre-fills fields with current values
- Modal Save/Add button → validates fields client-side, then:
  - Add mode with "Create new directory": calls `API.addStore()`
  - Add mode with "Use existing directory": calls `API.importStore()`. On success, if the response contains a `warning` string, display it as a non-blocking notification banner above the store list after the modal closes.
  - Edit mode: calls `API.updateStore(storeId, { label })`
- Modal Cancel / close button / Escape → closes modal without saving
- Modal keyboard: Enter submits (triggers Save/Add), Escape closes. Focus is trapped inside the modal.
- Remove button → confirmation dialog (with warning if repos exist); calls `API.removeStore()`
- Default star → `API.setDefaultStore()` (no confirmation needed — non-destructive)
- Reorder Stores button → switches to reorder sub-view
- Move Up / Move Down → computes new order array, calls `API.reorderStores(order)`
- Done (reorder view) → switches back to main store list

All mutations call the API, receive the updated store list in response, and re-render the tab via `csRefreshTab()`.

**Dirty tracking:**
Unlike the Model Registry tab (which has client-side batch edits with a "Save" button), the Stores tab uses **immediate server writes** for each action (add, remove, set default, edit label via modal). This means `configDirty.stores` is never set — each action is committed individually. This matches the nature of store operations: they affect the filesystem (directory creation, context reload) and must be applied immediately.

### Step 8: Integrate the Stores tab into `config.js`

Bump the cache-busting version parameter for `config.js` in `index.html`: `config.js?v=2` → `config.js?v=3`.

Modify `config.js` to:

1. Add a "Stores" tab button in the tab bar (positioned first, before General — stores are infrastructure-level config):
   ```javascript
   '<button class="config-tab' + (configActiveTab === 'stores' ? ' active' : '') + '" data-tab="stores">Stores</button>' +
   ```

   **Note:** The default `configActiveTab` value remains `'general'` (not changed to `'stores'`). Most users visit Configuration for general settings; Stores is a less frequent infrastructure operation. The tab is positioned first for logical grouping (infrastructure before preferences), not because it's the default landing.

2. Fetch store data in `renderConfig()` — add `API.getStores()` to the `Promise.all()` call. Thread the result as a 5th positional argument through `renderConfigPage(app, results[0], results[1], results[2], results[3], results[4])` and onward to `renderConfigTabContent(config, models, personas, assignments, stores)`. Both function signatures must be updated to accept the new `stores` parameter. Also update the call inside the tab-switch click event listener (the call to `renderConfigTabContent` used when switching tabs without a full re-fetch) to pass `stores` as the fifth positional argument.

3. Add the `stores` case to `renderConfigTabContent()`:
   ```javascript
   } else if (configActiveTab === 'stores') {
     contentEl.innerHTML = renderStoresTab(stores);
     csWireEvents();
   }
   ```

4. Add `stores: false` to the `configDirty` object initialization.

5. Reset `csStores = csOriginal = null; csReorderMode = false; csModalMode = csModalStoreId = null; csModalCreateDir = true;` in the fresh-data-load block (alongside the existing `mrModels = mrOriginal = mrEditingId = null;` and `pmModels = pmPersonas = ...` resets). Also close any open modal overlay (`csCloseModal()` if present).

6. Add tab-switch cleanup for the Stores tab **outside** the dirty-guard block (`if (configDirty[configActiveTab])`), gated by `configActiveTab === 'stores'`, positioned immediately before `configActiveTab = tab;` (the navigation statement). When leaving the stores tab, reset `csStores = csOriginal = null; csReorderMode = false; csModalMode = csModalStoreId = null; csModalCreateDir = true;`, and close any open modal overlay (`csCloseModal()` if present). Unlike the Model Registry and Persona Models tabs, the Stores tab does not use dirty tracking (all store writes are immediate), so its cleanup cannot be inside the `if (configDirty[configActiveTab])` guard — it runs unconditionally whenever leaving the Stores tab.

### Step 9: Add script tag to `index.html`

Add the new config tab module script before `config.js` (required by the load-order convention — tab modules must load before the coordinator):

```html
<script src="/views/config-stores.js?v=1"></script>
```

Place it between `config-persona-models.js` and `config.js` to maintain alphabetical order among config companion modules:
```
config-model-registry.js
config-persona-models.js
config-stores.js          ← new
config.js
```

### Step 10: Add CSS for store-specific UI elements

Add styles to `mcp-server/gui/public/styles.css` for:

- `.cs-default-star` — clickable star icon (filled/outline states)
- `.cs-type-badge` — badge for store type (Git / Folder), using existing badge color classes
- `.cs-sync-badge` — small badge for sync provider
- `.cs-path-cell` — truncated path with `text-overflow: ellipsis` and click-to-copy button
- `.cs-copy-btn` — small copy-to-clipboard button inside the path cell (icon-only, with `aria-label="Copy path"`)
- `.cs-git-status` — small ahead/behind indicators (green up-arrow for ahead, red down-arrow for behind)
- `.cs-reorder-view` — reorder sub-view container
- `.cs-reorder-row` — row in the reorder list (label + ID + move buttons)
- `.cs-move-btn` — move-up/move-down buttons (disabled state styling for first/last)
- `.cs-reorder-info` — info banner explaining priority semantics
- `.cs-sync-popover` — popover container for sync metadata detail (provider, remote_path, notes)
- `.cs-modal-overlay` — fixed overlay background for the store add/edit modal (follows `reset-modal-overlay` pattern)
- `.cs-modal` — modal container (follows `reset-modal` sizing/layout pattern)
- `.cs-modal-header`, `.cs-modal-close` — header bar with title and close button
- `.cs-modal-body` — scrollable form area
- `.cs-modal-footer` — action buttons (Save/Cancel)
- `.cs-modal-field-group` — form field + label + validation error container
- `.cs-modal-field-error` — inline validation error message below a field
- `.cs-modal-radio-group` — radio button group for directory mode toggle
- `.cs-modal-readonly` — read-only field styling (ID and Path in edit mode)
- `.cs-notification-banner` — non-blocking warning/info banner (for import warnings); auto-dismisses on next re-render or via a close button
- Empty state rendering — use `UI.emptyState('No stores configured. Add your first store below to get started.')` from `components.js` (renders `<p class="text-muted mt-16">`); no custom `.cs-empty-state` CSS class needed

Bump `styles.css?v=4` → `?v=5` in `index.html`'s `<link>` tag.

## Dependencies

- `mcp-server/src/storage/store-registry.ts` — `loadStoresConfig()`, `saveStoresConfig()`, `expandStorePath()`
- `mcp-server/src/storage/store-context.ts` — `setStoreContext()`, `isStoreContextInitialized()`, `getStoreRouter()`, `getMultiStoreManager()`
- `mcp-server/src/storage/store-router.ts` — `StoreRouter` class
- `mcp-server/src/storage/multi-store-manager.ts` — `MultiStoreManager` class
- `mcp-server/src/storage/repository-registry.ts` — `loadRegistry()`, `saveRegistry()`
- `mcp-server/src/schema/store-config.ts` — `StoreEntrySchema`, `StoresConfigSchema`, `StoreListItem`, `StoreSyncMeta`
- `mcp-server/src/schema/common.ts` — `SLUG_REGEX`
- `mcp-server/src/schema/repository-registry.ts` — `RepositoryRegistrySchema`
- `mcp-server/src/gui/errors.ts` — `ApiError`
- `node:child_process` — `execFile` for Git detection (promisified)
- `node:util` — `promisify` for `execFile`

## Required Components

- `mcp-server/gui/api-stores.ts` — **new** — store CRUD handlers
- `mcp-server/gui/public/views/config-stores.js` — **new** — frontend Stores tab module
- `mcp-server/src/schema/store-config.ts` — **modify** — enrich `StoreListItem`
- `mcp-server/src/storage/store-context.ts` — **modify** — add `reloadStoreContext()`
- `mcp-server/src/storage/store-router.ts` — **modify** — add `skipDirCreate` constructor option
- `mcp-server/gui/server.ts` — **modify** — update `buildStoreRoutes()` and imports
- `mcp-server/gui/api.ts` — **modify** — remove `handleGetStores()` and `handleGetStoreConflicts()` (moved to `api-stores.ts`)
- `mcp-server/gui/public/api-client.js` — **modify** — add store write methods
- `mcp-server/gui/public/views/config.js` — **modify** — add Stores tab integration
- `mcp-server/gui/public/index.html` — **modify** — add script tag
- `mcp-server/gui/public/styles.css` — **modify** — add store-specific styles

## Assumptions

- The number of configured stores is small (typically 1–5). Git detection is fast enough to run for all stores on each GET request without caching.
- `child_process.execFile('git', ...)` is available on all supported platforms (macOS, Linux, Windows). Git is a reasonable assumption for developers using this tool. However, the enriched GET handler degrades gracefully when Git is not installed (see Step 3).
- The `store init` CLI command remains the only way to create the initial `stores.json` from scratch when no stores.json exists and the user wants to convert from single-store mode. However, the GUI "Add Store" handler will create `stores.json` if it doesn't exist, treating the new store as the default — so CLI `store init` is not strictly required for GUI-only users.
- **MCP STDIO server divergence:** `reloadStoreContext()` only affects the GUI server process. The MCP STDIO server (`src/index.ts`) has its own `_storeRouter` / `_multiStoreManager` singletons that remain stale until restarted. Active IDE sessions will see the old store config until the MCP server is restarted. This is an acceptable trade-off — the STDIO server is typically restarted when the IDE reloads, and the GUI is the primary interface for store management.
- **Multi-tab browser staleness:** If a user opens the GUI in two browser tabs, store mutations in one tab leave the other tab's data stale. This is acceptable for a single-user developer tool — the next navigation or tab switch triggers a fresh `API.getStores()` call. No WebSocket push or polling mechanism is added.

## Constraints

- All frontend JavaScript must be ES5-compatible (var, function declarations, string concatenation, .then() chains).
- No build step — files served as-is with `?v=N` cache-busting. When adding new CSS to `styles.css`, bump the `?v=` parameter in the `<link>` tag in `index.html` (currently `?v=4` → `?v=5`). When modifying existing `.js` files served from `index.html`, bump the `?v=` query parameter on the corresponding `<script>` tag.
- Store write operations must call `reloadStoreContext()` after `saveStoresConfig()` to update the in-memory singletons.
- `StoresConfigSchema` requires at least one store entry — the remove handler must prevent removing the last store.
- The `DELETE` handler must not delete the store directory from disk (mirrors CLI behavior: deregistration only).
- All user-supplied labels must be trimmed; whitespace-only values are rejected with 400.
- All user-supplied paths must be absolute (`/...`) or home-relative (`~/...`). Relative paths are rejected with 400 because the server's CWD is unpredictable for a long-running process.
- Duplicate store paths (same resolved absolute path, different ID) are rejected with 409.
- Git `execFile` calls use a 5-second timeout to prevent hangs on unreachable remotes.
- **Store IDs are immutable after creation.** The GUI does not provide ID editing. Changing a store's ID requires removing and re-adding the store (or direct CLI/file editing). This avoids cascading updates to any references that may use the store ID as a key.
- **Reserved store IDs:** The IDs `"import"`, `"order"`, and `"conflicts"` are reserved because they collide with literal API path suffixes in `buildStoreRoutes()`. Both `handleAddStore()` and `handleImportStore()` reject these IDs with 400.

## Out of Scope

- **`store init`** — one-time bootstrap stays CLI-only; the GUI handles the first-store case implicitly via "Add Store".
- **Store path editing** — changing a store's path after creation is a destructive operation (orphans all projects in the old path). Stays CLI-only or requires a dedicated migration flow.
- **Repository management within stores** — already handled by the Strategy view; no duplication needed.
- **Git operations** (pull, push, commit) — the GUI shows sync status but does not trigger Git commands. Users manage Git externally.
- **Drag-and-drop reordering** — the reorder sub-view uses move-up/move-down buttons for simplicity and accessibility. Drag-and-drop is a progressive enhancement that can be layered on later.
- **Store ID editing** — IDs are immutable after creation. Renaming a store requires remove + re-add. This avoids cascading key-reference updates and matches the ID-as-slug convention.
- **WebSocket/polling for multi-tab sync** — unnecessary for a single-user developer tool. Stale data in a second browser tab is refreshed on the next navigation.

## Acceptance Criteria

- AC-01: The Configuration screen has a "Stores" tab that lists all configured stores with id, label, path, type (Git/Folder), project count, repository count, and default indicator.
- AC-02: Each store displays a type badge: "Git" for stores backed by a Git repository, "Folder" for plain directories.
- AC-03: Git-backed stores show ahead/behind counts when an upstream remote is configured.
- AC-04: Users can add a new store via a form (id, path, label). The store directory and empty `.repositories.json` are created on the server. The new store appears in the list immediately.
- AC-04a: Users can import an existing store directory via the same modal form used for adding (by selecting "Use existing directory" mode). The directory must already exist; an existing `.repositories.json` is preserved. The imported store appears in the list immediately.
- AC-05: Users can remove a store via a button with confirmation dialog. The store is deregistered from `stores.json` but the directory is not deleted. A warning is shown when the store contains registered repositories.
- AC-06: Users can set any store as the default with a single click. The default indicator updates immediately.
- AC-07: Users can edit a store's label via a modal form (opened by the Edit button). The change is saved immediately on submit.
- AC-08: All write operations take effect immediately in the running server — no restart required. The in-memory store context (`StoreRouter`, `MultiStoreManager`) is reloaded after each config change.
- AC-09: When no `stores.json` exists and the user adds their first store via the GUI, the file is created with that store as the default.
- AC-10: The Stores tab shows a meaningful empty state when no stores are configured.
- AC-11: Sync metadata (provider, remote_path, notes) from `StoreEntry.sync` is displayed when present. Provider shows as a badge; hovering the badge reveals remote_path and notes in a popover.
- AC-12: All new backend endpoints validate input and return appropriate error codes (400 for validation failures, 404 for unknown store IDs, 409 for duplicate IDs).
- AC-13: The `StoresConfigSchema` invariant (at least one store, no duplicate IDs, valid default_store reference) is maintained by all write handlers.
- AC-14: Users can reorder stores via a dedicated sub-view with move-up/move-down buttons. The new order is saved immediately and takes effect for conflict resolution priority.
- AC-15: The import handler rejects paths that do not point to an existing directory (returns 400).
- AC-16: Git detection degrades gracefully — when Git is not installed or a Git command times out, the store list still loads with `is_git: false` and no ahead/behind data. No 500 errors.
- AC-17: Add and import handlers reject relative paths with 400 and a clear error message.
- AC-18: Add and import handlers reject duplicate store paths (same resolved path, different ID) with 409.
- AC-19: Labels are trimmed on input; whitespace-only labels are rejected with 400.
- AC-20: When `stores.json` is externally corrupted (e.g. CLI sets `default_store: null` after removing the last store), the Stores tab degrades to the empty state and allows the user to recover by adding a new store.
- AC-21: The import handler warns (in the response) when an existing `.repositories.json` is present but fails schema validation, without blocking the import.
- AC-22: When the default store is removed, the first remaining store in the array automatically becomes the new default (matching CLI behavior).
- AC-23: Mutating buttons (Add, Import, Remove, Set Default, Save label, Move) are disabled with loading text during API round-trips to prevent double-submission.
- AC-24: The store modal supports keyboard shortcuts: Enter to save, Escape to close. Focus is trapped inside the modal while open.
- AC-25: The store table is wrapped in `.table-wrapper` for horizontal scrolling on narrow viewports, consistent with all other GUI tables.
- AC-26: Add and Import are unified into a single modal form with a directory-mode toggle ("Create new directory" / "Use existing directory"). The same form is reused for editing with ID and Path shown read-only.
- AC-28: The store modal follows existing GUI modal patterns (`reset-modal-overlay` / `dialogue-modal-overlay`): fixed overlay, centered container, close-on-Escape, close-on-overlay-click.
- AC-27: Path cells provide a click-to-copy button that copies the full filesystem path to the clipboard.

## Testing Strategy

Backend handlers are tested with unit tests that mock the storage layer (consistent with existing `api-store-conflicts.test.ts` pattern). Frontend rendering is not unit-tested (consistent with existing config tab modules — no frontend test files exist for config-model-registry.js or config-persona-models.js). Integration testing is manual via the GUI.

## Test Plan

- `mcp-server/tests/gui/api-stores.test.ts` — **update** — Existing 273-line test suite covers `handleGetStores` — migrate import path to `api-stores.js`, rename handler reference to `handleGetStoresEnriched`, and extend with new CRUD handler test cases:
  - `handleGetStoresEnriched()` returns enriched data with is_default, is_git, ahead/behind — AC-01, AC-02, AC-03
  - `handleGetStoresEnriched()` falls back to single-store entry in legacy mode — enriched fields: `is_default: true`, `is_git` from Git detection on `ledgerRoot`, `sync: undefined` — AC-01
  - `handleGetStoresEnriched()` returns `is_git: false` when Git is not installed (ENOENT) — AC-16
  - `handleGetStoresEnriched()` omits ahead/behind on Git timeout (5s) — AC-16
  - `handleGetStoresEnriched()` omits ahead/behind when no upstream tracking branch exists — AC-03
  - `handleAddStore()` validates body, creates directory, saves config, reloads context — AC-04, AC-12
  - `handleAddStore()` creates stores.json when none exists (first-store scenario) — AC-09
  - `handleAddStore()` rejects duplicate store id — AC-12, AC-13
  - `handleAddStore()` rejects invalid id (non-slug) — AC-12
  - `handleAddStore()` rejects relative path (not absolute or `~/`) — AC-17
  - `handleAddStore()` rejects duplicate store path (same resolved path, different id) — AC-18
  - `handleAddStore()` rejects whitespace-only label — AC-19
  - `handleAddStore()` does not overwrite existing `.repositories.json` when directory already exists — AC-04
  - `handleAddStore()` returns 500 with user-facing message on permission error — AC-12
  - `handleAddStore()` rejects reserved store IDs (`"import"`, `"order"`, `"conflicts"`) with 400 — AC-12
  - `handleRemoveStore()` removes store, reassigns default to first remaining, warns on repos — AC-05, AC-13, AC-22
  - `handleRemoveStore()` rejects removing the last store — AC-13
  - `handleRemoveStore()` rejects unknown store id — AC-12
  - `handleUpdateStore()` updates label — AC-07
  - `handleUpdateStore()` rejects unknown store id — AC-12
  - `handleSetDefaultStore()` sets default_store — AC-06
  - `handleSetDefaultStore()` rejects unknown store id — AC-12
  - `handleImportStore()` registers existing directory, preserves `.repositories.json` — AC-04a
  - `handleImportStore()` rejects non-existent directory — AC-15
  - `handleImportStore()` rejects duplicate store id — AC-12, AC-13
  - `handleImportStore()` rejects duplicate store path — AC-18
  - `handleImportStore()` creates stores.json when none exists — AC-09
  - `handleImportStore()` rejects reserved store IDs (`"import"`, `"order"`, `"conflicts"`) with 400 — AC-12
  - `handleImportStore()` warns on corrupted `.repositories.json` without blocking import — AC-21
  - `handleImportStore()` returns wrapped response `{ stores, warning }` with warning string when `.repositories.json` is corrupted — AC-21
  - `handleUpdateStore()` rejects whitespace-only label — AC-19
  - `handleReorderStores()` reorders stores array — AC-14
  - `handleReorderStores()` rejects mismatched ID set (missing or extra IDs) — AC-12
  - `handleReorderStores()` rejects duplicate IDs in order array (length mismatch) — AC-12
  - `handleReorderStores()` rejects empty order array — AC-12

- `mcp-server/tests/storage/store-context-reload.test.ts` — **new** — Unit tests for `reloadStoreContext()` (placed in `tests/storage/` alongside the existing `store-context.test.ts` companion; alternatively, these test cases can be added as a new `describe('reloadStoreContext()')` block in the existing `tests/storage/store-context.test.ts`):
  - Reinitializes `StoreRouter` and `MultiStoreManager` from fresh config — AC-08
  - Returns null and sets legacy-mode context when no stores.json — AC-08
  - Returns null and sets legacy-mode context when stores.json is schema-invalid — AC-20
  - `reloadStoreContext()` constructs `StoreRouter` with `skipDirCreate: true` — AC-08

- `mcp-server/tests/storage/store-router.test.ts` — **extend** — Add a new `describe('skipDirCreate option')` block to the existing test file:
  - Constructor with `skipDirCreate: true` does not call `mkdirSync` for store paths — structural
  - Constructor without options creates store directories as before (default behavior) — structural

## Documentation Updates

- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Add §1.8 Stores section with all new endpoints, request/response shapes, and validation rules.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — Add `api-stores.ts` to backend file list and `config-stores.js` to views file list.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Add §11 Store Management data flow (frontend action → API call → config write → context reload → response → re-render).
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Add constraint about store context hot-reload requirement after config writes.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Add store-specific CSS class documentation.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Four updates:
  - `StoreListItem` interface: add the five new fields (`is_default`, `is_git`, `ahead?`, `behind?`, `sync?`)
  - `StoreRouter` constructor: update signature to `constructor(config: StoresConfig | null, options?: { skipDirCreate?: boolean })`
  - New export: `reloadStoreContext()` in `store-context.ts`
  - Handler rename: `handleGetStores` → `handleGetStoresEnriched` (enriched response fields)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `api-stores.ts` to the backend handler file list (alongside `api-repos.ts` and `api-knowledge.ts`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Git detection slow for many stores** | Store count is typically 1–5. `execFile` is async and non-blocking. If performance becomes an issue, add a `?include_git_status=true` query parameter to make it opt-in. |
| **Git commands hang on unreachable remotes** | All `execFile('git', ...)` calls use a 5-second timeout. On timeout, the handler returns `is_git` based on `rev-parse` result and omits `ahead`/`behind`. No 500 errors. |
| **Git not installed** | `execFile` catches `ENOENT` and falls back to `is_git: false` for all stores. The enriched GET never fails due to missing Git. |
| **Race condition between concurrent store writes** | `saveStoresConfig()` already uses `withLock()` for atomic writes. The GUI is single-user, so concurrent writes are unlikely. The lock provides safety for any edge case. |
| **Store context reload during active request** | `reloadStoreContext()` is synchronous in its state update (single `setStoreContext()` call). Active requests that already resolved a `StoreRouter` reference will complete with the old context; the next request will use the new one. This is acceptable for the GUI use case. |
| **First-store creation without `store init`** | The `handleAddStore()` handler must handle the case where `loadStoresConfig()` returns null. It creates a fresh config with the new store as the sole entry and default. This is tested explicitly in AC-09. |
| **`StoresConfigSchema.parse()` rejects config after removing the last store** | The remove handler checks `config.stores.length === 1` before attempting removal and returns a validation error. The user cannot leave the config in an invalid state. |
| **CLI leaves `stores.json` in invalid state** | The CLI's `storeRemove` allows removing the last store and sets `default_store: null`, which fails `StoresConfigSchema`. `loadStoresConfig()` returns `null` for schema-invalid files. `reloadStoreContext()` passes `null` to `StoreRouter` (legacy-mode fallback). The GUI shows the empty state and the user can recover by adding a new store (AC-20). |
| **MCP STDIO server stays out of sync** | `reloadStoreContext()` only affects the GUI process. The STDIO server retains its startup-time context until restarted. This is acceptable — the IDE typically restarts the MCP server on config changes, and the GUI is the primary store management interface. |
| **Filesystem permission errors on store creation** | `handleAddStore` catches `EACCES`/`EPERM` from `mkdir` and `.repositories.json` creation, returning 500 with a user-facing permission error. Raw stack traces are not exposed. |
| **Duplicate or overlapping store paths** | Both `handleAddStore` and `handleImportStore` check resolved absolute paths against all existing stores. Exact path duplicates are rejected with 409. Nested paths (e.g. `/data` alongside `/data/stores/main`) are not blocked — this is a valid configuration for advanced users and causes no functional issue since project routing is registry-based, not path-based. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Multi-file change spanning backend handlers, schema, frontend module, server routing, and tests — benefits from formal QA and code review stages.
