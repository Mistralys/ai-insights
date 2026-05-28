/* ============================================================
   utils.js — Shared utility functions
   Section 4 of the MCP Server Dashboard SPA
   ============================================================ */

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

// Cache of slug → display name, populated by views that fetch project data.
// breadcrumb().project() reads from here automatically.
var ProjectNameCache = (function () {
  var _cache = {};
  return {
    set: function (slug, name) {
      if (slug && name && name.trim()) _cache[slug] = name.trim();
    },
    get: function (slug) {
      return _cache[slug] || slug;
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
    project: function (slug) {
      segments.push({ label: ProjectNameCache.get(slug), href: '#/projects/' + encodeURIComponent(slug) });
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
