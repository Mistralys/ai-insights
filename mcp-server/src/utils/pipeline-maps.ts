/**
 * Shared pipeline routing constants used by pipeline.ts and workflow.ts.
 *
 * Centralising these here eliminates the risk of divergence between the two
 * modules, which is the highest-priority technical debt identified in the
 * Workflow Hardening synthesis report.
 */

import { z } from 'zod';

/**
 * The six valid pipeline type values as a const tuple, in canonical execution order.
 * Used as the source of truth for the PipelineType union, the Zod enum, and
 * all Record keys that depend on exhaustiveness checking.
 */
export const PIPELINE_TYPES = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'] as const;

/**
 * Zod enum schema for pipeline types. Using this in tool schemas (instead of
 * z.string()) means invalid type values are rejected at the MCP validation
 * layer with a clear error, and `args.type` is automatically narrowed to
 * PipelineType — eliminating the need for `as PipelineType` casts.
 */
export const PipelineTypeEnum = z.enum(PIPELINE_TYPES);

/**
 * Union of all valid pipeline type keys (6 stages).
 */
export type PipelineType = z.infer<typeof PipelineTypeEnum>;

/**
 * The canonical execution order for all six pipeline stages.
 * Dynamic resolve functions filter this ordering by a WP's active_pipeline_stages
 * to compute per-WP routing.
 */
export const CANONICAL_PIPELINE_ORDERING = PIPELINE_TYPES;

/**
 * Backward-compatible default stage set (4-stage legacy workflow).
 * Used as the default activeStages when no per-WP override is specified.
 */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineType[] = [
  'implementation', 'qa', 'code-review', 'documentation',
] as const;

/**
 * Post-implementation stages in the 4-stage legacy workflow.
 * Pinned explicitly so that adding optional stages to PIPELINE_TYPES does NOT
 * cascade into legacy display maps (agentNameMap, actionNameMap, reworkActionMap)
 * that remain 3-entry records.
 */
export type PostImplPipelineType = 'qa' | 'code-review' | 'documentation';

/**
 * Legacy static prerequisite map for the 4-stage default workflow.
 * Partial so that adding new PipelineType values does not force this legacy
 * map to carry 6 entries. New-style WPs should use resolvePrerequisite().
 * null means no prerequisite (can always start).
 */
export const PIPELINE_PREREQUISITES: Partial<Record<PipelineType, PipelineType | null>> = {
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
  'security-audit': 'Security Auditor',
  'code-review': 'Reviewer',
  'release-engineering': 'Release Engineer',
  'documentation': 'Documentation',
};

/**
 * Legacy static next-agent map for the 4-stage default workflow.
 * Partial so that new PipelineType values do not require entries here.
 * New-style WPs should use resolveNextAgent().
 */
export const NEXT_AGENT_MAP: Partial<Record<PipelineType, string>> = {
  'implementation': 'QA',
  'qa': 'Reviewer',
  'code-review': 'Documentation',
  'documentation': 'Synthesis',
};

/**
 * Legacy static fail-routing map for the 4-stage default workflow.
 * Partial so that new PipelineType values do not require entries here.
 * New-style WPs should use resolveFailAgent().
 *
 * Cross-ref: `developerReworkTypes` in workflow-helpers.ts is derived from
 * this map at runtime so the two cannot silently diverge.
 */
export const FAIL_ROUTING_MAP: Partial<Record<PipelineType, string>> = {
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
 * Returns all pipeline types that follow the given type in the active stage ordering.
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
 * Per §8.4 (updated): getDownstreamTypes("implementation") → ["qa", "code-review", "documentation"]
 */
export function getDownstreamTypes(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType[] {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === active.length - 1) return [];
  return [...active.slice(index + 1)];
}

/**
 * Returns all pipeline types that precede the given type in the active stage ordering.
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
 * Per §8.5 (updated): getUpstreamTypes("documentation") → ["implementation", "qa", "code-review"]
 */
export function getUpstreamTypes(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType[] {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === 0) return [];
  return [...active.slice(0, index)];
}

// ---------------------------------------------------------------------------
// Dynamic resolve functions (6-stage aware)
// ---------------------------------------------------------------------------

/**
 * Computes the prerequisite pipeline type for `pipelineType` given the WP's
 * active_pipeline_stages. The canonical ordering filters the active set, and the
 * immediately preceding active stage is the prerequisite.
 * Returns null when `pipelineType` is the first active stage or is not active.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolvePrerequisite(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType | null {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index <= 0) return null; // first stage or not in active set
  return active[index - 1] ?? null;
}

/**
 * Returns the agent that should receive the WP after `pipelineType` completes
 * with PASS, given the WP's active_pipeline_stages.
 * Finds the next active stage in canonical order and returns its owning agent.
 * Returns 'Synthesis' when `pipelineType` is the last active stage.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolveNextAgent(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): string {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === active.length - 1) return 'Synthesis';
  const nextType = active[index + 1];
  if (!nextType) return 'Synthesis'; // guard against unexpected undefined
  return PIPELINE_AGENT_MAP[nextType];
}

/**
 * Returns the agent that should receive the WP after `pipelineType` completes
 * with FAIL (rework routing), given the WP's active_pipeline_stages.
 *
 * Base routing:
 *   implementation, qa, security-audit, code-review → Developer
 *   release-engineering → Release Engineer (self-rework)
 *   documentation → Documentation (self-rework)
 *
 * Fallback: when the standard fail-target agent's stage is not present in
 * activeStages, routes to the agent that owns the first active stage.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolveFailAgent(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): string {
  // Base routing — mirrors the legacy FAIL_ROUTING_MAP extended to all 6 stages.
  const baseAgentMap: Record<PipelineType, string> = {
    'implementation': 'Developer',
    'qa': 'Developer',
    'security-audit': 'Developer',
    'code-review': 'Developer',
    'release-engineering': 'Release Engineer',
    'documentation': 'Documentation',
  };

  const baseAgent = baseAgentMap[pipelineType];

  // Determine the stage the base agent owns (via reverse lookup).
  const baseStage = AGENT_PIPELINE_MAP[baseAgent] as PipelineType | undefined;

  // If the base agent's own stage is active (or there is no stage to check), use base routing.
  if (!baseStage || activeStages.includes(baseStage)) {
    return baseAgent;
  }

  // Fallback: route to the owner of the first active stage.
  const firstActive = CANONICAL_PIPELINE_ORDERING.find((t) => activeStages.includes(t));
  if (!firstActive) return 'Developer'; // ultimate safety fallback
  return PIPELINE_AGENT_MAP[firstActive];
}

/**
 * Returns the active stages filtered and sorted by the canonical pipeline ordering.
 * Replaces the repeated `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t))` pattern.
 */
export function getOrderedActiveStages(
  activeStages: readonly PipelineType[]
): PipelineType[] {
  return CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
}

/**
 * Returns a `.describe()` annotation string for a Zod pipeline type enum,
 * listing all PIPELINE_TYPES in canonical order with the given prefix.
 *
 * Example: describePipelineTypes('Pipeline type:') →
 *   'Pipeline type: "implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"'
 */
export function describePipelineTypes(prefix: string): string {
  return `${prefix} ${PIPELINE_TYPES.map((t) => `"${t}"`).join(', ')}`;
}

/**
 * Returns a `.describe()` annotation string for a Zod agent_role field,
 * listing every pipeline type owner derived from PIPELINE_AGENT_MAP in
 * canonical PIPELINE_TYPES order, plus the PM override note.
 *
 * Example: describePipelineAgents('Your agent role. Must match the pipeline type owner:') →
 *   'Your agent role. Must match the pipeline type owner: "Developer" for implementation, ...
 *    "Documentation" for documentation. "Project Manager" is always allowed (PM Override).'
 */
export function describePipelineAgents(prefix: string): string {
  const mappings = PIPELINE_TYPES.map((t) => `"${PIPELINE_AGENT_MAP[t]}" for ${t}`).join(', ');
  return `${prefix} ${mappings}. "Project Manager" is always allowed (PM Override).`;
}
