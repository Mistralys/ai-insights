/**
 * Tests for the Error-Code Provider API handler layer (WP-011).
 *
 * Coverage:
 *   AC-2: POST /api/error-codes/test calls test, else peek, else reports
 *         "offers no connection test"; never calls allocate; merges stored
 *         secrets only when every non-secret field is unchanged; a sentinel
 *         secret never reaches a provider whose non-secret settings changed.
 *   AC-3: GET/PUT /api/error-codes/config never returns a secret value
 *         (only { set: boolean }); an absent/empty secret on save keeps the
 *         stored value, clear_secrets clears it; settings of a currently-
 *         uninstalled provider survive the round trip; invalid settings are
 *         rejected.
 *   AC-4: GET /api/error-codes/providers returns id/label/description/
 *         settings/supports_test/source/path/load errors; GET
 *         /api/error-codes/temporary returns newest-first, capped by limit.
 *
 * Mocks the error-codes storage modules (config-store, provider-registry,
 * temporary-codes, store-registry's path resolvers) since they are keyed to
 * the real `~/.ai-insights/error-codes/` directory with no DI seam of their
 * own; exercises the real settings-schema/redact logic unmocked.
 */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorCodeConfig } from '../../src/error-codes/config-store.js';
import type { ErrorCodeProvider, AllocationOutcome, TestOutcome, ProviderContext, AllocationRequest } from '../../src/error-codes/provider-api.js';
import type { ProviderRegistryEntry, ProviderLoadError } from '../../src/error-codes/provider-registry.js';
import type { TemporaryCodeEntry } from '../../src/error-codes/temporary-codes.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockConfig: ErrorCodeConfig;
let mockConfigWarning: string | undefined;
let mockRegistryEntries: ProviderRegistryEntry[];
let mockLoadErrors: ProviderLoadError[];
let mockListTemporaryCodes = vi.fn(async (): Promise<{ entries: TemporaryCodeEntry[]; warning?: string }> => ({ entries: [] }));
let mockUpdateErrorCodeConfig = vi.fn(async (mutator: (c: ErrorCodeConfig) => ErrorCodeConfig) => {
  mockConfig = mutator(mockConfig);
  return mockConfig;
});

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

function makeProvider(overrides: Partial<ErrorCodeProvider> = {}): ErrorCodeProvider {
  return {
    apiVersion: 1,
    id: 'file',
    label: 'File',
    settings: [
      { key: 'host', label: 'Host', type: 'string', default: 'localhost' },
      { key: 'api_key', label: 'API Key', type: 'secret' },
    ],
    allocate: vi.fn(async () => ({ ok: true, value: 1 }) as AllocationOutcome),
    ...overrides,
  };
}

vi.mock('../../src/error-codes/config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/error-codes/config-store.js')>();
  return {
    // The real prefix schema: the PUT body schema is built from it at module load.
    TemporaryPrefixSchema: actual.TemporaryPrefixSchema,
    loadErrorCodeConfig: vi.fn(async () => mockConfig),
    readErrorCodeConfig: vi.fn(async () =>
      mockConfigWarning === undefined ? { config: mockConfig } : { config: mockConfig, warning: mockConfigWarning }
    ),
    updateErrorCodeConfig: (mutator: (c: ErrorCodeConfig) => ErrorCodeConfig) => mockUpdateErrorCodeConfig(mutator),
  };
});

vi.mock('../../src/error-codes/provider-registry.js', () => ({
  getProvider: vi.fn((id: string) => mockRegistryEntries.find((e) => e.provider.id === id)?.provider),
  listProviders: vi.fn(() => mockRegistryEntries),
  listProviderLoadErrors: vi.fn(() => mockLoadErrors),
}));

vi.mock('../../src/error-codes/temporary-codes.js', () => ({
  listTemporaryCodes: (dir: string) => mockListTemporaryCodes(dir),
}));

vi.mock('../../src/storage/store-registry.js', () => ({
  resolveErrorCodesDir: vi.fn(() => '/fake/.ai-insights/error-codes'),
  resolveErrorCodePluginDir: vi.fn(() => '/fake/.ai-insights/plugins/error-codes'),
  resolveErrorCodeProviderDataDir: vi.fn(
    (providerId: string) => `/fake/.ai-insights/error-codes/data/${providerId}`
  ),
}));

const {
  handleListErrorCodeProviders,
  handleGetErrorCodeConfig,
  handleUpdateErrorCodeConfig,
  handleTestErrorCodeProvider,
  handleListTemporaryErrorCodesGui,
} = await import('../../gui/api-error-codes.js');
const { ApiError } = await import('../../src/gui/errors.js');

beforeEach(() => {
  const provider = makeProvider();
  mockConfig = makeConfig();
  mockConfigWarning = undefined;
  mockRegistryEntries = [{ provider, source: 'builtin' }];
  mockLoadErrors = [];
  mockListTemporaryCodes = vi.fn(async () => ({ entries: [] }));
  mockUpdateErrorCodeConfig = vi.fn(async (mutator: (c: ErrorCodeConfig) => ErrorCodeConfig) => {
    mockConfig = mutator(mockConfig);
    return mockConfig;
  });
});

async function expectApiError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected an ApiError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// GET /api/error-codes/providers
// ---------------------------------------------------------------------------

describe('handleListErrorCodeProviders', () => {
  it('returns id/label/description/settings/supports_test/source for every registered provider', async () => {
    const result = await handleListErrorCodeProviders();
    expect(result.providers).toHaveLength(1);
    const item = result.providers[0]!;
    expect(item.id).toBe('file');
    expect(item.label).toBe('File');
    expect(item.settings).toHaveLength(2);
    expect(item.supports_test).toBe(false); // no test/peek on the default fake provider
    expect(item.source).toBe('builtin');
    expect(item.path).toBeUndefined();
    expect(result.plugin_dir).toBe('/fake/.ai-insights/plugins/error-codes');
  });

  it('marks supports_test true when the provider offers test or peek, and includes a plugin path for plugin-sourced entries', async () => {
    const withTest = makeProvider({ id: 'with-test', test: vi.fn(async () => ({ ok: true }) as TestOutcome) });
    mockRegistryEntries = [{ provider: withTest, source: 'plugin', path: '/plugins/with-test/index.mjs' }];

    const result = await handleListErrorCodeProviders();
    expect(result.providers[0]!.supports_test).toBe(true);
    expect(result.providers[0]!.source).toBe('plugin');
    expect(result.providers[0]!.path).toBe('/plugins/with-test/index.mjs');
  });

  it('reports load errors as { source, message } only', async () => {
    mockLoadErrors = [{ source: '/plugins/bad/index.mjs', message: 'invalid provider shape' }];
    const result = await handleListErrorCodeProviders();
    expect(result.load_errors).toEqual([{ source: '/plugins/bad/index.mjs', message: 'invalid provider shape' }]);
  });
});

// ---------------------------------------------------------------------------
// GET / PUT /api/error-codes/config
// ---------------------------------------------------------------------------

describe('handleGetErrorCodeConfig / handleUpdateErrorCodeConfig', () => {
  it('never returns a raw secret value — only { set: boolean }', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    const result = await handleGetErrorCodeConfig();
    expect(result.providers.file).toEqual({ host: 'db.internal', api_key: { set: true } });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('reports { set: false } when no secret is stored', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal' } } });
    const result = await handleGetErrorCodeConfig();
    expect(result.providers.file).toEqual({ host: 'db.internal', api_key: { set: false } });
  });

  it('keeps the stored secret when the incoming value is absent on save', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    const result = await handleUpdateErrorCodeConfig({ provider_id: 'file', settings: { host: 'db.internal' } });
    expect(result.providers.file).toEqual({ host: 'db.internal', api_key: { set: true } });
    expect(mockConfig.providers.file!.api_key).toBe('super-secret');
  });

  it('clears the stored secret when clear_secrets names it', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    const result = await handleUpdateErrorCodeConfig({
      provider_id: 'file',
      settings: { host: 'db.internal' },
      clear_secrets: ['api_key'],
    });
    expect(result.providers.file).toEqual({ host: 'db.internal', api_key: { set: false } });
  });

  it('round-trips settings for a currently-uninstalled provider untouched', async () => {
    mockConfig = makeConfig({
      active_provider: 'file',
      providers: { 'uninstalled-provider': { some_field: 'kept-as-is', secret_field: 'also-kept' } },
    });

    // An update that touches only the active_provider must not disturb the
    // uninstalled provider's stored block.
    await handleUpdateErrorCodeConfig({ active_provider: 'file' });
    expect(mockConfig.providers['uninstalled-provider']).toEqual({
      some_field: 'kept-as-is',
      secret_field: 'also-kept',
    });

    // And the GET response omits it entirely (no descriptors to mask its secrets safely).
    const result = await handleGetErrorCodeConfig();
    expect(result.providers['uninstalled-provider']).toBeUndefined();
  });

  it('rejects invalid provider settings with VALIDATION_ERROR and does not write them', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal' } } });
    await expectApiError(
      () => handleUpdateErrorCodeConfig({ provider_id: 'file', settings: { host: 123 } }),
      'VALIDATION_ERROR'
    );
    expect(mockConfig.providers.file).toEqual({ host: 'db.internal' });
  });

  it('rejects provider_id naming a currently-uninstalled provider', async () => {
    await expectApiError(
      () => handleUpdateErrorCodeConfig({ provider_id: 'does-not-exist', settings: {} }),
      'VALIDATION_ERROR'
    );
  });

  it('rejects active_provider naming a currently-uninstalled provider', async () => {
    await expectApiError(
      () => handleUpdateErrorCodeConfig({ active_provider: 'does-not-exist' }),
      'VALIDATION_ERROR'
    );
  });

  it('rejects a non-digit temporary_prefix with VALIDATION_ERROR and writes nothing', async () => {
    for (const bad of ['ERR', '', '0777', '1234567', '77a']) {
      mockUpdateErrorCodeConfig.mockClear();
      await expectApiError(() => handleUpdateErrorCodeConfig({ temporary_prefix: bad }), 'VALIDATION_ERROR');
      expect(mockUpdateErrorCodeConfig).not.toHaveBeenCalled();
      expect(mockConfig.temporary_prefix).toBe('777');
    }
  });

  it('accepts a valid temporary_prefix', async () => {
    const result = await handleUpdateErrorCodeConfig({ temporary_prefix: '4242' });
    expect(result.temporary_prefix).toBe('4242');
    expect(mockConfig.temporary_prefix).toBe('4242');
  });

  it('passes a config-store warning through to the GET response', async () => {
    mockConfigWarning = 'config.json has invalid fields (timeout_ms); using their defaults and keeping the rest';
    const result = await handleGetErrorCodeConfig();
    expect(result.warning).toBe(mockConfigWarning);
  });

  it('omits warning from the GET response when config-store reports none', async () => {
    mockConfigWarning = undefined;
    const result = await handleGetErrorCodeConfig();
    expect(result.warning).toBeUndefined();
    expect('warning' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/error-codes/test
// ---------------------------------------------------------------------------

describe('handleTestErrorCodeProvider', () => {
  it('calls test when present, and never calls allocate', async () => {
    const allocate = vi.fn(async () => ({ ok: true, value: 1 }) as AllocationOutcome);
    const test = vi.fn(async () => ({ ok: true, detail: 'connected' }) as TestOutcome);
    const provider = makeProvider({ allocate, test });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({ provider_id: 'file', settings: { host: 'db.internal' } });

    expect(test).toHaveBeenCalledTimes(1);
    expect(allocate).not.toHaveBeenCalled();
    expect(result.supported).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('connected');
  });

  it('falls back to peek when test is absent, and never calls allocate', async () => {
    const allocate = vi.fn(async () => ({ ok: true, value: 1 }) as AllocationOutcome);
    const peek = vi.fn(async (_req: AllocationRequest, _ctx: ProviderContext) => ({ ok: true, value: 7 }) as AllocationOutcome);
    const provider = makeProvider({ allocate, peek });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({ provider_id: 'file', settings: { host: 'db.internal' } });

    expect(peek).toHaveBeenCalledTimes(1);
    expect(allocate).not.toHaveBeenCalled();
    expect(result.supported).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(7);
  });

  it("passes the shared resolveErrorCodeProviderDataDir(providerId) value as data_dir", async () => {
    let capturedDataDir: string | undefined;
    const test = vi.fn(async (ctx: ProviderContext) => {
      capturedDataDir = ctx.data_dir;
      return { ok: true } as TestOutcome;
    });
    const provider = makeProvider({ test });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    await handleTestErrorCodeProvider({ provider_id: 'file', settings: { host: 'db.internal' } });

    expect(capturedDataDir).toBe('/fake/.ai-insights/error-codes/data/file');
  });

  it('reports "offers no connection test" and calls neither test, peek, nor allocate, when the provider offers neither hook', async () => {
    const allocate = vi.fn(async () => ({ ok: true, value: 1 }) as AllocationOutcome);
    const provider = makeProvider({ allocate });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({ provider_id: 'file' });

    expect(allocate).not.toHaveBeenCalled();
    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/offers no connection test/);
  });

  it('merges the stored secret in when non-secret settings are unchanged', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    let capturedSettings: Readonly<Record<string, unknown>> | undefined;
    const test = vi.fn(async (ctx: ProviderContext) => {
      capturedSettings = ctx.settings;
      return { ok: true } as TestOutcome;
    });
    const provider = makeProvider({ test });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({ provider_id: 'file', settings: { host: 'db.internal' } });

    expect(result.secrets_merged).toBe(true);
    expect(capturedSettings?.api_key).toBe('super-secret');
  });

  it('never merges the stored secret when a non-secret field changed, so the old secret never reaches the new destination', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    let capturedSettings: Readonly<Record<string, unknown>> | undefined;
    const test = vi.fn(async (ctx: ProviderContext) => {
      capturedSettings = ctx.settings;
      return { ok: true } as TestOutcome;
    });
    const provider = makeProvider({ test });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({
      provider_id: 'file',
      settings: { host: 'a-different-host', api_key: 'freshly-typed-value' },
    });

    expect(result.secrets_merged).toBe(false);
    expect(capturedSettings?.api_key).toBe('freshly-typed-value');
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('redacts a secret from the test result text', async () => {
    mockConfig = makeConfig({ providers: { file: { host: 'db.internal', api_key: 'super-secret' } } });
    const test = vi.fn(async () => ({ ok: false, reason: 'failed', detail: 'request used key super-secret' }) as TestOutcome);
    const provider = makeProvider({ test });
    mockRegistryEntries = [{ provider, source: 'builtin' }];

    const result = await handleTestErrorCodeProvider({ provider_id: 'file', settings: { host: 'db.internal' } });
    expect(result.detail).not.toContain('super-secret');
    expect(result.detail).toContain('[REDACTED]');
  });

  it('rejects an unknown or uninstalled provider_id', async () => {
    await expectApiError(() => handleTestErrorCodeProvider({ provider_id: 'does-not-exist' }), 'VALIDATION_ERROR');
  });
  it('reports failed with the counter-file detail when the file provider counter file is corrupt', async () => {
    const { fileProvider } = await import('../../src/error-codes/providers/file-provider.js');
    const dir = await mkdtemp(join(tmpdir(), 'ec-gui-corrupt-'));
    try {
      const counterFile = join(dir, 'counters.json');
      await writeFile(counterFile, '{ not json', 'utf-8');
      mockRegistryEntries = [{ provider: fileProvider, source: 'builtin' }];

      const result = await handleTestErrorCodeProvider({
        provider_id: 'file',
        settings: { scope: 'global', counter_file: counterFile, counter_name: 'default', start_value: 1 },
      });

      expect(result.supported).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('failed');
      expect(result.detail).toContain(counterFile);
      expect(await readFile(counterFile, 'utf-8')).toBe('{ not json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/error-codes/temporary
// ---------------------------------------------------------------------------

describe('handleListTemporaryErrorCodesGui', () => {
  function makeEntries(count: number): TemporaryCodeEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      code: `777${String(i + 1).padStart(6, '0')}`,
      issued_at: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
      provider: 'file',
      fallback_reason: 'misconfigured',
      detail: null,
      repository: null,
      context: null,
    }));
  }

  it('returns entries newest-first', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: makeEntries(3) }));
    const result = await handleListTemporaryErrorCodesGui();
    expect(result.entries.map((e) => e.code)).toEqual(['777000003', '777000002', '777000001']);
  });

  it('caps at the default limit (200) when limit is omitted', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: makeEntries(250) }));
    const result = await handleListTemporaryErrorCodesGui();
    expect(result.entries).toHaveLength(200);
  });

  it('caps at the requested limit query parameter', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: makeEntries(10) }));
    const result = await handleListTemporaryErrorCodesGui(new URLSearchParams('limit=3'));
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.code)).toEqual(['777000010', '777000009', '777000008']);
  });

  it('passes a listing warning through, and omits it when there is none', async () => {
    mockListTemporaryCodes = vi.fn(async () => ({ entries: makeEntries(2), warning: 'temporary-codes.json is corrupt' }));
    const withWarning = await handleListTemporaryErrorCodesGui();
    expect(withWarning.warning).toBe('temporary-codes.json is corrupt');
    expect(withWarning.entries).toHaveLength(2);

    mockListTemporaryCodes = vi.fn(async () => ({ entries: makeEntries(2) }));
    const without = await handleListTemporaryErrorCodesGui();
    expect('warning' in without).toBe(false);
  });

  it('rejects a non-positive-integer limit', async () => {
    await expectApiError(() => handleListTemporaryErrorCodesGui(new URLSearchParams('limit=0')), 'VALIDATION_ERROR');
    await expectApiError(() => handleListTemporaryErrorCodesGui(new URLSearchParams('limit=abc')), 'VALIDATION_ERROR');
  });
});
