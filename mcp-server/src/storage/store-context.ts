import type { StoreRouter } from './store-router.js';
import type { MultiStoreManager } from './multi-store-manager.js';

/**
 * Module-level store context state.
 * Set once per process startup via setStoreContext().
 *
 * Analogous to the _mcpServer reference in src/utils/client-info.ts — both
 * src/index.ts (MCP STDIO server) and gui/server.ts (HTTP GUI server) call
 * setStoreContext() independently during their respective startup sequences.
 * Tool files import from this module, not from index.ts, to avoid circular
 * imports across the two-process architecture.
 */
let _storeRouter: StoreRouter | undefined;
let _multiStoreManager: MultiStoreManager | undefined;

/**
 * Stores the initialized StoreRouter and MultiStoreManager instances.
 *
 * Must be called exactly once per process startup, before any tool file
 * calls getStoreRouter() or getMultiStoreManager(). Subsequent calls
 * overwrite the stored references (idempotent re-initialization for tests).
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
