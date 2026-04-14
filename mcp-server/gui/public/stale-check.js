/* ============================================================
   stale-check.js — Stale-instance detection module
   Section 6 of the MCP Server Dashboard SPA
   ============================================================ */

var StaleCheck = (function () {
  var POLL_INTERVAL_MS = 30 * 1000;
  var _intervalId = null;
  var _bannerInserted = false;

  /* Map camelCase field names to human-readable component labels */
  var COMPONENT_LABELS = {
    mcpServer: 'MCP Server',
    personas: 'Personas',
    orchestrator: 'Orchestrator',
  };

  function _stopPolling() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  /**
   * Build the stale-banner element and insert it at the very top of
   * document.body (before <header>), so it is globally visible and survives
   * SPA route changes.
   *
   * @param {string[]} changedComponents - Array of human-readable component strings.
   */
  function _insertBanner(changedComponents) {
    if (_bannerInserted) return;
    _bannerInserted = true;

    var banner = document.createElement('div');
    banner.className = 'stale-banner';

    var heading = document.createElement('strong');
    heading.textContent = 'Server version mismatch detected.';

    var message = document.createElement('span');
    message.textContent = ' The GUI was started with different component versions than what is currently on disk. ' +
      'Please relaunch the GUI to pick up the latest changes.';

    banner.appendChild(heading);
    banner.appendChild(message);

    if (changedComponents.length > 0) {
      var list = document.createElement('ul');
      list.style.margin = '8px 0 0 0';
      list.style.paddingLeft = '20px';
      changedComponents.forEach(function (text) {
        var item = document.createElement('li');
        item.textContent = text;
        list.appendChild(item);
      });
      banner.appendChild(list);
    }

    /* Insert before <header> (first child of body), not into #app */
    var header = document.querySelector('body > header');
    if (header) {
      document.body.insertBefore(banner, header);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  /**
   * Compare bootVersions vs diskVersions and return an array of
   * human-readable change strings for components that differ.
   *
   * @param {Object} bootVersions
   * @param {Object} diskVersions
   * @returns {string[]}
   */
  function _detectChanges(bootVersions, diskVersions) {
    var changed = [];
    var keys = Object.keys(COMPONENT_LABELS);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var boot = bootVersions != null ? bootVersions[key] : undefined;
      var disk = diskVersions != null ? diskVersions[key] : undefined;
      if (boot !== undefined && disk !== undefined && boot !== disk) {
        changed.push(COMPONENT_LABELS[key] + ': ' + boot + ' \u2192 ' + disk);
      }
    }
    return changed;
  }

  /**
   * Perform a single poll: call the server-info endpoint, check staleness,
   * and inject the banner if stale. Stops polling once the banner is shown.
   * Silently continues polling on network / API errors.
   */
  function _poll() {
    API.getServerInfo().then(function (data) {
      if (!data || !data.stale) return;
      _stopPolling();
      var changed = _detectChanges(data.bootVersions, data.diskVersions);
      _insertBanner(changed);
    }).catch(function () {
      /* Network error — ignore and let the interval fire again */
    });
  }

  /**
   * Initialise stale-instance detection. Calls the server-info endpoint
   * immediately, then repeats every 30 seconds until staleness is detected.
   */
  function init() {
    _stopPolling(); /* idempotent — clears any prior interval before starting a new one */
    _poll();
    _intervalId = setInterval(_poll, POLL_INTERVAL_MS);
  }

  return { init: init };
}());
