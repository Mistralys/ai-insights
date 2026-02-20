/**
 * Calls `fn` with `value` only when `value` is not `undefined`.
 *
 * Centralises the `if (x !== undefined) { fn(x); }` guard that arises when
 * `noUncheckedIndexedAccess` is enabled and the caller needs to assign into
 * an outer mutable variable (where a type assertion would suppress the
 * compiler warning without enforcing correctness).
 *
 * @param value - The potentially-undefined value to narrow.
 * @param fn    - Called with the narrowed (non-undefined) value.
 *
 * @example
 * const match = line.match(/^name:\s*(.+)$/);
 * if (match) {
 *   ifDefined(match[1], (v) => { name = stripYamlQuotes(v.trim()); });
 * }
 */
export function ifDefined<T>(value: T | undefined, fn: (v: T) => void): void {
  if (value !== undefined) {
    fn(value);
  }
}
