import { StoreRouter } from './store-router.js';
import { MultiStoreManager } from './multi-store-manager.js';
import { loadStoresConfig } from './store-registry.js';
import type { StoresConfig } from '../schema/store-config.js';

/**
 * Module-level store context state.
 * Initialised at startup via setStoreContext(); can be hot-reloaded at any
 * time via reloadStoreContext() without a server restart.
 *
 * Analogous to the _mcpServer reference in src/utils/client-info.ts — both
 * src/index.ts (MCP STDIO server) and gui/server.ts (HTTP GUI server) call
 * setStoreContext() independently during their respective startup sequences.
 * Tool files import from this module, not from index.ts, to avoid circular
 * imports across the two-process architecture.
 */
let _storeRouter: StoreRouter | undefined;
let _multiStoreManager: MultiStoreManager | undefined;
/** Inflight guard: coalesces concurrent reloadStoreContext() calls into one. */
let _pendingReload: Promise<StoresConfig | null> | null = null;

/**
 * Stores the initialized StoreRouter and MultiStoreManager instances.
 *
 * Called once at process startup and again by reloadStoreContext() whenever
 * stores.json changes at runtime. Overwrites the stored references on each
 * call — callers must not invoke getStoreRouter() or getMultiStoreManager()
 * before the first call completes.
 */
export function setStoreContext(
  router: StoreRouter,
  manager: MultiStoreManager
): void {
  _storeRouter = router;
  _multiStoreManager = manager;
}

/**
 * Returns the initialized StoreRouter for the current process.
 *
 * In single-store / legacy mode the router delegates all resolution to
 * resolveLedgerRoot(). In multi-store mode it routes by per-store registry
 * lookup.
 *
 * @throws Error if called before setStoreContext().
 */
export function getStoreRouter(): StoreRouter {
  if (_storeRouter === undefined) {
    throw new Error(
      '[store-context] getStoreRouter() called before setStoreContext(). ' +
        'Ensure setStoreContext() is called during server startup in index.ts and gui/server.ts.'
    );
  }
  return _storeRouter;
}

/**
 * Returns the initialized MultiStoreManager for the current process.
 *
 * Provides collated read operations (listAllProjects, detectProjectByCwd,
 * getMergedRegistry, searchKnowledge, etc.) across all configured stores.
 *
 * @throws Error if called before setStoreContext().
 */
export function getMultiStoreManager(): MultiStoreManager {
  if (_multiStoreManager === undefined) {
    throw new Error(
      '[store-context] getMultiStoreManager() called before setStoreContext(). ' +
        'Ensure setStoreContext() is called during server startup in index.ts and gui/server.ts.'
    );
  }
  return _multiStoreManager;
}

/**
 * Returns true when setStoreContext() has been called and both the StoreRouter
 * and MultiStoreManager are ready for use.
 *
 * Tool handlers use this guard to decide whether to apply multi-store routing
 * or fall back to the legacy single-store path. During testing, suites that do
 * not call setStoreContext() will see false here, preserving existing test
 * behavior without requiring changes to every test file.
 */
export function isStoreContextInitialized(): boolean {
  return _storeRouter !== undefined;
}

/**
 * Re-reads `stores.json`, constructs a fresh StoreRouter (with
 * `skipDirCreate: true`) and MultiStoreManager, then calls setStoreContext().
 *
 * Returns the parsed StoresConfig on success, or null when `stores.json` is
 * absent, malformed, or schema-invalid (legacy single-store mode is restored).
 *
 * Concurrent calls are coalesced: if a reload is already in-flight, the same
 * Promise is returned to all callers so setStoreContext() runs exactly once per
 * batch. This function must NOT be declared `async` — doing so would wrap
 * _pendingReload in a new Promise per call, breaking reference equality.
 *
 * @param configPath - Optional override for the `stores.json` path (used in
 *   tests to inject a temporary config file instead of the default location).
 *   Internal test hook — must not be forwarded from HTTP handlers or public
 *   API surfaces.
 */
export function reloadStoreContext(
  configPath?: string
): Promise<StoresConfig | null> {
  if (_pendingReload !== null) return _pendingReload;
  _pendingReload = (async () => {
    try {
      const config = await loadStoresConfig(configPath);
      const router = new StoreRouter(config, { skipDirCreate: true });
      const manager = new MultiStoreManager(router);
      setStoreContext(router, manager);
      return config;
    } finally {
      _pendingReload = null;
    }
  })();
  return _pendingReload;
}
