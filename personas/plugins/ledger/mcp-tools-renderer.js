'use strict';

/**
 * personas/plugins/ledger/mcp-tools-renderer.js
 *
 * Renders the MCP tools array as Markdown table rows.
 *
 * Ported from src/plugins/ledger/mcp-tools-renderer.ts in persona-builder.
 * No file-system I/O, no side effects — pure function.
 *
 * Important: entries flagged with note_only: true are intentionally
 * excluded from the rendered output. These are internal-documentation-only
 * tools that must not appear in published persona files.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the MCP tools array as Markdown table rows.
 *
 * Each visible tool is formatted as:
 *   | `{tool}` | {purpose} |
 *
 * Entries with note_only: true are filtered out and will not appear in
 * the output — this prevents internal-only tooling from being surfaced in
 * published persona documents.
 *
 * @param {Array<{tool: string, purpose: string, note_only?: boolean}>} tools
 *   Array of MCP tool entries from the persona YAML mcp_tools field
 * @returns {string} Newline-joined Markdown table row string (empty string when
 *   all entries are filtered out or the array is empty)
 *
 * @example
 * renderMcpToolsTable([
 *   { tool: 'ledger_get_status', purpose: 'Read project status' },
 *   { tool: 'internal_tool',    purpose: 'Internal use only', note_only: true },
 * ])
 * // => "| `ledger_get_status` | Read project status |"
 */
function renderMcpToolsTable(tools) {
  return tools
    .filter((t) => !t.note_only)
    .map((t) => `| \`${t.tool}\` | ${t.purpose} |`)
    .join('\n');
}

module.exports = { renderMcpToolsTable };
