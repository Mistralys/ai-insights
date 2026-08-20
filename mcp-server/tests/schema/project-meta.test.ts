/**
 * Tests for the outcome_summary field added to ProjectMetaSchema and RootIndexSchema (WP-002).
 *
 * Verifies:
 * - outcome_summary accepts a non-empty string
 * - outcome_summary accepts null (cleared/unset state)
 * - outcome_summary is fully optional (backward compatibility — existing records without the
 *   field continue to parse successfully)
 */

import { describe, it, expect } from 'vitest';
import { ProjectMetaSchema } from '../../src/schema/project-meta.js';
import { RootIndexSchema } from '../../src/schema/root-index.js';

// ─── Shared base objects (no outcome_summary) ────────────────────────────────

const BASE_META = {
  slug: '2026-01-01-my-project',
  plan_path: '/plans/2026-01-01-my-project',
  status: 'READY' as const,
  date_created: '2026-01-01T00:00:00.000Z',
  last_updated: '2026-01-01T00:00:00.000Z',
};

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

// ─── ProjectMetaSchema — outcome_summary ─────────────────────────────────────

describe('ProjectMetaSchema — outcome_summary field', () => {
  it('accepts a non-empty string value (AC1)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      outcome_summary: 'Implemented feature X and shipped it to production.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBe('Implemented feature X and shipped it to production.');
    }
  });

  it('accepts null (cleared/unset state) (AC1)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      outcome_summary: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBeNull();
    }
  });

  it('accepts absent field — backward compatibility (AC1, AC5)', () => {
    const result = ProjectMetaSchema.safeParse(BASE_META);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBeUndefined();
    }
  });

  it('rejects a number', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      outcome_summary: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a boolean', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      outcome_summary: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an object', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      outcome_summary: { text: 'hello' },
    });
    expect(result.success).toBe(false);
  });
});

// ─── RootIndexSchema — outcome_summary ───────────────────────────────────────

describe('RootIndexSchema — outcome_summary field', () => {
  it('accepts a non-empty string value (AC2)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      outcome_summary: 'Delivered the repository context feature end-to-end.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBe('Delivered the repository context feature end-to-end.');
    }
  });

  it('accepts null (cleared/unset state) (AC2)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      outcome_summary: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBeNull();
    }
  });

  it('accepts absent field — backward compatibility (AC2, AC5)', () => {
    const result = RootIndexSchema.safeParse(BASE_ROOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome_summary).toBeUndefined();
    }
  });

  it('rejects a number', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      outcome_summary: 99,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a boolean', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      outcome_summary: false,
    });
    expect(result.success).toBe(false);
  });
});

// ─── ProjectMetaSchema — project_summary ─────────────────────────────────────

describe('ProjectMetaSchema — project_summary field', () => {
  it('accepts a non-empty string value (AC1)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      project_summary: 'Delivers a gradient fade-out and toggle for the plan synopsis card.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBe('Delivers a gradient fade-out and toggle for the plan synopsis card.');
    }
  });

  it('accepts null (AC1)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      project_summary: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBeNull();
    }
  });

  it('accepts absent field — backward compatibility (AC1)', () => {
    const result = ProjectMetaSchema.safeParse(BASE_META);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBeUndefined();
    }
  });

  it('rejects a number (AC2)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      project_summary: 123,
    });
    expect(result.success).toBe(false);
  });
});

// ─── RootIndexSchema — project_summary ───────────────────────────────────────

describe('RootIndexSchema — project_summary field', () => {
  it('accepts a non-empty string value (AC1)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      project_summary: 'Adds project_summary field through the full MCP stack.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBe('Adds project_summary field through the full MCP stack.');
    }
  });

  it('accepts null (AC1)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      project_summary: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBeNull();
    }
  });

  it('accepts absent field — backward compatibility (AC1)', () => {
    const result = RootIndexSchema.safeParse(BASE_ROOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_summary).toBeUndefined();
    }
  });

  it('rejects a number (AC2)', () => {
    const result = RootIndexSchema.safeParse({
      ...BASE_ROOT,
      project_summary: 123,
    });
    expect(result.success).toBe(false);
  });
});
// ─── ProjectMetaSchema — duration_ms ─────────────────────────────────────────

describe('ProjectMetaSchema — duration_ms field (AC-01)', () => {
  it('accepts a nonnegative integer value', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: 1500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_ms).toBe(1500);
    }
  });

  it('accepts null (unmeasurable duration)', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_ms).toBeNull();
    }
  });

  it('accepts absent field — backward compatibility', () => {
    const result = ProjectMetaSchema.safeParse(BASE_META);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_ms).toBeUndefined();
    }
  });

  it('accepts zero', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative number', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer number', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: 12.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a string', () => {
    const result = ProjectMetaSchema.safeParse({
      ...BASE_META,
      duration_ms: '1500',
    });
    expect(result.success).toBe(false);
  });
});