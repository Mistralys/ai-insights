
## Synthesis

### Completion Status
- Date: 2026-06-01
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Extracted `resolveProjectPath()` and `formatCandidateList()` from `src/utils/path-validator.ts`
  into the new `src/utils/project-resolver.ts` module.
- `path-validator.ts` is now a pure, zero-I/O utility (only `assertSafeSegment`,
  `planFolderBasename`, `validatePlanPath`). Its three stale imports (`LedgerStore`,
  `ProjectMeta`, `formatRelativeTime`) were removed alongside the extracted functions.
- `project-resolver.ts` owns the `LedgerStore` dependency and imports `planFolderBasename`
  from `path-validator.ts` for format validation inside `resolveProjectPath()`.
- All 7 tool-file import sites were updated to import `resolveProjectPath` (and
  `formatCandidateList` where used) from `../utils/project-resolver.js`.
- Tests for the extracted functions were moved from `tests/utils/path-validator.test.ts`
  into the new `tests/utils/project-resolver.test.ts` (13 tests: 7 for `resolveProjectPath`,
  6 for `formatCandidateList`).

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/file-tree.md` — added `project-resolver.ts` to
  the `src/utils/` tree; added `project-resolver.test.ts` to the `tests/utils/` tree;
  updated the `path-validator.ts` annotation to reflect its pure-utility scope.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — updated `resolveProjectPath`
  source annotation from `path-validator.ts` → `project-resolver.ts`; added
  `formatCandidateList` entry (previously undocumented).
- `mcp-server/docs/agents/project-manifest/constraints.md` — two references to
  `resolveProjectPath()` source location updated from `path-validator.ts` → `project-resolver.ts`.

### Verification Summary
- Tests run: `npx vitest run` (full suite, mcp-server)
- Static analysis run: `npx tsc --noEmit` (mcp-server)
- Result: **PASS** — 95 test files, 2,859 tests passed (0 failed); TypeScript compiles cleanly

### Code Insights
- [low] (improvement) `mcp-server/src/utils/path-validator.ts`: `mutuallyExclusivePaths` and
  `MUTUAL_EXCLUSIVITY_PATH_MSG` are marked as no longer used in production but still
  exported for backward compatibility. A future cleanup cycle could remove them once
  confirmed safe (check for any downstream consumer outside this repo).
- [low] (improvement) `mcp-server/src/utils/project-resolver.ts`: `resolveProjectPath` accepts
  `[key: string]: unknown` in its args type as a passthrough for arbitrary tool args; this
  is correct but undocumented at the call site. A JSDoc note on why the index signature is
  intentional would aid future readers.

### Additional Comments
- The split follows the separation described in the original synthesis recommendation: pure
  path utilities stay in `path-validator.ts`; storage-dependent resolver lives in
  `project-resolver.ts`. No behavioral changes were made — this is a structural refactor only.
- Test count: prior 94 files → 95 files (+1 `project-resolver.test.ts`). Test count unchanged
  at 2,859 (tests moved, not added or removed).
