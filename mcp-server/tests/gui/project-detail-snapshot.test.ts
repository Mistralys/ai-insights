// @vitest-environment jsdom

/**
 * Unit tests for `_snapshotProjectState` in views/project-detail.js.
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side script, then
 * exercises the pure snapshot-extraction function with mock API data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client scripts
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const projectDetailJs = readFileSync(join(publicDir, 'views/project-detail.js'), 'utf-8');

beforeAll(() => {
  // Install minimal stubs required by project-detail.js at parse time.
  (globalThis as Record<string, unknown>)['marked'] = {
    parse: (s: string) => '<p>' + s + '</p>',
  };
  (globalThis as Record<string, unknown>)['OrchestratorWidgets'] = {
    renderStatusCard:    () => '',
    renderKillButton:    () => document.createElement('button'),
    renderDismissButton: () => {},
    renderLogPreview:    () => () => {},
    renderProgressBadge: () => '',
    renderCliReference:  () => '',
  };
  (globalThis as Record<string, unknown>)['Router'] = {
    _setPolling:   () => {},
    _clearPolling: () => {},
  };

  vm.runInThisContext(projectDetailJs);
});

// ---------------------------------------------------------------------------
// Global type declaration
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _snapshotProjectState: (
    project: Record<string, unknown>,
    overviewResult: unknown[] | null
  ) => {
    status: string;
    last_updated: string;
    synthesis_generated: boolean;
    wpStatuses: Record<string, { status: string; pipelineStages: unknown[] }>;
    health: null | { work_packages_needing_reset: number };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid project response from API.getProject */
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      status: 'IN_PROGRESS',
      title: 'Test Project',
      plan_path: '/some/path',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-15T12:00:00Z',
      ...overrides,
    },
    work_packages: [],
    project_comments: [],
    project_name: 'Test Project',
    timing: null,
    server_version: null,
    ledger_version: null,
    synthesis_generated: false,
    ...overrides,
  };
}

/** Minimal valid work package entry inside a project response */
function makeWp(id: string, status = 'READY') {
  return { work_package_id: id, status, assigned_to: 'Developer' };
}

/** Minimal valid overview entry from API.getWorkPackageOverview */
function makeOverviewEntry(id: string, stages: unknown[] = []) {
  return { work_package_id: id, pipeline_stages: stages };
}

/** Minimal valid pipeline stage */
function makeStage(type: string, status = 'pending', agent = 'Developer', rework_count = 0) {
  return { type, status, agent, rework_count };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_snapshotProjectState — basic shape', () => {
  it('returns a JSON-serializable object with expected keys', () => {
    const project = makeProject();
    const snapshot = globalThis._snapshotProjectState(project, null);

    // Must be serializable without throwing
    expect(() => JSON.stringify(snapshot)).not.toThrow();

    // Top-level keys present
    expect(snapshot).toHaveProperty('status');
    expect(snapshot).toHaveProperty('last_updated');
    expect(snapshot).toHaveProperty('synthesis_generated');
    expect(snapshot).toHaveProperty('wpStatuses');
    expect(snapshot).toHaveProperty('health');
  });

  it('captures project status and last_updated from meta', () => {
    const project = makeProject({ status: 'COMPLETE', last_updated: '2026-06-01T09:00:00Z' });
    const snapshot = globalThis._snapshotProjectState(project, null);

    expect(snapshot.status).toBe('COMPLETE');
    expect(snapshot.last_updated).toBe('2026-06-01T09:00:00Z');
  });

  it('captures synthesis_generated flag', () => {
    const projectFalse = makeProject({ synthesis_generated: false });
    const projectTrue  = makeProject({ synthesis_generated: true });

    expect(globalThis._snapshotProjectState(projectFalse, null).synthesis_generated).toBe(false);
    expect(globalThis._snapshotProjectState(projectTrue,  null).synthesis_generated).toBe(true);
  });

  it('health is null initially (populated asynchronously)', () => {
    const snapshot = globalThis._snapshotProjectState(makeProject(), null);
    expect(snapshot.health).toBeNull();
  });
});

describe('_snapshotProjectState — empty / missing data', () => {
  it('handles empty work_packages array', () => {
    const snapshot = globalThis._snapshotProjectState(makeProject(), null);
    expect(snapshot.wpStatuses).toEqual({});
  });

  it('handles null overviewResult gracefully', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [makeWp('WP-001')];
    const snapshot = globalThis._snapshotProjectState(project, null);

    expect(snapshot.wpStatuses['WP-001']).toBeDefined();
    expect(snapshot.wpStatuses['WP-001'].status).toBe('READY');
    expect(snapshot.wpStatuses['WP-001'].pipelineStages).toEqual([]);
  });

  it('handles empty overviewResult array', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [makeWp('WP-001')];
    const snapshot = globalThis._snapshotProjectState(project, []);

    expect(snapshot.wpStatuses['WP-001'].pipelineStages).toEqual([]);
  });

  it('handles missing meta fields by falling back to empty strings', () => {
    const project = { meta: {}, work_packages: [], synthesis_generated: false };
    const snapshot = globalThis._snapshotProjectState(project as Record<string, unknown>, null);

    expect(snapshot.status).toBe('');
    expect(snapshot.last_updated).toBe('');
  });
});

describe('_snapshotProjectState — work package statuses', () => {
  it('captures WP IDs and statuses from project.work_packages', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [
      makeWp('WP-001', 'IN_PROGRESS'),
      makeWp('WP-002', 'COMPLETE'),
      makeWp('WP-003', 'READY'),
    ];
    const snapshot = globalThis._snapshotProjectState(project, null);

    expect(Object.keys(snapshot.wpStatuses)).toHaveLength(3);
    expect(snapshot.wpStatuses['WP-001'].status).toBe('IN_PROGRESS');
    expect(snapshot.wpStatuses['WP-002'].status).toBe('COMPLETE');
    expect(snapshot.wpStatuses['WP-003'].status).toBe('READY');
  });

  it('captures multiple work packages with various statuses', () => {
    const statuses = ['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'CANCELLED'];
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = statuses.map((s, i) =>
      makeWp('WP-00' + (i + 1), s)
    );
    const snapshot = globalThis._snapshotProjectState(project, null);

    statuses.forEach((s, i) => {
      expect(snapshot.wpStatuses['WP-00' + (i + 1)].status).toBe(s);
    });
  });
});

describe('_snapshotProjectState — overview / pipeline stage enrichment', () => {
  it('enriches wpStatuses with pipeline stages from overview', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [makeWp('WP-001')];
    const overview = [
      makeOverviewEntry('WP-001', [
        makeStage('implementation', 'pass', 'Developer', 0),
        makeStage('qa', 'in-progress', 'QA', 1),
      ]),
    ];
    const snapshot = globalThis._snapshotProjectState(project, overview);

    const stages = snapshot.wpStatuses['WP-001'].pipelineStages as Array<Record<string, unknown>>;
    expect(stages).toHaveLength(2);
    expect(stages[0]).toEqual({ type: 'implementation', status: 'pass', agent: 'Developer', rework_count: 0 });
    expect(stages[1]).toEqual({ type: 'qa', status: 'in-progress', agent: 'QA', rework_count: 1 });
  });

  it('handles overview entry for a WP not in work_packages (adds it to wpStatuses)', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [];
    const overview = [
      makeOverviewEntry('WP-999', [makeStage('documentation', 'pass')]),
    ];
    const snapshot = globalThis._snapshotProjectState(project, overview);

    expect(snapshot.wpStatuses['WP-999']).toBeDefined();
    expect(snapshot.wpStatuses['WP-999'].pipelineStages).toHaveLength(1);
  });

  it('handles overview entry with missing pipeline_stages field gracefully', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [makeWp('WP-001')];
    const overview = [{ work_package_id: 'WP-001' }]; // no pipeline_stages key
    const snapshot = globalThis._snapshotProjectState(project, overview);

    expect(snapshot.wpStatuses['WP-001'].pipelineStages).toEqual([]);
  });

  it('handles rework_count of 0 correctly (not coerced to truthy)', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [makeWp('WP-001')];
    const overview = [
      makeOverviewEntry('WP-001', [makeStage('implementation', 'pass', 'Developer', 0)]),
    ];
    const snapshot = globalThis._snapshotProjectState(project, overview);

    const stage = (snapshot.wpStatuses['WP-001'].pipelineStages as Array<Record<string, unknown>>)[0];
    expect(stage.rework_count).toBe(0);
  });

  it('produces identical JSON from identical inputs (deterministic)', () => {
    const project = makeProject();
    (project as Record<string, unknown>).work_packages = [
      makeWp('WP-001', 'IN_PROGRESS'),
      makeWp('WP-002', 'READY'),
    ];
    const overview = [
      makeOverviewEntry('WP-001', [makeStage('implementation', 'in-progress')]),
    ];

    const a = globalThis._snapshotProjectState(project, overview);
    const b = globalThis._snapshotProjectState(project, overview);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
