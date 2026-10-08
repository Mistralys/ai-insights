/**
 * scripts/lib/agent-slug-validation.js
 *
 * Validates {{agent_slug_*}} cross-references in ledger persona content files:
 * ensures every {{agent_slug_X_Y}} reference in a persona's rendered content
 * template has a matching slug "x-y" declared in that persona's `subagents`
 * list in its YAML metadata.
 *
 * Extracted from the formerly inline block in scripts/build-personas.js
 * (WP-006 of the 2026-09-30-persona-targets-and-tool-validation-rework-1
 * plan) so it can be unit-tested and made comment-aware. Produces the same
 * messages as the original inline block.
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse a flat dash-prefixed block list from YAML text under `key`.
 * Handles: key:\n  - item1\n  - item2
 * Returns [] when the key is absent, empty, or has an inline scalar value.
 *
 * @param {string} text - raw YAML content
 * @param {string} key - the top-level key to collect a block list under
 * @returns {string[]}
 */
export function extractSubagentsList(text, key) {
  const prefix = key + ':';
  let collecting = false;
  const result = [];

  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;

    if (stripped.startsWith(prefix)) {
      const rest = stripped.slice(prefix.length).trim();
      if (!rest) {
        collecting = true;
      }
      continue;
    }

    if (collecting) {
      if (stripped.startsWith('- ')) {
        let val = stripped.slice(2).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        const ci = val.indexOf(' #');
        if (ci !== -1) val = val.slice(0, ci).trim();
        result.push(val);
      } else {
        break;  // next top-level key — stop collecting
      }
    }
  }
  return result;
}

/**
 * Validates that every {{agent_slug_X_Y}} reference in a ledger persona's
 * content file has a matching slug declared in that persona's `subagents`
 * YAML list.
 *
 * @param {string} metaDir - absolute path to the ledger suite's meta directory
 * @param {string} contentDir - absolute path to the ledger suite's content directory
 * @param {object} [options]
 * @param {(text: string) => string} [options.stripComments] - strips template
 *   comments from content text before scanning for {{agent_slug_*}}
 *   references, so a reference written inside a comment is never counted as
 *   live. Defaults to the identity function when omitted — this covers a
 *   stale `dist/` build of @mistralys/persona-builder predating the
 *   `stripComments` export, or one that failed to load; the check still
 *   runs, just without comment awareness.
 * @returns {string[]} array of error strings (empty = valid)
 */
export function validateAgentSlugReferences(metaDir, contentDir, { stripComments = (t) => t } = {}) {
  const metaFiles = fs.existsSync(metaDir)
    ? fs.readdirSync(metaDir).filter(f => /^\d+-/.test(f) && f.endsWith('.yaml'))
    : [];

  const errors = [];

  for (const yamlFile of metaFiles) {
    const baseName    = yamlFile.replace('.yaml', '');
    const contentPath = path.join(contentDir, baseName + '.md');
    if (!fs.existsSync(contentPath)) continue;

    const subagents   = extractSubagentsList(
      fs.readFileSync(path.join(metaDir, yamlFile), 'utf8'),
      'subagents',
    );
    const contentText = stripComments(fs.readFileSync(contentPath, 'utf8'));

    const agentSlugRe = /\{\{agent_slug_([a-z0-9_]+)\}\}/g;
    let m;
    while ((m = agentSlugRe.exec(contentText)) !== null) {
      const suffix       = m[1];
      const expectedSlug = suffix.replace(/_/g, '-');

      if (!subagents.includes(expectedSlug)) {
        errors.push(
          `Persona "${baseName}": {{agent_slug_${suffix}}} references slug ` +
          `"${expectedSlug}" which is not declared in the subagents list. ` +
          `Add "${expectedSlug}" to the subagents field in ${yamlFile}.`,
        );
      }
    }
  }

  return errors;
}
