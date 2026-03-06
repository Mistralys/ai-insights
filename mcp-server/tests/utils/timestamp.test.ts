import { describe, it, expect } from 'vitest';
import { now, parseTimestamp, formatRelativeTime } from '../../src/utils/timestamp.js';

describe('now', () => {
  it('returns a string in YYYY-MM-DDTHH:MM:SSZ UTC format', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('reflects the current UTC time', () => {
    const before = new Date();
    const result = now();
    const after = new Date();

    // Strip trailing Z and parse
    const [datePart, timePart] = result.replace(/Z$/, '').split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);

    expect(year).toBe(before.getUTCFullYear());
    expect(month).toBe(before.getUTCMonth() + 1);
    expect(day).toBeGreaterThanOrEqual(before.getUTCDate());
    expect(day).toBeLessThanOrEqual(after.getUTCDate());
  });

  it('zero-pads single digit values', () => {
    // We can't easily control the system clock, but we can verify
    // the format always has 2-digit segments
    const result = now();
    const stripped = result.replace(/Z$/, '');
    const parts = stripped.split(/[-:T]/);
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
  });

  it('parses the legacy space-separator format for backward compatibility', () => {
    const result = parseTimestamp('2026-02-18 14:30:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // 0-indexed
    expect(result.getDate()).toBe(18);
  });

  it('parses UTC timestamps with trailing Z', () => {
    const result = parseTimestamp('2026-02-18T14:30:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(18);
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCMinutes()).toBe(30);
    expect(result.getUTCSeconds()).toBe(0);
  });

  it('returns the same Date value for equivalent T and space formats', () => {
    const fromT = parseTimestamp('2026-01-01T00:00:00');
    const fromSpace = parseTimestamp('2026-01-01 00:00:00');
    expect(fromT.getTime()).toBe(fromSpace.getTime());
  });
});

describe('formatRelativeTime', () => {
  const ref = new Date('2026-03-06T12:00:00Z');

  it('returns "just now" for differences under 1 minute', () => {
    expect(formatRelativeTime('2026-03-06T11:59:30Z', ref)).toBe('just now');
    expect(formatRelativeTime('2026-03-06T12:00:00Z', ref)).toBe('just now');
  });

  it('returns "Xmn ago" for differences under 1 hour', () => {
    expect(formatRelativeTime('2026-03-06T11:39:00Z', ref)).toBe('21mn ago');
    expect(formatRelativeTime('2026-03-06T11:01:00Z', ref)).toBe('59mn ago');
  });

  it('returns "Xh ago" when the remainder is 0 minutes', () => {
    expect(formatRelativeTime('2026-03-06T10:00:00Z', ref)).toBe('2h ago');
  });

  it('returns "Xh Ymn ago" when there are remaining minutes', () => {
    expect(formatRelativeTime('2026-03-06T09:30:00Z', ref)).toBe('2h 30mn ago');
    expect(formatRelativeTime('2026-03-06T10:45:00Z', ref)).toBe('1h 15mn ago');
  });

  it('returns "Xd ago" when the remainder is 0 hours', () => {
    expect(formatRelativeTime('2026-03-05T12:00:00Z', ref)).toBe('1d ago');
    expect(formatRelativeTime('2026-03-04T12:00:00Z', ref)).toBe('2d ago');
  });

  it('returns "Xd Yh ago" when there are remaining hours', () => {
    expect(formatRelativeTime('2026-03-05T06:00:00Z', ref)).toBe('1d 6h ago');
  });

  it('clamps future timestamps to "just now" instead of negative values', () => {
    expect(formatRelativeTime('2026-03-06T13:00:00Z', ref)).toBe('just now');
  });
});