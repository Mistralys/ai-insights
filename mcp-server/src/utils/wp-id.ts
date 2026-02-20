/**
 * Formats a work package number as "WP-###" with zero-padding to 3 digits.
 * @param n - The work package number (e.g., 1, 42, 123)
 * @returns Formatted work package ID (e.g., "WP-001", "WP-042", "WP-123")
 */
export function formatWpId(n: number): string {
  return `WP-${String(n).padStart(3, '0')}`;
}

/**
 * Parses a work package ID and extracts the numeric part.
 * @param id - The work package ID (e.g., "WP-001", "WP-042")
 * @returns The numeric work package number
 * @throws Error if the ID format is invalid
 */
export function parseWpId(id: string): number {
  const match = id.match(/^WP-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid work package ID format: "${id}". Expected format: WP-###`);
  }
  // Unreachable: regex (\d+) always captures when match succeeds; satisfies noUncheckedIndexedAccess
  const wpNum = match[1];
  if (wpNum === undefined) {
    throw new Error(`Invalid work package ID format: "${id}". Expected format: WP-###`);
  }
  return parseInt(wpNum, 10);
}
