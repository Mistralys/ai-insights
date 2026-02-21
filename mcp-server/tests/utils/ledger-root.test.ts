import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { resolveLedgerRoot, projectSlugFromPath } from '../../src/utils/ledger-root.js';

describe('resolveLedgerRoot', () => {
  let originalArgv: string[];

  beforeEach(() => {
    // Save original argv so we can restore it after each test
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('returns a path ending in storage/ledger when no --ledger-dir CLI argument is present', () => {
    // Remove any --ledger-dir flag that might be hanging around
    process.argv = process.argv.filter(
      (arg, i, arr) => arg !== '--ledger-dir' && arr[i - 1] !== '--ledger-dir'
    );

    const result = resolveLedgerRoot();
    // Normalise path separators for cross-platform comparison
    const normalised = result.replace(/\\/g, '/');
    expect(normalised).toMatch(/storage\/ledger$/);
  });

  it('returns the --ledger-dir value when the flag is present in process.argv', () => {
    const customPath = join('/custom', 'ledger', 'path');
    process.argv = [...process.argv, '--ledger-dir', customPath];

    const result = resolveLedgerRoot();
    expect(result).toBe(customPath);
  });

  it('uses the value immediately after --ledger-dir (not further along)', () => {
    // Simulates: node server.js --ledger-dir /override --other-flag value
    const overridePath = join('/my', 'override');
    process.argv = ['node', 'server.js', '--ledger-dir', overridePath, '--other-flag', 'value'];

    expect(resolveLedgerRoot()).toBe(overridePath);
  });

  it('throws a descriptive error when --ledger-dir flag is present with no value', () => {
    // Edge case: flag is the last argument with no following path
    process.argv = ['node', 'server.js', '--ledger-dir'];

    expect(() => resolveLedgerRoot()).toThrow(
      '--ledger-dir flag requires a path argument'
    );
  });

  it('throws a descriptive error when --ledger-dir is followed by another flag (not a path)', () => {
    process.argv = ['node', 'server.js', '--ledger-dir', '--other-flag'];

    expect(() => resolveLedgerRoot()).toThrow(
      '--ledger-dir flag requires a path argument'
    );
  });
});

describe('projectSlugFromPath', () => {
  it('correctly extracts the basename from an absolute path', () => {
    const path = join('/some', 'project', 'docs', 'plans', '2026-02-16-my-feature');
    expect(projectSlugFromPath(path)).toBe('2026-02-16-my-feature');
  });

  it('correctly extracts slug from a Windows-style path', () => {
    const winPath = 'C:\\Projects\\docs\\plans\\2026-03-15-feature-x';
    expect(projectSlugFromPath(winPath)).toBe('2026-03-15-feature-x');
  });

  it('throws on invalid basename that does not match YYYY-MM-DD-{name}', () => {
    const invalid = join('/home', 'user', 'project', 'my-project');
    expect(() => projectSlugFromPath(invalid)).toThrow('Invalid project path format');
  });

  it('throws when basename is only a date with no project name suffix', () => {
    const onlyDate = join('/tmp', '2026-02-16');
    expect(() => projectSlugFromPath(onlyDate)).toThrow('Invalid project path format');
  });

  it('returns the full basename including multiple hyphens', () => {
    const path = join('/tmp', '2026-12-31-year-end-cleanup-final');
    expect(projectSlugFromPath(path)).toBe('2026-12-31-year-end-cleanup-final');
  });
});
