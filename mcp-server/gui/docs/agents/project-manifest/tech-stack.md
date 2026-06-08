# Tech Stack & Patterns — MCP Server GUI

---

## Runtime & Language

| Property | Backend | Frontend |
|----------|---------|----------|
| **Language** | TypeScript (ES2022, ESM) | Vanilla JavaScript (ES5-compatible patterns) |
| **Runtime** | Node.js ≥ 18 | Browser (no polyfills needed) |
| **Module System** | ESM (`import`/`export`) | Global IIFE namespaces (`var X = (function(){ … })()`) |
| **Build Step** | None (executed via `tsx`) | None (served as-is) |

---

## Backend Architecture

### HTTP Server (`server.ts`)

- **Built on:** Node.js `node:http` (raw `createServer`) — no Express, no Koa, no framework.
- **Request handling:** Manual URL parsing + segment-based route dispatch.
- **Static file serving:** Custom `serveStatic()` function with path-traversal prevention.
- **Body parsing:** Custom `readBody()` / `readJsonBody()` with streaming size limit (1 MiB).
- **Response helpers:** `sendJson()`, `sendError()` — consistent JSON envelope.

### Route Handlers (`api.ts`, `api-knowledge.ts`)

- **Pure async functions:** Each handler accepts parsed parameters and returns a result object (or throws `ApiError`).
- **No side effects on stdout:** Handlers never write to `process.stdout` (only stderr for diagnostics).
- **Validation:** Zod schemas for request body validation; regex-based slug/ID guards for path parameters.

### Process Management (`orchestrator-manager.ts`)

- **Queue reader:** Reads `.run-queue.json` written by the Python orchestrator.
- **Preflight system:** 7 readiness checks before spawning an orchestrator process.
- **Process lifecycle:** Spawn detached, SIGTERM with SIGKILL escalation, atomic queue-file writes.

### Chunk Renderer (`chunk-renderer.ts`)

- **Pure data transformation:** Parses JSONL chunk files → renders Markdown.
- **No I/O:** Accepts a string, returns a string — easily testable.

---

## Frontend Architecture

### Module Pattern

All frontend modules use the **IIFE namespace pattern**:

```javascript
var ModuleName = (function () {
  'use strict';
  // private state
  // private functions
  return { publicMethod: publicMethod };
})();
```

This avoids `let`/`const`/arrow functions to maintain ES5 compatibility across all served assets.

### Script Loading Order

Scripts are loaded synchronously via `<script>` tags in `index.html`, in dependency order:

1. `theme-init.js` — Early DOM attribute set (prevents flash of wrong theme)
2. `libs/marked.min.js` — Vendored Markdown parser
3. `api-client.js` — `API` namespace
4. `theme.js` — `Theme` namespace
5. `router.js` — `Router` namespace
6. `utils.js` — Global utility functions + `ProjectNameCache`
7. `views/*.js` — View render functions (one per page)
8. `js/orchestrator-widgets.js` — `OrchestratorWidgets` namespace
9. `stale-check.js` — `StaleCheck` namespace
10. `app.js` — Bootstrap (calls `Theme.init()`, `Router.init()`, `StaleCheck.init()`)

### Routing

- **Mechanism:** Hash-based (`window.location.hash`).
- **Dispatch:** `Router.dispatch()` matches regex patterns against the hash path.
- **Navigation:** `Router.navigate(hash)` sets `window.location.hash`.
- **Polling cleanup:** Route changes automatically clear any active polling intervals.

### Theming

- **Storage:** `localStorage` key `mcp-theme` (values: `'dark'` | `'light'`).
- **Default:** Dark theme (if no preference stored).
- **Mechanism:** `<html data-theme="dark">` attribute; CSS custom properties change values.
- **Flash prevention:** `theme-init.js` runs synchronously in `<head>` before body renders.

---

## Dependencies

### Backend (inherited from parent `mcp-server/package.json`)

| Package | Purpose |
|---------|---------|
| `zod` | Request body validation schemas |
| `proper-lockfile` | File locking (via `../src/storage/file-lock.ts`) |
| `tsx` | TypeScript execution without compilation (dev/runtime) |

### Frontend

| Library | File | Purpose |
|---------|------|---------|
| marked.js | `public/libs/marked.min.js` | Markdown → HTML rendering (plan documents, dialogues, chunks) |

No other frontend dependencies. No npm packages. No CDN imports.

---

## Serving Model

| Concern | Implementation |
|---------|----------------|
| **Port** | Default 3420, configurable via `--port` CLI flag |
| **CORS** | Restrictive: `Access-Control-Allow-Origin: http://localhost:{port}` |
| **CSP** | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |
| **Security headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` |
| **Caching** | `Cache-Control: no-store` for all static files (development tool) |
| **MIME types** | Only `.html`, `.css`, `.js` are mapped; others get `application/octet-stream` |
