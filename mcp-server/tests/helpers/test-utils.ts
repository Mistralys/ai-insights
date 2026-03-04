/**
 * Shared test utilities for the MCP server test suite.
 *
 * These helpers eliminate duplicated boilerplate patterns that appear across
 * multiple test files.
 */

/**
 * Injects `--ledger-dir <dir>` into `process.argv` so the LedgerStore
 * resolver picks up the temporary directory. Returns a cleanup function
 * that removes the injected arguments when called.
 *
 * @example
 * ```ts
 * let cleanup: () => void;
 * beforeEach(() => { cleanup = injectLedgerDir(tempDir); });
 * afterEach(() => { cleanup(); });
 * ```
 */
export function injectLedgerDir(dir: string): () => void {
  process.argv.push('--ledger-dir', dir);
  return () => {
    const idx = process.argv.indexOf('--ledger-dir');
    if (idx !== -1) {
      process.argv.splice(idx, 2);
    }
  };
}

/**
 * Returns the current time floored to the nearest second (milliseconds zeroed).
 * Matches the ledger's timestamp precision, avoiding flaky off-by-one-ms
 * assertions in time-sensitive tests.
 */
export function nowFloor(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}
