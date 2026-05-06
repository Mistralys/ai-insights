/**
 * Progress resolution for orchestrator run queue entries.
 *
 * Reads the most recent JSONL log file for a given run slug and extracts
 * a structured `ProgressResolution` describing the last meaningful event.
 *
 * This module is read-only with respect to the filesystem.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { formatProgressEntry } from './format-progress-entry.js';
export { formatProgressEntry };
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured result returned by {@link resolveProgress}.
 */
export interface ProgressResolution {
  /**
   * Human-readable summary of the last meaningful JSONL log event,
   * or `null` when no log file is found or no summarisable event exists.
   */
  summary: string | null;

  /**
   * The `action` field of the JSONL entry that produced `summary`,
   * or `null` when `summary` is `null`.
   */
  lastAction: string | null;

  /**
   * Basename of the JSONL log file that was read, or `null` when no
   * matching log file was found.
   */
  logFilename: string | null;

  /**
   * `true` when `lastAction` is non-null and is not `'run_start'`,
   * indicating that at least one meaningful pipeline stage has been entered.
   */
  hasStageActivity: boolean;
}

// ---------------------------------------------------------------------------
// Progress resolver
// ---------------------------------------------------------------------------

/** Sentinel value reused when the function returns early with no data. */
const EMPTY_RESOLUTION: ProgressResolution = {
  summary:         null,
  lastAction:      null,
  logFilename:     null,
  hasStageActivity: false,
};
Object.freeze(EMPTY_RESOLUTION);

/**
 * Finds the most recent JSONL log file for `slug` in `logsDir` and returns
 * a structured {@link ProgressResolution} describing the last meaningful event.
 *
 * Returns a resolution with all `null`/`false` fields when:
 *   - No matching log file exists.
 *   - The file is unreadable or empty.
 *   - All entries are non-summarisable (e.g. only heartbeats).
 *
 * `logFilename` is populated even when the file is readable but contains
 * only non-summarisable events (i.e. it can be non-null while `summary` is null).
 *
 * `hasStageActivity` is derived from `lastAction`: it is `true` when
 * `lastAction` is non-null and is not `'run_start'`, indicating that at
 * least one pipeline stage has been entered.
 */
export async function resolveProgress(
  logsDir: string,
  slug:    string,
): Promise<ProgressResolution> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(logsDir);
  } catch {
    return EMPTY_RESOLUTION;
  }

  const suffix   = `-${slug}.jsonl`;
  const matching = dirEntries
    .filter((name) => name.endsWith(suffix) && name.length > suffix.length)
    .sort()
    .reverse();  // newest-first (ISO-prefixed filenames sort lexicographically)

  if (matching.length === 0) return EMPTY_RESOLUTION;

  const logFilename = matching[0]!;
  const filePath    = join(logsDir, logFilename);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { ...EMPTY_RESOLUTION, logFilename };
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  // Walk backwards to find the last summarisable event.
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
      const summary = formatProgressEntry(parsed);
      if (summary !== null) {
        const lastAction = typeof parsed['action'] === 'string' ? parsed['action'] : null;
        return {
          summary,
          lastAction,
          logFilename,
          hasStageActivity: lastAction !== null && lastAction !== 'run_start',
        };
      }
    } catch {
      // Malformed JSON line — skip.
    }
  }

  // File was readable but contained no summarisable events.
  return { ...EMPTY_RESOLUTION, logFilename };
}
