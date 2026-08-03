import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StoreRouter, StoreNotRegisteredError } from '../../src/storage/store-router.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { resolveLedgerRoot } from '../../src/utils/ledger-root.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryEntry, RepositoryRegistry } from '../../src/schema/repository-registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(repoName: string): RepositoryEntry {
  return {
    id: repoName,
    label: repoName,
    folder_names: [repoName],
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  };
}

function makeRegistry(repoName: string): RepositoryRegistry {
  return { repositories: [makeEntry(repoName)] };
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('StoreRouter', () => {
  let tempDir: string;
  let storePath1: string;
  let storePath2: string;

  // Shared two-store config that uses the tempDir store subdirectories.
  // Paths are absolute so expandStorePath() is a no-op normalization.
  function makeConfig(overrides: Partial<StoresConfig> = {}): StoresConfig {
    return {
      stores: [
        { id: 'store-1', path: storePath1 },
        { id: 'store-2', path: storePath2 },
      ],
      default_store: 'store-1',
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-router-test-'));
    storePath1 = join(tempDir, 'store-1');
    storePath2 = join(tempDir, 'store-2');
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── isMultiStoreMode ────────────────────────────────────────────────

  describe('isMultiStoreMode()', () => {
    it('returns false in legacy mode (null config)', () => {
      const router = new StoreRouter(null);
      expect(router.isMultiStoreMode()).toBe(false);
    });

    it('returns true when a StoresConfig is provided', () => {
      const router = new StoreRouter(makeConfig());
      expect(router.isMultiStoreMode()).toBe(true);
    });
  });

  // ─── resolveStoreForWrite — legacy mode (AC 1) ───────────────────────

  describe('resolveStoreForWrite() — legacy mode', () => {
    it('delegates to resolveLedgerRoot() in legacy mode (AC 1)', async () => {
      const router = new StoreRouter(null);
      const result = await router.resolveStoreForWrite('any-repo');
      expect(result).toBe(resolveLedgerRoot());
    });
  });

  // ─── resolveStoreForWrite — multi-store mode ─────────────────────────

  describe('resolveStoreForWrite() — multi-store mode', () => {
    it('returns first store path when repo is in first store (AC 2)', async () => {
      await saveRegistry(storePath1, makeRegistry('my-repo'));
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForWrite('my-repo');
      expect(result).toBe(storePath1);
    });

    it('returns second store path when repo is in second store only (AC 3)', async () => {
      await saveRegistry(storePath2, makeRegistry('my-repo'));
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForWrite('my-repo');
      expect(result).toBe(storePath2);
    });

    it('returns first store path when repo is in both stores — first match wins (AC 4)', async () => {
      await saveRegistry(storePath1, makeRegistry('my-repo'));
      await saveRegistry(storePath2, makeRegistry('my-repo'));
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForWrite('my-repo');
      expect(result).toBe(storePath1);
    });

    it('throws containing "not registered in any store" for unregistered repo (AC 5)', async () => {
      const router = new StoreRouter(makeConfig());
      await expect(router.resolveStoreForWrite('unknown-repo')).rejects.toThrow(
        'not registered in any store'
      );
    });
  });

  // ─── directory auto-creation (AC 6) ──────────────────────────────────

  describe('directory auto-creation', () => {
    it('creates each configured store path that does not exist on disk (AC 6)', () => {
      const newStore1 = join(tempDir, 'auto-created-1');
      const newStore2 = join(tempDir, 'auto-created-2');

      // Verify the directories do not yet exist
      expect(existsSync(newStore1)).toBe(false);
      expect(existsSync(newStore2)).toBe(false);

      const config: StoresConfig = {
        stores: [
          { id: 'a1', path: newStore1 },
          { id: 'a2', path: newStore2 },
        ],
        default_store: 'a1',
      };

      // Construction should create both directories synchronously
      new StoreRouter(config);

      expect(existsSync(newStore1)).toBe(true);
      expect(existsSync(newStore2)).toBe(true);
    });

    it('does not throw when store paths already exist', () => {
      // storePath1 and storePath2 already exist from beforeEach
      expect(() => new StoreRouter(makeConfig())).not.toThrow();
    });

    it('does not create directories in legacy mode', () => {
      // null config → no directories should be touched
      expect(() => new StoreRouter(null)).not.toThrow();
    });
  });

  // ─── skipDirCreate option ─────────────────────────────────────────────

  describe('skipDirCreate option', () => {
    it('does not call mkdirSync for store paths when skipDirCreate is true', () => {
      const newStore1 = join(tempDir, 'skip-create-1');
      const newStore2 = join(tempDir, 'skip-create-2');

      expect(existsSync(newStore1)).toBe(false);
      expect(existsSync(newStore2)).toBe(false);

      const config: StoresConfig = {
        stores: [
          { id: 'skip-1', path: newStore1 },
          { id: 'skip-2', path: newStore2 },
        ],
        default_store: 'skip-1',
      };

      new StoreRouter(config, { skipDirCreate: true });

      expect(existsSync(newStore1)).toBe(false);
      expect(existsSync(newStore2)).toBe(false);
    });

    it('creates directories when skipDirCreate is omitted (default behavior)', () => {
      const newStore1 = join(tempDir, 'default-create-1');
      const newStore2 = join(tempDir, 'default-create-2');

      expect(existsSync(newStore1)).toBe(false);
      expect(existsSync(newStore2)).toBe(false);

      const config: StoresConfig = {
        stores: [
          { id: 'dc-1', path: newStore1 },
          { id: 'dc-2', path: newStore2 },
        ],
        default_store: 'dc-1',
      };

      new StoreRouter(config);

      expect(existsSync(newStore1)).toBe(true);
      expect(existsSync(newStore2)).toBe(true);
    });

    it('creates directories when skipDirCreate is explicitly false', () => {
      const newStore = join(tempDir, 'explicit-false');

      expect(existsSync(newStore)).toBe(false);

      const config: StoresConfig = {
        stores: [{ id: 'ef-1', path: newStore }],
        default_store: 'ef-1',
      };

      new StoreRouter(config, { skipDirCreate: false });

      expect(existsSync(newStore)).toBe(true);
    });
  });

  // ─── resolveStoreForRepo ─────────────────────────────────────────────

  describe('resolveStoreForRepo()', () => {
    it('returns null in legacy mode', async () => {
      const router = new StoreRouter(null);
      const result = await router.resolveStoreForRepo('any-repo');
      expect(result).toBeNull();
    });

    it('returns null when repo is not registered in any store', async () => {
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForRepo('unknown-repo');
      expect(result).toBeNull();
    });

    it('returns storePath and storeId when repo is found in first store', async () => {
      await saveRegistry(storePath1, makeRegistry('found-repo'));
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForRepo('found-repo');
      expect(result).not.toBeNull();
      expect(result!.storePath).toBe(storePath1);
      expect(result!.storeId).toBe('store-1');
    });

    it('returns storePath and storeId when repo is found in second store', async () => {
      await saveRegistry(storePath2, makeRegistry('found-repo'));
      const router = new StoreRouter(makeConfig());
      const result = await router.resolveStoreForRepo('found-repo');
      expect(result).not.toBeNull();
      expect(result!.storePath).toBe(storePath2);
      expect(result!.storeId).toBe('store-2');
    });

    it('does not throw for an unregistered repo — returns null instead', async () => {
      const router = new StoreRouter(makeConfig());
      await expect(router.resolveStoreForRepo('unknown-repo')).resolves.toBeNull();
    });
  });

  // ─── resolveDefaultStore ─────────────────────────────────────────────

  describe('resolveDefaultStore()', () => {
    it('returns resolveLedgerRoot() in legacy mode', () => {
      const router = new StoreRouter(null);
      expect(router.resolveDefaultStore()).toBe(resolveLedgerRoot());
    });

    it('returns the expanded path of the configured default store', () => {
      const router = new StoreRouter(makeConfig());
      expect(router.resolveDefaultStore()).toBe(storePath1);
    });

    it('returns the second store path when it is the default', () => {
      const config = makeConfig({ default_store: 'store-2' });
      const router = new StoreRouter(config);
      expect(router.resolveDefaultStore()).toBe(storePath2);
    });
  });

  // ─── getAllStorePaths ─────────────────────────────────────────────────

  describe('getAllStorePaths()', () => {
    it('returns single-element array wrapping resolveLedgerRoot() in legacy mode', () => {
      const router = new StoreRouter(null);
      const result = router.getAllStorePaths();
      expect(result).toEqual([resolveLedgerRoot()]);
    });

    it('returns all store paths in config order', () => {
      const router = new StoreRouter(makeConfig());
      const result = router.getAllStorePaths();
      expect(result).toEqual([storePath1, storePath2]);
    });

    it('returns a new array on each call (defensive copy)', () => {
      const router = new StoreRouter(makeConfig());
      const first = router.getAllStorePaths();
      const second = router.getAllStorePaths();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });
});

// ─── StoreNotRegisteredError ──────────────────────────────────────────────

describe('StoreNotRegisteredError', () => {
  it('is an instance of Error', () => {
    const err = new StoreNotRegisteredError('my-repo');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of StoreNotRegisteredError', () => {
    const err = new StoreNotRegisteredError('my-repo');
    expect(err).toBeInstanceOf(StoreNotRegisteredError);
  });

  it('exposes the repoName property', () => {
    const err = new StoreNotRegisteredError('my-repo');
    expect(err.repoName).toBe('my-repo');
  });

  it('sets the error name to StoreNotRegisteredError', () => {
    const err = new StoreNotRegisteredError('my-repo');
    expect(err.name).toBe('StoreNotRegisteredError');
  });

  it('message contains the repo name and "not registered in any store"', () => {
    const err = new StoreNotRegisteredError('test-repo');
    expect(err.message).toContain('test-repo');
    expect(err.message).toContain('not registered in any store');
  });

  it('is thrown by resolveStoreForWrite() for unregistered repos', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'snre-test-'));
    try {
      const storePath = join(tempDir, 'store');
      await mkdir(storePath, { recursive: true });
      const config: StoresConfig = {
        stores: [{ id: 'main', path: storePath }],
        default_store: 'main',
      };
      const router = new StoreRouter(config);
      await expect(router.resolveStoreForWrite('unregistered-repo')).rejects.toBeInstanceOf(StoreNotRegisteredError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
