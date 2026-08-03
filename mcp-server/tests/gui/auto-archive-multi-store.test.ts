/**
 * Multi-store tests for src/gui/auto-archive.ts
 *
 * Verifies that runAutoArchive scans all configured stores and correctly
 * archives eligible projects regardless of which store they live in.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { runAutoArchive } from '../../src/gui/auto-archive.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';
import type { RootIndex } from '../../src/schema/root-index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRoot(
  status: RootIndex['status'],
  overrides: Partial<RootIndex> = {}
): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status,
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
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

function makeConfig(
  storePaths: Array<{ id: string; path: string }>
): StoresConfig {
  return {
    stores: storePaths.map((s) => ({ id: s.id, path: s.path })),
    default_store: storePaths[0]!.id,
  };
}

/** Backdates the last_updated field in `.meta.json` to simulate inactivity. */
async function backdateProject(store: LedgerStore, daysAgo: number): Promise<void> {
  const metaPath = store.metaPath();
  const raw = await readFile(metaPath, 'utf-8');
  const meta = JSON.parse(raw) as Record<string, unknown>;
  const staleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  meta['last_updated'] = staleDate;
  await writeFile(metaPath, JSON.stringify(meta), 'utf-8');
}

function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('runAutoArchive — multi-store mode', () => {
  let tempDir: string;
  let defaultStorePath: string;
  let secondaryStorePath: string;
  let planDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auto-archive-ms-'));
    defaultStorePath = join(tempDir, 'store-default');
    secondaryStorePath = join(tempDir, 'store-secondary');
    await mkdir(defaultStorePath, { recursive: true });
    await mkdir(secondaryStorePath, { recursive: true });

    planDir = join(tempDir, 'plans');
    await mkdir(planDir, { recursive: true });
  });

  afterEach(async () => {
    restoreLegacyContext();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('archives eligible COMPLETE projects in a non-default store', async () => {
    const REPO = 'my-repo';
    const SLUG = '2026-01-01-old-proj';

    // Register the repo in the secondary store
    await writeRegistry(secondaryStorePath, [REPO]);

    // Create a COMPLETE project in the secondary store
    const projectPlanPath = join(planDir, SLUG);
    await mkdir(projectPlanPath, { recursive: true });
    const store = new LedgerStore(projectPlanPath, secondaryStorePath);
    await store.writeRootIndex(makeRoot('COMPLETE', { synthesis_generated: true }));
    // Backdate by 40 days so it exceeds the 30-day threshold
    await backdateProject(store, 40);

    // Configure 2-store context
    const config = makeConfig([
      { id: 'default', path: defaultStorePath },
      { id: 'secondary', path: secondaryStorePath },
    ]);
    const router = new StoreRouter(config, { skipDirCreate: true });
    setStoreContext(router, new MultiStoreManager(router));

    const archived = await runAutoArchive(defaultStorePath, 30);

    expect(archived).toContain(SLUG);

    // Confirm the status was updated in the secondary store
    const updatedMeta = await store.readProjectMeta();
    expect(updatedMeta.status).toBe('ARCHIVED');
  });

  it('does not skip non-default-store projects when default store has projects too', async () => {
    const REPO_DEFAULT = 'default-repo';
    const SLUG_DEFAULT = '2026-01-02-default-proj';
    const REPO_SECONDARY = 'secondary-repo';
    const SLUG_SECONDARY = '2026-01-03-secondary-proj';

    // Each repo registered in its own store
    await writeRegistry(defaultStorePath, [REPO_DEFAULT]);
    await writeRegistry(secondaryStorePath, [REPO_SECONDARY]);

    // Create eligible projects in both stores
    const planDefault = join(planDir, SLUG_DEFAULT);
    const planSecondary = join(planDir, SLUG_SECONDARY);
    await mkdir(planDefault, { recursive: true });
    await mkdir(planSecondary, { recursive: true });

    const storeDefault = new LedgerStore(planDefault, defaultStorePath);
    const storeSecondary = new LedgerStore(planSecondary, secondaryStorePath);

    await storeDefault.writeRootIndex(makeRoot('COMPLETE', { synthesis_generated: true }));
    await storeSecondary.writeRootIndex(makeRoot('COMPLETE', { synthesis_generated: true }));
    await backdateProject(storeDefault, 35);
    await backdateProject(storeSecondary, 35);

    const config = makeConfig([
      { id: 'default', path: defaultStorePath },
      { id: 'secondary', path: secondaryStorePath },
    ]);
    const router = new StoreRouter(config, { skipDirCreate: true });
    setStoreContext(router, new MultiStoreManager(router));

    const archived = await runAutoArchive(defaultStorePath, 30);

    expect(archived).toContain(SLUG_DEFAULT);
    expect(archived).toContain(SLUG_SECONDARY);

    const metaDefault = await storeDefault.readProjectMeta();
    const metaSecondary = await storeSecondary.readProjectMeta();
    expect(metaDefault.status).toBe('ARCHIVED');
    expect(metaSecondary.status).toBe('ARCHIVED');
  });
});
