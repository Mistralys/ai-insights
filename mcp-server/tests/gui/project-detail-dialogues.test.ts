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
  var escapeHtml: (s: any) => string;
  // eslint-disable-next-line no-var
  var marked: { parse: (s: string) => string };
  // eslint-disable-next-line no-var
  var UI: { card: (title: string | null, body: string, opts?: Record<string, unknown>) => string };
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
  (globalThis as any).marked = { parse: (s: string) => '<p>' + s + '</p>' };

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
