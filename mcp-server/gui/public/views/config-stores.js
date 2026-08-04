/* ============================================================
   views/config-stores.js — Stores tab module
   Section 4d-cs of the MCP Server Dashboard SPA
   Depends on: API (api-client.js), UI (components.js), escapeHtml (utils.js),
               configDirty (config.js)
   Must be loaded BEFORE config.js.
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

/* csStores:       working copy of store list (from server).
   csOriginal:     snapshot at load time (stores tab uses immediate writes;
                   no dirty tracking — included for structural parity).
   csReorderMode:  true when the reorder sub-view is active. While true,
                   csShowTableError() targets #cs-reorder-error (present in
                   the reorder view). On API failure, csMoveStore() reverts
                   the optimistic swap and re-renders the reorder view before
                   calling csShowTableError() — csRefreshTab() is not called.
   csModalMode:    null (closed), 'add', or 'edit'.
   csModalStoreId: ID of the store being edited (null in add mode).
   csModalCreateDir: true = create new directory (Add), false = use existing
                   directory (Import). Defaults to true when opening add mode. */
var csStores        = null;
var csOriginal      = null;
var csReorderMode   = false;
var csModalMode     = null;
var csModalStoreId  = null;
var csModalCreateDir = true;
var csClickHandler  = null;

/* Store ID validation regex — mirrors SLUG_REGEX from src/schema/common.ts. */
var CS_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/* Reserved store IDs that collide with literal API path suffixes. */
var CS_RESERVED_IDS = ['import', 'order', 'conflicts'];

/* ── Helpers ─────────────────────────────────────────────── */

/** Validate a store ID. Returns an error message or '' if valid. */
function csValidateId(id) {
  if (!id || !id.trim()) return 'Store ID is required.';
  if (!CS_SLUG_REGEX.test(id)) return 'Store ID must start with a letter or digit and may only contain letters, digits, hyphens, and underscores.';
  for (var i = 0; i < CS_RESERVED_IDS.length; i++) {
    if (id === CS_RESERVED_IDS[i]) return 'Store ID "' + id + '" is reserved. Choose a different identifier.';
  }
  return '';
}

/** Validate a store path.  Returns an error message or '' if valid. */
function csValidatePath(path) {
  if (!path || !path.trim()) return 'Path is required.';
  var p = path.trim();
  if (p.charAt(0) !== '/' && p.substring(0, 2) !== '~/') return 'Path must be an absolute path (starting with / or ~/).';
  return '';
}

/** Validate a label (optional, but whitespace-only is rejected if provided). */
function csValidateLabel(label) {
  if (label && label.trim() === '') return 'Label cannot be whitespace only.';
  return '';
}

/** Render the type badge for a store entry. */
function csTypeBadge(store) {
  if (store.is_git) {
    var badge = '<span class="badge cs-type-badge cs-type-git">Git</span>';
    if (store.ahead != null && store.behind != null) {
      badge += ' <span class="cs-git-status">';
      if (store.ahead > 0)  badge += '<span class="cs-git-ahead" title="' + store.ahead + ' ahead">\u2191' + store.ahead + '</span>';
      if (store.behind > 0) badge += '<span class="cs-git-behind" title="' + store.behind + ' behind">\u2193' + store.behind + '</span>';
      badge += '</span>';
    }
    return badge;
  }
  return '<span class="badge cs-type-badge cs-type-folder">Folder</span>';
}

/** Render the sync badge cell for a store entry. */
function csSyncCell(store) {
  if (!store.sync || !store.sync.provider) return '\u2014';
  var provider = escapeHtml(store.sync.provider);
  var popoverLines = '<strong>' + provider + '</strong>';
  if (store.sync.remote_path) popoverLines += '<br>' + escapeHtml(store.sync.remote_path);
  if (store.sync.notes)       popoverLines += '<br><em>' + escapeHtml(store.sync.notes) + '</em>';
  return '<span class="cs-sync-badge" tabindex="0" aria-describedby="cs-sync-popover-' + escapeHtml(store.id) + '">' + provider + '</span>' +
    '<span class="cs-sync-popover" id="cs-sync-popover-' + escapeHtml(store.id) + '" role="tooltip">' + popoverLines + '</span>';
}

/** Render the path cell: truncated text + copy button. */
function csPathCell(store) {
  var safePath = escapeHtml(store.path);
  return '<span class="cs-path-cell" title="">' +
    '<span class="cs-path-text">' + safePath + '</span>' +
    '<button class="btn btn-sm cs-copy-btn" data-path="' + safePath + '" aria-label="Copy path" title="Copy full path">\uD83D\uDCCB</button>' +
  '</span>';
}

/** Render the default star for a store row. */
function csDefaultStar(store) {
  if (store.is_default) {
    return '<button class="cs-default-star cs-star-filled" data-store-id="' + escapeHtml(store.id) + '" disabled title="Default store">\u2605</button>';
  }
  return '<button class="cs-default-star cs-star-outline" data-store-id="' + escapeHtml(store.id) + '" title="Set as default">\u2606</button>';
}

/* ── Tab rendering ───────────────────────────────────────── */

/** Render the full Stores tab HTML. Sets module-level state. */
function renderStoresTab(stores) {
  csStores   = stores ? stores.slice(0) : [];
  csOriginal = stores ? stores.slice(0) : [];

  var notifHtml = '';
  var pendingBanner = document.getElementById('cs-notification-banner');
  if (pendingBanner) {
    notifHtml = pendingBanner.outerHTML;
  }

  if (!csStores.length) {
    return notifHtml +
      UI.emptyState('No stores configured. Add your first store to get started.') +
      '<div class="cs-action-bar mt-16">' +
        '<button class="btn btn-primary" id="cs-add-store-btn">Add Store</button>' +
      '</div>';
  }

  var rows = '';
  for (var i = 0; i < csStores.length; i++) {
    var s = csStores[i];
    rows +=
      '<tr data-store-id="' + escapeHtml(s.id) + '">' +
        '<td>' + csDefaultStar(s) + '</td>' +
        '<td>' + escapeHtml(s.label || s.id) + '</td>' +
        '<td><code>' + escapeHtml(s.id) + '</code></td>' +
        '<td>' + csPathCell(s) + '</td>' +
        '<td>' + csTypeBadge(s) + '</td>' +
        '<td>' + (s.project_count != null ? s.project_count : '\u2014') + '</td>' +
        '<td>' + (s.repository_count != null ? s.repository_count : '\u2014') + '</td>' +
        '<td class="cs-sync-cell">' + csSyncCell(s) + '</td>' +
        '<td class="cs-row-actions">' +
          '<button class="btn btn-sm btn-secondary cs-edit-btn" data-store-id="' + escapeHtml(s.id) + '">Edit</button> ' +
          '<button class="btn btn-sm btn-danger cs-remove-btn" data-store-id="' + escapeHtml(s.id) + '">Remove</button>' +
        '</td>' +
      '</tr>';
  }

  return notifHtml +
    '<div class="table-wrapper">' +
      '<table>' +
        '<thead><tr>' +
          '<th title="Default store">&#9733;</th>' +
          '<th>Label</th>' +
          '<th>ID</th>' +
          '<th>Path</th>' +
          '<th>Type</th>' +
          '<th>Projects</th>' +
          '<th>Repositories</th>' +
          '<th>Sync</th>' +
          '<th>Actions</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div class="cs-action-bar mt-16">' +
      '<button class="btn btn-primary" id="cs-add-store-btn">Add Store</button>' +
      '<button class="btn btn-secondary" id="cs-reorder-btn">Reorder Stores</button>' +
    '</div>' +
    '<div id="cs-table-error"></div>';
}

/** Render the reorder sub-view (replaces main table while active). */
function csRenderReorderView(stores) {
  var rows = '';
  for (var i = 0; i < stores.length; i++) {
    var s = stores[i];
    rows +=
      '<div class="cs-reorder-row" data-store-id="' + escapeHtml(s.id) + '">' +
        '<span class="cs-reorder-label">' + escapeHtml(s.label || s.id) + ' <code>' + escapeHtml(s.id) + '</code></span>' +
        '<span class="cs-reorder-btns">' +
          '<button class="btn btn-sm btn-secondary cs-move-up' + (i === 0 ? ' cs-move-disabled' : '') + '" ' +
            (i === 0 ? 'disabled ' : '') +
            'data-store-id="' + escapeHtml(s.id) + '" aria-label="Move ' + escapeHtml(s.id) + ' up">\u2191</button>' +
          '<button class="btn btn-sm btn-secondary cs-move-down' + (i === stores.length - 1 ? ' cs-move-disabled' : '') + '" ' +
            (i === stores.length - 1 ? 'disabled ' : '') +
            'data-store-id="' + escapeHtml(s.id) + '" aria-label="Move ' + escapeHtml(s.id) + ' down">\u2193</button>' +
        '</span>' +
      '</div>';
  }

  return '<div class="cs-reorder-view">' +
    '<div class="cs-reorder-info info-banner">Store order determines priority \u2014 when the same repository is registered in multiple stores, the first store wins.</div>' +
    '<div id="cs-reorder-list">' + rows + '</div>' +
    '<div id="cs-reorder-error"></div>' +
    '<div class="cs-action-bar mt-16">' +
      '<button class="btn btn-secondary" id="cs-reorder-done-btn">Done</button>' +
    '</div>' +
  '</div>';
}

/* ── Modal ───────────────────────────────────────────────── */

/** Render and insert the store add/edit modal. */
function csRenderStoreModal(mode, store) {
  var existing = document.getElementById('cs-modal-overlay');
  if (existing) existing.remove();

  var isAdd  = mode === 'add';
  var title  = isAdd ? 'Add Store' : 'Edit Store';
  var saveTxt = isAdd ? 'Add Store' : 'Save';

  var idField = isAdd
    ? '<div class="cs-modal-field-group">' +
        '<label class="form-label" for="cs-modal-id">Store ID</label>' +
        '<input class="form-control" type="text" id="cs-modal-id" autocomplete="off" placeholder="e.g. my-store">' +
        '<span class="cs-modal-field-error" id="cs-modal-id-err"></span>' +
      '</div>'
    : '<div class="cs-modal-field-group">' +
        '<label class="form-label">Store ID</label>' +
        '<div class="cs-modal-readonly"><code>' + escapeHtml(store ? store.id : '') + '</code></div>' +
      '</div>';

  var pathField = isAdd
    ? '<div class="cs-modal-field-group">' +
        '<label class="form-label" for="cs-modal-path">Path</label>' +
        '<input class="form-control" type="text" id="cs-modal-path" autocomplete="off" placeholder="e.g. /home/user/ledger">' +
        '<span class="cs-modal-field-error" id="cs-modal-path-err"></span>' +
      '</div>'
    : '<div class="cs-modal-field-group">' +
        '<label class="form-label">Path</label>' +
        '<div class="cs-modal-readonly">' + escapeHtml(store ? store.path : '') + '</div>' +
      '</div>';

  var dirModeField = isAdd
    ? '<div class="cs-modal-field-group cs-modal-radio-group">' +
        '<label class="form-label">Directory</label>' +
        '<label class="cs-radio-option">' +
          '<input type="radio" name="cs-dir-mode" value="create" ' + (csModalCreateDir ? 'checked' : '') + '> Create new directory' +
        '</label>' +
        '<label class="cs-radio-option">' +
          '<input type="radio" name="cs-dir-mode" value="existing" ' + (!csModalCreateDir ? 'checked' : '') + '> Use existing directory' +
        '</label>' +
        '<div class="cs-modal-dir-note" id="cs-modal-dir-note" style="' + (csModalCreateDir ? 'display:none' : '') + '">' +
          'The directory must already exist. Any existing <code>.repositories.json</code> will be preserved.' +
        '</div>' +
      '</div>'
    : '';

  var labelVal = store && store.label ? escapeHtml(store.label) : '';
  /* In edit mode with an existing label the field is effectively required; omit the optional hint. */
  var labelHint = (isAdd || !(store && store.label))
    ? ' <span class="text-muted">(optional)</span>'
    : '';
  var labelField =
    '<div class="cs-modal-field-group">' +
      '<label class="form-label" for="cs-modal-label">Label' + labelHint + '</label>' +
      '<input class="form-control" type="text" id="cs-modal-label" autocomplete="off" value="' + labelVal + '" placeholder="Display name">' +
      '<span class="cs-modal-field-error" id="cs-modal-label-err"></span>' +
    '</div>';

  var modalHtml =
    '<div class="cs-modal-overlay" id="cs-modal-overlay" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '<div class="cs-modal" id="cs-modal">' +
        '<div class="cs-modal-header">' +
          '<span class="cs-modal-title">' + title + '</span>' +
          '<button class="cs-modal-close" id="cs-modal-close-btn" aria-label="Close">\u00d7</button>' +
        '</div>' +
        '<div class="cs-modal-body">' +
          idField +
          pathField +
          dirModeField +
          labelField +
          '<div id="cs-modal-error"></div>' +
        '</div>' +
        '<div class="cs-modal-footer">' +
          '<button class="btn btn-primary" id="cs-modal-save-btn">' + saveTxt + '</button>' +
          '<button class="btn btn-secondary" id="cs-modal-cancel-btn">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var overlay = openModal(modalHtml, document.activeElement);
  var modal   = overlay.querySelector('#cs-modal');

  wireModalEvents(overlay, {
    onSubmit: csHandleModalSave,
    excludeTextarea: false,
    onClose: function () {
      closeModal(overlay);
      csModalMode = null;
      csModalStoreId = null;
    }
  });

  /* Dir-mode radio toggle (only present in add mode) */
  var radios = modal.querySelectorAll('input[name="cs-dir-mode"]');
  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', function () {
      csModalCreateDir = document.querySelector('input[name="cs-dir-mode"]:checked').value === 'create';
      var note = document.getElementById('cs-modal-dir-note');
      if (note) note.style.display = csModalCreateDir ? 'none' : '';
    });
  }

  document.getElementById('cs-modal-save-btn').addEventListener('click', csHandleModalSave);

  /* Auto-focus first editable field. */
  var firstInput = modal.querySelector('input');
  if (firstInput) firstInput.focus();
}

/* ── Modal save logic ────────────────────────────────────── */

/** Validate modal fields.  Returns true when all fields pass, false otherwise. */
function csValidateModalFields() {
  var valid = true;

  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  }

  if (csModalMode === 'add') {
    var idInput   = document.getElementById('cs-modal-id');
    var pathInput = document.getElementById('cs-modal-path');
    if (idInput)   showErr('cs-modal-id-err',   csValidateId(idInput.value));
    if (pathInput) showErr('cs-modal-path-err',  csValidatePath(pathInput.value));
  }

  var labelInput = document.getElementById('cs-modal-label');
  if (labelInput) showErr('cs-modal-label-err', csValidateLabel(labelInput.value));

  return valid;
}

/** Handle the modal Save/Add button click. */
function csHandleModalSave() {
  /* Clear previous errors */
  var errFields = document.querySelectorAll('.cs-modal-field-error');
  for (var i = 0; i < errFields.length; i++) errFields[i].textContent = '';
  var modalErr = document.getElementById('cs-modal-error');
  if (modalErr) modalErr.innerHTML = '';

  if (!csValidateModalFields()) return;

  var saveBtn = document.getElementById('cs-modal-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }

  var labelInput = document.getElementById('cs-modal-label');
  var label = labelInput ? labelInput.value.trim() : '';

  if (csModalMode === 'edit') {
    /* Guard: empty label has two outcomes depending on whether the store had one.
       The API requires label: string, so sending {} would fail with 'Required'. */
    var existingStore = csFindStore(csModalStoreId);
    var existingLabel = existingStore ? (existingStore.label || '') : '';
    if (!label && !existingLabel) {
      closeModal(document.getElementById('cs-modal-overlay'));
      csModalMode = null;
      csModalStoreId = null;
      return;
    }
    if (!label) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      var labelErrEl = document.getElementById('cs-modal-label-err');
      if (labelErrEl) labelErrEl.textContent = 'Label is required when editing a labelled store. Provide a new label or leave the current one.';
      return;
    }
    API.updateStore(csModalStoreId, { label: label })
      .then(function (stores) {
        closeModal(document.getElementById('cs-modal-overlay'));
        csModalMode = null;
        csModalStoreId = null;
        csRefreshWithStores(stores);
      })
      .catch(function (err) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        if (modalErr) showError(modalErr, 'Save failed: ' + (err.message || String(err)));
      });
    return;
  }

  /* Add mode */
  var idInput   = document.getElementById('cs-modal-id');
  var pathInput = document.getElementById('cs-modal-path');
  var data = {
    id:   idInput   ? idInput.value.trim()   : '',
    path: pathInput ? pathInput.value.trim() : ''
  };
  if (label) data.label = label;

  var apiCall = csModalCreateDir ? API.addStore(data) : API.importStore(data);

  apiCall.then(function (result) {
    closeModal(document.getElementById('cs-modal-overlay'));
    csModalMode = null;
    csModalStoreId = null;
    /* importStore returns { stores, warning? }; addStore returns stores[] */
    var updatedStores = result && result.stores ? result.stores : result;
    var warning       = result && result.warning ? result.warning : null;
    csRefreshWithStores(updatedStores, warning);
  }).catch(function (err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = csModalMode === 'add' ? 'Add Store' : 'Save'; }
    if (modalErr) showError(modalErr, (csModalCreateDir ? 'Add' : 'Import') + ' failed: ' + (err.message || String(err)));
  });
}

/* ── Refresh helpers ─────────────────────────────────────── */

/** Re-render the Stores tab with a fresh store list from the server. */
function csRefreshTab() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;
  API.getStores().then(function (stores) {
    contentEl.innerHTML = renderStoresTab(stores);
    csWireEvents();
  }).catch(function (err) {
    showError(contentEl, 'Failed to reload stores: ' + (err.message || String(err)));
  });
}

/** Re-render the tab from an already-fetched store list (avoids round-trip). */
function csRefreshWithStores(stores, warning) {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  /* Render the tab first so the banner placeholder is present. */
  contentEl.innerHTML = renderStoresTab(stores);

  /* Remove any banner renderStoresTab() may have included before injecting a fresh one. */
  var existingBanner = contentEl.querySelector('#cs-notification-banner');
  if (existingBanner) existingBanner.remove();

  /* Inject notification banner above the table when a warning is present. */
  if (warning) {
    var banner =
      '<div class="cs-notification-banner" id="cs-notification-banner">' +
        '<span>' + escapeHtml(warning) + '</span>' +
        '<button class="cs-banner-close" aria-label="Dismiss">\u00d7</button>' +
      '</div>';
    contentEl.insertAdjacentHTML('afterbegin', banner);
  }

  csWireEvents();
}

/* ── Event wiring ────────────────────────────────────────── */

/** Wire all event handlers for the Stores tab (delegated from config-tab-content). */
function csWireEvents() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  /* Remove stale delegated listener before re-wiring — config-tab-content persists across
     innerHTML replacements so the element retains directly-registered listeners. */
  if (csClickHandler) contentEl.removeEventListener('click', csClickHandler);
  csClickHandler = function (e) {
    var target = e.target;

    /* Add Store button */
    if (target.id === 'cs-add-store-btn') {
      csModalMode      = 'add';
      csModalStoreId   = null;
      csModalCreateDir = true;
      csRenderStoreModal('add', null);
      return;
    }

    /* Reorder Stores button */
    if (target.id === 'cs-reorder-btn') {
      csReorderMode = true;
      contentEl.innerHTML = csRenderReorderView(csStores);
      csWireEvents();
      return;
    }

    /* Done (reorder) */
    if (target.id === 'cs-reorder-done-btn') {
      csReorderMode = false;
      csRefreshTab();
      return;
    }

    /* Dismiss notification banner */
    if (target.classList.contains('cs-banner-close')) {
      var banner = document.getElementById('cs-notification-banner');
      if (banner) banner.remove();
      return;
    }

    /* Default star */
    if (target.classList.contains('cs-default-star') && target.classList.contains('cs-star-outline')) {
      var storeId = target.getAttribute('data-store-id');
      target.disabled = true;
      API.setDefaultStore(storeId)
        .then(function (stores) { csRefreshWithStores(stores); })
        .catch(function (err) {
          target.disabled = false;
          csShowTableError('Failed to set default: ' + (err.message || String(err)));
        });
      return;
    }

    /* Edit button */
    var editBtn = target.closest('.cs-edit-btn');
    if (editBtn) {
      var editStoreId = editBtn.getAttribute('data-store-id');
      var editStore   = csFindStore(editStoreId);
      csModalMode    = 'edit';
      csModalStoreId = editStoreId;
      csRenderStoreModal('edit', editStore);
      return;
    }

    /* Remove button */
    var removeBtn = target.closest('.cs-remove-btn');
    if (removeBtn) {
      var removeStoreId = removeBtn.getAttribute('data-store-id');
      var removeStore   = csFindStore(removeStoreId);
      var hasRepos = removeStore && removeStore.repository_count > 0;
      var confirmMsg = hasRepos
        ? 'Store "' + (removeStore.label || removeStoreId) + '" has ' + removeStore.repository_count + ' registered repositor' + (removeStore.repository_count === 1 ? 'y' : 'ies') + '. Remove it anyway? The directory will not be deleted.'
        : 'Remove store "' + (removeStore ? removeStore.label || removeStoreId : removeStoreId) + '"? The directory will not be deleted.';
      if (!confirm(confirmMsg)) return;
      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing\u2026';
      API.removeStore(removeStoreId)
        .then(function (result) {
          var updatedStores = result && result.stores ? result.stores : result;
          csRefreshWithStores(updatedStores);
        })
        .catch(function (err) {
          removeBtn.disabled = false;
          removeBtn.textContent = 'Remove';
          csShowTableError('Remove failed: ' + (err.message || String(err)));
        });
      return;
    }

    /* Copy path button */
    var copyBtn = target.closest('.cs-copy-btn');
    if (copyBtn) {
      var fullPath = copyBtn.getAttribute('data-path');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullPath).then(function () {
          copyBtn.textContent = '\u2713';
          setTimeout(function () { copyBtn.textContent = '\uD83D\uDCCB'; }, 1200);
        });
      } else {
        /* Fallback for environments without clipboard API */
        var ta = document.createElement('textarea');
        ta.value = fullPath;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.textContent = '\u2713';
        setTimeout(function () { copyBtn.textContent = '\uD83D\uDCCB'; }, 1200);
      }
      return;
    }

    /* Move Up (reorder) */
    var moveUpBtn = target.closest('.cs-move-up');
    if (moveUpBtn && !moveUpBtn.disabled) {
      var upId  = moveUpBtn.getAttribute('data-store-id');
      var upIdx = csStoreIndex(upId);
      if (upIdx > 0) csMoveStore(upIdx, upIdx - 1);
      return;
    }

    /* Move Down (reorder) */
    var moveDownBtn = target.closest('.cs-move-down');
    if (moveDownBtn && !moveDownBtn.disabled) {
      var downId  = moveDownBtn.getAttribute('data-store-id');
      var downIdx = csStoreIndex(downId);
      if (downIdx < csStores.length - 1) csMoveStore(downIdx, downIdx + 1);
      return;
    }
  };
  contentEl.addEventListener('click', csClickHandler);

  /* Hover popover visibility for sync badges (not present in reorder sub-view) */
  if (csReorderMode) return;
  var syncBadges = contentEl.querySelectorAll('.cs-sync-badge');
  for (var i = 0; i < syncBadges.length; i++) {
    (function (badge) {
      badge.addEventListener('mouseenter', function () {
        var popoverId = badge.getAttribute('aria-describedby');
        var popover   = document.getElementById(popoverId);
        if (popover) {
          popover.classList.add('cs-sync-popover-visible');
          var rect = popover.getBoundingClientRect();
          if (rect.right > window.innerWidth) {
            popover.style.left  = 'auto';
            popover.style.right = '0';
          }
        }
      });
      badge.addEventListener('mouseleave', function () {
        var popoverId = badge.getAttribute('aria-describedby');
        var popover   = document.getElementById(popoverId);
        if (popover) {
          popover.classList.remove('cs-sync-popover-visible');
          popover.style.left  = '';
          popover.style.right = '';
        }
      });
      badge.addEventListener('focus', function () {
        var popoverId = badge.getAttribute('aria-describedby');
        var popover   = document.getElementById(popoverId);
        if (popover) {
          popover.classList.add('cs-sync-popover-visible');
          var rect = popover.getBoundingClientRect();
          if (rect.right > window.innerWidth) {
            popover.style.left  = 'auto';
            popover.style.right = '0';
          }
        }
      });
      badge.addEventListener('blur', function () {
        var popoverId = badge.getAttribute('aria-describedby');
        var popover   = document.getElementById(popoverId);
        if (popover) {
          popover.classList.remove('cs-sync-popover-visible');
          popover.style.left  = '';
          popover.style.right = '';
        }
      });
    }(syncBadges[i]));
  }
}

/* ── Reorder helpers ─────────────────────────────────────── */

/** Find a store in csStores by id. Returns null if not found. */
function csFindStore(id) {
  if (!csStores) return null;
  for (var i = 0; i < csStores.length; i++) {
    if (csStores[i].id === id) return csStores[i];
  }
  return null;
}

/** Return the index of a store in csStores by id. */
function csStoreIndex(id) {
  if (!csStores) return -1;
  for (var i = 0; i < csStores.length; i++) {
    if (csStores[i].id === id) return i;
  }
  return -1;
}

/** Swap two entries in csStores and send PUT /api/stores/order. */
function csMoveStore(fromIdx, toIdx) {
  var tmp           = csStores[fromIdx];
  csStores[fromIdx] = csStores[toIdx];
  csStores[toIdx]   = tmp;

  var order = [];
  for (var i = 0; i < csStores.length; i++) order.push(csStores[i].id);

  /* Re-render reorder view immediately (optimistic UI) */
  var contentEl = document.getElementById('config-tab-content');
  if (contentEl) {
    contentEl.innerHTML = csRenderReorderView(csStores);
    csWireEvents();
    /* Disable all move buttons while the API call is in-flight. */
    var moveBtns = contentEl.querySelectorAll('.cs-move-up, .cs-move-down');
    for (var j = 0; j < moveBtns.length; j++) moveBtns[j].disabled = true;
  }

  API.reorderStores(order)
    .then(function (stores) {
      csStores   = stores.slice(0);
      csOriginal = stores.slice(0);
      /* Re-render to reflect server-confirmed order */
      if (contentEl) {
        contentEl.innerHTML = csRenderReorderView(csStores);
        csWireEvents();
      }
    })
    .catch(function (err) {
      /* Revert the optimistic swap before re-rendering. */
      var tmp2      = csStores[fromIdx];
      csStores[fromIdx] = csStores[toIdx];
      csStores[toIdx]   = tmp2;
      /* Re-render first so #cs-reorder-error exists before csShowTableError() writes to it. */
      if (contentEl) {
        contentEl.innerHTML = csRenderReorderView(csStores);
        csWireEvents();
      }
      csShowTableError('Reorder failed: ' + (err.message || String(err)));
    });
}

/** Show an inline error below the store table or reorder list. */
function csShowTableError(msg) {
  var el = document.getElementById('cs-table-error') || document.getElementById('cs-reorder-error');
  if (el) showError(el, msg);
}
