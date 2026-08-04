/**
 * Integration tests for ledger_get_repository_context in multi-store mode.
 *
 * WP-007: Verifies cross-store data aggregation using the established
 * setStoreContext() mocking pattern.
 *
 * Tests cover:
 *   AC-1: projects resolved across multiple stores
 *   AC-2: insights deduplicated by UUID across stores with include_insights: true
 *   AC-3: max_projects limits the merged project list correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { _internal } from '../../src/tools/repository-context.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';

const { getRepositoryContext } = _internal;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(stores: Array<{ id: string; path: string; label: string }>): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: stores[0]!.id,
  };
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

/** Seeds a minimal .meta.json at {storePath}/{repoFolder}/{slug}/.meta.json */
async function seedProject(
  storePath: string,
  repoFolder: string,
  slug: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const dir = join(storePath, repoFolder, slug);
  await mkdir(dir, { recursive: true });
  const meta = {
    slug,
    plan_path: `/fake/${repoFolder}/docs/agents/plans/${slug}`,
    status: 'COMPLETE',
    date_created: overrides.date_created ?? '2026-01-01T00:00:00Z',
    last_updated: overrides.last_updated ?? '2026-01-01T00:00:00Z',
    ...overrides,
  };
  await writeFile(join(dir, '.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

/** Writes a minimal .repositories.json claiming a repo in a store. */
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

/** Initialises store context with two stores. */
async function initTwoStoreContext(
  storeAPath: string,
  storeBPath: string
): Promise<{ router: StoreRouter; manager: MultiStoreManager }> {
  const config = makeConfig([
    { id: 'store-a', path: storeAPath, label: 'Store A' },
    { id: 'store-b', path: storeBPath, label: 'Store B' },
  ]);
  const router = new StoreRouter(config);
  const manager = new MultiStoreManager(router);
  setStoreContext(router, manager);
  return { router, manager };
}

/** Resets the singleton to legacy (single-store) mode. */
function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── Shared state ─────────────────────────────────────────────────────────────

let storeA: string;
let storeB: string;

beforeEach(async () => {
  storeA = await mkdtemp(join(tmpdir(), 'rc-multi-a-'));
  storeB = await mkdtemp(join(tmpdir(), 'rc-multi-b-'));
});

afterEach(async () => {
  restoreLegacyContext();
  await rm(storeA, { recursive: true, force: true });
  await rm(storeB, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WP-007: getRepositoryContext — multi-store data aggregation', () => {
  it('AC-1: resolves projects seeded in different stores for the same repository', async () => {
    await initTwoStoreContext(storeA, storeB);

    // Seed one project in each store under the same repo folder name
    await seedProject(storeA, 'my-repo', 'proj-alpha', { date_created: '2026-02-01T00:00:00Z' });
    await seedProject(storeB, 'my-repo', 'proj-beta',  { date_created: '2026-01-01T00:00:00Z' });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });

    const data = parseResult(result as any) as any;
    expect(data.total_projects).toBe(2);

    const slugs = (data.projects as Array<{ slug: string }>).map((p) => p.slug);
    expect(slugs).toContain('proj-alpha');
    expect(slugs).toContain('proj-beta');
  });

  it('AC-2: aggregates insights from all stores when include_insights is true, deduplicating by UUID', async () => {
    await initTwoStoreContext(storeA, storeB);

    // A UUID written to BOTH stores forces the dedup Set<string> path.
    // A second UUID written only to store-b proves cross-store aggregation.
    const SHARED_UUID = '00000000-0000-0000-0000-000000000042';
    const UNIQUE_UUID_B = '00000000-0000-0000-0000-000000000099';

    async function writeGlobalStore(storePath: string, insights: unknown[]): Promise<void> {
      const dir = join(storePath, '.knowledge');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'global-insights.json'),
        JSON.stringify({ version: '2.0.0', last_updated: now(), insights }),
        'utf-8'
      );
    }

    const baseInsight = {
      scope: 'global', category: 'testing', tags: [], source: '',
      confidence: 1, created_at: now(),
    };

    // Store A: shared UUID only
    await writeGlobalStore(storeA, [
      { ...baseInsight, id: SHARED_UUID, title: 'Shared insight', content: 'Shared' },
    ]);

    // Store B: shared UUID (duplicate) + unique UUID
    await writeGlobalStore(storeB, [
      { ...baseInsight, id: SHARED_UUID, title: 'Shared insight copy', content: 'Dupe' },
      { ...baseInsight, id: UNIQUE_UUID_B, title: 'Unique from B', content: 'Unique' },
    ]);

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: true,
    });

    const data = parseResult(result as any) as any;
    const insights = data.relevant_insights as Array<{ id: string }>;

    // SHARED_UUID must appear exactly once — dedup via Set<string>
    expect(insights.filter((i) => i.id === SHARED_UUID)).toHaveLength(1);
    // UNIQUE_UUID_B must appear once
    expect(insights.filter((i) => i.id === UNIQUE_UUID_B)).toHaveLength(1);
    // Total: 2 unique insights
    expect(insights).toHaveLength(2);
  });

  it('AC-3: max_projects caps the returned projects[] while total_projects reflects full count', async () => {
    await initTwoStoreContext(storeA, storeB);

    // Seed 3 projects across the two stores — descending by date_created
    await seedProject(storeA, 'my-repo', 'proj-1', { date_created: '2026-03-01T00:00:00Z' });
    await seedProject(storeA, 'my-repo', 'proj-2', { date_created: '2026-02-01T00:00:00Z' });
    await seedProject(storeB, 'my-repo', 'proj-3', { date_created: '2026-01-01T00:00:00Z' });

    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
      max_projects: 2,
    });

    const data = parseResult(result as any) as any;
    // total_projects counts all 3 projects found across stores
    expect(data.total_projects).toBe(3);
    // projects[] is capped at max_projects (2)
    expect((data.projects as Array<unknown>).length).toBe(2);
    // Sorted descending — proj-1 (2026-03) first, proj-2 (2026-02) second
    expect((data.projects as Array<{ slug: string }>)[0]!.slug).toBe('proj-1');
    expect((data.projects as Array<{ slug: string }>)[1]!.slug).toBe('proj-2');
  });

  it('AC-4 (pattern): setStoreContext() is used for multi-store mode — context can be reset to legacy', async () => {
    // Verify the pattern itself: initialising and restoring is idempotent
    const { router } = await initTwoStoreContext(storeA, storeB);
    expect(router.isMultiStoreMode()).toBe(true);

    restoreLegacyContext();

    // After restoring, a fresh call without store context returns an empty project list
    const result = await getRepositoryContext({
      repository_name: 'my-repo',
      include_insights: false,
    });
    const data = parseResult(result as any) as any;
    // Legacy mode — no projects seeded in ledger root fallback
    expect(data.total_projects).toBe(0);
  });
});
