/* ============================================================
   views/project-detail-dialogues.js — Project Detail: Dialogues section
   Sub-module of views/project-detail.js.
   Depends on: components.js (UI), utils.js (escapeHtml),
               api-client.js (API)
               This script must be loaded after project-detail-orch.js
               and before project-detail.js in index.html.

   Exports:
     buildDialogueHTML
     renderDialoguesSection
   ============================================================ */

/* ----------------------------------------------------------
   Interactive dialogue renderer (WP-006)
   ---------------------------------------------------------- */

/**
 * Render inline Markdown (bold, italic, inline code) in a plain-text string.
 * Delegates to marked.parseInline() when available; falls back to safe regex
 * substitution (HTML-escaped first) so XSS is impossible on both code paths.
 *
 * @param {string} text - Raw text that may contain **bold**, *italic*, `code`.
 * @returns {string} Safe HTML string.
 */
function _dialogueInlineMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof marked.parseInline === 'function') {
    // Pre-escape HTML before passing to marked so any raw HTML in the input is
    // neutralised before marked processes it. Markdown syntax characters
    // (* _ ` \n) are unaffected by escapeHtml, so bold/italic/code still render
    // correctly. This makes the primary path consistent with the regex fallback.
    return marked.parseInline(escapeHtml(text));
  }
  // Regex fallback: escape HTML first, then apply simple Markdown transforms.
  var safe = escapeHtml(text);
  safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return safe;
}

/**
 * Build HTML for a 'text' dialogue block.
 * Splits content on double newlines to form individual paragraph elements.
 *
 * @param {{type: 'text', content: string}} block
 * @returns {string} HTML string
 */
function _buildDialogueTextBlock(block) {
  var content = block.content || '';
  var paragraphs = content.split(/\n\n+/);
  var pHtml = '';
  var i, para;
  for (i = 0; i < paragraphs.length; i++) {
    para = paragraphs[i].trim();
    if (!para) continue;
    para = escapeHtml(para).replace(/\n/g, '<br>');
    if (typeof marked !== 'undefined' && typeof marked.parseInline === 'function') {
        para = marked.parseInline(para);
    } else {
        para = para.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        para = para.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        para = para.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    }

    pHtml += '<p>' + para + '</p>';
  }
  return '<div class="dialogue-text">' + pHtml + '</div>';
}

/**
 * Build HTML for a 'tool-call' dialogue block.
 * Renders as a collapsed-by-default card: toggle button (always visible),
 * ↳ detail lines (always visible, between button and body), and a
 * collapsible body containing the args JSON and optional tool result.
 *
 * @param {{type: 'tool-call', name: string, detailLines: string[], args: *, result: {content: string}|undefined}} block
 * @returns {string} HTML string
 */
function _buildDialogueToolCallBlock(block) {
  var name = block.name || 'unknown';
  var detailLines = block.detailLines || [];
  var args = block.args;
  var result = block.result;
  var i;

  // Toggle button — always visible, collapsed by default.
  var headerHtml =
    '<button class="dialogue-tool-toggle" aria-expanded="false">' +
      '<span class="dialogue-tool-arrow">\u25b6</span>' +
      'Tool call: ' + escapeHtml(name) +
    '</button>';

  // ↳ detail lines — always visible, outside the hidden body.
  var detailHtml = '';
  if (detailLines.length) {
    detailHtml += '<div class="dialogue-tool-detail-area">';
    for (i = 0; i < detailLines.length; i++) {
      detailHtml += '<div class="dialogue-tool-detail-line">' + escapeHtml(detailLines[i]).replace(/\n/g, '<br>') + '</div>';
    }
    detailHtml += '</div>';
  }

  // Collapsible body: args JSON + optional result (hidden by default).
  var argsJson;
  try {
    argsJson = JSON.stringify(args, null, 2);
  } catch (e) {
    argsJson = String(args);
  }

  var bodyHtml = '<pre class="dialogue-tool-args">' + escapeHtml(argsJson) + '</pre>';

  if (result && result.content) {
    bodyHtml +=
      '<div class="dialogue-tool-result">' +
        '<span class="dialogue-tool-result-label">Result:</span>' +
        escapeHtml(result.content).replace(/\n/g, '<br>') +
      '</div>';
  }

  return '<div class="dialogue-tool-call">' +
    headerHtml +
    detailHtml +
    '<div class="dialogue-tool-details" hidden>' + bodyHtml + '</div>' +
  '</div>';
}

/**
 * Build HTML for a 'checklist' dialogue block (write_todos invocation).
 *
 * @param {{type: 'checklist', items: Array<{content: string, status: string, checked: boolean}>}} block
 * @returns {string} HTML string
 */
function _buildDialogueChecklistBlock(block) {
  var items = block.items || [];
  var listHtml = '';
  var i, item, isChecked, checkedAttr, checkedClass;
  for (i = 0; i < items.length; i++) {
    item = items[i];
    isChecked = !!item.checked;
    checkedAttr  = isChecked ? ' checked' : '';
    checkedClass = isChecked ? ' class="checked"' : '';
    listHtml +=
      '<li' + checkedClass + '>' +
        '<input type="checkbox" disabled' + checkedAttr + '>' +
        '<span>' + escapeHtml(item.content || '') + '</span>' +
      '</li>';
  }
  return '<div class="dialogue-checklist"><ul>' + listHtml + '</ul></div>';
}

/**
 * Build HTML for a 'subagent-heading' dialogue block.
 *
 * @param {{type: 'subagent-heading', label: string}} block
 * @returns {string} HTML string
 */
function _buildDialogueSubagentHeadingBlock(block) {
  return '<h3 class="dialogue-subagent-heading">' + escapeHtml(block.label || '') + '</h3>';
}

/**
 * Transform an array of DialogueBlocks into interactive HTML.
 *
 * - 'text'             → clean paragraphs with inline Markdown support
 * - 'tool-call'        → collapsed-by-default card with args/result toggle
 * - 'checklist'        → styled list with checkbox indicators
 * - 'subagent-heading' → <h3> element
 *
 * All string values are passed through escapeHtml() for XSS defence.
 * All JavaScript follows ES5 patterns (var, function declarations, .then() chains).
 *
 * @param {Array<{type: string}>} blocks - Array of DialogueBlock objects.
 * @returns {string} Safe HTML string ready for assignment to .innerHTML.
 */
function buildDialogueHTML(blocks) {
  if (!blocks || !blocks.length) {
    return '<p class="text-muted">No dialogue content.</p>';
  }
  var html = '';
  var i, block;
  for (i = 0; i < blocks.length; i++) {
    block = blocks[i];
    if (block.type === 'text') {
      html += _buildDialogueTextBlock(block);
    } else if (block.type === 'tool-call') {
      html += _buildDialogueToolCallBlock(block);
    } else if (block.type === 'checklist') {
      html += _buildDialogueChecklistBlock(block);
    } else if (block.type === 'subagent-heading') {
      html += _buildDialogueSubagentHeadingBlock(block);
    }
  }
  return '<div class="dialogue-interactive">' + html + '</div>';
}

/* ----------------------------------------------------------
   Modal opener
   ---------------------------------------------------------- */

/**
 * Open a full-screen modal showing the rendered content of a single dialogue.
 *
 * When useChunks is true, fetches structured DialogueBlock[] via
 * API.getChunkStructured() and renders via buildDialogueHTML(), including
 * an expand/collapse delegated listener for tool-call headers.
 *
 * When useChunks is false, fetches raw Markdown via API.getDialogueContent()
 * and renders via marked.parse() (legacy path — unchanged).
 *
 * @param {string}  title      - Modal header text (e.g. "WP-003 · developer-r0")
 * @param {string}  repo
 * @param {string}  slug
 * @param {string}  filename
 * @param {boolean} useChunks  - true → structured renderer, false → Markdown renderer
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

  if (useChunks) {
    // Structured path: fetch DialogueBlock[] and render with buildDialogueHTML().
    API.getChunkStructured(repo, slug, filename).then(function (blocks) {
      if (!bodyEl) return;
      bodyEl.innerHTML = buildDialogueHTML(blocks);
    }).catch(function (err) {
      if (!bodyEl) return;
      bodyEl.innerHTML = '<p class="text-danger">Error loading dialogue: ' +
        escapeHtml(err.message || String(err)) + '</p>';
    });

    // Delegated click listener for tool-call expand/collapse toggles.
    // Registered once on bodyEl; the handler fires after content is loaded
    // because user interaction always follows the async render.
    bodyEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.dialogue-tool-toggle');
      if (!btn) return;

      var isExpanded = btn.getAttribute('aria-expanded') === 'true';
      var detailsEl  = btn.parentNode ? btn.parentNode.querySelector('.dialogue-tool-details') : null;
      var arrowEl    = btn.querySelector('.dialogue-tool-arrow');

      if (detailsEl) {
        if (isExpanded) {
          detailsEl.setAttribute('hidden', '');
        } else {
          detailsEl.removeAttribute('hidden');
        }
      }
      btn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
      if (arrowEl) {
        if (isExpanded) {
          arrowEl.classList.remove('expanded');
        } else {
          arrowEl.classList.add('expanded');
        }
      }
    });
  } else {
    // Legacy path: fetch raw Markdown and render via marked.parse().
    API.getDialogueContent(repo, slug, filename).then(function (md) {
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
