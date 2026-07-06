# Plan: Multi-Store Ledger Architecture

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: 1 — Plan Architect Reviewer v1.6.0

## Prior Project Context

No prior projects in the ledger addressed cross-device sync or multi-store storage. The repository has 8 tracked projects, primarily focused on persona build pipelines, dialogue rendering, and agent workflow features. No relevant knowledge base insights exist for storage architecture changes. This plan introduces a new architectural capability with no precedent in the codebase.

## Summary

Introduce a multi-store ledger architecture that allows the MCP server to manage multiple independent ledger root directories simultaneously. Each store is a self-contained directory tree with its own projects, knowledge base, and configuration. Store routing is handled through the **existing repository registry** — each registered repository is assigned to a store, and repository registration becomes mandatory for project creation. Unregistered repositories produce a clear error. Sync is entirely the user's responsibility — the MCP server only sees local directories on disk. This solves cross-device workflows and personal/company data separation without coupling the MCP server to any sync mechanism.

## Architectural Context

The current storage layer funnels through a single `resolveLedgerRoot()` function in `mcp-server/src/utils/ledger-root.ts`, which returns one directory path (from `--ledger-dir` CLI arg or the default `mcp-server/storage/ledger/`). Every component — `LedgerStore`, `KnowledgeStoreManager`, GUI config, repository registry — uses this single root:

- **`LedgerStore`** constructor: `storageDir = join(ledgerRoot, repoName, slug)`
- **`KnowledgeStoreManager`** constructor: `knowledgeDir = join(ledgerRoot, '.knowledge')`
- **GUI config**: `join(ledgerRoot, 'gui-config.json')`
- **Repository registry**: `join(ledgerRoot, '.repositories.json')`
- **`listAllProjects()`**: two-level filesystem scan of one root
- **`detectProjectByCwd()`**: scans all projects from one root

All tool implementations call `resolveLedgerRoot()` implicitly via `LedgerStore` construction or explicit calls. The `ledgerRoot` parameter is threaded as optional through static methods and the constructor, overridden only in tests.

Key files:
- `mcp-server/src/utils/ledger-root.ts` — ledger root resolution
- `mcp-server/src/storage/ledger-store.ts` — central storage abstraction
- `mcp-server/src/storage/knowledge-store.ts` — knowledge CRUD
- `mcp-server/src/storage/repository-registry.ts` — `.repositories.json` I/O
- `mcp-server/src/index.ts` — server startup and initialization
- `mcp-server/src/tools/project-lifecycle.ts` — project listing/detection tools
- `mcp-server/src/tools/knowledge.ts` — knowledge tools
- `mcp-server/src/tools/repository-context.ts` — repository context aggregation
- `mcp-server/src/gui/config.ts` — runtime config singleton
- `mcp-server/gui/api.ts` — GUI REST API handlers

## Approach / Architecture

### Core Concept: Repository-Driven Store Routing

The design leverages the **existing repository registry** (`.repositories.json`) as the routing mechanism for stores. Instead of introducing a separate `repo_assignments` mapping, each `RepositoryEntry` gains a `store_id` field that links it to a store. Repository registration — which is currently optional — becomes **mandatory for project creation** in multi-store mode. Unregistered repositories produce a clear error: *"Repository 'X' is not registered. Register it first via the GUI or CLI."*

This eliminates the need for new tool parameters. The store is always resolved from the repository, which is already derived from the project path.

Four components work together:

1. **`stores.json`** — A registry file at `~/.ai-insights/stores.json` (user-level) listing independent ledger root directories. No repo-to-store mapping here — that lives in the repository registry.

2. **`StoreRegistry`** — A module (`mcp-server/src/storage/store-registry.ts`) that reads/writes `stores.json`, validates its schema, and provides lookup methods. Handles the backward-compatible fallback: no `stores.json` → single-store mode using `resolveLedgerRoot()`.

3. **`StoreRouter`** — A module (`mcp-server/src/storage/store-router.ts`) that resolves which store to use for a given operation. For writes: loads the repository registry, finds the entry for the repo name, reads its `store_id`, and returns the corresponding store path. If the repo is not registered, it throws an error. For reads: iterates all stores.

4. **`MultiStoreManager`** — A module (`mcp-server/src/storage/multi-store-manager.ts`) that provides collated read operations across all stores (list projects, search knowledge, detect project by cwd). Tags results with `store_id` and `store_label` for downstream consumers.

### Repository Registry Changes

The existing `RepositoryEntrySchema` (`mcp-server/src/schema/repository-registry.ts`) gains one new field:

```typescript
store_id: z.string().regex(SLUG_REGEX).nullable()  // null = default store
```

This field links a repository to a store defined in `stores.json`. When `store_id` is `null`, the repository uses the default store. In single-store mode (no `stores.json`), the field is ignored — all repos use the single ledger root.

### Write Routing Flow

```
Tool invocation (e.g., ledger_initialize_project)
  ↓
resolveProjectPath(args) → projectPath
  ↓
repoName = deriveRepoName(projectPath)
  ↓
storeRouter.resolveStoreForWrite(repoName)
  1. If no stores.json → legacy resolveLedgerRoot() (single-store mode)
  2. Load repository registry (central, not per-store)
  3. Find entry where folder_names includes repoName
  4. If not found → ERROR: "Repository 'X' is not registered"
  5. Read entry.store_id → resolve to store path (null = default store)
  ↓
ledgerRoot = resolved store path
  ↓
new LedgerStore(projectPath, ledgerRoot)
  ↓
(normal write flow — unchanged)
```

### Read Collation Flow

```
ledger_list_projects(status?)
  ↓
multiStoreManager.listAllProjects(status?)
  ↓
for each store in stores.json:
  projects = LedgerStore.listAllProjects(store.path)
  tag each with { store_id, store_label }
  ↓
merge into unified list
  ↓
return to agent
```

### Directory Layout

```
~/.ai-insights/                       # User-level config directory
├── stores.json                       # Store definitions (id, label, path)
├── .repositories.json                # Central repository registry (with store_id per entry)
├── gui-config.json                   # Server-wide GUI configuration (not per-store)
└── stores/                           # Default location for store directories
    ├── personal/                     # Store 1 — user manages sync
    │   ├── .knowledge/
    │   ├── my-side-project/
    │   │   └── 2026-07-01-feature/
    │   │       └── …
    │   └── …
    └── work/                         # Store 2 — user manages sync
        ├── .knowledge/
        └── ai-insights/
            └── 2026-05-01-plan/
                └── …
```

Note: `.repositories.json` resolves to a single canonical path via `resolveRegistryPath()`: if `~/.ai-insights/.repositories.json` exists, it is used; otherwise, the legacy path `{ledgerRoot}/.repositories.json` is used. On first load from the legacy location when `~/.ai-insights/` exists, the registry is automatically migrated to the central location. This avoids a mode-dependent code-path bifurcation — every consumer calls the same resolution function regardless of single-store or multi-store mode.

### Backward Compatibility

- **No `stores.json`** → system behaves exactly as today. `resolveLedgerRoot()` returns the single root. All read/write operations use it. Repository registration remains optional (as it is today). `.repositories.json` resolves via `resolveRegistryPath()` — uses `~/.ai-insights/.repositories.json` if that directory exists, otherwise `{ledgerRoot}/.repositories.json`.
- **`--ledger-dir` flag** → overrides the default store path, making multi-store transparent for single-store users.
- **Existing data** → stays in place. Users opt into multi-store by creating `stores.json` and registering their repositories with store assignments.

### Entry Points for Store Selection

No new `store_id` parameters are needed on any tool. All entry points resolve the store via the repository:

| Entry Point | Store Resolution |
|---|---|
| **MCP tools** (`ledger_initialize_project`, etc.) | `deriveRepoName(projectPath)` → repository registry lookup → `store_id` → store path |
| **Orchestrator** (`orchestrate --plan <path>`) | Same — the plan path determines the repo name, which determines the store |
| **GUI** (future project creation) | User selects repository (which already has a store assignment) — store is implicit |
| **CLI** (`store assign`) | Only used for initial repository-to-store configuration |

## Rationale

1. **Clean separation of concerns.** The MCP server reads and writes local JSON files — exactly what it does today. It has no knowledge of Git, S3, Syncthing, or any sync mechanism. This eliminates network errors, auth failures, and merge conflicts from the MCP server's codepath.
2. **User freedom.** Each store can use a different sync strategy — personal store on GitHub, work store on company GitLab, experimental store with no sync. The user picks what works for their environment.
3. **Privacy by architecture.** Company and personal data live in separate directory trees. No filtering, no ACLs, no risk of accidental cross-contamination — the boundary is physical.
4. **Reuses existing infrastructure.** The repository registry already exists (`.repositories.json`, `RepositoryEntrySchema`, GUI CRUD endpoints, `findByFolderName()`). Adding a `store_id` field to repository entries is a minimal schema change that avoids inventing a parallel routing system.
5. **No new tool parameters needed.** Store routing is implicit — derived from the repository, which is derived from the project path. Agents, orchestrator, and GUI don't need to learn a new `store_id` concept in their tool calls.
6. **Explicit over implicit.** Requiring repository registration before project creation makes the system predictable. Users always know which store a project will land in because they configured it when registering the repository. The alternative — silently routing unregistered repos to the default store — was rejected because it creates "where did my project go?" confusion: a user who intends to use their work store but forgets to register would silently create projects in the personal/default store, discovering the mistake only after data has accumulated in the wrong location. The registration error is a one-time friction that prevents an ongoing class of misconfiguration. In single-store mode (no `stores.json`), registration remains optional — no friction for users who don't need multi-store.
7. **Backward compatible.** No `stores.json` = single-root behavior, identical to today. Repository registration remains optional in single-store mode.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Sync mechanism | User-managed (external to MCP server) | Built-in Git sync hooks (auto-commit on write, auto-pull on startup); S3 backup export; CouchDB/PouchDB bidirectional sync | Keeping sync external eliminates an entire class of failure modes (network, auth, merge conflicts) from the MCP server's codepath. Git is recommended to users but never required. |
| Store configuration location | `~/.ai-insights/stores.json` (user-level) | Inside the default store (chicken-and-egg on new devices); environment variable; `--stores-config` CLI flag | User-level config survives reinstalls, is not coupled to any single store, and avoids bootstrap problems on new machines. |
| Multi-store vs. single repo approaches | Independent store directories | Git subtrees per repo namespace; selective push scripts; tag-based ACL filtering | Independent stores are the simplest mental model — each is self-contained, can be reasoned about independently, and maps cleanly to separate sync remotes. Subtrees and selective push are fragile and break Git's model. |
| Write routing | Repository registry with `store_id` field | Separate `repo_assignments` map in `stores.json`; new `store_id` parameter on tools; pattern matching (glob rules); always-prompt | Repository-driven routing reuses existing infrastructure, requires no new tool parameters, and makes store selection explicit at registration time. A separate assignments map duplicates the repo-to-store relationship that the registry already manages. Tool parameters would burden every agent invocation. |
| Knowledge cross-store behavior | Per-store knowledge, cross-store search on reads | Single merged knowledge store; no cross-store search | Per-store keeps company insights out of personal sync remotes. Cross-store read search is safe (all data is local) and maximizes knowledge utility. |
| Module decomposition | StoreRegistry + StoreRouter + MultiStoreManager (3 modules) | (A) Single `MultiStoreManager` combining registry I/O, routing, and collation; (B) 4 modules with a separate `store-context.ts` singleton accessor | The 3-module shape cleanly separates by concern: Registry = I/O, Router = single-store resolution, Manager = cross-store collation. A single module conflates I/O with business logic. A 4th singleton module introduces a startup-ordering contract (`initStoreContext` must be called before `getStoreRouter`) that the existing codebase avoids — `resolveLedgerRoot()` is pure and stateless. |
| `.repositories.json` location | Single canonical path via `resolveRegistryPath()` (prefers `~/.ai-insights/`, falls back to `{ledgerRoot}/`) | (A) Mode-dependent: `{ledgerRoot}/` in single-store, `~/.ai-insights/` in multi-store; (B) Always at default store root; (C) Always at `~/.ai-insights/` regardless of mode | A single resolution function eliminates the code-path bifurcation that a mode-dependent approach would impose on every consumer of the registry. The fallback to `{ledgerRoot}/` preserves backward compatibility for users who haven't run `install-mcp-global`. |
| GUI restructuring scope | Deferred to follow-up plan; minimal `store_id` integration in existing pages | Bundled with storage plan (new Storage page, Strategy refactor, modal vision editor, new nav/routes) | The GUI restructuring is ~40% of the plan's file-change surface and is not gated on multi-store backend functionality. Shipping backend + CLI first produces a testable, usable multi-store capability without the GUI blast radius. |
| Mandatory vs. optional registration in multi-store mode | Mandatory — unregistered repos produce a hard error | (A) Soft default — unregistered repos route to the default store silently; (B) Prompt-based — ask the user to choose a store on first project creation | Hard-error maximizes predictability at the cost of one-time registration friction. Silent default-store routing risks "where did my project go?" confusion when users forget to register before creating projects. |
| GUI config scope | Single server-wide `gui-config.json` | Per-store `gui-config.json` in each store directory | Current `gui-config.json` fields (`auto_handoff_enabled`, `auto_archive_days`, etc.) are all server-wide behavioral settings — none is store-scoped. Duplicating per store creates ambiguity about which store's config governs server behavior. |

## Pattern Alignment

- **Repository Pattern (`LedgerStore`)**: Plan follows this exactly. `LedgerStore` remains the per-store storage abstraction; new components sit above it. No departure.
- **Atomic writes (`atomicWriteJson`)**: All `stores.json` writes use `atomicWriteJson`. No departure.
- **File locking (`withLock` via `proper-lockfile`)**: `stores.json` writes are protected by `withLock`. No departure.
- **Schema validation (Zod)**: `StoresConfigSchema` validates `stores.json` on every read. `RepositoryEntrySchema` gains a `store_id` field. No departure.
- **Repository registry pattern**: Store routing is added to the existing registry by extending `RepositoryEntrySchema` with `store_id`. This follows the established pattern of the registry as the central source of repository metadata. No departure.
- **CLI convention (`scripts/cli.js` command groups)**: New `store` subcommands follow the existing CLI pattern. No departure.
- **Optional `_ledgerRoot` test parameter**: All new functions accept an optional root override for testability, following the established pattern. No departure.
- **Startup initialization in `index.ts`**: Multi-store initialization follows the existing pattern (resolve → mkdir → migrate → config). No departure.
- **`--ledger-dir` CLI flag**: Reused as the default store path override. No departure.
- **Single funnel point (`resolveLedgerRoot`)**: Departure — `resolveLedgerRoot()` remains for backward compatibility, but a new `resolveStoreConfig()` is added as the multi-store-aware entry point. The departure is justified because the single-funnel assumption is the core limitation this plan addresses.
- **Optional repository registration**: Departure in multi-store mode — registration becomes mandatory for project creation when `stores.json` exists. In single-store mode (no `stores.json`), registration remains optional. The departure is justified because multi-store routing requires knowing which store to target, and the repository is the natural routing key. The alternative (silently routing unregistered repos to the default store) was rejected to avoid "where did my project go?" confusion — see Rationale item 6 and Considered Alternatives table.
- **Module-level state in `index.ts`**: `StoreRouter` and `MultiStoreManager` are stored as module-level `let` variables in `index.ts` with exported accessors, following the same pattern as `resolveLedgerRoot()`. A separate `store-context.ts` singleton module was considered and rejected — it would introduce a startup-ordering contract (`initStoreContext` must precede `getStoreRouter`) that the existing codebase avoids. No departure.
- **Server-wide `gui-config.json`**: Kept as a single server-wide file. Per-store `gui-config.json` was considered and rejected — current fields (`auto_handoff_enabled`, `auto_archive_days`, etc.) are all server-wide behavioral settings with no store-scoped semantics. No departure.

## Detailed Steps

### Phase 1: Store Configuration and Registry Extension

**Step 1.** Create `mcp-server/src/schema/store-config.ts` — Zod schemas for `stores.json`:
```typescript
StoreEntrySchema: {
  id: string (slug-validated),
  label: string,
  path: string (absolute path, ~ expanded),
  sync: { type: string, remote?: string } | null (informational only, not consumed by MCP server)
}

StoresConfigSchema: {
  stores: StoreEntry[],
  default_store: string (must reference an existing store id)
}
```
Note: no `repo_assignments` field — store routing is handled by the repository registry.

**Step 2.** Extend `mcp-server/src/schema/repository-registry.ts` — Add `store_id` to `RepositoryEntrySchema`:
```typescript
store_id: z.string().regex(SLUG_REGEX).nullable().default(null)
```
The field is nullable: `null` means "use the default store". In single-store mode (no `stores.json`), the field is ignored.

**Step 3.** Create `mcp-server/src/storage/store-registry.ts` — Store registry I/O module:
- `resolveStoresConfigPath()` → `~/.ai-insights/stores.json` (cross-platform home dir via `os.homedir()`).
- `loadStoresConfig(configPath?)` → reads and validates `stores.json`. Returns `null` when file is absent (single-store mode). Throws on malformed JSON or schema validation failure.
- `saveStoresConfig(config, configPath?)` → validates via `StoresConfigSchema`, writes atomically under `withLock`.
- `expandStorePath(pathStr)` → resolves `~` to `os.homedir()`, normalizes with `path.resolve()`.

**Step 4.** Create `mcp-server/src/storage/store-router.ts` — Write routing logic:
- `StoreRouter` class:
  - Constructor takes `StoresConfig | null` (null = legacy mode) and a repository registry loader function.
  - `resolveStoreForWrite(repoName: string): string` — In legacy mode (null config): delegates to `resolveLedgerRoot()`. In multi-store mode: loads the repository registry, calls `findByFolderName(registry, repoName)`. If not found → throws an error: `"Repository '${repoName}' is not registered. Register it via the GUI (/api/repos) or CLI (store assign) before creating projects."` If found → reads `entry.store_id` (null = default store) → resolves to the corresponding store path.
  - `resolveDefaultStore(): string` — returns the default store path (for operations not tied to a specific repo, like global knowledge writes).
  - `getAllStorePaths(): StoreEntry[]` — returns all registered stores (or a single-entry array wrapping `resolveLedgerRoot()` in legacy mode).
  - `isMultiStoreMode(): boolean` — returns `true` when `stores.json` is loaded.

**Step 5.** Create `mcp-server/src/storage/multi-store-manager.ts` — Cross-store read operations:
- `MultiStoreManager` class:
  - Constructor takes `StoreRouter`.
  - `listAllProjects(status?)` → iterates all store paths, calls `LedgerStore.listAllProjects(storePath)` for each, tags each `ProjectMeta` with `store_id` and `store_label`, merges into unified list.
  - `detectProjectByCwd(cwdPath)` → iterates all store paths, calls `LedgerStore.detectProjectByCwd(cwdPath, storePath)` for each. Returns the first `FOUND` match. If a single store returns `AMBIGUOUS` (intra-store collision), that result is forwarded as-is. If multiple stores each return `FOUND`, returns a new `MULTI_STORE_AMBIGUOUS` status with candidates tagged by `store_id` — this distinguishes cross-store collisions (a configuration error) from intra-store collisions (a genuine path overlap). If none match, returns `NOT_FOUND`.
  - `searchKnowledge(query, options?)` → iterates all store paths, creates `KnowledgeStoreManager` for each, calls `searchInsights()`, deduplicates by insight `id` (first-seen wins), returns merged results.
  - `listKnowledge(options?)` → same pattern as search, but for `listInsights()`.

### Phase 2: Central Repository Registry

**Step 6.** Centralize `.repositories.json` resolution:
- Create `resolveRegistryPath(ledgerRoot?: string): string` in `mcp-server/src/storage/repository-registry.ts`. Resolution logic: if `~/.ai-insights/.repositories.json` exists, return that path. Otherwise, fall back to `{ledgerRoot}/.repositories.json` (legacy location). This is a single deterministic function — no mode parameter, no conditional branching by callers.
- Update `loadRegistry()` and `saveRegistry()` to use `resolveRegistryPath()` internally instead of hardcoding `join(ledgerRoot, REGISTRY_FILENAME)`.
- On first load from the legacy location when `~/.ai-insights/` directory exists: automatically migrate (copy) the registry to the central location. Log the migration. The legacy file is preserved as a backup.
- All consumers of the registry (`gui/api-repos.ts`, `StoreRouter`, tool files) call the same `loadRegistry()` — no per-caller path decisions.

**Step 7.** Modify `mcp-server/gui/api-repos.ts` — Store-aware repository management:
- Add `store_id` field to create/update schemas (`RepoCreateBodySchema`, `RepoUpdateBodySchema`).
- Validate that `store_id` references a valid store in `stores.json` (or is null for default store).
- The existing GUI repository management UI gains a store dropdown when multiple stores are configured.

### Phase 3: MCP Server Integration

**Step 8.** Modify `mcp-server/src/index.ts` — Multi-store initialization:
- After `resolveLedgerRoot()`, attempt to load `stores.json` via `loadStoresConfig()`.
- If `stores.json` exists: create `StoreRouter` from config, ensure all store directories exist (`mkdirSync`), run `migrateToNamespacedLayout()` on each store path.
- If `stores.json` does not exist: create `StoreRouter` in legacy mode (wrapping the single ledger root).
- Create `MultiStoreManager` from `StoreRouter`.
- Store the `StoreRouter` and `MultiStoreManager` as module-level `let` variables in `index.ts` and export accessor functions `getStoreRouter()` and `getMultiStoreManager()` directly from `index.ts`. This follows the existing pattern of `resolveLedgerRoot()` being a module-level function and avoids a separate singleton module with init/get ordering concerns.
- GUI config remains a single server-wide file (at `~/.ai-insights/gui-config.json` when that directory exists, otherwise at `{ledgerRoot}/gui-config.json`). It is not duplicated per store — `gui-config.json` holds server-wide behavioral settings (`auto_handoff_enabled`, `auto_archive_days`, etc.) that are not store-scoped.

**Step 9.** Modify `mcp-server/src/tools/project-lifecycle.ts` — Multi-store reads and writes:
- `listProjects()`: replace `LedgerStore.listAllProjects(_ledgerRoot)` with `getMultiStoreManager().listAllProjects(status)`. Each returned project includes `store_id` and `store_label` fields.
- `detectProject()`: replace `LedgerStore.detectProjectByCwd(cwd)` with `getMultiStoreManager().detectProjectByCwd(cwd)`.
- `initializeProject()`: use `getStoreRouter().resolveStoreForWrite(repoName)` to determine which store to write to. In multi-store mode, this call will throw if the repository is not registered — the error message guides the user to register it first. Then construct `LedgerStore(projectPath, resolvedLedgerRoot)`.
- `getProjectStatus()`: when resolving via `cwd_path`, the multi-store detect path is already used. When resolving via `project_path`, use `getStoreRouter().resolveStoreForWrite(deriveRepoName(projectPath))`.

**Step 10.** Modify `mcp-server/src/tools/knowledge.ts` — Multi-store knowledge:
- `addInsight()`: for `scope: 'global'`, write to the default store's `.knowledge/`. For `scope: 'repository'`, use `getStoreRouter().resolveStoreForWrite(repositoryName)` to find the correct store.
- `searchInsights()`: delegate to `getMultiStoreManager().searchKnowledge()` for cross-store search.
- `listInsights()`: delegate to `getMultiStoreManager().listKnowledge()` for cross-store listing.
- `updateInsight()` and `deleteInsight()`: identify which store contains the insight by iterating stores, then operate on that store's `KnowledgeStoreManager`.

**Step 11.** Modify `mcp-server/src/tools/repository-context.ts` — Multi-store repository context:
- Replace `resolveLedgerRoot()` call with `getStoreRouter().getAllStorePaths()`.
- Load `.repositories.json` via `loadRegistry()` (uses `resolveRegistryPath()` internally).
- For each store, scan its projects.
- Merge results across stores.

**Step 11b.** Modify `mcp-server/gui/api.ts` — Orchestrator preflight repository validation:
- In `handleOrchestratorStart()`, add a preflight check that validates the plan path's derived repository is registered in `.repositories.json` (in multi-store mode). If the repository is not registered, return a preflight failure with a clear message: *"Repository 'X' is not registered. Register it in Storage → Repositories before starting a run."* This check runs before the existing preflight checks (venv, `.env`, dist freshness) so the user gets the registration error early.

### Phase 4: Minimal GUI Integration

Full GUI restructuring (new Storage page, Strategy-page refactoring to strategy-only focus, store badges on project list, new navigation routes) is deferred to a follow-up plan — it accounts for ~40% of the file-change surface and is not gated on any multi-store backend functionality. This phase adds the minimum API and form changes needed to make multi-store functional via the existing GUI.

**Step 12.** Modify `mcp-server/gui/api.ts` — Store-aware project listing and read-only store endpoint:
- `handleListProjects`: delegate to `MultiStoreManager.listAllProjects()`. Include `store_id` and `store_label` in response.
- Add `GET /api/stores` endpoint (read-only) — returns the list of registered stores (id, label, path, project count). Full store CRUD endpoints are deferred to the GUI follow-up plan.

**Step 13.** Modify existing Strategy page — Add Store dropdown to repository forms:
- In `mcp-server/gui/public/views/strategy.js`, add a Store dropdown to the "Add Repository" form and the repository edit form (populated from `GET /api/stores`; default = null/"Default Store"). The dropdown only appears when multiple stores are configured.
- Add `getStores()` to `mcp-server/gui/public/api-client.js`.
- No other changes to the Strategy page layout, navigation, or CRUD controls in this phase.

### Phase 5: CLI Convenience Layer

**Step 14.** Add `store` command group to `scripts/cli.js`:
- `store init` — creates `~/.ai-insights/stores.json` with a single store pointing at the current ledger root. Creates `~/.ai-insights/stores/` directory. Migrates `.repositories.json` to the central location if it exists in the default store.
- `store add <id> <path>` — registers a new store directory. Validates the path exists or offers to create it.
- `store remove <id>` — removes a store from the registry (does not delete the directory). Warns if any repositories are assigned to this store.
- `store assign <repo-name> <store-id>` — sets the `store_id` on the repository entry in `.repositories.json`. Creates the repository entry if it doesn't exist (prompting for label and folder_names).
- `store unassign <repo-name>` — sets `store_id` to null on the repository entry (falls back to default store).
- `store list` — shows all stores, their paths, assigned repositories (from `.repositories.json`), and project counts.
- `store default <id>` — sets the default store in `stores.json`.
- `store status` — for each store, shows sync status if the directory is a Git repo (ahead/behind counts). Gracefully degrades if the directory is not a Git repo.

### Phase 6: Documentation and Migration Guide

**Step 15.** Create user-facing documentation:
- `docs/references/multi-store-guide.md` — comprehensive guide covering: concept overview, setup walkthrough (single-store → multi-store migration), repository registration workflow, Git sync recommendations, CLI command reference, FAQ.
- Update `README.md` with a brief mention of multi-store capability and link to the guide.

**Step 16.** Update project manifests:
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add new files.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document new classes, `store_id` field on `RepositoryEntry`, and tool behavior changes.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — document multi-store read/write flows.
- `mcp-server/docs/agents/project-manifest/constraints.md` — add multi-store constraints (mandatory registration, store routing via repository).
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — no new dependencies needed.
- Root `AGENTS.md` — update cross-system dependencies table with store config location and central `.repositories.json`.

## Dependencies

- No new npm dependencies. The implementation uses Node.js built-in modules (`os`, `path`, `fs`) and existing project dependencies (`zod`, `proper-lockfile`).
- `stores.json` is a new user-level configuration file; its location (`~/.ai-insights/`) is a new convention.
- The existing `.repositories.json` registry schema gains a `store_id` field.

## Required Components

### New Files
- `mcp-server/src/schema/store-config.ts` — Zod schemas for `StoreEntry` and `StoresConfig`
- `mcp-server/src/storage/store-registry.ts` — `stores.json` I/O (load, save, path resolution)
- `mcp-server/src/storage/store-router.ts` — Write routing logic (`StoreRouter` class)
- `mcp-server/src/storage/multi-store-manager.ts` — Cross-store read operations (`MultiStoreManager` class)
- `docs/references/multi-store-guide.md` — User-facing setup and usage guide

### Modified Files
- `mcp-server/src/schema/repository-registry.ts` — Add `store_id` field to `RepositoryEntrySchema`
- `mcp-server/src/storage/repository-registry.ts` — Add `resolveRegistryPath()` for unified registry location resolution; auto-migration from legacy path
- `mcp-server/src/index.ts` — Multi-store startup initialization; export `getStoreRouter()` and `getMultiStoreManager()` accessors
- `mcp-server/src/tools/project-lifecycle.ts` — Delegate to `MultiStoreManager` for reads, `StoreRouter` for writes; enforce registration in multi-store mode
- `mcp-server/src/tools/knowledge.ts` — Cross-store knowledge search, per-store knowledge writes
- `mcp-server/src/tools/repository-context.ts` — Cross-store repository context aggregation
- `mcp-server/gui/api.ts` — Store-aware project listing, read-only `GET /api/stores` endpoint, orchestrator preflight registration check
- `mcp-server/gui/api-repos.ts` — Add `store_id` to create/update schemas; validate against `stores.json`
- `mcp-server/gui/server.ts` — Wire new `/api/stores` route
- `mcp-server/gui/public/views/strategy.js` — Add Store dropdown to repository Add/Edit forms
- `mcp-server/gui/public/api-client.js` — Add `getStores()` API method
- `scripts/cli.js` — New `store` command group
- `mcp-server/docs/agents/project-manifest/file-tree.md` — New file entries
- `mcp-server/docs/agents/project-manifest/api-surface.md` — New class/tool documentation, `store_id` on `RepositoryEntry`, `GET /api/stores` endpoint
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Multi-store flow documentation
- `mcp-server/docs/agents/project-manifest/constraints.md` — Multi-store constraints (mandatory registration)
- Root `AGENTS.md` — Cross-system dependencies update
- Root `README.md` — Brief multi-store mention

## Assumptions

- The user-level config directory `~/.ai-insights/` is acceptable across all platforms (Windows: `C:\Users\{user}\.ai-insights\`, macOS/Linux: `/home/{user}/.ai-insights/`). The dot-prefix convention is standard for user-level config on Unix systems and is acceptable on Windows.
- Single-user, single-device-at-a-time access remains the primary usage pattern. The multi-store architecture does not introduce concurrent multi-device write safety — that remains the user's responsibility via their chosen sync mechanism.
- The `sync` field in `stores.json` is strictly informational metadata. The MCP server never reads or acts on it. CLI convenience commands (like `store status`) may inspect it for Git status reporting, but this is best-effort.
- Store paths are absolute after `~` expansion. Relative paths in `stores.json` are resolved relative to the config file's directory.
- Users will register their repositories before creating projects in multi-store mode. The error message for unregistered repositories is clear and actionable, guiding users to the GUI or CLI.
- The existing `.repositories.json` schema is forward-compatible: adding `store_id` as a nullable field with a default of `null` means existing registry files parse successfully without migration.

## Constraints

- **No new npm dependencies.** All functionality is implemented with Node.js built-ins and existing project dependencies.
- **`LedgerStore` remains unchanged** in its per-store behavior. No modifications to its constructor, file I/O methods, or locking logic.
- **Backward compatibility is mandatory.** No `stores.json` = identical behavior to the current single-root system. Existing users must not notice any change unless they explicitly opt into multi-store. Repository registration remains optional in single-store mode.
- **Repository registration is mandatory in multi-store mode.** When `stores.json` exists, `ledger_initialize_project` (and any other write operation that creates new project data) requires the repository to be registered in `.repositories.json`. Unregistered repositories produce a clear error.
- **Cross-platform policy applies.** All file paths use `path.join()`/`path.resolve()`. `~` expansion uses `os.homedir()`. No hardcoded separators.
- **Privacy boundary is physical.** Each store is a self-contained directory tree. Cross-store operations are read-only. There is no mechanism for cross-store writes.
- **No sync logic in the MCP server.** The MCP server never shells out to `git`, never makes network calls for sync, and has no knowledge of how stores are synchronized.
- **No new tool parameters for store selection.** Store routing is always implicit, resolved through the repository registry. Agents and orchestrator do not need to learn a `store_id` concept.

## Out of Scope

- **Built-in Git sync automation** (auto-commit, auto-push, auto-pull). This is explicitly deferred to a future phase and will never live inside the MCP server process.
- **Full GUI restructuring** (new Storage page with Repositories/Ledger Storage tabs, Strategy-page refactoring to strategy-only focus with modal vision editor, store badges on project list, new navigation routes). Deferred to a follow-up plan — see Deferred Items. This phase adds only the minimal GUI integration (read-only `/api/stores` endpoint, Store dropdown on existing repository forms).
- **Store CRUD via GUI** (create/delete/edit stores via REST API). Users manage stores via `stores.json` or CLI commands in this phase. Deferred to the GUI follow-up plan.
- **Pluggable `StorageBackend` interface** (S3, Turso, etc.). Premature abstraction — only one backend (local filesystem) is needed. Can be introduced later if demand materializes.
- **Auto-assignment via glob patterns** (e.g., `"company-*": "work"`). Simple default-store fallback via null `store_id` is sufficient.
- **Cross-store knowledge merge/dedup.** Read-time dedup by insight `id` is sufficient. No write-time merge between stores.
- **Conflict resolution UI.** If users' sync mechanisms produce conflicts, those are resolved outside the MCP server.
- **Automatic repository registration.** In multi-store mode, users must explicitly register repositories. No auto-registration on first project creation — the error message guides users to register first.

## Acceptance Criteria

1. With no `stores.json` present, the MCP server behaves identically to the current implementation — all existing tests pass without modification. Repository registration remains optional.
2. With a valid `stores.json` containing two or more stores, `ledger_list_projects` returns projects from all stores, each tagged with `store_id` and `store_label`.
3. `ledger_initialize_project` creates a new project in the correct store based on the repository's `store_id` field in `.repositories.json`. Repositories with `store_id: null` use the default store.
4. In multi-store mode, `ledger_initialize_project` for an unregistered repository returns a clear error message: *"Repository 'X' is not registered."*
5. `ledger_detect_project` searches all stores when resolving a `cwd_path` to a project. Cross-store collisions (same cwd matches projects in different stores) return `MULTI_STORE_AMBIGUOUS` with candidates tagged by `store_id`, distinct from intra-store `AMBIGUOUS`.
6. `ledger_search_insights` and `ledger_list_insights` return merged results from all stores' `.knowledge/` directories.
7. `ledger_add_insight` with `scope: 'repository'` writes to the store assigned to that repository. `scope: 'global'` writes to the default store.
8. The `GET /api/stores` endpoint returns the list of registered stores with project counts.
9. The CLI `store init`, `store add`, `store list`, `store assign`, and `store default` commands work correctly.
10. All operations work correctly on Windows, macOS, and Linux (cross-platform `~` expansion, path separators).
11. Invalid or malformed `stores.json` produces a clear error message at server startup and falls back to single-store mode.
12. Store paths that do not exist are created automatically on server startup.
13. The `store_id` field on `RepositoryEntrySchema` defaults to `null`, so existing `.repositories.json` files parse without errors or migration.
14. The existing Strategy page's "Add Repository" and edit forms include a Store dropdown when multiple stores are configured.
15. `resolveRegistryPath()` returns `~/.ai-insights/.repositories.json` when that directory exists, otherwise `{ledgerRoot}/.repositories.json`. Legacy registries are auto-migrated on first load.
16. GUI config (`gui-config.json`) is a single server-wide file, not duplicated per store.
17. In multi-store mode, the GUI orchestrator preflight rejects unregistered repositories with a clear error before running other checks.

## Testing Strategy

Testing follows the existing pattern of Vitest unit and integration tests with temporary directories. The `_ledgerRoot` override parameter pattern (already established for testability) naturally extends to multi-store testing — tests create multiple temporary directories and a `stores.json` configuration pointing to them.

The critical testing focus is backward compatibility: the entire existing test suite must pass without modification when no `stores.json` is present (legacy mode).

## Test Plan

- `mcp-server/tests/schema/store-config.test.ts` — Validates `StoresConfigSchema` accepts valid configs and rejects invalid ones (missing fields, duplicate store IDs, missing default store). Covers AC-11.
- `mcp-server/tests/schema/repository-registry.test.ts` — Validates that `RepositoryEntrySchema` accepts entries with and without `store_id`; validates `store_id: null` default; validates existing registry files parse without errors. Covers AC-13.
- `mcp-server/tests/storage/store-registry.test.ts` — Tests `loadStoresConfig()` returns null when file is absent; loads and validates valid config; throws on malformed JSON; throws on schema failure. Tests `saveStoresConfig()` round-trip. Tests `expandStorePath()` with `~`, absolute, and relative paths across platforms. Covers AC-1, AC-10, AC-11.
- `mcp-server/tests/storage/store-router.test.ts` — Tests `resolveStoreForWrite()` in legacy mode (null config → delegates to `resolveLedgerRoot()`); in multi-store mode with registered repo → correct store; with registered repo and `store_id: null` → default store; with unregistered repo → throws clear error. Tests `getAllStorePaths()` in both modes. Covers AC-1, AC-3, AC-4.
- `mcp-server/tests/storage/multi-store-manager.test.ts` — Tests `listAllProjects()` merges projects from multiple stores with correct tagging; tests `detectProjectByCwd()` finds projects across stores and returns `MULTI_STORE_AMBIGUOUS` for cross-store collisions; tests `searchKnowledge()` deduplicates by insight ID. Uses multiple temporary directories as stores. Covers AC-2, AC-5, AC-6.
- `mcp-server/tests/storage/repository-registry-path.test.ts` — Tests `resolveRegistryPath()` returns `~/.ai-insights/.repositories.json` when that directory exists; falls back to `{ledgerRoot}/.repositories.json` otherwise; tests auto-migration from legacy location. Covers AC-15.
- `mcp-server/tests/tools/project-lifecycle-multi-store.test.ts` — Integration tests: `initializeProject` routes to the correct store based on repository `store_id`; `initializeProject` for unregistered repo returns error; `listProjects` returns tagged results from all stores; `detectProject` searches all stores. Covers AC-2, AC-3, AC-4, AC-5.
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — Integration tests: `addInsight` writes to the correct store; `searchInsights` returns cross-store results; `listInsights` merges results. Covers AC-6, AC-7.
- `mcp-server/tests/gui/api-stores.test.ts` — Tests `GET /api/stores` returns correct store list with project counts. Covers AC-8.
- `mcp-server/tests/gui/api-repos-store.test.ts` — Tests that repo create/update with `store_id` validates against `stores.json` stores; tests that invalid `store_id` is rejected. Covers AC-13.
- **Existing test suite** — All 100+ existing tests must continue to pass without modification (no `stores.json` = legacy mode). Covers AC-1.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add entries for `store-config.ts`, `store-registry.ts`, `store-router.ts`, `multi-store-manager.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document `StoreRegistry`, `StoreRouter`, `MultiStoreManager` public APIs; document `resolveRegistryPath()` in repository-registry; document `store_id` field on `RepositoryEntrySchema`; document `store_id`/`store_label` fields on project listing responses; document `MULTI_STORE_AMBIGUOUS` detection status; document read-only `GET /api/stores` endpoint; document mandatory registration behavior in multi-store mode
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add "Multi-Store Write Routing" and "Multi-Store Read Collation" flow diagrams; document repository-driven routing chain; document `resolveRegistryPath()` resolution and auto-migration flow
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add constraints: "stores.json is optional — absent = legacy mode", "Repository registration is mandatory in multi-store mode", "Cross-store operations are read-only", "No sync logic in MCP server", "No new tool parameters for store selection", "gui-config.json is server-wide, not per-store"
- Root `AGENTS.md` — Add `stores.json` and central `.repositories.json` to Cross-System Dependencies table; add `~/.ai-insights/` to Navigation Quick Reference
- Root `README.md` — Add brief multi-store section with link to `docs/references/multi-store-guide.md`
- `docs/references/multi-store-guide.md` — New file: concept overview, repository registration workflow, setup walkthrough, Git sync recommendations, CLI reference, FAQ

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | **Storage page** (`#/storage`) with Repositories and Ledger Storage tabs — full CRUD for repository entries (with store dropdown) and store entries (from `stores.json`) | Design review S2 — ~40% of file-change surface is not gated on multi-store backend | GUI restructuring is orthogonal to the storage architecture; shipping backend + CLI first reduces blast radius and keeps review surface focused | Reconsider after multi-store backend is stable and CLI-tested; may bundle with item 2 |
| 2 | **Strategy page refactoring** to strategy-only focus — remove repo CRUD, add modal vision editor, remove `#/strategy/:repoId` route, add "Manage Repositories →" link to Storage page | Design review S2 — Strategy page changes depend on the new Storage page existing | The existing Strategy page continues to work with the `store_id` dropdown added in this plan | Ship together with item 1 |
| 3 | **Project list store badges and filter** — store filter dropdown and store badge on each project row in `project-list.js` | Design review S2 — cosmetic enhancement not needed for multi-store functionality | `store_id` and `store_label` are already present in the API response; the UI can be enhanced later | Low priority; consider when multiple stores are in active use |
| 4 | **Store CRUD REST endpoints** — `POST /api/stores`, `PUT /api/stores/:storeId`, `DELETE /api/stores/:storeId` | Design review S2/S3 — store management via GUI deferred; CLI `store` commands cover all CRUD needs | Users manage stores via `stores.json` directly or CLI commands in this phase | Ship together with item 1 |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`~/.ai-insights/` directory conflicts** with other tools using the same name | The name is specific enough to be unlikely. Document the convention. Allow override via `--stores-config` CLI flag if needed in the future. |
| **Store path permissions** — a store directory may not be readable/writable | Validate store paths at startup. Log warnings for inaccessible stores and exclude them from reads (graceful degradation). Do not fail startup. |
| **Large number of stores** degrades `listAllProjects()` performance | Each `listAllProjects()` call is already O(repos × projects) per store. With N stores, it becomes O(N × repos × projects). For realistic N (2–5 stores), this is negligible. Document the performance characteristic. |
| **Store config corruption** — `stores.json` is malformed or deleted while server is running | Config is read once at startup and cached. Mid-session corruption does not affect running operations. Next startup re-reads and validates. |
| **Backward compatibility regression** — existing single-store behavior breaks | The entire existing test suite runs in legacy mode (no `stores.json`). Any regression is caught immediately. Multi-store code paths are behind the `StoreRouter` legacy-mode guard. |
| **Cross-store insight ID collisions** — two stores have insights with the same numeric `id` | Insights are scoped by store. Cross-store search deduplicates by `id` (first-seen wins). The `store_id` field in the response disambiguates. Document that `id` is unique within a store, not globally. |
| **Platform-specific `~` expansion** — may behave unexpectedly on edge-case platforms | Use `os.homedir()` exclusively (Node.js cross-platform API). Never shell out. Test on Windows, macOS, and Linux. |
| **Mandatory registration friction** — users may find it inconvenient to register repos before creating projects | The error message is clear and actionable, guiding users to the GUI or CLI. The `store assign` CLI command doubles as a registration shortcut. In single-store mode (no `stores.json`), registration remains optional — no friction for users who don't need multi-store. |
| **`.repositories.json` auto-migration** — moving the registry from `{ledgerRoot}/` to `~/.ai-insights/` on first load | `resolveRegistryPath()` handles migration automatically (copy to central location, preserve legacy file as backup). The resolution function is deterministic — once migrated, all subsequent loads use the central path. No user intervention required. |
