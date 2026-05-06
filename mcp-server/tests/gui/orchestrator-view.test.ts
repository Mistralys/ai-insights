// @vitest-environment jsdom

/**
 * Tests for gui/public/views/orchestrator.js — WP-011
 *
 * All acceptance criteria tested:
 *   AC-1: "Run Preflight" calls API.orchestratorStart(planPath, true) and
 *         renders a pass/fail checklist.
 *   AC-2: "Start Run" button disabled initially; enabled only when all
 *         preflight checks pass; calls API.orchestratorStart(planPath, false).
 *   AC-3: Queue table fetches on render and registers 5-second polling via
 *         Router._setPolling. Each entry renders status badge, elapsed time,
 *         and progress.
 *   AC-4: Pending entries show kill button; started entries show project link;
 *         dead entries show dismiss button.
 *   AC-5: Expanding a row starts a log preview via
 *         OrchestratorWidgets.renderLogPreview(); re-render calls its cleanup.
 *   AC-6: CLI reference card HTML is present at the bottom of the view.
 *   AC-7: All log preview cleanup functions are invoked when renderOrchestrator
 *         is called a second time (re-render scenario).
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side script.
 * API, Router, OrchestratorWidgets, and escapeHtml are set on globalThis.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');

const utilsJs        = readFileSync(join(publicDir, 'utils.js'), 'utf-8');
const orchestratorJs = readFileSync(join(publicDir, 'views/orchestrator.js'), 'utf-8');

// ---------------------------------------------------------------------------
// Global type stubs
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var renderOrchestrator: (app: HTMLElement) => void;
  // eslint-disable-next-line no-var
  var API: {
    orchestratorStart:    Mock;
    orchestratorGetQueue: Mock;
    orchestratorKill:     Mock;
    orchestratorDismiss:  Mock;
  };
  // eslint-disable-next-line no-var
  var Router: {
    _setPolling: Mock;
    _clearPolling: Mock;
  };
  // eslint-disable-next-line no-var
  var OrchestratorWidgets: {
    renderCliReference:  Mock;
    renderKillButton:    Mock;
    renderDismissButton: Mock;
    renderLogPreview:    Mock;
    renderProgressBadge: Mock;
    renderStatusCard:    Mock;
  };
}

// ---------------------------------------------------------------------------
// Setup: install globals, load scripts once
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Install utils.js globals (escapeHtml, etc.)
  vm.runInThisContext(utilsJs);

  // Stub API — individual tests override as needed via mockResolvedValue.
  (globalThis as Record<string, unknown>)['API'] = {
    orchestratorStart:    vi.fn().mockResolvedValue({ checks: [], started: false }),
    orchestratorGetQueue: vi.fn().mockResolvedValue([]),
    orchestratorKill:     vi.fn().mockResolvedValue(null),
    orchestratorDismiss:  vi.fn().mockResolvedValue(null),
  };

  // Stub Router.
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   vi.fn(),
    _clearPolling: vi.fn(),
  };

  // Stub OrchestratorWidgets.
  (globalThis as Record<string, unknown>)['OrchestratorWidgets'] = {
    renderCliReference:  vi.fn().mockReturnValue('<div class="cli-reference">CLI Ref</div>'),
    renderKillButton:    vi.fn().mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    }),
    renderDismissButton: vi.fn().mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'dismiss-btn';
      btn.textContent = 'Dismiss';
      return btn;
    }),
    renderLogPreview:    vi.fn().mockReturnValue(vi.fn()), // returns cleanup stub
    renderProgressBadge: vi.fn().mockReturnValue('<span class="badge-neutral">• idle</span>'),
    renderStatusCard:    vi.fn().mockReturnValue('<div>card</div>'),
  };

  // Load the orchestrator view script.
  vm.runInThisContext(orchestratorJs);
});

// Reset mocks before each test; restore real timers.
beforeEach(() => {
  vi.clearAllMocks();

  // Reset to safe defaults.
  globalThis.API.orchestratorStart    = vi.fn().mockResolvedValue({ checks: [], started: false });
  globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([]);
  globalThis.OrchestratorWidgets.renderCliReference = vi.fn()
    .mockReturnValue('<div class="cli-reference">CLI Ref</div>');
  globalThis.OrchestratorWidgets.renderProgressBadge = vi.fn()
    .mockReturnValue('<span class="badge-neutral">• idle</span>');
  globalThis.OrchestratorWidgets.renderKillButton = vi.fn()
    .mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'kill-btn';
      btn.textContent = 'Kill';
      return btn;
    });
  globalThis.OrchestratorWidgets.renderDismissButton = vi.fn()
    .mockImplementation((_id: string, _cb: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'dismiss-btn';
      btn.textContent = 'Dismiss';
      return btn;
    });
  globalThis.OrchestratorWidgets.renderLogPreview = vi.fn()
    .mockReturnValue(vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush pending microtask queues (multi-hop Promise chains). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Create a fresh #app element. */
function makeApp(): HTMLElement {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);
  return app;
}

function cleanupApp(app: HTMLElement): void {
  app.remove();
}

/** Build a minimal queue entry object. */
function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:              'entry-abc',
    pid:             12345,
    planPath:        '/home/user/project/plan.md',
    expectedSlug:    'my-project',
    startedAt:       new Date(Date.now() - 70_000).toISOString(),
    effectiveStatus: 'pending',
    progress:        null,
    lastAction:      null,
    logFilename:     null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-6: CLI reference card
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-6: CLI reference', () => {
  it('renders the CLI reference card returned by OrchestratorWidgets', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([]);
      globalThis.OrchestratorWidgets.renderCliReference = vi.fn()
        .mockReturnValue('<div class="cli-reference">CLI COMMANDS</div>');
      renderOrchestrator(app);
      await flushPromises();
      expect(app.innerHTML).toContain('CLI COMMANDS');
    } finally { cleanupApp(app); }
  });

  it('calls OrchestratorWidgets.renderCliReference()', () => {
    const app = makeApp();
    try {
      renderOrchestrator(app);
      expect(globalThis.OrchestratorWidgets.renderCliReference).toHaveBeenCalled();
    } finally { cleanupApp(app); }
  });
});

// ---------------------------------------------------------------------------
// AC-3: Queue table + polling
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-3: queue + polling', () => {
  it('calls API.orchestratorGetQueue on render', async () => {
    const app = makeApp();
    try {
      renderOrchestrator(app);
      await flushPromises();
      expect(globalThis.API.orchestratorGetQueue).toHaveBeenCalledOnce();
    } finally { cleanupApp(app); }
  });

  it('registers polling via Router._setPolling with 5000 ms', () => {
    const app = makeApp();
    try {
      renderOrchestrator(app);
      expect(globalThis.Router._setPolling).toHaveBeenCalledOnce();
      const [, delay] = (globalThis.Router._setPolling as Mock).mock.calls[0];
      expect(delay).toBe(5000);
    } finally { cleanupApp(app); }
  });

  it('renders empty state message when queue is empty', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([]);
      renderOrchestrator(app);
      await flushPromises();
      expect(app.innerHTML).toContain('No active runs');
    } finally { cleanupApp(app); }
  });

  it('renders a table row for each queue entry', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ id: 'e1' }),
        makeEntry({ id: 'e2' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      const rows = app.querySelectorAll('.orch-queue-row');
      expect(rows.length).toBe(2);
    } finally { cleanupApp(app); }
  });

  it('shows plan basename (not full path) in plan cell', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ planPath: '/long/path/to/plan.md' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      const planCell = app.querySelector('.orch-plan-cell');
      expect(planCell?.textContent?.trim()).toBe('plan.md');
    } finally { cleanupApp(app); }
  });

  it('shows full path as a tooltip on the plan cell', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ planPath: '/long/path/to/plan.md' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      const planCell = app.querySelector('.orch-plan-cell');
      expect(planCell?.getAttribute('title')).toBe('/long/path/to/plan.md');
    } finally { cleanupApp(app); }
  });

  it('renders a status badge for each entry', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ effectiveStatus: 'pending' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      const badge = app.querySelector('.badge-pending');
      expect(badge).not.toBeNull();
    } finally { cleanupApp(app); }
  });

  it('calls OrchestratorWidgets.renderProgressBadge for each entry', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry(),
        makeEntry({ id: 'entry-xyz' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      expect(globalThis.OrchestratorWidgets.renderProgressBadge).toHaveBeenCalledTimes(2);
    } finally { cleanupApp(app); }
  });
});

// ---------------------------------------------------------------------------
// AC-4: Per-status row actions
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-4: row actions', () => {
  it('shows kill button for pending entries', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ effectiveStatus: 'pending' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      expect(app.querySelector('.kill-btn')).not.toBeNull();
      expect(globalThis.OrchestratorWidgets.renderKillButton).toHaveBeenCalledOnce();
    } finally { cleanupApp(app); }
  });

  it('shows project link for started entries', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ effectiveStatus: 'started', expectedSlug: 'my-project' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      const link = app.querySelector('.orch-project-link') as HTMLAnchorElement | null;
      expect(link).not.toBeNull();
      expect(link?.href).toContain('/projects/');
      expect(link?.href).toContain('my-project');
    } finally { cleanupApp(app); }
  });

  it('shows dismiss button for dead entries', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ effectiveStatus: 'dead' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      expect(app.querySelector('.dismiss-btn')).not.toBeNull();
      expect(globalThis.OrchestratorWidgets.renderDismissButton).toHaveBeenCalledOnce();
    } finally { cleanupApp(app); }
  });
});

// ---------------------------------------------------------------------------
// AC-1: Preflight
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-1: preflight', () => {
  it('renders "Run Preflight" button', () => {
    const app = makeApp();
    try {
      renderOrchestrator(app);
      const btn = document.getElementById('orch-preflight-btn');
      expect(btn).not.toBeNull();
    } finally { cleanupApp(app); }
  });

  it('calls API.orchestratorStart(planPath, true) when "Run Preflight" clicked', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({ checks: [], started: false });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      const btn   = document.getElementById('orch-preflight-btn') as HTMLButtonElement;
      input.value = '/my/plan.md';
      btn.click();
      await flushPromises();
      expect(globalThis.API.orchestratorStart).toHaveBeenCalledWith('/my/plan.md', true);
    } finally { cleanupApp(app); }
  });

  it('renders pass items with preflight-pass class', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({
        checks: [{ name: 'Venv', pass: true, detail: 'OK' }],
        started: false,
      });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      expect(app.querySelector('.preflight-pass')).not.toBeNull();
    } finally { cleanupApp(app); }
  });

  it('renders fail items with preflight-fail class', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({
        checks: [{ name: 'MCP dist', pass: false, detail: 'Stale', fix: 'npm run build' }],
        started: false,
      });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      expect(app.querySelector('.preflight-fail')).not.toBeNull();
    } finally { cleanupApp(app); }
  });

  it('shows fix hint for failing checks', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({
        checks: [{ name: 'MCP dist', pass: false, detail: 'Stale', fix: 'npm run build' }],
        started: false,
      });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      expect(app.innerHTML).toContain('npm run build');
    } finally { cleanupApp(app); }
  });
});

// ---------------------------------------------------------------------------
// AC-2: Start Run button gating
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-2: start run button', () => {
  it('renders "Start Run" button disabled initially', () => {
    const app = makeApp();
    try {
      renderOrchestrator(app);
      const btn = document.getElementById('orch-start-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    } finally { cleanupApp(app); }
  });

  it('enables "Start Run" when all preflight checks pass', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({
        checks: [
          { name: 'Venv',    pass: true, detail: 'OK' },
          { name: 'MCP dist', pass: true, detail: 'Fresh' },
        ],
        started: false,
      });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      const startBtn = document.getElementById('orch-start-btn') as HTMLButtonElement;
      expect(startBtn.disabled).toBe(false);
    } finally { cleanupApp(app); }
  });

  it('keeps "Start Run" disabled when any preflight check fails', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn().mockResolvedValue({
        checks: [
          { name: 'Venv',     pass: true,  detail: 'OK' },
          { name: 'MCP dist', pass: false, detail: 'Stale' },
        ],
        started: false,
      });
      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      const startBtn = document.getElementById('orch-start-btn') as HTMLButtonElement;
      expect(startBtn.disabled).toBe(true);
    } finally { cleanupApp(app); }
  });

  it('calls API.orchestratorStart(planPath, false) when "Start Run" clicked', async () => {
    const app = makeApp();
    try {
      // First call (preflight, dryRun=true) returns all-pass.
      // Second call (start, dryRun=false) returns started=true.
      globalThis.API.orchestratorStart = vi.fn()
        .mockResolvedValueOnce({
          checks: [{ name: 'Venv', pass: true, detail: 'OK' }],
          started: false,
        })
        .mockResolvedValueOnce({ checks: [], started: true, pid: 9999 });

      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();

      (document.getElementById('orch-start-btn') as HTMLButtonElement).click();
      await flushPromises();

      expect(globalThis.API.orchestratorStart).toHaveBeenCalledTimes(2);
      expect(globalThis.API.orchestratorStart).toHaveBeenNthCalledWith(2, '/my/plan.md', false);
    } finally { cleanupApp(app); }
  });

  it('clears the plan path input after a successful start', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorStart = vi.fn()
        .mockResolvedValueOnce({
          checks: [{ name: 'Venv', pass: true, detail: 'OK' }],
          started: false,
        })
        .mockResolvedValueOnce({ checks: [], started: true });

      renderOrchestrator(app);
      const input = document.getElementById('orch-plan-path') as HTMLInputElement;
      input.value = '/my/plan.md';
      (document.getElementById('orch-preflight-btn') as HTMLButtonElement).click();
      await flushPromises();
      (document.getElementById('orch-start-btn') as HTMLButtonElement).click();
      await flushPromises();

      expect((document.getElementById('orch-plan-path') as HTMLInputElement).value).toBe('');
    } finally { cleanupApp(app); }
  });
});

// ---------------------------------------------------------------------------
// AC-5 + AC-7: Log preview cleanup
// ---------------------------------------------------------------------------

describe('renderOrchestrator — AC-5 + AC-7: log preview', () => {
  it('does not call renderLogPreview for a non-expanded row', async () => {
    const app = makeApp();
    try {
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ logFilename: 'run.jsonl', expectedSlug: 'proj' }),
      ]);
      renderOrchestrator(app);
      await flushPromises();
      expect(globalThis.OrchestratorWidgets.renderLogPreview).not.toHaveBeenCalled();
    } finally { cleanupApp(app); }
  });

  it('calls cleanup functions when renderOrchestrator is called a second time (AC-7)', async () => {
    const app = makeApp();
    try {
      const cleanup = vi.fn();
      globalThis.OrchestratorWidgets.renderLogPreview = vi.fn().mockReturnValue(cleanup);
      globalThis.API.orchestratorGetQueue = vi.fn().mockResolvedValue([
        makeEntry({ id: 'e1', logFilename: 'run.jsonl', expectedSlug: 'proj' }),
      ]);

      // First render — then manually expand a row and trigger a re-render via the toggle.
      renderOrchestrator(app);
      await flushPromises();

      // Click the expand toggle for 'e1' to push a cleanup into the module-level array.
      const toggleBtn = app.querySelector<HTMLButtonElement>('.orch-row-toggle[data-entry-id="e1"]');
      toggleBtn?.click();
      await flushPromises();

      // Second call to renderOrchestrator should drain cleanups from first render.
      const cleanup2 = vi.fn();
      globalThis.OrchestratorWidgets.renderLogPreview = vi.fn().mockReturnValue(cleanup2);
      renderOrchestrator(app);

      // The cleanup from the first render should have been called.
      expect(cleanup).toHaveBeenCalled();
    } finally { cleanupApp(app); }
  });
});
