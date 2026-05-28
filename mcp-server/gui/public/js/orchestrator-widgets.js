/* ============================================================
   js/orchestrator-widgets.js — Shared Orchestrator Widget Library
   MCP Server Dashboard SPA

   Provides reusable UI components for the orchestrator views.
   Exposes a global OrchestratorWidgets namespace object.

   Depends on: API (api-client.js), escapeHtml (utils.js)
   ============================================================ */

var OrchestratorWidgets = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Formats an elapsed time in milliseconds as a short human-readable string.
   * @param {number} ms - Elapsed milliseconds.
   * @returns {string} Formatted string (e.g. "42s", "3m", "2h").
   */
  function formatElapsed(ms) {
    var secs = Math.round(ms / 1000);
    if (secs < 60) return secs + 's';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h';
  }

  /**
   * Returns CSS class suffix + display label for an effectiveStatus value.
   * @param {string} status
   * @returns {{ cls: string, label: string }}
   */
  function statusMeta(status) {
    if (status === 'started') return { cls: 'started', label: 'Started'  };
    if (status === 'dead')    return { cls: 'dead',    label: 'Dead'     };
    return                           { cls: 'pending', label: 'Pending'  };
  }

  // ------------------------------------------------------------------
  // renderStatusCard(entry) → string (HTML)
  // ------------------------------------------------------------------

  /**
   * Renders a status card HTML string for a single queue entry.
   *
   * @param {object} entry - An enriched QueueEntry from the backend.
   * @param {string} entry.effectiveStatus - 'pending' | 'started' | 'dead'
   * @param {number} entry.pid             - OS process ID.
   * @param {string} entry.startedAt       - ISO 8601 start timestamp.
   * @param {string|null} entry.progress   - Latest JSONL progress summary.
   * @returns {string} HTML string.
   */
  function renderStatusCard(entry) {
    var meta     = statusMeta(entry.effectiveStatus || 'pending');
    var pid      = entry.pid != null ? String(entry.pid) : '—';
    var progress = entry.progress || null;

    var elapsed = '';
    if (entry.startedAt) {
      try {
        var diff = Date.now() - new Date(entry.startedAt).getTime();
        if (!isNaN(diff) && diff >= 0) elapsed = formatElapsed(diff);
      } catch (_) {}
    }

    var html = '<div class="orchestrator-status-card">';

    // Header: status badge + elapsed time
    html += '<div class="orchestrator-status-header">';
    html += '<span class="badge badge-' + escapeHtml(meta.cls) + '">' +
      escapeHtml(meta.label) + '</span>';
    if (elapsed) {
      html += ' <span class="text-muted orchestrator-elapsed">Running ' +
        escapeHtml(elapsed) + '</span>';
    }
    html += '</div>';

    // Body: PID + progress summary
    html += '<div class="orchestrator-status-body">';
    html += '<span class="text-muted orchestrator-pid">PID: ' +
      escapeHtml(pid) + '</span>';
    if (progress) {
      html += '<div class="orchestrator-progress-summary">' +
        escapeHtml(progress) + '</div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ------------------------------------------------------------------
  // renderKillButton(entryId, onDone) → HTMLButtonElement
  // ------------------------------------------------------------------

  /**
   * Creates a "Kill" button that, on click, asks for confirmation then
   * calls API.orchestratorKill(entryId).  Invokes onDone() on success.
   *
   * @param {string}   entryId - Queue entry UUID.
   * @param {Function} onDone  - Callback invoked after a successful kill.
   * @returns {HTMLButtonElement}
   */
  function renderKillButton(entryId, onDone) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-danger btn-sm orchestrator-kill-btn';
    btn.textContent = 'Kill';

    btn.addEventListener('click', function () {
      if (!window.confirm(
        'Kill this orchestrator run? The process will receive SIGTERM.'
      )) {
        return;
      }
      API.orchestratorKill(entryId).then(function () {
        if (typeof onDone === 'function') onDone();
      }).catch(function (err) {
        window.alert(
          'Failed to kill run: ' +
          ((err && err.message) || String(err))
        );
      });
    });

    return btn;
  }

  // ------------------------------------------------------------------
  // renderDismissButton(entryId, onDone) → HTMLButtonElement
  // ------------------------------------------------------------------

  /**
   * Creates a "Dismiss" button that calls API.orchestratorDismiss(entryId).
   * Invokes onDone() on success.  Intended for 'dead' queue entries.
   *
   * @param {string}   entryId - Queue entry UUID.
   * @param {Function} onDone  - Callback invoked after a successful dismiss.
   * @returns {HTMLButtonElement}
   */
  function renderDismissButton(entryId, onDone) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm orch-queue-action-btn orchestrator-dismiss-btn';
    btn.textContent = 'Dismiss';

    btn.addEventListener('click', function () {
      API.orchestratorDismiss(entryId).then(function () {
        if (typeof onDone === 'function') onDone();
      }).catch(function (err) {
        window.alert(
          'Failed to dismiss entry: ' +
          ((err && err.message) || String(err))
        );
      });
    });

    return btn;
  }

  // ------------------------------------------------------------------
  // formatLogAction(entry) → string
  // ------------------------------------------------------------------

  /**
   * Maps a raw JSONL log entry object to a human-friendly display string
   * for use in the log preview widget.
   *
   * The mapping is:
   *   run_start        → "Starting the run"
   *   stage_start      → "Starting stage: {stage}"
   *   stage_complete   → "Stage complete: {stage}"
   *   progress_snapshot→ "Progress snapshot"
   *   tool_call        → "Tool call: {tool_name}"  (or "Tool call" if no tool_name)
   *   wp_complete      → "Work package complete: {wp_id}"
   *   wp_status_change → "WP status → {new_status}"
   *   run_end          → "Run ended"
   *   run_error        → "Run error"
   *   signal_shutdown  → "Interrupted by signal"
   *   heartbeat        → "Heartbeat"
   *   mcp_error        → "MCP error"
   *   route            → "Routing decision"
   *   <unknown>        → title-cased version of the raw action, or JSON fallback
   *
   * NOTE: This function is intentionally scoped to the log preview only.
   * It does NOT affect renderProgressBadge, which continues to use the
   * raw action string.
   *
   * @param {object|null|undefined} entry - A JSONL log entry object. Null and
   *   undefined are safely handled: a falsy entry (or an entry without an
   *   `action` field) falls through to `JSON.stringify(entry)` as the
   *   last-resort fallback.
   * @returns {string} Human-friendly display label.
   */
  function formatLogAction(entry) {
    var action = (entry && entry.action) ? String(entry.action) : '';

    switch (action) {
      case 'run_start':
        return 'Starting the run';

      case 'stage_start':
        return 'Starting stage: ' + (entry.stage || '');

      case 'stage_complete':
        return 'Stage complete: ' + (entry.stage || '');

      case 'progress_snapshot':
        return 'Progress snapshot';

      case 'tool_call':
        return entry.tool_name
          ? 'Tool call: ' + String(entry.tool_name)
          : 'Tool call';

      case 'wp_complete':
        return 'Work package complete: ' + (entry.wp_id || '');

      case 'wp_status_change':
        return 'WP status \u2192 ' + (entry.new_status || '');

      case 'run_end':
        return 'Run ended';

      case 'run_error':
        return 'Run error';

      case 'signal_shutdown':
        return 'Interrupted by signal';

      case 'heartbeat':
        return 'Heartbeat';

      case 'mcp_error':
        return 'MCP error';

      case 'route':
        return 'Routing decision';

      default:
        if (action) {
          // Title-case the raw action string (replace underscores with spaces).
          return action
            .replace(/_/g, ' ')
            .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
        }
        return JSON.stringify(entry);
    }
  }

  // ------------------------------------------------------------------
  // renderLogPreview(container, slug, filename) → cleanup()
  // ------------------------------------------------------------------

  /**
   * Starts auto-polling the run log for a queue entry and prepends new
   * JSONL events to `container` as they arrive, keeping the most-recent
   * entry at the top (most-recent-first ordering).
   *
   * Polling begins immediately (one fetch on call), then repeats every
   * 3 seconds.  Only events after the last seen line are prepended.
   *
   * @param {HTMLElement} container - The element to prepend log entries into.
   * @param {string}      slug      - Project slug used for the API call.
   * @param {string}      filename  - JSONL log filename.
   * @returns {Function} cleanup — call to stop polling and clear the interval.
   */
  function renderLogPreview(container, slug, filename) {
    var afterLine  = 0;
    var stopped    = false;
    var intervalId = null;

    function fetchEntries() {
      if (stopped) return;
      API.getRunLogEntries(slug, filename, afterLine).then(function (data) {
        if (stopped) return;
        var entries    = (data && Array.isArray(data.entries)) ? data.entries : [];
        var totalLines = (data && typeof data.totalLines === 'number')
          ? data.totalLines
          : afterLine;

        // Iterate in reverse so that within a batch the earliest entry
        // ends up at the top after prepending (each insertBefore pushes
        // the previous div down, so the last-iterated entry — the oldest
        // in the batch — ends up topmost).  Overall result: newest events
        // are always visible at the top without scrolling.
        for (var i = entries.length - 1; i >= 0; i--) {
          var div = document.createElement('div');
          div.className = 'log-preview-entry';
          div.textContent = formatLogAction(entries[i]);
          container.insertBefore(div, container.firstChild);
        }

        afterLine = totalLines;
      }).catch(function () {
        // Polling is best-effort — swallow errors silently.
      });
    }

    fetchEntries();
    intervalId = setInterval(fetchEntries, 3000);

    return function cleanup() {
      stopped = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  }

  // ------------------------------------------------------------------
  // renderProgressBadge(lastAction) → string (HTML)
  // ------------------------------------------------------------------

  var PROGRESS_BADGE_MAP = {
    'run_start':         { icon: '▶', color: 'info'    },
    'stage_start':       { icon: '⟳', color: 'info'    },
    'stage_complete':    { icon: '✓', color: 'success' },
    'wp_complete':       { icon: '✓', color: 'success' },
    'progress_snapshot': { icon: '◎', color: 'info'    },
    'run_end':           { icon: '■', color: 'neutral'  },
    'run_error':         { icon: '✗', color: 'error'   },
    'signal_shutdown':   { icon: '⚡', color: 'warning' },
    'stage_error':       { icon: '✗', color: 'error'   },
    // NOTE: resolveProgress() never surfaces heartbeat as lastAction — kept for completeness.
    'heartbeat':         { icon: '♥', color: 'neutral'  },
  };

  /**
   * Renders a small badge HTML string for a JSONL action type.
   *
   * @param {string|null|undefined} lastAction - The last JSONL `action` field.
   * @returns {string} HTML badge string.
   */
  function renderProgressBadge(lastAction) {
    var mapping = (lastAction && PROGRESS_BADGE_MAP[lastAction])
      || { icon: '•', color: 'neutral' };
    var label = lastAction ? escapeHtml(String(lastAction)) : 'idle';
    return '<span class="badge badge-' + escapeHtml(mapping.color) + '">' +
      mapping.icon + ' ' + label + '</span>';
  }

  // ------------------------------------------------------------------
  // renderCliReference() → string (HTML)
  // ------------------------------------------------------------------

  /**
   * Returns a static HTML block with the most useful CLI commands for
   * managing orchestrator runs from the terminal.
   *
   * MAINTENANCE NOTE: The command text below mirrors the actual CLI surface.
   * Keep in sync with:
   *   - orchestrate binary: orchestrator/src/cli.py (CLI flags)
   *   - kill script:        scripts/kill-orchestrator.js
   *   - preflight script:   scripts/preflight-orchestrator.js (via scripts/cli.js)
   *
   * @returns {string} HTML string.
   */
  function renderCliReference() {
    return '<div class="orchestrator-cli-reference">' +
      '<h4>CLI Commands</h4>' +
      '<pre><code>' +
      '# Start a run\n' +
      'orchestrate &lt;plan-path&gt;\n\n' +
      '# Resume an interrupted run\n' +
      'orchestrate &lt;plan-path&gt; --resume &lt;thread-id&gt;\n\n' +
      '# Dry run (inspect routing without executing agents)\n' +
      'orchestrate &lt;plan-path&gt; --dry-run\n\n' +
      '# Kill stale orchestrator processes\n' +
      'node scripts/kill-orchestrator.js\n\n' +
      '# Pre-flight readiness check\n' +
      'node scripts/cli.js preflight --plan &lt;plan-path&gt;' +
      '</code></pre>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // Public namespace
  // ------------------------------------------------------------------

  return {
    formatLogAction:     formatLogAction,
    renderStatusCard:    renderStatusCard,
    renderKillButton:    renderKillButton,
    renderDismissButton: renderDismissButton,
    renderLogPreview:    renderLogPreview,
    renderProgressBadge: renderProgressBadge,
    renderCliReference:  renderCliReference,
  };
})();
