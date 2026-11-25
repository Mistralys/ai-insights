import { rename } from 'fs/promises';

/** Error codes Windows raises when a rename target is momentarily held by another operation. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Maximum rename attempts on Windows before the transient error is surfaced. */
export const RENAME_MAX_ATTEMPTS = 8;

/** Base backoff in milliseconds; grows linearly per attempt. */
const RENAME_BACKOFF_MS = 10;

/**
 * Renames `from` onto `to`, retrying transient Windows failures.
 *
 * POSIX `rename` atomically replaces the target even under contention. On
 * Windows, concurrent renames onto the same target (or an antivirus scanner,
 * indexer or open handle briefly holding the file or directory) can fail with
 * EPERM/EACCES/EBUSY. Those errors are retried with a short linear backoff;
 * on other platforms, or for any other error code, the first failure is
 * thrown immediately.
 *
 * Use this instead of a bare `fs.rename` wherever a rename may race another
 * writer or a file-system watcher. For recursive deletes, prefer the built-in
 * `fs.rm(path, { maxRetries, retryDelay })` options, which Node already
 * applies to the same transient error codes.
 *
 * @param from - Existing path to move
 * @param to - Destination path (replaced when it is a file)
 * @throws The last error once the attempt budget is exhausted, or immediately
 *         for non-transient errors and non-Windows platforms
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient =
        process.platform === 'win32' && code !== undefined && TRANSIENT_RENAME_CODES.has(code);
      if (!transient || attempt >= RENAME_MAX_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFF_MS * attempt));
    }
  }
}
