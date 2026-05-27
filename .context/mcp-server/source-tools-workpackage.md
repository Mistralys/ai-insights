# MCP Server - Source (Tools: Work Package)
<INSTRUCTION>
# MCP Server - Source: Work Package & Begin-Work Tools
TypeScript source for work package management tools (create/update/complete WPs), begin_work, and agent observations.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── work-package.ts

```
###  Path: `/mcp-server/src/tools/work-package.ts`

```ts
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
  isTerminalStatus,
} from '../schema/validators.js';
import type { WorkPackageStatus } from '../schema/enums.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { AGENT_ROLES, ORCHESTRATING_ROLES } from '../utils/constants.js';
import {
  DEFAULT_PIPELINE_STAGES,
  PipelineTypeEnum,
  type PipelineType,
  validateActiveStages,
} from '../utils/pipeline-maps.js';
import { clearSynthesisState } from '../utils/workflow-helpers.js';

/**
 * Extracts the ledger root string from an unknown parameter value.
 * Guards against the MCP SDK injecting a RequestHandlerExtra object as the
 * second positional argument to handler functions (see constraint 58).
 *
 * @param val - The raw value passed as `_ledgerRoot` by the MCP SDK or a test
 * @returns The string value if `val` is a string, otherwise `undefined`
 */
function extractLedgerRoot(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/**
 * Build a next-step guidance string after a WP status transition.
 *
 * Provides explicit routing so agents never have to guess what comes next.
 * This is a key self-healing measure: the tool response itself tells the agent
 * the correct next action, preventing silent workflow stalls.
 */
function buildStatusTransitionGuidance(
  wpId: string,
  newStatus: string,
  agent: string,
): string {
  switch (newStatus) {
    case 'BLOCKED':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now BLOCKED. ` +
        `Call ledger_get_handoff_status to confirm your handoff. ` +
        `The Developer will see this WP via ledger_get_next_action and rework the implementation to resolve the blocker.`
      );
    case 'COMPLETE':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now COMPLETE. Dependent work packages have been auto-unblocked if eligible. ` +
        `Call ledger_get_handoff_status to confirm handoff and check if more WPs need your attention.`
      );
    case 'IN_PROGRESS':
      return (
        `\n\n--- NEXT STEP ---\n` +
        `${wpId} is now IN_PROGRESS. ` +
        `Start your pipeline using ledger_start_pipeline, then complete it with ledger_complete_pipeline when done.`
      );
    default:
      return '';
  }
}

/**
 * @internal — exported for unit testing only
 */
export const _internal = {
  buildStatusTransitionGuidance,
  propagateDependencyUnblock,
  propagateDependencyReblock,
  createWorkPackage,
  updateWorkPackageStatus,
  claimWorkPackage,
  resetReworkCount,
  updateAcceptanceCriteria,
};

/**
 * Tool: get_work_package
 *
 * Reads and returns the full work package detail for a given WP ID.
 */
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
});

async function getWorkPackage(args: z.infer<typeof GetWorkPackageSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

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
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED'])
    .optional()
    .describe('Optional filter by work package status'),
  assigned_to: z.string().optional().describe('Optional filter by assigned agent name'),
});

async function listWorkPackages(args: z.infer<typeof ListWorkPackagesSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

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
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  assigned_to: z
    .string()
    .describe('Agent name assigned to this work package (e.g., "Developer")'),
  dependencies: z
    .array(z.string().regex(/^WP-\d{3,}$/))
    .describe('Array of WP IDs this depends on (e.g., ["WP-001"]). Use [] for no dependencies.'),
  acceptance_criteria: z
    .array(z.string())
    .min(1, 'At least one acceptance criterion is required')
    .describe('Array of acceptance criteria strings (e.g., ["All tests pass", "No lint errors"])'),
  work_package_file: z
    .string()
    .describe('Relative path to the work package spec file (e.g., "work/WP-001.md")'),
  active_pipeline_stages: z
    .array(z.string())
    .optional()
    .describe(
      'Optional pipeline stages for this WP. When omitted, defaults to the 4-stage legacy pipeline ' +
      '(implementation → qa → code-review → documentation). ' +
      'Must be a non-empty subsequence of the canonical ordering: ' +
      'implementation → qa → security-audit → code-review → release-engineering → documentation. ' +
      'All entries must be valid pipeline types from PIPELINE_TYPES. No duplicates allowed.'
    ),
});

/**
 * Cycle detection helper for createWorkPackage (§15.2).
 *
 * Performs a BFS over the existing WP graph to check whether adding an edge
 * from `newId` → `deps` would introduce a cycle. The new WP's own ID is
 * passed as `newId`; if it appears anywhere in the transitive dependency
 * closure of `deps` the result is `true` (cycle detected).
 */
function hasCycle(newId: string, deps: string[], allWps: WorkPackageSummary[]): boolean {
  const visited = new Set<string>();
  const queue = [...deps];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const wp = allWps.find((w) => w.work_package_id === current);
    if (wp) queue.push(...wp.dependencies);
  }
  return false;
}

async function createWorkPackage(
  args: z.infer<typeof CreateWorkPackageSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  let createdWpId = '';
  const pipelineStageWarnings: string[] = [];

  try {
    // Use createWorkPackageWithSync to atomically create WP detail + root index
    // with guaranteed last_updated stamp, schema validation, and .meta.json sync.
    createdWpId = await store.createWorkPackageWithSync((rootIndex) => {
      // 2. Generate next WP ID using max-based approach (resilient to gaps/deletions)
      const existingNumbers = rootIndex.work_packages.map((wp) =>
        parseInt(wp.work_package_id.replace('WP-', ''), 10)
      );
      const nextWpNumber =
        existingNumbers.length > 0 ? existingNumbers.reduce((max, n) => Math.max(max, n), 0) + 1 : 1;
      const wpId = formatWpId(nextWpNumber);

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

      // 3b. Cycle detection (§15.2)
      if (hasCycle(wpId, args.dependencies, rootIndex.work_packages)) {
        throw new Error(
          `Dependency cycle detected: WP ${wpId} would create a circular dependency.`
        );
      }

      // 4. Determine initial status
      let initialStatus: 'READY' | 'BLOCKED' = 'READY';
      let unmetDeps: string[] = [];
      if (args.dependencies.length > 0) {
        const depCheck = canStartWorkPackage(
          { dependencies: args.dependencies } as WorkPackageSummary,
          rootIndex.work_packages
        );
        if (!depCheck.allowed) {
          initialStatus = 'BLOCKED';
          unmetDeps = args.dependencies.filter(
            (depId) =>
              !rootIndex.work_packages.some(
                (w) => w.work_package_id === depId && w.status === 'COMPLETE'
              )
          );
        }
      }

      // 5. Validate acceptance criteria — reject empty or whitespace-only strings
      for (let i = 0; i < args.acceptance_criteria.length; i++) {
        if (!args.acceptance_criteria[i]!.trim()) {
          throw new Error(`acceptance_criteria[${i}] is empty or whitespace-only.`);
        }
      }

      // 5.5. Validate + resolve active_pipeline_stages
      if (args.active_pipeline_stages !== undefined) {
        const { errors, warnings } = validateActiveStages(args.active_pipeline_stages);
        if (errors.length > 0) {
          throw new Error(errors[0]!);
        }
        pipelineStageWarnings.push(...warnings);
      }

      // 6. Create acceptance criteria objects
      const acceptanceCriteria: AcceptanceCriterion[] =
        args.acceptance_criteria.map((criterion) => ({
          criterion,
          met: false,
        }));

      // 7. Create work package detail
      // Note: assigned_to is initially null regardless of input (§9b.1 soft-deprecation).
      // The assigned_to input field is accepted silently but ignored at creation time.
      // The WP will be assigned when an agent claims it via ledger_claim_work_package.
      //
      // Resolve active_pipeline_stages: validated stages if provided, otherwise the
      // backward-compatible default (4-stage legacy pipeline).
      const resolvedActiveStages: PipelineType[] =
        args.active_pipeline_stages !== undefined && args.active_pipeline_stages.length > 0
          ? (args.active_pipeline_stages as PipelineType[])
          : [...DEFAULT_PIPELINE_STAGES];

      const wpDetail: WorkPackageDetail = {
        work_package_id: wpId,
        work_package_file: args.work_package_file,
        status: initialStatus,
        assigned_to: null,
        dependencies: args.dependencies,
        acceptance_criteria: acceptanceCriteria,
        active_pipeline_stages: resolvedActiveStages,
        revision: 0,
        pipelines: [],
        // Note: last_updated is intentionally omitted here — createWorkPackageWithSync
        // auto-stamps it after the callback returns, matching updateWorkPackageWithSync.
      };

      // Set blocked_by when initial status is BLOCKED (§9b.1)
      if (initialStatus === 'BLOCKED') {
        wpDetail.blocked_by = {
          type: 'dependency',
          description: 'Created BLOCKED: one or more dependencies not yet COMPLETE',
          blocking_work_package: unmetDeps[0],
        };
      }

      // 8. Create work package summary
      // assigned_to mirrors the detail: null at creation time.
      const wpSummary: WorkPackageSummary = {
        work_package_id: wpId,
        status: initialStatus,
        assigned_to: null,
        dependencies: args.dependencies,
        file: `ledger/${wpId}.json`,
        active_pipeline_stages: resolvedActiveStages,
      };

      // 9. Update root index
      rootIndex.work_packages.push(wpSummary);
      rootIndex.total_work_packages += 1;
      rootIndex.pending_work_packages += 1;
      rootIndex.last_updated = now();

      // Set project status to IN_PROGRESS if currently READY
      if (rootIndex.status === 'READY') {
        rootIndex.status = 'IN_PROGRESS';
      }

      // Reset synthesis_generated flag if a new WP is added to a COMPLETE project
      // or if the flag is stale (§9b.1 defense-in-depth). Self-healing rules also
      // correct this on read, but an inline reset prevents the window entirely.
      if (rootIndex.status === 'COMPLETE' || rootIndex.synthesis_generated) {
        clearSynthesisState(rootIndex);
      }

      return { wpId, wp: wpDetail, root: rootIndex };
    });

    // 11. Read back the created work package to return it
    const createdWp = await store.readWorkPackage(createdWpId);

    // Include soft pipeline-stage warnings in the response if any were emitted
    const warningText =
      pipelineStageWarnings.length > 0 ? '\n\n' + pipelineStageWarnings.join('\n') : '';

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(createdWp, null, 2) + warningText,
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
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID to claim, format: WP-001, WP-002, etc.'),
  agent: z.string().describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation")'),
  override: z
    .boolean()
    .optional()
    .describe('Set to true to claim a WP assigned to a different agent. Without this flag, claiming a WP assigned to another agent will be rejected.'),
});

// Roles permitted to claim work packages via ledger_claim_work_package.
// Planner, Synthesis, and other orchestrating roles operate outside the
// dev-loop and must not directly claim implementation work.
export const CLAIMABLE_ROLES: string[] = [
  ...AGENT_ROLES.filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r)),
  ...AGENT_ROLES
    .filter((r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r))
    .map((r) => `${r} Agent`),
];

async function claimWorkPackage(
  args: z.infer<typeof ClaimWorkPackageSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Validate current status is READY
      if (wp.status !== 'READY') {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: current status is ${wp.status}. Only READY work packages can be claimed.`
        );
      }

      // 1b. Role guard: reject non-claimable agent roles (fires unconditionally, before assignment/override checks)
      if (!CLAIMABLE_ROLES.includes(args.agent)) {
        throw new Error(
          `Agent role '${args.agent}' cannot claim work packages. ` +
          `Valid roles: ${CLAIMABLE_ROLES.filter(r => !r.includes('Agent')).join(', ')}.`
        );
      }

      // 2. Assignment guard: reject cross-agent claims unless override is set
      if (
        wp.assigned_to &&
        wp.assigned_to !== args.agent &&
        !args.override
      ) {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: it is assigned to "${wp.assigned_to}" but you are "${args.agent}".\n\n` +
          `If you need to re-assign this WP, pass override: true. ` +
          `Otherwise, only claim work packages assigned to your role.`
        );
      }

      // 2b. Override authorization: only PM or current assignee may bypass the assignment check
      if (
        args.override &&
        wp.assigned_to &&
        args.agent !== 'Project Manager' &&
        args.agent !== wp.assigned_to
      ) {
        throw new Error(
          `Cannot override claim on work package ${args.work_package_id}: ` +
          `override is restricted to "Project Manager" or the current assignee ` +
          `("${wp.assigned_to}"). You are "${args.agent}".`
        );
      }

      // 3. Check dependencies
      const depCheck = canStartWorkPackage(wp, root.work_packages);
      if (!depCheck.allowed) {
        throw new Error(
          `Cannot claim work package ${args.work_package_id}: ${depCheck.reason}`
        );
      }

      // 4. Validate status transition (should always be valid at this point)
      if (!isValidStatusTransition(wp.status, 'IN_PROGRESS')) {
        throw new Error(
          `Invalid status transition: ${wp.status} -> IN_PROGRESS`
        );
      }

      // 5. Update work package
      wp.status = 'IN_PROGRESS';
      wp.status_changed_at = now();
      wp.assigned_to = args.agent;

      // 6. Update root index summary
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
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID to update, format: WP-001, WP-002, etc.'),
  status: z
    .enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED'])
    .describe('New status. Legal transitions: READY→IN_PROGRESS, READY→BLOCKED, READY→CANCELLED, IN_PROGRESS→COMPLETE, IN_PROGRESS→BLOCKED, IN_PROGRESS→CANCELLED, IN_PROGRESS→READY, BLOCKED→IN_PROGRESS, BLOCKED→READY, BLOCKED→CANCELLED, COMPLETE→IN_PROGRESS, COMPLETE→CANCELLED. CANCELLED is terminal (PM-only). BLOCKED→BLOCKED is also valid and replaces the existing blocker details.'),
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

/**
 * Auto-cancels all IN_PROGRESS pipelines on a work package with a given reason.
 * Used when a WP transitions to BLOCKED or CANCELLED while pipelines are running.
 */
function autoCancelActivePipelines(wp: WorkPackageDetail, reason: string): void {
  const inProgressPipelines = wp.pipelines.filter((p) => p.status === 'IN_PROGRESS');
  for (const p of inProgressPipelines) {
    p.status = 'FAIL';
    p.completed_at = now();
    p.auto_cancelled = true;
    p.summary = [reason];
  }
}

async function updateWorkPackageStatus(
  args: z.infer<typeof UpdateWorkPackageStatusSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let oldStatus: WorkPackageStatus | undefined;
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      oldStatus = wp.status;
      const newStatus = args.status;

      // 1. Validate status transition
      if (!isValidStatusTransition(oldStatus, newStatus)) {
        throw new Error(
          `Invalid status transition: ${oldStatus} -> ${newStatus}. Legal transitions from ${oldStatus}: ${getLegalTransitions(oldStatus)}`
        );
      }

      // 1a. BLOCKED → BLOCKED: blocker replacement (§21.17)
      // This is a special same-status branch that replaces the blocker metadata.
      // It returns immediately without going through the general mutation path.
      if (oldStatus === 'BLOCKED' && newStatus === 'BLOCKED') {
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed = pmAgents.includes(args.agent) || args.agent === wp.assigned_to;
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to}") may replace a blocker on work package ${args.work_package_id}. You are: ${args.agent}`
          );
        }
        if (!args.blocked_by) {
          throw new Error('Cannot replace blocker: blocked_by is required when transitioning BLOCKED → BLOCKED');
        }
        // Cannot replace a dependency blocker with a non-dependency blocker.
        // Dependency blockers must be resolved by completing the blocking work package.
        if (wp.blocked_by?.type === 'dependency' && args.blocked_by.type !== 'dependency') {
          throw new Error(
            `Cannot replace a 'dependency' blocker with a '${args.blocked_by.type}' blocker. ` +
            `Dependency blockers can only be resolved by completing the blocking work package.`
          );
        }
        wp.blocked_by = args.blocked_by as Blocker;
        wp.status_changed_at = now();
        root.last_updated = now();
        return { wp, root };
      }

      // 1b. READY → IN_PROGRESS redirect (§10b.2)
      // This transition is reserved for ledger_claim_work_package which validates
      // dependencies and handles proper agent assignment.
      if (oldStatus === 'READY' && newStatus === 'IN_PROGRESS') {
        throw new Error(
          `Cannot transition ${args.work_package_id} from READY to IN_PROGRESS via ledger_update_work_package_status. ` +
          `Use ledger_claim_work_package instead — it validates dependencies and handles the assignment.`
        );
      }

      // 1c. BLOCKED → IN_PROGRESS: agent guard (§6.5, §21.21)
      // Only PM or the current assignee may manually unblock a work package.
      // The system auto-unblock path (propagateDependencyUnblock) transitions to READY
      // directly on the WP detail and does not pass through this guard.
      if (oldStatus === 'BLOCKED' && newStatus === 'IN_PROGRESS') {
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed =
          pmAgents.includes(args.agent) ||
          (wp.assigned_to !== null && args.agent === wp.assigned_to);
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to ?? 'none'}") may unblock work package ${
              args.work_package_id
            } (BLOCKED → IN_PROGRESS). You are: ${args.agent}`
          );
        }
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

      // 2b. Validate agent permissions for CANCELLED status
      if (newStatus === 'CANCELLED') {
        const allowedCancelAgents = [
          'Project Manager',
          'Project Manager Agent',
        ];
        if (!allowedCancelAgents.includes(args.agent)) {
          throw new Error(
            `Only the Project Manager can cancel work packages. You are: ${args.agent}\n\n` +
              `If you believe this work package should be cancelled, hand off to the Project Manager.`
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

      // 5. Agent guard for COMPLETE -> IN_PROGRESS (validated before status mutation so the
      //    WP is never partially mutated when the guard rejects the transition)
      if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
        const allowedReopenAgents = [
          'Project Manager',
          'Project Manager Agent',
          'Documentation',
          'Documentation Agent',
        ];
        if (!allowedReopenAgents.includes(args.agent)) {
          throw new Error(
            `Only the Project Manager or Documentation agent may reopen a COMPLETE work package (COMPLETE → IN_PROGRESS). You are: ${args.agent}\n\n` +
              `If you believe this work package needs rework, hand off to the Project Manager or Documentation agent so they can formally reopen it.`
          );
        }
      }

      // 5a. IN_PROGRESS → READY: guard (§21.13)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'READY') {
        // Reject if any pipeline is IN_PROGRESS
        const activePipeline = wp.pipelines.find((p) => p.status === 'IN_PROGRESS');
        if (activePipeline) {
          throw new Error(
            `Cannot unclaim work package ${args.work_package_id}: cancel all IN_PROGRESS pipelines before unclaiming.`
          );
        }
        // Reject if the agent is not PM or the current assignee
        const pmAgents = ['Project Manager', 'Project Manager Agent'];
        const isAllowed =
          pmAgents.includes(args.agent) ||
          (wp.assigned_to !== null && args.agent === wp.assigned_to);
        if (!isAllowed) {
          throw new Error(
            `Only the Project Manager or the current assignee ("${wp.assigned_to ?? 'none'}") may unclaim work package ${
              args.work_package_id
            } (IN_PROGRESS → READY). You are: ${args.agent}`
          );
        }
      }

      // 5b. → COMPLETE freshness check (§21.10)
      // The most recent non-auto-cancelled doc PASS must post-date the most recent
      // non-auto-cancelled implementation pipeline start. Absent timestamps are permissive.
      if (newStatus === 'COMPLETE') {
        const docPassPipeline = [...wp.pipelines]
          .reverse()
          .find((p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled);
        const implStartPipeline = [...wp.pipelines]
          .reverse()
          .find((p) => p.type === 'implementation' && !p.auto_cancelled);
        if (
          docPassPipeline?.completed_at &&
          implStartPipeline?.started_at &&
          docPassPipeline.completed_at < implStartPipeline.started_at
        ) {
          throw new Error(
            `Cannot mark work package ${args.work_package_id} as COMPLETE: ` +
            `the documentation pipeline PASS (${docPassPipeline.completed_at}) ` +
            `pre-dates the most recent implementation pipeline start (${implStartPipeline.started_at}). ` +
            `The documentation pipeline must be re-run after the latest implementation.`
          );
        }
      }

      // 6. Update work package status
      wp.status = newStatus;
      wp.status_changed_at = now();

      // 7. Handle any exit from BLOCKED (clear blocker)
      // Covers both BLOCKED -> IN_PROGRESS and BLOCKED -> READY so the field is
      // never left stale regardless of which unblock path is taken.
      if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') {
        delete wp.blocked_by;
      }

      // 8. Handle BLOCKED status (set blocker)
      if (newStatus === 'BLOCKED' && args.blocked_by) {
        wp.blocked_by = args.blocked_by as Blocker;
      }

      // 8a. IN_PROGRESS → BLOCKED: auto-cancel IN_PROGRESS pipelines (§10b.1, §21.27)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'BLOCKED') {
        autoCancelActivePipelines(wp, 'Auto-cancelled: WP transitioned IN_PROGRESS → BLOCKED');
      }

      // 8b. IN_PROGRESS → CANCELLED: auto-cancel IN_PROGRESS pipelines (§21.14b)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'CANCELLED') {
        autoCancelActivePipelines(wp, 'Auto-cancelled: WP transitioned IN_PROGRESS → CANCELLED');
      }

      // 8c. IN_PROGRESS → READY: clear assignment (unclaim path, §21.13)
      if (oldStatus === 'IN_PROGRESS' && newStatus === 'READY') {
        wp.assigned_to = null;
        const readySummary = root.work_packages.find(
          (s) => s.work_package_id === args.work_package_id
        );
        if (readySummary) {
          readySummary.assigned_to = null;
        }
      }

      // 9. Handle COMPLETE -> IN_PROGRESS (increment revision, reset rework budget, invalidate synthesis)
      if (oldStatus === 'COMPLETE' && newStatus === 'IN_PROGRESS') {
        wp.revision += 1;
        wp.rework_counts = undefined; // Reset per-pipeline rework budget (§21.44)
        clearSynthesisState(root); // Invalidate synthesis (§21.26)
      }

      // 10. Update root index summary
      const summary = root.work_packages.find(
        (s) => s.work_package_id === args.work_package_id
      );
      if (summary) {
        summary.status = newStatus;
      }

      // 11. Update pending_work_packages counter
      // Decrement when transitioning to COMPLETE or CANCELLED (both are terminal)
      if (!isTerminalStatus(oldStatus!) && isTerminalStatus(newStatus)) {
        root.pending_work_packages -= 1;
      }
      // Increment when transitioning from COMPLETE to a non-terminal status (reopen)
      // CANCELLED is also terminal — do not increment when COMPLETE → CANCELLED
      if (oldStatus === 'COMPLETE' && !isTerminalStatus(newStatus)) {
        root.pending_work_packages += 1;
      }

      root.last_updated = now();

      return { wp, root };
    });

    // If the WP was transitioned to COMPLETE, propagate unblocking to dependent WPs.
    //
    // DESIGN NOTE: propagateDependencyUnblock acquires its own lock separately
    // from the updateWorkPackageWithSync lock above. This is intentional:
    // - The first lock (updateWorkPackageWithSync) covers the WP status transition
    // - The second lock (inside propagateDependencyUnblock) covers the cascade unblock
    // - Keeping them as two sequential locks avoids holding a lock during the
    //   potentially slow cascade read of multiple WP detail files
    // - The gap between locks is safe because propagateDependencyUnblock is
    //   idempotent: re-running it on an already-unblocked WP is a no-op
    if (isTerminalStatus(args.status)) {
      await propagateDependencyUnblock(projectPath, args.work_package_id, { store });
    }

    // If the WP was reopened from COMPLETE, cascade-block dependents that are
    // READY or IN_PROGRESS (they may be operating on stale assumptions).
    if (oldStatus === 'COMPLETE' && args.status === 'IN_PROGRESS') {
      await propagateDependencyReblock(projectPath, args.work_package_id, { store });
    }

    // Return updated work package with next-step guidance
    const updatedWp = await store.readWorkPackage(args.work_package_id);
    const guidance = buildStatusTransitionGuidance(
      args.work_package_id,
      args.status,
      args.agent,
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedWp, null, 2) + guidance,
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
 * Resolve a LedgerStore from an overloaded parameter.
 *
 * Accepts either a raw project root string, a pre-constructed store object,
 * or undefined (in which case a store is created from `projectPath` alone).
 */
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore {
  return typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null
    ? ledgerRootOrOpts.store
    : new LedgerStore(projectPath, typeof ledgerRootOrOpts === 'string' ? ledgerRootOrOpts : undefined);
}

/**
 * Helper: Propagate dependency unblocking after a work package transitions to COMPLETE.
 *
 * For all BLOCKED WPs that depend on the just-completed WP, checks whether ALL of
 * their dependencies are now COMPLETE. If so, transitions them to READY and clears
 * the blocked_by field.
 */
export async function propagateDependencyUnblock(
  projectPath: string,
  completedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void> {
  const store = resolveStore(projectPath, ledgerRootOrOpts);

  // Pre-check: skip the lock, disk read, and meta sync entirely when there are
  // no BLOCKED WPs that depend on the completed WP. The batch method will
  // re-read inside its lock for the actual operation, so this is safe — the
  // worst case is a race where a WP becomes BLOCKED between this read and the
  // batch call, which would be caught on the next status transition.
  const preCheckRoot = await store.readRootIndex();
  const hasCandidates = preCheckRoot.work_packages.some(
    (wp) => wp.status === 'BLOCKED' && wp.dependencies.includes(completedWpId)
  );
  if (!hasCandidates) return;

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const updatedWps = new Map<string, WorkPackageDetail>();

    // Find BLOCKED WPs whose dependency list includes the just-completed WP
    const candidates = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED' && wp.dependencies.includes(completedWpId)
    );

    for (const candidate of candidates) {
      // Read full WP detail to check all dependencies
      const wpDetail = await readWp(candidate.work_package_id);

      // Check if all dependencies are now COMPLETE
      const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
      if (!canStart.allowed) continue;

      // Skip WPs that are blocked for non-dependency reasons (e.g., external, decision, technical)
      if (wpDetail.blocked_by && wpDetail.blocked_by.type !== 'dependency') {
        continue;
      }

      // Transition BLOCKED -> READY and clear blocked_by
      wpDetail.status = 'READY';
      wpDetail.status_changed_at = now();
      delete wpDetail.blocked_by;

      // Update root summary
      const summary = rootIndex.work_packages.find(
        (s) => s.work_package_id === candidate.work_package_id
      );
      if (summary) {
        summary.status = 'READY';
      }

      updatedWps.set(candidate.work_package_id, wpDetail);
    }

    rootIndex.last_updated = now();
    return { updatedWps, root: rootIndex };
  });
}

/**
 * Helper: Propagate dependency re-blocking when a COMPLETE work package is reopened.
 *
 * For all non-COMPLETE WPs that depend on the reopened WP, if their status is
 * READY or IN_PROGRESS, transition them to BLOCKED with an appropriate blocked_by
 * reason. COMPLETE dependents are left unchanged — they may have been independently
 * finished and their pipelines remain valid.
 *
 * NOTE: When auto-cancelling IN_PROGRESS pipelines (Phase 1), the entire
 * `summary` array is replaced. Any partial progress notes recorded via
 * ledger_update_pipeline_progress are intentionally discarded — the work
 * is considered void and must restart on re-claim.
 */
async function propagateDependencyReblock(
  projectPath: string,
  reopenedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void> {
  const store = resolveStore(projectPath, ledgerRootOrOpts);

  // Pre-check: skip the lock, disk read, and meta sync entirely when there are
  // no WPs that depend on the reopened WP and would require any action — either
  // re-blocking (READY/IN_PROGRESS candidates) or a warning annotation (COMPLETE
  // dependents). BLOCKED and CANCELLED dependents are untouched by both loops, so
  // they do not qualify. The batch method will re-read inside its lock for the
  // actual operation, so this is safe — the worst case is a race where a WP
  // becomes READY/IN_PROGRESS between this read and the batch call, which would
  // be caught on the next status transition.
  const preCheckRoot = await store.readRootIndex();
  const ACTION_STATUSES = new Set(['READY', 'IN_PROGRESS', 'COMPLETE']);
  const hasCandidates = preCheckRoot.work_packages.some(
    (wp) =>
      ACTION_STATUSES.has(wp.status) && wp.dependencies.includes(reopenedWpId)
  );
  if (!hasCandidates) return;

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const updatedWps = new Map<string, WorkPackageDetail>();

    // Find non-terminal, non-BLOCKED WPs whose dependency list includes the reopened WP
    const candidates = rootIndex.work_packages.filter(
      (wp) =>
        !isTerminalStatus(wp.status) &&
        wp.status !== 'BLOCKED' &&
        wp.dependencies.includes(reopenedWpId)
    );

    for (const candidate of candidates) {
      const wpDetail = await readWp(candidate.work_package_id);

      // Transition READY/IN_PROGRESS -> BLOCKED
      wpDetail.status = 'BLOCKED';
      wpDetail.status_changed_at = now();
      wpDetail.blocked_by = {
        type: 'dependency',
        description: `Dependency ${reopenedWpId} was reopened`,
        blocking_work_package: reopenedWpId,
      };

      // Auto-cancel any IN_PROGRESS pipelines on the re-blocked WP (§15.5)
      autoCancelActivePipelines(wpDetail, `Auto-cancelled: dependency ${reopenedWpId} was reopened`);

      // Update root summary
      const summary = rootIndex.work_packages.find(
        (s) => s.work_package_id === candidate.work_package_id
      );
      if (summary) {
        summary.status = 'BLOCKED';
      }

      updatedWps.set(candidate.work_package_id, wpDetail);
    }

    // Warn COMPLETE dependents without changing their status (§15.5)
    const completeWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'COMPLETE' && wp.dependencies.includes(reopenedWpId)
    );
    for (const candidate of completeWps) {
      const wpDetail = await readWp(candidate.work_package_id);
      const lastPipeline = wpDetail.pipelines.at(-1);
      if (lastPipeline) {
        if (!lastPipeline.comments) lastPipeline.comments = [];
        lastPipeline.comments.push({
          type: 'warning',
          priority: 'medium',
          timestamp: now(),
          note:
            `Dependency ${reopenedWpId} was reopened. Review whether ` +
            `${candidate.work_package_id} needs to be revisited.`,
        });
        updatedWps.set(candidate.work_package_id, wpDetail);
      }
    }

    // Reset synthesis_generated when at least one WP was re-blocked (§21.26 crash-recovery safety net)
    if (candidates.length > 0) {
      clearSynthesisState(rootIndex);
    }

    // Recompute pending_work_packages
    rootIndex.pending_work_packages = rootIndex.work_packages.filter(
      (wp) => !isTerminalStatus(wp.status)
    ).length;
    rootIndex.last_updated = now();
    return { updatedWps, root: rootIndex };
  });
}

/**
 * Helper function to describe legal transitions from a given status
 */
function getLegalTransitions(status: string): string {
  switch (status) {
    case 'READY':
      return 'IN_PROGRESS, BLOCKED, CANCELLED';
    case 'IN_PROGRESS':
      return 'COMPLETE, BLOCKED, CANCELLED, READY';
    case 'BLOCKED':
      return 'IN_PROGRESS, READY, CANCELLED';
    case 'COMPLETE':
      return 'IN_PROGRESS, CANCELLED';
    case 'CANCELLED':
      return 'none (terminal)';
    default:
      return 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: reset_rework_count (§16.3b)
// ─────────────────────────────────────────────────────────────────────────────

const ResetReworkCountSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package'),
  pipeline_type: PipelineTypeEnum
    .describe('Which pipeline type rework count to reset'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  reason: z.string().trim().min(1).describe('Mandatory reason for the reset (audit trail)'),});

async function resetReworkCount(
  args: z.infer<typeof ResetReworkCountSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    // PM-only guard
    if (args.agent_role !== 'Project Manager') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ledger_reset_rework_count is a PM-only tool. You are: ${args.agent_role}`,
          },
        ],
        isError: true,
      };
    }

    // Reason guard — Zod .trim().min(1) already rejects empty/whitespace-only strings;
    // this branch remains unreachable but is kept as a belt-and-suspenders safety net.

    let noOp = false;
    let previousValue = 0;

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      const current = wp.rework_counts?.[args.pipeline_type] ?? 0;

      if (current === 0) {
        noOp = true;
        return { wp, root };
      }

      previousValue = current;

      // Reset the specific pipeline count to 0
      if (!wp.rework_counts) {
        wp.rework_counts = {};
      }
      wp.rework_counts[args.pipeline_type] = 0;

      // Record audit comment on root index
      root.project_comments.push({
        type: 'rework_reset',
        priority: 'high',
        timestamp: now(),
        agent: 'Project Manager',
        note: `Reset rework count for ${args.pipeline_type} on ${args.work_package_id} from ${previousValue} to 0. Reason: ${args.reason}`,
      });
      root.last_updated = now();

      return { wp, root };
    });

    if (noOp) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                message: 'No-op: rework count is already 0 or absent. No changes written.',
                work_package_id: args.work_package_id,
                pipeline_type: args.pipeline_type,
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
              message: `Rework count for ${args.pipeline_type} on ${args.work_package_id} reset from ${previousValue} to 0.`,
              work_package_id: args.work_package_id,
              pipeline_type: args.pipeline_type,
              previous_value: previousValue,
              reason: args.reason,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error resetting rework count: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: update_acceptance_criteria (§12.3b)
// ─────────────────────────────────────────────────────────────────────────────

const UpdateAcceptanceCriteriaSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('ID of the work package'),
  agent_role: z.string().describe('Must be "Project Manager"'),
  operations: z
    .array(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('remove'),
          criterion: z.string().describe('Exact text of the criterion to remove'),
        }),
        z.object({
          action: z.literal('modify_text'),
          old_criterion: z.string().describe('Exact text of the existing criterion'),
          new_criterion: z.string().trim().min(1).describe('New criterion text (must be non-empty)'),        }),
      ])
    )
    .min(1)
    .describe('List of operations to apply'),
});

async function updateAcceptanceCriteria(
  args: z.infer<typeof UpdateAcceptanceCriteriaSchema>,
  _ledgerRoot?: string
) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  // PM-only guard
  if (args.agent_role !== 'Project Manager') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ledger_update_acceptance_criteria is a PM-only tool. You are: ${args.agent_role}`,
        },
      ],
      isError: true,
    };
  }

  const ledgerRoot = extractLedgerRoot(_ledgerRoot);
  const store = new LedgerStore(projectPath, ledgerRoot);

  try {
    let appliedOps: string[] = [];

    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // CANCELLED guard
      if (wp.status === 'CANCELLED') {
        throw new Error(
          `Cannot update acceptance criteria on CANCELLED work package ${args.work_package_id}.`
        );
      }

      // Clone the criteria array before any mutation
      const updatedCriteria: AcceptanceCriterion[] = wp.acceptance_criteria.map((c) => ({ ...c }));

      // Apply operations sequentially
      for (const op of args.operations) {
        if (op.action === 'remove') {
          const idx = updatedCriteria.findIndex((c) => c.criterion === op.criterion);
          if (idx === -1) {
            throw new Error(
              `Criterion not found (remove): "${op.criterion}"`
            );
          }
          updatedCriteria.splice(idx, 1);
          appliedOps.push(`removed: "${op.criterion}"`);
        } else {
          // modify_text
          const idx = updatedCriteria.findIndex((c) => c.criterion === op.old_criterion);
          if (idx === -1) {
            throw new Error(
              `Criterion not found (modify_text): "${op.old_criterion}"`
            );
          }
          updatedCriteria[idx]!.criterion = op.new_criterion;
          // modify_text intentionally preserves the existing 'met' value — only the text changes, not the progress state.
          appliedOps.push(`modified: "${op.old_criterion}" → "${op.new_criterion}"`);
        }
      }

      // Post-operations: at-least-one-criterion guard
      if (updatedCriteria.length === 0) {
        throw new Error('At least one acceptance criterion is required. Cannot remove all criteria.');
      }

      wp.acceptance_criteria = updatedCriteria;
      root.last_updated = now();

      return { wp, root };
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              message: `Acceptance criteria updated on ${args.work_package_id}.`,
              applied_operations: appliedOps,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating acceptance criteria: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
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
      inputSchema: GetWorkPackageSchema,
    },
    getWorkPackage as any
  );

  server.registerTool(
    'ledger_list_work_packages',
    {
      description: 'List work package summaries with optional filters',
      inputSchema: ListWorkPackagesSchema,
    },
    listWorkPackages as any
  );

  server.registerTool(
    'ledger_create_work_package',
    {
      description: 'Create a new work package with auto-generated WP ID. REQUIRED params: assigned_to, dependencies (use [] if none), acceptance_criteria, work_package_file. Creates both detail file and root index summary atomically. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: CreateWorkPackageSchema,
    },
    (args) => createWorkPackage(args)
  );

  server.registerTool(
    'ledger_claim_work_package',
    {
      description: 'Claim a READY work package by transitioning to IN_PROGRESS. REQUIRED params: work_package_id, agent. Rejects claims when the WP is assigned to a different agent unless override: true is passed. Validates that all dependencies are COMPLETE before allowing the claim. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: ClaimWorkPackageSchema,
    },
    (args) => claimWorkPackage(args)
  );

  server.registerTool(
    'ledger_update_work_package_status',
    {
      description: 'Update work package status. REQUIRED params: work_package_id, status, agent. The "agent" param must be your agent name (e.g., "Developer", "Documentation"). Only the Documentation agent can set status to COMPLETE. If setting status to BLOCKED, also provide blocked_by. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: UpdateWorkPackageStatusSchema,
    },
    (args) => updateWorkPackageStatus(args)
  );

  server.registerTool(
    'ledger_reset_rework_count',
    {
      description: 'PM-only: resets the rework counter for a specific pipeline type on a work package back to 0. Records an audit comment. No-op if counter is already 0.',
      inputSchema: ResetReworkCountSchema,
    },
    (args) => resetReworkCount(args)
  );

  server.registerTool(
    'ledger_update_acceptance_criteria',
    {
      description: 'PM-only: remove or modify acceptance criteria text on a work package. Rejects operations that would leave zero criteria. Supported operations: remove (by exact text), modify_text (old → new).',
      inputSchema: UpdateAcceptanceCriteriaSchema,
    },
    (args) => updateAcceptanceCriteria(args)
  );
}

```
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── begin-work.ts

```
###  Path: `/mcp-server/src/tools/begin-work.ts`

```ts
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
    .describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z
    .string()
    .optional()
    .describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
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

      // Guard 2b: Pipeline type must be in the WP's active stages (§11.1).
      const activeStages: readonly PipelineType[] =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      if (!activeStages.includes(args.type as PipelineType)) {
        throw new Error(
          `Cannot start pipeline '${args.type}' for work package ${args.work_package_id}: ` +
          `this pipeline type is not in the WP's active stages. ` +
          `Active stages: ${(activeStages as readonly string[]).join(' \u2192 ')}.`
        );
      }

      // Guard 3: Pipeline ordering — prerequisite must be the most-recently PASS'd pipeline.
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

```
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── observations.ts

```
###  Path: `/mcp-server/src/tools/observations.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import { now } from '../utils/timestamp.js';
import { withLock } from '../storage/file-lock.js';
import type { PipelineComment, IncidentContext } from '../schema/work-package.js';
import type { ProjectComment } from '../schema/root-index.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { PipelineTypeEnum, describePipelineTypes } from '../utils/pipeline-maps.js';

/**
 * Tool: add_observation
 *
 * Adds a comment to the most recent pipeline of the specified type.
 * Comments do NOT include an agent field (agent is inferred from pipeline type).
 */
const AddObservationSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  work_package_id: z
    .string()
    .regex(/^WP-\d{3,}$/)
    .describe('Work package ID, format: WP-001, WP-002, etc.'),
  pipeline_type: PipelineTypeEnum.describe(describePipelineTypes('Pipeline type to add the observation to:')),
  type: z
    .string()
    .describe(
      'Observation category (e.g., "code-smell", "refactor", "improvement", "debt", "convention")'
    ),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority level: "low", "medium", or "high"'),
  note: z.string().describe('Detailed description of the observation'),
});

async function addObservation(args: z.infer<typeof AddObservationSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    await store.updateWorkPackageWithSync(args.work_package_id, (wp, root) => {
      // 1. Find most recent pipeline of given type (any status)
      const pipelineIndex = wp.pipelines
        .map((p, idx) => ({ pipeline: p, index: idx }))
        .reverse()
        .find((p) => p.pipeline.type === args.pipeline_type);

      if (!pipelineIndex) {
        throw new Error(
          `Cannot add observation: no pipeline of type "${args.pipeline_type}" found for work package ${args.work_package_id}.`
        );
      }

      const pipeline = pipelineIndex.pipeline;

      // 2. Create comment object (no agent field)
      const comment: PipelineComment = {
        type: args.type,
        priority: args.priority,
        timestamp: now(),
        note: args.note,
      };

      // 3. Initialize comments array if needed
      if (!pipeline.comments) {
        pipeline.comments = [];
      }

      // 4. Append comment
      pipeline.comments.push(comment);

      // 5. Update root index timestamp
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
          text: `Error adding observation: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool: add_project_comment
 *
 * Adds a comment to the project-level comments array in the root index.
 * For incident type comments, context is required.
 */
const AddProjectCommentSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  type: z.string().describe('Comment type: "incident", "note", or "decision"'),
  priority: z.enum(['low', 'medium', 'high']).describe('Priority level: "low", "medium", or "high"'),
  agent: z.string().describe('REQUIRED. Your agent name (e.g., "Developer", "QA", "Reviewer", "Documentation")'),
  note: z.string().describe('Detailed description of the comment'),
  context: z
    .object({
      os: z.string(),
      tool: z.string(),
      work_package: z.string().optional(),
      resolved: z.boolean(),
      workaround: z.string().optional(),
    })
    .passthrough()
    .optional()
    .describe('REQUIRED when type is "incident". Provide os, tool, resolved fields at minimum.'),
});

async function addProjectComment(args: z.infer<typeof AddProjectCommentSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    await withLock(store.storageDir, async () => {
      // 1. Validate context for incident type
      if (args.type === 'incident' && !args.context) {
        throw new Error(
          'Cannot add incident comment: context field is required for incident type comments.'
        );
      }

      // 2. Read root index
      const root = await store.readRootIndex();

      // 3. Create comment object
      const comment: ProjectComment = {
        type: args.type,
        priority: args.priority,
        timestamp: now(),
        agent: args.agent,
        note: args.note,
      };

      // 4. Add context if provided
      if (args.context) {
        comment.context = args.context as IncidentContext;
      }

      // 5. Append to project_comments
      root.project_comments.push(comment);

      // 6. Update timestamp
      root.last_updated = now();

      // 7. Write root index
      await store.writeRootIndex(root);
    });

    // Return updated root index
    const updatedRoot = await store.readRootIndex();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(updatedRoot, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error adding project comment: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Register observation tools on the MCP server
 */
/**
 * @internal — exported for unit testing only. Follows the `_internal` naming convention (§53).
 */
export const _internal = {
  AddObservationSchema,
  AddProjectCommentSchema,
};

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_add_observation',
    {
      description: 'Add an observation/comment to the most recent pipeline of the specified type. REQUIRED params: work_package_id, pipeline_type, type, priority, note. The pipeline must already exist (use ledger_start_pipeline first). Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: AddObservationSchema,
    },
    addObservation as any
  );

  server.registerTool(
    'ledger_add_project_comment',
    {
      description: 'Add a project-level comment. REQUIRED params: type, priority, agent, note. If type is "incident", the context param is also required (with os, tool, resolved fields). Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: AddProjectCommentSchema,
    },
    addProjectComment as any
  );
}

```