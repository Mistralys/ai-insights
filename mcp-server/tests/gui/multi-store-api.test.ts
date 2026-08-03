/**
 * Multi-store integration tests for gui/api.ts
 *
 * Verifies that resolveProjectStore() and the handlers that depend on it
 * correctly locate and operate on projects that live in a non-default store.
 * Each test creates a 2-store configuration, registers a repo in the secondary
 * (non-default) store, and exercises the handler against that project.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleGetProject,
  handleListWorkPackages,
  handleArchiveProject,
  ApiError,
} from '../../gui/api.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME } from '../../src/utils/constants.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';
import type { RootIndex } from '../../src/schema/root-index.js';

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

function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: PLAN_ARCHIVE_FILENAME,
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const REPO = 'my-repo';
const SLUG = '2026-01-01-test-proj';

let tempDir: string;
let defaultStorePath: string;
let secondaryStorePath: string;
let planPath: string;
let store: LedgerStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'multi-store-api-'));
  defaultStorePath = join(tempDir, 'store-default');
  secondaryStorePath = join(tempDir, 'store-secondary');
  await mkdir(defaultStorePath, { recursive: true });
  await mkdir(secondaryStorePath, { recursive: true });

  // Register REPO in the secondary (non-default) store
  await writeRegistry(secondaryStorePath, [REPO]);

  // Initialize a project in the secondary store
  planPath = join(tempDir, REPO, 'docs', 'agents', 'plans', SLUG);
  await mkdir(planPath, { recursive: true });
  store = new LedgerStore(planPath, secondaryStorePath);
  await store.writeRootIndex(makeRoot({ status: 'IN_PROGRESS' }));

  // Set up 2-store context with secondary as non-default
  const config = makeConfig([
    { id: 'default', path: defaultStorePath },
    { id: 'secondary', path: secondaryStorePath },
  ]);
  const router = new StoreRouter(config, { skipDirCreate: true });
  setStoreContext(router, new MultiStoreManager(router));
});

afterEach(async () => {
  restoreLegacyContext();
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveProjectStore — multi-store mode', () => {
  it('finds a project in a non-default store via handleGetProject', async () => {
    const result = await handleGetProject(defaultStorePath, SLUG, REPO);
    expect(result).toBeDefined();
    expect(result.meta.slug).toBe(SLUG);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('returns NOT_FOUND for a project not in any store', async () => {
    await expect(
      handleGetProject(defaultStorePath, '2026-01-01-nonexistent', REPO)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('handleListWorkPackages delegates to non-default store', async () => {
    const result = await handleListWorkPackages(defaultStorePath, SLUG, REPO);
    expect(Array.isArray(result)).toBe(true);
    // Empty WP list — project was initialized with no WPs
    expect(result).toHaveLength(0);
  });

  it('handleArchiveProject operates on a project in the non-default store', async () => {
    // Transition to COMPLETE first (required for archive)
    await store.writeRootIndex(makeRoot({ status: 'COMPLETE', synthesis_generated: true }));
    await handleArchiveProject(defaultStorePath, SLUG, REPO);

    // Read the meta from the SECONDARY store (not default) to confirm write went there
    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('ARCHIVED');
  });

  it('no phantom directories are created in the default store', async () => {
    // Run a read-only handler on the project in the secondary store
    await handleGetProject(defaultStorePath, SLUG, REPO);

    // Assert no directory was created under the default store for this repo/slug
    const phantomPath = join(defaultStorePath, REPO);
    await expect(access(phantomPath, constants.F_OK)).rejects.toThrow();
  });
});
