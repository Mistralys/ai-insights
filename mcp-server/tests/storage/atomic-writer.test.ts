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
const { mockWriteFile } = vi.hoisted(() => ({ mockWriteFile: vi.fn() }));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  mockWriteFile.mockImplementation(actual.writeFile);
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => mockWriteFile(...args),
  };
});

const { atomicWriteJson } = await import('../../src/storage/atomic-writer.js');

describe('atomicWriteJson', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atomic-writer-test-'));
    mockWriteFile.mockClear();
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
});
