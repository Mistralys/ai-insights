/* ============================================================
   views/config-persona-models.js — Persona Models tab module
   Section 4d-pm of the MCP Server Dashboard SPA
   Depends on: API, UI, escapeHtml, configDirty (defined in config.js)
   Must be loaded BEFORE config.js.
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

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
function pmRefreshTab() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;
  contentEl.innerHTML = pmBuildTabHtml();
  pmWireEvents();
  /* Sync dirty flag. configDirty is defined in config.js (which loads after this file),
     but is only accessed here inside a function body — safe forward-reference. */
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
 * All rendering reads from module-level pm* state (pmModels, pmPersonas,
 * pmAssignments, pmOriginal, pmIsBuilding, pmCollapsed, pmReplaceOpen).
 * To update displayed data, mutate the module-level pm* state directly.
 */
function pmWireEvents() {

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
      pmDoRebuild();
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
      pmRefreshTab();
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
      pmRefreshTab();
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
        pmRefreshTab();
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
      pmRefreshTab();
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
          pmRefreshTab();
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
      pmRefreshTab();
    });
  }

  /* Stale banner rebuild button */
  var bannerRebuildBtn = document.getElementById('pm-banner-rebuild-btn');
  if (bannerRebuildBtn) {
    bannerRebuildBtn.addEventListener('click', function () {
      pmDoRebuild();
    });
  }

  /* Fixed rebuild button */
  var rebuildBtn = document.getElementById('pm-rebuild-btn');
  if (rebuildBtn) {
    rebuildBtn.addEventListener('click', function () {
      pmDoRebuild();
    });
  }

  /* Save button */
  var saveBtn = document.getElementById('pm-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      pmDoSave();
    });
  }
}

/* ── API actions ─────────────────────────────────────────── */

/** Save the current assignment working copy to PUT /api/model-assignments. */
function pmDoSave() {
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
      configDirty.personaModels = false; /* forward-reference to config.js — safe, inside function body */
      pmRefreshTab();
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
function pmDoRebuild() {
  if (pmIsBuilding) return;
  pmIsBuilding = true;

  /* Hide any previous build error */
  var errEl = document.getElementById('pm-build-error');
  if (errEl) { errEl.style.display = 'none'; errEl.innerHTML = ''; }

  pmRefreshTab();

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
        pmRefreshTab();
      }).catch(function () {
        /* Even if refresh fails, just re-render with existing data */
        pmRefreshTab();
      });
    })
    .catch(function (err) {
      pmIsBuilding = false;
      pmRefreshTab();
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

/**
 * Called by renderConfigTabContent() to render the Persona Models tab.
 *
 * State is initialized only on first render (pmModels === null). On every
 * subsequent call — including when the user switches away and back to this tab
 * without discarding changes — the existing module-level state (pmAssignments,
 * pmReplaceOpen, etc.) is kept intact so unsaved edits are preserved. State is
 * reset to null by the coordinator's discard-changes path in config.js, which
 * sets pmModels = null, causing the next render to re-initialize from the
 * freshly fetched server data passed in via the arguments.
 */
function renderPersonaModelsTab(models, personas, assignments) {
  /* Initialize module-level state on first render (or after a discard reset). */
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
