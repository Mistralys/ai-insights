/* ============================================================
   views/insights.js — Insights view
   Section 4e of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, formatDate,
               showLoading, showError, UI (components.js)
   ============================================================ */

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
      return UI.emptyState('No insights found.');
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
      /* Namespaced link: #/projects/{repo}/{slug} — requires repository_name so
         the router can scope the project view to the correct repository. Entries
         where repository_name is null (e.g. from a shallow plan path) fall back
         to plain escaped text — no anchor, no broken link. */
      var projectLink = e.repository_name
        ? '<a href="#/projects/' + encodeURIComponent(e.repository_name) + '/' + encodeURIComponent(e.project_slug) + '">' + escapeHtml(e.project_slug) + '</a>'
        : escapeHtml(e.project_slug);
      return '<div class="comment-card' + priorityClass + '">' +
        '<div class="comment-meta">' +
          projectLink +
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

    var fb = UI.filterBar('insights-filter-bar', [
      { type: 'select', id: 'insights-type', label: 'Type:', options:
        [{ value: 'ALL', label: 'All types' }].concat(types.map(function (t) {
          return { value: t, label: t };
        }))
      },
      { type: 'select', id: 'insights-priority', label: 'Priority:', options: [
        { value: 'ALL', label: 'All priorities' },
        { value: 'high',   label: 'high'   },
        { value: 'medium', label: 'medium' },
        { value: 'low',    label: 'low'    }
      ]},
      { type: 'select', id: 'insights-project', label: 'Project:', options:
        [{ value: 'ALL', label: 'All projects' }].concat(projects.map(function (p) {
          return { value: p, label: p };
        }))
      }
    ]);

    app.innerHTML =
      '<div class="page-header"><h1>Insights</h1></div>' +
      fb.html +
      '<div id="insights-list">' + buildCards() + '</div>';

    // Restore saved filter values
    var typeEl  = document.getElementById('insights-type');
    var priorEl = document.getElementById('insights-priority');
    var projEl  = document.getElementById('insights-project');
    if (typeEl)  typeEl.value  = filterType;
    if (priorEl) priorEl.value = filterPriority;
    if (projEl)  projEl.value  = filterProject;

    // Wire filter change events
    fb.bind(function (state) {
      filterType     = state['insights-type'];
      filterPriority = state['insights-priority'];
      filterProject  = state['insights-project'];
      renderCards();
    });
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
