# Plan

## Summary

Fix a critical bug where `.refine()` on Zod schemas converts them to `ZodEffects`, causing the MCP SDK to emit empty JSON Schemas (`{ properties: {}, required: [] }`) for 18 of 22 tools. This prevents all AI agents in VS Code Copilot agent mode from passing arguments to ledger tools. The fix moves the mutual-exclusivity validation from Zod schema refinement into `resolveProjectPath()`, keeping all 18 schemas as plain `ZodObject` instances that the SDK can convert correctly.

## Architectural Context

- **Tool registration** (`mcp-server/src/tools/*.ts`): Each tool file defines Zod schemas and registers tools via `server.registerTool(name, { inputSchema }, handler)`. The MCP SDK converts `inputSchema` to JSON Schema for the `tools/list` response sent to clients.
- **Schema refinement pattern**: 18 schemas chain `.refine(mutuallyExclusivePaths, ...)` to enforce that `project_path` and `cwd_path` are mutually exclusive. This converts the schema from `ZodObject` to `ZodEffects`.
- **`resolveProjectPath()`** (`mcp-server/src/utils/path-validator.ts`): All 18 affected handlers call this function to resolve the project path from either `project_path` or `cwd_path`. Currently this function does NOT reject when both are provided — it silently uses `project_path`.
- **`mutuallyExclusivePaths()`** (`mcp-server/src/utils/path-validator.ts`): The Zod refinement predicate; returns `false` when both paths are provided.
- **Working tools**: `ledger_detect_project`, `ledger_help`, `ledger_initialize_project`, and `ledger_list_projects` use `.passthrough()` (which preserves `ZodObject`) or have no refinements, so their schemas are emitted correctly.

### Affected schemas (18 across 7 files)

| File | Schemas | Lines with `.refine()` |
|------|---------|----------------------|
| `mcp-server/src/tools/work-package.ts` | `GetWorkPackageSchema`, `ListWorkPackagesSchema`, `CreateWorkPackageSchema`, `ClaimWorkPackageSchema`, `UpdateWorkPackageStatusSchema`, `ResetReworkCountSchema`, `UpdateAcceptanceCriteriaSchema` | 99, 150, 219, 426, 582, 1115, 1258 |
| `mcp-server/src/tools/pipeline.ts` | `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema` | 112, 314, 533, 604 |
| `mcp-server/src/tools/project-lifecycle.ts` | `GetProjectStatusSchema`, `CompleteSynthesisSchema` | 97, 535 |
| `mcp-server/src/tools/observations.ts` | `AddObservationSchema`, `AddProjectCommentSchema` | 33, 131 |
| `mcp-server/src/tools/workflow-next-action.ts` | `GetNextActionSchema` | 49 |
| `mcp-server/src/tools/workflow-handoff.ts` | `GetHandoffStatusSchema` | 36 |
| `mcp-server/src/tools/begin-work.ts` | `BeginWorkSchema` | 39 |

### NOT affected

- `InitializeProjectSchema` — has a field-level `.refine()` on `plan_file` (not on the outer object), remains a `ZodObject`; registered with `.passthrough()`.
- `DetectProjectSchema`, `ListProjectsSchema`, `HelpSchema` — no `.refine()` on the outer object; registered with `.passthrough()`.

## Approach / Architecture

**Move the mutual-exclusivity check from Zod schema-level refinement into `resolveProjectPath()`.** This eliminates `.refine()` from all 18 schemas in a single architectural change.

### Before

```
Schema:     z.object({...}).refine(mutuallyExclusivePaths, ...)  → ZodEffects
Registration: inputSchema: Schema  → SDK emits empty properties
Handler:    receives pre-validated args → calls resolveProjectPath(args)
```

### After

```
Schema:     z.object({...})  → ZodObject
Registration: inputSchema: Schema  → SDK emits correct properties
Handler:    receives partially validated args → resolveProjectPath(args) enforces mutual exclusivity
```

This approach is chosen over the bug report's proposed "split into Base + Refined" approach because:
- **1 file changed vs. 7 files refactored** — the mutual exclusivity check is added once in `resolveProjectPath()`, then all 18 `.refine()` calls are simply removed.
- **No new variables** — no `*BaseSchema` / `*Schema` pairs needed.
- **No handler changes** — handlers already call `resolveProjectPath()` and handle its thrown errors.
- **Same error semantics** — both paths produce an error when both arguments are supplied.

The error format changes from a Zod validation error (`MCP error -32602`) to a handler-level error message. This is acceptable because:
1. The error message is equally clear and actionable.
2. No documented contract depends on the Zod error code for this specific validation.
3. Agents and clients can handle both error shapes.

## Rationale

- `.refine()` is fundamentally incompatible with the MCP SDK's JSON Schema conversion for tool listings. This is a known Zod/MCP SDK interop limitation.
- Moving the check into `resolveProjectPath()` centralizes the validation and ensures any future tool that uses `resolveProjectPath()` automatically gets mutual exclusivity enforcement.
- Removing `.refine()` from schemas is a purely subtractive change — it cannot break property extraction.

## Detailed Steps

### Step 1: Add mutual exclusivity guard to `resolveProjectPath()`

**File:** `mcp-server/src/utils/path-validator.ts`

Add a check at the top of `resolveProjectPath()` that throws if both `project_path` and `cwd_path` are provided:

```typescript
export async function resolveProjectPath(args: {
  project_path?: string;
  cwd_path?: string;
  [key: string]: unknown;
}): Promise<string> {
  // Mutual exclusivity guard (moved from Zod .refine() — see bug report 2026-03-05)
  if (args.project_path && args.cwd_path) {
    throw new Error(MUTUAL_EXCLUSIVITY_PATH_MSG);
  }
  // ... rest of function unchanged
}
```

### Step 2: Remove `.refine(mutuallyExclusivePaths, ...)` from all 18 schemas

Remove the `.refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG })` chain from each of the 18 schemas listed above. The schema definitions become plain `z.object({...})` calls.

**Files to edit (7):**
- `mcp-server/src/tools/work-package.ts` — 7 removals
- `mcp-server/src/tools/pipeline.ts` — 4 removals
- `mcp-server/src/tools/project-lifecycle.ts` — 2 removals
- `mcp-server/src/tools/observations.ts` — 2 removals
- `mcp-server/src/tools/workflow-next-action.ts` — 1 removal
- `mcp-server/src/tools/workflow-handoff.ts` — 1 removal
- `mcp-server/src/tools/begin-work.ts` — 1 removal

Also remove unused imports of `mutuallyExclusivePaths` and `MUTUAL_EXCLUSIVITY_PATH_MSG` from tool files that no longer use them. After this step, only `path-validator.ts` (definition) and `tests/utils/path-validator.test.ts` (tests) should reference `mutuallyExclusivePaths`. The function and constant remain exported for backward compatibility and test coverage.

### Step 3: Update existing tests

**File:** `mcp-server/tests/utils/path-validator.test.ts`

- Add test cases for the new mutual exclusivity guard in `resolveProjectPath()`:
  - Rejects when both `project_path` and `cwd_path` are provided.
  - Error message matches `MUTUAL_EXCLUSIVITY_PATH_MSG`.
- Existing `mutuallyExclusivePaths` unit tests remain (the function is still exported and testable).

### Step 4: Add schema integrity regression test

**File:** `mcp-server/tests/tools/schema-integrity.test.ts` (new)

Create a test that starts the MCP server (or imports the tool schemas) and asserts that every registered tool's `inputSchema`, when converted to JSON Schema, produces non-empty `properties`. This prevents a regression if someone re-adds `.refine()` to a schema.

Approach: import all `*Schema` constants from each tool file, use `zodToJsonSchema` (or the SDK's internal converter) to convert each, and assert `Object.keys(jsonSchema.properties).length > 0`.

### Step 5: Run the test suite

```bash
cd mcp-server && npm test
```

Verify all existing tests pass — including the `mutuallyExclusivePaths` tests in `path-validator.test.ts` (the function itself hasn't changed) and all tool handler tests (the validation now happens in `resolveProjectPath` instead of Zod, but the behavior is the same).

### Step 6: Manual validation

Start the MCP server and inspect the `tools/list` output. Verify that every tool's `inputSchema.properties` is non-empty. This can be done by:
1. Running the server with `node dist/index.js` and sending a `tools/list` request.
2. Or checking via the VS Code MCP tool listing UI.

### Step 7: Update constraints.md

**File:** `mcp-server/docs/agents/project-manifest/constraints.md`

Add a new constraint documenting the MCP SDK limitation and the correct pattern:

> **Rule:** Never chain `.refine()`, `.transform()`, or `.superRefine()` on the outer `z.object()` schema passed to `inputSchema` in `server.registerTool()`. These methods convert `ZodObject` to `ZodEffects`, which the MCP SDK cannot convert to JSON Schema — resulting in empty `properties` and `required` arrays in the tool listing.
>
> **Correct pattern:** Perform cross-field validation inside the handler function (e.g., via `resolveProjectPath()`). Field-level `.refine()` inside `z.string().refine(...)` is safe because the outer schema remains a `ZodObject`.

## Dependencies

- No new dependencies required.
- Existing dependency: `@modelcontextprotocol/sdk` (provides the `registerTool` method that converts Zod to JSON Schema).

## Required Components

- `mcp-server/src/utils/path-validator.ts` — add mutual exclusivity guard to `resolveProjectPath()`
- `mcp-server/src/tools/work-package.ts` — remove 7 `.refine()` calls
- `mcp-server/src/tools/pipeline.ts` — remove 4 `.refine()` calls
- `mcp-server/src/tools/project-lifecycle.ts` — remove 2 `.refine()` calls
- `mcp-server/src/tools/observations.ts` — remove 2 `.refine()` calls
- `mcp-server/src/tools/workflow-next-action.ts` — remove 1 `.refine()` call
- `mcp-server/src/tools/workflow-handoff.ts` — remove 1 `.refine()` call
- `mcp-server/src/tools/begin-work.ts` — remove 1 `.refine()` call
- `mcp-server/tests/utils/path-validator.test.ts` — add `resolveProjectPath` mutual exclusivity tests
- `mcp-server/tests/tools/schema-integrity.test.ts` — **new** regression test
- `mcp-server/docs/agents/project-manifest/constraints.md` — add new constraint

## Assumptions

- The MCP SDK's `registerTool` uses `zodToJsonSchema` (or equivalent) internally, which does not support `ZodEffects` for property extraction. This is confirmed by the bug report's empirical evidence.
- All 18 affected handlers already call `resolveProjectPath()` and wrap it in a try/catch that returns an MCP error response. No handler changes are needed.
- No downstream code depends on receiving a Zod-shaped error (error code `-32602`) specifically for the mutual exclusivity violation (as opposed to a handler-thrown error).

## Constraints

- The `mutuallyExclusivePaths` function and `MUTUAL_EXCLUSIVITY_PATH_MSG` constant must remain exported from `path-validator.ts` — they are used in tests and may be referenced externally.
- The `InitializeProjectSchema` field-level `.refine()` on `plan_file` is NOT affected and must NOT be changed.
- All changes are internal to `mcp-server/` — no cross-project impact.

## Out of Scope

- Fixing the MCP SDK itself to handle `ZodEffects` — that's an upstream problem.
- Refactoring `InitializeProjectSchema` or any schema that does NOT use `.refine()` on the outer object.
- Adding `.passthrough()` to registrations — this is orthogonal to the `.refine()` issue and not needed for schemas that are already `ZodObject`.
- Changing error response formats — the plan preserves current behavior (error message content is identical).

## Acceptance Criteria

1. All 22 MCP tools emit non-empty `inputSchema.properties` in the `tools/list` response.
2. Passing both `project_path` and `cwd_path` to any affected tool still returns an error with the mutual exclusivity message.
3. All existing tests pass (`npm test` in `mcp-server/`).
4. New schema integrity test exists and passes, preventing future regressions.
5. `constraints.md` documents the Zod/MCP SDK limitation as a formal constraint.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| **Unit** | `resolveProjectPath()` rejects dual-path args | New test in `path-validator.test.ts` |
| **Unit** | `mutuallyExclusivePaths()` still works standalone | Existing tests (unchanged) |
| **Regression** | All tool schemas produce non-empty JSON Schema properties | New `schema-integrity.test.ts` |
| **Integration** | Existing tool handlers continue to work | Existing test suite (`npm test`) |
| **Manual** | `tools/list` shows full properties for all 22 tools | Start server + inspect output |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Error format change** — mutual exclusivity errors shift from Zod validation error (SDK-level) to handler error | The error message content is identical. No known consumer depends on the Zod error code for this specific case. |
| **Missed `.refine()` removal** — a schema is missed and continues to emit empty properties | The new `schema-integrity.test.ts` test catches this by asserting non-empty properties for ALL registered schemas. |
| **Future developer re-adds `.refine()`** | The constraint in `constraints.md` + the regression test provide dual protection. |
| **Tests reference schema types that change from `ZodEffects` to `ZodObject`** | No known test asserts the Zod schema type. All tests use `.parse()` or `.safeParse()`, which work on both `ZodObject` and `ZodEffects`. |
