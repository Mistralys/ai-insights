/**
 * Project Reset — Analysis & Mutation Logic
 *
 * Provides a semi-intelligent project reset feature that:
 * 1. Analyzes each work package to detect missing pipeline stages
 * 2. Produces a diagnosis with suggested per-WP actions
 * 3. Applies user-confirmed reset decisions atomically
 *
 * The analysis function is pure (no I/O) for easy testing.
 * The apply function routes all WP writes through batchUpdateWorkPackagesWithSync.
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import type { RootIndex } from '../schema/root-index.js';
import { clearSynthesisState } from './workflow-helpers.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { PIPELINE_AGENT_MAP, DEFAULT_PIPELINE_STAGES } from './pipeline-maps.js';
import type { PipelineType } from './pipeline-maps.js';
import { now } from './timestamp.js';
import { isTerminalStatus } from '../schema/validators.js';
import { LedgerStore } from '../storage/ledger-store.js';

// ---------------------------------------------------------------------------
// Diagnosis types
// ---------------------------------------------------------------------------

export interface WpResetDiagnosis {
  work_package_id: string;
  current_status: string;
  current_assigned_to: string | null;
  pipeline_stages_present: string[];
  pipeline_stages_missing: string[];
  active_pipeline_stages: string[];
  next_required_stage: string | null;
  target_assigned_to: string | null;
  needs_reset: boolean;
  reason: string;
  suggested_action: 'reset' | 'skip';
  suggested_reset_criteria: boolean;
}

export interface ProjectResetDiagnosis {
  project_slug: string;
  current_project_status: string;
  work_packages: WpResetDiagnosis[];
  work_packages_needing_reset: number;
  work_packages_healthy: number;
  work_packages_skipped: number;
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

export interface WpDecision {
  action: 'reset' | 'skip' | 'cancel';
  reset_criteria?: boolean;
}

export interface ProjectResetResult {
  diagnosis: ProjectResetDiagnosis;
  applied: true;
  work_packages_reset: string[];
  work_packages_cancelled: string[];
  work_packages_skipped: string[];
  project_comment_added: string;
}

// ---------------------------------------------------------------------------
// Analysis (pure function — no I/O)
// ---------------------------------------------------------------------------

/**
 * Determines which pipeline stages have a PASS for a given work package.
 * Only considers the most recent non-auto-cancelled pipeline of each type.
 */
export function getPassedStages(wp: WorkPackageDetail): Set<string> {
  const passed = new Set<string>();

  // Walk pipelines in reverse to find the most recent of each type
  const seen = new Set<string>();
  for (let i = wp.pipelines.length - 1; i >= 0; i--) {
    const p = wp.pipelines[i]!;
    if (seen.has(p.type)) continue;
    if (p.auto_cancelled) continue;
    seen.add(p.type);
    if (p.status === 'PASS') {
      passed.add(p.type);
    }
  }

  return passed;
}

/**
 * Analyzes a project for reset, producing a per-WP diagnosis.
 *
 * This is a **pure function** — it takes data in and returns a diagnosis
 * without performing any I/O or side effects.
 */
export function analyzeProjectForReset(
  slug: string,
  rootIndex: RootIndex,
  workPackages: WorkPackageDetail[]
): ProjectResetDiagnosis {
  const diagnoses: WpResetDiagnosis[] = [];
  let needingReset = 0;
  let healthy = 0;
  let skippedCancelled = 0;

  for (const wp of workPackages) {
    // 1. CANCELLED WPs — skip entirely
    if (wp.status === 'CANCELLED') {
      skippedCancelled++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: [],
        pipeline_stages_missing: [],
        active_pipeline_stages: [],
        next_required_stage: null,
        target_assigned_to: null,
        needs_reset: false,
        reason: 'CANCELLED — skipped',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
      });
      continue;
    }

    // 2. Identify passed stages
    const passedStages = getPassedStages(wp);
    const stagesPresent: string[] = [];
    const stagesMissing: string[] = [];

    // Resolve the active stage set for this WP.
    // WPs without active_pipeline_stages default to DEFAULT_PIPELINE_STAGES (4-stage legacy).
    const activeStages: readonly PipelineType[] =
      Array.isArray(wp.active_pipeline_stages) && wp.active_pipeline_stages.length > 0
        ? (wp.active_pipeline_stages as PipelineType[])
        : DEFAULT_PIPELINE_STAGES;

    for (const stage of activeStages) {
      if (passedStages.has(stage)) {
        stagesPresent.push(stage);
      } else {
        stagesMissing.push(stage);
      }
    }

    // 3. Determine the next required stage
    let nextRequiredStage: PipelineType | null = null;
    for (const stage of activeStages) {
      if (!passedStages.has(stage)) {
        nextRequiredStage = stage;
        break;
      }
    }

    const targetAssignedTo = nextRequiredStage
      ? PIPELINE_AGENT_MAP[nextRequiredStage]
      : null;

    // 4. Determine if WP needs reset
    const allStagesPass = stagesMissing.length === 0;

    if (allStagesPass && wp.status === 'COMPLETE') {
      // 5. Healthy — all 4 stages PASS and COMPLETE
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: null,
        target_assigned_to: null,
        needs_reset: false,
        reason: `All ${activeStages.length} pipeline stages passed — healthy`,
        suggested_action: 'skip',
        suggested_reset_criteria: false,
      });
      continue;
    }

    // Determine if this WP needs a reset based on its condition
    if (wp.status === 'COMPLETE' && !allStagesPass) {
      // Prematurely completed — missing pipeline stages
      needingReset++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: true,
        reason: `COMPLETE but missing pipeline stages: ${stagesMissing.join(', ')}`,
        suggested_action: 'reset',
        suggested_reset_criteria: true,
      });
      continue;
    }

    if (wp.status === 'IN_PROGRESS') {
      // Check if assigned_to is correct for the next required stage
      const correctAssignment = targetAssignedTo === wp.assigned_to;
      if (correctAssignment && !allStagesPass) {
        // Already in the right state
        healthy++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: nextRequiredStage,
          target_assigned_to: targetAssignedTo,
          needs_reset: false,
          reason: 'IN_PROGRESS with correct assignment — healthy',
          suggested_action: 'skip',
          suggested_reset_criteria: false,
        });
      } else if (!correctAssignment) {
        // Wrong assignment or missing stages
        needingReset++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: nextRequiredStage,
          target_assigned_to: targetAssignedTo,
          needs_reset: true,
          reason: `IN_PROGRESS but assigned to ${wp.assigned_to ?? 'null'} instead of ${targetAssignedTo}`,
          suggested_action: 'reset',
          suggested_reset_criteria: true,
        });
      } else {
        // All stages pass but status is IN_PROGRESS — unusual but healthy
        healthy++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: null,
          target_assigned_to: null,
          needs_reset: false,
          reason: 'All stages passed, IN_PROGRESS — may need manual completion',
          suggested_action: 'skip',
          suggested_reset_criteria: false,
        });
      }
      continue;
    }

    if (wp.status === 'BLOCKED') {
      // BLOCKED WPs — suggest skip, user can override
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: false,
        reason: 'BLOCKED — user should evaluate manually',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
      });
      continue;
    }

    if (wp.status === 'READY') {
      // READY WPs — haven't started, nothing to fix
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: false,
        reason: 'READY — not started yet',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
      });
      continue;
    }

    // Fallback: unknown status — suggest skip
    healthy++;
    diagnoses.push({
      work_package_id: wp.work_package_id,
      current_status: wp.status,
      current_assigned_to: wp.assigned_to,
      pipeline_stages_present: stagesPresent,
      pipeline_stages_missing: stagesMissing,
      active_pipeline_stages: [...activeStages],
      next_required_stage: nextRequiredStage,
      target_assigned_to: targetAssignedTo,
      needs_reset: false,
      reason: `Unknown status '${wp.status}' — skipping`,
      suggested_action: 'skip',
      suggested_reset_criteria: false,
    });
  }

  return {
    project_slug: slug,
    current_project_status: rootIndex.status,
    work_packages: diagnoses,
    work_packages_needing_reset: needingReset,
    work_packages_healthy: healthy,
    work_packages_skipped: skippedCancelled,
  };
}

// ---------------------------------------------------------------------------
// Apply (mutation function — performs I/O under lock)
// ---------------------------------------------------------------------------

/**
 * Applies user-confirmed reset decisions to a project.
 *
 * All writes are routed through `batchUpdateWorkPackagesWithSync`, which
 * acquires a single lock, auto-stamps `last_updated`, and validates every
 * WP via Zod before writing. WPs are re-read inside the lock to guard
 * against stale diagnoses.
 */
export async function applyProjectReset(
  store: LedgerStore,
  diagnosis: ProjectResetDiagnosis,
  decisions: Record<string, WpDecision>
): Promise<ProjectResetResult> {
  const resetIds: string[] = [];
  const cancelledIds: string[] = [];
  const skippedIds: string[] = [];

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const timestamp = now();
    const updatedWps = new Map<string, WorkPackageDetail>();

    for (const wpDiag of diagnosis.work_packages) {
      const wpId = wpDiag.work_package_id;
      const decision = decisions[wpId] ?? { action: 'skip' };

      if (decision.action === 'skip') {
        skippedIds.push(wpId);
        continue;
      }

      // Re-read WP under lock to ensure freshness
      const wp = await readWp(wpId);

      // Guard: if WP status changed since diagnosis, skip with warning
      if (wp.status !== wpDiag.current_status) {
        process.stderr.write(
          `[project-reset] WP ${wpId} status changed from '${wpDiag.current_status}' to '${wp.status}' since diagnosis — skipping.\n`
        );
        skippedIds.push(wpId);
        continue;
      }

      if (decision.action === 'reset') {
        wp.status = 'IN_PROGRESS';
        wp.assigned_to = wpDiag.target_assigned_to ?? wp.assigned_to;
        wp.status_changed_at = timestamp;
        wp.reset_at = timestamp;

        // Optionally reset acceptance criteria
        const resetCriteria = decision.reset_criteria !== false; // default true
        if (resetCriteria && wp.acceptance_criteria) {
          for (const criterion of wp.acceptance_criteria) {
            criterion.met = false;
          }
        }

        // Clear any blocker
        if (wp.blocked_by) {
          delete (wp as Record<string, unknown>).blocked_by;
        }

        updatedWps.set(wpId, wp);
        resetIds.push(wpId);

        // Update WP summary in root index
        const wpSummary = rootIndex.work_packages.find(
          (s) => s.work_package_id === wpId
        );
        if (wpSummary) {
          wpSummary.status = 'IN_PROGRESS';
          wpSummary.assigned_to = wp.assigned_to;
        }
      } else if (decision.action === 'cancel') {
        wp.status = 'CANCELLED';
        wp.status_changed_at = timestamp;

        updatedWps.set(wpId, wp);
        cancelledIds.push(wpId);

        // Update WP summary in root index
        const wpSummary = rootIndex.work_packages.find(
          (s) => s.work_package_id === wpId
        );
        if (wpSummary) {
          wpSummary.status = 'CANCELLED';
          wpSummary.assigned_to = null;
        }
      }
    }

    // Recompute project-level fields
    rootIndex.pending_work_packages = rootIndex.work_packages.filter(
      (wp) => !isTerminalStatus(wp.status)
    ).length;

    rootIndex.status = 'IN_PROGRESS';
    clearSynthesisState(rootIndex);
    rootIndex.auto_handoff_depth = 0;
    rootIndex.last_updated = timestamp;

    // Append audit comment
    const commentParts: string[] = [];
    if (resetIds.length > 0) {
      commentParts.push(`Reset: ${resetIds.join(', ')}`);
    }
    if (cancelledIds.length > 0) {
      commentParts.push(`Cancelled: ${cancelledIds.join(', ')}`);
    }
    if (skippedIds.length > 0) {
      commentParts.push(`Skipped: ${skippedIds.join(', ')}`);
    }

    const commentNote = `Project reset applied. ${commentParts.join('. ')}.`;

    rootIndex.project_comments.push({
      type: 'admin_action',
      priority: 'high',
      timestamp,
      agent: 'GUI',
      note: commentNote,
    });

    return { updatedWps, root: rootIndex };
  });

  return {
    diagnosis,
    applied: true,
    work_packages_reset: resetIds,
    work_packages_cancelled: cancelledIds,
    work_packages_skipped: skippedIds,
    project_comment_added: `Project reset applied. ${resetIds.length} reset, ${cancelledIds.length} cancelled, ${skippedIds.length} skipped.`,
  };
}

// ---------------------------------------------------------------------------
// Mark as Complete (mutation function — performs I/O under lock)
// ---------------------------------------------------------------------------

export interface MarkProjectCompleteResult {
  marked_complete: true;
  work_packages_completed: string[];
  project_comment_added: string;
}

/**
 * Forces every non-CANCELLED work package and the project itself to COMPLETE
 * status in a single lock scope.
 *
 * Use this as a bulk "finish" action when a project is done but its WP
 * pipeline state is inconsistent or incomplete.
 *
 * STDIO discipline: this function never writes to process.stdout.
 */
export async function markProjectComplete(
  store: LedgerStore,
  slug: string
): Promise<MarkProjectCompleteResult> {
  void slug; // slug is held on the store; kept for call-site clarity
  const completedIds: string[] = [];

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const timestamp = now();
    const updatedWps = new Map<string, WorkPackageDetail>();

    for (const wpSummary of rootIndex.work_packages) {
      if (wpSummary.status === 'CANCELLED') continue;

      const wp = await readWp(wpSummary.work_package_id);
      wp.status = 'COMPLETE';
      wp.status_changed_at = timestamp;

      updatedWps.set(wpSummary.work_package_id, wp);
      completedIds.push(wpSummary.work_package_id);

      wpSummary.status = 'COMPLETE';
    }

    rootIndex.status = 'COMPLETE';
    rootIndex.pending_work_packages = 0;
    rootIndex.last_updated = timestamp;

    const note = `Marked project as complete via GUI. ${completedIds.length} work package(s) set to COMPLETE: ${completedIds.join(', ')}.`;

    rootIndex.project_comments.push({
      type: 'admin_action',
      priority: 'low',
      timestamp,
      agent: 'GUI',
      note,
    });

    return { updatedWps, root: rootIndex };
  });

  const note = `Marked project as complete via GUI. ${completedIds.length} work package(s) set to COMPLETE: ${completedIds.join(', ')}.`;

  return {
    marked_complete: true,
    work_packages_completed: completedIds,
    project_comment_added: note,
  };
}
