/**
 * Orchestrator Manager (WP-005, WP-007)
 *
 * Provides two areas of functionality:
 *
 * 1. Queue reader — delegates to `src/gui/queue/get-queue.ts`. The extracted
 *    module holds `getQueue()`, `readQueueFile()`, `isProcessAlive()`,
 *    `getProjectLedgerStatus()`, and all queue-reading internals.
 *
 * 2. Preflight and launch — validates workspace readiness via 7 preflight checks
 *    and optionally spawns a detached orchestrator process (startOrchestrator).
 *
 * Type definitions — delegated to `src/gui/queue/types.ts`:
 *   `RawQueueEntry`, `QueueEntry`, `KillResult`, `PreflightResult`,
 *   `StartResult`, `RunStatus`, `QUEUE_FILENAME`.
 *
 * STDIO discipline: this module never writes to process.stdout.
 *
 * Queue file location: <logsDir>/.run-queue.json
 * Written by: orchestrator Python process (cli.py → run_queue.register/unregister)
 * Read by:    GUI server (this module) — never modifies the queue file
 *
 * Lifecycle state transitions (computed in-memory, never persisted):
 *   pending + alive  + stage activity  + no project  → effectiveStatus: 'started'
 *   pending + alive  + no stage activity + no project → effectiveStatus: 'pending'
 *   pending + alive  + project exists               → effectiveStatus: 'started'
 *   pending + dead   + no project                   → effectiveStatus: 'dead'
 *   pending + dead   + project exists               → effectiveStatus: 'started'
 *   started + synthesis_generated true              → excluded from result (AC-6)
 *
 * @see {@link computeEffectiveStatus} — canonical implementation of the transition rules above.
 */

import { readFile, readdir, writeFile, unlink, rename, stat } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import { planFolderBasename } from '../src/utils/path-validator.js';
import { computeEffectiveStatus } from '../src/gui/queue/compute-effective-status.js';
import { readQueueFile, isProcessAlive, getProjectLedgerStatus } from '../src/gui/queue/get-queue.js';
import { QUEUE_FILENAME, type RawQueueEntry, type KillResult, type PreflightResult, type StartResult, type RunStatus } from '../src/gui/queue/types.js';

// Re-exports for backward compatibility with callers that import from this module.
export { formatProgressEntry, type ProgressResolution } from '../src/gui/queue/resolve-progress.js';
export { type EffectiveStatus } from '../src/gui/queue/compute-effective-status.js';
export { QUEUE_FILENAME, type RawQueueEntry, type QueueEntry, type KillResult, type PreflightResult, type StartResult, type RunStatus } from '../src/gui/queue/types.js';
export { getQueue } from '../src/gui/queue/get-queue.js';

// ---------------------------------------------------------------------------
// Queue mutation helpers
// ---------------------------------------------------------------------------

/** Milliseconds to wait after SIGTERM before escalating to SIGKILL. */
const SIGTERM_WAIT_MS = 3_000;

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomically writes `entries` back to the queue file.
 *
 * Writes to a `.tmp` sibling first, then renames it over the real file.
 * This prevents partial-write corruption if the process is killed mid-write.
 *
 * @remarks
 * **Locking parity gap:** The Python orchestrator (`run_queue.py`) acquires
 * `.run-queue.lock` before reading or writing the queue file. This TypeScript
 * writer relies solely on the atomic rename and does **not** acquire the same
 * lock. If a Python write operation overlaps with a TypeScript write (e.g.,
 * during a handoff where both processes are briefly active), a race condition
 * could cause one writer to overwrite the other's changes. The risk is low in
 * normal operation — the GUI calls this function only when no orchestrator
 * process is running — but the asymmetry should be resolved if concurrent
 * writes become possible in future designs.
 */
async function writeQueueFileAtomic(logsDir: string, entries: RawQueueEntry[]): Promise<void> {
  const queuePath = join(logsDir, QUEUE_FILENAME);
  const tmpPath   = `${queuePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entries), 'utf-8');
  await rename(tmpPath, queuePath);
}

/**
 * Removes the `.orchestrator.lock` file from the plan's parent directory.
 * Silently succeeds if the file is already absent.
 */
async function removeLockFile(planPath: string): Promise<void> {
  const lockPath = join(dirname(planPath), '.orchestrator.lock');
  try {
    await unlink(lockPath);
  } catch {
    // File already removed or never created — not an error.
  }
}

/**
 * Sends SIGTERM to `pid`, waits {@link SIGTERM_WAIT_MS} ms, then sends
 * SIGKILL if the process is still alive.
 *
 * If SIGTERM throws `ESRCH` (the process died in the TOCTOU window between
 * the liveness check and signal delivery), the function returns early without
 * re-throwing — the process is already gone and the caller can proceed with
 * queue and lock-file cleanup.
 */
async function terminateProcess(pid: number): Promise<void> {
  if (pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw err;
  }
  await sleep(SIGTERM_WAIT_MS);
  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// Public API — kill and dismiss
// ---------------------------------------------------------------------------

/**
 * Terminates the orchestrator process for a pending queue entry and removes
 * the entry from the queue file.
 *
 * Only operates on effectively-pending entries (`alive && no project in ledger`).
 * Returns `{ killed: false }` without throwing when:
 *   - The entry is not found.
 *   - The entry's effective status is `started` or `dead`.
 *
 * When `killed === true`, the procedure performed is:
 *   1. SIGTERM sent to the process.
 *   2. Wait up to {@link SIGTERM_WAIT_MS} ms.
 *   3. SIGKILL sent if the process is still alive after the wait.
 *   4. Entry removed from the queue file on disk.
 *   5. `.orchestrator.lock` file removed from the plan directory.
 *
 * @param params.id          - Queue entry ID to kill.
 * @param params.logsDir     - Absolute path to the orchestrator logs directory.
 * @param params.ledgerRoot  - Absolute path to the central ledger root.
 */
export async function killQueueEntry(params: {
  id: string;
  logsDir: string;
  ledgerRoot: string;
}): Promise<KillResult> {
  const { id, logsDir, ledgerRoot } = params;

  const entries    = await readQueueFile(logsDir);
  const entryIndex = entries.findIndex((e) => e.id === id);

  if (entryIndex === -1) {
    return { killed: false };
  }

  const entry = entries[entryIndex]!;

  // Recompute effective status. Intentionally omits the hasLogActivity argument
  // (defaults to false) so kill eligibility uses the conservative two-factor rule:
  // only alive+no-project entries are 'pending'. getQueue() passes hasStageActivity
  // for display purposes but kill must not promote stale entries.
  const alive = isProcessAlive(entry.pid);
  const { exists: projectExists } = await getProjectLedgerStatus(ledgerRoot, entry.expectedSlug);
  const effectiveStatus = computeEffectiveStatus(alive, projectExists);

  if (effectiveStatus !== 'pending') {
    return { killed: false };
  }

  // 1–3: Terminate the process.
  await terminateProcess(entry.pid);

  // 4: Remove from the queue file.
  const updated = entries.filter((_, i) => i !== entryIndex);
  await writeQueueFileAtomic(logsDir, updated);

  // 5: Remove the per-plan lock file.
  await removeLockFile(entry.planPath);

  return { killed: true };
}

/**
 * Removes a dead queue entry from the queue file on disk.
 *
 * Only operates on effectively-dead entries (`!alive && no project in ledger`).
 * Returns without throwing when:
 *   - The entry is not found.
 *   - The entry's effective status is `pending` or `started`.
 *
 * @param params.id          - Queue entry ID to dismiss.
 * @param params.logsDir     - Absolute path to the orchestrator logs directory.
 * @param params.ledgerRoot  - Absolute path to the central ledger root.
 */
export async function dismissQueueEntry(params: {
  id: string;
  logsDir: string;
  ledgerRoot: string;
}): Promise<void> {
  const { id, logsDir, ledgerRoot } = params;

  const entries    = await readQueueFile(logsDir);
  const entryIndex = entries.findIndex((e) => e.id === id);

  if (entryIndex === -1) {
    return;
  }

  const entry = entries[entryIndex]!;

  // Recompute effective status. Intentionally omits the hasLogActivity argument
  // (defaults to false) — dismiss eligibility uses the same conservative rule as kill.
  const alive = isProcessAlive(entry.pid);
  const { exists: projectExists } = await getProjectLedgerStatus(ledgerRoot, entry.expectedSlug);
  const effectiveStatus = computeEffectiveStatus(alive, projectExists);

  if (effectiveStatus !== 'dead') {
    return;
  }

  // Remove from the queue file.
  const updated = entries.filter((_, i) => i !== entryIndex);
  await writeQueueFileAtomic(logsDir, updated);
}

// ---------------------------------------------------------------------------
// Preflight helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the `orchestrate` binary path within the orchestrator venv.
 * Uses `Scripts/orchestrate.exe` on Windows, `bin/orchestrate` elsewhere.
 */
function resolveOrchestrateBin(workspaceRoot: string): string {
  const subdir = process.platform === 'win32' ? 'Scripts' : 'bin';
  const ext    = process.platform === 'win32' ? '.exe'    : '';
  return join(workspaceRoot, 'orchestrator', '.venv', subdir, `orchestrate${ext}`);
}

/**
 * Validates the plan folder basename matches `YYYY-MM-DD-{project-name}`.
 * Wraps planFolderBasename() so any thrown error becomes a failed check.
 */
function checkPlanBasename(resolvedPlan: string): PreflightResult {
  try {
    planFolderBasename(dirname(resolvedPlan));
    return { name: 'plan-basename', pass: true, detail: 'Plan folder follows naming convention' };
  } catch {
    return {
      name:   'plan-basename',
      pass:   false,
      detail: 'Plan path does not follow naming convention',
      fix:    'The plan folder must match YYYY-MM-DD-{project-name} (e.g. 2026-05-05-my-feature)',
    };
  }
}

/** Checks that the plan file exists on disk. */
async function checkPlanFile(resolvedPlan: string): Promise<PreflightResult> {
  try {
    await stat(resolvedPlan);
    return {
      name:   'plan-file',
      pass:   true,
      detail: `Plan file found: ${basename(resolvedPlan)}`,
    };
  } catch {
    return {
      name:   'plan-file',
      pass:   false,
      detail: `Plan file not found: ${resolvedPlan}`,
    };
  }
}

/** Checks that the orchestrator venv exists and contains the `orchestrate` binary. */
async function checkVenv(workspaceRoot: string): Promise<PreflightResult> {
  const venvDir = join(workspaceRoot, 'orchestrator', '.venv');
  try {
    await stat(venvDir);
  } catch {
    return {
      name:   'venv',
      pass:   false,
      detail: '.venv directory not found',
      fix:    'node scripts/cli.js setup --components orchestrator',
    };
  }

  const binPath = resolveOrchestrateBin(workspaceRoot);
  try {
    await stat(binPath);
  } catch {
    return {
      name:   'venv',
      pass:   false,
      detail: 'orchestrate binary not found in .venv',
      fix:    'node scripts/cli.js setup --components orchestrator --force',
    };
  }

  return { name: 'venv', pass: true, detail: 'orchestrate binary found' };
}

/**
 * Parses `orchestrator/.env` and returns key→value pairs (trimmed, comments and empty
 * lines excluded). Returns `null` when the file does not exist or cannot be read.
 */
async function parseEnvFile(workspaceRoot: string): Promise<Record<string, string> | null> {
  const envFile = join(workspaceRoot, 'orchestrator', '.env');
  let content: string;
  try {
    content = await readFile(envFile, 'utf-8');
  } catch {
    return null;
  }
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
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

/** Checks that `orchestrator/.env` exists and contains at least one API key. */
async function checkEnv(workspaceRoot: string): Promise<PreflightResult> {
  const vars = await parseEnvFile(workspaceRoot);
  if (vars === null) {
    return {
      name:   'env',
      pass:   false,
      detail: '.env file not found',
      fix:    'cp orchestrator/.env.example orchestrator/.env  # then edit it',
    };
  }
  if (!vars['ANTHROPIC_API_KEY'] && !vars['GOOGLE_API_KEY']) {
    return {
      name:   'env',
      pass:   false,
      detail: 'No API key set in .env (need ANTHROPIC_API_KEY or GOOGLE_API_KEY)',
      fix:    'Set the appropriate API key in orchestrator/.env',
    };
  }
  return { name: 'env', pass: true, detail: 'API key configured' };
}

/** Live-validates an Anthropic API key via GET /v1/models — no tokens consumed. */
async function checkAnthropicKey(apiKey: string): Promise<PreflightResult> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
      },
    });
    if (res.ok) {
      return { name: 'anthropic-key', pass: true, detail: 'key accepted by Anthropic API' };
    }
    const hint = res.status === 401 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name:   'anthropic-key',
      pass:   false,
      detail: `Anthropic rejected key: ${hint}`,
      fix:    'Update ANTHROPIC_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name:   'anthropic-key',
      pass:   false,
      detail: `Anthropic key check failed: ${msg}`,
    };
  }
}

/** Live-validates a Google AI Studio API key via GET /v1beta/models — no tokens consumed. */
async function checkGoogleKey(apiKey: string): Promise<PreflightResult> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      return { name: 'google-key', pass: true, detail: 'key accepted by Google AI Studio API' };
    }
    const hint =
      res.status === 400 || res.status === 403 ? 'invalid or expired key' : `HTTP ${res.status}`;
    return {
      name:   'google-key',
      pass:   false,
      detail: `Google rejected key: ${hint}`,
      fix:    'Update GOOGLE_API_KEY in orchestrator/.env',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name:   'google-key',
      pass:   false,
      detail: `Google key check failed: ${msg}`,
    };
  }
}

/**
 * Recursively finds the latest modification time among all files under `dir`.
 * Returns `-Infinity` when the directory is empty or unreadable.
 */
async function latestMtimeInDir(dir: string): Promise<number> {
  let latest = -Infinity;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return latest;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await latestMtimeInDir(full));
    } else {
      try {
        const s = await stat(full);
        latest = Math.max(latest, s.mtimeMs);
      } catch {
        // Skip unreadable files.
      }
    }
  }
  return latest;
}

/** Checks that `mcp-server/dist/index.js` exists and is up to date with `mcp-server/src/`. */
async function checkMcpDist(workspaceRoot: string): Promise<PreflightResult> {
  const sentinel = join(workspaceRoot, 'mcp-server', 'dist', 'index.js');
  const srcDir   = join(workspaceRoot, 'mcp-server', 'src');

  let sentinelMtime: number;
  try {
    const s = await stat(sentinel);
    sentinelMtime = s.mtimeMs;
  } catch {
    return {
      name:   'mcp-dist',
      pass:   false,
      detail: 'mcp-server/dist/index.js not found',
      fix:    'cd mcp-server && npm run build',
    };
  }

  const srcLatest = await latestMtimeInDir(srcDir);
  if (srcLatest > sentinelMtime) {
    return {
      name:   'mcp-dist',
      pass:   false,
      detail: 'mcp-server/dist is stale (source is newer)',
      fix:    'cd mcp-server && npm run build',
    };
  }

  return { name: 'mcp-dist', pass: true, detail: 'mcp-server/dist is up to date' };
}

/**
 * Checks whether the given plan is already registered in the run queue.
 * Reads the queue file rather than querying the OS process table, so
 * multiple concurrent plans (different slugs) are handled correctly.
 */
async function checkNoConflict(resolvedPlan: string, logsDir: string): Promise<PreflightResult> {
  const entries = await readQueueFile(logsDir);
  const conflict = entries.find((e) => resolve(e.planPath) === resolvedPlan);

  if (conflict) {
    return {
      name:   'no-conflict',
      pass:   false,
      detail: `Plan is already registered in the run queue (PID ${conflict.pid})`,
      fix:    'Kill or dismiss the existing queue entry first',
    };
  }

  return { name: 'no-conflict', pass: true, detail: 'No existing run for this plan' };
}

// ---------------------------------------------------------------------------
// Public API — preflight and start
// ---------------------------------------------------------------------------

/**
 * Computes the deterministic status-file basename for a given absolute plan
 * path. The filename is a SHA-1 hex digest (first 16 chars) of the resolved
 * plan path so that two plans with identical folder names in different
 * repositories never collide in the shared `orchestrator/logs/` directory.
 *
 * Python uses the identical algorithm:
 *   `hashlib.sha1(str(plan_path).encode('utf-8')).hexdigest()[:16] + '-run-status.json'`
 */
export function runStatusFilename(resolvedPlanPath: string): string {
  const hash = createHash('sha1').update(resolvedPlanPath).digest('hex').slice(0, 16);
  return `${hash}-run-status.json`;
}

// ---------------------------------------------------------------------------
// Run-status tombstone
// ---------------------------------------------------------------------------

/**
 * Reads `<logsDir>/{runStatusFilename}` and returns its parsed content,
 * or `null` when the file does not exist yet (run still in progress or
 * never started).
 *
 * The filename must be the value returned by {@link runStatusFilename};
 * it encodes a hash of the absolute plan path so different plans with the
 * same folder basename in different repositories never collide.
 *
 * Fail-safe: any I/O or parse error returns `null`.
 */
export async function getRunStatus(
  logsDir:        string,
  statusFilename: string,
): Promise<RunStatus | null> {
  const statusPath = join(logsDir, statusFilename);
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    return {
      slug:        typeof d['slug']        === 'string' ? d['slug']        : statusFilename.split('-run-status.json')[0],
      result:      d['result'] === 'SUCCESS' ? 'SUCCESS'                   : 'ERROR',
      error:       typeof d['error']       === 'string' ? d['error']       : null,
      logFilename: typeof d['logFilename'] === 'string' ? d['logFilename'] : '',
      durationS:   typeof d['durationS']  === 'number' ? d['durationS']   : null,
    };
  } catch {
    return null;
  }
}

/**
 * Runs preflight checks and optionally spawns a detached orchestrator process.
 *
 * Preflight checks run unconditionally for environment state (venv, env,
 * mcp-dist). Path-dependent checks (path-prefix, plan-basename, plan-file,
 * no-conflict) run only when the path is determined to be inside the
 * workspace root.
 *
 * - `dryRun: true`  → returns all check results without spawning.
 * - Any check fails → returns results with `started: false`.
 * - All pass + not dry-run → spawns detached `orchestrate` process,
 *   returns `started: true` and the `pid`.
 *
 * @param planPath       - Absolute path to the plan `.md` file.
 * @param workspaceRoot  - Absolute path to the workspace root directory.
 * @param dryRun         - When `true`, skip spawning even if all checks pass.
 */
export async function startOrchestrator(
  planPath:      string,
  workspaceRoot: string,
  dryRun         = false,
): Promise<StartResult> {
  const resolvedPlan = resolve(planPath);
  const resolvedRoot = resolve(workspaceRoot);

  const checks: PreflightResult[] = [];

  // Run all checks in parallel — plan path is resolved above, no traversal risk.
  const [planChecks, envChecks, keyChecks] = await Promise.all([
    Promise.all([
      Promise.resolve(checkPlanBasename(resolvedPlan)),
      checkPlanFile(resolvedPlan),
      checkNoConflict(resolvedPlan, join(resolvedRoot, 'orchestrator', 'logs')),
    ]),
    Promise.all([checkVenv(resolvedRoot), checkEnv(resolvedRoot), checkMcpDist(resolvedRoot)]),
    parseEnvFile(resolvedRoot).then((vars) => {
      if (!vars) return [] as PreflightResult[];
      const pending: Promise<PreflightResult>[] = [];
      if (vars['ANTHROPIC_API_KEY']) pending.push(checkAnthropicKey(vars['ANTHROPIC_API_KEY']));
      if (vars['GOOGLE_API_KEY'])    pending.push(checkGoogleKey(vars['GOOGLE_API_KEY']));
      return Promise.all(pending);
    }),
  ]);

  checks.push(...planChecks, ...envChecks, ...keyChecks);

  // Dry-run: return results without spawning.
  if (dryRun) {
    return { checks, started: false };
  }

  // Any failure → do not spawn.
  if (checks.some((c) => !c.pass)) {
    return { checks, started: false };
  }

  // All checks passed — spawn a detached orchestrator process.
  const bin            = resolveOrchestrateBin(resolvedRoot);
  const statusFilename = runStatusFilename(resolvedPlan);
  const child = spawn(bin, [resolvedPlan], {
    detached: true,
    stdio:    ['ignore', 'ignore', 'ignore'],
    env:      { ...process.env, PYTHONUTF8: '1' },
  });
  child.unref();

  return { checks, started: true, pid: child.pid, runStatusFilename: statusFilename };
}
