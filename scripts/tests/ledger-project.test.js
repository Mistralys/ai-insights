/**
 * scripts/tests/ledger-project.test.js
 *
 * Shell-level tests for scripts/ledger-project.js: `init` and `edit`
 * (WP-012), each in their non-interactive (flag-driven) and wizard shells,
 * plus `sync` (WP-013), which has no wizard shell — it never prompts.
 *
 * These drive the real compiled `mcp-server/dist/` modules (via
 * `scripts/lib/ledger-bridge.js`) against isolated temp directories — no
 * mocking of the bridge — following the same approach as
 * `scripts/tests/ledger-bridge.test.js` and
 * `scripts/tests/ledger-project-core.test.js`. Every test passes an explicit
 * `ledgerRoot` override so single-store (legacy) mode is exercised without
 * bootstrapping the real multi-store context, and without touching the live
 * workspace ledger (constraints-testing.md; insight d6f8fa4d).
 *
 * Acceptance Criteria verified (plan numbering):
 *   AC-02, AC-03, AC-04: init non-interactive create/refuse/dry-run/unregistered
 *   AC-19: both verbs write relative to the `cwd` they were given, not the workspace root
 *   AC-27: wizard and flag-driven init produce equal settings.json content
 *   AC-28: no TTY + missing required input exits non-zero naming the flag, for both verbs
 *   AC-30: public-repository warning is printed before each enable prompt; declining writes no mirror
 *   AC-31: edit prefills, writes settings.json only, rejects --force, errors on not_declared/invalid,
 *          and disabling an output removes a marker-carrying mirror
 *   AC-32: the wizard's .gitignore offer is confirmation-gated, a no-op when present, skipped when absent
 *   AC-05, AC-06, AC-11: sync writes enabled outputs, reports unchanged on a no-op re-run, and exits
 *          non-zero when a sync record reports blocked
 *   AC-12: sync --check exits 1 when stale/missing, exits 0 when current, and writes nothing either way
 *   AC-19 (sync): errors on not_declared/invalid naming the walked directory and pointing at ledger init,
 *          and resolves relative to the supplied cwd, not the workspace root
 *   AC-28 (sync): never prompts, in either mode
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { runInit, runEdit, runSync } from '../ledger-project.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function writeRegistry(ledgerRoot, entries) {
  fs.mkdirSync(ledgerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerRoot, '.repositories.json'),
    JSON.stringify({ repositories: entries }, null, 2)
  );
}

function makeEntry(overrides = {}) {
  return {
    id: 'my-repo',
    label: 'My Repo',
    folder_names: ['my-repo'],
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Captures log/errorLog lines and prompt questions into one ordered array (for AC-30's ordering check). */
function captureIO(answers = []) {
  const lines = [];
  const queue = [...answers];
  return {
    lines,
    log: (line) => lines.push(`LOG: ${line}`),
    errorLog: (line) => lines.push(`ERR: ${line}`),
    readAnswer: async (question) => {
      lines.push(`PROMPT: ${question}`);
      return queue.shift() ?? '';
    },
  };
}

/** A project directory whose basename matches a registry entry's folder_names entry, so wizard tests resolve by derived-name match without an extra selection prompt. */
function makeMatchingProjectDir(folderName = 'my-repo') {
  const dir = path.join(makeTempDir('ledger-init-parent-'), folderName);
  fs.mkdirSync(dir);
  return dir;
}

function readSettings(projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, '.ledger', 'settings.json'), 'utf-8'));
}

// ─── init: non-interactive ──────────────────────────────────────────────────

describe('runInit() — non-interactive', () => {
  it('creates .ledger/README.md and settings.json with all outputs disabled (AC-02)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-init-project-');
    const io = captureIO();

    const code = await runInit({
      cwd: projectRoot,
      args: ['--repository-id', 'my-repo'],
      isTTY: false,
      ledgerRoot,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, '.ledger', 'README.md'))).toBe(true);
    const settings = readSettings(projectRoot);
    expect(settings.repository_id).toBe('my-repo');
    expect(settings.outputs['strategic-vision']).toEqual({ enabled: false });
  });

  it('resolves the entry by --enable and writes it enabled', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-init-project-');

    const code = await runInit({
      cwd: projectRoot,
      args: ['--repository-id', 'my-repo', '--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(code).toBe(0);
    expect(readSettings(projectRoot).outputs['strategic-vision'].enabled).toBe(true);
  });

  it('resolves the entry by folder-name derivation when --repository-id is omitted', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry({ folder_names: ['derived-project'] })]);
    const projectRoot = path.join(makeTempDir('ledger-init-parent-'), 'derived-project');
    fs.mkdirSync(projectRoot);

    const code = await runInit({
      cwd: projectRoot,
      args: ['--dry-run'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(code).toBe(0);
  });

  it('refuses to overwrite an existing settings.json without --force (AC-03)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-init-project-');
    const baseArgs = { cwd: projectRoot, isTTY: false, ledgerRoot, log: () => {}, errorLog: () => {} };

    const first = await runInit({ ...baseArgs, args: ['--repository-id', 'my-repo'] });
    expect(first).toBe(0);

    const second = await runInit({ ...baseArgs, args: ['--repository-id', 'my-repo'] });
    expect(second).toBe(1);

    const third = await runInit({ ...baseArgs, args: ['--repository-id', 'my-repo', '--force'] });
    expect(third).toBe(0);
  });

  it('writes nothing under --dry-run (AC-03)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-init-project-');

    const code = await runInit({
      cwd: projectRoot,
      args: ['--repository-id', 'my-repo', '--dry-run'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, '.ledger'))).toBe(false);
  });

  it('exits non-zero pointing at the dashboard Strategy page for an unregistered repository (AC-04)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, []);
    const projectRoot = makeTempDir('ledger-init-project-');
    const io = captureIO();

    const code = await runInit({
      cwd: projectRoot,
      args: ['--repository-id', 'nope'],
      isTTY: false,
      ledgerRoot,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(1);
    expect(fs.existsSync(path.join(projectRoot, '.ledger'))).toBe(false);
    expect(io.lines.some((line) => line.includes('dashboard Strategy page'))).toBe(true);
  });

  it('exits non-zero naming --repository-id when the derived name is ambiguous and stdin is not a TTY (AC-28)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [
      makeEntry({ id: 'repo-a', folder_names: ['ambiguous-project'] }),
      makeEntry({ id: 'repo-b', folder_names: ['ambiguous-project'] }),
    ]);
    const projectRoot = path.join(makeTempDir('ledger-init-parent-'), 'ambiguous-project');
    fs.mkdirSync(projectRoot);
    const io = captureIO();

    const code = await runInit({ cwd: projectRoot, args: [], isTTY: false, ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('--repository-id'))).toBe(true);
  });

  it('writes relative to the supplied cwd, not the workspace root (AC-19)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-init-project-');

    await runInit({
      cwd: projectRoot,
      args: ['--repository-id', 'my-repo'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(fs.existsSync(path.join(projectRoot, '.ledger', 'settings.json'))).toBe(true);
  });
});

// ─── init: wizard ────────────────────────────────────────────────────────────

describe('runInit() — wizard', () => {
  it('produces a settings.json equal to the flag-driven invocation for the same choices (AC-27)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry({ folder_names: ['wizard-project'] })]);

    const flagProjectRoot = path.join(makeTempDir('ledger-init-flag-'), 'wizard-project');
    fs.mkdirSync(flagProjectRoot);
    const flagCode = await runInit({
      cwd: flagProjectRoot,
      args: ['--repository-id', 'my-repo', '--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });
    expect(flagCode).toBe(0);

    const wizardProjectRoot = path.join(makeTempDir('ledger-init-wizard-'), 'wizard-project');
    fs.mkdirSync(wizardProjectRoot);
    // Answers: confirm root, enable strategic-vision, keep default path,
    // confirm write, decline "run sync now".
    const io = captureIO(['y', 'y', '', 'y', 'n']);
    const wizardCode = await runInit({
      cwd: wizardProjectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });
    expect(wizardCode).toBe(0);

    expect(readSettings(wizardProjectRoot)).toEqual(readSettings(flagProjectRoot));
  });

  it('prints the public-repository warning immediately above the enable prompt, defaults to No, and declining writes no mirror (AC-30)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeMatchingProjectDir();

    // Answers: confirm root, decline enable (empty -> default No), confirm write.
    const io = captureIO(['y', '', 'y']);
    const code = await runInit({
      cwd: projectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    const warningIndex = io.lines.findIndex((line) => line.includes('public repository'));
    const enablePromptIndex = io.lines.findIndex((line) => line.startsWith('PROMPT:') && line.includes('Enable'));
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(enablePromptIndex).toBe(warningIndex + 1);

    const settings = readSettings(projectRoot);
    expect(settings.outputs['strategic-vision'].enabled).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, '.ledger', 'strategic-vision.md'))).toBe(false);
  });

  it('appends the .gitignore line only on explicit confirmation (AC-32)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeMatchingProjectDir();
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n');

    // Answers: confirm root, decline enable, confirm write, confirm gitignore append.
    const io = captureIO(['y', '', 'y', 'y']);
    const code = await runInit({
      cwd: projectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    const gitignoreContents = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    expect(gitignoreContents).toContain('/.ledger/settings.local.json');
  });

  it('skips the .gitignore prompt entirely when no .gitignore exists (AC-32)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeMatchingProjectDir();

    // No gitignore-append answer queued — if the shell prompted for it
    // anyway, the queue would run dry and the missing-answer default ('')
    // would be misread as a real answer; asserting no such prompt line
    // appears is the actual check.
    const io = captureIO(['y', '', 'y']);
    const code = await runInit({
      cwd: projectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, '.gitignore'))).toBe(false);
    expect(io.lines.some((line) => line.startsWith('PROMPT:') && line.includes('Append'))).toBe(false);
  });

  it('is a no-op when the .gitignore line is already present, and never prompts for it (AC-32)', async () => {
    const ledgerRoot = makeTempDir('ledger-init-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeMatchingProjectDir();
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n/.ledger/settings.local.json\n');
    const before = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');

    const io = captureIO(['y', '', 'y']);
    const code = await runInit({
      cwd: projectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8')).toBe(before);
    expect(io.lines.some((line) => line.startsWith('PROMPT:') && line.includes('Append'))).toBe(false);
  });
});

// ─── edit ────────────────────────────────────────────────────────────────────

describe('runEdit() — non-interactive', () => {
  function declareProject(ledgerRoot) {
    const projectRoot = makeTempDir('ledger-edit-project-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.ledger', 'settings.json'),
      `${JSON.stringify(
        { schema_version: 1, repository_id: 'my-repo', outputs: { 'strategic-vision': { enabled: false } } },
        null,
        2
      )}\n`
    );
    return projectRoot;
  }

  it('enables an output via --enable, writing settings.json only (AC-31)', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'settings.local.json'), '{"schema_version":1}\n');
    const localBefore = fs.readFileSync(path.join(projectRoot, '.ledger', 'settings.local.json'), 'utf-8');

    const code = await runEdit({
      cwd: projectRoot,
      args: ['--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(code).toBe(0);
    expect(readSettings(projectRoot).outputs['strategic-vision'].enabled).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, '.ledger', 'settings.local.json'), 'utf-8')).toBe(localBefore);
  });

  it('rejects --force', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);

    const code = await runEdit({
      cwd: projectRoot,
      args: ['--force'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });

    expect(code).toBe(1);
  });

  it('errors pointing at ledger init for an undeclared project', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    const projectRoot = makeTempDir('ledger-edit-undeclared-');
    const io = captureIO();

    const code = await runEdit({
      cwd: projectRoot,
      args: ['--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('ledger init'))).toBe(true);
  });

  it('errors pointing at ledger init for an invalid declaration', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    const projectRoot = makeTempDir('ledger-edit-invalid-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'settings.json'), '{"schema_version": 2}');
    const io = captureIO();

    const code = await runEdit({
      cwd: projectRoot,
      args: ['--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('ledger init'))).toBe(true);
  });

  it('exits non-zero naming --enable/--disable when stdin is not a TTY and nothing was specified (AC-28)', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const io = captureIO();

    const code = await runEdit({ cwd: projectRoot, args: [], isTTY: false, ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('--enable') && line.includes('--disable'))).toBe(true);
  });

  it('disabling an enabled output removes a marker-carrying mirror the same way a hand-edited enabled:false would (AC-31)', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const mirrorPath = path.join(projectRoot, '.ledger', 'strategic-vision.md');

    const enableCode = await runEdit({
      cwd: projectRoot,
      args: ['--enable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });
    expect(enableCode).toBe(0);
    expect(fs.existsSync(mirrorPath)).toBe(true);

    const disableCode = await runEdit({
      cwd: projectRoot,
      args: ['--disable', 'strategic-vision'],
      isTTY: false,
      ledgerRoot,
      log: () => {},
      errorLog: () => {},
    });
    expect(disableCode).toBe(0);
    expect(fs.existsSync(mirrorPath)).toBe(false);
  });
});

describe('runEdit() — wizard', () => {
  it('prefills every prompt with the current value', async () => {
    const ledgerRoot = makeTempDir('ledger-edit-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = makeTempDir('ledger-edit-project-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.ledger', 'settings.json'),
      `${JSON.stringify(
        { schema_version: 1, repository_id: 'my-repo', outputs: { 'strategic-vision': { enabled: true } } },
        null,
        2
      )}\n`
    );

    // Answers: empty -> keep the prefilled "enabled: true" default; empty
    // path -> keep the current (default) path.
    const io = captureIO(['', '']);
    const code = await runEdit({
      cwd: projectRoot,
      args: [],
      isTTY: true,
      ledgerRoot,
      readAnswer: io.readAnswer,
      log: io.log,
      errorLog: io.errorLog,
    });

    expect(code).toBe(0);
    expect(readSettings(projectRoot).outputs['strategic-vision'].enabled).toBe(true);
    const enablePrompt = io.lines.find((line) => line.startsWith('PROMPT:') && line.includes('Enable'));
    expect(enablePrompt).toContain('Y/n');
  });
});

// ─── sync ────────────────────────────────────────────────────────────────────

describe('runSync()', () => {
  function declareProject(ledgerRoot, { enabled = true } = {}) {
    const projectRoot = makeTempDir('ledger-sync-project-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.ledger', 'settings.json'),
      `${JSON.stringify(
        { schema_version: 1, repository_id: 'my-repo', outputs: { 'strategic-vision': { enabled } } },
        null,
        2
      )}\n`
    );
    return projectRoot;
  }

  it('writes the enabled output and reports unchanged on a re-run with no vision change (AC-05, AC-06)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const mirrorPath = path.join(projectRoot, '.ledger', 'strategic-vision.md');
    const io = captureIO();

    const firstCode = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io.log, errorLog: io.errorLog });
    expect(firstCode).toBe(0);
    expect(fs.existsSync(mirrorPath)).toBe(true);
    expect(io.lines.some((line) => line.includes('written'))).toBe(true);

    const io2 = captureIO();
    const secondCode = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io2.log, errorLog: io2.errorLog });
    expect(secondCode).toBe(0);
    expect(io2.lines.some((line) => line.includes('unchanged'))).toBe(true);
  });

  it('exits non-zero when a sync record reports blocked (AC-11)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    // A hand-authored file with no ai-insights sync marker at the mirror's
    // default path blocks the write (per syncProjectOutputs()'s unmarked-file
    // guard) rather than being silently overwritten.
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'strategic-vision.md'), 'hand-authored, no marker\n');
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('BLOCKED'))).toBe(true);
  });

  it('--check exits 1 when the output is missing/stale and writes nothing (AC-12)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const mirrorPath = path.join(projectRoot, '.ledger', 'strategic-vision.md');
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: ['--check'], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(fs.existsSync(mirrorPath)).toBe(false);
  });

  it('--check exits 0 and writes nothing when the output is already current (AC-12)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const mirrorPath = path.join(projectRoot, '.ledger', 'strategic-vision.md');

    const writeCode = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: () => {}, errorLog: () => {} });
    expect(writeCode).toBe(0);
    const contentsBefore = fs.readFileSync(mirrorPath, 'utf-8');

    const io = captureIO();
    const checkCode = await runSync({ cwd: projectRoot, args: ['--check'], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(checkCode).toBe(0);
    expect(fs.readFileSync(mirrorPath, 'utf-8')).toBe(contentsBefore);
    expect(io.lines.some((line) => line.includes('current'))).toBe(true);
  });

  it('errors pointing at ledger init and naming the walked directory for an undeclared project (AC-19)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    const projectRoot = makeTempDir('ledger-sync-undeclared-');
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('ledger init'))).toBe(true);
    expect(io.lines.some((line) => line.includes(projectRoot))).toBe(true);
  });

  it('errors pointing at ledger init for an invalid declaration (AC-19)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    const projectRoot = makeTempDir('ledger-sync-invalid-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'settings.json'), '{"schema_version": 2}');
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(io.lines.some((line) => line.includes('ledger init'))).toBe(true);
  });

  it('resolves relative to the supplied cwd, not the workspace root (AC-19)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);

    const code = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: () => {}, errorLog: () => {} });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, '.ledger', 'strategic-vision.md'))).toBe(true);
  });

  it('rejects an unknown flag without writing anything', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot);
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: ['--bogus'], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(1);
    expect(fs.existsSync(path.join(projectRoot, '.ledger', 'strategic-vision.md'))).toBe(false);
  });

  it('is disabled -> skipped and never prompts, since runSync() has no readAnswer parameter (AC-28)', async () => {
    const ledgerRoot = makeTempDir('ledger-sync-');
    writeRegistry(ledgerRoot, [makeEntry()]);
    const projectRoot = declareProject(ledgerRoot, { enabled: false });
    const io = captureIO();

    const code = await runSync({ cwd: projectRoot, args: [], ledgerRoot, log: io.log, errorLog: io.errorLog });

    expect(code).toBe(0);
    expect(io.lines.some((line) => line.startsWith('PROMPT:'))).toBe(false);
    expect(io.lines.some((line) => line.includes('disabled, nothing to do'))).toBe(true);
  });
});
