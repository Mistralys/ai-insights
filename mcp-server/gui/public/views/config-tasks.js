/* ============================================================
   views/config-tasks.js — Tasks tab module
   Section 4d-ct of the MCP Server Dashboard SPA
   Depends on: API (api-client.js), escapeHtml, showError (utils.js),
               configDirty (config.js)
   Must be loaded BEFORE config.js.

   Tab contract (see config.js's CONFIG_TABS registry): registered as
   { render: ctRenderTab, leave: ctResetState, reset: ctResetState }.
   The tab reads the config object config.js has already loaded (no lazy
   fetch), so it has no "keep state unless discarded" case: one reset
   function serves both leave and reset.
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

/* ctVisit:         Monotonic visit token, incremented by ctResetState().
                    A save callback captured under an older visit writes
                    nothing to the DOM or to configDirty.
   ctConfig:        The config object passed to the current render. Updated in
                    place after a successful save so re-entering the tab shows
                    the saved values.
   ctSaveInFlight:  True while a PUT is pending; spans visits (like
                    ecSaveInFlight) and is cleared by the save callback itself.
   ctSubmitHandler / ctInputHandler: listeners attached to the current form. */
var ctVisit          = 0;
var ctConfig         = null;
var ctSaveInFlight   = false;
var ctSubmitHandler  = null;
var ctInputHandler   = null;

/* Mirrors of the GuiConfigSchema rules in src/gui/config.ts (the server is
   authoritative; these only give early feedback). */
var CT_QUEUE_PATTERN = /^([A-Za-z][A-Za-z0-9_]*-?)?$/;
var CT_QUEUE_MAX     = 32;
var CT_PAGE_MIN      = 5;
var CT_PAGE_MAX      = 200;

/** Remove the form listeners of the current render. */
function ctCleanup() {
  var form = document.getElementById('ct-form');
  if (form) {
    if (ctSubmitHandler) form.removeEventListener('submit', ctSubmitHandler);
    if (ctInputHandler) {
      form.removeEventListener('input', ctInputHandler);
      form.removeEventListener('change', ctInputHandler);
    }
  }
  ctSubmitHandler = null;
  ctInputHandler = null;
}

/**
 * Leave the tab: invalidate pending callbacks and drop listeners/state.
 * Does NOT reset ctSaveInFlight (a pending PUT keeps blocking a second save;
 * its callback clears the flag itself, even when stale).
 */
function ctResetState() {
  ctVisit++;
  ctCleanup();
  ctConfig = null;
}

/** True for a valid absolute http(s) URL (mirrors isSafeTicketBaseUrl). */
function ctIsHttpUrl(value) {
  try {
    var u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Validate the raw form values. Returns { error: string } or
 * { value: { tasks_ticket_base_url, tasks_ticket_queue, tasks_page_size } }.
 */
function ctValidate(baseUrl, queue, pageSizeRaw) {
  baseUrl = String(baseUrl).trim();
  queue = String(queue).trim();
  if (baseUrl !== '' && !ctIsHttpUrl(baseUrl)) {
    return { error: 'Ticket base URL must be empty or an absolute http(s) URL.' };
  }
  if (queue.length > CT_QUEUE_MAX || !CT_QUEUE_PATTERN.test(queue)) {
    return { error: 'Ticket queue must start with a letter, contain only letters, digits and underscores (optionally ending in a hyphen), and be at most ' + CT_QUEUE_MAX + ' characters.' };
  }
  var raw = String(pageSizeRaw).trim();
  var pageSize = /^-?[0-9]+$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (isNaN(pageSize) || pageSize < CT_PAGE_MIN || pageSize > CT_PAGE_MAX) {
    return { error: 'Default entries per page must be a whole number between ' + CT_PAGE_MIN + ' and ' + CT_PAGE_MAX + '.' };
  }
  return { value: { tasks_ticket_base_url: baseUrl, tasks_ticket_queue: queue, tasks_page_size: pageSize } };
}

/** Render the tab into #config-tab-content and wire its events. */
function ctRenderTab(config) {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;
  ctCleanup();
  ctConfig = config || {};
  var pageSize = ctConfig.tasks_page_size != null ? ctConfig.tasks_page_size : 20;

  contentEl.innerHTML =
    '<form id="ct-form" novalidate>' +
      '<div class="form-group">' +
        '<label for="ct-base-url">Ticket base URL</label>' +
        '<input type="url" id="ct-base-url" class="form-control" aria-describedby="ct-base-url-help" value="' + escapeHtml(ctConfig.tasks_ticket_base_url || '') + '">' +
        '<p class="form-note" id="ct-base-url-help">Absolute http(s) URL that ticket references are appended to. Leave empty to show tickets as plain text.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="ct-queue">Default ticket queue</label>' +
        '<input type="text" id="ct-queue" class="form-control" maxlength="' + CT_QUEUE_MAX + '" aria-describedby="ct-queue-help" value="' + escapeHtml(ctConfig.tasks_ticket_queue || '') + '">' +
        '<p class="form-note" id="ct-queue-help">Queue name prefixed to bare ticket numbers, e.g. PROJ. Optional.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="ct-page-size">Default entries per page</label>' +
        '<input type="number" id="ct-page-size" class="form-control" min="' + CT_PAGE_MIN + '" max="' + CT_PAGE_MAX + '" step="1" aria-describedby="ct-page-size-help" value="' + escapeHtml(String(pageSize)) + '">' +
        '<p class="form-note" id="ct-page-size-help">Number of tasks listed per page, from ' + CT_PAGE_MIN + ' to ' + CT_PAGE_MAX + '.</p>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary" id="ct-save">Save</button>' +
      '<div id="ct-msg" aria-live="polite"></div>' +
    '</form>';

  var form = document.getElementById('ct-form');
  ctInputHandler = function () { configDirty.tasks = true; };
  form.addEventListener('input', ctInputHandler);
  form.addEventListener('change', ctInputHandler);

  ctSubmitHandler = function (e) {
    e.preventDefault();
    var msgEl = document.getElementById('ct-msg');
    if (ctSaveInFlight) return;
    var result = ctValidate(
      document.getElementById('ct-base-url').value,
      document.getElementById('ct-queue').value,
      document.getElementById('ct-page-size').value
    );
    if (result.error) {
      showError(msgEl, result.error);
      return;
    }
    var visit = ctVisit;
    var cfg = ctConfig;
    ctSaveInFlight = true;
    API.updateConfig(result.value)
      .then(function () {
        ctSaveInFlight = false;
        if (cfg) {
          cfg.tasks_ticket_base_url = result.value.tasks_ticket_base_url;
          cfg.tasks_ticket_queue = result.value.tasks_ticket_queue;
          cfg.tasks_page_size = result.value.tasks_page_size;
        }
        if (visit !== ctVisit) return;   /* persisted; the next visit shows it */
        configDirty.tasks = false;
        msgEl.innerHTML = '<p class="success-banner">Configuration saved.</p>';
      })
      .catch(function (err) {
        ctSaveInFlight = false;
        if (visit !== ctVisit) return;
        showError(msgEl, 'Save failed: ' + ((err && err.message) || String(err)));
      });
  };
  form.addEventListener('submit', ctSubmitHandler);
}
