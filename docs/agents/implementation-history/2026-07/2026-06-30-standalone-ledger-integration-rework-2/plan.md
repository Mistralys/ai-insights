# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
This is the second rework of the `2026-06-30-standalone-ledger-integration` project (COMPLETE, 10 WPs, 43/43 stages passed). The first rework (`rework-1`, 6 steps, all steps implemented successfully) addressed the high-priority GUI verification gap, medium-priority persona-builder upgrade, and four low-priority cleanup items. Its synthesis — produced by a standalone developer agent — identified three further low-priority improvements in the Code Insights section. This plan addresses all three actionable items.

## Summary
This rework plan addresses the three Code Insight items from the `2026-06-30-standalone-ledger-integration-rework-1` synthesis: (1) add a test that cross-checks the hardcoded startup tool log string in `mcp-server/src/index.ts` against the actually-registered tool names, catching future omissions automatically; (2) refactor `deriveRepoName()` to accept an optional pre-resolved project root, eliminating the redundant double-call to `inferProjectRootFromPlanPath()` in `initializeProject()`; and (3) add a `--verbose` flag to `scripts/import-standalone.js` that surfaces full error stacks in `collectKnownSlugs()` to aid debugging of permission or I/O failures. All three items are low-priority quality improvements with no user-facing impact.

## Architectural Context
The changes touch three distinct areas:

- **MCP Server entry point** (`mcp-server/src/index.ts`): The startup log at L131 is a manually maintained hardcoded string listing all 30 registered tools. The comment at L78 and L128–130 documents this as a manual-sync obligation. There are no existing tests for this file. Tool modules in `mcp-server/src/tools/` each export a `register(server)` function that calls `server.registerTool(toolName, ...)` — the first argument is always the string tool name. Note: `workflow.ts` delegates to sub-modules (`nextActionModule.register(server)` and `handoffModule.register(server)`) rather than calling `registerTool` directly, and `workflow-next-action-batch.ts` has no `registerTool` calls. The Step 1 test design handles this correctly — files with no matching `registerTool` patterns simply contribute nothing to the union set.

- **Repository name utility** (`mcp-server/src/utils/ledger-root.ts`): `deriveRepoName(projectPath)` at L106–118 internally calls `inferProjectRootFromPlanPath(projectPath)` at L110 to resolve the project root, then extracts the basename. In `project-lifecycle.ts` L594–596, `inferProjectRootFromPlanPath(args.project_path)` is called independently to derive `projectName`, and then `deriveRepoName(args.project_path)` calls it again internally on the same path. Both functions are pure, so the double-call is correct but redundant. `deriveRepoName` has 3 production call sites: `LedgerStore` constructor (L90), `project-lifecycle.ts` (L595), and `repository-context.ts` (L93). Only the `project-lifecycle.ts` call site has a preceding `inferProjectRootFromPlanPath` call on the same path.

- **Import script** (`scripts/import-standalone.js`): `collectKnownSlugs()` at L110–137 reads the ledger root directory tree to discover tracked project slugs. The inner `catch` at L130–132 uses `console.warn()` for all `readdirSync` failures without surfacing the full error stack. The script uses manual `process.argv` parsing (L341–351) and currently supports four flags: `--path`, `--batch`, `--base-dir`, `--dry-run`.

## Approach / Architecture
Three independent, targeted improvements. No new abstractions, services, or architectural changes:

1. **Startup log sync test** (Step 1): Add a new test file under `mcp-server/tests/` that statically analyses the source files to extract registered tool names and cross-checks them against the log string in `index.ts`. This is a build-time source-scanning test, not a runtime integration test — it reads `.ts` source files as text and extracts tool names via regex, avoiding the complexity of bootstrapping the MCP server in a test.

2. **`deriveRepoName` optional root** (Step 2): Add an optional second parameter `resolvedRoot?: string | null` to `deriveRepoName()`. When provided and non-null, skip the internal `inferProjectRootFromPlanPath()` call. Update the single call site in `project-lifecycle.ts` to pass the already-resolved `projectRoot`. The other two call sites are unchanged.

3. **`--verbose` flag** (Step 3): Add `--verbose` to the script's argument parsing. When active, `collectKnownSlugs()` logs the full error stack instead of just `err.message`.

## Rationale
Each step addresses a specific synthesis Code Insight recommendation with minimal scope:

- **Step 1**: The startup log has already drifted once (three tools were missing, fixed in rework-1). A test makes future drift impossible without deliberate suppression — eliminating a class of manual-sync bugs at near-zero maintenance cost.
- **Step 2**: The double-call is harmless (both functions are pure), but the refactor clarifies intent and removes 10 lines of redundant computation. The optional parameter pattern preserves backward compatibility for all existing callers.
- **Step 3**: When `collectKnownSlugs()` fails on a permission error, the current one-line warning provides no actionable diagnostic. A `--verbose` flag gives operators the full stack without cluttering default output.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Startup log sync test approach | Static source scanning (regex over `.ts` files) | Runtime integration test that boots the MCP server | Source scanning avoids server bootstrap complexity, is faster, and catches drift at the source level; runtime test would require mocking STDIO transport and is fragile to SDK changes |
| `deriveRepoName` signature change | Optional second parameter with fallback | Overloaded function; separate `deriveRepoNameFromRoot()` function | Optional parameter is the simplest backward-compatible change; a separate function would duplicate the basename + validation logic |
| Error verbosity in import script | `--verbose` CLI flag | Always log full stacks; environment variable `VERBOSE=1` | `--verbose` follows CLI convention and avoids noise in default output; env-var approach is less discoverable |

## Pattern Alignment
- **Test file placement**: New test at `mcp-server/tests/startup/tool-log-sync.test.ts` follows the existing pattern of subdirectory-per-concern under `mcp-server/tests/` (e.g., `utils/`, `tools/`, `storage/`, `gui/`, `schema/`).
- **Optional parameter with fallback**: Follows the pattern used by `LedgerStore`'s constructor in `mcp-server/src/storage/ledger-store.ts` which accepts an optional `ledgerRoot?` parameter.
- **CLI flag parsing**: `--verbose` is parsed via the same manual `process.argv` pattern used for `--dry-run`, `--batch`, `--path`, and `--base-dir` at L341–351 of `scripts/import-standalone.js`.
- No patterns are departed from.

## Detailed Steps

### Step 1 — Add Startup Tool Log Sync Test

Create a test that reads the MCP server source files and verifies the hardcoded startup log string contains exactly the set of registered tool names.

1. Create `mcp-server/tests/startup/tool-log-sync.test.ts`.
2. Read `mcp-server/src/index.ts` as a text string using `fs.readFileSync`.
3. Extract the tool names from the startup log string using a regex that matches the `console.error(...)` call containing `'Registered tools:'`.
4. Read each tool module file under `mcp-server/src/tools/` (excluding `help-content.ts` which is a data-only module, not a registration module).
5. Extract tool names from each file by matching `server.registerTool('tool_name'` patterns.
6. Assert that the set of tool names in the log string exactly equals the set of tool names from the registration calls — no missing, no extra.
7. The test should produce a clear diff message listing any missing or extra tool names.

**Files:**
- `mcp-server/tests/startup/tool-log-sync.test.ts` (new)

### Step 2 — Add Optional Pre-Resolved Root to `deriveRepoName()`

Refactor `deriveRepoName()` to accept an optional pre-resolved project root, eliminating the redundant `inferProjectRootFromPlanPath()` call in `initializeProject()`.

1. In `mcp-server/src/utils/ledger-root.ts`, change the `deriveRepoName` signature from:
   ```ts
   export function deriveRepoName(projectPath: string): string
   ```
   to:
   ```ts
   export function deriveRepoName(projectPath: string, resolvedRoot?: string | null): string
   ```
2. Inside the function body, replace:
   ```ts
   const root = inferProjectRootFromPlanPath(projectPath);
   ```
   with:
   ```ts
   const root = resolvedRoot !== undefined ? resolvedRoot : inferProjectRootFromPlanPath(projectPath);
   ```
   This preserves backward compatibility: when `resolvedRoot` is not passed, the function behaves exactly as before.
3. In `mcp-server/src/tools/project-lifecycle.ts`, update the call at L596 from:
   ```ts
   const repositoryName = deriveRepoName(args.project_path);
   ```
   to:
   ```ts
   const repositoryName = deriveRepoName(args.project_path, projectRoot);
   ```
   The `projectRoot` variable at L594 already holds the result of `inferProjectRootFromPlanPath(args.project_path)`.
4. Verify existing tests pass — the other two call sites (`LedgerStore` constructor, `repository-context.ts`) are unchanged and continue to use the one-argument form.
5. Add a focused test for the new parameter in `mcp-server/tests/utils/derive-repo-name.test.ts` (the dedicated `deriveRepoName` test file, 12 existing test cases): test that passing a non-null `resolvedRoot` bypasses the internal `inferProjectRootFromPlanPath` call and uses the provided root directly.

**Files:**
- `mcp-server/src/utils/ledger-root.ts` (modify)
- `mcp-server/src/tools/project-lifecycle.ts` (modify)
- `mcp-server/tests/utils/derive-repo-name.test.ts` (modify — add test case)

### Step 3 — Add `--verbose` Flag to `import-standalone.js`

Add a `--verbose` CLI flag that surfaces full error stacks in `collectKnownSlugs()`.

1. In `scripts/import-standalone.js`, add `--verbose` to the argument parsing section (near L346–347):
   ```js
   const isVerbose = args.includes('--verbose');
   ```
2. Pass the `isVerbose` flag to `collectKnownSlugs()` — either as a parameter or by making it module-scoped (follow whichever pattern the script already uses for `isDryRun`).
3. In the `catch` block at L130–132, conditionally log the full error:
   ```js
   catch (err) {
     console.warn(`  ⚠ Could not read ${repoDir}: ${err.message}`);
     if (isVerbose) {
       console.warn(err.stack);
     }
   }
   ```
4. Update the script's usage comment block (top of file, L1–22) to document the new `--verbose` flag.

**Files:**
- `scripts/import-standalone.js` (modify)

## Dependencies
- Steps 1, 2, and 3 are fully independent and can be implemented in parallel or in any order.

## Required Components
- `mcp-server/tests/startup/tool-log-sync.test.ts` (new file)
- `mcp-server/src/utils/ledger-root.ts` (modify `deriveRepoName` signature)
- `mcp-server/src/tools/project-lifecycle.ts` (modify `deriveRepoName` call site)
- `mcp-server/tests/utils/derive-repo-name.test.ts` (modify — add test for new parameter)
- `scripts/import-standalone.js` (modify — add `--verbose` flag)

## Assumptions
- The MCP SDK's `server.registerTool()` API remains stable with the tool name as the first string argument.
- The tool source files under `mcp-server/src/tools/` continue to use the `server.registerTool('tool_name', ...)` pattern with string literals (not computed names).
- `help-content.ts` remains a data-only module that does not register tools.

## Constraints
- The startup log sync test must not bootstrap the MCP server or require STDIO transport — it is purely a static source-scanning test.
- The `deriveRepoName` signature change must be backward-compatible: all existing one-argument call sites must continue to work without modification.
- The `--verbose` flag must not change default output — it is opt-in only.

## Out of Scope
- Automating the startup log via MCP SDK API changes (the SDK does not expose `listTools()` at startup).
- Adding retry logic to `collectKnownSlugs()` for transient I/O errors (the synthesis mentioned this as a possibility, but the diagnostic improvement via `--verbose` is sufficient for now).
- Any user-facing feature changes.

## Acceptance Criteria
- AC1: A test file `mcp-server/tests/startup/tool-log-sync.test.ts` exists and passes, asserting the startup log string contains exactly the tool names registered across all `mcp-server/src/tools/*.ts` modules.
- AC2: Deliberately removing a tool name from the log string causes the test to fail with a clear message identifying the missing tool.
- AC3: `deriveRepoName()` accepts an optional `resolvedRoot` parameter. When passed a non-null value, `inferProjectRootFromPlanPath()` is not called internally.
- AC4: The `initializeProject()` call in `project-lifecycle.ts` passes the already-resolved `projectRoot` to `deriveRepoName()`, eliminating the redundant second call.
- AC5: All existing MCP server tests pass without modification (backward compatibility).
- AC6: `scripts/import-standalone.js` accepts a `--verbose` flag that causes `collectKnownSlugs()` to log full error stacks on `readdirSync` failures.
- AC7: Without `--verbose`, the script's output is unchanged from the current behaviour.

## Testing Strategy
All three steps are testable via the existing Vitest suite for the MCP server and via manual CLI invocation for the import script.

## Test Plan
- `mcp-server/tests/startup/tool-log-sync.test.ts` (new) — Asserts the startup log tool set equals the union of all `server.registerTool()` first arguments across `src/tools/*.ts` files — covers AC1, AC2.
- `mcp-server/tests/utils/derive-repo-name.test.ts` (modify) — Add test case: `deriveRepoName(path, '/pre/resolved/root')` returns basename of provided root without calling `inferProjectRootFromPlanPath` — covers AC3.
- Existing test suite (`npm test` in `mcp-server/`) — Full regression run — covers AC5.
- Manual CLI test: run `node scripts/import-standalone.js --batch --verbose` and verify full stacks appear for any directory-read warnings — covers AC6, AC7.

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `tests/startup/tool-log-sync.test.ts` entry.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `deriveRepoName` signature to show the optional `resolvedRoot` parameter.
- `scripts/import-standalone.js` header comment — Document `--verbose` flag in the usage block.
- Root `AGENTS.md` — Update `scripts/import-standalone.js` description in the Root-Level Tooling table to mention `--verbose` support.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Startup log test is brittle if tool registration patterns change** | The regex is simple (`server.registerTool('...'`) and matches the established pattern across all 13 registration modules. If the SDK changes the method name, the test will fail loudly — which is the desired behavior. |
| **`resolvedRoot` parameter could be passed with an incorrect value** | The parameter is optional and only used at one call site where the value is derived from the same `inferProjectRootFromPlanPath` call two lines above. Type safety (`string | null`) prevents accidental misuse. |
| **`--verbose` flag clutters output** | It is opt-in only and only affects the `catch` block in `collectKnownSlugs()`. Default output is unchanged. |
