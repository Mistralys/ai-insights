'use strict';

/**
 * persona-helpers.js
 *
 * Pure helper functions extracted from scripts/build-personas.js.
 * All functions are side-effect-free (no filesystem I/O, no process.exit)
 * except for the filename validator which calls process.exit(1) on
 * invalid input and the resolve* functions which call console.warn for
 * unresolved markers.
 *
 * CJS module — loaded via require('./lib/persona-helpers') in build-personas.js
 * and imported by the vitest test suite.
 */

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a tools array in YAML single-quote flow format.
 * e.g. ['vscode', 'execute', 'read', ...]  — includes outer brackets.
 * Used by the ledger suite (preserves byte-identical output).
 *
 * @param {string[]} tools
 * @returns {string}  e.g. "['vscode', 'execute']"
 */
function serializeTools(tools) {
  return '[' + tools.map(t => `'${t}'`).join(', ') + ']';
}

/**
 * Serialize tools list WITHOUT outer brackets.
 * Used inside standalone frontmatter templates (which supply [ ]).
 *
 * @param {string[]} tools
 * @returns {string}  e.g. "'vscode', 'execute'"
 */
function serializeToolsList(tools) {
  return tools.map(t => `'${t}'`).join(', ');
}

// ---------------------------------------------------------------------------
// Filename validators
// ---------------------------------------------------------------------------

/**
 * Validates that a persona has the specified filename field set.
 * Exits with code 1 and prints an error if the field is missing.
 *
 * @param {{role?: string, number?: number, slug?: string, [key: string]: any}} persona
 * @param {'cc_file_name'|'vs_file_name'} fieldName  the filename field to validate
 * @param {string} suite
 */
function validateFileName(persona, fieldName, suite) {
  if (!persona[fieldName]) {
    console.error(`[ERROR] ${fieldName} is required for persona '${persona.role || persona.slug || persona.number}' in suite '${suite}'`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

/**
 * Step 1 — Partial resolution.
 * Replaces {{> name}} with the content of the provided partialsMap.
 * Supports up to depth 2 to resolve partials-within-partials.
 * Warns and leaves the marker as-is if a partial is not found.
 *
 * @param {string} text
 * @param {Object.<string, string>} partialsMap
 * @param {number} depth current recursion depth (starts at 0)
 * @returns {string}
 */
function resolvePartials(text, partialsMap, depth = 0) {
  if (depth >= 2) return text;
  return text.replace(/\{\{> ([\w-]+)\}\}/g, (match, name) => {
    if (!(name in partialsMap)) {
      console.warn(`[WARN] Partial not found: ${match}`);
      return match;
    }
    // Recursively resolve nested partials (depth + 1).
    // trimEnd() strips trailing whitespace to avoid extra blank lines.
    return resolvePartials(partialsMap[name], partialsMap, depth + 1).trimEnd();
  });
}

/**
 * Step 2 — Conditional block resolution.
 * Handles {{#if flag}}...{{/if}} blocks with optional {{else}} branch.
 * When the flag is truthy, strips the delimiters and keeps the inner content
 * (content before {{else}} if present).
 * When falsy with {{else}}, keeps the content after {{else}}.
 * When falsy without {{else}}, removes the entire block.
 *
 * @param {string} text
 * @param {Object} context merged metadata context
 * @returns {string}
 */
function resolveConditionals(text, context) {
  return text.replace(
    /\n*\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}\n*/g,
    (match, flag, inner, elseInner) => {
      if (context[flag]) {
        // Truthy: keep content before {{else}} (or entire inner if no {{else}})
        return '\n' + inner.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      }
      if (elseInner !== undefined) {
        // Falsy with {{else}}: keep content after {{else}}
        return '\n' + elseInner.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
      }
      // Falsy without {{else}}: remove entire block
      return '\n';
    }
  );
}

/**
 * Step 3 — Variable interpolation.
 * Replaces {{varName}} with String(context[varName]).
 * Warns and leaves the marker as-is if the variable is not found.
 *
 * @param {string} text
 * @param {Object} context merged metadata context
 * @param {string} filename for warning messages
 * @returns {string}
 */
function resolveVariables(text, context, filename) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in context && context[varName] !== undefined) {
      return String(context[varName]);
    }
    console.warn(`[WARN] Unresolved variable: ${match} in ${filename}`);
    return match;
  });
}

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Post-processing: collapse 3 or more consecutive blank lines into 2.
 * (4+ newlines → 3 newlines = 2 blank lines between paragraphs)
 *
 * @param {string} text
 * @returns {string}
 */
function collapseBlankLines(text) {
  return text.replace(/\n{4,}/g, '\n\n\n');
}

/**
 * Post-processing: ensure every Markdown heading has a blank line before it.
 * Fixes spacing gaps caused by partial concatenation where trimEnd() strips
 * trailing newlines and conditionals add only single \n delimiters.
 *
 * @param {string} text
 * @returns {string}
 */
function ensureBlankLineBeforeHeadings(text) {
  // Blank line before headings
  text = text.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
  // Blank line before and after horizontal rules (---)
  text = text.replace(/([^\n])\n(---)\n/g, '$1\n\n$2\n');
  text = text.replace(/\n(---)\n([^\n])/g, '\n$1\n\n$2');
  return text;
}

/**
 * Normalize line endings to LF (\n) for OS-agnostic output.
 * Converts CRLF (\r\n) first, then strips any remaining stray CR (\r).
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render the agent roster as a numbered Markdown list.
 *
 * @param {Array<{number: number, title: string, short: string}>} roster
 * @param {number} activeNumber the persona's own agent number
 * @returns {string}
 */
function renderRoster(roster, activeNumber) {
  return roster
    .map(entry => {
      const you = entry.number === activeNumber ? ' (YOU)' : '';
      return `${entry.number}. **${entry.title}${you}** (${entry.short})`;
    })
    .join('\n');
}

/**
 * Render the MCP tools array as Markdown table rows.
 *
 * @param {Array<{tool: string, purpose: string, note_only?: boolean}>} tools
 * @returns {string}
 */
function renderMcpToolsTable(tools) {
  return tools
    .filter(t => !t.note_only)
    .map(t => `| \`${t.tool}\` | ${t.purpose} |`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  serializeTools,
  serializeToolsList,
  validateFileName,
  resolvePartials,
  resolveConditionals,
  resolveVariables,
  collapseBlankLines,
  ensureBlankLineBeforeHeadings,
  normalizeNewlines,
  renderRoster,
  renderMcpToolsTable,
};
