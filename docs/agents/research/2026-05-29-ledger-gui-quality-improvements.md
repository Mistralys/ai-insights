# Research Report

## DX Improvement Overview

| # | Recommendation | Current Pain | After |
|---|----------------|--------------|-------|
| 1 | **SSE Event Stream** (`/api/events`) | You wait 3–30s staring at stale data before the polling interval fires. During orchestrator runs you can't tell if the system is stuck or just hasn't polled yet. | Changes appear in <100ms. Pipeline completions, queue updates, and log lines push instantly — no more "frozen or polling?" ambiguity. |
| 2 | **Dev-Mode Auto-Reload** (`--dev`) | Every CSS/JS tweak requires: save → alt-tab → F5 → wait → navigate back to the view you were testing. Dozens of manual refreshes per session. | Save the file, the browser reloads automatically. Feedback loop drops from ~5s of manual action to ~200ms. |
| 3 | **Typed API Client** (JSDoc + `.d.ts`) | No way to know which views consume a field or whether the client assumes the wrong shape. Property typos are silent runtime bugs found only by manual testing. | VS Code highlights type mismatches inline. Autocomplete shows all response fields. Renaming a server field surfaces all client breakage as red squiggles immediately. |
| 4 | **Template Literal Helper** (`html` tag) | Every dynamic value needs `escapeHtml()`. Forgetting one is a potential XSS. String-concatenated HTML with nested quotes obscures template structure. | Write `html\`<div>${value}</div>\`` — escaping is automatic. Templates are readable. An entire class of security bugs becomes impossible by construction. |
| 5 | **Playwright Smoke Tests** | jsdom tests can't catch broken hrefs, CSS class typos that hide sections, race conditions, or navigation flows that break when views chain together. | 3–5 tests exercise the actual user journey in a real browser. Rendering and navigation regressions are caught automatically; refactor with confidence. |
| 6 | **Route Dispatch Refactor** | Adding an endpoint means finding the right spot in a 1500-line if/else chain, duplicating 10+ lines of guards, and hoping you didn't shadow an existing route. | A new route is one line in a declarative table. Conflicts are caught at startup. Guard logic is applied uniformly by the dispatcher. |

---

## Problem Statement

Identify developer-experience (DX) improvements for the Project Ledger MCP server and its GUI dashboard — covering both the inner-loop workflow (developing the GUI itself) and the outer-loop experience (using the GUI to monitor and manage ledger projects).

## Problem Decomposition

1. **GUI frontend architecture modernization** — the current plain-JS SPA with string-concatenated HTML.
2. **Real-time data delivery** — polling-based updates vs. push-based alternatives.
3. **Frontend developer tooling** — build pipeline, hot-reload, type safety.
4. **API ergonomics** — route dispatch, schema sharing, documentation.
5. **Testing DX** — GUI test workflow and coverage gaps.
6. **Operational UX** — features that improve the day-to-day experience of using the dashboard.

## Context & Constraints

- **Tech stack:** Node.js HTTP server (no framework), TypeScript backend, vanilla JS frontend (no build step). Single external lib (`marked.min.js`). Zero-dependency GUI philosophy.
- **Architecture:** Hash-based SPA router (`router.js`), IIFE-scoped modules, global function dispatch (`renderProjectList`, `renderProjectDetail`, etc.), HTML via string concatenation.
- **Data delivery:** All updates via `setInterval` polling (3s for orchestrator log preview, 30s for stale-check, router-scoped polling for project list).
- **Security posture:** CSP `script-src 'self' 'unsafe-inline'`, CORS locked to same-origin, security headers applied. Path-traversal guards on all URL params.
- **Test coverage:** 26 GUI-specific test files using Vitest + jsdom for server-side handlers and client-rendering. No end-to-end browser tests.
- **Scale:** ~15 view/module JS files, ~1 CSS file, ~1500-line server router with 40+ route branches.
- **Hard constraint:** Zero production dependencies beyond the three in `package.json` (`@modelcontextprotocol/sdk`, `zod`, `proper-lockfile`). The GUI server is started via `tsx gui/server.ts` — no bundler, no transpiler for frontend code.
- **Users:** Primarily the developer themselves — this is a local-first tool, not a public-facing app.

## Prior Art & Known Patterns

### Pattern 1: Server-Sent Events (SSE) for Real-Time Updates

- **Description:** A unidirectional push channel from server to browser using the `EventSource` API. The server holds an HTTP connection open and streams newline-delimited events. No library needed on either side.
- **Where used:** GitHub Actions live log streaming, Vercel build logs, many MCP server implementations (the MCP SDK itself uses SSE as a transport option).
- **Strengths:** Zero dependencies. Works with existing HTTP infrastructure. Automatic reconnection built into the browser API. Compatible with the current CSP (`connect-src 'self'`). Trivially implementable in Node.js with raw `http.ServerResponse`.
- **Weaknesses:** Unidirectional (server→client only). Limited to ~6 concurrent connections per domain in HTTP/1.1 (irrelevant for a local-only tool). No binary support.
- **Fit:** Excellent. Replaces all three polling loops (stale-check, orchestrator queue, run-log live tail) with a single SSE stream. The server already watches the config file (`startConfigWatcher`); extending this to push project-change notifications is natural.

### Pattern 2: Lightweight Frontend Framework Migration (Preact/Lit)

- **Description:** Replace string-concatenated HTML with a tiny framework that provides declarative rendering, component encapsulation, and reactive state. Preact (3KB gzipped) and Lit (5KB) are the two smallest options with full ecosystem support.
- **Where used:** Preact: many performance-sensitive dashboards (Shopify, Uber internal). Lit: Google web components across multiple products.
- **Strengths:** Eliminates the largest source of GUI bugs (manual DOM manipulation, innerHTML XSS vectors, event-listener cleanup). Enables component-level testing. Both are well-understood by LLMs (high training-data presence). Lit's web components work without a bundler.
- **Weaknesses:** Adds a build step or increases the vendor JS bundle. Requires a migration effort for all 7 view files. Preact requires JSX/HTM transpilation (or uses `h()` calls). Lit requires import maps or a bundler for ESM.
- **Fit:** Medium-high long term; high initial migration cost. The current 7 views would benefit from component boundaries but the codebase is maintainable as-is given its single developer.

### Pattern 3: TypeScript Shared Types (API Contract)

- **Description:** Generate or share TypeScript types between the server's Zod schemas and the client. Approaches: (a) auto-generate an OpenAPI spec from Zod schemas, then generate a typed client; (b) export `.d.ts` files and use them with JSDoc annotations in the client JS; (c) convert client JS to TS and add a build step.
- **Where used:** tRPC, Hono RPC, Zod-to-OpenAPI pipelines.
- **Strengths:** Eliminates a class of bugs where the client assumes a different shape than what the server returns. Enables IDE autocomplete in the API client. Catches regressions at compile time.
- **Weaknesses:** Approaches (a) and (c) require a build step for the frontend. Approach (b) is partial (no runtime enforcement). All approaches add project complexity.
- **Fit:** High value if a frontend build step is introduced; lower ROI with the current zero-build philosophy.

### Pattern 4: Dev-Mode Auto-Reload

- **Description:** Inject a tiny script or use a separate livereload server that triggers a browser refresh whenever a frontend file changes. Common patterns: (a) livereload protocol (separate WebSocket); (b) inline `<script>` that polls a `/dev/reload` endpoint; (c) Vite-style HMR.
- **Where used:** Every modern frontend framework's dev server, `browser-sync`, `livereload` npm package.
- **Strengths:** Drastically reduces the "change → save → alt-tab → F5 → wait" cycle. The simplest implementation is 15 lines of `fs.watch()` + an SSE endpoint that the client listens to.
- **Weaknesses:** Only useful during development. Must be disabled in production. Adds cognitive overhead if overly complex (Vite HMR).
- **Fit:** Excellent. Can piggyback on the SSE infrastructure from Pattern 1 — a `reload` event type on the same connection. The server already has `fs.watch()` (`startConfigWatcher`) so the mechanism exists.

### Pattern 5: OpenAPI / API Documentation Generation

- **Description:** Auto-generate an API spec from the existing route definitions and Zod schemas. Tools: `zod-to-openapi`, or a custom script that walks the `matchRoute()` function and emits an OpenAPI YAML.
- **Where used:** Any API-first team. Stoplight, Redocly, FastAPI (Python equivalent).
- **Strengths:** Provides a single-source-of-truth reference for all GUI API endpoints. Enables Swagger UI for interactive testing. Helps future contributors understand the 40+ endpoints without reading 1500 lines of router code.
- **Weaknesses:** The current hand-rolled router makes automatic extraction non-trivial. Maintaining it manually duplicates effort.
- **Fit:** Medium. The `api-surface.md` manifest already documents routes, but an interactive, type-checked spec would be more useful for development.

### Pattern 6: End-to-End Testing with Playwright

- **Description:** Add browser-level integration tests that exercise the actual GUI in a headless browser. Complements the existing jsdom unit tests which cannot test real rendering, CSS, or navigation.
- **Where used:** Industry standard for SPA testing. Playwright recommended by Vitest docs for E2E alongside unit tests.
- **Strengths:** Catches rendering regressions, broken navigation, and timing bugs that jsdom cannot. Playwright's trace viewer provides visual debugging. Fast on modern machines (~200ms per test).
- **Weaknesses:** Requires launching a real server + browser process. Flakiness risk on CI without careful timeout management. Additional devDependency.
- **Fit:** High. The current test suite covers handler logic but not the client-side rendering or interaction flows. A small Playwright suite covering the critical path (list → detail → WP) would catch integration issues.

## Alternative & Creative Approaches

### Approach A: "Hybrid SSE + Targeted Refactors" (Incremental)

Rather than a framework migration, make three surgical changes:

1. **Add an SSE `/api/events` endpoint** that pushes `project-changed`, `queue-updated`, `log-appended`, and `reload` events. Remove all `setInterval` polling from client code. The SSE stream uses `fs.watch()` on the ledger root and orchestrator logs directory to detect changes and pushes lightweight event payloads.

2. **Extract a micro component helper** (≤50 LOC, no dependency) that provides `html` tagged template literals with auto-escaping and a `render(container, templateResult)` function. This eliminates XSS risk from string concatenation without requiring a framework. Similar to `µhtml` or `htm` in spirit.

3. **Add a `--dev` flag** to the GUI server that enables: file-watching with SSE reload events, source maps for easier debugging, and verbose error logging in the browser console.

- **Rationale:** Preserves the zero-dependency, no-build-step philosophy while addressing the three biggest pain points (polling latency, XSS-prone templates, no auto-reload).
- **Risk:** The micro template helper becomes a maintenance burden if it grows beyond basic interpolation.

### Approach B: "Dashboard as VS Code Webview" (Native IDE Integration)

Instead of a standalone HTTP server + browser tab, embed the dashboard as a VS Code webview panel. The webview communicates with the MCP server via the extension host, eliminating the need for an HTTP server entirely.

- **Rationale:** The primary user is a VS Code user. A webview lives inside the IDE, reducing context switching. It can use the VS Code theming system for free. The extension can listen to workspace file-change events and push updates instantly.
- **Risk:** Requires building and maintaining a VS Code extension. Locks out non-VS Code users (Claude Code, terminal-only workflows). Significant scope expansion.

### Approach C: "CLI Dashboard" (TUI Alternative)

Add a terminal-based dashboard using a tool like `blessed` or `ink` (React for CLI). Shows project status, pipeline progress, and orchestrator queue in a terminal-native split view.

- **Rationale:** For developers who prefer terminal workflows, a TUI is faster to launch and lighter on resources than a browser tab. The orchestrator is already CLI-driven.
- **Risk:** Higher maintenance burden (two UIs). Limited rendering capabilities. Ink adds a React dependency.

## Comparative Evaluation

| Criterion | SSE + Targeted Refactors (A) | Preact/Lit Migration (2) | VS Code Webview (B) | CLI Dashboard (C) |
|-----------|------|------|------|------|
| **Complexity** | Low | High | Very High | Medium |
| **Performance gain** | High (eliminates polling) | Medium (virtual DOM) | High (native IPC) | N/A |
| **DX improvement** | High | Very High | Medium | Low |
| **Maintainability** | High (stays simple) | High (components) | Medium (extension API churn) | Low (two UIs) |
| **Migration risk** | Very Low | Medium | High | Low |
| **Time to implement** | Days | Weeks | Weeks-Months | Weeks |
| **Dependency cost** | Zero | +1 (Preact/Lit) | +VS Code extension scaffold | +1-2 (blessed/ink) |
| **Zero-dep philosophy** | ✅ Preserved | ❌ Broken | ❌ New project | ❌ Broken |

## Recommendation

Pursue **Approach A: "Hybrid SSE + Targeted Refactors"** — it delivers the highest DX improvement per unit of effort while preserving the project's zero-dependency, no-build-step philosophy.

### Specific deliverables (priority order):

1. **SSE event stream (`/api/events`)** — Push-based updates replace polling. Events: `project:changed`, `queue:updated`, `log:line`, `server:reload`. Client subscribes with `new EventSource('/api/events')`. Server uses `fs.watch()` on the ledger root directory tree and orchestrator logs. Expected impact: eliminates 3 polling loops, reduces update latency from 3-30s to <100ms, and reduces server load.

2. **Dev-mode auto-reload** — Add `--dev` flag to the GUI server. When enabled, file changes in `gui/public/` emit a `reload` event on the SSE stream. A 10-line snippet in `app.js` (gated behind a `<meta name="dev-mode">` tag injected only in dev) calls `location.reload()` on receiving it. Expected impact: eliminates manual F5 during GUI development.

3. **Typed API client (JSDoc + `.d.ts`)** — Export TypeScript types for API response shapes from Zod schemas into a `gui/public/types.d.ts` file. Annotate `api-client.js` with `@type` JSDoc comments referencing these types. No build step needed — VS Code infers types from JSDoc+d.ts without compilation. Expected impact: IDE autocomplete and compile-time safety for API shape mismatches.

4. **Template literal helper** — A ≤50-line `html` tagged-template function in a new `gui/public/dom.js` that auto-escapes interpolated values and returns DOM nodes or HTML strings safely. Migrate one view (e.g., `config.js`, the simplest) as a proof-of-concept. Expected impact: eliminates `escapeHtml()` calls and reduces XSS surface area.

5. **Playwright smoke tests** — Add 3-5 E2E tests covering: project list loads, project detail shows WPs, orchestrator view shows queue. Run with `npm run test:e2e` using a test ledger fixture. Expected impact: catches rendering regressions that jsdom tests cannot.

6. **Route dispatch refactor** — Extract the 1500-line `matchRoute()` into a declarative route table (array of `{ method, pattern, handler }` objects). Pattern matching via a simple regex or segment-count dispatch. Expected impact: new routes become one-liners; route conflicts become impossible.

### Proof-of-Concept Outline (SSE Event Stream)

1. Add `gui/events.ts` — module that manages SSE connections (set of open `ServerResponse` objects) and a broadcast function.
2. In `gui/server.ts`, handle `GET /api/events` by setting appropriate headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) and registering the response in the events module.
3. Add `fs.watch()` on `ledgerRoot` (recursive, with debounce) — on change, broadcast `{ event: 'project:changed', data: { slug } }`.
4. In the orchestrator manager, after queue-file reads detect changes, broadcast `{ event: 'queue:updated' }`.
5. Client-side: replace `setInterval` in `stale-check.js`, `orchestrator-widgets.js`, and `orchestrator.js` with `EventSource` listeners that trigger the same refresh functions on event receipt.

## Open Questions

- **fs.watch() reliability:** Node.js `fs.watch()` has known platform differences (macOS uses `kqueue`, Linux uses `inotify`). Recursive watching on Linux requires Node.js 19+. The GUI server already targets Node.js 18+ — verify recursive watch support or fall back to polling a directory listing on Linux.
- **SSE connection limits:** HTTP/1.1 browsers limit concurrent connections to ~6 per origin. With a single SSE connection, this leaves 5 for parallel API fetches — sufficient for the current GUI but worth documenting.
- **Scope of template helper:** Should it support conditional rendering and loops, or only safe interpolation? Keeping it interpolation-only avoids scope creep; loops and conditionals remain in plain JS.
- **Playwright CI integration:** The GUI server needs a real ledger fixture directory to serve data. Decide whether to commit a small test fixture or generate it in a `beforeAll` hook.

## References

- MDN: Server-Sent Events — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- Node.js `fs.watch()` documentation — https://nodejs.org/api/fs.html#fswatchfilename-options-listener
- µhtml (micro HTML template library, inspiration) — https://github.com/WebReflection/uhtml
- Playwright Test — https://playwright.dev/docs/intro
- Zod to OpenAPI — https://github.com/asteasolutions/zod-to-openapi
- Current GUI test suite — `mcp-server/tests/gui/` (26 files)
- Current polling implementations — `stale-check.js` (30s), `orchestrator-widgets.js` (3s), `orchestrator.js` (queue refresh)
