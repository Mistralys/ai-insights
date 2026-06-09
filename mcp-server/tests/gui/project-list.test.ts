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
 *
 * Repository label resolution (WP-010):
 *  6. Displays the declared label when folder_name matches a registry entry (AC-1)
 *  7. Label is a link pointing to #/strategy/:repoId (AC-1 extended)
 *  8. Displays the raw folder name when no registry entry matches (AC-2)
 *  9. Does not corrupt unmatched rows when a registry is present (AC-2)
 * 10. Shows the same label for projects from different folder_names of one declared repo (AC-3)
 * 11. Falls back to raw folder names when the repos endpoint fails (graceful degradation)
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
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
  // eslint-disable-next-line no-var
  var UI: { badge: (type: string, label: string) => string; banner: (type: string, message: string) => string; emptyState: (message: string) => string };
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

/**
 * Render the project-list view and wait for the async API calls to resolve.
 *
 * The view now performs two parallel fetches on every load:
 *  - GET /api/projects  → returns a projects envelope  (object with .projects array)
 *  - GET /api/repos     → returns a repos array        (used for label resolution)
 *
 * The fetch mock inspects the request URL to return the correct fixture for each
 * endpoint, keeping existing tests working while allowing repo-label tests to
 * inject registry data.
 *
 * @param projects  - Project rows to include in the envelope.
 * @param repos     - Optional declared-repository entries for label resolution.
 *                    Defaults to [] (no declared repositories → no label substitution).
 */
async function renderList(projects: object[], repos: object[] = []): Promise<HTMLElement> {
  const app = document.createElement('div');
  document.body.appendChild(app);

  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const isRepos = String(url).includes('/api/repos');
    return {
      ok: true,
      status: 200,
      json: async () => isRepos ? repos : makeEnvelope(projects),
    };
  });

  globalThis.renderProjectList(app);
  // Yield twice to let the microtask queue (Promise resolution) run for both fetches
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

// ---------------------------------------------------------------------------
// Tests 6–8 — Repository label resolution (WP-010)
// ---------------------------------------------------------------------------

/** A declared repository entry that maps two folder names to one label. */
const declaredRepo = {
  id: 'ai-insights',
  label: 'AI Insights',
  folder_names: ['ai-insights', 'ai-insights-dev'],
};

/**
 * A project whose repository_name matches the first folder_name of declaredRepo.
 * The "Repository" column should show "AI Insights" (the label), not "ai-insights".
 */
const projectMatchingFolder = {
  slug: '2026-05-label-plan',
  project_name: 'Label Plan',
  repository_name: 'ai-insights',
  status: 'IN_PROGRESS',
  runner: 'vscode',
  total_work_packages: 2,
  progress_pct: 50,
  date_created: '2026-05-01T00:00:00Z',
  last_updated: '2026-05-10T00:00:00Z',
};

/**
 * A second project whose repository_name matches the second folder_name of declaredRepo.
 * Should display the same label as projectMatchingFolder.
 */
const projectMatchingAltFolder = {
  slug: '2026-05-label-plan-dev',
  project_name: 'Label Plan Dev',
  repository_name: 'ai-insights-dev',
  status: 'READY',
  runner: 'vscode',
  total_work_packages: 1,
  progress_pct: 0,
  date_created: '2026-05-02T00:00:00Z',
  last_updated: '2026-05-11T00:00:00Z',
};

/**
 * A project whose repository_name does NOT match any declared repository.
 * The "Repository" column should display the raw folder name (no substitution).
 */
const projectUnregisteredFolder = {
  slug: '2026-05-unregistered',
  project_name: 'Unregistered Plan',
  repository_name: 'some-other-repo',
  status: 'READY',
  runner: 'vscode',
  total_work_packages: 0,
  progress_pct: 0,
  date_created: '2026-05-03T00:00:00Z',
  last_updated: '2026-05-12T00:00:00Z',
};

describe('buildTable — repository label resolution (WP-010)', () => {
  // AC-1: folder name that matches a declared repo → label replaces raw folder name
  it('displays the declared label when folder_name matches a registry entry', async () => {
    const app = await renderList([projectMatchingFolder], [declaredRepo]);

    const repoCells = app.querySelectorAll('td.repo-col');
    expect(repoCells.length).toBeGreaterThan(0);

    const repoCell = repoCells[0] as HTMLElement;
    expect(repoCell.textContent).toBe(declaredRepo.label);
    // Should NOT show the raw folder name as text
    expect(repoCell.textContent).not.toBe(projectMatchingFolder.repository_name);

    document.body.removeChild(app);
  });

  // AC-1 extended: label links to #/strategy/:repoId
  it('label is a link pointing to #/strategy/:repoId', async () => {
    const app = await renderList([projectMatchingFolder], [declaredRepo]);

    const repoCell = app.querySelector('td.repo-col') as HTMLElement;
    const link = repoCell.querySelector('a') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('#/strategy/' + encodeURIComponent(declaredRepo.id));

    document.body.removeChild(app);
  });

  // AC-2: folder name NOT in any declared repo → displays raw folder name (no regression)
  it('displays the raw folder name when no registry entry matches', async () => {
    const app = await renderList([projectUnregisteredFolder], [declaredRepo]);

    const repoCell = app.querySelector('td.repo-col') as HTMLElement;
    // No link — plain text with the raw folder name
    const link = repoCell.querySelector('a');
    expect(link).toBeNull();
    expect(repoCell.textContent).toBe(projectUnregisteredFolder.repository_name);

    document.body.removeChild(app);
  });

  // AC-2: unmatched project still shows raw folder name even when registry has entries
  it('does not corrupt unmatched rows when a registry is present', async () => {
    const app = await renderList(
      [projectMatchingFolder, projectUnregisteredFolder],
      [declaredRepo],
    );

    const repoCells = app.querySelectorAll('td.repo-col');
    expect(repoCells.length).toBe(2);

    // First row: matched → label
    expect(repoCells[0].textContent).toBe(declaredRepo.label);
    // Second row: unmatched → raw folder name
    expect(repoCells[1].textContent).toBe(projectUnregisteredFolder.repository_name);

    document.body.removeChild(app);
  });

  // AC-3: two projects from different folder_names of the SAME declared repo → same label
  it('shows the same label for projects from different folder_names of one declared repo', async () => {
    const app = await renderList(
      [projectMatchingFolder, projectMatchingAltFolder],
      [declaredRepo],
    );

    const repoCells = app.querySelectorAll('td.repo-col');
    expect(repoCells.length).toBe(2);

    // Both rows should display the same declared label
    expect(repoCells[0].textContent).toBe(declaredRepo.label);
    expect(repoCells[1].textContent).toBe(declaredRepo.label);

    document.body.removeChild(app);
  });

  // Graceful degradation: if listRepos fails, raw folder names are shown (no crash)
  it('falls back to raw folder names when the repos endpoint fails', async () => {
    const app = document.createElement('div');
    document.body.appendChild(app);

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/repos')) {
        // Simulate a network error for the repos endpoint
        throw new Error('Network error');
      }
      return {
        ok: true,
        status: 200,
        json: async () => makeEnvelope([projectMatchingFolder]),
      };
    });

    globalThis.renderProjectList(app);
    await new Promise(r => setTimeout(r, 20));

    const repoCell = app.querySelector('td.repo-col') as HTMLElement;
    // Should fall back to raw folder name, not crash
    expect(repoCell).not.toBeNull();
    expect(repoCell.textContent).toBe(projectMatchingFolder.repository_name);

    document.body.removeChild(app);
  });
});

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
