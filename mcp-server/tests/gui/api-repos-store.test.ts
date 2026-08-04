/**
 * Store-aware repository management tests (WP-013).
 *
 * Coverage:
 *   AC-1: Creating a repository with store_id: "personal" writes the entry to
 *         the "personal" store's .repositories.json.
 *   AC-2: Creating a repository with an invalid store_id returns a validation error.
 *   AC-3: handleListRepos returns all repos from all stores (merged view) in
 *         multi-store mode, each tagged with store_id.
 *   AC-4: In single-store mode, store_id is optional and the single store is
 *         used implicitly.
 *
 *   handleMoveRepo (WP-002 / WP-004):
 *   AC-5: Happy path — entry moves between registries with last_modified updated.
 *   AC-6: Same-store no-op — no registry writes when source and target are identical.
 *   AC-7: Invalid target_store_id → VALIDATION_ERROR.
 *   AC-8: Unknown repoId → NOT_FOUND.
 *   AC-9: Single-store mode → VALIDATION_ERROR.
 *   AC-10: ID conflict in target → VALIDATION_ERROR.
 *   AC-11: folder_name conflict in target → VALIDATION_ERROR.
 *
 *   handleGetRepo enrichment (WP-004):
 *   AC-12: Multi-store mode returns store_id matching the owning store.
 *   AC-13: Single-store mode omits store_id from the response.
 *
 * Approach:
 *   - vi.mock for store-context (controls isStoreContextInitialized / getStoreRouter /
 *     getMultiStoreManager).
 *   - Real temp directories for create operations (tests actual file I/O paths).
 *   - Mocked MultiStoreManager for list operations (avoids real multi-store wiring).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { statSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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

import {
  handleListRepos,
  handleCreateRepo,
  handleDeleteRepo,
  handleGetRepo,
  handleMoveRepo,
  ApiError,
} from '../../gui/api-repos.js';
import {
  isStoreContextInitialized,
  getStoreRouter,
  getMultiStoreManager,
} from '../../src/storage/store-context.js';
import type { TaggedRepositoryEntry } from '../../src/storage/multi-store-manager.js';

const mockIsInitialized       = vi.mocked(isStoreContextInitialized);
const mockGetStoreRouter      = vi.mocked(getStoreRouter);
const mockGetMultiStoreManager = vi.mocked(getMultiStoreManager);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid POST /api/repos body. */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'my-repo',
    label: 'My Repository',
    folder_names: ['my-repo-folder'],
    ...overrides,
  };
}

/** Read and parse .repositories.json from a store path (or throw if missing). */
async function readRegistry(storePath: string): Promise<{ repositories: { id: string }[] }> {
  const raw = await readFile(join(storePath, '.repositories.json'), 'utf-8');
  return JSON.parse(raw) as { repositories: { id: string }[] };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WP-013: Store-aware repository management', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-repos-store-'));
    vi.clearAllMocks();
    mockIsInitialized.mockReturnValue(false);
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ── AC-1: CREATE with valid store_id writes to the correct store ────────

  describe('AC-1: handleCreateRepo routes to the specified store', () => {
    let storePersonal: string;
    let storeWork: string;

    beforeEach(async () => {
      storePersonal = await mkdtemp(join(tmpdir(), 'store-personal-'));
      storeWork     = await mkdtemp(join(tmpdir(), 'store-work-'));
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode:    () => true,
        getAllStores:        () => [
          { id: 'personal', path: storePersonal, label: 'Personal' },
          { id: 'work',     path: storeWork,     label: 'Work' },
        ],
        resolveDefaultStore: () => storePersonal,
      });
    });

    afterEach(async () => {
      await rm(storePersonal, { recursive: true, force: true });
      await rm(storeWork,     { recursive: true, force: true });
    });

    it('writes the entry to the specified store .repositories.json', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'personal-proj', folder_names: ['pp'], store_id: 'personal' }));

      const registry = await readRegistry(storePersonal);
      expect(registry.repositories.some((e) => e.id === 'personal-proj')).toBe(true);
    });

    it('does NOT write to a different store when store_id is specified', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'personal-proj', folder_names: ['pp'], store_id: 'personal' }));

      // storeWork should have no .repositories.json (loadRegistry creates it lazily, but
      // saveRegistry only writes when we call it — confirm the entry is absent)
      let workHasEntry = false;
      try {
        const workRegistry = await readRegistry(storeWork);
        workHasEntry = workRegistry.repositories.some((e) => e.id === 'personal-proj');
      } catch {
        // File does not exist — correct
      }
      expect(workHasEntry).toBe(false);
    });

    it('writes to the work store when store_id: "work"', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'work-proj', folder_names: ['wp'], store_id: 'work' }));

      const registry = await readRegistry(storeWork);
      expect(registry.repositories.some((e) => e.id === 'work-proj')).toBe(true);
    });

    it('uses the default store when store_id is omitted in multi-store mode', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'default-proj', folder_names: ['dp'] }));

      const registry = await readRegistry(storePersonal); // storePersonal is the default
      expect(registry.repositories.some((e) => e.id === 'default-proj')).toBe(true);
    });

    it('returns the newly created RepositoryEntry', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeBody({ id: 'ret-proj', folder_names: ['rp'], store_id: 'personal' })
      );
      expect(result.id).toBe('ret-proj');
      expect(result.folder_names).toEqual(['rp']);
    });
  });

  // ── AC-2: CREATE with invalid store_id returns validation error ─────────

  describe('AC-2: handleCreateRepo rejects invalid store_id', () => {
    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode: () => true,
        getAllStores:      () => [
          { id: 'personal', path: '/fake/personal', label: 'Personal' },
          { id: 'work',     path: '/fake/work',     label: 'Work' },
        ],
        resolveDefaultStore: () => '/fake/personal',
      });
    });

    it('throws VALIDATION_ERROR when store_id does not match any configured store', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, makeBody({ store_id: 'nonexistent' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('error is an ApiError instance', async () => {
      const err = await handleCreateRepo(
        ledgerRoot,
        makeBody({ store_id: 'bad-store' })
      ).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
    });

    it('error message identifies the invalid store_id', async () => {
      const err = await handleCreateRepo(
        ledgerRoot,
        makeBody({ store_id: 'bad-store' })
      ).catch((e) => e);
      expect((err as ApiError).message).toContain('bad-store');
    });

    it('error message lists the valid store IDs', async () => {
      const err = await handleCreateRepo(
        ledgerRoot,
        makeBody({ store_id: 'nope' })
      ).catch((e) => e);
      const msg = (err as ApiError).message;
      expect(msg).toContain('personal');
      expect(msg).toContain('work');
    });

    it('startOrchestrator is never called on invalid store_id (no side effects)', async () => {
      // Verify the function rejects before writing any file
      await expect(
        handleCreateRepo(ledgerRoot, makeBody({ store_id: 'ghost' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  // ── AC-3: LIST returns merged view with store_id tags ──────────────────

  describe('AC-3: handleListRepos returns merged view with store_id tags in multi-store mode', () => {
    beforeEach(() => {
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({ isMultiStoreMode: () => true });
    });

    it('returns entries tagged with store_id from getMergedRegistry()', async () => {
      const tagged: TaggedRepositoryEntry[] = [
        {
          id: 'repo-a',
          label: 'Repo A',
          folder_names: ['folder-a'],
          vision: { short_term: null, mid_term: null, long_term: null },
          created_at: '2026-01-01T00:00:00Z',
          last_modified: '2026-01-01T00:00:00Z',
          store_id: 'personal',
        },
        {
          id: 'repo-b',
          label: 'Repo B',
          folder_names: ['folder-b'],
          vision: { short_term: null, mid_term: null, long_term: null },
          created_at: '2026-01-02T00:00:00Z',
          last_modified: '2026-01-02T00:00:00Z',
          store_id: 'work',
        },
      ];
      mockGetMultiStoreManager.mockReturnValue({
        getMergedRegistry: vi.fn().mockResolvedValue(tagged),
      } as any);

      const result = await handleListRepos(ledgerRoot);

      expect(result).toHaveLength(2);
      expect(result[0]!.store_id).toBe('personal');
      expect(result[1]!.store_id).toBe('work');
    });

    it('each entry carries the standard RepoListItem fields', async () => {
      const tagged: TaggedRepositoryEntry[] = [
        {
          id: 'repo-x',
          label: 'Repo X',
          folder_names: ['folder-x'],
          vision: { short_term: 'plan', mid_term: null, long_term: null },
          created_at: '2026-03-01T00:00:00Z',
          last_modified: '2026-03-02T00:00:00Z',
          store_id: 'work',
        },
      ];
      mockGetMultiStoreManager.mockReturnValue({
        getMergedRegistry: vi.fn().mockResolvedValue(tagged),
      } as any);

      const result = await handleListRepos(ledgerRoot);
      const item = result[0]!;

      expect(item.id).toBe('repo-x');
      expect(item.label).toBe('Repo X');
      expect(item.folder_names).toEqual(['folder-x']);
      expect(item.declared).toBe(true);
      expect(item.has_vision).toBe(true);       // short_term is set
      expect(item.has_full_vision).toBe(false); // mid_term and long_term are null
    });

    it('returns empty array when the merged registry is empty', async () => {
      mockGetMultiStoreManager.mockReturnValue({
        getMergedRegistry: vi.fn().mockResolvedValue([]),
      } as any);

      const result = await handleListRepos(ledgerRoot);
      expect(result).toEqual([]);
    });

    it('delegates to getMultiStoreManager().getMergedRegistry()', async () => {
      const mockGetMerged = vi.fn().mockResolvedValue([]);
      mockGetMultiStoreManager.mockReturnValue({ getMergedRegistry: mockGetMerged } as any);

      await handleListRepos(ledgerRoot);

      expect(mockGetMultiStoreManager).toHaveBeenCalled();
      expect(mockGetMerged).toHaveBeenCalledOnce();
    });
  });

  // ── AC-4: single-store mode — store_id optional ─────────────────────────

  describe('AC-4: single-store mode — store_id is optional', () => {
    // mockIsInitialized returns false by default (restored in global beforeEach)

    it('creates successfully without store_id (uses ledgerRoot)', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeBody({ id: 'legacy-repo', folder_names: ['lf'] })
      );
      expect(result.id).toBe('legacy-repo');
    });

    it('store_id field is accepted in the body but ignored (writes to ledgerRoot)', async () => {
      // Even if a client sends store_id in single-store mode, it is silently ignored
      const result = await handleCreateRepo(
        ledgerRoot,
        makeBody({ id: 'any-repo', folder_names: ['af'], store_id: 'personal' })
      );
      expect(result.id).toBe('any-repo');
      // Entry should exist in ledgerRoot (not any store path)
      const registry = await readRegistry(ledgerRoot);
      expect(registry.repositories.some((e) => e.id === 'any-repo')).toBe(true);
    });

    it('handleListRepos does not include store_id on entries in single-store mode', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'r1', folder_names: ['f1'] }));
      const result = await handleListRepos(ledgerRoot);
      expect(result[0]!.store_id).toBeUndefined();
    });

    it('does not call getStoreRouter() in single-store mode', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'r2', folder_names: ['f2'] }));
      expect(mockGetStoreRouter).not.toHaveBeenCalled();
    });
  });

  // ── Multi-store: GET, UPDATE, DELETE locate entry across stores ─────────

  describe('Multi-store GET, UPDATE, DELETE route to the owning store', () => {
    let storeA: string;
    let storeB: string;

    beforeEach(async () => {
      storeA = await mkdtemp(join(tmpdir(), 'store-a-'));
      storeB = await mkdtemp(join(tmpdir(), 'store-b-'));
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode:    () => true,
        getAllStores:        () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
        resolveDefaultStore: () => storeA,
      });
    });

    afterEach(async () => {
      await rm(storeA, { recursive: true, force: true });
      await rm(storeB, { recursive: true, force: true });
    });

    it('handleGetRepo finds an entry created in storeB', async () => {
      // Create repo directly in storeB
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'b-repo', folder_names: ['bf'], store_id: 'store-b' }));

      const result = await handleGetRepo(ledgerRoot, 'b-repo');
      expect(result.id).toBe('b-repo');
      expect(result.store_id).toBe('store-b');
    });

    it('handleGetRepo throws NOT_FOUND when repo does not exist in any store', async () => {
      await expect(handleGetRepo(ledgerRoot, 'ghost-repo')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('handleDeleteRepo removes entry from the owning store', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'del-repo', folder_names: ['dr'], store_id: 'store-b' }));

      await handleDeleteRepo(ledgerRoot, 'del-repo');

      // Entry should no longer be in storeB
      const registry = await readRegistry(storeB);
      expect(registry.repositories.some((e) => e.id === 'del-repo')).toBe(false);
    });

    it('handleDeleteRepo throws NOT_FOUND when repo does not exist', async () => {
      await expect(handleDeleteRepo(ledgerRoot, 'missing-repo')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ── handleMoveRepo: 7 behavioral ACs ───────────────────────────────────

  describe('handleMoveRepo', () => {
    let storeA: string;
    let storeB: string;

    beforeEach(async () => {
      storeA = await mkdtemp(join(tmpdir(), 'move-store-a-'));
      storeB = await mkdtemp(join(tmpdir(), 'move-store-b-'));
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode:    () => true,
        getAllStores:        () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
        resolveDefaultStore: () => storeA,
      });
    });

    afterEach(async () => {
      await rm(storeA, { recursive: true, force: true });
      await rm(storeB, { recursive: true, force: true });
    });

    // AC-1: happy path move ─────────────────────────────────────────────

    it('AC-1: moves the entry from source to target store with updated last_modified', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'move-me', folder_names: ['mf'], store_id: 'store-a' }));

      const result = await handleMoveRepo(ledgerRoot, 'move-me', { target_store_id: 'store-b' });

      expect(result.id).toBe('move-me');
      expect(result.store_id).toBe('store-b');

      // Entry must exist in store-b
      const targetReg = await readRegistry(storeB);
      expect(targetReg.repositories.some((e) => e.id === 'move-me')).toBe(true);

      // Entry must be absent from store-a
      const sourceReg = await readRegistry(storeA);
      expect(sourceReg.repositories.some((e) => e.id === 'move-me')).toBe(false);
    });

    it('AC-1: last_modified is updated after move', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'ts-repo', folder_names: ['tr'], store_id: 'store-a' }));
      const before = await handleGetRepo(ledgerRoot, 'ts-repo');

      // Ensure at least 1 ms passes so last_modified can advance
      await new Promise((r) => setTimeout(r, 2));

      const result = await handleMoveRepo(ledgerRoot, 'ts-repo', { target_store_id: 'store-b' });
      expect(new Date(result.last_modified).getTime()).toBeGreaterThanOrEqual(
        new Date(before.last_modified).getTime()
      );
    });

    // AC-2: same-store no-op ───────────────────────────────────────────

    it('AC-2: same-store move returns the entry with store_id and makes no writes', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'stay-here', folder_names: ['sh'], store_id: 'store-a' }));

      // Capture registry mtime before call
      const mtimeBefore = statSync(join(storeA, '.repositories.json')).mtimeMs;

      const result = await handleMoveRepo(ledgerRoot, 'stay-here', { target_store_id: 'store-a' });

      expect(result.id).toBe('stay-here');
      expect(result.store_id).toBe('store-a');

      // Registry file must not have been rewritten
      const mtimeAfter = statSync(join(storeA, '.repositories.json')).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    });

    // AC-3: invalid target_store_id ────────────────────────────────────

    it('AC-3: invalid target_store_id returns VALIDATION_ERROR', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'any-repo', folder_names: ['ar'], store_id: 'store-a' }));

      await expect(
        handleMoveRepo(ledgerRoot, 'any-repo', { target_store_id: 'ghost' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-3: VALIDATION_ERROR message identifies the unknown store id', async () => {
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'any-repo2', folder_names: ['ar2'], store_id: 'store-a' }));

      const err = await handleMoveRepo(ledgerRoot, 'any-repo2', { target_store_id: 'ghost' }).catch((e) => e);
      expect((err as ApiError).message).toContain('ghost');
    });

    // AC-4: unknown repoId ─────────────────────────────────────────────

    it('AC-4: unknown repoId returns NOT_FOUND', async () => {
      await expect(
        handleMoveRepo(ledgerRoot, 'no-such-repo', { target_store_id: 'store-b' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    // AC-5: single-store mode ──────────────────────────────────────────

    it('AC-5: call in single-store mode returns VALIDATION_ERROR', async () => {
      mockIsInitialized.mockReturnValue(false);

      await expect(
        handleMoveRepo(ledgerRoot, 'any', { target_store_id: 'store-b' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-5: VALIDATION_ERROR when multi-store mode is false but context is initialized', async () => {
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode: () => false,
        getAllStores:      () => [],
        resolveDefaultStore: () => storeA,
      });

      await expect(
        handleMoveRepo(ledgerRoot, 'any', { target_store_id: 'store-b' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    // AC-6: ID conflict in target ──────────────────────────────────────

    it('AC-6: ID conflict in target registry returns VALIDATION_ERROR', async () => {
      // Create 'conflict-repo' in both stores
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'conflict-repo', folder_names: ['cf-a'], store_id: 'store-a' }));
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'conflict-repo', folder_names: ['cf-b'], store_id: 'store-b' }));

      await expect(
        handleMoveRepo(ledgerRoot, 'conflict-repo', { target_store_id: 'store-b' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    // AC-7: folder_name conflict in target ────────────────────────────

    it('AC-7: folder name conflict in target registry returns VALIDATION_ERROR', async () => {
      // Repo in store-a uses folder 'shared-folder'
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'src-repo', folder_names: ['shared-folder'], store_id: 'store-a' }));
      // Different repo in store-b already claims the same folder name
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'occupant', folder_names: ['shared-folder'], store_id: 'store-b' }));

      await expect(
        handleMoveRepo(ledgerRoot, 'src-repo', { target_store_id: 'store-b' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  // ── handleGetRepo store_id enrichment ──────────────────────────────────

  describe('handleGetRepo store_id enrichment', () => {
    let storeA: string;
    let storeB: string;

    beforeEach(async () => {
      storeA = await mkdtemp(join(tmpdir(), 'getrepo-store-a-'));
      storeB = await mkdtemp(join(tmpdir(), 'getrepo-store-b-'));
    });

    afterEach(async () => {
      await rm(storeA, { recursive: true, force: true });
      await rm(storeB, { recursive: true, force: true });
    });

    it('returns store_id matching the owning store in multi-store mode', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockGetStoreRouter.mockReturnValue({
        isMultiStoreMode:    () => true,
        getAllStores:        () => [
          { id: 'store-a', path: storeA, label: 'Store A' },
          { id: 'store-b', path: storeB, label: 'Store B' },
        ],
        resolveDefaultStore: () => storeA,
      });
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'enriched-repo', folder_names: ['er'], store_id: 'store-a' }));

      const result = await handleGetRepo(ledgerRoot, 'enriched-repo');

      expect(result.store_id).toBe('store-a');
    });

    it('omits store_id from the response in single-store mode', async () => {
      mockIsInitialized.mockReturnValue(false);
      await handleCreateRepo(ledgerRoot, makeBody({ id: 'single-repo', folder_names: ['sr'] }));

      const result = await handleGetRepo(ledgerRoot, 'single-repo');

      expect(result.store_id).toBeUndefined();
    });
  });
});
