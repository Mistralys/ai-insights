import lockfile from 'proper-lockfile';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Lock configuration for the ledger directory.
 * - 10 second stale timeout: locks older than this are considered stale
 * - 50 retries with 200ms–1000ms backoff: retry window of 10–50s,
 *   ensuring the window always covers the stale timeout duration
 */
const LOCK_OPTIONS = {
  stale: 10000, // 10 seconds
  retries: {
    retries: 50,
    minTimeout: 200,
    maxTimeout: 1000,
  },
};

/**
 * Acquires a file lock on the project's centralized storage directory,
 * executes the callback, and releases the lock in a finally block.
 *
 * The lock file is created at {storageDir}/.lock
 *
 * @param storageDir - Absolute path to the project's storage directory
 * @param fn - Async callback to execute while holding the lock
 * @returns The return value of the callback
 * @throws Error if lock cannot be acquired after retries
 */
export async function withLock<T>(
  storageDir: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockFilePath = join(storageDir, '.lock');

  // Ensure the storage directory exists
  await mkdir(storageDir, { recursive: true });

  // Acquire the lock
  let release: (() => Promise<void>) | null = null;

  try {
    // proper-lockfile expects a file path, but we want to lock a directory.
    // We create a .lock file inside storageDir for this purpose.
    // Note: proper-lockfile creates a lockfile, so we don't need to pre-create it
    release = await lockfile.lock(storageDir, {
      ...LOCK_OPTIONS,
      lockfilePath: lockFilePath,
    });

    // Execute the callback while holding the lock
    return await fn();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(
        `Failed to acquire lock on ${storageDir} after ${LOCK_OPTIONS.retries.retries} retries. ` +
          `Another process may be holding the lock.`
      );
    }
    throw error;
  } finally {
    // Always release the lock, even if the callback throws
    if (release) {
      try {
        await release();
      } catch (error) {
        // Log but don't throw - we don't want to mask the original error
        console.error(
          `[file-lock] Warning: Failed to release lock on ${storageDir}:`,
          error
        );
      }
    }
  }
}
