'use strict';

/**
 * personas/plugins/ledger/roster-renderer.js
 *
 * Renders the ledger agent roster as a numbered Markdown list.
 *
 * Ported from src/plugins/ledger/roster-renderer.ts in persona-builder.
 * No file-system I/O, no side effects — pure function.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the agent roster as a numbered Markdown list.
 *
 * Each entry is formatted as:
 *   {number}. **{title}[ (YOU)]** ({short})
 *
 * The "(YOU)" suffix is appended to the entry whose number matches
 * activeNumber, making the active persona's role immediately obvious
 * when a built persona reads its own roster.
 *
 * @param {Array<{number: number, title: string, short: string}>} roster
 *   Ordered array of roster entries from _shared.yaml
 * @param {number} activeNumber
 *   The number field of the persona currently being built
 * @returns {string} Newline-joined Markdown list string
 *
 * @example
 * renderRoster([
 *   { number: 1, title: 'Planner', short: 'plans the work' },
 *   { number: 2, title: 'Developer', short: 'writes code' },
 * ], 1)
 * // => "1. **Planner (YOU)** (plans the work)\n2. **Developer** (writes code)"
 */
function renderRoster(roster, activeNumber) {
  return roster
    .map((entry) => {
      const you = entry.number === activeNumber ? ' (YOU)' : '';
      return `${entry.number}. **${entry.title}${you}** (${entry.short})`;
    })
    .join('\n');
}

module.exports = { renderRoster };
