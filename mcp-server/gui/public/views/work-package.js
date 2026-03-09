/* ============================================================
   views/work-package.js — Work Package Detail view
   Section 4c of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, formatDate, statusBadge,
               showLoading, showError
   ============================================================ */

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
