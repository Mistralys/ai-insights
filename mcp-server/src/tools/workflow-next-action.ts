import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { isTerminalStatus, canStartWorkPackage } from '../schema/validators.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  PIPELINE_TYPES,
  PIPELINE_AGENT_MAP,
  type PipelineType,
  resolvePrerequisite,
  resolveFailAgent,
  DEFAULT_PIPELINE_STAGES,
  getOrderedActiveStages,
  firstActiveStage,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  extractStalePipelineAction,
  isMostRecentPipelineFail,
  latestNonCancelledPipeline,
  hasDependencyBlocked,
  hasDownstreamFail,
  hasDownstreamReengagedSince,
  isActivePipeline,
  getHandoffNotesForAgent,
  hasNewUpstreamPassSince,
  makeReEngagementCheck,
  mostRecentEffectivePipeline,
  MAX_REWORK_COUNT,
  STALE_PIPELINE_HOURS,
} from '../utils/workflow-helpers.js';
import { embedHandoffStatusInWait, buildBatchNextSteps, getNextActionsCollector } from './workflow-next-action-batch.js';

/** Handler signature for per-role next-action functions. */
type NextActionHandler = (
  rootIndex: RootIndex,
  store: LedgerStore,
  wpDetails: WorkPackageDetail[],
) => Promise<{ content: Array<{ type: string; text: string }> }>;

/**
 * Manifest-typed dispatch map from agent role → next-action handler.
 *
 * Keyed by `AgentRole` (derived from the shared workflow manifest) so that
 * TypeScript flags any mismatch when a role is added, removed, or renamed.
 * Planner and the default case are handled before dispatch.
 */
const NEXT_ACTION_DISPATCH: Partial<Record<AgentRole, NextActionHandler>> = {
  'Project Manager':  (r, s, w) => getProjectManagerAction(r, s, w),
  'Developer':        (r, s, w) => getDeveloperAction(r, s, w),
  'QA':               (r, s, w) => getQaAction(r, s, w),
  'Security Auditor': (r, s, w) => getSecurityAuditorAction(r, s, w),
  'Reviewer':         (r, s, w) => getReviewerAction(r, s, w),
  'Release Engineer': (r, s, w) => getReleaseEngineerAction(r, s, w),
  'Documentation':    (r, s, w) => getDocumentationAction(r, s, w),
  'Synthesis':        () => Promise.resolve(getSynthesisAction()),
};
/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  agent_role: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"'
    ),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of actionable WPs to return (default: 1). When > 1, returns up to this many actions as an array under the "actions" key instead of a single action object. Useful for projects with many independent WPs.'),
});

async function getNextAction(args: z.infer<typeof GetNextActionSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.agent_role as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.agent_role}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Load all WP details once — reused by per-role action functions and the
    // handoff status bypass in embedHandoffStatusInWait (avoids duplicate reads).
    // Safe for zero-WP projects: Promise.all([]) resolves to [].
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

    // If project has no work packages yet, recommend based on agent role
    if (rootIndex.work_packages.length === 0) {
      if (args.agent_role === 'Project Manager') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'CREATE_WORK_PACKAGES',
                  reason:
                    'Project ledger exists but has no work packages. PM should decompose the plan into work packages.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        return await embedHandoffStatusInWait(
          {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason: `No work packages exist yet. Wait for Project Manager to create work packages.`,
                  },
                  null,
                  2
                ),
              },
            ],
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      }
    }

    // Check if all work packages are terminal (COMPLETE or CANCELLED)
    const allComplete = rootIndex.work_packages.every(
      (wp) => isTerminalStatus(wp.status)
    );

    if (allComplete) {
      if (args.agent_role === 'Synthesis') {
        // Only offer GENERATE_SYNTHESIS once — guard with synthesis_generated flag
        if (rootIndex.synthesis_generated) {
          return await embedHandoffStatusInWait(
            {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      action: 'WAIT',
                      reason: 'Synthesis report has already been generated. Nothing to do.',
                    },
                    null,
                    2
                  ),
                },
              ],
            },
            projectPath,
            args.agent_role,
            { store, rootIndex, wpDetails }
          );
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'GENERATE_SYNTHESIS',
                  reason:
                    'All work packages are COMPLETE. Generate synthesis report.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else if (args.agent_role === 'Project Manager') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'SIGNAL_SYNTHESIS',
                  reason:
                    'All work packages are COMPLETE. Signal for Synthesis agent.',
                },
                null,
                2
              ),
            },
          ],
        };
      } else {
        return await embedHandoffStatusInWait(
          {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason: 'All work packages are COMPLETE. Project is ready for Synthesis agent.',
                  },
                  null,
                  2
                ),
              },
            ],
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      }
    }

    // If max_results > 1, use batch collector mode
    if (args.max_results !== undefined && args.max_results > 1) {
      return getNextActionsCollector(rootIndex, store, args.agent_role as AgentRole, args.max_results);
    }

    // Agent-specific logic (dispatch map is typed by AgentRole from the manifest)
    const actionHandler = NEXT_ACTION_DISPATCH[args.agent_role as AgentRole];
    if (actionHandler) {
      return await embedHandoffStatusInWait(
        await actionHandler(rootIndex, store, wpDetails),
        projectPath,
        args.agent_role,
        { store, rootIndex, wpDetails }
      );
    }
    return await embedHandoffStatusInWait(
      {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WAIT',
                reason: `No action available for agent role: ${args.agent_role}`,
              },
              null,
              2
            ),
          },
        ],
      },
      projectPath,
      args.agent_role,
      { store, rootIndex, wpDetails }
    );
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Get next action for Synthesis agent when project is still in progress.
 */
function getSynthesisAction() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason: 'Not all work packages are COMPLETE. Wait for all WPs to finish.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Project Manager.
 * Implements the 5-priority algorithm from §14.1.2.
 */
export async function getProjectManagerAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details (needed for pipeline and rework state checks; skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // --- Priority 1: UNBLOCK_WP ---
  // BLOCKED WPs with non-dependency blockers requiring human/PM intervention
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (blockerType === 'decision' || blockerType === 'external' || blockerType === 'technical') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'UNBLOCK_WP',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a ${blockerType} blocker. Investigate and resolve.`,
            }, null, 2),
          }],
        };
      }
    }
  }

  // --- Priority 2: REVIEW_REWORK_LIMIT ---
  // IN_PROGRESS WPs where any rework_counts entry >= MAX_REWORK_COUNT
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS' && wpDetail.rework_counts) {
      for (const [type, count] of Object.entries(wpDetail.rework_counts)) {
        if (typeof count === 'number' && count >= MAX_REWORK_COUNT) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_REWORK_LIMIT',
                work_package_id: wpDetail.work_package_id,
                reason: `Rework limit reached for ${type} pipeline.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3: REVIEW_STALE ---
  // IN_PROGRESS WPs with any stale IN_PROGRESS pipeline
  const allPipelineTypes: readonly string[] = PIPELINE_TYPES;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      for (const pipelineType of allPipelineTypes) {
        const staleAction = extractStalePipelineAction(wpDetail, pipelineType);
        if (staleAction) {
          const innerData = JSON.parse(staleAction.content[0].text) as { age_hours: number };
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_STALE',
                work_package_id: wpDetail.work_package_id,
                pipeline_type: pipelineType,
                age_hours: innerData.age_hours,
                reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline (~${innerData.age_hours}h). Investigate and resume or cancel.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3b: REVIEW_ABANDONED ---
  // IN_PROGRESS WPs with no active IN_PROGRESS pipelines and last activity > STALE_PIPELINE_HOURS
  const staleThresholdMs = STALE_PIPELINE_HOURS * 60 * 60 * 1000;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasActivePipeline = wpDetail.pipelines.some((p) => p.status === 'IN_PROGRESS');
      if (!hasActivePipeline) {
        const now = Date.now();
        const lastEffective = mostRecentEffectivePipeline(wpDetail);
        if (lastEffective) {
          if (lastEffective.completed_at) {
            const completedAt = parseTimestamp(lastEffective.completed_at).getTime();
            if (now - completedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no active pipelines. Last activity was more than ${STALE_PIPELINE_HOURS} hours ago.`,
                  }, null, 2),
                }],
              };
            }
          }
        } else {
          // No effective pipeline — use status_changed_at for grace period check
          if (wpDetail.status_changed_at) {
            const changedAt = parseTimestamp(wpDetail.status_changed_at).getTime();
            if (now - changedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no pipelines and has been idle for more than ${STALE_PIPELINE_HOURS} hours.`,
                  }, null, 2),
                }],
              };
            }
            // within grace period — skip
          }
          // No status_changed_at and no pipelines — recently claimed, skip
        }
      }
    }
  }

  // --- Priority 3c: REPAIR_ORPHAN_BLOCKED ---
  // BLOCKED WPs with dependency blocker (or absent blocked_by) where all deps are now terminal
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (!blockerType || blockerType === 'dependency') {
        const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
        if (canStart.allowed) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REPAIR_ORPHAN_BLOCKED',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a dependency that has since completed. Auto-unblock did not run. Investigate and unblock.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3d: ROUTE_PIPELINE_AGENT ---
  // Fires only when no READY WPs remain (step 2 found nothing). Scans each non-terminal,
  // non-dependency-blocked IN_PROGRESS WP for a pipeline stage that needs to be started.
  // Covers two distinct cases:
  //   Case A — mid-flight PASS advance: a stage has PASSed and the next active stage has
  //             no pipeline started yet. Routes to PIPELINE_AGENT_MAP[nextStage].
  //   Case B — zero-pipeline bootstrap: a WP was freshly claimed but the owning agent has
  //             not yet called startPipeline. No pipelines exist, so the first active stage
  //             has no PASS, FAIL, or IN_PROGRESS — routes to PIPELINE_AGENT_MAP[firstActiveStage].
  // Guards: FAIL stages are skipped (handled by downstream agent's own FAIL routing),
  //         IN_PROGRESS stages are skipped (stage already being worked on),
  //         upstream IN_PROGRESS stages are skipped (premature routing prevention),
  //         dependency-blocked WPs are excluded entirely.
  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status !== 'IN_PROGRESS') continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const activeStages = getOrderedActiveStages(
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
    );

    for (const stage of activeStages) {
      const mostRecent = latestNonCancelledPipeline(wpDetail.pipelines, stage);

      if (mostRecent?.status === 'PASS') continue; // stage done, check next
      if (mostRecent?.status === 'FAIL') break;     // FAIL routing handles this WP
      if (mostRecent?.status === 'IN_PROGRESS') break; // stage already being worked on

      // Check upstream prerequisite for premature routing prevention
      const upstream = resolvePrerequisite(stage, activeStages);
      if (upstream) {
        if (latestNonCancelledPipeline(wpDetail.pipelines, upstream)?.status === 'IN_PROGRESS') break;
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'ROUTE_PIPELINE_AGENT',
            work_package_id: wpDetail.work_package_id,
            pipeline_type: stage,
            next_agent: PIPELINE_AGENT_MAP[stage],
            reason: `Work package ${wpDetail.work_package_id} needs its ${stage} stage started. Route to ${PIPELINE_AGENT_MAP[stage]}.`,
          }, null, 2),
        }],
      };
    }
  }

  // --- Final Fallback: WAIT ---
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No actionable items found.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Developer.
 * Per-WP priority evaluation from §14.2.
 */
export async function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal (COMPLETE, CANCELLED) and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where implementation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('implementation')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // P1: BLOCK_FOR_REWORK_LIMIT (IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const implReworkCount = wpDetail.rework_counts?.implementation ?? 0;
      if (implReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: implReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). It cannot proceed with further implementation cycles.`,
              next_steps: [
                `1. Review the rework history in ${wpDetail.work_package_id} to understand repeated failures.`,
                `2. Consider cancelling this WP via ledger_update_work_package_status (status: "CANCELLED") and creating a replacement WP with a revised approach.`,
                `3. Alternatively, restructure the work package scope to address the root cause of repeated failures.`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer") to continue the workflow.`,
              ],
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale IN_PROGRESS implementation pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'implementation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale implementation pipeline)
    if (isActivePipeline(wpDetail, 'implementation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active implementation pipeline in progress. Continue working on it.`,
            next_steps: [
              `1. Complete the current implementation work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (direct fail — most recent implementation pipeline is FAIL)
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") — WP is already IN_PROGRESS, starts pipeline directly.`,
              '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5 + P5b: Downstream FAIL checks (only meaningful when implementation has PASS)
    const hasPassImpl = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS' && !p.auto_cancelled
    );
    if (hasPassImpl && hasDownstreamFail(wpDetail.pipelines, 'implementation', activeStages)) {
      if (hasDownstreamReengagedSince(wpDetail.pipelines, 'implementation', activeStages)) {
        // P5: REWORK (downstream triggered — downstream re-ran after last impl PASS)
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'REWORK',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a downstream failure after implementation was accepted. Downstream re-engagement detected.`,
              next_steps: [
                `1. Call ledger_get_work_package to review the downstream FAIL pipeline comments/summary.`,
                `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to begin a new implementation cycle.`,
                '3. Fix the issues identified by the failed pipeline, run tests.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      } else {
        // P5b: WAIT_FOR_DOWNSTREAM — fix delivered, downstream hasn't re-engaged yet
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_DOWNSTREAM',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id}: fix delivered; awaiting downstream re-engagement.`,
            }, null, 2),
          }],
        };
      }
    }

    // P6: IMPLEMENT (IN_PROGRESS, no implementation pipeline started yet)
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasImplPipeline = wpDetail.pipelines.some((p) => p.type === 'implementation' && !p.auto_cancelled);
      if (!hasImplPipeline) {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'IMPLEMENT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no implementation pipeline. Implement.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer").`,
                '2. Read the WP spec, implement the changes, run tests.',
                `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P7: CLAIM_WP (READY, dependencies satisfied, unassigned or assigned to Developer)
    if (wpDetail.status === 'READY' && (wpDetail.assigned_to == null || wpDetail.assigned_to === 'Developer')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Developer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to claim and start the pipeline in one step.`,
              '2. Read the WP spec, implement the changes, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for implementation. All WPs either have implementation pipelines or are blocked.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for QA.
 * Per-WP priority evaluation from §14.3.
 */
export async function getQaAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where qa is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('qa')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for qa in this WP's active stages
    const qaPrerequisite = resolvePrerequisite('qa', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (QA's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const qaReworkCount = wpDetail.rework_counts?.qa ?? 0;
      if (qaReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: qaReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} QA has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (qaPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[qaPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${qaPrerequisite} has reached the maximum rework count. QA cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale QA pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'qa');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale QA pipeline)
    if (isActivePipeline(wpDetail, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active QA pipeline in progress. Continue QA work.`,
            next_steps: [
              `1. Complete the current QA work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_QA (re-engagement) — at least one prior QA pipeline AND new upstream PASS since then
    const priorQaPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'qa' && !p.auto_cancelled
    );
    const hasNewPrereqPassForQa = makeReEngagementCheck(wpDetail.pipelines, qaPrerequisite, 'qa');
    if (priorQaPipelines.length > 0 && hasNewPrereqPassForQa) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last QA pipeline. Re-run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — QA FAIL routes back to QA when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      const qaFailAgent = resolveFailAgent('qa', activeStages);
      if (qaFailAgent === 'QA') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_QA',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. QA is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run QA.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior QA FAIL. Re-execute the Verification Stack.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "QA").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent QA is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. The fail-target agent must rework before QA can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_QA (first-run) — no prior QA pipeline + prerequisite has PASS (or no prerequisite)
    const hasPrereqPass = qaPrerequisite === null
      ? true // qa is first active stage, can always start
      : wpDetail.pipelines.some(
          (p) => p.type === qaPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasPrereqPass && priorQaPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: qaPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no QA pipeline. Run QA.`
              : `Work package ${wpDetail.work_package_id} has no prior QA pipeline and qa is the first active stage. Run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to QA)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'QA') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to QA with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "QA") to transition to IN_PROGRESS.`,
              `2. Wait for implementation pipeline to complete before starting QA.`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for QA. All WPs either lack implementation pipelines or already have QA pipelines.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Reviewer.
 * Per-WP priority evaluation from §14.4.
 */
export async function getReviewerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where code-review is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('code-review')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for code-review in this WP's active stages
    const reviewPrerequisite = resolvePrerequisite('code-review', activeStages);

    // Compute active stages before code-review for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const crIdx = orderedActive.indexOf('code-review');
    const upstreamActiveStages = crIdx > 0 ? orderedActive.slice(0, crIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (Reviewer's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const reviewReworkCount = wpDetail.rework_counts?.['code-review'] ?? 0;
      if (reviewReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: reviewReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} code-review has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Reviewer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale code-review pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'code-review');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale code-review pipeline)
    if (isActivePipeline(wpDetail, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active code-review pipeline in progress. Continue review work.`,
            next_steps: [
              `1. Complete the current code review for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_REVIEW (re-engagement) — at least one prior review pipeline AND new upstream PASS since then
    const priorReviewPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'code-review' && !p.auto_cancelled
    );
    const hasNewPrereqPassForReview = makeReEngagementCheck(wpDetail.pipelines, reviewPrerequisite, 'code-review');
    if (priorReviewPipelines.length > 0 && hasNewPrereqPassForReview) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last code-review pipeline. Re-run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — code-review FAIL routes back to Reviewer when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      const reviewFailAgent = resolveFailAgent('code-review', activeStages);
      if (reviewFailAgent === 'Reviewer') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_REVIEW',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Reviewer is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run review.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior code-review FAIL. Re-perform code review.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent code-review is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. The fail-target agent must rework before Reviewer can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_REVIEW (first-run) — no prior review pipeline + prerequisite has PASS (or no prerequisite)
    const hasReviewPrereqPass = reviewPrerequisite === null
      ? true
      : wpDetail.pipelines.some(
          (p) => p.type === reviewPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasReviewPrereqPass && priorReviewPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: reviewPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no code-review pipeline. Run review.`
              : `Work package ${wpDetail.work_package_id} has no prior code-review pipeline and code-review is the first active stage. Run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to Reviewer)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Reviewer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Reviewer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Reviewer") to transition to IN_PROGRESS.`,
              `2. Wait for QA pipeline to complete before starting code review.`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for review. All WPs either lack QA pipelines or already have code-review pipelines.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Security Auditor.
 * Mirrors QA action structure — no self-rework on FAIL (bounces back to Developer).
 */
export async function getSecurityAuditorAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('security-audit')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const auditPrerequisite = resolvePrerequisite('security-audit', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const auditReworkCount = wpDetail.rework_counts?.['security-audit'] ?? 0;
      if (auditReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: auditReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} security-audit has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (auditPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[auditPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${auditPrerequisite} has reached the maximum rework count. Security Auditor cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'security-audit');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active security-audit pipeline in progress. Continue security audit work.`,
            next_steps: [
              `1. Complete the current security audit for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_SECURITY_AUDIT (re-engagement) — prior audit pipeline AND new upstream PASS since then
    const priorAuditPipelines = wpDetail.pipelines.filter((p) => p.type === 'security-audit' && !p.auto_cancelled);
    const hasNewPrereqPassForAudit = makeReEngagementCheck(wpDetail.pipelines, auditPrerequisite, 'security-audit');
    if (priorAuditPipelines.length > 0 && hasNewPrereqPassForAudit) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last security-audit pipeline. Re-run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — security-audit FAIL routes back to Security Auditor when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'security-audit')) {
      const auditFailAgent = resolveFailAgent('security-audit', activeStages);
      if (auditFailAgent === 'Security Auditor') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_SECURITY_AUDIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL security-audit pipeline. Security Auditor is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run security audit.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior security-audit FAIL. Re-run security audit.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent security-audit is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL security-audit pipeline. The fail-target agent must address findings before Security Auditor can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_SECURITY_AUDIT (first-run) — no prior audit + prerequisite PASS (or no prerequisite)
    const hasAuditPrereqPass = auditPrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === auditPrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasAuditPrereqPass && priorAuditPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: auditPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no security-audit pipeline. Run security audit.`
              : `Work package ${wpDetail.work_package_id} has no prior security-audit pipeline and security-audit is the first active stage. Run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Security Auditor') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Security Auditor with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Security Auditor") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting the security audit.`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for security audit.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Release Engineer.
 * Self-rework on FAIL (like Documentation). Runs after code-review in extended pipelines.
 */
export async function getReleaseEngineerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('release-engineering')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const releasePrerequisite = resolvePrerequisite('release-engineering', activeStages);

    // Compute active upstream stages for P1b
    const orderedActive = getOrderedActiveStages(activeStages);
    const reIdx = orderedActive.indexOf('release-engineering');
    const upstreamActiveStages = reIdx > 0 ? orderedActive.slice(0, reIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const releaseReworkCount = wpDetail.rework_counts?.['release-engineering'] ?? 0;
      if (releaseReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: releaseReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} release-engineering has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Release Engineer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'release-engineering');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'release-engineering')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active release-engineering pipeline in progress. Continue release engineering work.`,
            next_steps: [
              `1. Complete the current release engineering for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent release-engineering FAIL and no new upstream PASS since
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'release-engineering') &&
      (releasePrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, releasePrerequisite, 'release-engineering'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL release-engineering pipeline. Investigate and retry.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL release-engineering pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              '3. Fix release engineering issues and re-run.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P5: RUN_RELEASE_ENGINEERING (re-engagement) — prior pipeline AND new upstream PASS since
    const priorReleasePipelines = wpDetail.pipelines.filter((p) => p.type === 'release-engineering' && !p.auto_cancelled);
    const hasNewPrereqPassForRelease = makeReEngagementCheck(wpDetail.pipelines, releasePrerequisite, 'release-engineering');
    if (priorReleasePipelines.length > 0 && hasNewPrereqPassForRelease) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last release-engineering pipeline. Re-run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P6: RUN_RELEASE_ENGINEERING (first-run) — no prior pipeline + prerequisite PASS (or no prerequisite)
    const hasReleasePrereqPass = releasePrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === releasePrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasReleasePrereqPass && priorReleasePipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: releasePrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no release-engineering pipeline. Run release engineering.`
              : `Work package ${wpDetail.work_package_id} has no prior release-engineering pipeline and release-engineering is the first active stage. Run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Release Engineer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Release Engineer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Release Engineer") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting release engineering.`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for release engineering.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Documentation
 */
export async function getDocumentationAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal or BLOCKED WPs
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where documentation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('documentation')) continue;

    const reworkCounts = wpDetail.rework_counts ?? {};
    const id = wpDetail.work_package_id;

    // Resolve upstream prerequisite for documentation in this WP's active stages
    const docPrerequisite = resolvePrerequisite('documentation', activeStages);

    // Compute active stages before documentation for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const docIdx = orderedActive.indexOf('documentation');
    const upstreamActiveStages = docIdx > 0 ? orderedActive.slice(0, docIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT — documentation rework count at max
    if ((reworkCounts['documentation'] ?? 0) >= MAX_REWORK_COUNT) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'BLOCK_FOR_REWORK_LIMIT',
            work_package_id: id,
            reason: `Work package ${id} has reached the documentation rework limit (${MAX_REWORK_COUNT}). Escalate to PM to unblock.`,
          }, null, 2),
        }],
      };
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT — any active upstream pipeline at max
    for (const upType of upstreamActiveStages) {
      if ((reworkCounts[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: id,
              reason: `Work package ${id} has upstream ${upType} rework count at the limit. Waiting for PM to resolve blocker.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL — stale IN_PROGRESS documentation pipeline
    const staleAction = extractStalePipelineAction(wpDetail, 'documentation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE — active non-stale documentation pipeline
    if (isActivePipeline(wpDetail, 'documentation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: id,
            reason: `Work package ${id} has an active documentation pipeline in progress. Continue working on it.`,
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent documentation pipeline is FAIL and no new upstream PASS since
    // If a new upstream PASS has appeared after the doc failure, fall through to P6 (WRITE_DOCS) for a fresh run.
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'documentation') &&
      (docPrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: id,
            reason: `Work package ${id} has a FAIL documentation pipeline. Investigate and retry documentation.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              '3. Fix documentation issues, update affected files.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }

    // Freshness helpers for P5 / P5b
    // "Fresh" means: the most recent doc PASS was completed after the first active stage's last start
    const firstStagePipelines = wpDetail.pipelines.filter(
      (p) => p.type === firstActiveStage(activeStages) && !p.auto_cancelled
    );
    const latestFirstStage = firstStagePipelines.at(-1);
    const latestFirstStageStart = latestFirstStage?.started_at;

    const docPassPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled
    );
    const latestDocPass = docPassPipelines.at(-1);

    const isFresh =
      latestFirstStageStart &&
      latestDocPass?.completed_at &&
      parseTimestamp(latestDocPass.completed_at).getTime() >=
        parseTimestamp(latestFirstStageStart).getTime();

    if (latestDocPass && isFresh) {
      const allCriteriaMet =
        wpDetail.acceptance_criteria.length > 0 &&
        wpDetail.acceptance_criteria.every((c) => c.met === true);

      // P5: FINALIZE_WP — doc PASS, fresh, all criteria met
      if (allCriteriaMet) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'FINALIZE_WP',
              work_package_id: id,
              reason: `All criteria met; freshness passed — ready to mark COMPLETE.`,
              next_steps: [
                `1. Call ledger_update_work_package_status (work_package_id: "${id}", status: "COMPLETE", agent: "Documentation").`,
                `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
              ],
            }, null, 2),
          }],
        };
      }

      // P5b: UPDATE_CRITERIA — doc PASS, fresh, criteria not fully met
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'UPDATE_CRITERIA',
            work_package_id: id,
            reason: `Documentation passed; update acceptance criteria before marking COMPLETE.`,
            next_steps: [
              `1. Call ledger_complete_pipeline or ledger_add_observation to update acceptance_criteria_updates.`,
              `2. Once all criteria are met, call ledger_update_work_package_status to mark COMPLETE.`,
            ],
          }, null, 2),
        }],
      };
    }

    // P6: WRITE_DOCS — upstream prerequisite PASS available, no fresh doc pipeline
    const hasDocPrereqPass = docPrerequisite === null
      ? true
      : hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation');
    if (hasDocPrereqPass) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Documentation');
      const prereqLabel = docPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WRITE_DOCS',
            work_package_id: id,
            reason: docPrerequisite
              ? `Work package ${id} has PASS ${prereqLabel} pipeline. Write or update documentation.`
              : `Work package ${id} has no prior documentation pipeline and documentation is the first active stage. Write documentation.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              `2. Call ledger_get_work_package to review implementation artifacts and review comments.`,
              '3. Update documentation, README files, and inline docs as needed.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP — READY WP assigned to Documentation with dependencies satisfied
    if (
      wpDetail.status === 'READY' &&
      wpDetail.assigned_to === 'Documentation' &&
      canStartWorkPackage(wpDetail, rootIndex.work_packages)
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: id,
            reason: `Work package ${id} is READY and assigned to Documentation. Claim it to begin work.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${id}", agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No work packages ready for documentation. All WPs either lack code-review pipelines or already have up-to-date documentation.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Register the ledger_get_next_action tool on the MCP server.
 */
/** @internal — exported for unit tests only */
export const _internal = { getNextAction, buildBatchNextSteps, getNextActionsCollector, embedHandoffStatusInWait, getSecurityAuditorAction, getReleaseEngineerAction };

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_action',
    {
      description: 'Get the next recommended action for your agent role. REQUIRED params: agent_role. OPTIONAL: max_results (default: 1). When max_results is 1 (default), returns a single action object. When max_results > 1, returns an array of up to that many actions under the "actions" key. Call this to determine what to do next. Returns an action type and reason based on current work package and pipeline states. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetNextActionSchema,
    },
    getNextAction as any
  );
}
