import { describe, it, expect, vi } from 'vitest';
import { allocateErrorCode, type AllocatorDeps } from '../../src/error-codes/allocator.js';
import type { ErrorCodeConfig } from '../../src/error-codes/config-store.js';
import type { AllocationOutcome, ErrorCodeProvider, ProviderContext } from '../../src/error-codes/provider-api.js';

/** Builds a complete, valid config, overridable per test. */
function makeConfig(overrides: Partial<ErrorCodeConfig> = {}): ErrorCodeConfig {
  return {
    version: 1,
    active_provider: 'file',
    temporary_prefix: '777',
    timeout_ms: 10000,
    retry: { default_wait_ms: 11000, max_wait_ms: 30000 },
    providers: {},
    ...overrides,
  };
}

/** Builds a minimal provider whose `allocate` is the given fake. */
function makeProvider(
  allocate: (request: unknown, ctx: ProviderContext) => Promise<AllocationOutcome>,
  overrides: Partial<ErrorCodeProvider> = {}
): ErrorCodeProvider {
  return {
    apiVersion: 1,
    id: 'test-provider',
    label: 'Test Provider',
    settings: [],
    allocate: allocate as ErrorCodeProvider['allocate'],
    ...overrides,
  };
}

/** Builds a full `AllocatorDeps` fake, overridable per test. Defaults never throw and never retry-wait for real. */
function makeDeps(overrides: Partial<AllocatorDeps> = {}): AllocatorDeps {
  return {
    loadConfig: vi.fn(async () => makeConfig()),
    getProvider: vi.fn(() => undefined),
    resolveRepositoryInfo: vi.fn(async () => null),
    temporaryCodes: { issue: vi.fn(async () => '777000001') },
    sleep: vi.fn(async () => undefined),
    now: vi.fn(() => 0),
    ...overrides,
  };
}

describe('allocateErrorCode', () => {
  describe('success path', () => {
    it('returns a non-temporary code on a successful allocation', async () => {
      const provider = makeProvider(async () => ({ ok: true, value: 42 }));
      const deps = makeDeps({
        loadConfig: vi.fn(async () => makeConfig()),
        getProvider: vi.fn(() => provider),
      });

      const result = await allocateErrorCode({ cwd_path: null, context: 'Foo\\Bar' }, deps);

      expect(result.temporary).toBe(false);
      expect(result.code).toBe('42');
      expect(result.provider).toBe('test-provider');
      expect(result.first_component_code).toBe('4201');
      expect(result.fallback_reason).toBeUndefined();
      expect(deps.temporaryCodes.issue).not.toHaveBeenCalled();
    });
  });

  describe('temporary: true shortcut', () => {
    it('issues a temporary code with reason "requested" without calling any provider', async () => {
      const getProvider = vi.fn(() => makeProvider(async () => ({ ok: true, value: 1 })));
      const issue = vi.fn(async () => '777000005');
      const deps = makeDeps({ getProvider, temporaryCodes: { issue } });

      const result = await allocateErrorCode({ cwd_path: null, context: null, temporary: true }, deps);

      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('requested');
      expect(result.code).toBe('777000005');
      expect(result.provider).toBeNull();
      expect(getProvider).not.toHaveBeenCalled();
      expect(issue).toHaveBeenCalledWith('777', expect.objectContaining({ fallback_reason: 'requested' }));
    });
  });

  describe('throttled retry', () => {
    it('waits once for min(retry_after_ms, max_wait_ms), retries once, and reports waited_ms on success', async () => {
      let calls = 0;
      const provider = makeProvider(async () => {
        calls += 1;
        if (calls === 1) {
          return { ok: false, reason: 'throttled', retry_after_ms: 5000 };
        }
        return { ok: true, value: 99 };
      });
      const sleep = vi.fn(async () => undefined);
      const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(6000);
      const deps = makeDeps({ getProvider: vi.fn(() => provider), sleep, now });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(sleep).toHaveBeenCalledWith(5000);
      expect(result.temporary).toBe(false);
      expect(result.code).toBe('99');
      expect(result.waited_ms).toBe(5000);
      expect(calls).toBe(2);
    });

    it('caps the wait at retry.max_wait_ms when retry_after_ms is larger', async () => {
      const provider = makeProvider(async () => ({ ok: false, reason: 'throttled', retry_after_ms: 999999 }));
      const sleep = vi.fn(async () => undefined);
      const deps = makeDeps({
        loadConfig: vi.fn(async () => makeConfig({ retry: { default_wait_ms: 11000, max_wait_ms: 20000 } })),
        getProvider: vi.fn(() => provider),
        sleep,
      });

      await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(sleep).toHaveBeenCalledWith(20000);
    });

    it('falls back to retry.default_wait_ms when the provider reports no retry_after_ms', async () => {
      const provider = makeProvider(async () => ({ ok: false, reason: 'throttled' }));
      const sleep = vi.fn(async () => undefined);
      const deps = makeDeps({ getProvider: vi.fn(() => provider), sleep });

      await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(sleep).toHaveBeenCalledWith(11000);
    });

    it('falls back to a temporary code when the retry also comes back throttled', async () => {
      const provider = makeProvider(async () => ({ ok: false, reason: 'throttled', retry_after_ms: 1000 }));
      const issue = vi.fn(async () => '777000002');
      const deps = makeDeps({ getProvider: vi.fn(() => provider), temporaryCodes: { issue } });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('throttled');
      expect(issue).toHaveBeenCalledTimes(1);
    });

    it('never retries a throttled outcome that is also ambiguous', async () => {
      const allocate = vi.fn(async () => ({ ok: false as const, reason: 'throttled' as const, ambiguous: true }));
      const provider = makeProvider(allocate);
      const sleep = vi.fn(async () => undefined);
      const deps = makeDeps({ getProvider: vi.fn(() => provider), sleep });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(sleep).not.toHaveBeenCalled();
      expect(allocate).toHaveBeenCalledTimes(1);
      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('throttled');
    });
  });

  describe('ambiguous and non-ambiguous failures never retry outside the throttled path', () => {
    it('falls back once on a non-ambiguous "unavailable" failure, never retrying', async () => {
      const allocate = vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const, ambiguous: false }));
      const provider = makeProvider(allocate);
      const sleep = vi.fn(async () => undefined);
      const deps = makeDeps({ getProvider: vi.fn(() => provider), sleep });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(allocate).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('unavailable');
    });
  });

  describe('outcome validation', () => {
    it('treats a non-positive value as invalid_response', async () => {
      const provider = makeProvider(async () => ({ ok: true, value: -5 }));
      const deps = makeDeps({ getProvider: vi.fn(() => provider) });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('invalid_response');
    });

    it('treats a non-safe-integer value as invalid_response', async () => {
      const provider = makeProvider(async () => ({ ok: true, value: Number.MAX_SAFE_INTEGER + 10 }));
      const deps = makeDeps({ getProvider: vi.fn(() => provider) });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.fallback_reason).toBe('invalid_response');
    });

    it('treats an unrecognised outcome reason as failed', async () => {
      const provider = makeProvider(async () => ({ ok: false, reason: 'made-up-reason' } as unknown as AllocationOutcome));
      const deps = makeDeps({ getProvider: vi.fn(() => provider) });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.fallback_reason).toBe('failed');
    });

    it('treats a throwing provider as failed and ambiguous (never retried)', async () => {
      const allocate = vi.fn(async () => {
        throw new Error('boom');
      });
      const provider = makeProvider(allocate);
      const sleep = vi.fn(async () => undefined);
      const deps = makeDeps({ getProvider: vi.fn(() => provider), sleep });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(allocate).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('failed');
      expect(result.detail).toContain('boom');
    });

    it('treats an abort through the timeout as unavailable and ambiguous', async () => {
      const provider = makeProvider(async (_request, ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (ctx.signal.aborted) {
          throw new Error('aborted');
        }
        return { ok: true, value: 1 };
      });
      const deps = makeDeps({
        loadConfig: vi.fn(async () => makeConfig({ timeout_ms: 1 })),
        getProvider: vi.fn(() => provider),
      });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('unavailable');
    });
  });

  describe('misconfiguration', () => {
    it('falls back to misconfigured, naming the provider id, when the active provider is missing', async () => {
      const deps = makeDeps({
        loadConfig: vi.fn(async () => makeConfig({ active_provider: 'ghost' })),
        getProvider: vi.fn(() => undefined),
      });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.temporary).toBe(true);
      expect(result.fallback_reason).toBe('misconfigured');
      expect(result.provider).toBe('ghost');
      expect(result.detail).toContain('ghost');
    });

    it('falls back to misconfigured naming only the invalid setting keys, never their values', async () => {
      const provider = makeProvider(async () => ({ ok: true, value: 1 }), {
        settings: [{ key: 'base_url', label: 'Base URL', type: 'url', required: true }],
      });
      const deps = makeDeps({
        loadConfig: vi.fn(async () =>
          makeConfig({ providers: { 'test-provider': { base_url: 'super-secret-value-not-a-url' } } })
        ),
        getProvider: vi.fn(() => provider),
      });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.fallback_reason).toBe('misconfigured');
      expect(result.detail).toContain('base_url');
      expect(result.detail).not.toContain('super-secret-value-not-a-url');
    });
  });

  describe('redaction', () => {
    it('redacts a configured secret out of the final detail text', async () => {
      const provider = makeProvider(
        async () => ({ ok: false, reason: 'rejected', detail: 'backend said no for password hunter2' }),
        { settings: [{ key: 'password', label: 'Password', type: 'secret' }] }
      );
      const deps = makeDeps({
        loadConfig: vi.fn(async () => makeConfig({ providers: { 'test-provider': { password: 'hunter2' } } })),
        getProvider: vi.fn(() => provider),
      });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(result.detail).toContain('[REDACTED]');
      expect(result.detail).not.toContain('hunter2');
    });

    it('logs through the redacting logger without the allocator itself having to redact log calls', async () => {
      const logged: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string) => {
        logged.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      try {
        const provider = makeProvider(
          async (_request, ctx) => {
            ctx.log.info('connecting with password hunter2');
            return { ok: true, value: 1 };
          },
          { settings: [{ key: 'password', label: 'Password', type: 'secret' }] }
        );
        const deps = makeDeps({
          loadConfig: vi.fn(async () => makeConfig({ providers: { 'test-provider': { password: 'hunter2' } } })),
          getProvider: vi.fn(() => provider),
        });

        await allocateErrorCode({ cwd_path: null, context: null }, deps);
      } finally {
        process.stderr.write = originalWrite;
      }

      expect(logged.join('')).toContain('[REDACTED]');
      expect(logged.join('')).not.toContain('hunter2');
    });
  });

  describe('repository resolution', () => {
    it('resolves the repository only when cwd_path is provided, and carries it through to the result', async () => {
      const repository = { root_path: '/repo', folder_name: 'repo', package_name: 'repo-pkg' };
      const resolveRepositoryInfo = vi.fn(async () => repository);
      const provider = makeProvider(async () => ({ ok: true, value: 1 }));
      const deps = makeDeps({ getProvider: vi.fn(() => provider), resolveRepositoryInfo });

      const result = await allocateErrorCode({ cwd_path: '/repo/sub', context: null }, deps);

      expect(resolveRepositoryInfo).toHaveBeenCalledWith('/repo/sub');
      expect(result.repository).toEqual(repository);
    });

    it('never resolves a repository when cwd_path is null', async () => {
      const resolveRepositoryInfo = vi.fn(async () => null);
      const provider = makeProvider(async () => ({ ok: true, value: 1 }));
      const deps = makeDeps({ getProvider: vi.fn(() => provider), resolveRepositoryInfo });

      const result = await allocateErrorCode({ cwd_path: null, context: null }, deps);

      expect(resolveRepositoryInfo).not.toHaveBeenCalled();
      expect(result.repository).toBeNull();
    });
  });
});
