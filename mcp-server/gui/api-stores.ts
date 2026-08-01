/**
 * GUI API Route Handlers — Stores Domain
 *
 * All REST handlers for the /api/stores and /api/stores/:storeId endpoints.
 * Follows the domain-split pattern established by `api-repos.ts` and
 * `api-knowledge.ts` — each API domain gets its own handler file imported
 * from `server.ts`.
 *
 * Routes provided (managed by buildStoreRoutes() in server.ts):
 *   GET    /api/stores                       — enriched store list (replaces old handleGetStores)
 *   GET    /api/stores/conflicts             — cross-store repository conflicts
 *   POST   /api/stores                       — add a new store (creates directory)
 *   POST   /api/stores/import                — import existing directory as a store
 *   PUT    /api/stores/order                  — reorder stores
 *   PUT    /api/stores/:storeId              — update store label
 *   DELETE /api/stores/:storeId              — remove a store (deregisters only)
 *   POST   /api/stores/:storeId/default      — set the default store
 *
 * Validation rules:
 *   - `id`: must match SLUG_REGEX; must not be a reserved word ("import",
 *     "order", "conflicts"); must be unique.
 *   - `path`: must be absolute (/...) or home-relative (~/...); relative paths
 *     are rejected. Duplicate resolved paths are rejected with 409.
 *   - `label`: optional; trimmed; whitespace-only rejected with 400.
 *
 * Git detection:
 *   - Each store is tested with `git rev-parse --git-dir` (5-second timeout).
 *   - `ahead`/`behind` come from `git rev-list --left-right --count HEAD...@{upstream}`.
 *   - All git commands degrade gracefully: ENOENT → is_git: false; timeout or
 *     no upstream → ahead/behind omitted.
 *
 * Error shape: { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   VALIDATION_ERROR → 400
 *   CONFLICT         → 409
 *   INTERNAL_ERROR   → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import {
  loadStoresConfig,
  saveStoresConfig,
  expandStorePath,
} from '../src/storage/store-registry.js';
import {
  reloadStoreContext,
  isStoreContextInitialized,
  getMultiStoreManager,
} from '../src/storage/store-context.js';
import { LedgerStore } from '../src/storage/ledger-store.js';
import { loadRegistry } from '../src/storage/repository-registry.js';
import { RepositoryRegistrySchema } from '../src/schema/repository-registry.js';
import type { StoresConfig, StoreListItem } from '../src/schema/store-config.js';
import { SLUG_REGEX } from '../src/schema/common.js';
import type { RegistryConflict } from '../src/storage/multi-store-manager.js';

export { ApiError };
export type { StoreListItem };

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

/** Store IDs that collide with literal API path suffixes in buildStoreRoutes(). */
const RESERVED_IDS = new Set(['import', 'order', 'conflicts']);

/** Timeout in milliseconds for git subprocess calls. */
const GIT_TIMEOUT_MS = 5_000;

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Runs a single git command in the given directory with a 5-second timeout.
 * Rejects on any error (non-zero exit, ENOENT, timeout).
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout;
}

/**
 * Detects whether `storePath` is a Git repository and, if so, fetches
 * ahead/behind counts relative to the upstream tracking branch.
 *
 * - `is_git: false` when Git is not installed (ENOENT) or the directory is not
 *   a Git repo (non-zero `rev-parse` exit).
 * - `ahead`/`behind` are omitted when no upstream tracking branch exists (exit
 *   128 from `rev-list`) or when any git command times out.
 */
async function detectGitStatus(
  storePath: string
): Promise<{ is_git: boolean; ahead?: number; behind?: number }> {
  try {
    await runGit(['rev-parse', '--git-dir'], storePath);
  } catch (err) {
    // ENOENT → git not installed; any other error → not a git repo
    return { is_git: false };
  }

  // Is a git repo — try to get ahead/behind counts
  try {
    const raw = await runGit(
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      storePath
    );
    const parts = raw.trim().split(/\s+/);
    const ahead = parseInt(parts[0] ?? '', 10);
    const behind = parseInt(parts[1] ?? '', 10);
    if (!isNaN(ahead) && !isNaN(behind)) {
      return { is_git: true, ahead, behind };
    }
  } catch {
    // No upstream, timeout, or detached HEAD — ahead/behind omitted
  }

  return { is_git: true };
}

/**
 * Builds the enriched StoreListItem array from an in-memory StoresConfig.
 *
 * All stores are processed concurrently via `Promise.all`. Git detection for
 * each store runs concurrently alongside the project/registry I/O.
 */
async function buildEnrichedMultiStoreList(config: StoresConfig): Promise<StoreListItem[]> {
  return Promise.all(
    config.stores.map(async (entry) => {
      const expandedPath = expandStorePath(entry.path);
      const [[projects, registry], gitStatus] = await Promise.all([
        Promise.all([
          LedgerStore.listAllProjects(expandedPath),
          loadRegistry(expandedPath),
        ]),
        detectGitStatus(expandedPath),
      ]);
      return {
        id: entry.id,
        label: entry.label ?? entry.id,
        path: expandedPath,
        project_count: projects.length,
        repository_count: registry.repositories.length,
        is_default: entry.id === config.default_store,
        is_git: gitStatus.is_git,
        ...(gitStatus.ahead !== undefined ? { ahead: gitStatus.ahead } : {}),
        ...(gitStatus.behind !== undefined ? { behind: gitStatus.behind } : {}),
        ...(entry.sync !== undefined ? { sync: entry.sync } : {}),
      };
    })
  );
}

/**
 * Rejects relative paths. Absolute paths start with '/' and home-relative
 * paths start with '~/' or are exactly '~'.
 */
function assertAbsolutePath(rawPath: string): void {
  if (!rawPath.startsWith('/') && !rawPath.startsWith('~/') && rawPath !== '~') {
    validationError(
      `Store path must be absolute (starting with /) or home-relative (starting with ~/). ` +
        `Relative paths are not supported.`
    );
  }
}

/** Rejects IDs that shadow literal API path suffixes. */
function assertNotReservedId(id: string): void {
  if (RESERVED_IDS.has(id)) {
    validationError(`Store ID "${id}" is reserved. Choose a different identifier.`);
  }
}

/** Trims a label and rejects empty/whitespace-only values. */
function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === '') {
    validationError('label must not be whitespace-only.');
  }
  return trimmed;
}

/** Throws CONFLICT when a store with `id` already exists in `config`. */
function assertNoDuplicateId(config: StoresConfig | null, id: string): void {
  if (config !== null && config.stores.some((s) => s.id === id)) {
    throw new ApiError('CONFLICT', `A store with id "${id}" already exists.`);
  }
}

/** Throws CONFLICT when a store with the same resolved `expandedPath` already exists. */
function assertNoDuplicatePath(config: StoresConfig | null, expandedPath: string): void {
  if (config === null) return;
  for (const s of config.stores) {
    let existingExpanded: string;
    try {
      existingExpanded = expandStorePath(s.path);
    } catch {
      continue; // skip entries with unresolvable paths
    }
    if (existingExpanded === expandedPath) {
      throw new ApiError('CONFLICT', `A store already exists at path "${expandedPath}".`);
    }
  }
}

/**
 * Creates the store directory (no-op if it already exists) and seeds an empty
 * `.repositories.json` when one is not already present.
 *
 * Throws ApiError with code 'INTERNAL_ERROR' (→ 500) on EACCES / EPERM.
 */
async function createStoreDirectory(expandedPath: string): Promise<void> {
  try {
    await mkdir(expandedPath, { recursive: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      throw new ApiError(
        'INTERNAL_ERROR',
        `Cannot create store directory: permission denied at ${expandedPath}.`
      );
    }
    throw err;
  }

  const registryPath = join(expandedPath, '.repositories.json');
  try {
    await stat(registryPath);
    // File already exists — do not overwrite
  } catch {
    // File does not exist — create an empty registry
    try {
      await writeFile(registryPath, JSON.stringify({ repositories: [] }), 'utf-8');
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        throw new ApiError(
          'INTERNAL_ERROR',
          `Cannot create store directory: permission denied at ${expandedPath}.`
        );
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

const AddStoreBodySchema = z
  .object({
    id: z.string().regex(SLUG_REGEX, {
      message:
        'id must start with an alphanumeric character and contain only letters, digits, hyphens, and underscores.',
    }),
    path: z.string().min(1, { message: 'path must be a non-empty string.' }),
    label: z.string().optional(),
  })
  .strict();

// Import has identical shape to add; the semantics differ (directory must exist).
const ImportStoreBodySchema = AddStoreBodySchema;

const UpdateStoreBodySchema = z
  .object({
    label: z.string(),
  })
  .strict();

const ReorderStoresBodySchema = z
  .object({
    order: z.array(z.string()),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /api/stores — handleGetStoresEnriched
// ---------------------------------------------------------------------------

/**
 * Returns the list of configured stores, each enriched with `is_default`,
 * `is_git`, optional `ahead`/`behind`, project and repository counts, and
 * optional `sync` metadata.
 *
 * Mode selection is based on `loadStoresConfig()`:
 * - **Multi-store** (non-null config): iterates `config.stores`.
 * - **Legacy / single-store** (null config): returns a single synthesized entry
 *   for `ledgerRoot` with `id: 'default'` and `label: 'Default Store'`.
 *
 * Git commands run concurrently (Promise.all) and degrade gracefully on
 * failure — no 500 errors from missing Git or unreachable remotes.
 *
 * @param ledgerRoot - Absolute ledger root path; used to resolve store paths and
 *   project/repository counts in single-store legacy mode (when `loadStoresConfig()`
 *   returns null).
 */
export async function handleGetStoresEnriched(ledgerRoot: string): Promise<StoreListItem[]> {
  const config = await loadStoresConfig();

  if (config !== null) {
    return buildEnrichedMultiStoreList(config);
  }

  // Legacy / single-store mode: synthesize a single default entry.
  const [[projects, registry], gitStatus] = await Promise.all([
    Promise.all([
      LedgerStore.listAllProjects(ledgerRoot),
      loadRegistry(ledgerRoot),
    ]),
    detectGitStatus(ledgerRoot),
  ]);

  return [
    {
      id: 'default',
      label: 'Default Store',
      path: ledgerRoot,
      project_count: projects.length,
      repository_count: registry.repositories.length,
      is_default: true,
      is_git: gitStatus.is_git,
      ...(gitStatus.ahead !== undefined ? { ahead: gitStatus.ahead } : {}),
      ...(gitStatus.behind !== undefined ? { behind: gitStatus.behind } : {}),
    },
  ];
}

// ---------------------------------------------------------------------------
// GET /api/stores/conflicts — handleGetStoreConflicts
// ---------------------------------------------------------------------------

/**
 * Returns the list of repositories registered in more than one store.
 *
 * Delegates to `MultiStoreManager.getRegistryConflicts()`. Returns an empty
 * array in single-store / legacy mode (no cross-store conflicts possible).
 */
export async function handleGetStoreConflicts(): Promise<RegistryConflict[]> {
  if (!isStoreContextInitialized()) {
    return [];
  }
  return getMultiStoreManager().getRegistryConflicts();
}

// ---------------------------------------------------------------------------
// POST /api/stores — handleAddStore
// ---------------------------------------------------------------------------

/**
 * Adds a new store to `stores.json`.
 *
 * Creates the store directory and seeds an empty `.repositories.json` when
 * neither already exists. Creates `stores.json` if none exists (first-store
 * scenario — the new store becomes the default).
 *
 * Validation: slug ID, reserved-ID rejection, absolute path, duplicate
 * id/path detection, optional label trimming.
 *
 * @returns Updated enriched store list.
 */
export async function handleAddStore(body: unknown): Promise<StoreListItem[]> {
  const parsed = AddStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { id, path: rawPath, label } = parsed.data;
  const trimmedLabel = label !== undefined ? normalizeLabel(label) : undefined;

  assertNotReservedId(id);
  assertAbsolutePath(rawPath);

  let expandedPath: string;
  try {
    expandedPath = expandStorePath(rawPath);
  } catch (err) {
    validationError((err as Error).message);
  }

  const config = await loadStoresConfig();
  assertNoDuplicateId(config, id);
  assertNoDuplicatePath(config, expandedPath!);

  await createStoreDirectory(expandedPath!);

  const newEntry = {
    id,
    path: rawPath,
    ...(trimmedLabel !== undefined ? { label: trimmedLabel } : {}),
  };

  const newConfig: StoresConfig =
    config !== null
      ? { ...config, stores: [...config.stores, newEntry] }
      : { stores: [newEntry], default_store: id };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// POST /api/stores/import — handleImportStore
// ---------------------------------------------------------------------------

/**
 * Imports an existing directory as a store in `stores.json`.
 *
 * Unlike `handleAddStore`, the target directory **must already exist** and the
 * handler never creates it. Any existing `.repositories.json` is preserved
 * as-is; a `warning` is included in the response when it is present but fails
 * schema validation. Creates `stores.json` if none exists (first-store).
 *
 * @returns Wrapped response `{ stores, warning? }` where `stores` is the
 *   updated enriched store list.
 */
export async function handleImportStore(
  body: unknown
): Promise<{ stores: StoreListItem[]; warning?: string }> {
  const parsed = ImportStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { id, path: rawPath, label } = parsed.data;
  const trimmedLabel = label !== undefined ? normalizeLabel(label) : undefined;

  assertNotReservedId(id);
  assertAbsolutePath(rawPath);

  let expandedPath: string;
  try {
    expandedPath = expandStorePath(rawPath);
  } catch (err) {
    validationError((err as Error).message);
  }

  // Directory must already exist
  try {
    const s = await stat(expandedPath!);
    if (!s.isDirectory()) {
      validationError(`Path "${expandedPath!}" exists but is not a directory.`);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    validationError(`Directory does not exist at path "${expandedPath!}".`);
  }

  const config = await loadStoresConfig();
  assertNoDuplicateId(config, id);
  assertNoDuplicatePath(config, expandedPath!);

  // Check for a corrupted .repositories.json (preserve it regardless)
  let warning: string | undefined;
  const registryFilePath = join(expandedPath!, '.repositories.json');
  try {
    const content = await readFile(registryFilePath, 'utf-8');
    try {
      RepositoryRegistrySchema.parse(JSON.parse(content));
    } catch {
      warning =
        'Existing .repositories.json is present but could not be validated — it may need manual repair.';
    }
  } catch {
    // File absent — no warning
  }

  const newEntry = {
    id,
    path: rawPath,
    ...(trimmedLabel !== undefined ? { label: trimmedLabel } : {}),
  };

  const newConfig: StoresConfig =
    config !== null
      ? { ...config, stores: [...config.stores, newEntry] }
      : { stores: [newEntry], default_store: id };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  const stores = await buildEnrichedMultiStoreList(newConfig);
  return warning !== undefined ? { stores, warning } : { stores };
}

// ---------------------------------------------------------------------------
// PUT /api/stores/:storeId — handleUpdateStore
// ---------------------------------------------------------------------------

/**
 * Updates the label of an existing store.
 *
 * The label is trimmed; whitespace-only values are rejected with 400.
 *
 * @returns Updated enriched store list.
 */
export async function handleUpdateStore(
  storeId: string,
  body: unknown
): Promise<StoreListItem[]> {
  const parsed = UpdateStoreBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { label } = parsed.data;
  const trimmedLabel = normalizeLabel(label);

  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const storeIndex = config.stores.findIndex((s) => s.id === storeId);
  if (storeIndex === -1) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const updatedStores = config.stores.map((s, i) =>
    i === storeIndex ? { ...s, label: trimmedLabel } : s
  );
  const newConfig: StoresConfig = { ...config, stores: updatedStores };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId — handleRemoveStore
// ---------------------------------------------------------------------------

/**
 * Removes a store from `stores.json`.
 *
 * - Rejects removal of the last store (schema requires ≥ 1 store).
 * - If the removed store was the default, the first remaining store becomes
 *   the new default (matching CLI `storeRemove` behavior).
 * - The store directory is **not** deleted from disk.
 *
 * @returns `{ stores, warned }` where `warned` is `true` when the removed
 *   store had registered repositories.
 */
export async function handleRemoveStore(
  storeId: string
): Promise<{ stores: StoreListItem[]; warned: boolean }> {
  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const storeIndex = config.stores.findIndex((s) => s.id === storeId);
  if (storeIndex === -1) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  if (config.stores.length === 1) {
    validationError('Cannot remove the last store. At least one store must remain configured.');
  }

  // Check for registered repositories (for the warned flag)
  const storeEntry = config.stores[storeIndex]!;
  let warned = false;
  try {
    const expandedPath = expandStorePath(storeEntry.path);
    const registry = await loadRegistry(expandedPath);
    warned = registry.repositories.length > 0;
  } catch {
    // Path unresolvable — proceed without warning
  }

  const remainingStores = config.stores.filter((_, i) => i !== storeIndex);

  // Reassign default to the first remaining store if the removed store was default
  const newDefault =
    config.default_store === storeId ? remainingStores[0]!.id : config.default_store;

  const newConfig: StoresConfig = {
    ...config,
    stores: remainingStores,
    default_store: newDefault,
  };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  const stores = await buildEnrichedMultiStoreList(newConfig);
  return { stores, warned };
}

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/default — handleSetDefaultStore
// ---------------------------------------------------------------------------

/**
 * Sets the default store in `stores.json`.
 *
 * @returns Updated enriched store list.
 */
export async function handleSetDefaultStore(storeId: string): Promise<StoreListItem[]> {
  const config = await loadStoresConfig();
  if (config === null) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  if (!config.stores.some((s) => s.id === storeId)) {
    throw new ApiError('NOT_FOUND', `Store "${storeId}" not found.`);
  }

  const newConfig: StoresConfig = { ...config, default_store: storeId };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}

// ---------------------------------------------------------------------------
// PUT /api/stores/order — handleReorderStores
// ---------------------------------------------------------------------------

/**
 * Reorders the `stores` array in `stores.json`.
 *
 * The `order` array must be an exact permutation of the current store IDs:
 * - Same length (catches duplicates).
 * - Every ID in `order` must exist in config (no unknowns).
 * - Every ID in config must appear in `order` (no omissions).
 *
 * Store order determines conflict-resolution priority.
 *
 * @returns Updated enriched store list.
 */
export async function handleReorderStores(body: unknown): Promise<StoreListItem[]> {
  const parsed = ReorderStoresBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
  }

  const { order } = parsed.data;

  const config = await loadStoresConfig();
  if (config === null) {
    validationError('No stores are configured to reorder.');
  }

  const existingIds = config!.stores.map((s) => s.id);

  if (order.length !== existingIds.length) {
    validationError(
      `order array length (${order.length}) does not match the number of configured stores (${existingIds.length}).`
    );
  }

  const existingIdSet = new Set(existingIds);
  for (const id of order) {
    if (!existingIdSet.has(id)) {
      validationError(`Unknown store id "${id}" in order array.`);
    }
  }

  const orderSet = new Set(order);
  for (const id of existingIds) {
    if (!orderSet.has(id)) {
      validationError(`Store id "${id}" is missing from the order array.`);
    }
  }

  const storeMap = new Map(config!.stores.map((s) => [s.id, s]));
  const reorderedStores = order.map((id) => storeMap.get(id)!);

  const newConfig: StoresConfig = { ...config!, stores: reorderedStores };

  await saveStoresConfig(newConfig);
  await reloadStoreContext();

  return buildEnrichedMultiStoreList(newConfig);
}
