import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';

// ---------------------------------------------------------------------------
// config-store.ts resolves its directory via resolveErrorCodesDir(), which
// is fixed to `~/.ai-insights/error-codes`. Rather than touching the real
// home directory, store-registry.js is mocked so resolveErrorCodesDir()
// returns a temp directory for the duration of each test. vi.mock is
// hoisted above imports, so the mock is installed before config-store.ts
// is first imported.
// ---------------------------------------------------------------------------
const { mockResolveErrorCodesDir } = vi.hoisted(() => ({
  mockResolveErrorCodesDir: vi.fn<[], string>(),
}));
vi.mock('../../src/storage/store-registry.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/storage/store-registry.js')>();
  return {
    ...actual,
    resolveErrorCodesDir: mockResolveErrorCodesDir,
  };
});

const { loadErrorCodeConfig, updateErrorCodeConfig } = await import(
  '../../src/error-codes/config-store.js'
);

describe('config-store', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'error-codes-config-test-'));
    mockResolveErrorCodesDir.mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('loadErrorCodeConfig', () => {
    it('returns the documented defaults when config.json is missing', async () => {
      const config = await loadErrorCodeConfig();
      expect(config).toEqual({
        version: 1,
        active_provider: 'file',
        temporary_prefix: '777',
        timeout_ms: 10000,
        retry: { default_wait_ms: 11000, max_wait_ms: 30000 },
        providers: {},
      });
    });

    it('returns the defaults when config.json contains malformed JSON', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'config.json'), '{ not json', 'utf-8');

      const config = await loadErrorCodeConfig();
      expect(config.active_provider).toBe('file');
    });

    it('returns the defaults when config.json fails schema validation', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'config.json'), JSON.stringify({ timeout_ms: 'not-a-number' }), 'utf-8');

      const config = await loadErrorCodeConfig();
      expect(config.active_provider).toBe('file');
    });
  });

  describe('updateErrorCodeConfig', () => {
    it('round-trips a save and load', async () => {
      await updateErrorCodeConfig((current) => ({
        ...current,
        active_provider: 'errorcode-incrementor',
        temporary_prefix: '888',
      }));

      const reloaded = await loadErrorCodeConfig();
      expect(reloaded.active_provider).toBe('errorcode-incrementor');
      expect(reloaded.temporary_prefix).toBe('888');
    });

    it.skipIf(platform() === 'win32')('writes config.json with mode 0600 on POSIX', async () => {
      await updateErrorCodeConfig((current) => current);
      const info = await stat(join(tempDir, 'config.json'));
      // eslint-disable-next-line no-bitwise
      expect(info.mode & 0o777).toBe(0o600);
    });

    it('preserves settings of a provider that is not currently installed', async () => {
      await updateErrorCodeConfig((current) => ({
        ...current,
        providers: {
          ...current.providers,
          'uninstalled-provider': { some_setting: 'kept-value' },
        },
      }));

      await updateErrorCodeConfig((current) => ({
        ...current,
        active_provider: 'file',
      }));

      const reloaded = await loadErrorCodeConfig();
      expect(reloaded.providers['uninstalled-provider']).toEqual({ some_setting: 'kept-value' });
    });

    it('loses no update across ten concurrent calls each setting a different key', async () => {
      const keys = Array.from({ length: 10 }, (_, i) => `provider-${i}`);

      await Promise.all(
        keys.map((key) =>
          updateErrorCodeConfig((current) => ({
            ...current,
            providers: {
              ...current.providers,
              [key]: { value: key },
            },
          }))
        )
      );

      const reloaded = await loadErrorCodeConfig();
      for (const key of keys) {
        expect(reloaded.providers[key]).toEqual({ value: key });
      }
    });
  });
});
