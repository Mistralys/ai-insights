/**
 * scripts/tests/publish-skills.test.js
 *
 * Integration tests for scripts/publish-skills.js.
 * Runs the script as a subprocess (spawnSync) to test real exit codes and output.
 *
 * Acceptance Criteria verified:
 *   AC-01: `node scripts/publish-skills.js --dry-run` writes zero files to deployment targets.
 *   AC-04: A test file exists and passes, covering the --dry-run no-write guarantee.
 *
 * Test strategy: create minimal .md skill files in dist/vscode-skills/ and
 * dist/claude-skills/ under a unique test stem, run the script with --dry-run,
 * assert on exit code and stdout, and verify no files were deployed. Clean up
 * only the test-owned files. For the "no built files" scenario, snapshot + delete
 * all dist .md files before the test and restore them afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '..', '..');
const SCRIPT       = path.join(ROOT, 'scripts', 'publish-skills.js');
const DIST_VSCODE  = path.join(ROOT, 'dist', 'vscode-skills');
const DIST_CLAUDE  = path.join(ROOT, 'dist', 'claude-skills');
const GH_SKILLS    = path.join(ROOT, '.github', 'skills');

/** Unique stem used only by these tests — will never clash with real skills. */
const TEST_STEM = 'test-skill-publish-abc123';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run publish-skills.js with the given args via spawnSync.
 * @param {...string} args
 * @returns {{ exitCode: number|null, stdout: string, stderr: string }}
 */
function runPublishSkills(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  return {
    exitCode: result.status,
    stdout:   result.stdout ?? '',
    stderr:   result.stderr ?? '',
  };
}

/**
 * Read all .md files from dir into memory.
 * Returns [] if the directory does not exist.
 * @param {string} dir
 * @returns {{ name: string, content: string }[]}
 */
function snapshotDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Delete all .md files from dir (leaves the directory itself intact).
 * @param {string} dir
 */
function deleteAllMdFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    fs.unlinkSync(path.join(dir, f));
  }
}

/**
 * Restore files previously captured by snapshotDir.
 * @param {string} dir
 * @param {{ name: string, content: string }[]} snapshot
 */
function restoreDir(dir, snapshot) {
  if (snapshot.length === 0) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const { name, content } of snapshot) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
}

/**
 * Write a minimal .md file into the given dist directory for the test stem.
 * @param {string} distDir
 * @param {string} stem
 */
function writeTestDistFile(distDir, stem) {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, `${stem}.md`), `# ${stem}\nTest content.\n`, 'utf8');
}

/**
 * Remove a file if it exists (no-op otherwise).
 * @param {string} p
 */
function removeIfExists(p) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ─── dry-run tests ────────────────────────────────────────────────────────────

describe('publish-skills.js --dry-run', () => {
  beforeAll(() => {
    // Plant a minimal test skill in both dist dirs so the script has something to report.
    writeTestDistFile(DIST_VSCODE, TEST_STEM);
    writeTestDistFile(DIST_CLAUDE, TEST_STEM);
  });

  afterAll(() => {
    // Remove only the test-owned dist files — never touch other dist content.
    removeIfExists(path.join(DIST_VSCODE, `${TEST_STEM}.md`));
    removeIfExists(path.join(DIST_CLAUDE, `${TEST_STEM}.md`));
  });

  it('exits with code 0', () => {
    const { exitCode } = runPublishSkills('--dry-run');
    expect(exitCode).toBe(0);
  });

  it('stdout contains [dry-run] marker for the test stem', () => {
    const { stdout } = runPublishSkills('--dry-run');
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain(TEST_STEM);
  });

  it('stdout ends with a (dry-run) summary line', () => {
    const { stdout } = runPublishSkills('--dry-run');
    expect(stdout).toMatch(/would be published \(dry-run\)/);
  });

  it('does not write any file to .github/skills/ for the test stem', () => {
    runPublishSkills('--dry-run');
    const deployedPath = path.join(GH_SKILLS, TEST_STEM, 'SKILL.md');
    expect(fs.existsSync(deployedPath)).toBe(false);
  });
});

// ─── exit code when no built files exist ─────────────────────────────────────

describe('publish-skills.js with no built dist files', () => {
  let vsBackup = /** @type {{ name: string, content: string }[]} */ ([]);
  let ccBackup = /** @type {{ name: string, content: string }[]} */ ([]);

  /** Restore dist dirs — safe to call multiple times. */
  function restore() {
    restoreDir(DIST_VSCODE, vsBackup);
    restoreDir(DIST_CLAUDE, ccBackup);
  }

  beforeAll(() => {
    // Back up all .md files from both dist dirs and delete them.
    vsBackup = snapshotDir(DIST_VSCODE);
    ccBackup = snapshotDir(DIST_CLAUDE);
    deleteAllMdFiles(DIST_VSCODE);
    deleteAllMdFiles(DIST_CLAUDE);
    // Guard against aborted test runs: restore on process exit.
    process.once('exit', restore);
  });

  afterAll(() => {
    // Restore the dist dirs to their pre-test state.
    restore();
    // Remove the exit guard now that cleanup has completed normally.
    process.removeListener('exit', restore);
  });

  it('exits with code 1', () => {
    const { exitCode } = runPublishSkills();
    expect(exitCode).toBe(1);
  });

  it('prints an error message to stderr', () => {
    const { stderr } = runPublishSkills();
    expect(stderr).toContain('[publish-skills]');
  });
});
