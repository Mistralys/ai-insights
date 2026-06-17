// @vitest-environment jsdom

/**
 * Tests for the Resume Run feature of views/project-detail.js.
 *
 * Covers:
 *   - showResumeError helper — error-banner deduplication (WP-004)
 *   - Resume Run button — show/hide conditions (WP-005)
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API and globalThis.marked to exercise the
 * renderProjectDetail paths related to resume functionality.
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
// WP-004: showResumeError helper — error-banner deduplication
// ---------------------------------------------------------------------------

describe('renderProjectDetail — WP-004: showResumeError helper', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  /** Minimal resumable run metadata */
  function makeResumableMeta(overrides: Record<string, unknown> = {}) {
    return { thread_id: 'thread-abc', dry_run: false, result: 'INTERRUPTED', ...overrides };
  }

  /**
   * Flush promises until the resume button (or error banner) appears,
   * or 300 ms elapses.
   */
  async function flushResume(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 300) {
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      if (app.querySelector('#orch-resume-btn') || app.querySelector('#orch-resume-error')) break;
    }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  async function flushError(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 300) {
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      if (app.querySelector('#orch-resume-error')) break;
    }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  // ── showResumeError DOM structure ─────────────────────────────────────────

  it('creates a <p id="orch-resume-error" class="error-banner"> on a non-started result', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
      orchestratorStart: () => Promise.resolve({ started: false }),
    });

    await flushResume();

    // Click the resume button to trigger the error path
    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    await flushError();

    const errEl = app.querySelector('#orch-resume-error');
    expect(errEl).not.toBeNull();
    expect(errEl!.tagName).toBe('P');
    expect(errEl!.className).toBe('error-banner');
    expect(errEl!.textContent).toBe('Resume could not be started.');
  });

  it('creates a <p id="orch-resume-error" class="error-banner"> on a rejected orchestratorStart', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
      orchestratorStart: () => Promise.reject({ message: 'Connection refused' }),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    await flushError();

    const errEl = app.querySelector('#orch-resume-error');
    expect(errEl).not.toBeNull();
    expect(errEl!.tagName).toBe('P');
    expect(errEl!.className).toBe('error-banner');
    expect(errEl!.textContent).toBe('Resume failed: Connection refused');
  });

  // ── Error banner reuse (no duplicate elements) ────────────────────────────

  it('reuses the existing #orch-resume-error element on a second call (no duplicates)', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];
    let callCount = 0;

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
      orchestratorStart: () => {
        callCount++;
        return Promise.resolve({ started: false });
      },
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    // Click once — creates the error element.
    btn!.disabled = false;
    btn!.click();
    await flushError();

    // Click again — should reuse, not duplicate.
    btn!.disabled = false;
    btn!.click();
    await flushError();

    const errEls = app.querySelectorAll('#orch-resume-error');
    expect(errEls).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // ── Error banner text content ─────────────────────────────────────────────

  it('includes the error message from a rejected orchestratorStart in the banner text', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
      orchestratorStart: () => Promise.reject({ message: 'Server timeout' }),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    await flushError();

    const errEl = app.querySelector('#orch-resume-error');
    expect(errEl).not.toBeNull();
    expect(errEl!.textContent).toContain('Resume failed:');
    expect(errEl!.textContent).toContain('Server timeout');
  });

  // ── Resume button not shown for ineligible projects ───────────────────────

  it('shows a disabled resume button for a COMPLETE project', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'COMPLETE', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    expect(app.querySelector('#orch-resume-error')).toBeNull();
  });

  it('shows a disabled resume button when result is SUCCESS', async () => {
    const logs = [{ filename: '20260505T120000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta({ result: 'SUCCESS' })),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WP-005: Resume Run button — show/hide conditions
// ---------------------------------------------------------------------------

describe('Resume Run button', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  /** Minimal resumable run metadata */
  function makeResumableMeta(overrides: Record<string, unknown> = {}) {
    return { thread_id: 'thread-xyz', dry_run: false, result: 'INTERRUPTED', ...overrides };
  }

  /**
   * Flush promises until the resume button appears or 300 ms elapses.
   */
  async function flushResume(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 300) {
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      if (app.querySelector('#orch-resume-btn') || app.querySelector('#orch-resume-error')) break;
    }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  // ── 1. SHOW: no active run, status IN_PROGRESS, metadata has thread_id, not dry_run, result !== SUCCESS ──

  it('shows the resume button when conditions are met (IN_PROGRESS, thread_id, not dry_run, result !== SUCCESS)', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.textContent).toBe('Resume');
  });

  // ── 2. HIDE: status is COMPLETE ──────────────────────────────────────────

  it('shows a disabled resume button when project status is COMPLETE', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'COMPLETE', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  // ── 3. SHOW DISABLED: status is ARCHIVED ─────────────────────────────────

  it('shows a disabled resume button when project status is ARCHIVED', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'ARCHIVED', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  // ── 4. SHOW DISABLED: getRunMetadata returns null / no thread_id ──────────

  it('shows a disabled resume button when getRunMetadata returns null', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(null),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  it('shows a disabled resume button when getRunMetadata returns metadata without thread_id', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve({ thread_id: null, dry_run: false, result: 'INTERRUPTED' }),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  // ── 5. SHOW DISABLED: metadata.dry_run is true ───────────────────────────

  it('shows a disabled resume button when metadata.dry_run is true', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta({ dry_run: true })),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  // ── 6. SHOW DISABLED: metadata.result is SUCCESS ─────────────────────────

  it('shows a disabled resume button when metadata.result is SUCCESS', async () => {
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: false }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      getRunMetadata: () => Promise.resolve(makeResumableMeta({ result: 'SUCCESS' })),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });

  // ── 7. SHOW DISABLED: an active run exists ────────────────────────────────

  it('shows a disabled resume button when an active run exists', async () => {
    // With an active run, renderOrchToolbar disables the resume button.
    const logs = [{ filename: '20260601T100000-my-project.jsonl', is_active: true }];

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:     () => Promise.resolve(makeProject({ meta: { status: 'IN_PROGRESS', plan_path: '/some/path' } })),
      getRunLogs:     () => Promise.resolve(logs),
      orchestratorGetQueue: () => Promise.resolve([]),
      getRunMetadata: () => Promise.resolve(makeResumableMeta()),
    });

    await flushResume();

    const btn = app.querySelector('#orch-resume-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });
});
