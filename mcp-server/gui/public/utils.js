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

function showLoading(container) {
  container.innerHTML = '<div class="loading">Loading…</div>';
}

function showError(container, message) {
  container.innerHTML = '<div class="error-banner">' + escapeHtml(message) + '</div>';
}
