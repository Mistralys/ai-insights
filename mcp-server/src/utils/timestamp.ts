/**
 * Returns the current timestamp in ISO 8601 format: "YYYY-MM-DDTHH:MM:SS"
 */
export function now(): string {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // NOTE: toISOString() converts to UTC, which would corrupt timestamps for
  // users in non-UTC timezones. This manual construction uses local time
  // deliberately. Do not replace with toISOString().
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Parses a ledger timestamp string into a Date object.
 * Handles both the legacy space-separated format ("YYYY-MM-DD HH:MM:SS")
 * and the current ISO 8601 format ("YYYY-MM-DDTHH:MM:SS") for backward
 * compatibility with ledger files written by earlier versions.
 */
export function parseTimestamp(ts: string): Date {
  // Normalize the legacy space separator to 'T' so both formats parse correctly
  // in all JS environments (V8 handles both natively, but this is spec-safe).
  return new Date(ts.replace(' ', 'T'));
}
