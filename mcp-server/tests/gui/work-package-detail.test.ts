// @vitest-environment jsdom

/**
 * Tests for WP-003: title header and description card in views/work-package.js.
 *
 * Covers:
 *   - <h1> renders {WP-ID} — {title} when title is present
 *   - <h1> renders {WP-ID} alone when title is absent
 *   - Description card rendered when description is present (via marked.parse)
 *   - No description card when description is absent
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side scripts, then
 * stubs globalThis.API to exercise renderWorkPackageDetail.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const wpViewJs               = readFileSync(join(publicDir, 'views/work-package.js'),          'utf-8');
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'),'utf-8');

beforeAll(() => {
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  vm.runInThisContext(projectDetailHelpersJs);
  vm.runInThisContext(wpViewJs);
});

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>)['_pdLogPreviewCleanups'] = [];
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderWorkPackageDetail: (app: HTMLElement, repo: string, slug: string, wpId: string) => void;
  // eslint-disable-next-line no-var
  var API: Record<string, (...args: unknown[]) => Promise<unknown>>;
  // eslint-disable-next-line no-var
  var marked: { parse: (s: string) => string };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Minimal valid WP detail fixture. */
function makeWpDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'READY',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines: [],
    active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
    default_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
    ...overrides,
  };
}

/**
 * Stubs globalThis.API and calls renderWorkPackageDetail, then waits for
 * the async Promise.all chain to resolve.
 */
async function renderWp(
  app: HTMLElement,
  wpData: Record<string, unknown>
): Promise<void> {
  (globalThis as Record<string, unknown>)['API'] = {
    getWorkPackage: () => Promise.resolve(wpData),
    getRepo:        () => Promise.reject(new Error('no repo')),
    getChunks:      () => Promise.reject(new Error('no chunks')),
    getDialogues:   () => Promise.reject(new Error('no dialogues')),
  };

  globalThis.renderWorkPackageDetail(app, 'my-repo', 'my-project', 'WP-001');

  // Wait for the Promise.all chain to settle
  const start = Date.now();
  while (Date.now() - start < 200) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    if (!app.innerHTML.includes('Loading')) break;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderWorkPackageDetail — title header and description card (WP-003)', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  it('renders WP-ID — title in <h1> when title is present', async () => {
    await renderWp(app, makeWpDetail({ title: 'Add duration tracking' }));

    const h1 = app.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('WP-001 \u2014 Add duration tracking');
  });

  it('renders WP-ID alone in <h1> when title is absent', async () => {
    await renderWp(app, makeWpDetail());

    const h1 = app.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('WP-001');
  });

  it('renders a description card with marked.parse content when description is present', async () => {
    await renderWp(app, makeWpDetail({ description: 'Full spec body here.' }));

    // UI.card renders a .card element with a .card-title matching the label
    const cardTitles = Array.from(app.querySelectorAll('.card-title'));
    const descTitle = cardTitles.find((el) => el.textContent === 'Description');
    expect(descTitle).not.toBeUndefined();

    // marked.parse stub wraps text in <p>
    expect(app.innerHTML).toContain('<p>Full spec body here.</p>');
  });

  it('does not render a description card when description is absent', async () => {
    await renderWp(app, makeWpDetail());

    const cardTitles = Array.from(app.querySelectorAll('.card-title'));
    const descTitle = cardTitles.find((el) => el.textContent === 'Description');
    expect(descTitle).toBeUndefined();
  });
});
