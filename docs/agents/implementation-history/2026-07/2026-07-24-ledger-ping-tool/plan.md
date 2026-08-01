# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The strategic vision emphasizes minimizing friction in daily usage. This plan aligns with that goal by reducing token waste and surfacing stale-server failures at the start of a run rather than mid-workflow. Insight KN-0054 ("Append-only error logs used as health-check state sources produce stale UI badges when no success entry is written on recovery") reinforces the principle that health signals must be explicit and current.

## Summary
Add a lightweight `ledger_ping` MCP tool that agents can call to verify server reachability and detect stale server instances in a single zero-argument call. Currently the PM persona uses `ledger_help` as a connectivity check, which returns ~2,000 tokens of help documentation when all the agent needs is a "yes/no" signal. The new tool returns a compact JSON response (~50 tokens) including `status`, `server_version`, a `stale` boolean, and `uptime_seconds`. Update the PM preflight partial to use `ledger_ping` instead of `ledger_help`, so stale servers are caught at the very start of a run.

## Architectural Context
- **Tool registration:** Each tool lives in `mcp-server/src/tools/{name}.ts`, exports `register(server: McpServer)`, is imported as a namespace in `mcp-server/src/index.ts`, and registered in the startup block. The tool list in the startup log message is manually maintained.
- **Stale detection precedent:** `initializeProject` already compares `SERVER_VERSION` (captured at process startup) against `readPackageVersion()` (re-reads `package.json` from disk). If they differ, the dist output was rebuilt but the process wasn't restarted. The GUI uses a broader check via `captureWorkspaceVersions()` comparing all three workspace component versions.
- **Persona preflight:** The PM persona includes `{{> mcp-preflight-verify-no-detect}}` which instructs the agent to call `ledger_help` with no arguments as a reachability test. Generated persona files are never edited directly — changes go through source partials.
- **Help content:** `mcp-server/src/tools/help-content.ts` maintains the `TOOL_HELP` record with per-tool documentation.

## Approach / Architecture

### New `ledger_ping` tool
A new tool file `mcp-server/src/tools/ping.ts` following the established tool pattern. Zero input parameters. Returns a JSON response:

```typescript
{
  status: "ok",
  server_version: string,   // SERVER_VERSION from server-version.ts
  stale: boolean,            // true when readPackageVersion() !== SERVER_VERSION
  uptime_seconds: number     // process.uptime() — truncated to integer
}
```

When `stale` is `true`, an additional `stale_detail` string is included:

```typescript
{
  // ...base fields...
  stale: true,
  stale_detail: "Running v1.14.0 but dist was rebuilt as v1.14.1. Restart the MCP server."
}
```

### Persona update
The preflight partial is updated to instruct the PM to call `ledger_ping` and check the `stale` field — halting on staleness or connection failure.

## Rationale
- **Token efficiency:** `ledger_help` returns the full tool overview (~2,000+ tokens). The ping response is ~50 tokens — a 40x reduction per run.
- **Proactive stale detection:** `ledger_help` succeeds even when the server is stale — it never checks version freshness. The PM only discovers the stale server later when `initializeProject` or other tools fail. Moving the stale check to the preflight catches it immediately.
- **Minimal implementation:** Reuses existing `SERVER_VERSION` and `readPackageVersion()` infrastructure. No new dependencies, no file I/O, no lock acquisition.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Separate `ledger_ping` tool | Dedicated tool file | Add stale check to `ledger_help` response | `ledger_help` is documented as a documentation tool; adding health semantics muddies its contract. A separate tool has a clear, single responsibility. |
| MCP-server-only version check | Compare `SERVER_VERSION` vs `readPackageVersion()` | Full workspace version check via `captureWorkspaceVersions()` | The MCP server version is the only one that matters for tool correctness. Persona and orchestrator staleness don't affect the MCP protocol. The narrower check avoids filesystem reads for `personas/package.json` and `orchestrator/pyproject.toml`. |
| Zero-parameter tool | No input schema | Accept optional `verbose` flag | YAGNI — the compact response is sufficient. `ledger_help` remains available for detailed info. |

## Pattern Alignment
- Follows the standard tool pattern from `mcp-server/src/tools/help.ts` — Zod schema, handler, register export.
- Follows STDIO discipline (§7) — no stdout writes.
- Follows no-default-exports convention (§32).
- Follows `.js` import extension convention (§31).
- No departure from existing patterns.

## Detailed Steps

### Step 1 — Create `mcp-server/src/tools/ping.ts`

New tool file implementing `ledger_ping`:

- Import `SERVER_VERSION` and `readPackageVersion` from `../utils/server-version.js`.
- Define `PingSchema` as `z.object({})` (no parameters).
- Implement `async function ping()`:
  - Wrap the `readPackageVersion()` call in a try/catch. On I/O error (e.g., `package.json` momentarily absent during a rebuild), set `stale` to `null` and include `stale_detail` explaining the failure — do not let the exception propagate as an opaque MCP error. *(Design review recommendation: a health-check tool must be maximally resilient.)*
  - On success: read `diskVersion = readPackageVersion()`, compute `stale = diskVersion !== SERVER_VERSION`.
  - Build response JSON with `status: "ok"`, `server_version`, `stale`, `uptime_seconds: Math.floor(process.uptime())`.
  - When `stale` is true, add `stale_detail` string explaining the mismatch.
  - Return `{ content: [{ type: 'text', text: JSON.stringify(response) }] }`.
- Export `register(server: McpServer)` calling `server.registerTool('ledger_ping', { description, inputSchema: PingSchema.passthrough() }, ping as any)`. Use `.passthrough()` and the `as any` cast for consistency with all existing tool files (the MCP SDK has a typing limitation that requires this cast — see the `TODO` comment in `help.ts`).
- Export `_internal = { ping, PingSchema }` for testability.

### Step 2 — Register in `mcp-server/src/index.ts`

- Add `import * as pingTools from './tools/ping.js'` to the import block.
- Add `pingTools.register(server)` to the registration block.
- Update the manually-maintained tool list in the startup log message to include `ledger_ping`.

### Step 3 — Add help content in `mcp-server/src/tools/help-content.ts`

- Add a `ledger_ping` key to the `TOOL_HELP` record with a concise description.
- Add `ledger_ping` row to the overview table.

### Step 4 — Update persona preflight partial

Update `personas/ledger/src/partials/mcp-preflight-verify-no-detect.md` to instruct the PM to call `ledger_ping` instead of `ledger_help`:

```markdown
**Step 1 — Verify MCP server reachability**

Call `ledger_ping` with no arguments. Verify `status` is `"ok"` and `stale` is `false`. On failure or staleness, stop immediately:
```

### Step 5 — Update PM persona YAML metadata

Add `ledger_ping` to the `mcp_tools` array in `personas/ledger/src/meta/2-project-manager.yaml`:

```yaml
mcp_tools:
  - tool: ledger_ping
    purpose: Verify MCP server reachability and detect stale instances (preflight check).
  # ... existing tools ...
```

### Step 6 — Rebuild personas

Run `node scripts/build-personas.js` to regenerate all output files from the updated sources. Verify the PM persona output files (`vs-code/2-pm.agent.md`, `claude-code/2-project-manager.md`, `deep-agents/2-project-manager.md`) reference `ledger_ping` instead of `ledger_help` in their preflight section.

### Step 7 — Write tests

Create `mcp-server/tests/tools/ping.test.ts`:

- Test 1: `ledger_ping` returns `status: "ok"` with expected fields.
- Test 2: `ledger_ping` returns `stale: false` when versions match.
- Test 3: `ledger_ping` returns `stale: true` with `stale_detail` when versions differ (mock `readPackageVersion()`).
- Test 4: `uptime_seconds` is a non-negative integer.
- Test 5: `ledger_ping` returns `stale: null` with `stale_detail` when `readPackageVersion()` throws (mock to throw `ENOENT`).

### Step 8 — Update manifest documentation

- `mcp-server/docs/agents/project-manifest/api-surface.md`: Add `ledger_ping` tool documentation. Update tool count from "31 Total" to "32 Total". *(Note: the header already reads "30 Total" but 31 tools are registered in the startup log — correct both the existing count and add the new tool.)*
- `mcp-server/docs/agents/project-manifest/file-tree.md`: Add `ping.ts` entry under `src/tools/`.

## Dependencies
- No external dependencies. All infrastructure (`SERVER_VERSION`, `readPackageVersion()`) already exists.

## Required Components
- `mcp-server/src/tools/ping.ts` — new file
- `mcp-server/src/index.ts` — modification (import + register + log line)
- `mcp-server/src/tools/help-content.ts` — modification (add help entry + overview table row)
- `mcp-server/tests/tools/ping.test.ts` — new file
- `personas/ledger/src/partials/mcp-preflight-verify-no-detect.md` — modification
- `personas/ledger/src/meta/2-project-manager.yaml` — modification
- `mcp-server/docs/agents/project-manifest/api-surface.md` — modification
- `mcp-server/docs/agents/project-manifest/file-tree.md` — modification

## Assumptions
- The MCP SDK `registerTool` accepts a passthrough Zod schema for an empty object (`z.object({})`) — consistent with how `ledger_help` uses `z.object({ tool_name: z.string().optional() })`.
- `process.uptime()` is available in the Node.js runtime used by the MCP server (standard Node.js API, available since v0.1.100).
- The PM is the only persona that needs `ledger_ping` in its metadata; other personas reference `ledger_help` for documentation lookup purposes only.

## Constraints
- The registered-tools log line in `index.ts` L130 must be updated manually.
- Generated persona files under `personas/ledger/vs-code/`, `personas/ledger/claude-code/`, and `personas/ledger/deep-agents/` must never be edited directly — only the source partial is changed.

## Out of Scope
- Adding `ledger_ping` to non-PM personas — they don't perform connectivity preflight checks.
- Full workspace version check (personas + orchestrator versions) — only the MCP server version is relevant for tool correctness.
- Deprecating `ledger_help` — it remains valuable for detailed tool documentation.
- Adding `ledger_ping` to the GUI's stale check — the GUI has its own `/api/server-info` endpoint.

## Acceptance Criteria

- AC-01: `ledger_ping` is a registered MCP tool that accepts no parameters.
- AC-02: `ledger_ping` returns JSON with `status: "ok"`, `server_version`, `stale` (boolean or null), and `uptime_seconds` (integer). When `stale` is `null`, `stale_detail` explains the version-check failure.
- AC-03: When the running server version differs from the on-disk `package.json` version, `stale` is `true` and `stale_detail` provides a human-readable explanation.
- AC-04: When versions match, `stale` is `false` and `stale_detail` is absent.
- AC-05: The PM persona's preflight partial instructs agents to call `ledger_ping` instead of `ledger_help`.
- AC-06: The PM persona's preflight partial instructs agents to check the `stale` field and halt on staleness.
- AC-07: All existing tests continue to pass.
- AC-08: `ledger_ping` appears in `help-content.ts` overview table and has its own per-tool help entry.
- AC-09: `api-surface.md` and `file-tree.md` are updated to document the new tool.

## Testing Strategy

Unit tests using Vitest, following the pattern established in `mcp-server/tests/tools/version-freshness.test.ts` — mock `readPackageVersion()` via `vi.mock()` to control the stale/fresh state.

## Test Plan

- `mcp-server/tests/tools/ping.test.ts` — "returns ok status with version and uptime" — AC-01, AC-02
- `mcp-server/tests/tools/ping.test.ts` — "returns stale: false when versions match" — AC-04
- `mcp-server/tests/tools/ping.test.ts` — "returns stale: true with detail when versions differ" — AC-03
- `mcp-server/tests/tools/ping.test.ts` — "uptime_seconds is a non-negative integer" — AC-02
- `mcp-server/tests/tools/ping.test.ts` — "returns stale: null with detail when readPackageVersion() throws" — AC-02

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `ledger_ping` tool section; update tool count from "31 Total" to "32 Total" (current header says "30 Total" but 31 tools are already registered) — AC-09
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `ping.ts` entry under `src/tools/` — AC-09
- `mcp-server/src/tools/help-content.ts` — Add `ledger_ping` help entry + overview table row — AC-08
- Root `AGENTS.md` — No change needed (tool list is auto-derived from manifest).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`z.object({}).passthrough()` rejected by MCP SDK** | Verify with the SDK. Fallback: use `z.object({}).optional()` or match exactly how `ledger_help` defines its optional param. The SDK is known to accept passthrough schemas (see `help.ts`). |
| **PM agents ignore the `stale` field** | The preflight partial explicitly instructs the agent to check and halt on staleness. The response text also includes a clear human-readable instruction. |
| **Token count of ping response exceeds estimate** | The response is a flat JSON object with 4-5 fields — bounded at ~100 tokens worst case. No risk of token bloat. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change within well-understood patterns — a new tool file following an established template, a partial update, and doc updates. Self-review is adequate.
