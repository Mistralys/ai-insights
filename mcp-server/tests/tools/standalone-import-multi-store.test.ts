/**
 * Integration tests for standalone-import multi-store routing (WP-005).
 *
 * Verifies that importStandalone() and updateSynthesis() correctly route
 * to the registered non-default store when multi-store mode is active.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';
import { _internal } from '../../src/tools/standalone-import.js';

const { importStandalone, updateSynthesis } = _internal;

// ─── Constants ────────────────────────────────────────────────────────────────

const REPO_NAME = 'test-standalone-repo';
const SLUG = '2026-08-01-standalone-import-test';

const PLAN_CONTENT = '# Standalone Test Plan\n\n## Summary\n\nA test plan for multi-store standalone import routing.\n';
const SYNTHESIS_CONTENT = '# Synthesis\n\n## Outcome Summary\n\nAll tasks completed successfully.\n';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(
  stores: Array<{ id: string; path: string; label: string }>
): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: stores[0]!.id,
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

function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

// ─── Shared State ─────────────────────────────────────────────────────────────

let tempDir: string;
let storeDefaultPath: string;
let storeSecondaryPath: string;
let planPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'standalone-import-multi-store-'));
  storeDefaultPath = join(tempDir, 'store-default');
  storeSecondaryPath = join(tempDir, 'store-secondary');
  planPath = join(tempDir, REPO_NAME, 'docs', 'agents', 'plans', SLUG);

  await mkdir(storeDefaultPath, { recursive: true });
  await mkdir(storeSecondaryPath, { recursive: true });
  await mkdir(planPath, { recursive: true });
  await writeFile(join(planPath, 'plan.md'), PLAN_CONTENT);
  await writeFile(join(planPath, 'synthesis.md'), SYNTHESIS_CONTENT);
});

afterEach(async () => {
  restoreLegacyContext();
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Context Setup ────────────────────────────────────────────────────────────

function initTwoStoreContext(): void {
  const config = makeConfig([
    { id: 'default', path: storeDefaultPath, label: 'Default' },
    { id: 'secondary', path: storeSecondaryPath, label: 'Secondary' },
  ]);
  const router = new StoreRouter(config);
  setStoreContext(router, new MultiStoreManager(router));
}

/** Expected ledger path in the secondary store. */
function secondaryLedgerPath(): string {
  return join(storeSecondaryPath, REPO_NAME, SLUG);
}

/** Default store repo path that must remain empty (phantom-directory guard). */
function defaultStoreRepoPath(): string {
  return join(storeDefaultPath, REPO_NAME);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. importStandalone — creates project in the registered non-default store
// ─────────────────────────────────────────────────────────────────────────────

describe('importStandalone — resolves to non-default store', () => {
  it('creates the project in the secondary store, not the default store', async () => {
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, [REPO_NAME]);
    initTwoStoreContext();

    const result = await importStandalone({ project_path: planPath });

    expect((result as any).isError).toBeFalsy();
    const data = parseResult(result) as { slug: string; project_storage_path: string };
    expect(data.slug).toBe(SLUG);
    expect(existsSync(secondaryLedgerPath())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. importStandalone — rejects unregistered repo with a clear error message
// ─────────────────────────────────────────────────────────────────────────────

describe('importStandalone — unregistered repo returns error', () => {
  it('returns an error when repo is not registered in any store in multi-store mode', async () => {
    // Register nothing — repo is unknown in both stores
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, []);
    initTwoStoreContext();

    const result = await importStandalone({ project_path: planPath });

    expect((result as any).isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('not registered in any store');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. updateSynthesis — reads/writes in the non-default store
// ─────────────────────────────────────────────────────────────────────────────

describe('updateSynthesis — resolves to non-default store', () => {
  it('updates the synthesis of a project in the secondary store', async () => {
    // First, import the project into the secondary store
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, [REPO_NAME]);
    initTwoStoreContext();
    await importStandalone({ project_path: planPath });

    // Modify synthesis.md in the plan folder
    await writeFile(join(planPath, 'synthesis.md'), SYNTHESIS_CONTENT + '\nUpdated outcome.\n');

    // updateSynthesis should find and update the project in the secondary store
    const result = await updateSynthesis({ project_path: planPath });

    expect((result as any).isError).toBeFalsy();
    const data = parseResult(result) as { slug: string };
    expect(data.slug).toBe(SLUG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Phantom directory assertion — default store remains clean
// ─────────────────────────────────────────────────────────────────────────────

describe('Phantom directory assertion — default store remains clean after standalone import', () => {
  it('creates no repo directory under the default store after importStandalone to secondary store', async () => {
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, [REPO_NAME]);
    initTwoStoreContext();

    await importStandalone({ project_path: planPath });

    expect(existsSync(defaultStoreRepoPath())).toBe(false);
    expect(existsSync(secondaryLedgerPath())).toBe(true);
  });
});
