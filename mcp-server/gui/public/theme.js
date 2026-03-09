/* ============================================================
   theme.js — Theme module
   Section 2 of the MCP Server Dashboard SPA
   ============================================================ */

var Theme = (function () {
  var STORAGE_KEY = 'mcp-theme';
  var _toggleBtn = null;

  function _apply(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (_toggleBtn) {
      _toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      _toggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function init() {
    _toggleBtn = document.getElementById('theme-toggle');
    var saved = localStorage.getItem(STORAGE_KEY);
    // Default to dark if no preference is stored
    var theme = (saved === 'light') ? 'light' : 'dark';
    _apply(theme);
    if (_toggleBtn) {
      _toggleBtn.addEventListener('click', toggle);
    }
  }

  function toggle() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = (current === 'dark') ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    _apply(next);
  }

  return { init: init, toggle: toggle };
})();
