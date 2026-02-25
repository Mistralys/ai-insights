import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { DetectProjectResult } from '../storage/ledger-store.js';
import { WorkPackageStatus } from '../schema/enums.js';
import { now } from '../utils/timestamp.js';
import type { RootIndex } from '../schema/root-index.js';
import { access, constants } from 'fs/promises';
import { validatePlanPathOrError } from '../utils/path-validator.js';

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
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
});

async function getProjectStatus(args: z.infer<typeof GetProjectStatusSchema>) {
  // Validate that the path ends with a valid plan folder pattern
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) {
    return validationError;
  }

  const store = new LedgerStore(args.project_path);

  try {
    // Read the root index
    const rootIndex = await store.readRootIndex();

    // Self-healing: recompute counters from actual work package summaries
    const totalWps = rootIndex.work_packages.length;
    const pendingWps = rootIndex.work_packages.filter(
      (wp) => wp.status !== 'COMPLETE'
    ).length;

    // Self-healing: auto-transition project status based on pending count
    let healedStatus = rootIndex.status;
    if (
      rootIndex.status === 'IN_PROGRESS' &&
      pendingWps === 0 &&
      totalWps > 0
    ) {
      // All work packages are done — project should be COMPLETE
      healedStatus = 'COMPLETE';
    } else if (rootIndex.status === 'COMPLETE' && pendingWps > 0) {
      // Work was reopened — project should be back to IN_PROGRESS
      healedStatus = 'IN_PROGRESS';
    } else if (rootIndex.status === 'READY') {
      // If any WP is IN_PROGRESS, the project should already be IN_PROGRESS
      const hasInProgressWp = rootIndex.work_packages.some(
        (wp) => wp.status === 'IN_PROGRESS'
      );
      if (hasInProgressWp) {
        healedStatus = 'IN_PROGRESS';
      }
    } else if (rootIndex.status === 'BLOCKED') {
      // If no WPs are actually BLOCKED, the project status is stale
      const hasBlockedWp = rootIndex.work_packages.some(
        (wp) => wp.status === 'BLOCKED'
      );
      if (!hasBlockedWp) {
        const hasInProgressWp = rootIndex.work_packages.some(
          (wp) => wp.status === 'IN_PROGRESS'
        );
        const hasReadyWp = rootIndex.work_packages.some(
          (wp) => wp.status === 'READY'
        );
        healedStatus = hasInProgressWp ? 'IN_PROGRESS' : hasReadyWp ? 'READY' : healedStatus;
      }
    }

    // If counts or status are incorrect, update them
    if (
      rootIndex.total_work_packages !== totalWps ||
      rootIndex.pending_work_packages !== pendingWps ||
      rootIndex.status !== healedStatus
    ) {
      rootIndex.total_work_packages = totalWps;
      rootIndex.pending_work_packages = pendingWps;
      rootIndex.status = healedStatus;
      rootIndex.last_updated = now();

      // Write the corrected root index
      await store.writeRootIndex(rootIndex);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(rootIndex, null, 2),
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
            text: `Project not initialized at ${args.project_path}. Use ledger_initialize_project to create a new project ledger.`,
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
const InitializeProjectSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  plan_file: z
    .string()
    .describe('Relative path to the plan file from project_path (e.g., "plan.md")'),
});

async function initializeProject(
  args: z.infer<typeof InitializeProjectSchema>
) {
  // Validate that the path ends with a valid plan folder pattern
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) {
    return validationError;
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

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(rootIndex, null, 2),
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
      inputSchema: GetProjectStatusSchema.passthrough(),
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
}
