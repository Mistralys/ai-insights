/**
 * Entry validator for the orchestrator run queue (extracted from get-queue.ts).
 *
 * Exposes `isRawQueueEntry()` as a named export so it can be unit-tested
 * directly without filesystem setup. The function is pure — it has no I/O
 * dependencies and no side effects.
 */

import type { RawQueueEntry } from './types.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Type-guard that validates a raw JSON value as a `RawQueueEntry`.
 *
 * Returns `true` only when **all five** of the following rules pass:
 *
 * 1. **Type check** — `entry` is a non-null object.
 * 2. **String fields** — `id`, `planPath`, and `startedAt` are strings; `id` must be
 *    non-empty and non-whitespace-only.
 * 3. **PID integer** — `pid` is a finite integer (rejects floats).
 * 4. **PID positive** — `pid` is greater than zero (rejects zero and negatives).
 * 5. **Non-empty slug** — `expectedSlug` is a non-empty, non-whitespace-only string
 *    (rejects missing, empty-string, and whitespace-only slugs).
 *
 * Used by `readQueueFile` in `get-queue.ts` to filter the parsed JSON array
 * before it is returned as `RawQueueEntry[]`.
 *
 * @returns `true` when every rule passes; `false` otherwise.
 */
export function isRawQueueEntry(entry: unknown): entry is RawQueueEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e['id'] === 'string' && (e['id'] as string).trim().length > 0 &&
    typeof e['pid'] === 'number' && Number.isInteger(e['pid']) && (e['pid'] as number) > 0 &&
    typeof e['planPath'] === 'string' &&
    typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).trim().length > 0 &&
    typeof e['startedAt'] === 'string'
  );
}
