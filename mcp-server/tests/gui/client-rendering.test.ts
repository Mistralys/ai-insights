// @vitest-environment jsdom

/**
 * Unit tests for client-side rendering functions
 * Tests buildWpDetailBar and buildPipelineTrack in a jsdom environment
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Load client JS files
const publicDir = join(__dirname, '../../gui/public');
const wpViewJs               = readFileSync(join(publicDir, 'views/work-package.js'), 'utf-8');
// buildPipelineTrack and STAGE_ABBREV are now in project-detail-helpers.js (WP-004 decomposition)
const projectDetailHelpersJs = readFileSync(join(publicDir, 'views/project-detail-helpers.js'), 'utf-8');

// Execute client scripts in the globalThis context (jsdom window) so their
// function/var declarations are available as globalThis.buildWpDetailBar etc.
// utils.js and components.js are loaded by the shared setup-gui-globals.ts.
beforeAll(() => {
  vm.runInThisContext(projectDetailHelpersJs); // buildPipelineTrack, STAGE_ABBREV
  vm.runInThisContext(wpViewJs);               // buildWpDetailBar, WP_DEFAULT_STAGES
});

// Declare global functions for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var buildWpDetailBar: (wp: any) => string;
  // eslint-disable-next-line no-var
  var buildPipelineTrack: (overviewEntry: any) => string;
  // eslint-disable-next-line no-var
  var escapeHtml: (str: any) => string;
  // eslint-disable-next-line no-var
  var STAGE_ABBREV: Record<string, string>;
  // eslint-disable-next-line no-var
  var WP_DEFAULT_STAGES: string[];
  // eslint-disable-next-line no-var
  var UI: {
    badge: (type: string, label: string, opts?: { attrs?: Record<string, string> }) => string;
    banner: (type: string, message: string) => string;
    emptyState: (message: string) => string;
  };
}

describe('buildWpDetailBar', () => {
  it('renders all stages as pending when pipelines array is empty', () => {
    const wp = {
      work_package_id: 'WP-001',
      pipelines: [],
    };
    const html = globalThis.buildWpDetailBar(wp);
    expect(html).toContain('stage-pending');
    expect(html).not.toContain('stage-pass');
    expect(html).not.toContain('stage-fail');
    expect(html).toContain('Pipeline Progression');
  });

  it('renders mixed pipeline statuses correctly', () => {
    const wp = {
      work_package_id: 'WP-002',
      pipelines: [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'IN_PROGRESS' },
        { type: 'code-review', status: 'FAIL' },
      ],
    };
    const html = globalThis.buildWpDetailBar(wp);
    expect(html).toContain('stage-pass');
    expect(html).toContain('stage-in-progress');
    expect(html).toContain('stage-fail');
  });

  it('displays rework count from rework_counts field when present', () => {
    const wp = {
      work_package_id: 'WP-003',
      pipelines: [
        { type: 'implementation', status: 'PASS' },
        { type: 'implementation', status: 'PASS' },
      ],
      rework_counts: {
        implementation: 3,
      },
    };
    const html = globalThis.buildWpDetailBar(wp);
    expect(html).toContain('rework-indicator');
    expect(html).toContain('title="Rework count: 3"');
    expect(html).toContain('>3</span>');
  });

  it('calculates rework count heuristically when rework_counts is absent', () => {
    const wp = {
      work_package_id: 'WP-004',
      pipelines: [
        { type: 'qa', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
        { type: 'qa', status: 'PASS' },
      ],
    };
    const html = globalThis.buildWpDetailBar(wp);
    expect(html).toContain('rework-indicator');
    // 3 pipelines - 1 = 2 reworks
    expect(html).toContain('>2</span>');
  });

  it('prefers rework_counts over heuristic when both signals are present', () => {
    const wp = {
      work_package_id: 'WP-005',
      pipelines: [
        { type: 'implementation', status: 'PASS' },
        { type: 'implementation', status: 'PASS' },
        { type: 'implementation', status: 'PASS' },
      ],
      rework_counts: {
        implementation: 1, // explicit count overrides heuristic (which would be 2)
      },
    };
    const html = globalThis.buildWpDetailBar(wp);
    expect(html).toContain('rework-indicator');
    expect(html).toContain('title="Rework count: 1"');
    expect(html).toContain('>1</span>');
  });

  it('uses active_pipeline_stages when present instead of default stages', () => {
    const wp = {
      work_package_id: 'WP-006',
      active_pipeline_stages: ['implementation', 'security-audit'],
      pipelines: [
        { type: 'implementation', status: 'PASS' },
      ],
    };
    const html = globalThis.buildWpDetailBar(wp);
    // Should render only 2 badges (implementation + security-audit)
    const badgeMatches = html.match(/stage-badge/g);
    expect(badgeMatches).toHaveLength(2);
    expect(html).toContain('SEC'); // security-audit abbreviation
  });

  it('falls back to default_pipeline_stages then WP_DEFAULT_STAGES when active_pipeline_stages is missing', () => {
    const wp1 = {
      work_package_id: 'WP-007',
      default_pipeline_stages: ['implementation', 'qa', 'documentation'],
      pipelines: [],
    };
    const html1 = globalThis.buildWpDetailBar(wp1);
    const badgeMatches1 = html1.match(/stage-badge/g);
    expect(badgeMatches1).toHaveLength(3); // uses default_pipeline_stages

    const wp2 = {
      work_package_id: 'WP-008',
      pipelines: [],
    };
    const html2 = globalThis.buildWpDetailBar(wp2);
    const badgeMatches2 = html2.match(/stage-badge/g);
    expect(badgeMatches2).toHaveLength(globalThis.WP_DEFAULT_STAGES.length); // falls back to WP_DEFAULT_STAGES
  });

  it('escapes dynamic values in tooltip attributes', () => {
    const wp = {
      work_package_id: 'WP-009',
      pipelines: [
        { type: 'implementation', status: 'PASS' },
      ],
    };
    const html = globalThis.buildWpDetailBar(wp);
    // Tooltip should contain escaped stage type
    expect(html).toContain('implementation');
    // Should not contain raw angle brackets from hypothetical XSS attempts
    expect(html).not.toContain('<<script>');
  });
});

describe('buildPipelineTrack', () => {
  it('returns em dash when overviewEntry is null', () => {
    const html = globalThis.buildPipelineTrack(null);
    expect(html).toBe('—');
  });

  it('returns em dash when overviewEntry is undefined', () => {
    const html = globalThis.buildPipelineTrack(undefined);
    expect(html).toBe('—');
  });

  it('returns em dash when pipeline_stages is empty', () => {
    const entry = {
      work_package_id: 'WP-010',
      pipeline_stages: [],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).toBe('—');
  });

  it('renders all stages with correct badges when pipeline_stages is present', () => {
    const entry = {
      work_package_id: 'WP-011',
      pipeline_stages: [
        { type: 'implementation', status: 'pass', agent: 'Developer', rework_count: 0 },
        { type: 'qa', status: 'in-progress', agent: 'QA', rework_count: 0 },
        { type: 'code-review', status: 'pending', agent: 'Reviewer', rework_count: 0 },
      ],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).toContain('pipeline-track');
    expect(html).toContain('stage-pass');
    expect(html).toContain('stage-in-progress');
    expect(html).toContain('stage-pending');
    expect(html).toContain('DEV'); // implementation abbreviation
    expect(html).toContain('QA'); // qa abbreviation
    expect(html).toContain('REV'); // code-review abbreviation
  });

  it('displays rework indicator when rework_count > 0', () => {
    const entry = {
      work_package_id: 'WP-012',
      pipeline_stages: [
        { type: 'implementation', status: 'pass', agent: 'Developer', rework_count: 2 },
      ],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).toContain('rework-indicator');
    expect(html).toContain('title="Rework count: 2"');
    expect(html).toContain('>2</span>');
  });

  it('hides rework indicator when rework_count is 0', () => {
    const entry = {
      work_package_id: 'WP-013',
      pipeline_stages: [
        { type: 'qa', status: 'pass', agent: 'QA', rework_count: 0 },
      ],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).not.toContain('rework-indicator');
  });

  it('maps stage types to abbreviations correctly', () => {
    const entry = {
      work_package_id: 'WP-014',
      pipeline_stages: [
        { type: 'implementation', status: 'pass', agent: 'Developer', rework_count: 0 },
        { type: 'qa', status: 'pass', agent: 'QA', rework_count: 0 },
        { type: 'security-audit', status: 'pass', agent: 'Security Auditor', rework_count: 0 },
        { type: 'code-review', status: 'pass', agent: 'Reviewer', rework_count: 0 },
        { type: 'release-engineering', status: 'pass', agent: 'Release Engineer', rework_count: 0 },
        { type: 'documentation', status: 'pass', agent: 'Documentation', rework_count: 0 },
      ],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).toContain('DEV'); // implementation
    expect(html).toContain('QA'); // qa
    expect(html).toContain('SEC'); // security-audit
    expect(html).toContain('REV'); // code-review
    expect(html).toContain('REL'); // release-engineering
    expect(html).toContain('DOC'); // documentation
  });

  it('falls back to uppercase first 3 chars for unmapped stage types', () => {
    const entry = {
      work_package_id: 'WP-015',
      pipeline_stages: [
        { type: 'custom-stage', status: 'pass', agent: 'Custom Agent', rework_count: 0 },
      ],
    };
    const html = globalThis.buildPipelineTrack(entry);
    expect(html).toContain('CUS'); // first 3 chars of 'custom-stage'
  });
});

// ---------------------------------------------------------------------------
// UI.badge() — opts/attrs extension (AC-2, AC-3, AC-4)
// ---------------------------------------------------------------------------

describe('UI.badge()', () => {
  it('renders a basic badge without opts', () => {
    const html = globalThis.UI.badge('in-progress', 'In Progress');
    expect(html).toBe('<span class="badge badge-in-progress">In Progress</span>');
  });

  it('renders extra attrs from opts.attrs on the span (AC-2)', () => {
    const html = globalThis.UI.badge('fail', 'Error', { attrs: { title: 'tooltip text' } });
    expect(html).toContain('class="badge badge-fail"');
    expect(html).toContain('title="tooltip text"');
    expect(html).toContain('Error');
  });

  it('HTML-escapes attr values from opts.attrs', () => {
    const html = globalThis.UI.badge('fail', 'x', { attrs: { title: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not throw when type is null (AC-3)', () => {
    expect(() => globalThis.UI.badge(null as any, 'text')).not.toThrow();
    const html = globalThis.UI.badge(null as any, 'text');
    expect(html).toContain('class="badge badge-"');
  });

  it('HTML-escapes malicious type strings in class attribute (AC-4)', () => {
    const html = globalThis.UI.badge('<script>', 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('badge-&lt;script&gt;');
  });
});
