/**
 * scripts/lib/cc-tools-validation.js
 *
 * Validates that any persona declaring a `subagents` list also includes
 * `Task` in its effective Claude Code tool list.
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
 */

import fs from 'fs';
import path from 'path';
import { extractYamlSequence } from './yaml-utils.js';

/**
 * Validate a single persona YAML for the cc_tools / subagents invariant.
 *
 * @param {string} yamlText        - raw YAML content of the persona
 * @param {string} filename        - filename for error messages
 * @param {string[]} sharedDefault - default_cc_tools from the suite's _shared.yaml
 *                                   (pass [] when absent)
 * @returns {string[]} array of error strings (empty = valid)
 */
export function validateCcTools(yamlText, filename, sharedDefault = []) {
  const subagents = extractYamlSequence(yamlText, 'subagents');
  if (!subagents || subagents.length === 0) return [];

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
      `${filename}: declares ${subagents.length} subagent(s) but "Task" is missing from the ` +
      `suite's default_cc_tools in _shared.yaml. Add "Task" to default_cc_tools.`,
    ];
  }

  return [
    `${filename}: declares ${subagents.length} subagent(s) but "Task" is missing from ${source}. ` +
    `Add "Task" to the cc_tools list (create cc_tools if absent) so Claude Code can dispatch sub-agents.`,
  ];
}

/**
 * Validate cc_tools / subagents consistency across all persona YAML files in
 * the given meta directories. Reads each suite's _shared.yaml to determine the
 * default_cc_tools fallback before evaluating individual personas.
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
      const text = fs.readFileSync(path.join(metaDir, yamlFile), 'utf8');
      errors.push(...validateCcTools(text, yamlFile, sharedDefault));
    }
  }

  return errors;
}
