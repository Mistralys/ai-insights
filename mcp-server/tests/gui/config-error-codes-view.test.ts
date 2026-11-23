// @vitest-environment jsdom

/**
 * Tests for gui/public/views/config-error-codes.js (WP-013)
 *
 * Uses jsdom + vm.runInThisContext to load the real utils.js, components.js
 * and config-error-codes.js browser scripts together — escapeHtml()/UI.*
 * are exercised for real rather than stubbed, so the XSS-escaping
 * assertions are meaningful. API and configDirty are stubbed globals.
 *
 * Acceptance criteria covered:
 *   AC-1: provider list, descriptor-driven form for every field type
 *         (unknown → text), Save (PUT) / Test (POST) payload shape, plugins
 *         panel (dir/errors/empty state), temporary codes list, and
 *         <script>/<img onerror> never rendering as markup.
 *   AC-2: label/for, aria-describedby, required/aria-required, secret
 *         input contract (password/autocomplete/empty/Set-Not-set/Clear
 *         checkbox), dedicated aria-live region (not #config-msg),
 *         provider-switch unsaved-changes guard, Test button
 *         disable+"Testing…"+no-double-fire, re-entry cleanup (no
 *         duplicate listeners), and no positive tabindex anywhere.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { TEMPORARY_PREFIX_PATTERN } from '../../src/error-codes/config-store.js';

// ---------------------------------------------------------------------------
// Load real scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');

const utilsJs      = readFileSync(join(publicDir, 'utils.js'), 'utf-8');
const componentsJs = readFileSync(join(publicDir, 'components.js'), 'utf-8');
const ecJs         = readFileSync(join(publicDir, 'views/config-error-codes.js'), 'utf-8');

// ---------------------------------------------------------------------------
// Global type stubs
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var ecRenderTab: () => void;
  // eslint-disable-next-line no-var
  var ecCleanup: () => void;
  // eslint-disable-next-line no-var
  var ecResetState: () => void;
  // eslint-disable-next-line no-var
  var ecVisit: number;
  // eslint-disable-next-line no-var
  var EC_TEMPORARY_PREFIX_PATTERN: RegExp;
  // eslint-disable-next-line no-var
  var ecProviders: unknown;
  // eslint-disable-next-line no-var
  var ecConfig: unknown;
  // eslint-disable-next-line no-var
  var ecConfigWarning: string | null;
  // eslint-disable-next-line no-var
  var ecSelectedProviderId: string | null;
  // eslint-disable-next-line no-var
  var ecTestInFlight: boolean;
  // eslint-disable-next-line no-var
  var ecSaveInFlight: boolean;
  // eslint-disable-next-line no-var
  var configDirty: { errorCodes: boolean; [key: string]: boolean };
  // eslint-disable-next-line no-var
  var API: {
    getErrorCodeProviders: Mock;
    getErrorCodeConfig: Mock;
    getTemporaryErrorCodes: Mock;
    updateErrorCodeConfig: Mock;
    testErrorCodeProvider: Mock;
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const XSS_LABEL = '<script>alert(1)</script>';
const XSS_IMG = '<img src=x onerror=alert(1)>';

function makeProvidersResponse() {
  return {
    providers: [
      {
        id: 'file',
        label: 'File',
        description: 'File-backed ' + XSS_LABEL,
        settings: [
          { key: 'host', label: 'Host', type: 'string', required: true, description: 'Hostname' },
          { key: 'data_path', label: 'Data Path', type: 'path' },
          { key: 'endpoint', label: 'Endpoint', type: 'url' },
          { key: 'api_key', label: 'API Key ' + XSS_LABEL, type: 'secret', required: true },
          { key: 'extra_secret', label: 'Extra Secret', type: 'secret' },
          { key: 'count', label: 'Count', type: 'integer', min: 1, max: 10 },
          { key: 'enabled', label: 'Enabled', type: 'boolean' },
          { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
          { key: 'weird', label: 'Weird Field', type: 'totally-unknown-type' },
        ],
        supports_test: true,
        source: 'builtin',
      },
      {
        id: 'plugin-one',
        label: 'Plugin One',
        settings: [],
        supports_test: false,
        source: 'plugin',
        path: '/home/user/.ai-insights/plugins/error-codes/plugin-one.js',
      },
    ],
    plugin_dir: '/home/user/.ai-insights/plugins/error-codes',
    load_errors: [{ source: '/home/user/.ai-insights/plugins/error-codes/bad.js', message: 'broken ' + XSS_IMG }],
  };
}

function makeConfigResponse() {
  return {
    active_provider: 'file',
    temporary_prefix: '777',
    timeout_ms: 10000,
    retry: { default_wait_ms: 1000, max_wait_ms: 5000 },
    providers: {
      file: {
        host: 'localhost',
        data_path: '/tmp/data',
        endpoint: 'https://example.com',
        api_key: { set: true },
        extra_secret: { set: false },
        count: 5,
        enabled: true,
        mode: 'a',
        weird: 'raw-value',
      },
      'plugin-one': {},
    },
  };
}

function makeTemporaryResponse() {
  return {
    entries: [
      { code: '7770001', issued_at: '2026-01-01T00:00:00Z', provider: 'file', fallback_reason: 'timeout', detail: null, repository: 'repo-a', context: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  vm.runInThisContext(utilsJs);
  vm.runInThisContext(componentsJs);
  vm.runInThisContext(ecJs);
});

function resetEcModuleState(): void {
  // The module's own reset (also invalidates any callback still pending from an earlier test), plus the one flag it deliberately keeps.
  globalThis.ecResetState();
  globalThis.ecSaveInFlight = false;
}

beforeEach(() => {
  resetEcModuleState();
  globalThis.configDirty = { errorCodes: false };
  globalThis.API = {
    getErrorCodeProviders: vi.fn().mockResolvedValue(makeProvidersResponse()),
    getErrorCodeConfig: vi.fn().mockResolvedValue(makeConfigResponse()),
    getTemporaryErrorCodes: vi.fn().mockResolvedValue(makeTemporaryResponse()),
    updateErrorCodeConfig: vi.fn().mockResolvedValue(makeConfigResponse()),
    testErrorCodeProvider: vi.fn().mockResolvedValue({ supported: true, secrets_merged: false, ok: true, value: 42 }),
  };
  document.body.innerHTML = '<div id="config-tab-content"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function contentEl(): HTMLElement {
  return document.getElementById('config-tab-content') as HTMLElement;
}

async function renderAndLoad(): Promise<void> {
  ecRenderTab();
  await flushPromises();
}

// ---------------------------------------------------------------------------
// AC-1: Rendering
// ---------------------------------------------------------------------------

describe('ecRenderTab — AC-1: provider list and form rendering', () => {
  it('lists every provider in the provider select', async () => {
    await renderAndLoad();
    const select = contentEl().querySelector('#ec-provider-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['file', 'plugin-one']);
    expect(select.value).toBe('file');
  });

  it('renders a text input for string/path fields', async () => {
    await renderAndLoad();
    const host = contentEl().querySelector('#ec-field-host') as HTMLInputElement;
    expect(host.tagName).toBe('INPUT');
    expect(host.type).toBe('text');
    expect(host.value).toBe('localhost');

    const dataPath = contentEl().querySelector('#ec-field-data_path') as HTMLInputElement;
    expect(dataPath.type).toBe('text');
    expect(dataPath.value).toBe('/tmp/data');
  });

  it('renders a type=url input for url fields', async () => {
    await renderAndLoad();
    const endpoint = contentEl().querySelector('#ec-field-endpoint') as HTMLInputElement;
    expect(endpoint.type).toBe('url');
    expect(endpoint.value).toBe('https://example.com');
  });

  it('renders a number input with min/max for integer fields', async () => {
    await renderAndLoad();
    const count = contentEl().querySelector('#ec-field-count') as HTMLInputElement;
    expect(count.type).toBe('number');
    expect(count.min).toBe('1');
    expect(count.max).toBe('10');
    expect(count.value).toBe('5');
  });

  it('renders a checkbox for boolean fields', async () => {
    await renderAndLoad();
    const enabled = contentEl().querySelector('#ec-field-enabled') as HTMLInputElement;
    expect(enabled.type).toBe('checkbox');
    expect(enabled.checked).toBe(true);
  });

  it('renders a <select> for select fields with the stored value chosen', async () => {
    await renderAndLoad();
    const mode = contentEl().querySelector('#ec-field-mode') as HTMLSelectElement;
    expect(mode.tagName).toBe('SELECT');
    expect(mode.value).toBe('a');
    expect(Array.from(mode.options).map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('renders a text input for an unknown descriptor type', async () => {
    await renderAndLoad();
    const weird = contentEl().querySelector('#ec-field-weird') as HTMLInputElement;
    expect(weird.tagName).toBe('INPUT');
    expect(weird.type).toBe('text');
  });

  it('shows the plugin directory, installed plugins and load errors', async () => {
    await renderAndLoad();
    const html = contentEl().innerHTML;
    const dirInput = contentEl().querySelector('#ec-plugin-dir') as HTMLInputElement;
    expect(dirInput.value).toBe('/home/user/.ai-insights/plugins/error-codes');
    expect(html).toContain('Plugin One');
    expect(html).toContain('plugin-one.js');
    expect(html).toContain('broken');
  });

  it('shows an empty state when no plugins are installed', async () => {
    globalThis.API.getErrorCodeProviders = vi.fn().mockResolvedValue({
      providers: [makeProvidersResponse().providers[0]],
      plugin_dir: '/home/user/.ai-insights/plugins/error-codes',
      load_errors: [],
    });
    await renderAndLoad();
    expect(contentEl().innerHTML).toContain('No plugins installed.');
  });

  it('lists temporary codes', async () => {
    await renderAndLoad();
    expect(contentEl().innerHTML).toContain('7770001');
  });

  it('shows an empty state when no temporary codes are logged', async () => {
    globalThis.API.getTemporaryErrorCodes = vi.fn().mockResolvedValue({ entries: [] });
    await renderAndLoad();
    expect(contentEl().innerHTML).toContain('No temporary codes logged.');
  });

  it('never renders a <script> or <img onerror> payload as markup', async () => {
    await renderAndLoad();
    const html = contentEl().innerHTML;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('sends the expected Save (PUT) payload', async () => {
    await renderAndLoad();
    (contentEl().querySelector('#ec-field-host') as HTMLInputElement).value = 'newhost';
    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
    const body = globalThis.API.updateErrorCodeConfig.mock.calls[0][0];
    expect(body.active_provider).toBe('file');
    expect(body.provider_id).toBe('file');
    expect(body.settings.host).toBe('newhost');
    expect(body.temporary_prefix).toBe('777');
    expect(body.timeout_ms).toBe(10000);
    expect(body.retry).toEqual({ default_wait_ms: 1000, max_wait_ms: 5000 });
  });

  it('sends the expected Test (POST) payload', async () => {
    await renderAndLoad();
    const testBtn = contentEl().querySelector('#ec-test-btn') as HTMLButtonElement;
    testBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    expect(globalThis.API.testErrorCodeProvider).toHaveBeenCalledTimes(1);
    const [providerId, settings] = globalThis.API.testErrorCodeProvider.mock.calls[0];
    expect(providerId).toBe('file');
    expect(settings.host).toBe('localhost');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Accessibility and interaction contracts
// ---------------------------------------------------------------------------

describe('ecRenderTab — AC-2: accessibility and interaction contracts', () => {
  it('every generated control has a matching <label for>', async () => {
    await renderAndLoad();
    const controls = contentEl().querySelectorAll('input[id^="ec-"], select[id^="ec-"]');
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach((ctrl) => {
      const id = ctrl.getAttribute('id');
      const label = contentEl().querySelector('label[for="' + id + '"]');
      expect(label, 'missing label for #' + id).toBeTruthy();
    });
  });

  it('links descriptions via aria-describedby', async () => {
    await renderAndLoad();
    const host = contentEl().querySelector('#ec-field-host') as HTMLInputElement;
    const describedBy = host.getAttribute('aria-describedby');
    expect(describedBy).toBe('ec-field-host-desc');
    expect(contentEl().querySelector('#' + describedBy)?.textContent).toBe('Hostname');
  });

  it('required non-secret fields carry required and aria-required="true"', async () => {
    await renderAndLoad();
    const host = contentEl().querySelector('#ec-field-host') as HTMLInputElement;
    expect(host.required).toBe(true);
    expect(host.getAttribute('aria-required')).toBe('true');
  });

  it('secret inputs are type=password, autocomplete=new-password, and start empty', async () => {
    await renderAndLoad();
    const apiKey = contentEl().querySelector('#ec-field-api_key') as HTMLInputElement;
    expect(apiKey.type).toBe('password');
    expect(apiKey.autocomplete).toBe('new-password');
    expect(apiKey.value).toBe('');
  });

  it('shows the Set/Not-set state as text, independent of the stored value', async () => {
    await renderAndLoad();
    const html = contentEl().innerHTML;
    expect(html).toContain('Set');
    expect(html).toContain('Not set');
  });

  it('a required secret already Set omits native required but keeps aria-required="true"', async () => {
    await renderAndLoad();
    const apiKey = contentEl().querySelector('#ec-field-api_key') as HTMLInputElement; // required, set: true
    expect(apiKey.required).toBe(false);
    expect(apiKey.getAttribute('aria-required')).toBe('true');
  });

  it('shows the Clear-stored-value checkbox only when the secret is set', async () => {
    await renderAndLoad();
    expect(contentEl().querySelector('#ec-field-api_key-clear')).toBeTruthy(); // set: true
    expect(contentEl().querySelector('#ec-field-extra_secret-clear')).toBeNull(); // set: false
  });

  it('ticking Clear-stored-value disables and empties the input, and is sent as clear_secrets', async () => {
    await renderAndLoad();
    const clearCheckbox = contentEl().querySelector('#ec-field-api_key-clear') as HTMLInputElement;
    const apiKeyInput = contentEl().querySelector('#ec-field-api_key') as HTMLInputElement;
    apiKeyInput.value = 'typed-but-will-be-cleared';

    clearCheckbox.checked = true;
    clearCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(apiKeyInput.disabled).toBe(true);
    expect(apiKeyInput.value).toBe('');

    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const body = globalThis.API.updateErrorCodeConfig.mock.calls[0][0];
    expect(body.clear_secrets).toEqual(['api_key']);
    expect(body.settings.api_key).toBeUndefined();
  });

  it('writes Save results to the dedicated aria-live region, not #config-msg', async () => {
    await renderAndLoad();
    expect(contentEl().querySelector('#config-msg')).toBeNull();
    const liveRegion = contentEl().querySelector('#ec-live-region') as HTMLElement;
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById('ec-live-region')?.textContent).toContain('saved');
    expect(document.getElementById('config-msg')).toBeNull();
  });

  it('writes Test results to the dedicated aria-live region', async () => {
    await renderAndLoad();
    const testBtn = contentEl().querySelector('#ec-test-btn') as HTMLButtonElement;
    testBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();
    expect(document.getElementById('ec-live-region')?.textContent).toContain('OK');
  });

  it('switching providers with unsaved edits triggers the confirm guard, and reverts on cancel', async () => {
    await renderAndLoad();
    (contentEl().querySelector('#ec-field-host') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    expect(globalThis.configDirty.errorCodes).toBe(true);

    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const select = contentEl().querySelector('#ec-provider-select') as HTMLSelectElement;
    select.value = 'plugin-one';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('file'); // reverted
    expect(globalThis.ecSelectedProviderId).toBe('file');
  });

  it('switching providers with unsaved edits proceeds and clears dirty state on confirm', async () => {
    await renderAndLoad();
    (contentEl().querySelector('#ec-field-host') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    expect(globalThis.configDirty.errorCodes).toBe(true);

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const select = contentEl().querySelector('#ec-provider-select') as HTMLSelectElement;
    select.value = 'plugin-one';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(globalThis.ecSelectedProviderId).toBe('plugin-one');
    expect(globalThis.configDirty.errorCodes).toBe(false);
    expect((contentEl().querySelector('#ec-provider-select') as HTMLSelectElement).value).toBe('plugin-one');
  });

  it('Test connection disables itself and reads "Testing…" while pending, and ignores a second click', async () => {
    await renderAndLoad();
    let resolveTest: (value: unknown) => void = () => {};
    globalThis.API.testErrorCodeProvider = vi.fn().mockReturnValue(new Promise((resolve) => { resolveTest = resolve; }));

    const testBtn = contentEl().querySelector('#ec-test-btn') as HTMLButtonElement;
    testBtn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(testBtn.disabled).toBe(true);
    expect(testBtn.textContent).toContain('Testing');

    // Second click while pending must not fire a second request.
    testBtn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(globalThis.API.testErrorCodeProvider).toHaveBeenCalledTimes(1);

    resolveTest({ supported: true, secrets_merged: false, ok: true });
    await flushPromises();
    expect(testBtn.disabled).toBe(false);
    expect(testBtn.textContent).toBe('Test connection');
  });

  it('re-entering the tab runs cleanup and does not duplicate event handling', async () => {
    await renderAndLoad();

    // Simulate leaving the tab (config.js's cleanup branch) and re-entering.
    ecCleanup();
    resetEcModuleState();
    await renderAndLoad();

    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
  });

  it('no interactive control carries a positive tabindex', async () => {
    await renderAndLoad();
    const withTabindex = contentEl().querySelectorAll('[tabindex]');
    withTabindex.forEach((el) => {
      const value = parseInt(el.getAttribute('tabindex') || '0', 10);
      expect(value).toBeLessThanOrEqual(0);
    });
  });

  it('every interactive control is a native focusable element', async () => {
    await renderAndLoad();
    const interactive = contentEl().querySelectorAll('[data-ec-key], [data-ec-clear-key], #ec-provider-select, #ec-save-btn, #ec-test-btn');
    interactive.forEach((el) => {
      expect(['INPUT', 'SELECT', 'BUTTON']).toContain(el.tagName);
    });
  });
});

// ---------------------------------------------------------------------------
// Save in-flight guard (rework: AC-01..AC-03)
// ---------------------------------------------------------------------------

describe('ecHandleSave — in-flight guard', () => {
  const submitForm = (): void => {
    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  it('ignores a second submit while pending and re-enables after success', async () => {
    await renderAndLoad();
    let resolveSave: (value: unknown) => void = () => {};
    globalThis.API.updateErrorCodeConfig = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));

    submitForm();
    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);

    resolveSave(makeConfigResponse());
    await flushPromises();
    expect(globalThis.ecSaveInFlight).toBe(false);

    globalThis.API.updateErrorCodeConfig = vi.fn().mockResolvedValue(makeConfigResponse());
    submitForm();
    await flushPromises();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
  });

  it('ignores a second submit while pending and re-enables after failure', async () => {
    await renderAndLoad();
    let rejectSave: (reason: unknown) => void = () => {};
    globalThis.API.updateErrorCodeConfig = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));

    submitForm();
    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);

    rejectSave(new Error('boom'));
    await flushPromises();
    const saveBtn = contentEl().querySelector('#ec-save-btn') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.textContent).toBe('Save');

    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(2);
  });

  it('sends no second request for requestSubmit() while pending', async () => {
    await renderAndLoad();
    globalThis.API.updateErrorCodeConfig = vi.fn().mockReturnValue(new Promise(() => {}));
    const form = contentEl().querySelector('#ec-form') as HTMLFormElement;

    form.requestSubmit();
    form.requestSubmit();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
  });

  it('a Save blocked by validation does not set the in-flight flag', async () => {
    await renderAndLoad();
    const form = contentEl().querySelector('#ec-form') as HTMLFormElement;
    const validity = vi.spyOn(form, 'reportValidity').mockReturnValueOnce(false).mockReturnValue(true);

    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).not.toHaveBeenCalled();
    expect(globalThis.ecSaveInFlight).toBe(false);

    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
    expect(validity).toHaveBeenCalledTimes(2);
  });

  it('index.html loads config-error-codes.js with the bumped cache-buster', () => {
    const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('/views/config-error-codes.js?v=3');
    expect(indexHtml).toContain('/views/config.js?v=6');
    expect(indexHtml).toContain('/api-client.js?v=7');
  });

  it('config.js references the Error Codes module only through its CONFIG_TABS descriptor (ecResetState), never a direct field', () => {
    const configJs = readFileSync(join(publicDir, 'views/config.js'), 'utf-8');
    expect(configJs).toContain('ecResetState');
    expect(configJs).toMatch(/leave:\s*function\s*\(\)\s*\{\s*ecResetState\(\);\s*\}/);
    expect(configJs).toMatch(/reset:\s*function\s*\(\)\s*\{\s*ecResetState\(\);\s*\}/);
    expect(configJs).not.toContain('ecProviders = ecConfig = null');
    expect(configJs).not.toMatch(/\becProviders\b|\becConfig\b|\becSelectedProviderId\b/);
  });
});

// ---------------------------------------------------------------------------
// Stale callbacks after leaving the tab (visit token)
// ---------------------------------------------------------------------------

describe('stale callbacks after leaving the tab', () => {
  const SENTINEL = '<p id="other-tab">another tab</p>';

  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const submitForm = (): void => {
    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  /** Simulates config.js leaving the tab: reset state, then another tab renders into the shared container. */
  function leaveTab(): void {
    globalThis.ecResetState();
    contentEl().innerHTML = SENTINEL;
  }

  it('(a) a pending initial load does not overwrite the next tab or repopulate cleared state', async () => {
    const providers = deferred<ReturnType<typeof makeProvidersResponse>>();
    globalThis.API.getErrorCodeProviders = vi.fn().mockReturnValue(providers.promise);

    ecRenderTab();
    leaveTab();
    providers.resolve(makeProvidersResponse());
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.ecProviders).toBeNull();
    expect(globalThis.ecConfig).toBeNull();
  });

  it('(a2) a pending initial load that then fails does not write an error into the next tab', async () => {
    const providers = deferred<unknown>();
    globalThis.API.getErrorCodeProviders = vi.fn().mockReturnValue(providers.promise);

    ecRenderTab();
    leaveTab();
    providers.reject(new Error('network down'));
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
  });

  it('(b) leaving and re-entering while the first load is pending: the DOM reflects the second load', async () => {
    const first = deferred<ReturnType<typeof makeProvidersResponse>>();
    globalThis.API.getErrorCodeProviders = vi.fn().mockReturnValue(first.promise);
    ecRenderTab();

    globalThis.ecResetState();
    globalThis.API.getErrorCodeProviders = vi.fn().mockResolvedValue(makeProvidersResponse());
    globalThis.API.getErrorCodeConfig = vi.fn().mockResolvedValue({ ...makeConfigResponse(), temporary_prefix: '888' });
    ecRenderTab();
    await flushPromises();
    expect((contentEl().querySelector('#ec-core-temporary-prefix') as HTMLInputElement).value).toBe('888');

    first.resolve(makeProvidersResponse());
    await flushPromises();
    expect((contentEl().querySelector('#ec-core-temporary-prefix') as HTMLInputElement).value).toBe('888');
  });

  it('(c) a Save settling after the exit leaves the next tab and cleared state alone, and still clears ecSaveInFlight', async () => {
    await renderAndLoad();
    const save = deferred<ReturnType<typeof makeConfigResponse>>();
    globalThis.API.updateErrorCodeConfig = vi.fn().mockReturnValue(save.promise);

    submitForm();
    expect(globalThis.ecSaveInFlight).toBe(true);
    leaveTab();
    expect(globalThis.ecSaveInFlight).toBe(true); // spans visits: a pending PUT still blocks a second save

    save.resolve(makeConfigResponse());
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.ecConfig).toBeNull();
    expect(globalThis.ecSaveInFlight).toBe(false);
  });

  it('(d) a Save failing after the exit writes no message into the next tab', async () => {
    await renderAndLoad();
    const save = deferred<unknown>();
    globalThis.API.updateErrorCodeConfig = vi.fn().mockReturnValue(save.promise);

    submitForm();
    leaveTab();
    save.reject(new Error('server said no'));
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.ecSaveInFlight).toBe(false);
  });

  it('(e) a Test settling late does not unlock a newer visit\'s pending test', async () => {
    await renderAndLoad();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    globalThis.API.testErrorCodeProvider = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    (contentEl().querySelector('#ec-test-btn') as HTMLButtonElement).click();
    expect(globalThis.ecTestInFlight).toBe(true);

    globalThis.ecResetState();
    expect(globalThis.ecTestInFlight).toBe(false);
    await renderAndLoad();
    (contentEl().querySelector('#ec-test-btn') as HTMLButtonElement).click();
    expect(globalThis.ecTestInFlight).toBe(true);

    first.resolve({ supported: true, ok: true, value: 1 });
    await flushPromises();
    expect(globalThis.ecTestInFlight).toBe(true); // still the second visit's test

    second.resolve({ supported: true, ok: true, value: 2 });
    await flushPromises();
    expect(globalThis.ecTestInFlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Temporary-codes list failure / warning
// ---------------------------------------------------------------------------

describe('temporary codes card — failure and warning', () => {
  it('a rejected temporary-codes fetch still renders the settings form, with an error banner in the card', async () => {
    globalThis.API.getTemporaryErrorCodes = vi.fn().mockRejectedValue(new Error('log is unreadable'));

    await renderAndLoad();

    expect(contentEl().querySelector('#ec-form')).toBeTruthy();
    expect(contentEl().innerHTML).toContain('Temporary codes could not be loaded: log is unreadable');
  });

  it('renders a listing warning as escaped text', async () => {
    globalThis.API.getTemporaryErrorCodes = vi.fn().mockResolvedValue({
      entries: makeTemporaryResponse().entries,
      warning: 'temporary-codes.json is corrupt ' + XSS_LABEL,
    });

    await renderAndLoad();

    expect(contentEl().innerHTML).toContain('temporary-codes.json is corrupt');
    expect(contentEl().innerHTML).not.toContain('<script>alert(1)</script>');
    expect(contentEl().innerHTML).toContain('&lt;script&gt;');
    expect(contentEl().querySelector('.ec-temporary-table')).toBeTruthy(); // the recoverable entries still show
  });

  it('shows no banner when the listing carries no warning', async () => {
    await renderAndLoad();
    expect(contentEl().innerHTML).not.toContain('error-banner');
  });
});

// ---------------------------------------------------------------------------
// Config salvage warning banner (WP-006)
// ---------------------------------------------------------------------------

describe('config warning banner', () => {
  it('shows no banner when the config response carries no warning', async () => {
    await renderAndLoad();
    expect(contentEl().innerHTML).not.toContain('error-banner');
  });

  it('renders the config warning as an escaped banner above the settings form', async () => {
    globalThis.API.getErrorCodeConfig = vi.fn().mockResolvedValue({
      ...makeConfigResponse(),
      warning: 'config.json has invalid fields (timeout_ms) ' + XSS_LABEL,
    });

    await renderAndLoad();

    const html = contentEl().innerHTML;
    expect(html).toContain('error-banner');
    expect(html).toContain('config.json has invalid fields (timeout_ms)');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(contentEl().querySelector('#ec-form')).toBeTruthy(); // the form still renders
  });

  it('clears the warning on ecResetState() so a later tab re-entry starts clean', async () => {
    globalThis.API.getErrorCodeConfig = vi.fn().mockResolvedValue({
      ...makeConfigResponse(),
      warning: 'config.json is not valid JSON; using the defaults',
    });

    await renderAndLoad();
    expect(contentEl().innerHTML).toContain('error-banner');

    globalThis.ecResetState();
    expect(globalThis.ecConfigWarning).toBeNull();

    document.body.innerHTML = '<div id="config-tab-content"></div>';
    globalThis.API.getErrorCodeConfig = vi.fn().mockResolvedValue(makeConfigResponse());
    await renderAndLoad();
    expect(contentEl().innerHTML).not.toContain('error-banner');
  });

  it('clears the warning after a successful save, when the PUT response carries none', async () => {
    globalThis.API.getErrorCodeConfig = vi.fn().mockResolvedValue({
      ...makeConfigResponse(),
      warning: 'config.json is not valid JSON; using the defaults',
    });
    await renderAndLoad();
    expect(contentEl().innerHTML).toContain('error-banner');

    globalThis.API.updateErrorCodeConfig = vi.fn().mockResolvedValue(makeConfigResponse());
    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises();

    expect(globalThis.ecConfigWarning).toBeNull();
    expect(contentEl().innerHTML).not.toContain('error-banner');
  });
});

// ---------------------------------------------------------------------------
// Temporary prefix validation
// ---------------------------------------------------------------------------

describe('temporary prefix validation', () => {
  const submitForm = (): void => {
    (contentEl().querySelector('#ec-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  it('the input carries the digit pattern, numeric inputmode, maxlength and a description', async () => {
    await renderAndLoad();
    const input = contentEl().querySelector('#ec-core-temporary-prefix') as HTMLInputElement;
    expect(input.getAttribute('pattern')).toBe('[1-9][0-9]{0,5}');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('6');
    expect(input.getAttribute('aria-describedby')).toBe('ec-core-temporary-prefix-desc');
    expect(contentEl().querySelector('#ec-core-temporary-prefix-desc')).toBeTruthy();
  });

  it.each(['ERR', '0777', '1234567', ''])('rejects "%s" before sending, with the documented message', async (bad) => {
    await renderAndLoad();
    const form = contentEl().querySelector('#ec-form') as HTMLFormElement;
    vi.spyOn(form, 'reportValidity').mockReturnValue(true); // exercise the script's own check, not the browser's
    (contentEl().querySelector('#ec-core-temporary-prefix') as HTMLInputElement).value = bad;

    submitForm();

    expect(globalThis.API.updateErrorCodeConfig).not.toHaveBeenCalled();
    expect(globalThis.ecSaveInFlight).toBe(false);
    expect(contentEl().querySelector('#ec-live-region')!.textContent).toContain('Temporary prefix must be 1\u20136 digits and must not start with 0.');
  });

  it('sends a valid prefix', async () => {
    await renderAndLoad();
    (contentEl().querySelector('#ec-core-temporary-prefix') as HTMLInputElement).value = '4242';
    submitForm();
    expect(globalThis.API.updateErrorCodeConfig).toHaveBeenCalledTimes(1);
    expect((globalThis.API.updateErrorCodeConfig.mock.calls[0]![0] as { temporary_prefix: string }).temporary_prefix).toBe('4242');
  });

  it('mirrors the server pattern exactly', () => {
    expect(globalThis.EC_TEMPORARY_PREFIX_PATTERN.source).toBe(TEMPORARY_PREFIX_PATTERN.source);
  });
});
