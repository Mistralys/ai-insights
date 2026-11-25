/* ============================================================
   views/config.js — Configuration view coordinator
   Section 4d of the MCP Server Dashboard SPA
   Depends on: API, UI, escapeHtml, showLoading, showError
   Tab modules: config-model-registry.js, config-persona-models.js,
     config-stores.js, config-error-codes.js, config-tasks.js (load first)
   Exports (global): configDirty — shared mutable object read/written by all
     four tab modules. Companion files must mutate its properties only; never
     reassign configDirty itself (object identity must be preserved so all
     file-level references stay in sync).

   CONFIG_TABS is the single source of truth for which tabs exist and how to
   render, leave and reset each one. This coordinator never reads or writes
   another module's cs-, mr-, pm- or ec-prefixed fields directly — every tab
   module owns its own state and exposes it to this file only through its
   descriptor's three functions:
     - render(config, models, personas, assignments, stores): populate
       #config-tab-content and wire its events. Called on first load and on
       every tab switch. A tab ignores arguments it does not need.
     - leave(discarded): called when the tab-bar handler is about to switch
       away from this tab, after its confirm() guard (if the tab was dirty)
       has already run. `discarded` is true when the user just confirmed
       discarding unsaved changes. A tab with no "keep state unless
       discarded" case (Stores, Error Codes) ignores the argument and always
       resets; Model Registry and Persona Models reset only when discarded,
       since their render arguments are not refreshed after a save.
     - reset(): called with no arguments by renderConfigPage() on every
       fresh page load, where server data is always about to replace
       whatever state existed.
   Adding a sixth tab means adding one descriptor here — see GUI constraint
   §25 "Config Tab Modules".
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

var configActiveTab = 'general';

/* Dirty-tracking: keyed by tab key, true when the tab has unsaved changes.
   Ownership: declared here (config.js). Mutated by the owning tab module via
   its own key (config.js itself mutates .general). Object identity is
   preserved throughout — companion files hold a reference to this object and
   must never reassign configDirty (only mutate its keys). */
var configDirty = {
  general: false,
  personaModels: false,
  modelRegistry: false,
  stores: false,
  errorCodes: false,
  tasks: false
};

/* ── Tab registry ─────────────────────────────────────────── */

var CONFIG_TABS = [
  {
    key: 'general',
    label: 'General',
    render: function (config) {
      var contentEl = document.getElementById('config-tab-content');
      if (!contentEl) return;
      contentEl.innerHTML = renderGeneralTab(config);
      wireGeneralTabEvents();
    },
    leave: function () {},
    reset: function () {}
  },
  {
    key: 'stores',
    label: 'Stores',
    render: function (config, models, personas, assignments, stores) {
      var contentEl = document.getElementById('config-tab-content');
      if (!contentEl) return;
      contentEl.innerHTML = renderStoresTab(stores || []);
      csWireEvents();
    },
    leave: function () { csResetState(); },
    reset: function () { csResetState(); }
  },
  {
    key: 'personaModels',
    label: 'Persona Models',
    render: function (config, models, personas, assignments) {
      var contentEl = document.getElementById('config-tab-content');
      if (!contentEl) return;
      contentEl.innerHTML = renderPersonaModelsTab(models, personas, assignments);
      pmWireEvents();
    },
    leave: function (discarded) { pmLeaveTab(discarded); },
    reset: function () { pmResetState(); }
  },
  {
    key: 'modelRegistry',
    label: 'Model Registry',
    render: function (config, models) {
      var contentEl = document.getElementById('config-tab-content');
      if (!contentEl) return;
      contentEl.innerHTML = renderModelRegistryTab(models);
      mrWireEvents();
    },
    leave: function (discarded) { mrLeaveTab(discarded); },
    reset: function () { mrResetState(); }
  },
  {
    key: 'errorCodes',
    label: 'Error Codes',
    render: function () { ecRenderTab(); },
    leave: function () { ecResetState(); },
    reset: function () { ecResetState(); }
  },
  { key: 'tasks', label: 'Tasks', render: ctRenderTab, leave: ctResetState, reset: ctResetState }
];

/** Find a CONFIG_TABS descriptor by key. Returns undefined when not found. */
function configFindTab(key) {
  return CONFIG_TABS.find(function (t) { return t.key === key; });
}

/* ── Entry point ─────────────────────────────────────────── */

function renderConfig(app) {
  showLoading(app);

  Promise.all([
    API.getConfig(),
    API.getModels ? API.getModels() : Promise.resolve([]),
    API.getPersonas ? API.getPersonas() : Promise.resolve([]),
    API.getAssignments ? API.getAssignments() : Promise.resolve([]),
    API.getStores ? API.getStores() : Promise.resolve([])
  ]).then(function (results) {
    renderConfigPage(app, results[0], results[1], results[2], results[3], results[4]);
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}

/* ── Page scaffold ───────────────────────────────────────── */

function renderConfigPage(app, config, models, personas, assignments, stores) {
  /* Reset dirty flags and every tab module's own state — fresh server data
     loaded. config.js holds no list of any tab module's fields; each
     descriptor's reset() does its own module's cleanup. */
  CONFIG_TABS.forEach(function (t) { configDirty[t.key] = false; });
  CONFIG_TABS.forEach(function (t) { t.reset(); });

  var tabButtonsHtml = CONFIG_TABS.map(function (t) {
    return '<button class="config-tab' + (configActiveTab === t.key ? ' active' : '') + '" data-tab="' + t.key + '">' + escapeHtml(t.label) + '</button>';
  }).join('');

  app.innerHTML =
    '<div class="page-header"><h1>Configuration</h1></div>' +
    '<div class="config-tabs" id="config-tab-bar">' + tabButtonsHtml + '</div>' +
    '<div id="config-tab-content"></div>';

  renderConfigTabContent(config, models, personas, assignments, stores);

  var tabBar = document.getElementById('config-tab-bar');
  if (tabBar) {
    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      if (tab === configActiveTab) return;

      /* Unsaved-changes guard */
      var discarded = false;
      if (configDirty[configActiveTab]) {
        if (!confirm('You have unsaved changes. Discard them?')) return;
        configDirty[configActiveTab] = false;
        discarded = true;
      }

      /* Tell the tab being left to clean up. The confirm() guard above has
         already decided whether this is a discard — leave() runs
         unconditionally regardless of that outcome, so a tab re-entered
         without ever being dirty (e.g. Stores, Error Codes) still releases
         its delegated listeners and invalidates its visit token. */
      var leavingTab = configFindTab(configActiveTab);
      if (leavingTab) leavingTab.leave(discarded);

      configActiveTab = tab;
      tabBar.querySelectorAll('.config-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === tab);
      });
      renderConfigTabContent(config, models, personas, assignments, stores);
    });
  }
}

/* ── Tab content dispatcher ──────────────────────────────── */

function renderConfigTabContent(config, models, personas, assignments, stores) {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  var tab = configFindTab(configActiveTab);
  if (!tab) return;
  tab.render(config, models, personas, assignments, stores);
}

/* ── General tab ─────────────────────────────────────────── */

function renderGeneralTab(config) {
  return UI.card(null,
    '<form id="config-form">' +
      '<div class="form-group">' +
        '<label class="form-label" for="auto-handoff">' +
          '<input type="checkbox" id="auto-handoff" class="form-check" ' + (config.auto_handoff_enabled ? 'checked' : '') + '>' +
          ' Auto-handoff enabled' +
        '</label>' +
        '<p class="form-note">When enabled, the MCP server automatically chains work to the next agent in the workflow.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="max-depth">Max handoff depth</label>' +
        '<input type="number" id="max-depth" class="form-control" min="1" value="' + escapeHtml(String(config.max_handoff_depth)) + '">' +
        '<p class="form-note">Maximum number of automatic agent handoffs before stopping.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="capture-dialogues">' +
          '<input type="checkbox" id="capture-dialogues" class="form-check" ' + (config.capture_dialogues ? 'checked' : '') + '>' +
          ' Capture agent dialogues' +
        '</label>' +
        '<p class="form-note">When enabled, the orchestrator saves the full LLM conversation for each pipeline stage to the project\'s ledger as Markdown files. Changes take effect on the next orchestrator run.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="auto-archive-days">Auto-archive after (days)</label>' +
        '<input type="number" id="auto-archive-days" class="form-control" min="0" step="1" value="' + escapeHtml(String(config.auto_archive_days != null ? config.auto_archive_days : 6)) + '">' +
        '<p class="form-note">Number of days after last update before a COMPLETE project is automatically archived. Set to 0 to disable auto-archiving.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="ledger-root">Ledger root path</label>' +
        '<input type="text" id="ledger-root" class="form-control" readonly value="' + escapeHtml(config.ledger_root || '') + '">' +
        '<p class="form-note">Read-only. Changing this requires restarting the server with <code>--ledger-dir</code>.</p>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary">Save</button>' +
      '<div id="config-msg"></div>' +
    '</form>',
    { style: 'max-width:560px' }
  );
}

function wireGeneralTabEvents() {
  var form = document.getElementById('config-form');
  if (!form) return;

  /* Mark tab dirty on any input change.
     Both 'change' and 'input' are intentional: checkboxes fire 'change'
     (not 'input'), while text/number inputs fire 'input' on each keystroke. */
  form.addEventListener('change', function () { configDirty.general = true; });
  form.addEventListener('input',  function () { configDirty.general = true; });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var autoHandoff = document.getElementById('auto-handoff').checked;
    var maxDepth = parseInt(document.getElementById('max-depth').value, 10);
    if (isNaN(maxDepth) || maxDepth < 1) {
      showError(document.getElementById('config-msg'), 'Max handoff depth must be a positive integer.');
      return;
    }
    var captureDialogues = document.getElementById('capture-dialogues').checked;
    var autoArchiveDays = parseInt(document.getElementById('auto-archive-days').value, 10);
    if (isNaN(autoArchiveDays) || autoArchiveDays < 0) {
      showError(document.getElementById('config-msg'), 'Auto-archive days must be a non-negative integer.');
      return;
    }
    /* ledger_root intentionally omitted (read-only) */
    API.updateConfig({ auto_handoff_enabled: autoHandoff, max_handoff_depth: maxDepth, capture_dialogues: captureDialogues, auto_archive_days: autoArchiveDays })
      .then(function () {
        configDirty.general = false;
        document.getElementById('config-msg').innerHTML = '<p class="success-banner">Configuration saved.</p>';
      })
      .catch(function (err) {
        showError(document.getElementById('config-msg'), 'Save failed: ' + (err.message || String(err)));
      });
  });
}


