import { describe, it, expect } from 'vitest';
import {
  getDownstreamTypes,
  getUpstreamTypes,
  resolvePrerequisite,
  resolveNextAgent,
  resolveFailAgent,
  describePipelineTypes,
  describePipelineAgents,
  firstActiveStage,
  lastActiveStage,
  validateActiveStages,
  findFailRoutingGaps,
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_TYPES,
  PIPELINE_AGENT_MAP,
  FAIL_AGENT_MAP,
  AGENT_PIPELINE_MAP,
  CANONICAL_PIPELINE_ORDERING,
  ARTIFACT_EXPECTED_PIPELINE_TYPES,
  type PipelineType,
  type FailRoutingGap,
} from '../../src/utils/pipeline-maps.js';

const ALL_6: readonly PipelineType[] = ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];
const LEGACY_4: readonly PipelineType[] = ['implementation', 'qa', 'code-review', 'documentation'];

/**
 * Enumerates every non-empty subsequence of CANONICAL_PIPELINE_ORDERING (63 for
 * 6 stages). Since the canonical ordering is fixed, every non-empty subset
 * preserves canonical order by construction — this is exactly the universe of
 * chains validateActiveStages' rules 1-4 accept, used to test Rule 5 exhaustively.
 */
function allNonEmptyCanonicalSubsequences(): PipelineType[][] {
  const n = CANONICAL_PIPELINE_ORDERING.length;
  const result: PipelineType[][] = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: PipelineType[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(CANONICAL_PIPELINE_ORDERING[i]!);
    }
    result.push(subset);
  }
  return result;
}

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

  it('applies fallback when Developer stage (implementation) is absent — legacy chain (pre-v2.6.0)', () => {
    // WP has only qa + code-review (no implementation stage). Since spec v2.6.0,
    // validateActiveStages' Rule 5 rejects this chain for new WPs — it is exercised
    // here only to prove the fallback still routes correctly for WPs that predate
    // the rule and already hold such a chain (§21.63, §9.3.1).
    const stages: readonly PipelineType[] = ['qa', 'code-review'];
    // Standard fail target for qa is Developer (owns implementation), but
    // implementation is not in activeStages → fallback to first active stage's agent (QA).
    expect(resolveFailAgent('qa', stages)).toBe('QA');
  });

  it('applies fallback for code-review when implementation is absent — legacy chain (pre-v2.6.0)', () => {
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
// propagate automatically to all MCP JSON Schema annotations.

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

// ─── firstActiveStage (§6.2.1) ─────────────────────────────────────────────

describe('firstActiveStage', () => {
  it('returns "implementation" for legacy-4 (first in canonical order)', () => {
    expect(firstActiveStage(LEGACY_4)).toBe('implementation');
  });

  it('returns "implementation" for all-6 (first in canonical order)', () => {
    expect(firstActiveStage(['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'])).toBe('implementation');
  });

  it('returns the only stage when a single-stage composition is used', () => {
    expect(firstActiveStage(['documentation'])).toBe('documentation');
  });

  it('respects canonical ordering — returns "qa" for a qa+code-review composition', () => {
    const stages: readonly PipelineType[] = ['qa', 'code-review'];
    expect(firstActiveStage(stages)).toBe('qa');
  });

  it('falls back to DEFAULT_PIPELINE_STAGES[0] when stages is null', () => {
    expect(firstActiveStage(null)).toBe(DEFAULT_PIPELINE_STAGES[0]);
  });

  it('falls back to DEFAULT_PIPELINE_STAGES[0] when stages is undefined', () => {
    expect(firstActiveStage(undefined)).toBe(DEFAULT_PIPELINE_STAGES[0]);
  });

  it('falls back to DEFAULT_PIPELINE_STAGES[0] when stages is an empty array', () => {
    // getOrderedActiveStages([]) returns [] — fallback to DEFAULT_PIPELINE_STAGES
    expect(firstActiveStage([])).toBe(DEFAULT_PIPELINE_STAGES[0]);
  });
});

// ─── lastActiveStage (§6.2.1) ──────────────────────────────────────────────

describe('lastActiveStage', () => {
  it('returns "documentation" for legacy-4 (last in canonical order)', () => {
    expect(lastActiveStage(LEGACY_4)).toBe('documentation');
  });

  it('returns "documentation" for all-6', () => {
    expect(lastActiveStage(['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'])).toBe('documentation');
  });

  it('returns "implementation" for implementation-only composition', () => {
    expect(lastActiveStage(['implementation'])).toBe('implementation');
  });

  it('returns "code-review" for implementation+code-review composition', () => {
    const stages: readonly PipelineType[] = ['implementation', 'code-review'];
    expect(lastActiveStage(stages)).toBe('code-review');
  });

  it('falls back to DEFAULT_PIPELINE_STAGES last when stages is null', () => {
    const last = DEFAULT_PIPELINE_STAGES[DEFAULT_PIPELINE_STAGES.length - 1]!;
    expect(lastActiveStage(null)).toBe(last);
  });

  it('falls back to DEFAULT_PIPELINE_STAGES last when stages is undefined', () => {
    const last = DEFAULT_PIPELINE_STAGES[DEFAULT_PIPELINE_STAGES.length - 1]!;
    expect(lastActiveStage(undefined)).toBe(last);
  });

  it('returns different values from firstActiveStage for multi-stage compositions', () => {
    expect(lastActiveStage(LEGACY_4)).not.toBe(firstActiveStage(LEGACY_4));
  });

  it('returns the same value as firstActiveStage for a single-stage composition', () => {
    expect(lastActiveStage(['qa'])).toBe(firstActiveStage(['qa']));
  });
});

// ─── ARTIFACT_EXPECTED_PIPELINE_TYPES ───────────────────────────────────────

describe('ARTIFACT_EXPECTED_PIPELINE_TYPES', () => {
  it('contains implementation, code-review, release-engineering, documentation', () => {
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('implementation')).toBe(true);
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('code-review')).toBe(true);
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('release-engineering')).toBe(true);
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('documentation')).toBe(true);
  });

  it('does NOT contain verification-only types (qa, security-audit)', () => {
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('qa')).toBe(false);
    expect(ARTIFACT_EXPECTED_PIPELINE_TYPES.has('security-audit')).toBe(false);
  });
});

// ─── validateActiveStages ──────────────────────────────────────────────────

describe('validateActiveStages', () => {
  it('returns no errors for the default 4-stage set', () => {
    const { errors, warnings } = validateActiveStages([...DEFAULT_PIPELINE_STAGES] as string[]);
    expect(errors).toHaveLength(0);
  });

  it('returns no errors for the full 6-stage set', () => {
    const { errors } = validateActiveStages([...PIPELINE_TYPES] as string[]);
    expect(errors).toHaveLength(0);
  });

  it('rejects a 3-stage subset lacking implementation (qa + code-review + documentation) — Rule 5', () => {
    // Since spec v2.6.0, a chain containing qa/code-review without implementation
    // fails fail-route coverage (§9b.2 Rule 5) even with documentation appended.
    const { errors, warnings } = validateActiveStages(['qa', 'code-review', 'documentation']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('implementation');
    expect(errors[0]).toContain('Developer');
    expect(warnings).toHaveLength(0);
  });

  it('accepts a documentation-only chain (self-fixing stage) — Rule 5', () => {
    const { errors } = validateActiveStages(['documentation']);
    expect(errors).toHaveLength(0);
  });

  it('accepts a release-engineering + documentation chain (self-fixing stages only) — Rule 5', () => {
    const { errors } = validateActiveStages(['release-engineering', 'documentation']);
    expect(errors).toHaveLength(0);
  });

  it('accepts implementation + code-review (fix stage present) — Rule 5', () => {
    const { errors } = validateActiveStages(['implementation', 'code-review']);
    expect(errors).toHaveLength(0);
  });

  it('returns error for an empty array', () => {
    const { errors } = validateActiveStages([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cannot be empty');
  });

  it('returns error for an unknown stage name', () => {
    const { errors } = validateActiveStages(['implementation', 'unit-test']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unit-test');
  });

  it('returns error for multiple unknown stage names', () => {
    const { errors } = validateActiveStages(['unknown-a', 'unknown-b']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown-a');
    expect(errors[0]).toContain('unknown-b');
  });

  it('returns error for duplicate stages', () => {
    const { errors } = validateActiveStages(['implementation', 'qa', 'implementation']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate');
    expect(errors[0]).toContain('implementation');
  });

  it('returns error for stages out of canonical order', () => {
    // documentation before implementation — violates canonical ordering
    const { errors } = validateActiveStages(['documentation', 'implementation']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('canonical order');
  });

  it('returns error for reversed canonical ordering', () => {
    const { errors } = validateActiveStages(['code-review', 'qa', 'implementation']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('canonical order');
  });

  it('rejects a verifier chain without its fix stage (qa + code-review) — Rule 5 (AC-01)', () => {
    const { errors, warnings } = validateActiveStages(['qa', 'code-review']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('implementation');
    expect(errors[0]).toContain('Developer');
    expect(errors[0]).toContain('qa');
    expect(errors[0]).toContain('code-review');
    expect(errors[0]).toContain('pipelines.fail_routing');
    expect(warnings).toHaveLength(0);
  });

  it('returns warning for implementation without qa', () => {
    const { errors, warnings } = validateActiveStages(['implementation', 'code-review', 'documentation']);
    expect(errors).toHaveLength(0);
    expect(warnings.some((w) => w.includes('implementation') && w.includes('qa'))).toBe(true);
  });

  it('returns warning for single-stage chain', () => {
    const { errors, warnings } = validateActiveStages(['implementation']);
    expect(errors).toHaveLength(0);
    // Both warnings may fire (implementation without qa + single stage)
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.toLowerCase().includes('single-stage') || w.includes('single'))).toBe(true);
  });

  it('returns both warnings when implementation-only is used', () => {
    const { errors, warnings } = validateActiveStages(['implementation']);
    expect(errors).toHaveLength(0);
    // Should have at least the single-stage warning; may also have the qa warning
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no warnings for the default 4-stage workflow', () => {
    const { warnings } = validateActiveStages([...DEFAULT_PIPELINE_STAGES] as string[]);
    expect(warnings).toHaveLength(0);
  });

  it('returns error (not just warning) before checking for warnings on empty input', () => {
    const { errors, warnings } = validateActiveStages([]);
    expect(errors).toHaveLength(1);
    expect(warnings).toHaveLength(0); // early return before warnings
  });

  it('accepts the standalone-import chain ["implementation"]', () => {
    const { errors } = validateActiveStages(['implementation']);
    expect(errors).toHaveLength(0);
  });
});

// ─── fail-route coverage invariant (§9b.2 Rule 5, AC-02/AC-03) ─────────────
// Exhaustively verifies, against the real manifest, that validateActiveStages'
// acceptance of a chain and resolveFailAgent's fallback-reachability for that
// chain always agree. Uses no stage or role literals — recomputes on every
// manifest edit (fail_routing, canonical order, or role ownership changes).

describe('fail-route coverage invariant', () => {
  const allChains = allNonEmptyCanonicalSubsequences();

  it('accepted ⇔ fallback unreachable for every stage (derived)', () => {
    for (const chain of allChains) {
      const { errors } = validateActiveStages(chain as string[]);
      const accepted = errors.length === 0;

      const fallbackUnreachable = chain.every(
        (stage) => resolveFailAgent(stage, chain) === FAIL_AGENT_MAP[stage]
      );

      expect(accepted).toBe(fallbackUnreachable);
    }
  });

  // Snapshot of today's concrete rejected/accepted split under the current
  // manifest. Unlike the derived invariant above, this case pins the rejected
  // set by name and is EXPECTED TO CHANGE if fail_routing, role ownership, or
  // the canonical order is ever edited — the derived invariant above does not.
  it('snapshot: rejected set under the current manifest (contains a verifier, lacks implementation)', () => {
    const verifierStages: readonly PipelineType[] = ['qa', 'security-audit', 'code-review'];
    let rejectedCount = 0;
    let acceptedCount = 0;

    for (const chain of allChains) {
      const { errors } = validateActiveStages(chain as string[]);
      const expectedRejected = chain.some((s) => verifierStages.includes(s)) && !chain.includes('implementation');

      expect(errors.length > 0).toBe(expectedRejected);
      if (errors.length > 0) rejectedCount++; else acceptedCount++;
    }

    expect(rejectedCount).toBe(28);
    expect(acceptedCount).toBe(35);
  });
});

// ─── findFailRoutingGaps ────────────────────────────────────────────────────

describe('findFailRoutingGaps', () => {
  const allChains = allNonEmptyCanonicalSubsequences();

  it('is derived from manifest maps for every canonical subsequence (AC-04)', () => {
    for (const chain of allChains) {
      const ordered = CANONICAL_PIPELINE_ORDERING.filter((t) => chain.includes(t));
      const expectedGaps: FailRoutingGap[] = [];

      for (let i = 0; i < ordered.length; i++) {
        const stage = ordered[i]!;
        const failAgent = FAIL_AGENT_MAP[stage];
        const fixStage = AGENT_PIPELINE_MAP[failAgent];
        if (fixStage === undefined) continue;
        const activePrefix = ordered.slice(0, i + 1);
        if (!activePrefix.includes(fixStage)) {
          expectedGaps.push({ stage, failAgent, fixStage });
        }
      }

      const actualGaps = findFailRoutingGaps(chain);
      expect(actualGaps).toEqual(expectedGaps);

      for (const gap of actualGaps) {
        expect(gap.failAgent).toBe(FAIL_AGENT_MAP[gap.stage]);
        expect(gap.fixStage).toBe(AGENT_PIPELINE_MAP[gap.failAgent]);
        // Self-routing stages (fixStage === stage) always satisfy the rule trivially
        // and therefore never appear in the gap list.
        expect(gap.fixStage).not.toBe(gap.stage);
      }
    }
  });

  it('is empty for the default 4-stage chain', () => {
    expect(findFailRoutingGaps(DEFAULT_PIPELINE_STAGES)).toHaveLength(0);
  });

  it('is empty for the full 6-stage chain', () => {
    expect(findFailRoutingGaps(PIPELINE_TYPES)).toHaveLength(0);
  });

  it('reports one gap per verifier for ["qa","security-audit","code-review"], each with fixStage "implementation"', () => {
    const gaps = findFailRoutingGaps(['qa', 'security-audit', 'code-review']);
    expect(gaps).toHaveLength(3);
    expect(gaps.map((g) => g.stage)).toEqual(['qa', 'security-audit', 'code-review']);
    for (const gap of gaps) {
      expect(gap.fixStage).toBe('implementation');
    }
  });
});
