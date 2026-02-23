/**
 * GUI Configuration Module
 *
 * Manages runtime configuration for the MCP server and GUI dashboard.
 * Uses a module-level singleton cache populated at startup via readConfigFromDisk().
 * The cache is kept fresh via an fs.watch() file watcher with a 250ms debounce.
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 */

import { readFile } from 'fs/promises';
import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import { z } from 'zod';
import { atomicWriteJson } from '../storage/atomic-writer.js';

// ---------------------------------------------------------------------------
// Schema & Types
// ---------------------------------------------------------------------------

export const GuiConfigSchema = z.object({
  auto_handoff_enabled: z.boolean().default(true),
  max_handoff_depth: z.number().int().min(1).default(10),
  ledger_root: z.string().default(''),
});

export type GuiConfig = z.infer<typeof GuiConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: GuiConfig = {
  auto_handoff_enabled: true,
  max_handoff_depth: 10,
  ledger_root: '',
};

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

let _cache: GuiConfig = { ...DEFAULT_CONFIG };
let _watcher: FSWatcher | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current in-memory cached config synchronously.
 * Never reads disk. Must be cheap to call.
 */
export function getConfig(): GuiConfig {
  return _cache;
}

/**
 * Reads and parses gui-config.json from disk.
 *
 * - If the file is missing, writes DEFAULT_CONFIG to disk (self-healing) and
 *   returns DEFAULT_CONFIG.
 * - If the file is present but invalid, logs a warning to stderr and returns
 *   DEFAULT_CONFIG without updating disk.
 * - On success, updates the in-memory cache and returns the parsed config.
 */
export async function readConfigFromDisk(configPath: string): Promise<GuiConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // File doesn't exist — write defaults and return them
      process.stderr.write(
        `[config] gui-config.json not found at ${configPath}, creating with defaults\n`
      );
      await atomicWriteJson(configPath, DEFAULT_CONFIG);
      _cache = { ...DEFAULT_CONFIG };
      return _cache;
    }
    // Unexpected read error
    process.stderr.write(`[config] Failed to read ${configPath}: ${String(err)}\n`);
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[config] Failed to parse ${configPath} as JSON: ${String(err)}\n`
    );
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  const result = GuiConfigSchema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(
      `[config] Validation failed for ${configPath}: ${result.error.message}\n`
    );
    _cache = { ...DEFAULT_CONFIG };
    return _cache;
  }

  _cache = result.data;
  return _cache;
}

/**
 * Writes a (partial) config to disk atomically.
 *
 * Merges the provided data with the current cache, validates the full merged
 * object with Zod, writes via atomicWriteJson(), updates the in-memory cache,
 * and returns the written config.
 *
 * `ledger_root` is stripped from `data` — it is read-only and can only be set
 * by the server at startup via readConfigFromDisk().
 *
 * Throws ZodError on invalid input.
 */
export async function writeConfig(
  configPath: string,
  data: Partial<GuiConfig>
): Promise<GuiConfig> {
  // Strip ledger_root — it is read-only from the caller's perspective
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ledger_root: _ignored, ...safeData } = data;
  const merged = { ..._cache, ...safeData };
  const validated = GuiConfigSchema.parse(merged); // throws ZodError on failure
  await atomicWriteJson(configPath, validated);
  _cache = validated;
  return _cache;
}

/**
 * Starts an fs.watch() on configPath with a 250ms debounce.
 *
 * On change: re-reads the file, re-validates, updates the cache.
 * On error or ENOENT: logs to stderr, retains last known good cache.
 *
 * Safe to call multiple times (stops existing watcher first).
 */
export function startConfigWatcher(configPath: string): void {
  // Stop any existing watcher before starting a new one
  stopConfigWatcher();

  try {
    _watcher = watch(configPath, { persistent: false }, (_eventType) => {
      // Debounce: clear any pending timer and set a new one
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
      }
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        // Re-read config from disk, update cache
        readFile(configPath, 'utf-8')
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              process.stderr.write(
                `[config] File watcher: failed to parse ${configPath} as JSON, retaining cache\n`
              );
              return;
            }
            const result = GuiConfigSchema.safeParse(parsed);
            if (!result.success) {
              process.stderr.write(
                `[config] File watcher: validation failed for ${configPath}, retaining cache\n`
              );
              return;
            }
            _cache = result.data;
            process.stderr.write(
              `[config] File watcher: cache updated from ${configPath}\n`
            );
          })
          .catch((err: unknown) => {
            if (isNodeError(err) && err.code === 'ENOENT') {
              process.stderr.write(
                `[config] File watcher: ${configPath} deleted, retaining cache\n`
              );
            } else {
              process.stderr.write(
                `[config] File watcher: read error on ${configPath}: ${String(err)}\n`
              );
            }
          });
      }, 250);
    });

    _watcher.on('error', (err) => {
      process.stderr.write(
        `[config] File watcher error on ${configPath}: ${String(err)}\n`
      );
    });
  } catch (err) {
    // fs.watch() can throw synchronously if the path is on an unsupported fs
    process.stderr.write(
      `[config] Could not start file watcher on ${configPath}: ${String(err)}\n`
    );
  }
}

/**
 * Closes the active FSWatcher if one exists.
 * Safe to call multiple times (no-op if not watching).
 */
export function stopConfigWatcher(): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (_watcher !== null) {
    try {
      _watcher.close();
    } catch {
      // Ignore errors on close — we're shutting down
    }
    _watcher = null;
  }
}

// ---------------------------------------------------------------------------
// Test helpers (never import this in production code)
// ---------------------------------------------------------------------------

/**
 * Resets all module-level singleton state. FOR TESTING ONLY.
 * Closes any active watcher, clears debounce timer, and resets cache to defaults.
 */
export function __resetForTesting(): void {
  stopConfigWatcher();
  _cache = { ...DEFAULT_CONFIG };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
