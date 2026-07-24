/* ============================================================
   views/config.js — Configuration view coordinator
   Section 4d of the MCP Server Dashboard SPA
   Depends on: API, UI, escapeHtml, showLoading, showError
   Tab modules: config-model-registry.js, config-persona-models.js (load first)
   Exports (global): configDirty — shared mutable object read/written by all
     three tab modules. Companion files must mutate its properties only; never
     reassign configDirty itself (object identity must be preserved so all
     file-level references stay in sync).
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

var configActiveTab = 'general';

/* Dirty-tracking: keyed by tab name, true when the tab has unsaved changes.
   Ownership: declared here (config.js). Mutated by all three tab modules:
     - config.js itself          → .general
     - config-model-registry.js  → .modelRegistry
     - config-persona-models.js  → .personaModels
   Object identity is preserved throughout — companion files hold a reference
   to this object and must never reassign configDirty (only mutate its keys). */
var configDirty = {
  general: false,
  personaModels: false,
  modelRegistry: false
};

/* ── Entry point ─────────────────────────────────────────── */

function renderConfig(app) {
  showLoading(app);

  Promise.all([
    API.getConfig(),
    API.getModels ? API.getModels() : Promise.resolve([]),
    API.getPersonas ? API.getPersonas() : Promise.resolve([]),
    API.getAssignments ? API.getAssignments() : Promise.resolve([])
  ]).then(function (results) {
    renderConfigPage(app, results[0], results[1], results[2], results[3]);
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}

/* ── Page scaffold ───────────────────────────────────────── */

function renderConfigPage(app, config, models, personas, assignments) {
  /* Reset dirty flags and all tab module state — fresh server data loaded. */
  configDirty.general = configDirty.personaModels = configDirty.modelRegistry = false;
  mrModels = mrOriginal = mrEditingId = null;
  pmModels = pmPersonas = pmAssignments = pmOriginal = null;
  pmIsBuilding = false; pmCollapsed = {}; pmReplaceOpen = false;

  app.innerHTML =
    '<div class="page-header"><h1>Configuration</h1></div>' +
    '<div class="config-tabs" id="config-tab-bar">' +
      '<button class="config-tab' + (configActiveTab === 'general'       ? ' active' : '') + '" data-tab="general">General</button>' +
      '<button class="config-tab' + (configActiveTab === 'personaModels' ? ' active' : '') + '" data-tab="personaModels">Persona Models</button>' +
      '<button class="config-tab' + (configActiveTab === 'modelRegistry' ? ' active' : '') + '" data-tab="modelRegistry">Model Registry</button>' +
    '</div>' +
    '<div id="config-tab-content"></div>';

  renderConfigTabContent(config, models, personas, assignments);

  var tabBar = document.getElementById('config-tab-bar');
  if (tabBar) {
    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      if (tab === configActiveTab) return;

      /* Unsaved-changes guard */
      if (configDirty[configActiveTab]) {
        if (!confirm('You have unsaved changes. Discard them?')) return;
        configDirty[configActiveTab] = false;
        if (configActiveTab === 'modelRegistry') {
          mrModels = mrOriginal = mrEditingId = null;
        }
        if (configActiveTab === 'personaModels') {
          pmModels = pmPersonas = pmAssignments = pmOriginal = null;
          pmIsBuilding = false; pmCollapsed = {}; pmReplaceOpen = false;
        }
      }

      configActiveTab = tab;
      tabBar.querySelectorAll('.config-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === tab);
      });
      renderConfigTabContent(config, models, personas, assignments);
    });
  }
}

/* ── Tab content dispatcher ──────────────────────────────── */

function renderConfigTabContent(config, models, personas, assignments) {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  if (configActiveTab === 'general') {
    contentEl.innerHTML = renderGeneralTab(config);
    wireGeneralTabEvents();
  } else if (configActiveTab === 'personaModels') {
    contentEl.innerHTML = renderPersonaModelsTab(models, personas, assignments);
    pmWireEvents();
  } else if (configActiveTab === 'modelRegistry') {
    contentEl.innerHTML = renderModelRegistryTab(models);
    mrWireEvents();
  }
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


