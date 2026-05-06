// @vitest-environment jsdom

/**
 * Tests for gui/public/js/orchestrator-widgets.js — WP-010
 *
 * All acceptance criteria tested:
 *   AC-1: renderStatusCard produces valid HTML with PID, elapsed time,
 *         progress summary, and status badge.
 *   AC-2: renderKillButton calls API.orchestratorKill() after a
 *         confirmation prompt and invokes the callback.
 *   AC-3: renderDismissButton calls API.orchestratorDismiss() and
 *         invokes the callback.
 *   AC-4: renderLogPreview auto-polls API.getRunLogEntries() and
 *         appends new events. Returns a cleanup function that stops polling.
 *   AC-5: renderProgressBadge maps lastAction to appropriate icon/color.
 *   AC-6: renderCliReference returns static HTML with the CLI commands
 *         reference.
 *   AC-7: All functions are accessible on the global OrchestratorWidgets
 *         object.
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side script.
 * API and escapeHtml are set on globalThis before the script runs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load dependent scripts, then the widget library
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');

const utilsJs   = readFileSync(join(publicDir, 'utils.js'),    'utf-8');
const widgetsJs = readFileSync(
  join(publicDir, 'js', 'orchestrator-widgets.js'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var OrchestratorWidgets: {
    renderStatusCard:    (entry: Record<string, unknown>) => string;
    renderKillButton:    (entryId: string, onDone: () => void) => HTMLButtonElement;
    renderDismissButton: (entryId: string, onDone: () => void) => HTMLButtonElement;
    renderLogPreview:    (container: HTMLElement, slug: string, filename: string) => () => void;
    renderProgressBadge: (lastAction: string | null | undefined) => string;
    renderCliReference:  () => string;
  };
  // eslint-disable-next-line no-var
  var API: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

// ---------------------------------------------------------------------------
// Setup: install utils.js globals, stub API, then load the widget script
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Install utils.js globals (escapeHtml etc.)
  vm.runInThisContext(utilsJs);
  // Stub API with placeholder methods; individual tests override as needed.
  (globalThis as Record<string, unknown>)['API'] = {
    orchestratorKill:    vi.fn().mockResolvedValue(null),
    orchestratorDismiss: vi.fn().mockResolvedValue(null),
    getRunLogEntries:    vi.fn().mockResolvedValue({ entries: [], totalLines: 0 }),
  };
  // Load the widget module.
  vm.runInThisContext(widgetsJs);
});

// Restore fresh API mocks and reset timers between tests.
beforeEach(() => {
  (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['orchestratorKill']    = vi.fn().mockResolvedValue(null);
  (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['orchestratorDismiss'] = vi.fn().mockResolvedValue(null);
  (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['getRunLogEntries']    = vi.fn().mockResolvedValue({ entries: [], totalLines: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flush all pending microtask queues (Promise callbacks).
 * Looping several times handles multi-hop .then() chains.
 */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function makeEntry(overrides: Partial<{
  effectiveStatus: string;
  pid: number;
  startedAt: string;
  progress: string | null;
}> = {}): Record<string, unknown> {
  return {
    effectiveStatus: overrides.effectiveStatus ?? 'pending',
    pid:             overrides.pid             ?? 12345,
    startedAt:       overrides.startedAt       ?? new Date(Date.now() - 65000).toISOString(),
    progress:        overrides.progress        !== undefined ? overrides.progress : 'Starting developer for WP-001',
  };
}

// ---------------------------------------------------------------------------
// AC-7: global namespace
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets — AC-7: global namespace', () => {
  it('OrchestratorWidgets is defined as a global object', () => {
    expect(typeof globalThis.OrchestratorWidgets).toBe('object');
    expect(globalThis.OrchestratorWidgets).not.toBeNull();
  });

  it('exposes all required functions', () => {
    const w = globalThis.OrchestratorWidgets;
    expect(typeof w.renderStatusCard).toBe('function');
    expect(typeof w.renderKillButton).toBe('function');
    expect(typeof w.renderDismissButton).toBe('function');
    expect(typeof w.renderLogPreview).toBe('function');
    expect(typeof w.renderProgressBadge).toBe('function');
    expect(typeof w.renderCliReference).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC-1: renderStatusCard
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderStatusCard — AC-1', () => {
  it('returns a non-empty HTML string', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(makeEntry());
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('includes the PID', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(makeEntry({ pid: 99999 }));
    expect(html).toContain('99999');
  });

  it('includes the status badge for pending', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ effectiveStatus: 'pending' }),
    );
    expect(html).toContain('badge-pending');
    expect(html).toContain('Pending');
  });

  it('includes the status badge for started', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ effectiveStatus: 'started' }),
    );
    expect(html).toContain('badge-started');
    expect(html).toContain('Started');
  });

  it('includes the status badge for dead', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ effectiveStatus: 'dead' }),
    );
    expect(html).toContain('badge-dead');
    expect(html).toContain('Dead');
  });

  it('includes elapsed time when startedAt is set', () => {
    // startedAt 65 seconds ago → formatted as "1m"
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ startedAt }),
    );
    expect(html).toContain('Running');
  });

  it('includes the progress summary text', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ progress: 'Starting qa for WP-003' }),
    );
    expect(html).toContain('Starting qa for WP-003');
  });

  it('omits progress section when progress is null', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ progress: null }),
    );
    expect(html).not.toContain('orchestrator-progress-summary');
  });

  it('HTML-escapes progress text to prevent XSS', () => {
    const html = globalThis.OrchestratorWidgets.renderStatusCard(
      makeEntry({ progress: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// AC-2: renderKillButton
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderKillButton — AC-2', () => {
  it('returns an HTMLButtonElement', () => {
    const btn = globalThis.OrchestratorWidgets.renderKillButton('entry-1', vi.fn());
    expect(btn instanceof HTMLButtonElement).toBe(true);
  });

  it('button text is "Kill"', () => {
    const btn = globalThis.OrchestratorWidgets.renderKillButton('entry-1', vi.fn());
    expect(btn.textContent).toBe('Kill');
  });

  it('does NOT call API.orchestratorKill when confirm is rejected', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const onDone = vi.fn();
    const btn = globalThis.OrchestratorWidgets.renderKillButton('entry-2', onDone);
    btn.click();

    await Promise.resolve();  // flush microtasks
    expect(globalThis.API['orchestratorKill']).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls API.orchestratorKill with entryId after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const onDone = vi.fn();
    const btn = globalThis.OrchestratorWidgets.renderKillButton('entry-3', onDone);
    btn.click();

    await Promise.resolve();
    await Promise.resolve();  // two ticks to settle the resolved promise
    expect(globalThis.API['orchestratorKill']).toHaveBeenCalledWith('entry-3');
  });

  it('invokes onDone callback after a successful kill', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['orchestratorKill'] =
      vi.fn().mockResolvedValue(null);

    const onDone = vi.fn();
    const btn = globalThis.OrchestratorWidgets.renderKillButton('entry-4', onDone);
    btn.click();

    // Settle the promise chain (confirm → API call → .then callback)
    await new Promise((r) => setTimeout(r, 0));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// AC-3: renderDismissButton
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderDismissButton — AC-3', () => {
  it('returns an HTMLButtonElement', () => {
    const btn = globalThis.OrchestratorWidgets.renderDismissButton('entry-5', vi.fn());
    expect(btn instanceof HTMLButtonElement).toBe(true);
  });

  it('button text is "Dismiss"', () => {
    const btn = globalThis.OrchestratorWidgets.renderDismissButton('entry-5', vi.fn());
    expect(btn.textContent).toBe('Dismiss');
  });

  it('calls API.orchestratorDismiss with entryId on click', async () => {
    const onDone = vi.fn();
    const btn = globalThis.OrchestratorWidgets.renderDismissButton('entry-6', onDone);
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.API['orchestratorDismiss']).toHaveBeenCalledWith('entry-6');
  });

  it('invokes onDone callback after a successful dismiss', async () => {
    (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['orchestratorDismiss'] =
      vi.fn().mockResolvedValue(null);

    const onDone = vi.fn();
    const btn = globalThis.OrchestratorWidgets.renderDismissButton('entry-7', onDone);
    btn.click();

    await new Promise((r) => setTimeout(r, 0));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// AC-4: renderLogPreview
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderLogPreview — AC-4', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a cleanup function', () => {
    const container = document.createElement('div');
    const cleanup = globalThis.OrchestratorWidgets.renderLogPreview(
      container, 'my-slug', 'run.jsonl',
    );
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('calls API.getRunLogEntries immediately on invocation', () => {
    const container = document.createElement('div');
    globalThis.OrchestratorWidgets.renderLogPreview(container, 'my-slug', 'run.jsonl');

    expect(globalThis.API['getRunLogEntries']).toHaveBeenCalledOnce();
    expect(globalThis.API['getRunLogEntries']).toHaveBeenCalledWith('my-slug', 'run.jsonl', 0);
  });

  it('appends new event entries to the container', async () => {
    const container = document.createElement('div');
    (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['getRunLogEntries'] =
      vi.fn().mockResolvedValue({
        entries:    [{ action: 'run_start' }, { action: 'stage_start' }],
        totalLines: 2,
      });

    globalThis.OrchestratorWidgets.renderLogPreview(container, 'slug', 'run.jsonl');

    // Flush the initial fetch promise
    await flushPromises();

    expect(container.children).toHaveLength(2);
    expect(container.children[0]!.textContent).toBe('run_start');
    expect(container.children[1]!.textContent).toBe('stage_start');
  });

  it('polls again after 3 seconds and appends incremental entries', async () => {
    const container = document.createElement('div');

    let callCount = 0;
    (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['getRunLogEntries'] =
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ entries: [{ action: 'run_start' }], totalLines: 1 });
        }
        return Promise.resolve({ entries: [{ action: 'stage_start' }], totalLines: 2 });
      });

    globalThis.OrchestratorWidgets.renderLogPreview(container, 'slug', 'run.jsonl');
    await flushPromises();
    expect(container.children).toHaveLength(1);

    // Advance past the 3s polling interval
    vi.advanceTimersByTime(3001);
    await flushPromises();

    expect(container.children).toHaveLength(2);
    // Second call uses afterLine = 1 (the totalLines from the first response)
    const secondCall = (globalThis.API['getRunLogEntries'] as Mock).mock.calls[1];
    expect(secondCall![2]).toBe(1);
  });

  it('cleanup function stops polling', async () => {
    const container = document.createElement('div');
    (globalThis.API as Record<string, ReturnType<typeof vi.fn>>)['getRunLogEntries'] =
      vi.fn().mockResolvedValue({ entries: [], totalLines: 0 });

    const cleanup = globalThis.OrchestratorWidgets.renderLogPreview(
      container, 'slug', 'run.jsonl',
    );
    await flushPromises();

    const callsBeforeCleanup = (globalThis.API['getRunLogEntries'] as Mock)
      .mock.calls.length;

    cleanup();

    // Advance well past the interval — no further calls should happen
    vi.advanceTimersByTime(10_000);
    await flushPromises();

    expect(
      (globalThis.API['getRunLogEntries'] as Mock).mock.calls.length,
    ).toBe(callsBeforeCleanup);
  });
});

// ---------------------------------------------------------------------------
// AC-5: renderProgressBadge
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderProgressBadge — AC-5', () => {
  it('returns a string', () => {
    expect(typeof globalThis.OrchestratorWidgets.renderProgressBadge('run_start')).toBe('string');
  });

  it('run_start → badge-info class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('run_start');
    expect(html).toContain('badge-info');
  });

  it('stage_start → badge-info class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('stage_start');
    expect(html).toContain('badge-info');
  });

  it('stage_complete → badge-success class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('stage_complete');
    expect(html).toContain('badge-success');
  });

  it('wp_complete → badge-success class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('wp_complete');
    expect(html).toContain('badge-success');
  });

  it('run_end → badge-neutral class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('run_end');
    expect(html).toContain('badge-neutral');
  });

  it('run_error → badge-error class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('run_error');
    expect(html).toContain('badge-error');
  });

  it('signal_shutdown → badge-warning class', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('signal_shutdown');
    expect(html).toContain('badge-warning');
  });

  it('unknown action → badge-neutral fallback', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge('some_unknown');
    expect(html).toContain('badge-neutral');
  });

  it('null → badge-neutral fallback with "idle" label', () => {
    const html = globalThis.OrchestratorWidgets.renderProgressBadge(null as unknown as string);
    expect(html).toContain('badge-neutral');
    expect(html).toContain('idle');
  });
});

// ---------------------------------------------------------------------------
// AC-6: renderCliReference
// ---------------------------------------------------------------------------

describe('OrchestratorWidgets.renderCliReference — AC-6', () => {
  it('returns a non-empty string', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the orchestrate command', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(html).toContain('orchestrate');
  });

  it('contains the --resume flag reference', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(html).toContain('--resume');
  });

  it('contains the --dry-run flag reference', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(html).toContain('--dry-run');
  });

  it('contains a kill-orchestrator reference', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(html).toContain('kill-orchestrator');
  });

  it('wraps content in a container element', () => {
    const html = globalThis.OrchestratorWidgets.renderCliReference();
    expect(html).toContain('<div');
    expect(html).toContain('</div>');
  });
});
