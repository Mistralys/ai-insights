// @vitest-environment jsdom

/**
 * QA validation tests for WP-016 — Dialogue Capture GUI feature.
 * Covers all 10 acceptance criteria plus edge cases.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const apiClientJs     = readFileSync(join(publicDir, 'api-client.js'), 'utf-8');
const utilsJs         = readFileSync(join(publicDir, 'utils.js'), 'utf-8');
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'), 'utf-8');
const wpViewJs        = readFileSync(join(publicDir, 'views/work-package.js'), 'utf-8');

declare global {
  var API: { [k: string]: (...a: any[]) => Promise<any> };
  var renderWorkPackageDetail: (app: HTMLElement, repo: string, slug: string, wpId: string) => void;
  var escapeHtml: (s: any) => string;
  var marked: { parse: (s: string) => string };
  var showLoading: (el: HTMLElement) => void;
  var showError: (el: HTMLElement, msg: string) => void;
  var statusBadge: (s: string) => string;
  var formatDate: (d: string) => string;
  var formatDuration: (ms: number) => string;
  var buildWpDetailBar: (wp: any) => string;
  var STAGE_ABBREV: Record<string, string>;
}

beforeAll(() => {
  (globalThis as any).showLoading    = (el: HTMLElement) => { el.innerHTML = '<p>Loading…</p>'; };
  (globalThis as any).showError      = (el: HTMLElement, msg: string) => { el.innerHTML = '<p class="error">' + msg + '</p>'; };
  (globalThis as any).statusBadge    = (s: string) => '<span class="badge">' + (s || '') + '</span>';
  (globalThis as any).formatDate     = (d: string) => d || '';
  (globalThis as any).formatDuration = (ms: number) => ms + 'ms';
  (globalThis as any).marked         = { parse: (s: string) => '<p>' + s + '</p>' };

  vm.runInThisContext(utilsJs);
  vm.runInThisContext(apiClientJs);
  vm.runInThisContext(projectDetailJs);
  vm.runInThisContext(wpViewJs);
});

// ---------------------------------------------------------------------------
// URL-routing fetch mock — avoids shared-index ordering issues
//
// Route pattern reference for this file:
//   '/work-packages/'     → getWorkPackage()      returns the WP JSON object
//   /\/dialogues\?wp=/    → getDialogues()        returns array of { filename, stage }
//   /\/dialogues\//       → getDialogueContent()  returns { content: '...' } (text via res.text())
//
// IMPORTANT: keep the two dialogue patterns distinct. Using /\/dialogues\?wp=/ for both
// would cause the content fetch to silently match the list route (fallback behaviour) and
// return an array instead of a string — tests pass the wrong shape with no warning.
//
// Fallback behaviour: when no route matches, the last route in the array is used and a
// console.warn is emitted. Always order routes from most-specific to least-specific.
// ---------------------------------------------------------------------------
type Route = { match: string | RegExp; body?: unknown; text?: string; status?: number };

function installFetchMock(routes: Route[]) {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const matched = routes.find(r =>
      typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)
    );
    if (!matched) {
      console.warn(`[installFetchMock] No route matched URL: "${url}" — falling back to last route. Check your route patterns.`);
    }
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

// handoff_notes must live on the pipeline object — the code reads `p.handoff_notes`
const baseWp = {
  work_package_id: 'WP-016',
  status: 'IN_PROGRESS',
  assigned_to: 'QA',
  dependencies: [],
  acceptance_criteria: [{ criterion: 'Test AC', met: true }],
  active_pipeline_stages: ['implementation', 'qa'],
  pipelines: [
    {
      type: 'implementation',
      status: 'PASS',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:01:00Z',
      duration_ms: 60000,
      summary: ['Done'],
      comments: [],
      handoff_notes: ['Ready for QA'],
    },
  ],
};

const WAIT = 80; // ms to let async promises resolve in jsdom

// ============================================================
// AC1 — API.getDialogues URL
// ============================================================

describe('AC1 — API.getDialogues URL', () => {
  it('makes GET /api/projects/{repo}/{slug}/dialogues?wp={wpId}', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    });
    await globalThis.API.getDialogues('my-repo', 'my-project', 'WP-016');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/api/projects/my-repo/my-project/dialogues?wp=WP-016');
  });

  it('URI-encodes repo, slug and wpId', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    });
    await globalThis.API.getDialogues('my repo', 'slug with spaces', 'WP 016');
    expect(calls[0]).toBe('/api/projects/my%20repo/slug%20with%20spaces/dialogues?wp=WP%20016');
  });

  it('returns parsed JSON array', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => [{ filename: 'f.md', stage: 'qa' }],
    }));
    const result = await globalThis.API.getDialogues('my-repo', 'p', 'WP-001') as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].stage).toBe('qa');
  });
});

// ============================================================
// AC2 — API.getDialogueContent URL
// ============================================================

describe('AC2 — API.getDialogueContent URL', () => {
  // NOTE: These tests use a raw vi.fn() instead of installFetchMock because they
  // need to inspect the raw URL. The mock must include BOTH json() and text() even
  // though getDialogueContent() only calls text() — api-client.js uses a shared
  // request() helper for other endpoints that calls json(), and omitting either
  // method causes "res.json is not a function" / "res.text is not a function" errors
  // depending on which code path executes first.
  it('makes GET /api/projects/{repo}/{slug}/dialogues/{filename}', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ content: '# Hello' }), text: async () => '# Hello' };
    });
    await globalThis.API.getDialogueContent('my-repo', 'my-project', 'file.md');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/api/projects/my-repo/my-project/dialogues/file.md');
  });

  it('returns raw text (not parsed JSON)', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ content: '# Markdown content' }), text: async () => '# Markdown content',
    }));
    const result = await globalThis.API.getDialogueContent('my-repo', 'p', 'f.md');
    expect(typeof result).toBe('string');
    expect(result).toBe('# Markdown content');
  });

  it('throws on HTTP error', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false, status: 404, json: async () => null,
    }));
    await expect(globalThis.API.getDialogueContent('my-repo', 'p', 'f.md')).rejects.toMatchObject({
      code: 'ERROR',
      message: 'HTTP 404',
    });
  });
});

// ============================================================
// AC3 — Dialogues card rendered AFTER Handoff Notes card
// ============================================================

describe('AC3 — Dialogues card rendered after Handoff Notes card', () => {
  it('#wp-dialogues-section placeholder appears after Handoff Notes in innerHTML', async () => {
    const app = document.createElement('div');
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const html = app.innerHTML;
    const handoffIdx   = html.indexOf('Handoff Notes');
    const dialoguesIdx = html.indexOf('wp-dialogues-section');
    expect(handoffIdx).toBeGreaterThan(-1);
    expect(dialoguesIdx).toBeGreaterThan(-1);
    expect(dialoguesIdx).toBeGreaterThan(handoffIdx);
  });
});

// ============================================================
// AC4 — Empty dialogues → no-dialogues message, no buttons
// ============================================================

describe('AC4 — Empty dialogues array', () => {
  it('shows no-dialogues message and no buttons', async () => {
    const app = document.createElement('div');
    // app must be in the document so document.getElementById can find the placeholder
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).toContain('No dialogues available');
    expect(section!.querySelectorAll('button').length).toBe(0);

    document.body.removeChild(app);
  });
});

// ============================================================
// AC5 — Each filename as interactive element with human-readable label
// ============================================================

describe('AC5 — Dialogue buttons with human-readable labels', () => {
  it('renders a button for each dialogue with stage-r{n} label', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      {
        match: '/dialogues',
        body: [
          { filename: 'qa-dialogue-r0.md',       stage: 'qa' },
          { filename: 'qa-dialogue-r1.md',       stage: 'qa' },
          { filename: 'developer-dialogue-r0.md', stage: 'developer' },
        ],
      },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section  = app.querySelector('#wp-dialogues-section');
    const buttons  = section!.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(3);

    const labels = Array.from(buttons).map(b => b.textContent?.trim());
    expect(labels).toContain('qa-r0');
    expect(labels).toContain('qa-r1');
    expect(labels).toContain('developer-r0');

    document.body.removeChild(app);
  });

  it('latest revision button has dialogue-btn-latest class', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      {
        match: '/dialogues',
        body: [
          { filename: 'qa-r0.md', stage: 'qa' },
          { filename: 'qa-r1.md', stage: 'qa' },
        ],
      },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section    = app.querySelector('#wp-dialogues-section');
    const latestBtns = section!.querySelectorAll('.dialogue-btn-latest');
    expect(latestBtns.length).toBe(1);
    expect(latestBtns[0]!.textContent?.trim()).toBe('qa-r1');

    document.body.removeChild(app);
  });
});

// ============================================================
// AC6 — Clicking fetches and renders Markdown via marked.parse()
// ============================================================

describe('AC6 — Click fetches and renders via marked.parse()', () => {
  it('renders Markdown content in .dialogue-content after click', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    const markdownBody = '# Hello World';
    const parseSpy = vi.spyOn(globalThis.marked, 'parse');

    installFetchMock([
      { match: '/work-packages/',    body: { ...baseWp } },
      { match: /\/chunks\?wp=/,      body: [] },
      { match: /\/dialogues\?wp=/,   body: [{ filename: 'qa-r0.md', stage: 'qa' }] },
      { match: /\/dialogues\//,      body: { content: markdownBody } },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;    expect(section).not.toBeNull();    const btn     = section.querySelector('button.dialogue-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));

    const contentEl = section.querySelector('.dialogue-content')!;
    expect(contentEl.style.display).not.toBe('none');
    expect(parseSpy).toHaveBeenCalledWith(markdownBody);
    expect(contentEl.querySelector('.dialogue-markdown')).not.toBeNull();

    parseSpy.mockRestore();
    document.body.removeChild(app);
  });
});

// ============================================================
// AC7 — Clicking second dialogue collapses previously expanded
// ============================================================

describe('AC7 — Clicking second dialogue collapses first', () => {
  it('collapses previously expanded dialogue when a new one is clicked', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: /\/chunks\?wp=/,   body: [] },
      {
        match: /\/dialogues\?wp=/,
        body: [
          { filename: 'qa-r0.md',        stage: 'qa' },
          { filename: 'developer-r0.md', stage: 'developer' },
        ],
      },
      // NOTE: Two distinct URL patterns for dialogues — keep them separate:
      //   /dialogues?wp=   → getDialogues()       lists dialogue filenames for a WP
      //   /dialogues/      → getDialogueContent()  fetches content for one file
      // Using /dialogues?wp=/ for both would silently match the content fetch via
      // the installFetchMock fallback, returning an array instead of { content }.
      { match: /\/dialogues\//, body: { content: '# Content' } },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    const buttons = section.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(2);

    const btn1     = buttons[0] as HTMLButtonElement;
    const btn2     = buttons[1] as HTMLButtonElement;
    const content1 = btn1.closest('.dialogue-stage')!.querySelector('.dialogue-content') as HTMLElement;

    btn1.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn1.classList.contains('dialogue-btn-active')).toBe(true);
    expect(content1.style.display).not.toBe('none');

    btn2.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn1.classList.contains('dialogue-btn-active')).toBe(false);
    expect(content1.style.display).toBe('none');
    expect(btn2.classList.contains('dialogue-btn-active')).toBe(true);

    document.body.removeChild(app);
  });
});

// ============================================================
// AC8 — Fetch error handling
// ============================================================

describe('AC8 — Fetch error handling', () => {
  it('getDialogues failure shows inline error; rest of WP view intact', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues', body: { error: { message: 'Server error', code: 'ERR' } }, status: 500 },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    expect(app.querySelector('.ac-list')).not.toBeNull();
    expect(app.querySelector('.pipeline-track')).not.toBeNull();
    const section = app.querySelector('#wp-dialogues-section')!;
    expect(section.innerHTML).toContain('text-danger');
    expect(section.innerHTML).toContain('Failed to load dialogues');

    document.body.removeChild(app);
  });

  it('getDialogueContent failure shows inline error in content area', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    installFetchMock([
      { match: '/work-packages/',  body: { ...baseWp } },
      { match: /\/chunks\?wp=/,    body: [] },
      { match: /\/dialogues\?wp=/, body: [{ filename: 'qa-r0.md', stage: 'qa' }] },
      { match: /\/dialogues\//,    body: null, status: 403 },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    const btn     = section.querySelector('button.dialogue-btn') as HTMLButtonElement;
    btn.click();
    await new Promise(r => setTimeout(r, WAIT));

    const contentEl = section.querySelector('.dialogue-content') as HTMLElement;
    expect(contentEl.innerHTML).toContain('text-danger');
    expect(contentEl.innerHTML).toContain('Error loading dialogue');
    expect(app.querySelector('.ac-list')).not.toBeNull();

    document.body.removeChild(app);
  });
});

// ============================================================
// AC9 — Dialogues card does NOT appear above Pipelines card
// ============================================================

describe('AC9 — Dialogues card not above Pipelines card in DOM', () => {
  it('Pipelines card title appears before #wp-dialogues-section', async () => {
    const app = document.createElement('div');
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const html         = app.innerHTML;
    const pipelinesIdx = html.indexOf('>Pipelines<');
    const dialoguesIdx = html.indexOf('wp-dialogues-section');

    expect(pipelinesIdx).toBeGreaterThan(-1);
    expect(dialoguesIdx).toBeGreaterThan(-1);
    expect(dialoguesIdx).toBeGreaterThan(pipelinesIdx);
  });
});

// ============================================================
// AC10 — All existing WP rendering behavior preserved
// ============================================================

describe('AC10 — Existing WP rendering preserved', () => {
  it('renders acceptance criteria list', async () => {
    const app = document.createElement('div');
    const wp  = {
      ...baseWp,
      acceptance_criteria: [
        { criterion: 'AC one', met: true },
        { criterion: 'AC two', met: false },
      ],
    };
    installFetchMock([
      { match: '/work-packages/', body: wp },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    expect(app.querySelector('.ac-list')).not.toBeNull();
    expect(app.innerHTML).toContain('AC one');
    expect(app.innerHTML).toContain('AC two');
    expect(app.innerHTML).toContain('ac-met');
    expect(app.innerHTML).toContain('ac-unmet');
  });

  it('renders pipeline progression badges', async () => {
    const app = document.createElement('div');
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    expect(app.querySelector('.pipeline-track')).not.toBeNull();
    expect(app.innerHTML).toContain('Pipeline Progression');
  });

  it('renders pipeline items section', async () => {
    const app = document.createElement('div');
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    expect(app.innerHTML).toContain('Pipelines');
    expect(app.querySelector('.pipeline-item')).not.toBeNull();
  });

  it('renders handoff notes', async () => {
    const app = document.createElement('div');
    const wp  = {
      ...baseWp,
      pipelines: [
        {
          ...baseWp.pipelines[0],
          handoff_notes: ['Handoff to QA: ready for review.'],
        },
      ],
    };
    installFetchMock([
      { match: '/work-packages/', body: wp },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: [] },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    expect(app.innerHTML).toContain('Handoff Notes');
    expect(app.innerHTML).toContain('Handoff to QA: ready for review.');
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('Edge cases', () => {
  it('clicking the same button again collapses it (toggle)', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    installFetchMock([
      { match: '/work-packages/',  body: { ...baseWp } },
      { match: /\/chunks\?wp=/,    body: [] },
      { match: /\/dialogues\?wp=/, body: [{ filename: 'qa-r0.md', stage: 'qa' }] },
      { match: /\/dialogues\//,    body: { content: '# Hello' } },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section    = app.querySelector('#wp-dialogues-section')!;
    const btn        = section.querySelector('button.dialogue-btn') as HTMLButtonElement;
    const contentEl  = btn.closest('.dialogue-stage')!.querySelector('.dialogue-content') as HTMLElement;

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn.classList.contains('dialogue-btn-active')).toBe(true);

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn.classList.contains('dialogue-btn-active')).toBe(false);
    expect(contentEl.style.display).toBe('none');

    document.body.removeChild(app);
  });

  it('null dialogues response treated as empty (no crash)', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      { match: '/chunks',         body: [] },
      { match: '/dialogues',      body: null },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    expect(section.innerHTML).toContain('No dialogues');
    expect(section.querySelectorAll('button').length).toBe(0);

    document.body.removeChild(app);
  });

  it('slash in slug is URI-encoded in getDialogues', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    });
    await globalThis.API.getDialogues('my-repo', 'proj/sub', 'WP-001');
    expect(calls[0]).toBe('/api/projects/my-repo/proj%2Fsub/dialogues?wp=WP-001');
  });
});

// ============================================================
// WP-004 — aria-expanded on dialogue toggle buttons
// ============================================================

describe('WP-004 — aria-expanded behaviour on dialogue buttons', () => {
  async function renderWithDialogue(app: HTMLElement) {
    installFetchMock([
      { match: '/work-packages/',  body: { ...baseWp } },
      { match: /\/chunks\?wp=/,    body: [] },
      {
        match: /\/dialogues\?wp=/,
        body: [
          { filename: 'qa-r0.md',        stage: 'qa' },
          { filename: 'developer-r0.md', stage: 'developer' },
        ],
      },
      { match: /\/dialogues\//, body: { content: '# Hello' } },
    ]);
    document.body.appendChild(app);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));
  }

  it('AC19: dialogue buttons render with aria-expanded="false" by default', async () => {
    const app = document.createElement('div');
    await renderWithDialogue(app);

    const section = app.querySelector('#wp-dialogues-section')!;
    const buttons = section.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    document.body.removeChild(app);
  });

  it('AC20: clicking a dialogue button sets aria-expanded="true"', async () => {
    const app = document.createElement('div');
    await renderWithDialogue(app);

    const section = app.querySelector('#wp-dialogues-section')!;
    const btn = section.querySelector('button.dialogue-btn') as HTMLButtonElement;

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));

    expect(btn.getAttribute('aria-expanded')).toBe('true');

    document.body.removeChild(app);
  });

  it('AC21: clicking the same button again sets aria-expanded back to "false"', async () => {
    const app = document.createElement('div');
    await renderWithDialogue(app);

    const section = app.querySelector('#wp-dialogues-section')!;
    const btn = section.querySelector('button.dialogue-btn') as HTMLButtonElement;

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    document.body.removeChild(app);
  });

  it('AC21: clicking a different button sets first button aria-expanded back to "false"', async () => {
    const app = document.createElement('div');
    await renderWithDialogue(app);

    const section = app.querySelector('#wp-dialogues-section')!;
    const buttons = section.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const btn1 = buttons[0] as HTMLButtonElement;
    const btn2 = buttons[1] as HTMLButtonElement;

    btn1.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn1.getAttribute('aria-expanded')).toBe('true');
    expect(btn2.getAttribute('aria-expanded')).toBe('false');

    btn2.click();
    await new Promise(r => setTimeout(r, WAIT));
    expect(btn1.getAttribute('aria-expanded')).toBe('false');
    expect(btn2.getAttribute('aria-expanded')).toBe('true');

    document.body.removeChild(app);
  });
});

// ============================================================
// Chunk-priority path — getChunks returns data → useChunks=true
// ============================================================

describe('Chunk-priority path (useChunks=true)', () => {
  it('uses chunks as data source when getChunks returns non-empty', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      {
        match: /\/chunks\?wp=/,
        body: [
          { filename: 'WP-016-developer-r0.jsonl', stage: 'developer' },
        ],
      },
      { match: /\/dialogues\?wp=/, body: [{ filename: 'developer-r0.md', stage: 'developer' }] },
      { match: /\/chunks\/.*\/rendered/, body: { content: '# Rendered from chunks' } },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    const buttons = section.querySelectorAll('button.dialogue-btn');
    expect(buttons.length).toBe(1);
    // Button must have data-use-chunks="1"
    expect(buttons[0].getAttribute('data-use-chunks')).toBe('1');

    document.body.removeChild(app);
  });

  it('clicking a chunk button calls getChunkRendered (not getDialogueContent)', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    const renderedMd = '# Chunk Rendered Markdown';

    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      {
        match: /\/chunks\?wp=/,
        body: [{ filename: 'WP-016-developer-r0.jsonl', stage: 'developer' }],
      },
      { match: /\/dialogues\?wp=/, body: [] },
      { match: /\/chunks\/.*\/rendered/, body: { content: renderedMd } },
    ]);

    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    const btn = section.querySelector('button.dialogue-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    btn.click();
    await new Promise(r => setTimeout(r, WAIT));

    // Verify the rendered content is displayed
    const contentEl = section.querySelector('.dialogue-content')!;
    expect(contentEl.style.display).not.toBe('none');
    expect(contentEl.querySelector('.dialogue-markdown')).not.toBeNull();

    // Verify the fetch URL hit the /rendered endpoint (chunks path)
    const fetchCalls = (globalThis.fetch as any).mock.calls.map((c: any) => c[0] as string);
    const renderedCalls = fetchCalls.filter((url: string) => url.includes('/rendered'));
    expect(renderedCalls.length).toBeGreaterThan(0);

    document.body.removeChild(app);
  });

  it('chunks take priority over dialogues when both return entries', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    installFetchMock([
      { match: '/work-packages/', body: { ...baseWp } },
      {
        match: /\/chunks\?wp=/,
        body: [{ filename: 'WP-016-qa-r0.jsonl', stage: 'qa' }],
      },
      {
        match: /\/dialogues\?wp=/,
        body: [
          { filename: 'qa-r0.md', stage: 'qa' },
          { filename: 'qa-r1.md', stage: 'qa' },
        ],
      },
      { match: /\/chunks\/.*\/rendered/, body: { content: '# Chunk content' } },
    ]);
    globalThis.renderWorkPackageDetail(app, 'test-repo', 'proj', 'WP-016');
    await new Promise(r => setTimeout(r, WAIT));

    const section = app.querySelector('#wp-dialogues-section')!;
    const buttons = section.querySelectorAll('button.dialogue-btn');
    // Should have 1 button (from chunks), not 2 (from dialogues)
    expect(buttons.length).toBe(1);
    // All buttons must be chunk-backed
    buttons.forEach(btn => {
      expect(btn.getAttribute('data-use-chunks')).toBe('1');
    });

    document.body.removeChild(app);
  });
});

// ============================================================
// wpId=undefined guard — no ?wp=undefined in URL
// ============================================================

describe('wpId=undefined guard', () => {
  it('getDialogues with undefined wpId does not produce ?wp=undefined', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    });
    await globalThis.API.getDialogues('my-repo', 'my-project', undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('wp=undefined');
  });

  it('getChunks with undefined wpId does not produce ?wp=undefined', async () => {
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [] };
    });
    await globalThis.API.getChunks('my-repo', 'my-project', undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('wp=undefined');
  });
});
