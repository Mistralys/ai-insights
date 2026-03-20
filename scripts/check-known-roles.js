#!/usr/bin/env node

/**
 * scripts/check-known-roles.js
 *
 * Previously: compared KNOWN_ROLES in sync-personas.js against AGENT_ROLES in
 * mcp-server/src/utils/constants.ts to detect drift.
 *
 * Now superseded: both sync-personas.js and mcp-server/src/utils/constants.ts
 * derive their role lists directly from shared/workflow-manifest.json — so the
 * JS ↔ TS drift check is no longer meaningful. This script now delegates to
 * scripts/validate-workflow-manifest.js, which performs structural and semantic
 * validation of the manifest itself (unique IDs, DAG prerequisites, fail_routing
 * cross-references, and more).
 *
 * Usage:
 *   node scripts/check-known-roles.js          # from workspace root
 *   npm run check:roles                         # from mcp-server/ directory
 */

'use strict';

const path      = require('path');
const { execFileSync } = require('child_process');

const WORKSPACE_ROOT     = path.resolve(__dirname, '..');
const VALIDATE_SCRIPT    = path.join(WORKSPACE_ROOT, 'scripts', 'validate-workflow-manifest.js');

console.log('[check-known-roles] Role list is now derived from shared/workflow-manifest.json.');
console.log('[check-known-roles] Delegating to validate-workflow-manifest.js...\n');

try {
  execFileSync(process.execPath, [VALIDATE_SCRIPT], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });
} catch {
  // validate-workflow-manifest.js already printed the errors; just propagate exit code.
  process.exit(1);
}

