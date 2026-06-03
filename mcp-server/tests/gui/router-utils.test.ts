// @vitest-environment jsdom

/**
 * Unit tests for gui/public/router.js and gui/public/utils.js
 *
 * WP-008: Router & Breadcrumb Namespace Migration
 *
 * Verifies that:
 *  - The hash router dispatches all five project route patterns using the
 *    two-segment `#/projects/:repo/:slug/...` form.
 *  - Each dispatch call passes `(app, repo, slug, ...)` arguments to the
 *    corresponding view render function.
 *  - No legacy single-segment `#/projects/:slug` pattern still matches.
 *  - `breadcrumb().project(repo, slug)` generates `#/projects/{repo}/{slug}` links.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load source files
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const utilsJs   = readFileSync(join(publicDir, 'utils.js'),   'utf-8');
const routerJs  = readFileSync(join(publicDir, 'router.js'),  'utf-8');

// TypeScript declarations for globals injected by the scripts
declare global {
  // eslint-disable-next-line no-var
  var Router: { navigate: (hash: string) => void; init: () => void };
  // eslint-disable-next-line no-var
  var breadcrumb: () => {
    projects: () => ReturnType<typeof breadcrumb>;
    project: (repo: string, slug: string) => ReturnType<typeof breadcrumb>;
    leaf: (label: string) => ReturnType<typeof breadcrumb>;
    html: () => string;
  };
  // eslint-disable-next-line no-var
  var escapeHtml: (str: unknown) => string;
  // eslint-disable-next-line no-var
  var renderProjectList: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderProjectDetail: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderPlan: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderSynthesis: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderWorkPackageDetail: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderRunLog: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderConfig: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderInsights: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderKnowledge: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var renderOrchestrator: (...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Setup: DOM + stub view functions + load scripts
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset DOM — start at the root hash so Router.init() dispatches to renderProjectList
  document.body.innerHTML = '<header><nav></nav></header><div id="app"></div>';
  window.location.hash = '';

  // Stub all view render functions so the router can call them without errors
  globalThis.renderProjectList      = vi.fn();
  globalThis.renderProjectDetail    = vi.fn();
  globalThis.renderPlan             = vi.fn();
  globalThis.renderSynthesis        = vi.fn();
  globalThis.renderWorkPackageDetail = vi.fn();
  globalThis.renderRunLog           = vi.fn();
  globalThis.renderConfig           = vi.fn();
  globalThis.renderInsights         = vi.fn();
  globalThis.renderKnowledge        = vi.fn();
  globalThis.renderOrchestrator     = vi.fn();

  // Load utils first (breadcrumb, escapeHtml) then router
  vm.runInThisContext(utilsJs);
  vm.runInThisContext(routerJs);

  // Init the router (registers hashchange listener + dispatches current hash)
  globalThis.Router.init();

  // Reset all mocks after init so test assertions start from a clean slate
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: dispatch a hash directly via window.location.hash
// ---------------------------------------------------------------------------

function dispatchHash(hash: string): void {
  // Router.dispatch is internal; trigger via hashchange event
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange', {
    oldURL: window.location.href,
    newURL: window.location.href,
  }));
}

// ---------------------------------------------------------------------------
// Router dispatch — five namespaced project route patterns
// ---------------------------------------------------------------------------

describe('Router — project detail route (#/projects/:repo/:slug)', () => {
  it('dispatches to renderProjectDetail with (app, repo, slug)', () => {
    dispatchHash('#/projects/my-repo/2026-05-01-feat');
    const lastCall = (globalThis.renderProjectDetail as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[0]).toBe(document.getElementById('app'));
    expect(lastCall[1]).toBe('my-repo');
    expect(lastCall[2]).toBe('2026-05-01-feat');
  });

  it('URL-decodes repo and slug', () => {
    dispatchHash('#/projects/my%20repo/2026-05-01-feat');
    const lastCall = (globalThis.renderProjectDetail as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[1]).toBe('my repo');
  });
});

describe('Router — plan route (#/projects/:repo/:slug/plan)', () => {
  it('dispatches to renderPlan with (app, repo, slug)', () => {
    dispatchHash('#/projects/ai-insights/2026-01-01-feature/plan');
    const lastCall = (globalThis.renderPlan as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[0]).toBe(document.getElementById('app'));
    expect(lastCall[1]).toBe('ai-insights');
    expect(lastCall[2]).toBe('2026-01-01-feature');
  });
});

describe('Router — synthesis route (#/projects/:repo/:slug/synthesis)', () => {
  it('dispatches to renderSynthesis with (app, repo, slug)', () => {
    dispatchHash('#/projects/acme/2026-03-15-search/synthesis');
    const lastCall = (globalThis.renderSynthesis as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[0]).toBe(document.getElementById('app'));
    expect(lastCall[1]).toBe('acme');
    expect(lastCall[2]).toBe('2026-03-15-search');
  });
});

describe('Router — work-package route (#/projects/:repo/:slug/wp/:wpId)', () => {
  it('dispatches to renderWorkPackageDetail with (app, repo, slug, wpId)', () => {
    dispatchHash('#/projects/my-repo/2026-06-01-xyz/wp/WP-042');
    const lastCall = (globalThis.renderWorkPackageDetail as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[0]).toBe(document.getElementById('app'));
    expect(lastCall[1]).toBe('my-repo');
    expect(lastCall[2]).toBe('2026-06-01-xyz');
    expect(lastCall[3]).toBe('WP-042');
  });
});

describe('Router — run log route (#/projects/:repo/:slug/runs/:filename)', () => {
  it('dispatches to renderRunLog with (app, repo, slug, filename)', () => {
    dispatchHash('#/projects/my-repo/2026-06-01-xyz/runs/run-2026-06-01.jsonl');
    const lastCall = (globalThis.renderRunLog as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(lastCall[0]).toBe(document.getElementById('app'));
    expect(lastCall[1]).toBe('my-repo');
    expect(lastCall[2]).toBe('2026-06-01-xyz');
    expect(lastCall[3]).toBe('run-2026-06-01.jsonl');
  });
});

// ---------------------------------------------------------------------------
// Router — legacy single-segment patterns must NOT match
// ---------------------------------------------------------------------------

describe('Router — legacy bare-slug patterns no longer match', () => {
  it('#/projects/:slug does not dispatch to renderProjectDetail', () => {
    // Legacy form: only one segment after /projects/
    // The new regex requires two segments, so this should fall through to "not found"
    dispatchHash('#/projects/2026-05-01-feat');
    // renderProjectDetail should NOT be called (only one segment = no repo)
    expect(globalThis.renderProjectDetail).not.toHaveBeenCalled();
  });

  it('#/projects/:slug/plan does not dispatch to renderPlan', () => {
    dispatchHash('#/projects/2026-01-01-feature/plan');
    expect(globalThis.renderPlan).not.toHaveBeenCalled();
  });

  it('#/projects/:slug/synthesis does not dispatch to renderSynthesis', () => {
    dispatchHash('#/projects/2026-03-15-search/synthesis');
    expect(globalThis.renderSynthesis).not.toHaveBeenCalled();
  });

  it('#/projects/:slug/wp/:wpId does not dispatch to renderWorkPackageDetail', () => {
    dispatchHash('#/projects/2026-06-01-xyz/wp/WP-042');
    expect(globalThis.renderWorkPackageDetail).not.toHaveBeenCalled();
  });

  it('#/projects/:slug/runs/:filename does not dispatch to renderRunLog', () => {
    dispatchHash('#/projects/2026-06-01-xyz/runs/run.jsonl');
    expect(globalThis.renderRunLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Router — singleton routes still work
// ---------------------------------------------------------------------------

describe('Router — singleton routes', () => {
  it('dispatches #/ to renderProjectList', () => {
    dispatchHash('#/');
    expect(globalThis.renderProjectList).toHaveBeenCalled();
  });

  it('dispatches #/config to renderConfig', () => {
    dispatchHash('#/config');
    expect(globalThis.renderConfig).toHaveBeenCalled();
  });

  it('dispatches #/insights to renderInsights', () => {
    dispatchHash('#/insights');
    expect(globalThis.renderInsights).toHaveBeenCalled();
  });

  it('dispatches #/knowledge to renderKnowledge', () => {
    dispatchHash('#/knowledge');
    expect(globalThis.renderKnowledge).toHaveBeenCalled();
  });

  it('dispatches #/orchestrator to renderOrchestrator', () => {
    dispatchHash('#/orchestrator');
    expect(globalThis.renderOrchestrator).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// breadcrumb().project(repo, slug) — generates namespaced links
// ---------------------------------------------------------------------------

describe('breadcrumb().project(repo, slug)', () => {
  it('generates a link to #/projects/{repo}/{slug}', () => {
    const html = globalThis.breadcrumb().project('my-repo', '2026-05-01-feat').html();
    expect(html).toContain('href="#/projects/my-repo/2026-05-01-feat"');
  });

  it('URL-encodes repo and slug in the href', () => {
    const html = globalThis.breadcrumb().project('my repo', 'feat with spaces').html();
    expect(html).toContain('href="#/projects/my%20repo/feat%20with%20spaces"');
  });

  it('uses the slug as the label when no cache entry exists', () => {
    const html = globalThis.breadcrumb().project('my-repo', '2026-05-01-feat').html();
    expect(html).toContain('>2026-05-01-feat<');
  });

  it('renders a full projects → project breadcrumb chain', () => {
    const html = globalThis.breadcrumb()
      .projects()
      .project('acme', '2026-06-01-xyz')
      .html();
    expect(html).toContain('href="#/"');
    expect(html).toContain('href="#/projects/acme/2026-06-01-xyz"');
  });

  it('generates different hrefs for same slug in different repos', () => {
    const html1 = globalThis.breadcrumb().project('repo-a', 'my-plan').html();
    const html2 = globalThis.breadcrumb().project('repo-b', 'my-plan').html();
    expect(html1).toContain('#/projects/repo-a/my-plan');
    expect(html2).toContain('#/projects/repo-b/my-plan');
    expect(html1).not.toEqual(html2);
  });
});
