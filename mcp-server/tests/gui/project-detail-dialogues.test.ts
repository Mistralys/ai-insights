// @vitest-environment jsdom

/**
 * Tests for the project-detail-dialogues.js sub-module.
 * Covers renderDialoguesSection() acceptance criteria:
 *  - renders table with project-level entries (source = "Project")
 *  - renders table with WP-level entries (source = WP ID)
 *  - prefers chunks over Markdown dialogue files when chunks exist
 *  - shows empty state when no dialogues or chunks exist
 *  - clicking a revision button expands content inline
 *  - clicking the same button again collapses content
 *  - error state shown when fetch fails
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const apiClientJs     = readFileSync(join(publicDir, 'api-client.js'), 'utf-8');
const componentsJs    = readFileSync(join(publicDir, 'components.js'), 'utf-8');
const dialoguesModJs  = readFileSync(join(publicDir, 'views/project-detail-dialogues.js'), 'utf-8');

declare global {
  // eslint-disable-next-line no-var
  var API: { [k: string]: (...a: any[]) => Promise<any> };
  // eslint-disable-next-line no-var
  var renderDialoguesSection: (sectionEl: HTMLElement, repo: string, slug: string) => void;
  // eslint-disable-next-line no-var
  var buildDialogueHTML: (blocks: any[]) => string;
  // eslint-disable-next-line no-var
  var escapeHtml: (s: any) => string;
  // eslint-disable-next-line no-var
  var marked: { parse: (s: string) => string; parseInline: (s: string) => string };
  // eslint-disable-next-line no-var
  var UI: { card: (title: string | null, body: string, opts?: Record<string, unknown>) => string };
  // eslint-disable-next-line no-var
  var _dialogueInlineMarkdown: (text: string) => string;
}

const WAIT = 80; // ms to let async promises resolve in jsdom

beforeAll(() => {
  // Minimal stubs expected by api-client.js
  (globalThis as any).escapeHtml = (s: unknown) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  (globalThis as any).marked = {
    parse: (s: string) => '<p>' + s + '</p>',
    // Passthrough: the production code now pre-escapes via escapeHtml() before
    // calling parseInline(), so this mock should not re-escape.  The real marked
    // library converts Markdown syntax but does not HTML-escape its output.
    parseInline: (s: string) => s,
  };

  vm.runInThisContext(apiClientJs);
  vm.runInThisContext(componentsJs);
  vm.runInThisContext(dialoguesModJs);
});

// ---------------------------------------------------------------------------
// Route mock helper
// ---------------------------------------------------------------------------
type Route = { match: string | RegExp; body?: unknown; text?: string; status?: number };

function installFetchMock(routes: Route[]) {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const matched = routes.find(r =>
      typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)
    );
    const route = matched ?? routes[routes.length - 1]!;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body ?? null,
      text: async () => route.text ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('empty state', () => {
  it('shows empty state message when no chunks and no dialogues exist', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      { match: /\/dialogues/, body: [] },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    expect(sectionEl.innerHTML).toContain('No dialogues available');
    expect(sectionEl.querySelectorAll('button.dialogue-btn').length).toBe(0);

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// Project-level entries (source = "Project")
// ---------------------------------------------------------------------------

describe('project-level entries', () => {
  it('renders "Project" source badge for wp_id="project" entries', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md',        wp_id: 'project', stage: 'pm' },
          { filename: 'project-synthesis-r0.md', wp_id: 'project', stage: 'synthesis' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const html = sectionEl.innerHTML;
    expect(html).toContain('dialogue-source-project');
    expect(html).toContain('Project');
    // Both stages should appear
    expect(html).toContain('pm');
    expect(html).toContain('synthesis');

    document.body.removeChild(sectionEl);
  });

  it('renders buttons for each revision of a project-level stage', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' },
          { filename: 'project-pm-r1.md', wp_id: 'project', stage: 'pm' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const buttons = sectionEl.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(2);
    const labels = Array.from(buttons).map(b => b.textContent?.trim());
    expect(labels).toContain('pm-r0');
    expect(labels).toContain('pm-r1');

    // Latest button should have dialogue-btn-latest class
    const latestBtns = sectionEl.querySelectorAll('.dialogue-btn-latest');
    expect(latestBtns.length).toBe(1);
    expect(latestBtns[0]!.textContent?.trim()).toBe('pm-r1');

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// WP-level entries
// ---------------------------------------------------------------------------

describe('WP-level entries', () => {
  it('renders WP ID in source cell for wp_id="WP-001" entries', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'WP-001-developer-r0.md', wp_id: 'WP-001', stage: 'developer' },
          { filename: 'WP-002-qa-r0.md',        wp_id: 'WP-002', stage: 'qa' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const html = sectionEl.innerHTML;
    expect(html).toContain('WP-001');
    expect(html).toContain('WP-002');
    // WP entries should NOT have the project badge class
    expect(html).not.toContain('dialogue-source-project');

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// Chunk priority over Markdown
// ---------------------------------------------------------------------------

describe('chunk priority', () => {
  it('uses chunks when chunks exist — ignores dialogues', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      {
        match: /\/chunks/,
        body: [
          { filename: 'project-pm-r0.jsonl', wp_id: 'project', stage: 'pm' },
        ],
      },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' },
          { filename: 'WP-001-developer-r0.md', wp_id: 'WP-001', stage: 'developer' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    // Only 1 button (from chunks), not 2 (from dialogues)
    const buttons = sectionEl.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(1);
    // The button's data-use-chunks should be "1"
    expect(buttons[0]!.getAttribute('data-use-chunks')).toBe('1');

    document.body.removeChild(sectionEl);
  });

  it('falls back to dialogues when chunks array is empty', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'WP-001-developer-r0.md', wp_id: 'WP-001', stage: 'developer' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const buttons = sectionEl.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(1);
    expect(buttons[0]!.getAttribute('data-use-chunks')).toBe('0');

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// Modal interaction
// ---------------------------------------------------------------------------

describe('modal interaction', () => {
  it('clicking a button opens the dialogue modal', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      { match: /\/dialogues\//, body: { content: '# PM Dialogue' } },
      {
        match: /\/dialogues/,
        body: [{ filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' }],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const btn = sectionEl.querySelector<HTMLButtonElement>('button.dialogue-btn');
    expect(btn).not.toBeNull();

    btn!.click();
    await new Promise(r => setTimeout(r, WAIT));

    const modal = document.getElementById('dialogue-modal-overlay');
    expect(modal).not.toBeNull();
    expect(modal!.innerHTML).toContain('PM Dialogue');

    modal!.remove();
    document.body.removeChild(sectionEl);
  });

  it('clicking the close button removes the modal', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      { match: /\/dialogues\//, body: { content: '# PM Dialogue' } },
      {
        match: /\/dialogues/,
        body: [{ filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' }],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    sectionEl.querySelector<HTMLButtonElement>('button.dialogue-btn')!.click();
    await new Promise(r => setTimeout(r, WAIT));

    expect(document.getElementById('dialogue-modal-overlay')).not.toBeNull();

    document.getElementById('dialogue-modal-close')!.click();
    expect(document.getElementById('dialogue-modal-overlay')).toBeNull();

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('error state', () => {
  it('shows error message when API.getDialogues throws', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      { match: /\/dialogues/, body: null, status: 500 },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    expect(sectionEl.innerHTML).toMatch(/Failed to load dialogues|HTTP 500/);

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// Table structure
// ---------------------------------------------------------------------------

describe('table structure', () => {
  it('renders a table with Source, Stage, and Dialogue columns', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    const table = sectionEl.querySelector('table.dialogues-overview-table');
    expect(table).not.toBeNull();

    const headers = Array.from(table!.querySelectorAll('th')).map(th => th.textContent?.trim());
    expect(headers).toContain('Source');
    expect(headers).toContain('Stage');
    expect(headers).toContain('Dialogue');

    document.body.removeChild(sectionEl);
  });

  it('groups multiple entries for the same source+stage in one row', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' },
          { filename: 'project-pm-r1.md', wp_id: 'project', stage: 'pm' },
          { filename: 'project-pm-r2.md', wp_id: 'project', stage: 'pm' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    // Should produce exactly 1 data row (all revisions of pm in one row)
    const rows = sectionEl.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);

    // But 3 buttons (one per revision)
    const buttons = sectionEl.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(3);

    document.body.removeChild(sectionEl);
  });

  it('mixed sources produce separate rows per source+stage combination', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      {
        match: /\/dialogues/,
        body: [
          { filename: 'project-pm-r0.md',        wp_id: 'project', stage: 'pm' },
          { filename: 'project-synthesis-r0.md', wp_id: 'project', stage: 'synthesis' },
          { filename: 'WP-001-developer-r0.md',  wp_id: 'WP-001',  stage: 'developer' },
        ],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    // 3 distinct source+stage combinations → 3 rows
    const rows = sectionEl.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);

    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// WP-006 — buildDialogueHTML unit tests
// ---------------------------------------------------------------------------

describe('buildDialogueHTML — empty input', () => {
  it('returns a no-content message for null/empty blocks', () => {
    const html = globalThis.buildDialogueHTML([]);
    expect(html).toContain('No dialogue content');
  });
});

describe('buildDialogueHTML — text blocks', () => {
  it('wraps content in dialogue-text div with paragraph elements', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'text', content: 'Hello world' },
    ]);
    expect(html).toContain('class="dialogue-text"');
    expect(html).toContain('<p>');
    expect(html).toContain('Hello world');
  });

  it('splits double newlines into separate <p> elements', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'text', content: 'First paragraph\n\nSecond paragraph' },
    ]);
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBeGreaterThanOrEqual(2);
    expect(html).toContain('First paragraph');
    expect(html).toContain('Second paragraph');
  });

  it('escapes HTML in text content', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'text', content: '<script>alert(1)</script>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildDialogueHTML — tool-call blocks (AC-1 through AC-4)', () => {
  it('renders collapsed-by-default toggle button with ▶ indicator (AC-1)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'read_file', detailLines: [], args: {}, result: undefined },
    ]);
    expect(html).toContain('dialogue-tool-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('▶');
    expect(html).toContain('Tool call: read_file');
  });

  it('tool-call body is hidden by default (AC-1)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'write_file', detailLines: [], args: { path: 'f.ts' } },
    ]);
    expect(html).toContain('hidden');
    expect(html).toContain('dialogue-tool-details');
  });

  it('renders args JSON inside the collapsible body (AC-2)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'write_file', detailLines: [], args: { path: 'f.ts', content: 'x' } },
    ]);
    expect(html).toContain('dialogue-tool-args');
    expect(html).toContain('f.ts');
  });

  it('renders tool result inside the collapsible body when present (AC-2)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'read_file', detailLines: [], args: {}, result: { content: 'file contents' } },
    ]);
    expect(html).toContain('dialogue-tool-result');
    expect(html).toContain('file contents');
  });

  it('omits result div when result is absent (AC-2)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'read_file', detailLines: [], args: {}, result: undefined },
    ]);
    expect(html).not.toContain('dialogue-tool-result');
  });

  it('renders ↳ detail lines always visible (outside hidden div) (AC-4)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: 'read_file', detailLines: ['↳ path: foo.ts'], args: {} },
    ]);
    // Detail lines must appear before the hidden div
    const detailLineIdx  = html.indexOf('↳ path: foo.ts');
    const hiddenDivIdx   = html.indexOf('hidden');
    expect(detailLineIdx).toBeGreaterThanOrEqual(0);
    expect(hiddenDivIdx).toBeGreaterThan(detailLineIdx);
  });

  it('escapes tool name and detail lines (XSS defence)', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'tool-call', name: '<img src=x onerror=1>', detailLines: ['<bad>'], args: {} },
    ]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<bad>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;bad&gt;');
  });
});

describe('buildDialogueHTML — toggle expand/collapse via delegated listener (AC-2, AC-3)', () => {
  it('clicking a tool-call header expands the body and updates aria-expanded', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      {
        match: /\/chunks\/.*\/rendered\?format=structured/,
        body: {
          blocks: [
            { type: 'tool-call', name: 'read_file', detailLines: [], args: { path: 'x.ts' } },
          ],
        },
      },
      {
        match: /\/chunks/,
        body: [{ filename: 'project-developer-r0.jsonl', wp_id: 'project', stage: 'developer' }],
      },
      { match: /\/dialogues/, body: [] },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    // Open the modal
    sectionEl.querySelector<HTMLButtonElement>('button.dialogue-btn')!.click();
    await new Promise(r => setTimeout(r, WAIT));

    const modal  = document.getElementById('dialogue-modal-overlay')!;
    const toggle = modal.querySelector<HTMLButtonElement>('.dialogue-tool-toggle')!;
    const body   = modal.querySelector<HTMLElement>('.dialogue-tool-details')!;
    const arrow  = modal.querySelector<HTMLElement>('.dialogue-tool-arrow')!;

    // Initially collapsed
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hasAttribute('hidden')).toBe(true);

    // Click to expand
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('hidden')).toBe(false);
    expect(arrow.classList.contains('expanded')).toBe(true);

    modal.remove();
    document.body.removeChild(sectionEl);
  });

  it('clicking an expanded tool-call header collapses it back (AC-3)', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      {
        match: /\/chunks\/.*\/rendered\?format=structured/,
        body: {
          blocks: [
            { type: 'tool-call', name: 'write_file', detailLines: [], args: {} },
          ],
        },
      },
      {
        match: /\/chunks/,
        body: [{ filename: 'project-developer-r0.jsonl', wp_id: 'project', stage: 'developer' }],
      },
      { match: /\/dialogues/, body: [] },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    sectionEl.querySelector<HTMLButtonElement>('button.dialogue-btn')!.click();
    await new Promise(r => setTimeout(r, WAIT));

    const modal  = document.getElementById('dialogue-modal-overlay')!;
    const toggle = modal.querySelector<HTMLButtonElement>('.dialogue-tool-toggle')!;
    const body   = modal.querySelector<HTMLElement>('.dialogue-tool-details')!;

    // Expand then collapse
    toggle.click();
    expect(body.hasAttribute('hidden')).toBe(false);

    toggle.click();
    expect(body.hasAttribute('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    modal.remove();
    document.body.removeChild(sectionEl);
  });
});

describe('buildDialogueHTML — checklist blocks (AC-6)', () => {
  it('renders checklist items with checkbox indicators', () => {
    const html = globalThis.buildDialogueHTML([
      {
        type: 'checklist',
        items: [
          { content: 'Task one',   status: 'done',    checked: true  },
          { content: 'Task two',   status: 'pending', checked: false },
        ],
      },
    ]);
    expect(html).toContain('dialogue-checklist');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Task one');
    expect(html).toContain('Task two');
    // Checked item should have checked attribute
    expect(html).toContain('checked');
    // Checked item should have "checked" class for strikethrough
    expect(html).toContain('class="checked"');
  });

  it('escapes checklist item content', () => {
    const html = globalThis.buildDialogueHTML([
      {
        type: 'checklist',
        items: [{ content: '<script>xss</script>', status: 'pending', checked: false }],
      },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildDialogueHTML — subagent-heading blocks (AC-7)', () => {
  it('renders subagent heading as h3 element', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'subagent-heading', label: 'Developer Subagent' },
    ]);
    expect(html).toContain('<h3');
    expect(html).toContain('dialogue-subagent-heading');
    expect(html).toContain('Developer Subagent');
  });

  it('escapes subagent label', () => {
    const html = globalThis.buildDialogueHTML([
      { type: 'subagent-heading', label: '<b>bad</b>' },
    ]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('_openDialogueModal — legacy Markdown path (AC-8)', () => {
  it('uses marked.parse() when useChunks is false', async () => {
    const sectionEl = document.createElement('div');
    document.body.appendChild(sectionEl);

    installFetchMock([
      { match: /\/chunks/, body: [] },
      { match: /\/dialogues\//, body: { content: '# Markdown content' } },
      {
        match: /\/dialogues/,
        body: [{ filename: 'project-pm-r0.md', wp_id: 'project', stage: 'pm' }],
      },
    ]);

    globalThis.renderDialoguesSection(sectionEl, 'my-repo', 'my-project');
    await new Promise(r => setTimeout(r, WAIT));

    sectionEl.querySelector<HTMLButtonElement>('button.dialogue-btn')!.click();
    await new Promise(r => setTimeout(r, WAIT));

    const modal = document.getElementById('dialogue-modal-overlay')!;
    expect(modal.innerHTML).toContain('dialogue-markdown');
    // marked.parse stub wraps in <p>
    expect(modal.innerHTML).toContain('<p>');

    modal.remove();
    document.body.removeChild(sectionEl);
  });
});

// ---------------------------------------------------------------------------
// _dialogueInlineMarkdown — regex fallback (D-5)
// ---------------------------------------------------------------------------

describe('_dialogueInlineMarkdown — regex fallback when marked is unavailable', () => {
  let savedMarked: typeof globalThis.marked;

  beforeEach(() => {
    savedMarked = globalThis.marked;
    // Simulate an environment where marked is not loaded.
    (globalThis as any).marked = undefined;
  });

  afterEach(() => {
    globalThis.marked = savedMarked;
  });

  it('renders **bold** as <strong>', () => {
    const result = globalThis._dialogueInlineMarkdown('hello **world**');
    expect(result).toContain('<strong>world</strong>');
    expect(result).toContain('hello ');
  });

  it('renders *italic* as <em>', () => {
    const result = globalThis._dialogueInlineMarkdown('hello *world*');
    expect(result).toContain('<em>world</em>');
  });

  it('renders `code` as <code>', () => {
    const result = globalThis._dialogueInlineMarkdown('run `npm test`');
    expect(result).toContain('<code>npm test</code>');
  });

  it('HTML-escapes dangerous characters before Markdown substitution', () => {
    const result = globalThis._dialogueInlineMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes HTML inside **bold** syntax', () => {
    const result = globalThis._dialogueInlineMarkdown('**<em>unsafe</em>**');
    expect(result).not.toContain('<em>');
    expect(result).toContain('<strong>');
    expect(result).toContain('&lt;em&gt;');
  });

  it('returns plain escaped text when no Markdown syntax is present', () => {
    const result = globalThis._dialogueInlineMarkdown('plain & simple');
    expect(result).toBe('plain &amp; simple');
  });
});

