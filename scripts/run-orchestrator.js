#!/usr/bin/env node

/**
 * run-orchestrator.js
 *
 * Pre-flight dist freshness guard + orchestrate launcher.
 *
 * Checks whether mcp-server/dist/ is up to date relative to mcp-server/src/,
 * via the shared `scripts/lib/mcp-dist-freshness.js` module. Rebuilds via
 * `npm run build` when any source file is newer than the compiled output
 * sentinel (dist/index.js), or when dist/ does not yet exist, then delegates
 * to the `orchestrate` CLI with all supplied arguments.
 *
 * Usage (from workspace root):
 *   node scripts/run-orchestrator.js [orchestrate options…]
 *   node scripts/run-orchestrator.js path/to/plan.md --dry-run
 *
 * Replaces orchestrator/run.sh for cross-platform (macOS, Linux, Windows)
 * compatibility.
 */

import path from 'path';
import { spawnSync } from 'child_process';
import { ensureMcpDistFresh } from './lib/mcp-dist-freshness.js';

// ---------------------------------------------------------------------------
// 1. Resolve paths
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');

// ---------------------------------------------------------------------------
// 2. Ensure mcp-server/dist/ is fresh, rebuilding it when stale. A build
//    failure exits silently with the build's own status, matching the
//    pre-migration behaviour — no error message here, since the failed
//    `npm run build` subprocess already printed its own output via
//    `stdio: 'inherit'`.
// ---------------------------------------------------------------------------

const freshnessResult = ensureMcpDistFresh({
  mcpServerDir: MCP_SERVER_DIR,
  onBuildStart: () => {
    console.log('[run-orchestrator.js] mcp-server/dist is stale or missing — building MCP server...');
  },
});

if (!freshnessResult.ok && freshnessResult.reason === 'build-failed') {
  process.exit(freshnessResult.status ?? 1);
} else if (!freshnessResult.rebuilt) {
  console.log('[run-orchestrator.js] mcp-server/dist is up to date — skipping build.');
}

// ---------------------------------------------------------------------------
// 4. Launch the orchestrator, forwarding all arguments verbatim
// ---------------------------------------------------------------------------
const forwardedArgs = process.argv.slice(2);

// ---------------------------------------------------------------------------
// 5. Remind the caller about companion scripts
// ---------------------------------------------------------------------------
console.log('');
console.log('[run-orchestrator.js] Companion scripts available while the orchestrator is running:');
console.log('  Read logs  →  node scripts/read-log.js <path/to/log.jsonl>');
console.log('               (alias: node scripts/cli.js read-log <path/to/log.jsonl>)');
console.log('  Kill stale →  node scripts/kill-orchestrator.js');
console.log('               (alias: node scripts/cli.js kill-orchestrator)');
console.log('  TIP: Prefer using read-log.js over native command line tools to read logs —');
console.log('       it understands the JSONL format.');
console.log('');

// Resolve the orchestrate binary from the local venv to avoid picking up a
// stale system-wide install via $PATH.  Python venv uses "Scripts" on Windows
// and "bin" elsewhere; the binary is "orchestrate.exe" on Windows.
const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
const orchestrateCmd = path.join(WORKSPACE_ROOT, 'orchestrator', '.venv', venvBin, 'orchestrate');
const result = spawnSync(orchestrateCmd, forwardedArgs, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, PYTHONUTF8: '1' },
});

process.exit(result.status ?? 1);
