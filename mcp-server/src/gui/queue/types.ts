/**
 * Shared type definitions and constants for the orchestrator run queue.
 *
 * This module is the leaf of the queue module dependency chain — it imports
 * only from `compute-effective-status.ts` and has no other intra-queue
 * dependencies.
 *
 * Dependency order (lowest to highest):
 *   types.ts ← compute-effective-status.ts ← validate-entry.ts
 *   format-progress-entry.ts  (independent leaf)
 *   resolve-progress.ts ← format-progress-entry.ts
 *   get-queue.ts ← types, validate-entry, resolve-progress, compute-effective-status
 *   orchestrator-manager.ts ← get-queue, types, resolve-progress, compute-effective-status
 */

import type { EffectiveStatus } from './compute-effective-status.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename of the shared run queue within the orchestrator logs directory. */
export const QUEUE_FILENAME = '.run-queue.json';

// ---------------------------------------------------------------------------
// Queue entry types
// ---------------------------------------------------------------------------

/**
 * Raw entry shape as written by the Python orchestrator to `.run-queue.json`.
 * The `status` field is always `'pending'` at write time; effective lifecycle
 * transitions are computed in-memory by `getQueue()`.
 */
export interface RawQueueEntry {
  id: string;
  pid: number;
  planPath: string;
  expectedSlug: string;
  /**
   * Repository name (workspace root slug) written by the Python orchestrator.
   * Set to `null` for legacy queue entries that pre-date multi-root workspace
   * support — the read boundary in `validate-entry.ts` normalizes missing
   * `expected_repo` fields to `null` so every downstream consumer can rely on
   * `string | null` and never needs to handle `undefined`.
   */
  expectedRepo: string | null;
  startedAt: string;
  status: 'pending';
}

/**
 * Queue entry enriched with computed lifecycle state and an optional
 * human-readable JSONL progress summary. Returned by `getQueue()`.
 *
 * @remarks
 * The fields that extend `RawQueueEntry` are all computed in-memory by
 * `getQueue()` and are never persisted to the queue file:
 *
 * - `effectiveStatus` — derived from the PID alive-check, the presence of the
 *   project ledger, and JSONL stage activity. See `computeEffectiveStatus()`.
 * - `progress` / `lastAction` / `logFilename` — extracted from the most recent
 *   JSONL log event by `resolveProgress()`.
 * - `projectExists` — populated directly from `getProjectLedgerStatus().exists`.
 *   Use this flag (rather than inferring from `effectiveStatus`) to gate UI
 *   elements that require a valid project ledger, e.g. the "View Project" link.
 */
export interface QueueEntry extends RawQueueEntry {
  /** Lifecycle state computed in-memory — not persisted to the queue file. */
  effectiveStatus: EffectiveStatus;
  /**
   * Human-readable summary of the most recent meaningful JSONL log event,
   * or `null` when no log file is found or no summarizable event exists.
   */
  progress: string | null;
  /**
   * The `action` field of the JSONL entry that produced `progress`,
   * or `null` when `progress` is `null`.
   *
   * @remarks Callers can derive `hasStageActivity` from this field without
   * reading the `ProgressResolution` object directly:
   * `lastAction !== null && lastAction !== 'run_start'`.
   */
  lastAction: string | null;
  /**
   * Basename of the JSONL log file that was read, or `null` when no
   * matching log file was found.
   */
  logFilename: string | null;
  /**
   * `true` when the project ledger file exists on disk for this entry's
   * `expectedSlug`; `false` when it does not (e.g. the project has not been
   * initialised yet). Use this flag to gate the "View Project" link — it is
   * authoritative and avoids heuristic inference from `effectiveStatus`.
   */
  projectExists: boolean;
}

// ---------------------------------------------------------------------------
// Queue mutation types
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link killQueueEntry}.
 */
export interface KillResult {
  /** `true` when the entry was found, was effectively pending, and was terminated. */
  killed: boolean;
}

// ---------------------------------------------------------------------------
// Preflight types
// ---------------------------------------------------------------------------

/**
 * Result of a single preflight check.
 */
export interface PreflightResult {
  name:    string;
  pass:    boolean;
  detail:  string;
  fix?:    string;
}

/**
 * Result returned by {@link startOrchestrator}.
 */
export interface StartResult {
  /** All preflight check results, in execution order. */
  checks:  PreflightResult[];
  /** `true` only when `dryRun` is `false` and every check passed. */
  started: boolean;
  /** PID of the spawned process. Present only when `started === true`. */
  pid?:    number;
  /**
   * Basename of the run-status tombstone file the GUI should poll for,
   * e.g. `"a3f9b1c2d4e5f6a7-run-status.json"`.
   * Present only when `started === true`.
   */
  runStatusFilename?: string;
}

// ---------------------------------------------------------------------------
// Run-status tombstone type
// ---------------------------------------------------------------------------

/**
 * Shape of the `{slug}.run-status.json` file written by the Python
 * orchestrator at the end of every run.
 *
 * The file is deleted at the *start* of a new run for the same slug and
 * written at the *end*, so its presence always reflects the most recent
 * completed run.
 */
export interface RunStatus {
  slug:        string;
  result:      'SUCCESS' | 'ERROR';
  error:       string | null;
  logFilename: string;
  durationS:   number | null;
}
