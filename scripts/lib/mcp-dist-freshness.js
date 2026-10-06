/**
 * scripts/lib/mcp-dist-freshness.js
 *
 * Shared MCP-server dist/ freshness check and rebuild helper.
 *
 * `latestMtime()`, `isMcpDistStale()`, and `ensureMcpDistFresh()` replace the
 * private copies previously duplicated across `scripts/lib/ledger-dirs.js`,
 * `scripts/import-standalone.js`, `scripts/run-orchestrator.js`,
 * `scripts/cli.js`, and `scripts/lib/health-checks.js` — six copies that had
 * already drifted (different error handling, different sentinels for the
 * missing case). This module covers only what every caller does identically:
 * staleness, the rebuild spawn, and the post-build required-module check.
 *
 * This module never prints and never calls `process.exit`. Callers' message
 * texts differ (different prefixes, "tool" vs "module" wording, and
 * `run-orchestrator.js`'s deliberately silent build failure), so presentation
 * and the exit code stay with each caller — this mirrors the
 * "structured result, caller owns the exit" pattern already used by
 * `scripts/lib/build-checks.js` (`runBuildChecks()`/`resolveExitCode()`).
 *
 * `scripts/preflight-bootstrap.js` is deliberately NOT a consumer: it is the
 * first-run workspace bootstrapper launched by `menu.sh`/`menu.cmd`, before
 * `node_modules` is guaranteed to be installed, and must stay free of any
 * `scripts/lib` import to keep that first run robust.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Recursively find the latest mtime (ms) among all files under `dir`.
 * Returns `-Infinity` when `dir` is missing, unreadable, or empty — the
 * tolerant variant already used by `scripts/lib/health-checks.js`, so a
 * missing or unreadable `mcp-server/src/` reads as "not newer" instead of
 * throwing.
 *
 * @param {string} dir
 * @returns {number}
 */
export function latestMtime(dir) {
  let latest = -Infinity;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, latestMtime(full));
      } else if (entry.isFile()) {
        latest = Math.max(latest, fs.statSync(full).mtimeMs);
      }
    }
  } catch {
    // Missing or unreadable directory — treat as empty.
  }
  return latest;
}

/**
 * True when `sentinelFile` is missing, or older than the newest file under
 * `srcDir`.
 *
 * @param {{ srcDir: string, sentinelFile: string }} options
 * @returns {boolean}
 */
export function isMcpDistStale({ srcDir, sentinelFile }) {
  if (!fs.existsSync(sentinelFile)) {
    return true;
  }
  const sentinelMtime = fs.statSync(sentinelFile).mtimeMs;
  return latestMtime(srcDir) > sentinelMtime;
}

/**
 * @typedef {{ ok: true, rebuilt: boolean }
 *   | { ok: false, reason: 'build-failed', status: number | null }
 *   | { ok: false, reason: 'missing-module', file: string }} EnsureMcpDistFreshResult
 */

/**
 * Ensure `mcpServerDir`'s `dist/` output is fresh relative to its `src/`,
 * rebuilding it via `npm run build` (or `npm.cmd` on Windows) when stale.
 *
 * Never prints and never calls `process.exit` — the caller maps the
 * returned result to its own message texts and exit code.
 *
 * @param {object} options
 * @param {string} options.mcpServerDir - absolute path to the `mcp-server/` directory;
 *   `{mcpServerDir}/src` is the staleness source and `{mcpServerDir}/dist/index.js`
 *   is the sentinel
 * @param {string} [options.requiredFile] - absolute path to a compiled file that must
 *   exist once the freshness check has run. When omitted, no missing-module check
 *   runs at all.
 * @param {typeof spawnSync} [options.spawn] - injectable in place of the real
 *   `child_process.spawnSync`, so tests never spawn a real subprocess.
 * @param {string} [options.platform] - injectable in place of the real
 *   `process.platform`, so the Windows `npm.cmd` + `shell: true` branch is
 *   testable without running on Windows.
 * @param {() => void} [options.onBuildStart] - called exactly once, immediately
 *   before the rebuild is spawned, so a caller can print its own
 *   "stale — building" line at that moment and nowhere else. Not called when
 *   the dist output is already fresh.
 * @returns {EnsureMcpDistFreshResult}
 */
export function ensureMcpDistFresh({
  mcpServerDir,
  requiredFile,
  spawn = spawnSync,
  platform = process.platform,
  onBuildStart = () => {},
}) {
  const srcDir = path.join(mcpServerDir, 'src');
  const sentinelFile = path.join(mcpServerDir, 'dist', 'index.js');
  const stale = isMcpDistStale({ srcDir, sentinelFile });

  if (stale) {
    onBuildStart();
    const isWindows = platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    const build = spawn(npmCmd, ['run', 'build'], {
      cwd: mcpServerDir,
      stdio: 'inherit',
      shell: isWindows,
    });
    if (build.status !== 0) {
      return { ok: false, reason: 'build-failed', status: build.status };
    }
  }

  if (requiredFile !== undefined && !fs.existsSync(requiredFile)) {
    return { ok: false, reason: 'missing-module', file: requiredFile };
  }

  return { ok: true, rebuilt: stale };
}
