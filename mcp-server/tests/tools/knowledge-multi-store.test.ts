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
    // Seed store-a with a global insight (gets id=1)
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

    // Seed store-b: first a filler insight to consume id=1 (so it collides with store-a
    // and gets deduplicated away), then the real insight which gets id=2 (unique).
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight({
      scope: 'global',
      title: 'Filler to offset id sequence',
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

    // store-a id=1 and store-b id=2 both match "atomic" — store-b id=1 is deduped away.
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
    // Store-a gets id=1 "Insight from A".
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

    // Store-b: filler takes id=1 (deduped away), real insight gets id=2 (unique).
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight({
      scope: 'global',
      title: 'Filler to offset id sequence',
      content: 'Offset id so the real insight gets a unique id.',
      category: 'internal',
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

    // store-a id=1 and store-b id=2 appear; store-b id=1 is deduped against store-a id=1.
    const result = await listInsights({});
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    expect(data.length).toBeGreaterThanOrEqual(2);
    const titles = data.map((d) => d['title'] as string);
    expect(titles).toContain('Insight from A');
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

    const result = await updateInsight({ id: 9999, title: 'Ghost update' });
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

    const result = await deleteInsight({ id: 9999 });
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/not found/);
  });
});

// ─── WP-002: store-scoped formatted_id ────────────────────────────────────────

describe('WP-002: formatted_id includes store prefix in multi-store mode', () => {
  it('addInsight (global): formatted_id is prefixed with the first store id', async () => {
    await initTwoStoreContext(storeA, storeB);

    const result = await addInsight({
      scope: 'global',
      title: 'Global prefixed insight',
      content: 'Should carry store-a prefix.',
      category: 'architecture',
      tags: [],
    });

    const data = parseResult(result as any) as Record<string, unknown>;
    expect(data['formatted_id']).toMatch(/^store-a:KN-\d{4}$/);
  });

  it('addInsight (repo): formatted_id is prefixed with the claiming store id', async () => {
    await writeRegistry(storeB, ['prefixed-repo']);
    await initTwoStoreContext(storeA, storeB);

    const result = await addInsight({
      scope: 'repository',
      repository_name: 'prefixed-repo',
      title: 'Repo prefixed insight',
      content: 'Should carry store-b prefix.',
      category: 'workflow',
      tags: [],
    });

    const data = parseResult(result as any) as Record<string, unknown>;
    expect(data['formatted_id']).toMatch(/^store-b:KN-\d{4}$/);
  });

  it('searchInsights: each insight formatted_id reflects its owning store', async () => {
    // Insert id=1 into store-a
    const managerA = new KnowledgeStoreManager(storeA);
    await managerA.addInsight({
      scope: 'global',
      title: 'Store-A insight',
      content: 'Lives in store-a.',
      category: 'architecture',
      tags: ['search-prefix'],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    // Insert filler (id=1, deduped) + real (id=2) into store-b
    const managerB = new KnowledgeStoreManager(storeB);
    await managerB.addInsight({
      scope: 'global',
      title: 'Filler to offset id',
      content: 'Offset.',
      category: 'internal',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });
    await managerB.addInsight({
      scope: 'global',
      title: 'Store-B insight',
      content: 'Lives in store-b.',
      category: 'architecture',
      tags: ['search-prefix'],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await searchInsights({ query: 'search-prefix' });
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    expect(data).toHaveLength(2);
    const aEntry = data.find((d) => d['title'] === 'Store-A insight');
    const bEntry = data.find((d) => d['title'] === 'Store-B insight');

    expect(aEntry?.['formatted_id']).toMatch(/^store-a:KN-\d{4}$/);
    expect(bEntry?.['formatted_id']).toMatch(/^store-b:KN-\d{4}$/);
  });

  it('listInsights: each insight formatted_id reflects its owning store', async () => {
    const managerA = new KnowledgeStoreManager(storeA);
    await managerA.addInsight({
      scope: 'global',
      title: 'List insight from A',
      content: 'Store-A.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    const managerB = new KnowledgeStoreManager(storeB);
    // Filler to offset id sequence so store-b's real insight has id=2 (not deduped)
    await managerB.addInsight({
      scope: 'global',
      title: 'Filler',
      content: 'Offset.',
      category: 'internal',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });
    await managerB.addInsight({
      scope: 'global',
      title: 'List insight from B',
      content: 'Store-B.',
      category: 'workflow',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await listInsights({ category: 'workflow' });
    const data = parseResult(result as any) as Array<Record<string, unknown>>;

    const aEntry = data.find((d) => d['title'] === 'List insight from A');
    const bEntry = data.find((d) => d['title'] === 'List insight from B');

    expect(aEntry?.['formatted_id']).toMatch(/^store-a:KN-\d{4}$/);
    expect(bEntry?.['formatted_id']).toMatch(/^store-b:KN-\d{4}$/);
  });

  it('updateInsight: formatted_id in the response reflects the owning store', async () => {
    // Only store-b has the insight
    const managerB = new KnowledgeStoreManager(storeB);
    const original = await managerB.addInsight({
      scope: 'global',
      title: 'Update prefix test',
      content: 'In store-b.',
      category: 'architecture',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await updateInsight({ id: original.id, title: 'Updated' });
    const data = parseResult(result as any) as Record<string, unknown>;

    expect(data['formatted_id']).toMatch(/^store-b:KN-\d{4}$/);
  });

  it('deleteInsight: formatted_id in the response reflects the owning store', async () => {
    const managerA = new KnowledgeStoreManager(storeA);
    const insight = await managerA.addInsight({
      scope: 'global',
      title: 'Delete prefix test',
      content: 'In store-a.',
      category: 'testing',
      tags: [],
      source: '',
      confidence: 1,
      created_at: now(),
    });

    await initTwoStoreContext(storeA, storeB);

    const result = await deleteInsight({ id: insight.id });
    const data = parseResult(result as any) as Record<string, unknown>;

    expect(data['formatted_id']).toMatch(/^store-a:KN-\d{4}$/);
    expect(data['deleted']).toBe(true);
  });
});

// ─── WP-002: deleteInsight error propagation normalization ────────────────────

describe('WP-002: deleteInsight uses throw new Error() on exhaustion (no lastError)', () => {
  it('returns a clean "not found" error message when no store has the insight', async () => {
    await initTwoStoreContext(storeA, storeB);

    const result = await deleteInsight({ id: 42 });

    expect((result as any).isError).toBe(true);
    const text: string = (result as any).content[0].text;
    // Must contain "not found" (same as updateInsight's exhaustion message)
    expect(text).toMatch(/not found/);
    // Must reference the insight id
    expect(text).toContain('42');
  });
});

// ─── D-1: listInsights — global pagination after merge ───────────────────────

describe('D-1: listInsights — global pagination after merge', () => {
  /**
   * Seed store-a with 3 global insights (IDs 1–3) and store-b with 3 filler
   * insights (IDs 1–3, deduped away) then 3 real insights (IDs 4–6).
   * The merged+deduped set is 6 insights total (IDs 1–6).
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
    // Filler insights consume IDs 1–3 in store-b (deduped against store-a's IDs 1–3).
    for (let i = 1; i <= 3; i++) {
      await managerB.addInsight({
        scope: 'global',
        title: `Filler ${i} for dedup`,
        content: 'Offset id sequence in store-b.',
        category: 'internal',
        tags: [],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }
    // Real store-b insights get IDs 4–6 (unique across the merged set).
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
    const limitIds = new Set(limitData.map((d) => d['id'] as number));
    for (const item of offsetData) {
      expect(limitIds.has(item['id'] as number)).toBe(false);
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
    // Filler insights offset the ID sequence in store-b (IDs 1–3, deduped away).
    for (let i = 1; i <= 3; i++) {
      await managerB.addInsight({
        scope: 'global',
        title: `Filler ${i}`,
        content: 'Offset.',
        category: 'internal',
        tags: [],
        source: '',
        confidence: 1,
        created_at: now(),
      });
    }
    // 2 real store-b insights matching "pagination" get IDs 4–5 (unique).
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
