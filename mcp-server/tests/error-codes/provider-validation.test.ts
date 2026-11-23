import { describe, it, expect } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'url';
import { validateProvider } from '../../src/error-codes/provider-validation.js';
import type { ErrorCodeProvider } from '../../src/error-codes/provider-api.js';

/** Absolute path to the shipped example plugin's entry module (docs/examples/error-code-provider-example/index.mjs). */
const EXAMPLE_PLUGIN_MODULE_PATH = fileURLToPath(
  new URL('../../docs/examples/error-code-provider-example/index.mjs', import.meta.url)
);

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<ErrorCodeProvider> = {}): ErrorCodeProvider {
  return {
    apiVersion: 1,
    id: 'test-provider',
    label: 'Test Provider',
    settings: [],
    allocate: async () => ({ ok: true, value: 1 }),
    ...overrides,
  };
}

describe('provider-validation', () => {
  describe('validateProvider — acceptance', () => {
    it('accepts a well-formed provider with no settings', () => {
      const result = validateProvider(makeProvider());
      expect(result.ok).toBe(true);
    });

    it('accepts a well-formed provider with one of each settings type', () => {
      const provider = makeProvider({
        settings: [
          { key: 'scope', label: 'Scope', type: 'select', options: [{ value: 'global', label: 'Global' }], default: 'global' },
          { key: 'counter_file', label: 'Counter file', type: 'path', default: '' },
          { key: 'base_url', label: 'Base URL', type: 'url', required: true },
          { key: 'password', label: 'Password', type: 'secret', required: true },
          { key: 'start_value', label: 'Start value', type: 'integer', min: 1, default: 1 },
          { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
        ],
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(true);
    });

    it('accepts a provider with peek and test hooks', () => {
      const provider = makeProvider({
        peek: async () => ({ ok: true, value: 1 }),
        test: async () => ({ ok: true }),
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(true);
    });

    it('returns the original candidate object on success', () => {
      const provider = makeProvider();
      const result = validateProvider(provider);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe(provider);
      }
    });
  });

  describe('validateProvider — rejection', () => {
    it('rejects a non-object candidate', () => {
      const result = validateProvider('not-an-object');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('rejects an unsupported apiVersion', () => {
      const result = validateProvider(makeProvider({ apiVersion: 2 as 1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('apiVersion'))).toBe(true);
      }
    });

    it('rejects an invalid id (uppercase)', () => {
      const result = validateProvider(makeProvider({ id: 'Invalid-ID' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('id'))).toBe(true);
      }
    });

    it('rejects an invalid id (too short)', () => {
      const result = validateProvider(makeProvider({ id: 'a' }));
      expect(result.ok).toBe(false);
    });

    it('rejects a missing allocate', () => {
      const provider = makeProvider();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (provider as any).allocate;
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('allocate'))).toBe(true);
      }
    });

    it('rejects duplicate settings keys', () => {
      const provider = makeProvider({
        settings: [
          { key: 'dup', label: 'One', type: 'string' },
          { key: 'dup', label: 'Two', type: 'string' },
        ],
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
      }
    });

    it('rejects an unknown settings field type', () => {
      const provider = makeProvider({
        settings: [{ key: 'weird', label: 'Weird', type: 'unknown-type' } as never],
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
    });

    it('rejects a select field with no options', () => {
      const provider = makeProvider({
        settings: [{ key: 'scope', label: 'Scope', type: 'select', options: [] }],
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.toLowerCase().includes('options'))).toBe(true);
      }
    });

    it('rejects a present-but-non-function peek', () => {
      const provider = makeProvider({ peek: true as never });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('peek'))).toBe(true);
      }
    });

    it('rejects a present-but-non-function test', () => {
      const provider = makeProvider({ test: 'nope' as never });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('test'))).toBe(true);
      }
    });

    it('rejects an integer settings field whose min exceeds max', () => {
      const provider = makeProvider({
        settings: [{ key: 'n', label: 'N', type: 'integer', min: 10, max: 1 }],
      });
      const result = validateProvider(provider);
      expect(result.ok).toBe(false);
    });

    it('returns readable (non-empty) error strings', () => {
      const result = validateProvider(makeProvider({ id: 'BAD', label: '' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const error of result.errors) {
          expect(typeof error).toBe('string');
          expect(error.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('validateProvider — WP-012: the real example plugin', () => {
    it('validates the real example plugin shipped in docs/examples/error-code-provider-example', async () => {
      const mod: unknown = await import(pathToFileURL(EXAMPLE_PLUGIN_MODULE_PATH).href);
      const candidate = (mod as { default: unknown }).default;
      const result = validateProvider(candidate);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.id).toBe('example-json-counter');
      }
    });
  });
});
