/* ============================================================
   views/config-model-registry.js — Model Registry tab module
   Section 4d-mr of the MCP Server Dashboard SPA
   Depends on: API (api-client.js), UI (components.js), escapeHtml (utils.js), crypto.randomUUID (browser built-in), configDirty (config.js)
   Must be loaded BEFORE config.js.
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

/* Module-level state for Model Registry tab.
   mrModels:    working copy of the model list (may have edits / pending deletions).
   mrOriginal:  snapshot loaded from the server — used for dirty comparison.
   mrEditingId: id of the row currently in edit mode (null when none). */
var mrModels    = null;
var mrOriginal  = null;
var mrEditingId = null;

/* Slug validation regex — mirrors the server-side rule. */
var MR_SLUG_REGEX = /^[A-Za-z0-9][A-Za-z0-9 .()\-]*$/;

/* ── Helpers ─────────────────────────────────────────────── */

/** Derive a slug from a human-readable name. */
function mrDeriveSlug(name) {
  return (name || '')
    .replace(/[^A-Za-z0-9 .()\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Validate a slug string.  Returns an error message or '' if valid. */
function mrValidateSlug(slug) {
  if (!slug || !slug.trim()) return 'Slug is required.';
  if (slug === 'inherit') return 'The slug "inherit" is reserved.';
  if (!MR_SLUG_REGEX.test(slug)) return 'Slug must start with a letter or digit and may contain letters, digits, spaces, dots, hyphens, and parentheses (e.g. Claude Opus 4.6 (anthropic)).';
  return '';
}

/** Deep-clone a models array so mutations do not affect the original snapshot. */
function mrCloneModels(arr) {
  return arr.map(function (m) { return Object.assign({}, m); });
}

/** Return true when the working copy has any unsaved changes vs the snapshot.
 *
 * Comparison is index-based (position i in mrModels vs position i in mrOriginal),
 * not ID-based. This is correct because mrDoSave() submits activeModels in
 * iteration order and the server reflects that same order back in result.models.
 * If the server ever returns models in a different order (e.g. alphabetical sort),
 * this function would always return true after a save. Should that happen,
 * replace this loop with an ID-keyed map comparison instead.
 */
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
      (model.slug === 'inherit'
        ? '<span class="badge badge-secondary" title="This is a built-in system entry and cannot be edited or deleted.">Built-in</span>'
        : isDeleted
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
      '<p class="form-note mr-error-text mr-name-error" style="display:none;color:var(--color-danger);">Name is required.</p>' +
    '</td>' +
    '<td>' +
      mrDirtyDot(slugDirty || isNew) +
      '<input type="text" class="form-control mr-field-slug' + (slugError ? ' mr-field-error' : '') + '" value="' + escapeHtml(model.slug) + '" placeholder="e.g. Claude Opus 4.6 (anthropic)" data-id="' + escapeHtml(model.id) + '">'+
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

  /* Table rows — sorted alphabetically by label for display (mrModels order unchanged). */
  var rows = '';
  if (!mrModels || mrModels.length === 0) {
    rows = '<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);padding:24px;">No models registered. Add one below or click "Load Defaults".</td></tr>';
  } else {
    var displayModels = mrModels.slice().sort(function (a, b) {
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });
    rows = displayModels.map(function (m) {
      return (mrEditingId === m.id) ? mrRenderEditRow(m) : mrRenderRow(m);
    }).join('');
  }

  var tableHtml =
    '<div class="table-wrapper" style="margin-bottom:20px;">' +
      '<table id="mr-table">' +
        '<thead><tr>' +
          '<th>Label</th>' +
          '<th>VS Code</th>' +
          '<th>Claude Code</th>' +
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
          '<label class="form-label" for="mr-add-name">Label</label>' +
          '<input type="text" id="mr-add-name" class="form-control" placeholder="e.g. Claude Opus 4">' +
        '</div>' +
        '<div class="form-group mr-add-field">' +
          '<label class="form-label" for="mr-add-slug">VS Code</label>' +
          '<input type="text" id="mr-add-slug" class="form-control" placeholder="e.g. Claude Opus 4.6 (anthropic)">' +
          '<p id="mr-add-slug-error" class="form-note mr-error-text" style="display:none;"></p>' +
        '</div>' +
        '<div class="form-group mr-add-field">' +
          '<label class="form-label" for="mr-add-cc">Claude Code</label>' +
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

          /* Empty-name guard: reject blank model names inline without a server round-trip */
          if (!newName) {
            var nameErrEl = row.querySelector('.mr-name-error');
            if (nameErrEl) nameErrEl.style.display = '';
            if (nameInput) nameInput.focus();
            return;
          }

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
        if (delModel && delModel.slug === 'inherit') return; // sentinel is read-only
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
          /* Clear the name-required error as soon as the user starts typing */
          var row = nameInput.closest('tr');
          if (row) {
            var nameErrEl = row.querySelector('.mr-name-error');
            if (nameErrEl) nameErrEl.style.display = 'none';
          }

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

  /* Client-side duplicate-slug pre-check: detect duplicates before sending to server */
  var activeModels = (mrModels || []).filter(function (m) { return !m._deleted; });
  var slugsSeen = {};
  var duplicateSlugs = [];
  activeModels.forEach(function (m) {
    if (slugsSeen[m.slug]) {
      if (duplicateSlugs.indexOf(m.slug) === -1) duplicateSlugs.push(m.slug);
    } else {
      slugsSeen[m.slug] = true;
    }
  });
  if (duplicateSlugs.length > 0) {
    if (saveBtn) saveBtn.disabled = false;
    if (msgEl) {
      msgEl.innerHTML = '<p class="error-banner">Duplicate slug' +
        (duplicateSlugs.length > 1 ? 's' : '') + ': ' +
        duplicateSlugs.map(function (s) { return '<code>' + escapeHtml(s) + '</code>'; }).join(', ') +
        '. Each model must have a unique slug.</p>';
    }
    return;
  }

  /* Strip the internal _deleted sentinel from entries that are being removed;
     the server expects a plain array where absent entries are deletions. */
  var payload = activeModels.map(function (m) {
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
