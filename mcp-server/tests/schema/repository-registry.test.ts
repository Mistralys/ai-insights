import { describe, it, expect } from 'vitest';
import {
  StrategicVisionSchema,
  RepositoryEntrySchema,
  RepositoryRegistrySchema,
  type StrategicVision,
  type RepositoryEntry,
  type RepositoryRegistry,
} from '../../src/schema/repository-registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const validVision: StrategicVision = {
  short_term: 'Stabilise the public API and achieve 90% test coverage.',
  mid_term: 'Introduce plugin architecture and multi-tenant support.',
  long_term: 'Become the de-facto standard for AI workflow orchestration.',
};

const nullVision: StrategicVision = {
  short_term: null,
  mid_term: null,
  long_term: null,
};

const validEntry: RepositoryEntry = {
  id: 'hcp-editor',
  label: 'HCP Editor',
  folder_names: ['hcp-editor', 'hcp-editor-dev'],
  vision: validVision,
  created_at: '2026-01-01T00:00:00Z',
  last_modified: '2026-06-01T12:00:00Z',
};

const validRegistry: RepositoryRegistry = {
  repositories: [validEntry],
};

// ─── StrategicVisionSchema ─────────────────────────────────────────────────

describe('StrategicVisionSchema', () => {
  it('accepts all three fields as non-empty strings', () => {
    expect(StrategicVisionSchema.safeParse(validVision).success).toBe(true);
  });

  it('accepts all three fields as null (vision not yet authored)', () => {
    expect(StrategicVisionSchema.safeParse(nullVision).success).toBe(true);
  });

  it('accepts a mixed state (some null, some non-null)', () => {
    const mixed = { short_term: 'Ship v2.0.', mid_term: null, long_term: null };
    expect(StrategicVisionSchema.safeParse(mixed).success).toBe(true);
  });

  it('rejects empty strings (empty is distinguishable from null)', () => {
    expect(StrategicVisionSchema.safeParse({ ...nullVision, short_term: '' }).success).toBe(false);
    expect(StrategicVisionSchema.safeParse({ ...validVision, mid_term: '' }).success).toBe(false);
    expect(StrategicVisionSchema.safeParse({ ...validVision, long_term: '' }).success).toBe(false);
  });

  it('rejects when a required field is missing', () => {
    const { short_term: _removed, ...missing } = validVision;
    expect(StrategicVisionSchema.safeParse(missing).success).toBe(false);
  });

  it.each(['short_term', 'mid_term', 'long_term'] as const)(
    'accepts field "%s" as null independently',
    (field) => {
      const input = { ...validVision, [field]: null };
      expect(StrategicVisionSchema.safeParse(input).success).toBe(true);
    }
  );
});

// ─── RepositoryEntrySchema ─────────────────────────────────────────────────

describe('RepositoryEntrySchema', () => {
  it('accepts a fully populated valid entry', () => {
    expect(RepositoryEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('accepts an entry with a null vision (not yet authored)', () => {
    const input = { ...validEntry, vision: nullVision };
    expect(RepositoryEntrySchema.safeParse(input).success).toBe(true);
  });

  it('accepts an entry with a single folder name', () => {
    const input = { ...validEntry, folder_names: ['hcp-editor'] };
    expect(RepositoryEntrySchema.safeParse(input).success).toBe(true);
  });

  // ─── id validation (SLUG_REGEX) ───────────────────────────────────────────

  it.each([
    'hcp-editor',
    'my_project',
    'abc123',
    'A',
    'repo-name-2026',
  ])('accepts valid id slug "%s"', (id) => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id }).success).toBe(true);
  });

  it('rejects id that does not match SLUG_REGEX — starts with dash', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: '-bad-slug' }).success).toBe(false);
  });

  it('rejects id that does not match SLUG_REGEX — starts with underscore', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: '_bad' }).success).toBe(false);
  });

  it('rejects id that does not match SLUG_REGEX — contains slash (path traversal)', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: 'my/repo' }).success).toBe(false);
  });

  it('rejects id that does not match SLUG_REGEX — contains dot', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: 'my.repo' }).success).toBe(false);
  });

  it('rejects id that does not match SLUG_REGEX — contains space', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: 'my repo' }).success).toBe(false);
  });

  it('rejects id that does not match SLUG_REGEX — path traversal attempt', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, id: '../escape' }).success).toBe(false);
  });

  // ─── Required field presence ───────────────────────────────────────────────

  it.each(['id', 'label', 'folder_names', 'vision', 'created_at', 'last_modified'] as const)(
    'rejects when required field "%s" is missing',
    (field) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { [field]: _removed, ...rest } = validEntry as any;
      expect(RepositoryEntrySchema.safeParse(rest).success).toBe(false);
    }
  );

  it('rejects an empty label', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, label: '' }).success).toBe(false);
  });

  it('rejects an empty folder_names array', () => {
    expect(RepositoryEntrySchema.safeParse({ ...validEntry, folder_names: [] }).success).toBe(false);
  });
});

// ─── RepositoryRegistrySchema ──────────────────────────────────────────────

describe('RepositoryRegistrySchema', () => {
  it('accepts a registry with one valid entry', () => {
    expect(RepositoryRegistrySchema.safeParse(validRegistry).success).toBe(true);
  });

  it('accepts a registry with multiple entries', () => {
    const secondEntry: RepositoryEntry = {
      ...validEntry,
      id: 'second-repo',
      label: 'Second Repo',
      folder_names: ['second-repo'],
    };
    const input = { repositories: [validEntry, secondEntry] };
    expect(RepositoryRegistrySchema.safeParse(input).success).toBe(true);
  });

  it('accepts { "repositories": [] } (empty registry)', () => {
    expect(RepositoryRegistrySchema.safeParse({ repositories: [] }).success).toBe(true);
  });

  it('rejects when repositories field is missing', () => {
    expect(RepositoryRegistrySchema.safeParse({}).success).toBe(false);
  });

  it('rejects when repositories is not an array', () => {
    expect(RepositoryRegistrySchema.safeParse({ repositories: null }).success).toBe(false);
    expect(RepositoryRegistrySchema.safeParse({ repositories: 'not-an-array' }).success).toBe(false);
  });

  it('rejects when repositories contains an invalid entry', () => {
    const invalidEntry = { ...validEntry, id: '-bad-id' };
    expect(RepositoryRegistrySchema.safeParse({ repositories: [invalidEntry] }).success).toBe(false);
  });

  it('parses and returns typed RepositoryRegistry for a valid input', () => {
    const result = RepositoryRegistrySchema.safeParse(validRegistry);
    expect(result.success).toBe(true);
    if (result.success) {
      const data: RepositoryRegistry = result.data;
      expect(data.repositories).toHaveLength(1);
      expect(data.repositories[0].id).toBe('hcp-editor');
      expect(data.repositories[0].vision.short_term).toBe(validVision.short_term);
    }
  });
});

// ─── TypeScript type exports (compile-time check) ──────────────────────────
// If the types are not exported, this file will fail to compile.

describe('Exported TypeScript types', () => {
  it('StrategicVision type is exported and usable', () => {
    const v: StrategicVision = nullVision;
    expect(v.short_term).toBeNull();
  });

  it('RepositoryEntry type is exported and usable', () => {
    const e: RepositoryEntry = validEntry;
    expect(e.id).toBe('hcp-editor');
  });

  it('RepositoryRegistry type is exported and usable', () => {
    const r: RepositoryRegistry = validRegistry;
    expect(r.repositories).toHaveLength(1);
  });
});
