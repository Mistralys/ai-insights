/**
 * Shared pipeline routing constants used by pipeline.ts and workflow.ts.
 *
 * Centralising these here eliminates the risk of divergence between the two
 * modules, which is the highest-priority technical debt identified in the
 * Workflow Hardening synthesis report.
 */

import { z } from 'zod';

/**
 * The four valid pipeline type values as a const tuple.
 * Used as the source of truth for the PipelineType union, the Zod enum, and
 * all Record keys that depend on exhaustiveness checking.
 */
export const PIPELINE_TYPES = ['implementation', 'qa', 'code-review', 'documentation'] as const;

/**
 * Zod enum schema for pipeline types. Using this in tool schemas (instead of
 * z.string()) means invalid type values are rejected at the MCP validation
 * layer with a clear error, and `args.type` is automatically narrowed to
 * PipelineType — eliminating the need for `as PipelineType` casts.
 */
export const PipelineTypeEnum = z.enum(PIPELINE_TYPES);

/**
 * The four valid pipeline type keys. Using this union as a Record key provides
 * compile-time exhaustiveness checking — a misspelled or missing key is a
 * TypeScript error rather than a silent runtime gap.
 */
export type PipelineType = z.infer<typeof PipelineTypeEnum>;

/**
 * Subset of PipelineType that excludes 'implementation'. Used for maps that
 * only apply to post-implementation pipeline stages (QA, code-review,
 * documentation), providing compile-time exhaustiveness on those maps.
 */
export type PostImplPipelineType = Exclude<PipelineType, 'implementation'>;

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
 * Used to route handoff notes to the correct recipient agent on PASS.
 */
export const NEXT_AGENT_MAP: Record<PipelineType, string> = {
  'implementation': 'QA',
  'qa': 'Reviewer',
  'code-review': 'Documentation',
  'documentation': 'Synthesis',
};

/**
 * Map of pipeline type to the agent that should handle rework on FAIL.
 * QA/code-review/implementation failures route back to Developer;
 * documentation failures stay with Documentation (self-rework).
 *
 * Cross-ref: `developerReworkTypes` in workflow-helpers.ts is derived from
 * this map at runtime so the two cannot silently diverge.
 */
export const FAIL_ROUTING_MAP: Record<PipelineType, string> = {
  'implementation': 'Developer',
  'qa': 'Developer',
  'code-review': 'Developer',
  'documentation': 'Documentation',
};

/**
 * Inverse of PIPELINE_AGENT_MAP: maps an agent role to the pipeline type it owns.
 * Derived at runtime from PIPELINE_AGENT_MAP so the two can never silently diverge.
 * Constructed via PIPELINE_TYPES iteration with an explicit tuple return type so
 * TypeScript infers PipelineType as the value type without needing downstream casts.
 */
export const AGENT_PIPELINE_MAP: Record<string, PipelineType> = Object.fromEntries(
  PIPELINE_TYPES.map((type): [string, PipelineType] => [PIPELINE_AGENT_MAP[type], type])
);

/**
 * Returns all pipeline types that follow the given type in the canonical pipeline
 * ordering (PIPELINE_TYPES). Returns an empty array for the last stage or an
 * unknown type.
 * Per §8.4: getDownstreamTypes("implementation") → ["qa", "code-review", "documentation"]
 */
export function getDownstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index === -1 || index === PIPELINE_TYPES.length - 1) return [];
  return [...PIPELINE_TYPES.slice(index + 1)];
}

/**
 * Returns all pipeline types that precede the given type in the canonical pipeline
 * ordering (PIPELINE_TYPES). Returns an empty array for the first stage or an
 * unknown type.
 * Per §8.5: getUpstreamTypes("documentation") → ["implementation", "qa", "code-review"]
 */
export function getUpstreamTypes(pipelineType: PipelineType): PipelineType[] {
  const index = PIPELINE_TYPES.indexOf(pipelineType);
  if (index === -1 || index === 0) return [];
  return [...PIPELINE_TYPES.slice(0, index)];
}
