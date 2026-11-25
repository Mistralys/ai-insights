/**
 * Parity between the server's matchesFilters + compareTasks and the client's
 * TasksModel.visibleTasks, over one shared fixture.
 *
 * NOTE: multi-term search differs on purpose (OR + ranking on the server,
 * AND in the GUI), so these tests always use an empty search.
 */
import { describe, it, expect } from 'vitest';
import { compareTasks, type TaskSort } from '../../src/schema/task.js';
import { matchesFilters } from '../../src/storage/task-collection.js';
import { loadTasksModel } from './tasks-model-loader.js';

const model = loadTasksModel();

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

interface Fx {
  id: string; text: string; tags: string[]; priority: number; completed: boolean;
  created_at: string; completed_at: string | null; color: string;
  store_id: string; store_label: string; ticket_label: string; reference: string | null;
}

let seq = 0;
function task(p: Partial<Fx>): Fx {
  seq += 1;
  return {
    id: id(seq), text: `Task ${seq}`, tags: [], priority: 1, completed: false,
    created_at: '2026-01-01T00:00:00Z', completed_at: null, color: '',
    store_id: 'a', store_label: 'A', ticket_label: '', reference: null, ...p,
  };
}

// Deliberately unordered, with ties on priority and created_at, and ids that
// do not sort the same way as the fixture order.
const TASKS: Fx[] = [
  task({ priority: 5, created_at: '2026-02-01T00:00:00Z', tags: ['bug', 'ui'], color: 'red' }),
  task({ priority: 5, created_at: '2026-02-01T00:00:00Z', tags: ['bug'], color: 'blue', store_id: 'b' }),
  task({ priority: 5, created_at: '2026-03-01T00:00:00Z', color: 'unknown-colour', store_id: 'b' }),
  task({ priority: 3, created_at: '2026-02-01T00:00:00Z', tags: ['ui'], color: '' }),
  task({ priority: 3, created_at: '2026-02-01T00:00:00Z', completed: true, completed_at: '2026-04-01T00:00:00Z', color: 'red' }),
  task({ priority: 3, created_at: '2026-01-15T00:00:00Z', completed: true, completed_at: '2026-04-01T00:00:00Z', store_id: 'c', tags: ['bug', 'ui', 'docs'] }),
  task({ priority: 9, created_at: '2026-01-10T00:00:00Z', completed: true, completed_at: '2026-05-01T00:00:00Z', color: 'gray', store_id: 'c' }),
  task({ priority: 1, created_at: '2026-01-10T00:00:00Z', tags: ['docs'], color: 'blue' }),
  task({ priority: 1, created_at: '2026-01-10T00:00:00Z', tags: ['docs'], color: 'blue', store_id: 'b' }),
  task({ priority: 0, created_at: '2026-06-01T00:00:00Z', completed: true, completed_at: '2026-04-01T00:00:00Z' }),
  task({ priority: 7, created_at: '2026-06-01T00:00:00Z' }),
].reverse();

interface Filter { status?: 'open' | 'completed' | 'all'; store?: string; tags?: string[]; colors?: string[] }

function server(filter: Filter, sort: TaskSort): string[] {
  return TASKS
    .filter((t) => matchesFilters(t as never, {
      status: filter.status, store: filter.store, tags: filter.tags, colors: filter.colors,
    } as never))
    .sort(compareTasks(sort))
    .map((t) => t.id);
}

function client(filter: Filter, sort: TaskSort): string[] {
  return model.visibleTasks(TASKS, {
    filter: { status: 'all', store: '', tags: [], colors: [], q: '', ...filter },
    sort,
    leaving: {},
  }).map((t: Fx) => t.id);
}

const FILTERS: Array<[string, Filter]> = [
  ['none', {}],
  ['status open', { status: 'open' }],
  ['status completed', { status: 'completed' }],
  ['store', { store: 'b' }],
  ['one tag', { tags: ['bug'] }],
  ['two tags (AND)', { tags: ['bug', 'ui'] }],
  ['unmatched tag', { tags: ['nope'] }],
  ['colour', { colors: ['red'] }],
  ['colour none', { colors: ['none'] }],
  ['colours OR', { colors: ['red', 'blue', 'none'] }],
  ['combined', { status: 'open', store: 'b', tags: ['bug'], colors: ['blue', 'none'] }],
  ['combined 2', { status: 'completed', tags: ['ui'], colors: ['red', 'gray', 'none'] }],
];

describe('TasksModel.visibleTasks parity with matchesFilters + compareTasks', () => {
  for (const sort of ['priority', 'created', 'completed'] as TaskSort[]) {
    for (const [label, filter] of FILTERS) {
      it(`sort=${sort}, filter=${label}`, () => {
        expect(client(filter, sort)).toEqual(server(filter, sort));
      });
    }
  }

  it('the fixture has the ties and colour kinds the parity relies on', () => {
    expect(new Set(TASKS.map((t) => `${t.priority}|${t.created_at}`)).size).toBeLessThan(TASKS.length);
    expect(TASKS.some((t) => t.color === 'unknown-colour')).toBe(true);
    expect(TASKS.some((t) => t.color === '')).toBe(true);
  });
});
