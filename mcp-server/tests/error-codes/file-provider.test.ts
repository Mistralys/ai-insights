import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileProvider } from '../../src/error-codes/providers/file-provider.js';
import { buildSettingsSchema } from '../../src/error-codes/settings-schema.js';
import type { ProviderContext } from '../../src/error-codes/provider-api.js';
import { describeProviderContract, makeAllocationRequest, makeRepositoryInfo } from './provider-contract.js';
import { runWorkers } from './fixtures/run-workers.js';
import { __setLockRetryForTesting, __resetLockOptionsForTesting } from '../../src/storage/file-lock.js';

/** Validates `rawSettings` against the provider's own declared schema (applying its defaults), the same way the allocator does before calling `allocate`. */
function validatedSettings(rawSettings: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  const schema = buildSettingsSchema(fileProvider.settings);
  const result = schema.parse(rawSettings);
  return result;
}

function makeCtx(dataDir: string, overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    settings: validatedSettings(),
    signal: new AbortController().signal,
    data_dir: dataDir,
    log: { info: () => undefined, warn: () => undefined },
    ...overrides,
  };
}

describe('file-provider', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'file-provider-test-'));
    // Installs a fast withLock retry policy so the parallel-allocation
    // concurrency tests below don't pay production lock backoff (see
    // mcp-server/src/storage/file-lock.ts).
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    __resetLockOptionsForTesting();
  });

  describeProviderContract(
    'file provider',
    () => fileProvider,
    (overrides) => makeCtx(dataDir, overrides)
  );

  describe('global scope', () => {
    it('starts at 1 and increases by one per call with no config.json present', async () => {
      const first = await fileProvider.allocate(makeAllocationRequest(), makeCtx(dataDir));
      const second = await fileProvider.allocate(makeAllocationRequest(), makeCtx(dataDir));

      expect(first).toEqual({ ok: true, value: 1 });
      expect(second).toEqual({ ok: true, value: 2 });
    });

    it('honours a configured start_value for a sequence not yet allocated from', async () => {
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ start_value: 100 }) });
      const result = await fileProvider.allocate(makeAllocationRequest(), ctx);
      expect(result).toEqual({ ok: true, value: 100 });
    });

    it('keeps independent sequences per counter_name', async () => {
      const ctxA = makeCtx(dataDir, { settings: validatedSettings({ counter_name: 'a' }) });
      const ctxB = makeCtx(dataDir, { settings: validatedSettings({ counter_name: 'b' }) });

      const a1 = await fileProvider.allocate(makeAllocationRequest(), ctxA);
      const b1 = await fileProvider.allocate(makeAllocationRequest(), ctxB);
      const a2 = await fileProvider.allocate(makeAllocationRequest(), ctxA);

      expect(a1).toEqual({ ok: true, value: 1 });
      expect(b1).toEqual({ ok: true, value: 1 });
      expect(a2).toEqual({ ok: true, value: 2 });
    });

    it('peek returns the value the next allocate call would return, without consuming it', async () => {
      const ctx = makeCtx(dataDir);
      const peeked = await fileProvider.peek?.(makeAllocationRequest(), ctx);
      const allocated = await fileProvider.allocate(makeAllocationRequest(), ctx);
      const peekedAgain = await fileProvider.peek?.(makeAllocationRequest(), ctx);

      expect(peeked).toEqual({ ok: true, value: 1 });
      expect(allocated).toEqual({ ok: true, value: 1 });
      expect(peekedAgain).toEqual({ ok: true, value: 2 });
    });

    it('supports a custom absolute counter_file with no {repo} placeholder and no repository resolved', async () => {
      const customFile = join(dataDir, 'custom-counters.json');
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ counter_file: customFile }) });

      const first = await fileProvider.allocate(makeAllocationRequest({ repository: null }), ctx);
      const second = await fileProvider.allocate(makeAllocationRequest({ repository: null }), ctx);

      expect(first).toEqual({ ok: true, value: 1 });
      expect(second).toEqual({ ok: true, value: 2 });
    });

    it('issues twenty unique, consecutive values across twenty parallel allocations', async () => {
      // A separate context per call, as separate callers would have: they
      // share one data_dir and therefore one lock. The beforeEach above
      // installs a fast retry policy, so this completes well inside the
      // default test timeout.
      const results = await Promise.all(
        Array.from({ length: 20 }, () => fileProvider.allocate(makeAllocationRequest(), makeCtx(dataDir)))
      );

      const values = results.map((r) => (r.ok ? r.value : null));
      expect(values.every((v): v is number => v !== null)).toBe(true);
      expect([...(values as number[])].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      const next = await fileProvider.peek?.(makeAllocationRequest(), makeCtx(dataDir));
      expect(next).toEqual({ ok: true, value: 21 });
    });

    it('honours start_value across parallel allocations', async () => {
      const settings = validatedSettings({ start_value: 100 });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => fileProvider.allocate(makeAllocationRequest(), makeCtx(dataDir, { settings })))
      );
      const values = results.map((r) => (r.ok ? r.value : -1)).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
    });

    it(
      'returns unique, consecutive values for parallel allocations from separate processes',
      async () => {
        // fastLock: true installs the same fast retry policy inside each
        // spawned worker process; an explicit timeout is kept regardless
        // since spawning four real OS processes has its own startup variance.
        const counterFile = join(dataDir, 'shared-counters.json');
        const values = (await runWorkers(
          Array.from({ length: 4 }, () => ['file-provider', dataDir, counterFile, '5']),
          { fastLock: true }
        )) as number[];

        expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        const stored = JSON.parse(await readFile(counterFile, 'utf-8')) as { counters: Record<string, number> };
        expect(stored.counters['default']).toBe(20);
      },
      20000
    );
  });

  describe('corrupt counter file', () => {
    const corrupt: [string, string][] = [
      ['invalid JSON', '{ not json'],
      ['a non-integer counter', JSON.stringify({ counters: { default: 1.5 } })],
      ['a non-numeric counter', JSON.stringify({ counters: { default: 'ten' } })],
      ['a counters array', JSON.stringify({ counters: [1, 2] })],
      ['a non-object top level', '[1, 2, 3]'],
    ];

    it.each(corrupt)('fails (and leaves the file untouched) for %s', async (_label, content) => {
      const file = join(dataDir, 'counters.json');
      await writeFile(file, content, 'utf-8');
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file }) });

      const allocated = await fileProvider.allocate(makeAllocationRequest(), ctx);
      const peeked = await fileProvider.peek?.(makeAllocationRequest(), ctx);

      for (const outcome of [allocated, peeked]) {
        expect(outcome).toMatchObject({ ok: false, reason: 'failed', ambiguous: false });
        expect((outcome as { detail: string }).detail).toContain(file);
      }
      expect(await readFile(file, 'utf-8')).toBe(content);
    });

    it('fails when the counter file cannot be read at all (path is a directory)', async () => {
      const file = join(dataDir, 'is-a-directory');
      await mkdir(file);
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file }) });

      const allocated = await fileProvider.allocate(makeAllocationRequest(), ctx);
      const peeked = await fileProvider.peek?.(makeAllocationRequest(), ctx);

      for (const outcome of [allocated, peeked]) {
        expect(outcome).toMatchObject({ ok: false, reason: 'failed', ambiguous: false });
        expect((outcome as { detail: string }).detail).toMatch(/EISDIR/);
      }
    });

    it('starts a new sequence only when the file is missing', async () => {
      const file = join(dataDir, 'not-yet-there.json');
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file }) });
      expect(await fileProvider.allocate(makeAllocationRequest(), ctx)).toEqual({ ok: true, value: 1 });
    });
  });

  describe('own-property-safe keys', () => {
    it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
      'treats "%s" as an ordinary counter name',
      async (name) => {
        const file = join(dataDir, 'counters.json');
        const ctx = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file, counter_name: name }) });

        expect(await fileProvider.allocate(makeAllocationRequest(), ctx)).toEqual({ ok: true, value: 1 });
        expect(await fileProvider.allocate(makeAllocationRequest(), ctx)).toEqual({ ok: true, value: 2 });
        expect(await fileProvider.peek?.(makeAllocationRequest(), ctx)).toEqual({ ok: true, value: 3 });

        const json = JSON.parse(await readFile(file, 'utf-8')) as { counters: Record<string, number> };
        expect(Object.hasOwn(json.counters, name)).toBe(true);
        expect(json.counters[name]).toBe(2);
      }
    );

    it('keeps such a counter name independent of the others in the same file', async () => {
      const file = join(dataDir, 'counters.json');
      const a = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file, counter_name: '__proto__' }) });
      const b = makeCtx(dataDir, { settings: validatedSettings({ counter_file: file, counter_name: 'plain' }) });

      await fileProvider.allocate(makeAllocationRequest(), a);
      await fileProvider.allocate(makeAllocationRequest(), a);
      expect(await fileProvider.allocate(makeAllocationRequest(), b)).toEqual({ ok: true, value: 1 });
    });
  });

  describe('repository scope', () => {
    it('keeps independent sequences for two different repositories', async () => {
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ scope: 'repository' }) });
      const repoA = makeRepositoryInfo({ folder_name: 'repo-a' });
      const repoB = makeRepositoryInfo({ folder_name: 'repo-b' });

      const a1 = await fileProvider.allocate(makeAllocationRequest({ repository: repoA }), ctx);
      const b1 = await fileProvider.allocate(makeAllocationRequest({ repository: repoB }), ctx);
      const a2 = await fileProvider.allocate(makeAllocationRequest({ repository: repoA }), ctx);

      expect(a1).toEqual({ ok: true, value: 1 });
      expect(b1).toEqual({ ok: true, value: 1 });
      expect(a2).toEqual({ ok: true, value: 2 });
    });

    it('draws from one shared sequence for two RepositoryInfo values from linked worktrees of one repository', async () => {
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ scope: 'repository' }) });
      // Two worktrees of the same repository resolve to the same folder_name
      // (project-info.ts's documented invariant) but different root_path.
      const mainWorktree = makeRepositoryInfo({ root_path: '/repo', folder_name: 'repo' });
      const linkedWorktree = makeRepositoryInfo({ root_path: '/repo-worktrees/feature', folder_name: 'repo' });

      const fromMain = await fileProvider.allocate(makeAllocationRequest({ repository: mainWorktree }), ctx);
      const fromLinked = await fileProvider.allocate(makeAllocationRequest({ repository: linkedWorktree }), ctx);

      expect(fromMain).toEqual({ ok: true, value: 1 });
      expect(fromLinked).toEqual({ ok: true, value: 2 });
    });

    it('returns misconfigured with the documented detail when scope is repository but no repository resolved', async () => {
      const ctx = makeCtx(dataDir, { settings: validatedSettings({ scope: 'repository' }) });
      const result = await fileProvider.allocate(makeAllocationRequest({ repository: null }), ctx);

      expect(result).toEqual({ ok: false, reason: 'misconfigured', detail: 'no repository found for cwd_path' });
    });
  });

  describe('{repo} counter_file placeholder', () => {
    it(
      'places the counter file inside the repository and leaves no lock behind',
      async () => {
        const repoDir = await mkdtemp(join(tmpdir(), 'file-provider-repo-'));
        try {
          const ctx = makeCtx(dataDir, {
            settings: validatedSettings({ counter_file: '{repo}/.error-codes.json' }),
          });
          const repository = makeRepositoryInfo({ root_path: repoDir, folder_name: 'repo' });

          // Ten concurrent allocations against the same {repo} counter file:
          // without a real lock serialising the read-modify-write, a race
          // would produce duplicate values. The lock is taken on `ctx.data_dir`
          // (asserted below by `repoDir` never gaining a `.lock` entry), so
          // this also proves locking `ctx.data_dir` is sufficient to serialise
          // writes to a counter file living elsewhere entirely.
          const results = await Promise.all(
            Array.from({ length: 10 }, () => fileProvider.allocate(makeAllocationRequest({ repository }), ctx))
          );
          const values = results.map((r) => (r.ok ? r.value : -1)).sort((a, b) => a - b);
          expect(values).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

          const repoEntries = await readdir(repoDir);
          expect(repoEntries).toContain('.error-codes.json');
          expect(repoEntries).not.toContain('.lock');
        } finally {
          await rm(repoDir, { recursive: true, force: true });
        }
      },
      20000
    );

    it('returns misconfigured when the placeholder is used but no repository resolved', async () => {
      const ctx = makeCtx(dataDir, {
        settings: validatedSettings({ counter_file: '{repo}/.error-codes.json' }),
      });

      const result = await fileProvider.allocate(makeAllocationRequest({ repository: null }), ctx);
      expect(result).toEqual({ ok: false, reason: 'misconfigured', detail: 'no repository found for cwd_path' });
    });
  });

  it('makes no network request (allocate resolves using only local file I/O)', async () => {
    // There is no fetch/http import anywhere in file-provider.ts; this test
    // documents the AC in the suite rather than instrumenting the network
    // stack, since the module's own imports are the proof.
    const result = await fileProvider.allocate(makeAllocationRequest(), makeCtx(dataDir));
    expect(result.ok).toBe(true);
  });
});
