/**
 * Queue reading internals for the orchestrator run queue (WP-B extraction).
 *
 * Reads `.run-queue.json`, enriches each raw entry with computed lifecycle
 * state and JSONL progress data, and returns the result as `QueueEntry[]`.
 *
 * This module is read-only with respect to the queue file and all other files.
 *
 * The `isRawQueueEntry` type-guard has been extracted to `validate-entry.ts`
 * for direct testability; it is imported here and re-used at the filter call site.
 *
 * Exports beyond `getQueue()`:
 *   - `readQueueFile` — used by `checkNoConflict` in `orchestrator-manager.ts`.
 *   - `isProcessAlive` — used by queue-mutation functions in `orchestrator-manager.ts`.
 *   - `getProjectLedgerStatus` — used by `killQueueEntry`/`dismissQueueEntry`
 *     in `orchestrator-manager.ts`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { QUEUE_FILENAME, type RawQueueEntry, type QueueEntry } from './types.js';
import { isRawQueueEntry } from './validate-entry.js';
import { resolveProgress } from './resolve-progress.js';
import { computeEffectiveStatus } from './compute-effective-status.js';

// ---------------------------------------------------------------------------
// PID alive check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the process with `pid` exists on this machine.
 *
 * Uses `process.kill(pid, 0)` which is a zero-signal check — it only
 * verifies the process exists and does not actually deliver any signal.
 *
 * Exported for use by queue-mutation functions in `orchestrator-manager.ts`.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queue file reader
// ---------------------------------------------------------------------------

/**
 * Reads and parses `<logsDir>/.run-queue.json`.
 * Returns `[]` on any I/O or parse error — fail-safe.
 * Never writes to the queue file.
 *
 * Exported for use by `checkNoConflict` in `orchestrator-manager.ts`.
 */
export async function readQueueFile(logsDir: string): Promise<RawQueueEntry[]> {
  const queuePath = join(logsDir, QUEUE_FILENAME);
  let raw: string;
  try {
    raw = await readFile(queuePath, 'utf-8');
  } catch {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isRawQueueEntry);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Project ledger check
// ---------------------------------------------------------------------------

/**
 * Returns whether the project identified by `slug` has a ledger entry and
 * whether synthesis has been generated for it.
 *
 * Fail-safe: any I/O or parse error returns `{ exists: false, synthesisGenerated: false }`.
 *
 * Exported for use by `killQueueEntry`/`dismissQueueEntry` in `orchestrator-manager.ts`.
 *
 * @param ledgerRoot - Absolute path to the ledger root directory.
 * @param slug       - Project slug (e.g. `2026-05-05-my-feature`).
 * @returns An object with two fields:
 *   - `exists` — `true` when `<ledgerRoot>/<slug>/project-ledger.json` is present and
 *     readable; `false` on any I/O error or when the file does not exist.
 *   - `synthesisGenerated` — `true` when the ledger's `synthesis_generated` field equals
 *     `true`; `false` when the file is absent, unreadable, or the field is falsy.
 */
export async function getProjectLedgerStatus(
  ledgerRoot: string,
  slug: string,
): Promise<{ exists: boolean; synthesisGenerated: boolean }> {
  const projectLedgerPath = join(ledgerRoot, slug, 'project-ledger.json');
  let raw: string;
  try {
    raw = await readFile(projectLedgerPath, 'utf-8');
  } catch {
    return { exists: false, synthesisGenerated: false };
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      exists: true,
      synthesisGenerated: data['synthesis_generated'] === true,
    };
  } catch {
    return { exists: true, synthesisGenerated: false };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the shared orchestrator run queue and returns all active entries
 * enriched with computed lifecycle state and JSONL progress summaries.
 *
 * Entries for completed projects (`synthesis_generated === true`) are
 * automatically excluded from the result.
 *
 * This function is read-only: it never writes to the queue file or any
 * other file on disk.
 *
 * @param params.logsDir    - Absolute path to `orchestrator/logs/`.
 * @param params.ledgerRoot - Absolute path to the central ledger root.
 * @returns Enriched queue entries, excluding completed runs.
 */
export async function getQueue(params: {
  logsDir: string;
  ledgerRoot: string;
}): Promise<QueueEntry[]> {
  const { logsDir, ledgerRoot } = params;

  const rawEntries = await readQueueFile(logsDir);
  if (rawEntries.length === 0) return [];

  const enriched = await Promise.all(
    rawEntries.map(async (entry) => {
      const [projectStatus, progressResult] = await Promise.all([
        getProjectLedgerStatus(ledgerRoot, entry.expectedSlug),
        resolveProgress(logsDir, entry.expectedSlug),
      ]);

      const { exists: projectExists, synthesisGenerated } = projectStatus;
      const alive = isProcessAlive(entry.pid);

      // Compute effective status per AC-2 through AC-5.
      const effectiveStatus = computeEffectiveStatus(alive, projectExists, progressResult.hasStageActivity);

      // AC-6: exclude entries whose project has completed synthesis.
      if (effectiveStatus === 'started' && synthesisGenerated) {
        return null;
      }

      const result: QueueEntry = {
        ...entry,
        effectiveStatus,
        progress:      progressResult.summary,
        lastAction:    progressResult.lastAction,
        logFilename:   progressResult.logFilename,
        projectExists,
      };
      return result;
    }),
  );

  return enriched.filter((e): e is QueueEntry => e !== null);
}
