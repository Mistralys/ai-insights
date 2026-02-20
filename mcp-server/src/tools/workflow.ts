import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex, WorkPackageSummary } from '../schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../schema/work-package.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';
import {
  PIPELINE_PREREQUISITES,
  AGENT_PIPELINE_MAP,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
  type PipelineType,
  type PostImplPipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp, now } from '../utils/timestamp.js';
import { isRegistryLoaded, getAgentHandle } from '../utils/agent-registry.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';

/**
 * Number of hours after which an IN_PROGRESS pipeline is considered stale.
 */
export const STALE_PIPELINE_HOURS = 24;

/** Maximum number of automatic handoff chain steps to prevent infinite loops. */
export const MAX_HANDOFF_DEPTH = 10;

/**
 * Builds the prompt string passed to the next agent during auto-handoff.
 * Intentionally minimal — the receiving agent's persona contains full workflow instructions.
 */
export function buildHandoffPrompt(projectPath: string): string {
  return `Project path: ${projectPath}`;
}

/**
 * Re-export pipeline maps for test access via namespace import.
 * @internal — for unit testing only
 */
export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP };

/** Display-name maps used by getNextActions for human-readable output.
 * These deliberately exclude 'implementation' — only post-impl stages appear
 * in batch action output. PostImplPipelineType enforces this at compile time. */
const agentNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};
const actionNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'RUN_QA',
  'code-review': 'RUN_REVIEW',
  'documentation': 'WRITE_DOCS',
};
const reworkActionMap: Record<PostImplPipelineType, string> = {
  'qa': 'REWORK_QA',
  'code-review': 'REWORK_REVIEW',
  'documentation': 'REWORK_DOCS',
};

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

/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  agent_role: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"'
    ),
});

async function getNextAction(args: z.infer<typeof GetNextActionSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.agent_role as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.agent_role}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

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
        return {
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
        };
      }
    }

    // Check if all work packages are complete
    const allComplete = rootIndex.work_packages.every(
      (wp) => wp.status === 'COMPLETE'
    );

    if (allComplete) {
      if (args.agent_role === 'Synthesis') {
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
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'WAIT',
                  reason:
                    'All work packages are COMPLETE. Project is ready for Synthesis agent.',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    // Agent-specific logic
    switch (args.agent_role) {
      case 'Project Manager':
        return await getProjectManagerAction(rootIndex, store);
      case 'Developer':
        return await getDeveloperAction(rootIndex, store);
      case 'QA':
        return await getQaAction(rootIndex, store);
      case 'Reviewer':
        return await getReviewerAction(rootIndex, store);
      case 'Documentation':
        return await getDocumentationAction(rootIndex, store);
      case 'Synthesis':
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'WAIT',
                  reason:
                    'Not all work packages are COMPLETE. Wait for all WPs to finish.',
                },
                null,
                2
              ),
            },
          ],
        };
      default:
        return {
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
        };
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
 * Get next action for Project Manager
 */
async function getProjectManagerAction(
  rootIndex: RootIndex,
  store: LedgerStore
) {
  // Check for BLOCKED work packages
  const blockedWps = rootIndex.work_packages.filter(
    (wp) => wp.status === 'BLOCKED'
  );

  if (blockedWps.length > 0) {
    const [firstBlocked] = blockedWps;
    if (firstBlocked === undefined) {
      // Unreachable: guarded by blockedWps.length > 0 above, but satisfies noUncheckedIndexedAccess
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ action: 'WAIT', reason: 'No PM action needed.' }, null, 2) }],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              action: 'RESOLVE_BLOCKERS',
              work_package_id: firstBlocked.work_package_id,
              reason: `Work package ${firstBlocked.work_package_id} is BLOCKED. Investigate and resolve blocker.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No PM action needed. Work packages are in progress or complete.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Developer
 */
export async function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS implementation pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'implementation');
    if (staleAction) return staleAction;
  }

  // Look for READY or IN_PROGRESS WPs with no implementation pipeline
  for (const wpDetail of wpDetails) {
    if (
      (wpDetail.status === 'READY' || wpDetail.status === 'IN_PROGRESS') &&
      !hasDependencyBlocked(wpDetail, rootIndex)
    ) {
      const hasImplPipeline = wpDetail.pipelines.some(
        (p) => p.type === 'implementation'
      );

      if (!hasImplPipeline) {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'IMPLEMENT',
                  work_package_id: wpDetail.work_package_id,
                  reason: `Work package ${wpDetail.work_package_id} is ${wpDetail.status} with no implementation pipeline. Claim and implement.`,
                  ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  }

  // Look for FAIL implementation pipelines needing rework (only check the most recent pipeline)
  for (const wpDetail of wpDetails) {
    const reworkAction = extractReworkAction(
      wpDetail,
      'implementation',
      'REWORK',
      `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`
    );
    if (reworkAction) return reworkAction;
  }

  // Look for downstream pipeline failures (QA or code-review) that need Developer rework.
  // When QA or a Reviewer rejects a WP, the Developer must fix the implementation.
  // This prevents deadlocks where BLOCKED or IN_PROGRESS WPs with downstream FAILs
  // are invisible to the Developer because the implementation pipeline itself is PASS.
  for (const wpDetail of wpDetails) {
    // Only consider WPs that have a PASS implementation (Developer already worked on it)
    const hasPassImpl = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS'
    );
    if (!hasPassImpl) continue;

    // Check downstream pipelines for most-recent FAIL
    for (const downstreamType of ['qa', 'code-review'] as const) {
      if (isMostRecentPipelineFail(wpDetail.pipelines, downstreamType)) {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'REWORK',
                  work_package_id: wpDetail.work_package_id,
                  reason: `Work package ${wpDetail.work_package_id} has a FAIL ${downstreamType} pipeline. Developer rework needed to address ${downstreamType} rejection.`,
                  pipeline_that_failed: downstreamType,
                  ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      }
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
              'No work packages ready for implementation. All WPs either have implementation pipelines or are blocked.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for QA
 */
async function getQaAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS qa pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'qa');
    if (staleAction) return staleAction;
  }

  // Look for WPs with PASS implementation pipeline but no QA pipeline
  for (const wpDetail of wpDetails) {
    const hasPassImplPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS'
    );
    const hasQaPipeline = wpDetail.pipelines.some((p) => p.type === 'qa');

    if (hasPassImplPipeline && !hasQaPipeline) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'RUN_QA',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS implementation pipeline but no QA pipeline. Run QA.`,
                ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL QA pipelines needing rework (only check the most recent pipeline)
  for (const wpDetail of wpDetails) {
    const reworkAction = extractReworkAction(
      wpDetail,
      'qa',
      'REWORK_QA',
      `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. Investigate and retry QA.`
    );
    if (reworkAction) return reworkAction;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No work packages ready for QA. All WPs either lack implementation pipelines or already have QA pipelines.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Reviewer
 */
async function getReviewerAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS code-review pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'code-review');
    if (staleAction) return staleAction;
  }

  // Look for WPs with PASS QA pipeline but no code-review pipeline
  for (const wpDetail of wpDetails) {
    const hasPassQaPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'qa' && p.status === 'PASS'
    );
    const hasReviewPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'code-review'
    );

    if (hasPassQaPipeline && !hasReviewPipeline) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'RUN_REVIEW',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS QA pipeline but no code-review pipeline. Run review.`,
                ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL code-review pipelines needing rework (only check the most recent pipeline)
  for (const wpDetail of wpDetails) {
    const reworkAction = extractReworkAction(
      wpDetail,
      'code-review',
      'REWORK_REVIEW',
      `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Investigate and retry review.`
    );
    if (reworkAction) return reworkAction;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No work packages ready for review. All WPs either lack QA pipelines or already have code-review pipelines.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Documentation
 */
async function getDocumentationAction(
  rootIndex: RootIndex,
  store: LedgerStore
) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS documentation pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'documentation');
    if (staleAction) return staleAction;
  }

  // First, check for WPs with PASS pipelines but still IN_PROGRESS status
  // This catches cases where Documentation agent completed pipeline but forgot to mark WP as COMPLETE
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasPassDocs = wpDetail.pipelines.some(
        (p) => p.type === 'documentation' && p.status === 'PASS'
      );
      const hasPassReview = wpDetail.pipelines.some(
        (p) => p.type === 'code-review' && p.status === 'PASS'
      );
      const hasPassQa = wpDetail.pipelines.some(
        (p) => p.type === 'qa' && p.status === 'PASS'
      );
      const hasPassImpl = wpDetail.pipelines.some(
        (p) => p.type === 'implementation' && p.status === 'PASS'
      );

      // If all pipelines are PASS but WP is still IN_PROGRESS, prompt to mark COMPLETE
      if (hasPassDocs && hasPassReview && hasPassQa && hasPassImpl) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'MARK_COMPLETE',
                  work_package_id: wpDetail.work_package_id,
                  reason: `Work package ${wpDetail.work_package_id} has all pipelines completed with PASS status but is still IN_PROGRESS. Mark it as COMPLETE using ledger_update_work_package_status.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  }

  // Look for WPs with PASS code-review pipeline but no documentation pipeline
  for (const wpDetail of wpDetails) {
    const hasPassReviewPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'code-review' && p.status === 'PASS'
    );
    const hasDocsPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'documentation'
    );

    if (hasPassReviewPipeline && !hasDocsPipeline) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Documentation');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WRITE_DOCS',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS code-review pipeline but no documentation pipeline. Write docs.`,
                ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL documentation pipelines needing rework (only check the most recent pipeline)
  for (const wpDetail of wpDetails) {
    const reworkAction = extractReworkAction(
      wpDetail,
      'documentation',
      'REWORK_DOCS',
      `Work package ${wpDetail.work_package_id} has a FAIL documentation pipeline. Investigate and retry docs.`
    );
    if (reworkAction) return reworkAction;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason:
              'No work packages ready for documentation. All WPs either lack code-review pipelines or already have documentation pipelines.',
          },
          null,
          2
        ),
      },
    ],
  };
}

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

/**
 * Helper: Returns true only if the most recent pipeline of the given type has FAIL status.
 * A [FAIL, PASS] sequence correctly returns false — only historical FAILs preceding a PASS are ignored.
 */
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const mostRecent = pipelines.filter((p) => p.type === pipelineType).at(-1);
  return mostRecent?.status === 'FAIL';
}

/**
 * Helper: Check if a work package is blocked by dependencies.
 *
 * Uses RootIndex summaries (already in memory) rather than loading full WP
 * detail files. Called in getDeveloperAction and getNextActions where the
 * root index is available but full detail arrays are not pre-loaded for all WPs.
 *
 * See also: isBlockedByDependencies — a functionally equivalent helper that
 * takes the full WorkPackageDetail[] array, used in getHandoff* functions
 * where all WP details are loaded upfront.
 */
function hasDependencyBlocked(
  wpDetail: WorkPackageDetail,
  rootIndex: RootIndex
): boolean {
  if (wpDetail.dependencies.length === 0) {
    return false;
  }

  // Check if any dependency is not COMPLETE
  for (const depId of wpDetail.dependencies) {
    const depSummary = rootIndex.work_packages.find(
      (wp) => wp.work_package_id === depId
    );

    if (!depSummary || depSummary.status !== 'COMPLETE') {
      return true;
    }
  }

  return false;
}

/**
 * Tool: get_handoff_status
 *
 * Reads root index and examines all WP statuses and pipelines to compute
 * the correct AGENT: and STATUS: handoff block for the current agent.
 */
const GetHandoffStatusSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  current_agent: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"'
    ),
});

async function getHandoffStatus(args: z.infer<typeof GetHandoffStatusSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.current_agent as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.current_agent}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Check for BLOCKED work packages, but only report BLOCKED if there's truly nothing that can be worked on
    const blockedWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED'
    );
    const completeWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'COMPLETE'
    );
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );

    // Only report BLOCKED if ALL WPs are blocked (no READY/IN_PROGRESS, no COMPLETE).
    // If any WPs are COMPLETE, downstream agents (QA, Reviewer, Documentation) can still process them,
    // so let agent-specific logic determine the appropriate handoff.
    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0 && completeWps.length === 0) {
      return buildHandoffResponse(
        args.current_agent,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        args.project_path,
        store
      );
    }

    // Load all WP details to examine pipeline states first
    // (We need this to make informed decisions about handoff status)
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) =>
        store.readWorkPackage(wp.work_package_id)
      )
    );

    // Agent-specific handoff logic
    switch (args.current_agent) {
      case 'Project Manager':
        return getProjectManagerHandoff(wpDetails, args.project_path, store);
      case 'Developer':
        return getDeveloperHandoff(wpDetails, args.project_path, store);
      case 'QA':
        return getQaHandoff(wpDetails, args.project_path, store);
      case 'Reviewer':
        return getReviewerHandoff(wpDetails, args.project_path, store);
      case 'Documentation':
        return getDocumentationHandoff(wpDetails, args.project_path, store);
      case 'Synthesis':
        return buildHandoffResponse(args.current_agent, 'COMPLETE', 'Synthesis complete.', undefined, args.project_path, store);
      default:
        return buildHandoffResponse(args.current_agent, 'IN_PROGRESS', 'Work in progress.', undefined, args.project_path, store);
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
 * Helper function: Check if a WP is blocked by incomplete dependencies.
 *
 * Operates on the full WorkPackageDetail[] array rather than RootIndex summaries,
 * making it suitable for getHandoff* functions where all WP details are already
 * loaded. For contexts where only the root index is available, use
 * hasDependencyBlocked instead.
 */
function isBlockedByDependencies(
  wp: WorkPackageDetail,
  allWpDetails: WorkPackageDetail[]
): boolean {
  if (!wp.dependencies || wp.dependencies.length === 0) {
    return false;
  }

  // Check if any dependency is not COMPLETE
  return wp.dependencies.some((depId) => {
    const depWp = allWpDetails.find((w) => w.work_package_id === depId);
    return !depWp || depWp.status !== 'COMPLETE';
  });
}

/**
 * Derive the next agent from a handoff status.
 *
 * For READY_FOR_* statuses the next agent is the target role.
 * For IN_PROGRESS the caller continues (next === current).
 * For BLOCKED, the Project Manager triages.
 * For COMPLETE, no next agent is needed.
 */
export function nextAgentFromStatus(status: string, currentAgent: string): string | null {
  const map: Record<string, string> = {
    READY_FOR_DEVELOPER: 'Developer',
    READY_FOR_QA: 'QA',
    READY_FOR_REVIEW: 'Reviewer',
    READY_FOR_DOCUMENTATION: 'Documentation',
    READY_FOR_SYNTHESIS: 'Synthesis',
    BLOCKED: 'Project Manager',
  };
  if (status === 'IN_PROGRESS') return currentAgent;
  if (status === 'COMPLETE') return null;
  return map[status] ?? null;
}

/** Build a standard handoff response payload with current_agent, next_agent, and status.
 *
 * When `projectPath` and `store` are provided, this function will also attempt to include
 * an `auto_handoff` object in the payload if all eligibility conditions are met:
 * - Registry is loaded (`isRegistryLoaded()` returns true)
 * - Next agent has a known VS Code handle
 * - Status is not COMPLETE, BLOCKED, or IN_PROGRESS
 * - `auto_handoff_depth` in the ledger is below `MAX_HANDOFF_DEPTH`
 *
 * On COMPLETE status the depth counter is reset to 0 so the next project starts fresh.
 */
export async function buildHandoffResponse(
  currentAgent: string,
  status: string,
  details: string,
  nextAction?: string,
  projectPath?: string,
  store?: LedgerStore
) {
  const nextAgent = nextAgentFromStatus(status, currentAgent);
  const payload: Record<string, unknown> = {
    current_agent: currentAgent,
    ...(nextAgent ? { next_agent: nextAgent } : {}),
    status,
    details,
  };
  if (nextAction) payload.next_action = nextAction;

  // Auto-handoff eligibility check
  if (
    projectPath &&
    store &&
    status !== 'COMPLETE' &&
    status !== 'BLOCKED' &&
    status !== 'IN_PROGRESS' &&
    isRegistryLoaded()
  ) {
    const agentName = nextAgent ? getAgentHandle(nextAgent) : null;
    if (agentName !== null) {
      try {
        const root = await store.readRootIndex();
        const currentDepth = root.auto_handoff_depth ?? 0;
        if (currentDepth < MAX_HANDOFF_DEPTH) {
          await store.writeRootIndex({
            ...root,
            auto_handoff_depth: currentDepth + 1,
            last_updated: now(),
          });
          payload.auto_handoff = {
            agent_name: agentName,
            prompt: buildHandoffPrompt(projectPath),
          };
        }
      } catch (err) {
        process.stderr.write(`[buildHandoffResponse] storage error (auto-handoff depth update): ${String(err)}\n`);
      }
    }
  }

  // Reset depth counter when project reaches COMPLETE
  if (status === 'COMPLETE' && store && projectPath) {
    try {
      const root = await store.readRootIndex();
      if ((root.auto_handoff_depth ?? 0) !== 0) {
        await store.writeRootIndex({
          ...root,
          auto_handoff_depth: 0,
          last_updated: now(),
        });
      }
    } catch (err) {
      process.stderr.write(`[buildHandoffResponse] storage error (COMPLETE depth reset): ${String(err)}\n`);
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Get handoff status for Project Manager
 */
export async function getProjectManagerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // If any WP lacks implementation pipeline, Developer needs to work
  const needsImplementation = wpDetails.some(
    (wp) =>
      (wp.status === 'READY' || wp.status === 'IN_PROGRESS') &&
      !wp.pipelines.some((p) => p.type === 'implementation')
  );

  if (needsImplementation) {
    return buildHandoffResponse(
      'Project Manager',
      'READY_FOR_DEVELOPER',
      'Work packages created and ready for implementation.',
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Project Manager',
    'IN_PROGRESS',
    'Work packages in progress.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Developer
 */
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs have PASS implementation pipelines
  const allImplemented = wpDetails.every((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  if (allImplemented) {
    return buildHandoffResponse(
      'Developer',
      'READY_FOR_QA',
      'All work packages have PASS implementation pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any WP needs implementation or has FAIL pipeline.
  //
  // NOTE: isMostRecentPipelineFail is intentionally NOT used here. That helper
  // only checks the most recent pipeline, which would miss a WP that has an
  // older FAIL pipeline followed by a currently IN_PROGRESS one. getDeveloperHandoff
  // needs a conservative signal: if any implementation attempt has ever FAIL-ed
  // and no PASS pipeline exists yet, the WP is still considered in-progress.
  const needsWork = wpDetails.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'implementation') ||
      wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
  );

  if (needsWork) {
    // Count how many work packages still need implementation
    const wpsNeedingWork = wpDetails.filter(
      (wp) =>
        !wp.pipelines.some((p) => p.type === 'implementation') ||
        wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
    );

    return buildHandoffResponse(
      'Developer',
      'IN_PROGRESS',
      `Implementation work in progress. ${wpsNeedingWork.length} work package(s) still need implementation or rework.`,
      `Call ledger_get_next_action with agent_role: "Developer" to find the next work package to implement. Continue working until all WPs have PASS implementation pipelines.`,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Developer',
    'READY_FOR_QA',
    'Implementation complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for QA
 */
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs with implementation pipelines have PASS QA pipelines
  const wpsWithImpl = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  const allQaPassed = wpsWithImpl.every((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  // Check if there are WPs that still need implementation (BLOCKED, READY, or IN_PROGRESS without PASS impl)
  const wpsStillNeedingImpl = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  if (allQaPassed && wpsWithImpl.length > 0) {
    // If there are still WPs that haven't been implemented, check if they're blocked or ready
    if (wpsStillNeedingImpl.length > 0) {
      // Check if these WPs are actually ready or blocked by dependencies
      const readyWps = wpsStillNeedingImpl.filter(
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsStillNeedingImpl.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
      );

      // If all unimplemented WPs are blocked, proceed to Review instead of waiting
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'QA',
          'READY_FOR_REVIEW',
          `QA passed for ${wpsWithImpl.length} implemented work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Review to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      // Some WPs are ready for implementation
      return buildHandoffResponse(
        'QA',
        'READY_FOR_DEVELOPER',
        `QA passed for ${wpsWithImpl.length} implemented work package(s). ${readyWps.length} work package(s) ready for implementation: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'QA',
      'READY_FOR_REVIEW',
      'All work packages have PASS QA pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs QA or has FAIL pipeline.
  // BLOCKED WPs need Developer rework before QA can retry — exclude them.
  const needsWork = wpsWithImpl.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'qa') ||
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need QA
    const wpsNeedingWork = wpsWithImpl.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'qa') ||
        wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'QA',
      'IN_PROGRESS',
      `QA work in progress. ${wpsNeedingWork.length} work package(s) still need QA or rework.`,
      `Call ledger_get_next_action with agent_role: "QA" to find the next work package to validate. Continue working until all WPs have PASS qa pipelines.`,
      projectPath,
      store
    );
  }

  // All implemented WPs have QA but some WPs still need implementation
  if (wpsStillNeedingImpl.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsStillNeedingImpl.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsStillNeedingImpl.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
    );

    // If all unimplemented WPs are blocked, proceed to Review instead of waiting
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'QA',
        'READY_FOR_REVIEW',
        `QA complete for all implemented work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Review to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    // Some WPs are ready for implementation
    return buildHandoffResponse(
      'QA',
      'READY_FOR_DEVELOPER',
      `QA complete for all implemented work packages. ${readyWps.length} work package(s) ready for implementation: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'QA',
    'READY_FOR_REVIEW',
    'QA complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Reviewer
 */
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs with QA pipelines have PASS code-review pipelines
  const wpsWithQa = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  const allReviewPassed = wpsWithQa.every((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  // Check if there are WPs that haven't reached QA yet
  const wpsNotYetQaPassed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  if (allReviewPassed && wpsWithQa.length > 0) {
    // If there are still WPs that haven't passed QA, check if they're blocked or ready
    if (wpsNotYetQaPassed.length > 0) {
      // Check if these WPs are actually ready or blocked by dependencies
      const readyWps = wpsNotYetQaPassed.filter(
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsNotYetQaPassed.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
      );

      // If all unimplemented WPs are blocked, proceed to Documentation instead of waiting
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'Reviewer',
          'READY_FOR_DOCUMENTATION',
          `Review passed for ${wpsWithQa.length} work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Documentation to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      // Some WPs are ready for implementation/QA
      return buildHandoffResponse(
        'Reviewer',
        'READY_FOR_DEVELOPER',
        `Review passed for ${wpsWithQa.length} work package(s). ${readyWps.length} work package(s) ready for implementation/QA: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DOCUMENTATION',
      'All work packages have PASS code-review pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs review or has FAIL pipeline.
  // BLOCKED WPs need upstream rework before Reviewer can retry — exclude them.
  const needsWork = wpsWithQa.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'code-review') ||
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need review
    const wpsNeedingWork = wpsWithQa.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'code-review') ||
        wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'Reviewer',
      'IN_PROGRESS',
      `Review work in progress. ${wpsNeedingWork.length} work package(s) still need review or rework.`,
      `Call ledger_get_next_action with agent_role: "Reviewer" to find the next work package to review. Continue working until all WPs have PASS code-review pipelines.`,
      projectPath,
      store
    );
  }

  // All reviewed WPs are done but some haven't reached QA yet
  if (wpsNotYetQaPassed.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsNotYetQaPassed.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsNotYetQaPassed.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
    );

    // If all unimplemented WPs are blocked, proceed to Documentation instead of waiting
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'Reviewer',
        'READY_FOR_DOCUMENTATION',
        `Review complete for all QA-passed work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Documentation to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    // Some WPs are ready for earlier stages
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DEVELOPER',
      `Review complete for all QA-passed work packages. ${readyWps.length} work package(s) ready for earlier stages: ${readyWps.map((wp) => wp.work_package_id).join(', ')}${blockedWps.length > 0 ? `. ${blockedWps.length} blocked by dependencies.` : ''}`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Reviewer',
    'READY_FOR_DOCUMENTATION',
    'Code review complete.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Documentation
 */
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs with code-review pipelines have PASS documentation pipelines
  const wpsWithReview = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  const allDocsPassed = wpsWithReview.every((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS')
  );

  // Check if there are WPs that haven't reached code-review yet
  const wpsNotYetReviewed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  if (allDocsPassed && wpsWithReview.length > 0) {
    // If there are still WPs that haven't been reviewed, earlier stages need to catch up
    if (wpsNotYetReviewed.length > 0) {
      // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
      const readyWps = wpsNotYetReviewed.filter(
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsNotYetReviewed.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
      );

      // If all unreviewed WPs are blocked by dependencies, proceed to Synthesis
      if (readyWps.length === 0 && blockedWps.length > 0) {
        return buildHandoffResponse(
          'Documentation',
          'READY_FOR_SYNTHESIS',
          `Documentation passed for ${wpsWithReview.length} work package(s). ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Synthesis to complete current WPs.`,
          undefined,
          projectPath,
          store
        );
      }

      return buildHandoffResponse(
        'Documentation',
        'READY_FOR_DEVELOPER',
        `Documentation passed for ${wpsWithReview.length} work package(s), but ${wpsNotYetReviewed.length} work package(s) still need earlier stages: ${wpsNotYetReviewed.map((wp) => wp.work_package_id).join(', ')}. Hand back to Developer.`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Documentation',
      'READY_FOR_SYNTHESIS',
      'All work packages have PASS documentation pipelines.',
      undefined,
      projectPath,
      store
    );
  }

  // Check if any non-BLOCKED WP needs documentation or has FAIL pipeline.
  // BLOCKED WPs need upstream rework before Documentation can retry — exclude them.
  const needsWork = wpsWithReview.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'documentation') ||
      wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need documentation
    const wpsNeedingWork = wpsWithReview.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'documentation') ||
        wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation work in progress. ${wpsNeedingWork.length} work package(s) still need documentation or rework.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // All documented WPs are done but some haven't reached review yet
  if (wpsNotYetReviewed.length > 0) {
    // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
    const readyWps = wpsNotYetReviewed.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsNotYetReviewed.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
    );

    // If all unreviewed WPs are blocked by dependencies, proceed to Synthesis
    if (readyWps.length === 0 && blockedWps.length > 0) {
      return buildHandoffResponse(
        'Documentation',
        'READY_FOR_SYNTHESIS',
        `Documentation complete for all reviewed work packages. ${blockedWps.length} work package(s) blocked by dependencies: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Proceed to Synthesis to complete current WPs.`,
        undefined,
        projectPath,
        store
      );
    }

    return buildHandoffResponse(
      'Documentation',
      'READY_FOR_DEVELOPER',
      `Documentation complete for all reviewed work packages. ${wpsNotYetReviewed.length} work package(s) still need earlier stages: ${wpsNotYetReviewed.map((wp) => wp.work_package_id).join(', ')}. Hand back to Developer.`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Documentation',
    'READY_FOR_SYNTHESIS',
    'Documentation complete.',
    undefined,
    projectPath,
    store
  );
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

    const allComplete = rootIndex.work_packages.every((wp) => wp.status === 'COMPLETE');
    if (allComplete) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ actions: [], reason: 'All work packages are COMPLETE.' }, null, 2),
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
        const handoffNotes = getHandoffNotesForAgent(wpDetail, agentNameMap[pipelineType as PostImplPipelineType]);
        actions.push({
          action: actionNameMap[pipelineType as PostImplPipelineType],
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} is ready for ${pipelineType}.`,
          ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
        });
        continue;
      }

      // BLOCKED WPs need upstream agent intervention before the current agent
      // can retry — skip rework suggestion to avoid infinite-loop signals.
      if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) {
        actions.push({
          action: reworkActionMap[pipelineType as PostImplPipelineType],
          work_package_id: wpDetail.work_package_id,
          reason: `Work package ${wpDetail.work_package_id} has a FAIL ${pipelineType} pipeline.`,
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
 * Register workflow tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_action',
    {
      description: 'Get the next recommended action for your agent role. REQUIRED params: project_path, agent_role. Call this to determine what to do next. Returns an action type and reason based on current work package and pipeline states.',
      inputSchema: GetNextActionSchema.passthrough(),
    },
    getNextAction as any
  );

  server.registerTool(
    'ledger_get_handoff_status',
    {
      description: 'Get the handoff status to determine if your work is done and which agent should work next. REQUIRED params: project_path, current_agent. Call this after completing your pipelines to check if work should be handed to the next agent in the workflow.',
      inputSchema: GetHandoffStatusSchema.passthrough(),
    },
    getHandoffStatus as any
  );

  server.registerTool(
    'ledger_get_next_actions',
    {
      description: 'Get all actionable work packages for your agent role (batch version of ledger_get_next_action). REQUIRED params: project_path, agent_role. OPTIONAL: max_results (default: 5). Returns an array of action recommendations. The singular ledger_get_next_action remains unchanged.',
      inputSchema: GetNextActionsSchema.passthrough(),
    },
    getNextActions as any
  );
}
