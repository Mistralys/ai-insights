/**
 * Route Table Structure Tests
 *
 * WP-005: Validates the structural invariants of the unified route table
 * returned by `getRouteDescriptors()` in gui/server.ts to prevent regressions when
 * adding future routes.
 *
 * Invariants verified:
 *  1. Every route entry has a `method` value from the set {GET, POST, PUT, PATCH, DELETE}.
 *  2. Every RegExp route uses only named capture groups — no positional (unnamed) groups.
 *  3. No two routes share the same `method + path` combination (exact string or RegExp source).
 */

import { describe, it, expect } from 'vitest';

import { getRouteDescriptors, HttpMethod } from '../../gui/server.js';

// ---------------------------------------------------------------------------
// Fixture: route table obtained via the zero-argument factory — no dummy args
// ---------------------------------------------------------------------------

const routes = getRouteDescriptors();

// ---------------------------------------------------------------------------
// Helper: extract the "path key" used for duplicate detection
// ---------------------------------------------------------------------------

function pathKey(path: string | RegExp): string {
  return typeof path === 'string' ? path : path.source;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getRouteDescriptors() — route table structural invariants', () => {

  it('returns a non-empty array', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every route has a valid HTTP method (GET, POST, PUT, PATCH, DELETE)', () => {
    // The HttpMethod union type in server.ts enforces this constraint at compile
    // time. This runtime test serves as defense-in-depth — it guards against
    // future changes that might accidentally widen the type or cast around it.
    const VALID_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

    const violations = routes.filter(
      (route) => !VALID_METHODS.has(route.method),
    );

    expect(violations).toEqual([]);
  });

  it('every RegExp route uses only named capture groups — no positional (unnamed) groups', () => {
    /**
     * A positional (unnamed) capture group is an opening parenthesis `(` that is
     * NOT followed by either:
     *   - `?:` — non-capturing group
     *   - `?<` — named capture group
     *   - `?=` — positive lookahead
     *   - `?!` — negative lookahead
     *   - `?<=` — positive lookbehind
     *   - `?<!` — negative lookbehind
     *
     * The regex below detects any `(` that does NOT start one of the above
     * special-group syntaxes (i.e., it is a plain capturing group).
     */
    const POSITIONAL_GROUP_RE = /\((?!\?)/;

    const violations = routes.filter((route) => {
      if (typeof route.path !== 'object') return false;   // skip string routes
      return POSITIONAL_GROUP_RE.test(route.path.source);
    });

    const violatingPatterns = violations.map((r) => ({
      method: r.method,
      source: (r.path as RegExp).source,
    }));

    expect(violatingPatterns).toEqual([]);
  });

  it('no two routes share the same method + path combination', () => {
    const seen = new Map<string, number>();   // key → first index
    const duplicates: Array<{ index: number; method: string; path: string }> = [];

    routes.forEach((route, idx) => {
      const key = `${route.method} ${pathKey(route.path)}`;
      if (seen.has(key)) {
        duplicates.push({ index: idx, method: route.method, path: pathKey(route.path) });
      } else {
        seen.set(key, idx);
      }
    });

    expect(duplicates).toEqual([]);
  });

});
