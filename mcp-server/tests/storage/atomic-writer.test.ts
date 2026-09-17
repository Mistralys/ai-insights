/**
 * Tests for `src/storage/atomic-writer.ts` (WP-006).
 *
 * Coverage:
 *   - atomicWriteText(): performs a temp-then-rename write, creates the
 *     parent directory, and leaves no temp file behind on success — AC-01
 *   - atomicWriteJson(): continues to produce byte-identical output after
 *     delegating to atomicWriteText() — AC-01
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { atomicWriteText, atomicWriteJson } from '../../src/storage/atomic-writer.js';

describe('atomic-writer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atomic-writer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('atomicWriteText()', () => {
    it('writes the exact contents given, with no serialisation applied', async () => {
      const filePath = join(tempDir, 'note.md');
      await atomicWriteText(filePath, '# Hello\n\nSome text.\n');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('# Hello\n\nSome text.\n');
    });

    it('creates the parent directory when it does not exist', async () => {
      const filePath = join(tempDir, 'nested', 'deep', 'note.md');
      await atomicWriteText(filePath, 'content');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('content');
    });

    it('leaves no .tmp file behind after a successful write', async () => {
      const filePath = join(tempDir, 'note.md');
      await atomicWriteText(filePath, 'content');

      const entries = await readdir(tempDir);
      expect(entries).toEqual(['note.md']);
    });
  });

  describe('atomicWriteJson()', () => {
    it('produces pretty-printed JSON with a trailing newline', async () => {
      const filePath = join(tempDir, 'data.json');
      await atomicWriteJson(filePath, { a: 1, b: 'two' });

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe(JSON.stringify({ a: 1, b: 'two' }, null, 2) + '\n');
    });

    it('leaves no .tmp file behind after a successful write', async () => {
      const filePath = join(tempDir, 'data.json');
      await atomicWriteJson(filePath, { ok: true });

      const entries = await readdir(tempDir);
      expect(entries).toEqual(['data.json']);
    });
  });
});
