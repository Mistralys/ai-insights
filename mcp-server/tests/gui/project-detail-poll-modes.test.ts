// @vitest-environment jsdom

/**
 * Tests for polling behaviour in views/project-detail.js.
 *
 * Covers:
 *   - Inline edit survives poll ticks (WP-005 AC-5)
 *   - Single-interval invariant across combined ↔ resume mode transitions (WP-005 AC-6)
 *   - Modal and archive/unarchive remain functional under active polling (WP-005)
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API and globalThis.marked to exercise the
 * renderProjectDetail polling paths.
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
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'), 'utf-8');
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'), 'utf-8');
const projectDetailOrchJs = readFileSync(join(publicDir, 'views/project-detail-orch.js'), 'utf-8');
const projectDetailModalJs = readFileSync(join(publicDir, 'views/project-detail-modal.js'), 'utf-8');

beforeAll(() => {
  // Install stub globals needed by project-detail.js before it is evaluated
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };

  // OrchestratorWidgets stub
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

// ---------------------------------------------------------------------------
// WP-005: Inline edit input value and focus survive data-only poll updates
// ---------------------------------------------------------------------------

describe('WP-005 — Inline edit survives data-only poll ticks (AC-5)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
    // Clean up any stale edit inputs.
    document.querySelectorAll('.title-edit-input, .slug-edit-input').forEach((el) => el.remove());
  });

  /**
   * Why focus state is tested via element survival (not document.activeElement):
   *
   * jsdom does not implement the :focus pseudoclass or document.activeElement
   * reliably. Calling `.focus()` inside jsdom does not update
   * `document.activeElement` the way a real browser does. Asserting that
   * `document.activeElement === input` would be a no-op (it always returns
   * `document.body`), giving a false-green result regardless of whether the
   * DOM was mutated.
   *
   * Instead, we verify the stronger invariant: the input *element itself*
   * survives the poll tick without being unmounted. If the DOM is rebuilt
   * (e.g., `innerHTML` is replaced), the input reference becomes stale and
   * `app.querySelector('.title-edit-input')` returns null. This is the actual
   * mechanism that would destroy focus in a real browser. A full end-to-end
   * test (Playwright/Cypress) would be needed to assert document.activeElement
   * directly.
   */
  it('title edit input value is preserved across a data-only poll update', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(project),
    });

    // Simulate a title-edit input being active while a data-only poll fires
    const input = document.createElement('input');
    input.className = 'title-edit-input';
    input.value = 'My In-Progress Edit';
    app.appendChild(input);

    // The poll guard checks for .title-edit-input before patching; since
    // editActive=true, patches should be skipped entirely (no DOM mutations)
    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn(),
    };

    // Data-only change: project status changes
    const updatedProject = makeProject({ meta: { status: 'READY' } });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // The edit input must still be present with its value intact
    const inputAfter = app.querySelector('.title-edit-input') as HTMLInputElement | null;
    expect(inputAfter).not.toBeNull();
    expect(inputAfter!.value).toBe('My In-Progress Edit');

    // The interactive-state guard skipped patching — no structural re-render
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });

  it('slug edit input value is preserved across a data-only poll update', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(project),
    });

    const input = document.createElement('input');
    input.className = 'slug-edit-input';
    input.value = 'my-new-slug-draft';
    app.appendChild(input);

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn(),
    };

    const updatedProject = makeProject({ meta: { status: 'READY' } });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    const inputAfter = app.querySelector('.slug-edit-input') as HTMLInputElement | null;
    expect(inputAfter).not.toBeNull();
    expect(inputAfter!.value).toBe('my-new-slug-draft');

    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });

  it('multiple sequential data-only poll ticks do not destroy an active inline edit', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(project),
    });

    const input = document.createElement('input');
    input.className = 'title-edit-input';
    input.value = 'Draft title';
    app.appendChild(input);

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn(),
    };

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),   // no change → 'none' diff
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    // Fire three poll ticks
    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 30));
    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 30));
    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 30));

    const inputAfter = app.querySelector('.title-edit-input') as HTMLInputElement | null;
    expect(inputAfter).not.toBeNull();
    expect(inputAfter!.value).toBe('Draft title');
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WP-005: Single-interval invariant across combined ↔ resume mode transitions (AC-6)
// ---------------------------------------------------------------------------

describe('WP-005 — Single-interval invariant across combined↔resume mode transitions (AC-6)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('Router._setPolling is called exactly once for a no-active-run combined poll registration', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:  () => Promise.resolve(makeProject()),
      getRunLogs:  () => Promise.resolve([]),
    });

    // Combined poll only: _setPolling called once at 5s
    expect(globalThis.Router._setPolling).toHaveBeenCalledOnce();
    const [, delay] = (globalThis.Router._setPolling as Mock).mock.calls[0];
    expect(delay).toBe(5000);
  });

  it('startResumePolling replaces the combined interval (single call to Router._setPolling)', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve({ thread_id: 'abc123', dry_run: false, result: 'INTERRUPTED' }),
      orchestratorStart: () => Promise.resolve({ started: true }),
    });

    // After initial render: combined poll registered once
    const callsAfterRender = (globalThis.Router._setPolling as Mock).mock.calls.length;
    expect(callsAfterRender).toBeGreaterThanOrEqual(1);

    vi.clearAllMocks();

    // Wait for resume button to appear
    const start = Date.now();
    while (Date.now() - start < 300) {
      await new Promise<void>((r) => setTimeout(r, 15));
      if (app.querySelector('#orch-resume-btn')) break;
    }

    const resumeBtn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(resumeBtn).not.toBeNull();

    // Click Resume — this triggers pollController.startResumePolling which calls Router._setPolling
    resumeBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    // startResumePolling should result in a single new Router._setPolling call at 3s
    expect(globalThis.Router._setPolling).toHaveBeenCalledOnce();
    const [, resumeDelay] = (globalThis.Router._setPolling as Mock).mock.calls[0];
    expect(resumeDelay).toBe(3000);
  });

  it('two sequential renderProjectDetail calls each register exactly one combined poll', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:  () => Promise.resolve(makeProject()),
      getRunLogs:  () => Promise.resolve([]),
    });

    const firstCount = (globalThis.Router._setPolling as Mock).mock.calls.length;

    vi.clearAllMocks();

    // Second render (simulates route leave/return)
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:  () => Promise.resolve(makeProject()),
      getRunLogs:  () => Promise.resolve([]),
    });

    const secondCount = (globalThis.Router._setPolling as Mock).mock.calls.length;

    // Each render registers exactly one poll
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
  });

  it('Router._clearPolling is called when stopPolling fires before structural re-render', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:  () => Promise.resolve(project),
      getRunLogs:  () => Promise.resolve([]),
    });

    vi.clearAllMocks();

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    // Structural change: WP count changes from 0 → 1
    const updatedProject = {
      ...project,
      work_packages: [{ work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer' }],
    };

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
      getPlanDocument:        vi.fn().mockRejectedValue({ code: 'NOT_FOUND' }),
      getRunLogs:             vi.fn().mockResolvedValue([]),
      getRunMetadata:         vi.fn().mockRejectedValue(new Error('no meta')),
    };

    // Use the real pollController from the view — a fresh one is created by
    // the second renderProjectDetail triggered by stopPolling.
    // We simulate calling _pollProjectDetail with a noop controller to observe
    // the stopPolling → _clearPolling contract.
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn().mockImplementation(() => {
        // Real stopPolling calls Router._clearPolling
        globalThis.Router._clearPolling();
      }),
    };

    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 80));

    // stopPolling was called once for the structural change
    expect(ctrl.stopPolling).toHaveBeenCalledOnce();
    // Router._clearPolling was called by the stopPolling implementation
    expect(globalThis.Router._clearPolling).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// WP-005: Reset modal and archive/unarchive remain functional under active polling
// ---------------------------------------------------------------------------

describe('WP-005 — Modal and archive/unarchive remain functional under active polling', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
    document.getElementById('reset-modal-overlay')?.remove();
  });

  it('Reset Project button is present and clickable under active polling', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(project),
      getRunLogs: () => Promise.resolve([]),
    });

    // Simulate a data-only poll tick running in the background
    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn(),
    };
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 30));

    // The reset button must still be present and functional after a poll tick
    const resetBtn = app.querySelector('#reset-project-btn') as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn!.disabled).toBe(false);
  });

  it('DOM patching is skipped when #reset-modal-overlay is open', async () => {
    const project = makeProject({ meta: { status: 'IN_PROGRESS' } });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(project),
      getRunLogs: () => Promise.resolve([]),
    });

    // Inject a modal overlay
    const modal = document.createElement('div');
    modal.id = 'reset-modal-overlay';
    document.body.appendChild(modal);

    // Capture the current badge innerHTML
    const badge = app.querySelector('#project-status-badge') as HTMLElement;
    const badgeHtmlBefore = badge.innerHTML;

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = {
      getMode:              vi.fn().mockReturnValue('combined'),
      startCombinedPolling: vi.fn(),
      startResumePolling:   vi.fn(),
      settleResumePolling:  vi.fn(),
      stopPolling:          vi.fn(),
    };

    // Data-only change: status changes, but modal is open so patches should be skipped
    const updatedProject = makeProject({ meta: { status: 'READY' } });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'my-repo', 'my-project', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // Badge should NOT have been updated (guard skipped patching while modal is open)
    const badgeAfter = app.querySelector('#project-status-badge') as HTMLElement;
    expect(badgeAfter.innerHTML).toBe(badgeHtmlBefore);

    modal.remove();
  });

  it('archive banner shows on ARCHIVED project and unarchive button is present', async () => {
    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject: () => Promise.resolve(makeProject({ meta: { status: 'ARCHIVED' } })),
      getRunLogs: () => Promise.resolve([]),
    });

    expect(app.querySelector('#archive-banner')).not.toBeNull();
    expect(app.querySelector('#unarchive-banner-btn')).not.toBeNull();
  });
});
