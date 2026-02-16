import { describe, it, expect } from 'vitest';
import { now } from '../../src/utils/timestamp.js';

describe('now', () => {
  it('returns a string in YYYY-MM-DD HH:MM:SS format', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('reflects the current time', () => {
    const before = new Date();
    const result = now();
    const after = new Date();

    // Parse the result back
    const [datePart, timePart] = result.split(' ');
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
    const parts = result.split(/[-: ]/);
    expect(parts[0]).toHaveLength(4); // year
    expect(parts[1]).toHaveLength(2); // month
    expect(parts[2]).toHaveLength(2); // day
    expect(parts[3]).toHaveLength(2); // hours
    expect(parts[4]).toHaveLength(2); // minutes
    expect(parts[5]).toHaveLength(2); // seconds
  });
});
