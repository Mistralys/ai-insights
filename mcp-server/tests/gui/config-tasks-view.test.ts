// @vitest-environment jsdom

/**
 * Tests for gui/public/views/config-tasks.js (WP-015).
 * Loads the real utils.js and config-tasks.js; API and configDirty are stubs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
const read = (p: string) => readFileSync(join(publicDir, p), 'utf-8');

declare global {
  // eslint-disable-next-line no-var
  var ctRenderTab: (config: unknown) => void;
  // eslint-disable-next-line no-var
  var ctResetState: () => void;
  // eslint-disable-next-line no-var
  var ctSaveInFlight: boolean;
  // eslint-disable-next-line no-var
  var configDirty: { tasks: boolean; [k: string]: boolean };
  // eslint-disable-next-line no-var
  var API: { updateConfig: ReturnType<typeof vi.fn> };
}

beforeAll(() => {
  vm.runInThisContext(read('utils.js'));
  vm.runInThisContext(read('views/config-tasks.js'));
});

function makeConfig() {
  return { tasks_ticket_base_url: 'https://t.example/browse/', tasks_ticket_queue: 'PROJ', tasks_page_size: 20 };
}

beforeEach(() => {
  globalThis.ctResetState();
  globalThis.ctSaveInFlight = false;
  globalThis.configDirty = { tasks: false };
  globalThis.API = { updateConfig: vi.fn().mockResolvedValue({}) };
  document.body.innerHTML = '<div id="config-tab-content"></div>';
});

afterEach(() => {
  document.body.innerHTML = '';
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const submit = () => el('ct-form').dispatchEvent(new Event('submit', { cancelable: true }));

describe('config-tasks.js', () => {
  it('renders the three fields with values from config and escapes them', () => {
    globalThis.ctRenderTab({ ...makeConfig(), tasks_ticket_queue: '"><script>x</script>' });
    expect(el('ct-base-url').type).toBe('url');
    expect(el('ct-base-url').value).toBe('https://t.example/browse/');
    expect(el('ct-page-size').type).toBe('number');
    expect(el('ct-page-size').min).toBe('5');
    expect(el('ct-page-size').max).toBe('200');
    expect(document.querySelector('#config-tab-content script')).toBeNull();
  });

  it('marks configDirty.tasks on input', () => {
    globalThis.ctRenderTab(makeConfig());
    el('ct-queue').dispatchEvent(new Event('input', { bubbles: true }));
    expect(globalThis.configDirty.tasks).toBe(true);
  });

  it.each([
    ['base URL', 'ftp://x', 'PROJ', '20', /base URL/],
    ['queue', '', '1bad', '20', /queue/],
    ['page size low', '', '', '4', /entries per page/],
    ['page size high', '', '', '201', /entries per page/],
    ['page size empty', '', '', '', /entries per page/],
  ])('shows a validation message for invalid %s and does not call the API', (_n, url, queue, size, re) => {
    globalThis.ctRenderTab(makeConfig());
    el('ct-base-url').value = url;
    el('ct-queue').value = queue;
    el('ct-page-size').value = size;
    submit();
    expect(el('ct-msg').textContent).toMatch(re as RegExp);
    expect(globalThis.API.updateConfig).not.toHaveBeenCalled();
  });

  it('saves the three keys, shows a success banner and clears dirty', async () => {
    const cfg = makeConfig();
    globalThis.ctRenderTab(cfg);
    el('ct-queue').value = 'ABC-';
    el('ct-page-size').value = '50';
    el('ct-queue').dispatchEvent(new Event('input', { bubbles: true }));
    submit();
    await flush();
    expect(globalThis.API.updateConfig).toHaveBeenCalledWith({
      tasks_ticket_base_url: 'https://t.example/browse/',
      tasks_ticket_queue: 'ABC-',
      tasks_page_size: 50,
    });
    expect(el('ct-msg').querySelector('.success-banner')).not.toBeNull();
    expect(globalThis.configDirty.tasks).toBe(false);
    expect(cfg.tasks_page_size).toBe(50);
  });

  it('shows an error banner when the server rejects', async () => {
    globalThis.API.updateConfig.mockRejectedValue(new Error('HTTP 400'));
    globalThis.ctRenderTab(makeConfig());
    submit();
    await flush();
    expect(el('ct-msg').textContent).toContain('Save failed: HTTP 400');
    expect(globalThis.ctSaveInFlight).toBe(false);
  });

  it('a stale save callback writes nothing after leaving the tab', async () => {
    let resolve!: () => void;
    globalThis.API.updateConfig.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    globalThis.ctRenderTab(makeConfig());
    el('ct-queue').dispatchEvent(new Event('input', { bubbles: true }));
    submit();
    globalThis.ctResetState();
    document.body.innerHTML = '<div id="config-tab-content"><div id="ct-msg"></div></div>';
    resolve();
    await flush();
    expect(document.getElementById('ct-msg')!.innerHTML).toBe('');
    expect(globalThis.configDirty.tasks).toBe(true);
  });

  it('removes listeners on reset', () => {
    globalThis.ctRenderTab(makeConfig());
    const form = el('ct-form');
    globalThis.ctResetState();
    form.dispatchEvent(new Event('input'));
    expect(globalThis.configDirty.tasks).toBe(false);
  });

  it('is registered in index.html before config.js with a bumped version', () => {
    const html = read('index.html');
    expect(html.indexOf('config-tasks.js')).toBeGreaterThan(-1);
    expect(html.indexOf('config-tasks.js')).toBeLessThan(html.indexOf('views/config.js'));
    expect(html).toContain('views/config.js?v=7');
  });
});
