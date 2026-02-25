import type { WorkPackageStatus } from './enums.js';
import type { WorkPackageDetail } from './work-package.js';
import type { WorkPackageSummary } from './root-index.js';

/**
 * Status transition rules enforced by the MCP server.
 * Based on the transition table in plan.md:
 *
 * Legal transitions:
 * - READY -> IN_PROGRESS (if dependencies met)
 * - READY -> BLOCKED
 * - IN_PROGRESS -> COMPLETE (if all acceptance criteria met)
 * - IN_PROGRESS -> BLOCKED
 * - BLOCKED -> IN_PROGRESS
 * - BLOCKED -> READY (auto-unblock by propagateDependencyUnblock)
 * - COMPLETE -> IN_PROGRESS (triggers revision increment)
 */
export function isValidStatusTransition(
  from: WorkPackageStatus,
  to: WorkPackageStatus
): boolean {
  // Same status is always valid (no-op)
  if (from === to) {
    return true;
  }

  switch (from) {
    case 'READY':
      return to === 'IN_PROGRESS' || to === 'BLOCKED';

    case 'IN_PROGRESS':
      return to === 'COMPLETE' || to === 'BLOCKED';

    case 'BLOCKED':
      return to === 'IN_PROGRESS' || to === 'READY';

    case 'COMPLETE':
      return to === 'IN_PROGRESS';

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

    if (depWp.status !== 'COMPLETE') {
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
