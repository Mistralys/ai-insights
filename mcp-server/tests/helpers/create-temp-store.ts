/**
 * Shared test helper: createTempStore
 *
 * ## Purpose
 * Provides a reusable factory that always pairs a `LedgerStore` with a
 * `mkdtemp`-based ledger root, ensuring tests never accidentally write to the
 * real `storage/ledger/` directory.
 *
 * ## Usage
 *
 * ```ts
 * import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';
 *
 * let handle: Awaited<ReturnType<typeof createTempStore>>;
 *
 * beforeEach(async () => {
 *   handle = await createTempStore('/absolute/path/to/plan-folder');
 * });
 *
 * afterEach(async () => {
 *   await cleanupTempStore(handle);
 * });
 *
 * it('writes something', async () => {
 *   await handle.store.writeRootIndex(root);
 * });
 * ```
 *
 * ## Convention contract
 * Every test file that constructs a `LedgerStore` MUST supply an isolated
 * ledger root obtained from `mkdtemp`. Passing a production path (e.g. the
 * real `storage/ledger/` directory) from within tests is forbidden because it
 * contaminates version-controlled storage and causes stale artifact
 * accumulation across CI runs.
 *
 * `createTempStore` makes this the path of least resistance: callers get both
 * the store and the temp directory handle from a single awaitable call, and
 * `cleanupTempStore` disposes both atomically.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';

export interface TempStoreHandle {
  /** Isolated LedgerStore instance backed by a temporary directory. */
  store: LedgerStore;
  /** Absolute path to the plan folder passed to LedgerStore. */
  planPath: string;
  /** Absolute path to the temporary ledger root (the mkdtemp directory). */
  ledgerRoot: string;
}

/**
 * Creates a `LedgerStore` backed by a fresh `mkdtemp` directory.
 *
 * @param planPath - Absolute path to the plan folder (used as the project path
 *   argument to LedgerStore). Under test this can be a fixed synthetic path
 *   such as `join(tmpdir(), '2026-01-01-test-project')` — it does not need to
 *   exist on disk.
 * @param prefix - Optional prefix for the temporary directory name.
 *   Defaults to `'ledger-test-'`.
 * @returns A {@link TempStoreHandle} containing the store, planPath, and
 *   ledgerRoot for use in `afterEach` cleanup.
 */
export async function createTempStore(
  planPath: string,
  prefix = 'ledger-test-'
): Promise<TempStoreHandle> {
  const ledgerRoot = await mkdtemp(join(tmpdir(), prefix));
  const store = new LedgerStore(planPath, ledgerRoot);
  return { store, planPath, ledgerRoot };
}

/**
 * Removes the temporary ledger root directory created by {@link createTempStore}.
 * Safe to call even if the directory was never written to.
 */
export async function cleanupTempStore(handle: TempStoreHandle): Promise<void> {
  await rm(handle.ledgerRoot, { recursive: true, force: true });
}
