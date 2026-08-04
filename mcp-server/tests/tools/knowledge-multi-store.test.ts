/**
 * Integration tests for multi-store knowledge tool behaviour.
 *
 * These tests verify that addInsight, searchInsights, listInsights, updateInsight,
 * and deleteInsight correctly delegate to the right store when the store context
 * has been initialized with a multi-store configuration.
 *
 * Each test calls setStoreContext() in beforeEach and restores legacy mode in
 * afterEach to avoid leaking module-level singleton state into other test suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { _internal } from '../../src/tools/knowledge.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';

const { addInsight, searchInsights, listInsights, updateInsight, deleteInsight } = _internal;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(stores: Array<{ id: string; path: string; label: string }>): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: stores[0]!.id,
  };
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

/** Write a minimal .repositories.json claiming a repo in a store. */
async function writeRegistry(storePath: string, repoNames: string[]): Promise<void> {
  const ts = now();
  const registry: RepositoryRegistry = {
    repositories: repoNames.map((name) => ({
      id: name,
      label: name,
      folder_names: [name],
      vision: { short_term: null, mid_term: null, long_term: null },
      created_at: ts,
      last_modified: ts,
    })),
  };
  await saveRegistry(storePath, registry);
}

/** Initialise store context with two stores and return the two paths. */
async function initTwoStoreContext(
  storeA: string,
  storeB: string
): Promise<{ router: StoreRouter; manager: MultiStoreManager }> {
  const config = makeConfig([
    { id: 'store-a', path: storeA, label: 'Store A' },
    { id: 'store-b', path: storeB, label: 'Store B' },
  ]);
  const router = new StoreRouter(config);
  const manager = new MultiStoreManager(router);
  setStoreContext(router, manager);
  return { router, manager };
}

/** Restore the singleton to legacy mode so subsequent test suites are unaffected. */
function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── Shared state ────────────────────────────────────────────────────────────

let storeA: string;
let storeB: string;

beforeEach(async () => {
  storeA = await mkdtemp(join(tmpdir(), 'knowledge-ms-a-'));
  storeB = await mkdtemp(join(tmpdir(), 'knowledge-ms-b-'));
});

afterEach(async () => {
  restoreLegacyContext();
  await Promise.all([
    rm(storeA, { recursive: true, force: true }),
    rm(storeB, { recursive: true, force: true }),
  ]);
});

// ─── AC1: addInsight — repository-scoped write routing ───────────────────────

describe('AC1: addInsight — repository scope routes to the claiming store', () => {
  it('writes to store-a when store-a registry claims the repository', async () => {
    await writeRegistry(storeA, ['repo-alpha']);
    await initTwoStoreContext(storeA, storeB);

    const result = await addInsight({
      scope: 'repository',
      repository_name: 'repo-alpha',
      title: 'Alpha repo insight',
      content: 'Repository-scoped content.',
      category: 'workflow',
      tags: ['test'],
    });

    const data = parseResult(result as any) as Record<string, unknown>;
    expect(data.scope).toBe('repository');
    expect(data.repository_name).toBe('repo-alpha');

    // Verify it was physically written to store-a, not store-b
    const managerA = new KnowledgeStoreManager(storeA);
    const managerB = new KnowledgeStoreManager(storeB);
    const insightsA = await managerA.listInsights({ scope: 'repository', repository_name: 'repo-alpha' });
    const insightsB = await managerB.listInsights({ scope: 'repository', repository_name: 'repo-alpha' });
    expect(insightsA).toHaveLength(1);
    expect(insightsB).toHaveLength(0);
  });

  it('writes to store-b when store-b registry claims the repository', async () => {
    await writeRegistry(storeB, ['repo-beta']);
    await initTwoStoreContext(storeA, storeB);

    await addInsight({
      scope: 'repository',
      repository_name: 'repo-beta',
      title: 'Beta repo insight',
      content: 'Stored in store-b.',
      category: 'testing',
      tags: [],
    });

    const managerA = new KnowledgeStoreManager(storeA);
    const managerB = new KnowledgeStoreManager(storeB);
    const insightsA = await managerA.listInsights({ scope: 'repository', repository_name: 'repo-beta' });
    const insightsB = await managerB.listInsights({ scope: 'repository', repository_name: 'repo-beta' });
    expect(insightsA).toHaveLength(0);
    expect(insightsB).toHaveLength(1);
  });

  it('returns an error when the repository is not registered in any store', async () => {
    await initTwoStoreContext(storeA, storeB); // neither store claims 'repo-ghost'

    const result = await addInsight({
      scope: 'repository',
      repository_name: 'repo-ghost',
      title: 'Orphan insight',
      content: 'Should fail routing.',
      category: 'testing',
      tags: [],
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/not registered in any store/);
  });
});

// ─── AC2: addInsight — global scope always writes to the default store ────────

describe('AC2: addInsight — global scope writes to the first (default) store', () => {
  it('global insights land in store-a (first in config)', async () => {
    await initTwoStoreContext(storeA, storeB);

    await addInsight({
      scope: 'global',
      title: 'Global insight',
      content: 'Applies across all repos.',
      category: 'architecture',
      tags: ['global'],
    });

    const managerA = new KnowledgeStoreManager(storeA);
    const managerB = new KnowledgeStoreManager(storeB);
    const globalA = await managerA.listInsights({ scope: 'global' });
    const globalB = await managerB.listInsights({ scope: 'global' });
    expect(globalA).toHaveLength(1);
    expect(globalB).toHaveLength(0);
  });
});

// ─── AC3: searchInsights — cross-store search ─────────────────────────────────

describe('AC3: searchInsights returns merged results from all stores', () => {
  it('merges search results from both stores and deduplicates by id', async () => {
    // Seed store-a with a global insight
    const managerA = new KnowledgeStoreManager(storeA);
    await managerA.addInsight({
      scope: 'global',
      title: 'Atomic writes are safer',
      content: 'Always write atomically.',
      category: 'architecture',
      tags: ['storage'],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    // Seed store-b with two insights; only the second matches the "atomic" query.
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight({
      scope: 'global',
      title: 'Unrelated insight',
      content: 'Not relevant to this search.',
      category: 'testing',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });
    await managerB.addInsight({
      scope: 'global',
      title: 'Atomic operations in tests',
      content: 'Use atomic writes in test fixtures too.',
      category: 'testing',
      tags: ['storage', 'testing'],
      source: '',
      confidence: 0.9,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    // "atomic" matches both atomic insights (one per store); the unrelated insight is excluded.
    const result = await searchInsights({ query: 'atomic' });
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    expect(data).toHaveLength(2);
    const titles = data.map((d) => d['title'] as string);
    expect(titles).toContain('Atomic writes are safer');
    expect(titles).toContain('Atomic operations in tests');
  });
});

// ─── AC4: listInsights — cross-store listing ──────────────────────────────────

describe('AC4: listInsights returns merged results from all stores', () => {
  it('lists insights from both stores with deduplication', async () => {
    // Seed store-a with one insight and store-b with two insights.
    // With UUID ids all insights have unique IDs — all three appear in the merged list.
    const managerA = new KnowledgeStoreManager(storeA);
    await managerA.addInsight({
      scope: 'global',
      title: 'Insight from A',
      content: 'In store A.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight({
      scope: 'global',
      title: 'Insight from B (first)',
      content: 'In store B.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });
    await managerB.addInsight({
      scope: 'global',
      title: 'Insight from B',
      content: 'In store B.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await listInsights({});
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    expect(data).toHaveLength(3);
    const titles = data.map((d) => d['title'] as string);
    expect(titles).toContain('Insight from A');
    expect(titles).toContain('Insight from B (first)');
    expect(titles).toContain('Insight from B');
  });
});

// ─── AC5: updateInsight and deleteInsight target the correct store ────────────

describe('AC5: updateInsight and deleteInsight locate the correct store', () => {
  it('updateInsight modifies the insight in the store that owns it', async () => {
    // Store-b has an insight; store-a has none
    const managerB = new KnowledgeStoreManager(storeB);
    const original = await managerB.addInsight({
      scope: 'global',
      title: 'Original title',
      content: 'Before update.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await updateInsight({ id: original.id, title: 'Updated title' });
    const data = parseResult(result as any) as Record<string, unknown>;

    expect(data['title']).toBe('Updated title');

    // Confirm the update landed in store-b
    const verifyB = await managerB.listInsights({ scope: 'global' });
    expect(verifyB[0]?.title).toBe('Updated title');

    // Confirm store-a was not touched
    const managerA = new KnowledgeStoreManager(storeA);
    const verifyA = await managerA.listInsights({ scope: 'global' });
    expect(verifyA).toHaveLength(0);
  });

  it('updateInsight returns an error when the insight does not exist in any store', async () => {
    await initTwoStoreContext(storeA, storeB);

    const result = await updateInsight({ id: '00000000-0000-0000-0000-000000000000', title: 'Ghost update' });
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/not found/);
  });

  it('deleteInsight removes the insight from the store that owns it', async () => {
    const managerA = new KnowledgeStoreManager(storeA);
    const insight = await managerA.addInsight({
      scope: 'global',
      title: 'To be deleted',
      content: 'Will be removed.',
      category: 'testing',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await deleteInsight({ id: insight.id });
    const data = parseResult(result as any) as Record<string, unknown>;

    expect(data['deleted']).toBe(true);

    // Confirm it is gone from store-a
    const remaining = await managerA.listInsights({ scope: 'global' });
    expect(remaining).toHaveLength(0);
  });

  it('deleteInsight returns an error when the insight does not exist in any store', async () => {
    await initTwoStoreContext(storeA, storeB);

    const result = await deleteInsight({ id: '00000000-0000-0000-0000-000000000000' });
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/not found/);
  });
});


// ─── WP-002: deleteInsight error propagation normalization ────────────────────

describe('WP-002: deleteInsight uses throw new Error() on exhaustion (no lastError)', () => {
  it('returns a clean "not found" error message when no store has the insight', async () => {
    await initTwoStoreContext(storeA, storeB);

    const result = await deleteInsight({ id: '00000000-0000-0000-0000-000000000042' });

    expect((result as any).isError).toBe(true);
    const text: string = (result as any).content[0].text;
    // Must contain "not found" (same as updateInsight's exhaustion message)
    expect(text).toMatch(/not found/);
    // Must reference the insight id
    expect(text).toContain('00000000-0000-0000-0000-000000000042');
  });
});

// ─── D-1: listInsights — global pagination after merge ───────────────────────

describe('D-1: listInsights — global pagination after merge', () => {
  /**
   * Seed store-a with 3 global insights and store-b with 3 global insights.
   * With UUID ids every insight is unique, so no dedup occurs.
   * The merged set is 6 insights total.
   */
  async function seedSixInsights(): Promise<void> {
    const managerA = new KnowledgeStoreManager(storeA);
    for (let i = 1; i <= 3; i++) {
      await managerA.addInsight({
        scope: 'global',
        title: `Insight ${i} from A`,
        content: `Store-A insight number ${i}.`,
        category: 'pagination-test',
        tags: ['pagination'],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }

    const managerB = new KnowledgeStoreManager(storeB);
    for (let i = 4; i <= 6; i++) {
      await managerB.addInsight({
        scope: 'global',
        title: `Insight ${i} from B`,
        content: `Store-B insight number ${i}.`,
        category: 'pagination-test',
        tags: ['pagination'],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }

    await initTwoStoreContext(storeA, storeB);
  }

  it('limit caps the merged result set globally', async () => {
    await seedSixInsights();

    const result = await listInsights({ limit: 4 });
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    // With the fix: exactly 4 results, not 3+3=6.
    expect(data).toHaveLength(4);
  });

  it('offset skips across the merged set', async () => {
    await seedSixInsights();

    const withLimit = await listInsights({ limit: 4 });
    const withOffset = await listInsights({ offset: 4 });

    const limitData = parseResult(withLimit as any) as Array<Record<string, unknown>>;
    const offsetData = parseResult(withOffset as any) as Array<Record<string, unknown>>;

    // offset=4 on a 6-item merged set yields exactly 2 results.
    expect(offsetData).toHaveLength(2);

    // The two result sets must not overlap.
    const limitIds = new Set(limitData.map((d) => d['id'] as string));
    for (const item of offsetData) {
      expect(limitIds.has(item['id'] as string)).toBe(false);
    }
  });

  it('limit + offset returns the correct window', async () => {
    await seedSixInsights();

    // Full list (category filter ensures only the 6 pagination-test insights are returned).
    const fullResult = await listInsights({ category: 'pagination-test' });
    const fullData = parseResult(fullResult as any) as Array<Record<string, unknown>>;

    // Window: positions 2–3 (0-indexed) of the full merged list.
    const windowResult = await listInsights({ category: 'pagination-test', offset: 2, limit: 2 });
    const windowData = parseResult(windowResult as any) as Array<Record<string, unknown>>;

    expect(windowData).toHaveLength(2);
    expect(windowData[0]!['id']).toBe(fullData[2]!['id']);
    expect(windowData[1]!['id']).toBe(fullData[3]!['id']);
  });
});

// ─── D-1: searchInsights — limit already applied globally ────────────────────

describe('D-1: searchInsights — limit already applied globally', () => {
  it('limit caps the merged search result set globally', async () => {
    const managerA = new KnowledgeStoreManager(storeA);
    // 3 insights matching "pagination" in store-a (IDs 1–3).
    for (let i = 1; i <= 3; i++) {
      await managerA.addInsight({
        scope: 'global',
        title: `Pagination test insight ${i}`,
        content: `Content about pagination number ${i}.`,
        category: 'testing',
        tags: ['pagination'],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }

    const managerB = new KnowledgeStoreManager(storeB);
    // 2 real store-b insights matching "pagination" (unique UUIDs, no dedup needed).
    for (let i = 4; i <= 5; i++) {
      await managerB.addInsight({
        scope: 'global',
        title: `Pagination test insight ${i}`,
        content: `Content about pagination number ${i}.`,
        category: 'testing',
        tags: ['pagination'],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }

    await initTwoStoreContext(storeA, storeB);

    // 5 matching insights across both stores; limit=3 must return exactly 3.
    const result = await searchInsights({ query: 'pagination', limit: 3 });
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    expect(data).toHaveLength(3);
  });
});
