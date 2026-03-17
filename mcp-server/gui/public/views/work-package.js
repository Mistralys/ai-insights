/* ============================================================
   views/work-package.js — Work Package Detail view
   Section 4c of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, formatDate, statusBadge,
               showLoading, showError, STAGE_ABBREV (project-detail.js)
   ============================================================ */

var WP_DEFAULT_STAGES = ['implementation', 'qa', 'code-review', 'documentation'];

function buildWpDetailBar(wp) {
  var rawStages = (wp.active_pipeline_stages && wp.active_pipeline_stages.length)
    ? wp.active_pipeline_stages
    : (wp.default_pipeline_stages && wp.default_pipeline_stages.length)
      ? wp.default_pipeline_stages
      : WP_DEFAULT_STAGES;

  // Build a fast lookup from pipeline type → latest pipeline status
  var latestStatus = {};
  var pipelineCountByType = {};
  (wp.pipelines || []).forEach(function (p) {
    var t = p.type;
    pipelineCountByType[t] = (pipelineCountByType[t] || 0) + 1;
    // Last write wins — pipelines are in chronological order
    latestStatus[t] = (p.status || '').toLowerCase();
  });

  var badges = rawStages.map(function (stageType) {
    var abbrev = (typeof STAGE_ABBREV !== 'undefined' && STAGE_ABBREV[stageType])
      ? STAGE_ABBREV[stageType]
      : stageType.slice(0, 3).toUpperCase();
    var rawSt = latestStatus[stageType] || 'pending';
    var statusClass = 'stage-pending';
    if (rawSt === 'in_progress' || rawSt === 'in-progress') statusClass = 'stage-in-progress';
    else if (rawSt === 'pass')                               statusClass = 'stage-pass';
    else if (rawSt === 'fail')                               statusClass = 'stage-fail';

    var reworkCount = wp.rework_counts ? (wp.rework_counts[stageType] || 0) : 0;
    if (!reworkCount && pipelineCountByType[stageType] > 1) {
      reworkCount = pipelineCountByType[stageType] - 1;
    }
    var tooltip = escapeHtml(stageType);
    if (rawSt !== 'pending') tooltip += ' — ' + escapeHtml(rawSt);
    if (reworkCount > 0)     tooltip += ' (rework: ' + reworkCount + ')';
    var reworkBadge = reworkCount > 0
      ? '<span class="rework-indicator" title="Rework count: ' + reworkCount + '">' + reworkCount + '</span>'
      : '';
    return '<span class="stage-badge ' + statusClass + '" title="' + tooltip + '">' +
      escapeHtml(abbrev) + reworkBadge +
    '</span>';
  }).join('');

  return '<div class="card">' +
    '<div class="card-title" style="margin-bottom:8px">Pipeline Progression</div>' +
    '<div class="pipeline-track">' + badges + '</div>' +
  '</div>';
}

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
    var pipelinesHtml = (wp.pipelines || []).slice().reverse().map(function (p) {
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
      buildWpDetailBar(wp) +
      (pipelinesHtml
        ? '<div class="card"><div class="card-title">Pipelines</div>' + pipelinesHtml + '</div>'
        : '') +
      handoffHtml;
  }).catch(function (err) {
    showError(app, 'Failed to load work package: ' + (err.message || String(err)));
  });
}
