import { describe, it, expect } from 'vitest';
import type { AllocationRequest, ErrorCodeProvider, ProviderContext, RepositoryInfo } from '../../src/error-codes/provider-api.js';

/**
 * Shared contract test suite every built-in and reference-example provider
 * runs against: `file-provider.test.ts` (WP-008) and the
 * `errorcode-incrementor` provider's own tests (WP-009) both call
 * `describeProviderContract` with their own `makeProvider`/`makeCtx`
 * factories, so a future provider added the same way inherits the same
 * baseline checks for free.
 *
 * This suite deliberately checks only what every `ErrorCodeProvider` must
 * hold, whatever its backend: a validated settings array, a positive
 * integer result, a monotonically increasing sequence, tolerance of unknown
 * request fields (the contract's own additive-evolution rule — see
 * `provider-api.ts`'s stability-rules docblock), and that `allocate` settles
 * instead of hanging when the context's `AbortSignal` is already aborted.
 * Provider-specific behaviour (scoping rules, HTTP status mapping, etc.)
 * belongs in that provider's own test file, not here.
 */

/** Builds a minimal, valid `AllocationRequest`, overridable per call. */
export function makeAllocationRequest(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    request_id: 'contract-test-request',
    cwd_path: null,
    repository: null,
    context: 'ContractTest',
    ...overrides,
  };
}

/** A `RepositoryInfo` fixture, for providers whose contract test wants a non-null repository. */
export function makeRepositoryInfo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    root_path: '/repo',
    folder_name: 'repo',
    package_name: null,
    ...overrides,
  };
}

/** A promise that resolves after `ms` milliseconds — used only to bound the abort-handling check with a generous ceiling, never to assert on timing. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races `promise` against a timeout, resolving to `'settled'` or
 * `'timed-out'` — never rejecting on the timeout branch, so the caller can
 * assert on the outcome without an unhandled rejection racing the test
 * runner's own teardown.
 */
async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<'settled' | 'timed-out'> {
  const timeout = wait(ms).then(() => 'timed-out' as const);
  const settled = promise.then(
    () => 'settled' as const,
    () => 'settled' as const
  );
  return Promise.race([settled, timeout]);
}

/**
 * Registers the shared provider-contract test suite for one provider.
 *
 * @param name - Used only in the generated `describe` block's title.
 * @param makeProvider - Builds a fresh provider instance for each test (a provider must not carry test-to-test state of its own).
 * @param makeCtx - Builds a fresh, valid `ProviderContext` for each test. Receives an optional `signal` override, used by the abort-handling check.
 */
export function describeProviderContract(
  name: string,
  makeProvider: () => ErrorCodeProvider,
  makeCtx: (overrides?: Partial<ProviderContext>) => ProviderContext
): void {
  describe(`${name} (shared provider contract)`, () => {
    it('declares a well-formed settings array', () => {
      const provider = makeProvider();
      // A duplicate key, an unknown type, or a missing `options` on a
      // `select` field all fail Zod validation the same way
      // `provider-validation.ts` checks it for every loaded provider —
      // re-running that exact check here catches a contract violation at
      // the moment a provider's settings change, not only at registry load
      // time.
      const seen = new Set<string>();
      for (const field of provider.settings) {
        expect(seen.has(field.key)).toBe(false);
        seen.add(field.key);
        if (field.type === 'select') {
          expect(field.options.length).toBeGreaterThan(0);
        }
      }
    });

    it('allocate() resolves to a positive integer on a fresh sequence', async () => {
      const provider = makeProvider();
      const outcome = await provider.allocate(makeAllocationRequest(), makeCtx());

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(Number.isSafeInteger(outcome.value)).toBe(true);
        expect(outcome.value).toBeGreaterThan(0);
      }
    });

    it('allocate() increases monotonically across repeated calls', async () => {
      const provider = makeProvider();
      const first = await provider.allocate(makeAllocationRequest(), makeCtx());
      const second = await provider.allocate(makeAllocationRequest({ request_id: 'contract-test-request-2' }), makeCtx());

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.value).toBeGreaterThan(first.value);
      }
    });

    it('allocate() ignores unknown fields on the request object', async () => {
      const provider = makeProvider();
      const requestWithExtra = { ...makeAllocationRequest(), unknown_future_field: 'anything' } as AllocationRequest;

      const outcome = await provider.allocate(requestWithExtra, makeCtx());
      expect(outcome.ok).toBe(true);
    });

    it('allocate() settles instead of hanging when the context signal is already aborted', async () => {
      const provider = makeProvider();
      const ctx = makeCtx({ signal: AbortSignal.abort(new Error('contract test: pre-aborted')) });

      const result = await settlesWithin(provider.allocate(makeAllocationRequest(), ctx), 2000);
      expect(result).toBe('settled');
    });
  });
}
