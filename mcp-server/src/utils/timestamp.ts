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

/**
 * Returns a short human-readable relative time string, e.g. "21mn ago",
 * "2h ago", "3d ago".  Used in AMBIGUOUS candidate listings.
 *
 * @param ts  - ISO timestamp string (as stored in project meta)
 * @param ref - Reference point for "now"; defaults to the current wall clock
 */
export function formatRelativeTime(ts: string, ref: Date = new Date()): string {
  const diffMs = ref.getTime() - parseTimestamp(ts).getTime();
  // Clamp negative diffs (clock skew / future timestamps) to 0.
  const ms = Math.max(0, diffMs);

  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours   = Math.floor(totalMinutes / 60);
  const totalDays    = Math.floor(totalHours   / 24);

  if (totalMinutes < 1)  return 'just now';
  if (totalHours   < 1)  return `${totalMinutes}mn ago`;
  if (totalDays    < 1) {
    const remMin = totalMinutes % 60;
    return remMin > 0 ? `${totalHours}h ${remMin}mn ago` : `${totalHours}h ago`;
  }
  const remHours = totalHours % 24;
  return remHours > 0 ? `${totalDays}d ${remHours}h ago` : `${totalDays}d ago`;
}
