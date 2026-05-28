#!/usr/bin/env node

/**
 * scripts/kill-orchestrator.js
 *
 * Detect and terminate stale orchestrator processes. Cleans up stale
 * .orchestrator.lock files after killing.
 *
 * Usage:
 *   node scripts/kill-orchestrator.js            Interactive — prompts before killing
 *   node scripts/kill-orchestrator.js --force      Kill without prompting (agent use)
 *   node scripts/kill-orchestrator.js --json       List processes as JSON; no kill
 *   node scripts/kill-orchestrator.js --depth N    Scan last N log files for lock cleanup (default: 20)
 *   node scripts/kill-orchestrator.js --help       Show this help
 *
 * Exit codes:
 *   0 — No processes found, or processes successfully killed
 *   1 — Processes found but user declined to kill (interactive mode)
 *
 * No external dependencies — stdlib only (fs, path, child_process, readline).
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');
const LOGS_DIR       = path.join(WORKSPACE_ROOT, 'orchestrator', 'logs');

// ─── Platform ─────────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

// ─── Tunable constants ────────────────────────────────────────────────────────

const SIGTERM_GRACE_MS  = 3000; // ms to wait before escalating to SIGKILL
const DEFAULT_LOG_DEPTH = 20;   // number of recent log files to scan for lock cleanup

// ─── ANSI colors ──────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;

const C = {
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: node scripts/kill-orchestrator.js [options]

Detect and terminate stale orchestrator processes.
Also cleans up stale .orchestrator.lock files from recently-used plan directories.

Flags:
  (default)     List found processes and prompt for confirmation before killing
  --force       Kill all found processes without prompting (for agent/CI use)
  --json        Output process list as JSON array; does NOT kill anything
  --depth N     Scan last N log files for lock-file cleanup (default: 20); must be a positive integer
  --help, -h    Show this help

Exit codes:
  0   No processes found, or processes successfully killed
  1   Processes found but user declined (interactive mode)

Examples:
  node scripts/kill-orchestrator.js
  node scripts/kill-orchestrator.js --force
  node scripts/kill-orchestrator.js --json
  node scripts/kill-orchestrator.js --depth 5
`;

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const depthIdx = argv.indexOf('--depth');
  let depth = DEFAULT_LOG_DEPTH;
  if (depthIdx !== -1) {
    const raw = argv[depthIdx + 1];
    const parsed = parseInt(raw, 10);
    if (raw === undefined || isNaN(parsed) || parsed <= 0) {
      const got = raw === undefined ? 'nothing' : JSON.stringify(raw);
      console.error(`Error: --depth requires a positive integer (got ${got})`);
      process.exit(1);
    }
    depth = parsed;
  }
  return {
    force: argv.includes('--force'),
    json:  argv.includes('--json'),
    help:  argv.includes('--help') || argv.includes('-h'),
    depth,
  };
}

// ─── Process detection ────────────────────────────────────────────────────────

/**
 * Get elapsed time for a PID using `ps -o etime= <pid>`.
 *
 * @param {number} pid
 * @returns {string}  e.g. "01:23" or "2-04:05" — empty string on failure
 */
function getElapsed(pid) {
  const r = spawnSync('ps', ['-o', 'etime=', String(pid)], { encoding: 'utf8', shell: false });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * Detect running orchestrator processes using pgrep.
 * Filters out: this script, pgrep itself, preflight-orchestrator.
 *
 * Returns an array of { pid, cmdline, elapsed } objects.
 * Returns null when pgrep is not available (unexpected on macOS/Linux).
 *
 * @returns {Array<{pid: number, cmdline: string, elapsed: string}>|null}
 */
function detectProcesses() {
  const r = spawnSync('pgrep', ['-fl', 'orchestrate'], { encoding: 'utf8', shell: false });

  // pgrep exits 1 when no matches — that is fine (not an error)
  if (r.error) return null; // pgrep not available

  if (!r.stdout || !r.stdout.trim()) return [];

  const SELF_SCRIPT = path.basename(import.meta.filename);
  const procs = [];

  for (const line of r.stdout.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Filter out this script, pgrep, and preflight-orchestrator
    if (trimmed.includes('kill-orchestrator'))   continue;
    if (trimmed.includes('preflight-orchestrator')) continue;
    if (trimmed.includes('pgrep'))               continue;

    // pgrep -fl output: "<pid> <cmdline>"
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) continue;

    const pid     = parseInt(trimmed.slice(0, spaceIdx), 10);
    const cmdline = trimmed.slice(spaceIdx + 1).trim();
    if (isNaN(pid)) continue;

    const elapsed = getElapsed(pid);
    procs.push({ pid, cmdline: cmdline.slice(0, 120), elapsed });
  }

  return procs;
}

// ─── Process display ──────────────────────────────────────────────────────────

function printProcess(proc) {
  const elapsed = proc.elapsed ? C.dim(` (running ${proc.elapsed})`) : '';
  console.log(`  ${C.yellow('PID ' + proc.pid)}${elapsed}`);
  console.log(`  ${C.dim(proc.cmdline)}`);
}

// ─── Kill logic ───────────────────────────────────────────────────────────────

/**
 * Check if a process is still alive (ESRCH = not found).
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

/**
 * Kill a single process: SIGTERM first, then SIGKILL after 3s if still alive.
 *
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    if (e.code === 'ESRCH') return; // already gone
    throw e;
  }

  // Wait for graceful exit before escalating to SIGKILL
  await new Promise((resolve) => setTimeout(resolve, SIGTERM_GRACE_MS));

  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
}

// ─── Lock file cleanup ────────────────────────────────────────────────────────

/**
 * Scan recent JSONL log files for plan paths (via run_start entries).
 * Returns a set of unique plan directory paths.
 *
 * @param {number} depth  Number of recent log files to scan (default: DEFAULT_LOG_DEPTH)
 * @returns {Set<string>}
 */
function findRecentPlanDirs(depth) {
  const planDirs = new Set();
  if (!fs.existsSync(LOGS_DIR)) return planDirs;

  const logFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-depth); // check last N log files

  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t);
        if (entry.action === 'run_start' && entry.plan) {
          // plan is the plan FILE path; lock is in the plan's parent directory
          const planFile = entry.plan;
          const planDir  = fs.statSync(planFile).isFile()
            ? path.dirname(planFile)
            : planFile;
          // Defence-in-depth: only clean up locks within the workspace root.
          // Prevents a malicious log entry from targeting arbitrary filesystem paths.
          if (!path.resolve(planDir).startsWith(WORKSPACE_ROOT)) continue;
          planDirs.add(planDir);
        }
      } catch { /* malformed / file not found — skip */ }
    }
  }

  return planDirs;
}

/**
 * Remove stale .orchestrator.lock files from recently-used plan directories.
 *
 * @param {number} depth  Passed through to findRecentPlanDirs
 * @returns {string[]}  Paths of lock files removed
 */
function cleanupStaleLocks(depth) {
  const removed = [];
  let planDirs;
  try { planDirs = findRecentPlanDirs(depth); } catch { return removed; }

  for (const dir of planDirs) {
    const lockPath = path.join(dir, '.orchestrator.lock');
    if (fs.existsSync(lockPath)) {
      try {
        fs.rmSync(lockPath);
        removed.push(lockPath);
      } catch { /* ignore permission errors */ }
    }
  }

  return removed;
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

/**
 * Prompt the user for a y/N answer.
 *
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Windows advisory ─────────────────────────────────────────────────────────

function printWindowsAdvisory() {
  console.log('\nAutomatic process detection is not supported on Windows.');
  console.log('To find and stop stale orchestrator processes manually:');
  console.log('  1. Open Task Manager (Ctrl+Shift+Esc) → Details tab');
  console.log('  2. Look for python.exe processes running "orchestrate"');
  console.log('  3. Right-click → End Task');
  console.log('');
  console.log('Alternatively, use PowerShell:');
  console.log('  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*orchestrate*" }');
  console.log('  Stop-Process -Id <PID>');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // ── Windows: advisory only ───────────────────────────────────────────────
  if (IS_WIN) {
    printWindowsAdvisory();
    process.exit(0);
  }

  // ── Detect processes ─────────────────────────────────────────────────────
  const procs = detectProcesses();

  if (procs === null) {
    console.error('pgrep not found — cannot detect orchestrator processes.');
    process.exit(1);
  }

  // ── JSON mode — just list, no kill ────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(procs, null, 2));
    process.exit(0);
  }

  // ── No processes found ────────────────────────────────────────────────────
  if (procs.length === 0) {
    console.log('No orchestrator processes found.');
    process.exit(0);
  }

  // ── List found processes ──────────────────────────────────────────────────
  console.log(`\nFound ${C.bold(String(procs.length))} orchestrator process${procs.length === 1 ? '' : 'es'}:\n`);
  for (const proc of procs) {
    printProcess(proc);
    console.log('');
  }

  // ── Interactive confirmation ──────────────────────────────────────────────
  if (!opts.force) {
    const confirmed = await askYesNo(
      `Kill ${procs.length === 1 ? 'this process' : `all ${procs.length} processes`}? [y/N] `,
    );
    if (!confirmed) {
      console.log(C.dim('Cancelled — no processes killed.'));
      process.exit(1);
    }
  }

  // ── Kill ──────────────────────────────────────────────────────────────────
  console.log('');
  for (const proc of procs) {
    process.stdout.write(`Sending SIGTERM to PID ${proc.pid}…`);
    try {
      await killProcess(proc.pid);
      if (!isAlive(proc.pid)) {
        process.stdout.write(C.green(' killed\n'));
      } else {
        process.stdout.write(C.yellow(' process may still be running\n'));
      }
    } catch (e) {
      process.stdout.write(C.red(` error: ${e.message}\n`));
    }
  }

  // ── Lock file cleanup ─────────────────────────────────────────────────────
  const removed = cleanupStaleLocks(opts.depth);
  if (removed.length > 0) {
    console.log('');
    for (const p of removed) {
      const rel = path.relative(WORKSPACE_ROOT, p);
      console.log(C.dim(`Removed lock: ${rel.startsWith('..') ? p : rel}`));
    }
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
