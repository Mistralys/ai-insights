import { describe, it, expect } from 'vitest';
import {
  SLUG_REGEX,
  confidenceInput,
  numberInput,
  nonNegativeIntInput,
  positiveIntInput,
} from '../../src/schema/common.js';
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

describe('schema/common — confidenceInput()', () => {
  const schema = confidenceInput();

  it('parses numeric and string-encoded values within [0, 1]', () => {
    expect(schema.parse(0.9)).toBe(0.9);
    expect(schema.parse('0.9')).toBe(0.9);
    expect(schema.parse(' 0.9 ')).toBe(0.9);
    expect(schema.parse(0)).toBe(0);
    expect(schema.parse(1)).toBe(1);
  });

  it('rejects out-of-range, malformed, and non-numeric-typed values', () => {
    for (const input of [5, -0.1, null, true, '', 'abc', {}]) {
      expect(() => schema.parse(input), `expected ${JSON.stringify(input)} to be rejected`).toThrow();
    }
  });
});

describe('schema/common — positiveIntInput() / nonNegativeIntInput()', () => {
  it('positiveIntInput() parses string-encoded positive integers', () => {
    expect(positiveIntInput().parse('5')).toBe(5);
    expect(positiveIntInput().parse(5)).toBe(5);
  });

  it('positiveIntInput() rejects zero, negative, fractional, and malformed values', () => {
    const schema = positiveIntInput();
    for (const input of ['5.5', '-1', '0', 0, null, '']) {
      expect(() => schema.parse(input), `expected ${JSON.stringify(input)} to be rejected`).toThrow();
    }
  });

  it('nonNegativeIntInput() parses "0" as 0 and string-encoded positive integers', () => {
    const schema = nonNegativeIntInput();
    expect(schema.parse('0')).toBe(0);
    expect(schema.parse('5')).toBe(5);
  });

  it('nonNegativeIntInput() rejects negative, fractional, and malformed values', () => {
    const schema = nonNegativeIntInput();
    for (const input of ['5.5', '-1', null, '']) {
      expect(() => schema.parse(input), `expected ${JSON.stringify(input)} to be rejected`).toThrow();
    }
  });
});

describe('schema/common — numberInput()', () => {
  const schema = numberInput();

  it('passes non-string numeric values through untouched', () => {
    expect(schema.parse(5)).toBe(5);
    expect(schema.parse(0)).toBe(0);
    expect(schema.parse(-3.5)).toBe(-3.5);
  });

  it('converts non-empty string values', () => {
    expect(schema.parse('5')).toBe(5);
  });

  it('rejects null and booleans (no fallthrough coercion)', () => {
    for (const input of [null, true, false]) {
      expect(() => schema.parse(input), `expected ${JSON.stringify(input)} to be rejected`).toThrow();
    }
  });
});
