import { writeFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { renameWithRetry } from '../utils/fs-retry.js';

/**
 * Options for {@link atomicWriteJson}.
 */
export interface AtomicWriteJsonOptions {
  /**
   * POSIX file mode (e.g. `0o600`) applied to the temp file at creation
   * time, before it is renamed into place. Useful for files that hold
   * secrets (e.g. the error-code provider config), which should never be
   * world-readable.
   *
   * The mode is passed directly to the underlying `open()` call used by the
   * write, so the OS applies it atomically — the temp file never exists on
   * disk with the wider platform-default permissions, even momentarily.
   *
   * A documented no-op on Windows: the `mode` bits passed to `fs.writeFile`
   * only toggle the read-only attribute there, so this option has no
   * meaningful effect on non-POSIX platforms. Omit it to keep the platform
   * default permissions.
   */
  mode?: number;
}

/**
 * Writes JSON data to a file atomically using the write-to-temp-then-rename pattern.
 *
 * The process:
 * 1. Write data to {filePath}.tmp.{pid}.{uuid}, applying `options.mode` (when
 *    supplied) directly at file-creation time so the temp file is never
 *    briefly world-readable (POSIX only; a no-op on Windows — see
 *    {@link AtomicWriteJsonOptions.mode})
 * 2. Use fs.rename to atomically replace the target file (POSIX semantics;
 *    transient EPERM/EACCES/EBUSY errors are retried on Windows)
 * 3. Clean up temp file on error
 *
 * The `{uuid}` suffix (from `crypto.randomUUID`) makes the temp path unique
 * per call, not just per process: two concurrent unlocked writers to the
 * same target within one process (same `pid`) would otherwise share a temp
 * path and race each other's write-then-rename, corrupting or losing one
 * writer's payload. `withLock` callers are unaffected — they already
 * serialize access — but several call sites in this codebase write without
 * a lock, so the uniqueness has to live here.
 *
 * This ensures that readers never see partial writes.
 *
 * @param filePath - Absolute path to the target file
 * @param data - Data to serialize as JSON
 * @param options - Optional write behaviour, e.g. a restrictive POSIX `mode`
 * @throws Error if write or rename fails
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  options?: AtomicWriteJsonOptions
): Promise<void> {
  const pid = process.pid;
  const tempPath = `${filePath}.tmp.${pid}.${randomUUID()}`;

  try {
    // Ensure the parent directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Pretty-print JSON with 2-space indentation and trailing newline
    const json = JSON.stringify(data, null, 2) + '\n';

    // Write to temp file, applying the requested mode at creation time (via
    // the underlying open() flags) so the file is never briefly world-
    // readable between the write and a later chmod. A no-op on Windows.
    await writeFile(
      tempPath,
      json,
      options?.mode !== undefined
        ? { encoding: 'utf-8', mode: options.mode }
        : 'utf-8'
    );

    // Atomically rename temp file to target (POSIX atomic; retried on
    // transient Windows contention errors)
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors (temp file may not exist)
    }

    // Re-throw original error
    throw new Error(
      `Failed to write JSON to ${filePath}: ${(error as Error).message}`
    );
  }
}
