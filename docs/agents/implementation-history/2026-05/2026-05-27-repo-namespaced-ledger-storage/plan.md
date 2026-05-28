# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.3.1
- Architectural Reviews: 1 — Plan Architect Reviewer v1.4.0

## Summary

Introduce repository-level namespacing to the centralized ledger storage layout, changing the structure from `{ledgerRoot}/{slug}/` to `{ledgerRoot}/{repo-name}/{slug}/`. This eliminates slug collisions when multiple repositories create identically-named plan folders (e.g., `2026-04-23-create-comtype`) for cross-repository features. A one-time idempotent migration moves existing project directories into their respective repository namespace.

## Architectural Context

The MCP ledger server stores all project data under a single flat directory (`mcp-server/storage/ledger/`). Each project occupies a directory named by its slug — the basename of the plan folder (e.g., `2026-04-23-create-comtype`). The slug is the sole unique identifier in the storage namespace.

**Key modules and files:**

| File | Role |
|------|------|
| `mcp-server/src/storage/ledger-store.ts` | Core storage class; `storageDir` is `join(ledgerRoot, slug)` |
| `mcp-server/src/utils/ledger-root.ts` | `resolveLedgerRoot()`, `projectSlugFromPath()`, `inferProjectRootFromPlanPath()` |
| `mcp-server/src/utils/path-validator.ts` | `planFolderBasename()` — validates slug format |
| `mcp-server/src/schema/project-meta.ts` | `ProjectMetaSchema` — already has `repository_name` field |
| `mcp-server/src/tools/project-lifecycle.ts` | `initializeProject()` — derives `repository_name` from path |
| `mcp-server/src/gui/auto-archive.ts` | Iterates all projects via `listAllProjects()` |
| `mcp-server/src/gui/handlers/run-log-handlers.ts` | Constructs per-project log paths |
| `orchestrator/src/nodes/__init__.py` | `_derive_slug_dir()` — constructs ledger path for dialogues/chunks |
| `orchestrator/src/cli.py` (line 870) | Constructs ledger log copy path directly |

**The `repository_name` is already derived at initialization** via `basename(inferProjectRootFromPlanPath(projectPath))` and stored in `.meta.json`. This existing derivation becomes the namespace key.

## Approach / Architecture

### New Storage Layout

```
{ledgerRoot}/
├── gui-config.json                         # Global config (unchanged)
├── .archive/                               # Reserved (unchanged)
├── ai-insights/                            # ← NEW: repo namespace
│   ├── 2026-04-23-create-comtype/
│   │   ├── .meta.json
│   │   ├── project-ledger.json
│   │   └── ...
│   └── 2026-05-01-other-feature/
├── ai-persona-builder/                     # ← NEW: repo namespace
│   ├── 2026-04-23-create-comtype/          # ← Same slug, no collision!
│   │   ├── .meta.json
│   │   └── ...
│   └── ...
└── unknown/                                # Fallback for projects without repo name
```

### LedgerStore Changes

The `LedgerStore` constructor gains a `repoName` dimension:

```
storageDir = join(ledgerRoot, repoName, slug)
```

Where `repoName` is derived from:
1. An explicit parameter (when the caller already knows it), OR
2. `basename(inferProjectRootFromPlanPath(projectPath))` — the same derivation already used for the `repository_name` enrichment field.

### listAllProjects() Changes

Instead of scanning one level deep, the method scans two levels:
1. First level: repository namespace directories
2. Second level: project slug directories (containing `.meta.json`)

The existing skip rules (dot-prefixed directories, non-directories) still apply at both levels.

### Composite Identifier

The full project identifier becomes `{repo-name}/{slug}` (e.g., `ai-insights/2026-04-23-create-comtype`). Tool inputs that currently accept only a `slug` string will accept either:
- A bare slug (backward compatible — resolves by scanning all repo namespaces; errors if ambiguous)
- A qualified `{repo}/{slug}` composite (unambiguous)

The route layer splits `{repo}/{slug}` into two separate URL parameters; each is individually validated by `assertSafeSlug`. The `assertSafeSlug` guard is never modified — it continues to reject `/` by design.

### Migration Strategy

An idempotent migration runs on server startup:
1. Scan `{ledgerRoot}` for directories that contain `.meta.json` at depth 1 (old layout)
2. Read `repository_name` from each `.meta.json`
3. Move the directory into `{ledgerRoot}/{repository_name}/{slug}/`
4. For entries without `repository_name`, move to `{ledgerRoot}/unknown/{slug}/`
5. Skip entries already at depth 2 (already migrated)

## Rationale

- **Structural isolation guarantees no collision** regardless of agent naming discipline.
- **`repository_name` already exists** in `.meta.json` — no new data derivation needed.
- **Filesystem namespacing is simple and debuggable** — a developer can `ls` the ledger root and immediately see the organizational structure.
- **Backward-compatible bare-slug resolution** avoids breaking existing tool calls in plan documents or agent memory that reference slugs without a repo prefix.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Namespace mechanism | Filesystem subdirectory per repo | Composite slug prefix (`repo--slug`), database-level isolation, slug suffix convention | Subdirectories are visually clear, debuggable with standard filesystem tools, and don't pollute the slug (which appears in log filenames, UI, etc.) |
| Namespace key | `repository_name` from dirname of inferred project root | Package.json `name` field, git remote URL hash, user-specified label | Dirname is already derived, requires no config, and produces human-readable namespace names |
| Bare slug resolution | Scan all namespaces, error on ambiguity | Require fully-qualified IDs from day one | Backward compat is important since existing workflows reference bare slugs; ambiguity errors only fire when collision actually exists |
| Migration trigger | Server startup (idempotent, self-healing) | CLI migration command, version flag in config | Startup migration is invisible to the user and guarantees no stale layout persists |

## Pattern Alignment

- **Atomic file I/O** (`mcp-server/docs/agents/project-manifest/constraints.md` §1): All directory moves during migration will use atomic rename where possible; non-atomic cross-device moves will write-then-verify.
- **File locking** (`mcp-server/src/storage/file-lock.ts`): Migration does NOT use `withLock` — passing `ledgerRoot` to `withLock` is explicitly forbidden by Constraint §2. Race freedom is a timing guarantee, not an architectural one: migration runs synchronously before the first `await` that could yield to the event loop for incoming STDIO messages. A `.migration-in-progress` sentinel file at `ledgerRoot` guards against unexpected re-entry (e.g., a crash mid-migration).
- **Self-healing migration pattern** (`mcp-server/src/gui/handlers/run-log-handlers.ts`): The run log handlers already implement an idempotent legacy migration on access — this plan follows the same pattern at server startup.
- **Cross-platform paths** (`AGENTS.md` §Cross-Platform Policy): All path construction uses `path.join()` / `pathlib.Path`; no hardcoded separators.
- **Migration state file** (`{ledgerRoot}/.migration-state.json`): Migration state is tracked in a dedicated file — not in `gui-config.json` — to avoid the self-healing auto-recreate that would silently reset the guard. Written via `atomicWriteJson` after all moves succeed.

## Detailed Steps

### Phase 1: Core Storage Layer (MCP Server — TypeScript)

1. **Add `repoName` derivation to `LedgerStore`.**
   - In `mcp-server/src/utils/ledger-root.ts`, add a new exported function `deriveRepoName(projectPath: string): string` that returns `basename(inferProjectRootFromPlanPath(projectPath))` with a safe-slug validation (alphanumeric + hyphens, lowercase, fallback to `unknown`).
   - Modify `LedgerStore` constructor to compute `this.repoName = deriveRepoName(projectPath)` and set `this.storageDir = join(this.ledgerRoot, this.repoName, this.slug)`.
   - Update `renameSlug(newSlug: string)`: the target path must be `join(this.ledgerRoot, this.repoName, newSlug)`, not the flat `join(this.ledgerRoot, newSlug)`. Update the conflict-check `access()` call to use the same namespaced target.

2. **Update `listAllProjects()` to scan two levels.**
   - Modify the static method to iterate repo-namespace directories first, then project directories within each.
   - Maintain backward compat: if a directory at level 1 contains `.meta.json` directly (old layout), include it but flag it for migration.

3. **Update `detectProjectByCwd()`.**
   - No logic change needed — it already calls `listAllProjects()` and uses `meta.plan_path` for matching. The scan change in step 2 is sufficient.

4. **Add startup migration.**
   - New file: `mcp-server/src/storage/migrate-namespaced.ts`
   - Exports `migrateToNamespacedLayout(ledgerRoot: string): Promise<MigrationResult>`
   - Idempotent: reads `{ledgerRoot}/.migration-state.json`; skips if `storage_version >= 2`. On ENOENT, proceeds with migration.
   - Before moving any directories, writes a `.migration-in-progress` sentinel file at `ledgerRoot`. Removes it after all moves succeed.
   - `withLock` is never called with `ledgerRoot` (Constraint §2 forbids this). Race freedom is achieved by timing: migration completes before the first `await` that could yield to the event loop for incoming STDIO messages.
   - Moves each depth-1 project directory into the appropriate repo-namespace subdirectory.
   - On successful completion, writes `{ "storage_version": 2 }` to `{ledgerRoot}/.migration-state.json` via `atomicWriteJson`. Does NOT modify `gui-config.json`.
   - **Insertion point in `mcp-server/src/index.ts`:** after `mkdirSync(ledgerRoot, { recursive: true })` and before `readConfigFromDisk(configPath)`. This ensures the ledger root directory exists before migration runs and migration completes before any config reads.

5. **No change to `ProjectMetaSchema`.**
   - `ProjectMetaSchema` receives no new field. `deriveRepoName()` normalizes `repository_name` at call time (lowercase, `unknown` fallback) — callers use the normalized value as the filesystem namespace key.
   - Existing `.meta.json` files remain fully valid with no schema migration required.

6. **Add slug resolution helper.**
   - New function `resolveProjectDir(slugOrQualified: string, ledgerRoot: string): string` that:
     - If input contains `/`, splits into `{repo}/{slug}` and returns `join(ledgerRoot, repo, slug)`.
     - If bare slug, scans all repo directories for a match; throws if ambiguous (with list of matches).
   - Used by any tool handler that receives a slug from external input (currently only the GUI handlers).

### Phase 2: Orchestrator Updates (Python)

7. **Update `_derive_slug_dir()` in `orchestrator/src/nodes/__init__.py`.**
   - Compute `repo_name` from `Path(project_path).parents[3].name` (same 4-level-up logic as TypeScript).
   - Return `workspace_root / "mcp-server" / "storage" / "ledger" / repo_name / slug`.

8. **Update log copy path in `orchestrator/src/cli.py` (line 870).**
   - Derive `repo_name` from `plan_dir.parents[3].name`.
   - Construct: `config.workspace_root / "mcp-server" / "storage" / "ledger" / repo_name / slug / "orchestrator" / "logs"`.
   - Note: the `ledger_log_dir` assignment spans lines 869–872 (not a single line 870 as originally referenced).

9. **Update `dialogue_writer.py` and `chunk_writer.py` callers.**
   - These receive `slug_dir` as a parameter from `_derive_slug_dir()` — no change needed in the writers themselves, only in the callers that construct `slug_dir`.

### Phase 3: GUI Handlers

10. **Update `mcp-server/gui/server.ts`.**
    - `gui/server.ts` directly constructs `join(ledgerRoot, slug, 'orchestrator', 'logs')` paths (lines 477 and 495) and is the entry point for `/:slug` route dispatch. Both must be updated:
      - Replace the direct `join(ledgerRoot, slug, …)` path constructions with the namespaced `join(ledgerRoot, repoName, slug, …)` form, deriving `repoName` from the resolved meta.
      - Add `/:repo/:slug` route variants alongside the existing `/:slug` routes, passing `req.params.repo` and `req.params.slug` as separate validated strings.

11. **Update `mcp-server/src/gui/handlers/run-log-handlers.ts`.**
    - The `logsDir` and legacy migration paths need to include the repo-name level.
    - Handlers are updated to accept a `repoName` parameter alongside the existing `slug` parameter. `run-log-handlers.ts` uses a loose traversal-only guard (`includes('/')` / `includes('..')`) rather than the strict `SAFE_SLUG_REGEX`. Both `repoName` and `slug` must be validated against `SAFE_SLUG_REGEX` at the handler entry point to prevent silent wrong-path construction from uppercase or otherwise non-normalizable inputs. No composite string is passed; the route layer splits `repo` and `slug` into separate values before calling the handler.

12. **Update `mcp-server/gui/api.ts` routes and `LedgerStore` construction.**
    - Add `/:repo/:slug` routes alongside existing `/:slug` routes. The `/:repo/:slug` route passes `req.params.repo` and `req.params.slug` as separate validated strings — one `assertSafeSlug` call per segment, no modification to the guard. The `/:slug` route retains the existing bare-slug resolution fallback.
    - `gui/api.ts` has ~14 call sites using `new LedgerStore(slug, ledgerRoot)` or `new LedgerStore(meta.slug, ledgerRoot)`. After the constructor change, bare-slug construction will derive an incorrect `repoName`. Migrate all call sites:
      - Where a full `meta` object is available from `listAllProjects()`: replace `new LedgerStore(meta.slug, ledgerRoot)` with `new LedgerStore(meta.plan_path, ledgerRoot)` (the pattern already used in `auto-archive.ts`).
      - For URL-parameter-driven lookups (where only `slug` or `repo` + `slug` is available from URL params): route through `resolveProjectDir()` to obtain the storage path, then read `.meta.json` to get `plan_path`, then construct the store with `new LedgerStore(meta.plan_path, ledgerRoot)`.

### Phase 4: Configuration & Documentation

13. **No change to `gui-config.json` schema.**
    - `GuiConfigSchema` stays unchanged — no new `storage_version` field. Migration state is tracked in `{ledgerRoot}/.migration-state.json` independently via `atomicWriteJson`. This avoids the self-healing behaviour of `gui-config.json` (which auto-recreates with defaults on ENOENT, which would silently reset the migration guard).

14. **Update project manifest documentation.**
    - `mcp-server/docs/agents/project-manifest/data-flows.md` — document new storage layout.
    - `mcp-server/docs/agents/project-manifest/constraints.md` — add constraint for repo-namespaced paths.
    - `mcp-server/docs/agents/project-manifest/file-tree.md` — update storage directory listing.

15. **Update root `AGENTS.md`.**
    - Cross-System Dependencies table: add entry for ledger storage layout.

## Dependencies

- Phase 2 depends on Phase 1 being complete (orchestrator must write to new paths only after migration has run).
- Phase 3 depends on Phase 1 (GUI handlers use the updated `listAllProjects()`).
- Phase 4 can proceed in parallel with Phases 2–3.

## Required Components

- `mcp-server/src/storage/ledger-store.ts` — modify constructor + `listAllProjects()` + `renameSlug()`
- `mcp-server/src/utils/ledger-root.ts` — add `deriveRepoName()`
- `mcp-server/src/storage/migrate-namespaced.ts` — **new file** (migration logic)
- `mcp-server/src/schema/project-meta.ts` — no change (schema unchanged; `repository_name` normalization applied at call site)
- `mcp-server/src/index.ts` — call migration on startup
- `orchestrator/src/nodes/__init__.py` — update `_derive_slug_dir()`
- `orchestrator/src/cli.py` — update log copy path
- `mcp-server/src/gui/handlers/run-log-handlers.ts` — update path construction + `repoName` parameter
- `mcp-server/gui/server.ts` — update direct `join(ledgerRoot, slug, …)` path constructions + add `/:repo/:slug` routes
- `mcp-server/gui/api.ts` — add `/:repo/:slug` routes + migrate `new LedgerStore(slug, …)` call sites to use `meta.plan_path`
- `mcp-server/docs/agents/project-manifest/` — update data-flows, constraints, file-tree

## Assumptions

- Every project's `plan_path` follows the `{project-root}/docs/agents/plans/{slug}` convention (the 4-level-up inference is reliable). This is already validated by `planFolderBasename()`.
- The `repository_name` in `.meta.json` is present for all actively-used projects (it was added in an early version of the enrichment system). Projects without it will be placed in `unknown/`.
- The ledger root directory is local to the machine (no shared network filesystem) — atomic renames are reliable.
- Concurrent tool-call races during migration are practically impossible: migration runs synchronously before the first `await` that could yield to the event loop for incoming STDIO messages. This is a timing guarantee, not an architectural one — `server.connect(transport)` is called before `resolveLedgerRoot()` in the current startup order; migration must be inserted immediately after `mkdirSync(ledgerRoot, …)` to ensure the ledger root exists first.

## Constraints

- **Backward compatibility:** Bare slug resolution must continue to work for existing tool calls and plan documents that reference slugs without repo qualification.
- **Cross-platform:** All path operations must use `path.join()`/`pathlib.Path`. The repo-name directory must be valid on Windows, macOS, and Linux (the existing slug validation regex already ensures this).
- **Idempotent migration:** Running the migration multiple times must be safe. The `storage_version` flag prevents re-processing.
- **No data loss:** The migration is a directory move, not a copy-and-delete. If the move fails, the original directory remains untouched.
- **`withLock` constraint:** `withLock` must never be called with `ledgerRoot` per Constraint §2. Migration uses the `.migration-in-progress` sentinel file + synchronous pre-yield timing instead.
- **`assertSafeSlug` integrity:** The `assertSafeSlug` guard must not be modified or bypassed. Composite slug routing is achieved via separate URL params (`/:repo/:slug`), not via composite strings passed to a single param.

## Out of Scope

- Multi-tenancy or user-level isolation (this plan scopes to repository-level only).
- Changing the plan folder naming convention on disk (plan folders remain `{date}-{name}`).
- Retroactively fixing historical slug collisions that may have already corrupted data (manual intervention needed for those specific cases).
- GUI redesign to show repo grouping (the GUI can display `repository_name` from meta, but no new views are in scope).
- Changing the orchestrator's own log directory structure (`orchestrator/logs/`) — only the ledger copy target changes.

## Acceptance Criteria

- Two projects with identical slugs but different `repository_name` values coexist without collision in the ledger.
- `listAllProjects()` returns projects from all repo namespaces.
- `detectProjectByCwd()` continues to find the correct project when CWD is inside a repository.
- A bare slug that is unique across all repos resolves successfully.
- A bare slug that exists in multiple repos returns an `AMBIGUOUS` error with guidance.
- Qualified `{repo}/{slug}` input always resolves unambiguously.
- Existing ledger data is migrated correctly on first startup with the new code.
- The orchestrator writes logs and dialogues to the correct namespaced path.
- All existing tests pass after the refactor (with updated path expectations).
- The migration is idempotent — repeated runs produce no changes.

## Testing Strategy

Unit tests for the new derivation and resolution functions. Integration tests that set up both old-layout and new-layout ledger directories and verify detection, listing, and migration. The existing test helper `createTempStore` will be updated to produce namespaced layouts.

## Test Plan

- `mcp-server/tests/utils/derive-repo-name.test.ts` — **new** — Validates `deriveRepoName()` for standard paths, Windows paths, edge cases (root-level project, missing segments), and fallback to `unknown`. Covers: acceptance criterion "repo-name derivation".
- `mcp-server/tests/storage/migrate-namespaced.test.ts` — **new** — Tests migration from flat to namespaced layout: single project, multiple projects, projects without `repository_name`, already-migrated ledger (idempotent), mixed layouts. Covers: acceptance criteria "migration" and "idempotent".
- `mcp-server/tests/storage/ledger-store.test.ts` — **modify** — Update existing `storageDir` assertions to expect the repo-name level. Add test for two stores with same slug but different repo names producing different `storageDir` values. Add test for `renameSlug()`: confirm the rename moves to `{ledgerRoot}/{repoName}/{newSlug}` and not the flat `{ledgerRoot}/{newSlug}`. Extend the existing `describe('LedgerStore.detectProjectByCwd', …)` block with namespace-aware scenarios. Covers: acceptance criteria "no collision", "renameSlug namespace", "detectProjectByCwd".
- `mcp-server/tests/storage/list-all-projects.test.ts` — **new or extend** — Tests `listAllProjects()` with namespaced layout, mixed legacy+namespaced, empty namespaces. Covers: acceptance criterion "lists all projects".
- `mcp-server/tests/storage/slug-resolution.test.ts` — **new** — Tests `resolveProjectDir()` with bare unique slug, bare ambiguous slug, qualified slug, invalid input. Covers: acceptance criteria "bare slug" and "qualified slug".
- `mcp-server/tests/gui/run-log-handlers.test.ts` — **modify** — Update handler call signatures to pass the new `repoName` parameter alongside `slug`. Add tests for namespaced `logsDir` path construction. Covers: Step 11 handler changes.
- `mcp-server/tests/gui/api.test.ts` — **modify** — Update `new LedgerStore(…)` call patterns to use `meta.plan_path`. Add tests for `/:repo/:slug` route dispatch. Covers: Step 12 route and store-construction changes.
- `mcp-server/tests/gui/run-log-server.test.ts` — **modify** — Add route-level tests for the `/:repo/:slug` dispatch through `gui/server.ts`. Covers: Step 10 route changes.
- `orchestrator/tests/test_slug_dir.py` — **new** — Tests the updated `_derive_slug_dir()` returns paths with the repo-name level. Covers: acceptance criterion "orchestrator writes to correct path".

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add section on namespaced storage layout; update storage path references.
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add constraint: "Ledger storage paths must include the repository namespace level."
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Update `storage/ledger/` tree to show repo-name level.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document `deriveRepoName()`, `resolveProjectDir()`, `migrateToNamespacedLayout()`.
- `AGENTS.md` (root) — Update Cross-System Dependencies table with new orchestrator path convention.
- `orchestrator/docs/agents/project-manifest/constraints.md` — Document the repo-name derivation for ledger paths.
- `.context/` — Regenerate via `node scripts/cli.js ctx-generate` after all implementation changes are committed (repo-namespacing is a workspace-level structural change per AGENTS.md §Generated Context Docs).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Migration fails mid-way (crash during directory moves)** | Each move is independent; the `storage_version` flag is only written after all moves succeed. On next startup, unmoved directories are re-attempted. |
| **`repository_name` is null for some projects** | Fallback to `unknown/` namespace; these can be manually relocated later. |
| **Orchestrator runs during migration window** | Migration completes before the MCP transport is connected, so no tool calls (from the orchestrator or any other caller) can arrive during migration. There is no race window to guard against. |
| **Bare slug ambiguity causes confusion** | Clear error message listing all matching repos + guidance to use qualified form. |
| **Windows path case sensitivity** | `deriveRepoName()` normalizes to lowercase on Windows (matching existing `detectProjectByCwd` behavior). |
| **Cross-device rename failure (if ledgerRoot is on different mount)** | Detect EXDEV error and fall back to copy+delete with verification. |
