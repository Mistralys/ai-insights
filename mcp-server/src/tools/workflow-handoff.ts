import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LedgerStore } from '../storage/ledger-store.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { validatePlanPathOrError } from '../utils/path-validator.js';
import { AGENT_ROLES, type AgentRole } from '../utils/constants.js';
import { isRegistryLoaded, getAgentHandle } from '../utils/agent-registry.js';
import { now } from '../utils/timestamp.js';
import {
  getMaxHandoffDepth,
  buildHandoffPrompt,
  isBlockedByDependencies,
} from '../utils/workflow-helpers.js';
import { getConfig } from '../gui/config.js';

/**
 * Tool: get_handoff_status
 *
 * Reads root index and examines all WP statuses and pipelines to compute
 * the correct AGENT: and STATUS: handoff block for the current agent.
 */
const GetHandoffStatusSchema = z.object({
  project_path: z.string().describe('Absolute path to the plan directory (e.g., "f:\\project\\docs\\agents\\plans\\2026-02-16-feature")'),
  current_agent: z
    .string()
    .describe(
      'REQUIRED. Your agent role, exactly one of: "Planner", "Project Manager", "Developer", "QA", "Reviewer", "Documentation", "Synthesis"'
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

    // Check for BLOCKED work packages, but only report BLOCKED if there's truly nothing that can be worked on
    const blockedWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'BLOCKED'
    );
    const completeWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'COMPLETE'
    );
    const readyOrInProgressWps = rootIndex.work_packages.filter(
      (wp) => wp.status === 'READY' || wp.status === 'IN_PROGRESS'
    );

    // Only report BLOCKED if ALL WPs are blocked (no READY/IN_PROGRESS, no COMPLETE).
    // If any WPs are COMPLETE, downstream agents (QA, Reviewer, Documentation) can still process them,
    // so let agent-specific logic determine the appropriate handoff.
    if (blockedWps.length > 0 && readyOrInProgressWps.length === 0 && completeWps.length === 0) {
      return buildHandoffResponse(
        args.current_agent,
        'BLOCKED',
        `All work packages are BLOCKED: ${blockedWps.map((wp) => wp.work_package_id).join(', ')}. Resolution required before proceeding.`,
        undefined,
        args.project_path,
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
      case 'Project Manager':
        return getProjectManagerHandoff(wpDetails, args.project_path, store);
      case 'Developer':
        return getDeveloperHandoff(wpDetails, args.project_path, store);
      case 'QA':
        return getQaHandoff(wpDetails, args.project_path, store);
      case 'Reviewer':
        return getReviewerHandoff(wpDetails, args.project_path, store);
      case 'Documentation':
        return getDocumentationHandoff(wpDetails, args.project_path, store);
      case 'Synthesis':
        return buildHandoffResponse(args.current_agent, 'COMPLETE', 'Synthesis complete.', undefined, args.project_path, store);
      default:
        return buildHandoffResponse(args.current_agent, 'IN_PROGRESS', 'Work in progress.', undefined, args.project_path, store);
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
    BLOCKED: 'Project Manager',
  };
  if (status === 'IN_PROGRESS') return currentAgent;
  if (status === 'COMPLETE') return null;
  return map[status] ?? null;
}

/** Build a standard handoff response payload with current_agent, next_agent, and status.
 *
 * When `projectPath` and `store` are provided, this function will also attempt to include
 * an `auto_handoff` object in the payload if all eligibility conditions are met:
 * - Registry is loaded (`isRegistryLoaded()` returns true)
 * - Next agent has a known VS Code handle
 * - Status is not COMPLETE, BLOCKED, or IN_PROGRESS
 * - `auto_handoff_depth` in the ledger is below `MAX_HANDOFF_DEPTH`
 *
 * On COMPLETE status the depth counter is reset to 0 so the next project starts fresh.
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

  // Auto-handoff eligibility check
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
        if (currentDepth < getMaxHandoffDepth()) {
          await store.writeRootIndex({
            ...root,
            auto_handoff_depth: currentDepth + 1,
            last_updated: now(),
          });
          payload.auto_handoff = {
            agent_name: agentName,
            prompt: buildHandoffPrompt(projectPath),
          };
        }
      } catch (err) {
        process.stderr.write(`[buildHandoffResponse] storage error (auto-handoff depth update): ${String(err)}\n`);
      }
    }
  }

  // Reset depth counter when project reaches COMPLETE
  if (status === 'COMPLETE' && store && projectPath) {
    try {
      const root = await store.readRootIndex();
      if ((root.auto_handoff_depth ?? 0) !== 0) {
        await store.writeRootIndex({
          ...root,
          auto_handoff_depth: 0,
          last_updated: now(),
        });
      }
    } catch (err) {
      process.stderr.write(`[buildHandoffResponse] storage error (COMPLETE depth reset): ${String(err)}\n`);
    }
  }

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
 * Get handoff status for Project Manager
 */
export async function getProjectManagerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // If any WP lacks implementation pipeline, Developer needs to work
  const needsImplementation = wpDetails.some(
    (wp) =>
      (wp.status === 'READY' || wp.status === 'IN_PROGRESS') &&
      !wp.pipelines.some((p) => p.type === 'implementation')
  );

  if (needsImplementation) {
    return buildHandoffResponse(
      'Project Manager',
      'READY_FOR_DEVELOPER',
      'Work packages created and ready for implementation.',
      undefined,
      projectPath,
      store
    );
  }

  return buildHandoffResponse(
    'Project Manager',
    'IN_PROGRESS',
    'Work packages in progress.',
    undefined,
    projectPath,
    store
  );
}

/**
 * Get handoff status for Developer
 */
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs have PASS implementation pipelines
  const allImplemented = wpDetails.every((wp) =>
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

  // Check if any WP needs implementation or has FAIL pipeline.
  //
  // NOTE: isMostRecentPipelineFail is intentionally NOT used here. That helper
  // only checks the most recent pipeline, which would miss a WP that has an
  // older FAIL pipeline followed by a currently IN_PROGRESS one. getDeveloperHandoff
  // needs a conservative signal: if any implementation attempt has ever FAIL-ed
  // and no PASS pipeline exists yet, the WP is still considered in-progress.
  const needsWork = wpDetails.some(
    (wp) =>
      !wp.pipelines.some((p) => p.type === 'implementation') ||
      wp.pipelines.some((p) => p.type === 'implementation' && p.status === 'FAIL')
  );

  if (needsWork) {
    // Count how many work packages still need implementation
    const wpsNeedingWork = wpDetails.filter(
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
 * Get handoff status for QA
 */
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
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
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsStillNeedingImpl.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
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
  const needsWork = wpsWithImpl.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'qa') ||
      wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need QA
    const wpsNeedingWork = wpsWithImpl.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'qa') ||
        wp.pipelines.some((p) => p.type === 'qa' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'QA',
      'IN_PROGRESS',
      `QA work in progress. ${wpsNeedingWork.length} work package(s) still need QA or rework.`,
      `Call ledger_get_next_action with agent_role: "QA" to find the next work package to validate. Continue working until all WPs have PASS qa pipelines.`,
      projectPath,
      store
    );
  }

  // All implemented WPs have QA but some WPs still need implementation
  if (wpsStillNeedingImpl.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsStillNeedingImpl.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsStillNeedingImpl.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
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
 * Get handoff status for Reviewer
 */
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
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
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsNotYetQaPassed.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
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
  const needsWork = wpsWithQa.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'code-review') ||
      wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need review
    const wpsNeedingWork = wpsWithQa.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'code-review') ||
        wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'Reviewer',
      'IN_PROGRESS',
      `Review work in progress. ${wpsNeedingWork.length} work package(s) still need review or rework.`,
      `Call ledger_get_next_action with agent_role: "Reviewer" to find the next work package to review. Continue working until all WPs have PASS code-review pipelines.`,
      projectPath,
      store
    );
  }

  // All reviewed WPs are done but some haven't reached QA yet
  if (wpsNotYetQaPassed.length > 0) {
    // Check if these WPs are actually ready or blocked by dependencies
    const readyWps = wpsNotYetQaPassed.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsNotYetQaPassed.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
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
 * Get handoff status for Documentation
 */
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore) {
  // Check if all WPs with code-review pipelines have PASS documentation pipelines
  const wpsWithReview = wpDetails.filter((wp) =>
    wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  const allDocsPassed = wpsWithReview.every((wp) =>
    wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'PASS')
  );

  // Check if there are WPs that haven't reached code-review yet
  const wpsNotYetReviewed = wpDetails.filter(
    (wp) => !wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
  );

  if (allDocsPassed && wpsWithReview.length > 0) {
    // If there are still WPs that haven't been reviewed, earlier stages need to catch up
    if (wpsNotYetReviewed.length > 0) {
      // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
      const readyWps = wpsNotYetReviewed.filter(
        (wp) => !isBlockedByDependencies(wp, wpDetails)
      );
      const blockedWps = wpsNotYetReviewed.filter((wp) =>
        isBlockedByDependencies(wp, wpDetails)
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

  // Check if any non-BLOCKED WP needs documentation or has FAIL pipeline.
  // BLOCKED WPs need upstream rework before Documentation can retry — exclude them.
  const needsWork = wpsWithReview.some(
    (wp) =>
      wp.status !== 'BLOCKED' &&
      (!wp.pipelines.some((p) => p.type === 'documentation') ||
      wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'FAIL'))
  );

  if (needsWork) {
    // Count how many work packages still need documentation
    const wpsNeedingWork = wpsWithReview.filter(
      (wp) =>
        wp.status !== 'BLOCKED' &&
        (!wp.pipelines.some((p) => p.type === 'documentation') ||
        wp.pipelines.some((p) => p.type === 'documentation' && p.status === 'FAIL'))
    );

    return buildHandoffResponse(
      'Documentation',
      'IN_PROGRESS',
      `Documentation work in progress. ${wpsNeedingWork.length} work package(s) still need documentation or rework.`,
      `Call ledger_get_next_action with agent_role: "Documentation" to find the next work package to document. Continue working until all WPs have PASS documentation pipelines and are marked COMPLETE.`,
      projectPath,
      store
    );
  }

  // All documented WPs are done but some haven't reached review yet
  if (wpsNotYetReviewed.length > 0) {
    // Check if these WPs are actually blocked by dependencies (not genuinely waiting)
    const readyWps = wpsNotYetReviewed.filter(
      (wp) => !isBlockedByDependencies(wp, wpDetails)
    );
    const blockedWps = wpsNotYetReviewed.filter((wp) =>
      isBlockedByDependencies(wp, wpDetails)
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
 * Register the ledger_get_handoff_status tool on the MCP server.
 */
export function register(server: McpServer): void {
  server.registerTool(
    'ledger_get_handoff_status',
    {
      description: 'Get the handoff status to determine if your work is done and which agent should work next. REQUIRED params: project_path, current_agent. Call this after completing your pipelines to check if work should be handed to the next agent in the workflow.',
      inputSchema: GetHandoffStatusSchema.passthrough(),
    },
    getHandoffStatus as any
  );
}
