/* ============================================================
   views/project-detail.js — Project Detail view (main)
   Sections 4b–4d of the MCP Server Dashboard SPA
   Depends on: API, Router, marked, escapeHtml, formatDate,
               statusBadge, showLoading, showError,
               OrchestratorWidgets (js/orchestrator-widgets.js),
               UI (components.js)
   Sub-modules (must be loaded before this file):
               project-detail-helpers.js  — pure helpers
               project-detail-orch.js     — orchestrator section
               project-detail-modal.js    — Reset Project modal

   DOM Contract (patch functions — see §4c-i):
   The following element IDs and data attributes are written by
   renderProjectDetail() and read by the _patch* helpers on every
   poll cycle.  Any change to these anchors must be coordinated
   between both sites:

     #project-status-badge   — <span> wrapping the project status badge
                               in the page header (inner HTML is replaced
                               by _patchProjectStatus).
     #health-badge           — <span> for the project health badge
                               (textContent + className patched by
                               _patchHealthBadge).
     #synthesis-link-row     — <div> row containing the synthesis link;
                               always pre-rendered (display:none when not
                               ready) and toggled by _patchSynthesisLink.
     #timing-info            — Wrapper <span> for the three timing fields
                               below; _patchTimingInfo checks for its
                               presence before patching children.
       #timing-duration      — <span> showing elapsed project duration.
       #timing-active        — <span> showing total active pipeline time.
       #timing-runs          — <span> showing total pipeline-run count.
     tr[data-wp-id="WP-###"] — One <tr> per work package row; the
                               data-wp-id attribute is the stable lookup
                               key used by _patchWpRow.
       .wp-status-cell       — <td> inside the WP row holding the status
                               badge; replaced by _patchWpRow.
       .wp-pipeline-track-cell — <td> inside the WP row holding the
                               pipeline-track display; replaced by
                               _patchWpRow.
     #orch-status-card-container — <div> inside .orch-active-run-section
                               that wraps the OrchestratorWidgets status
                               card for the active run.  Its innerHTML is
                               replaced by _patchOrchStatusCard on every
                               data-only poll tick (WP-004).  The log
                               preview widget (#orch-project-log-preview)
                               is a sibling, not a child, so it survives
                               in-place status card updates intact.

   Scroll-anchor detection (renderRunsList):
   Before rebuilding runsEl.innerHTML, renderRunsList walks up the DOM
   from runsEl to find the nearest scrollable ancestor using
   window.getComputedStyle — specifically, the first ancestor whose
   computed overflowY is 'auto' or 'scroll'.  If no such ancestor is
   found, it falls back to document.documentElement.  The saved
   scrollTop is restored immediately after the innerHTML rebuild.

   jsdom limitation (test environment):
   window.getComputedStyle in jsdom always returns empty objects, so
   overflowY is always '' and the walk falls back to
   document.documentElement on every call.  Tests in
   project-detail-scroll.test.ts and project-detail-helpers.test.ts
   work around this by injecting a custom _getStyle stub or overriding
   Object.defineProperty on ancestor elements to control scrollTop
   via a data attribute (dataset['scrollTop']), allowing scroll-restore
   assertions to pass without a real CSS overflowY.  The walk logic
   itself is correct for browser environments where getComputedStyle
   returns real values.
   ============================================================ */

/**
 * Module-scoped log-preview cleanup registry.
 *
 * Callbacks returned by `OrchestratorWidgets.renderLogPreview` are pushed here
 * and drained at exactly two sites:
 *
 *   1. `renderRunsList` (project-detail-orch.js) — pre-innerHTML-rebuild drain.
 *      Called before the runs list DOM is replaced so that widgets attached to
 *      the old nodes are stopped before their container elements are discarded.
 *
 *   2. `renderProjectDetail` (this file) — pre-full-render drain.  Called at
 *      the very start of a new full-page render so that any cleanup left over
 *      from the previous route visit is released before fresh widgets are created.
 *
 * No other drain site should exist.  Both sites must use `.length = 0`
 * (in-place mutation) so that the local var and the `globalThis` reference
 * always point to the same array instance.
 */
var _pdLogPreviewCleanups = [];
globalThis._pdLogPreviewCleanups = _pdLogPreviewCleanups;

/* ----------------------------------------------------------
   4b. View: Plan Document
   ---------------------------------------------------------- */
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
      app.innerHTML = UI.banner('error', 'Failed to load plan document.');
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
      app.innerHTML = UI.banner('error', 'Failed to load synthesis document.');
    }
  }
}

/* ----------------------------------------------------------
   4c. View: Project Detail
   ---------------------------------------------------------- */

// renderOrchToolbar — extracted to project-detail-orch.js (WP-004)

/* ----------------------------------------------------------
   4c-i. DOM Patch Functions
   Targeted compare-and-swap helpers for in-place DOM updates.
   Each function performs fresh DOM queries on every invocation —
   no element references are cached across poll cycles.
   All functions are no-ops when the target element is not found.
   ---------------------------------------------------------- */

/**
 * Update the project status badge in the page header.
 * @param {string} newStatus - New WP status string (e.g. 'IN_PROGRESS', 'COMPLETE').
 */
function _patchProjectStatus(newStatus) {
  var container = document.getElementById('project-status-badge');
  if (!container) return;
  var newHtml = statusBadge(newStatus);
  if (container.innerHTML !== newHtml) {
    container.innerHTML = newHtml;
  }
}

/**
 * Update a single WP row's status badge and pipeline track cells in-place.
 * Leaves the WP ID and assigned-to cells untouched.
 * @param {string} wpId             - Work package ID (e.g. 'WP-001').
 * @param {string} newStatus        - New WP status string.
 * @param {string} newPipelineTrack - New pipeline track HTML (from buildPipelineTrack).
 */
function _patchWpRow(wpId, newStatus, newPipelineTrack) {
  var row = document.querySelector('tr[data-wp-id="' + escapeHtml(wpId) + '"]');
  if (!row) return;

  var statusCell = row.querySelector('.wp-status-cell');
  if (statusCell) {
    var newStatusHtml = statusBadge(newStatus);
    if (statusCell.innerHTML !== newStatusHtml) {
      statusCell.innerHTML = newStatusHtml;
    }
  }

  var pipelineCell = row.querySelector('.wp-pipeline-track-cell');
  if (pipelineCell) {
    if (pipelineCell.innerHTML !== newPipelineTrack) {
      pipelineCell.innerHTML = newPipelineTrack;
    }
  }
}

/**
 * Show or hide the synthesis link row.
 *
 * Pre-render contract: `#synthesis-link-row` is always present in the DOM after
 * `renderProjectDetail` completes. This function only toggles its visibility and,
 * when shown, ensures the link href is populated (defensive guard for an empty
 * pre-rendered row).
 *
 * When visible=true the row is shown; when visible=false it is hidden.
 *
 * @param {boolean} visible - Whether the synthesis link should be visible.
 * @param {string}  [repo]  - Repository name (used to populate the link href when absent).
 * @param {string}  [slug]  - Project slug (used to populate the link href when absent).
 */
function _patchSynthesisLink(visible, repo, slug) {
  var row = document.getElementById('synthesis-link-row');
  if (visible) {
    if (row) {
      // Empty-div pre-render path: when `synthesis_generated` is `false`,
      // `renderProjectDetail` writes `#synthesis-link-row` as a bare hidden
      // `<div>` with no `.synthesis-link` anchor inside it.  When a poll
      // cycle detects that synthesis became available and calls
      // `_patchSynthesisLink(true, repo, slug)`, this guard fires and
      // populates the anchor before making the row visible.  Without the
      // guard a second patch call would overwrite an already-populated anchor,
      // causing a redundant DOM mutation.
      if (!row.querySelector('.synthesis-link') && repo && slug) {
        row.className = 'synthesis-link-row';
        row.innerHTML = '<a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/synthesis" class="synthesis-link">View synthesis \u2192</a>';
      }
      row.style.display = '';
    }
  } else {
    if (row) {
      row.style.display = 'none';
    }
  }
}

/**
 * Update the health badge text and CSS class.
 * @param {{ work_packages_needing_reset: number }} health - Health data object.
 */
function _patchHealthBadge(health) {
  var badge = document.getElementById('health-badge');
  if (!badge) return;
  if (health.work_packages_needing_reset === 0) {
    var newText = '\u2713 All pipelines complete';
    var newClass = 'health-badge healthy';
    if (badge.textContent !== newText) badge.textContent = newText;
    if (badge.className !== newClass) badge.className = newClass;
  } else {
    var count = health.work_packages_needing_reset;
    var newText2 = '\u26a0 ' + count + ' WP' + (count === 1 ? '' : 's') + ' need attention';
    var newClass2 = 'health-badge attention';
    if (badge.textContent !== newText2) badge.textContent = newText2;
    if (badge.className !== newClass2) badge.className = newClass2;
  }
}

// _patchOrchStatusCard — extracted to project-detail-orch.js (WP-004)
// _orchRunsStructureKey — extracted to project-detail-orch.js (WP-004)
// _findScrollAnchor     — extracted to project-detail-helpers.js (WP-004)

/**
 * Update the timing info display in-place.
 * @param {{ project_elapsed_ms: number, total_active_ms: number, pipeline_runs: number }} timing
 */
function _patchTimingInfo(timing) {
  var container = document.getElementById('timing-info');
  if (!container) return;
  if (!timing) return;

  var durationEl = document.getElementById('timing-duration');
  if (durationEl) {
    var newDuration = formatDuration(timing.project_elapsed_ms);
    if (durationEl.textContent !== newDuration) durationEl.textContent = newDuration;
  }

  var activeEl = document.getElementById('timing-active');
  if (activeEl) {
    var newActive = formatDuration(timing.total_active_ms);
    if (activeEl.textContent !== newActive) activeEl.textContent = newActive;
  }

  var runsEl = document.getElementById('timing-runs');
  if (runsEl) {
    var newRuns = String(timing.pipeline_runs);
    if (runsEl.textContent !== newRuns) runsEl.textContent = newRuns;
  }
}

// _snapshotProjectState — extracted to project-detail-helpers.js (WP-004)
// _diffProjectState     — extracted to project-detail-helpers.js (WP-004)

/* ----------------------------------------------------------
   4c-iv. Combined Poll Function
   Fetches project data and work-package overview each cycle,
   compares against the previous snapshot, and either patches
   the DOM in-place (data-only changes) or triggers a full
   re-render (structural changes).

   Parameters:
     app           — root element passed to renderProjectDetail
     repo          — repository name
     slug          — project slug
     pollStateRef  — single-element array [snapshot] so the poll
                     function can read and write the last state
                     without a module-scoped variable
     pollController — the owning pollController object; used to
                     call stopPolling() before a structural
                     re-render so no competing interval remains
   ---------------------------------------------------------- */
/**
 * @param {Element}  app
 * @param {string}   repo
 * @param {string}   slug
 * @param {Array}    pollStateRef  — [lastSnapshot]; mutated in place
 * @param {object}   pollController
 */
function _pollProjectDetail(app, repo, slug, pollStateRef, pollController) {
  // Guard: skip DOM patching when a modal is open or inline edit is active.
  var modalOpen  = !!document.getElementById('reset-modal-overlay');
  var editActive = !!(document.querySelector('.title-edit-input') ||
                      document.querySelector('.slug-edit-input'));

  Promise.all([
    API.getProject(repo, slug),
    API.getWorkPackageOverview(repo, slug).catch(function () { return null; }),
    API.getProjectHealth(repo, slug).catch(function () { return null; }),
  ]).then(function (results) {
    var project        = results[0];
    var overviewResult = results[1];
    var health         = results[2];

    // Build next snapshot; populate health field from parallel fetch.
    var nextSnapshot = _snapshotProjectState(project, overviewResult);
    nextSnapshot.health = health;

    var lastSnapshot = pollStateRef[0];
    var diff = _diffProjectState(lastSnapshot, nextSnapshot);

    // Always update the stored snapshot so the next cycle diffs correctly.
    pollStateRef[0] = nextSnapshot;

    if (diff.type === 'none') return;

    if (diff.type === 'structural') {
      // Stop the combined poll before triggering a full re-render so that
      // the new renderProjectDetail call can register a fresh combined interval.
      // Log-preview cleanups are drained inside renderProjectDetail itself.
      pollController.stopPolling();
      renderProjectDetail(app, repo, slug);
      return;
    }

    // data-only — apply targeted patches; skip if interactive state is active.
    if (modalOpen || editActive) return;

    var changes = diff.changes || {};

    // Project status badge
    if (changes.status) {
      _patchProjectStatus(nextSnapshot.status);
    }

    // Per-WP status and pipeline stages
    var wpIds = Object.keys(nextSnapshot.wpStatuses || {});
    wpIds.forEach(function (id) {
      var statusChanged   = !!changes['wp.' + id + '.status'];
      var pipelineChanged = !!changes['wp.' + id + '.pipelineStages'];
      if (statusChanged || pipelineChanged) {
        var wpEntry = nextSnapshot.wpStatuses[id];
        // Re-build the pipeline track HTML from the new stages array.
        var fakeOverviewEntry = { pipeline_stages: wpEntry.pipelineStages };
        var newTrackHtml = buildPipelineTrack(fakeOverviewEntry);
        _patchWpRow(id, wpEntry.status, newTrackHtml);
      }
    });

    // Synthesis link
    if (changes.synthesis_generated) {
      _patchSynthesisLink(nextSnapshot.synthesis_generated, repo, slug);
    }

    // Health badge
    if (changes.health && nextSnapshot.health) {
      _patchHealthBadge(nextSnapshot.health);
    }

    // Timing (last_updated changed — fetch fresh timing via project object)
    if (changes.last_updated && project && project.timing) {
      _patchTimingInfo(project.timing);
    }
  }).catch(function () {
    // Silent failure — keep polling with the existing snapshot.
  });
}

// renderRunsList — extracted to project-detail-orch.js (WP-004)

function renderProjectDetail(app, repo, slug) {
  // Drain log preview cleanup callbacks from the previous render.
  globalThis._pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  globalThis._pdLogPreviewCleanups.length = 0;

  // ── pollController ─────────────────────────────────────────────────────
  // Render-scoped polling state machine.  Two modes:
  //   'combined'  — 5s cadence, polls project data + orchestrator queue.
  //   'resume'    — 3s cadence, polls orchestrator queue until a new active
  //                 entry appears after a Resume button click.
  //
  // Only one interval is ever active at a time (Router._setPolling
  // supports a single interval per view).  Ownership: renderProjectDetail
  // creates pollController; renderOrchToolbar receives it as an argument
  // and emits lifecycle signals via startResumePolling / settleResumePolling
  // instead of calling Router._setPolling directly.
  //
  // pollStateRef is a single-element array so that _pollProjectDetail can
  // read and overwrite the last snapshot without a module-scoped variable.
  var detailPollState = { ref: [null] }; // ref[0] = last snapshot or null
  var _mode = 'combined';

  var pollController = {
    getMode: function () { return _mode; },

    /**
     * Register the combined 5s project-data poll.
     * Clears any existing interval before registering the new one.
     *
     * @param {object} [opts]
     * @param {Function} [opts.orchPollFn] — optional extra function called on
     *   each tick to refresh the orchestrator queue / toolbar when an active
     *   run is present.  When absent, only project data is polled.
     */
    startCombinedPolling: function (opts) {
      _mode = 'combined';
      var orchPollFn = opts && typeof opts.orchPollFn === 'function' ? opts.orchPollFn : null;
      var self = this;
      Router._setPolling(function () {
        _pollProjectDetail(app, repo, slug, detailPollState.ref, self);
        if (orchPollFn) orchPollFn();
      }, 5000);
    },

    /**
     * Switch to resume mode: clear the combined interval and register a
     * 3s poll using the provided resume function.
     * @param {{ pollFn: Function }} ctx
     */
    startResumePolling: function (ctx) {
      _mode = 'resume';
      Router._setPolling(ctx.pollFn, 3000);
    },

    /**
     * Settle the resume poll: the active run has been detected.
     * Stop resume polling and trigger a full re-render so the page
     * reflects the newly active run (this also re-registers combined polling).
     *
     * NOTE — calling this method triggers a full renderProjectDetail re-render,
     * which creates a brand-new pollController closure. The calling context's
     * reference to this pollController object is effectively invalidated after
     * settleResumePolling returns; do not call any other pollController methods
     * on it afterward.
     *
     * @param {{ app: Element, repo: string, slug: string }} ctx
     */
    settleResumePolling: function (ctx) {
      _mode = 'combined';
      Router._clearPolling();
      if (ctx && ctx.app) renderProjectDetail(ctx.app, ctx.repo, ctx.slug);
    },

    /**
     * Stop all polling (called before a structural re-render triggered
     * from within the poll function, so the new renderProjectDetail call
     * can register a fresh combined interval).
     */
    stopPolling: function () {
      Router._clearPolling();
    },
  };

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
      return '<tr class="clickable" data-href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '" data-wp-id="' + escapeHtml(wp.work_package_id) + '">' +
        '<td class="monospace"><a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' + escapeHtml(wp.work_package_id) + '</a></td>' +
        '<td class="wp-pipeline-track-cell">' + pipelineCell + '</td>' +
        '<td>' + escapeHtml(wp.assigned_to || '—') + '</td>' +
        '<td class="wp-status-cell">' + statusBadge(wp.status) + '</td>' +
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
        '<span id="project-status-badge">' + statusBadge(meta.status) + '</span>' +
        '<span id="health-badge" class="health-badge">Checking\u2026</span>' +
        '<button class="btn btn-secondary btn-sm" id="reset-project-btn">Reset Project</button>' +
      '</div>' +
      UI.card(null,
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Slug:</strong> <span class="monospace" id="project-slug-value">' + escapeHtml(slug) + '</span>' +
          '<button class="edit-slug-btn" id="edit-slug-btn" title="Rename slug">✎</button><br>' +
          '<strong>Plan path:</strong> <span class="monospace">' + escapeHtml(meta.plan_path || '—') + '</span><br>' +
          '<strong>Created:</strong> ' + escapeHtml(formatDate(meta.date_created)) + ' &nbsp; ' +
          '<strong>Updated:</strong> ' + escapeHtml(formatDate(meta.last_updated)) +
          '<span id="timing-info">' +
          (project.timing
            ? '<br><strong>Duration:</strong> <span id="timing-duration">' + escapeHtml(formatDuration(project.timing.project_elapsed_ms)) + '</span>' +
                (project.timing.pipeline_runs > 0
                  ? ' &nbsp;\u00b7&nbsp; <strong>Active:</strong> <span id="timing-active">' + escapeHtml(formatDuration(project.timing.total_active_ms)) + '</span> across <span id="timing-runs">' + project.timing.pipeline_runs + '</span> pipeline runs'
                  : '')
            : '') +
          '</span>' +
          (project.server_version ? '<br><strong>Server version:</strong> <span class="monospace">v' + escapeHtml(project.server_version) + '</span>' : '') +
          (project.ledger_version ? ' &nbsp; <strong>Spec version:</strong> <span class="monospace">v' + escapeHtml(project.ledger_version) + '</span>' : '') +
        '</div>'
      ) +

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
        if (!project.synthesis_generated) return '<div id="synthesis-link-row" style="display:none"></div>';
        return '<div id="synthesis-link-row" class="synthesis-link-row">' +
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

    // ── Initial poll state snapshot ─────────────────────────────────────
    // Build the baseline state from the data already fetched above.
    // health starts as null and is populated asynchronously; the combined
    // poll will capture it on the first tick after the health request settles.
    var initialSnapshot = _snapshotProjectState(project, overviewResult);
    detailPollState.ref[0] = initialSnapshot;

    // Register the combined 5s poll now that the page is rendered.
    // This replaces the previous per-section pollQueue registration so
    // that exactly one interval is active for the duration of this view.
    pollController.startCombinedPolling();

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
        _patchHealthBadge(health);
      }).catch(function () {
        // Silent failure — remove badge without blocking page
        if (healthBadge.parentNode) healthBadge.parentNode.removeChild(healthBadge);
      });
    }

    // Render the toolbar in its initial loading state immediately so buttons are
    // always visible while the async data loads.
    renderOrchToolbar(document.getElementById('orch-toolbar'), {
      loading: true, meta: meta, repo: repo, slug: slug, app: app,
      pollController: pollController,
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
            pollController: pollController,
          });
        }).catch(function () {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: null,
            meta: meta, repo: repo, slug: slug, app: app,
            pollController: pollController,
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


      if (activeFilename) {
        // Active run: fetch the queue to find the matching entry, then render.
        // Polling refreshes the status card, log preview, and toolbar every 5 s.
        // Run metadata is fetched once — resume is always disabled while active anyway.
        var runMetaForToolbar = API.getRunMetadata(repo, slug).catch(function () { return null; });

        // Stable structure key for the last rendered runs list.
        // Initialised to null so the first pollQueue tick always falls through
        // to the full renderRunsList path (the DOM doesn't exist yet at that
        // point — no #orch-status-card-container is present to patch).
        // After the first full render the key is set to the rendered structure,
        // so subsequent ticks with the same structure use the in-place patch path.
        var lastRunsStructureKey = null;

        var pollQueue = function () {
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

            // Determine the current structure key.
            // When the queue entry is gone (match is null), treat the run as
            // inactive — the active badge and status card should disappear.
            // This covers both normal completion and kill scenarios.
            var currentStructureKey = _orchRunsStructureKey(
              sorted,
              match !== null ? activeFilename : null
            );

            if (currentStructureKey === lastRunsStructureKey) {
              // ── Data-only update: patch the status card in-place ──────────────
              // Log preview widgets are NOT drained here — they survive intact.
              _patchOrchStatusCard(match);
            } else {
              // ── Structural change: full rebuild with scroll preservation ──────
              renderRunsList(runsEl, sorted, repo, slug, activeFilename, match);
              lastRunsStructureKey = currentStructureKey;
            }

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
                pollController: pollController,
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
                    // After a kill the run leaves the queue — treat as structural.
                    renderRunsList(runsEl, sorted, repo, slug, activeFilename, newMatch);
                    lastRunsStructureKey = _orchRunsStructureKey(sorted, null);
                    runMetaForToolbar.then(function (rm) {
                      renderOrchToolbar(toolbarEl, {
                        hasActiveRun: true, queueEntry: newMatch, runMeta: rm,
                        meta: meta, repo: repo, slug: slug, app: app,
                        pollController: pollController,
                        onKillDone: function () {},
                      });
                    });
                  }).catch(function () {
                    renderRunsList(runsEl, sorted, repo, slug, activeFilename, null);
                    lastRunsStructureKey = _orchRunsStructureKey(sorted, null);
                  });
                },
              });
            });
          }).catch(function () {
            // On error fall back to a full rebuild (clears stale state).
            renderRunsList(runsEl, sorted, repo, slug, activeFilename, null);
            lastRunsStructureKey = _orchRunsStructureKey(sorted, null);
            renderOrchToolbar(toolbarEl, {
              hasActiveRun: true, queueEntry: null, runMeta: null,
              meta: meta, repo: repo, slug: slug, app: app,
              pollController: pollController,
            });
          });
        };

        // Initial poll tick.
        pollQueue();
        // Upgrade the combined poll to also refresh the orchestrator queue each tick.
        // This replaces the plain _pollProjectDetail-only interval registered after
        // the initial render, adding the orchestrator queue refresh to the same 5s cadence.
        pollController.startCombinedPolling({ orchPollFn: pollQueue });
      } else {
        // No active run — render without queue interaction.
        // The combined poll (project data only) was already registered after the
        // initial render; no additional interval needed here.
        renderRunsList(runsEl, sorted, repo, slug, null, null);

        API.getRunMetadata(repo, slug).then(function (runMeta) {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: runMeta,
            meta: meta, repo: repo, slug: slug, app: app,
            pollController: pollController,
          });
        }).catch(function () {
          renderOrchToolbar(toolbarEl, {
            hasActiveRun: false, queueEntry: null, runMeta: null,
            meta: meta, repo: repo, slug: slug, app: app,
            pollController: pollController,
          });
        });
      }
    }).catch(function () {
      // Silent failure — update toolbar to show correct disabled state.
      renderOrchToolbar(document.getElementById('orch-toolbar'), {
        hasActiveRun: false, queueEntry: null, runMeta: null,
        meta: meta, repo: repo, slug: slug, app: app,
        pollController: pollController,
      });
    });

  }).catch(function (err) {
    showError(app, 'Failed to load project: ' + (err.message || String(err)));
  });
}

// PIPELINE_STAGES — extracted to project-detail-modal.js (WP-004)
// showResetModal  — extracted to project-detail-modal.js (WP-004)

