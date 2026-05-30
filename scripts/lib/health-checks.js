#!/usr/bin/env node

/**
 * scripts/lib/health-checks.js
 *
 * Unified health-check registry for the ai-insights workspace.
 * Single source of detection logic shared by status lines, the doctor command,
 * and preflight flows.
 *
 * Cost tier boundaries:
 *   instant  — file-existence stats, process.versions checks (< 5 ms)
 *   fast     — mtime comparisons, JSON config parsing (< 50 ms)
 *   slow     — subprocess spawns, network reachability (100 ms – 2 s)
 *
 * Exports:
 *   HEALTH_CHECKS  — Array<HealthCheck> with 9 annotated entries.
 *   runChecks(costFilter) — Filter by tier and resolve all detectors.
 *
 * Dependency direction: this file MUST NOT import from scripts/cli.js,
 * SETUP_COMPONENTS, or any other file in scripts/ outside of scripts/lib/.
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { spawn } from 'child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT    = path.resolve(import.meta.dirname, '../..');
const MCP_DIST_SENTINEL = path.join(WORKSPACE_ROOT, 'mcp-server', 'dist', 'index.js');
const MCP_SRC_DIR       = path.join(WORKSPACE_ROOT, 'mcp-server', 'src');
const VENV_DIR          = path.join(WORKSPACE_ROOT, 'orchestrator', '.venv');
const SIBLING_DIR       = path.resolve(WORKSPACE_ROOT, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively find the latest mtime (ms) among all files in a directory.
 * Returns -Infinity if the directory is unreadable or empty.
 * @param {string} dir
 * @returns {number}
 */
function latestMtime(dir) {
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
    // Directory unreadable — treat as empty.
  }
  return latest;
}

// ─── Type definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, label: string, cost: 'instant'|'fast', detect(): boolean, fix?: string }} SyncCheck
 * @typedef {{ id: string, label: string, cost: 'slow', detect(): Promise<boolean>, fix?: string }} SlowCheck
 * @typedef {SyncCheck | SlowCheck} HealthCheck
 * @typedef {{ id: string, label: string, passed: boolean, fix?: string }} CheckResult
 */

// ─── Health-Check Registry ───────────────────────────────────────────────────

/** @type {Array<HealthCheck>} */
export const HEALTH_CHECKS = [

  // ── instant tier (< 5 ms — safe on every menu render) ────────────────────

  /** @type {SyncCheck} */
  {
    id: 'mcp-dist',
    label: 'MCP Server dist built',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(MCP_DIST_SENTINEL);
    },
    fix: 'cd mcp-server && npm run build',
  },

  /** @type {SyncCheck} */
  {
    id: 'orchestrator-venv',
    label: 'Orchestrator venv present',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(VENV_DIR);
    },
    fix: 'node scripts/cli.js setup --components orchestrator',
  },

  /** @type {SyncCheck} */
  {
    id: 'hooks-installed',
    label: 'Git hooks installed',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      try {
        const gitConfig = fs.readFileSync(
          path.join(WORKSPACE_ROOT, '.git', 'config'),
          'utf8'
        );
        return /hooksPath\s*=\s*\.githooks/.test(gitConfig);
      } catch {
        return false;
      }
    },
    fix: 'node scripts/cli.js install-hooks',
  },

  /** @type {SyncCheck} */
  {
    id: 'node-version',
    label: 'Node.js \u2265 18',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      const major = parseInt(process.versions.node.split('.')[0], 10);
      return major >= 18;
    },
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  },

  /** @type {SyncCheck} */
  {
    id: 'sibling-cli-menu',
    label: 'cli-menu dist built',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(path.join(SIBLING_DIR, 'cli-menu', 'dist'));
    },
    fix: 'cd ../cli-menu && npm run build',
  },

  /** @type {SyncCheck} */
  {
    id: 'sibling-persona-builder',
    label: 'ai-persona-builder dist built',
    cost: 'instant',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(path.join(SIBLING_DIR, 'ai-persona-builder', 'dist'));
    },
    fix: 'cd ../ai-persona-builder && npm run build',
  },

  // ── fast tier (< 50 ms — mtime comparisons, JSON reads) ──────────────────

  /** @type {SyncCheck} */
  {
    id: 'global-mcp-registered',
    label: 'Global MCP registered',
    cost: 'fast',
    /** @returns {boolean} */
    detect() {
      return fs.existsSync(path.join(os.homedir(), '.ai-insights', 'config.json'));
    },
    fix: 'node scripts/cli.js install-mcp',
  },

  /** @type {SyncCheck} */
  {
    id: 'mcp-dist-fresh',
    label: 'MCP Server dist up to date',
    cost: 'fast',
    /** @returns {boolean} */
    detect() {
      if (!fs.existsSync(MCP_DIST_SENTINEL)) return false;
      const distMtime = fs.statSync(MCP_DIST_SENTINEL).mtimeMs;
      return latestMtime(MCP_SRC_DIR) <= distMtime;
    },
    fix: 'cd mcp-server && npm run build',
  },

  // ── slow tier (100 ms – 2 s — subprocess spawns) ─────────────────────────

  /** @type {SlowCheck} */
  {
    id: 'personas-fresh',
    label: 'Personas up to date',
    cost: 'slow',
    /** @returns {Promise<boolean>} */
    detect() {
      return new Promise((resolve) => {
        const proc = spawn(
          'node',
          [path.join(WORKSPACE_ROOT, 'scripts', 'build-personas.js'), '--check'],
          { stdio: 'ignore', shell: false }
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    },
    fix: 'node scripts/cli.js sync-personas',
  },

];

// ─── runChecks helper ─────────────────────────────────────────────────────────

/**
 * Run the subset of health checks matching the given cost filter and resolve
 * all detectors, awaiting async slow checks.
 *
 * Filter behaviour:
 *   'instant' — only instant-tier checks; all detectors are synchronous.
 *   'fast'    — instant + fast checks; all detectors are synchronous.
 *   'slow'    — only slow-tier checks; all detectors are async (Promise).
 *   'all'     — all checks; async slow detectors are awaited.
 *
 * @param {'instant'|'fast'|'slow'|'all'} costFilter
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(costFilter) {
  /** @type {Record<string, string[]>} */
  const tierSets = {
    instant: ['instant'],
    fast:    ['instant', 'fast'],
    slow:    ['slow'],
    all:     ['instant', 'fast', 'slow'],
  };

  const allowed = tierSets[costFilter];
  if (!allowed) {
    throw new Error(
      `Unknown costFilter "${costFilter}". Expected: instant | fast | slow | all`
    );
  }

  const checks = HEALTH_CHECKS.filter(c => allowed.includes(c.cost));

  const results = await Promise.all(
    checks.map(async (check) => {
      let passed;
      try {
        const raw = check.detect();
        // instant/fast detectors return a plain boolean — no await needed.
        // slow detectors return a Promise — await it.
        passed = raw instanceof Promise ? await raw : raw;
      } catch {
        passed = false;
      }

      /** @type {CheckResult} */
      const result = { id: check.id, label: check.label, passed: Boolean(passed) };
      if (check.fix) result.fix = check.fix;
      return result;
    })
  );

  return results;
}
