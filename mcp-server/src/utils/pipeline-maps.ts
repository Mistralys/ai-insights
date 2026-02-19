/**
 * Shared pipeline routing constants used by pipeline.ts and workflow.ts.
 *
 * Centralising these here eliminates the risk of divergence between the two
 * modules, which is the highest-priority technical debt identified in the
 * Workflow Hardening synthesis report.
 */

/**
 * The four valid pipeline type keys. Using this union as a Record key provides
 * compile-time exhaustiveness checking — a misspelled or missing key is a
 * TypeScript error rather than a silent runtime gap.
 */
export type PipelineType = 'implementation' | 'qa' | 'code-review' | 'documentation';

/**
 * Enforced pipeline execution order.
 * A pipeline type may only start when the prerequisite type has a PASS pipeline.
 * null means no prerequisite (can always start).
 */
export const PIPELINE_PREREQUISITES: Record<PipelineType, PipelineType | null> = {
  'implementation': null,
  'qa': 'implementation',
  'code-review': 'qa',
  'documentation': 'code-review',
};

/**
 * Map of pipeline type to the agent role that owns it.
 * Used to automatically update assigned_to when a pipeline starts.
 */
export const PIPELINE_AGENT_MAP: Record<PipelineType, string> = {
  'implementation': 'Developer',
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};

/**
 * Map of pipeline type to the next agent in the pipeline chain.
 * Used to route handoff notes to the correct recipient agent.
 */
export const NEXT_AGENT_MAP: Record<PipelineType, string> = {
  'implementation': 'QA',
  'qa': 'Reviewer',
  'code-review': 'Documentation',
  'documentation': 'Synthesis',
};

/**
 * Inverse of PIPELINE_AGENT_MAP: maps an agent role to the pipeline type it owns.
 * Derived at runtime from PIPELINE_AGENT_MAP so the two can never silently diverge.
 * Agent names are not a closed union, so the type annotation uses Record<string, string>.
 */
export const AGENT_PIPELINE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PIPELINE_AGENT_MAP).map(([k, v]) => [v, k])
);
