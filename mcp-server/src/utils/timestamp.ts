/**
 * Returns the current timestamp in ISO 8601 UTC format: "YYYY-MM-DDTHH:MM:SSZ"
 */
export function now(): string {
  const date = new Date();

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
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
