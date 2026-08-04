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
): Promise<string> {
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

/** Write a global knowledge store file with a single insight using a fixed UUID. */
async function seedInsightWithId(
  storePath: string,
  id: string,
  title: string
): Promise<void> {
  const knowledgeDir = join(storePath, '.knowledge');
  await mkdir(knowledgeDir, { recursive: true });
  const filePath = join(knowledgeDir, 'global-insights.json');
  await atomicWriteJson(filePath, {
    version: '2.0.0',
    last_updated: now(),
    insights: [
      {
        id,
        scope: 'global',
        title,
        content: 'Seeded content',
        category: 'test',
        tags: [],
        source: '',
        created_at: now(),
        confidence: 1,
      },
    ],
  });
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
      await addGlobalInsight(storePath1, 'TypeScript strict mode', 'Enable strict mode.');
      await addGlobalInsight(storePath2, 'Python type hints', 'Use type hints.');

      const manager = makeManager();
      const results = await manager.searchKnowledge('');

      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('TypeScript strict mode');
      expect(titles).toContain('Python type hints');
    });

    it('AC 5: deduplicates by insight id — first-seen wins when same UUID appears in both stores', async () => {
      // Manually seed the same UUID in both stores to simulate cross-device sync overlap.
      const sharedUUID = '11111111-1111-1111-1111-111111111111';
      await seedInsightWithId(storePath1, sharedUUID, 'Store 1 — shared insight');
      await seedInsightWithId(storePath2, sharedUUID, 'Store 2 — shared insight');

      const manager = makeManager();
      const results = await manager.searchKnowledge('shared insight');

      // Only one result for the shared UUID; must be from store-1 (first-seen wins)
      const dedupById = results.filter((r) => r.id === sharedUUID);
      expect(dedupById).toHaveLength(1);
      expect(dedupById[0]!.title).toBe('Store 1 — shared insight');
    });

    it('returns unique results across stores when ids do not clash', async () => {
      // Add two insights to store-1 and one unique insight to store-2.
      // Since UUIDs are globally unique, all three insights have different ids.
      await addGlobalInsight(storePath1, 'S1 Insight A', 'Alpha content');
      await addGlobalInsight(storePath1, 'S1 Insight B', 'Beta content');
      await addGlobalInsight(storePath2, 'S2 Insight A', 'Gamma content');

      const manager = makeManager();
      const results = await manager.searchKnowledge('');

      // All three UUIDs are distinct — all three insights are returned.
      const uniqueIds = [...new Set(results.map((r) => r.id))];
      expect(uniqueIds.length).toBe(results.length); // no duplicate ids in result
      expect(results.length).toBe(3); // 3 unique UUIDs
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
      // Manually seed the same UUID in both stores to simulate cross-device sync overlap.
      const sharedUUID = '22222222-2222-2222-2222-222222222222';
      await seedInsightWithId(storePath1, sharedUUID, 'S1 Insight');
      await seedInsightWithId(storePath2, sharedUUID, 'S2 Insight');

      const manager = makeManager();
      const results = await manager.listKnowledge({});

      // The shared UUID exists in both stores; only store-1's version should appear
      const sharedResults = results.filter((r) => r.id === sharedUUID);
      expect(sharedResults).toHaveLength(1);
      expect(sharedResults[0]!.title).toBe('S1 Insight');
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
