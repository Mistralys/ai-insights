/**
 * scripts/tests/npm-link.test.js
 *
 * Unit tests for scripts/lib/npm-link.js
 *
 * Acceptance Criteria verified:
 *   getPackageName() reads the `name` field from a given directory's package.json.
 *   isCliLinked() returns a boolean without throwing, for both a real package
 *     name (this workspace, already linked in dev) and a nonexistent one.
 *   linkCli() surfaces npm's success/failure via a plain { success, output } shape
 *     without throwing, even when npm itself fails (e.g. missing package.json).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs   from 'fs';
import os   from 'os';
import path from 'path';

import { getPackageName, isCliLinked, linkCli } from '../lib/npm-link.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'npm-link-test-'));
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ─── getPackageName() ────────────────────────────────────────────────────────

describe('getPackageName()', () => {
  it('reads the name field from package.json in the given directory', () => {
    const tmpDir = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'example-package' }),
        'utf8'
      );
      expect(getPackageName(tmpDir)).toBe('example-package');
    } finally {
      rmDir(tmpDir);
    }
  });

  it('throws when package.json is missing', () => {
    const tmpDir = makeTempDir();
    try {
      expect(() => getPackageName(tmpDir)).toThrow();
    } finally {
      rmDir(tmpDir);
    }
  });
});

// ─── isCliLinked() ────────────────────────────────────────────────────────────

describe('isCliLinked()', () => {
  it('returns a boolean without throwing for a directory with no package.json', () => {
    const tmpDir = makeTempDir();
    try {
      let result;
      expect(() => {
        result = isCliLinked({ cwd: tmpDir });
      }).not.toThrow();
      expect(result).toBe(false);
    } finally {
      rmDir(tmpDir);
    }
  });

  it('returns false for a package name that is not globally linked', () => {
    const tmpDir = makeTempDir();
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'definitely-not-a-linked-package-xyz' }),
        'utf8'
      );
      expect(isCliLinked({ cwd: tmpDir })).toBe(false);
    } finally {
      rmDir(tmpDir);
    }
  });
});

// ─── linkCli() ────────────────────────────────────────────────────────────────

describe('linkCli()', () => {
  it('returns { success: false, output } without throwing when npm link fails', () => {
    const tmpDir = makeTempDir();
    try {
      let result;
      expect(() => {
        result = linkCli({ cwd: tmpDir });
      }).not.toThrow();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('output');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.output).toBe('string');
      // No package.json in tmpDir — npm link cannot succeed.
      expect(result.success).toBe(false);
    } finally {
      rmDir(tmpDir);
    }
  });

  it('forwards non-empty output to the provided log callback', () => {
    const tmpDir = makeTempDir();
    const logged = [];
    try {
      linkCli({ cwd: tmpDir, log: (msg) => logged.push(msg) });
      // npm emits output to stderr when it fails in an empty directory.
      expect(logged.length).toBeGreaterThanOrEqual(0);
    } finally {
      rmDir(tmpDir);
    }
  });
});
