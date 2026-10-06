/**
 * scripts/tests/name-mapping.test.js
 *
 * Unit tests for scripts/lib/name-mapping.js — the extracted name-mapping
 * generator (WP-004 of the 2026-10-01-persona-targets-and-tool-validation-rework-2
 * plan). The byte-identical-output oracle for this extraction (comparing a
 * real build's personas/name-mapping.json against the WP-001 baseline) is
 * exercised manually as part of the WP, not in this fixture suite — this
 * file covers the extracted module's own behavior in isolation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  generateNameMapping,
  writeNameMapping,
  resolveVersionFromChangelog,
  validateChangelogField,
  deriveRole,
} from '../lib/name-mapping.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'name-mapping-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFileAt(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Builds a fixture personas/ directory with:
 *   - a ledger suite: _shared.yaml (default_version '1.0.0') + two numbered
 *     personas (one with a dated changelog entry, one with no version info
 *     at all, so it falls back to default_version);
 *   - a standalone suite: _shared.yaml + a valid persona, a persona with no
 *     `id` (malformed — skipped), and a persona with no `cc_file_name` (no
 *     output target — skipped);
 *   - a ledger-support suite: one valid persona, used to verify cross-suite
 *     sort order against standalone;
 *   - a minimal model-registry so resolveModel() has a registry entry to
 *     resolve the shared default slug against.
 */
function makeFixturePersonasDir() {
  const personasDir = makeTempDir();

  writeFileAt(
    path.join(personasDir, 'ledger', 'src', 'meta', '_shared.yaml'),
    [
      "default_version: '1.0.0'",
      "default_model: 'Claude Sonnet'",
      "default_model_slug: 'claude-sonnet'",
      '',
    ].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'ledger', 'src', 'meta', '1-planner.yaml'),
    [
      'number: 1',
      'role: Planner',
      'id: planner-id',
      'cc_file_name: 1-planner.md',
      'vs_file_name: 1-planner.agent.md',
      'changelog: |',
      '  2.0.0 (2026-01-01): Initial release.',
      '',
    ].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'ledger', 'src', 'meta', '2-developer.yaml'),
    [
      'number: 2',
      'role: Developer',
      'id: developer-id',
      'cc_file_name: 2-developer.md',
      'vs_file_name: 2-developer.agent.md',
      '',
    ].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'standalone', 'src', 'meta', '_shared.yaml'),
    ["default_model_slug: 'claude-sonnet'", ''].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'standalone', 'src', 'meta', 'researcher.yaml'),
    [
      'id: researcher-id',
      'name: Researcher (Standalone)',
      'cc_file_name: researcher.md',
      "version: '1.2.0'",
      '',
    ].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'standalone', 'src', 'meta', 'malformed-no-id.yaml'),
    ['name: No Id (Standalone)', 'cc_file_name: no-id.md', ''].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'standalone', 'src', 'meta', 'no-cc-file.yaml'),
    ['id: no-cc-id', 'name: No Output (Standalone)', ''].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'ledger-support', 'src', 'meta', 'helper.yaml'),
    [
      'id: helper-id',
      'name: Zeta Helper (Ledger Support)',
      'cc_file_name: zeta-helper.md',
      "version: '1.0.0'",
      '',
    ].join('\n'),
  );

  writeFileAt(
    path.join(personasDir, 'model-registry', 'default.json'),
    JSON.stringify(
      [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Claude Sonnet',
          slug: 'claude-sonnet',
          cc_model: 'claude-sonnet-4-5',
        },
      ],
      null,
      2,
    ),
  );

  return personasDir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ─── generateNameMapping() — ledger entries ─────────────────────────────────

describe('generateNameMapping() — ledger entries', () => {
  it('orders ledger entries by number and formats vscode.agent_name as "{number} - {role} v{version}"', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const ledger = entries.filter((e) => e.suite === 'ledger');
    expect(ledger.map((e) => e.number)).toEqual([1, 2]);
    expect(ledger[0].vscode.agent_name).toBe('1 - Planner v2.0.0');
    expect(ledger[1].vscode.agent_name).toBe('2 - Developer v1.0.0');
  });

  it('resolves version from a dated changelog entry over any fallback', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const planner = entries.find((e) => e.id === 'planner-id');
    expect(planner.version).toBe('2.0.0');
  });

  it('falls back to default_version when a persona has no changelog and no version field', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const developer = entries.find((e) => e.id === 'developer-id');
    expect(developer.version).toBe('1.0.0');
  });

  it('resolves the shared default model slug via the model registry', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const planner = entries.find((e) => e.id === 'planner-id');
    expect(planner.model_slug).toBe('claude-sonnet');
    expect(planner.model).toBe('Claude Sonnet');
    expect(planner.cc_model).toBe('claude-sonnet-4-5');
  });
});

// ─── generateNameMapping() — non-ledger entries ─────────────────────────────

describe('generateNameMapping() — non-ledger entries', () => {
  it('skips a persona file with no id, and one with no cc_file_name', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries, nonLedgerCount } = generateNameMapping({
      personasDir,
      warn: () => {},
      info: () => {},
    });

    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain(undefined);
    expect(entries.find((e) => e.role === 'No Id')).toBeUndefined();
    expect(entries.find((e) => e.role === 'No Output')).toBeUndefined();
    // Exactly the two valid non-ledger personas (researcher, Zeta Helper) survive.
    expect(nonLedgerCount).toBe(2);
  });

  it('sorts non-ledger entries alphabetically by suite then role, and derives role via deriveRole()', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const nonLedger = entries.filter((e) => e.suite !== 'ledger');
    // 'ledger-support' < 'standalone' alphabetically.
    expect(nonLedger.map((e) => e.suite)).toEqual(['ledger-support', 'standalone']);
    expect(nonLedger.map((e) => e.role)).toEqual(['Zeta Helper', 'Researcher']);
  });

  it('uses the explicit version field when no changelog is present', () => {
    const personasDir = makeFixturePersonasDir();
    const { entries } = generateNameMapping({ personasDir, warn: () => {}, info: () => {} });

    const researcher = entries.find((e) => e.id === 'researcher-id');
    expect(researcher.version).toBe('1.2.0');
  });
});

// ─── deriveRole() ────────────────────────────────────────────────────────────

describe('deriveRole()', () => {
  it('strips a trailing "(Standalone)" suffix', () => {
    expect(deriveRole('Developer (Standalone)')).toBe('Developer');
  });

  it('strips a trailing "(Ledger Support)" suffix', () => {
    expect(deriveRole('Ledger Bootstrapper (Ledger Support)')).toBe('Ledger Bootstrapper');
  });

  it('leaves a name with no recognized suffix unchanged', () => {
    expect(deriveRole('Ledger Bootstrapper')).toBe('Ledger Bootstrapper');
  });
});

// ─── resolveVersionFromChangelog() ──────────────────────────────────────────

describe('resolveVersionFromChangelog()', () => {
  it('resolves the first dated entry', () => {
    const raw = ['changelog: |', '  3.6.3 (2026-05-29): description', ''].join('\n');
    expect(resolveVersionFromChangelog(raw)).toBe('3.6.3');
  });

  it('resolves the first undated entry when no dated entry is present', () => {
    const raw = ['changelog: |', '  3.6.3: description', ''].join('\n');
    expect(resolveVersionFromChangelog(raw)).toBe('3.6.3');
  });

  it('returns undefined when there is no changelog block', () => {
    expect(resolveVersionFromChangelog('role: Planner\n')).toBeUndefined();
  });
});

// ─── validateChangelogField() ───────────────────────────────────────────────

describe('validateChangelogField()', () => {
  it('warns when the changelog is present but no parseable version is found', () => {
    const warnings = [];
    const raw = ['changelog: |', '  not a version line', ''].join('\n');
    validateChangelogField(raw, 'bad.yaml', { warn: (m) => warnings.push(m), info: () => {} });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no parseable version found/);
  });

  it('warns when the first changelog entry has no date', () => {
    const warnings = [];
    const raw = ['changelog: |', '  1.0.0: no date here', ''].join('\n');
    validateChangelogField(raw, 'undated.yaml', { warn: (m) => warnings.push(m), info: () => {} });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/first entry has no date/);
  });

  it('routes an info message when an explicit version field coexists with the changelog', () => {
    const infos = [];
    const raw = [
      "version: '9.9.9'",
      'changelog: |',
      '  1.0.0 (2026-01-01): first.',
      '',
    ].join('\n');
    validateChangelogField(raw, 'coexist.yaml', { warn: () => {}, info: (m) => infos.push(m) });

    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatch(/explicit version "9\.9\.9" coexists with changelog/);
  });

  it('routes an info message when an explicit last_updated field coexists with the changelog', () => {
    const infos = [];
    const raw = [
      "last_updated: '2026-01-01'",
      'changelog: |',
      '  1.0.0 (2026-01-01): first.',
      '',
    ].join('\n');
    validateChangelogField(raw, 'coexist2.yaml', { warn: () => {}, info: (m) => infos.push(m) });

    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatch(/explicit last_updated "2026-01-01" coexists with changelog/);
  });

  it('does nothing when there is no changelog field at all', () => {
    const warnings = [];
    const infos = [];
    validateChangelogField('role: Planner\n', 'none.yaml', {
      warn: (m) => warnings.push(m),
      info: (m) => infos.push(m),
    });

    expect(warnings).toHaveLength(0);
    expect(infos).toHaveLength(0);
  });

  it('defaults warn/info to console.warn/console.info when no io is supplied', () => {
    // Exercises the default-parameter branch directly (no injected io object).
    expect(() => validateChangelogField('role: Planner\n', 'none.yaml')).not.toThrow();
  });
});

// ─── writeNameMapping() ──────────────────────────────────────────────────────

describe('writeNameMapping()', () => {
  it('writes two-space-indented JSON with a single trailing newline', () => {
    const dir = makeTempDir();
    const outPath = path.join(dir, 'name-mapping.json');
    const entries = [{ id: 'a', suite: 'ledger' }];

    writeNameMapping(outPath, entries);
    const raw = fs.readFileSync(outPath, 'utf8');

    expect(raw).toBe(JSON.stringify(entries, null, 2) + '\n');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.endsWith('\n\n')).toBe(false);
    expect(raw).toContain('\n    "id": "a",');
  });
});
