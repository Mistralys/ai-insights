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
