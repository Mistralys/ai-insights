/**
 * Shared pipeline start-guard chain.
 *
 * `ledger_start_pipeline` (src/tools/pipeline.ts) and `ledger_begin_work`
 * (src/tools/begin-work.ts) both need to validate and apply the same
 * "start a pipeline on this work package" transition inside their own
 * `updateWorkPackageWithSync` updater callback. Historically each tool
 * carried its own ~90-line copy of this guard chain, so a rework-limit or
 * ordering fix had to be applied twice. `applyPipelineStart()` is the single
 * implementation both callers now invoke.
 *
 * Guard order (applied in this sequence; each guard that rejects throws
 * immediately, aborting the enclosing `updateWorkPackageWithSync` write):
 *
 *   1. Agent role ownership (PM Override bypasses this check).
 *   2. Work package status must be IN_PROGRESS.
 *   3. Pipeline type must be one of the WP's active_pipeline_stages.
 *   4. No duplicate IN_PROGRESS pipeline of the same type.
 *   5. Prerequisite pipeline (if any) must be the most recent non-cancelled
 *      PASS, and must not be stale per the revalidation guard (§11.1).
 *   6. Rework-count increment for a direct or downstream FAIL retry (§11.3).
 *   7. Circuit breaker on the per-type rework count (§11.3) — a stored count
 *      already at MAX_REWORK_COUNT throws (nothing persisted); an increment
 *      that reaches MAX_REWORK_COUNT is persisted and reported via the
 *      `{ kind: 'tripped' }` outcome instead of throwing, so the caller can
 *      commit the counter before surfacing the error to the agent.
 *
 * On success, the new pipeline is appended, `assigned_to` is updated on both
 * the WP detail and its root-index summary row, and `root.last_updated` is
 * stamped — returning `{ kind: 'started' }`.
 */
import { now } from './timestamp.js';
import type { Pipeline, WorkPackageDetail } from '../schema/work-package.js';
import type { RootIndex } from '../schema/root-index.js';
import {
  PIPELINE_AGENT_MAP,
  DEFAULT_PIPELINE_STAGES,
  resolvePrerequisite,
  type PipelineType,
} from './pipeline-maps.js';
import { MAX_REWORK_COUNT, checkRevalidationGuard, hasDownstreamFail } from './workflow-helpers.js';

/** Input to {@link applyPipelineStart}. */
export interface PipelineStartRequest {
  /** The work package detail, as received inside the updater callback. Mutated in place on success/trip. */
  wp: WorkPackageDetail;
  /** The root index, as received inside the updater callback. Mutated in place on success/trip. */
  root: RootIndex;
  /** The work package ID, used verbatim in error messages. */
  workPackageId: string;
  /** The pipeline type to start. */
  type: PipelineType;
  /** The calling agent's role (or 'Project Manager' for a PM Override). */
  agentRole: string;
}

/**
 * Outcome of a successful (non-throwing) call to {@link applyPipelineStart}.
 *
 * - `started`: the new pipeline was appended and `assigned_to` updated.
 * - `tripped`: the rework-count increment reached MAX_REWORK_COUNT. The
 *   counter and `root.last_updated` were already updated on `request.wp` /
 *   `request.root` — the caller must still surface `message` as an error
 *   (after the lock releases, per the existing throw-after-lock pattern in
 *   both callers) without re-throwing inside the updater itself.
 */
export type PipelineStartOutcome =
  | { kind: 'started' }
  | { kind: 'tripped'; message: string };

/**
 * Applies the full pipeline-start guard chain to `request.wp` / `request.root`
 * in place, and returns the outcome. Throws `Error` for any rejected guard —
 * callers rely on `updateWorkPackageWithSync`'s throw-to-abort semantics, so
 * a thrown guard persists nothing.
 */
export function applyPipelineStart(request: PipelineStartRequest): PipelineStartOutcome {
  const { wp, root, workPackageId, type, agentRole } = request;

  // 0. Resolve the WP's active pipeline stages (default to legacy 4-stage).
  const activeStages: readonly PipelineType[] =
    (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;

  // 1. Validate agent role — PM may bypass role ownership (PM Override gate).
  const expectedAgent = PIPELINE_AGENT_MAP[type];
  const isPmOverride = agentRole === 'Project Manager';
  if (!isPmOverride && expectedAgent !== agentRole) {
    throw new Error(
      `Pipeline type '${type}' can only be started by the ${expectedAgent} agent. You provided agent_role: '${agentRole}'.`
    );
  }

  // 2. Validate WP is IN_PROGRESS.
  if (wp.status !== 'IN_PROGRESS') {
    throw new Error(
      `Cannot start pipeline for work package ${workPackageId}: work package status is ${wp.status}. Only IN_PROGRESS work packages can have pipelines started.`
    );
  }

  // 3. Validate requested pipeline type is in the WP's active stages.
  if (!activeStages.includes(type)) {
    throw new Error(
      `Cannot start pipeline '${type}' for work package ${workPackageId}: ` +
      `this pipeline type is not in the WP's active stages. ` +
      `Active stages: ${(activeStages as readonly string[]).join(' → ')}.`
    );
  }

  // 4. Check for duplicate in-progress pipeline of same type.
  const existingInProgress = wp.pipelines.find(
    (p) => p.type === type && p.status === 'IN_PROGRESS'
  );
  if (existingInProgress) {
    throw new Error(
      `Cannot start pipeline: a pipeline of type "${type}" is already IN_PROGRESS for work package ${workPackageId}. Complete the existing pipeline before starting a new one.`
    );
  }

  // 5. Enforce pipeline ordering: compute prerequisite dynamically from active stages (§8.2).
  const prerequisite = resolvePrerequisite(type, activeStages);
  if (prerequisite !== null) {
    const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite && !p.auto_cancelled);
    const mostRecentPrereq = prereqPipelines.at(-1);
    if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
      const orderedActive = (activeStages as readonly string[]).join(' → ');
      throw new Error(
        `Cannot start '${type}' pipeline: requires a PASS '${prerequisite}' pipeline first. ` +
        `Active pipeline order: ${orderedActive}.`
      );
    }

    // 5b. Revalidation guard: reject if a prior run exists and the prerequisite
    //     PASS is stale after upstream rework (§11.1).
    const revalidError = checkRevalidationGuard(wp.pipelines, type, prerequisite, activeStages);
    if (revalidError !== null) {
      throw new Error(revalidError);
    }
  }

  // 6. Create new pipeline entry.
  const newPipeline: Pipeline = {
    type,
    status: 'IN_PROGRESS',
    started_at: now(),
    summary: isPmOverride ? ['[PM Override]'] : [],
  };

  // 7. Increment rework_counts per pipeline type if this is a rework run.
  //    A rework is triggered by either a direct FAIL on this pipeline type or
  //    a downstream FAIL that requires this type to re-run (§11.3).
  const effectiveSamePipelines = wp.pipelines.filter(
    (p) => p.type === type && !p.auto_cancelled
  );
  const isDirectRework = effectiveSamePipelines.at(-1)?.status === 'FAIL';
  const isDownstreamRework = hasDownstreamFail(wp.pipelines, type, activeStages);
  const needsRework = isDirectRework || isDownstreamRework;

  const countBeforeIncrement = wp.rework_counts?.[type] ?? 0;
  if (needsRework) {
    const current = wp.rework_counts?.[type] ?? 0;
    wp.rework_counts = { ...wp.rework_counts, [type]: current + 1 };
  }

  // 7b. Circuit breaker — reject if the per-type rework count has reached the limit.
  // Uses the post-increment count. When the increment itself reaches the limit
  // (stored count was below the maximum), the trip is persisted — counter only,
  // no pipeline appended — so the stored state records that the rework cannot
  // run, and the recommendation engine's `>= MAX_REWORK_COUNT` checks see it.
  // When the stored count is already at or above the maximum, the throw aborts
  // the write and nothing is persisted.
  const effectiveReworkCount = wp.rework_counts?.[type] ?? 0;
  if (effectiveReworkCount >= MAX_REWORK_COUNT) {
    const message =
      `Rework circuit breaker: ${workPackageId} has reached the maximum rework count (${MAX_REWORK_COUNT}). ` +
      `Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`;
    if (countBeforeIncrement >= MAX_REWORK_COUNT) {
      throw new Error(message);
    }
    root.last_updated = now();
    return { kind: 'tripped', message };
  }

  // 8. Append to pipelines array.
  wp.pipelines.push(newPipeline);

  // 9. Update assigned_to to reflect the agent now working on this WP.
  const agentName = PIPELINE_AGENT_MAP[type];
  if (agentName) {
    wp.assigned_to = agentName;
    const summary = root.work_packages.find((s) => s.work_package_id === workPackageId);
    if (summary) {
      summary.assigned_to = agentName;
    }
  }

  // 10. Update root index timestamp.
  root.last_updated = now();

  return { kind: 'started' };
}
