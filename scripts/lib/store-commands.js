/**
 * scripts/lib/store-commands.js
 *
 * Pure-JavaScript implementation of the `store` command group.
 *
 * All exported functions accept an optional `_configPath` parameter for test
 * isolation — when provided, it overrides the default `~/.ai-insights/stores.json`
 * location so tests can work with temporary directories without touching real
 * user-level config.
 *
 * File formats are compatible with the TypeScript storage modules:
 *   - stores.json      → StoresConfigSchema
 *   - .repositories.json → RepositoryRegistrySchema
 *
 * ## Public command API (consumed by scripts/cli.js → cmdStore())
 *
 *   storeInit, storeAdd, storeRemove, storeList, storeSetDefault,
 *   storeConflicts, storeStatus, storeRepoAdd, storeRepoMove, storeRepoList
 *
 * ## Exported for test isolation only (not part of the public CLI API)
 *
 *   resolveConfigPath, expandPath, registryPath,
 *   loadConfig, saveConfig, loadRegistry, saveRegistry
 *
 *   These helpers are exported so tests can pre-seed config and registry files
 *   in temporary directories and inject override paths. They are not intended
 *   to be called by scripts other than the test suite.
 */

import { homedir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_INSIGHTS_DIR   = '.ai-insights';
const STORES_FILENAME   = 'stores.json';
const REGISTRY_FILENAME = '.repositories.json';

// ─── Path Utilities ───────────────────────────────────────────────────────────

/**
 * Returns the default path to `~/.ai-insights/stores.json`.
 */
export function resolveConfigPath() {
  return join(homedir(), AI_INSIGHTS_DIR, STORES_FILENAME);
}

/**
 * Expands a `~`-prefixed path to an absolute path, then normalizes with
 * `path.resolve()`. Mirrors the TypeScript `expandStorePath()` in store-registry.ts.
 *
 * @param {string} p
 * @returns {string}
 */
export function expandPath(p) {
  if (p.startsWith('~/') || p === '~') {
    return resolve(join(homedir(), p.slice(2)));
  }
  return resolve(p);
}

/**
 * Returns the absolute path of the `.repositories.json` for a store.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @returns {string}
 */
export function registryPath(storePath) {
  return join(storePath, REGISTRY_FILENAME);
}

// ─── JSON I/O ────────────────────────────────────────────────────────────────

/**
 * Reads and parses a JSON file synchronously.
 * Returns `null` on any error (missing file, malformed JSON, permissions).
 *
 * @param {string} filePath
 * @returns {unknown | null}
 */
function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes `data` as formatted JSON to `filePath` synchronously.
 * Creates parent directories as needed.
 *
 * @param {string} filePath
 * @param {unknown} data
 */
function writeJsonSync(filePath, data) {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Config I/O ──────────────────────────────────────────────────────────────

/**
 * Loads the stores.json config from the given path (or the default path).
 * Returns `null` if the file doesn't exist or cannot be parsed.
 *
 * @param {string | undefined} configPath
 * @returns {{ stores: Array, default_store: string } | null}
 */
export function loadConfig(configPath) {
  const data = readJsonSync(configPath ?? resolveConfigPath());
  if (!data || !Array.isArray(data.stores)) return null;
  return data;
}

/**
 * Writes the stores.json config atomically (JSON.stringify + writeFileSync).
 *
 * @param {{ stores: Array, default_store: string }} config
 * @param {string | undefined} configPath
 * @param {string | undefined} _storesDirOverride - When provided, used instead of
 *   `~/.ai-insights/` for the parent-directory mkdirSync call. Intended for test
 *   isolation so tests never touch the real user-level config directory.
 */
export function saveConfig(config, configPath, _storesDirOverride) {
  const p = configPath ?? resolveConfigPath();
  const storesDir = _storesDirOverride ?? join(homedir(), AI_INSIGHTS_DIR);
  fs.mkdirSync(storesDir, { recursive: true });
  writeJsonSync(p, config);
}

// ─── Registry I/O ────────────────────────────────────────────────────────────

/**
 * Loads the `.repositories.json` for a store. Returns `{ repositories: [] }`
 * if the file doesn't exist or is invalid — same behaviour as the TypeScript
 * `loadRegistry()` in repository-registry.ts.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @returns {{ repositories: Array }}
 */
export function loadRegistry(storePath) {
  const data = readJsonSync(registryPath(storePath));
  if (!data || !Array.isArray(data.repositories)) {
    return { repositories: [] };
  }
  return data;
}

/**
 * Writes the repository registry for a store.
 *
 * @param {string} storePath - Absolute path to the store root directory
 * @param {{ repositories: Array }} registry
 */
export function saveRegistry(storePath, registry) {
  writeJsonSync(registryPath(storePath), registry);
}

// ─── store init ───────────────────────────────────────────────────────────────

/**
 * Creates `~/.ai-insights/stores.json` with a single default store pointing
 * at the provided `ledgerRoot` (or the default `mcp-server/storage/ledger/`).
 *
 * Also creates `~/.ai-insights/stores/` as the recommended stores directory.
 *
 * @param {{ configPath?: string, ledgerRoot?: string, _storesDirOverride?: string }} [opts]
 * @returns {{ ok: boolean, config?: object, configPath?: string, reason?: string }}
 */
export function storeInit({ configPath, ledgerRoot, _storesDirOverride } = {}) {
  const cp = configPath ?? resolveConfigPath();

  if (fs.existsSync(cp)) {
    return { ok: false, reason: `stores.json already exists at ${cp}` };
  }

  // Create the recommended stores directory.
  const baseDir = _storesDirOverride ?? join(homedir(), AI_INSIGHTS_DIR);
  const storesDir = join(baseDir, 'stores');
  fs.mkdirSync(storesDir, { recursive: true });

  const root = ledgerRoot ?? join(process.cwd(), 'mcp-server', 'storage', 'ledger');
  const absRoot = expandPath(root);

  const config = {
    stores: [{ id: 'default', label: 'Default', path: absRoot }],
    default_store: 'default',
  };

  saveConfig(config, cp, _storesDirOverride);
  return { ok: true, config, configPath: cp };
}

// ─── store add ────────────────────────────────────────────────────────────────

/**
 * Registers a new store in `stores.json`, creates the store directory, and
 * initializes an empty `.repositories.json` if one doesn't exist.
 *
 * @param {{ id: string, storePath: string, label?: string, configPath?: string }} opts
 * @returns {{ ok: boolean, id?: string, path?: string, reason?: string }}
 */
export function storeAdd({ id, storePath, label, configPath } = {}) {
  if (!id)        return { ok: false, reason: 'Store ID is required.' };
  if (!storePath) return { ok: false, reason: 'Store path is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp) ?? { stores: [], default_store: id };
  const absPath = expandPath(storePath);

  if (config.stores.some(s => s.id === id)) {
    return { ok: false, reason: `Store '${id}' already exists in stores.json.` };
  }

  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Cannot create store directory '${absPath}': ${err.message}` };
  }

  // Initialize an empty registry if the store doesn't have one.
  const regPath = registryPath(absPath);
  if (!fs.existsSync(regPath)) {
    saveRegistry(absPath, { repositories: [] });
  }

  config.stores.push({ id, label: label ?? id, path: absPath });
  saveConfig(config, cp);

  return { ok: true, id, path: absPath };
}

// ─── store remove ─────────────────────────────────────────────────────────────

/**
 * Removes a store entry from `stores.json`. Does NOT delete the directory.
 * Returns `warned: true` when the store's `.repositories.json` has entries —
 * the caller should display a warning.
 *
 * @param {{ id: string, configPath?: string }} opts
 * @returns {{ ok: boolean, id?: string, hasRepos?: boolean, warned?: boolean, reason?: string }}
 */
export function storeRemove({ id, configPath } = {}) {
  if (!id) return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  const idx = config.stores.findIndex(s => s.id === id);
  if (idx === -1) return { ok: false, reason: `Store '${id}' not found in stores.json.` };

  const store   = config.stores[idx];
  const absPath = expandPath(store.path);
  const registry = loadRegistry(absPath);
  const hasRepos = registry.repositories.length > 0;

  config.stores.splice(idx, 1);

  // Reassign default_store if it pointed at the removed store.
  if (config.stores.length === 0) {
    config.default_store = null;
  } else if (config.default_store === id) {
    config.default_store = config.stores[0].id;
  }

  saveConfig(config, cp);
  return { ok: true, id, hasRepos, warned: hasRepos };
}

// ─── store list ───────────────────────────────────────────────────────────────

/**
 * Returns a summary of all registered stores with repo and project counts.
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, stores: Array, default_store?: string }}
 */
export function storeList({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, stores: [] };

  const stores = config.stores.map(s => {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);
    const repoCount = registry.repositories.length;

    // Two-level scan: {storePath}/{repoName}/{slug}/
    let projectCount = 0;
    try {
      for (const repoEntry of fs.readdirSync(absPath, { withFileTypes: true })) {
        if (!repoEntry.isDirectory() || repoEntry.name.startsWith('.')) continue;
        const repoDir = join(absPath, repoEntry.name);
        for (const slugEntry of fs.readdirSync(repoDir, { withFileTypes: true })) {
          if (slugEntry.isDirectory()) projectCount++;
        }
      }
    } catch { /* store path may not exist yet — skip silently */ }

    return {
      id:            s.id,
      label:         s.label ?? s.id,
      path:          absPath,
      is_default:    s.id === config.default_store,
      repo_count:    repoCount,
      project_count: projectCount,
    };
  });

  return { ok: true, stores, default_store: config.default_store };
}

// ─── store default ────────────────────────────────────────────────────────────

/**
 * Sets the `default_store` field in `stores.json`.
 *
 * @param {{ id: string, configPath?: string }} opts
 * @returns {{ ok: boolean, default_store?: string, reason?: string }}
 */
export function storeSetDefault({ id, configPath } = {}) {
  if (!id) return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  if (!config.stores.some(s => s.id === id)) {
    return { ok: false, reason: `Store '${id}' not found in stores.json.` };
  }

  config.default_store = id;
  saveConfig(config, cp);
  return { ok: true, default_store: id };
}

// ─── store conflicts ──────────────────────────────────────────────────────────

/**
 * Returns a list of repositories registered in more than one store's
 * `.repositories.json`. Store-order priority (first store in `stores.json`
 * order) determines the winner — consistent with `MultiStoreManager.getRegistryConflicts()`.
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, conflicts: Array }}
 */
export function storeConflicts({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, conflicts: [] };

  /** @type {Map<string, { store_id: string, entry: object }>} */
  const seen      = new Map(); // folder_name → first-seen { store_id, entry }
  const conflicts = []; // Array<{ repo_name, entries[], winner_store_id }>

  for (const s of config.stores) {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);

    for (const entry of registry.repositories) {
      for (const folderName of (Array.isArray(entry.folder_names) ? entry.folder_names : [])) {
        if (seen.has(folderName)) {
          // Conflict detected — locate or create conflict record.
          const winner = seen.get(folderName);
          let conflict = conflicts.find(c => c.repo_name === folderName);
          if (!conflict) {
            conflict = {
              repo_name:       folderName,
              entries:         [{ store_id: winner.store_id, entry: winner.entry }],
              winner_store_id: winner.store_id,
            };
            conflicts.push(conflict);
          }
          conflict.entries.push({ store_id: s.id, entry });
        } else {
          seen.set(folderName, { store_id: s.id, entry });
        }
      }
    }
  }

  return { ok: true, conflicts };
}

// ─── store status ─────────────────────────────────────────────────────────────

/**
 * For each registered store that is also a Git repository, shows the
 * ahead/behind count relative to `@{upstream}`. Stores that are not Git repos
 * are shown with status "not a git repo".
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, statuses: Array }}
 */
export function storeStatus({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, statuses: [] };

  const statuses = config.stores.map(s => {
    const absPath = expandPath(s.path);

    // Check if the path is a Git repo.
    const revParse = spawnSync('git', ['-C', absPath, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      shell:    false,
    });
    if (revParse.status !== 0) {
      return { id: s.id, path: absPath, is_git: false };
    }

    // Get ahead/behind counts.
    const revList = spawnSync(
      'git',
      ['-C', absPath, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      { encoding: 'utf8', shell: false }
    );

    if (revList.status !== 0) {
      return { id: s.id, path: absPath, is_git: true, status: 'no upstream' };
    }

    const [ahead = '0', behind = '0'] = revList.stdout.trim().split(/\s+/);
    return {
      id:     s.id,
      path:   absPath,
      is_git: true,
      ahead:  parseInt(ahead, 10),
      behind: parseInt(behind, 10),
    };
  });

  return { ok: true, statuses };
}

// ─── store repo add ───────────────────────────────────────────────────────────

/**
 * Adds a repository entry to the specified store's `.repositories.json`.
 * Creates a minimal entry compatible with `RepositoryEntrySchema`.
 *
 * @param {{ repoName: string, storeId: string, label?: string, configPath?: string }} opts
 * @returns {{ ok: boolean, repoName?: string, storeId?: string, reason?: string }}
 */
export function storeRepoAdd({ repoName, storeId, label, configPath } = {}) {
  if (!repoName) return { ok: false, reason: 'Repository name is required.' };
  if (!storeId)  return { ok: false, reason: 'Store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found. Run `store init` first.' };

  const storeEntry = config.stores.find(s => s.id === storeId);
  if (!storeEntry) return { ok: false, reason: `Store '${storeId}' not found in stores.json.` };

  const absPath  = expandPath(storeEntry.path);
  const registry = loadRegistry(absPath);

  // Check for duplicate folder_name.
  const duplicate = registry.repositories.find(r =>
    Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
  );
  if (duplicate) {
    return { ok: false, reason: `Repository '${repoName}' is already registered in store '${storeId}'.` };
  }

  const now = new Date().toISOString();
  const entry = {
    id:           crypto.randomUUID(),
    label:        label ?? repoName,
    folder_names: [repoName],
    vision:       { short_term: null, mid_term: null, long_term: null },
    created_at:   now,
    last_modified: now,
  };

  registry.repositories.push(entry);
  saveRegistry(absPath, registry);

  return { ok: true, repoName, storeId, entry };
}

// ─── store repo move ──────────────────────────────────────────────────────────

/**
 * Moves a repository entry from its current store's `.repositories.json` to
 * the target store's registry. Uses `folder_names` to locate the source entry.
 *
 * @param {{ repoName: string, targetStoreId: string, configPath?: string }} opts
 * @returns {{ ok: boolean, repoName?: string, fromStoreId?: string, toStoreId?: string, reason?: string }}
 */
export function storeRepoMove({ repoName, targetStoreId, configPath } = {}) {
  if (!repoName)      return { ok: false, reason: 'Repository name is required.' };
  if (!targetStoreId) return { ok: false, reason: 'Target store ID is required.' };

  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: false, reason: 'No stores.json found.' };

  if (!config.stores.some(s => s.id === targetStoreId)) {
    return { ok: false, reason: `Target store '${targetStoreId}' not found in stores.json.` };
  }

  // Pre-load the target registry and check for duplicates BEFORE modifying
  // the source. This prevents a partial-mutation failure where the repo is
  // removed from source but we return ok:false because the target has a copy.
  const targetEntry = config.stores.find(s => s.id === targetStoreId);
  const targetPath  = expandPath(targetEntry.path);
  const targetReg   = loadRegistry(targetPath);

  if (targetReg.repositories.some(r =>
    Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
  )) {
    return { ok: false, reason: `Repository '${repoName}' is already registered in target store '${targetStoreId}'.` };
  }

  // Find the source store and entry. The target store is excluded from the
  // search so that an intra-target lookup never mutates source state.
  let fromStoreId = null;
  let entryToMove = null;

  for (const s of config.stores) {
    if (s.id === targetStoreId) continue;
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);
    const idx = registry.repositories.findIndex(r =>
      Array.isArray(r.folder_names) && r.folder_names.includes(repoName)
    );
    if (idx !== -1) {
      fromStoreId = s.id;
      entryToMove = registry.repositories[idx];
      // Remove from source only now that we know the target is clear.
      registry.repositories.splice(idx, 1);
      saveRegistry(absPath, registry);
      break;
    }
  }

  if (!fromStoreId || !entryToMove) {
    return { ok: false, reason: `Repository '${repoName}' not found in any store (except possibly '${targetStoreId}').` };
  }

  // Add to target.
  const now = new Date().toISOString();
  entryToMove.last_modified = now;
  targetReg.repositories.push(entryToMove);
  saveRegistry(targetPath, targetReg);

  return { ok: true, repoName, fromStoreId, toStoreId: targetStoreId };
}

// ─── store repo list ──────────────────────────────────────────────────────────

/**
 * Returns a merged view of all repositories from all stores, with store-order
 * priority (first store that claims a folder_name wins).
 *
 * @param {{ configPath?: string }} [opts]
 * @returns {{ ok: boolean, repos: Array }}
 */
export function storeRepoList({ configPath } = {}) {
  const cp = configPath ?? resolveConfigPath();
  const config = loadConfig(cp);
  if (!config) return { ok: true, repos: [] };

  const seen = new Set(); // folder_names already claimed
  const repos = [];

  for (const s of config.stores) {
    const absPath  = expandPath(s.path);
    const registry = loadRegistry(absPath);

    for (const entry of registry.repositories) {
      const folderNames = Array.isArray(entry.folder_names) ? entry.folder_names : [];
      // Determine if this entry is shadowed (any folder_name already claimed).
      const isShadowed = folderNames.some(fn => seen.has(fn));

      repos.push({
        store_id:   s.id,
        store_label: s.label ?? s.id,
        is_shadowed: isShadowed,
        ...entry,
      });

      // Mark folder_names as claimed only if this is the winner.
      if (!isShadowed) {
        for (const fn of folderNames) seen.add(fn);
      }
    }
  }

  return { ok: true, repos };
}
