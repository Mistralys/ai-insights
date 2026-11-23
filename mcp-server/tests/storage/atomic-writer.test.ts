import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';

// Spy on fs/promises' writeFile while delegating to the real implementation,
// so the TOCTOU regression test below can assert *how* atomicWriteJson calls
// it without breaking every other test in this file (which rely on the real
// write actually happening on disk). vi.spyOn can't target the built-in
// module's own export object (Node's fs/promises namespace is not
// configurable), so the mock is installed via vi.mock instead.
const { mockWriteFile, mockRename } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockRename: vi.fn(),
}));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  mockWriteFile.mockImplementation(actual.writeFile);
  mockRename.mockImplementation(actual.rename);
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => mockWriteFile(...args),
    rename: (...args: Parameters<typeof actual.rename>) => mockRename(...args),
  };
});

const { atomicWriteJson } = await import('../../src/storage/atomic-writer.js');

describe('atomicWriteJson', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atomic-writer-test-'));
    mockWriteFile.mockClear();
    mockRename.mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes valid pretty-printed JSON with a trailing newline', async () => {
    const filePath = join(tempDir, 'data.json');
    await atomicWriteJson(filePath, { a: 1 });
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('{\n  "a": 1\n}\n');
  });

  it('creates the parent directory when missing', async () => {
    const filePath = join(tempDir, 'nested', 'dir', 'data.json');
    await atomicWriteJson(filePath, { ok: true });
    const content = await readFile(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ ok: true });
  });

  it('writes successfully when no options are passed (backward compatible)', async () => {
    const filePath = join(tempDir, 'no-options.json');
    await expect(atomicWriteJson(filePath, { a: 1 })).resolves.toBeUndefined();
  });

  // POSIX file-mode behaviour. `chmod`'s mode bits are a no-op on Windows
  // (only the read-only attribute toggles there), so this assertion is
  // skipped on win32 rather than asserting Windows-specific behaviour.
  it.skipIf(platform() === 'win32')('applies the supplied mode to the written file', async () => {
    const filePath = join(tempDir, 'secret.json');
    await atomicWriteJson(filePath, { secret: 'value' }, { mode: 0o600 });
    const info = await stat(filePath);
    // Mask to the permission bits only; the file-type bits in st_mode are irrelevant here.
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('does not leave a temp file behind after a successful write', async () => {
    const filePath = join(tempDir, 'clean.json');
    await atomicWriteJson(filePath, { a: 1 }, { mode: 0o600 });
    const { readdir } = await import('fs/promises');
    const entries = await readdir(tempDir);
    expect(entries).toEqual(['clean.json']);
  });

  // Regression test for a security-audit finding (TOCTOU): the mode must be
  // applied at file-creation time via fs.writeFile's own `mode` option, not
  // via a separate chmod() call after the write — a separate call would
  // leave the temp file briefly world-readable between the two steps.
  it.skipIf(platform() === 'win32')(
    'applies the mode directly on the writeFile call, not via a separate chmod',
    async () => {
      const filePath = join(tempDir, 'secret-toctou.json');

      await atomicWriteJson(filePath, { secret: 'value' }, { mode: 0o600 });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [, , writeOptions] = mockWriteFile.mock.calls[0];
      expect(writeOptions).toEqual({ encoding: 'utf-8', mode: 0o600 });

      // No chmod import remains in the module; verifying the mode travelled
      // with the write call is the only way to assert the guarantee here.
      const info = await stat(filePath);
      expect(info.mode & 0o777).toBe(0o600);
    }
  );

  // Regression test for AC-02: two unlocked writers racing the same target
  // in one process (same pid) previously shared a literal `.tmp.{pid}` path
  // and could corrupt or lose one writer's payload. The per-call randomUUID()
  // suffix gives each call its own temp file, so both writes complete
  // independently and the target ends up holding one of the two payloads.
  it('resolves both calls and leaves no temp file when two unlocked writes race the same target', async () => {
    const filePath = join(tempDir, 'race.json');

    const [result1, result2] = await Promise.allSettled([
      atomicWriteJson(filePath, { writer: 1 }),
      atomicWriteJson(filePath, { writer: 2 }),
    ]);

    expect(result1.status).toBe('fulfilled');
    expect(result2.status).toBe('fulfilled');

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as { writer: number };
    expect([1, 2]).toContain(parsed.writer);

    const { readdir } = await import('fs/promises');
    const entries = await readdir(tempDir);
    expect(entries).toEqual(['race.json']);
  });

  it('uses a distinct temp path per call matching {filePath}.tmp.{pid}.{uuid}', async () => {
    const filePath = join(tempDir, 'distinct.json');
    const escapedFilePath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tempPathPattern = new RegExp(
      `^${escapedFilePath}\\.tmp\\.\\d+\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
    );

    await atomicWriteJson(filePath, { a: 1 });
    await atomicWriteJson(filePath, { a: 2 });

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    const [firstPath] = mockWriteFile.mock.calls[0] as [string];
    const [secondPath] = mockWriteFile.mock.calls[1] as [string];
    expect(firstPath).toMatch(tempPathPattern);
    expect(secondPath).toMatch(tempPathPattern);
    expect(firstPath).not.toBe(secondPath);
  });

  it('leaves no temp file behind when the rename step fails', async () => {
    const filePath = join(tempDir, 'rename-fails.json');
    mockRename.mockImplementationOnce(async () => {
      throw new Error('simulated rename failure');
    });

    await expect(atomicWriteJson(filePath, { a: 1 })).rejects.toThrow('simulated rename failure');

    const { readdir } = await import('fs/promises');
    const entries = await readdir(tempDir);
    expect(entries).toEqual([]);
  });
});
