/* ============================================================
   views/strategy.js — Strategy view (Repository List + Detail/Editor)
   Section 4g of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, showLoading, showError

   Rendering model (renderStrategyList):
     The list view uses a partial-render pattern to preserve Add Repository
     form state across toggle interactions. The DOM is divided into independent
     areas:
       #strategy-tab-repos    — container for the Repositories tab content
       #strategy-toggle-area  — rebuilt on every render pass
       #strategy-table-area   — rebuilt on every render pass
       #add-repo-form (form)  — written once at initial render; never touched
                                by refreshTable(), so in-flight field values
                                and validation messages are preserved when the
                                user toggles the "Show undeclared repositories"
                                checkbox.
       #strategy-tab-conflicts — container for the Conflicts tab content;
                                 only rendered in multi-store mode; refreshed
                                 independently by refreshConflicts().
   ============================================================ */


/* ── renderStrategyList ──────────────────────────────────────
   Renders the repository list at #/strategy.
   Shows: label, folder names, vision status; Add Repository form.
   Includes a "Show undeclared repositories" checkbox that re-fetches
   with ?include_undeclared=true and renders undeclared entries with a
   muted visual style and a "Register" button that pre-fills the form.
   In multi-store mode (stores.length > 1), also renders:
     - A tab bar ("Repositories" | "Conflicts") above the content
     - A "Store" dropdown on the Add Repository form
     - A "Conflicts" tab listing cross-store registry conflicts with
       winner ("Active") / shadowed indicators and resolution actions.
   ─────────────────────────────────────────────────────────── */
function renderStrategyList(app) {
  showLoading(app);

  Promise.all([
    API.listRepos(false),
    API.getStores()
  ]).then(function (results) {
    var repos = results[0];
    var stores = results[1];
    if (stores.length <= 1) {
      renderList(repos, false, stores, []);
      return;
    }
    return API.getStoreConflicts().then(function (conflicts) {
      renderList(repos, false, stores, conflicts);
    });
  }).catch(function (err) {
    showError(app, 'Failed to load repositories: ' + (err.message || String(err)));
  });

  function visionStatus(repo) {
    if (!repo.has_vision) return '<span class="badge badge-blocked">No vision</span>';
    return repo.has_full_vision
      ? '<span class="badge badge-complete">Full vision</span>'
      : '<span class="badge badge-in-progress">Partial vision</span>';
  }

  /**
   * Builds the checkbox toggle HTML for showing/hiding undeclared repositories.
   * The checked state is preserved across re-renders so the UI doesn't flicker.
   */
  function buildToggleHtml(checked) {
    return (
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:14px">' +
          '<input type="checkbox" id="show-undeclared-cb" class="form-check"' + (checked ? ' checked' : '') + '>' +
          'Show undeclared repositories' +
        '</label>' +
      '</div>'
    );
  }

  function buildTableHtml(repos) {
    if (!repos.length) {
      return '<p class="text-muted mt-16">No repositories declared yet. Use the form below to add one.</p>';
    }
    var rows = repos.map(function (r) {
      var folderNames = (r.folder_names || []).map(escapeHtml).join(', ') || '<em class="text-muted">\u2014</em>';
      if (r.declared === false) {
        /* Undeclared (filesystem-discovered) entry — muted row with Register button */
        return (
          '<tr style="opacity:0.6">' +
            '<td>' +
              '<span class="text-muted" style="font-style:italic">' + escapeHtml(r.label || r.id) + '</span>' +
              ' <span class="badge badge-archived" style="font-size:10px;vertical-align:middle">Undeclared</span>' +
            '</td>' +
            '<td class="text-muted">' + escapeHtml(r.id) + '</td>' +
            '<td class="text-muted">' + folderNames + '</td>' +
            '<td>' +
              '<button type="button" class="btn btn-secondary btn-sm" data-register-folder="' + escapeHtml(r.id) + '">Register</button>' +
            '</td>' +
          '</tr>'
        );
      }
      return (
        '<tr>' +
          '<td><a href="#/strategy/' + encodeURIComponent(r.id) + '">' + escapeHtml(r.label || r.id) + '</a></td>' +
          '<td class="text-muted">' + escapeHtml(r.id) + '</td>' +
          '<td>' + folderNames + '</td>' +
          '<td>' + visionStatus(r) + '</td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>Label</th>' +
          '<th>ID</th>' +
          '<th>Folder Names</th>' +
          '<th>Vision</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>'
    );
  }

  /**
   * Re-renders only the repo table and toggle, preserving the Add Repository
   * form and its current field values. Called on checkbox toggle.
   */
  function refreshTable(checked) {
    var toggleEl = document.getElementById('strategy-toggle-area');
    var tableEl = document.getElementById('strategy-table-area');
    if (toggleEl) toggleEl.innerHTML = buildToggleHtml(checked);
    if (tableEl) tableEl.innerHTML = '<p class="text-muted" style="font-size:13px">Loading\u2026</p>';

    API.listRepos(checked).then(function (repos) {
      if (tableEl) tableEl.innerHTML = buildTableHtml(repos);
      wireRegisterButtons();
      wireToggle();
    }).catch(function (err) {
      if (tableEl) showError(tableEl, 'Failed to load repositories: ' + (err.message || String(err)));
      wireToggle();
    });
  }

  /**
   * Transforms a raw filesystem directory name into a valid SLUG_REGEX slug.
   * Rules applied in order:
   *   1. Lowercase
   *   2. Replace any character that is not [a-z0-9_-] with a hyphen
   *   3. Strip any leading characters that are not alphanumeric
   *   4. Collapse consecutive hyphens into a single hyphen
   *   5. Strip any trailing hyphens
   *   6. Fall back to 'repo' if the result is empty
   */
  function sanitiseSlug(raw) {
    var slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .replace(/-{2,}/g, '-')
      .replace(/-+$/, '');
    return slug || 'repo';
  }

  /** Wires the "Register" buttons on undeclared rows to pre-fill the Add form. */
  function wireRegisterButtons() {
    var tableEl = document.getElementById('strategy-table-area');
    if (!tableEl) return;
    tableEl.querySelectorAll('[data-register-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var folderName = btn.getAttribute('data-register-folder');
        var idInput = document.getElementById('new-repo-id');
        var labelInput = document.getElementById('new-repo-label');
        var foldersInput = document.getElementById('new-repo-folders');
        if (idInput) idInput.value = sanitiseSlug(folderName);
        if (labelInput) labelInput.value = folderName;
        if (foldersInput) foldersInput.value = folderName;
        /* Scroll the Add Repository form into view */
        var formCard = document.getElementById('add-repo-form');
        if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (idInput) idInput.focus();
      });
    });
  }

  /** Wires the Show undeclared checkbox change handler after each re-render. */
  function wireToggle() {
    var cb = document.getElementById('show-undeclared-cb');
    if (!cb) return;
    cb.addEventListener('change', function () {
      refreshTable(cb.checked);
    });
  }

  /* ── Conflicts tab helpers ────────────────────────────────────────────── */

  /* In-memory conflict index and store snapshot — updated by refreshConflicts. */
  var conflictsIndex = {};
  var storesSnapshot = [];

  /**
   * Returns a short vision summary (first non-null horizon, truncated to 60 chars).
   */
  function visionSummary(vision) {
    if (!vision) return '';
    var text = vision.short_term || vision.mid_term || vision.long_term || '';
    if (!text) return '';
    return text.length > 60 ? text.substring(0, 57 /* 60 chars - 3 for ellipsis */) + '\u2026' : text;
  }

  /**
   * Builds the HTML for the Conflicts tab content.
   * Each conflict renders as a card with a data table of per-store entries,
   * winner ("Active") / shadowed indicators, and resolution action buttons.
   */
  function buildConflictsHtml(conflicts, storeLabels) {
    if (!conflicts.length) {
      return '<p class="text-muted mt-16">No conflicts \u2014 each repository is registered in exactly one store.</p>';
    }

    return conflicts.map(function (conflict) {
      var rows = conflict.entries.map(function (e) {
        var isWinner = e.store_id === conflict.winner_store_id;
        var storeLabel = escapeHtml(storeLabels[e.store_id] || e.store_id);
        var summary = escapeHtml(visionSummary(e.entry.vision));
        var modified = escapeHtml((e.entry.last_modified || '').substring(0, 10));
        var statusBadge = isWinner
          ? '<span class="badge badge-complete">Active</span>'
          : '<span class="badge badge-archived">Shadowed</span>';
        var actions = isWinner ? '' : (
          '<button type="button" class="btn btn-danger btn-sm" style="margin-right:4px"' +
            ' data-resolve-remove="' + escapeHtml(conflict.repo_name) + '"' +
            ' data-resolve-store="' + escapeHtml(e.store_id) + '"' +
          '>Remove from Store</button>' +
          '<button type="button" class="btn btn-secondary btn-sm"' +
            ' data-resolve-move="' + escapeHtml(conflict.repo_name) + '"' +
            ' data-resolve-store="' + escapeHtml(e.store_id) + '"' +
          '>Move to Store</button>'
        );
        return (
          '<tr>' +
            '<td>' + storeLabel + '</td>' +
            '<td class="text-muted" style="font-size:13px">' + (summary || '<em>\u2014</em>') + '</td>' +
            '<td class="text-muted" style="font-size:13px">' + (modified || '\u2014') + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + actions + '</td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="card mt-16">' +
          '<h3 style="margin-top:0;margin-bottom:12px">' + escapeHtml(conflict.repo_name) + '</h3>' +
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>Store</th>' +
              '<th>Vision</th>' +
              '<th>Last Modified</th>' +
              '<th>Status</th>' +
              '<th>Actions</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
          '<div class="conflict-msg" data-conflict="' + escapeHtml(conflict.repo_name) + '" style="margin-top:8px"></div>' +
        '</div>'
      );
    }).join('');
  }

  /**
   * Resolves a conflict by deleting all copies then re-creating in targetStoreId.
   *
   * Uses the winner entry's data as the canonical source for re-creation.
   * Deletion is sequential (backend always removes the current winner first,
   * so each call promotes the next shadowed copy to winner until all are gone).
   */
  function resolveConflict(conflict, targetStoreId, msgEl) {
    var repoName = conflict.repo_name;
    var numCopies = conflict.entries.length;

    /* Locate winner entry for canonical field values; fall back to first entry. */
    var winnerEntry = null;
    for (var i = 0; i < conflict.entries.length; i++) {
      if (conflict.entries[i].store_id === conflict.winner_store_id) {
        winnerEntry = conflict.entries[i];
        break;
      }
    }
    if (!winnerEntry) winnerEntry = conflict.entries[0];
    var entryData = winnerEntry.entry;

    if (msgEl) msgEl.innerHTML = '<span class="text-muted" style="font-size:13px">Resolving\u2026</span>';

    function deleteAll(remaining, onDone) {
      if (remaining <= 0) { onDone(); return; }
      API.deleteRepo(repoName).then(function () {
        deleteAll(remaining - 1, onDone);
      }).catch(function (err) {
        if (msgEl) showError(msgEl, 'Failed during conflict resolution: ' + (err.message || String(err)));
      });
    }

    deleteAll(numCopies, function () {
      var payload = {
        id: entryData.id,
        label: entryData.label,
        folder_names: entryData.folder_names,
        store_id: targetStoreId
      };
      if (entryData.vision) payload.vision = entryData.vision;

      API.createRepo(payload).then(function () {
        if (msgEl) msgEl.innerHTML = '';
        refreshConflicts();
      }).catch(function (err) {
        if (msgEl) showError(msgEl, 'Repository was removed from all stores but could not be recreated: ' + (err.message || String(err)));
      });
    });
  }

  /** Re-fetches conflicts and re-renders the conflicts tab content area. */
  function refreshConflicts() {
    var tabContent = document.getElementById('strategy-tab-conflicts');
    if (!tabContent) return;
    tabContent.innerHTML = '<p class="text-muted" style="font-size:13px">Loading\u2026</p>';

    // Sequential (not Promise.all): only the store count determines whether
    // getStoreConflicts() is called, so we need stores first to guard the call.
    API.getStores().then(function (stores) {
      storesSnapshot = stores;
      conflictsIndex = {};

      if (stores.length <= 1) {
        tabContent.innerHTML = buildConflictsHtml([], {});
        updateConflictBadge(0);
        return;
      }

      return API.getStoreConflicts().then(function (conflicts) {
        conflicts.forEach(function (c) { conflictsIndex[c.repo_name] = c; });

        var storeLabels = {};
        stores.forEach(function (s) { storeLabels[s.id] = s.label; });

        tabContent.innerHTML = buildConflictsHtml(conflicts, storeLabels);
        updateConflictBadge(conflicts.length);
        wireConflictActions(tabContent);
      });
    }).catch(function (err) {
      showError(tabContent, 'Failed to load conflicts: ' + (err.message || String(err)));
    });
  }

  /** Updates the conflict count badge on the Conflicts tab button. */
  function updateConflictBadge(count) {
    var badge = document.getElementById('strategy-conflict-badge');
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : '';
    badge.style.display = count > 0 ? '' : 'none';
  }

  /**
   * Wires conflict resolution action buttons inside a given container element.
   * Must be called each time conflict tab HTML is (re)rendered.
   */
  function wireConflictActions(container) {
    /* "Remove from Store" — removes the shadowed copy; keeps winner's copy. */
    container.querySelectorAll('[data-resolve-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var repoName = btn.getAttribute('data-resolve-remove');
        var conflict = conflictsIndex[repoName];
        if (!conflict) return;
        var msgEl = container.querySelector('.conflict-msg[data-conflict="' + repoName + '"]');
        resolveConflict(conflict, conflict.winner_store_id, msgEl);
      });
    });

    /* "Move to Store" — shows an inline store picker then re-creates in the chosen store. */
    container.querySelectorAll('[data-resolve-move]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var repoName = btn.getAttribute('data-resolve-move');
        var currentStoreId = btn.getAttribute('data-resolve-store');
        var conflict = conflictsIndex[repoName];
        if (!conflict) return;
        var msgEl = container.querySelector('.conflict-msg[data-conflict="' + repoName + '"]');

        /* Build the store options — all stores except the current (shadowed) one. */
        var otherStores = storesSnapshot.filter(function (s) { return s.id !== currentStoreId; });
        if (!otherStores.length) {
          if (msgEl) showError(msgEl, 'No other stores available to move to.');
          return;
        }
        var options = otherStores.map(function (s) {
          return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
        }).join('');

        /* Replace the action buttons in the same <td> with an inline picker. */
        var td = btn.parentElement;
        td.innerHTML = (
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<select class="form-control" style="width:auto;font-size:13px;padding:4px 8px" id="move-store-sel-' + escapeHtml(repoName) + '">' +
              options +
            '</select>' +
            '<button type="button" class="btn btn-primary btn-sm" id="move-store-ok-' + escapeHtml(repoName) + '">Move</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" id="move-store-cancel-' + escapeHtml(repoName) + '">Cancel</button>' +
          '</div>'
        );

        var selectEl = document.getElementById('move-store-sel-' + repoName);
        var okBtn = document.getElementById('move-store-ok-' + repoName);
        var cancelBtn = document.getElementById('move-store-cancel-' + repoName);

        if (okBtn) {
          okBtn.addEventListener('click', function () {
            var targetStoreId = selectEl ? selectEl.value : otherStores[0].id;
            resolveConflict(conflict, targetStoreId, msgEl);
          });
        }
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            refreshConflicts();
          });
        }
      });
    });
  }

  function renderList(repos, checked, stores, conflicts) {
    var isMultiStore = stores.length > 1;
    var conflictCount = conflicts.length;

    /* Build a storeId → label map for the conflicts renderer. */
    var storeLabels = {};
    stores.forEach(function (s) { storeLabels[s.id] = s.label; });

    /* Seed the in-memory index used by conflict action handlers. */
    storesSnapshot = stores;
    conflictsIndex = {};
    conflicts.forEach(function (c) { conflictsIndex[c.repo_name] = c; });

    /* Store dropdown for the Add Repository form — multi-store mode only. */
    var storeDropdown = isMultiStore
      ? '<div class="form-group">' +
          '<label class="form-label" for="new-repo-store">Store</label>' +
          '<select id="new-repo-store" class="form-control">' +
          stores.map(function (s) {
            return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
          }).join('') +
          '</select>' +
        '</div>'
      : '';

    /* Tab bar — only rendered in multi-store mode. */
    var badgeHtml = conflictCount > 0
      ? '<span id="strategy-conflict-badge" class="badge badge-blocked" style="margin-left:6px;font-size:11px">' + conflictCount + '</span>'
      : '<span id="strategy-conflict-badge" class="badge badge-blocked" style="margin-left:6px;font-size:11px;display:none"></span>';

    var tabBar = isMultiStore
      ? '<div style="display:flex;border-bottom:1px solid var(--color-border);margin-bottom:16px">' +
          '<button class="dialogue-tab active" data-strategy-tab="repos">Repositories</button>' +
          '<button class="dialogue-tab" data-strategy-tab="conflicts">Conflicts' + badgeHtml + '</button>' +
        '</div>'
      : '';

    app.innerHTML =
      '<div class="page-header">' +
        '<h1>Strategy</h1>' +
        '<p class="text-muted">Manage repository declarations and strategic vision.</p>' +
      '</div>' +
      tabBar +
      '<div id="strategy-tab-repos">' +
        '<div id="strategy-toggle-area">' + buildToggleHtml(checked) + '</div>' +
        '<div id="strategy-table-area">' + buildTableHtml(repos) + '</div>' +
        '<div class="card mt-24" style="max-width:560px">' +
          '<h2 style="margin-top:0">Add Repository</h2>' +
          '<form id="add-repo-form">' +
            '<div class="form-group">' +
              '<label class="form-label" for="new-repo-id">ID <span class="text-muted">(slug, e.g. my-project)</span></label>' +
              '<input type="text" id="new-repo-id" class="form-control" placeholder="my-project" required>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="new-repo-label">Label</label>' +
              '<input type="text" id="new-repo-label" class="form-control" placeholder="My Project">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="new-repo-folders">Folder Names <span class="text-muted">(comma-separated)</span></label>' +
              '<input type="text" id="new-repo-folders" class="form-control" placeholder="my-project, my-project-dev">' +
            '</div>' +
            storeDropdown +
            '<button type="submit" class="btn btn-primary">Add Repository</button>' +
            '<div id="add-repo-msg"></div>' +
          '</form>' +
        '</div>' +
      '</div>' +
      (isMultiStore
        ? '<div id="strategy-tab-conflicts" style="display:none">' +
            buildConflictsHtml(conflicts, storeLabels) +
          '</div>'
        : '');

    wireRegisterButtons();
    wireToggle();

    /* Wire tab switching in multi-store mode. */
    if (isMultiStore) {
      var tabBtns = app.querySelectorAll('[data-strategy-tab]');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          tabBtns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var tab = btn.getAttribute('data-strategy-tab');
          var reposTabEl = document.getElementById('strategy-tab-repos');
          var conflictsTabEl = document.getElementById('strategy-tab-conflicts');
          if (reposTabEl) reposTabEl.style.display = (tab === 'repos') ? '' : 'none';
          if (conflictsTabEl) conflictsTabEl.style.display = (tab === 'conflicts') ? '' : 'none';
        });
      });

      /* Wire initial conflict action buttons. */
      var initialConflictsTab = document.getElementById('strategy-tab-conflicts');
      if (initialConflictsTab) wireConflictActions(initialConflictsTab);
    }

    /* Add Repository form submit handler. */
    var form = document.getElementById('add-repo-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msgEl = document.getElementById('add-repo-msg');
      var id = (document.getElementById('new-repo-id').value || '').trim();
      var label = (document.getElementById('new-repo-label').value || '').trim();
      var foldersRaw = (document.getElementById('new-repo-folders').value || '').trim();
      var folderNames = foldersRaw
        ? foldersRaw.split(',').map(function (f) { return f.trim(); }).filter(Boolean)
        : [];
      var storeEl = document.getElementById('new-repo-store');
      var storeId = (storeEl && storeEl.value) ? storeEl.value : undefined;

      if (!id) {
        showError(msgEl, 'ID is required.');
        return;
      }

      if (!folderNames.length) {
        showError(msgEl, 'At least one folder name is required.');
        return;
      }

      msgEl.innerHTML = '';
      var payload = { id: id, label: label || id, folder_names: folderNames };
      if (storeId) payload.store_id = storeId;
      API.createRepo(payload)
        .then(function () {
          Router.navigate('#/strategy/' + encodeURIComponent(id));
        })
        .catch(function (err) {
          showError(msgEl, 'Failed to create repository: ' + (err.message || String(err)));
        });
    });
  }
}


/* ── renderStrategyDetail ────────────────────────────────────
   Renders the repository detail/editor at #/strategy/:repoId.
   Shows: editable label, folder names (add/remove), three-field
          vision editor (short-term, mid-term, long-term),
          save button, breadcrumb navigation.
   ─────────────────────────────────────────────────────────── */
function renderStrategyDetail(app, repoId) {
  showLoading(app);

  API.getRepo(repoId).then(function (repo) {
    renderDetail(repo);
  }).catch(function (err) {
    if (err.code === 'NOT_FOUND' || (err.message && err.message.indexOf('404') !== -1)) {
      showError(app, 'Repository not found: ' + escapeHtml(repoId));
    } else {
      showError(app, 'Failed to load repository: ' + (err.message || String(err)));
    }
  });

  function buildFolderListHtml(folderNames) {
    if (!folderNames || !folderNames.length) {
      return '<p class="text-muted" id="folder-empty-note">No folder names added yet.</p>';
    }
    return folderNames.map(function (f, i) {
      return (
        '<div class="folder-entry" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<input type="text" class="form-control folder-name-input" data-folder-idx="' + i + '" value="' + escapeHtml(f) + '" style="flex:1">' +
          '<button type="button" class="btn btn-danger btn-sm" data-remove-folder="' + i + '">Remove</button>' +
        '</div>'
      );
    }).join('');
  }

  /* Reads all folder name inputs from the DOM in index order. */
  function collectFolderNamesFromDOM() {
    var result = [];
    document.querySelectorAll('.folder-name-input').forEach(function (inp) {
      var val = inp.value.trim();
      if (val) result.push(val);
    });
    return result;
  }

  function renderDetail(repo) {
    var vision = repo.vision || {};
    /* Working copy — mutated by add/remove, then merged with DOM on save. */
    var folderNames = (repo.folder_names || []).slice();

    function rebuildFolderSection() {
      var container = document.getElementById('folder-list');
      if (container) {
        container.innerHTML = buildFolderListHtml(folderNames);
        wireRemoveButtons();
      }
    }

    function wireRemoveButtons() {
      var container = document.getElementById('folder-list');
      if (!container) return;
      container.querySelectorAll('[data-remove-folder]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          /* Capture any in-flight edits before splicing */
          folderNames = collectFolderNamesFromDOM();
          var idx = parseInt(btn.getAttribute('data-remove-folder'), 10);
          folderNames.splice(idx, 1);
          rebuildFolderSection();
        });
      });
    }

    app.innerHTML =
      '<div class="breadcrumb">' +
        '<a href="#/strategy">Strategy</a>' +
        ' &rsaquo; ' +
        escapeHtml(repo.label || repo.id) +
      '</div>' +
      '<div class="page-header">' +
        '<h1>' + escapeHtml(repo.label || repo.id) + '</h1>' +
        '<p class="text-muted">ID: <code>' + escapeHtml(repo.id) + '</code></p>' +
      '</div>' +
      '<div class="card" style="max-width:680px">' +
        '<form id="detail-form">' +
          '<h2 style="margin-top:0">Metadata</h2>' +
          '<div class="form-group">' +
            '<label class="form-label" for="repo-label">Label</label>' +
            '<input type="text" id="repo-label" class="form-control" value="' + escapeHtml(repo.label || '') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Folder Names</label>' +
            '<div id="folder-list">' + buildFolderListHtml(folderNames) + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">' +
              '<input type="text" id="new-folder-input" class="form-control" placeholder="Add folder name\u2026" style="flex:1">' +
              '<button type="button" id="add-folder-btn" class="btn btn-secondary btn-sm">Add</button>' +
            '</div>' +
          '</div>' +
          '<h2 style="margin-top:24px">Strategic Vision</h2>' +
          '<div class="form-group">' +
            '<label class="form-label" for="vision-short">Short-term</label>' +
            '<textarea id="vision-short" class="form-control" rows="4" placeholder="Short-term goals and priorities\u2026">' + escapeHtml(vision.short_term || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="vision-mid">Mid-term</label>' +
            '<textarea id="vision-mid" class="form-control" rows="4" placeholder="Mid-term direction and milestones\u2026">' + escapeHtml(vision.mid_term || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="vision-long">Long-term</label>' +
            '<textarea id="vision-long" class="form-control" rows="4" placeholder="Long-term aspirations and vision\u2026">' + escapeHtml(vision.long_term || '') + '</textarea>' +
          '</div>' +
          '<div style="display:flex;gap:12px;align-items:center">' +
            '<button type="submit" class="btn btn-primary">Save Changes</button>' +
            '<a href="#/strategy" class="btn btn-secondary">Cancel</a>' +
          '</div>' +
          '<div id="detail-msg"></div>' +
        '</form>' +
      '</div>';

    wireRemoveButtons();

    /* ── Add folder button ─────────────────────────────────── */
    var addFolderBtn = document.getElementById('add-folder-btn');
    var newFolderInput = document.getElementById('new-folder-input');
    if (addFolderBtn && newFolderInput) {
      function doAddFolder() {
        var val = newFolderInput.value.trim();
        if (!val) return;
        /* Capture any in-flight edits before pushing */
        folderNames = collectFolderNamesFromDOM();
        folderNames.push(val);
        newFolderInput.value = '';
        rebuildFolderSection();
      }

      addFolderBtn.addEventListener('click', doAddFolder);
      newFolderInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doAddFolder();
        }
      });
    }

    /* ── Save form ─────────────────────────────────────────── */
    var form = document.getElementById('detail-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msgEl = document.getElementById('detail-msg');

      var currentFolderNames = collectFolderNamesFromDOM();
      if (!currentFolderNames.length) {
        showError(msgEl, 'At least one folder name is required.');
        return;
      }

      var payload = {
        label:        (document.getElementById('repo-label').value || '').trim() || repo.id,
        folder_names: currentFolderNames,
        vision: {
          short_term: (document.getElementById('vision-short').value || '').trim() || null,
          mid_term:   (document.getElementById('vision-mid').value   || '').trim() || null,
          long_term:  (document.getElementById('vision-long').value  || '').trim() || null,
        },
      };

      msgEl.innerHTML = '';
      API.updateRepo(repoId, payload)
        .then(function (updated) {
          msgEl.innerHTML = '<p class="success-banner">Changes saved.</p>';
          /* Refresh page header label if it changed */
          var h1 = app.querySelector('.page-header h1');
          if (h1) h1.textContent = updated.label || updated.id;
          var breadcrumb = app.querySelector('.breadcrumb');
          if (breadcrumb) {
            breadcrumb.innerHTML =
              '<a href="#/strategy">Strategy</a>' +
              ' &rsaquo; ' +
              escapeHtml(updated.label || updated.id);
          }
        })
        .catch(function (err) {
          showError(msgEl, 'Save failed: ' + (err.message || String(err)));
        });
    });
  }
}
