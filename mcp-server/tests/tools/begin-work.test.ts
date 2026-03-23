/**
 * Integration tests for WP-003: ledger_begin_work.
 *
 * Tests call the actual `beginWork` function from `_internal` by injecting
 * a temporary ledger root via `process.argv`. This exercises the real code
 * path (LedgerStore + guard logic) without polluting the default storage.
 *
 * Coverage:
 *   - READY WP → claim + start pipeline (claimed: true)
 *   - IN_PROGRESS WP assigned to caller → start-only (claimed: false)
 *   - Guard violations: CLAIMABLE_ROLES, assignment, dependency,
 *     duplicate pipeline, agent_role mismatch, invalid status
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { _internal } from '../../src/tools/begin-work.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-begin-work-test');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRootIndex(wpStatus: 'READY' | 'IN_PROGRESS' = 'READY', assignedTo = 'Developer'): RootIndex {
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
        status: wpStatus,
        assigned_to: assignedTo,
        dependencies: [],
        file: 'ledger/WP-001.json',
      },
    ],
    project_comments: [],
  };
}

function makeWpDetail(
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' = 'READY',
  assignedTo = 'Developer',
  pipelines: WorkPackageDetail['pipelines'] = [],
  dependencies: string[] = [],
): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status,
    assigned_to: assignedTo,
    dependencies,
    acceptance_criteria: [],
    revision: 0,
    pipelines,
  };
}

/** Parse result content text — errors or JSON body. */
function resultText(result: any): string {
  return result.content[0].text as string;
}

/** Parse the JSON payload from a successful beginWork response. */
function resultPayload(result: any): any {
  return JSON.parse(result.content[0].text);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('beginWork — READY → claim + start (WP-003)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'begin-work-ready-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);

    await store.writeRootIndex(makeRootIndex('READY', 'Developer'));
    await store.writeWorkPackage('WP-001', makeWpDetail('READY', 'Developer'));
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('claims a READY WP and starts the pipeline; claimed: true', async () => {
    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(true);
    expect(payload.status).toBe('IN_PROGRESS');
    const activePipeline = payload.pipelines.find(
      (p: any) => p.type === 'implementation' && p.status === 'IN_PROGRESS',
    );
    expect(activePipeline).toBeDefined();
  });

  it('transitions WP status to IN_PROGRESS in the store', async () => {
    await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('IN_PROGRESS');
    expect(wp.assigned_to).toBe('Developer');
  });

  it('updates the root index summary status to IN_PROGRESS', async () => {
    await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    const root = await store.readRootIndex();
    expect(root.work_packages[0].status).toBe('IN_PROGRESS');
  });
});

describe('beginWork — IN_PROGRESS → start-only (WP-003)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'begin-work-inprogress-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);

    // WP already IN_PROGRESS with a completed implementation pipeline
    // (ready to accept qa start)
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'QA'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'QA', [
        {
          type: 'implementation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
      ]),
    );
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('skips claim phase and starts pipeline; claimed: false', async () => {
    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(false);
    const activePipeline = payload.pipelines.find(
      (p: any) => p.type === 'qa' && p.status === 'IN_PROGRESS',
    );
    expect(activePipeline).toBeDefined();
  });

  it('allows QA agent to start qa pipeline on a WP currently assigned to Developer (cross-agent handoff)', async () => {
    // WP is IN_PROGRESS assigned to Developer with a PASS implementation pipeline.
    // QA is the legitimate pipeline-type owner for 'qa', so the guard should pass.
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Developer'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'Developer', [
        {
          type: 'implementation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
      ]),
    );

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(false);
    const activePipeline = payload.pipelines.find(
      (p: any) => p.type === 'qa' && p.status === 'IN_PROGRESS',
    );
    expect(activePipeline).toBeDefined();
    // assigned_to should now be updated to QA
    expect(payload.assigned_to).toBe('QA');
  });

  it('allows Reviewer to start code-review pipeline on a WP currently assigned to QA (cross-agent handoff)', async () => {
    // WP is IN_PROGRESS assigned to QA with PASS implementation + PASS qa pipelines.
    // Reviewer is the pipeline-type owner for 'code-review', so the guard should pass.
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'QA'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'QA', [
        {
          type: 'implementation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
        {
          type: 'qa',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
      ]),
    );

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'code-review',
      agent_role: 'Reviewer',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(false);
    const activePipeline = payload.pipelines.find(
      (p: any) => p.type === 'code-review' && p.status === 'IN_PROGRESS',
    );
    expect(activePipeline).toBeDefined();
    expect(payload.assigned_to).toBe('Reviewer');
  });

  it('allows Documentation agent to start documentation pipeline on a WP currently assigned to Reviewer (cross-agent handoff)', async () => {
    // WP is IN_PROGRESS assigned to Reviewer with PASS implementation + qa + code-review pipelines.
    // Documentation is the pipeline-type owner for 'documentation', so the guard should pass.
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Reviewer'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'Reviewer', [
        {
          type: 'implementation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
        {
          type: 'qa',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
        {
          type: 'code-review',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
      ]),
    );

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'documentation',
      agent_role: 'Documentation',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(false);
    const activePipeline = payload.pipelines.find(
      (p: any) => p.type === 'documentation' && p.status === 'IN_PROGRESS',
    );
    expect(activePipeline).toBeDefined();
    expect(payload.assigned_to).toBe('Documentation');
  });
});

describe('beginWork — guard violations (WP-003)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'begin-work-guards-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('rejects an agent role not in CLAIMABLE_ROLES (e.g. "Planner")', async () => {
    await store.writeRootIndex(makeRootIndex('READY', 'Planner'));
    await store.writeWorkPackage('WP-001', makeWpDetail('READY', 'Planner'));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Planner',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('cannot claim');
  });

  it('rejects claiming a WP assigned to a different agent', async () => {
    await store.writeRootIndex(makeRootIndex('READY', 'QA'));
    await store.writeWorkPackage('WP-001', makeWpDetail('READY', 'QA'));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toMatch(/"QA".*"Developer"|assigned.*"QA"/i);
  });

  it('rejects when WP has an unresolved dependency', async () => {
    // Root has 2 WPs; WP-001 depends on WP-002 which is READY (not COMPLETE)
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: ['WP-002'],
          file: 'ledger/WP-001.json',
        },
        {
          work_package_id: 'WP-002',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-002.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('READY', 'Developer', [], ['WP-002']));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('WP-002');
  });

  it('rejects starting a duplicate IN_PROGRESS pipeline of the same type', async () => {
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Developer'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'Developer', [
        {
          type: 'implementation',
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        },
      ]),
    );

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('already IN_PROGRESS');
  });

  it('rejects when agent_role does not own the pipeline type (e.g. Developer starts qa)', async () => {
    // WP is IN_PROGRESS assigned to Developer (passes the IN_PROGRESS assignment guard),
    // but Developer tries to start a 'qa' pipeline which belongs to the QA agent.
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Developer'));
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('IN_PROGRESS', 'Developer', [
        {
          type: 'implementation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['done'],
        },
      ]),
    );

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('can only be started by the QA agent');
  });

  it('rejects pipeline ordering violation (qa without PASS implementation)', async () => {
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'QA'));
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', 'QA'));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain("requires a PASS 'implementation' pipeline first");
  });

  it('rejects when WP status is COMPLETE', async () => {
    await store.writeRootIndex({
      ...makeRootIndex(),
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    await store.writeWorkPackage('WP-001', makeWpDetail('COMPLETE', 'Developer'));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('COMPLETE');
  });

  it('rejects when IN_PROGRESS WP is assigned to a different agent AND the agent is not the pipeline-type owner', async () => {
    // Developer tries to start a 'qa' pipeline on a WP assigned to QA.
    // Developer is neither the assignee ('QA') nor the pipeline-type owner for 'qa' (also 'QA').
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'QA'));
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', 'QA'));

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('"QA"');
    expect(resultText(result)).toContain('"Developer"');
  });
});

// ─── Dynamic active_pipeline_stages support ─────────────────────────────────

describe('beginWork — respects active_pipeline_stages (custom stage ordering)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'begin-work-active-stages-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('allows code-review without qa when active_pipeline_stages skips qa', async () => {
    // WP with active_pipeline_stages: ["implementation", "code-review"] — QA is excluded.
    // Implementation has PASS'd. code-review should proceed without requiring QA.
    const wp: WorkPackageDetail = {
      ...makeWpDetail('IN_PROGRESS', 'Reviewer', [
        { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
      ]),
      active_pipeline_stages: ['implementation', 'code-review'] as any,
    };
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Reviewer'));
    await store.writeWorkPackage('WP-001', wp);

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'code-review',
      agent_role: 'Reviewer',
    });

    expect((result as any).isError).toBeUndefined();
    const payload = resultPayload(result);
    expect(payload.claimed).toBe(false);
    const codeReviewPipeline = payload.pipelines?.find((p: any) => p.type === 'code-review');
    expect(codeReviewPipeline?.status).toBe('IN_PROGRESS');
  });

  it('rejects code-review on custom-stage WP when the preceding active stage (implementation) has not PASS\'d', async () => {
    const wp: WorkPackageDetail = {
      ...makeWpDetail('IN_PROGRESS', 'Reviewer', []),
      active_pipeline_stages: ['implementation', 'code-review'] as any,
    };
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Reviewer'));
    await store.writeWorkPackage('WP-001', wp);

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'code-review',
      agent_role: 'Reviewer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain("requires a PASS 'implementation' pipeline first");
  });

  it('rejects a pipeline type not in the WP active_pipeline_stages (§11.1 active-stage guard)', async () => {
    // WP with active_pipeline_stages: ["qa", "code-review"] — implementation is excluded.
    // Developer should not be able to start an implementation pipeline.
    const wp: WorkPackageDetail = {
      ...makeWpDetail('IN_PROGRESS', 'Developer', []),
      active_pipeline_stages: ['qa', 'code-review'] as any,
    };
    await store.writeRootIndex(makeRootIndex('IN_PROGRESS', 'Developer'));
    await store.writeWorkPackage('WP-001', wp);

    const result = await _internal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('not in the WP\'s active stages');
  });
});
