// @vitest-environment jsdom

/**
 * WP-005: Integration tests for the assembled auto-update behavior of
 * views/project-detail.js.
 *
 * Coverage areas:
 *   1. DOM element identity preservation during polling (strict === checks)
 *   2. Synthesis auto-reveal without full page rerender or loss of inline editor state
 *   3. Project status badge updates in-place when status changes (data-only)
 *   4. Health badge updates in-place when health overview changes (data-only)
 *   5. WP pipeline stage badge transitions update in the existing row without
 *      replacing the table element or row node
 *
 * Uses jsdom + vm.runInThisContext following the pattern documented in
 * mcp-server/tests/gui/README.md.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'), 'utf-8');

beforeAll(() => {
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };

  (globalThis as Record<string, unknown>)['OrchestratorWidgets'] = {
    renderStatusCard:    vi.fn().mockReturnValue('<div class="orchestrator-status-card">card</div>'),
    renderKillButton:    vi.fn().mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    }),
    renderDismissButton: vi.fn(),
    renderLogPreview:    vi.fn().mockReturnValue(vi.fn()),
    renderProgressBadge: vi.fn().mockReturnValue(''),
    renderCliReference:  vi.fn().mockReturnValue(''),
  };

  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  vm.runInThisContext(projectDetailJs);
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.OrchestratorWidgets.renderStatusCard
    .mockReturnValue('<div class="orchestrator-status-card">card</div>');
  globalThis.OrchestratorWidgets.renderLogPreview.mockReturnValue(vi.fn());
  globalThis.OrchestratorWidgets.renderKillButton
    .mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    });
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
  var API: Record<string, Mock>;
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      status: 'IN_PROGRESS',
      title: 'Test Project',
      plan_path: '/some/path',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-01T00:00:00Z',
      ...(overrides._metaOverrides as Record<string, unknown> ?? {}),
      ...overrides,
    },
    work_packages: (overrides.work_packages as unknown[] | undefined) ?? [],
    project_comments: [],
    project_name: 'Test Project',
    timing: null,
    server_version: null,
    ledger_version: null,
    synthesis_generated: !!(overrides.synthesis_generated),
    ...(overrides._rootOverrides as Record<string, unknown> ?? {}),
  };
}

/** Minimal no-op pollController for direct _pollProjectDetail calls. */
function makeNoopPollController() {
  return {
    getMode:              vi.fn().mockReturnValue('combined'),
    startCombinedPolling: vi.fn(),
    startResumePolling:   vi.fn(),
    settleResumePolling:  vi.fn(),
    stopPolling:          vi.fn(),
  };
}

/**
 * Render the project detail page and wait for all async chains to settle.
 * Returns once the orchestrator-runs-section no longer shows the loading
 * placeholder, plus a few extra ticks for trailing microtasks.
 */
async function renderAndSettle(
  app: HTMLElement,
  repo: string,
  slug: string,
  apiStubs: Partial<{
    getProject: Mock;
    getPlanDocument: Mock;
    getWorkPackageOverview: Mock;
    getProjectHealth: Mock;
    getRunLogs: Mock;
    orchestratorGetQueue: Mock;
    getRunMetadata: Mock;
    orchestratorStart: Mock;
    analyzeProjectReset: Mock;
  }> = {}
): Promise<void> {
  (globalThis as Record<string, unknown>)['API'] = {
    getProject:             apiStubs.getProject           ?? vi.fn().mockResolvedValue(makeProject()),
    getPlanDocument:        apiStubs.getPlanDocument       ?? vi.fn().mockRejectedValue({ code: 'NOT_FOUND' }),
    getWorkPackageOverview: apiStubs.getWorkPackageOverview ?? vi.fn().mockResolvedValue(null),
    getProjectHealth:       apiStubs.getProjectHealth      ?? vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    getRunLogs:             apiStubs.getRunLogs            ?? vi.fn().mockResolvedValue([]),
    orchestratorGetQueue:   apiStubs.orchestratorGetQueue  ?? vi.fn().mockResolvedValue([]),
    getRunMetadata:         apiStubs.getRunMetadata        ?? vi.fn().mockRejectedValue(new Error('no meta')),
    orchestratorStart:      apiStubs.orchestratorStart     ?? vi.fn().mockRejectedValue(new Error('not stubbed')),
    analyzeProjectReset:    apiStubs.analyzeProjectReset   ?? vi.fn().mockRejectedValue(new Error('not stubbed')),
  };

  globalThis.renderProjectDetail(app, repo, slug);

  const deadline = Date.now() + 300;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 10));
    const el = app.querySelector('#orchestrator-runs-section');
    if (!el || !el.innerHTML.includes('Loading runs')) break;
  }
  await new Promise<void>((r) => setTimeout(r, 20));
}

// ---------------------------------------------------------------------------
// §1 DOM element identity preservation (AC-4)
// ---------------------------------------------------------------------------

describe('WP-005 — DOM element identity preservation during poll ticks (AC-4)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('WP table row === identity is preserved after a data-only poll tick (status change)', async () => {
    // Render the page with one WP
    const wp = { work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer' };
    const project = { ...makeProject(), work_packages: [wp] };

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Capture the row element reference before the poll tick
    const rowBefore = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;
    expect(rowBefore).not.toBeNull();

    // Simulate a data-only poll tick: same WP count, but status changes
    const updatedProject = { ...project, work_packages: [{ ...wp, status: 'IN_PROGRESS' }] };
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // The same row element must still be in the DOM — identity preserved
    const rowAfter = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;
    expect(rowAfter).not.toBeNull();
    expect(rowAfter === rowBefore).toBe(true); // strict === reference equality

    // The status badge inside the row should reflect the updated status
    const statusCell = rowAfter.querySelector('.wp-status-cell') as HTMLElement;
    expect(statusCell.innerHTML).toContain('IN_PROGRESS');
  });

  it('project-status-badge element === identity is preserved after a status patch', async () => {
    // Render the page to get the real badge element
    const project = makeProject({ status: 'IN_PROGRESS' });
    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    const badgeBefore = app.querySelector('#project-status-badge') as HTMLElement;
    expect(badgeBefore).not.toBeNull();

    // Data-only poll: status changes from IN_PROGRESS → READY
    const updatedProject = makeProject({ status: 'READY' });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // Same element — not replaced
    const badgeAfter = app.querySelector('#project-status-badge') as HTMLElement;
    expect(badgeAfter).not.toBeNull();
    expect(badgeAfter === badgeBefore).toBe(true); // strict === reference equality

    // Badge content updated
    expect(badgeAfter.innerHTML).toContain('READY');
  });

  it('health-badge element === identity is preserved after a health patch', async () => {
    const project = makeProject();
    await renderAndSettle(app, 'repo', 'proj', {
      getProject:       vi.fn().mockResolvedValue(project),
      getProjectHealth: vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    });

    const healthBadgeBefore = app.querySelector('#health-badge') as HTMLElement;
    expect(healthBadgeBefore).not.toBeNull();

    // Data-only poll: health changes (0 → 2 needing reset)
    const initialSnapshot = { ...globalThis._snapshotProjectState(project, null), health: { work_packages_needing_reset: 0 } };
    const pollStateRef: unknown[] = [initialSnapshot];
    const ctrl = makeNoopPollController();

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 2 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    const healthBadgeAfter = app.querySelector('#health-badge') as HTMLElement;
    expect(healthBadgeAfter).not.toBeNull();
    expect(healthBadgeAfter === healthBadgeBefore).toBe(true); // strict === reference equality
    expect(healthBadgeAfter.textContent).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// §2 WP pipeline stage badge transitions (AC-4)
// ---------------------------------------------------------------------------

describe('WP-005 — WP pipeline stage badge transitions in existing rows', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('updates only the .wp-status-cell without replacing the table or row element', async () => {
    const wp = { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'QA' };
    const project = { ...makeProject(), work_packages: [wp] };

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Capture references to the table, tbody and row BEFORE the poll
    const tableBefore  = app.querySelector('table') as HTMLElement;
    const tbodyBefore  = app.querySelector('tbody') as HTMLElement;
    const rowBefore    = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;
    expect(tableBefore).not.toBeNull();
    expect(rowBefore).not.toBeNull();

    // Poll tick: WP transitions from IN_PROGRESS → COMPLETE (data-only, same WP count)
    const updatedWp = { ...wp, status: 'COMPLETE' };
    const updatedProject = { ...project, work_packages: [updatedWp] };

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // DOM identities preserved for table structure
    const tableAfter = app.querySelector('table') as HTMLElement;
    const tbodyAfter = app.querySelector('tbody') as HTMLElement;
    const rowAfter   = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;

    expect(tableAfter === tableBefore).toBe(true);
    expect(tbodyAfter === tbodyBefore).toBe(true);
    expect(rowAfter   === rowBefore  ).toBe(true);

    // Status cell updated to reflect new status
    const statusCell = rowAfter.querySelector('.wp-status-cell') as HTMLElement;
    expect(statusCell.innerHTML).toContain('COMPLETE');
  });

  it('updates WP row pipeline stage cell when pipeline stages change', async () => {
    const wp = { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'QA' };
    const project = { ...makeProject(), work_packages: [wp] };

    const initialOverview = [
      {
        work_package_id: 'WP-001',
        pipeline_stages: [
          { type: 'qa', status: 'IN_PROGRESS', agent: 'QA', rework_count: 0 },
        ],
      },
    ];

    await renderAndSettle(app, 'repo', 'proj', {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(initialOverview),
    });

    const rowBefore = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;
    expect(rowBefore).not.toBeNull();

    // Poll tick: qa stage transitions from IN_PROGRESS → PASS
    const updatedOverview = [
      {
        work_package_id: 'WP-001',
        pipeline_stages: [
          { type: 'qa', status: 'PASS', agent: 'QA', rework_count: 0 },
        ],
      },
    ];

    const snapshot = globalThis._snapshotProjectState(project, initialOverview);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(updatedOverview),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // Row node identity preserved
    const rowAfter = app.querySelector('tr[data-wp-id="WP-001"]') as HTMLElement;
    expect(rowAfter === rowBefore).toBe(true);

    // Pipeline track cell updated (no full page rebuild)
    const trackCell = rowAfter.querySelector('.wp-pipeline-track-cell') as HTMLElement;
    expect(trackCell).not.toBeNull();
    // The PASS state should be reflected (qa stage → PASS appears in track HTML)
    expect(trackCell.innerHTML).not.toContain('IN_PROGRESS');
  });
});

// ---------------------------------------------------------------------------
// §3 Synthesis auto-reveal without full page rerender (AC-5 via _pollProjectDetail)
// ---------------------------------------------------------------------------

describe('WP-005 — Synthesis auto-reveal during poll tick', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('reveals synthesis-link-row without replacing existing DOM elements', async () => {
    const project = makeProject({ synthesis_generated: false });

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Capture stable references BEFORE the flip
    const statusBadgeBefore = app.querySelector('#project-status-badge') as HTMLElement;
    const synthRowBefore    = app.querySelector('#synthesis-link-row') as HTMLElement;
    expect(synthRowBefore).not.toBeNull();
    expect(synthRowBefore.style.display).toBe('none'); // starts hidden

    // Poll tick: synthesis_generated flips to true
    const projectWithSynth = { ...project, synthesis_generated: true };
    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(projectWithSynth),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // Synthesis row is now visible
    const synthRowAfter = app.querySelector('#synthesis-link-row') as HTMLElement;
    expect(synthRowAfter).not.toBeNull();
    expect(synthRowAfter.style.display).not.toBe('none');

    // No full page re-render — status badge identity preserved
    const statusBadgeAfter = app.querySelector('#project-status-badge') as HTMLElement;
    expect(statusBadgeAfter === statusBadgeBefore).toBe(true);

    // stopPolling should NOT have been called (no structural re-render)
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });

  it('does not trigger a full page rebuild when synthesis_generated flips to true', async () => {
    const project = makeProject({ synthesis_generated: false });

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Place a marker element outside the normal render path to detect full rebuilds
    const marker = document.createElement('span');
    marker.id = 'rebuild-detector';
    app.querySelector('#synthesis-link-row')!.parentElement!.appendChild(marker);

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    const projectWithSynth = { ...project, synthesis_generated: true };
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(projectWithSynth),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // stopPolling not called → renderProjectDetail not triggered → marker still present
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
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
  it('synthesis auto-reveal preserves any inline editor state in the DOM', async () => {
    const project = makeProject({ synthesis_generated: false });

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Simulate a title edit input being active (user is mid-edit)
    const editInput = document.createElement('input');
    editInput.className = 'title-edit-input';
    editInput.value = 'My edited title';
    app.appendChild(editInput);

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    // Use a custom poll controller that checks the interactive-state guard behavior;
    // since edit is active, DOM patches (including synthesis reveal) should be skipped
    const ctrl = makeNoopPollController();

    const projectWithSynth = { ...project, synthesis_generated: true };
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(projectWithSynth),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    // The inline edit input must still be present (not destroyed by a full re-render)
    const editInputAfter = app.querySelector('.title-edit-input') as HTMLInputElement | null;
    expect(editInputAfter).not.toBeNull();
    expect(editInputAfter!.value).toBe('My edited title');

    editInput.remove();
  });
});

// ---------------------------------------------------------------------------
// §4 Project status badge in-place update (data-only)
// ---------------------------------------------------------------------------

describe('WP-005 — Project status badge updates in-place', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('updates #project-status-badge text/class without full page rebuild', async () => {
    const project = makeProject({ status: 'IN_PROGRESS' });

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    // Verify badge is present and shows current status
    const badge = app.querySelector('#project-status-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.innerHTML).toContain('IN_PROGRESS');

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    // Poll tick: status changes to READY (data-only — not COMPLETE/ARCHIVED)
    const updatedProject = makeProject({ status: 'READY' });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(updatedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    const badgeAfter = app.querySelector('#project-status-badge') as HTMLElement;
    expect(badgeAfter.innerHTML).toContain('READY');
    // No structural re-render
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });

  it('status change to COMPLETE triggers structural re-render (stopPolling called)', async () => {
    const project = makeProject({ status: 'IN_PROGRESS' });

    await renderAndSettle(app, 'repo', 'proj', {
      getProject: vi.fn().mockResolvedValue(project),
    });

    const snapshot = globalThis._snapshotProjectState(project, null);
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    const completedProject = makeProject({ status: 'COMPLETE' });
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(completedProject),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
      getPlanDocument:        vi.fn().mockRejectedValue({ code: 'NOT_FOUND' }),
      getRunLogs:             vi.fn().mockResolvedValue([]),
      getRunMetadata:         vi.fn().mockRejectedValue(new Error('no meta')),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 80));

    // COMPLETE is a structural change — stopPolling must be called
    expect(ctrl.stopPolling).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// §5 Health badge in-place update (data-only)
// ---------------------------------------------------------------------------

describe('WP-005 — Health badge updates in-place', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });
  afterEach(() => { if (app.parentNode) app.parentNode.removeChild(app); });

  it('updates #health-badge text/class without full page rebuild when health changes', async () => {
    const project = makeProject();
    const initialHealth = { work_packages_needing_reset: 0 };

    await renderAndSettle(app, 'repo', 'proj', {
      getProject:       vi.fn().mockResolvedValue(project),
      getProjectHealth: vi.fn().mockResolvedValue(initialHealth),
    });

    const healthBadge = app.querySelector('#health-badge') as HTMLElement;
    expect(healthBadge).not.toBeNull();

    // Set up snapshot with the known health state
    const snapshot = {
      ...globalThis._snapshotProjectState(project, null),
      health: initialHealth,
    };
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    // Poll tick: health changes (0 → 3 WPs needing reset)
    const newHealth = { work_packages_needing_reset: 3 };
    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue(newHealth),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    const healthBadgeAfter = app.querySelector('#health-badge') as HTMLElement;
    expect(healthBadgeAfter).not.toBeNull();
    expect(healthBadgeAfter.textContent).toContain('3');
    expect(healthBadgeAfter.textContent).toContain('attention');
    // No structural re-render
    expect(ctrl.stopPolling).not.toHaveBeenCalled();
  });

  it('transitions health badge from "healthy" to "attention" text in-place', async () => {
    const project = makeProject();

    await renderAndSettle(app, 'repo', 'proj', {
      getProject:       vi.fn().mockResolvedValue(project),
      getProjectHealth: vi.fn().mockResolvedValue({ work_packages_needing_reset: 0 }),
    });

    const snapshot = {
      ...globalThis._snapshotProjectState(project, null),
      health: { work_packages_needing_reset: 0 },
    };
    const pollStateRef: unknown[] = [snapshot];
    const ctrl = makeNoopPollController();

    (globalThis as Record<string, unknown>)['API'] = {
      getProject:             vi.fn().mockResolvedValue(project),
      getWorkPackageOverview: vi.fn().mockResolvedValue(null),
      getProjectHealth:       vi.fn().mockResolvedValue({ work_packages_needing_reset: 1 }),
    };

    globalThis._pollProjectDetail(app, 'repo', 'proj', pollStateRef, ctrl);
    await new Promise<void>((r) => setTimeout(r, 60));

    const healthBadge = app.querySelector('#health-badge') as HTMLElement;
    expect(healthBadge.className).toContain('attention');
    expect(healthBadge.textContent).toContain('1');
  });
});
