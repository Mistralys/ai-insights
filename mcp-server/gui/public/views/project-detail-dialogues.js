/* ============================================================
   views/project-detail-dialogues.js — Project Detail: Dialogues section
   Sub-module of views/project-detail.js.
   Depends on: components.js (UI), utils.js (escapeHtml),
               api-client.js (API)
               This script must be loaded after project-detail-orch.js
               and before project-detail.js in index.html.

   Exports:
     renderDialoguesSection
   ============================================================ */

/**
 * Open a full-screen modal showing the rendered content of a single dialogue.
 *
 * @param {string}  title      - Modal header text (e.g. "WP-003 · developer-r0")
 * @param {string}  repo
 * @param {string}  slug
 * @param {string}  filename
 * @param {boolean} useChunks  - true → fetch via getChunkRendered, false → getDialogueContent
 */
function _openDialogueModal(title, repo, slug, filename, useChunks) {
  // Remove any existing dialogue modal
  var existing = document.getElementById('dialogue-modal-overlay');
  if (existing) existing.remove();

  var modalHtml =
    '<div class="dialogue-modal-overlay" id="dialogue-modal-overlay">' +
      '<div class="dialogue-modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
        '<div class="dialogue-modal-header">' +
          '<span class="dialogue-modal-title">' + escapeHtml(title) + '</span>' +
          '<button class="dialogue-modal-close" id="dialogue-modal-close" aria-label="Close">\u00d7</button>' +
        '</div>' +
        '<div class="dialogue-modal-body" id="dialogue-modal-body">' +
          '<p class="text-muted">Loading\u2026</p>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  var overlay = document.getElementById('dialogue-modal-overlay');
  var bodyEl  = document.getElementById('dialogue-modal-body');

  function closeModal() {
    if (overlay) overlay.remove();
  }

  document.getElementById('dialogue-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });
  overlay.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  var fetchPromise = useChunks
    ? API.getChunkRendered(repo, slug, filename)
    : API.getDialogueContent(repo, slug, filename);

  fetchPromise.then(function (md) {
    if (!bodyEl) return;
    var rendered = (typeof marked !== 'undefined' && marked.parse)
      ? marked.parse(md)
      : '<pre>' + escapeHtml(md) + '</pre>';
    bodyEl.innerHTML = '<div class="dialogue-markdown">' + rendered + '</div>';
  }).catch(function (err) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '<p class="text-danger">Error loading dialogue: ' +
      escapeHtml(err.message || String(err)) + '</p>';
  });
}

/**
 * Render the Dialogues section into `sectionEl`.
 * Fetches all chunks and dialogues for the project (no WP filter),
 * merges them (chunks take priority over Markdown), groups by
 * source + stage, and renders an overview table with expandable
 * revision buttons.
 *
 * @param {HTMLElement} sectionEl  - Placeholder div (#project-dialogues-section)
 * @param {string}      repo       - Repository name
 * @param {string}      slug       - Project slug
 */
function renderDialoguesSection(sectionEl, repo, slug) {
  if (!sectionEl) return;
  sectionEl.innerHTML = '<p class="loading">Loading dialogues\u2026</p>';

  Promise.all([
    // Fetch all chunks — errors silently swallowed (absent directory is expected).
    API.getChunks(repo, slug).catch(function () { return []; }),
    // Fetch all dialogues — no wpId filter returns every dialogue for the project.
    API.getDialogues(repo, slug),
  ]).then(function (results) {
    var chunks    = results[0] || [];
    var dialogues = results[1] || [];

    if (!sectionEl) return;

    // Choose data source: chunks take priority over Markdown dialogue files
    // (same strategy as the WP detail page — prefer streaming capture format).
    var useChunks = chunks.length > 0;
    var entries   = useChunks ? chunks : dialogues;

    if (!entries || entries.length === 0) {
      sectionEl.innerHTML = UI.card('Dialogues',
        '<p class="text-muted">No dialogues available for this project.</p>'
      );
      return;
    }

    // Group by source (wp_id) + stage.
    // Key format: "{wp_id}:{stage}" — stable insertion-order grouping.
    var groupMap   = {};
    var groupOrder = [];
    entries.forEach(function (entry) {
      var source = entry.wp_id || 'unknown';
      var stage  = entry.stage || 'unknown';
      var key    = source + ':' + stage;
      if (!groupMap[key]) {
        groupMap[key] = { source: source, stage: stage, entries: [] };
        groupOrder.push(key);
      }
      groupMap[key].entries.push(entry);
    });

    // Build table rows.
    var rowsHtml = groupOrder.map(function (key) {
      var group   = groupMap[key];
      var source  = group.source;
      var stage   = group.stage;
      var rowEntries = group.entries;

      // Source cell: "Project" label for project-level entries, WP-ID badge otherwise.
      var sourceHtml;
      if (source === 'project') {
        sourceHtml = '<span class="dialogue-source-badge dialogue-source-project">Project</span>';
      } else {
        sourceHtml = '<span class="dialogue-source-badge">' + escapeHtml(source) + '</span>';
      }

      // Revision buttons — one per entry; latest (last index) is visually highlighted.
      // Clicking opens a full-screen modal; no inline expand.
      var buttonsHtml = rowEntries.map(function (entry, idx) {
        var isLatest   = (idx === rowEntries.length - 1);
        var label      = escapeHtml(stage + '-r' + idx);
        // Modal title: "SOURCE · stage-rN"
        var modalTitle = escapeHtml((source === 'project' ? 'Project' : source) + ' \u00b7 ' + stage + '-r' + idx);
        return '<button class="dialogue-btn' + (isLatest ? ' dialogue-btn-latest' : '') + '" ' +
          'data-repo="'        + escapeHtml(repo)           + '" ' +
          'data-slug="'        + escapeHtml(slug)           + '" ' +
          'data-filename="'    + escapeHtml(entry.filename) + '" ' +
          'data-use-chunks="'  + (useChunks ? '1' : '0')   + '" ' +
          'data-modal-title="' + modalTitle                 + '">' +
          label +
          '</button>';
      }).join('');

      return '<tr>' +
        '<td>' + sourceHtml + '</td>' +
        '<td><span class="dialogue-stage-label">' + escapeHtml(stage) + '</span></td>' +
        '<td>' + buttonsHtml + '</td>' +
      '</tr>';
    }).join('');

    var tableHtml =
      '<div class="table-wrapper dialogues-table-wrapper">' +
        '<table class="dialogues-overview-table">' +
          '<thead><tr>' +
            '<th>Source</th>' +
            '<th>Stage</th>' +
            '<th>Dialogue</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';

    sectionEl.innerHTML = UI.card('Dialogues', tableHtml, { id: 'project-dialogues-card' });

    sectionEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.dialogue-btn');
      if (!btn) return;

      _openDialogueModal(
        btn.getAttribute('data-modal-title') || btn.getAttribute('data-filename'),
        btn.getAttribute('data-repo'),
        btn.getAttribute('data-slug'),
        btn.getAttribute('data-filename'),
        btn.getAttribute('data-use-chunks') === '1'
      );
    });

  }).catch(function (err) {
    if (!sectionEl) return;
    sectionEl.innerHTML = UI.card('Dialogues',
      '<p class="text-danger">Failed to load dialogues: ' +
        escapeHtml(err.message || String(err)) + '</p>'
    );
  });
}
