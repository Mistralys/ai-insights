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
