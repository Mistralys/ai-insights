/**
 * Tests for handleGetStoreConflicts (WP-012 — AC-2).
 *
 * Coverage:
 *   AC-2: GET /api/stores/conflicts returns an accurate list of repositories
 *         registered in multiple stores, identifying the winner and shadowed
 *         entries; returns empty array in single-store mode.
 *
 * All tests use vi.mock() for store-context — conflict detection is
 * MultiStoreManager's responsibility (covered by its own unit tests).
 * These tests verify that handleGetStoreConflicts() correctly delegates
 * and returns empty array in single-store mode without calling the manager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock store-context BEFORE importing the handler (vi.mock is hoisted).
// Default: single-store mode (context not initialized).
// ---------------------------------------------------------------------------
vi.mock('../../src/storage/store-context.js', () => ({
  isStoreContextInitialized: vi.fn<[], boolean>().mockReturnValue(false),
  getStoreRouter: vi.fn(),
  getMultiStoreManager: vi.fn(),
}));

import { handleGetStoreConflicts } from '../../gui/api-stores.js';
import {
  isStoreContextInitialized,
  getMultiStoreManager,
} from '../../src/storage/store-context.js';
import type { RegistryConflict } from '../../src/storage/multi-store-manager.js';

const mockIsInitialized        = vi.mocked(isStoreContextInitialized);
const mockGetMultiStoreManager = vi.mocked(getMultiStoreManager);

beforeEach(() => {
  vi.clearAllMocks();
  mockIsInitialized.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handleGetStoreConflicts (AC-2)', () => {

  // ── Single-store / legacy mode ─────────────────────────────────────────

  describe('single-store mode (context not initialized)', () => {
    it('returns an empty array', async () => {
      const result = await handleGetStoreConflicts();
      expect(result).toEqual([]);
    });

    it('does not call getMultiStoreManager()', async () => {
      await handleGetStoreConflicts();
      expect(mockGetMultiStoreManager).not.toHaveBeenCalled();
    });
  });

  // ── Multi-store mode ───────────────────────────────────────────────────

  describe('multi-store mode (context initialized)', () => {
    it('delegates to getMultiStoreManager().getRegistryConflicts()', async () => {
      const mockConflicts: RegistryConflict[] = [];
      const mockManager = {
        getRegistryConflicts: vi.fn().mockResolvedValue(mockConflicts),
      };
      mockIsInitialized.mockReturnValue(true);
      mockGetMultiStoreManager.mockReturnValue(mockManager as any);

      await handleGetStoreConflicts();

      expect(mockGetMultiStoreManager).toHaveBeenCalled();
      expect(mockManager.getRegistryConflicts).toHaveBeenCalledOnce();
    });

    it('returns an empty array when no conflicts exist', async () => {
      const mockManager = {
        getRegistryConflicts: vi.fn().mockResolvedValue([]),
      };
      mockIsInitialized.mockReturnValue(true);
      mockGetMultiStoreManager.mockReturnValue(mockManager as any);

      const result = await handleGetStoreConflicts();
      expect(result).toEqual([]);
    });

    it('returns the conflict records verbatim from the manager', async () => {
      const conflicts: RegistryConflict[] = [
        {
          repo_name: 'my-repo',
          winner_store_id: 'store-a',
          entries: [
            {
              store_id: 'store-a',
              entry: {
                id: 'r1',
                label: 'My Repo',
                folder_names: ['my-repo'],
                vision: { short_term: null, mid_term: null, long_term: null },
                created_at: '2026-01-01T00:00:00Z',
                last_modified: '2026-01-01T00:00:00Z',
              },
            },
            {
              store_id: 'store-b',
              entry: {
                id: 'r2',
                label: 'My Repo',
                folder_names: ['my-repo'],
                vision: { short_term: null, mid_term: null, long_term: null },
                created_at: '2026-01-02T00:00:00Z',
                last_modified: '2026-01-02T00:00:00Z',
              },
            },
          ],
        },
      ];

      const mockManager = {
        getRegistryConflicts: vi.fn().mockResolvedValue(conflicts),
      };
      mockIsInitialized.mockReturnValue(true);
      mockGetMultiStoreManager.mockReturnValue(mockManager as any);

      const result = await handleGetStoreConflicts();
      expect(result).toBe(conflicts);
    });

    it('conflict record identifies the repo_name and winner_store_id', async () => {
      const conflicts: RegistryConflict[] = [
        {
          repo_name: 'shared-repo',
          winner_store_id: 'primary-store',
          entries: [
            {
              store_id: 'primary-store',
              entry: {
                id: 'e1',
                label: 'Shared Repo',
                folder_names: ['shared-repo'],
                vision: { short_term: null, mid_term: null, long_term: null },
                created_at: '2026-01-01T00:00:00Z',
                last_modified: '2026-01-01T00:00:00Z',
              },
            },
            {
              store_id: 'secondary-store',
              entry: {
                id: 'e2',
                label: 'Shared Repo',
                folder_names: ['shared-repo'],
                vision: { short_term: null, mid_term: null, long_term: null },
                created_at: '2026-02-01T00:00:00Z',
                last_modified: '2026-02-01T00:00:00Z',
              },
            },
          ],
        },
      ];

      mockIsInitialized.mockReturnValue(true);
      mockGetMultiStoreManager.mockReturnValue({
        getRegistryConflicts: vi.fn().mockResolvedValue(conflicts),
      } as any);

      const result = await handleGetStoreConflicts();
      expect(result).toHaveLength(1);
      expect(result[0]!.repo_name).toBe('shared-repo');
      expect(result[0]!.winner_store_id).toBe('primary-store');
      expect(result[0]!.entries).toHaveLength(2);
    });

    it('returns multiple conflicts when several repos are duplicated', async () => {
      const makeConflict = (name: string): RegistryConflict => ({
        repo_name: name,
        winner_store_id: 'store-a',
        entries: [
          {
            store_id: 'store-a',
            entry: {
              id: `${name}-a`,
              label: name,
              folder_names: [name],
              vision: { short_term: null, mid_term: null, long_term: null },
              created_at: '2026-01-01T00:00:00Z',
              last_modified: '2026-01-01T00:00:00Z',
            },
          },
          {
            store_id: 'store-b',
            entry: {
              id: `${name}-b`,
              label: name,
              folder_names: [name],
              vision: { short_term: null, mid_term: null, long_term: null },
              created_at: '2026-01-02T00:00:00Z',
              last_modified: '2026-01-02T00:00:00Z',
            },
          },
        ],
      });

      const conflicts = [makeConflict('repo-x'), makeConflict('repo-y')];
      mockIsInitialized.mockReturnValue(true);
      mockGetMultiStoreManager.mockReturnValue({
        getRegistryConflicts: vi.fn().mockResolvedValue(conflicts),
      } as any);

      const result = await handleGetStoreConflicts();
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.repo_name)).toEqual(['repo-x', 'repo-y']);
    });
  });
});
