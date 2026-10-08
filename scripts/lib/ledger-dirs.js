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
 * MCP server source. This module loads that compiled implementation from
 * `mcp-server/dist/` and re-exports it for Node scripts, so the discovery
 * logic is never re-implemented outside of `mcp-server/src/storage/ledger-store.ts`.
 *
 * Rebuilds `mcp-server/dist/` automatically when stale, via the shared
 * `scripts/lib/mcp-dist-freshness.js` module (`ensureMcpDistFresh()`) — the
 * same freshness guard used by `scripts/import-standalone.js`.
 */

import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { ensureMcpDistFresh as ensureMcpDistFreshShared } from './mcp-dist-freshness.js';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');
const MCP_DIST_LEDGER_STORE = path.join(MCP_SERVER_DIR, 'dist', 'storage', 'ledger-store.js');

/**
 * Rebuilds `mcp-server/dist/` when missing or older than `mcp-server/src/`,
 * via the shared freshness module. Exits the process on build failure or a
 * missing compiled module, consistent with `import-standalone.js`.
 */
function ensureMcpDistFresh() {
  const result = ensureMcpDistFreshShared({
    mcpServerDir: MCP_SERVER_DIR,
    requiredFile: MCP_DIST_LEDGER_STORE,
    onBuildStart: () => {
      console.log('[ledger-dirs] mcp-server/dist is stale or missing — building MCP server...');
    },
  });

  if (!result.ok && result.reason === 'build-failed') {
    console.error('[ledger-dirs] MCP server build failed.');
    process.exit(result.status ?? 1);
  }

  if (!result.ok && result.reason === 'missing-module') {
    console.error(`[ledger-dirs] Error: compiled module not found at ${result.file}`);
    console.error('Try running: cd mcp-server && npm run build');
    process.exit(1);
  }
}

/** @type {Promise<{ LedgerStore: unknown }> | null} */
let ledgerStoreModulePromise = null;

/**
 * Loads (and caches) the compiled `LedgerStore` class from `mcp-server/dist/`.
 * @returns {Promise<any>}
 */
async function loadLedgerStore() {
  ensureMcpDistFresh();
  if (!ledgerStoreModulePromise) {
    ledgerStoreModulePromise = import(pathToFileURL(MCP_DIST_LEDGER_STORE).href);
  }
  const mod = await ledgerStoreModulePromise;
  return mod.LedgerStore;
}

/**
 * Returns the absolute storage directory path for every project found under
 * `storeRoot`, delegating to `LedgerStore.listAllProjectDirs()`.
 *
 * @param {string} storeRoot - Absolute path to a ledger store root.
 * @returns {Promise<string[]>}
 */
export async function listAllProjectDirs(storeRoot) {
  const LedgerStore = await loadLedgerStore();
  return LedgerStore.listAllProjectDirs(storeRoot);
}
