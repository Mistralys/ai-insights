# Tech Stack & Patterns

## Runtime & Language

| Component | Version | Notes |
|-----------|---------|-------|
| **Runtime** | Node.js | ESM module system |
| **Language** | TypeScript 5.7.2 | Strict mode enabled |
| **Target** | ES2022 | Node16 module resolution |
| **Package Manager** | npm | Standard Node.js tooling |

---

## Core Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.4 | MCP server implementation and STDIO transport |
| `zod` | ^3.24.1 | Runtime schema validation and type inference |
| `proper-lockfile` | ^4.1.2 | Cross-platform file locking with retry logic |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `tsx` | ^4.19.2 | TypeScript execution for development |
| `vitest` | ^2.1.8 | Unit and integration testing framework |
| `typescript` | ^5.7.2 | TypeScript compiler |
| `@types/node` | ^22.10.5 | Node.js type definitions |

---

## Architectural Patterns

### 1. **MCP Server Architecture**

The application is structured as an **MCP (Model Context Protocol) server** that:
- Runs as a standalone process communicating via STDIO
- Registers multiple tools (17 total) that agents can invoke
- Returns structured JSON responses conforming to MCP specification
- Logs diagnostics to `stderr` (never `stdout`, which is reserved for protocol)

**Key Files:**
- `src/index.ts` — Server initialization and tool registration

---

### 2. **Repository Pattern**

`LedgerStore` class provides a **central storage abstraction** with:
- Validated reads (all JSON is parsed and validated with Zod)
- Atomic writes (write-to-temp-then-rename pattern)
- Path management (encapsulates all file path logic)
- Dual-file synchronization (updates both root index and work package atomically)

**Key Files:**
- `src/storage/ledger-store.ts`

---

### 3. **Atomic Write Pattern**

All file writes use the **write-to-temp-then-rename pattern**:
1. Write JSON to `{filePath}.tmp.{pid}`
2. Use `fs.rename()` to atomically replace target file (POSIX semantics)
3. Clean up temp file on error

This ensures readers never see partial writes.

**Key Files:**
- `src/storage/atomic-writer.ts`

---

### 4. **File Locking for Concurrency**

`withLock()` utility provides **distributed file locking**:
- Creates `.ledger.lock` in the storage directory (`store.storageDir`) — never in the plan directory
- Retries lock acquisition (5 retries, 200ms intervals)
- Stale lock detection (10 second timeout)
- Always releases lock in `finally` block

**Key Files:**
- `src/storage/file-lock.ts`

---

### 5. **Schema-First Design**

All data structures are defined as **Zod schemas first**:
- TypeScript types are inferred from schemas (`z.infer<typeof Schema>`)
- Runtime validation on all reads and writes
- Centralized schema definitions in `src/schema/`

**Key Files:**
- `src/schema/work-package.ts`
- `src/schema/root-index.ts`
- `src/schema/enums.ts`
- `src/schema/validators.ts`

---

### 6. **Tool Registration Pattern**

Each tool category has its own module with:
- Zod input schemas for tool parameters
- Async handler functions
- A `register(server: McpServer)` export that registers all tools

**Tool Modules:**
- `project-lifecycle.ts` — Project initialization and status
- `work-package.ts` — Work package CRUD operations
- `pipeline.ts` — Pipeline start/complete operations
- `observations.ts` — Comment and observation tracking
- `workflow.ts` — Thin aggregator; delegates to the three sub-modules below
- `workflow-next-action.ts` — ledger_get_next_action and ledger_get_next_actions (batch) logic
- `workflow-handoff.ts` — ledger_get_handoff_status logic
- `help-content.ts` — Static TOOL_HELP documentation strings (extracted from help.ts)

---

### 7. **GUI Dashboard Server**

The GUI is implemented as a **separate HTTP server process** from the MCP server:
- **Entry point:** `gui/server.ts`, started via `npm run gui`
- **Port:** 3420 (default), configurable via `--port <n>`
- **Transport:** Plain `node:http` — no Express or other HTTP framework dependency
- **Static serving:** Files from `gui/public/` — vanilla HTML/CSS/JS, no build step required
- **Process isolation:** The GUI server and the MCP server (STDIO) run as independent processes. Both share the same ledger root directory.
- The GUI server resolves the ledger root the same way as the MCP server (`resolveLedgerRoot()` / `--ledger-dir`).

**Key Files:**
- `gui/server.ts` — HTTP server, route dispatch, static file serving
- `gui/api.ts` — Pure async handler functions (one per REST endpoint)
- `gui/public/` — Static dashboard assets (no build step)

**Theme / Dark Mode:**
- `styles.css` exposes a `[data-theme="dark"]` attribute block immediately after `:root`, overriding all 8 CSS custom properties. A separate hardcoded-hex overrides section covers badge variants, table hover, banners, health badges, and filter form controls.
- `index.html` contains a synchronous FOUC-prevention `<script>` in `<head>` that applies the saved theme before first paint (defaults to dark; light only if `localStorage` key `mcp-theme` is explicitly `'light'`).
- `app.js` `Theme` IIFE (section 2) manages `localStorage` persistence and wires the `#theme-toggle` button. `Theme.init()` is called before `Router.init()` in the bootstrap sequence.

---

### 8. **Runtime Config Monitoring**

Runtime-adjustable settings are managed via a **module-level singleton cache** backed by `fs.watch()`:
- **Config file:** `{ledgerRoot}/gui-config.json`
- **Schema:** `GuiConfigSchema` in `src/gui/config.ts` (`auto_handoff_enabled`, `max_handoff_depth`, `ledger_root`)
- **Cache:** Module-level `_cache` populated at startup by `readConfigFromDisk()` and kept live by `startConfigWatcher()`
- **`getConfig()`** is always synchronous — reads from memory only, never disk
- **Debounce:** 250ms on the `fs.watch()` callback to suppress Windows duplicate-event noise
- **Fallback:** On watcher error or file parse failure, the cache retains its last known good values — the server continues operating rather than crashing
- **`ledger_root` is read-only:** `writeConfig()` strips `ledger_root` from incoming data; only startup sets it

**Key Files:**
- `src/gui/config.ts` — `GuiConfigSchema`, `getConfig()`, `readConfigFromDisk()`, `writeConfig()`, `startConfigWatcher()`, `stopConfigWatcher()`

---

### 9. **Dual-Caller Store Overload Pattern**

Some internal functions in `src/tools/work-package.ts` must be callable by two different callers:
1. **Top-level MCP tool handlers** — which have a `projectPath: string` but no open store.
2. **Internal callers** — which already hold a `LedgerStore` and must not construct another one (to avoid redundant I/O and potential double-locking).

The pattern uses a **discriminated union** as the last parameter:

```typescript
// Shared signature used by propagateDependencyUnblock and propagateDependencyReblock
function example(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void>;
```

A private module helper `resolveStore()` (not exported) encapsulates the disambiguation:

```typescript
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore {
  if (typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null) {
    return ledgerRootOrOpts.store;   // ← pre-built store from internal caller
  }
  return new LedgerStore(projectPath, ledgerRootOrOpts);  // ← construct from path
}
```

**When to apply this pattern:** Any function that (a) owns a lock-protected workflow and (b) is called both by top-level tools and by other internal functions that already hold a store. Do not inline the ternary — extract it into a private `resolveXxx()` helper following this convention.

**Key File:** `src/tools/work-package.ts` — `resolveStore()`

---

## Build & Test

| Script | Command | Purpose |
|--------|---------|----------|
| **build** | `npm run build` | Compile TypeScript to `dist/` for production use |
| **dev** | `npm run dev` | Run server in development mode with tsx |
| **pretest** | *(auto)* | Runs `node ../scripts/build-personas.js --check` before every test run — exits 1 if any generated persona file is stale, blocking the test run. This is **one of two** enforcement layers: (1) `pretest` fires when running `npm test` from `mcp-server/`; (2) the `.githooks/pre-commit` hook fires on every commit regardless of which sub-project was touched. Run `node scripts/install-hooks.js` once after cloning to activate the hook. |
| **test** | `npm test` | Run all tests once (pretest fires first) |
| **test:watch** | `npm run test:watch` | Run tests in watch mode |

No explicit build step is required for development (tsx handles TypeScript on-the-fly).
For production or CI, run `npm run build` — compilation fails immediately on any type error (`noEmitOnError: true`) and no output is written to `dist/`.

---

## Static Services

The server has **no stateful services**. All state is persisted to JSON files on disk. The server is stateless between tool invocations.

---

## Key Conventions

- **ESM-only:** All imports use `.js` extensions (required for Node16 module resolution)
- **Strict TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `noEmitOnError: true`, and `noUnusedLocals: true` in `tsconfig.json` — `noUncheckedIndexedAccess` widens all string-indexed record lookups to `T | undefined`, eliminating a class of silent runtime errors; `noEmitOnError` prevents any JS from being emitted to `dist/` when type errors are present, ensuring the build fails fast rather than producing a partially compiled output; `noUnusedLocals` makes dead imports and unused variables hard compile errors, preventing structural noise from accumulating silently after refactors
- **Pretty JSON:** All JSON files written with 2-space indentation and trailing newline
- **File Naming:** Work package IDs follow the pattern `WP-###` (minimum 3 digits; no upper bound — supports `WP-001` through `WP-9999+`)
