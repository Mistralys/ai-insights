/**
 * Tests for src/gui/queue/compute-effective-status.ts — WP-004
 *
 * Verifies:
 *   AC-1: alive + JSONL stage_start + no project → 'started'.
 *   AC-2: alive + JSONL run_start only + no project → 'pending'.
 *   AC-3: dead + JSONL stage_start + no project → 'dead'.
 *   AC-4: default hasLogActivity=false matches pre-WP-004 behavior (safe for kill/dismiss).
 *   (Backward-compat: project exists always wins regardless of hasLogActivity.)
 */

import { describe, it, expect } from 'vitest';
import {
  computeEffectiveStatus,
  type EffectiveStatus,
} from '../../../src/gui/queue/compute-effective-status.js';

// ---------------------------------------------------------------------------
// AC-1: alive + stage activity + no project → 'started'
// ---------------------------------------------------------------------------

describe('computeEffectiveStatus — AC-1: alive + stage activity + no project', () => {
  it('returns "started" when process is alive, log has stage activity, and no project', () => {
    const result: EffectiveStatus = computeEffectiveStatus(
      /* alive */          true,
      /* projectExists */  false,
      /* hasLogActivity */ true,
    );
    expect(result).toBe('started');
  });
});

// ---------------------------------------------------------------------------
// AC-2: alive + run_start only + no project → 'pending'
// ---------------------------------------------------------------------------

describe('computeEffectiveStatus — AC-2: alive + no stage activity + no project', () => {
  it('returns "pending" when process is alive but log has only run_start (no stage activity)', () => {
    const result: EffectiveStatus = computeEffectiveStatus(
      /* alive */          true,
      /* projectExists */  false,
      /* hasLogActivity */ false,
    );
    expect(result).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// AC-3: dead + stage activity + no project → 'dead'
// ---------------------------------------------------------------------------

describe('computeEffectiveStatus — AC-3: dead + stage activity + no project', () => {
  it('returns "dead" when process is dead even if log has stage activity and no project', () => {
    const result: EffectiveStatus = computeEffectiveStatus(
      /* alive */          false,
      /* projectExists */  false,
      /* hasLogActivity */ true,
    );
    expect(result).toBe('dead');
  });
});

// ---------------------------------------------------------------------------
// AC-4: default hasLogActivity = false (backward-compatible for kill/dismiss)
// ---------------------------------------------------------------------------

describe('computeEffectiveStatus — AC-4: default hasLogActivity=false', () => {
  it('returns "pending" when called with two args (alive + no project) — default is false', () => {
    const result: EffectiveStatus = computeEffectiveStatus(true, false);
    expect(result).toBe('pending');
  });

  it('returns "dead" when called with two args (dead + no project) — default is false', () => {
    const result: EffectiveStatus = computeEffectiveStatus(false, false);
    expect(result).toBe('dead');
  });
});

// ---------------------------------------------------------------------------
// Backward-compat: projectExists always wins
// ---------------------------------------------------------------------------

describe('computeEffectiveStatus — projectExists always wins', () => {
  it('returns "started" when project exists, regardless of alive/hasLogActivity', () => {
    expect(computeEffectiveStatus(false, true, false)).toBe('started');
    expect(computeEffectiveStatus(true,  true, false)).toBe('started');
    expect(computeEffectiveStatus(true,  true, true)).toBe('started');
    expect(computeEffectiveStatus(false, true, true)).toBe('started');
  });
});
