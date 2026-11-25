/**
 * Tests for gui/api-tasks.ts — the task REST handlers, run against two
 * temporary stores behind a mocked store context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ctx = vi.hoisted(() => ({
  stores: [] as Array<{ id: string; path: string; label: string }>,
  failPath: null as string | null,
}));

vi.mock('../../src/storage/task-store.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/storage/task-store.js')>(
    '../../src/storage/task-store.js',
  );
  return {
    ...actual,
    mutateTaskFile: (storePath: string, fn: never) => {
      if (ctx.failPath !== null && storePath === ctx.failPath) {
        return Promise.reject(new actual.TaskFileInvalidError(actual.taskFilePath(storePath), 'simulated'));
      }
      return actual.mutateTaskFile(storePath, fn);
    },
  };
});

vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: () => true,
  getStoreRouter: () => ({
    getAllStores: () => ctx.stores,
    resolveDefaultStore: () => ctx.stores[0]!.path,
  }),
}));

import {
  handleListTasks,
  handleCreateTask,
  handleUpdateTask,
  handleDeleteTask,
  handleReorderTasks,
  parseTaskId,
  TaskCreateBodySchema,
  TaskUpdateBodySchema,
  TaskReorderBodySchema,
  ApiError,
} from '../../gui/api-tasks.js';
import { taskDir, taskFilePath } from '../../src/storage/task-store.js';

async function code(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected rejection');
}

describe('gui/api-tasks.ts', () => {
  let root: string;
  let a: string;
  let b: string;

  const raw = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    reference: null,
    text: 'task',
    tags: [] as string[],
    priority: 1,
    completed: false,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  async function seed(store: string, tasks: Array<Record<string, unknown>>) {
    await mkdir(taskDir(store), { recursive: true });
    await writeFile(
      taskFilePath(store),
      JSON.stringify({ version: 1, last_updated: '2026-01-01T00:00:00Z', tasks }),
      'utf-8',
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'api-tasks-'));
    a = join(root, 'a');
    b = join(root, 'b');
    await mkdir(a);
    await mkdir(b);
    ctx.failPath = null;
    ctx.stores = [
      { id: 'a', path: a, label: 'Store A' },
      { id: 'b', path: b, label: 'Store B' },
    ];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('parseTaskId', () => {
    it('accepts a UUID and rejects everything else', () => {
      const id = randomUUID();
      expect(parseTaskId(id)).toBe(id);
      expect(() => parseTaskId('nope')).toThrow(/Invalid task id\./);
      expect(() => parseTaskId('../etc')).toThrow(ApiError);
    });
  });

  describe('body schemas', () => {
    it('are strict', () => {
      expect(TaskCreateBodySchema.safeParse({ text: 'x', extra: 1 }).success).toBe(false);
      expect(TaskUpdateBodySchema.safeParse({ extra: 1 }).success).toBe(false);
      expect(TaskReorderBodySchema.safeParse({ assignments: [], x: 1 }).success).toBe(false);
    });

    it('reorder accepts 1-500 entries only', () => {
      const entry = () => ({ id: randomUUID(), priority: 1 });
      const make = (n: number) => ({ assignments: Array.from({ length: n }, entry) });
      expect(TaskReorderBodySchema.safeParse(make(0)).success).toBe(false);
      expect(TaskReorderBodySchema.safeParse(make(1)).success).toBe(true);
      expect(TaskReorderBodySchema.safeParse(make(500)).success).toBe(true);
      expect(TaskReorderBodySchema.safeParse(make(501)).success).toBe(false);
    });
  });

  describe('handleListTasks', () => {
    it('returns tasks, stores, settings and store_errors; each task has a color', async () => {
      await seed(a, [raw({ text: 'low', priority: 1 }), raw({ text: 'done', completed: true, priority: 7 })]);
      await seed(b, [raw({ text: 'high', priority: 5, color: 'teal' })]);
      const out = await handleListTasks();
      expect(out.tasks.map((t) => t.text)).toEqual(['done', 'high', 'low']);
      expect(out.tasks.every((t) => typeof t.color === 'string')).toBe(true);
      expect(out.stores).toEqual([
        { id: 'a', label: 'Store A', is_default: true },
        { id: 'b', label: 'Store B', is_default: false },
      ]);
      expect(out.settings).toHaveProperty('page_size');
      expect(out.store_errors).toEqual([]);
    });

    it('reports an unreadable store without leaking its path', async () => {
      await mkdir(taskDir(b), { recursive: true });
      await writeFile(taskFilePath(b), '{ broken', 'utf-8');
      const out = await handleListTasks();
      expect(out.store_errors).toHaveLength(1);
      expect(out.store_errors[0]!.store_id).toBe('b');
      expect(JSON.stringify(out.store_errors)).not.toContain(root);
    });
  });

  describe('handleCreateTask', () => {
    it('creates with a valid colour in the default store', async () => {
      const task = await handleCreateTask({ text: 'Hello', color: 'violet', tags: ['x'] });
      expect(task.color).toBe('violet');
      expect(task.store_id).toBe('a');
    });

    it('validates the body', async () => {
      expect((await code(handleCreateTask({}))).code).toBe('VALIDATION_ERROR');
      expect((await code(handleCreateTask({ text: 'x', unknown: true }))).code).toBe('VALIDATION_ERROR');
      expect((await code(handleCreateTask({ text: 'x', color: '#8b5cf6' }))).code).toBe('VALIDATION_ERROR');
      expect((await code(handleCreateTask({ text: '   ' }))).code).toBe('VALIDATION_ERROR');
    });

    it('maps an unknown store to NOT_FOUND', async () => {
      expect((await code(handleCreateTask({ text: 'x', store_id: 'zz' }))).code).toBe('NOT_FOUND');
    });

    it('maps an invalid store file to CONFLICT without the path', async () => {
      await mkdir(taskDir(b), { recursive: true });
      await writeFile(taskFilePath(b), '{ broken', 'utf-8');
      const err = await code(handleCreateTask({ text: 'x', store_id: 'b' }));
      expect(err.code).toBe('CONFLICT');
      expect(err.message).not.toContain(root);
    });
  });

  describe('handleUpdateTask', () => {
    it('rejects a malformed id before anything else', async () => {
      const err = await code(handleUpdateTask('bad', null));
      expect(err).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid task id.' });
    });

    it('persists changes and returns the updated task', async () => {
      const created = await handleCreateTask({ text: 'T' });
      const updated = await handleUpdateTask(created.id, { color: 'violet', priority: 9 });
      expect(updated.color).toBe('violet');
      expect(updated.priority).toBe(9);
      const fileContent = JSON.parse(await readFile(taskFilePath(a), 'utf-8'));
      expect(fileContent.tasks[0].color).toBe('violet');
      expect((await handleUpdateTask(created.id, { color: '' })).color).toBe('');
    });

    it('rejects null and non-palette colours', async () => {
      const created = await handleCreateTask({ text: 'T' });
      expect((await code(handleUpdateTask(created.id, { color: null }))).code).toBe('VALIDATION_ERROR');
      expect((await code(handleUpdateTask(created.id, { color: '#8b5cf6' }))).code).toBe('VALIDATION_ERROR');
    });

    it('returns NOT_FOUND for a well-formed unknown id', async () => {
      expect((await code(handleUpdateTask(randomUUID(), { text: 'x' }))).code).toBe('NOT_FOUND');
    });

    it('rejects completion_source on a task that stays open', async () => {
      const created = await handleCreateTask({ text: 'T' });
      expect((await code(handleUpdateTask(created.id, { completion_source: 'x' }))).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('handleDeleteTask', () => {
    it('removes the task', async () => {
      const created = await handleCreateTask({ text: 'T' });
      expect(await handleDeleteTask(created.id)).toEqual({ id: created.id, deleted: true });
      expect((await handleListTasks()).tasks).toHaveLength(0);
    });

    it('validates the id and reports unknown ones', async () => {
      expect((await code(handleDeleteTask('x'))).message).toBe('Invalid task id.');
      expect((await code(handleDeleteTask(randomUUID()))).code).toBe('NOT_FOUND');
    });
  });

  describe('handleReorderTasks', () => {
    it('writes a cross-store batch', async () => {
      const t1 = raw({ priority: 1 });
      const t2 = raw({ priority: 2 });
      await seed(a, [t1]);
      await seed(b, [t2]);
      const out = await handleReorderTasks({
        assignments: [
          { id: t1.id, priority: 10 },
          { id: t2.id, priority: 20 },
        ],
      });
      expect(out.updated.sort()).toEqual([t1.id, t2.id].sort());
      expect(out.failed).toEqual([]);
      const list = await handleListTasks();
      expect(list.tasks.map((t) => t.priority)).toEqual([20, 10]);
    });

    it('returns an unknown id as NOT_FOUND', async () => {
      expect(
        (await code(handleReorderTasks({ assignments: [{ id: randomUUID(), priority: 1 }] }))).code,
      ).toBe('NOT_FOUND');
    });

    it('reports a failing store in failed[] with a 200-style result and no paths', async () => {
      const t1 = raw();
      const t2 = raw();
      await seed(a, [t1]);
      await seed(b, [t2]);
      ctx.failPath = b;
      const out = await handleReorderTasks({
        assignments: [
          { id: t1.id, priority: 3 },
          { id: t2.id, priority: 4 },
        ],
      });
      expect(out.updated).toEqual([t1.id]);
      expect(out.failed).toHaveLength(1);
      expect(out.failed[0]!.store_id).toBe('b');
      expect(out.failed[0]!.ids).toEqual([t2.id]);
      expect(out.failed[0]!.message).not.toContain(root);
    });

    it('validates the body', async () => {
      expect((await code(handleReorderTasks({ assignments: [] }))).code).toBe('VALIDATION_ERROR');
    });
  });
});
