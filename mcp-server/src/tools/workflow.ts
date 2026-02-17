import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex, WorkPackageSummary } from '../schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../schema/work-package.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';

/**
 * Agent role definitions for the 7-stage workflow
 */
const AGENT_ROLES = [
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Reviewer',
  'Documentation',
  'Synthesis',
] as const;

type AgentRole = typeof AGENT_ROLES[number];

/**
 * Pipeline type mapping for each agent
 */
const PIPELINE_TYPE_MAP: Record<string, string> = {
  Developer: 'implementation',
  QA: 'qa',
  Reviewer: 'code-review',
  Documentation: 'documentation',
};

/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().describe('Absolute path to the project directory'),
  agent_role: z
    .string()
    .describe(
      'Agent role: Planner, Project Manager, Developer, QA, Reviewer, Documentation, or Synthesis'
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
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              action: 'RESOLVE_BLOCKERS',
              work_package_id: blockedWps[0].work_package_id,
              reason: `Work package ${blockedWps[0].work_package_id} is BLOCKED. Investigate and resolve blocker.`,
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
async function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

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
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'IMPLEMENT',
                  work_package_id: wpDetail.work_package_id,
                  reason: `Work package ${wpDetail.work_package_id} is ${wpDetail.status} with no implementation pipeline. Claim and implement.`,
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

  // Look for FAIL implementation pipelines needing rework
  for (const wpDetail of wpDetails) {
    const failedImplPipeline = wpDetail.pipelines
      .filter((p) => p.type === 'implementation')
      .reverse()
      .find((p) => p.status === 'FAIL');

    if (failedImplPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`,
              },
              null,
              2
            ),
          },
        ],
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

  // Look for WPs with PASS implementation pipeline but no QA pipeline
  for (const wpDetail of wpDetails) {
    const hasPassImplPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS'
    );
    const hasQaPipeline = wpDetail.pipelines.some((p) => p.type === 'qa');

    if (hasPassImplPipeline && !hasQaPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'RUN_QA',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS implementation pipeline but no QA pipeline. Run QA.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL QA pipelines needing rework
  for (const wpDetail of wpDetails) {
    const failedQaPipeline = wpDetail.pipelines
      .filter((p) => p.type === 'qa')
      .reverse()
      .find((p) => p.status === 'FAIL');

    if (failedQaPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK_QA',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. Investigate and retry QA.`,
              },
              null,
              2
            ),
          },
        ],
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

  // Look for WPs with PASS QA pipeline but no code-review pipeline
  for (const wpDetail of wpDetails) {
    const hasPassQaPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'qa' && p.status === 'PASS'
    );
    const hasReviewPipeline = wpDetail.pipelines.some(
      (p) => p.type === 'code-review'
    );

    if (hasPassQaPipeline && !hasReviewPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'RUN_REVIEW',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS QA pipeline but no code-review pipeline. Run review.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL code-review pipelines needing rework
  for (const wpDetail of wpDetails) {
    const failedReviewPipeline = wpDetail.pipelines
      .filter((p) => p.type === 'code-review')
      .reverse()
      .find((p) => p.status === 'FAIL');

    if (failedReviewPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK_REVIEW',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Investigate and retry review.`,
              },
              null,
              2
            ),
          },
        ],
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
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WRITE_DOCS',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has PASS code-review pipeline but no documentation pipeline. Write docs.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Look for FAIL documentation pipelines needing rework
  for (const wpDetail of wpDetails) {
    const failedDocsPipeline = wpDetail.pipelines
      .filter((p) => p.type === 'documentation')
      .reverse()
      .find((p) => p.status === 'FAIL');

    if (failedDocsPipeline) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK_DOCS',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL documentation pipeline. Investigate and retry docs.`,
              },
              null,
              2
            ),
          },
        ],
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
 * Helper: Check if a work package is blocked by dependencies
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
  project_path: z.string().describe('Absolute path to the project directory'),
  current_agent: z
    .string()
    .describe(
      'Current agent role: Planner, Project Manager, Developer, QA, Reviewer, Documentation, or Synthesis'
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

    // Check for BLOCKED work packages, but only report BLOCKED if there's no work that can proceed
    const blockedWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED'
    );
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );

    // Only report BLOCKED if there are blocked packages AND no work packages that can proceed
    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                agent: args.current_agent,
                status: 'BLOCKED',
                details: `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
              },
              null,
              2
            ),
          },
        ],
      };
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
        return getProjectManagerHandoff(wpDetails);
      case 'Developer':
        return getDeveloperHandoff(wpDetails);
      case 'QA':
        return getQaHandoff(wpDetails);
      case 'Reviewer':
        return getReviewerHandoff(wpDetails);
      case 'Documentation':
        return getDocumentationHandoff(wpDetails);
      case 'Synthesis':
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  agent: args.current_agent,
                  status: 'COMPLETE',
                  details: 'Synthesis complete.',
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
                  agent: args.current_agent,
                  status: 'IN_PROGRESS',
                  details: 'Work in progress.',
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
 * Get handoff status for Project Manager
 */
function getProjectManagerHandoff(wpDetails: WorkPackageDetail[]) {
  // If any WP lacks implementation pipeline, Developer needs to work
  const needsImplementation = wpDetails.some(
    (wp) =>
      (wp.status === 'READY' || wp.status === 'IN_PROGRESS') &&
      !wp.pipelines.some((p) => p.type === 'implementation')
  );

  if (needsImplementation) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Project Manager',
              status: 'READY_FOR_DEVELOPER',
              details: 'Work packages created and ready for implementation.',
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
            agent: 'Project Manager',
            status: 'IN_PROGRESS',
            details: 'Work packages in progress.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get handoff status for Developer
 */
function getDeveloperHandoff(wpDetails: WorkPackageDetail[]) {
  // Check if all WPs have PASS implementation pipelines
  const allImplemented = wpDetails.every((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  if (allImplemented) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Developer',
              status: 'READY_FOR_QA',
              details: 'All work packages have PASS implementation pipelines.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Check if any WP needs implementation or has FAIL pipeline
  const needsWork = wpDetails.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'implementation') ||
      wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
  );

  if (needsWork) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Developer',
              status: 'IN_PROGRESS',
              details:
                'Implementation work in progress. Some WPs need implementation or rework.',
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
            agent: 'Developer',
            status: 'READY_FOR_QA',
            details: 'Implementation complete.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get handoff status for QA
 */
function getQaHandoff(wpDetails: WorkPackageDetail[]) {
  // Check if all WPs with implementation pipelines have PASS QA pipelines
  const wpsWithImpl = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'PASS')
  );

  const allQaPassed = wpsWithImpl.every((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  if (allQaPassed && wpsWithImpl.length > 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'QA',
              status: 'READY_FOR_REVIEW',
              details: 'All implemented work packages have PASS QA pipelines.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Check if any WP needs QA or has FAIL pipeline
  const needsWork = wpsWithImpl.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'qa') ||
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL')
  );

  if (needsWork) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'QA',
              status: 'IN_PROGRESS',
              details: 'QA work in progress. Some WPs need QA or rework.',
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
            agent: 'QA',
            status: 'READY_FOR_REVIEW',
            details: 'QA complete.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get handoff status for Reviewer
 */
function getReviewerHandoff(wpDetails: WorkPackageDetail[]) {
  // Check if all WPs with QA pipelines have PASS code-review pipelines
  const wpsWithQa = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );

  const allReviewPassed = wpsWithQa.every((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  if (allReviewPassed && wpsWithQa.length > 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Reviewer',
              status: 'READY_FOR_DOCUMENTATION',
              details: 'All QA-passed work packages have PASS code-review pipelines.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Check if any WP needs review or has FAIL pipeline
  const needsWork = wpsWithQa.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'code-review') ||
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'FAIL')
  );

  if (needsWork) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Reviewer',
              status: 'IN_PROGRESS',
              details: 'Review work in progress. Some WPs need review or rework.',
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
            agent: 'Reviewer',
            status: 'READY_FOR_DOCUMENTATION',
            details: 'Code review complete.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get handoff status for Documentation
 */
function getDocumentationHandoff(wpDetails: WorkPackageDetail[]) {
  // Check if all WPs with code-review pipelines have PASS documentation pipelines
  const wpsWithReview = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  const allDocsPassed = wpsWithReview.every((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS')
  );

  if (allDocsPassed && wpsWithReview.length > 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Documentation',
              status: 'READY_FOR_SYNTHESIS',
              details:
                'All reviewed work packages have PASS documentation pipelines.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Check if any WP needs documentation or has FAIL pipeline
  const needsWork = wpsWithReview.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'documentation') ||
      wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'FAIL')
  );

  if (needsWork) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              agent: 'Documentation',
              status: 'IN_PROGRESS',
              details:
                'Documentation work in progress. Some WPs need docs or rework.',
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
            agent: 'Documentation',
            status: 'READY_FOR_SYNTHESIS',
            details: 'Documentation complete.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Register workflow tools on the MCP server
 */
export function register(server: McpServer): void {
  server.tool(
    'ledger_get_next_action',
    'Recommend the next action for an agent based on project state and agent role. Examines work package statuses and pipeline states to provide actionable recommendations.',
    GetNextActionSchema.shape,
    getNextAction
  );

  server.tool(
    'ledger_get_handoff_status',
    'Compute the correct AGENT and STATUS handoff block for the current agent. Examines all work package statuses and pipelines to determine project state.',
    GetHandoffStatusSchema.shape,
    getHandoffStatus
  );
}
