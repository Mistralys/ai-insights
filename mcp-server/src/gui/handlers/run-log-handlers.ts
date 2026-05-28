/**
 * Run Log API Handlers
 *
 * Pure async handler functions for the orchestrator run log endpoints. Both
 * handlers accept `slug` (project identifier) and `repoName` (repository
 * namespace) as their first two parameters. `repoName` is validated before
 * `slug` (namespace-first fast-fail) via `assertSafeSlug()`, which rejects any
 * segment that does not satisfy the safe-slug rules before any filesystem access
 * is attempted.
 *
 * Intended route shape (server integration finalised in WP-007):
 *
 *   GET /api/projects/:repo/:slug/runs         → handleListRunLogs
 *   GET /api/projects/:repo/:slug/runs/:file   → handleGetRunLog
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
import { assertSafeSegment } from '../../utils/path-validator.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Guards a single path segment against path-traversal attacks and invalid characters.
 *
 * Throws `ApiError NOT_FOUND` for any segment that is empty or does not satisfy
 * the safe-slug rules (lowercase alphanumeric + hyphens, must start with an
 * alphanumeric character). This rejects `/`, `..`, uppercase letters, and any
 * other non-conforming input before any filesystem operations are attempted.
 *
 * Used to validate both `slug` and `repoName` parameters independently — never
 * called with a composite `{repo}/{slug}` string.
 *
 * **Layer note:** A parallel `assertSafeSlug` exists in `src/utils/ledger-root.ts`
 * (storage layer). Both delegate to {@link assertSafeSegment} from `path-validator.ts`
 * but throw different error types: this function throws `ApiError` (GUI layer); the
 * storage layer version throws plain `Error`. The separation is intentional — the GUI
 * layer must not import storage-layer error types.
 *
 * @param segment - The raw segment string (slug or repoName) extracted from the request URL.
 */
function assertSafeSlug(segment: string): void {
  if (!assertSafeSegment(segment)) {
    throw new ApiError('NOT_FOUND', `Invalid path segment: '${segment}'.`);
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
 * Security: both `repoName` and `slug` are validated via `assertSafeSlug()` —
 * segments containing `/`, `..`, uppercase letters, or other non-conforming characters
 * throw `ApiError NOT_FOUND` before any filesystem access occurs.
 * Each segment is validated independently; no composite `{repo}/{slug}` string is
 * ever passed to the guard.
 *
 * @param slug               - Project slug (URL segment, already URL-decoded).
 * @param repoName           - Repository namespace (URL segment, already URL-decoded).
 *                             Must be a valid safe slug (lowercase alphanumeric + hyphens).
 * @param logsDir            - Absolute path to the ledger's log storage directory
 *                             (`{ledgerRoot}/{repoName}/{slug}/orchestrator/logs/`).
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
  repoName: string,
  logsDir: string,
  orchestratorLogsDir: string,
  legacyLogsDir?: string,
  legacyLogsDir2?: string,
): Promise<RunLogEntry[]> {
  assertSafeSlug(repoName);
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
 * Security: both `repoName` and `slug` are validated via `assertSafeSlug()` and
 * `filename` is validated inside `readLogEntries()` (allowlist + resolved-path
 * escape check). These guards apply regardless of which source directory is
 * ultimately used. Malicious filenames throw `ApiError FORBIDDEN`; missing files
 * throw `ApiError NOT_FOUND`.
 *
 * @param slug               - Project slug (validated but not used in file resolution —
 *                             the filename carries all path information).
 * @param repoName           - Repository namespace (URL segment, already URL-decoded).
 *                             Must be a valid safe slug (lowercase alphanumeric + hyphens).
 * @param filename           - Bare filename (no directory component) to read.
 * @param logsDir            - Absolute path to the ledger's log storage directory.
 * @param orchestratorLogsDir - Absolute path to the orchestrator's live logs directory.
 * @param afterLine          - Optional zero-based line offset for incremental polling.
 * @returns `{ entries, totalLines }` as returned by `readLogEntries`.
 */
export async function handleGetRunLog(
  slug: string,
  repoName: string,
  filename: string,
  logsDir: string,
  orchestratorLogsDir: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  assertSafeSlug(repoName);
  assertSafeSlug(slug);
  const resolvedDir = await resolveLogSource(logsDir, orchestratorLogsDir, filename);
  return readLogEntries(resolvedDir, filename, afterLine);
}
