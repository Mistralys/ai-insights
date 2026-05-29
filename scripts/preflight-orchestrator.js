#!/usr/bin/env node

/**
 * scripts/preflight-orchestrator.js
 *
 * Pre-flight validation for the AI Insights orchestrator.
 *
 * Checks that the orchestrator environment is ready to run:
 *   - Python venv exists with `orchestrate` binary
 *   - .env is configured with at least one API key
 *   - MCP server dist is up to date
 *   - No conflicting orchestrator process is already running
 *   - (Optional) Plan file exists (when --plan <path> is given)
 *   - (Optional) API key(s) are accepted by the provider (when --check-api-key is given)
 *
 * Usage:
 *   node scripts/preflight-orchestrator.js
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md
 *   node scripts/preflight-orchestrator.js --plan path/to/plan.md --json
 *   node scripts/preflight-orchestrator.js --check-api-key
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// ─── Constants ──────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT   = path.resolve(import.meta.dirname, '..');
const ORCHESTRATOR_DIR = path.join(WORKSPACE_ROOT, 'orchestrator');
const MCP_SRC          = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const IS_WIN           = process.platform === 'win32';
const VENV_DIR         = path.join(ORCHESTRATOR_DIR, '.venv');
const ENV_FILE         = path.join(ORCHESTRATOR_DIR, '.env');

function venvBin(name) {
  return IS_WIN
    ? path.join(VENV_DIR, 'Scripts', `${name}.exe`)
    : path.join(VENV_DIR, 'bin', name);
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const C = {
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let planPath = null;
  let jsonOutput = false;
  let checkApiKey = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' && argv[i + 1]) {
      planPath = argv[++i];
    } else if (argv[i] === '--json') {
      jsonOutput = true;
    } else if (argv[i] === '--check-api-key') {
      checkApiKey = true;
    }
  }

  return { planPath, jsonOutput, checkApiKey };
}

// ─── Check implementations ───────────────────────────────────────────────────

/**
 * @typedef {{ name: string, pass: boolean, detail: string, fix?: string }} CheckResult
 */

/**
 * Parse orchestrator/.env and return a map of key → value.
 * Comment lines and lines without a value are skipped.
 * @returns {Record<string, string>}
 */
function parseEnvVars() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const vars = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val) vars[key] = val;
  }
  return vars;
}

/** Check that the Python venv exists and contains the orchestrate binary. */
function checkVenv() {
  if (!fs.existsSync(VENV_DIR)) {
    return {
      name: 'venv',
      pass: false,
      detail: '.venv directory not found',
      fix: 'node scripts/cli.js setup --components orchestrator',
    };
  }

  const orchestrateBin = venvBin('orchestrate');
  if (!fs.existsSync(orchestrateBin)) {
    return {
      name: 'venv',
      pass: false,
      detail: 'orchestrate binary not found in .venv',
      fix: 'node scripts/cli.js setup --components orchestrator --force',
    };
  }

  return { name: 'venv', pass: true, detail: 'orchestrate binary found' };
}

/** Check that .env exists and contains at least one API key. */
function checkEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      name: 'env',
      pass: false,
      detail: '.env file not found',
      fix: 'cp orchestrator/.env.example orchestrator/.env  # then edit it',
    };
  }

  const vars = parseEnvVars();

  if (!vars.ANTHROPIC_API_KEY && !vars.GOOGLE_API_KEY) {
    return {
      name: 'env',
      pass: false,
      detail: 'No API key set in .env (need ANTHROPIC_API_KEY or GOOGLE_API_KEY)',
      fix: 'Set the appropriate API key in orchestrator/.env',
    };
  }

  return { name: 'env', pass: true, detail: 'API key configured' };
}

/** Check that MCP server dist is up to date. */
function checkMcpDist() {
  if (!fs.existsSync(MCP_DIST_SENTINEL)) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist/index.js not found',
      fix: 'cd mcp-server && npm run build',
    };
  }

  const sentinelMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;

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

  if (latestMtime(MCP_SRC) > sentinelMtime) {
    return {
      name: 'mcp-dist',
      pass: false,
      detail: 'mcp-server/dist is stale (source is newer)',
      fix: 'cd mcp-server && npm run build',
    };
  }

  return { name: 'mcp-dist', pass: true, detail: 'mcp-server/dist is up to date' };
}

/** Check that no other orchestrator process is running. */
function checkNoConflict() {
  if (IS_WIN) {
    // On Windows, skip ps-based check — the lock file check below is sufficient
    return { name: 'no-conflict', pass: true, detail: 'process check skipped (Windows)' };
  }

  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });
  if (r.status === 0 && r.stdout.trim()) {
    // Filter out this script and grep itself
    const procs = r.stdout
      .trim()
      .split('\n')
      .filter((line) => !line.includes('preflight-orchestrator') && !line.includes('pgrep'));
    if (procs.length > 0) {
      return {
        name: 'no-conflict',
        pass: false,
        detail: `Orchestrator process already running (${procs.length} found)`,
        fix: 'Kill existing process first, or wait for it to finish',
      };
    }
  }

  return { name: 'no-conflict', pass: true, detail: 'no running orchestrator process' };
}

/** Check that the plan file exists (when --plan is given). */
function checkPlanFile(planPath) {
  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) {
    return {
      name: 'plan-file',
      pass: false,
      detail: `Plan file not found: ${resolved}`,
    };
  }

  return { name: 'plan-file', pass: true, detail: path.basename(resolved) };
}

/**
 * Live-validate an Anthropic API key via GET /v1/models — no tokens consumed.
 * @param {string} apiKey
 * @returns {Promise<CheckResult>}
 */
async function checkAnthropicKey(apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.ok) {
      return { name: 'anthropic-key', pass: true, detail: 'key accepted by Anthropic API' };
    }
    const hint = res.status === 401 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name: 'anthropic-key',
      pass: false,
      detail: `Anthropic rejected key: ${hint}`,
      fix: 'Update ANTHROPIC_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    return {
      name: 'anthropic-key',
      pass: false,
      detail: `Anthropic key check failed: ${err.message}`,
    };
  }
}

/**
 * Live-validate a Google AI Studio API key via GET /v1beta/models — no tokens consumed.
 * @param {string} apiKey
 * @returns {Promise<CheckResult>}
 */
async function checkGoogleKey(apiKey) {
  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      return { name: 'google-key', pass: true, detail: 'key accepted by Google AI Studio API' };
    }
    const hint =
      res.status === 400 || res.status === 403 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name: 'google-key',
      pass: false,
      detail: `Google rejected key: ${hint}`,
      fix: 'Update GOOGLE_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    return {
      name: 'google-key',
      pass: false,
      detail: `Google key check failed: ${err.message}`,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { planPath, jsonOutput, checkApiKey } = parseArgs();

  /** @type {CheckResult[]} */
  const results = [
    checkVenv(),
    checkEnv(),
    checkMcpDist(),
    checkNoConflict(),
  ];

  if (planPath) {
    results.push(checkPlanFile(planPath));
  }

  if (checkApiKey) {
    const vars = parseEnvVars();
    const pending = [];
    if (vars.ANTHROPIC_API_KEY) pending.push(checkAnthropicKey(vars.ANTHROPIC_API_KEY));
    if (vars.GOOGLE_API_KEY)    pending.push(checkGoogleKey(vars.GOOGLE_API_KEY));
    if (pending.length === 0) {
      results.push({
        name: 'api-key',
        pass: false,
        detail: 'No API key found in .env to validate',
        fix: 'Set ANTHROPIC_API_KEY or GOOGLE_API_KEY in orchestrator/.env',
      });
    } else {
      results.push(...await Promise.all(pending));
    }
  }

  const allPass = results.every((r) => r.pass);

  // ─── JSON output ──────────────────────────────────────────────────────
  if (jsonOutput) {
    const output = { ok: allPass, checks: results };
    console.log(JSON.stringify(output, null, 2));
    process.exit(allPass ? 0 : 1);
  }

  // ─── Human-readable output ────────────────────────────────────────────
  console.log('');
  console.log(C.bold('Orchestrator Pre-Flight Checks'));
  console.log('');

  for (const r of results) {
    const icon  = r.pass ? C.green('✓') : C.red('✗');
    const label = r.name.padEnd(14);
    const detail = r.pass ? C.dim(r.detail) : C.red(r.detail);
    console.log(`  ${icon} ${label} ${detail}`);
    if (!r.pass && r.fix) {
      console.log(`               ${C.yellow('Fix:')} ${r.fix}`);
    }
  }

  console.log('');
  if (allPass) {
    console.log(C.green('All pre-flight checks passed.'));
  } else {
    const failCount = results.filter((r) => !r.pass).length;
    console.log(C.red(`${failCount} check(s) failed. Resolve the issues above before launching.`));
  }
  console.log('');

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
