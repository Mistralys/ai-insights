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
  var ecProviders: unknown;
  // eslint-disable-next-line no-var
  var ecConfig: unknown;
  // eslint-disable-next-line no-var
  var ecSelectedProviderId: string | null;
  // eslint-disable-next-line no-var
  var ecTestInFlight: boolean;
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
  globalThis.ecProviders = null;
  (globalThis as Record<string, unknown>)['ecConfig'] = null;
  (globalThis as Record<string, unknown>)['ecPluginDir'] = '';
  (globalThis as Record<string, unknown>)['ecLoadErrors'] = [];
  (globalThis as Record<string, unknown>)['ecTemporaryCodes'] = null;
  globalThis.ecSelectedProviderId = null;
  globalThis.ecTestInFlight = false;
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
