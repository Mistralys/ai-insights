/* ============================================================
   views/tasks-model.js — Tasks list model
   Section 4h-m of the MCP Server Dashboard SPA
   Depends on: nothing (pure ES5, no DOM, no globals)

   Namespace `TasksModel`: filtering, sorting, paging, reorder maths,
   palette navigation and palette placement for the Tasks view.

   Server parity: the browser cannot import TypeScript, so the comparator and
   the status / store / tag / colour predicates re-implement
   `compareTasks` (src/schema/task.ts) and `matchesFilters`
   (src/storage/task-collection.ts). `normaliseTag`, `colorKey` and `PALETTE`
   mirror `normaliseTag`, `colorKey` and `TASK_COLOR_IDS` in
   src/schema/task.ts. tests/gui/tasks-parity.test.ts and
   tests/gui/tasks-palette-pin.test.ts keep both sides equal.
   The multi-term search (AND here, OR on the server) differs on purpose.

   Task shape (a GUI `TaskView`): { id, text, tags, priority, completed,
   created_at, completed_at, color, store_id, ticket_label, ... }.
   View state shape: { filter: { status, store, tags, colors, q },
   sort, leaving }.
   ============================================================ */

var TasksModel = (function () {
  'use strict';

  /* ── Palette ─────────────────────────────────────────────── */

  /* Ordered ids = TASK_COLOR_IDS; the colour itself is the --task-color-{id}
     token in styles.css. No hex values here. */
  var PALETTE = [
    { id: 'red',     name: 'Red' },
    { id: 'orange',  name: 'Orange' },
    { id: 'amber',   name: 'Amber' },
    { id: 'yellow',  name: 'Yellow' },
    { id: 'lime',    name: 'Lime' },
    { id: 'green',   name: 'Green' },
    { id: 'teal',    name: 'Teal' },
    { id: 'cyan',    name: 'Cyan' },
    { id: 'blue',    name: 'Blue' },
    { id: 'indigo',  name: 'Indigo' },
    { id: 'violet',  name: 'Violet' },
    { id: 'fuchsia', name: 'Fuchsia' },
    { id: 'pink',    name: 'Pink' },
    { id: 'brown',   name: 'Brown' },
    { id: 'slate',   name: 'Slate' },
    { id: 'gray',    name: 'Gray' }
  ];

  var PALETTE_COLUMNS = 8;

  /* The palette entry for an id, or null for '' and unknown ids. */
  function colorById(id) {
    for (var i = 0; i < PALETTE.length; i++) {
      if (PALETTE[i].id === id) { return PALETTE[i]; }
    }
    return null;
  }

  /* The colour key used for filtering: the stored id when it is in the
     palette, otherwise 'none' (covers '', a missing field and unknown ids). */
  function colorKey(task) {
    var color = task ? task.color : null;
    return (typeof color === 'string' && colorById(color) !== null) ? color : 'none';
  }

  /* Adds or removes one colour key; never mutates the input. */
  function toggleColor(selection, key) {
    var current = selection || [];
    if (current.indexOf(key) === -1) { return current.concat([key]); }
    return current.filter(function (k) { return k !== key; });
  }

  /* ── Tags and text ───────────────────────────────────────── */

  var TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

  /* Same rule as the server: lowercase, whitespace runs become '-', commas
     removed. Returns null when the result is not a valid tag. */
  function normaliseTag(raw) {
    var tag = String(raw).trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '-');
    return TAG_PATTERN.test(tag) ? tag : null;
  }

  /* Sorted unique tags across all tasks. */
  function allTags(tasks) {
    var seen = {};
    var out = [];
    (tasks || []).forEach(function (t) {
      (t.tags || []).forEach(function (g) {
        if (!Object.prototype.hasOwnProperty.call(seen, g)) {
          seen[g] = true;
          out.push(g);
        }
      });
    });
    return out.sort();
  }

  /* The text up to the first line break. */
  function firstLine(text) {
    return String(text).split(/\r?\n/)[0];
  }

  /* Everything after the first line break (trimmed); '' when there is none. */
  function restLines(text) {
    return String(text).split(/\r?\n/).slice(1).join('\n').trim();
  }

  /* Width in ch for the reference column: the longest label, clamped 6–16.
     Accepts tasks (ticket_label) or plain strings. */
  function refColumnWidth(items) {
    var longest = 0;
    (items || []).forEach(function (item) {
      var label = typeof item === 'string' ? item : (item && item.ticket_label) || '';
      if (label.length > longest) { longest = label.length; }
    });
    return Math.min(16, Math.max(6, longest));
  }

  /* ── Comparator (mirrors compareTasks) ───────────────────── */

  function cmpDesc(a, b) { return a < b ? 1 : (a > b ? -1 : 0); }
  function cmpAsc(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /* Returns a comparator for 'priority' (default), 'created' or 'completed'. */
  function comparator(sort) {
    if (sort === 'created') {
      return function (a, b) {
        return cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
      };
    }
    if (sort === 'completed') {
      return function (a, b) {
        var ac = a.completed_at || '';
        var bc = b.completed_at || '';
        if (ac !== bc) {
          if (ac === '') { return 1; }
          if (bc === '') { return -1; }
          return cmpDesc(ac, bc);
        }
        return (b.priority - a.priority) || cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
      };
    }
    return function (a, b) {
      return (b.priority - a.priority) || cmpDesc(a.created_at, b.created_at) || cmpAsc(a.id, b.id);
    };
  }

  /* ── Filtering ───────────────────────────────────────────── */

  /* Status, store, tags (AND), colours (OR over colorKey), multi-term AND
     search over text, ticket_label and tags, then the comparator. Tasks whose
     id is truthy in state.leaving skip the status and colour filters so a
     just-completed or just-recoloured row stays visible until it is dismissed. */
  function visibleTasks(tasks, state) {
    var f = (state && state.filter) || {};
    var leaving = (state && state.leaving) || {};
    var status = f.status || 'all';
    var tags = f.tags || [];
    var colors = f.colors || [];
    var terms = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);

    var list = (tasks || []).filter(function (t) {
      if (!leaving[t.id]) {
        if (status === 'open' && t.completed) { return false; }
        if (status === 'completed' && !t.completed) { return false; }
        if (colors.length > 0 && colors.indexOf(colorKey(t)) === -1) { return false; }
      }
      if (f.store && t.store_id !== f.store) { return false; }
      var taskTags = t.tags || [];
      for (var i = 0; i < tags.length; i++) {
        if (taskTags.indexOf(tags[i]) === -1) { return false; }
      }
      if (terms.length > 0) {
        var hay = [t.text, t.ticket_label || ''].concat(taskTags).join('\n').toLowerCase();
        for (var j = 0; j < terms.length; j++) {
          if (hay.indexOf(terms[j]) === -1) { return false; }
        }
      }
      return true;
    });
    return list.sort(comparator(state && state.sort));
  }

  /* ── Paging ──────────────────────────────────────────────── */

  /* The requested page of the list. An out-of-range page is clamped.
     Returns { items, page, pages, start, total }. */
  function pageOf(list, page, pageSize) {
    var size = Math.max(1, pageSize | 0);
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / size));
    var current = Math.min(Math.max(1, page | 0), pages);
    var start = (current - 1) * size;
    return { items: list.slice(start, start + size), page: current, pages: pages, start: start, total: total };
  }

  /* Where a task shows in the list: { page } (1-based) or { hidden: true }. */
  function placementOf(list, id, pageSize) {
    var size = Math.max(1, pageSize | 0);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { return { page: Math.floor(i / size) + 1 }; }
    }
    return { hidden: true };
  }

  /* ── Reordering ──────────────────────────────────────────── */

  /* Swap priorities with the neighbour in the (filtered, priority-sorted) list.
     dir is -1 (up) or +1 (down). Returns { assignments, targetIndex } where
     assignments is [{ id, priority }, { id, priority }], or null at a list
     edge or for an unknown id. Equal priorities cannot be swapped, so the task
     that must end up higher gets priority + 1. */
  function swapWithNeighbour(list, id, dir) {
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if (list[k].id === id) { i = k; break; }
    }
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) { return null; }
    var a = list[i];
    var b = list[j];
    var pa = b.priority;
    var pb = a.priority;
    if (pa === pb) {
      if (dir < 0) { pa = pb + 1; } else { pb = pa + 1; }
    }
    return {
      assignments: [{ id: a.id, priority: pa }, { id: b.id, priority: pb }],
      targetIndex: j
    };
  }

  /* Give the subset's existing priority values (highest first) to a new
     top-to-bottom order. The multiset of priorities is preserved.
     tasksById: { id: task }. Returns [{ id, priority }] in the new order. */
  function reassignSubset(orderedIds, tasksById) {
    var values = orderedIds.map(function (id) { return tasksById[id].priority; })
      .sort(function (a, b) { return b - a; });
    return orderedIds.map(function (id, i) { return { id: id, priority: values[i] }; });
  }

  /* ── Palette navigation and placement ────────────────────── */

  /* Next focus index in the palette's enabled controls: `itemCount` controls,
     the first 16 are the swatch grid (8 columns), the rest the footer buttons.
     Unknown keys return the index unchanged. */
  function paletteMove(index, key, itemCount) {
    var last = itemCount - 1;
    var cols = PALETTE_COLUMNS;
    var gridEnd = PALETTE.length;
    var next = index;
    switch (key) {
      case 'ArrowRight': next = index + 1; break;
      case 'ArrowLeft':  next = index - 1; break;
      case 'ArrowDown':
        if (index < gridEnd - cols) { next = index + cols; }
        else if (index < gridEnd)   { next = gridEnd; }
        break;
      case 'ArrowUp':
        if (index >= gridEnd)   { next = gridEnd - cols; }
        else if (index >= cols) { next = index - cols; }
        break;
      case 'Home': next = 0; break;
      case 'End':  next = last; break;
      default: return index;
    }
    return Math.max(0, Math.min(next, last));
  }

  /* Popover position: below the anchor, flipped above when the bottom would
     cross viewport.height - 8 and there is room above, clamped horizontally.
     anchorRect { left, top, bottom }, paletteSize { width, height },
     viewport { width, height }. Returns { left, top, flipped }. */
  function palettePosition(anchorRect, paletteSize, viewport) {
    var margin = 8;
    var gap = 6;
    var left = Math.max(margin, Math.min(anchorRect.left - 10, viewport.width - paletteSize.width - margin));
    var top = anchorRect.bottom + gap;
    var flipped = false;
    if (top + paletteSize.height > viewport.height - margin &&
        anchorRect.top - paletteSize.height - gap > 60) {
      top = anchorRect.top - paletteSize.height - gap;
      flipped = true;
    }
    return { left: left, top: top, flipped: flipped };
  }

  return {
    PALETTE: PALETTE,
    colorById: colorById,
    colorKey: colorKey,
    toggleColor: toggleColor,
    normaliseTag: normaliseTag,
    allTags: allTags,
    firstLine: firstLine,
    restLines: restLines,
    refColumnWidth: refColumnWidth,
    comparator: comparator,
    visibleTasks: visibleTasks,
    pageOf: pageOf,
    placementOf: placementOf,
    swapWithNeighbour: swapWithNeighbour,
    reassignSubset: reassignSubset,
    paletteMove: paletteMove,
    palettePosition: palettePosition
  };
})();
