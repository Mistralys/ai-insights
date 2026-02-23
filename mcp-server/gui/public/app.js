/* ============================================================
   MCP Server Dashboard — app.js
   Plain JavaScript SPA (no ES modules, no frameworks)
   ============================================================ */

/* ----------------------------------------------------------
   1. API Client
   ---------------------------------------------------------- */
var API = (function () {
  async function request(method, path, body) {
    var opts = {
      method: method,
      headers: {},
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch('/api' + path, opts);
    if (!res.ok) {
      var errData = null;
      try { errData = await res.json(); } catch (_) {}
      var errMsg = (errData && errData.error && errData.error.message) || ('HTTP ' + res.status);
      var errCode = (errData && errData.error && errData.error.code) || 'ERROR';
      throw { code: errCode, message: errMsg };
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    getProjects:              function ()             { return request('GET',    '/projects'); },
    getProject:               function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug)); },
    getWorkPackages:          function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/work-packages'); },
    getWorkPackage:           function (slug, wpId)   { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/work-packages/' + encodeURIComponent(wpId)); },
    deleteProject:            function (slug)         { return request('DELETE', '/projects/' + encodeURIComponent(slug)); },
    getConfig:                function ()             { return request('GET',    '/config'); },
    updateConfig:             function (data)         { return request('PUT',    '/config', data); },
  };
})();

/* ----------------------------------------------------------
   2. Router
   ---------------------------------------------------------- */
var Router = (function () {
  var _activeInterval = null;

  function clearPolling() {
    if (_activeInterval !== null) {
      clearInterval(_activeInterval);
      _activeInterval = null;
    }
  }

  function setPolling(intervalFn, delayMs) {
    clearPolling();
    _activeInterval = setInterval(intervalFn, delayMs);
  }

  function dispatch(hash) {
    clearPolling();
    var path = (hash || '').replace(/^#/, '') || '/';
    var app = document.getElementById('app');
    if (!app) return;

    if (path === '/' || path === '') {
      renderProjectList(app);
      return;
    }

    var projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      renderProjectDetail(app, decodeURIComponent(projectMatch[1]));
      return;
    }

    var wpMatch = path.match(/^\/projects\/([^/]+)\/wp\/([^/]+)$/);
    if (wpMatch) {
      renderWorkPackageDetail(app, decodeURIComponent(wpMatch[1]), decodeURIComponent(wpMatch[2]));
      return;
    }

    if (path === '/config') {
      renderConfig(app);
      return;
    }

    app.innerHTML = '<p class="error-banner">Page not found: ' + escapeHtml(path) + '</p>';
  }

  function navigate(hash) {
    window.location.hash = hash;
  }

  function init() {
    window.addEventListener('hashchange', function () {
      dispatch(window.location.hash);
    });
    dispatch(window.location.hash);
  }

  return {
    navigate: navigate,
    init: init,
    _setPolling: setPolling,
    _clearPolling: clearPolling,
  };
})();

/* ----------------------------------------------------------
   3. Utilities
   ---------------------------------------------------------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return escapeHtml(isoString);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes());

    var now = new Date();
    // Strip times for day-boundary comparisons
    var today    = new Date(now.getFullYear(),    now.getMonth(),    now.getDate());
    var itemDay  = new Date(d.getFullYear(),      d.getMonth(),      d.getDate());
    var diffDays = Math.round((today - itemDay) / 86400000);

    if (diffDays === 0) return 'Today, ' + timeStr;
    if (diffDays === 1) return 'Yesterday, ' + timeStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (diffDays < 7)  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ', ' + timeStr;

    // Older: show short date like "12 Feb 2026, 16:41"
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + timeStr;
  } catch (_) {
    return escapeHtml(isoString);
  }
}

function statusBadge(status) {
  if (!status) return '';
  var cls = 'badge badge-' + status.toLowerCase().replace(/_/g, '-');
  return '<span class="' + cls + '">' + escapeHtml(status) + '</span>';
}

function showLoading(container) {
  container.innerHTML = '<div class="loading">Loading…</div>';
}

function showError(container, message) {
  container.innerHTML = '<div class="error-banner">' + escapeHtml(message) + '</div>';
}

/* ----------------------------------------------------------
   4a. View: Project List
   ---------------------------------------------------------- */
function renderProjectList(app) {
  showLoading(app);

  var allProjects = [];
  var filterValue = 'ALL';

  function applyFilter() {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr[data-status]');
    rows.forEach(function (row) {
      var show = filterValue === 'ALL' || row.getAttribute('data-status') === filterValue;
      row.style.display = show ? '' : 'none';
    });
  }

  function buildTable(projects) {
    if (!projects.length) {
      return '<p class="text-muted mt-16">No projects found.</p>';
    }
    var sorted = projects.slice().sort(function (a, b) {
      var ta = a.last_updated ? new Date(a.last_updated).getTime() : 0;
      var tb = b.last_updated ? new Date(b.last_updated).getTime() : 0;
      return tb - ta;
    });
    var rows = sorted.map(function (p) {
      var deleteBtn = p.status === 'COMPLETE'
        ? '<button class="btn btn-danger btn-sm" data-action="delete" data-slug="' + escapeHtml(p.slug) + '">Delete</button>'
        : '';
      return '<tr data-status="' + escapeHtml(p.status) + '">' +
        '<td><a href="#/projects/' + encodeURIComponent(p.slug) + '">' + escapeHtml(p.slug) + '</a></td>' +
        '<td>' + statusBadge(p.status) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.date_created)) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.last_updated)) + '</td>' +
        '<td>' +
          '<a href="#/projects/' + encodeURIComponent(p.slug) + '" class="btn btn-secondary btn-sm">View</a> ' +
          deleteBtn +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrapper">' +
      '<table>' +
      '<thead><tr>' +
        '<th>Project Slug</th>' +
        '<th>Status</th>' +
        '<th>Created</th>' +
        '<th>Updated</th>' +
        '<th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="projects-tbody">' + rows + '</tbody>' +
      '</table>' +
      '</div>';
  }

  function render(projects) {
    allProjects = projects;
    app.innerHTML =
      '<div class="page-header">' +
        '<h1>Projects</h1>' +
        '<div class="filter-actions">' +
          '<button class="btn btn-secondary btn-sm" id="refresh-btn">↻ Refresh</button>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<label for="status-filter">Filter by status:</label>' +
        '<select id="status-filter">' +
          '<option value="ALL">All</option>' +
          '<option value="READY">Ready</option>' +
          '<option value="IN_PROGRESS">In Progress</option>' +
          '<option value="COMPLETE">Complete</option>' +
          '<option value="BLOCKED">Blocked</option>' +
        '</select>' +
      '</div>' +
      buildTable(projects);

    // Restore filter value after re-render
    var filterEl = document.getElementById('status-filter');
    if (filterEl) {
      filterEl.value = filterValue;
      applyFilter();
      filterEl.addEventListener('change', function () {
        filterValue = this.value;
        applyFilter();
      });
    }

    // Delete button handlers
    app.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = this.getAttribute('data-slug');
        if (!confirm('Permanently delete project "' + slug + '"? This cannot be undone.')) return;
        API.deleteProject(slug).then(function () {
          load();
        }).catch(function (err) {
          alert('Delete failed: ' + (err.message || String(err)));
        });
      });
    });

    // Manual refresh
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', load);
    }
  }

  function load() {
    API.getProjects().then(function (projects) {
      render(projects);
    }).catch(function (err) {
      showError(app, 'Failed to load projects: ' + (err.message || String(err)));
    });
  }

  // Initial load
  load();

  // Auto-refresh every 10 seconds
  Router._setPolling(load, 10000);
}

/* ----------------------------------------------------------
   4b. View: Project Detail
   ---------------------------------------------------------- */
function renderProjectDetail(app, slug) {
  showLoading(app);

  API.getProject(slug).then(function (project) {
    var meta = project.meta || {};
    var wps = project.work_packages || [];

    var wpRows = wps.map(function (wp) {
      return '<tr class="clickable" data-href="#/projects/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' +
        '<td class="monospace"><a href="#/projects/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' + escapeHtml(wp.work_package_id) + '</a></td>' +
        '<td>' + escapeHtml(wp.work_package_id) + '</td>' +
        '<td>' + escapeHtml(wp.assigned_to || '—') + '</td>' +
        '<td>' + statusBadge(wp.status) + '</td>' +
      '</tr>';
    }).join('');

    app.innerHTML =
      '<p class="breadcrumb"><a href="#/">Projects</a> / ' + escapeHtml(slug) + '</p>' +
      '<div class="page-header">' +
        '<h1>' + escapeHtml(slug) + '</h1>' +
        statusBadge(meta.status) +
      '</div>' +
      '<div class="card">' +
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Plan path:</strong> <span class="monospace">' + escapeHtml(meta.plan_path || '—') + '</span><br>' +
          '<strong>Created:</strong> ' + escapeHtml(formatDate(meta.date_created)) + ' &nbsp; ' +
          '<strong>Updated:</strong> ' + escapeHtml(formatDate(meta.last_updated)) +
        '</div>' +
      '</div>' +
      '<div class="card-title">Work Packages</div>' +
      (wps.length
        ? '<div class="table-wrapper"><table>' +
            '<thead><tr><th>WP ID</th><th>Title</th><th>Assigned To</th><th>Status</th></tr></thead>' +
            '<tbody>' + wpRows + '</tbody>' +
          '</table></div>'
        : '<p class="text-muted">No work packages.</p>');

    // Clickable rows
    app.querySelectorAll('tr.clickable').forEach(function (row) {
      row.addEventListener('click', function () {
        var href = this.getAttribute('data-href');
        if (href) window.location.hash = href;
      });
    });
  }).catch(function (err) {
    showError(app, 'Failed to load project: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   4c. View: Work Package Detail
   ---------------------------------------------------------- */
function renderWorkPackageDetail(app, slug, wpId) {
  showLoading(app);

  API.getWorkPackage(slug, wpId).then(function (wp) {
    // Acceptance criteria
    var acHtml = (wp.acceptance_criteria || []).map(function (ac) {
      var met = ac.met === true;
      return '<li>' +
        '<span class="ac-icon ' + (met ? 'ac-met' : 'ac-unmet') + '">' + (met ? '✓' : '○') + '</span>' +
        '<span>' + escapeHtml(ac.criterion) + '</span>' +
      '</li>';
    }).join('');

    // Pipelines
    var pipelinesHtml = (wp.pipelines || []).reverse().map(function (p) {
      var cls = (p.status || '').toLowerCase().replace(/ /g, '_');
      var summaryItems = (p.summary || []).map(function (s) {
        return '<li>' + escapeHtml(s) + '</li>';
      }).join('');
      var commentsHtml = (p.comments || []).map(function (c) {
        return '<div><strong>' + escapeHtml(c.type) + '</strong> [' + escapeHtml(c.priority) + ']: ' + escapeHtml(c.note) + '</div>';
      }).join('');

      return '<div class="pipeline-item ' + cls + '">' +
        '<div class="pipeline-header">' +
          escapeHtml(p.type.toUpperCase()) + ' — ' + statusBadge(p.status) +
        '</div>' +
        '<div class="pipeline-meta">' +
          'Started: ' + escapeHtml(formatDate(p.started_at)) +
          (p.completed_at ? ' &nbsp; Completed: ' + escapeHtml(formatDate(p.completed_at)) : '') +
        '</div>' +
        (summaryItems ? '<div class="pipeline-summary"><ul>' + summaryItems + '</ul></div>' : '') +
        (commentsHtml ? '<div class="pipeline-comments mt-8">' + commentsHtml + '</div>' : '') +
      '</div>';
    }).join('');

    // Handoff notes
    var handoffNotes = (wp.pipelines || []).reduce(function (acc, p) {
      return acc.concat(p.handoff_notes || []);
    }, []);
    var handoffHtml = handoffNotes.length
      ? '<div class="card"><div class="card-title">Handoff Notes</div><ul class="pipeline-summary">' +
          handoffNotes.map(function (n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') +
        '</ul></div>'
      : '';

    app.innerHTML =
      '<p class="breadcrumb">' +
        '<a href="#/">Projects</a> / ' +
        '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / ' +
        escapeHtml(wpId) +
      '</p>' +
      '<div class="page-header">' +
        '<h1>' + escapeHtml(wpId) + '</h1>' +
        statusBadge(wp.status) +
      '</div>' +
      '<div class="card">' +
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Assigned to:</strong> ' + escapeHtml(wp.assigned_to || '—') + ' &nbsp; ' +
          '<strong>Dependencies:</strong> ' + escapeHtml((wp.dependencies || []).join(', ') || 'none') +
        '</div>' +
      '</div>' +
      (acHtml
        ? '<div class="card"><div class="card-title">Acceptance Criteria</div>' +
            '<ul class="ac-list">' + acHtml + '</ul>' +
          '</div>'
        : '') +
      (pipelinesHtml
        ? '<div class="card"><div class="card-title">Pipelines</div>' + pipelinesHtml + '</div>'
        : '') +
      handoffHtml;
  }).catch(function (err) {
    showError(app, 'Failed to load work package: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   4d. View: Configuration
   ---------------------------------------------------------- */
function renderConfig(app) {
  showLoading(app);

  API.getConfig().then(function (config) {
    app.innerHTML =
      '<div class="page-header"><h1>Configuration</h1></div>' +
      '<div class="card" style="max-width:560px">' +
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
            '<label class="form-label" for="ledger-root">Ledger root path</label>' +
            '<input type="text" id="ledger-root" class="form-control" readonly value="' + escapeHtml(config.ledger_root || '') + '">' +
            '<p class="form-note">Read-only. Changing this requires restarting the server with <code>--ledger-dir</code>.</p>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary">Save</button>' +
          '<div id="config-msg"></div>' +
        '</form>' +
      '</div>';

    var form = document.getElementById('config-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var autoHandoff = document.getElementById('auto-handoff').checked;
        var maxDepth = parseInt(document.getElementById('max-depth').value, 10);
        if (isNaN(maxDepth) || maxDepth < 1) {
          document.getElementById('config-msg').innerHTML = '<p class="error-banner">Max handoff depth must be a positive integer.</p>';
          return;
        }
        // ledger_root intentionally omitted (read-only)
        API.updateConfig({ auto_handoff_enabled: autoHandoff, max_handoff_depth: maxDepth })
          .then(function () {
            document.getElementById('config-msg').innerHTML = '<p class="success-banner">Configuration saved.</p>';
          })
          .catch(function (err) {
            document.getElementById('config-msg').innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
          });
      });
    }
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   5. Bootstrap
   ---------------------------------------------------------- */
Router.init();
