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
  };
})();
