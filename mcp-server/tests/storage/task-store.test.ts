import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  taskDir,
  taskFilePath,
  readTaskFile,
  mutateTaskFile,
  TaskFileInvalidError,
} from '../../src/storage/task-store.js';

describe('storage/task-store.ts', () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), 'task-store-test-'));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  async function writeRaw(content: string): Promise<void> {
    await mkdir(taskDir(store), { recursive: true });
    await writeFile(taskFilePath(store), content, 'utf-8');
  }

  it('places the file at {store}/.tasks/tasks.json', () => {
    expect(taskDir(store)).toBe(join(store, '.tasks'));
    expect(taskFilePath(store)).toBe(join(store, '.tasks', 'tasks.json'));
  });

  it('reads a missing file as an empty file', async () => {
    const r = await readTaskFile(store);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.file.version).toBe(1);
      expect(r.file.tasks).toEqual([]);
    }
  });

  it('reads unparsable JSON as invalid', async () => {
    await writeRaw('<<<<<<< HEAD\n{}\n');
    const r = await readTaskFile(store);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.path).toBe(taskFilePath(store));
  });

  it('reads schema-invalid JSON as invalid', async () => {
    await writeRaw('{"version":2,"tasks":[]}');
    expect((await readTaskFile(store)).status).toBe('invalid');
  });

  it('rethrows non-ENOENT I/O errors', async () => {
    await mkdir(taskFilePath(store), { recursive: true }); // a directory where the file should be
    await expect(readTaskFile(store)).rejects.toThrow();
  });

  it('mutateTaskFile throws on an invalid file and leaves its bytes unchanged', async () => {
    const bad = '{ not json';
    await writeRaw(bad);
    let err: unknown;
    await mutateTaskFile(store, () => 1).catch((e) => {
      err = e;
    });
    expect(err).toBeInstanceOf(TaskFileInvalidError);
    expect((err as TaskFileInvalidError).message).toContain(taskFilePath(store));
    expect(await readFile(taskFilePath(store), 'utf-8')).toBe(bad);
  });

  it('writes pretty-printed JSON with updated last_updated and passes the result through', async () => {
    const result = await mutateTaskFile(store, () => 'done');
    expect(result).toBe('done');
    const raw = await readFile(taskFilePath(store), 'utf-8');
    expect(raw).toContain('\n  "version": 1');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.tasks).toEqual([]);
    expect(Number.isNaN(Date.parse(parsed.last_updated))).toBe(false);
  });

  it('writes nothing when the mutator throws', async () => {
    await expect(
      mutateTaskFile(store, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(readFile(taskFilePath(store), 'utf-8')).rejects.toThrow();
  });

  it('serialises concurrent mutations', async () => {
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mutateTaskFile(store, async (file) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          file.tasks.push({
            id: randomUUID(),
            text: `T${i}`,
            tags: [],
            priority: 0,
            completed: false,
            created_at: '2026-01-01T00:00:00Z',
          });
          active--;
        }),
      ),
    );
    expect(maxActive).toBe(1);
    const r = await readTaskFile(store);
    expect(r.status === 'ok' && r.file.tasks.length).toBe(5);
  });
});
