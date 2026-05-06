/* ============================================================
   router.js — Router module
   Section 3 of the MCP Server Dashboard SPA
   ============================================================ */

var Router = (function () {
  var _activeInterval = null;

  function clearPolling() {
    if (_activeInterval !== null) {
      clearInterval(_activeInterval);
      _activeInterval = null;
    }
  }

  function setPolling(intervalFn, delayMs) {
    clearPolling();
    _activeInterval = setInterval(intervalFn, delayMs);
  }

  function updateNavActive(path) {
    var navLinks = document.querySelectorAll('header nav a');
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var linkPath = href.replace(/^#/, '') || '/';
      link.classList.toggle('active', linkPath === path || (path === '' && linkPath === '/'));
    });
  }

  function dispatch(hash) {
    clearPolling();
    var path = (hash || '').replace(/^#/, '') || '/';
    var app = document.getElementById('app');
    if (!app) return;

    updateNavActive(path);

    if (path === '/' || path === '') {
      renderProjectList(app);
      return;
    }

    var planMatch = path.match(/^\/projects\/([^/]+)\/plan$/);
    if (planMatch) {
      renderPlan(app, decodeURIComponent(planMatch[1]));
      return;
    }

    var synthesisMatch = path.match(/^\/projects\/([^/]+)\/synthesis$/);
    if (synthesisMatch) {
      renderSynthesis(app, decodeURIComponent(synthesisMatch[1]));
      return;
    }

    var projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      renderProjectDetail(app, decodeURIComponent(projectMatch[1]));
      return;
    }

    var wpMatch = path.match(/^\/projects\/([^/]+)\/wp\/([^/]+)$/);
    if (wpMatch) {
      renderWorkPackageDetail(app, decodeURIComponent(wpMatch[1]), decodeURIComponent(wpMatch[2]));
      return;
    }

    var runLogMatch = path.match(/^\/projects\/([^/]+)\/runs\/([^/]+)$/);
    if (runLogMatch) {
      renderRunLog(app, decodeURIComponent(runLogMatch[1]), decodeURIComponent(runLogMatch[2]));
      return;
    }

    if (path === '/config') {
      renderConfig(app);
      return;
    }

    if (path === '/insights') {
      renderInsights(app);
      return;
    }

    if (path === '/orchestrator') {
      renderOrchestrator(app);
      return;
    }

    app.innerHTML = '<p class="error-banner">Page not found: ' + escapeHtml(path) + '</p>';
  }

  function navigate(hash) {
    window.location.hash = hash;
  }

  function init() {
    window.addEventListener('hashchange', function () {
      dispatch(window.location.hash);
    });
    dispatch(window.location.hash);
  }

  return {
    navigate: navigate,
    init: init,
    _setPolling: setPolling,
    _clearPolling: clearPolling,
  };
})();
