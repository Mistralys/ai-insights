/* ============================================================
   setup-notices.js — Global setup-notices banner module
   Section 6b of the MCP Server Dashboard SPA

   Polls GET /api/setup-notices and renders a dismissible-by-resolution
   banner (one `.setup-banner` per active notice) offering a one-click
   remediation button when the notice carries an `action`. Modelled on
   stale-check.js's IIFE pattern and lifecycle, but kept as a separate
   module (not merged into StaleCheck) because the two banners track
   different lifecycles: "relaunch needed" (one-shot, never clears once
   shown) versus "build something" (recurring, clears once the gap closes).

   Public surface: only init() and refresh() are exposed. No window event
   is dispatched and this module never reaches into any view module — the
   one-way coupling (view -> SetupNotices.refresh()) is owned by the
   caller (see views/config-persona-models.js's pmDoRebuild()).
   ============================================================ */

var SetupNotices = (function () {
  var POLL_INTERVAL_MS = 30 * 1000;

  var _container  = null;  /* #setup-notices live region, inserted once */
  var _intervalId = null;
  var _notices    = [];    /* last-fetched SetupNotice[] */
  var _buildState = {};    /* { [noticeId]: { building, error, conflict } } */
  var _listenerAttached = false;

  /* ── Polling lifecycle ──────────────────────────────────── */

  function _startPolling() {
    if (_intervalId !== null) return;
    _intervalId = setInterval(_poll, POLL_INTERVAL_MS);
  }

  function _stopPolling() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  function _poll() {
    refresh();
  }

  function _onVisibilityChange() {
    if (document.hidden) {
      _stopPolling();
    } else {
      /* Resume with an immediate refresh (which restarts the interval only
         when notices are actually found — see refresh()'s own bookkeeping),
         and also eagerly restart the interval itself so a poll tick that
         lands before the refresh resolves is not silently dropped. */
      _startPolling();
      refresh();
    }
  }

  /* ── DOM setup ───────────────────────────────────────────── */

  /**
   * Insert the `#setup-notices` live region before `body > header`, placed
   * after `.stale-banner` when one is already present so the two banners
   * never overlap or fight for the same slot.
   */
  function _ensureContainer() {
    if (_container) return;

    _container = document.createElement('div');
    _container.id = 'setup-notices';
    _container.setAttribute('role', 'status');
    _container.setAttribute('aria-live', 'polite');

    var staleBanner = document.querySelector('.stale-banner');
    var header = document.querySelector('body > header');
    if (staleBanner && staleBanner.parentNode) {
      staleBanner.parentNode.insertBefore(_container, staleBanner.nextSibling);
    } else if (header) {
      document.body.insertBefore(_container, header);
    } else {
      document.body.insertBefore(_container, document.body.firstChild);
    }
  }

  /* ── Rendering (textContent/DOM only — never innerHTML for server strings) ── */

  function _render() {
    if (!_container) return;
    while (_container.firstChild) {
      _container.removeChild(_container.firstChild);
    }

    _notices.forEach(function (notice) {
      var state = _buildState[notice.id];
      if (!state) {
        state = { building: false, error: null, conflict: false };
        _buildState[notice.id] = state;
      }

      var banner = document.createElement('div');
      banner.className = 'setup-banner';

      var heading = document.createElement('strong');
      heading.textContent = notice.title;
      banner.appendChild(heading);

      var message = document.createElement('span');
      message.textContent = ' ' + notice.message;
      banner.appendChild(message);

      if (notice.action && notice.action.kind === 'rebuild-personas') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-primary setup-banner-btn';

        if (state.building) {
          btn.disabled = true;
          var spinner = document.createElement('span');
          spinner.className = 'spinner';
          spinner.setAttribute('aria-hidden', 'true');
          btn.appendChild(spinner);
          btn.appendChild(document.createTextNode('Building…'));
        } else if (state.conflict) {
          btn.disabled = true;
          btn.textContent = 'Build already running…';
        } else {
          btn.textContent = 'Build personas';
          btn.addEventListener('click', function () { _doBuild(notice.id); });
        }

        banner.appendChild(btn);
      }

      if (state.error) {
        var details = document.createElement('details');
        details.className = 'setup-banner-error';

        var summary = document.createElement('summary');
        summary.textContent = 'Build failed';
        details.appendChild(summary);

        var hint = document.createElement('p');
        hint.appendChild(document.createTextNode('Run '));
        var code = document.createElement('code');
        code.textContent = 'node scripts/cli.js setup';
        hint.appendChild(code);
        hint.appendChild(document.createTextNode(' from the workspace root to diagnose further.'));
        details.appendChild(hint);

        var pre = document.createElement('pre');
        pre.className = 'pm-build-error-pre';
        pre.textContent = state.error;
        details.appendChild(pre);

        banner.appendChild(details);
      }

      _container.appendChild(banner);
    });
  }

  /* ── Build action (shared by every notice's remediation button) ── */

  function _doBuild(noticeId) {
    var state = _buildState[noticeId];
    if (!state || state.building) return;

    state.building = true;
    state.error = null;
    state.conflict = false;
    _render();

    API.rebuildPersonas()
      .then(function () {
        /* Success — re-fetch notices; the resolved notice drops out on its own. */
        refresh();
      })
      .catch(function (err) {
        state.building = false;
        if (err && err.code === 'CONFLICT') {
          state.conflict = true;
        } else {
          state.error = (err && err.message) ? err.message : String(err);
        }
        _render();
      });
  }

  /* ── Public: refresh ─────────────────────────────────────── */

  /**
   * Fetch the current notice list, re-render, and start/stop polling based
   * on whether any notices remain. Safe to call at any time (including
   * before init(), and from outside this module e.g. a successful rebuild
   * elsewhere in the GUI) — network errors are swallowed so a transient
   * failure does not clear the banner or stop polling.
   *
   * @returns {Promise<void>}
   */
  function refresh() {
    return API.getSetupNotices()
      .then(function (data) {
        _notices = (data && data.notices) || [];

        /* Drop build state for notices that are no longer active. */
        var activeIds = {};
        _notices.forEach(function (n) { activeIds[n.id] = true; });
        Object.keys(_buildState).forEach(function (id) {
          if (!activeIds[id]) delete _buildState[id];
        });

        _render();

        if (_notices.length > 0) {
          _startPolling();
        } else {
          _stopPolling();
        }
      })
      .catch(function () {
        /* Network error — keep prior notices/state and current polling state. */
      });
  }

  /* ── Public: init ────────────────────────────────────────── */

  /**
   * Initialise the setup-notices banner: insert the live region, start the
   * polling interval (so a failed first fetch is retried rather than never
   * scheduling a follow-up), and perform an immediate refresh. refresh()'s
   * own bookkeeping stops the interval again once it confirms the notice
   * list is empty.
   */
  function init() {
    _ensureContainer();
    if (!_listenerAttached) {
      document.addEventListener('visibilitychange', _onVisibilityChange);
      _listenerAttached = true;
    }
    _startPolling();
    refresh();
  }

  return { init: init, refresh: refresh };
}());
