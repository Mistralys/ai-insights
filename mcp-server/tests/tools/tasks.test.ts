/**
 * Tests for the six ledger_*_task MCP tools. Handlers are driven via _internal
 * against two temporary stores behind a mocked store context.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

const ctx = vi.hoisted(() => ({ stores: [] as Array<{ id: string; path: string; label: string }> }));

vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: () => true,
  getStoreRouter: () => ({
    getAllStores: () => ctx.stores,
    resolveDefaultStore: () => ctx.stores[0]!.path,
  }),
}));

import { _internal } from '../../src/tools/tasks.js';
import { TASK_COLOR_IDS } from '../../src/schema/task.js';
import { taskDir, taskFilePath } from '../../src/storage/task-store.js';

const t = _internal;

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const parse = (r: Result) => JSON.parse(r.content[0]!.text);

describe('task MCP tools', () => {
  let root: string;
  let a: string;
  let b: string;

  async function seed(store: string, tasks: Array<Record<string, unknown>>) {
    await mkdir(taskDir(store), { recursive: true });
    await writeFile(
      taskFilePath(store),
      JSON.stringify({ version: 1, last_updated: '2026-01-01T00:00:00Z', tasks }),
      'utf-8',
    );
  }

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

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'task-tools-'));
    a = join(root, 'a');
    b = join(root, 'b');
    await mkdir(a);
    await mkdir(b);
    ctx.stores = [
      { id: 'a', path: a, label: 'Store A' },
      { id: 'b', path: b, label: 'Store B' },
    ];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('schemas', () => {
    it('search has no colors key; list has one', () => {
      expect('colors' in t.SearchTasksSchema.shape).toBe(false);
      expect('colors' in t.ListTasksSchema.shape).toBe(true);
    });

    it('color and colors descriptions contain all palette ids', () => {
      const descs = [
        t.AddTaskSchema.shape.color.description,
        t.UpdateTaskSchema.shape.color.description,
        t.ListTasksSchema.shape.colors.description,
      ];
      for (const d of descs) {
        for (const id of TASK_COLOR_IDS) expect(d).toContain(id);
      }
    });

    it('accepts string-encoded limit and offset', () => {
      const parsed = t.ListTasksSchema.parse({ limit: '5', offset: '2' });
      expect(parsed.limit).toBe(5);
      expect(parsed.offset).toBe(2);
    });
  });

  describe('add / get', () => {
    it('adds to the default store with a colour and returns pretty JSON', async () => {
      const r = await t.addTask({ text: 'Hello', color: 'red', tags: ['Bug'] });
      expect(r.isError).toBeUndefined();
      expect(r.content[0]!.text).toContain('\n  "');
      const task = parse(r);
      expect(task.store_id).toBe('a');
      expect(task.color).toBe('red');
      expect(task.tags).toEqual(['bug']);
      expect(parse(await t.getTask({ id: task.id })).id).toBe(task.id);
    });

    it('adds to a chosen store and defaults color to empty string', async () => {
      const task = parse(await t.addTask({ text: 'X', store_id: 'b' }));
      expect(task.store_id).toBe('b');
      expect(task.color).toBe('');
    });

    it('rejects an unknown store listing valid ids', async () => {
      const r = await t.addTask({ text: 'X', store_id: 'nope' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain('a, b');
    });

    it('rejects an invalid colour naming the valid ids', async () => {
      const r = await t.addTask({ text: 'X', color: 'purple' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain('violet');
    });

    it('get of a missing task is an error', async () => {
      expect((await t.getTask({ id: randomUUID() })).isError).toBe(true);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await seed(a, [
        raw({ text: 'open red', color: 'red', priority: 3 }),
        raw({ text: 'done', completed: true, completed_at: '2026-02-01T00:00:00Z', priority: 9 }),
      ]);
      await seed(b, [raw({ text: 'open none', priority: 5 })]);
    });

    it('defaults to open tasks sorted by priority across all stores', async () => {
      const out = parse(await t.listTasks({}));
      expect(out.tasks.map((x: { text: string }) => x.text)).toEqual(['open none', 'open red']);
      expect(out.total).toBe(2);
      expect(out.store_errors).toBeUndefined();
    });

    it('filters by colours with none and OR semantics', async () => {
      const out = parse(await t.listTasks({ colors: ['red', 'none'] }));
      expect(out.total).toBe(2);
      expect(parse(await t.listTasks({ colors: ['none'] })).tasks).toHaveLength(1);
    });

    it('rejects invalid colour filter values', async () => {
      const r = await t.listTasks({ colors: ['mauve'] });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain('none');
    });

    it('restricts to a store and rejects unknown ones', async () => {
      expect(parse(await t.listTasks({ store_id: 'b' })).total).toBe(1);
      const r = await t.listTasks({ store_id: 'zzz' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain('a, b');
    });

    it('paginates', async () => {
      const out = parse(await t.listTasks({ status: 'all', limit: 1, offset: 1 }));
      expect(out.count).toBe(1);
      expect(out.total).toBe(3);
      expect(out.offset).toBe(1);
    });

    it('reports store_errors for an unreadable store', async () => {
      await writeFile(taskFilePath(b), '{ not json', 'utf-8');
      const out = parse(await t.listTasks({}));
      expect(out.store_errors).toHaveLength(1);
      expect(out.store_errors[0].store_id).toBe('b');
      expect(out.total).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await seed(a, [
        raw({ text: 'alpha beta', priority: 1 }),
        raw({ text: 'alpha', priority: 2 }),
        raw({ text: 'alpha done', completed: true, completed_at: '2026-02-01T00:00:00Z' }),
      ]);
    });

    it('ranks by matched terms, OR semantics, open by default', async () => {
      const out = parse(await t.searchTasks({ query: 'alpha beta' }));
      expect(out.tasks.map((x: { text: string }) => x.text)).toEqual(['alpha beta', 'alpha']);
    });

    it('status all includes completed', async () => {
      expect(parse(await t.searchTasks({ query: 'alpha', status: 'all' })).total).toBe(3);
    });

    it('rejects an unknown store', async () => {
      expect((await t.searchTasks({ query: 'x', store_id: 'q' })).isError).toBe(true);
    });
  });

  describe('update', () => {
    it('round-trips completion_source and priority', async () => {
      const task = parse(await t.addTask({ text: 'T' }));
      expect(task.completion_source ?? null).toBeNull();

      const done = parse(
        await t.updateTask({ id: task.id, completed: true, completion_source: 'plan-x', priority: 42 }),
      );
      expect(done.completed).toBe(true);
      expect(done.completion_source).toBe('plan-x');
      expect(done.priority).toBe(42);
      expect(done.completed_at).toBeTruthy();

      const reopened = parse(await t.updateTask({ id: task.id, completed: false }));
      expect(reopened.completed).toBe(false);
      expect(reopened.completion_source ?? null).toBeNull();
    });

    it('rejects completion_source on a task that stays open', async () => {
      const task = parse(await t.addTask({ text: 'T' }));
      const r = await t.updateTask({ id: task.id, completion_source: 'x' });
      expect(r.isError).toBe(true);
    });

    it('sets and clears colour; rejects invalid ones', async () => {
      const task = parse(await t.addTask({ text: 'T' }));
      expect(parse(await t.updateTask({ id: task.id, color: 'blue' })).color).toBe('blue');
      expect(parse(await t.updateTask({ id: task.id, color: '' })).color).toBe('');
      const r = await t.updateTask({ id: task.id, color: 'nope' });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain('teal');
    });

    it('errors on a missing task', async () => {
      expect((await t.updateTask({ id: randomUUID(), text: 'x' })).isError).toBe(true);
    });
  });

  describe('delete', () => {
    it('deletes and then reports not found', async () => {
      const task = parse(await t.addTask({ text: 'T' }));
      expect(parse(await t.deleteTask({ id: task.id }))).toEqual({ id: task.id, deleted: true });
      expect((await t.deleteTask({ id: task.id })).isError).toBe(true);
    });
  });
});
