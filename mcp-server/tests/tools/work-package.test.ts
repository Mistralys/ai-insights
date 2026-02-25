import { describe, it, expect } from 'vitest';
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

