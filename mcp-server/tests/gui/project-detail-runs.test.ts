// @vitest-environment jsdom

/**
 * Tests for the "Orchestrator Runs" section of views/project-detail.js.
 *
 * Covers:
 *   - Orchestrator Runs section — run list rendering, badges, error handling
 *   - Queue-aware active run (WP-013 AC-1 to AC-5)
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API and globalThis.marked to exercise the
 * renderProjectDetail paths related to orchestrator run logs.
 *
 * Note: Resume-related tests live in project-detail-resume.test.ts.
 * Polling-mode tests live in project-detail-poll-modes.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { makeProject } from './helpers/make-project.js';
import { createApiStubs, type ProjectDetailApiStubs } from './helpers/api-stubs.js';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'),    'utf-8');
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'), 'utf-8');
const projectDetailOrchJs = readFileSync(join(publicDir, 'views/project-detail-orch.js'), 'utf-8');
const projectDetailModalJs = readFileSync(join(publicDir, 'views/project-detail-modal.js'), 'utf-8');

beforeAll(() => {
  // Install stub globals needed by project-detail.js before it is evaluated
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };

  // OrchestratorWidgets stub — used by the queue-aware active run section (WP-013).
  (globalThis as Record<string, unknown>)['OrchestratorWidgets'] = {
    renderStatusCard:    vi.fn().mockReturnValue('<div class="orchestrator-status-card">card</div>'),
    renderKillButton:    vi.fn().mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    }),
    renderDismissButton: vi.fn(),
    renderLogPreview:    vi.fn().mockReturnValue(vi.fn()), // returns a cleanup stub
    renderProgressBadge: vi.fn().mockReturnValue(''),
    renderCliReference:  vi.fn().mockReturnValue(''),
  };

  // Router stub — used by Router._setPolling() in the active run section.
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  vm.runInThisContext(projectDetailHelpersJs);
  vm.runInThisContext(projectDetailOrchJs);
  vm.runInThisContext(projectDetailModalJs);
  vm.runInThisContext(projectDetailJs);
});

// Reset OrchestratorWidgets and Router mocks between tests.
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.OrchestratorWidgets.renderStatusCard
    .mockReturnValue('<div class="orchestrator-status-card">card</div>');
  globalThis.OrchestratorWidgets.renderKillButton
    .mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    });
  globalThis.OrchestratorWidgets.renderLogPreview.mockReturnValue(vi.fn());
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderProjectDetail: (app: HTMLElement, repo: string, slug: string) => void;
  // eslint-disable-next-line no-var
  var _pollProjectDetail: (
    app: HTMLElement,
    repo: string,
    slug: string,
    pollStateRef: unknown[],
    pollController: Record<string, unknown>
  ) => void;
  // eslint-disable-next-line no-var
  var _snapshotProjectState: (
    project: Record<string, unknown>,
    overviewResult: unknown[] | null
  ) => {
    status: string;
    last_updated: string;
    synthesis_generated: boolean;
    wpStatuses: Record<string, { status: string; pipelineStages: unknown[] }>;
    health: null | { work_packages_needing_reset: number };
  };
  // eslint-disable-next-line no-var
  var API: Record<string, Mock | ((...args: unknown[]) => Promise<unknown>)>;
  // eslint-disable-next-line no-var
  var marked: { parse: (s: string) => string };
  // eslint-disable-next-line no-var
  var OrchestratorWidgets: {
    renderStatusCard:    Mock;
    renderKillButton:    Mock;
    renderDismissButton: Mock;
    renderLogPreview:    Mock;
    renderProgressBadge: Mock;
    renderCliReference:  Mock;
  };
  // eslint-disable-next-line no-var
  var Router: {
    _setPolling:   Mock;
    _clearPolling: Mock;
  };
  // eslint-disable-next-line no-var
  var UI: { badge: (type: string, label: string) => string; banner: (type: string, message: string) => string; emptyState: (message: string) => string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Installs a globalThis.API stub and calls renderProjectDetail.
 * Returns a promise that resolves once the initial synchronous render
 * AND any microtasks (promise resolutions) have settled.
 *
 * Stub keys are defined in `helpers/api-stubs.ts` — see `ProjectDetailApiStubs`.
 */
async function renderWithAPI(
  app: HTMLElement,
  repo: string,
  slug: string,
  apiStubs: Partial<ProjectDetailApiStubs> = {}
) {
  (globalThis as Record<string, unknown>)['API'] = createApiStubs(apiStubs);

  globalThis.renderProjectDetail(app, repo, slug);

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

  // ── Empty runs — wrapper always visible, runs section cleared ───────────────

  it('keeps runs section empty when getRunLogs returns [] (vscode runner)', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'vscode' } })),
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Wrapper is always visible; no logs → runs section is cleared
    expect(wrapper!.style.display).not.toBe('none');
    const runsSection = app.querySelector('#orchestrator-runs-section') as HTMLElement | null;
    expect(runsSection).not.toBeNull();
    expect(runsSection!.innerHTML).toBe('');
  });

  it('keeps runs section empty when runner is undefined and no logs', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject()), // no runner field
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).not.toBe('none');
    const runsSection = app.querySelector('#orchestrator-runs-section') as HTMLElement | null;
    expect(runsSection!.innerHTML).toBe('');
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('keeps runs section empty when getRunLogs returns empty array', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve([]),
    });

    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).not.toBe('none');
    const runsSection = app.querySelector('#orchestrator-runs-section') as HTMLElement | null;
    expect(runsSection!.innerHTML).toBe('');
  });

  // ── Populated state ───────────────────────────────────────────────────────

  it('renders each log entry with run number, date, and working href', async () => {
    const logs = [
      { filename: '20260225T113355-my-project.jsonl', is_active: false },
      { filename: '20260226T080000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
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

    // Links to the correct namespaced route (href uses repo/slug/runs/filename)
    expect(app.innerHTML).toContain(
      '#/projects/my-repo/my-project/runs/' + encodeURIComponent(logs[0]!.filename)
    );
    expect(app.innerHTML).toContain(
      '#/projects/my-repo/my-project/runs/' + encodeURIComponent(logs[1]!.filename)
    );
  });

  it('encodes the slug in the run href', async () => {
    await renderWithAPI(app, 'repo/with/slashes', 'slug/with/slashes', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve([{ filename: '20260225T113355-some-project.jsonl', is_active: false }]),
    });

    expect(app.innerHTML).toContain(encodeURIComponent('repo/with/slashes'));
    expect(app.innerHTML).toContain(encodeURIComponent('slug/with/slashes'));
  });

  it('shows logs for non-orchestrator runner when log files exist', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'vscode' } })),
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

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
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

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(app.innerHTML).toContain('Running');
    expect(app.innerHTML).toContain('badge-in-progress');
  });

  it('does not show a Running badge for a completed run', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve(logs),
    });

    // Scope check to the runs section — the project status badge also uses badge-in-progress
    const section = app.querySelector('#orchestrator-runs-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).not.toContain('badge-in-progress');
  });

  it('shows a Dry Run badge for a run with is_dry_run: true', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: false, is_dry_run: true },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve(logs),
    });

    const section = app.querySelector('#orchestrator-runs-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).toContain('Dry Run');
    expect(section!.innerHTML).toContain('badge-dry-run');
  });

  it('does not show a Dry Run badge when is_dry_run is false', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: false, is_dry_run: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve(logs),
    });

    const section = app.querySelector('#orchestrator-runs-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).not.toContain('badge-dry-run');
  });

  it('shows both Running and Dry Run badges for an active dry run', async () => {
    const logs = [
      { filename: '20260325T120000-my-project.jsonl', is_active: true, is_dry_run: true },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve(logs),
    });

    const section = app.querySelector('#orchestrator-runs-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).toContain('badge-in-progress');
    expect(section!.innerHTML).toContain('badge-dry-run');
    expect(section!.innerHTML).toContain('Running');
    expect(section!.innerHTML).toContain('Dry Run');
  });

  it('only shows Running badge on the most-recent run even if older runs have is_active: true', async () => {
    // Simulates runs that were killed without writing run_end — they appear active
    // in the file, but only the newest one can truly be running.
    const logs = [
      { filename: '20260323T100000-my-project.jsonl', is_active: true }, // old, interrupted
      { filename: '20260325T090000-my-project.jsonl', is_active: true }, // newest, genuinely active
      { filename: '20260324T120000-my-project.jsonl', is_active: true }, // middle, interrupted
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
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
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.reject({ message: 'Network error', code: 'ERROR' }),
    });

    // Wrapper stays visible on error (silent failure, toolbar shows disabled state)
    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).not.toBe('none');

    // Page still rendered (Work Packages section present)
    expect(app.innerHTML).toContain('Work Packages');
  });

  it('handles null error objects gracefully', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.reject(null),
    });

    // Should not throw; wrapper stays visible with disabled toolbar
    const wrapper = app.querySelector('#orchestrator-runs-wrapper') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.display).not.toBe('none');
  });

  // ── Existing content unaffected ───────────────────────────────────────────

  it('existing page content (WPs, comments, breadcrumb) is unaffected', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { runner: 'orchestrator' } })),
      getRunLogs: () => Promise.resolve([]),
    });

    expect(app.innerHTML).toContain('Work Packages');
    expect(app.innerHTML).toContain('Project Comments');
    // Breadcrumb
    expect(app.innerHTML).toContain('Projects');
  });
});

// ---------------------------------------------------------------------------
// WP-013: Queue-aware active run section
// ---------------------------------------------------------------------------

describe('renderProjectDetail — WP-013: queue-aware active run (AC-1 to AC-5)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  // Shared factory for a minimal queue entry matching a given log filename.
  function makeQueueEntry(logFilename: string, overrides: Record<string, unknown> = {}) {
    return {
      id:              'queue-entry-1',
      pid:             42424,
      logFilename,
      expectedSlug:    'my-project',
      startedAt:       new Date(Date.now() - 30_000).toISOString(),
      effectiveStatus: 'started',
      progress:        null,
      lastAction:      null,
      ...overrides,
    };
  }

  // Helper: wait for queue-aware rendering to settle (queue fetch = extra promise hop).
  async function flush(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 300) {
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      const el = app.querySelector('#orchestrator-runs-section');
      if (el && !el.innerHTML.includes('Loading runs')) break;
    }
    // Extra hops for orchestratorGetQueue resolution.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  // ── AC-1: Active run with matching queue entry ────────────────────────────

  it('AC-1: calls renderStatusCard with the matching queue entry', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };
    const queueEntry = makeQueueEntry(activeLog.filename);

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([queueEntry]),
    });

    expect(globalThis.OrchestratorWidgets.renderStatusCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-entry-1' })
    );
  });

  it('AC-1: injects a kill button via renderKillButton for matching entry', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };
    const queueEntry = makeQueueEntry(activeLog.filename);

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([queueEntry]),
    });

    expect(app.querySelector('.kill-btn')).not.toBeNull();
    expect(globalThis.OrchestratorWidgets.renderKillButton).toHaveBeenCalledWith(
      'queue-entry-1',
      expect.any(Function)
    );
  });

  it('AC-1: starts log preview via renderLogPreview for matching entry', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };
    const queueEntry = makeQueueEntry(activeLog.filename);

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([queueEntry]),
    });

    expect(globalThis.OrchestratorWidgets.renderLogPreview).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'my-repo',
      'my-project',
      activeLog.filename
    );
  });

  // ── AC-2: Active run without matching queue entry ────────────────────────

  it('AC-2: does NOT call renderStatusCard when no queue entry matches', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]), // empty queue
    });

    expect(globalThis.OrchestratorWidgets.renderStatusCard).not.toHaveBeenCalled();
  });

  it('AC-2: does NOT inject a kill button when no queue entry matches', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    expect(app.querySelector('.kill-btn')).toBeNull();
    expect(globalThis.OrchestratorWidgets.renderKillButton).not.toHaveBeenCalled();
  });

  it('AC-2: shows CLI kill hint when no queue entry matches', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    expect(app.innerHTML).toContain('kill-orchestrator');
  });

  it('AC-2: starts log preview via renderLogPreview even without a matching queue entry', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    expect(globalThis.OrchestratorWidgets.renderLogPreview).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'my-repo',
      'my-project',
      activeLog.filename
    );
  });

  // ── AC-3: Non-active runs are unchanged ──────────────────────────────────

  it('AC-3: does not call renderStatusCard or renderKillButton for non-active runs', async () => {
    const logs = [
      { filename: '20260505T120000-my-project.jsonl', is_active: false },
      { filename: '20260504T100000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(globalThis.OrchestratorWidgets.renderStatusCard).not.toHaveBeenCalled();
    expect(globalThis.OrchestratorWidgets.renderKillButton).not.toHaveBeenCalled();
  });

  it('AC-3: does not call renderLogPreview for non-active runs', async () => {
    const logs = [
      { filename: '20260505T120000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(globalThis.OrchestratorWidgets.renderLogPreview).not.toHaveBeenCalled();
  });

  it('AC-3: still renders run number and View link for non-active runs', async () => {
    const logs = [
      { filename: '20260505T120000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs: () => Promise.resolve(logs),
    });

    expect(app.innerHTML).toContain('Run #1');
    expect(app.innerHTML).toContain('View');
  });

  // ── AC-4: Log preview cleanup on re-render ────────────────────────────────

  it('AC-4: calls cleanup function returned by renderLogPreview on the next renderProjectDetail call', async () => {
    const cleanup = vi.fn();
    globalThis.OrchestratorWidgets.renderLogPreview = vi.fn().mockReturnValue(cleanup);

    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    // First render should have called renderLogPreview and stored the cleanup.
    expect(globalThis.OrchestratorWidgets.renderLogPreview).toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();

    // Second call to renderProjectDetail — should drain cleanups from the first render.
    const cleanup2 = vi.fn();
    globalThis.OrchestratorWidgets.renderLogPreview = vi.fn().mockReturnValue(cleanup2);

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    expect(cleanup).toHaveBeenCalled();
  });

  // ── AC-5: Polling registered via Router._setPolling ──────────────────────
  // WP-003 unified polling: Router._setPolling is always called at 5s cadence
  // regardless of whether an active run exists.  When an active run is found,
  // startCombinedPolling is called twice (initial combined + upgraded with
  // orchPollFn), so _setPolling is called twice in that path.

  it('AC-5: calls Router._setPolling with 5000 ms when an active run is present (WP-003: called twice — initial combined + orch upgrade)', async () => {
    const activeLog = { filename: '20260505T120000-my-project.jsonl', is_active: true };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs:           () => Promise.resolve([activeLog]),
      orchestratorGetQueue: () => Promise.resolve([]),
    });

    // WP-003: combined poll is registered once after initial render, then
    // upgraded (re-registered) with orchPollFn after active run is detected.
    expect(globalThis.Router._setPolling).toHaveBeenCalledTimes(2);
    const calls = (globalThis.Router._setPolling as Mock).mock.calls;
    expect(calls[0][1]).toBe(5000); // initial combined poll
    expect(calls[1][1]).toBe(5000); // upgraded combined+orch poll
  });

  it('AC-5: calls Router._setPolling exactly once at 5000 ms when there is no active run (WP-003 combined poll)', async () => {
    const logs = [
      { filename: '20260505T120000-my-project.jsonl', is_active: false },
    ];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getRunLogs: () => Promise.resolve(logs),
    });

    // WP-003: combined project-data poll is always registered at 5s.
    expect(globalThis.Router._setPolling).toHaveBeenCalledOnce();
    const [, delay] = (globalThis.Router._setPolling as Mock).mock.calls[0];
    expect(delay).toBe(5000);
  });
});


