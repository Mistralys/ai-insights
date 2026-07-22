// @vitest-environment jsdom

/**
 * Unit tests for namespaced project link generation in knowledge.js (WP-012).
 *
 * Acceptance criteria tested:
 *   AC-2: `knowledge.js` origin-plan links use `#/projects/{repo}/{slug}`
 *         when `repository_name` is available.
 *   AC-3: Entries with null `repository_name` do not generate broken links —
 *         graceful fallback is applied (plain text, no anchor).
 *   AC-4: No link in either view still uses the bare-slug form without repo.
 *
 * Uses jsdom + vm.runInThisContext to execute the browser-side scripts in
 * the globalThis context, mirroring the approach in client-rendering.test.ts
 * and orchestrator-view.test.ts.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');

const knowledgeJs = readFileSync(join(publicDir, 'views/knowledge.js'), 'utf-8');

// ---------------------------------------------------------------------------
// Global type stubs
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderKnowledge: (app: HTMLElement) => void;
  // eslint-disable-next-line no-var
  var API: {
    getKnowledge:     ReturnType<typeof vi.fn>;
    updateKnowledge:  ReturnType<typeof vi.fn>;
    deleteKnowledge:  ReturnType<typeof vi.fn>;
    promoteKnowledge: ReturnType<typeof vi.fn>;
    moveKnowledge:    ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line no-var
  var Router: {
    _setPolling:   ReturnType<typeof vi.fn>;
    _clearPolling: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line no-var
  var showLoading: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line no-var
  var showError:   ReturnType<typeof vi.fn>;
  // eslint-disable-next-line no-var
  var formatDate:  (s: string) => string;
  // eslint-disable-next-line no-var
  var escapeHtml:  (s: string) => string;
}

// ---------------------------------------------------------------------------
// Setup: install globals, load scripts once
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Stub showLoading / showError so the view scripts can call them.
  (globalThis as Record<string, unknown>)['showLoading'] = vi.fn();
  (globalThis as Record<string, unknown>)['showError']   = vi.fn();

  // Stub Router.
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  // Stub API with sane defaults (individual tests override via mockResolvedValue).
  (globalThis as Record<string, unknown>)['API'] = {
    getKnowledge:     vi.fn().mockResolvedValue([]),
    updateKnowledge:  vi.fn().mockResolvedValue({}),
    deleteKnowledge:  vi.fn().mockResolvedValue(null),
    promoteKnowledge: vi.fn().mockResolvedValue({}),
    moveKnowledge:    vi.fn().mockResolvedValue({}),
  };

  // Load the view script after globals are installed.
  vm.runInThisContext(knowledgeJs);
});

// ---------------------------------------------------------------------------
// Helper: flush microtask queue so Promise callbacks resolve before asserts.
// ---------------------------------------------------------------------------

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadKnowledgeViewScript(): void {
  vm.runInThisContext(knowledgeJs);
}

// ---------------------------------------------------------------------------
// knowledge.js — project link generation
// ---------------------------------------------------------------------------

describe('knowledge.js — project link generation', () => {
  it('AC-2: renders a namespaced link when repository_name is non-null', async () => {
    const entry = {
      id: 1,
      title: 'Knowledge item',
      content: 'Some observation',
      scope: 'global',
      repository_name: 'my-repo',
      origin_plan: '2026-05-01-my-feature',
      created_at: '2026-05-01T10:00:00Z',
      updated_at: '2026-05-01T10:00:00Z',
      category: 'note',
      tags: [],
    };

    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([entry]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const link = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      '#/projects/my-repo/2026-05-01-my-feature'
    );
    expect(link!.textContent).toContain('2026-05-01-my-feature');
  });

  it('AC-3: renders plain text (no anchor) when repository_name is null', async () => {
    const entry = {
      id: 2,
      title: 'Legacy knowledge item',
      content: 'Some note',
      scope: 'global',
      repository_name: null,
      origin_plan: '2026-05-02-legacy-slug',
      created_at: '2026-05-02T10:00:00Z',
      updated_at: '2026-05-02T10:00:00Z',
      category: 'note',
      tags: [],
    };

    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([entry]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const link = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(link).toBeNull();
    expect(app.innerHTML).toContain('2026-05-02-legacy-slug');
  });

  it('AC-4: does not use bare-slug form (without repo) in the link href', async () => {
    const entry = {
      id: 3,
      title: 'Knowledge item',
      content: 'Decision made',
      scope: 'global',
      repository_name: 'workspace-a',
      origin_plan: '2026-05-03-some-project',
      created_at: '2026-05-03T10:00:00Z',
      updated_at: '2026-05-03T10:00:00Z',
      category: 'decision',
      tags: [],
    };

    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([entry]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const links = app.querySelectorAll('a[href]');
    links.forEach((l) => {
      const href = l.getAttribute('href') || '';
      if (href.startsWith('#/projects/')) {
        const segments = href.replace('#/projects/', '').split('/');
        expect(segments.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  it('URL-encodes repository_name and slug in the link href', async () => {
    const entry = {
      id: 4,
      title: 'Knowledge item',
      content: 'Test',
      scope: 'global',
      repository_name: 'my repo',
      origin_plan: '2026-05-04-special chars',
      created_at: '2026-05-04T10:00:00Z',
      updated_at: '2026-05-04T10:00:00Z',
      category: 'note',
      tags: [],
    };

    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([entry]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const link = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      '#/projects/my%20repo/2026-05-04-special%20chars'
    );
  });
});

// ---------------------------------------------------------------------------
// knowledge.js — origin-plan link generation
// ---------------------------------------------------------------------------

describe('knowledge.js — origin-plan link generation', () => {
  /**
   * Minimal knowledge insight with origin_plan and repository_name.
   * Defaults to `scope: 'global'` so it passes the default `activeTab='global'`
   * filter in renderKnowledge without needing to simulate a tab click.
   */
  function makeInsight(overrides: Record<string, unknown> = {}) {
    return {
      id:              1,
      scope:           'global',
      repository_name: 'some-repo',
      category:        'architecture',
      title:           'Test insight',
      content:         'Some content here',
      tags:            ['tag-a'],
      confidence:      0.9,
      source:          '',
      created_at:      '2026-05-01T00:00:00Z',
      updated_at:      '2026-05-01T00:00:00Z',
      superseded_by:   null,
      origin_plan:     '2026-05-01-origin-project',
      ...overrides,
    };
  }

  it('AC-2: renders a namespaced origin-plan link when repository_name is non-null', async () => {
    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([makeInsight()]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const originLink = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(originLink).not.toBeNull();
    expect(originLink!.getAttribute('href')).toBe(
      '#/projects/some-repo/2026-05-01-origin-project'
    );
    expect(originLink!.textContent).toContain('2026-05-01-origin-project');
  });

  it('AC-3: renders plain text span (no anchor) for origin_plan when repository_name is null', async () => {
    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([
      makeInsight({ repository_name: null }),
    ]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    // No anchor linking to a project path.
    const originLink = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(originLink).toBeNull();

    // The origin_plan text should still appear.
    expect(app.innerHTML).toContain('2026-05-01-origin-project');
    // And it should be wrapped in a span, not an anchor.
    expect(app.innerHTML).toContain('<span style="font-size:12px">Origin:');
  });

  it('AC-3: renders nothing for origin_plan when origin_plan itself is null/absent', async () => {
    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([
      makeInsight({ origin_plan: null }),
    ]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    // Should not render any origin text.
    expect(app.innerHTML).not.toContain('Origin:');
  });

  it('AC-4: does not use bare-slug form (without repo) in origin-plan link', async () => {
    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([makeInsight()]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const links = app.querySelectorAll('a[href]');
    links.forEach((l) => {
      const href = l.getAttribute('href') || '';
      if (href.startsWith('#/projects/')) {
        const segments = href.replace('#/projects/', '').split('/');
        expect(segments.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  it('URL-encodes repository_name and origin_plan in the link href', async () => {
    globalThis.API.getKnowledge = vi.fn().mockResolvedValue([
      makeInsight({
        repository_name: 'my workspace',
        origin_plan:     '2026-05-05-has spaces',
      }),
    ]);
    loadKnowledgeViewScript();

    const app = document.createElement('div');
    renderKnowledge(app);
    await flushPromises();

    const originLink = app.querySelector('a[href*="/projects/"]') as HTMLAnchorElement | null;
    expect(originLink).not.toBeNull();
    expect(originLink!.getAttribute('href')).toBe(
      '#/projects/my%20workspace/2026-05-05-has%20spaces'
    );
  });
});
