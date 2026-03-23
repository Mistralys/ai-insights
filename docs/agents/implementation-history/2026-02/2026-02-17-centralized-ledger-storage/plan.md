# Plan

## Summary

Move project ledger storage from per-plan `.ledger/` subdirectories to a single centralized location at `mcp-server/data/ledgers/{project-id}/`. This eliminates agent confusion caused by JSON ledger files being co-located with plan markdown files, and creates a clean separation between plan documentation and operational ledger data.

## Approach / Architecture

### Current State

- `LedgerStore` receives `projectPath` (the plan directory, e.g., `docs/agents/plans/2026-02-12-feature-name/`)
- Ledger files are stored at `{projectPath}/.ledger/`:
  - `{projectPath}/.ledger/project-ledger.json` — root index
  - `{projectPath}/.ledger/WP-001.json` — work package detail files
- Lock file at `{projectPath}/.ledger.lock`
- Agents browsing the plan directory see the `.ledger/` folder and JSON files, sometimes attempting to read/edit them directly instead of using MCP tools

### Proposed State

```
mcp-server/
  data/
    ledgers/
      2026-02-12-workflow-mcp/        ← project ID = plan folder basename
        project-ledger.json
        WP-001.json
        WP-002.json
        ...
      2026-02-17-centralized-ledger/
        project-ledger.json
        WP-001.json
        ...
```

- **Central data root**: `mcp-server/data/ledgers/`
- **Project identifier**: The plan folder basename (already validated as `YYYY-MM-DD-{name}` by `path-validator.ts`)
- **No `.ledger/` subfolder**: Files live directly in the project's ledger directory
- **Lock files**: `mcp-server/data/ledgers/{project-id}.lock`
- **Git-ignored**: `data/` directory is runtime/operational data and should be gitignored
- **Plan directory stays clean**: Only markdown artifacts (plan.md, work/\*.md) remain in the plan directory

### Architecture Diagram

```
Tool call with project_path
        │
        ▼
  Path Resolution
  (extract basename as project-id,
   combine with server data root)
        │
        ▼
  LedgerStore(ledgerDir)
        │
        ├── project-ledger.json
        ├── WP-001.json
        └── WP-002.json
```

## Rationale

1. **Eliminates agent confusion**: The core problem — agents try to use raw JSON files when they see them in the plan directory. Moving ledger data away from plan docs solves this structurally.
2. **Clean separation of concerns**: Plan directories contain human-readable documentation; ledger data is operational state managed exclusively by the MCP server.
3. **Centralized data management**: All ledger data lives in one predictable location, making backup, inspection, and cleanup straightforward.
4. **Minimal API surface change**: The `project_path` parameter remains the same for all tools. Only the internal storage path changes — the resolution is handled transparently by a new utility function.
5. **Project ID from basename**: The plan folder's `YYYY-MM-DD-{name}` pattern is already validated and unique, making it a natural project identifier without introducing new concepts.

## Detailed Steps

### 1. Create path resolution utility

Add a new utility function (e.g., in `src/utils/path-resolver.ts`) that:
- Takes the MCP server's data root directory and a `project_path`
- Extracts the plan folder basename (project ID) using the existing validation
- Returns the resolved centralized ledger directory path: `{dataRoot}/ledgers/{projectId}/`

The data root should be resolved relative to the MCP server's own directory (using `__dirname` pattern already established in `src/index.ts`).

### 2. Refactor `LedgerStore` constructor and path helpers

Currently `LedgerStore` takes `projectPath` and appends `.ledger/` internally. Refactor so:
- The constructor accepts the **resolved ledger directory path** directly (no `.ledger/` concatenation)
- `rootIndexPath()` → `join(this.ledgerDir, 'project-ledger.json')`
- `wpDetailPath(wpId)` → `join(this.ledgerDir, `${wpId}.json`)`
- `ledgerDirPath()` → `this.ledgerDir`
- Constructor parameter renamed from `projectPath` to `ledgerDir` for clarity

### 3. Update `file-lock.ts` lock file path

Currently the lock file lives at `{projectPath}/.ledger.lock`. Update:
- Lock file moves to `{dataRoot}/ledgers/{projectId}.lock` (sibling to the project ledger directory)
- The `withLock` function should accept the ledger directory path and derive the lock file location accordingly (e.g., `{ledgerDir}.lock`)
- Alternatively, pass the lock file path explicitly

### 4. Add `project_path` field to root index schema

Since the ledger no longer lives alongside the plan, the root index should store the original plan directory path for traceability:
- Add `project_path: z.string()` to `RootIndexSchema` in `src/schema/root-index.ts`
- This records which plan directory the ledger corresponds to
- `initializeProject` stores the provided `project_path` in the root index

### 5. Update `WorkPackageSummary.file` field

Currently stores `ledger/WP-001.json` (relative from plan directory to `.ledger/` subfolder). Update:
- Change to just `WP-001.json` (relative within the centralized ledger directory)
- Update `createWorkPackage` in `src/tools/work-package.ts` (line 210: `file: \`ledger/${wpId}.json\``)

### 6. Refactor all tool files to use path resolution

Every tool function currently instantiates `new LedgerStore(args.project_path)`. Update to:
- Resolve the centralized ledger path using the new utility function
- Instantiate `new LedgerStore(resolvedLedgerPath)`

Affected files:
- `src/tools/project-lifecycle.ts` — `getProjectStatus`, `initializeProject`
- `src/tools/work-package.ts` — `getWorkPackage`, `listWorkPackages`, `createWorkPackage`, `claimWorkPackage`, `updateWorkPackageStatus`
- `src/tools/pipeline.ts` — `startPipeline`, `completePipeline`
- `src/tools/observations.ts` — `addObservation`, `addProjectComment`
- `src/tools/workflow.ts` — `getNextAction`, `getHandoffStatus`

All these files follow the same pattern: validate path → create store → use store. The change is mechanical: insert path resolution between validation and store creation.

### 7. Propagate data root via server initialization

The MCP server needs to know its data root directory. Update `src/index.ts`:
- Resolve `DATA_ROOT` as `join(__dirname, '..', 'data')` (relative to the compiled output, so relative to `package.json`)
- Export or make accessible to tool registration functions
- This may require passing `dataRoot` to each tool module's `register()` function, or using a shared configuration module

### 8. Update error messages and tool descriptions

Several places reference `.ledger/` explicitly:
- `src/tools/project-lifecycle.ts` line 131: error message mentions `.ledger/project-ledger.json`
- `src/tools/project-lifecycle.ts` line 192: tool description mentions `.ledger/ subdirectory`
- `src/tools/help.ts`: help text may reference ledger file paths
- `src/storage/ledger-store.ts`: JSDoc comments reference `.ledger/`

### 9. Update `.gitignore`

Add `/mcp-server/data/` to the workspace `.gitignore` to exclude runtime ledger data from version control.

### 10. Update tests

All tests that reference `.ledger/` paths need updating:
- `tests/storage/ledger-store.test.ts` — multiple references to `.ledger/` directory creation and file paths
- `tests/integration/full-workflow.test.ts` — references to `.ledger/WP-001.json` in file fields and path expectations
- `tests/schema/validators.test.ts` — `ledger/${id}.json` in test data

Tests should create temp directories simulating the centralized structure rather than the `.ledger/` subfolder structure.

### 11. Update documentation and persona references

- `mcp-server/AGENTS.md` — if it references ledger file locations
- `mcp-server/README.md` — architecture documentation
- `docs/agents/project-manifest/` files — file tree, data flows

### 12. Migration consideration for existing data

The existing ledger data at `docs/agents/implementation-history/2026-02-12-workflow-mcp/ledger/` and `project-ledger.json` is historical/archived documentation. These files are **not** managed by the MCP server at runtime and do not need migration. They serve as a record of a completed project.

For any **active** projects that have `.ledger/` folders in plan directories (if any), provide a note in the changelog about the breaking change and the need to re-initialize or manually move files.

## Dependencies

- The path resolution utility (step 1) must be implemented before refactoring `LedgerStore` (step 2) or tool files (step 6)
- The schema change (step 4) should be done before updating `initializeProject` in step 6
- Data root propagation (step 7) must be in place before tool files can resolve paths

## Required Components

### Files to create
- `mcp-server/src/utils/path-resolver.ts` — new path resolution utility
- `mcp-server/tests/utils/path-resolver.test.ts` — tests for the resolver

### Files to modify
- `mcp-server/src/storage/ledger-store.ts` — refactor constructor and path helpers
- `mcp-server/src/storage/file-lock.ts` — update lock file path derivation
- `mcp-server/src/schema/root-index.ts` — add `project_path` field
- `mcp-server/src/index.ts` — resolve and propagate data root
- `mcp-server/src/tools/project-lifecycle.ts` — path resolution + schema update
- `mcp-server/src/tools/work-package.ts` — path resolution + file field update
- `mcp-server/src/tools/pipeline.ts` — path resolution
- `mcp-server/src/tools/observations.ts` — path resolution
- `mcp-server/src/tools/workflow.ts` — path resolution
- `mcp-server/src/tools/help.ts` — update documentation text
- `mcp-server/tests/storage/ledger-store.test.ts` — adapt path expectations
- `mcp-server/tests/integration/full-workflow.test.ts` — adapt path expectations
- `mcp-server/tests/schema/validators.test.ts` — update test data
- `.gitignore` — add `/mcp-server/data/`
- `mcp-server/AGENTS.md` — update if references ledger paths
- `mcp-server/README.md` — update architecture docs

### Directories to create at runtime
- `mcp-server/data/ledgers/` — created automatically by `atomicWriteJson`'s `mkdir({ recursive: true })` on first write

## Assumptions

- The plan folder basename (`YYYY-MM-DD-{name}`) is unique across all projects. This is already enforced by the date-prefix convention.
- The MCP server has write access to its own `data/` directory.
- No active projects currently rely on the `.ledger/` subfolder convention. If any do, they will need re-initialization.
- The existing files in `docs/agents/implementation-history/` are archival and do not need automated migration.

## Constraints

- The `project_path` parameter in all tool schemas must remain unchanged — agents already know how to provide it.
- The `path-validator.ts` validation logic (`YYYY-MM-DD-{name}` pattern check) remains the same.
- Atomic write and file locking guarantees must be preserved.
- The `data/` directory must be gitignored to prevent agents from discovering ledger JSON files in the repository tree.

## Out of Scope

- Migration tool for moving existing `.ledger/` data to the centralized location
- Multi-workspace support (the MCP server currently serves one workspace)
- Database-backed storage (remains file-based JSON)
- Cleanup of the archived ledger data in `implementation-history/`
- Changes to the agent persona files (they reference MCP tools, not file paths)

## Acceptance Criteria

- All MCP ledger tools continue to work with the same `project_path` parameter
- Ledger JSON files are stored under `mcp-server/data/ledgers/{project-id}/` instead of `{plan-dir}/.ledger/`
- No `.ledger/` directory or `.ledger.lock` file is created in plan directories
- `data/` directory is gitignored
- Root index includes the `project_path` for traceability
- All existing tests pass after adaptation to new paths
- `npm run build` succeeds with no TypeScript errors
- Lock file semantics and atomic write guarantees are preserved

## Testing Strategy

- **Unit tests**: New `path-resolver.test.ts` covering basename extraction, path combination, edge cases (trailing slashes, Windows paths)
- **Unit tests**: Updated `ledger-store.test.ts` verifying files are created in the correct centralized directory structure
- **Integration tests**: Updated `full-workflow.test.ts` exercising the full init → create WP → pipeline → complete flow with centralized storage
- **Schema tests**: Updated `validators.test.ts` with new `file` field format (`WP-001.json` instead of `ledger/WP-001.json`)
- **Manual verification**: Initialize a test project and confirm no files appear in the plan directory

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking change for active projects** | Document in changelog; since ledger data is operational (not committed), impact is limited to re-initializing active projects |
| **Data root resolution fails in different deployment contexts** | Use `__dirname`-relative resolution (already proven in `index.ts`); add fallback or env var override |
| **Windows path separator issues in project ID extraction** | Use Node.js `path.basename()` which handles OS-specific separators; already used in `path-validator.ts` |
| **Agents still provide wrong paths** | `project_path` parameter and validation remain unchanged; the internal resolution is transparent |
| **Gitignore not covering data files** | Add both `/mcp-server/data/` and `/mcp-server/data/**` patterns; verify with `git status` after first ledger creation |
| **Lock file contention in centralized directory** | Lock files remain per-project (one `.lock` per project ID), so contention model is unchanged |
