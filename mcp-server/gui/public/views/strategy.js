/* ============================================================
   views/strategy.js — Strategy view (Repository List)
   Section 4g of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, showLoading, showError,
               renderRepoModal

   Rendering model (renderStrategyList):
     The list view uses a partial-render pattern. The DOM is divided into
     independent areas:
       #strategy-tab-repos    — container for the Repositories tab content
       #strategy-toggle-area  — rebuilt on every render pass
       #strategy-table-area   — rebuilt on every render pass
       #strategy-tab-conflicts — container for the Conflicts tab content;
                                 only rendered in multi-store mode; refreshed
                                 independently by refreshConflicts().

   Interaction model (modal-trigger architecture):
     All repository creation and editing flows go through renderRepoModal(),
     which is opened by three entry points in the strategy list:
       Add Repository button (page header)
           → renderRepoModal('add', null, stores, refresh)
       Declared-repo label buttons (data-edit-repo, one per declared row)
           → API.getRepo(id) → renderRepoModal('edit', repo, stores, refresh)
       Register buttons (data-register-folder, undeclared rows only)
           → renderRepoModal('add', null, stores, refresh, sanitisedPrefill)
   ============================================================ */


/* ── renderStrategyList ──────────────────────────────────────
   Renders the repository list at #/strategy.
   Shows: label, folder names, vision status; Add Repository button.
   Includes a "Show undeclared repositories" checkbox that re-fetches
   with ?include_undeclared=true and renders undeclared entries with a
   muted visual style and a "Register" button.
   In multi-store mode (stores.length > 1), also renders:
     - A tab bar ("Repositories" | "Conflicts") above the content
     - A "Conflicts" tab listing cross-store registry conflicts with
       winner ("Active") / shadowed indicators and resolution actions.
   ─────────────────────────────────────────────────────────── */
function renderStrategyList(app) {
  showLoading(app);

  var currentStores = [];
  var storeLabels = {};
  var isMultiStore = false;
  var refreshSeq = 0;
  var currentRepoSort = 'label';
  var currentRepoDir = 'asc';

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

  function buildTableHtml(repos, isMultiStore) {
    if (!repos.length) {
      return '<p class="text-muted mt-16">No repositories declared yet. Use the Add Repository button to create one.</p>';
    }

    function thRepoSort(label, key) {
      var isActive = currentRepoSort === key;
      var cls = 'sortable' + (isActive ? ' sort-' + currentRepoDir : '');
      var ariaSort = isActive ? (currentRepoDir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th class="' + cls + '" data-repo-sort="' + key + '" aria-sort="' + ariaSort + '" tabindex="0" role="columnheader">' + label + '</th>';
    }

    var sorted = repos.slice().sort(function (a, b) {
      var aVal = currentRepoSort === 'id' ? (a.id || '').toLowerCase() : (a.label || a.id || '').toLowerCase();
      var bVal = currentRepoSort === 'id' ? (b.id || '').toLowerCase() : (b.label || b.id || '').toLowerCase();
      if (aVal < bVal) return currentRepoDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return currentRepoDir === 'asc' ? 1 : -1;
      return 0;
    });

    var rows = sorted.map(function (r) {
      var storeCell = isMultiStore ? '<td>' + escapeHtml(storeLabels[r.store_id] || r.store_id || '\u2014') + '</td>' : '';
      if (r.declared === false) {
        /* Undeclared (filesystem-discovered) entry — muted row with Register button */
        return (
          '<tr style="opacity:0.6">' +
            '<td>' +
              '<span class="text-muted" style="font-style:italic">' + escapeHtml(r.label || r.id) + '</span>' +
              ' <span class="badge badge-archived" style="font-size:10px;vertical-align:middle">Undeclared</span>' +
            '</td>' +
            '<td class="text-muted">' + escapeHtml(r.id) + '</td>' +
            storeCell +
            '<td>' +
              '<button type="button" class="btn btn-secondary btn-sm" data-register-folder="' + escapeHtml(r.id) + '"' + (r.store_id ? ' data-register-store="' + escapeHtml(r.store_id) + '"' : '') + '>Register</button>' +
            '</td>' +
          '</tr>'
        );
      }
      return (
        '<tr>' +
          '<td><button class="btn-link" data-edit-repo="' + escapeHtml(r.id) + '">' + escapeHtml(r.label || r.id) + '</button></td>' +
          '<td class="text-muted">' + escapeHtml(r.id) + '</td>' +
          storeCell +
          '<td>' + visionStatus(r) + '</td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<table class="data-table">' +
        '<thead><tr>' +
          thRepoSort('Label', 'label') +
          thRepoSort('ID', 'id') +
          (isMultiStore ? '<th>Store</th>' : '') +
          '<th>Vision</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>'
    );
  }

  function wireRepoSortHandlers() {
    var tableEl = document.getElementById('strategy-table-area');
    if (!tableEl) return;
    var thead = tableEl.querySelector('thead');
    if (!thead) return;
    function handleRepoSortAction(e) {
      var th = e.target.closest('th[data-repo-sort]');
      if (!th) return;
      var key = th.getAttribute('data-repo-sort');
      if (currentRepoSort === key) {
        currentRepoDir = currentRepoDir === 'asc' ? 'desc' : 'asc';
      } else {
        currentRepoSort = key;
        currentRepoDir = 'asc';
      }
      var cb = document.getElementById('show-undeclared-cb');
      var checked = !!(cb && cb.checked);
      refreshTable(checked);
    }
    thead.addEventListener('click', handleRepoSortAction);
    thead.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.key === ' ') e.preventDefault();
      handleRepoSortAction(e);
    });
  }

  /**
   * Re-renders only the repo table and toggle. Called on checkbox toggle.
   */
  function refreshTable(checked) {
    var seq = ++refreshSeq;
    var toggleEl = document.getElementById('strategy-toggle-area');
    var tableEl = document.getElementById('strategy-table-area');
    if (toggleEl) toggleEl.innerHTML = buildToggleHtml(checked);
    if (tableEl) tableEl.innerHTML = '<p class="text-muted" style="font-size:13px">Loading\u2026</p>';

    API.listRepos(checked).then(function (repos) {
      if (seq !== refreshSeq) return;
      if (tableEl) tableEl.innerHTML = buildTableHtml(repos, isMultiStore);
      wireTableButtons();
      wireToggle();
      wireRepoSortHandlers();
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

  /**
   * Wires click handlers for both interactive button types in the repo table.
   *   data-register-folder — undeclared rows: opens the add modal with a
   *     sanitiseSlug()-derived prefill (id, label, folder_names).
   *   data-edit-repo — declared rows: fetches the repo via API.getRepo() then
   *     opens the edit modal pre-filled with the repo's current values.
   * Must be called after every table re-render (renderList and refreshTable).
   */
  function wireTableButtons() {
    var tableEl = document.getElementById('strategy-table-area');
    if (!tableEl) return;
    tableEl.querySelectorAll('[data-register-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var folderName = btn.getAttribute('data-register-folder');
        var storeId = btn.getAttribute('data-register-store');
        var prefill = { id: sanitiseSlug(folderName), label: folderName, folder_names: [folderName] };
        if (storeId) prefill.store_id = storeId;
        renderRepoModal('add', null, currentStores, function () { renderStrategyList(app); }, prefill);
      });
    });
    tableEl.querySelectorAll('[data-edit-repo]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var repoId = btn.getAttribute('data-edit-repo');
        API.getRepo(repoId).then(function (repo) {
          renderRepoModal('edit', repo, currentStores, function () { renderStrategyList(app); });
        }).catch(function (err) {
          showError(tableEl, 'Failed to load repository: ' + (err.message || String(err)));
        });
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
    var conflictCount = conflicts.length;

    currentStores = stores;
    isMultiStore = stores.length > 1;

    /* Build a storeId → label map shared with buildTableHtml and the conflicts renderer. */
    storeLabels = {};
    stores.forEach(function (s) { storeLabels[s.id] = s.label; });

    /* Seed the in-memory index used by conflict action handlers. */
    storesSnapshot = stores;
    conflictsIndex = {};
    conflicts.forEach(function (c) { conflictsIndex[c.repo_name] = c; });

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
        '<button type="button" class="btn btn-primary" id="add-repo-btn">Add Repository</button>' +
      '</div>' +
      tabBar +
      '<div id="strategy-tab-repos">' +
        '<div id="strategy-toggle-area">' + buildToggleHtml(checked) + '</div>' +
        '<div id="strategy-table-area">' + buildTableHtml(repos, isMultiStore) + '</div>' +
      '</div>' +
      (isMultiStore
        ? '<div id="strategy-tab-conflicts" style="display:none">' +
            buildConflictsHtml(conflicts, storeLabels) +
          '</div>'
        : '');

    wireTableButtons();
    wireToggle();
    wireRepoSortHandlers();

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

    var addBtn = document.getElementById('add-repo-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        renderRepoModal('add', null, stores, function () { renderStrategyList(app); });
      });
    }
  }
}


/* ── renderRepoModal ─────────────────────────────────────────
   Opens an add/edit modal dialog for a repository entry.
   mode:    'add' | 'edit'
   repo:    { id, label, folder_names, store_id,
              vision?: { short_term, mid_term, long_term } }
            Pass null in add mode.
   stores:  Array of { id, label } from API.getStores().
            Pass [] in single-store mode (hides the Store dropdown).
   onSaved: callback invoked after a successful save
   prefill: (optional) { id, label, folder_names } to pre-populate add mode
   ─────────────────────────────────────────────────────────── */
function renderRepoModal(mode, repo, stores, onSaved, prefill) {
  var triggerElement = document.activeElement;
  var existing = document.getElementById('repo-modal-overlay');
  if (existing) existing.remove();

  var isAdd        = mode === 'add';
  var isMultiStore = stores && stores.length > 1;
  var title        = isAdd ? 'Add Repository' : 'Edit Repository';
  var saveTxt      = isAdd ? 'Add Repository' : 'Save';

  /* Working copy of folder names — mutated by add/remove actions. */
  var folderNames = isAdd
    ? (prefill && prefill.folder_names ? prefill.folder_names.slice() : [])
    : ((repo && repo.folder_names) ? repo.folder_names.slice() : []);

  /* ── Inner helpers ───────────────────────────────────────── */

  function buildModalFolderListHtml(names) {
    if (!names || !names.length) {
      return '<p class="text-muted" id="repo-modal-folder-empty">No folder names added yet.</p>';
    }
    return names.map(function (f, i) {
      return (
        '<div class="folder-entry" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<input type="text" class="form-control folder-name-input" data-folder-idx="' + i + '" value="' + escapeHtml(f) + '" style="flex:1">' +
          '<button type="button" class="btn btn-danger btn-sm" data-remove-folder="' + i + '">Remove</button>' +
        '</div>'
      );
    }).join('');
  }

  /* ── Field HTML ────────────────────────────────────────────── */

  var idField = isAdd
    ? '<div class="cs-modal-field-group">' +
        '<label class="form-label" for="repo-modal-id">ID <span class="text-muted">(slug)</span></label>' +
        '<input class="form-control" type="text" id="repo-modal-id" autocomplete="off" placeholder="e.g. my-project" value="' + escapeHtml((prefill && prefill.id) || '') + '">' +
        '<span class="cs-modal-field-error" id="repo-modal-id-err"></span>' +
      '</div>'
    : '<div class="cs-modal-field-group">' +
        '<label class="form-label">ID</label>' +
        '<div class="cs-modal-readonly"><code>' + escapeHtml(repo ? repo.id : '') + '</code></div>' +
      '</div>';

  var labelValEscaped = escapeHtml(isAdd ? ((prefill && prefill.label) || '') : (repo ? (repo.label || '') : ''));
  var labelField =
    '<div class="cs-modal-field-group">' +
      '<label class="form-label" for="repo-modal-label">Label</label>' +
      '<input class="form-control" type="text" id="repo-modal-label" autocomplete="off" value="' + labelValEscaped + '" placeholder="Display name">' +
    '</div>';

  var folderWidget =
    '<div class="cs-modal-field-group">' +
      '<label class="form-label">Folder Names</label>' +
      '<div id="repo-modal-folder-list">' + buildModalFolderListHtml(folderNames) + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;align-items:center">' +
        '<input type="text" id="repo-modal-new-folder" class="form-control" placeholder="Add folder name\u2026" style="flex:1">' +
        '<button type="button" id="repo-modal-add-folder-btn" class="btn btn-secondary btn-sm">Add</button>' +
      '</div>' +
      '<span class="cs-modal-field-error" id="repo-modal-folders-err"></span>' +
    '</div>';

  /* Vision textareas — edit mode only. */
  var vision = (repo && repo.vision) ? repo.vision : {};
  var visionFields = isAdd ? '' :
    '<div class="cs-modal-field-group">' +
      '<label class="form-label" for="repo-modal-vision-short">Short-term vision</label>' +
      '<textarea class="form-control" id="repo-modal-vision-short" rows="3" placeholder="Short-term goals and priorities\u2026">' + escapeHtml(vision.short_term || '') + '</textarea>' +
    '</div>' +
    '<div class="cs-modal-field-group">' +
      '<label class="form-label" for="repo-modal-vision-mid">Mid-term vision</label>' +
      '<textarea class="form-control" id="repo-modal-vision-mid" rows="3" placeholder="Mid-term direction and milestones\u2026">' + escapeHtml(vision.mid_term || '') + '</textarea>' +
    '</div>' +
    '<div class="cs-modal-field-group">' +
      '<label class="form-label" for="repo-modal-vision-long">Long-term vision</label>' +
      '<textarea class="form-control" id="repo-modal-vision-long" rows="3" placeholder="Long-term aspirations and vision\u2026">' + escapeHtml(vision.long_term || '') + '</textarea>' +
    '</div>';

  /* Store dropdown — multi-store only. */
  var storeField = isMultiStore
    ? '<div class="cs-modal-field-group">' +
        '<label class="form-label" for="repo-modal-store">Store</label>' +
        '<select class="form-control" id="repo-modal-store">' +
          stores.map(function (s) {
            var preselectedId = isAdd ? (prefill && prefill.store_id) : (repo && repo.store_id);
            var selected = (preselectedId === s.id) ? ' selected' : '';
            return '<option value="' + escapeHtml(s.id) + '"' + selected + '>' + escapeHtml(s.label || s.id) + '</option>';
          }).join('') +
        '</select>' +
      '</div>'
    : '';

  /* ── Modal HTML ────────────────────────────────────────────── */

  var modalHtml =
    '<div class="cs-modal-overlay" id="repo-modal-overlay" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '<div class="cs-modal" id="repo-modal">' +
        '<div class="cs-modal-header">' +
          '<span class="cs-modal-title">' + title + '</span>' +
          '<button class="cs-modal-close" id="repo-modal-close-btn" aria-label="Close">\u00d7</button>' +
        '</div>' +
        '<div class="cs-modal-body">' +
          idField +
          labelField +
          folderWidget +
          visionFields +
          storeField +
          '<div id="repo-modal-error"></div>' +
        '</div>' +
        '<div class="cs-modal-footer">' +
          '<button class="btn btn-primary" id="repo-modal-save-btn">' + saveTxt + '</button>' +
          '<button class="btn btn-secondary" id="repo-modal-cancel-btn">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var overlay = openModal(modalHtml, triggerElement);
  var modal   = overlay.querySelector('#repo-modal');

  /* ── Delegate modal lifecycle to shared utility ───────────── */

  wireModalEvents(overlay, {
    excludeTextarea: true,
    onSubmit: handleSave,
    onClose: function () { closeModal(overlay); }
  });

  /* ── Folder add/remove widget ─────────────────────────────── */

  function collectModalFolderNames() {
    var result = [];
    modal.querySelectorAll('.folder-name-input').forEach(function (inp) {
      var val = inp.value.trim();
      if (val) result.push(val);
    });
    return result;
  }

  function wireRemoveFolderButtons() {
    var container = document.getElementById('repo-modal-folder-list');
    if (!container) return;
    container.querySelectorAll('[data-remove-folder]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        /* Capture user edits to existing inputs before rebuilding the list. */
        folderNames = collectModalFolderNames();
        var idx = parseInt(btn.getAttribute('data-remove-folder'), 10);
        folderNames.splice(idx, 1);
        rebuildFolderSection();
      });
    });
  }

  function rebuildFolderSection() {
    var container = document.getElementById('repo-modal-folder-list');
    if (container) {
      container.innerHTML = buildModalFolderListHtml(folderNames);
      wireRemoveFolderButtons();
    }
  }

  wireRemoveFolderButtons();

  var addFolderBtn   = document.getElementById('repo-modal-add-folder-btn');
  var newFolderInput = document.getElementById('repo-modal-new-folder');
  if (addFolderBtn && newFolderInput) {
    var doAddFolder = function () {
      var val = newFolderInput.value.trim();
      if (!val) return;
      /* Capture user edits to existing inputs before appending the new entry. */
      folderNames = collectModalFolderNames();
      folderNames.push(val);
      newFolderInput.value = '';
      rebuildFolderSection();
    };
    addFolderBtn.addEventListener('click', doAddFolder);
    /* Stop propagation so the modal-level Enter handler does not also fire. */
    newFolderInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        doAddFolder();
      }
    });
  }

  /* ── Save handler ─────────────────────────────────────────── */

  function handleSave() {
    modal.querySelectorAll('.cs-modal-field-error').forEach(function (el) { el.textContent = ''; });
    var modalErr = document.getElementById('repo-modal-error');
    if (modalErr) modalErr.innerHTML = '';

    var valid = true;
    function showFieldErr(fieldId, msg) {
      var el = document.getElementById(fieldId);
      if (el) el.textContent = msg;
      if (msg) valid = false;
    }

    var currentFolders = collectModalFolderNames();

    if (isAdd) {
      var idInputEl = document.getElementById('repo-modal-id');
      if (!idInputEl || !idInputEl.value.trim()) {
        showFieldErr('repo-modal-id-err', 'ID is required.');
      }
    }

    if (!currentFolders.length) {
      showFieldErr('repo-modal-folders-err', 'At least one folder name is required.');
    }

    if (!valid) return;

    var saveBtn = document.getElementById('repo-modal-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }

    var labelEl    = document.getElementById('repo-modal-label');
    var storeEl    = document.getElementById('repo-modal-store');
    var labelValue = labelEl ? labelEl.value.trim() : '';

    if (isAdd) {
      var newId   = document.getElementById('repo-modal-id').value.trim();
      var payload = {
        id:           newId,
        label:        labelValue || newId,
        folder_names: currentFolders,
      };
      if (storeEl && storeEl.value) payload.store_id = storeEl.value;

      API.createRepo(payload)
        .then(function () {
          closeModal(overlay);
          if (typeof onSaved === 'function') onSaved();
        })
        .catch(function (err) {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveTxt; }
          if (modalErr) showError(modalErr, 'Failed to create repository: ' + (err.message || String(err)));
        });
      return;
    }

    /* Edit mode: update first, then move if the store changed. */
    var repoId        = repo ? repo.id : '';
    var originalStore = repo ? repo.store_id : null;
    var selectedStore = storeEl ? storeEl.value : null;
    var storeChanged  = isMultiStore && selectedStore && selectedStore !== originalStore;

    var shortEl = document.getElementById('repo-modal-vision-short');
    var midEl   = document.getElementById('repo-modal-vision-mid');
    var longEl  = document.getElementById('repo-modal-vision-long');

    var updatePayload = {
      label:        labelValue || repoId,
      folder_names: currentFolders,
      vision: {
        short_term: (shortEl ? shortEl.value.trim() : '') || null,
        mid_term:   (midEl   ? midEl.value.trim()   : '') || null,
        long_term:  (longEl  ? longEl.value.trim()  : '') || null,
      },
    };

    API.updateRepo(repoId, updatePayload)
      .then(function () {
        if (!storeChanged) {
          closeModal(overlay);
          if (typeof onSaved === 'function') onSaved();
          return;
        }
        return API.moveRepo(repoId, selectedStore)
          .then(function () {
            closeModal(overlay);
            if (typeof onSaved === 'function') onSaved();
          });
      })
      .catch(function (err) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveTxt; }
        if (modalErr) showError(modalErr, 'Save failed: ' + (err.message || String(err)));
      });
  }

  document.getElementById('repo-modal-save-btn').addEventListener('click', handleSave);

  /* Auto-focus first editable field. */
  var focusTarget = isAdd
    ? document.getElementById('repo-modal-id')
    : document.getElementById('repo-modal-label');
  if (focusTarget) focusTarget.focus();
}
