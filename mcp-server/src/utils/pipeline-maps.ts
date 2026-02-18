/**
 * Shared pipeline routing constants used by pipeline.ts and workflow.ts.
 *
 * Centralising these here eliminates the risk of divergence between the two
 * modules, which is the highest-priority technical debt identified in the
 * Workflow Hardening synthesis report.
 */

/**
 * Enforced pipeline execution order.
 * A pipeline type may only start when the prerequisite type has a PASS pipeline.
 * null means no prerequisite (can always start).
 */
export const PIPELINE_PREREQUISITES: Record<string, string | null> = {
  'implementation': null,
  'qa': 'implementation',
  'code-review': 'qa',
  'documentation': 'code-review',
};

/**
 * Map of pipeline type to the agent role that owns it.
 * Used to automatically update assigned_to when a pipeline starts.
 */
export const PIPELINE_AGENT_MAP: Record<string, string> = {
  'implementation': 'Developer',
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};

/**
 * Map of pipeline type to the next agent in the pipeline chain.
 * Used to route handoff notes to the correct recipient agent.
 */
export const NEXT_AGENT_MAP: Record<string, string> = {
  'implementation': 'QA',
  'qa': 'Reviewer',
  'code-review': 'Documentation',
  'documentation': 'Synthesis',
};

/**
 * Inverse of PIPELINE_AGENT_MAP: maps an agent role to the pipeline type it owns.
 * Replaces the local PIPELINE_TYPE_MAP constant in workflow.ts.
 */
export const AGENT_PIPELINE_MAP: Record<string, string> = {
  Developer: 'implementation',
  QA: 'qa',
  Reviewer: 'code-review',
  Documentation: 'documentation',
};
