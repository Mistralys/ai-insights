// @vitest-environment jsdom

/**
 * Tests for gui/public/views/tasks.js (WP-012, core behaviour).
 * Loads the real utils.js, safe-markdown.js, tasks-model.js, tasks-render.js
 * and tasks.js; `API` is a stub.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const read = (p: string) => readFileSync(join(publicDir, p), 'utf-8');

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

beforeAll(() => {
  vm.runInThisContext(read('libs/marked.min.js'));
  vm.runInThisContext(read('safe-markdown.js'));
  vm.runInThisContext(read('views/tasks-model.js'));
  vm.runInThisContext(read('views/tasks-render.js'));
  vm.runInThisContext(read('views/tasks.js'));
});

let seq = 0;
function task(over: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    text: `Task ${seq}`,
    tags: [] as string[],
    priority: 100 - seq,
    completed: false,
    created_at: `2026-11-01T10:00:${String(seq % 60).padStart(2, '0')}Z`,
    completed_at: null,
    completion_source: null,
    color: '',
    store_id: 's1',
    store_label: 'Store One',
    reference: null,
    ticket_label: '',
    ticket_url: null,
    ...over,
  };
}

function payload(tasks: unknown[], over: Record<string, unknown> = {}) {
  return {
    tasks,
    stores: [{ id: 's1', label: 'Store One', is_default: true }],
    settings: { ticket_base_url: '', ticket_queue: '', page_size: 20 },
    store_errors: [],
    ...over,
  };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const rows = () => Array.from(document.querySelectorAll('#task-list .task')) as HTMLElement[];

async function mount(data: unknown) {
  g.API.getTasks = vi.fn().mockResolvedValue(data);
  g.renderTasks($('#app'));
  await flush();
}

function key(target: Element, k: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  seq = 0;
  document.body.innerHTML = '<div id="app"></div>';
  g.tasksRemoveGlobalHandlers();
  g.tasksPersist.filter = { q: '', status: 'open', store: '', tags: [], colors: [] };
  g.tasksPersist.sort = 'priority';
  g.tasksPersist.page = 1;
  g.tasksPersist.pageSize = 0;
  g.API = {
    getTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    reorderTasks: vi.fn(),
  };
});

afterEach(() => {
  g.tasksRemoveGlobalHandlers();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('tasks.js rendering', () => {
  it('renders open tasks in priority order with the filter bar and seeds the page size', async () => {
    const done = task({ completed: true, completed_at: '2026-11-02T10:00:00Z' });
    await mount(payload([task(), task(), done], { settings: { ticket_base_url: '', ticket_queue: '', page_size: 50 } }));
    expect(rows()).toHaveLength(2);
    expect($('#f-status') as HTMLSelectElement).toBeTruthy();
    expect(($('#f-status') as HTMLSelectElement).value).toBe('open');
    expect(($('#page-size') as HTMLSelectElement).value).toBe('50');
    expect($('#counts').textContent).toContain('2 open');
  });

  it('shows an error banner when loading fails', async () => {
    g.API.getTasks = vi.fn().mockRejectedValue({ code: 'X', message: 'boom' });
    g.renderTasks($('#app'));
    await flush();
    expect($('#app').textContent).toContain('boom');
  });

  it('renders store_errors as a warning banner naming the stores', async () => {
    await mount(payload([task()], { store_errors: [{ store_id: 'x', store_label: 'Broken Store', message: 'unreadable' }] }));
    expect($('.tasks-store-errors').textContent).toContain('Broken Store');
  });

  it('sets --task-ref-width from the longest reference, clamped to 6-16 ch', async () => {
    await mount(payload([task({ ticket_label: 'PROJ-12345678901234567890', reference: 'x' })]));
    expect($('#tasks-root').style.getPropertyValue('--task-ref-width')).toBe('16ch');
  });

  it('filters by multi-term AND search and resets to page 1', async () => {
    await mount(payload([task({ text: 'alpha beta' }), task({ text: 'alpha gamma' })]));
    const input = $('#f-search') as HTMLInputElement;
    input.value = 'alpha gamma';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toHaveLength(1);
    expect(g.tasksPersist.filter.q).toBe('alpha gamma');
  });

  it('paginates with the page-size selector and keeps the page across a re-render', async () => {
    const many = Array.from({ length: 25 }, () => task());
    await mount(payload(many));
    expect(rows()).toHaveLength(20);
    ($('[data-page="2"]') as HTMLElement).click();
    expect(rows()).toHaveLength(5);
    await mount(payload(many));
    expect(g.tasksPersist.page).toBe(2);
    expect(rows()).toHaveLength(5);
  });

  it('only the active row and its controls are tabbable', async () => {
    await mount(payload([task(), task()]));
    const [a, b] = rows();
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(-1);
    expect((b.querySelector('[data-rc]') as HTMLElement).tabIndex).toBe(-1);
    expect((a.querySelector('[data-rc]') as HTMLElement).tabIndex).toBe(0);
  });
});

describe('tasks.js keyboard', () => {
  it('ArrowDown and ArrowUp move between rows', async () => {
    await mount(payload([task(), task()]));
    const [a, b] = rows();
    a.focus();
    key(a, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    key(b, 'ArrowUp');
    expect(document.activeElement).toBe(a);
  });

  it('ArrowDown on the last row crosses to the next page', async () => {
    await mount(payload(Array.from({ length: 21 }, () => task())));
    const last = rows()[19];
    last.focus();
    key(last, 'ArrowDown');
    expect(g.tasksPersist.page).toBe(2);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('"/" focuses search and "?" toggles help', async () => {
    await mount(payload([task()]));
    rows()[0].focus();
    key(rows()[0], '/');
    expect(document.activeElement).toBe($('#f-search'));
    (document.activeElement as HTMLElement).blur();
    rows()[0].focus();
    key(rows()[0], '?');
    expect(($('#help-panel') as HTMLElement).hidden).toBe(false);
    key(rows()[0], '?');
    expect(($('#help-panel') as HTMLElement).hidden).toBe(true);
  });
});

describe('tasks.js inline editing', () => {
  it('opens the raw Markdown, saves on Enter and keeps Shift+Enter for line breaks', async () => {
    const t = task({ text: '**Bold** title' });
    await mount(payload([t]));
    g.API.updateTask.mockResolvedValue({ ...t, text: 'New title' });
    ($('.task-text') as HTMLElement).click();
    const ta = $('[data-role="text-input"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('**Bold** title');
    ta.value = 'New title';
    key(ta, 'Enter', { shiftKey: true });
    expect(g.API.updateTask).not.toHaveBeenCalled();
    key(ta, 'Enter');
    await flush();
    expect(g.API.updateTask).toHaveBeenCalledWith(t.id, { text: 'New title' });
    expect($('.task-text').textContent).toBe('New title');
  });

  it('Escape cancels without saving', async () => {
    await mount(payload([task({ text: 'Keep' })]));
    ($('.task-text') as HTMLElement).click();
    const ta = $('[data-role="text-input"]') as HTMLTextAreaElement;
    ta.value = 'Changed';
    key(ta, 'Escape');
    expect(g.API.updateTask).not.toHaveBeenCalled();
    expect($('.task-text').textContent).toBe('Keep');
  });

  it('shows the server message with aria-invalid for an invalid reference and keeps the input', async () => {
    const t = task();
    await mount(payload([t]));
    g.API.updateTask.mockRejectedValue({ code: 'VALIDATION', message: 'Bad reference' });
    key(rows()[0], 'r');
    const input = $('[data-role="ref-input"]') as HTMLInputElement;
    input.value = '??';
    key(input, 'Enter');
    await flush();
    const after = $('[data-role="ref-input"]');
    expect(after).toBeTruthy();
    expect(after.getAttribute('aria-invalid')).toBe('true');
    expect($('#status').textContent).toContain('Bad reference');
    expect(document.activeElement).toBe(after);
  });

  it('renders a linked reference as a new-tab link', async () => {
    await mount(payload([task({ reference: '12', ticket_label: 'PROJ-12', ticket_url: 'https://t.example/PROJ-12' })]));
    const a = $('.task-ref a') as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    expect(a.textContent).toBe('PROJ-12');
  });
});

describe('tasks.js create flow', () => {
  it('skips the store menu with one store and refuses empty text', async () => {
    await mount(payload([task()]));
    ($('[data-create="top"]') as HTMLElement).click();
    expect($('.store-menu')).toBeNull();
    expect($('[data-draft="text"]')).toBeTruthy();
    key($('[data-draft="text"]'), 'Enter');
    expect(g.API.createTask).not.toHaveBeenCalled();
    expect($('[data-draft="text"]').getAttribute('aria-invalid')).toBe('true');
  });

  it('opens a store menu with several stores and the draft next to the bottom button', async () => {
    await mount(payload([task()], { stores: [{ id: 's1', label: 'One', is_default: true }, { id: 's2', label: 'Two', is_default: false }] }));
    ($('[data-create="bottom"]') as HTMLElement).click();
    expect($('.store-menu')).toBeTruthy();
    ($('[data-store="s2"]') as HTMLElement).click();
    expect($('#draft-bottom .task-draft')).toBeTruthy();
    expect($('#draft-top .task-draft')).toBeNull();
  });

  it('adds the task and reports where it landed', async () => {
    const existing = task();
    await mount(payload([existing]));
    const created = task({ text: 'Fresh', priority: 999 });
    g.API.createTask.mockResolvedValue(created);
    ($('[data-create="top"]') as HTMLElement).click();
    const ta = $('[data-draft="text"]') as HTMLTextAreaElement;
    ta.value = 'Fresh';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    key(ta, 'Enter');
    await flush();
    expect(g.API.createTask).toHaveBeenCalledWith({ store_id: 's1', text: 'Fresh' });
    expect($('#status').textContent).toBe('Task added to Store One.');
    expect(rows()[0].getAttribute('data-id')).toBe(created.id);
  });

  it('reports a task hidden by the current filters', async () => {
    await mount(payload([task()]));
    g.API.createTask.mockResolvedValue(task({ text: 'Done already', completed: true }));
    ($('[data-create="top"]') as HTMLElement).click();
    const ta = $('[data-draft="text"]') as HTMLTextAreaElement;
    ta.value = 'x';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    key(ta, 'Enter');
    await flush();
    expect($('#status').textContent).toContain('hidden by the current filters');
  });
});

describe('tasks.js delete', () => {
  it('arms on the first activation, deletes on the second', async () => {
    const t = task();
    await mount(payload([t, task()]));
    g.API.deleteTask.mockResolvedValue({ id: t.id, deleted: true });
    ($('[data-act="delete"]') as HTMLElement).click();
    expect($('.task-delete.is-armed').textContent).toBe('Confirm');
    ($('.task-delete.is-armed') as HTMLElement).click();
    await flush();
    expect(g.API.deleteTask).toHaveBeenCalledWith(t.id);
    expect(rows()).toHaveLength(1);
  });

  it('reverts after about 3 s', async () => {
    await mount(payload([task()]));
    vi.useFakeTimers();
    ($('[data-act="delete"]') as HTMLElement).click();
    expect($('.task-delete.is-armed')).toBeTruthy();
    vi.advanceTimersByTime(3100);
    expect($('.task-delete.is-armed')).toBeNull();
  });

  it('Del arms, Esc disarms', async () => {
    await mount(payload([task()]));
    const row = rows()[0];
    row.focus();
    key(row, 'Delete');
    expect($('.task-delete.is-armed')).toBeTruthy();
    key(document.activeElement as Element, 'Escape');
    expect($('.task-delete.is-armed')).toBeNull();
    expect(g.API.deleteTask).not.toHaveBeenCalled();
  });
});

describe('tasks.js completion and tags', () => {
  it('Space completes; the row stays struck through for 700 ms and then leaves', async () => {
    const a = task();
    const b = task();
    await mount(payload([a, b]));
    g.API.updateTask.mockResolvedValue({ ...a, completed: true, completed_at: '2026-11-03T10:00:00Z' });
    const row = rows()[0];
    row.focus();
    key(row, ' ');
    vi.useFakeTimers();
    await flush();
    expect(rows()).toHaveLength(2);
    expect(rows()[0].classList.contains('is-completed')).toBe(true);
    expect(rows()[0].classList.contains('is-leaving')).toBe(true);
    vi.advanceTimersByTime(750);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute('data-id')).toBe(b.id);
  });

  it('adds a tag as a chip and a badge click adds it to the tag filter', async () => {
    const t = task({ tags: ['gui'] });
    await mount(payload([t]));
    g.API.updateTask.mockResolvedValue({ ...t, tags: ['gui', 'ops'] });
    key(rows()[0], 't');
    const input = $('[data-role="tag-input"]') as HTMLInputElement;
    input.value = 'Ops';
    key(input, 'Enter');
    await flush();
    expect(g.API.updateTask).toHaveBeenCalledWith(t.id, { tags: ['gui', 'ops'] });
    ($('[data-act="filter-tag"][data-tag="ops"]') as HTMLElement).click();
    expect(g.tasksPersist.filter.tags).toEqual(['ops']);
    expect($('#active-filters').textContent).toContain('ops');
  });
});

describe('tasks.js live refresh and listener lifecycle', () => {
  it('re-fetches on visibilitychange unless an edit is active', async () => {
    const t = task();
    await mount(payload([t]));
    const calls = () => g.API.getTasks.mock.calls.length;
    g.API.getTasks.mockResolvedValue(payload([t, task({ text: 'Added elsewhere' })]));
    const before = calls();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(calls()).toBe(before + 1);
    expect(rows()).toHaveLength(2);

    ($('.task-text') as HTMLElement).click();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls()).toBe(before + 1);
  });

  it('leaves one document keydown and one window resize listener after two renders', async () => {
    const addDoc = vi.spyOn(document, 'addEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const addWin = vi.spyOn(window, 'addEventListener');
    const removeWin = vi.spyOn(window, 'removeEventListener');
    await mount(payload([task()]));
    await mount(payload([task()]));
    const live = (adds: any, removes: any, type: string) =>
      adds.mock.calls.filter((c: any[]) => c[0] === type).length - removes.mock.calls.filter((c: any[]) => c[0] === type).length;
    expect(live(addDoc, removeDoc, 'keydown')).toBe(1);
    expect(live(addWin, removeWin, 'resize')).toBe(1);
    addDoc.mockRestore(); removeDoc.mockRestore(); addWin.mockRestore(); removeWin.mockRestore();
  });

  it('handlers remove themselves when #tasks-root is gone', async () => {
    await mount(payload([task()]));
    expect(g.tasksKeydownHandler).not.toBeNull();
    $('#app').innerHTML = '<p>other view</p>';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(g.tasksKeydownHandler).toBeNull();
    expect(g.tasksVisibilityHandler).toBeNull();
    expect(g.tasksResizeHandler).toBeNull();
  });
});

describe('tasks view wiring', () => {
  it('loads the three scripts in order before app.js, each with ?v=1, and adds the nav link and route', () => {
    const html = read('index.html');
    const order = ['/views/tasks-model.js?v=1', '/views/tasks-render.js?v=1', '/views/tasks.js?v=1', '/app.js'].map((s) => html.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html.indexOf('<a href="#/tasks">Tasks</a>')).toBeGreaterThan(html.indexOf('#/knowledge'));
    expect(read('router.js')).toMatch(/path === '\/tasks'[\s\S]*renderTasks\(app\)/);
  });
});

describe('tasks view reordering (WP-013)', () => {
  const dnd = (type: string, target: Element, init: Record<string, unknown> = {}) => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
    ev.clientY = init.clientY ?? 0;
    ev.dataTransfer = { setData() {}, effectAllowed: '' };
    target.dispatchEvent(ev);
    return ev;
  };
  const press = (li: Element) => li.querySelector('[data-role="handle"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  it('shows the handle only in priority sort', async () => {
    await mount(payload([task(), task()]));
    expect(document.querySelectorAll('#task-list [data-role="handle"]')).toHaveLength(2);
    g.tasksPersist.sort = 'created';
    g.renderTasks($('#app'));
    await flush();
    expect(document.querySelectorAll('#task-list [data-role="handle"]')).toHaveLength(0);
  });

  it('drags only from the handle and sends reassignSubset assignments on drop', async () => {
    const a = task({ priority: 30 }); const b = task({ priority: 20 }); const c = task({ priority: 10 });
    await mount(payload([a, b, c]));
    g.API.reorderTasks.mockResolvedValue({ updated: [], failed: [] });
    const [r1, , r3] = rows();
    expect(dnd('dragstart', r1).defaultPrevented).toBe(true);   /* no handle press: refused */
    press(r1);
    expect(r1.getAttribute('draggable')).toBe('true');
    dnd('dragstart', r1);
    r3.getBoundingClientRect = () => ({ top: 0, height: 10 }) as DOMRect;
    dnd('drop', r3, { clientY: 9 });                              /* after the last row */
    expect(g.API.reorderTasks).toHaveBeenCalledWith([
      { id: b.id, priority: 30 }, { id: c.id, priority: 20 }, { id: a.id, priority: 10 },
    ]);
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([b.id, c.id, a.id]);
  });

  it('Alt+ArrowDown on the last row of a page crosses the boundary and the page follows', async () => {
    const ts = [task({ priority: 30 }), task({ priority: 20 }), task({ priority: 10 })];
    await mount(payload(ts, { settings: { ticket_base_url: '', ticket_queue: '', page_size: 2 } }));
    g.API.reorderTasks.mockResolvedValue({ updated: [], failed: [] });
    key(rows()[1], 'ArrowDown', { altKey: true });
    expect(g.API.reorderTasks).toHaveBeenCalledWith([
      { id: ts[1].id, priority: 10 }, { id: ts[2].id, priority: 20 },
    ]);
    expect(g.tasksPersist.page).toBe(2);
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([ts[1].id]);
  });

  it('Alt+Arrow in a non-priority sort announces and sends nothing', async () => {
    g.tasksPersist.sort = 'created';
    await mount(payload([task(), task()]));
    key(rows()[0], 'ArrowDown', { altKey: true });
    expect(g.API.reorderTasks).not.toHaveBeenCalled();
    expect($('#status').textContent).toMatch(/priority/i);
  });

  it('reloads from the server when the request fails or returns failed[]', async () => {
    const ts = [task({ priority: 30 }), task({ priority: 20 })];
    await mount(payload(ts));
    g.API.reorderTasks.mockRejectedValue({ message: 'nope' });
    key(rows()[0], 'ArrowDown', { altKey: true });
    expect(rows()[0].getAttribute('data-id')).toBe(ts[1].id);   /* optimistic */
    await flush();
    expect(g.API.getTasks).toHaveBeenCalledTimes(2);

    g.API.getTasks.mockClear();
    g.API.reorderTasks.mockResolvedValue({ updated: [], failed: [{ store_id: 's1', ids: [], message: 'x' }] });
    key(rows()[0], 'ArrowDown', { altKey: true });
    await flush();
    expect(g.API.getTasks).toHaveBeenCalledTimes(1);
  });
});

describe('tasks view colour palette (WP-014)', () => {
  const dot = (li: Element) => li.querySelector('[data-act="color"]') as HTMLElement;
  const pal = () => document.getElementById('palette');
  const swatch = (color: string) => pal()!.querySelector(`[data-pal][data-color="${color}"]`) as HTMLElement;
  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  it('opens from the dot click and from c, with 16 swatches plus No colour, and a second click closes it', async () => {
    await mount(payload([task(), task()]));
    click(dot(rows()[0]));
    expect(pal()).toBeTruthy();
    expect(pal()!.querySelectorAll('.swatch')).toHaveLength(16);
    expect(pal()!.querySelector('.palette-none')!.textContent).toBe('No colour');
    expect(document.querySelectorAll('#palette')).toHaveLength(1);
    expect(dot(rows()[0]).getAttribute('aria-expanded')).toBe('true');
    click(dot(rows()[0]));
    expect(pal()).toBeNull();
    expect(document.activeElement).toBe(dot(rows()[0]));
    key(rows()[1], 'c');
    expect(pal()).toBeTruthy();
  });

  it('navigates with arrows, closes on Esc and Tab with focus returned to the dot, and keeps keys from the row', async () => {
    await mount(payload([task({ color: 'red' }), task()]));
    const li = rows()[0];
    key(li, 'c');
    const first = pal()!.querySelector('.swatch') as HTMLElement;
    expect(document.activeElement).toBe(first);
    const spy = vi.fn();
    document.addEventListener('keydown', spy);
    key(first, 'ArrowDown');
    expect(document.activeElement).toBe(pal()!.querySelectorAll('.swatch')[8]);
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(pal()!.querySelector('.palette-none'));
    key(document.activeElement!, 'c');
    expect(spy).not.toHaveBeenCalled();
    key(document.activeElement!, 'Escape');
    expect(pal()).toBeNull();
    expect(document.activeElement).toBe(dot(li));
    key(li, 'c');
    key(document.activeElement!, 'Tab');
    expect(pal()).toBeNull();
    expect(document.activeElement).toBe(dot(li));
    document.removeEventListener('keydown', spy);
  });

  it('sets a colour optimistically, announces, closes and returns focus to the dot', async () => {
    const t = task();
    await mount(payload([t]));
    g.API.updateTask.mockResolvedValue({ ...t, color: 'red' });
    click(dot(rows()[0]));
    click(swatch('red'));
    expect(g.API.updateTask).toHaveBeenCalledWith(t.id, { color: 'red' });
    expect(pal()).toBeNull();
    expect(dot(rows()[0]).querySelector('.dot')!.classList.contains('tc-red')).toBe(true);
    expect(document.activeElement).toBe(dot(rows()[0]));
    expect($('#status').textContent).toBe('Colour set to Red');
    await flush();
    click(dot(rows()[0]));
    g.API.updateTask.mockResolvedValue({ ...t, color: '' });
    click(swatch(''));
    expect(g.API.updateTask).toHaveBeenLastCalledWith(t.id, { color: '' });
    expect($('#status').textContent).toBe('Colour removed');
  });

  it('reverts the dot and announces the error when the request fails', async () => {
    const t = task({ color: 'blue' });
    await mount(payload([t]));
    g.API.updateTask.mockRejectedValue({ message: 'disk full' });
    click(dot(rows()[0]));
    click(swatch('green'));
    expect(dot(rows()[0]).querySelector('.dot')!.classList.contains('tc-green')).toBe(true);
    await flush();
    expect(dot(rows()[0]).querySelector('.dot')!.classList.contains('tc-blue')).toBe(true);
    expect($('#status').textContent).toBe('disk full');
  });

  it('keeps a task that leaves the colour filter for 700 ms', async () => {
    const t = task({ color: 'red' }); const other = task({ color: 'red' });
    g.tasksPersist.filter.colors = ['red'];
    await mount(payload([t, other]));
    vi.useFakeTimers();
    g.API.updateTask.mockResolvedValue({ ...t, color: 'blue' });
    click(dot(rows()[0]));
    click(swatch('blue'));
    expect(rows()).toHaveLength(2);
    vi.advanceTimersByTime(701);
    expect(rows()).toHaveLength(1);
  });

  it('colour filter: OR of several colours plus none, stays open, Any clears, chips and live region', async () => {
    const a = task({ color: 'red' }); const b = task({ color: 'blue' }); const c = task({ color: '' }); const d = task({ color: 'green' });
    await mount(payload([a, b, c, d]));
    click($('#f-color'));
    expect(pal()!.getAttribute('aria-label')).toBe('Colour filter');
    click(swatch('red'));
    expect(pal()).toBeTruthy();
    expect(document.activeElement).toBe(swatch('red'));
    expect($('#status').textContent).toBe('1 tasks match the colour filter');
    click(swatch('none'));
    expect(rows()).toHaveLength(2);
    expect($('#f-color').textContent).not.toContain('Any');
    expect(document.querySelectorAll('#active-filters [data-remove-color]')).toHaveLength(2);
    click(pal()!.querySelector('[data-color-clear]')!);
    expect(rows()).toHaveLength(4);
    expect($('#status').textContent).toBe('Colour filter cleared');
    expect(pal()).toBeTruthy();
    click(swatch('blue'));
    click($('#active-filters [data-remove-color]'));
    expect(g.tasksPersist.filter.colors).toEqual([]);
    expect(document.activeElement).toBe($('#f-color'));
  });

  it('Clear filters resets colours and opening the filter palette closes a row palette', async () => {
    await mount(payload([task({ color: 'red' }), task()]));
    click(dot(rows()[0]));
    click($('#f-color'));
    expect(pal()!.getAttribute('aria-label')).toBe('Colour filter');
    expect(document.querySelectorAll('#palette')).toHaveLength(1);
    click(swatch('red'));
    click($('#btn-clear-filters'));
    expect(g.tasksPersist.filter.colors).toEqual([]);
    expect(pal()).toBeNull();
  });

  it('toggling in the filter palette never closes it; a detached target is ignored, an outside click closes', async () => {
    await mount(payload([task({ color: 'red' }), task()]));
    click($('#f-color'));
    click(swatch('red'));
    expect(pal()).toBeTruthy();
    /* Guard 2: the document handler ignores a target that is no longer in the DOM. */
    g.tasksClickHandler({ target: document.createElement('button') });
    expect(pal()).toBeTruthy();
    /* Guard 1: palette clicks do not reach the document. */
    const docSpy = vi.fn();
    document.addEventListener('click', docSpy);
    click(swatch('blue'));
    expect(docSpy).not.toHaveBeenCalled();
    document.removeEventListener('click', docSpy);
    click($('h1'));
    expect(pal()).toBeNull();
  });

  it('closes a set palette whose task left the page on re-render and skips the visibility refetch while open', async () => {
    const t = task(); const other = task();
    await mount(payload([t, other]));
    key(rows()[0], 'c');
    g.API.getTasks.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(g.API.getTasks).not.toHaveBeenCalled();
    g.API.deleteTask.mockResolvedValue({});
    key(rows()[0], 'Delete');
    key(rows()[0], 'Delete');
    await flush();
    expect(pal()).toBeNull();
  });

  it('gives dots and swatches accessible names and uses no hex colours in markup', async () => {
    await mount(payload([task({ color: 'teal' }), task()]));
    expect(dot(rows()[0]).getAttribute('aria-label')).toContain('Teal');
    expect(dot(rows()[1]).classList.contains('is-empty')).toBe(true);
    expect(dot(rows()[1]).getAttribute('aria-label')).toBe('Set colour');
    click(dot(rows()[0]));
    pal()!.querySelectorAll('.swatch').forEach((s) => expect(s.getAttribute('aria-label')).toBeTruthy());
    expect($('#tasks-root').innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    expect(read('views/tasks.js')).not.toMatch(/#[0-9a-f]{6}\b/i);
  });
});
