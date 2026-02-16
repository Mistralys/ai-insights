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
});

describe('parseWpId', () => {
  it('extracts numeric part from valid IDs', () => {
    expect(parseWpId('WP-001')).toBe(1);
    expect(parseWpId('WP-042')).toBe(42);
    expect(parseWpId('WP-123')).toBe(123);
  });

  it('throws on invalid format', () => {
    expect(() => parseWpId('wp-001')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('WP001')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('WP-')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('')).toThrow('Invalid work package ID format');
    expect(() => parseWpId('TASK-001')).toThrow('Invalid work package ID format');
  });
});
