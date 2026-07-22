/* ============================================================
   views/config.js — Configuration view
   Section 4d of the MCP Server Dashboard SPA
   Depends on: API, UI, escapeHtml, showLoading, showError
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

var configActiveTab = 'general';

/* Dirty-tracking: keyed by tab name, true when the tab has unsaved changes */
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
    var config      = results[0];
    var models      = results[1];
    var personas    = results[2];
    var assignments = results[3];

    renderConfigPage(app, config, models, personas, assignments);
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}

/* ── Page scaffold ───────────────────────────────────────── */

function renderConfigPage(app, config, models, personas, assignments) {
  /* Reset dirty flags — fresh server data has just been loaded, so any stale
     dirty state from a previous page visit is no longer meaningful. */
  configDirty.general       = false;
  configDirty.personaModels = false;
  configDirty.modelRegistry = false;

  /* Reset Model Registry local state so it re-initialises from fresh server data. */
  mrModels    = null;
  mrOriginal  = null;
  mrEditingId = null;

  /* Reset Persona Models local state so it re-initialises from fresh server data. */
  pmModels      = null;
  pmPersonas    = null;
  pmAssignments = null;
  pmOriginal    = null;
  pmIsBuilding  = false;
  pmCollapsed   = {};
  pmReplaceOpen = false;

  app.innerHTML =
    '<div class="page-header"><h1>Configuration</h1></div>' +
    '<div class="config-tabs" id="config-tab-bar">' +
      '<button class="config-tab' + (configActiveTab === 'general'       ? ' active' : '') + '" data-tab="general">General</button>' +
      '<button class="config-tab' + (configActiveTab === 'personaModels' ? ' active' : '') + '" data-tab="personaModels">Persona Models</button>' +
      '<button class="config-tab' + (configActiveTab === 'modelRegistry' ? ' active' : '') + '" data-tab="modelRegistry">Model Registry</button>' +
    '</div>' +
    '<div id="config-tab-content"></div>';

  /* Render active tab content */
  renderConfigTabContent(config, models, personas, assignments);

  /* Wire tab-bar clicks */
  var tabBar = document.getElementById('config-tab-bar');
  if (tabBar) {
    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      if (tab === configActiveTab) return;

      /* Unsaved-changes guard */
      if (configDirty[configActiveTab]) {
        if (!confirm('You have unsaved changes. Discard them?')) {
          return; /* Stay */
        }
        configDirty[configActiveTab] = false;
        /* Reset Model Registry local state when discarding changes so a
           fresh load occurs on the next visit. */
        if (configActiveTab === 'modelRegistry') {
          mrModels    = null;
          mrOriginal  = null;
          mrEditingId = null;
        }
        /* Reset Persona Models local state when discarding changes. */
        if (configActiveTab === 'personaModels') {
          pmModels      = null;
          pmPersonas    = null;
          pmAssignments = null;
          pmOriginal    = null;
          pmIsBuilding  = false;
          pmCollapsed   = {};
          pmReplaceOpen = false;
        }
      }

      /* Update active tab state */
      configActiveTab = tab;

      /* Update active class on buttons without re-rendering the full page */
      var allBtns = tabBar.querySelectorAll('.config-tab');
      allBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === tab);
      });

      /* Re-render only the tab content area */
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
    pmWireEvents(config, models, personas, assignments);
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
     (not 'input'), while text/number inputs fire 'input' on each keystroke.
     Using both ensures all form control types are covered. */
  form.addEventListener('change', function () {
    configDirty.general = true;
  });
  form.addEventListener('input', function () {
    configDirty.general = true;
  });

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

/* ── Persona Models tab ──────────────────────────────────── */

/* Module-level state for Persona Models tab.
   pmModels:       working copy of model list (loaded from server, used for dropdowns).
   pmPersonas:     full persona list from GET /api/personas.
   pmAssignments:  working copy of assignments (default_model_uuid + persona_models).
   pmOriginal:     snapshot of assignments at load/save time for dirty comparison.
   pmIsBuilding:   true while a rebuild is in progress.
   pmCollapsed:    set of suite names the user has collapsed.
   pmReplaceOpen:  true when the Replace Model inline form is shown. */
var pmModels      = null;   /* ModelEntry[] | null */
var pmPersonas    = null;   /* PersonaEntry[] | null */
var pmAssignments = null;   /* { default_model_uuid?: string, persona_models: {} } | null */
var pmOriginal    = null;   /* deep-cloned snapshot for dirty comparison */
var pmIsBuilding  = false;
var pmCollapsed   = {};     /* { [suiteName]: boolean } */
var pmReplaceOpen = false;

/* Suite display labels — maps raw suite keys to user-facing strings. */
var PM_SUITE_LABELS = {
  'ledger':         'Ledger',
  'standalone':     'Standalone',
  'ledger-support': 'Ledger Support'
};

/* Ordered suite list for consistent rendering. */
var PM_SUITE_ORDER = ['ledger', 'standalone', 'ledger-support'];

/* ── Helpers ─────────────────────────────────────────────── */

/** Deep-clone assignments object. */
function pmCloneAssignments(a) {
  if (!a) return { persona_models: {} };
  return {
    default_model_uuid: a.default_model_uuid,
    persona_models: Object.assign({}, a.persona_models || {})
  };
}

/** Return true when working copy has unsaved changes vs snapshot. */
function pmHasChanges() {
  if (!pmAssignments || !pmOriginal) return false;
  if (pmAssignments.default_model_uuid !== pmOriginal.default_model_uuid) return true;
  var aPm = pmAssignments.persona_models || {};
  var oPm = pmOriginal.persona_models || {};
  var aKeys = Object.keys(aPm);
  var oKeys = Object.keys(oPm);
  if (aKeys.length !== oKeys.length) return true;
  for (var i = 0; i < aKeys.length; i++) {
    if (aPm[aKeys[i]] !== oPm[aKeys[i]]) return true;
  }
  return false;
}

/** Resolve a model UUID to its display name. Returns null when not found. */
function pmModelName(uuid) {
  if (!uuid || !pmModels) return null;
  for (var i = 0; i < pmModels.length; i++) {
    if (pmModels[i].id === uuid) return pmModels[i].name;
  }
  return null;
}

/** Render a dirty indicator dot. */
function pmDirtyDot(isDirty) {
  return isDirty ? '<span class="pm-dirty-dot" title="Unsaved change"></span>' : '';
}

/** Build <option> elements for a model dropdown.
 *  If includeDefault is true, prepends a "Default" option with value ''. */
function pmBuildModelOptions(selectedUuid, includeDefault) {
  var opts = '';
  if (includeDefault) {
    opts += '<option value=""' + (!selectedUuid ? ' selected' : '') + '>Default</option>';
  }
  if (pmModels) {
    for (var i = 0; i < pmModels.length; i++) {
      var m = pmModels[i];
      var sel = (m.id === selectedUuid) ? ' selected' : '';
      opts += '<option value="' + escapeHtml(m.id) + '"' + sel + '>' + escapeHtml(m.name) + '</option>';
    }
  }
  return opts;
}

/* ── Full tab rebuild ────────────────────────────────────── */

/** (Re-)render the Persona Models tab content and re-wire events. */
function pmRefreshTab(config, models, personas, assignments) {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;
  contentEl.innerHTML = pmBuildTabHtml();
  pmWireEvents(config, models, personas, assignments);
  /* Sync dirty flag */
  configDirty.personaModels = pmHasChanges();
}

/** Build the full HTML string for the Persona Models tab. */
function pmBuildTabHtml() {
  /* ── Empty-registry edge case ── */
  if (!pmModels || pmModels.length === 0) {
    return UI.card('Persona Models',
      '<div class="pm-empty-registry">' +
        '<p>No models are registered. To assign models to personas, first add models in the ' +
        '<button class="btn-link pm-goto-registry">Model Registry</button> tab.</p>' +
      '</div>'
    );
  }

  /* ── Pre-build state: no personas yet ── */
  if (!pmPersonas || pmPersonas.length === 0) {
    return UI.card('Persona Models',
      '<div class="pm-prebuild-state">' +
        '<p><strong>No persona data available.</strong> Run the persona build to generate persona output files and populate this tab.</p>' +
        '<button id="pm-prebuild-rebuild-btn" class="btn btn-primary"' + (pmIsBuilding ? ' disabled' : '') + '>' +
          (pmIsBuilding ? '<span class="spinner"></span> Rebuilding…' : 'Rebuild Personas') +
        '</button>' +
        '<div id="pm-build-error" style="display:none;"></div>' +
      '</div>'
    );
  }

  /* ── Stale banner ── */
  var staleBanner = '';
  if (pmAssignments && pmAssignments.stale) {
    staleBanner =
      '<div class="stale-banner pm-stale-banner" id="pm-stale-banner">' +
        '<span>Model settings have changed since the last persona build.</span>' +
        '<button id="pm-banner-rebuild-btn" class="btn btn-sm btn-secondary"' + (pmIsBuilding ? ' disabled' : '') + '>' +
          (pmIsBuilding ? '<span class="spinner"></span> Rebuilding…' : 'Rebuild Personas') +
        '</button>' +
      '</div>';
  }

  /* ── Build error area (always present, hidden unless error occurred) ── */
  var buildErrorArea =
    '<div id="pm-build-error" style="display:none;margin-bottom:12px;"></div>';

  /* ── Default model section ── */
  var savedDefaultUuid    = pmOriginal ? pmOriginal.default_model_uuid : undefined;
  var currentDefaultUuid  = pmAssignments ? pmAssignments.default_model_uuid : undefined;
  var defaultDirty        = (currentDefaultUuid !== savedDefaultUuid);
  var defaultModelName    = pmModelName(currentDefaultUuid) || 'None selected';

  var defaultSection =
    '<div class="pm-section" style="margin-bottom:20px;">' +
      '<h3 class="mr-section-title">Default Model</h3>' +
      '<div class="pm-default-row">' +
        '<div class="pm-default-display" id="pm-default-display">' +
          pmDirtyDot(defaultDirty) +
          '<span class="pm-model-text">' + escapeHtml(defaultModelName) + '</span>' +
          '<button class="btn-icon pm-edit-default-btn" title="Edit default model" aria-label="Edit default model">&#9998;</button>' +
        '</div>' +
        '<div class="pm-default-edit" id="pm-default-edit" style="display:none;">' +
          '<select id="pm-default-select" class="form-control pm-model-select">' +
            pmBuildModelOptions(currentDefaultUuid, false) +
          '</select>' +
          '<button id="pm-default-done-btn" class="btn btn-sm btn-primary" style="margin-left:8px;">Done</button>' +
          '<button id="pm-default-cancel-btn" class="btn btn-sm btn-secondary" style="margin-left:6px;">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  /* ── Persona Assignments section ── */
  /* Group personas by suite */
  var suiteGroups = {};
  PM_SUITE_ORDER.forEach(function (s) { suiteGroups[s] = []; });
  (pmPersonas || []).forEach(function (p) {
    var suite = p.suite || 'ledger';
    if (!suiteGroups[suite]) suiteGroups[suite] = [];
    suiteGroups[suite].push(p);
  });

  /* Replace Model inline form */
  var replaceFormHtml = '';
  if (pmReplaceOpen) {
    var replaceFromOpts = pmBuildModelOptions(null, false);
    var replaceToOpts   = pmBuildModelOptions(null, false);
    replaceFormHtml =
      '<div class="pm-replace-form" id="pm-replace-form">' +
        '<div class="pm-replace-row">' +
          '<div class="form-group pm-replace-field">' +
            '<label class="form-label" for="pm-replace-from">Replace</label>' +
            '<select id="pm-replace-from" class="form-control">' + replaceFromOpts + '</select>' +
          '</div>' +
          '<div class="form-group pm-replace-field">' +
            '<label class="form-label" for="pm-replace-to">With</label>' +
            '<select id="pm-replace-to" class="form-control">' + replaceToOpts + '</select>' +
          '</div>' +
          '<div class="form-group pm-replace-action">' +
            '<label class="form-label" style="visibility:hidden;">Action</label>' +
            '<button id="pm-replace-all-btn" class="btn btn-secondary">Replace All</button>' +
            '<button id="pm-replace-cancel-btn" class="btn btn-secondary" style="margin-left:6px;">Cancel</button>' +
          '</div>' +
        '</div>' +
        '<div id="pm-replace-msg"></div>' +
      '</div>';
  }

  /* Suite sections */
  var suiteSectionsHtml = '';
  PM_SUITE_ORDER.forEach(function (suite) {
    var personas = suiteGroups[suite] || [];
    if (personas.length === 0) return;

    var label     = PM_SUITE_LABELS[suite] || suite;
    var collapsed = !!pmCollapsed[suite];

    /* Persona rows */
    var rowsHtml = '';
    personas.forEach(function (p) {
      var currentUuid = (pmAssignments && pmAssignments.persona_models)
        ? (pmAssignments.persona_models[p.id] || '')
        : '';
      var savedUuid   = (pmOriginal && pmOriginal.persona_models)
        ? (pmOriginal.persona_models[p.id] || '')
        : '';
      var isDirty = (currentUuid !== savedUuid);

      /* Resolved model name from name-mapping.json (the last-built state) */
      var resolvedModelText = p.model ? escapeHtml(p.model) : '<span class="text-muted">—</span>';
      /* If there's a current assignment in working state, show that model name */
      var assignedName = pmModelName(currentUuid);
      var displayText  = assignedName ? escapeHtml(assignedName) : resolvedModelText;

      /* Label: number + role, or just role */
      var personaLabel = (p.number != null)
        ? escapeHtml(String(p.number) + '. ' + (p.role || p.id))
        : escapeHtml(p.role || p.id);

      rowsHtml +=
        '<tr class="pm-persona-row" data-persona-id="' + escapeHtml(p.id) + '">' +
          '<td class="pm-persona-name">' + personaLabel + '</td>' +
          '<td class="pm-persona-model">' +
            '<div class="pm-persona-display" id="pm-pd-' + escapeHtml(p.id) + '">' +
              pmDirtyDot(isDirty) +
              '<span class="pm-model-text">' + displayText + '</span>' +
              '<button class="btn-icon pm-edit-persona-btn" data-persona-id="' + escapeHtml(p.id) + '" title="Edit model assignment" aria-label="Edit model assignment">&#9998;</button>' +
            '</div>' +
            '<div class="pm-persona-edit" id="pm-pe-' + escapeHtml(p.id) + '" style="display:none;">' +
              '<select class="form-control pm-persona-select pm-model-select" data-persona-id="' + escapeHtml(p.id) + '">' +
                pmBuildModelOptions(currentUuid, true) +
              '</select>' +
              '<button class="btn btn-sm btn-primary pm-persona-done-btn" data-persona-id="' + escapeHtml(p.id) + '" style="margin-left:8px;">Done</button>' +
              '<button class="btn btn-sm btn-secondary pm-persona-cancel-btn" data-persona-id="' + escapeHtml(p.id) + '" style="margin-left:6px;">Cancel</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
    });

    suiteSectionsHtml +=
      '<div class="pm-suite-section">' +
        '<button class="pm-suite-header" data-suite="' + escapeHtml(suite) + '" aria-expanded="' + (!collapsed) + '">' +
          '<span class="pm-suite-chevron">' + (collapsed ? '▶' : '▼') + '</span>' +
          '<span class="pm-suite-label">' + escapeHtml(label) + '</span>' +
          '<span class="pm-suite-count">(' + personas.length + ')</span>' +
        '</button>' +
        '<div class="pm-suite-body"' + (collapsed ? ' style="display:none;"' : '') + '>' +
          '<table class="pm-personas-table">' +
            '<thead><tr><th>Persona</th><th>Model</th></tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  });

  var assignmentsSection =
    '<div class="pm-section">' +
      '<div class="pm-assignments-header">' +
        '<h3 class="mr-section-title" style="margin-bottom:0;">Persona Assignments</h3>' +
        '<button id="pm-replace-toggle-btn" class="btn btn-sm btn-secondary">' +
          (pmReplaceOpen ? 'Close Replace Model' : 'Replace Model') +
        '</button>' +
      '</div>' +
      replaceFormHtml +
      suiteSectionsHtml +
    '</div>';

  /* ── Action bar ── */
  var hasDirty = pmHasChanges();
  var rebuildTooltip = hasDirty ? ' title="Save your changes first to include them in the build."' : '';
  var actionBar =
    '<div class="pm-action-bar">' +
      '<button id="pm-save-btn" class="btn btn-primary"' + (!hasDirty ? ' disabled' : '') + '>Save</button>' +
      '<button id="pm-rebuild-btn" class="btn btn-secondary"' +
        (pmIsBuilding ? ' disabled' : '') +
        rebuildTooltip + '>' +
        (pmIsBuilding ? '<span class="spinner"></span> Rebuilding…' : 'Rebuild Personas') +
      '</button>' +
      '<div id="pm-save-msg" style="display:inline-block;margin-left:12px;"></div>' +
    '</div>';

  var inner = staleBanner + buildErrorArea + defaultSection + assignmentsSection + actionBar;
  return UI.card('Persona Models', inner);
}

/* ── Wire events ─────────────────────────────────────────── */

/**
 * Wire all interactive elements on the Persona Models tab.
 *
 * Parameter note — pass-through only, not consumed here:
 *   The four parameters (config, models, personas, assignments) are NOT read by
 *   this function or its event handlers. All rendering reads from module-level
 *   pm* state (pmModels, pmPersonas, pmAssignments, pmOriginal, pmIsBuilding,
 *   pmCollapsed, pmReplaceOpen). The parameters exist solely to be forwarded to
 *   pmRefreshTab() calls, which in turn pass them back into the next pmWireEvents
 *   invocation — forming the recursive closure chain that drives full tab re-renders.
 *
 *   To update displayed data, mutate the module-level pm* state directly.
 *   Do not route new data through these parameters.
 */
function pmWireEvents(config, models, personas, assignments) {

  /* Go-to-Registry button (empty registry state) */
  var gotoRegBtn = document.querySelector('.pm-goto-registry');
  if (gotoRegBtn) {
    gotoRegBtn.addEventListener('click', function () {
      /* Navigate to Model Registry tab */
      var tabBar = document.getElementById('config-tab-bar');
      if (tabBar) {
        var btn = tabBar.querySelector('[data-tab="modelRegistry"]');
        if (btn) btn.click();
      }
    });
  }

  /* Pre-build rebuild button */
  var prebuildBtn = document.getElementById('pm-prebuild-rebuild-btn');
  if (prebuildBtn) {
    prebuildBtn.addEventListener('click', function () {
      pmDoRebuild(config, models, personas, assignments);
    });
  }

  /* Default model edit */
  var editDefaultBtn = document.querySelector('.pm-edit-default-btn');
  if (editDefaultBtn) {
    editDefaultBtn.addEventListener('click', function () {
      document.getElementById('pm-default-display').style.display = 'none';
      document.getElementById('pm-default-edit').style.display    = 'flex';
    });
  }
  var defaultDoneBtn = document.getElementById('pm-default-done-btn');
  if (defaultDoneBtn) {
    defaultDoneBtn.addEventListener('click', function () {
      var sel = document.getElementById('pm-default-select');
      if (sel && pmAssignments) {
        var val = sel.value;
        pmAssignments.default_model_uuid = val || undefined;
      }
      document.getElementById('pm-default-display').style.display = '';
      document.getElementById('pm-default-edit').style.display    = 'none';
      pmRefreshTab(config, models, personas, assignments);
    });
  }
  var defaultCancelBtn = document.getElementById('pm-default-cancel-btn');
  if (defaultCancelBtn) {
    defaultCancelBtn.addEventListener('click', function () {
      document.getElementById('pm-default-display').style.display = '';
      document.getElementById('pm-default-edit').style.display    = 'none';
    });
  }

  /* Suite collapsible headers */
  var suiteHeaders = document.querySelectorAll('.pm-suite-header');
  suiteHeaders.forEach(function (hdr) {
    hdr.addEventListener('click', function () {
      var suite = hdr.getAttribute('data-suite');
      pmCollapsed[suite] = !pmCollapsed[suite];
      pmRefreshTab(config, models, personas, assignments);
    });
  });

  /* Persona edit / done / cancel — use event delegation on the card */
  var card = document.querySelector('.card');
  if (card) {
    card.addEventListener('click', function (e) {
      /* Edit persona model */
      var editBtn = e.target.closest('.pm-edit-persona-btn');
      if (editBtn) {
        var pid = editBtn.getAttribute('data-persona-id');
        var displayEl = document.getElementById('pm-pd-' + pid);
        var editEl    = document.getElementById('pm-pe-' + pid);
        if (displayEl) displayEl.style.display = 'none';
        if (editEl)    editEl.style.display    = 'flex';
        return;
      }

      /* Done editing persona model */
      var doneBtn = e.target.closest('.pm-persona-done-btn');
      if (doneBtn) {
        var dpid = doneBtn.getAttribute('data-persona-id');
        var editEl2 = document.getElementById('pm-pe-' + dpid);
        if (editEl2) {
          var sel2 = editEl2.querySelector('.pm-persona-select');
          if (sel2 && pmAssignments) {
            var val2 = sel2.value;
            if (!pmAssignments.persona_models) pmAssignments.persona_models = {};
            if (val2) {
              pmAssignments.persona_models[dpid] = val2;
            } else {
              delete pmAssignments.persona_models[dpid];
            }
          }
        }
        pmRefreshTab(config, models, personas, assignments);
        return;
      }

      /* Cancel editing persona model */
      var cancelBtn = e.target.closest('.pm-persona-cancel-btn');
      if (cancelBtn) {
        var cpid = cancelBtn.getAttribute('data-persona-id');
        var displayEl2 = document.getElementById('pm-pd-' + cpid);
        var editEl3    = document.getElementById('pm-pe-' + cpid);
        if (displayEl2) displayEl2.style.display = '';
        if (editEl3)    editEl3.style.display    = 'none';
        return;
      }
    });
  }

  /* Replace Model toggle */
  var replaceToggle = document.getElementById('pm-replace-toggle-btn');
  if (replaceToggle) {
    replaceToggle.addEventListener('click', function () {
      pmReplaceOpen = !pmReplaceOpen;
      pmRefreshTab(config, models, personas, assignments);
    });
  }

  /* Replace Model — Replace All */
  var replaceAllBtn = document.getElementById('pm-replace-all-btn');
  if (replaceAllBtn) {
    replaceAllBtn.addEventListener('click', function () {
      var fromSel = document.getElementById('pm-replace-from');
      var toSel   = document.getElementById('pm-replace-to');
      if (!fromSel || !toSel) return;
      var oldId = fromSel.value;
      var newId = toSel.value;
      if (!oldId || !newId) {
        var msgEl = document.getElementById('pm-replace-msg');
        if (msgEl) msgEl.innerHTML = '<p class="error-banner">Please select both models.</p>';
        return;
      }
      var oldName = pmModelName(oldId) || oldId;
      var newName = pmModelName(newId) || newId;
      if (!confirm('Replace all assignments of "' + oldName + '" with "' + newName + '"?')) return;

      replaceAllBtn.disabled = true;
      API.replaceAssignedModel(oldId, newId)
        .then(function (result) {
          /* Update working copy with new assignments from server */
          if (result) {
            if (result.default_model_uuid !== undefined) {
              pmAssignments.default_model_uuid = result.default_model_uuid;
            }
            if (result.persona_models) {
              pmAssignments.persona_models = result.persona_models;
            }
          }
          pmReplaceOpen = false;
          pmRefreshTab(config, models, personas, assignments);
        })
        .catch(function (err) {
          replaceAllBtn.disabled = false;
          var msgEl = document.getElementById('pm-replace-msg');
          if (msgEl) msgEl.innerHTML = '<p class="error-banner">Replace failed: ' + escapeHtml(err.message || String(err)) + '</p>';
        });
    });
  }

  /* Replace Model — Cancel */
  var replaceCancelBtn = document.getElementById('pm-replace-cancel-btn');
  if (replaceCancelBtn) {
    replaceCancelBtn.addEventListener('click', function () {
      pmReplaceOpen = false;
      pmRefreshTab(config, models, personas, assignments);
    });
  }

  /* Stale banner rebuild button */
  var bannerRebuildBtn = document.getElementById('pm-banner-rebuild-btn');
  if (bannerRebuildBtn) {
    bannerRebuildBtn.addEventListener('click', function () {
      pmDoRebuild(config, models, personas, assignments);
    });
  }

  /* Fixed rebuild button */
  var rebuildBtn = document.getElementById('pm-rebuild-btn');
  if (rebuildBtn) {
    rebuildBtn.addEventListener('click', function () {
      pmDoRebuild(config, models, personas, assignments);
    });
  }

  /* Save button */
  var saveBtn = document.getElementById('pm-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      pmDoSave(config, models, personas, assignments);
    });
  }
}

/* ── API actions ─────────────────────────────────────────── */

/** Save the current assignment working copy to PUT /api/model-assignments. */
function pmDoSave(config, models, personas, assignments) {
  var saveBtn = document.getElementById('pm-save-btn');
  var msgEl   = document.getElementById('pm-save-msg');
  if (saveBtn) saveBtn.disabled = true;
  if (msgEl)   msgEl.innerHTML  = '<span style="color:var(--color-text-muted);font-size:13px;">Saving…</span>';

  var payload = {
    persona_models: pmAssignments ? (pmAssignments.persona_models || {}) : {}
  };
  if (pmAssignments && pmAssignments.default_model_uuid) {
    payload.default_model_uuid = pmAssignments.default_model_uuid;
  }

  API.updateAssignments(payload)
    .then(function (result) {
      /* Update snapshot and mark saved state as stale (server returns stale: true) */
      pmOriginal = pmCloneAssignments(result || payload);
      if (pmAssignments) {
        if (result) {
          pmAssignments.stale             = result.stale;
          pmAssignments.default_model_uuid = result.default_model_uuid;
          pmAssignments.persona_models     = result.persona_models || {};
        }
      }
      configDirty.personaModels = false;
      pmRefreshTab(config, models, personas, assignments);
      var msg2 = document.getElementById('pm-save-msg');
      if (msg2) msg2.innerHTML = '<span class="success-banner" style="display:inline-block;padding:4px 10px;">Saved.</span>';
    })
    .catch(function (err) {
      if (saveBtn) saveBtn.disabled = false;
      var msg2 = document.getElementById('pm-save-msg');
      if (msg2) msg2.innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
    });
}

/** Trigger a persona rebuild. Shared by all rebuild buttons (banner + fixed + pre-build). */
function pmDoRebuild(config, models, personas, assignments) {
  if (pmIsBuilding) return;
  pmIsBuilding = true;

  /* Hide any previous build error */
  var errEl = document.getElementById('pm-build-error');
  if (errEl) { errEl.style.display = 'none'; errEl.innerHTML = ''; }

  pmRefreshTab(config, models, personas, assignments);

  API.rebuildPersonas()
    .then(function (result) {
      pmIsBuilding = false;
      /* Re-fetch persona list and assignments to reflect rebuilt state */
      Promise.all([
        API.getPersonas(),
        API.getAssignments()
      ]).then(function (refreshed) {
        pmPersonas = refreshed[0] || [];
        var freshAssignments = refreshed[1] || {};
        /* Update stale flag from server */
        if (pmAssignments) pmAssignments.stale = freshAssignments.stale;
        pmRefreshTab(config, models, pmPersonas, assignments);
      }).catch(function () {
        /* Even if refresh fails, just re-render with existing data */
        pmRefreshTab(config, models, personas, assignments);
      });
    })
    .catch(function (err) {
      pmIsBuilding = false;
      pmRefreshTab(config, models, personas, assignments);
      /* Show build error output */
      var errEl2 = document.getElementById('pm-build-error');
      if (errEl2) {
        var output = (err && err.message) ? err.message : String(err);
        errEl2.innerHTML =
          '<pre class="pm-build-error-pre">' + escapeHtml(output) + '</pre>';
        errEl2.style.display = '';
      }
    });
}

/* ── Entry point ─────────────────────────────────────────── */

/** Called by renderConfigTabContent() to render the Persona Models tab. */
function renderPersonaModelsTab(models, personas, assignments) {
  /* Initialize module-level state on first render (or after a page reload). */
  if (pmModels === null) {
    pmModels    = models || [];
    pmPersonas  = personas || [];
    /* Assignments from server may include stale flag — keep it in working copy */
    pmAssignments = pmCloneAssignments(assignments);
    pmAssignments.stale = assignments && assignments.stale;
    pmOriginal    = pmCloneAssignments(assignments);
    pmIsBuilding  = false;
    pmCollapsed   = {};
    pmReplaceOpen = false;
  }

  return pmBuildTabHtml();
}

/* ── Model Registry tab ──────────────────────────────────── */

/* Module-level state for Model Registry tab.
   mrModels:    working copy of the model list (may have edits / pending deletions).
   mrOriginal:  snapshot loaded from the server — used for dirty comparison.
   mrEditingId: id of the row currently in edit mode (null when none). */
var mrModels    = null;
var mrOriginal  = null;
var mrEditingId = null;

/* Slug validation regex — mirrors the server-side rule. */
var MR_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ── Helpers ─────────────────────────────────────────────── */

/** Derive a slug from a human-readable name. */
function mrDeriveSlug(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Validate a slug string.  Returns an error message or '' if valid. */
function mrValidateSlug(slug) {
  if (!slug) return 'Slug is required.';
  if (slug === 'inherit') return 'The slug "inherit" is reserved.';
  if (!MR_SLUG_REGEX.test(slug)) return 'Slug must be lowercase alphanumeric with hyphens (e.g. my-model).';
  return '';
}

/** Deep-clone a models array so mutations do not affect the original snapshot. */
function mrCloneModels(arr) {
  return arr.map(function (m) { return Object.assign({}, m); });
}

/** Return true when the working copy has any unsaved changes vs the snapshot. */
function mrHasChanges() {
  if (!mrModels || !mrOriginal) return false;
  if (mrModels.length !== mrOriginal.length) return true;
  for (var i = 0; i < mrModels.length; i++) {
    var a = mrModels[i];
    var b = mrOriginal[i];
    if (a.id !== b.id || a.name !== b.name || a.slug !== b.slug || a.cc_model !== b.cc_model || a._deleted !== b._deleted) return true;
  }
  return false;
}

/* ── Render helpers ──────────────────────────────────────── */

/** Render the dirty indicator dot HTML for a field that has changed. */
function mrDirtyDot(isDirty) {
  return isDirty ? '<span class="mr-dirty-dot" title="Unsaved change"></span>' : '';
}

/** Render a single read-only model row. */
function mrRenderRow(model) {
  var orig = mrOriginal ? mrOriginal.find(function (o) { return o.id === model.id; }) : null;
  var isNew      = !orig;
  var isDeleted  = !!model._deleted;
  var nameDirty  = orig && model.name     !== orig.name;
  var slugDirty  = orig && model.slug     !== orig.slug;
  var ccDirty    = orig && model.cc_model !== orig.cc_model;

  var rowClass = 'mr-model-row' + (isDeleted ? ' mr-model-deleted' : '') + (isNew ? ' mr-model-new' : '');

  return '<tr class="' + rowClass + '" data-id="' + escapeHtml(model.id) + '">' +
    '<td>' + mrDirtyDot(nameDirty || isNew) + escapeHtml(model.name) + '</td>' +
    '<td>' + mrDirtyDot(slugDirty || isNew) + '<code>' + escapeHtml(model.slug) + '</code></td>' +
    '<td>' +
      mrDirtyDot(ccDirty || isNew) +
      '<span title="Claude Code model override. Use \'inherit\' to defer to your Claude Code model setting.">' +
        escapeHtml(model.cc_model || 'inherit') +
      '</span>' +
    '</td>' +
    '<td class="mr-row-actions">' +
      (isDeleted
        ? '<button class="btn btn-sm btn-secondary mr-restore-btn" data-id="' + escapeHtml(model.id) + '">Restore</button>'
        : '<button class="btn btn-sm btn-secondary mr-edit-btn"    data-id="' + escapeHtml(model.id) + '">Edit</button>' +
          '<button class="btn btn-sm btn-danger  mr-delete-btn"   data-id="' + escapeHtml(model.id) + '">Delete</button>'
      ) +
    '</td>' +
  '</tr>';
}

/** Render the edit row for the model currently being edited. */
function mrRenderEditRow(model) {
  var orig = mrOriginal ? mrOriginal.find(function (o) { return o.id === model.id; }) : null;
  var isNew      = !orig;
  var nameDirty  = orig && model.name     !== orig.name;
  var slugDirty  = orig && model.slug     !== orig.slug;
  var ccDirty    = orig && model.cc_model !== orig.cc_model;
  var slugError  = mrValidateSlug(model.slug);

  return '<tr class="mr-model-row mr-edit-row" data-id="' + escapeHtml(model.id) + '">' +
    '<td>' +
      mrDirtyDot(nameDirty || isNew) +
      '<input type="text" class="form-control mr-field-name" value="' + escapeHtml(model.name) + '" placeholder="Model name" data-id="' + escapeHtml(model.id) + '">' +
    '</td>' +
    '<td>' +
      mrDirtyDot(slugDirty || isNew) +
      '<input type="text" class="form-control mr-field-slug' + (slugError ? ' mr-field-error' : '') + '" value="' + escapeHtml(model.slug) + '" placeholder="model-slug" data-id="' + escapeHtml(model.id) + '">' +
      (slugError ? '<p class="form-note mr-error-text">' + escapeHtml(slugError) + '</p>' : '') +
    '</td>' +
    '<td>' +
      mrDirtyDot(ccDirty || isNew) +
      '<input type="text" class="form-control mr-field-cc" value="' + escapeHtml(model.cc_model || '') + '" placeholder="inherit" data-id="' + escapeHtml(model.id) + '">' +
      '<p class="form-note">Claude Code model override. Use <code>inherit</code> to defer to your Claude Code model setting.</p>' +
    '</td>' +
    '<td class="mr-row-actions">' +
      '<button class="btn btn-sm btn-primary mr-save-row-btn" data-id="' + escapeHtml(model.id) + '"' + (slugError ? ' disabled' : '') + '>Done</button>' +
      '<button class="btn btn-sm btn-secondary mr-cancel-edit-btn" data-id="' + escapeHtml(model.id) + '">Cancel</button>' +
    '</td>' +
  '</tr>';
}

/* ── Main render function ────────────────────────────────── */

function renderModelRegistryTab(models) {
  /* Initialise local state from the server data on first render, or after
     a successful save.  If state is already populated we keep it (the user
     may have unsaved edits when re-rendering the tab, e.g. after a dirty-
     state guard was skipped). */
  if (mrModels === null) {
    mrModels   = mrCloneModels(models || []);
    mrOriginal = mrCloneModels(models || []);
    mrEditingId = null;
  }

  return mrBuildTabHtml();
}

/** (Re-)render the tab content and re-wire all event handlers. */
function mrRefreshTab() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;
  contentEl.innerHTML = mrBuildTabHtml();
  mrWireEvents();
  /* Sync dirty flag */
  configDirty.modelRegistry = mrHasChanges();
}

/** Build the full HTML string for the Model Registry tab. */
function mrBuildTabHtml() {
  var hasValidationErrors = mrModels
    ? mrModels.some(function (m) { return !m._deleted && mrValidateSlug(m.slug) !== ''; })
    : false;

  /* Table rows */
  var rows = '';
  if (!mrModels || mrModels.length === 0) {
    rows = '<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);padding:24px;">No models registered. Add one below or click "Load Defaults".</td></tr>';
  } else {
    rows = mrModels.map(function (m) {
      return (mrEditingId === m.id) ? mrRenderEditRow(m) : mrRenderRow(m);
    }).join('');
  }

  var tableHtml =
    '<div class="table-wrapper" style="margin-bottom:20px;">' +
      '<table id="mr-table">' +
        '<thead><tr>' +
          '<th>Name</th>' +
          '<th>Slug</th>' +
          '<th>cc_model</th>' +
          '<th style="width:140px;"></th>' +
        '</tr></thead>' +
        '<tbody id="mr-tbody">' +
          rows +
        '</tbody>' +
      '</table>' +
    '</div>';

  /* Add Model form */
  var addFormHtml =
    '<div class="mr-add-section">' +
      '<h3 class="mr-section-title">Add Model</h3>' +
      '<div class="mr-add-row">' +
        '<div class="form-group mr-add-field">' +
          '<label class="form-label" for="mr-add-name">Name</label>' +
          '<input type="text" id="mr-add-name" class="form-control" placeholder="e.g. Claude Opus 4">' +
        '</div>' +
        '<div class="form-group mr-add-field">' +
          '<label class="form-label" for="mr-add-slug">Slug</label>' +
          '<input type="text" id="mr-add-slug" class="form-control" placeholder="claude-opus-4">' +
          '<p id="mr-add-slug-error" class="form-note mr-error-text" style="display:none;"></p>' +
        '</div>' +
        '<div class="form-group mr-add-field">' +
          '<label class="form-label" for="mr-add-cc">cc_model</label>' +
          '<input type="text" id="mr-add-cc" class="form-control" value="inherit" placeholder="inherit">' +
          '<p class="form-note">Claude Code model override. Use <code>inherit</code> to defer to your Claude Code model setting.</p>' +
        '</div>' +
        '<div class="form-group mr-add-action">' +
          '<label class="form-label" style="visibility:hidden;">Action</label>' +
          '<button id="mr-add-btn" class="btn btn-primary">Add Model</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  /* Action bar */
  var saveDisabled = hasValidationErrors ? ' disabled title="Fix validation errors before saving"' : '';
  var actionBarHtml =
    '<div class="mr-action-bar">' +
      '<button id="mr-save-btn" class="btn btn-primary"' + saveDisabled + '>Save</button>' +
      '<button id="mr-load-defaults-btn" class="btn btn-secondary">Load Defaults</button>' +
      '<div id="mr-msg" style="display:inline-block;margin-left:12px;"></div>' +
    '</div>';

  var inner = tableHtml + addFormHtml + actionBarHtml;

  return UI.card('Model Registry', inner);
}

/* ── Event wiring ────────────────────────────────────────── */

/** Wire all interactive elements on the Model Registry tab. */
function mrWireEvents() {
  var tbody = document.getElementById('mr-tbody');
  if (tbody) {
    /* Edit button */
    tbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.mr-edit-btn');
      if (btn) {
        mrEditingId = btn.getAttribute('data-id');
        mrRefreshTab();
        return;
      }

      /* Cancel edit */
      var cancelBtn = e.target.closest('.mr-cancel-edit-btn');
      if (cancelBtn) {
        mrEditingId = null;
        mrRefreshTab();
        return;
      }

      /* Done (save row) */
      var saveRowBtn = e.target.closest('.mr-save-row-btn');
      if (saveRowBtn) {
        var id = saveRowBtn.getAttribute('data-id');
        var row = document.querySelector('.mr-edit-row[data-id="' + id + '"]');
        if (row) {
          var nameInput = row.querySelector('.mr-field-name');
          var slugInput = row.querySelector('.mr-field-slug');
          var ccInput   = row.querySelector('.mr-field-cc');
          var newName   = nameInput ? nameInput.value.trim() : '';
          var newSlug   = slugInput ? slugInput.value.trim() : '';
          var newCc     = ccInput   ? ccInput.value.trim()   : 'inherit';
          var slugErr   = mrValidateSlug(newSlug);
          if (slugErr) return; /* button should be disabled, but guard anyway */
          var model = mrModels.find(function (m) { return m.id === id; });
          if (model) {
            model.name     = newName;
            model.slug     = newSlug;
            model.cc_model = newCc || 'inherit';
          }
        }
        mrEditingId = null;
        mrRefreshTab();
        return;
      }

      /* Delete */
      var deleteBtn = e.target.closest('.mr-delete-btn');
      if (deleteBtn) {
        var delId = deleteBtn.getAttribute('data-id');
        var delModel = mrModels.find(function (m) { return m.id === delId; });
        if (delModel) delModel._deleted = true;
        if (mrEditingId === delId) mrEditingId = null;
        mrRefreshTab();
        return;
      }

      /* Restore (undo delete) */
      var restoreBtn = e.target.closest('.mr-restore-btn');
      if (restoreBtn) {
        var restId = restoreBtn.getAttribute('data-id');
        var restModel = mrModels.find(function (m) { return m.id === restId; });
        if (restModel) delete restModel._deleted;
        mrRefreshTab();
        return;
      }
    });

    /* Live field updates during edit — dirty dots and slug validation */
    tbody.addEventListener('input', function (e) {
      var nameInput = e.target.closest('.mr-field-name');
      var slugInput = e.target.closest('.mr-field-slug');
      var ccInput   = e.target.closest('.mr-field-cc');

      if (nameInput) {
        var id = nameInput.getAttribute('data-id');
        var model = mrModels.find(function (m) { return m.id === id; });
        if (model) {
          /* Auto-derive slug unless it has been manually edited */
          var currentSlugInput = tbody.querySelector('.mr-field-slug[data-id="' + id + '"]');
          var origModel        = mrOriginal ? mrOriginal.find(function (o) { return o.id === id; }) : null;
          var autoSlug         = mrDeriveSlug(nameInput.value);
          /* Only auto-derive if slug hasn't diverged from the derived value of the current name,
             or if this is a new model whose slug was not manually touched. */
          if (currentSlugInput) {
            var currentSlugVal = currentSlugInput.value.trim();
            var prevAutoSlug   = mrDeriveSlug(model.name);
            if (currentSlugVal === prevAutoSlug || currentSlugVal === '') {
              currentSlugInput.value = autoSlug;
              model.slug = autoSlug;
              /* Update validation state */
              var slugErr = mrValidateSlug(autoSlug);
              var errEl   = currentSlugInput.nextElementSibling;
              currentSlugInput.classList.toggle('mr-field-error', !!slugErr);
              /* Update Done button disabled state */
              var doneBtn = tbody.querySelector('.mr-save-row-btn[data-id="' + id + '"]');
              if (doneBtn) doneBtn.disabled = !!slugErr;
            }
          }
          model.name = nameInput.value;
          mrRefreshDirtyDots(id, tbody, origModel, model);
        }
      }

      if (slugInput) {
        var slugId  = slugInput.getAttribute('data-id');
        var slugMod = mrModels.find(function (m) { return m.id === slugId; });
        if (slugMod) {
          slugMod.slug = slugInput.value.trim();
          var slugErr2 = mrValidateSlug(slugMod.slug);
          slugInput.classList.toggle('mr-field-error', !!slugErr2);
          /* Show / hide error text */
          var errEl2 = slugInput.nextElementSibling;
          if (errEl2 && errEl2.classList.contains('mr-error-text')) {
            errEl2.textContent = slugErr2;
            errEl2.style.display = slugErr2 ? '' : 'none';
          } else if (slugErr2) {
            var newErr = document.createElement('p');
            newErr.className = 'form-note mr-error-text';
            newErr.textContent = slugErr2;
            slugInput.parentNode.insertBefore(newErr, slugInput.nextSibling);
          }
          /* Update Done button disabled state */
          var doneBtn2 = tbody.querySelector('.mr-save-row-btn[data-id="' + slugId + '"]');
          if (doneBtn2) doneBtn2.disabled = !!slugErr2;
          /* Update save button too */
          mrSyncSaveButton();
          var origMod = mrOriginal ? mrOriginal.find(function (o) { return o.id === slugId; }) : null;
          mrRefreshDirtyDots(slugId, tbody, origMod, slugMod);
        }
      }

      if (ccInput) {
        var ccId  = ccInput.getAttribute('data-id');
        var ccMod = mrModels.find(function (m) { return m.id === ccId; });
        if (ccMod) {
          ccMod.cc_model = ccInput.value.trim() || 'inherit';
          var origCc = mrOriginal ? mrOriginal.find(function (o) { return o.id === ccId; }) : null;
          mrRefreshDirtyDots(ccId, tbody, origCc, ccMod);
        }
      }
    });
  }

  /* Add Model form */
  var addNameInput = document.getElementById('mr-add-name');
  var addSlugInput = document.getElementById('mr-add-slug');

  if (addNameInput) {
    /* _prevValue is a custom property stored directly on the DOM input element.
       It tracks the name value from the previous input event so we can compare
       mrDeriveSlug(prev) with the current slug field value.  If they match (or
       the slug is empty), the slug was not manually edited, and we auto-update it.
       Once the user types a slug that diverges from the auto-derived value, we
       stop overwriting it — the slug is considered "manually set".
       We store state on the element rather than in a module-level variable to
       avoid a full re-render on every keystroke.  If the Add form is ever
       extracted into a proper component, replace _prevValue with explicit
       local component state. */
    addNameInput.addEventListener('input', function () {
      if (!addSlugInput) return;
      /* Auto-derive slug unless the user has manually edited the slug field */
      var autoSlug = mrDeriveSlug(addNameInput.value);
      var prevAuto = mrDeriveSlug(addNameInput._prevValue || '');
      if (addSlugInput.value === prevAuto || addSlugInput.value === '') {
        addSlugInput.value = autoSlug;
        mrValidateAddSlug();
      }
      addNameInput._prevValue = addNameInput.value;
    });
  }

  if (addSlugInput) {
    addSlugInput.addEventListener('input', mrValidateAddSlug);
  }

  var addBtn = document.getElementById('mr-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var name  = (addNameInput ? addNameInput.value.trim() : '');
      var slug  = (addSlugInput ? addSlugInput.value.trim() : '');
      var ccEl  = document.getElementById('mr-add-cc');
      var cc    = ccEl ? (ccEl.value.trim() || 'inherit') : 'inherit';

      var slugErr = mrValidateSlug(slug);
      if (slugErr) {
        mrShowAddSlugError(slugErr);
        return;
      }
      if (!name) {
        /* Focus name field */
        if (addNameInput) addNameInput.focus();
        return;
      }

      mrModels = mrModels || [];
      mrModels.push({ id: crypto.randomUUID(), name: name, slug: slug, cc_model: cc });
      mrRefreshTab();
    });
  }

  /* Save button */
  var saveBtn = document.getElementById('mr-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', mrDoSave);
  }

  /* Load Defaults button */
  var loadDefaultsBtn = document.getElementById('mr-load-defaults-btn');
  if (loadDefaultsBtn) {
    loadDefaultsBtn.addEventListener('click', mrDoLoadDefaults);
  }
}

/** Refresh only the dirty-indicator dots for a specific row (avoids full re-render).
 *
 *  Design intent: dirty-indicator dots update on full re-renders, which are triggered
 *  by explicit user actions — Done, Cancel, Delete, Restore.  They do NOT update on
 *  every keystroke during inline editing.  This means a dot will not appear while the
 *  user is mid-edit; it appears only after they click Done.
 *
 *  This function is a documented no-op stub.  It is called by the input event handlers
 *  so that future maintainers can implement in-place dot updates (e.g. toggling a CSS
 *  class on the `<td>` directly) without needing to find all the call sites.  Do NOT
 *  remove the calls to this function — they serve as extension points.
 */
function mrRefreshDirtyDots(id, tbody, origModel, model) {
  void id; void tbody; void origModel; void model;
}

/** Validate the Add Model slug field and show/hide error message. */
function mrValidateAddSlug() {
  var addSlugInput = document.getElementById('mr-add-slug');
  if (!addSlugInput) return;
  var slug = addSlugInput.value.trim();
  var err  = slug ? mrValidateSlug(slug) : '';
  mrShowAddSlugError(err);
}

function mrShowAddSlugError(msg) {
  var errEl = document.getElementById('mr-add-slug-error');
  if (errEl) {
    errEl.textContent    = msg;
    errEl.style.display  = msg ? '' : 'none';
  }
  /* Add button intentionally NOT disabled here — we validate on click instead
     (slug may be empty/invalid during mid-typing without intent to submit). */
}

/** Re-evaluate whether the global Save button should be enabled. */
function mrSyncSaveButton() {
  var saveBtn = document.getElementById('mr-save-btn');
  if (!saveBtn) return;
  var hasErrors = mrModels
    ? mrModels.some(function (m) { return !m._deleted && mrValidateSlug(m.slug) !== ''; })
    : false;
  saveBtn.disabled = hasErrors;
}

/* ── API actions ─────────────────────────────────────────── */

/** Send the working model list to PUT /api/models. */
function mrDoSave() {
  var saveBtn = document.getElementById('mr-save-btn');
  var msgEl   = document.getElementById('mr-msg');
  if (saveBtn) saveBtn.disabled = true;
  if (msgEl)   msgEl.innerHTML  = '<span style="color:var(--color-text-muted);font-size:13px;">Saving…</span>';

  /* Strip the internal _deleted sentinel from entries that are being removed;
     the server expects a plain array where absent entries are deletions. */
  var payload = (mrModels || []).filter(function (m) { return !m._deleted; }).map(function (m) {
    return { id: m.id, name: m.name, slug: m.slug, cc_model: m.cc_model };
  });

  API.saveModels(payload)
    .then(function (result) {
      /* Refresh state from server response */
      var saved = (result && result.models) ? result.models : payload;
      mrModels   = mrCloneModels(saved);
      mrOriginal = mrCloneModels(saved);
      mrEditingId = null;
      configDirty.modelRegistry = false;
      mrRefreshTab();
      /* Show success message */
      var msg2 = document.getElementById('mr-msg');
      if (msg2) msg2.innerHTML = '<span class="success-banner" style="display:inline-block;padding:4px 10px;">Saved successfully.</span>';
    })
    .catch(function (err) {
      var msg2 = document.getElementById('mr-msg');
      if (saveBtn) saveBtn.disabled = false;
      if (err && err.code === 'CONFLICT') {
        /* 409 — referenced model deletion */
        var conflictMsg =
          'Cannot delete one or more models because they are referenced by personas. ' +
          'Use the <strong>Replace Model</strong> feature on the Persona Models tab to reassign personas first, then retry.';
        if (msg2) msg2.innerHTML = '<p class="error-banner">' + conflictMsg + '</p>';
      } else {
        if (msg2) msg2.innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
      }
    });
}

/** Call POST /api/models/load-defaults with confirmation. */
function mrDoLoadDefaults() {
  if (!confirm('Load default models? Existing entries with matching slugs will NOT be overwritten. New defaults will be added to your registry.')) {
    return;
  }
  var msgEl = document.getElementById('mr-msg');
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--color-text-muted);font-size:13px;">Loading defaults…</span>';

  API.loadDefaultModels()
    .then(function (result) {
      var loaded    = (result && result.models)    ? result.models    : [];
      var conflicts = (result && result.conflicts) ? result.conflicts : [];

      mrModels    = mrCloneModels(loaded);
      mrOriginal  = mrCloneModels(loaded);
      mrEditingId = null;
      configDirty.modelRegistry = false;
      mrRefreshTab();

      var msg2 = document.getElementById('mr-msg');
      if (msg2) {
        if (conflicts.length > 0) {
          var conflictList = conflicts.map(function (c) {
            return '<li><code>' + escapeHtml(c.slug || String(c)) + '</code>' +
              (c.reason ? ' — ' + escapeHtml(c.reason) : '') + '</li>';
          }).join('');
          msg2.innerHTML =
            '<p class="info-banner" style="display:inline-block;">' +
              'Defaults loaded. The following slug(s) already existed and were not overwritten:' +
              '<ul style="margin:8px 0 0 16px;">' + conflictList + '</ul>' +
            '</p>';
        } else {
          msg2.innerHTML = '<span class="success-banner" style="display:inline-block;padding:4px 10px;">Default models loaded.</span>';
        }
      }
    })
    .catch(function (err) {
      var msg2 = document.getElementById('mr-msg');
      if (msg2) msg2.innerHTML = '<p class="error-banner">Failed to load defaults: ' + escapeHtml(err.message || String(err)) + '</p>';
    });
}


