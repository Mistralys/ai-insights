/**
 * scripts/tests/mcp-dist-freshness.test.js
 *
 * Unit tests for scripts/lib/mcp-dist-freshness.js — the shared MCP-server
 * dist/ freshness check and rebuild helper (WP-003 of the
 * 2026-10-01-persona-targets-and-tool-validation-rework-2 plan).
 *
 * Every `ensureMcpDistFresh()` branch is exercised with an injected `spawn`
 * stub, so this suite never spawns a real subprocess and does not need
 * SUBPROCESS_TEST_TIMEOUT_MS.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  latestMtime,
  isMcpDistStale,
  ensureMcpDistFresh,
} from '../lib/mcp-dist-freshness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-dist-freshness-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFileAt(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function touch(filePath, mtimeMs) {
  const date = new Date(mtimeMs);
  fs.utimesSync(filePath, date, date);
}

/** A spawn stub that records every call and returns a fixed result. */
function makeSpawnStub(result) {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return result;
  };
  return { spawn, calls };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
  vi.restoreAllMocks();
});

// ─── latestMtime() ───────────────────────────────────────────────────────────

describe('latestMtime()', () => {
  it('returns the newest nested file mtime', () => {
    const root = makeTempDir();
    const older = path.join(root, 'a.txt');
    const newer = path.join(root, 'nested', 'b.txt');
    writeFileAt(older, 'a');
    writeFileAt(newer, 'b');
    touch(older, Date.UTC(2026, 0, 1));
    touch(newer, Date.UTC(2026, 0, 2));

    expect(latestMtime(root)).toBe(fs.statSync(newer).mtimeMs);
  });

  it('returns -Infinity for a missing directory', () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    expect(latestMtime(missing)).toBe(-Infinity);
  });

  it('returns -Infinity for an unreadable directory', () => {
    const root = makeTempDir();
    const locked = path.join(root, 'locked');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o000);
    try {
      expect(latestMtime(locked)).toBe(-Infinity);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
});

// ─── isMcpDistStale() ────────────────────────────────────────────────────────

describe('isMcpDistStale()', () => {
  it('is true when the sentinel file is missing', () => {
    const root = makeTempDir();
    const srcDir = path.join(root, 'src');
    writeFileAt(path.join(srcDir, 'index.ts'), 'x');

    expect(
      isMcpDistStale({ srcDir, sentinelFile: path.join(root, 'dist', 'index.js') }),
    ).toBe(true);
  });

  it('is true when a source file is newer than the sentinel', () => {
    const root = makeTempDir();
    const srcFile = path.join(root, 'src', 'index.ts');
    const sentinelFile = path.join(root, 'dist', 'index.js');
    writeFileAt(srcFile, 'x');
    writeFileAt(sentinelFile, 'y');
    touch(sentinelFile, Date.UTC(2026, 0, 1));
    touch(srcFile, Date.UTC(2026, 0, 2));

    expect(isMcpDistStale({ srcDir: path.join(root, 'src'), sentinelFile })).toBe(true);
  });

  it('is false when the sentinel is newer than every source file', () => {
    const root = makeTempDir();
    const srcFile = path.join(root, 'src', 'index.ts');
    const sentinelFile = path.join(root, 'dist', 'index.js');
    writeFileAt(srcFile, 'x');
    writeFileAt(sentinelFile, 'y');
    touch(srcFile, Date.UTC(2026, 0, 1));
    touch(sentinelFile, Date.UTC(2026, 0, 2));

    expect(isMcpDistStale({ srcDir: path.join(root, 'src'), sentinelFile })).toBe(false);
  });
});

// ─── ensureMcpDistFresh() ────────────────────────────────────────────────────

describe('ensureMcpDistFresh()', () => {
  function makeFreshProject() {
    const mcpServerDir = makeTempDir();
    const srcFile = path.join(mcpServerDir, 'src', 'index.ts');
    const sentinelFile = path.join(mcpServerDir, 'dist', 'index.js');
    writeFileAt(srcFile, 'x');
    writeFileAt(sentinelFile, 'y');
    touch(srcFile, Date.UTC(2026, 0, 1));
    touch(sentinelFile, Date.UTC(2026, 0, 2));
    return mcpServerDir;
  }

  function makeStaleProject() {
    const mcpServerDir = makeTempDir();
    const srcFile = path.join(mcpServerDir, 'src', 'index.ts');
    const sentinelFile = path.join(mcpServerDir, 'dist', 'index.js');
    writeFileAt(srcFile, 'x');
    writeFileAt(sentinelFile, 'y');
    touch(sentinelFile, Date.UTC(2026, 0, 1));
    touch(srcFile, Date.UTC(2026, 0, 2));
    return mcpServerDir;
  }

  it('fresh dist: does not spawn, does not call onBuildStart, returns rebuilt: false', () => {
    const mcpServerDir = makeFreshProject();
    const { spawn, calls } = makeSpawnStub({ status: 0 });
    const onBuildStart = vi.fn();

    const result = ensureMcpDistFresh({ mcpServerDir, spawn, onBuildStart });

    expect(result).toEqual({ ok: true, rebuilt: false });
    expect(calls).toHaveLength(0);
    expect(onBuildStart).not.toHaveBeenCalled();
  });

  it('stale dist: calls onBuildStart exactly once before spawn, returns rebuilt: true', () => {
    const mcpServerDir = makeStaleProject();
    const { spawn, calls } = makeSpawnStub({ status: 0 });
    const callOrder = [];
    const onBuildStart = vi.fn(() => callOrder.push('onBuildStart'));

    const result = ensureMcpDistFresh({
      mcpServerDir,
      spawn: (...args) => {
        callOrder.push('spawn');
        return spawn(...args);
      },
      onBuildStart,
    });

    expect(result).toEqual({ ok: true, rebuilt: true });
    expect(onBuildStart).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('npm');
    expect(calls[0].args).toEqual(['run', 'build']);
    expect(calls[0].options).toMatchObject({
      cwd: mcpServerDir,
      stdio: 'inherit',
      shell: false,
    });
    expect(callOrder).toEqual(['onBuildStart', 'spawn']);
  });

  it('platform win32: spawns npm.cmd with shell: true', () => {
    const mcpServerDir = makeStaleProject();
    const { spawn, calls } = makeSpawnStub({ status: 0 });

    ensureMcpDistFresh({ mcpServerDir, spawn, platform: 'win32' });

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('npm.cmd');
    expect(calls[0].options).toMatchObject({ shell: true });
  });

  it('build-failed: returns { ok: false, reason: "build-failed", status }', () => {
    const mcpServerDir = makeStaleProject();
    const { spawn } = makeSpawnStub({ status: 2 });

    const result = ensureMcpDistFresh({ mcpServerDir, spawn });

    expect(result).toEqual({ ok: false, reason: 'build-failed', status: 2 });
  });

  it('requiredFile given but absent: returns { ok: false, reason: "missing-module", file }', () => {
    const mcpServerDir = makeFreshProject();
    const requiredFile = path.join(mcpServerDir, 'dist', 'tools', 'missing.js');
    const { spawn } = makeSpawnStub({ status: 0 });

    const result = ensureMcpDistFresh({ mcpServerDir, requiredFile, spawn });

    expect(result).toEqual({ ok: false, reason: 'missing-module', file: requiredFile });
  });

  it('requiredFile given and present: returns ok: true with no missing-module check failure', () => {
    const mcpServerDir = makeFreshProject();
    const requiredFile = path.join(mcpServerDir, 'dist', 'tools', 'present.js');
    writeFileAt(requiredFile, 'x');
    const { spawn } = makeSpawnStub({ status: 0 });

    const result = ensureMcpDistFresh({ mcpServerDir, requiredFile, spawn });

    expect(result).toEqual({ ok: true, rebuilt: false });
  });

  it('requiredFile omitted: no missing-module check runs', () => {
    const mcpServerDir = makeFreshProject();
    const { spawn } = makeSpawnStub({ status: 0 });

    const result = ensureMcpDistFresh({ mcpServerDir, spawn });

    expect(result).toEqual({ ok: true, rebuilt: false });
  });

  it('writes nothing to the console on any path (fresh, stale, build-failed, missing-module)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ensureMcpDistFresh({ mcpServerDir: makeFreshProject(), spawn: makeSpawnStub({ status: 0 }).spawn });
    ensureMcpDistFresh({ mcpServerDir: makeStaleProject(), spawn: makeSpawnStub({ status: 0 }).spawn });
    ensureMcpDistFresh({ mcpServerDir: makeStaleProject(), spawn: makeSpawnStub({ status: 1 }).spawn });
    ensureMcpDistFresh({
      mcpServerDir: makeFreshProject(),
      requiredFile: path.join(os.tmpdir(), 'does-not-exist-' + Date.now()),
      spawn: makeSpawnStub({ status: 0 }).spawn,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Source-text assertions: the module never exits or prints directly (AC-11).
// ---------------------------------------------------------------------------

describe('mcp-dist-freshness.js — no process.exit, no console', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'mcp-dist-freshness.js'),
    'utf8',
  );

  it('contains no process.exit( call site', () => {
    expect(source.match(/process\.exit\(/g) ?? []).toHaveLength(0);
  });

  it('contains no console. call site', () => {
    expect(source.match(/console\./g) ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Caller-migration assertions (WP-006): every former private copy of
// latestMtime is gone, each caller imports from the shared module, and each
// caller's exact pre-migration message texts and exit-code mappings survive
// the migration unchanged.
// ---------------------------------------------------------------------------

const CALLER_FILES = [
  { label: 'ledger-dirs.js', relPath: ['lib', 'ledger-dirs.js'] },
  { label: 'import-standalone.js', relPath: ['import-standalone.js'] },
  { label: 'run-orchestrator.js', relPath: ['run-orchestrator.js'] },
  { label: 'cli.js', relPath: ['cli.js'] },
  { label: 'health-checks.js', relPath: ['lib', 'health-checks.js'] },
];

function readCallerSource({ relPath }) {
  return fs.readFileSync(path.join(__dirname, '..', ...relPath), 'utf8');
}

describe('caller migration — no private latestMtime left behind', () => {
  for (const caller of CALLER_FILES) {
    it(`${caller.label} does not define its own latestMtime`, () => {
      const source = readCallerSource(caller);
      // Word-boundary pattern: health-checks.js's retained latestMtimeFlat
      // must not false-match.
      expect(source.match(/function\s+latestMtime\s*\(/g) ?? []).toHaveLength(0);
    });
  }

  it('health-checks.js still defines its own latestMtimeFlat (not migrated)', () => {
    const source = readCallerSource({ relPath: ['lib', 'health-checks.js'] });
    expect(source.match(/function\s+latestMtimeFlat\s*\(/g) ?? []).toHaveLength(1);
  });
});

describe('caller migration — each file imports from the shared module', () => {
  it('ledger-dirs.js imports ensureMcpDistFresh from ./mcp-dist-freshness.js', () => {
    const source = readCallerSource({ relPath: ['lib', 'ledger-dirs.js'] });
    expect(source).toMatch(/from\s+['"]\.\/mcp-dist-freshness\.js['"]/);
    expect(source).toMatch(/ensureMcpDistFresh/);
  });

  it('import-standalone.js imports ensureMcpDistFresh from ./lib/mcp-dist-freshness.js', () => {
    const source = readCallerSource({ relPath: ['import-standalone.js'] });
    expect(source).toMatch(/from\s+['"]\.\/lib\/mcp-dist-freshness\.js['"]/);
    expect(source).toMatch(/ensureMcpDistFresh/);
  });

  it('run-orchestrator.js imports ensureMcpDistFresh from ./lib/mcp-dist-freshness.js', () => {
    const source = readCallerSource({ relPath: ['run-orchestrator.js'] });
    expect(source).toMatch(/from\s+['"]\.\/lib\/mcp-dist-freshness\.js['"]/);
    expect(source).toMatch(/ensureMcpDistFresh/);
  });

  it('cli.js imports isMcpDistStale from ./lib/mcp-dist-freshness.js', () => {
    const source = readCallerSource({ relPath: ['cli.js'] });
    expect(source).toMatch(/from\s+['"]\.\/lib\/mcp-dist-freshness\.js['"]/);
    expect(source).toMatch(/isMcpDistStale/);
  });

  it('health-checks.js imports latestMtime from ./mcp-dist-freshness.js', () => {
    const source = readCallerSource({ relPath: ['lib', 'health-checks.js'] });
    expect(source).toMatch(/from\s+['"]\.\/mcp-dist-freshness\.js['"]/);
    expect(source).toMatch(/import\s*\{\s*latestMtime\s*\}/);
  });
});

describe('caller migration — exact pre-migration message texts preserved', () => {
  it('ledger-dirs.js keeps its stale/build-failed/missing-module message texts', () => {
    const source = readCallerSource({ relPath: ['lib', 'ledger-dirs.js'] });
    expect(source).toContain('[ledger-dirs] mcp-server/dist is stale or missing — building MCP server...');
    expect(source).toContain('[ledger-dirs] MCP server build failed.');
    expect(source).toContain('[ledger-dirs] Error: compiled module not found at');
    expect(source).toContain('Try running: cd mcp-server && npm run build');
  });

  it('import-standalone.js keeps its stale/build-failed message texts and the unprefixed missing-tool line', () => {
    const source = readCallerSource({ relPath: ['import-standalone.js'] });
    expect(source).toContain('[import-standalone.js] mcp-server/dist is stale or missing — building MCP server...');
    expect(source).toContain('[import-standalone.js] MCP server build failed.');
    // Unprefixed — deliberately does not carry the "[import-standalone.js]" label.
    expect(source).toContain('Error: compiled tool not found at');
    expect(source).not.toContain('[import-standalone.js] Error: compiled tool not found at');
  });

  it('run-orchestrator.js keeps its stale/up-to-date lines and has no build-failed message', () => {
    const source = readCallerSource({ relPath: ['run-orchestrator.js'] });
    expect(source).toContain('[run-orchestrator.js] mcp-server/dist is stale or missing — building MCP server...');
    expect(source).toContain('[run-orchestrator.js] mcp-server/dist is up to date — skipping build.');
    // Silent build failure: no "build failed" text anywhere in the file.
    expect(source).not.toMatch(/build failed/i);
  });

  it('cli.js keeps its stale/build-failed message texts', () => {
    const source = readCallerSource({ relPath: ['cli.js'] });
    expect(source).toContain('MCP server dist is stale — rebuilding…');
    expect(source).toContain('✗ MCP server build failed');
  });
});
