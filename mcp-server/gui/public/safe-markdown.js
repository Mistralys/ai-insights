/* ============================================================
   safe-markdown.js — Safe Markdown rendering for user-authored text
   Depends on: libs/marked.min.js (optional; falls back to escaped text)
   Must be loaded directly after libs/marked.min.js in index.html.

   Exports:
     SafeMarkdown.render(text)        — block-level Markdown -> safe HTML
     SafeMarkdown.renderInline(text)  — inline Markdown -> safe HTML

   Security model:
     - Uses a PRIVATE marked instance; the global `marked` defaults are
       never modified.
     - Raw HTML tokens (block and inline) are escaped, never emitted.
     - Links are rendered only for http:, https: and mailto: schemes, with
       target="_blank" rel="noopener noreferrer". Any other scheme renders
       the link text only (no anchor).
     - Images never produce <img>; they render as a link under the same
       scheme rule, using the alt text as label.
   ============================================================ */

var SafeMarkdown = (function () {
  'use strict';

  var ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Return true when the href uses an allow-listed scheme. Control characters
   * and whitespace are stripped first so "java\tscript:" style tricks cannot
   * bypass the check.
   */
  function isAllowedHref(href) {
    if (typeof href !== 'string') return false;
    var cleaned = href.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    var m = /^([a-z][a-z0-9+.-]*:)/.exec(cleaned);
    if (!m) return false;
    return ALLOWED_SCHEMES.indexOf(m[1]) !== -1;
  }

  function anchor(href, title, labelHtml) {
    if (!isAllowedHref(href)) return labelHtml;
    var out = '<a href="' + esc(href) + '"';
    if (title) out += ' title="' + esc(title) + '"';
    return out + ' target="_blank" rel="noopener noreferrer">' + labelHtml + '</a>';
  }

  var instance = null;

  function getInstance() {
    if (instance) return instance;
    if (typeof marked === 'undefined' || typeof marked.Marked !== 'function') return null;
    instance = new marked.Marked({
      gfm: true,
      breaks: false,
      renderer: {
        html: function (token) {
          return esc(token.text);
        },
        link: function (token) {
          return anchor(token.href, token.title, this.parser.parseInline(token.tokens));
        },
        image: function (token) {
          return anchor(token.href, token.title, esc(token.text));
        }
      }
    });
    return instance;
  }

  function fallback(text) {
    return esc(text).replace(/\r\n|\r|\n/g, '<br>');
  }

  function run(text, inline) {
    var str = text === null || text === undefined ? '' : String(text);
    var md = getInstance();
    if (!md) return fallback(str);
    try {
      return inline ? md.parseInline(str) : md.parse(str);
    } catch (e) {
      return fallback(str);
    }
  }

  return {
    /** Render block-level Markdown to safe HTML. */
    render: function (text) { return run(text, false); },
    /** Render inline Markdown to safe HTML. */
    renderInline: function (text) { return run(text, true); }
  };
})();
