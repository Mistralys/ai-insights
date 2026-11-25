/**
 * Unit tests for views/tasks-model.js (TasksModel): filtering, palette helpers,
 * paging, reorder maths, palette navigation and placement.
 */
import { describe, it, expect } from 'vitest';
import { loadTasksModel } from './tasks-model-loader.js';

const M = loadTasksModel();

function t(n: number, p: Record<string, unknown> = {}): any {
  return {
    id: `id-${n}`, text: `Task ${n}`, tags: [], priority: 100 - n, completed: false,
    created_at: '2026-01-01T00:00:00Z', completed_at: null, color: '',
    store_id: 'a', ticket_label: '', ...p,
  };
}

const state = (over: Record<string, unknown> = {}, filter: Record<string, unknown> = {}): any => ({
  filter: { status: 'all', store: '', tags: [], colors: [], q: '', ...filter },
  sort: 'priority', leaving: {}, ...over,
});

describe('visibleTasks', () => {
  const tasks = [
    t(1, { text: 'Fix the login bug', tags: ['bug'], ticket_label: 'ABC-12', color: 'red' }),
    t(2, { text: 'Write docs', tags: ['docs', 'bug'], completed: true, completed_at: '2026-02-01T00:00:00Z' }),
    t(3, { text: 'Refactor login', store_id: 'b', color: 'weird' }),
  ];
  const ids = (s: any) => M.visibleTasks(tasks, s).map((x: any) => x.id);

  it('filters by status, store and tags (AND)', () => {
    expect(ids(state({}, { status: 'open' }))).toEqual(['id-1', 'id-3']);
    expect(ids(state({}, { status: 'completed' }))).toEqual(['id-2']);
    expect(ids(state({}, { store: 'b' }))).toEqual(['id-3']);
    expect(ids(state({}, { tags: ['bug', 'docs'] }))).toEqual(['id-2']);
  });

  it('filters colours as OR over colorKey with none for no or unknown colour', () => {
    expect(ids(state({}, { colors: ['red'] }))).toEqual(['id-1']);
    expect(ids(state({}, { colors: ['none'] }))).toEqual(['id-2', 'id-3']);
    expect(ids(state({}, { colors: ['red', 'none'] }))).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('searches with AND over text, ticket label and tags', () => {
    expect(ids(state({}, { q: 'login' }))).toEqual(['id-1', 'id-3']);
    expect(ids(state({}, { q: 'LOGIN abc-12' }))).toEqual(['id-1']);
    expect(ids(state({}, { q: 'docs bug' }))).toEqual(['id-2']);
    expect(ids(state({}, { q: 'login docs' }))).toEqual([]);
  });

  it('keeps leaving tasks visible despite the status filter', () => {
    expect(ids(state({ leaving: { 'id-2': true } }, { status: 'open' }))).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('does not mutate its input', () => {
    const copy = tasks.slice();
    M.visibleTasks(tasks, state({ sort: 'created' }));
    expect(tasks).toEqual(copy);
  });
});

describe('palette helpers', () => {
  it('PALETTE has 16 ordered { id, name } entries', () => {
    expect(M.PALETTE).toHaveLength(16);
    expect(M.PALETTE[0]).toEqual({ id: 'red', name: 'Red' });
    expect(M.PALETTE[15]).toEqual({ id: 'gray', name: 'Gray' });
  });

  it('colorById returns null for empty and unknown ids', () => {
    expect(M.colorById('blue').name).toBe('Blue');
    expect(M.colorById('')).toBeNull();
    expect(M.colorById('nope')).toBeNull();
  });

  it('toggleColor adds and removes without mutating', () => {
    const sel = ['red'];
    const added = M.toggleColor(sel, 'none');
    expect(added).toEqual(['red', 'none']);
    expect(sel).toEqual(['red']);
    expect(M.toggleColor(added, 'red')).toEqual(['none']);
    expect(added).toEqual(['red', 'none']);
  });
});

describe('paletteMove', () => {
  const N = 17; // 16 swatches + "No colour"
  it('moves left and right, clamped at the ends', () => {
    expect(M.paletteMove(0, 'ArrowLeft', N)).toBe(0);
    expect(M.paletteMove(5, 'ArrowRight', N)).toBe(6);
    expect(M.paletteMove(16, 'ArrowRight', N)).toBe(16);
    expect(M.paletteMove(7, 'ArrowRight', N)).toBe(8); // row boundary
    expect(M.paletteMove(8, 'ArrowLeft', N)).toBe(7);
  });

  it('moves down and up by a row, into and out of the footer', () => {
    expect(M.paletteMove(0, 'ArrowDown', N)).toBe(8);
    expect(M.paletteMove(7, 'ArrowDown', N)).toBe(15);
    expect(M.paletteMove(8, 'ArrowDown', N)).toBe(16);
    expect(M.paletteMove(15, 'ArrowDown', N)).toBe(16);
    expect(M.paletteMove(16, 'ArrowDown', N)).toBe(16);
    expect(M.paletteMove(16, 'ArrowUp', N)).toBe(8);
    expect(M.paletteMove(17, 'ArrowUp', 18)).toBe(8);
    expect(M.paletteMove(9, 'ArrowUp', N)).toBe(1);
    expect(M.paletteMove(3, 'ArrowUp', N)).toBe(3);
  });

  it('handles Home, End, footer buttons in filter mode and unknown keys', () => {
    expect(M.paletteMove(9, 'Home', N)).toBe(0);
    expect(M.paletteMove(9, 'End', N)).toBe(16);
    expect(M.paletteMove(9, 'End', 18)).toBe(17);
    expect(M.paletteMove(16, 'ArrowRight', 18)).toBe(17);
    expect(M.paletteMove(17, 'ArrowLeft', 18)).toBe(16);
    expect(M.paletteMove(17, 'ArrowDown', 18)).toBe(17);
    expect(M.paletteMove(4, 'x', N)).toBe(4);
  });

  it('clamps a row move to the last item when the footer is absent', () => {
    expect(M.paletteMove(12, 'ArrowDown', 16)).toBe(15);
  });
});

describe('palettePosition', () => {
  const size = { width: 200, height: 150 };
  const vp = { width: 1024, height: 768 };

  it('places below the anchor by default', () => {
    const p = M.palettePosition({ left: 100, top: 100, bottom: 120 }, size, vp);
    expect(p).toEqual({ left: 90, top: 126, flipped: false });
  });

  it('flips above near the viewport bottom when there is room', () => {
    const p = M.palettePosition({ left: 100, top: 650, bottom: 670 }, size, vp);
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(650 - 150 - 6);
  });

  it('does not flip when there is no room above', () => {
    const p = M.palettePosition({ left: 100, top: 40, bottom: 60 }, size, { width: 1024, height: 180 });
    expect(p.flipped).toBe(false);
    expect(p.top).toBe(66);
  });

  it('clamps at the right edge at 375 px and at the left edge', () => {
    expect(M.palettePosition({ left: 350, top: 100, bottom: 120 }, size, { width: 375, height: 667 }).left).toBe(375 - 200 - 8);
    expect(M.palettePosition({ left: 0, top: 100, bottom: 120 }, size, vp).left).toBe(8);
  });
});

describe('paging and placement', () => {
  const list = Array.from({ length: 25 }, (_, i) => t(i));

  it('pageOf returns the slice and clamps the page', () => {
    const p2 = M.pageOf(list, 2, 10);
    expect(p2.items.map((x: any) => x.id)).toEqual(list.slice(10, 20).map((x) => x.id));
    expect(p2).toMatchObject({ page: 2, pages: 3, start: 10, total: 25 });
    expect(M.pageOf(list, 99, 10).page).toBe(3);
    expect(M.pageOf(list, 99, 10).items).toHaveLength(5);
    expect(M.pageOf(list, 0, 10).page).toBe(1);
    expect(M.pageOf([], 4, 10)).toMatchObject({ items: [], page: 1, pages: 1 });
  });

  it('placementOf returns the page or hidden', () => {
    expect(M.placementOf(list, 'id-0', 10)).toEqual({ page: 1 });
    expect(M.placementOf(list, 'id-10', 10)).toEqual({ page: 2 });
    expect(M.placementOf(list, 'id-24', 10)).toEqual({ page: 3 });
    expect(M.placementOf(list, 'gone', 10)).toEqual({ hidden: true });
  });
});

describe('reordering', () => {
  const list = [t(1, { priority: 9 }), t(2, { priority: 7 }), t(3, { priority: 7 }), t(4, { priority: 2 })];

  it('swaps priorities with the neighbour in both directions', () => {
    const down = M.swapWithNeighbour(list, 'id-1', 1);
    expect(down).toEqual({
      assignments: [{ id: 'id-1', priority: 7 }, { id: 'id-2', priority: 9 }],
      targetIndex: 1,
    });
    const up = M.swapWithNeighbour(list, 'id-4', -1);
    expect(up.assignments).toEqual([{ id: 'id-4', priority: 7 }, { id: 'id-3', priority: 2 }]);
    expect(up.targetIndex).toBe(2);
  });

  it('returns null at list edges and for unknown ids', () => {
    expect(M.swapWithNeighbour(list, 'id-1', -1)).toBeNull();
    expect(M.swapWithNeighbour(list, 'id-4', 1)).toBeNull();
    expect(M.swapWithNeighbour(list, 'gone', 1)).toBeNull();
  });

  it('breaks ties so the moved task ends up on the requested side', () => {
    const up = M.swapWithNeighbour(list, 'id-3', -1);
    const pri = Object.fromEntries(up.assignments.map((a: any) => [a.id, a.priority]));
    expect(pri['id-3']).toBeGreaterThan(pri['id-2']);
    const down = M.swapWithNeighbour(list, 'id-2', 1);
    const pri2 = Object.fromEntries(down.assignments.map((a: any) => [a.id, a.priority]));
    expect(pri2['id-3']).toBeGreaterThan(pri2['id-2']);
  });

  it('works under a filter (neighbour is the filtered neighbour)', () => {
    const filtered = [list[0], list[3]];
    expect(M.swapWithNeighbour(filtered, 'id-1', 1).assignments)
      .toEqual([{ id: 'id-1', priority: 2 }, { id: 'id-4', priority: 9 }]);
  });

  it('reassignSubset preserves the multiset of priorities', () => {
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    const out = M.reassignSubset(['id-4', 'id-2', 'id-1', 'id-3'], byId);
    expect(out.map((a: any) => a.id)).toEqual(['id-4', 'id-2', 'id-1', 'id-3']);
    expect(out.map((a: any) => a.priority)).toEqual([9, 7, 7, 2]);
    expect(out.map((a: any) => a.priority).sort()).toEqual(list.map((x) => x.priority).sort());
  });
});

describe('text and tag helpers', () => {
  it('allTags returns sorted unique tags', () => {
    expect(M.allTags([t(1, { tags: ['b', 'a'] }), t(2, { tags: ['c', 'a'] }), t(3)])).toEqual(['a', 'b', 'c']);
    expect(M.allTags([])).toEqual([]);
  });

  it('firstLine and restLines split at the first line break', () => {
    expect(M.firstLine('one\ntwo\nthree')).toBe('one');
    expect(M.restLines('one\ntwo\nthree')).toBe('two\nthree');
    expect(M.firstLine('one\r\ntwo')).toBe('one');
    expect(M.firstLine('solo')).toBe('solo');
    expect(M.restLines('solo')).toBe('');
  });

  it('refColumnWidth clamps to 6-16 ch', () => {
    expect(M.refColumnWidth([])).toBe(6);
    expect(M.refColumnWidth([t(1, { ticket_label: '#1' })])).toBe(6);
    expect(M.refColumnWidth([t(1, { ticket_label: 'ABC-1234' }), t(2, { ticket_label: 'X-1' })])).toBe(8);
    expect(M.refColumnWidth([t(1, { ticket_label: 'VERYLONGQUEUE-123456789' })])).toBe(16);
    expect(M.refColumnWidth(['ABCDEFGHIJ'])).toBe(10);
  });
});
