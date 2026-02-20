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
- Creates `.ledger.lock` in project directory
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
- `workflow.ts` — Workflow coordination and handoff logic

---

## Build & Test

| Script | Command | Purpose |
|--------|---------|---------|
| **dev** | `npm run dev` | Run server in development mode with tsx |
| **test** | `npm test` | Run all tests once |
| **test:watch** | `npm run test:watch` | Run tests in watch mode |

No explicit build step is required for development (tsx handles TypeScript on-the-fly).

---

## Static Services

The server has **no stateful services**. All state is persisted to JSON files on disk. The server is stateless between tool invocations.

---

## Key Conventions

- **ESM-only:** All imports use `.js` extensions (required for Node16 module resolution)
- **Strict TypeScript:** `strict: true` and `noUncheckedIndexedAccess: true` in `tsconfig.json` — the latter widens all string-indexed record lookups to `T | undefined`, eliminating a class of silent runtime errors from unguarded `Record<string, T>` accesses
- **Pretty JSON:** All JSON files written with 2-space indentation and trailing newline
- **File Naming:** Work package IDs follow the pattern `WP-###` (zero-padded to 3 digits)
