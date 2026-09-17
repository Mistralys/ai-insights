/**
 * Cross-store repository lookup helpers.
 *
 * Relocated from `mcp-server/gui/api-repos.ts` (where `findEntryInStores()`
 * was module-private) so the GUI layer, the identity resolver, and the
 * `ai-insights ledger` CLI can share one implementation with one documented
 * first-match semantic, rather than each re-deriving store iteration order.
 */

import {
  loadRegistry,
} from './repository-registry.js';
import { type RepositoryEntry } from '../schema/repository-registry.js';
import {
  isStoreContextInitialized,
  getStoreRouter,
} from './store-context.js';

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
 * uniqueness is not enforced on creation), all read, update, and delete
 * operations will silently target only the first-matched store in config order.
 * The second occurrence remains unaffected and unreachable via these routes.
 * Use `GET /api/stores/conflicts` to detect and resolve duplicate IDs across stores.
 */
export async function findEntryInStores(
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

/**
 * Returns every registry entry across all configured stores, each tagged with
 * the `storePath` that owns it.
 *
 * Mirrors `findEntryInStores()`'s exact two-branch single/multi-store
 * structure so the two functions can never drift on store semantics:
 *
 * - Multi-store mode: iterates stores in **config order**, collecting every
 *   store's entries. When the same `id` appears in more than one store, only
 *   the entry from the first store in config order is kept (first-match
 *   dedup) — consistent with `findEntryInStores()`'s by-id resolution.
 * - Single-store / legacy mode: returns every entry from the single registry
 *   at `ledgerRoot`.
 */
export async function listEntriesInStores(
  ledgerRoot: string
): Promise<Array<{ storePath: string; entry: RepositoryEntry }>> {
  if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
    const stores = getStoreRouter().getAllStores();
    const seenIds = new Set<string>();
    const result: Array<{ storePath: string; entry: RepositoryEntry }> = [];
    for (const store of stores) {
      const registry = await loadRegistry(store.path);
      for (const entry of registry.repositories) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        result.push({ storePath: store.path, entry });
      }
    }
    return result;
  }

  const registry = await loadRegistry(ledgerRoot);
  return registry.repositories.map((entry) => ({ storePath: ledgerRoot, entry }));
}
