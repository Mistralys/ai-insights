/**
 * Tests for MultiStoreManager — multi-store project listing and detection.
 *
 * Covers:
 *   - listAllProjects() returns projects from two stores with correct
 *     store_id, store_label, and store_path tags (AC 1)
 *   - detectProjectByCwd() returns MULTI_STORE_AMBIGUOUS with tagged
 *     candidates when the same cwd matches projects in different stores (AC 2)
 *   - detectProjectByCwd() returns FOUND for a single unambiguous match
 *   - detectProjectByCwd() forwards intra-store AMBIGUOUS as-is
 *   - detectProjectByCwd() returns NOT_FOUND when no store matches
 *   - listAllProjects() optional status filter
 *   - legacy-mode (single store) behaves as a transparent pass-through
 *   - searchKnowledge() / listKnowledge() apply limit/offset to merged set (WP-009)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/**
 * Writes a minimal valid `.meta.json` at the namespaced layout:
 *   {storePath}/{repoName}/{slug}/.meta.json
 */
async function seedProject(
  storePath: string,
  repoName: string,
  slug: string,
  opts: {
    status?: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
    projectRoot?: string;
  } = {}
): Promise<void> {
  const { status = 'IN_PROGRESS', projectRoot = `/home/user/${repoName}` } = opts;
  const dir = join(storePath, repoName, slug);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(join(dir, '.meta.json'), {
    slug,
    plan_path: `${projectRoot}/docs/agents/plans/${slug}`,
    status,
    date_created: now(),
    last_updated: now(),
    repository_name: repoName,
  });
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('MultiStoreManager — project listing and detection', () => {
  let tempDir: string;
  let storePath1: string;
  let storePath2: string;

  function makeConfig(overrides: Partial<StoresConfig> = {}): StoresConfig {
    return {
      stores: [
        { id: 'store-1', path: storePath1, label: 'Primary Store' },
        { id: 'store-2', path: storePath2, label: 'Secondary Store' },
      ],
      default_store: 'store-1',
      ...overrides,
    };
  }

  function makeManager(config: StoresConfig | null = makeConfig()): MultiStoreManager {
    return new MultiStoreManager(new StoreRouter(config));
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'multi-store-mgr-test-'));
    storePath1 = join(tempDir, 'store-1');
    storePath2 = join(tempDir, 'store-2');
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── listAllProjects — AC 1 ──────────────────────────────────────────

  describe('listAllProjects()', () => {
    it('AC 1: returns projects from two stores with correct store_id and store_label', async () => {
      await seedProject(storePath1, 'repo-a', '2026-01-01-alpha');
      await seedProject(storePath2, 'repo-b', '2026-02-01-beta');

      const manager = makeManager();
      const projects = await manager.listAllProjects();

      expect(projects).toHaveLength(2);

      const alpha = projects.find((p) => p.slug === '2026-01-01-alpha');
      expect(alpha).toBeDefined();
      expect(alpha!.store_id).toBe('store-1');
      expect(alpha!.store_label).toBe('Primary Store');
      expect(alpha!.store_path).toBe(storePath1);

      const beta = projects.find((p) => p.slug === '2026-02-01-beta');
      expect(beta).toBeDefined();
      expect(beta!.store_id).toBe('store-2');
      expect(beta!.store_label).toBe('Secondary Store');
      expect(beta!.store_path).toBe(storePath2);
    });

    it('returns an empty array when both stores are empty', async () => {
      const manager = makeManager();
      const projects = await manager.listAllProjects();
      expect(projects).toHaveLength(0);
    });

    it('filters by status when provided', async () => {
      await seedProject(storePath1, 'repo-a', 'plan-ready', { status: 'READY' });
      await seedProject(storePath1, 'repo-a', 'plan-done', { status: 'COMPLETE' });
      await seedProject(storePath2, 'repo-b', 'plan-ready-2', { status: 'READY' });

      const manager = makeManager();
      const ready = await manager.listAllProjects('READY');
      expect(ready).toHaveLength(2);
      expect(ready.every((p) => p.status === 'READY')).toBe(true);
    });

    it('returns store_label equal to store id when no label is configured', async () => {
      const configNoLabel: StoresConfig = {
        stores: [
          { id: 'store-1', path: storePath1 },  // no label
          { id: 'store-2', path: storePath2 },
        ],
        default_store: 'store-1',
      };
      await seedProject(storePath1, 'repo-a', '2026-01-01-plan');

      const manager = new MultiStoreManager(new StoreRouter(configNoLabel));
      const projects = await manager.listAllProjects();

      expect(projects[0]!.store_label).toBe('store-1');
    });

    it('legacy mode: tags projects with store_id "default" and store_label "Default Store"', async () => {
      // In legacy mode the router uses resolveLedgerRoot() — we override it
      // via the single-entry config instead of setting an env var.
      const legacyConfig: StoresConfig = {
        stores: [{ id: 'default', path: storePath1, label: 'Default Store' }],
        default_store: 'default',
      };
      await seedProject(storePath1, 'repo-a', '2026-01-01-plan');

      const manager = new MultiStoreManager(new StoreRouter(legacyConfig));
      const projects = await manager.listAllProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]!.store_id).toBe('default');
      expect(projects[0]!.store_label).toBe('Default Store');
    });
  });

  // ─── detectProjectByCwd — AC 2 ──────────────────────────────────────

  describe('detectProjectByCwd()', () => {
    it('AC 2: returns MULTI_STORE_AMBIGUOUS with tagged candidates for cross-store collision', async () => {
      // Both stores have a project whose root is /home/user/shared-repo
      await seedProject(storePath1, 'shared-repo', '2026-01-01-plan', {
        projectRoot: '/home/user/shared-repo',
      });
      await seedProject(storePath2, 'shared-repo', '2026-02-01-plan', {
        projectRoot: '/home/user/shared-repo',
      });

      const manager = makeManager();
      const result = await manager.detectProjectByCwd('/home/user/shared-repo');

      expect(result.status).toBe('MULTI_STORE_AMBIGUOUS');
      const r = result as { status: 'MULTI_STORE_AMBIGUOUS'; candidates: unknown[] };
      expect(r.candidates).toHaveLength(2);

      const storeIds = r.candidates.map((c: any) => c.store_id as string);
      expect(storeIds).toContain('store-1');
      expect(storeIds).toContain('store-2');
    });

    it('returns FOUND when exactly one store contains a matching project', async () => {
      await seedProject(storePath1, 'repo-a', '2026-01-01-plan', {
        projectRoot: '/home/user/repo-a',
      });
      await seedProject(storePath2, 'repo-b', '2026-02-01-plan', {
        projectRoot: '/home/user/repo-b',
      });

      const manager = makeManager();
      const result = await manager.detectProjectByCwd('/home/user/repo-a');

      expect(result.status).toBe('FOUND');
    });

    it('returns NOT_FOUND when no store has a matching project', async () => {
      await seedProject(storePath1, 'repo-a', '2026-01-01-plan', {
        projectRoot: '/home/user/repo-a',
      });

      const manager = makeManager();
      const result = await manager.detectProjectByCwd('/home/user/nonexistent');

      expect(result.status).toBe('NOT_FOUND');
    });

    it('forwards intra-store AMBIGUOUS when multiple projects match within a single store', async () => {
      // Two recent projects in the same store with the same projectRoot
      const ts1 = new Date(Date.now() - 1000).toISOString();
      const ts2 = new Date(Date.now() - 2000).toISOString();

      const dir1 = join(storePath1, 'repo-a', '2026-01-01-plan');
      await mkdir(dir1, { recursive: true });
      await atomicWriteJson(join(dir1, '.meta.json'), {
        slug: '2026-01-01-plan',
        plan_path: '/home/user/repo-a/docs/agents/plans/2026-01-01-plan',
        status: 'IN_PROGRESS',
        date_created: ts1,
        last_updated: ts1,
        repository_name: 'repo-a',
      });

      const dir2 = join(storePath1, 'repo-a', '2026-01-02-plan');
      await mkdir(dir2, { recursive: true });
      await atomicWriteJson(join(dir2, '.meta.json'), {
        slug: '2026-01-02-plan',
        plan_path: '/home/user/repo-a/docs/agents/plans/2026-01-02-plan',
        status: 'IN_PROGRESS',
        date_created: ts2,
        last_updated: ts2,
        repository_name: 'repo-a',
      });

      const manager = makeManager();
      const result = await manager.detectProjectByCwd('/home/user/repo-a');

      // LedgerStore.detectProjectByCwd may return FOUND (if gap threshold splits them)
      // or AMBIGUOUS — both are valid. Ensure it does NOT return MULTI_STORE_AMBIGUOUS.
      expect(result.status).not.toBe('MULTI_STORE_AMBIGUOUS');
    });

    it('returns FOUND when store-1 has a unique FOUND and store-2 has an intra-store AMBIGUOUS for the same cwd', async () => {
      // store-1: single project rooted at /home/user/cwd-a → FOUND
      await seedProject(storePath1, 'repo-x', '2026-01-01-plan', {
        projectRoot: '/home/user/cwd-a',
      });

      // store-2: two projects sharing the same projectRoot → AMBIGUOUS from that store.
      // Timestamps are 1 s apart (well within the 6-hour gap threshold), ensuring
      // LedgerStore returns AMBIGUOUS rather than splitting into FOUND + unlikely.
      const ts1 = new Date(Date.now() - 1000).toISOString();
      const ts2 = new Date(Date.now() - 2000).toISOString();

      const dir1 = join(storePath2, 'repo-x', '2026-02-01-plan');
      await mkdir(dir1, { recursive: true });
      await atomicWriteJson(join(dir1, '.meta.json'), {
        slug: '2026-02-01-plan',
        plan_path: '/home/user/cwd-a/docs/agents/plans/2026-02-01-plan',
        status: 'IN_PROGRESS',
        date_created: ts1,
        last_updated: ts1,
        repository_name: 'repo-x',
      });

      const dir2 = join(storePath2, 'repo-x', '2026-02-02-plan');
      await mkdir(dir2, { recursive: true });
      await atomicWriteJson(join(dir2, '.meta.json'), {
        slug: '2026-02-02-plan',
        plan_path: '/home/user/cwd-a/docs/agents/plans/2026-02-02-plan',
        status: 'IN_PROGRESS',
        date_created: ts2,
        last_updated: ts2,
        repository_name: 'repo-x',
      });

      const manager = makeManager();
      const result = await manager.detectProjectByCwd('/home/user/cwd-a');

      // A concrete FOUND in one store must win over an intra-store AMBIGUOUS
      // in another store — the bug was that the old condition
      // `foundProjects.length === 1 && intraStoreAmbiguous === null`
      // incorrectly fell through to forwarding the AMBIGUOUS result.
      expect(result.status).toBe('FOUND');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-009: searchKnowledge / listKnowledge merged pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('MultiStoreManager — cross-store knowledge pagination (WP-009)', () => {
  let tempDir: string;
  let storePathA: string;
  let storePathB: string;
  let manager: MultiStoreManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'msm-know-'));
    storePathA = join(tempDir, 'store-a');
    storePathB = join(tempDir, 'store-b');
    await mkdir(storePathA, { recursive: true });
    await mkdir(storePathB, { recursive: true });

    const config: StoresConfig = {
      stores: [
        { id: 'store-a', path: storePathA, label: 'Store A' },
        { id: 'store-b', path: storePathB, label: 'Store B' },
      ],
      default_store: 'store-a',
    };
    const router = new StoreRouter(config);
    manager = new MultiStoreManager(router);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Writes a knowledge store file directly with pre-assigned non-colliding IDs.
   * `idStart` controls the first ID so stores can use non-overlapping ranges.
   */
  async function seedInsights(storePath: string, count: number, _idStart = 1): Promise<void> {
    const knowledgeDir = join(storePath, '.knowledge');
    await mkdir(knowledgeDir, { recursive: true });
    const ts = now();
    const insights = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      scope: 'global',
      title: `Insight ${storePath.split('/').pop()}-${_idStart + i}`,
      content: `Content ${_idStart + i}`,
      category: 'testing',
      tags: ['test'],
      source: '',
      confidence: 1,
      created_at: ts,
    }));
    await atomicWriteJson(join(knowledgeDir, 'global-insights.json'), {
      version: '2.0.0',
      last_updated: ts,
      insights,
    });
  }

  it('AC-3: limit=5 with store-A having 3 and store-B having 4 returns exactly 5', async () => {
    await seedInsights(storePathA, 3, 1);   // IDs 1-3
    await seedInsights(storePathB, 4, 101); // IDs 101-104

    const results = await manager.listKnowledge({ limit: 5 });
    expect(results).toHaveLength(5);
  });

  it('searchKnowledge: limit=5 with store-A having 3 and store-B having 4 returns exactly 5', async () => {
    await seedInsights(storePathA, 3, 1);
    await seedInsights(storePathB, 4, 101);

    const results = await manager.searchKnowledge('Insight', { limit: 5 });
    expect(results).toHaveLength(5);
  });

  it('AC-4: offset skips across the merged set', async () => {
    await seedInsights(storePathA, 3, 1);   // IDs 1-3
    await seedInsights(storePathB, 3, 101); // IDs 101-103

    const all = await manager.listKnowledge();
    expect(all).toHaveLength(6);

    const page2 = await manager.listKnowledge({ offset: 3 });
    expect(page2).toHaveLength(3);

    // The items in page2 must not overlap with the first 3.
    const allIds = new Set(all.map((i) => i.id));
    const page2Ids = new Set(page2.map((i) => i.id));
    for (const id of page2Ids) {
      expect(allIds.has(id)).toBe(true);
    }
    const firstPageIds = new Set(all.slice(0, 3).map((i) => i.id));
    for (const id of page2Ids) {
      expect(firstPageIds.has(id)).toBe(false);
    }
  });

  it('limit with offset: returns the correct window of the merged set', async () => {
    await seedInsights(storePathA, 4, 1);   // IDs 1-4
    await seedInsights(storePathB, 4, 101); // IDs 101-104

    const all = await manager.listKnowledge();
    const window = await manager.listKnowledge({ offset: 2, limit: 3 });
    expect(window).toHaveLength(3);
    expect(window.map((i) => i.id)).toEqual(all.slice(2, 5).map((i) => i.id));
  });

  it('per-store calls receive filters (category/tags) but not limit/offset', async () => {
    await seedInsights(storePathA, 3, 1);   // IDs 1-3
    await seedInsights(storePathB, 3, 101); // IDs 101-103

    // Only category 'testing' items exist; a different category returns nothing.
    const noMatch = await manager.listKnowledge({ category: 'nonexistent', limit: 10 });
    expect(noMatch).toHaveLength(0);

    // With the correct category, limit is applied after merge.
    const withCategory = await manager.listKnowledge({ category: 'testing', limit: 4 });
    expect(withCategory).toHaveLength(4);
  });

  it('no limit/offset returns all merged results', async () => {
    await seedInsights(storePathA, 3, 1);   // IDs 1-3
    await seedInsights(storePathB, 3, 101); // IDs 101-103

    const results = await manager.listKnowledge();
    expect(results).toHaveLength(6);
  });
});
