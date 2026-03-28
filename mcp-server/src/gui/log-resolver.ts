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

import { readdir, readFile, appendFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { ApiError } from './errors.js';
export { ApiError };

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
 * `is_dry_run` is `true` when the first JSONL line is a `run_start` event
 * with `dry_run: true`, indicating this was a dry run.
 */
export interface RunLogEntry {
  filename: string;
  is_active: boolean;
  /**
   * `true` when the first JSONL line is a `run_start` event with `dry_run: true`.
   * Defaults to `false` on any file-read or parse error (fail-safe: unreadable
   * or malformed runs are never surfaced with a dry-run badge).
   */
  is_dry_run: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  // Backward-compat: the orchestrator used to truncate slugs to 40 chars in log
  // filenames (via _slugify(label, max_len=40)). Match the truncated form too so
  // that logs written by older builds (or slugs longer than 40 chars) are found.
  const truncSlug = slug.length > 40 ? slug.slice(0, 40).replace(/-+$/, '') : null;
  const truncSuffix = truncSlug ? `-${truncSlug}.jsonl` : null;

  const matching = dirEntries.filter((name) => {
    if (name.endsWith(suffix) && name.length > suffix.length) return true;
    if (truncSuffix && name.endsWith(truncSuffix) && name.length > truncSuffix.length) return true;
    return false;
  });

  // Build entries with active + dry-run status, then sort newest-first by filename prefix.
  // readLogStatus reads the file once and returns both flags — avoids reading each file twice.
  const unsorted = await Promise.all(
    matching.map(async (filename) => {
      const filePath = join(logsDir, filename);
      const { is_active, is_dry_run } = await readLogStatus(filePath);
      return { filename, is_active, is_dry_run };
    })
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
 * Copies orphaned run log files from a legacy directory into the canonical
 * orchestrator logs subfolder inside the project's ledger storage directory.
 *
 * This is a self-healing migration covering two scenarios:
 *   1. Logs written to the old flat `{ledgerRoot}/{slug}/` location (before the
 *      `orchestrator/logs/` subdirectory was introduced in the GUI).
 *   2. Logs still in `orchestrator/logs/` that were never copied by the
 *      post-run archival step (e.g. interrupted runs on an older build).
 *
 * After this function runs, all logs for the slug will reside in `destDir`
 * (`{ledgerRoot}/{slug}/orchestrator/logs/`). Source files are preserved —
 * `copyFile()` is used instead of `rename()` to avoid destroying files that
 * may still be open by the orchestrator.
 *
 * No-op conditions (returns 0 without touching the filesystem):
 *   - `destDir` already contains at least one `*-{slug}.jsonl` file.
 *   - `srcDir` does not exist or contains no matching files.
 *
 * Migration is best-effort: individual copy failures are swallowed so a
 * single unreadable file never blocks the others.
 *
 * @param destDir - Target directory (`{ledgerRoot}/{slug}/orchestrator/logs/`).
 * @param srcDir  - Source directory to scan for orphaned files. Callers invoke
 *                  this function twice in sequence: first with the old flat slug
 *                  directory (`{ledgerRoot}/{slug}/`), then with the raw
 *                  orchestrator logs directory (`orchestrator/logs/`).
 * @param slug    - Project slug used to match filenames (`*-{slug}.jsonl`).
 * @returns Number of files successfully copied.
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
      await copyFile(join(srcDir, filename), join(destDir, filename));
      migrated++;
    } catch {
      // Best-effort — skip files that cannot be moved (permissions, EXDEV, etc.)
    }
  }
  return migrated;
}

/**
 * Archives completed run log files from `sourceDir` into `archiveDir`.
 *
 * For each `*-{slug}.jsonl` file in `sourceDir`:
 *   - **Skips** files where `readLogStatus()` returns `is_active: true` (run still in progress).
 *   - **Copies** the file to `archiveDir` when it is not yet present there.
 *   - **Refreshes** the archived copy when the source file's `mtime` is newer
 *     than the archived copy's `mtime` (source has been updated since last archive).
 *
 * `archiveDir` is created (recursively) if it does not already exist.
 * Individual copy failures are swallowed — archival is best-effort.
 *
 * @param archiveDir - Destination directory for archived log files.
 * @param sourceDir  - Source directory to scan (e.g. the orchestrator's live
 *                     `logs/` directory).
 * @param slug       - Project slug used to match filenames (`*-{slug}.jsonl`).
 * @returns Array of filenames that were archived or refreshed during this call.
 */
export async function archiveCompletedLogs(
  archiveDir: string,
  sourceDir: string,
  slug: string,
): Promise<string[]> {
  const suffix = `-${slug}.jsonl`;

  // Scan sourceDir for matching files.
  let srcEntries: string[];
  try {
    srcEntries = await readdir(sourceDir);
  } catch {
    return []; // sourceDir absent or unreadable — nothing to archive.
  }

  const matching = srcEntries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length,
  );
  if (matching.length === 0) return [];

  await mkdir(archiveDir, { recursive: true });

  const archived: string[] = [];
  for (const filename of matching) {
    const srcPath = join(sourceDir, filename);
    const destPath = join(archiveDir, filename);

    // Skip files that belong to an active (still-running) orchestrator run.
    const { is_active } = await readLogStatus(srcPath);
    if (is_active) continue;

    // Determine whether a copy is needed.
    let needsCopy = true;
    try {
      const [srcStat, destStat] = await Promise.all([stat(srcPath), stat(destPath)]);
      // Archive is current when its mtime is >= source mtime.
      needsCopy = srcStat.mtimeMs > destStat.mtimeMs;
    } catch {
      // destPath doesn't exist yet — needsCopy stays true.
    }

    if (!needsCopy) continue;

    try {
      await copyFile(srcPath, destPath);
      archived.push(filename);
    } catch {
      // Best-effort — skip files that cannot be copied (permissions, etc.)
    }
  }

  return archived;
}

/**
 * Resolves which directory should be used to read a specific log file.
 *
 * Decision matrix (both `archiveDir` and `sourceDir` are considered):
 *
 * | sourceDir | archiveDir | source newer? | Result                              |
 * |-----------|------------|---------------|-------------------------------------|
 * | ✅ exists  | ❌ missing  | n/a           | returns `sourceDir`                 |
 * | ❌ missing | ✅ exists   | n/a           | returns `archiveDir`                |
 * | ✅ exists  | ✅ exists   | yes           | copies source → archive, returns `archiveDir` |
 * | ✅ exists  | ✅ exists   | no (archive current) | returns `archiveDir`         |
 *
 * When the file does not exist in either directory, returns `sourceDir` so the
 * caller's subsequent read will produce a sensible `NOT_FOUND` error.
 *
 * @param archiveDir - Ledger archive directory for this project's logs.
 * @param sourceDir  - Orchestrator live logs directory.
 * @param filename   - Bare filename (no directory component) to locate.
 * @returns The directory path from which `filename` should be read.
 */
export async function resolveLogSource(
  archiveDir: string,
  sourceDir: string,
  filename: string,
): Promise<string> {
  const srcPath = join(sourceDir, filename);
  const destPath = join(archiveDir, filename);

  let srcStat: { mtimeMs: number } | null = null;
  let destStat: { mtimeMs: number } | null = null;

  try {
    srcStat = await stat(srcPath);
  } catch {
    // File absent in sourceDir.
  }

  try {
    destStat = await stat(destPath);
  } catch {
    // File absent in archiveDir.
  }

  // Only in sourceDir.
  if (srcStat && !destStat) return sourceDir;

  // Only in archiveDir (or neither).
  if (!srcStat) return archiveDir;

  // Present in both — compare mtimes.
  if (srcStat.mtimeMs > destStat!.mtimeMs) {
    // Source is newer: refresh the archive copy before returning archiveDir.
    try {
      await mkdir(archiveDir, { recursive: true });
      await copyFile(srcPath, destPath);
    } catch {
      // Best-effort — return archiveDir even if copy fails (stale is better
      // than nothing, and sourceDir may have been removed).
    }
  }

  return archiveDir;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads a log file once and returns both active and dry-run status.
 *
 * - `is_active` is `true` when the last non-empty JSONL line does **not** have
 *   `action: "run_end"` or `action: "run_error"`. Empty files are considered
 *   active (run has just started writing).
 * - `is_dry_run` is `true` when the first non-empty JSONL line is a `run_start`
 *   event with `dry_run: true`.
 *
 * Fail-safe defaults on any I/O or parse error:
 *   - `is_active: false` — unreadable files are never shown with a "Running" badge.
 *   - `is_dry_run: false` — unreadable / malformed files never surface a dry-run badge.
 *
 * Replaces the former separate `isRunActive()` and `isDryRun()` helpers,
 * halving the number of `readFile()` calls per log entry in `findRunLogs()`.
 */
export async function readLogStatus(filePath: string): Promise<{ is_active: boolean; is_dry_run: boolean }> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { is_active: false, is_dry_run: false };
  }

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  // Determine is_dry_run from the first line (parsed independently so a
  // malformed first line does not affect the is_active determination).
  let is_dry_run = false;
  if (lines.length > 0) {
    try {
      const firstEntry = JSON.parse(lines[0]!);
      if (firstEntry && typeof firstEntry === 'object' && 'action' in firstEntry) {
        is_dry_run = firstEntry.action === 'run_start' && firstEntry.dry_run === true;
      }
    } catch {
      // Malformed first line — not a dry run.
    }
  }

  // Determine is_active from the last line.
  if (lines.length === 0) {
    return { is_active: true, is_dry_run }; // File just created — run has started
  }
  try {
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    if (lastEntry && typeof lastEntry === 'object' && 'action' in lastEntry) {
      const is_active = lastEntry.action !== 'run_end' && lastEntry.action !== 'run_error';
      return { is_active, is_dry_run };
    }
  } catch {
    // Malformed last line — cannot confirm completion.
  }
  return { is_active: true, is_dry_run }; // No terminal action found — treat as active
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

  if (!resolvedFilePath.startsWith(resolvedLogsDir + sep) &&
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
