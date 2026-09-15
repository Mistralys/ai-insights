/**
 * scripts/lib/frontmatter.js
 *
 * Shared YAML frontmatter parser for deployed persona files. Extracted
 * verbatim from scripts/sync-personas.js's former private parseFrontmatter()
 * so both sync-personas.js and scripts/launch-agent.js can share a single
 * source of truth for this logic.
 */

import fs from 'fs';

/**
 * Parse YAML frontmatter fields from a persona file into a plain object.
 * Returns null if the file has no valid YAML frontmatter block.
 * @param {string} filePath
 * @returns {Object|null}
 */
export function parseFrontmatter(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const content = rawContent.startsWith('<!--') ? rawContent.slice(rawContent.indexOf('\n') + 1) : rawContent;
    if (!content.startsWith('---')) return null;
    const afterFirst = content.slice(3);
    const closingIdx = afterFirst.indexOf('\n---');
    if (closingIdx === -1) return null;
    const fields = {};
    for (const line of afterFirst.slice(0, closingIdx).split('\n')) {
      const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return fields;
  } catch {
    return null;
  }
}
