import { describe, it, expect } from 'vitest';
import {
  InsightSchema,
  KnowledgeStoreSchema,
  type Insight,
  type KnowledgeStore,
} from '../../src/schema/knowledge.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const validInsight: Insight = {
  id: 1,
  scope: 'global',
  title: 'Use path.join for cross-platform paths',
  content: 'Always use path.join() instead of string concatenation to ensure cross-platform compatibility.',
  category: 'best-practice',
  tags: ['node', 'filesystem', 'cross-platform'],
  source: 'WP-042',
  created_at: '2026-05-28T12:00:00Z',
  confidence: 0.9,
};

const validProjectInsight: Insight = {
  ...validInsight,
  id: 2,
  scope: 'project',
  project_slug: 'ai-insights',
};

const validKnowledgeStore: KnowledgeStore = {
  version: '1.0.0',
  last_updated: '2026-05-28T12:00:00Z',
  next_id: 1,
  insights: [],
};

// ─── InsightSchema ─────────────────────────────────────────────────────────

describe('InsightSchema', () => {
  it('accepts a valid global insight', () => {
    expect(InsightSchema.safeParse(validInsight).success).toBe(true);
  });

  it('accepts a valid project-scoped insight with project_slug', () => {
    expect(InsightSchema.safeParse(validProjectInsight).success).toBe(true);
  });

  it('accepts a project-scoped insight without project_slug (storage layer enforces that constraint)', () => {
    // The scope === 'project' → project_slug required constraint is owned by the
    // storage layer (KnowledgeStoreManager), not by this schema.
    const { project_slug: _removed, ...input } = validProjectInsight;
    expect(InsightSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    'id',
    'scope',
    'title',
    'content',
    'category',
    'tags',
    'source',
    'created_at',
    'confidence',
  ])('rejects when required field "%s" is missing', (field) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { [field as keyof typeof validInsight]: _removed, ...rest } = validInsight as any;
    expect(InsightSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts when all optional fields are omitted (updated_at, project_slug, superseded_by)', () => {
    expect(InsightSchema.safeParse(validInsight).success).toBe(true);
  });

  it('accepts when all optional fields are present', () => {
    const full = {
      ...validInsight,
      project_slug: 'my-project',
      updated_at: '2026-05-28T13:00:00Z',
      superseded_by: 5,
    };
    expect(InsightSchema.safeParse(full).success).toBe(true);
  });

  it('rejects a non-integer id', () => {
    expect(InsightSchema.safeParse({ ...validInsight, id: 1.5 }).success).toBe(false);
  });

  it('rejects an invalid scope value', () => {
    expect(InsightSchema.safeParse({ ...validInsight, scope: 'team' }).success).toBe(false);
  });

  it('rejects tags that is not an array', () => {
    expect(InsightSchema.safeParse({ ...validInsight, tags: 'node' }).success).toBe(false);
  });

  it('rejects confidence that is not a number', () => {
    expect(InsightSchema.safeParse({ ...validInsight, confidence: 'high' }).success).toBe(false);
  });

  it('rejects confidence values outside 0–1', () => {
    expect(InsightSchema.safeParse({ ...validInsight, confidence: 1.5 }).success).toBe(false);
    expect(InsightSchema.safeParse({ ...validInsight, confidence: -0.1 }).success).toBe(false);
  });

  it('accepts confidence boundary values 0 and 1', () => {
    expect(InsightSchema.safeParse({ ...validInsight, confidence: 0 }).success).toBe(true);
    expect(InsightSchema.safeParse({ ...validInsight, confidence: 1 }).success).toBe(true);
  });

  it('rejects a non-integer superseded_by value', () => {
    expect(InsightSchema.safeParse({ ...validInsight, superseded_by: 2.7 }).success).toBe(false);
  });

  it('TypeScript type Insight is inferred from schema (no handwritten duplicate interface)', () => {
    // Compile-time check: if Insight diverges from InsightSchema this line fails.
    const insight: Insight = validInsight;
    expect(insight.id).toBe(1);
  });
});

// ─── KnowledgeStoreSchema ──────────────────────────────────────────────────

describe('KnowledgeStoreSchema', () => {
  it('accepts a valid store with an empty insights array', () => {
    expect(KnowledgeStoreSchema.safeParse(validKnowledgeStore).success).toBe(true);
  });

  it('accepts a valid store with a non-zero next_id', () => {
    expect(KnowledgeStoreSchema.safeParse({ ...validKnowledgeStore, next_id: 42 }).success).toBe(true);
  });

  it('accepts a store with a populated insights array', () => {
    const store = { ...validKnowledgeStore, next_id: 2, insights: [validInsight] };
    expect(KnowledgeStoreSchema.safeParse(store).success).toBe(true);
  });

  it('accepts next_id of 0 (initial empty-store value)', () => {
    expect(KnowledgeStoreSchema.safeParse({ ...validKnowledgeStore, next_id: 0 }).success).toBe(true);
  });

  it('rejects a negative next_id', () => {
    expect(KnowledgeStoreSchema.safeParse({ ...validKnowledgeStore, next_id: -1 }).success).toBe(false);
  });

  it('rejects a non-integer next_id', () => {
    expect(KnowledgeStoreSchema.safeParse({ ...validKnowledgeStore, next_id: 1.5 }).success).toBe(false);
  });

  it.each(['version', 'last_updated', 'next_id', 'insights'])(
    'rejects when required field "%s" is missing',
    (field) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { [field as keyof typeof validKnowledgeStore]: _removed, ...rest } = validKnowledgeStore as any;
      expect(KnowledgeStoreSchema.safeParse(rest).success).toBe(false);
    }
  );

  it('rejects when insights contains an invalid insight object', () => {
    const badInsight = { ...validInsight, scope: 'invalid-scope' };
    expect(KnowledgeStoreSchema.safeParse({ ...validKnowledgeStore, insights: [badInsight] }).success).toBe(false);
  });

  it('TypeScript type KnowledgeStore is inferred from schema (no handwritten duplicate interface)', () => {
    // Compile-time check: if KnowledgeStore diverges from KnowledgeStoreSchema this line fails.
    const store: KnowledgeStore = validKnowledgeStore;
    expect(store.next_id).toBe(1);
  });
});
