import { describe, it, expect } from 'vitest';
import { SLUG_REGEX } from '../../src/schema/common.js';
import { SLUG_REGEX as SLUG_REGEX_FROM_KNOWLEDGE } from '../../src/schema/knowledge.js';

describe('schema/common — SLUG_REGEX', () => {
  it('is exported from schema/common.ts', () => {
    expect(SLUG_REGEX).toBeInstanceOf(RegExp);
  });

  it('is re-exported from schema/knowledge.ts (backward compat)', () => {
    // Both references must point to the same regex value
    expect(SLUG_REGEX_FROM_KNOWLEDGE.source).toBe(SLUG_REGEX.source);
    expect(SLUG_REGEX_FROM_KNOWLEDGE.flags).toBe(SLUG_REGEX.flags);
  });

  it('accepts valid slugs', () => {
    const valid = [
      'my-store',
      'ai-insights',
      'repo123',
      'A1',
      'underscore_ok',
      'mix-of_both-123',
    ];
    for (const slug of valid) {
      expect(SLUG_REGEX.test(slug), `expected "${slug}" to match`).toBe(true);
    }
  });

  it('rejects invalid slugs', () => {
    const invalid = [
      '',            // empty
      '-leading',    // starts with hyphen
      '_leading',    // starts with underscore
      'with space',  // space
      'has/slash',   // forward slash
      'has\\back',   // backslash
      'dot.in.it',   // dots
      '../traversal',// path traversal
    ];
    for (const slug of invalid) {
      expect(SLUG_REGEX.test(slug), `expected "${slug}" to not match`).toBe(false);
    }
  });
});
