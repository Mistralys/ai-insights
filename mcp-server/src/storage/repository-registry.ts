import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  RepositoryRegistrySchema,
  type RepositoryEntry,
  type RepositoryRegistry,
} from '../schema/repository-registry.js';
import { atomicWriteJson } from './atomic-writer.js';
import { withLock } from './file-lock.js';

/**
 * File name for the per-store repository registry.
 * Stored directly under the store root — not inside any project sub-directory.
 * Each store owns its own `.repositories.json`, making stores self-contained
 * and portable across devices.
 */
const REGISTRY_FILENAME = '.repositories.json';

/**
 * Returns the absolute path of the registry file for a given store root.
 *
 * @param storePath - Absolute path to the store root directory
 */
function registryPath(storePath: string): string {
  return join(storePath, REGISTRY_FILENAME);
}

// ==================== Public API ====================

/**
 * Reads and parses the `.repositories.json` registry file from the given store root.
 *
 * Returns `{ repositories: [] }` when:
 *   - the file does not exist (first-run scenario)
 *   - the file exists but contains malformed JSON or fails schema validation
 *
 * Callers that need to distinguish between "absent" and "corrupt" should
 * handle errors from `atomicWriteJson` / `saveRegistry` separately.
 *
 * @param storePath - Absolute path to the store root directory
 */
export async function loadRegistry(
  storePath: string
): Promise<RepositoryRegistry> {
  const path = registryPath(storePath);

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content);
    return RepositoryRegistrySchema.parse(data);
  } catch {
    // Missing file, malformed JSON, or schema validation failure — return empty registry
    return { repositories: [] };
  }
}

/**
 * Writes the registry to `.repositories.json` atomically under a file lock.
 *
 * The lock is acquired on `storePath` so that concurrent writes to any
 * file within the same store root are serialized by the same lock.
 * The write itself uses `atomicWriteJson` (write-to-temp-then-rename) so
 * readers never observe a partial write.
 *
 * @param storePath - Absolute path to the store root directory
 * @param registry  - Registry data to persist (validated against schema before write)
 * @throws Error if schema validation fails or if the atomic write fails
 */
export async function saveRegistry(
  storePath: string,
  registry: RepositoryRegistry
): Promise<void> {
  const validated = RepositoryRegistrySchema.parse(registry);
  validated.repositories.sort((a, b) => a.id.localeCompare(b.id));
  const path = registryPath(storePath);

  await withLock(storePath, async () => {
    await atomicWriteJson(path, validated);
  });
}

/**
 * Finds the first registry entry whose `folder_names` array contains the
 * given folder name (case-sensitive exact match).
 *
 * This is a pure, synchronous lookup that does not perform any I/O.
 * Call `loadRegistry()` to obtain a registry before passing it here.
 *
 * @param registry   - The in-memory registry to search
 * @param folderName - Workspace folder name to search for
 * @returns The matching `RepositoryEntry`, or `null` if no entry matches
 */
export function findByFolderName(
  registry: RepositoryRegistry,
  folderName: string
): RepositoryEntry | null {
  for (const entry of registry.repositories) {
    if (entry.folder_names.includes(folderName)) {
      return entry;
    }
  }
  return null;
}

/**
 * Returns all folder name aliases registered for a repository entry.
 *
 * This is a convenience accessor that exposes the `folder_names` array
 * through a consistent function interface, matching the plain-function
 * style of this module.
 *
 * @param entry - A single repository entry from the registry
 * @returns A copy of the entry's `folder_names` array
 */
export function getAllFolderNames(entry: RepositoryEntry): string[] {
  return [...entry.folder_names];
}
