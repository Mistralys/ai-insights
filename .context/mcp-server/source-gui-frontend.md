# MCP Server - Source (GUI Frontend)
_SOURCE: GUI static frontend: app shell, views, router, and utilities_
# GUI static frontend: app shell, views, router, and utilities
```
// Structure of documents
└── mcp-server/
    └── gui/
        └── public/
            └── api-client.js
            └── app.js
            └── js/
                ├── orchestrator-widgets.js
            └── libs/
                ├── marked.min.js
            └── router.js
            └── stale-check.js
            └── theme-init.js
            └── theme.js
            └── utils.js
            └── views/
                └── config.js
                └── insights.js
                └── knowledge.js
                └── orchestrator.js
                └── project-detail.js
                └── project-list.js
                └── run-log.js
                └── work-package.js

```
###  Path: `/mcp-server/gui/public/api-client.js`

```js
/* ============================================================
   api-client.js — API Client module
   Section 1 of the MCP Server Dashboard SPA
   ============================================================ */

var API = (function () {
  async function request(method, path, body) {
    var opts = {
      method: method,
      headers: {},
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch('/api' + path, opts);
    if (!res.ok) {
      var errData = null;
      try { errData = await res.json(); } catch (_) {}
      var errMsg = (errData && errData.error && errData.error.message) || ('HTTP ' + res.status);
      var errCode = (errData && errData.error && errData.error.code) || 'ERROR';
      throw { code: errCode, message: errMsg };
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * Serialize *params* as a URL query string.
   *
   * Keys whose value is `undefined` or an empty string (`''`) are silently
   * omitted from the output.  This is intentional: callers use `undefined` as
   * a "no filter" sentinel (e.g. `{ wp: wpId }` where `wpId` may be
   * `undefined`), and the omission prevents `?wp=undefined` from reaching
   * the server.
   *
   * @param {Record<string, any>|null|undefined} params - Key/value pairs to encode.
   * @returns {string} A `?key=value&…` string, or `''` when no params survive
   *   the filter.
   */
  function buildQueryString(params) {
    if (!params) return '';
    var parts = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  }

  return {
    /**
     * List all projects, optionally filtered by query parameters.
     *
     * @param {Record<string, any>|null|undefined} params - Query parameters
     *   (e.g. `{ status, repo }`). `undefined`/empty-string values are omitted.
     * @returns {Promise<object[]>} Parsed JSON response from `GET /api/projects`.
     */
    getProjects: function (params) {
      return request('GET', '/projects' + buildQueryString(params));
    },

    /**
     * Fetch a single project by repository and slug.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Project detail from `GET /api/projects/{repo}/{slug}`.
     */
    getProject: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug)); },

    /**
     * List all work packages for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object[]>} Work package list from `GET /api/projects/{repo}/{slug}/work-packages`.
     */
    getWorkPackages: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages'); },

    /**
     * Fetch a single work package by ID.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} wpId - Work package ID (e.g. `'WP-001'`; URI-encoded automatically).
     * @returns {Promise<object>} Work package detail from `GET /api/projects/{repo}/{slug}/work-packages/{wpId}`.
     */
    getWorkPackage: function (repo, slug, wpId) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages/' + encodeURIComponent(wpId)); },

    /**
     * Permanently delete a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<null>} `null` on success (HTTP 204 No Content).
     */
    deleteProject: function (repo, slug) { return request('DELETE', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug)); },

    /**
     * Archive a project (moves it to archived status).
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/archive`.
     */
    archiveProject: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/archive'); },

    /**
     * Restore an archived project to active status.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/unarchive`.
     */
    unarchiveProject: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/unarchive'); },

    getConfig:                function ()             { return request('GET',    '/config'); },
    updateConfig:             function (data)         { return request('PUT',    '/config', data); },
    getInsights:              function ()             { return request('GET',    '/insights'); },
    getServerInfo:            function ()             { return request('GET',    '/server-info'); },

    /**
     * Fetch the plan document (Markdown) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Plan document from `GET /api/projects/{repo}/{slug}/plan`.
     */
    getPlanDocument: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/plan'); },

    /**
     * Fetch the synthesis document (Markdown) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Synthesis document from `GET /api/projects/{repo}/{slug}/synthesis`.
     */
    getSynthesisDocument: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/synthesis'); },

    /**
     * Perform a dry-run reset analysis for a project.
     *
     * Returns what would change if a reset were applied, without making any
     * modifications. Use `applyProjectReset` to apply the reset with decisions.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Reset analysis from `POST /api/projects/{repo}/{slug}/reset` (`dry_run: true`).
     */
    analyzeProjectReset: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/reset', { dry_run: true }); },

    /**
     * Apply a project reset with caller-supplied decisions.
     *
     * @param {string}   repo      - Repository name that owns the project (URI-encoded automatically).
     * @param {string}   slug      - Unique project slug within the repository (URI-encoded automatically).
     * @param {object[]} decisions - Array of decision objects returned by `analyzeProjectReset`.
     * @returns {Promise<object>} Reset result from `POST /api/projects/{repo}/{slug}/reset` (`dry_run: false`).
     */
    applyProjectReset: function (repo, slug, decisions) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/reset', { dry_run: false, decisions: decisions }); },

    /**
     * Fetch the health summary for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Health report from `GET /api/projects/{repo}/{slug}/health`.
     */
    getProjectHealth: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/health'); },

    /**
     * Fetch the work package overview (aggregate status summary) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Overview from `GET /api/projects/{repo}/{slug}/work-packages/overview`.
     */
    getWorkPackageOverview: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages/overview'); },

    /**
     * Rename a project's display title.
     *
     * @param {string} repo  - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug  - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} title - New display title for the project.
     * @returns {Promise<object>} Updated project from `PATCH /api/projects/{repo}/{slug}`.
     */
    renameProject: function (repo, slug, title) { return request('PATCH', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug), { title: title }); },

    /**
     * Change a project's slug identifier.
     *
     * @param {string} repo    - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug    - Current project slug (URI-encoded automatically).
     * @param {string} newSlug - New slug to assign to the project.
     * @returns {Promise<object>} Updated project from `PATCH /api/projects/{repo}/{slug}`.
     */
    renameSlug: function (repo, slug, newSlug) { return request('PATCH', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug), { slug: newSlug }); },

    /**
     * Mark a project as complete.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/complete`.
     */
    markProjectComplete: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/complete'); },

    /**
     * List all run log files for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object[]>} Run log file list from `GET /api/projects/{repo}/{slug}/runs`.
     */
    getRunLogs: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/runs'); },

    /**
     * Fetch log entries from a specific run log file, optionally starting after
     * a given line number.
     *
     * `afterLine` uses an inline ternary rather than `buildQueryString` because
     * `0` is a valid boundary value that must be included in the query string —
     * `buildQueryString` omits falsy values such as `0`, which would cause
     * the server to return entries from the beginning of the file instead of
     * line 1.
     *
     * @param {string}         repo      - Repository name that owns the project (URI-encoded automatically).
     * @param {string}         slug      - Unique project slug within the repository (URI-encoded automatically).
     * @param {string}         filename  - Run log filename (URI-encoded automatically).
     * @param {number|null}    afterLine - Return only entries after this line number.
     *   Pass `null` or `undefined` to retrieve all entries from the start.
     *   `0` is a valid value and correctly produces `?after=0`.
     * @returns {Promise<object>} Log entries from `GET /api/projects/{repo}/{slug}/runs/{filename}`.
     */
    getRunLogEntries: function (repo, slug, filename, afterLine) {
      var qs = (afterLine !== undefined && afterLine !== null) ? ('?after=' + encodeURIComponent(afterLine)) : '';
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/runs/' + encodeURIComponent(filename) + qs);
    },

    /**
     * Fetch run metadata for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Run metadata from `GET /api/projects/{repo}/{slug}/run-metadata`.
     */
    getRunMetadata: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/run-metadata'); },

    /**
     * List dialogues for a project, optionally filtered by work package ID.
     *
     * @param {string}          repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string}          slug - Unique project slug within the repository (URI-encoded automatically).
     * @param {string|undefined} wpId - Optional work package ID filter (e.g. `'WP-001'`).
     *   Pass `undefined` to retrieve dialogues for all work packages.
     * @returns {Promise<object[]>} Dialogue list from `GET /api/projects/{repo}/{slug}/dialogues`.
     */
    getDialogues: function (repo, slug, wpId) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/dialogues' + buildQueryString({ wp: wpId }));
    },

    /**
     * Fetch the content of a single dialogue file.
     *
     * @param {string} repo     - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug     - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} filename - Dialogue filename (URI-encoded automatically).
     * @returns {Promise<string>} Raw dialogue content string from
     *   `GET /api/projects/{repo}/{slug}/dialogues/{filename}`.
     */
    getDialogueContent: function (repo, slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/dialogues/' + encodeURIComponent(filename))
        .then(function (data) { return data.content; });
    },

    /**
     * List context chunks for a project, optionally filtered by work package ID.
     *
     * @param {string}           repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string}           slug - Unique project slug within the repository (URI-encoded automatically).
     * @param {string|undefined} wpId - Optional work package ID filter (e.g. `'WP-001'`).
     *   Pass `undefined` to retrieve chunks for all work packages.
     * @returns {Promise<object[]>} Chunk list from `GET /api/projects/{repo}/{slug}/chunks`.
     */
    getChunks: function (repo, slug, wpId) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/chunks' + buildQueryString({ wp: wpId }));
    },

    /**
     * Fetch the rendered content of a single context chunk.
     *
     * @param {string} repo     - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug     - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} filename - Chunk filename (URI-encoded automatically).
     * @returns {Promise<string>} Rendered chunk content string from
     *   `GET /api/projects/{repo}/{slug}/chunks/{filename}/rendered`.
     */
    getChunkRendered: function (repo, slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/rendered')
        .then(function (data) { return data.content; });
    },

    // -- Orchestrator --------------------------------------------------
    orchestratorStart: function (planPath, dryRun, resumeThreadId) {
      var body = { planPath: planPath, dryRun: dryRun };
      if (resumeThreadId !== undefined) body.resumeThreadId = resumeThreadId;
      return request('POST', '/orchestrator/start', body);
    },
    orchestratorGetQueue:    function ()                 { return request('GET',    '/orchestrator/queue'); },
    orchestratorGetRunStatus: function (slug)            { return request('GET',    '/orchestrator/run-status/' + encodeURIComponent(slug)); },
    orchestratorKill:        function (id)               { return request('POST',   '/orchestrator/kill/'       + encodeURIComponent(id)); },
    orchestratorDismiss:     function (id)               { return request('POST',   '/orchestrator/dismiss/'    + encodeURIComponent(id)); },

    // -- Knowledge -----------------------------------------------------

    /**
     * List or search knowledge insights stored in the ledger's `.knowledge/`
     * directory.
     *
     * `undefined` or empty-string values are silently omitted from the query
     * string by `buildQueryString` — pass `undefined` to leave a filter unset
     * rather than sending `?scope=undefined` to the server. Note: `null`, `0`,
     * and `false` are truthy-false values and are NOT omitted; they are
     * serialised into the query string.
     *
     * @param {Record<string, any>|null|undefined} params - Query parameters
     *   (e.g. `{ scope, repository_name, category, tags, q }`).
     * @returns {Promise<object>} Parsed JSON response from `GET /api/knowledge`.
     */
    getKnowledge: function (params) {
      return request('GET', '/knowledge' + buildQueryString(params));
    },

    /**
     * Update a knowledge insight by ID.
     *
     * `scope` and `repository_name` are merged into the request body **after**
     * the caller-supplied `data` object, so they always take precedence — a
     * caller cannot override `scope` or `repository_name` via the `data` argument.
     *
     * A `null` or `undefined` `repositoryName` is coerced to `undefined` before
     * serialisation, which causes the key to be omitted from the JSON body.
     *
     * @param {string|number} id             - Insight ID (URI-encoded automatically).
     * @param {string}        scope          - Insight scope (`'global'` or `'repository'`).
     * @param {string|null}   repositoryName - Repository name; null/undefined values are omitted.
     * @param {object}        data           - Fields to update (merged before scope/name).
     * @returns {Promise<object>} Updated insight from `PATCH /api/knowledge/:id`.
     */
    updateKnowledge: function (id, scope, repositoryName, data) {
      return request('PATCH', '/knowledge/' + encodeURIComponent(id), Object.assign({}, data, {
        scope: scope,
        repository_name: repositoryName != null ? repositoryName : undefined,
      }));
    },

    /**
     * Delete a knowledge insight by ID.
     *
     * `scope` and `repository_name` are passed as URL query parameters so the
     * server can locate the correct store file.  A `null` or `undefined`
     * `repositoryName` is coerced to `undefined` and omitted from the query
     * string by `buildQueryString`.
     *
     * @param {string|number} id             - Insight ID (URI-encoded automatically).
     * @param {string}        scope          - Insight scope (`'global'` or `'repository'`).
     * @param {string|null}   repositoryName - Repository name; null/undefined values are omitted.
     * @returns {Promise<null>} `null` on success (HTTP 204 No Content).
     */
    deleteKnowledge: function (id, scope, repositoryName) {
      return request('DELETE', '/knowledge/' + encodeURIComponent(id) + buildQueryString({
        scope: scope,
        repository_name: repositoryName != null ? repositoryName : undefined,
      }));
    },

    /**
     * Promote a repository-scoped insight to global scope.
     *
     * Sends `POST /api/knowledge/:id/promote` with `scope` and `repository_name`
     * as URL query parameters.  **No request body is sent** — the server
     * identifies the source insight via the query parameters alone.
     *
     * A `null` or `undefined` `repositoryName` is coerced to `undefined` and
     * omitted from the query string by `buildQueryString`.
     *
     * @param {string|number} id             - Insight ID (URI-encoded automatically).
     * @param {string}        scope          - Source scope (`'repository'`).
     * @param {string|null}   repositoryName - Source repository name; null/undefined values are omitted.
     * @returns {Promise<object>} The newly created global insight (with a new ID
     *   assigned by the global store — different from the original repository insight ID).
     */
    promoteKnowledge: function (id, scope, repositoryName) {
      return request('POST', '/knowledge/' + encodeURIComponent(id) + '/promote' + buildQueryString({
        scope: scope,
        repository_name: repositoryName != null ? repositoryName : undefined,
      }));
    },

    /**
     * Move a knowledge insight from one scope/repository to another.
     *
     * Sends `POST /api/knowledge/:id/move` with source and target identifiers
     * in the JSON body.  A `null` or `undefined` `sourceRepositoryName` is coerced
     * to `undefined` and omitted from JSON serialisation (moves from global scope
     * have no source repository name).  `targetRepositoryName` is **always required** and is
     * not coerced — a move always needs an explicit destination repository name.
     *
     * Valid move directions: `global → repository` and `repository → repository`.
     * Use `promoteKnowledge` to move `repository → global`.
     *
     * @param {string|number} id                   - Insight ID (URI-encoded automatically).
     * @param {string}        sourceScope           - Source scope (`'global'` or `'repository'`).
     * @param {string|null}   sourceRepositoryName  - Source repository name; null/undefined values are omitted.
     * @param {string}        targetRepositoryName  - Destination repository name (always required).
     * @returns {Promise<object>} The newly created insight in the target repository (with a new
     *   ID assigned by the target store — different from the original insight ID).
     */
    moveKnowledge: function (id, sourceScope, sourceRepositoryName, targetRepositoryName) {
      return request('POST', '/knowledge/' + encodeURIComponent(id) + '/move', {
        source_scope: sourceScope,
        source_repository_name: sourceRepositoryName != null ? sourceRepositoryName : undefined,
        target_repository_name: targetRepositoryName,
      });
    },
  };
})();

```
###  Path: `/mcp-server/gui/public/app.js`

```js
/* ============================================================
   app.js — Bootstrap
   Section 5 of the MCP Server Dashboard SPA
   ============================================================ */
Theme.init();
Router.init();
StaleCheck.init();


```
###  Path: `/mcp-server/gui/public/js/orchestrator-widgets.js`

```js
/* ============================================================
   js/orchestrator-widgets.js — Shared Orchestrator Widget Library
   MCP Server Dashboard SPA

   Provides reusable UI components for the orchestrator views.
   Exposes a global OrchestratorWidgets namespace object.

   Depends on: API (api-client.js), escapeHtml (utils.js)
   ============================================================ */

var OrchestratorWidgets = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Formats an elapsed time in milliseconds as a short human-readable string.
   * @param {number} ms - Elapsed milliseconds.
   * @returns {string} Formatted string (e.g. "42s", "3m", "2h").
   */
  function formatElapsed(ms) {
    var secs = Math.round(ms / 1000);
    if (secs < 60) return secs + 's';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h';
  }

  /**
   * Returns CSS class suffix + display label for an effectiveStatus value.
   * @param {string} status
   * @returns {{ cls: string, label: string }}
   */
  function statusMeta(status) {
    if (status === 'started') return { cls: 'started', label: 'Started'  };
    if (status === 'dead')    return { cls: 'dead',    label: 'Dead'     };
    return                           { cls: 'pending', label: 'Pending'  };
  }

  // ------------------------------------------------------------------
  // renderStatusCard(entry) → string (HTML)
  // ------------------------------------------------------------------

  /**
   * Renders a status card HTML string for a single queue entry.
   *
   * @param {object} entry - An enriched QueueEntry from the backend.
   * @param {string} entry.effectiveStatus - 'pending' | 'started' | 'dead'
   * @param {number} entry.pid             - OS process ID.
   * @param {string} entry.startedAt       - ISO 8601 start timestamp.
   * @param {string|null} entry.progress   - Latest JSONL progress summary.
   * @returns {string} HTML string.
   */
  function renderStatusCard(entry) {
    var meta     = statusMeta(entry.effectiveStatus || 'pending');
    var pid      = entry.pid != null ? String(entry.pid) : '—';
    var progress = entry.progress || null;

    var elapsed = '';
    if (entry.startedAt) {
      try {
        var diff = Date.now() - new Date(entry.startedAt).getTime();
        if (!isNaN(diff) && diff >= 0) elapsed = formatElapsed(diff);
      } catch (_) {}
    }

    var html = '<div class="orchestrator-status-card">';

    // Header: status badge + elapsed time
    html += '<div class="orchestrator-status-header">';
    html += '<span class="badge badge-' + escapeHtml(meta.cls) + '">' +
      escapeHtml(meta.label) + '</span>';
    if (elapsed) {
      html += ' <span class="text-muted orchestrator-elapsed">Running ' +
        escapeHtml(elapsed) + '</span>';
    }
    html += '</div>';

    // Body: PID + progress summary
    html += '<div class="orchestrator-status-body">';
    html += '<span class="text-muted orchestrator-pid">PID: ' +
      escapeHtml(pid) + '</span>';
    if (progress) {
      html += '<div class="orchestrator-progress-summary">' +
        escapeHtml(progress) + '</div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ------------------------------------------------------------------
  // renderKillButton(entryId, onDone) → HTMLButtonElement
  // ------------------------------------------------------------------

  /**
   * Creates a "Kill" button that, on click, asks for confirmation then
   * calls API.orchestratorKill(entryId).  Invokes onDone() on success.
   *
   * @param {string}   entryId - Queue entry UUID.
   * @param {Function} onDone  - Callback invoked after a successful kill.
   * @returns {HTMLButtonElement}
   */
  function renderKillButton(entryId, onDone) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-danger btn-sm orchestrator-kill-btn';
    btn.textContent = 'Kill';

    btn.addEventListener('click', function () {
      if (!window.confirm(
        'Kill this orchestrator run? The process will receive SIGTERM.'
      )) {
        return;
      }
      API.orchestratorKill(entryId).then(function () {
        if (typeof onDone === 'function') onDone();
      }).catch(function (err) {
        window.alert(
          'Failed to kill run: ' +
          ((err && err.message) || String(err))
        );
      });
    });

    return btn;
  }

  // ------------------------------------------------------------------
  // renderDismissButton(entryId, onDone) → HTMLButtonElement
  // ------------------------------------------------------------------

  /**
   * Creates a "Dismiss" button that calls API.orchestratorDismiss(entryId).
   * Invokes onDone() on success.  Intended for 'dead' queue entries.
   *
   * @param {string}   entryId - Queue entry UUID.
   * @param {Function} onDone  - Callback invoked after a successful dismiss.
   * @returns {HTMLButtonElement}
   */
  function renderDismissButton(entryId, onDone) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm orch-queue-action-btn orchestrator-dismiss-btn';
    btn.textContent = 'Dismiss';

    btn.addEventListener('click', function () {
      API.orchestratorDismiss(entryId).then(function () {
        if (typeof onDone === 'function') onDone();
      }).catch(function (err) {
        window.alert(
          'Failed to dismiss entry: ' +
          ((err && err.message) || String(err))
        );
      });
    });

    return btn;
  }

  // ------------------------------------------------------------------
  // formatLogAction(entry) → string
  // ------------------------------------------------------------------

  /**
   * Maps a raw JSONL log entry object to a human-friendly display string
   * for use in the log preview widget.
   *
   * The mapping is:
   *   run_start        → "Starting the run"
   *   stage_start      → "Starting stage: {stage}"
   *   stage_complete   → "Stage complete: {stage}"
   *   progress_snapshot→ "Progress snapshot"
   *   tool_call        → "Tool call: {tool_name}"  (or "Tool call" if no tool_name)
   *   wp_complete      → "Work package complete: {wp_id}"
   *   wp_status_change → "WP status → {new_status}"
   *   run_end          → "Run ended"
   *   run_error        → "Run error"
   *   signal_shutdown  → "Interrupted by signal"
   *   heartbeat        → "Heartbeat"
   *   mcp_error        → "MCP error"
   *   route            → "Routing decision"
   *   <unknown>        → title-cased version of the raw action, or JSON fallback
   *
   * NOTE: This function is intentionally scoped to the log preview only.
   * It does NOT affect renderProgressBadge, which continues to use the
   * raw action string.
   *
   * @param {object|null|undefined} entry - A JSONL log entry object. Null and
   *   undefined are safely handled: a falsy entry (or an entry without an
   *   `action` field) falls through to `JSON.stringify(entry)` as the
   *   last-resort fallback.
   * @returns {string} Human-friendly display label.
   */
  function formatLogAction(entry) {
    var action = (entry && entry.action) ? String(entry.action) : '';

    switch (action) {
      case 'run_start':
        return 'Starting the run';

      case 'stage_start':
        return 'Starting stage: ' + (entry.stage || '');

      case 'stage_complete':
        return 'Stage complete: ' + (entry.stage || '');

      case 'progress_snapshot':
        return 'Progress snapshot';

      case 'tool_call':
        return entry.tool_name
          ? 'Tool call: ' + String(entry.tool_name)
          : 'Tool call';

      case 'wp_complete':
        return 'Work package complete: ' + (entry.wp_id || '');

      case 'wp_status_change':
        return 'WP status \u2192 ' + (entry.new_status || '');

      case 'run_end':
        return 'Run ended';

      case 'run_error':
        return 'Run error';

      case 'signal_shutdown':
        return 'Interrupted by signal';

      case 'heartbeat':
        return 'Heartbeat';

      case 'mcp_error':
        return 'MCP error';

      case 'route':
        return 'Routing decision';

      default:
        if (action) {
          // Title-case the raw action string (replace underscores with spaces).
          return action
            .replace(/_/g, ' ')
            .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
        }
        return JSON.stringify(entry);
    }
  }

  // ------------------------------------------------------------------
  // renderLogPreview(container, repo, slug, filename) → cleanup()
  // ------------------------------------------------------------------

  /**
   * Starts auto-polling the run log for a queue entry and prepends new
   * JSONL events to `container` as they arrive, keeping the most-recent
   * entry at the top (most-recent-first ordering).
   *
   * Polling begins immediately (one fetch on call), then repeats every
   * 3 seconds.  Only events after the last seen line are prepended.
   *
   * @param {HTMLElement} container - The element to prepend log entries into.
   * @param {string}      repo      - Repository name that owns the project (URI-encoded by API client).
   * @param {string}      slug      - Project slug used for the API call (URI-encoded by API client).
   * @param {string}      filename  - JSONL log filename.
   * @returns {Function} cleanup — call to stop polling and clear the interval.
   */
  function renderLogPreview(container, repo, slug, filename) {
    var afterLine  = 0;
    var stopped    = false;
    var intervalId = null;

    function fetchEntries() {
      if (stopped) return;
      API.getRunLogEntries(repo, slug, filename, afterLine).then(function (data) {
        if (stopped) return;
        var entries    = (data && Array.isArray(data.entries)) ? data.entries : [];
        var totalLines = (data && typeof data.totalLines === 'number')
          ? data.totalLines
          : afterLine;

        // Iterate in reverse so that within a batch the earliest entry
        // ends up at the top after prepending (each insertBefore pushes
        // the previous div down, so the last-iterated entry — the oldest
        // in the batch — ends up topmost).  Overall result: newest events
        // are always visible at the top without scrolling.
        for (var i = entries.length - 1; i >= 0; i--) {
          var div = document.createElement('div');
          div.className = 'log-preview-entry';
          div.textContent = formatLogAction(entries[i]);
          container.insertBefore(div, container.firstChild);
        }

        afterLine = totalLines;
      }).catch(function () {
        // Polling is best-effort — swallow errors silently.
      });
    }

    fetchEntries();
    intervalId = setInterval(fetchEntries, 3000);

    return function cleanup() {
      stopped = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  }

  // ------------------------------------------------------------------
  // renderProgressBadge(lastAction) → string (HTML)
  // ------------------------------------------------------------------

  var PROGRESS_BADGE_MAP = {
    'run_start':         { icon: '▶', color: 'info'    },
    'stage_start':       { icon: '⟳', color: 'info'    },
    'stage_complete':    { icon: '✓', color: 'success' },
    'wp_complete':       { icon: '✓', color: 'success' },
    'progress_snapshot': { icon: '◎', color: 'info'    },
    'run_end':           { icon: '■', color: 'neutral'  },
    'run_error':         { icon: '✗', color: 'error'   },
    'signal_shutdown':   { icon: '⚡', color: 'warning' },
    'stage_error':       { icon: '✗', color: 'error'   },
    // NOTE: resolveProgress() never surfaces heartbeat as lastAction — kept for completeness.
    'heartbeat':         { icon: '♥', color: 'neutral'  },
  };

  /**
   * Renders a small badge HTML string for a JSONL action type.
   *
   * @param {string|null|undefined} lastAction - The last JSONL `action` field.
   * @returns {string} HTML badge string.
   */
  function renderProgressBadge(lastAction) {
    var mapping = (lastAction && PROGRESS_BADGE_MAP[lastAction])
      || { icon: '•', color: 'neutral' };
    var label = lastAction ? escapeHtml(String(lastAction)) : 'idle';
    return '<span class="badge badge-' + escapeHtml(mapping.color) + '">' +
      mapping.icon + ' ' + label + '</span>';
  }

  // ------------------------------------------------------------------
  // renderCliReference() → string (HTML)
  // ------------------------------------------------------------------

  /**
   * Returns a static HTML block with the most useful CLI commands for
   * managing orchestrator runs from the terminal.
   *
   * MAINTENANCE NOTE: The command text below mirrors the actual CLI surface.
   * Keep in sync with:
   *   - orchestrate binary: orchestrator/src/cli.py (CLI flags)
   *   - kill script:        scripts/kill-orchestrator.js
   *   - preflight script:   scripts/preflight-orchestrator.js (via scripts/cli.js)
   *
   * @returns {string} HTML string.
   */
  function renderCliReference() {
    return '<div class="orchestrator-cli-reference">' +
      '<h4>CLI Commands</h4>' +
      '<pre><code>' +
      '# Start a run\n' +
      'orchestrate &lt;plan-path&gt;\n\n' +
      '# Resume an interrupted run\n' +
      'orchestrate &lt;plan-path&gt; --resume &lt;thread-id&gt;\n\n' +
      '# Dry run (inspect routing without executing agents)\n' +
      'orchestrate &lt;plan-path&gt; --dry-run\n\n' +
      '# Kill stale orchestrator processes\n' +
      'node scripts/kill-orchestrator.js\n\n' +
      '# Pre-flight readiness check\n' +
      'node scripts/cli.js preflight --plan &lt;plan-path&gt;' +
      '</code></pre>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // Public namespace
  // ------------------------------------------------------------------

  return {
    formatLogAction:     formatLogAction,
    renderStatusCard:    renderStatusCard,
    renderKillButton:    renderKillButton,
    renderDismissButton: renderDismissButton,
    renderLogPreview:    renderLogPreview,
    renderProgressBadge: renderProgressBadge,
    renderCliReference:  renderCliReference,
  };
})();

```
###  Path: `/mcp-server/gui/public/libs/marked.min.js`

```js
/**
 * marked v15.0.12 - a markdown parser
 * Copyright (c) 2011-2025, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */
(function(g,f){if(typeof exports=="object"&&typeof module<"u"){module.exports=f()}else if("function"==typeof define && define.amd){define("marked",f)}else {g["marked"]=f()}}(typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : this,function(){var exports={};var __exports=exports;var module={exports};
"use strict";var H=Object.defineProperty;var be=Object.getOwnPropertyDescriptor;var Te=Object.getOwnPropertyNames;var we=Object.prototype.hasOwnProperty;var ye=(l,e)=>{for(var t in e)H(l,t,{get:e[t],enumerable:!0})},Re=(l,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of Te(e))!we.call(l,s)&&s!==t&&H(l,s,{get:()=>e[s],enumerable:!(n=be(e,s))||n.enumerable});return l};var Se=l=>Re(H({},"__esModule",{value:!0}),l);var kt={};ye(kt,{Hooks:()=>L,Lexer:()=>x,Marked:()=>E,Parser:()=>b,Renderer:()=>$,TextRenderer:()=>_,Tokenizer:()=>S,defaults:()=>w,getDefaults:()=>z,lexer:()=>ht,marked:()=>k,options:()=>it,parse:()=>pt,parseInline:()=>ct,parser:()=>ut,setOptions:()=>ot,use:()=>lt,walkTokens:()=>at});module.exports=Se(kt);function z(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var w=z();function N(l){w=l}var I={exec:()=>null};function h(l,e=""){let t=typeof l=="string"?l:l.source,n={replace:(s,i)=>{let r=typeof i=="string"?i:i.source;return r=r.replace(m.caret,"$1"),t=t.replace(s,r),n},getRegex:()=>new RegExp(t,e)};return n}var m={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:l=>new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}#`),htmlBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}<(?:[a-z].*>|!--)`,"i")},$e=/^(?:[ \t]*(?:\n|$))+/,_e=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,Le=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,O=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,ze=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,F=/(?:[*+-]|\d{1,9}[.)])/,ie=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,oe=h(ie).replace(/bull/g,F).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),Me=h(ie).replace(/bull/g,F).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Q=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,Pe=/^[^\n]+/,U=/(?!\s*\])(?:\\.|[^\[\]\\])+/,Ae=h(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",U).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),Ee=h(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,F).getRegex(),v="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",K=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Ce=h("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",K).replace("tag",v).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),le=h(Q).replace("hr",O).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),Ie=h(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",le).getRegex(),X={blockquote:Ie,code:_e,def:Ae,fences:Le,heading:ze,hr:O,html:Ce,lheading:oe,list:Ee,newline:$e,paragraph:le,table:I,text:Pe},re=h("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",O).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),Oe={...X,lheading:Me,table:re,paragraph:h(Q).replace("hr",O).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",re).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex()},Be={...X,html:h(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",K).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:I,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:h(Q).replace("hr",O).replace("heading",` *#{1,6} *[^
]`).replace("lheading",oe).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},qe=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,ve=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,ae=/^( {2,}|\\)\n(?!\s*$)/,De=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,D=/[\p{P}\p{S}]/u,W=/[\s\p{P}\p{S}]/u,ce=/[^\s\p{P}\p{S}]/u,Ze=h(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,W).getRegex(),pe=/(?!~)[\p{P}\p{S}]/u,Ge=/(?!~)[\s\p{P}\p{S}]/u,He=/(?:[^\s\p{P}\p{S}]|~)/u,Ne=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,ue=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,je=h(ue,"u").replace(/punct/g,D).getRegex(),Fe=h(ue,"u").replace(/punct/g,pe).getRegex(),he="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Qe=h(he,"gu").replace(/notPunctSpace/g,ce).replace(/punctSpace/g,W).replace(/punct/g,D).getRegex(),Ue=h(he,"gu").replace(/notPunctSpace/g,He).replace(/punctSpace/g,Ge).replace(/punct/g,pe).getRegex(),Ke=h("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,ce).replace(/punctSpace/g,W).replace(/punct/g,D).getRegex(),Xe=h(/\\(punct)/,"gu").replace(/punct/g,D).getRegex(),We=h(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Je=h(K).replace("(?:-->|$)","-->").getRegex(),Ve=h("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Je).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),q=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,Ye=h(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",q).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),ke=h(/^!?\[(label)\]\[(ref)\]/).replace("label",q).replace("ref",U).getRegex(),ge=h(/^!?\[(ref)\](?:\[\])?/).replace("ref",U).getRegex(),et=h("reflink|nolink(?!\\()","g").replace("reflink",ke).replace("nolink",ge).getRegex(),J={_backpedal:I,anyPunctuation:Xe,autolink:We,blockSkip:Ne,br:ae,code:ve,del:I,emStrongLDelim:je,emStrongRDelimAst:Qe,emStrongRDelimUnd:Ke,escape:qe,link:Ye,nolink:ge,punctuation:Ze,reflink:ke,reflinkSearch:et,tag:Ve,text:De,url:I},tt={...J,link:h(/^!?\[(label)\]\((.*?)\)/).replace("label",q).getRegex(),reflink:h(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",q).getRegex()},j={...J,emStrongRDelimAst:Ue,emStrongLDelim:Fe,url:h(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},nt={...j,br:h(ae).replace("{2,}","*").getRegex(),text:h(j.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},B={normal:X,gfm:Oe,pedantic:Be},P={normal:J,gfm:j,breaks:nt,pedantic:tt};var st={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},fe=l=>st[l];function R(l,e){if(e){if(m.escapeTest.test(l))return l.replace(m.escapeReplace,fe)}else if(m.escapeTestNoEncode.test(l))return l.replace(m.escapeReplaceNoEncode,fe);return l}function V(l){try{l=encodeURI(l).replace(m.percentDecode,"%")}catch{return null}return l}function Y(l,e){let t=l.replace(m.findPipe,(i,r,o)=>{let a=!1,c=r;for(;--c>=0&&o[c]==="\\";)a=!a;return a?"|":" |"}),n=t.split(m.splitPipe),s=0;if(n[0].trim()||n.shift(),n.length>0&&!n.at(-1)?.trim()&&n.pop(),e)if(n.length>e)n.splice(e);else for(;n.length<e;)n.push("");for(;s<n.length;s++)n[s]=n[s].trim().replace(m.slashPipe,"|");return n}function A(l,e,t){let n=l.length;if(n===0)return"";let s=0;for(;s<n;){let i=l.charAt(n-s-1);if(i===e&&!t)s++;else if(i!==e&&t)s++;else break}return l.slice(0,n-s)}function de(l,e){if(l.indexOf(e[1])===-1)return-1;let t=0;for(let n=0;n<l.length;n++)if(l[n]==="\\")n++;else if(l[n]===e[0])t++;else if(l[n]===e[1]&&(t--,t<0))return n;return t>0?-2:-1}function me(l,e,t,n,s){let i=e.href,r=e.title||null,o=l[1].replace(s.other.outputLinkReplace,"$1");n.state.inLink=!0;let a={type:l[0].charAt(0)==="!"?"image":"link",raw:t,href:i,title:r,text:o,tokens:n.inlineTokens(o)};return n.state.inLink=!1,a}function rt(l,e,t){let n=l.match(t.other.indentCodeCompensation);if(n===null)return e;let s=n[1];return e.split(`
`).map(i=>{let r=i.match(t.other.beginningSpace);if(r===null)return i;let[o]=r;return o.length>=s.length?i.slice(s.length):i}).join(`
`)}var S=class{options;rules;lexer;constructor(e){this.options=e||w}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:A(n,`
`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],s=rt(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:s}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let s=A(n,"#");(this.options.pedantic||!s||this.rules.other.endingSpaceChar.test(s))&&(n=s.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:A(t[0],`
`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=A(t[0],`
`).split(`
`),s="",i="",r=[];for(;n.length>0;){let o=!1,a=[],c;for(c=0;c<n.length;c++)if(this.rules.other.blockquoteStart.test(n[c]))a.push(n[c]),o=!0;else if(!o)a.push(n[c]);else break;n=n.slice(c);let p=a.join(`
`),u=p.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");s=s?`${s}
${p}`:p,i=i?`${i}
${u}`:u;let d=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(u,r,!0),this.lexer.state.top=d,n.length===0)break;let g=r.at(-1);if(g?.type==="code")break;if(g?.type==="blockquote"){let T=g,f=T.raw+`
`+n.join(`
`),y=this.blockquote(f);r[r.length-1]=y,s=s.substring(0,s.length-T.raw.length)+y.raw,i=i.substring(0,i.length-T.text.length)+y.text;break}else if(g?.type==="list"){let T=g,f=T.raw+`
`+n.join(`
`),y=this.list(f);r[r.length-1]=y,s=s.substring(0,s.length-g.raw.length)+y.raw,i=i.substring(0,i.length-T.raw.length)+y.raw,n=f.substring(r.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:s,tokens:r,text:i}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),s=n.length>1,i={type:"list",raw:"",ordered:s,start:s?+n.slice(0,-1):"",loose:!1,items:[]};n=s?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=s?n:"[*+-]");let r=this.rules.other.listItemRegex(n),o=!1;for(;e;){let c=!1,p="",u="";if(!(t=r.exec(e))||this.rules.block.hr.test(e))break;p=t[0],e=e.substring(p.length);let d=t[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,Z=>" ".repeat(3*Z.length)),g=e.split(`
`,1)[0],T=!d.trim(),f=0;if(this.options.pedantic?(f=2,u=d.trimStart()):T?f=t[1].length+1:(f=t[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,u=d.slice(f),f+=t[1].length),T&&this.rules.other.blankLine.test(g)&&(p+=g+`
`,e=e.substring(g.length+1),c=!0),!c){let Z=this.rules.other.nextBulletRegex(f),te=this.rules.other.hrRegex(f),ne=this.rules.other.fencesBeginRegex(f),se=this.rules.other.headingBeginRegex(f),xe=this.rules.other.htmlBeginRegex(f);for(;e;){let G=e.split(`
`,1)[0],C;if(g=G,this.options.pedantic?(g=g.replace(this.rules.other.listReplaceNesting,"  "),C=g):C=g.replace(this.rules.other.tabCharGlobal,"    "),ne.test(g)||se.test(g)||xe.test(g)||Z.test(g)||te.test(g))break;if(C.search(this.rules.other.nonSpaceChar)>=f||!g.trim())u+=`
`+C.slice(f);else{if(T||d.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||ne.test(d)||se.test(d)||te.test(d))break;u+=`
`+g}!T&&!g.trim()&&(T=!0),p+=G+`
`,e=e.substring(G.length+1),d=C.slice(f)}}i.loose||(o?i.loose=!0:this.rules.other.doubleBlankLine.test(p)&&(o=!0));let y=null,ee;this.options.gfm&&(y=this.rules.other.listIsTask.exec(u),y&&(ee=y[0]!=="[ ] ",u=u.replace(this.rules.other.listReplaceTask,""))),i.items.push({type:"list_item",raw:p,task:!!y,checked:ee,loose:!1,text:u,tokens:[]}),i.raw+=p}let a=i.items.at(-1);if(a)a.raw=a.raw.trimEnd(),a.text=a.text.trimEnd();else return;i.raw=i.raw.trimEnd();for(let c=0;c<i.items.length;c++)if(this.lexer.state.top=!1,i.items[c].tokens=this.lexer.blockTokens(i.items[c].text,[]),!i.loose){let p=i.items[c].tokens.filter(d=>d.type==="space"),u=p.length>0&&p.some(d=>this.rules.other.anyLine.test(d.raw));i.loose=u}if(i.loose)for(let c=0;c<i.items.length;c++)i.items[c].loose=!0;return i}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),s=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",i=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:s,title:i}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Y(t[1]),s=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),i=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],r={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===s.length){for(let o of s)this.rules.other.tableAlignRight.test(o)?r.align.push("right"):this.rules.other.tableAlignCenter.test(o)?r.align.push("center"):this.rules.other.tableAlignLeft.test(o)?r.align.push("left"):r.align.push(null);for(let o=0;o<n.length;o++)r.header.push({text:n[o],tokens:this.lexer.inline(n[o]),header:!0,align:r.align[o]});for(let o of i)r.rows.push(Y(o,r.header.length).map((a,c)=>({text:a,tokens:this.lexer.inline(a),header:!1,align:r.align[c]})));return r}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t)return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:t[1],tokens:this.lexer.inline(t[1])}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let r=A(n.slice(0,-1),"\\");if((n.length-r.length)%2===0)return}else{let r=de(t[2],"()");if(r===-2)return;if(r>-1){let a=(t[0].indexOf("!")===0?5:4)+t[1].length+r;t[2]=t[2].substring(0,r),t[0]=t[0].substring(0,a).trim(),t[3]=""}}let s=t[2],i="";if(this.options.pedantic){let r=this.rules.other.pedanticHrefTitle.exec(s);r&&(s=r[1],i=r[3])}else i=t[3]?t[3].slice(1,-1):"";return s=s.trim(),this.rules.other.startAngleBracket.test(s)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?s=s.slice(1):s=s.slice(1,-1)),me(t,{href:s&&s.replace(this.rules.inline.anyPunctuation,"$1"),title:i&&i.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let s=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),i=t[s.toLowerCase()];if(!i){let r=n[0].charAt(0);return{type:"text",raw:r,text:r}}return me(n,i,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let s=this.rules.inline.emStrongLDelim.exec(e);if(!s||s[3]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(s[1]||s[2]||"")||!n||this.rules.inline.punctuation.exec(n)){let r=[...s[0]].length-1,o,a,c=r,p=0,u=s[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,t=t.slice(-1*e.length+r);(s=u.exec(t))!=null;){if(o=s[1]||s[2]||s[3]||s[4]||s[5]||s[6],!o)continue;if(a=[...o].length,s[3]||s[4]){c+=a;continue}else if((s[5]||s[6])&&r%3&&!((r+a)%3)){p+=a;continue}if(c-=a,c>0)continue;a=Math.min(a,a+c+p);let d=[...s[0]][0].length,g=e.slice(0,r+s.index+d+a);if(Math.min(r,a)%2){let f=g.slice(1,-1);return{type:"em",raw:g,text:f,tokens:this.lexer.inlineTokens(f)}}let T=g.slice(2,-2);return{type:"strong",raw:g,text:T,tokens:this.lexer.inlineTokens(T)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),s=this.rules.other.nonSpaceChar.test(n),i=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return s&&i&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e){let t=this.rules.inline.del.exec(e);if(t)return{type:"del",raw:t[0],text:t[2],tokens:this.lexer.inlineTokens(t[2])}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,s;return t[2]==="@"?(n=t[1],s="mailto:"+n):(n=t[1],s=n),{type:"link",raw:t[0],text:n,href:s,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,s;if(t[2]==="@")n=t[0],s="mailto:"+n;else{let i;do i=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(i!==t[0]);n=t[0],t[1]==="www."?s="http://"+t[0]:s=t[0]}return{type:"link",raw:t[0],text:n,href:s,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}};var x=class l{tokens;options;state;tokenizer;inlineQueue;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||w,this.options.tokenizer=this.options.tokenizer||new S,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let t={other:m,block:B.normal,inline:P.normal};this.options.pedantic?(t.block=B.pedantic,t.inline=P.pedantic):this.options.gfm&&(t.block=B.gfm,this.options.breaks?t.inline=P.breaks:t.inline=P.gfm),this.tokenizer.rules=t}static get rules(){return{block:B,inline:P}}static lex(e,t){return new l(t).lex(e)}static lexInline(e,t){return new l(t).inlineTokens(e)}lex(e){e=e.replace(m.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){let n=this.inlineQueue[t];this.inlineTokens(n.src,n.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],n=!1){for(this.options.pedantic&&(e=e.replace(m.tabCharGlobal,"    ").replace(m.spaceLine,""));e;){let s;if(this.options.extensions?.block?.some(r=>(s=r.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))continue;if(s=this.tokenizer.space(e)){e=e.substring(s.raw.length);let r=t.at(-1);s.raw.length===1&&r!==void 0?r.raw+=`
`:t.push(s);continue}if(s=this.tokenizer.code(e)){e=e.substring(s.raw.length);let r=t.at(-1);r?.type==="paragraph"||r?.type==="text"?(r.raw+=`
`+s.raw,r.text+=`
`+s.text,this.inlineQueue.at(-1).src=r.text):t.push(s);continue}if(s=this.tokenizer.fences(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.heading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.hr(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.blockquote(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.list(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.html(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.def(e)){e=e.substring(s.raw.length);let r=t.at(-1);r?.type==="paragraph"||r?.type==="text"?(r.raw+=`
`+s.raw,r.text+=`
`+s.raw,this.inlineQueue.at(-1).src=r.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title});continue}if(s=this.tokenizer.table(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.lheading(e)){e=e.substring(s.raw.length),t.push(s);continue}let i=e;if(this.options.extensions?.startBlock){let r=1/0,o=e.slice(1),a;this.options.extensions.startBlock.forEach(c=>{a=c.call({lexer:this},o),typeof a=="number"&&a>=0&&(r=Math.min(r,a))}),r<1/0&&r>=0&&(i=e.substring(0,r+1))}if(this.state.top&&(s=this.tokenizer.paragraph(i))){let r=t.at(-1);n&&r?.type==="paragraph"?(r.raw+=`
`+s.raw,r.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):t.push(s),n=i.length!==e.length,e=e.substring(s.raw.length);continue}if(s=this.tokenizer.text(e)){e=e.substring(s.raw.length);let r=t.at(-1);r?.type==="text"?(r.raw+=`
`+s.raw,r.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):t.push(s);continue}if(e){let r="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(r);break}else throw new Error(r)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let n=e,s=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(n))!=null;)o.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(n=n.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(n))!=null;)n=n.slice(0,s.index)+"++"+n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(s=this.tokenizer.rules.inline.blockSkip.exec(n))!=null;)n=n.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let i=!1,r="";for(;e;){i||(r=""),i=!1;let o;if(this.options.extensions?.inline?.some(c=>(o=c.call({lexer:this},e,t))?(e=e.substring(o.raw.length),t.push(o),!0):!1))continue;if(o=this.tokenizer.escape(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.tag(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.link(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(o.raw.length);let c=t.at(-1);o.type==="text"&&c?.type==="text"?(c.raw+=o.raw,c.text+=o.text):t.push(o);continue}if(o=this.tokenizer.emStrong(e,n,r)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.codespan(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.br(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.del(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.autolink(e)){e=e.substring(o.raw.length),t.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(e))){e=e.substring(o.raw.length),t.push(o);continue}let a=e;if(this.options.extensions?.startInline){let c=1/0,p=e.slice(1),u;this.options.extensions.startInline.forEach(d=>{u=d.call({lexer:this},p),typeof u=="number"&&u>=0&&(c=Math.min(c,u))}),c<1/0&&c>=0&&(a=e.substring(0,c+1))}if(o=this.tokenizer.inlineText(a)){e=e.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(r=o.raw.slice(-1)),i=!0;let c=t.at(-1);c?.type==="text"?(c.raw+=o.raw,c.text+=o.text):t.push(o);continue}if(e){let c="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return t}};var $=class{options;parser;constructor(e){this.options=e||w}space(e){return""}code({text:e,lang:t,escaped:n}){let s=(t||"").match(m.notSpaceStart)?.[0],i=e.replace(m.endingNewline,"")+`
`;return s?'<pre><code class="language-'+R(s)+'">'+(n?i:R(i,!0))+`</code></pre>
`:"<pre><code>"+(n?i:R(i,!0))+`</code></pre>
`}blockquote({tokens:e}){return`<blockquote>
${this.parser.parse(e)}</blockquote>
`}html({text:e}){return e}heading({tokens:e,depth:t}){return`<h${t}>${this.parser.parseInline(e)}</h${t}>
`}hr(e){return`<hr>
`}list(e){let t=e.ordered,n=e.start,s="";for(let o=0;o<e.items.length;o++){let a=e.items[o];s+=this.listitem(a)}let i=t?"ol":"ul",r=t&&n!==1?' start="'+n+'"':"";return"<"+i+r+`>
`+s+"</"+i+`>
`}listitem(e){let t="";if(e.task){let n=this.checkbox({checked:!!e.checked});e.loose?e.tokens[0]?.type==="paragraph"?(e.tokens[0].text=n+" "+e.tokens[0].text,e.tokens[0].tokens&&e.tokens[0].tokens.length>0&&e.tokens[0].tokens[0].type==="text"&&(e.tokens[0].tokens[0].text=n+" "+R(e.tokens[0].tokens[0].text),e.tokens[0].tokens[0].escaped=!0)):e.tokens.unshift({type:"text",raw:n+" ",text:n+" ",escaped:!0}):t+=n+" "}return t+=this.parser.parse(e.tokens,!!e.loose),`<li>${t}</li>
`}checkbox({checked:e}){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:e}){return`<p>${this.parser.parseInline(e)}</p>
`}table(e){let t="",n="";for(let i=0;i<e.header.length;i++)n+=this.tablecell(e.header[i]);t+=this.tablerow({text:n});let s="";for(let i=0;i<e.rows.length;i++){let r=e.rows[i];n="";for(let o=0;o<r.length;o++)n+=this.tablecell(r[o]);s+=this.tablerow({text:n})}return s&&(s=`<tbody>${s}</tbody>`),`<table>
<thead>
`+t+`</thead>
`+s+`</table>
`}tablerow({text:e}){return`<tr>
${e}</tr>
`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return(e.align?`<${n} align="${e.align}">`:`<${n}>`)+t+`</${n}>
`}strong({tokens:e}){return`<strong>${this.parser.parseInline(e)}</strong>`}em({tokens:e}){return`<em>${this.parser.parseInline(e)}</em>`}codespan({text:e}){return`<code>${R(e,!0)}</code>`}br(e){return"<br>"}del({tokens:e}){return`<del>${this.parser.parseInline(e)}</del>`}link({href:e,title:t,tokens:n}){let s=this.parser.parseInline(n),i=V(e);if(i===null)return s;e=i;let r='<a href="'+e+'"';return t&&(r+=' title="'+R(t)+'"'),r+=">"+s+"</a>",r}image({href:e,title:t,text:n,tokens:s}){s&&(n=this.parser.parseInline(s,this.parser.textRenderer));let i=V(e);if(i===null)return R(n);e=i;let r=`<img src="${e}" alt="${n}"`;return t&&(r+=` title="${R(t)}"`),r+=">",r}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:R(e.text)}};var _=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}};var b=class l{options;renderer;textRenderer;constructor(e){this.options=e||w,this.options.renderer=this.options.renderer||new $,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new _}static parse(e,t){return new l(t).parse(e)}static parseInline(e,t){return new l(t).parseInline(e)}parse(e,t=!0){let n="";for(let s=0;s<e.length;s++){let i=e[s];if(this.options.extensions?.renderers?.[i.type]){let o=i,a=this.options.extensions.renderers[o.type].call({parser:this},o);if(a!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(o.type)){n+=a||"";continue}}let r=i;switch(r.type){case"space":{n+=this.renderer.space(r);continue}case"hr":{n+=this.renderer.hr(r);continue}case"heading":{n+=this.renderer.heading(r);continue}case"code":{n+=this.renderer.code(r);continue}case"table":{n+=this.renderer.table(r);continue}case"blockquote":{n+=this.renderer.blockquote(r);continue}case"list":{n+=this.renderer.list(r);continue}case"html":{n+=this.renderer.html(r);continue}case"paragraph":{n+=this.renderer.paragraph(r);continue}case"text":{let o=r,a=this.renderer.text(o);for(;s+1<e.length&&e[s+1].type==="text";)o=e[++s],a+=`
`+this.renderer.text(o);t?n+=this.renderer.paragraph({type:"paragraph",raw:a,text:a,tokens:[{type:"text",raw:a,text:a,escaped:!0}]}):n+=a;continue}default:{let o='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return n}parseInline(e,t=this.renderer){let n="";for(let s=0;s<e.length;s++){let i=e[s];if(this.options.extensions?.renderers?.[i.type]){let o=this.options.extensions.renderers[i.type].call({parser:this},i);if(o!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(i.type)){n+=o||"";continue}}let r=i;switch(r.type){case"escape":{n+=t.text(r);break}case"html":{n+=t.html(r);break}case"link":{n+=t.link(r);break}case"image":{n+=t.image(r);break}case"strong":{n+=t.strong(r);break}case"em":{n+=t.em(r);break}case"codespan":{n+=t.codespan(r);break}case"br":{n+=t.br(r);break}case"del":{n+=t.del(r);break}case"text":{n+=t.text(r);break}default:{let o='Token with "'+r.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return n}};var L=class{options;block;constructor(e){this.options=e||w}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}provideLexer(){return this.block?x.lex:x.lexInline}provideParser(){return this.block?b.parse:b.parseInline}};var E=class{defaults=z();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=b;Renderer=$;TextRenderer=_;Lexer=x;Tokenizer=S;Hooks=L;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let s of e)switch(n=n.concat(t.call(this,s)),s.type){case"table":{let i=s;for(let r of i.header)n=n.concat(this.walkTokens(r.tokens,t));for(let r of i.rows)for(let o of r)n=n.concat(this.walkTokens(o.tokens,t));break}case"list":{let i=s;n=n.concat(this.walkTokens(i.items,t));break}default:{let i=s;this.defaults.extensions?.childTokens?.[i.type]?this.defaults.extensions.childTokens[i.type].forEach(r=>{let o=i[r].flat(1/0);n=n.concat(this.walkTokens(o,t))}):i.tokens&&(n=n.concat(this.walkTokens(i.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let s={...n};if(s.async=this.defaults.async||s.async||!1,n.extensions&&(n.extensions.forEach(i=>{if(!i.name)throw new Error("extension name required");if("renderer"in i){let r=t.renderers[i.name];r?t.renderers[i.name]=function(...o){let a=i.renderer.apply(this,o);return a===!1&&(a=r.apply(this,o)),a}:t.renderers[i.name]=i.renderer}if("tokenizer"in i){if(!i.level||i.level!=="block"&&i.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let r=t[i.level];r?r.unshift(i.tokenizer):t[i.level]=[i.tokenizer],i.start&&(i.level==="block"?t.startBlock?t.startBlock.push(i.start):t.startBlock=[i.start]:i.level==="inline"&&(t.startInline?t.startInline.push(i.start):t.startInline=[i.start]))}"childTokens"in i&&i.childTokens&&(t.childTokens[i.name]=i.childTokens)}),s.extensions=t),n.renderer){let i=this.defaults.renderer||new $(this.defaults);for(let r in n.renderer){if(!(r in i))throw new Error(`renderer '${r}' does not exist`);if(["options","parser"].includes(r))continue;let o=r,a=n.renderer[o],c=i[o];i[o]=(...p)=>{let u=a.apply(i,p);return u===!1&&(u=c.apply(i,p)),u||""}}s.renderer=i}if(n.tokenizer){let i=this.defaults.tokenizer||new S(this.defaults);for(let r in n.tokenizer){if(!(r in i))throw new Error(`tokenizer '${r}' does not exist`);if(["options","rules","lexer"].includes(r))continue;let o=r,a=n.tokenizer[o],c=i[o];i[o]=(...p)=>{let u=a.apply(i,p);return u===!1&&(u=c.apply(i,p)),u}}s.tokenizer=i}if(n.hooks){let i=this.defaults.hooks||new L;for(let r in n.hooks){if(!(r in i))throw new Error(`hook '${r}' does not exist`);if(["options","block"].includes(r))continue;let o=r,a=n.hooks[o],c=i[o];L.passThroughHooks.has(r)?i[o]=p=>{if(this.defaults.async)return Promise.resolve(a.call(i,p)).then(d=>c.call(i,d));let u=a.call(i,p);return c.call(i,u)}:i[o]=(...p)=>{let u=a.apply(i,p);return u===!1&&(u=c.apply(i,p)),u}}s.hooks=i}if(n.walkTokens){let i=this.defaults.walkTokens,r=n.walkTokens;s.walkTokens=function(o){let a=[];return a.push(r.call(this,o)),i&&(a=a.concat(i.call(this,o))),a}}this.defaults={...this.defaults,...s}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return x.lex(e,t??this.defaults)}parser(e,t){return b.parse(e,t??this.defaults)}parseMarkdown(e){return(n,s)=>{let i={...s},r={...this.defaults,...i},o=this.onError(!!r.silent,!!r.async);if(this.defaults.async===!0&&i.async===!1)return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return o(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return o(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));r.hooks&&(r.hooks.options=r,r.hooks.block=e);let a=r.hooks?r.hooks.provideLexer():e?x.lex:x.lexInline,c=r.hooks?r.hooks.provideParser():e?b.parse:b.parseInline;if(r.async)return Promise.resolve(r.hooks?r.hooks.preprocess(n):n).then(p=>a(p,r)).then(p=>r.hooks?r.hooks.processAllTokens(p):p).then(p=>r.walkTokens?Promise.all(this.walkTokens(p,r.walkTokens)).then(()=>p):p).then(p=>c(p,r)).then(p=>r.hooks?r.hooks.postprocess(p):p).catch(o);try{r.hooks&&(n=r.hooks.preprocess(n));let p=a(n,r);r.hooks&&(p=r.hooks.processAllTokens(p)),r.walkTokens&&this.walkTokens(p,r.walkTokens);let u=c(p,r);return r.hooks&&(u=r.hooks.postprocess(u)),u}catch(p){return o(p)}}}onError(e,t){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,e){let s="<p>An error occurred:</p><pre>"+R(n.message+"",!0)+"</pre>";return t?Promise.resolve(s):s}if(t)return Promise.reject(n);throw n}}};var M=new E;function k(l,e){return M.parse(l,e)}k.options=k.setOptions=function(l){return M.setOptions(l),k.defaults=M.defaults,N(k.defaults),k};k.getDefaults=z;k.defaults=w;k.use=function(...l){return M.use(...l),k.defaults=M.defaults,N(k.defaults),k};k.walkTokens=function(l,e){return M.walkTokens(l,e)};k.parseInline=M.parseInline;k.Parser=b;k.parser=b.parse;k.Renderer=$;k.TextRenderer=_;k.Lexer=x;k.lexer=x.lex;k.Tokenizer=S;k.Hooks=L;k.parse=k;var it=k.options,ot=k.setOptions,lt=k.use,at=k.walkTokens,ct=k.parseInline,pt=k,ut=b.parse,ht=x.lex;

if(__exports != exports)module.exports = exports;return module.exports}));

```
###  Path: `/mcp-server/gui/public/router.js`

```js
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

    var planMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)\/plan$/);
    if (planMatch) {
      renderPlan(app, decodeURIComponent(planMatch[1]), decodeURIComponent(planMatch[2]));
      return;
    }

    var synthesisMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)\/synthesis$/);
    if (synthesisMatch) {
      renderSynthesis(app, decodeURIComponent(synthesisMatch[1]), decodeURIComponent(synthesisMatch[2]));
      return;
    }

    var projectMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)$/);
    if (projectMatch) {
      renderProjectDetail(app, decodeURIComponent(projectMatch[1]), decodeURIComponent(projectMatch[2]));
      return;
    }

    var wpMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)\/wp\/([^/]+)$/);
    if (wpMatch) {
      renderWorkPackageDetail(app, decodeURIComponent(wpMatch[1]), decodeURIComponent(wpMatch[2]), decodeURIComponent(wpMatch[3]));
      return;
    }

    var runLogMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)\/runs\/([^/]+)$/);
    if (runLogMatch) {
      renderRunLog(app, decodeURIComponent(runLogMatch[1]), decodeURIComponent(runLogMatch[2]), decodeURIComponent(runLogMatch[3]));
      return;
    }

    /* ── Named singleton routes ──────────────────────────────── */
    if (path === '/config') {
      renderConfig(app);
      return;
    }

    if (path === '/insights') {
      renderInsights(app);
      return;
    }

    if (path === '/knowledge') {
      renderKnowledge(app);
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

```
###  Path: `/mcp-server/gui/public/stale-check.js`

```js
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

```
###  Path: `/mcp-server/gui/public/theme-init.js`

```js
// Theme initialisation — intentionally written in ES5 (var, IIFE) so this file
// can be served as a plain static asset with no build step. Do not "upgrade"
// to let/const/arrow functions without adding a transpilation step.
(function () {
  var saved = localStorage.getItem('mcp-theme');
  if (saved !== 'light') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

```
###  Path: `/mcp-server/gui/public/theme.js`

```js
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

```
###  Path: `/mcp-server/gui/public/utils.js`

```js
/* ============================================================
   utils.js — Shared utility functions
   Section 4 of the MCP Server Dashboard SPA
   ============================================================ */

/**
 * Build the namespaced cache key used by ProjectNameCache.
 * @param {string} repo - Repository name (e.g. "ai-insights").
 * @param {string} slug - Project slug (e.g. "2026-05-31-my-plan").
 * @returns {string} Composite key in the form `repo/slug`.
 */
function makeProjectCacheKey(repo, slug) {
  return repo + '/' + slug;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return escapeHtml(isoString);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes());

    var now = new Date();
    // Strip times for day-boundary comparisons
    var today    = new Date(now.getFullYear(),    now.getMonth(),    now.getDate());
    var itemDay  = new Date(d.getFullYear(),      d.getMonth(),      d.getDate());
    var diffDays = Math.round((today - itemDay) / 86400000);

    if (diffDays === 0) return 'Today, ' + timeStr;
    if (diffDays === 1) return 'Yesterday, ' + timeStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (diffDays < 7)  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ', ' + timeStr;

    // Older: show short date like "12 Feb 2026, 16:41"
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + timeStr;
  } catch (_) {
    return escapeHtml(isoString);
  }
}

function statusBadge(status) {
  if (!status) return '';
  var cls = 'badge badge-' + status.toLowerCase().replace(/_/g, '-');
  return '<span class="' + cls + '">' + escapeHtml(status) + '</span>';
}

// Cache of namespaced key → display name, populated by views that fetch project data.
// breadcrumb().project() reads from here automatically.
// The cache key is the composite `repo + '/' + slug` to prevent collisions
// between same-slug projects in different repositories.
// Bounded to MAX_SIZE entries; oldest entries are evicted when the cap is exceeded.
var ProjectNameCache = (function () {
  var MAX_SIZE = 200;
  var _cache = {};
  var _keys = []; // insertion-order tracker for eviction (no duplicates)

  return {
    /**
     * Store a display name for a project.
     * @param {string} key  - Namespaced key in the form `repo/slug` (use makeProjectCacheKey()).
     * @param {string} name - Display name to cache.
     */
    set: function (key, name) {
      if (!key || !name || !name.trim()) return;
      var trimmed = name.trim();
      // Update the value; only add to order tracker if this is a new key.
      // NOTE: This is FIFO eviction, not LRU. Updating an existing key refreshes
      // its value but does NOT move it to the back of the eviction queue — the key
      // retains its original insertion position. For this cache (display names for
      // up to 200 projects, rarely refreshed), FIFO is correct and sufficient.
      if (!Object.prototype.hasOwnProperty.call(_cache, key)) {
        _keys.push(key);
        // Evict oldest entry if cap exceeded.
        if (_keys.length > MAX_SIZE) {
          var oldest = _keys.shift();
          delete _cache[oldest];
        }
      }
      _cache[key] = trimmed;
    },
    /**
     * Retrieve the display name for a project.
     * @param {string} key - Namespaced key in the form `repo/slug`.
     *   Falsy values (null, undefined, empty string) are handled gracefully: a null/undefined
     *   key returns null without throwing; an empty string key falls through to the slug
     *   extraction path and returns an empty string.
     * @returns {string|null} Cached display name, or the slug portion of the key (after the
     *   last '/') if not found — so breadcrumbs show a readable label before project data is
     *   fetched. Returns null for null/undefined input.
     */
    get: function (key) {
      if (_cache[key]) return _cache[key];
      // Fall back to the slug portion (after the last '/') so breadcrumbs show
      // a readable label even before the project data is fetched.
      var lastSlash = key ? key.lastIndexOf('/') : -1;
      return lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    },
    /**
     * Returns the current number of cached entries.
     * Intended for testing; not part of the public API.
     */
    _size: function () {
      return _keys.length;
    },
  };
}());

function breadcrumb() {
  var segments = [];
  var api = {
    projects: function () {
      segments.push({ label: 'Projects', href: '#/' });
      return api;
    },
    project: function (repo, slug) {
      segments.push({ label: ProjectNameCache.get(makeProjectCacheKey(repo, slug)), href: '#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) });
      return api;
    },
    leaf: function (label) {
      segments.push({ label: label });
      return api;
    },
    leafSpan: function (label, id) {
      segments.push({ label: label, id: id });
      return api;
    },
    html: function () {
      return '<p class="breadcrumb">' +
        segments.map(function (s) {
          if (s.href) return '<a href="' + s.href + '">' + escapeHtml(s.label) + '</a>';
          if (s.id)   return '<span id="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</span>';
          return escapeHtml(s.label);
        }).join(' / ') +
        '</p>';
    }
  };
  return api;
}

function showLoading(container) {
  container.innerHTML = '<div class="loading">Loading…</div>';
}

function showError(container, message) {
  container.innerHTML = '<div class="error-banner">' + escapeHtml(message) + '</div>';
}

function formatDuration(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '—';
  if (ms < 1000) return '< 1s';
  var totalSec = Math.floor(ms / 1000);
  var hours = Math.floor(totalSec / 3600);
  var minutes = Math.floor((totalSec % 3600) / 60);
  var seconds = totalSec % 60;
  var parts = [];
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');
  if (seconds > 0 && hours === 0) parts.push(seconds + 's');
  return parts.join(' ') || '< 1s';
}

```
###  Path: `/mcp-server/gui/public/views/config.js`

```js
/* ============================================================
   views/config.js — Configuration view
   Section 4d of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, showLoading, showError
   ============================================================ */

function renderConfig(app) {
  showLoading(app);

  API.getConfig().then(function (config) {
    app.innerHTML =
      '<div class="page-header"><h1>Configuration</h1></div>' +
      '<div class="card" style="max-width:560px">' +
        '<form id="config-form">' +
          '<div class="form-group">' +
            '<label class="form-label" for="auto-handoff">' +
              '<input type="checkbox" id="auto-handoff" class="form-check" ' + (config.auto_handoff_enabled ? 'checked' : '') + '>' +
              ' Auto-handoff enabled' +
            '</label>' +
            '<p class="form-note">When enabled, the MCP server automatically chains work to the next agent in the workflow.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="max-depth">Max handoff depth</label>' +
            '<input type="number" id="max-depth" class="form-control" min="1" value="' + escapeHtml(String(config.max_handoff_depth)) + '">' +
            '<p class="form-note">Maximum number of automatic agent handoffs before stopping.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="capture-dialogues">' +
              '<input type="checkbox" id="capture-dialogues" class="form-check" ' + (config.capture_dialogues ? 'checked' : '') + '>' +
              ' Capture agent dialogues' +
            '</label>' +
            '<p class="form-note">When enabled, the orchestrator saves the full LLM conversation for each pipeline stage to the project\'s ledger as Markdown files. Changes take effect on the next orchestrator run.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="auto-archive-days">Auto-archive after (days)</label>' +
            '<input type="number" id="auto-archive-days" class="form-control" min="0" step="1" value="' + escapeHtml(String(config.auto_archive_days != null ? config.auto_archive_days : 6)) + '">' +
            '<p class="form-note">Number of days after last update before a COMPLETE project is automatically archived. Set to 0 to disable auto-archiving.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ledger-root">Ledger root path</label>' +
            '<input type="text" id="ledger-root" class="form-control" readonly value="' + escapeHtml(config.ledger_root || '') + '">' +
            '<p class="form-note">Read-only. Changing this requires restarting the server with <code>--ledger-dir</code>.</p>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary">Save</button>' +
          '<div id="config-msg"></div>' +
        '</form>' +
      '</div>';

    var form = document.getElementById('config-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var autoHandoff = document.getElementById('auto-handoff').checked;
        var maxDepth = parseInt(document.getElementById('max-depth').value, 10);
        if (isNaN(maxDepth) || maxDepth < 1) {
          document.getElementById('config-msg').innerHTML = '<p class="error-banner">Max handoff depth must be a positive integer.</p>';
          return;
        }
        var captureDialogues = document.getElementById('capture-dialogues').checked;
        var autoArchiveDays = parseInt(document.getElementById('auto-archive-days').value, 10);
        if (isNaN(autoArchiveDays) || autoArchiveDays < 0) {
          document.getElementById('config-msg').innerHTML = '<p class="error-banner">Auto-archive days must be a non-negative integer.</p>';
          return;
        }
        // ledger_root intentionally omitted (read-only)
        API.updateConfig({ auto_handoff_enabled: autoHandoff, max_handoff_depth: maxDepth, capture_dialogues: captureDialogues, auto_archive_days: autoArchiveDays })
          .then(function () {
            document.getElementById('config-msg').innerHTML = '<p class="success-banner">Configuration saved.</p>';
          })
          .catch(function (err) {
            document.getElementById('config-msg').innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
          });
      });
    }
  }).catch(function (err) {
    showError(app, 'Failed to load configuration: ' + (err.message || String(err)));
  });
}

```
###  Path: `/mcp-server/gui/public/views/insights.js`

```js
/* ============================================================
   views/insights.js — Insights view
   Section 4e of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, formatDate,
               showLoading, showError
   ============================================================ */

function renderInsights(app) {
  showLoading(app);

  var allEntries = [];
  var filterType = 'ALL';
  var filterPriority = 'ALL';
  var filterProject = 'ALL';

  function buildCards() {
    var filtered = allEntries.filter(function (e) {
      if (filterType !== 'ALL' && e.type !== filterType) return false;
      if (filterPriority !== 'ALL' && e.priority !== filterPriority) return false;
      if (filterProject !== 'ALL' && e.project_slug !== filterProject) return false;
      return true;
    });

    if (!filtered.length) {
      return '<p class="text-muted mt-16">No insights found.</p>';
    }

    return filtered.map(function (e) {
      var priorityClass = e.priority ? ' priority-' + e.priority : '';
      var contextHtml = '';
      if (e.context && typeof e.context === 'object') {
        var ctxItems = Object.entries(e.context).map(function (pair) {
          return '<span><strong>' + escapeHtml(pair[0]) + ':</strong> ' + escapeHtml(String(pair[1])) + '</span>';
        }).join('<br>');
        contextHtml =
          '<div class="comment-context">' +
            ctxItems +
          '</div>';
      }
      /* Namespaced link: #/projects/{repo}/{slug} — requires repository_name so
         the router can scope the project view to the correct repository. Entries
         where repository_name is null (e.g. from a shallow plan path) fall back
         to plain escaped text — no anchor, no broken link. */
      var projectLink = e.repository_name
        ? '<a href="#/projects/' + encodeURIComponent(e.repository_name) + '/' + encodeURIComponent(e.project_slug) + '">' + escapeHtml(e.project_slug) + '</a>'
        : escapeHtml(e.project_slug);
      return '<div class="comment-card' + priorityClass + '">' +
        '<div class="comment-meta">' +
          projectLink +
          ' &mdash; ' +
          escapeHtml(e.agent || '\u2014') +
          ' <span class="comment-type">' + escapeHtml(e.type || '') + '</span>' +
          ' <span>' + escapeHtml(formatDate(e.timestamp)) + '</span>' +
        '</div>' +
        '<div class="comment-body">' + escapeHtml(e.note || '') + '</div>' +
        contextHtml +
      '</div>';
    }).join('');
  }

  function renderCards() {
    var container = document.getElementById('insights-list');
    if (container) {
      container.innerHTML = buildCards();
    }
  }

  function render(entries) {
    allEntries = entries;

    // Collect distinct types and project slugs
    var types = [];
    var projects = [];
    entries.forEach(function (e) {
      if (e.type && types.indexOf(e.type) === -1) types.push(e.type);
      if (e.project_slug && projects.indexOf(e.project_slug) === -1) projects.push(e.project_slug);
    });
    types.sort();
    projects.sort();

    var typeOptions = types.map(function (t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
    }).join('');
    var projectOptions = projects.map(function (p) {
      return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
    }).join('');

    app.innerHTML =
      '<div class="page-header"><h1>Insights</h1></div>' +
      '<div class="insights-filters">' +
        '<label for="insights-type">Type:</label>' +
        '<select id="insights-type"><option value="ALL">All types</option>' + typeOptions + '</select>' +
        '<label for="insights-priority">Priority:</label>' +
        '<select id="insights-priority"><option value="ALL">All priorities</option>' +
          '<option value="high">high</option>' +
          '<option value="medium">medium</option>' +
          '<option value="low">low</option>' +
        '</select>' +
        '<label for="insights-project">Project:</label>' +
        '<select id="insights-project"><option value="ALL">All projects</option>' + projectOptions + '</select>' +
      '</div>' +
      '<div id="insights-list">' + buildCards() + '</div>';

    // Restore saved filter values and wire change listeners
    var typeEl = document.getElementById('insights-type');
    var priorEl = document.getElementById('insights-priority');
    var projEl = document.getElementById('insights-project');
    if (typeEl) {
      typeEl.value = filterType;
      typeEl.addEventListener('change', function () { filterType = this.value; renderCards(); });
    }
    if (priorEl) {
      priorEl.value = filterPriority;
      priorEl.addEventListener('change', function () { filterPriority = this.value; renderCards(); });
    }
    if (projEl) {
      projEl.value = filterProject;
      projEl.addEventListener('change', function () { filterProject = this.value; renderCards(); });
    }
  }

  function load() {
    API.getInsights().then(function (entries) {
      render(entries || []);
    }).catch(function (err) {
      showError(app, 'Failed to load insights: ' + (err.message || String(err)));
    });
  }

  load();
  Router._setPolling(load, 15000);
}

```
###  Path: `/mcp-server/gui/public/views/knowledge.js`

```js
/* ============================================================
   views/knowledge.js — Knowledge view
   Section 4f of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, formatDate, showLoading, showError
   ============================================================ */

function renderKnowledge(app) {
  showLoading(app);

  /* ── Confidence bucket thresholds ────────────────────────── */
  var CONFIDENCE_HIGH_MIN   = 68;   /* 68–100 → High  */
  var CONFIDENCE_MEDIUM_MIN = 34;   /* 34–67  → Medium */
  /* 0–33 → Low */

  /* ── View state ──────────────────────────────────────────── */
  var allInsights        = [];
  var activeTab          = 'global';   /* 'global' | 'repository' */
  var filterCategory     = '';
  var filterRepository   = '';
  var filterQuery        = '';
  var editingId       = null;       /* numeric id of card in edit mode */
  var confirmDeleteId = null;       /* numeric id of card in delete-confirm mode */
  var movingId        = null;       /* numeric id of card in move mode */

  /* ── formatConfidence ────────────────────────────────────── */
  function formatConfidence(value) {
    var pct = Math.round(value * 100);
    var label;
    if (pct >= CONFIDENCE_HIGH_MIN) {
      label = 'High';
    } else if (pct >= CONFIDENCE_MEDIUM_MIN) {
      label = 'Medium';
    } else {
      label = 'Low';
    }
    return pct + '% (' + label + ')';
  }

  /* ── applyFilters ────────────────────────────────────────── */
  function applyFilters() {
    var scopeValue = activeTab === 'global' ? 'global' : 'repository';
    return allInsights.filter(function (ins) {
      if (ins.scope !== scopeValue) return false;
      if (filterCategory && ins.category !== filterCategory) return false;
      if (activeTab === 'repository' && filterRepository && ins.repository_name !== filterRepository) return false;
      if (filterQuery) {
        var q = filterQuery.toLowerCase();
        var titleMatch    = ins.title   && ins.title.toLowerCase().indexOf(q) !== -1;
        var contentMatch  = ins.content && ins.content.toLowerCase().indexOf(q) !== -1;
        var tagsMatch     = ins.tags    && ins.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
        if (!titleMatch && !contentMatch && !tagsMatch) return false;
      }
      return true;
    });
  }

  /* ── getDistinctValues ───────────────────────────────────── */
  /* Returns { categories: string[], repositories: string[] } — both arrays are
     sorted alphabetically and contain only distinct non-empty values from
     the provided insights array. */
  function getDistinctValues(insights) {
    var categories   = [];
    var repositories = [];
    insights.forEach(function (ins) {
      if (ins.category        && categories.indexOf(ins.category)               === -1) categories.push(ins.category);
      if (ins.repository_name && repositories.indexOf(ins.repository_name)      === -1) repositories.push(ins.repository_name);
    });
    categories.sort();
    repositories.sort();
    return { categories: categories, repositories: repositories };
  }

  /* ── buildFilterBarHtml ──────────────────────────────────── */
  function buildFilterBarHtml(categories, repositories) {
    var catOptions = categories.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"' + (filterCategory === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
    }).join('');

    var baseBar =
      '<label for="kn-category">Category:</label>' +
      '<select id="kn-category" class="form-control form-control-sm">' +
        '<option value="">All categories</option>' + catOptions +
      '</select>' +
      '<label for="kn-query">Search:</label>' +
      '<input id="kn-query" type="text" class="form-control form-control-sm" placeholder="Title, content or tag…" value="' + escapeHtml(filterQuery) + '">';

    if (activeTab === 'repository') {
      var repoOptions = repositories.map(function (r) {
        return '<option value="' + escapeHtml(r) + '"' + (filterRepository === r ? ' selected' : '') + '>' + escapeHtml(r) + '</option>';
      }).join('');
      return (
        '<label for="kn-repository">Repository:</label>' +
        '<select id="kn-repository" class="form-control form-control-sm">' +
          '<option value="">All repositories</option>' + repoOptions +
        '</select>' +
        baseBar
      );
    }

    return baseBar;
  }

  /* ── buildKnowledgeHtml ──────────────────────────────────── */
  function buildKnowledgeHtml(insights) {
    if (!insights.length) {
      return '<p class="text-muted mt-16">No knowledge entries found.</p>';
    }

    return insights.map(function (ins) {
      var id          = ins.id;
      var isGlobal    = ins.scope === 'global';
      var isEditing   = editingId === id;
      var isConfirm   = confirmDeleteId === id;
      var isMoving    = movingId === id;

      /* ── Scope badge ── */
      var scopeBadgeClass = isGlobal ? 'badge badge-scope-global' : 'badge badge-scope-repository';
      var scopeLabel      = isGlobal ? 'Global' : 'Repository';

      /* ── Tags ── */
      var tagsHtml = '';
      if (ins.tags && ins.tags.length) {
        tagsHtml = ins.tags.map(function (t) {
          return '<span class="tag-chip">' + escapeHtml(t) + '</span>';
        }).join(' ');
      }

      /* ── Content preview ── */
      var preview = ins.content ? ins.content.slice(0, 200) + (ins.content.length > 200 ? '…' : '') : '';

      /* ── Superseded-by notice ── */
      var supersededHtml = ins.superseded_by != null
        ? '<p class="text-muted" style="font-size:12px">Superseded by KN-' + ins.superseded_by + '</p>'
        : '';

      /* ── Inline edit form ── */
      if (isEditing) {
        var tagsValue = ins.tags ? ins.tags.join(', ') : '';
        var confPct   = formatConfidence(ins.confidence != null ? ins.confidence : 0);
        return '<div class="card" data-id="' + id + '">' +
          '<form id="kn-edit-form-' + id + '">' +
            '<div class="form-group">' +
              '<label class="form-label">Title</label>' +
              '<input id="kn-edit-title-' + id + '" class="form-control" type="text" value="' + escapeHtml(ins.title || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Content</label>' +
              '<textarea id="kn-edit-content-' + id + '" class="form-control" rows="6">' + escapeHtml(ins.content || '') + '</textarea>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Category</label>' +
              '<input id="kn-edit-category-' + id + '" class="form-control" type="text" value="' + escapeHtml(ins.category || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Tags (comma-separated)</label>' +
              '<input id="kn-edit-tags-' + id + '" class="form-control" type="text" value="' + escapeHtml(tagsValue) + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Confidence: <span id="kn-conf-label-' + id + '">' + escapeHtml(confPct) + '</span></label>' +
              '<input id="kn-edit-conf-' + id + '" class="form-control" type="range" min="0" max="1" step="0.01" value="' + (ins.confidence != null ? ins.confidence : 0) + '">' +
            '</div>' +
            '<div class="knowledge-actions">' +
              '<button type="submit" class="btn btn-primary btn-sm">Save</button>' +
              '<button type="button" class="btn btn-sm" data-action="cancel-edit" data-id="' + id + '">Cancel</button>' +
            '</div>' +
            '<div id="kn-edit-msg-' + id + '"></div>' +
          '</form>' +
        '</div>';
      }

      /* ── Action buttons ── */
      var deleteHtml;
      if (isConfirm) {
        deleteHtml =
          '<span>Delete this entry?</span>' +
          '<button class="btn btn-danger btn-sm" data-action="confirm-delete" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Confirm</button>' +
          '<button class="btn btn-sm" data-action="cancel-delete" data-id="' + id + '">Cancel</button>';
      } else {
        deleteHtml = '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + id + '">Delete</button>';
      }

      var promoteHtml = !isGlobal
        ? '<button class="btn btn-sm" data-action="promote" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Promote to Global</button>'
        : '';

      var moveHtml;
      if (isMoving) {
        moveHtml =
          '<span class="knowledge-move-input">' +
            '<input id="kn-move-repo-' + id + '" class="form-control form-control-sm" type="text" placeholder="target-repository-name">' +
            '<button class="btn btn-primary btn-sm" data-action="confirm-move" data-id="' + id + '" data-scope="' + escapeHtml(ins.scope) + '" data-repository="' + escapeHtml(ins.repository_name || '') + '">Confirm</button>' +
            '<button class="btn btn-sm" data-action="cancel-move" data-id="' + id + '">Cancel</button>' +
          '</span>';
      } else {
        moveHtml = '<button class="btn btn-sm" data-action="move" data-id="' + id + '">Move to Repository</button>';
      }

      /* origin_plan link: three cases —
           1. No origin_plan → empty string (omit the element entirely).
           2. origin_plan present AND repository_name present → namespaced anchor
              (#/projects/{repo}/{slug}) so the router scopes the view correctly.
           3. origin_plan present but repository_name null (global insights or
              shallow storage path) → plain <span> fallback, no broken link. */
      var originPlanHtml = ins.origin_plan
        ? (ins.repository_name
            ? '<a href="#/projects/' + encodeURIComponent(ins.repository_name) + '/' + encodeURIComponent(ins.origin_plan) + '" style="font-size:12px">Origin: ' + escapeHtml(ins.origin_plan) + '</a>'
            : '<span style="font-size:12px">Origin: ' + escapeHtml(ins.origin_plan) + '</span>')
        : '';

      return '<div class="card" data-id="' + id + '">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
          '<span class="' + scopeBadgeClass + '">' + scopeLabel + '</span>' +
          (ins.category ? '<span class="category-pill">' + escapeHtml(ins.category) + '</span>' : '') +
          (ins.repository_name ? '<span class="text-muted" style="font-size:12px">' + escapeHtml(ins.repository_name) + '</span>' : '') +
          (originPlanHtml ? originPlanHtml : '') +
        '</div>' +
        '<h3 style="margin:0 0 6px 0;font-size:15px">' + escapeHtml(ins.title || '(no title)') + '</h3>' +
        (tagsHtml ? '<div style="margin-bottom:6px">' + tagsHtml + '</div>' : '') +
        (preview ? '<p style="margin:0 0 6px 0;color:var(--color-text-muted);font-size:13px">' + escapeHtml(preview) + '</p>' : '') +
        '<div style="display:flex;align-items:center;gap:16px;font-size:12px;color:var(--color-text-muted);margin-bottom:4px">' +
          '<span class="confidence-label">Confidence: ' + escapeHtml(ins.confidence != null ? formatConfidence(ins.confidence) : '—') + '</span>' +
          (ins.source ? '<span>Source: ' + escapeHtml(ins.source) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:8px">' +
          'Created: ' + escapeHtml(formatDate(ins.created_at)) +
          ' &nbsp;·&nbsp; Updated: ' + escapeHtml(formatDate(ins.updated_at)) +
        '</div>' +
        supersededHtml +
        '<div class="knowledge-actions">' +
          '<button class="btn btn-sm" data-action="edit" data-id="' + id + '">Edit</button>' +
          deleteHtml +
          promoteHtml +
          moveHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ── render ──────────────────────────────────────────────── */
  function render(insights) {
    allInsights = insights;

    var vals         = getDistinctValues(insights);
    var categories   = vals.categories;
    var repositories = vals.repositories;

    var filtered = applyFilters();

    app.innerHTML =
      '<div class="page-header"><h1>Knowledge</h1></div>' +
      '<div class="knowledge-tabs">' +
        '<button class="knowledge-tab' + (activeTab === 'global' ? ' active' : '') + '" data-tab="global">Global</button>' +
        '<button class="knowledge-tab' + (activeTab === 'repository' ? ' active' : '') + '" data-tab="repository">Repository</button>' +
      '</div>' +
      '<div class="filter-bar" id="kn-filter-bar">' +
        buildFilterBarHtml(categories, repositories) +
      '</div>' +
      '<div id="knowledge-list">' + buildKnowledgeHtml(filtered) + '</div>';

    wireEvents();
    wireRangeSliders();
  }

  /* ── renderFilterBar ─── rebuild the filter bar only ─────────
   *
   * Rebuilds #kn-filter-bar and re-wires its event handlers.
   * Called when activeTab changes because only then does the bar layout
   * change (repository dropdown appears / disappears).
   * NOT called on every keystroke or card action — that was the root
   * cause of the focus-theft issue resolved here.
   */
  function renderFilterBar() {
    var vals = getDistinctValues(allInsights);
    var filterBarEl = document.getElementById('kn-filter-bar');
    if (filterBarEl) {
      filterBarEl.innerHTML = buildFilterBarHtml(vals.categories, vals.repositories);
      wireFilterBarEvents(filterBarEl);
    }
  }

  /* ── renderList ─── partial re-render of card list only ────────
   *
   * Rebuilds #knowledge-list with the current filtered card set.
   * Does NOT touch the filter bar. Call renderFilterBar() explicitly
   * when activeTab changes and the bar layout needs to change.
   */
  function renderList() {
    var filtered = applyFilters();
    var listEl = document.getElementById('knowledge-list');
    if (listEl) {
      listEl.innerHTML = buildKnowledgeHtml(filtered);
    }
    wireRangeSliders();
  }

  /* ── wireRangeSliders ─── live confidence label updates ─────── */
  function wireRangeSliders() {
    var inputs = document.querySelectorAll('input[type="range"][id^="kn-edit-conf-"]');
    inputs.forEach(function (input) {
      var idStr = input.id.replace('kn-edit-conf-', '');
      input.addEventListener('input', function () {
        var labelEl = document.getElementById('kn-conf-label-' + idStr);
        if (labelEl) labelEl.textContent = formatConfidence(parseFloat(this.value));
      });
    });
  }

  /* ── wireFilterBarEvents ─── attach change/input to filter controls ── */
  function wireFilterBarEvents(filterBarEl) {
    var catEl  = filterBarEl.querySelector('#kn-category');
    var repoEl = filterBarEl.querySelector('#kn-repository');
    var qEl    = filterBarEl.querySelector('#kn-query');

    if (catEl) {
      catEl.addEventListener('change', function () {
        filterCategory = this.value;
        renderList();
      });
    }
    if (repoEl) {
      repoEl.addEventListener('change', function () {
        filterRepository = this.value;
        renderList();
      });
    }
    if (qEl) {
      qEl.addEventListener('input', function () {
        filterQuery = this.value;
        renderList();
      });
    }
  }

  /* ── wireEvents ──────────────────────────────────────────── */
  function wireEvents() {
    /* Tab bar */
    var tabButtons = document.querySelectorAll('.knowledge-tab');
    tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newTab = this.getAttribute('data-tab');
        if (newTab === activeTab) return;
        activeTab          = newTab;
        filterCategory     = '';
        filterRepository   = '';
        filterQuery        = '';
        editingId       = null;
        confirmDeleteId = null;
        movingId        = null;

        /* Update active class */
        tabButtons.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-tab') === activeTab);
        });

        /* Tab change alters the filter bar layout (repository dropdown appears/
           disappears), so rebuild the bar first, then re-render the card list. */
        renderFilterBar();
        renderList();
      });
    });

    /* Wire filter bar */
    var filterBarEl = document.getElementById('kn-filter-bar');
    if (filterBarEl) wireFilterBarEvents(filterBarEl);

    /* Event delegation for card actions */
    var listEl = document.getElementById('knowledge-list');
    if (!listEl) return;

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.getAttribute('data-action');
      var rawId  = btn.getAttribute('data-id');
      var id     = parseInt(rawId, 10);

      if (action === 'edit') {
        editingId       = id;
        confirmDeleteId = null;
        movingId        = null;
        renderList();
        return;
      }

      if (action === 'cancel-edit') {
        editingId = null;
        renderList();
        return;
      }

      if (action === 'delete') {
        confirmDeleteId = id;
        editingId       = null;
        movingId        = null;
        renderList();
        return;
      }

      if (action === 'cancel-delete') {
        confirmDeleteId = null;
        renderList();
        return;
      }

      if (action === 'move') {
        movingId        = id;
        editingId       = null;
        confirmDeleteId = null;
        renderList();
        return;
      }

      if (action === 'cancel-move') {
        movingId = null;
        renderList();
        return;
      }

      /* ── Confirm delete ── */
      if (action === 'confirm-delete') {
        var delScope = btn.getAttribute('data-scope');
        var delRepo  = btn.getAttribute('data-repository') || null;
        API.deleteKnowledge(id, delScope, delRepo).then(function () {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          confirmDeleteId = null;
          renderList();
        }).catch(function (err) {
          showError(app, 'Delete failed: ' + (err.message || String(err)));
        });
        return;
      }

      /* ── Promote to Global ── */
      if (action === 'promote') {
        var promScope = btn.getAttribute('data-scope');
        var promRepo  = btn.getAttribute('data-repository') || null;
        API.promoteKnowledge(id, promScope, promRepo).then(function (newInsight) {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          allInsights.push(newInsight);
          renderList();
        }).catch(function (err) {
          showError(app, 'Promote failed: ' + (err.message || String(err)));
        });
        return;
      }

      /* ── Confirm move ── */
      if (action === 'confirm-move') {
        var moveScope      = btn.getAttribute('data-scope');
        var moveRepo       = btn.getAttribute('data-repository') || null;
        var targetInput    = document.getElementById('kn-move-repo-' + id);
        var targetRepoName = targetInput ? targetInput.value.trim() : '';
        if (!targetRepoName) return;
        API.moveKnowledge(id, moveScope, moveRepo, targetRepoName).then(function (newInsight) {
          allInsights = allInsights.filter(function (ins) { return ins.id !== id; });
          allInsights.push(newInsight);
          movingId = null;
          renderList();
        }).catch(function (err) {
          showError(app, 'Move failed: ' + (err.message || String(err)));
        });
        return;
      }
    });

    /* Edit form submit — uses event delegation on the list container */
    listEl.addEventListener('submit', function (e) {
      var form = e.target.closest('form[id^="kn-edit-form-"]');
      if (!form) return;
      e.preventDefault();

      var formId = form.id.replace('kn-edit-form-', '');
      var eid    = parseInt(formId, 10);

      /* Find insight to get scope/repository_name */
      var original = allInsights.find(function (ins) { return ins.id === eid; });
      if (!original) return;

      var titleEl    = document.getElementById('kn-edit-title-'   + eid);
      var contentEl  = document.getElementById('kn-edit-content-' + eid);
      var categoryEl = document.getElementById('kn-edit-category-'+ eid);
      var tagsEl     = document.getElementById('kn-edit-tags-'    + eid);
      var confEl     = document.getElementById('kn-edit-conf-'    + eid);
      var msgEl      = document.getElementById('kn-edit-msg-'     + eid);

      var rawTags = tagsEl ? tagsEl.value : '';
      var tags    = rawTags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);

      var updateData = {
        title:      titleEl    ? titleEl.value    : original.title,
        content:    contentEl  ? contentEl.value  : original.content,
        category:   categoryEl ? categoryEl.value : original.category,
        tags:       tags,
        confidence: confEl     ? parseFloat(confEl.value) : original.confidence,
      };

      API.updateKnowledge(eid, original.scope, original.repository_name || null, updateData)
        .then(function (updated) {
          allInsights = allInsights.map(function (ins) {
            return ins.id === eid ? updated : ins;
          });
          editingId = null;
          renderList();
        })
        .catch(function (err) {
          /* Intentional: inline error preserves form state so the user does not lose
             edits on a transient save failure. All destructive actions (delete/promote/move)
             use showError(app, ...) because they navigate away or remove the card. */
          if (msgEl) msgEl.innerHTML = '<p class="error-banner">Save failed: ' + escapeHtml(err.message || String(err)) + '</p>';
        });
    });
  }

  /* ── load ────────────────────────────────────────────────── */
  function load() {
    API.getKnowledge({}).then(function (data) {
      render(Array.isArray(data) ? data : (data && data.insights ? data.insights : []));
    }).catch(function (err) {
      showError(app, 'Failed to load knowledge: ' + (err.message || String(err)));
    });
  }

  load();
  /* No polling — knowledge is human-curated and changes rarely */
}

```
###  Path: `/mcp-server/gui/public/views/orchestrator.js`

```js
/* ============================================================
   views/orchestrator.js — Orchestrator View
   MCP Server Dashboard SPA — Phase 5 (WP-011)

   Renders the top-level orchestrator view:
     Section A: plan path input + preflight + start
     Section B: live run queue table with polling
     Footer: CLI reference card

   renderOrchestrator delegates the Start Run click to one helper
   and renderQueueTable delegates to four helpers, all closure-scoped
   inside renderOrchestrator():
     _handleStartRun()      — handles the Start Run button click:
                              validates state, calls the API, shows
                              a success banner, and starts a
                              status-poll timer.
     _clearSuccessBanner()  — removes the success banner from the
                              preflight results area when the queue
                              receives its first live entry; error
                              banners are intentionally left intact.
     _buildQueueHtml()      — builds the complete <table>…</table>
                              HTML string from the entries array.
     _bindQueueActions()    — injects Kill/Dismiss/View-Project
                              buttons and row-toggle listeners into
                              the already-rendered table DOM.
     _mountLogPreviews()    — starts live log-preview widgets for
                              all currently-expanded rows and
                              registers their cleanup callbacks.

   Module-scoped cleanup registries:
     _orchLogPreviewCleanups — log-preview widget teardowns; drained by
                               both renderOrchestrator() and refreshQueue().
     _orchStatusPollCleanups — status-poll timer teardowns; drained ONLY
                               by renderOrchestrator() so that in-flight
                               polls are not cancelled by queue refreshes.

   Depends on: API (api-client.js), Router (router.js),
               OrchestratorWidgets (js/orchestrator-widgets.js),
               escapeHtml (utils.js)
   ============================================================ */

// Module-scoped log-preview cleanup registry.
// Drained by both renderOrchestrator() (full re-render) and refreshQueue()
// (queue-only re-render).  Each widget registered here is tied to a specific
// expanded queue row and must be cancelled whenever the table is rebuilt.
var _orchLogPreviewCleanups = [];

// Module-scoped status-poll cleanup registry.
// Drained ONLY by renderOrchestrator() (full re-render).  Entries here are
// long-lived setInterval timers that must survive refreshQueue() calls so that
// an in-flight status poll is not cancelled prematurely by a queue refresh.
var _orchStatusPollCleanups = [];

/**
 * Top-level orchestrator view entry point.
 * Called by Router.dispatch() when the user navigates to #/orchestrator.
 *
 * @param {HTMLElement} app - The root #app container element.
 */
function renderOrchestrator(app) {
  // 1. Drain all cleanup callbacks from the previous render.
  _orchLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  _orchLogPreviewCleanups = [];
  _orchStatusPollCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  _orchStatusPollCleanups = [];

  // 2. Render the static skeleton.
  app.innerHTML =
    '<h1 class="section-title">Orchestrator</h1>' +

    '<section class="orch-section">' +
      '<h2 class="orch-section-title">Start New Run</h2>' +
      '<div class="orch-start-panel">' +
        '<div class="orch-plan-input-row">' +
          '<input type="text" id="orch-plan-path" class="orch-plan-input"' +
            ' placeholder="Absolute path to plan.md…" autocomplete="off">' +
          '<button type="button" id="orch-preflight-btn" class="btn btn-secondary">' +
            'Run Preflight' +
          '</button>' +
          '<button type="button" id="orch-start-btn" class="btn btn-primary" disabled>' +
            'Start Run' +
          '</button>' +
        '</div>' +
        '<div id="orch-preflight-results"></div>' +
      '</div>' +
    '</section>' +

    '<section class="orch-section">' +
      '<h2 class="orch-section-title">Run Queue</h2>' +
      '<div id="orch-queue-container"><p class="text-muted">Loading queue…</p></div>' +
    '</section>' +

    '<section class="orch-section orch-cli-section">' +
      OrchestratorWidgets.renderCliReference() +
    '</section>';

  // 3. Bind UI references.
  var preflightBtn = document.getElementById('orch-preflight-btn');
  var startBtn     = document.getElementById('orch-start-btn');
  var planInput    = document.getElementById('orch-plan-path');
  var resultsEl    = document.getElementById('orch-preflight-results');

  var allChecksPassed = false;

  // 4. Render preflight results checklist.
  function renderPreflightResults(checks) {
    if (!checks || !checks.length) {
      resultsEl.innerHTML = '';
      allChecksPassed = false;
      startBtn.disabled = true;
      return;
    }
    allChecksPassed = checks.every(function (c) { return c.pass; });
    startBtn.disabled = !allChecksPassed;
    if (!startBtn.disabled) startBtn.textContent = 'Start Run';

    var html = '<ul class="preflight-list">';
    checks.forEach(function (c) {
      var cls = c.pass ? 'preflight-pass' : 'preflight-fail';
      html += '<li class="preflight-check ' + cls + '">';
      html += '<span class="preflight-icon">' + (c.pass ? '✓' : '✗') + '</span>';
      html += ' <strong>' + escapeHtml(c.name) + '</strong>: ' + escapeHtml(c.detail);
      if (!c.pass && c.fix) {
        html += ' <span class="preflight-fix">Fix: <code>' + escapeHtml(c.fix) + '</code></span>';
      }
      html += '</li>';
    });
    html += '</ul>';
    resultsEl.innerHTML = html;
  }

  // 5. Preflight button handler.
  preflightBtn.addEventListener('click', function () {
    var planPath = planInput.value.trim();
    if (!planPath) { window.alert('Please enter a plan path.'); return; }

    preflightBtn.disabled = true;
    preflightBtn.textContent = 'Running…';
    resultsEl.innerHTML = '<p class="text-muted">Running preflight checks…</p>';
    allChecksPassed = false;
    startBtn.disabled = true;

    API.orchestratorStart(planPath, true).then(function (result) {
      renderPreflightResults((result && result.checks) ? result.checks : []);
    }).catch(function (err) {
      resultsEl.innerHTML = '<p class="error-banner">Preflight error: ' +
        escapeHtml((err && err.message) ? err.message : String(err)) + '</p>';
    }).then(function () {
      preflightBtn.disabled = false;
      preflightBtn.textContent = 'Run Preflight';
    });
  });

  /**
   * Handles the Start Run button click: validates state, calls the API to
   * start the orchestrator, then either shows a success banner + status-poll
   * timer, or falls back to re-rendering the preflight checklist on failure.
   *
   * Closure dependencies (from renderOrchestrator() scope):
   *   `allChecksPassed`          — guards against starting when preflight has
   *                                not passed; mutated to false after a successful
   *                                launch so the button cannot be clicked twice.
   *   `refreshQueue`             — called immediately after a successful launch
   *                                to populate the queue with the new entry;
   *                                read-only (function reference).
   *   `renderPreflightResults`   — called when the server re-evaluates checks on
   *                                a failed start attempt; read-only (function
   *                                reference).
   *   `_orchStatusPollCleanups`  — the module-level status-poll cleanup registry;
   *                                the new setInterval cleanup callback is pushed
   *                                here so it is cancelled on full re-render;
   *                                mutated.
   *
   * @param {HTMLButtonElement} startBtn  - The #orch-start-btn element.
   * @param {HTMLInputElement}  planInput - The #orch-plan-path input element.
   * @param {HTMLElement}       resultsEl - The #orch-preflight-results container
   *                                        (passed as parameter; not captured from closure).
   */
  function _handleStartRun(startBtn, planInput, resultsEl) {
    var planPath = planInput.value.trim();
    if (!planPath || !allChecksPassed) return;

    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    API.orchestratorStart(planPath, false).then(function (result) {
      if (result && result.started) {
        var runStatusFilename = result.runStatusFilename || null;
        planInput.value = '';
        resultsEl.innerHTML =
          '<p class="success-banner">✓ Orchestrator launched' +
          (result.pid ? ' (PID\u00a0' + result.pid + ')' : '') +
          '. Waiting for the run to appear in the queue below…</p>';
        allChecksPassed = false;
        startBtn.disabled = true;
        refreshQueue();

        // Poll the run-status tombstone so we can surface fatal early
        // failures (e.g. invalid API key) that complete before the first
        // queue poll cycle.
        if (runStatusFilename) {
          var pollCount = 0;
          var MAX_STATUS_POLLS = 15; // 2s × 15 = 30s window
          var statusPollTimer = setInterval(function () {
            pollCount++;
            API.orchestratorGetRunStatus(runStatusFilename).then(function (status) {
              if (!status) return; // file not yet written — run still in progress
              clearInterval(statusPollTimer);
              if (status.result === 'ERROR' && status.error) {
                resultsEl.innerHTML =
                  '<p class="error-banner">Run failed: ' +
                  escapeHtml(status.error) + '</p>';
              }
              // SUCCESS: queue will reflect the project; leave the banner.
            }).catch(function () {
              // Transient error — keep polling.
            });
            if (pollCount >= MAX_STATUS_POLLS) {
              clearInterval(statusPollTimer);
            }
          }, 2000);
          _orchStatusPollCleanups.push(function () { clearInterval(statusPollTimer); });
        }
      } else {
        // Checks re-evaluated by server — update the checklist.
        renderPreflightResults((result && result.checks) ? result.checks : []);
      }
    }).catch(function (err) {
      window.alert('Failed to start: ' + ((err && err.message) ? err.message : String(err)));
      startBtn.disabled = !allChecksPassed;
      startBtn.textContent = 'Start Run';
    }).then(function () {
      startBtn.textContent = 'Start Run';
    });
  }

  // 6. Start Run button handler.
  startBtn.addEventListener('click', function () { _handleStartRun(startBtn, planInput, resultsEl); });

  // 7. Queue refresh and rendering — tracks expanded row IDs across refreshes.
  var expandedIds = {};

  function refreshQueue() {
    // Stop log preview intervals started in the previous queue render.
    _orchLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
    _orchLogPreviewCleanups = [];

    var container = document.getElementById('orch-queue-container');
    if (!container) return;

    API.orchestratorGetQueue().then(function (entries) {
      renderQueueTable(container, Array.isArray(entries) ? entries : []);
    }).catch(function () {
      // Best-effort polling — keep existing content on transient errors.
    });
  }

  // ---- renderQueueTable helpers (closure-scoped) ----------------------------

  /** Removes the success banner from the preflight results area, if present.
   *  Error banners are intentionally left intact.
   *
   *  Closure dependency: `resultsEl` — the #orch-preflight-results element
   *  captured by renderOrchestrator() at line 64. */
  function _clearSuccessBanner() {
    var successBanner = resultsEl.querySelector('.success-banner');
    if (successBanner) {
      successBanner.remove();
    }
  }

  /** Builds the queue table HTML string from the entries array.
   *  Returns the complete <table>…</table> markup ready to be assigned to
   *  container.innerHTML.
   *
   *  Log-link rendering rules (progress cell):
   *    - A "View Log →" anchor using the namespaced `#/projects/{repo}/{slug}/runs/{filename}`
   *      form is rendered only when `entry.logFilename`, `entry.expectedRepo`, AND
   *      `entry.expectedSlug` are all non-null/non-empty.
   *    - Legacy entries that have `entry.logFilename` but a null `entry.expectedRepo`
   *      do NOT render a log link — falling through to the "Waiting for log…" span
   *      (when no progress text is present) or simply omitting the link entirely.
   *      This prevents broken bare-slug URLs for queue entries predating the
   *      namespace migration introduced in WP-011.
   *
   *  Both `entry.expectedRepo` and `entry.expectedSlug` are passed through
   *  `encodeURIComponent` before being embedded in any URL. */
  function _buildQueueHtml(entries) {
    var html = '<table class="table orch-queue-table"><thead>' +
      '<tr><th></th><th>Plan</th><th>Status</th><th>Elapsed</th><th>Progress</th><th>Actions</th></tr>' +
      '</thead><tbody>';
    entries.forEach(function (entry) {
      var id         = entry.id || '';
      var status     = entry.effectiveStatus || 'pending';
      var planName   = _orchBasename(entry.planPath || '');
      var elapsed    = _orchElapsed(entry.startedAt);
      var isExpanded = !!expandedIds[id];
      var statusBadgeHtml = '<span class="badge badge-' + escapeHtml(status) + '">' +
        escapeHtml(_orchStatusLabel(status)) + '</span>';
      // Progress cell: badge + text summary + optional log link.
      var progressHtml = OrchestratorWidgets.renderProgressBadge(entry.lastAction || null);
      if (entry.progress) {
        progressHtml += ' <span class="orch-progress-text">' + escapeHtml(entry.progress) + '</span>';
      }
      if (entry.logFilename && entry.expectedRepo && entry.expectedSlug) {
        progressHtml += ' <a href="#/projects/' +
          encodeURIComponent(entry.expectedRepo) + '/' +
          encodeURIComponent(entry.expectedSlug) + '/runs/' +
          encodeURIComponent(entry.logFilename) + '" class="orch-log-link">View Log →</a>';
      } else if (!entry.progress) {
        progressHtml += ' <span class="text-muted">Waiting for log…</span>';
      }
      html += '<tr class="orch-queue-row orch-row-' + escapeHtml(status) + '"' +
        ' data-entry-id="' + escapeHtml(id) + '">';
      html += '<td class="orch-toggle-cell">' +
        '<button type="button" class="orch-row-toggle btn-icon" data-entry-id="' + escapeHtml(id) + '">' +
        (isExpanded ? '▼' : '▶') + '</button></td>';
      html += '<td class="orch-plan-cell" title="' + escapeHtml(entry.planPath || '') + '">' +
        escapeHtml(planName) + '</td>';
      html += '<td class="orch-status-cell">' + statusBadgeHtml + '</td>';
      html += '<td class="orch-elapsed-cell">' + escapeHtml(elapsed) + '</td>';
      html += '<td class="orch-progress-cell">' + progressHtml + '</td>';
      html += '<td class="orch-actions-cell" data-actions-for="' + escapeHtml(id) + '"></td>';
      html += '</tr>';
      if (isExpanded) {
        html += '<tr class="orch-log-row" data-entry-id="' + escapeHtml(id) + '">' +
          '<td colspan="6">' +
          '<div class="orch-log-preview" id="orch-log-' + escapeHtml(id) + '"></div>' +
          '</td></tr>';
      }
    });
    html += '</tbody></table>';
    return html;
  }

  /** Injects DOM-based action buttons and toggle listeners into the rendered
   *  table. Must be called after container.innerHTML has been set.
   *
   *  Branch priority (dismissibility-first):
   *    1. pending  → Kill button   (process is still running)
   *    2. dead     → Dismiss button (process has exited without completing)
   *    3. projectExists + expectedRepo + expectedSlug → "View Project" link using
   *       the namespaced `#/projects/{repo}/{slug}` form (WP-011)
   *    4. projectExists + expectedSlug, but expectedRepo is null → no link rendered
   *       (legacy queue entry; omitted to avoid constructing a broken bare-slug URL)
   *  The dead branch precedes the projectExists branch so that a dead entry
   *  that also has a known project slug always renders Dismiss, not View Project.
   *  Case 4 is an explicit empty branch retained for clarity — it documents the
   *  intentional omission so future contributors understand why no link appears for
   *  entries that were enqueued before the namespace migration (WP-011).
   *
   *  Closure dependencies (from renderOrchestrator() scope):
   *    `expandedIds`            — tracks which queue rows are expanded; mutated
   *                               by toggle clicks to persist state across refreshes.
   *    `refreshQueue`           — triggers a fresh API fetch + re-render after
   *                               a Kill/Dismiss action or toggle click. */
  function _bindQueueActions(container, entries) {
    entries.forEach(function (entry) {
      var id     = entry.id || '';
      var status = entry.effectiveStatus || 'pending';
      var cell   = container.querySelector('[data-actions-for="' + id + '"]');
      if (!cell) return;

      if (status === 'pending') {
        cell.appendChild(OrchestratorWidgets.renderKillButton(id, function () {
          delete expandedIds[id];
          refreshQueue();
        }));
      } else if (status === 'dead') {
        cell.appendChild(OrchestratorWidgets.renderDismissButton(id, function () {
          delete expandedIds[id];
          refreshQueue();
        }));
      } else if (entry.projectExists === true && entry.expectedRepo && entry.expectedSlug) {
        var link = document.createElement('a');
        link.href = '#/projects/' +
          encodeURIComponent(entry.expectedRepo) + '/' +
          encodeURIComponent(entry.expectedSlug);
        link.className = 'btn btn-sm btn-secondary orch-queue-action-btn';
        link.textContent = 'View Project';
        cell.appendChild(link);
      } else if (entry.projectExists === true && entry.expectedSlug && !entry.expectedRepo) {
        // Legacy queue entry without expectedRepo — omit the project link to
        // avoid constructing a broken bare-slug URL. The entry is still shown
        // in the queue but no navigation link is rendered.
      }
    });

    var toggleBtns = container.querySelectorAll('.orch-row-toggle');
    Array.prototype.forEach.call(toggleBtns, function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-entry-id');
        if (id) expandedIds[id] = !expandedIds[id];
        refreshQueue();
      });
    });
  }

  /** Starts log previews for all currently expanded rows and registers their
   *  cleanup callbacks in _orchLogPreviewCleanups.
   *
   *  Closure dependencies (from renderOrchestrator() scope):
   *    `expandedIds`              — read to determine which rows are currently
   *                                 expanded; only those rows get a live preview.
   *    `_orchLogPreviewCleanups`  — the module-level log-preview cleanup registry;
   *                                 each preview's cleanup callback is pushed here
   *                                 so it is cancelled when renderOrchestrator() or
   *                                 refreshQueue() next runs.
   *
   *  Note: _orchStatusPollCleanups is a separate registry for status-poll timers
   *  and is intentionally excluded from this function's scope. Status-poll cleanups
   *  are only drained by renderOrchestrator() (full view re-render), never by
   *  refreshQueue() or _mountLogPreviews(). */
  function _mountLogPreviews(container, entries) {
    entries.forEach(function (entry) {
      var id = entry.id || '';
      if (!expandedIds[id] || !entry.logFilename || !entry.expectedRepo || !entry.expectedSlug) return;
      var previewEl = document.getElementById('orch-log-' + id);
      if (!previewEl) return;
      var cleanup = OrchestratorWidgets.renderLogPreview(
        previewEl,
        entry.expectedRepo,
        entry.expectedSlug,
        entry.logFilename
      );
      _orchLogPreviewCleanups.push(cleanup);
    });
  }

  // ---- renderQueueTable coordinator ----------------------------------------

  function renderQueueTable(container, entries) {
    // Save viewport scroll position before replacing innerHTML — the document
    // viewport is the scrolling context (not the container, which has no
    // overflow CSS), so window.scrollY is the correct save/restore target.
    var savedScrollY = window.scrollY;

    if (!entries.length) {
      container.innerHTML = '<p class="text-muted orch-empty-queue">No active runs in the queue.</p>';
      return;
    }

    _clearSuccessBanner();
    container.innerHTML = _buildQueueHtml(entries);
    _bindQueueActions(container, entries);
    _mountLogPreviews(container, entries);

    // Restore scroll position after all DOM manipulation is complete.
    // Must be the last statement so intermediate DOM mutations do not
    // interfere with the restored position.
    window.scrollTo(0, savedScrollY);
  }

  // 8. Kick off the first queue fetch and register the polling interval.
  refreshQueue();
  Router._setPolling(refreshQueue, 5000);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Returns the final path segment (filename or folder name). */
function _orchBasename(path) {
  var parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** Human-readable label for an effectiveStatus value. */
function _orchStatusLabel(status) {
  if (status === 'started') return 'Started';
  if (status === 'dead')    return 'Dead';
  return 'Pending';
}

/** Formats elapsed time from an ISO start timestamp. */
function _orchElapsed(startedAt) {
  if (!startedAt) return '—';
  try {
    var diff = Date.now() - new Date(startedAt).getTime();
    if (isNaN(diff) || diff < 0) return '—';
    var secs = Math.round(diff / 1000);
    if (secs < 60)  return secs + 's';
    var mins = Math.floor(secs / 60);
    if (mins < 60)  return mins + 'm ' + (secs % 60) + 's';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  } catch (_) {
    return '—';
  }
}

```
###  Path: `/mcp-server/gui/public/views/project-detail.js`

```js
/* ============================================================
   views/project-detail.js — Project Detail view
   Sections 4b–4d of the MCP Server Dashboard SPA
   Depends on: API, Router, marked, escapeHtml, formatDate,
               statusBadge, showLoading, showError,
               OrchestratorWidgets (js/orchestrator-widgets.js)
   ============================================================ */

// Module-scoped log-preview cleanup registry.
// Each renderProjectDetail() call drains this array before creating new widgets.
var _pdLogPreviewCleanups = [];

/* ----------------------------------------------------------
   4b. View: Plan Document
   ---------------------------------------------------------- */
function extractSynopsis(markdown) {
  var match = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
  return match ? match[1].trim() : null;
}

async function renderPlan(app, repo, slug) {
  app.innerHTML = '<p class="loading">Loading plan\u2026</p>';
  try {
    var result = await API.getPlanDocument(repo, slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf('Plan').html() +
      '<div class="plan-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        breadcrumb().projects().project(repo, slug).leaf('Plan').html() +
        '<p class="empty-state">Plan document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load plan document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4b-ii. View: Synthesis Document
   ---------------------------------------------------------- */
async function renderSynthesis(app, repo, slug) {
  app.innerHTML = '<p class="loading">Loading synthesis\u2026</p>';
  try {
    var result = await API.getSynthesisDocument(repo, slug);
    var html = marked.parse(result.content);
    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf('Synthesis').html() +
      '<div class="synthesis-content">' + html + '</div>';
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      app.innerHTML =
        breadcrumb().projects().project(repo, slug).leaf('Synthesis').html() +
        '<p class="empty-state">Synthesis document not available for this project.</p>';
    } else {
      app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>';
    }
  }
}

/* ----------------------------------------------------------
   4c. View: Project Detail
   ---------------------------------------------------------- */

// Abbreviations for pipeline stage types
var STAGE_ABBREV = {
  'implementation':     'DEV',
  'qa':                 'QA',
  'security-audit':     'SEC',
  'code-review':        'REV',
  'release-engineering':'REL',
  'documentation':      'DOC'
};

function buildPipelineTrack(overviewEntry) {
  if (!overviewEntry || !overviewEntry.pipeline_stages || !overviewEntry.pipeline_stages.length) {
    return '—';
  }
  var badges = overviewEntry.pipeline_stages.map(function (stage) {
    var abbrev = STAGE_ABBREV[stage.type] || stage.type.slice(0, 3).toUpperCase();
    var statusClass = 'stage-pending';
    if (stage.status === 'in-progress') statusClass = 'stage-in-progress';
    else if (stage.status === 'pass')        statusClass = 'stage-pass';
    else if (stage.status === 'fail')        statusClass = 'stage-fail';
    var tooltip = escapeHtml(stage.type) + ' — ' + escapeHtml(stage.agent);
    if (stage.rework_count > 0) tooltip += ' (rework: ' + stage.rework_count + ')';
    var reworkBadge = stage.rework_count > 0
      ? '<span class="rework-indicator" title="Rework count: ' + stage.rework_count + '">' + stage.rework_count + '</span>'
      : '';
    return '<span class="stage-badge ' + statusClass + '" title="' + tooltip + '">' +
      escapeHtml(abbrev) +
      reworkBadge +
    '</span>';
  }).join('');
  return '<div class="pipeline-track">' + badges + '</div>';
}

function buildRunBadges(item, isActive) {
  var badges = '';
  if (isActive) {
    badges += '<span class="badge badge-in-progress">Running</span>';
  }
  if (item && item.is_dry_run) {
    badges += '<span class="badge badge-dry-run">Dry Run</span>';
  }
  return badges;
}

function renderProjectDetail(app, repo, slug) {
  // Drain log preview cleanup callbacks from the previous render.
  _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
  _pdLogPreviewCleanups = [];

  showLoading(app);

  Promise.all([
    API.getProject(repo, slug),
    API.getPlanDocument(repo, slug).catch(function () { return null; }),
    API.getWorkPackageOverview(repo, slug).catch(function () { return null; }),
  ]).then(function (results) {
    var project = results[0];
    var planResult = results[1];
    var overviewResult = results[2]; // null if request failed (graceful degradation)
    var meta = project.meta || {};
    var wps = project.work_packages || [];

    // Build a fast lookup: work_package_id → overview entry
    var overviewMap = {};
    if (overviewResult && Array.isArray(overviewResult)) {
      overviewResult.forEach(function (entry) {
        overviewMap[entry.work_package_id] = entry;
      });
    }

    var useOverview = overviewResult !== null;

    var wpRows = wps.map(function (wp) {
      var pipelineCell = useOverview
        ? buildPipelineTrack(overviewMap[wp.work_package_id])
        : escapeHtml(wp.work_package_id);
      return '<tr class="clickable" data-href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' +
        '<td class="monospace"><a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/wp/' + encodeURIComponent(wp.work_package_id) + '">' + escapeHtml(wp.work_package_id) + '</a></td>' +
        '<td>' + pipelineCell + '</td>' +
        '<td>' + escapeHtml(wp.assigned_to || '—') + '</td>' +
        '<td>' + statusBadge(wp.status) + '</td>' +
      '</tr>';
    }).join('');

    // Sort project comments newest-first
    var comments = (project.project_comments || []).slice().sort(function (a, b) {
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    var commentCards = comments.length
      ? comments.map(function (c) {
          var priorityClass = c.priority ? ' priority-' + c.priority : '';
          var contextHtml = '';
          if (c.context && typeof c.context === 'object') {
            var ctxItems = Object.entries(c.context).map(function (pair) {
              return '<span><strong>' + escapeHtml(pair[0]) + ':</strong> ' + escapeHtml(String(pair[1])) + '</span>';
            }).join('<br>');
            contextHtml =
              '<div style="margin-top:8px;padding:8px 10px;background:var(--color-bg);border-radius:var(--radius);font-size:12px;line-height:1.6">' +
                ctxItems +
              '</div>';
          }
          return '<div class="comment-card' + priorityClass + '">' +
            '<div class="comment-meta">' +
              escapeHtml(c.agent || '—') +
              ' <span class="comment-type">' + escapeHtml(c.type || '') + '</span>' +
              ' <span>' + escapeHtml(formatDate(c.timestamp)) + '</span>' +
            '</div>' +
            '<div style="margin-top:6px">' + escapeHtml(c.note || '') + '</div>' +
            contextHtml +
          '</div>';
        }).join('')
      : '<p class="text-muted">No comments yet.</p>';

    var displayTitle = (project.project_name && project.project_name.trim()) ? project.project_name : ((meta.title && meta.title.trim()) ? meta.title : slug);
    ProjectNameCache.set(makeProjectCacheKey(repo, slug), displayTitle);
    app.innerHTML =
      breadcrumb().projects().leafSpan(displayTitle, 'breadcrumb-title').html() +
      (meta.status === 'ARCHIVED' ?
        '<div class="info-banner" id="archive-banner">' +
          'This project is archived and hidden from the active list. ' +
          '<button class="btn btn-secondary btn-sm" id="unarchive-banner-btn">Unarchive</button>' +
        '</div>' : '') +
      '<div class="page-header">' +
        '<div class="page-heading-wrapper">' +
          '<h1 id="project-title-heading">' + escapeHtml(displayTitle) + '</h1>' +
          '<button class="edit-title-btn" id="edit-title-btn" title="Rename project">\u270e</button>' +
        '</div>' +
        statusBadge(meta.status) +
        '<span id="health-badge" class="health-badge">Checking\u2026</span>' +
        '<button class="btn btn-secondary btn-sm" id="reset-project-btn">Reset Project</button>' +
      '</div>' +
      '<div class="card">' +
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Slug:</strong> <span class="monospace" id="project-slug-value">' + escapeHtml(slug) + '</span>' +
          '<button class="edit-slug-btn" id="edit-slug-btn" title="Rename slug">✎</button><br>' +
          '<strong>Plan path:</strong> <span class="monospace">' + escapeHtml(meta.plan_path || '—') + '</span><br>' +
          '<strong>Created:</strong> ' + escapeHtml(formatDate(meta.date_created)) + ' &nbsp; ' +
          '<strong>Updated:</strong> ' + escapeHtml(formatDate(meta.last_updated)) +
          (project.timing
            ? '<br><strong>Duration:</strong> ' + escapeHtml(formatDuration(project.timing.project_elapsed_ms)) +
                (project.timing.pipeline_runs > 0
                  ? ' &nbsp;\u00b7&nbsp; <strong>Active:</strong> ' + escapeHtml(formatDuration(project.timing.total_active_ms)) + ' across ' + project.timing.pipeline_runs + ' pipeline runs'
                  : '')
            : '') +
          (project.server_version ? '<br><strong>Server version:</strong> <span class="monospace">v' + escapeHtml(project.server_version) + '</span>' : '') +
          (project.ledger_version ? ' &nbsp; <strong>Spec version:</strong> <span class="monospace">v' + escapeHtml(project.ledger_version) + '</span>' : '') +
        '</div>' +
      '</div>' +

      (function () {
        var synopsisHtml = '';
        if (planResult && planResult.content) {
          var synopsis = extractSynopsis(planResult.content);
          if (synopsis) {
            synopsisHtml =
              '<div class="plan-synopsis">' +
              '<div class="plan-synopsis__content">' + marked.parse(synopsis) + '</div>' +
              '<a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/plan" class="plan-synopsis__link">View full plan \u2192</a>' +
              '</div>';
          }
        }
        return synopsisHtml;
      })() +

      (function () {
        if (!project.synthesis_generated) return '';
        return '<div class="synthesis-link-row">' +
          '<a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/synthesis" class="synthesis-link">View synthesis \u2192</a>' +
          '</div>';
      })() +

      '<div class="card-title">Work Packages</div>' +
      (wps.length
        ? '<div class="table-wrapper"><table>' +
            '<thead><tr><th>WP ID</th><th>' + (useOverview ? 'Pipeline Stages' : 'WP ID') + '</th><th>Assigned To</th><th>Status</th></tr></thead>' +
            '<tbody>' + wpRows + '</tbody>' +
          '</table></div>'
        : '<p class="text-muted">No work packages.</p>') +
      '<div class="card-title" style="margin-top:24px">Project Comments</div>' +
      commentCards +

      // Orchestrator Runs section — rendered for any project; shown only when logs exist
      '<div id="orchestrator-runs-wrapper" style="display:none">' +
        '<div class="card-title" style="margin-top:24px">Orchestrator Runs</div>' +
        '<div id="orch-resume-cell"></div>' +
        '<div id="orchestrator-runs-section"><p class="loading">Loading runs\u2026</p></div>' +
      '</div>';

    // Unarchive banner button handler
    var unarchiveBannerBtn = document.getElementById('unarchive-banner-btn');
    if (unarchiveBannerBtn) {
      unarchiveBannerBtn.addEventListener('click', function () {
        API.unarchiveProject(repo, slug).then(function () {
          renderProjectDetail(app, repo, slug);
        }).catch(function (err) {
          alert('Unarchive failed: ' + (err.message || String(err)));
        });
      });
    }

    // Clickable rows
    app.querySelectorAll('tr.clickable').forEach(function (row) {
      row.addEventListener('click', function () {
        var href = this.getAttribute('data-href');
        if (href) window.location.hash = href;
      });
    });

    // Reset Project button
    var resetBtn = document.getElementById('reset-project-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Analyzing…';
        API.analyzeProjectReset(repo, slug).then(function (diagnosis) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset Project';
          if (diagnosis.work_packages_needing_reset === 0) {
            if (meta.status === 'IN_PROGRESS') {
              showResetModal(repo, slug, diagnosis, { markComplete: true });
            } else {
              alert('All work packages are healthy — no reset needed.');
            }
            return;
          }
          showResetModal(repo, slug, diagnosis);
        }).catch(function (err) {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset Project';
          alert('Analysis failed: ' + (err.message || String(err)));
        });
      });
    }

    // Inline title edit
    (function () {
      var editBtn = document.getElementById('edit-title-btn');
      var headingEl = document.getElementById('project-title-heading');
      var breadcrumbEl = document.getElementById('breadcrumb-title');
      if (!editBtn || !headingEl) return;

      var currentTitle = displayTitle;

      editBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'title-edit-input';
        input.value = currentTitle;
        headingEl.style.display = 'none';
        editBtn.style.display = 'none';
        headingEl.parentNode.insertBefore(input, headingEl.nextSibling);
        input.focus();
        input.select();

        var inputDone = false;

        function exitEdit() {
          var errEl = document.getElementById('title-edit-error');
          if (errEl) errEl.remove();
          if (input.parentNode) input.parentNode.removeChild(input);
          headingEl.style.display = '';
          editBtn.style.display = '';
        }

        function doSave() {
          var newTitle = input.value.trim();
          if (!newTitle || newTitle === currentTitle) {
            exitEdit();
            return;
          }
          input.disabled = true;
          API.renameProject(repo, slug, newTitle).then(function () {
            currentTitle = newTitle;
            headingEl.textContent = newTitle;
            if (breadcrumbEl) breadcrumbEl.textContent = newTitle;
            exitEdit();
          }).catch(function (err) {
            input.disabled = false;
            inputDone = false; // allow retry after failure
            var errEl = document.getElementById('title-edit-error');
            if (!errEl) {
              errEl = document.createElement('div');
              errEl.id = 'title-edit-error';
              errEl.className = 'title-edit-error';
              headingEl.parentNode.insertBefore(errEl, input.nextSibling);
            }
            errEl.textContent = 'Rename failed: ' + (err.message || String(err));
          });
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            inputDone = true;
            exitEdit();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!inputDone) {
              inputDone = true;
              doSave();
            }
          }
        });

        input.addEventListener('blur', function () {
          if (!inputDone) {
            inputDone = true;
            doSave();
          }
        });
      });
    })();

    // Inline slug edit
    (function () {
      var editBtn = document.getElementById('edit-slug-btn');
      var slugValueEl = document.getElementById('project-slug-value');
      if (!editBtn || !slugValueEl) return;

      var currentSlug = slug;
      var SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

      editBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'slug-edit-input';
        input.maxLength = 200;
        input.value = currentSlug;
        slugValueEl.style.display = 'none';
        editBtn.style.display = 'none';
        slugValueEl.parentNode.insertBefore(input, slugValueEl.nextSibling);
        input.focus();
        input.select();

        var inputDone = false;

        function showSlugError(msg) {
          var errEl = document.getElementById('slug-edit-error');
          if (!errEl) {
            errEl = document.createElement('div');
            errEl.id = 'slug-edit-error';
            errEl.className = 'slug-edit-error';
            input.parentNode.insertBefore(errEl, input.nextSibling);
          }
          errEl.textContent = msg;
        }

        function clearSlugError() {
          var errEl = document.getElementById('slug-edit-error');
          if (errEl) errEl.remove();
        }

        function exitSlugEdit() {
          clearSlugError();
          if (input.parentNode) input.parentNode.removeChild(input);
          slugValueEl.style.display = '';
          editBtn.style.display = '';
        }

        function doSlugSave() {
          var newSlug = input.value.trim();
          if (!newSlug || newSlug === currentSlug) {
            exitSlugEdit();
            return;
          }
          if (!SLUG_REGEX.test(newSlug)) {
            showSlugError('Invalid slug: use lowercase letters, digits, and hyphens only (must start with a letter or digit).');
            inputDone = false;
            return;
          }
          input.disabled = true;
          clearSlugError();
          API.renameSlug(repo, currentSlug, newSlug).then(function () {
            window.location.hash = '#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(newSlug);
          }).catch(function (err) {
            input.disabled = false;
            inputDone = false;
            showSlugError('Rename failed: ' + (err.message || String(err)));
          });
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            inputDone = true;
            exitSlugEdit();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!inputDone) {
              inputDone = true;
              doSlugSave();
            }
          }
        });

        input.addEventListener('blur', function () {
          if (!inputDone) {
            inputDone = true;
            doSlugSave();
          }
        });
      });
    })();

    // Health badge — async, non-blocking
    var healthBadge = document.getElementById('health-badge');
    if (healthBadge) {
      API.getProjectHealth(repo, slug).then(function (health) {
        if (health.work_packages_needing_reset === 0) {
          healthBadge.textContent = '\u2713 All pipelines complete';
          healthBadge.className = 'health-badge healthy';
        } else {
          healthBadge.textContent = '\u26a0 ' + health.work_packages_needing_reset + ' WP' + (health.work_packages_needing_reset === 1 ? '' : 's') + ' need attention';
          healthBadge.className = 'health-badge attention';
        }
      }).catch(function () {
        // Silent failure — remove badge without blocking page
        if (healthBadge.parentNode) healthBadge.parentNode.removeChild(healthBadge);
      });
    }
    // Orchestrator Runs — async, non-blocking; section becomes visible only when logs exist
    API.getRunLogs(repo, slug).then(function (logs) {
      var wrapperEl = document.getElementById('orchestrator-runs-wrapper');
      var runsEl = document.getElementById('orchestrator-runs-section');
      if (!wrapperEl || !runsEl) return;
      if (!Array.isArray(logs) || logs.length === 0) return;
      wrapperEl.style.display = '';

      // Sort most recent first — filename prefix (YYYYMMDDTHHmmss) is lexicographically
      // sortable, so a descending filename sort is equivalent to a descending date sort.
      var sorted = logs.slice().sort(function (a, b) {
        var aName = (a && a.filename) ? a.filename : String(a);
        var bName = (b && b.filename) ? b.filename : String(b);
        return bName.localeCompare(aName);
      });

      // Only the most recent run can be truly active.
      var activeItem = (sorted.length > 0 && sorted[0] && sorted[0].is_active) ? sorted[0] : null;
      var activeFilename = activeItem ? (activeItem.filename || '') : null;

      // Render the full runs list; called with the matched queue entry (or null).
      // NOTE (refactor candidate): renderRunsList is a nested closure inside the getRunLogs().then()
      // callback to close over sorted, repo, slug, and activeFilename. A future pass could extract this as
      // a module-level helper accepting (sorted, repo, slug, activeFilename, matchingQueueEntry) to improve
      // testability and reduce closure depth.
      function renderRunsList(matchingQueueEntry) {
        // Drain any existing log preview cleanups before rebuilding the DOM.
        _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
        _pdLogPreviewCleanups = [];

        runsEl.innerHTML = sorted.map(function (item, index) {
          var filename = (item && item.filename) ? item.filename : String(item);
          var isActive = index === 0 && !!(item && item.is_active);
          var href = '#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/runs/' + encodeURIComponent(filename);
          var runNumber = sorted.length - index;

          var dateStr = (function () {
            var m = filename.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-/);
            if (!m) return '';
            var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
            var formatted = formatDate(iso);
            return formatted ? ' <span class="text-muted" style="font-size:11px">' + escapeHtml(formatted) + '</span>' : '';
          }());

          var badges = buildRunBadges(item, isActive);

          var rowHtml =
            '<div class="run-event run-event--info" style="display:flex;align-items:center;justify-content:space-between">' +
              '<span>' + badges + '<span style="font-size:13px">Run #' + runNumber + '</span>' + dateStr + '</span>' +
              '<a class="btn btn-secondary btn-sm" href="' + href + '">View</a>' +
            '</div>';

          if (isActive) {
            var statusCardHtml = matchingQueueEntry
              ? OrchestratorWidgets.renderStatusCard(matchingQueueEntry)
              : '';
            var cliKillHint = !matchingQueueEntry
              ? '<p class="orch-cli-kill-hint text-muted">To kill this run: ' +
                  '<code>node scripts/kill-orchestrator.js --force</code></p>'
              : '';
            rowHtml +=
              '<div class="orch-active-run-section">' +
                statusCardHtml +
                '<div id="orch-active-kill-cell"></div>' +
                cliKillHint +
                '<div class="orch-log-preview" id="orch-project-log-preview"></div>' +
              '</div>';
          }

          return rowHtml;
        }).join('');

        // Inject DOM-based kill button when a matching queue entry exists.
        if (matchingQueueEntry) {
          var killCell = document.getElementById('orch-active-kill-cell');
          if (killCell) {
            killCell.appendChild(OrchestratorWidgets.renderKillButton(
              matchingQueueEntry.id,
              function () {
                // Re-poll the queue and re-render after kill.
                API.orchestratorGetQueue().then(function (q) {
                  var newMatch = null;
                  if (Array.isArray(q)) {
                    for (var i = 0; i < q.length; i++) {
                      if (q[i] && q[i].logFilename === activeFilename) {
                        newMatch = q[i];
                        break;
                      }
                    }
                  }
                  renderRunsList(newMatch);
                }).catch(function () { renderRunsList(null); });
              }
            ));
          }
        }

        // Start inline log preview for the active run.
        if (activeFilename) {
          var previewEl = document.getElementById('orch-project-log-preview');
          if (previewEl) {
            var cleanup = OrchestratorWidgets.renderLogPreview(previewEl, repo, slug, activeFilename);
            _pdLogPreviewCleanups.push(cleanup);
          }
        }
      }

      if (activeFilename) {
        // Active run: fetch the queue to find the matching entry, then render.
        // Polling refreshes the status card and log preview every 5 s.
        var pollQueue = function () {
          // Drain existing log previews before re-fetching.
          _pdLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
          _pdLogPreviewCleanups = [];

          API.orchestratorGetQueue().then(function (queue) {
            var match = null;
            if (Array.isArray(queue)) {
              for (var i = 0; i < queue.length; i++) {
                if (queue[i] && queue[i].logFilename === activeFilename) {
                  match = queue[i];
                  break;
                }
              }
            }
            renderRunsList(match);
          }).catch(function () {
            renderRunsList(null);
          });
        };

        pollQueue();
        Router._setPolling(pollQueue, 5000);
      } else {
        // No active run — render without queue interaction.
        renderRunsList(null);

        // Resume button: show when run metadata indicates a resumable interrupted run.
        var resumeCell = document.getElementById('orch-resume-cell');
        if (resumeCell && meta.plan_path &&
            meta.status !== 'COMPLETE' && meta.status !== 'ARCHIVED') {

          // showResumeError: reusable helper that creates the error banner on first
          // call and reuses it on subsequent calls. The getElementById guard prevents
          // duplicate DOM nodes if the user triggers multiple failed resume attempts
          // (e.g. rapid re-clicks after the button is re-enabled on error).
          function showResumeError(msg) {
            var errEl = document.getElementById('orch-resume-error');
            if (!errEl) {
              errEl = document.createElement('p');
              errEl.id = 'orch-resume-error';
              errEl.className = 'error-banner';
              resumeCell.appendChild(errEl);
            }
            errEl.textContent = msg;
          }

          API.getRunMetadata(repo, slug).then(function (runMeta) {
            if (!runMeta || !runMeta.thread_id ||
                runMeta.dry_run === true || runMeta.result === 'SUCCESS') {
              return;
            }
            var threadId = runMeta.thread_id;
            var planPath = meta.plan_path;

            var resumeBtn = document.createElement('button');
            resumeBtn.id = 'orch-resume-btn';
            resumeBtn.className = 'btn btn-resume';
            resumeBtn.textContent = 'Resume Run';

            resumeBtn.addEventListener('click', function () {
              resumeBtn.disabled = true;
              resumeBtn.textContent = 'Resuming\u2026';

              API.orchestratorStart(planPath, false, threadId).then(function (result) {
                if (result && result.started) {
                  resumeBtn.textContent = 'Launching\u2026';
                  // Poll the queue; re-render the full view once an active entry appears.
                  var pollResume = function () {
                    API.orchestratorGetQueue().then(function (queue) {
                      var hasActiveEntry = Array.isArray(queue) && queue.some(function (entry) {
                        return entry && (entry.effectiveStatus === 'pending' ||
                                        entry.effectiveStatus === 'started');
                      });
                      if (hasActiveEntry) {
                        Router._clearPolling();
                        renderProjectDetail(app, repo, slug);
                      }
                    }).catch(function () { /* keep polling */ });
                  };
                  Router._setPolling(pollResume, 3000);
                } else {
                  resumeBtn.disabled = false;
                  resumeBtn.textContent = 'Resume Run';
                  showResumeError('Resume could not be started.');
                }
              }).catch(function (err) {
                resumeBtn.disabled = false;
                resumeBtn.textContent = 'Resume Run';
                showResumeError('Resume failed: ' + (err.message || String(err)));
              });
            });

            resumeCell.appendChild(resumeBtn);
          }).catch(function () {
            // Metadata unavailable — silently skip resume button.
          });
        }
      }
    }).catch(function () {
      // Silent failure — don't show error for projects without logs
    });

  }).catch(function (err) {
    showError(app, 'Failed to load project: ' + (err.message || String(err)));
  });
}

/* ----------------------------------------------------------
   4c-ii. Reset Project Modal
   ---------------------------------------------------------- */
var PIPELINE_STAGES = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];

function showResetModal(repo, slug, diagnosis, options) {
  // Remove any existing modal
  var existing = document.getElementById('reset-modal-overlay');
  if (existing) existing.remove();

  var wps = diagnosis.work_packages || [];

  // Build state: per-WP action + criteria checkbox
  var state = {};
  wps.forEach(function (wp) {
    state[wp.work_package_id] = {
      action: wp.current_status === 'CANCELLED' ? 'skip' : wp.suggested_action,
      reset_criteria: wp.suggested_reset_criteria,
      isCancelled: wp.current_status === 'CANCELLED',
    };
  });

  var markCompleteMode = !!(options && options.markComplete);

  function buildSummary() {
    if (markCompleteMode) {
      return '\u26A0 All non-cancelled WPs will be forced to COMPLETE \u2014 Project status \u2192 COMPLETE';
    }
    var resetCount = 0, skipCount = 0, cancelCount = 0;
    Object.keys(state).forEach(function (id) {
      if (state[id].action === 'reset') resetCount++;
      else if (state[id].action === 'cancel') cancelCount++;
      else skipCount++;
    });
    var parts = [];
    if (resetCount > 0) parts.push(resetCount + ' will be reset');
    if (skipCount > 0) parts.push(skipCount + ' skipped');
    if (cancelCount > 0) parts.push(cancelCount + ' cancelled');
    var statusNote = (resetCount > 0 || cancelCount > 0)
      ? ' — Project status \u2192 IN_PROGRESS'
      : '';
    return parts.join(', ') + statusNote;
  }

  function stageBadge(stage, present, inactive) {
    var cls = inactive
      ? 'reset-stage-badge reset-stage-inactive'
      : (present ? 'reset-stage-badge reset-stage-present' : 'reset-stage-badge reset-stage-missing');
    return '<span class="' + cls + '">' + escapeHtml(stage) + '</span>';
  }

  function buildWpRow(wp) {
    var s = state[wp.work_package_id];
    var id = wp.work_package_id;
    var safeid = id.replace(/[^a-zA-Z0-9-]/g, '_');

    // Stage badges
    var presentSet = {};
    (wp.pipeline_stages_present || []).forEach(function (st) { presentSet[st] = true; });
    var activeSet = {};
    (wp.active_pipeline_stages || PIPELINE_STAGES).forEach(function (st) { activeSet[st] = true; });
    var stageBadges = PIPELINE_STAGES.map(function (st) {
      return stageBadge(st, !!presentSet[st], !activeSet[st]);
    }).join(' ');

    if (s.isCancelled) {
      return '<div class="reset-wp-row reset-wp-cancelled">' +
        '<div class="reset-wp-header">' +
          '<span class="monospace">' + escapeHtml(id) + '</span> ' +
          statusBadge(wp.current_status) +
        '</div>' +
        '<div class="reset-wp-stages">' + stageBadges + '</div>' +
        '<div class="text-muted" style="font-size:12px">CANCELLED — cannot be modified</div>' +
      '</div>';
    }

    var expanded = s.action === 'reset' || wp.needs_reset;

    // Collapsed summary line
    var actionLabel = s.action === 'reset' ? 'Reset' : (s.action === 'cancel' ? 'Cancel' : 'Skip');
    var collapsedSummary = escapeHtml(wp.reason);

    var detailHtml =
      '<div class="reset-wp-stages">' + stageBadges + '</div>' +
      '<div class="reset-wp-reason text-muted">' + escapeHtml(wp.reason) + '</div>';

    if (wp.pipeline_stages_missing.length > 0 && wp.next_required_stage) {
      detailHtml +=
        '<div class="reset-wp-diagnosis">Missing: ' + escapeHtml(wp.pipeline_stages_missing.join(', ')) +
        ' \u2192 will resume at <strong>' + escapeHtml(wp.target_assigned_to || wp.next_required_stage) + '</strong></div>';
    }

    // Radio buttons
    var radioName = 'action_' + safeid;
    var radios =
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="reset"' + (s.action === 'reset' ? ' checked' : '') + '> Reset</label>' +
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="skip"' + (s.action === 'skip' ? ' checked' : '') + '> Skip</label>' +
      '<label class="reset-radio"><input type="radio" name="' + radioName + '" value="cancel"' + (s.action === 'cancel' ? ' checked' : '') + '> Cancel</label>';

    // Criteria checkbox (only visible when action === reset)
    var criteriaHtml =
      '<div class="reset-criteria-row" id="criteria_' + safeid + '" style="' + (s.action === 'reset' ? '' : 'display:none') + '">' +
        '<label><input type="checkbox" class="form-check" id="criteria_cb_' + safeid + '"' + (s.reset_criteria ? ' checked' : '') + '> Reset acceptance criteria to unmet</label>' +
      '</div>';

    return '<div class="reset-wp-row' + (expanded ? ' reset-wp-expanded' : '') + '" data-wp-id="' + escapeHtml(id) + '">' +
      '<div class="reset-wp-header reset-wp-toggle" data-target="detail_' + safeid + '">' +
        '<span class="reset-wp-arrow">' + (expanded ? '\u25BC' : '\u25B6') + '</span> ' +
        '<span class="monospace">' + escapeHtml(id) + '</span> ' +
        statusBadge(wp.current_status) +
        (wp.needs_reset ? ' <span class="badge badge-blocked" style="font-size:10px">NEEDS RESET</span>' : '') +
        ' <span class="text-muted" style="font-size:12px;margin-left:auto">' + escapeHtml(actionLabel) + '</span>' +
      '</div>' +
      '<div class="reset-wp-detail" id="detail_' + safeid + '" style="' + (expanded ? '' : 'display:none') + '">' +
        detailHtml +
        '<div class="reset-wp-actions">' + radios + '</div>' +
        criteriaHtml +
      '</div>' +
    '</div>';
  }

  var wpRowsHtml = wps.map(buildWpRow).join('');

  var modalHtml =
    '<div class="reset-modal-overlay" id="reset-modal-overlay">' +
      '<div class="reset-modal">' +
        '<div class="reset-modal-header">' +
          '<h2>Reset Project \u2014 ' + escapeHtml(slug) + '</h2>' +
          '<button class="reset-modal-close" id="reset-modal-close">\u00d7</button>' +
        '</div>' +
        '<div class="reset-modal-banner">' +
          (markCompleteMode
            ? 'All work packages are healthy. Click <strong>Mark as Complete</strong> to close out this project.'
            : 'Analysis found <strong>' + diagnosis.work_packages_needing_reset + '</strong> broken work package' +
              (diagnosis.work_packages_needing_reset !== 1 ? 's' : '') +
              ' out of <strong>' + wps.length + '</strong> total.') +
        '</div>' +
        '<div class="reset-bulk-controls">' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-broken">Reset All Broken</button> ' +
          '<button class="btn btn-secondary btn-sm" id="reset-bulk-skip">Skip All</button> ' +
          '<button class="btn btn-warning btn-sm' + (markCompleteMode ? ' active' : '') + '" id="reset-mark-complete-btn">' + (markCompleteMode ? 'Cancel Override' : 'Mark All as Complete') + '</button>' +
        '</div>' +
        '<div class="reset-wp-list">' + wpRowsHtml + '</div>' +
        '<div class="reset-modal-footer">' +
          '<div class="reset-summary" id="reset-summary">' + buildSummary() + '</div>' +
          '<div class="reset-modal-actions">' +
            '<button class="btn btn-secondary" id="reset-cancel-btn">Cancel</button> ' +
            '<button class="btn btn-primary" id="reset-apply-btn">' + (markCompleteMode ? 'Mark as Complete' : 'Apply Reset') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  var overlay = document.getElementById('reset-modal-overlay');

  function updateSummary() {
    var el = document.getElementById('reset-summary');
    if (el) el.textContent = buildSummary();
    var applyBtn = document.getElementById('reset-apply-btn');
    if (markCompleteMode) {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Mark as Complete';
      }
      return;
    }
    // Enable/disable apply button based on reset/cancel actions
    var hasAction = Object.keys(state).some(function (id) {
      return state[id].action === 'reset' || state[id].action === 'cancel';
    });
    if (applyBtn) {
      applyBtn.disabled = !hasAction;
      applyBtn.textContent = 'Apply Reset';
    }
  }

  function closeModal() {
    if (overlay) overlay.remove();
  }

  // Close button
  document.getElementById('reset-modal-close').addEventListener('click', closeModal);
  document.getElementById('reset-cancel-btn').addEventListener('click', closeModal);

  // Click overlay to close
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // Expand/collapse toggles
  overlay.querySelectorAll('.reset-wp-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var targetId = this.getAttribute('data-target');
      var detail = document.getElementById(targetId);
      var arrow = this.querySelector('.reset-wp-arrow');
      if (detail) {
        var isVisible = detail.style.display !== 'none';
        detail.style.display = isVisible ? 'none' : '';
        if (arrow) arrow.textContent = isVisible ? '\u25B6' : '\u25BC';
      }
    });
  });

  // Bulk controls
  document.getElementById('reset-bulk-broken').addEventListener('click', function () {
    wps.forEach(function (wp) {
      if (state[wp.work_package_id].isCancelled) return;
      state[wp.work_package_id].action = wp.needs_reset ? 'reset' : 'skip';
      state[wp.work_package_id].reset_criteria = wp.suggested_reset_criteria;
    });
    refreshRadios();
    updateSummary();
  });

  document.getElementById('reset-bulk-skip').addEventListener('click', function () {
    wps.forEach(function (wp) {
      if (state[wp.work_package_id].isCancelled) return;
      state[wp.work_package_id].action = 'skip';
    });
    refreshRadios();
    updateSummary();
  });

  document.getElementById('reset-mark-complete-btn').addEventListener('click', function () {
    markCompleteMode = !markCompleteMode;
    var btn = this;
    if (markCompleteMode) {
      btn.classList.add('active');
      btn.textContent = 'Cancel Override';
    } else {
      btn.classList.remove('active');
      btn.textContent = 'Mark All as Complete';
    }
    updateSummary();
  });

  function refreshRadios() {
    wps.forEach(function (wp) {
      var s = state[wp.work_package_id];
      if (s.isCancelled) return;
      var safeid = wp.work_package_id.replace(/[^a-zA-Z0-9-]/g, '_');
      var radios = document.querySelectorAll('input[name="action_' + safeid + '"]');
      radios.forEach(function (r) { r.checked = (r.value === s.action); });
      var criteriaRow = document.getElementById('criteria_' + safeid);
      if (criteriaRow) criteriaRow.style.display = s.action === 'reset' ? '' : 'none';
      var criteriaCb = document.getElementById('criteria_cb_' + safeid);
      if (criteriaCb) criteriaCb.checked = s.reset_criteria;
    });
  }

  // Wire up radio and checkbox change events
  wps.forEach(function (wp) {
    if (state[wp.work_package_id].isCancelled) return;
    var safeid = wp.work_package_id.replace(/[^a-zA-Z0-9-]/g, '_');

    var radios = document.querySelectorAll('input[name="action_' + safeid + '"]');
    radios.forEach(function (r) {
      r.addEventListener('change', function () {
        state[wp.work_package_id].action = this.value;
        var criteriaRow = document.getElementById('criteria_' + safeid);
        if (criteriaRow) criteriaRow.style.display = this.value === 'reset' ? '' : 'none';
        updateSummary();
      });
    });

    var criteriaCb = document.getElementById('criteria_cb_' + safeid);
    if (criteriaCb) {
      criteriaCb.addEventListener('change', function () {
        state[wp.work_package_id].reset_criteria = this.checked;
      });
    }
  });

  // Apply button
  document.getElementById('reset-apply-btn').addEventListener('click', function () {
    var applyBtn = this;
    applyBtn.disabled = true;

    if (markCompleteMode) {
      applyBtn.textContent = 'Marking…';
      API.markProjectComplete(repo, slug).then(function () {
        closeModal();
        var toast = document.createElement('div');
        toast.className = 'success-banner';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
        toast.textContent = 'Project marked as complete.';
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 4000);
        var app = document.getElementById('app');
        if (app) renderProjectDetail(app, repo, slug);
      }).catch(function (err) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Mark as Complete';
        var toast = document.createElement('div');
        toast.className = 'error-banner';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
        toast.textContent = 'Mark complete failed: ' + (err.message || String(err));
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 5000);
      });
      return;
    }

    applyBtn.textContent = 'Applying…';

    var decisions = {};
    Object.keys(state).forEach(function (id) {
      var s = state[id];
      if (s.isCancelled) return; // Don't include CANCELLED WPs in decisions
      decisions[id] = { action: s.action };
      if (s.action === 'reset') {
        decisions[id].reset_criteria = s.reset_criteria;
      }
    });

    API.applyProjectReset(repo, slug, decisions).then(function (result) {
      closeModal();
      // Show brief success toast
      var toast = document.createElement('div');
      toast.className = 'success-banner';
      toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
      toast.textContent = result.project_comment_added || 'Project reset applied successfully.';
      document.body.appendChild(toast);
      setTimeout(function () { toast.remove(); }, 4000);
      // Refresh the project view
      var app = document.getElementById('app');
      if (app) renderProjectDetail(app, repo, slug);
    }).catch(function (err) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Reset';
      var toast = document.createElement('div');
      toast.className = 'error-banner';
      toast.style.cssText = 'position:fixed;top:80px;right:24px;z-index:10001;max-width:400px;animation:fadeIn 0.2s';
      toast.textContent = 'Reset failed: ' + (err.message || String(err));
      document.body.appendChild(toast);
      setTimeout(function () { toast.remove(); }, 5000);
    });
  });

  updateSummary();
}

```
###  Path: `/mcp-server/gui/public/views/project-list.js`

```js
/* ============================================================
   views/project-list.js — Project List view
   Section 4a of the MCP Server Dashboard SPA
   Depends on: API, Router, escapeHtml, formatDate, statusBadge,
               showLoading, showError
   ============================================================ */

function renderProjectList(app) {
  showLoading(app);

  var SORT_KEY_STORAGE = 'mcp-sort-key';
  var SORT_DIR_STORAGE = 'mcp-sort-dir';
  var PAGE_LIMIT_STORAGE = 'mcp-page-limit';
  var STATUS_STORAGE = 'mcp-status-filter';
  var RUNNER_STORAGE = 'mcp-runner-filter';

  // --- Pagination / filter state (localStorage-persisted where noted) ---
  var currentPage = 1;
  var pageLimit = (function () {
    var v = parseInt(localStorage.getItem(PAGE_LIMIT_STORAGE), 10);
    return (!isNaN(v) && (v === 25 || v === 50 || v === 100)) ? v : 50;
  }());
  var currentStatus = localStorage.getItem(STATUS_STORAGE) || 'ACTIVE';
  var currentRunner = localStorage.getItem(RUNNER_STORAGE) || '';
  var currentSearch = '';
  var currentSort = localStorage.getItem(SORT_KEY_STORAGE) || 'last_updated';
  var currentDir = localStorage.getItem(SORT_DIR_STORAGE) || 'desc';

  var lastTotalPages = 1;
  var searchDebounceTimer = null;

  // ── Action menu (kebab dropdown) state ──
  var openMenuWrapper = null;

  // Create or reuse the shared menu portal (appended once to <body>)
  var menuPortal = (function () {
    var el = document.getElementById('action-menu-portal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'action-menu-portal';
      el.className = 'action-menu';
      el.setAttribute('role', 'menu');
      document.body.appendChild(el);
    }
    return el;
  }());

  function closeOpenMenu() {
    menuPortal.style.display = 'none';
    menuPortal.innerHTML = '';
    if (openMenuWrapper) {
      var trigger = openMenuWrapper.querySelector('.action-menu-btn');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      openMenuWrapper = null;
    }
  }

  // ── Runner display helpers ──

  var RUNNER_LABELS = {
    'vscode':       'VS Code',
    'claude-code':  'Claude Code',
    'orchestrator': 'Orchestrator',
    'unknown':      'Unknown',
  };

  function runnerLabel(runner) {
    return RUNNER_LABELS[runner] || (runner ? runner : '—');
  }

  function runnerBadge(runner) {
    var safeRunner = runner && runner !== 'unknown' ? runner : 'unknown';
    var label = RUNNER_LABELS[safeRunner] || (runner ? runner : 'Unknown');
    return '<span class="badge badge-runner badge-runner-' + escapeHtml(safeRunner) + '">' + escapeHtml(label) + '</span>';
  }

  // ── Build runner filter dropdown options ──
  // Only includes runner values that have at least one project (from runner_counts).
  // Preserves a canonical display order; runners not in runner_counts are omitted.
  // If currentRunner is set to a value absent from runner_counts (stale state),
  // it is included as a zero-count entry so the user can see and clear it.

  function buildRunnerOptions(runnerCounts) {
    var counts = runnerCounts || {};

    // Canonical ordering for display (determines option order in dropdown)
    var RUNNER_ORDER = ['orchestrator', 'vscode', 'claude-code', 'unknown'];

    // Collect runner values that have at least one project, in canonical order
    var activeRunners = RUNNER_ORDER.filter(function (r) {
      return counts[r] !== undefined && counts[r] > 0;
    });

    // Also include any non-canonical runner values that have projects
    Object.keys(counts).forEach(function (r) {
      if (counts[r] > 0 && RUNNER_ORDER.indexOf(r) === -1) {
        activeRunners.push(r);
      }
    });

    // If the current selection is stale (no longer in runner_counts), keep it
    // visible so the user can see and clear the filter, even with zero count.
    if (currentRunner && counts[currentRunner] === undefined) {
      activeRunners.push(currentRunner);
    }

    // Build <option> elements: "All" first, then one per active runner
    var allSel = currentRunner === '' ? ' selected' : '';
    var html = '<option value=""' + allSel + '>All</option>';

    activeRunners.forEach(function (r) {
      var label = RUNNER_LABELS[r] || r;
      var cnt = counts[r] !== undefined ? ' (' + counts[r] + ')' : '';
      var sel = r === currentRunner ? ' selected' : '';
      html += '<option value="' + escapeHtml(r) + '"' + sel + '>' + escapeHtml(label + cnt) + '</option>';
    });

    return html;
  }

  // ── Build table HTML (projects already sorted/filtered server-side) ──

  function buildTable(projects) {
    if (!projects.length) {
      return '<p class="text-muted mt-16">No projects found.</p>';
    }

    function thSort(label, key) {
      var isActive = currentSort === key;
      var cls = 'sortable' + (isActive ? ' sort-' + currentDir : '');
      var ariaSort = isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th class="' + cls + '" data-sort="' + key + '" aria-sort="' + ariaSort + '" tabindex="0" role="columnheader">' + label + '</th>';
    }

    var rows = projects.map(function (p) {
      var projectName = (p.project_name != null && p.project_name !== '') ? escapeHtml(p.project_name) : escapeHtml(p.slug);
      if (p.repository_name) {
        ProjectNameCache.set(makeProjectCacheKey(p.repository_name, p.slug), p.project_name || p.slug);
      }
      var doneCellHtml;
      if (p.total_work_packages > 0) {
        var pct = p.progress_pct != null ? p.progress_pct : 0;
        doneCellHtml = '<div class="progress-bar-track" title="' + pct + '%"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>';
      } else {
        doneCellHtml = '\u2014';
      }
      var wpCount = p.total_work_packages != null ? String(p.total_work_packages) : '\u2014';
      var repo = p.repository_name;
      var nameCell;
      if (repo) {
        nameCell = '<td><a href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(p.slug) + '" title="' + escapeHtml(p.slug) + '">' + projectName + '</a></td>';
      } else {
        console.warn('[project-list] project "' + p.slug + '" has no repository_name — rendering as read-only row');
        nameCell = '<td title="' + escapeHtml(p.slug) + '">' + projectName + '</td>';
      }
      return '<tr data-status="' + escapeHtml(p.status) + '" data-slug="' + escapeHtml(p.slug) + '">' +
        nameCell +
        '<td class="repo-col">' + escapeHtml(repo || '\u2014') + '</td>' +
        '<td class="num-col">' + wpCount + '</td>' +
        '<td>' + doneCellHtml + '</td>' +
        '<td>' + statusBadge(p.status) + '</td>' +
        '<td>' + runnerBadge(p.runner) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.date_created)) + '</td>' +
        '<td class="text-muted">' + escapeHtml(formatDate(p.last_updated)) + '</td>' +
        '<td>' +
          '<div class="action-menu-wrapper" data-slug="' + escapeHtml(p.slug) + '" data-repo="' + escapeHtml(repo || '') + '" data-status="' + escapeHtml(p.status) + '">' +
            '<button class="action-menu-btn" aria-haspopup="menu" aria-expanded="false" title="Actions">&#8942;</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrapper">' +
      '<table>' +
      '<thead><tr>' +
        thSort('Project', 'project') +
        thSort('Repository', 'repository') +
        thSort('WPs', 'total_work_packages') +
        thSort('% Done', 'done') +
        thSort('Status', 'status') +
        thSort('Runner', 'runner') +
        thSort('Created', 'date_created') +
        thSort('Updated', 'last_updated') +
        '<th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="projects-tbody">' + rows + '</tbody>' +
      '</table>' +
      '</div>';
  }

  // ── Build pagination controls ──

  function buildPagination(page, total_pages, total, limit) {
    var start = total === 0 ? 0 : Math.min((page - 1) * limit + 1, total);
    var end = Math.min(page * limit, total);
    var infoText = 'Showing ' + start + '\u2013' + end + ' of ' + total + ' project' + (total !== 1 ? 's' : '');
    var pageSizeSel =
      '<select id="page-size-sel" class="page-size-selector">' +
        '<option value="25"' + (limit === 25 ? ' selected' : '') + '>25</option>' +
        '<option value="50"' + (limit === 50 ? ' selected' : '') + '>50</option>' +
        '<option value="100"' + (limit === 100 ? ' selected' : '') + '>100</option>' +
      '</select>';

    var paginationBtns = '';
    if (total_pages > 1) {
      var buttons = [];
      buttons.push('<button class="pagination-btn" data-page="prev"' + (page === 1 ? ' disabled' : '') + '>\u2190 Prev</button>');

      // Show window of page numbers around current with ellipsis
      var windowSize = 2;
      var pagesSet = {};
      pagesSet[1] = true;
      pagesSet[total_pages] = true;
      for (var i = Math.max(1, page - windowSize); i <= Math.min(total_pages, page + windowSize); i++) {
        pagesSet[i] = true;
      }
      var pageArray = Object.keys(pagesSet).map(Number).sort(function (a, b) { return a - b; });
      var lastShown = 0;
      pageArray.forEach(function (pg) {
        if (lastShown > 0 && pg > lastShown + 1) {
          buttons.push('<span class="pagination-ellipsis">\u2026</span>');
        }
        buttons.push(
          '<button class="pagination-btn' + (pg === page ? ' active' : '') + '" data-page="' + pg + '">' + pg + '</button>'
        );
        lastShown = pg;
      });
      buttons.push('<button class="pagination-btn" data-page="next"' + (page === total_pages ? ' disabled' : '') + '>Next \u2192</button>');
      paginationBtns = '<div class="pagination">' + buttons.join('') + '</div>';
    }

    return '<div class="pagination-row">' +
      '<div class="pagination-info">' + infoText + '</div>' +
      paginationBtns +
      '<div class="page-size-row">Per page: ' + pageSizeSel + '</div>' +
      '</div>';
  }

  // ── Build status filter dropdown with counts ──

  function buildStatusOptions(statusCounts) {
    var opts = [
      { value: 'ACTIVE',      label: 'Active' },
      { value: 'ALL',         label: 'All' },
      { value: 'READY',       label: 'Ready' },
      { value: 'IN_PROGRESS', label: 'In Progress' },
      { value: 'COMPLETE',    label: 'Complete' },
      { value: 'BLOCKED',     label: 'Blocked' },
      { value: 'ARCHIVED',    label: 'Archived' },
    ];
    return opts.map(function (o) {
      var cnt = (o.value !== 'ACTIVE' && o.value !== 'ALL' && statusCounts && statusCounts[o.value] !== undefined)
        ? ' (' + statusCounts[o.value] + ')'
        : '';
      var sel = o.value === currentStatus ? ' selected' : '';
      return '<option value="' + o.value + '"' + sel + '>' + escapeHtml(o.label + cnt) + '</option>';
    }).join('');
  }

  // ── Main render ──

  function render(envelope) {
    lastTotalPages = envelope.total_pages;
    var projects = envelope.projects;
    var statusCounts = envelope.status_counts || {};
    var runnerCounts = envelope.runner_counts || {};

    // Preserve search input focus state across DOM rebuild
    var searchHadFocus = false;
    var searchSelStart = 0;
    var searchSelEnd = 0;
    var prevSearchEl = document.getElementById('project-search');
    if (prevSearchEl && document.activeElement === prevSearchEl) {
      searchHadFocus = true;
      searchSelStart = prevSearchEl.selectionStart || 0;
      searchSelEnd = prevSearchEl.selectionEnd || 0;
    }

    app.innerHTML =
      '<div class="page-header">' +
        '<h1>Projects</h1>' +
        '<div class="filter-actions">' +
          '<button class="btn btn-secondary btn-sm" id="refresh-btn">\u21bb Refresh</button>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<input type="text" id="project-search" placeholder="Search projects\u2026" value="' + escapeHtml(currentSearch) + '">' +
        '<label for="status-filter">Status:</label>' +
        '<select id="status-filter">' + buildStatusOptions(statusCounts) + '</select>' +
        '<label for="runner-filter">Runner:</label>' +
        '<select id="runner-filter">' + buildRunnerOptions(runnerCounts) + '</select>' +
      '</div>' +
      buildTable(projects) +
      buildPagination(envelope.page, envelope.total_pages, envelope.total, envelope.limit);

    // Any previously open menu is now invalid (DOM was recreated)
    openMenuWrapper = null;

    // Sort column headers
    var projectsTbody = document.getElementById('projects-tbody');
    var thead = projectsTbody
      ? projectsTbody.closest('table').querySelector('thead')
      : null;
    if (thead) {
      function handleSortAction(e) {
        var th = e.target.closest('th[data-sort]');
        if (!th) return;
        var key = th.getAttribute('data-sort');
        if (currentSort === key) {
          currentDir = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort = key;
          currentDir = (key === 'date_created' || key === 'last_updated') ? 'desc' : 'asc';
        }
        localStorage.setItem(SORT_KEY_STORAGE, currentSort);
        localStorage.setItem(SORT_DIR_STORAGE, currentDir);
        currentPage = 1;
        load();
      }
      thead.addEventListener('click', handleSortAction);
      thead.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.key === ' ') e.preventDefault();
        handleSortAction(e);
      });
    }

    // Status filter
    var filterEl = document.getElementById('status-filter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        currentStatus = this.value;
        localStorage.setItem(STATUS_STORAGE, currentStatus);
        currentPage = 1;
        load();
      });
    }

    // Runner filter
    var runnerFilterEl = document.getElementById('runner-filter');
    if (runnerFilterEl) {
      runnerFilterEl.addEventListener('change', function () {
        currentRunner = this.value;
        localStorage.setItem(RUNNER_STORAGE, currentRunner);
        currentPage = 1;
        load();
      });
    }

    // Search with 300ms debounce
    var searchEl = document.getElementById('project-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var val = this.value;
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          currentSearch = val;
          currentPage = 1;
          load();
        }, 300);
      });

      // Restore focus and cursor position if search was active before re-render
      if (searchHadFocus) {
        searchEl.focus();
        searchEl.setSelectionRange(searchSelStart, searchSelEnd);
      }
    }

    // Pagination buttons
    app.querySelectorAll('.pagination-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        var p = this.getAttribute('data-page');
        if (p === 'prev') {
          currentPage = Math.max(1, currentPage - 1);
        } else if (p === 'next') {
          currentPage = Math.min(lastTotalPages, currentPage + 1);
        } else {
          currentPage = parseInt(p, 10);
        }
        load();
      });
    });

    // Page size selector
    var pageSizeSel = document.getElementById('page-size-sel');
    if (pageSizeSel) {
      pageSizeSel.addEventListener('change', function () {
        pageLimit = parseInt(this.value, 10);
        localStorage.setItem(PAGE_LIMIT_STORAGE, String(pageLimit));
        currentPage = 1;
        load();
      });
    }

    // Kebab (⋮) trigger handlers — populate and position the body portal
    app.querySelectorAll('.action-menu-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wrapper = btn.closest('.action-menu-wrapper');
        if (!wrapper) return;
        if (openMenuWrapper && openMenuWrapper === wrapper) {
          closeOpenMenu();
          return;
        }
        if (openMenuWrapper) closeOpenMenu();

        var slug = wrapper.getAttribute('data-slug');
        var repo = wrapper.getAttribute('data-repo');
        var status = wrapper.getAttribute('data-status');
        var viewHtml = repo
          ? '<a class="action-menu-item" role="menuitem" href="#/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '">View</a>'
          : '';
        var archiveHtml = status !== 'ARCHIVED'
          ? '<button class="action-menu-item" role="menuitem" data-portal-action="archive" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Archive</button>'
          : '';
        var unarchiveHtml = status === 'ARCHIVED'
          ? '<button class="action-menu-item" role="menuitem" data-portal-action="unarchive" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Unarchive</button>'
          : '';

        menuPortal.innerHTML =
          viewHtml +
          archiveHtml +
          unarchiveHtml +
          '<button class="action-menu-item danger" role="menuitem" data-portal-action="delete" data-slug="' + escapeHtml(slug) + '" data-repo="' + escapeHtml(repo || '') + '">Delete</button>';

        menuPortal.style.display = 'block';
        var btnRect = btn.getBoundingClientRect();
        var menuH = menuPortal.offsetHeight;
        if (window.innerHeight - btnRect.bottom < menuH + 4) {
          menuPortal.style.top = (btnRect.top - menuH - 4) + 'px';
        } else {
          menuPortal.style.top = (btnRect.bottom + 4) + 'px';
        }
        menuPortal.style.right = (window.innerWidth - btnRect.right) + 'px';
        menuPortal.style.left = 'auto';

        btn.setAttribute('aria-expanded', 'true');
        openMenuWrapper = wrapper;
      });
    });

    // Close-on-outside-click (registered once per session)
    if (!document._projectListDocHandlerInstalled) {
      document._projectListDocHandlerInstalled = true;
      document.addEventListener('mousedown', function (e) {
        if (!e.target.closest('.action-menu-wrapper') && !e.target.closest('#action-menu-portal')) {
          closeOpenMenu();
        }
      });
    }

    // Close-on-scroll (registered to the table wrapper each render)
    var tableWrapper = app.querySelector('.table-wrapper');
    if (tableWrapper) {
      tableWrapper.addEventListener('scroll', function () {
        closeOpenMenu();
      });
    }

    // Portal action handler (delete / archive / unarchive) — registered once
    if (!menuPortal._handlerInstalled) {
      menuPortal._handlerInstalled = true;
      menuPortal.addEventListener('click', function (e) {
        var item = e.target.closest('[data-portal-action]');
        if (!item) return;
        var action = item.getAttribute('data-portal-action');
        var slug = item.getAttribute('data-slug');
        var repo = item.getAttribute('data-repo');
        closeOpenMenu();
        if (!repo) {
          // Null-repo projects should not reach action handlers (no View link, action buttons
          // still render for archive/delete). Log silently rather than disrupting the operator.
          console.error('[project-list] action "' + action + '" skipped: project "' + slug + '" has no repository_name.');
          return;
        }
        if (action === 'delete') {
          if (!confirm('Permanently delete project "' + slug + '"? This cannot be undone.')) return;
          API.deleteProject(repo, slug).then(function () { currentPage = 1; load(); })
            .catch(function (err) { alert('Delete failed: ' + (err.message || String(err))); });
        } else if (action === 'archive') {
          if (!confirm('Archive project "' + slug + '"? It will be hidden from the active list but remain accessible.')) return;
          API.archiveProject(repo, slug).then(function () { load(); })
            .catch(function (err) { alert('Archive failed: ' + (err.message || String(err))); });
        } else if (action === 'unarchive') {
          API.unarchiveProject(repo, slug).then(function () { load(); })
            .catch(function (err) { alert('Unarchive failed: ' + (err.message || String(err))); });
        }
      });
    }

    // Manual refresh
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        currentPage = 1;
        load();
      });
    }
  }

  function load() {
    API.getProjects({
      page: currentPage,
      limit: pageLimit,
      status: currentStatus,
      search: currentSearch,
      sort: currentSort,
      dir: currentDir,
      runner: currentRunner || undefined,
    }).then(function (envelope) {
      render(envelope);
    }).catch(function (err) {
      showError(app, 'Failed to load projects: ' + (err.message || String(err)));
    });
  }

  // Initial load
  load();

  // Auto-refresh every 10 seconds — current page only
  Router._setPolling(load, 10000);
}

```
###  Path: `/mcp-server/gui/public/views/run-log.js`

```js
/* ============================================================
   views/run-log.js — Orchestrator Run Log Viewer
   Section 4e of the MCP Server Dashboard SPA

   Depends on: API, Router, escapeHtml, formatDate, showLoading, showError
   ============================================================ */

/* ----------------------------------------------------------
   Event card renderers
   ---------------------------------------------------------- */

/**
 * Returns a CSS severity class for an event action type.
 *
 * - error / fail actions → run-event--error
 * - warning-ish          → run-event--warning
 * - success outcomes     → run-event--success
 * - default              → run-event--info
 */
function runEventSeverity(action) {
  if (action === 'run_error' || action === 'stage_error' || action === 'halted_repeated_failure') return 'run-event--error';
  if (action === 'safety_limit' || action === 'rework_detected' || action === 'mcp_error' || action === 'dry_run_no_ledger') return 'run-event--warning';
  if (action === 'wp_complete' || action === 'run_end' || action === 'dry_run_complete') return 'run-event--success';
  if (action === 'tool_call') return 'run-event--debug';
  return 'run-event--info';
}

/**
 * Formats a duration in seconds to a human-readable string.
 * @param {number|null|undefined} sec - Duration in seconds.
 * @returns {string} Formatted string (e.g. "3m 24s") or empty string.
 */
function formatDurationSec(sec) {
  if (sec == null || isNaN(sec)) return '';
  return formatDuration(sec * 1000);
}

/**
 * Formats a token count to a compact human-readable string (e.g. "72k").
 * @param {object|number|null} tokens - Token usage object or raw number.
 * @returns {string} Formatted string or empty string.
 */
function formatTokens(tokens) {
  if (tokens == null) return '';
  var total = typeof tokens === 'number' ? tokens : (tokens.total_tokens || 0);
  if (!total) return '';
  if (total >= 1000) return Math.round(total / 1000) + 'k tokens';
  return total + ' tokens';
}

/**
 * Builds the inner content HTML for a single event entry.
 * Handles known action types explicitly; falls back to a generic card.
 *
 * @param {object} entry - A parsed log entry object.
 * @returns {string} HTML string for the card body.
 */
function buildRunEventContent(entry) {
  const action = entry && entry.action ? String(entry.action) : 'unknown';

  switch (action) {

    // ── Orchestrator lifecycle ───────────────────────────────────────
    case 'run_start': {
      const threadId = entry.thread_id ? escapeHtml(String(entry.thread_id)) : '';
      const plan = entry.plan ? String(entry.plan) : '';
      // Show just the plan filename, not the full path
      const planName = plan ? escapeHtml(plan.split('/').pop() || plan) : '';
      const dryRunBadge = entry.dry_run ? ' <span class="badge badge-dry-run">Dry Run</span>' : '';
      let html = '<strong>Run started</strong>' + dryRunBadge;
      if (planName) html += ' &mdash; ' + planName;
      if (threadId) html += '<br><span class="text-muted monospace" style="font-size:11px">Thread: ' + threadId + '</span>';
      return html;
    }
    case 'run_end': {
      const dur = entry.total_duration_s != null ? formatDurationSec(entry.total_duration_s) : '';
      return '<strong>Run completed</strong>' + (dur ? ' <span class="text-muted">(' + escapeHtml(dur) + ')</span>' : '');
    }
    case 'run_error': {
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown error';
      return '<strong>Run error:</strong> ' + errMsg;
    }

    // ── Stage events ─────────────────────────────────────────────────
    case 'stage_start': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const stg = entry.stage ? escapeHtml(String(entry.stage).replace(/_/g, ' ')) : '';
      const iter = entry.iteration ? ' <span class="text-muted">(iteration ' + escapeHtml(String(entry.iteration)) + ')</span>' : '';
      return '<strong>Stage started</strong>' +
        (stg ? ' &mdash; <em>' + stg + '</em>' : '') +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        iter;
    }
    case 'stage_complete': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const result = entry.result ? escapeHtml(String(entry.result)) : '';
      const dur = formatDurationSec(entry.duration_s);
      const tok = formatTokens(entry.tokens_used);
      const details = [];
      if (dur) details.push(dur);
      if (tok) details.push(tok);
      const resultClass = result === 'PASS' ? 'badge badge-pass' : (result === 'FAIL' ? 'badge badge-fail' : 'badge badge-neutral');
      return '<strong>Stage complete</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (result ? ' <span class="' + resultClass + '">' + result + '</span>' : '') +
        (details.length ? ' <span class="text-muted">(' + escapeHtml(details.join(', ')) + ')</span>' : '');
    }
    case 'stage_error': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown error';
      const dur = formatDurationSec(entry.duration_s);
      return '<strong>Stage failed</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        ' &mdash; ' + errMsg +
        (dur ? ' <span class="text-muted">(' + escapeHtml(dur) + ')</span>' : '');
    }

    // ── Pipeline result ──────────────────────────────────────────────
    case 'pipeline_result': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const pType = entry.pipeline_type ? escapeHtml(String(entry.pipeline_type)) : '';
      const pStatus = entry.pipeline_status || entry.result || '';
      const files = Array.isArray(entry.files_modified) ? entry.files_modified : [];
      const metrics = entry.metrics || {};
      const summaryArr = Array.isArray(entry.summary) ? entry.summary : [];
      const dur = formatDurationSec(entry.duration_s);

      const statusClass = pStatus === 'PASS' ? 'badge badge-pass' : (pStatus === 'FAIL' ? 'badge badge-fail' : 'badge badge-neutral');
      let html = '<strong>Pipeline result</strong>';
      if (pType) html += ' &mdash; <em>' + pType + '</em>';
      if (wpId) html += ' for <strong>' + wpId + '</strong>';
      if (pStatus) html += ' <span class="' + statusClass + '">' + escapeHtml(pStatus) + '</span>';

      // Details line
      const detailBits = [];
      if (files.length) detailBits.push(files.length + ' file' + (files.length !== 1 ? 's' : '') + ' modified');
      if (metrics.tests_passed != null) detailBits.push(metrics.tests_passed + ' tests passed');
      if (metrics.tests_failed) detailBits.push(metrics.tests_failed + ' tests failed');
      if (dur) detailBits.push(dur);
      if (detailBits.length) html += '<br><span class="text-muted">' + escapeHtml(detailBits.join(' \u00b7 ')) + '</span>';

      // File list (collapsed)
      if (files.length) {
        html += '<br><span class="text-muted" style="font-size:11px">' +
          files.map(function(f) { return escapeHtml(String(f)); }).join(', ') +
          '</span>';
      }

      // Summary text
      if (summaryArr.length) {
        html += '<div class="run-event-summary">' +
          summaryArr.map(function(s) { return '<p>' + escapeHtml(String(s)) + '</p>'; }).join('') +
          '</div>';
      }

      return html;
    }

    // ── Supervisor routing & status ──────────────────────────────────
    case 'route': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const dest = entry.destination ? escapeHtml(String(entry.destination).replace(/_/g, ' ')) : '';
      const role = entry.agent_role ? escapeHtml(String(entry.agent_role)) : '';
      const ledgerAction = entry.ledger_action ? escapeHtml(String(entry.ledger_action).replace(/_/g, ' ')) : '';
      const reason = entry.reason ? escapeHtml(String(entry.reason)) : '';
      let html = '<strong>Routing</strong>';
      if (wpId) html += ' <strong>' + wpId + '</strong>';
      if (dest) html += ' \u2192 <em>' + dest + '</em>';
      if (role) html += ' <span class="text-muted">(' + role + ')</span>';
      if (ledgerAction) html += '<br><span class="text-muted" style="font-size:11px">Action: ' + ledgerAction + '</span>';
      if (reason) html += '<br><span class="text-muted" style="font-size:11px">' + reason + '</span>';
      return html;
    }
    case 'wp_status_change': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const oldSt = entry.old_status ? escapeHtml(String(entry.old_status)) : '?';
      const newSt = entry.new_status ? escapeHtml(String(entry.new_status)) : '?';
      return '<strong>' + wpId + '</strong> status: ' +
        '<span class="badge badge-neutral">' + oldSt + '</span>' +
        ' \u2192 ' +
        '<span class="badge badge-neutral">' + newSt + '</span>';
    }
    case 'wp_complete': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      return '\u2713 <strong>' + wpId + '</strong> completed';
    }
    case 'rework_detected': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const count = entry.rework_count != null ? String(entry.rework_count) : '?';
      const pType = entry.pipeline_type ? escapeHtml(String(entry.pipeline_type)) : '';
      const role = entry.agent_role ? escapeHtml(String(entry.agent_role)) : '';
      return '\u21bb <strong>' + wpId + '</strong> rework #' + escapeHtml(count) +
        (pType && role ? ' <span class="text-muted">(' + pType + ' \u2192 ' + role + ')</span>' : '');
    }

    // ── Safety & errors ──────────────────────────────────────────────
    case 'fatal_error': {
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown fatal error';
      return '<strong>Fatal error — run terminated:</strong> ' + errMsg;
    }
    case 'safety_limit': {
      const iter = entry.iteration ? escapeHtml(String(entry.iteration)) : '?';
      return '<strong>Safety limit reached</strong> at iteration ' + iter;
    }
    case 'halted_repeated_failure': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const count = entry.consecutive_failures != null ? String(entry.consecutive_failures) : '?';
      return '<strong>' + wpId + '</strong> halted after ' + escapeHtml(count) + ' consecutive failures';
    }
    case 'mcp_error': {
      const errMsg = entry.error ? escapeHtml(String(entry.error)) : 'Unknown MCP error';
      return '<strong>MCP error:</strong> ' + errMsg;
    }

    // ── Heartbeat ────────────────────────────────────────────────────
    case 'heartbeat': {
      const silence = entry.silence_s != null ? formatDurationSec(entry.silence_s) : '';
      return '\u2665 <strong>Alive</strong>' + (silence ? ' <span class="text-muted">(quiet for ' + escapeHtml(silence) + ')</span>' : '');
    }

    // ── Dialogue capture ─────────────────────────────────────────────
    case 'dialogue_captured': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const filePath = entry.file_path ? String(entry.file_path) : '';
      const fileName = filePath ? escapeHtml(filePath.split('/').pop() || filePath) : '';
      return '<strong>Dialogue saved</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (fileName ? ' &mdash; <span class="text-muted monospace" style="font-size:11px">' + fileName + '</span>' : '');
    }

    // ── Progress snapshot (rendered as card fallback if progress bar not used) ──
    case 'progress_snapshot': {
      const total = entry.total_wps || 0;
      const breakdown = entry.status_breakdown || {};
      const completed = breakdown.COMPLETE || 0;
      const pending = entry.pending || 0;
      return '<strong>Progress:</strong> ' + completed + '/' + total + ' WPs done, ' + pending + ' pending';
    }

    // ── Dry-run actions ──────────────────────────────────────────────
    case 'dry_run': {
      const wpId = entry.wp_id ? escapeHtml(String(entry.wp_id)) : '';
      const stg = entry.stage ? escapeHtml(String(entry.stage).replace(/_/g, ' ')) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>Stage skipped</strong>' +
        (wpId ? ' for <strong>' + wpId + '</strong>' : '') +
        (stg ? ' &mdash; <em>' + stg + '</em>' : '');
    }
    case 'dry_run_no_ledger': {
      const detail = entry.detail ? escapeHtml(String(entry.detail)) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>No ledger</strong>' +
        (detail ? ' &mdash; <span class="text-muted">' + detail + '</span>' : '');
    }
    case 'dry_run_complete': {
      const reason = entry.reason ? escapeHtml(String(entry.reason)) : '';
      return '<span class="badge badge-dry-run">Dry Run</span> <strong>Dry run complete</strong>' +
        (reason ? ' &mdash; <span class="text-muted">' + reason + '</span>' : '');
    }

    // ── MCP tool call (DEBUG level, high-frequency) ──────────────────
    case 'tool_call': {
      const toolName = entry.tool_name ? escapeHtml(String(entry.tool_name)) : '\u2014';
      // Strip the common "ledger_" prefix for brevity; keep it otherwise
      const displayName = toolName.startsWith('ledger_') ? toolName.slice(7) : toolName;
      const toolWpId = entry.tool_wp_id ? String(entry.tool_wp_id) : '';
      const stageWpId = entry.wp_id ? String(entry.wp_id) : '';

      // Flag cross-WP calls: tool_wp_id targets a different WP than the current stage WP
      const isCrossWp = toolWpId && stageWpId && toolWpId !== stageWpId;

      let html = '<span class="text-muted" style="font-size:11px;margin-right:4px">&#9881; tool</span>' +
        '<span class="monospace" style="font-size:12px">' + displayName + '</span>';
      if (isCrossWp) {
        html += ' <span class="badge badge-fail" title="Tool targeted ' + escapeHtml(toolWpId) + ' but stage is running ' + escapeHtml(stageWpId) + '">&#9888; cross-WP: ' + escapeHtml(toolWpId) + '</span>';
      } else if (toolWpId && toolWpId !== stageWpId) {
        // tool_wp_id present but stageWpId is empty (e.g. PM stage)
        html += ' <span class="text-muted" style="font-size:11px">WP: ' + escapeHtml(toolWpId) + '</span>';
      }
      return html;
    }

    // ── Legacy / generic events ──────────────────────────────────────
    case 'step_start':
    case 'step_end': {
      const stepName = entry.step_name ? escapeHtml(String(entry.step_name)) : '\u2014';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + stepName;
    }
    case 'llm_call_start':
    case 'llm_call_end': {
      const model = entry.model ? escapeHtml(String(entry.model)) : '';
      return '<strong>' + escapeHtml(action) + '</strong>' + (model ? ' &mdash; <span class="text-muted">' + model + '</span>' : '');
    }
    case 'tool_call_start':
    case 'tool_call_end': {
      const toolName = entry.tool_name ? escapeHtml(String(entry.tool_name)) : '\u2014';
      return '<strong>' + escapeHtml(action) + ':</strong> ' + toolName;
    }

    default: {
      // Generic fallback — shows raw action + any message/error/reason field
      let genericMsg = entry.message ? ': ' + escapeHtml(String(entry.message)) : '';
      if (!genericMsg && entry.error) genericMsg = ': ' + escapeHtml(String(entry.error));
      if (!genericMsg && entry.reason) genericMsg = ': ' + escapeHtml(String(entry.reason));
      return '<strong>' + escapeHtml(action) + '</strong>' + genericMsg;
    }
  }
}

/**
 * Builds the full HTML for a single run event card.
 *
 * @param {object} entry - A parsed log entry.
 * @returns {string} HTML string.
 */
function buildRunEventCard(entry) {
  var action = entry && entry.action ? String(entry.action) : 'unknown';
  var severityClass = runEventSeverity(action);

  // Stage badge — use entry.stage or entry.action as fallback label
  var stageLabel = entry.stage
    ? escapeHtml(String(entry.stage).replace(/_/g, ' '))
    : escapeHtml(action.replace(/_/g, ' '));
  var stageBadge = '<span class="run-stage-badge">' + stageLabel + '</span>';

  // WP ID badge (when present)
  var wpBadge = '';
  if (entry.wp_id) {
    wpBadge = '<span class="run-wp-badge">' + escapeHtml(String(entry.wp_id)) + '</span>';
  }

  // Timestamp
  var ts = entry.timestamp ? escapeHtml(formatDate(String(entry.timestamp))) : '';

  return '<div class="run-event ' + severityClass + '">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
      stageBadge +
      wpBadge +
      (ts ? '<span class="text-muted" style="font-size:11px">' + ts + '</span>' : '') +
    '</div>' +
    '<div>' + buildRunEventContent(entry) + '</div>' +
  '</div>';
}

/* ----------------------------------------------------------
   Main view
   ---------------------------------------------------------- */

/**
 * Renders the orchestrator run log viewer for a specific log file.
 *
 * Fetches all entries on load, then polls every 5 s for new entries using
 * the incremental `?after=N` parameter. Polling stops automatically when a
 * `run_end` or `run_error` entry is encountered.
 *
 * Both `repo` and `slug` are required for multi-root workspace support: they
 * are passed through to every `API.getRunLogEntries(repo, slug, filename,
 * afterLine)` call so the server can resolve the correct namespaced project
 * store. In a single-root workspace `repo` is typically an empty string, but
 * must still be supplied — this is why the signature changed from the legacy
 * two-argument `(app, filename)` form.
 *
 * @param {HTMLElement} app      - The main content container.
 * @param {string}      repo     - Repository namespace (may be empty string for
 *                                 single-root workspaces; must not be omitted).
 * @param {string}      slug     - Project slug.
 * @param {string}      filename - Log filename (e.g. "20260225T113355-my-project.jsonl").
 */
function renderRunLog(app, repo, slug, filename) {
  showLoading(app);

  // Track how many lines we have seen (used as `afterLine` for incremental fetches)
  var totalLinesSeen = 0;

  // Whether polling should continue
  var pollingActive = true;

  /**
   * Builds the page skeleton (breadcrumb + progress bar + timeline container).
   * Called once on initial load; subsequent updates only touch inner elements.
   */
  function buildPageShell() {
    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf('Run Log').html() +
      '<div class="page-header"><h1 style="font-size:16px;font-weight:600">' +
        escapeHtml(filename) +
      '</h1></div>' +
      '<div id="run-progress-container" style="margin-bottom:16px;display:none">' +
        '<div class="run-progress-track">' +
          '<div class="run-progress-bar" id="run-progress-bar-fill" style="width:0%"></div>' +
        '</div>' +
      '</div>' +
      '<div id="run-event-timeline"></div>' +
      '<div id="run-status-message"></div>';
  }

  /**
   * Appends new event cards to the timeline. Updates progress bar in-place
   * for `progress_snapshot` entries instead of appending a card.
   *
   * @param {unknown[]} entries - New log entries to render.
   * @returns {boolean} True if a terminal event (run_end / run_error) was found.
   */
  function appendEntries(entries) {
    var timeline = document.getElementById('run-event-timeline');
    if (!timeline) return false;

    var terminal = false;
    entries.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var action = entry.action ? String(entry.action) : 'unknown';

      if (action === 'progress_snapshot') {
        // Calculate progress from status_breakdown (completed / total WPs)
        var total = entry.total_wps || 0;
        var breakdown = entry.status_breakdown || {};
        var completed = (breakdown.COMPLETE || 0) + (breakdown.CANCELLED || 0);
        var pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : (entry.progress_pct != null ? Math.min(100, Math.max(0, Number(entry.progress_pct))) : null);
        var container = document.getElementById('run-progress-container');
        var fill = document.getElementById('run-progress-bar-fill');
        if (container && pct !== null) {
          container.style.display = '';
          if (fill) {
            fill.style.width = pct + '%';
            fill.title = completed + '/' + total + ' WPs done (' + pct + '%)';
          }
        }
        return; // Don't append a card for progress_snapshot
      }

      // Append an event card
      timeline.insertAdjacentHTML('beforeend', buildRunEventCard(entry));

      if (action === 'run_end' || action === 'run_error') {
        terminal = true;
      }
    });

    return terminal;
  }

  /**
   * Fetches entries after `afterLine` and processes them.
   * Stops polling if a terminal event is encountered.
   *
   * @param {number} afterLine - Number of lines already seen.
   */
  function fetchAndAppend(afterLine) {
    API.getRunLogEntries(repo, slug, filename, afterLine).then(function (result) {
      if (!result) return;
      var entries = Array.isArray(result.entries) ? result.entries : [];
      var newTotal = typeof result.totalLines === 'number' ? result.totalLines : totalLinesSeen;

      // Update cursor
      totalLinesSeen = newTotal;

      if (entries.length === 0) return;

      var isTerminal = appendEntries(entries);
      if (isTerminal && pollingActive) {
        pollingActive = false;
        Router._clearPolling();
        var statusEl = document.getElementById('run-status-message');
        if (statusEl) {
          statusEl.innerHTML = '<p class="text-muted" style="margin-top:8px;font-size:12px">\u2022 Run complete.</p>';
        }
      }
    }).catch(function (err) {
      // Non-fatal: log to stderr equivalent and continue polling
      var statusEl = document.getElementById('run-status-message');
      if (statusEl) {
        statusEl.innerHTML =
          '<p class="error-banner" style="margin-top:8px">Failed to fetch new entries: ' +
          escapeHtml((err && err.message) || String(err)) + '</p>';
      }
    });
  }

  // Initial load — fetch all entries
  API.getRunLogEntries(repo, slug, filename).then(function (result) {
    if (!result) {
      showError(app, 'Failed to load run log: empty response');
      return;
    }

    buildPageShell();

    var entries = Array.isArray(result.entries) ? result.entries : [];
    totalLinesSeen = typeof result.totalLines === 'number' ? result.totalLines : 0;

    if (entries.length === 0) {
      var timeline = document.getElementById('run-event-timeline');
      if (timeline) timeline.innerHTML = '<p class="text-muted">No events yet.</p>';
    } else {
      var isTerminal = appendEntries(entries);
      if (isTerminal) {
        pollingActive = false;
        var statusEl = document.getElementById('run-status-message');
        if (statusEl) {
          statusEl.innerHTML = '<p class="text-muted" style="margin-top:8px;font-size:12px">\u2022 Run complete.</p>';
        }
      }
    }

    // Start polling only if the run is not already complete (AC4)
    if (pollingActive) {
      Router._setPolling(function () {
        if (!pollingActive) return;
        fetchAndAppend(totalLinesSeen);
      }, 5000);
    }

  }).catch(function (err) {
    showError(app, 'Failed to load run log: ' + ((err && err.message) || String(err)));
  });
}

```
###  Path: `/mcp-server/gui/public/views/work-package.js`

```js
/* ============================================================
   views/work-package.js — Work Package Detail view
   Section 4c of the MCP Server Dashboard SPA
   Depends on: API, escapeHtml, formatDate, statusBadge,
               showLoading, showError, STAGE_ABBREV (project-detail.js)
   ============================================================ */

var WP_DEFAULT_STAGES = ['implementation', 'qa', 'code-review', 'documentation'];

function buildWpDetailBar(wp) {
  var rawStages = (wp.active_pipeline_stages && wp.active_pipeline_stages.length)
    ? wp.active_pipeline_stages
    : (wp.default_pipeline_stages && wp.default_pipeline_stages.length)
      ? wp.default_pipeline_stages
      : WP_DEFAULT_STAGES;

  // Build a fast lookup from pipeline type → latest pipeline status
  var latestStatus = {};
  var pipelineCountByType = {};
  (wp.pipelines || []).forEach(function (p) {
    var t = p.type;
    pipelineCountByType[t] = (pipelineCountByType[t] || 0) + 1;
    // Last write wins — pipelines are in chronological order
    latestStatus[t] = (p.status || '').toLowerCase();
  });

  var badges = rawStages.map(function (stageType) {
    var abbrev = (typeof STAGE_ABBREV !== 'undefined' && STAGE_ABBREV[stageType])
      ? STAGE_ABBREV[stageType]
      : stageType.slice(0, 3).toUpperCase();
    var rawSt = latestStatus[stageType] || 'pending';
    var statusClass = 'stage-pending';
    if (rawSt === 'in_progress' || rawSt === 'in-progress') statusClass = 'stage-in-progress';
    else if (rawSt === 'pass')                               statusClass = 'stage-pass';
    else if (rawSt === 'fail')                               statusClass = 'stage-fail';

    var reworkCount = wp.rework_counts ? (wp.rework_counts[stageType] || 0) : 0;
    if (!reworkCount && pipelineCountByType[stageType] > 1) {
      reworkCount = pipelineCountByType[stageType] - 1;
    }
    var tooltip = escapeHtml(stageType);
    if (rawSt !== 'pending') tooltip += ' — ' + escapeHtml(rawSt);
    if (reworkCount > 0)     tooltip += ' (rework: ' + reworkCount + ')';
    var reworkBadge = reworkCount > 0
      ? '<span class="rework-indicator" title="Rework count: ' + reworkCount + '">' + reworkCount + '</span>'
      : '';
    return '<span class="stage-badge ' + statusClass + '" title="' + tooltip + '">' +
      escapeHtml(abbrev) + reworkBadge +
    '</span>';
  }).join('');

  return '<div class="card">' +
    '<div class="card-title" style="margin-bottom:8px">Pipeline Progression</div>' +
    '<div class="pipeline-track">' + badges + '</div>' +
  '</div>';
}

function renderWorkPackageDetail(app, repo, slug, wpId) {
  showLoading(app);

  API.getWorkPackage(repo, slug, wpId).then(function (wp) {
    // Acceptance criteria
    var acHtml = (wp.acceptance_criteria || []).map(function (ac) {
      var met = ac.met === true;
      return '<li>' +
        '<span class="ac-icon ' + (met ? 'ac-met' : 'ac-unmet') + '">' + (met ? '✓' : '○') + '</span>' +
        '<span>' + escapeHtml(ac.criterion) + '</span>' +
      '</li>';
    }).join('');

    // WP aggregate timing
    var totalActiveMs = 0;
    var hasDurationData = false;
    var firstStartAt = null;
    var lastCompletedAt = null;
    (wp.pipelines || []).forEach(function (p) {
      if (p.duration_ms != null) {
        totalActiveMs += p.duration_ms;
        hasDurationData = true;
      }
      if (p.started_at) {
        var tsStart = new Date(p.started_at).getTime();
        if (!isNaN(tsStart) && (firstStartAt === null || tsStart < firstStartAt)) firstStartAt = tsStart;
      }
      if (p.completed_at) {
        var tsEnd = new Date(p.completed_at).getTime();
        if (!isNaN(tsEnd) && (lastCompletedAt === null || tsEnd > lastCompletedAt)) lastCompletedAt = tsEnd;
      }
    });
    var wallClockMs = (firstStartAt !== null && lastCompletedAt !== null) ? (lastCompletedAt - firstStartAt) : null;
    var wpTimingHtml = (hasDurationData || wallClockMs !== null)
      ? '<div class="wp-timing">' +
          (hasDurationData ? '<strong>Active time:</strong> ' + escapeHtml(formatDuration(totalActiveMs)) : '') +
          (hasDurationData && wallClockMs !== null ? ' &nbsp;·&nbsp; ' : '') +
          (wallClockMs !== null ? '<strong>Wall-clock:</strong> ' + escapeHtml(formatDuration(wallClockMs)) : '') +
        '</div>'
      : '';

    // Pipelines
    var pipelinesHtml = (wp.pipelines || []).slice().reverse().map(function (p) {
      var cls = (p.status || '').toLowerCase().replace(/ /g, '_');
      var summaryItems = (p.summary || []).map(function (s) {
        return '<li>' + escapeHtml(s) + '</li>';
      }).join('');
      var commentsHtml = (p.comments || []).map(function (c) {
        return '<div><strong>' + escapeHtml(c.type) + '</strong> [' + escapeHtml(c.priority) + ']: ' + escapeHtml(c.note) + '</div>';
      }).join('');

      return '<div class="pipeline-item ' + cls + '">' +
        '<div class="pipeline-header">' +
          escapeHtml(p.type.toUpperCase()) + ' — ' + statusBadge(p.status) +
          (p.duration_ms != null ? ' <span class="badge badge-neutral">' + escapeHtml(formatDuration(p.duration_ms)) + '</span>' : '') +
        '</div>' +
        '<div class="pipeline-meta">' +
          'Started: ' + escapeHtml(formatDate(p.started_at)) +
          (p.completed_at ? ' &nbsp; Completed: ' + escapeHtml(formatDate(p.completed_at)) : '') +
          (p.duration_ms != null ? ' &nbsp; Duration: ' + escapeHtml(formatDuration(p.duration_ms)) : '') +
        '</div>' +
        (summaryItems ? '<div class="pipeline-summary"><ul>' + summaryItems + '</ul></div>' : '') +
        (commentsHtml ? '<div class="pipeline-comments mt-8">' + commentsHtml + '</div>' : '') +
      '</div>';
    }).join('');

    // Handoff notes
    var handoffNotes = (wp.pipelines || []).reduce(function (acc, p) {
      return acc.concat(p.handoff_notes || []);
    }, []);
    var handoffHtml = handoffNotes.length
      ? '<div class="card"><div class="card-title">Handoff Notes</div><ul class="pipeline-summary">' +
          handoffNotes.map(function (n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') +
        '</ul></div>'
      : '';

    app.innerHTML =
      breadcrumb().projects().project(repo, slug).leaf(wpId).html() +
      '<div class="page-header">' +
        '<h1>' + escapeHtml(wpId) + '</h1>' +
        statusBadge(wp.status) +
      '</div>' +
      '<div class="card">' +
        '<div class="text-muted" style="font-size:13px">' +
          '<strong>Assigned to:</strong> ' + escapeHtml(wp.assigned_to || '—') + ' &nbsp; ' +
          '<strong>Dependencies:</strong> ' + escapeHtml((wp.dependencies || []).join(', ') || 'none') +
        '</div>' +
      '</div>' +
      (acHtml
        ? '<div class="card"><div class="card-title">Acceptance Criteria</div>' +
            '<ul class="ac-list">' + acHtml + '</ul>' +
          '</div>'
        : '') +
      buildWpDetailBar(wp) +
      (pipelinesHtml
        ? '<div class="card"><div class="card-title">Pipelines</div>' + wpTimingHtml + pipelinesHtml + '</div>'
        : '') +
      handoffHtml +
      '<div id="wp-dialogues-section"></div>';

    // Fetch and render Dialogues card asynchronously (after DOM is set).
    // Strategy: prefer chunk JSONL files (streaming capture) when available;
    // fall back to Markdown dialogue files for older runs that predate streaming capture.
    var dialoguesEl = document.getElementById('wp-dialogues-section');

    Promise.all([
      // getChunks errors are silently swallowed — absent chunks directory is
      // expected for older runs that predate streaming capture.
      API.getChunks(repo, slug, wpId).catch(function () { return []; }),
      API.getDialogues(repo, slug, wpId),
    ]).then(function (results) {
      var chunks = results[0] || [];
      var dialogues = results[1] || [];
      if (!dialoguesEl) return;

      // Choose data source: chunks take priority over Markdown dialogue files.
      var useChunks = chunks.length > 0;
      var entries = useChunks ? chunks : dialogues;

      if (!entries || entries.length === 0) {
        dialoguesEl.innerHTML =
          '<div class="card">' +
            '<div class="card-title">Dialogues</div>' +
            '<p class="text-muted">No dialogues available for this work package.</p>' +
          '</div>';
        return;
      }

      // Group by stage, preserving insertion order
      var stageMap = {};
      var stageOrder = [];
      entries.forEach(function (d) {
        var stage = d.stage || 'unknown';
        if (!stageMap[stage]) {
          stageMap[stage] = [];
          stageOrder.push(stage);
        }
        stageMap[stage].push(d);
      });

      var stagesHtml = stageOrder.map(function (stage) {
        var stageEntries = stageMap[stage];
        var buttonsHtml = stageEntries.map(function (d, idx) {
          var isLatest = (idx === stageEntries.length - 1);
          // Human-readable label: stage-r{revision index}
          var label = escapeHtml(stage + '-r' + idx);
          return '<button class="dialogue-btn' + (isLatest ? ' dialogue-btn-latest' : '') + '" ' +
            'aria-expanded="false" ' +
            'data-repo="' + escapeHtml(repo) + '" ' +
            'data-slug="' + escapeHtml(slug) + '" ' +
            'data-filename="' + escapeHtml(d.filename) + '" ' +
            'data-use-chunks="' + (useChunks ? '1' : '0') + '">' +
            label +
          '</button>';
        }).join('');
        return '<div class="dialogue-stage">' +
          '<span class="dialogue-stage-label">' + escapeHtml(stage) + '</span> ' +
          buttonsHtml +
          '<div class="dialogue-content" style="display:none"></div>' +
        '</div>';
      }).join('');

      dialoguesEl.innerHTML =
        '<div class="card" id="wp-dialogues-card">' +
          '<div class="card-title">Dialogues</div>' +
          stagesHtml +
        '</div>';

      // Track the currently expanded button
      var activeBtn = null;

      dialoguesEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.dialogue-btn');
        if (!btn) return;

        // Collapse previously expanded dialogue if different button
        if (activeBtn && activeBtn !== btn) {
          var prevStage = activeBtn.closest('.dialogue-stage');
          if (prevStage) {
            var prevContent = prevStage.querySelector('.dialogue-content');
            if (prevContent) { prevContent.style.display = 'none'; prevContent.innerHTML = ''; }
          }
          activeBtn.classList.remove('dialogue-btn-active');
          activeBtn.setAttribute('aria-expanded', 'false');
        }

        // If same button is clicked again, collapse it
        if (activeBtn === btn) {
          var curStage = btn.closest('.dialogue-stage');
          if (curStage) {
            var curContent = curStage.querySelector('.dialogue-content');
            if (curContent) { curContent.style.display = 'none'; curContent.innerHTML = ''; }
          }
          btn.classList.remove('dialogue-btn-active');
          btn.setAttribute('aria-expanded', 'false');
          activeBtn = null;
          return;
        }

        activeBtn = btn;
        btn.classList.add('dialogue-btn-active');
        btn.setAttribute('aria-expanded', 'true');

        var dlgRepo = btn.getAttribute('data-repo');
        var dlgSlug = btn.getAttribute('data-slug');
        var dlgFilename = btn.getAttribute('data-filename');
        var dlgUseChunks = btn.getAttribute('data-use-chunks') === '1';
        var stageEl = btn.closest('.dialogue-stage');
        var contentEl = stageEl ? stageEl.querySelector('.dialogue-content') : null;
        if (!contentEl) return;

        contentEl.innerHTML = '<em class="text-muted">Loading…</em>';
        contentEl.style.display = 'block';

        // Fetch rendered Markdown: use the /rendered chunk endpoint for chunk
        // files, or the plain dialogue content endpoint for Markdown files.
        var fetchPromise = dlgUseChunks
          ? API.getChunkRendered(dlgRepo, dlgSlug, dlgFilename)
          : API.getDialogueContent(dlgRepo, dlgSlug, dlgFilename);

        fetchPromise.then(function (md) {
          var rendered = (typeof marked !== 'undefined' && marked.parse)
            ? marked.parse(md)
            : '<pre>' + escapeHtml(md) + '</pre>';
          contentEl.innerHTML = '<div class="dialogue-markdown">' + rendered + '</div>';
        }).catch(function (err) {
          contentEl.innerHTML = '<p class="text-danger">Error loading dialogue: ' + escapeHtml(err.message || String(err)) + '</p>';
        });
      });
    }).catch(function (err) {
      if (!dialoguesEl) return;
      dialoguesEl.innerHTML =
        '<div class="card">' +
          '<div class="card-title">Dialogues</div>' +
          '<p class="text-danger">Failed to load dialogues: ' + escapeHtml(err.message || String(err)) + '</p>' +
        '</div>';
    });
  }).catch(function (err) {
    showError(app, 'Failed to load work package: ' + (err.message || String(err)));
  });
}

```