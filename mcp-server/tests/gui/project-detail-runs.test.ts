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

  // ── Hidden by default ─────────────────────────────────────────────────────

  it('keeps "Orchestrator Runs" wrapper hidden when getRunLogs returns [] (vscode runner)', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'vscode' })),
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('none');
  });

  it('keeps "Orchestrator Runs" wrapper hidden when runner is undefined and no logs', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({})), // no runner field
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('none');
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('keeps wrapper hidden when getRunLogs returns empty array', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('none');
  });

  // ── Populated state ───────────────────────────────────────────────────────

  it('renders each log entry with run number, date, and working href', async () => {
    const logs = [
      { filename: '20260225T113355-my-project.jsonl', is_active: false },
      { filename: '20260226T080000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    // Wrapper becomes visible when logs exist
    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('');

    // Run numbers appear
    expect(app.innerHTML).toContain('Run #1');
    expect(app.innerHTML).toContain('Run #2');

    // Raw slug/filename not shown as visible label text
    const runItems = app.querySelectorAll('#orchestrator-runs-section .run-event span[style*="font-size:13px"]');
    runItems.forEach((el) => expect(el.textContent).not.toContain('.jsonl'));

    // Run event styling applied
    expect(app.innerHTML).toContain('run-event');

    // Links to the correct route (href still uses the full filename)
    expect(app.innerHTML).toContain(
      '#/projects/my-project/runs/' + encodeURIComponent(logs[0]!.filename)
    );
    expect(app.innerHTML).toContain(
      '#/projects/my-project/runs/' + encodeURIComponent(logs[1]!.filename)
    );
  });

  it('encodes the slug in the run href', async () => {
    await renderWithAPI(app, 'slug/with/slashes', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve([{ filename: '20260225T113355-some-project.jsonl', is_active: false }]),
    });

    expect(app.innerHTML).toContain(encodeURIComponent('slug/with/slashes'));
  });

  it('shows logs for non-orchestrator runner when log files exist', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'vscode' })),
      getRunLogs: () => Promise.resolve([{ filename: '20260225T113355-my-project.jsonl', is_active: false }]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('');
    expect(app.innerHTML).toContain('Run #1');
  });

  it('numbers runs chronologically — newest run gets the highest number', async () => {
    const logs = [
      { filename: '20260323T100000-my-project.jsonl', is_active: false }, // oldest → #1
      { filename: '20260325T090000-my-project.jsonl', is_active: false }, // newest → #3
      { filename: '20260324T120000-my-project.jsonl', is_active: false }, // middle → #2
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    const section = app.querySelector('#orchestrator-runs-section')!;
    const html = section.innerHTML;
    // Sorted descending: #3 first, then #2, then #1
    expect(html.indexOf('Run #3')).toBeLessThan(html.indexOf('Run #2'));
    expect(html.indexOf('Run #2')).toBeLessThan(html.indexOf('Run #1'));
    // Timestamps also appear newest-first
    expect(html.indexOf('20260325')).toBeLessThan(html.indexOf('20260324'));
    expect(html.indexOf('20260324')).toBeLessThan(html.indexOf('20260323'));
  });

  it('shows a Running badge for an active run', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: true },
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(app.innerHTML).toContain('Running');
    expect(app.innerHTML).toContain('badge-in-progress');
  });

  it('does not show a Running badge for a completed run', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    // Scope check to the runs section — the project status badge also uses badge-in-progress
    const section = app.querySelector('#orchestrator-runs-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).not.toContain('badge-in-progress');
  });

  it('only shows Running badge on the most-recent run even if older runs have is_active: true', async () => {
    // Simulates runs that were killed without writing run_end — they appear active
    // in the file, but only the newest one can truly be running.
    const logs = [
      { filename: '20260323T100000-my-project.jsonl', is_active: true }, // old, interrupted
      { filename: '20260325T090000-my-project.jsonl', is_active: true }, // newest, genuinely active
      { filename: '20260324T120000-my-project.jsonl', is_active: true }, // middle, interrupted
    ];

    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.resolve(logs),
    });

    const section = app.querySelector('#orchestrator-runs-section')!;
    const badges = section.querySelectorAll('.badge-in-progress');
    expect(badges).toHaveLength(1);
    // The badge should be in the first rendered item (newest run = Run #3)
    const firstItem = section.querySelector('.run-event');
    expect(firstItem!.innerHTML).toContain('badge-in-progress');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('keeps wrapper hidden on getRunLogs failure without crashing', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.reject({ message: 'Network error', code: 'ERROR' }),
    });

    // Wrapper stays hidden on error (silent failure)
    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('none');

    // Page still rendered (Work Packages section present)
    expect(app.innerHTML).toContain('Work Packages');
  });

  it('handles null error objects gracefully', async () => {
    await renderWithAPI(app, 'my-project', {
      getProject: () => Promise.resolve(makeProject({ runner: 'orchestrator' })),
      getRunLogs: () => Promise.reject(null),
    });

    // Should not throw; wrapper stays hidden
    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).toBe('none');
  });

  // ── Existing content unaffected ───────────────────────────────────────────

  it('existing page content (WPs, comments, breadcrumb) is unaffected', async () => {
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
