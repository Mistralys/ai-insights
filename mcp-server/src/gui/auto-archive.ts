/**
 * Auto-Archive Service
 *
 * Scans for stale COMPLETE projects and archives them automatically.
 * Designed to be called on GUI server startup and on a periodic interval.
 *
 * STDIO discipline: all output goes to stderr only — this module is safe for
 * use in MCP server contexts where stdout is the protocol channel.
 */

import { LedgerStore } from '../storage/ledger-store.js';
import { withLock } from '../storage/file-lock.js';
import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Module-level timer state
// ---------------------------------------------------------------------------

let _intervalHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Core scan function
// ---------------------------------------------------------------------------

/**
 * Scans all projects and archives eligible COMPLETE ones.
 *
 * Eligibility: `status === 'COMPLETE'` AND `last_updated` is older than
 * `maxAgeDays` days.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param maxAgeDays  Age threshold in days. Pass `0` to disable (no-op).
 * @returns           Array of slugs that were archived in this run.
 */
export async function runAutoArchive(
  ledgerRoot: string,
  maxAgeDays: number
): Promise<string[]> {
  if (maxAgeDays === 0) {
    return [];
  }

  const projects = await LedgerStore.listAllProjects(ledgerRoot);
  const archived: string[] = [];
  const now = Date.now();
  const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;

  for (const meta of projects) {
    if (meta.status !== 'COMPLETE') {
      continue;
    }

    let lastUpdatedMs: number;
    try {
      lastUpdatedMs = new Date(meta.last_updated).getTime();
      if (isNaN(lastUpdatedMs)) {
        process.stderr.write(
          `[auto-archive] Skipping '${meta.slug}': unparseable last_updated '${meta.last_updated}'\n`
        );
        continue;
      }
    } catch {
      process.stderr.write(`[auto-archive] Skipping '${meta.slug}': failed to parse last_updated\n`);
      continue;
    }

    const ageMs = now - lastUpdatedMs;
    if (ageMs < thresholdMs) {
      continue;
    }

    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    try {
      const store = new LedgerStore(meta.plan_path, ledgerRoot);
      await withLock(store.storageDir, async () => {
        const rootIndex = await store.readRootIndex();
        // Auto-archiving is administrative — preserve last_updated so the
        // project's visible activity time is not distorted.
        await store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' }, { preserveLastUpdated: true });
      });
      archived.push(meta.slug);
      process.stderr.write(
        `[auto-archive] Archived project: ${meta.slug} (inactive for ${ageDays} days)\n`
      );
    } catch (err) {
      process.stderr.write(
        `[auto-archive] Failed to archive '${meta.slug}': ${String(err)}\n`
      );
    }
  }

  return archived;
}

// ---------------------------------------------------------------------------
// Timer management
// ---------------------------------------------------------------------------

/**
 * Starts the auto-archive background timer.
 *
 * Reads `auto_archive_days` from the current GUI config. If the value is
 * greater than 0, runs `runAutoArchive` immediately and then every
 * `intervalMs` milliseconds (default: 10 minutes).
 *
 * Calling this function when a timer is already running is a no-op (the
 * existing timer is preserved). Call `stopAutoArchiveTimer()` first if you
 * need to restart with new settings.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param intervalMs  Polling interval in milliseconds. Default: 600 000 (10 min).
 */
export function startAutoArchiveTimer(ledgerRoot: string, intervalMs = 600_000): void {
  if (_intervalHandle !== null) {
    return; // Already running
  }

  const tick = (): void => {
    const config = getConfig();
    const maxAgeDays = config.auto_archive_days;
    if (maxAgeDays === 0) {
      return; // Disabled at runtime
    }
    runAutoArchive(ledgerRoot, maxAgeDays).catch((err) => {
      process.stderr.write(`[auto-archive] Unexpected error during scan: ${String(err)}\n`);
    });
  };

  // Run once immediately on startup, then schedule the interval.
  tick();
  _intervalHandle = setInterval(tick, intervalMs);
}

/**
 * Clears the auto-archive interval timer.
 *
 * Safe to call when no timer is active.
 */
export function stopAutoArchiveTimer(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

/**
 * For testing only: resets the internal timer state without clearing a
 * running interval. Call `stopAutoArchiveTimer()` first in test teardown if a
 * timer was started.
 *
 * @internal
 */
export function _resetTimerForTesting(): void {
  _intervalHandle = null;
}
