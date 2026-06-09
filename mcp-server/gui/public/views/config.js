/* ============================================================
   views/config.js — Configuration view
   Section 4d of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, showLoading, showError
   ============================================================ */

function renderConfig(app) {
  showLoading(app);

  API.getConfig().then(function (config) {
    app.innerHTML =
      '<div class="page-header"><h1>Configuration</h1></div>' +
      UI.card(null,
        '<form id="config-form">' +
          '<div class="form-group">' +
            '<label class="form-label" for="auto-handoff">' +
              '<input type="checkbox" id="auto-handoff" class="form-check" ' + (config.auto_handoff_enabled ? 'checked' : '') + '>' +
              ' Auto-handoff enabled' +
            '</label>' +
            '<p class="form-note">When enabled, the MCP server automatically chains work to the next agent in the workflow.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="max-depth">Max handoff depth</label>' +
            '<input type="number" id="max-depth" class="form-control" min="1" value="' + escapeHtml(String(config.max_handoff_depth)) + '">' +
            '<p class="form-note">Maximum number of automatic agent handoffs before stopping.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="capture-dialogues">' +
              '<input type="checkbox" id="capture-dialogues" class="form-check" ' + (config.capture_dialogues ? 'checked' : '') + '>' +
              ' Capture agent dialogues' +
            '</label>' +
            '<p class="form-note">When enabled, the orchestrator saves the full LLM conversation for each pipeline stage to the project\'s ledger as Markdown files. Changes take effect on the next orchestrator run.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="auto-archive-days">Auto-archive after (days)</label>' +
            '<input type="number" id="auto-archive-days" class="form-control" min="0" step="1" value="' + escapeHtml(String(config.auto_archive_days != null ? config.auto_archive_days : 6)) + '">' +
            '<p class="form-note">Number of days after last update before a COMPLETE project is automatically archived. Set to 0 to disable auto-archiving.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ledger-root">Ledger root path</label>' +
            '<input type="text" id="ledger-root" class="form-control" readonly value="' + escapeHtml(config.ledger_root || '') + '">' +
            '<p class="form-note">Read-only. Changing this requires restarting the server with <code>--ledger-dir</code>.</p>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary">Save</button>' +
          '<div id="config-msg"></div>' +
        '</form>',
        { style: 'max-width:560px' }
      );

    var form = document.getElementById('config-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var autoHandoff = document.getElementById('auto-handoff').checked;
        var maxDepth = parseInt(document.getElementById('max-depth').value, 10);
        if (isNaN(maxDepth) || maxDepth < 1) {
          showError(document.getElementById('config-msg'), 'Max handoff depth must be a positive integer.');
          return;
        }
        var captureDialogues = document.getElementById('capture-dialogues').checked;
        var autoArchiveDays = parseInt(document.getElementById('auto-archive-days').value, 10);
        if (isNaN(autoArchiveDays) || autoArchiveDays < 0) {
          showError(document.getElementById('config-msg'), 'Auto-archive days must be a non-negative integer.');
          return;
        }
        // ledger_root intentionally omitted (read-only)
        API.updateConfig({ auto_handoff_enabled: autoHandoff, max_handoff_depth: maxDepth, capture_dialogues: captureDialogues, auto_archive_days: autoArchiveDays })
          .then(function () {
            document.getElementById('config-msg').innerHTML = '<p class="success-banner">Configuration saved.</p>';
          })
          .catch(function (err) {
            showError(document.getElementById('config-msg'), 'Save failed: ' + (err.message || String(err)));
          });
      });
    }
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}
