import { describe, it, expect } from 'vitest';
import { now, parseTimestamp } from '../../src/utils/timestamp.js';

describe('now', () => {
  it('returns a string in YYYY-MM-DDTHH:MM:SS format', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('reflects the current time', () => {
    const before = new Date();
    const result = now();
    const after = new Date();

    // Parse the result back using the T separator
    const [datePart, timePart] = result.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);

    expect(year).toBe(before.getFullYear());
    expect(month).toBe(before.getMonth() + 1);
    expect(day).toBeGreaterThanOrEqual(before.getDate());
    expect(day).toBeLessThanOrEqual(after.getDate());
  });

  it('zero-pads single digit values', () => {
    // We can't easily control the system clock, but we can verify
    // the format always has 2-digit segments
    const result = now();
    const parts = result.split(/[-:T]/);
    expect(parts[0]).toHaveLength(4); // year
    expect(parts[1]).toHaveLength(2); // month
    expect(parts[2]).toHaveLength(2); // day
    expect(parts[3]).toHaveLength(2); // hours
    expect(parts[4]).toHaveLength(2); // minutes
    expect(parts[5]).toHaveLength(2); // seconds
  });
});

describe('parseTimestamp', () => {
  it('parses the new ISO 8601 T-separator format', () => {
    const result = parseTimestamp('2026-02-18T14:30:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // 0-indexed
    expect(result.getDate()).toBe(18);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
  });

  it('parses the legacy space-separator format for backward compatibility', () => {
    const result = parseTimestamp('2026-02-18 14:30:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // 0-indexed
    expect(result.getDate()).toBe(18);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(0);
  });

  it('returns the same Date value for equivalent T and space formats', () => {
    const fromT = parseTimestamp('2026-01-01T00:00:00');
    const fromSpace = parseTimestamp('2026-01-01 00:00:00');
    expect(fromT.getTime()).toBe(fromSpace.getTime());
  });
});
