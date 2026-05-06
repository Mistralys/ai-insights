/**
 * Effective status computation for orchestrator run queue entries.
 *
 * This module is pure — it has no I/O dependencies and no side effects.
 * All transition logic lives here so it can be tested independently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle state computed by {@link computeEffectiveStatus}. */
export type EffectiveStatus = 'pending' | 'started' | 'dead';

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

/**
 * Computes the effective lifecycle status for a queue entry given whether its
 * process is alive, whether its project ledger entry exists, and whether the
 * JSONL log shows stage-level activity.
 *
 * Transition rules (in priority order):
 *   1. `projectExists`                    → `'started'`
 *   2. `alive && hasLogActivity`          → `'started'`  (stage work detected)
 *   3. `alive`                            → `'pending'`  (run started, no stage yet)
 *   4. (default)                          → `'dead'`     (process gone)
 *
 * `hasLogActivity` corresponds to `ProgressResolution.hasStageActivity` — it
 * is `true` when the JSONL log contains at least one non-`run_start` event.
 *
 * @param alive          - Whether the orchestrator process is still running.
 * @param projectExists  - Whether `project-ledger.json` exists for this run.
 * @param hasLogActivity - Whether the JSONL log shows stage activity beyond
 *                         `run_start`. **Defaults to `false`** so callers that
 *                         do not read the log (e.g. `killQueueEntry`,
 *                         `dismissQueueEntry`) get the conservative result.
 */
export function computeEffectiveStatus(
  alive: boolean,
  projectExists: boolean,
  hasLogActivity: boolean = false,
): EffectiveStatus {
  if (projectExists) return 'started';
  if (alive && hasLogActivity) return 'started';
  if (alive) return 'pending';
  return 'dead';
}
