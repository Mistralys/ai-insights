/* ============================================================
   views/tasks.js — Tasks view controller
   Section 4h of the MCP Server Dashboard SPA
   Depends on: API (api-client.js), escapeHtml, showLoading, showError
               (utils.js), TasksModel (views/tasks-model.js),
               TasksRender (views/tasks-render.js)

   Loads every task once (`API.getTasks()`) and keeps filtering, sorting and
   paging client-side through TasksModel; markup comes from TasksRender.
   This file owns the UI state, the event wiring and the server calls.

   Module-level state:
     tasksPersist          filter, sort, page and page size; survives a
                           re-render and a visit to another tab.
     tasks*Handler         the document / window listeners of the live view.
                           Removed before they are re-added (GUI §2) and
                           self-removing once `#tasks-root` has left the DOM.

   Reordering (handle drag & drop, Alt+Up/Down) lives here; both apply the new
   priorities optimistically, POST them with `API.reorderTasks` and re-fetch
   the collection when the request fails or reports `failed[]`.

   Colour: one palette element (`#palette`) lives inside `#tasks-root` and serves two
   modes: 'set' (the colour of one task) and 'filter' (the colour filter). Its clicks
   stop propagation, and the document-level closer ignores detached targets, because
   toggling in filter mode re-renders the palette and detaches the clicked swatch.
   ============================================================ */

/* The persisted part of the view state. Replaced in place, never reassigned,
   so closures that captured it stay valid. */
var tasksPersist = {
  filter: { q: '', status: 'open', store: '', tags: [], colors: [] },
  sort: 'priority',
  page: 1,
  pageSize: 0   /* 0 = not seeded yet; set from settings.page_size */
};

var tasksKeydownHandler = null;
var tasksClickHandler = null;
var tasksVisibilityHandler = null;
var tasksResizeHandler = null;

/* Removes the document and window listeners of a previous render (GUI §2). */
function tasksRemoveGlobalHandlers() {
  if (tasksKeydownHandler) { document.removeEventListener('keydown', tasksKeydownHandler); tasksKeydownHandler = null; }
  if (tasksClickHandler) { document.removeEventListener('click', tasksClickHandler); tasksClickHandler = null; }
  if (tasksVisibilityHandler) { document.removeEventListener('visibilitychange', tasksVisibilityHandler); tasksVisibilityHandler = null; }
  if (tasksResizeHandler) { window.removeEventListener('resize', tasksResizeHandler); tasksResizeHandler = null; }
}

function renderTasks(app) {
  tasksRemoveGlobalHandlers();
  showLoading(app);
  API.getTasks().then(function (data) {
    /* The route may have changed while the request was in flight. */
    if (!app.querySelector('.loading')) { return; }
    tasksBuildView(app, data);
  }).catch(function (err) {
    if (!app.querySelector('.loading')) { return; }
    showError(app, (err && err.message) || 'Failed to load tasks');
  });
}

/* Builds the view for one payload of `API.getTasks()`: the skeleton, the
   closure state and every listener. */
function tasksBuildView(app, data) {
  var persist = tasksPersist;
  var tasks = data.tasks || [];
  var stores = data.stores || [];
  var settings = data.settings || {};
  var storeErrors = data.store_errors || [];

  if (!persist.pageSize) { persist.pageSize = settings.page_size || 20; }

  var LEAVE_MS = 700;
  var ARMED_MS = 3000;
  var ANNOUNCE_MS = 5000;
  var REF_HINT = 'Reference must be a number (4578) or QUEUE-number (ABC-12).';

  /* ── View state (not persisted) ──────────────────────────── */
  var ui = {
    sort: persist.sort,
    expanded: {},        /* id -> true */
    editing: null,       /* { id, field: 'text' | 'ref' } */
    refSaving: false,    /* a reference save is in flight */
    armed: null,         /* id whose delete button reads "Confirm" */
    activeId: null,
    leaving: {},         /* id -> true while a row is dismissed */
    flash: null,
    menu: null,          /* 'top' | 'bottom' while the store menu is open */
    draft: null,         /* { position, store, storeLabel, ref, text, invalid } */
    paletteMode: null,   /* 'set' | 'filter' | null — owned by the colour interaction */
    palette: null,       /* id of the task whose palette is open */
    dragId: null,        /* id of the row being dragged (armed by its handle) */
    rendering: false
  };
  var armedTimer = null;
  var announceTimer = null;

  /* ── Skeleton ────────────────────────────────────────────── */
  app.innerHTML =
    '<div id="tasks-root" class="tasks-view">' +
      '<div class="page-head"><h1>Tasks</h1><span class="counts" id="counts"></span></div>' +
      '<div id="store-errors"></div>' +
      '<div id="filter-slot"></div>' +
      '<div class="active-filters" id="active-filters" aria-label="Active filters"></div>' +
      TasksRender.toolbar('top', { stores: stores, menuOpen: false, allExpanded: false }) +
      TasksRender.helpPanel() +
      '<div class="draft-slot-top" id="draft-top"></div>' +
      '<p id="list-hint" class="visually-hidden">Use up and down arrows to move between tasks. Press question mark for all keyboard shortcuts.</p>' +
      '<ul class="task-list" id="task-list" aria-label="Tasks" aria-describedby="list-hint"></ul>' +
      '<div class="draft-slot-bottom" id="draft-bottom"></div>' +
      '<div id="pagination-slot"></div>' +
    '</div>';

  var root = document.getElementById('tasks-root');
  var listEl = root.querySelector('#task-list');
  var statusEl = root.querySelector('#status');

  /* ── Helpers ─────────────────────────────────────────────── */

  /** Element of the view by id.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root` — read-only; the search scope. */
  function $(id) { return root.querySelector('#' + id); }

  /** True while this view is still the one on screen.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root` — read-only. */
  function alive() { return document.body.contains(root) && document.getElementById('tasks-root') === root; }

  /** The task with the id, or null.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks` — read-only. */
  function byId(id) {
    for (var i = 0; i < tasks.length; i++) { if (tasks[i].id === id) { return tasks[i]; } }
    return null;
  }

  /** Replaces a task by the server's version of it.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks` — mutated; the element with the same id is replaced. */
  function mergeTask(updated) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === updated.id) { tasks[i] = updated; return; }
    }
  }

  /** Label of a store id.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `stores` — read-only. */
  function storeLabel(id) {
    for (var i = 0; i < stores.length; i++) { if (stores[i].id === id) { return stores[i].label; } }
    return id;
  }

  /** Posts a message to the live region; it clears itself after a while.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `statusEl`      — mutated; text content.
   *    `announceTimer` — mutated; the clearing timer. */
  function announce(message) {
    statusEl.textContent = message;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { statusEl.textContent = ''; }, ANNOUNCE_MS);
  }

  /** The error message of a rejected API call.
   *  Pure helper — no closure dependencies. */
  function errorText(err, fallback) { return (err && err.message) || fallback; }

  /** The state object TasksModel and TasksRender read.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist` — read-only.
   *    `ui`      — read-only; `leaving` and `paletteMode`. */
  function modelState() {
    return { filter: persist.filter, sort: persist.sort, leaving: ui.leaving, paletteMode: ui.paletteMode };
  }

  /** The filtered, sorted list and the current page of it.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks`   — read-only.
   *    `persist` — read-only.
   *    (`modelState` — read-only helper.) */
  function currentPage() {
    var list = TasksModel.visibleTasks(tasks, modelState());
    return { list: list, p: TasksModel.pageOf(list, persist.page, persist.pageSize) };
  }

  /** True when the collection holds any task at all; the empty state uses it
   *  to tell "no tasks yet" from "everything is filtered out".
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks` — read-only. */
  function hasTasks() { return tasks.length > 0; }

  /** Page sizes offered by the selector: the usual ones plus the configured one.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist` — read-only. */
  function pageSizes() {
    var sizes = [20, 50, 100];
    if (sizes.indexOf(persist.pageSize) === -1) { sizes.push(persist.pageSize); }
    return sizes.sort(function (a, b) { return a - b; });
  }

  /** Grows a text area to its content.
   *  Pure helper — no closure dependencies. */
  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }

  /* ── Rendering ───────────────────────────────────────────── */

  /** Applies the reference column width and the store-error banner.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root`        — mutated; the `--task-ref-width` custom property.
   *    `tasks`       — read-only.
   *    `storeErrors` — read-only. */
  function renderChrome() {
    root.style.setProperty('--task-ref-width', TasksModel.refColumnWidth(tasks) + 'ch');
    var html = '';
    if (storeErrors.length) {
      html = '<div class="tasks-store-errors" role="alert"><strong>Some stores could not be read:</strong> ' +
        storeErrors.map(function (e) {
          return escapeHtml(e.store_label || e.store_id) + (e.message ? ' (' + escapeHtml(e.message) + ')' : '');
        }).join('; ') + '</div>';
    }
    $('store-errors').innerHTML = html;
  }

  /** Rebuilds the whole filter bar from the persisted filter.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root`, `tasks`, `stores`, `persist`, `ui` — read-only (via modelState). */
  function buildFilterBar() {
    $('filter-slot').innerHTML = TasksRender.filterBar(modelState(), stores, TasksModel.allTags(tasks));
  }

  /** Updates the parts of the filter area that change with the data.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks` — read-only.
   *    (`modelState`, `$` — read-only helpers.) */
  function renderFilters() {
    $('active-filters').innerHTML = TasksRender.activeFilters(modelState());
    var datalist = $('tag-list');
    if (datalist) {
      datalist.innerHTML = TasksModel.allTags(tasks).map(function (g) {
        return '<option value="' + escapeHtml(g) + '">';
      }).join('');
    }
    var open = 0;
    tasks.forEach(function (t) { if (!t.completed) { open++; } });
    $('counts').textContent = open + ' open · ' + (tasks.length - open) + ' completed';
  }

  /** Reads the row element of a task.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `listEl` — read-only. */
  function rowEl(id) {
    if (!id) { return null; }
    var rows = listEl.querySelectorAll('.task');
    for (var i = 0; i < rows.length; i++) { if (rows[i].getAttribute('data-id') === id) { return rows[i]; } }
    return null;
  }

  /** Roving tabindex: only the active row and its controls are tabbable.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `listEl` — mutated; tabindex and `is-active` of rows and controls.
   *    `ui`     — read-only; `activeId`. */
  function applyRoving() {
    var rows = listEl.querySelectorAll('.task');
    for (var i = 0; i < rows.length; i++) {
      var on = rows[i].getAttribute('data-id') === ui.activeId;
      rows[i].tabIndex = on ? 0 : -1;
      rows[i].classList.toggle('is-active', on);
      var controls = rows[i].querySelectorAll('[data-rc]');
      for (var j = 0; j < controls.length; j++) { controls[j].tabIndex = on ? 0 : -1; }
    }
  }

  /** Makes a row the active one.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated; `activeId`. (`applyRoving` — helper.) */
  function setActive(id) {
    if (ui.activeId === id) { return; }
    ui.activeId = id;
    applyRoving();
  }

  /** Focuses a row, or a control inside it (`data-role` / `data-act` key).
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`rowEl`, `autosize` — read-only helpers.) */
  function focusIn(id, key) {
    var li = rowEl(id);
    if (!li) { return; }
    if (!key || key === 'row') { li.focus(); return; }
    var el = li.querySelector('[data-role="' + key + '"], [data-act="' + key + '"]');
    (el || li).focus();
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.type !== 'checkbox') {
      var len = el.value.length;
      try { el.setSelectionRange(len, len); } catch (e) { /* not a text control */ }
      if (el.tagName === 'TEXTAREA') { autosize(el); }
    }
  }

  /** The `ui` object in the shape TasksRender.row expects.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`      — mutated; `sort` is synced from the persisted sort.
   *    `persist` — read-only. */
  function rowUi() {
    ui.sort = persist.sort;
    return ui;
  }

  /** Re-renders the whole list, pagination, create buttons and drafts.
   *  opts.focus: true (active row), a focus key, or false/undefined (none).
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `persist` — mutated (`activeId`, `flash`, `rendering`, `page`).
   *    `listEl`, `root` — mutated; innerHTML.
   *    `stores` — read-only. */
  function render(opts) {
    opts = opts || {};
    var pageSizeHadFocus = document.activeElement && document.activeElement.id === 'page-size';
    ui.rendering = true;
    renderFilters();
    var cp = currentPage();
    var p = cp.p;
    persist.page = p.page;
    if (!p.items.some(function (t) { return t.id === ui.activeId; })) {
      ui.activeId = p.items.length ? p.items[0].id : null;
    }
    var rui = rowUi();
    listEl.innerHTML = p.items.length
      ? p.items.map(function (t) { return TasksRender.row(t, rui); }).join('')
      : TasksRender.emptyState(hasTasks());
    listEl.classList.toggle('is-date-sorted', persist.sort !== 'priority');
    applyRoving();
    $('pagination-slot').innerHTML = TasksRender.pagination(p, {
      pageSize: persist.pageSize, pageSizes: pageSizes(), stores: stores, menuOpen: ui.menu === 'bottom'
    });
    $('create-top').innerHTML = TasksRender.createButton('top', stores, ui.menu === 'top');
    $('draft-top').innerHTML = ui.draft && ui.draft.position === 'top' ? TasksRender.draft('top', ui.draft) : '';
    $('draft-bottom').innerHTML = ui.draft && ui.draft.position === 'bottom' ? TasksRender.draft('bottom', ui.draft) : '';
    var allExpanded = p.items.length > 0 && p.items.every(function (t) { return ui.expanded[t.id]; });
    $('btn-expand-all').textContent = allExpanded ? 'Collapse all' : 'Expand all';
    ui.flash = null;
    ui.rendering = false;
    if (pageSizeHadFocus) { $('page-size').focus(); }
    if (opts.focus) { focusIn(ui.activeId, opts.focus === true ? 'row' : opts.focus); }
    if (ui.paletteMode === 'set' && !rowEl(ui.palette)) { closePalette(false); } else { positionPalette(); }
  }

  /** Re-renders one row in place, keeping focus on the equivalent control.
   *  focusKey: undefined keeps the focused control, null drops focus.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`rendering`).
   *    (`rowEl`, `byId`, `rowUi`, `applyRoving`, `focusIn` — helpers.) */
  function rerenderRow(id, focusKey) {
    var li = rowEl(id);
    var t = byId(id);
    if (!li || !t) { return; }
    var active = document.activeElement;
    var key = null;
    if (li.contains(active)) {
      key = active === li ? 'row' : (active.getAttribute('data-act') || active.getAttribute('data-role') || 'row');
    }
    ui.rendering = true;
    li.outerHTML = TasksRender.row(t, rowUi());
    applyRoving();
    ui.rendering = false;
    var target = focusKey !== undefined ? focusKey : key;
    if (target) { focusIn(id, target); }
  }

  /** The element a palette is anchored to: the dot of the task, or the Colour filter button.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — read-only; `paletteMode`, `palette`. (`rowEl`, `$` — helpers.) */
  function paletteAnchor() {
    if (ui.paletteMode === 'filter') { return $('f-color'); }
    var li = ui.palette && rowEl(ui.palette);
    return li ? li.querySelector('[data-act="color"]') : null;
  }

  /** Re-places an open palette below its anchor, flipped above near the viewport bottom.
   *  The palette is absolutely positioned inside `#tasks-root`, so it scrolls with the page.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `root` — read-only; `paletteMode`; the root's rectangle.
   *    (`paletteAnchor`, `$` — helpers.) */
  function positionPalette() {
    if (!ui.paletteMode) { return; }
    var el = $('palette');
    var anchor = paletteAnchor();
    if (!el || !anchor) { return; }
    var a = anchor.getBoundingClientRect();
    var r = root.getBoundingClientRect();
    var pos = TasksModel.palettePosition(
      { left: a.left, top: a.top, bottom: a.bottom },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    el.style.left = Math.round(pos.left - r.left) + 'px';
    el.style.top = Math.round(pos.top - r.top) + 'px';
    el.classList.toggle('is-flipped', pos.flipped);
  }

  /** Controls of the open palette that can take focus, in navigation order.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`$` — helper.) */
  function paletteItems() {
    var el = $('palette');
    return el ? Array.prototype.slice.call(el.querySelectorAll('[data-pal]:not([disabled])')) : [];
  }

  /** Focuses the palette control with a colour key (`none`, `''`); with `undefined` the
   *  selected one; otherwise the first.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`paletteItems`, `$` — helpers.) */
  function focusPalette(colorKey) {
    var items = paletteItems();
    var hit = null;
    items.forEach(function (b) {
      if (hit) { return; }
      if (colorKey === undefined ? b.getAttribute('aria-pressed') === 'true' : b.getAttribute('data-color') === colorKey) { hit = b; }
    });
    (hit || items[0] || $('palette')).focus();
  }

  /** (Re)builds the palette content for the current mode and re-places it.
   *  `focusKey`: a colour key to focus, null for the first control, undefined for the
   *  selected one; `false` keeps focus where it is.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `persist` — read-only. (`$`, `byId`, `positionPalette`, `focusPalette` — helpers.) */
  function renderPalette(focusKey) {
    var el = $('palette');
    if (!el || !ui.paletteMode) { return; }
    var t = ui.paletteMode === 'set' ? byId(ui.palette) : null;
    el.innerHTML = TasksRender.palette(ui.paletteMode, ui.paletteMode === 'set' ? ((t && t.color) || '') : persist.filter.colors);
    positionPalette();
    if (focusKey !== false) { focusPalette(focusKey); }
  }

  /** Closes the palette; optionally returns focus to the dot or the Colour button.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`paletteMode`, `palette`); the palette element is removed.
   *    (`$`, `rowEl`, `focusIn` — helpers.) */
  function closePalette(focusBack) {
    var mode = ui.paletteMode;
    if (!mode) { return; }
    var id = ui.palette;
    ui.paletteMode = null;
    ui.palette = null;
    var el = $('palette');
    if (el) { el.remove(); }
    var btn = mode === 'filter' ? $('f-color') : (rowEl(id) && rowEl(id).querySelector('[data-act="color"]'));
    if (btn) { btn.setAttribute('aria-expanded', 'false'); }
    if (focusBack) {
      if (mode === 'filter') { if (btn) { btn.focus(); } } else { focusIn(id, 'color'); }
    }
  }

  /** Opens the one palette in a mode, replacing an open one.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `root` — mutated (`paletteMode`, `palette`; the element is appended).
   *    (`closePalette`, `setActive`, `byId`, `paletteAnchor`, `renderPalette`,
   *     `paletteKeydown`, `paletteClick` — helpers.) */
  function openPalette(mode, id) {
    if (mode === 'set' && !byId(id)) { return; }
    if (ui.paletteMode) { closePalette(false); }
    ui.paletteMode = mode;
    ui.palette = mode === 'set' ? id : null;
    if (mode === 'set') { setActive(id); }
    var el = document.createElement('div');
    el.id = 'palette';
    el.className = 'palette';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', mode === 'set' ? 'Task colour' : 'Colour filter');
    el.addEventListener('click', paletteClick);
    el.addEventListener('keydown', paletteKeydown);
    root.appendChild(el);
    var anchor = paletteAnchor();
    if (anchor) { anchor.setAttribute('aria-expanded', 'true'); }
    renderPalette();
  }

  /** Opens the row palette, or closes it when it is already open for the task.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — read-only. (`openPalette`, `closePalette` — helpers.) */
  function togglePalette(id) {
    if (ui.paletteMode === 'set' && ui.palette === id) { closePalette(true); } else { openPalette('set', id); }
  }

  /** Sets the colour of a task: optimistic, reverted when the request fails. A task that
   *  leaves the colour filter stays for LEAVE_MS, like a completed one.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`leaving`, `activeId`). `persist`, `tasks`, `listEl` — read-only.
   *    (`byId`, `closePalette`, `announce`, `saveTask`, `render`, `rerenderRow`,
   *     `neighbourId`, `alive` — helpers.) */
  function setColor(id, color) {
    var t = byId(id);
    if (!t) { closePalette(false); return; }
    var previous = t.color || '';
    if (previous === color) { closePalette(true); return; }
    var col = TasksModel.colorById(color);
    t.color = color;
    closePalette(false);
    announce(col ? 'Colour set to ' + col.name : 'Colour removed');
    var stillShown = TasksModel.visibleTasks(tasks, { filter: persist.filter, sort: persist.sort, leaving: {} })
      .some(function (x) { return x.id === id; });
    if (stillShown) {
      rerenderRow(id, 'color');
    } else {
      ui.leaving[id] = true;
      render({ focus: 'color' });
      setTimeout(function () {
        if (!alive() || !ui.leaving[id]) { return; }
        delete ui.leaving[id];
        var refocus = listEl.contains(document.activeElement) || document.activeElement === document.body;
        if (ui.activeId === id) { ui.activeId = neighbourId(id); }
        render({ focus: refocus });
      }, LEAVE_MS);
    }
    saveTask(id, { color: color }, null, function () {
      t.color = previous;
      delete ui.leaving[id];
      render({ focus: 'color' });
    });
  }

  /** Toggles one colour key of the colour filter, or clears it (`key` null); the palette stays open.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist` — mutated (`filter.colors`, `page`).
   *    (`buildFilterBar`, `render`, `renderPalette`, `announce`, `currentPage` — helpers.) */
  function changeColorFilter(key) {
    persist.filter.colors = key === null ? [] : TasksModel.toggleColor(persist.filter.colors, key);
    persist.page = 1;
    buildFilterBar();
    render();
    renderPalette(key);
    announce(persist.filter.colors.length
      ? currentPage().list.length + ' tasks match the colour filter'
      : 'Colour filter cleared');
  }

  /** Click inside the palette. Propagation stops first: the handlers below rebuild the
   *  palette, which detaches the clicked swatch before the click reaches the document.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — read-only. (`setColor`, `changeColorFilter` — helpers.) */
  function paletteClick(e) {
    e.stopPropagation();
    var b = e.target.closest && e.target.closest('[data-pal]');
    if (!b || b.disabled) { return; }
    if (ui.paletteMode === 'set') { setColor(ui.palette, b.getAttribute('data-color')); return; }
    if (b.hasAttribute('data-color-clear')) { changeColorFilter(null); return; }
    changeColorFilter(b.getAttribute('data-color'));
  }

  /** Keyboard inside the palette: arrows, Home and End move; Esc and Tab close; `c` is swallowed.
   *  Every handled key stops propagation so the row and global shortcuts never see it.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`paletteItems`, `closePalette` — helpers.) */
  function paletteKeydown(e) {
    var k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (k === 'Escape' || k === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      closePalette(true);
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
      e.preventDefault(); e.stopPropagation();
      var items = paletteItems();
      var next = items[TasksModel.paletteMove(items.indexOf(document.activeElement), k, items.length)];
      if (next) { next.focus(); }
    } else if (k === 'c' || k === 'C') {
      e.preventDefault(); e.stopPropagation();
    }
  }

  /* ── Server calls ────────────────────────────────────────── */

  /** PATCHes a task and merges the answer; failures are announced.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`mergeTask`, `announce`, `alive` — helpers.) */
  function saveTask(id, body, onDone, onFail) {
    API.updateTask(id, body).then(function (updated) {
      if (!alive()) { return; }
      mergeTask(updated);
      if (onDone) { onDone(updated); }
    }).catch(function (err) {
      if (!alive()) { return; }
      announce(errorText(err, 'The task could not be saved.'));
      if (onFail) { onFail(err); }
    });
  }

  /** Re-fetches the collection and re-renders when something changed.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks`, `stores`, `settings`, `storeErrors` — mutated; replaced by the new payload.
   *    `listEl` — read-only; focus check.
   *    (`alive`, `renderChrome`, `buildFilterBar`, `render` — helpers.) */
  function refetch() {
    API.getTasks().then(function (next) {
      if (!alive()) { return; }
      var nextTasks = next.tasks || [];
      var nextStores = next.stores || [];
      var nextErrors = next.store_errors || [];
      var same = JSON.stringify(nextTasks) === JSON.stringify(tasks) &&
        JSON.stringify(nextStores) === JSON.stringify(stores) &&
        JSON.stringify(nextErrors) === JSON.stringify(storeErrors);
      if (same) { return; }
      var storesChanged = JSON.stringify(nextStores) !== JSON.stringify(stores);
      var hadFocus = listEl.contains(document.activeElement);
      tasks = nextTasks;
      stores = nextStores;
      settings = next.settings || settings;
      storeErrors = nextErrors;
      renderChrome();
      if (storesChanged) { buildFilterBar(); }
      render({ focus: hadFocus });
    }).catch(function () { /* a failed background refresh keeps the current list */ });
  }

  /* ── Actions: editing ────────────────────────────────────── */

  /** Starts editing the text or reference of a row.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`editing`).
   *    (`commitEdit`, `setActive`, `rerenderRow` — helpers.) */
  function startEdit(id, field) {
    if (ui.editing && ui.editing.id === id && ui.editing.field === field) { focusIn(id, field === 'text' ? 'text-input' : 'ref-input'); return; }
    if (ui.editing) { commitEdit(false); }
    if (ui.editing) { return; }   /* a reference edit that failed validation stays open */
    ui.editing = { id: id, field: field };
    setActive(id);
    rerenderRow(id, field === 'text' ? 'text-input' : 'ref-input');
  }

  /** Saves the edit in progress. fullRender (Enter) re-sorts and focuses the row;
   *  a blur only re-renders the row so a click elsewhere is not swallowed.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`editing`, `refSaving`).
   *    (`rowEl`, `byId`, `announce`, `saveTask`, `render`, `rerenderRow`,
   *     `mergeTask`, `errorText`, `alive` — helpers.) */
  function commitEdit(fullRender) {
    var ed = ui.editing;
    if (!ed || ui.refSaving) { return; }
    var li = rowEl(ed.id);
    var t = byId(ed.id);
    var el = li && li.querySelector('[data-role="' + (ed.field === 'text' ? 'text-input' : 'ref-input') + '"]');
    if (!t || !el) { ui.editing = null; return; }

    if (ed.field === 'text') {
      var value = el.value.replace(/\s+$/, '');
      ui.editing = null;
      if (!value.trim()) {
        announce('Task text cannot be empty — edit cancelled.');
      } else if (value !== t.text) {
        var previous = t.text;
        t.text = value;
        announce('Task updated');
        saveTask(ed.id, { text: value }, function () {
          if (fullRender) { render({ focus: true }); }
        }, function () {
          t.text = previous;
          rerenderRow(ed.id, null);
        });
      }
      if (fullRender) { render({ focus: true }); } else { rerenderRow(ed.id, null); }
      return;
    }

    /* Reference: the server validates and normalises, so wait for the answer. */
    var raw = el.value.trim();
    var current = t.ticket_label || t.reference || '';
    if (raw === current) {
      ui.editing = null;
      if (fullRender) { render({ focus: true }); } else { rerenderRow(ed.id, null); }
      return;
    }
    ui.refSaving = true;
    API.updateTask(ed.id, { reference: raw === '' ? null : raw }).then(function (updated) {
      ui.refSaving = false;
      if (!alive()) { return; }
      mergeTask(updated);
      ui.editing = null;
      announce(updated.ticket_label ? 'Reference set to ' + updated.ticket_label : 'Reference removed');
      if (fullRender) { render({ focus: true }); } else { rerenderRow(ed.id, null); }
    }).catch(function (err) {
      ui.refSaving = false;
      if (!alive()) { return; }
      var input = rowEl(ed.id) && rowEl(ed.id).querySelector('[data-role="ref-input"]');
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (fullRender) { input.focus(); }
      }
      announce(errorText(err, REF_HINT));
    });
  }

  /** Cancels the edit in progress without saving.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`editing`). (`rerenderRow` — helper.) */
  function cancelEdit() {
    var ed = ui.editing;
    if (!ed) { return; }
    ui.editing = null;
    rerenderRow(ed.id, 'row');
  }

  /** Expands or collapses the details of a row.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`expanded`). (`rerenderRow` — helper.) */
  function toggleExpand(id, force, focusKey) {
    var on = force === undefined ? !ui.expanded[id] : force;
    if (on) { ui.expanded[id] = true; } else { delete ui.expanded[id]; }
    rerenderRow(id, focusKey);
  }

  /** The id of the row after (or else before) a row.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`rowEl` — helper.) */
  function neighbourId(id) {
    var li = rowEl(id);
    if (!li) { return null; }
    var n = li.nextElementSibling || li.previousElementSibling;
    return (n && n.getAttribute('data-id')) || null;
  }

  /* ── Actions: completion and delete ──────────────────────── */

  /** Toggles completion. A task that leaves the filter stays visible
   *  (struck through) for LEAVE_MS, then focus moves to its neighbour.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`leaving`, `activeId`).
   *    `listEl`, `persist`, `tasks` — read-only.
   *    (`byId`, `saveTask`, `announce`, `render`, `rerenderRow`, `neighbourId`,
   *     `modelState`, `alive` — helpers.) */
  function toggleComplete(id) {
    var t = byId(id);
    if (!t) { return; }
    var want = !t.completed;
    var hadFocus = listEl.contains(document.activeElement);
    saveTask(id, { completed: want }, function (updated) {
      announce(updated.completed ? 'Task completed' : 'Task reopened');
      var stillShown = TasksModel.visibleTasks(tasks, { filter: persist.filter, sort: persist.sort, leaving: {} })
        .some(function (x) { return x.id === id; });
      if (stillShown) { render({ focus: hadFocus ? 'complete' : false }); return; }
      ui.leaving[id] = true;
      render({ focus: hadFocus ? 'complete' : false });
      setTimeout(function () {
        if (!alive()) { return; }
        delete ui.leaving[id];
        var refocus = listEl.contains(document.activeElement) || (hadFocus && document.activeElement === document.body);
        if (ui.activeId === id) { ui.activeId = neighbourId(id); }
        render({ focus: refocus });
      }, LEAVE_MS);
    }, function () {
      rerenderRow(id, null);
    });
  }

  /** Reverts an armed delete button.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `armedTimer` — mutated. (`rerenderRow` — helper.) */
  function disarm(restoreFocus) {
    clearTimeout(armedTimer);
    var id = ui.armed;
    if (!id) { return; }
    ui.armed = null;
    rerenderRow(id, restoreFocus ? undefined : null);
  }

  /** First activation arms the delete button, the second deletes.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `armedTimer`, `tasks` — mutated.
   *    (`disarm`, `rerenderRow`, `announce`, `neighbourId`, `render`,
   *     `alive`, `errorText` — helpers.) */
  function deleteAction(id) {
    if (ui.armed !== id) {
      if (ui.armed) { disarm(false); }
      ui.armed = id;
      rerenderRow(id);
      clearTimeout(armedTimer);
      armedTimer = setTimeout(function () { if (ui.armed === id) { disarm(true); } }, ARMED_MS);
      announce('Press Delete again, or click Confirm, to delete this task.');
      return;
    }
    clearTimeout(armedTimer);
    ui.armed = null;
    var next = neighbourId(id);
    API.deleteTask(id).then(function () {
      if (!alive()) { return; }
      tasks = tasks.filter(function (t) { return t.id !== id; });
      delete ui.expanded[id];
      ui.activeId = next;
      announce('Task deleted');
      render({ focus: true });
    }).catch(function (err) {
      if (!alive()) { return; }
      announce(errorText(err, 'The task could not be deleted.'));
      rerenderRow(id, null);
    });
  }

  /* ── Actions: reordering ─────────────────────────────────── */

  /** Sends priority assignments; reloads from the server when the request
   *  fails or a store reports `failed[]` (a batch can apply partially).
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`announce`, `alive`, `errorText`, `refetch` — helpers.) */
  function persistOrder(assignments) {
    API.reorderTasks(assignments).then(function (result) {
      if (!alive()) { return; }
      if (result && result.failed && result.failed.length) {
        announce('Some tasks could not be reordered — reloading.');
        refetch();
      }
    }).catch(function (err) {
      if (!alive()) { return; }
      announce(errorText(err, 'The new order could not be saved — reloading.'));
      refetch();
    });
  }

  /** Writes assignments into the local tasks (the optimistic update).
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `tasks` — mutated; `priority`. (`byId` — helper.) */
  function applyPriorities(assignments) {
    assignments.forEach(function (a) {
      var t = byId(a.id);
      if (t) { t.priority = a.priority; }
    });
  }

  /** Moves a task one place in the filtered priority list, crossing pages.
   *  Outside the priority sort it only announces.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist`, `ui` — `page` and `activeId` mutated.
   *    (`announce`, `modelState`, `applyPriorities`, `persistOrder`, `render` — helpers.) */
  function moveTask(id, dir) {
    if (persist.sort !== 'priority') {
      announce('Reordering is only available when sorted by priority.');
      return;
    }
    var list = TasksModel.visibleTasks(tasks, modelState());
    var swap = TasksModel.swapWithNeighbour(list, id, dir);
    if (!swap) { announce(dir < 0 ? 'Already at the top.' : 'Already at the bottom.'); return; }
    applyPriorities(swap.assignments);
    var where = TasksModel.placementOf(TasksModel.visibleTasks(tasks, modelState()), id, persist.pageSize);
    if (where.page) { persist.page = where.page; }
    ui.activeId = id;
    render({ focus: true });
    announce('Task moved ' + (dir < 0 ? 'up' : 'down') + '.');
    persistOrder(swap.assignments);
  }

  /** Drops the dragged row before or after a target row, within the page.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`activeId`). `tasks` — read-only.
   *    (`currentPage`, `applyPriorities`, `persistOrder`, `render`, `announce` — helpers.) */
  function dropRow(dragId, targetId, before) {
    if (dragId === targetId) { return; }
    var ids = currentPage().p.items.map(function (t) { return t.id; });
    if (ids.indexOf(dragId) === -1 || ids.indexOf(targetId) === -1) { return; }
    ids.splice(ids.indexOf(dragId), 1);
    ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, dragId);
    var byIdMap = {};
    tasks.forEach(function (t) { byIdMap[t.id] = t; });
    var assignments = TasksModel.reassignSubset(ids, byIdMap);
    applyPriorities(assignments);
    ui.activeId = dragId;
    render({ focus: true });
    announce('Task moved.');
    persistOrder(assignments);
  }

  /** Clears drag state and the drop indicators.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `listEl` — mutated; `dragId`, classes and `draggable`. */
  function endDrag() {
    ui.dragId = null;
    var marked = listEl.querySelectorAll('.is-dragging, .drop-before, .drop-after, [draggable="true"]');
    for (var i = 0; i < marked.length; i++) {
      marked[i].classList.remove('is-dragging', 'drop-before', 'drop-after');
      marked[i].removeAttribute('draggable');
    }
  }

  /* ── Actions: tags and filters ───────────────────────────── */

  /** Adds one or more comma-separated tags to a task.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`byId`, `saveTask`, `announce`, `renderFilters`, `rerenderRow` — helpers.) */
  function addTag(id, raw) {
    var t = byId(id);
    if (!t) { return; }
    var tags = (t.tags || []).slice();
    var added = [];
    var invalid = [];
    String(raw).split(',').forEach(function (part) {
      if (!part.trim()) { return; }
      var tag = TasksModel.normaliseTag(part);
      if (tag === null) { invalid.push(part.trim()); return; }
      if (tags.indexOf(tag) === -1) { tags.push(tag); added.push(tag); }
    });
    if (invalid.length) { announce('Not a valid tag: ' + invalid.join(', ') + ' (letters, digits and hyphens, up to 32).'); }
    if (!added.length) { rerenderRow(id, 'tag-input'); return; }
    var previous = t.tags;
    t.tags = tags;
    announce('Tag added: ' + added.join(', '));
    renderFilters();
    rerenderRow(id, 'tag-input');
    saveTask(id, { tags: tags }, null, function () {
      t.tags = previous;
      renderFilters();
      rerenderRow(id, null);
    });
  }

  /** Removes one tag from a task.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`byId`, `saveTask`, `announce`, `renderFilters`, `rerenderRow` — helpers.) */
  function removeTag(id, tag) {
    var t = byId(id);
    if (!t) { return; }
    var previous = t.tags;
    t.tags = (t.tags || []).filter(function (g) { return g !== tag; });
    announce('Tag removed: ' + tag);
    renderFilters();
    rerenderRow(id, 'tag-input');
    saveTask(id, { tags: t.tags }, null, function () {
      t.tags = previous;
      renderFilters();
      rerenderRow(id, null);
    });
  }

  /** Adds a tag to the AND tag filter.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist` — mutated (`filter.tags`, `page`). (`render`, `announce` — helpers.) */
  function addTagFilter(raw) {
    var tag = TasksModel.normaliseTag(raw);
    if (!tag || persist.filter.tags.indexOf(tag) !== -1) { return; }
    persist.filter.tags.push(tag);
    persist.page = 1;
    render();
    announce('Filtering by tag "' + tag + '"');
  }

  /** Resets every filter (not the sort) and rebuilds the filter bar.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `persist` — mutated; the filter is replaced field by field. (`buildFilterBar`, `render` — helpers.) */
  function clearFilters() {
    var f = persist.filter;
    closePalette(false);
    f.q = '';
    f.status = 'open';
    f.store = '';
    f.tags.length = 0;
    f.colors.length = 0;
    persist.page = 1;
    buildFilterBar();
    render();
  }

  /* ── Create flow ─────────────────────────────────────────── */

  /** Focuses the text area of the open draft.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root` — read-only. */
  function focusDraft(field) {
    var el = root.querySelector('[data-draft="' + field + '"]');
    if (el) { el.focus(); }
    return el;
  }

  /** Focuses the create button of a position.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `root` — read-only. */
  function focusCreate(position) {
    var el = root.querySelector('[data-create="' + position + '"]');
    if (el) { el.focus(); }
  }

  /** Opens the store menu, or the draft directly with a single store.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `stores` — `ui.menu` mutated; `stores` read-only.
   *    (`focusDraft`, `startDraft`, `render`, `root` — helpers.) */
  function openCreate(position) {
    if (ui.draft) { focusDraft('text'); return; }
    if (!stores.length) { announce('No store is available for new tasks.'); return; }
    if (stores.length === 1) { startDraft(position, stores[0].id); return; }
    ui.menu = position;
    render();
    var first = root.querySelector('.store-menu [role="menuitem"]');
    if (first) { first.focus(); }
  }

  /** Closes the store menu.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`menu`). (`render`, `focusCreate` — helpers.) */
  function closeMenu(focusTrigger) {
    var position = ui.menu;
    if (!position) { return; }
    ui.menu = null;
    render();
    if (focusTrigger) { focusCreate(position); }
  }

  /** Opens the draft for a store next to the button that was used.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`menu`, `draft`). (`storeLabel`, `render`, `focusDraft` — helpers.) */
  function startDraft(position, storeId) {
    ui.menu = null;
    ui.draft = { position: position, store: storeId, storeLabel: storeLabel(storeId), ref: '', text: '', invalid: false };
    render();
    focusDraft('text');
  }

  /** Discards the draft.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui` — mutated (`draft`). (`render`, `focusCreate` — helpers.) */
  function cancelDraft() {
    var position = ui.draft && ui.draft.position;
    ui.draft = null;
    render();
    if (position) { focusCreate(position); }
  }

  /** Saves the draft as a new task and reports where it landed.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `tasks`, `persist` — `ui.draft` and `tasks` mutated.
   *    (`render`, `focusDraft`, `announce`, `focusCreate`, `modelState`,
   *     `storeLabel`, `errorText`, `alive` — helpers.) */
  function saveDraft() {
    var d = ui.draft;
    if (!d || d.saving) { return; }
    var text = d.text.replace(/\s+$/, '');
    if (!text.trim()) {
      d.invalid = true;
      render();
      focusDraft('text');
      announce('Enter a task description first.');
      return;
    }
    var body = { store_id: d.store, text: text };
    var ref = d.ref.trim();
    if (ref) { body.reference = ref; }
    d.saving = true;
    API.createTask(body).then(function (created) {
      if (!alive()) { return; }
      tasks.push(created);
      var position = d.position;
      ui.draft = null;
      var list = TasksModel.visibleTasks(tasks, modelState());
      var where = TasksModel.placementOf(list, created.id, persist.pageSize);
      var label = created.store_label || storeLabel(created.store_id);
      renderChrome();
      if (where.page === persist.page) {
        ui.activeId = created.id;
        ui.flash = created.id;
        render({ focus: true });
        announce('Task added to ' + label + '.');
      } else {
        render();
        focusCreate(position);
        announce(where.hidden
          ? 'Task added to ' + label + ' — hidden by the current filters.'
          : 'Task added to ' + label + ' — shown on page ' + where.page + ' with the current sorting.');
      }
    }).catch(function (err) {
      d.saving = false;
      if (!alive()) { return; }
      var message = errorText(err, 'The task could not be added.');
      render();
      var refField = /reference/i.test(message) ? focusDraft('ref') : null;
      if (refField) { refField.setAttribute('aria-invalid', 'true'); } else { focusDraft('text'); }
      announce(message);
    });
  }

  /* ── Keyboard navigation between rows ────────────────────── */

  /** Moves focus to the next or previous row, crossing page boundaries.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `ui`, `persist` — `ui.activeId` and `persist.page` mutated.
   *    (`rowEl`, `setActive`, `currentPage`, `render`, `$` — helpers.) */
  function focusSibling(id, dir) {
    var li = rowEl(id);
    var sibling = li && (dir > 0 ? li.nextElementSibling : li.previousElementSibling);
    if (sibling && sibling.classList.contains('task')) {
      setActive(sibling.getAttribute('data-id'));
      sibling.focus();
      return;
    }
    var p = currentPage().p;
    if (dir > 0 && persist.page < p.pages) {
      persist.page++;
      ui.activeId = null;
      render({ focus: true });
    } else if (dir < 0 && persist.page > 1) {
      persist.page--;
      var q = currentPage().p;
      ui.activeId = q.items.length ? q.items[q.items.length - 1].id : null;
      render({ focus: true });
    } else if (dir < 0) {
      $('f-search').focus();
    }
  }

  /** Focuses the first or last row of the page.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    `listEl` — read-only. (`setActive` — helper.) */
  function focusEdge(first) {
    var rows = listEl.querySelectorAll('.task');
    if (!rows.length) { return; }
    var row = rows[first ? 0 : rows.length - 1];
    setActive(row.getAttribute('data-id'));
    row.focus();
  }

  /** Shows or hides the shortcut help.
   *
   *  Closure dependencies (from tasksBuildView() scope):
   *    (`$` — helper.) */
  function toggleHelp() {
    var panel = $('help-panel');
    panel.hidden = !panel.hidden;
    $('btn-help').setAttribute('aria-expanded', String(!panel.hidden));
  }

  /* ── Wiring: the list ────────────────────────────────────── */

  listEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-empty-clear]')) { clearFilters(); return; }
    var li = e.target.closest('.task');
    if (!li) { return; }
    var id = li.getAttribute('data-id');
    setActive(id);
    if (e.target.closest('a')) { return; }   /* links (ticket, Markdown) open normally */
    var actEl = e.target.closest('[data-act]');
    var act = actEl && actEl.getAttribute('data-act');
    switch (act) {
      case 'edit-text': startEdit(id, 'text'); break;
      case 'edit-ref': startEdit(id, 'ref'); break;
      case 'toggle': toggleExpand(id); break;
      case 'delete': deleteAction(id); break;
      case 'filter-tag': addTagFilter(actEl.getAttribute('data-tag')); break;
      case 'remove-tag': removeTag(id, actEl.getAttribute('data-tag')); break;
      case 'color': togglePalette(id); break;
      default: break;
    }
  });

  /* Drag & drop: only a press on the handle arms the row, priority sort only. */
  listEl.addEventListener('mousedown', function (e) {
    var handle = e.target.closest && e.target.closest('[data-role="handle"]');
    var li = handle && handle.closest('.task');
    if (!li || persist.sort !== 'priority') { return; }
    li.setAttribute('draggable', 'true');
    ui.dragId = li.getAttribute('data-id');
  });
  listEl.addEventListener('mouseup', function () { if (ui.dragId) { endDrag(); } });
  listEl.addEventListener('dragstart', function (e) {
    var li = e.target.closest && e.target.closest('.task');
    if (!li || !ui.dragId || li.getAttribute('data-id') !== ui.dragId || persist.sort !== 'priority') {
      e.preventDefault();
      return;
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ui.dragId); } catch (err) { /* not settable */ }
    }
    li.classList.add('is-dragging');
  });
  listEl.addEventListener('dragover', function (e) {
    if (!ui.dragId) { return; }
    var li = e.target.closest && e.target.closest('.task');
    if (!li || li.getAttribute('data-id') === ui.dragId) { return; }
    e.preventDefault();
    var rect = li.getBoundingClientRect();
    var before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('drop-before', before);
    li.classList.toggle('drop-after', !before);
  });
  listEl.addEventListener('drop', function (e) {
    var dragId = ui.dragId;
    var li = e.target.closest && e.target.closest('.task');
    if (!dragId || !li) { endDrag(); return; }
    e.preventDefault();
    var rect = li.getBoundingClientRect();
    var before = e.clientY < rect.top + rect.height / 2;
    var targetId = li.getAttribute('data-id');
    endDrag();
    dropRow(dragId, targetId, before);
  });
  listEl.addEventListener('dragend', function () { endDrag(); });

  listEl.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-act') === 'complete') {
      toggleComplete(e.target.closest('.task').getAttribute('data-id'));
    }
  });

  listEl.addEventListener('input', function (e) {
    var role = e.target.getAttribute('data-role');
    if (role === 'text-input') { autosize(e.target); }
    /* Picking a datalist suggestion adds the tag immediately. */
    if (role === 'tag-input' && (!e.inputType || e.inputType === 'insertReplacementText')) {
      if (TasksModel.allTags(tasks).indexOf(e.target.value) !== -1) {
        addTag(e.target.closest('.task').getAttribute('data-id'), e.target.value);
      }
    }
  });

  listEl.addEventListener('focusin', function (e) {
    var li = e.target.closest('.task');
    if (li) { setActive(li.getAttribute('data-id')); }
  });

  listEl.addEventListener('focusout', function (e) {
    if (ui.rendering) { return; }
    var li = e.target.closest('.task');
    if (!li) { return; }
    var id = li.getAttribute('data-id');
    var role = e.target.getAttribute('data-role');
    if ((role === 'text-input' || role === 'ref-input') && ui.editing && ui.editing.id === id) {
      commitEdit(false);
      return;
    }
    if (ui.armed === id && !(e.relatedTarget && li.contains(e.relatedTarget))) {
      disarm(false);
    }
  });

  listEl.addEventListener('keydown', function (e) {
    var li = e.target.closest('.task');
    if (!li) { return; }
    var id = li.getAttribute('data-id');
    var role = e.target.getAttribute('data-role');
    var k = e.key;

    if (role === 'text-input' || role === 'ref-input') {
      if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(true); }
      else if (k === 'Enter' && role === 'ref-input') { e.preventDefault(); }
      else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
      return;
    }
    if (role === 'tag-input') {
      if (k === 'Enter' || k === ',') {
        e.preventDefault();
        if (e.target.value.trim()) { addTag(id, e.target.value); }
      } else if (k === 'Backspace' && !e.target.value) {
        var t = byId(id);
        if (t && t.tags.length) { e.preventDefault(); removeTag(id, t.tags[t.tags.length - 1]); }
      } else if (k === 'Escape') { e.preventDefault(); li.focus(); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      moveTask(id, k === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }

    var onRow = e.target === li;
    var onControl = !onRow && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.type === 'checkbox');
    switch (k) {
      case 'ArrowDown': e.preventDefault(); focusSibling(id, 1); break;
      case 'ArrowUp': e.preventDefault(); focusSibling(id, -1); break;
      case 'Home': e.preventDefault(); focusEdge(true); break;
      case 'End': e.preventDefault(); focusEdge(false); break;
      case 'Enter': if (onControl) { return; } e.preventDefault(); startEdit(id, 'text'); break;
      case 'r': case 'R': e.preventDefault(); startEdit(id, 'ref'); break;
      case ' ': if (onControl) { return; } e.preventDefault(); toggleComplete(id); break;
      case 'ArrowRight': e.preventDefault(); toggleExpand(id, true); break;
      case 'ArrowLeft': e.preventDefault(); toggleExpand(id, false, 'row'); break;
      case 't': case 'T': e.preventDefault(); toggleExpand(id, true, 'tag-input'); break;
      case 'c': case 'C': e.preventDefault(); togglePalette(id); break;
      case 'Delete': e.preventDefault(); deleteAction(id); break;
      case 'Escape': if (ui.armed === id) { e.preventDefault(); disarm(true); } break;
      default: break;
    }
  });

  /* ── Wiring: the rest of the view (delegated on #tasks-root) ── */

  root.addEventListener('click', function (e) {
    var create = e.target.closest('[data-create]');
    if (create) {
      var position = create.getAttribute('data-create');
      if (ui.menu === position) { closeMenu(true); } else { openCreate(position); }
      return;
    }
    var storeBtn = e.target.closest('[data-store]');
    if (storeBtn) { startDraft(ui.menu || 'top', storeBtn.getAttribute('data-store')); return; }
    var draftAct = e.target.closest('[data-draft-act]');
    if (draftAct) {
      if (draftAct.getAttribute('data-draft-act') === 'save') { saveDraft(); } else { cancelDraft(); }
      return;
    }
    var colorFilter = e.target.closest('#f-color');
    if (colorFilter) {
      if (ui.paletteMode === 'filter') { closePalette(true); } else { openPalette('filter'); }
      return;
    }
    var removeColor = e.target.closest('[data-remove-color]');
    if (removeColor) {
      closePalette(false);
      var key = removeColor.getAttribute('data-remove-color');
      persist.filter.colors = persist.filter.colors.filter(function (x) { return x !== key; });
      persist.page = 1;
      buildFilterBar();
      render();
      var colorBtn = $('f-color');
      if (colorBtn) { colorBtn.focus(); }
      return;
    }
    var removeFilter = e.target.closest('[data-remove-filter]');
    if (removeFilter) {
      var tag = removeFilter.getAttribute('data-remove-filter');
      persist.filter.tags = persist.filter.tags.filter(function (x) { return x !== tag; });
      persist.page = 1;
      render();
      $('f-tag').focus();
      return;
    }
    if (e.target.id === 'btn-clear-filters') { clearFilters(); $('f-search').focus(); return; }
    var pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      persist.page = Number(pageBtn.getAttribute('data-page'));
      render();
      var active = root.querySelector('.pagination-btn.active');
      if (active) { active.focus(); }
      return;
    }
    if (e.target.closest('#btn-expand-all')) {
      var items = currentPage().p.items;
      var allExpanded = items.length > 0 && items.every(function (t) { return ui.expanded[t.id]; });
      items.forEach(function (t) { if (allExpanded) { delete ui.expanded[t.id]; } else { ui.expanded[t.id] = true; } });
      render();
      return;
    }
    if (e.target.closest('#btn-help')) { toggleHelp(); }
  });

  root.addEventListener('input', function (e) {
    var target = e.target;
    var draftField = target.getAttribute && target.getAttribute('data-draft');
    if (draftField && ui.draft) {
      ui.draft[draftField] = target.value;
      if (draftField === 'text') { ui.draft.invalid = false; target.removeAttribute('aria-invalid'); autosize(target); }
      return;
    }
    if (target.id === 'f-search') { persist.filter.q = target.value; persist.page = 1; render(); return; }
    if (target.id === 'f-tag') {
      if ((!e.inputType || e.inputType === 'insertReplacementText') && TasksModel.allTags(tasks).indexOf(target.value) !== -1) {
        addTagFilter(target.value);
        target.value = '';
      }
    }
  });

  root.addEventListener('change', function (e) {
    var target = e.target;
    if (target.id === 'f-status') { persist.filter.status = target.value; persist.page = 1; render(); }
    else if (target.id === 'f-store') { persist.filter.store = target.value; persist.page = 1; render(); }
    else if (target.id === 'f-sort') { persist.sort = target.value; persist.page = 1; render(); }
    else if (target.id === 'page-size') { persist.pageSize = Number(target.value) || persist.pageSize; persist.page = 1; render(); }
  });

  /* ── Wiring: document and window ─────────────────────────── */

  /* Held in module variables and removed before re-adding (GUI §2). Each one
     also removes itself once this view has left the DOM. */
  tasksKeydownHandler = function (e) {
    if (!alive()) { tasksRemoveGlobalHandlers(); return; }
    var target = e.target;
    /* Store menu */
    if (ui.menu && target.closest && target.closest('.store-menu')) {
      var items = Array.prototype.slice.call(root.querySelectorAll('.store-menu [role="menuitem"]'));
      var i = items.indexOf(target);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
      return;
    }
    /* Draft */
    var draftField = target.getAttribute && target.getAttribute('data-draft');
    if (draftField) {
      if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); }
      else if (e.key === 'Enter' && draftField === 'ref') { e.preventDefault(); focusDraft('text'); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDraft(); }
      return;
    }
    /* Search field */
    if (target.id === 'f-search') {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusIn(ui.activeId, 'row'); }
      else if (e.key === 'Escape' && !target.value) { target.blur(); }
      return;
    }
    /* Tag filter field */
    if (target.id === 'f-tag') {
      if (e.key === 'Enter' && target.value.trim()) { e.preventDefault(); addTagFilter(target.value); target.value = ''; }
      else if (e.key === 'Backspace' && !target.value && persist.filter.tags.length) { persist.filter.tags.pop(); render(); }
      return;
    }
    /* Global shortcuts: never while typing */
    var tag = target.tagName;
    if ((tag === 'INPUT' && target.type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (e.key === '/') { e.preventDefault(); $('f-search').focus(); $('f-search').select(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openCreate('top'); }
    else if (e.key === '?') { e.preventDefault(); toggleHelp(); }
  };

  /* Outside click closes the store menu; the menu's own clicks are handled on the root. */
  tasksClickHandler = function (e) {
    if (!alive()) { tasksRemoveGlobalHandlers(); return; }
    var target = e.target;
    /* Guard 2: a target that left the DOM during the click (a re-rendered control) says nothing
       about where the user clicked. Guard 1 is the palette's own stopPropagation(). */
    if (!target || !document.documentElement.contains(target)) { return; }
    if (ui.paletteMode && !target.closest('#palette') && !target.closest('[data-act="color"]') && !target.closest('#f-color')) {
      closePalette(false);
    }
    if (ui.menu && !target.closest('.store-menu') && !target.closest('[data-create]')) { closeMenu(false); }
  };

  tasksVisibilityHandler = function () {
    if (!alive()) { tasksRemoveGlobalHandlers(); return; }
    if (document.visibilityState !== 'visible') { return; }
    if (ui.editing || ui.draft || ui.armed || ui.paletteMode || ui.menu) { return; }
    refetch();
  };

  tasksResizeHandler = function () {
    if (!alive()) { tasksRemoveGlobalHandlers(); return; }
    if (ui.paletteMode) { positionPalette(); }
  };

  document.addEventListener('keydown', tasksKeydownHandler);
  document.addEventListener('click', tasksClickHandler);
  document.addEventListener('visibilitychange', tasksVisibilityHandler);
  window.addEventListener('resize', tasksResizeHandler);

  /* ── First paint ─────────────────────────────────────────── */
  renderChrome();
  buildFilterBar();
  render();
}
