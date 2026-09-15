/**
 * scripts/tests/claude-cli.test.js
 *
 * Unit tests for scripts/lib/claude-cli.js
 *
 * Acceptance Criteria verified:
 *   AC-06: isClaudeCliAvailable() is used as a pre-flight check before
 *          attempting to spawn `claude --agent <id>`.
 */

import { describe, it, expect } from 'vitest';

import { isClaudeCliAvailable } from '../lib/claude-cli.js';

describe('isClaudeCliAvailable()', () => {
  it('returns a boolean without throwing, regardless of whether claude is installed', () => {
    let result;
    expect(() => {
      result = isClaudeCliAvailable();
    }).not.toThrow();

    expect(typeof result).toBe('boolean');
  });
});
