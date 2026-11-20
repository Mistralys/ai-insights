import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { issueTemporaryCode, listTemporaryCodes } from '../../src/error-codes/temporary-codes.js';
import type { TemporaryCodeEntryInput } from '../../src/error-codes/temporary-codes.js';

function entry(overrides: Partial<TemporaryCodeEntryInput> = {}): TemporaryCodeEntryInput {
  return {
    provider: null,
    fallback_reason: null,
    detail: null,
    repository: null,
    context: null,
    ...overrides,
  };
}

describe('temporary-codes', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'temporary-codes-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('issueTemporaryCode', () => {
    it.skipIf(platform() === 'win32')('writes temporary-codes.json with mode 0600', async () => {
      await issueTemporaryCode(tempDir, '777', entry());
      const info = await stat(join(tempDir, 'temporary-codes.json'));
      expect(info.mode & 0o777).toBe(0o600);
    });

    it.skipIf(platform() === 'win32')('tightens an existing 0644 file to 0600 on the next issuance', async () => {
      await issueTemporaryCode(tempDir, '777', entry());
      const file = join(tempDir, 'temporary-codes.json');
      await chmod(file, 0o644);
      await issueTemporaryCode(tempDir, '777', entry());
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    });

    it('zero-pads to six digits after the configured prefix, starting at 1', async () => {
      const first = await issueTemporaryCode(tempDir, '777', entry());
      const second = await issueTemporaryCode(tempDir, '777', entry());
      expect(first).toBe('777000001');
      expect(second).toBe('777000002');
    });

    it('never issues the reserved 000000 placeholder', async () => {
      const code = await issueTemporaryCode(tempDir, '777', entry());
      expect(code).not.toBe('777000000');
    });

    it('throws once the counter would exceed 999999', async () => {
      await writeFile(
        join(tempDir, 'temporary-codes.json'),
        JSON.stringify({ next_counter: 999999, entries: [] }),
        'utf-8'
      );

      // Issues 999999 successfully...
      const code = await issueTemporaryCode(tempDir, '777', entry());
      expect(code).toBe('777999999');

      // ...then the counter has advanced past the max and the next call throws.
      await expect(issueTemporaryCode(tempDir, '777', entry())).rejects.toThrow(/exhausted/);
    });

    it('persists logged entries with all documented fields', async () => {
      await issueTemporaryCode(
        tempDir,
        '777',
        entry({
          provider: 'file',
          fallback_reason: 'misconfigured',
          detail: 'provider is not installed',
          repository: 'ai-insights',
          context: 'Namespace\\ClassName',
        })
      );

      const raw = await readFile(join(tempDir, 'temporary-codes.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { entries: Record<string, unknown>[] };
      expect(parsed.entries).toHaveLength(1);
      const loggedEntry = parsed.entries[0]!;
      expect(loggedEntry['code']).toBe('777000001');
      expect(typeof loggedEntry['issued_at']).toBe('string');
      expect(loggedEntry['provider']).toBe('file');
      expect(loggedEntry['fallback_reason']).toBe('misconfigured');
      expect(loggedEntry['detail']).toBe('provider is not installed');
      expect(loggedEntry['repository']).toBe('ai-insights');
      expect(loggedEntry['context']).toBe('Namespace\\ClassName');
    });

    it(
      'issues unique codes under twenty parallel calls',
      async () => {
        // Each call serializes through withLock()'s proper-lockfile backoff,
        // so twenty contested acquisitions run well past vitest's default
        // 10s test timeout — matching the config-store "ten concurrent
        // updateErrorCodeConfig calls" test's observed per-lock overhead.
        const codes = await Promise.all(
          Array.from({ length: 20 }, () => issueTemporaryCode(tempDir, '777', entry()))
        );
        expect(new Set(codes).size).toBe(20);
      },
      30000
    );
  });

  describe('listTemporaryCodes', () => {
    beforeEach(async () => {
      await issueTemporaryCode(tempDir, '777', entry({ context: 'ClassOne', repository: 'repo-a' }));
      await issueTemporaryCode(tempDir, '777', entry({ context: 'ClassTwo', repository: 'repo-b' }));
      await issueTemporaryCode(tempDir, '777', entry({ context: null, repository: 'other-repo' }));
    });

    it('returns every entry when no filter is supplied', async () => {
      const entries = await listTemporaryCodes(tempDir);
      expect(entries).toHaveLength(3);
    });

    it('filters by a substring of context', async () => {
      const entries = await listTemporaryCodes(tempDir, 'ClassOne');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.context).toBe('ClassOne');
    });

    it('filters by a substring of repository', async () => {
      const entries = await listTemporaryCodes(tempDir, 'repo-');
      expect(entries).toHaveLength(2);
    });

    it('returns an empty list when no entry has a matching context or repository', async () => {
      const entries = await listTemporaryCodes(tempDir, 'no-such-match');
      expect(entries).toHaveLength(0);
    });

    it('returns an empty list from a missing log file', async () => {
      const otherDir = await mkdtemp(join(tmpdir(), 'temporary-codes-empty-'));
      try {
        const entries = await listTemporaryCodes(otherDir);
        expect(entries).toEqual([]);
      } finally {
        await rm(otherDir, { recursive: true, force: true });
      }
    });
  });
});
