// @vitest-environment jsdom

/**
 * Tests for WP-002: WP title subtitle in the project detail WP table.
 *
 * Covers:
 *   - WP table row renders .wp-title-label when overview entry has a title
 *   - WP table row renders no .wp-title-label when title is absent
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API to exercise the renderProjectDetail WP row builder.
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
const projectDetailJs        = readFileSync(join(publicDir, 'views/project-detail.js'),        'utf-8');
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'),'utf-8');
const projectDetailOrchJs    = readFileSync(join(publicDir, 'views/project-detail-orch.js'),   'utf-8');
const projectDetailModalJs   = readFileSync(join(publicDir, 'views/project-detail-modal.js'),  'utf-8');

beforeAll(() => {
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };
  (globalThis as Record<string, unknown>)['OrchestratorWidgets'] = {
    renderStatusCard:    vi.fn().mockReturnValue(''),
    renderKillButton:    vi.fn().mockImplementation(() => document.createElement('button')),
    renderDismissButton: vi.fn(),
    renderLogPreview:    vi.fn().mockReturnValue(vi.fn()),
    renderProgressBadge: vi.fn().mockReturnValue(''),
    renderCliReference:  vi.fn().mockReturnValue(''),
  };
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  vm.runInThisContext(projectDetailHelpersJs);
  vm.runInThisContext(projectDetailOrchJs);
  vm.runInThisContext(projectDetailModalJs);
  vm.runInThisContext(projectDetailJs);
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.OrchestratorWidgets.renderStatusCard.mockReturnValue('');
  globalThis.OrchestratorWidgets.renderLogPreview.mockReturnValue(vi.fn());
  globalThis.OrchestratorWidgets.renderKillButton
    .mockImplementation(() => document.createElement('button'));
  (globalThis as Record<string, unknown>)['_pdLogPreviewCleanups'] = [];
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderProjectDetail: (app: HTMLElement, repo: string, slug: string) => void;
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
  var Router: { _setPolling: Mock; _clearPolling: Mock };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function renderWithAPI(
  app: HTMLElement,
  repo: string,
  slug: string,
  apiStubs: Partial<ProjectDetailApiStubs> = {}
) {
  (globalThis as Record<string, unknown>)['API'] = createApiStubs(apiStubs);
  globalThis.renderProjectDetail(app, repo, slug);

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

describe('renderProjectDetail — WP title subtitle (WP-002)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  it('renders .wp-title-label inside the WP ID cell when overview entry has a title', async () => {
    const wp = { work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer' };
    const project = makeProject({ work_packages: [wp] });
    const overviewEntry = {
      work_package_id: 'WP-001',
      title: 'Add duration tracking',
      status: 'READY',
      assigned_to: 'Developer',
      dependencies: [],
      pipeline_stages: [],
      acceptance_criteria: { met: 0, total: 1 },
    };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:              () => Promise.resolve(project),
      getWorkPackageOverview:  () => Promise.resolve([overviewEntry]),
    });

    const titleLabel = app.querySelector('.wp-title-label');
    expect(titleLabel).not.toBeNull();
    expect(titleLabel!.textContent).toBe('Add duration tracking');
  });

  it('does not render .wp-title-label when overview entry has no title', async () => {
    const wp = { work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer' };
    const project = makeProject({ work_packages: [wp] });
    const overviewEntry = {
      work_package_id: 'WP-001',
      status: 'READY',
      assigned_to: 'Developer',
      dependencies: [],
      pipeline_stages: [],
      acceptance_criteria: { met: 0, total: 1 },
    };

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:              () => Promise.resolve(project),
      getWorkPackageOverview:  () => Promise.resolve([overviewEntry]),
    });

    expect(app.querySelector('.wp-title-label')).toBeNull();
  });

  it('does not render .wp-title-label when overview result is null (graceful degradation)', async () => {
    const wp = { work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer' };
    const project = makeProject({ work_packages: [wp] });

    await renderWithAPI(app, 'my-repo', 'my-project', {
      getProject:              () => Promise.resolve(project),
      getWorkPackageOverview:  () => Promise.resolve(null),
    });

    expect(app.querySelector('.wp-title-label')).toBeNull();
  });
});
