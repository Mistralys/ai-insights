/**
 * scripts/tests/package-version.test.js
 *
 * Unit tests for scripts/lib/package-version.js — the shared version read/write
 * helpers used by both changelog-driven version writers and by
 * check-version-sync.js.
 *
 * All fixtures are written into a temp directory; nothing touches the real
 * workspace manifests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  readChangelogVersion,
  readPackageJsonVersion,
  readLockVersions,
  writePackageJsonVersion,
  writeLockVersion,
  syncModuleVersion,
} from '../lib/package-version.js';

/** @type {string} */
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-version-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** @param {string} name @param {unknown} data @returns {string} */
function writeJson(name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  return p;
}

/** @param {string} body @returns {string} */
function writeChangelog(body) {
  const p = path.join(dir, 'changelog.md');
  fs.writeFileSync(p, body);
  return p;
}

// ─── readChangelogVersion ─────────────────────────────────────────────────────

describe('readChangelogVersion', () => {
  it('returns the first released version', () => {
    const p = writeChangelog('# Changelog\n\n## v3.31.0 - 2026-08-25\n\n- thing\n\n## v3.30.0\n');
    expect(readChangelogVersion(p)).toBe('3.31.0');
  });

  it('returns UNRELEASED when the topmost heading is unreleased', () => {
    const p = writeChangelog('# Changelog\n\n## UNRELEASED\n\n- wip\n\n## v1.2.3\n');
    expect(readChangelogVersion(p)).toBe('UNRELEASED');
  });

  it('returns null when no version heading exists', () => {
    const p = writeChangelog('# Changelog\n\nNothing here yet.\n');
    expect(readChangelogVersion(p)).toBeNull();
  });
});

// ─── readers ──────────────────────────────────────────────────────────────────

describe('readPackageJsonVersion', () => {
  it('reads the version field', () => {
    const p = writeJson('package.json', { name: 'x', version: '1.2.3' });
    expect(readPackageJsonVersion(p)).toBe('1.2.3');
  });

  it('returns null when version is absent', () => {
    const p = writeJson('package.json', { name: 'x' });
    expect(readPackageJsonVersion(p)).toBeNull();
  });
});

describe('readLockVersions', () => {
  it('reads both version fields', () => {
    const p = writeJson('package-lock.json', {
      name: 'x', version: '1.2.3', packages: { '': { name: 'x', version: '1.2.3' } },
    });
    expect(readLockVersions(p)).toEqual({ root: '1.2.3', pkg: '1.2.3' });
  });

  it('returns null when the lock file does not exist', () => {
    expect(readLockVersions(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('reports a null pkg version when packages[""] is absent', () => {
    const p = writeJson('package-lock.json', { name: 'x', version: '1.2.3' });
    expect(readLockVersions(p)).toEqual({ root: '1.2.3', pkg: null });
  });

  it('surfaces divergence between the two fields', () => {
    const p = writeJson('package-lock.json', {
      name: 'x', version: '2.0.0', packages: { '': { version: '1.0.0' } },
    });
    expect(readLockVersions(p)).toEqual({ root: '2.0.0', pkg: '1.0.0' });
  });
});

// ─── writePackageJsonVersion ──────────────────────────────────────────────────

describe('writePackageJsonVersion', () => {
  it('updates the version and reports the old one', () => {
    const p = writeJson('package.json', { name: 'x', version: '1.0.0' });
    const r = writePackageJsonVersion(p, '2.0.0');
    expect(r).toEqual({ changed: true, oldVersion: '1.0.0' });
    expect(readPackageJsonVersion(p)).toBe('2.0.0');
  });

  it('is a no-op when already at the target version', () => {
    const p = writeJson('package.json', { name: 'x', version: '2.0.0' });
    const before = fs.readFileSync(p, 'utf8');
    expect(writePackageJsonVersion(p, '2.0.0')).toEqual({ changed: false, oldVersion: '2.0.0' });
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('preserves other fields and key order', () => {
    const p = writeJson('package.json', {
      name: 'x', version: '1.0.0', private: true, dependencies: { a: '^1.0.0' },
    });
    writePackageJsonVersion(p, '2.0.0');
    const raw = fs.readFileSync(p, 'utf8');
    expect(Object.keys(JSON.parse(raw))).toEqual(['name', 'version', 'private', 'dependencies']);
    expect(JSON.parse(raw).dependencies).toEqual({ a: '^1.0.0' });
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ─── writeLockVersion ─────────────────────────────────────────────────────────

describe('writeLockVersion', () => {
  it('updates both version fields', () => {
    const p = writeJson('package-lock.json', {
      name: 'x', version: '1.0.0', packages: { '': { name: 'x', version: '1.0.0' } },
    });
    const r = writeLockVersion(p, '2.0.0');
    expect(r.changed).toBe(true);
    expect(readLockVersions(p)).toEqual({ root: '2.0.0', pkg: '2.0.0' });
  });

  it('leaves the dependency tree untouched', () => {
    const deps = {
      '': { name: 'x', version: '1.0.0', dependencies: { a: '^1.0.0' } },
      'node_modules/a': { version: '1.4.2', resolved: 'https://registry.npmjs.org/a/-/a-1.4.2.tgz' },
    };
    const p = writeJson('package-lock.json', {
      name: 'x', version: '1.0.0', lockfileVersion: 3, requires: true, packages: deps,
    });
    writeLockVersion(p, '2.0.0');
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.packages['node_modules/a']).toEqual(deps['node_modules/a']);
    expect(after.lockfileVersion).toBe(3);
    expect(after.requires).toBe(true);
  });

  it('is a no-op when the lock file does not exist', () => {
    const r = writeLockVersion(path.join(dir, 'nope.json'), '2.0.0');
    expect(r).toEqual({ changed: false, oldVersions: null });
  });

  it('is a no-op when both fields already match', () => {
    const p = writeJson('package-lock.json', {
      name: 'x', version: '2.0.0', packages: { '': { version: '2.0.0' } },
    });
    const before = fs.readFileSync(p, 'utf8');
    expect(writeLockVersion(p, '2.0.0').changed).toBe(false);
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('still writes the root version when packages[""] is absent', () => {
    const p = writeJson('package-lock.json', { name: 'x', version: '1.0.0' });
    expect(writeLockVersion(p, '2.0.0').changed).toBe(true);
    expect(readLockVersions(p)).toEqual({ root: '2.0.0', pkg: null });
  });

  it('repairs a lock whose two version fields disagree', () => {
    const p = writeJson('package-lock.json', {
      name: 'x', version: '2.0.0', packages: { '': { version: '1.0.0' } },
    });
    expect(writeLockVersion(p, '2.0.0').changed).toBe(true);
    expect(readLockVersions(p)).toEqual({ root: '2.0.0', pkg: '2.0.0' });
  });
});

// ─── syncModuleVersion ────────────────────────────────────────────────────────

describe('syncModuleVersion', () => {
  it('updates package.json and the lock together', () => {
    const pkg  = writeJson('package.json', { name: 'x', version: '1.0.0' });
    const lock = writeJson('package-lock.json', {
      name: 'x', version: '1.0.0', packages: { '': { version: '1.0.0' } },
    });
    const r = syncModuleVersion({ packageJson: pkg, lockFile: lock, version: '3.0.0' });
    expect(r).toEqual({ pkgChanged: true, lockChanged: true });
    expect(readPackageJsonVersion(pkg)).toBe('3.0.0');
    expect(readLockVersions(lock)).toEqual({ root: '3.0.0', pkg: '3.0.0' });
  });

  it('fixes a lock-only drift without touching package.json', () => {
    const pkg  = writeJson('package.json', { name: 'x', version: '3.0.0' });
    const lock = writeJson('package-lock.json', {
      name: 'x', version: '3.1.0', packages: { '': { version: '3.1.0' } },
    });
    const r = syncModuleVersion({ packageJson: pkg, lockFile: lock, version: '3.0.0' });
    expect(r).toEqual({ pkgChanged: false, lockChanged: true });
    expect(readLockVersions(lock)).toEqual({ root: '3.0.0', pkg: '3.0.0' });
  });

  it('works for a module with no lock file', () => {
    const pkg = writeJson('package.json', { name: 'x', version: '1.0.0' });
    const r = syncModuleVersion({ packageJson: pkg, version: '2.0.0' });
    expect(r).toEqual({ pkgChanged: true, lockChanged: false });
    expect(readPackageJsonVersion(pkg)).toBe('2.0.0');
  });

  it('reports no change when everything is already in sync', () => {
    const pkg  = writeJson('package.json', { name: 'x', version: '1.0.0' });
    const lock = writeJson('package-lock.json', {
      name: 'x', version: '1.0.0', packages: { '': { version: '1.0.0' } },
    });
    const messages = [];
    const r = syncModuleVersion({
      packageJson: pkg, lockFile: lock, version: '1.0.0', log: (m) => messages.push(m),
    });
    expect(r).toEqual({ pkgChanged: false, lockChanged: false });
    expect(messages.join('\n')).toMatch(/no change needed/);
  });
});
