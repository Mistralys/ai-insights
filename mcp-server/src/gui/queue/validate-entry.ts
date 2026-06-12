/**
 * Entry validator and normalizer for the orchestrator run queue (extracted
 * from get-queue.ts).
 *
 * Exposes:
 *   - `isRawQueueEntry()` — type-guard / validator (no I/O). As a side effect,
 *     normalizes `expectedRepo` to `null` in-place on entries that pass
 *     validation, so every validated entry satisfies `string | null` semantics.
 *   - `normalizeQueueEntry()` — fills in fields that may be absent in legacy
 *     queue entries written before `expected_repo` was introduced. Useful for
 *     callers that receive pre-validated entries without running them through
 *     the type-guard.
 *
 * `normalizeQueueEntry()` is a pure function (no side effects).
 * `isRawQueueEntry()` has no I/O dependencies but mutates its argument — see
 * that function's JSDoc for details.
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
 * The `expectedRepo` field is intentionally **not** required here — legacy
 * queue entries written before multi-root workspace support may omit it.
 * When this guard returns `true`, `expectedRepo` is guaranteed to be
 * `string | null` (the guard normalizes it in-place). Callers that hold a
 * `RawQueueEntry` obtained outside the guard can use `normalizeQueueEntry()`
 * as an explicit normalization step.
 *
 * **Side effect:** mutates the input object to set `expectedRepo = null`
 * when the field is absent, not a string, or an empty/whitespace-only string.
 * This is intentional — it ensures `Array.filter(isRawQueueEntry)` produces a
 * fully-typed `RawQueueEntry[]` without requiring a second mapping pass.
 * Empty-string and whitespace-only values carry no meaningful identity and are
 * treated the same as absent (normalized to `null`).
 *
 * Used by `readQueueFile` in `get-queue.ts` to filter the parsed JSON array
 * before it is returned as `RawQueueEntry[]`.
 *
 * @returns `true` when every rule passes; `false` otherwise.
 */
export function isRawQueueEntry(entry: unknown): entry is RawQueueEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (
    !(typeof e['id'] === 'string' && (e['id'] as string).trim().length > 0) ||
    !(typeof e['pid'] === 'number' && Number.isInteger(e['pid']) && (e['pid'] as number) > 0) ||
    !(typeof e['planPath'] === 'string') ||
    !(typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).trim().length > 0) ||
    !(typeof e['startedAt'] === 'string')
  ) {
    return false;
  }
  // Normalize expectedRepo in-place so the returned object satisfies RawQueueEntry.
  // Legacy entries omit this field; new entries may include it as a string or null.
  // Empty-string and whitespace-only values are treated the same as absent — normalized
  // to null — so downstream consumers always receive a meaningful string or null.
  if (typeof e['expectedRepo'] !== 'string' || (e['expectedRepo'] as string).trim().length === 0) {
    e['expectedRepo'] = null;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Normalizer (legacy compatibility)
// ---------------------------------------------------------------------------

/**
 * Ensures `expectedRepo` is `string | null` on a validated `RawQueueEntry`.
 *
 * Legacy queue entries written before multi-root workspace support omit the
 * `expected_repo` field entirely. This function canonicalizes the value to
 * `null` so every downstream consumer can rely on `string | null` without
 * having to handle `undefined`.
 *
 * @param entry - A validated `RawQueueEntry` (output of `isRawQueueEntry`).
 * @returns When `expectedRepo` is already `string | null` (the common case
 *          after `isRawQueueEntry()` has run), returns the **same reference**
 *          unchanged. When `expectedRepo` is `undefined` (legacy entry that
 *          bypassed the type-guard), returns a **new spread object** with
 *          `expectedRepo` set to `null`.
 */
export function normalizeQueueEntry(entry: RawQueueEntry): RawQueueEntry {
  if (entry.expectedRepo === undefined) {
    return { ...entry, expectedRepo: null };
  }
  return entry;
}
