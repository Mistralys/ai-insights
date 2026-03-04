#!/usr/bin/env node

/**
 * setup-orchestrator.js
 *
 * One-shot setup for the orchestrator sub-project:
 *   1. Verifies Python 3.11+ is available.
 *   2. Creates orchestrator/.venv if it does not already exist.
 *   3. Upgrades pip inside the venv.
 *   4. Installs the package with the chosen LLM provider extra.
 *   5. Scaffolds orchestrator/.env from .env.example when missing.
 *   6. Prints a summary of next steps.
 *
 * Usage (from workspace root):
 *   node scripts/setup-orchestrator.js [options]
 *
 * Options:
 *   --provider <anthropic|google>   LLM provider to install (default: anthropic)
 *   --dev                           Also install [dev] extras (pytest, ruff)
 *   --checkpoint                    Also install [checkpoint] extra (SQLite resume)
 *   --force                         Re-create the venv even if it already exists
 *   --help, -h                      Print this help message
 *
 * Examples:
 *   node scripts/setup-orchestrator.js
 *   node scripts/setup-orchestrator.js --provider google --dev
 *   node scripts/setup-orchestrator.js --force --checkpoint
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const { spawnSync, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT    = path.resolve(__dirname, '..');
const ORCHESTRATOR_DIR  = path.join(WORKSPACE_ROOT, 'orchestrator');
const VENV_DIR          = path.join(ORCHESTRATOR_DIR, '.venv');
const ENV_EXAMPLE       = path.join(ORCHESTRATOR_DIR, '.env.example');
const ENV_FILE          = path.join(ORCHESTRATOR_DIR, '.env');
const MIN_PYTHON_MAJOR  = 3;
const MIN_PYTHON_MINOR  = 11;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg)   { console.log(`[setup-orchestrator] ${msg}`); }
function warn(msg)  { console.warn(`[setup-orchestrator] ⚠  ${msg}`); }
function abort(msg) { console.error(`[setup-orchestrator] ✗  ${msg}`); process.exit(1); }

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    abort(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function which(cmd) {
  const result = spawnSync('which', [cmd], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Return the path to the Python / pip executables inside the venv. */
function venvBin(name) {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', name + '.exe')
    : path.join(VENV_DIR, 'bin', name);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/setup-orchestrator.js [options]

Options:
  --provider <anthropic|google>   LLM provider to install (default: anthropic)
  --dev                           Also install [dev] extras (pytest, ruff)
  --checkpoint                    Also install [checkpoint] extra (SQLite resume)
  --force                         Re-create the venv even if it already exists
  --help, -h                      Print this help message
`.trim());
  process.exit(0);
}

const providerIdx = args.indexOf('--provider');
const provider    = providerIdx !== -1 ? args[providerIdx + 1] : 'anthropic';
const withDev     = args.includes('--dev');
const withCkpt    = args.includes('--checkpoint');
const force       = args.includes('--force');

if (!['anthropic', 'google'].includes(provider)) {
  abort(`Unknown provider "${provider}". Use "anthropic" or "google".`);
}

// ---------------------------------------------------------------------------
// 1. Locate a suitable Python binary
// ---------------------------------------------------------------------------
const pythonCandidates = ['python3', 'python'];
let pythonBin = null;

for (const candidate of pythonCandidates) {
  const found = which(candidate);
  if (!found) continue;

  const versionOut = spawnSync(found, ['--version'], { encoding: 'utf8' });
  const match = versionOut.stdout.trim().match(/Python (\d+)\.(\d+)/);
  if (!match) continue;

  const [, major, minor] = match.map(Number);
  if (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR) {
    pythonBin = found;
    log(`Using Python ${major}.${minor} at ${found}`);
    break;
  }
}

if (!pythonBin) {
  abort(
    `Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ not found on PATH. ` +
    `Install it from https://python.org and retry.`
  );
}

// ---------------------------------------------------------------------------
// 2. Create (or recreate) the virtual environment
// ---------------------------------------------------------------------------
if (fs.existsSync(VENV_DIR) && !force) {
  log('.venv already exists — skipping creation (use --force to recreate).');
} else {
  if (fs.existsSync(VENV_DIR) && force) {
    log('--force specified — removing existing .venv …');
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
  }
  log('Creating virtual environment …');
  run(pythonBin, ['-m', 'venv', VENV_DIR]);
  log('.venv created.');
}

// ---------------------------------------------------------------------------
// 3. Upgrade pip
// ---------------------------------------------------------------------------
log('Upgrading pip …');
run(venvBin('python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);

// ---------------------------------------------------------------------------
// 4. Build the extras string and install
//    e.g. "anthropic,dev,checkpoint"
// ---------------------------------------------------------------------------
const extras = [provider];
if (withDev)  extras.push('dev');
if (withCkpt) extras.push('checkpoint');
const extrasStr = extras.join(',');
const installTarget = `.[${extrasStr}]`;

log(`Installing orchestrator package with extras [${extrasStr}] …`);
run(
  venvBin('pip'),
  ['install', '--quiet', '-e', installTarget],
  { cwd: ORCHESTRATOR_DIR }
);
log('Package installed successfully.');

// ---------------------------------------------------------------------------
// 5. Scaffold .env
// ---------------------------------------------------------------------------
if (fs.existsSync(ENV_FILE)) {
  log('.env already exists — skipping scaffold.');
} else if (fs.existsSync(ENV_EXAMPLE)) {
  fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
  log('.env created from .env.example — remember to add your API key.');
} else {
  warn('.env.example not found; skipping .env scaffold.');
}

// ---------------------------------------------------------------------------
// 6. Summary
// ---------------------------------------------------------------------------
const pythonPath = venvBin('python');
const relVenv    = path.relative(WORKSPACE_ROOT, VENV_DIR);

console.log(`
╔══════════════════════════════════════════════════════╗
║          Orchestrator setup complete ✓               ║
╠══════════════════════════════════════════════════════╣
║  venv      ${relVenv.padEnd(40)} ║
║  provider  ${provider.padEnd(40)} ║
║  extras    ${extrasStr.padEnd(40)} ║
╚══════════════════════════════════════════════════════╝

Next steps:
  1. Add your API key to orchestrator/.env
  2. Run a workflow:
       node scripts/run-orchestrator.js path/to/plan.md
     (run-orchestrator.js auto-rebuilds the MCP server when needed)

Activate the venv manually (optional, for direct CLI use):
  source ${relVenv}/bin/activate
  orchestrate --help
`);
