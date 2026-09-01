# Constraints & Conventions — MCP Server GUI

> **Scope:** Every convention governing the GUI — the vanilla-JS frontend and the standalone HTTP
> server that serves it, including its REST handler modules (`gui/api*.ts`) and route table.
>
> **Companion documents (MCP server core):**
> [Core](../../../../docs/agents/project-manifest/constraints.md) ·
> [Workflow](../../../../docs/agents/project-manifest/constraints-workflow.md) ·
> [Testing](../../../../docs/agents/project-manifest/constraints-testing.md) ·
> [Code Style](../../../../docs/agents/project-manifest/constraints-code-style.md) ·
> [Storage & Knowledge](../../../../docs/agents/project-manifest/constraints-storage.md)
>
> Entries here are numbered for historical continuity, but cite them by heading — the core
> manifest dropped numbering after repeated collisions.

## Contents

**Frontend**

- [1. No Build Step](#1-no-build-step)
- [2. ES5-Compatible JavaScript](#2-es5-compatible-javascript-frontend)
- [3. Global Namespace Pattern](#3-global-namespace-pattern)
- [4. Hash-Based Routing Convention](#4-hash-based-routing-convention)
- [5. View Module Naming](#5-view-module-naming)
- [6. CSS Theming System](#6-css-theming-system)
- [12. Error Handling Convention](#12-error-handling-convention-frontend)
- [13. HTML Generation Convention](#13-html-generation-convention)
- [14. Version Busting Convention](#14-version-busting-convention)
- [18. CSS Class Derivation From API Values](#18-css-class-derivation-from-api-values-is-only-safe-for-zod-enum-validated-fields)
- [19. JSDoc Closure-Dependency Documentation](#19-jsdoc-closure-dependency-documentation-for-gui-helpers)
- [20. API Client `@throws` JSDoc](#20-api-client-methods-that-reject-on-server-error-must-carry-throws-jsdoc)

**Backend**

- [7. Security Constraints](#7-security-constraints-backend)
- [8. STDIO Discipline](#8-stdio-discipline)
- [9. Route Dispatch Ordering and Sub-Builder Composition](#9-route-dispatch-ordering-and-sub-builder-composition)
- [10. Deprecated Route Convention](#10-deprecated-route-convention)
- [11. Polling Convention](#11-polling-convention)
- [15. Dual-Format Endpoint Pattern](#15-dual-format-endpoint-pattern-formatstructured)
- [16. Hot-Reload After Store Config Writes](#16-hot-reload-after-store-config-writes)
- [21. Handler Domain Split — One File per API Domain](#21-handler-domain-split--one-file-per-api-domain)
- [22. Path-Traversal Guards Must Come First](#22-path-traversal-guards-must-come-first)
- [23. GUI Port Convention](#23-gui-port-convention--live-3420-vs-dev-3460)

**Reference**

- [24. Known Limitations](#24-known-limitations)

---

## 1. No Build Step

The frontend has **zero build tooling**. All `.js` and `.css` files in `public/` are served as-is by the static file server. There is no bundler, no minifier, no transpiler, no source maps.

**Implications:**
- Do not use `import`/`export` syntax in frontend files.
- Do not use `let`, `const`, arrow functions, template literals, or other ES6+ features in frontend code.
- Do not add a `package.json` to `gui/` or `gui/public/`.
- Do not introduce webpack, vite, rollup, esbuild, or any bundler.
- Cache-busting is done manually via `?v=N` query strings in `index.html` script/link tags.

---

## 2. ES5-Compatible JavaScript (Frontend)

All frontend JavaScript uses **ES5-compatible patterns**:

- `var` instead of `let`/`const`.
- `function` declarations instead of arrow functions.
- String concatenation instead of template literals.
- IIFE module pattern instead of ES modules.
- `Promise` chains with `.then()` / `.catch()` (native Promises are the one ES6 feature used, as all target browsers support them).

**Exception:** `async/await` appears in `api-client.js` internal helper — this is acceptable because the GUI targets modern browsers where async/await has been supported since 2017.

**Rationale:** The codebase was designed for maximum simplicity and zero dependencies. The pattern is intentional — do not "upgrade" to modern syntax without adding a transpilation step.

**Event listener lifecycle on persistent DOM elements:** There are no framework lifecycle hooks. Any module that registers a `click` (or other) listener on a persistent element (e.g., `document.body`, a tab container, a persistent table wrapper) **must** manage the listener reference manually:

```javascript
var csClickHandler = null;

function csInitListeners() {
  csClickHandler = function (e) { /* … */ };
  persistentEl.removeEventListener('click', csClickHandler); // guard against double-init
  persistentEl.addEventListener('click', csClickHandler);
}

function csCleanup() {
  if (csClickHandler) {
    persistentEl.removeEventListener('click', csClickHandler);
    csClickHandler = null;
  }
}
```

Skipping the `removeEventListener` guard causes listeners to accumulate silently each time the tab/view is re-rendered, leading to duplicate event handling that is difficult to diagnose. This pattern is established in `config-stores.js` and `config.js`; all future tab modules must follow it from the start.

---

## 3. Global Namespace Pattern

Frontend modules expose their public API as global variables via IIFEs:

```javascript
var ModuleName = (function () {
  // private
  return { publicMethod: fn };
})();
```

**Rules:**
- Each file exposes exactly one namespace (or a set of bare functions for `utils.js`).
- Dependencies between modules are implicit (load order in `index.html` matters).
- View files expose a `render*` function that the router calls.
- Do not introduce a module loader or import map.

**Cross-module shared state (`globalThis`):** When a view is split into sub-modules that need to share a mutable array or object, the owning module declares it as a `var` and immediately promotes it to `globalThis`:

```javascript
// In the owning module (project-detail.js):
var _pdLogPreviewCleanups = [];
globalThis._pdLogPreviewCleanups = _pdLogPreviewCleanups;
```

Sub-modules then reference the shared state exclusively via `globalThis.*`. All in-place mutations (`.push()`, `.length = 0`) operate on the same array instance.

**Drain invariant:** Drain sites must use `.length = 0` (in-place reset), never `= []` (reassignment). Reassignment would create a new array that the other module's reference does not see, silently breaking the drain contract. See `data-flows.md §3a` for the full project-detail module load-order and shared-state documentation.

---

## 4. Hash-Based Routing Convention

- All client-side routes use `#` prefix (e.g., `#/projects/repo/slug`).
- The router matches routes via regex patterns in declaration order.
- Route parameters are extracted via capture groups.
- All URL parameters passed to API calls must be `encodeURIComponent()`-encoded.
- New routes must be added to **both** `router.js` (dispatch) and the corresponding view file.

---

## 5. View Module Naming

| Convention | Example |
|------------|---------|
| File name | `views/{noun}.js` (hyphenated) |
| Render function | `render{PascalCase}(app, ...params)` |
| First argument | Always the `#app` container element |
| Pattern | `showLoading()` → fetch → build HTML string → set innerHTML |

Views must:
- Call `showLoading(app)` before any async work.
- Handle fetch errors with `showError(app, message)`.
- Use `breadcrumb()` for navigation context.
- Cache project names via `ProjectNameCache.set()` when fetching project data.

---

## 6. CSS Theming System

- All colors are defined as CSS custom properties on `:root`.
- Dark mode overrides properties under `[data-theme="dark"]`.
- Hard-coded hex values in dark overrides are acceptable (and necessary for specific badge backgrounds).
- Never use hard-coded colors in the light-theme base styles — always reference `var(--color-*)`.
- The `theme-init.js` script in `<head>` prevents FOUC by setting the attribute before body renders.

---

## 7. Security Constraints (Backend)

### Path Traversal Prevention

- All URL path parameters (slug, repo, wpId, filename) are validated against allowlist regexes before filesystem access.
- `SAFE_SLUG_REGEX` (`/^[a-z0-9][a-z0-9-]*$/`) for project slugs and repo names.
- `SAFE_ID_PATTERN` (`/^[A-Za-z0-9][\w-]*$/`) for WP IDs and queue entry IDs.
- Static file serving checks `resolve(filePath).startsWith(PUBLIC_DIR)`.
- Invalid parameters always return `NOT_FOUND` — never a different error that could leak information.

### Body Size Limit

- `MAX_BODY_BYTES = 1_048_576` (1 MiB) enforced by `readBody()`.
- Both `Content-Length` pre-check and streaming byte-count check.
- Exceeding the limit throws `PayloadTooLargeError` → HTTP 413.

### Information Hiding

- Ambiguous slug resolutions are downgraded to NOT_FOUND (cross-namespace existence leak prevention).
- Malformed `.meta.json` files log to stderr but return NOT_FOUND to clients.
- Error responses never include internal paths or stack traces.

### Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`

---

## 8. STDIO Discipline

- **`server.ts`**: May write to stdout (it runs as a standalone process, not an MCP server).
- **`api.ts`, `api-knowledge.ts`, `orchestrator-manager.ts`**: Never write to `process.stdout`. Diagnostics go to `process.stderr` only.
- **Rationale:** The MCP server communicates via stdout. Although the GUI is a separate process, handler files are shared — keeping them stdout-free prevents accidental protocol corruption if handlers are ever loaded in the MCP process.

---

## 9. Route Dispatch Ordering and Sub-Builder Composition

Routes in `server.ts` are declared in `buildRoutes()` and matched in declaration order by `dispatchRoute()`. `buildRoutes()` delegates to non-exported domain sub-builders — `buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildStoreRoutes`, `buildProjectRoutes` — composed via spread. When adding a route, add it to the appropriate sub-builder; the spread ordering in `buildRoutes()` must not be changed, since it is what preserves the section ordering below. Each sub-builder receives only the closure variables its handlers require. The table is organized into three sections:

- **Section A** — Body-parsing routes (`PUT`, `PATCH`, `POST`). These routes use `readJsonBody()` and have no `noBody` flag.
- **Section B** — Keyword-specific body-free routes (`noBody: true`). Both active namespaced (`/:repo/:slug/keyword`) and deprecated flat (`/:slug/keyword`) variants live here. **Section B MUST precede Section C** — this is a load-bearing ordering constraint, not cosmetic. A Section C catch-all regex would shadow keyword-specific routes if declared first.
- **Section C** — Catch-all body-free routes (`noBody: true`). These match any remaining path shapes after Section B has had priority.

When adding new routes:

- More-specific patterns (keyword routes) must appear in **Section B** before the **Section C** catch-alls.
- All parameterised routes must use RegExp with **named capture groups** (e.g., `(?<slug>[^/]+)`) — positional groups are not permitted.
- Namespaced routes (`/:repo/:slug/...`) and legacy flat routes (`/:slug/...`) coexist within the same section — both are equally matched by `dispatchRoute()`.
- Route handlers conform to the `Route` interface defined in `server.ts`. `Route.method` is typed as the `HttpMethod` union (`'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`) — not `string` — giving compile-time safety for route method values.

---

## 10. Deprecated Route Convention

Legacy non-namespaced routes (e.g., `/api/projects/:slug`) are retained for backward compatibility and marked with `@deprecated` comments. Each deprecated route has a comment pointing to its namespaced replacement. These will be removed in the next major version.

---

## 11. Polling Convention

- Views that need live data set up polling via `Router._setPolling(fn, delayMs)`.
- The router **automatically clears** any active interval on route change.
- The `OrchestratorWidgets.renderLogPreview()` returns a cleanup function for component-level polling. Callers must wrap the push with `if (cleanup)` to defend against a null/undefined return (the current implementation always returns a function, but the guard is kept for contract safety).
- Default intervals: 3–5 seconds for active data, 30 seconds for stale checks.
- **In-place patch pattern (project-detail):** `renderProjectDetail` avoids full-page rebuilds on poll ticks by comparing a stable structure key (`_orchRunsStructureKey`) against the previous tick. If the structure is unchanged, only the status card's `innerHTML` is replaced (`_patchOrchStatusCard`). If the structure changed (new run, run completed, or first tick), a full `renderRunsList` is performed with scroll-position save/restore. See `data-flows.md §9` for details.

---

## 12. Error Handling Convention (Frontend)

- API errors are caught and displayed via `showError(container, message)`.
- Error objects have shape `{ code: string, message: string }`.
- `window.alert()` is used for action failures (kill, dismiss) where the page shouldn't navigate.
- `window.confirm()` gates destructive actions (kill, delete).

---

## 13. HTML Generation Convention

- Views build HTML as concatenated strings (not DOM manipulation).
- Set `container.innerHTML = htmlString` in one assignment.
- Use `escapeHtml()` for ALL user-provided text to prevent XSS.
- Never use `innerHTML` with unescaped user data.
- DOM event listeners (for buttons, forms) are attached AFTER innerHTML is set, using `querySelector` / `getElementById`.

---

## 14. Version Busting Convention

Script and stylesheet references in `index.html` use `?v=N` query parameters for cache busting:

```html
<script src="/api-client.js?v=3"></script>
```

When modifying a frontend file, increment its `?v=N` parameter in `index.html` to ensure browsers pick up the change.

---

## 15. Dual-Format Endpoint Pattern (`?format=structured`)

Some backend endpoints support a `?format=structured` query parameter to switch the response
between a plain-text format and a structured JSON format without breaking existing callers.

**Current endpoints using this pattern:**

| Endpoint | Without parameter | With `?format=structured` |
|----------|-------------------|---------------------------|
| `GET …/chunks/:filename/rendered` | `{ content: string }` — Markdown from `renderChunksToDialogue()` | `{ blocks: DialogueBlock[] }` — typed array from `renderChunksToStructured()` |

**Rules for this pattern:**

1. **Backward-compatible by default.** Omitting the parameter always returns the legacy format.
   Existing callers do not need to be updated.
2. **Format detection is via `URLSearchParams`.** Use
   `new URLSearchParams(qStr).get('format') === 'structured'` — do not parse manually.
3. **Only `format=structured` is a valid structured-mode value.** Any other value falls back to the
   default format; no error is returned for unknown values.
4. **New dual-format endpoints must document both response shapes** in `api-surface.md`
   (routes table row) and the corresponding data flow in `data-flows.md`.

---

## 16. Hot-Reload After Store Config Writes

Every write handler in `api-stores.ts` (`handleAddStore`, `handleImportStore`, `handleUpdateStore`, `handleRemoveStore`, `handleSetDefaultStore`, `handleReorderStores`) **must** call `reloadStoreContext()` after a successful `saveStoresConfig()`. This is mandatory — skipping it leaves the in-memory `StoreRouter` and `MultiStoreManager` stale while the on-disk `stores.json` has been updated, causing subsequent read/write operations to use the wrong store routing.

**`reloadStoreContext()` contract:**
- Calls `loadStoresConfig()` to re-read `stores.json` from disk.
- Constructs `new StoreRouter(config, { skipDirCreate: true })` — the `skipDirCreate` flag prevents `mkdirSync` from throwing when a store path is temporarily unavailable (unmounted drive, offline NFS). Directory creation is the responsibility of `handleAddStore`, not of the reload.
- Calls `setStoreContext(router, manager)` to overwrite the module-level singletons.
- Returns the new `StoresConfig | null` so callers can use it to build the response.

**Failure handling:** If `reloadStoreContext()` throws (unexpected I/O error), the write handler returns a 500. The config file was already saved — the client should retry the read (`GET /api/stores`) to get the current state.

**Test isolation:** Test suites that call `setStoreContext()` directly do not need to call `reloadStoreContext()`. The real-implementation tests for write handlers should verify that the in-memory context reflects the updated config after each mutation.

---

## 18. CSS Class Derivation From API Values Is Only Safe for Zod-Enum-Validated Fields

CSS class derivation from raw API values is only safe when the field is a Zod-enum-validated type. For non-enum fields, apply `escapeHtml()` or a whitelist map.

**Rationale:** The pattern `(field).toLowerCase().replace(/ /g, '_')` generates a CSS class string from a server-supplied value. If the field is a closed Zod enum, the server guarantees the value is one of a finite safe set — class injection is not possible. If the field is a free-form string (`z.string()`), a tampered ledger JSON (or a future schema relaxation) could insert arbitrary characters into a `class=""` attribute, enabling CSS injection or layout-breaking attacks.

**Anti-pattern:**
```javascript
// ❌ WRONG — open string field; output is injected into class="" without escaping
var cls = (someOpenStringField || '').toLowerCase().replace(/ /g, '_');
el.innerHTML = '<span class="badge ' + cls + '">…</span>';
```

**Correct patterns:**
```javascript
// ✅ OPTION A — field is a closed Zod enum (safe by schema contract)
// p.status is WorkPackageStatus — a Zod enum with a fixed value set
var cls = (p.status || '').toLowerCase().replace(/ /g, '_');

// ✅ OPTION B — whitelist map (safe for any field type)
var STATUS_CLASS = { READY: 'ready', IN_PROGRESS: 'in_progress', COMPLETE: 'complete', BLOCKED: 'blocked', CANCELLED: 'cancelled' };
var cls = STATUS_CLASS[p.status] || 'unknown';

// ✅ OPTION C — escapeHtml() before insertion (safe for any field type)
var cls = escapeHtml((someField || '').toLowerCase().replace(/ /g, '_'));
```

**Scope:** Applies to all client-side JavaScript in `gui/public/`. When adding new attribute values derived from API data, determine whether the field is enum-backed before using the raw-derivation pattern.

---

## 19. JSDoc Closure-Dependency Documentation for GUI Helpers

Every closure-scoped helper function in `gui/public/views/*.js` that reads or mutates variables from its enclosing scope MUST include a `Closure dependencies (from <parent>() scope):` JSDoc block listing each closed-over variable with a one-line description of whether it is read-only or mutated by this helper.

**Example:**
```javascript
/** Injects action buttons into the rendered table.
 *
 *  Closure dependencies (from renderOrchestrator() scope):
 *    `expandedIds`   — mutated; toggle clicks update row expansion state.
 *    `refreshQueue`  — read-only; called after Kill/Dismiss actions. */
function _bindQueueActions(container, entries) { /* ... */ }
```

**Rationale:** Vanilla JS files lack module-level imports that make dependencies visible. Without explicit documentation, future contributors cannot determine which outer-scope variables a helper depends on without reading the entire enclosing function.

**Scope:** Applies only to `gui/public/views/*.js` files (vanilla JS, no module system). TypeScript modules in `src/` use explicit imports and do not need this pattern.

---

## 20. API Client Methods That Reject on Server Error Must Carry `@throws` JSDoc

Any method in `gui/public/api-client.js` that can reject its returned Promise with a structured server error object MUST include a `@throws` JSDoc tag documenting the shape of that error:

```javascript
/**
 * @throws {{ code: string, message: string }} On non-ok response from the server.
 */
```

**Scope:** Applies to all methods in the Model Registry group (`getModels`, `saveModels`, `loadDefaultModels`), the Persona group (`getAssignments`, `updateAssignments`, `replaceAssignedModel`, `rebuildPersonas`, `getPersonas`), and any future API method that may reject with a structured error. Methods that never reject with a structured error object (e.g. methods that return `null` on 404) are exempt.

**Rationale:** `api-client.js` has no TypeScript types. Without `@throws` JSDoc, callers have no machine-readable signal that error objects carry `code` and `message` properties — critical for correct `catch` block handling. The tag is the only inline contract available in a plain-JS, no-build-step environment.

**Anti-pattern:**
```javascript
// ❌ WRONG — caller has no documented error shape
getModels: async function () { /* ... */ },
```

**Correct pattern:**
```javascript
// ✅ CORRECT — error shape is documented for callers and tooling
/**
 * @throws {{ code: string, message: string }}
 */
getModels: async function () { /* ... */ },
```

---

## 21. Handler Domain Split — One File per API Domain

Each API domain owns a dedicated handler module imported by `server.ts`. No handler code for these domains may be added to or remain in `gui/api.ts`.

| Module | Owns |
|--------|------|
| `gui/api-knowledge.ts` | `/api/knowledge*` handlers, `KnowledgeUpdateBodySchema`, `KnowledgeMoveBodySchema`, `KnowledgeListParams`, `parseKnowledgeId` |
| `gui/api-repos.ts` | `/api/repos*` handlers, `RepoCreateBodySchema`, `RepoUpdateBodySchema`, `RepoListItem`, `assertNoFolderNameConflicts` |
| `gui/api-stores.ts` | `/api/stores/*` handlers, their Zod body schemas, `StoreListItem` |
| `gui/api-models.ts` | Model registry and persona-assignment handlers |

**Rationale:** `gui/api.ts` had grown into a maintenance liability. Extracting each domain into its own module isolates ownership and prevents drift back into `api.ts`. Each extracted module re-defines `validationError` locally (importing `ApiError` directly) rather than re-exporting it from `api.ts`.

**Implication for `gui/server.ts`:** Import domain handlers from their own module — never from `./api.js`. All routes are registered in the unified `buildRoutes()` table and dispatched by `dispatchRoute()`.

**Domain-specific notes:**

- **`POST /api/repos` returns 201, not 200.** This is intentional — correct REST practice for resource creation. All other mutation routes return 200. The 201 is set via the `statusCode: 201` field on the route entry and must not be changed.
- **`RepoCreateBodySchema` and `RepoUpdateBodySchema` are `@internal`.** They are exported so tests can construct validated shapes without duplicating schema logic. They are not a stable public API — keep them marked `@internal` when editing `api-repos.ts`.
- **Store route ordering:** literal-path routes (`/api/stores/import`, `/api/stores/order`, `/api/stores/conflicts`) MUST be registered before parameterized `:storeId` routes (`/api/stores/:storeId`, `/api/stores/:storeId/default`) to prevent shadowing.
- **`handleGetStoresEnriched` replaces `handleGetStores`.** `handleGetStoresEnriched(ledgerRoot)` returns `StoreListItem[]` enriched with `is_default`, `is_git`, and optional `ahead`/`behind` fields. Do not re-add a bare `handleGetStores` to `api.ts`.

**Anti-pattern:**
```typescript
// ❌ WRONG — domain handler in api.ts, or re-exported via api.ts
export async function handleListRepos(...) { /* in gui/api.ts */ }
```

**Correct pattern:**
```typescript
// ✅ CORRECT — handler in the dedicated module
// gui/api-repos.ts
export async function handleListRepos(...) { /* ... */ }

// gui/server.ts
import { handleListRepos } from './api-repos.js';
```

---

## 22. Path-Traversal Guards Must Come First

Every GUI API handler that accepts a path segment parameter must call its corresponding guard as the **first** statement (slug) or **second** statement (wpId), before any other processing.

| Guard | Parameter | Placement |
|-------|-----------|-----------|
| `assertSafeSlug(slug)` | project slug or repo name | 1st statement |
| `assertSafeWpId(wpId)` | work-package ID | 2nd statement (after `assertSafeSlug`) |

**Rejection criteria (both guards):** throws `ApiError` with code `NOT_FOUND` (HTTP 404) if the value is empty (`''`), contains a forward slash (`/`), or contains a double dot (`..`).

**Rationale:** Returning `NOT_FOUND` rather than `FORBIDDEN` on traversal attempts is intentional — it avoids leaking structural information about the server's file system, and is consistent with the standard "project not found" response.

**Implementation:** Both guards are module-private (not exported). They must not be bypassed or called after other parameter-dependent operations. `assertSafeSlug` in `gui/api.ts` delegates to `assertSafeSegment()` from `src/utils/path-validator.ts`; the copy in `gui/server.ts` still performs an inline `SAFE_SLUG_REGEX.test()` — see the core manifest's [Known Limitations](../../../../docs/agents/project-manifest/constraints-storage.md#known-limitations).

**Acceptance-criteria wording:** see [Path-Traversal Acceptance Criteria Use 404 Wording](../../../../docs/agents/project-manifest/constraints-testing.md#path-traversal-acceptance-criteria-use-404-wording).

---

## 23. GUI Port Convention — LIVE (3420) vs. DEV (3460)

The GUI server uses **port 3420** as its default. This port is reserved for the **LIVE workspace** — the installed production copy of the MCP server that agents use during active ledger workflows. When running the GUI from the **DEV workspace** (this repository, a feature branch, or any development build), always pass `--port 3460`:

```bash
# ✅ CORRECT — DEV workspace / feature branch
node scripts/run-gui.js -- --port 3460

# ✅ CORRECT — LIVE workspace (default; no flag needed)
node scripts/run-gui.js
```

**Rationale:** The LIVE and DEV workspaces can run simultaneously on the same machine. Without distinct ports, a DEV GUI process silently shadows the LIVE instance (or vice versa), causing agents mid-workflow to read stale or incorrect ledger data from the wrong server.

**Anti-pattern:**
```bash
# ❌ WRONG — launching a DEV GUI on the default port while LIVE is running
node scripts/run-gui.js   # collides with the LIVE instance on port 3420
```

**Port registry:**

| Port | Workspace | When to Use |
|------|-----------|-------------|
| 3420 | LIVE (production install) | Default; leave unset for the installed, workflow-active build |
| 3460 | DEV / feature branch | Always pass `--port 3460` when running from this repository |

---

## 24. Known Limitations

| Limitation | Impact |
|------------|--------|
| No hot reload (frontend) | Must manually refresh browser after frontend JS/CSS changes. |
| No TypeScript on frontend | No type checking for client-side code. |
| Single-threaded server | No worker threads; long handler blocking affects all requests. |
| No WebSocket | Polling-based updates only; no push notifications. |
| CORS locked to localhost | Cannot access from remote machines without modification. |
| Queue file locking gap | TypeScript uses atomic rename; Python uses `.run-queue.lock`. Concurrent writes could race (low risk). |
| No authentication | Local development tool; assumes trusted network. |
| Markdown rendered without HTML sanitization | All markdown rendering (`work-package.js`, `project-detail-dialogues.js`, plan/synthesis views) passes content through `marked.parse()` without DOMPurify or equivalent. Acceptable because all rendered content is server-authored by MCP tools from agent pipelines. If the system ever accepts markdown from untrusted sources (user-submitted descriptions, external imports), a sanitization step must be added before rendering. |
