/**
 * scripts/tests/ctx-generate.test.js
 *
 * Unit tests for scripts/lib/ctx-generate.js — the non-destructive
 * staged generate-and-swap replacement for the old `rmSync('.context')`-first
 * cmdCtxGenerate. Every filesystem-mutating path is exercised against a real
 * temporary directory tree (no mocked fs), with the `ctx` subprocess and
 * retry delays injected so this suite never spawns a real process or sleeps
 * for real.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseCtxArgs,
  renameWithRetry,
  removeWithRetry,
  recoverInterruptedSwap,
  compareTrees,
  generateContext,
  runCtxGenerate,
  INCOMING_DIR_NAME,
  PREVIOUS_DIR_NAME,
  OUTPUT_DIR_NAME,
  GENERATED_AT_FILENAME,
} from '../lib/ctx-generate.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-generate-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFileAt(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readDirRecursive(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...readDirRecursive(full));
    else results.push(full);
  }
  return results;
}

const noSleep = () => Promise.resolve();

/** A fake `ctx generate -w <dir> ...` spawn that writes fixture files into the staging dir. */
function makeSucceedingSpawn(fixtureFiles) {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const wIndex = args.indexOf('-w');
    const stagingDir = args[wIndex + 1];
    for (const [rel, content] of Object.entries(fixtureFiles)) {
      writeFileAt(path.join(stagingDir, rel), content);
    }
    return { status: 0 };
  };
  return { spawn, calls };
}

function makeFailingSpawn(status = 255) {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status };
  };
  return { spawn, calls };
}

function makeMissingBinarySpawn() {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const error = new Error('spawn ctx ENOENT');
    error.code = 'ENOENT';
    return { status: null, error };
  };
  return { spawn, calls };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ─── parseCtxArgs ────────────────────────────────────────────────────────────

describe('parseCtxArgs', () => {
  it('consumes --check and reports it separately from ctxArgs', () => {
    const result = parseCtxArgs(['--check']);
    expect(result).toEqual({ ok: true, check: true, ctxArgs: [] });
  });

  it('passes through other flags unchanged and in order', () => {
    const result = parseCtxArgs(['-q', '-vv', '--bogus']);
    expect(result).toEqual({ ok: true, check: false, ctxArgs: ['-q', '-vv', '--bogus'] });
  });

  it('mixes --check with other flags, preserving the remaining order', () => {
    const result = parseCtxArgs(['-q', '--check', '--bogus']);
    expect(result).toEqual({ ok: true, check: true, ctxArgs: ['-q', '--bogus'] });
  });

  it.each([
    ['-w'],
    ['-wout'],
    ['--work-dir'],
    ['--work-dir=out'],
  ])('rejects the command-owned output-directory flag %j', (flag) => {
    const result = parseCtxArgs([flag]);
    expect(result).toEqual({ ok: false, reason: 'owns-work-dir', flag });
  });

  it('performs no filesystem access on a rejected argument (pure function)', () => {
    // No fs import is exercised by this test at all — parseCtxArgs takes only
    // an array and returns a plain object. This test documents that contract
    // rather than spying on fs, since the function has no fs dependency to spy on.
    expect(() => parseCtxArgs(['-w'])).not.toThrow();
  });
});

// ─── renameWithRetry / removeWithRetry ──────────────────────────────────────

describe('renameWithRetry', () => {
  it('succeeds immediately when the first attempt succeeds', async () => {
    const calls = [];
    const renameFn = (from, to) => calls.push([from, to]);
    const result = await renameWithRetry('/a', '/b', { renameFn, sleepFn: noSleep });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([['/a', '/b']]);
  });

  it('retries a transient EPERM and succeeds on a later attempt', async () => {
    let attempts = 0;
    const renameFn = () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('locked');
        err.code = 'EPERM';
        throw err;
      }
    };
    const result = await renameWithRetry('/a', '/b', { renameFn, sleepFn: noSleep, maxRetries: 5 });
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it('returns replace-failed-style result when every attempt fails', async () => {
    let attempts = 0;
    const renameFn = () => {
      attempts++;
      const err = new Error('locked');
      err.code = 'EPERM';
      throw err;
    };
    const result = await renameWithRetry('/a', '/b', { renameFn, sleepFn: noSleep, maxRetries: 2 });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('EPERM');
    expect(attempts).toBe(3); // initial attempt + 2 retries
  });

  it('does not retry a non-transient error', async () => {
    let attempts = 0;
    const renameFn = () => {
      attempts++;
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    };
    const result = await renameWithRetry('/a', '/b', { renameFn, sleepFn: noSleep, maxRetries: 5 });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
  });
});

describe('removeWithRetry', () => {
  it('treats a missing path as already removed', async () => {
    const workspace = makeTempWorkspace();
    const result = await removeWithRetry(path.join(workspace, 'nonexistent'), { sleepFn: noSleep });
    expect(result).toEqual({ ok: true });
  });

  it('removes a real directory tree', async () => {
    const workspace = makeTempWorkspace();
    const target = path.join(workspace, 'to-remove');
    writeFileAt(path.join(target, 'a.txt'), 'hi');
    const result = await removeWithRetry(target, { sleepFn: noSleep });
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(target)).toBe(false);
  });
});

// ─── recoverInterruptedSwap ──────────────────────────────────────────────────

describe('recoverInterruptedSwap', () => {
  it('is a no-op when neither transient directory exists', async () => {
    const workspace = makeTempWorkspace();
    const result = await recoverInterruptedSwap({ workspaceRoot: workspace });
    expect(result).toEqual({ recovered: false, restoredOutput: false, failures: [] });
  });

  it('restores .context/ from .context.previous/ when .context/ is missing', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'old content');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace });

    expect(result).toEqual({ recovered: true, restoredOutput: true, failures: [] });
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('removes a stale .context.previous/ when .context/ already exists', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'a.md'), 'current content');
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'stale content');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace });

    expect(result).toEqual({ recovered: true, restoredOutput: false, failures: [] });
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'a.md'), 'utf8')).toBe('current content');
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('always removes a leftover .context.incoming/, regardless of .context.previous/ state', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, INCOMING_DIR_NAME, 'a.md'), 'half-generated');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace });

    expect(result).toEqual({ recovered: true, restoredOutput: false, failures: [] });
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('handles both leftovers together: restores output and removes incoming', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'old content');
    writeFileAt(path.join(workspace, INCOMING_DIR_NAME, 'a.md'), 'half-generated');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace });

    expect(result).toEqual({ recovered: true, restoredOutput: true, failures: [] });
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('reports a failing restore in failures with op "restore", and does not mark restoredOutput', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'old content');
    const failingRename = async () => ({ ok: false, error: new Error('locked') });

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace, renameWithRetryFn: failingRename });

    expect(result.recovered).toBe(true);
    expect(result.restoredOutput).toBe(false);
    expect(result.failures).toEqual([
      { op: 'restore', path: path.join(workspace, PREVIOUS_DIR_NAME), error: expect.any(Error) },
    ]);
  });

  it('reports a failing stale-previous removal in failures with op "remove-previous"', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'a.md'), 'current content');
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'stale content');
    const failingRemove = async (dirPath) => ({ ok: false, error: new Error('locked: ' + dirPath) });

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace, removeWithRetryFn: failingRemove });

    expect(result.failures).toEqual([
      { op: 'remove-previous', path: path.join(workspace, PREVIOUS_DIR_NAME), error: expect.any(Error) },
    ]);
  });

  it('reports a failing incoming removal in failures with op "remove-incoming"', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, INCOMING_DIR_NAME, 'a.md'), 'half-generated');
    const failingRemove = async (dirPath) => ({ ok: false, error: new Error('locked: ' + dirPath) });

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace, removeWithRetryFn: failingRemove });

    expect(result.failures).toEqual([
      { op: 'remove-incoming', path: path.join(workspace, INCOMING_DIR_NAME), error: expect.any(Error) },
    ]);
  });

  it('mode: "check" only removes a stale .context.incoming/, leaving .context/ and .context.previous/ untouched', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'orphaned previous');
    writeFileAt(path.join(workspace, INCOMING_DIR_NAME, 'a.md'), 'half-generated');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace, mode: 'check' });

    expect(result).toEqual({ recovered: true, restoredOutput: false, failures: [] });
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(true);
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME))).toBe(false);
  });

  it('mode: "check" is a no-op when only .context.previous/ is present (no incoming to clear)', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'orphaned previous');

    const result = await recoverInterruptedSwap({ workspaceRoot: workspace, mode: 'check' });

    expect(result).toEqual({ recovered: false, restoredOutput: false, failures: [] });
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(true);
  });
});

// ─── compareTrees ────────────────────────────────────────────────────────────

describe('compareTrees', () => {
  it('reports no diffs for identical trees', () => {
    const workspace = makeTempWorkspace();
    const a = path.join(workspace, 'a');
    const b = path.join(workspace, 'b');
    writeFileAt(path.join(a, 'x.md'), 'same');
    writeFileAt(path.join(b, 'x.md'), 'same');
    expect(compareTrees(a, b)).toEqual([]);
  });

  it('reports a file present in only one tree', () => {
    const workspace = makeTempWorkspace();
    const a = path.join(workspace, 'a');
    const b = path.join(workspace, 'b');
    writeFileAt(path.join(a, 'only-in-a.md'), 'x');
    fs.mkdirSync(b, { recursive: true });
    expect(compareTrees(a, b)).toEqual(['only-in-a.md']);
  });

  it('reports a file with differing content', () => {
    const workspace = makeTempWorkspace();
    const a = path.join(workspace, 'a');
    const b = path.join(workspace, 'b');
    writeFileAt(path.join(a, 'x.md'), 'version 1');
    writeFileAt(path.join(b, 'x.md'), 'version 2');
    expect(compareTrees(a, b)).toEqual(['x.md']);
  });

  it('reports nested-path diffs with POSIX separators', () => {
    const workspace = makeTempWorkspace();
    const a = path.join(workspace, 'a');
    const b = path.join(workspace, 'b');
    writeFileAt(path.join(a, 'nested', 'deep.md'), 'x');
    fs.mkdirSync(b, { recursive: true });
    expect(compareTrees(a, b)).toEqual(['nested/deep.md']);
  });

  it('treats a wholly missing second directory as empty, reporting every file from the first as a diff', () => {
    const workspace = makeTempWorkspace();
    const a = path.join(workspace, 'a');
    const bNeverCreated = path.join(workspace, 'does-not-exist');
    writeFileAt(path.join(a, 'x.md'), 'content');
    writeFileAt(path.join(a, 'nested', 'deep.md'), 'content');
    expect(compareTrees(a, bNeverCreated)).toEqual(['nested/deep.md', 'x.md']);
  });
});

// ─── generateContext ─────────────────────────────────────────────────────────

describe('generateContext', () => {
  it('maps a spawn ENOENT error to ctx-missing', () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeMissingBinarySpawn();
    const result = generateContext({
      workspaceRoot: workspace,
      stagingDir: path.join(workspace, INCOMING_DIR_NAME),
      ctxArgs: [],
      spawn,
    });
    expect(result).toEqual({ ok: false, reason: 'ctx-missing' });
  });

  it('maps a non-zero exit status to ctx-failed', () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeFailingSpawn(255);
    const result = generateContext({
      workspaceRoot: workspace,
      stagingDir: path.join(workspace, INCOMING_DIR_NAME),
      ctxArgs: ['--bogus'],
      spawn,
    });
    expect(result).toEqual({ ok: false, reason: 'ctx-failed', status: 255 });
  });

  it('calls normalizeFn with the staging dir after a successful run', () => {
    const workspace = makeTempWorkspace();
    const stagingDir = path.join(workspace, INCOMING_DIR_NAME);
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'hi' });
    const normalizeCalls = [];
    const result = generateContext({
      workspaceRoot: workspace,
      stagingDir,
      ctxArgs: [],
      spawn,
      normalizeFn: (dir) => normalizeCalls.push(dir),
    });
    expect(result).toEqual({ ok: true });
    expect(normalizeCalls).toEqual([stagingDir]);
  });

  it('invokes ctx with -w <stagingDir> before any other ctxArgs', () => {
    const workspace = makeTempWorkspace();
    const stagingDir = path.join(workspace, INCOMING_DIR_NAME);
    const { spawn, calls } = makeSucceedingSpawn({});
    generateContext({ workspaceRoot: workspace, stagingDir, ctxArgs: ['-q'], spawn });
    expect(calls[0].args).toEqual(['generate', '-w', stagingDir, '-q']);
  });
});

// ─── runCtxGenerate — argument validation (no filesystem access) ────────────

describe('runCtxGenerate — argument rejection', () => {
  it('rejects -w before touching the filesystem, leaving no directories created', async () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'hi' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['-w', '/elsewhere'], spawn });

    expect(result).toEqual({ ok: false, reason: 'owns-work-dir', flag: '-w' });
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });
});

// ─── runCtxGenerate — real run ───────────────────────────────────────────────

describe('runCtxGenerate — real run', () => {
  it('leaves .context/ byte-identical after a failing ctx run', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeFailingSpawn(255);

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['--bogus'], spawn, normalizeFn: () => {} });

    expect(result).toEqual({ ok: false, reason: 'ctx-failed', status: 255 });
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('replaces .context/ with the new output, and writes generated-at.txt', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'old content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, now: () => '2026-01-01T00:00:00.000Z' });

    expect(result).toEqual({ ok: true, mode: 'generate' });
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('new content');
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, GENERATED_AT_FILENAME), 'utf8')).toBe('2026-01-01T00:00:00.000Z\n');
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('succeeds on a first-ever run with no pre-existing .context/', async () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'first run' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {} });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('first run');
  });

  it('recovers from a leftover .context.previous/ before generating, and completes normally', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'README.md'), 'orphaned previous');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'fresh output' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {} });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('fresh output');
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('cleans up the staging directory after a failed run', async () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeFailingSpawn(1);

    await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {} });

    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('maps a missing ctx binary to ctx-missing without touching .context/', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original');
    const { spawn } = makeMissingBinarySpawn();

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {} });

    expect(result).toEqual({ ok: false, reason: 'ctx-missing' });
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original');
  });

  it('restores the original .context/ and leaves no transient directories after an injected mid-swap failure', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    // Fail only the second rename (incoming -> output); let the first
    // (output -> previous) succeed, so this exercises the restore-and-clean
    // path specifically for a failure after the original was already moved aside.
    let renameCallCount = 0;
    const renameWithRetryFn = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 2) {
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
      }
      fs.renameSync(from, to);
      return { ok: true };
    };

    const result = await runCtxGenerate({
      workspaceRoot: workspace,
      args: [],
      spawn,
      normalizeFn: () => {},
      renameWithRetryFn,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('swap-failed');
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('move-in failure with a successful restore reports previousOutput "restored" (no restoreError)', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    let renameCallCount = 0;
    const renameWithRetryFn = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 2) {
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
      }
      fs.renameSync(from, to);
      return { ok: true };
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('swap-failed');
    expect(result.previousOutput).toBe('restored');
    expect(result.restoreError).toBeUndefined();
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('move-in failure with no prior .context/ reports previousOutput "none"', async () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });
    const failingRename = async () => ({ ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: failingRename });

    expect(result).toEqual({ ok: false, reason: 'swap-failed', error: expect.any(Error), previousOutput: 'none' });
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME))).toBe(false);
  });

  it('move-aside failure reports previousOutput "untouched" — .context/ holds the original bytes, no .context.previous/', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });
    const failingRename = async () => ({ ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: failingRename });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('swap-failed');
    expect(result.previousOutput).toBe('untouched');
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('move-in failure with a failing restore reports previousOutput "preserved-in-previous" with restoreError, and a following run restores and completes', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    let renameCallCount = 0;
    const alwaysFailMoveInAndRestore = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 1) {
        // move-aside succeeds for real
        fs.renameSync(from, to);
        return { ok: true };
      }
      // move-in (call 2) and the restore attempt (call 3) both fail
      return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
    };

    const result = await runCtxGenerate({
      workspaceRoot: workspace,
      args: [],
      spawn,
      normalizeFn: () => {},
      renameWithRetryFn: alwaysFailMoveInAndRestore,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('swap-failed');
    expect(result.previousOutput).toBe('preserved-in-previous');
    expect(result.restoreError).toBeInstanceOf(Error);
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME))).toBe(false);
    expect(fs.readFileSync(path.join(workspace, PREVIOUS_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');

    // A following run with working renames restores .context.previous/ through
    // recovery and completes normally.
    const { spawn: secondSpawn } = makeSucceedingSpawn({ 'README.md': 'second run content' });
    const secondResult = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn: secondSpawn, normalizeFn: () => {} });

    expect(secondResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('second run content');
    expect(fs.existsSync(path.join(workspace, PREVIOUS_DIR_NAME))).toBe(false);
  });

  it('observation beats the reported result: a restore rename that moves the directory but reports { ok: false } yields "restored" with restoreError set', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    let renameCallCount = 0;
    const fakeRename = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 1) {
        fs.renameSync(from, to); // move-aside succeeds
        return { ok: true };
      }
      if (renameCallCount === 2) {
        // move-in fails
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
      }
      // restore attempt (call 3): actually moves the directory but reports failure
      fs.renameSync(from, to);
      return { ok: false, error: new Error('reported failure despite success') };
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: fakeRename });

    expect(result.previousOutput).toBe('restored');
    expect(result.restoreError).toBeInstanceOf(Error);
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('original content');
  });

  it('observation beats the reported result: a restore rename that reports { ok: true } without moving yields "preserved-in-previous"', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    let renameCallCount = 0;
    const fakeRename = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 1) {
        fs.renameSync(from, to); // move-aside succeeds
        return { ok: true };
      }
      if (renameCallCount === 2) {
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) }; // move-in fails
      }
      // restore attempt (call 3): reports success but never actually moves anything
      return { ok: true };
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: fakeRename });

    expect(result.previousOutput).toBe('preserved-in-previous');
    expect(result.restoreError).toBeUndefined();
  });

  it('a fake leaving both .context/ and .context.previous/ present after a move-in failure reports "unknown" with observed', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    let renameCallCount = 0;
    const fakeRename = async (from, to) => {
      renameCallCount++;
      if (renameCallCount === 1) {
        // move-aside: copy instead of move, so both directories end up present
        fs.cpSync(from, to, { recursive: true });
        return { ok: true };
      }
      if (renameCallCount === 2) {
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) }; // move-in fails
      }
      // restore attempt (call 3): no-op, .context/ already exists from the copy above
      return { ok: false, error: new Error('restore also fails') };
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: fakeRename });

    expect(result.previousOutput).toBe('unknown');
    expect(result.observed).toEqual({ output: true, previous: true });
  });

  it('a move-aside failure whose fake actually moves .context/ to .context.previous/ reports "unknown", not "preserved-in-previous"', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'original content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    const fakeRename = async (from, to) => {
      // move-aside: actually move the directory, but report failure anyway —
      // pins that "preserved-in-previous" is reachable only from the move-in branch.
      fs.renameSync(from, to);
      return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: fakeRename });

    expect(result.reason).toBe('swap-failed');
    expect(result.previousOutput).toBe('unknown');
    expect(result.observed).toEqual({ output: false, previous: true });
  });

  it('aborts with recovery-failed before calling ctx when recovery cannot clear leftover state', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'a.md'), 'orphaned previous');
    const { spawn, calls } = makeSucceedingSpawn({ 'README.md': 'x' });
    const failingRename = async () => ({ ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, renameWithRetryFn: failingRename });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('recovery-failed');
    expect(result.failures).toEqual([
      { op: 'restore', path: path.join(workspace, PREVIOUS_DIR_NAME), error: expect.any(Error) },
    ]);
    expect(calls).toEqual([]);
  });

  it('reports leftoverPrevious: true when the post-swap .context.previous/ removal fails, while still succeeding', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'old content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });
    const removeWithRetryFn = async (dirPath) => {
      if (dirPath.endsWith(PREVIOUS_DIR_NAME)) {
        return { ok: false, error: Object.assign(new Error('locked'), { code: 'EPERM' }) };
      }
      return removeWithRetry(dirPath, { sleepFn: noSleep });
    };

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: [], spawn, normalizeFn: () => {}, removeWithRetryFn });

    expect(result).toEqual({ ok: true, mode: 'generate', leftoverPrevious: true });
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('new content');
  });
});

// ─── runCtxGenerate — check mode ─────────────────────────────────────────────

describe('runCtxGenerate — check mode', () => {
  it('reports fresh and writes nothing when staging output matches .context/', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'matching content');
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, GENERATED_AT_FILENAME), '2025-01-01T00:00:00.000Z\n');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'matching content' });

    const outputBefore = fs.readdirSync(path.join(workspace, OUTPUT_DIR_NAME)).sort();
    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['--check'], spawn, normalizeFn: () => {} });

    expect(result).toEqual({ ok: true, mode: 'check', fresh: true });
    // Writes nothing: .context/ dir listing is unchanged and no transients remain.
    expect(fs.readdirSync(path.join(workspace, OUTPUT_DIR_NAME)).sort()).toEqual(outputBefore);
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('reports stale with the differing paths listed, writing nothing', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'old content');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'new content' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['--check'], spawn, normalizeFn: () => {} });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('check');
    expect(result.fresh).toBe(false);
    expect(result.diffs).toContain('README.md');
    expect(fs.readFileSync(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'utf8')).toBe('old content');
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('does not report generated-at.txt as a diff even though its content always differs', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, 'README.md'), 'same content');
    writeFileAt(path.join(workspace, OUTPUT_DIR_NAME, GENERATED_AT_FILENAME), '2020-01-01T00:00:00.000Z\n');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'same content' });
    // The fake spawn above never writes generated-at.txt into staging (only
    // a real run does, after generateContext()), so it is also absent-vs-present
    // across the two trees — still must not count as a diff.

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['--check'], spawn, normalizeFn: () => {} });

    expect(result).toEqual({ ok: true, mode: 'check', fresh: true });
  });

  it('cleans up the staging directory after check mode', async () => {
    const workspace = makeTempWorkspace();
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'x' });

    await runCtxGenerate({ workspaceRoot: workspace, args: ['--check'], spawn, normalizeFn: () => {} });

    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });

  it('with .context.previous/ present and .context/ missing: reports stale, lists .context, and leaves both directories exactly as before (AC-07)', async () => {
    const workspace = makeTempWorkspace();
    writeFileAt(path.join(workspace, PREVIOUS_DIR_NAME, 'README.md'), 'orphaned previous');
    const { spawn } = makeSucceedingSpawn({ 'README.md': 'staged content' });

    const result = await runCtxGenerate({ workspaceRoot: workspace, args: ['--check'], spawn, normalizeFn: () => {} });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('check');
    expect(result.fresh).toBe(false);
    expect(result.diffs).toContain('README.md');
    // Check mode never restores or removes .context.previous/, and never
    // creates .context/.
    expect(fs.readFileSync(path.join(workspace, PREVIOUS_DIR_NAME, 'README.md'), 'utf8')).toBe('orphaned previous');
    expect(fs.existsSync(path.join(workspace, OUTPUT_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(workspace, INCOMING_DIR_NAME))).toBe(false);
  });
});
