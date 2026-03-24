/**
 * Run Log API Handlers
 *
 * Pure async handler functions for the orchestrator run log endpoints:
 *
 *   GET /api/projects/:slug/runs         → handleListRunLogs
 *   GET /api/projects/:slug/runs/:file   → handleGetRunLog
 *
 * Both handlers re-use the security guards in `log-resolver.ts` and surface
 * `ApiError` codes as-is (the HTTP server maps them to status codes).
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 */

import {
  ApiError,
  findRunLogs,
  migrateOrphanedLogs,
  readLogEntries,
} from '../log-resolver.js';
import type { RunLogEntry } from '../log-resolver.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Guards against path-traversal attacks on the project slug URL parameter.
 *
 * Throws `ApiError NOT_FOUND` for any slug that is empty, contains a
 * forward-slash, or contains a `..` component.
 *
 * This mirrors the `assertSafeSlug()` guard used in `gui/api.ts` to keep
 * security behaviour consistent across the codebase.
 *
 * @param slug - The raw slug string extracted from the request URL.
 */
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    throw new ApiError('NOT_FOUND', `Invalid project slug: '${slug}'.`);
  }
}

// ---------------------------------------------------------------------------
// Handler: handleListRunLogs
// ---------------------------------------------------------------------------

/**
 * Returns the list of run log filenames for a given project slug.
 *
 * Security: `slug` is validated via `assertSafeSlug()` — slugs containing `/`
 * or `..` throw `ApiError NOT_FOUND` before any filesystem access occurs.
 *
 * @param slug          - Project slug (URL segment, already URL-decoded).
 * @param logsDir       - Absolute path to the directory containing log files
 *                        (the project's ledger storage folder).
 * @param legacyLogsDir - Optional fallback directory (e.g. `orchestrator/logs/`).
 *                        When supplied and `logsDir` contains no logs for the
 *                        slug, any matching files are moved from `legacyLogsDir`
 *                        into `logsDir` before the listing is returned.
 * @returns Array of matching JSONL filenames (may be empty).
 */
export async function handleListRunLogs(
  slug: string,
  logsDir: string,
  legacyLogsDir?: string,
): Promise<RunLogEntry[]> {
  assertSafeSlug(slug);
  if (legacyLogsDir) {
    await migrateOrphanedLogs(logsDir, legacyLogsDir, slug);
  }
  return findRunLogs(logsDir, slug);
}

// ---------------------------------------------------------------------------
// Handler: handleGetRunLog
// ---------------------------------------------------------------------------

/**
 * Reads and returns JSONL entries from a single run log file.
 *
 * Security: `slug` is validated via `assertSafeSlug()` and `filename` is
 * validated inside `readLogEntries()` (allowlist + resolved-path escape check).
 * Malicious filenames throw `ApiError FORBIDDEN`; missing files throw
 * `ApiError NOT_FOUND`.
 *
 * @param slug      - Project slug (validated but not used in file resolution —
 *                    the filename carries all path information).
 * @param filename  - Bare filename (no directory component) to read.
 * @param logsDir   - Absolute path to the directory containing log files.
 * @param afterLine - Optional zero-based line offset for incremental polling.
 * @returns `{ entries, totalLines }` as returned by `readLogEntries`.
 */
export async function handleGetRunLog(
  slug: string,
  filename: string,
  logsDir: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  assertSafeSlug(slug);
  return readLogEntries(logsDir, filename, afterLine);
}
