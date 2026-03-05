# Bug Report: `.refine()` on Zod Schemas Produces Empty JSON Schema for MCP Clients

**Date:** 2026-03-05  
**Severity:** Critical — breaks nearly every MCP tool for AI agents  
**Discovered via:** Synthesis agent session analysis (`docs/agents/bug-reports/chat.json`)

---

## Symptom

The Synthesis agent (Claude Sonnet 4.6) could not pass arguments to most MCP ledger tools. Every call sent `{}` as arguments, triggering Zod validation errors like:

```
MCP error -32602: Invalid arguments for tool ledger_get_next_action:
  "agent_role" — Required (expected string, received undefined)
```

The agent correctly diagnosed the problem in its reasoning:

> "The tool schema says `project_path` and `agent_role` are required but the tool as exposed to me doesn't have those parameters in the JSON schema… the `required` array is empty."

After 6 failed tool calls (~47 seconds), the agent derailed into probing for a PHP MCP server binary — a complete non-sequitur for its Synthesis role.

---

## Root Cause

When a `z.object({...})` schema is chained with `.refine()`, Zod changes the type from `ZodObject` to `ZodEffects`. The MCP SDK's `registerTool` method converts Zod schemas to JSON Schema for the tool listing sent to clients (VS Code). **The SDK cannot extract `properties` from `ZodEffects`**, so it emits an empty schema (`{ properties: {}, required: [] }`).

### Proof — `.passthrough()` vs `.refine()`

| Schema | Zod Chain | JSON Schema in VS Code | Agent Could Pass Args? |
|--------|-----------|----------------------|----------------------|
| `DetectProjectSchema` | `z.object({...})` + `.passthrough()` | Properties **visible** | **Yes** — `cwd_path` sent correctly |
| `HelpSchema` | `z.object({...})` + `.passthrough()` | Properties **visible** | **Yes** — `tool_name` sent correctly |
| `GetNextActionSchema` | `z.object({...})` + `.refine(mutuallyExclusivePaths, ...)` | **Empty** | **No** — agent sent `{}` |
| `GetProjectStatusSchema` | `z.object({...})` + `.refine(mutuallyExclusivePaths, ...)` | **Empty** | **No** — agent sent `{}` |

---

## Affected Schemas

**18 schemas across 7 files** use `.refine(mutuallyExclusivePaths, ...)`:

| File | Count |
|------|-------|
| `mcp-server/src/tools/work-package.ts` | 7 |
| `mcp-server/src/tools/pipeline.ts` | 4 |
| `mcp-server/src/tools/observations.ts` | 2 |
| `mcp-server/src/tools/project-lifecycle.ts` | 2 |
| `mcp-server/src/tools/begin-work.ts` | 1 |
| `mcp-server/src/tools/workflow-handoff.ts` | 1 |
| `mcp-server/src/tools/workflow-next-action.ts` | 1 |

This means nearly every ledger tool the agent needs is broken from the client's perspective.

---

## Proposed Fix

Split each affected schema into two parts:

1. **Base schema** (`z.object({...})`) — registered as `inputSchema` so the MCP SDK can extract properties for the JSON Schema sent to clients.
2. **Refined schema** (base + `.refine(...)`) — used only for runtime validation inside the handler function.

### Example (before)

```typescript
const GetNextActionSchema = z.object({
  project_path: z.string().optional().describe('...'),
  cwd_path: z.string().optional().describe('...'),
  agent_role: z.string().describe('...'),
  max_results: z.number().int().positive().optional().describe('...'),
}).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

// Registration — SDK sees ZodEffects, emits empty schema
server.registerTool('ledger_get_next_action', {
  inputSchema: GetNextActionSchema,  // ← broken
}, handler);
```

### Example (after)

```typescript
const GetNextActionBaseSchema = z.object({
  project_path: z.string().optional().describe('...'),
  cwd_path: z.string().optional().describe('...'),
  agent_role: z.string().describe('...'),
  max_results: z.number().int().positive().optional().describe('...'),
});

const GetNextActionSchema = GetNextActionBaseSchema
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

// Registration — SDK sees ZodObject, emits correct schema
server.registerTool('ledger_get_next_action', {
  inputSchema: GetNextActionBaseSchema,  // ← clean ZodObject
}, async (args) => {
  // Runtime validation still uses the refined schema
  const parsed = GetNextActionSchema.parse(args);
  return getNextAction(parsed);
});
```

---

## Validation

After fix, verify by:

1. Running the MCP server and inspecting `tools/list` output — every tool's `inputSchema.properties` should be non-empty.
2. Running existing tests (`npm test` in `mcp-server/`).
3. Optionally: add a test that asserts all registered tool schemas have non-empty `properties`.

---

## Impact if Not Fixed

- Every agent role (not just Synthesis) is affected when using VS Code Copilot agent mode
- Agents that happen to know the parameters from their persona instructions may still fail because VS Code filters out unknown properties before sending them to the MCP server
- The `ledger_help` tool (which works) provides a partial workaround, but agents waste tokens calling it and still can't pass the parameters they learn about
