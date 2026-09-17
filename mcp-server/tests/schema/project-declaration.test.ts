import { describe, it, expect } from 'vitest';
import {
  ProjectSettingsSchema,
  ProjectSettingsLocalSchema,
  OUTPUT_IDS,
  DEFAULT_OUTPUT_PATHS,
  type ProjectSettings,
} from '../../src/schema/project-declaration.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const validSettings: ProjectSettings = {
  schema_version: 1,
  repository_id: 'hcp-editor',
  outputs: {
    'strategic-vision': { enabled: true, path: 'docs/strategic-vision.md' },
  },
};

// ─── ProjectSettingsSchema ─────────────────────────────────────────────────

describe('ProjectSettingsSchema', () => {
  it('accepts a fully valid declaration', () => {
    expect(ProjectSettingsSchema.safeParse(validSettings).success).toBe(true);
  });

  it('accepts a declaration with no outputs map at all', () => {
    const minimal = { schema_version: 1, repository_id: 'hcp-editor' };
    expect(ProjectSettingsSchema.safeParse(minimal).success).toBe(true);
  });

  it('defaults an output entry\'s enabled field to false when omitted', () => {
    const parsed = ProjectSettingsSchema.parse({
      schema_version: 1,
      repository_id: 'hcp-editor',
      outputs: { 'strategic-vision': {} },
    });
    expect(parsed.outputs?.['strategic-vision'].enabled).toBe(false);
  });

  it('rejects an unknown outputs key, identifying the offending field', () => {
    const result = ProjectSettingsSchema.safeParse({
      schema_version: 1,
      repository_id: 'hcp-editor',
      outputs: { 'unknown-output': { enabled: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths.some((p) => p.includes('unknown-output') || p === 'outputs')).toBe(true);
    }
  });

  it('rejects an unsupported schema_version, identifying the offending field', () => {
    const result = ProjectSettingsSchema.safeParse({
      schema_version: 2,
      repository_id: 'hcp-editor',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('schema_version');
    }
  });

  it('rejects an unknown top-level key (strict object)', () => {
    const result = ProjectSettingsSchema.safeParse({
      schema_version: 1,
      repository_id: 'hcp-editor',
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key inside an output config (strict object)', () => {
    const result = ProjectSettingsSchema.safeParse({
      schema_version: 1,
      repository_id: 'hcp-editor',
      outputs: { 'strategic-vision': { enabled: true, extra: 'nope' } },
    });
    expect(result.success).toBe(false);
  });

  it('validates repository_id against SLUG_REGEX, matching the registry id rule', () => {
    const invalidIds = ['-leading-hyphen', 'has spaces', 'has/slash', 'has.dot', ''];
    for (const id of invalidIds) {
      const result = ProjectSettingsSchema.safeParse({ schema_version: 1, repository_id: id });
      expect(result.success, `expected "${id}" to be rejected`).toBe(false);
    }

    const validIds = ['hcp-editor', 'hcp_editor', 'HcpEditor2'];
    for (const id of validIds) {
      const result = ProjectSettingsSchema.safeParse({ schema_version: 1, repository_id: id });
      expect(result.success, `expected "${id}" to be accepted`).toBe(true);
    }
  });
});

// ─── ProjectSettingsLocalSchema ────────────────────────────────────────────

describe('ProjectSettingsLocalSchema', () => {
  it('validates successfully with no fields at all', () => {
    expect(ProjectSettingsLocalSchema.safeParse({}).success).toBe(true);
  });

  it('validates successfully without repository_id even when other fields are set', () => {
    const result = ProjectSettingsLocalSchema.safeParse({
      schema_version: 1,
      outputs: { 'strategic-vision': { enabled: true } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a local override that carries repository_id (unknown key, strict)', () => {
    const result = ProjectSettingsLocalSchema.safeParse({
      repository_id: 'hcp-editor',
    });
    expect(result.success).toBe(false);
  });
});

// ─── OUTPUT_IDS / DEFAULT_OUTPUT_PATHS ─────────────────────────────────────

describe('OUTPUT_IDS and DEFAULT_OUTPUT_PATHS', () => {
  it('has a default path entry for every known output id', () => {
    for (const id of OUTPUT_IDS) {
      expect(DEFAULT_OUTPUT_PATHS[id]).toBeTruthy();
    }
  });

  it('ships exactly one output id in v1: strategic-vision', () => {
    expect(OUTPUT_IDS).toEqual(['strategic-vision']);
  });
});
