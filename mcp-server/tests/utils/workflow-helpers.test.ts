import { describe, it, expect } from 'vitest';
import { hasNewUpstreamPassSince } from '../../src/utils/workflow-helpers.js';
import type { Pipeline } from '../../src/schema/work-package.js';

/**
 * Builds a minimal Pipeline stub for testing.
 */
function makePipeline(
  type: string,
  status: string,
  started_at?: string,
  completed_at?: string
): Pipeline {
  return {
    type,
    status: status as any,
    summary: [],
    ...(started_at ? { started_at } : {}),
    ...(completed_at ? { completed_at } : {}),
  };
}

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
});
