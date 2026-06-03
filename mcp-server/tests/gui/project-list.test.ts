// @vitest-environment jsdom

/**
 * jsdom unit tests for views/project-list.js — buildTable() rendering.
 *
 * Covers:
 *  1. Clickable link for projects that have a repository_name (AC-7)
 *  2. Read-only name cell for projects with null repository_name (AC-7)
 *  3. ProjectNameCache is populated with the composite key (AC-7)
 *  4. Action-menu wrapper carries data-repo and data-slug attributes (AC-7)
 *  5. Action-menu handler skips when data-repo is empty (AC-7)
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const utilsJs       = readFileSync(join(publicDir, 'utils.js'), 'utf-8');
const apiClientJs   = readFileSync(join(publicDir, 'api-client.js'), 'utf-8');
const projectListJs = readFileSync(join(publicDir, 'views/project-list.js'), 'utf-8');

// ---------------------------------------------------------------------------
// TypeScript declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var escapeHtml: (s: any) => string;
  // eslint-disable-next-line no-var
  var formatDate: (d: string) => string;
  // eslint-disable-next-line no-var
  var statusBadge: (s: string) => string;
  // eslint-disable-next-line no-var
  var showLoading: (el: HTMLElement) => void;
  // eslint-disable-next-line no-var
  var showError: (el: HTMLElement, msg: string) => void;
  // eslint-disable-next-line no-var
  var ProjectNameCache: {
    set: (key: string, name: string) => void;
    get: (key: string) => string | null;
    _size: () => number;
  };
  // eslint-disable-next-line no-var
  var makeProjectCacheKey: (repo: string, slug: string) => string;
  // eslint-disable-next-line no-var
  var renderProjectList: (app: HTMLElement) => void;
  // eslint-disable-next-line no-var
  var API: { [k: string]: (...a: any[]) => Promise<any> };
  // eslint-disable-next-line no-var
  var Router: { _setPolling: (fn: () => void, ms: number) => void };
}

// ---------------------------------------------------------------------------
// Setup — load scripts into jsdom globalThis once before all tests
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory localStorage stub for the Node/vm context.
 *
 * project-list.js accesses `localStorage` as a bare global name.  Inside
 * `vm.runInThisContext` the lookup resolves against the Node global object, not
 * the jsdom window — so `window.localStorage` is invisible.  We install a
 * lightweight stub directly on `global` so the script can read and write
 * without throwing.
 */
function makeLocalStorageStub() {
  const store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { for (const k in store) delete store[k]; },
  };
}

beforeAll(() => {
  // Minimal stubs required by project-list.js at parse/call time.
  (globalThis as any).showLoading    = (el: HTMLElement) => { el.innerHTML = '<div class="loading">Loading…</div>'; };
  (globalThis as any).showError      = (el: HTMLElement, msg: string) => { el.innerHTML = '<div class="error">' + msg + '</div>'; };
  (globalThis as any).statusBadge    = (s: string) => '<span class="badge">' + (s || '') + '</span>';
  (globalThis as any).formatDate     = (_d: string) => '—';
  (globalThis as any).Router         = { _setPolling: vi.fn() };

  // Provide a localStorage stub visible to vm.runInThisContext (see JSDoc above).
  (global as any).localStorage = makeLocalStorageStub();

  // Load scripts in dependency order: utils first (defines escapeHtml, ProjectNameCache,
  // makeProjectCacheKey), then api-client (defines API), then project-list (defines
  // renderProjectList and the private buildTable / event wiring).
  vm.runInThisContext(utilsJs);
  vm.runInThisContext(apiClientJs);
  vm.runInThisContext(projectListJs);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal project envelope returned by API.getProjects.
 *
 * Required fields (consumed by buildTable / renderProjectList):
 *   - projects      — array of project objects to render
 *   - page          — current page number (used for pagination controls)
 *   - total_pages   — total page count (used for pagination controls)
 *   - total         — total project count
 *   - limit         — page size
 *   - status_counts — map of status → count (used for filter badges; {} is valid)
 *   - runner_counts — map of runner → count (used for filter badges; {} is valid)
 *
 * All other envelope fields are optional for test purposes.
 */
function makeEnvelope(projects: object[]) {
  return {
    projects,
    page: 1,
    total_pages: 1,
    total: projects.length,
    limit: 50,
    status_counts: {},
    runner_counts: {},
  };
}

/** Render the project-list view and wait for the async API call to resolve. */
async function renderList(projects: object[]): Promise<HTMLElement> {
  const app = document.createElement('div');
  document.body.appendChild(app);

  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => makeEnvelope(projects),
  }));

  globalThis.renderProjectList(app);
  // Yield once to let the microtask queue (Promise resolution) run
  await new Promise(r => setTimeout(r, 20));

  return app;
}

/** Minimal project fixture with a repository_name. */
const projectWithRepo = {
  slug: '2026-05-my-plan',
  project_name: 'My Plan',
  repository_name: 'ai-insights',
  status: 'IN_PROGRESS',
  runner: 'vscode',
  total_work_packages: 4,
  progress_pct: 50,
  date_created: '2026-05-01T00:00:00Z',
  last_updated: '2026-05-10T00:00:00Z',
};

/** Minimal project fixture WITHOUT a repository_name. */
const projectWithoutRepo = {
  slug: 'orphan-plan',
  project_name: 'Orphan Plan',
  repository_name: null,
  status: 'READY',
  runner: 'unknown',
  total_work_packages: 0,
  progress_pct: 0,
  date_created: '2026-05-01T00:00:00Z',
  last_updated: '2026-05-10T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Test 1 — Clickable link for projects that have a repository_name
// ---------------------------------------------------------------------------

describe('buildTable — project with repository_name renders a clickable link', () => {
  it('renders an <a> tag with the correct href', async () => {
    const app = await renderList([projectWithRepo]);

    const link = app.querySelector('a[href]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toContain(encodeURIComponent(projectWithRepo.repository_name));
    expect(link!.href).toContain(encodeURIComponent(projectWithRepo.slug));

    document.body.removeChild(app);
  });

  it('link text is the project_name (not the raw slug)', async () => {
    const app = await renderList([projectWithRepo]);

    const link = app.querySelector('a[href]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe(projectWithRepo.project_name);

    document.body.removeChild(app);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Read-only name cell for null repository_name
// ---------------------------------------------------------------------------

describe('buildTable — project without repository_name renders read-only cell', () => {
  it('does NOT render an <a> link for the project name', async () => {
    const app = await renderList([projectWithoutRepo]);

    const tbody = app.querySelector('#projects-tbody');
    expect(tbody).not.toBeNull();

    // The first <td> in the row should contain plain text, not an anchor
    const firstCell = tbody!.querySelector('tr > td:first-child');
    expect(firstCell).not.toBeNull();
    expect(firstCell!.querySelector('a')).toBeNull();
    expect(firstCell!.textContent).toContain(projectWithoutRepo.project_name);

    document.body.removeChild(app);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — ProjectNameCache populated with composite key
// ---------------------------------------------------------------------------

describe('buildTable — ProjectNameCache is populated for projects with repository_name', () => {
  it('stores the project name under the repo/slug composite key', async () => {
    const app = await renderList([projectWithRepo]);

    const expectedKey = globalThis.makeProjectCacheKey(
      projectWithRepo.repository_name,
      projectWithRepo.slug,
    );
    const cached = globalThis.ProjectNameCache.get(expectedKey);
    expect(cached).toBe(projectWithRepo.project_name);

    document.body.removeChild(app);
  });

  it('does NOT store an entry for null-repo projects', async () => {
    // Record size before
    const sizeBefore = globalThis.ProjectNameCache._size();

    const app = await renderList([projectWithoutRepo]);

    // Size must not have grown due to the null-repo project
    expect(globalThis.ProjectNameCache._size()).toBe(sizeBefore);

    document.body.removeChild(app);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Action-menu wrapper carries data-repo and data-slug attributes
// ---------------------------------------------------------------------------

describe('buildTable — action-menu-wrapper attributes', () => {
  it('carries data-repo and data-slug for a project with a repository', async () => {
    const app = await renderList([projectWithRepo]);

    const wrapper = app.querySelector('.action-menu-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute('data-repo')).toBe(projectWithRepo.repository_name);
    expect(wrapper!.getAttribute('data-slug')).toBe(projectWithRepo.slug);

    document.body.removeChild(app);
  });

  it('carries an empty string data-repo for a null-repo project', async () => {
    const app = await renderList([projectWithoutRepo]);

    const wrapper = app.querySelector('.action-menu-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Null repo is serialised as '' in the data-repo attribute.
    // project-list.js line 166 writes: escapeHtml(repo || ''), so a null
    // repository_name becomes an empty string in the DOM.
    expect(wrapper!.getAttribute('data-repo')).toBe('');
    expect(wrapper!.getAttribute('data-slug')).toBe(projectWithoutRepo.slug);

    document.body.removeChild(app);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Action handler skips when data-repo is empty
// ---------------------------------------------------------------------------

describe('action-menu portal handler — skips when data-repo is empty', () => {
  it('logs an error and does NOT call API.deleteProject for null-repo projects', async () => {
    const app = await renderList([projectWithoutRepo]);

    // Spy on the error that the handler emits
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Spy on API.deleteProject to verify it is NOT called
    const deleteSpy = vi.spyOn(globalThis.API, 'deleteProject');

    // Locate the action-menu portal (created once by renderProjectList)
    const portal = document.getElementById('action-menu-portal') as HTMLElement | null;
    expect(portal).not.toBeNull();

    // Synthesise a portal click event for a delete action with an empty repo
    const btn = document.createElement('button');
    btn.setAttribute('data-portal-action', 'delete');
    btn.setAttribute('data-slug', projectWithoutRepo.slug);
    btn.setAttribute('data-repo', '');
    portal!.appendChild(btn);

    btn.click();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped'),
    );
    expect(deleteSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    deleteSpy.mockRestore();
    document.body.removeChild(app);
  });
});
