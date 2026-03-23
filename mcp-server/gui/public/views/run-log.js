/* ============================================================
   views/run-log.js — Orchestrator Run Log Viewer
   Section 4e of the MCP Server Dashboard SPA

   Depends on: API, Router, escapeHtml, formatDate, showLoading, showError
   ============================================================ */

/* ----------------------------------------------------------
   Event card renderers
   ---------------------------------------------------------- */

/**
 * Returns a CSS severity class for an event action type.
 *
 * - error actions  → run-event--error
 * - warning-ish    → run-event--warning
 * - default        → run-event--info
 */
function runEventSeverity(action) {
  if (action === 'run_error') return 'run-event--error';
  return 'run-event--info';
}

/**
 * Builds the inner content HTML for a single event entry.
 * Handles known action types explicitly; falls back to a generic card.
 *
 * @param {object} entry - A parsed log entry object.
 * @returns {string} HTML string for the card body.
 */
function buildRunEventContent(entry) {
  var action = entry && entry.action ? String(entry.action) : 'unknown';

  switch (action) {
    case 'step_start':
    case 'step_end': {
      var stepName = entry.step_name ? escapeHtml(String(entry.step_name)) : '—';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + stepName;
    }
    case 'llm_call_start':
    case 'llm_call_end': {
      var model = entry.model ? escapeHtml(String(entry.model)) : '';
      return '<strong>' + escapeHtml(action) + '</strong>' + (model ? ' &mdash; <span class="text-muted">' + model + '</span>' : '');
    }
    case 'tool_call_start':
    case 'tool_call_end': {
      var toolName = entry.tool_name ? escapeHtml(String(entry.tool_name)) : '—';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + toolName;
    }
    case 'progress_snapshot': {
      // NOTE: appendEntries() intercepts progress_snapshot entries before calling
      // buildRunEventCard, so this branch is never reached during normal rendering.
      // The progress bar is updated in-place via direct DOM manipulation in appendEntries().
      var msg = entry.message ? escapeHtml(String(entry.message)) : '';
      return '<strong>Progress</strong>' + (msg ? ': ' + msg : '');
    }
    case 'run_start': {
      var runId = entry.run_id ? escapeHtml(String(entry.run_id)) : '';
      return '<strong>Run started</strong>' + (runId ? ' <span class="text-muted monospace">' + runId + '</span>' : '');
    }
    case 'run_end': {
      return '<strong>Run completed</strong>';
    }
    case 'run_error': {
      var errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown error';
      return '<strong>Run error:</strong> ' + errMsg;
    }
    default: {
      // Generic fallback — never throws, shows raw action + any message field
      var genericMsg = entry.message ? ': ' + escapeHtml(String(entry.message)) : '';
      return '<strong>' + escapeHtml(action) + '</strong>' + genericMsg;
    }
  }
}

/**
 * Builds the full HTML for a single run event card.
 *
 * @param {object} entry - A parsed log entry.
 * @returns {string} HTML string.
 */
function buildRunEventCard(entry) {
  var action = entry && entry.action ? String(entry.action) : 'unknown';
  var severityClass = runEventSeverity(action);

  // Stage badge — use entry.stage or entry.action as fallback label
  var stageLabel = entry.stage
    ? escapeHtml(String(entry.stage))
    : escapeHtml(action.replace(/_/g, ' '));
  var stageBadge = '<span class="run-stage-badge">' + stageLabel + '</span>';

  // Timestamp
  var ts = entry.timestamp ? escapeHtml(formatDate(String(entry.timestamp))) : '';

  return '<div class="run-event ' + severityClass + '">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      stageBadge +
      (ts ? '<span class="text-muted" style="font-size:11px">' + ts + '</span>' : '') +
    '</div>' +
    '<div>' + buildRunEventContent(entry) + '</div>' +
  '</div>';
}

/* ----------------------------------------------------------
   Main view
   ---------------------------------------------------------- */

/**
 * Renders the orchestrator run log viewer for a specific log file.
 *
 * Fetches all entries on load, then polls every 5 s for new entries using
 * the incremental `?after=N` parameter. Polling stops automatically when a
 * `run_end` or `run_error` entry is encountered.
 *
 * @param {HTMLElement} app    - The main content container.
 * @param {string}      slug   - Project slug.
 * @param {string}      filename - Log filename (e.g. "20260225T113355-my-project.jsonl").
 */
function renderRunLog(app, slug, filename) {
  showLoading(app);

  // Track how many lines we have seen (used as `afterLine` for incremental fetches)
  var totalLinesSeen = 0;

  // Whether polling should continue
  var pollingActive = true;

  /**
   * Builds the page skeleton (breadcrumb + progress bar + timeline container).
   * Called once on initial load; subsequent updates only touch inner elements.
   */
  function buildPageShell() {
    app.innerHTML =
      '<p class="breadcrumb">' +
        '<a href="#/">Projects</a> / ' +
        '<a href="#/projects/' + encodeURIComponent(slug) + '">' + escapeHtml(slug) + '</a> / ' +
        'Run Log' +
      '</p>' +
      '<div class="page-header"><h1 style="font-size:16px;font-weight:600">' +
        escapeHtml(filename) +
      '</h1></div>' +
      '<div id="run-progress-container" style="margin-bottom:16px;display:none">' +
        '<div class="run-progress-track">' +
          '<div class="run-progress-bar" id="run-progress-bar-fill" style="width:0%"></div>' +
        '</div>' +
      '</div>' +
      '<div id="run-event-timeline"></div>' +
      '<div id="run-status-message"></div>';
  }

  /**
   * Appends new event cards to the timeline. Updates progress bar in-place
   * for `progress_snapshot` entries instead of appending a card.
   *
   * @param {unknown[]} entries - New log entries to render.
   * @returns {boolean} True if a terminal event (run_end / run_error) was found.
   */
  function appendEntries(entries) {
    var timeline = document.getElementById('run-event-timeline');
    if (!timeline) return false;

    var terminal = false;
    entries.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var action = entry.action ? String(entry.action) : 'unknown';

      if (action === 'progress_snapshot') {
        // Update progress bar in-place (AC6: no full re-render)
        var pct = entry.progress_pct != null ? Math.min(100, Math.max(0, Number(entry.progress_pct))) : null;
        var container = document.getElementById('run-progress-container');
        var fill = document.getElementById('run-progress-bar-fill');
        if (container && pct !== null) {
          container.style.display = '';
          if (fill) fill.style.width = pct + '%';
        }
        return; // Don't append a card for progress_snapshot
      }

      // Append an event card
      timeline.insertAdjacentHTML('beforeend', buildRunEventCard(entry));

      if (action === 'run_end' || action === 'run_error') {
        terminal = true;
      }
    });

    return terminal;
  }

  /**
   * Fetches entries after `afterLine` and processes them.
   * Stops polling if a terminal event is encountered.
   *
   * @param {number} afterLine - Number of lines already seen.
   */
  function fetchAndAppend(afterLine) {
    API.getRunLogEntries(slug, filename, afterLine).then(function (result) {
      if (!result) return;
      var entries = Array.isArray(result.entries) ? result.entries : [];
      var newTotal = typeof result.totalLines === 'number' ? result.totalLines : totalLinesSeen;

      // Update cursor
      totalLinesSeen = newTotal;

      if (entries.length === 0) return;

      var isTerminal = appendEntries(entries);
      if (isTerminal && pollingActive) {
        pollingActive = false;
        Router._clearPolling();
        var statusEl = document.getElementById('run-status-message');
        if (statusEl) {
          statusEl.innerHTML = '<p class="text-muted" style="margin-top:8px;font-size:12px">\u2022 Run complete.</p>';
        }
      }
    }).catch(function (err) {
      // Non-fatal: log to stderr equivalent and continue polling
      var statusEl = document.getElementById('run-status-message');
      if (statusEl) {
        statusEl.innerHTML =
          '<p class="error-banner" style="margin-top:8px">Failed to fetch new entries: ' +
          escapeHtml((err && err.message) || String(err)) + '</p>';
      }
    });
  }

  // Initial load — fetch all entries
  API.getRunLogEntries(slug, filename).then(function (result) {
    if (!result) {
      showError(app, 'Failed to load run log: empty response');
      return;
    }

    buildPageShell();

    var entries = Array.isArray(result.entries) ? result.entries : [];
    totalLinesSeen = typeof result.totalLines === 'number' ? result.totalLines : 0;

    if (entries.length === 0) {
      var timeline = document.getElementById('run-event-timeline');
      if (timeline) timeline.innerHTML = '<p class="text-muted">No events yet.</p>';
    } else {
      var isTerminal = appendEntries(entries);
      if (isTerminal) {
        pollingActive = false;
        var statusEl = document.getElementById('run-status-message');
        if (statusEl) {
          statusEl.innerHTML = '<p class="text-muted" style="margin-top:8px;font-size:12px">\u2022 Run complete.</p>';
        }
      }
    }

    // Start polling only if the run is not already complete (AC4)
    if (pollingActive) {
      Router._setPolling(function () {
        if (!pollingActive) return;
        fetchAndAppend(totalLinesSeen);
      }, 5000);
    }

  }).catch(function (err) {
    showError(app, 'Failed to load run log: ' + ((err && err.message) || String(err)));
  });
}
