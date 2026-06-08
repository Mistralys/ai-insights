/* ============================================================
   views/project-detail.js — Project Detail view
   Sections 4b–4d of the MCP Server Dashboard SPA
   Depends on: API, Router, marked, escapeHtml, formatDate,
               statusBadge, showLoading, showError,
               OrchestratorWidgets (js/orchestrator-widgets.js)
   ============================================================ */

// Module-scoped log-preview cleanup registry.
// Each renderProjectDetail() call drains this array before creating new widgets.
var _pdLogPreviewCleanups = [];

/* ----------------------------------------------------------
   4b. View: Plan Document
   ---------------------------------------------------------- */
function extractSynopsis(markdown) {
  var match = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
  return match ? match[1].trim() : null;
}

async function renderPlan(app, repo, slug) {
  app.innerHTML = '<p class="loading">Loading plan\u2026</p>';
  try {
    var result = await API.getPlanDocument(repo, slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf('Plan').html() +
      '<div class="plan-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        breadcrumb().projects().project(repo, slug).leaf('Plan').html() +
        '<p class="empty-state">Plan document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load plan document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4b-ii. View: Synthesis Document
   ---------------------------------------------------------- */
async function renderSynthesis(app, repo, slug) {
  app.innerHTML = '<p class="loading">Loading synthesis\u2026</p>';
  try {
    var result = await API.getSynthesisDocument(repo, slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf('Synthesis').html() +
      '<div class="synthesis-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        breadcrumb().projects().project(repo, slug).leaf('Synthesis').html() +
        '<p class="empty-state">Synthesis document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4c. View: Project Detail
   ---------------------------------------------------------- */

// Abbreviations for pipeline stage types
var STAGE_ABBREV = {
  'implementation':     'DEV',
  'qa':                 'QA',
  'security-audit':     'SEC',
  'code-review':        'REV',
  'release-engineering':'REL',
  'documentation':      'DOC'
};

function buildPipelineTrack(overviewEntry) {
  if (!overviewEntry || !overviewEntry.pipeline_stages || !overviewEntry.pipeline_stages.length) {
    return '—';
  }
  var badges = overviewEntry.pipeline_stages.map(function (stage) {
    var abbrev = STAGE_ABBREV[stage.type] || stage.type.slice(0, 3).toUpperCase();
    var statusClass = 'stage-pending';
    if (stage.status === 'in-progress') statusClass = 'stage-in-progress';
    else if (stage.status === 'pass')        statusClass = 'stage-pass';
    else if (stage.status === 'fail')        statusClass = 'stage-fail';
    var tooltip = escapeHtml(stage.type) + ' — ' + escapeHtml(stage.agent);
    if (stage.rework_count > 0) tooltip += ' (rework: ' + stage.rework_count + ')';
    var reworkBadge = stage.rework_count > 0
      ? '<span class="rework-indicator" title="Rework count: ' + stage.rework_count + '">' + stage.rework_count + '</span>'
      : '';
    return '<span class="stage-badge ' + statusClass + '" title="' + tooltip + '">' +
      escapeHtml(abbrev) +
      reworkBadge +
    '</span>';
  }).join('');
  return '<div class="pipeline-track">' + badges + '</div>';
}

function buildRunBadges(item, isActive) {
  var badges = '';
  if (isActive) {
    badges += '<span class="badge badge-in-progress">Running</span>';
  }
  if (item && item.is_dry_run) {
    badges += '<span class="badge badge-dry-run">Dry Run</span>';
  }
  return badges;
}

/* ----------------------------------------------------------
   Orchestrator Toolbar
   Renders Kill + Resume buttons into toolbarEl.
   Always visible; buttons are disabled (with explanatory
   tooltips) when the corresponding action is unavailable.

   opts: {
     loading:      bool,           — show "Loading…" disabled state
     hasActiveRun: bool,           — is there an active run?
     queueEntry:   object|null,    — matching queue entry (kill)
     runMeta:      object|null,    — run metadata (resume)
     meta:         object,         — project meta (plan_path, status)
     repo:         string,
     slug:         string,
     app:          Element,        — root element (re-render after resume)
     onKillDone:   Function,       — called after a successful kill
   }
   ---------------------------------------------------------- */
function renderOrchToolbar(toolbarEl, opts) {
  if (!toolbarEl) return;
  toolbarEl.innerHTML = '';

  var loading      = !!opts.loading;
  var hasActiveRun = !!opts.hasActiveRun;
  var queueEntry   = opts.queueEntry  || null;
  var runMeta      = opts.runMeta     || null;
  var meta         = opts.meta        || {};
  var repo         = opts.repo        || '';
  var slug         = opts.slug        || '';
  var app          = opts.app         || null;
  var onKillDone   = typeof opts.onKillDone === 'function' ? opts.onKillDone : null;

  // ── Kill button ─────────────────────────────────────────────────────
  var killDisabled = true;
  var killTitle    = 'Loading\u2026';
  if (!loading) {
    if (!hasActiveRun) {
      killTitle = 'No active run to kill';
    } else if (!queueEntry) {
      killTitle = 'Run is active but not found in the queue \u2014 use: node scripts/kill-orchestrator.js --force';
    } else {
      killDisabled = false;
      killTitle    = '';
    }
  }

  if (killDisabled) {
    var killBtn = document.createElement('button');
    killBtn.type = 'button';
    killBtn.className = 'btn btn-danger btn-sm orchestrator-kill-btn';
    killBtn.textContent = 'Kill';
    killBtn.disabled = true;
    if (killTitle) killBtn.title = killTitle;
    toolbarEl.appendChild(killBtn);
  } else {
    toolbarEl.appendChild(
      OrchestratorWidgets.renderKillButton(queueEntry.id, function () {
        if (onKillDone) onKillDone();
      })
    );
  }

  // ── Resume button ────────────────────────────────────────────────────
  var resumeDisabled = true;
  var resumeTitle    = 'Loading\u2026';
  if (!loading) {
    if (hasActiveRun) {
      resumeTitle = 'Cannot resume while a run is active';
    } else if (!meta.plan_path) {
      resumeTitle = 'No plan path configured for this project';
    } else if (meta.status === 'COMPLETE') {
      resumeTitle = 'Project is already complete \u2014 nothing to resume';
    } else if (meta.status === 'ARCHIVED') {
      resumeTitle = 'Project is archived';
    } else if (!runMeta || !runMeta.thread_id) {
      resumeTitle = 'No interrupted run found';
    } else if (runMeta.dry_run === true) {
      resumeTitle = 'Dry runs cannot be resumed';
    } else if (runMeta.result === 'SUCCESS') {
      resumeTitle = 'Last run completed successfully \u2014 nothing to resume';
    } else {
      resumeDisabled = false;
      resumeTitle    = '';
    }
  }

  var resumeBtn = document.createElement('button');
  resumeBtn.id   = 'orch-resume-btn';
  resumeBtn.type = 'button';
  resumeBtn.className = 'btn btn-resume btn-sm';
  resumeBtn.textContent = 'Resume';
  resumeBtn.disabled = resumeDisabled;
  if (resumeTitle) resumeBtn.title = resumeTitle;

  if (!resumeDisabled) {
    var threadId = runMeta.thread_id;
    var planPath = meta.plan_path;

    resumeBtn.addEventListener('click', function () {
      resumeBtn.disabled = true;
      resumeBtn.textContent = 'Resuming\u2026';
      // Remove any stale error banner.
      var prevErr = document.getElementById('orch-resume-error');
      if (prevErr) prevErr.remove();

      API.orchestratorStart(planPath, false, threadId).then(function (result) {
        if (result && result.started) {
          resumeBtn.textContent = 'Launching\u2026';
          var pollResume = function () {
            API.orchestratorGetQueue().then(function (queue) {
              var hasActiveEntry = Array.isArray(queue) && queue.some(function (entry) {
                return entry && (entry.effectiveStatus === 'pending' ||
                                 entry.effectiveStatus === 'started');
              });
              if (hasActiveEntry) {
                Router._clearPolling();
                if (app) renderProjectDetail(app, repo, slug);
              }
            }).catch(function () { /* keep polling */ });
          };
          Router._setPolling(pollResume, 3000);
        } else {
          resumeBtn.disabled = false;
          resumeBtn.textContent = 'Resume';
          var errEl = document.getElementById('orch-resume-error');
          if (!errEl) {
            errEl = document.createElement('p');
            errEl.id = 'orch-resume-error';
            errEl.className = 'error-banner';
            toolbarEl.insertAdjacentElement('afterend', errEl);
          }
          errEl.textContent = 'Resume could not be started.';
        }
      }).catch(function (err) {
        resumeBtn.disabled = false;
        resumeBtn.textContent = 'Resume';
        var errEl = document.getElementById('orch-resume-error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.id = 'orch-resume-error';
          errEl.className = 'error-banner';
          toolbarEl.insertAdjacentElement('afterend', errEl);
        }
        errEl.textContent = 'Resume failed: ' + (err.message || String(err));
      });
    });
  }

  toolbarEl.appendChild(resumeBtn);
}

function renderProjectDetail(app, repo, slug) {
  // Drain log preview cleanup callbacks from the previous render.
  _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  _pdLogPreviewCleanups = [];

  showLoading(app);

  Promise.all([
    API.getProject(repo, slug),
    API.getPlanDocument(repo, slug).catch(function () { return null; }),
    API.getWorkPackageOverview(repo, slug).catch(function () { return null; }),
  ]).then(function (results) {
    var project = results[0];
    var planResult = results[1];
    var overviewResult = results[2]; // null if request failed (graceful degradation)
    var meta = project.meta || {};
    var wps = project.work_packages || [];

    // Build a fast lookup: work_package_id → overview entry
    var overviewMap = {};
    if (overviewResult && Array.isArray(overviewResult)) {
      overviewResult.forEach(function (entry) {
        overviewMap[entry.work_package_id] = entry;
      });
    }

    var useOverview = overviewResult !== null;

    var wpRows = wps.map(function (wp) {
      var pipelineCell = useOverview
        ? buildPipelineTrack(overviewMap[wp.work_package_id])
        : escapeHtml(wp.work_package_id);
      return '<tr class="clickable" data-href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' +
        '<td class="monospace"><a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' + escapeHtml(wp.work_package_id) + '</a></td>' +
        '<td>' + pipelineCell + '</td>' +
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

    var displayTitle = (project.project_name && project.project_name.trim()) ? project.project_name : ((meta.title && meta.title.trim()) ? meta.title : slug);
    ProjectNameCache.set(makeProjectCacheKey(repo, slug), displayTitle);
    app.innerHTML =
      breadcrumb().projects().leafSpan(displayTitle, 'breadcrumb-title').html() +
      (meta.status === 'ARCHIVED' ?
        '<div class="info-banner" id="archive-banner">' +
          'This project is archived and hidden from the active list. ' +
          '<button class="btn btn-secondary btn-sm" id="unarchive-banner-btn">Unarchive</button>' +
        '</div>' : '') +
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
          (project.timing
            ? '<br><strong>Duration:</strong> ' + escapeHtml(formatDuration(project.timing.project_elapsed_ms)) +
                (project.timing.pipeline_runs > 0
                  ? ' &nbsp;\u00b7&nbsp; <strong>Active:</strong> ' + escapeHtml(formatDuration(project.timing.total_active_ms)) + ' across ' + project.timing.pipeline_runs + ' pipeline runs'
                  : '')
            : '') +
          (project.server_version ? '<br><strong>Server version:</strong> <span class="monospace">v' + escapeHtml(project.server_version) + '</span>' : '') +
          (project.ledger_version ? ' &nbsp; <strong>Spec version:</strong> <span class="monospace">v' + escapeHtml(project.ledger_version) + '</span>' : '') +
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
              '<a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/plan" class="plan-synopsis__link">View full plan \u2192</a>' +
              '</div>';
          }
        }
        return synopsisHtml;
      })() +

      (function () {
        if (!project.synthesis_generated) return '';
        return '<div class="synthesis-link-row">' +
          '<a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/synthesis" class="synthesis-link">View synthesis \u2192</a>' +
          '</div>';
      })() +

      '<div class="card-title">Work Packages</div>' +
      (wps.length
        ? '<div class="table-wrapper"><table>' +
            '<thead><tr><th>WP ID</th><th>' + (useOverview ? 'Pipeline Stages' : 'WP ID') + '</th><th>Assigned To</th><th>Status</th></tr></thead>' +
            '<tbody>' + wpRows + '</tbody>' +
          '</table></div>'
        : '<p class="text-muted">No work packages.</p>') +
      '<div class="card-title" style="margin-top:24px">Project Comments</div>' +
      commentCards +

      // Orchestrator Runs section — toolbar always visible; runs list shown when logs exist
      '<div id="orchestrator-runs-wrapper">' +
        '<div class="card-title" style="margin-top:24px">Orchestrator Runs</div>' +
        '<div id="orch-toolbar" class="btn-group"></div>' +
        '<div id="orchestrator-runs-section"><p class="loading">Loading runs\u2026</p></div>' +
      '</div>';

    // Unarchive banner button handler
    var unarchiveBannerBtn = document.getElementById('unarchive-banner-btn');
    if (unarchiveBannerBtn) {
      unarchiveBannerBtn.addEventListener('click', function () {
        API.unarchiveProject(repo, slug).then(function () {
          renderProjectDetail(app, repo, slug);
        }).catch(function (err) {
          alert('Unarchive failed: ' + (err.message || String(err)));
        });
      });
    }

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
        API.analyzeProjectReset(repo, slug).then(function (diagnosis) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset Project';
          if (diagnosis.work_packages_needing_reset === 0) {
            if (meta.status === 'IN_PROGRESS') {
              showResetModal(repo, slug, diagnosis, { markComplete: true });
            } else {
              alert('All work packages are healthy — no reset needed.');
            }
            return;
          }
          showResetModal(repo, slug, diagnosis);
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
          API.renameProject(repo, slug, newTitle).then(function () {
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
          API.renameSlug(repo, currentSlug, newSlug).then(function () {
            window.location.hash = '#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(newSlug);
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
      API.getProjectHealth(repo, slug).then(function (health) {
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

    // Render the toolbar in its initial loading state immediately so buttons are
    // always visible while the async data loads.
    renderOrchToolbar(document.getElementById('orch-toolbar'), {
      loading: true, meta: meta, repo: repo, slug: slug, app: app,
    });

    // Orchestrator Runs — async, non-blocking
    // The toolbar is always visible; the runs list section is populated when logs exist.
    API.getRunLogs(repo, slug).then(function (logs) {
      var wrapperEl = document.getElementById('orchestrator-runs-wrapper');
      var runsEl    = document.getElementById('orchestrator-runs-section');
      var toolbarEl = document.getElementById('orch-toolbar');
      if (!wrapperEl || !runsEl) return;

      var hasLogs = Array.isArray(logs) && logs.length > 0;

      if (!hasLogs) {
        runsEl.innerHTML = '';
        // No runs yet — fetch runMeta anyway so the Resume button reflects
        // the correct disabled reason (e.g. "No interrupted run found").
        API.getRunMetadata(repo, slug).then(function (runMeta) {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: runMeta,
            meta: meta, repo: repo, slug: slug, app: app,
          });
        }).catch(function () {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: null,
            meta: meta, repo: repo, slug: slug, app: app,
          });
        });
        return;
      }

      // Sort most recent first — filename prefix (YYYYMMDDTHHmmss) is lexicographically
      // sortable, so a descending filename sort is equivalent to a descending date sort.
      var sorted = logs.slice().sort(function (a, b) {
        var aName = (a && a.filename) ? a.filename : String(a);
        var bName = (b && b.filename) ? b.filename : String(b);
        return bName.localeCompare(aName);
      });

      // Only the most recent run can be truly active.
      var activeItem     = (sorted.length > 0 && sorted[0] && sorted[0].is_active) ? sorted[0] : null;
      var activeFilename = activeItem ? (activeItem.filename || '') : null;

      // Render the full runs list; called with the matched queue entry (or null).
      // NOTE (refactor candidate): renderRunsList is a nested closure inside the getRunLogs().then()
      // callback to close over sorted, repo, slug, and activeFilename. A future pass could extract this as
      // a module-level helper accepting (sorted, repo, slug, activeFilename, matchingQueueEntry) to improve
      // testability and reduce closure depth.
      function renderRunsList(matchingQueueEntry) {
        // Drain any existing log preview cleanups before rebuilding the DOM.
        _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
        _pdLogPreviewCleanups = [];

        runsEl.innerHTML = sorted.map(function (item, index) {
          var filename = (item && item.filename) ? item.filename : String(item);
          var isActive = index === 0 && !!(item && item.is_active);
          var href = '#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/runs/' + encodeURIComponent(filename);
          var runNumber = sorted.length - index;

          var dateStr = (function () {
            var m = filename.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-/);
            if (!m) return '';
            var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
            var formatted = formatDate(iso);
            return formatted ? ' <span class="text-muted" style="font-size:11px">' + escapeHtml(formatted) + '</span>' : '';
          }());

          var badges = buildRunBadges(item, isActive);

          var rowHtml =
            '<div class="run-event run-event--info" style="display:flex;align-items:center;justify-content:space-between">' +
              '<span>' + badges + '<span style="font-size:13px">Run #' + runNumber + '</span>' + dateStr + '</span>' +
              '<a class="btn btn-secondary btn-sm" href="' + href + '">View</a>' +
            '</div>';

          if (isActive) {
            var statusCardHtml = matchingQueueEntry
              ? OrchestratorWidgets.renderStatusCard(matchingQueueEntry)
              : '';
            rowHtml +=
              '<div class="orch-active-run-section">' +
                statusCardHtml +
                '<div class="orch-log-preview" id="orch-project-log-preview"></div>' +
              '</div>';
          }

          return rowHtml;
        }).join('');

        // Start inline log preview for the active run.
        if (activeFilename) {
          var previewEl = document.getElementById('orch-project-log-preview');
          if (previewEl) {
            var cleanup = OrchestratorWidgets.renderLogPreview(previewEl, repo, slug, activeFilename);
            _pdLogPreviewCleanups.push(cleanup);
          }
        }
      }

      if (activeFilename) {
        // Active run: fetch the queue to find the matching entry, then render.
        // Polling refreshes the status card, log preview, and toolbar every 5 s.
        // Run metadata is fetched once — resume is always disabled while active anyway.
        var runMetaForToolbar = API.getRunMetadata(repo, slug).catch(function () { return null; });

        var pollQueue = function () {
          // Drain existing log previews before re-fetching.
          _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
          _pdLogPreviewCleanups = [];

          API.orchestratorGetQueue().then(function (queue) {
            var match = null;
            if (Array.isArray(queue)) {
              for (var i = 0; i < queue.length; i++) {
                if (queue[i] && queue[i].logFilename === activeFilename) {
                  match = queue[i];
                  break;
                }
              }
            }
            renderRunsList(match);
            // Update toolbar; runMetaForToolbar is cached after the first resolution.
            runMetaForToolbar.then(function (runMeta) {
              renderOrchToolbar(toolbarEl, {
                hasActiveRun: true,
                queueEntry:   match,
                runMeta:      runMeta,
                meta:         meta,
                repo:         repo,
                slug:         slug,
                app:          app,
                onKillDone:   function () {
                  // Re-poll after kill so both the runs list and toolbar reflect
                  // the new state immediately (without waiting for the next tick).
                  API.orchestratorGetQueue().then(function (q) {
                    var newMatch = null;
                    if (Array.isArray(q)) {
                      for (var i = 0; i < q.length; i++) {
                        if (q[i] && q[i].logFilename === activeFilename) { newMatch = q[i]; break; }
                      }
                    }
                    renderRunsList(newMatch);
                    runMetaForToolbar.then(function (rm) {
                      renderOrchToolbar(toolbarEl, {
                        hasActiveRun: true, queueEntry: newMatch, runMeta: rm,
                        meta: meta, repo: repo, slug: slug, app: app,
                        onKillDone: function () {},
                      });
                    });
                  }).catch(function () { renderRunsList(null); });
                },
              });
            });
          }).catch(function () {
            renderRunsList(null);
            renderOrchToolbar(toolbarEl, {
              hasActiveRun: true, queueEntry: null, runMeta: null,
              meta: meta, repo: repo, slug: slug, app: app,
            });
          });
        };

        pollQueue();
        Router._setPolling(pollQueue, 5000);
      } else {
        // No active run — render without queue interaction.
        renderRunsList(null);

        API.getRunMetadata(repo, slug).then(function (runMeta) {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: runMeta,
            meta: meta, repo: repo, slug: slug, app: app,
          });
        }).catch(function () {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: null,
            meta: meta, repo: repo, slug: slug, app: app,
          });
        });
      }
    }).catch(function () {
      // Silent failure — update toolbar to show correct disabled state.
      renderOrchToolbar(document.getElementById('orch-toolbar'), {
        hasActiveRun: false, queueEntry: null, runMeta: null,
        meta: meta, repo: repo, slug: slug, app: app,
      });
    });

  }).catch(function (err) {
    showError(app, 'Failed to load project: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   4c-ii. Reset Project Modal
   ---------------------------------------------------------- */
var PIPELINE_STAGES = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];

function showResetModal(repo, slug, diagnosis, options) {
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

  var markCompleteMode = !!(options && options.markComplete);

  function buildSummary() {
    if (markCompleteMode) {
      return '\u26A0 All non-cancelled WPs will be forced to COMPLETE \u2014 Project status \u2192 COMPLETE';
    }
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

  function stageBadge(stage, present, inactive) {
    var cls = inactive
      ? 'reset-stage-badge reset-stage-inactive'
      : (present ? 'reset-stage-badge reset-stage-present' : 'reset-stage-badge reset-stage-missing');
    return '<span class="' + cls + '">' + escapeHtml(stage) + '</span>';
  }

  function buildWpRow(wp) {
    var s = state[wp.work_package_id];
    var id = wp.work_package_id;
    var safeid = id.replace(/[^a-zA-Z0-9-]/g, '_');

    // Stage badges
    var presentSet = {};
    (wp.pipeline_stages_present || []).forEach(function (st) { presentSet[st] = true; });
    var activeSet = {};
    (wp.active_pipeline_stages || PIPELINE_STAGES).forEach(function (st) { activeSet[st] = true; });
    var stageBadges = PIPELINE_STAGES.map(function (st) {
      return stageBadge(st, !!presentSet[st], !activeSet[st]);
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
          (markCompleteMode
            ? 'All work packages are healthy. Click <strong>Mark as Complete</strong> to close out this project.'
            : 'Analysis found <strong>' + diagnosis.work_packages_needing_reset + '</strong> broken work package' +
              (diagnosis.work_packages_needing_reset !== 1 ? 's' : '') +
              ' out of <strong>' + wps.length + '</strong> total.') +
        '</div>' +
        '<div class="reset-bulk-controls">' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-broken">Reset All Broken</button> ' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-skip">Skip All</button> ' +
          '<button class="btn btn-warning btn-sm' + (markCompleteMode ? ' active' : '') + '" id="reset-mark-complete-btn">' + (markCompleteMode ? 'Cancel Override' : 'Mark All as Complete') + '</button>' +
        '</div>' +
        '<div class="reset-wp-list">' + wpRowsHtml + '</div>' +
        '<div class="reset-modal-footer">' +
          '<div class="reset-summary" id="reset-summary">' + buildSummary() + '</div>' +
          '<div class="reset-modal-actions">' +
            '<button class="btn btn-secondary" id="reset-cancel-btn">Cancel</button> ' +
            '<button class="btn btn-primary" id="reset-apply-btn">' + (markCompleteMode ? 'Mark as Complete' : 'Apply Reset') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  var overlay = document.getElementById('reset-modal-overlay');

  function updateSummary() {
    var el = document.getElementById('reset-summary');
    if (el) el.textContent = buildSummary();
    var applyBtn = document.getElementById('reset-apply-btn');
    if (markCompleteMode) {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Mark as Complete';
      }
      return;
    }
    // Enable/disable apply button based on reset/cancel actions
    var hasAction = Object.keys(state).some(function (id) {
      return state[id].action === 'reset' || state[id].action === 'cancel';
    });
    if (applyBtn) {
      applyBtn.disabled = !hasAction;
      applyBtn.textContent = 'Apply Reset';
    }
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

  document.getElementById('reset-mark-complete-btn').addEventListener('click', function () {
    markCompleteMode = !markCompleteMode;
    var btn = this;
    if (markCompleteMode) {
      btn.classList.add('active');
      btn.textContent = 'Cancel Override';
    } else {
      btn.classList.remove('active');
      btn.textContent = 'Mark All as Complete';
    }
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

    if (markCompleteMode) {
      applyBtn.textContent = 'Marking…';
      API.markProjectComplete(repo, slug).then(function () {
        closeModal();
        var toast = document.createElement('div');
        toast.className = 'success-banner';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
        toast.textContent = 'Project marked as complete.';
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 4000);
        var app = document.getElementById('app');
        if (app) renderProjectDetail(app, repo, slug);
      }).catch(function (err) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Mark as Complete';
        var toast = document.createElement('div');
        toast.className = 'error-banner';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
        toast.textContent = 'Mark complete failed: ' + (err.message || String(err));
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 5000);
      });
      return;
    }

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

    API.applyProjectReset(repo, slug, decisions).then(function (result) {
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
      if (app) renderProjectDetail(app, repo, slug);
    }).catch(function (err) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Reset';
      var toast = document.createElement('div');
      toast.className = 'error-banner';
      toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
      toast.textContent = 'Reset failed: ' + (err.message || String(err));
      document.body.appendChild(toast);
      setTimeout(function () { toast.remove(); }, 5000);
    });
  });

  updateSummary();
}
