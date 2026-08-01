import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  reloadStoreContext,
  getStoreRouter,
  getMultiStoreManager,
} from '../../src/storage/store-context.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfigContent(storePath: string): string {
  const config: StoresConfig = {
    stores: [{ id: 'primary', path: storePath, label: 'Primary' }],
    default_store: 'primary',
  };
  return JSON.stringify(config);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reloadStoreContext()', () => {
  let tempDir: string;
  let configPath: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-ctx-reload-'));
    configPath = join(tempDir, 'stores.json');
    storePath = join(tempDir, 'primary-store');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── fresh config reload ───────────────────────────────────────────────

  it('returns the parsed config and transitions the router to multi-store mode', async () => {
    await writeFile(configPath, makeConfigContent(storePath));

    const result = await reloadStoreContext(configPath);

    expect(result).not.toBeNull();
    expect(result!.stores[0].id).toBe('primary');
    expect(result!.default_store).toBe('primary');
  });

  it('after reload, getStoreRouter() returns the newly created router', async () => {
    await writeFile(configPath, makeConfigContent(storePath));

    await reloadStoreContext(configPath);

    expect(getStoreRouter().isMultiStoreMode()).toBe(true);
  });

  it('after reload, getMultiStoreManager() reflects the new context', async () => {
    await writeFile(configPath, makeConfigContent(storePath));

    await reloadStoreContext(configPath);

    expect(getMultiStoreManager()).toBeDefined();
  });

  // ─── missing / invalid stores.json → legacy fallback ──────────────────

  it('returns null and restores legacy mode when stores.json does not exist', async () => {
    // configPath has not been written — file is absent
    const result = await reloadStoreContext(configPath);

    expect(result).toBeNull();
    expect(getStoreRouter().isMultiStoreMode()).toBe(false);
  });

  it('returns null and restores legacy mode for malformed JSON', async () => {
    await writeFile(configPath, '{ not: valid json ');

    const result = await reloadStoreContext(configPath);

    expect(result).toBeNull();
    expect(getStoreRouter().isMultiStoreMode()).toBe(false);
  });

  it('returns null and restores legacy mode for a schema-invalid stores.json', async () => {
    await writeFile(configPath, JSON.stringify({ unexpected_key: true }));

    const result = await reloadStoreContext(configPath);

    expect(result).toBeNull();
    expect(getStoreRouter().isMultiStoreMode()).toBe(false);
  });

  // ─── skipDirCreate: true ───────────────────────────────────────────────

  it('does not auto-create store directories during reload', async () => {
    const neverCreatedPath = join(tempDir, 'store-must-not-be-created');
    await writeFile(configPath, makeConfigContent(neverCreatedPath));

    expect(existsSync(neverCreatedPath)).toBe(false);

    await reloadStoreContext(configPath);

    // skipDirCreate: true must suppress mkdirSync for each store path
    expect(existsSync(neverCreatedPath)).toBe(false);
  });

  // ─── concurrency coalescing ────────────────────────────────────────────

  it('concurrent calls share one inflight promise and resolve to the same value', async () => {
    await writeFile(configPath, makeConfigContent(storePath));

    const p1 = reloadStoreContext(configPath);
    const p2 = reloadStoreContext(configPath);

    // Same promise object: proves _pendingReload was returned for the second call,
    // meaning setStoreContext() executes exactly once per concurrent batch.
    expect(p1).toBe(p2);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
  });
});
