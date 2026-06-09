/* ============================================================
   views/knowledge.js — Knowledge view
   Section 4f of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, formatDate, showLoading, showError, UI (components.js)
   ============================================================ */

function renderKnowledge(app) {
  showLoading(app);

  /* ── Confidence bucket thresholds ────────────────────────── */
  var CONFIDENCE_HIGH_MIN   = 68;   /* 68–100 → High  */
  var CONFIDENCE_MEDIUM_MIN = 34;   /* 34–67  → Medium */
  /* 0–33 → Low */

  /* ── View state ──────────────────────────────────────────── */
  var allInsights        = [];
  var activeTab          = 'global';   /* 'global' | 'repository' */
  var filterCategory     = '';
  var filterRepository   = '';
  var filterQuery        = '';
  var editingId       = null;       /* numeric id of card in edit mode */
  var confirmDeleteId = null;       /* numeric id of card in delete-confirm mode */
  var movingId        = null;       /* numeric id of card in move mode */

  /* ── formatConfidence ────────────────────────────────────── */
  function formatConfidence(value) {
    var pct = Math.round(value * 100);
    var label;
    if (pct >= CONFIDENCE_HIGH_MIN) {
      label = 'High';
    } else if (pct >= CONFIDENCE_MEDIUM_MIN) {
      label = 'Medium';
    } else {
      label = 'Low';
    }
    return pct + '% (' + label + ')';
  }

  /* ── applyFilters ────────────────────────────────────────── */
  function applyFilters() {
    var scopeValue = activeTab === 'global' ? 'global' : 'repository';
    return allInsights.filter(function (ins) {
      if (ins.scope !== scopeValue) return false;
      if (filterCategory && ins.category !== filterCategory) return false;
      if (activeTab === 'repository' && filterRepository && ins.repository_name !== filterRepository) return false;
      if (filterQuery) {
        var q = filterQuery.toLowerCase();
        var titleMatch    = ins.title   && ins.title.toLowerCase().indexOf(q) !== -1;
        var contentMatch  = ins.content && ins.content.toLowerCase().indexOf(q) !== -1;
        var tagsMatch     = ins.tags    && ins.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
        if (!titleMatch && !contentMatch && !tagsMatch) return false;
      }
      return true;
    });
  }

  /* ── getDistinctValues ───────────────────────────────────── */
  /* Returns { categories: string[], repositories: string[] } — both arrays are
     sorted alphabetically and contain only distinct non-empty values from
     the provided insights array. */
  function getDistinctValues(insights) {
    var categories   = [];
    var repositories = [];
    insights.forEach(function (ins) {
      if (ins.category        && categories.indexOf(ins.category)               === -1) categories.push(ins.category);
      if (ins.repository_name && repositories.indexOf(ins.repository_name)      === -1) repositories.push(ins.repository_name);
    });
    categories.sort();
    repositories.sort();
    return { categories: categories, repositories: repositories };
  }

  /* ── buildKnFilters ─── returns { html, bind } for the filter bar ── */
  function buildKnFilters(categories, repositories) {
    var catOptions = [{ value: '', label: 'All categories' }].concat(
      categories.map(function (c) {
        return { value: c, label: c, selected: filterCategory === c };
      })
    );

    var filters = [];

    if (activeTab === 'repository') {
      var repoOptions = [{ value: '', label: 'All repositories' }].concat(
        repositories.map(function (r) {
          return { value: r, label: r, selected: filterRepository === r };
        })
      );
      filters.push({ type: 'select', id: 'kn-repository', label: 'Repository:', options: repoOptions, cssClass: 'form-control' });
    }

    filters.push({ type: 'select', id: 'kn-category', label: 'Category:', options: catOptions, cssClass: 'form-control' });
    filters.push({ type: 'text', id: 'kn-query', label: 'Search:', placeholder: 'Title, content or tag…', value: filterQuery, cssClass: 'form-control' });

    return UI.filterBar('kn-filter-bar', filters);
  }

  /* ── buildKnowledgeHtml ──────────────────────────────────── */
  function buildKnowledgeHtml(insights) {
    if (!insights.length) {
      return UI.emptyState('No knowledge entries found.');
    }

    return insights.map(function (ins) {
      var id          = ins.id;
      var isGlobal    = ins.scope === 'global';
      var isEditing   = editingId === id;
      var isConfirm   = confirmDeleteId === id;
      var isMoving    = movingId === id;

      /* ── Scope badge ── */
      var scopeBadgeClass = isGlobal ? 'badge badge-scope-global' : 'badge badge-scope-repository';
      var scopeLabel      = isGlobal ? 'Global' : 'Repository';

      /* ── Tags ── */
      var tagsHtml = '';
      if (ins.tags && ins.tags.length) {
        tagsHtml = ins.tags.map(function (t) {
          return '<span class="tag-chip">' + escapeHtml(t) + '</span>';
        }).join(' ');
      }

      /* ── Content preview ── */
      var preview = ins.content ? ins.content.slice(0, 200) + (ins.content.length > 200 ? '…' : '') : '';

      /* ── Superseded-by notice ── */
      var supersededHtml = ins.superseded_by != null
        ? '<p class="text-muted" style="font-size:12px">Superseded by KN-' + ins.superseded_by + '</p>'
        : '';

      /* ── Inline edit form ── */
      if (isEditing) {
        var tagsValue = ins.tags ? ins.tags.join(', ') : '';
        var confPct   = formatConfidence(ins.confidence != null ? ins.confidence : 0);
        return UI.card(null,
          '<form id="kn-edit-form-' + id + '">' +
            '<div class="form-group">' +
              '<label class="form-label">Title</label>' +
              '<input id="kn-edit-title-' + id + '" class="form-control" type="text" value="' + escapeHtml(ins.title || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Content</label>' +
              '<textarea id="kn-edit-content-' + id + '" class="form-control" rows="6">' + escapeHtml(ins.content || '') + '</textarea>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Category</label>' +
              '<input id="kn-edit-category-' + id + '" class="form-control" type="text" value="' + escapeHtml(ins.category || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Tags (comma-separated)</label>' +
              '<input id="kn-edit-tags-' + id + '" class="form-control" type="text" value="' + escapeHtml(tagsValue) + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Confidence: <span id="kn-conf-label-' + id + '">' + escapeHtml(confPct) + '</span></label>' +
              '<input id="kn-edit-conf-' + id + '" class="form-control" type="range" min="0" max="1" step="0.01" value="' + (ins.confidence != null ? ins.confidence : 0) + '">' +
            '</div>' +
            '<div class="knowledge-actions">' +
              '<button type="submit" class="btn btn-primary btn-sm">Save</button>' +
              '<button type="button" class="btn btn-sm" data-action="cancel-edit" data-id="' + id + '">Cancel</button>' +
            '</div>' +
            '<div id="kn-edit-msg-' + id + '"></div>' +
          '</form>',
          { dataId: id }
        );
      }

      /* ── Action buttons ── */
      var deleteHtml;
      if (isConfirm) {
        deleteHtml =
          '<span>Delete this entry?</span>' +
          '<button class="btn btn-danger btn-sm" data-action="confirm-delete" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Confirm</button>' +
          '<button class="btn btn-sm" data-action="cancel-delete" data-id="' + id + '">Cancel</button>';
      } else {
        deleteHtml = '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + id + '">Delete</button>';
      }

      var promoteHtml = !isGlobal
        ? '<button class="btn btn-sm" data-action="promote" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Promote to Global</button>'
        : '';

      var moveHtml;
      if (isMoving) {
        moveHtml =
          '<span class="knowledge-move-input">' +
            '<input id="kn-move-repo-' + id + '" class="form-control" type="text" placeholder="target-repository-name">' +
            '<button class="btn btn-primary btn-sm" data-action="confirm-move" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Confirm</button>' +
            '<button class="btn btn-sm" data-action="cancel-move" data-id="' + id + '">Cancel</button>' +
          '</span>';
      } else {
        moveHtml = '<button class="btn btn-sm" data-action="move" data-id="' + id + '">Move to Repository</button>';
      }

      /* origin_plan link: three cases —
           1. No origin_plan → empty string (omit the element entirely).
           2. origin_plan present AND repository_name present → namespaced anchor
              (#/projects/{repo}/{slug}) so the router scopes the view correctly.
           3. origin_plan present but repository_name null (global insights or
              shallow storage path) → plain <span> fallback, no broken link. */
      var originPlanHtml = ins.origin_plan
        ? (ins.repository_name
            ? '<a href="#/projects/' + encodeURIComponent(ins.repository_name) + '/' + encodeURIComponent(ins.origin_plan) + '" style="font-size:12px">Origin: ' + escapeHtml(ins.origin_plan) + '</a>'
            : '<span style="font-size:12px">Origin: ' + escapeHtml(ins.origin_plan) + '</span>')
        : '';

      return UI.card(null,
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
          '<span class="' + scopeBadgeClass + '">' + scopeLabel + '</span>' +
          (ins.category ? '<span class="category-pill">' + escapeHtml(ins.category) + '</span>' : '') +
          (ins.repository_name ? '<span class="text-muted" style="font-size:12px">' + escapeHtml(ins.repository_name) + '</span>' : '') +
          (originPlanHtml ? originPlanHtml : '') +
        '</div>' +
        '<h3 style="margin:0 0 6px 0;font-size:15px">' + escapeHtml(ins.title || '(no title)') + '</h3>' +
        (tagsHtml ? '<div style="margin-bottom:6px">' + tagsHtml + '</div>' : '') +
        (preview ? '<p style="margin:0 0 6px 0;color:var(--color-text-muted);font-size:13px">' + escapeHtml(preview) + '</p>' : '') +
        '<div style="display:flex;align-items:center;gap:16px;font-size:12px;color:var(--color-text-muted);margin-bottom:4px">' +
          '<span class="confidence-label">Confidence: ' + escapeHtml(ins.confidence != null ? formatConfidence(ins.confidence) : '—') + '</span>' +
          (ins.source ? '<span>Source: ' + escapeHtml(ins.source) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:8px">' +
          'Created: ' + escapeHtml(formatDate(ins.created_at)) +
          ' &nbsp;·&nbsp; Updated: ' + escapeHtml(formatDate(ins.updated_at)) +
        '</div>' +
        supersededHtml +
        '<div class="knowledge-actions">' +
          '<button class="btn btn-sm" data-action="edit" data-id="' + id + '">Edit</button>' +
          deleteHtml +
          promoteHtml +
          moveHtml +
        '</div>',
        { dataId: id }
      );
    }).join('');
  }

  /* ── render ──────────────────────────────────────────────── */
  function render(insights) {
    allInsights = insights;

    var vals         = getDistinctValues(insights);
    var categories   = vals.categories;
    var repositories = vals.repositories;

    var filtered = applyFilters();
    var fb = buildKnFilters(categories, repositories);

    app.innerHTML =
      '<div class="page-header"><h1>Knowledge</h1></div>' +
      '<div class="knowledge-tabs">' +
        '<button class="knowledge-tab' + (activeTab === 'global' ? ' active' : '') + '" data-tab="global">Global</button>' +
        '<button class="knowledge-tab' + (activeTab === 'repository' ? ' active' : '') + '" data-tab="repository">Repository</button>' +
      '</div>' +
      fb.html +
      '<div id="knowledge-list">' + buildKnowledgeHtml(filtered) + '</div>';

    wireEvents(fb);
    wireRangeSliders();
  }

  /* ── renderFilterBar ─── rebuild the filter bar only ─────────
   *
   * Rebuilds #kn-filter-bar and re-wires its event handlers.
   * Called when activeTab changes because only then does the bar layout
   * change (repository dropdown appears / disappears).
   * NOT called on every keystroke or card action — that was the root
   * cause of the focus-theft issue resolved here.
   */
  function renderFilterBar() {
    var vals = getDistinctValues(allInsights);
    var fb = buildKnFilters(vals.categories, vals.repositories);
    var filterBarEl = document.getElementById('kn-filter-bar');
    if (filterBarEl) {
      filterBarEl.outerHTML = fb.html;
      fb.bind(function (state) {
        if ('kn-category'   in state) filterCategory   = state['kn-category'];
        if ('kn-repository' in state) filterRepository = state['kn-repository'];
        if ('kn-query'      in state) filterQuery      = state['kn-query'];
        renderList();
      });
    }
  }

  /* ── renderList ─── partial re-render of card list only ────────
   *
   * Rebuilds #knowledge-list with the current filtered card set.
   * Does NOT touch the filter bar. Call renderFilterBar() explicitly
   * when activeTab changes and the bar layout needs to change.
   */
  function renderList() {
    var filtered = applyFilters();
    var listEl = document.getElementById('knowledge-list');
    if (listEl) {
      listEl.innerHTML = buildKnowledgeHtml(filtered);
    }
    wireRangeSliders();
  }

  /* ── wireRangeSliders ─── live confidence label updates ─────── */
  function wireRangeSliders() {
    var inputs = document.querySelectorAll('input[type="range"][id^="kn-edit-conf-"]');
    inputs.forEach(function (input) {
      var idStr = input.id.replace('kn-edit-conf-', '');
      input.addEventListener('input', function () {
        var labelEl = document.getElementById('kn-conf-label-' + idStr);
        if (labelEl) labelEl.textContent = formatConfidence(parseFloat(this.value));
      });
    });
  }

  /* ── wireEvents ──────────────────────────────────────────── */
  function wireEvents(fb) {
    /* Tab bar */
    var tabButtons = document.querySelectorAll('.knowledge-tab');
    tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newTab = this.getAttribute('data-tab');
        if (newTab === activeTab) return;
        activeTab          = newTab;
        filterCategory     = '';
        filterRepository   = '';
        filterQuery        = '';
        editingId       = null;
        confirmDeleteId = null;
        movingId        = null;

        /* Update active class */
        tabButtons.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-tab') === activeTab);
        });

        /* Tab change alters the filter bar layout (repository dropdown appears/
           disappears), so rebuild the bar first, then re-render the card list. */
        renderFilterBar();
        renderList();
      });
    });

    /* Wire filter bar */
    fb.bind(function (state) {
      if ('kn-category'   in state) filterCategory   = state['kn-category'];
      if ('kn-repository' in state) filterRepository = state['kn-repository'];
      if ('kn-query'      in state) filterQuery      = state['kn-query'];
      renderList();
    });

    /* Event delegation for card actions */
    var listEl = document.getElementById('knowledge-list');
    if (!listEl) return;

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.getAttribute('data-action');
      var rawId  = btn.getAttribute('data-id');
      var id     = parseInt(rawId, 10);

      if (action === 'edit') {
        editingId       = id;
        confirmDeleteId = null;
        movingId        = null;
        renderList();
        return;
      }

      if (action === 'cancel-edit') {
        editingId = null;
        renderList();
        return;
      }

      if (action === 'delete') {
        confirmDeleteId = id;
        editingId       = null;
        movingId        = null;
        renderList();
        return;
      }

      if (action === 'cancel-delete') {
        confirmDeleteId = null;
        renderList();
        return;
      }

      if (action === 'move') {
        movingId        = id;
        editingId       = null;
        confirmDeleteId = null;
        renderList();
        return;
      }

      if (action === 'cancel-move') {
        movingId = null;
        renderList();
        return;
      }

      /* ── Confirm delete ── */
      if (action === 'confirm-delete') {
        var delScope = btn.getAttribute('data-scope');
        var delRepo  = btn.getAttribute('data-repository') || null;
        API.deleteKnowledge(id, delScope, delRepo).then(function () {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          confirmDeleteId = null;
          renderList();
        }).catch(function (err) {
          showError(app, 'Delete failed: ' + (err.message || String(err)));
        });
        return;
      }

      /* ── Promote to Global ── */
      if (action === 'promote') {
        var promScope = btn.getAttribute('data-scope');
        var promRepo  = btn.getAttribute('data-repository') || null;
        API.promoteKnowledge(id, promScope, promRepo).then(function (newInsight) {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          allInsights.push(newInsight);
          renderList();
        }).catch(function (err) {
          showError(app, 'Promote failed: ' + (err.message || String(err)));
        });
        return;
      }

      /* ── Confirm move ── */
      if (action === 'confirm-move') {
        var moveScope      = btn.getAttribute('data-scope');
        var moveRepo       = btn.getAttribute('data-repository') || null;
        var targetInput    = document.getElementById('kn-move-repo-' + id);
        var targetRepoName = targetInput ? targetInput.value.trim() : '';
        if (!targetRepoName) return;
        API.moveKnowledge(id, moveScope, moveRepo, targetRepoName).then(function (newInsight) {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          allInsights.push(newInsight);
          movingId = null;
          renderList();
        }).catch(function (err) {
          showError(app, 'Move failed: ' + (err.message || String(err)));
        });
        return;
      }
    });

    /* Edit form submit — uses event delegation on the list container */
    listEl.addEventListener('submit', function (e) {
      var form = e.target.closest('form[id^="kn-edit-form-"]');
      if (!form) return;
      e.preventDefault();

      var formId = form.id.replace('kn-edit-form-', '');
      var eid    = parseInt(formId, 10);

      /* Find insight to get scope/repository_name */
      var original = allInsights.find(function (ins) { return ins.id === eid; });
      if (!original) return;

      var titleEl    = document.getElementById('kn-edit-title-'   + eid);
      var contentEl  = document.getElementById('kn-edit-content-' + eid);
      var categoryEl = document.getElementById('kn-edit-category-'+ eid);
      var tagsEl     = document.getElementById('kn-edit-tags-'    + eid);
      var confEl     = document.getElementById('kn-edit-conf-'    + eid);
      var msgEl      = document.getElementById('kn-edit-msg-'     + eid);

      var rawTags = tagsEl ? tagsEl.value : '';
      var tags    = rawTags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);

      var updateData = {
        title:      titleEl    ? titleEl.value    : original.title,
        content:    contentEl  ? contentEl.value  : original.content,
        category:   categoryEl ? categoryEl.value : original.category,
        tags:       tags,
        confidence: confEl     ? parseFloat(confEl.value) : original.confidence,
      };

      API.updateKnowledge(eid, original.scope, original.repository_name || null, updateData)
        .then(function (updated) {
          allInsights = allInsights.map(function (ins) {
            return ins.id === eid ? updated : ins;
          });
          editingId = null;
          renderList();
        })
        .catch(function (err) {
          /* Intentional: inline error preserves form state so the user does not lose
             edits on a transient save failure. All destructive actions (delete/promote/move)
             use showError(app, ...) because they navigate away or remove the card. */
          if (msgEl) showError(msgEl, 'Save failed: ' + (err.message || String(err)));
        });
    });
  }

  /* ── load ────────────────────────────────────────────────── */
  function load() {
    API.getKnowledge({}).then(function (data) {
      render(Array.isArray(data) ? data : (data && data.insights ? data.insights : []));
    }).catch(function (err) {
      showError(app, 'Failed to load knowledge: ' + (err.message || String(err)));
    });
  }

  load();
  /* No polling — knowledge is human-curated and changes rarely */
}
