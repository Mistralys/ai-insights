# Plan: Multi-Store Ledger Architecture

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v1.6.0

## Prior Project Context

No prior projects in the ledger addressed cross-device sync or multi-store storage. The repository has 8 tracked projects, primarily focused on persona build pipelines, dialogue rendering, and agent workflow features. No relevant knowledge base insights exist for storage architecture changes. This plan introduces a new architectural capability with no precedent in the codebase.

## Summary

Introduce a multi-store ledger architecture that allows the MCP server to manage multiple independent ledger root directories simultaneously. Each store is a fully self-contained directory tree with its own projects, knowledge base, and **repository registry** (`.repositories.json`). Store routing uses a **per-store registry model**: each store owns a `.repositories.json` that defines which repositories belong to it. On startup, the server merges all per-store registries into a unified view using store-order priority (controlled by the user via `stores.json`). The first store whose registry claims a repository wins for writes — making routing implicit and predictable without any `store_id` fields or extra tool parameters. Repository registration becomes mandatory for project creation in multi-store mode. Sync is entirely the user's responsibility — the MCP server only sees local directories on disk. This solves cross-device workflows and personal/company data separation without coupling the MCP server to any sync mechanism. Critically, repository metadata travels with the store during sync, so adding a synced store on a new device auto-discovers its repositories.

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

### Core Concept: Per-Store Repository Registries with Store-Order Routing

Each store is a **fully self-contained unit** — it owns its projects, knowledge base, and repository definitions. Every store has its own `.repositories.json` that declares which repositories belong to it. The server merges all per-store registries into a unified view at startup, using **store order** (the array order in `stores.json`) to resolve conflicts. The first store whose registry claims a repository name wins for writes.

This model eliminates the need for a central repository registry, a `store_id` field on repository entries, or any new tool parameters. The store is always resolved from the repository name, which is derived from the project path. Critically, repository metadata **travels with the store** when synced to another device — adding a synced store on a new machine auto-discovers its repositories.

Repository registration — which is currently optional — becomes **mandatory for project creation** in multi-store mode. Unregistered repositories produce a clear error: *"Repository 'X' is not registered in any store. Register it first via the GUI or CLI."*

Four components work together:

1. **`stores.json`** — A registry file at `~/.ai-insights/stores.json` (user-level) listing independent ledger root directories. The **array order defines priority** — earlier stores take precedence when multiple stores register the same repository.

2. **`StoreRegistry`** — A module (`mcp-server/src/storage/store-registry.ts`) that reads/writes `stores.json`, validates its schema, and provides lookup methods. Handles the backward-compatible fallback: no `stores.json` → single-store mode using `resolveLedgerRoot()`.

3. **`StoreRouter`** — A module (`mcp-server/src/storage/store-router.ts`) that resolves which store to use for a given operation. For writes: iterates stores in order, loads each store's `.repositories.json`, and returns the path of the first store whose registry claims the repo. If no store claims the repo, it throws an error. For reads: iterates all stores.

4. **`MultiStoreManager`** — A module (`mcp-server/src/storage/multi-store-manager.ts`) that provides collated read operations across all stores (list projects, search knowledge, detect project by cwd) and a **merged repository registry view** across all stores. Tags results with `store_id` and `store_label` for downstream consumers.

### Per-Store Registry Model

Each store directory contains its own `.repositories.json` with the existing `RepositoryEntrySchema` — **no schema changes needed**. The existing schema already has everything required (id, label, folder_names, vision, timestamps).

```
store "work":   .repositories.json → { "ai-insights": { vision: "..." } }
store "personal": .repositories.json → { "my-side-project": { ... } }
```

On startup (or on demand), the `StoreRouter` loads each store's `.repositories.json` and builds a merged view:
- Entries are collected in store order (first store in `stores.json` has highest priority)
- If the same repository appears in multiple stores, the **first store's entry wins** for routing and metadata (vision, label)
- The merged view is used for all lookups; individual per-store registries are used for writes

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
  2. Iterate stores in stores.json order
  3. For each store, load its .repositories.json
  4. Find first store where folder_names includes repoName
  5. If no store claims the repo → ERROR: "Repository 'X' is not registered in any store"
  ↓
ledgerRoot = matched store's path
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

### Merged Repository Registry Flow

```
multiStoreManager.getMergedRegistry()
  ↓
for each store in stores.json order:
  load store's .repositories.json
  for each entry:
    if repo name not yet seen → add to merged view (tagged with store_id)
    if repo name already seen → skip (earlier store wins)
  ↓
return merged registry (used by GUI, CLI, repository-context tools)
```

### Directory Layout

```
~/.ai-insights/                       # User-level config directory
├── stores.json                       # Store definitions (id, label, path) — order = priority
├── gui-config.json                   # Server-wide GUI configuration (not per-store)
└── stores/                           # Default location for store directories
    ├── personal/                     # Store 1 (higher priority) — user manages sync
    │   ├── .repositories.json        # Repos belonging to this store
    │   ├── .knowledge/
    │   ├── my-side-project/
    │   │   └── 2026-07-01-feature/
    │   │       └── …
    │   └── …
    └── work/                         # Store 2 (lower priority) — user manages sync
        ├── .repositories.json        # Repos belonging to this store
        ├── .knowledge/
        └── ai-insights/
            └── 2026-05-01-plan/
                └── …
```

Note: In legacy single-store mode (no `stores.json`), `.repositories.json` lives at `{ledgerRoot}/.repositories.json` exactly as today — no changes. The existing registry file is the single store's registry. When migrating to multi-store, the legacy `.repositories.json` naturally becomes the default store's per-store registry.

### Backward Compatibility

- **No `stores.json`** → system behaves exactly as today. `resolveLedgerRoot()` returns the single root. All read/write operations use it. Repository registration remains optional (as it is today). `.repositories.json` lives at `{ledgerRoot}/.repositories.json` — unchanged.
- **`--ledger-dir` flag** → overrides the default store path, making multi-store transparent for single-store users.
- **Existing data** → stays in place. When migrating to multi-store, the existing `{ledgerRoot}/.repositories.json` naturally becomes the default store's per-store registry. No file moves or schema changes required.

### Entry Points for Store Selection

No new parameters are needed on any tool. All entry points resolve the store via the repository:

| Entry Point | Store Resolution |
|---|---|
| **MCP tools** (`ledger_initialize_project`, etc.) | `deriveRepoName(projectPath)` → iterate stores in order → first store whose registry claims the repo → store path |
| **Orchestrator** (`orchestrate --plan <path>`) | Same — the plan path determines the repo name, which determines the store |
| **GUI** (repository creation) | User selects which store to add the repo to → writes to that store's `.repositories.json` |
| **CLI** (`store repo add`) | User specifies the target store explicitly |

### Cross-Device Portability

The per-store registry model solves the cross-device problem that a central registry creates:

| Step | Central registry (rejected) | Per-store registry (chosen) |
|---|---|---|
| Device A: create store, register repos | Central `~/.ai-insights/.repositories.json` | Store's `.repositories.json` |
| Sync store to Device B | Store syncs, but repos aren't known on Device B | Store syncs, repos travel with it |
| Device B: add store to `stores.json` | Must re-register all repos manually | Done — repos are auto-discovered |

## Rationale

1. **Clean separation of concerns.** The MCP server reads and writes local JSON files — exactly what it does today. It has no knowledge of Git, S3, Syncthing, or any sync mechanism. This eliminates network errors, auth failures, and merge conflicts from the MCP server's codepath.
2. **User freedom.** Each store can use a different sync strategy — personal store on GitHub, work store on company GitLab, experimental store with no sync. The user picks what works for their environment.
3. **Privacy by architecture.** Company and personal data live in separate directory trees. No filtering, no ACLs, no risk of accidental cross-contamination — the boundary is physical.
4. **Reuses existing infrastructure.** The repository registry already exists (`.repositories.json`, `RepositoryEntrySchema`, GUI CRUD endpoints, `findByFolderName()`). No schema changes are needed — the existing `RepositoryEntrySchema` is used as-is inside each store's `.repositories.json`.
5. **No new tool parameters needed.** Store routing is implicit — derived from the repository, which is derived from the project path. Agents, orchestrator, and GUI don't need to learn any new concepts in their tool calls.
6. **Portable by design.** Repository metadata lives inside the store directory, so it travels with the store during sync. Adding a synced store on a new device auto-discovers its repositories — no manual re-registration needed. A central registry would force users to manually replicate repo definitions on every device.
7. **Explicit over implicit.** Requiring repository registration before project creation makes the system predictable. Users always know which store a project will land in because they placed the repo definition in that store's registry. The alternative — silently routing unregistered repos to the default store — was rejected because it creates "where did my project go?" confusion: a user who intends to use their work store but forgets to register would silently create projects in the personal/default store, discovering the mistake only after data has accumulated in the wrong location. The registration error is a one-time friction that prevents an ongoing class of misconfiguration. In single-store mode (no `stores.json`), registration remains optional — no friction for users who don't need multi-store.
8. **Predictable conflict resolution.** When the same repository appears in multiple stores (e.g., during migration or shared team repos), the store-order priority in `stores.json` gives users a simple, controllable resolution mechanism. Earlier stores win — reorder to change priority.
9. **Backward compatible.** No `stores.json` = single-root behavior, identical to today. Repository registration remains optional in single-store mode. The existing `{ledgerRoot}/.repositories.json` becomes the single store's per-store registry with zero changes.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Sync mechanism | User-managed (external to MCP server) | Built-in Git sync hooks (auto-commit on write, auto-pull on startup); S3 backup export; CouchDB/PouchDB bidirectional sync | Keeping sync external eliminates an entire class of failure modes (network, auth, merge conflicts) from the MCP server's codepath. Git is recommended to users but never required. |
| Store configuration location | `~/.ai-insights/stores.json` (user-level) | Inside the default store (chicken-and-egg on new devices); environment variable; `--stores-config` CLI flag | User-level config survives reinstalls, is not coupled to any single store, and avoids bootstrap problems on new machines. |
| Multi-store vs. single repo approaches | Independent store directories | Git subtrees per repo namespace; selective push scripts; tag-based ACL filtering | Independent stores are the simplest mental model — each is self-contained, can be reasoned about independently, and maps cleanly to separate sync remotes. Subtrees and selective push are fragile and break Git's model. |
| Write routing | Per-store registries with store-order priority | (A) Central registry with `store_id` field per entry; (B) Separate `repo_assignments` map in `stores.json`; (C) New `store_id` parameter on tools; (D) Pattern matching (glob rules) | Per-store registries make stores fully self-contained and portable — repo metadata travels with the store during sync. A central registry forces manual re-registration on every new device. A `store_id` field is functionally equivalent to per-store registries but adds schema complexity and breaks portability. Tool parameters would burden every agent invocation. |
| Repository registry location | Per-store (each store owns its `.repositories.json`) | (A) Central `~/.ai-insights/.repositories.json` with `store_id` field; (B) Central registry with auto-migration from legacy path; (C) Dedicated info-only store for repo definitions | Per-store registries are the simplest model: a repo belongs to whichever store defines it. No schema changes needed. Central registry creates cross-device friction (repo metadata doesn't travel with the store). Info-only stores require complex write-routing exceptions (`writable: false` flags or `write_target` fields) for minimal gain. |
| Knowledge cross-store behavior | Per-store knowledge, cross-store search on reads | Single merged knowledge store; no cross-store search | Per-store keeps company insights out of personal sync remotes. Cross-store read search is safe (all data is local) and maximizes knowledge utility. |
| Module decomposition | StoreRegistry + StoreRouter + MultiStoreManager + StoreContext (4 modules) | (A) Single `MultiStoreManager` combining registry I/O, routing, and collation; (B) 3 modules without a shared accessor (rejected — see below) | The 4-module shape cleanly separates by concern: Registry = I/O, Router = single-store resolution, Manager = cross-store collation, Context = shared singleton accessor. The startup-ordering contract (`setStoreContext()` called before `getStoreRouter()`) is the same pattern already established by `client-info.ts` (`setMcpServer()` → `getClientInfo()`). A 3-module shape without `store-context.ts` was rejected because `src/index.ts` (MCP STDIO server) and `gui/server.ts` (HTTP GUI server) are separate OS processes — module-level state exported from `index.ts` is inaccessible to `gui/server.ts`, and tool files importing from `index.ts` create circular imports. |
| GUI restructuring scope | Deferred to follow-up plan; minimal store integration in existing pages | Bundled with storage plan (new Storage page, Strategy refactor, modal vision editor, new nav/routes) | The GUI restructuring is ~40% of the plan's file-change surface and is not gated on multi-store backend functionality. Shipping backend + CLI first produces a testable, usable multi-store capability without the GUI blast radius. |
| Mandatory vs. optional registration in multi-store mode | Mandatory — unregistered repos produce a hard error | (A) Soft default — unregistered repos route to the default store silently; (B) Prompt-based — ask the user to choose a store on first project creation | Hard-error maximizes predictability at the cost of one-time registration friction. Silent default-store routing risks "where did my project go?" confusion when users forget to register before creating projects. |
| GUI config scope | Single server-wide `gui-config.json` | Per-store `gui-config.json` in each store directory | Current `gui-config.json` fields (`auto_handoff_enabled`, `auto_archive_days`, etc.) are all server-wide behavioral settings — none is store-scoped. Duplicating per store creates ambiguity about which store's config governs server behavior. |

## Pattern Alignment

- **Repository Pattern (`LedgerStore`)**: Plan follows this exactly. `LedgerStore` remains the per-store storage abstraction; new components sit above it. No departure.
- **Atomic writes (`atomicWriteJson`)**: All `stores.json` writes use `atomicWriteJson`. No departure.
- **File locking (`withLock` via `proper-lockfile`)**: `stores.json` writes are protected by `withLock`. No departure.
- **Schema validation (Zod)**: `StoresConfigSchema` validates `stores.json` on every read. `RepositoryEntrySchema` is unchanged — per-store registries reuse the existing schema as-is. No departure.
- **Repository registry pattern**: Each store owns a `.repositories.json` using the existing `RepositoryEntrySchema`. The registry remains the source of repository metadata, but is now per-store rather than central. Departure is limited to location (per-store vs. single root), not schema or semantics. The existing `loadRegistry()`/`saveRegistry()` functions gain a `storePath` parameter but otherwise remain unchanged.
- **CLI convention (`scripts/cli.js` command groups)**: New `store` subcommands follow the existing CLI pattern. No departure.
- **Optional `_ledgerRoot` test parameter**: All new functions accept an optional root override for testability, following the established pattern. No departure.
- **Startup initialization in `index.ts`**: Multi-store initialization follows the existing pattern (resolve → mkdir → migrate → config). No departure.
- **`--ledger-dir` CLI flag**: Reused as the default store path override. No departure.
- **Single funnel point (`resolveLedgerRoot`)**: Departure — `resolveLedgerRoot()` remains for backward compatibility, but a new `resolveStoreConfig()` is added as the multi-store-aware entry point. The departure is justified because the single-funnel assumption is the core limitation this plan addresses.
- **Optional repository registration**: Departure in multi-store mode — registration becomes mandatory for project creation when `stores.json` exists. In single-store mode (no `stores.json`), registration remains optional. The departure is justified because multi-store routing requires knowing which store to target, and the repository is the natural routing key. The alternative (silently routing unregistered repos to the default store) was rejected to avoid "where did my project go?" confusion — see Rationale item 7 and Considered Alternatives table.
- **Shared singleton accessor (`store-context.ts`)**: `StoreRouter` and `MultiStoreManager` are stored as module-level `let` variables in a dedicated `mcp-server/src/storage/store-context.ts` module, with `setStoreContext()` called once per process startup (in both `index.ts` and `gui/server.ts`) and `getStoreRouter()` / `getMultiStoreManager()` callable by any consumer. This follows the established pattern of `client-info.ts` (`setMcpServer()` / `getClientInfo()`). No departure.
- **Server-wide `gui-config.json`**: Kept as a single server-wide file. Per-store `gui-config.json` was considered and rejected — current fields (`auto_handoff_enabled`, `auto_archive_days`, etc.) are all server-wide behavioral settings with no store-scoped semantics. No departure.

## Detailed Steps

### Phase 1: Store Configuration

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

**Step 2.** Create `mcp-server/src/storage/store-registry.ts` — Store registry I/O module:
- `resolveStoresConfigPath()` → `~/.ai-insights/stores.json` (cross-platform home dir via `os.homedir()`).
- `loadStoresConfig(configPath?)` → reads and validates `stores.json`. Returns `null` when file is absent (single-store mode). Returns `null` on malformed JSON or schema validation failure (logs a warning to `stderr` with the validation error). This error-returning behavior is consistent with `loadRegistry()` returning `{ repositories: [] }` on failure, and enables the graceful fallback to single-store mode specified in AC-11.
- `saveStoresConfig(config, configPath?)` → validates via `StoresConfigSchema`, writes atomically under `withLock`.
- `expandStorePath(pathStr)` → resolves `~` to `os.homedir()`, normalizes with `path.resolve()`.
- `resolveGuiConfigPath(storeConfig: StoresConfig | null, ledgerRoot: string): string` → when `storeConfig` is non-null (multi-store mode), returns `join(os.homedir(), '.ai-insights', 'gui-config.json')`; otherwise returns `join(ledgerRoot, 'gui-config.json')`. Used by both `index.ts` and `gui/server.ts` to resolve the gui-config path consistently across processes.

**Step 3.** Create `mcp-server/src/storage/store-router.ts` — Write routing logic:
- `StoreRouter` class:
  - Constructor takes `StoresConfig | null` (null = legacy mode).
  - `resolveStoreForWrite(repoName: string): Promise<string>` — In legacy mode (null config): delegates to `resolveLedgerRoot()`. In multi-store mode: iterates stores in `stores.json` order, loads each store's `.repositories.json` via `loadRegistry(storePath)` (async), calls `findByFolderName(registry, repoName)`. Returns the path of the **first store** whose registry claims the repo. If no store claims the repo → throws an error: `"Repository '${repoName}' is not registered in any store. Register it via the GUI or CLI before creating projects."`
  - `resolveDefaultStore(): string` — returns the default store path (for operations not tied to a specific repo, like global knowledge writes).
  - `getAllStorePaths(): StoreEntry[]` — returns all registered stores (or a single-entry array wrapping `resolveLedgerRoot()` in legacy mode).
  - `isMultiStoreMode(): boolean` — returns `true` when `stores.json` is loaded.
  - `resolveStoreForRepo(repoName: string): Promise<{ storePath: string, storeId: string } | null>` — returns the store that claims the repo, or null if none. Used by `resolveStoreForWrite()` internally and by other components that need to know which store owns a repo without throwing.

  > **Note:** `resolveStoreForWrite()` and `resolveStoreForRepo()` are async because they call `loadRegistry()` which is async (`repository-registry.ts` L40). All callers must `await` these methods.

**Step 4.** Create `mcp-server/src/storage/multi-store-manager.ts` — Cross-store read operations:
- `MultiStoreManager` class:
  - Constructor takes `StoreRouter`.
  - `listAllProjects(status?)` → iterates all store paths, calls `LedgerStore.listAllProjects(storePath)` for each, tags each `ProjectMeta` with `store_id`, `store_label`, and `store_path` (the absolute path to the store root — required by GUI `handleListProjects` slow path to construct `LedgerStore` with the correct per-project `ledgerRoot`), merges into unified list.
  - `detectProjectByCwd(cwdPath)` → iterates all store paths, calls `LedgerStore.detectProjectByCwd(cwdPath, storePath)` for each. Returns the first `FOUND` match. If a single store returns `AMBIGUOUS` (intra-store collision), that result is forwarded as-is. If multiple stores each return `FOUND`, returns a new `MULTI_STORE_AMBIGUOUS` status with candidates tagged by `store_id` — this distinguishes cross-store collisions (a configuration error) from intra-store collisions (a genuine path overlap). If none match, returns `NOT_FOUND`.
    - **`MULTI_STORE_AMBIGUOUS` type definition:** Declare a `MultiStoreDetectResult` union type (either in `multi-store-manager.ts` or `store-router.ts`) that extends the existing `DetectProjectResult` union with: `{ status: 'MULTI_STORE_AMBIGUOUS'; candidates: Array<{ store_id: string; store_label: string; meta: ProjectMeta }> }`. The existing `DetectProjectResult` in `ledger-store.ts` remains unchanged — the multi-store union is a superset declared in the new module.
  - `getMergedRegistry()` → iterates all stores in order, loads each store's `.repositories.json`, merges entries using store-order priority (first store to claim a repo name wins). Returns a unified registry tagged with `store_id` per entry. Used by GUI, CLI, and repository-context tools.
  - `getRegistryConflicts()` → scans all per-store registries and identifies repositories that appear in more than one store's `.repositories.json`. Returns an array of conflict records, each containing: `repo_name` (the conflicting folder name), `entries[]` (array of `{ store_id, store_label, entry: RepositoryEntry }` for each store that claims it), and `winner_store_id` (the store that wins via store-order priority). This method is the single source of truth for cross-store repository conflicts — consumed by the GUI conflicts tab, `GET /api/stores/conflicts` endpoint, and CLI `store conflicts` command.
  - `searchKnowledge(query, options?)` → iterates all store paths, creates `KnowledgeStoreManager` for each, calls `searchInsights()`, deduplicates by insight `id` (first-seen wins), returns merged results.
  - `listKnowledge(options?)` → same pattern as search, but for `listInsights()`.

### Phase 2: Per-Store Repository Registry

**Step 5.** Adapt repository registry for per-store usage:
- Update `loadRegistry()` and `saveRegistry()` in `mcp-server/src/storage/repository-registry.ts` to accept an explicit `storePath` parameter (the store root directory). The registry path is `join(storePath, REGISTRY_FILENAME)`. In legacy mode (no `stores.json`), the existing behavior is preserved — `storePath` defaults to `resolveLedgerRoot()`.
- No schema changes to `RepositoryEntrySchema` — the existing schema is used as-is inside each store's `.repositories.json`.
- All consumers of the registry (`gui/api-repos.ts`, `StoreRouter`, tool files) specify which store's registry to read/write. In single-store mode, this is transparent — the single store path is used.

**Step 6.** Modify `mcp-server/gui/api-repos.ts` — Store-aware repository management:
- Add a `store_id` field to create/update schemas (`RepoCreateBodySchema`, `RepoUpdateBodySchema`). This field determines **which store's `.repositories.json`** receives the new/updated entry (not a field on the entry itself).
- Validate that `store_id` references a valid store in `stores.json`.
- When creating a repo, write the entry to the specified store's `.repositories.json`. When updating, locate the store that currently owns the entry (via `StoreRouter.resolveStoreForRepo()`) and update that store's registry. Moving a repo between stores requires deleting from the old store's registry and adding to the new one.
- The existing GUI repository management UI gains a "Store" dropdown when multiple stores are configured — the dropdown selects which store to write the repo definition to.
- `handleListRepos`: delegate to `MultiStoreManager.getMergedRegistry()` in multi-store mode (returning entries tagged with `store_id`), or to `loadRegistry(ledgerRoot)` in legacy mode. Without this change, the Strategy page's repository list would only show repos from the single default `ledgerRoot`, making repos in non-default stores invisible.

### Phase 3: MCP Server Integration

**Step 6b.** Create `mcp-server/src/storage/store-context.ts` — Shared singleton accessor (analogous to `src/utils/client-info.ts`):
- Module-level `let` variables for `StoreRouter` and `MultiStoreManager`.
- `setStoreContext(router: StoreRouter, manager: MultiStoreManager): void` — called once per process startup.
- `getStoreRouter(): StoreRouter` — returns the initialized router. Throws if called before `setStoreContext()`.
- `getMultiStoreManager(): MultiStoreManager` — returns the initialized manager. Throws if called before `setStoreContext()`.
- Both `src/index.ts` (MCP server process) and `gui/server.ts` (GUI server process) call `setStoreContext()` during their respective startup sequences, each independently loading `stores.json` via `loadStoresConfig()`. This avoids circular imports (tool files import from `store-context.ts`, not from `index.ts`) and works across the two-process architecture.

**Step 7.** Modify `mcp-server/src/index.ts` — Multi-store initialization:
- After `resolveLedgerRoot()`, attempt to load `stores.json` via `loadStoresConfig()`. `loadStoresConfig()` returns `null` on absence, malformed JSON, or schema failure (logging a warning) — no try-catch needed at this level for config errors.
- If `stores.json` loads successfully: create `StoreRouter` from config, ensure all store directories exist (`mkdirSync`), run `migrateToNamespacedLayout()` on each store path.
- If `stores.json` is absent or invalid (`null` return): create `StoreRouter` in legacy mode (wrapping the single ledger root). Log a message indicating single-store mode.
- Create `MultiStoreManager` from `StoreRouter`.
- Call `setStoreContext(router, manager)` from `store-context.ts` to make them accessible to tool files and other consumers. This follows the established `setMcpServer()` pattern in `client-info.ts`.
- GUI config path resolution: use `resolveGuiConfigPath(storeConfig, ledgerRoot)` from `store-registry.ts` — checks for `~/.ai-insights/gui-config.json` first when `stores.json` exists, falls back to `join(ledgerRoot, 'gui-config.json')`. GUI config remains a single server-wide file, not duplicated per store.

**Step 8.** Modify `mcp-server/src/tools/project-lifecycle.ts` — Multi-store reads and writes:
- `listProjects()`: replace `LedgerStore.listAllProjects(_ledgerRoot)` with `getMultiStoreManager().listAllProjects(status)`. Each returned project includes `store_id` and `store_label` fields.
- `detectProject()`: replace `LedgerStore.detectProjectByCwd(cwd)` with `getMultiStoreManager().detectProjectByCwd(cwd)`. Add a `MULTI_STORE_AMBIGUOUS` branch to the handler that returns a descriptive error listing the candidate projects and their store IDs, e.g.: `"Error: Project found in multiple stores. Provide an explicit project_path to disambiguate. Candidates: [store_id: personal] slug-a, [store_id: work] slug-b."` This branch is required because the current handler only covers `FOUND`, `AMBIGUOUS`, and `NOT_FOUND` — an unhandled status would silently fall through to the `NOT_FOUND` error message.
- `initializeProject()`: use `getStoreRouter().resolveStoreForWrite(repoName)` to determine which store to write to. In multi-store mode, this call will throw if no store's registry claims the repository — the error message guides the user to register it first. Then construct `LedgerStore(projectPath, resolvedLedgerRoot)`.
- `getProjectStatus()`: when resolving via `cwd_path`, the multi-store detect path is already used. When resolving via `project_path`, use `getStoreRouter().resolveStoreForWrite(deriveRepoName(projectPath))`.

**Step 9.** Modify `mcp-server/src/tools/knowledge.ts` — Multi-store knowledge:
- `addInsight()`: for `scope: 'global'`, write to the default store's `.knowledge/`. For `scope: 'repository'`, use `getStoreRouter().resolveStoreForWrite(repositoryName)` to find the correct store (the store whose registry owns that repository).
- `searchInsights()`: delegate to `getMultiStoreManager().searchKnowledge()` for cross-store search.
- `listInsights()`: delegate to `getMultiStoreManager().listKnowledge()` for cross-store listing.
- `updateInsight()` and `deleteInsight()`: identify which store contains the insight by iterating stores, then operate on that store's `KnowledgeStoreManager`.

**Step 10.** Modify `mcp-server/src/tools/repository-context.ts` — Multi-store repository context:
- Replace `resolveLedgerRoot()` call with `getStoreRouter().getAllStorePaths()`.
- Load merged repository registry via `getMultiStoreManager().getMergedRegistry()`.
- For each store, scan its projects.
- Merge results across stores.

**Step 10b.** Modify `mcp-server/gui/api.ts` — Orchestrator preflight repository validation:
- In `handleOrchestratorStart()`, add a preflight check that validates the plan path's derived repository is registered in at least one store's `.repositories.json` (in multi-store mode). If no store claims the repository, return a preflight failure with a clear message: *"Repository 'X' is not registered in any store. Register it in Storage → Repositories before starting a run."* This check runs before the existing preflight checks (venv, `.env`, dist freshness) so the user gets the registration error early.

### Phase 4: Minimal GUI Integration

Full GUI restructuring (new Storage page, Strategy-page refactoring to strategy-only focus, store badges on project list, new navigation routes) is deferred to a follow-up plan — it accounts for ~40% of the file-change surface and is not gated on any multi-store backend functionality. This phase adds the minimum API and form changes needed to make multi-store functional via the existing GUI.

**Step 11.** Modify `mcp-server/gui/api.ts` — Store-aware project listing, store info, and conflict detection endpoints:
- `handleListProjects`: delegate to `MultiStoreManager.listAllProjects()`. Include `store_id`, `store_label`, and `store_path` in the per-project data. The slow path (legacy meta files without cached enrichment) must use `meta.store_path` instead of the single `ledgerRoot` when constructing `new LedgerStore(meta.plan_path, meta.store_path)` — each project may come from a different store.
- Add `GET /api/stores` endpoint (read-only) — returns the list of registered stores (id, label, path, project count, repository count). Full store CRUD endpoints are deferred to the GUI follow-up plan.
- Add `GET /api/stores/conflicts` endpoint (read-only) — returns registry conflicts detected by `MultiStoreManager.getRegistryConflicts()`. Each conflict record includes the conflicting repository name, all store entries that claim it (with full `RepositoryEntry` data per store), and which store wins via store-order priority. Returns an empty array when no conflicts exist or in single-store mode.

**Step 12.** Modify existing Strategy page — Add Store dropdown and Conflicts tab:
- In `mcp-server/gui/public/views/strategy.js`, add a "Store" dropdown to the "Add Repository" form and the repository edit form (populated from `GET /api/stores`). The dropdown selects **which store's `.repositories.json`** receives the new/updated entry. Only appears when multiple stores are configured.
- Add `getStores()` and `getStoreConflicts()` to `mcp-server/gui/public/api-client.js`.

**Step 12b.** Modify `mcp-server/gui/server.ts` — Multi-store initialization, config path, and store routes:
- In `main()`, after `resolveLedgerRoot()`, load `stores.json` via `loadStoresConfig()`. Create `StoreRouter` and `MultiStoreManager`. Call `setStoreContext(router, manager)` — the same initialization as `index.ts` but for the GUI server process.
- Replace `const configPath = join(ledgerRoot, 'gui-config.json')` with `const configPath = resolveGuiConfigPath(storeConfig, ledgerRoot)` — checks for `~/.ai-insights/gui-config.json` first when `stores.json` exists, falls back to the current path.
- Update `handleListRepos` call in `buildRepoRoutes()` to use `MultiStoreManager.getMergedRegistry()` in multi-store mode.
- Add a new non-exported `buildStoreRoutes()` domain sub-builder function following the established pattern (`buildModelRoutes`, `buildRepoRoutes`, etc.). It requires no closure parameters — it calls `getMultiStoreManager()` and `getStoreRouter()` directly from `store-context.ts`. It returns:
  ```typescript
  // GET /api/stores — read-only store list
  { method: 'GET', path: '/api/stores', noBody: true,
    handler: async () => handleGetStores() },
  // GET /api/stores/conflicts — cross-store registry conflicts
  { method: 'GET', path: '/api/stores/conflicts', noBody: true,
    handler: async () => handleGetStoreConflicts() },
  ```
- Spread `...buildStoreRoutes()` in `buildRoutes()` (alongside the existing sub-builder spreads). `getRouteDescriptors()` picks up the new routes automatically since it calls `buildRoutes()`.

**Step 12c.** Add Conflicts tab to Strategy page:
- Add a **"Conflicts" tab** to the Strategy page's repository management section (alongside the existing repository list). The tab:
  - Fetches `GET /api/stores/conflicts` on load.
  - Shows a conflict count badge on the tab header (e.g., "Conflicts (2)"). Badge is hidden when count is zero.
  - Lists each conflicting repository with: repository name, a row per store that claims it (showing store label, vision summary, last-modified date), and a clear indicator of which store currently wins ("Active — store order priority") vs. which are shadowed ("Shadowed").
  - For each conflict, provides action buttons: "Move to Store" (moves the shadowed entry to a different store, resolving the conflict) and "Remove from Store" (deletes the shadowed entry from its store's registry).
  - When no conflicts exist, shows a clean empty state: "No conflicts — each repository is registered in exactly one store."
  - The tab only renders when multiple stores are configured (single-store mode has no conflicts by definition).

### Phase 5: CLI Convenience Layer

**Step 13.** Add `store` command group to `scripts/cli.js`:
- `store init` — creates `~/.ai-insights/stores.json` with a single store pointing at the current ledger root. Creates `~/.ai-insights/stores/` directory. The existing `{ledgerRoot}/.repositories.json` naturally becomes the default store's per-store registry — no migration needed.
- `store add <id> <path>` — registers a new store directory. Validates the path exists or offers to create it. Creates an empty `.repositories.json` in the new store if one doesn't exist.
- `store remove <id>` — removes a store from the registry (does not delete the directory). Warns if the store's `.repositories.json` contains repository entries.
- `store repo add <repo-name> <store-id>` — adds a repository entry to the specified store's `.repositories.json`. Prompts for label and folder_names if not provided.
- `store repo move <repo-name> <target-store-id>` — moves a repository entry from its current store's registry to the target store's registry.
- `store repo list` — shows all repositories from all stores (merged view with store-order priority), indicating which store each belongs to.
- `store list` — shows all stores, their paths, repository counts (from each store's `.repositories.json`), and project counts.
- `store default <id>` — sets the default store in `stores.json`.
- `store conflicts` — lists all repository registry conflicts (repos claimed by multiple stores), showing which store wins and which are shadowed.
- `store status` — for each store, shows sync status if the directory is a Git repo (ahead/behind counts). Gracefully degrades if the directory is not a Git repo.

### Phase 6: Documentation and Migration Guide

**Step 14.** Create user-facing documentation:
- `docs/references/multi-store-guide.md` — comprehensive guide covering: concept overview, setup walkthrough (single-store → multi-store migration), repository registration workflow, Git sync recommendations, CLI command reference, FAQ.
- Update `README.md` with a brief mention of multi-store capability and link to the guide.

**Step 15.** Update project manifests:
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add new files.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — document new classes, per-store registry model, merged registry view, and tool behavior changes.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — document multi-store read/write flows, store-order priority routing, merged registry collation.
- `mcp-server/docs/agents/project-manifest/constraints.md` — add multi-store constraints (mandatory registration, per-store registries, store-order routing).
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — No new dependencies. Document the new store module layer (StoreRegistry, StoreRouter, MultiStoreManager, StoreContext), the per-process initialization contract, and the departure from single-funnel `resolveLedgerRoot()`.
- Root `AGENTS.md` — update cross-system dependencies table with store config location and per-store `.repositories.json`.

## Dependencies

- No new npm dependencies. The implementation uses Node.js built-in modules (`os`, `path`, `fs`) and existing project dependencies (`zod`, `proper-lockfile`).
- `stores.json` is a new user-level configuration file; its location (`~/.ai-insights/`) is a new convention.
- Each store directory contains its own `.repositories.json` using the existing `RepositoryEntrySchema` — no schema changes needed.

## Required Components

### New Files
- `mcp-server/src/schema/store-config.ts` — Zod schemas for `StoreEntry` and `StoresConfig`
- `mcp-server/src/storage/store-registry.ts` — `stores.json` I/O (load, save, path resolution, `resolveGuiConfigPath()`)
- `mcp-server/src/storage/store-router.ts` — Write routing logic (`StoreRouter` class)
- `mcp-server/src/storage/multi-store-manager.ts` — Cross-store read operations (`MultiStoreManager` class), `MultiStoreDetectResult` union type
- `mcp-server/src/storage/store-context.ts` — Shared singleton accessor (`setStoreContext()`, `getStoreRouter()`, `getMultiStoreManager()`), following the `client-info.ts` pattern
- `docs/references/multi-store-guide.md` — User-facing setup and usage guide

### Modified Files
- `mcp-server/src/storage/repository-registry.ts` — Add explicit `storePath` parameter to `loadRegistry()`/`saveRegistry()` for per-store registry access
- `mcp-server/src/index.ts` — Multi-store startup initialization; call `setStoreContext()` from `store-context.ts`
- `mcp-server/src/tools/project-lifecycle.ts` — Delegate to `MultiStoreManager` for reads, `StoreRouter` for writes; enforce registration in multi-store mode
- `mcp-server/src/tools/knowledge.ts` — Cross-store knowledge search, per-store knowledge writes
- `mcp-server/src/tools/repository-context.ts` — Cross-store repository context aggregation; use merged registry
- `mcp-server/gui/api.ts` — Store-aware project listing, read-only `GET /api/stores` and `GET /api/stores/conflicts` endpoints, orchestrator preflight registration check
- `mcp-server/gui/api-repos.ts` — Add target `store_id` to create/update request schemas (determines which store's registry to write to); validate against `stores.json`; update `handleListRepos` to delegate to `MultiStoreManager.getMergedRegistry()` in multi-store mode
- `mcp-server/gui/server.ts` — Multi-store initialization in `main()` (load `stores.json`, call `setStoreContext()`); `gui-config.json` path resolution via `resolveGuiConfigPath()`; update `handleListRepos` in `buildRepoRoutes()` for merged registry; add new `buildStoreRoutes()` domain sub-builder with `GET /api/stores` and `GET /api/stores/conflicts` routes, spread in `buildRoutes()` alongside existing sub-builders
- `mcp-server/gui/public/views/strategy.js` — Add Store dropdown to repository Add/Edit forms; add Conflicts tab with conflict list, winner/shadowed indicators, and resolution actions
- `mcp-server/gui/public/api-client.js` — Add `getStores()` and `getStoreConflicts()` API methods
- `scripts/cli.js` — New `store` command group
- `mcp-server/docs/agents/project-manifest/file-tree.md` — New file entries
- `mcp-server/docs/agents/project-manifest/api-surface.md` — New class/tool documentation, per-store registry model, merged registry view, `GET /api/stores` endpoint
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Multi-store flow documentation, store-order priority routing
- `mcp-server/docs/agents/project-manifest/constraints.md` — Multi-store constraints (mandatory registration, per-store registries)
- Root `AGENTS.md` — Cross-system dependencies update
- Root `README.md` — Brief multi-store mention

## Assumptions

- The user-level config directory `~/.ai-insights/` is acceptable across all platforms (Windows: `C:\Users\{user}\.ai-insights\`, macOS/Linux: `/home/{user}/.ai-insights/`). The dot-prefix convention is standard for user-level config on Unix systems and is acceptable on Windows.
- Single-user, single-device-at-a-time access remains the primary usage pattern. The multi-store architecture does not introduce concurrent multi-device write safety — that remains the user's responsibility via their chosen sync mechanism.
- The `sync` field in `stores.json` is strictly informational metadata. The MCP server never reads or acts on it. CLI convenience commands (like `store status`) may inspect it for Git status reporting, but this is best-effort.
- Store paths are absolute after `~` expansion. Relative paths in `stores.json` are resolved relative to the config file's directory.
- Users will register their repositories in the appropriate store's `.repositories.json` before creating projects in multi-store mode. The error message for unregistered repositories is clear and actionable, guiding users to the GUI or CLI.
- The existing `.repositories.json` schema is unchanged — per-store registries use `RepositoryEntrySchema` as-is. Existing registry files work without modification; the file in the legacy ledger root naturally becomes the default store's per-store registry when migrating to multi-store.

## Constraints

- **No new npm dependencies.** All functionality is implemented with Node.js built-ins and existing project dependencies.
- **`LedgerStore` remains unchanged** in its per-store behavior. No modifications to its constructor, file I/O methods, or locking logic.
- **Backward compatibility is mandatory.** No `stores.json` = identical behavior to the current single-root system. Existing users must not notice any change unless they explicitly opt into multi-store. Repository registration remains optional in single-store mode.
- **Repository registration is mandatory in multi-store mode.** When `stores.json` exists, `ledger_initialize_project` (and any other write operation that creates new project data) requires the repository to be registered in at least one store's `.repositories.json`. Unregistered repositories produce a clear error.
- **Cross-platform policy applies.** All file paths use `path.join()`/`path.resolve()`. `~` expansion uses `os.homedir()`. No hardcoded separators.
- **Privacy boundary is physical.** Each store is a self-contained directory tree. Cross-store operations are read-only. There is no mechanism for cross-store writes.
- **No sync logic in the MCP server.** The MCP server never shells out to `git`, never makes network calls for sync, and has no knowledge of how stores are synchronized.
- **No new tool parameters for store selection.** Store routing is always implicit, resolved through per-store repository registries with store-order priority. Agents and orchestrator do not need to learn any store-related concepts.

## Out of Scope

- **Built-in Git sync automation** (auto-commit, auto-push, auto-pull). This is explicitly deferred to a future phase and will never live inside the MCP server process.
- **Full GUI restructuring** (new Storage page with Repositories/Ledger Storage tabs, Strategy-page refactoring to strategy-only focus with modal vision editor, store badges on project list, new navigation routes). Deferred to a follow-up plan — see Deferred Items. This phase adds only the minimal GUI integration (read-only `/api/stores` endpoint, Store dropdown on existing repository forms).
- **Store CRUD via GUI** (create/delete/edit stores via REST API). Users manage stores via `stores.json` or CLI commands in this phase. Deferred to the GUI follow-up plan.
- **Pluggable `StorageBackend` interface** (S3, Turso, etc.). Premature abstraction — only one backend (local filesystem) is needed. Can be introduced later if demand materializes.
- **Auto-assignment via glob patterns** (e.g., `"company-*": "work"`). Explicit per-store repository registration is sufficient.
- **Cross-store knowledge merge/dedup.** Read-time dedup by insight `id` is sufficient. No write-time merge between stores.
- **Sync conflict resolution.** If users' sync mechanisms produce file-level merge conflicts (e.g., two devices edit the same `.repositories.json` simultaneously), those are resolved outside the MCP server using standard merge tools. The Conflicts tab addresses a different concern: *registry-level* conflicts where the same repository is intentionally or accidentally registered in multiple stores.
- **Automatic repository registration.** In multi-store mode, users must explicitly register repositories. No auto-registration on first project creation — the error message guides users to register first.

## Acceptance Criteria

1. With no `stores.json` present, the MCP server behaves identically to the current implementation — all existing tests pass without modification. Repository registration remains optional.
2. With a valid `stores.json` containing two or more stores, `ledger_list_projects` returns projects from all stores, each tagged with `store_id` and `store_label`.
3. `ledger_initialize_project` creates a new project in the correct store — the first store (in `stores.json` order) whose `.repositories.json` claims the repository.
4. In multi-store mode, `ledger_initialize_project` for a repository not registered in any store's `.repositories.json` returns a clear error message: *"Repository 'X' is not registered in any store."*
5. `ledger_detect_project` searches all stores when resolving a `cwd_path` to a project. Cross-store collisions (same cwd matches projects in different stores) return `MULTI_STORE_AMBIGUOUS` with candidates tagged by `store_id`, distinct from intra-store `AMBIGUOUS`.
6. `ledger_search_insights` and `ledger_list_insights` return merged results from all stores' `.knowledge/` directories.
7. `ledger_add_insight` with `scope: 'repository'` writes to the store whose registry claims that repository. `scope: 'global'` writes to the default store.
8. The `GET /api/stores` endpoint returns the list of registered stores with project and repository counts.
9. The CLI `store init`, `store add`, `store list`, `store repo add`, `store repo list`, and `store default` commands work correctly.
10. All operations work correctly on Windows, macOS, and Linux (cross-platform `~` expansion, path separators).
11. Invalid or malformed `stores.json` produces a clear error message at server startup and falls back to single-store mode.
12. Store paths that do not exist are created automatically on server startup.
13. `RepositoryEntrySchema` is unchanged — existing `.repositories.json` files parse without errors or migration. The legacy registry file at `{ledgerRoot}/.repositories.json` becomes the default store's per-store registry.
14. The existing Strategy page's "Add Repository" and edit forms include a "Store" dropdown when multiple stores are configured, selecting which store's registry to write to.
15. When the same repository is registered in multiple stores, store-order priority (array order in `stores.json`) determines which store wins for writes. The merged registry view reflects this priority.
16. GUI config (`gui-config.json`) is a single server-wide file, not duplicated per store.
17. In multi-store mode, the GUI orchestrator preflight rejects repositories not registered in any store with a clear error before running other checks.
18. Repository metadata (vision, label, folder_names) travels with the store — syncing a store to a new device and adding it to `stores.json` auto-discovers its repositories.
19. `GET /api/stores/conflicts` returns an accurate list of repositories registered in multiple stores, identifying the winner (store-order priority) and shadowed entries.
20. The Strategy page's "Conflicts" tab displays cross-store repository conflicts with clear winner/shadowed indicators and provides actions to resolve them (move or remove the shadowed entry). The tab only appears when multiple stores are configured.

## Testing Strategy

Testing follows the existing pattern of Vitest unit and integration tests with temporary directories. The `_ledgerRoot` override parameter pattern (already established for testability) naturally extends to multi-store testing — tests create multiple temporary directories and a `stores.json` configuration pointing to them.

The critical testing focus is backward compatibility: the entire existing test suite must pass without modification when no `stores.json` is present (legacy mode).

## Test Plan

- `mcp-server/tests/schema/store-config.test.ts` — Validates `StoresConfigSchema` accepts valid configs and rejects invalid ones (missing fields, duplicate store IDs, missing default store). Covers AC-11.
- `mcp-server/tests/storage/store-registry.test.ts` — Tests `loadStoresConfig()` returns null when file is absent; loads and validates valid config; throws on malformed JSON; throws on schema failure. Tests `saveStoresConfig()` round-trip. Tests `expandStorePath()` with `~`, absolute, and relative paths across platforms. Covers AC-1, AC-10, AC-11.
- `mcp-server/tests/storage/store-router.test.ts` — Tests `resolveStoreForWrite()` in legacy mode (null config → delegates to `resolveLedgerRoot()`); in multi-store mode with repo registered in first store → returns first store; with repo registered in second store → returns second store; with repo registered in multiple stores → first store wins (store-order priority); with unregistered repo → throws clear error. Tests `getAllStorePaths()` in both modes. Tests that `StoreRouter` creation causes `mkdirSync(storePath, { recursive: true })` for each configured store path that does not yet exist (AC-12). Covers AC-1, AC-3, AC-4, AC-12, AC-15.
- `mcp-server/tests/storage/multi-store-manager.test.ts` — Tests `listAllProjects()` merges projects from multiple stores with correct tagging; tests `detectProjectByCwd()` finds projects across stores and returns `MULTI_STORE_AMBIGUOUS` for cross-store collisions; tests `getMergedRegistry()` returns entries with correct store-order priority (first store wins for duplicates); tests `searchKnowledge()` deduplicates by insight ID. Uses multiple temporary directories as stores. Covers AC-2, AC-5, AC-6, AC-15.
- `mcp-server/tests/storage/repository-registry.test.ts` — **Modify existing file** (do not overwrite): add new `describe` blocks for per-store registry scenarios — tests that `loadRegistry(storePath)` reads per-store registry; tests that `saveRegistry(storePath)` writes per-store registry; validates existing registry files parse without errors with unchanged schema. Existing 20+ test cases remain untouched. Covers AC-13.
- `mcp-server/tests/tools/project-lifecycle-multi-store.test.ts` — Integration tests: `initializeProject` routes to the correct store based on per-store registry lookup; `initializeProject` for unregistered repo returns error; `listProjects` returns tagged results from all stores; `detectProject` searches all stores. Covers AC-2, AC-3, AC-4, AC-5.
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — Integration tests: `addInsight` writes to the correct store (the one whose registry claims the repository); `searchInsights` returns cross-store results; `listInsights` merges results. Covers AC-6, AC-7.
- `mcp-server/tests/gui/api-stores.test.ts` — Tests `GET /api/stores` returns correct store list with project and repository counts. Covers AC-8.
- `mcp-server/tests/gui/api-repos-store.test.ts` — Tests that repo create with target `store_id` writes to the correct store's `.repositories.json`; tests that invalid `store_id` is rejected. Covers AC-14.
- `mcp-server/tests/gui/api-store-conflicts.test.ts` — Tests `GET /api/stores/conflicts` returns empty array when no conflicts; returns correct conflict records when same repo is in multiple stores (winner identified by store order); returns empty array in single-store mode. Covers AC-19.
- `mcp-server/tests/storage/multi-store-conflicts.test.ts` — Tests `getRegistryConflicts()` detects repos registered in multiple stores; correctly identifies winner by store-order priority; returns empty when no overlaps. Covers AC-19, AC-20.
- `mcp-server/tests/storage/cross-device-portability.test.ts` — Tests that adding a new store (with its own `.repositories.json` and projects) to `stores.json` immediately makes its repositories and projects visible without any additional registration. Covers AC-18.
- `mcp-server/tests/gui/api-orchestrator.test.ts` — **Modify existing file**: add test cases for the multi-store registration preflight in `handleOrchestratorStart()`: (a) multi-store mode, plan path derives a registered repo → proceeds normally; (b) multi-store mode, plan path derives an unregistered repo → returns preflight failure with specified message. Covers AC-17.
- `scripts/tests/store-commands.test.js` — Tests the `store` command group in `scripts/cli.js`: `store init` creates `~/.ai-insights/stores.json` pointing at the current ledger root; `store add <id> <path>` registers a new store and creates an empty `.repositories.json` in the new store directory; `store list` returns all registered stores; `store repo add <repo-name> <store-id>` writes a repository entry to the correct store's `.repositories.json`; `store default <id>` updates `default_store` in `stores.json`. Also covers the error case: `store add` with a non-existent path that cannot be created returns a clear error. Covers AC-9.
- **Existing test suite** — All 100+ existing tests must continue to pass without modification (no `stores.json` = legacy mode). Covers AC-1.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add entries for `store-config.ts`, `store-registry.ts`, `store-router.ts`, `multi-store-manager.ts`, `store-context.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document `StoreRegistry`, `StoreRouter`, `MultiStoreManager` public APIs (including `getRegistryConflicts()`); document per-store registry model and merged registry view; document `store_id`/`store_label` fields on project listing responses; document `MULTI_STORE_AMBIGUOUS` detection status; document read-only `GET /api/stores` and `GET /api/stores/conflicts` endpoints; document mandatory registration behavior in multi-store mode
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add "Multi-Store Write Routing" and "Multi-Store Read Collation" flow diagrams; document store-order priority routing chain; document merged registry collation flow
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add constraints: "stores.json is optional — absent = legacy mode", "Repository registration is mandatory in multi-store mode", "Each store owns its `.repositories.json`", "Store order in `stores.json` determines priority", "Cross-store operations are read-only", "No sync logic in MCP server", "No new tool parameters for store selection", "gui-config.json is server-wide, not per-store"
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — Document the new three-module store layer (StoreRegistry/StoreRouter/MultiStoreManager) plus the `store-context.ts` singleton accessor, the per-process initialization contract, and the departure from the single-funnel `resolveLedgerRoot()` pattern. Required by AGENTS.md maintenance rules ("change architectural pattern → tech-stack.md").
- Root `AGENTS.md` — Add `stores.json` and per-store `.repositories.json` to Cross-System Dependencies table; add `~/.ai-insights/` to Navigation Quick Reference
- Root `README.md` — Add brief multi-store section with link to `docs/references/multi-store-guide.md`
- `docs/references/multi-store-guide.md` — New file: concept overview, repository registration workflow, setup walkthrough, Git sync recommendations, CLI reference, FAQ

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | **Storage page** (`#/storage`) with Repositories and Ledger Storage tabs — full CRUD for repository entries (with store dropdown) and store entries (from `stores.json`) | Design review S2 — ~40% of file-change surface is not gated on multi-store backend | GUI restructuring is orthogonal to the storage architecture; shipping backend + CLI first reduces blast radius and keeps review surface focused | Reconsider after multi-store backend is stable and CLI-tested; may bundle with item 2 |
| 2 | **Strategy page refactoring** to strategy-only focus — remove repo CRUD, add modal vision editor, remove `#/strategy/:repoId` route, add "Manage Repositories →" link to Storage page | Design review S2 — Strategy page changes depend on the new Storage page existing | The existing Strategy page continues to work with the "Store" dropdown added in this plan | Ship together with item 1 |
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
| **Mandatory registration friction** — users may find it inconvenient to register repos before creating projects | The error message is clear and actionable, guiding users to the GUI or CLI. The `store repo add` CLI command provides a quick registration shortcut. In single-store mode (no `stores.json`), registration remains optional — no friction for users who don't need multi-store. |
| **Same repo in multiple stores** — a repository registered in multiple stores could create confusion about where writes go | Store-order priority (array order in `stores.json`) is deterministic and user-controllable. The GUI Conflicts tab, `GET /api/stores/conflicts` endpoint, and `store conflicts` CLI command all surface these overlaps with clear winner/shadowed indicators. Users can resolve conflicts via move or remove actions. |
| **Per-store registry sync conflicts** — two devices edit the same store's `.repositories.json` concurrently via their sync mechanism | This is the user's responsibility (same as project data). Registries are small JSON files that change rarely — sync conflicts are unlikely in practice. If they occur, standard JSON merge tools or manual resolution apply. |
