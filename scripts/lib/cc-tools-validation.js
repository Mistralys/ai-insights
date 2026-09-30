/**
 * scripts/lib/cc-tools-validation.js
 *
 * Validates that any persona that dispatches under Claude Code also includes
 * `Task` in its effective Claude Code tool list. A persona dispatches when it
 * declares a `subagents` list, or when its content file includes the
 * `handoff-block-claude-code` partial (the ledger auto-handoff, which invokes
 * `Task` to start the successor agent).
 *
 * Rationale: Claude Code dispatches sub-agents via the `Task` tool. A persona
 * whose YAML lists subagents but lacks `Task` in `cc_tools` (or in `tools`
 * when `cc_tools` is absent) will fail silently at runtime — the agent
 * instructions tell it to spawn a sub-agent but the tool is not granted.
 *
 * Effective CC tool list resolution (mirrors the build system's own logic):
 *   1. If `cc_tools` is present on the persona → use it.
 *   2. Else if `tools` is present on the persona → fall back to `tools`.
 *   3. Else → fall back to `_shared.yaml`'s `default_cc_tools`.
 *
 * The suite-level _shared.yaml fallback (case 3) is only flagged when the
 * shared default itself lacks Task. In practice every suite's _shared.yaml
 * already includes Task, so an error is only raised when a persona-level
 * explicit list (cc_tools or tools) overrides that default and omits Task.
 *
 * The handoff-partial trigger matters because a per-persona `cc_tools`
 * override replaces `default_cc_tools` entirely: an override added for an
 * unrelated grant silently drops `Task`, and the persona's auto-handoffs then
 * cannot fire under Claude Code.
 */

import fs from 'fs';
import path from 'path';
import { extractYamlSequence } from './yaml-utils.js';

/** Matches an include of the Claude Code auto-handoff partial. */
const HANDOFF_PARTIAL_RE = /\{\{>\s*handoff-block-claude-code\s*\}\}/;

/**
 * Validate a single persona YAML for the cc_tools / subagents invariant.
 *
 * @param {string} yamlText        - raw YAML content of the persona
 * @param {string} filename        - filename for error messages
 * @param {string[]} sharedDefault - default_cc_tools from the suite's _shared.yaml
 *                                   (pass [] when absent)
 * @param {string} [contentText]   - raw content Markdown of the persona, used to
 *                                   detect the Claude Code handoff partial
 *                                   (pass '' or omit when unavailable)
 * @returns {string[]} array of error strings (empty = valid)
 */
export function validateCcTools(yamlText, filename, sharedDefault = [], contentText = '') {
  const subagents  = extractYamlSequence(yamlText, 'subagents') ?? [];
  const hasHandoff = HANDOFF_PARTIAL_RE.test(contentText);
  if (subagents.length === 0 && !hasHandoff) return [];

  const reasons = [];
  if (subagents.length > 0) reasons.push(`declares ${subagents.length} subagent(s)`);
  if (hasHandoff) reasons.push('includes the handoff-block-claude-code partial');
  const why = reasons.join(' and ');

  // Determine the effective CC tool list.
  const ccTools = extractYamlSequence(yamlText, 'cc_tools');
  const vsTools = extractYamlSequence(yamlText, 'tools');

  let effective;
  let source;

  if (ccTools) {
    effective = ccTools;
    source    = 'cc_tools';
  } else if (vsTools) {
    effective = vsTools;
    source    = 'tools (used as cc_tools fallback)';
  } else {
    // No persona-level tool list — suite's default_cc_tools applies.
    effective = sharedDefault;
    source    = '_shared.yaml default_cc_tools';
  }

  const toolNames = effective.map(t => t.trim());
  if (toolNames.includes('Task')) return [];

  // Only flag the shared-default case when the default itself is missing Task,
  // since that is a suite-level misconfiguration rather than a per-persona one.
  if (!ccTools && !vsTools) {
    return [
      `${filename}: ${why} but "Task" is missing from the ` +
      `suite's default_cc_tools in _shared.yaml. Add "Task" to default_cc_tools.`,
    ];
  }

  return [
    `${filename}: ${why} but "Task" is missing from ${source}. ` +
    `Add "Task" to the cc_tools list (create cc_tools if absent) so Claude Code can dispatch sub-agents and run the auto-handoff.`,
  ];
}

/**
 * Validate cc_tools / subagents consistency across all persona YAML files in
 * the given meta directories. Reads each suite's _shared.yaml to determine the
 * default_cc_tools fallback before evaluating individual personas. Each
 * persona's content file is read from the sibling `content/` directory
 * (same basename, `.md`) when it exists.
 *
 * @param {string[]} metaDirs - absolute paths to suite meta directories
 * @returns {string[]} array of error strings (empty = all valid)
 */
export function validateCcToolsInDirs(metaDirs) {
  const errors = [];

  for (const metaDir of metaDirs) {
    if (!fs.existsSync(metaDir)) continue;

    // Load the suite-level shared default_cc_tools (may be absent for some suites).
    const sharedPath    = path.join(metaDir, '_shared.yaml');
    const sharedDefault = fs.existsSync(sharedPath)
      ? (extractYamlSequence(fs.readFileSync(sharedPath, 'utf8'), 'default_cc_tools') ?? [])
      : [];

    const yamlFiles = fs.readdirSync(metaDir).filter(
      f => f.endsWith('.yaml') && !f.startsWith('_'),
    );

    for (const yamlFile of yamlFiles) {
      const text        = fs.readFileSync(path.join(metaDir, yamlFile), 'utf8');
      const contentPath = path.join(metaDir, '..', 'content', yamlFile.replace(/\.yaml$/, '.md'));
      const content     = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : '';
      errors.push(...validateCcTools(text, yamlFile, sharedDefault, content));
    }
  }

  return errors;
}
