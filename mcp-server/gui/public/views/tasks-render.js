/* ============================================================
   views/tasks-render.js — Tasks view markup builders
   Section 4h-r of the MCP Server Dashboard SPA
   Depends on: utils.js (escapeHtml, formatDate), safe-markdown.js
               (SafeMarkdown), views/tasks-model.js (TasksModel)

   Namespace `TasksRender`: pure string builders. No DOM access, no state;
   the controller (views/tasks.js) passes everything in and wires events.
   Every user-supplied value goes through escapeHtml or SafeMarkdown. Colours
   are applied through the `tc-{id}` classes only: no inline style, no hex.

   Shapes:
     task     GUI TaskView { id, text, tags, completed, created_at,
              completed_at, completion_source, color, store_label,
              ticket_label, ticket_url, reference }
     ui       { sort, expanded:{id:true}, editing:{id,field}|null,
              armed:id|null, palette:id|null, activeId, leaving:{id:true},
              flash:id|null }
     state    { filter:{status,store,tags,colors,q}, sort, paletteMode }
     stores   [{ id, label }]
   ============================================================ */

var TasksRender = (function () {
  'use strict';

  var ICON_GRIP = '<svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.8v4.4M9.2 6.8v4.4"/></svg>';

  var NO_COLOUR = 'No colour';

  function esc(value) { return escapeHtml(value); }

  function ticketText(task) {
    return task.ticket_label || task.reference || '';
  }

  /* ── Colour ──────────────────────────────────────────────── */

  /* A small dot for a colour key (a palette id or 'none'). */
  function chipDot(key) {
    var col = TasksModel.colorById(key);
    return '<span class="chip-dot' + (col ? ' tc-' + col.id : ' is-none') + '"></span>';
  }

  function colorName(key) {
    var col = TasksModel.colorById(key);
    return col ? col.name : NO_COLOUR;
  }

  /* The colour button of a row. `open` marks the palette as expanded. */
  function colorCell(task, open) {
    var col = TasksModel.colorById(task.color);
    return '<button type="button" class="task-color' + (col ? '' : ' is-empty') + '" data-act="color" data-rc' +
      ' aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' aria-label="' + (col ? esc('Colour: ' + col.name + '. Change colour') : 'Set colour') + '"' +
      ' title="' + (col ? esc(col.name + ' — change colour (c)') : 'Set colour (c)') + '">' +
      '<span class="dot' + (col ? ' tc-' + col.id : '') + '"></span></button>';
  }

  function swatches(isOn, label) {
    return '<div class="palette-grid">' + TasksModel.PALETTE.map(function (c) {
      return '<button type="button" class="swatch tc-' + c.id + '" data-pal data-color="' + c.id + '"' +
        ' aria-label="' + esc(c.name) + '" aria-pressed="' + (isOn(c.id) ? 'true' : 'false') + '"' +
        ' title="' + esc(c.name) + '"></button>';
    }).join('') + '</div><div class="palette-foot"><span class="palette-name" aria-hidden="true">' + esc(label) + '</span>';
  }

  /* Palette body. mode 'set': selection is the task's colour id ('' = none).
     mode 'filter': selection is the array of selected colour keys. */
  function palette(mode, selection) {
    if (mode === 'set') {
      var current = typeof selection === 'string' ? selection : '';
      var col = TasksModel.colorById(current);
      return swatches(function (id) { return current === id; }, col ? col.name : NO_COLOUR) +
        '<button type="button" class="palette-none" data-pal data-color="" aria-pressed="' + (col ? 'false' : 'true') + '">' + NO_COLOUR + '</button></div>';
    }
    var sel = selection || [];
    return swatches(function (id) { return sel.indexOf(id) !== -1; }, sel.length ? 'Any of the selected' : 'Pick one or more') +
      '<span class="palette-actions">' +
      '<button type="button" class="palette-none" data-pal data-color="none" aria-pressed="' + (sel.indexOf('none') !== -1 ? 'true' : 'false') + '">' + NO_COLOUR + '</button>' +
      '<button type="button" class="palette-none" data-pal data-color-clear' + (sel.length ? '' : ' disabled') + '>Any</button>' +
      '</span></div>';
  }

  /* ── Filters ─────────────────────────────────────────────── */

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function colorFilterButton(state) {
    var colors = state.filter.colors || [];
    var names = colors.length ? colors.map(colorName).join(', ') : 'any';
    return '<button type="button" id="f-color" class="color-filter-btn" aria-haspopup="true"' +
      ' aria-expanded="' + (state.paletteMode === 'filter' ? 'true' : 'false') + '"' +
      ' aria-label="' + esc('Colour filter: ' + names) + '">' +
      (colors.length ? colors.map(chipDot).join('') : '<span class="any">Any</span>') + '</button>';
  }

  function filterBar(state, stores, tags) {
    var f = state.filter;
    var list = stores || [];
    return '<div class="filter-bar" role="search" aria-label="Filter tasks">' +
      '<div class="field field-search">' +
        '<label for="f-search" class="visually-hidden">Search tasks</label>' +
        '<input type="search" id="f-search" placeholder="Search tasks…   /" autocomplete="off" value="' + esc(f.q || '') + '">' +
      '</div>' +
      '<div class="field"><label for="f-status">Status:</label><select id="f-status">' +
        option('open', 'Open', f.status === 'open') +
        option('completed', 'Completed', f.status === 'completed') +
        option('all', 'All', f.status === 'all') +
      '</select></div>' +
      '<div class="field" id="f-store-field"' + (list.length < 2 ? ' hidden' : '') + '>' +
        '<label for="f-store">Store:</label><select id="f-store">' +
        option('', 'All', !f.store) +
        list.map(function (s) { return option(s.id, s.label, f.store === s.id); }).join('') +
      '</select></div>' +
      '<div class="field"><label for="f-sort">Sort:</label><select id="f-sort">' +
        option('priority', 'Priority', state.sort === 'priority') +
        option('created', 'Date created', state.sort === 'created') +
        option('completed', 'Date completed', state.sort === 'completed') +
      '</select></div>' +
      '<div class="field"><label for="f-tag">Tags:</label>' +
        '<input type="text" id="f-tag" class="tag-filter-input" list="tag-list" placeholder="Add tag filter…" autocomplete="off"></div>' +
      '<div class="field"><span class="field-label" aria-hidden="true">Colour:</span>' + colorFilterButton(state) + '</div>' +
      '<datalist id="tag-list">' + (tags || []).map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
      '</div>';
  }

  /* Chips for the active tag and colour filters plus "Clear filters". Empty
     string when no filter differs from the defaults (status open, no store,
     no search). */
  function activeFilters(state) {
    var f = state.filter;
    var tags = f.tags || [];
    var colors = f.colors || [];
    var tagChips = tags.map(function (g) {
      return '<span class="filter-chip">' + esc(g) + '<button type="button" data-remove-filter="' + esc(g) + '" aria-label="' +
        esc('Remove tag filter ' + g) + '">×</button></span>';
    }).join('');
    var colorChips = colors.map(function (key) {
      return '<span class="filter-chip">' + chipDot(key) + esc(colorName(key)) +
        '<button type="button" data-remove-color="' + esc(key) + '" aria-label="' + esc('Remove colour filter ' + colorName(key)) + '">×</button></span>';
    }).join('');
    var any = tagChips || colorChips || f.q || f.store || f.status !== 'open';
    if (!any) { return ''; }
    return (tagChips ? '<span class="label">All of:</span>' + tagChips : '') +
      (colorChips ? '<span class="label">Colour, any of:</span>' + colorChips : '') +
      '<button type="button" class="btn-icon" id="btn-clear-filters">Clear filters</button>';
  }

  /* ── Toolbar, help, create ───────────────────────────────── */

  /* The "+ New task" button (and the store menu when open). */
  function createButton(position, stores, menuOpen) {
    var multi = (stores || []).length > 1;
    return '<button type="button" class="btn btn-primary btn-sm" data-create="' + esc(position) + '"' +
      (multi ? ' aria-haspopup="menu" aria-expanded="' + (menuOpen ? 'true' : 'false') + '"' : '') + ' title="New task (n)">+ New task</button>' +
      (menuOpen && multi ? storeMenu(stores, position) : '');
  }

  /* options: { stores, menuOpen, allExpanded } */
  function toolbar(position, options) {
    var o = options || {};
    return '<div class="toolbar">' +
      '<div class="create-wrap" id="create-' + esc(position) + '">' + createButton(position, o.stores, o.menuOpen) + '</div>' +
      '<p class="list-status" id="status" role="status" aria-live="polite"></p>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="btn-expand-all">' + (o.allExpanded ? 'Collapse all' : 'Expand all') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="btn-help" aria-expanded="false" aria-controls="help-panel">Shortcuts <kbd>?</kbd></button>' +
      '</div>';
  }

  var HELP_KEYS = [
    ['<kbd>↑</kbd> <kbd>↓</kbd>', 'Move between tasks (crosses pages)'],
    ['<kbd>Enter</kbd>', 'Edit task text'],
    ['<kbd>r</kbd>', 'Edit reference'],
    ['<kbd>Space</kbd>', 'Toggle completed'],
    ['<kbd>→</kbd> <kbd>←</kbd>', 'Expand / collapse'],
    ['<kbd>Alt</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>', 'Move task (priority sort)'],
    ['<kbd>t</kbd>', 'Edit tags'],
    ['<kbd>c</kbd>', 'Choose colour'],
    ['<kbd>n</kbd>', 'New task'],
    ['<kbd>/</kbd>', 'Search'],
    ['<kbd>Del</kbd>', 'Delete (press twice)'],
    ['<kbd>Esc</kbd>', 'Cancel edit / delete'],
    ['<kbd>Shift</kbd>+<kbd>Enter</kbd>', 'New line while editing']
  ];

  function helpPanel() {
    return '<section class="help-panel" id="help-panel" hidden aria-label="Keyboard shortcuts"><dl>' +
      HELP_KEYS.map(function (k) { return '<div><dt>' + k[0] + '</dt><dd>' + esc(k[1]) + '</dd></div>'; }).join('') +
      '</dl></section>';
  }

  /* Store chooser shown when more than one store accepts new tasks. */
  function storeMenu(stores, position) {
    return '<div class="store-menu" role="menu" data-position="' + esc(position) + '" aria-label="Choose the store for the new task">' +
      '<div class="menu-title" aria-hidden="true">Add to store</div>' +
      (stores || []).map(function (s) {
        return '<button type="button" role="menuitem" data-store="' + esc(s.id) + '"><span>' + esc(s.label) + '</span>' +
          '<span class="store-id">' + esc(s.id) + '</span></button>';
      }).join('') + '</div>';
  }

  /* d: { store, storeLabel, ref, text, invalid } */
  function draft(position, d) {
    var label = d.storeLabel || d.store || '';
    var text = d.text || '';
    return '<div class="task-draft" role="group" data-position="' + esc(position) + '" aria-label="' + esc('New task in store ' + label) + '">' +
      '<span class="badge badge-store" title="Target store (cannot be changed later)">' + esc(label) + '</span>' +
      '<input type="text" class="ref-input" data-draft="ref" value="' + esc(d.ref || '') + '" placeholder="Ref" aria-label="Ticket reference (optional)" autocomplete="off" spellcheck="false">' +
      '<textarea data-draft="text" rows="' + Math.max(1, text.split('\n').length) + '" placeholder="Task — Markdown, first line is the title" aria-label="Task text"' +
        (d.invalid ? ' aria-invalid="true"' : '') + '>' + esc(text) + '</textarea>' +
      '<div class="draft-actions"><button type="button" class="btn btn-primary btn-sm" data-draft-act="save">Add</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-draft-act="cancel">Cancel</button></div>' +
      '<p class="draft-hint"><kbd>Enter</kbd> adds · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Esc</kbd> cancels · added by current sorting</p>' +
      '</div>';
  }

  /* ── Rows ────────────────────────────────────────────────── */

  /* Reference cell: an input when editing; otherwise a link plus pencil when
     ticket_url is set, a click-to-edit button when empty or unlinked. */
  function refCell(task, editing) {
    var label = ticketText(task);
    if (editing) {
      return '<input type="text" class="ref-input" data-role="ref-input" value="' + esc(label) +
        '" placeholder="4578 / ABC-12" aria-label="Ticket reference" autocomplete="off" spellcheck="false">';
    }
    if (!label) {
      return '<button type="button" class="ref-empty" data-act="edit-ref" data-rc aria-label="Add ticket reference">+ ref</button>';
    }
    if (task.ticket_url) {
      return '<a href="' + esc(task.ticket_url) + '" target="_blank" rel="noopener noreferrer" data-rc title="Open ticket in a new tab">' + esc(label) + '</a>' +
        '<button type="button" class="btn-icon ref-edit" data-act="edit-ref" data-rc aria-label="' + esc('Edit reference ' + label) + '" title="Edit reference (r)">✎</button>';
    }
    return '<button type="button" class="ref-plain" data-act="edit-ref" data-rc title="Edit reference (r)">' + esc(label) + '</button>';
  }

  function tagChips(task) {
    return (task.tags || []).map(function (g) {
      return '<span class="tag"><button type="button" class="tag-label" data-act="filter-tag" data-tag="' + esc(g) + '" data-rc title="Filter by this tag">' + esc(g) +
        '</button><button type="button" class="tag-remove" data-act="remove-tag" data-tag="' + esc(g) + '" data-rc aria-label="' + esc('Remove tag ' + g) + '">×</button></span>';
    }).join('');
  }

  function details(task, expandedEditingText) {
    var rest = TasksModel.restLines(task.text);
    var shortId = String(task.id).slice(0, 8);
    return '<div class="task-details" id="d-' + esc(task.id) + '">' +
      (rest && !expandedEditingText ? '<div class="task-notes">' + SafeMarkdown.render(rest) + '</div>' : '') +
      '<div class="task-meta"><span class="badge badge-store" title="Store">' + esc(task.store_label || task.store_id) + '</span>' +
      '<span>Created <time datetime="' + esc(task.created_at) + '">' + formatDate(task.created_at) + '</time></span>' +
      (task.completed_at ? '<span>Completed <time datetime="' + esc(task.completed_at) + '">' + formatDate(task.completed_at) + '</time></span>' : '') +
      (task.completion_source ? '<span class="task-source">' + esc(task.completion_source) + '</span>' : '') +
      '<span class="task-id" title="' + esc(task.id) + '">' + esc(shortId) + '</span>' +
      '</div>' +
      '<div class="task-tags" role="group" aria-label="Tags">' + tagChips(task) +
      '<input type="text" class="tag-input" data-role="tag-input" data-rc list="tag-list" placeholder="+ tag" aria-label="Add tag" autocomplete="off" spellcheck="false">' +
      '</div></div>';
  }

  /* One list item: handle, checkbox, reference, colour, text, expand toggle,
     delete. The handle is omitted for the date sorts. */
  function row(task, ui) {
    var u = ui || {};
    var id = task.id;
    var expanded = !!(u.expanded && u.expanded[id]);
    var field = u.editing && u.editing.id === id ? u.editing.field : null;
    var hasNotes = TasksModel.restLines(task.text) !== '';
    var title = TasksModel.firstLine(task.text);
    var cls = 'task' + (task.completed ? ' is-completed' : '') + (u.leaving && u.leaving[id] ? ' is-leaving' : '') +
      (u.activeId === id ? ' is-active' : '') + (u.flash === id ? ' is-flash' : '');

    var text = field === 'text'
      ? '<textarea class="text-input" data-role="text-input" aria-label="Task text (Markdown). First line is the title." rows="' +
        Math.max(1, task.text.split('\n').length) + '">' + esc(task.text) + '</textarea>'
      : '<div class="task-text" data-act="edit-text" title="Click to edit">' +
        (title.trim() ? SafeMarkdown.renderInline(title) : '<span class="empty">(empty)</span>') + '</div>';

    var del = u.armed === id
      ? '<button type="button" class="btn btn-danger btn-sm task-delete is-armed" data-act="delete" data-rc>Confirm</button>'
      : '<button type="button" class="btn-icon task-delete" data-act="delete" data-rc aria-label="Delete task" title="Delete (Del)">' + ICON_TRASH + '</button>';

    var handle = (!u.sort || u.sort === 'priority')
      ? '<span class="task-handle" data-role="handle" aria-hidden="true" title="Drag to reorder (Alt+↑/↓)">' + ICON_GRIP + '</span>'
      : '';

    return '<li class="' + cls + '" data-id="' + esc(id) + '" tabindex="-1">' +
      handle +
      '<input type="checkbox" class="task-check" data-act="complete" data-rc' + (task.completed ? ' checked' : '') + ' aria-label="Completed">' +
      '<span class="task-ref">' + refCell(task, field === 'ref') + '</span>' +
      colorCell(task, u.palette === id) +
      text +
      '<button type="button" class="btn-icon task-toggle' + (hasNotes ? ' has-more' : '') + '" data-act="toggle" data-rc aria-expanded="' + (expanded ? 'true' : 'false') + '"' +
        (expanded ? ' aria-controls="d-' + esc(id) + '"' : '') +
        ' aria-label="' + (expanded ? 'Collapse' : 'Expand') + ' details' + (hasNotes ? ' (has notes)' : '') + '">' + (expanded ? '−' : '+') + '</button>' +
      del +
      (expanded ? details(task, field === 'text') : '') +
      '</li>';
  }

  /* ── Pagination and empty state ──────────────────────────── */

  /* p: TasksModel.pageOf result. options: { pageSize, pageSizes, stores,
     menuOpen } — the bottom create button sits in the same row. */
  function pagination(p, options) {
    var o = options || {};
    var sizes = o.pageSizes || [20, 50, 100];
    var info = p.total ? (p.start + 1) + '–' + (p.start + p.items.length) + ' of ' + p.total : '0 tasks';
    var html = '<button type="button" class="pagination-btn" data-page="' + (p.page - 1) + '"' + (p.page <= 1 ? ' disabled' : '') + ' aria-label="Previous page">‹</button>';
    for (var i = 1; i <= p.pages; i++) {
      if (p.pages > 7 && i !== 1 && i !== p.pages && Math.abs(i - p.page) > 1) {
        if (i === 2 || i === p.pages - 1) { html += '<span class="pagination-ellipsis">…</span>'; }
        continue;
      }
      html += '<button type="button" class="pagination-btn' + (i === p.page ? ' active' : '') + '" data-page="' + i + '"' +
        (i === p.page ? ' aria-current="page"' : '') + ' aria-label="Page ' + i + '">' + i + '</button>';
    }
    html += '<button type="button" class="pagination-btn" data-page="' + (p.page + 1) + '"' + (p.page >= p.pages ? ' disabled' : '') + ' aria-label="Next page">›</button>';

    return '<div class="pagination-row">' +
      '<div class="create-wrap is-bottom" id="create-bottom">' + createButton('bottom', o.stores, o.menuOpen) + '</div>' +
      '<span class="pagination-info" id="page-info">' + esc(info) + '</span>' +
      '<nav class="pagination" id="pagination" aria-label="Pagination">' + html + '</nav>' +
      '<div class="page-size-row"><label for="page-size">Per page:</label><select id="page-size">' +
        sizes.map(function (n) { return option(String(n), String(n), n === o.pageSize); }).join('') +
      '</select></div></div>';
  }

  function emptyState(hasFilters) {
    if (hasFilters) {
      return '<li class="task-empty">No tasks match the current filters.<br>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-empty-clear>Clear filters</button></li>';
    }
    return '<li class="task-empty">No tasks yet. Use “+ New task” to add one.</li>';
  }

  return {
    filterBar: filterBar,
    activeFilters: activeFilters,
    toolbar: toolbar,
    createButton: createButton,
    helpPanel: helpPanel,
    colorCell: colorCell,
    palette: palette,
    row: row,
    refCell: refCell,
    draft: draft,
    storeMenu: storeMenu,
    pagination: pagination,
    emptyState: emptyState
  };
})();
