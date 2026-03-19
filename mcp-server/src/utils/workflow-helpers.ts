/**
 * Shared workflow helpers — stateless utility functions and constants used by
 * all three workflow tool modules (workflow-next-action, workflow-handoff,
 * workflow-batch-actions).
 *
 * Nothing in this file registers MCP tools or imports tool modules. It imports
 * from `schema/`, `storage/`, sibling `utils/` modules, and `gui/config.ts`
 * for runtime configuration access.
 */

import type { WorkPackageDetail, Pipeline } from '../schema/work-package.js';
import type { RootIndex } from '../schema/root-index.js';
import { parseTimestamp } from './timestamp.js';
import type { PipelineType, PostImplPipelineType } from './pipeline-maps.js';
import { getDownstreamTypes, getUpstreamTypes, resolveFailAgent, DEFAULT_PIPELINE_STAGES } from './pipeline-maps.js';
import { getConfig } from '../gui/config.js';
import { workflowManifest } from '../schema/workflow-manifest-schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of hours after which an IN_PROGRESS pipeline is considered stale.
 * Derived from `constants.stale_pipeline_hours` in the shared workflow manifest.
 */
export const STALE_PIPELINE_HOURS: number = workflowManifest.constants.stale_pipeline_hours;

/**
 * Maximum number of rework cycles allowed before a work package is circuit-broken.
 * When rework_count reaches this value, start_pipeline rejects with guidance to
 * cancel or restructure, and get_next_action surfaces BLOCK_FOR_REWORK_LIMIT.
 *
 * Derived from `constants.max_rework_count` in the shared workflow manifest.
 */
export const MAX_REWORK_COUNT: number = workflowManifest.constants.max_rework_count;

/** Handoff depth fallback when config is unavailable. Derived from manifest. */
const _DEFAULT_MAX_HANDOFF_DEPTH: number = workflowManifest.constants.max_handoff_depth;

/** Multiplier for scaling max handoff depth by project size. Derived from manifest. */
const _HANDOFF_DEPTH_MULTIPLIER: number = workflowManifest.constants.handoff_depth_multiplier;

/**
 * Returns the maximum auto-handoff chain depth from the in-memory config cache.
 * Falls back to the manifest default if the config module has not yet been
 * initialized (e.g. during early startup or in test environments that don't
 * call readConfigFromDisk()).
 */
export function getMaxHandoffDepth(): number {
  try {
    return getConfig().max_handoff_depth;
  } catch {
    return _DEFAULT_MAX_HANDOFF_DEPTH;
  }
}

/**
 * Returns the effective maximum auto-handoff depth, scaled by project size per §18.2.1.
 *
 * The floor is the config default. For larger projects the ceiling
 * grows to avoid terminating the chain prematurely:
 *   effectiveMax = max(configMax, totalWorkPackages × multiplier)
 *
 * Examples (with defaults max=50, multiplier=30):
 *   effectiveMaxDepth(0)  → 50   (0 × 30 = 0 < 50, floor applies)
 *   effectiveMaxDepth(1)  → 50   (1 × 30 = 30 < 50, floor applies)
 *   effectiveMaxDepth(5)  → 150  (5 × 30 = 150 > 50)
 */
export function effectiveMaxDepth(
  totalWorkPackages: number,
  configMax: number = getMaxHandoffDepth(),
): number {
  return Math.max(configMax, totalWorkPackages * _HANDOFF_DEPTH_MULTIPLIER);
}

// ---------------------------------------------------------------------------
// Synthesis state helper
// ---------------------------------------------------------------------------

/**
 * Clears synthesis-related fields on the root index. Centralises the two-line
 * pattern `synthesis_generated = false; synthesis_generated_at = null;` that
 * was previously duplicated at 5 call sites.
 */
export function clearSynthesisState(rootIndex: RootIndex): void {
  rootIndex.synthesis_generated = false;
  rootIndex.synthesis_generated_at = null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the prompt string passed to the next agent during auto-handoff.
 * Intentionally minimal — the receiving agent's persona contains full workflow instructions.
 *
 * When `agentId` is provided, the returned string is prefixed with `@{agentId}\n` so that
 * VS Code recognises it as a routing directive and loads the correct persona before the
 * subagent runs.  The prefix **must** appear at position 0 for VS Code to honour it.
 *
 * When `agentId` is omitted (or `undefined`) the original format is returned unchanged,
 * preserving backward compatibility with persona files that do not carry an `id:` field.
 */
export function buildHandoffPrompt(projectPath: string, agentId?: string): string {
  const body = `Project path: ${projectPath}`;
  return agentId ? `@${agentId}\n${body}` : body;
}

// ---------------------------------------------------------------------------
// Display maps (used by batch-actions and next-action tools)
// ---------------------------------------------------------------------------

/** Display-name maps used by getNextActions for human-readable output.
 * These deliberately exclude 'implementation' — only post-impl stages appear
 * in batch action output. PostImplPipelineType enforces this at compile time. */
export const agentNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};
export const actionNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'RUN_QA',
  'code-review': 'RUN_REVIEW',
  'documentation': 'WRITE_DOCS',
};
export const reworkActionMap: Record<PostImplPipelineType, string> = {
  'qa': 'WAIT',
  'code-review': 'WAIT',
  'documentation': 'REWORK',
};

/** Agent role name used in next_steps tool-call guidance for each pipeline type. */
export const pipelineAgentRoleMap: Record<string, string> = {
  'implementation': 'Developer',
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};

// ---------------------------------------------------------------------------
// Pipeline-state guards
// ---------------------------------------------------------------------------

/**
 * Helper: Returns true if the pipeline is IN_PROGRESS and was started more than
 * STALE_PIPELINE_HOURS hours ago.
 */
export function isStalePipeline(pipeline: Pipeline): boolean {
  if (pipeline.status !== 'IN_PROGRESS' || !pipeline.started_at) return false;
  const startedAt = parseTimestamp(pipeline.started_at).getTime();
  const ageHours = (Date.now() - startedAt) / (1000 * 60 * 60);
  return ageHours > STALE_PIPELINE_HOURS;
}

/**
 * Helper: Returns true only if the most recent non-auto-cancelled pipeline of the
 * given type has FAIL status. Auto-cancelled pipelines are excluded per §14.7 / §21.27.
 * A [FAIL, PASS] sequence correctly returns false — only historical FAILs preceding
 * a PASS are ignored. Treat absent/falsy `auto_cancelled` as false (backward-compatible).
 */
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const matching = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (matching.length === 0) return false;
  return matching.at(-1)!.status === 'FAIL';
}

/**
 * Returns true if any pipeline type downstream of the given type has a most-recent
 * FAIL status (excluding auto-cancelled pipelines per §21.27).
 * Per §11.3. Delegates to isMostRecentPipelineFail() to avoid duplicating filter logic.
 *
 * When activeStages is provided, only stages present in the WP's active set are
 * considered downstream, preventing false-positive rework triggers for inactive stages.
 */
export function hasDownstreamFail(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  activeStages?: readonly PipelineType[],
): boolean {
  const downstreamTypes = getDownstreamTypes(pipelineType, activeStages);
  return downstreamTypes.some((dsType) => isMostRecentPipelineFail(pipelines, dsType));
}

/**
 * Returns an error message if the re-validation guard fires (prerequisite PASS
 * is stale relative to the current pipeline type's most recent run and upstream
 * rework has occurred), or null if the pipeline may proceed.
 *
 * Guard algorithm (§11.1, two-layer check):
 *
 * Layer 1 — Upstream rework check (unconditional, catches first-run stage-skipping):
 *   If any upstream pipeline started after the prerequisite PASSed → BLOCK.
 *
 * Layer 2 — Temporal consistency check (same-type re-runs only):
 *   If the prerequisite PASS predates the last effective run of pipelineType,
 *   but no upstream rework occurred → ALLOW (self-rework scenario).
 */
export function checkRevalidationGuard(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  prerequisite: PipelineType,
  activeStages?: readonly PipelineType[],
): string | null {

  // Find most recent prerequisite PASS (already confirmed PASS by caller)
  const prereqPasses = pipelines.filter(
    (p) => p.type === prerequisite && p.status === 'PASS' && !p.auto_cancelled
  );
  if (prereqPasses.length === 0) return null; // No prereq pass — conservative

  const prereqPass = prereqPasses.at(-1)!;
  if (!prereqPass.completed_at) return null; // Missing timestamp — conservative pass

  const prereqCompletedAt = parseTimestamp(prereqPass.completed_at).getTime();

  // --- Layer 1: Upstream rework check (unconditional — applies regardless of prior runs) ---
  // Detects if any pipeline upstream of the current type was started AFTER the
  // prerequisite PASSed — indicating stale prerequisite. This is decoupled from
  // effectiveSamePipelines so it also catches first-run stage-skipping (e.g.,
  // code-review starting for the first time while a new implementation is in progress).
  const upstreamTypes = getUpstreamTypes(pipelineType, activeStages ?? DEFAULT_PIPELINE_STAGES);
  const hasUpstreamRework = pipelines.some(
    (p) =>
      upstreamTypes.includes(p.type as PipelineType) &&
      !p.auto_cancelled &&
      p.started_at != null &&
      parseTimestamp(p.started_at).getTime() > prereqCompletedAt
  );

  if (hasUpstreamRework) {
    return (
      `Cannot start ${pipelineType}: the prerequisite ${prerequisite} PASS is stale. ` +
      `Upstream rework has occurred since the last ${prerequisite} PASS. ` +
      `Re-run ${prerequisite} to establish a fresh pass before proceeding.`
    );
  }

  // --- Layer 2: Temporal consistency check (same-type re-runs only) ---
  // When the current pipeline type has been run before, verify the prerequisite
  // PASSed AFTER the most recent effective run. If the prerequisite is temporally
  // stale but no upstream rework occurred (layer 1 passed), this is a self-rework
  // scenario (e.g., documentation retrying after its own FAIL) — allow.
  const priorRuns = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (priorRuns.length === 0) return null; // First run — layer 1 already checked upstream

  const baselineRun = priorRuns.at(-1)!;
  if (!baselineRun.started_at) return null; // Missing timestamp — conservative pass

  // If prereq PASS is fresh relative to the baseline run → pass
  // (prereq PASSed after or at the same time the last run started)
  // Since layer 1 already confirmed no upstream rework, any temporal staleness
  // here is a self-rework scenario — allow the pipeline to start.

  return null;
}

/**
 * Returns true when a downstream agent (whose FAIL routes to Developer) has
 * started a pipeline since the most recent upstream PASS. Excludes auto-cancelled
 * pipelines from both upstream and downstream lookups (§21.27).
 *
 * Used by Developer recommendation engine (§14.2 priority 5) to prevent
 * redundant rework cycles (§21.52).
 *
 * When activeStages is provided, only considers downstream types within the WP's
 * active stage set, preventing false-positive triggers for inactive stages.
 */
export function hasDownstreamReengagedSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  activeStages?: readonly PipelineType[],
): boolean {
  // Find most recent upstream PASS (excluding auto-cancelled)
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS' && !p.auto_cancelled)
    .at(-1);

  if (!upstreamPass?.completed_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();

  // Determine which downstream types route FAIL back to Developer.
  // When activeStages is provided, restrict to active downstream types to avoid
  // triggering on stages that are not in this WP's pipeline composition.
  const resolvedActiveStages = activeStages ?? DEFAULT_PIPELINE_STAGES;
  const downstreamTypes = getDownstreamTypes(upstreamType, resolvedActiveStages);
  const developerReworkTypes = downstreamTypes.filter(
    (t) => resolveFailAgent(t, resolvedActiveStages) === 'Developer'
  );
  for (const dsType of developerReworkTypes) {
    const dsPipelines = pipelines.filter(
      (p) => p.type === dsType && !p.auto_cancelled
    );
    if (dsPipelines.length > 0) {
      const mostRecent = dsPipelines.at(-1)!;
      if (mostRecent.started_at) {
        const dsStartedAt = parseTimestamp(mostRecent.started_at).getTime();
        if (dsStartedAt >= upstreamCompletedAt) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Helper function: Check if a WP is blocked by incomplete dependencies.
 *
 * Uses the canonical metadata-based check per §21.54: a WP is classified as
 * "blocked by dependencies" when its status is BLOCKED and either blocked_by
 * is absent (null/undefined) or blocked_by.type === 'dependency'.
 */
export function isBlockedByDependencies(
  wp: WorkPackageDetail,
): boolean {
  if (wp.status !== 'BLOCKED') return false;
  return wp.blocked_by == null || wp.blocked_by.type === 'dependency';
}

/**
 * @deprecated Use isBlockedByDependencies(). Alias retained for backward
 * compatibility with existing call sites.
 */
export const hasDependencyBlocked = isBlockedByDependencies;

/**
 * Helper: Returns true if the downstream pipeline agent should (re-)engage.
 *
 * Handles both first-run and rework cycles via timestamp comparison:
 * - First run: no downstream pipeline exists → always returns true (if upstream PASS exists).
 * - Rework cycle: a new upstream PASS was recorded after the most recent downstream
 *   pipeline started → the downstream agent must re-run.
 * - Already up-to-date: upstream PASS completed before downstream started → returns false.
 * - No upstream PASS: prerequisite not yet met → returns false.
 *
 * Timestamps: compares upstream `completed_at` vs downstream `started_at`. If either
 * timestamp field is absent, falls back to false (conservative: don't trigger spuriously).
 */
export function hasNewUpstreamPassSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  downstreamType: PipelineType
): boolean {
  // No upstream PASS → downstream cannot start yet
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS')
    .at(-1);
  if (!upstreamPass) return false;

  // No downstream pipeline (or only auto-cancelled) → first run, always trigger
  // Auto-cancelled pipelines are excluded from the downstream lookup per §14.6 / §21.27
  const downstreamLatest = pipelines
    .filter((p) => p.type === downstreamType && !p.auto_cancelled)
    .at(-1);
  if (!downstreamLatest) return true;

  // Both timestamps must be present for temporal comparison
  if (!upstreamPass.completed_at || !downstreamLatest.started_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();
  const downstreamStartedAt = parseTimestamp(downstreamLatest.started_at).getTime();

  // Upstream completed at or after downstream started → rework triggered a new cycle
  // Uses >= per §14.6: coincident timestamps (same clock tick) should return true
  return upstreamCompletedAt >= downstreamStartedAt;
}

/**
 * Re-engagement check for P4/P5 priority blocks (§21.66).
 *
 * Collapses the null-prerequisite ternary that would otherwise return `true` and
 * trigger an infinite re-engagement loop when a WP's first active stage is the
 * current agent's stage (i.e. `resolvePrerequisite` returns `null`).
 *
 * Rule: null prerequisite → false (no upstream to re-engage from).
 * Non-null prerequisite → delegate to `hasNewUpstreamPassSince`.
 */
export function makeReEngagementCheck(
  pipelines: Pipeline[],
  prerequisite: PipelineType | null,
  type: PipelineType,
): boolean {
  return prerequisite === null ? false : hasNewUpstreamPassSince(pipelines, prerequisite, type);
}

/**
 * Returns the most recent non-auto-cancelled pipeline for the given work package,
 * or null if no such pipeline exists.
 */
export function mostRecentEffectivePipeline(wp: WorkPackageDetail): Pipeline | null {
  return wp.pipelines.filter((p) => !p.auto_cancelled).at(-1) ?? null;
}

/**
 * Returns true when the WP has an active (IN_PROGRESS and non-stale) pipeline
 * of the specified type. Used to emit CONTINUE_PIPELINE (§21.33) before
 * routing to rework or new-work recommendations.
 */
export function isActivePipeline(
  wp: WorkPackageDetail,
  pipelineType: PipelineType,
): boolean {
  const matching = wp.pipelines.filter(
    (p) => p.type === pipelineType && p.status === 'IN_PROGRESS',
  );
  if (matching.length === 0) return false;
  // Return true if ANY matching IN_PROGRESS pipeline is NOT stale
  return matching.some((p) => !isStalePipeline(p));
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/** Shared response shape returned by action helpers and tool handlers. */
type ToolActionResponse = { content: [{ type: 'text'; text: string }] };

/**
 * Returns a RESUME_OR_CANCEL action response when the work package has a stale
 * IN_PROGRESS pipeline of the specified type, or null if none is found.
 */
export function extractStalePipelineAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
): ToolActionResponse | null {
  const stalePipeline = wpDetail.pipelines.find(
    (p) => p.type === pipelineType && isStalePipeline(p)
  );
  if (!stalePipeline) return null;
  const startedAt = stalePipeline.started_at ?? 'unknown';
  const ageHours = stalePipeline.started_at
    ? Math.floor((Date.now() - parseTimestamp(stalePipeline.started_at).getTime()) / (1000 * 60 * 60))
    : -1;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'RESUME_OR_CANCEL',
            work_package_id: wpDetail.work_package_id,
            pipeline_type: pipelineType,
            started_at: startedAt,
            age_hours: ageHours,
            reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline that has been IN_PROGRESS for ~${ageHours} hours. Resume or cancel it using ledger_cancel_pipeline.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Returns a rework action response when the most recent pipeline of the specified
 * type for the work package has FAIL status, or null if no rework is needed.
 */
export function extractReworkAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
  reworkActionName: string,
  reworkReason: string,
): ToolActionResponse | null {
  // BLOCKED WPs need upstream agent intervention (e.g. Developer rework)
  // before the current pipeline agent can retry — skip rework suggestion.
  if (wpDetail.status === 'BLOCKED') return null;
  if (!isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) return null;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: reworkActionName,
            work_package_id: wpDetail.work_package_id,
            reason: reworkReason,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// WP detail helpers
// ---------------------------------------------------------------------------

/**
 * Helper: Returns handoff notes on the given WP addressed to agentName, or undefined.
 */
export function getHandoffNotesForAgent(
  wpDetail: WorkPackageDetail,
  agentName: string
): string[] | undefined {
  if (!wpDetail.handoff_notes || wpDetail.handoff_notes.length === 0) {
    return undefined;
  }
  const relevant = wpDetail.handoff_notes.filter((n) => n.to_agent === agentName);
  if (relevant.length === 0) return undefined;
  // Flatten all notes from matching entries into a single array
  return relevant.flatMap((n) => n.notes);
}
