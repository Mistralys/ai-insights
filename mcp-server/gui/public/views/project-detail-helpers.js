/* ============================================================
   views/project-detail-helpers.js — Project Detail: pure helpers
   Sub-module of views/project-detail.js (WP-004 decomposition).
   Depends on: escapeHtml (utils.js)

   Exports (on globalThis via bottom of this file):
     extractSynopsis, STAGE_ABBREV, buildPipelineTrack,
     buildRunBadges, _findScrollAnchor,
     _snapshotProjectState, _diffProjectState

   Cross-module consumers:
     STAGE_ABBREV is also consumed by views/work-package.js
     (the only symbol in this file used outside the project-detail
     module family).  All other exports are used exclusively within
     the project-detail.js / project-detail-orch.js / project-detail-modal.js
     module group.
   ============================================================ */

/* ----------------------------------------------------------
   4b. View: Plan Document
   ---------------------------------------------------------- */
function extractSynopsis(markdown) {
  var match = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
  return match ? match[1].trim() : null;
}

/* ----------------------------------------------------------
   4c. View: Project Detail — display helpers
   ---------------------------------------------------------- */

/**
 * Display abbreviations for pipeline stage type strings.
 *
 * Maps each ledger pipeline type to the two- or three-character label shown
 * in the pipeline-track badge column of the project-detail table.
 * `buildPipelineTrack` falls back to `stage.type.slice(0, 3).toUpperCase()`
 * for any type that is absent from this map, so unknown types render
 * gracefully but without a meaningful abbreviation.
 *
 * **Maintenance contract:** whenever a new pipeline type is added to the
 * ledger (e.g., in `PIPELINE_TYPES` on the server), add a corresponding
 * entry here.  Omitting a new type will not cause a runtime error, but the
 * badge label in the GUI will be a raw three-character slice of the type
 * string instead of a human-readable abbreviation.
 */
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
    badges += UI.badge('in-progress', 'Running');
  }
  if (item && item.is_dry_run) {
    badges += UI.badge('dry-run', 'Dry Run');
  }
  return badges;
}

/**
 * Walk up the DOM from el to find the nearest scrollable ancestor.
 *
 * Falls back to document.documentElement when no scrollable ancestor is found.
 * The optional _getStyle parameter allows injecting a custom style resolver for
 * test environments (jsdom) where window.getComputedStyle always returns empty
 * objects.
 *
 * @param {Element}  el          - Starting element.
 * @param {Function} [_getStyle] - Style resolver; defaults to window.getComputedStyle.
 *   Receives a single Element and returns an object with an overflowY property.
 *   Falls back to () => ({}) when window.getComputedStyle is unavailable.
 * @returns {Element} The nearest scrollable ancestor, or document.documentElement.
 */
function _findScrollAnchor(el, _getStyle) {
  var getStyle = typeof _getStyle === 'function'
    ? _getStyle
    : (window.getComputedStyle || function () { return {}; });
  var cur = el;
  while (cur && cur !== document.documentElement) {
    var style = getStyle(cur);
    if (style && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return document.documentElement;
}

/* ----------------------------------------------------------
   4c-iii. State Snapshot & Diff Helpers
   Pure functions — no DOM access, JSON-serializable outputs.
   Used by WP-003 polling to decide patch vs. full re-render.
   ---------------------------------------------------------- */

/**
 * Extract a comparable state snapshot from API response objects.
 *
 * @param {object} project      - Response from API.getProject()
 * @param {Array|null} overviewResult - Response from API.getWorkPackageOverview() (may be null)
 * @returns {{
 *   status: string,
 *   last_updated: string,
 *   synthesis_generated: boolean,
 *   wpStatuses: Object.<string, { status: string, pipelineStages: Array }>,
 *   health: null | { work_packages_needing_reset: number }
 * }}
 */
function _snapshotProjectState(project, overviewResult) {
  var meta = (project && project.meta) || {};
  var wps  = (project && project.work_packages) || [];

  // Build per-WP status map
  var wpStatuses = {};
  wps.forEach(function (wp) {
    if (!wp || !wp.work_package_id) return;
    wpStatuses[wp.work_package_id] = {
      status: wp.status || '',
      pipelineStages: [],
    };
  });

  // Enrich with pipeline stage data from overview
  if (Array.isArray(overviewResult)) {
    overviewResult.forEach(function (entry) {
      if (!entry || !entry.work_package_id) return;
      var id = entry.work_package_id;
      var stages = Array.isArray(entry.pipeline_stages)
        ? entry.pipeline_stages.map(function (s) {
            return {
              type:         s.type        || '',
              status:       s.status      || '',
              agent:        s.agent       || '',
              rework_count: s.rework_count || 0,
            };
          })
        : [];
      if (wpStatuses[id]) {
        wpStatuses[id].pipelineStages = stages;
      } else {
        // Overview entry present without a matching WP in the main list.
        wpStatuses[id] = { status: '', pipelineStages: stages };
      }
    });
  }

  return {
    status:               meta.status              || '',
    last_updated:         meta.last_updated         || '',
    synthesis_generated:  !!(project && project.synthesis_generated),
    wpStatuses:           wpStatuses,
    health:               null,  // populated asynchronously via getProjectHealth()
  };
}

/**
 * Compare two project-state snapshots and classify the difference.
 *
 * Structural changes (require full re-render):
 *   - The number of work packages differs between snapshots.
 *   - The project transitioned to COMPLETE or ARCHIVED status.
 *
 * Data-only changes (patchable in-place):
 *   - Status badge changed but is not a structural transition.
 *   - Any per-WP status or pipeline-stage changed.
 *   - synthesis_generated flipped.
 *   - health changed (including null → value transitions).
 *   - last_updated changed.
 *
 * NOTE — per-WP iteration order: per-WP status/pipeline changes are detected by
 * iterating over `next.wpStatuses` keys only. A WP present in `prev` but absent
 * from `next` is therefore not tracked per-field; the structural `wpCount` check
 * handles that case before per-WP diffing is reached. In practice, a missing WP
 * always triggers a structural re-render, so the per-field gap is intentional.
 *
 * @param {object} prev - Previous snapshot from _snapshotProjectState().
 *   Must be non-null; passing null will throw on Object.keys(prev.wpStatuses).
 *   Callers must initialise pollStateRef[0] with a real snapshot before
 *   registering the poll interval — the 5s setInterval delay ensures the
 *   first tick cannot fire before that assignment completes.
 * @param {object} next - Current  snapshot from _snapshotProjectState().
 * @returns {{ type: 'none'|'data'|'structural', changes: object }}
 */
function _diffProjectState(prev, next) {
  var changes = {};
  var changeType = 'none';

  function markData(key, from, to) {
    changes[key] = { from: from, to: to };
    if (changeType === 'none') changeType = 'data';
  }

  function markStructural(key, from, to) {
    changes[key] = { from: from, to: to };
    changeType = 'structural';
  }

  // ── WP count ────────────────────────────────────────────────────────
  var prevIds = Object.keys(prev.wpStatuses || {});
  var nextIds = Object.keys(next.wpStatuses || {});
  if (prevIds.length !== nextIds.length) {
    markStructural('wpCount', prevIds.length, nextIds.length);
  }

  // ── Project status ──────────────────────────────────────────────────
  if (prev.status !== next.status) {
    var isStructuralStatus = next.status === 'COMPLETE' || next.status === 'ARCHIVED';
    if (isStructuralStatus) {
      markStructural('status', prev.status, next.status);
    } else {
      markData('status', prev.status, next.status);
    }
  }

  // ── Per-WP statuses and pipeline stages ─────────────────────────────
  nextIds.forEach(function (id) {
    var prevWp = (prev.wpStatuses || {})[id] || { status: '', pipelineStages: [] };
    var nextWp = (next.wpStatuses || {})[id] || { status: '', pipelineStages: [] };

    if (prevWp.status !== nextWp.status) {
      markData('wp.' + id + '.status', prevWp.status, nextWp.status);
    }

    // Compare pipeline stages as JSON strings (simple deep-equal for flat objects)
    var prevStagesStr = JSON.stringify(prevWp.pipelineStages || []);
    var nextStagesStr = JSON.stringify(nextWp.pipelineStages || []);
    if (prevStagesStr !== nextStagesStr) {
      markData('wp.' + id + '.pipelineStages', prevWp.pipelineStages, nextWp.pipelineStages);
    }
  });

  // ── synthesis_generated ─────────────────────────────────────────────
  if (!!prev.synthesis_generated !== !!next.synthesis_generated) {
    markData('synthesis_generated', prev.synthesis_generated, next.synthesis_generated);
  }

  // ── health ──────────────────────────────────────────────────────────
  // null-to-value (or any value change) is data-only
  var prevHealthStr = JSON.stringify(prev.health || null);
  var nextHealthStr = JSON.stringify(next.health || null);
  if (prevHealthStr !== nextHealthStr) {
    markData('health', prev.health, next.health);
  }

  // ── last_updated ────────────────────────────────────────────────────
  if (prev.last_updated !== next.last_updated) {
    markData('last_updated', prev.last_updated, next.last_updated);
  }

  return { type: changeType, changes: changes };
}

/* ----------------------------------------------------------
   Test / global access
   ---------------------------------------------------------- */
globalThis._findScrollAnchor = _findScrollAnchor;
