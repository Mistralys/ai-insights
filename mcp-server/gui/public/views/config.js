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
      '<div class="card" style="max-width:560px">' +
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
        '</form>' +
      '</div>';

    var form = document.getElementById('config-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var autoHandoff = document.getElementById('auto-handoff').checked;
        var maxDepth = parseInt(document.getElementById('max-depth').value, 10);
        if (isNaN(maxDepth) || maxDepth < 1) {
          document.getElementById('config-msg').innerHTML = '<p class="error-banner">Max handoff depth must be a positive integer.</p>';
          return;
        }
        var autoArchiveDays = parseInt(document.getElementById('auto-archive-days').value, 10);
        if (isNaN(autoArchiveDays) || autoArchiveDays < 0) {
          document.getElementById('config-msg').innerHTML = '<p class="error-banner">Auto-archive days must be a non-negative integer.</p>';
          return;
        }
        // ledger_root intentionally omitted (read-only)
        API.updateConfig({ auto_handoff_enabled: autoHandoff, max_handoff_depth: maxDepth, auto_archive_days: autoArchiveDays })
          .then(function () {
            document.getElementById('config-msg').innerHTML = '<p class="success-banner">Configuration saved.</p>';
          })
          .catch(function (err) {
            document.getElementById('config-msg').innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
          });
      });
    }
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}
