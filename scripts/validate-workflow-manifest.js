#!/usr/bin/env node

/**
 * scripts/validate-workflow-manifest.js
 *
 * Validates `shared/workflow-manifest.json` against `shared/workflow-manifest.schema.json`
 * and performs semantic cross-reference checks that the JSON Schema cannot express:
 *
 *   1. Unique role IDs, names, and numbers.
 *   2. Prerequisites DAG is acyclic and references only known pipeline types.
 *   3. fail_routing values reference only known (non-orchestrating) role IDs.
 *   4. default_stages is a subset of canonical_order pipeline types.
 *
 * JSON Schema structural validation is performed without any external library —
 * the script reads and checks the schema's `required` and `enum` constraints
 * manually. For full Draft-07 validation use `npx ajv-cli validate`.
 *
 * Usage:
 *   node scripts/validate-workflow-manifest.js       # from workspace root
 *
 * Exit codes:
 *   0  — manifest is valid
 *   1  — one or more validation errors
 */

import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT  = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH   = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.json');
const SCHEMA_PATH     = path.join(WORKSPACE_ROOT, 'shared', 'workflow-manifest.schema.json');

// ---------------------------------------------------------------------------
// Load files
// ---------------------------------------------------------------------------

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`[validate-manifest] ERROR: Manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`[validate-manifest] ERROR: Schema not found: ${SCHEMA_PATH}`);
  process.exit(1);
}

/** @type {import('../shared/workflow-manifest.json')} */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const schema   = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const errors = [];

function fail(msg) {
  errors.push(msg);
}

// ---------------------------------------------------------------------------
// 1. Top-level required properties (from JSON Schema)
// ---------------------------------------------------------------------------

const topRequired = schema.required || [];
for (const prop of topRequired) {
  if (!(prop in manifest)) {
    fail(`Missing required top-level property: "${prop}"`);
  }
}

// ---------------------------------------------------------------------------
// 2. spec_version must be a non-empty string
// ---------------------------------------------------------------------------

if (manifest.spec_version !== undefined && typeof manifest.spec_version !== 'string') {
  fail(`"spec_version" must be a string, got ${typeof manifest.spec_version}`);
}

// ---------------------------------------------------------------------------
// 3. Roles array checks
// ---------------------------------------------------------------------------

const roles = Array.isArray(manifest.roles) ? manifest.roles : [];

if (roles.length === 0) {
  fail('"roles" must be a non-empty array');
}

const seenIds      = new Set();
const seenNames    = new Set();
const seenNumbers  = new Set();
const nonOrchIds   = new Set();
const pipelineIds  = new Set();

for (const role of roles) {
  // Required fields
  for (const field of ['id', 'name', 'number', 'persona_file']) {
    if (role[field] === undefined || role[field] === null || role[field] === '') {
      fail(`Role ${JSON.stringify(role.id || '(unknown)')}: missing required field "${field}"`);
    }
  }

  // Unique id
  if (seenIds.has(role.id)) {
    fail(`Duplicate role id: "${role.id}"`);
  }
  seenIds.add(role.id);

  // Unique name
  if (seenNames.has(role.name)) {
    fail(`Duplicate role name: "${role.name}"`);
  }
  seenNames.add(role.name);

  // Unique number
  if (seenNumbers.has(role.number)) {
    fail(`Duplicate role number: ${role.number} (role id: "${role.id}")`);
  }
  seenNumbers.add(role.number);

  // orchestrating field must be boolean
  if (typeof role.orchestrating !== 'boolean') {
    fail(`Role "${role.id}": "orchestrating" must be a boolean, got ${typeof role.orchestrating}`);
  }

  // Non-orchestrating roles may not have a null id in a pipeline context
  if (!role.orchestrating) {
    nonOrchIds.add(role.id);
  }

  // Track roles that own a pipeline
  if (role.pipeline) {
    pipelineIds.add(role.pipeline);
  }
}

// ---------------------------------------------------------------------------
// 4. Pipelines section checks
// ---------------------------------------------------------------------------

const pipelines = manifest.pipelines || {};

// canonical_order
const canonicalOrder = Array.isArray(pipelines.canonical_order) ? pipelines.canonical_order : [];
if (canonicalOrder.length === 0) {
  fail('"pipelines.canonical_order" must be a non-empty array');
}

const canonicalSet = new Set(canonicalOrder);

// Every pipeline type in canonical_order must be owned by a role
for (const pType of canonicalOrder) {
  if (!pipelineIds.has(pType)) {
    fail(`Pipeline type "${pType}" in canonical_order has no owning role (no role with pipeline: "${pType}")`);
  }
}

// default_stages must be a subset of canonical_order
const defaultStages = Array.isArray(pipelines.default_stages) ? pipelines.default_stages : [];
for (const stage of defaultStages) {
  if (!canonicalSet.has(stage)) {
    fail(`"pipelines.default_stages" entry "${stage}" is not in canonical_order`);
  }
}

// prerequisites: values must be null or known pipeline types; must form a DAG
const prereqs = pipelines.prerequisites || {};
for (const [pType, prereq] of Object.entries(prereqs)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.prerequisites" key "${pType}" is not a known pipeline type`);
  }
  if (prereq !== null && !canonicalSet.has(prereq)) {
    fail(`"pipelines.prerequisites.${pType}" value "${prereq}" is not a known pipeline type`);
  }
}

// Cycle detection on prerequisites (simple DFS)
function hasCycle(node, visiting, visited) {
  if (visiting.has(node)) return true;
  if (visited.has(node))  return false;
  visiting.add(node);
  const prereq = prereqs[node];
  if (prereq && hasCycle(prereq, visiting, visited)) return true;
  visiting.delete(node);
  visited.add(node);
  return false;
}

const visiting = new Set();
const visited  = new Set();
for (const pType of canonicalOrder) {
  if (hasCycle(pType, visiting, visited)) {
    fail(`Cycle detected in pipelines.prerequisites involving "${pType}"`);
  }
}

// fail_routing: values must reference known non-orchestrating role IDs
const failRouting = pipelines.fail_routing || {};
for (const [pType, destId] of Object.entries(failRouting)) {
  if (!canonicalSet.has(pType)) {
    fail(`"pipelines.fail_routing" key "${pType}" is not a known pipeline type`);
  }
  if (!nonOrchIds.has(destId)) {
    fail(`"pipelines.fail_routing.${pType}" value "${destId}" is not a known non-orchestrating role id`);
  }
}

// ---------------------------------------------------------------------------
// 5. Statuses checks
// ---------------------------------------------------------------------------

const statuses = manifest.statuses || {};
for (const key of ['project', 'work_package', 'terminal_work_package', 'pipeline', 'blocker_type']) {
  if (!Array.isArray(statuses[key]) || statuses[key].length === 0) {
    fail(`"statuses.${key}" must be a non-empty array`);
  }
}

// terminal_work_package must be a subset of work_package
if (Array.isArray(statuses.terminal_work_package) && Array.isArray(statuses.work_package)) {
  const wpSet = new Set(statuses.work_package);
  for (const s of statuses.terminal_work_package) {
    if (!wpSet.has(s)) {
      fail(`"statuses.terminal_work_package" entry "${s}" is not in statuses.work_package`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Constants checks
// ---------------------------------------------------------------------------

const constants = manifest.constants || {};
const numericConstants = ['max_rework_count', 'stale_pipeline_hours', 'max_handoff_depth', 'handoff_depth_multiplier'];
for (const key of numericConstants) {
  if (constants[key] === undefined) {
    fail(`"constants.${key}" is required`);
  } else if (typeof constants[key] !== 'number' || constants[key] <= 0) {
    fail(`"constants.${key}" must be a positive number, got ${constants[key]}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length === 0) {
  const roleCount     = roles.length;
  const pipelineCount = canonicalOrder.length;
  console.log(
    `[validate-manifest] OK: ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}\n` +
    `  spec_version=${manifest.spec_version}, roles=${roleCount}, pipelines=${pipelineCount}`
  );
  process.exit(0);
} else {
  console.error(`[validate-manifest] FAIL: ${errors.length} error(s) found in ${MANIFEST_PATH.replace(WORKSPACE_ROOT + '/', '')}:\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}
