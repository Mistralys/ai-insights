#!/usr/bin/env node

/**
 * scripts/check-known-roles.js
 *
 * Asserts that KNOWN_ROLES in sync-personas.js and AGENT_ROLES in
 * mcp-server/src/utils/constants.ts (read from the compiled output) are
 * identical. Any divergence is printed and the process exits 1.
 *
 * The MCP server is built automatically before comparison to ensure dist is
 * always up to date. No manual pre-build step is required.
 *
 * Usage:
 *   node scripts/check-known-roles.js          # from workspace root
 *   npm run check:roles                         # from mcp-server/ directory
 *
 * To trigger the failure mode manually, temporarily add a bogus entry to
 * KNOWN_ROLES in sync-personas.js (e.g. 'BogusRole') and re-run the script.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT  = path.resolve(__dirname, '..');
const CONSTANTS_JS    = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'utils', 'constants.js');
const SYNC_PERSONAS   = path.join(WORKSPACE_ROOT, 'scripts', 'sync-personas.js');

// ---------------------------------------------------------------------------
// Pre-build: ensure dist is fresh before comparison
// ---------------------------------------------------------------------------

const MCP_SERVER_DIR = path.join(WORKSPACE_ROOT, 'mcp-server');

console.log('[check-known-roles] Building MCP server to ensure dist is up to date...');
try {
  execSync('npm run build', { cwd: MCP_SERVER_DIR, stdio: 'inherit' });
} catch {
  console.error('[check-known-roles] ERROR: Build failed. Fix compilation errors and retry.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helper: parse a bracketed array literal from source text
// ---------------------------------------------------------------------------

/**
 * Applies `pattern` (must include the `s` dotAll flag) to `source`,
 * extracts the first capture group, and splits it into a trimmed string[].
 * Exits with code 1 and a clear error message if no match is found.
 *
 * @param {string} source   - The file contents to search.
 * @param {RegExp} pattern  - Regex with one capture group covering the array body.
 * @param {string} label    - Human-readable name used in error messages.
 * @returns {string[]}
 */
function parseArray(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) {
    console.error(`[check-known-roles] ERROR: Could not parse ${label}.`);
    process.exit(1);
  }
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Load AGENT_ROLES from compiled output
// ---------------------------------------------------------------------------

// The compiled ESM file uses `export const AGENT_ROLES = [...]`
// We read and parse it with a regex so we don't need to set up an ESM loader.
const constantsSource = fs.readFileSync(CONSTANTS_JS, 'utf8');

const agentRoles = parseArray(
  constantsSource,
  /export const AGENT_ROLES\s*=\s*\[([\s\S]+?)\]/s,
  'AGENT_ROLES from constants.js'
);

// ---------------------------------------------------------------------------
// Load KNOWN_ROLES from sync-personas.js
// ---------------------------------------------------------------------------

const syncSource = fs.readFileSync(SYNC_PERSONAS, 'utf8');

const knownRoles = parseArray(
  syncSource,
  /const KNOWN_ROLES\s*=\s*\[([\s\S]+?)\]/s,
  'KNOWN_ROLES from sync-personas.js'
);

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const missingFromKnown = agentRoles.filter((r) => !knownRoles.includes(r));
const extraInKnown     = knownRoles.filter((r) => !agentRoles.includes(r));

if (missingFromKnown.length === 0 && extraInKnown.length === 0) {
  console.log(`[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync (${agentRoles.length} roles).`);
  process.exit(0);
}

console.error('[check-known-roles] FAIL: KNOWN_ROLES / AGENT_ROLES are out of sync.\n');

if (missingFromKnown.length > 0) {
  console.error('  Missing from KNOWN_ROLES (present in AGENT_ROLES):');
  missingFromKnown.forEach((r) => console.error(`    - "${r}"`));
}

if (extraInKnown.length > 0) {
  console.error('\n  Extra in KNOWN_ROLES (not present in AGENT_ROLES):');
  extraInKnown.forEach((r) => console.error(`    - "${r}"`));
}

console.error('\n  Update KNOWN_ROLES in sync-personas.js to match AGENT_ROLES in');
console.error('  mcp-server/src/utils/constants.ts, then re-run this script.');
process.exit(1);
