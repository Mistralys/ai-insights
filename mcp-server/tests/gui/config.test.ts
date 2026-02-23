/**
 * Tests for src/gui/config.ts
 *
 * Uses real temp directories and real fs.watch() — no mocks.
 * Each test resets module-level singleton state via __resetForTesting().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  getConfig,
  readConfigFromDisk,
  writeConfig,
  startConfigWatcher,
  stopConfigWatcher,
  __resetForTesting,
  DEFAULT_CONFIG,
} from '../../src/gui/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Waits `ms` milliseconds. Used to let the fs.watch() debounce settle. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Writes arbitrary JSON to a file. */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('gui/config.ts', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gui-config-test-'));
    configPath = join(tempDir, 'gui-config.json');
    __resetForTesting();
  });

  afterEach(async () => {
    stopConfigWatcher();
    __resetForTesting();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── getConfig (default cache) ────────────────────────────────────────────

  it('getConfig returns DEFAULT_CONFIG before readConfigFromDisk is called', () => {
    const cfg = getConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.auto_handoff_enabled).toBe(true);
    expect(cfg.max_handoff_depth).toBe(10);
  });

  // ─── readConfigFromDisk — missing file ───────────────────────────────────

  it('readConfigFromDisk creates file with defaults when missing, returns DEFAULT_CONFIG', async () => {
    const result = await readConfigFromDisk(configPath);

    expect(result).toEqual(DEFAULT_CONFIG);

    // File should now exist on disk
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.auto_handoff_enabled).toBe(true);
    expect(parsed.max_handoff_depth).toBe(10);
  });

  // ─── readConfigFromDisk — valid file ─────────────────────────────────────

  it('readConfigFromDisk parses a valid config file and updates cache', async () => {
    await writeJson(configPath, {
      auto_handoff_enabled: false,
      max_handoff_depth: 3,
      ledger_root: '/some/root',
    });

    const result = await readConfigFromDisk(configPath);

    expect(result.auto_handoff_enabled).toBe(false);
    expect(result.max_handoff_depth).toBe(3);
    expect(result.ledger_root).toBe('/some/root');
    // Cache should be updated
    expect(getConfig()).toEqual(result);
  });

  // ─── readConfigFromDisk — invalid JSON ──────────────────────────────────

  it('readConfigFromDisk returns DEFAULT_CONFIG on malformed JSON', async () => {
    await writeFile(configPath, '{ not valid json }', 'utf-8');

    const result = await readConfigFromDisk(configPath);

    expect(result).toEqual(DEFAULT_CONFIG);
    // Should not throw
  });

  // ─── readConfigFromDisk — invalid schema ────────────────────────────────

  it('readConfigFromDisk returns DEFAULT_CONFIG when Zod validation fails', async () => {
    await writeJson(configPath, { auto_handoff_enabled: 123 }); // wrong type

    const result = await readConfigFromDisk(configPath);

    expect(result).toEqual(DEFAULT_CONFIG);
  });

  // ─── writeConfig — valid partial update ──────────────────────────────────

  it('writeConfig persists a valid partial update and merges with defaults', async () => {
    const result = await writeConfig(configPath, { max_handoff_depth: 5 });

    expect(result.max_handoff_depth).toBe(5);
    expect(result.auto_handoff_enabled).toBe(true); // default preserved
    expect(result.ledger_root).toBe(''); // default preserved

    // Verify on disk
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.max_handoff_depth).toBe(5);
    expect(parsed.auto_handoff_enabled).toBe(true);
  });

  // ─── writeConfig — ledger_root is stripped ───────────────────────────────

  it('writeConfig strips ledger_root — persisted value must not change to new path', async () => {
    // Initialize with a known ledger_root
    await readConfigFromDisk(configPath); // creates defaults (ledger_root: '')

    const before = getConfig().ledger_root; // ''

    // Attempt to overwrite ledger_root via writeConfig
    const result = await writeConfig(configPath, { ledger_root: '/evil/path' } as any);

    // ledger_root should remain unchanged
    expect(result.ledger_root).toBe(before);
    expect(result.ledger_root).not.toBe('/evil/path');

    // Verify on disk
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.ledger_root).not.toBe('/evil/path');
  });

  // ─── writeConfig — invalid Zod schema ───────────────────────────────────

  it('writeConfig throws ZodError when max_handoff_depth is 0 (min(1) violated)', async () => {
    await expect(writeConfig(configPath, { max_handoff_depth: 0 })).rejects.toThrow();
  });

  // ─── getConfig after writeConfig ────────────────────────────────────────

  it('getConfig returns updated values synchronously after writeConfig', async () => {
    await writeConfig(configPath, { auto_handoff_enabled: false, max_handoff_depth: 7 });

    const cfg = getConfig();
    expect(cfg.auto_handoff_enabled).toBe(false);
    expect(cfg.max_handoff_depth).toBe(7);
  });

  // ─── Watcher lifecycle ───────────────────────────────────────────────────

  it('startConfigWatcher + file change updates cache after debounce', async () => {
    // Seed config on disk
    await writeConfig(configPath, { auto_handoff_enabled: true, max_handoff_depth: 10 });

    startConfigWatcher(configPath);

    // Write a new config to the watched path
    await writeJson(configPath, {
      auto_handoff_enabled: false,
      max_handoff_depth: 4,
      ledger_root: '',
    });

    // Wait for debounce (250ms) + I/O buffer
    await wait(400);

    const cfg = getConfig();
    expect(cfg.auto_handoff_enabled).toBe(false);
    expect(cfg.max_handoff_depth).toBe(4);

    stopConfigWatcher(); // explicit teardown
  });

  it('stopConfigWatcher is a no-op when no watcher is active', () => {
    expect(() => stopConfigWatcher()).not.toThrow();
  });

  it('stopConfigWatcher called twice does not throw', () => {
    startConfigWatcher(configPath);
    stopConfigWatcher();
    expect(() => stopConfigWatcher()).not.toThrow();
  });

  // ─── Double startConfigWatcher ───────────────────────────────────────────

  it('calling startConfigWatcher twice replaces existing watcher without leaking', async () => {
    await writeConfig(configPath, { auto_handoff_enabled: true, max_handoff_depth: 10 });

    startConfigWatcher(configPath);
    startConfigWatcher(configPath); // second call — must not throw or leak

    // Verify watcher still picks up changes
    await writeJson(configPath, {
      auto_handoff_enabled: false,
      max_handoff_depth: 2,
      ledger_root: '',
    });
    await wait(400);

    expect(getConfig().auto_handoff_enabled).toBe(false);
    expect(getConfig().max_handoff_depth).toBe(2);

    stopConfigWatcher();
  });
});
