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
  return UI.badge(status, status);
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
  container.innerHTML = UI.banner('error', message);
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
