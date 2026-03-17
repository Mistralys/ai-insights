/**
 * Tests for the new schema fields added in WP-001/WP-002:
 *   - RootIndexSchema: synthesis_generated_at, ledger_version
 *   - WorkPackageSummarySchema: active_pipeline_stages
 * Also validates backward compatibility (legacy ledgers parse without new fields).
 */

import { describe, it, expect } from 'vitest';
import { RootIndexSchema, WorkPackageSummarySchema } from '../../src/schema/root-index.js';

// ─── Minimal base objects ────────────────────────────────────────────────────

const BASE_ROOT = {
  plan_file: 'plan.md',
  date_created: '2026-01-01T00:00:00.000Z',
  last_updated: '2026-01-01T00:00:00.000Z',
  status: 'READY' as const,
  total_work_packages: 0,
  pending_work_packages: 0,
  work_packages: [],
  project_comments: [],
};

const BASE_SUMMARY = {
  work_package_id: 'WP-001',
  status: 'READY' as const,
  assigned_to: null,
  dependencies: [],
  file: 'ledger/WP-001.json',
};

// ─── RootIndexSchema — synthesis_generated_at ────────────────────────────────

describe('RootIndexSchema — synthesis_generated_at field', () => {
  it('accepts a valid ISO 8601 string', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      synthesis_generated_at: '2026-03-17T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synthesis_generated_at).toBe('2026-03-17T10:00:00.000Z');
    }
  });

  it('accepts null (cleared/reset state)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      synthesis_generated_at: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synthesis_generated_at).toBeNull();
    }
  });

  it('accepts absent field (optional — backward compat)', () => {
    const result = RootIndexSchema.safeParse(BASE_ROOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synthesis_generated_at).toBeUndefined();
    }
  });

  it('rejects a number', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      synthesis_generated_at: 1234567890,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a boolean', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      synthesis_generated_at: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an object', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      synthesis_generated_at: { timestamp: '2026-01-01' },
    });
    expect(result.success).toBe(false);
  });
});

// ─── RootIndexSchema — ledger_version ────────────────────────────────────────

describe('RootIndexSchema — ledger_version field', () => {
  it('accepts a semantic version string', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      ledger_version: '2.4.0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ledger_version).toBe('2.4.0');
    }
  });

  it('accepts any non-empty string (format is not constrained by Zod)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      ledger_version: 'v1.0.0-beta',
    });
    expect(result.success).toBe(true);
  });

  it('accepts absent field (optional — backward compat)', () => {
    const result = RootIndexSchema.safeParse(BASE_ROOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ledger_version).toBeUndefined();
    }
  });

  it('rejects a number', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      ledger_version: 24,
    });
    expect(result.success).toBe(false);
  });

  it('rejects null (field is optional but not nullable)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      ledger_version: null,
    });
    expect(result.success).toBe(false);
  });
});

// ─── WorkPackageSummarySchema — active_pipeline_stages ───────────────────────

describe('WorkPackageSummarySchema — active_pipeline_stages field', () => {
  it('accepts an array of stage strings', () => {
    const result = WorkPackageSummarySchema.safeParse({
      ...BASE_SUMMARY,
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active_pipeline_stages).toEqual([
        'implementation', 'qa', 'code-review', 'documentation',
      ]);
    }
  });

  it('accepts null (cleared/absent-equivalent state)', () => {
    const result = WorkPackageSummarySchema.safeParse({
      ...BASE_SUMMARY,
      active_pipeline_stages: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active_pipeline_stages).toBeNull();
    }
  });

  it('accepts an empty array', () => {
    const result = WorkPackageSummarySchema.safeParse({
      ...BASE_SUMMARY,
      active_pipeline_stages: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts absent field (optional — backward compat)', () => {
    const result = WorkPackageSummarySchema.safeParse(BASE_SUMMARY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active_pipeline_stages).toBeUndefined();
    }
  });

  it('rejects a plain string (must be array)', () => {
    const result = WorkPackageSummarySchema.safeParse({
      ...BASE_SUMMARY,
      active_pipeline_stages: 'implementation',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an array of numbers', () => {
    const result = WorkPackageSummarySchema.safeParse({
      ...BASE_SUMMARY,
      active_pipeline_stages: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Backward compatibility: legacy ledger parses without new fields ──────────

describe('Backward compatibility — legacy ledger without new fields', () => {
  it('RootIndexSchema parses successfully without synthesis_generated_at or ledger_version', () => {
    // Simulates a real ledger file written before these fields were added.
    const legacy = {
      plan_file: 'plan.md',
      date_created: '2025-12-01T08:00:00.000Z',
      last_updated: '2025-12-15T14:30:00.000Z',
      status: 'COMPLETE',
      total_work_packages: 3,
      pending_work_packages: 0,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Documentation',
          dependencies: [],
          file: 'ledger/WP-001.json',
          // no active_pipeline_stages
        },
      ],
      project_comments: [],
      synthesis_generated: true,
      // no synthesis_generated_at
      // no ledger_version
    };

    const result = RootIndexSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synthesis_generated_at).toBeUndefined();
      expect(result.data.ledger_version).toBeUndefined();
      expect(result.data.work_packages[0]?.active_pipeline_stages).toBeUndefined();
    }
  });

  it('WorkPackageSummarySchema parses successfully without active_pipeline_stages', () => {
    const legacySummary = {
      work_package_id: 'WP-002',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      file: 'ledger/WP-002.json',
      // no active_pipeline_stages
    };

    const result = WorkPackageSummarySchema.safeParse(legacySummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active_pipeline_stages).toBeUndefined();
    }
  });

  it('full legacy root index with work packages and no new fields parses successfully', () => {
    const legacyRoot = {
      plan_file: 'plan.md',
      date_created: '2025-11-01T00:00:00.000Z',
      last_updated: '2025-11-30T23:00:00.000Z',
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Documentation',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
        {
          work_package_id: 'WP-002',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
          file: 'ledger/WP-002.json',
        },
      ],
      project_comments: [],
    };

    const result = RootIndexSchema.safeParse(legacyRoot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synthesis_generated_at).toBeUndefined();
      expect(result.data.ledger_version).toBeUndefined();
      expect(result.data.synthesis_generated).toBeUndefined();
    }
  });
});
