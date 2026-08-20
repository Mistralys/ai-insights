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
 * Rebuilds `mcp-server/dist/` automatically when stale, mirroring the
 * freshness guard already used by `scripts/import-standalone.js`.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');
const MCP_SRC_DIR = path.join(MCP_SERVER_DIR, 'src');
const MCP_DIST_SENTINEL = path.join(MCP_SERVER_DIR, 'dist', 'index.js');
const MCP_DIST_LEDGER_STORE = path.join(MCP_SERVER_DIR, 'dist', 'storage', 'ledger-store.js');

/**
 * Recursively returns the largest mtime (ms) of any file under `dir`.
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
  let latest = -Infinity;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(full));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  }
  return latest;
}

/**
 * Rebuilds `mcp-server/dist/` when missing or older than `mcp-server/src/`.
 * Exits the process on build failure, consistent with `import-standalone.js`.
 */
function ensureMcpDistFresh() {
  let needBuild = !fs.existsSync(MCP_DIST_SENTINEL);
  if (!needBuild) {
    needBuild = latestMtime(MCP_SRC_DIR) > fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
  }

  if (needBuild) {
    console.log('[ledger-dirs] mcp-server/dist is stale or missing — building MCP server...');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmCmd, ['run', 'build'], {
      cwd: MCP_SERVER_DIR,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      console.error('[ledger-dirs] MCP server build failed.');
      process.exit(build.status ?? 1);
    }
  }

  if (!fs.existsSync(MCP_DIST_LEDGER_STORE)) {
    console.error(`[ledger-dirs] Error: compiled module not found at ${MCP_DIST_LEDGER_STORE}`);
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
