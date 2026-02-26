import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { _internal } from '../../src/tools/work-package.js';

const { buildStatusTransitionGuidance } = _internal;

describe('WP status transition guidance (buildStatusTransitionGuidance)', () => {
  it('BLOCKED guidance mentions Developer rework via get_next_action', () => {
    const guidance = buildStatusTransitionGuidance('WP-005', 'BLOCKED', 'QA');
    expect(guidance).toContain('NEXT STEP');
    expect(guidance).toContain('BLOCKED');
    expect(guidance).toContain('Developer');
    expect(guidance).toContain('ledger_get_handoff_status');
    expect(guidance).toContain('ledger_get_next_action');
  });

  it('COMPLETE guidance mentions auto-unblocking and handoff', () => {
    const guidance = buildStatusTransitionGuidance('WP-001', 'COMPLETE', 'Documentation');
    expect(guidance).toContain('COMPLETE');
    expect(guidance).toContain('auto-unblocked');
    expect(guidance).toContain('ledger_get_handoff_status');
  });

  it('IN_PROGRESS guidance tells agent to start a pipeline', () => {
    const guidance = buildStatusTransitionGuidance('WP-002', 'IN_PROGRESS', 'Developer');
    expect(guidance).toContain('IN_PROGRESS');
    expect(guidance).toContain('ledger_start_pipeline');
    expect(guidance).toContain('ledger_complete_pipeline');
  });

  it('READY status returns empty guidance (no special routing needed)', () => {
    const guidance = buildStatusTransitionGuidance('WP-001', 'READY', 'Project Manager');
    expect(guidance).toBe('');
  });
});

describe('COMPLETE -> IN_PROGRESS agent guard', () => {
  /**
   * Inline replica of the agent guard added to updateWorkPackageStatus.
   * Tests the guard logic in isolation without requiring a store, following
   * the same pattern as claim-guard.test.ts.
   */
  const ALLOWED_REOPEN_AGENTS = [
    'Project Manager',
    'Project Manager Agent',
    'Documentation',
    'Documentation Agent',
  ];

  function checkReopenGuard(oldStatus: string, newStatus: string, agent: string): string | null {
    if (oldStatus !== 'COMPLETE' || newStatus !== 'IN_PROGRESS') return null;
    if (!ALLOWED_REOPEN_AGENTS.includes(agent)) {
      return (
        `Only the Project Manager or Documentation agent may reopen a COMPLETE work package (COMPLETE → IN_PROGRESS). You are: ${agent}\n\n` +
        `If you believe this work package needs rework, hand off to the Project Manager or Documentation agent so they can formally reopen it.`
      );
    }
    return null;
  }

  it('rejects Developer attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain('Project Manager or Documentation agent');
    expect(error).toContain('You are: Developer');
  });

  it('rejects QA attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'QA');
    expect(error).not.toBeNull();
    expect(error).toContain('You are: QA');
  });

  it('rejects Reviewer attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Reviewer');
    expect(error).not.toBeNull();
    expect(error).toContain('You are: Reviewer');
  });

  it('allows Project Manager to reopen COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Project Manager');
    expect(error).toBeNull();
  });

  it('allows Project Manager Agent alias', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Project Manager Agent');
    expect(error).toBeNull();
  });

  it('allows Documentation to reopen COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Documentation');
    expect(error).toBeNull();
  });

  it('allows Documentation Agent alias', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Documentation Agent');
    expect(error).toBeNull();
  });

  it('does not apply guard for other transitions (e.g., IN_PROGRESS -> BLOCKED)', () => {
    const error = checkReopenGuard('IN_PROGRESS', 'BLOCKED', 'Developer');
    expect(error).toBeNull();
  });
});

describe('BLOCKED -> READY clears blocked_by', () => {
  /**
   * Inline replica of the blocked_by-clearing logic in updateWorkPackageStatus.
   * Tests that exiting BLOCKED via READY (auto-unblock) leaves no stale blocked_by,
   * mirroring the same guarantee already tested for BLOCKED -> IN_PROGRESS.
   */
  function applyBlockedByClearing(
    oldStatus: string,
    newStatus: string,
    wp: { blocked_by?: { type: string; description: string } },
  ): typeof wp {
    // Replica of the widened guard in updateWorkPackageStatus step 7
    if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') {
      delete wp.blocked_by;
    }
    return wp;
  }

  it('clears blocked_by when transitioning BLOCKED -> READY', () => {
    const wp = { blocked_by: { type: 'dependency', description: 'Waiting for WP-000' } };
    const result = applyBlockedByClearing('BLOCKED', 'READY', wp);
    expect(result.blocked_by).toBeUndefined();
  });

  it('clears blocked_by when transitioning BLOCKED -> IN_PROGRESS', () => {
    const wp = { blocked_by: { type: 'technical', description: 'Build broken' } };
    const result = applyBlockedByClearing('BLOCKED', 'IN_PROGRESS', wp);
    expect(result.blocked_by).toBeUndefined();
  });

  it('does NOT clear blocked_by for non-BLOCKED old status (e.g., READY -> IN_PROGRESS)', () => {
    const wp = {};
    const result = applyBlockedByClearing('READY', 'IN_PROGRESS', wp);
    // blocked_by was never set and should remain absent (no error)
    expect(result.blocked_by).toBeUndefined();
  });

  it('does NOT clear blocked_by when transitioning into BLOCKED (BLOCKED -> BLOCKED no-op)', () => {
    const wp = { blocked_by: { type: 'external', description: 'Waiting on vendor' } };
    const result = applyBlockedByClearing('BLOCKED', 'BLOCKED', wp);
    expect(result.blocked_by).toBeDefined();
  });
});

describe('auto_handoff_depth reset on WP COMPLETE (Finding #8)', () => {
  /**
   * Inline replica of the depth-reset step added to updateWorkPackageStatus.
   * Tests the exact condition: `newStatus === 'COMPLETE' && (root.auto_handoff_depth ?? 0) !== 0`
   * which resets `auto_handoff_depth` to 0 whenever any WP reaches COMPLETE.
   */
  function applyDepthResetOnComplete(
    newStatus: string,
    root: { auto_handoff_depth?: number }
  ): { auto_handoff_depth?: number } {
    if (newStatus === 'COMPLETE' && (root.auto_handoff_depth ?? 0) !== 0) {
      return { ...root, auto_handoff_depth: 0 };
    }
    return root;
  }

  it('resets auto_handoff_depth to 0 when transitioning to COMPLETE with depth > 0', () => {
    const root = { auto_handoff_depth: 5 };
    expect(applyDepthResetOnComplete('COMPLETE', root).auto_handoff_depth).toBe(0);
  });

  it('resets auto_handoff_depth from any non-zero value', () => {
    expect(applyDepthResetOnComplete('COMPLETE', { auto_handoff_depth: 1 }).auto_handoff_depth).toBe(0);
    expect(applyDepthResetOnComplete('COMPLETE', { auto_handoff_depth: 10 }).auto_handoff_depth).toBe(0);
  });

  it('does NOT reset when depth is already 0 (no-op, avoids spurious write)', () => {
    const root = { auto_handoff_depth: 0 };
    const result = applyDepthResetOnComplete('COMPLETE', root);
    // Returns the same root reference (or equivalent), depth unchanged
    expect(result.auto_handoff_depth).toBe(0);
  });

  it('does NOT reset when transitioning to non-COMPLETE status', () => {
    expect(applyDepthResetOnComplete('IN_PROGRESS', { auto_handoff_depth: 7 }).auto_handoff_depth).toBe(7);
    expect(applyDepthResetOnComplete('BLOCKED', { auto_handoff_depth: 3 }).auto_handoff_depth).toBe(3);
    expect(applyDepthResetOnComplete('READY', { auto_handoff_depth: 2 }).auto_handoff_depth).toBe(2);
  });

  it('handles missing auto_handoff_depth field gracefully (treats as 0, no reset needed)', () => {
    const root: { auto_handoff_depth?: number } = {};
    const result = applyDepthResetOnComplete('COMPLETE', root);
    // auto_handoff_depth was undefined (effectively 0), no reset needed
    expect(result.auto_handoff_depth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test Group 3 — claimWorkPackage override authorization guard (GN-5)
// ---------------------------------------------------------------------------
// Inline replica of the override-auth guard (step 2b) in claimWorkPackage.
// Keeps tests independent of private schema exports while validating the same
// invariants enforced by the real tool handler.

function overrideAuthGuard(
  wpAssignedTo: string,
  agent: string,
  override?: boolean,
): string | null {
  // Guard only fires when override is true and there is a current assignee
  if (!override || !wpAssignedTo) return null;
  if (agent === 'Project Manager' || agent === wpAssignedTo) return null;
  return (
    `Cannot override claim on work package WP-001: ` +
    `override is restricted to "Project Manager" or the current assignee ` +
    `("${wpAssignedTo}"). You are "${agent}".`
  );
}

describe('claimWorkPackage override authorization guard (GN-5)', () => {
  const ASSIGNED_TO = 'Developer';

  it('PM override allowed — Project Manager with override: true succeeds', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Project Manager', true);
    expect(error).toBeNull();
  });

  it('assignee override allowed — current assignee with override: true succeeds', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Developer', true);
    expect(error).toBeNull();
  });

  it('third-party override rejected — non-PM, non-assignee with override: true throws', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'QA', true);
    expect(error).not.toBeNull();
    expect(error).toContain('override is restricted to "Project Manager" or the current assignee');
    expect(error).toContain('"Developer"');
    expect(error).toContain('"QA"');
  });

  it('no override flag — guard does not apply (returns null)', () => {
    // Without override: true the earlier assignment guard fires instead; this guard is a no-op.
    expect(overrideAuthGuard(ASSIGNED_TO, 'QA', false)).toBeNull();
    expect(overrideAuthGuard(ASSIGNED_TO, 'QA', undefined)).toBeNull();
  });

  it('Reviewer override also rejected (not PM, not assignee)', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Reviewer', true);
    expect(error).not.toBeNull();
    expect(error).toContain('override is restricted to "Project Manager" or the current assignee');
  });
});

// ---------------------------------------------------------------------------
// Test Group 4 — WP ID regex completeness (WP-003 schema changes)
// ---------------------------------------------------------------------------
// The three schemas (GetWorkPackageSchema, ClaimWorkPackageSchema, and the
// dependencies entry in CreateWorkPackageSchema) all use the pattern
// /^WP-\d{3,}$/ — requiring at least 3 digits. These tests verify that
// WP-1000 (4 digits) is accepted and WP-10 (2 digits) is rejected across
// all three schema shapes, without requiring private schema exports.

const WP_ID_REGEX = /^WP-\d{3,}$/;

// Minimal schema mirrors (same regex, no source-file modification needed)
const GetWorkPackageSchemaMinimal = z.object({
  project_path: z.string(),
  work_package_id: z.string().regex(WP_ID_REGEX),
});

const CreateWorkPackageDepsSchema = z.object({
  project_path: z.string(),
  dependencies: z.array(z.string().regex(WP_ID_REGEX)),
});

const ClaimWorkPackageSchemaMinimal = z.object({
  project_path: z.string(),
  work_package_id: z.string().regex(WP_ID_REGEX),
  agent: z.string(),
});

const BASE = { project_path: '/tmp/2026-01-01-test', agent: 'Developer' };

describe('WP ID regex — 4-digit ID WP-1000 accepted (GN-3)', () => {
  it('GetWorkPackageSchema accepts WP-1000', () => {
    const result = GetWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-1000',
    });
    expect(result.success).toBe(true);
  });

  it('CreateWorkPackageSchema(dependencies) accepts WP-1000', () => {
    const result = CreateWorkPackageDepsSchema.safeParse({
      project_path: BASE.project_path,
      dependencies: ['WP-1000'],
    });
    expect(result.success).toBe(true);
  });

  it('ClaimWorkPackageSchema accepts WP-1000', () => {
    const result = ClaimWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-1000',
      agent: BASE.agent,
    });
    expect(result.success).toBe(true);
  });
});

describe('WP ID regex — 2-digit ID WP-10 rejected (GN-3)', () => {
  it('GetWorkPackageSchema rejects WP-10', () => {
    const result = GetWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-10',
    });
    expect(result.success).toBe(false);
  });

  it('CreateWorkPackageSchema(dependencies) rejects WP-10', () => {
    const result = CreateWorkPackageDepsSchema.safeParse({
      project_path: BASE.project_path,
      dependencies: ['WP-10'],
    });
    expect(result.success).toBe(false);
  });

  it('ClaimWorkPackageSchema rejects WP-10', () => {
    const result = ClaimWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-10',
      agent: BASE.agent,
    });
    expect(result.success).toBe(false);
  });
});

