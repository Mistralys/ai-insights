/**
 * scripts/lib/ledger-dirs.js
 *
 * Canonical project-directory discovery for root-level `scripts/` utilities.
 *
 * Ledger project storage supports two on-disk layouts:
 *   - Legacy flat layout:      {storeRoot}/{slug}/
 *   - Namespaced layout:       {storeRoot}/{repoName}/{slug}/
 *
 * The rules for distinguishing them (dot-prefix exclusion, depth-1 vs depth-2
 * `.meta.json` probing) are owned by `LedgerStore.listAllProjectDirs()` in the
 * MCP server source. This module is now a thin re-export over the generalized
 * `scripts/lib/ledger-bridge.js`, which owns the freshness guard (rebuild
 * `mcp-server/dist/` when stale) and the cached dynamic `import()` — so the
 * discovery logic is never re-implemented outside of
 * `mcp-server/src/storage/ledger-store.ts`.
 *
 * Existing callers are unaffected: `listAllProjectDirs(storeRoot)` keeps its
 * original signature and contract.
 */

import { loadDistModule } from './ledger-bridge.js';

/**
 * Returns the absolute storage directory path for every project found under
 * `storeRoot`, delegating to `LedgerStore.listAllProjectDirs()`.
 *
 * @param {string} storeRoot - Absolute path to a ledger store root.
 * @returns {Promise<string[]>}
 */
export async function listAllProjectDirs(storeRoot) {
  const { LedgerStore } = await loadDistModule('storage/ledger-store.js');
  return LedgerStore.listAllProjectDirs(storeRoot);
}
