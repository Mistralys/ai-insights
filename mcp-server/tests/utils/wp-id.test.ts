import { describe, it, expect } from 'vitest';
import { formatWpId, parseWpId } from '../../src/utils/wp-id.js';

describe('formatWpId', () => {
  it('pads single digit numbers', () => {
    expect(formatWpId(1)).toBe('WP-001');
    expect(formatWpId(9)).toBe('WP-009');
  });

  it('pads double digit numbers', () => {
    expect(formatWpId(10)).toBe('WP-010');
    expect(formatWpId(42)).toBe('WP-042');
    expect(formatWpId(99)).toBe('WP-099');
  });

  it('handles triple digit numbers', () => {
    expect(formatWpId(100)).toBe('WP-100');
    expect(formatWpId(123)).toBe('WP-123');
    expect(formatWpId(999)).toBe('WP-999');
  });

  it('handles four-digit numbers (1000+)', () => {
    expect(formatWpId(1000)).toBe('WP-1000');
    expect(formatWpId(1234)).toBe('WP-1234');
  });
});

describe('parseWpId', () => {
  it('extracts numeric part from valid IDs', () => {
    expect(parseWpId('WP-001')).toBe(1);
    expect(parseWpId('WP-042')).toBe(42);
    expect(parseWpId('WP-123')).toBe(123);
  });

  it('parses four-digit WP IDs (1000+)', () => {
    expect(parseWpId('WP-1000')).toBe(1000);
    expect(parseWpId('WP-1234')).toBe(1234);
  });

  it('throws on invalid format', () => {
    expect(() => parseWpId('wp-001')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('WP001')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('WP-')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('TASK-001')).toThrow('Invalid work package ID format');
  });
});

/**
 * Integration-style tests that validate the WP ID generation strategy used
 * by createWorkPackage: next ID = max(existing) + 1 (gap-resilient).
 *
 * These tests exercise the same logic inline rather than calling createWorkPackage
 * directly (which requires a full LedgerStore), making them fast and portable.
 */
describe('WP ID gap-resilient generation (createWorkPackage logic)', () => {
  // Utility mirroring the logic in createWorkPackage
  function nextWpId(existingIds: string[]): string {
    const existingNumbers = existingIds.map((id) => parseWpId(id));
    const nextNumber =
      existingNumbers.length > 0
        ? existingNumbers.reduce((max, n) => Math.max(max, n), 0) + 1
        : 1;
    return formatWpId(nextNumber);
  }

  it('returns WP-001 when no packages exist', () => {
    expect(nextWpId([])).toBe('WP-001');
  });

  it('returns next sequential ID when packages are contiguous', () => {
    expect(nextWpId(['WP-001', 'WP-002', 'WP-003'])).toBe('WP-004');
  });

  it('returns max+1 when IDs have gaps — does NOT fill the gap', () => {
    // WP-001 and WP-003 exist (WP-002 was deleted). Next should be WP-004,
    // not WP-002, confirming gap-resilience over gap-filling behaviour.
    expect(nextWpId(['WP-001', 'WP-003'])).toBe('WP-004');
  });

  it('handles a single existing package', () => {
    expect(nextWpId(['WP-005'])).toBe('WP-006');
  });
});
