#!/usr/bin/env node
/**
 * scripts/generate-agents-overview.js
 *
 * Generates docs/references/agents-overview.md from persona YAML metadata across all
 * three suites (ledger, standalone, ledger-support). Thin CLI over
 * scripts/lib/agents-overview.js; `node scripts/build-personas.js` runs the same
 * generation as a post-step and checks it on every invocation.
 *
 * Usage:
 *   node scripts/generate-agents-overview.js          — generate and write (skips a date-only change)
 *   node scripts/generate-agents-overview.js --check  — exit 0 if current, 1 if stale
 *   node scripts/generate-agents-overview.js --dry-run — alias for --check
 */

import path from 'path';
import { checkAgentsOverview, writeAgentsOverview } from './lib/agents-overview.js';

const ROOT    = path.resolve(import.meta.dirname, '..');
const isCheck = process.argv.includes('--check') || process.argv.includes('--dry-run');

if (isCheck) {
  const findings = checkAgentsOverview({ root: ROOT });
  if (findings.length === 0) {
    console.log('docs/references/agents-overview.md is up to date.');
    process.exit(0);
  }
  for (const finding of findings) console.error(`[STALE] ${finding}`);
  process.exit(1);
}

const { written, personaCount } = writeAgentsOverview({ root: ROOT });
if (written) {
  console.log(`Generated docs/references/agents-overview.md (${personaCount} personas).`);
} else {
  console.log('docs/references/agents-overview.md is already up to date.');
}
