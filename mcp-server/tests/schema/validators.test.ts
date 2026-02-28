import { describe, it, expect } from 'vitest';
import {
  isValidStatusTransition,
  canStartWorkPackage,
  canCompleteWorkPackage,
} from '../../src/schema/validators.js';
import type { WorkPackageSummary } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

describe('isValidStatusTransition', () => {
  it('allows same-status transitions (no-op) for non-terminal statuses', () => {
    expect(isValidStatusTransition('READY', 'READY')).toBe(true);
    expect(isValidStatusTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
    expect(isValidStatusTransition('BLOCKED', 'BLOCKED')).toBe(true);
    expect(isValidStatusTransition('COMPLETE', 'COMPLETE')).toBe(true);
  });

  it('rejects CANCELLED -> CANCELLED (terminal — no self-transition)', () => {
    expect(isValidStatusTransition('CANCELLED', 'CANCELLED')).toBe(false);
  });

  it('rejects all transitions out of CANCELLED (terminal)', () => {
    expect(isValidStatusTransition('CANCELLED', 'READY')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'IN_PROGRESS')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'BLOCKED')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'COMPLETE')).toBe(false);
  });

  describe('from READY', () => {
    it('allows READY -> IN_PROGRESS', () => {
      expect(isValidStatusTransition('READY', 'IN_PROGRESS')).toBe(true);
    });
    it('allows READY -> BLOCKED', () => {
      expect(isValidStatusTransition('READY', 'BLOCKED')).toBe(true);
    });
    it('rejects READY -> COMPLETE', () => {
      expect(isValidStatusTransition('READY', 'COMPLETE')).toBe(false);
    });
  });

  describe('from IN_PROGRESS', () => {
    it('allows IN_PROGRESS -> COMPLETE', () => {
      expect(isValidStatusTransition('IN_PROGRESS', 'COMPLETE')).toBe(true);
    });
    it('allows IN_PROGRESS -> BLOCKED', () => {
      expect(isValidStatusTransition('IN_PROGRESS', 'BLOCKED')).toBe(true);
    });
    it('allows IN_PROGRESS -> READY (unclaim path, spec §21.13)', () => {
      expect(isValidStatusTransition('IN_PROGRESS', 'READY')).toBe(true);
    });
  });

  describe('from BLOCKED', () => {
    it('allows BLOCKED -> IN_PROGRESS', () => {
      expect(isValidStatusTransition('BLOCKED', 'IN_PROGRESS')).toBe(true);
    });
    it('allows BLOCKED -> READY (auto-unblock)', () => {
      expect(isValidStatusTransition('BLOCKED', 'READY')).toBe(true);
    });
    it('rejects BLOCKED -> COMPLETE', () => {
      expect(isValidStatusTransition('BLOCKED', 'COMPLETE')).toBe(false);
    });
  });

  describe('from COMPLETE', () => {
    it('allows COMPLETE -> IN_PROGRESS (revision)', () => {
      expect(isValidStatusTransition('COMPLETE', 'IN_PROGRESS')).toBe(true);
    });
    it('allows COMPLETE -> CANCELLED (PM only)', () => {
      expect(isValidStatusTransition('COMPLETE', 'CANCELLED')).toBe(true);
    });
    it('rejects COMPLETE -> READY', () => {
      expect(isValidStatusTransition('COMPLETE', 'READY')).toBe(false);
    });
    it('rejects COMPLETE -> BLOCKED', () => {
      expect(isValidStatusTransition('COMPLETE', 'BLOCKED')).toBe(false);
    });
  });
});

describe('canStartWorkPackage', () => {
  const makeSummary = (id: string, status: string): WorkPackageSummary => ({
    work_package_id: id,
    status: status as WorkPackageSummary['status'],
    assigned_to: 'Developer Agent',
    dependencies: [],
    file: `ledger/${id}.json`,
  });

  it('allows start when no dependencies', () => {
    const wp = { dependencies: [] } as unknown as WorkPackageSummary;
    const result = canStartWorkPackage(wp, []);
    expect(result.allowed).toBe(true);
  });

  it('allows start when all dependencies are COMPLETE', () => {
    const wp = { dependencies: ['WP-001', 'WP-002'] } as unknown as WorkPackageSummary;
    const summaries = [
      makeSummary('WP-001', 'COMPLETE'),
      makeSummary('WP-002', 'COMPLETE'),
    ];
    const result = canStartWorkPackage(wp, summaries);
    expect(result.allowed).toBe(true);
  });

  it('rejects when dependency is not COMPLETE', () => {
    const wp = { dependencies: ['WP-001'] } as unknown as WorkPackageSummary;
    const summaries = [makeSummary('WP-001', 'IN_PROGRESS')];
    const result = canStartWorkPackage(wp, summaries);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('WP-001');
    expect(result.reason).toContain('IN_PROGRESS');
  });

  it('rejects when dependency not found', () => {
    const wp = { dependencies: ['WP-999'] } as unknown as WorkPackageSummary;
    const result = canStartWorkPackage(wp, []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('WP-999');
    expect(result.reason).toContain('not found');
  });

  it('lists all incomplete dependencies', () => {
    const wp = { dependencies: ['WP-001', 'WP-002'] } as unknown as WorkPackageSummary;
    const summaries = [
      makeSummary('WP-001', 'READY'),
      makeSummary('WP-002', 'BLOCKED'),
    ];
    const result = canStartWorkPackage(wp, summaries);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('WP-001');
    expect(result.reason).toContain('WP-002');
  });
});

describe('canCompleteWorkPackage', () => {
  it('allows completion when all criteria are met', () => {
    const wp = {
      acceptance_criteria: [
        { criterion: 'Tests pass', met: true },
        { criterion: 'No regressions', met: true },
      ],
    } as WorkPackageDetail;
    const result = canCompleteWorkPackage(wp);
    expect(result.allowed).toBe(true);
  });

  it('allows completion when no criteria exist', () => {
    const wp = { acceptance_criteria: [] } as unknown as WorkPackageDetail;
    const result = canCompleteWorkPackage(wp);
    expect(result.allowed).toBe(true);
  });

  it('rejects when criteria are unmet', () => {
    const wp = {
      acceptance_criteria: [
        { criterion: 'Tests pass', met: true },
        { criterion: 'Docs updated', met: false },
        { criterion: 'Reviewed', met: false },
      ],
    } as WorkPackageDetail;
    const result = canCompleteWorkPackage(wp);
    expect(result.allowed).toBe(false);
    expect(result.unmet).toEqual(['Docs updated', 'Reviewed']);
  });
});
