/**
 * scripts/lib/yaml-utils.js
 *
 * Lightweight YAML utilities for parsing persona YAML files without external
 * dependencies. Used by build-personas.js and generate-agents-overview.js.
 */

/**
 * Extracts simple scalar (string/number) fields from a YAML file without
 * external dependencies. Only top-level key: value lines are parsed; nested
 * structures and lists are ignored.
 */
export function parseYamlScalars(text, fields) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    if (!fields.includes(key)) continue;
    let val = m[2].trim();
    if (val.startsWith('"') || val.startsWith("'")) {
      const q = val[0];
      const closeIdx = val.indexOf(q, 1);
      if (closeIdx !== -1) {
        val = val.slice(1, closeIdx);
      } else {
        val = val.replace(/\s+#.*$/, '').trim();
      }
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    result[key] = val;
  }
  return result;
}

/**
 * Extracts the string content of a YAML block scalar (`key: |` or `key: |-`).
 * Returns the block content (newline-joined, trimmed) or undefined when the
 * key is absent or does not use a block scalar indicator.
 */
export function extractYamlBlockScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re    = new RegExp(`^${escaped}\\s*:\\s*\\|[-+]?\\s*$`, 'm');
  const match = re.exec(text);
  if (!match) return undefined;

  const after   = text.slice(match.index + match[0].length);
  const lines   = after.split(/\r?\n/);
  let   indent  = -1;
  const content = [];

  for (const line of lines) {
    if (line.trim() === '') {
      if (indent !== -1) content.push('');
      continue;
    }
    const m          = line.match(/^(\s+)/);
    const lineIndent = m ? m[1].length : 0;
    if (lineIndent === 0) break;
    if (indent === -1) indent = lineIndent;
    if (lineIndent < indent) break;
    content.push(line.slice(indent));
  }

  const joined = content.join('\n').trimEnd();
  return joined || undefined;
}

/**
 * Extracts a multi-line-or-single-line string field, accepting either a block
 * scalar (`key: |`) or an inline scalar (`key: value`, quoted or bare).
 * Returns undefined when the key is absent or its value is empty.
 */
export function extractYamlText(text, key) {
  const block = extractYamlBlockScalar(text, key);
  if (block !== undefined) return block;

  const inline = parseYamlScalars(text, [key])[key];
  // An empty block scalar (`key: |`) leaves the bare indicator as the value.
  if (!inline || /^[|>][-+]?$/.test(inline)) return undefined;
  return inline;
}

/**
 * Extracts a YAML sequence (list) value.
 * e.g.:
 *   subagents:
 *     - ledger-wp-decomposer
 *     - ledger-dependency-sequencer
 */
export function extractYamlSequence(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s*:\\s*$`, 'm');
  const match = re.exec(text);
  if (!match) return undefined;

  const after = text.slice(match.index + match[0].length);
  const lines = after.split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const itemMatch = line.match(/^\s+-\s+(\S.*)$/);
    if (!itemMatch) {
      if (line.trim() !== '') break;
      continue;
    }
    items.push(itemMatch[1].trim());
  }

  return items.length > 0 ? items : undefined;
}
