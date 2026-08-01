/**
 * GUI API Route Handlers — Repository Registry Domain
 *
 * All REST handlers for the /api/repos and /api/repos/:repoId endpoints.
 * Follows the domain-split pattern established by `api-knowledge.ts` — each
 * API domain gets its own handler file imported from `server.ts`.
 *
 * Routes provided:
 *   GET    /api/repos              — list all declared repositories
 *                                    Query parameters:
 *                                      ?include_undeclared=true — also return filesystem-discovered
 *                                      namespace directories that are not covered by any declared
 *                                      repo's folder_names. Undeclared entries carry declared: false
 *                                      and a synthetic shape (see RepoListItem). Defaults to false,
 *                                      preserving the original endpoint behaviour.
 *   GET    /api/repos/:repoId      — get a single repository entry or 404
 *   POST   /api/repos              — create a new repository entry
 *   PUT    /api/repos/:repoId      — update label, folder_names, and/or vision
 *   DELETE /api/repos/:repoId      — remove the declaration (no project data deleted)
 *
 * Validation rules:
 *   - `id` (create): must match SLUG_REGEX; must be unique across existing entries.
 *   - `folder_names`: each name must be unique across ALL entries in the registry.
 *     Create and update operations that would violate this constraint are rejected
 *     with VALIDATION_ERROR (HTTP 400) and a clear error message.
 *   - `label`: non-empty string (min 1 character).
 *   - `vision`: three-horizon object (short_term, mid_term, long_term) — each field
 *     is a nullable string; null means "not yet authored"; empty strings are rejected.
 *
 * Error shape: { code: string, message: string, details?: unknown }
 *   NOT_FOUND        → 404
 *   VALIDATION_ERROR → 400
 *   (unhandled)      → 500
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { ApiError } from '../src/gui/errors.js';
import {
  loadRegistry,
  saveRegistry,
} from '../src/storage/repository-registry.js';
import {
  RepositoryEntrySchema,
  StrategicVisionSchema,
  type RepositoryEntry,
} from '../src/schema/repository-registry.js';
import { SLUG_REGEX } from '../src/schema/common.js';
import { LedgerStore } from '../src/storage/ledger-store.js';
import {
  isStoreContextInitialized,
  getStoreRouter,
  getMultiStoreManager,
} from '../src/storage/store-context.js';

// Re-export ApiError so consumers can catch typed errors without importing
// from a separate path.
export { ApiError };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validationError(message: string, details?: unknown): never {
  throw new ApiError('VALIDATION_ERROR', message, details);
}

/**
 * Returns the current ISO 8601 timestamp string.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Validates that none of the given `folder_names` appear in any existing
 * registry entry. Optionally skips a specific entry by `excludeId` so that
 * an update operation can keep its own existing folder names without conflict.
 *
 * @throws ApiError VALIDATION_ERROR listing the conflicting folder name(s).
 */
function assertNoFolderNameConflicts(
  allEntries: RepositoryEntry[],
  folderNames: string[],
  excludeId?: string
): void {
  const conflicts: string[] = [];
  for (const name of folderNames) {
    const conflict = allEntries.find(
      (e) => e.id !== excludeId && e.folder_names.includes(name)
    );
    if (conflict) {
      conflicts.push(name);
    }
  }
  if (conflicts.length > 0) {
    validationError(
      `folder_names conflict: the following names are already used by another repository entry: ${conflicts.map((n) => `'${n}'`).join(', ')}.`
    );
  }
}

/**
 * Searches all configured stores for a repository entry with the given ID.
 *
 * - Multi-store mode: iterates stores in **config order** and returns the path of
 *   the **first** store whose registry contains the repo, along with the entry.
 * - Single-store / legacy mode: loads the single registry at `ledgerRoot`.
 *
 * Returns `null` when no matching entry is found in any store.
 *
 * **First-match semantics:** Iteration stops at the first store that contains the
 * given `repoId`. If the same ID is present in multiple stores (cross-store
 * uniqueness is not enforced on creation — see `handleCreateRepo`), all read,
 * update, and delete operations will silently target only the first-matched store
 * in config order. The second occurrence remains unaffected and unreachable via
 * these routes. Use `GET /api/stores/conflicts` to detect and resolve duplicate
 * IDs across stores.
 */
async function findEntryInStores(
  ledgerRoot: string,
  repoId: string
): Promise<{ storePath: string; entry: RepositoryEntry } | null> {
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const stores = getStoreRouter().getAllStores();
    for (const store of stores) {
      const registry = await loadRegistry(store.path);
      const entry = registry.repositories.find((e) => e.id === repoId);
      if (entry) return { storePath: store.path, entry };
    }
    return null;
  }

  const registry = await loadRegistry(ledgerRoot);
  const entry = registry.repositories.find((e) => e.id === repoId);
  return entry ? { storePath: ledgerRoot, entry } : null;
}

// ---------------------------------------------------------------------------
// Zod schemas for request bodies
// ---------------------------------------------------------------------------

/**
 * Body schema for POST /api/repos.
 *
 * Exported so that test code can construct and inspect validated shapes directly.
 * Not intended as a stable public API — treat as `@internal`.
 *
 * All fields required except `vision`, which defaults to all-null horizons
 * when omitted. `.strict()` rejects unknown keys.
 */
export const RepoCreateBodySchema = z
  .object({
    id: z.string().regex(SLUG_REGEX, {
      message:
        'id must start with an alphanumeric character and contain only letters, digits, hyphens, and underscores.',
    }),
    label: z.string().min(1, { message: 'label must be a non-empty string.' }),
    folder_names: z
      .array(z.string().min(1))
      .min(1, { message: 'folder_names must contain at least one entry.' }),
    vision: StrategicVisionSchema.optional(),
    /** Target store ID — optional; when omitted the default store (or legacy ledgerRoot) is used. */
    store_id: z.string().optional(),
  })
  .strict();

/**
 * Body schema for PUT /api/repos/:repoId.
 *
 * Exported so that test code can construct and inspect validated shapes directly.
 * Not intended as a stable public API — treat as `@internal`.
 *
 * All fields are optional — omitted fields are left unchanged. `.strict()`
 * rejects unknown keys.
 */
export const RepoUpdateBodySchema = z
  .object({
    label: z.string().min(1, { message: 'label must be a non-empty string.' }).optional(),
    folder_names: z
      .array(z.string().min(1))
      .min(1, { message: 'folder_names must contain at least one entry.' })
      .optional(),
    vision: StrategicVisionSchema.optional(),
    /** Accepted but ignored — the owning store is located automatically via the registry. */
    store_id: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /api/repos
// ---------------------------------------------------------------------------

/**
 * Response shape for list / get endpoints.
 * Exposes `has_vision` and `has_full_vision` as convenience booleans instead
 * of requiring the frontend to inspect all three horizon fields.
 *
 * @remarks
 * **Declared entries** (`declared: true`) are sourced from the repository
 * registry file and carry fully authoritative field values.
 *
 * **Undeclared (synthetic) entries** (`declared: false`) are discovered from
 * the filesystem when `GET /api/repos?include_undeclared=true` is requested.
 * Their fields follow these conventions:
 *   - `id`, `label`, and `folder_names[0]` all equal the namespace directory name.
 *   - `folder_names` always has exactly one element.
 *   - `has_vision` and `has_full_vision` are always `false` (no registry entry exists).
 *   - `created_at` and `last_modified` are set to the query timestamp
 *     (`new Date().toISOString()`) — they are **not** stable across calls and
 *     should not be used for sorting or comparison.
 *
 * Consumers that need to distinguish the two kinds of entries should branch on
 * `declared` rather than relying on any other field heuristic.
 */
export interface RepoListItem {
  id: string;
  label: string;
  folder_names: string[];
  /** true when at least one horizon field is non-null */
  has_vision: boolean;
  /** true when all three horizon fields are non-null */
  has_full_vision: boolean;
  created_at: string;
  last_modified: string;
  /**
   * `true` for entries sourced from the repository registry.
   * `false` for synthetic entries discovered from the filesystem
   * (returned only when `?include_undeclared=true` is specified).
   */
  declared: boolean;
  /**
   * ID of the store this repository belongs to.
   * Present only in multi-store mode — absent in single-store / legacy mode.
   */
  store_id?: string;
}

function toListItem(entry: RepositoryEntry, storeId?: string): RepoListItem {
  const { vision } = entry;
  const has_vision =
    vision.short_term !== null ||
    vision.mid_term !== null ||
    vision.long_term !== null;
  const has_full_vision =
    vision.short_term !== null &&
    vision.mid_term !== null &&
    vision.long_term !== null;
  return {
    id: entry.id,
    label: entry.label,
    folder_names: entry.folder_names,
    has_vision,
    has_full_vision,
    created_at: entry.created_at,
    last_modified: entry.last_modified,
    declared: true,
    ...(storeId !== undefined ? { store_id: storeId } : {}),
  };
}

/**
 * Lists all declared repositories from the registry file, and optionally
 * includes undeclared namespace directories discovered on the filesystem.
 *
 * When `includeUndeclared` is `false` (the default), behavior is identical to
 * the original implementation — only declared repos are returned.
 *
 * When `includeUndeclared` is `true`, the function performs a `readdir` at the
 * ledger root, collects namespace directories that are not already covered by
 * any declared repo's `folder_names`, validates each undeclared namespace
 * contains at least one project (via `LedgerStore.listProjectsByFolderNames`),
 * and returns them as synthetic `RepoListItem` entries with `declared: false`.
 *
 * Dot-prefixed directories are always excluded (archive/control directories).
 *
 * @param ledgerRoot        - Absolute path to the centralized ledger root directory.
 * @param includeUndeclared - When true, also returns filesystem-discovered namespaces.
 *                            Defaults to false to preserve existing behavior.
 */
export async function handleListRepos(
  ledgerRoot: string,
  includeUndeclared = false
): Promise<RepoListItem[]> {
  // Multi-store mode: return a merged view from all stores, each entry tagged with store_id.
  // `includeUndeclared` is not supported in multi-store mode (would require scanning every
  // store's filesystem — left as a future enhancement; returns declared entries only).
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const tagged = await getMultiStoreManager().getMergedRegistry();
    return tagged.map((entry) => toListItem(entry, entry.store_id));
  }

  // Single-store / legacy mode: existing behavior
  const registry = await loadRegistry(ledgerRoot);
  const declared = registry.repositories.map((e) => toListItem(e));

  if (!includeUndeclared) {
    return declared;
  }

  // Collect all folder_names already claimed by declared entries
  const declaredFolderNames = new Set<string>(
    registry.repositories.flatMap((e) => e.folder_names)
  );

  // Enumerate namespace directories at the ledger root
  let dirents: import('fs').Dirent[];
  try {
    dirents = await readdir(ledgerRoot, { withFileTypes: true });
  } catch {
    // Ledger root unreadable — return just the declared repos
    return declared;
  }

  // Find directories not covered by any declared repo's folder_names
  const undeclaredNamespaces = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !declaredFolderNames.has(d.name))
    .map((d) => d.name);

  if (undeclaredNamespaces.length === 0) {
    return declared;
  }

  // Validate undeclared namespaces contain at least one project to avoid surfacing
  // empty or control directories
  const undeclaredItems: RepoListItem[] = [];
  for (const namespace of undeclaredNamespaces) {
    const projects = await LedgerStore.listProjectsByFolderNames([namespace], ledgerRoot);
    if (projects.length === 0) {
      continue; // Skip empty/non-project directories
    }
    const now = new Date().toISOString();
    undeclaredItems.push({
      id: namespace,
      label: namespace,
      folder_names: [namespace],
      has_vision: false,
      has_full_vision: false,
      created_at: now,
      last_modified: now,
      declared: false,
    });
  }

  return [...declared, ...undeclaredItems];
}

// ---------------------------------------------------------------------------
// GET /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Returns the full repository entry for the given `repoId`, or throws
 * NOT_FOUND (404) if no entry with that id exists in the registry.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to retrieve.
 */
export async function handleGetRepo(
  ledgerRoot: string,
  repoId: string
): Promise<RepositoryEntry> {
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  return found.entry;
}

// ---------------------------------------------------------------------------
// POST /api/repos
// ---------------------------------------------------------------------------

/**
 * Creates a new repository entry in the registry.
 *
 * Validations (in order):
 *   1. Request body must conform to {@link RepoCreateBodySchema}.
 *   2. `id` must match SLUG_REGEX (enforced by the schema).
 *   3. `id` must be unique (no existing entry with the same id).
 *   4. No `folder_names` value may already appear in any existing entry.
 *
 * On success, returns the newly created {@link RepositoryEntry}.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param body       - Parsed request body (any shape — validated here).
 */
export async function handleCreateRepo(
  ledgerRoot: string,
  body: unknown
): Promise<RepositoryEntry> {
  const parsed = RepoCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      'Invalid request body.',
      parsed.error.flatten().fieldErrors
    );
  }

  const { id, label, folder_names, vision, store_id } = parsed.data;

  // Resolve the target store path.
  // In multi-store mode: use the requested store_id (validating it), or fall back to the
  //   configured default store when store_id is omitted.
  // In single-store / legacy mode: always write to ledgerRoot.
  let targetStorePath: string;
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    if (store_id !== undefined) {
      const stores = getStoreRouter().getAllStores();
      const target = stores.find((s) => s.id === store_id);
      if (!target) {
        const validIds = stores.map((s) => s.id).join(', ');
        validationError(
          `Invalid store_id '${store_id}'. Valid store IDs are: ${validIds}.`
        );
      }
      targetStorePath = target.path;
    } else {
      // No store_id specified — use the default store
      targetStorePath = getStoreRouter().resolveDefaultStore();
    }
  } else {
    targetStorePath = ledgerRoot;
  }

  const registry = await loadRegistry(targetStorePath);

  // Unique id check
  if (registry.repositories.some((e) => e.id === id)) {
    validationError(`A repository entry with id '${id}' already exists.`);
  }

  // Folder name uniqueness check
  assertNoFolderNameConflicts(registry.repositories, folder_names);

  const now = nowIso();
  const newEntry: RepositoryEntry = RepositoryEntrySchema.parse({
    id,
    label,
    folder_names,
    vision: vision ?? { short_term: null, mid_term: null, long_term: null },
    created_at: now,
    last_modified: now,
  });

  await saveRegistry(targetStorePath, {
    repositories: [...registry.repositories, newEntry],
  });
  return newEntry;
}

// ---------------------------------------------------------------------------
// PUT /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Updates an existing repository entry.
 *
 * Updatable fields: `label`, `folder_names`, `vision`. All are optional — only
 * supplied fields are overwritten. `created_at` is never mutated; `last_modified`
 * is always set to the current timestamp on a successful update.
 *
 * Validations:
 *   1. `repoId` must match an existing entry (NOT_FOUND otherwise).
 *   2. Request body must conform to {@link RepoUpdateBodySchema}.
 *   3. If `folder_names` is supplied, each value must be unique across all OTHER
 *      entries in the registry (the current entry's own names are excluded from
 *      the conflict check so that a no-change update always succeeds).
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to update.
 * @param body       - Parsed request body (any shape — validated here).
 */
export async function handleUpdateRepo(
  ledgerRoot: string,
  repoId: string,
  body: unknown
): Promise<RepositoryEntry> {
  // Locate the owning store — in multi-store mode this iterates stores in config order
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  const { storePath } = found;
  const registry = await loadRegistry(storePath);
  const existingIndex = registry.repositories.findIndex((e) => e.id === repoId);
  // existingIndex must be valid since findEntryInStores already found the entry
  const parsed = RepoUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    validationError(
      'Invalid request body.',
      parsed.error.flatten().fieldErrors
    );
  }

  const { label, folder_names, vision } = parsed.data;

  // Folder name uniqueness check — exclude the entry being updated
  if (folder_names !== undefined) {
    assertNoFolderNameConflicts(registry.repositories, folder_names, repoId);
  }

  const existing = registry.repositories[existingIndex]!;
  const updated: RepositoryEntry = RepositoryEntrySchema.parse({
    id: existing.id,
    label: label ?? existing.label,
    folder_names: folder_names ?? existing.folder_names,
    vision: vision ?? existing.vision,
    created_at: existing.created_at,
    last_modified: nowIso(),
  });

  const updatedRepositories = [...registry.repositories];
  updatedRepositories[existingIndex] = updated;

  await saveRegistry(storePath, { repositories: updatedRepositories });
  return updated;
}

// ---------------------------------------------------------------------------
// DELETE /api/repos/:repoId
// ---------------------------------------------------------------------------

/**
 * Removes a repository entry from the registry.
 *
 * This operation does NOT delete any project data, files, or directories —
 * it only removes the declaration from `.repositories.json`.
 *
 * Throws NOT_FOUND (404) if no entry with the given `repoId` exists.
 *
 * @param ledgerRoot - Absolute path to the centralized ledger root directory.
 * @param repoId     - The `id` field of the repository entry to remove.
 */
export async function handleDeleteRepo(
  ledgerRoot: string,
  repoId: string
): Promise<{ deleted: true }> {
  const found = await findEntryInStores(ledgerRoot, repoId);
  if (!found) {
    throw new ApiError('NOT_FOUND', `Repository not found: '${repoId}'.`);
  }
  const { storePath } = found;
  const registry = await loadRegistry(storePath);
  const updatedRepositories = registry.repositories.filter((e) => e.id !== repoId);
  await saveRegistry(storePath, { repositories: updatedRepositories });
  return { deleted: true };
}
