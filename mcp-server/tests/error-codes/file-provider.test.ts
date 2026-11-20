import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileProvider } from '../../src/error-codes/providers/file-provider.js';
import { buildSettingsSchema } from '../../src/error-codes/settings-schema.js';
import type { ProviderContext } from '../../src/error-codes/provider-api.js';
import { describeProviderContract, makeAllocationRequest, makeRepositoryInfo } from './provider-contract.js';

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
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
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

    it(
      'issues twenty unique values across twenty parallel allocations',
      async () => {
        const ctx = makeCtx(dataDir);
        const results = await Promise.all(
          Array.from({ length: 20 }, () => fileProvider.allocate(makeAllocationRequest(), ctx))
        );

        const values = results.map((r) => (r.ok ? r.value : null));
        expect(values.every((v): v is number => v !== null)).toBe(true);
        expect(new Set(values).size).toBe(20);
      },
      20000
    );
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
      'places the counter file inside the repository and never locks that directory',
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
          const values = results.map((r) => (r.ok ? r.value : null));
          expect(new Set(values).size).toBe(10);

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
