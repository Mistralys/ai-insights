/**
 * Tests for getProjectLedgerStatus() multi-store awareness.
 *
 * Verifies:
 *   AC-07: getProjectLedgerStatus() returns { exists: true } when project-ledger.json
 *          lives in a non-default store.
 *   AC-08: synthesisGenerated is correctly read from the non-default store.
 *   AC-09: In legacy (single-store) mode getProjectLedgerStatus() checks only ledgerRoot.
 *
 * Uses real temporary directories for all filesystem operations.
 * setStoreContext() is called in beforeEach and legacy mode is restored in afterEach
 * to avoid leaking module-level singleton state into other test suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getProjectLedgerStatus } from '../../src/gui/queue/get-queue.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(stores: Array<{ id: string; path: string }>): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.id })),
    default_store: stores[0]!.id,
  };
}

function initTwoStoreContext(storeA: string, storeB: string): void {
  const router = new StoreRouter(makeConfig([
    { id: 'store-a', path: storeA },
    { id: 'store-b', path: storeB },
  ]));
  setStoreContext(router, new MultiStoreManager(router));
}

function restoreLegacyContext(): void {
  const router = new StoreRouter(null);
  setStoreContext(router, new MultiStoreManager(router));
}

/** Creates project-ledger.json at the namespaced path inside a store. */
async function writeLedger(
  storePath: string,
  repo: string | null,
  slug: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const dir = repo
    ? join(storePath, repo, slug)
    : join(storePath, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'project-ledger.json'),
    JSON.stringify({ synthesis_generated: false, ...extra }),
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// AC-07 / AC-08: multi-store mode finds project in non-default store
// ---------------------------------------------------------------------------

describe('getProjectLedgerStatus — multi-store mode', () => {
  let storeA: string;
  let storeB: string;

  beforeEach(async () => {
    storeA = await mkdtemp(join(tmpdir(), 'queue-ms-a-'));
    storeB = await mkdtemp(join(tmpdir(), 'queue-ms-b-'));
    initTwoStoreContext(storeA, storeB);
  });

  afterEach(async () => {
    restoreLegacyContext();
    await Promise.all([
      rm(storeA, { recursive: true, force: true }),
      rm(storeB, { recursive: true, force: true }),
    ]);
  });

  it('AC-07: returns exists:true when project-ledger.json is in store B, ledgerRoot points to store A', async () => {
    const slug = '2026-08-04-test-project';
    const repo = 'my-repo';
    // Write the ledger only in store B
    await writeLedger(storeB, repo, slug);

    const result = await getProjectLedgerStatus(storeA, slug, repo);

    expect(result.exists).toBe(true);
  });

  it('AC-08: synthesisGenerated is correctly read from non-default store', async () => {
    const slug = '2026-08-04-synthesis-test';
    const repo = 'my-repo';
    await writeLedger(storeB, repo, slug, { synthesis_generated: true });

    const result = await getProjectLedgerStatus(storeA, slug, repo);

    expect(result.exists).toBe(true);
    expect(result.synthesisGenerated).toBe(true);
  });

  it('returns exists:false when project is absent from all stores', async () => {
    const result = await getProjectLedgerStatus(storeA, '2026-08-04-nonexistent', 'my-repo');

    expect(result.exists).toBe(false);
    expect(result.synthesisGenerated).toBe(false);
  });

  it('finds project in flat (no-repo) layout in store B', async () => {
    const slug = '2026-08-04-flat-project';
    await writeLedger(storeB, null, slug);

    const result = await getProjectLedgerStatus(storeA, slug, null);

    expect(result.exists).toBe(true);
  });

  it('returns first match when project exists in both stores', async () => {
    const slug = '2026-08-04-dup-project';
    const repo = 'my-repo';
    // Store A has synthesis_generated: false; store B has synthesis_generated: true
    await writeLedger(storeA, repo, slug, { synthesis_generated: false });
    await writeLedger(storeB, repo, slug, { synthesis_generated: true });

    const result = await getProjectLedgerStatus(storeA, slug, repo);

    // First match wins — store A comes first in config order
    expect(result.exists).toBe(true);
    expect(result.synthesisGenerated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-09: legacy single-store mode is verified by the existing test suite in
// tests/gui/queue-ledger-status.test.ts, which runs without setting any store
// context and therefore exercises the legacy single-path code consistently.
// ---------------------------------------------------------------------------
