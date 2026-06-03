/* ============================================================
   views/project-list.js — Project List view
   Section 4a of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, formatDate, statusBadge,
               showLoading, showError
   ============================================================ */

function renderProjectList(app) {
  showLoading(app);

  var SORT_KEY_STORAGE = 'mcp-sort-key';
  var SORT_DIR_STORAGE = 'mcp-sort-dir';
  var PAGE_LIMIT_STORAGE = 'mcp-page-limit';
  var STATUS_STORAGE = 'mcp-status-filter';
  var RUNNER_STORAGE = 'mcp-runner-filter';

  // --- Pagination / filter state (localStorage-persisted where noted) ---
  var currentPage = 1;
  var pageLimit = (function () {
    var v = parseInt(localStorage.getItem(PAGE_LIMIT_STORAGE), 10);
    return (!isNaN(v) && (v === 25 || v === 50 || v === 100)) ? v : 50;
  }());
  var currentStatus = localStorage.getItem(STATUS_STORAGE) || 'ACTIVE';
  var currentRunner = localStorage.getItem(RUNNER_STORAGE) || '';
  var currentSearch = '';
  var currentSort = localStorage.getItem(SORT_KEY_STORAGE) || 'last_updated';
  var currentDir = localStorage.getItem(SORT_DIR_STORAGE) || 'desc';

  var lastTotalPages = 1;
  var searchDebounceTimer = null;

  // ── Action menu (kebab dropdown) state ──
  var openMenuWrapper = null;

  // Create or reuse the shared menu portal (appended once to <body>)
  var menuPortal = (function () {
    var el = document.getElementById('action-menu-portal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'action-menu-portal';
      el.className = 'action-menu';
      el.setAttribute('role', 'menu');
      document.body.appendChild(el);
    }
    return el;
  }());

  function closeOpenMenu() {
    menuPortal.style.display = 'none';
    menuPortal.innerHTML = '';
    if (openMenuWrapper) {
      var trigger = openMenuWrapper.querySelector('.action-menu-btn');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      openMenuWrapper = null;
    }
  }

  // ── Runner display helpers ──

  var RUNNER_LABELS = {
    'vscode':       'VS Code',
    'claude-code':  'Claude Code',
    'orchestrator': 'Orchestrator',
    'unknown':      'Unknown',
  };

  function runnerLabel(runner) {
    return RUNNER_LABELS[runner] || (runner ? runner : '—');
  }

  function runnerBadge(runner) {
    var safeRunner = runner && runner !== 'unknown' ? runner : 'unknown';
    var label = RUNNER_LABELS[safeRunner] || (runner ? runner : 'Unknown');
    return '<span class="badge badge-runner badge-runner-' + escapeHtml(safeRunner) + '">' + escapeHtml(label) + '</span>';
  }

  // ── Build runner filter dropdown options ──
  // Only includes runner values that have at least one project (from runner_counts).
  // Preserves a canonical display order; runners not in runner_counts are omitted.
  // If currentRunner is set to a value absent from runner_counts (stale state),
  // it is included as a zero-count entry so the user can see and clear it.

  function buildRunnerOptions(runnerCounts) {
    var counts = runnerCounts || {};

    // Canonical ordering for display (determines option order in dropdown)
    var RUNNER_ORDER = ['orchestrator', 'vscode', 'claude-code', 'unknown'];

    // Collect runner values that have at least one project, in canonical order
    var activeRunners = RUNNER_ORDER.filter(function (r) {
      return counts[r] !== undefined && counts[r] > 0;
    });

    // Also include any non-canonical runner values that have projects
    Object.keys(counts).forEach(function (r) {
      if (counts[r] > 0 && RUNNER_ORDER.indexOf(r) === -1) {
        activeRunners.push(r);
      }
    });

    // If the current selection is stale (no longer in runner_counts), keep it
    // visible so the user can see and clear the filter, even with zero count.
    if (currentRunner && counts[currentRunner] === undefined) {
      activeRunners.push(currentRunner);
    }

    // Build <option> elements: "All" first, then one per active runner
    var allSel = currentRunner === '' ? ' selected' : '';
    var html = '<option value=""' + allSel + '>All</option>';

    activeRunners.forEach(function (r) {
      var label = RUNNER_LABELS[r] || r;
      var cnt = counts[r] !== undefined ? ' (' + counts[r] + ')' : '';
      var sel = r === currentRunner ? ' selected' : '';
      html += '<option value="' + escapeHtml(r) + '"' + sel + '>' + escapeHtml(label + cnt) + '</option>';
    });

    return html;
  }

  // ── Build table HTML (projects already sorted/filtered server-side) ──

  function buildTable(projects) {
    if (!projects.length) {
      return '<p class="text-muted mt-16">No projects found.</p>';
    }

    function thSort(label, key) {
      var isActive = currentSort === key;
      var cls = 'sortable' + (isActive ? ' sort-' + currentDir : '');
      var ariaSort = isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th class="' + cls + '" data-sort="' + key + '" aria-sort="' + ariaSort + '" tabindex="0" role="columnheader">' + label + '</th>';
    }

    var rows = projects.map(function (p) {
      var projectName = (p.project_name != null && p.project_name !== '') ? escapeHtml(p.project_name) : escapeHtml(p.slug);
      if (p.repository_name) {
        ProjectNameCache.set(makeProjectCacheKey(p.repository_name, p.slug), p.project_name || p.slug);
      }
      var doneCellHtml;
      if (p.total_work_packages > 0) {
        var pct = p.progress_pct != null ? p.progress_pct : 0;
        doneCellHtml = '<div class="progress-bar-track" title="' + pct + '%"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>';
      } else {
        doneCellHtml = '\u2014';
      }
      var wpCount = p.total_work_packages != null ? String(p.total_work_packages) : '\u2014';
      var repo = p.repository_name;
      var nameCell;
      if (repo) {
        nameCell = '<td><a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(p.slug) + '" title="' + escapeHtml(p.slug) + '">' + projectName + '</a></td>';
      } else {
        console.warn('[project-list] project "' + p.slug + '" has no repository_name — rendering as read-only row');
        nameCell = '<td title="' + escapeHtml(p.slug) + '">' + projectName + '</td>';
      }
      return '<tr data-status="' + escapeHtml(p.status) + '" data-slug="' + escapeHtml(p.slug) + '">' +
        nameCell +
        '<td class="repo-col">' + escapeHtml(repo || '\u2014') + '</td>' +
        '<td class="num-col">' + wpCount + '</td>' +
        '<td>' + doneCellHtml + '</td>' +
        '<td>' + statusBadge(p.status) + '</td>' +
        '<td>' + runnerBadge(p.runner) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.date_created)) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.last_updated)) + '</td>' +
        '<td>' +
          '<div class="action-menu-wrapper" data-slug="' + escapeHtml(p.slug) + '" data-repo="' + escapeHtml(repo || '') + '" data-status="' + escapeHtml(p.status) + '">' +
            '<button class="action-menu-btn" aria-haspopup="menu" aria-expanded="false" title="Actions">&#8942;</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrapper">' +
      '<table>' +
      '<thead><tr>' +
        thSort('Project', 'project') +
        thSort('Repository', 'repository') +
        thSort('WPs', 'total_work_packages') +
        thSort('% Done', 'done') +
        thSort('Status', 'status') +
        thSort('Runner', 'runner') +
        thSort('Created', 'date_created') +
        thSort('Updated', 'last_updated') +
        '<th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="projects-tbody">' + rows + '</tbody>' +
      '</table>' +
      '</div>';
  }

  // ── Build pagination controls ──

  function buildPagination(page, total_pages, total, limit) {
    var start = total === 0 ? 0 : Math.min((page - 1) * limit + 1, total);
    var end = Math.min(page * limit, total);
    var infoText = 'Showing ' + start + '\u2013' + end + ' of ' + total + ' project' + (total !== 1 ? 's' : '');
    var pageSizeSel =
      '<select id="page-size-sel" class="page-size-selector">' +
        '<option value="25"' + (limit === 25 ? ' selected' : '') + '>25</option>' +
        '<option value="50"' + (limit === 50 ? ' selected' : '') + '>50</option>' +
        '<option value="100"' + (limit === 100 ? ' selected' : '') + '>100</option>' +
      '</select>';

    var paginationBtns = '';
    if (total_pages > 1) {
      var buttons = [];
      buttons.push('<button class="pagination-btn" data-page="prev"' + (page === 1 ? ' disabled' : '') + '>\u2190 Prev</button>');

      // Show window of page numbers around current with ellipsis
      var windowSize = 2;
      var pagesSet = {};
      pagesSet[1] = true;
      pagesSet[total_pages] = true;
      for (var i = Math.max(1, page - windowSize); i <= Math.min(total_pages, page + windowSize); i++) {
        pagesSet[i] = true;
      }
      var pageArray = Object.keys(pagesSet).map(Number).sort(function (a, b) { return a - b; });
      var lastShown = 0;
      pageArray.forEach(function (pg) {
        if (lastShown > 0 && pg > lastShown + 1) {
          buttons.push('<span class="pagination-ellipsis">\u2026</span>');
        }
        buttons.push(
          '<button class="pagination-btn' + (pg === page ? ' active' : '') + '" data-page="' + pg + '">' + pg + '</button>'
        );
        lastShown = pg;
      });
      buttons.push('<button class="pagination-btn" data-page="next"' + (page === total_pages ? ' disabled' : '') + '>Next \u2192</button>');
      paginationBtns = '<div class="pagination">' + buttons.join('') + '</div>';
    }

    return '<div class="pagination-row">' +
      '<div class="pagination-info">' + infoText + '</div>' +
      paginationBtns +
      '<div class="page-size-row">Per page: ' + pageSizeSel + '</div>' +
      '</div>';
  }

  // ── Build status filter dropdown with counts ──

  function buildStatusOptions(statusCounts) {
    var opts = [
      { value: 'ACTIVE',      label: 'Active' },
      { value: 'ALL',         label: 'All' },
      { value: 'READY',       label: 'Ready' },
      { value: 'IN_PROGRESS', label: 'In Progress' },
      { value: 'COMPLETE',    label: 'Complete' },
      { value: 'BLOCKED',     label: 'Blocked' },
      { value: 'ARCHIVED',    label: 'Archived' },
    ];
    return opts.map(function (o) {
      var cnt = (o.value !== 'ACTIVE' && o.value !== 'ALL' && statusCounts && statusCounts[o.value] !== undefined)
        ? ' (' + statusCounts[o.value] + ')'
        : '';
      var sel = o.value === currentStatus ? ' selected' : '';
      return '<option value="' + o.value + '"' + sel + '>' + escapeHtml(o.label + cnt) + '</option>';
    }).join('');
  }

  // ── Main render ──

  function render(envelope) {
    lastTotalPages = envelope.total_pages;
    var projects = envelope.projects;
    var statusCounts = envelope.status_counts || {};
    var runnerCounts = envelope.runner_counts || {};

    // Preserve search input focus state across DOM rebuild
    var searchHadFocus = false;
    var searchSelStart = 0;
    var searchSelEnd = 0;
    var prevSearchEl = document.getElementById('project-search');
    if (prevSearchEl && document.activeElement === prevSearchEl) {
      searchHadFocus = true;
      searchSelStart = prevSearchEl.selectionStart || 0;
      searchSelEnd = prevSearchEl.selectionEnd || 0;
    }

    app.innerHTML =
      '<div class="page-header">' +
        '<h1>Projects</h1>' +
        '<div class="filter-actions">' +
          '<button class="btn btn-secondary btn-sm" id="refresh-btn">\u21bb Refresh</button>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<input type="text" id="project-search" placeholder="Search projects\u2026" value="' + escapeHtml(currentSearch) + '">' +
        '<label for="status-filter">Status:</label>' +
        '<select id="status-filter">' + buildStatusOptions(statusCounts) + '</select>' +
        '<label for="runner-filter">Runner:</label>' +
        '<select id="runner-filter">' + buildRunnerOptions(runnerCounts) + '</select>' +
      '</div>' +
      buildTable(projects) +
      buildPagination(envelope.page, envelope.total_pages, envelope.total, envelope.limit);

    // Any previously open menu is now invalid (DOM was recreated)
    openMenuWrapper = null;

    // Sort column headers
    var projectsTbody = document.getElementById('projects-tbody');
    var thead = projectsTbody
      ? projectsTbody.closest('table').querySelector('thead')
      : null;
    if (thead) {
      function handleSortAction(e) {
        var th = e.target.closest('th[data-sort]');
        if (!th) return;
        var key = th.getAttribute('data-sort');
        if (currentSort === key) {
          currentDir = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = key;
          currentDir = (key === 'date_created' || key === 'last_updated') ? 'desc' : 'asc';
        }
        localStorage.setItem(SORT_KEY_STORAGE, currentSort);
        localStorage.setItem(SORT_DIR_STORAGE, currentDir);
        currentPage = 1;
        load();
      }
      thead.addEventListener('click', handleSortAction);
      thead.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.key === ' ') e.preventDefault();
        handleSortAction(e);
      });
    }

    // Status filter
    var filterEl = document.getElementById('status-filter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        currentStatus = this.value;
        localStorage.setItem(STATUS_STORAGE, currentStatus);
        currentPage = 1;
        load();
      });
    }

    // Runner filter
    var runnerFilterEl = document.getElementById('runner-filter');
    if (runnerFilterEl) {
      runnerFilterEl.addEventListener('change', function () {
        currentRunner = this.value;
        localStorage.setItem(RUNNER_STORAGE, currentRunner);
        currentPage = 1;
        load();
      });
    }

    // Search with 300ms debounce
    var searchEl = document.getElementById('project-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var val = this.value;
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          currentSearch = val;
          currentPage = 1;
          load();
        }, 300);
      });

      // Restore focus and cursor position if search was active before re-render
      if (searchHadFocus) {
        searchEl.focus();
        searchEl.setSelectionRange(searchSelStart, searchSelEnd);
      }
    }

    // Pagination buttons
    app.querySelectorAll('.pagination-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        var p = this.getAttribute('data-page');
        if (p === 'prev') {
          currentPage = Math.max(1, currentPage - 1);
        } else if (p === 'next') {
          currentPage = Math.min(lastTotalPages, currentPage + 1);
        } else {
          currentPage = parseInt(p, 10);
        }
        load();
      });
    });

    // Page size selector
    var pageSizeSel = document.getElementById('page-size-sel');
    if (pageSizeSel) {
      pageSizeSel.addEventListener('change', function () {
        pageLimit = parseInt(this.value, 10);
        localStorage.setItem(PAGE_LIMIT_STORAGE, String(pageLimit));
        currentPage = 1;
        load();
      });
    }

    // Kebab (⋮) trigger handlers — populate and position the body portal
    app.querySelectorAll('.action-menu-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wrapper = btn.closest('.action-menu-wrapper');
        if (!wrapper) return;
        if (openMenuWrapper && openMenuWrapper === wrapper) {
          closeOpenMenu();
          return;
        }
        if (openMenuWrapper) closeOpenMenu();

        var slug = wrapper.getAttribute('data-slug');
        var repo = wrapper.getAttribute('data-repo');
        var status = wrapper.getAttribute('data-status');
        var viewHtml = repo
          ? '<a class="action-menu-item" role="menuitem" href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '">View</a>'
          : '';
        var archiveHtml = status !== 'ARCHIVED'
          ? '<button class="action-menu-item" role="menuitem" data-portal-action="archive" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Archive</button>'
          : '';
        var unarchiveHtml = status === 'ARCHIVED'
          ? '<button class="action-menu-item" role="menuitem" data-portal-action="unarchive" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Unarchive</button>'
          : '';

        menuPortal.innerHTML =
          viewHtml +
          archiveHtml +
          unarchiveHtml +
          '<button class="action-menu-item danger" role="menuitem" data-portal-action="delete" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Delete</button>';

        menuPortal.style.display = 'block';
        var btnRect = btn.getBoundingClientRect();
        var menuH = menuPortal.offsetHeight;
        if (window.innerHeight - btnRect.bottom < menuH + 4) {
          menuPortal.style.top = (btnRect.top - menuH - 4) + 'px';
        } else {
          menuPortal.style.top = (btnRect.bottom + 4) + 'px';
        }
        menuPortal.style.right = (window.innerWidth - btnRect.right) + 'px';
        menuPortal.style.left = 'auto';

        btn.setAttribute('aria-expanded', 'true');
        openMenuWrapper = wrapper;
      });
    });

    // Close-on-outside-click (registered once per session)
    if (!document._projectListDocHandlerInstalled) {
      document._projectListDocHandlerInstalled = true;
      document.addEventListener('mousedown', function (e) {
        if (!e.target.closest('.action-menu-wrapper') && !e.target.closest('#action-menu-portal')) {
          closeOpenMenu();
        }
      });
    }

    // Close-on-scroll (registered to the table wrapper each render)
    var tableWrapper = app.querySelector('.table-wrapper');
    if (tableWrapper) {
      tableWrapper.addEventListener('scroll', function () {
        closeOpenMenu();
      });
    }

    // Portal action handler (delete / archive / unarchive) — registered once
    if (!menuPortal._handlerInstalled) {
      menuPortal._handlerInstalled = true;
      menuPortal.addEventListener('click', function (e) {
        var item = e.target.closest('[data-portal-action]');
        if (!item) return;
        var action = item.getAttribute('data-portal-action');
        var slug = item.getAttribute('data-slug');
        var repo = item.getAttribute('data-repo');
        closeOpenMenu();
        if (!repo) {
          // Null-repo projects should not reach action handlers (no View link, action buttons
          // still render for archive/delete). Log silently rather than disrupting the operator.
          console.error('[project-list] action "' + action + '" skipped: project "' + slug + '" has no repository_name.');
          return;
        }
        if (action === 'delete') {
          if (!confirm('Permanently delete project "' + slug + '"? This cannot be undone.')) return;
          API.deleteProject(repo, slug).then(function () { currentPage = 1; load(); })
            .catch(function (err) { alert('Delete failed: ' + (err.message || String(err))); });
        } else if (action === 'archive') {
          if (!confirm('Archive project "' + slug + '"? It will be hidden from the active list but remain accessible.')) return;
          API.archiveProject(repo, slug).then(function () { load(); })
            .catch(function (err) { alert('Archive failed: ' + (err.message || String(err))); });
        } else if (action === 'unarchive') {
          API.unarchiveProject(repo, slug).then(function () { load(); })
            .catch(function (err) { alert('Unarchive failed: ' + (err.message || String(err))); });
        }
      });
    }

    // Manual refresh
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        currentPage = 1;
        load();
      });
    }
  }

  function load() {
    API.getProjects({
      page: currentPage,
      limit: pageLimit,
      status: currentStatus,
      search: currentSearch,
      sort: currentSort,
      dir: currentDir,
      runner: currentRunner || undefined,
    }).then(function (envelope) {
      render(envelope);
    }).catch(function (err) {
      showError(app, 'Failed to load projects: ' + (err.message || String(err)));
    });
  }

  // Initial load
  load();

  // Auto-refresh every 10 seconds — current page only
  Router._setPolling(load, 10000);
}
