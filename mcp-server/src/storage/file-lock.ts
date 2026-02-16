import lockfile from 'proper-lockfile';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Lock configuration for the ledger directory.
 * - 10 second stale timeout: locks older than this are considered stale
 * - 5 retries: attempt to acquire lock up to 5 times
 * - 200ms retry interval: wait 200ms between retry attempts
 */
const LOCK_OPTIONS = {
  stale: 10000, // 10 seconds
  retries: {
    retries: 5,
    minTimeout: 200,
    maxTimeout: 1000,
  },
};

/**
 * Acquires a file lock on the project's ledger directory, executes the callback,
 * and releases the lock in a finally block.
 *
 * The lock file is created at {projectPath}/.ledger.lock
 *
 * @param projectPath - Absolute path to the project directory
 * @param fn - Async callback to execute while holding the lock
 * @returns The return value of the callback
 * @throws Error if lock cannot be acquired after retries
 */
export async function withLock<T>(
  projectPath: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockFilePath = join(projectPath, '.ledger.lock');

  // Ensure the project directory exists
  await mkdir(projectPath, { recursive: true });

  // Acquire the lock
  let release: (() => Promise<void>) | null = null;

  try {
    // proper-lockfile expects a file path, but we want to lock a directory
    // We create a .ledger.lock file for this purpose
    // Note: proper-lockfile creates a lockfile, so we don't need to pre-create it
    release = await lockfile.lock(projectPath, {
      ...LOCK_OPTIONS,
      lockfilePath: lockFilePath,
    });

    // Execute the callback while holding the lock
    return await fn();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(
        `Failed to acquire lock on ${projectPath} after ${LOCK_OPTIONS.retries.retries} retries. ` +
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
          `[file-lock] Warning: Failed to release lock on ${projectPath}:`,
          error
        );
      }
    }
  }
}
