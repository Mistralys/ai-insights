// @vitest-environment jsdom

/**
 * Tests for gui/public/views/config.js's CONFIG_TABS registry (WP-007).
 *
 * Uses jsdom + vm.runInThisContext to load the real utils.js, components.js,
 * modal.js and all five Configuration view modules together, in the same
 * order as index.html — so the registry is exercised against the real tab
 * modules rather than stubs.
 *
 * Acceptance criteria covered:
 *   AC-12: tab buttons are generated from CONFIG_TABS; every views/config-*.js
 *          module has a descriptor; config.js holds no direct reference to
 *          any cs-, mr-, pm- or ec-prefixed state variable.
 *   AC-13: for Stores, Model Registry and Persona Models, a request that
 *          settles after the user left the tab writes nothing into
 *          #config-tab-content and changes no module state, except the
 *          visit-spanning pmIsBuilding flag, which is still cleared.
 *   AC-14: leaving Model Registry or Persona Models without discarding keeps
 *          their state; leaving after a confirmed discard resets it.
 *   (plus: renderConfigPage() calls every descriptor's reset()).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load real scripts, in index.html's script order
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const viewsDir = join(publicDir, 'views');

function loadScript(relPath: string): void {
  vm.runInThisContext(readFileSync(join(publicDir, relPath), 'utf-8'));
}

beforeAll(() => {
  loadScript('utils.js');
  loadScript('components.js');
  loadScript('modal.js');
  loadScript('views/config-model-registry.js');
  loadScript('views/config-persona-models.js');
  loadScript('views/config-stores.js');
  loadScript('views/config-error-codes.js');
  loadScript('views/config.js');
});

// ---------------------------------------------------------------------------
// Global type stubs
// ---------------------------------------------------------------------------

type TabDescriptor = {
  key: string;
  label: string;
  render: (...args: unknown[]) => void;
  leave: (discarded?: boolean) => void;
  reset: () => void;
};

declare global {
  // eslint-disable-next-line no-var
  var CONFIG_TABS: TabDescriptor[];
  // eslint-disable-next-line no-var
  var renderConfigPage: (app: HTMLElement, config: unknown, models: unknown, personas: unknown, assignments: unknown, stores: unknown) => void;
  // eslint-disable-next-line no-var
  var configDirty: Record<string, boolean>;
  // eslint-disable-next-line no-var
  var configActiveTab: string;
  // config-stores.js
  // eslint-disable-next-line no-var
  var csStores: unknown;
  // eslint-disable-next-line no-var
  var csVisit: number;
  // config-model-registry.js
  // eslint-disable-next-line no-var
  var mrModels: unknown;
  // eslint-disable-next-line no-var
  var mrVisit: number;
  // config-persona-models.js
  // eslint-disable-next-line no-var
  var pmModels: unknown;
  // eslint-disable-next-line no-var
  var pmIsBuilding: boolean;
  // eslint-disable-next-line no-var
  var pmVisit: number;
  // eslint-disable-next-line no-var
  var API: Record<string, Mock>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function contentEl(): HTMLElement {
  return document.getElementById('config-tab-content') as HTMLElement;
}

function findTab(key: string): TabDescriptor {
  const tab = globalThis.CONFIG_TABS.find((t) => t.key === key);
  if (!tab) throw new Error('No CONFIG_TABS entry for ' + key);
  return tab;
}

function makeConfig() {
  return { auto_handoff_enabled: true, max_handoff_depth: 10, capture_dialogues: true, auto_archive_days: 6, ledger_root: '' };
}

function makeStore(overrides?: Record<string, unknown>) {
  return Object.assign({
    id: 's1', label: 'Store 1', path: '/tmp/s1', is_git: false, is_default: false,
    project_count: 0, repository_count: 0,
  }, overrides);
}

function makeModel(overrides?: Record<string, unknown>) {
  return Object.assign({ id: 'm1', name: 'Model One', slug: 'Model One', cc_model: 'inherit' }, overrides);
}

function makePersona(overrides?: Record<string, unknown>) {
  return Object.assign({ id: 'p1', role: 'Developer', suite: 'ledger' }, overrides);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  globalThis.configDirty = { general: false, personaModels: false, modelRegistry: false, stores: false, errorCodes: false };
  globalThis.configActiveTab = 'general';
  globalThis.API = {
    getConfig: vi.fn().mockResolvedValue(makeConfig()),
    getModels: vi.fn().mockResolvedValue([]),
    getPersonas: vi.fn().mockResolvedValue([]),
    getAssignments: vi.fn().mockResolvedValue({ persona_models: {} }),
    getStores: vi.fn().mockResolvedValue([]),
    updateConfig: vi.fn().mockResolvedValue(makeConfig()),
    addStore: vi.fn().mockResolvedValue([]),
    importStore: vi.fn().mockResolvedValue({ stores: [] }),
    updateStore: vi.fn().mockResolvedValue([]),
    removeStore: vi.fn().mockResolvedValue([]),
    setDefaultStore: vi.fn().mockResolvedValue([]),
    reorderStores: vi.fn().mockResolvedValue([]),
    saveModels: vi.fn().mockResolvedValue({ models: [] }),
    loadDefaultModels: vi.fn().mockResolvedValue({ models: [], conflicts: [] }),
    updateAssignments: vi.fn().mockResolvedValue({ persona_models: {} }),
    rebuildPersonas: vi.fn().mockResolvedValue({}),
    replaceAssignedModel: vi.fn().mockResolvedValue({ persona_models: {} }),
    getErrorCodeProviders: vi.fn().mockResolvedValue({ providers: [], plugin_dir: '', load_errors: [] }),
    getErrorCodeConfig: vi.fn().mockResolvedValue({ active_provider: null, temporary_prefix: '1', timeout_ms: 1000, retry: { default_wait_ms: 1, max_wait_ms: 2 }, providers: {} }),
    getTemporaryErrorCodes: vi.fn().mockResolvedValue({ entries: [] }),
    updateErrorCodeConfig: vi.fn().mockResolvedValue({}),
    testErrorCodeProvider: vi.fn().mockResolvedValue({ supported: false }),
  };
  // Reset every tab module's own state so tests do not leak into each other.
  globalThis.CONFIG_TABS.forEach((t) => t.reset());
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// AC-12: registry shape
// ---------------------------------------------------------------------------

describe('CONFIG_TABS — registry shape (AC-12)', () => {
  it('renders one tab button per CONFIG_TABS entry, in order, with the correct key and label', () => {
    const app = document.getElementById('app') as HTMLElement;
    renderConfigPage(app, makeConfig(), [], [], { persona_models: {} }, []);

    const buttons = Array.from(document.querySelectorAll('#config-tab-bar button[data-tab]'));
    expect(buttons.map((b) => b.getAttribute('data-tab'))).toEqual(globalThis.CONFIG_TABS.map((t) => t.key));
    expect(buttons.map((b) => b.textContent)).toEqual(globalThis.CONFIG_TABS.map((t) => t.label));
  });

  it('marks the active tab\'s button with the "active" class', () => {
    globalThis.configActiveTab = 'stores';
    const app = document.getElementById('app') as HTMLElement;
    renderConfigPage(app, makeConfig(), [], [], { persona_models: {} }, []);

    const storesBtn = document.querySelector('#config-tab-bar button[data-tab="stores"]') as HTMLButtonElement;
    expect(storesBtn.classList.contains('active')).toBe(true);
    const generalBtn = document.querySelector('#config-tab-bar button[data-tab="general"]') as HTMLButtonElement;
    expect(generalBtn.classList.contains('active')).toBe(false);
  });

  it('has exactly one descriptor for every views/config-*.js module, plus one for General', () => {
    const configModuleFiles = readdirSync(viewsDir).filter((f) => /^config-.*\.js$/.test(f));
    expect(configModuleFiles.length).toBeGreaterThan(0);
    // config.js itself owns the General tab (no separate config-general.js file).
    expect(globalThis.CONFIG_TABS.length).toBe(configModuleFiles.length + 1);
    expect(globalThis.CONFIG_TABS.map((t) => t.key).sort()).toEqual(
      ['general', 'stores', 'personaModels', 'modelRegistry', 'errorCodes'].sort()
    );
  });

  it('config.js holds no direct reference to any cs*, mr*, pm* or ec* state variable', () => {
    const configJs = readFileSync(join(viewsDir, 'config.js'), 'utf-8');
    const stateVars = [
      // config-stores.js
      'csStores', 'csOriginal', 'csReorderMode', 'csModalMode', 'csModalStoreId', 'csModalCreateDir', 'csClickHandler', 'csVisit',
      // config-model-registry.js
      'mrModels', 'mrOriginal', 'mrEditingId', 'mrVisit',
      // config-persona-models.js
      'pmModels', 'pmPersonas', 'pmAssignments', 'pmOriginal', 'pmIsBuilding', 'pmCollapsed', 'pmReplaceOpen', 'pmVisit',
      // config-error-codes.js
      'ecProviders', 'ecPluginDir', 'ecLoadErrors', 'ecConfig', 'ecConfigWarning', 'ecTemporaryCodes', 'ecTemporaryWarning',
      'ecVisit', 'ecSelectedProviderId', 'ecTestInFlight', 'ecSaveInFlight',
      'ecClickHandler', 'ecChangeHandler', 'ecInputHandler', 'ecSubmitHandler',
    ];
    stateVars.forEach((name) => {
      const re = new RegExp('\\b' + name + '\\b');
      expect(configJs, name + ' must not appear in config.js').not.toMatch(re);
    });
  });

  it('renderConfigPage() calls every descriptor\'s reset()', () => {
    const spies = globalThis.CONFIG_TABS.map((t) => vi.spyOn(t, 'reset'));
    const app = document.getElementById('app') as HTMLElement;
    renderConfigPage(app, makeConfig(), [], [], { persona_models: {} }, []);
    spies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// AC-13: stale responses after leaving a tab
// ---------------------------------------------------------------------------

describe('stale responses after leaving a tab (AC-13)', () => {
  const SENTINEL = '<p id="other-tab">another tab</p>';

  function leaveAndSentinel(key: string, discarded: boolean): void {
    findTab(key).leave(discarded);
    contentEl().innerHTML = SENTINEL;
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="config-tab-content"></div>';
  });

  it('(Stores) a setDefaultStore response settling after the tab is left writes nothing and leaves csStores reset', async () => {
    const storesTab = findTab('stores');
    storesTab.render(makeConfig(), [], [], {}, [makeStore()]);

    const star = contentEl().querySelector('.cs-star-outline') as HTMLButtonElement;
    expect(star).toBeTruthy();

    const def = deferred<unknown[]>();
    globalThis.API.setDefaultStore = vi.fn().mockReturnValue(def.promise);
    star.dispatchEvent(new Event('click', { bubbles: true }));

    leaveAndSentinel('stores', false);
    def.resolve([makeStore({ is_default: true })]);
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.csStores).toBeNull();
  });

  it('(Stores) a removeStore response settling after the tab is left writes nothing', async () => {
    const storesTab = findTab('stores');
    storesTab.render(makeConfig(), [], [], {}, [makeStore()]);

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const removeBtn = contentEl().querySelector('.cs-remove-btn') as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();

    const def = deferred<unknown[]>();
    globalThis.API.removeStore = vi.fn().mockReturnValue(def.promise);
    removeBtn.dispatchEvent(new Event('click', { bubbles: true }));

    leaveAndSentinel('stores', false);
    def.resolve([]);
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.csStores).toBeNull();
  });

  it('(Model Registry) a Save response settling after a discard-leave does not repopulate state or re-render', async () => {
    const mrTab = findTab('modelRegistry');
    mrTab.render(makeConfig(), [makeModel()]);
    expect(globalThis.mrModels).not.toBeNull();

    const def = deferred<{ models: unknown[] }>();
    globalThis.API.saveModels = vi.fn().mockReturnValue(def.promise);
    (document.getElementById('mr-save-btn') as HTMLButtonElement).dispatchEvent(new Event('click', { bubbles: true }));

    leaveAndSentinel('modelRegistry', true);
    def.resolve({ models: [makeModel()] });
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.mrModels).toBeNull();
  });

  it('(Model Registry) a Load Defaults response settling after a discard-leave does not repopulate state', async () => {
    const mrTab = findTab('modelRegistry');
    mrTab.render(makeConfig(), [makeModel()]);

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const def = deferred<{ models: unknown[]; conflicts: unknown[] }>();
    globalThis.API.loadDefaultModels = vi.fn().mockReturnValue(def.promise);
    (document.getElementById('mr-load-defaults-btn') as HTMLButtonElement).dispatchEvent(new Event('click', { bubbles: true }));

    leaveAndSentinel('modelRegistry', true);
    def.resolve({ models: [makeModel()], conflicts: [] });
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.mrModels).toBeNull();
  });

  it('(Model Registry) a Load Defaults response settling after a non-discarding leave reconciles the retained cache without touching the DOM', async () => {
    const mrTab = findTab('modelRegistry');
    mrTab.render(makeConfig(), [makeModel()]);

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const def = deferred<{ models: unknown[]; conflicts: unknown[] }>();
    globalThis.API.loadDefaultModels = vi.fn().mockReturnValue(def.promise);
    (document.getElementById('mr-load-defaults-btn') as HTMLButtonElement).dispatchEvent(new Event('click', { bubbles: true }));

    leaveAndSentinel('modelRegistry', false);
    def.resolve({ models: [makeModel(), makeModel({ id: 'm-default', slug: 'default-one' })], conflicts: [] });
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.mrModels).toHaveLength(2);
    expect(globalThis.mrOriginal).toHaveLength(2);
  });

  it('(Persona Models) a Save response settling after a discard-leave does not repopulate state', async () => {
    const pmTab = findTab('personaModels');
    pmTab.render(makeConfig(), [makeModel()], [makePersona()], { persona_models: {} });
    expect(globalThis.pmModels).not.toBeNull();

    const def = deferred<unknown>();
    globalThis.API.updateAssignments = vi.fn().mockReturnValue(def.promise);
    // Dirty the tab so the Save button is enabled.
    globalThis.pmAssignments.default_model_uuid = 'm1';

    const pmDoSave = (globalThis as unknown as { pmDoSave: () => void }).pmDoSave;
    pmDoSave();

    leaveAndSentinel('personaModels', true);
    def.resolve({ persona_models: {} });
    await flushPromises();

    expect(contentEl().innerHTML).toBe(SENTINEL);
    expect(globalThis.pmModels).toBeNull();
  });

  it('(Persona Models) a stale pmDoRebuild still clears pmIsBuilding even though the tab was left', async () => {
    const pmTab = findTab('personaModels');
    pmTab.render(makeConfig(), [makeModel()], [makePersona()], { persona_models: {} });

    const def = deferred<unknown>();
    globalThis.API.rebuildPersonas = vi.fn().mockReturnValue(def.promise);
    (document.getElementById('pm-rebuild-btn') as HTMLButtonElement).dispatchEvent(new Event('click', { bubbles: true }));
    expect(globalThis.pmIsBuilding).toBe(true);

    // Leave WITHOUT discarding — pmIsBuilding spans visits and must not be
    // reset by leave() itself; only the rebuild's own callback clears it.
    leaveAndSentinel('personaModels', false);
    expect(globalThis.pmIsBuilding).toBe(true);

    def.resolve({});
    await flushPromises();

    expect(globalThis.pmIsBuilding).toBe(false);
    // The stale rebuild must not have re-rendered into the next tab's DOM.
    expect(contentEl().innerHTML).toBe(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// AC-14: leave(discarded) semantics for Model Registry / Persona Models
// ---------------------------------------------------------------------------

describe('leave(discarded) semantics (AC-14)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="config-tab-content"></div>';
  });

  it('(Model Registry) leaving without discarding keeps state; leaving after a confirmed discard resets it', () => {
    const mrTab = findTab('modelRegistry');
    mrTab.render(makeConfig(), [makeModel()]);
    expect(globalThis.mrModels).not.toBeNull();

    const visitBefore = globalThis.mrVisit;
    mrTab.leave(false);
    expect(globalThis.mrVisit).toBe(visitBefore + 1); // invalidated regardless
    expect(globalThis.mrModels).not.toBeNull(); // but state kept

    mrTab.leave(true);
    expect(globalThis.mrModels).toBeNull(); // reset after discard
  });

  it('(Persona Models) leaving without discarding keeps state; leaving after a confirmed discard resets it', () => {
    const pmTab = findTab('personaModels');
    pmTab.render(makeConfig(), [makeModel()], [makePersona()], { persona_models: {} });
    expect(globalThis.pmModels).not.toBeNull();

    const visitBefore = globalThis.pmVisit;
    pmTab.leave(false);
    expect(globalThis.pmVisit).toBe(visitBefore + 1);
    expect(globalThis.pmModels).not.toBeNull();

    pmTab.leave(true);
    expect(globalThis.pmModels).toBeNull();
  });

  it('(Model Registry) re-rendering after a non-discarding leave preserves unsaved edits', () => {
    const mrTab = findTab('modelRegistry');
    mrTab.render(makeConfig(), [makeModel({ name: 'Original' })]);
    (globalThis.mrModels as Array<{ name: string }>)[0].name = 'Edited';

    mrTab.leave(false);
    // Re-render with the server's (stale) original argument — edits survive
    // because state was not nulled by a non-discarding leave.
    mrTab.render(makeConfig(), [makeModel({ name: 'Original' })]);
    expect((globalThis.mrModels as Array<{ name: string }>)[0].name).toBe('Edited');
  });
});
