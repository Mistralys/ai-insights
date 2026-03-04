import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { RootIndex } from '../schema/root-index.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { resolveProjectPath, mutuallyExclusivePaths, MUTUAL_EXCLUSIVITY_PATH_MSG } from '../utils/path-validator.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import { isRegistryLoaded, getAgentHandle, getAgentId } from '../utils/agent-registry.js';
import { now } from '../utils/timestamp.js';
import {
  buildHandoffPrompt,
  isBlockedByDependencies,
  isMostRecentPipelineFail,
  effectiveMaxDepth,
  hasDownstreamReengagedSince,
  hasNewUpstreamPassSince,
} from '../utils/workflow-helpers.js';
import { getConfig } from '../gui/config.js';
import { isTerminalStatus } from '../schema/validators.js';

/**
 * Tool: get_handoff_status
 *
 * Reads root index and examines all WP statuses and pipelines to compute
 * the correct AGENT: and STATUS: handoff block for the current agent.
 */
const GetHandoffStatusSchema = z.object({
  project_path: z.string().optional().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  cwd_path: z.string().optional().describe('Workspace root path — alternative to project_path for automatic project detection.'),
  current_agent: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"'
    ),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });

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

    // Agent-specific handoff logic
    switch (args.current_agent) {
      case 'Planner':
        return getPlannerHandoff(wpDetails, projectPath, store);
      case 'Project Manager':
        return getProjectManagerHandoff(wpDetails, projectPath, store);
      case 'Developer':
        return getDeveloperHandoff(wpDetails, projectPath, store);
      case 'QA':
        return getQaHandoff(wpDetails, projectPath, store);
      case 'Reviewer':
        return getReviewerHandoff(wpDetails, projectPath, store);
      case 'Documentation':
        return getDocumentationHandoff(wpDetails, projectPath, store);
      case 'Synthesis':
        return buildHandoffResponse(
          args.current_agent,
          'COMPLETE',
          'Synthesis complete.',
          'Call ledger_get_next_action first to check if synthesis work is pending before generating your report.',
          projectPath,
          store
        );
      default:
        return buildHandoffResponse(args.current_agent, 'IN_PROGRESS', 'Work in progress.', undefined, projectPath, store);
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
    READY_FOR_PM: 'Project Manager',
    BLOCKED: 'Project Manager',
  };
  if (status === 'IN_PROGRESS') return currentAgent;
  if (isTerminalStatus(status)) return null;
  return map[status] ?? null;
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
          payload.auto_handoff = {
            agent_name: agentName,
            ...(agentId !== null ? { agent_id: agentId } : {}),
            prompt: buildHandoffPrompt(projectPath, agentId ?? undefined),
          };
        } else {
          // §18.5: Depth limit reached — emit a project comment so PM has a diagnostic breadcrumb.
          const updated = { ...root, last_updated: now() };
          updated.project_comments = [
            ...root.project_comments,
            {
              type: 'warning',
              priority: 'high',
              timestamp: now(),
              agent: 'System',
              note: 'Auto-handoff depth limit reached. Manual routing required.',
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
  switch (assignedTo) {
    case 'Developer': return 'READY_FOR_DEVELOPER';
    case 'QA': return 'READY_FOR_QA';
    case 'Reviewer': return 'READY_FOR_REVIEW';
    case 'Documentation': return 'READY_FOR_DOCUMENTATION';
    default: return 'READY_FOR_DEVELOPER';
  }
}

/**
 * Get handoff status for Project Manager (§5.5)
 *
 * Priority-ordered algorithm:
 * 1. Non-dependency blockers (decision/external/technical) → IN_PROGRESS (PM must act)
 * 2. READY WPs → route to assigned agent via readyStatusForAgent
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
  for (const wp of wpDetails) {
    if (wp.status === 'READY') {
      const status = readyStatusForAgent(wp.assigned_to ?? null);
      return buildHandoffResponse(
        'Project Manager',
        status,
        `Work package ${wp.work_package_id} is READY and assigned to ${wp.assigned_to ?? 'Developer (default)'}. Routing to the appropriate agent.`,
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

  // Step 1 of §5.1: Temporal-guarded FAIL check.
  // Fire IN_PROGRESS only when a downstream agent has ALREADY started work after our
  // most recent implementation PASS. This prevents false rework loops: if Developer
  // has re-delivered (impl-2 PASS) but QA has not yet started, hasDownstreamReengagedSince
  // returns false and we fall through to READY_FOR_QA instead of re-triggering rework.
  const activeWps = wpDetails.filter(
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

  // Only consider non-BLOCKED WPs for the remaining implementation progress checks.
  // BLOCKED WPs have no implementation pipeline yet (they're waiting on dependencies)
  // and must not be counted as "needing work" by the Developer right now.
  const nonBlockedWps = wpDetails.filter((wp) => wp.status !== 'BLOCKED');

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

  // Step 1 of §5.2: Re-engagement check — MUST precede FAIL short-circuit.
  // If QA FAIL exists AND Developer has since re-delivered a PASS implementation,
  // QA must re-engage (IN_PROGRESS) rather than routing back to READY_FOR_DEVELOPER.
  for (const wp of wpDetails) {
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
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsStillNeedingImpl.filter((wp) =>
        isBlockedByDependencies(wp)
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
  // Distinguish between "needs new QA" / "QA IN_PROGRESS" (→ IN_PROGRESS)
  // and "only FAILs remain" (→ READY_FOR_DEVELOPER, Developer must rework first).
  const wpsNeedingNewQa = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      !wp.pipelines.some((p) => p.type === 'qa')
  );
  const wpsWithQaInProgress = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'IN_PROGRESS')
  );
  const wpsWithQaFail = wpsWithImpl.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      isMostRecentPipelineFail(wp.pipelines, 'qa')
  );

  if (wpsNeedingNewQa.length > 0 || wpsWithQaInProgress.length > 0) {
    // QA agent still has actionable work (new QA or in-progress QA)
    const wpsNeedingWork = [...wpsNeedingNewQa, ...wpsWithQaInProgress];

    return buildHandoffResponse(
      'QA',
      'IN_PROGRESS',
      `QA work in progress. ${wpsNeedingWork.length} work package(s) still need QA.`,
      `Call ledger_get_next_action with agent_role: "QA" to find the next work package to validate. Continue working until all WPs have PASS qa pipelines.`,
      projectPath,
      store
    );
  }

  if (wpsWithQaFail.length > 0) {
    // All QA work is done but some FAILed — Developer must rework before QA can retry
    return buildHandoffResponse(
      'QA',
      'READY_FOR_DEVELOPER',
      `QA complete but ${wpsWithQaFail.length} work package(s) have FAIL QA pipelines: ${wpsWithQaFail.map((wp) => wp.work_package_id).join(', ')}. Developer must rework before QA can retry.`,
      undefined,
      projectPath,
      store
    );
  }

  // All implemented WPs have QA but some WPs still need implementation
  if (wpsStillNeedingImpl.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsStillNeedingImpl.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsStillNeedingImpl.filter((wp) =>
      isBlockedByDependencies(wp)
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

  // Step 1 of §5.3: Re-engagement check — MUST precede FAIL short-circuit.
  // If code-review FAIL exists AND QA has since re-passed, Reviewer must re-engage.
  for (const wp of wpDetails) {
    if (
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      isMostRecentPipelineFail(wp.pipelines, 'code-review') &&
      hasNewUpstreamPassSince(wp.pipelines, 'qa', 'code-review')
    ) {
      return buildHandoffResponse(
        'Reviewer',
        'IN_PROGRESS',
        `Reviewer re-engagement required: ${wp.work_package_id} has a code-review FAIL but QA has since re-passed. Reviewer must re-evaluate.`,
        `Call ledger_get_next_action with agent_role: "Reviewer" to find the work package to re-review.`,
        projectPath,
        store
      );
    }
  }

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
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsNotYetQaPassed.filter((wp) =>
        isBlockedByDependencies(wp)
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
  // Distinguish between "needs new review" / "review IN_PROGRESS" (→ IN_PROGRESS)
  // and "only FAILs remain" (→ READY_FOR_DEVELOPER, Developer must rework first).
  const wpsNeedingNewReview = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      !wp.pipelines.some((p) => p.type === 'code-review')
  );
  const wpsWithReviewInProgress = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'IN_PROGRESS')
  );
  const wpsWithReviewFail = wpsWithQa.filter(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      isMostRecentPipelineFail(wp.pipelines, 'code-review')
  );

  if (wpsNeedingNewReview.length > 0 || wpsWithReviewInProgress.length > 0) {
    // Reviewer still has actionable work
    const wpsNeedingWork = [...wpsNeedingNewReview, ...wpsWithReviewInProgress];

    return buildHandoffResponse(
      'Reviewer',
      'IN_PROGRESS',
      `Review work in progress. ${wpsNeedingWork.length} work package(s) still need review.`,
      `Call ledger_get_next_action with agent_role: "Reviewer" to find the next work package to review. Continue working until all WPs have PASS code-review pipelines.`,
      projectPath,
      store
    );
  }

  if (wpsWithReviewFail.length > 0) {
    // All review work is done but some FAILed — Developer must rework before Reviewer can retry
    return buildHandoffResponse(
      'Reviewer',
      'READY_FOR_DEVELOPER',
      `Review complete but ${wpsWithReviewFail.length} work package(s) have FAIL code-review pipelines: ${wpsWithReviewFail.map((wp) => wp.work_package_id).join(', ')}. Developer must rework before Reviewer can retry.`,
      undefined,
      projectPath,
      store
    );
  }

  // All reviewed WPs are done but some haven't reached QA yet
  if (wpsNotYetQaPassed.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsNotYetQaPassed.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsNotYetQaPassed.filter((wp) =>
      isBlockedByDependencies(wp)
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
 * Get handoff status for Documentation (§5.4)
 *
 * Priority order per §14.5: ready-for-docs (new work or re-engagement via
 * hasNewUpstreamPassSince) comes BEFORE FAIL self-rework. This is the opposite
 * of the recommendation engine priority and is intentional for handoff routing.
 */
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  const wpsWithReview = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  const wpsNotYetReviewed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  // Step 1 of §5.4: Ready-for-docs check — new documentation OR re-engagement.
  // Per §14.5: this step comes BEFORE FAIL self-rework in handoff priority.
  // Uses hasNewUpstreamPassSince to detect re-engagement: a new code-review PASS
  // after the most recent documentation run means docs must be re-run.
  const readyForDocsList = wpsWithReview.filter(
    (wp) =>
      !isTerminalStatus(wp.status) &&
      !isBlockedByDependencies(wp) &&
      (
        !wp.pipelines.some((p) => p.type === 'documentation') ||
        hasNewUpstreamPassSince(wp.pipelines, 'code-review', 'documentation')
      )
  );
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

  // Step 2 of §5.4: FAIL → Documentation self-rework.
  // Documentation self-corrects on FAIL rather than routing back upstream.
  const wpsWithDocFail = wpsWithReview.filter(
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

  // Check if all reviewed WPs have PASS documentation
  const allDocsPassed = wpsWithReview.every((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS')
  );

  if (allDocsPassed && wpsWithReview.length > 0) {
    // If there are still WPs that haven't been reviewed, earlier stages need to catch up
    if (wpsNotYetReviewed.length > 0) {
      // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
      const readyWps = wpsNotYetReviewed.filter(
        (wp) => !isBlockedByDependencies(wp)
      );
      const blockedWps = wpsNotYetReviewed.filter((wp) =>
        isBlockedByDependencies(wp)
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

  // All documented WPs are done but some haven't reached review yet
  if (wpsNotYetReviewed.length > 0) {
    // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
    const readyWps = wpsNotYetReviewed.filter(
      (wp) => !isBlockedByDependencies(wp)
    );
    const blockedWps = wpsNotYetReviewed.filter((wp) =>
      isBlockedByDependencies(wp)
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
      switch (agentRole) {
        case 'Planner':
          mcpResult = await getPlannerHandoff(wpDetails, projectPath, s);
          break;
        case 'Project Manager':
          mcpResult = await getProjectManagerHandoff(wpDetails, projectPath, s);
          break;
        case 'Developer':
          mcpResult = await getDeveloperHandoff(wpDetails, projectPath, s);
          break;
        case 'QA':
          mcpResult = await getQaHandoff(wpDetails, projectPath, s);
          break;
        case 'Reviewer':
          mcpResult = await getReviewerHandoff(wpDetails, projectPath, s);
          break;
        case 'Documentation':
          mcpResult = await getDocumentationHandoff(wpDetails, projectPath, s);
          break;
        case 'Synthesis':
          mcpResult = await buildHandoffResponse(
            agentRole,
            'COMPLETE',
            'Synthesis complete.',
            'Call ledger_get_next_action first to check if synthesis work is pending before generating your report.',
            projectPath,
            s
          );
          break;
        default:
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
      description: 'Get the handoff status to determine if your work is done and which agent should work next. REQUIRED params: project_path, current_agent. Call this after completing your pipelines to check if work should be handed to the next agent in the workflow.',
      inputSchema: GetHandoffStatusSchema,
    },
    getHandoffStatus as any
  );
}
