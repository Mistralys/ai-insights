/**
 * scripts/lib/ctx-generate.js
 *
 * Non-destructive `ctx generate` orchestration, replacing the previous
 * `cmdCtxGenerate` in `scripts/cli.js`, which deleted `.context/` via
 * `rmSync()` *before* validating arguments or running `ctx` — a `ctx`
 * failure, or an unrelated flag typo, left `.context/` deleted with nothing
 * to replace it.
 *
 * The replacement generates into a staging directory (`.context.incoming/`,
 * gitignored so `ctx`'s own source scan skips it) and only swaps it in for
 * `.context/` after a successful run, via a rename-based swap that moves the
 * previous `.context/` to `.context.previous/` first — so any failure during
 * generation or the swap itself leaves `.context/` exactly as it was. A
 * `--check` mode reuses the same generation path to compare staging output
 * against `.context/` without ever writing to it, so the real run and the
 * check can never drift (they are, literally, the same code path up to the
 * final write).
 *
 * This module never prints and never calls `process.exit` — callers (today,
 * `scripts/cli.js`'s `cmdCtxGenerate`) map the returned structured result to
 * their own message texts and exit codes. This mirrors the
 * "structured result, caller owns the exit" pattern already used by
 * `scripts/lib/mcp-dist-freshness.js` (`ensureMcpDistFresh()`) and
 * `scripts/lib/build-checks.js` (`runBuildChecks()`/`resolveExitCode()`).
 *
 * Every filesystem move/removal goes through `renameWithRetry()` /
 * `removeWithRetry()`, which retry transient `EPERM`/`EBUSY`/`EACCES`
 * failures (Windows file-locking races) up to `maxRetries` times with a
 * `retryDelay`-ms pause between attempts, per the Cross-Platform Policy.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export const INCOMING_DIR_NAME = '.context.incoming';
export const PREVIOUS_DIR_NAME = '.context.previous';
export const OUTPUT_DIR_NAME = '.context';
export const GENERATED_AT_FILENAME = 'generated-at.txt';
export const CLAUDE_MD_HEADER =
  '<!-- NOTE: This file is generated automatically from AGENTS.md whenever CTX documents are updated -->\n\n';

const RETRYABLE_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 100;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the arguments a caller intends to forward to `ctx generate`.
 *
 * - `--check` is consumed (not forwarded) and reported via `check: true`.
 * - Any command-owned output-directory flag (`-w`, `-w<value>`,
 *   `--work-dir`, `--work-dir=<value>`) is rejected: this module always
 *   controls `-w` itself (it points `ctx` at the staging directory), so a
 *   caller-supplied one would silently make the staged-swap safety guarantee
 *   meaningless.
 * - Every other argument is passed through unchanged and in order.
 *
 * Performs no filesystem access — safe to call before any I/O.
 *
 * @param {string[]} args
 * @returns {{ ok: true, check: boolean, ctxArgs: string[] } | { ok: false, reason: 'owns-work-dir', flag: string }}
 */
export function parseCtxArgs(args) {
  const ctxArgs = [];
  let check = false;

  for (const arg of args) {
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '-w' || arg === '--work-dir' || arg.startsWith('--work-dir=')) {
      return { ok: false, reason: 'owns-work-dir', flag: arg };
    }
    if (arg.startsWith('-w') && arg !== '-w') {
      // Short-flag-with-attached-value form, e.g. "-wout".
      return { ok: false, reason: 'owns-work-dir', flag: arg };
    }
    ctxArgs.push(arg);
  }

  return { ok: true, check, ctxArgs };
}

/**
 * Renames `fromPath` to `toPath`, retrying transient Windows file-locking
 * errors (`EPERM`/`EBUSY`/`EACCES`) up to `maxRetries` times.
 *
 * @param {string} fromPath
 * @param {string} toPath
 * @param {object} [options]
 * @param {(from: string, to: string) => void} [options.renameFn] - injectable in place of `fs.renameSync`
 * @param {(ms: number) => Promise<void>} [options.sleepFn] - injectable in place of a real delay
 * @param {number} [options.maxRetries]
 * @param {number} [options.retryDelay] - ms between attempts
 * @returns {Promise<{ ok: true } | { ok: false, error: Error }>}
 */
export async function renameWithRetry(
  fromPath,
  toPath,
  { renameFn = fs.renameSync, sleepFn = defaultSleep, maxRetries = DEFAULT_MAX_RETRIES, retryDelay = DEFAULT_RETRY_DELAY_MS } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      renameFn(fromPath, toPath);
      return { ok: true };
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_ERROR_CODES.has(err && err.code) || attempt === maxRetries) {
        break;
      }
      await sleepFn(retryDelay);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Recursively removes `dirPath`, retrying transient Windows file-locking
 * errors (`EPERM`/`EBUSY`/`EACCES`) up to `maxRetries` times. A missing
 * `dirPath` is treated as already-removed (`{ ok: true }`).
 *
 * @param {string} dirPath
 * @param {object} [options]
 * @param {(dir: string, opts: object) => void} [options.rmFn] - injectable in place of `fs.rmSync`
 * @param {(ms: number) => Promise<void>} [options.sleepFn]
 * @param {number} [options.maxRetries]
 * @param {number} [options.retryDelay]
 * @returns {Promise<{ ok: true } | { ok: false, error: Error }>}
 */
export async function removeWithRetry(
  dirPath,
  { rmFn = fs.rmSync, sleepFn = defaultSleep, maxRetries = DEFAULT_MAX_RETRIES, retryDelay = DEFAULT_RETRY_DELAY_MS } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      rmFn(dirPath, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_ERROR_CODES.has(err && err.code) || attempt === maxRetries) {
        break;
      }
      await sleepFn(retryDelay);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Recovers from an interrupted prior run that left `.context.incoming/`
 * and/or `.context.previous/` on disk (a crash or kill mid-generate or
 * mid-swap). Idempotent — a no-op when neither directory is present.
 *
 * Rule: if `.context.previous/` exists and `.context/` is missing, the swap
 * was interrupted after moving `.context/` aside but before moving
 * `.context.incoming/` into place — restore `.context/` from
 * `.context.previous/`. If `.context/` already exists, the swap had already
 * completed (or never started) and `.context.previous/` is simply stale —
 * remove it. `.context.incoming/`, if present, is always removed: its
 * content is never partially valid to keep.
 *
 * In `mode: 'check'`, only a stale `.context.incoming/` is removed (staging
 * is about to be reused) — `.context.previous/` and `.context/` are never
 * renamed or removed, since `--check` exists only to observe and must not
 * change state a concurrent or later generate run relies on.
 *
 * Every `{ ok: false }` result returned by an injected retry helper is
 * recorded in `failures` with the operation it was attempting
 * (`'restore'`, `'remove-previous'` or `'remove-incoming'`) and the path
 * involved, so the caller can abort generation rather than proceed with a
 * staging directory it could not fully clear.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {'generate' | 'check'} [options.mode]
 * @param {(from: string, to: string, opts?: object) => Promise<{ ok: true } | { ok: false, error: Error }>} [options.renameWithRetryFn]
 * @param {(dir: string, opts?: object) => Promise<{ ok: true } | { ok: false, error: Error }>} [options.removeWithRetryFn]
 * @returns {Promise<{ recovered: boolean, restoredOutput: boolean, failures: Array<{ op: 'restore' | 'remove-previous' | 'remove-incoming', path: string, error: Error }> }>}
 */
export async function recoverInterruptedSwap({
  workspaceRoot,
  mode = 'generate',
  renameWithRetryFn = renameWithRetry,
  removeWithRetryFn = removeWithRetry,
}) {
  const outputDir = path.join(workspaceRoot, OUTPUT_DIR_NAME);
  const incomingDir = path.join(workspaceRoot, INCOMING_DIR_NAME);
  const previousDir = path.join(workspaceRoot, PREVIOUS_DIR_NAME);

  let recovered = false;
  let restoredOutput = false;
  const failures = [];

  if (mode !== 'check' && fs.existsSync(previousDir)) {
    recovered = true;
    if (!fs.existsSync(outputDir)) {
      const restored = await renameWithRetryFn(previousDir, outputDir);
      if (restored.ok) {
        restoredOutput = true;
      } else {
        failures.push({ op: 'restore', path: previousDir, error: restored.error });
      }
    } else {
      const removedPrevious = await removeWithRetryFn(previousDir);
      if (!removedPrevious.ok) {
        failures.push({ op: 'remove-previous', path: previousDir, error: removedPrevious.error });
      }
    }
  }

  if (fs.existsSync(incomingDir)) {
    recovered = true;
    const removedIncoming = await removeWithRetryFn(incomingDir);
    if (!removedIncoming.ok) {
      failures.push({ op: 'remove-incoming', path: incomingDir, error: removedIncoming.error });
    }
  }

  return { recovered, restoredOutput, failures };
}

/**
 * Classifies a `swap-failed` result's `previousOutput` value from the
 * *observed* existence of `.context/` and `.context.previous/` after the
 * failing branch's own cleanup — never from the failing rename's reported
 * result, since a rename reported as failed may still have taken effect.
 *
 * @param {'move-aside' | 'move-in'} branch
 * @param {{ output: boolean, previous: boolean }} observed
 * @returns {'untouched' | 'restored' | 'preserved-in-previous' | 'unknown'}
 */
function classifySwapFailure(branch, observed) {
  const { output, previous } = observed;
  if (branch === 'move-aside') {
    return output && !previous ? 'untouched' : 'unknown';
  }
  // branch === 'move-in'
  if (output && !previous) return 'restored';
  if (!output && previous) return 'preserved-in-previous';
  return 'unknown';
}

/**
 * Recursively compares two directory trees by relative path and file
 * content. Returns the sorted list of relative paths (POSIX-separated) that
 * differ — present in only one tree, or present in both with different
 * content.
 *
 * A missing directory (either argument) is treated as empty rather than
 * throwing: every path collected from the other tree is then reported as a
 * diff. This is what lets `--check` report `.context/` as entirely stale
 * when `.context.previous/` exists but `.context/` is missing (an
 * interrupted swap check never restores it — see `recoverInterruptedSwap`'s
 * `'check'` mode).
 *
 * @param {string} dirA
 * @param {string} dirB
 * @returns {string[]}
 */
export function compareTrees(dirA, dirB) {
  const diffs = new Set();

  function collect(dir, base) {
    const relPaths = new Set();
    if (!fs.existsSync(dir)) return relPaths;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) {
        for (const child of collect(full, rel)) relPaths.add(child);
      } else if (entry.isFile()) {
        relPaths.add(rel);
      }
    }
    return relPaths;
  }

  const pathsA = collect(dirA, '');
  const pathsB = collect(dirB, '');
  const allPaths = new Set([...pathsA, ...pathsB]);

  for (const rel of allPaths) {
    const inA = pathsA.has(rel);
    const inB = pathsB.has(rel);
    if (!inA || !inB) {
      diffs.add(rel);
      continue;
    }
    const contentA = fs.readFileSync(path.join(dirA, rel));
    const contentB = fs.readFileSync(path.join(dirB, rel));
    if (!contentA.equals(contentB)) {
      diffs.add(rel);
    }
  }

  return [...diffs].sort().map((p) => p.split(path.sep).join('/'));
}

/**
 * Runs `ctx generate -w <stagingDir> ...ctxArgs` and, on success, normalizes
 * the generated Markdown via `normalizeFn`. Never touches `.context/`.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.stagingDir - absolute path `ctx` should write into
 * @param {string[]} options.ctxArgs
 * @param {typeof spawnSync} [options.spawn] - injectable in place of the real `child_process.spawnSync`
 * @param {boolean} [options.shell] - forwarded to `spawn` as the `shell` option (Windows needs `true`)
 * @param {(stagingDir: string) => void} [options.normalizeFn] - injectable Markdown-normalization step
 * @returns {{ ok: true } | { ok: false, reason: 'ctx-missing' } | { ok: false, reason: 'ctx-failed', status: number | null }}
 */
export function generateContext({ workspaceRoot, stagingDir, ctxArgs, spawn = spawnSync, shell = false, normalizeFn }) {
  const result = spawn('ctx', ['generate', '-w', stagingDir, ...ctxArgs], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell,
  });

  if (result.error && result.error.code === 'ENOENT') {
    return { ok: false, reason: 'ctx-missing' };
  }
  if (result.status !== 0) {
    return { ok: false, reason: 'ctx-failed', status: result.status ?? 1 };
  }

  if (normalizeFn) {
    normalizeFn(stagingDir);
  }

  return { ok: true };
}

/**
 * Computes the CLAUDE.md content that should be regenerated from
 * `AGENTS.md`, or `null` when `AGENTS.md` is absent.
 *
 * @param {string} workspaceRoot
 * @returns {string | null}
 */
export function computeClaudeMdContent(workspaceRoot) {
  const agentsMdPath = path.join(workspaceRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    return null;
  }
  return CLAUDE_MD_HEADER + fs.readFileSync(agentsMdPath, 'utf8');
}

/**
 * @typedef {
 *   | { ok: false, reason: 'owns-work-dir', flag: string }
 *   | { ok: false, reason: 'ctx-missing' }
 *   | { ok: false, reason: 'ctx-failed', status: number | null }
 *   | { ok: false, reason: 'recovery-failed', failures: Array<{ op: 'restore' | 'remove-previous' | 'remove-incoming', path: string, error: Error }> }
 *   | { ok: false, reason: 'swap-failed', error: Error, previousOutput: 'none' | 'untouched' | 'restored' | 'preserved-in-previous' | 'unknown', restoreError?: Error, observed?: { output: boolean, previous: boolean } }
 *   | { ok: true, mode: 'generate', agentsMdMissing: boolean, leftoverPrevious?: true }
 *   | { ok: true, mode: 'check', fresh: true }
 *   | { ok: true, mode: 'check', fresh: false, diffs: string[] }
 * } RunCtxGenerateResult
 */

/**
 * Orchestrates a full `ctx generate` (or `--check`) run: recovers from any
 * interrupted prior run, validates arguments, generates into a staging
 * directory, and either swaps it in for `.context/` (real run) or compares
 * it against `.context/` without writing anything (`--check`).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string[]} options.args - raw arguments as the caller received them (may include `--check`)
 * @param {typeof spawnSync} [options.spawn]
 * @param {boolean} [options.shell]
 * @param {(stagingDir: string) => void} [options.normalizeFn]
 * @param {(from: string, to: string, opts?: object) => Promise<{ ok: true } | { ok: false, error: Error }>} [options.renameWithRetryFn]
 * @param {(dir: string, opts?: object) => Promise<{ ok: true } | { ok: false, error: Error }>} [options.removeWithRetryFn]
 * @param {() => string} [options.now] - injectable clock for `generated-at.txt`
 * @returns {Promise<RunCtxGenerateResult>}
 */
export async function runCtxGenerate({
  workspaceRoot,
  args,
  spawn = spawnSync,
  shell = false,
  normalizeFn,
  renameWithRetryFn = renameWithRetry,
  removeWithRetryFn = removeWithRetry,
  now = () => new Date().toISOString(),
}) {
  const parsed = parseCtxArgs(args);
  if (!parsed.ok) {
    return parsed;
  }

  const recovery = await recoverInterruptedSwap({
    workspaceRoot,
    mode: parsed.check ? 'check' : 'generate',
    renameWithRetryFn,
    removeWithRetryFn,
  });
  if (recovery.failures.length > 0) {
    return { ok: false, reason: 'recovery-failed', failures: recovery.failures };
  }

  const outputDir = path.join(workspaceRoot, OUTPUT_DIR_NAME);
  const incomingDir = path.join(workspaceRoot, INCOMING_DIR_NAME);
  const previousDir = path.join(workspaceRoot, PREVIOUS_DIR_NAME);
  const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');

  const generated = generateContext({
    workspaceRoot,
    stagingDir: incomingDir,
    ctxArgs: parsed.ctxArgs,
    spawn,
    shell,
    normalizeFn,
  });

  if (!generated.ok) {
    await removeWithRetryFn(incomingDir);
    return generated;
  }

  if (parsed.check) {
    // generated-at.txt is expected to differ by timestamp on every real run —
    // comparing it would make --check report "stale" even when nothing else
    // changed, so it's excluded from the freshness comparison.
    const diffs = compareTrees(incomingDir, outputDir).filter((p) => p !== GENERATED_AT_FILENAME);
    const expectedClaudeMd = computeClaudeMdContent(workspaceRoot);
    if (expectedClaudeMd !== null) {
      const actualClaudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : null;
      if (actualClaudeMd !== expectedClaudeMd) {
        diffs.push('CLAUDE.md');
      }
    }
    await removeWithRetryFn(incomingDir);
    return diffs.length === 0 ? { ok: true, mode: 'check', fresh: true } : { ok: true, mode: 'check', fresh: false, diffs: diffs.sort() };
  }

  // Real run — write generated-at.txt into staging, then swap.
  fs.writeFileSync(path.join(incomingDir, GENERATED_AT_FILENAME), now() + '\n');

  const outputExisted = fs.existsSync(outputDir);
  if (outputExisted) {
    const movedAside = await renameWithRetryFn(outputDir, previousDir);
    if (!movedAside.ok) {
      await removeWithRetryFn(incomingDir);
      // Classify from what's actually on disk after cleanup — the failing
      // rename's own result is not trusted to describe the effect it had.
      const observed = { output: fs.existsSync(outputDir), previous: fs.existsSync(previousDir) };
      const previousOutput = classifySwapFailure('move-aside', observed);
      const result = { ok: false, reason: 'swap-failed', error: movedAside.error, previousOutput };
      if (previousOutput === 'unknown') {
        result.observed = observed;
      }
      return result;
    }
  }

  const movedIn = await renameWithRetryFn(incomingDir, outputDir);
  if (!movedIn.ok) {
    // Restore the original .context/ (if there was one) and leave no
    // transient directories behind.
    let restoreError;
    if (outputExisted) {
      const restored = await renameWithRetryFn(previousDir, outputDir);
      if (!restored.ok) {
        restoreError = restored.error;
      }
    }
    await removeWithRetryFn(incomingDir);

    if (!outputExisted) {
      return { ok: false, reason: 'swap-failed', error: movedIn.error, previousOutput: 'none' };
    }

    const observed = { output: fs.existsSync(outputDir), previous: fs.existsSync(previousDir) };
    const previousOutput = classifySwapFailure('move-in', observed);
    const result = { ok: false, reason: 'swap-failed', error: movedIn.error, previousOutput };
    if (restoreError) {
      result.restoreError = restoreError;
    }
    if (previousOutput === 'unknown') {
      result.observed = observed;
    }
    return result;
  }

  let leftoverPrevious = false;
  if (outputExisted) {
    const removedPrevious = await removeWithRetryFn(previousDir);
    if (!removedPrevious.ok) {
      leftoverPrevious = true;
    }
  }

  const agentsMdContent = computeClaudeMdContent(workspaceRoot);
  const agentsMdMissing = agentsMdContent === null;
  if (!agentsMdMissing) {
    fs.writeFileSync(claudeMdPath, agentsMdContent, 'utf8');
  }

  return leftoverPrevious
    ? { ok: true, mode: 'generate', agentsMdMissing, leftoverPrevious: true }
    : { ok: true, mode: 'generate', agentsMdMissing };
}
