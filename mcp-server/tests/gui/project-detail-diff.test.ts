// @vitest-environment jsdom

/**
 * Unit tests for `_diffProjectState` in views/project-detail.js.
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side script, then
 * exercises the pure diff/comparison function.
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
// Global type declarations
// ---------------------------------------------------------------------------

type Snapshot = {
  status: string;
  last_updated: string;
  synthesis_generated: boolean;
  wpStatuses: Record<string, { status: string; pipelineStages: unknown[] }>;
  health: null | { work_packages_needing_reset: number };
};

type DiffResult = {
  type: 'none' | 'data' | 'structural';
  changes: Record<string, { from: unknown; to: unknown }>;
};

declare global {
  // eslint-disable-next-line no-var
  var _diffProjectState: (prev: Snapshot, next: Snapshot) => DiffResult;
  // eslint-disable-next-line no-var
  var _snapshotProjectState: (
    project: Record<string, unknown>,
    overviewResult: unknown[] | null
  ) => Snapshot;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    status: 'IN_PROGRESS',
    last_updated: '2026-01-15T12:00:00Z',
    synthesis_generated: false,
    wpStatuses: {
      'WP-001': { status: 'IN_PROGRESS', pipelineStages: [] },
      'WP-002': { status: 'READY',       pipelineStages: [] },
    },
    health: null,
    ...overrides,
  };
}

function makeStage(type: string, status = 'pending', agent = 'Developer', rework_count = 0) {
  return { type, status, agent, rework_count };
}

// ---------------------------------------------------------------------------
// Tests — no change
// ---------------------------------------------------------------------------

describe('_diffProjectState — no change', () => {
  it('returns type "none" for identical snapshots', () => {
    const snap = makeSnapshot();
    const result = globalThis._diffProjectState(snap, snap);

    expect(result.type).toBe('none');
    expect(Object.keys(result.changes)).toHaveLength(0);
  });

  it('returns type "none" for deep-equal snapshots built separately', () => {
    const prev = makeSnapshot();
    const next = makeSnapshot(); // different object, same values
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('none');
    expect(Object.keys(result.changes)).toHaveLength(0);
  });

  it('returns type "none" when health is null in both', () => {
    const prev = makeSnapshot({ health: null });
    const next = makeSnapshot({ health: null });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('none');
  });

  it('returns type "none" for projects with no WPs', () => {
    const prev = makeSnapshot({ wpStatuses: {} });
    const next = makeSnapshot({ wpStatuses: {} });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Tests — structural changes
// ---------------------------------------------------------------------------

describe('_diffProjectState — structural changes', () => {
  it('classifies WP count increase as structural', () => {
    const prev = makeSnapshot({ wpStatuses: { 'WP-001': { status: 'READY', pipelineStages: [] } } });
    const next = makeSnapshot({
      wpStatuses: {
        'WP-001': { status: 'READY', pipelineStages: [] },
        'WP-002': { status: 'READY', pipelineStages: [] },
      },
    });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('structural');
    expect(result.changes['wpCount']).toBeDefined();
    expect(result.changes['wpCount'].from).toBe(1);
    expect(result.changes['wpCount'].to).toBe(2);
  });

  it('classifies WP count decrease as structural', () => {
    const prev = makeSnapshot({
      wpStatuses: {
        'WP-001': { status: 'READY', pipelineStages: [] },
        'WP-002': { status: 'READY', pipelineStages: [] },
      },
    });
    const next = makeSnapshot({ wpStatuses: { 'WP-001': { status: 'READY', pipelineStages: [] } } });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('structural');
    expect(result.changes['wpCount'].from).toBe(2);
    expect(result.changes['wpCount'].to).toBe(1);
  });

  it('classifies project status → COMPLETE as structural', () => {
    const prev = makeSnapshot({ status: 'IN_PROGRESS' });
    const next = makeSnapshot({ status: 'COMPLETE' });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('structural');
    expect(result.changes['status']).toBeDefined();
    expect(result.changes['status'].from).toBe('IN_PROGRESS');
    expect(result.changes['status'].to).toBe('COMPLETE');
  });

  it('classifies project status → ARCHIVED as structural', () => {
    const prev = makeSnapshot({ status: 'IN_PROGRESS' });
    const next = makeSnapshot({ status: 'ARCHIVED' });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('structural');
    expect(result.changes['status'].to).toBe('ARCHIVED');
  });

  it('structural wins over data — reports structural when both occur simultaneously', () => {
    // status change to COMPLETE (structural) + synthesis flip (data)
    const prev = makeSnapshot({ status: 'IN_PROGRESS', synthesis_generated: false });
    const next = makeSnapshot({ status: 'COMPLETE',    synthesis_generated: true });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('structural');
    // Both changes captured
    expect(result.changes['status']).toBeDefined();
    expect(result.changes['synthesis_generated']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — data-only changes
// ---------------------------------------------------------------------------

describe('_diffProjectState — data-only changes', () => {
  it('classifies status badge change (non-terminal) as data-only', () => {
    const prev = makeSnapshot({ status: 'READY' });
    const next = makeSnapshot({ status: 'IN_PROGRESS' });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['status']).toBeDefined();
    expect(result.changes['status'].from).toBe('READY');
    expect(result.changes['status'].to).toBe('IN_PROGRESS');
  });

  it('classifies BLOCKED project status as data-only', () => {
    const prev = makeSnapshot({ status: 'IN_PROGRESS' });
    const next = makeSnapshot({ status: 'BLOCKED' });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
  });

  it('classifies WP status change as data-only', () => {
    const prev = makeSnapshot({
      wpStatuses: { 'WP-001': { status: 'READY', pipelineStages: [] } },
    });
    const next = makeSnapshot({
      wpStatuses: { 'WP-001': { status: 'IN_PROGRESS', pipelineStages: [] } },
    });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['wp.WP-001.status']).toBeDefined();
    expect(result.changes['wp.WP-001.status'].from).toBe('READY');
    expect(result.changes['wp.WP-001.status'].to).toBe('IN_PROGRESS');
  });

  it('classifies WP pipeline stage change as data-only', () => {
    const prev = makeSnapshot({
      wpStatuses: {
        'WP-001': { status: 'IN_PROGRESS', pipelineStages: [makeStage('implementation', 'pending')] },
      },
    });
    const next = makeSnapshot({
      wpStatuses: {
        'WP-001': { status: 'IN_PROGRESS', pipelineStages: [makeStage('implementation', 'in-progress')] },
      },
    });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['wp.WP-001.pipelineStages']).toBeDefined();
  });

  it('classifies synthesis_generated flip (false → true) as data-only', () => {
    const prev = makeSnapshot({ synthesis_generated: false });
    const next = makeSnapshot({ synthesis_generated: true });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['synthesis_generated']).toBeDefined();
    expect(result.changes['synthesis_generated'].from).toBe(false);
    expect(result.changes['synthesis_generated'].to).toBe(true);
  });

  it('classifies synthesis_generated flip (true → false) as data-only', () => {
    const prev = makeSnapshot({ synthesis_generated: true });
    const next = makeSnapshot({ synthesis_generated: false });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['synthesis_generated'].from).toBe(true);
    expect(result.changes['synthesis_generated'].to).toBe(false);
  });

  it('classifies health null → value transition as data-only', () => {
    const prev = makeSnapshot({ health: null });
    const next = makeSnapshot({ health: { work_packages_needing_reset: 0 } });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['health']).toBeDefined();
    expect(result.changes['health'].from).toBeNull();
    expect((result.changes['health'].to as { work_packages_needing_reset: number }).work_packages_needing_reset).toBe(0);
  });

  it('classifies health value change as data-only', () => {
    const prev = makeSnapshot({ health: { work_packages_needing_reset: 0 } });
    const next = makeSnapshot({ health: { work_packages_needing_reset: 2 } });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['health']).toBeDefined();
  });

  it('classifies last_updated change as data-only', () => {
    const prev = makeSnapshot({ last_updated: '2026-01-01T00:00:00Z' });
    const next = makeSnapshot({ last_updated: '2026-06-01T12:00:00Z' });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['last_updated']).toBeDefined();
    expect(result.changes['last_updated'].from).toBe('2026-01-01T00:00:00Z');
    expect(result.changes['last_updated'].to).toBe('2026-06-01T12:00:00Z');
  });

  it('captures multiple independent data changes at once', () => {
    const prev = makeSnapshot({
      status: 'READY',
      synthesis_generated: false,
      health: null,
      wpStatuses: { 'WP-001': { status: 'READY', pipelineStages: [] } },
    });
    const next = makeSnapshot({
      status: 'IN_PROGRESS',
      synthesis_generated: true,
      health: { work_packages_needing_reset: 1 },
      wpStatuses: { 'WP-001': { status: 'IN_PROGRESS', pipelineStages: [] } },
    });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('data');
    expect(result.changes['status']).toBeDefined();
    expect(result.changes['synthesis_generated']).toBeDefined();
    expect(result.changes['health']).toBeDefined();
    expect(result.changes['wp.WP-001.status']).toBeDefined();
  });

  it('does not flag rework_count=0 vs rework_count=0 as a change', () => {
    const stages = [makeStage('implementation', 'pass', 'Developer', 0)];
    const prev = makeSnapshot({ wpStatuses: { 'WP-001': { status: 'IN_PROGRESS', pipelineStages: stages } } });
    const next = makeSnapshot({ wpStatuses: { 'WP-001': { status: 'IN_PROGRESS', pipelineStages: stages } } });
    const result = globalThis._diffProjectState(prev, next);

    expect(result.type).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Tests — round-trip with _snapshotProjectState
// ---------------------------------------------------------------------------

describe('_diffProjectState — round-trip with _snapshotProjectState', () => {
  function makeProject(overrides: Record<string, unknown> = {}) {
    return {
      meta: {
        status: 'IN_PROGRESS',
        title: 'Test',
        plan_path: '/path',
        date_created: '2026-01-01T00:00:00Z',
        last_updated: '2026-01-15T12:00:00Z',
        ...overrides,
      },
      work_packages: [],
      project_comments: [],
      project_name: 'Test',
      timing: null,
      server_version: null,
      ledger_version: null,
      synthesis_generated: false,
      ...overrides,
    };
  }

  it('returns type "none" when the same project data is snapshotted twice', () => {
    const project = makeProject();
    const overview = [
      { work_package_id: 'WP-001', pipeline_stages: [makeStage('implementation', 'pass')] },
    ];
    (project as Record<string, unknown>).work_packages = [
      { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer' },
    ];

    const a = globalThis._snapshotProjectState(project as Record<string, unknown>, overview);
    const b = globalThis._snapshotProjectState(project as Record<string, unknown>, overview);
    const result = globalThis._diffProjectState(a, b);

    expect(result.type).toBe('none');
  });
});
