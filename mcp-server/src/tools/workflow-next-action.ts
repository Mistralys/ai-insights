import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath, mutuallyExclusivePaths, MUTUAL_EXCLUSIVITY_PATH_MSG } from '../utils/path-validator.js';
import { isTerminalStatus, canStartWorkPackage } from '../schema/validators.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  PIPELINE_TYPES,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  extractStalePipelineAction,
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  hasDownstreamFail,
  hasDownstreamReengagedSince,
  isActivePipeline,
  getHandoffNotesForAgent,
  hasNewUpstreamPassSince,
  mostRecentEffectivePipeline,
  MAX_REWORK_COUNT,
  STALE_PIPELINE_HOURS,
} from '../utils/workflow-helpers.js';
import { embedHandoffStatusInWait, buildBatchNextSteps, getNextActionsCollector } from './workflow-next-action-batch.js';
/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  cwd_path: z.string().optional().describe('Workspace root path — alternative to project_path for automatic project detection.'),
  agent_role: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"'
    ),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of actionable WPs to return (default: 1). When > 1, returns up to this many actions as an array under the "actions" key instead of a single action object. Useful for projects with many independent WPs.'),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

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

    // Agent-specific logic
    switch (args.agent_role) {
      case 'Project Manager':
        return await embedHandoffStatusInWait(
          await getProjectManagerAction(rootIndex, store, wpDetails),
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      case 'Developer':
        return await embedHandoffStatusInWait(await getDeveloperAction(rootIndex, store, wpDetails), projectPath, args.agent_role, { store, rootIndex, wpDetails });
      case 'QA':
        return await embedHandoffStatusInWait(await getQaAction(rootIndex, store, wpDetails), projectPath, args.agent_role, { store, rootIndex, wpDetails });
      case 'Reviewer':
        return await embedHandoffStatusInWait(await getReviewerAction(rootIndex, store, wpDetails), projectPath, args.agent_role, { store, rootIndex, wpDetails });
      case 'Documentation':
        return await embedHandoffStatusInWait(await getDocumentationAction(rootIndex, store, wpDetails), projectPath, args.agent_role, { store, rootIndex, wpDetails });
      case 'Synthesis':
        return await embedHandoffStatusInWait(
          getSynthesisAction(),
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      default:
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
    }
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

  // --- Priority 4 / Fallback: WAIT ---
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
    // Only consider Developer-assigned WPs
    if (wpDetail.assigned_to !== 'Developer') continue;
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
    if (hasPassImpl && hasDownstreamFail(wpDetail.pipelines, 'implementation')) {
      if (hasDownstreamReengagedSince(wpDetail.pipelines, 'implementation')) {
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
      const hasImplPipeline = wpDetail.pipelines.some((p) => p.type === 'implementation');
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

    // P7: CLAIM_WP (READY, dependencies satisfied)
    if (wpDetail.status === 'READY') {
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
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

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

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (implementation rework at MAX)
    const implReworkCount = wpDetail.rework_counts?.implementation ?? 0;
    if (implReworkCount >= MAX_REWORK_COUNT) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} implementation has reached the maximum rework count. QA cannot proceed until Developer resolves the limit.`,
          }, null, 2),
        }],
      };
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

    // P4: RUN_QA (re-engagement) — at least one prior QA pipeline AND new impl PASS since then
    const priorQaPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'qa' && !p.auto_cancelled
    );
    if (priorQaPipelines.length > 0 && hasNewUpstreamPassSince(wpDetail.pipelines, 'implementation', 'qa')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new implementation PASS since the last QA pipeline. Re-run QA.`,
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

    // P5: WAIT_FOR_REWORK — most recent QA is FAIL and no new upstream pass yet
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. Developer must rework the implementation before QA can retry. QA does not self-rework.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_QA (first-run) — no prior QA pipeline + implementation has PASS
    const hasImplPass = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS' && !p.auto_cancelled
    );
    if (hasImplPass && priorQaPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has PASS implementation pipeline but no QA pipeline. Run QA.`,
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
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

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

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (implementation OR qa rework at MAX)
    const implReworkCount = wpDetail.rework_counts?.implementation ?? 0;
    const qaReworkCount = wpDetail.rework_counts?.qa ?? 0;
    if (implReworkCount >= MAX_REWORK_COUNT || qaReworkCount >= MAX_REWORK_COUNT) {
      const limitedType = implReworkCount >= MAX_REWORK_COUNT ? 'implementation' : 'qa';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} ${limitedType} has reached the maximum rework count. Reviewer cannot proceed until the upstream limit is resolved.`,
          }, null, 2),
        }],
      };
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

    // P4: RUN_REVIEW (re-engagement) — at least one prior review pipeline AND new QA PASS since then
    const priorReviewPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'code-review' && !p.auto_cancelled
    );
    if (priorReviewPipelines.length > 0 && hasNewUpstreamPassSince(wpDetail.pipelines, 'qa', 'code-review')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new QA PASS since the last code-review pipeline. Re-run review.`,
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

    // P5: WAIT_FOR_REWORK — most recent code-review is FAIL and no new QA PASS yet
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Developer must rework the implementation before Reviewer can retry. Reviewer does not self-rework.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_REVIEW (first-run) — no prior review pipeline + QA has PASS
    const hasQaPass = wpDetail.pipelines.some(
      (p) => p.type === 'qa' && p.status === 'PASS' && !p.auto_cancelled
    );
    if (hasQaPass && priorReviewPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has PASS QA pipeline but no code-review pipeline. Run review.`,
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

    const reworkCounts = wpDetail.rework_counts ?? {};
    const id = wpDetail.work_package_id;

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

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT — any upstream pipeline at max
    // Check all upstream (non-documentation) pipeline types for rework limits
    const upstreamTypes = PIPELINE_TYPES.filter((t): t is Exclude<PipelineType, 'documentation'> => t !== 'documentation');
    for (const type of upstreamTypes) {
      if ((reworkCounts[type] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: id,
              reason: `Work package ${id} has upstream ${type} rework count at the limit. Waiting for PM to resolve blocker.`,
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

    // P4: REWORK (self) — most recent documentation pipeline is FAIL and no new code-review PASS since
    // If a new code-review PASS has appeared after the doc failure, fall through to P6 (WRITE_DOCS) for a fresh run.
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'documentation') &&
      !hasNewUpstreamPassSince(wpDetail.pipelines, 'code-review', 'documentation')
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
    const implPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'implementation' && !p.auto_cancelled
    );
    const latestImpl = implPipelines.at(-1);
    const latestImplStart = latestImpl?.started_at;

    const docPassPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled
    );
    const latestDocPass = docPassPipelines.at(-1);

    const isFresh =
      latestImplStart &&
      latestDocPass?.completed_at &&
      parseTimestamp(latestDocPass.completed_at).getTime() >=
        parseTimestamp(latestImplStart).getTime();

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

    // P6: WRITE_DOCS — code-review PASS available, no fresh doc pipeline
    if (hasNewUpstreamPassSince(wpDetail.pipelines, 'code-review', 'documentation')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Documentation');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WRITE_DOCS',
            work_package_id: id,
            reason: `Work package ${id} has PASS code-review pipeline. Write or update documentation.`,
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
export const _internal = { getNextAction, buildBatchNextSteps, getNextActionsCollector, embedHandoffStatusInWait };

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_action',
    {
      description: 'Get the next recommended action for your agent role. REQUIRED params: project_path, agent_role. OPTIONAL: max_results (default: 1). When max_results is 1 (default), returns a single action object. When max_results > 1, returns an array of up to that many actions under the "actions" key. Call this to determine what to do next. Returns an action type and reason based on current work package and pipeline states.',
      inputSchema: GetNextActionSchema,
    },
    getNextAction as any
  );
}
