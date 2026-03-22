import { describe, it, expect } from 'vitest';
import {
  PipelineSchema,
  WorkPackageDetailSchema,
  ReworkCountsSchema,
  type ReworkCounts,
} from '../../src/schema/work-package.js';
import { WorkPackageSummarySchema } from '../../src/schema/root-index.js';

// ─── Minimal valid fixtures ────────────────────────────────────────────────

const minimalPipeline = {
  type: 'implementation',
  status: 'IN_PROGRESS' as const,
  summary: [],
};

const minimalWpDetail = {
  work_package_id: 'WP-001',
  work_package_file: 'work/WP-001.md',
  status: 'READY' as const,
  assigned_to: 'Developer',
  dependencies: [],
  acceptance_criteria: [],
  revision: 0,
  pipelines: [],
};

const minimalWpSummary = {
  work_package_id: 'WP-001',
  status: 'READY' as const,
  assigned_to: 'Developer',
  dependencies: [],
  file: 'ledger/WP-001.json',
};

// ─── PipelineSchema ────────────────────────────────────────────────────────

describe('PipelineSchema', () => {
  it('accepts a pipeline without auto_cancelled', () => {
    const result = PipelineSchema.safeParse(minimalPipeline);
    expect(result.success).toBe(true);
  });

  it('accepts auto_cancelled: true', () => {
    const result = PipelineSchema.safeParse({ ...minimalPipeline, auto_cancelled: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auto_cancelled).toBe(true);
  });

  it('accepts auto_cancelled: false', () => {
    const result = PipelineSchema.safeParse({ ...minimalPipeline, auto_cancelled: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auto_cancelled).toBe(false);
  });

  it('accepts duration_ms as an optional number', () => {
    const result = PipelineSchema.safeParse({ ...minimalPipeline, duration_ms: 12345 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.duration_ms).toBe(12345);
  });

  it('accepts pipeline without duration_ms (backward compatibility)', () => {
    const result = PipelineSchema.safeParse(minimalPipeline);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.duration_ms).toBeUndefined();
  });
});

// ─── ReworkCountsSchema ────────────────────────────────────────────────────

describe('ReworkCountsSchema', () => {
  it('accepts an empty object', () => {
    expect(ReworkCountsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a full map', () => {
    const full = { implementation: 2, qa: 1, 'code-review': 0, documentation: 3 };
    const result = ReworkCountsSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('accepts a partial map', () => {
    const result = ReworkCountsSchema.safeParse({ implementation: 1 });
    expect(result.success).toBe(true);
  });

  it('rejects negative values', () => {
    const result = ReworkCountsSchema.safeParse({ qa: -1 });
    expect(result.success).toBe(false);
  });

  it('ReworkCounts type is structurally correct', () => {
    // Compile-time check: assert assignability
    const counts: ReworkCounts = { implementation: 1, qa: 0 };
    expect(counts).toBeDefined();
  });
});

// ─── WorkPackageDetailSchema ───────────────────────────────────────────────

describe('WorkPackageDetailSchema', () => {
  it('accepts minimal object with revision: 0', () => {
    const result = WorkPackageDetailSchema.safeParse(minimalWpDetail);
    expect(result.success).toBe(true);
  });

  it('accepts revision: 0 (previously rejected by .positive())', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, revision: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts revision: 1', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, revision: 1 });
    expect(result.success).toBe(true);
  });

  it('rejects negative revision', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, revision: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts assigned_to: null', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, assigned_to: null });
    expect(result.success).toBe(true);
  });

  it('accepts assigned_to as a string', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, assigned_to: 'Developer' });
    expect(result.success).toBe(true);
  });

  it('accepts rework_counts map (full)', () => {
    const data = {
      ...minimalWpDetail,
      rework_counts: { implementation: 2, qa: 1, 'code-review': 0, documentation: 1 },
    };
    const result = WorkPackageDetailSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts rework_counts map (partial)', () => {
    const result = WorkPackageDetailSchema.safeParse({
      ...minimalWpDetail,
      rework_counts: { qa: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts object without rework_counts (absent = optional)', () => {
    const result = WorkPackageDetailSchema.safeParse(minimalWpDetail);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rework_counts).toBeUndefined();
  });

  it('still accepts legacy rework_count scalar', () => {
    const result = WorkPackageDetailSchema.safeParse({ ...minimalWpDetail, rework_count: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rework_count).toBe(3);
  });

  it('accepts status_changed_at string', () => {
    const result = WorkPackageDetailSchema.safeParse({
      ...minimalWpDetail,
      status_changed_at: '2026-02-27T12:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status_changed_at).toBe('2026-02-27T12:00:00Z');
  });

  it('accepts object without status_changed_at (optional)', () => {
    const result = WorkPackageDetailSchema.safeParse(minimalWpDetail);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status_changed_at).toBeUndefined();
  });

  it('accepts last_updated when present', () => {
    const result = WorkPackageDetailSchema.safeParse({
      ...minimalWpDetail,
      last_updated: '2026-03-17T12:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.last_updated).toBe('2026-03-17T12:00:00Z');
  });

  it('accepts object without last_updated (optional — backward compatible)', () => {
    const result = WorkPackageDetailSchema.safeParse(minimalWpDetail);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.last_updated).toBeUndefined();
  });
});

// ─── WorkPackageSummarySchema ──────────────────────────────────────────────

describe('WorkPackageSummarySchema', () => {
  it('accepts assigned_to: null', () => {
    const result = WorkPackageSummarySchema.safeParse({ ...minimalWpSummary, assigned_to: null });
    expect(result.success).toBe(true);
  });

  it('accepts assigned_to as a string', () => {
    const result = WorkPackageSummarySchema.safeParse(minimalWpSummary);
    expect(result.success).toBe(true);
  });
});
