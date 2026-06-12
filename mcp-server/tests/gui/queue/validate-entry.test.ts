/**
 * Tests for src/gui/queue/validate-entry.ts — WP-005
 *
 * Verifies:
 *   AC-1: At least 10 test cases for isRawQueueEntry().
 *   AC-2: Tests import directly from validate-entry.js (no filesystem setup).
 *   AC-3: All 5 validation rules exercised:
 *         (a) non-null object check
 *         (b) string id
 *         (c) positive integer pid
 *         (d) string planPath
 *         (e) non-empty non-whitespace expectedSlug and string startedAt
 *   AC-4: All tests pass when run via `npm test` in mcp-server/.
 *   AC-5: Pure-function tests — no filesystem or I/O setup.
 */

import { describe, it, expect } from 'vitest';
import { isRawQueueEntry, normalizeQueueEntry } from '../../../src/gui/queue/validate-entry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A canonical valid entry that satisfies every validation rule. */
const VALID_ENTRY = {
  id:           'run-abc-123',
  pid:          42,
  planPath:     '/fake/plans/2026-05-20-my-feature',
  expectedSlug: '2026-05-20-my-feature',
  startedAt:    '2026-05-20T00:00:00Z',
  status:       'pending' as const,
};

// ---------------------------------------------------------------------------
// Happy-path: valid entry
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — valid entry', () => {
  it('TC-01: returns true for a fully valid entry', () => {
    expect(isRawQueueEntry(VALID_ENTRY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule (a): non-null object check
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — (a) non-null object check', () => {
  it('TC-02: returns false for null', () => {
    expect(isRawQueueEntry(null)).toBe(false);
  });

  it('TC-03: returns false for a primitive string', () => {
    expect(isRawQueueEntry('not-an-object')).toBe(false);
  });

  it('TC-04: returns false for a number', () => {
    expect(isRawQueueEntry(42)).toBe(false);
  });

  it('TC-05: returns false for undefined', () => {
    expect(isRawQueueEntry(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule (b): string id
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — (b) string id', () => {
  it('TC-06: returns false when id is missing', () => {
    const { id: _removed, ...entry } = VALID_ENTRY;
    expect(isRawQueueEntry(entry)).toBe(false);
  });

  it('TC-07: returns false when id is a number', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, id: 99 })).toBe(false);
  });

  it('TC-18: returns false when id is an empty string', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, id: '' })).toBe(false);
  });

  it('TC-19: returns false when id is whitespace-only', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, id: '   ' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule (c): positive integer pid
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — (c) positive integer pid', () => {
  it('TC-08: returns false when pid is zero', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, pid: 0 })).toBe(false);
  });

  it('TC-09: returns false when pid is negative', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, pid: -1 })).toBe(false);
  });

  it('TC-10: returns false when pid is a float', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, pid: 1.5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule (d): string planPath
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — (d) string planPath', () => {
  it('TC-11: returns false when planPath is missing', () => {
    const { planPath: _removed, ...entry } = VALID_ENTRY;
    expect(isRawQueueEntry(entry)).toBe(false);
  });

  it('TC-12: returns false when planPath is null', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, planPath: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule (e): non-empty non-whitespace expectedSlug and string startedAt
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — (e) expectedSlug and startedAt', () => {
  it('TC-13: returns false when expectedSlug is an empty string', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, expectedSlug: '' })).toBe(false);
  });

  it('TC-14: returns false when expectedSlug is whitespace-only', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, expectedSlug: '   ' })).toBe(false);
  });

  it('TC-15: returns false when expectedSlug is missing', () => {
    const { expectedSlug: _removed, ...entry } = VALID_ENTRY;
    expect(isRawQueueEntry(entry)).toBe(false);
  });

  it('TC-16: returns false when startedAt is missing', () => {
    const { startedAt: _removed, ...entry } = VALID_ENTRY;
    expect(isRawQueueEntry(entry)).toBe(false);
  });

  it('TC-17: returns false when startedAt is a number', () => {
    expect(isRawQueueEntry({ ...VALID_ENTRY, startedAt: 1234567890 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// expectedRepo normalization — WP-004
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — expectedRepo normalization', () => {
  it('TC-20: returns true and normalizes missing expectedRepo to null (legacy entry)', () => {
    const entry = { ...VALID_ENTRY };
    expect(isRawQueueEntry(entry)).toBe(true);
    // After the guard runs, expectedRepo must be null (not undefined).
    expect((entry as Record<string, unknown>)['expectedRepo']).toBe(null);
  });

  it('TC-21: returns true when expectedRepo is a string (new entry)', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: 'my-repo' };
    expect(isRawQueueEntry(entry)).toBe(true);
    expect(entry.expectedRepo).toBe('my-repo');
  });

  it('TC-22: returns true when expectedRepo is explicitly null', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: null };
    expect(isRawQueueEntry(entry)).toBe(true);
    expect(entry.expectedRepo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// expectedRepo empty-string normalization — this plan AC-1
// ---------------------------------------------------------------------------

describe('isRawQueueEntry — expectedRepo empty-string normalization (this plan AC-1)', () => {
  it('TC-26: returns true and normalizes empty-string expectedRepo to null', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: '' } as Record<string, unknown>;
    expect(isRawQueueEntry(entry)).toBe(true);
    expect(entry['expectedRepo']).toBeNull();
  });

  it('TC-27: returns true and normalizes whitespace-only expectedRepo to null', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: '   ' } as Record<string, unknown>;
    expect(isRawQueueEntry(entry)).toBe(true);
    expect(entry['expectedRepo']).toBeNull();
  });
});

describe('normalizeQueueEntry — expectedRepo', () => {
  it('TC-23: leaves expectedRepo unchanged when it is a string', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: 'my-repo' };
    const result = normalizeQueueEntry(entry);
    expect(result.expectedRepo).toBe('my-repo');
  });

  it('TC-24: leaves expectedRepo unchanged when it is null', () => {
    const entry = { ...VALID_ENTRY, expectedRepo: null };
    const result = normalizeQueueEntry(entry);
    expect(result.expectedRepo).toBeNull();
  });

  it('TC-25: normalizes undefined expectedRepo to null (legacy entry coercion)', () => {
    // Force an entry that bypasses the type system to simulate a legacy JSON object.
    const legacyEntry = { ...VALID_ENTRY, expectedRepo: undefined } as unknown as
      import('../../../src/gui/queue/types.js').RawQueueEntry;
    const result = normalizeQueueEntry(legacyEntry);
    expect(result.expectedRepo).toBeNull();
  });
});
