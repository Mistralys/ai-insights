// @vitest-environment jsdom

/**
 * Tests for gui/public/views/tasks-render.js (WP-011).
 * Loads the real utils.js, safe-markdown.js, tasks-model.js and tasks-render.js.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const read = (p: string) => readFileSync(join(publicDir, p), 'utf-8');

/* eslint-disable @typescript-eslint/no-explicit-any */
let R: any;
let M: any;

beforeAll(() => {
  vm.runInThisContext(read('utils.js'));
  vm.runInThisContext(read('libs/marked.min.js'));
  vm.runInThisContext(read('safe-markdown.js'));
  vm.runInThisContext(read('views/tasks-model.js'));
  vm.runInThisContext(read('views/tasks-render.js'));
  R = (globalThis as any).TasksRender ?? vm.runInThisContext('TasksRender');
  M = vm.runInThisContext('TasksModel');
});

const ID = '0123456789abcdef-0000-4000-8000-000000000001';

function task(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    text: 'Title line',
    tags: [],
    priority: 1,
    completed: false,
    created_at: '2026-11-01T10:00:00Z',
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

function dom(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

function state(over: Record<string, unknown> = {}) {
  return { filter: { status: 'open', store: '', tags: [], colors: [], q: '' }, sort: 'priority', paletteMode: null, ...over };
}

describe('row', () => {
  it('renders handle, checkbox, ref, colour, text, toggle, delete in order', () => {
    const li = dom(R.row(task(), { sort: 'priority' })).firstElementChild!;
    const parts = Array.from(li.children).map((c) => c.className.split(' ')[0]);
    expect(parts).toEqual(['task-handle', 'task-check', 'task-ref', 'task-color', 'task-text', 'btn-icon', 'btn-icon']);
    expect(li.querySelector('.task-toggle')).not.toBeNull();
    expect(li.querySelector('.task-delete')).not.toBeNull();
  });

  it('omits the handle for date sorts', () => {
    expect(R.row(task(), { sort: 'created' })).not.toContain('task-handle');
    expect(R.row(task(), { sort: 'completed' })).not.toContain('task-handle');
  });

  it('shows the expand dot only with notes', () => {
    expect(R.row(task(), {})).not.toContain('has-more');
    expect(R.row(task({ text: 'A\nnotes' }), {})).toContain('has-more');
  });

  it('renders notes via SafeMarkdown, metadata and short id when expanded', () => {
    const html = R.row(
      task({ text: 'A\n**bold** <script>x</script>', completed: true, completed_at: '2026-11-02T10:00:00Z', completion_source: 'agent-x', tags: ['one'] }),
      { expanded: { [ID]: true } },
    );
    const li = dom(html);
    expect(li.querySelector('.task-notes strong')!.textContent).toBe('bold');
    expect(html).not.toContain('<script>');
    expect(li.querySelector('.badge-store')!.textContent).toBe('Store One');
    expect(li.textContent).toContain('Created');
    expect(li.textContent).toContain('Completed');
    expect(li.textContent).toContain('agent-x');
    const sid = li.querySelector('.task-id')!;
    expect(sid.textContent).toBe(ID.slice(0, 8));
    expect(sid.getAttribute('title')).toBe(ID);
    expect(li.querySelector('.tag-label')!.textContent).toBe('one');
    expect(li.querySelector('input.tag-input')).not.toBeNull();
  });

  it('collapses details by default and escapes user values', () => {
    const li = dom(R.row(task({ store_label: '"><b>x</b>', tags: ['<i>'] }), { expanded: { [ID]: true } }));
    expect(li.querySelector('b')).toBeNull();
    expect(li.querySelector('i')).toBeNull();
    expect(R.row(task(), {})).not.toContain('task-details');
  });

  it('renders the armed delete as Confirm', () => {
    expect(R.row(task(), { armed: ID })).toContain('is-armed');
  });
});

describe('colorCell', () => {
  it('renders a coloured dot through a tc class without style or hex', () => {
    const html = R.colorCell(task({ color: 'violet' }), false);
    expect(html).toContain('tc-violet');
    expect(html).toContain('aria-label="Colour: Violet. Change colour"');
    expect(html).not.toContain('style=');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('renders empty for no colour and for unknown ids', () => {
    for (const color of ['', 'chartreuse']) {
      const html = R.colorCell(task({ color }), false);
      expect(html).toContain('is-empty');
      expect(html).toContain('aria-label="Set colour"');
      expect(html).not.toContain('tc-chartreuse');
    }
  });

  it('reflects the open state in aria-expanded', () => {
    expect(R.colorCell(task(), true)).toContain('aria-expanded="true"');
  });
});

describe('palette', () => {
  it('set mode renders 16 named swatches plus No colour', () => {
    const el = dom(R.palette('set', 'blue'));
    const sw = el.querySelectorAll('.swatch');
    expect(sw.length).toBe(16);
    expect(sw[0].getAttribute('aria-label')).toBe('Red');
    expect(el.querySelector('.swatch[data-color="blue"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.swatch[data-color="red"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('.palette-none')!.textContent).toBe('No colour');
    expect(el.innerHTML).not.toContain('style=');
  });

  it('filter mode disables Any with an empty selection', () => {
    const el = dom(R.palette('filter', []));
    expect(el.querySelector('[data-color="none"]')).not.toBeNull();
    expect((el.querySelector('[data-color-clear]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('filter mode enables Any and marks selected keys', () => {
    const el = dom(R.palette('filter', ['red', 'none']));
    expect((el.querySelector('[data-color-clear]') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-color="none"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.swatch[data-color="red"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('filterBar and activeFilters', () => {
  it('shows Any on the colour button when nothing is selected', () => {
    const el = dom(R.filterBar(state(), [{ id: 's1', label: 'S1' }], ['a']));
    const btn = el.querySelector('#f-color')!;
    expect(btn.getAttribute('aria-label')).toBe('Colour filter: any');
    expect(btn.querySelector('.any')).not.toBeNull();
    expect(el.querySelector('.field-label')!.textContent).toBe('Colour:');
    expect(el.querySelector('#f-store-field')!.hasAttribute('hidden')).toBe(true);
    expect(el.querySelectorAll('#tag-list option').length).toBe(1);
  });

  it('shows one dot per selected colour and names in the label', () => {
    const el = dom(R.filterBar(state({ filter: { status: 'open', store: '', tags: [], colors: ['red', 'none'], q: '' }, paletteMode: 'filter' }), [], []));
    const btn = el.querySelector('#f-color')!;
    expect(btn.querySelectorAll('.chip-dot').length).toBe(2);
    expect(btn.querySelector('.chip-dot.tc-red')).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Colour filter: Red, No colour');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders tag and colour chips under their labels with remove buttons', () => {
    const el = dom(R.activeFilters(state({ filter: { status: 'open', store: '', tags: ['x'], colors: ['green', 'none'], q: '' } })));
    const labels = Array.from(el.querySelectorAll('.label')).map((l) => l.textContent);
    expect(labels).toEqual(['All of:', 'Colour, any of:']);
    expect(el.querySelector('[data-remove-filter="x"]')).not.toBeNull();
    expect(el.querySelector('[data-remove-color="green"]')).not.toBeNull();
    expect(el.textContent).toContain('No colour');
    expect(el.querySelector('#btn-clear-filters')).not.toBeNull();
  });

  it('renders nothing for default filters', () => {
    expect(R.activeFilters(state())).toBe('');
  });
});

describe('refCell', () => {
  it('links with a pencil when ticket_url is set', () => {
    const el = dom(R.refCell(task({ ticket_label: 'ABC-1', ticket_url: 'https://t.example/ABC-1' }), false));
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://t.example/ABC-1');
    expect(el.querySelector('.ref-edit')).not.toBeNull();
  });

  it('renders a click-to-edit button when empty or unlinked', () => {
    expect(dom(R.refCell(task(), false)).querySelector('.ref-empty')).not.toBeNull();
    const plain = dom(R.refCell(task({ ticket_label: 'ABC-1' }), false));
    expect(plain.querySelector('.ref-plain')!.textContent).toBe('ABC-1');
    expect(plain.querySelector('a')).toBeNull();
  });

  it('renders an input when editing', () => {
    const el = dom(R.refCell(task({ ticket_label: 'A"B' }), true));
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('A"B');
  });
});

describe('store menu, pagination, toolbar, help, draft, empty state', () => {
  it('store menu has role menu and escapes labels', () => {
    const el = dom(R.storeMenu([{ id: 's1', label: '<b>x</b>' }], 'top'));
    expect(el.firstElementChild!.getAttribute('role')).toBe('menu');
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('[role="menuitem"]')!.getAttribute('data-store')).toBe('s1');
  });

  it('pagination reuses the shared classes', () => {
    const list = Array.from({ length: 45 }, (_, i) => ({ id: String(i) }));
    const p = M.pageOf(list, 2, 20);
    const el = dom(R.pagination(p, { pageSize: 20, stores: [] }));
    expect(el.querySelector('.pagination-row')).not.toBeNull();
    expect(el.querySelector('.pagination-btn.active')!.textContent).toBe('2');
    expect(el.querySelector('#page-info')!.textContent).toBe('21–40 of 45');
    expect((el.querySelector('#page-size') as HTMLSelectElement).value).toBe('20');
  });

  it('toolbar renders create, live status, expand all and shortcuts', () => {
    const el = dom(R.toolbar('top', { stores: [{ id: 'a', label: 'A' }], allExpanded: false }));
    expect(el.querySelector('[data-create="top"]')).not.toBeNull();
    expect(el.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(el.querySelector('#btn-expand-all')!.textContent).toBe('Expand all');
    expect(el.querySelector('#btn-help kbd')!.textContent).toBe('?');
    expect(dom(R.toolbar('top', { allExpanded: true })).querySelector('#btn-expand-all')!.textContent).toBe('Collapse all');
  });

  it('toolbar shows the store menu only with several stores', () => {
    const two = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    expect(R.toolbar('top', { stores: two, menuOpen: true })).toContain('role="menu"');
    expect(R.toolbar('top', { stores: [two[0]], menuOpen: true })).not.toContain('role="menu"');
  });

  it('help panel lists the full key map including c', () => {
    const el = dom(R.helpPanel());
    const keys = Array.from(el.querySelectorAll('dt')).map((d) => d.textContent);
    expect(keys).toContain('c');
    expect(keys.length).toBe(13);
  });

  it('draft renders a text area labelled with the store', () => {
    const el = dom(R.draft('top', { store: 's1', storeLabel: 'Store "One"', text: '<x>', ref: '', invalid: true }));
    expect(el.firstElementChild!.getAttribute('aria-label')).toBe('New task in store Store "One"');
    const ta = el.querySelector('textarea')!;
    expect(ta.value).toBe('<x>');
    expect(ta.getAttribute('aria-invalid')).toBe('true');
  });

  it('empty state differs for filtered and unfiltered lists', () => {
    const a = R.emptyState(true);
    const b = R.emptyState(false);
    expect(a).not.toBe(b);
    expect(a).toContain('data-empty-clear');
    expect(b).not.toContain('data-empty-clear');
  });
});
