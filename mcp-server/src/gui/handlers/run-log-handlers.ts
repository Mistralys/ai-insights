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
  archiveCompletedLogs,
  findRunLogs,
  migrateOrphanedLogs,
  readLogEntries,
  resolveLogSource,
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
 * Returns the merged, deduplicated list of run log entries for a project slug.
 *
 * Workflow:
 *   1. Legacy migration: orphaned files from `legacyLogsDir` / `legacyLogsDir2`
 *      are copied into `logsDir` (one-time self-healing, idempotent).
 *   2. Archival: completed runs from `orchestratorLogsDir` that are not yet in
 *      `logsDir` are copied via `archiveCompletedLogs()`.
 *   3. Listing: both `logsDir` and `orchestratorLogsDir` are scanned with
 *      `findRunLogs()`. Results are merged and deduplicated by `filename`, with
 *      `logsDir` taking precedence for is_active status (it may have been
 *      self-healed on a previous request).
 *   4. Active runs from `orchestratorLogsDir` that are not yet in `logsDir`
 *      are included in the response so they appear in the UI immediately.
 *
 * Security: `slug` is validated via `assertSafeSlug()` — slugs containing `/`
 * or `..` throw `ApiError NOT_FOUND` before any filesystem access occurs.
 *
 * @param slug               - Project slug (URL segment, already URL-decoded).
 * @param logsDir            - Absolute path to the ledger's log storage directory
 *                             (`{ledgerRoot}/{slug}/orchestrator/logs/`).
 * @param orchestratorLogsDir - Absolute path to the orchestrator's live logs
 *                             directory. Completed runs are archived from here
 *                             into `logsDir`; active runs are merged into the
 *                             response even if not yet archived.
 * @param legacyLogsDir      - Optional first legacy migration source directory
 *                             (the old flat `{ledgerRoot}/{slug}/` location).
 * @param legacyLogsDir2     - Optional second legacy migration source directory
 *                             (e.g. a raw `orchestrator/logs/` path from an older
 *                             build whose post-run copy step was never executed).
 * @returns Merged array of `RunLogEntry` objects, deduplicated by filename.
 */
export async function handleListRunLogs(
  slug: string,
  logsDir: string,
  orchestratorLogsDir: string,
  legacyLogsDir?: string,
  legacyLogsDir2?: string,
): Promise<RunLogEntry[]> {
  assertSafeSlug(slug);

  // 1. Legacy migration (idempotent — no-op once logsDir has any slug files).
  if (legacyLogsDir) {
    await migrateOrphanedLogs(logsDir, legacyLogsDir, slug);
  }
  if (legacyLogsDir2) {
    await migrateOrphanedLogs(logsDir, legacyLogsDir2, slug);
  }

  // 2. Archive completed runs from the live orchestrator directory.
  await archiveCompletedLogs(logsDir, orchestratorLogsDir, slug);

  // 3. Scan both directories and merge results.
  const [archiveEntries, liveEntries] = await Promise.all([
    findRunLogs(logsDir, slug),
    findRunLogs(orchestratorLogsDir, slug),
  ]);

  // Build a map from filename → entry, starting with live entries so that
  // archived entries (which may have been self-healed) overwrite them.
  const byFilename = new Map<string, RunLogEntry>();
  for (const entry of liveEntries) {
    byFilename.set(entry.filename, entry);
  }
  for (const entry of archiveEntries) {
    // logsDir entries take precedence: they may have healed stale active flags.
    byFilename.set(entry.filename, entry);
  }

  // Return sorted newest-first (filenames are timestamp-prefixed).
  const merged = Array.from(byFilename.values());
  merged.sort((a, b) => b.filename.localeCompare(a.filename));
  return merged;
}

// ---------------------------------------------------------------------------
// Handler: handleGetRunLog
// ---------------------------------------------------------------------------

/**
 * Reads and returns JSONL entries from a single run log file.
 *
 * `resolveLogSource()` is called first to determine whether the canonical copy
 * resides in `logsDir` (ledger storage) or `orchestratorLogsDir` (live logs).
 * If the source is newer than the archive copy, `resolveLogSource()` refreshes
 * the archive before returning the directory to use.
 *
 * Security: `slug` is validated via `assertSafeSlug()` and `filename` is
 * validated inside `readLogEntries()` (allowlist + resolved-path escape check).
 * These guards apply regardless of which source directory is ultimately used.
 * Malicious filenames throw `ApiError FORBIDDEN`; missing files throw
 * `ApiError NOT_FOUND`.
 *
 * @param slug               - Project slug (validated but not used in file resolution —
 *                             the filename carries all path information).
 * @param filename           - Bare filename (no directory component) to read.
 * @param logsDir            - Absolute path to the ledger's log storage directory.
 * @param orchestratorLogsDir - Absolute path to the orchestrator's live logs directory.
 * @param afterLine          - Optional zero-based line offset for incremental polling.
 * @returns `{ entries, totalLines }` as returned by `readLogEntries`.
 */
export async function handleGetRunLog(
  slug: string,
  filename: string,
  logsDir: string,
  orchestratorLogsDir: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  assertSafeSlug(slug);
  const resolvedDir = await resolveLogSource(logsDir, orchestratorLogsDir, filename);
  return readLogEntries(resolvedDir, filename, afterLine);
}
