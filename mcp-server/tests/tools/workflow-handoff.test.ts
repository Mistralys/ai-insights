import { describe, it, expect } from 'vitest';
import { _internal } from '../../src/tools/workflow.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

const { getQaHandoff, getReviewerHandoff, getDocumentationHandoff, getDeveloperHandoff } = _internal;

/** Helper to parse the JSON from a handoff result */
function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

/** Build a minimal WP detail stub */
function makeWp(
  id: string,
  status: string,
  pipelines: Array<{ type: string; status: string }> = [],
  deps: string[] = []
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer Agent',
    dependencies: deps,
    acceptance_criteria: [],
    revision: 1,
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      summary: [],
    })),
  };
}

describe('Handoff logic: incomplete project detection', () => {
  describe('QA handoff', () => {
    it('returns READY_FOR_REVIEW when remaining WPs are blocked by dependencies', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
      expect(result.details).toContain('WP-003');
    });

    it('returns READY_FOR_REVIEW when ALL WPs are implemented and QA passed', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
    });

    it('returns IN_PROGRESS when some implemented WPs still need QA', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns IN_PROGRESS when a QA pipeline has FAIL status', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for implementation');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Reviewer handoff', () => {
    it('returns READY_FOR_DOCUMENTATION when remaining WPs are blocked by dependencies', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_DOCUMENTATION when ALL WPs have passed review', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Documentation handoff', () => {
    it('returns READY_FOR_DEVELOPER when only some WPs have completed documentation', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_SYNTHESIS when ALL WPs have documentation', () => {
      const wpDetails = [
        makeWp('WP-001', 'COMPLETE', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'COMPLETE', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_SYNTHESIS');
    });
  });

  describe('Developer handoff', () => {
    it('returns IN_PROGRESS when some WPs lack implementation', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_QA when ALL WPs have PASS implementation', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_QA');
    });
  });
});
