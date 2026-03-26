'use strict';

/**
 * personas/plugins/ledger/index.js
 *
 * Factory function for the ledger persona build plugin.
 *
 * Ported from src/plugins/ledger/index.ts in persona-builder.
 *
 * ledgerPlugin(options) assembles the core modules from the ledger plugin
 * package into a PersonaBuildPlugin-conformant object and returns it.
 *
 * Hooks implemented:
 *   - onBuildContext  — injects roster_rendered and mcp_tools_table into
 *                       the build context so templates can reference them.
 *   - onPostRender    — captures the rendered output per-persona so the
 *                       onValidate hook can run the note_only guard against
 *                       the real generated content.
 *   - onValidate      — invokes validateRole (role against workflow manifest)
 *                       and validateNoteOnlyGuard (ensures note_only tools
 *                       are not present in the rendered output).
 *   - frontmatterTemplates — registers the ledger-specific frontmatter templates
 *                             for the vscode and claude-code targets.
 *
 * @example
 * const { ledgerPlugin } = require('./plugins/ledger');
 * const manifest = require('./shared/workflow-manifest.json');
 *
 * const plugin = ledgerPlugin({
 *   manifestRoles: manifest.roles.map(r => r.name),
 * });
 */

const { renderRoster }              = require('./roster-renderer');
const { renderMcpToolsTable }       = require('./mcp-tools-renderer');
const { validateRole, validateNoteOnlyGuard } = require('./role-validator');
const { FRONTMATTER_LEDGER_VSCODE, FRONTMATTER_LEDGER_CC } = require('./frontmatter-templates');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ledger persona build plugin.
 *
 * The returned object satisfies the PersonaBuildPlugin interface and can be
 * passed directly to the plugins array in a BuildConfig.
 *
 * @param {{ manifestRoles?: string[], warnOnUnknownRole?: boolean }} [options]
 *   Configuration options for the plugin.
 *
 *   - manifestRoles     List of canonical role names from the workflow manifest.
 *                       When omitted (or empty), role validation is skipped.
 *   - warnOnUnknownRole When true (default), unknown role → warning severity.
 *                       When false, unknown role → error severity.
 *
 * @returns {object} A fully configured PersonaBuildPlugin for the ledger suite
 */
function ledgerPlugin(options) {
  const { manifestRoles = [], warnOnUnknownRole = true } = options || {};

  /**
   * Per-persona rendered output cache.
   *
   * Populated by onPostRender and consumed by onValidate.
   * Keyed by composite key `${persona.name}:${target}` so that multi-target
   * builds correctly cache and validate per-target output independently.
   * onValidate immediately follows onPostRender in the per-persona pipeline.
   */
  const renderedOutputCache = new Map();

  return {
    name: 'ledger',

    // -------------------------------------------------------------------------
    // onBuildContext — inject roster_rendered and mcp_tools_table
    // -------------------------------------------------------------------------

    onBuildContext(context, persona, _suite) {
      const updated = Object.assign({}, context);

      // Render roster list if the persona carries a roster array
      const roster = persona['roster'];
      const personaNumber = persona['number'];

      if (Array.isArray(roster) && personaNumber !== undefined) {
        updated['roster_rendered'] = renderRoster(roster, personaNumber);
      } else {
        // Emit an empty string so templates can safely reference the variable
        // without producing an unresolved-variable warning on non-ledger personas.
        updated['roster_rendered'] = '';
      }

      // Render MCP tools table if the persona carries an mcp_tools array
      const mcpTools = persona['mcp_tools'];

      if (Array.isArray(mcpTools)) {
        updated['mcp_tools_table'] = renderMcpToolsTable(mcpTools);
      } else {
        updated['mcp_tools_table'] = '';
      }

      return updated;
    },

    // -------------------------------------------------------------------------
    // onPostRender — capture rendered output for note_only guard in onValidate
    // -------------------------------------------------------------------------

    onPostRender(output, persona, target) {
      // Cache the rendered output so onValidate can run the note_only guard.
      // Use a composite key so per-target outputs are cached independently.
      renderedOutputCache.set(`${persona.name}:${target}`, output);
      return output;
    },

    // -------------------------------------------------------------------------
    // onValidate — role validation + note_only guard
    // -------------------------------------------------------------------------

    onValidate(persona, _suite, target) {
      const results = [];

      // 1. Role validation against the workflow manifest
      const role = persona['role'];
      const roleResults = validateRole(role, manifestRoles).map((r) => ({
        ...r,
        // When warnOnUnknownRole is false, escalate warning → error so that
        // unknown roles are treated as hard failures rather than advisories.
        severity: (r.severity === 'warning' && !warnOnUnknownRole)
          ? 'error'
          : r.severity,
      }));
      results.push(...roleResults);

      // 2. note_only guard — verify internal-only MCP tools are not in the output.
      // Use the composite key matching the one written by onPostRender; fall back
      // to 'unknown' when target is absent (e.g. in unit-test contexts).
      const mcpTools = persona['mcp_tools'];
      const cacheKey = `${persona.name}:${target !== undefined ? target : 'unknown'}`;
      const renderedOutput = renderedOutputCache.get(cacheKey) || '';
      results.push(...validateNoteOnlyGuard(renderedOutput, mcpTools));

      return results;
    },

    // -------------------------------------------------------------------------
    // frontmatterTemplates — ledger-specific frontmatter for both targets
    // -------------------------------------------------------------------------

    frontmatterTemplates: {
      vscode: FRONTMATTER_LEDGER_VSCODE,
      'claude-code': FRONTMATTER_LEDGER_CC,
    },
  };
}

module.exports = { ledgerPlugin };
