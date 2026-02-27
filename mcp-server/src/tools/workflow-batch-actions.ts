import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  PIPELINE_PREREQUISITES,
  AGENT_PIPELINE_MAP,
  type PipelineType,
  type PostImplPipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  pipelineAgentRoleMap,
  agentNameMap,
  actionNameMap,
  reworkActionMap,
  isStalePipeline,
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  getHandoffNotesForAgent,
} from '../utils/workflow-helpers.js';
import { isTerminalStatus } from '../schema/validators.js';
/**
 * Build `next_steps` guidance for a batch action entry.
 * Mirrors the step-by-step tool-call instructions from the singular getNextAction
 * helpers, but in compact array form suitable for batch responses.
 */
function buildBatchNextSteps(
  action: string,
  wpId: string,
  pipelineType: string,
  wpStatus?: string,
  failedPipelineType?: string,
): string[] {
  const agentRole = pipelineAgentRoleMap[pipelineType] ?? pipelineType;

  switch (action) {
    case 'IMPLEMENT': {
      const claimStep = wpStatus === 'READY'
        ? `1. Call ledger_claim_work_package (work_package_id: "${wpId}", agent: "Developer").`
        : `1. WP is already IN_PROGRESS \u2014 skip claiming.`;
      return [
        claimStep,
        `2. Call ledger_start_pipeline (work_package_id: "${wpId}", type: "implementation").`,
        '3. Read the WP spec, implement the changes, run tests.',
        `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'REWORK': {
      // Developer rework: fixedPipelineType identifies which downstream pipeline failed
      if (failedPipelineType && failedPipelineType !== 'implementation') {
        return [
          `1. Call ledger_get_work_package to review the FAIL ${failedPipelineType} pipeline comments/summary.`,
          `2. Call ledger_start_pipeline (work_package_id: "${wpId}", type: "implementation").`,
          '3. Fix the issues identified by the failed pipeline, run tests.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
          `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
        ];
      }
      // Documentation self-rework or Developer implementation rework
      if (pipelineType === 'documentation') {
        return [
          `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
          `2. Call ledger_start_pipeline (work_package_id: "${wpId}", type: "documentation").`,
          '3. Fix documentation issues, update affected files.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
          `5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
          `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
        ];
      }
      return [
        `1. Call ledger_start_pipeline (work_package_id: "${wpId}", type: "implementation") \u2014 WP is already IN_PROGRESS.`,
        '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'RUN_QA':
    case 'RUN_REVIEW':
    case 'WRITE_DOCS': {
      const steps = [
        `1. Call ledger_start_pipeline (work_package_id: "${wpId}", type: "${pipelineType}").`,
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
    default:
      return [];
  }
}

/**
 * Tool: get_next_actions (plural / batch)
 *
 * Returns ALL actionable work packages for an agent's role instead of just the first one.
 * Useful for projects with many independent WPs where an agent can process several in parallel.
 * The existing ledger_get_next_action (singular) remains unchanged.
 */
const GetNextActionsSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
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
    .describe('Maximum number of actionable WPs to return (default: 5)'),
});

async function getNextActions(args: z.infer<typeof GetNextActionsSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);
  const limit = args.max_results ?? 5;

  try {
    if (!AGENT_ROLES.includes(args.agent_role as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.agent_role}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    const rootIndex = await store.readRootIndex();

    if (rootIndex.work_packages.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ actions: [], reason: 'No work packages exist yet.' }, null, 2),
          },
        ],
      };
    }

    const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));
    if (allTerminal) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ actions: [], reason: 'All work packages are in a terminal status (COMPLETE or CANCELLED).' }, null, 2),
          },
        ],
      };
    }

    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

    const actions: object[] = [];

    const pipelineType = AGENT_PIPELINE_MAP[args.agent_role];
    if (!pipelineType) {
      // Planner, Synthesis, Project Manager — batch not meaningful, fall through with empty
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { actions: [], reason: `Batch actions not applicable for role: ${args.agent_role}` },
              null,
              2
            ),
          },
        ],
      };
    }

    // Prerequisite type for this agent's pipeline
    const prerequisite = PIPELINE_PREREQUISITES[pipelineType];

    for (const wpDetail of wpDetails) {
      if (actions.length >= limit) break;

      // Skip stale pipelines (RESUME_OR_CANCEL handling remains the same)
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
        // A stale pipeline takes priority — skip new-work and rework checks for
        // this WP so the agent focuses on resolving the stale pipeline first.
        continue;
      }

      // For implementation: look for READY/IN_PROGRESS WPs with no implementation pipeline yet
      if (pipelineType === 'implementation') {
        if (
          (wpDetail.status === 'READY' || wpDetail.status === 'IN_PROGRESS') &&
          !hasDependencyBlocked(wpDetail, rootIndex) &&
          !wpDetail.pipelines.some((p) => p.type === 'implementation')
        ) {
          const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
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
              break; // Only surface the earliest failing downstream pipeline
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

      // BLOCKED WPs need upstream agent intervention before the current agent
      // can retry — skip rework suggestion to avoid infinite-loop signals.
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
 * Register the ledger_get_next_actions tool on the MCP server.
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_actions',
    {
      description: 'Get all actionable work packages for your agent role (batch version of ledger_get_next_action). REQUIRED params: project_path, agent_role. OPTIONAL: max_results (default: 5). Returns an array of action recommendations. The singular ledger_get_next_action remains unchanged.',
      inputSchema: GetNextActionsSchema.passthrough(),
    },
    getNextActions as any
  );
}
