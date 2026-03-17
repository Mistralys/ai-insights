import { describe, it, expect } from 'vitest';
import { checkRevalidationGuard, hasDownstreamFail, hasDownstreamReengagedSince, hasNewUpstreamPassSince, isMostRecentPipelineFail, isActivePipeline, mostRecentEffectivePipeline, isBlockedByDependencies, hasDependencyBlocked, effectiveMaxDepth } from '../../src/utils/workflow-helpers.js';
import type { Pipeline, WorkPackageDetail } from '../../src/schema/work-package.js';
import type { PipelineType } from '../../src/utils/pipeline-maps.js';
import { makePipeline, makeWorkPackageDetail } from '../helpers/fixtures.js';

describe('hasNewUpstreamPassSince', () => {
  describe('upstream PASS not present', () => {
    it('returns false when no pipelines exist', () => {
      expect(hasNewUpstreamPassSince([], 'implementation', 'qa')).toBe(false);
    });

    it('returns false when upstream pipeline exists but its status is FAIL (not PASS)', () => {
      const pipelines = [
        makePipeline('implementation', 'FAIL', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });

    it('returns false when upstream pipeline exists but its status is IN_PROGRESS', () => {
      const pipelines = [
        makePipeline('implementation', 'IN_PROGRESS', '2026-01-01T08:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });
  });

  describe('no downstream pipeline (first run)', () => {
    it('returns true when upstream PASS exists and no downstream exists', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(true);
    });

    it('returns true for QA→code-review with PASS qa and no code-review', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'qa', 'code-review')).toBe(true);
    });
  });

  describe('downstream is up-to-date (upstream PASS before downstream started)', () => {
    it('returns false when upstream completed before downstream started', () => {
      const pipelines = [
        // implementation PASS at 09:00
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // qa started at 10:00 (after implementation)
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });

    it('returns false for qa→code-review when review already covers the qa PASS', () => {
      const pipelines = [
        makePipeline('qa', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('code-review', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'qa', 'code-review')).toBe(false);
    });
  });

  describe('rework cycle (upstream PASS after downstream started)', () => {
    it('returns true when a new implementation PASS is added after a qa PASS (rework cycle)', () => {
      const pipelines = [
        // First implementation PASS (cycle 1)
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // QA passed (started after first impl PASS)
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        // Developer reworks: new implementation PASS at 13:00 (AFTER qa started at 10:00)
        makePipeline('implementation', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(true);
    });

    it('returns true for Reviewer after Developer rework cycle (new impl PASS after code-review started)', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        // code-review started at 12:00
        makePipeline('code-review', 'FAIL', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
        // Developer rework: new qa PASS completed at 14:00 (AFTER code-review started at 12:00)
        makePipeline('qa', 'PASS', '2026-01-01T13:30:00', '2026-01-01T14:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'qa', 'code-review')).toBe(true);
    });
  });

  describe('edge cases with missing timestamps', () => {
    it('returns false when upstream PASS has no completed_at', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS'), // no completed_at
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });

    it('returns false when downstream has no started_at', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'PASS'), // no started_at
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });
  });

  describe('uses most recent upstream PASS', () => {
    it('uses the last PASS pipeline (not the first) for temporal comparison', () => {
      const pipelines = [
        // First impl PASS at 09:00
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // QA started at 10:00 — covers first impl PASS
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        // Second impl (rework) started at 12:00 — the one we should compare against
        // Its completed_at is 13:00, AFTER qa started_at 10:00 → should return true
        makePipeline('implementation', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(true);
    });

    it('uses the last downstream pipeline (not the first) for temporal comparison', () => {
      // Both qa pipelines started before the impl PASS was completed
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // First qa (older)
        makePipeline('qa', 'FAIL', '2026-01-01T06:00:00', '2026-01-01T07:00:00'),
        // Most recent qa started at 10:00 — AFTER impl PASS at 09:00 → up-to-date → false
        makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });
  });

  describe('auto-cancelled exclusion and >= semantics (WP-004)', () => {
    it('returns true when the only downstream pipeline is auto-cancelled (treated as first run)', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // Auto-cancelled downstream — should be excluded, making it a first-run scenario
        { ...makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'), auto_cancelled: true },
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(true);
    });

    it('returns true for coincident timestamps (upstream completed_at === downstream started_at)', () => {
      const ts = '2026-01-01T09:00:00';
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', ts),
        // downstream started exactly when upstream completed — >= comparison should return true
        makePipeline('qa', 'FAIL', ts, '2026-01-01T10:00:00'),
      ];
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(true);
    });

    it('ignores auto-cancelled downstream and uses real downstream for comparison', () => {
      const pipelines = [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        // Auto-cancelled — excluded
        { ...makePipeline('qa', 'FAIL', '2026-01-01T06:00:00', '2026-01-01T07:00:00'), auto_cancelled: true },
        // Real downstream started AFTER impl PASS → up-to-date
        makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ];
      // Real downstream started_at (10:00) is after upstream completed_at (09:00) → false (up-to-date)
      expect(hasNewUpstreamPassSince(pipelines, 'implementation', 'qa')).toBe(false);
    });
  });
});

// ─── hasDownstreamFail (WP-003) ─────────────────────────────────────────────

describe('hasDownstreamFail', () => {
  it('returns false for empty pipeline array', () => {
    expect(hasDownstreamFail([], 'implementation')).toBe(false);
  });

  it('returns false when no downstream pipelines exist', () => {
    const pipelines = [
      makePipeline('implementation', 'PASS'),
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns true when the most recent downstream QA pipeline is FAIL', () => {
    const pipelines = [
      makePipeline('implementation', 'PASS'),
      makePipeline('qa', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(true);
  });

  it('returns false when downstream QA has FAIL then PASS (most recent is PASS)', () => {
    const pipelines = [
      makePipeline('implementation', 'PASS'),
      makePipeline('qa', 'FAIL'),
      makePipeline('qa', 'PASS'),
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns true for multi-hop: review FAIL detected from implementation', () => {
    const pipelines = [
      makePipeline('implementation', 'PASS'),
      makePipeline('qa', 'PASS'),
      makePipeline('code-review', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(true);
  });

  it('returns true for review FAIL detected from qa', () => {
    const pipelines = [
      makePipeline('qa', 'PASS'),
      makePipeline('code-review', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'qa')).toBe(true);
  });

  it('returns true when documentation FAIL is downstream of code-review', () => {
    const pipelines = [
      makePipeline('code-review', 'PASS'),
      makePipeline('documentation', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'code-review')).toBe(true);
  });

  it('returns false when documentation type has no downstream stages', () => {
    const pipelines = [
      makePipeline('documentation', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'documentation')).toBe(false);
  });

  it('returns false when the only downstream FAIL is auto-cancelled', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS'),
      { ...makePipeline('qa', 'FAIL'), auto_cancelled: true },
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns true when auto-cancelled FAIL is followed by a real FAIL', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS'),
      { ...makePipeline('qa', 'FAIL'), auto_cancelled: true },
      makePipeline('qa', 'FAIL'),
    ];
    expect(hasDownstreamFail(pipelines, 'implementation')).toBe(true);
  });
});

// ─── hasDownstreamReengagedSince (WP-005) ──────────────────────────────────

describe('hasDownstreamReengagedSince', () => {
  // §14.13 row 1: impl PASS → qa FAIL (QA started after impl PASS → reengaged)
  it('§14.13 row 1: returns true when QA FAIL started after impl PASS completed', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(true);
  });

  // §14.13 row 2: impl-1 PASS → qa-1 FAIL → impl-2 PASS (no QA since impl-2 PASS)
  it('§14.13 row 2: returns false when impl-2 PASS is newer than any QA activity', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      // impl-2 PASS completed at 14:00 — after qa-1 started at 10:00 → no new qa
      makePipeline('implementation', 'PASS', '2026-01-01T13:00:00', '2026-01-01T14:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(false);
  });

  // §14.13 row 3: impl-2 PASS → qa-2 IN_PROGRESS (still in progress)
  it('§14.13 row 3: returns true when QA started (IN_PROGRESS) after impl PASS', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'IN_PROGRESS', '2026-01-01T10:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(true);
  });

  // §14.13 row 4: impl-2 PASS → qa-2 FAIL (QA restarted and failed again)
  it('§14.13 row 4: returns true when QA FAIL started after impl PASS (second cycle)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // qa-2 started at 14:00 — after impl-2 PASS at 13:00
      makePipeline('qa', 'FAIL', '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(true);
  });

  it('returns false when no upstream PASS exists', () => {
    const pipelines: Pipeline[] = [
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(false);
  });

  it('returns false when upstream PASS has no completed_at', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS'), // no completed_at
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(false);
  });

  it('returns false when the only downstream FAIL is auto-cancelled (§21.27 exclusion)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      { ...makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'), auto_cancelled: true },
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(false);
  });

  it('returns true when code-review (not QA) re-engaged after impl PASS', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      // code-review started at 10:00 (after impl PASS at 09:00)
      makePipeline('code-review', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ];
    expect(hasDownstreamReengagedSince(pipelines, 'implementation')).toBe(true);
  });
});

// ─── isMostRecentPipelineFail (WP-004) ─────────────────────────────────────

describe('isMostRecentPipelineFail', () => {
  it('returns false for empty pipeline array', () => {
    expect(isMostRecentPipelineFail([], 'implementation')).toBe(false);
  });

  it('returns true for a single FAIL pipeline', () => {
    const pipelines = [makePipeline('implementation', 'FAIL')];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(true);
  });

  it('returns false for a single PASS pipeline', () => {
    const pipelines = [makePipeline('implementation', 'PASS')];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns false when sequence is FAIL then PASS (most recent is PASS)', () => {
    const pipelines = [
      makePipeline('implementation', 'FAIL'),
      makePipeline('implementation', 'PASS'),
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns true when sequence is PASS then FAIL (most recent is FAIL)', () => {
    const pipelines = [
      makePipeline('implementation', 'PASS'),
      makePipeline('implementation', 'FAIL'),
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(true);
  });

  it('returns false when the only FAIL is auto-cancelled (excluded from consideration)', () => {
    const pipelines: Pipeline[] = [
      { ...makePipeline('implementation', 'FAIL'), auto_cancelled: true },
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns false when PASS is followed by auto-cancelled FAIL (effective last is PASS)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS'),
      { ...makePipeline('implementation', 'FAIL'), auto_cancelled: true },
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('returns true when auto-cancelled FAIL is followed by real FAIL', () => {
    const pipelines: Pipeline[] = [
      { ...makePipeline('implementation', 'FAIL'), auto_cancelled: true },
      makePipeline('implementation', 'FAIL'),
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(true);
  });

  it('is not affected by pipelines of a different type', () => {
    const pipelines = [
      makePipeline('implementation', 'FAIL'),
      makePipeline('qa', 'PASS'),
    ];
    // Only looking at 'implementation' — which is FAIL
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(true);
    // Only looking at 'qa' — which is PASS
    expect(isMostRecentPipelineFail(pipelines, 'qa')).toBe(false);
  });
});

// ─── checkRevalidationGuard (WP-006) ───────────────────────────────────────────────

describe('checkRevalidationGuard', () => {
  it('returns null on first run (no prior pipeline of current type)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ];
    // No prior qa pipeline — first run, always allowed
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('returns null for self-rework (documentation retry after doc FAIL, no upstream rework)', () => {
    // §11.1.1 example 1: impl PASS → qa PASS → review PASS → doc FAIL → retry doc
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // doc FAIL — this is the baseline run for documentation
      makePipeline('documentation', 'FAIL', '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
      // No new upstream pipeline started after code-review PASS at 13:00 — self-rework
    ];
    // doc retry: prerequisite is code-review (PASS at 13:00), baseline doc started at 14:00
    // prereqCompletedAt (13:00) < baselineStartedAt (14:00) → stale check
    // hasDownstreamFail(code-review) → doc FAIL → true
    // upstreamTypes of documentation = ['implementation', 'qa', 'code-review']
    // None of those started after code-review PASS at 13:00 → self-rework → null
    expect(checkRevalidationGuard(pipelines, 'documentation', 'code-review')).toBeNull();
  });

  it('returns error string for stage-skipping (code-review after upstream rework without QA re-PASS)', () => {
    // §11.1.1 example 2: impl-1 PASS → qa-1 PASS → review-1 FAIL → impl-2 PASS → try code-review
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      // code-review-1 FAIL — baseline run for code-review
      makePipeline('code-review', 'FAIL', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // Developer reworks: impl-2 PASS at 15:00 (AFTER qa PASS at 11:00)
      makePipeline('implementation', 'PASS', '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
    ];
    // code-review retry attempt: prerequisite is qa (PASS at 11:00), baseline started at 12:00
    // prereqCompletedAt (11:00) < baselineStartedAt (12:00) → stale check
    // hasDownstreamFail(qa) → code-review FAIL → true
    // upstreamTypes of code-review = ['implementation', 'qa']
    // impl-2 started at 14:00 > qa PASS completed at 11:00 → upstream reworked → guard fires
    const result = checkRevalidationGuard(pipelines, 'code-review', 'qa');
    expect(result).not.toBeNull();
    expect(result).toContain('code-review');
    expect(result).toContain('qa');
  });

  it('returns null for normal progression (prereq PASS post-dates any prior run)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      // qa started at 10:00 — but NO prior qa run exists, so this is first run
    ];
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('excludes auto-cancelled pipelines from the temporal baseline', () => {
    // The only prior qa run is auto-cancelled — no effective baseline, treat as first run
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      { ...makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'), auto_cancelled: true },
    ];
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('returns null when prereq completed_at is missing (conservative pass)', () => {
    const pipelines: Pipeline[] = [
      // implementation PASS but no completed_at
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00'),
      makePipeline('qa', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ];
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('returns null when baseline started_at is missing (conservative pass)', () => {
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      // qa pipeline with no started_at timestamp
      makePipeline('qa', 'FAIL'),
    ];
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('returns null when impl_pass.completed_at equals qa.started_at (equal-timestamp boundary — L-4)', () => {
    // §11.1 Step 3: prereqCompletedAt >= baselineStartedAt → return null
    // When timestamps are exactly equal, >= is satisfied → guard does NOT fire.
    // Expected: same timestamp counts as "fresh enough" prereq → allow QA to start.
    const sameTimestamp = '2026-01-01T10:00:00';
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', sameTimestamp),
      // qa FAIL with started_at === impl PASS completed_at
      makePipeline('qa', 'FAIL', sameTimestamp, '2026-01-01T11:00:00'),
    ];
    // prereqCompletedAt (10:00) >= baselineStartedAt (10:00) → Step 3 passes → null
    expect(checkRevalidationGuard(pipelines, 'qa', 'implementation')).toBeNull();
  });

  it('fires when security-audit rework occurs after qa PASS (custom activeStages)', () => {
    // Validates the activeStages forwarding fix in checkRevalidationGuard (WP-002, Rework-1).
    // Custom stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation']
    // Scenario: security-audit is re-run after code-review-1 FAIL.
    // Without the fix, getUpstreamTypes('code-review') uses DEFAULT_PIPELINE_STAGES and returns
    // ['implementation', 'qa'], missing 'security-audit' → guard silently skips → bug.
    // With the fix, it returns ['implementation', 'qa', 'security-audit'] → guard fires correctly.
    const customStages: readonly PipelineType[] = ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'];
    const pipelines: Pipeline[] = [
      makePipeline('implementation', 'PASS',    '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS',    '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('security-audit', 'PASS',    '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // code-review-1 FAIL — baseline run
      makePipeline('code-review',    'FAIL',    '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
      // security-audit re-run (rework) at 16:00 — AFTER qa PASS at 11:00
      makePipeline('security-audit', 'PASS',    '2026-01-01T16:00:00', '2026-01-01T17:00:00'),
    ];
    // code-review retry: prereq is qa (PASS at 11:00), baseline started at 14:00
    // prereqCompletedAt (11:00) < baselineStartedAt (14:00) → stale check
    // hasDownstreamFail(qa, customStages) → code-review FAIL → true
    // getUpstreamTypes('code-review', customStages) → ['implementation', 'qa', 'security-audit']
    // security-audit started at 16:00 > qa PASS at 11:00 → upstream reworked → guard fires
    const result = checkRevalidationGuard(pipelines, 'code-review', 'qa', customStages);
    expect(result).not.toBeNull();
    expect(result).toContain('code-review');
    expect(result).toContain('qa');
  });
});
describe('isActivePipeline', () => {
  const STALE_START = '2020-01-01T00:00:00Z'; // definitely > 24h ago
  const FRESH_START = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

  it('(1) returns false when the WP has no pipelines', () => {
    const wp = makeWorkPackageDetail({ pipelines: [] });
    expect(isActivePipeline(wp, 'implementation')).toBe(false);
  });

  it('(2) returns false when the only pipeline is PASS (not IN_PROGRESS)', () => {
    const wp = makeWorkPackageDetail({ pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z'),
    ] });
    expect(isActivePipeline(wp, 'implementation')).toBe(false);
  });

  it('(3) returns true when implementation is IN_PROGRESS and started < 24h ago', () => {
    const wp = makeWorkPackageDetail({ pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', FRESH_START),
    ] });
    expect(isActivePipeline(wp, 'implementation')).toBe(true);
  });

  it('(4) returns false when implementation is IN_PROGRESS but started > 24h ago (stale)', () => {
    const wp = makeWorkPackageDetail({ pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', STALE_START),
    ] });
    expect(isActivePipeline(wp, 'implementation')).toBe(false);
  });

  it('(5) returns false when qa is IN_PROGRESS (non-stale) but queried type is implementation', () => {
    const wp = makeWorkPackageDetail({ pipelines: [
      makePipeline('qa', 'IN_PROGRESS', FRESH_START),
    ] });
    expect(isActivePipeline(wp, 'implementation')).toBe(false);
  });

  it('(6) returns true when two implementation IN_PROGRESS pipelines exist: one stale, one not', () => {
    const wp = makeWorkPackageDetail({ pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', STALE_START),
      makePipeline('implementation', 'IN_PROGRESS', FRESH_START),
    ] });
    expect(isActivePipeline(wp, 'implementation')).toBe(true);
  });
});

describe('mostRecentEffectivePipeline', () => {
  it('returns null when the WP has no pipelines', () => {
    const wp = makeWorkPackageDetail({ pipelines: [] });
    expect(mostRecentEffectivePipeline(wp)).toBeNull();
  });

  it('returns the last non-auto-cancelled pipeline', () => {
    const p1 = makePipeline('implementation', 'PASS', '2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z');
    const p2 = makePipeline('qa', 'IN_PROGRESS', '2026-01-01T10:00:00Z');
    const wp = makeWorkPackageDetail({ pipelines: [p1, p2] });
    expect(mostRecentEffectivePipeline(wp)).toBe(p2);
  });

  it('skips auto-cancelled pipelines at the end', () => {
    const p1 = makePipeline('implementation', 'PASS', '2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z');
    const p2 = { ...makePipeline('qa', 'IN_PROGRESS', '2026-01-01T10:00:00Z'), auto_cancelled: true };
    const wp = makeWorkPackageDetail({ pipelines: [p1, p2] });
    expect(mostRecentEffectivePipeline(wp)).toBe(p1);
  });
});

// \u2500\u2500\u2500 isBlockedByDependencies (WP-005 R6) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

describe('isBlockedByDependencies (R6)', () => {
  it('returns true when status is BLOCKED and blocked_by.type === \"dependency\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'dependency' as const, description: 'waiting on WP-001' } };
    expect(isBlockedByDependencies(wp)).toBe(true);
  });

  it('returns true when status is BLOCKED and blocked_by === null', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: null as any };
    expect(isBlockedByDependencies(wp)).toBe(true);
  });

  it('returns true when status is BLOCKED and blocked_by is absent (undefined == null)', () => {
    const { blocked_by: _omit, ...wpBase } = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: undefined as any };
    expect(isBlockedByDependencies(wpBase as any)).toBe(true);
  });

  it('returns false when status is BLOCKED and blocked_by.type === \"technical\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'technical' as const, description: 'legacy issue' } };
    expect(isBlockedByDependencies(wp)).toBe(false);
  });

  it('returns false when status is BLOCKED and blocked_by.type === \"external\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'external' as const, description: 'vendor delay' } };
    expect(isBlockedByDependencies(wp)).toBe(false);
  });

  it('returns false when status is READY (not BLOCKED)', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'READY' as any };
    expect(isBlockedByDependencies(wp)).toBe(false);
  });
});

// \u2500\u2500\u2500 hasDependencyBlocked (WP-005 R6) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

describe('hasDependencyBlocked (R6)', () => {
  it('returns true when status is BLOCKED and blocked_by.type === \"dependency\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'dependency' as const, description: 'waiting on WP-002' } };
    expect(hasDependencyBlocked(wp)).toBe(true);
  });

  it('returns true when status is BLOCKED and blocked_by === null', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: null as any };
    expect(hasDependencyBlocked(wp)).toBe(true);
  });

  it('returns true when status is BLOCKED and blocked_by is absent (undefined == null)', () => {
    const { blocked_by: _omit, ...wpBase } = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: undefined as any };
    expect(hasDependencyBlocked(wpBase as any)).toBe(true);
  });

  it('returns false when status is BLOCKED and blocked_by.type === \"technical\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'technical' as const, description: 'tech debt' } };
    expect(hasDependencyBlocked(wp)).toBe(false);
  });

  it('returns false when status is BLOCKED and blocked_by.type === \"external\"', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'BLOCKED' as any, blocked_by: { type: 'external' as const, description: 'external vendor' } };
    expect(hasDependencyBlocked(wp)).toBe(false);
  });

  it('returns false when status is READY (not BLOCKED)', () => {
    const wp = { ...makeWorkPackageDetail({ pipelines: [] }), status: 'READY' as any };
    expect(hasDependencyBlocked(wp)).toBe(false);
  });
});

// \u2500\u2500\u2500 effectiveMaxDepth (WP-005 R8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

describe('effectiveMaxDepth (R8)', () => {
  // Pass configMax=50 explicitly so tests are hermetic (no dependency on getConfig() state).

  it('returns 150 for totalWorkPackages=5 (5 × 30 = 150 > 50, ceiling wins)', () => {
    expect(effectiveMaxDepth(5, 50)).toBe(150);
  });

  it('returns 50 for totalWorkPackages=1 (floor applies: 1 × 30 = 30 < 50)', () => {
    expect(effectiveMaxDepth(1, 50)).toBe(50);
  });

  it('returns 50 for totalWorkPackages=0 (floor applies: 0 × 30 = 0 < 50)', () => {
    expect(effectiveMaxDepth(0, 50)).toBe(50);
  });

  it('returns 90 for totalWorkPackages=3 (3 × 30 = 90 > 50, ceiling wins)', () => {
    expect(effectiveMaxDepth(3, 50)).toBe(90);
  });
});