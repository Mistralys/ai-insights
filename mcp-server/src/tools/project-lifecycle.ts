import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import type { RootIndex } from '../schema/root-index.js';
import { access, constants } from 'fs/promises';
import { validatePlanPathOrError } from '../utils/path-validator.js';

/**
 * Tool: get_project_status
 *
 * Reads the root index and returns project overview.
 * Includes self-healing logic that recomputes counters from actual WP data.
 */
const GetProjectStatusSchema = z.object({
  project_path: z.string().describe('Absolute path to the project directory'),
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

    // If counts are incorrect, update them
    if (
      rootIndex.total_work_packages !== totalWps ||
      rootIndex.pending_work_packages !== pendingWps
    ) {
      rootIndex.total_work_packages = totalWps;
      rootIndex.pending_work_packages = pendingWps;
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
  project_path: z.string().describe('Absolute path to the project directory'),
  plan_file: z
    .string()
    .describe('Relative path to the plan file (e.g., docs/agents/plans/2026-02-12/plan.md)'),
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
          text: `Error: Project ledger already exists at ${args.project_path}/.ledger/project-ledger.json. Use MCP tools to update the existing ledger.`,
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
    // 4. Write root index (atomicWriteJson will create ledger/ directory via mkdir -p)
    await store.writeRootIndex(rootIndex);

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
 * Register project lifecycle tools on the MCP server
 */
export function register(server: McpServer): void {
  server.tool(
    'ledger_get_project_status',
    'Read project overview from the root index. Self-heals incorrect counters.',
    GetProjectStatusSchema.shape,
    getProjectStatus
  );

  server.tool(
    'ledger_initialize_project',
    'Create a new project ledger with root index and ledger/ subdirectory. Rejects if ledger already exists.',
    InitializeProjectSchema.shape,
    initializeProject
  );
}
