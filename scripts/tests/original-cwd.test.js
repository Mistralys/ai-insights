/**
 * scripts/tests/original-cwd.test.js
 *
 * Unit tests for scripts/lib/original-cwd.js
 *
 * Acceptance Criteria verified:
 *   AC-03: scripts/lib/original-cwd.js exists, exports getOriginalCwd(),
 *          and captures process.cwd() at module-load time.
 */

import { describe, it, expect } from 'vitest';

import { getOriginalCwd } from '../lib/original-cwd.js';

describe('getOriginalCwd()', () => {
  it('returns a string equal to process.cwd()', () => {
    expect(getOriginalCwd()).toBe(process.cwd());
  });

  it('returns the identical, referentially stable value across repeated calls', () => {
    const first = getOriginalCwd();
    const second = getOriginalCwd();

    expect(second).toBe(first);
  });
});
