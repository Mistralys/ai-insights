import { mkdirSync } from 'fs';
import { expandStorePath } from './store-registry.js';
import { loadRegistry, findByFolderName } from './repository-registry.js';
import { resolveLedgerRoot } from '../utils/ledger-root.js';
import type { StoresConfig } from '../schema/store-config.js';

// ==================== Internal Types ====================

interface StoreRef {
  id: string;
  path: string; // expanded, absolute
  label?: string;
}

// ==================== StoreRouter ====================

/**
 * Resolves which store to use for read/write operations given a repository
 * name, by iterating stores in `stores.json` order and matching against
 * per-store `.repositories.json` registries.
 *
 * Provides a legacy-mode fallback when no `StoresConfig` is available
 * (i.e. `stores.json` does not exist or failed to load). In legacy mode
 * all resolution methods delegate to `resolveLedgerRoot()`.
 *
 * ## Store priority
 *
 * The array order in `stores.json` determines priority. When the same
 * repository appears in multiple stores' `.repositories.json` files, the
 * first matching store in config order wins. Users control priority by
 * reordering the `stores` array in `stores.json`.
 *
 * ## Directory auto-creation
 *
 * On construction, every configured store path that does not yet exist on
 * disk is created via `mkdirSync` with `{ recursive: true }`. Paths that
 * already exist are left untouched.
 */
export class StoreRouter {
  private readonly config: StoresConfig | null;
  private readonly stores: StoreRef[];

  constructor(config: StoresConfig | null) {
    this.config = config;

    if (config !== null) {
      this.stores = config.stores.map((entry) => ({
        id: entry.id,
        path: expandStorePath(entry.path),
        label: entry.label,
      }));

      // Auto-create each store directory that does not yet exist.
      // mkdirSync with recursive:true is a no-op for directories that
      // already exist, so this is always safe to call unconditionally.
      for (const store of this.stores) {
        mkdirSync(store.path, { recursive: true });
      }
    } else {
      this.stores = [];
    }
  }

  // ==================== Mode Guard ====================

  /**
   * Returns `true` when a multi-store config was provided at construction,
   * `false` in single-store / legacy mode.
   */
  isMultiStoreMode(): boolean {
    return this.config !== null;
  }

  // ==================== Resolution ====================

  /**
   * Returns the absolute path of the configured default store.
   *
   * - Legacy mode: delegates to `resolveLedgerRoot()`.
   * - Multi-store mode: returns the path of the store whose `id` matches
   *   `config.default_store`. The schema guarantees this `id` always exists.
   */
  resolveDefaultStore(): string {
    if (this.config === null) {
      return resolveLedgerRoot();
    }

    // StoresConfigSchema validates that default_store references an existing
    // id, so this find will always succeed when config is non-null.
    const defaultStore = this.stores.find((s) => s.id === this.config!.default_store);
    return defaultStore!.path;
  }

  /**
   * Returns the absolute paths of all configured stores, in config order.
   *
   * - Legacy mode: returns a single-entry array wrapping `resolveLedgerRoot()`.
   * - Multi-store mode: returns paths in `stores.json` array order (which
   *   defines resolution priority for `resolveStoreForWrite()`).
   */
  getAllStorePaths(): string[] {
    if (this.config === null) {
      return [resolveLedgerRoot()];
    }
    return this.stores.map((s) => s.path);
  }

  /**
   * Returns metadata for all configured stores in priority order.
   *
   * - Legacy mode: returns a single entry with `id: 'default'`, the resolved
   *   ledger root path, and `label: 'Default Store'`.
   * - Multi-store mode: returns one entry per configured store with its id,
   *   expanded path, and label (falling back to the id when no label is set).
   */
  getAllStores(): Array<{ id: string; path: string; label: string }> {
    if (this.config === null) {
      return [{ id: 'default', path: resolveLedgerRoot(), label: 'Default Store' }];
    }
    return this.stores.map((s) => ({
      id: s.id,
      path: s.path,
      label: s.label ?? s.id,
    }));
  }

  /**
   * Looks up which store claims the given repository name.
   *
   * Iterates stores in config order and loads each store's
   * `.repositories.json`. Returns `{ storePath, storeId }` for the first
   * store whose registry lists the repo in a `folder_names` array, or
   * `null` if no store claims it.
   *
   * - Legacy mode: always returns `null` (no per-store registry concept).
   * - Does **not** throw on an unregistered repo — use
   *   `resolveStoreForWrite()` when a missing registration should be an error.
   *
   * @param repoName - Repository name (workspace folder name) to look up.
   */
  async resolveStoreForRepo(
    repoName: string
  ): Promise<{ storePath: string; storeId: string } | null> {
    if (this.config === null) {
      return null;
    }

    for (const store of this.stores) {
      const registry = await loadRegistry(store.path);
      const entry = findByFolderName(registry, repoName);
      if (entry !== null) {
        return { storePath: store.path, storeId: store.id };
      }
    }

    return null;
  }

  /**
   * Resolves which store to use for write operations on the given repository.
   *
   * - Legacy mode: returns `resolveLedgerRoot()` directly, bypassing all
   *   registry lookups.
   * - Multi-store mode: iterates stores in config order (first match wins),
   *   loads each store's `.repositories.json`, and returns the absolute path
   *   of the first store that has the repo registered. Throws if no store
   *   claims the repo.
   *
   * @param repoName - Repository name (workspace folder name) to route.
   * @throws {Error} When the repo is not registered in any store (multi-store
   *   mode only). The error message contains `"not registered in any store"`.
   */
  async resolveStoreForWrite(repoName: string): Promise<string> {
    if (this.config === null) {
      return resolveLedgerRoot();
    }

    const result = await this.resolveStoreForRepo(repoName);
    if (result === null) {
      throw new Error(
        `Repository "${repoName}" is not registered in any store`
      );
    }

    return result.storePath;
  }
}
