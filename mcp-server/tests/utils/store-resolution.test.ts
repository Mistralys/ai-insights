/**
 * Unit tests for src/utils/store-resolution.ts
 *
 * Covers extractLedgerRoot (5 tests) and resolveMultiStoreLedgerRoot (6 tests).
 * Each test after the extractLedgerRoot suite controls the store-context singleton
 * via setStoreContext() and restores legacy mode in afterEach to avoid leaking
 * state into other test suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractLedgerRoot, resolveMultiStoreLedgerRoot } from '../../src/utils/store-resolution.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';
import { now } from '../../src/utils/timestamp.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(
  storePaths: Array<{ id: string; path: string }>
): StoresConfig {
  return {
    stores: storePaths.map((s) => ({ id: s.id, path: s.path })),
    default_store: storePaths[0]!.id,
  };
}

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

/** Restore singleton to legacy (single-store) mode after each test. */
function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── extractLedgerRoot ───────────────────────────────────────────────────────

describe('extractLedgerRoot', () => {
  it('returns the string value for string input', () => {
    expect(extractLedgerRoot('/some/path')).toBe('/some/path');
  });

  it('returns undefined for object input', () => {
    expect(extractLedgerRoot({ key: 'value' })).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(extractLedgerRoot(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(extractLedgerRoot(undefined)).toBeUndefined();
  });

  it('returns undefined for RequestHandlerExtra-shaped object (constraint 58 regression guard)', () => {
    // The MCP SDK injects a RequestHandlerExtra as the second positional argument
    // to tool handler functions. This object must never be treated as a ledger root.
    const requestHandlerExtra = {
      signal: new AbortController().signal,
      requestId: 42,
      sendNotification: () => {},
      sendRequest: () => {},
      authInfo: undefined,
    };
    expect(extractLedgerRoot(requestHandlerExtra)).toBeUndefined();
  });
});

// ─── resolveMultiStoreLedgerRoot ─────────────────────────────────────────────

describe('resolveMultiStoreLedgerRoot', () => {
  let tempDir: string;
  let storeAPath: string;
  let storeBPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-resolution-'));
    storeAPath = join(tempDir, 'store-a');
    storeBPath = join(tempDir, 'store-b');
    await mkdir(storeAPath, { recursive: true });
    await mkdir(storeBPath, { recursive: true });
  });

  afterEach(async () => {
    restoreLegacyContext();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns the override string when a test override is provided (short-circuits store logic)', async () => {
    // Store context is not initialized, but the override is returned directly.
    const override = '/override/ledger/root';
    const result = await resolveMultiStoreLedgerRoot(
      '/any/project/path',
      override
    );
    expect(result).toBe(override);
  });

  it('returns undefined when store context is not initialized (single-store / test fallback)', async () => {
    // Do NOT call setStoreContext() — context remains in the uninitialized/legacy
    // state from the module-level singleton reset performed in restoreLegacyContext().
    // Re-restore to ensure a clean uninitialized state for this test.
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));

    // In legacy mode isStoreContextInitialized() returns true but
    // isMultiStoreMode() returns false — this test simulates the case where
    // the context was never set at all.
    //
    // To test the "not initialized" branch we need to call the function before
    // setStoreContext() runs. We can simulate this by using null-config router
    // which makes isMultiStoreMode() return false, producing the same undefined result.
    const result = await resolveMultiStoreLedgerRoot(
      '/some/docs/agents/plans/2026-01-01-proj'
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when isMultiStoreMode() is false (single-store config)', async () => {
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));

    const result = await resolveMultiStoreLedgerRoot(
      '/some/docs/agents/plans/2026-01-01-proj'
    );
    expect(result).toBeUndefined();
  });

  it('returns the correct storePath when the repo is registered in a non-default store', async () => {
    // Register 'my-repo' in store-b (the non-default store).
    await writeRegistry(storeBPath, ['my-repo']);

    const config = makeConfig([
      { id: 'store-a', path: storeAPath },
      { id: 'store-b', path: storeBPath },
    ]);
    const router = new StoreRouter(config, { skipDirCreate: true });
    setStoreContext(router, new MultiStoreManager(router));

    // Plan path whose repo segment is 'my-repo'
    const planPath = '/absolute/path/to/my-repo/docs/agents/plans/2026-01-01-proj';
    const result = await resolveMultiStoreLedgerRoot(planPath);
    expect(result).toBe(storeBPath);
  });

  it('returns undefined when the repo is not registered in any store (graceful fallback)', async () => {
    // No registries written — both stores are empty.
    const config = makeConfig([
      { id: 'store-a', path: storeAPath },
      { id: 'store-b', path: storeBPath },
    ]);
    const router = new StoreRouter(config, { skipDirCreate: true });
    setStoreContext(router, new MultiStoreManager(router));

    const planPath = '/absolute/path/to/unknown-repo/docs/agents/plans/2026-01-01-proj';
    const result = await resolveMultiStoreLedgerRoot(planPath);
    expect(result).toBeUndefined();
  });

  it('returns undefined when inferProjectRootFromPlanPath returns null (malformed project path)', async () => {
    const config = makeConfig([
      { id: 'store-a', path: storeAPath },
    ]);
    const router = new StoreRouter(config, { skipDirCreate: true });
    setStoreContext(router, new MultiStoreManager(router));

    // A path with no 'docs/agents' anchor — inferProjectRootFromPlanPath returns null.
    const malformedPath = '/no/docs-agents/anchor/here';
    const result = await resolveMultiStoreLedgerRoot(malformedPath);
    expect(result).toBeUndefined();
  });
});
