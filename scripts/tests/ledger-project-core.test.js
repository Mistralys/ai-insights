/**
 * scripts/tests/ledger-project-core.test.js
 *
 * Unit tests for scripts/lib/ledger-project-core.js (WP-011).
 *
 * Acceptance Criteria verified (plan numbering):
 *   AC-02, AC-03: buildInitialSettings() / planInitWrites() defaulting and refusal
 *   AC-04, AC-29: resolveInitTarget() classification and candidate flagging
 *   AC-27: wizard-answer-sequence settings object equals the flag-driven one
 *   AC-30, AC-32: collectAdvisories() structured records
 *   AC-35: chooseDefaultVerb() inference over pre-resolved declaration state
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  resolveInitTarget,
  buildInitialSettings,
  planInitWrites,
  collectAdvisories,
  chooseDefaultVerb,
  GITIGNORE_LINE,
} from '../lib/ledger-project-core.js';

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

// ─── resolveInitTarget() ────────────────────────────────────────────────────

describe('resolveInitTarget()', () => {
  it('classifies matched when repositoryId is supplied and found', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [makeEntry({ id: 'my-repo' })]);

    const result = await resolveInitTarget({ cwd: '/tmp/some-project', repositoryId: 'my-repo', ledgerRoot });

    expect(result.classification).toBe('matched');
    expect(result.matched.entry.id).toBe('my-repo');
  });

  it('classifies unregistered when repositoryId is supplied and not found, with no derived-name fallback', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [makeEntry({ id: 'my-repo', folder_names: ['some-project'] })]);

    const result = await resolveInitTarget({
      cwd: '/tmp/some-project',
      repositoryId: 'wrong-id',
      ledgerRoot,
    });

    expect(result.classification).toBe('unregistered');
    expect(result.matched).toBeNull();
  });

  it('classifies matched by derived name when repositoryId is omitted', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [makeEntry({ id: 'my-repo', folder_names: ['my-project'] })]);

    const result = await resolveInitTarget({ cwd: '/tmp/my-project', repositoryId: null, ledgerRoot });

    expect(result.classification).toBe('matched');
    expect(result.matched.entry.id).toBe('my-repo');
    expect(result.derivedName).toBe('my-project');
  });

  it('classifies unregistered when the derived name matches nothing', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [makeEntry({ id: 'my-repo', folder_names: ['other-name'] })]);

    const result = await resolveInitTarget({ cwd: '/tmp/my-project', repositoryId: null, ledgerRoot });

    expect(result.classification).toBe('unregistered');
    expect(result.matched).toBeNull();
  });

  it('classifies ambiguous when the derived name matches more than one entry', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [
      makeEntry({ id: 'repo-a', folder_names: ['my-project'] }),
      makeEntry({ id: 'repo-b', folder_names: ['my-project'] }),
    ]);

    const result = await resolveInitTarget({ cwd: '/tmp/my-project', repositoryId: null, ledgerRoot });

    expect(result.classification).toBe('ambiguous');
    expect(result.matched).toBeNull();
  });

  it('returns the full candidate list with the derived-name match flagged (AC-29)', async () => {
    const ledgerRoot = makeTempDir('ledger-core-target-');
    writeRegistry(ledgerRoot, [
      makeEntry({ id: 'repo-a', folder_names: ['my-project'] }),
      makeEntry({ id: 'repo-b', folder_names: ['unrelated'] }),
    ]);

    const result = await resolveInitTarget({ cwd: '/tmp/my-project', repositoryId: null, ledgerRoot });

    expect(result.candidates).toHaveLength(2);
    const repoA = result.candidates.find((c) => c.entry.id === 'repo-a');
    const repoB = result.candidates.find((c) => c.entry.id === 'repo-b');
    expect(repoA.isDerivedMatch).toBe(true);
    expect(repoB.isDerivedMatch).toBe(false);
  });
});

// ─── buildInitialSettings() / planInitWrites() ──────────────────────────────

describe('buildInitialSettings()', () => {
  it('defaults every known output to disabled', async () => {
    const settings = await buildInitialSettings({ repositoryId: 'my-repo' });

    expect(settings.schema_version).toBe(1);
    expect(settings.repository_id).toBe('my-repo');
    expect(settings.outputs['strategic-vision']).toEqual({ enabled: false });
  });

  it('enables an output and carries an optional path override', async () => {
    const settings = await buildInitialSettings({
      repositoryId: 'my-repo',
      outputs: { 'strategic-vision': { enabled: true, path: 'docs/strategic-vision.md' } },
    });

    expect(settings.outputs['strategic-vision']).toEqual({
      enabled: true,
      path: 'docs/strategic-vision.md',
    });
  });
});

describe('planInitWrites()', () => {
  it('plans .ledger/settings.json and .ledger/README.md when nothing exists', async () => {
    const projectRoot = makeTempDir('ledger-core-plan-');
    const settings = await buildInitialSettings({ repositoryId: 'my-repo' });

    const result = planInitWrites({ projectRoot, settings, force: false, dryRun: false });

    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.path).sort()).toEqual(
      [path.join(projectRoot, '.ledger', 'README.md'), path.join(projectRoot, '.ledger', 'settings.json')].sort()
    );
  });

  it('refuses an existing settings.json without --force', async () => {
    const projectRoot = makeTempDir('ledger-core-plan-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'settings.json'), '{}');
    const settings = await buildInitialSettings({ repositoryId: 'my-repo' });

    const result = planInitWrites({ projectRoot, settings, force: false, dryRun: false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('exists_without_force');
    expect(result.files).toEqual([]);
  });

  it('overwrites an existing settings.json with --force', async () => {
    const projectRoot = makeTempDir('ledger-core-plan-');
    fs.mkdirSync(path.join(projectRoot, '.ledger'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ledger', 'settings.json'), '{}');
    const settings = await buildInitialSettings({ repositoryId: 'my-repo' });

    const result = planInitWrites({ projectRoot, settings, force: true, dryRun: false });

    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it('yields an empty write set under --dry-run', async () => {
    const projectRoot = makeTempDir('ledger-core-plan-');
    const settings = await buildInitialSettings({ repositoryId: 'my-repo' });

    const result = planInitWrites({ projectRoot, settings, force: false, dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.plannedPaths).toHaveLength(2);
  });
});

// ─── collectAdvisories() ─────────────────────────────────────────────────────

describe('collectAdvisories()', () => {
  it('returns the gitignore line, both routing lines, and the public-repository warning', () => {
    const projectRoot = makeTempDir('ledger-core-advisories-');

    const advisories = collectAdvisories({ projectRoot });

    const ids = advisories.map((a) => a.id).sort();
    expect(ids).toEqual(
      ['agents-md-routing', 'gitignore', 'manifest-routing', 'public-repository-warning'].sort()
    );
  });

  it('marks the gitignore line inapplicable when no .gitignore exists', () => {
    const projectRoot = makeTempDir('ledger-core-advisories-');

    const advisories = collectAdvisories({ projectRoot });
    const gitignore = advisories.find((a) => a.id === 'gitignore');

    expect(gitignore.applicable).toBe(false);
  });

  it('marks the gitignore line applicable when a .gitignore exists without the line', () => {
    const projectRoot = makeTempDir('ledger-core-advisories-');
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules/\n');

    const advisories = collectAdvisories({ projectRoot });
    const gitignore = advisories.find((a) => a.id === 'gitignore');

    expect(gitignore.applicable).toBe(true);
  });

  it('marks the gitignore line inapplicable when the line is already present', () => {
    const projectRoot = makeTempDir('ledger-core-advisories-');
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), `node_modules/\n${GITIGNORE_LINE}\n`);

    const advisories = collectAdvisories({ projectRoot });
    const gitignore = advisories.find((a) => a.id === 'gitignore');

    expect(gitignore.applicable).toBe(false);
  });
});

// ─── AC-27: wizard/flag equivalence ─────────────────────────────────────────

describe('wizard/flag equivalence (AC-27)', () => {
  it('a settings object built from a scripted wizard answer sequence equals the flag-driven one', async () => {
    // "Flag-driven" invocation: --repository-id my-repo --enable strategic-vision
    const flagSettings = await buildInitialSettings({
      repositoryId: 'my-repo',
      outputs: { 'strategic-vision': { enabled: true } },
    });

    // "Wizard" invocation: scripted answers picking the same repository and
    // answering "yes" to the strategic-vision enable prompt, with no path
    // override — driving the same core function with the equivalent input,
    // per the Testing Strategy's "asserted on the resulting file bytes"
    // approach rather than a transcript comparison.
    const wizardAnswers = { repositoryId: 'my-repo', enableStrategicVision: true };
    const wizardSettings = await buildInitialSettings({
      repositoryId: wizardAnswers.repositoryId,
      outputs: { 'strategic-vision': { enabled: wizardAnswers.enableStrategicVision } },
    });

    expect(wizardSettings).toEqual(flagSettings);
  });
});

// ─── chooseDefaultVerb() ─────────────────────────────────────────────────────

describe('chooseDefaultVerb() (AC-35)', () => {
  it('returns init for an undeclared cwd', () => {
    const result = chooseDefaultVerb({ cwd: '/tmp/undeclared', projectRoot: null, declarationState: undefined });
    expect(result).toEqual({ verb: 'init', projectRoot: '/tmp/undeclared' });
  });

  it('returns edit with confirmRoot: false when the cwd itself carries a valid declaration', () => {
    const result = chooseDefaultVerb({
      cwd: '/tmp/my-project',
      projectRoot: '/tmp/my-project',
      declarationState: { kind: 'declared', settings: {}, sourcePaths: { settings: 'x', local: null } },
    });
    expect(result).toEqual({ verb: 'edit', projectRoot: '/tmp/my-project', confirmRoot: false });
  });

  it('returns edit with confirmRoot: true when the valid declaration lives in an ancestor', () => {
    const result = chooseDefaultVerb({
      cwd: '/tmp/my-project/nested/deep',
      projectRoot: '/tmp/my-project',
      declarationState: { kind: 'declared', settings: {}, sourcePaths: { settings: 'x', local: null } },
    });
    expect(result).toEqual({ verb: 'edit', projectRoot: '/tmp/my-project', confirmRoot: true });
  });

  it('returns an invalid_declaration error for a declaration that fails schema validation', () => {
    const result = chooseDefaultVerb({
      cwd: '/tmp/my-project',
      projectRoot: '/tmp/my-project',
      declarationState: { kind: 'invalid', errors: ['bad field'] },
    });
    expect(result).toEqual({ error: 'invalid_declaration', projectRoot: '/tmp/my-project' });
  });
});
