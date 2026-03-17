import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  analyzeProjectForReset,
  applyProjectReset,
} from '../../src/utils/project-reset.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal valid RootIndex and WorkPackageDetail objects
// ---------------------------------------------------------------------------

function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: '2026-03-01T00:00:00Z',
    last_updated: '2026-03-01T00:00:00Z',
    status: 'IN_PROGRESS',
    total_work_packages: 1,
    pending_work_packages: 1,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

function makeWp(
  id: string,
  status: string,
  assignedTo: string | null,
  passedStages: string[],
  opts: Partial<WorkPackageDetail> = {}
): WorkPackageDetail {
  const pipelines = passedStages.map((type) => ({
    type,
    status: 'PASS' as const,
    started_at: '2026-03-01T00:00:00Z',
    completed_at: '2026-03-01T01:00:00Z',
    summary: [`Completed ${type}`],
  }));

  return {
    work_package_id: id,
    work_package_file: `${id}.json`,
    status: status as WorkPackageDetail['status'],
    assigned_to: assignedTo,
    dependencies: [],
    acceptance_criteria: [
      { criterion: 'Test criterion', met: true },
    ],
    revision: 1,
    pipelines,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// analyzeProjectForReset
// ---------------------------------------------------------------------------

describe('analyzeProjectForReset', () => {
  it('reports all WPs as healthy when all 4 stages PASS and COMPLETE', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Documentation', [
      'implementation', 'qa', 'code-review', 'documentation',
    ]);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages_needing_reset).toBe(0);
    expect(result.work_packages_healthy).toBe(1);
    expect(result.work_packages[0]!.needs_reset).toBe(false);
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
    expect(result.work_packages[0]!.pipeline_stages_missing).toEqual([]);
  });

  it('detects WP with only implementation as needing reset', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages_needing_reset).toBe(1);
    expect(result.work_packages[0]!.needs_reset).toBe(true);
    expect(result.work_packages[0]!.suggested_action).toBe('reset');
    expect(result.work_packages[0]!.pipeline_stages_missing).toEqual(['qa', 'code-review', 'documentation']);
    expect(result.work_packages[0]!.next_required_stage).toBe('qa');
    expect(result.work_packages[0]!.target_assigned_to).toBe('QA');
  });

  it('detects WP with implementation + qa as missing code-review and documentation', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'QA', ['implementation', 'qa']);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'QA', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages[0]!.needs_reset).toBe(true);
    expect(result.work_packages[0]!.pipeline_stages_missing).toEqual(['code-review', 'documentation']);
    expect(result.work_packages[0]!.next_required_stage).toBe('code-review');
    expect(result.work_packages[0]!.target_assigned_to).toBe('Reviewer');
  });

  it('skips CANCELLED WPs', () => {
    const wp = makeWp('WP-001', 'CANCELLED', null, []);
    const rootIndex = makeRootIndex({
      work_packages: [{ work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: null, dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages_skipped).toBe(1);
    expect(result.work_packages[0]!.needs_reset).toBe(false);
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
    expect(result.work_packages[0]!.reason).toContain('CANCELLED');
  });

  it('handles WP with no pipelines (needs full restart)', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', []);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages[0]!.needs_reset).toBe(true);
    expect(result.work_packages[0]!.next_required_stage).toBe('implementation');
    expect(result.work_packages[0]!.target_assigned_to).toBe('Developer');
    expect(result.work_packages[0]!.pipeline_stages_missing).toEqual([
      'implementation', 'qa', 'code-review', 'documentation',
    ]);
  });

  it('ignores auto_cancelled pipelines when determining passed stages', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    // Add an auto-cancelled QA pipeline
    wp.pipelines.push({
      type: 'qa',
      status: 'PASS',
      started_at: '2026-03-01T00:00:00Z',
      completed_at: '2026-03-01T01:00:00Z',
      summary: ['Auto-cancelled'],
      auto_cancelled: true,
    });

    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    // QA should NOT be counted as passed because it was auto-cancelled
    expect(result.work_packages[0]!.pipeline_stages_present).toEqual(['implementation']);
    expect(result.work_packages[0]!.pipeline_stages_missing).toContain('qa');
  });

  it('reports BLOCKED WPs as healthy with skip suggestion', () => {
    const wp = makeWp('WP-002', 'BLOCKED', 'Developer', ['implementation']);
    (wp as Record<string, unknown>).blocked_by = {
      type: 'dependency',
      description: 'Waiting for WP-001',
      blocking_work_package: 'WP-001',
    };

    const rootIndex = makeRootIndex({
      work_packages: [{ work_package_id: 'WP-002', status: 'BLOCKED', assigned_to: 'Developer', dependencies: ['WP-001'], file: 'WP-002.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages[0]!.needs_reset).toBe(false);
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
  });

  it('reports READY WPs as healthy', () => {
    const wp = makeWp('WP-001', 'READY', null, []);
    const rootIndex = makeRootIndex({
      work_packages: [{ work_package_id: 'WP-001', status: 'READY', assigned_to: null, dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages[0]!.needs_reset).toBe(false);
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
    expect(result.work_packages[0]!.reason).toContain('READY');
  });

  it('detects IN_PROGRESS WP with wrong assigned_to as needing reset', () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', 'Developer', ['implementation']);
    const rootIndex = makeRootIndex({
      work_packages: [{ work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    // Implementation passed, next is QA, but assigned to Developer → needs reset
    expect(result.work_packages[0]!.needs_reset).toBe(true);
    expect(result.work_packages[0]!.suggested_action).toBe('reset');
    expect(result.work_packages[0]!.target_assigned_to).toBe('QA');
  });

  it('reports IN_PROGRESS WP with correct assigned_to as healthy', () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', 'QA', ['implementation']);
    const rootIndex = makeRootIndex({
      work_packages: [{ work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'QA', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    expect(result.work_packages[0]!.needs_reset).toBe(false);
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
  });

  it('handles mixed project with some healthy, some broken, and CANCELLED WPs', () => {
    const wps = [
      makeWp('WP-001', 'COMPLETE', 'Documentation', ['implementation', 'qa', 'code-review', 'documentation']),
      makeWp('WP-002', 'COMPLETE', 'Developer', ['implementation']),
      makeWp('WP-003', 'CANCELLED', null, []),
    ];
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      total_work_packages: 3,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'WP-001.json' },
        { work_package_id: 'WP-002', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-002.json' },
        { work_package_id: 'WP-003', status: 'CANCELLED', assigned_to: null, dependencies: [], file: 'WP-003.json' },
      ],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, wps);

    expect(result.work_packages_healthy).toBe(1);     // WP-001
    expect(result.work_packages_needing_reset).toBe(1); // WP-002
    expect(result.work_packages_skipped).toBe(1);       // WP-003 (CANCELLED)
    expect(result.work_packages[0]!.suggested_action).toBe('skip');
    expect(result.work_packages[1]!.suggested_action).toBe('reset');
    expect(result.work_packages[2]!.suggested_action).toBe('skip');
  });

  it('suggested_reset_criteria is true for broken WPs and false for healthy ones', () => {
    const wps = [
      makeWp('WP-001', 'COMPLETE', 'Documentation', ['implementation', 'qa', 'code-review', 'documentation']),
      makeWp('WP-002', 'COMPLETE', 'Developer', ['implementation']),
    ];
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'WP-001.json' },
        { work_package_id: 'WP-002', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-002.json' },
      ],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, wps);

    expect(result.work_packages[0]!.suggested_reset_criteria).toBe(false);
    expect(result.work_packages[1]!.suggested_reset_criteria).toBe(true);
  });

  it('uses the most recent non-auto-cancelled pipeline per type', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', []);
    // Two implementation pipelines: first FAIL, then PASS
    wp.pipelines = [
      { type: 'implementation', status: 'FAIL', summary: ['Failed first attempt'] },
      { type: 'implementation', status: 'PASS', summary: ['Passed second attempt'] },
    ];

    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('test-project', rootIndex, [wp]);

    // Most recent (last in array) implementation is PASS, so implementation is present
    expect(result.work_packages[0]!.pipeline_stages_present).toEqual(['implementation']);
    expect(result.work_packages[0]!.next_required_stage).toBe('qa');
  });

  it('returns correct project-level fields', () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'WP-001.json' }],
    });

    const result = analyzeProjectForReset('my-slug', rootIndex, [wp]);

    expect(result.project_slug).toBe('my-slug');
    expect(result.current_project_status).toBe('COMPLETE');
  });
});

// ---------------------------------------------------------------------------
// applyProjectReset — reset_at field
// ---------------------------------------------------------------------------

describe('applyProjectReset — reset_at', () => {
  let ledgerRoot: string;
  let planPath: string;

  function makeRootWith(wps: WorkPackageDetail[]): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'COMPLETE',
      total_work_packages: wps.length,
      pending_work_packages: 0,
      work_packages: wps.map((wp) => ({
        work_package_id: wp.work_package_id,
        status: wp.status,
        assigned_to: wp.assigned_to,
        dependencies: wp.dependencies,
        file: `${wp.work_package_id}.json`,
      })),
      project_comments: [],
    };
  }

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'reset-at-test-'));
    planPath = join(tmpdir(), '2026-03-05-reset-at-plan');
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('sets reset_at on WPs with reset action', async () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    const rootIndex = makeRootWith([wp]);
    const store = new LedgerStore(planPath, ledgerRoot);
    await store.writeRootIndex(rootIndex);
    await store.writeWorkPackage('WP-001', wp);

    const diagnosis = analyzeProjectForReset('test', rootIndex, [wp]);
    await applyProjectReset(store, diagnosis, { 'WP-001': { action: 'reset' } });

    const wpAfter = await store.readWorkPackage('WP-001');
    expect(wpAfter.reset_at).toBeDefined();
    expect(typeof wpAfter.reset_at).toBe('string');
    expect(wpAfter.reset_at!.length).toBeGreaterThan(0);
  });

  it('does NOT set reset_at on WPs with cancel action', async () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    const rootIndex = makeRootWith([wp]);
    const store = new LedgerStore(planPath, ledgerRoot);
    await store.writeRootIndex(rootIndex);
    await store.writeWorkPackage('WP-001', wp);

    const diagnosis = analyzeProjectForReset('test', rootIndex, [wp]);
    await applyProjectReset(store, diagnosis, { 'WP-001': { action: 'cancel' } });

    const wpAfter = await store.readWorkPackage('WP-001');
    expect(wpAfter.reset_at).toBeUndefined();
  });

  it('does NOT set reset_at on WPs absent from decisions map (skip)', async () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
    const rootIndex = makeRootWith([wp]);
    const store = new LedgerStore(planPath, ledgerRoot);
    await store.writeRootIndex(rootIndex);
    await store.writeWorkPackage('WP-001', wp);

    const diagnosis = analyzeProjectForReset('test', rootIndex, [wp]);
    // WP-001 absent from decisions → defaults to skip
    await applyProjectReset(store, diagnosis, {});

    const wpAfter = await store.readWorkPackage('WP-001');
    // Skip does not write — file is unchanged from original, which has no reset_at
    expect(wpAfter.reset_at).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WP-008 — applyProjectReset clears synthesis_generated_at
// ---------------------------------------------------------------------------

describe('applyProjectReset — clears synthesis_generated_at (WP-008)', () => {
  const SYNTHTS_PLAN = join(tmpdir(), '2026-03-17-reset-synthts-test');
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'reset-synthts-ledger-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('clears synthesis_generated_at to null on project reset', async () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Documentation', [
      'implementation', 'qa', 'code-review', 'documentation',
    ]);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'WP-001.json' },
      ],
      synthesis_generated: true,
      synthesis_generated_at: '2026-03-15T10:00:00Z',
    });

    const store = new LedgerStore(SYNTHTS_PLAN, ledgerRoot);
    await store.writeRootIndex(rootIndex);
    await store.writeWorkPackage('WP-001', wp);

    const diagnosis = analyzeProjectForReset('test', rootIndex, [wp]);
    await applyProjectReset(store, diagnosis, { 'WP-001': { action: 'reset' } });

    const updatedRoot = await store.readRootIndex();
    expect(updatedRoot.synthesis_generated).toBe(false);
    expect(updatedRoot.synthesis_generated_at).toBeNull();
  });

  it('synthesis_generated_at is null (not undefined) even if absent before reset', async () => {
    const wp = makeWp('WP-001', 'COMPLETE', 'Documentation', [
      'implementation', 'qa', 'code-review', 'documentation',
    ]);
    const rootIndex = makeRootIndex({
      status: 'COMPLETE',
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Documentation', dependencies: [], file: 'WP-001.json' },
      ],
      synthesis_generated: true,
      // synthesis_generated_at not set (legacy ledger scenario)
    });

    const store = new LedgerStore(SYNTHTS_PLAN, ledgerRoot);
    await store.writeRootIndex(rootIndex);
    await store.writeWorkPackage('WP-001', wp);

    const diagnosis = analyzeProjectForReset('test', rootIndex, [wp]);
    await applyProjectReset(store, diagnosis, { 'WP-001': { action: 'reset' } });

    const updatedRoot = await store.readRootIndex();
    expect(updatedRoot.synthesis_generated).toBe(false);
    expect(updatedRoot.synthesis_generated_at).toBeNull();
  });
});
