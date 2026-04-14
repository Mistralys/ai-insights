// @vitest-environment jsdom

/**
 * Unit tests for gui/public/stale-check.js
 *
 * Loads the browser-side IIFE with vm.runInThisContext, stubs globalThis.API,
 * and uses vi.useFakeTimers to control the polling interval.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client script (evaluated once per test file, but re-exec'd per test)
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const staleCheckJs = readFileSync(join(publicDir, 'stale-check.js'), 'utf-8');

// TypeScript declarations for globals injected by the IIFE
declare global {
  // eslint-disable-next-line no-var
  var StaleCheck: { init: () => void };
  // eslint-disable-next-line no-var
  var API: { getServerInfo: () => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServerInfo(stale: boolean, overrides: Record<string, string> = {}) {
  const base = { mcpServer: '1.0.0', personas: '2.0.0', orchestrator: '3.0.0' };
  const disk = { ...base, ...overrides };
  return { stale, bootVersions: base, diskVersions: disk };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();

  // Reset DOM: fresh <header> so banner-insertion tests are deterministic
  document.body.innerHTML = '<header></header><main><div id="app"></div></main>';

  // Re-evaluate the IIFE with vm.runInThisContext so that the module-level
  // variables (_bannerInserted, _intervalId) are reset before every test.
  //
  // Why not a normal `import`? stale-check.js is an IIFE that captures its
  // private state at evaluation time. Node's module cache means a standard
  // `import` (or even `require`) would return the already-evaluated module
  // on the second and subsequent calls, leaving _bannerInserted=true or a
  // live _intervalId from a previous test. vm.runInThisContext re-executes
  // the source string in the current V8 context on every beforeEach, so
  // each test starts with a completely fresh StaleCheck instance.
  vm.runInThisContext(staleCheckJs);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StaleCheck.init()', () => {
  it('calls API.getServerInfo immediately on init', () => {
    const getServerInfo = vi.fn().mockResolvedValue(makeServerInfo(false));
    globalThis.API = { getServerInfo };

    globalThis.StaleCheck.init();

    expect(getServerInfo).toHaveBeenCalledTimes(1);
  });

  it('polls again after 30 seconds', async () => {
    const getServerInfo = vi.fn().mockResolvedValue(makeServerInfo(false));
    globalThis.API = { getServerInfo };

    globalThis.StaleCheck.init();
    expect(getServerInfo).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);    // flush the immediate promise
    await vi.advanceTimersByTimeAsync(30_000); // fire one interval tick

    expect(getServerInfo).toHaveBeenCalledTimes(2);
  });

  it('does not insert a banner when stale is false', async () => {
    globalThis.API = { getServerInfo: vi.fn().mockResolvedValue(makeServerInfo(false)) };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate promise

    expect(document.querySelector('.stale-banner')).toBeNull();
  });
});

describe('Banner insertion when stale', () => {
  it('inserts a .stale-banner element when stale is true', async () => {
    globalThis.API = { getServerInfo: vi.fn().mockResolvedValue(makeServerInfo(true)) };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('.stale-banner')).not.toBeNull();
  });

  it('inserts the banner before <header> (first child of body)', async () => {
    globalThis.API = { getServerInfo: vi.fn().mockResolvedValue(makeServerInfo(true)) };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    const firstChild = document.body.firstElementChild;
    expect(firstChild?.classList.contains('stale-banner')).toBe(true);
  });

  it('stops polling after the banner is inserted', async () => {
    const getServerInfo = vi.fn().mockResolvedValue(makeServerInfo(true));
    globalThis.API = { getServerInfo };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    // Banner shown — advance time; polling should be stopped
    await vi.advanceTimersByTimeAsync(60_000);

    // Should not have been called more than once (the initial call)
    expect(getServerInfo).toHaveBeenCalledTimes(1);
  });

  it('lists only components whose versions differ', async () => {
    const info = makeServerInfo(true, { mcpServer: '1.1.0' }); // only mcpServer changed
    globalThis.API = { getServerInfo: vi.fn().mockResolvedValue(info) };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    const banner = document.querySelector('.stale-banner');
    expect(banner?.textContent).toContain('MCP Server');
    expect(banner?.textContent).toContain('1.0.0');
    expect(banner?.textContent).toContain('1.1.0');
    // Unchanged components must NOT appear
    expect(banner?.textContent).not.toContain('Personas');
    expect(banner?.textContent).not.toContain('Orchestrator');
  });

  it('does not insert a second banner on repeated stale responses', async () => {
    const getServerInfo = vi.fn().mockResolvedValue(makeServerInfo(true));
    globalThis.API = { getServerInfo };

    globalThis.StaleCheck.init();
    await vi.runAllTimersAsync();

    // Simulate a second stale response (should not happen in practice because
    // polling stops, but guard against the _bannerInserted flag failing)
    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelectorAll('.stale-banner').length).toBe(1);
  });
});

describe('Error handling', () => {
  it('continues polling silently when the API call rejects', async () => {
    const getServerInfo = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(makeServerInfo(false));
    globalThis.API = { getServerInfo };

    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    // No banner, no crash
    expect(document.querySelector('.stale-banner')).toBeNull();

    // Next poll fires normally
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getServerInfo).toHaveBeenCalledTimes(2);
  });

  it('does not throw if API is called before DOM has a <header>', async () => {
    document.body.innerHTML = '<main><div id="app"></div></main>'; // no <header>
    const info = makeServerInfo(true, { personas: '2.1.0' });
    globalThis.API = { getServerInfo: vi.fn().mockResolvedValue(info) };

    // Should insert banner as document.body.firstChild instead
    globalThis.StaleCheck.init();
    await vi.advanceTimersByTimeAsync(0);

    const firstChild = document.body.firstElementChild;
    expect(firstChild?.classList.contains('stale-banner')).toBe(true);
  });
});
