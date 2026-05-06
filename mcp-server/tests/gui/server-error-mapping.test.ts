/**
 * apiErrorToStatus() mapping tests for gui/server.ts (WP-006)
 *
 * Verifies:
 *   AC-1: apiErrorToStatus('CONFLICT') returns 409.
 *   AC-2: CONFLICT errors are not silently swallowed by the default 500 branch.
 */

import { describe, it, expect } from 'vitest';
import { apiErrorToStatus } from '../../gui/server.js';

describe('apiErrorToStatus()', () => {
  it("returns 404 for 'NOT_FOUND'", () => {
    expect(apiErrorToStatus('NOT_FOUND')).toBe(404);
  });

  it("returns 403 for 'FORBIDDEN'", () => {
    expect(apiErrorToStatus('FORBIDDEN')).toBe(403);
  });

  it("returns 400 for 'VALIDATION_ERROR'", () => {
    expect(apiErrorToStatus('VALIDATION_ERROR')).toBe(400);
  });

  it("returns 409 for 'CONFLICT' (not 500)", () => {
    expect(apiErrorToStatus('CONFLICT')).toBe(409);
  });

  it('returns 500 for an unknown error code', () => {
    expect(apiErrorToStatus('UNKNOWN_CODE')).toBe(500);
  });
});
