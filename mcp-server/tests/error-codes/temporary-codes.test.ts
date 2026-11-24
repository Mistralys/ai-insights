import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat, chmod, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { issueTemporaryCode, listTemporaryCodes, _internal } from '../../src/error-codes/temporary-codes.js';
import type { TemporaryCodeEntryInput } from '../../src/error-codes/temporary-codes.js';
import { runWorkers } from './fixtures/run-workers.js';
import { __setLockRetryForTesting, __resetLockOptionsForTesting } from '../../src/storage/file-lock.js';

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
    // Installs a fast withLock retry policy so the in-process and
    // cross-process concurrency tests below don't pay production lock
    // backoff (see mcp-server/src/storage/file-lock.ts).
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    __resetLockOptionsForTesting();
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
      expect(first.code).toBe('777000001');
      expect(second.code).toBe('777000002');
      expect(first.warning).toBeUndefined();
    });

    it('never issues the reserved 000000 placeholder', async () => {
      const { code } = await issueTemporaryCode(tempDir, '777', entry());
      expect(code).not.toBe('777000000');
    });

    it('throws once the counter would exceed 999999', async () => {
      await writeFile(
        join(tempDir, 'temporary-codes.json'),
        JSON.stringify({ next_counter: 999999, entries: [] }),
        'utf-8'
      );

      // Issues 999999 successfully...
      const { code } = await issueTemporaryCode(tempDir, '777', entry());
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

    it('issues unique, consecutive codes under twenty parallel calls', async () => {
      // Each call serializes through withLock(), but the beforeEach above
      // installs a fast retry policy, so twenty contested acquisitions now
      // complete well inside vitest's default test timeout.
      const issued = await Promise.all(
        Array.from({ length: 20 }, () => issueTemporaryCode(tempDir, '777', entry()))
      );
      const codes = issued.map((i) => i.code).sort();
      expect(codes).toEqual(Array.from({ length: 20 }, (_, i) => `777${String(i + 1).padStart(6, '0')}`));

      const log = JSON.parse(await readFile(join(tempDir, 'temporary-codes.json'), 'utf-8')) as { next_counter: number; entries: unknown[] };
      expect(log.entries).toHaveLength(20);
      expect(log.next_counter).toBe(21);
    });

    it(
      'issues unique, consecutive codes from separate processes',
      async () => {
        // fastLock: true installs the same fast retry policy inside each
        // spawned worker process; an explicit timeout is kept regardless
        // since spawning four real OS processes has its own startup variance.
        const codes = (await runWorkers(
          Array.from({ length: 4 }, () => ['temporary-codes', tempDir, '5']),
          { fastLock: true }
        )) as string[];

        expect([...codes].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `777${String(i + 1).padStart(6, '0')}`));

        const log = JSON.parse(await readFile(join(tempDir, 'temporary-codes.json'), 'utf-8')) as { next_counter: number; entries: unknown[] };
        expect(log.entries).toHaveLength(20);
        expect(log.next_counter).toBe(21);
      },
      20000
    );

    it('rejects and leaves the file untouched when the log cannot be read', async () => {
      // A directory in place of the file makes readFile fail with EISDIR (not ENOENT).
      const logPath = join(tempDir, 'temporary-codes.json');
      await mkdir(logPath);

      await expect(issueTemporaryCode(tempDir, '777', entry())).rejects.toThrow(/cannot read .*temporary-codes\.json \(EISDIR\)/);
      expect((await stat(logPath)).isDirectory()).toBe(true);
      expect((await readdir(tempDir)).filter((n) => n.includes('.corrupt-'))).toEqual([]);
    });
  });

  describe('corrupt log recovery', () => {
    const logName = 'temporary-codes.json';

    function validEntry(code: string): Record<string, unknown> {
      return { code, issued_at: '2026-11-19T10:00:00.000Z', provider: 'file', fallback_reason: 'failed', detail: null, repository: null, context: null };
    }

    async function corruptCopies(): Promise<string[]> {
      return (await readdir(tempDir)).filter((n) => n.startsWith('temporary-codes.corrupt-') && n.endsWith('.json'));
    }

    it('keeps a byte-identical copy of an unparsable log and continues above the counters visible in it', async () => {
      const original = '{ "entries": [ {"code": "777000041", "issued_at": broken';
      await writeFile(join(tempDir, logName), original, 'utf-8');

      const issued = await issueTemporaryCode(tempDir, '777', entry());

      expect(issued.code).toBe('777000042');
      const copies = await corruptCopies();
      expect(copies).toHaveLength(1);
      expect(await readFile(join(tempDir, copies[0]!), 'utf-8')).toBe(original);
      expect(issued.warning).toContain(copies[0]!);
      expect(issued.warning).toContain('numbering continues from 42');

      // The repaired log is valid and holds the new entry.
      const repaired = JSON.parse(await readFile(join(tempDir, logName), 'utf-8')) as { next_counter: number; entries: { code: string }[] };
      expect(repaired.next_counter).toBe(43);
      expect(repaired.entries.map((e) => e.code)).toEqual(['777000042']);
    });

    it('keeps every valid entry when one entry is invalid, and never goes below next_counter', async () => {
      const original = JSON.stringify({
        next_counter: 10,
        entries: [validEntry('777000001'), validEntry('777000002'), validEntry('777000003'), { code: 'broken' }],
      });
      await writeFile(join(tempDir, logName), original, 'utf-8');

      const issued = await issueTemporaryCode(tempDir, '777', entry());

      expect(issued.code).toBe('777000010');
      expect(issued.warning).toContain('3 of 4');
      const repaired = JSON.parse(await readFile(join(tempDir, logName), 'utf-8')) as { entries: { code: string }[] };
      expect(repaired.entries.map((e) => e.code)).toEqual(['777000001', '777000002', '777000003', '777000010']);
      expect(await readFile(join(tempDir, (await corruptCopies())[0]!), 'utf-8')).toBe(original);
    });

    it('counts codes written with a non-digit prefix toward the counter floor', async () => {
      await writeFile(join(tempDir, logName), JSON.stringify({ next_counter: 1, entries: [validEntry('ERR000007')] }), 'utf-8');

      const issued = await issueTemporaryCode(tempDir, '777', entry());

      expect(issued.code).toBe('777000008');
      expect(issued.warning).toBeDefined();
    });

    it('does not reissue logged codes when next_counter is missing', async () => {
      await writeFile(join(tempDir, logName), JSON.stringify({ entries: [validEntry('777000012')] }), 'utf-8');

      const issued = await issueTemporaryCode(tempDir, '777', entry());

      expect(issued.code).toBe('777000013');
      expect(await corruptCopies()).toHaveLength(1);
    });

    it('does not warn or copy for a healthy log', async () => {
      await issueTemporaryCode(tempDir, '777', entry());
      const second = await issueTemporaryCode(tempDir, '777', entry());

      expect(second.warning).toBeUndefined();
      expect(await corruptCopies()).toEqual([]);
    });

    it(
      'recovers exactly once when two calls meet the same corrupt log',
      async () => {
        await writeFile(join(tempDir, logName), '{ "code": "777000005" nope', 'utf-8');

        const [a, b] = await Promise.all([
          issueTemporaryCode(tempDir, '777', entry()),
          issueTemporaryCode(tempDir, '777', entry()),
        ]);

        expect(await corruptCopies()).toHaveLength(1);
        expect([a.warning, b.warning].filter((w) => w !== undefined)).toHaveLength(1);
        expect([a.code, b.code].sort()).toEqual(['777000006', '777000007']);
      },
      20000
    );

    it('salvages by text scan and structure (unit)', () => {
      const salvaged = _internal.salvageTemporaryLog('{ "code": "ABC000100", "code": "777000200"', undefined, 'x');
      expect(salvaged.file.next_counter).toBe(201);
      expect(salvaged.file.entries).toEqual([]);
      expect(salvaged.corruption.total).toBeNull();
    });
  });

  describe('listTemporaryCodes', () => {
    beforeEach(async () => {
      await issueTemporaryCode(tempDir, '777', entry({ context: 'ClassOne', repository: 'repo-a' }));
      await issueTemporaryCode(tempDir, '777', entry({ context: 'ClassTwo', repository: 'repo-b' }));
      await issueTemporaryCode(tempDir, '777', entry({ context: null, repository: 'other-repo' }));
    });

    it('returns every entry when no filter is supplied', async () => {
      const { entries, warning } = await listTemporaryCodes(tempDir);
      expect(entries).toHaveLength(3);
      expect(warning).toBeUndefined();
    });

    it('filters by a substring of context', async () => {
      const { entries } = await listTemporaryCodes(tempDir, 'ClassOne');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.context).toBe('ClassOne');
    });

    it('filters by a substring of repository', async () => {
      const { entries } = await listTemporaryCodes(tempDir, 'repo-');
      expect(entries).toHaveLength(2);
    });

    it('returns an empty list when no entry has a matching context or repository', async () => {
      const { entries } = await listTemporaryCodes(tempDir, 'no-such-match');
      expect(entries).toHaveLength(0);
    });

    it('returns the recoverable entries plus a warning for a corrupt log, and writes nothing', async () => {
      const logPath = join(tempDir, 'temporary-codes.json');
      const good = { code: '777000001', issued_at: '2026-11-19T10:00:00.000Z', provider: null, fallback_reason: null, detail: null, repository: null, context: 'Kept' };
      const original = JSON.stringify({ next_counter: 5, entries: [good, { code: 7 }] });
      await writeFile(logPath, original, 'utf-8');
      const before = await readdir(tempDir);

      const { entries, warning } = await listTemporaryCodes(tempDir);

      expect(entries.map((e) => e.context)).toEqual(['Kept']);
      expect(warning).toMatch(/corrupt/);
      expect(await readFile(logPath, 'utf-8')).toBe(original);
      expect(await readdir(tempDir)).toEqual(before);
    });

    it('returns an empty list from a missing log file', async () => {
      const otherDir = await mkdtemp(join(tmpdir(), 'temporary-codes-empty-'));
      try {
        const { entries, warning } = await listTemporaryCodes(otherDir);
        expect(entries).toEqual([]);
        expect(warning).toBeUndefined();
      } finally {
        await rm(otherDir, { recursive: true, force: true });
      }
    });
  });
});
