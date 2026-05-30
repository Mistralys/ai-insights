// Theme initialisation — intentionally written in ES5 (var, IIFE) so this file
// can be served as a plain static asset with no build step. Do not "upgrade"
// to let/const/arrow functions without adding a transpilation step.
(function () {
  var saved = localStorage.getItem('mcp-theme');
  if (saved !== 'light') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
