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

function renderWorkPackageDetail(app, repo, slug, wpId) {
  showLoading(app);

  API.getWorkPackage(repo, slug, wpId).then(function (wp) {
    // Acceptance criteria
    var acHtml = (wp.acceptance_criteria || []).map(function (ac) {
      var met = ac.met === true;
      return '<li>' +
        '<span class="ac-icon ' + (met ? 'ac-met' : 'ac-unmet') + '">' + (met ? '✓' : '○') + '</span>' +
        '<span>' + escapeHtml(ac.criterion) + '</span>' +
      '</li>';
    }).join('');

    // WP aggregate timing
    var totalActiveMs = 0;
    var hasDurationData = false;
    var firstStartAt = null;
    var lastCompletedAt = null;
    (wp.pipelines || []).forEach(function (p) {
      if (p.duration_ms != null) {
        totalActiveMs += p.duration_ms;
        hasDurationData = true;
      }
      if (p.started_at) {
        var tsStart = new Date(p.started_at).getTime();
        if (!isNaN(tsStart) && (firstStartAt === null || tsStart < firstStartAt)) firstStartAt = tsStart;
      }
      if (p.completed_at) {
        var tsEnd = new Date(p.completed_at).getTime();
        if (!isNaN(tsEnd) && (lastCompletedAt === null || tsEnd > lastCompletedAt)) lastCompletedAt = tsEnd;
      }
    });
    var wallClockMs = (firstStartAt !== null && lastCompletedAt !== null) ? (lastCompletedAt - firstStartAt) : null;
    var wpTimingHtml = (hasDurationData || wallClockMs !== null)
      ? '<div class="wp-timing">' +
          (hasDurationData ? '<strong>Active time:</strong> ' + escapeHtml(formatDuration(totalActiveMs)) : '') +
          (hasDurationData && wallClockMs !== null ? ' &nbsp;·&nbsp; ' : '') +
          (wallClockMs !== null ? '<strong>Wall-clock:</strong> ' + escapeHtml(formatDuration(wallClockMs)) : '') +
        '</div>'
      : '';

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
          (p.duration_ms != null ? ' <span class="badge badge-neutral">' + escapeHtml(formatDuration(p.duration_ms)) + '</span>' : '') +
        '</div>' +
        '<div class="pipeline-meta">' +
          'Started: ' + escapeHtml(formatDate(p.started_at)) +
          (p.completed_at ? ' &nbsp; Completed: ' + escapeHtml(formatDate(p.completed_at)) : '') +
          (p.duration_ms != null ? ' &nbsp; Duration: ' + escapeHtml(formatDuration(p.duration_ms)) : '') +
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
      breadcrumb().projects().project(repo, slug).leaf(wpId).html() +
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
        ? '<div class="card"><div class="card-title">Pipelines</div>' + wpTimingHtml + pipelinesHtml + '</div>'
        : '') +
      handoffHtml +
      '<div id="wp-dialogues-section"></div>';

    // Fetch and render Dialogues card asynchronously (after DOM is set).
    // Strategy: prefer chunk JSONL files (streaming capture) when available;
    // fall back to Markdown dialogue files for older runs that predate streaming capture.
    var dialoguesEl = document.getElementById('wp-dialogues-section');

    Promise.all([
      // getChunks errors are silently swallowed — absent chunks directory is
      // expected for older runs that predate streaming capture.
      API.getChunks(repo, slug, wpId).catch(function () { return []; }),
      API.getDialogues(repo, slug, wpId),
    ]).then(function (results) {
      var chunks = results[0] || [];
      var dialogues = results[1] || [];
      if (!dialoguesEl) return;

      // Choose data source: chunks take priority over Markdown dialogue files.
      var useChunks = chunks.length > 0;
      var entries = useChunks ? chunks : dialogues;

      if (!entries || entries.length === 0) {
        dialoguesEl.innerHTML =
          '<div class="card">' +
            '<div class="card-title">Dialogues</div>' +
            '<p class="text-muted">No dialogues available for this work package.</p>' +
          '</div>';
        return;
      }

      // Group by stage, preserving insertion order
      var stageMap = {};
      var stageOrder = [];
      entries.forEach(function (d) {
        var stage = d.stage || 'unknown';
        if (!stageMap[stage]) {
          stageMap[stage] = [];
          stageOrder.push(stage);
        }
        stageMap[stage].push(d);
      });

      var stagesHtml = stageOrder.map(function (stage) {
        var stageEntries = stageMap[stage];
        var buttonsHtml = stageEntries.map(function (d, idx) {
          var isLatest = (idx === stageEntries.length - 1);
          // Human-readable label: stage-r{revision index}
          var label = escapeHtml(stage + '-r' + idx);
          return '<button class="dialogue-btn' + (isLatest ? ' dialogue-btn-latest' : '') + '" ' +
            'aria-expanded="false" ' +
            'data-repo="' + escapeHtml(repo) + '" ' +
            'data-slug="' + escapeHtml(slug) + '" ' +
            'data-filename="' + escapeHtml(d.filename) + '" ' +
            'data-use-chunks="' + (useChunks ? '1' : '0') + '">' +
            label +
          '</button>';
        }).join('');
        return '<div class="dialogue-stage">' +
          '<span class="dialogue-stage-label">' + escapeHtml(stage) + '</span> ' +
          buttonsHtml +
          '<div class="dialogue-content" style="display:none"></div>' +
        '</div>';
      }).join('');

      dialoguesEl.innerHTML =
        '<div class="card" id="wp-dialogues-card">' +
          '<div class="card-title">Dialogues</div>' +
          stagesHtml +
        '</div>';

      // Track the currently expanded button
      var activeBtn = null;

      dialoguesEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.dialogue-btn');
        if (!btn) return;

        // Collapse previously expanded dialogue if different button
        if (activeBtn && activeBtn !== btn) {
          var prevStage = activeBtn.closest('.dialogue-stage');
          if (prevStage) {
            var prevContent = prevStage.querySelector('.dialogue-content');
            if (prevContent) { prevContent.style.display = 'none'; prevContent.innerHTML = ''; }
          }
          activeBtn.classList.remove('dialogue-btn-active');
          activeBtn.setAttribute('aria-expanded', 'false');
        }

        // If same button is clicked again, collapse it
        if (activeBtn === btn) {
          var curStage = btn.closest('.dialogue-stage');
          if (curStage) {
            var curContent = curStage.querySelector('.dialogue-content');
            if (curContent) { curContent.style.display = 'none'; curContent.innerHTML = ''; }
          }
          btn.classList.remove('dialogue-btn-active');
          btn.setAttribute('aria-expanded', 'false');
          activeBtn = null;
          return;
        }

        activeBtn = btn;
        btn.classList.add('dialogue-btn-active');
        btn.setAttribute('aria-expanded', 'true');

        var dlgRepo = btn.getAttribute('data-repo');
        var dlgSlug = btn.getAttribute('data-slug');
        var dlgFilename = btn.getAttribute('data-filename');
        var dlgUseChunks = btn.getAttribute('data-use-chunks') === '1';
        var stageEl = btn.closest('.dialogue-stage');
        var contentEl = stageEl ? stageEl.querySelector('.dialogue-content') : null;
        if (!contentEl) return;

        contentEl.innerHTML = '<em class="text-muted">Loading…</em>';
        contentEl.style.display = 'block';

        // Fetch rendered Markdown: use the /rendered chunk endpoint for chunk
        // files, or the plain dialogue content endpoint for Markdown files.
        var fetchPromise = dlgUseChunks
          ? API.getChunkRendered(dlgRepo, dlgSlug, dlgFilename)
          : API.getDialogueContent(dlgRepo, dlgSlug, dlgFilename);

        fetchPromise.then(function (md) {
          var rendered = (typeof marked !== 'undefined' && marked.parse)
            ? marked.parse(md)
            : '<pre>' + escapeHtml(md) + '</pre>';
          contentEl.innerHTML = '<div class="dialogue-markdown">' + rendered + '</div>';
        }).catch(function (err) {
          contentEl.innerHTML = '<p class="text-danger">Error loading dialogue: ' + escapeHtml(err.message || String(err)) + '</p>';
        });
      });
    }).catch(function (err) {
      if (!dialoguesEl) return;
      dialoguesEl.innerHTML =
        '<div class="card">' +
          '<div class="card-title">Dialogues</div>' +
          '<p class="text-danger">Failed to load dialogues: ' + escapeHtml(err.message || String(err)) + '</p>' +
        '</div>';
    });
  }).catch(function (err) {
    showError(app, 'Failed to load work package: ' + (err.message || String(err)));
  });
}
