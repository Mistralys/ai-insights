/**
 * scripts/tests/dev-link.test.js
 *
 * Integration tests for scripts/dev-link.js.
 *
 * The script is spawned as a subprocess against a temporary workspace copy so
 * that `.dev-links.json` writes never touch the real repository root. Sibling
 * package directories are absent in the temp workspace, which exercises the
 * "skip with a warning" path without ever invoking `npm link`.
 *
 * Acceptance Criteria verified:
 *   AC-01/AC-02: marker file lifecycle (written by link, removed by unlink)
 *   AC-10:       missing sibling directory warns instead of erroring
 *   AC-11:       --package filters to a single package
 *   AC-12:       --skip-build is accepted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REAL_SCRIPT = path.resolve(import.meta.dirname, '..', 'dev-link.js');

/** @type {string} */
let sandbox;
/** @type {string} */
let workspace;
/** @type {string} */
let script;

/**
 * Build a throwaway workspace: `<sandbox>/ai-insights/scripts/dev-link.js`.
 * Sibling repos are deliberately not created — see file header.
 */
beforeEach(() => {
  sandbox   = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-link-test-'));
  workspace = path.join(sandbox, 'ai-insights');
  script    = path.join(workspace, 'scripts', 'dev-link.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, script);
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/**
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runScript(args) {
  const r = spawnSync('node', [script, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    shell: false,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** @returns {string} */
function markerPath() {
  return path.join(workspace, '.dev-links.json');
}

// ─── status ───────────────────────────────────────────────────────────────────

describe('status subcommand', () => {
  it('reports PROD mode when no marker exists', () => {
    const r = runScript(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROD mode/);
  });

  it('reports DEV mode and lists linked packages when a marker exists', () => {
    fs.writeFileSync(markerPath(), JSON.stringify({
      linked:    { '@mistralys/cli-menu': '../cli-menu' },
      linked_at: '2026-08-25T12:00:00.000Z',
    }));
    const r = runScript(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/DEV mode/);
    expect(r.stdout).toContain('@mistralys/cli-menu');
    expect(r.stdout).toContain('2026-08-25T12:00:00.000Z');
  });

  it('defaults to status when no subcommand is given', () => {
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROD mode/);
  });

  it('treats an unreadable marker as absent', () => {
    fs.writeFileSync(markerPath(), 'not json');
    const r = runScript(['status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROD mode/);
    expect(r.stderr).toMatch(/unreadable/);
  });
});

// ─── link (AC-10, AC-11, AC-12) ───────────────────────────────────────────────

describe('link subcommand', () => {
  it('warns and skips when the sibling repo is absent, without erroring', () => {
    const r = runScript(['link']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/Sibling repo not found/);
    expect(r.stdout).toMatch(/Nothing linked/);
  });

  it('writes no marker file when nothing could be linked', () => {
    runScript(['link']);
    expect(fs.existsSync(markerPath())).toBe(false);
  });

  it('accepts --skip-build', () => {
    const r = runScript(['link', '--skip-build']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Nothing linked/);
  });

  it('restricts work to the named package with --package', () => {
    const r = runScript(['link', '--package', 'cli-menu']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('@mistralys/cli-menu');
    expect(r.stderr).not.toContain('@mistralys/persona-builder');
  });

  it('accepts the full scoped name for --package', () => {
    const r = runScript(['link', '--package', '@mistralys/persona-builder']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('@mistralys/persona-builder');
    expect(r.stderr).not.toContain('@mistralys/cli-menu');
  });

  it('exits non-zero on an unknown --package value', () => {
    const r = runScript(['link', '--package', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown package/);
  });

  it('preserves an existing marker entry when linking a different package', () => {
    fs.writeFileSync(markerPath(), JSON.stringify({
      linked:    { '@mistralys/cli-menu': '../cli-menu' },
      linked_at: '2026-08-25T12:00:00.000Z',
    }));
    runScript(['link', '--package', 'persona-builder']);
    const marker = JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
    expect(marker.linked['@mistralys/cli-menu']).toBe('../cli-menu');
  });
});

// ─── unlink (AC-02, AC-11) ────────────────────────────────────────────────────

describe('unlink subcommand', () => {
  it('removes the marker file entirely when all packages are unlinked', () => {
    fs.writeFileSync(markerPath(), JSON.stringify({
      linked:    { '@mistralys/cli-menu': '../cli-menu' },
      linked_at: '2026-08-25T12:00:00.000Z',
    }));
    const r = runScript(['unlink']);
    expect(fs.existsSync(markerPath())).toBe(false);
    expect(r.stdout).toMatch(/PROD mode/);
  });

  it('runs no npm install when nothing was linked', () => {
    const r = runScript(['unlink']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Nothing was linked/);
    expect(r.stdout).not.toMatch(/Restoring registry dependencies/);
  });

  it('keeps the other entry when unlinking a single package', () => {
    fs.writeFileSync(markerPath(), JSON.stringify({
      linked: {
        '@mistralys/cli-menu':        '../cli-menu',
        '@mistralys/persona-builder': '../ai-persona-builder',
      },
      linked_at: '2026-08-25T12:00:00.000Z',
    }));
    runScript(['unlink', '--package', 'cli-menu']);
    const marker = JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
    expect(marker.linked['@mistralys/cli-menu']).toBeUndefined();
    expect(marker.linked['@mistralys/persona-builder']).toBe('../ai-persona-builder');
  });
});

// ─── argument handling ────────────────────────────────────────────────────────

describe('unknown subcommand', () => {
  it('exits non-zero with a usage hint', () => {
    const r = runScript(['frobnicate']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown subcommand/);
  });
});
