// @vitest-environment jsdom

/**
 * Tests for WP-004: module-level _findScrollAnchor and renderRunsList helpers
 * extracted from views/project-detail.js.
 *
 * Coverage areas:
 *   1. _findScrollAnchor — scrollable ancestor found, no scrollable ancestor
 *      (falls back to document.documentElement), multi-level walk
 *   2. renderRunsList — DOM built correctly for a single inactive run item,
 *      active-run section rendered when is_active is true (includes status card),
 *      drain fires before rebuild, scroll position restored after DOM rebuild,
 *      log preview started for active run, log preview skipped when activeFilename
 *      is null
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
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'), 'utf-8');
const projectDetailOrchJs = readFileSync(join(publicDir, 'views/project-detail-orch.js'), 'utf-8');
const projectDetailModalJs = readFileSync(join(publicDir, 'views/project-detail-modal.js'), 'utf-8');

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

  vm.runInThisContext(projectDetailHelpersJs);
  vm.runInThisContext(projectDetailOrchJs);
  vm.runInThisContext(projectDetailModalJs);
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
  // Reset _pdLogPreviewCleanups between tests
  (globalThis as Record<string, unknown>)['_pdLogPreviewCleanups'] = [];
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _findScrollAnchor: (
    el: Element | null,
    _getStyle?: (el: Element) => { overflowY?: string }
  ) => Element;
  // eslint-disable-next-line no-var
  var renderRunsList: (
    runsEl: HTMLElement,
    sorted: Array<{ filename?: string; is_active?: boolean; [k: string]: unknown }>,
    repo: string,
    slug: string,
    activeFilename: string | null,
    matchingQueueEntry: Record<string, unknown> | null
  ) => void;
  // eslint-disable-next-line no-var
  var _pdLogPreviewCleanups: Array<() => void>;
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
// § 1 — _findScrollAnchor
// ---------------------------------------------------------------------------

describe('_findScrollAnchor', () => {
  it('returns the immediate parent when it is scrollable', () => {
    const parent = document.createElement('div');
    const child  = document.createElement('div');
    parent.appendChild(child);
    document.body.appendChild(parent);

    try {
      const result = globalThis._findScrollAnchor(child, (el) =>
        el === parent ? { overflowY: 'scroll' } : {}
      );
      expect(result).toBe(parent);
    } finally {
      parent.remove();
    }
  });

  it('falls back to document.documentElement when no scrollable ancestor exists', () => {
    const parent = document.createElement('div');
    const child  = document.createElement('div');
    parent.appendChild(child);
    document.body.appendChild(parent);

    try {
      const result = globalThis._findScrollAnchor(child, () => ({ overflowY: '' }));
      expect(result).toBe(document.documentElement);
    } finally {
      parent.remove();
    }
  });

  it('walks multiple levels to find a scrollable grandparent', () => {
    const grandparent = document.createElement('div');
    const middle      = document.createElement('div');
    const child       = document.createElement('div');
    grandparent.appendChild(middle);
    middle.appendChild(child);
    document.body.appendChild(grandparent);

    try {
      // middle is not scrollable; grandparent is
      const result = globalThis._findScrollAnchor(child, (el) =>
        el === grandparent ? { overflowY: 'auto' } : {}
      );
      expect(result).toBe(grandparent);
    } finally {
      grandparent.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// § 2 — renderRunsList
// ---------------------------------------------------------------------------

describe('renderRunsList', () => {
  let runsEl: HTMLDivElement;

  beforeEach(() => {
    runsEl = document.createElement('div');
    runsEl.id = 'orchestrator-runs-section';
    document.body.appendChild(runsEl);
  });

  afterEach(() => {
    runsEl.remove();
  });

  it('builds DOM correctly for a single inactive run item', () => {
    const sorted = [{ filename: '20260601T120000-my-proj.jsonl', is_active: false }];

    globalThis.renderRunsList(runsEl, sorted, 'my-repo', 'my-proj', null, null);

    expect(runsEl.innerHTML).toContain('Run #1');
    expect(runsEl.innerHTML).toContain('my-proj.jsonl');
    expect(runsEl.innerHTML).toContain('View</a>');
    expect(runsEl.querySelector('.orch-active-run-section')).toBeNull();
  });

  it('includes the active-run section when is_active is true', () => {
    const sorted = [{ filename: '20260601T120000-my-proj.jsonl', is_active: true }];
    const queueEntry = { id: 'q1', logFilename: '20260601T120000-my-proj.jsonl' };

    globalThis.renderRunsList(
      runsEl, sorted, 'my-repo', 'my-proj',
      '20260601T120000-my-proj.jsonl', queueEntry
    );

    expect(runsEl.querySelector('.orch-active-run-section')).not.toBeNull();
    expect(runsEl.querySelector('#orch-status-card-container')).not.toBeNull();
    expect(globalThis.OrchestratorWidgets.renderStatusCard).toHaveBeenCalledWith(queueEntry);
  });

  it('drains _pdLogPreviewCleanups before rebuilding innerHTML', () => {
    const cleanupFn = vi.fn();
    globalThis._pdLogPreviewCleanups = [cleanupFn];

    const sorted = [{ filename: '20260601T120000-proj.jsonl', is_active: false }];
    globalThis.renderRunsList(runsEl, sorted, 'my-repo', 'my-proj', null, null);

    expect(cleanupFn).toHaveBeenCalledOnce();
    expect(globalThis._pdLogPreviewCleanups).toHaveLength(0);
  });

  it('restores scroll position after DOM rebuild via _findScrollAnchor', () => {
    // Set up a scrollable wrapper containing runsEl
    const wrapper = document.createElement('div');
    wrapper.id = 'orchestrator-runs-wrapper';
    // Use dataset to emulate scrollTop (jsdom limitation workaround)
    Object.defineProperty(wrapper, 'scrollTop', {
      get: () => wrapper.dataset['scrollTop'] ? parseInt(wrapper.dataset['scrollTop']) : 0,
      set: (v: number) => { wrapper.dataset['scrollTop'] = String(v); },
      configurable: true,
    });
    runsEl.remove();
    wrapper.appendChild(runsEl);
    document.body.appendChild(wrapper);

    try {
      // Seed a saved scroll position
      wrapper.scrollTop = 42;

      const sorted = [{ filename: '20260601T120000-proj.jsonl', is_active: false }];

      // _findScrollAnchor uses window.getComputedStyle; inject a stub that marks
      // wrapper as scrollable so the walk stops there (jsdom normally returns '').
      const origFindScrollAnchor = globalThis._findScrollAnchor;
      (globalThis as Record<string, unknown>)['_findScrollAnchor'] = function (
        el: Element
      ): Element {
        return wrapper;
      };

      try {
        globalThis.renderRunsList(runsEl, sorted, 'my-repo', 'my-proj', null, null);
        expect(wrapper.scrollTop).toBe(42);
      } finally {
        (globalThis as Record<string, unknown>)['_findScrollAnchor'] = origFindScrollAnchor;
      }
    } finally {
      wrapper.remove();
    }
  });

  it('starts a log preview for the active run after rebuild', () => {
    const sorted = [{ filename: '20260601T120000-proj.jsonl', is_active: true }];
    const activeFilename = '20260601T120000-proj.jsonl';

    globalThis.renderRunsList(runsEl, sorted, 'my-repo', 'my-proj', activeFilename, null);

    expect(globalThis.OrchestratorWidgets.renderLogPreview).toHaveBeenCalledWith(
      expect.any(HTMLElement), 'my-repo', 'my-proj', activeFilename
    );
    expect(globalThis._pdLogPreviewCleanups).toHaveLength(1);
  });

  it('does not start a log preview when activeFilename is null', () => {
    const sorted = [{ filename: '20260601T120000-proj.jsonl', is_active: false }];

    globalThis.renderRunsList(runsEl, sorted, 'my-repo', 'my-proj', null, null);

    expect(globalThis.OrchestratorWidgets.renderLogPreview).not.toHaveBeenCalled();
    expect(globalThis._pdLogPreviewCleanups).toHaveLength(0);
  });
});
