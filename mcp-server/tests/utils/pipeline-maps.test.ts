import { describe, it, expect } from 'vitest';
import { getDownstreamTypes, getUpstreamTypes } from '../../src/utils/pipeline-maps.js';

// ─── getDownstreamTypes ─────────────────────────────────────────────────────
// Per §8.4: returns all types that follow the given type in PIPELINE_TYPES order.

describe('getDownstreamTypes', () => {
  it('returns [qa, code-review, documentation] for implementation', () => {
    expect(getDownstreamTypes('implementation')).toEqual(['qa', 'code-review', 'documentation']);
  });

  it('returns [code-review, documentation] for qa', () => {
    expect(getDownstreamTypes('qa')).toEqual(['code-review', 'documentation']);
  });

  it('returns [documentation] for code-review', () => {
    expect(getDownstreamTypes('code-review')).toEqual(['documentation']);
  });

  it('returns [] for documentation (last stage — no downstream)', () => {
    expect(getDownstreamTypes('documentation')).toEqual([]);
  });

  it('returns a new array (not a reference to PIPELINE_TYPES slice)', () => {
    const result = getDownstreamTypes('implementation');
    result.push('implementation' as any);
    // Calling again must return an unaffected fresh array
    expect(getDownstreamTypes('implementation')).toEqual(['qa', 'code-review', 'documentation']);
  });
});

// ─── getUpstreamTypes ───────────────────────────────────────────────────────
// Per §8.5: returns all types that precede the given type in PIPELINE_TYPES order.

describe('getUpstreamTypes', () => {
  it('returns [] for implementation (first stage — no upstream)', () => {
    expect(getUpstreamTypes('implementation')).toEqual([]);
  });

  it('returns [implementation] for qa', () => {
    expect(getUpstreamTypes('qa')).toEqual(['implementation']);
  });

  it('returns [implementation, qa] for code-review', () => {
    expect(getUpstreamTypes('code-review')).toEqual(['implementation', 'qa']);
  });

  it('returns [implementation, qa, code-review] for documentation', () => {
    expect(getUpstreamTypes('documentation')).toEqual(['implementation', 'qa', 'code-review']);
  });

  it('returns a new array (not a reference to PIPELINE_TYPES slice)', () => {
    const result = getUpstreamTypes('documentation');
    result.push('documentation' as any);
    // Calling again must return an unaffected fresh array
    expect(getUpstreamTypes('documentation')).toEqual(['implementation', 'qa', 'code-review']);
  });
});
