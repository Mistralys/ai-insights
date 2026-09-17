/**
 * scripts/lib/ledger-bridge.js
 *
 * Generalized bridge from root-level `scripts/` utilities into compiled
 * MCP server logic under `mcp-server/dist/`.
 *
 * This subsumes `scripts/lib/ledger-dirs.js`'s original dist-loading
 * mechanism: the freshness guard (rebuild `mcp-server/dist/` when stale or
 * missing) and the cached dynamic `import()`. Where `ledger-dirs.js` only
 * ever loaded `storage/ledger-store.js`, this module can load any compiled
 * module under `mcp-server/dist/` by its relative path, so further root-level
 * scripts (the `ledger` CLI group, `store-commands.js`) can reach compiled
 * TypeScript logic without each re-implementing this freshness/caching dance.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');
const MCP_SRC_DIR = path.join(MCP_SERVER_DIR, 'src');
const MCP_DIST_DIR = path.join(MCP_SERVER_DIR, 'dist');
const MCP_DIST_SENTINEL = path.join(MCP_DIST_DIR, 'index.js');

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
    console.log('[ledger-bridge] mcp-server/dist is stale or missing — building MCP server...');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawnSync(npmCmd, ['run', 'build'], {
      cwd: MCP_SERVER_DIR,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      console.error('[ledger-bridge] MCP server build failed.');
      process.exit(build.status ?? 1);
    }
  }
}

/** @type {Map<string, Promise<any>>} */
const modulePromiseCache = new Map();

/**
 * Loads (and caches) a compiled module from `mcp-server/dist/`, rebuilding
 * `mcp-server/dist/` first when it is stale or missing.
 *
 * @param {string} relativePath - Path relative to `mcp-server/dist/`, e.g.
 *   `storage/ledger-store.js` or `storage/repository-lookup.js`.
 * @returns {Promise<any>} The imported module namespace object.
 */
export async function loadDistModule(relativePath) {
  const absolutePath = path.join(MCP_DIST_DIR, relativePath);

  ensureMcpDistFresh();

  if (!fs.existsSync(absolutePath)) {
    console.error(`[ledger-bridge] Error: compiled module not found at ${absolutePath}`);
    console.error('Try running: cd mcp-server && npm run build');
    process.exit(1);
  }

  if (!modulePromiseCache.has(relativePath)) {
    modulePromiseCache.set(relativePath, import(pathToFileURL(absolutePath).href));
  }
  return modulePromiseCache.get(relativePath);
}
