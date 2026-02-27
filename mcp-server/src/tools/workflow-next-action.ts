import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';
import { isTerminalStatus } from '../schema/validators.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  extractStalePipelineAction,
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  getHandoffNotesForAgent,
  hasNewUpstreamPassSince,
  MAX_REWORK_COUNT,
} from '../utils/workflow-helpers.js';
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

    // Check if all work packages are terminal (COMPLETE or CANCELLED)
    const allComplete = rootIndex.work_packages.every(
      (wp) => isTerminalStatus(wp.status)
    );

    if (allComplete) {
      if (args.agent_role === 'Synthesis') {
        // Only offer GENERATE_SYNTHESIS once — guard with synthesis_generated flag
        if (rootIndex.synthesis_generated) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason:
                      'Synthesis report has already been generated. Nothing to do.',
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

  // Check for rework circuit breaker — surface BLOCK_FOR_REWORK_LIMIT before other actions
  for (const wpDetail of wpDetails) {
    if (
      wpDetail.status !== 'BLOCKED' &&
      wpDetail.status !== 'COMPLETE' &&
      wpDetail.status !== 'CANCELLED' &&
      (wpDetail.rework_count ?? 0) >= MAX_REWORK_COUNT
    ) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'BLOCK_FOR_REWORK_LIMIT',
                work_package_id: wpDetail.work_package_id,
                rework_count: wpDetail.rework_count,
                max_rework_count: MAX_REWORK_COUNT,
                reason: `Work package ${wpDetail.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). It cannot proceed with further implementation cycles.`,
                next_steps: [
                  `1. Review the rework history in ${wpDetail.work_package_id} to understand repeated failures.`,
                  `2. Consider cancelling this WP via ledger_update_work_package_status (status: "CANCELLED") and creating a replacement WP with a revised approach.`,
                  `3. Alternatively, restructure the work package scope to address the root cause of repeated failures.`,
                  `4. Call ledger_get_handoff_status (current_agent: "Developer") to continue the workflow.`,
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

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
        const claimStep = wpDetail.status === 'READY'
          ? `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Developer") to transition to IN_PROGRESS.`
          : `1. WP is already IN_PROGRESS — skip claiming.`;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: 'IMPLEMENT',
                  work_package_id: wpDetail.work_package_id,
                  reason: `Work package ${wpDetail.work_package_id} is ${wpDetail.status} with no implementation pipeline. Claim and implement.`,
                  next_steps: [
                    claimStep,
                    `2. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation").`,
                    '3. Read the WP spec, implement the changes, run tests.',
                    `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                    `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
                  ],
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
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`,
                next_steps: [
                  `1. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation") — WP is already IN_PROGRESS.`,
                  '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
                  `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                  `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
                  next_steps: [
                    `1. Call ledger_get_work_package to review the FAIL ${downstreamType} pipeline comments/summary.`,
                    `2. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation") to begin a new implementation cycle.`,
                    '3. Fix the issues identified by the failed pipeline, run tests.',
                    `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                    `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
                  ],
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
export async function getQaAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS qa pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'qa');
    if (staleAction) return staleAction;
  }

  // Look for WPs with a new upstream implementation PASS not yet covered by a QA pipeline.
  // Uses temporal comparison to re-trigger QA after Developer rework cycles (Finding #2).
  // BLOCKED WPs are excluded from new-work suggestions (Finding #7).
  for (const wpDetail of wpDetails) {
    if (hasNewUpstreamPassSince(wpDetail.pipelines, 'implementation', 'qa') && wpDetail.status !== 'BLOCKED') {
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
                next_steps: [
                  `1. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa").`,
                  `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
                  '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
                  `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
                  `5. Call ledger_get_handoff_status (current_agent: "QA").`,
                ],
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

  // FAIL QA pipelines: QA does NOT self-rework — Developer must fix code first.
  // Return WAIT so the QA agent yields. The Developer will see the FAIL via
  // get_next_action and rework the implementation.
  for (const wpDetail of wpDetails) {
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WAIT',
                reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. Developer must rework the implementation before QA can retry. QA does not self-rework.`,
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
export async function getReviewerAction(rootIndex: RootIndex, store: LedgerStore) {
  // Load all WP details to examine pipeline states
  const wpDetails = await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // Check for stale IN_PROGRESS code-review pipelines (>24h)
  for (const wpDetail of wpDetails) {
    const staleAction = extractStalePipelineAction(wpDetail, 'code-review');
    if (staleAction) return staleAction;
  }

  // Look for WPs with a new upstream QA PASS not yet covered by a code-review pipeline.
  // Uses temporal comparison to re-trigger Review after Developer rework cycles (Finding #2).
  // BLOCKED WPs are excluded from new-work suggestions (Finding #7).
  for (const wpDetail of wpDetails) {
    if (hasNewUpstreamPassSince(wpDetail.pipelines, 'qa', 'code-review') && wpDetail.status !== 'BLOCKED') {
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
                next_steps: [
                  `1. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review").`,
                  `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
                  '3. Perform code review: architecture, quality, security, maintainability.',
                  `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
                  `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
                ],
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

  // FAIL code-review pipelines: Reviewer does NOT self-rework — Developer must fix code first.
  // Return WAIT so the Reviewer agent yields.
  for (const wpDetail of wpDetails) {
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'WAIT',
                reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Developer must rework the implementation before Reviewer can retry. Reviewer does not self-rework.`,
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
export async function getDocumentationAction(
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
                  next_steps: [
                    `1. Call ledger_update_work_package_status (work_package_id: "${wpDetail.work_package_id}", status: "COMPLETE", agent: "Documentation").`,
                    `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
                  ],
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

  // Look for WPs with a new upstream code-review PASS not yet covered by a documentation pipeline.
  // Uses temporal comparison to re-trigger Documentation after rework cycles (Finding #2).
  // BLOCKED WPs are excluded from new-work suggestions (Finding #7).
  for (const wpDetail of wpDetails) {
    if (hasNewUpstreamPassSince(wpDetail.pipelines, 'code-review', 'documentation') && wpDetail.status !== 'BLOCKED') {
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
                next_steps: [
                  `1. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "documentation").`,
                  `2. Call ledger_get_work_package to review implementation artifacts and review comments.`,
                  '3. Update documentation, README files, and inline docs as needed.',
                  `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                  `5. Call ledger_update_work_package_status (work_package_id: "${wpDetail.work_package_id}", status: "COMPLETE", agent: "Documentation").`,
                  `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
                ],
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
  // Documentation retains self-rework capability (unlike QA/Reviewer).
  for (const wpDetail of wpDetails) {
    if (wpDetail.status !== 'BLOCKED' && isMostRecentPipelineFail(wpDetail.pipelines, 'documentation')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                action: 'REWORK',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} has a FAIL documentation pipeline. Investigate and retry docs.`,
                next_steps: [
                  `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
                  `2. Call ledger_start_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "documentation").`,
                  '3. Fix documentation issues, update affected files.',
                  `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                  `5. Call ledger_update_work_package_status (work_package_id: "${wpDetail.work_package_id}", status: "COMPLETE", agent: "Documentation").`,
                  `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
                ],
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
 * Register the ledger_get_next_action tool on the MCP server.
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
}
