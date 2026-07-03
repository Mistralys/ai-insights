## Synthesis

### Completion Status
- Date: 2026-07-03
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Step 1: Created `mcp-server/tests/startup/tool-log-sync.test.ts` — a static source-scanning test that reads `src/index.ts` and all `src/tools/*.ts` modules, extracts tool names from the hardcoded startup log and from `server.registerTool()` calls via regex, and asserts exact set equality with clear diff messages for missing or extra entries.
- Step 2: Added optional `resolvedRoot?: string | null` second parameter to `deriveRepoName()` in `mcp-server/src/utils/ledger-root.ts`. When the parameter is provided (non-undefined), the internal `inferProjectRootFromPlanPath()` call is skipped. Updated the single redundant call site in `initializeProject()` (`project-lifecycle.ts`) to pass the already-resolved `projectRoot`. Added two new test cases to `mcp-server/tests/utils/derive-repo-name.test.ts`: one asserting that a provided `resolvedRoot` is used directly, one asserting that an explicit `null` returns `'unknown'`.
- Step 3: Added `--verbose` flag to `scripts/import-standalone.js`. The flag is parsed in `main()`, passed to `runBatch()` via a new `verbose` parameter, and forwarded to `collectKnownSlugs(verbose)`. In the `catch` block, when `verbose` is true, the full error stack is logged via `console.warn(err.stack)` after the existing message-only line.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Added `tests/startup/` directory entry and `tool-log-sync.test.ts` annotation.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Updated `deriveRepoName` signature to `(projectPath: string, resolvedRoot?: string | null): string` with inline doc for the new parameter.
- `AGENTS.md` and `CLAUDE.md` — Updated `scripts/import-standalone.js` description in the Root-Level Tooling table to mention the `--verbose` flag.

### Verification Summary
- Tests run: `npx vitest run` in `mcp-server/` (full suite)
- Static analysis run: none (no linter configured for the MCP server TypeScript)
- Result: All test files pass; new and modified tests confirmed via verbose reporter output:
  - `tests/startup/tool-log-sync.test.ts > Startup tool log sync > startup log contains exactly the set of registered tool names` ✓
  - `tests/utils/derive-repo-name.test.ts > deriveRepoName > uses the provided resolvedRoot directly, bypassing inferProjectRootFromPlanPath` ✓
  - `tests/utils/derive-repo-name.test.ts > deriveRepoName > returns "unknown" when resolvedRoot is explicitly null` ✓

### Code Insights
- [low] (improvement) `mcp-server/src/utils/ledger-root.ts`: The JSDoc for `deriveRepoName` previously described the algorithm as "walking 4 levels up from the plan path", which reflected an older implementation. The function now uses the `docs/agents` anchor algorithm. The doc was corrected as part of this change, but it's worth noting that the original comment was already misleading before this rework.
- [low] (improvement) `mcp-server/tests/startup/tool-log-sync.test.ts`: The test uses `readdirSync` to discover tool files at test time. If a new tool module is added to `src/tools/` but the developer forgets to call `server.registerTool()` inside it (only defining a `register()` shell), the test will still pass because no tool names would be extracted from that file. This is acceptable — the test's purpose is to catch log/registration divergence, not to enforce that every tool file registers at least one tool.
- [low] (debt) `scripts/import-standalone.js`: The `--verbose` flag only affects `collectKnownSlugs()` today. Other `readdirSync` calls in the script (e.g., in `scanPlanFolders` → `walkDir`) also silently swallow errors. If broader verbose support is ever needed, the `verbose` parameter would need to be threaded through those helpers too — or a module-scoped approach reconsidered.

### Additional Comments
- AC2 (detecting a removed tool name from the log) is validated by the test design: the two `expect()` assertions both produce named arrays as failure messages. Removing any entry from the log string would cause `missingFromLog` to be non-empty, triggering the first assertion with a clear list of missing tools.
- The `--verbose` flag for `import-standalone.js` was not mechanically tested because doing so would require simulating a permission-denied `readdirSync` failure. The logic is straightforward: the `if (verbose)` guard was verified by code review.
