import { readdir, readFile, rename, writeFile, unlink, mkdir, copyFile, rm, access } from 'fs/promises';
import { join } from 'path';
import { atomicWriteJson } from './atomic-writer.js';

const SENTINEL_FILE = '.migration-in-progress';
const STATE_FILE = '.migration-state.json';
const STORAGE_VERSION = 2;

export interface MigrationResult {
  skipped: boolean;
  moved: string[];
  errors: Array<{ slug: string; error: string }>;
}

interface RawMeta {
  repository_name?: string | null;
  [key: string]: unknown;
}

interface MigrationState {
  storage_version: number;
}

/**
 * Migrates the centralized ledger from the flat layout ({ledgerRoot}/{slug}/)
 * to the repo-namespaced layout ({ledgerRoot}/{repoName}/{slug}/).
 *
 * The migration is idempotent: it is safe to call on every startup.
 * - If {ledgerRoot}/.migration-state.json has storage_version >= 2, it returns immediately.
 * - A sentinel file is written before any directory moves to enable crash recovery.
 * - If an individual directory move fails, the original directory is left untouched
 *   and the storage_version flag is NOT written.
 * - Cross-device renames (EXDEV) fall back to recursive copy-then-delete.
 *
 * Constraint: withLock is never called with ledgerRoot. Race safety is provided
 * by the sentinel file pattern and the server startup sequencing (migration is
 * invoked before any tool-call handlers are reachable).
 */
export async function migrateToNamespacedLayout(ledgerRoot: string): Promise<MigrationResult> {
  const statePath = join(ledgerRoot, STATE_FILE);
  const sentinelPath = join(ledgerRoot, SENTINEL_FILE);

  // Idempotency check: skip if already migrated.
  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content) as MigrationState;
    if (typeof state.storage_version === 'number' && state.storage_version >= STORAGE_VERSION) {
      return { skipped: true, moved: [], errors: [] };
    }
  } catch {
    // File does not exist or is invalid — proceed.
  }

  // Write sentinel before any moves. If we find it on the next startup, we
  // resume (the scan below is idempotent: already-moved entries are skipped).
  await writeFile(sentinelPath, `${new Date().toISOString()}\n`, 'utf-8');

  let dirents: import('fs').Dirent[];
  try {
    dirents = await readdir(ledgerRoot, { withFileTypes: true });
  } catch {
    await removeSilent(sentinelPath);
    return { skipped: false, moved: [], errors: [] };
  }

  const moved: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const dirent of dirents) {
    const entry = dirent.name;

    if (!dirent.isDirectory()) continue;
    if (entry.startsWith('.')) continue;

    // Only depth-1 directories that have a direct .meta.json are old-layout projects.
    // Directories without .meta.json are already repo-namespace dirs (or unrelated) — skip.
    const metaPath = join(ledgerRoot, entry, '.meta.json');
    let repoName: string;
    try {
      const content = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(content) as RawMeta;
      const rn = meta.repository_name;
      repoName = typeof rn === 'string' && rn.length > 0 ? rn : 'unknown';
    } catch {
      continue; // No .meta.json at depth-1 — treat as namespace dir, skip.
    }

    const oldDir = join(ledgerRoot, entry);
    const namespaceDir = join(ledgerRoot, repoName);
    const newDir = join(namespaceDir, entry);

    // If the target already exists, we need to determine whether the migration
    // actually completed for this project or not.
    if (await dirExists(newDir)) {
      if (!(await dirExists(oldDir))) {
        // Source is gone — project was successfully migrated in a prior run. Skip.
        continue;
      }
      // Source still exists — the target is a leftover stub from a previously
      // interrupted move (e.g., mkdir in copyDirRecursive ran but copy failed).
      // Recover by removing the empty stub and retrying, or report a conflict
      // if the stub already contains data.
      const stubEntries = await readdir(newDir).catch(() => [] as string[]);
      if (stubEntries.length > 0) {
        errors.push({
          slug: entry,
          error: `Target '${newDir}' already exists with content and source '${oldDir}' also exists. Manual resolution required.`,
        });
        continue;
      }
      // Stub is empty — safe to remove and retry.
      try {
        await rm(newDir, { recursive: true });
      } catch (rmErr) {
        errors.push({ slug: entry, error: `Failed to remove empty stub at '${newDir}': ${(rmErr as Error).message}` });
        continue;
      }
    }

    try {
      await mkdir(namespaceDir, { recursive: true });
      await moveDirCrossDevice(oldDir, newDir);
      moved.push(`${repoName}/${entry}`);
    } catch (err) {
      errors.push({ slug: entry, error: (err as Error).message });
    }
  }

  // Remove sentinel (cleanup on success or partial failure).
  await removeSilent(sentinelPath);

  if (errors.length === 0) {
    // All moves succeeded — write migration state to prevent re-running.
    await atomicWriteJson(statePath, { storage_version: STORAGE_VERSION });
  } else {
    // One or more moves failed — do NOT write storage_version so the migration
    // is retried on the next startup (already-moved entries are skipped).
    process.stderr.write(
      `[migrate-namespaced] Migration incomplete: ${errors.length} project(s) failed to move.\n`
    );
    for (const { slug, error } of errors) {
      process.stderr.write(`[migrate-namespaced]   - ${slug}: ${error}\n`);
    }
  }

  return { skipped: false, moved, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Moves `src` to `dest`, falling back to recursive copy-then-delete for
 * cross-device renames (EXDEV).
 */
async function moveDirCrossDevice(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'EXDEV') throw err;

    // Cross-device: copy, verify, then delete source.
    await copyDirRecursive(src, dest);
    await verifyDirCopied(src, dest);
    await rm(src, { recursive: true });
  }
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Verifies that all top-level entries present in `src` now exist in `dest`.
 * Throws if any entry is missing — the source will be left intact for safety.
 *
 * Shallow verification is sufficient here because `copyDirRecursive` propagates
 * every underlying `copyFile` / `mkdir` error via `await` — if it returns without
 * throwing, all files at every depth have been written. This check is a final
 * belt-and-suspenders guard against unexpected top-level absence only.
 */
async function verifyDirCopied(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const destPath = join(dest, entry.name);
    try {
      await access(destPath);
    } catch {
      throw new Error(
        `Cross-device copy verification failed: "${entry.name}" missing in destination "${dest}"`
      );
    }
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await readdir(dirPath);
    return true;
  } catch {
    return false;
  }
}

async function removeSilent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignore — file may not exist.
  }
}
