import { describe, it, expect } from 'vitest';
import { ProjectStatus } from '../../src/schema/enums.js';
import { ProjectMetaSchema } from '../../src/schema/project-meta.js';
import { RootIndexSchema } from '../../src/schema/root-index.js';
import { GuiConfigSchema } from '../../src/gui/config.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const minimalMeta = {
  slug: 'test-project',
  plan_path: '/path/to/plan',
  status: 'ARCHIVED' as const,
  date_created: '2026-03-06T00:00:00Z',
  last_updated: '2026-03-06T00:00:00Z',
};

const minimalRootIndex = {
  plan_file: 'plan.md',
  date_created: '2026-03-06T00:00:00Z',
  last_updated: '2026-03-06T00:00:00Z',
  status: 'ARCHIVED' as const,
  total_work_packages: 0,
  pending_work_packages: 0,
  work_packages: [],
  project_comments: [],
};

// ─── ProjectStatus ─────────────────────────────────────────────────────────

describe('ProjectStatus', () => {
  it("parses 'ARCHIVED' successfully", () => {
    const result = ProjectStatus.safeParse('ARCHIVED');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('ARCHIVED');
  });

  it("rejects unknown status values", () => {
    expect(ProjectStatus.safeParse('UNKNOWN').success).toBe(false);
    expect(ProjectStatus.safeParse('archived').success).toBe(false);
    expect(ProjectStatus.safeParse('').success).toBe(false);
  });

  it("still accepts all pre-existing statuses", () => {
    for (const status of ['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED'] as const) {
      expect(ProjectStatus.safeParse(status).success).toBe(true);
    }
  });
});

// ─── ProjectMetaSchema ────────────────────────────────────────────────────

describe('ProjectMetaSchema', () => {
  it("accepts status: 'ARCHIVED'", () => {
    const result = ProjectMetaSchema.safeParse(minimalMeta);
    expect(result.success).toBe(true);
  });

  it("rejects invalid status values", () => {
    expect(
      ProjectMetaSchema.safeParse({ ...minimalMeta, status: 'UNKNOWN' }).success
    ).toBe(false);
  });
});

// ─── RootIndexSchema ──────────────────────────────────────────────────────

describe('RootIndexSchema', () => {
  it("accepts status: 'ARCHIVED'", () => {
    const result = RootIndexSchema.safeParse(minimalRootIndex);
    expect(result.success).toBe(true);
  });
});

// ─── GuiConfigSchema ──────────────────────────────────────────────────────

describe('GuiConfigSchema', () => {
  it("defaults auto_archive_days to 6 when field is absent", () => {
    const result = GuiConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auto_archive_days).toBe(6);
  });

  it("accepts auto_archive_days: 0 (disabled)", () => {
    const result = GuiConfigSchema.safeParse({ auto_archive_days: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auto_archive_days).toBe(0);
  });

  it("accepts custom auto_archive_days values", () => {
    const result = GuiConfigSchema.safeParse({ auto_archive_days: 30 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auto_archive_days).toBe(30);
  });

  it("rejects auto_archive_days: -1", () => {
    expect(GuiConfigSchema.safeParse({ auto_archive_days: -1 }).success).toBe(false);
  });

  it("rejects non-integer auto_archive_days", () => {
    expect(GuiConfigSchema.safeParse({ auto_archive_days: 1.5 }).success).toBe(false);
  });
});
