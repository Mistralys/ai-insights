# Plan: Project Runner Metadata & GUI Filtering

## Summary

Capture the identity of the MCP client that initializes each project (VS Code / Claude Code / orchestrator / unknown) and persist it as a `runner` field in the project's `.meta.json` and root index. Add a runner filter to the GUI project list so users can quickly find projects run by the orchestrator vs. manual IDE sessions.

## Architectural Context

The MCP protocol requires every client to identify itself during the initialization handshake via `clientInfo: { name: string, version: string }`. The MCP SDK stores this on the `Server` instance and exposes it via `server.server.getClientVersion()` (returns `Implementation | undefined`). Currently, none of the MCP server's tool handlers access client identity — they receive only the parsed tool arguments.

The SDK's `registerTool` callback signature is `(args, extra) => Promise<CallToolResult>`, where `extra: RequestHandlerExtra` contains `sessionId`, `signal`, `authInfo`, `requestId`, and `_meta`. However, `extra` does **not** directly include `clientInfo` — that's on the `Server` instance, not per-request. Since the MCP server uses STDIO transport (single client per process), `getClientVersion()` reliably identifies the connected client for the lifetime of the server process.

Known MCP client identity strings (the `name` field):
- **VS Code:** `"Visual Studio Code"` or similar (from GitHub Copilot's MCP client)
- **Claude Code:** `"claude-code"` or `"Claude"` (Anthropic's CLI)
- **Orchestrator:** `"langchain-mcp-adapters"` (the Python MCP client library used by the orchestrator)

The GUI project list ([mcp-server/gui/public/views/project-list.js](mcp-server/gui/public/views/project-list.js)) already has a mature filter/sort infrastructure: status dropdown with dynamic counts, text search, 7 sortable columns, and server-side pagination. Adding a runner filter follows the same patterns.

Key files:
- `mcp-server/src/index.ts` — MCP server creation, `McpServer` instance
- `mcp-server/src/tools/project-lifecycle.ts` — `initializeProject` handler, `register()` function
- `mcp-server/src/schema/project-meta.ts` — `ProjectMetaSchema`
- `mcp-server/src/schema/root-index.ts` — `RootIndexSchema`
- `mcp-server/src/storage/ledger-store.ts` — `LedgerStore` class, `writeProjectMeta()`
- `mcp-server/gui/api.ts` — `handleListProjects`, filtering/sorting logic
- `mcp-server/gui/server.ts` — route matching, query parameter parsing
- `mcp-server/gui/public/views/project-list.js` — project list view with filter UI
- `mcp-server/gui/public/api-client.js` — `getProjects()` method

## Approach / Architecture

### Client identity capture

The MCP server's `Server` instance (accessible via `mcpServer.server`) stores the client identity after the handshake completes. Since the server uses STDIO transport (one client per process), `server.getClientVersion()` is stable for the entire session.

Rather than passing client info through every tool handler's `extra` parameter, we expose a module-level accessor that the `initializeProject` handler calls at project creation time. This minimizes the blast radius — only the initialization tool needs client info.

### Runner classification

Raw client names vary by version and platform. We normalize them into a stable enum:

| Raw `clientInfo.name` pattern | Normalized `runner` |
|-------------------------------|---------------------|
| Contains `"Visual Studio Code"` or `"vscode"` | `"vscode"` |
| Contains `"claude"` (case-insensitive) | `"claude-code"` |
| Contains `"langchain"` or `"mcp-adapters"` | `"orchestrator"` |
| Anything else | `"unknown"` |

The raw `clientInfo.name` and `clientInfo.version` are also stored for diagnostics.

### Schema changes

Add to both `ProjectMetaSchema` and `RootIndexSchema`:

```typescript
runner: z.enum(['vscode', 'claude-code', 'orchestrator', 'unknown']).optional()
runner_client: z.string().optional()   // raw clientInfo.name
runner_version: z.string().optional()  // raw clientInfo.version
```

All three fields are optional for backward compatibility — existing projects without them are treated as `runner: undefined` (shown as "—" in the GUI).

### GUI filter

Add a "Runner" dropdown to the project list header, alongside the existing status filter. The dropdown options are derived from the server response (like status counts), showing only runners that have projects.

## Rationale

- **Module-level accessor over per-handler context:** The STDIO transport guarantees a single client per server process, so `getClientVersion()` is unambiguous. Threading client info through every handler would require modifying all 19 tool handlers — massive churn for a property used only at initialization.
- **Normalized enum over raw strings:** Client name strings change across versions. A stable enum makes filtering reliable and avoids UI fragmentation ("Visual Studio Code" vs "vscode" vs "VS Code").
- **Storing raw values alongside enum:** Preserves diagnostic detail (which exact VS Code version? which orchestrator client library version?) without affecting the filtering UX.
- **Optional fields:** Backward compatible — no migration needed for existing projects.

## Detailed Steps

### 1. Expose client identity accessor on the MCP server

- In `mcp-server/src/index.ts`, after creating the `McpServer` instance, export a function `getClientInfo()` that returns `server.server.getClientVersion()` (the `Implementation` object from the SDK).
- This is a simple module-level getter — no changes to transport or initialization logic.

### 2. Add runner classification utility

- Create a `classifyRunner(clientInfo)` function in `mcp-server/src/utils/runner.ts`
- Input: `Implementation | undefined` (the SDK's `{ name, version }` type)
- Output: `{ runner: 'vscode' | 'claude-code' | 'orchestrator' | 'unknown', runner_client: string, runner_version: string }`
- Pattern matching on `clientInfo.name` (case-insensitive substring checks)
- When `clientInfo` is undefined, return `{ runner: 'unknown', runner_client: '', runner_version: '' }`

### 3. Update project schemas

- In `mcp-server/src/schema/project-meta.ts`, add `runner`, `runner_client`, and `runner_version` as optional fields to `ProjectMetaSchema`
- In `mcp-server/src/schema/root-index.ts`, add the same three fields to `RootIndexSchema`
- Both use `.optional()` for backward compatibility

### 4. Update `initializeProject` handler

- In `mcp-server/src/tools/project-lifecycle.ts`, import `getClientInfo` and `classifyRunner`
- In the `initializeProject` function, after creating the `rootIndex` object, call `classifyRunner(getClientInfo())` and spread the result into the root index
- Also pass the runner fields to `store.writeProjectMeta()` so `.meta.json` gets them

### 5. Add `runner` to project list API

- In `mcp-server/gui/api.ts`, update `handleListProjects` to:
  - Include `runner` in the `ProjectSummary` type returned to the frontend
  - Accept a `runner` query parameter (optional, filters by normalized runner value)
  - Compute `runner_counts` (similar to `status_counts`) for the dropdown

### 6. Add `runner` query parameter to route parsing

- In `mcp-server/gui/server.ts`, add `runner: sp.get('runner') ?? undefined` to the params object for GET /api/projects

### 7. Add runner filter to GUI project list

- In `mcp-server/gui/public/views/project-list.js`:
  - Add a "Runner" dropdown next to the status filter
  - Options: "All" (default), plus dynamic options from server response (`runner_counts`)
  - Display labels: "VS Code", "Claude Code", "Orchestrator", "Unknown"
  - Persist selection in localStorage (same pattern as status filter)
  - Pass `runner` parameter to `getProjects()`

### 8. Add runner column to project table

- In `mcp-server/gui/public/views/project-list.js`, add a "Runner" column showing a badge or icon for the runner type
- Make it sortable (add to `SORT_FIELDS` in `api.ts`)

### 9. Update API client

- In `mcp-server/gui/public/api-client.js`, ensure the `runner` parameter is included in the query string when present

### 10. Tests

- **Unit test** for `classifyRunner()` — verify all known client name patterns map correctly, unknown names return `'unknown'`, undefined input returns `'unknown'`
- **Unit test** for `initializeProject` — verify runner fields are written to both root index and `.meta.json`
- **Unit test** for `handleListProjects` — verify runner filtering and runner_counts computation
- **Schema tests** — verify backward compatibility (existing projects without runner fields parse without error)

## Dependencies

- MCP SDK's `Server.getClientVersion()` must be callable after the handshake completes (before any tool calls — guaranteed by the MCP protocol lifecycle)
- The STDIO transport must provide stable client identity for the session (guaranteed by the single-client-per-process model)

## Required Components

### New files
- `mcp-server/src/utils/runner.ts` — `classifyRunner()` function
- `mcp-server/tests/utils/runner.test.ts` — unit tests

### Modified files
- `mcp-server/src/index.ts` — export `getClientInfo()` accessor
- `mcp-server/src/schema/project-meta.ts` — add runner fields
- `mcp-server/src/schema/root-index.ts` — add runner fields
- `mcp-server/src/tools/project-lifecycle.ts` — call `classifyRunner()` in `initializeProject`
- `mcp-server/gui/api.ts` — runner filter + counts in `handleListProjects`
- `mcp-server/gui/server.ts` — parse `runner` query parameter
- `mcp-server/gui/public/views/project-list.js` — runner dropdown + column
- `mcp-server/gui/public/api-client.js` — pass `runner` parameter

## Assumptions

- The MCP SDK's `getClientVersion()` returns the client's self-reported identity from the `initialize` handshake. The values listed in this plan (VS Code, Claude Code, langchain-mcp-adapters) are based on known client implementations — the actual strings should be verified during development by logging `getClientVersion()` output from each client.
- The STDIO transport guarantees single-client-per-process, making the module-level accessor safe.
- Existing projects without runner metadata will display "—" or "Unknown" in the GUI without errors.

## Constraints

- **No breaking schema changes** — all new fields are optional, existing `.meta.json` and `project-ledger.json` files parse without modification.
- **STDIO discipline** — no stdout writes. Logging of client identity goes to stderr only.
- **MCP server scope only** — this feature does not require orchestrator changes. The orchestrator is identified passively via its MCP client library's name.

## Out of Scope

- Retroactively tagging existing projects with runner metadata (they'll show as "Unknown")
- Per-tool-call client tracking (only project initialization captures the runner)
- Multi-client support (Streamable HTTP transport with multiple simultaneous clients would need per-session tracking — not relevant for STDIO)
- Runner-based access control or permissions

## Acceptance Criteria

- When a project is initialized via VS Code, `.meta.json` and `project-ledger.json` contain `runner: "vscode"`, `runner_client`, and `runner_version`
- When a project is initialized via the orchestrator, runner is `"orchestrator"`
- When a project is initialized via Claude Code, runner is `"claude-code"`
- Existing projects without runner fields load without errors and show "—" in the GUI
- The GUI project list has a "Runner" dropdown that filters projects by runner
- The "Runner" dropdown shows dynamic counts (e.g. "VS Code (12)", "Orchestrator (3)")
- The project table includes a "Runner" column that is sortable

## Testing Strategy

- **Unit tests** for `classifyRunner()`: cover all known client patterns, edge cases (empty string, undefined, unexpected names)
- **Unit tests** for `initializeProject`: mock `getClientInfo()`, verify runner fields in written output
- **Unit tests** for `handleListProjects`: verify runner filtering, counts, and backward compat with runner-less projects
- **Schema tests**: verify `.optional()` fields parse correctly when absent

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Client name strings change across versions** | Match on substrings, not exact equality. Store raw values alongside the normalized enum for future remapping. |
| **`getClientVersion()` returns undefined** | Handled gracefully — classifyRunner returns `'unknown'`. All fields optional. |
| **New MCP client types appear** | The catch-all `'unknown'` ensures no breakage. Add new patterns to `classifyRunner()` as needed. |
| **STDIO assumption breaks with future transport changes** | Current architecture is STDIO-only. If Streamable HTTP is added, the accessor would need per-session scoping — flagged as out of scope. |
