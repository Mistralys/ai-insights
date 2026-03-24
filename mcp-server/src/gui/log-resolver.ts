/**
 * Orchestrator Run Log Resolver
 *
 * Backend utility for locating and reading orchestrator run log files.
 * Log files are JSONL format (one JSON object per line) and follow the naming
 * convention: `<timestamp>-{slug}.jsonl`.
 *
 * Security: all file access is strictly confined to `logsDir` via:
 *   1. A filename allowlist regexp (no `..`, no `/`, alphanumerics + `-_.` only)
 *   2. A resolved-path escape check (path.resolve must stay within logsDir)
 *
 * STDIO discipline: this module only writes to stderr, never stdout.
 *
 * ## Known Limitations
 *
 * - `resolveOrchestratorLogsDir` and `findRunLogs` do **not** validate that the
 *   supplied path is absolute. If a relative path flows in from `gui-config.json`,
 *   `readdir()` will resolve it against the process CWD, which could list files
 *   outside the intended directory. `readLogEntries` is immune (its escape-check
 *   uses `path.resolve()`), but `findRunLogs` is not. A `path.isAbsolute()` guard
 *   should be added before this module is wired into any HTTP-facing API layer.
 *
 * ## ApiError
 *
 * This module imports `ApiError` from the shared `src/gui/errors.ts` module.
 * The shared module exists to avoid the circular-dependency that would arise
 * from importing `gui/api.ts` here (since `gui/api.ts` imports this file).
 */

import { readdir, readFile, appendFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ApiError } from './errors.js';
export { ApiError };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default orchestrator logs directory when none is configured.
 * Using `~/.ai-insights/orchestrator-logs` as the sensible default.
 */
const DEFAULT_LOGS_DIR = join(homedir(), '.ai-insights', 'orchestrator-logs');

/**
 * Allowlist for log filenames.
 * Permits alphanumerics, hyphens, underscores, and dots only.
 * Explicitly rejects `..`, `/`, backslash, and any other special characters.
 */
const SAFE_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single entry in the run log list for a project.
 * `is_active` is `true` when the run has not yet emitted a terminal action
 * (`run_end` or `run_error`), indicating the orchestrator may still be running.
 */
export interface RunLogEntry {
  filename: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the orchestrator logs directory to use.
 *
 * - If `configured` is a non-empty string, returns it unchanged.
 * - Otherwise returns the default path: `~/.ai-insights/orchestrator-logs`.
 */
export function resolveOrchestratorLogsDir(configured: string | undefined): string {
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  return DEFAULT_LOGS_DIR;
}

/**
 * Lists `.jsonl` files in `logsDir` whose names end with `-{slug}.jsonl`.
 *
 * Returns `RunLogEntry` objects — one per matching file. Each entry includes
 * the bare `filename` and an `is_active` flag that is `true` when the log has
 * no terminal action (`run_end` / `run_error`) as its last line, meaning the
 * orchestrator run may still be in progress.
 *
 * Self-healing: runs that appear active but are not the newest file (sorted
 * by filename prefix) are considered stale. A synthetic `run_error` entry is
 * appended to each stale file so they are permanently closed on disk.
 *
 * Files that do not match the slug suffix are silently excluded. If `logsDir`
 * does not exist or cannot be read, returns an empty array.
 *
 * @param logsDir - Absolute path to the directory containing log files.
 * @param slug    - The project slug to filter by (e.g. `my-project`).
 */
export async function findRunLogs(logsDir: string, slug: string): Promise<RunLogEntry[]> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(logsDir);
  } catch {
    // Directory doesn't exist or is unreadable — treat as empty
    return [];
  }

  const suffix = `-${slug}.jsonl`;
  const matching = dirEntries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length
  );

  // Build entries with active status, then sort newest-first by filename prefix.
  const unsorted = await Promise.all(
    matching.map(async (filename) => ({
      filename,
      is_active: await isRunActive(join(logsDir, filename)),
    }))
  );
  unsorted.sort((a, b) => b.filename.localeCompare(a.filename));

  // Self-heal: every run except the newest one that still looks active is stale
  // (it was interrupted / killed without writing run_end). Append a synthetic
  // closing entry so the file is permanently marked as terminated on disk.
  await Promise.all(
    unsorted.slice(1).map(async (entry, i) => {
      if (!entry.is_active) return;
      await healStaleRun(join(logsDir, entry.filename));
      unsorted[i + 1]!.is_active = false;
    })
  );

  return unsorted;
}

/**
 * Moves orphaned run log files from a legacy directory into the canonical
 * orchestrator logs subfolder inside the project's ledger storage directory.
 *
 * This is a self-healing migration covering two scenarios:
 *   1. Logs written to the old flat `{ledgerRoot}/{slug}/` location (before the
 *      `orchestrator/logs/` subdirectory was introduced in the GUI).
 *   2. Logs still in `orchestrator/logs/` that were never copied by the
 *      post-run archival step (e.g. interrupted runs on an older build).
 *
 * After this function runs, all logs for the slug will reside in `destDir`
 * (`{ledgerRoot}/{slug}/orchestrator/logs/`).
 *
 * No-op conditions (returns 0 without touching the filesystem):
 *   - `destDir` already contains at least one `*-{slug}.jsonl` file.
 *   - `srcDir` does not exist or contains no matching files.
 *
 * Migration is best-effort: individual rename failures are swallowed so a
 * single unreadable file never blocks the others.
 *
 * @param destDir - Target directory (`{ledgerRoot}/{slug}/orchestrator/logs/`).
 * @param srcDir  - Source directory to scan for orphaned files. Callers invoke
 *                  this function twice in sequence: first with the old flat slug
 *                  directory (`{ledgerRoot}/{slug}/`), then with the raw
 *                  orchestrator logs directory (`orchestrator/logs/`).
 * @param slug    - Project slug used to match filenames (`*-{slug}.jsonl`).
 * @returns Number of files successfully moved.
 */
export async function migrateOrphanedLogs(
  destDir: string,
  srcDir: string,
  slug: string,
): Promise<number> {
  const suffix = `-${slug}.jsonl`;

  // Skip migration if destDir already has logs for this slug.
  try {
    const existing = await readdir(destDir);
    if (existing.some((name) => name.endsWith(suffix))) {
      return 0;
    }
  } catch {
    // destDir doesn't exist yet — migration may still populate it below.
  }

  // Scan srcDir for matching files.
  let srcEntries: string[];
  try {
    srcEntries = await readdir(srcDir);
  } catch {
    return 0; // srcDir absent or unreadable — nothing to migrate.
  }

  const matching = srcEntries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length,
  );
  if (matching.length === 0) return 0;

  await mkdir(destDir, { recursive: true });

  let migrated = 0;
  for (const filename of matching) {
    try {
      await rename(join(srcDir, filename), join(destDir, filename));
      migrated++;
    } catch {
      // Best-effort — skip files that cannot be moved (permissions, EXDEV, etc.)
    }
  }
  return migrated;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a log file does not end with a terminal action.
 *
 * A run is considered active if the last non-empty JSONL line does **not**
 * have `action: "run_end"` or `action: "run_error"`. Empty files (where the
 * run has just started writing) are also considered active.
 *
 * Failures to read or parse the file are treated as inactive (`false`) so
 * that stale / unreadable files are never shown with a "Running" badge.
 */
async function isRunActive(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return true; // File just created — run has started
    const lastLine = lines[lines.length - 1]!;
    const entry = JSON.parse(lastLine);
    if (entry && typeof entry === 'object' && 'action' in entry) {
      return entry.action !== 'run_end' && entry.action !== 'run_error';
    }
    return true; // No action field — cannot confirm completion
  } catch {
    return false; // Unreadable or unparsable — treat as inactive
  }
}

/**
 * Appends a synthetic `run_error` entry to a stale log file, permanently
 * closing it on disk so it is never shown as "Running" again.
 *
 * Failures are swallowed — a best-effort heal must never bubble up to callers.
 */
async function healStaleRun(filePath: string): Promise<void> {
  try {
    const entry = JSON.stringify({
      action: 'run_error',
      error: 'Run terminated without completing (healed by GUI on next page load)',
      ts: new Date().toISOString(),
    });
    await appendFile(filePath, '\n' + entry + '\n', 'utf-8');
  } catch {
    // Best-effort — ignore all errors (permissions, missing file, etc.)
  }
}

/**
 * Reads and parses a JSONL log file, supporting incremental reads.
 *
 * Security guards (throws `ApiError FORBIDDEN`):
 *   - `filename` must match the allowlist: `[A-Za-z0-9._-]+`
 *   - `filename` must not contain `..` or `/`
 *   - The resolved path must remain within `logsDir`
 *
 * Malformed JSON lines are silently skipped.
 *
 * @param logsDir   - Absolute path to the directory containing log files.
 * @param filename  - Bare filename (no directory component) to read.
 * @param afterLine - Zero-based index: skip this many lines from the start.
 *                    Pass 0 or omit to read from the beginning.
 * @returns `{ entries, totalLines }` where `totalLines` is the count of all
 *          non-empty lines in the file (before the `afterLine` offset is
 *          applied) and `entries` contains parsed JSON objects from line
 *          `afterLine + 1` onward.
 */
export async function readLogEntries(
  logsDir: string,
  filename: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }> {
  // ── Security: filename allowlist ──────────────────────────────────────────
  if (
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    !SAFE_FILENAME_REGEX.test(filename)
  ) {
    throw new ApiError(
      'FORBIDDEN',
      `Filename contains disallowed characters or path components: '${filename}'`
    );
  }

  // ── Security: resolved-path escape check ─────────────────────────────────
  const resolvedLogsDir = resolve(logsDir);
  const resolvedFilePath = resolve(join(logsDir, filename));

  if (!resolvedFilePath.startsWith(resolvedLogsDir + '/') &&
      resolvedFilePath !== resolvedLogsDir) {
    throw new ApiError(
      'FORBIDDEN',
      `Resolved path escapes the logs directory: '${filename}'`
    );
  }

  // ── Read file ─────────────────────────────────────────────────────────────
  let raw: string;
  try {
    raw = await readFile(resolvedFilePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new ApiError('NOT_FOUND', `Log file not found: '${filename}'`);
    }
    throw err;
  }

  // ── Parse JSONL ───────────────────────────────────────────────────────────
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const totalLines = lines.length;

  const skip = afterLine != null && afterLine > 0 ? afterLine : 0;
  const relevantLines = lines.slice(skip);

  const entries: unknown[] = [];
  for (const line of relevantLines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Malformed JSON — skip silently
    }
  }

  return { entries, totalLines };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
