import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

const ctx = vi.hoisted(() => ({
  initialized: true,
  stores: [] as Array<{ id: string; path: string; label: string }>,
  lockDepth: 0,
  maxLockDepth: 0,
  failPath: null as string | null,
}));

vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: () => ctx.initialized,
  getStoreRouter: () => ({
    getAllStores: () => ctx.stores,
    resolveDefaultStore: () => ctx.stores[0]!.path,
  }),
}));

vi.mock('../../src/storage/file-lock.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/storage/file-lock.js')>(
    '../../src/storage/file-lock.js',
  );
  return {
    ...actual,
    withLock: async <T>(p: string, fn: () => Promise<T>): Promise<T> => {
      return actual.withLock(p, async () => {
        ctx.lockDepth++;
        ctx.maxLockDepth = Math.max(ctx.maxLockDepth, ctx.lockDepth);
        try {
          return await fn();
        } finally {
          ctx.lockDepth--;
        }
      });
    },
  };
});

// Lets a test simulate a store whose file turns unreadable between load and write.
vi.mock('../../src/storage/task-store.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/storage/task-store.js')>(
    '../../src/storage/task-store.js',
  );
  return {
    ...actual,
    mutateTaskFile: (storePath: string, fn: never) => {
      if (ctx.failPath !== null && storePath === ctx.failPath) {
        return Promise.reject(new actual.TaskFileInvalidError(actual.taskFilePath(storePath), 'simulated corruption'));
      }
      return actual.mutateTaskFile(storePath, fn);
    },
  };
});

import {
  resolveTaskStores,
  resolveDefaultTaskStore,
  loadAllTasks,
  matchesFilters,
  listTasks,
  searchTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  TaskNotFoundError,
  TaskStoreNotFoundError,
  TaskFileInvalidError,
  TaskValidationError,
} from '../../src/storage/task-collection.js';
import { taskDir, taskFilePath } from '../../src/storage/task-store.js';

describe('storage/task-collection.ts', () => {
  let root: string;
  let a: string;
  let b: string;

  function raw(over: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      reference: null,
      text: 'task',
      tags: [] as string[],
      priority: 1,
      completed: false,
      created_at: '2026-01-01T00:00:00Z',
      ...over,
    };
  }

  async function seed(store: string, tasks: Array<Record<string, unknown>>) {
    await mkdir(taskDir(store), { recursive: true });
    await writeFile(
      taskFilePath(store),
      JSON.stringify({ version: 1, last_updated: '2026-01-01T00:00:00Z', tasks }),
      'utf-8',
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'task-coll-'));
    a = join(root, 'a');
    b = join(root, 'b');
    await mkdir(a);
    await mkdir(b);
    ctx.initialized = true;
    ctx.stores = [
      { id: 'a', path: a, label: 'Store A' },
      { id: 'b', path: b, label: 'Store B' },
    ];
    ctx.lockDepth = 0;
    ctx.maxLockDepth = 0;
    ctx.failPath = null;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('store resolution', () => {
    it('returns router stores when initialised', () => {
      expect(resolveTaskStores()).toEqual(ctx.stores);
      expect(resolveDefaultTaskStore().id).toBe('a');
    });

    it('falls back to the legacy default store when uninitialised', () => {
      ctx.initialized = false;
      const stores = resolveTaskStores();
      expect(stores).toHaveLength(1);
      expect(stores[0]!.id).toBe('default');
      expect(stores[0]!.label).toBe('Default Store');
      expect(resolveDefaultTaskStore().id).toBe('default');
    });
  });

  describe('loadAllTasks', () => {
    it('tags tasks, reports invalid stores and lets the first store win on duplicates', async () => {
      const dup = randomUUID();
      await seed(a, [raw({ id: dup, text: 'from a', reference: '12' })]);
      await seed(b, [raw({ id: dup, text: 'from b' }), raw({ text: 'only b' })]);
      const r = await loadAllTasks();
      expect(r.store_errors).toEqual([]);
      expect(r.tasks).toHaveLength(2);
      const d = r.tasks.find((t) => t.id === dup)!;
      expect(d.text).toBe('from a');
      expect(d.store_id).toBe('a');
      expect(d.store_label).toBe('Store A');
      expect(d.ticket_label).toBe('12');
      expect(d.ticket_url).toBeNull();

      await mkdir(taskDir(b), { recursive: true });
      await writeFile(taskFilePath(b), '<<<<<<< HEAD', 'utf-8');
      const r2 = await loadAllTasks();
      expect(r2.tasks).toHaveLength(1);
      expect(r2.store_errors).toHaveLength(1);
      expect(r2.store_errors[0]!.store_id).toBe('b');
    });

    it('does not persist the store', async () => {
      await createTask({ text: 'x', store: 'b' });
      const content = await readFile(taskFilePath(b), 'utf-8');
      expect(content).not.toContain('store_id');
      expect(content).not.toContain('store_label');
    });

    it('lists an unknown stored colour unchanged and matches the none filter', async () => {
      await seed(a, [raw({ color: 'chartreuse' })]);
      const { tasks } = await listTasks({ colors: ['none'] });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.color).toBe('chartreuse');
      expect((await listTasks({ colors: ['red'] })).tasks).toHaveLength(0);
    });
  });

  describe('createTask', () => {
    it('assigns defaults and priority max + 1 over all stores', async () => {
      const first = await createTask({ text: 'first' });
      expect(first.priority).toBe(1);
      expect(first.completed).toBe(false);
      expect(first.color).toBe('');
      expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(first.created_at).toBeTruthy();
      await seed(b, [raw({ priority: 7 })]);
      const next = await createTask({ text: 'second', store: 'a', color: 'red' });
      expect(next.priority).toBe(8);
      expect(next.color).toBe('red');
      expect(next.store_id).toBe('a');
    });

    it('throws TaskStoreNotFoundError listing valid ids', async () => {
      const err = await createTask({ text: 'x', store: 'nope' }).catch((e) => e);
      expect(err).toBeInstanceOf(TaskStoreNotFoundError);
      expect(err.message).toContain('a, b');
    });

    it('throws TaskValidationError on bad input', async () => {
      await expect(createTask({ text: '' })).rejects.toBeInstanceOf(TaskValidationError);
      await expect(createTask({ text: 'x', color: 'mauve' })).rejects.toBeInstanceOf(TaskValidationError);
      await expect(createTask({ text: 'x', reference: 'abc' })).rejects.toBeInstanceOf(TaskValidationError);
      await expect(createTask({ text: 'x', tags: ['!!'] })).rejects.toBeInstanceOf(TaskValidationError);
    });
  });

  describe('updateTask', () => {
    it('completes, stores completion_source, and clears both on reopen', async () => {
      const t = await createTask({ text: 'x' });
      const done = await updateTask(t.id, { completed: true, completion_source: 'plan-1' });
      expect(done.completed).toBe(true);
      expect(done.completed_at).toBeTruthy();
      expect(done.completion_source).toBe('plan-1');
      expect(done.updated_at).toBeTruthy();
      const reopened = await updateTask(t.id, { completed: false });
      expect(reopened.completed).toBe(false);
      expect(reopened.completed_at).toBeUndefined();
      expect(reopened.completion_source).toBeUndefined();
    });

    it('rejects completion_source for a task that stays open', async () => {
      const t = await createTask({ text: 'x' });
      await expect(updateTask(t.id, { completion_source: 's' })).rejects.toBeInstanceOf(TaskValidationError);
    });

    it('re-normalises and clears reference, replaces colour and priority', async () => {
      const t = await createTask({ text: 'x', color: 'blue' });
      const r = await updateTask(t.id, { reference: 'abc-12', color: '', priority: 50 });
      expect(r.reference).toBe('ABC-12');
      expect(r.color).toBe('');
      expect(r.priority).toBe(50);
      const c = await updateTask(t.id, { reference: null });
      expect(c.reference).toBeNull();
    });

    it('throws TaskNotFoundError for unknown ids', async () => {
      await expect(updateTask(randomUUID(), { text: 'y' })).rejects.toBeInstanceOf(TaskNotFoundError);
    });
  });

  describe('getTask / deleteTask', () => {
    it('gets and deletes from the owning store', async () => {
      const t = await createTask({ text: 'x', store: 'b' });
      expect((await getTask(t.id)).store_id).toBe('b');
      await deleteTask(t.id);
      await expect(getTask(t.id)).rejects.toBeInstanceOf(TaskNotFoundError);
      await expect(deleteTask(t.id)).rejects.toBeInstanceOf(TaskNotFoundError);
    });

    it('error classes are instanceof-distinguishable', () => {
      const errs: Error[] = [
        new TaskNotFoundError('x'),
        new TaskStoreNotFoundError('x', []),
        new TaskFileInvalidError('p', 'm'),
        new TaskValidationError('m'),
      ];
      for (const e of errs) {
        expect(e).toBeInstanceOf(Error);
        expect(errs.filter((o) => o.constructor === e.constructor)).toHaveLength(1);
      }
      expect(errs[0]).not.toBeInstanceOf(TaskValidationError);
      expect(errs[3]).not.toBeInstanceOf(TaskNotFoundError);
    });
  });

  describe('matchesFilters / listTasks', () => {
    const base = { completed: false, tags: ['a', 'b'], color: 'red', store_id: 's', reference: '5' };

    it('applies status, AND tags, OR colours, store and reference', () => {
      expect(matchesFilters(base, {})).toBe(true);
      expect(matchesFilters(base, { status: 'completed' })).toBe(false);
      expect(matchesFilters(base, { tags: ['a', 'b'] })).toBe(true);
      expect(matchesFilters(base, { tags: ['a', 'c'] })).toBe(false);
      expect(matchesFilters(base, { colors: ['blue', 'red'] })).toBe(true);
      expect(matchesFilters(base, { colors: ['blue'] })).toBe(false);
      expect(matchesFilters(base, { colors: [] })).toBe(true);
      expect(matchesFilters({ ...base, color: '' }, { colors: ['none'] })).toBe(true);
      expect(matchesFilters(base, { store: 'x' })).toBe(false);
      expect(matchesFilters(base, { reference: '5' })).toBe(true);
      expect(matchesFilters(base, { reference: '6' })).toBe(false);
    });

    it('filters, sorts and paginates', async () => {
      await seed(a, [
        raw({ text: 'one', priority: 1 }),
        raw({ text: 'two', priority: 3 }),
        raw({ text: 'three', priority: 2, completed: true, completed_at: '2026-02-01T00:00:00Z' }),
      ]);
      const open = await listTasks({ status: 'open' });
      expect(open.tasks.map((t) => t.text)).toEqual(['two', 'one']);
      expect(open.total).toBe(2);
      const page = await listTasks({}, { limit: 1, offset: 1 });
      expect(page.tasks.map((t) => t.text)).toEqual(['three']);
      expect(page.total).toBe(3);
    });

    it('normalises a reference filter against the queue', async () => {
      await seed(a, [raw({ reference: '12', text: 'ref' }), raw({ text: 'none' })]);
      expect((await listTasks({ reference: '12' })).tasks.map((t) => t.text)).toEqual(['ref']);
      await expect(listTasks({ reference: 'zz' })).rejects.toBeInstanceOf(TaskValidationError);
    });
  });

  describe('searchTasks', () => {
    it('ranks by OR match count then sort; empty query lists', async () => {
      await seed(a, [
        raw({ text: 'fix login bug', priority: 1 }),
        raw({ text: 'fix typo', priority: 9 }),
        raw({ text: 'unrelated', tags: ['login'], priority: 5 }),
        raw({ text: 'nothing', priority: 6 }),
      ]);
      const r = await searchTasks('Login  FIX');
      expect(r.tasks.map((t) => t.text)).toEqual(['fix login bug', 'fix typo', 'unrelated']);
      expect((await searchTasks('')).tasks).toHaveLength(4);
    });

    it('matches the ticket label', async () => {
      await seed(a, [raw({ reference: 'ABC-7', text: 'x' }), raw({ text: 'y' })]);
      expect((await searchTasks('abc-7')).tasks).toHaveLength(1);
    });
  });

  describe('reorderTasks', () => {
    it('applies assignments across stores without nesting locks', async () => {
      const t1 = await createTask({ text: 'one', store: 'a' });
      const t2 = await createTask({ text: 'two', store: 'b' });
      ctx.maxLockDepth = 0;
      const r = await reorderTasks([
        { id: t1.id, priority: 20 },
        { id: t2.id, priority: 10 },
      ]);
      expect(r.failed).toEqual([]);
      expect([...r.updated].sort()).toEqual([t1.id, t2.id].sort());
      expect(ctx.maxLockDepth).toBe(1);
      expect((await getTask(t1.id)).priority).toBe(20);
      expect((await getTask(t2.id)).priority).toBe(10);
    });

    it('rejects unknown ids before applying anything', async () => {
      const t1 = await createTask({ text: 'one' });
      await expect(
        reorderTasks([{ id: t1.id, priority: 99 }, { id: randomUUID(), priority: 1 }]),
      ).rejects.toBeInstanceOf(TaskNotFoundError);
      expect((await getTask(t1.id)).priority).toBe(1);
    });

    it('reports a failing store in failed and applies the others', async () => {
      const t1 = await createTask({ text: 'one', store: 'a' });
      const t2 = await createTask({ text: 'two', store: 'b' });
      ctx.failPath = b;
      const r = await reorderTasks([
        { id: t1.id, priority: 5 },
        { id: t2.id, priority: 6 },
      ]);
      expect(r.updated).toEqual([t1.id]);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0]!.store_id).toBe('b');
      expect(r.failed[0]!.ids).toEqual([t2.id]);
      ctx.failPath = null;
      expect((await getTask(t1.id)).priority).toBe(5);
      expect((await getTask(t2.id)).priority).toBe(t2.priority);
    });
  });
});
