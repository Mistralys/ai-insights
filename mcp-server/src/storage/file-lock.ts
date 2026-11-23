import lockfile from 'proper-lockfile';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/** Shape of the options `withLock` passes to `proper-lockfile`. */
interface LockOptions {
  stale: number;
  retries: {
    retries: number;
    minTimeout: number;
    maxTimeout: number;
  };
}

/**
 * Lock configuration for the ledger directory.
 * - 10 second stale timeout: locks older than this are considered stale
 * - 50 retries with 200ms–1000ms backoff: retry window of 10–50s,
 *   ensuring the window always covers the stale timeout duration
 *
 * Frozen (including the nested `retries` object) so production code can
 * never accidentally mutate it — {@link __setLockRetryForTesting} always
 * derives a fresh `activeLockOptions` object instead of touching this one.
 */
export const DEFAULT_LOCK_OPTIONS: LockOptions = Object.freeze({
  stale: 10000, // 10 seconds
  retries: Object.freeze({
    retries: 50,
    minTimeout: 200,
    maxTimeout: 1000,
  }),
});

/**
 * The lock options `withLock` currently applies. Starts out equal to
 * {@link DEFAULT_LOCK_OPTIONS} and is only ever replaced wholesale — via
 * {@link __setLockRetryForTesting} or {@link __resetLockOptionsForTesting} —
 * never mutated in place, so a reference anyone captured earlier (there are
 * none in production code) can't be rewritten out from under them.
 */
let activeLockOptions: LockOptions = DEFAULT_LOCK_OPTIONS;

/**
 * Test-only seam: installs a faster retry policy for `withLock`.
 *
 * Production code never calls this and never reads an environment variable
 * to weaken locking — the seam only exists so a test process (or, via the
 * `--fast-lock` CLI flag on the concurrent-allocation worker, a spawned
 * worker process) can opt itself into a shorter backoff. `retries` is
 * derived so the overall retry window still covers the stale timeout,
 * matching the invariant `DEFAULT_LOCK_OPTIONS` documents above.
 *
 * @internal Test-only. Not part of the public API.
 * @param options.minTimeout - Minimum backoff between retries, in ms. Must be `>= 1`.
 * @param options.maxTimeout - Maximum backoff between retries, in ms. Must be `>= minTimeout`.
 * @throws Error if `minTimeout < 1` or `maxTimeout < minTimeout`.
 */
export function __setLockRetryForTesting(options: { minTimeout: number; maxTimeout: number }): void {
  const { minTimeout, maxTimeout } = options;
  if (minTimeout < 1) {
    throw new Error(`__setLockRetryForTesting: minTimeout must be >= 1 (got ${minTimeout}).`);
  }
  if (maxTimeout < minTimeout) {
    throw new Error(
      `__setLockRetryForTesting: maxTimeout (${maxTimeout}) must be >= minTimeout (${minTimeout}).`
    );
  }

  const retries = Math.ceil(DEFAULT_LOCK_OPTIONS.stale / minTimeout);
  activeLockOptions = {
    stale: DEFAULT_LOCK_OPTIONS.stale,
    retries: { retries, minTimeout, maxTimeout },
  };
}

/**
 * Test-only seam: restores `withLock`'s retry policy to {@link DEFAULT_LOCK_OPTIONS}.
 *
 * @internal Test-only. Not part of the public API.
 */
export function __resetLockOptionsForTesting(): void {
  activeLockOptions = DEFAULT_LOCK_OPTIONS;
}

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
      ...activeLockOptions,
      lockfilePath: lockFilePath,
    });

    // Execute the callback while holding the lock
    return await fn();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(
        `Failed to acquire lock on ${storageDir} after ${activeLockOptions.retries.retries} retries. ` +
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
