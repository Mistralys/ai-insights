import { describe, it, expect } from 'vitest';
import { computePassedStages, computeProjectProgress } from '../../src/utils/workflow-helpers.js';
import { makeWorkPackageDetail, makePipeline, makeWorkPackageSummary } from '../helpers/fixtures.js';
import { DEFAULT_PIPELINE_STAGES } from '../../src/utils/pipeline-maps.js';

// ---------------------------------------------------------------------------
// computePassedStages
// ---------------------------------------------------------------------------

describe('computePassedStages', () => {
  it('returns 0 for a WP with no pipelines', () => {
    const wp = makeWorkPackageDetail({ pipelines: [] });
    expect(computePassedStages(wp)).toBe(0);
  });

  it('counts PASS pipelines matching active stages', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review', 'FAIL', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });
    expect(computePassedStages(wp)).toBe(2);
  });

  it('only considers the most recent non-auto-cancelled pipeline per type', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        // Second QA run fails — should override the earlier PASS
        makePipeline('qa', 'FAIL', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });
    expect(computePassedStages(wp)).toBe(1); // only implementation
  });

  it('ignores auto-cancelled pipelines', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        // Auto-cancelled FAIL — should be ignored, earlier PASS counts
        makePipeline({ type: 'qa', status: 'FAIL', auto_cancelled: true, started_at: '2026-01-01T12:00:00', completed_at: '2026-01-01T13:00:00', summary: [] }),
      ],
    });
    expect(computePassedStages(wp)).toBe(2); // implementation + qa
  });

  it('respects custom active stages', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
        makePipeline('documentation', 'PASS', '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
      ],
    });
    // Only count 2 stages if active set is limited
    expect(computePassedStages(wp, ['implementation', 'qa'])).toBe(2);
  });

  it('falls back to DEFAULT_PIPELINE_STAGES when activeStages is null', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      ],
    });
    expect(computePassedStages(wp, null)).toBe(1);
  });

  it('falls back to DEFAULT_PIPELINE_STAGES when activeStages is empty', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      ],
    });
    expect(computePassedStages(wp, [])).toBe(1);
  });

  it('returns count of all DEFAULT_PIPELINE_STAGES when all pass', () => {
    const wp = makeWorkPackageDetail({
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T01:00:00', '2026-01-01T02:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T03:00:00', '2026-01-01T04:00:00'),
        makePipeline('code-review', 'PASS', '2026-01-01T05:00:00', '2026-01-01T06:00:00'),
        makePipeline('documentation', 'PASS', '2026-01-01T07:00:00', '2026-01-01T08:00:00'),
      ],
    });
    expect(computePassedStages(wp)).toBe(DEFAULT_PIPELINE_STAGES.length);
  });
});

// ---------------------------------------------------------------------------
// computeProjectProgress
// ---------------------------------------------------------------------------

describe('computeProjectProgress', () => {
  it('returns 0 for empty work packages array', () => {
    expect(computeProjectProgress([])).toBe(0);
  });

  it('returns 100 when all WPs are COMPLETE', () => {
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'COMPLETE' }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'COMPLETE' }),
    ];
    expect(computeProjectProgress(wps)).toBe(100);
  });

  it('returns 100 when all WPs are CANCELLED', () => {
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'CANCELLED' }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'CANCELLED' }),
    ];
    expect(computeProjectProgress(wps)).toBe(100);
  });

  it('returns 0 when all WPs are READY', () => {
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'READY' }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'READY' }),
    ];
    expect(computeProjectProgress(wps)).toBe(0);
  });

  it('returns 0 when all WPs are BLOCKED', () => {
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'BLOCKED' }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'BLOCKED' }),
    ];
    expect(computeProjectProgress(wps)).toBe(0);
  });

  it('computes proportional progress for IN_PROGRESS WP with passed_stages', () => {
    // 1 WP, IN_PROGRESS, 2 of 4 stages passed → 50%
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
        passed_stages: 2,
      }),
    ];
    expect(computeProjectProgress(wps)).toBe(50);
  });

  it('treats IN_PROGRESS WP without passed_stages as 0%', () => {
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      }),
    ];
    expect(computeProjectProgress(wps)).toBe(0);
  });

  it('computes mixed progress: COMPLETE + IN_PROGRESS + READY', () => {
    // WP-001: COMPLETE → weight 1.0
    // WP-002: IN_PROGRESS, 1/4 stages → weight 0.25
    // WP-003: READY → weight 0.0
    // Sum = 1.25, total = 3, progress = round(1.25/3 * 100) = 42
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'COMPLETE' }),
      makeWorkPackageSummary({
        work_package_id: 'WP-002',
        status: 'IN_PROGRESS',
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
        passed_stages: 1,
      }),
      makeWorkPackageSummary({ work_package_id: 'WP-003', status: 'READY' }),
    ];
    expect(computeProjectProgress(wps)).toBe(42);
  });

  it('uses DEFAULT_PIPELINE_STAGES length when active_pipeline_stages absent', () => {
    // WP with no active_pipeline_stages, 1 stage passed
    // Weight = 1 / DEFAULT_PIPELINE_STAGES.length
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        passed_stages: 1,
      }),
    ];
    const expected = Math.round((1 / DEFAULT_PIPELINE_STAGES.length) * 100);
    expect(computeProjectProgress(wps)).toBe(expected);
  });

  it('counts CANCELLED WPs as 100% (same as COMPLETE)', () => {
    // 1 COMPLETE + 1 CANCELLED = 100%
    const wps = [
      makeWorkPackageSummary({ work_package_id: 'WP-001', status: 'COMPLETE' }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'CANCELLED' }),
    ];
    expect(computeProjectProgress(wps)).toBe(100);
  });

  it('BLOCKED WPs contribute 0% even with passed_stages', () => {
    // WP-001: BLOCKED with 3 passed stages → weight 0 (not proportional)
    // WP-002: COMPLETE → weight 1
    // Sum = 1, total = 2, progress = 50
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'BLOCKED',
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
        passed_stages: 3,
      }),
      makeWorkPackageSummary({ work_package_id: 'WP-002', status: 'COMPLETE' }),
    ];
    expect(computeProjectProgress(wps)).toBe(50);
  });

  it('handles IN_PROGRESS WP with all stages passed', () => {
    // Unusual state: IN_PROGRESS but 4/4 → weight 1.0
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
        passed_stages: 4,
      }),
    ];
    expect(computeProjectProgress(wps)).toBe(100);
  });

  it('handles IN_PROGRESS WP with custom 2-stage pipeline', () => {
    // 1 of 2 stages passed → weight 0.5, 1 WP → 50%
    const wps = [
      makeWorkPackageSummary({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        active_pipeline_stages: ['implementation', 'qa'],
        passed_stages: 1,
      }),
    ];
    expect(computeProjectProgress(wps)).toBe(50);
  });
});
