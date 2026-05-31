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
    getProjects: function (params) {
      return request('GET', '/projects' + buildQueryString(params));
    },
    getProject:               function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug)); },
    getWorkPackages:          function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/work-packages'); },
    getWorkPackage:           function (slug, wpId)   { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/work-packages/' + encodeURIComponent(wpId)); },
    deleteProject:            function (slug)         { return request('DELETE', '/projects/' + encodeURIComponent(slug)); },
    archiveProject:           function (slug)         { return request('POST',   '/projects/' + encodeURIComponent(slug) + '/archive'); },
    unarchiveProject:         function (slug)         { return request('POST',   '/projects/' + encodeURIComponent(slug) + '/unarchive'); },
    getConfig:                function ()             { return request('GET',    '/config'); },
    updateConfig:             function (data)         { return request('PUT',    '/config', data); },
    getInsights:              function ()             { return request('GET',    '/insights'); },
    getServerInfo:            function ()             { return request('GET',    '/server-info'); },
    getPlanDocument:          function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/plan'); },
    getSynthesisDocument:     function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/synthesis'); },
    analyzeProjectReset:      function (slug)         { return request('POST',   '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: true }); },
    applyProjectReset:        function (slug, decisions) { return request('POST', '/projects/' + encodeURIComponent(slug) + '/reset', { dry_run: false, decisions: decisions }); },
    getProjectHealth:         function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/health'); },
    getWorkPackageOverview:   function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/work-packages/overview'); },
    renameProject:            function (slug, title)  { return request('PATCH',  '/projects/' + encodeURIComponent(slug), { title: title }); },
    renameSlug:               function (slug, newSlug) { return request('PATCH',  '/projects/' + encodeURIComponent(slug), { slug: newSlug }); },
    markProjectComplete:      function (slug)         { return request('POST',   '/projects/' + encodeURIComponent(slug) + '/complete'); },
    getRunLogs:               function (slug)         { return request('GET',    '/projects/' + encodeURIComponent(slug) + '/runs'); },
    getRunLogEntries:         function (slug, filename, afterLine) {
      var qs = (afterLine !== undefined && afterLine !== null) ? ('?after=' + encodeURIComponent(afterLine)) : '';
      return request('GET', '/projects/' + encodeURIComponent(slug) + '/runs/' + encodeURIComponent(filename) + qs);
    },
    getDialogues: function (slug, wpId) {
      return request('GET', '/projects/' + encodeURIComponent(slug) + '/dialogues' + buildQueryString({ wp: wpId }));
    },
    getDialogueContent: function (slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(slug) + '/dialogues/' + encodeURIComponent(filename))
        .then(function (data) { return data.content; });
    },
    getChunks: function (slug, wpId) {
      return request('GET', '/projects/' + encodeURIComponent(slug) + '/chunks' + buildQueryString({ wp: wpId }));
    },
    getChunkRendered: function (slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/rendered')
        .then(function (data) { return data.content; });
    },

    // -- Orchestrator --------------------------------------------------
    orchestratorStart:       function (planPath, dryRun) { return request('POST',   '/orchestrator/start',                                         { planPath: planPath, dryRun: dryRun }); },
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
