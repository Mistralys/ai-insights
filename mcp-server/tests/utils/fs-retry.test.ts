import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const { mockRename } = vi.hoisted(() => ({ mockRename: vi.fn() }));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    rename: (...args: Parameters<typeof actual.rename>) => mockRename(...args),
  };
});

const { renameWithRetry, RENAME_MAX_ATTEMPTS } = await import('../../src/utils/fs-retry.js');

describe('renameWithRetry', () => {
  const originalPlatform = process.platform;
  let tempDir: string;

  function setPlatform(value: string): void {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  }

  function errorWithCode(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: simulated`), { code });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fs-retry-test-'));
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    mockRename.mockReset();
    mockRename.mockImplementation(actual.rename);
  });

  afterEach(async () => {
    setPlatform(originalPlatform);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('renames a file when no error occurs', async () => {
    const from = join(tempDir, 'a.txt');
    const to = join(tempDir, 'b.txt');
    await writeFile(from, 'x', 'utf-8');

    await renameWithRetry(from, to);

    expect(await readFile(to, 'utf-8')).toBe('x');
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a transient %s on win32', async (code) => {
    setPlatform('win32');
    mockRename.mockImplementationOnce(async () => { throw errorWithCode(code); });

    await renameWithRetry(join(tempDir, 'missing-src'), join(tempDir, 'dest')).catch(() => { /* real rename of a missing file */ });

    expect(mockRename).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-Windows platforms', async () => {
    setPlatform('linux');
    mockRename.mockImplementationOnce(async () => { throw errorWithCode('EPERM'); });

    await expect(renameWithRetry('a', 'b')).rejects.toMatchObject({ code: 'EPERM' });
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transient error codes on win32', async () => {
    setPlatform('win32');
    mockRename.mockImplementationOnce(async () => { throw errorWithCode('ENOENT'); });

    await expect(renameWithRetry('a', 'b')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  it('stops after the attempt budget and throws the last error on win32', async () => {
    setPlatform('win32');
    mockRename.mockImplementation(async () => { throw errorWithCode('EBUSY'); });

    await expect(renameWithRetry('a', 'b')).rejects.toMatchObject({ code: 'EBUSY' });
    expect(mockRename).toHaveBeenCalledTimes(RENAME_MAX_ATTEMPTS);
  });
});
