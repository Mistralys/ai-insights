import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { Pipeline } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import {
  PIPELINE_AGENT_MAP,
  PipelineTypeEnum,
  describePipelineTypes,
  DEFAULT_PIPELINE_STAGES,
  resolvePrerequisite,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import { MAX_REWORK_COUNT, checkRevalidationGuard, hasDownstreamFail } from '../utils/workflow-helpers.js';
import { canStartWorkPackage, isValidStatusTransition } from '../schema/validators.js';
import { CLAIMABLE_ROLES } from './work-package.js';

const BeginWorkSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe('Plan folder path — use only if you already have it from a previous tool response. Otherwise prefer cwd_path.'),
  cwd_path: z
    .string()
    .optional()
    .describe('Your workspace root directory — preferred. The server auto-detects the active project.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to start:')),
  agent_role: z
    .string()
    .describe(
      'Your agent role identifier (e.g., "Developer", "QA"). Used for the claim guard and pipeline ownership validation.'
    ),
});

/**
 * beginWork: atomically claims a READY work package and starts its pipeline
 * in a single lock scope.
 *
 * If the WP is READY:
 *   - Applies CLAIMABLE_ROLES guard, assignment guard, dependency check.
 *   - Transitions the WP to IN_PROGRESS.
 *   - Starts the requested pipeline (with all ordering + rework guards).
 *   - Returns claimed: true.
 *
 * If the WP is already IN_PROGRESS and assigned to this agent:
 *   - Skips the claim phase (idempotent re-entry).
 *   - Starts the requested pipeline.
 *   - Returns claimed: false.
 *
 * All guards from both ledger_claim_work_package and ledger_start_pipeline
 * are preserved — this is a strict convenience wrapper, not a rule relaxation.
 */
async function beginWork(args: z.infer<typeof BeginWorkSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  // Captured inside the updater callback and read after the lock releases.
  let claimed = false;

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // ===== CLAIM PHASE =====

      if (wp.status === 'READY') {
        // Guard 1: CLAIMABLE_ROLES — reject roles not permitted to claim WPs
        if (!CLAIMABLE_ROLES.includes(args.agent_role)) {
          throw new Error(
            `Agent role '${args.agent_role}' cannot claim work packages. ` +
              `Valid roles: ${CLAIMABLE_ROLES.filter((r) => !r.includes('Agent')).join(', ')}.`
          );
        }

        // Guard 2: Assignment guard — can only claim a WP assigned to your role
        if (wp.assigned_to && wp.assigned_to !== args.agent_role) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: it is assigned to "${wp.assigned_to}" but you are "${args.agent_role}". ` +
              `Only claim work packages assigned to your role.`
          );
        }

        // Guard 3: Dependency check
        const depCheck = canStartWorkPackage(wp, root.work_packages);
        if (!depCheck.allowed) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: ${depCheck.reason}`
          );
        }

        // Guard 4: Status transition validation (should always be valid here)
        if (!isValidStatusTransition(wp.status, 'IN_PROGRESS')) {
          throw new Error(`Invalid status transition: ${wp.status} -> IN_PROGRESS`);
        }

        // Apply claim
        wp.status = 'IN_PROGRESS';
        wp.status_changed_at = now();
        wp.assigned_to = args.agent_role;

        // Update root index summary
        const summary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (summary) {
          summary.status = 'IN_PROGRESS';
          summary.assigned_to = args.agent_role;
        }

        claimed = true;
      } else if (wp.status === 'IN_PROGRESS') {
        // Idempotent re-entry: skip claim if WP is already IN_PROGRESS.
        // Allow if the agent is the current assignee OR the legitimate pipeline-type owner.
        // The pipeline-start phase (below) re-validates via PIPELINE_AGENT_MAP and
        // auto-updates assigned_to on success, so this is safe and spec-compliant.
        const isPipelineOwner = PIPELINE_AGENT_MAP[args.type as PipelineType] === args.agent_role;
        if (wp.assigned_to !== args.agent_role && !isPipelineOwner) {
          throw new Error(
            `Cannot begin work on ${args.work_package_id}: it is IN_PROGRESS and assigned to "${wp.assigned_to}" but you are "${args.agent_role}". ` +
              `Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.`
          );
        }
        claimed = false;
      } else {
        throw new Error(
          `Cannot begin work on ${args.work_package_id}: work package status is ${wp.status}. ` +
            `Only READY or IN_PROGRESS work packages are supported by ledger_begin_work.`
        );
      }

      // ===== PIPELINE START PHASE =====

      // Guard 1: Agent role validation — only the correct pipeline type owner may start it.
      const expectedAgent = PIPELINE_AGENT_MAP[args.type as PipelineType];
      const isPmOverride = args.agent_role === 'Project Manager';
      if (!isPmOverride && expectedAgent !== args.agent_role) {
        throw new Error(
          `Pipeline type '${args.type}' can only be started by the ${expectedAgent} agent. You provided agent_role: '${args.agent_role}'.`
        );
      }

      // Guard 2: No duplicate in-progress pipeline of the same type.
      const existingInProgress = wp.pipelines.find(
        (p) => p.type === args.type && p.status === 'IN_PROGRESS'
      );
      if (existingInProgress) {
        throw new Error(
          `Cannot start pipeline: a pipeline of type "${args.type}" is already IN_PROGRESS for work package ${args.work_package_id}. Complete the existing pipeline before starting a new one.`
        );
      }

      // Guard 3: Pipeline ordering — prerequisite must be the most-recently PASS'd pipeline.
      const activeStages: readonly PipelineType[] =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      const prerequisite = resolvePrerequisite(args.type as PipelineType, activeStages);
      if (prerequisite !== null) {
        const prereqPipelines = wp.pipelines.filter((p) => p.type === prerequisite);
        const mostRecentPrereq = prereqPipelines.at(-1);
        if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
          const orderedActive = (activeStages as readonly string[]).join(' → ');
          throw new Error(
            `Cannot start '${args.type}' pipeline: requires a PASS '${prerequisite}' pipeline first. Active pipeline order: ${orderedActive}.`
          );
        }

        // Guard 3b: Revalidation guard (§11.1) — reject if prerequisite PASS is stale after upstream rework.
        const revalidError = checkRevalidationGuard(
          wp.pipelines,
          args.type as PipelineType,
          prerequisite,
          activeStages,
        );
        if (revalidError !== null) {
          throw new Error(revalidError);
        }
      }

      // Guard 4: Rework count — increment if this is a rework run (§11.3).
      const effectiveSamePipelines = wp.pipelines.filter(
        (p) => p.type === args.type && !p.auto_cancelled
      );
      const isDirectRework = effectiveSamePipelines.at(-1)?.status === 'FAIL';
      const isDownstreamRework = hasDownstreamFail(wp.pipelines, args.type as PipelineType, activeStages);
      const needsRework = isDirectRework || isDownstreamRework;

      if (needsRework) {
        const current = wp.rework_counts?.[args.type] ?? 0;
        wp.rework_counts = { ...(wp.rework_counts ?? {}), [args.type]: current + 1 };
      }

      // Guard 5: Circuit breaker — reject if per-type rework count is at maximum.
      const effectiveReworkCount = wp.rework_counts?.[args.type] ?? 0;
      if (effectiveReworkCount >= MAX_REWORK_COUNT) {
        throw new Error(
          `Rework circuit breaker: ${args.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). ` +
            `Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`
        );
      }

      // Append new pipeline entry.
      const newPipeline: Pipeline = {
        type: args.type as PipelineType,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: isPmOverride ? ['[PM Override]'] : [],
      };
      wp.pipelines.push(newPipeline);

      // Update assigned_to to reflect the agent now taking ownership of this WP.
      const agentName = PIPELINE_AGENT_MAP[args.type as PipelineType];
      if (agentName) {
        wp.assigned_to = agentName;
        const summary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (summary) {
          summary.assigned_to = agentName;
        }
      }

      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package with the claimed flag appended.
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const responsePayload = { ...updatedWp, claimed };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error beginning work: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  beginWork,
  BeginWorkSchema,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_begin_work',
    {
      description:
        'Claim a READY work package and start its pipeline in a single atomic call. ' +
        'Replaces the two-step ledger_claim_work_package + ledger_start_pipeline sequence. ' +
        'If the WP is already IN_PROGRESS and assigned to you, skips the claim phase (idempotent re-entry). ' +
        'REQUIRED params: work_package_id, type, agent_role. ' +
        'Response includes all standard WP fields plus claimed: boolean indicating whether the claim step ran. ' +
        'Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: BeginWorkSchema,
    },
    beginWork as any
  );
}
