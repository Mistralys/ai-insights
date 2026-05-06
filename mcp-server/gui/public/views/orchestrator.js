/* ============================================================
   views/orchestrator.js — Orchestrator View
   MCP Server Dashboard SPA — Phase 5 (WP-011)

   Renders the top-level orchestrator view:
     Section A: plan path input + preflight + start
     Section B: live run queue table with polling
     Footer: CLI reference card

   Depends on: API (api-client.js), Router (router.js),
               OrchestratorWidgets (js/orchestrator-widgets.js),
               escapeHtml (utils.js)
   ============================================================ */

// Module-scoped log-preview cleanup registry.
// Each renderOrchestrator() call drains this array before creating new widgets.
var _orchLogPreviewCleanups = [];

/**
 * Top-level orchestrator view entry point.
 * Called by Router.dispatch() when the user navigates to #/orchestrator.
 *
 * @param {HTMLElement} app - The root #app container element.
 */
function renderOrchestrator(app) {
  // 1. Drain log preview cleanup callbacks from the previous render.
  _orchLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  _orchLogPreviewCleanups = [];

  // 2. Render the static skeleton.
  app.innerHTML =
    '<h1 class="section-title">Orchestrator</h1>' +

    '<section class="orch-section">' +
      '<h2 class="orch-section-title">Start New Run</h2>' +
      '<div class="orch-start-panel">' +
        '<div class="orch-plan-input-row">' +
          '<input type="text" id="orch-plan-path" class="orch-plan-input"' +
            ' placeholder="Absolute path to plan.md…" autocomplete="off">' +
          '<button type="button" id="orch-preflight-btn" class="btn btn-secondary">' +
            'Run Preflight' +
          '</button>' +
          '<button type="button" id="orch-start-btn" class="btn btn-primary" disabled>' +
            'Start Run' +
          '</button>' +
        '</div>' +
        '<div id="orch-preflight-results"></div>' +
      '</div>' +
    '</section>' +

    '<section class="orch-section">' +
      '<h2 class="orch-section-title">Run Queue</h2>' +
      '<div id="orch-queue-container"><p class="text-muted">Loading queue…</p></div>' +
    '</section>' +

    '<section class="orch-section orch-cli-section">' +
      OrchestratorWidgets.renderCliReference() +
    '</section>';

  // 3. Bind UI references.
  var preflightBtn = document.getElementById('orch-preflight-btn');
  var startBtn     = document.getElementById('orch-start-btn');
  var planInput    = document.getElementById('orch-plan-path');
  var resultsEl    = document.getElementById('orch-preflight-results');

  var allChecksPassed = false;

  // 4. Render preflight results checklist.
  function renderPreflightResults(checks) {
    if (!checks || !checks.length) {
      resultsEl.innerHTML = '';
      allChecksPassed = false;
      startBtn.disabled = true;
      return;
    }
    allChecksPassed = checks.every(function (c) { return c.pass; });
    startBtn.disabled = !allChecksPassed;
    if (!startBtn.disabled) startBtn.textContent = 'Start Run';

    var html = '<ul class="preflight-list">';
    checks.forEach(function (c) {
      var cls = c.pass ? 'preflight-pass' : 'preflight-fail';
      html += '<li class="preflight-check ' + cls + '">';
      html += '<span class="preflight-icon">' + (c.pass ? '✓' : '✗') + '</span>';
      html += ' <strong>' + escapeHtml(c.name) + '</strong>: ' + escapeHtml(c.detail);
      if (!c.pass && c.fix) {
        html += ' <span class="preflight-fix">Fix: <code>' + escapeHtml(c.fix) + '</code></span>';
      }
      html += '</li>';
    });
    html += '</ul>';
    resultsEl.innerHTML = html;
  }

  // 5. Preflight button handler.
  preflightBtn.addEventListener('click', function () {
    var planPath = planInput.value.trim();
    if (!planPath) { window.alert('Please enter a plan path.'); return; }

    preflightBtn.disabled = true;
    preflightBtn.textContent = 'Running…';
    resultsEl.innerHTML = '<p class="text-muted">Running preflight checks…</p>';
    allChecksPassed = false;
    startBtn.disabled = true;

    API.orchestratorStart(planPath, true).then(function (result) {
      renderPreflightResults((result && result.checks) ? result.checks : []);
    }).catch(function (err) {
      resultsEl.innerHTML = '<p class="error-banner">Preflight error: ' +
        escapeHtml((err && err.message) ? err.message : String(err)) + '</p>';
    }).then(function () {
      preflightBtn.disabled = false;
      preflightBtn.textContent = 'Run Preflight';
    });
  });

  // 6. Start Run button handler.
  startBtn.addEventListener('click', function () {
    var planPath = planInput.value.trim();
    if (!planPath || !allChecksPassed) return;

    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    API.orchestratorStart(planPath, false).then(function (result) {
      if (result && result.started) {
        var runStatusFilename = result.runStatusFilename || null;
        planInput.value = '';
        resultsEl.innerHTML =
          '<p class="success-banner">✓ Orchestrator launched' +
          (result.pid ? ' (PID\u00a0' + result.pid + ')' : '') +
          '. Waiting for the run to appear in the queue below…</p>';
        allChecksPassed = false;
        startBtn.disabled = true;
        refreshQueue();

        // Poll the run-status tombstone so we can surface fatal early
        // failures (e.g. invalid API key) that complete before the first
        // queue poll cycle.
        if (runStatusFilename) {
          var pollCount = 0;
          var MAX_STATUS_POLLS = 15; // 2s × 15 = 30s window
          var statusPollTimer = setInterval(function () {
            pollCount++;
            API.orchestratorGetRunStatus(runStatusFilename).then(function (status) {
              if (!status) return; // file not yet written — run still in progress
              clearInterval(statusPollTimer);
              if (status.result === 'ERROR' && status.error) {
                resultsEl.innerHTML =
                  '<p class="error-banner">Run failed: ' +
                  escapeHtml(status.error) + '</p>';
              }
              // SUCCESS: queue will reflect the project; leave the banner.
            }).catch(function () {
              // Transient error — keep polling.
            });
            if (pollCount >= MAX_STATUS_POLLS) {
              clearInterval(statusPollTimer);
            }
          }, 2000);
        }
      } else {
        // Checks re-evaluated by server — update the checklist.
        renderPreflightResults((result && result.checks) ? result.checks : []);
      }
    }).catch(function (err) {
      window.alert('Failed to start: ' + ((err && err.message) ? err.message : String(err)));
      startBtn.disabled = !allChecksPassed;
      startBtn.textContent = 'Start Run';
    }).then(function () {
      startBtn.textContent = 'Start Run';
    });
  });

  // 7. Queue refresh and rendering — tracks expanded row IDs across refreshes.
  var expandedIds = {};

  function refreshQueue() {
    // Stop log preview intervals started in the previous queue render.
    _orchLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
    _orchLogPreviewCleanups = [];

    var container = document.getElementById('orch-queue-container');
    if (!container) return;

    API.orchestratorGetQueue().then(function (entries) {
      renderQueueTable(container, Array.isArray(entries) ? entries : []);
    }).catch(function () {
      // Best-effort polling — keep existing content on transient errors.
    });
  }

  function renderQueueTable(container, entries) {
    if (!entries.length) {
      container.innerHTML = '<p class="text-muted orch-empty-queue">No active runs in the queue.</p>';
      return;
    }

    var html = '<table class="table orch-queue-table"><thead>' +
      '<tr><th></th><th>Plan</th><th>Status</th><th>Elapsed</th><th>Progress</th><th>Actions</th></tr>' +
      '</thead><tbody>';

    entries.forEach(function (entry) {
      var id       = entry.id || '';
      var status   = entry.effectiveStatus || 'pending';
      var planName = _orchBasename(entry.planPath || '');
      var elapsed  = _orchElapsed(entry.startedAt);
      var isExpanded = !!expandedIds[id];

      var statusBadgeHtml =
        '<span class="badge badge-' + escapeHtml(status) + '">' +
        escapeHtml(_orchStatusLabel(status)) + '</span>';

      // Progress cell: badge + text summary + optional log link.
      var progressHtml = OrchestratorWidgets.renderProgressBadge(entry.lastAction || null);
      if (entry.progress) {
        progressHtml += ' <span class="orch-progress-text">' + escapeHtml(entry.progress) + '</span>';
      }
      if (entry.logFilename && entry.expectedSlug) {
        progressHtml += ' <a href="#/projects/' +
          encodeURIComponent(entry.expectedSlug) + '/runs/' +
          encodeURIComponent(entry.logFilename) + '" class="orch-log-link">View Log →</a>';
      } else if (!entry.progress) {
        progressHtml += ' <span class="text-muted">Waiting for log…</span>';
      }

      html += '<tr class="orch-queue-row orch-row-' + escapeHtml(status) + '"' +
        ' data-entry-id="' + escapeHtml(id) + '">';

      html += '<td class="orch-toggle-cell">' +
        '<button type="button" class="orch-row-toggle btn-icon" data-entry-id="' + escapeHtml(id) + '">' +
        (isExpanded ? '▼' : '▶') + '</button></td>';

      html += '<td class="orch-plan-cell" title="' + escapeHtml(entry.planPath || '') + '">' +
        escapeHtml(planName) + '</td>';

      html += '<td class="orch-status-cell">' + statusBadgeHtml + '</td>';
      html += '<td class="orch-elapsed-cell">' + escapeHtml(elapsed) + '</td>';
      html += '<td class="orch-progress-cell">' + progressHtml + '</td>';
      html += '<td class="orch-actions-cell" data-actions-for="' + escapeHtml(id) + '"></td>';
      html += '</tr>';

      if (isExpanded) {
        html += '<tr class="orch-log-row" data-entry-id="' + escapeHtml(id) + '">' +
          '<td colspan="6">' +
          '<div class="orch-log-preview" id="orch-log-' + escapeHtml(id) + '"></div>' +
          '</td></tr>';
      }
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Inject DOM-based action buttons (can't be serialised to HTML strings).
    entries.forEach(function (entry) {
      var id     = entry.id || '';
      var status = entry.effectiveStatus || 'pending';
      var cell   = container.querySelector('[data-actions-for="' + id + '"]');
      if (!cell) return;

      if (status === 'pending') {
        cell.appendChild(OrchestratorWidgets.renderKillButton(id, function () {
          delete expandedIds[id];
          refreshQueue();
        }));
      } else if (status === 'started' && entry.expectedSlug) {
        var link = document.createElement('a');
        link.href = '#/projects/' + encodeURIComponent(entry.expectedSlug);
        link.className = 'btn btn-sm btn-secondary orch-project-link';
        link.textContent = 'View Project';
        cell.appendChild(link);
      } else if (status === 'dead') {
        cell.appendChild(OrchestratorWidgets.renderDismissButton(id, function () {
          delete expandedIds[id];
          refreshQueue();
        }));
      }
    });

    // Start log previews for expanded rows.
    entries.forEach(function (entry) {
      var id = entry.id || '';
      if (!expandedIds[id] || !entry.logFilename || !entry.expectedSlug) return;
      var previewEl = document.getElementById('orch-log-' + id);
      if (!previewEl) return;
      var cleanup = OrchestratorWidgets.renderLogPreview(
        previewEl,
        entry.expectedSlug,
        entry.logFilename,
      );
      _orchLogPreviewCleanups.push(cleanup);
    });

    // Attach expand/collapse toggle listeners.
    var toggleBtns = container.querySelectorAll('.orch-row-toggle');
    Array.prototype.forEach.call(toggleBtns, function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-entry-id');
        if (id) expandedIds[id] = !expandedIds[id];
        refreshQueue();
      });
    });
  }

  // 8. Kick off the first queue fetch and register the polling interval.
  refreshQueue();
  Router._setPolling(refreshQueue, 5000);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Returns the final path segment (filename or folder name). */
function _orchBasename(path) {
  var parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Human-readable label for an effectiveStatus value. */
function _orchStatusLabel(status) {
  if (status === 'started') return 'Started';
  if (status === 'dead')    return 'Dead';
  return 'Pending';
}

/** Formats elapsed time from an ISO start timestamp. */
function _orchElapsed(startedAt) {
  if (!startedAt) return '—';
  try {
    var diff = Date.now() - new Date(startedAt).getTime();
    if (isNaN(diff) || diff < 0) return '—';
    var secs = Math.round(diff / 1000);
    if (secs < 60)  return secs + 's';
    var mins = Math.floor(secs / 60);
    if (mins < 60)  return mins + 'm ' + (secs % 60) + 's';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  } catch (_) {
    return '—';
  }
}
