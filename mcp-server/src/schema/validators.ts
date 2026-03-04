import type { WorkPackageStatus } from './enums.js';
import type { WorkPackageDetail } from './work-package.js';
import type { WorkPackageSummary } from './root-index.js';

/**
 * Returns true if the given WP status is terminal (no further transitions out).
 * Terminal statuses: COMPLETE, CANCELLED.
 *
 * Use this predicate everywhere you need to check whether a WP is "done" —
 * instead of inline `status === 'COMPLETE'` or `status !== 'COMPLETE'` checks —
 * so that adding a new terminal status in the future is a single-point change.
 */
export function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETE' || status === 'CANCELLED';
}

/**
 * Status transition rules enforced by the MCP server.
 * Based on the transition table in plan.md:
 *
 * Legal transitions:
 * - READY -> IN_PROGRESS (if dependencies met)
 * - READY -> BLOCKED
 * - READY -> CANCELLED (PM only)
 * - IN_PROGRESS -> COMPLETE (if all acceptance criteria met)
 * - IN_PROGRESS -> BLOCKED
 * - IN_PROGRESS -> CANCELLED (PM only)
 * - IN_PROGRESS -> READY (unclaim path, spec §21.13)
 * - BLOCKED -> IN_PROGRESS
 * - BLOCKED -> READY (auto-unblock by propagateDependencyUnblock)
 * - BLOCKED -> CANCELLED (PM only)
 * - COMPLETE -> IN_PROGRESS (triggers revision increment)
 * - COMPLETE -> CANCELLED (PM only)
 * - CANCELLED is terminal — no transitions out (including CANCELLED -> CANCELLED)
 */
export function isValidStatusTransition(
  from: WorkPackageStatus,
  to: WorkPackageStatus
): boolean {
  // Same-status is a no-op for all statuses except CANCELLED (which is terminal).
  if (from === to) {
    return from !== 'CANCELLED';
  }

  switch (from) {
    case 'READY':
      return to === 'IN_PROGRESS' || to === 'BLOCKED' || to === 'CANCELLED';

    case 'IN_PROGRESS':
      return to === 'COMPLETE' || to === 'BLOCKED' || to === 'CANCELLED' || to === 'READY';

    case 'BLOCKED':
      return to === 'IN_PROGRESS' || to === 'READY' || to === 'CANCELLED';

    case 'COMPLETE':
      return to === 'IN_PROGRESS' || to === 'CANCELLED';

    case 'CANCELLED':
      return false; // Terminal — no transitions out

    default:
      return false;
  }
}

/**
 * Check if a work package can be started (all dependencies must be COMPLETE).
 *
 * @param wp - The work package to check
 * @param allWpSummaries - All work package summaries from the root index
 * @returns Object with allowed boolean and optional reason string
 */
export function canStartWorkPackage(
  wp: WorkPackageDetail | WorkPackageSummary,
  allWpSummaries: WorkPackageSummary[]
): { allowed: boolean; reason?: string } {
  if (wp.dependencies.length === 0) {
    return { allowed: true };
  }

  const notCompleteDeps: string[] = [];

  for (const depId of wp.dependencies) {
    const depWp = allWpSummaries.find((w) => w.work_package_id === depId);

    if (!depWp) {
      return {
        allowed: false,
        reason: `Dependency ${depId} not found in project`,
      };
    }

    if (!isTerminalStatus(depWp.status)) {
      notCompleteDeps.push(`${depId} (status: ${depWp.status})`);
    }
  }

  if (notCompleteDeps.length > 0) {
    return {
      allowed: false,
      reason: `Dependencies not complete: ${notCompleteDeps.join(', ')}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a work package can be marked as COMPLETE (all acceptance criteria must be met).
 *
 * @param wp - The work package to check
 * @returns Object with allowed boolean and optional array of unmet criteria
 */
export function canCompleteWorkPackage(wp: WorkPackageDetail): {
  allowed: boolean;
  unmet?: string[];
} {
  const unmetCriteria = wp.acceptance_criteria
    .filter((criterion) => !criterion.met)
    .map((criterion) => criterion.criterion);

  if (unmetCriteria.length > 0) {
    return {
      allowed: false,
      unmet: unmetCriteria,
    };
  }

  return { allowed: true };
}
