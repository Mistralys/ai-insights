# Constraints — Storage, Knowledge & Multi-Store

> **Scope:** The knowledge store, the multi-store ledger architecture, schema-strictness patterns
> that span both, and the storage-layer known limitations.
>
> **Companion documents:**
> [Core](constraints.md) ·
> [Workflow](constraints-workflow.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Knowledge Store Constraints](#knowledge-store-constraints)
- [Schema Strictness Patterns](#schema-strictness-patterns)
- [Multi-Store Architecture Constraints](#multi-store-architecture-constraints)
- [Known Limitations](#known-limitations)

---

## Knowledge Store Constraints

### Insight IDs Are UUID v4 Strings — Not Auto-Increment Integers

**Rule:** Every insight stored in the knowledge base has an `id` field that is a **UUID v4 string** generated via `crypto.randomUUID()` at creation time. The old auto-increment `next_id` counter no longer exists in `KnowledgeStoreSchema`. IDs are globally unique across all stores and all scopes.

**Rationale:** Auto-increment integers were per-store only — the same numeric `id` could appear in two independent stores, causing deduplication logic to discard valid insights on cross-store merge. UUID v4 eliminates this collision class without any coordination between stores.

**`moveInsight()` preserves the original UUID:** When an insight is promoted (`repository → global`) or moved (`global → repository` or `repository → repository`), the returned insight retains the source's `id` unchanged. No new UUID is assigned. Frontend consumers do not need to track a "pre-promote ID" to correlate with the post-move insight.

**`KnowledgeStoreSchema` does not include `next_id`:** Any store file containing a `next_id` field pre-dates the UUID migration. The schema no longer declares or persists it.

**`formatInsightId()` does not exist:** The helper that produced `KN-NNNN` / `{storeId}:KN-NNNN` display strings has been removed from `src/tools/knowledge.ts`. Tool responses do not include a `formatted_id` field.

**`parseKnowledgeId()` validates UUID format:** The `parseKnowledgeId(raw)` helper in `gui/api-knowledge.ts` validates UUID v4 format (via `z.string().uuid()`), not positive-integer format.

**Anti-patterns:**
```typescript
// ❌ WRONG — using store.next_id as insight ID (removed field)
const insight = { id: store.next_id++, ...fields };

// ❌ WRONG — treating id as a number
const found = store.insights.find(i => i.id === 42);
```

**Correct patterns:**
```typescript
// ✅ CORRECT — assign UUID at creation
import { randomUUID } from 'crypto';
const insight = InsightSchema.parse({ id: randomUUID(), ...fields });

// ✅ CORRECT — locate by UUID string
const found = store.insights.find(i => i.id === '550e8400-e29b-41d4-a716-446655440000');

// ✅ CORRECT — moveInsight() preserves UUID
const moved = await manager.moveInsight(insight.id, { scope: 'repository', repository_name: 'my-repo' }, 'global');
// moved.id === insight.id  ← same UUID
```

---

### `'global'` Is a Reserved Repository Name

**Rule:** The string `"global"` MUST NOT be used as a `repository_name` when adding or moving a repository-scoped insight. Calling `addInsight` or `repositoryStorePath()` with `repository_name === 'global'` throws an error.

**Rationale:** The global knowledge store file is named `global-insights.json`. If a repository were also named `"global"`, its store file would collide with the global store, corrupting both.

**Enforcement:** `KnowledgeStoreManager.repositoryStorePath(repoName)` throws `Error('Repository name "global" is reserved...')` when `repoName === 'global'`. This is the only enforcement point — the Zod `InsightSchema` and the MCP tool input schemas do NOT validate the reserved name; the guard is storage-layer-only.

**Anti-pattern:**
```typescript
// ❌ WRONG — 'global' is reserved; this will throw at the storage layer
await manager.addInsight({ scope: 'repository', repository_name: 'global', ... });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — use a real repository name (e.g. derived from repo root dir basename)
await manager.addInsight({ scope: 'repository', repository_name: 'my-repo', ... });

// ✅ CORRECT — to add cross-repository knowledge, use global scope instead
await manager.addInsight({ scope: 'global', ... });
```

---

### `origin_plan` Is Provenance Metadata Only — Not a Storage Key

**Rule:** The `origin_plan` field on an `Insight` is strictly a provenance annotation — it records which plan folder produced the insight. It MUST NOT be used as a storage discriminator, a routing key, or a scope identifier. The two valid storage scopes are `'global'` and `'repository'`; there is no `'project'` scope and `origin_plan` does not create one.

**Rationale:** A previous design used a `'project'` scope (with `project_slug` as the store key) that conflated storage location with planning provenance. The current design separates these concerns: `scope` + `repository_name` determine where an insight is stored; `origin_plan` records where it was first discovered, regardless of where it is stored.

**Forbidden patterns:**
- Using `origin_plan` as a scope value (e.g. `scope: origin_plan`) ❌
- Using `origin_plan` as a `repository_name` discriminator ❌
- Passing `origin_plan` to any store-selection method (`searchInsights`, `listInsights`, `updateInsight`, `deleteInsight`) as a filter ❌
- Treating `origin_plan` as equivalent to `project_slug` in the sense of defining a per-project store ❌

**Correct usage:**
```typescript
// ✅ CORRECT — origin_plan is metadata only; scope + repository_name determine storage
await manager.addInsight({
  scope: 'repository',
  repository_name: 'ai-insights',       // storage key — where it lives
  origin_plan: '2026-05-01-my-feature', // provenance — where it was discovered
  title: '...',
  // ...
});
```

---

### `.knowledge/` Uses a Single Lock Scope; Excluded from Project Enumeration

**Rule:** All write operations on the `.knowledge/` store (`addInsight`, `updateInsight`) MUST acquire a single `withLock(knowledgeDir(), ...)` scope that covers the entire read-modify-write sequence. Pure reads (`searchInsights`, `listInsights`) do NOT acquire a lock, consistent with the `LedgerStore` read pattern. The `.knowledge/` directory lives at `{ledgerRoot}/.knowledge/` and MUST NOT be included in project enumeration (`listAllProjects`, `detectProjectByCwd`) — it is global infrastructure, not a per-project ledger.

**Rationale:** Using a single lock on `knowledgeDir()` (rather than per-file locks) prevents concurrent writers from interleaving across `global-insights.json` and `{repository_name}-insights.json` stores. Excluding `.knowledge/` from project enumeration prevents it from being misidentified as a project directory.

**Lock target:** Always `knowledgeDir()` — never a per-file path and never `store.storageDir` (that is the per-project lock target, not the knowledge store lock target).

**Anti-pattern:**
```typescript
// ❌ WRONG — separate lock per store file; concurrent writers can interleave
await withLock(globalStorePath(), async () => { /* write global store */ });
await withLock(projectStorePath(slug), async () => { /* write project store */ });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — single lock on the knowledge directory for any write operation
await withLock(knowledgeDir(), async () => {
  const store = await _readStore(storePath);
  // ... mutate store ...
  await atomicWriteJson(storePath, store);
});
```

**Project enumeration exclusion:** `LedgerStore.listAllProjects()` reads `readdir(ledgerRoot)` and filters to subdirectories. The `.knowledge` entry is excluded by the existing filter that skips dot-prefixed entries — no additional code change is required. This constraint documents the expected behaviour so it is preserved if the filter is ever modified.

---

### Queue-Entry Path Segments Must Be Validated at Two Layers

**Rule:** Any code path that constructs a filesystem path from a queue-entry `slug` or `expectedRepo` field **must** apply `assertSafeSegment()` validation **before** passing those values to `join()` or any file-system API. Validation must occur at **both** of the following layers:

1. **Type-guard layer — `isRawQueueEntry()` in `validate-entry.ts`:**
   Normalizes `expectedRepo` to `null` in-place when the value is absent, not a string, or an empty/whitespace-only string (`.trim().length === 0`). This ensures every validated `RawQueueEntry` carries `expectedRepo: string | null` with no empty strings downstream.

2. **Call-site layer — `getProjectLedgerStatus()` in `get-queue.ts`:**
   Calls `assertSafeSegment(slug)` (always) and `assertSafeSegment(expectedRepo)` (when non-null) immediately before any `join()` call. Returns `{ exists: false, synthesisGenerated: false }` (fail-safe) when either check fails.

**Rationale:** The two-layer approach is necessary because `getProjectLedgerStatus()` is also called directly by `killQueueEntry()` and `dismissQueueEntry()` in `orchestrator-manager.ts`. Future call sites that bypass `isRawQueueEntry()` would have no path-segment protection without the second layer. The call-site guard is cheap (one regex test) and eliminates the need for callers to reason about whether their entry arrived via the type guard.

**Fail-safe defaults:**
- `isRawQueueEntry()` normalizes silently to `null` — the entry remains valid for other fields.
- `getProjectLedgerStatus()` returns `{ exists: false, synthesisGenerated: false }` on any assertion failure — the safe direction; entries are not displayed as active.

**Anti-pattern:**
```typescript
// ❌ WRONG — constructs a path directly from a queue-entry field without validation
const ledgerPath = join(ledgerRoot, entry.expectedRepo!, entry.expectedSlug, 'project-ledger.json');
```

**Correct pattern:**
```typescript
// ✅ CORRECT — assertSafeSegment() guards before any join()
if (!assertSafeSegment(slug)) {
  return { exists: false, synthesisGenerated: false };
}
if (expectedRepo !== null && !assertSafeSegment(expectedRepo)) {
  return { exists: false, synthesisGenerated: false };
}
const ledgerPath = expectedRepo
  ? join(ledgerRoot, expectedRepo, slug, 'project-ledger.json')
  : join(ledgerRoot, slug, 'project-ledger.json');
```

**`assertSafeSegment()` rejects:** uppercase letters, path separators (`/`, `\`), traversal sequences (`..`), null bytes, Unicode lookalikes, empty strings, and whitespace-only strings (SAFE_SLUG_REGEX anchor `^[a-z0-9]` + Boolean guard).

**See also:** [Ledger Storage Paths Must Include the Repository Namespace Level](constraints.md#ledger-storage-paths-must-include-the-repository-namespace-level); `api-surface.md` §`assertSafeSegment` (canonical validation delegate).

---

## Schema Strictness Patterns

### Dual-Schema Pattern — Strict Input Schemas, Permissive Storage Schemas

**Rule:** Input schemas (tool parameters) enforce strict contracts (required, non-nullable, min-length). Storage schemas (persisted JSON) declare the same fields as `.nullable().optional()` for backward compatibility with records created before the field existed. Bridge logic uses key-presence checks (`'field' in cacheUpdates`) to distinguish "not provided" from "explicitly null".

**Rationale:** Legacy records must parse without migration. New tool calls must enforce quality. The two concerns require different schema strictness levels — combining them into one schema satisfies neither.

**Canonical example:** `CompleteSynthesisSchema.outcome_summary` is `z.string().min(10)` (input); `ProjectMetaSchema.outcome_summary` is `z.string().nullable().optional()` (storage).

**Second instance:** `InitializeProjectSchema.project_summary` is `z.string().min(1)` (input, optional — absent is valid but empty string is not); `RootIndexSchema` and `ProjectMetaSchema` declare it as `z.string().nullable().optional()` (storage). Bridge logic in `initializeProject()` uses a conditional spread to omit the field entirely when not provided.

**Anti-pattern:**
```typescript
// ❌ WRONG — using .optional() on an input schema to avoid handling legacy data;
// this shifts the quality gate to runtime callers and allows degenerate input through.
outcome_summary: z.string().optional()
```

**Correct pattern:**
```typescript
// ✅ CORRECT — input schema is strict; storage schema is permissive; bridge uses key-presence check.
// Input schema (tool parameters):
outcome_summary: z.string().min(10)

// Storage schema (persisted JSON):
outcome_summary: z.string().nullable().optional()

// Bridge logic (writeProjectMeta):
if ('outcome_summary' in cacheUpdates) {
  updates.outcome_summary = cacheUpdates.outcome_summary;
}
```

---

### Graceful Degradation — `@remarks` Fallback Contract for Optional Enrichment Paths

**Rule:** Any function that provides optional enrichment data (where absence is acceptable) must document its fallback behavior in a `@remarks` JSDoc block. The remark must state: (1) what conditions trigger the fallback, (2) what value is returned as the fallback, and (3) whether the fallback is silent or logged.

**Rationale:** Several components in the history system use this pattern (`loadRegistry`, `safeListRepositoryInsights`, the Planner workflow step). Without explicit documentation, future contributors may "fix" the silent degradation by throwing errors, breaking the enrichment-is-optional contract.

**Canonical examples:** `loadRegistry()` in `repository-registry.ts` (returns `{ repositories: [] }` on absent/corrupt file), `safeListRepositoryInsights()` in `repository-context.ts` (returns `[]` on SLUG_REGEX failure).

**Anti-pattern:**
```typescript
// ❌ WRONG — a function that degrades gracefully but documents only the success path in JSDoc.
/**
 * Returns the repository registry.
 */
async function loadRegistry(root: string): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(registryPath(root), 'utf-8'));
  } catch {
    return { repositories: [] };
  }
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — @remarks block explicitly states fallback trigger, fallback value, and observability.
/**
 * Returns the repository registry.
 *
 * @remarks
 * Falls back to `{ repositories: [] }` when the registry file is absent or contains
 * invalid JSON. The fallback is silent (no log, no metric). Callers must treat an
 * empty `repositories` array as a valid state — the registry is optional enrichment.
 */
async function loadRegistry(root: string): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(registryPath(root), 'utf-8'));
  } catch {
    return { repositories: [] };
  }
}
```

---

## Multi-Store Architecture Constraints

These constraints apply only when `stores.json` is present; its absence activates legacy single-store mode with no behavioral changes.

### `stores.json` Is Optional — Its Absence Means Legacy Single-Store Mode

**Rule:** When `~/.ai-insights/stores.json` does not exist, the server behaves exactly as before the multi-store architecture: `resolveLedgerRoot()` returns the single root, all reads and writes use it, and repository registration remains optional. No error is thrown, no migration is triggered, no behavior changes.

**Rationale:** Backward compatibility requires that existing single-store users be entirely unaffected.

**Implementation:** `loadStoresConfig()` returns `null` when the file is absent. Callers treat `null` as the signal to use legacy mode. `StoreRouter` in legacy mode delegates to `resolveLedgerRoot()`.

---

### Repository Registration Is Mandatory in Multi-Store Mode

**Rule:** When `stores.json` is present, creating a project in an unregistered repository is a hard error: `"Repository 'X' is not registered in any store. Register it via the GUI or CLI before creating projects."` The server never silently routes unregistered repositories to a default store in multi-store mode.

**Rationale:** Silent default-store routing causes "where did my project go?" confusion — a user who forgets to register before creating a project silently accumulates data in the wrong store. The registration error is one-time friction that prevents an ongoing class of misconfiguration.

**Exception:** In single-store mode, registration remains optional — no friction for users who do not need multi-store.

---

### Per-Store Registries — Each Store Owns Its `.repositories.json`

**Rule:** Repository metadata is stored in each store's own `.repositories.json` at `{storePath}/.repositories.json`. There is no central cross-store registry. The existing `RepositoryEntrySchema` is reused as-is; only the file location changes.

**Rationale:** Per-store registries make stores fully self-contained and portable — repository metadata travels with the store during sync. A central registry would require manual re-registration on every new device after syncing a store.

**Implementation:** `loadRegistry(storePath)` and `saveRegistry(storePath, data)` accept an explicit `storePath` parameter. In legacy mode, `storePath` defaults to `resolveLedgerRoot()`.

---

### Store-Order Priority Governs Write Routing

**Rule:** When multiple stores are configured, the **array order in `stores.json`** determines write priority. The first store whose `.repositories.json` claims a repository name is the write target for that repository. Reordering entries in `stores.json` changes which store wins.

**Rationale:** Store-order priority gives users a simple, controllable conflict-resolution mechanism. Earlier stores win — reorder to change priority.

**Implementation:** `StoreRouter.resolveStoreForWrite(repoName)` iterates stores in `stores.json` order, loading each store's `.repositories.json` until it finds one that claims the repo.

---

### Multi-Store Collation Is Read-Only

**Rule:** All cross-store operations (list projects, merge registries, detect project by cwd, search knowledge) are **read-only**. No write operation spans multiple stores. Each write is routed to exactly one store (the owning store, determined by `resolveStoreForWrite()`).

**Rationale:** Cross-store write operations require distributed locking or conflict detection, which adds significant complexity and failure modes. All writes remain within a single store's `withLock()` scope.

**Implementation:** `MultiStoreManager` provides only collation methods (`listAllProjects`, `getMergedRegistry`, `detectProjectByCwd`, `getRegistryConflicts`, `searchKnowledge`, `listKnowledge`). Write routing is exclusively the domain of `StoreRouter`.

---

### The MCP Server Has No Sync Responsibility

**Rule:** The MCP server reads and writes local JSON files only. It has no knowledge of Git, S3, Syncthing, or any other sync mechanism. Sync between store directories is entirely the user's responsibility and external to the MCP server's codepath.

**Rationale:** Keeping sync external eliminates an entire class of failure modes (network errors, auth failures, merge conflicts) from the MCP server. Users choose the sync strategy that suits their environment.

---

### Multi-Store Routing Requires No New Tool Parameters

**Rule:** No MCP tool exposes a `store_id` parameter. Store routing is implicit — derived from the repository name (via `deriveRepoName(projectPath)`), which is derived from the project path. Agents, orchestrator, and CLI tools require no new parameters to operate in multi-store mode.

**Rationale:** Adding a `store_id` parameter to every tool would burden every agent invocation and break backward compatibility. Implicit per-repo routing makes multi-store transparent to all existing tool consumers.

**Exception:** The GUI and CLI allow users to specify a target store when creating a new repository entry — a user-facing configuration action, not an agent tool call.

---

### `gui-config.json` Is Server-Wide — One File per Process, Not per Store

**Rule:** The GUI server uses a single `gui-config.json` for all behavioral settings (`auto_handoff_enabled`, `auto_archive_days`, etc.). In multi-store mode, this file lives at `~/.ai-insights/gui-config.json`. In single-store mode, it lives at `{ledgerRoot}/gui-config.json`. There is no per-store `gui-config.json`.

**Rationale:** All current config fields are server-wide behavioral settings with no store-scoped semantics. Per-store configs would create ambiguity about which store's config governs server behavior when multiple stores are active.

**Implementation:** `resolveGuiConfigPath(storeConfig, ledgerRoot)` in `src/storage/store-registry.ts` — returns the user-level path when `storeConfig` is non-null (multi-store), otherwise the ledger-root path.

---

### MCP Tool Handlers Must Use `resolveMultiStoreLedgerRoot()`

**Rule:** Every MCP tool handler function that constructs a `LedgerStore` must resolve the correct store root by calling `resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot)` and passing the result to `new LedgerStore(...)`. Handlers that have a `_ledgerRoot` parameter (test-injection bypass) must pass that raw value as the second argument so the string-guard check inside `resolveMultiStoreLedgerRoot` can activate the test override.

The older `extractLedgerRoot(_ledgerRoot)` helper — which strips the `RequestHandlerExtra` object from the `_ledgerRoot` parameter but performs no store routing — is **not sufficient for multi-store mode** and must not be used when constructing a `LedgerStore` directly.

**Rationale:** `extractLedgerRoot` only guards against the MCP SDK injecting a `RequestHandlerExtra` object; it does not route the project to its owning store. In multi-store mode a handler that calls `new LedgerStore(projectPath)` or `new LedgerStore(extractLedgerRoot(_ledgerRoot))` silently falls through to the default store, causing reads and writes to target the wrong ledger directory for any project registered in a non-default store. `resolveMultiStoreLedgerRoot` subsumes the `extractLedgerRoot` guard (step 1 of its resolution order) and adds full store routing.

**Anti-pattern:**
```typescript
// ❌ WRONG — extractLedgerRoot bypasses store routing; projects in non-default stores
//            will be silently read/written from the default store.
const ledgerRoot = extractLedgerRoot(_ledgerRoot);
const store = new LedgerStore(ledgerRoot ?? projectPath);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — resolveMultiStoreLedgerRoot routes to the owning store and subsumes
//              the extractLedgerRoot guard (test override is step 1 of resolution order).
const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
const store = new LedgerStore(ledgerRoot ?? projectPath);
```

**Migration scope:** All affected handler functions in `work-package.ts`, `pipeline.ts`, `begin-work.ts`, `observations.ts`, `workflow-handoff.ts`, `workflow-next-action.ts`, and `project-lifecycle.ts` have been migrated. Any new handler added to these files — or any handler that previously called `extractLedgerRoot(_ledgerRoot)` directly — must apply the same 3-line pattern: import `resolveMultiStoreLedgerRoot`, await it with `(projectPath, _ledgerRoot)`, and pass the result as the first `LedgerStore` constructor argument.

**Write-routing exception:** Handlers that create new ledger state — currently `initializeProject()` (`project-lifecycle.ts`), `importStandalone()` (`standalone-import.ts`), and `createWorkPackage()` (`work-package.ts`) — must use the `resolveStoreForWrite()` pattern instead. This enforces that the target repository is registered in a store, preventing silent phantom directory creation in the default store. See `initializeProject()` for the reference pattern.

---

## Known Limitations

### KL-1. `'unknown'` Namespace Collision When Repo Root Fails Slug Validation

**Affected components:** `LedgerStore.storageDir` (via `deriveRepoName()` in `src/utils/ledger-root.ts`) and `migrateToNamespacedLayout()` (via the `repository_name` field in `.meta.json`)

**Trigger condition — `LedgerStore.storageDir`:** `deriveRepoName()` derives the repo name by lowercasing the project-root directory basename and delegates to `assertSafeSegment()` (which encapsulates `SAFE_SLUG_REGEX`) for validation. When a repo's root directory name contains characters that fail this check — dots (e.g. `my.project`), underscores, non-ASCII characters, or a path too shallow to extract four levels — `deriveRepoName()` falls back to `'unknown'`. If two or more such repos exist on the same machine, their projects share the `{ledgerRoot}/unknown/` namespace and can **collide by slug**.

**Trigger condition — `migrateToNamespacedLayout()`:** The migration function uses `repository_name` from each project's `.meta.json` as the namespace. If `repository_name` is absent, `null`, or an empty string, the project is moved to `{ledgerRoot}/unknown/{slug}/`. Additionally, if a user has a repository literally named `'unknown'` (a valid, slug-compatible name), its projects share the namespace with all fallback projects.

**Mitigation:** Rename the repository root directory to a slug-compatible name (lowercase alphanumeric and hyphens only, e.g. `My.Project` → `my-project`). This is the only reliable fix; there is no server-side escape hatch once two repos produce the same `repoName`. For the migration-layer scenario, also avoid naming a repository `'unknown'`.

**Detection:** Inspect `{ledgerRoot}/unknown/` — multiple slug subdirectories there indicate affected projects. Each `.meta.json` inside identifies the originating `plan_path`.

---

### KL-2. `auto-archive.ts` Multi-Store Guard Is Less Specific Than the GUI Guards

**Affected component:** `src/gui/auto-archive.ts`

**Divergence:** `auto-archive.ts` activates multi-store scanning with the guard `isStoreContextInitialized()` alone. All other multi-store guards in `gui/api.ts` (`resolveProjectStore`) and `gui/server.ts` (`resolveRepoName`, run-log routes) use the compound form `isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`.

**Why it is functionally equivalent:** `StoreRouter.getAllStores()` called inside `getMultiStoreManager().listAllProjects()` returns a single-element array containing `resolveLedgerRoot()` when the router is in legacy mode (null config). Auto-archive therefore scans a single store in both single-store and multi-store mode — the behavior difference is invisible to the caller.

**Why it still matters:** Future contributors reading `auto-archive.ts` in isolation may assume the single-guard form has different intended semantics and introduce a behavioral divergence. Aligning `auto-archive.ts` to the compound guard form would remove the ambiguity.

---

### KL-3. `assertSafeSlug` Is Defined in Four Files, and One Does Not Delegate

**Affected components:** `src/utils/ledger-root.ts`, `src/utils/path-validator.ts` (the canonical delegate), `src/gui/handlers/run-log-handlers.ts`, `gui/api.ts`, and `gui/server.ts`

**Current state:** `assertSafeSlug` wrappers in `src/utils/ledger-root.ts`, `src/gui/handlers/run-log-handlers.ts`, and `gui/api.ts` delegate to `assertSafeSegment()` from `src/utils/path-validator.ts`, which encapsulates the `SAFE_SLUG_REGEX` check. The throw-type variants differ by layer (`Error` in the storage layer; `ApiError NOT_FOUND` in the GUI layer) — that separation is intentional. `deriveRepoName()` in `src/utils/ledger-root.ts` also delegates to `assertSafeSegment()` directly.

**The gap:** `gui/server.ts` still performs an inline `SAFE_SLUG_REGEX.test()` call rather than delegating to `assertSafeSegment()`. A change to `assertSafeSegment()` therefore does **not** propagate to `gui/server.ts`.

**Ongoing invariant (partially held):** When slug-segment validation logic changes, update `assertSafeSegment()` in `path-validator.ts` **and** the inline check in `gui/server.ts` until the latter is migrated to delegate.
