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
 * Mixed-routing safety rule (audit 2026-04-29): if the `ready` set contains WPs
 * routing to two or more distinct next agents (e.g., a project mixing
 * `[..., code-review, documentation]` with `[..., code-review, release-engineering, documentation]`),
 * `nextStatus` is returned as `null` so the caller falls through to WAIT. The
 * orchestrator's per-agent `ledger_get_next_action` ticks then dispatch each WP
 * individually. Emitting a single `next_agent` for a heterogeneous set would
 * misroute the WPs that don't match.
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

  // Mixed-routing guard: collect the set of distinct next agents across all ready WPs.
  const nextAgents = new Set(
    ready.map((wp) => {
      const activeStages =
        (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
      return resolveNextAgent(currentStage, activeStages);
    }),
  );

  // Only emit a single READY_FOR_* status when ALL ready WPs route to the same next agent.
  // If the set is heterogeneous, return null → caller falls through to WAIT.
  const nextStatus =
    nextAgents.size === 1
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
    if (nextStatus !== null) {
      const nextAgentName = resolveNextAgent(
        'qa',
        (ready[0]!.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES
      );
      return buildHandoffResponse(
        'QA',
        nextStatus,
        `${ready.length} work package(s) have PASS QA and are ready for ${nextAgentName}.`,
        undefined,
        projectPath,
        store
      );
    }
    // Mixed-routing: multiple distinct next agents across ready WPs — defer to orchestrator.
    const nextAgents = new Set(
      ready.map((wp) =>
        resolveNextAgent('qa', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES)
      )
    );
    return buildHandoffResponse(
      'QA',
      'WAIT',
      `${ready.length} WPs ready for next stage but route to multiple agents (${[...nextAgents].join(', ')}). Per-agent ledger_get_next_action ticks will dispatch each WP individually.`,
      undefined,
      projectPath,
      store
    );
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
    if (nextStatus !== null) {
      const nextAgentName = resolveNextAgent(
        'security-audit',
        (ready[0]!.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES
      );
      return buildHandoffResponse(
        'Security Auditor',
        nextStatus,
        `${ready.length} work package(s) passed security audit and are ready for ${nextAgentName}.`,
        undefined,
        projectPath,
        store
      );
    }
    // Mixed-routing: multiple distinct next agents — defer to orchestrator.
    const nextAgents = new Set(
      ready.map((wp) =>
        resolveNextAgent('security-audit', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES)
      )
    );
    return buildHandoffResponse(
      'Security Auditor',
      'WAIT',
      `${ready.length} WPs ready for next stage but route to multiple agents (${[...nextAgents].join(', ')}). Per-agent ledger_get_next_action ticks will dispatch each WP individually.`,
      undefined,
      projectPath,
      store
    );
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
    if (nextStatus !== null) {
      const nextAgentName = resolveNextAgent(
        'code-review',
        (ready[0]!.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES,
      );
      return buildHandoffResponse(
        'Reviewer',
        nextStatus,
        `${ready.length} work package(s) have PASS code-review and are ready for ${nextAgentName}.`,
        undefined,
        projectPath,
        store
      );
    }
    // Mixed-routing: multiple distinct next agents across ready WPs — defer to orchestrator.
    const nextAgents = new Set(
      ready.map((wp) => resolveNextAgent('code-review', (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES))
    );
    return buildHandoffResponse(
      'Reviewer',
      'WAIT',
      `${ready.length} WPs ready for next stage but route to multiple agents (${[...nextAgents].join(', ')}). Per-agent ledger_get_next_action ticks will dispatch each WP individually.`,
      undefined,
      projectPath,
      store
    );
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
