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
