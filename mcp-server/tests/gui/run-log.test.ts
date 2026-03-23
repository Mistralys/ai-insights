// @vitest-environment jsdom

/**
 * Tests for gui/public/views/run-log.js — the orchestrator run log viewer.
 *
 * Uses jsdom + vm.runInThisContext with mocked globalThis.API and Router.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const utilsJs   = readFileSync(join(publicDir, 'utils.js'),                'utf-8');
const runLogJs  = readFileSync(join(publicDir, 'views/run-log.js'),        'utf-8');

beforeAll(() => {
  vm.runInThisContext(utilsJs);
  vm.runInThisContext(runLogJs);
});

// ---------------------------------------------------------------------------
// Global type declarations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderRunLog: (app: HTMLElement, slug: string, filename: string) => void;
  // eslint-disable-next-line no-var
  var API: {
    getRunLogEntries: (...args: unknown[]) => Promise<unknown>;
    [key: string]: (...args: unknown[]) => Promise<unknown>;
  };
  // eslint-disable-next-line no-var
  var Router: {
    _setPolling: (fn: () => void, ms: number) => void;
    _clearPolling: () => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Makes a log result object as the API would return. */
function makeResult(entries: unknown[], totalLines?: number) {
  return { entries, totalLines: totalLines ?? entries.length };
}

/** Makes a log entry. */
function entry(action: string, extra: Record<string, unknown> = {}) {
  return { action, timestamp: '2026-02-25T11:33:55Z', ...extra };
}

/**
 * Sets up mocked API and Router globals, calls renderRunLog, then waits
 * for all promise resolutions to settle.
 */
async function render(
  app: HTMLElement,
  slug: string,
  filename: string,
  apiResult: unknown,
  pollResults: unknown[] = []
) {
  let pollCallCount = 0;
  let capturedPollFn: (() => void) | null = null;

  // Mock Router
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling: (fn: () => void, _ms: number) => {
      capturedPollFn = fn;
    },
    _clearPolling: () => {
      capturedPollFn = null;
    },
  };

  // Mock API
  (globalThis as Record<string, unknown>)['API'] = {
    getRunLogEntries: vi.fn((_slug: unknown, _file: unknown, afterLine?: unknown) => {
      if (afterLine === undefined || afterLine === null) {
        // Initial fetch
        return Promise.resolve(apiResult);
      }
      // Poll fetch
      const r = pollResults[pollCallCount++];
      return Promise.resolve(r ?? makeResult([]));
    }),
  };

  globalThis.renderRunLog(app, slug, filename);

  // Flush microtasks: initial fetch resolves
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  return {
    triggerPoll: async () => {
      if (capturedPollFn) capturedPollFn();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
    isPollActive: () => capturedPollFn !== null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderRunLog', () => {
  let app: HTMLElement;

  beforeEach(() => {
    app = document.createElement('div');
    document.body.appendChild(app);
  });

  afterEach(() => {
    if (app.parentNode) app.parentNode.removeChild(app);
  });

  // ── AC1: Breadcrumb ────────────────────────────────────────────────────────

  it('shows breadcrumb: Projects / {slug} / Run Log with correct hrefs', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([]));

    expect(app.innerHTML).toContain('Projects');
    expect(app.innerHTML).toContain('Run Log');
    expect(app.innerHTML).toContain('href="#/"');
    expect(app.innerHTML).toContain('href="#/projects/' + encodeURIComponent('my-project') + '"');
    expect(app.innerHTML).toContain('my-project');
  });

  // ── AC2: Chronological order ───────────────────────────────────────────────

  it('renders event cards in order (first entry appears before last in DOM)', async () => {
    const entries = [
      entry('step_start', { step_name: 'Alpha' }),
      entry('step_end',   { step_name: 'Beta' }),
      entry('run_end'),
    ];
    await render(app, 'my-project', 'run.jsonl', makeResult(entries, 3));

    const timeline = app.querySelector('#run-event-timeline')!;
    const cards = timeline.querySelectorAll('.run-event');
    expect(cards.length).toBe(3);

    // Alpha card is before Beta card
    const positions = Array.from(cards).map((c) => c.innerHTML);
    expect(positions[0]).toContain('Alpha');
    expect(positions[1]).toContain('Beta');
  });

  // ── AC3: Event card content ────────────────────────────────────────────────

  it('renders step_start with step_name', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('step_start', { step_name: 'my-step' }),
    ]));
    expect(app.innerHTML).toContain('step_start');
    expect(app.innerHTML).toContain('my-step');
  });

  it('renders llm_call_start with model name', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('llm_call_start', { model: 'claude-3-opus' }),
    ]));
    expect(app.innerHTML).toContain('llm_call_start');
    expect(app.innerHTML).toContain('claude-3-opus');
  });

  it('renders tool_call_start with tool_name', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('tool_call_start', { tool_name: 'bash' }),
    ]));
    expect(app.innerHTML).toContain('tool_call_start');
    expect(app.innerHTML).toContain('bash');
  });

  it('renders run_start', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('run_start', { thread_id: 'abc-123' }),
    ]));
    expect(app.innerHTML).toContain('Run started');
    expect(app.innerHTML).toContain('abc-123');
  });

  it('renders run_end', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([entry('run_end')]));
    expect(app.innerHTML).toContain('Run completed');
  });

  it('renders run_error with error message', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('run_error', { error: 'something exploded' }),
    ]));
    // The rendered content shows "Run error:" (human-readable label)
    expect(app.innerHTML).toContain('Run error:');
    expect(app.innerHTML).toContain('something exploded');
    // Should have error severity class
    expect(app.innerHTML).toContain('run-event--error');
  });

  it('renders unknown action types with a generic fallback without throwing', async () => {
    const unknownEntry = { action: 'some_future_action', message: 'hello future', timestamp: '2026-01-01T00:00:00Z' };
    await expect(render(app, 'my-project', 'run.jsonl', makeResult([unknownEntry]))).resolves.toBeDefined();
    expect(app.innerHTML).toContain('some_future_action');
    expect(app.innerHTML).toContain('hello future');
  });

  // ── AC4: Polling ───────────────────────────────────────────────────────────

  it('starts polling after initial load when run is not yet complete', async () => {
    const { isPollActive } = await render(app, 'my-project', 'run.jsonl',
      makeResult([entry('step_start', { step_name: 'first' })])
    );
    expect(isPollActive()).toBe(true);
  });

  it('does not start polling when initial load contains a terminal run_end entry', async () => {
    const { isPollActive } = await render(app, 'my-project', 'run.jsonl',
      makeResult([entry('run_start'), entry('run_end')])
    );
    expect(isPollActive()).toBe(false);
  });

  it('stops polling when a poll tick returns a run_end entry', async () => {
    const { triggerPoll, isPollActive } = await render(
      app, 'my-project', 'run.jsonl',
      makeResult([entry('run_start')], 1),
      [makeResult([entry('run_end')], 2)]
    );

    expect(isPollActive()).toBe(true);
    await triggerPoll();
    expect(isPollActive()).toBe(false);
    expect(app.innerHTML).toContain('Run complete');
  });

  it('stops polling on run_error', async () => {
    const { triggerPoll, isPollActive } = await render(
      app, 'my-project', 'run.jsonl',
      makeResult([entry('run_start')], 1),
      [makeResult([entry('run_error', { error: 'boom' })], 2)]
    );

    expect(isPollActive()).toBe(true);
    await triggerPoll();
    expect(isPollActive()).toBe(false);
  });

  // ── AC5: Incremental fetch ─────────────────────────────────────────────────

  it('uses afterLine = totalLines for subsequent poll fetches', async () => {
    const { triggerPoll } = await render(
      app, 'my-project', 'run.jsonl',
      makeResult([entry('step_start')], 5),  // initial: 5 total lines
      [makeResult([], 5)]
    );

    await triggerPoll();

    // The API mock captures afterLine; the second call should use afterLine=5
    const apiMock = (globalThis.API.getRunLogEntries as ReturnType<typeof vi.fn>);
    const calls = apiMock.mock.calls;
    // First call: initial (afterLine undefined/null)
    // Second call: poll tick (afterLine = 5)
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const pollCall = calls[calls.length - 1]!;
    expect(pollCall[2]).toBe(5); // afterLine parameter
  });

  // ── AC6: Progress bar in-place update ─────────────────────────────────────

  it('progress_snapshot updates progress bar without appending a card', async () => {
    await render(app, 'my-project', 'run.jsonl', makeResult([
      entry('progress_snapshot', { progress_pct: 42, message: 'halfway' }),
    ]));

    // Progress bar fill should reflect 42%
    const fill = app.querySelector('#run-progress-bar-fill') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe('42%');

    // No card should have been appended for the progress_snapshot
    const timeline = app.querySelector('#run-event-timeline')!;
    const cards = timeline.querySelectorAll('.run-event');
    expect(cards.length).toBe(0);
  });

  it('does not crash on malformed entries in the log', async () => {
    await expect(render(app, 'my-project', 'run.jsonl', makeResult([
      null,
      undefined,
      42,
      {},
      entry('step_start', { step_name: 'valid' }),
    ]))).resolves.toBeDefined();

    // The valid entry still renders
    expect(app.innerHTML).toContain('step_start');
    expect(app.innerHTML).toContain('valid');
  });
});
