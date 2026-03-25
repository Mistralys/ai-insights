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
 * - error / fail actions → run-event--error
 * - warning-ish          → run-event--warning
 * - success outcomes     → run-event--success
 * - default              → run-event--info
 */
function runEventSeverity(action) {
  if (action === 'run_error' || action === 'stage_error' || action === 'halted_repeated_failure') return 'run-event--error';
  if (action === 'safety_limit' || action === 'rework_detected' || action === 'mcp_error' || action === 'dry_run_no_ledger') return 'run-event--warning';
  if (action === 'wp_complete' || action === 'run_end' || action === 'dry_run_complete') return 'run-event--success';
  return 'run-event--info';
}

/**
 * Formats a duration in seconds to a human-readable string.
 * @param {number|null|undefined} sec - Duration in seconds.
 * @returns {string} Formatted string (e.g. "3m 24s") or empty string.
 */
function formatDurationSec(sec) {
  if (sec == null || isNaN(sec)) return '';
  return formatDuration(sec * 1000);
}

/**
 * Formats a token count to a compact human-readable string (e.g. "72k").
 * @param {object|number|null} tokens - Token usage object or raw number.
 * @returns {string} Formatted string or empty string.
 */
function formatTokens(tokens) {
  if (tokens == null) return '';
  var total = typeof tokens === 'number' ? tokens : (tokens.total_tokens || 0);
  if (!total) return '';
  if (total >= 1000) return Math.round(total / 1000) + 'k tokens';
  return total + ' tokens';
}

/**
 * Builds the inner content HTML for a single event entry.
 * Handles known action types explicitly; falls back to a generic card.
 *
 * @param {object} entry - A parsed log entry object.
 * @returns {string} HTML string for the card body.
 */
function buildRunEventContent(entry) {
  const action = entry && entry.action ? String(entry.action) : 'unknown';

  switch (action) {

    // ── Orchestrator lifecycle ───────────────────────────────────────
    case 'run_start': {
      const threadId = entry.thread_id ? escapeHtml(String(entry.thread_id)) : '';
      const plan = entry.plan ? String(entry.plan) : '';
      // Show just the plan filename, not the full path
      const planName = plan ? escapeHtml(plan.split('/').pop() || plan) : '';
      const dryRunBadge = entry.dry_run ? ' <span class="badge badge-dry-run">Dry Run</span>' : '';
      let html = '<strong>Run started</strong>' + dryRunBadge;
      if (planName) html += ' &mdash; ' + planName;
      if (threadId) html += '<br><span class="text-muted monospace" style="font-size:11px">Thread: ' + threadId + '</span>';
      return html;
    }
    case 'run_end': {
      const dur = entry.total_duration_s != null ? formatDurationSec(entry.total_duration_s) : '';
      return '<strong>Run completed</strong>' + (dur ? ' <span class="text-muted">(' + escapeHtml(dur) + ')</span>' : '');
    }
    case 'run_error': {
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown error';
      return '<strong>Run error:</strong> ' + errMsg;
    }

    // ── Stage events ─────────────────────────────────────────────────
    case 'stage_start': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const stg = entry.stage ? escapeHtml(String(entry.stage).replace(/_/g, ' ')) : '';
      const iter = entry.iteration ? ' <span class="text-muted">(iteration ' + escapeHtml(String(entry.iteration)) + ')</span>' : '';
      return '<strong>Stage started</strong>' +
        (stg ? ' &mdash; <em>' + stg + '</em>' : '') +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        iter;
    }
    case 'stage_complete': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const result = entry.result ? escapeHtml(String(entry.result)) : '';
      const dur = formatDurationSec(entry.duration_s);
      const tok = formatTokens(entry.tokens_used);
      const details = [];
      if (dur) details.push(dur);
      if (tok) details.push(tok);
      const resultClass = result === 'PASS' ? 'badge badge-pass' : (result === 'FAIL' ? 'badge badge-fail' : 'badge badge-neutral');
      return '<strong>Stage complete</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (result ? ' <span class="' + resultClass + '">' + result + '</span>' : '') +
        (details.length ? ' <span class="text-muted">(' + escapeHtml(details.join(', ')) + ')</span>' : '');
    }
    case 'stage_error': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown error';
      const dur = formatDurationSec(entry.duration_s);
      return '<strong>Stage failed</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        ' &mdash; ' + errMsg +
        (dur ? ' <span class="text-muted">(' + escapeHtml(dur) + ')</span>' : '');
    }

    // ── Pipeline result ──────────────────────────────────────────────
    case 'pipeline_result': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const pType = entry.pipeline_type ? escapeHtml(String(entry.pipeline_type)) : '';
      const pStatus = entry.pipeline_status || entry.result || '';
      const files = Array.isArray(entry.files_modified) ? entry.files_modified : [];
      const metrics = entry.metrics || {};
      const summaryArr = Array.isArray(entry.summary) ? entry.summary : [];
      const dur = formatDurationSec(entry.duration_s);

      const statusClass = pStatus === 'PASS' ? 'badge badge-pass' : (pStatus === 'FAIL' ? 'badge badge-fail' : 'badge badge-neutral');
      let html = '<strong>Pipeline result</strong>';
      if (pType) html += ' &mdash; <em>' + pType + '</em>';
      if (wpId) html += ' for <strong>' + wpId + '</strong>';
      if (pStatus) html += ' <span class="' + statusClass + '">' + escapeHtml(pStatus) + '</span>';

      // Details line
      const detailBits = [];
      if (files.length) detailBits.push(files.length + ' file' + (files.length !== 1 ? 's' : '') + ' modified');
      if (metrics.tests_passed != null) detailBits.push(metrics.tests_passed + ' tests passed');
      if (metrics.tests_failed) detailBits.push(metrics.tests_failed + ' tests failed');
      if (dur) detailBits.push(dur);
      if (detailBits.length) html += '<br><span class="text-muted">' + escapeHtml(detailBits.join(' \u00b7 ')) + '</span>';

      // File list (collapsed)
      if (files.length) {
        html += '<br><span class="text-muted" style="font-size:11px">' +
          files.map(function(f) { return escapeHtml(String(f)); }).join(', ') +
          '</span>';
      }

      // Summary text
      if (summaryArr.length) {
        html += '<div class="run-event-summary">' +
          summaryArr.map(function(s) { return '<p>' + escapeHtml(String(s)) + '</p>'; }).join('') +
          '</div>';
      }

      return html;
    }

    // ── Supervisor routing & status ──────────────────────────────────
    case 'route': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const dest = entry.destination ? escapeHtml(String(entry.destination).replace(/_/g, ' ')) : '';
      const role = entry.agent_role ? escapeHtml(String(entry.agent_role)) : '';
      const ledgerAction = entry.ledger_action ? escapeHtml(String(entry.ledger_action).replace(/_/g, ' ')) : '';
      const reason = entry.reason ? escapeHtml(String(entry.reason)) : '';
      let html = '<strong>Routing</strong>';
      if (wpId) html += ' <strong>' + wpId + '</strong>';
      if (dest) html += ' \u2192 <em>' + dest + '</em>';
      if (role) html += ' <span class="text-muted">(' + role + ')</span>';
      if (ledgerAction) html += '<br><span class="text-muted" style="font-size:11px">Action: ' + ledgerAction + '</span>';
      if (reason) html += '<br><span class="text-muted" style="font-size:11px">' + reason + '</span>';
      return html;
    }
    case 'wp_status_change': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const oldSt = entry.old_status ? escapeHtml(String(entry.old_status)) : '?';
      const newSt = entry.new_status ? escapeHtml(String(entry.new_status)) : '?';
      return '<strong>' + wpId + '</strong> status: ' +
        '<span class="badge badge-neutral">' + oldSt + '</span>' +
        ' \u2192 ' +
        '<span class="badge badge-neutral">' + newSt + '</span>';
    }
    case 'wp_complete': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      return '\u2713 <strong>' + wpId + '</strong> completed';
    }
    case 'rework_detected': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const count = entry.rework_count != null ? String(entry.rework_count) : '?';
      const pType = entry.pipeline_type ? escapeHtml(String(entry.pipeline_type)) : '';
      const role = entry.agent_role ? escapeHtml(String(entry.agent_role)) : '';
      return '\u21bb <strong>' + wpId + '</strong> rework #' + escapeHtml(count) +
        (pType && role ? ' <span class="text-muted">(' + pType + ' \u2192 ' + role + ')</span>' : '');
    }

    // ── Safety & errors ──────────────────────────────────────────────
    case 'safety_limit': {
      const iter = entry.iteration ? escapeHtml(String(entry.iteration)) : '?';
      return '<strong>Safety limit reached</strong> at iteration ' + iter;
    }
    case 'halted_repeated_failure': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const count = entry.consecutive_failures != null ? String(entry.consecutive_failures) : '?';
      return '<strong>' + wpId + '</strong> halted after ' + escapeHtml(count) + ' consecutive failures';
    }
    case 'mcp_error': {
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown MCP error';
      return '<strong>MCP error:</strong> ' + errMsg;
    }

    // ── Heartbeat ────────────────────────────────────────────────────
    case 'heartbeat': {
      const silence = entry.silence_s != null ? formatDurationSec(entry.silence_s) : '';
      return '\u2665 <strong>Alive</strong>' + (silence ? ' <span class="text-muted">(quiet for ' + escapeHtml(silence) + ')</span>' : '');
    }

    // ── Dialogue capture ─────────────────────────────────────────────
    case 'dialogue_captured': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const filePath = entry.file_path ? String(entry.file_path) : '';
      const fileName = filePath ? escapeHtml(filePath.split('/').pop() || filePath) : '';
      return '<strong>Dialogue saved</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (fileName ? ' &mdash; <span class="text-muted monospace" style="font-size:11px">' + fileName + '</span>' : '');
    }

    // ── Progress snapshot (rendered as card fallback if progress bar not used) ──
    case 'progress_snapshot': {
      const total = entry.total_wps || 0;
      const breakdown = entry.status_breakdown || {};
      const completed = breakdown.COMPLETE || 0;
      const pending = entry.pending || 0;
      return '<strong>Progress:</strong> ' + completed + '/' + total + ' WPs done, ' + pending + ' pending';
    }

    // ── Dry-run actions ──────────────────────────────────────────────
    case 'dry_run': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const stg = entry.stage ? escapeHtml(String(entry.stage).replace(/_/g, ' ')) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>Stage skipped</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (stg ? ' &mdash; <em>' + stg + '</em>' : '');
    }
    case 'dry_run_no_ledger': {
      const detail = entry.detail ? escapeHtml(String(entry.detail)) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>No ledger</strong>' +
        (detail ? ' &mdash; <span class="text-muted">' + detail + '</span>' : '');
    }
    case 'dry_run_complete': {
      const reason = entry.reason ? escapeHtml(String(entry.reason)) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>Dry run complete</strong>' +
        (reason ? ' &mdash; <span class="text-muted">' + reason + '</span>' : '');
    }

    // ── Legacy / generic events ──────────────────────────────────────
    case 'step_start':
    case 'step_end': {
      const stepName = entry.step_name ? escapeHtml(String(entry.step_name)) : '\u2014';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + stepName;
    }
    case 'llm_call_start':
    case 'llm_call_end': {
      const model = entry.model ? escapeHtml(String(entry.model)) : '';
      return '<strong>' + escapeHtml(action) + '</strong>' + (model ? ' &mdash; <span class="text-muted">' + model + '</span>' : '');
    }
    case 'tool_call_start':
    case 'tool_call_end': {
      const toolName = entry.tool_name ? escapeHtml(String(entry.tool_name)) : '\u2014';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + toolName;
    }

    default: {
      // Generic fallback — shows raw action + any message/error/reason field
      let genericMsg = entry.message ? ': ' + escapeHtml(String(entry.message)) : '';
      if (!genericMsg && entry.error) genericMsg = ': ' + escapeHtml(String(entry.error));
      if (!genericMsg && entry.reason) genericMsg = ': ' + escapeHtml(String(entry.reason));
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
    ? escapeHtml(String(entry.stage).replace(/_/g, ' '))
    : escapeHtml(action.replace(/_/g, ' '));
  var stageBadge = '<span class="run-stage-badge">' + stageLabel + '</span>';

  // WP ID badge (when present)
  var wpBadge = '';
  if (entry.wp_id) {
    wpBadge = '<span class="run-wp-badge">' + escapeHtml(String(entry.wp_id)) + '</span>';
  }

  // Timestamp
  var ts = entry.timestamp ? escapeHtml(formatDate(String(entry.timestamp))) : '';

  return '<div class="run-event ' + severityClass + '">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
      stageBadge +
      wpBadge +
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
      breadcrumb().projects().project(slug).leaf('Run Log').html() +
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
        // Calculate progress from status_breakdown (completed / total WPs)
        var total = entry.total_wps || 0;
        var breakdown = entry.status_breakdown || {};
        var completed = (breakdown.COMPLETE || 0) + (breakdown.CANCELLED || 0);
        var pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : (entry.progress_pct != null ? Math.min(100, Math.max(0, Number(entry.progress_pct))) : null);
        var container = document.getElementById('run-progress-container');
        var fill = document.getElementById('run-progress-bar-fill');
        if (container && pct !== null) {
          container.style.display = '';
          if (fill) {
            fill.style.width = pct + '%';
            fill.title = completed + '/' + total + ' WPs done (' + pct + '%)';
          }
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
