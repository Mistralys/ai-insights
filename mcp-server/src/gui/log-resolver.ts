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

import { readdir, readFile } from 'node:fs/promises';
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
 * Returns only matching filenames (not full paths). Files that do not match
 * the slug suffix are silently excluded. If `logsDir` does not exist or
 * cannot be read, returns an empty array.
 *
 * @param logsDir - Absolute path to the directory containing log files.
 * @param slug    - The project slug to filter by (e.g. `my-project`).
 */
export async function findRunLogs(logsDir: string, slug: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch {
    // Directory doesn't exist or is unreadable — treat as empty
    return [];
  }

  const suffix = `-${slug}.jsonl`;
  return entries.filter(
    (name) => name.endsWith(suffix) && name.length > suffix.length
  );
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
