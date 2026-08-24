/**
 * scripts/lib/insight-validation.js
 *
 * Validates insight_agent / insight_report_target pairing and role match
 * across persona YAML metadata. Used by build-personas.js.
 */

import fs from 'fs';
import path from 'path';
import { parseYamlScalars } from './yaml-utils.js';

/**
 * Validate a single persona's YAML text for insight field consistency.
 * @param {string} yamlText - raw YAML content
 * @param {string} filename - filename for error messages
 * @returns {string[]} array of error strings (empty = valid)
 */
export function validateInsightFields(yamlText, filename) {
  const fields = parseYamlScalars(yamlText, ['role', 'insight_agent', 'insight_report_target']);
  const errors = [];

  const hasAgent  = 'insight_agent' in fields;
  const hasTarget = 'insight_report_target' in fields;

  if (hasAgent !== hasTarget) {
    const missing = hasAgent ? 'insight_report_target' : 'insight_agent';
    errors.push(
      `${filename}: defines ${hasAgent ? 'insight_agent' : 'insight_report_target'} ` +
      `but not ${missing}. Both must be declared together.`,
    );
  }

  if (hasAgent && fields.role && fields.insight_agent !== fields.role) {
    errors.push(
      `${filename}: insight_agent "${fields.insight_agent}" differs from ` +
      `role "${fields.role}". They must be identical for ledger personas.`,
    );
  }

  return errors;
}

/**
 * Validate insight fields across all persona YAML files in the given meta directories.
 * @param {string[]} metaDirs - absolute paths to suite meta directories
 * @returns {string[]} array of error strings (empty = all valid)
 */
export function validateInsightFieldsInDirs(metaDirs) {
  const errors = [];

  for (const metaDir of metaDirs) {
    if (!fs.existsSync(metaDir)) continue;
    const yamlFiles = fs.readdirSync(metaDir).filter(
      f => f.endsWith('.yaml') && !f.startsWith('_'),
    );

    for (const yamlFile of yamlFiles) {
      const text = fs.readFileSync(path.join(metaDir, yamlFile), 'utf8');
      errors.push(...validateInsightFields(text, yamlFile));
    }
  }

  return errors;
}
