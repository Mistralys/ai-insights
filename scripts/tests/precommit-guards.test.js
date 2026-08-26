/**
 * scripts/tests/precommit-guards.test.js
 *
 * Unit tests for scripts/lib/precommit-guards.js
 *
 * Acceptance Criteria verified:
 *   AC-02: getStagedFiles() reflects the real staged file list against a temp
 *          `git init` repo; GUARDS is a non-empty, unique-id declarative
 *          list; runGuards() short-circuits on the first blocking failure and
 *          returns 0 when only advisories fail
 *   AC-03: devModeInactive() blocks while the injected dev-links-inactive
 *          check reports DEV mode active, names dev-unlink in its failure
 *          message, and throws when the id is absent from the registry
 *   AC-04: noFileProtocolInLocks() blocks a staged lock diff that adds a
 *          "file: line and does not block one that only removes it, verified
 *          both against a real git diff and via the pure diffAddsFileProtocol
 *          predicate (including the +++ header exclusion edge case)
 *   AC-06: ruffLint() is skipped (no spawn) when no orchestrator/src/**.py
 *          path is staged and returns a non-blocking warning when no ruff
 *          binary resolves
 *   AC-07: contextStaleness() and changelogDrift() never block
 *   AC-01/AC-02/AC-03: personaFreshness() and versionSync() block on a
 *          missing or failing delegated script, capture subprocess output in
 *          messages, and pass when the delegated script exits 0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  getStagedFiles,
  diffAddsFileProtocol,
  personaFreshness,
  versionSync,
  devModeInactive,
  noFileProtocolInLocks,
  ruffLint,
  contextStaleness,
  changelogDrift,
  runGuards,
  GUARDS,
} from '../lib/precommit-guards.js';

/** @type {string} */
let repo;

/**
 * @param {string[]} args
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function git(args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', shell: false });
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-guards-test-'));
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

// ─── getStagedFiles ─────────────────────────────────────────────────────────

describe('getStagedFiles', () => {
  it('returns an empty array when nothing is staged', () => {
    expect(getStagedFiles(repo)).toEqual([]);
  });

  it('returns the staged paths from a temp git repo', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(repo, 'sub'));
    fs.writeFileSync(path.join(repo, 'sub', 'b.txt'), 'world');
    git(['add', 'a.txt', 'sub/b.txt']);

    expect(getStagedFiles(repo).sort()).toEqual(['a.txt', 'sub/b.txt']);
  });
});

// ─── personaFreshness ───────────────────────────────────────────────────────

describe('personaFreshness', () => {
  it('fails when the delegated script does not exist', () => {
    const result = personaFreshness({ cwd: repo });
    expect(result.passed).toBe(false);
    expect(result.blocking).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('fails with captured output when the script exits non-zero', () => {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'scripts', 'build-personas.js'),
      "console.error('Stale persona output'); process.exit(1);"
    );
    const result = personaFreshness({ cwd: repo });
    expect(result.passed).toBe(false);
    expect(result.messages.join(' ')).toContain('Stale');
  });

  it('passes when the script exits 0', () => {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scripts', 'build-personas.js'), 'process.exit(0);');
    const result = personaFreshness({ cwd: repo });
    expect(result.passed).toBe(true);
    expect(result.messages).toEqual([]);
  });
});

// ─── versionSync ────────────────────────────────────────────────────────────

describe('versionSync', () => {
  it('fails when the delegated script does not exist', () => {
    const result = versionSync({ cwd: repo });
    expect(result.passed).toBe(false);
    expect(result.blocking).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('fails with captured output when the script exits non-zero', () => {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'scripts', 'check-version-sync.js'),
      "console.error('Version mismatch detected'); process.exit(1);"
    );
    const result = versionSync({ cwd: repo });
    expect(result.passed).toBe(false);
    expect(result.messages.join(' ')).toContain('mismatch');
  });

  it('passes when the script exits 0', () => {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scripts', 'check-version-sync.js'), 'process.exit(0);');
    const result = versionSync({ cwd: repo });
    expect(result.passed).toBe(true);
    expect(result.messages).toEqual([]);
  });
});

// ─── devModeInactive ────────────────────────────────────────────────────────

describe('devModeInactive', () => {
  it('fails when the injected dev-links-inactive check reports DEV mode active', () => {
    const registry = [{ id: 'dev-links-inactive', detect: () => false }];
    const result = devModeInactive(registry);
    expect(result.blocking).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.messages.join(' ')).toContain('dev-unlink');
  });

  it('passes when the injected dev-links-inactive check reports PROD mode', () => {
    const registry = [{ id: 'dev-links-inactive', detect: () => true }];
    const result = devModeInactive(registry);
    expect(result.passed).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it('throws when the dev-links-inactive id is absent from the injected registry', () => {
    expect(() => devModeInactive([])).toThrow(/dev-links-inactive/);
  });
});

// ─── diffAddsFileProtocol (pure predicate) ──────────────────────────────────

describe('diffAddsFileProtocol', () => {
  it('returns false when the "file: substring appears only in the +++ header', () => {
    const diff = [
      'diff --git a/package-lock.json b/package-lock.json',
      '--- a/package-lock.json',
      '+++ b/package-lock.json "file:../foo"',
      '@@ -1 +1 @@',
      '-"resolved": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz"',
    ].join('\n');
    expect(diffAddsFileProtocol(diff)).toBe(false);
  });

  it('returns false when a "file: line is only removed (leading -)', () => {
    const diff = [
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -1 +1 @@',
      '-        "resolved": "file:../sibling",',
      '+        "resolved": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",',
    ].join('\n');
    expect(diffAddsFileProtocol(diff)).toBe(false);
  });

  it('returns true when a line adds a "file: resolved path', () => {
    const diff = [
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -1 +1 @@',
      '-        "resolved": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",',
      '+        "resolved": "file:../sibling",',
    ].join('\n');
    expect(diffAddsFileProtocol(diff)).toBe(true);
  });
});

// ─── noFileProtocolInLocks ──────────────────────────────────────────────────

describe('noFileProtocolInLocks', () => {
  it('fails on a staged lock diff that adds a "file: line', () => {
    const lockPath = path.join(repo, 'package-lock.json');
    fs.writeFileSync(lockPath, '{\n  "resolved": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz"\n}\n');
    git(['add', 'package-lock.json']);
    git(['commit', '-m', 'init', '--quiet']);

    fs.writeFileSync(lockPath, '{\n  "resolved": "file:../sibling"\n}\n');
    git(['add', 'package-lock.json']);

    const result = noFileProtocolInLocks(['package-lock.json'], { cwd: repo });
    expect(result.blocking).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.messages.join(' ')).toContain('package-lock.json');
  });

  it('passes when a staged lock diff only removes a "file: line', () => {
    const lockPath = path.join(repo, 'package-lock.json');
    fs.writeFileSync(lockPath, '{\n  "resolved": "file:../sibling"\n}\n');
    git(['add', 'package-lock.json']);
    git(['commit', '-m', 'init', '--quiet']);

    fs.writeFileSync(lockPath, '{\n  "resolved": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz"\n}\n');
    git(['add', 'package-lock.json']);

    const result = noFileProtocolInLocks(['package-lock.json'], { cwd: repo });
    expect(result.passed).toBe(true);
    expect(result.messages).toEqual([]);
  });
});

// ─── ruffLint ────────────────────────────────────────────────────────────────

describe('ruffLint', () => {
  it('is skipped (passed, no spawn) when no orchestrator/src/**.py path is staged', () => {
    let resolveCalled = false;
    const result = ruffLint(['README.md'], { resolveRuff: () => { resolveCalled = true; return 'ruff'; } });
    expect(result).toEqual({ id: 'ruff-lint', blocking: true, passed: true, messages: [] });
    expect(resolveCalled).toBe(false);
  });

  it('returns a non-blocking warning when no ruff binary resolves', () => {
    const result = ruffLint(['orchestrator/src/foo.py'], { resolveRuff: () => null });
    expect(result.blocking).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.messages.join(' ')).toContain('ruff');
  });
});

// ─── advisory guards ─────────────────────────────────────────────────────────

describe('contextStaleness', () => {
  it('never blocks', () => {
    expect(contextStaleness(['scripts/foo.js']).blocking).toBe(false);
    expect(contextStaleness(['scripts/foo.js']).passed).toBe(false);
    expect(contextStaleness(['.context/foo.md']).passed).toBe(true);
  });
});

describe('changelogDrift', () => {
  it('never blocks', () => {
    expect(changelogDrift(['personas/changelog.md']).blocking).toBe(false);
    expect(changelogDrift(['personas/changelog.md']).passed).toBe(false);
    expect(changelogDrift(['personas/changelog.md', 'changelog.md']).passed).toBe(true);
  });
});

// ─── GUARDS registry ────────────────────────────────────────────────────────

describe('GUARDS', () => {
  it('is non-empty and every entry has a unique id', () => {
    expect(GUARDS.length).toBeGreaterThan(0);
    const ids = GUARDS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── runGuards ───────────────────────────────────────────────────────────────

describe('runGuards', () => {
  it('exits 1 on the first blocking failure and does not run later guards', () => {
    let laterCalled = false;
    const guards = [
      { id: 'first', run: () => ({ id: 'first', blocking: true, passed: false, messages: ['boom'] }) },
      { id: 'later', run: () => { laterCalled = true; return { id: 'later', blocking: true, passed: true, messages: [] }; } },
    ];
    const messages = [];
    const code = runGuards(guards, [], { print: (line) => messages.push(line) });
    expect(code).toBe(1);
    expect(laterCalled).toBe(false);
    expect(messages).toEqual(['ERROR: boom']);
  });

  it('returns 0 when only advisory guards fail', () => {
    const guards = [
      { id: 'advisory', run: () => ({ id: 'advisory', blocking: false, passed: false, messages: ['heads up'] }) },
    ];
    const messages = [];
    const code = runGuards(guards, [], { print: (line) => messages.push(line) });
    expect(code).toBe(0);
    expect(messages).toEqual(['WARNING: heads up']);
  });
});
