/**
 * Batch/collector logic and WAIT-embedding utility for ledger_get_next_action.
 *
 * Extracted from workflow-next-action.ts to keep the main file focused on
 * per-role single-action logic. This module owns:
 *   - embedHandoffStatusInWait  — embeds handoff_status into WAIT responses
 *   - buildBatchNextSteps       — builds next_steps arrays for batch responses
 *   - getNextActionsCollector   — collects up to N actions for a given agent role
 */

import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { type AgentRole } from '../utils/constants.js';
import {
  AGENT_PIPELINE_MAP,
  PIPELINE_PREREQUISITES,
  type PostImplPipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  getHandoffNotesForAgent,
  isStalePipeline,
  agentNameMap,
  actionNameMap,
  reworkActionMap,
} from '../utils/workflow-helpers.js';
import { PIPELINE_AGENT_MAP } from '../utils/pipeline-maps.js';
import { computeHandoffStatus } from './workflow-handoff.js';

/**
 * Post-processes a single-action MCP result: if payload.action === "WAIT",
 * computes handoff_status via computeHandoffStatus and embeds it as a top-level key.
 * Non-WAIT responses and empty projectPath values are returned unchanged.
 * On handoff computation failure, embeds handoff_status_error instead.
 *
 * When `opts.store`, `opts.rootIndex`, and `opts.wpDetails` are all provided, they
 * are forwarded to `computeHandoffStatus` to avoid redundant disk reads — the handoff
 * computation reuses the already-loaded data instead of creating a new LedgerStore.
 * @internal — exposed via _internal for unit tests
 */
export async function embedHandoffStatusInWait(
  mcpResult: { content: Array<{ type: string; text: string }> },
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const text = mcpResult.content[0]?.text;
  if (!text || !projectPath) return mcpResult;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return mcpResult;
  }

  if (payload['action'] !== 'WAIT') return mcpResult;

  try {
    payload['handoff_status'] = await computeHandoffStatus(projectPath, agentRole, opts);
  } catch (err) {
    payload['handoff_status_error'] = (err as Error).message;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build `next_steps` guidance for a batch action entry.
 * Mirrors the step-by-step tool-call instructions from getNextAction's singular helpers,
 * but in compact array form suitable for batch responses.
 * @internal — exported for unit tests only (via _internal)
 */
export function buildBatchNextSteps(
  action: string,
  wpId: string,
  pipelineType: string,
  wpStatus?: string,
  failedPipelineType?: string,
): string[] {
  const agentRole = PIPELINE_AGENT_MAP[pipelineType as keyof typeof PIPELINE_AGENT_MAP] ?? pipelineType;

  switch (action) {
    case 'IMPLEMENT': {
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer")${wpStatus === 'READY' ? ' to claim and start the pipeline in one step' : ' \u2014 WP is already IN_PROGRESS, starts pipeline directly'}.`,
        '2. Read the WP spec, implement the changes, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'REWORK': {
      // Developer rework: failedPipelineType identifies which downstream pipeline failed
      if (failedPipelineType && failedPipelineType !== 'implementation') {
        return [
          `1. Call ledger_get_work_package to review the FAIL ${failedPipelineType} pipeline comments/summary.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer").`,
          '3. Fix the issues identified by the failed pipeline, run tests.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
          `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
        ];
      }
      // Documentation self-rework or Developer implementation rework
      if (pipelineType === 'documentation') {
        return [
          `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "documentation", agent_role: "Documentation").`,
          '3. Fix documentation issues, update affected files.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
          `5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
          `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
        ];
      }
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer") \u2014 WP is already IN_PROGRESS, starts pipeline directly.`,
        '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'RUN_QA':
    case 'RUN_REVIEW':
    case 'WRITE_DOCS': {
      const steps = [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
        `2. Call ledger_get_work_package to review prior pipeline artifacts.`,
        `3. Perform your ${pipelineType} work.`,
        `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "${pipelineType}", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
      ];
      if (pipelineType === 'documentation') {
        steps.push(`5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`);
        steps.push(`6. Call ledger_get_handoff_status (current_agent: "${agentRole}").`);
      } else {
        steps.push(`5. Call ledger_get_handoff_status (current_agent: "${agentRole}").`);
      }
      return steps;
    }
    case 'WAIT_FOR_REWORK':
      return [
        `WP ${wpId}: Waiting for Developer to rework implementation. QA/Reviewer does not self-rework.`,
        `Check ledger_get_next_action for Developer to confirm rework has started.`,
      ];
    case 'WAIT_FOR_DOWNSTREAM':
      return [
        `WP ${wpId}: Implementation pipeline PASS. Waiting for downstream QA/Reviewer pipeline to complete.`,
        `No action required — hand off to QA agent.`,
      ];
    case 'BLOCK_FOR_REWORK_LIMIT':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the rework history.`,
        `2. Escalate to the Project Manager to resolve the rework-limit blocker.`,
        `3. Consider calling ledger_update_work_package_status (work_package_id: "${wpId}", status: "CANCELLED") and creating a replacement WP.`,
      ];
    case 'WAIT_FOR_UPSTREAM_REWORK_LIMIT':
      return [
        `WP ${wpId}: An upstream pipeline has reached the rework limit. Waiting for PM to resolve the blocker.`,
        `No action required — PM must intervene before this pipeline can proceed.`,
      ];
    case 'UNBLOCK_WP':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the blocked state.`,
        `2. Resolve the blocking condition (dependency, decision, or external factor).`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to unblock.`,
      ];
    case 'REVIEW_ABANDONED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the abandoned pipeline.`,
        `2. Cancel the abandoned pipeline or escalate to PM.`,
        `3. Create a replacement WP if the work is still needed.`,
      ];
    case 'REPAIR_ORPHAN_BLOCKED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to inspect the orphan-BLOCKED state.`,
        `2. Verify all dependency WPs are COMPLETE.`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to repair.`,
      ];
    case 'FINALIZE_WP':
      return [
        `1. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'UPDATE_CRITERIA':
      return [
        `1. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", ..., acceptance_criteria_updates: [...]) to mark all criteria as met.`,
        `2. Then call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `3. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'CLAIM_WP':
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
        `2. Perform your pipeline work.`,
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "${pipelineType}", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
      ];
    default:
      return [];
  }
}

/**
 * Collect up to `limit` actionable items for an agent role.
 * Uses the same per-WP evaluation logic as the singular getXxxAction helpers,
 * but without the early-return pattern — results are collected into an array.
 * Only used when max_results > 1 is passed to ledger_get_next_action.
 */
export async function getNextActionsCollector(
  rootIndex: RootIndex,
  store: LedgerStore,
  agentRole: AgentRole,
  limit: number
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const pipelineType = AGENT_PIPELINE_MAP[agentRole];
  if (!pipelineType) {
    // Planner, Synthesis, Project Manager — batch not meaningful
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { actions: [], reason: `Batch actions not applicable for role: ${agentRole}` },
            null,
            2
          ),
        },
      ],
    };
  }

  const actions: object[] = [];
  // Prerequisite type for this agent's pipeline
  const prerequisite = PIPELINE_PREREQUISITES[pipelineType];

  for (const wp of rootIndex.work_packages) {
    if (actions.length >= limit) break;

    const wpDetail = await store.readWorkPackage(wp.work_package_id);

    // Skip stale pipelines (RESUME_OR_CANCEL handling)
    const stale = wpDetail.pipelines.find((p) => p.type === pipelineType && isStalePipeline(p));
    if (stale) {
      const ageHours = stale.started_at
        ? Math.floor((Date.now() - parseTimestamp(stale.started_at).getTime()) / (1000 * 60 * 60))
        : -1;
      actions.push({
        action: 'RESUME_OR_CANCEL',
        work_package_id: wpDetail.work_package_id,
        pipeline_type: pipelineType,
        started_at: stale.started_at ?? 'unknown',
        age_hours: ageHours,
        reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline (~${ageHours}h). Resume or cancel.`,
      });
      continue;
    }

    // For implementation: look for READY/IN_PROGRESS WPs with no implementation pipeline yet
    if (pipelineType === 'implementation') {
      if (
        (wpDetail.status === 'READY' || wpDetail.status === 'IN_PROGRESS') &&
        !hasDependencyBlocked(wpDetail) &&
        !wpDetail.pipelines.some((p) => p.type === 'implementation')
      ) {
        const handoffNotes = wpDetail.assigned_to === 'Developer'
          ? (getHandoffNotesForAgent(wpDetail, 'Developer') ?? undefined)
          : undefined;
        actions.push({
          action: 'IMPLEMENT',
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} is ${wpDetail.status} with no implementation pipeline.`,
          next_steps: buildBatchNextSteps('IMPLEMENT', wpDetail.work_package_id, 'implementation', wpDetail.status),
          ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
        });
        continue;
      }
      // Rework: FAIL implementation pipeline
      if (isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
        actions.push({
          action: 'REWORK',
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline.`,
          next_steps: buildBatchNextSteps('REWORK', wpDetail.work_package_id, 'implementation'),
        });
        continue;
      }
      // Rework: downstream pipeline (QA or code-review) failed — Developer must fix
      const hasPassImpl = wpDetail.pipelines.some(
        (p) => p.type === 'implementation' && p.status === 'PASS'
      );
      if (hasPassImpl) {
        for (const downstreamType of ['qa', 'code-review'] as const) {
          if (isMostRecentPipelineFail(wpDetail.pipelines, downstreamType)) {
            const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
            actions.push({
              action: 'REWORK',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL ${downstreamType} pipeline. Developer rework needed.`,
              pipeline_that_failed: downstreamType,
              next_steps: buildBatchNextSteps('REWORK', wpDetail.work_package_id, 'implementation', undefined, downstreamType),
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            });
            break;
          }
        }
      }
      continue;
    }

    // For qa / code-review / documentation: check prerequisite PASS and no own pipeline yet
    const hasPassPrerequisite =
      prerequisite === null ||
      wpDetail.pipelines.some((p) => p.type === prerequisite && p.status === 'PASS');
    const hasPipelineAlready = wpDetail.pipelines.some((p) => p.type === pipelineType);

    if (hasPassPrerequisite && !hasPipelineAlready) {
      const actionName = actionNameMap[pipelineType as PostImplPipelineType];
      const handoffNotes = getHandoffNotesForAgent(wpDetail, agentNameMap[pipelineType as PostImplPipelineType]);
      actions.push({
        action: actionName,
        work_package_id: wpDetail.work_package_id,
        reason: `Work package ${wpDetail.work_package_id} is ready for ${pipelineType}.`,
        next_steps: buildBatchNextSteps(actionName, wpDetail.work_package_id, pipelineType),
        ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
      });
      continue;
    }

    // BLOCKED WPs: skip rework suggestion to avoid infinite-loop signals.
    // QA/Reviewer do NOT self-rework (WAIT) — only Documentation self-reworks.
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) {
      const reworkAction = reworkActionMap[pipelineType as PostImplPipelineType];
      if (reworkAction === 'WAIT') {
        // QA/Reviewer: Developer must rework first — skip this WP in batch output
        continue;
      }
      actions.push({
        action: reworkAction,
        work_package_id: wpDetail.work_package_id,
        reason: `Work package ${wpDetail.work_package_id} has a FAIL ${pipelineType} pipeline.`,
        next_steps: buildBatchNextSteps(reworkAction, wpDetail.work_package_id, pipelineType),
      });
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ actions, total: actions.length }, null, 2),
      },
    ],
  };
}
