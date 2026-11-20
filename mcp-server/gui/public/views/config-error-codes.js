/* ============================================================
   views/config-error-codes.js — Error Codes tab module
   Section 4d-ec of the MCP Server Dashboard SPA
   Depends on: API (api-client.js), UI (components.js), escapeHtml,
               formatDate, showError (utils.js), configDirty (config.js)
   Must be loaded BEFORE config.js.
   ============================================================ */

/* ── Module-level state ──────────────────────────────────── */

/* ecProviders:         ProviderListItem[] from GET /api/error-codes/providers,
                        or null until the tab's first lazy load completes.
   ecPluginDir:         Absolute path to the scanned plugin directory.
   ecLoadErrors:        ProviderLoadError[] recorded by the most recent scan.
   ecConfig:            ErrorCodeConfigResponse from GET/PUT /api/error-codes/config
                        (every secret masked to { set: boolean }).
   ecTemporaryCodes:    TemporaryCodeEntry[], newest-first, capped server-side.
   ecSelectedProviderId: id of the provider currently shown in the settings
                        form. Defaults to ecConfig.active_provider on load;
                        changes only via the provider <select>, guarded by
                        the same confirm() dialog as the tab-bar switch.
   ecTestInFlight:      true while a "Test connection" request is pending —
                        guards against a second click firing a second request.
   ecSaveInFlight:      true while a Save (PUT config) request is pending —
                        guards against a second submit (button click, a
                        second `submit` event or form.requestSubmit(), all of
                        which bypass the button's DOM `disabled` attribute).
                        Deliberately NOT reset by ecCleanup(): a PUT still
                        pending after leaving and re-entering the tab keeps
                        blocking a second save until it settles.
   ecClickHandler / ecChangeHandler / ecInputHandler / ecSubmitHandler:
                        currently-attached delegated listeners on
                        #config-tab-content / #ec-form. Tracked so
                        ecCleanup() can remove them before re-wiring —
                        #config-tab-content persists across innerHTML
                        replacements within one tab visit, so skipping this
                        guard would accumulate duplicate listeners. */
var ecProviders          = null;
var ecPluginDir          = '';
var ecLoadErrors         = [];
var ecConfig             = null;
var ecTemporaryCodes     = null;
var ecSelectedProviderId = null;
var ecTestInFlight       = false;
var ecSaveInFlight       = false;
var ecClickHandler       = null;
var ecChangeHandler      = null;
var ecInputHandler       = null;
var ecSubmitHandler      = null;

/* ── Helpers ─────────────────────────────────────────────── */

/** Derive the DOM id for a settings field's control from its descriptor key. */
function ecFieldId(key) {
  return 'ec-field-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Find a provider by id in ecProviders. Returns null if not found/not loaded. */
function ecFindProvider(id) {
  if (!ecProviders) return null;
  for (var i = 0; i < ecProviders.length; i++) {
    if (ecProviders[i].id === id) return ecProviders[i];
  }
  return null;
}

/** Write a Save/Test result into the dedicated aria-live region (never #config-msg). */
function ecShowLiveMessage(message, isError) {
  var el = document.getElementById('ec-live-region');
  if (!el) return;
  el.innerHTML = isError ? UI.banner('error', message) : UI.banner('success', message);
}

/* ── Field rendering ─────────────────────────────────────── */

/**
 * Render one descriptor-driven settings field.
 *
 * `storedValue` is the already-masked public value for this key (a plain
 * value for every type except `secret`, which arrives as `{ set: boolean }`).
 *
 * Secret-field exception to the generic required/aria-required rule: a
 * `required` secret only carries the native `required` attribute when it is
 * NOT currently set. `aria-required="true"` is always present when the
 * field is required, regardless of Set state. This mirrors
 * `mergeSettingsUpdate`'s documented contract (settings-schema.ts) that "the
 * GUI never has to resend a password just to save an unrelated field" — a
 * literal `required` on an already-set, intentionally-blank password input
 * would block exactly that save.
 */
function ecRenderField(field, storedValue) {
  var id = ecFieldId(field.key);
  var descId = id + '-desc';
  var hasDescription = !!field.description;
  var describedBy = hasDescription ? ' aria-describedby="' + descId + '"' : '';
  var descHtml = hasDescription ? '<p class="form-note" id="' + descId + '">' + escapeHtml(field.description) + '</p>' : '';
  var required = 'required' in field && field.required === true;

  var knownTypes = { string: 1, path: 1, url: 1, secret: 1, integer: 1, boolean: 1, select: 1 };
  var type = knownTypes[field.type] ? field.type : 'string'; /* unknown descriptor types render as text */

  if (type === 'boolean') {
    var checked = storedValue === true;
    return '<div class="form-group ec-field-group">' +
      '<label class="form-label" for="' + id + '">' +
        '<input type="checkbox" class="form-check" id="' + id + '" data-ec-key="' + escapeHtml(field.key) + '" data-ec-type="boolean"' + (checked ? ' checked' : '') + describedBy + '>' +
        ' ' + escapeHtml(field.label) +
      '</label>' +
      descHtml +
    '</div>';
  }

  if (type === 'select') {
    var options = (field.options || []).map(function (o) {
      return '<option value="' + escapeHtml(o.value) + '"' + (o.value === storedValue ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
    }).join('');
    return '<div class="form-group ec-field-group">' +
      '<label class="form-label" for="' + id + '">' + escapeHtml(field.label) + (required ? ' *' : '') + '</label>' +
      '<select class="form-control" id="' + id + '" data-ec-key="' + escapeHtml(field.key) + '" data-ec-type="select"' + describedBy + '>' + options + '</select>' +
      descHtml +
    '</div>';
  }

  if (type === 'secret') {
    var isSet = !!(storedValue && storedValue.set === true);
    var secretRequiredAttr = required ? (isSet ? ' aria-required="true"' : ' required aria-required="true"') : '';
    var statusText = isSet ? 'Set' : 'Not set';
    var clearHtml = isSet
      ? '<label class="ec-clear-secret-label" for="' + id + '-clear">' +
          '<input type="checkbox" class="form-check ec-clear-secret" id="' + id + '-clear" data-ec-clear-key="' + escapeHtml(field.key) + '"> Clear stored value' +
        '</label>'
      : '';
    return '<div class="form-group ec-field-group">' +
      '<label class="form-label" for="' + id + '">' + escapeHtml(field.label) + (required ? ' *' : '') + '</label>' +
      '<input type="password" class="form-control" id="' + id + '" data-ec-key="' + escapeHtml(field.key) + '" data-ec-type="secret" autocomplete="new-password" value=""' + secretRequiredAttr + describedBy + '>' +
      '<p class="ec-secret-status">' + statusText + '</p>' +
      clearHtml +
      descHtml +
    '</div>';
  }

  if (type === 'integer') {
    var minAttr = field.min != null ? ' min="' + escapeHtml(String(field.min)) + '"' : '';
    var maxAttr = field.max != null ? ' max="' + escapeHtml(String(field.max)) + '"' : '';
    var intRequired = required ? ' required aria-required="true"' : '';
    return '<div class="form-group ec-field-group">' +
      '<label class="form-label" for="' + id + '">' + escapeHtml(field.label) + (required ? ' *' : '') + '</label>' +
      '<input type="number" class="form-control" id="' + id + '" data-ec-key="' + escapeHtml(field.key) + '" data-ec-type="integer" step="1" value="' + escapeHtml(storedValue != null ? String(storedValue) : '') + '"' + minAttr + maxAttr + intRequired + describedBy + '>' +
      descHtml +
    '</div>';
  }

  /* string, path, url, and unknown-type fallback (all rendered as text/url input) */
  var inputType = type === 'url' ? 'url' : 'text';
  var placeholderAttr = field.placeholder ? ' placeholder="' + escapeHtml(field.placeholder) + '"' : '';
  var strRequired = required ? ' required aria-required="true"' : '';
  return '<div class="form-group ec-field-group">' +
    '<label class="form-label" for="' + id + '">' + escapeHtml(field.label) + (required ? ' *' : '') + '</label>' +
    '<input type="' + inputType + '" class="form-control" id="' + id + '" data-ec-key="' + escapeHtml(field.key) + '" data-ec-type="' + escapeHtml(type) + '" value="' + escapeHtml(storedValue != null ? String(storedValue) : '') + '"' + strRequired + describedBy + placeholderAttr + '>' +
    descHtml +
  '</div>';
}

/** Render the core (non-provider-specific) allocator settings fields. */
function ecRenderCoreSettings() {
  var cfg = ecConfig || {};
  var retry = cfg.retry || {};
  return (
    '<div class="form-group">' +
      '<label class="form-label" for="ec-core-temporary-prefix">Temporary code prefix</label>' +
      '<input type="text" class="form-control" id="ec-core-temporary-prefix" value="' + escapeHtml(cfg.temporary_prefix != null ? cfg.temporary_prefix : '') + '" required aria-required="true">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label" for="ec-core-timeout-ms">Allocation timeout (ms)</label>' +
      '<input type="number" class="form-control" id="ec-core-timeout-ms" min="1" step="1" value="' + escapeHtml(cfg.timeout_ms != null ? String(cfg.timeout_ms) : '') + '" required aria-required="true">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label" for="ec-core-retry-default">Default retry wait (ms)</label>' +
      '<input type="number" class="form-control" id="ec-core-retry-default" min="1" step="1" value="' + escapeHtml(retry.default_wait_ms != null ? String(retry.default_wait_ms) : '') + '" required aria-required="true">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label" for="ec-core-retry-max">Max retry wait (ms)</label>' +
      '<input type="number" class="form-control" id="ec-core-retry-max" min="1" step="1" value="' + escapeHtml(retry.max_wait_ms != null ? String(retry.max_wait_ms) : '') + '" required aria-required="true">' +
    '</div>'
  );
}

/** Render the plugins panel: directory path + copy button, installed plugins, load errors, empty state. */
function ecRenderPluginsPanel() {
  var plugins = [];
  for (var i = 0; i < (ecProviders || []).length; i++) {
    if (ecProviders[i].source === 'plugin') plugins.push(ecProviders[i]);
  }

  var dirHtml =
    '<div class="form-group">' +
      '<label class="form-label" for="ec-plugin-dir">Plugin directory</label>' +
      '<div class="ec-plugin-dir-row">' +
        '<input type="text" class="form-control" id="ec-plugin-dir" readonly value="' + escapeHtml(ecPluginDir) + '">' +
        '<button type="button" class="btn btn-sm btn-secondary" id="ec-copy-plugin-dir-btn" data-path="' + escapeHtml(ecPluginDir) + '" aria-label="Copy plugin directory path">Copy</button>' +
      '</div>' +
    '</div>';

  var listHtml;
  if (!plugins.length) {
    listHtml = UI.emptyState('No plugins installed.');
  } else {
    listHtml = '<ul class="ec-plugin-list">' + plugins.map(function (p) {
      return '<li class="ec-plugin-item"><strong>' + escapeHtml(p.label) + '</strong> <code>' + escapeHtml(p.id) + '</code>' +
        (p.path ? '<div class="ec-plugin-path">' + escapeHtml(p.path) + '</div>' : '') +
      '</li>';
    }).join('') + '</ul>';
  }

  var errorsHtml = '';
  if ((ecLoadErrors || []).length) {
    errorsHtml = '<div class="ec-plugin-errors">' +
      '<p class="form-note">Plugin load errors:</p>' +
      '<ul class="ec-plugin-error-list">' + ecLoadErrors.map(function (e) {
        return '<li class="ec-plugin-error-item">' + escapeHtml(e.source) + ': ' + escapeHtml(e.message) + '</li>';
      }).join('') + '</ul>' +
      '<p class="form-note">Restart the server after fixing a plugin to reload it.</p>' +
    '</div>';
  }

  return dirHtml + listHtml + errorsHtml;
}

/** Render the temporary-codes list (newest first — already sorted/capped server-side). */
function ecRenderTemporaryList() {
  if (!ecTemporaryCodes || !ecTemporaryCodes.length) {
    return UI.emptyState('No temporary codes logged.');
  }
  var rows = ecTemporaryCodes.map(function (entry) {
    return '<tr>' +
      '<td class="ec-tabular-nums">' + escapeHtml(entry.code) + '</td>' +
      '<td>' + escapeHtml(formatDate(entry.issued_at)) + '</td>' +
      '<td>' + escapeHtml(entry.provider || '—') + '</td>' +
      '<td>' + escapeHtml(entry.fallback_reason || '—') + '</td>' +
      '<td>' + escapeHtml(entry.repository || '—') + '</td>' +
      '<td>' + escapeHtml(entry.detail || '—') + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="ec-temporary-wrapper">' +
    '<table class="ec-temporary-table">' +
      '<thead><tr><th>Code</th><th>Issued</th><th>Provider</th><th>Reason</th><th>Repository</th><th>Detail</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';
}

/* ── Tab rendering ───────────────────────────────────────── */

/** Build the full Error Codes tab HTML from current module state. Assumes ecProviders/ecConfig are already loaded. */
function ecBuildTabHtml() {
  var provider = ecFindProvider(ecSelectedProviderId) || (ecProviders && ecProviders[0]) || null;
  if (!provider) {
    return UI.emptyState('No error-code providers are registered.');
  }

  var storedProviderSettings = (ecConfig && ecConfig.providers && ecConfig.providers[provider.id]) || {};

  var providerOptionsHtml = ecProviders.map(function (p) {
    return '<option value="' + escapeHtml(p.id) + '"' + (p.id === provider.id ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
  }).join('');

  var fieldsHtml = provider.settings.map(function (field) {
    return ecRenderField(field, storedProviderSettings[field.key]);
  }).join('');

  var descriptionHtml = provider.description
    ? '<p class="form-note">' + escapeHtml(provider.description) + '</p>'
    : '';

  var testBtnHtml = provider.supports_test
    ? '<button type="button" class="btn btn-secondary" id="ec-test-btn">Test connection</button>'
    : '';

  var formHtml =
    '<form id="ec-form">' +
      '<div class="form-group">' +
        '<label class="form-label" for="ec-provider-select">Provider</label>' +
        '<select class="form-control" id="ec-provider-select">' + providerOptionsHtml + '</select>' +
      '</div>' +
      descriptionHtml +
      fieldsHtml +
      '<div class="ec-section-title">Core Settings</div>' +
      ecRenderCoreSettings() +
      '<div class="ec-action-bar mt-16">' +
        '<button type="submit" class="btn btn-primary" id="ec-save-btn">Save</button> ' +
        testBtnHtml +
      '</div>' +
      '<div id="ec-live-region" role="status" aria-live="polite" class="ec-live-region"></div>' +
    '</form>';

  return UI.card('Error Code Provider', formHtml) +
    UI.card('Plugins', ecRenderPluginsPanel(), { extraClass: 'mt-16' }) +
    UI.card('Temporary Codes', ecRenderTemporaryList(), { extraClass: 'mt-16' });
}

/**
 * Entry point called by config.js's tab dispatcher. Lazily fetches
 * providers/config/temporary codes on first open (ecProviders === null);
 * on every later call (cached state present) just re-renders synchronously.
 */
function ecRenderTab() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  if (ecProviders === null) {
    showLoading(contentEl);
    Promise.all([
      API.getErrorCodeProviders(),
      API.getErrorCodeConfig(),
      API.getTemporaryErrorCodes()
    ]).then(function (results) {
      var providersResp = results[0] || {};
      ecProviders = providersResp.providers || [];
      ecPluginDir = providersResp.plugin_dir || '';
      ecLoadErrors = providersResp.load_errors || [];
      ecConfig = results[1];
      ecTemporaryCodes = (results[2] && results[2].entries) || [];
      ecSelectedProviderId = ecConfig ? ecConfig.active_provider : null;
      contentEl.innerHTML = ecBuildTabHtml();
      ecWireEvents();
    }).catch(function (err) {
      showError(contentEl, 'Failed to load error-code settings: ' + (err.message || String(err)));
    });
    return;
  }

  contentEl.innerHTML = ecBuildTabHtml();
  ecWireEvents();
}

/* ── Settings collection ─────────────────────────────────── */

/**
 * Reads the current form values for one provider's settings descriptors.
 * Returns `{ settings, clear_secrets }`. A secret field whose "Clear stored
 * value" checkbox is ticked is omitted from `settings` and listed in
 * `clear_secrets`; a secret left blank (and not cleared) is omitted
 * entirely, so the server keeps the stored value.
 */
function ecCollectProviderSettings(provider) {
  var settings = {};
  var clearSecrets = [];
  for (var i = 0; i < provider.settings.length; i++) {
    var field = provider.settings[i];
    var id = ecFieldId(field.key);
    var el = document.getElementById(id);
    if (!el) continue;

    if (field.type === 'secret') {
      var clearEl = document.getElementById(id + '-clear');
      if (clearEl && clearEl.checked) { clearSecrets.push(field.key); continue; }
      if (el.value !== '') settings[field.key] = el.value;
      continue;
    }
    if (field.type === 'boolean') { settings[field.key] = el.checked; continue; }
    if (field.type === 'integer') {
      if (el.value !== '') {
        var n = parseInt(el.value, 10);
        if (!isNaN(n)) settings[field.key] = n;
      }
      continue;
    }
    settings[field.key] = el.value;
  }
  return { settings: settings, clear_secrets: clearSecrets };
}

/** Reads and validates the core settings fields. Returns null (and shows an error) when invalid. */
function ecCollectCoreSettings() {
  var prefixEl        = document.getElementById('ec-core-temporary-prefix');
  var timeoutEl       = document.getElementById('ec-core-timeout-ms');
  var retryDefaultEl  = document.getElementById('ec-core-retry-default');
  var retryMaxEl      = document.getElementById('ec-core-retry-max');

  var timeout      = parseInt(timeoutEl.value, 10);
  var retryDefault = parseInt(retryDefaultEl.value, 10);
  var retryMax     = parseInt(retryMaxEl.value, 10);

  if (isNaN(timeout) || timeout <= 0) { ecShowLiveMessage('Allocation timeout must be a positive integer.', true); return null; }
  if (isNaN(retryDefault) || retryDefault <= 0) { ecShowLiveMessage('Default retry wait must be a positive integer.', true); return null; }
  if (isNaN(retryMax) || retryMax <= 0) { ecShowLiveMessage('Max retry wait must be a positive integer.', true); return null; }

  return {
    temporary_prefix: prefixEl.value,
    timeout_ms: timeout,
    retry: { default_wait_ms: retryDefault, max_wait_ms: retryMax }
  };
}

/* ── Event handlers ──────────────────────────────────────── */

/** Format a POST /api/error-codes/test result into a human-readable message. */
function ecFormatTestResult(result) {
  if (!result.supported) return result.message || 'Provider offers no connection test.';
  if (result.ok) {
    return 'Connection OK.' + (result.detail ? ' ' + result.detail : '') + (result.value != null ? ' (value: ' + result.value + ')' : '');
  }
  return 'Connection failed (' + result.reason + ').' + (result.detail ? ' ' + result.detail : '');
}

function ecHandleTestClick(btn) {
  if (ecTestInFlight) return;
  var provider = ecFindProvider(ecSelectedProviderId);
  if (!provider) return;

  var collected = ecCollectProviderSettings(provider);

  ecTestInFlight = true;
  btn.disabled = true;
  var originalLabel = 'Test connection';
  btn.textContent = 'Testing…';

  API.testErrorCodeProvider(ecSelectedProviderId, collected.settings).then(function (result) {
    ecTestInFlight = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
    var isError = !result.supported || result.ok === false;
    ecShowLiveMessage(ecFormatTestResult(result), isError);
  }).catch(function (err) {
    ecTestInFlight = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
    ecShowLiveMessage('Test failed: ' + (err.message || String(err)), true);
  });
}

function ecHandleSave(form) {
  if (ecSaveInFlight) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;

  var provider = ecFindProvider(ecSelectedProviderId);
  if (!provider) return;

  var collected = ecCollectProviderSettings(provider);
  var core = ecCollectCoreSettings();
  if (core === null) return;

  ecSaveInFlight = true;
  var saveBtn = document.getElementById('ec-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  var body = {
    active_provider: ecSelectedProviderId,
    provider_id: ecSelectedProviderId,
    settings: collected.settings,
    clear_secrets: collected.clear_secrets,
    temporary_prefix: core.temporary_prefix,
    timeout_ms: core.timeout_ms,
    retry: core.retry
  };

  API.updateErrorCodeConfig(body).then(function (updatedConfig) {
    ecSaveInFlight = false;
    ecConfig = updatedConfig;
    configDirty.errorCodes = false;
    ecRenderTab();
    ecShowLiveMessage('Configuration saved.', false);
  }).catch(function (err) {
    ecSaveInFlight = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    ecShowLiveMessage('Save failed: ' + (err.message || String(err)), true);
  });
}

/** Handle a provider-select change: guards unsaved edits via the same confirm() pattern as the tab bar. */
function ecHandleProviderChange(selectEl) {
  var newId = selectEl.value;
  if (newId === ecSelectedProviderId) return;

  if (configDirty.errorCodes) {
    if (!confirm('You have unsaved changes. Discard them?')) {
      selectEl.value = ecSelectedProviderId;
      return;
    }
    configDirty.errorCodes = false;
  }

  ecSelectedProviderId = newId;
  ecRenderTab();
}

function ecHandleCopyPluginDir(btn) {
  var path = btn.getAttribute('data-path') || '';
  var originalLabel = 'Copy';
  function done() {
    btn.textContent = '✓';
    setTimeout(function () { btn.textContent = originalLabel; }, 1200);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(path).then(done);
  } else {
    var ta = document.createElement('textarea');
    ta.value = path;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  }
}

/* ── Event wiring ────────────────────────────────────────── */

/** Remove every delegated listener this module has attached. Safe to call when nothing is attached. */
function ecCleanup() {
  var contentEl = document.getElementById('config-tab-content');
  if (contentEl) {
    if (ecClickHandler)  contentEl.removeEventListener('click', ecClickHandler);
    if (ecChangeHandler) contentEl.removeEventListener('change', ecChangeHandler);
    if (ecInputHandler)  contentEl.removeEventListener('input', ecInputHandler);
  }
  var form = document.getElementById('ec-form');
  if (form && ecSubmitHandler) form.removeEventListener('submit', ecSubmitHandler);

  ecClickHandler = ecChangeHandler = ecInputHandler = ecSubmitHandler = null;
}

/** Wire all event handlers for the Error Codes tab (delegated from #config-tab-content, plus the form's submit). */
function ecWireEvents() {
  var contentEl = document.getElementById('config-tab-content');
  if (!contentEl) return;

  /* Guard against duplicate listeners — #config-tab-content persists across
     innerHTML replacements within one tab visit. */
  ecCleanup();

  ecChangeHandler = function (e) {
    var target = e.target;

    if (target.id === 'ec-provider-select') {
      ecHandleProviderChange(target);
      return;
    }

    if (target.classList.contains('ec-clear-secret')) {
      var key = target.getAttribute('data-ec-clear-key');
      var input = document.getElementById(ecFieldId(key));
      if (input) {
        if (target.checked) input.value = '';
        input.disabled = target.checked;
      }
      configDirty.errorCodes = true;
      return;
    }

    configDirty.errorCodes = true;
  };
  contentEl.addEventListener('change', ecChangeHandler);

  ecInputHandler = function () {
    configDirty.errorCodes = true;
  };
  contentEl.addEventListener('input', ecInputHandler);

  ecClickHandler = function (e) {
    var target = e.target;

    var testBtn = target.closest ? target.closest('#ec-test-btn') : null;
    if (testBtn) { ecHandleTestClick(testBtn); return; }

    var copyBtn = target.closest ? target.closest('#ec-copy-plugin-dir-btn') : null;
    if (copyBtn) { ecHandleCopyPluginDir(copyBtn); return; }
  };
  contentEl.addEventListener('click', ecClickHandler);

  var form = document.getElementById('ec-form');
  if (form) {
    ecSubmitHandler = function (e) {
      e.preventDefault();
      ecHandleSave(form);
    };
    form.addEventListener('submit', ecSubmitHandler);
  }
}
