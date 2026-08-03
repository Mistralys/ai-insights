import { isStoreContextInitialized, getStoreRouter } from '../storage/store-context.js';
import { inferProjectRootFromPlanPath, deriveRepoName } from './ledger-root.js';

/**
 * Extracts the ledger root string from an unknown parameter value.
 * Guards against the MCP SDK injecting a RequestHandlerExtra object as the
 * second positional argument to handler functions (see constraint 58).
 *
 * @param val - The raw value passed as `_ledgerRoot` by the MCP SDK or a test
 * @returns The string value if `val` is a string, otherwise `undefined`
 */
export function extractLedgerRoot(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/**
 * Resolves the correct ledger root for a project in multi-store mode.
 *
 * Resolution order:
 * 1. If `testOverride` is a string, return it directly (test injection path —
 *    short-circuits all store logic, preserving existing test behaviour).
 * 2. If the store context is not initialized, return `undefined` (single-store
 *    or test mode — caller falls through to LedgerStore default).
 * 3. If the router is not in multi-store mode, return `undefined` (single-store
 *    config — LedgerStore default is correct).
 * 4. Infer the project root from the plan path; if it cannot be derived, return
 *    `undefined` (graceful fallback — avoids throwing for malformed paths).
 * 5. Look up which store owns the repo; if none, return `undefined`
 *    (unregistered repo — fall through to default store, preserving backward
 *    compatibility with pre-migration projects).
 *
 * Returning `undefined` signals "use LedgerStore default" in all fallback cases.
 *
 * @param projectPath - Absolute path to the plan folder.
 * @param testOverride - Optional raw value from a handler's `_ledgerRoot` param.
 *   When this is a string it is treated as a direct ledger root path and all
 *   store-context logic is bypassed.
 * @returns The resolved store path, or `undefined` to signal "use LedgerStore default".
 */
export async function resolveMultiStoreLedgerRoot(
  projectPath: string,
  testOverride?: unknown
): Promise<string | undefined> {
  const override = extractLedgerRoot(testOverride);
  if (override !== undefined) {
    return override;
  }

  if (!isStoreContextInitialized() || !getStoreRouter().isMultiStoreMode()) {
    return undefined;
  }

  const projectRoot = inferProjectRootFromPlanPath(projectPath);
  if (projectRoot === null) {
    return undefined;
  }

  const repoName = deriveRepoName(projectPath, projectRoot);
  const storeRef = await getStoreRouter().resolveStoreForRepo(repoName);
  return storeRef?.storePath;
}
