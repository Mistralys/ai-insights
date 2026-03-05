import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../utils/constants.js';
import type { DetectProjectResult } from '../storage/ledger-store.js';
import { WorkPackageStatus } from '../schema/enums.js';
import { isTerminalStatus } from '../schema/validators.js';
import { now, parseTimestamp } from '../utils/timestamp.js';
import type { RootIndex } from '../schema/root-index.js';
import { access, constants } from 'fs/promises';
import { validatePlanPath, resolveProjectPath, mutuallyExclusivePaths, MUTUAL_EXCLUSIVITY_PATH_MSG } from '../utils/path-validator.js';
import { AGENT_ROLES } from '../utils/constants.js';
import { withLock } from '../storage/file-lock.js';
import { PIPELINE_TYPES } from '../utils/pipeline-maps.js';
import { getPassedStages } from '../utils/project-reset.js';

/**
 * Tool: detect_project
 *
 * Identifies the active project by cross-referencing the supplied working-
 * directory path against all project roots stored in the centralized ledger.
 */
const DetectProjectSchema = z.object({
  cwd_path: z
    .string()
    .describe(
      'Absolute path to the directory the agent is currently working from (e.g. the VS Code workspace root). ' +
      'The tool will match this against all known project roots and return the unique project whose codebase ' +
      'contains this path. Must not be a file path — pass the directory only.'
    ),
});

async function detectProject(args: z.infer<typeof DetectProjectSchema>) {
  let result: DetectProjectResult;

  try {
    result = await LedgerStore.detectProjectByCwd(args.cwd_path);
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }

  if (result.status === 'FOUND') {
    const { plan_path, slug, title, status } = result.meta;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ plan_path, slug, title, status }, null, 2),
        },
      ],
    };
  }

  if (result.status === 'AMBIGUOUS') {
    const candidateList = result.candidates
      .map((c) => `  - ${c.plan_path} (${c.slug})`)
      .join('\n');
    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Error: Multiple projects match the provided path. ` +
            `Provide an explicit project_path to disambiguate.\n\nCandidates:\n${candidateList}`,
        },
      ],
      isError: true,
    };
  }

  // NOT_FOUND
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Error: No project found whose codebase contains the path "${args.cwd_path}". ` +
          `Ensure the project has been initialized with ledger_initialize_project and that ` +
          `the provided path is inside the project root.`,
      },
    ],
    isError: true,
  };
}

/**
 * Tool: get_project_status
 *
 * Reads the root index and returns project overview.
 * Includes self-healing logic that recomputes counters from actual WP data.
 */
const GetProjectStatusSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  cwd_path: z.string().optional().describe('Workspace root path — alternative to project_path for automatic project detection.'),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

/**
 * Pure function: computes the healed project status and counters from
 * the current root index data. Does NOT read or write disk.
 *
 * Implements all 16 healing rules from §17.2 of the workflow specification
 * in first-match-wins order.
 */
export function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: RootIndex['status'];
  needsWrite: boolean;
  corruptionDetected: boolean;
} {
  const totalWps = rootIndex.work_packages.length;
  const pendingWps = rootIndex.work_packages.filter(
    (wp) => !isTerminalStatus(wp.status)
  ).length;

  // Corruption mitigation (§17.2 known-gap note):
  // If synthesis_generated is true but pending WPs still exist, the flag was set
  // prematurely. Treat it as false for this computation — do NOT mutate the input.
  let synthesisGenerated = rootIndex.synthesis_generated ?? false;
  let corruptionDetected = false;
  if (synthesisGenerated && pendingWps > 0) {
    synthesisGenerated = false;
    corruptionDetected = true;
  }

  // Pre-compute shared predicates once.
  const hasInProgressWp = rootIndex.work_packages.some((wp) => wp.status === 'IN_PROGRESS');
  const hasReadyWp = rootIndex.work_packages.some((wp) => wp.status === 'READY');

  let healedStatus = rootIndex.status;

  if (
      // Rule 1: (IN_PROGRESS or READY) AND pending==0 AND total>0 AND synthesis_generated → COMPLETE
      (rootIndex.status === 'IN_PROGRESS' || rootIndex.status === 'READY') &&
      pendingWps === 0 && totalWps > 0 && synthesisGenerated
    ) {
      healedStatus = 'COMPLETE';
    } else if (
      // Rule 1b: READY AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'READY' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 1c: IN_PROGRESS AND pending==0 AND total>0 AND NOT synthesis_generated → preserve
      // No-op: status is correct — project is awaiting synthesis step.
      rootIndex.status === 'IN_PROGRESS' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 2: COMPLETE AND pending>0 → IN_PROGRESS
      rootIndex.status === 'COMPLETE' && pendingWps > 0
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 2b: COMPLETE AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'COMPLETE' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 3: READY AND hasInProgressWp → IN_PROGRESS
      rootIndex.status === 'READY' && hasInProgressWp
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 3b: READY AND pending>0 AND !hasReadyWp AND !hasInProgressWp → BLOCKED
      // (all remaining pending WPs are BLOCKED)
      rootIndex.status === 'READY' &&
      pendingWps > 0 && !hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'BLOCKED';
    } else if (
      // Rule 3c: IN_PROGRESS AND pending>0 AND !hasReadyWp AND !hasInProgressWp → BLOCKED
      rootIndex.status === 'IN_PROGRESS' &&
      pendingWps > 0 && !hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'BLOCKED';
    } else if (
      // Rule 4: BLOCKED AND hasInProgressWp → IN_PROGRESS
      rootIndex.status === 'BLOCKED' && hasInProgressWp
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 4b: BLOCKED AND hasReadyWp AND !hasInProgressWp → READY
      rootIndex.status === 'BLOCKED' && hasReadyWp && !hasInProgressWp
    ) {
      healedStatus = 'READY';
    } else if (
      // Rule 5a: BLOCKED AND pending==0 AND total>0 AND synthesis_generated → COMPLETE
      rootIndex.status === 'BLOCKED' &&
      pendingWps === 0 && totalWps > 0 && synthesisGenerated
    ) {
      healedStatus = 'COMPLETE';
    } else if (
      // Rule 5b: BLOCKED AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
      rootIndex.status === 'BLOCKED' &&
      pendingWps === 0 && totalWps > 0 && !synthesisGenerated
    ) {
      healedStatus = 'IN_PROGRESS';
    } else if (
      // Rule 6b: (IN_PROGRESS or BLOCKED) AND total==0 → READY
      (rootIndex.status === 'IN_PROGRESS' || rootIndex.status === 'BLOCKED') &&
      totalWps === 0
    ) {
      healedStatus = 'READY';
    } else if (
      // Rule 6c: COMPLETE AND total==0 → READY
      rootIndex.status === 'COMPLETE' && totalWps === 0
    ) {
      healedStatus = 'READY';
    }

  const needsWrite =
    rootIndex.total_work_packages !== totalWps ||
    rootIndex.pending_work_packages !== pendingWps ||
    rootIndex.status !== healedStatus ||
    corruptionDetected;

  return { totalWps, pendingWps, healedStatus, needsWrite, corruptionDetected };
}

/**
 * Validates that pipeline `started_at` timestamps within each WP are
 * monotonically non-decreasing (§17.4).
 *
 * Returns an array of human-readable warning strings — one per ordering
 * violation. Returns an empty array when all orderings are valid.
 * Does not reorder or mutate any data.
 */
async function validatePipelineOrdering(
  rootIndex: RootIndex,
  store: LedgerStore
): Promise<string[]> {
  const warnings: string[] = [];

  for (const wpSummary of rootIndex.work_packages) {
    try {
      const wpDetail = await store.readWorkPackage(wpSummary.work_package_id);
      const pipelines = wpDetail.pipelines ?? [];

      for (let i = 1; i < pipelines.length; i++) {
        const prev = pipelines[i - 1];
        const curr = pipelines[i];

        if (prev?.started_at && curr?.started_at) {
          const prevTime = parseTimestamp(prev.started_at).getTime();
          const currTime = parseTimestamp(curr.started_at).getTime();

          if (currTime < prevTime) {
            warnings.push(
              `${wpSummary.work_package_id}: pipeline[${i}] started before pipeline[${i - 1}]` +
              ` (${curr.started_at} < ${prev.started_at})`
            );
          }
        }
      }
    } catch {
      // Skip WPs that cannot be read — ordering validation is non-fatal.
    }
  }

  return warnings;
}

/** Aggregate pipeline-stage completeness across all non-CANCELLED work packages. */
async function computePipelineHealth(
  rootIndex: RootIndex,
  store: LedgerStore
): Promise<{ wps_with_all_stages_pass: number; wps_missing_stages: number; total_stages_missing: number }> {
  let wpsWithAllStagesPass = 0;
  let wpsMissingStages = 0;
  let totalStagesMissing = 0;

  for (const wpSummary of rootIndex.work_packages) {
    if (wpSummary.status === 'CANCELLED') continue;
    try {
      const wpDetail = await store.readWorkPackage(wpSummary.work_package_id);
      const passed = getPassedStages(wpDetail);
      const missing = PIPELINE_TYPES.length - passed.size;
      if (missing === 0) {
        wpsWithAllStagesPass++;
      } else {
        wpsMissingStages++;
        totalStagesMissing += missing;
      }
    } catch {
      // Skip unreadable WP detail files — health computation is non-fatal.
    }
  }

  return {
    wps_with_all_stages_pass: wpsWithAllStagesPass,
    wps_missing_stages:       wpsMissingStages,
    total_stages_missing:     totalStagesMissing,
  };
}

async function getProjectStatus(
  args: z.infer<typeof GetProjectStatusSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    // Read the root index
    const rootIndex = await store.readRootIndex();

    // Self-healing: compute corrected counters and status (pure)
    const healed = computeHealedStatus(rootIndex);

    // Only write to disk if corrections are actually needed
    if (healed.needsWrite) {
      await withLock(store.storageDir, async () => {
        // Re-read under lock to avoid race conditions
        const fresh = await store.readRootIndex();
        const freshHealed = computeHealedStatus(fresh);
        if (freshHealed.needsWrite) {
          fresh.total_work_packages = freshHealed.totalWps;
          fresh.pending_work_packages = freshHealed.pendingWps;
          fresh.status = freshHealed.healedStatus;
          if (freshHealed.corruptionDetected) fresh.synthesis_generated = false;
          fresh.last_updated = now();
          await store.writeRootIndex(fresh);
        }
      });

      // Post-healing: validate pipeline ordering and emit warnings as project comments (§17.4).
      // Piggybacks on the existing write path — only runs when self-healing was triggered.
      const orderingWarnings = await validatePipelineOrdering(rootIndex, store);
      if (orderingWarnings.length > 0) {
        await withLock(store.storageDir, async () => {
          const current = await store.readRootIndex();
          for (const warning of orderingWarnings) {
            current.project_comments.push({
              type: 'warning',
              priority: 'low',
              timestamp: now(),
              agent: 'system',
              note: warning,
            });
          }
          current.last_updated = now();
          await store.writeRootIndex(current);
        });
      }

      // Re-read to return the corrected data
      const corrected = await store.readRootIndex();
      const pipelineHealthHealed = await computePipelineHealth(corrected, store);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...corrected, pipeline_health: pipelineHealthHealed }, null, 2),
          },
        ],
      };
    }

    const pipelineHealth = await computePipelineHealth(rootIndex, store);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ...rootIndex, pipeline_health: pipelineHealth }, null, 2),
        },
      ],
    };
  } catch (error) {
    // Handle "project not found" gracefully for pre-flight checks
    if ((error as Error).message.includes('Root index not found')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Project not initialized at ${projectPath}. Use ledger_initialize_project to create a new project ledger.`,
          },
        ],
      };
    }

    // Return other errors (validation failures, etc.) as error responses
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
 * Tool: initialize_project
 *
 * Creates a new project ledger with root index and ledger/ subdirectory.
 * Rejects if ledger already exists.
 */
export const InitializeProjectSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  plan_file: z
    .string()
    .refine((v) => v === PLAN_ARCHIVE_FILENAME, {
      message: `plan_file must be '${PLAN_ARCHIVE_FILENAME}' to match the GUI plan document read path`,
    })
    .describe(
      `Relative path to the plan file from project_path. Must be '${PLAN_ARCHIVE_FILENAME}' — this value is enforced to keep the GUI plan document read path consistent.`
    ),
});

async function initializeProject(
  args: z.infer<typeof InitializeProjectSchema>
) {
  // Validate that the path ends with a valid plan folder pattern
  const pathValidation = validatePlanPath(args.project_path);
  if (!pathValidation.isValid) {
    return { content: [{ type: 'text' as const, text: pathValidation.error }], isError: true };
  }

  const store = new LedgerStore(args.project_path);

  try {
    // 1. Verify project_path exists
    await access(args.project_path, constants.F_OK);
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Project path does not exist: ${args.project_path}`,
        },
      ],
      isError: true,
    };
  }

  // 2. Reject if project-ledger.json already exists
  const rootExists = await store.rootIndexExists();
  if (rootExists) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Project ledger already exists for ${args.project_path}. Use MCP tools to update the existing ledger.`,
        },
      ],
      isError: true,
    };
  }

  // 3. Create the root index structure
  const timestamp = now();
  const rootIndex: RootIndex = {
    plan_file: args.plan_file,
    date_created: timestamp,
    last_updated: timestamp,
    status: 'READY',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
  };

  try {
    // 4. Write root index (atomicWriteJson will create storageDir via mkdir -p)
    await store.writeRootIndex(rootIndex);

    // 5. Write .meta.json so the project is immediately visible via ledger_list_projects
    await store.writeProjectMeta(args.plan_file);

    // 6. Archive the plan document into the ledger storage directory (best-effort)
    const archiveResult = await store.archiveDocuments([args.plan_file]);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ...rootIndex,
            archived_documents: archiveResult.archived,
            archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error initializing project: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: list_projects
 *
 * Lists all projects tracked in the centralized ledger.
 * Optionally filters by status.
 */
const ListProjectsSchema = z.object({
  status: WorkPackageStatus.optional().describe('Optional filter: only return projects with this status'),
});

async function listProjects(args: z.infer<typeof ListProjectsSchema>) {
  try {
    const projects = await LedgerStore.listAllProjects();
    const filtered = args.status
      ? projects.filter((p) => p.status === args.status)
      : projects;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(filtered, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing projects: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: complete_synthesis
 *
 * Marks synthesis as generated on the root index. Sets `synthesis_generated = true`
 * and transitions the project to COMPLETE if all work packages are done.
 */
const CompleteSynthesisSchema = z.object({
  project_path: z
    .string()
    .optional()
    .describe('Absolute path to the project plan directory'),
  cwd_path: z
    .string()
    .optional()
    .describe('Workspace root path — alternative to project_path for automatic project detection.'),
  agent_role: z
    .string()
    .describe('The agent role completing synthesis (must be "Synthesis" or "Project Manager")'),
  synthesis_file: z
    .string()
    .optional()
    .default(SYNTHESIS_ARCHIVE_FILENAME)
    .describe(`Filename of the synthesis document (default: "${SYNTHESIS_ARCHIVE_FILENAME}")`),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

async function completeSynthesis(
  args: z.infer<typeof CompleteSynthesisSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | undefined;

    await withLock(store.storageDir, async () => {
      const rootIndex = await store.readRootIndex();

      // §19.1 Guard 1: Agent role validation
      const SYNTHESIS_PERMITTED_ROLES: readonly string[] = AGENT_ROLES.filter(
        (r) => r === 'Synthesis' || r === 'Project Manager'
      );
      if (!SYNTHESIS_PERMITTED_ROLES.includes(args.agent_role)) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: `Error: completeSynthesis requires agent_role ${SYNTHESIS_PERMITTED_ROLES.map(r => `"${r}"`).join(' or ')}, got "${args.agent_role}"`,
            },
          ],
          isError: true,
        };
        return;
      }

      // §19.1 Guard 2: Freshly computed counters (do not trust stale pending_work_packages)
      const totalWps = rootIndex.work_packages.length;
      const pendingWps = rootIndex.work_packages.filter(
        (wp) => !isTerminalStatus(wp.status)
      ).length;

      // §19.1 Guard 3: At-least-one-WP guard
      if (totalWps === 0) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Cannot complete synthesis: no work packages exist',
            },
          ],
          isError: true,
        };
        return;
      }

      // §19.1 Guard 4: Pending-WP guard (uses freshly computed pendingWps, not stale counter)
      if (pendingWps > 0) {
        result = {
          content: [
            {
              type: 'text' as const,
              text: `Error: Cannot complete synthesis: ${pendingWps} work package(s) are still pending`,
            },
          ],
          isError: true,
        };
        return;
      }

      rootIndex.synthesis_generated = true;
      rootIndex.auto_handoff_depth = 0; // §18.4: depth counter resets only on synthesis completion
      rootIndex.last_updated = now();

      // All WPs are terminal (pendingWps === 0 && totalWps > 0) — transition project to COMPLETE
      rootIndex.status = 'COMPLETE';

      await store.writeRootIndex(rootIndex);

      const synthesisFile = args.synthesis_file ?? SYNTHESIS_ARCHIVE_FILENAME;
      const archiveResult = await store.archiveDocuments([synthesisFile]);

      result = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                synthesis_generated: true,
                project_status: rootIndex.status,
                message: 'Synthesis marked as generated.',
                archived_documents: archiveResult.archived,
                archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
                next_steps: [
                  'Your work is complete. Call ledger_get_handoff_status (current_agent: "Synthesis") to end the workflow.',
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    });

    if (result === undefined) {
      throw new Error('Internal error: completeSynthesis — result was not set inside the lock');
    }
    return result;
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error completing synthesis: ${(error as Error).message}`,
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
  completeSynthesis,
  initializeProject,
  getProjectStatus,
};

/**
 * Register project lifecycle tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_detect_project',
    {
      description:
        'Detect the active project from the current workspace path when project_path is not explicitly provided. ' +
        'Accepts a working directory path (cwd_path), cross-references it against all project roots stored in the ' +
        'centralized ledger, and returns the unique project plan_path. Returns NOT_FOUND if no known project root ' +
        'is an ancestor of the given path, or AMBIGUOUS (with candidate list) if more than one project matches.',
      inputSchema: DetectProjectSchema.passthrough(),
    },
    detectProject as any
  );

  server.registerTool(
    'ledger_get_project_status',
    {
      description: 'Read project overview from the root index. REQUIRED params: project_path. Returns work package summaries, counters, and project status. Self-heals incorrect counters. Call this first to understand project state.',
      inputSchema: GetProjectStatusSchema,
    },
    getProjectStatus as any
  );

  server.registerTool(
    'ledger_initialize_project',
    {
      description: 'Create a new project ledger. REQUIRED params: project_path, plan_file. Creates root index and .ledger/ subdirectory. Rejects if ledger already exists. Call this once at project start before creating work packages.',
      inputSchema: InitializeProjectSchema.passthrough(),
    },
    initializeProject as any
  );

  server.registerTool(
    'ledger_list_projects',
    {
      description: 'List all projects tracked in the centralized ledger with their current status, dates, and plan paths. OPTIONAL params: status (filter by READY/IN_PROGRESS/COMPLETE/BLOCKED).',
      inputSchema: ListProjectsSchema.passthrough(),
    },
    listProjects as any
  );

  server.registerTool(
    'ledger_complete_synthesis',
    {
      description: 'Mark synthesis as generated. Sets synthesis_generated=true on the root index and transitions project to COMPLETE if all WPs are done. REQUIRED params: project_path, agent_role. Call this after generating the synthesis report.',
      inputSchema: CompleteSynthesisSchema,
    },
    (args) => completeSynthesis(args)
  );
}
