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
    getInsights:              function ()             { return request('GET',    '/insights'); },
    getPlanDocument:          function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/plan'); },
    getSynthesisDocument:     function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/synthesis'); },
    analyzeProjectReset:      function (slug)         { return request('POST',   '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: true }); },
    applyProjectReset:        function (slug, decisions) { return request('POST', '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: false, decisions: decisions }); },
    getProjectHealth:         function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/health'); },
    renameProject:            function (slug, title)  { return request('PATCH',  '/projects/' + encodeURIComponent(slug), { title: title }); },
    renameSlug:               function (slug, newSlug) { return request('PATCH',  '/projects/' + encodeURIComponent(slug), { slug: newSlug }); },
  };
})();

/* ----------------------------------------------------------
   2. Theme
   ---------------------------------------------------------- */
var Theme = (function () {
  var STORAGE_KEY = 'mcp-theme';
  var _toggleBtn = null;

  function _apply(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (_toggleBtn) {
      _toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      _toggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function init() {
    _toggleBtn = document.getElementById('theme-toggle');
    var saved = localStorage.getItem(STORAGE_KEY);
    // Default to dark if no preference is stored
    var theme = (saved === 'light') ? 'light' : 'dark';
    _apply(theme);
    if (_toggleBtn) {
      _toggleBtn.addEventListener('click', toggle);
    }
  }

  function toggle() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = (current === 'dark') ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    _apply(next);
  }

  return { init: init, toggle: toggle };
})();

/* ----------------------------------------------------------
   3. Router
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

  function updateNavActive(path) {
    var navLinks = document.querySelectorAll('header nav a');
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var linkPath = href.replace(/^#/, '') || '/';
      link.classList.toggle('active', linkPath === path || (path === '' && linkPath === '/'));
    });
  }

  function dispatch(hash) {
    clearPolling();
    var path = (hash || '').replace(/^#/, '') || '/';
    var app = document.getElementById('app');
    if (!app) return;

    updateNavActive(path);

    if (path === '/' || path === '') {
      renderProjectList(app);
      return;
    }

    var planMatch = path.match(/^\/projects\/([^/]+)\/plan$/);
    if (planMatch) {
      renderPlan(app, decodeURIComponent(planMatch[1]));
      return;
    }

    var synthesisMatch = path.match(/^\/projects\/([^/]+)\/synthesis$/);
    if (synthesisMatch) {
      renderSynthesis(app, decodeURIComponent(synthesisMatch[1]));
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

    if (path === '/insights') {
      renderInsights(app);
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
   4. Utilities
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
  var searchValue = '';

  function applyFilter() {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr[data-status]');
    rows.forEach(function (row) {
      var statusMatch = filterValue === 'ALL' || row.getAttribute('data-status') === filterValue;
      var textMatch = true;
      if (searchValue !== '') {
        var rowSlug = (row.getAttribute('data-slug') || '').toLowerCase();
        var rowName = (row.getAttribute('data-name') || '').toLowerCase();
        var rowRepo = (row.getAttribute('data-repo') || '').toLowerCase();
        textMatch = rowSlug.indexOf(searchValue) !== -1 || rowName.indexOf(searchValue) !== -1 || rowRepo.indexOf(searchValue) !== -1;
      }
      row.style.display = (statusMatch && textMatch) ? '' : 'none';
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
      var projectName = (p.project_name != null && p.project_name !== '') ? escapeHtml(p.project_name) : escapeHtml(p.slug);
      var doneCellHtml;
      if (p.total_work_packages > 0) {
        var pct = Math.round(((p.total_work_packages - p.pending_work_packages) / p.total_work_packages) * 100);
        doneCellHtml = '<div class="progress-bar-track" title="' + pct + '%"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>';
      } else {
        doneCellHtml = '\u2014';
      }
      return '<tr data-status="' + escapeHtml(p.status) + '" data-slug="' + escapeHtml(p.slug) + '" data-name="' + escapeHtml(p.project_name || '') + '" data-repo="' + escapeHtml(p.repository_name || '') + '">' +
        '<td><a href="#/projects/' + encodeURIComponent(p.slug) + '" title="' + escapeHtml(p.slug) + '">' + projectName + '</a></td>' +
        '<td class="repo-col">' + escapeHtml(p.repository_name || '\u2014') + '</td>' +
        '<td>' + doneCellHtml + '</td>' +
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
        '<th>Project</th>' +
        '<th>Repository</th>' +
        '<th>% Done</th>' +
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
        '<input type="text" id="project-search" placeholder="Search projects\u2026">' +
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

    // Restore search value after re-render
    var searchEl = document.getElementById('project-search');
    if (searchEl) {
      searchEl.value = searchValue;
      searchEl.addEventListener('input', function () {
        searchValue = this.value.toLowerCase().trim();
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
   4b. View: Plan Document
   ---------------------------------------------------------- */
function extractSynopsis(markdown) {
  var match = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
  return match ? match[1].trim() : null;
}

async function renderPlan(app, slug) {
  app.innerHTML = '<p class="loading">Loading plan\u2026</p>';
  try {
    var result = await API.getPlanDocument(slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
      '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Plan</div>' +
      '<div class="plan-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
        '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Plan</div>' +
        '<p class="empty-state">Plan document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load plan document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4b-ii. View: Synthesis Document
   ---------------------------------------------------------- */
async function renderSynthesis(app, slug) {
  app.innerHTML = '<p class="loading">Loading synthesis\u2026</p>';
  try {
    var result = await API.getSynthesisDocument(slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
      '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Synthesis</div>' +
      '<div class="synthesis-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        '<div class="breadcrumb"><a href="#/projects">Projects</a> / ' +
        '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / Synthesis</div>' +
        '<p class="empty-state">Synthesis document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4c. View: Project Detail
   ---------------------------------------------------------- */
function renderProjectDetail(app, slug) {
  showLoading(app);

  Promise.all([
    API.getProject(slug),
    API.getPlanDocument(slug).catch(function () { return null; }),
  ]).then(function (results) {
    var project = results[0];
    var planResult = results[1];
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

    // Sort project comments newest-first
    var comments = (project.project_comments || []).slice().sort(function (a, b) {
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    var commentCards = comments.length
      ? comments.map(function (c) {
          var priorityClass = c.priority ? ' priority-' + c.priority : '';
          var contextHtml = '';
          if (c.context && typeof c.context === 'object') {
            var ctxItems = Object.entries(c.context).map(function (pair) {
              return '<span><strong>' + escapeHtml(pair[0]) + ':</strong> ' + escapeHtml(String(pair[1])) + '</span>';
            }).join('<br>');
            contextHtml =
              '<div style="margin-top:8px;padding:8px 10px;background:var(--color-bg);border-radius:var(--radius);font-size:12px;line-height:1.6">' +
                ctxItems +
              '</div>';
          }
          return '<div class="comment-card' + priorityClass + '">' +
            '<div class="comment-meta">' +
              escapeHtml(c.agent || '—') +
              ' <span class="comment-type">' + escapeHtml(c.type || '') + '</span>' +
              ' <span>' + escapeHtml(formatDate(c.timestamp)) + '</span>' +
            '</div>' +
            '<div style="margin-top:6px">' + escapeHtml(c.note || '') + '</div>' +
            contextHtml +
          '</div>';
        }).join('')
      : '<p class="text-muted">No comments yet.</p>';

    var displayTitle = (meta.title && meta.title.trim()) ? meta.title : slug;
    app.innerHTML =
      '<p class="breadcrumb"><a href="#/">Projects</a> / <span id="breadcrumb-title">' + escapeHtml(displayTitle) + '</span></p>' +
      '<div class="page-header">' +
        '<div class="page-heading-wrapper">' +
          '<h1 id="project-title-heading">' + escapeHtml(displayTitle) + '</h1>' +
          '<button class="edit-title-btn" id="edit-title-btn" title="Rename project">\u270e</button>' +
        '</div>' +
        statusBadge(meta.status) +
        '<span id="health-badge" class="health-badge">Checking\u2026</span>' +
        '<button class="btn btn-secondary btn-sm" id="reset-project-btn">Reset Project</button>' +
      '</div>' +
      '<div class="card">' +
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Slug:</strong> <span class="monospace" id="project-slug-value">' + escapeHtml(slug) + '</span>' +
          '<button class="edit-slug-btn" id="edit-slug-btn" title="Rename slug">✎</button><br>' +
          '<strong>Plan path:</strong> <span class="monospace">' + escapeHtml(meta.plan_path || '—') + '</span><br>' +
          '<strong>Created:</strong> ' + escapeHtml(formatDate(meta.date_created)) + ' &nbsp; ' +
          '<strong>Updated:</strong> ' + escapeHtml(formatDate(meta.last_updated)) +
        '</div>' +
      '</div>' +

      (function () {
        var synopsisHtml = '';
        if (planResult && planResult.content) {
          var synopsis = extractSynopsis(planResult.content);
          if (synopsis) {
            synopsisHtml =
              '<div class="plan-synopsis">' +
              '<div class="plan-synopsis__content">' + marked.parse(synopsis) + '</div>' +
              '<a href="#/projects/' + encodeURIComponent(slug) + '/plan" class="plan-synopsis__link">View full plan \u2192</a>' +
              '</div>';
          }
        }
        return synopsisHtml;
      })() +

      (function () {
        if (!project.synthesis_generated) return '';
        return '<div class="synthesis-link-row">' +
          '<a href="#/projects/' + encodeURIComponent(slug) + '/synthesis" class="synthesis-link">View synthesis \u2192</a>' +
          '</div>';
      })() +

      '<div class="card-title">Work Packages</div>' +
      (wps.length
        ? '<div class="table-wrapper"><table>' +
            '<thead><tr><th>WP ID</th><th>Title</th><th>Assigned To</th><th>Status</th></tr></thead>' +
            '<tbody>' + wpRows + '</tbody>' +
          '</table></div>'
        : '<p class="text-muted">No work packages.</p>') +
      '<div class="card-title" style="margin-top:24px">Project Comments</div>' +
      commentCards;

    // Clickable rows
    app.querySelectorAll('tr.clickable').forEach(function (row) {
      row.addEventListener('click', function () {
        var href = this.getAttribute('data-href');
        if (href) window.location.hash = href;
      });
    });

    // Reset Project button
    var resetBtn = document.getElementById('reset-project-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Analyzing…';
        API.analyzeProjectReset(slug).then(function (diagnosis) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset Project';
          if (diagnosis.work_packages_needing_reset === 0) {
            alert('All work packages are healthy — no reset needed.');
            return;
          }
          showResetModal(slug, diagnosis);
        }).catch(function (err) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset Project';
          alert('Analysis failed: ' + (err.message || String(err)));
        });
      });
    }

    // Inline title edit
    (function () {
      var editBtn = document.getElementById('edit-title-btn');
      var headingEl = document.getElementById('project-title-heading');
      var breadcrumbEl = document.getElementById('breadcrumb-title');
      if (!editBtn || !headingEl) return;

      var currentTitle = displayTitle;

      editBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'title-edit-input';
        input.value = currentTitle;
        headingEl.style.display = 'none';
        editBtn.style.display = 'none';
        headingEl.parentNode.insertBefore(input, headingEl.nextSibling);
        input.focus();
        input.select();

        var inputDone = false;

        function exitEdit() {
          var errEl = document.getElementById('title-edit-error');
          if (errEl) errEl.remove();
          if (input.parentNode) input.parentNode.removeChild(input);
          headingEl.style.display = '';
          editBtn.style.display = '';
        }

        function doSave() {
          var newTitle = input.value.trim();
          if (!newTitle || newTitle === currentTitle) {
            exitEdit();
            return;
          }
          input.disabled = true;
          API.renameProject(slug, newTitle).then(function () {
            currentTitle = newTitle;
            headingEl.textContent = newTitle;
            if (breadcrumbEl) breadcrumbEl.textContent = newTitle;
            exitEdit();
          }).catch(function (err) {
            input.disabled = false;
            inputDone = false; // allow retry after failure
            var errEl = document.getElementById('title-edit-error');
            if (!errEl) {
              errEl = document.createElement('div');
              errEl.id = 'title-edit-error';
              errEl.className = 'title-edit-error';
              headingEl.parentNode.insertBefore(errEl, input.nextSibling);
            }
            errEl.textContent = 'Rename failed: ' + (err.message || String(err));
          });
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            inputDone = true;
            exitEdit();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!inputDone) {
              inputDone = true;
              doSave();
            }
          }
        });

        input.addEventListener('blur', function () {
          if (!inputDone) {
            inputDone = true;
            doSave();
          }
        });
      });
    })();

    // Inline slug edit
    (function () {
      var editBtn = document.getElementById('edit-slug-btn');
      var slugValueEl = document.getElementById('project-slug-value');
      if (!editBtn || !slugValueEl) return;

      var currentSlug = slug;
      var SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

      editBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'slug-edit-input';
        input.maxLength = 200;
        input.value = currentSlug;
        slugValueEl.style.display = 'none';
        editBtn.style.display = 'none';
        slugValueEl.parentNode.insertBefore(input, slugValueEl.nextSibling);
        input.focus();
        input.select();

        var inputDone = false;

        function showSlugError(msg) {
          var errEl = document.getElementById('slug-edit-error');
          if (!errEl) {
            errEl = document.createElement('div');
            errEl.id = 'slug-edit-error';
            errEl.className = 'slug-edit-error';
            input.parentNode.insertBefore(errEl, input.nextSibling);
          }
          errEl.textContent = msg;
        }

        function clearSlugError() {
          var errEl = document.getElementById('slug-edit-error');
          if (errEl) errEl.remove();
        }

        function exitSlugEdit() {
          clearSlugError();
          if (input.parentNode) input.parentNode.removeChild(input);
          slugValueEl.style.display = '';
          editBtn.style.display = '';
        }

        function doSlugSave() {
          var newSlug = input.value.trim();
          if (!newSlug || newSlug === currentSlug) {
            exitSlugEdit();
            return;
          }
          if (!SLUG_REGEX.test(newSlug)) {
            showSlugError('Invalid slug: use lowercase letters, digits, and hyphens only (must start with a letter or digit).');
            inputDone = false;
            return;
          }
          input.disabled = true;
          clearSlugError();
          API.renameSlug(currentSlug, newSlug).then(function () {
            window.location.hash = '#/projects/' + encodeURIComponent(newSlug);
          }).catch(function (err) {
            input.disabled = false;
            inputDone = false;
            showSlugError('Rename failed: ' + (err.message || String(err)));
          });
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            inputDone = true;
            exitSlugEdit();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!inputDone) {
              inputDone = true;
              doSlugSave();
            }
          }
        });

        input.addEventListener('blur', function () {
          if (!inputDone) {
            inputDone = true;
            doSlugSave();
          }
        });
      });
    })();

    // Health badge — async, non-blocking
    var healthBadge = document.getElementById('health-badge');
    if (healthBadge) {
      API.getProjectHealth(slug).then(function (health) {
        if (health.work_packages_needing_reset === 0) {
          healthBadge.textContent = '\u2713 All pipelines complete';
          healthBadge.className = 'health-badge healthy';
        } else {
          healthBadge.textContent = '\u26a0 ' + health.work_packages_needing_reset + ' WP' + (health.work_packages_needing_reset === 1 ? '' : 's') + ' need attention';
          healthBadge.className = 'health-badge attention';
        }
      }).catch(function () {
        // Silent failure — remove badge without blocking page
        if (healthBadge.parentNode) healthBadge.parentNode.removeChild(healthBadge);
      });
    }
  }).catch(function (err) {
    showError(app, 'Failed to load project: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   4c-ii. Reset Project Modal
   ---------------------------------------------------------- */
var PIPELINE_STAGES = ['implementation', 'qa', 'code-review', 'documentation'];

function showResetModal(slug, diagnosis) {
  // Remove any existing modal
  var existing = document.getElementById('reset-modal-overlay');
  if (existing) existing.remove();

  var wps = diagnosis.work_packages || [];

  // Build state: per-WP action + criteria checkbox
  var state = {};
  wps.forEach(function (wp) {
    state[wp.work_package_id] = {
      action: wp.current_status === 'CANCELLED' ? 'skip' : wp.suggested_action,
      reset_criteria: wp.suggested_reset_criteria,
      isCancelled: wp.current_status === 'CANCELLED',
    };
  });

  function buildSummary() {
    var resetCount = 0, skipCount = 0, cancelCount = 0;
    Object.keys(state).forEach(function (id) {
      if (state[id].action === 'reset') resetCount++;
      else if (state[id].action === 'cancel') cancelCount++;
      else skipCount++;
    });
    var parts = [];
    if (resetCount > 0) parts.push(resetCount + ' will be reset');
    if (skipCount > 0) parts.push(skipCount + ' skipped');
    if (cancelCount > 0) parts.push(cancelCount + ' cancelled');
    var statusNote = (resetCount > 0 || cancelCount > 0)
      ? ' — Project status \u2192 IN_PROGRESS'
      : '';
    return parts.join(', ') + statusNote;
  }

  function stageBadge(stage, present) {
    var cls = present ? 'reset-stage-badge reset-stage-present' : 'reset-stage-badge reset-stage-missing';
    return '<span class="' + cls + '">' + escapeHtml(stage) + '</span>';
  }

  function buildWpRow(wp) {
    var s = state[wp.work_package_id];
    var id = wp.work_package_id;
    var safeid = id.replace(/[^a-zA-Z0-9-]/g, '_');

    // Stage badges
    var presentSet = {};
    (wp.pipeline_stages_present || []).forEach(function (st) { presentSet[st] = true; });
    var stageBadges = PIPELINE_STAGES.map(function (st) {
      return stageBadge(st, !!presentSet[st]);
    }).join(' ');

    if (s.isCancelled) {
      return '<div class="reset-wp-row reset-wp-cancelled">' +
        '<div class="reset-wp-header">' +
          '<span class="monospace">' + escapeHtml(id) + '</span> ' +
          statusBadge(wp.current_status) +
        '</div>' +
        '<div class="reset-wp-stages">' + stageBadges + '</div>' +
        '<div class="text-muted" style="font-size:12px">CANCELLED — cannot be modified</div>' +
      '</div>';
    }

    var expanded = s.action === 'reset' || wp.needs_reset;

    // Collapsed summary line
    var actionLabel = s.action === 'reset' ? 'Reset' : (s.action === 'cancel' ? 'Cancel' : 'Skip');
    var collapsedSummary = escapeHtml(wp.reason);

    var detailHtml =
      '<div class="reset-wp-stages">' + stageBadges + '</div>' +
      '<div class="reset-wp-reason text-muted">' + escapeHtml(wp.reason) + '</div>';

    if (wp.pipeline_stages_missing.length > 0 && wp.next_required_stage) {
      detailHtml +=
        '<div class="reset-wp-diagnosis">Missing: ' + escapeHtml(wp.pipeline_stages_missing.join(', ')) +
        ' \u2192 will resume at <strong>' + escapeHtml(wp.target_assigned_to || wp.next_required_stage) + '</strong></div>';
    }

    // Radio buttons
    var radioName = 'action_' + safeid;
    var radios =
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="reset"' + (s.action === 'reset' ? ' checked' : '') + '> Reset</label>' +
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="skip"' + (s.action === 'skip' ? ' checked' : '') + '> Skip</label>' +
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="cancel"' + (s.action === 'cancel' ? ' checked' : '') + '> Cancel</label>';

    // Criteria checkbox (only visible when action === reset)
    var criteriaHtml =
      '<div class="reset-criteria-row" id="criteria_' + safeid + '" style="' + (s.action === 'reset' ? '' : 'display:none') + '">' +
        '<label><input type="checkbox" class="form-check" id="criteria_cb_' + safeid + '"' + (s.reset_criteria ? ' checked' : '') + '> Reset acceptance criteria to unmet</label>' +
      '</div>';

    return '<div class="reset-wp-row' + (expanded ? ' reset-wp-expanded' : '') + '" data-wp-id="' + escapeHtml(id) + '">' +
      '<div class="reset-wp-header reset-wp-toggle" data-target="detail_' + safeid + '">' +
        '<span class="reset-wp-arrow">' + (expanded ? '\u25BC' : '\u25B6') + '</span> ' +
        '<span class="monospace">' + escapeHtml(id) + '</span> ' +
        statusBadge(wp.current_status) +
        (wp.needs_reset ? ' <span class="badge badge-blocked" style="font-size:10px">NEEDS RESET</span>' : '') +
        ' <span class="text-muted" style="font-size:12px;margin-left:auto">' + escapeHtml(actionLabel) + '</span>' +
      '</div>' +
      '<div class="reset-wp-detail" id="detail_' + safeid + '" style="' + (expanded ? '' : 'display:none') + '">' +
        detailHtml +
        '<div class="reset-wp-actions">' + radios + '</div>' +
        criteriaHtml +
      '</div>' +
    '</div>';
  }

  var wpRowsHtml = wps.map(buildWpRow).join('');

  var modalHtml =
    '<div class="reset-modal-overlay" id="reset-modal-overlay">' +
      '<div class="reset-modal">' +
        '<div class="reset-modal-header">' +
          '<h2>Reset Project \u2014 ' + escapeHtml(slug) + '</h2>' +
          '<button class="reset-modal-close" id="reset-modal-close">\u00d7</button>' +
        '</div>' +
        '<div class="reset-modal-banner">' +
          'Analysis found <strong>' + diagnosis.work_packages_needing_reset + '</strong> broken work package' +
          (diagnosis.work_packages_needing_reset !== 1 ? 's' : '') +
          ' out of <strong>' + wps.length + '</strong> total.' +
        '</div>' +
        '<div class="reset-bulk-controls">' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-broken">Reset All Broken</button> ' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-skip">Skip All</button>' +
        '</div>' +
        '<div class="reset-wp-list">' + wpRowsHtml + '</div>' +
        '<div class="reset-modal-footer">' +
          '<div class="reset-summary" id="reset-summary">' + buildSummary() + '</div>' +
          '<div class="reset-modal-actions">' +
            '<button class="btn btn-secondary" id="reset-cancel-btn">Cancel</button> ' +
            '<button class="btn btn-primary" id="reset-apply-btn">Apply Reset</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  var overlay = document.getElementById('reset-modal-overlay');

  function updateSummary() {
    var el = document.getElementById('reset-summary');
    if (el) el.textContent = buildSummary();
    // Enable/disable apply button
    var hasAction = Object.keys(state).some(function (id) {
      return state[id].action === 'reset' || state[id].action === 'cancel';
    });
    var applyBtn = document.getElementById('reset-apply-btn');
    if (applyBtn) applyBtn.disabled = !hasAction;
  }

  function closeModal() {
    if (overlay) overlay.remove();
  }

  // Close button
  document.getElementById('reset-modal-close').addEventListener('click', closeModal);
  document.getElementById('reset-cancel-btn').addEventListener('click', closeModal);

  // Click overlay to close
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // Expand/collapse toggles
  overlay.querySelectorAll('.reset-wp-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var targetId = this.getAttribute('data-target');
      var detail = document.getElementById(targetId);
      var arrow = this.querySelector('.reset-wp-arrow');
      if (detail) {
        var isVisible = detail.style.display !== 'none';
        detail.style.display = isVisible ? 'none' : '';
        if (arrow) arrow.textContent = isVisible ? '\u25B6' : '\u25BC';
      }
    });
  });

  // Bulk controls
  document.getElementById('reset-bulk-broken').addEventListener('click', function () {
    wps.forEach(function (wp) {
      if (state[wp.work_package_id].isCancelled) return;
      state[wp.work_package_id].action = wp.needs_reset ? 'reset' : 'skip';
      state[wp.work_package_id].reset_criteria = wp.suggested_reset_criteria;
    });
    refreshRadios();
    updateSummary();
  });

  document.getElementById('reset-bulk-skip').addEventListener('click', function () {
    wps.forEach(function (wp) {
      if (state[wp.work_package_id].isCancelled) return;
      state[wp.work_package_id].action = 'skip';
    });
    refreshRadios();
    updateSummary();
  });

  function refreshRadios() {
    wps.forEach(function (wp) {
      var s = state[wp.work_package_id];
      if (s.isCancelled) return;
      var safeid = wp.work_package_id.replace(/[^a-zA-Z0-9-]/g, '_');
      var radios = document.querySelectorAll('input[name="action_' + safeid + '"]');
      radios.forEach(function (r) { r.checked = (r.value === s.action); });
      var criteriaRow = document.getElementById('criteria_' + safeid);
      if (criteriaRow) criteriaRow.style.display = s.action === 'reset' ? '' : 'none';
      var criteriaCb = document.getElementById('criteria_cb_' + safeid);
      if (criteriaCb) criteriaCb.checked = s.reset_criteria;
    });
  }

  // Wire up radio and checkbox change events
  wps.forEach(function (wp) {
    if (state[wp.work_package_id].isCancelled) return;
    var safeid = wp.work_package_id.replace(/[^a-zA-Z0-9-]/g, '_');

    var radios = document.querySelectorAll('input[name="action_' + safeid + '"]');
    radios.forEach(function (r) {
      r.addEventListener('change', function () {
        state[wp.work_package_id].action = this.value;
        var criteriaRow = document.getElementById('criteria_' + safeid);
        if (criteriaRow) criteriaRow.style.display = this.value === 'reset' ? '' : 'none';
        updateSummary();
      });
    });

    var criteriaCb = document.getElementById('criteria_cb_' + safeid);
    if (criteriaCb) {
      criteriaCb.addEventListener('change', function () {
        state[wp.work_package_id].reset_criteria = this.checked;
      });
    }
  });

  // Apply button
  document.getElementById('reset-apply-btn').addEventListener('click', function () {
    var applyBtn = this;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';

    var decisions = {};
    Object.keys(state).forEach(function (id) {
      var s = state[id];
      if (s.isCancelled) return; // Don't include CANCELLED WPs in decisions
      decisions[id] = { action: s.action };
      if (s.action === 'reset') {
        decisions[id].reset_criteria = s.reset_criteria;
      }
    });

    API.applyProjectReset(slug, decisions).then(function (result) {
      closeModal();
      // Show brief success toast
      var toast = document.createElement('div');
      toast.className = 'success-banner';
      toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
      toast.textContent = result.project_comment_added || 'Project reset applied successfully.';
      document.body.appendChild(toast);
      setTimeout(function () { toast.remove(); }, 4000);
      // Refresh the project view
      var app = document.getElementById('app');
      if (app) renderProjectDetail(app, slug);
    }).catch(function (err) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Reset';
      alert('Reset failed: ' + (err.message || String(err)));
    });
  });

  updateSummary();
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
   4e. View: Insights
   ---------------------------------------------------------- */
function renderInsights(app) {
  showLoading(app);

  var allEntries = [];
  var filterType = 'ALL';
  var filterPriority = 'ALL';
  var filterProject = 'ALL';

  function buildCards() {
    var filtered = allEntries.filter(function (e) {
      if (filterType !== 'ALL' && e.type !== filterType) return false;
      if (filterPriority !== 'ALL' && e.priority !== filterPriority) return false;
      if (filterProject !== 'ALL' && e.project_slug !== filterProject) return false;
      return true;
    });

    if (!filtered.length) {
      return '<p class="text-muted mt-16">No insights found.</p>';
    }

    return filtered.map(function (e) {
      var priorityClass = e.priority ? ' priority-' + e.priority : '';
      var contextHtml = '';
      if (e.context && typeof e.context === 'object') {
        var ctxItems = Object.entries(e.context).map(function (pair) {
          return '<span><strong>' + escapeHtml(pair[0]) + ':</strong> ' + escapeHtml(String(pair[1])) + '</span>';
        }).join('<br>');
        contextHtml =
          '<div class="comment-context">' +
            ctxItems +
          '</div>';
      }
      return '<div class="comment-card' + priorityClass + '">' +
        '<div class="comment-meta">' +
          '<a href="#/projects/' + encodeURIComponent(e.project_slug) + '">' + escapeHtml(e.project_slug) + '</a>' +
          ' &mdash; ' +
          escapeHtml(e.agent || '\u2014') +
          ' <span class="comment-type">' + escapeHtml(e.type || '') + '</span>' +
          ' <span>' + escapeHtml(formatDate(e.timestamp)) + '</span>' +
        '</div>' +
        '<div class="comment-body">' + escapeHtml(e.note || '') + '</div>' +
        contextHtml +
      '</div>';
    }).join('');
  }

  function renderCards() {
    var container = document.getElementById('insights-list');
    if (container) {
      container.innerHTML = buildCards();
    }
  }

  function render(entries) {
    allEntries = entries;

    // Collect distinct types and project slugs
    var types = [];
    var projects = [];
    entries.forEach(function (e) {
      if (e.type && types.indexOf(e.type) === -1) types.push(e.type);
      if (e.project_slug && projects.indexOf(e.project_slug) === -1) projects.push(e.project_slug);
    });
    types.sort();
    projects.sort();

    var typeOptions = types.map(function (t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
    }).join('');
    var projectOptions = projects.map(function (p) {
      return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
    }).join('');

    app.innerHTML =
      '<div class="page-header"><h1>Insights</h1></div>' +
      '<div class="insights-filters">' +
        '<label for="insights-type">Type:</label>' +
        '<select id="insights-type"><option value="ALL">All types</option>' + typeOptions + '</select>' +
        '<label for="insights-priority">Priority:</label>' +
        '<select id="insights-priority"><option value="ALL">All priorities</option>' +
          '<option value="high">high</option>' +
          '<option value="medium">medium</option>' +
          '<option value="low">low</option>' +
        '</select>' +
        '<label for="insights-project">Project:</label>' +
        '<select id="insights-project"><option value="ALL">All projects</option>' + projectOptions + '</select>' +
      '</div>' +
      '<div id="insights-list">' + buildCards() + '</div>';

    // Restore saved filter values and wire change listeners
    var typeEl = document.getElementById('insights-type');
    var priorEl = document.getElementById('insights-priority');
    var projEl = document.getElementById('insights-project');
    if (typeEl) {
      typeEl.value = filterType;
      typeEl.addEventListener('change', function () { filterType = this.value; renderCards(); });
    }
    if (priorEl) {
      priorEl.value = filterPriority;
      priorEl.addEventListener('change', function () { filterPriority = this.value; renderCards(); });
    }
    if (projEl) {
      projEl.value = filterProject;
      projEl.addEventListener('change', function () { filterProject = this.value; renderCards(); });
    }
  }

  function load() {
    API.getInsights().then(function (entries) {
      render(entries || []);
    }).catch(function (err) {
      showError(app, 'Failed to load insights: ' + (err.message || String(err)));
    });
  }

  load();
  Router._setPolling(load, 15000);
}

/* ----------------------------------------------------------
   5. Bootstrap
   ---------------------------------------------------------- */
Theme.init();
Router.init();
