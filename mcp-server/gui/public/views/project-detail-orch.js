/* ============================================================
   views/project-detail-orch.js — Project Detail: orchestrator section
   Sub-module of views/project-detail.js (WP-004 decomposition).
   Depends on: project-detail-helpers.js (must be loaded first),
               OrchestratorWidgets (js/orchestrator-widgets.js),
               Router (router.js), escapeHtml, formatDate (utils.js),
               UI (components.js)

   Shared state: globalThis._pdLogPreviewCleanups
     The log-preview cleanup registry is owned by project-detail.js
     (main) but promoted to globalThis so this module can drain and
     push into the same array instance.  All reads/writes in this
     file use globalThis._pdLogPreviewCleanups so that the in-place
     drain semantics (.length = 0) work correctly across module
     boundaries.

   Exports:
     renderOrchToolbar, renderRunsList,
     _orchRunsStructureKey, _patchOrchStatusCard
   ============================================================ */

/* ----------------------------------------------------------
   Orchestrator Toolbar
   Renders Kill + Resume buttons into toolbarEl.
   Always visible; buttons are disabled (with explanatory
   tooltips) when the corresponding action is unavailable.

   opts: {
     loading:        bool,           — show "Loading…" disabled state
     hasActiveRun:   bool,           — is there an active run?
     queueEntry:     object|null,    — matching queue entry (kill)
     runMeta:        object|null,    — run metadata (resume)
     meta:           object,         — project meta (plan_path, status)
     repo:           string,
     slug:           string,
     app:            Element,        — root element (re-render after resume)
     onKillDone:     Function,       — called after a successful kill
     pollController: object|null,    — owning pollController from renderProjectDetail
   }
   ---------------------------------------------------------- */
function renderOrchToolbar(toolbarEl, opts) {
  if (!toolbarEl) return;
  toolbarEl.innerHTML = '';

  var loading         = !!opts.loading;
  var hasActiveRun    = !!opts.hasActiveRun;
  var queueEntry      = opts.queueEntry      || null;
  var runMeta         = opts.runMeta         || null;
  var meta            = opts.meta            || {};
  var repo            = opts.repo            || '';
  var slug            = opts.slug            || '';
  var app             = opts.app             || null;
  var onKillDone      = typeof opts.onKillDone === 'function' ? opts.onKillDone : null;
  var pollController  = opts.pollController  || null;

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
                // Settle the resume poll: the run is now active, so hand back
                // to the combined poll (or trigger a full re-render if no
                // pollController is present — legacy fallback).
                if (pollController) {
                  pollController.settleResumePolling({ app: app, repo: repo, slug: slug });
                } else {
                  Router._clearPolling();
                  if (app) renderProjectDetail(app, repo, slug);
                }
              }
            }).catch(function () { /* keep polling */ });
          };
          // Switch to resume mode: clears combined interval, starts 3s resume poll.
          if (pollController) {
            pollController.startResumePolling({ pollFn: pollResume });
          } else {
            Router._setPolling(pollResume, 3000);
          }
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

/**
 * Update the orchestrator active-run status card in-place.
 *
 * Replaces the innerHTML of `#orch-status-card-container` without touching
 * the rest of the runs list or the log-preview widget.  This is the
 * "data-only" update path for the active run — no DOM nodes outside the
 * container are disturbed, so log preview widgets and all other run-event
 * handlers survive intact.
 *
 * @param {object|null} matchingQueueEntry - Current queue entry for the active run
 *   (or null when the run has left the queue).
 */
function _patchOrchStatusCard(matchingQueueEntry) {
  var container = document.getElementById('orch-status-card-container');
  if (!container) return;
  var newHtml = matchingQueueEntry
    ? OrchestratorWidgets.renderStatusCard(matchingQueueEntry)
    : '';
  if (container.innerHTML !== newHtml) {
    container.innerHTML = newHtml;
  }
}

/**
 * Compute a stable structure key for the orchestrator runs list.
 *
 * The key encodes the set of run filenames and which filename (if any) is
 * currently active.  Two consecutive poll results that produce the same key
 * have the same list structure and can be updated via in-place DOM patching
 * rather than a full innerHTML rebuild.
 *
 * @param {Array}  sorted        - Sorted run-log items (most-recent first).
 * @param {string|null} activeFilename - Filename of the active run, or null.
 * @returns {string} Opaque structure key.
 */
function _orchRunsStructureKey(sorted, activeFilename) {
  var names = (Array.isArray(sorted) ? sorted : []).map(function (item) {
    return (item && item.filename) ? item.filename : String(item);
  });
  return JSON.stringify({ names: names, active: activeFilename || null });
}

/**
 * Rebuild the orchestrator runs list HTML in-place, preserving scroll position.
 *
 * Drains globalThis._pdLogPreviewCleanups before rebuilding runsEl.innerHTML,
 * then restores the scrollTop of the nearest scrollable ancestor (via
 * _findScrollAnchor). After the rebuild, starts a log preview widget for
 * the active run when activeFilename is non-null.
 *
 * @param {Element}      runsEl             - The runs list container element.
 * @param {Array}        sorted             - Sorted run-log items (most-recent first).
 * @param {string}       repo               - Repository name.
 * @param {string}       slug               - Project slug.
 * @param {string|null}  activeFilename     - Filename of the active run, or null.
 * @param {object|null}  matchingQueueEntry - Current queue entry for the active run, or null.
 */
function renderRunsList(runsEl, sorted, repo, slug, activeFilename, matchingQueueEntry) {
  // Drain log-preview cleanup callbacks before rebuilding the DOM.
  globalThis._pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  globalThis._pdLogPreviewCleanups.length = 0;

  // Save scroll position before rebuilding so it can be restored after.
  var scrollAnchor = _findScrollAnchor(runsEl);
  var savedScrollTop = scrollAnchor.scrollTop;

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
          '<div id="orch-status-card-container">' + statusCardHtml + '</div>' +
          '<div class="orch-log-preview" id="orch-project-log-preview"></div>' +
        '</div>';
    }

    return rowHtml;
  }).join('');

  // Restore scroll position after the innerHTML rebuild.
  // _findScrollAnchor always returns a non-null Element (falls back to
  // document.documentElement), so no null guard is needed here.
  scrollAnchor.scrollTop = savedScrollTop;

  // Start inline log preview for the active run.
  if (activeFilename) {
    var previewEl = document.getElementById('orch-project-log-preview');
    if (previewEl) {
      var cleanup = OrchestratorWidgets.renderLogPreview(previewEl, repo, slug, activeFilename);
      if (cleanup) { globalThis._pdLogPreviewCleanups.push(cleanup); }
    }
  }
}

/* ----------------------------------------------------------
   Test / global access
   ---------------------------------------------------------- */
globalThis.renderRunsList = renderRunsList;
