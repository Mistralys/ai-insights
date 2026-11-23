import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonStateFile, keepCorruptCopy } from '../../src/storage/json-state-file.js';

describe('json-state-file', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'json-state-file-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readJsonStateFile', () => {
    it('reports a missing file as missing', async () => {
      expect(await readJsonStateFile(join(dir, 'absent.json'))).toEqual({ status: 'missing' });
    });

    it('returns the raw text and the parsed value for valid JSON', async () => {
      const path = join(dir, 'ok.json');
      await writeFile(path, '{"a":1}', 'utf-8');
      expect(await readJsonStateFile(path)).toEqual({ status: 'parsed', raw: '{"a":1}', value: { a: 1 } });
    });

    it('reports invalid JSON as unparsable, keeping the raw text', async () => {
      const path = join(dir, 'bad.json');
      await writeFile(path, '{ not json', 'utf-8');
      const result = await readJsonStateFile(path);
      expect(result.status).toBe('unparsable');
      if (result.status === 'unparsable') {
        expect(result.raw).toBe('{ not json');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it('rethrows an I/O error other than ENOENT, with its code', async () => {
      // A directory in place of the file makes readFile fail with EISDIR.
      const path = join(dir, 'a-directory.json');
      await mkdir(path);
      await expect(readJsonStateFile(path)).rejects.toMatchObject({ code: 'EISDIR' });
    });
  });

  describe('keepCorruptCopy', () => {
    const now = new Date('2026-11-20T16:05:09.123Z');

    it('writes a byte-identical copy beside the file and leaves the original in place', async () => {
      const path = join(dir, 'state.json');
      await writeFile(path, '{ corrupt', 'utf-8');

      const name = await keepCorruptCopy(path, now);

      expect(name).toBe('state.corrupt-20261120T160509Z.json');
      expect(await readFile(join(dir, name), 'utf-8')).toBe('{ corrupt');
      expect(await readFile(path, 'utf-8')).toBe('{ corrupt');
    });

    it('never overwrites an existing copy: a name collision gets a numeric suffix', async () => {
      const path = join(dir, 'state.json');
      await writeFile(path, 'first', 'utf-8');
      const first = await keepCorruptCopy(path, now);

      await writeFile(path, 'second', 'utf-8');
      const second = await keepCorruptCopy(path, now);

      expect(second).toBe('state.corrupt-20261120T160509Z-2.json');
      expect(await readFile(join(dir, first), 'utf-8')).toBe('first');
      expect(await readFile(join(dir, second), 'utf-8')).toBe('second');
      expect((await readdir(dir)).sort()).toEqual([first, second, 'state.json'].sort());
    });

    it('produces a name with no characters that are invalid on Windows', async () => {
      const path = join(dir, 'state.json');
      await writeFile(path, 'x', 'utf-8');
      const name = await keepCorruptCopy(path, now);
      expect(name).not.toMatch(/[:<>"|?*]/);
    });

    it('rejects when the file to copy does not exist', async () => {
      await expect(keepCorruptCopy(join(dir, 'absent.json'), now)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});
