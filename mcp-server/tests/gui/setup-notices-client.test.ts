// @vitest-environment jsdom

/**
 * Unit tests for gui/public/setup-notices.js
 *
 * Loads the browser-side IIFE with vm.runInThisContext, stubs globalThis.API,
 * and uses vi.useFakeTimers to control the polling interval — same pattern
 * as tests/gui/stale-check.test.ts, since SetupNotices is modelled on
 * StaleCheck's module shape (module-level state re-exec'd per test).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client script (evaluated once per test file, but re-exec'd per test)
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const setupNoticesJs = readFileSync(join(publicDir, 'setup-notices.js'), 'utf-8');

type Notice = { id: string; title: string; message: string; action?: { kind: string } };

declare global {
  // eslint-disable-next-line no-var
  var SetupNotices: { init: () => void; refresh: () => Promise<void> };
  // eslint-disable-next-line no-var
  var API: { getSetupNotices: () => Promise<{ notices: Notice[] }>; rebuildPersonas: () => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotice(overrides?: Partial<Notice>): Notice {
  return Object.assign(
    {
      id: 'personas-not-built',
      title: 'Personas have not been built yet',
      message: 'personas/name-mapping.json is missing.',
      action: { kind: 'rebuild-personas' },
    },
    overrides
  );
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function container(): HTMLElement | null {
  return document.getElementById('setup-notices');
}

function banners(): NodeListOf<Element> {
  return document.querySelectorAll('.setup-banner');
}

function buildBtn(): HTMLButtonElement | null {
  return document.querySelector('.setup-banner-btn');
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// setup-notices.js registers a *document*-level 'visibilitychange' listener
// (unlike stale-check.js, which only owns a setInterval). document persists
// across tests in this jsdom environment, so each vm.runInThisContext
// re-eval would otherwise accumulate one extra stale listener per test,
// each closing over its own test's long-dead module instance but still
// invoking the *current* global API mock when fired. Track every listener
// registered for that event and remove them all in afterEach.
let registeredVisibilityListeners: EventListener[] = [];

beforeEach(() => {
  vi.useFakeTimers();

  document.body.innerHTML = '<header></header><main><div id="app"></div></main>';

  registeredVisibilityListeners = [];
  const realAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(function (type, listener, options) {
    if (type === 'visibilitychange') registeredVisibilityListeners.push(listener as EventListener);
    return realAddEventListener(type, listener, options);
  });

  // Re-evaluate the IIFE with vm.runInThisContext so module-level state
  // (_container, _notices, _buildState, _intervalId, _listenerAttached) is
  // reset before every test — see stale-check.test.ts for the rationale.
  vm.runInThisContext(setupNoticesJs);
});

afterEach(() => {
  registeredVisibilityListeners.forEach((listener) => {
    document.removeEventListener('visibilitychange', listener);
  });
  registeredVisibilityListeners = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupNotices.init()', () => {
  it('calls API.getSetupNotices immediately on init', () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();

    expect(getSetupNotices).toHaveBeenCalledTimes(1);
  });

  it('inserts the #setup-notices live region with role=status and aria-live=polite', async () => {
    globalThis.API = { getSetupNotices: vi.fn().mockResolvedValue({ notices: [] }), rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    const el = container();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('inserts the container before <header> when no .stale-banner is present', async () => {
    globalThis.API = { getSetupNotices: vi.fn().mockResolvedValue({ notices: [] }), rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    const firstChild = document.body.firstElementChild;
    expect(firstChild?.id).toBe('setup-notices');
  });

  it('inserts the container immediately after an existing .stale-banner', async () => {
    const staleBanner = document.createElement('div');
    staleBanner.className = 'stale-banner';
    document.body.insertBefore(staleBanner, document.body.firstChild);

    globalThis.API = { getSetupNotices: vi.fn().mockResolvedValue({ notices: [] }), rebuildPersonas: vi.fn() };
    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(staleBanner.nextElementSibling?.id).toBe('setup-notices');
  });

  it('renders no banners when there are no notices', async () => {
    globalThis.API = { getSetupNotices: vi.fn().mockResolvedValue({ notices: [] }), rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(banners().length).toBe(0);
  });
});

describe('Banner rendering', () => {
  it('renders one .setup-banner per notice with title and message as text', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice()] }),
      rebuildPersonas: vi.fn(),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(banners().length).toBe(1);
    const banner = banners()[0];
    expect(banner.textContent).toContain('Personas have not been built yet');
    expect(banner.textContent).toContain('personas/name-mapping.json is missing.');
  });

  it('renders a real <button> labelled "Build personas" for a rebuild-personas notice', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice()] }),
      rebuildPersonas: vi.fn(),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    const btn = buildBtn();
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    expect(btn?.textContent).toBe('Build personas');
    expect(btn?.disabled).toBe(false);
  });

  it('renders no button for a notice without an action', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice({ action: undefined })] }),
      rebuildPersonas: vi.fn(),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(buildBtn()).toBeNull();
  });

  it('removes the banner once a later refresh finds no notices', async () => {
    const getSetupNotices = vi.fn()
      .mockResolvedValueOnce({ notices: [makeNotice()] })
      .mockResolvedValueOnce({ notices: [] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(banners().length).toBe(1);

    await globalThis.SetupNotices.refresh();
    expect(banners().length).toBe(0);
  });
});

describe('Build action — success, failure, conflict', () => {
  it('shows a disabled "Building…" state with an aria-hidden spinner while the build runs', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice()] }),
      rebuildPersonas: vi.fn(() => new Promise(() => {})), // never resolves
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    buildBtn()?.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    const btn = buildBtn();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toContain('Building…');
    const spinner = btn?.querySelector('.spinner');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
  });

  it('on success, refreshes and removes the banner once the notice clears', async () => {
    const getSetupNotices = vi.fn()
      .mockResolvedValueOnce({ notices: [makeNotice()] }) // init()
      .mockResolvedValueOnce({ notices: [] });            // post-build refresh()
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn().mockResolvedValue({ success: true }) };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    buildBtn()?.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    expect(banners().length).toBe(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(2);
  });

  it('on failure, shows a <details>/<summary> error block with the output in .pm-build-error-pre and a <code> hint', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice()] }),
      rebuildPersonas: vi.fn().mockRejectedValue({ code: 'BUILD_FAILED', message: 'boom: exit 1' }),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    buildBtn()?.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    const banner = banners()[0];
    const details = banner.querySelector('details.setup-banner-error');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary')?.textContent).toBe('Build failed');
    const pre = details?.querySelector('pre.pm-build-error-pre');
    expect(pre?.textContent).toBe('boom: exit 1');
    const code = details?.querySelector('code');
    expect(code?.textContent).toBe('node scripts/cli.js setup');

    // Button is re-enabled, ready for another attempt.
    expect(buildBtn()?.disabled).toBe(false);
    expect(buildBtn()?.textContent).toBe('Build personas');
  });

  it('on a 409 conflict, shows a disabled "Build already running…" state', async () => {
    globalThis.API = {
      getSetupNotices: vi.fn().mockResolvedValue({ notices: [makeNotice()] }),
      rebuildPersonas: vi.fn().mockRejectedValue({ code: 'CONFLICT', message: 'A persona build is already in progress.' }),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    buildBtn()?.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    const btn = buildBtn();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe('Build already running…');
  });

  it('a 409 does not stop polling — the next tick still calls getSetupNotices', async () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [makeNotice()] });
    globalThis.API = {
      getSetupNotices,
      rebuildPersonas: vi.fn().mockRejectedValue({ code: 'CONFLICT', message: 'busy' }),
    };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    buildBtn()?.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(2);
  });
});

describe('Polling lifecycle', () => {
  it('polls again after 30 seconds while a notice is present', async () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [makeNotice()] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the notice list is empty', async () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(1); // no further polls
  });

  it('restarts polling when a later refresh() finds a notice again', async () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    getSetupNotices.mockResolvedValue({ notices: [makeNotice()] });
    await globalThis.SetupNotices.refresh();
    expect(getSetupNotices).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(3);
  });

  it('is skipped while document.hidden and resumes with an immediate refresh on visible', async () => {
    const getSetupNotices = vi.fn().mockResolvedValue({ notices: [makeNotice()] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // While hidden, interval ticks must not call the API.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    // Becoming visible triggers an immediate refresh.
    expect(getSetupNotices).toHaveBeenCalledTimes(2);

    // And polling resumes.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(3);
  });
});

describe('Error handling', () => {
  it('continues polling silently when the API call rejects', async () => {
    const getSetupNotices = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ notices: [makeNotice()] });
    globalThis.API = { getSetupNotices, rebuildPersonas: vi.fn() };

    globalThis.SetupNotices.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(banners().length).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSetupNotices).toHaveBeenCalledTimes(2);
  });
});
