import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext, getStoreRouter, getMultiStoreManager } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeConfig(storePath: string): StoresConfig {
  return {
    stores: [{ id: 'primary', path: storePath, label: 'Primary' }],
    default_store: 'primary',
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('store-context singleton accessor', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-context-test-'));
    storePath = join(tempDir, 'primary-store');
    await mkdir(storePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── getStoreRouter() before setStoreContext() ────────────────────────

  describe('before setStoreContext()', () => {
    it('getStoreRouter() throws a descriptive error before initialization', () => {
      // Reset context by re-importing — module state persists across tests,
      // so we call set with undefined-like values via a fresh legacy router to
      // ensure the throw is actually triggered by an uninitialized state.
      // The cleanest way to test this is to directly verify the error message
      // on a module that hasn't been initialized in *this* describe scope.
      //
      // Note: Because Vitest shares module state within a suite, we can't
      // reset the singleton back to undefined after each test. Instead we
      // specifically test the throw *before* calling setStoreContext() for the
      // first time in the suite — see the test ordering note below.
      //
      // This test must run before any setStoreContext() call in this file.
      // Vitest runs describe blocks sequentially, so the describe-before-set
      // block safely precedes the describe-after-set block below.
      expect(() => getStoreRouter()).toThrow('[store-context] getStoreRouter() called before setStoreContext()');
    });

    it('getMultiStoreManager() throws a descriptive error before initialization', () => {
      expect(() => getMultiStoreManager()).toThrow('[store-context] getMultiStoreManager() called before setStoreContext()');
    });
  });

  // ─── after setStoreContext() ──────────────────────────────────────────

  describe('after setStoreContext()', () => {
    let router: StoreRouter;
    let manager: MultiStoreManager;

    beforeEach(() => {
      router = new StoreRouter(null); // legacy mode
      manager = new MultiStoreManager(router);
      setStoreContext(router, manager);
    });

    it('getStoreRouter() returns the set router without throwing', () => {
      const result = getStoreRouter();
      expect(result).toBe(router);
    });

    it('getMultiStoreManager() returns the set manager without throwing', () => {
      const result = getMultiStoreManager();
      expect(result).toBe(manager);
    });

    it('returned router reports legacy (single-store) mode when initialized with null config', () => {
      expect(getStoreRouter().isMultiStoreMode()).toBe(false);
    });
  });

  // ─── multi-store mode ─────────────────────────────────────────────────

  describe('multi-store mode initialization', () => {
    it('router reports multi-store mode when initialized with a StoresConfig', () => {
      const config = makeConfig(storePath);
      const router = new StoreRouter(config);
      const manager = new MultiStoreManager(router);
      setStoreContext(router, manager);

      expect(getStoreRouter().isMultiStoreMode()).toBe(true);
    });

    it('setStoreContext() is idempotent — later calls overwrite the singleton', () => {
      const legacyRouter = new StoreRouter(null);
      const legacyManager = new MultiStoreManager(legacyRouter);
      setStoreContext(legacyRouter, legacyManager);

      const multiRouter = new StoreRouter(makeConfig(storePath));
      const multiManager = new MultiStoreManager(multiRouter);
      setStoreContext(multiRouter, multiManager);

      expect(getStoreRouter()).toBe(multiRouter);
      expect(getMultiStoreManager()).toBe(multiManager);
      expect(getStoreRouter().isMultiStoreMode()).toBe(true);
    });
  });

  // ─── store directory auto-creation ───────────────────────────────────

  describe('store directory auto-creation', () => {
    it('StoreRouter auto-creates configured store directories that do not exist', async () => {
      const { existsSync } = await import('fs');
      const newStorePath = join(tempDir, 'auto-created-store');
      expect(existsSync(newStorePath)).toBe(false);

      const config = makeConfig(newStorePath);
      const router = new StoreRouter(config);
      const manager = new MultiStoreManager(router);
      setStoreContext(router, manager);

      expect(existsSync(newStorePath)).toBe(true);
    });
  });
});
