import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type {
  WorkPackageDetail,
  AcceptanceCriterion,
  Blocker,
} from '../schema/work-package.js';
import type { WorkPackageSummary } from '../schema/root-index.js';
import { formatWpId } from '../utils/wp-id.js';
import { now } from '../utils/timestamp.js';
import {
  isValidStatusTransition,
  canStartWorkPackage,
  canCompleteWorkPackage,
} from '../schema/validators.js';
import { withLock } from '../storage/file-lock.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';

/**
 * Tool: get_work_package
 *
 * Reads and returns the full work package detail for a given WP ID.
 */
const GetWorkPackageSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
});

async function getWorkPackage(args: z.infer<typeof GetWorkPackageSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    const wp = await store.readWorkPackage(args.work_package_id);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(wp, null, 2),
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
 * Tool: list_work_packages
 *
 * Lists work package summaries from the root index.
 * Optionally filters by status and/or assigned_to.
 */
const ListWorkPackagesSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED'])
    .optional()
    .describe('Optional filter by work package status'),
  assigned_to: z.string().optional().describe('Optional filter by assigned agent name'),
});

async function listWorkPackages(args: z.infer<typeof ListWorkPackagesSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    const rootIndex = await store.readRootIndex();
    let wps = rootIndex.work_packages;

    // Apply filters
    if (args.status) {
      wps = wps.filter((wp) => wp.status === args.status);
    }

    if (args.assigned_to) {
      wps = wps.filter((wp) => wp.assigned_to === args.assigned_to);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(wps, null, 2),
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
 * Tool: create_work_package
 *
 * Creates a new work package with auto-generated WP ID.
 * Creates both the detail file (.ledger/WP-###.json) and root index summary atomically.
 */
const CreateWorkPackageSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  assigned_to: z
    .string()
    .describe('Agent name assigned to this work package (e.g., "Developer")'),
  dependencies: z
    .array(z.string().regex(/^WP-\d{3}$/))
    .describe('Array of WP IDs this depends on (e.g., ["WP-001"]). Use [] for no dependencies.'),
  acceptance_criteria: z
    .array(z.string())
    .describe('Array of acceptance criteria strings (e.g., ["All tests pass", "No lint errors"])'),
  work_package_file: z
    .string()
    .describe('Relative path to the work package spec file (e.g., "work/WP-001.md")'),
});

async function createWorkPackage(
  args: z.infer<typeof CreateWorkPackageSchema>
) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  let createdWpId = '';

  try {
    // Use lock to ensure atomic creation of both files
    await withLock(args.project_path, async () => {
      // 1. Read root index to get next WP ID
      const rootIndex = await store.readRootIndex();

      // 2. Generate next WP ID (1-indexed)
      const nextWpNumber = rootIndex.work_packages.length + 1;
      const wpId = formatWpId(nextWpNumber);
      createdWpId = wpId;

      // 3. Validate dependencies exist
      for (const depId of args.dependencies) {
        const depExists = rootIndex.work_packages.some(
          (wp) => wp.work_package_id === depId
        );
        if (!depExists) {
          throw new Error(
            `Dependency ${depId} not found in project. Create dependencies before creating this work package.`
          );
        }
      }

      // 4. Determine initial status
      let initialStatus: 'READY' | 'BLOCKED' = 'READY';
      if (args.dependencies.length > 0) {
        const depCheck = canStartWorkPackage(
          { dependencies: args.dependencies } as WorkPackageSummary,
          rootIndex.work_packages
        );
        if (!depCheck.allowed) {
          initialStatus = 'BLOCKED';
        }
      }

      // 5. Create acceptance criteria objects
      const acceptanceCriteria: AcceptanceCriterion[] =
        args.acceptance_criteria.map((criterion) => ({
          criterion,
          met: false,
        }));

      // 6. Create work package detail
      const wpDetail: WorkPackageDetail = {
        work_package_id: wpId,
        work_package_file: args.work_package_file,
        status: initialStatus,
        assigned_to: args.assigned_to,
        dependencies: args.dependencies,
        acceptance_criteria: acceptanceCriteria,
        revision: 1,
        pipelines: [],
      };

      // 7. Create work package summary
      const wpSummary: WorkPackageSummary = {
        work_package_id: wpId,
        status: initialStatus,
        assigned_to: args.assigned_to,
        dependencies: args.dependencies,
        file: `ledger/${wpId}.json`,
      };

      // 8. Update root index
      rootIndex.work_packages.push(wpSummary);
      rootIndex.total_work_packages += 1;
      rootIndex.pending_work_packages += 1;
      rootIndex.last_updated = now();

      // Set project status to IN_PROGRESS if currently READY
      if (rootIndex.status === 'READY') {
        rootIndex.status = 'IN_PROGRESS';
      }

      // 9. Write both files atomically
      await store.writeWorkPackage(wpId, wpDetail);
      await store.writeRootIndex(rootIndex);
    });

    // 10. Read back the created work package to return it
    const createdWp = await store.readWorkPackage(createdWpId);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(createdWp, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error creating work package: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: claim_work_package
 *
 * Claims a work package by transitioning READY -> IN_PROGRESS.
 * Validates dependencies are met before allowing the transition.
 */
const ClaimWorkPackageSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID to claim, format: WP-001, WP-002, etc.'),
  agent: z.string().describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation")'),
});

async function claimWorkPackage(args: z.infer<typeof ClaimWorkPackageSchema>) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Validate current status is READY
      if (wp.status !== 'READY') {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: current status is ${wp.status}. Only READY work packages can be claimed.`
        );
      }

      // 2. Check dependencies
      const depCheck = canStartWorkPackage(wp, root.work_packages);
      if (!depCheck.allowed) {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: ${depCheck.reason}`
        );
      }

      // 3. Validate status transition (should always be valid at this point)
      if (!isValidStatusTransition(wp.status, 'IN_PROGRESS')) {
        throw new Error(
          `Invalid status transition: ${wp.status} -> IN_PROGRESS`
        );
      }

      // 4. Update work package
      wp.status = 'IN_PROGRESS';
      wp.assigned_to = args.agent;

      // 5. Update root index summary
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = 'IN_PROGRESS';
        summary.assigned_to = args.agent;
      }

      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedWp, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error claiming work package: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: update_work_package_status
 *
 * Updates work package status with validation.
 * Enforces legal status transitions and special rules (COMPLETE requires all criteria met, etc.).
 */
const UpdateWorkPackageStatusSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3}$/)
    .describe('Work package ID to update, format: WP-001, WP-002, etc.'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED'])
    .describe('New status. Legal transitions: READY→IN_PROGRESS, READY→BLOCKED, IN_PROGRESS→COMPLETE, IN_PROGRESS→BLOCKED, BLOCKED→IN_PROGRESS, COMPLETE→IN_PROGRESS'),
  agent: z
    .string()
    .describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation"). Note: only "Documentation" or "Documentation Agent" can set status to COMPLETE.'),
  blocked_by: z
    .object({
      type: z.enum(['dependency', 'decision', 'external', 'technical']),
      description: z.string(),
      blocking_work_package: z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe('Blocker details — REQUIRED when setting status to BLOCKED, omit otherwise'),
});

async function updateWorkPackageStatus(
  args: z.infer<typeof UpdateWorkPackageStatusSchema>
) {
  const validationError = validatePlanPathOrError(args.project_path);
  if (validationError) return validationError;

  const store = new LedgerStore(args.project_path);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      const oldStatus = wp.status;
      const newStatus = args.status;

      // 1. Validate status transition
      if (!isValidStatusTransition(oldStatus, newStatus)) {
        throw new Error(
          `Invalid status transition: ${oldStatus} -> ${newStatus}. Legal transitions from ${oldStatus}: ${getLegalTransitions(oldStatus)}`
        );
      }

      // 2. Validate agent permissions for COMPLETE status
      if (newStatus === 'COMPLETE') {
        // Only Documentation Agent can mark work packages as COMPLETE
        // This enforces the correct workflow: Developer -> QA -> Reviewer -> Documentation -> COMPLETE
        if (
          args.agent !== 'Documentation Agent' &&
          args.agent !== 'Documentation'
        ) {
          throw new Error(
            `Only the Documentation Agent can mark work packages as COMPLETE. You are: ${args.agent}\n\n` +
              `Workflow reminder:\n` +
              `  1. Developer Agent: Completes implementation pipeline, leaves WP as IN_PROGRESS\n` +
              `  2. QA Agent: Completes qa pipeline, leaves WP as IN_PROGRESS\n` +
              `  3. Reviewer Agent: Completes code-review pipeline, leaves WP as IN_PROGRESS\n` +
              `  4. Documentation Agent: Completes documentation pipeline, marks WP as COMPLETE\n\n` +
              `If you've completed your pipeline, leave the work package as IN_PROGRESS and call ledger_get_handoff_status to determine the next agent.`
          );
        }
      }

      // 3. Special validation for COMPLETE: check acceptance criteria
      if (newStatus === 'COMPLETE') {
        const completeCheck = canCompleteWorkPackage(wp);
        if (!completeCheck.allowed) {
          throw new Error(
            `Cannot mark work package as COMPLETE: the following acceptance criteria are not met:\n${completeCheck.unmet?.map((c) => `  - ${c}`).join('\n')}\n\nTo update acceptance criteria:\n1. Complete your pipeline using ledger_complete_pipeline\n2. Include the acceptance_criteria_updates parameter with the criteria you've met\n3. Then mark the work package as COMPLETE`
          );
        }
      }

      // 4. Special validation for BLOCKED
      if (newStatus === 'BLOCKED' && !args.blocked_by) {
        throw new Error(
          'Cannot transition to BLOCKED status without providing blocked_by information'
        );
      }

      // 5. Update work package status
      wp.status = newStatus;

      // 6. Handle BLOCKED -> IN_PROGRESS (clear blocker)
      if (oldStatus === 'BLOCKED' && newStatus === 'IN_PROGRESS') {
        delete wp.blocked_by;
      }

      // 7. Handle BLOCKED status (set blocker)
      if (newStatus === 'BLOCKED' && args.blocked_by) {
        wp.blocked_by = args.blocked_by as Blocker;
      }

      // 8. Handle COMPLETE -> IN_PROGRESS (increment revision)
      if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
        wp.revision += 1;
      }

      // 9. Update root index summary
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = newStatus;
      }

      // 10. Update pending_work_packages counter
      // Decrement when transitioning to COMPLETE
      if (oldStatus !== 'COMPLETE' && newStatus === 'COMPLETE') {
        root.pending_work_packages -= 1;
      }
      // Increment when transitioning from COMPLETE to something else
      if (oldStatus === 'COMPLETE' && newStatus !== 'COMPLETE') {
        root.pending_work_packages += 1;
      }

      root.last_updated = now();

      return { wp, root };
    });

    // Return updated work package
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedWp, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating work package status: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Helper function to describe legal transitions from a given status
 */
function getLegalTransitions(status: string): string {
  switch (status) {
    case 'READY':
      return 'IN_PROGRESS, BLOCKED';
    case 'IN_PROGRESS':
      return 'COMPLETE, BLOCKED';
    case 'BLOCKED':
      return 'IN_PROGRESS';
    case 'COMPLETE':
      return 'IN_PROGRESS';
    default:
      return 'none';
  }
}

/**
 * Register work package tools on the MCP server
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_work_package',
    {
      description: 'Read the full detail for a specific work package',
      inputSchema: GetWorkPackageSchema.passthrough(),
    },
    getWorkPackage as any
  );

  server.registerTool(
    'ledger_list_work_packages',
    {
      description: 'List work package summaries with optional filters',
      inputSchema: ListWorkPackagesSchema.passthrough(),
    },
    listWorkPackages as any
  );

  server.registerTool(
    'ledger_create_work_package',
    {
      description: 'Create a new work package with auto-generated WP ID. REQUIRED params: project_path, assigned_to, dependencies (use [] if none), acceptance_criteria, work_package_file. Creates both detail file and root index summary atomically.',
      inputSchema: CreateWorkPackageSchema.passthrough(),
    },
    createWorkPackage as any
  );

  server.registerTool(
    'ledger_claim_work_package',
    {
      description: 'Claim a READY work package by transitioning to IN_PROGRESS. REQUIRED params: project_path, work_package_id, agent. Validates that all dependencies are COMPLETE before allowing the claim.',
      inputSchema: ClaimWorkPackageSchema.passthrough(),
    },
    claimWorkPackage as any
  );

  server.registerTool(
    'ledger_update_work_package_status',
    {
      description: 'Update work package status. REQUIRED params: project_path, work_package_id, status, agent. The "agent" param must be your agent name (e.g., "Developer", "Documentation"). Only the Documentation agent can set status to COMPLETE. If setting status to BLOCKED, also provide blocked_by.',
      inputSchema: UpdateWorkPackageStatusSchema.passthrough(),
    },
    updateWorkPackageStatus as any
  );
}
