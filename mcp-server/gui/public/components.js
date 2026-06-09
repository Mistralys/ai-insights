/* ============================================================
   components.js — Shared UI render helpers (UI namespace)
   Loaded after utils.js; depends on escapeHtml() being
   available as a global.  Follows the OrchestratorWidgets
   IIFE-namespace pattern.
   ============================================================ */

var UI = (function () {
  'use strict';

  /**
   * Normalise a type/variant string to a CSS-safe slug:
   * lowercased, spaces and underscores replaced with hyphens.
   * The return value is HTML-escaped so it is safe to interpolate directly
   * into HTML attribute values (e.g. class="badge badge-{type}").
   * @param {string} type
   * @returns {string}
   */
  function _normaliseType(type) {
    if (!type) return '';
    return escapeHtml(type.toLowerCase().replace(/[\s_]+/g, '-'));
  }

  /**
   * Render a status/type badge.
   * @param {string} type  - Badge variant (e.g. 'in-progress', 'COMPLETE').
   *                         Normalised: lowercased, spaces/underscores → hyphens.
   * @param {string} label - Visible text inside the badge (HTML-escaped).
   * @param {object} [opts] - Optional rendering options:
   *   opts.attrs {object} — Extra HTML attributes rendered on the <span>.
   *                         Keys are attribute names; values are HTML-escaped.
   *                         Example: { title: 'tooltip text' }
   * @returns {string} HTML string.
   *
   * Examples:
   *   UI.badge('in-progress', 'In Progress')
   *     → '<span class="badge badge-in-progress">In Progress</span>'
   *
   *   UI.badge('fail', 'Error', { attrs: { title: 'Details here' } })
   *     → '<span class="badge badge-fail" title="Details here">Error</span>'
   */
  function badge(type, label, opts) {
    var normType = _normaliseType(type);
    var o = opts || {};
    var extraAttrs = '';
    if (o.attrs) {
      Object.keys(o.attrs).forEach(function (attr) {
        extraAttrs += ' ' + attr + '="' + escapeHtml(String(o.attrs[attr])) + '"';
      });
    }
    return '<span class="badge badge-' + normType + '"' + extraAttrs + '>' + escapeHtml(label) + '</span>';
  }

  /**
   * Render an alert banner.
   * @param {string} type    - Banner variant: 'error' | 'success' | 'info' | 'stale'.
   *                           Normalised and used as the CSS class prefix.
   * @param {string} message - Message text (HTML-escaped).
   * @returns {string} HTML string.
   *
   * Example: UI.banner('error', 'Something failed')
   *   → '<p class="error-banner">Something failed</p>'
   */
  function banner(type, message) {
    var normType = _normaliseType(type);
    return '<p class="' + normType + '-banner">' + escapeHtml(message) + '</p>';
  }

  /**
   * Render a muted empty-state paragraph.
   * @param {string} message - Message text (HTML-escaped).
   * @returns {string} HTML string.
   *
   * Example: UI.emptyState('No items found')
   *   → '<p class="text-muted mt-16">No items found</p>'
   */
  function emptyState(message) {
    return '<p class="text-muted mt-16">' + escapeHtml(message) + '</p>';
  }

  /**
   * Sanitise a value for use inside an HTML attribute (style="" or class="").
   * - Returns an empty string if the value contains a `javascript:` URL or an
   *   unescaped `</style` sequence — patterns that could break out of the
   *   inline-style context.
   * - Escapes `"` as `&quot;` to prevent attribute-boundary injection.
   * @private
   * @param {*} v
   * @returns {string}
   */
  function _safeAttr(v) {
    var s = String(v == null ? '' : v);
    if (/javascript\s*:/i.test(s) || /<\/style/i.test(s)) return '';
    return s.replace(/"/g, '&quot;');
  }

  /**
   * Render a card container.
   * @param {string|null} title  - Card title text (HTML-escaped). Pass null/falsy to
   *                               omit the title element entirely.
   * @param {string}      body   - Raw HTML string for the card body (not escaped).
   * @param {object}      [opts] - Optional rendering options:
   *   opts.id          {string}        — `id` attribute on the card wrapper div.
   *   opts.dataId      {string|number} — `data-id` attribute on the card wrapper div.
   *   opts.style       {string}        — Additional inline style on the card wrapper div.
   *   opts.accentColor {string}        — Sets `border-left-color` as an inline style.
   *                                      Combined with opts.style when both are present.
   *   opts.titleStyle  {string}        — Inline style on the `.card-title` div.
   *   opts.extraClass  {string}        — Extra CSS class(es) appended to the wrapper.
   *   NOTE: opts.style, opts.accentColor, opts.titleStyle, and opts.extraClass are
   *   passed through _safeAttr(), which escapes `"` and rejects `javascript:` /
   *   `</style` patterns. Pass only trusted/literal CSS strings (e.g.
   *   'max-width:560px', 'var(--color-complete)'); avoid raw user input.
   * @returns {string} HTML string.
   *
   * Examples:
   *   UI.card('Title', '<p>Body</p>')
   *     → '<div class="card"><div class="card-title">Title</div><p>Body</p></div>'
   *
   *   UI.card(null, body)
   *     → '<div class="card">…body…</div>'
   *
   *   UI.card('Title', body, { accentColor: '#ff0000' })
   *     → '<div class="card" style="border-left-color: #ff0000;">…</div>'
   */
  function card(title, body, opts) {
    var o = opts || {};

    var classes = 'card' + (o.extraClass ? ' ' + _safeAttr(o.extraClass) : '');

    var idAttr     = o.id     ? ' id="' + escapeHtml(String(o.id)) + '"'         : '';
    var dataIdAttr = o.dataId != null ? ' data-id="' + escapeHtml(String(o.dataId)) + '"' : '';

    var styleStr = o.accentColor ? 'border-left-color: ' + _safeAttr(o.accentColor) + ';' : '';
    if (o.style) styleStr = styleStr ? styleStr + ' ' + _safeAttr(o.style) : _safeAttr(o.style);
    var styleAttr = styleStr ? ' style="' + styleStr + '"' : '';

    var titleStyleAttr = o.titleStyle ? ' style="' + _safeAttr(o.titleStyle) + '"' : '';
    var titleHtml = title
      ? '<div class="card-title"' + titleStyleAttr + '>' + escapeHtml(title) + '</div>'
      : '';

    return '<div class="' + classes + '"' + idAttr + dataIdAttr + styleAttr + '>' +
      titleHtml +
      body +
    '</div>';
  }

  /**
   * Render a filter bar.
   * @param {string} containerId - id attribute on the outer <div class="filter-bar"> wrapper.
   * @param {Array}  filters     - Array of filter descriptors:
   *   { type: 'select'|'text', id: string, label?: string,
   *     options?: Array<{value,label,selected?}>, optionsHtml?: string,
   *     placeholder?: string, value?: string, cssClass?: string }
   * @returns {{ html: string, bind: function }}
   *   html       — full filter bar HTML including wrapper div
   *   bind(fn)   — attaches event listeners to each control in the filter bar;
   *                calls fn({[id]: currentValue, …}) on any change/input event
   */
  function filterBar(containerId, filters) {
    var safeId = escapeHtml(String(containerId));
    var inner = (filters || []).map(function (f) {
      var labelHtml = f.label
        ? '<label for="' + escapeHtml(f.id) + '">' + escapeHtml(f.label) + '</label>'
        : '';
      var clsAttr = f.cssClass ? ' class="' + escapeHtml(f.cssClass) + '"' : '';

      if (f.type === 'select') {
        var optHtml = f.optionsHtml || '';
        if (!optHtml && f.options) {
          optHtml = f.options.map(function (o) {
            var sel = o.selected ? ' selected' : '';
            return '<option value="' + escapeHtml(String(o.value)) + '"' + sel + '>'
              + escapeHtml(String(o.label)) + '</option>';
          }).join('');
        }
        return labelHtml + '<select id="' + escapeHtml(f.id) + '"' + clsAttr + '>' + optHtml + '</select>';
      }

      if (f.type === 'text') {
        var phAttr  = f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '';
        var valAttr = f.value != null ? ' value="' + escapeHtml(String(f.value)) + '"' : '';
        return labelHtml + '<input type="text" id="' + escapeHtml(f.id) + '"' + clsAttr + phAttr + valAttr + '>';
      }

      return '';
    }).join('');

    var html = '<div class="filter-bar" id="' + safeId + '">' + inner + '</div>';

    function bind(onChange) {
      var container = document.getElementById(containerId);
      if (!container) return;
      (filters || []).forEach(function (f) {
        var el = document.getElementById(f.id);
        if (!el) return;
        var evt = f.type === 'text' ? 'input' : 'change';
        el.addEventListener(evt, function () {
          var state = {};
          (filters || []).forEach(function (ff) {
            var fe = document.getElementById(ff.id);
            state[ff.id] = fe ? fe.value : '';
          });
          onChange(state);
        });
      });
    }

    return { html: html, bind: bind };
  }

  return {
    badge: badge,
    banner: banner,
    emptyState: emptyState,
    card: card,
    filterBar: filterBar
  };
}());
