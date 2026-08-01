import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { StoresConfigSchema, type StoresConfig } from '../schema/store-config.js';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';

/**
 * The user-level directory for ai-insights configuration.
 * All user-level config files (stores.json, gui-config.json) live here.
 */
const AI_INSIGHTS_DIR = '.ai-insights';

/**
 * File name for the multi-store configuration file.
 */
const STORES_CONFIG_FILENAME = 'stores.json';

// ==================== Path Utilities ====================

/**
 * Returns the absolute path of `stores.json` under the user's home directory.
 *
 * The file is stored at `~/.ai-insights/stores.json` — a fixed user-level
 * location that survives reinstalls and is independent of any single store.
 */
export function resolveStoresConfigPath(): string {
  return join(homedir(), AI_INSIGHTS_DIR, STORES_CONFIG_FILENAME);
}

/**
 * Expands a `~`-prefixed path to an absolute path using `os.homedir()`,
 * then normalizes it with `path.resolve()`.
 *
 * - `~/foo`         → `{homedir}/foo`
 * - `~`             → `{homedir}` (bare tilde)
 * - `/absolute/foo` → `/absolute/foo` (unchanged, normalized)
 * - `relative/foo`  → resolved relative to `process.cwd()` — **avoid in
 *   production.** Paths from `stores.json` should always be absolute or
 *   `~`-prefixed. A relative path will resolve correctly only if the process
 *   CWD happens to match the intended base, which is not guaranteed across
 *   server restarts or test environments.
 *
 * Note: `~username` patterns (e.g. `~bob`, `~bob/data`) are rejected with a
 * clear error message — they are not a valid store path format.
 *
 * @param pathStr - Path string to expand and normalize
 */
export function expandStorePath(pathStr: string): string {
  if (pathStr.startsWith('~/') || pathStr === '~') {
    const rest = pathStr.slice(2); // strip '~/'
    return resolve(join(homedir(), rest));
  }
  if (pathStr.startsWith('~')) {
    throw new Error(
      `Store path '${pathStr}' uses ~username syntax which is not supported. Use ~/path or an absolute path.`
    );
  }
  return resolve(pathStr);
}

/**
 * Returns the path to the GUI configuration file.
 *
 * When a `storeConfig` is provided (non-null), the GUI config lives at the
 * user-level location `~/.ai-insights/gui-config.json`, shared across all
 * stores. When `storeConfig` is null (single-store / legacy mode), the GUI
 * config is co-located with the ledger root at `{ledgerRoot}/gui-config.json`.
 *
 * @param storeConfig - The current stores config, or null in single-store mode
 * @param ledgerRoot  - Absolute path to the active ledger root directory
 */
export function resolveGuiConfigPath(
  storeConfig: StoresConfig | null,
  ledgerRoot: string
): string {
  if (storeConfig !== null) {
    return join(homedir(), AI_INSIGHTS_DIR, 'gui-config.json');
  }
  return join(ledgerRoot, 'gui-config.json');
}

// ==================== I/O ====================

/**
 * Reads and parses the `stores.json` configuration file.
 *
 * Returns `null` when:
 *   - the file does not exist (first-run scenario or single-store mode)
 *   - the file exists but contains malformed JSON
 *   - the file exists but fails `StoresConfigSchema` validation (a warning
 *     is written to `stderr` in this case so the caller is not left guessing)
 *
 * @param configPath - Absolute path to `stores.json`. Defaults to
 *   `resolveStoresConfigPath()` (`~/.ai-insights/stores.json`) when omitted.
 */
export async function loadStoresConfig(
  configPath?: string
): Promise<StoresConfig | null> {
  const path = configPath ?? resolveStoresConfigPath();

  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    // File does not exist or is not readable — silent null return
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // Malformed JSON — emit a warning but do not throw
    process.stderr.write(
      `[store-registry] Warning: ${path} contains malformed JSON — ignoring multi-store config.\n`
    );
    return null;
  }

  const result = StoresConfigSchema.safeParse(data);
  if (!result.success) {
    process.stderr.write(
      `[store-registry] Warning: ${path} failed schema validation — ignoring multi-store config.\n`
    );
    return null;
  }

  return result.data;
}

/**
 * Writes a validated `StoresConfig` to `stores.json` atomically under a
 * file lock, using the write-to-temp-then-rename pattern.
 *
 * The lock is acquired on `~/.ai-insights/` so that concurrent writes to
 * any user-level config file are serialized by the same lock. The write
 * itself uses `atomicWriteJson` so readers never observe a partial write.
 *
 * @param config     - Stores configuration to persist (validated before write)
 * @param configPath - Absolute path to `stores.json`. Defaults to
 *   `resolveStoresConfigPath()` when omitted.
 * @throws Error if schema validation fails or if the atomic write fails
 */
export async function saveStoresConfig(
  config: StoresConfig,
  configPath?: string
): Promise<void> {
  const path = configPath ?? resolveStoresConfigPath();
  const validated = StoresConfigSchema.parse(config);

  // Lock on the parent directory (~/.ai-insights/) to serialize all
  // user-level config writes under the same lock.
  const lockDir = join(homedir(), AI_INSIGHTS_DIR);

  await withLock(lockDir, async () => {
    await atomicWriteJson(path, validated);
  });
}
