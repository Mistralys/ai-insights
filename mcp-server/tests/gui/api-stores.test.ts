/**
 * Tests for handleGetStores (WP-012 — AC-1).
 *
 * Coverage:
 *   AC-1: GET /api/stores returns the list of registered stores with accurate
 *         project and repository counts.
 *
 * Approach: vi.mock for store-context (to control isStoreContextInitialized /
 * getStoreRouter); real temp directories for accurate LedgerStore.listAllProjects()
 * and loadRegistry() I/O (matches production code paths).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock store-context BEFORE importing the handler (vi.mock is hoisted).
// Default: single-store mode (context not initialized).
// ---------------------------------------------------------------------------
vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: vi.fn<[], boolean>().mockReturnValue(false),
  getStoreRouter: vi.fn(),
  getMultiStoreManager: vi.fn(),
}));

import { handleGetStores } from '../../gui/api.js';
import {
  isStoreContextInitialized,
  getStoreRouter,
} from '../../src/storage/store-context.js';

const mockIsInitialized    = vi.mocked(isStoreContextInitialized);
const mockGetStoreRouter   = vi.mocked(getStoreRouter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seeds a minimal project .meta.json file (namespaced layout: storePath/repoName/slug/).
 * Uses the minimum fields required by ProjectMetaSchema.
 */
async function seedProject(storePath: string, repoName: string, slug: string): Promise<void> {
  const dir = join(storePath, repoName, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, '.meta.json'),
    JSON.stringify({
      slug,
      plan_path: `/fake/${repoName}/docs/agents/plans/${slug}/plan.md`,
      status: 'IN_PROGRESS',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-01T00:00:00Z',
    }),
    'utf-8'
  );
}

/**
 * Seeds a repository entry into the .repositories.json registry.
 * Appends to existing entries when the file already exists.
 */
async function seedRepository(storePath: string, repoId: string, label: string): Promise<void> {
  const registryPath = join(storePath, '.repositories.json');
  let existing: { repositories: unknown[] } = { repositories: [] };
  try {
    const raw = await readFile(registryPath, 'utf-8');
    existing = JSON.parse(raw) as { repositories: unknown[] };
  } catch {
    // File doesn't exist yet — start fresh
  }
  existing.repositories.push({
    id: repoId,
    label,
    folder_names: [repoId],
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  });
  await writeFile(registryPath, JSON.stringify(existing), 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handleGetStores (AC-1)', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-stores-'));
    vi.clearAllMocks();
    // Restore default: legacy single-store mode
    mockIsInitialized.mockReturnValue(false);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ── Legacy / single-store mode (store context not initialized) ─────────

  describe('legacy mode', () => {
    it('returns exactly one store entry', async () => {
      const result = await handleGetStores(ledgerRoot);
      expect(result).toHaveLength(1);
    });

    it('returns the default store descriptor', async () => {
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]).toMatchObject({
        id:    'default',
        label: 'Default Store',
        path:  ledgerRoot,
      });
    });

    it('reports zero project_count on an empty store', async () => {
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.project_count).toBe(0);
    });

    it('reports zero repository_count on an empty store', async () => {
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.repository_count).toBe(0);
    });

    it('reflects a seeded project in project_count', async () => {
      await seedProject(ledgerRoot, 'my-repo', '2026-01-01-test-plan');
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.project_count).toBe(1);
    });

    it('counts multiple seeded projects accurately', async () => {
      await seedProject(ledgerRoot, 'repo-a', '2026-01-01-plan-one');
      await seedProject(ledgerRoot, 'repo-a', '2026-01-02-plan-two');
      await seedProject(ledgerRoot, 'repo-b', '2026-02-01-plan-three');
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.project_count).toBe(3);
    });

    it('reflects a seeded repository in repository_count', async () => {
      await seedRepository(ledgerRoot, 'my-repo', 'My Repo');
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.repository_count).toBe(1);
    });

    it('counts multiple seeded repositories accurately', async () => {
      await seedRepository(ledgerRoot, 'repo-a', 'Repo A');
      await seedRepository(ledgerRoot, 'repo-b', 'Repo B');
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.repository_count).toBe(2);
    });

    it('path field matches the provided ledgerRoot exactly', async () => {
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.path).toBe(ledgerRoot);
    });

    it('does not call getStoreRouter() in legacy mode', async () => {
      await handleGetStores(ledgerRoot);
      expect(mockGetStoreRouter).not.toHaveBeenCalled();
    });
  });

  // ── Multi-store mode (store context initialized) ───────────────────────

  describe('multi-store mode', () => {
    let storeA: string;
    let storeB: string;

    beforeEach(async () => {
      storeA = await mkdtemp(join(tmpdir(), 'store-a-'));
      storeB = await mkdtemp(join(tmpdir(), 'store-b-'));
      mockIsInitialized.mockReturnValue(true);
    });

    afterEach(async () => {
      await rm(storeA, { recursive: true, force: true });
      await rm(storeB, { recursive: true, force: true });
    });

    it('returns one entry per configured store', async () => {
      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
      });
      const result = await handleGetStores(ledgerRoot);
      expect(result).toHaveLength(2);
    });

    it('entries carry id, label, and path from the store config', async () => {
      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
      });
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]).toMatchObject({ id: 'store-a', label: 'Store A', path: storeA });
      expect(result[1]).toMatchObject({ id: 'store-b', label: 'Store B', path: storeB });
    });

    it('reports zero counts on empty stores', async () => {
      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
      });
      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.project_count).toBe(0);
      expect(result[0]!.repository_count).toBe(0);
      expect(result[1]!.project_count).toBe(0);
      expect(result[1]!.repository_count).toBe(0);
    });

    it('counts are per-store and independent', async () => {
      await seedProject(storeA, 'repo-a', '2026-01-01-plan-one');
      await seedProject(storeA, 'repo-a', '2026-01-02-plan-two');
      await seedRepository(storeB, 'repo-b', 'Repo B');

      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
      });

      const result = await handleGetStores(ledgerRoot);
      const a = result.find((s) => s.id === 'store-a')!;
      const b = result.find((s) => s.id === 'store-b')!;

      expect(a.project_count).toBe(2);
      expect(a.repository_count).toBe(0);
      expect(b.project_count).toBe(0);
      expect(b.repository_count).toBe(1);
    });

    it('ignores ledgerRoot content when in multi-store mode', async () => {
      // Plant data in ledgerRoot — should NOT appear since stores are used instead
      await seedProject(ledgerRoot, 'repo-x', '2026-01-01-plan');
      await seedRepository(ledgerRoot, 'repo-x', 'Repo X');

      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [{ id: 'store-a', path: storeA, label: 'Store A' }],
      });

      const result = await handleGetStores(ledgerRoot);
      expect(result[0]!.project_count).toBe(0);
      expect(result[0]!.repository_count).toBe(0);
    });

    it('supports a single-store multi-store configuration', async () => {
      await seedProject(storeA, 'repo-a', '2026-01-01-plan');
      await seedRepository(storeA, 'repo-a', 'Repo A');

      mockGetStoreRouter.mockReturnValue({
        getAllStores: () => [{ id: 'store-only', path: storeA, label: 'Only Store' }],
      });

      const result = await handleGetStores(ledgerRoot);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'store-only', label: 'Only Store', path: storeA });
      expect(result[0]!.project_count).toBe(1);
      expect(result[0]!.repository_count).toBe(1);
    });
  });
});
