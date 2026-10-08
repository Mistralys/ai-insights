#!/usr/bin/env node

/**
 * scripts/audit-orchestrator.js
 *
 * Audit the orchestrator's installed Python packages for known security
 * advisories with `pip-audit` (part of the orchestrator `dev` extras).
 *
 * The audit runs against the packages actually installed in
 * `orchestrator/.venv` (`--path <site-packages>`), not against whichever
 * Python environment happens to be active.
 *
 * Usage:
 *   node scripts/audit-orchestrator.js           Audit; human-readable table
 *   node scripts/audit-orchestrator.js --json    Machine-readable JSON output
 *   node scripts/audit-orchestrator.js --fix     Let pip-audit upgrade vulnerable packages
 *   node scripts/audit-orchestrator.js --help    Show this help
 *
 * Exit codes:
 *   0 — No known vulnerabilities
 *   1 — Vulnerabilities found, or the audit could not run (venv or pip-audit missing)
 *
 * Any other argument is passed through to `pip-audit` unchanged.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const VENV_DIR         = path.join(ORCHESTRATOR_DIR, '.venv');
const IS_WIN           = process.platform === 'win32';

const VENV_PYTHON = IS_WIN
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Resolve the venv's site-packages directory (Windows `Lib/`, POSIX `lib/pythonX.Y/`). */
function findSitePackages() {
  const windows = path.join(VENV_DIR, 'Lib', 'site-packages');
  if (fs.existsSync(windows)) return windows;

  const libDir = path.join(VENV_DIR, 'lib');
  if (!fs.existsSync(libDir)) return null;
  for (const entry of fs.readdirSync(libDir)) {
    const candidate = path.join(libDir, entry, 'site-packages');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    const header = fs.readFileSync(import.meta.filename, 'utf8').split('*/')[0];
    console.log(header.replace(/^#!.*\n/, '').replace(/^\/\*\*\n|^ \* ?/gm, '').trim());
    return;
  }

  // `python -m pip_audit` rather than a bin path: identical on every OS, and
  // a dangling or foreign-architecture venv fails here with a clear message.
  if (!fs.existsSync(VENV_PYTHON)) {
    fail('orchestrator/.venv not found. Run `ai-insights setup` (orchestrator component) first.');
  }

  const probe = spawnSync(VENV_PYTHON, ['-m', 'pip_audit', '--version'], { encoding: 'utf8' });
  if (probe.error) {
    fail(`Cannot run the venv Python (${probe.error.message}). Recreate it with \`ai-insights setup --force\`.`);
  }
  if (probe.status !== 0) {
    fail('pip-audit is not installed in orchestrator/.venv. Install the dev extras: '
      + '`cd orchestrator && .venv/bin/python -m pip install -e ".[dev]"`.');
  }

  const sitePackages = findSitePackages();
  if (!sitePackages) {
    fail('Could not locate site-packages inside orchestrator/.venv — the venv looks incomplete.');
  }

  const result = spawnSync(VENV_PYTHON, ['-m', 'pip_audit', '--path', sitePackages, ...args], {
    cwd: ORCHESTRATOR_DIR,
    stdio: 'inherit',
  });

  if (result.error) fail(`pip-audit failed to start: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

main();
