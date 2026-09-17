/**
 * Tests for `initStoreContext()` (WP-003 — Store-Context Bootstrap Extraction).
 *
 * Coverage:
 *   - initStoreContext() installs a working StoreRouter + MultiStoreManager
 *     pair, in both legacy (no stores.json) and multi-store modes.
 *   - Idempotency: calling it twice overwrites the singleton cleanly.
 *   - The exact regression the extraction fixes: a by-id lookup for an entry
 *     registered in a non-default store returns null before the store
 *     context is initialized, and resolves once initStoreContext() runs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { initStoreContext, isStoreContextInitialized, getStoreRouter } from '../../src/storage/store-context.js';
import { findEntryInStores } from '../../src/storage/repository-lookup.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

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

describe('initStoreContext()', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  // This test intentionally runs first in the file (before any other test in
  // this suite calls initStoreContext()) to observe the pre-initialization
  // behavior: Vitest isolates module state per test file, so the store
  // context starts uninitialized here.
  it('pins the silent single-store degradation: an entry in a non-default store is unreachable before init, reachable after', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'init-store-context-degradation-'));
    const legacyLedgerRoot = join(tempDir, 'legacy-ledger-root');
    const storePath1 = join(tempDir, 'store-1');
    const storePath2 = join(tempDir, 'store-2');
    await mkdir(legacyLedgerRoot, { recursive: true });
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });

    // Register the entry in the *non-default* store only.
    await saveRegistry(storePath2, { repositories: [makeEntry('non-default-repo')] });

    // Before initStoreContext(): store context is uninitialized, so
    // findEntryInStores() falls back to searching only legacyLedgerRoot,
    // where the registry does not exist / has no matching entry.
    expect(isStoreContextInitialized()).toBe(false);
    const beforeInit = await findEntryInStores(legacyLedgerRoot, 'non-default-repo');
    expect(beforeInit).toBeNull();

    // After initStoreContext(): multi-store routing is active and the entry
    // resolves via its owning store.
    const config: StoresConfig = {
      stores: [
        { id: 'store-1', path: storePath1, label: 'Store One' },
        { id: 'store-2', path: storePath2, label: 'Store Two' },
      ],
      default_store: 'store-1',
    };
    const configPath = join(tempDir, 'stores.json');
    await writeFile(configPath, JSON.stringify(config), 'utf-8');
    await initStoreContext(configPath);

    const afterInit = await findEntryInStores(legacyLedgerRoot, 'non-default-repo');
    expect(afterInit?.storePath).toBe(storePath2);
    expect(afterInit?.entry.id).toBe('non-default-repo');
  });

  it('installs a legacy-mode router when no stores.json exists at configPath', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'init-store-context-legacy-'));
    const missingConfigPath = join(tempDir, 'does-not-exist.json');

    const result = await initStoreContext(missingConfigPath);

    expect(result).toBeNull();
    expect(isStoreContextInitialized()).toBe(true);
    expect(getStoreRouter().isMultiStoreMode()).toBe(false);
  });

  it('installs a multi-store router when a valid stores.json exists at configPath', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'init-store-context-multi-'));
    const storePath1 = join(tempDir, 'store-1');
    const storePath2 = join(tempDir, 'store-2');
    await mkdir(storePath1, { recursive: true });
    await mkdir(storePath2, { recursive: true });

    const config: StoresConfig = {
      stores: [
        { id: 'store-1', path: storePath1, label: 'Store One' },
        { id: 'store-2', path: storePath2, label: 'Store Two' },
      ],
      default_store: 'store-1',
    };
    const configPath = join(tempDir, 'stores.json');
    await writeFile(configPath, JSON.stringify(config), 'utf-8');

    const result = await initStoreContext(configPath);

    expect(result).toEqual(config);
    expect(isStoreContextInitialized()).toBe(true);
    expect(getStoreRouter().isMultiStoreMode()).toBe(true);
  });

  it('is idempotent — a second call overwrites the singleton with a fresh pair', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'init-store-context-idempotent-'));
    const missingConfigPath = join(tempDir, 'does-not-exist.json');

    await initStoreContext(missingConfigPath);
    const firstRouter = getStoreRouter();

    await initStoreContext(missingConfigPath);
    const secondRouter = getStoreRouter();

    expect(isStoreContextInitialized()).toBe(true);
    expect(secondRouter).not.toBe(firstRouter);
    expect(secondRouter.isMultiStoreMode()).toBe(false);
  });
});
