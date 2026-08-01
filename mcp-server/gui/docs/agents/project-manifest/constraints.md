# Constraints & Conventions — MCP Server GUI

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

Routes in `server.ts` are declared in `buildRoutes()` and matched in declaration order by `dispatchRoute()`. `buildRoutes()` delegates to six non-exported domain sub-builders (`buildConfigRoutes`, `buildOrchestratorRoutes`, `buildRepoRoutes`, `buildKnowledgeRoutes`, `buildModelRoutes`, `buildProjectRoutes`) composed via spread. When adding a route, add it to the appropriate sub-builder. The table is organized into three sections:

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

## 17. Known Limitations

| Limitation | Impact |
|------------|--------|
| No hot reload (frontend) | Must manually refresh browser after frontend JS/CSS changes. |
| No TypeScript on frontend | No type checking for client-side code. |
| Single-threaded server | No worker threads; long handler blocking affects all requests. |
| No WebSocket | Polling-based updates only; no push notifications. |
| CORS locked to localhost | Cannot access from remote machines without modification. |
| Queue file locking gap | TypeScript uses atomic rename; Python uses `.run-queue.lock`. Concurrent writes could race (low risk). |
| No authentication | Local development tool; assumes trusted network. |
