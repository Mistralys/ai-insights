/**
 * Tests for describeZodIssues() in src/gui/errors.ts (WP-005)
 *
 * Verifies:
 *   AC-07: the first issue's path and message are rendered, joined with '.'.
 *   AC-08: no rendered message ever echoes the received value — including
 *          for the three value-echoing issue codes — and a trailing
 *          "(and N more)" suffix is appended once more than one issue
 *          is present.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { describeZodIssues } from '../../src/gui/errors.js';

describe('describeZodIssues()', () => {
  it('renders the root path as "body" when the issue path is empty', () => {
    const result = z.object({ name: z.string() }).strict().safeParse('not an object');
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = describeZodIssues(result.error.issues);
    expect(message.startsWith('body:')).toBe(true);
  });

  it('joins a nested issue path with "."', () => {
    const schema = z.object({
      retry: z.object({
        max_attempts: z.number(),
      }),
    });
    const result = schema.safeParse({ retry: { max_attempts: 'not-a-number' } });
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = describeZodIssues(result.error.issues);
    expect(message.startsWith('retry.max_attempts:')).toBe(true);
  });

  it('describes only the first issue and appends an "(and N more)" suffix for the rest', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
    });
    const result = schema.safeParse({ a: 1, b: 2, c: 3 });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.length).toBeGreaterThan(1);
    const message = describeZodIssues(result.error.issues);
    expect(message).toMatch(/\(and \d+ more\)$/);
    expect(message.startsWith('a:')).toBe(true);
  });

  it('omits the "(and N more)" suffix when there is only one issue', () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 42 });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toHaveLength(1);
    const message = describeZodIssues(result.error.issues);
    expect(message).not.toMatch(/and \d+ more/);
  });

  it('uses a fixed, value-free message for invalid_enum_value and never echoes the received value', () => {
    const schema = z.object({ mode: z.enum(['a', 'b', 'c']) });
    const result = schema.safeParse({ mode: 'super-secret-value' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]?.code).toBe('invalid_enum_value');
    const message = describeZodIssues(result.error.issues);
    expect(message).not.toContain('super-secret-value');
    expect(message.startsWith('mode:')).toBe(true);
  });

  it('uses a fixed, value-free message for invalid_literal and never echoes the received value', () => {
    const schema = z.object({ kind: z.literal('expected-kind') });
    const result = schema.safeParse({ kind: 'another-secret-value' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]?.code).toBe('invalid_literal');
    const message = describeZodIssues(result.error.issues);
    expect(message).not.toContain('another-secret-value');
  });

  it('uses a fixed, value-free message for invalid_union_discriminator and never echoes the received value', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), value: z.number() }),
    ]);
    const result = schema.safeParse({ type: 'leaked-secret-value', value: 'x' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]?.code).toBe('invalid_union_discriminator');
    const message = describeZodIssues(result.error.issues);
    expect(message).not.toContain('leaked-secret-value');
  });

  it('never includes a received secret field value for a plain type mismatch', () => {
    const schema = z.object({ api_key: z.string() });
    const result = schema.safeParse({ api_key: { leaked: 'sk-very-secret-token' } });
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = describeZodIssues(result.error.issues);
    expect(message).not.toContain('sk-very-secret-token');
    expect(message.startsWith('api_key:')).toBe(true);
  });

  it('respects a custom rootLabel option', () => {
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = describeZodIssues(result.error.issues, { rootLabel: 'request' });
    expect(message.startsWith('request:')).toBe(true);
  });

  it("returns a fallback message for an empty issues array", () => {
    expect(describeZodIssues([])).toBe('Invalid request.');
  });
});
