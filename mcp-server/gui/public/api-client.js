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

  /**
   * GUI configuration object returned by `getConfig` and `updateConfig`.
   *
   * Defined server-side as `GuiConfig` in `src/gui/config.ts`
   * (`GuiConfigSchema = z.object({...})`).  `ledger_root` is read-only from
   * the GUI's perspective — `updateConfig` rejects any body that includes it.
   *
   * @typedef {Object} GuiConfig
   * @property {boolean} auto_handoff_enabled - When `true`, the orchestrator
   *   automatically hands off to the next agent after each pipeline completes.
   * @property {number}  max_handoff_depth    - Maximum consecutive auto-handoffs
   *   before the orchestrator stops (guards against infinite loops).
   * @property {number}  auto_archive_days    - Projects not updated within this
   *   many days are automatically archived (`0` disables auto-archiving).
   * @property {boolean} capture_dialogues    - When `true`, per-pipeline
   *   dialogue files are captured to disk.
   * @property {string}  ledger_root          - Absolute filesystem path to the
   *   ledger root directory (read-only from the GUI).
   */

  /**
   * A single knowledge insight entry returned by `getInsights`.
   *
   * Each entry is a project comment flattened from a project ledger's
   * `project_comments` array, enriched with `project_slug`,
   * `project_status`, and `repository_name` (derived from the plan path).
   * Defined server-side as `InsightEntry` in `gui/api.ts`.
   *
   * @typedef {Object} InsightEntry
   * @property {string}          project_slug   - Unique slug of the project that owns this insight.
   * @property {string}          project_status - Status of the owning project
   *   (e.g. `'IN_PROGRESS'`, `'COMPLETE'`, `'ARCHIVED'`).
   * @property {string|null}     repository_name - Repository name derived from the plan path;
   *   `null` when the repository cannot be resolved.
   * @property {string}          type           - Comment type (e.g. `'note'`, `'decision'`, `'incident'`).
   * @property {'low'|'medium'|'high'} priority - Comment priority.
   * @property {string}          timestamp      - ISO 8601 timestamp when the comment was recorded.
   * @property {string}          agent          - Agent role that recorded the comment.
   * @property {string}          note           - Comment body text.
   * @property {object}          [context]      - Optional incident context (present when
   *   `type === 'incident'`); includes `os`, `tool`, `resolved`, and optionally `workaround`.
   */

  /**
   * Server runtime information returned by `getServerInfo`.
   *
   * Used by the GUI's stale-instance detection (`stale-check.js`) to compare
   * boot-time versions against current on-disk versions and display a banner
   * when the server is running outdated code.  Versions are captured from
   * `package.json` files at server startup and again on each poll.
   *
   * @typedef {Object} ServerInfo
   * @property {boolean}     stale        - `true` when any on-disk version differs
   *   from the corresponding boot-time version (i.e. the server is stale).
   * @property {ServerVersions} bootVersions - Versions captured at server startup.
   * @property {ServerVersions} diskVersions - Versions read from disk at request time.
   */

  /**
   * Version snapshot used in {@link ServerInfo}.
   *
   * @typedef {Object} ServerVersions
   * @property {string} mcpServer   - Version from the MCP server's `package.json`.
   * @property {string} personas    - Version from the personas package's `package.json`.
   * @property {string} orchestrator - Version from the orchestrator package's `package.json`.
   */

  return {
    /**
     * List all projects, optionally filtered by query parameters.
     *
     * @param {Record<string, any>|null|undefined} params - Query parameters
     *   (e.g. `{ status, repo }`). `undefined`/empty-string values are omitted.
     * @returns {Promise<object[]>} Parsed JSON response from `GET /api/projects`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getProject: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug)); },

    /**
     * List all work packages for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object[]>} Work package list from `GET /api/projects/{repo}/{slug}/work-packages`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getWorkPackages: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages'); },

    /**
     * Fetch a single work package by ID.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} wpId - Work package ID (e.g. `'WP-001'`; URI-encoded automatically).
     * @returns {Promise<object>} Work package detail from `GET /api/projects/{repo}/{slug}/work-packages/{wpId}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getWorkPackage: function (repo, slug, wpId) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages/' + encodeURIComponent(wpId)); },

    /**
     * Permanently delete a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<null>} `null` on success (HTTP 204 No Content).
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    deleteProject: function (repo, slug) { return request('DELETE', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug)); },

    /**
     * Archive a project (moves it to archived status).
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/archive`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    archiveProject: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/archive'); },

    /**
     * Restore an archived project to active status.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/unarchive`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    unarchiveProject: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/unarchive'); },

    /**
     * Fetch the current server configuration.
     *
     * @returns {Promise<GuiConfig>} Configuration object from `GET /api/config`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getConfig:                function ()             { return request('GET',    '/config'); },

    /**
     * Update the server configuration.
     *
     * `ledger_root` is read-only from the GUI and is rejected by the server if
     * included in the request body.
     *
     * @param {Partial<Omit<GuiConfig, 'ledger_root'>>} data - Configuration fields to update.
     * @returns {Promise<GuiConfig>} Updated configuration from `PUT /api/config`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    updateConfig:             function (data)         { return request('PUT',    '/config', data); },

    /**
     * Fetch all knowledge insights from the ledger.
     *
     * Aggregates `project_comments` from every project ledger into a single
     * flat array, sorted by timestamp descending (newest first).  Per-project
     * read failures are logged to stderr and skipped gracefully.
     *
     * @returns {Promise<InsightEntry[]>} Insight entries from `GET /api/insights`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getInsights:              function ()             { return request('GET',    '/insights'); },

    /**
     * Fetch server runtime information and stale-instance status.
     *
     * Compares boot-time package versions against current on-disk versions.
     * Used by the GUI's stale-instance detection (`stale-check.js`) to display
     * a banner when the running server is outdated.
     *
     * @returns {Promise<ServerInfo>} Server info from `GET /api/server-info`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getServerInfo:            function ()             { return request('GET',    '/server-info'); },

    /**
     * Fetch the plan document (Markdown) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Plan document from `GET /api/projects/{repo}/{slug}/plan`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getPlanDocument: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/plan'); },

    /**
     * Fetch the synthesis document (Markdown) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Synthesis document from `GET /api/projects/{repo}/{slug}/synthesis`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    analyzeProjectReset: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/reset', { dry_run: true }); },

    /**
     * Apply a project reset with caller-supplied decisions.
     *
     * @param {string}   repo      - Repository name that owns the project (URI-encoded automatically).
     * @param {string}   slug      - Unique project slug within the repository (URI-encoded automatically).
     * @param {object[]} decisions - Array of decision objects returned by `analyzeProjectReset`.
     * @returns {Promise<object>} Reset result from `POST /api/projects/{repo}/{slug}/reset` (`dry_run: false`).
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    applyProjectReset: function (repo, slug, decisions) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/reset', { dry_run: false, decisions: decisions }); },

    /**
     * Fetch the health summary for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Health report from `GET /api/projects/{repo}/{slug}/health`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getProjectHealth: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/health'); },

    /**
     * Fetch the work package overview (aggregate status summary) for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Overview from `GET /api/projects/{repo}/{slug}/work-packages/overview`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getWorkPackageOverview: function (repo, slug) { return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/work-packages/overview'); },

    /**
     * Rename a project's display title.
     *
     * @param {string} repo  - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug  - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} title - New display title for the project.
     * @returns {Promise<object>} Updated project from `PATCH /api/projects/{repo}/{slug}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    renameProject: function (repo, slug, title) { return request('PATCH', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug), { title: title }); },

    /**
     * Change a project's slug identifier.
     *
     * @param {string} repo    - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug    - Current project slug (URI-encoded automatically).
     * @param {string} newSlug - New slug to assign to the project.
     * @returns {Promise<object>} Updated project from `PATCH /api/projects/{repo}/{slug}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    renameSlug: function (repo, slug, newSlug) { return request('PATCH', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug), { slug: newSlug }); },

    /**
     * Mark a project as complete.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object>} Updated project from `POST /api/projects/{repo}/{slug}/complete`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    markProjectComplete: function (repo, slug) { return request('POST', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/complete'); },

    /**
     * List all run log files for a project.
     *
     * @param {string} repo - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug - Unique project slug within the repository (URI-encoded automatically).
     * @returns {Promise<object[]>} Run log file list from `GET /api/projects/{repo}/{slug}/runs`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @returns {Promise<string>} The dialogue content string extracted from the `content` field of
     *   the JSON response body returned by
     *   `GET /api/projects/{repo}/{slug}/dialogues/{filename}`.
     *   The response is parsed as JSON (`{ content: string }`); this function returns
     *   `data.content` — it does **not** call `res.text()`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getChunkRendered: function (repo, slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/rendered')
        .then(function (data) { return data.content; });
    },

    /**
     * A discriminated-union block produced by `renderChunksToStructured()` on the
     * server and surfaced to the frontend via `getChunkStructured()`.
     *
     * The `type` field is the discriminant; only the properties relevant to that
     * variant are present on each object:
     *
     * - `'text'`            — plain dialogue text; `content` (string) holds the body.
     * - `'tool-call'`       — one tool invocation; fields: `name` (string),
     *                         `detailLines` (string[]), `args` (any parsed shape),
     *                         and optional `result: { content: string }` for non-inline
     *                         tools (`execute`/`task` results stay inside `detailLines`).
     * - `'subagent-heading'` — marks the start of a sub-agent namespace; `label` (string).
     * - `'checklist'`        — a `write_todos` invocation; `items` is an array of
     *                         `{ content: string, status: string, checked: boolean }`.
     *
     * @typedef {Object} DialogueBlock
     * @property {'text'|'tool-call'|'subagent-heading'|'checklist'} type - Block variant.
     * @property {string}   [content]     - *(text)*           Rendered text body.
     * @property {string}   [name]        - *(tool-call)*       Tool name.
     * @property {string[]} [detailLines] - *(tool-call)*       Human-readable summary lines.
     * @property {*}        [args]        - *(tool-call)*       Parsed tool arguments.
     * @property {{content: string}} [result] - *(tool-call)*  Embedded ToolMessage result
     *   (absent for inline tools; present for all others).
     * @property {string}   [label]       - *(subagent-heading)* Sub-agent namespace label.
     * @property {Array<{content: string, status: string, checked: boolean}>} [items]
     *   - *(checklist)* Items from a `write_todos` invocation.
     */

    /**
     * Fetch structured dialogue blocks for a single context chunk.
     *
     * @param {string} repo     - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug     - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} filename - Chunk filename (URI-encoded automatically).
     * @returns {Promise<DialogueBlock[]>} Array of structured dialogue blocks from
     *   `GET /api/projects/{repo}/{slug}/chunks/{filename}/rendered?format=structured`.
     *   Each element is a {@link DialogueBlock} — inspect the `type` field to
     *   determine which variant properties are present.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getChunkStructured: function (repo, slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/rendered?format=structured')
        .then(function (data) { return data.blocks; });
    },

    /**
     * Fetch extracted plain-prose text for a single context chunk.
     *
     * @param {string} repo     - Repository name that owns the project (URI-encoded automatically).
     * @param {string} slug     - Unique project slug within the repository (URI-encoded automatically).
     * @param {string} filename - Chunk filename (URI-encoded automatically).
     * @returns {Promise<string>} Extracted prose as a Markdown string from
     *   `GET /api/projects/{repo}/{slug}/chunks/{filename}/text`.
     */
    getChunkText: function (repo, slug, filename) {
      return request('GET', '/projects/' + encodeURIComponent(repo) + '/' + encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/text')
        .then(function (data) { return data.content; });
    },

    // -- Repositories (Strategy) ---------------------------------------

    /**
     * List repositories from the registry, optionally including filesystem-
     * discovered undeclared namespaces.
     *
     * @param {boolean} [includeUndeclared=false] - When true, appends
     *   `?include_undeclared=true` to the request, causing the server to also
     *   return namespace directories not covered by any declared repo's
     *   `folder_names`. Undeclared entries carry `declared: false`.
     *
     * Undeclared entry shape (returned only when `includeUndeclared=true`):
     *   - `declared`     — always `false`
     *   - `id`           — the filesystem namespace directory name
     *   - `label`        — same value as `id` (no user-defined label exists)
     *   - `folder_names` — single-element array: `[id]`
     *
     * This identity contract (`id === label === folder_names[0]`) is relied upon
     * by `wireRegisterButtons()` in strategy.js, which pre-fills the Add
     * Repository form fields using `r.id`. Specifically:
     *   - `#new-repo-id`      receives `sanitiseSlug(r.id)` — a SLUG_REGEX-safe
     *                          lowercase slug (dots, spaces, and special chars
     *                          replaced; leading non-alphanumeric chars stripped;
     *                          consecutive hyphens collapsed; trailing hyphens
     *                          stripped; falls back to 'repo' for empty results).
     *   - `#new-repo-label`   receives the raw `r.id` (unchanged).
     *   - `#new-repo-folders` receives the raw `r.id` (unchanged).
     *
     * `sanitiseSlug` is a local function scoped inside `renderStrategyList` and
     * is not accessible from `renderStrategyDetail` or other view functions. If
     * slug sanitisation is ever needed elsewhere, the function must be duplicated
     * or elevated to module scope. If the backend undeclared entry shape ever
     * changes, the pre-fill logic in `wireRegisterButtons` must be updated
     * accordingly.
     *
     * @returns {Promise<object[]>} Parsed JSON response from `GET /api/repos`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    listRepos: function (includeUndeclared) {
      var qs = includeUndeclared ? '?include_undeclared=true' : '';
      return request('GET', '/repos' + qs);
    },

    /**
     * Fetch a single repository entry by ID.
     *
     * @param {string} repoId - Repository ID (URI-encoded automatically).
     * @returns {Promise<object>} Repository detail from `GET /api/repos/{repoId}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getRepo: function (repoId) {
      return request('GET', '/repos/' + encodeURIComponent(repoId));
    },

    /**
     * Create a new repository entry in the registry.
     *
     * @param {object} data - Repository fields: id, label, folder_names, vision, store_id.
     * @returns {Promise<object>} Created repository from `POST /api/repos`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    createRepo: function (data) {
      return request('POST', '/repos', data);
    },

    /**
     * Update an existing repository entry.
     *
     * @param {string} repoId - Repository ID (URI-encoded automatically).
     * @param {object} data   - Fields to update: label, folder_names, vision.
     * @returns {Promise<object>} Updated repository from `PUT /api/repos/{repoId}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    updateRepo: function (repoId, data) {
      return request('PUT', '/repos/' + encodeURIComponent(repoId), data);
    },

    /**
     * Delete a repository entry from the registry.
     * Does NOT delete any project data or storage.
     *
     * @param {string} repoId - Repository ID (URI-encoded automatically).
     * @returns {Promise<null>} `null` on success (HTTP 204 No Content).
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    deleteRepo: function (repoId) {
      return request('DELETE', '/repos/' + encodeURIComponent(repoId));
    },

    // -- Stores --------------------------------------------------------

    /**
     * Fetch the list of configured stores with project and repository counts.
     *
     * In single-store (legacy) mode the server returns a single entry
     * representing the default ledger root.
     *
     * @returns {Promise<object[]>} Store entries from `GET /api/stores`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getStores: function () {
      return request('GET', '/stores');
    },

    /**
     * Fetch cross-store repository registry conflicts.
     *
     * Returns repositories registered in more than one store, with per-store
     * entries and a winner indicator. The winner is determined by store-order
     * priority (first configured store wins). Returns an empty array in
     * single-store mode.
     *
     * @returns {Promise<object[]>} Conflict records from `GET /api/stores/conflicts`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getStoreConflicts: function () {
      return request('GET', '/stores/conflicts');
    },

    // -- Orchestrator --------------------------------------------------

    /**
     * Start a new orchestrator run for a plan.
     *
     * @param {string}          planPath        - Absolute path to the plan directory on the server.
     * @param {boolean}         dryRun          - When `true`, runs in dry-run mode (no side-effects).
     * @param {string|undefined} resumeThreadId - Optional thread ID to resume an existing run.
     * @returns {Promise<object>} Run descriptor from `POST /api/orchestrator/start`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorStart: function (planPath, dryRun, resumeThreadId) {
      var body = { planPath: planPath, dryRun: dryRun };
      if (resumeThreadId !== undefined) body.resumeThreadId = resumeThreadId;
      return request('POST', '/orchestrator/start', body);
    },

    /**
     * Fetch the current orchestrator run queue.
     *
     * @returns {Promise<object[]>} Queue entries from `GET /api/orchestrator/queue`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorGetQueue:    function ()                 { return request('GET',    '/orchestrator/queue'); },

    /**
     * Fetch the run status for a specific plan slug.
     *
     * @param {string} slug - Plan slug (URI-encoded automatically).
     * @returns {Promise<object>} Run status from `GET /api/orchestrator/run-status/{slug}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorGetRunStatus: function (slug)            { return request('GET',    '/orchestrator/run-status/' + encodeURIComponent(slug)); },

    /**
     * Kill an active orchestrator run.
     *
     * @param {string} id - Run ID (URI-encoded automatically).
     * @returns {Promise<object>} Result from `POST /api/orchestrator/kill/{id}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorKill:        function (id)               { return request('POST',   '/orchestrator/kill/'       + encodeURIComponent(id)); },

    /**
     * Dismiss a completed or failed orchestrator run from the queue.
     *
     * @param {string} id - Run ID (URI-encoded automatically).
     * @returns {Promise<object>} Result from `POST /api/orchestrator/dismiss/{id}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorDismiss:     function (id)               { return request('POST',   '/orchestrator/dismiss/'    + encodeURIComponent(id)); },

    /**
     * Permanently delete an orchestrator run record.
     *
     * @param {string} id - Run ID (URI-encoded automatically).
     * @returns {Promise<object>} Result from `POST /api/orchestrator/delete/{id}`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    orchestratorDelete:      function (id)               { return request('POST',   '/orchestrator/delete/'     + encodeURIComponent(id)); },

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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
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
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    moveKnowledge: function (id, sourceScope, sourceRepositoryName, targetRepositoryName) {
      return request('POST', '/knowledge/' + encodeURIComponent(id) + '/move', {
        source_scope: sourceScope,
        source_repository_name: sourceRepositoryName != null ? sourceRepositoryName : undefined,
        target_repository_name: targetRepositoryName,
      });
    },

    // -- Model Registry ------------------------------------------------

    /**
     * Fetch the current model registry list.
     * Auto-initializes `local.json` from `default.json` on first access.
     *
     * @returns {Promise<object[]>} Model array from `GET /api/models`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getModels: function () {
      return request('GET', '/models');
    },

    /**
     * Bulk-save the model registry.
     * Entries missing `id` receive an auto-assigned UUIDv4 on the server.
     * Returns 409 when a deletion would remove a referenced model.
     *
     * @param {object[]} models - Array of model entry objects to save.
     * @returns {Promise<object>} `{ models }` on success, or `{ conflict: true, referencedModels }` on 409.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    saveModels: function (models) {
      return request('PUT', '/models', models);
    },

    /**
     * Merge `default.json` into `local.json` without overwriting existing entries.
     * Returns the post-merge model list and any slug-collision conflicts.
     *
     * @returns {Promise<object>} `{ models, conflicts }` from `POST /api/models/load-defaults`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    loadDefaultModels: function () {
      return request('POST', '/models/load-defaults');
    },

    // -- Personas ---------------------------------------------------------

    /**
     * Fetch all personas from `name-mapping.json`.
     * Returns an empty array when the file does not exist.
     *
     * @returns {Promise<object[]>} Persona array from `GET /api/personas`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getPersonas: function () {
      return request('GET', '/personas');
    },

    // -- Model Assignments ------------------------------------------------

    /**
     * Fetch the current model assignments enriched with a `stale` boolean.
     * `stale: true` means the persona build output may be out of date.
     *
     * @returns {Promise<object>} `{ default_model_uuid, persona_models, stale }` from `GET /api/model-assignments`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    getAssignments: function () {
      return request('GET', '/model-assignments');
    },

    /**
     * Validate and persist model assignments.
     * All model UUIDs must exist in the registry; all persona keys must exist in `name-mapping.json`.
     *
     * @param {object} data - `{ default_model_uuid?, persona_models }` assignment object.
     * @returns {Promise<object>} Saved assignments from `PUT /api/model-assignments`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    updateAssignments: function (data) {
      return request('PUT', '/model-assignments', data);
    },

    /**
     * Replace all occurrences of one model UUID with another across all assignments.
     * Rejects when `old_model_id === new_model_id` or when `old_model_id` is not referenced.
     *
     * @param {string} oldModelId - UUID of the model to replace.
     * @param {string} newModelId - UUID of the replacement model.
     * @returns {Promise<object>} Updated assignments from `POST /api/model-assignments/replace`.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    replaceAssignedModel: function (oldModelId, newModelId) {
      return request('POST', '/model-assignments/replace', {
        old_model_id: oldModelId,
        new_model_id: newModelId,
      });
    },

    /**
     * Spawn `node scripts/build-personas.js` in the workspace root.
     * Returns 409 when a build is already in progress.
     *
     * @returns {Promise<object>} `{ success: true, output }` on exit 0,
     *   or `{ success: false, output, exitCode }` with HTTP 500 on failure.
     * @throws {{ code: string, message: string }} On HTTP error responses.
     */
    rebuildPersonas: function () {
      return request('POST', '/personas/rebuild');
    },
  };
})();
