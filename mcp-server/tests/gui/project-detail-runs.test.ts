// @vitest-environment jsdom

/**
 * Tests for the "Orchestrator Runs" section of views/project-detail.js.
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API and globalThis.marked to exercise the
 * renderProjectDetail paths related to orchestrator run logs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const utilsJs         = readFileSync(join(publicDir, 'utils.js'),                   'utf-8');
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'),    'utf-8');

beforeAll(() => {
  // Install stub globals needed by project-detail.js before it is evaluated
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };

  vm.runInThisContext(utilsJs);
  vm.runInThisContext(projectDetailJs);
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderProjectDetail: (app: HTMLElement, slug: string) => void;
  // eslint-disable-next-line no-var
  var API: Record<string, (...args: unknown[]) => Promise<unknown>>;
  // eslint-disable-next-line no-var
  var marked: { parse: (s: string) => string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid project response from API.getProject */
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      status: 'IN_PROGRESS',
      runner: overrides.runner as string | undefined,
      title: 'Test Project',
      plan_path: '/some/path',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-01T00:00:00Z',
      ...overrides,
    },
    work_packages: [],
    project_comments: [],
    project_name: 'Test Project',
    timing: null,
    server_version: null,
    ledger_version: null,
    synthesis_generated: false,
  };
}

/**
 * Installs a globalThis.API stub and calls renderProjectDetail.
 * Returns a promise that resolves once the initial synchronous render
 * AND any microtasks (promise resolutions) have settled.
 */
async function renderWithAPI(
  app: HTMLElement,
  slug: string,
  apiStubs: {
    getProject?: () => Promise<unknown>;
    getPlanDocument?: () => Promise<unknown>;
    getWorkPackageOverview?: () => Promise<unknown>;
    getProjectHealth?: () => Promise<unknown>;
    getRunLogs?: () => Promise<unknown>;
  }
) {
  (globalThis as Record<string, unknown>)['API'] = {
    getProject:           apiStubs.getProject           ?? (() => Promise.resolve(makeProject())),
    getPlanDocument:      apiStubs.getPlanDocument       ?? (() => Promise.reject({ code: 'NOT_FOUND' })),
    getWorkPackageOverview: apiStubs.getWorkPackageOverview ?? (() => Promise.resolve(null)),
    getProjectHealth:     apiStubs.getProjectHealth      ?? (() => Promise.resolve({ work_packages_needing_reset: 0 })),
    getRunLogs:           apiStubs.getRunLogs            ?? (() => Promise.resolve([])),
  };

  globalThis.renderProjectDetail(app, slug);

  // Poll until #orchestrator-runs-section stops showing the loading placeholder,
  // or until we give up (200ms). This handles the multi-level promise chain:
  //   Promise.all → .then() sets innerHTML → getRunLogs() → .then() updates section.
  const start = Date.now();
  while (Date.now() - start < 200) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const el = app.querySelector('#orchestrator-runs-section');
    if (!el || !el.innerHTML.includes('Loading runs')) break;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderProjectDetail — Orchestrator Runs section', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  // ── Guard clause ──────────────────────────────────────────────────────────

  it('does not render "Orchestrator Runs" section when runner is not orchestrator', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'vscode' })),
    });

    expect(app.innerHTML).not.toContain('Orchestrator Runs');
    expect(app.querySelector('#orchestrator-runs-section')).toBeNull();
  });

  it('does not render "Orchestrator Runs" section when runner is undefined', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({})), // no runner field
    });

    expect(app.innerHTML).not.toContain('Orchestrator Runs');
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('shows empty-state message when runner is orchestrator and getRunLogs returns []', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve([]),
    });

    expect(app.innerHTML).toContain('Orchestrator Runs');
    expect(app.innerHTML).toContain('No orchestrator run logs found');
  });

  // ── Populated state ───────────────────────────────────────────────────────

  it('renders each log entry with filename, run-event class, and working href', async () => {
    const logs = [
      '20260225T113355-my-project.jsonl',
      '20260226T080000-my-project.jsonl',
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(app.innerHTML).toContain('Orchestrator Runs');

    // Both filenames appear
    expect(app.innerHTML).toContain('20260225T113355-my-project.jsonl');
    expect(app.innerHTML).toContain('20260226T080000-my-project.jsonl');

    // Run event styling applied
    expect(app.innerHTML).toContain('run-event');

    // Links to the correct route
    expect(app.innerHTML).toContain(
      '#/projects/my-project/runs/' + encodeURIComponent(logs[0]!)
    );
    expect(app.innerHTML).toContain(
      '#/projects/my-project/runs/' + encodeURIComponent(logs[1]!)
    );
  });

  it('encodes the slug in the run href', async () => {
    await renderWithAPI(app, 'slug/with/slashes', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(['20260225T113355-some-project.jsonl']),
    });

    expect(app.innerHTML).toContain(encodeURIComponent('slug/with/slashes'));
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('shows an error message on getRunLogs failure without crashing', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.reject({ message: 'Network error', code: 'ERROR' }),
    });

    // Section container is present (from the synchronous render)
    expect(app.querySelector('#orchestrator-runs-section')).not.toBeNull();

    // Error message displayed
    expect(app.innerHTML).toContain('Failed to load orchestrator runs');
    expect(app.innerHTML).toContain('Network error');

    // Page still rendered (Work Packages section present)
    expect(app.innerHTML).toContain('Work Packages');
  });

  it('handles null error objects gracefully', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.reject(null),
    });

    // Should not throw; error banner present
    expect(app.innerHTML).toContain('Failed to load orchestrator runs');
  });

  // ── Existing content unaffected ───────────────────────────────────────────

  it('existing page content (WPs, comments, breadcrumb) is unaffected when runner is orchestrator', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve([]),
    });

    expect(app.innerHTML).toContain('Work Packages');
    expect(app.innerHTML).toContain('Project Comments');
    // Breadcrumb
    expect(app.innerHTML).toContain('Projects');
  });
});
