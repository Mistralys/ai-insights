#!/usr/bin/env node

/**
 * run-orchestrator.js
 *
 * Pre-flight dist freshness guard + orchestrate launcher.
 *
 * Checks whether mcp-server/dist/ is up to date relative to mcp-server/src/.
 * Rebuilds via `npm run build` when any source file is newer than the compiled
 * output sentinel (dist/index.js), or when dist/ does not yet exist, then
 * delegates to the `orchestrate` CLI with all supplied arguments.
 *
 * Usage (from workspace root):
 *   node scripts/run-orchestrator.js [orchestrate options…]
 *   node scripts/run-orchestrator.js path/to/plan.md --dry-run
 *
 * Replaces orchestrator/run.sh for cross-platform (macOS, Linux, Windows)
 * compatibility.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const MCP_SRC       = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// 2. Determine whether a rebuild is needed
//    Walk mcp-server/src/ recursively; compare each file's mtime against the
//    sentinel's mtime.  Any src file newer than the sentinel → stale build.
// ---------------------------------------------------------------------------

/**
 * Recursively collect mtimeMs of every file under `dir`.
 * Returns the largest mtime found (i.e. the most recently modified file's
 * timestamp), or -Infinity when the directory is empty.
 *
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

let needBuild = false;

if (!fs.existsSync(MCP_DIST_SENTINEL)) {
  needBuild = true;
} else {
  const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
  if (latestMtime(MCP_SRC) > sentinelMtime) {
    needBuild = true;
  }
}

// ---------------------------------------------------------------------------
// 3. Rebuild when necessary
// ---------------------------------------------------------------------------
const isWindows = process.platform === 'win32';
const npmCmd    = isWindows ? 'npm.cmd' : 'npm';

if (needBuild) {
  console.log('[run-orchestrator.js] mcp-server/dist is stale or missing — building MCP server...');
  const build = spawnSync(npmCmd, ['run', 'build'], {
    cwd:   path.join(WORKSPACE_ROOT, 'mcp-server'),
    stdio: 'inherit',
    shell: isWindows, // npm.cmd requires shell:true on Windows/Node22+ to avoid EINVAL
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
} else {
  console.log('[run-orchestrator.js] mcp-server/dist is up to date — skipping build.');
}

// ---------------------------------------------------------------------------
// 4. Launch the orchestrator, forwarding all arguments verbatim
// ---------------------------------------------------------------------------
const forwardedArgs = process.argv.slice(2);

// Resolve the orchestrate binary from the local venv to avoid picking up a
// stale system-wide install via $PATH.  Python venv uses "Scripts" on Windows
// and "bin" elsewhere; the binary is "orchestrate.exe" on Windows.
const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
const orchestrateCmd = path.join(WORKSPACE_ROOT, 'orchestrator', '.venv', venvBin, 'orchestrate');
const result = spawnSync(orchestrateCmd, forwardedArgs, {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
