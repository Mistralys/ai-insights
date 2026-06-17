/**
 * scripts/tests/health-checks.test.js
 *
 * Unit tests for scripts/lib/health-checks.js
 *
 * Acceptance Criteria verified:
 *   AC-1: HEALTH_CHECKS contains exactly 9 entries; each has id, label, cost, detect.
 *   AC-2: All instant-tier detect() functions return a plain boolean (no Promise).
 *   AC-2b: All fast-tier detect() functions return a plain boolean (no Promise).
 *   AC-3: runChecks('instant') excludes slow checks and resolves correctly.
 *   AC-4: runChecks('all') includes and awaits async slow checks.
 *   AC-6: personas-deployed check is NOT in HEALTH_CHECKS.
 *
 * Convention: Do NOT add checks for sibling-repo build artefacts (e.g. ../ai-persona-builder/dist).
 * Local symlinks are a development-time convenience only and must not be modelled as workspace
 * health requirements. @mistralys/persona-builder is an npm dependency; its build state is
 * irrelevant once published.
 */

import { describe, it, expect } from 'vitest';
import { HEALTH_CHECKS, runChecks } from '../lib/health-checks.js';

// ─── AC-1: Registry shape ─────────────────────────────────────────────────────

describe('HEALTH_CHECKS registry', () => {
  it('contains exactly 9 entries', () => {
    expect(HEALTH_CHECKS).toHaveLength(9);
  });

  it('every entry has id, label, cost, and detect fields', () => {
    for (const check of HEALTH_CHECKS) {
      expect(typeof check.id,     `${check.id}.id`).toBe('string');
      expect(typeof check.label,  `${check.id}.label`).toBe('string');
      expect(typeof check.cost,   `${check.id}.cost`).toBe('string');
      expect(typeof check.detect, `${check.id}.detect`).toBe('function');
    }
  });

  it('every cost field is one of the allowed tier values', () => {
    const allowed = new Set(['instant', 'fast', 'slow']);
    for (const check of HEALTH_CHECKS) {
      expect(allowed.has(check.cost), `${check.id}.cost = "${check.cost}"`).toBe(true);
    }
  });

  it('contains all 9 expected ids in any order', () => {
    const expected = [
      'mcp-dist',
      'orchestrator-venv',
      'hooks-installed',
      'node-version',
      'global-mcp-registered',
      'mcp-dist-fresh',
      'personas-deps-fresh',
      'mcp-deps-fresh',
      'personas-fresh',
    ];
    const actual = HEALTH_CHECKS.map(c => c.id);
    for (const id of expected) {
      expect(actual, `expected id "${id}" to be present`).toContain(id);
    }
  });
});

// ─── AC-2: instant-tier detect() returns plain boolean ───────────────────────

describe('instant-tier detect() functions', () => {
  it('return a plain boolean (not a Promise)', () => {
    const instantChecks = HEALTH_CHECKS.filter(c => c.cost === 'instant');
    expect(instantChecks.length).toBeGreaterThan(0);
    for (const check of instantChecks) {
      const result = check.detect();
      expect(result, `${check.id}.detect() returned Promise`).not.toBeInstanceOf(Promise);
      expect(typeof result, `${check.id}.detect() type`).toBe('boolean');
    }
  });
});

// ─── AC-2b: fast-tier detect() returns plain boolean ─────────────────────────

describe('fast-tier detect() functions', () => {
  it('return a plain boolean (not a Promise)', () => {
    const fastChecks = HEALTH_CHECKS.filter(c => c.cost === 'fast');
    expect(fastChecks.length).toBeGreaterThan(0);
    for (const check of fastChecks) {
      const result = check.detect();
      expect(result, `${check.id}.detect() returned Promise`).not.toBeInstanceOf(Promise);
      expect(typeof result, `${check.id}.detect() type`).toBe('boolean');
    }
  });
});

// ─── AC-3: runChecks('instant') excludes slow checks ─────────────────────────

describe("runChecks('instant')", () => {
  it('excludes slow-tier checks from results', async () => {
    const results = await runChecks('instant');
    const slowIds = HEALTH_CHECKS.filter(c => c.cost === 'slow').map(c => c.id);
    const resultIds = results.map(r => r.id);
    for (const id of slowIds) {
      expect(resultIds, `slow check "${id}" should not appear`).not.toContain(id);
    }
  });

  it('returns exactly the instant-tier entries', async () => {
    const instantChecks = HEALTH_CHECKS.filter(c => c.cost === 'instant');
    const results = await runChecks('instant');
    expect(results).toHaveLength(instantChecks.length);
  });

  it('returns results with id, label, and boolean passed fields', async () => {
    const results = await runChecks('instant');
    for (const r of results) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.label).toBe('string');
      expect(typeof r.passed).toBe('boolean');
    }
  });
});

// ─── runChecks('fast') ────────────────────────────────────────────────────────

describe("runChecks('fast')", () => {
  it('returns instant + fast checks (excludes slow)', async () => {
    const results = await runChecks('fast');
    const expected = HEALTH_CHECKS.filter(c => c.cost === 'instant' || c.cost === 'fast');
    const slowIds = HEALTH_CHECKS.filter(c => c.cost === 'slow').map(c => c.id);
    const resultIds = results.map(r => r.id);
    expect(results).toHaveLength(expected.length);
    for (const id of slowIds) {
      expect(resultIds).not.toContain(id);
    }
  });
});

// ─── AC-4: runChecks('all') awaits slow checks ───────────────────────────────

describe("runChecks('all')", () => {
  it('includes every entry from HEALTH_CHECKS', async () => {
    const results = await runChecks('all');
    expect(results).toHaveLength(HEALTH_CHECKS.length);
  }, 15_000);

  it('resolves with boolean passed for every entry including slow checks', async () => {
    const results = await runChecks('all');
    for (const r of results) {
      expect(typeof r.passed, `${r.id}.passed should be boolean`).toBe('boolean');
    }
  }, 15_000);

  it('includes all slow-tier check ids in the results', async () => {
    const results = await runChecks('all');
    const slowIds = HEALTH_CHECKS.filter(c => c.cost === 'slow').map(c => c.id);
    const resultIds = results.map(r => r.id);
    for (const id of slowIds) {
      expect(resultIds, `slow check "${id}" should appear in 'all' results`).toContain(id);
    }
  }, 15_000);
});

// ─── runChecks('slow') ────────────────────────────────────────────────────────

describe("runChecks('slow')", () => {
  it('returns only slow-tier checks', async () => {
    const results = await runChecks('slow');
    const slowChecks = HEALTH_CHECKS.filter(c => c.cost === 'slow');
    expect(results).toHaveLength(slowChecks.length);
    const resultIds = results.map(r => r.id);
    for (const check of slowChecks) {
      expect(resultIds).toContain(check.id);
    }
  }, 15_000);
});

// ─── runChecks error handling ─────────────────────────────────────────────────

describe('runChecks error handling', () => {
  it('throws on an unknown costFilter', async () => {
    await expect(runChecks('unknown')).rejects.toThrow(/unknown costFilter/i);
  });
});

// ─── AC-6: personas-deployed not included ─────────────────────────────────────

describe('deferred check exclusion', () => {
  it('does NOT contain a personas-deployed entry (explicitly deferred)', () => {
    const ids = HEALTH_CHECKS.map(c => c.id);
    expect(ids).not.toContain('personas-deployed');
  });
});
