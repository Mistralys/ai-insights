/**
 * Shared Node.js error guards.
 *
 * Consolidates the `isNodeError` type guard that previously existed as five
 * identical (or near-identical) private copies across the storage and GUI
 * modules, plus a `hasErrorCode` helper for the `isNodeError(err) &&
 * err.code === 'X'` idiom that recurs at every one of those call sites.
 *
 * Where the original private copies differed, the strictest check was kept:
 * some copies only tested `'code' in err` (true even when `code` holds a
 * non-string value), while `json-state-file.ts` additionally required
 * `typeof err.code === 'string'`. The shared guard below always requires the
 * `string` type.
 */

/**
 * Narrows `err` to `NodeJS.ErrnoException` when it is an `Error` instance
 * carrying a string `code` property (e.g. `'ENOENT'`, `'ENOTDIR'`).
 *
 * @param err - The caught value to test.
 * @returns `true` when `err` is an `Error` with a string `code` property.
 */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string';
}

/**
 * Tests whether `err` is a Node.js error carrying the exact given `code`.
 *
 * Centralises the `isNodeError(err) && err.code === code` idiom that repeats
 * at every file-system call site handling a specific errno (e.g. `'ENOENT'`).
 *
 * @param err  - The caught value to test.
 * @param code - The exact errno code to match (e.g. `'ENOENT'`).
 * @returns `true` when `err` is a Node error whose `code` equals `code`.
 */
export function hasErrorCode(err: unknown, code: string): boolean {
  return isNodeError(err) && err.code === code;
}
