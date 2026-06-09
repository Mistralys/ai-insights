/* ============================================================
   views/strategy.js — Strategy view (Repository List + Detail/Editor)
   Section 4g of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, showLoading, showError

   Rendering model (renderStrategyList):
     The list view uses a partial-render pattern to preserve Add Repository
     form state across toggle interactions. The DOM is divided into three
     independent areas:
       #strategy-toggle-area  — rebuilt on every render pass
       #strategy-table-area   — rebuilt on every render pass
       #add-repo-form (card)  — written once at initial render; never touched
                                by refreshTable(), so in-flight field values
                                and validation messages are preserved when the
                                user toggles the "Show undeclared repositories"
                                checkbox.
   ============================================================ */


/* ── renderStrategyList ──────────────────────────────────────
   Renders the repository list at #/strategy.
   Shows: label, folder names, vision status; Add Repository form.
   Includes a "Show undeclared repositories" checkbox that re-fetches
   with ?include_undeclared=true and renders undeclared entries with a
   muted visual style and a "Register" button that pre-fills the form.
   ─────────────────────────────────────────────────────────── */
function renderStrategyList(app) {
  showLoading(app);

  API.listRepos(false).then(function (repos) {
    renderList(repos, false);
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
      var folderNames = (r.folder_names || []).map(escapeHtml).join(', ') || '<em class="text-muted">—</em>';
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

  function renderList(repos, checked) {
    app.innerHTML =
      '<div class="page-header">' +
        '<h1>Strategy</h1>' +
        '<p class="text-muted">Manage repository declarations and strategic vision.</p>' +
      '</div>' +
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
          '<button type="submit" class="btn btn-primary">Add Repository</button>' +
          '<div id="add-repo-msg"></div>' +
        '</form>' +
      '</div>';

    wireRegisterButtons();
    wireToggle();

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

      if (!id) {
        showError(msgEl, 'ID is required.');
        return;
      }

      if (!folderNames.length) {
        showError(msgEl, 'At least one folder name is required.');
        return;
      }

      msgEl.innerHTML = '';
      API.createRepo({ id: id, label: label || id, folder_names: folderNames })
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
