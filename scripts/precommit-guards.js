#!/usr/bin/env node

/**
 * scripts/precommit-guards.js
 *
 * Runner for the workspace's pre-commit guards (scripts/lib/precommit-guards.js).
 * Invoked by .githooks/pre-commit, which is installed via scripts/install-hooks.js.
 *
 * Iterates GUARDS in order, printing each guard's messages, and exits 1 on
 * the first blocking failure (short-circuiting remaining guards). Advisory
 * guards print warnings but never change the exit code.
 *
 * Usage: node scripts/precommit-guards.js
 * Exit codes: 0 — all blocking guards passed; 1 — a blocking guard failed.
 */

import { GUARDS, getStagedFiles, runGuards } from './lib/precommit-guards.js';

function main() {
  const stagedFiles = getStagedFiles();
  return runGuards(GUARDS, stagedFiles);
}

process.exit(main());
