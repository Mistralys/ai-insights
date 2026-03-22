# Plan: Centralized Ledger Storage

## Summary

Migrate ledger data from per-plan `.ledger/` subdirectories to a centralized `mcp-server/storage/ledger/` location. This eliminates agent confusion (agents see `.ledger/` JSON files alongside plans and attempt to manipulate them directly), provides a clean separation between human-readable plan documents and machine-managed state, and enables cross-project discovery via per-project metadata files.

## Architectural Context

### Current Storage Model

Today, `LedgerStore` (in `src/storage/ledger-store.ts`) takes a `projectPath` (the absolute path to a plan folder like `.../docs/agents/plans/2026-02-16-feature`) and stores all ledger files inside `{projectPath}/.ledger/`:

```
docs/agents/plans/2026-02-16-feature/
├── plan.md                         ← human-readable
├── .ledger/                        ← machine-managed (agents get confused by these)
│   ├── project-ledger.json
│   ├── WP-001.json
│   └── WP-002.json
```

Key files involved:

| File | Role |
|------|------|
| `src/storage/ledger-store.ts` | Path helpers, read/write, dual-file sync |
| `src/storage/file-lock.ts` | `withLock()` acquires `.ledger.lock` in `projectPath` |
| `src/storage/atomic-writer.ts` | Write-to-temp-then-rename (unchanged) |
| `src/utils/path-validator.ts` | Validates `project_path` format (YYYY-MM-DD-{name}) |
| `src/tools/*.ts` | All 6 tool modules create `new LedgerStore(args.project_path)` |
| `src/schema/root-index.ts` | RootIndex schema (contains `plan_file` relative path) |

### Agent-Facing Contract

Every MCP tool accepts `project_path` as the absolute path to the plan directory. This serves as both the project identifier and the anchor for file resolution.

## Approach / Architecture

### New Storage Model

```
mcp-server/
└── storage/
    └── ledger/                          ← NEW: centralized ledger root
        ├── 2026-02-16-feature/          ← subfolder per project (= plan folder basename)
        │   ├── .meta.json               ← per-project metadata (status, dates, plan_path)
        │   ├── project-ledger.json
        │   ├── WP-001.json
        │   └── WP-002.json
        ├── 2026-02-20-other-project/
        │   ├── .meta.json
        │   ├── project-ledger.json
        │   └── WP-001.json
        └── .archive/                    ← future: completed projects moved here
```

### Key Design Decisions

1. **Subfolder naming** — Use the plan folder basename (e.g., `2026-02-16-feature`) as the ledger subfolder name. This is already enforced as unique by `path-validator.ts` (YYYY-MM-DD pattern). Deterministic, readable, no lookup required.

2. **API surface unchanged** — All MCP tools continue accepting `project_path`. `LedgerStore` internally resolves the basename → central storage location. This is fully backward-compatible from the agent perspective.

3. **Per-project metadata** — Each project subfolder contains a `.meta.json` file with project metadata (status, dates, plan path, title). This eliminates cross-project write contention entirely: each project's metadata is protected by its own existing project lock. Listing all projects = `readdir()` + read each `.meta.json` — no shared mutable file.

4. **Lock granularity** — Per-project locking moves to the central ledger subfolder. Since there is no shared registry file, no cross-project lock coordination is needed. Each project's `.meta.json` is written under the same lock as its `project-ledger.json`, preventing any contention between concurrent projects.

5. **Ledger root resolution** — The MCP server needs to know where the central ledger root is. This should be configurable via:
   - `--ledger-dir <path>` CLI argument (highest priority)
   - Default: resolve relative to the MCP server's own install location (`{serverDir}/storage/ledger/`)

6. **No migration** — Start fresh; no existing active project ledgers need to be preserved.

## Rationale

- **Eliminates the root problem**: Agents can no longer see or accidentally interact with raw ledger JSON files because they live outside the plan folder tree.
- **Clean plan folders**: Plans are purely human-readable markdown. The `.ledger` subfolder no longer clutters plan directories.
- **Zero cross-project contention**: Per-project `.meta.json` files eliminate shared-file write contention entirely. Multiple projects can be updated concurrently without any risk of lock conflicts.
- **Minimal blast radius**: By keeping `project_path` as the tool parameter and changing only the internal storage resolution, every tool handler requires only a constructor change — no parameter schema changes.
- **Archival-ready**: The directory-per-project model naturally supports future archival by moving completed project folders to a `.archive/` subdirectory, keeping the active project scan lean.

## Detailed Steps

### Step 1: Define Project Metadata Schema (NEW file)

Create `src/schema/project-meta.ts` with a Zod schema for per-project `.meta.json`:

```typescript
// .meta.json schema (one per project subfolder)
{
  "slug": "2026-02-16-feature",
  "plan_path": "f:\\project\\docs\\agents\\plans\\2026-02-16-feature",
  "status": "IN_PROGRESS",
  "date_created": "2026-02-16T10:00:00",
  "last_updated": "2026-02-18T14:30:00",
  "title": "Feature Implementation"    // optional, derived from plan_file
}
```

The schema should include:
- `ProjectMetaSchema` — per-project metadata entry
- Type export `ProjectMeta`

### Step 2: Add Ledger Root Resolution (NEW file)

Create `src/utils/ledger-root.ts`:

- Export `resolveLedgerRoot(): string` — returns the absolute path to the central ledger root
- Resolution order:
  1. `--ledger-dir <path>` CLI argument (parsed from `process.argv`)
  2. Default: `join(serverDir, 'storage', 'ledger')` where `serverDir` is the mcp-server package root
- Export `projectSlugFromPath(projectPath: string): string` — extracts the basename (plan folder name) to use as the subfolder name. This reuses the existing `path-validator.ts` basename-extraction logic.

### Step 3: Refactor `LedgerStore` (MODIFY `src/storage/ledger-store.ts`)

Change the internal path helpers so they resolve to the central storage location instead of `{projectPath}/.ledger/`:

| Method | Current | New |
|--------|---------|-----|
| `rootIndexPath()` | `{projectPath}/.ledger/project-ledger.json` | `{ledgerRoot}/{slug}/project-ledger.json` |
| `wpDetailPath(wpId)` | `{projectPath}/.ledger/{wpId}.json` | `{ledgerRoot}/{slug}/{wpId}.json` |
| `ledgerDirPath()` | `{projectPath}/.ledger` | `{ledgerRoot}/{slug}` |

Constructor changes:
- Accept `projectPath` as before (backward-compatible)
- Internally call `projectSlugFromPath(projectPath)` and `resolveLedgerRoot()` to derive the storage directory
- Store `planPath` (the original `projectPath`) for use in metadata operations

Add new methods:
- `async writeProjectMeta(planFile: string): Promise<void>` — write/update the project's `.meta.json` (protected by the same project lock)
- `async readProjectMeta(): Promise<ProjectMeta>` — read and validate the project's `.meta.json`
- `static async listAllProjects(ledgerRoot?: string): Promise<ProjectMeta[]>` — scan `ledgerRoot`, read each subfolder's `.meta.json`, return array of project metadata
- No separate lock needed — `.meta.json` is written under the existing project lock

### Step 4: Update `file-lock.ts` (MODIFY `src/storage/file-lock.ts`)

Change `withLock()` to lock on the **ledger subfolder** instead of `projectPath`:
- Lock path changes from `{projectPath}/.ledger.lock` to `{ledgerRoot}/{slug}/.lock`
- No registry-level lock needed — `.meta.json` writes are protected by the same per-project lock

### Step 5: Update `project-lifecycle.ts` (MODIFY `src/tools/project-lifecycle.ts`)

In `initializeProject()`:
- After writing the root index, also call `store.writeProjectMeta(args.plan_file)` to create the project's `.meta.json`

In `getProjectStatus()`:
- Keep self-healing logic as-is (it operates on the root index, which hasn't changed structurally)
- After self-healing writes, update `.meta.json` status if it drifted (lightweight sync within the same lock)

### Step 6: Add Metadata Sync to Write Operations

In `LedgerStore.writeRootIndex()` and `updateWorkPackageWithSync()`:
- After writing the root index, update the project's `.meta.json` with current `status` and `last_updated` fields
- This keeps metadata in sync without agents needing to do anything explicit
- No additional locking needed — the `.meta.json` write happens within the existing project lock scope

### Step 7: Add a `ledger_list_projects` Tool (NEW tool, optional but valuable)

Register a new tool in `src/tools/project-lifecycle.ts`:
- Calls `LedgerStore.listAllProjects()` which scans the central ledger root, reads each subfolder's `.meta.json`, and returns all projects with their status, dates, and plan paths
- No `project_path` needed — discovers projects from the central ledger directory
- Optional `status` filter parameter (e.g., list only `IN_PROGRESS` projects)
- Excludes the `.archive/` subdirectory from scanning (reserved for future archival)

### Step 8: Update `index.ts` Server Startup (MODIFY `src/index.ts`)

- Parse `--ledger-dir` CLI argument alongside existing `--agents-dir`
- Ensure the central ledger root directory exists at startup (`mkdir -p`)
- Log the resolved ledger root at startup for diagnostics

### Step 9: Update Path Validator (MODIFY `src/utils/path-validator.ts`)

- Export `planFolderBasename(projectPath: string): string` — extracts and returns the validated plan folder basename. This is used by `LedgerStore` and `ledger-root.ts` as the project slug.
- Refactor existing `validatePlanPath()` to reuse this extraction.

### Step 10: Update Help Tool (MODIFY `src/tools/help.ts`)

- Update inline documentation to reflect new storage location
- Add `ledger_list_projects` to the tool table (with optional `status` filter)
- Remove references to `.ledger/` subdirectories in plan folders

### Step 11: Update Tests

| Test File | Changes |
|-----------|---------|
| `tests/storage/ledger-store.test.ts` | Path assertions change from `.ledger/` to central storage paths. Mock or configure `resolveLedgerRoot()` to use temp directories. |
| `tests/integration/full-workflow.test.ts` | Same path resolution update; ensure `.meta.json` is created during project init. |
| `tests/integration/auto-handoff.test.ts` | Update `LedgerStore` construction if needed. |
| `tests/tools/pipeline.test.ts` | Ensure pipeline operations still work through centralized paths. |
| `tests/tools/work-package.test.ts` | Same. |
| `tests/tools/workflow-handoff.test.ts` | Same. |
| `tests/utils/path-validator.test.ts` | Add tests for new `planFolderBasename()` export. |
| **NEW** `tests/storage/project-meta.test.ts` | Per-project `.meta.json` read/write/validation tests and `listAllProjects()` scanning. |
| **NEW** `tests/utils/ledger-root.test.ts` | Ledger root resolution tests. |

### Step 12: Update Project Manifest

| Document | Updates Needed |
|----------|---------------|
| `docs/agents/project-manifest/README.md` | Update storage location references (`.ledger/` → `storage/ledger/`) |
| `docs/agents/project-manifest/file-tree.md` | Add `storage/ledger/` directory, `src/schema/project-meta.ts`, `src/utils/ledger-root.ts` |
| `docs/agents/project-manifest/api-surface.md` | Add `ProjectMetaSchema`, `resolveLedgerRoot()`, `planFolderBasename()`, `ledger_list_projects` tool, updated `LedgerStore` methods |
| `docs/agents/project-manifest/data-flows.md` | Update all flow diagrams to show central storage paths, add `.meta.json` sync flow |
| `docs/agents/project-manifest/constraints.md` | Update file lock paths, remove `.ledger` references, document `.meta.json` sync-under-project-lock rule |
| `AGENTS.md` | No changes needed (it references manifest docs, not storage paths directly) |

### Step 13: Add `storage/ledger/` to `.gitignore`

The `storage/ledger/` directory contains runtime data and should not be version-controlled. Add it to the MCP server's `.gitignore`.

## Dependencies

- No new npm dependencies required (`proper-lockfile` already handles all locking needs, `zod` handles `.meta.json` schema validation).
- `atomic-writer.ts` remains unchanged — it's path-agnostic.

## Required Components

### New Files
| File | Purpose |
|------|---------|
| `src/schema/project-meta.ts` | Zod schema for per-project `.meta.json` |
| `src/utils/ledger-root.ts` | Ledger root resolution and slug extraction |
| `tests/storage/project-meta.test.ts` | Project metadata tests (read/write/list) |
| `tests/utils/ledger-root.test.ts` | Ledger root resolution tests |
| `storage/ledger/.gitkeep` | Ensure directory exists in version control |

### Modified Files
| File | Nature of Change |
|------|-----------------|
| `src/storage/ledger-store.ts` | Path helpers, constructor, `.meta.json` methods, `listAllProjects()` static method |
| `src/storage/file-lock.ts` | Lock path change (no new lock functions needed) |
| `src/tools/project-lifecycle.ts` | `.meta.json` write on init, optional `ledger_list_projects` tool |
| `src/tools/help.ts` | Documentation updates |
| `src/utils/path-validator.ts` | Extract `planFolderBasename()` |
| `src/index.ts` | Parse `--ledger-dir`, ensure ledger root at startup |
| All test files | Path resolution updates |
| All 5 project manifest docs | Storage location references |

## Assumptions

- Plan folder basenames are unique across the system (enforced by the YYYY-MM-DD naming convention).
- The MCP server has write access to its own `storage/` directory.
- No existing active project ledgers need to be preserved (confirmed: start fresh).
- `.meta.json` consistency is best-effort — the root index remains the authoritative source of truth for project state; `.meta.json` is a convenience for cross-project discovery.
- The `.archive/` subdirectory is reserved for future use but not implemented in this iteration.

## Constraints

- **Backward-compatible tool API**: All MCP tool schemas remain unchanged — agents continue passing `project_path` as an absolute plan directory path.
- **Atomic writes**: All writes continue using `atomicWriteJson()`.
- **No cross-project lock contention**: Each project's `.meta.json` is written under its own project lock. No shared lock needed.
- **STDIO discipline**: No console.log — registry errors logged to stderr only.

## Out of Scope

- Migration script for existing `.ledger/` folders (confirmed: starting fresh).
- Multi-server access (only one MCP server instance writes to the ledger root).
- Project archival (moving completed project folders to `.archive/` — the directory structure supports it, but the `ledger_archive_project` tool is deferred to a future iteration).
- Changing agent personas or prompt files to reference new storage paths (agents don't interact with storage directly — that's the whole point).

## Acceptance Criteria

- [ ] `LedgerStore` resolves all file paths to `{ledgerRoot}/{slug}/` instead of `{projectPath}/.ledger/`.
- [ ] Per-project `.meta.json` is created/updated automatically when projects are initialized or their status changes.
- [ ] `ledger_list_projects` tool scans the ledger root directory, reads each `.meta.json`, and returns all active projects with status, dates, and plan paths.
- [ ] `ledger_list_projects` excludes the `.archive/` subdirectory from results.
- [ ] No `.ledger/` directory is created inside plan folders.
- [ ] All existing tests pass after path resolution refactoring.
- [ ] New tests cover registry CRUD and ledger root resolution.
- [ ] File locking works correctly with the new lock file locations.
- [ ] `--ledger-dir` CLI argument overrides the default ledger root.
- [ ] `storage/ledger/` is gitignored.
- [ ] All 5 project manifest documents are updated to reflect the new architecture.

## Testing Strategy

1. **Unit tests**: `project-meta.test.ts` validates schema parsing, `.meta.json` read/write, and `listAllProjects()` directory scanning (including `.archive/` exclusion). `ledger-root.test.ts` validates resolution logic and slug extraction.
2. **Storage tests**: Updated `ledger-store.test.ts` verifies paths resolve to central storage, `.meta.json` is updated on writes.
3. **Integration tests**: Updated `full-workflow.test.ts` and `auto-handoff.test.ts` exercise the full lifecycle through centralized storage.
4. **All tests use temp directories** — `resolveLedgerRoot()` must be injectable/overridable for testing (dependency injection via constructor parameter or a test-only override function).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`.meta.json` becomes stale** (status drifts from actual root index) | `.meta.json` is updated on every root index write within the same lock scope; root index remains authoritative source of truth |
| **`listAllProjects()` slow with many folders** | For realistic project counts (tens), `readdir` + N small file reads is negligible. Future archival of completed projects to `.archive/` keeps active folder count low |
| **Slug collision** (two plan folders with the same basename in different project trees) | Current path-validator enforces YYYY-MM-DD-{name} — collisions are extremely unlikely but would produce a clear error at init time |
| **Test isolation** — tests interfere via shared ledger root | Tests inject a temp directory as ledger root, no shared state |
| **`resolveLedgerRoot()` portability** — different machines have different install paths | `--ledger-dir` CLI override provides full control; default uses relative resolution from server entry point |
