# MCP Server - Source (Tools: Workflow)
<INSTRUCTION>
# MCP Server - Source: Workflow & Handoff Tools
TypeScript source for workflow tools: get_next_action, handoff routing, next_action_batch, and workflow state queries.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── workflow.ts

```
###  Path: `/mcp-server/src/tools/workflow.ts`

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as nextActionModule from './workflow-next-action.js';
import * as handoffModule from './workflow-handoff.js';

// Re-export for backward compatibility with test namespace imports.
export * from '../utils/workflow-helpers.js';
export { getDeveloperAction } from './workflow-next-action.js';
export {
  nextAgentFromStatus,
  buildHandoffResponse,
  getDeveloperHandoff,
  getProjectManagerHandoff,
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
} from './workflow-handoff.js';

/**
 * Re-export pipeline maps for test access via namespace import.
 * @internal -- for unit testing only
 */
export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP, FAIL_ROUTING_MAP } from '../utils/pipeline-maps.js';

/**
 * Register all workflow tools on the MCP server.
 */
export function register(server: McpServer): void {
  nextActionModule.register(server);
  handoffModule.register(server);
}

```
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── workflow-handoff.ts

```
###  Path: `/mcp-server/src/tools/workflow-handoff.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { AGENT_ROLES, READY_STATUS_FOR_ROLE, HANDOFF_STATUS_ROLE, AGENT_NAMES, type AgentRole } from '../utils/constants.js';
import { isRegistryLoaded, getAgentHandle, getAgentId } from '../utils/agent-registry.js';
import { now } from '../utils/timestamp.js';
import {
  resolvePrerequisite,
  resolveNextAgent,
  DEFAULT_PIPELINE_STAGES,
  firstActiveStage,
  getOrderedActiveStages,
  PIPELINE_AGENT_MAP,
  AGENT_PIPELINE_MAP,
  scopeToStage,
  type PipelineType,
} from '../utils/pipeline-maps.js';
import {
  buildHandoffPrompt,
  isBlockedByDependencies,
  isMostRecentPipelineFail,
  latestNonCancelledPipeline,
  effectiveMaxDepth,
  hasDownstreamReengagedSince,
  hasNewUpstreamPassSince,
} from '../utils/workflow-helpers.js';
import { getConfig } from '../gui/config.js';
import { isTerminalStatus } from '../schema/validators.js';

/** Shared return type for all per-role handoff handlers. */
type HandoffResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Handler signature: (wpDetails, projectPath, store) → handoff result. */
type HandoffHandler = (
  wpDetails: WorkPackageDetail[],
  projectPath?: string,
  store?: LedgerStore,
) => Promise<HandoffResult>;

/**
 * Manifest-typed dispatch map from agent role → handoff handler.
 *
 * Keyed by `AgentRole` (derived from the shared workflow manifest) so that
 * TypeScript flags any mismatch when a role is added, removed, or renamed.
 * This replaces the two former switch statements in `getHandoffStatus()` and
 * `computeHandoffStatus()` with a single source of truth.
 */
const HANDOFF_DISPATCH: Record<AgentRole, HandoffHandler> = {
  'Planner':          getPlannerHandoff,
  'Project Manager':  getProjectManagerHandoff,
  'Developer':        getDeveloperHandoff,
  'QA':               getQaHandoff,
  'Security Auditor': getSecurityAuditorHandoff,
  'Reviewer':         getReviewerHandoff,
  'Release Engineer': getReleaseEngineerHandoff,
  'Documentation':    getDocumentationHandoff,
  'Synthesis':        (_, projectPath, store) =>
    buildHandoffResponse(
      'Synthesis',
      'COMPLETE',
      'Synthesis complete.',
      'Call ledger_get_next_action first to check if synthesis work is pending before generating your report.',
      projectPath,
      store,
    ),
};

/**
 * Tool: get_handoff_status
 *
 * Reads root index and examines all WP statuses and pipelines to compute
 * the correct AGENT: and STATUS: handoff block for the current agent.
 */
const GetHandoffStatusSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  current_agent: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"'
    ),
});

async function getHandoffStatus(args: z.infer<typeof GetHandoffStatusSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.current_agent as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.current_agent}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Check for BLOCKED work packages. Report BLOCKED whenever blocked WPs exist
    // and nothing is actionable (no READY or IN_PROGRESS WPs), regardless of
    // whether some WPs are already COMPLETE. A mixed BLOCKED + COMPLETE state
    // with no forward progress indicates a genuine stall that needs PM resolution.
    const blockedWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED'
    );
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );

    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0) {
      return buildHandoffResponse(
        args.current_agent,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        projectPath,
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

    // Agent-specific handoff logic (dispatch map is typed by AgentRole from the manifest)
    const handler = HANDOFF_DISPATCH[args.current_agent as AgentRole];
    if (handler) {
      return handler(wpDetails, projectPath, store);
    }
    return buildHandoffResponse(args.current_agent, 'IN_PROGRESS', 'Work in progress.', undefined, projectPath, store);
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
 * Derive the next agent from a handoff status.
 *
 * For READY_FOR_* statuses the next agent is the target role.
 * For IN_PROGRESS the caller continues (next === current).
 * For BLOCKED, the Project Manager triages.
 * For COMPLETE, no next agent is needed.
 */
export function nextAgentFromStatus(status: string, currentAgent: string): string | null {
  if (status === 'IN_PROGRESS') return currentAgent;
  if (isTerminalStatus(status)) return null;
  return HANDOFF_STATUS_ROLE[status] ?? null;
}

/** Build a standard handoff response payload with current_agent, next_agent, and status.
 *
 * When `projectPath` and `store` are provided, this function will also attempt to include
 * an `auto_handoff` object in the payload if all eligibility conditions are met:
 * - Registry is loaded (`isRegistryLoaded()` returns true)
 * - Next agent has a known VS Code handle
 * - Status is not COMPLETE, BLOCKED, or IN_PROGRESS
 * - `auto_handoff_depth` in the ledger is below `effectiveMaxDepth(total_work_packages)` (§18.2.1)
 *
 * The depth counter is reset to 0 only inside completeSynthesis (§18.4), not on individual WP completions.
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

  // Auto-handoff eligibility check.
  // NOTE: `status` here is the handoff status value (e.g., READY_FOR_DEVELOPER, READY_FOR_PM),
  // NOT the ProjectStatus (e.g., IN_PROGRESS). Auto-handoff triggers only for
  // READY_FOR_* statuses — non-READY_FOR_* values (COMPLETE, BLOCKED, IN_PROGRESS, WAIT)
  // are explicitly excluded by the conditions below.
  if (
    projectPath &&
    store &&
    status !== 'COMPLETE' &&
    status !== 'BLOCKED' &&
    status !== 'IN_PROGRESS' &&
    getConfig().auto_handoff_enabled &&
    isRegistryLoaded()
  ) {
    const agentName = nextAgent ? getAgentHandle(nextAgent) : null;
    if (agentName !== null) {
      try {
        const root = await store.readRootIndex();
        const currentDepth = root.auto_handoff_depth ?? 0;
        if (currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)) {
          await store.writeRootIndex({
            ...root,
            auto_handoff_depth: currentDepth + 1,
            last_updated: now(),
          });
          const agentId = nextAgent ? getAgentId(nextAgent) : null;
          const agentNames = nextAgent ? AGENT_NAMES[nextAgent as AgentRole] : null;
          payload.auto_handoff = {
            agent_name: agentName,
            ...(agentId !== null ? { agent_id: agentId } : {}),
            ...(agentNames ? {
              cc_agent_name: agentNames.claude_code.agent_name,
              vs_agent_name: agentNames.vscode.agent_name,
              da_agent_name: agentNames.deep_agents.agent_name,
            } : {}),
            prompt: buildHandoffPrompt(projectPath, agentId ?? undefined),
          };
        } else {
          // §18.5: Depth limit reached — surface reason in the response payload and emit a
          // project comment so the PM has a diagnostic breadcrumb in the ledger.
          payload.handoff_suppressed_reason = 'depth_limit_reached';
          const updated = { ...root, last_updated: now() };
          updated.project_comments = [
            ...root.project_comments,
            {
              type: 'warning',
              priority: 'high',
              timestamp: now(),
              agent: 'System',
              note: `Auto-handoff depth limit reached (depth ${currentDepth} / ceiling ${effectiveMaxDepth(root.total_work_packages ?? 0)}). Manual routing required.`,
            },
          ];
          await store.writeRootIndex(updated);
        }
      } catch (err) {
        process.stderr.write(`[buildHandoffResponse] storage error (auto-handoff depth update): ${String(err)}\n`);
      }
    }
  }

  // auto_handoff_depth is reset only in completeSynthesis (not on individual WP completions, per §18.4)

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
 * Get handoff status for Planner
 *
 * Planner has completed the project plan. If work packages exist and are
 * READY/IN_PROGRESS, hand off to Developer. Otherwise return WAIT.
 */
export async function getPlannerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  if (wpDetails.length === 0) {
    return buildHandoffResponse(
      'Planner',
      'READY_FOR_PM',
      'Planning complete. No work packages exist yet — ready for Project Manager to decompose the plan.',
      undefined,
      projectPath,
      store
    );
  }

  const readyOrInProgressWps = wpDetails.filter(
    (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
  );

  if (readyOrInProgressWps.length > 0) {
    return buildHandoffResponse(
      'Planner',
      'READY_FOR_DEVELOPER',
      `Planning complete. ${readyOrInProgressWps.length} work package(s) are READY or IN_PROGRESS for implementation.`,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Planner',
    'WAIT',
    'Planning complete. All work packages are either COMPLETE or BLOCKED. No further planner action needed.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Private helper: map an `assigned_to` value to the corresponding READY_FOR_* handoff status.
 * Used by getProjectManagerHandoff to route READY work packages to the correct agent.
 */
function readyStatusForAgent(assignedTo: string | null): string {
  return READY_STATUS_FOR_ROLE[assignedTo as AgentRole] ?? 'READY_FOR_DEVELOPER';
}

/**
 * Returns true if the WP has a PASS pipeline of the prerequisite stage for `currentStage`,
 * given its active_pipeline_stages. When the prerequisite resolves to null (currentStage
 * is the first active stage), the prerequisite is vacuously satisfied (returns true).
 *
 * Mirrors the `hasPassedEffectiveUpstream` pattern already used in getDocumentationHandoff.
 */
function hasPassedDynamicUpstream(
  wp: WorkPackageDetail,
  currentStage: PipelineType,
): boolean {
  const activeStages =
    (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
  const upstream = resolvePrerequisite(currentStage, activeStages);
  if (upstream === null) return true;
  return wp.pipelines.some((p) => p.type === upstream && p.status === 'PASS');
}

/**
 * Given a list of WPs that have PASSed `currentStage`, returns the WPs whose
 * resolved next stage has not yet started, partitioned into ready and dependency-blocked.
 * Also returns the canonical READY_FOR_* status to emit.
 *
 * Mixed-routing (multiple distinct next agents): `nextStatus` is set to the first
 * ready WP's READY_FOR_* status; remaining WPs are picked up via subsequent per-agent
 * handoff calls. Each agent's `get_next_action` is role-scoped, so dispatching the
 * first agent never misroutes the other WPs.
 *
 * Last-stage edge case: when `currentStage` is the last active stage for a WP,
 * `resolveNextAgent` returns 'Synthesis' and `AGENT_PIPELINE_MAP['Synthesis']`
 * is undefined (Synthesis owns no pipeline). Such WPs are skipped here — they
 * are handled by the all-terminal early exit once every WP reaches a terminal
 * status. Partial completion falls through to WAIT, which is the correct
 * spec-mandated behavior.
 */
function partitionWpsAwaitingNextStage(
  wpsPassedCurrent: WorkPackageDetail[],
  currentStage: PipelineType,
): {
  ready: WorkPackageDetail[];
  blocked: WorkPackageDetail[];
  nextStatus: string | null;
} {
  const awaiting = wpsPassedCurrent.filter((wp) => {
    const activeStages =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    const nextAgent = resolveNextAgent(currentStage, activeStages);
    const nextStage = AGENT_PIPELINE_MAP[nextAgent as AgentRole];
    // No next stage (currentStage is the last active stage) → routes to Synthesis,
    // handled separately by the all-terminal check.
    if (!nextStage) return false;
    // "Next stage not started" means no PASS pipeline exists for the next stage.
    // A FAIL pipeline means the next stage was attempted but hasn't succeeded —
    // the upstream agent (current caller) still needs to route there.
    return !wp.pipelines.some((p) => p.type === nextStage && p.status === 'PASS');
  });
  const ready = awaiting.filter((wp) => !isBlockedByDependencies(wp));
  const blocked = awaiting.filter((wp) => isBlockedByDependencies(wp));

  // Collect the set of distinct next agents across all ready WPs.
  const nextAgents = new Set(
    ready.map((wp) => {
      const activeStages =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      return resolveNextAgent(currentStage, activeStages);
    }),
  );

  // Emit the READY_FOR_* status for the first ready WP's next agent.
  // For mixed routing (multiple distinct next agents), remaining WPs are dispatched
  // via subsequent per-agent handoff calls — no WP is misrouted because get_next_action
  // is role-scoped and each agent only claims WPs relevant to their own role.
  const nextStatus =
    nextAgents.size > 0
      ? (READY_STATUS_FOR_ROLE[[...nextAgents][0] as AgentRole] ?? null)
      : null;

  return { ready, blocked, nextStatus };
}

// partitionWpsAwaitingNextStage is consumed by getReviewerHandoff, getQaHandoff, and
// getSecurityAuditorHandoff. hasPassedDynamicUpstream is consumed by getDocumentationHandoff.

/**
 * Cross-WP dispatch helper: routes to the agent owning the first active pipeline
 * stage of the first READY, non-dependency-blocked work package, or returns
 * `READY_FOR_SYNTHESIS` when all WPs are terminal.
 *
 * Called as the penultimate step (before the final WAIT return) in each of the
 * five non-PM handoff functions (QA, Security Auditor, Reviewer, Release Engineer,
 * Documentation) to prevent IDE workflow stalls when a non-PM agent's role-specific
 * work is done but other READY WPs have not yet started any pipelines.
 *
 * **Self-routing is intentional:** the helper does NOT filter cases where
 * `targetRole === currentRole`. Self-routing causes the IDE to visibly declare a
 * new handoff step, making it explicit that a fresh WP is being bootstrapped even
 * when the same agent continues. This improves auditability and keeps orchestrator
 * and IDE behaviors aligned.
 *
 * @param wpDetails  All WP detail objects for the project.
 * @param currentRole  The calling agent's role name (used in the reason string only,
 *   never as a filter). Pass this for diagnostic clarity even though the helper does
 *   not inspect it for routing decisions.
 * @returns A `{ status, reason }` object to pass directly to `buildHandoffResponse`,
 *   or `null` when no deterministic dispatch is possible (caller should fall through
 *   to `WAIT`).
 */
function findNextReadyDispatch(
  wpDetails: WorkPackageDetail[],
  currentRole: string,
): { status: string; reason: string } | null {
  // Step 1: Route to agent owning the first active pipeline stage of a READY,
  // non-dependency-blocked WP. First READY WP wins (consistent with PM Step 2).
  const readyWps = wpDetails.filter(
    (wp) => wp.status === 'READY' && !isBlockedByDependencies(wp)
  );
  if (readyWps.length > 0) {
    const wp = readyWps[0]!;
    const activeStages =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? null;
    const stage = firstActiveStage(activeStages);
    const targetRole = PIPELINE_AGENT_MAP[stage];
    const status = READY_STATUS_FOR_ROLE[targetRole as AgentRole] ?? 'READY_FOR_DEVELOPER';
    return {
      status,
      reason: `${wp.work_package_id} is READY; routing to ${targetRole} for ${stage} stage. (Cross-WP dispatch from ${currentRole}.)`,
    };
  }

  // Step 2: All WPs terminal → READY_FOR_SYNTHESIS.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return {
      status: 'READY_FOR_SYNTHESIS',
      reason: 'All work packages are in a terminal state.',
    };
  }

  // No deterministic dispatch available — caller falls through to WAIT.
  return null;
}

/**
 * Get handoff status for Project Manager (§13.1)
 *
 * Priority-ordered algorithm:
 * 1. Non-dependency blockers (decision/external/technical) → IN_PROGRESS (PM must act)
 * 2. READY WPs → route to assigned agent via readyStatusForAgent
 * 2b. IN_PROGRESS WPs with a pending pipeline stage → route to the stage-owning agent.
 *     Covers stage-transition routing (e.g. impl PASS → QA) and freshly-claimed WPs
 *     (zero pipelines → route to first active stage). Guards: FAIL (break), current-stage
 *     IN_PROGRESS (break), upstream IN_PROGRESS (break).
 * 3. All terminal → READY_FOR_SYNTHESIS
 * 4. WPs in-flight (IN_PROGRESS or dependency-BLOCKED) → WAIT
 */
export async function getProjectManagerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Step 1: Non-dependency blockers — PM must resolve before work can continue.
  // Dependency-blocked WPs (blocked_by absent or blocked_by.type === 'dependency') are
  // skipped — they are gated on other WPs completing, not on PM intervention.
  for (const wp of wpDetails) {
    if (
      !isTerminalStatus(wp.status) &&
      wp.status === 'BLOCKED' &&
      wp.blocked_by != null &&
      ['decision', 'external', 'technical'].includes(wp.blocked_by.type)
    ) {
      return buildHandoffResponse(
        'Project Manager',
        'IN_PROGRESS',
        `Blocker resolution required: ${wp.work_package_id} is BLOCKED by a ${wp.blocked_by.type} issue — "${wp.blocked_by.description}". Project Manager must resolve before work can continue.`,
        undefined,
        projectPath,
        store
      );
    }
  }

  // Step 2: READY WPs → route to the agent assigned to that work package.
  // Unassigned WPs route to the agent owning the WP's first active stage (§13.1).
  for (const wp of wpDetails) {
    if (wp.status === 'READY') {
      const targetAgent =
        wp.assigned_to ??
        PIPELINE_AGENT_MAP[
          firstActiveStage(
            (wp.active_pipeline_stages as PipelineType[] | undefined) ?? null
          )
        ];
      const status = readyStatusForAgent(targetAgent);
      return buildHandoffResponse(
        'Project Manager',
        status,
        `Work package ${wp.work_package_id} is READY. Routing to ${targetAgent} (${wp.assigned_to ? 'assigned' : 'first active stage'}).`,
        undefined,
        projectPath,
        store
      );
    }
  }

  // Step 2b: IN_PROGRESS WPs needing next pipeline stage (§13.1 step 2b)
  // Fires only when step 2 finds no READY WPs. Scans each non-terminal, non-dependency-blocked
  // IN_PROGRESS WP for a pipeline stage that has not yet PASSed and is safe to start.
  // Covers both (a) stage-transition routing and (b) freshly-claimed WPs with zero pipelines.
  for (const wp of wpDetails) {
    if (isTerminalStatus(wp.status) || wp.status !== 'IN_PROGRESS') continue;
    if (isBlockedByDependencies(wp)) continue;

    const activeStages = getOrderedActiveStages(
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
    );

    for (const stage of activeStages) {
      // Check the most recent non-auto-cancelled pipeline for this stage
      const mostRecent = latestNonCancelledPipeline(wp.pipelines, stage);

      if (mostRecent?.status === 'PASS') continue; // stage done, check next

      // First stage not yet PASS — apply guards before routing
      if (mostRecent?.status === 'FAIL') break; // FAIL routing handled by downstream agent's own handoff
      if (mostRecent?.status === 'IN_PROGRESS') break; // stage already being worked on

      // Upstream prerequisite guard: skip if upstream stage is still IN_PROGRESS
      const upstream = resolvePrerequisite(stage, activeStages);
      if (upstream) {
        if (latestNonCancelledPipeline(wp.pipelines, upstream)?.status === 'IN_PROGRESS') break;
      }

      // Route to the agent that owns this stage
      const targetAgent = PIPELINE_AGENT_MAP[stage];
      const status = readyStatusForAgent(targetAgent);
      return buildHandoffResponse(
        'Project Manager',
        status,
        `Work package ${wp.work_package_id} is IN_PROGRESS with ` +
          `${stage} stage pending. Routing to ${targetAgent}.`,
        undefined,
        projectPath,
        store
      );
    }
  }

  // Step 3: All terminal → Synthesis.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Project Manager',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state. Project ready for Synthesis.',
      undefined,
      projectPath,
      store
    );
  }

  // Step 4: WPs in-flight (IN_PROGRESS or dependency-BLOCKED) — no PM action needed.
  return buildHandoffResponse(
    'Project Manager',
    'WAIT',
    'Work packages are in-flight (IN_PROGRESS or BLOCKED by dependencies). No Project Manager action needed.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Developer (§5.1)
 *
 * Priority-ordered algorithm:
 * 1. Temporal-guarded FAIL check — only trigger rework when downstream has ALREADY
 *    re-engaged since the most recent implementation PASS (prevents false rework loops
 *    when Developer has re-delivered but downstream has not yet started).
 * 2. All non-BLOCKED WPs have PASS impl → READY_FOR_QA.
 * 3. Non-BLOCKED WPs still need implementation or have impl FAIL → IN_PROGRESS.
 * 4. All WPs terminal → READY_FOR_SYNTHESIS.
 * Fallback → READY_FOR_QA (partial-complete case).
 */
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Early exit: all WPs terminal → READY_FOR_SYNTHESIS (§5.1 step 3).
  // Must be checked BEFORE allImplemented to avoid false positives on CANCELLED WPs
  // that have no impl pipeline.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Developer',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state (COMPLETE or CANCELLED).',
      undefined,
      projectPath,
      store
    );
  }

  // Scope filter (§13.1 §21.69): only WPs that include 'implementation' in their active
  // stages are subject to pipeline-specific checks. Legacy WPs without the field fall
  // back to DEFAULT_PIPELINE_STAGES (backward-compatible).
  const implWps = scopeToStage(wpDetails, 'implementation');

  // Step 1 of §5.1: Temporal-guarded FAIL check.
  // Fire IN_PROGRESS only when a downstream agent has ALREADY started work after our
  // most recent implementation PASS. This prevents false rework loops: if Developer
  // has re-delivered (impl-2 PASS) but QA has not yet started, hasDownstreamReengagedSince
  // returns false and we fall through to READY_FOR_QA instead of re-triggering rework.
  const activeWps = implWps.filter(
    (wp) => !isTerminalStatus(wp.status) && !isBlockedByDependencies(wp)
  );
  const failTypes = ['implementation', 'qa', 'code-review'] as const;
  for (const wp of activeWps) {
    for (const type of failTypes) {
      if (
        isMostRecentPipelineFail(wp.pipelines, type) &&
        hasDownstreamReengagedSince(wp.pipelines, 'implementation')
      ) {
        const wpsNeedingRework = activeWps.filter((w) =>
          failTypes.some(
            (t) =>
              isMostRecentPipelineFail(w.pipelines, t) &&
              hasDownstreamReengagedSince(w.pipelines, 'implementation')
          )
        );
        return buildHandoffResponse(
          'Developer',
          'IN_PROGRESS',
          `Implementation work in progress. ${wpsNeedingRework.length} work package(s) have downstream failures requiring rework (downstream re-engaged after last implementation PASS).`,
          `Call ledger_get_next_action with agent_role: "Developer" to find the next work package to implement or rework. Continue working until all WPs have PASS implementation pipelines.`,
          projectPath,
          store
        );
      }
    }
  }

  // Only consider non-BLOCKED WPs (scoped to implWps) for the remaining checks.
  // BLOCKED WPs have no implementation pipeline yet (they're waiting on dependencies)
  // and must not be counted as "needing work" by the Developer right now.
  const nonBlockedWps = implWps.filter((wp) => wp.status !== 'BLOCKED');

  // Check if all non-BLOCKED WPs have PASS implementation pipelines
  const allImplemented = nonBlockedWps.length > 0 && nonBlockedWps.every((wp) =>
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

  // Check if any non-BLOCKED WP needs implementation or has FAIL pipeline.
  //
  // NOTE: isMostRecentPipelineFail is intentionally NOT used here for the needsWork
  // check. That helper only checks the most recent pipeline, which would miss a WP
  // that has an older FAIL pipeline followed by a currently IN_PROGRESS one.
  // getDeveloperHandoff needs a conservative signal: if any implementation attempt
  // has ever FAIL-ed and no PASS pipeline exists yet, the WP is still considered
  // in-progress. The temporal guard above handles the case where a downstream FAIL
  // requires Developer rework.
  //
  // BLOCKED WPs are excluded: they are gated on dependencies and cannot be
  // claimed by the Developer right now. Including them caused a false IN_PROGRESS
  // that contradicted the WAIT returned by ledger_get_next_action.
  const needsWork = nonBlockedWps.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'implementation') ||
      wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
  );

  if (needsWork) {
    // Count how many non-BLOCKED work packages still need implementation
    const wpsNeedingWork = nonBlockedWps.filter(
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
 * Get handoff status for QA (§5.2)
 *
 * Re-engagement step MUST precede the FAIL short-circuit (§5.2 critical note).
 * After qa-1 FAIL → impl-2 PASS, hasNewUpstreamPassSince returns true, routing
 * QA back to IN_PROGRESS rather than incorrectly sending Developer to rework.
 */
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit: if every WP is COMPLETE/CANCELLED the project is done.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'QA',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Scope filter (§13.1 §21.69): only WPs that include 'qa' in their active stages are
  // subject to pipeline-specific checks. Legacy WPs without the field fall back to
  // DEFAULT_PIPELINE_STAGES (backward-compatible).
  const qaWps = scopeToStage(wpDetails, 'qa');

  // Step 1 of §5.2 (Condition 1): Re-engagement check — MUST precede FAIL short-circuit.
  // If QA FAIL exists AND Developer has since re-delivered a PASS implementation,
  // QA must re-engage rather than routing back to READY_FOR_DEVELOPER.
  // Note: 'implementation' is hardcoded here (spec-authorized — see §5.2 implementation note).
  // For first-active-stage compositions without an implementation stage, hasNewUpstreamPassSince
  // returns false and the check does not fire — correct conservative behavior (§21.66).
  for (const wp of qaWps) {
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'qa') &&
      hasNewUpstreamPassSince(wp.pipelines, 'implementation', 'qa')
    ) {
      return buildHandoffResponse(
        'QA',
        'IN_PROGRESS',
        `QA re-engagement required: ${wp.work_package_id} has a QA FAIL but implementation was re-delivered after the failure. QA must re-validate.`,
        `Call ledger_get_next_action with agent_role: "QA" to find the work package to re-validate.`,
        projectPath,
        store
      );
    }
  }

  // Step 2 of §5.2 (Condition 2): FAIL → READY_FOR_DEVELOPER.
  // Only reached when re-engagement did not fire (i.e., implementation has NOT re-PASSed since QA FAIL).
  const failWps = qaWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'qa')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'QA',
      'READY_FOR_DEVELOPER',
      `QA FAIL on ${failWps.length} work package(s): ${failWps.map((wp) => wp.work_package_id).join(', ')}. Developer must rework.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 3 of §5.2 (Condition 3): WPs with PASS QA and next stage not started
  // → READY_FOR_<next agent> (resolved dynamically via resolveNextAgent).
  // nextAgent resolves to 'Security Auditor' when security-audit is active, 'Reviewer' otherwise.
  const wpsPassedQa = qaWps.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS')
  );
  const { ready, blocked, nextStatus } = partitionWpsAwaitingNextStage(wpsPassedQa, 'qa');
  if (ready.length > 0) {
    // nextStatus is always non-null here (partitionWpsAwaitingNextStage returns the first
    // ready WP's READY_FOR_* status even for mixed-routing across multiple next agents).
    const allNextAgentNames = [...new Set(
      ready.map((wp) => resolveNextAgent('qa', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES))
    )];
    const reason = allNextAgentNames.length === 1
      ? `${ready.length} work package(s) have PASS QA and are ready for ${allNextAgentNames[0]}.`
      : `${ready.length} WPs have PASS QA; routing to ${allNextAgentNames[0]!} first — ${allNextAgentNames.join(', ')} all need to run.`;
    return buildHandoffResponse('QA', nextStatus!, reason, undefined, projectPath, store);
  }
  if (ready.length === 0 && blocked.length > 0) {
    return buildHandoffResponse(
      'QA',
      'WAIT',
      `${blocked.length} work package(s) with PASS QA are dependency-blocked. Waiting for dependencies to resolve.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 4 of §5.2 (Condition 4): assigned_to === 'QA' with IN_PROGRESS → active work.
  const activeQaWp = wpDetails.find(
    (wp) => wp.status === 'IN_PROGRESS' && wp.assigned_to === 'QA',
  );
  if (activeQaWp) {
    return buildHandoffResponse(
      'QA',
      'IN_PROGRESS',
      `QA has active work on ${activeQaWp.work_package_id}.`,
      `Call ledger_get_next_action with agent_role: "QA" to continue.`,
      projectPath,
      store
    );
  }

  // Step 5 of §5.2 (Condition 5): Cross-WP dispatch — if a READY WP exists whose
  // dependencies are satisfied, route to the agent owning its first active pipeline
  // stage. Prevents IDE stall when QA's role-specific work is done but other WPs
  // have not yet started any pipelines. Fallthrough to WAIT when no dispatch found.
  const dispatch = findNextReadyDispatch(wpDetails, 'QA');
  if (dispatch) {
    return buildHandoffResponse(
      'QA',
      dispatch.status,
      dispatch.reason,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'QA',
    'WAIT',
    'No actionable work for QA.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Security Auditor (§5.2b)
 *
 * Structurally identical to QA handoff, applied to security-audit pipelines.
 * Only active for WPs that include "security-audit" in active stages.
 */
export async function getSecurityAuditorHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit: if every WP is COMPLETE/CANCELLED the project is done.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Security Auditor',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Scope filter: only WPs that include 'security-audit' in their active stages.
  // WPs without the optional security-audit stage are invisible to pipeline-specific checks.
  const auditWps = scopeToStage(wpDetails, 'security-audit');

  // Step 1 of §5.2b (Condition 1): Re-engagement check — MUST precede FAIL short-circuit.
  // If security-audit FAIL exists AND QA has since re-PASSed, Security Auditor must re-engage.
  // Note: 'qa' is hardcoded here — it is the only legal upstream for security-audit (spec-authorized).
  for (const wp of auditWps) {
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'security-audit') &&
      hasNewUpstreamPassSince(wp.pipelines, 'qa', 'security-audit')
    ) {
      return buildHandoffResponse(
        'Security Auditor',
        'IN_PROGRESS',
        `Security re-engagement required: ${wp.work_package_id} has a security-audit FAIL but QA has since re-passed. Auditor must re-evaluate.`,
        `Call ledger_get_next_action with agent_role: "Security Auditor" to find the work package to re-audit.`,
        projectPath,
        store
      );
    }
  }

  // Step 2 of §5.2b (Condition 2): FAIL → READY_FOR_DEVELOPER.
  // Only reached when re-engagement did not fire (i.e., QA has NOT re-PASSed since the audit FAIL).
  const failWps = auditWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'security-audit')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'Security Auditor',
      'READY_FOR_DEVELOPER',
      `Security audit FAIL on ${failWps.length} work package(s): ${failWps.map((wp) => wp.work_package_id).join(', ')}. Developer must fix security issues.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 3 of §5.2b (Condition 3): PASS security-audit but next stage (code-review) not PASSed.
  // Dynamic routing via resolveNextAgent — always resolves to 'Reviewer' for security-audit.
  const wpsPassedAudit = auditWps.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      wp.pipelines.some((p) => p.type === 'security-audit' && p.status === 'PASS')
  );
  const { ready, blocked, nextStatus } = partitionWpsAwaitingNextStage(wpsPassedAudit, 'security-audit');
  if (ready.length > 0) {
    // nextStatus is always non-null here (partitionWpsAwaitingNextStage returns the first
    // ready WP's READY_FOR_* status even for mixed-routing across multiple next agents).
    const allNextAgentNames = [...new Set(
      ready.map((wp) => resolveNextAgent('security-audit', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES))
    )];
    const reason = allNextAgentNames.length === 1
      ? `${ready.length} work package(s) passed security audit and are ready for ${allNextAgentNames[0]}.`
      : `${ready.length} WPs passed security audit; routing to ${allNextAgentNames[0]!} first — ${allNextAgentNames.join(', ')} all need to run.`;
    return buildHandoffResponse('Security Auditor', nextStatus!, reason, undefined, projectPath, store);
  }
  if (ready.length === 0 && blocked.length > 0) {
    return buildHandoffResponse(
      'Security Auditor',
      'WAIT',
      `${blocked.length} work package(s) passed security audit but are dependency-blocked.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 4 of §5.2b (Condition 4): assigned_to === 'Security Auditor' with IN_PROGRESS → active work.
  const activeAuditorWp = wpDetails.find(
    (wp) => wp.status === 'IN_PROGRESS' && wp.assigned_to === 'Security Auditor',
  );
  if (activeAuditorWp) {
    return buildHandoffResponse(
      'Security Auditor',
      'IN_PROGRESS',
      `Security Auditor has active work on ${activeAuditorWp.work_package_id}.`,
      `Call ledger_get_next_action with agent_role: "Security Auditor" to continue.`,
      projectPath,
      store
    );
  }

  // Step 5 of §5.2b (Condition 5): Cross-WP dispatch — if a READY WP exists whose
  // dependencies are satisfied, route to the agent owning its first active pipeline
  // stage. Prevents IDE stall when Security Auditor's role-specific work is done but
  // other WPs have not yet started any pipelines. Fallthrough to WAIT when no dispatch found.
  const dispatch = findNextReadyDispatch(wpDetails, 'Security Auditor');
  if (dispatch) {
    return buildHandoffResponse(
      'Security Auditor',
      dispatch.status,
      dispatch.reason,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Security Auditor',
    'WAIT',
    'No actionable work for Security Auditor.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Reviewer (§5.3)
 *
 * Structurally identical to QA handoff, applied to code-review pipelines.
 * Re-engagement step MUST precede the FAIL short-circuit.
 */
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit: if every WP is COMPLETE/CANCELLED the project is done.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  // Scope filter (§13.1 §21.69): only WPs that include 'code-review' in their active stages
  // are subject to pipeline-specific checks. Legacy WPs fall back to DEFAULT_PIPELINE_STAGES.
  const reviewWps = scopeToStage(wpDetails, 'code-review');

  // Step 1 of §5.3 (Condition 1): Re-engagement check — MUST precede FAIL short-circuit.
  // If code-review FAIL exists AND the effective upstream has since re-PASSed, Reviewer must re-engage.
  // Dynamic upstream (v2.0.0): resolvePrerequisite resolves to 'security-audit' when active,
  // 'qa' otherwise, or null for first-active-stage compositions.
  // resolvePrerequisite returns null → code-review is the first active stage → re-engagement
  // skip is intentional (§21.66): no upstream stage exists to have re-passed.
  for (const wp of reviewWps) {
    const reviewActiveStages: readonly PipelineType[] =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    const reviewUpstream = resolvePrerequisite('code-review', reviewActiveStages);
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'code-review') &&
      reviewUpstream !== null &&
      hasNewUpstreamPassSince(wp.pipelines, reviewUpstream, 'code-review')
    ) {
      return buildHandoffResponse(
        'Reviewer',
        'IN_PROGRESS',
        `Reviewer re-engagement required: ${wp.work_package_id} has a code-review FAIL but upstream (${reviewUpstream}) has since re-passed. Reviewer must re-evaluate.`,
        `Call ledger_get_next_action with agent_role: "Reviewer" to find the work package to re-review.`,
        projectPath,
        store
      );
    }
  }

  // Step 2 of §5.3 (Condition 2): FAIL → READY_FOR_DEVELOPER.
  // Only reached when re-engagement did not fire (i.e., upstream has NOT re-PASSed since the review FAIL).
  const failWps = reviewWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'code-review')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DEVELOPER',
      `Code review FAIL on ${failWps.length} work package(s): ${failWps.map((wp) => wp.work_package_id).join(', ')}. Developer must rework.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 3 of §5.3 (Condition 3): WPs with PASS code-review and next stage not started
  // → READY_FOR_<next agent> (resolved dynamically via resolveNextAgent).
  // nextAgent resolves to 'Release Engineer' when release-engineering is active, 'Documentation' otherwise.
  const wpsPassedReview = reviewWps.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );
  const { ready, blocked, nextStatus } = partitionWpsAwaitingNextStage(wpsPassedReview, 'code-review');
  if (ready.length > 0) {
    // nextStatus is always non-null here (partitionWpsAwaitingNextStage returns the first
    // ready WP's READY_FOR_* status even for mixed-routing across multiple next agents).
    const allNextAgentNames = [...new Set(
      ready.map((wp) => resolveNextAgent('code-review', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES))
    )];
    const reason = allNextAgentNames.length === 1
      ? `${ready.length} work package(s) have PASS code-review and are ready for ${allNextAgentNames[0]}.`
      : `${ready.length} WPs have PASS code-review; routing to ${allNextAgentNames[0]!} first — ${allNextAgentNames.join(', ')} all need to run.`;
    return buildHandoffResponse('Reviewer', nextStatus!, reason, undefined, projectPath, store);
  }
  if (ready.length === 0 && blocked.length > 0) {
    return buildHandoffResponse(
      'Reviewer',
      'WAIT',
      `${blocked.length} work package(s) with PASS code-review are dependency-blocked. Waiting for dependencies to resolve.`,
      undefined,
      projectPath,
      store
    );
  }

  // Step 4 of §5.3 (Condition 4): assigned_to === 'Reviewer' with IN_PROGRESS → active work.
  const activeReviewerWp = wpDetails.find(
    (wp) => wp.status === 'IN_PROGRESS' && wp.assigned_to === 'Reviewer',
  );
  if (activeReviewerWp) {
    return buildHandoffResponse(
      'Reviewer',
      'IN_PROGRESS',
      `Reviewer has active work on ${activeReviewerWp.work_package_id}.`,
      `Call ledger_get_next_action with agent_role: "Reviewer" to continue.`,
      projectPath,
      store
    );
  }

  // Step 5 of §5.3 (Condition 5): Cross-WP dispatch — if a READY WP exists whose
  // dependencies are satisfied, route to the agent owning its first active pipeline
  // stage. Prevents IDE stall when Reviewer's role-specific work is done but other
  // WPs have not yet started any pipelines. Fallthrough to WAIT when no dispatch found.
  const dispatch = findNextReadyDispatch(wpDetails, 'Reviewer');
  if (dispatch) {
    return buildHandoffResponse(
      'Reviewer',
      dispatch.status,
      dispatch.reason,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Reviewer',
    'WAIT',
    'No actionable work for Reviewer.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Release Engineer (§5.2c)
 *
 * Self-rework on FAIL. Only active for WPs that include "release-engineering".
 */
export async function getReleaseEngineerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit (matches QA/Security/Reviewer/Documentation pattern)
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Release Engineer',
      'READY_FOR_SYNTHESIS',
      'All work packages are in a terminal state.',
      undefined,
      projectPath,
      store
    );
  }

  const releaseWps = scopeToStage(wpDetails, 'release-engineering');

  // Release engineering ready (PASS code-review, no release pipeline yet or new upstream pass)
  const readyWps = releaseWps.filter((wp) => {
    if (isTerminalStatus(wp.status) || isBlockedByDependencies(wp)) return false;
    const hasPassCR = wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS');
    const noReleaseYet = !wp.pipelines.some((p) => p.type === 'release-engineering');
    const newUpstream = hasNewUpstreamPassSince(wp.pipelines, 'code-review', 'release-engineering');
    return hasPassCR && (noReleaseYet || newUpstream);
  });

  if (readyWps.length > 0) {
    return buildHandoffResponse(
      'Release Engineer',
      'IN_PROGRESS',
      `Release engineering in progress. ${readyWps.length} work package(s) ready for release.`,
      `Call ledger_get_next_action with agent_role: "Release Engineer" to find the next work package to release.`,
      projectPath,
      store
    );
  }

  // FAIL conditions: self-rework
  const failWps = releaseWps.filter((wp) =>
    !isTerminalStatus(wp.status) &&
    !isBlockedByDependencies(wp) &&
    isMostRecentPipelineFail(wp.pipelines, 'release-engineering')
  );
  if (failWps.length > 0) {
    return buildHandoffResponse(
      'Release Engineer',
      'IN_PROGRESS',
      `Release rework required. ${failWps.length} work package(s) have FAIL release-engineering pipelines.`,
      `Call ledger_get_next_action with agent_role: "Release Engineer" to find the work package to rework.`,
      projectPath,
      store
    );
  }

  // Cross-WP dispatch — if a READY WP exists whose dependencies are satisfied,
  // route to the agent owning its first active pipeline stage. Prevents IDE stall
  // when Release Engineer's role-specific work is done but other WPs have not yet
  // started any pipelines. Fallthrough to WAIT when no dispatch found.
  const dispatch = findNextReadyDispatch(wpDetails, 'Release Engineer');
  if (dispatch) {
    return buildHandoffResponse(
      'Release Engineer',
      dispatch.status,
      dispatch.reason,
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Release Engineer',
    'WAIT',
    'Release engineering complete or awaiting code review.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Documentation (§5.4)
 *
 * Priority order per §14.5: ready-for-docs (new work or re-engagement via
 * hasNewUpstreamPassSince) comes BEFORE FAIL self-rework. This is the opposite
 * of the recommendation engine priority and is intentional for handoff routing.
 */
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // All-terminal early exit (§5.4): applies to all WPs regardless of active stages.
  if (wpDetails.length > 0 && wpDetails.every((wp) => isTerminalStatus(wp.status))) {
    return buildHandoffResponse(
      'Documentation',
      'READY_FOR_SYNTHESIS',
      'All work packages are terminal.',
      undefined,
      projectPath,
      store
    );
  }

  // Scope filter (§13.1): only WPs that include 'documentation' in their active stages
  // are subject to pipeline-specific checks. Legacy WPs fall back to DEFAULT_PIPELINE_STAGES.
  const docWps = scopeToStage(wpDetails, 'documentation');

  // Step 1 of §5.4 (Condition 1): Ready-for-docs check — new documentation OR re-engagement.
  // Per §14.5: this step comes BEFORE FAIL self-rework in handoff priority.
  // Uses hasPassedDynamicUpstream for upstream PASS detection and hasNewUpstreamPassSince
  // for re-engagement (a new upstream PASS after the most recent documentation run).
  // Documentation-only WPs (null upstream) match only via "no documentation pipeline yet".
  const readyForDocsList = docWps.filter((wp) => {
    if (isTerminalStatus(wp.status) || isBlockedByDependencies(wp)) return false;
    if (!hasPassedDynamicUpstream(wp, 'documentation')) return false;
    // No documentation pipeline yet → ready for docs
    if (!wp.pipelines.some((p) => p.type === 'documentation')) return true;
    // Re-engagement: check if effective upstream has re-passed since last doc run.
    // §14.6: hasNewUpstreamPassSince(null, "documentation") returns false,
    // so documentation-only WPs only match via "no documentation pipeline yet" above.
    const activeStages =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    const upstream = resolvePrerequisite('documentation', activeStages);
    return upstream !== null && hasNewUpstreamPassSince(wp.pipelines, upstream, 'documentation');
  });
  if (readyForDocsList.length > 0) {
    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation work in progress. ${readyForDocsList.length} work package(s) need documentation or re-documentation after upstream changes.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // Step 2 of §5.4 (Condition 2): FAIL → Documentation self-rework.
  // Documentation self-corrects on FAIL rather than routing back upstream.
  // Note: no upstream-PASS gate here — the spec (§5.4) requires only non-terminal,
  // non-dep-blocked, most-recent-doc-FAIL. If upstream has since re-passed (a new
  // upstream PASS after the doc FAIL), the re-engagement path in Step 1 catches that
  // case first (via readyForDocsList). So Condition 2 remains correct for all other
  // upstream states, including when upstream has since regressed to FAIL (see R4.4b).
  const wpsWithDocFail = docWps.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'documentation')
  );
  if (wpsWithDocFail.length > 0) {
    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation rework required. ${wpsWithDocFail.length} work package(s) have FAIL documentation pipelines and need rework.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // Step 3 of §5.4: WPs in earlier pipeline stages — per spec v2.0.0, Documentation
  // cannot accurately dispatch to the correct upstream agent (Developer / QA / Reviewer etc.).
  // Defer to orchestrator polling — fall through to WAIT.

  // Step 4 of §5.4: Cross-WP dispatch — if a READY WP exists whose dependencies are
  // satisfied, route to the agent owning its first active pipeline stage. Prevents IDE
  // stall when Documentation's role-specific work is done but other WPs have not yet
  // started any pipelines. Fallthrough to WAIT when no dispatch found.
  const dispatch = findNextReadyDispatch(wpDetails, 'Documentation');
  if (dispatch) {
    return buildHandoffResponse(
      'Documentation',
      dispatch.status,
      dispatch.reason,
      undefined,
      projectPath,
      store
    );
  }

  // Fallthrough (§5.4 Condition 5) → WAIT.
  return buildHandoffResponse(
    'Documentation',
    'WAIT',
    'No actionable documentation work.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Compute the handoff status payload without wrapping in an MCP response.
 *
 * Shared utility called by workflow-next-action.ts to embed `handoff_status`
 * directly in `WAIT` responses, eliminating the need for a separate
 * `ledger_get_handoff_status` call by Developer, QA, and Reviewer agents.
 *
 * When `opts.store`, `opts.rootIndex`, and `opts.wpDetails` are ALL provided, the
 * function bypasses `getHandoffStatus()` entirely — dispatching directly to the
 * per-role handoff function with the pre-loaded data. This eliminates the redundant
 * LedgerStore construction and disk reads that would otherwise occur on every
 * WAIT response in the next-action flow.
 *
 * When any of the three opts fields is absent (or opts is omitted), the function
 * falls back to calling `getHandoffStatus()` as before — preserving compatibility
 * with the standalone `ledger_get_handoff_status` tool call path.
 *
 * @throws {Error} if handoff status computation fails (invalid path, project not found, etc.)
 */
export async function computeHandoffStatus(
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<Record<string, unknown>> {
  // Fast path: all three pre-loaded values available — bypass getHandoffStatus()
  if (opts?.store && opts?.rootIndex && opts?.wpDetails) {
    const { store: s, rootIndex, wpDetails } = opts;
    let mcpResult: { content: Array<{ type: string; text: string }> };

    // Replicate the global BLOCKED short-circuit from getHandoffStatus
    const blockedWps = rootIndex.work_packages.filter((wp) => wp.status === 'BLOCKED');
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );
    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0) {
      mcpResult = await buildHandoffResponse(
        agentRole,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        projectPath,
        s
      );
    } else {
      // Dispatch via manifest-typed map (same map used by getHandoffStatus)
      const handler = HANDOFF_DISPATCH[agentRole as AgentRole];
      if (handler) {
        mcpResult = await handler(wpDetails, projectPath, s);
      } else {
        mcpResult = await buildHandoffResponse(agentRole, 'IN_PROGRESS', 'Work in progress.', undefined, projectPath, s);
      }
    }

    if ('isError' in mcpResult && (mcpResult as { isError?: boolean }).isError) {
      const errText = (mcpResult.content as Array<{ text: string }>)[0]?.text ?? 'Handoff status computation failed';
      throw new Error(errText);
    }
    const fastText = (mcpResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
    return JSON.parse(fastText) as Record<string, unknown>;
  }

  // Fallback: original path — constructs a fresh LedgerStore via getHandoffStatus()
  const mcpResult = await getHandoffStatus({ project_path: projectPath, current_agent: agentRole });
  if ('isError' in mcpResult && mcpResult.isError) {
    const errText = (mcpResult.content as Array<{ text: string }>)[0]?.text ?? 'Handoff status computation failed';
    throw new Error(errText);
  }
  const text = (mcpResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}


/**
 * Register the ledger_get_handoff_status tool on the MCP server.
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_handoff_status',
    {
      description: 'Get the handoff status to determine if your work is done and which agent should work next. REQUIRED params: current_agent. Call this after completing your pipelines to check if work should be handed to the next agent in the workflow. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetHandoffStatusSchema,
    },
    getHandoffStatus as any
  );
}

```
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── workflow-next-action.ts

```
###  Path: `/mcp-server/src/tools/workflow-next-action.ts`

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath } from '../utils/path-validator.js';
import { isTerminalStatus, canStartWorkPackage } from '../schema/validators.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import {
  PIPELINE_TYPES,
  PIPELINE_AGENT_MAP,
  type PipelineType,
  resolvePrerequisite,
  resolveFailAgent,
  DEFAULT_PIPELINE_STAGES,
  getOrderedActiveStages,
  firstActiveStage,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  extractStalePipelineAction,
  isMostRecentPipelineFail,
  latestNonCancelledPipeline,
  hasDependencyBlocked,
  hasDownstreamFail,
  hasDownstreamReengagedSince,
  isActivePipeline,
  getHandoffNotesForAgent,
  hasNewUpstreamPassSince,
  makeReEngagementCheck,
  mostRecentEffectivePipeline,
  MAX_REWORK_COUNT,
  STALE_PIPELINE_HOURS,
} from '../utils/workflow-helpers.js';
import { embedHandoffStatusInWait, buildBatchNextSteps, getNextActionsCollector } from './workflow-next-action-batch.js';

/** Handler signature for per-role next-action functions. */
type NextActionHandler = (
  rootIndex: RootIndex,
  store: LedgerStore,
  wpDetails: WorkPackageDetail[],
) => Promise<{ content: Array<{ type: string; text: string }> }>;

/**
 * Manifest-typed dispatch map from agent role → next-action handler.
 *
 * Keyed by `AgentRole` (derived from the shared workflow manifest) so that
 * TypeScript flags any mismatch when a role is added, removed, or renamed.
 * Planner and the default case are handled before dispatch.
 */
const NEXT_ACTION_DISPATCH: Partial<Record<AgentRole, NextActionHandler>> = {
  'Project Manager':  (r, s, w) => getProjectManagerAction(r, s, w),
  'Developer':        (r, s, w) => getDeveloperAction(r, s, w),
  'QA':               (r, s, w) => getQaAction(r, s, w),
  'Security Auditor': (r, s, w) => getSecurityAuditorAction(r, s, w),
  'Reviewer':         (r, s, w) => getReviewerAction(r, s, w),
  'Release Engineer': (r, s, w) => getReleaseEngineerAction(r, s, w),
  'Documentation':    (r, s, w) => getDocumentationAction(r, s, w),
  'Synthesis':        () => Promise.resolve(getSynthesisAction()),
};
/**
 * Tool: get_next_action
 *
 * Reads root index and WP detail files to recommend the next action for an agent.
 * Returns actionable recommendations based on work package statuses and pipeline states.
 */
const GetNextActionSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given.'),
  cwd_path: z.string().optional().describe('Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided.'),
  agent_role: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Security Auditor", "Reviewer", "Release Engineer", "Documentation", "Synthesis"'
    ),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of actionable WPs to return (default: 1). When > 1, returns up to this many actions as an array under the "actions" key instead of a single action object. Useful for projects with many independent WPs.'),
});

async function getNextAction(args: z.infer<typeof GetNextActionSchema>) {
  let projectPath: string;
  try {
    projectPath = await resolveProjectPath(args);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }

  const store = new LedgerStore(projectPath);

  try {
    // Validate agent role
    if (!AGENT_ROLES.includes(args.agent_role as AgentRole)) {
      throw new Error(
        `Unknown agent role: ${args.agent_role}. Valid roles are: ${AGENT_ROLES.join(', ')}`
      );
    }

    // Read root index
    const rootIndex = await store.readRootIndex();

    // Load all WP details once — reused by per-role action functions and the
    // handoff status bypass in embedHandoffStatusInWait (avoids duplicate reads).
    // Safe for zero-WP projects: Promise.all([]) resolves to [].
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

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
        return await embedHandoffStatusInWait(
          {
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
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
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
          return await embedHandoffStatusInWait(
            {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      action: 'WAIT',
                      reason: 'Synthesis report has already been generated. Nothing to do.',
                    },
                    null,
                    2
                  ),
                },
              ],
            },
            projectPath,
            args.agent_role,
            { store, rootIndex, wpDetails }
          );
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
        return await embedHandoffStatusInWait(
          {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    action: 'WAIT',
                    reason: 'All work packages are COMPLETE. Project is ready for Synthesis agent.',
                  },
                  null,
                  2
                ),
              },
            ],
          },
          projectPath,
          args.agent_role,
          { store, rootIndex, wpDetails }
        );
      }
    }

    // If max_results > 1, use batch collector mode
    if (args.max_results !== undefined && args.max_results > 1) {
      return getNextActionsCollector(rootIndex, store, args.agent_role as AgentRole, args.max_results);
    }

    // Agent-specific logic (dispatch map is typed by AgentRole from the manifest)
    const actionHandler = NEXT_ACTION_DISPATCH[args.agent_role as AgentRole];
    if (actionHandler) {
      return await embedHandoffStatusInWait(
        await actionHandler(rootIndex, store, wpDetails),
        projectPath,
        args.agent_role,
        { store, rootIndex, wpDetails }
      );
    }
    return await embedHandoffStatusInWait(
      {
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
      },
      projectPath,
      args.agent_role,
      { store, rootIndex, wpDetails }
    );
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
 * Get next action for Synthesis agent when project is still in progress.
 */
function getSynthesisAction() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'WAIT',
            reason: 'Not all work packages are COMPLETE. Wait for all WPs to finish.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get next action for Project Manager.
 * Implements the 5-priority algorithm from §14.1.2.
 */
export async function getProjectManagerAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details (needed for pipeline and rework state checks; skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  // --- Priority 1: UNBLOCK_WP ---
  // BLOCKED WPs with non-dependency blockers requiring human/PM intervention
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (blockerType === 'decision' || blockerType === 'external' || blockerType === 'technical') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'UNBLOCK_WP',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a ${blockerType} blocker. Investigate and resolve.`,
            }, null, 2),
          }],
        };
      }
    }
  }

  // --- Priority 2: REVIEW_REWORK_LIMIT ---
  // IN_PROGRESS WPs where any rework_counts entry >= MAX_REWORK_COUNT
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS' && wpDetail.rework_counts) {
      for (const [type, count] of Object.entries(wpDetail.rework_counts)) {
        if (typeof count === 'number' && count >= MAX_REWORK_COUNT) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_REWORK_LIMIT',
                work_package_id: wpDetail.work_package_id,
                reason: `Rework limit reached for ${type} pipeline.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3: REVIEW_STALE ---
  // IN_PROGRESS WPs with any stale IN_PROGRESS pipeline
  const allPipelineTypes: readonly string[] = PIPELINE_TYPES;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      for (const pipelineType of allPipelineTypes) {
        const staleAction = extractStalePipelineAction(wpDetail, pipelineType);
        if (staleAction) {
          const innerData = JSON.parse(staleAction.content[0].text) as { age_hours: number };
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REVIEW_STALE',
                work_package_id: wpDetail.work_package_id,
                pipeline_type: pipelineType,
                age_hours: innerData.age_hours,
                reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline (~${innerData.age_hours}h). Investigate and resume or cancel.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3b: REVIEW_ABANDONED ---
  // IN_PROGRESS WPs with no active IN_PROGRESS pipelines and last activity > STALE_PIPELINE_HOURS
  const staleThresholdMs = STALE_PIPELINE_HOURS * 60 * 60 * 1000;
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasActivePipeline = wpDetail.pipelines.some((p) => p.status === 'IN_PROGRESS');
      if (!hasActivePipeline) {
        const now = Date.now();
        const lastEffective = mostRecentEffectivePipeline(wpDetail);
        if (lastEffective) {
          if (lastEffective.completed_at) {
            const completedAt = parseTimestamp(lastEffective.completed_at).getTime();
            if (now - completedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no active pipelines. Last activity was more than ${STALE_PIPELINE_HOURS} hours ago.`,
                  }, null, 2),
                }],
              };
            }
          }
        } else {
          // No effective pipeline — use status_changed_at for grace period check
          if (wpDetail.status_changed_at) {
            const changedAt = parseTimestamp(wpDetail.status_changed_at).getTime();
            if (now - changedAt > staleThresholdMs) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    action: 'REVIEW_ABANDONED',
                    work_package_id: wpDetail.work_package_id,
                    reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no pipelines and has been idle for more than ${STALE_PIPELINE_HOURS} hours.`,
                  }, null, 2),
                }],
              };
            }
            // within grace period — skip
          }
          // No status_changed_at and no pipelines — recently claimed, skip
        }
      }
    }
  }

  // --- Priority 3c: REPAIR_ORPHAN_BLOCKED ---
  // BLOCKED WPs with dependency blocker (or absent blocked_by) where all deps are now terminal
  for (const wpDetail of wpDetails) {
    if (wpDetail.status === 'BLOCKED') {
      const blockerType = wpDetail.blocked_by?.type;
      if (!blockerType || blockerType === 'dependency') {
        const canStart = canStartWorkPackage(wpDetail, rootIndex.work_packages);
        if (canStart.allowed) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'REPAIR_ORPHAN_BLOCKED',
                work_package_id: wpDetail.work_package_id,
                reason: `Work package ${wpDetail.work_package_id} is BLOCKED by a dependency that has since completed. Auto-unblock did not run. Investigate and unblock.`,
              }, null, 2),
            }],
          };
        }
      }
    }
  }

  // --- Priority 3d: ROUTE_PIPELINE_AGENT ---
  // Fires only when no READY WPs remain (step 2 found nothing). Scans each non-terminal,
  // non-dependency-blocked IN_PROGRESS WP for a pipeline stage that needs to be started.
  // Covers two distinct cases:
  //   Case A — mid-flight PASS advance: a stage has PASSed and the next active stage has
  //             no pipeline started yet. Routes to PIPELINE_AGENT_MAP[nextStage].
  //   Case B — zero-pipeline bootstrap: a WP was freshly claimed but the owning agent has
  //             not yet called startPipeline. No pipelines exist, so the first active stage
  //             has no PASS, FAIL, or IN_PROGRESS — routes to PIPELINE_AGENT_MAP[firstActiveStage].
  // Guards: FAIL stages are skipped (handled by downstream agent's own FAIL routing),
  //         IN_PROGRESS stages are skipped (stage already being worked on),
  //         upstream IN_PROGRESS stages are skipped (premature routing prevention),
  //         dependency-blocked WPs are excluded entirely.
  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status !== 'IN_PROGRESS') continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const activeStages = getOrderedActiveStages(
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? [...DEFAULT_PIPELINE_STAGES]
    );

    for (const stage of activeStages) {
      const mostRecent = latestNonCancelledPipeline(wpDetail.pipelines, stage);

      if (mostRecent?.status === 'PASS') continue; // stage done, check next
      if (mostRecent?.status === 'FAIL') break;     // FAIL routing handles this WP
      if (mostRecent?.status === 'IN_PROGRESS') break; // stage already being worked on

      // Check upstream prerequisite for premature routing prevention
      const upstream = resolvePrerequisite(stage, activeStages);
      if (upstream) {
        if (latestNonCancelledPipeline(wpDetail.pipelines, upstream)?.status === 'IN_PROGRESS') break;
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'ROUTE_PIPELINE_AGENT',
            work_package_id: wpDetail.work_package_id,
            pipeline_type: stage,
            next_agent: PIPELINE_AGENT_MAP[stage],
            reason: `Work package ${wpDetail.work_package_id} needs its ${stage} stage started. Route to ${PIPELINE_AGENT_MAP[stage]}.`,
          }, null, 2),
        }],
      };
    }
  }

  // --- Final Fallback: WAIT ---
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No actionable items found.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Developer.
 * Per-WP priority evaluation from §14.2.
 */
export async function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal (COMPLETE, CANCELLED) and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where implementation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('implementation')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // P1: BLOCK_FOR_REWORK_LIMIT (IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const implReworkCount = wpDetail.rework_counts?.implementation ?? 0;
      if (implReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: implReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} has reached the maximum rework count (${MAX_REWORK_COUNT}). It cannot proceed with further implementation cycles.`,
              next_steps: [
                `1. Review the rework history in ${wpDetail.work_package_id} to understand repeated failures.`,
                `2. Consider cancelling this WP via ledger_update_work_package_status (status: "CANCELLED") and creating a replacement WP with a revised approach.`,
                `3. Alternatively, restructure the work package scope to address the root cause of repeated failures.`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer") to continue the workflow.`,
              ],
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale IN_PROGRESS implementation pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'implementation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale implementation pipeline)
    if (isActivePipeline(wpDetail, 'implementation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active implementation pipeline in progress. Continue working on it.`,
            next_steps: [
              `1. Complete the current implementation work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (direct fail — most recent implementation pipeline is FAIL)
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'implementation')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL implementation pipeline. Rework and retry.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") — WP is already IN_PROGRESS, starts pipeline directly.`,
              '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P5 + P5b: Downstream FAIL checks (only meaningful when implementation has PASS)
    const hasPassImpl = wpDetail.pipelines.some(
      (p) => p.type === 'implementation' && p.status === 'PASS' && !p.auto_cancelled
    );
    if (hasPassImpl && hasDownstreamFail(wpDetail.pipelines, 'implementation', activeStages)) {
      if (hasDownstreamReengagedSince(wpDetail.pipelines, 'implementation', activeStages)) {
        // P5: REWORK (downstream triggered — downstream re-ran after last impl PASS)
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'REWORK',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a downstream failure after implementation was accepted. Downstream re-engagement detected.`,
              next_steps: [
                `1. Call ledger_get_work_package to review the downstream FAIL pipeline comments/summary.`,
                `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to begin a new implementation cycle.`,
                '3. Fix the issues identified by the failed pipeline, run tests.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      } else {
        // P5b: WAIT_FOR_DOWNSTREAM — fix delivered, downstream hasn't re-engaged yet
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_DOWNSTREAM',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id}: fix delivered; awaiting downstream re-engagement.`,
            }, null, 2),
          }],
        };
      }
    }

    // P6: IMPLEMENT (IN_PROGRESS, no implementation pipeline started yet)
    if (wpDetail.status === 'IN_PROGRESS') {
      const hasImplPipeline = wpDetail.pipelines.some((p) => p.type === 'implementation' && !p.auto_cancelled);
      if (!hasImplPipeline) {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'IMPLEMENT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} is IN_PROGRESS with no implementation pipeline. Implement.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer").`,
                '2. Read the WP spec, implement the changes, run tests.',
                `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
                `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P7: CLAIM_WP (READY, dependencies satisfied, unassigned or assigned to Developer)
    if (wpDetail.status === 'READY' && (wpDetail.assigned_to == null || wpDetail.assigned_to === 'Developer')) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Developer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Developer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "implementation", agent_role: "Developer") to claim and start the pipeline in one step.`,
              '2. Read the WP spec, implement the changes, run tests.',
              `3. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for implementation. All WPs either have implementation pipelines or are blocked.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for QA.
 * Per-WP priority evaluation from §14.3.
 */
export async function getQaAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where qa is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('qa')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for qa in this WP's active stages
    const qaPrerequisite = resolvePrerequisite('qa', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (QA's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const qaReworkCount = wpDetail.rework_counts?.qa ?? 0;
      if (qaReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: qaReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} QA has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (qaPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[qaPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${qaPrerequisite} has reached the maximum rework count. QA cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale QA pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'qa');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale QA pipeline)
    if (isActivePipeline(wpDetail, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active QA pipeline in progress. Continue QA work.`,
            next_steps: [
              `1. Complete the current QA work for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_QA (re-engagement) — at least one prior QA pipeline AND new upstream PASS since then
    const priorQaPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'qa' && !p.auto_cancelled
    );
    const hasNewPrereqPassForQa = makeReEngagementCheck(wpDetail.pipelines, qaPrerequisite, 'qa');
    if (priorQaPipelines.length > 0 && hasNewPrereqPassForQa) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last QA pipeline. Re-run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — QA FAIL routes back to QA when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      const qaFailAgent = resolveFailAgent('qa', activeStages);
      if (qaFailAgent === 'QA') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_QA',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. QA is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run QA.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior QA FAIL. Re-execute the Verification Stack.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "QA").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent QA is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'qa')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL QA pipeline. The fail-target agent must rework before QA can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_QA (first-run) — no prior QA pipeline + prerequisite has PASS (or no prerequisite)
    const hasPrereqPass = qaPrerequisite === null
      ? true // qa is first active stage, can always start
      : wpDetail.pipelines.some(
          (p) => p.type === qaPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasPrereqPass && priorQaPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      const prereqLabel = qaPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_QA',
            work_package_id: wpDetail.work_package_id,
            reason: qaPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no QA pipeline. Run QA.`
              : `Work package ${wpDetail.work_package_id} has no prior QA pipeline and qa is the first active stage. Run QA.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "qa", agent_role: "QA").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Execute the Verification Stack: build check, AC verification, regression tests, edge-case stress tests.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "qa", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to QA)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'QA') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'QA');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to QA with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "QA") to transition to IN_PROGRESS.`,
              `2. Wait for implementation pipeline to complete before starting QA.`,
              `3. Call ledger_get_handoff_status (current_agent: "QA").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  // Build a specific WAIT reason by categorising the non-terminal, non-blocked WPs
  // that include qa in their active stages.
  const eligibleQaWps = wpDetails.filter((wp) => {
    if (isTerminalStatus(wp.status) || wp.status === 'BLOCKED') return false;
    const stages: readonly PipelineType[] =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!stages.includes('qa')) return false;
    if (hasDependencyBlocked(wp)) return false;
    return true;
  });
  const passedQaCount = eligibleQaWps.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'qa' && p.status === 'PASS' && !p.auto_cancelled)
  ).length;
  const waitingForQaPrereqCount = eligibleQaWps.length - passedQaCount;

  let qaWaitReason: string;
  if (eligibleQaWps.length === 0) {
    qaWaitReason = 'No work packages have qa as an active pipeline stage.';
  } else if (passedQaCount > 0 && waitingForQaPrereqCount === 0) {
    qaWaitReason = `All QA runs complete. ${passedQaCount} work package(s) have PASS qa and are ready for the next stage.`;
  } else if (waitingForQaPrereqCount > 0 && passedQaCount === 0) {
    qaWaitReason = `No work packages ready for QA. ${waitingForQaPrereqCount} work package(s) are waiting for their upstream prerequisite to pass before QA can begin.`;
  } else {
    qaWaitReason = `No new work packages ready for QA. ${passedQaCount} work package(s) have PASS qa; ${waitingForQaPrereqCount} work package(s) are still waiting for their upstream prerequisite.`;
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: qaWaitReason,
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Reviewer.
 * Per-WP priority evaluation from §14.4.
 */
export async function getReviewerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal and BLOCKED statuses
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where code-review is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('code-review')) continue;
    // Skip dependency-blocked WPs
    if (hasDependencyBlocked(wpDetail)) continue;

    // Resolve upstream prerequisite for code-review in this WP's active stages
    const reviewPrerequisite = resolvePrerequisite('code-review', activeStages);

    // Compute active stages before code-review for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const crIdx = orderedActive.indexOf('code-review');
    const upstreamActiveStages = crIdx > 0 ? orderedActive.slice(0, crIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (Reviewer's own rework at MAX, IN_PROGRESS only)
    if (wpDetail.status === 'IN_PROGRESS') {
      const reviewReworkCount = wpDetail.rework_counts?.['code-review'] ?? 0;
      if (reviewReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: reviewReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} code-review has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Reviewer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL (stale code-review pipeline)
    const staleAction = extractStalePipelineAction(wpDetail, 'code-review');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE (active non-stale code-review pipeline)
    if (isActivePipeline(wpDetail, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active code-review pipeline in progress. Continue review work.`,
            next_steps: [
              `1. Complete the current code review for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_REVIEW (re-engagement) — at least one prior review pipeline AND new upstream PASS since then
    const priorReviewPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'code-review' && !p.auto_cancelled
    );
    const hasNewPrereqPassForReview = makeReEngagementCheck(wpDetail.pipelines, reviewPrerequisite, 'code-review');
    if (priorReviewPipelines.length > 0 && hasNewPrereqPassForReview) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last code-review pipeline. Re-run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — code-review FAIL routes back to Reviewer when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      const reviewFailAgent = resolveFailAgent('code-review', activeStages);
      if (reviewFailAgent === 'Reviewer') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_REVIEW',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. Reviewer is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run review.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior code-review FAIL. Re-perform code review.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent code-review is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'code-review')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL code-review pipeline. The fail-target agent must rework before Reviewer can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_REVIEW (first-run) — no prior review pipeline + prerequisite has PASS (or no prerequisite)
    const hasReviewPrereqPass = reviewPrerequisite === null
      ? true
      : wpDetail.pipelines.some(
          (p) => p.type === reviewPrerequisite && p.status === 'PASS' && !p.auto_cancelled
        );
    if (hasReviewPrereqPass && priorReviewPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      const prereqLabel = reviewPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_REVIEW',
            work_package_id: wpDetail.work_package_id,
            reason: reviewPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no code-review pipeline. Run review.`
              : `Work package ${wpDetail.work_package_id} has no prior code-review pipeline and code-review is the first active stage. Run review.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "code-review", agent_role: "Reviewer").`,
              `2. Call ledger_get_work_package to review implementation artifacts and QA results.`,
              '3. Perform code review: architecture, quality, security, maintainability.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "code-review", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP (READY WP assigned to Reviewer)
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Reviewer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Reviewer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Reviewer") to transition to IN_PROGRESS.`,
              `2. Wait for QA pipeline to complete before starting code review.`,
              `3. Call ledger_get_handoff_status (current_agent: "Reviewer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  // Build a specific WAIT reason by categorising the non-terminal, non-blocked WPs
  // that include code-review in their active stages.
  const eligibleWps = wpDetails.filter((wp) => {
    if (isTerminalStatus(wp.status) || wp.status === 'BLOCKED') return false;
    const stages: readonly PipelineType[] =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!stages.includes('code-review')) return false;
    if (hasDependencyBlocked(wp)) return false;
    return true;
  });
  const passedReviewCount = eligibleWps.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS' && !p.auto_cancelled)
  ).length;
  const waitingForPrereqCount = eligibleWps.length - passedReviewCount;

  let waitReason: string;
  if (eligibleWps.length === 0) {
    waitReason = 'No work packages have code-review as an active pipeline stage.';
  } else if (passedReviewCount > 0 && waitingForPrereqCount === 0) {
    waitReason = `All code reviews complete. ${passedReviewCount} work package(s) have PASS code-review and are ready for the next stage.`;
  } else if (waitingForPrereqCount > 0 && passedReviewCount === 0) {
    waitReason = `No work packages ready for review. ${waitingForPrereqCount} work package(s) are waiting for their upstream prerequisite to pass before code-review can begin.`;
  } else {
    waitReason = `No new work packages ready for review. ${passedReviewCount} work package(s) have PASS code-review; ${waitingForPrereqCount} work package(s) are still waiting for their upstream prerequisite.`;
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: waitReason,
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Security Auditor.
 * Mirrors QA action structure — no self-rework on FAIL (bounces back to Developer).
 */
export async function getSecurityAuditorAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('security-audit')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const auditPrerequisite = resolvePrerequisite('security-audit', activeStages);

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const auditReworkCount = wpDetail.rework_counts?.['security-audit'] ?? 0;
      if (auditReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: auditReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} security-audit has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (upstream prerequisite rework at MAX)
    if (auditPrerequisite !== null) {
      const prereqReworkCount = wpDetail.rework_counts?.[auditPrerequisite] ?? 0;
      if (prereqReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${auditPrerequisite} has reached the maximum rework count. Security Auditor cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'security-audit');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active security-audit pipeline in progress. Continue security audit work.`,
            next_steps: [
              `1. Complete the current security audit for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: RUN_SECURITY_AUDIT (re-engagement) — prior audit pipeline AND new upstream PASS since then
    const priorAuditPipelines = wpDetail.pipelines.filter((p) => p.type === 'security-audit' && !p.auto_cancelled);
    const hasNewPrereqPassForAudit = makeReEngagementCheck(wpDetail.pipelines, auditPrerequisite, 'security-audit');
    if (priorAuditPipelines.length > 0 && hasNewPrereqPassForAudit) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last security-audit pipeline. Re-run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P4b: Self-rework fallback (§21.67) — security-audit FAIL routes back to Security Auditor when
    // the standard fail target (Developer) owns a stage not in active_pipeline_stages.
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'security-audit')) {
      const auditFailAgent = resolveFailAgent('security-audit', activeStages);
      if (auditFailAgent === 'Security Auditor') {
        const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'RUN_SECURITY_AUDIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} has a FAIL security-audit pipeline. Security Auditor is the fail-routing target (self-rework) because the standard rework agent's stage is not active. Re-run security audit.`,
              next_steps: [
                `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
                `2. Call ledger_get_work_package to review the FAIL pipeline summary and comments.`,
                '3. Address the issues identified in the prior security-audit FAIL. Re-run security audit.',
                `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
                `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
              ],
              ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
            }, null, 2),
          }],
        };
      }
    }

    // P5: WAIT_FOR_REWORK — most recent security-audit is FAIL, fail target is another agent, no new upstream pass
    if (isMostRecentPipelineFail(wpDetail.pipelines, 'security-audit')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WAIT_FOR_REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL security-audit pipeline. The fail-target agent must address findings before Security Auditor can retry.`,
          }, null, 2),
        }],
      };
    }

    // P6: RUN_SECURITY_AUDIT (first-run) — no prior audit + prerequisite PASS (or no prerequisite)
    const hasAuditPrereqPass = auditPrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === auditPrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasAuditPrereqPass && priorAuditPipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      const prereqLabel = auditPrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_SECURITY_AUDIT',
            work_package_id: wpDetail.work_package_id,
            reason: auditPrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no security-audit pipeline. Run security audit.`
              : `Work package ${wpDetail.work_package_id} has no prior security-audit pipeline and security-audit is the first active stage. Run security audit.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", agent_role: "Security Auditor").`,
              `2. Call ledger_get_work_package to review implementation artifacts and acceptance criteria.`,
              '3. Run security audit: OWASP checks, dependency scan, threat model review.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "security-audit", status: PASS/FAIL, summary, metrics, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Security Auditor') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Security Auditor');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Security Auditor with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Security Auditor") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting the security audit.`,
              `3. Call ledger_get_handoff_status (current_agent: "Security Auditor").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for security audit.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Release Engineer.
 * Self-rework on FAIL (like Documentation). Runs after code-review in extended pipelines.
 */
export async function getReleaseEngineerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]) {
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('release-engineering')) continue;
    if (hasDependencyBlocked(wpDetail)) continue;

    const releasePrerequisite = resolvePrerequisite('release-engineering', activeStages);

    // Compute active upstream stages for P1b
    const orderedActive = getOrderedActiveStages(activeStages);
    const reIdx = orderedActive.indexOf('release-engineering');
    const upstreamActiveStages = reIdx > 0 ? orderedActive.slice(0, reIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT (own rework at MAX)
    if (wpDetail.status === 'IN_PROGRESS') {
      const releaseReworkCount = wpDetail.rework_counts?.['release-engineering'] ?? 0;
      if (releaseReworkCount >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'BLOCK_FOR_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              rework_count: releaseReworkCount,
              max_rework_count: MAX_REWORK_COUNT,
              reason: `Work package ${wpDetail.work_package_id} release-engineering has reached the maximum rework count (${MAX_REWORK_COUNT}). Escalate to Project Manager.`,
            }, null, 2),
          }],
        };
      }
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any active upstream pipeline at MAX)
    for (const upType of upstreamActiveStages) {
      if ((wpDetail.rework_counts?.[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: wpDetail.work_package_id,
              reason: `Work package ${wpDetail.work_package_id} ${upType} has reached the maximum rework count. Release Engineer cannot proceed until the upstream limit is resolved.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL
    const staleAction = extractStalePipelineAction(wpDetail, 'release-engineering');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE
    if (isActivePipeline(wpDetail, 'release-engineering')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has an active release-engineering pipeline in progress. Continue release engineering work.`,
            next_steps: [
              `1. Complete the current release engineering for ${wpDetail.work_package_id}.`,
              `2. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent release-engineering FAIL and no new upstream PASS since
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'release-engineering') &&
      (releasePrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, releasePrerequisite, 'release-engineering'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a FAIL release-engineering pipeline. Investigate and retry.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL release-engineering pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              '3. Fix release engineering issues and re-run.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
          }, null, 2),
        }],
      };
    }

    // P5: RUN_RELEASE_ENGINEERING (re-engagement) — prior pipeline AND new upstream PASS since
    const priorReleasePipelines = wpDetail.pipelines.filter((p) => p.type === 'release-engineering' && !p.auto_cancelled);
    const hasNewPrereqPassForRelease = makeReEngagementCheck(wpDetail.pipelines, releasePrerequisite, 'release-engineering');
    if (priorReleasePipelines.length > 0 && hasNewPrereqPassForRelease) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} has a new ${prereqLabel} PASS since the last release-engineering pipeline. Re-run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P6: RUN_RELEASE_ENGINEERING (first-run) — no prior pipeline + prerequisite PASS (or no prerequisite)
    const hasReleasePrereqPass = releasePrerequisite === null
      ? true
      : wpDetail.pipelines.some((p) => p.type === releasePrerequisite && p.status === 'PASS' && !p.auto_cancelled);
    if (hasReleasePrereqPass && priorReleasePipelines.length === 0) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      const prereqLabel = releasePrerequisite ?? 'prerequisite';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'RUN_RELEASE_ENGINEERING',
            work_package_id: wpDetail.work_package_id,
            reason: releasePrerequisite
              ? `Work package ${wpDetail.work_package_id} has PASS ${prereqLabel} pipeline but no release-engineering pipeline. Run release engineering.`
              : `Work package ${wpDetail.work_package_id} has no prior release-engineering pipeline and release-engineering is the first active stage. Run release engineering.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", agent_role: "Release Engineer").`,
              `2. Call ledger_get_work_package to review artifacts and acceptance criteria.`,
              '3. Run release engineering: build artifact, package, version tagging.',
              `4. Call ledger_complete_pipeline (work_package_id: "${wpDetail.work_package_id}", type: "release-engineering", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP
    if (wpDetail.status === 'READY' && wpDetail.assigned_to === 'Release Engineer') {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Release Engineer');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: wpDetail.work_package_id,
            reason: `Work package ${wpDetail.work_package_id} is READY and assigned to Release Engineer with all dependencies satisfied.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${wpDetail.work_package_id}", agent: "Release Engineer") to transition to IN_PROGRESS.`,
              `2. Wait for the prerequisite pipeline to complete before starting release engineering.`,
              `3. Call ledger_get_handoff_status (current_agent: "Release Engineer").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        action: 'WAIT',
        reason: 'No work packages ready for release engineering.',
      }, null, 2),
    }],
  };
}

/**
 * Get next action for Documentation
 */
export async function getDocumentationAction(
  rootIndex: RootIndex,
  store: LedgerStore,
  preloadedWpDetails?: WorkPackageDetail[]
) {
  // Load all WP details to examine pipeline states (skip if pre-loaded by caller)
  const wpDetails = preloadedWpDetails ?? await Promise.all(
    rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
  );

  for (const wpDetail of wpDetails) {
    // Skip terminal or BLOCKED WPs
    if (isTerminalStatus(wpDetail.status) || wpDetail.status === 'BLOCKED') continue;
    // Only consider WPs where documentation is an active stage
    const activeStages: readonly PipelineType[] =
      (wpDetail.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!activeStages.includes('documentation')) continue;

    const reworkCounts = wpDetail.rework_counts ?? {};
    const id = wpDetail.work_package_id;

    // Resolve upstream prerequisite for documentation in this WP's active stages
    const docPrerequisite = resolvePrerequisite('documentation', activeStages);

    // Compute active stages before documentation for P1b upstream limit checks
    const orderedActive = getOrderedActiveStages(activeStages);
    const docIdx = orderedActive.indexOf('documentation');
    const upstreamActiveStages = docIdx > 0 ? orderedActive.slice(0, docIdx) : [];

    // P1: BLOCK_FOR_REWORK_LIMIT — documentation rework count at max
    if ((reworkCounts['documentation'] ?? 0) >= MAX_REWORK_COUNT) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'BLOCK_FOR_REWORK_LIMIT',
            work_package_id: id,
            reason: `Work package ${id} has reached the documentation rework limit (${MAX_REWORK_COUNT}). Escalate to PM to unblock.`,
          }, null, 2),
        }],
      };
    }

    // P1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT — any active upstream pipeline at max
    for (const upType of upstreamActiveStages) {
      if ((reworkCounts[upType] ?? 0) >= MAX_REWORK_COUNT) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'WAIT_FOR_UPSTREAM_REWORK_LIMIT',
              work_package_id: id,
              reason: `Work package ${id} has upstream ${upType} rework count at the limit. Waiting for PM to resolve blocker.`,
            }, null, 2),
          }],
        };
      }
    }

    // P2: RESUME_OR_CANCEL — stale IN_PROGRESS documentation pipeline
    const staleAction = extractStalePipelineAction(wpDetail, 'documentation');
    if (staleAction) return staleAction;

    // P3: CONTINUE_PIPELINE — active non-stale documentation pipeline
    if (isActivePipeline(wpDetail, 'documentation')) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CONTINUE_PIPELINE',
            work_package_id: id,
            reason: `Work package ${id} has an active documentation pipeline in progress. Continue working on it.`,
          }, null, 2),
        }],
      };
    }

    // P4: REWORK (self) — most recent documentation pipeline is FAIL and no new upstream PASS since
    // If a new upstream PASS has appeared after the doc failure, fall through to P6 (WRITE_DOCS) for a fresh run.
    if (
      isMostRecentPipelineFail(wpDetail.pipelines, 'documentation') &&
      (docPrerequisite === null || !hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation'))
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'REWORK',
            work_package_id: id,
            reason: `Work package ${id} has a FAIL documentation pipeline. Investigate and retry documentation.`,
            next_steps: [
              `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
              `2. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              '3. Fix documentation issues, update affected files.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }

    // Freshness helpers for P5 / P5b
    // "Fresh" means: the most recent doc PASS was completed after the first active stage's last start
    const firstStagePipelines = wpDetail.pipelines.filter(
      (p) => p.type === firstActiveStage(activeStages) && !p.auto_cancelled
    );
    const latestFirstStage = firstStagePipelines.at(-1);
    const latestFirstStageStart = latestFirstStage?.started_at;

    const docPassPipelines = wpDetail.pipelines.filter(
      (p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled
    );
    const latestDocPass = docPassPipelines.at(-1);

    const isFresh =
      latestFirstStageStart &&
      latestDocPass?.completed_at &&
      parseTimestamp(latestDocPass.completed_at).getTime() >=
        parseTimestamp(latestFirstStageStart).getTime();

    if (latestDocPass && isFresh) {
      const allCriteriaMet =
        wpDetail.acceptance_criteria.length > 0 &&
        wpDetail.acceptance_criteria.every((c) => c.met === true);

      // P5: FINALIZE_WP — doc PASS, fresh, all criteria met
      if (allCriteriaMet) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'FINALIZE_WP',
              work_package_id: id,
              reason: `All criteria met; freshness passed — ready to mark COMPLETE.`,
              next_steps: [
                `1. Call ledger_update_work_package_status (work_package_id: "${id}", status: "COMPLETE", agent: "Documentation").`,
                `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
              ],
            }, null, 2),
          }],
        };
      }

      // P5b: UPDATE_CRITERIA — doc PASS, fresh, criteria not fully met
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'UPDATE_CRITERIA',
            work_package_id: id,
            reason: `Documentation passed; update acceptance criteria before marking COMPLETE.`,
            next_steps: [
              `1. Call ledger_complete_pipeline or ledger_add_observation to update acceptance_criteria_updates.`,
              `2. Once all criteria are met, call ledger_update_work_package_status to mark COMPLETE.`,
            ],
          }, null, 2),
        }],
      };
    }

    // P6: WRITE_DOCS — upstream prerequisite PASS available, no fresh doc pipeline
    const hasDocPrereqPass = docPrerequisite === null
      ? true
      : hasNewUpstreamPassSince(wpDetail.pipelines, docPrerequisite, 'documentation');
    if (hasDocPrereqPass) {
      const handoffNotes = getHandoffNotesForAgent(wpDetail, 'Documentation');
      const prereqLabel = docPrerequisite ?? 'prior stage';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'WRITE_DOCS',
            work_package_id: id,
            reason: docPrerequisite
              ? `Work package ${id} has PASS ${prereqLabel} pipeline. Write or update documentation.`
              : `Work package ${id} has no prior documentation pipeline and documentation is the first active stage. Write documentation.`,
            next_steps: [
              `1. Call ledger_begin_work (work_package_id: "${id}", type: "documentation", agent_role: "Documentation").`,
              `2. Call ledger_get_work_package to review implementation artifacts and review comments.`,
              '3. Update documentation, README files, and inline docs as needed.',
              `4. Call ledger_complete_pipeline (work_package_id: "${id}", type: "documentation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
              `5. Call ledger_get_handoff_status (current_agent: "Documentation").`,
            ],
            ...(handoffNotes ? { handoff_notes: handoffNotes } : {}),
          }, null, 2),
        }],
      };
    }

    // P7: CLAIM_WP — READY WP assigned to Documentation with dependencies satisfied
    if (
      wpDetail.status === 'READY' &&
      wpDetail.assigned_to === 'Documentation' &&
      canStartWorkPackage(wpDetail, rootIndex.work_packages)
    ) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'CLAIM_WP',
            work_package_id: id,
            reason: `Work package ${id} is READY and assigned to Documentation. Claim it to begin work.`,
            next_steps: [
              `1. Call ledger_claim_work_package (work_package_id: "${id}", agent: "Documentation").`,
            ],
          }, null, 2),
        }],
      };
    }
  }

  // Build a specific WAIT reason by categorising the non-terminal, non-blocked WPs
  // that include documentation in their active stages.
  const eligibleDocWps = wpDetails.filter((wp) => {
    if (isTerminalStatus(wp.status) || wp.status === 'BLOCKED') return false;
    const stages: readonly PipelineType[] =
      (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
    if (!stages.includes('documentation')) return false;
    return true;
  });
  const passedDocCount = eligibleDocWps.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled)
  ).length;
  const waitingForDocPrereqCount = eligibleDocWps.length - passedDocCount;

  let docWaitReason: string;
  if (eligibleDocWps.length === 0) {
    docWaitReason = 'No work packages have documentation as an active pipeline stage.';
  } else if (passedDocCount > 0 && waitingForDocPrereqCount === 0) {
    docWaitReason = `All documentation runs complete. ${passedDocCount} work package(s) have PASS documentation and are ready for finalization.`;
  } else if (waitingForDocPrereqCount > 0 && passedDocCount === 0) {
    docWaitReason = `No work packages ready for documentation. ${waitingForDocPrereqCount} work package(s) are waiting for their upstream prerequisite to pass before documentation can begin.`;
  } else {
    docWaitReason = `No new work packages ready for documentation. ${passedDocCount} work package(s) have PASS documentation; ${waitingForDocPrereqCount} work package(s) are still waiting for their upstream prerequisite.`;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { action: 'WAIT', reason: docWaitReason },
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
/** @internal — exported for unit tests only */
export const _internal = { getNextAction, buildBatchNextSteps, getNextActionsCollector, embedHandoffStatusInWait, getSecurityAuditorAction, getReleaseEngineerAction };

export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_next_action',
    {
      description: 'Get the next recommended action for your agent role. REQUIRED params: agent_role. OPTIONAL: max_results (default: 1). When max_results is 1 (default), returns a single action object. When max_results > 1, returns an array of up to that many actions under the "actions" key. Call this to determine what to do next. Returns an action type and reason based on current work package and pipeline states. Use cwd_path (workspace root) for auto-detection, or project_path if already known.',
      inputSchema: GetNextActionSchema,
    },
    getNextAction as any
  );
}

```
```
// Structure of documents
└── mcp-server/
    └── src/
        └── tools/
            └── workflow-next-action-batch.ts

```
###  Path: `/mcp-server/src/tools/workflow-next-action-batch.ts`

```ts
/**
 * Batch/collector logic and WAIT-embedding utility for ledger_get_next_action.
 *
 * Extracted from workflow-next-action.ts to keep the main file focused on
 * per-role single-action logic. This module owns:
 *   - embedHandoffStatusInWait  — embeds handoff_status into WAIT responses
 *   - buildBatchNextSteps       — builds next_steps arrays for batch responses
 *   - getNextActionsCollector   — collects up to N actions for a given agent role
 */

import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { type AgentRole } from '../utils/constants.js';
import {
  AGENT_PIPELINE_MAP,
  PIPELINE_PREREQUISITES,
  type PostImplPipelineType,
} from '../utils/pipeline-maps.js';
import { parseTimestamp } from '../utils/timestamp.js';
import {
  isMostRecentPipelineFail,
  hasDependencyBlocked,
  getHandoffNotesForAgent,
  isStalePipeline,
  agentNameMap,
  actionNameMap,
  reworkActionMap,
} from '../utils/workflow-helpers.js';
import { PIPELINE_AGENT_MAP } from '../utils/pipeline-maps.js';
import { computeHandoffStatus } from './workflow-handoff.js';

/**
 * Post-processes a single-action MCP result: if payload.action === "WAIT",
 * computes handoff_status via computeHandoffStatus and embeds it as a top-level key.
 * Non-WAIT responses and empty projectPath values are returned unchanged.
 * On handoff computation failure, embeds handoff_status_error instead.
 *
 * When `opts.store`, `opts.rootIndex`, and `opts.wpDetails` are all provided, they
 * are forwarded to `computeHandoffStatus` to avoid redundant disk reads — the handoff
 * computation reuses the already-loaded data instead of creating a new LedgerStore.
 *
 * If the embedded handoff_status contains an `auto_handoff` entry, the action is
 * promoted from `WAIT` to `INVOKE_AGENT` — the current agent's work is complete and
 * it should immediately invoke the next agent using `auto_handoff.prompt`.
 * @internal — exposed via _internal for unit tests
 */
export async function embedHandoffStatusInWait(
  mcpResult: { content: Array<{ type: string; text: string }> },
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const text = mcpResult.content[0]?.text;
  if (!text || !projectPath) return mcpResult;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return mcpResult;
  }

  if (payload['action'] !== 'WAIT') return mcpResult;

  try {
    payload['handoff_status'] = await computeHandoffStatus(projectPath, agentRole, opts);
  } catch (err) {
    payload['handoff_status_error'] = (err as Error).message;
  }

  // Promote WAIT → INVOKE_AGENT when the handoff includes an auto_handoff entry.
  // WAIT means "genuinely blocked/waiting"; INVOKE_AGENT means "work complete — invoke next agent now".
  const hs = payload['handoff_status'] as Record<string, unknown> | undefined;
  if (hs?.['auto_handoff'] !== undefined) {
    payload['action'] = 'INVOKE_AGENT';
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build `next_steps` guidance for a batch action entry.
 * Mirrors the step-by-step tool-call instructions from getNextAction's singular helpers,
 * but in compact array form suitable for batch responses.
 * @internal — exported for unit tests only (via _internal)
 */
export function buildBatchNextSteps(
  action: string,
  wpId: string,
  pipelineType: string,
  wpStatus?: string,
  failedPipelineType?: string,
): string[] {
  const agentRole = PIPELINE_AGENT_MAP[pipelineType as keyof typeof PIPELINE_AGENT_MAP] ?? pipelineType;

  switch (action) {
    case 'IMPLEMENT': {
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer")${wpStatus === 'READY' ? ' to claim and start the pipeline in one step' : ' \u2014 WP is already IN_PROGRESS, starts pipeline directly'}.`,
        '2. Read the WP spec, implement the changes, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'REWORK': {
      // Developer rework: failedPipelineType identifies which downstream pipeline failed
      if (failedPipelineType && failedPipelineType !== 'implementation') {
        return [
          `1. Call ledger_get_work_package to review the FAIL ${failedPipelineType} pipeline comments/summary.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer").`,
          '3. Fix the issues identified by the failed pipeline, run tests.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
          `5. Call ledger_get_handoff_status (current_agent: "Developer").`,
        ];
      }
      // Documentation self-rework or Developer implementation rework
      if (pipelineType === 'documentation') {
        return [
          `1. Call ledger_get_work_package to review the previous FAIL documentation pipeline summary and comments.`,
          `2. Call ledger_begin_work (work_package_id: "${wpId}", type: "documentation", agent_role: "Documentation").`,
          '3. Fix documentation issues, update affected files.',
          `4. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
          `5. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
          `6. Call ledger_get_handoff_status (current_agent: "Documentation").`,
        ];
      }
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "implementation", agent_role: "Developer") \u2014 WP is already IN_PROGRESS, starts pipeline directly.`,
        '2. Review the previous FAIL pipeline summary, fix the issues, run tests.',
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "implementation", status: PASS/FAIL, summary, artifacts, comments, acceptance_criteria_updates).`,
        `4. Call ledger_get_handoff_status (current_agent: "Developer").`,
      ];
    }
    case 'RUN_QA':
    case 'RUN_REVIEW':
    case 'WRITE_DOCS': {
      const steps = [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
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
    case 'WAIT_FOR_REWORK':
      return [
        `WP ${wpId}: Waiting for Developer to rework implementation. QA/Reviewer does not self-rework.`,
        `Check ledger_get_next_action for Developer to confirm rework has started.`,
      ];
    case 'WAIT_FOR_DOWNSTREAM':
      return [
        `WP ${wpId}: Implementation pipeline PASS. Waiting for downstream QA/Reviewer pipeline to complete.`,
        `No action required — hand off to QA agent.`,
      ];
    case 'BLOCK_FOR_REWORK_LIMIT':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the rework history.`,
        `2. Escalate to the Project Manager to resolve the rework-limit blocker.`,
        `3. Consider calling ledger_update_work_package_status (work_package_id: "${wpId}", status: "CANCELLED") and creating a replacement WP.`,
      ];
    case 'WAIT_FOR_UPSTREAM_REWORK_LIMIT':
      return [
        `WP ${wpId}: An upstream pipeline has reached the rework limit. Waiting for PM to resolve the blocker.`,
        `No action required — PM must intervene before this pipeline can proceed.`,
      ];
    case 'UNBLOCK_WP':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the blocked state.`,
        `2. Resolve the blocking condition (dependency, decision, or external factor).`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to unblock.`,
      ];
    case 'REVIEW_ABANDONED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to review the abandoned pipeline.`,
        `2. Cancel the abandoned pipeline or escalate to PM.`,
        `3. Create a replacement WP if the work is still needed.`,
      ];
    case 'REPAIR_ORPHAN_BLOCKED':
      return [
        `1. Call ledger_get_work_package (work_package_id: "${wpId}") to inspect the orphan-BLOCKED state.`,
        `2. Verify all dependency WPs are COMPLETE.`,
        `3. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "READY") to repair.`,
      ];
    case 'FINALIZE_WP':
      return [
        `1. Call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `2. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'UPDATE_CRITERIA':
      return [
        `1. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "documentation", ..., acceptance_criteria_updates: [...]) to mark all criteria as met.`,
        `2. Then call ledger_update_work_package_status (work_package_id: "${wpId}", status: "COMPLETE", agent: "Documentation").`,
        `3. Call ledger_get_handoff_status (current_agent: "Documentation").`,
      ];
    case 'CLAIM_WP':
      return [
        `1. Call ledger_begin_work (work_package_id: "${wpId}", type: "${pipelineType}", agent_role: "${agentRole}").`,
        `2. Perform your pipeline work.`,
        `3. Call ledger_complete_pipeline (work_package_id: "${wpId}", type: "${pipelineType}", status: PASS/FAIL, summary, comments, acceptance_criteria_updates).`,
      ];
    default:
      return [];
  }
}

/**
 * Collect up to `limit` actionable items for an agent role.
 * Uses the same per-WP evaluation logic as the singular getXxxAction helpers,
 * but without the early-return pattern — results are collected into an array.
 * Only used when max_results > 1 is passed to ledger_get_next_action.
 */
export async function getNextActionsCollector(
  rootIndex: RootIndex,
  store: LedgerStore,
  agentRole: AgentRole,
  limit: number
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const pipelineType = AGENT_PIPELINE_MAP[agentRole];
  if (!pipelineType) {
    // Planner, Synthesis, Project Manager — batch not meaningful
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { actions: [], reason: `Batch actions not applicable for role: ${agentRole}` },
            null,
            2
          ),
        },
      ],
    };
  }

  const actions: object[] = [];
  // Prerequisite type for this agent's pipeline
  const prerequisite = PIPELINE_PREREQUISITES[pipelineType];

  for (const wp of rootIndex.work_packages) {
    if (actions.length >= limit) break;

    const wpDetail = await store.readWorkPackage(wp.work_package_id);

    // Skip stale pipelines (RESUME_OR_CANCEL handling)
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
      continue;
    }

    // For implementation: look for READY/IN_PROGRESS WPs with no implementation pipeline yet
    if (pipelineType === 'implementation') {
      if (
        (wpDetail.status === 'READY' || wpDetail.status === 'IN_PROGRESS') &&
        !hasDependencyBlocked(wpDetail) &&
        !wpDetail.pipelines.some((p) => p.type === 'implementation' && !p.auto_cancelled)
      ) {
        const handoffNotes = wpDetail.assigned_to === 'Developer'
          ? (getHandoffNotesForAgent(wpDetail, 'Developer') ?? undefined)
          : undefined;
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
            break;
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

    // BLOCKED WPs: skip rework suggestion to avoid infinite-loop signals.
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
}

```