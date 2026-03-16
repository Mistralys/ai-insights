import { describe, it, expect } from 'vitest';
import {
  getDownstreamTypes,
  getUpstreamTypes,
  resolvePrerequisite,
  resolveNextAgent,
  resolveFailAgent,
  describePipelineTypes,
  describePipelineAgents,
  PIPELINE_TYPES,
  PIPELINE_AGENT_MAP,
  type PipelineType,
} from '../../src/utils/pipeline-maps.js';

const ALL_6: readonly PipelineType[] = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];
const LEGACY_4: readonly PipelineType[] = ['implementation', 'qa', 'code-review', 'documentation'];

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

  it('respects active-stages filter — omits qa when not active', () => {
    const active: readonly PipelineType[] = ['implementation', 'code-review', 'documentation'];
    expect(getUpstreamTypes('code-review', active)).toEqual(['implementation']);
  });

  it('respects active-stages filter — all-6 composition', () => {
    expect(getUpstreamTypes('code-review', ALL_6)).toEqual(['implementation', 'qa', 'security-audit']);
  });
});

// ─── getDownstreamTypes — active-stages filter ───────────────────────────────

describe('getDownstreamTypes — active-stages filter', () => {
  it('defaults to legacy 4-stage behaviour when no activeStages passed', () => {
    expect(getDownstreamTypes('implementation')).toEqual(['qa', 'code-review', 'documentation']);
  });

  it('filters to only active stages — skips security-audit', () => {
    expect(getDownstreamTypes('qa', LEGACY_4)).toEqual(['code-review', 'documentation']);
  });

  it('returns all 5 downstream for implementation in all-6 composition', () => {
    expect(getDownstreamTypes('implementation', ALL_6)).toEqual([
      'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation',
    ]);
  });

  it('returns [] for a stage not present in activeStages', () => {
    expect(getDownstreamTypes('security-audit', LEGACY_4)).toEqual([]);
  });

  it('returns [] for last active stage', () => {
    expect(getDownstreamTypes('documentation', ALL_6)).toEqual([]);
  });
});

// ─── resolvePrerequisite ─────────────────────────────────────────────────────

describe('resolvePrerequisite', () => {
  it('returns null for implementation (first stage, legacy-4)', () => {
    expect(resolvePrerequisite('implementation')).toBeNull();
  });

  it('returns implementation for qa (legacy-4)', () => {
    expect(resolvePrerequisite('qa')).toBe('implementation');
  });

  it('returns qa for code-review (legacy-4)', () => {
    expect(resolvePrerequisite('code-review')).toBe('qa');
  });

  it('returns code-review for documentation (legacy-4)', () => {
    expect(resolvePrerequisite('documentation')).toBe('code-review');
  });

  it('computes correct prerequisite in all-6 composition', () => {
    expect(resolvePrerequisite('security-audit', ALL_6)).toBe('qa');
    expect(resolvePrerequisite('code-review', ALL_6)).toBe('security-audit');
    expect(resolvePrerequisite('release-engineering', ALL_6)).toBe('code-review');
    expect(resolvePrerequisite('documentation', ALL_6)).toBe('release-engineering');
  });

  it('returns null for stage not in activeStages', () => {
    expect(resolvePrerequisite('security-audit', LEGACY_4)).toBeNull();
  });

  it('documentation-only composition: first stage has no prerequisite', () => {
    expect(resolvePrerequisite('documentation', ['documentation'])).toBeNull();
  });

  it('verify-only (qa + code-review) composition', () => {
    const stages: readonly PipelineType[] = ['qa', 'code-review'];
    expect(resolvePrerequisite('qa', stages)).toBeNull();
    expect(resolvePrerequisite('code-review', stages)).toBe('qa');
  });
});

// ─── resolveNextAgent ────────────────────────────────────────────────────────

describe('resolveNextAgent', () => {
  it('returns QA for implementation (legacy-4)', () => {
    expect(resolveNextAgent('implementation')).toBe('QA');
  });

  it('returns Reviewer for qa (legacy-4 — skips security-audit)', () => {
    expect(resolveNextAgent('qa')).toBe('Reviewer');
  });

  it('returns Documentation for code-review (legacy-4 — skips release-engineering)', () => {
    expect(resolveNextAgent('code-review')).toBe('Documentation');
  });

  it('returns Synthesis for documentation (last stage, legacy-4)', () => {
    expect(resolveNextAgent('documentation')).toBe('Synthesis');
  });

  it('returns correct agent in all-6 composition', () => {
    expect(resolveNextAgent('implementation', ALL_6)).toBe('QA');
    expect(resolveNextAgent('qa', ALL_6)).toBe('Security Auditor');
    expect(resolveNextAgent('security-audit', ALL_6)).toBe('Reviewer');
    expect(resolveNextAgent('code-review', ALL_6)).toBe('Release Engineer');
    expect(resolveNextAgent('release-engineering', ALL_6)).toBe('Documentation');
    expect(resolveNextAgent('documentation', ALL_6)).toBe('Synthesis');
  });

  it('documentation-only composition: returns Synthesis', () => {
    expect(resolveNextAgent('documentation', ['documentation'])).toBe('Synthesis');
  });

  it('single-stage (implementation only): returns Synthesis', () => {
    expect(resolveNextAgent('implementation', ['implementation'])).toBe('Synthesis');
  });

  it('verification-only (qa + code-review): qa next is Reviewer', () => {
    const stages: readonly PipelineType[] = ['qa', 'code-review'];
    expect(resolveNextAgent('qa', stages)).toBe('Reviewer');
    expect(resolveNextAgent('code-review', stages)).toBe('Synthesis');
  });
});

// ─── resolveFailAgent ────────────────────────────────────────────────────────

describe('resolveFailAgent', () => {
  it('routes implementation → Developer (legacy-4)', () => {
    expect(resolveFailAgent('implementation')).toBe('Developer');
  });

  it('routes qa → Developer (implementation is active, legacy-4)', () => {
    expect(resolveFailAgent('qa')).toBe('Developer');
  });

  it('routes security-audit → Developer (implementation active, all-6)', () => {
    expect(resolveFailAgent('security-audit', ALL_6)).toBe('Developer');
  });

  it('routes code-review → Developer (implementation active, legacy-4)', () => {
    expect(resolveFailAgent('code-review')).toBe('Developer');
  });

  it('routes release-engineering → Release Engineer (self-rework, all-6)', () => {
    expect(resolveFailAgent('release-engineering', ALL_6)).toBe('Release Engineer');
  });

  it('routes documentation → Documentation (self-rework, legacy-4)', () => {
    expect(resolveFailAgent('documentation')).toBe('Documentation');
  });

  it('applies fallback when Developer stage (implementation) is absent', () => {
    // WP has only qa + code-review (no implementation stage)
    const stages: readonly PipelineType[] = ['qa', 'code-review'];
    // Standard fail target for qa is Developer (owns implementation), but
    // implementation is not in activeStages → fallback to first active stage's agent (QA).
    expect(resolveFailAgent('qa', stages)).toBe('QA');
  });

  it('applies fallback for code-review when implementation is absent', () => {
    const stages: readonly PipelineType[] = ['code-review', 'documentation'];
    expect(resolveFailAgent('code-review', stages)).toBe('Reviewer');
  });

  it('no fallback needed when implementation is present (qa fail → Developer)', () => {
    const stages: readonly PipelineType[] = ['implementation', 'qa'];
    expect(resolveFailAgent('qa', stages)).toBe('Developer');
  });
});

// ─── describePipelineTypes (drift-detection) ────────────────────────────────
// Ensures the helper stays in sync with PIPELINE_TYPES so future additions
// propagate automatically to all MCP JSON Schema annotations (Constraint 68).

describe('describePipelineTypes', () => {
  it('output starts with the provided prefix', () => {
    const result = describePipelineTypes('Pipeline type:');
    expect(result.startsWith('Pipeline type:')).toBe(true);
  });

  it('output contains every entry in PIPELINE_TYPES as a quoted value', () => {
    const result = describePipelineTypes('Test:');
    for (const type of PIPELINE_TYPES) {
      expect(result).toContain(`"${type}"`);
    }
  });

  it('output format is stable — quoted, comma-separated values after prefix', () => {
    const expected = `Test: ${PIPELINE_TYPES.map((t) => `"${t}"`).join(', ')}`;
    expect(describePipelineTypes('Test:')).toBe(expected);
  });

  it('different prefixes produce different output strings', () => {
    expect(describePipelineTypes('A:')).not.toBe(describePipelineTypes('B:'));
  });
});

// ─── describePipelineAgents (drift-detection) ─────────────────────────────────
// Ensures the helper stays in sync with PIPELINE_AGENT_MAP / PIPELINE_TYPES so
// future role additions propagate automatically to all agent_role annotations.

describe('describePipelineAgents', () => {
  it('output starts with the provided prefix', () => {
    const result = describePipelineAgents('Your agent role:');
    expect(result.startsWith('Your agent role:')).toBe(true);
  });

  it('output contains every pipeline agent from PIPELINE_AGENT_MAP as a quoted value', () => {
    const result = describePipelineAgents('Test:');
    for (const type of PIPELINE_TYPES) {
      expect(result).toContain(`"${PIPELINE_AGENT_MAP[type]}"`);
    }
  });

  it('output format is stable — each agent quoted with its pipeline type, PM override appended', () => {
    const mappings = PIPELINE_TYPES.map((t) => `"${PIPELINE_AGENT_MAP[t]}" for ${t}`).join(', ');
    const expected = `Test: ${mappings}. "Project Manager" is always allowed (PM Override).`;
    expect(describePipelineAgents('Test:')).toBe(expected);
  });

  it('different prefixes produce different output strings', () => {
    expect(describePipelineAgents('A:')).not.toBe(describePipelineAgents('B:'));
  });
});
