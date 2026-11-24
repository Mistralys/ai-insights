import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { errorcodeIncrementorProvider } from '../../src/error-codes/providers/errorcode-incrementor-provider.js';
import { buildSettingsSchema } from '../../src/error-codes/settings-schema.js';
import type { ProviderContext } from '../../src/error-codes/provider-api.js';
import { describeProviderContract, makeAllocationRequest } from './provider-contract.js';

/**
 * Tests for the `errorcode-incrementor` HTTP provider — see that module's
 * docblock for the protocol it implements. Every test stubs the global
 * `fetch` (`vi.stubGlobal`); none ever performs a real network request,
 * satisfying the "tests never call a real counter service" constraint
 * (`constraints-testing.md`).
 *
 * A sentinel secret (`SENTINEL_SECRET`) is used as the `password` setting
 * throughout and asserted absent from every outcome/log line, proving the
 * provider never echoes it back.
 */

const SENTINEL_SECRET = 'sentinel-secret-do-not-leak-7f3a9c';

/** Validates `rawSettings` against the provider's own declared schema (applying its defaults), the same way the allocator does before calling `allocate`/`peek`. */
function validatedSettings(rawSettings: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  const schema = buildSettingsSchema(errorcodeIncrementorProvider.settings);
  return schema.parse({
    base_url: 'https://errorcodes.example.test/',
    password: SENTINEL_SECRET,
    counter: 'test-counter',
    ...rawSettings,
  });
}

function makeCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  const logLines: string[] = [];
  return {
    settings: validatedSettings(),
    signal: new AbortController().signal,
    data_dir: '/tmp/unused-for-this-provider',
    log: {
      info: (msg: string) => logLines.push(msg),
      warn: (msg: string) => logLines.push(msg),
    },
    ...overrides,
  };
}

/** Builds a fake `fetch` returning `{ status, body }`, recording every call's URL for assertions. */
function fakeFetch(calls: URL[], respond: (url: URL) => { status: number; body: string }): typeof fetch {
  return vi.fn(async (input: URL | string | Request, _init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push(url);
    const { status, body } = respond(url);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

/** A simple in-memory counter backing a fake fetch, mirroring the real service's increment semantics. */
function fakeCounterFetch(calls: URL[], startValue: number, suffix: string): typeof fetch {
  let current = startValue;
  return fakeFetch(calls, (url) => {
    if (url.searchParams.get('increment') === 'yes') {
      current += 1;
    }
    return { status: 200, body: `${current}${suffix}` };
  });
}

describe('errorcode-incrementor-provider', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  describeProviderContract(
    'errorcode-incrementor provider',
    () => errorcodeIncrementorProvider,
    (() => {
      // One fake counter service backs every `makeCtx()` call across this
      // suite's tests, mirroring a real stateful backend — this is what
      // makes the shared contract's "increases monotonically across
      // repeated calls" check (which builds two contexts and allocates
      // from each) actually observe an increment between them, rather than
      // two independent counters that each start fresh at zero.
      const calls: URL[] = [];
      const fetchFn = fakeCounterFetch(calls, 0, '01');
      return (overrides) => {
        vi.stubGlobal('fetch', fetchFn);
        return makeCtx(overrides);
      };
    })()
  );

  describe('request shape', () => {
    it('allocate sends increment=yes with URL-encoded parameters', async () => {
      const calls: URL[] = [];
      vi.stubGlobal('fetch', fakeCounterFetch(calls, 519, '01'));

      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());

      expect(outcome).toEqual({ ok: true, value: 520 });
      expect(calls).toHaveLength(1);
      expect(calls[0].searchParams.get('increment')).toBe('yes');
      expect(calls[0].searchParams.get('pw')).toBe(SENTINEL_SECRET);
      expect(calls[0].searchParams.get('counter')).toBe('test-counter');
    });

    it('peek sends the same request without increment, and does not consume the counter', async () => {
      const calls: URL[] = [];
      vi.stubGlobal('fetch', fakeCounterFetch(calls, 519, '01'));

      const outcome = await errorcodeIncrementorProvider.peek?.(makeAllocationRequest(), makeCtx());

      expect(outcome).toEqual({ ok: true, value: 519 });
      expect(calls).toHaveLength(1);
      expect(calls[0].searchParams.has('increment')).toBe(false);
      expect(calls[0].searchParams.get('pw')).toBe(SENTINEL_SECRET);
    });

    it('peek removes an increment parameter already present in base_url, and allocate sends exactly one', async () => {
      const ctx = makeCtx({ settings: validatedSettings({ base_url: 'https://errorcodes.example.test/?increment=yes&x=1' }) });

      const peekCalls: URL[] = [];
      vi.stubGlobal('fetch', fakeCounterFetch(peekCalls, 519, '01'));
      await errorcodeIncrementorProvider.peek?.(makeAllocationRequest(), ctx);
      expect(peekCalls[0].searchParams.has('increment')).toBe(false);
      expect(peekCalls[0].searchParams.get('x')).toBe('1');

      const allocateCalls: URL[] = [];
      vi.stubGlobal('fetch', fakeCounterFetch(allocateCalls, 519, '01'));
      await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), ctx);
      expect(allocateCalls[0].searchParams.getAll('increment')).toEqual(['yes']);
    });

    it('strips the configured response_suffix from the trimmed digit body (52001 -> 520)', async () => {
      const calls: URL[] = [];
      vi.stubGlobal('fetch', fakeFetch(calls, () => ({ status: 200, body: '52001\n' })));

      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
      expect(outcome).toEqual({ ok: true, value: 520 });
    });

    it('only one request is sent per allocate call', async () => {
      const calls: URL[] = [];
      vi.stubGlobal('fetch', fakeCounterFetch(calls, 0, '01'));

      await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
      expect(calls).toHaveLength(1);
    });
  });

  describe('status/error mapping', () => {
    it.each([400, 401, 404])('maps HTTP %d to misconfigured', async (status) => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status, body: '' })));
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('misconfigured');
      }
    });

    it('maps HTTP 403 to throttled with retry_after_ms = throttle_delay_ms + 1000', async () => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status: 403, body: '' })));
      const ctx = makeCtx({ settings: validatedSettings({ throttle_delay_ms: 5000 }) });
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), ctx);

      expect(outcome).toEqual({
        ok: false,
        reason: 'throttled',
        retry_after_ms: 6000,
        detail: expect.any(String),
      });
    });

    it('maps HTTP 500 to unavailable, ambiguous', async () => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status: 500, body: '' })));
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('unavailable');
        expect(outcome.ambiguous).toBe(true);
      }
    });

    it('maps any other non-2xx status to rejected', async () => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status: 418, body: '' })));
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('rejected');
      }
    });

    it('maps an already-aborted signal to unavailable, ambiguous', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: unknown, init?: RequestInit) => {
          if (init?.signal?.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          return new Response('100', { status: 200 });
        })
      );

      const ctx = makeCtx({ signal: AbortSignal.abort(new Error('test: pre-aborted')) });
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), ctx);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('unavailable');
        expect(outcome.ambiguous).toBe(true);
      }
    });

    it.each(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'])(
      'maps a %s network error to unavailable, not ambiguous',
      async (code) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            throw new TypeError('fetch failed', { cause: { code } });
          })
        );

        const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.reason).toBe('unavailable');
          expect(outcome.ambiguous).toBe(false);
        }
      }
    );

    it('maps an unrecognised network error to unavailable, ambiguous', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        })
      );

      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('unavailable');
        expect(outcome.ambiguous).toBe(true);
      }
    });

    it('maps a non-matching response body to invalid_response', async () => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status: 200, body: 'not-a-number' })));
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('invalid_response');
      }
    });

    it('maps a body missing the configured suffix to invalid_response', async () => {
      vi.stubGlobal('fetch', fakeFetch([], () => ({ status: 200, body: '52099' })));
      const ctx = makeCtx({ settings: validatedSettings({ response_suffix: '01' }) });
      const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), ctx);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('invalid_response');
      }
    });
  });

  describe('secret handling', () => {
    it('never includes the sentinel secret in any outcome or log line', async () => {
      const logLines: string[] = [];
      const statuses = [200, 400, 401, 403, 404, 500, 418];

      for (const status of statuses) {
        vi.stubGlobal('fetch', fakeFetch([], () => ({ status, body: '10001' })));
        const ctx = makeCtx({
          log: {
            info: (msg: string) => logLines.push(msg),
            warn: (msg: string) => logLines.push(msg),
          },
        });
        const outcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), ctx);
        expect(JSON.stringify(outcome)).not.toContain(SENTINEL_SECRET);
      }

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
        })
      );
      const errOutcome = await errorcodeIncrementorProvider.allocate(makeAllocationRequest(), makeCtx());
      expect(JSON.stringify(errOutcome)).not.toContain(SENTINEL_SECRET);

      expect(logLines.join('\n')).not.toContain(SENTINEL_SECRET);
    });

    it('declares base_url with no default value', () => {
      const field = errorcodeIncrementorProvider.settings.find((f) => f.key === 'base_url');
      expect(field).toBeDefined();
      expect(field && 'default' in field ? (field as { default?: unknown }).default : undefined).toBeUndefined();
      expect(field?.required).toBe(true);
    });
  });
});
