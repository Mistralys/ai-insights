import { LedgerStore } from './ledger-store.js';
import { loadRegistry } from './repository-registry.js';
import { KnowledgeStoreManager } from './knowledge-store.js';
import { StoreRouter } from './store-router.js';
import type { ProjectMeta } from '../schema/project-meta.js';
import type { RepositoryEntry } from '../schema/repository-registry.js';
import type { Insight, InsightScope } from '../schema/knowledge.js';
import type { DetectProjectResult } from './ledger-store.js';

// ==================== Tagged Types ====================

/**
 * A ProjectMeta record annotated with the store it belongs to.
 *
 * The `store_path` field is required by the GUI `handleListProjects` slow path
 * to construct a `LedgerStore` with the correct per-store `ledgerRoot`.
 */
export interface TaggedProjectMeta extends ProjectMeta {
  store_id: string;
  store_label: string;
  store_path: string;
}

/**
 * A RepositoryEntry annotated with the store it belongs to.
 */
export interface TaggedRepositoryEntry extends RepositoryEntry {
  store_id: string;
}

/**
 * A conflict record for a repository registered in multiple stores.
 *
 * `winner_store_id` is the id of the first store (by config order) that claims
 * the repo, consistent with the priority rule used by `getMergedRegistry()`.
 */
export interface RegistryConflict {
  repo_name: string;
  entries: Array<{ store_id: string; entry: RepositoryEntry }>;
  winner_store_id: string;
}

// ==================== MultiStoreDetectResult ====================

/**
 * Extends `DetectProjectResult` with a `MULTI_STORE_AMBIGUOUS` status returned
 * when the same cwd path matches projects in more than one store.
 *
 * This is a pure extension of the existing union — it does not modify the
 * `DetectProjectResult` type declared in `ledger-store.ts`.
 */
export type MultiStoreDetectResult =
  | DetectProjectResult
  | { status: 'MULTI_STORE_AMBIGUOUS'; candidates: TaggedProjectMeta[] };

// ==================== MultiStoreManager ====================

/**
 * Provides collated read operations across all stores registered in a
 * `StoreRouter` — project listing, project detection, merged repository
 * registry, registry conflict detection, and cross-store knowledge search.
 *
 * All methods are read-only: no writes are performed. Write routing remains the
 * responsibility of `StoreRouter.resolveStoreForWrite()`.
 *
 * ## Store priority
 *
 * Store priority follows the array order in `StoreRouter.getAllStores()`, which
 * mirrors the `stores.json` config order. The first store to claim a resource
 * (repo name, insight id) wins in all merge operations.
 *
 * ## Legacy-mode transparency
 *
 * When `StoreRouter` is in legacy mode (null config), `getAllStores()` returns a
 * single default store entry. All `MultiStoreManager` methods continue to work
 * correctly — they simply operate over one store instead of many, tagging each
 * result with `store_id: 'default'`.
 */
export class MultiStoreManager {
  private readonly router: StoreRouter;

  constructor(router: StoreRouter) {
    this.router = router;
  }

  // ==================== Project Listing ====================

  /**
   * Collects all projects across all stores in config order, tagging each with
   * the store it belongs to (`store_id`, `store_label`, `store_path`).
   *
   * An optional `status` string filters results in-memory after loading so that
   * callers can request only READY, IN_PROGRESS, etc. projects.
   *
   * @param status - Optional status string to filter returned projects
   */
  async listAllProjects(status?: string): Promise<TaggedProjectMeta[]> {
    const stores = this.router.getAllStores();
    const results: TaggedProjectMeta[] = [];

    for (const store of stores) {
      const projects = await LedgerStore.listAllProjects(store.path);
      for (const meta of projects) {
        if (status !== undefined && meta.status !== status) continue;
        results.push({
          ...meta,
          store_id: store.id,
          store_label: store.label,
          store_path: store.path,
        });
      }
    }

    return results;
  }

  // ==================== Project Detection ====================

  /**
   * Detects which project's root is an ancestor of `cwdPath` across all stores.
   *
   * Resolution logic (evaluated in store-array order):
   *
   * - **Single FOUND across all stores:** Returns `{ status: 'FOUND', meta }` for
   *   that project. The `meta` does not carry store tags — the caller gets the
   *   standard `DetectProjectResult` shape. Note: the runtime object is a
   *   `TaggedProjectMeta` (it carries `store_id`, `store_label`, and `store_path`),
   *   but callers should rely only on the declared `ProjectMeta` shape via the
   *   return type.
   * - **Multiple FOUNDs from different stores:** Returns
   *   `{ status: 'MULTI_STORE_AMBIGUOUS', candidates }` where `candidates` is the
   *   array of `TaggedProjectMeta` entries, one per matching store, in store order.
   * - **Intra-store AMBIGUOUS (no FOUND in any store):** The first `AMBIGUOUS`
   *   result encountered is forwarded as-is. Cross-store AMBIGUOUS scenarios are
   *   treated as `MULTI_STORE_AMBIGUOUS`.
   * - **No matches:** Returns `{ status: 'NOT_FOUND' }`.
   *
   * @param cwdPath - Absolute path the agent is working from
   */
  async detectProjectByCwd(cwdPath: string): Promise<MultiStoreDetectResult> {
    const stores = this.router.getAllStores();
    const foundProjects: TaggedProjectMeta[] = [];
    let intraStoreAmbiguous: DetectProjectResult | null = null;

    for (const store of stores) {
      const result = await LedgerStore.detectProjectByCwd(cwdPath, store.path);

      if (result.status === 'FOUND') {
        foundProjects.push({
          ...result.meta,
          store_id: store.id,
          store_label: store.label,
          store_path: store.path,
        });
      } else if (result.status === 'AMBIGUOUS' && intraStoreAmbiguous === null) {
        // Preserve the first intra-store AMBIGUOUS — forward as-is when no FOUND exists.
        intraStoreAmbiguous = result;
      }
      // NOT_FOUND: continue to next store
    }

    if (foundProjects.length === 1) {
      return { status: 'FOUND', meta: foundProjects[0]! };
    }

    if (foundProjects.length > 1) {
      return { status: 'MULTI_STORE_AMBIGUOUS', candidates: foundProjects };
    }

    if (intraStoreAmbiguous !== null) {
      return intraStoreAmbiguous;
    }

    return { status: 'NOT_FOUND' };
  }

  // ==================== Registry ====================

  /**
   * Returns a merged view of all per-store repository registries, each entry
   * tagged with its `store_id`.
   *
   * Priority follows store array order: the first store to claim a repository
   * id wins; subsequent stores' entries for the same id are suppressed. This
   * rule is consistent with `StoreRouter.resolveStoreForWrite()`.
   */
  async getMergedRegistry(): Promise<TaggedRepositoryEntry[]> {
    const stores = this.router.getAllStores();
    const seen = new Set<string>();
    const merged: TaggedRepositoryEntry[] = [];

    for (const store of stores) {
      const registry = await loadRegistry(store.path);
      for (const entry of registry.repositories) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        merged.push({ ...entry, store_id: store.id });
      }
    }

    return merged;
  }

  /**
   * Identifies repositories whose id appears in more than one store's registry.
   *
   * Each conflict record includes:
   * - `repo_name` — the shared repository id.
   * - `entries` — per-store entries in config order.
   * - `winner_store_id` — the id of the first store (config order) that claims
   *   the repo, consistent with `getMergedRegistry()` priority.
   *
   * Returns an empty array when no cross-store duplicates exist.
   */
  async getRegistryConflicts(): Promise<RegistryConflict[]> {
    const stores = this.router.getAllStores();
    const byRepoId = new Map<string, Array<{ store_id: string; entry: RepositoryEntry }>>();

    for (const store of stores) {
      const registry = await loadRegistry(store.path);
      for (const entry of registry.repositories) {
        const existing = byRepoId.get(entry.id) ?? [];
        existing.push({ store_id: store.id, entry });
        byRepoId.set(entry.id, existing);
      }
    }

    const conflicts: RegistryConflict[] = [];
    for (const [repoId, entries] of byRepoId) {
      if (entries.length < 2) continue;
      conflicts.push({
        repo_name: repoId,
        entries,
        winner_store_id: entries[0]!.store_id,
      });
    }

    return conflicts;
  }

  // ==================== Knowledge ====================

  /**
   * Searches insights across all stores and deduplicates by insight numeric `id`
   * (first-seen in store-order wins).
   *
   * Each store is searched independently using the same `query` and `options`.
   * The results are merged in store-array order: the first time a numeric `id`
   * is seen it is included; subsequent occurrences from later stores are dropped.
   *
   * @param query   - Space-separated search terms (OR logic, case-insensitive)
   * @param options - Optional scope, category, tag, pagination filters
   */
  async searchKnowledge(
    query: string,
    options?: {
      scope?: InsightScope;
      repository_name?: string;
      category?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<Insight[]> {
    const { limit, offset, ...storeOptions } = options ?? {};
    const stores = this.router.getAllStores();
    const seen = new Set<number>();
    const merged: Insight[] = [];

    for (const store of stores) {
      const manager = new KnowledgeStoreManager(store.path);
      const results = await manager.searchInsights(query, storeOptions);
      for (const insight of results) {
        if (seen.has(insight.id)) continue;
        seen.add(insight.id);
        merged.push(insight);
      }
    }

    const start = offset ?? 0;
    const slice = limit !== undefined ? merged.slice(start, start + limit) : merged.slice(start);
    return slice;
  }

  /**
   * Lists insights across all stores and deduplicates by insight numeric `id`
   * (first-seen in store-order wins).
   *
   * Each store is listed independently with the same `options`. Results are
   * merged in store-array order using the same dedup rule as `searchKnowledge()`.
   *
   * @param options - Optional scope, category, tag, pagination filters
   */
  async listKnowledge(
    options: {
      scope?: InsightScope;
      category?: string;
      tags?: string[];
      repository_name?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Insight[]> {
    const { limit, offset, ...storeOptions } = options;
    const stores = this.router.getAllStores();
    const seen = new Set<number>();
    const merged: Insight[] = [];

    for (const store of stores) {
      const manager = new KnowledgeStoreManager(store.path);
      const results = await manager.listInsights(storeOptions);
      for (const insight of results) {
        if (seen.has(insight.id)) continue;
        seen.add(insight.id);
        merged.push(insight);
      }
    }

    const start = offset ?? 0;
    const slice = limit !== undefined ? merged.slice(start, start + limit) : merged.slice(start);
    return slice;
  }
}
