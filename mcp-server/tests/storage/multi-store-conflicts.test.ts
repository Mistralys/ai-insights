/**
 * Tests for MultiStoreManager — registry merge priority and conflict detection.
 *
 * Covers:
 *   - getMergedRegistry() returns entries with store-order priority (AC 3)
 *   - getRegistryConflicts() correctly identifies repos in multiple stores (AC 4)
 *   - getRegistryConflicts() designates the winner by store-order priority (AC 4)
 *   - getRegistryConflicts() returns empty when no overlaps exist (AC 4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryEntry, RepositoryRegistry } from '../../src/schema/repository-registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(id: string, folderNames: string[] = [id]): RepositoryEntry {
  return {
    id,
    label: id,
    folder_names: folderNames,
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  };
}

function makeRegistry(...ids: string[]): RepositoryRegistry {
  return { repositories: ids.map((id) => makeEntry(id)) };
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('MultiStoreManager — registry merge and conflicts', () => {
  let tempDir: string;
  let storePath1: string;
  let storePath2: string;

  function makeConfig(): StoresConfig {
    return {
      stores: [
        { id: 'store-1', path: storePath1, label: 'Store One' },
        { id: 'store-2', path: storePath2, label: 'Store Two' },
      ],
      default_store: 'store-1',
    };
  }

  function makeManager(): MultiStoreManager {
    return new MultiStoreManager(new StoreRouter(makeConfig()));
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'multi-store-conflicts-test-'));
    storePath1 = join(tempDir, 'store-1');
    storePath2 = join(tempDir, 'store-2');
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── getMergedRegistry — AC 3 ────────────────────────────────────────

  describe('getMergedRegistry()', () => {
    it('AC 3: first store entry wins for a duplicate repo id', async () => {
      // 'shared-repo' registered in both stores with different labels
      const entry1: RepositoryEntry = {
        ...makeEntry('shared-repo'),
        label: 'Shared Repo (Store 1)',
      };
      const entry2: RepositoryEntry = {
        ...makeEntry('shared-repo'),
        label: 'Shared Repo (Store 2)',
      };

      await saveRegistry(storePath1, { repositories: [entry1] });
      await saveRegistry(storePath2, { repositories: [entry2] });

      const manager = makeManager();
      const merged = await manager.getMergedRegistry();

      // Only one entry for 'shared-repo'
      const sharedEntries = merged.filter((e) => e.id === 'shared-repo');
      expect(sharedEntries).toHaveLength(1);

      // The winner is from store-1
      expect(sharedEntries[0]!.store_id).toBe('store-1');
      expect(sharedEntries[0]!.label).toBe('Shared Repo (Store 1)');
    });

    it('AC 3: second store entry is suppressed for a duplicate repo id', async () => {
      await saveRegistry(storePath1, makeRegistry('repo-a', 'repo-b'));
      await saveRegistry(storePath2, makeRegistry('repo-b', 'repo-c'));

      const manager = makeManager();
      const merged = await manager.getMergedRegistry();

      // Total unique repos: repo-a, repo-b, repo-c
      expect(merged).toHaveLength(3);

      // repo-b must come from store-1
      const repoBEntry = merged.find((e) => e.id === 'repo-b');
      expect(repoBEntry!.store_id).toBe('store-1');

      // repo-c must come from store-2
      const repoCEntry = merged.find((e) => e.id === 'repo-c');
      expect(repoCEntry!.store_id).toBe('store-2');
    });

    it('tags each entry with the correct store_id', async () => {
      await saveRegistry(storePath1, makeRegistry('repo-a'));
      await saveRegistry(storePath2, makeRegistry('repo-b'));

      const manager = makeManager();
      const merged = await manager.getMergedRegistry();

      const repoA = merged.find((e) => e.id === 'repo-a');
      expect(repoA!.store_id).toBe('store-1');

      const repoB = merged.find((e) => e.id === 'repo-b');
      expect(repoB!.store_id).toBe('store-2');
    });

    it('returns an empty array when both stores have no registries', async () => {
      const manager = makeManager();
      const merged = await manager.getMergedRegistry();
      expect(merged).toHaveLength(0);
    });
  });

  // ─── getRegistryConflicts — AC 4 ─────────────────────────────────────

  describe('getRegistryConflicts()', () => {
    it('AC 4: returns empty array when no repos are shared between stores', async () => {
      await saveRegistry(storePath1, makeRegistry('repo-a'));
      await saveRegistry(storePath2, makeRegistry('repo-b'));

      const manager = makeManager();
      const conflicts = await manager.getRegistryConflicts();
      expect(conflicts).toHaveLength(0);
    });

    it('AC 4: identifies a repo registered in both stores and designates winner by store order', async () => {
      await saveRegistry(storePath1, makeRegistry('shared-repo', 'unique-a'));
      await saveRegistry(storePath2, makeRegistry('shared-repo', 'unique-b'));

      const manager = makeManager();
      const conflicts = await manager.getRegistryConflicts();

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.repo_name).toBe('shared-repo');
      expect(conflicts[0]!.winner_store_id).toBe('store-1');
      expect(conflicts[0]!.entries).toHaveLength(2);

      const storeIds = conflicts[0]!.entries.map((e) => e.store_id);
      expect(storeIds).toContain('store-1');
      expect(storeIds).toContain('store-2');
    });

    it('returns no false positives for repos that are only in one store', async () => {
      await saveRegistry(storePath1, makeRegistry('only-in-1'));
      await saveRegistry(storePath2, makeRegistry('only-in-2'));

      const manager = makeManager();
      const conflicts = await manager.getRegistryConflicts();
      expect(conflicts).toHaveLength(0);
    });

    it('returns multiple conflicts when several repos overlap', async () => {
      await saveRegistry(storePath1, makeRegistry('repo-a', 'repo-b', 'repo-c'));
      await saveRegistry(storePath2, makeRegistry('repo-b', 'repo-c'));

      const manager = makeManager();
      const conflicts = await manager.getRegistryConflicts();

      expect(conflicts).toHaveLength(2);
      const conflictNames = conflicts.map((c) => c.repo_name).sort();
      expect(conflictNames).toEqual(['repo-b', 'repo-c']);
      conflicts.forEach((c) => {
        expect(c.winner_store_id).toBe('store-1');
      });
    });
  });
});
