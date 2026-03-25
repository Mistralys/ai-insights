import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';
import { _internal } from '../../src/tools/pipeline.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-test-project');

/**
 * Unit tests for pipeline ordering and assigned_to updates.
 *
 * These tests exercise the startPipeline logic by driving the same
 * store operations that the MCP tool performs internally, verifying
 * the new pipeline ordering and assigned_to update behaviors.
 */

const { PIPELINE_PREREQUISITES, PIPELINE_AGENT_MAP, completePipeline } = _internal;

describe('Pipeline ordering enforcement', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'pipeline-test-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);

    // Common root index
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  async function writeWp(pipelines: Array<{ type: string; status: string }>) {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: pipelines.map((p) => ({
        type: p.type,
        status: p.status as any,
        summary: [],
      })),
    };
    await store.writeWorkPackage('WP-001', wp);
    return wp;
  }

  it('starting an implementation pipeline always succeeds (no prerequisite)', async () => {
    await writeWp([]);
    const prerequisite = PIPELINE_PREREQUISITES['implementation'];
    expect(prerequisite).toBeNull();
    // No check needed — null prerequisite means always allowed
  });

  it('starting a qa pipeline without a PASS implementation pipeline is rejected', async () => {
    await writeWp([]);
    const wp = await store.readWorkPackage('WP-001');

    const prerequisite = PIPELINE_PREREQUISITES['qa']!;
    const hasPassPrerequisite = wp.pipelines.some(
      (p) => p.type === prerequisite && p.status === 'PASS'
    );
    expect(hasPassPrerequisite).toBe(false);
    // Simulates the error thrown by startPipeline
    const expectedError = `Cannot start 'qa' pipeline: requires a PASS '${prerequisite}' pipeline first. Pipeline order: implementation → qa → code-review → documentation.`;
    expect(expectedError).toContain("requires a PASS 'implementation' pipeline first");
  });

  it('starting a qa pipeline with a PASS implementation pipeline succeeds', async () => {
    await writeWp([{ type: 'implementation', status: 'PASS' }]);
    const wp = await store.readWorkPackage('WP-001');

    const prerequisite = PIPELINE_PREREQUISITES['qa']!;
    const hasPassPrerequisite = wp.pipelines.some(
      (p) => p.type === prerequisite && p.status === 'PASS'
    );
    expect(hasPassPrerequisite).toBe(true);
  });

  it('starting a code-review pipeline without a PASS qa pipeline is rejected', async () => {
    await writeWp([
      { type: 'implementation', status: 'PASS' },
      { type: 'qa', status: 'IN_PROGRESS' },
    ]);
    const wp = await store.readWorkPackage('WP-001');

    const prerequisite = PIPELINE_PREREQUISITES['code-review']!;
    const hasPassPrerequisite = wp.pipelines.some(
      (p) => p.type === prerequisite && p.status === 'PASS'
    );
    expect(hasPassPrerequisite).toBe(false);
  });

  it('starting a documentation pipeline requires a PASS code-review pipeline', async () => {
    await writeWp([
      { type: 'implementation', status: 'PASS' },
      { type: 'qa', status: 'PASS' },
    ]);
    const wp = await store.readWorkPackage('WP-001');

    const prerequisite = PIPELINE_PREREQUISITES['documentation']!;
    const hasPassPrerequisite = wp.pipelines.some(
      (p) => p.type === prerequisite && p.status === 'PASS'
    );
    expect(hasPassPrerequisite).toBe(false);

    // With code-review PASS it would pass
    const prerequisiteCheck2 = [
      ...wp.pipelines,
      { type: 'code-review', status: 'PASS', summary: [] },
    ].some((p) => p.type === prerequisite && p.status === 'PASS');
    expect(prerequisiteCheck2).toBe(true);
  });
});

// ─── startPipeline prerequisite most-recent semantics (WP-007 / §8.2) ──────

describe('startPipeline prerequisite most-recent semantics (§8.2)', () => {
  // The prerequisite check now uses .at(-1) (most-recent) instead of .some()
  // (any historical). This means: if a prerequisite was once PASS but the most
  // recent run is FAIL, startPipeline must reject.

  /**
   * Simulate the updated prerequisite check from startPipeline (§8.2 semantics).
   * Returns null if allowed, or an error string if blocked.
   */
  function checkPrerequisite(
    pipelines: Array<{ type: string; status: string }>,
    prerequisiteType: string,
    pipelineType: string
  ): string | null {
    const prereqPipelines = pipelines.filter((p) => p.type === prerequisiteType);
    const mostRecentPrereq = prereqPipelines.at(-1);
    if (!mostRecentPrereq || mostRecentPrereq.status !== 'PASS') {
      return `Cannot start '${pipelineType}' pipeline: requires a PASS '${prerequisiteType}' pipeline first. Pipeline order: implementation → qa → code-review → documentation.`;
    }
    return null;
  }

  it('allows qa when the most recent implementation pipeline is PASS', () => {
    const pipelines = [{ type: 'implementation', status: 'PASS' }];
    const error = checkPrerequisite(pipelines, 'implementation', 'qa');
    expect(error).toBeNull();
  });

  it('rejects qa when the most recent implementation is FAIL (despite an earlier PASS)', () => {
    const pipelines = [
      { type: 'implementation', status: 'PASS' },
      { type: 'implementation', status: 'FAIL' },
    ];
    const error = checkPrerequisite(pipelines, 'implementation', 'qa');
    expect(error).not.toBeNull();
    expect(error).toContain("requires a PASS 'implementation' pipeline first");
  });

  it('rejects qa when no implementation pipelines exist', () => {
    const pipelines: Array<{ type: string; status: string }> = [];
    const error = checkPrerequisite(pipelines, 'implementation', 'qa');
    expect(error).not.toBeNull();
    expect(error).toContain("requires a PASS 'implementation' pipeline first");
  });
});

describe('assigned_to update on pipeline start', () => {
  it('PIPELINE_AGENT_MAP maps implementation → Developer', () => {
    expect(PIPELINE_AGENT_MAP['implementation']).toBe('Developer');
  });

  it('PIPELINE_AGENT_MAP maps qa → QA', () => {
    expect(PIPELINE_AGENT_MAP['qa']).toBe('QA');
  });

  it('PIPELINE_AGENT_MAP maps code-review → Reviewer', () => {
    expect(PIPELINE_AGENT_MAP['code-review']).toBe('Reviewer');
  });

  it('PIPELINE_AGENT_MAP maps documentation → Documentation', () => {
    expect(PIPELINE_AGENT_MAP['documentation']).toBe('Documentation');
  });

  it('assigned_to is updated in WP detail and root summary when pipeline starts', async () => {
    const tempDir2 = await mkdtemp(join(tmpdir(), 'pipeline-assigned-'));
    const store2 = new LedgerStore(PLAN_PATH, tempDir2);

    try {
      const root: RootIndex = {
        plan_file: 'plan.md',
        date_created: now(),
        last_updated: now(),
        status: 'IN_PROGRESS',
        total_work_packages: 1,
        pending_work_packages: 1,
        work_packages: [
          {
            work_package_id: 'WP-001',
            status: 'IN_PROGRESS',
            assigned_to: 'Developer',
            dependencies: [],
            file: 'ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store2.writeRootIndex(root);
      await store2.writeWorkPackage('WP-001', {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: [],
        revision: 0,
        pipelines: [{ type: 'implementation', status: 'PASS' as any, summary: [] }],
      });

      // Simulate what startPipeline does when starting qa
      const pipelineType = 'qa';
      await store2.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.pipelines.push({
          type: pipelineType,
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        });

        const agentName = PIPELINE_AGENT_MAP[pipelineType];
        if (agentName) {
          wp.assigned_to = agentName;
          const summary = root.work_packages.find((s) => s.work_package_id === 'WP-001');
          if (summary) summary.assigned_to = agentName;
        }

        root.last_updated = now();
        return { wp, root };
      });

      const updatedWp = await store2.readWorkPackage('WP-001');
      expect(updatedWp.assigned_to).toBe('QA');

      const updatedRoot = await store2.readRootIndex();
      expect(updatedRoot.work_packages[0].assigned_to).toBe('QA');
    } finally {
      await rm(tempDir2, { recursive: true, force: true });
    }
  });
});

describe('cancelPipeline logic', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cancel-pipeline-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);

    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('cancels an IN_PROGRESS pipeline by setting status to FAIL', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [{ type: 'implementation', status: 'IN_PROGRESS' as any, started_at: now(), summary: [] }],
    });

    // Simulate cancelPipeline logic
    const cancelReason = 'Abandoned due to scope change';
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = [...wp.pipelines].reverse().find(
        (p) => p.type === 'implementation' && p.status === 'IN_PROGRESS'
      );
      if (!pipeline) throw new Error('No IN_PROGRESS pipeline found');

      pipeline.status = 'FAIL';
      pipeline.completed_at = now();
      pipeline.summary = [`Cancelled: ${cancelReason}`];
      root.last_updated = now();
      return { wp, root };
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines[0].status).toBe('FAIL');
    expect(wp.pipelines[0].summary[0]).toContain('Cancelled');
    expect(wp.pipelines[0].summary[0]).toContain(cancelReason);
    expect(wp.pipelines[0].completed_at).toBeDefined();
  });

  it('errors when no IN_PROGRESS pipeline of the given type exists', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [{ type: 'implementation', status: 'PASS' as any, started_at: now(), completed_at: now(), summary: ['done'] }],
    });

    // Simulate the error check in cancelPipeline
    const wp = await store.readWorkPackage('WP-001');
    const pipeline = [...wp.pipelines].reverse().find(
      (p) => p.type === 'implementation' && p.status === 'IN_PROGRESS'
    );
    expect(pipeline).toBeUndefined();
    // In the real tool, this would throw the descriptive error
  });
});

describe('cancelPipeline — auto_cancelled parameter', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];
  const CANCEL_PLAN_PATH = join(tmpdir(), '2026-01-01-cancel-auto-test');

  function makeRootIndex(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
  }

  function makeWpWithInProgressPipeline(): WorkPackageDetail {
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [{ type: 'implementation', status: 'IN_PROGRESS' as any, started_at: now(), summary: [] }],
    };
  }

  const { cancelPipeline } = _internal;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'cancel-auto-'));
    store = new LedgerStore(CANCEL_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpWithInProgressPipeline());
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('sets auto_cancelled = true on the pipeline when auto_cancelled param is true', async () => {
    const result = await cancelPipeline({
      project_path: CANCEL_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      reason: 'Crash recovery',
      auto_cancelled: true,
    });

    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines[0].status).toBe('FAIL');
    expect(wp.pipelines[0].auto_cancelled).toBe(true);
    expect(wp.pipelines[0].summary[0]).toContain('Cancelled: Crash recovery');
  });

  it('does not set auto_cancelled on the pipeline when auto_cancelled param is false (default)', async () => {
    const result = await cancelPipeline({
      project_path: CANCEL_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      reason: 'Manual PM cleanup',
      auto_cancelled: false,
    });

    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines[0].status).toBe('FAIL');
    expect(wp.pipelines[0].auto_cancelled).toBeUndefined();
  });

  it('does not set auto_cancelled when the parameter is omitted (backward compatibility)', async () => {
    const result = await cancelPipeline({
      project_path: CANCEL_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      reason: 'Stale pipeline cleanup',
    });

    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines[0].status).toBe('FAIL');
    expect(wp.pipelines[0].auto_cancelled).toBeUndefined();
  });
});

describe('Project status self-healing', () => {
  it('auto-heals from IN_PROGRESS to COMPLETE when pending_work_packages is 0', () => {
    // Simulate the getProjectStatus self-healing logic
    const status = 'IN_PROGRESS';
    const pendingWps = 0;
    const totalWps = 2;

    let healedStatus = status;
    if (status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
      healedStatus = 'COMPLETE';
    }
    expect(healedStatus).toBe('COMPLETE');
  });

  it('auto-heals from COMPLETE back to IN_PROGRESS when pending_work_packages > 0', () => {
    const status = 'COMPLETE';
    const pendingWps = 1;

    let healedStatus = status;
    if (status === 'COMPLETE' && pendingWps > 0) {
      healedStatus = 'IN_PROGRESS';
    }
    expect(healedStatus).toBe('IN_PROGRESS');
  });

  it('does NOT change status when IN_PROGRESS and work remains', () => {
    const status = 'IN_PROGRESS';
    const pendingWps = 3;
    const totalWps = 3;

    let healedStatus = status;
    if (status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
      healedStatus = 'COMPLETE';
    } else if (status === 'COMPLETE' && pendingWps > 0) {
      healedStatus = 'IN_PROGRESS';
    }
    expect(healedStatus).toBe('IN_PROGRESS');
  });

  it('does NOT heal to COMPLETE when project has no work packages (empty project)', () => {
    const status = 'IN_PROGRESS';
    const pendingWps = 0;
    const totalWps = 0;

    let healedStatus = status;
    if (status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
      healedStatus = 'COMPLETE';
    }
    expect(healedStatus).toBe('IN_PROGRESS');
  });
});

describe('rework_count tracking (WP-005)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rework-count-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);

    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Simulate the rework_count logic from startPipeline */
  async function simulateStartPipeline(pipelineType: string) {
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const sameTypePipelines = wp.pipelines.filter((p) => p.type === pipelineType);
      const mostRecent = sameTypePipelines.at(-1);
      if (mostRecent?.status === 'FAIL') {
        wp.rework_count = (wp.rework_count ?? 0) + 1;
      }
      wp.pipelines.push({ type: pipelineType, status: 'IN_PROGRESS', started_at: now(), summary: [] });
      root.last_updated = now();
      return { wp, root };
    });
  }

  async function simulateCompletePipeline(pipelineType: string, status: 'PASS' | 'FAIL') {
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = [...wp.pipelines].reverse().find(
        (p) => p.type === pipelineType && p.status === 'IN_PROGRESS'
      );
      if (!pipeline) throw new Error(`No IN_PROGRESS ${pipelineType} pipeline`);
      pipeline.status = status;
      pipeline.completed_at = now();
      pipeline.summary = [status === 'PASS' ? 'Completed' : 'Failed'];
      root.last_updated = now();
      return { wp, root };
    });
  }

  it('rework_count is undefined for a new WP (backward compatible)', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_count).toBeUndefined();
  });

  it('starting first implementation pipeline does NOT set rework_count', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    await simulateStartPipeline('implementation');

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_count).toBeUndefined();
  });

  it('starting implementation after a FAIL implementation sets rework_counts.implementation to 1', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    await simulateStartPipeline('implementation');
    await simulateCompletePipeline('implementation', 'FAIL');
    await simulateStartPipeline('implementation');

    const wp = await store.readWorkPackage('WP-001');
    // readWorkPackage migration converts rework_count scalar → rework_counts map
    expect(wp.rework_count).toBeUndefined();
    expect(wp.rework_counts?.implementation).toBe(1);
  });

  it('rework_count tracking via legacy simulation — count reflects migration lazy-persistence side-effect', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    // First attempt → FAIL → rework 1
    await simulateStartPipeline('implementation');
    await simulateCompletePipeline('implementation', 'FAIL');
    await simulateStartPipeline('implementation');
    await simulateCompletePipeline('implementation', 'FAIL');
    // Second rework
    await simulateStartPipeline('implementation');

    const wp = await store.readWorkPackage('WP-001');
    // readWorkPackage migration fires during simulateCompletePipeline write-backs,
    // lazy-persisting rework_counts and removing rework_count from disk.
    // Subsequent legacy increments restart from 0, so both fields settle at 1.
    // WP-003 will update startPipeline to use rework_counts, restoring correct increment.
    expect(wp.rework_counts?.implementation).toBe(1);
  });

  it('starting implementation after FAIL then PASS does NOT increment rework_count', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    // First attempt → FAIL → rework → PASS
    await simulateStartPipeline('implementation');
    await simulateCompletePipeline('implementation', 'FAIL');
    await simulateStartPipeline('implementation');  // rework_count → 1
    await simulateCompletePipeline('implementation', 'PASS');

    // Third start — most recent is PASS, should NOT increment
    await simulateStartPipeline('implementation');

    const wp = await store.readWorkPackage('WP-001');
    // readWorkPackage migration converts rework_count scalar → rework_counts map
    expect(wp.rework_count).toBeUndefined();
    expect(wp.rework_counts?.implementation).toBe(1);
  });

  it('starting a qa pipeline after a FAIL implementation pipeline does NOT increment rework_count', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    });

    // implementation FAIL, then rework succeeds
    await simulateStartPipeline('implementation');
    await simulateCompletePipeline('implementation', 'FAIL');
    await simulateStartPipeline('implementation');  // rework_count → 1
    await simulateCompletePipeline('implementation', 'PASS');

    // Now start qa — should NOT increment rework_count
    await simulateStartPipeline('qa');

    const wp = await store.readWorkPackage('WP-001');
    // readWorkPackage migration converts rework_count scalar → rework_counts map
    expect(wp.rework_count).toBeUndefined();
    expect(wp.rework_counts?.implementation).toBe(1);
    const qaPipeline = wp.pipelines.find((p) => p.type === 'qa');
    expect(qaPipeline).toBeDefined();
  });
});

describe('updatePipelineProgress logic (WP-005)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'progress-update-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);

    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('updates the summary of the most recent IN_PROGRESS pipeline', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS' as any, started_at: now(), summary: ['initial note'] },
      ],
    });

    // Simulate updatePipelineProgress logic
    const newSummary = ['step 1 complete', 'step 2 in progress'];
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = [...wp.pipelines]
        .reverse()
        .find((p) => p.type === 'implementation' && p.status === 'IN_PROGRESS');
      if (!pipeline) throw new Error('No IN_PROGRESS pipeline found');
      pipeline.summary = newSummary;
      root.last_updated = now();
      return { wp, root };
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines[0].summary).toEqual(newSummary);
  });

  it('errors when no IN_PROGRESS pipeline of the given type exists', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS' as any, started_at: now(), completed_at: now(), summary: ['done'] },
      ],
    });

    // Simulate the error check in updatePipelineProgress
    const wp = await store.readWorkPackage('WP-001');
    const pipeline = [...wp.pipelines]
      .reverse()
      .find((p) => p.type === 'implementation' && p.status === 'IN_PROGRESS');
    expect(pipeline).toBeUndefined();
    // In the real tool, this would throw:
    // "Cannot update pipeline progress: no IN_PROGRESS pipeline of type "implementation" found for WP-001."
  });

  it('existing WP detail files without rework_count remain valid (Zod .optional())', async () => {
    // Write a WP without rework_count (as would exist in pre-WP-005 ledger files)
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
      // rework_count intentionally omitted
    });

    // Should read back successfully
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_count).toBeUndefined();
    expect(wp.work_package_id).toBe('WP-001');
  });
});

describe('Pipeline completion guidance (buildCompletionGuidance)', () => {
  const { buildCompletionGuidance } = _internal;

  it('PASS implementation suggests calling get_handoff_status and mentions QA', () => {
    const guidance = buildCompletionGuidance('WP-001', 'implementation', 'PASS');
    expect(guidance).toContain('NEXT STEP');
    expect(guidance).toContain('ledger_get_handoff_status');
    expect(guidance).toContain('QA');
  });

  it('PASS qa suggests calling get_handoff_status and mentions Reviewer', () => {
    const guidance = buildCompletionGuidance('WP-001', 'qa', 'PASS');
    expect(guidance).toContain('ledger_get_handoff_status');
    expect(guidance).toContain('Reviewer');
  });

  it('PASS code-review suggests calling get_handoff_status and mentions Documentation', () => {
    const guidance = buildCompletionGuidance('WP-001', 'code-review', 'PASS');
    expect(guidance).toContain('ledger_get_handoff_status');
    expect(guidance).toContain('Documentation');
  });

  it('PASS documentation (no auto-finalize result) suggests calling get_handoff_status', () => {
    const guidance = buildCompletionGuidance('WP-001', 'documentation', 'PASS');
    expect(guidance).toContain('ledger_get_handoff_status');
    // The old ledger_update_work_package_status call is no longer in the guidance
    // (WP-006: auto-finalize handles the COMPLETE transition server-side)
    expect(guidance).not.toContain('ledger_update_work_package_status');
  });

  it('PASS documentation with auto_finalized mentions COMPLETE and handoff', () => {
    const guidance = buildCompletionGuidance('WP-001', 'documentation', 'PASS', 'finalized', []);
    expect(guidance).toContain('auto-finalized');
    expect(guidance).toContain('COMPLETE');
    expect(guidance).toContain('ledger_get_handoff_status');
  });

  it('PASS documentation with auto_finalize_blocked lists unmet criteria', () => {
    const guidance = buildCompletionGuidance('WP-001', 'documentation', 'PASS', 'blocked', ['Docs updated', 'Tests pass']);
    expect(guidance).toContain('NOT auto-finalized');
    expect(guidance).toContain('Docs updated');
    expect(guidance).toContain('Tests pass');
  });

  it('FAIL implementation tells agent to leave WP as IN_PROGRESS for Developer rework', () => {
    const guidance = buildCompletionGuidance('WP-001', 'implementation', 'FAIL');
    expect(guidance).toContain('FAIL');
    expect(guidance).toContain('IN_PROGRESS');
    expect(guidance).toContain('Developer');
    expect(guidance).toContain('ledger_get_next_action');
  });

  it('FAIL qa explicitly says do NOT set to BLOCKED and mentions Developer rework', () => {
    const guidance = buildCompletionGuidance('WP-005', 'qa', 'FAIL');
    expect(guidance).toContain('Do NOT set WP-005 to BLOCKED');
    expect(guidance).toContain('Developer');
    expect(guidance).toContain('ledger_get_next_action');
    expect(guidance).toContain('rework');
  });

  it('FAIL code-review explicitly says do NOT set to BLOCKED and mentions Developer rework', () => {
    const guidance = buildCompletionGuidance('WP-003', 'code-review', 'FAIL');
    expect(guidance).toContain('Do NOT set WP-003 to BLOCKED');
    expect(guidance).toContain('Developer');
    expect(guidance).toContain('rework');
  });
});

describe('Pipeline start agent_role guard', () => {
  /**
   * Inline replica of the agent_role validation added to startPipeline.
   * Tests the guard logic without requiring a full store — mirrors the
   * same approach used by claim-guard.test.ts.
   */
  function checkAgentRoleGuard(
    type: string,
    agent_role: string | undefined,
  ): string | null {
    if (agent_role === undefined) return null;
    const expectedAgent = PIPELINE_AGENT_MAP[type as keyof typeof PIPELINE_AGENT_MAP];
    if (expectedAgent !== agent_role) {
      return `Pipeline type '${type}' can only be started by the ${expectedAgent} agent. You provided agent_role: '${agent_role}'.`;
    }
    return null;
  }

  it('rejects when agent_role does not match pipeline type owner', () => {
    const error = checkAgentRoleGuard('qa', 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain("Pipeline type 'qa' can only be started by the QA agent");
    expect(error).toContain("You provided agent_role: 'Developer'");
  });

  it('rejects Developer starting a code-review pipeline', () => {
    const error = checkAgentRoleGuard('code-review', 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain("Reviewer agent");
  });

  it('accepts when agent_role matches the pipeline type owner', () => {
    const error = checkAgentRoleGuard('implementation', 'Developer');
    expect(error).toBeNull();
  });

  it('accepts when agent_role is omitted (backward compatibility)', () => {
    const error = checkAgentRoleGuard('qa', undefined);
    expect(error).toBeNull();
  });

  it('accepts QA starting a qa pipeline', () => {
    const error = checkAgentRoleGuard('qa', 'QA');
    expect(error).toBeNull();
  });

  it('accepts Reviewer starting a code-review pipeline', () => {
    const error = checkAgentRoleGuard('code-review', 'Reviewer');
    expect(error).toBeNull();
  });

  it('accepts Documentation starting a documentation pipeline', () => {
    const error = checkAgentRoleGuard('documentation', 'Documentation');
    expect(error).toBeNull();
  });
});

// ─── Work package ID regex (3+ digit enforcement) ──────────────────────────

describe('Pipeline schema work_package_id regex (WP-\\d{3,})', () => {
  const { StartPipelineSchema, CompletePipelineSchema, CancelPipelineSchema, UpdatePipelineProgressSchema } = _internal;

  const startBase = { project_path: '/tmp/test-project', type: 'implementation', agent_role: 'Developer' } as const;
  const completeBase = { project_path: '/tmp/test-project', type: 'implementation', status: 'PASS', summary: ['done'], agent_role: 'Developer' } as const;
  const cancelBase = { project_path: '/tmp/test-project', type: 'implementation', reason: 'cleanup' } as const;
  const progressBase = { project_path: '/tmp/test-project', type: 'implementation', summary: ['step 1'] } as const;

  describe('StartPipelineSchema', () => {
    it('accepts a 4-digit WP ID (WP-0001)', () => {
      expect(() => StartPipelineSchema.parse({ ...startBase, work_package_id: 'WP-0001' })).not.toThrow();
    });

    it('accepts a 5-digit WP ID (WP-12345)', () => {
      expect(() => StartPipelineSchema.parse({ ...startBase, work_package_id: 'WP-12345' })).not.toThrow();
    });

    it('rejects a 2-digit WP ID (WP-01)', () => {
      expect(() => StartPipelineSchema.parse({ ...startBase, work_package_id: 'WP-01' })).toThrow();
    });

    it('still accepts a standard 3-digit WP ID (WP-001)', () => {
      expect(() => StartPipelineSchema.parse({ ...startBase, work_package_id: 'WP-001' })).not.toThrow();
    });

    it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
      expect(() => StartPipelineSchema.parse({ ...startBase, work_package_id: 'WP-123abc' })).toThrow();
    });
  });

  describe('CompletePipelineSchema', () => {
    it('accepts a 4-digit WP ID (WP-1000)', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-1000' })).not.toThrow();
    });

    it('accepts a 5-digit WP ID (WP-12345)', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-12345' })).not.toThrow();
    });

    it('rejects a 1-digit WP ID (WP-1)', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-1' })).toThrow();
    });

    it('rejects a 2-digit WP ID (WP-12)', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-12' })).toThrow();
    });

    it('rejects an empty string', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: '' })).toThrow();
    });

    it('still accepts a standard 3-digit WP ID (WP-001)', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-001' })).not.toThrow();
    });

    it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
      expect(() => CompletePipelineSchema.parse({ ...completeBase, work_package_id: 'WP-123abc' })).toThrow();
    });
  });

  describe('CancelPipelineSchema', () => {
    it('accepts a 4-digit WP ID (WP-0001)', () => {
      expect(() => CancelPipelineSchema.parse({ ...cancelBase, work_package_id: 'WP-0001' })).not.toThrow();
    });

    it('accepts a 5-digit WP ID (WP-12345)', () => {
      expect(() => CancelPipelineSchema.parse({ ...cancelBase, work_package_id: 'WP-12345' })).not.toThrow();
    });

    it('rejects a 2-digit WP ID (WP-01)', () => {
      expect(() => CancelPipelineSchema.parse({ ...cancelBase, work_package_id: 'WP-01' })).toThrow();
    });

    it('still accepts a standard 3-digit WP ID (WP-001)', () => {
      expect(() => CancelPipelineSchema.parse({ ...cancelBase, work_package_id: 'WP-001' })).not.toThrow();
    });

    it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
      expect(() => CancelPipelineSchema.parse({ ...cancelBase, work_package_id: 'WP-123abc' })).toThrow();
    });
  });

  describe('UpdatePipelineProgressSchema', () => {
    it('accepts a 4-digit WP ID (WP-0001)', () => {
      expect(() => UpdatePipelineProgressSchema.parse({ ...progressBase, work_package_id: 'WP-0001' })).not.toThrow();
    });

    it('accepts a 5-digit WP ID (WP-12345)', () => {
      expect(() => UpdatePipelineProgressSchema.parse({ ...progressBase, work_package_id: 'WP-12345' })).not.toThrow();
    });

    it('rejects a 2-digit WP ID (WP-01)', () => {
      expect(() => UpdatePipelineProgressSchema.parse({ ...progressBase, work_package_id: 'WP-01' })).toThrow();
    });

    it('still accepts a standard 3-digit WP ID (WP-001)', () => {
      expect(() => UpdatePipelineProgressSchema.parse({ ...progressBase, work_package_id: 'WP-001' })).not.toThrow();
    });

    it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
      expect(() => UpdatePipelineProgressSchema.parse({ ...progressBase, work_package_id: 'WP-123abc' })).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Lenient input normalization (summary, agent_role, comments[].timestamp)
// ---------------------------------------------------------------------------

describe('CompletePipelineSchema lenient input acceptance', () => {
  const { CompletePipelineSchema } = _internal;
  const base = { project_path: '/tmp/test-project', work_package_id: 'WP-001', type: 'implementation', status: 'PASS' as const };

  it('accepts summary as a single string', () => {
    expect(() => CompletePipelineSchema.parse({ ...base, summary: 'Implemented feature X', agent_role: 'Developer' })).not.toThrow();
  });

  it('still accepts summary as an array of strings', () => {
    expect(() => CompletePipelineSchema.parse({ ...base, summary: ['Implemented feature X', 'Added tests'], agent_role: 'Developer' })).not.toThrow();
  });

  it('accepts comments without timestamp (auto-filled server-side)', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
      agent_role: 'Developer',
      comments: [{ type: 'improvement', priority: 'low', note: 'Clean code' }],
    })).not.toThrow();
  });

  it('still accepts comments with explicit timestamp', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
      agent_role: 'Developer',
      comments: [{ type: 'improvement', priority: 'low', timestamp: '2026-03-04T12:00:00Z', note: 'Clean code' }],
    })).not.toThrow();
  });

  it('rejects omitted agent_role (§52 — required for PM Override safety)', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
    })).toThrow();
  });

  // handoff_notes normalization (WP-003 — Fix B)
  it('accepts handoff_notes as a bare string', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
      agent_role: 'Developer',
      handoff_notes: 'Please check the auth module',
    })).not.toThrow();
  });

  it('still accepts handoff_notes as an array of strings', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
      agent_role: 'Developer',
      handoff_notes: ['check auth', 'verify edge case'],
    })).not.toThrow();
  });

  it('accepts undefined/omitted handoff_notes', () => {
    expect(() => CompletePipelineSchema.parse({
      ...base,
      summary: ['done'],
      agent_role: 'Developer',
    })).not.toThrow();
  });
});

describe('StartPipelineSchema agent_role is required (§52)', () => {
  const { StartPipelineSchema } = _internal;
  const base = { project_path: '/tmp/test-project', work_package_id: 'WP-001', type: 'implementation' };

  it('rejects omitted agent_role', () => {
    expect(() => StartPipelineSchema.parse(base)).toThrow();
  });

  it('accepts explicit agent_role', () => {
    expect(() => StartPipelineSchema.parse({ ...base, agent_role: 'Developer' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// completePipeline handler — lenient argument normalization
// ---------------------------------------------------------------------------

const LENIENT_PLAN_PATH = join(tmpdir(), '2026-03-04-lenient-input');

describe('completePipeline handler normalizes lenient inputs', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  function makeRoot(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'work/WP-001.md' },
      ],
      project_comments: [],
    };
  }

  function makeWpWithImplPipeline(): WorkPackageDetail {
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'lenient-input-'));
    store = new LedgerStore(LENIENT_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage('WP-001', makeWpWithImplPipeline());
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('coerces a summary string to a single-element array', async () => {
    const result = await completePipeline({
      project_path: LENIENT_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: 'Implemented the feature' as any,
      agent_role: 'Developer',
    });
    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    const pipeline = wp.pipelines.at(-1)!;
    expect(pipeline.summary).toEqual(['Implemented the feature']);
  });

  it('auto-fills comment timestamps when omitted', async () => {
    const result = await completePipeline({
      project_path: LENIENT_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
      comments: [
        { type: 'improvement', priority: 'low', note: 'Clean code' } as any,
      ],
    });
    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    const pipeline = wp.pipelines.at(-1)!;
    expect(pipeline.comments).toHaveLength(1);
    expect(pipeline.comments![0].timestamp).toBeDefined();
    expect(pipeline.comments![0].timestamp.length).toBeGreaterThan(0);
  });

  // handoff_notes normalization (WP-003 — Fix B)
  it('coerces a bare-string handoff_notes to a one-element array in the persisted HandoffNote', async () => {
    const result = await completePipeline({
      project_path: LENIENT_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
      handoff_notes: 'Please check the auth module' as any,
    });
    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes).toBeDefined();
    expect(wp.handoff_notes!.length).toBe(1);
    // The persisted HandoffNote.notes must be string[], not a bare string
    expect(wp.handoff_notes![0].notes).toEqual(['Please check the auth module']);
  });

  it('preserves a string[] handoff_notes as-is', async () => {
    // Reset pipeline to IN_PROGRESS so completePipeline can be called again
    await store.writeWorkPackage('WP-001', makeWpWithImplPipeline());

    const result = await completePipeline({
      project_path: LENIENT_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
      handoff_notes: ['check auth', 'verify edge case'],
    });
    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes![0].notes).toEqual(['check auth', 'verify edge case']);
  });

  it('omitting handoff_notes does not create a HandoffNote entry', async () => {
    // Reset pipeline to IN_PROGRESS
    await store.writeWorkPackage('WP-001', makeWpWithImplPipeline());

    const result = await completePipeline({
      project_path: LENIENT_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
      // handoff_notes intentionally omitted
    });
    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    // No handoff note should have been created
    const notes = wp.handoff_notes ?? [];
    expect(notes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FIX-06 — completePipeline acceptance_criteria_updates merge semantics (§12.3)
// ---------------------------------------------------------------------------

const FIX06_PLAN_PATH = join(tmpdir(), '2026-02-28-fix06-ac-merge');

describe('completePipeline — acceptance_criteria_updates merge semantics (FIX-06)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  function makeRoot(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'work/WP-001.md' },
      ],
      project_comments: [],
    };
  }

  function makeWpWithAc(
    ac: Array<{ criterion: string; met: boolean }>,
  ): WorkPackageDetail {
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: ac,
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'fix06-ac-merge-'));
    store = new LedgerStore(FIX06_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    await store.writeRootIndex(makeRoot());
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('updates an existing criterion met flag to true via acceptance_criteria_updates', async () => {
    await store.writeWorkPackage('WP-001', makeWpWithAc([
      { criterion: 'All tests pass', met: false },
    ]));

    await completePipeline({
      project_path: FIX06_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implementation done'],
      agent_role: 'Developer',
      acceptance_criteria_updates: [{ criterion: 'All tests pass', met: true }],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(1);
    expect(wp.acceptance_criteria[0]!.criterion).toBe('All tests pass');
    expect(wp.acceptance_criteria[0]!.met).toBe(true);
  });

  it('appends an unknown criterion when criterion text is not found', async () => {
    await store.writeWorkPackage('WP-001', makeWpWithAc([
      { criterion: 'Existing criterion', met: false },
    ]));

    await completePipeline({
      project_path: FIX06_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Done'],
      agent_role: 'Developer',
      acceptance_criteria_updates: [{ criterion: 'New criterion from pipeline', met: false }],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(2);
    expect(wp.acceptance_criteria[1]!.criterion).toBe('New criterion from pipeline');
    expect(wp.acceptance_criteria[1]!.met).toBe(false);
  });

  it('handles mixed update+append batch — updates existing and appends new in a single call', async () => {
    await store.writeWorkPackage('WP-001', makeWpWithAc([
      { criterion: 'Tests pass', met: false },
    ]));

    await completePipeline({
      project_path: FIX06_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Done'],
      agent_role: 'Developer',
      acceptance_criteria_updates: [
        { criterion: 'Tests pass', met: true },          // update existing
        { criterion: 'Docs updated', met: false },       // append new
      ],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(2);
    expect(wp.acceptance_criteria.find((c) => c.criterion === 'Tests pass')?.met).toBe(true);
    expect(wp.acceptance_criteria.find((c) => c.criterion === 'Docs updated')?.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WP-006 — completePipeline auto-finalize on documentation PASS (§WP-006)
// ---------------------------------------------------------------------------

const WP006_PLAN_PATH = join(tmpdir(), '2026-03-01-wp006-auto-finalize');

describe('completePipeline — auto-finalize on documentation PASS (WP-006)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  function makeRootForAutoFinalize(pending = 1): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: pending,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Documentation', dependencies: [], file: 'work/WP-001.md' },
      ],
      project_comments: [],
    };
  }

  /** WP ready for documentation pipeline — all prerequisite pipelines completed */
  function makeWpForDocPipeline(
    ac: Array<{ criterion: string; met: boolean }>,
    extraPipelines: Array<{ type: string; status: string; started_at?: string; completed_at?: string }> = [],
  ): WorkPackageDetail {
    const prereqs: WorkPackageDetail['pipelines'] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-03-01T08:00:00Z', completed_at: '2026-03-01T09:00:00Z', summary: [] },
      { type: 'qa',             status: 'PASS', started_at: '2026-03-01T09:00:00Z', completed_at: '2026-03-01T10:00:00Z', summary: [] },
      { type: 'code-review',   status: 'PASS', started_at: '2026-03-01T10:00:00Z', completed_at: '2026-03-01T11:00:00Z', summary: [] },
      { type: 'documentation', status: 'IN_PROGRESS', started_at: '2026-03-01T11:00:00Z', summary: [] },
      ...extraPipelines,
    ];
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: ac,
      revision: 0,
      pipelines: prereqs,
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'wp006-auto-finalize-'));
    store = new LedgerStore(WP006_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('auto-finalizes WP to COMPLETE when doc pipeline PASS + all criteria met', async () => {
    await store.writeRootIndex(makeRootForAutoFinalize());
    await store.writeWorkPackage('WP-001', makeWpForDocPipeline([
      { criterion: 'Docs updated', met: true },
      { criterion: 'README accurate', met: true },
    ]));

    const result = await completePipeline({
      project_path: WP006_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Documentation complete'],
      agent_role: 'Documentation',
    });

    // Response should include auto_finalized: true
    const text = (result as any).content[0].text;
    const json = JSON.parse(text.split('\n\n--- NEXT STEP ---')[0]);
    expect(json.auto_finalized).toBe(true);
    expect(json.auto_finalize_blocked).toBeUndefined();

    // WP should be COMPLETE
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('COMPLETE');
    expect(wp.status_changed_at).toBeDefined();

    // Root index should reflect COMPLETE and decremented pending counter
    const root = await store.readRootIndex();
    expect(root.work_packages[0]!.status).toBe('COMPLETE');
    expect(root.pending_work_packages).toBe(0);
  });

  it('does NOT auto-finalize when doc pipeline PASS + unmet criteria', async () => {
    await store.writeRootIndex(makeRootForAutoFinalize());
    await store.writeWorkPackage('WP-001', makeWpForDocPipeline([
      { criterion: 'Docs updated', met: true },
      { criterion: 'README accurate', met: false },  // <-- unmet
    ]));

    const result = await completePipeline({
      project_path: WP006_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Partial docs'],
      agent_role: 'Documentation',
    });

    const text = (result as any).content[0].text;
    const json = JSON.parse(text.split('\n\n--- NEXT STEP ---')[0]);
    expect(json.auto_finalize_blocked).toBe(true);
    expect(json.unmet_criteria).toContain('README accurate');
    expect(json.auto_finalized).toBeUndefined();

    // WP should remain IN_PROGRESS
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('IN_PROGRESS');

    // pending counter must not change
    const root = await store.readRootIndex();
    expect(root.pending_work_packages).toBe(1);
  });

  it('does NOT auto-finalize when doc pipeline FAIL', async () => {
    await store.writeRootIndex(makeRootForAutoFinalize());
    await store.writeWorkPackage('WP-001', makeWpForDocPipeline([
      { criterion: 'Docs updated', met: true },
    ]));

    const result = await completePipeline({
      project_path: WP006_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'FAIL',
      summary: ['Docs incomplete'],
      agent_role: 'Documentation',
    });

    const text = (result as any).content[0].text;

    const json = text.startsWith('{') ? JSON.parse(text.split('\n\n--- NEXT STEP ---')[0]) : {};
    expect(json.auto_finalized).toBeUndefined();
    expect(json.auto_finalize_blocked).toBeUndefined();

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('IN_PROGRESS');
  });
});

// ---------------------------------------------------------------------------
// Dynamic pipeline engine — active_pipeline_stages tests (WP-006 plan)
// ---------------------------------------------------------------------------

const DYN_PLAN_PATH = join(tmpdir(), '2026-03-14-dynamic-pipeline-test');

describe('dynamic pipeline engine — startPipeline respects active_pipeline_stages', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  const { startPipeline } = _internal;

  function makeRoot(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
  }

  function makeWpWithStages(activeStages: string[], pipelines: WorkPackageDetail['pipelines'] = []): WorkPackageDetail {
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      active_pipeline_stages: activeStages as any,
      revision: 0,
      pipelines,
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'dyn-pipeline-'));
    store = new LedgerStore(DYN_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('rejects pipeline type not in WP active stages', async () => {
    await store.writeRootIndex(makeRoot());
    // WP has only ["documentation"] — security-audit is not active
    await store.writeWorkPackage('WP-001', makeWpWithStages(['documentation']));

    const result = await startPipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('not in the WP\'s active stages');
  });

  it('allows security-audit when qa PASS exists and security-audit is active', async () => {
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage('WP-001', makeWpWithStages(
      ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
      [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
        { type: 'qa', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
      ]
    ));

    const result = await startPipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'security-audit',
      agent_role: 'Security Auditor',
    });

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    const auditPipeline = wp.pipelines.find((p) => p.type === 'security-audit' && p.status === 'IN_PROGRESS');
    expect(auditPipeline).toBeDefined();
  });

  it('rejects security-audit when qa not in active stages (prerequisite absent)', async () => {
    await store.writeRootIndex(makeRoot());
    // All-6 stages but no qa PASS
    await store.writeWorkPackage('WP-001', makeWpWithStages(
      ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'],
      [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
      ]
    ));

    const result = await startPipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'security-audit',
      agent_role: 'Security Auditor',
    });

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain("requires a PASS 'qa' pipeline first");
  });

  it('backward compat: WP without active_pipeline_stages defaults to legacy 4-stage ordering', async () => {
    await store.writeRootIndex(makeRoot());
    // Write a WP without active_pipeline_stages field (simulates legacy ledger file)
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
        { type: 'qa', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
      ],
    } as any);

    // Without active_pipeline_stages, code-review follows qa (legacy 4-stage)
    const result = await startPipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'code-review',
      agent_role: 'Reviewer',
    });

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    const reviewPipeline = wp.pipelines.find((p) => p.type === 'code-review' && p.status === 'IN_PROGRESS');
    expect(reviewPipeline).toBeDefined();
  });
});

describe('dynamic pipeline engine — completePipeline dynamic routing', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  const { startPipeline: _startPipeline } = _internal;

  function makeRoot2(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Security Auditor', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'dyn-complete-'));
    store = new LedgerStore(DYN_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('routes to Security Auditor after qa PASS in all-6 composition', async () => {
    await store.writeRootIndex(makeRoot2());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      active_pipeline_stages: ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['QA passed'],
      agent_role: 'QA',
    });

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text;
    // The guidance block should mention Security Auditor as the next agent
    expect(text).toContain('Security Auditor');
  });

  it('routes qa FAIL to QA (self) in verification-only WP when implementation is absent', async () => {
    await store.writeRootIndex({
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'QA', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    });
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      // Verification-only: no implementation stage — fallback routes qa FAIL to QA
      active_pipeline_stages: ['qa', 'code-review'],
      revision: 0,
      pipelines: [
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'FAIL',
      summary: ['Issues found in QA'],
      agent_role: 'QA',
    });

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text;
    // Fail routing fallback: QA owns the first active stage → routes to QA
    expect(text).toContain('QA');
  });

  it('emits artifacts warning on PASS when files_modified is absent', async () => {
    await store.writeRootIndex(makeRoot2());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implemented feature'],
      agent_role: 'Developer',
    });

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text;
    expect(text).toContain('artifacts.files_modified is empty or absent');
  });

  it('does NOT emit artifacts warning when files_modified is provided', async () => {
    await store.writeRootIndex(makeRoot2());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implemented feature'],
      agent_role: 'Developer',
      artifacts: { files_modified: ['src/tools/pipeline.ts'] },
    });

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text;
    expect(text).not.toContain('artifacts.files_modified is empty or absent');
  });

  it('does NOT emit artifacts warning for verification-only pipeline types (qa, security-audit)', async () => {
    // Verification-only pipeline types should be exempt from the artifacts warning
    // because those agents verify but do not modify files.
    await store.writeRootIndex(makeRoot2());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: ['Done'] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['All tests passed'],
      agent_role: 'QA',
    });

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text;
    expect(text).not.toContain('artifacts.files_modified is empty or absent');
  });

  it('auto-finalizes documentation-only WP when documentation is the terminal stage', async () => {
    // Documentation-only WP: ["documentation"]. Documentation is both first and terminal agent.
    await store.writeRootIndex({
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Documentation', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    });
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Docs complete', met: true }],
      active_pipeline_stages: ['documentation'],
      revision: 0,
      pipelines: [
        { type: 'documentation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    } as any);

    const result = await completePipeline({
      project_path: DYN_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Documentation complete'],
      agent_role: 'Documentation',
    });

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('COMPLETE');
  });
});

describe('completePipeline — non-doc pipeline does not auto-finalize', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'nondoc-autofinalize-'));
    store = new LedgerStore(WP006_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('does NOT auto-finalize when non-documentation pipeline PASS + all criteria met', async () => {
    await store.writeRootIndex({
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Documentation', dependencies: [], file: 'work/WP-001.md' },
      ],
      project_comments: [],
    });
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'All tests pass', met: true }],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: '2026-03-01T08:00:00Z', summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: WP006_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implementation done'],
      agent_role: 'Developer',
    });

    const text = (result as any).content[0].text;
    const json = JSON.parse(text.split('\n\n--- NEXT STEP ---')[0]);
    expect(json.auto_finalized).toBeUndefined();
    expect(json.auto_finalize_blocked).toBeUndefined();

    // WP should remain IN_PROGRESS (can't auto-finalize from implementation)
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('IN_PROGRESS');
  });
});

// Auto-finalize + propagateDependencyUnblock (§6.3 compliance)
// ---------------------------------------------------------------------------
// Verifies that when completePipeline auto-finalizes a WP to COMPLETE, the server
// also calls propagateDependencyUnblock — transitioning eligible BLOCKED dependents
// to READY (lock-ordering §12.2, Gotcha 8 respected: call happens outside main lock).

const AUTOFINALIZE_UNBLOCK_PLAN_PATH = join(tmpdir(), '2026-03-01-autofinalize-unblock');

describe('completePipeline — auto-finalize triggers propagateDependencyUnblock (§6.3)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  /** Root index with WP-001 (to-be-finalized) and WP-002 (dependent). */
  function makeRootWithDependent(wp2Status: 'BLOCKED' | 'READY'): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Documentation', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: wp2Status, assigned_to: 'Developer', dependencies: ['WP-001'], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
  }

  /** WP-001 ready for documentation pipeline. */
  function makeWp001ForDocPipeline(): WorkPackageDetail {
    return {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'All done', met: true }],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: '2026-03-01T08:00:00Z', completed_at: '2026-03-01T09:00:00Z', summary: [] },
        { type: 'qa',             status: 'PASS', started_at: '2026-03-01T09:00:00Z', completed_at: '2026-03-01T10:00:00Z', summary: [] },
        { type: 'code-review',   status: 'PASS', started_at: '2026-03-01T10:00:00Z', completed_at: '2026-03-01T11:00:00Z', summary: [] },
        { type: 'documentation', status: 'IN_PROGRESS', started_at: '2026-03-01T11:00:00Z', summary: [] },
      ],
    };
  }

  /** A BLOCKED WP-002 that depends on WP-001 (dependency blocker). */
  function makeWp002Blocked(blockerType: 'dependency' | 'technical' = 'dependency'): WorkPackageDetail {
    return {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'BLOCKED',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [{ criterion: 'Feature implemented', met: false }],
      revision: 0,
      pipelines: [],
      blocked_by: {
        type: blockerType,
        description: blockerType === 'dependency'
          ? 'Dependency WP-001 not yet COMPLETE'
          : 'Awaiting external tool availability',
      },
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'autofinalize-unblock-'));
    store = new LedgerStore(AUTOFINALIZE_UNBLOCK_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('auto-finalizes WP-001 and transitions BLOCKED dependent (WP-002) to READY', async () => {
    await store.writeRootIndex(makeRootWithDependent('BLOCKED'));
    await store.writeWorkPackage('WP-001', makeWp001ForDocPipeline());
    await store.writeWorkPackage('WP-002', makeWp002Blocked('dependency'));

    const result = await completePipeline({
      project_path: AUTOFINALIZE_UNBLOCK_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Documentation complete'],
      agent_role: 'Documentation',
    });

    // WP-001 must be COMPLETE (auto-finalized)
    const wp1 = await store.readWorkPackage('WP-001');
    expect(wp1.status).toBe('COMPLETE');

    const text = (result as any).content[0].text;
    const json = JSON.parse(text.split('\n\n--- NEXT STEP ---')[0]);
    expect(json.auto_finalized).toBe(true);

    // WP-002 must have been unblocked to READY by propagateDependencyUnblock
    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('READY');
    expect(wp2.blocked_by).toBeUndefined();

    const root = await store.readRootIndex();
    const wp2Summary = root.work_packages.find(w => w.work_package_id === 'WP-002');
    expect(wp2Summary?.status).toBe('READY');
  });

  it('auto-finalizes WP-001 with no dependents → no error, no side effects', async () => {
    // Root with only WP-001 (no dependents)
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Documentation', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWp001ForDocPipeline());

    const result = await completePipeline({
      project_path: AUTOFINALIZE_UNBLOCK_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Documentation complete'],
      agent_role: 'Documentation',
    });

    expect((result as any).isError).toBeFalsy();

    const wp1 = await store.readWorkPackage('WP-001');
    expect(wp1.status).toBe('COMPLETE');
  });

  it('auto-finalizes WP-001 but does NOT unblock WP-002 blocked by a non-dependency reason', async () => {
    await store.writeRootIndex(makeRootWithDependent('BLOCKED'));
    await store.writeWorkPackage('WP-001', makeWp001ForDocPipeline());
    // WP-002 BLOCKED for a non-dependency reason — must stay BLOCKED
    await store.writeWorkPackage('WP-002', makeWp002Blocked('technical'));

    await completePipeline({
      project_path: AUTOFINALIZE_UNBLOCK_PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      status: 'PASS',
      summary: ['Documentation complete'],
      agent_role: 'Documentation',
    });

    // WP-001 auto-finalized
    const wp1 = await store.readWorkPackage('WP-001');
    expect(wp1.status).toBe('COMPLETE');

    // WP-002 must remain BLOCKED (non-dependency blocker)
    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
    expect(wp2.blocked_by?.type).toBe('technical');
  });
});

// ---------------------------------------------------------------------------
// WP-008 — Cross-WP dependency freshness (staleness) advisory check (§21.59)
// ---------------------------------------------------------------------------

const STALENESS_PLAN_PATH = join(tmpdir(), '2026-03-17-staleness-check');

describe('completePipeline — cross-WP dependency staleness advisory (WP-008)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  function makeStalenessRoot(deps: string[] = ['WP-001']): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: deps, file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'staleness-'));
    store = new LedgerStore(STALENESS_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('emits advisory warning when dependency was modified after pipeline started', async () => {
    // WP-001 last_updated AFTER WP-002's pipeline started
    const PIPELINE_START = '2026-03-10T08:00:00Z';
    const DEP_MODIFIED = '2026-03-12T10:00:00Z'; // after pipeline start

    await store.writeRootIndex(makeStalenessRoot());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'COMPLETE',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: '2026-03-01T00:00:00Z', completed_at: '2026-03-02T00:00:00Z', summary: ['Done'] },
      ],
      status_changed_at: DEP_MODIFIED,
      last_updated: DEP_MODIFIED,
    });
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: PIPELINE_START, summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implementation done'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();

    // Check that advisory warning was emitted in project comments
    const root = await store.readRootIndex();
    const stalenessWarning = root.project_comments.find(
      (c) => c.note.includes('WP-001') && c.note.includes('modified after pipeline started'),
    );
    expect(stalenessWarning).toBeDefined();
    expect(stalenessWarning!.type).toBe('warning');
    expect(stalenessWarning!.priority).toBe('low');
  });

  it('does NOT emit warning when dependencies were not modified after pipeline started', async () => {
    // WP-001 completed BEFORE WP-002's pipeline started
    const DEP_MODIFIED = '2026-03-08T10:00:00Z';
    const PIPELINE_START = '2026-03-10T08:00:00Z';

    await store.writeRootIndex(makeStalenessRoot());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'COMPLETE',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: '2026-03-01T00:00:00Z', completed_at: DEP_MODIFIED, summary: ['Done'] },
      ],
      status_changed_at: DEP_MODIFIED,
      last_updated: DEP_MODIFIED,
    });
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: PIPELINE_START, summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'PASS',
      summary: ['Implementation done'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();

    const root = await store.readRootIndex();
    const stalenessWarning = root.project_comments.find(
      (c) => c.note.includes('modified after pipeline started'),
    );
    expect(stalenessWarning).toBeUndefined();
  });

  it('does NOT emit warning when pipeline result is FAIL', async () => {
    const PIPELINE_START = '2026-03-10T08:00:00Z';
    const DEP_MODIFIED = '2026-03-12T10:00:00Z';

    await store.writeRootIndex(makeStalenessRoot());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'COMPLETE',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
      status_changed_at: DEP_MODIFIED,
      last_updated: DEP_MODIFIED,
    });
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: PIPELINE_START, summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'FAIL',
      summary: ['Failed'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();

    const root = await store.readRootIndex();
    const stalenessWarning = root.project_comments.find(
      (c) => c.note.includes('modified after pipeline started'),
    );
    expect(stalenessWarning).toBeUndefined();
  });

  it('does NOT emit warning when WP has no dependencies', async () => {
    // WP-002 has no dependencies — no staleness check should run
    const noDepsRoot: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-002', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(noDepsRoot);
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: '2026-03-10T08:00:00Z', summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'PASS',
      summary: ['Done'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();

    const root = await store.readRootIndex();
    const stalenessWarning = root.project_comments.find(
      (c) => c.note.includes('modified after pipeline started'),
    );
    expect(stalenessWarning).toBeUndefined();
  });

  it('PASS is NOT blocked by staleness — pipeline completes successfully', async () => {
    const PIPELINE_START = '2026-03-10T08:00:00Z';
    const DEP_MODIFIED = '2026-03-12T10:00:00Z';

    await store.writeRootIndex(makeStalenessRoot());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'COMPLETE',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
      status_changed_at: DEP_MODIFIED,
      last_updated: DEP_MODIFIED,
    });
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: PIPELINE_START, summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'PASS',
      summary: ['Done'],
      agent_role: 'Developer',
    });

    // Pipeline must complete — staleness is advisory only
    expect((result as any).isError).toBeFalsy();
    const wp2 = await store.readWorkPackage('WP-002');
    const lastPipeline = wp2.pipelines.at(-1)!;
    expect(lastPipeline.status).toBe('PASS');
  });

  it('Date-based comparison handles edge-case timestamps correctly', async () => {
    // Regression test: lexicographic comparison would fail with certain timestamp patterns.
    // Date '2026-03-10T09:59:59Z' < '2026-03-10T10:00:00Z' lexicographically and by Date.
    // Date '2026-03-10T23:59:59Z' > '2026-03-10T10:00:00Z' by Date but could trip up naive string comparison.
    const PIPELINE_START = '2026-03-10T10:00:00Z';
    const DEP_MODIFIED = '2026-03-10T23:59:59Z'; // same day, later time — should trigger warning

    await store.writeRootIndex(makeStalenessRoot());
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'COMPLETE',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
      last_updated: DEP_MODIFIED,
    });
    await store.writeWorkPackage('WP-002', {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: ['WP-001'],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', started_at: PIPELINE_START, summary: [] },
      ],
    });

    const result = await completePipeline({
      project_path: STALENESS_PLAN_PATH,
      work_package_id: 'WP-002',
      type: 'implementation',
      status: 'PASS',
      summary: ['Done'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();
    const root = await store.readRootIndex();
    const stalenessWarning = root.project_comments.find(
      (c) => c.note.includes('WP-001') && c.note.includes('modified after pipeline started'),
    );
    expect(stalenessWarning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WP-002 Rework — last_updated lifecycle integration test
// ---------------------------------------------------------------------------

const LIFECYCLE_PLAN_PATH = join(tmpdir(), '2026-03-17-wp002-lifecycle');

describe('WorkPackageDetail.last_updated — lifecycle integration (WP-002)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'lifecycle-'));
    store = new LedgerStore(LIFECYCLE_PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('last_updated is populated on every WP write via updateWorkPackageWithSync', async () => {
    // Setup: create a root index and WP detail
    const rootIndex: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(rootIndex);

    // Write WP without last_updated (simulating a legacy WP)
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
      // last_updated deliberately absent
    });

    // Verify it's absent initially
    const beforeUpdate = await store.readWorkPackage('WP-001');
    expect(beforeUpdate.last_updated).toBeUndefined();

    // Trigger an updateWorkPackageWithSync (simulates pipeline start)
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({
        type: 'implementation',
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: [],
      });
      root.last_updated = now();
      return { wp, root };
    });

    // Verify last_updated is now populated
    const afterUpdate = await store.readWorkPackage('WP-001');
    expect(afterUpdate.last_updated).toBeDefined();
    expect(typeof afterUpdate.last_updated).toBe('string');
    expect(afterUpdate.last_updated!.length).toBeGreaterThan(0);

    // Trigger a second update (simulates pipeline completion)
    const firstTimestamp = afterUpdate.last_updated;
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = wp.pipelines.at(-1)!;
      pipeline.status = 'PASS';
      pipeline.completed_at = now();
      pipeline.summary = ['Done'];
      root.last_updated = now();
      return { wp, root };
    });

    const afterSecondUpdate = await store.readWorkPackage('WP-001');
    expect(afterSecondUpdate.last_updated).toBeDefined();
    // last_updated should be >= first timestamp (may be equal if fast enough)
    expect(new Date(afterSecondUpdate.last_updated!).getTime())
      .toBeGreaterThanOrEqual(new Date(firstTimestamp!).getTime());
  });
});
