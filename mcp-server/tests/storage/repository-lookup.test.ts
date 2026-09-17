/**
 * Tests for `src/storage/repository-lookup.ts` (WP-002).
 *
 * Coverage:
 *   - findEntryInStores(): single-store and multi-store branches, first-match
 *     semantics on a duplicate id, and the not-found case.
 *   - listEntriesInStores(): single-store and multi-store branches, first-match
 *     dedup on a duplicate id, and agreement with findEntryInStores() on the
 *     same fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { findEntryInStores, listEntriesInStores } from '../../src/storage/repository-lookup.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

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

describe('repository-lookup', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    // Restore legacy single-store mode so other test files aren't affected
    // by a leftover multi-store context.
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
  });

  // ─── Single-store / legacy mode ──────────────────────────────────────────

  describe('single-store mode', () => {
    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'repo-lookup-single-'));
      const legacyRouter = new StoreRouter(null);
      setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
      await saveRegistry(tempDir, { repositories: [makeEntry('repo-a'), makeEntry('repo-b')] });
    });

    it('findEntryInStores() finds an entry by id', async () => {
      const found = await findEntryInStores(tempDir, 'repo-a');
      expect(found?.storePath).toBe(tempDir);
      expect(found?.entry.id).toBe('repo-a');
    });

    it('findEntryInStores() returns null when the id is not present', async () => {
      const found = await findEntryInStores(tempDir, 'does-not-exist');
      expect(found).toBeNull();
    });

    it('listEntriesInStores() returns every entry tagged with the single store path', async () => {
      const entries = await listEntriesInStores(tempDir);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.storePath === tempDir)).toBe(true);
      expect(entries.map((e) => e.entry.id).sort()).toEqual(['repo-a', 'repo-b']);
    });
  });

  // ─── Multi-store mode ─────────────────────────────────────────────────────

  describe('multi-store mode', () => {
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

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'repo-lookup-multi-'));
      storePath1 = join(tempDir, 'store-1');
      storePath2 = join(tempDir, 'store-2');
      await mkdir(storePath1, { recursive: true });
      await mkdir(storePath2, { recursive: true });

      const router = new StoreRouter(makeConfig());
      setStoreContext(router, new MultiStoreManager(router));
    });

    it('findEntryInStores() returns the first-matching store in config order for a duplicate id', async () => {
      await saveRegistry(storePath1, {
        repositories: [{ ...makeEntry('shared-repo'), label: 'Store 1 label' }],
      });
      await saveRegistry(storePath2, {
        repositories: [{ ...makeEntry('shared-repo'), label: 'Store 2 label' }],
      });

      const found = await findEntryInStores(tempDir, 'shared-repo');
      expect(found?.storePath).toBe(storePath1);
      expect(found?.entry.label).toBe('Store 1 label');
    });

    it('findEntryInStores() finds an entry that only exists in a later store', async () => {
      await saveRegistry(storePath1, { repositories: [makeEntry('repo-a')] });
      await saveRegistry(storePath2, { repositories: [makeEntry('repo-b')] });

      const found = await findEntryInStores(tempDir, 'repo-b');
      expect(found?.storePath).toBe(storePath2);
      expect(found?.entry.id).toBe('repo-b');
    });

    it('findEntryInStores() returns null when no store has the id', async () => {
      await saveRegistry(storePath1, { repositories: [makeEntry('repo-a')] });
      const found = await findEntryInStores(tempDir, 'nope');
      expect(found).toBeNull();
    });

    it('listEntriesInStores() collects entries from every store', async () => {
      await saveRegistry(storePath1, { repositories: [makeEntry('repo-a')] });
      await saveRegistry(storePath2, { repositories: [makeEntry('repo-b')] });

      const entries = await listEntriesInStores(tempDir);
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.entry.id === 'repo-a')?.storePath).toBe(storePath1);
      expect(entries.find((e) => e.entry.id === 'repo-b')?.storePath).toBe(storePath2);
    });

    it('listEntriesInStores() dedups a duplicate id, keeping the first store in config order', async () => {
      await saveRegistry(storePath1, {
        repositories: [{ ...makeEntry('shared-repo'), label: 'Store 1 label' }],
      });
      await saveRegistry(storePath2, {
        repositories: [{ ...makeEntry('shared-repo'), label: 'Store 2 label' }],
      });

      const entries = await listEntriesInStores(tempDir);
      const shared = entries.filter((e) => e.entry.id === 'shared-repo');
      expect(shared).toHaveLength(1);
      expect(shared[0].storePath).toBe(storePath1);
      expect(shared[0].entry.label).toBe('Store 1 label');
    });

    it('listEntriesInStores() agrees with findEntryInStores() on the same fixture', async () => {
      await saveRegistry(storePath1, {
        repositories: [makeEntry('repo-a'), { ...makeEntry('shared-repo'), label: 'Store 1 label' }],
      });
      await saveRegistry(storePath2, {
        repositories: [makeEntry('repo-b'), { ...makeEntry('shared-repo'), label: 'Store 2 label' }],
      });

      const allEntries = await listEntriesInStores(tempDir);
      for (const { entry, storePath } of allEntries) {
        const found = await findEntryInStores(tempDir, entry.id);
        expect(found?.storePath).toBe(storePath);
        expect(found?.entry).toEqual(entry);
      }
    });
  });
});
