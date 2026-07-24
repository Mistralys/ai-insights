/**
 * Tests for MultiStoreManager — cross-device portability and knowledge search.
 *
 * Covers:
 *   - searchKnowledge() returns merged results from all stores, deduplicated
 *     by insight id (first-seen wins) (AC 5)
 *   - listKnowledge() deduplication across stores
 *   - Adding a new store directory (with its own .repositories.json and
 *     projects) to the StoreRouter immediately makes its data visible via
 *     listAllProjects() and getMergedRegistry() without any additional
 *     registration step (AC 6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryEntry, RepositoryRegistry } from '../../src/schema/repository-registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(id: string): RepositoryEntry {
  return {
    id,
    label: id,
    folder_names: [id],
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  };
}

function makeRegistry(...ids: string[]): RepositoryRegistry {
  return { repositories: ids.map(makeEntry) };
}

async function seedProject(
  storePath: string,
  repoName: string,
  slug: string
): Promise<void> {
  const dir = join(storePath, repoName, slug);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(join(dir, '.meta.json'), {
    slug,
    plan_path: `/home/user/${repoName}/docs/agents/plans/${slug}`,
    status: 'IN_PROGRESS',
    date_created: now(),
    last_updated: now(),
    repository_name: repoName,
  });
}

async function addGlobalInsight(
  storePath: string,
  title: string,
  content: string
): Promise<number> {
  const manager = new KnowledgeStoreManager(storePath);
  const insight = await manager.addInsight({
    scope: 'global',
    title,
    content,
    category: 'test',
    tags: ['test'],
    source: '',
    created_at: now(),
    confidence: 1,
  });
  return insight.id;
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('MultiStoreManager — cross-device portability and knowledge dedup', () => {
  let tempDir: string;
  let storePath1: string;
  let storePath2: string;

  function makeConfig(extraStores?: Array<{ id: string; path: string; label?: string }>): StoresConfig {
    const stores = [
      { id: 'store-1', path: storePath1, label: 'Primary' },
      { id: 'store-2', path: storePath2, label: 'Secondary' },
      ...(extraStores ?? []),
    ];
    return { stores, default_store: 'store-1' };
  }

  function makeManager(config?: StoresConfig): MultiStoreManager {
    return new MultiStoreManager(new StoreRouter(config ?? makeConfig()));
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cross-device-test-'));
    storePath1 = join(tempDir, 'store-1');
    storePath2 = join(tempDir, 'store-2');
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── searchKnowledge — AC 5 ──────────────────────────────────────────

  describe('searchKnowledge() — AC 5', () => {
    it('returns results from both stores', async () => {
      // store-1 first insight gets id=1
      await addGlobalInsight(storePath1, 'TypeScript strict mode', 'Enable strict mode.');
      // store-2 first insight also gets id=1 (independent counter) — will be deduplicated
      await addGlobalInsight(storePath2, 'Duplicate placeholder', 'This id=1 is suppressed by store-1.');
      // store-2 second insight gets id=2 — unique id, survives dedup
      await addGlobalInsight(storePath2, 'Python type hints', 'Use type hints.');

      const manager = makeManager();
      const results = await manager.searchKnowledge('');

      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('TypeScript strict mode');
      expect(titles).toContain('Python type hints');
    });

    it('AC 5: deduplicates by insight id — first-seen wins for same numeric id', async () => {
      // Both stores start their next_id at 1, so both will produce an insight with id=1.
      // The store-1 insight with id=1 should win.
      const id1 = await addGlobalInsight(storePath1, 'Store 1 — insight 1', 'Content A');
      const id2 = await addGlobalInsight(storePath2, 'Store 2 — insight 1', 'Content B');

      // Both should have id=1 (each store's next_id starts at 1)
      expect(id1).toBe(1);
      expect(id2).toBe(1);

      const manager = makeManager();
      const results = await manager.searchKnowledge('insight 1');

      // Only one result for id=1; must be from store-1
      const dedupById = results.filter((r) => r.id === 1);
      expect(dedupById).toHaveLength(1);
      expect(dedupById[0]!.title).toBe('Store 1 — insight 1');
    });

    it('returns unique results across stores when ids do not clash', async () => {
      // Add two insights to store-1 (id=1, id=2) and one to store-2 (id=1)
      await addGlobalInsight(storePath1, 'S1 Insight A', 'Alpha content');
      await addGlobalInsight(storePath1, 'S1 Insight B', 'Beta content');
      await addGlobalInsight(storePath2, 'S2 Insight A', 'Gamma content');

      const manager = makeManager();
      // Search for empty query returns all
      const results = await manager.searchKnowledge('');

      // Store-1 contributes ids 1 and 2; store-2 contributes id 1 — but id=1 is already seen.
      // So we expect 2 unique ids: 1 (from store-1) and 2 (from store-1).
      const uniqueIds = [...new Set(results.map((r) => r.id))];
      expect(uniqueIds.length).toBe(results.length); // no duplicate ids in result
      expect(results.length).toBe(2); // 2 unique ids (1 and 2)
    });

    it('passes scope filter through to each per-store search', async () => {
      await addGlobalInsight(storePath1, 'Global insight', 'global content');
      const manager2 = new KnowledgeStoreManager(storePath2);
      await manager2.addInsight({
        scope: 'repository',
        repository_name: 'my-repo',
        title: 'Repo insight',
        content: 'repo content',
        category: 'test',
        tags: [],
        source: '',
        created_at: now(),
        confidence: 1,
      });

      const manager = makeManager();
      const globalOnly = await manager.searchKnowledge('', { scope: 'global' });
      expect(globalOnly.every((r) => r.scope === 'global')).toBe(true);
    });
  });

  // ─── listKnowledge — dedup ───────────────────────────────────────────

  describe('listKnowledge() — dedup', () => {
    it('returns merged results across stores deduplicated by id', async () => {
      await addGlobalInsight(storePath1, 'S1 Insight', 'content');
      await addGlobalInsight(storePath2, 'S2 Insight', 'content'); // id=1, same as store-1

      const manager = makeManager();
      const results = await manager.listKnowledge({});

      // id=1 exists in both stores; only store-1's version should appear
      const id1Results = results.filter((r) => r.id === 1);
      expect(id1Results).toHaveLength(1);
      expect(id1Results[0]!.title).toBe('S1 Insight');
    });
  });

  // ─── Cross-Device Portability — AC 6 ────────────────────────────────

  describe('AC 6: adding a store directory immediately makes its data visible', () => {
    it('newly added store projects are visible via listAllProjects() without extra registration', async () => {
      // Set up a third store directory that exists on disk with projects already seeded
      const storePath3 = join(tempDir, 'store-3');
      await mkdir(storePath3, { recursive: true });
      await seedProject(storePath3, 'repo-c', '2026-03-01-new-plan');

      // Build a StoreRouter that includes the new store-3 in its config
      const config = makeConfig([{ id: 'store-3', path: storePath3, label: 'New Store' }]);
      const manager = new MultiStoreManager(new StoreRouter(config));

      const projects = await manager.listAllProjects();
      const fromStore3 = projects.filter((p) => p.store_id === 'store-3');
      expect(fromStore3).toHaveLength(1);
      expect(fromStore3[0]!.slug).toBe('2026-03-01-new-plan');
    });

    it('newly added store registry is visible via getMergedRegistry() without extra registration', async () => {
      const storePath3 = join(tempDir, 'store-3');
      await mkdir(storePath3, { recursive: true });

      // The new store has its own .repositories.json pre-populated
      await saveRegistry(storePath3, makeRegistry('repo-from-store-3'));

      const config = makeConfig([{ id: 'store-3', path: storePath3, label: 'New Store' }]);
      const manager = new MultiStoreManager(new StoreRouter(config));

      const merged = await manager.getMergedRegistry();
      const entry = merged.find((e) => e.id === 'repo-from-store-3');
      expect(entry).toBeDefined();
      expect(entry!.store_id).toBe('store-3');
    });
  });
});
