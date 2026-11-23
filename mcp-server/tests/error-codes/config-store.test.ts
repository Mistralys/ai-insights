import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { __setLockRetryForTesting, __resetLockOptionsForTesting } from '../../src/storage/file-lock.js';

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

const { loadErrorCodeConfig, readErrorCodeConfig, updateErrorCodeConfig, TemporaryPrefixSchema } = await import(
  '../../src/error-codes/config-store.js'
);

describe('config-store', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'error-codes-config-test-'));
    mockResolveErrorCodesDir.mockReturnValue(tempDir);
    // Installs a fast withLock retry policy so the ten-concurrent-calls
    // test below doesn't pay production lock backoff (see
    // mcp-server/src/storage/file-lock.ts).
    __setLockRetryForTesting({ minTimeout: 5, maxTimeout: 25 });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
    __resetLockOptionsForTesting();
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

    it('lets an invalid timeout_ms fall back alone, keeping every other field', async () => {
      await writeFile(
        join(tempDir, 'config.json'),
        JSON.stringify({ version: 1, active_provider: 'custom', timeout_ms: 'not-a-number', providers: { custom: { host: 'h' } } }),
        'utf-8'
      );

      const config = await loadErrorCodeConfig();

      expect(config.timeout_ms).toBe(10000);
      expect(config.active_provider).toBe('custom');
      expect(config.providers).toEqual({ custom: { host: 'h' } });
    });

    it('returns the defaults, with a warning, when the file is not a version 1 config object', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await writeFile(join(tempDir, 'config.json'), JSON.stringify({ version: 2, active_provider: 'x' }), 'utf-8');
        const config = await loadErrorCodeConfig();
        expect(config.active_provider).toBe('file');
        expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('config.json');
      } finally {
        stderr.mockRestore();
      }
    });

    it('never throws for an unreadable config.json and returns the defaults', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await mkdir(join(tempDir, 'config.json')); // a directory: readFile fails with EISDIR
        const config = await loadErrorCodeConfig();
        expect(config.active_provider).toBe('file');
      } finally {
        stderr.mockRestore();
      }
    });
  });

  describe('readErrorCodeConfig', () => {
    it('returns no warning when config.json is missing', async () => {
      const result = await readErrorCodeConfig();
      expect(result.warning).toBeUndefined();
      expect(result.config.active_provider).toBe('file');
    });

    it('returns no warning for a valid config.json', async () => {
      await writeFile(join(tempDir, 'config.json'), JSON.stringify({ version: 1, active_provider: 'file' }), 'utf-8');
      const result = await readErrorCodeConfig();
      expect(result.warning).toBeUndefined();
    });

    it('names the invalid field paths for a salvaged config, never a value', async () => {
      await writeFile(
        join(tempDir, 'config.json'),
        JSON.stringify({ version: 1, temporary_prefix: 'ERR', providers: { x: { password: 's3cret' } } }),
        'utf-8'
      );
      const result = await readErrorCodeConfig();
      expect(result.warning).toContain('temporary_prefix');
      expect(result.warning).not.toContain('ERR');
      expect(result.warning).not.toContain('s3cret');
      expect(result.config.providers).toEqual({ x: { password: 's3cret' } });
    });

    it('returns a fixed reason for a corrupt (unparsable) config.json, never a parser message', async () => {
      await writeFile(join(tempDir, 'config.json'), '{ not json, has "s3cret" inside', 'utf-8');
      const result = await readErrorCodeConfig();
      expect(result.warning).toBe('config.json is not valid JSON; using the defaults');
      expect(result.warning).not.toContain('s3cret');
    });

    it('returns a fixed reason for a not-version-1 config.json', async () => {
      await writeFile(join(tempDir, 'config.json'), JSON.stringify({ version: 2 }), 'utf-8');
      const result = await readErrorCodeConfig();
      expect(result.warning).toBe('config.json is not a version 1 config object; using the defaults');
    });

    it('returns a fixed reason for an unreadable config.json', async () => {
      await mkdir(join(tempDir, 'config.json')); // a directory: readFile fails with EISDIR
      const result = await readErrorCodeConfig();
      expect(result.warning).toBe('config.json cannot be read (EISDIR); using the defaults');
    });
  });

  describe('loadErrorCodeConfig / readErrorCodeConfig parity', () => {
    it('writes the exact same text to stderr that readErrorCodeConfig returns as warning, prefixed with [error-codes]', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await writeFile(join(tempDir, 'config.json'), JSON.stringify({ version: 2 }), 'utf-8');
        const { warning } = await readErrorCodeConfig();
        stderr.mockClear();
        await loadErrorCodeConfig();
        expect(stderr).toHaveBeenCalledWith(`[error-codes] ${warning}\n`);
      } finally {
        stderr.mockRestore();
      }
    });

    it('loadErrorCodeConfig writes nothing to stderr when readErrorCodeConfig reports no warning', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await loadErrorCodeConfig();
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        stderr.mockRestore();
      }
    });
  });

  describe('temporary_prefix', () => {
    it.each(['7', '777', '123456', '999999'])('accepts "%s"', (prefix) => {
      expect(TemporaryPrefixSchema.safeParse(prefix).success).toBe(true);
    });

    it.each(['', 'ERR', '0777', '1234567', '77a', ' 777', '7.7'])('rejects "%s"', (prefix) => {
      const result = TemporaryPrefixSchema.safeParse(prefix);
      expect(result.success).toBe(false);
    });

    it('an invalid stored prefix loads as 777 and keeps providers, secrets and the other fields', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await writeFile(
          join(tempDir, 'config.json'),
          JSON.stringify({
            version: 1,
            active_provider: 'errorcode-incrementor',
            temporary_prefix: 'ERR',
            timeout_ms: 5000,
            providers: { x: { password: 's3cret' } },
          }),
          'utf-8'
        );

        const loaded = await loadErrorCodeConfig();
        expect(loaded.temporary_prefix).toBe('777');
        expect(loaded.active_provider).toBe('errorcode-incrementor');
        expect(loaded.timeout_ms).toBe(5000);
        expect(loaded.providers).toEqual({ x: { password: 's3cret' } });

        // A later save keeps the providers and secrets and writes a valid prefix.
        await updateErrorCodeConfig((c) => ({ ...c, timeout_ms: 6000 }));
        const onDisk = JSON.parse(await readFile(join(tempDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
        expect(onDisk['temporary_prefix']).toBe('777');
        expect(onDisk['timeout_ms']).toBe(6000);
        expect((onDisk['providers'] as Record<string, Record<string, string>>)['x']!['password']).toBe('s3cret');

        // The warning names the field and never a value.
        const warned = stderr.mock.calls.map((c) => String(c[0])).join('');
        expect(warned).toContain('temporary_prefix');
        expect(warned).not.toContain('s3cret');
        expect(warned).not.toContain('ERR');
      } finally {
        stderr.mockRestore();
      }
    });

    it('drops a malformed provider entry alone and keeps the others', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await writeFile(
          join(tempDir, 'config.json'),
          JSON.stringify({ providers: { good: { a: 1 }, bad: 'oops' } }),
          'utf-8'
        );
        const loaded = await loadErrorCodeConfig();
        expect(loaded.providers).toEqual({ good: { a: 1 } });
        expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('providers.bad');
      } finally {
        stderr.mockRestore();
      }
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

    it('keeps a byte-identical copy of an unparsable config.json before saving over it', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const original = '{ "providers": { "x": { "password": "s3cret" ';
        await writeFile(join(tempDir, 'config.json'), original, 'utf-8');

        await updateErrorCodeConfig((c) => ({ ...c, timeout_ms: 7000 }));

        const copies = (await readdir(tempDir)).filter((n) => n.startsWith('config.corrupt-') && n.endsWith('.json'));
        expect(copies).toHaveLength(1);
        expect(await readFile(join(tempDir, copies[0]!), 'utf-8')).toBe(original);
        const saved = JSON.parse(await readFile(join(tempDir, 'config.json'), 'utf-8')) as { timeout_ms: number };
        expect(saved.timeout_ms).toBe(7000);
        expect(stderr.mock.calls.map((c) => String(c[0])).join('')).not.toContain('s3cret');
      } finally {
        stderr.mockRestore();
      }
    });

    it('throws and writes nothing when config.json cannot be read', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const path = join(tempDir, 'config.json');
        await mkdir(path); // a directory: readFile fails with EISDIR, which is not ENOENT

        await expect(updateErrorCodeConfig((c) => c)).rejects.toThrow(/cannot be read \(EISDIR\); not overwriting it/);
        expect((await stat(path)).isDirectory()).toBe(true);
        expect((await readdir(tempDir)).filter((n) => n.includes('.corrupt-'))).toEqual([]);
        expect((await loadErrorCodeConfig()).active_provider).toBe('file');
      } finally {
        stderr.mockRestore();
      }
    });

    it('rejects a mutator that returns an invalid prefix and writes nothing', async () => {
      await expect(updateErrorCodeConfig((c) => ({ ...c, temporary_prefix: 'ERR' }))).rejects.toThrow();
      await expect(stat(join(tempDir, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
