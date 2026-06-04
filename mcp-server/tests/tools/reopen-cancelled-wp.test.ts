import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { _internal } from '../../src/tools/work-package.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-reopen-cancelled-wp-test');

const { reopenCancelledWp } = _internal;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRoot(extras?: Partial<RootIndex>): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 1,
    pending_work_packages: 0,
    work_packages: [
      {
        work_package_id: 'WP-001',
        file: 'work/WP-001.md',
        status: 'CANCELLED',
        assigned_to: 'Developer',
        dependencies: [],
      },
    ],
    project_comments: [],
    ...extras,
  };
}

function makeWpDetail(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'CANCELLED',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'All tests pass', met: false }],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  try {
    return JSON.parse(r.content[0]!.text);
  } catch {
    return { raw: r.content[0]!.text };
  }
}

// ─── Guard & precondition tests ───────────────────────────────────────────────

describe('ledger_reopen_cancelled_wp — guard and precondition tests', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reopen-cancelled-wp-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects non-PM callers with isError: true before any disk I/O', async () => {
    // Note: no store data written — verifying early return before disk I/O
    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        reason: 'test reason',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('PM-only');
    expect((result as any).content[0].text).toContain('Developer');
  });

  it('rejects QA callers', async () => {
    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'QA',
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('You are: QA');
  });

  it('rejects when WP status is READY (not CANCELLED)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.status = 'READY';
    root.pending_work_packages = 1;
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ status: 'READY' }));

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('READY');
  });

  it('rejects when WP status is IN_PROGRESS (not CANCELLED)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.status = 'IN_PROGRESS';
    root.pending_work_packages = 1;
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ status: 'IN_PROGRESS' }));

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('IN_PROGRESS');
  });

  it('rejects when WP status is COMPLETE (not CANCELLED)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.status = 'COMPLETE';
    root.pending_work_packages = 0;
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ status: 'COMPLETE' }));

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('COMPLETE');
  });
});

// ─── Core side-effect tests ───────────────────────────────────────────────────

describe('ledger_reopen_cancelled_wp — core side effects (satisfied deps → READY)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reopen-cancelled-wp-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    // Single WP with no dependencies, CANCELLED, pending_work_packages = 0
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage('WP-001', makeWpDetail());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('transitions CANCELLED → READY when dependencies are satisfied (none)', async () => {
    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'Cancelled by mistake',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('READY');
  });

  it('returns final_status: READY in the response', async () => {
    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'Cancelled by mistake',
      },
      tempDir
    );

    const body = parseResult(result) as any;
    expect(body.final_status).toBe('READY');
    expect(body.work_package_id).toBe('WP-001');
  });

  it('increments pending_work_packages by 1', async () => {
    const beforeRoot = await store.readRootIndex();
    expect(beforeRoot.pending_work_packages).toBe(0);

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const afterRoot = await store.readRootIndex();
    expect(afterRoot.pending_work_packages).toBe(1);
  });

  it('clears rework_counts', async () => {
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ rework_counts: { implementation: 3, qa: 1 } })
    );

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts).toBeUndefined();
  });

  it('clears assigned_to (sets to null)', async () => {
    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.assigned_to).toBeNull();
  });

  it('invalidates synthesis (synthesis_generated = false)', async () => {
    // Set synthesis_generated = true first
    const root = await store.readRootIndex();
    root.synthesis_generated = true;
    root.synthesis_generated_at = now();
    await store.writeRootIndex(root);

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const afterRoot = await store.readRootIndex();
    expect(afterRoot.synthesis_generated).toBe(false);
  });

  it('writes audit comment with type reopen_cancelled and provided reason', async () => {
    const reason = 'Cancelled by mistake during planning';

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason,
      },
      tempDir
    );

    const root = await store.readRootIndex();
    const comment = root.project_comments.find((c) => c.type === 'reopen_cancelled');
    expect(comment).toBeDefined();
    expect(comment!.agent).toBe('Project Manager');
    expect(comment!.priority).toBe('high');
    expect(comment!.note).toContain(reason);
    expect(comment!.note).toContain('WP-001');
  });

  it('sets status_changed_at timestamp on the WP', async () => {
    const before = now();

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status_changed_at).toBeDefined();
    expect(new Date(wp.status_changed_at!).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime()
    );
  });

  it('preserves pipeline history unchanged', async () => {
    const existingPipeline = {
      type: 'implementation' as const,
      status: 'PASS' as const,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T01:00:00.000Z',
      summary: ['Implementation complete'],
    };
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ pipelines: [existingPipeline] })
    );

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines).toHaveLength(1);
    expect(wp.pipelines[0]).toMatchObject(existingPipeline);
  });

  it('syncs root summary status and assigned_to', async () => {
    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const root = await store.readRootIndex();
    const summary = root.work_packages.find((w) => w.work_package_id === 'WP-001');
    expect(summary!.status).toBe('READY');
    expect(summary!.assigned_to).toBeNull();
  });
});

// ─── Dep-aware status test (unsatisfied deps → BLOCKED) ──────────────────────

describe('ledger_reopen_cancelled_wp — transitions to BLOCKED when deps unsatisfied', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reopen-cancelled-wp-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('transitions CANCELLED → BLOCKED when upstream dependency is not COMPLETE', async () => {
    // Two WPs: WP-001 (READY, no deps) and WP-002 (CANCELLED, depends on WP-001)
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'READY',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'CANCELLED',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'READY', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'CANCELLED',
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
      })
    );

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-002',
        agent_role: 'Project Manager',
        reason: 'Dependency was added after cancellation',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-002');
    expect(wp.status).toBe('BLOCKED');
    expect(wp.blocked_by).toBeDefined();
    expect(wp.blocked_by!.type).toBe('dependency');
  });

  it('returns final_status: BLOCKED in the response when deps unsatisfied', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'READY',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'CANCELLED',
          assigned_to: null,
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'READY', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'CANCELLED',
        assigned_to: null,
        dependencies: ['WP-001'],
      })
    );

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-002',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    const body = parseResult(result) as any;
    expect(body.final_status).toBe('BLOCKED');
  });

  it('transitions CANCELLED → READY when all upstream deps are COMPLETE', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 0,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'COMPLETE',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'CANCELLED',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'CANCELLED',
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
      })
    );

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-002',
        agent_role: 'Project Manager',
        reason: 'Cancelled by mistake',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-002');
    expect(wp.status).toBe('READY');
    expect(wp.blocked_by).toBeUndefined();
  });
});

// ─── Cascade reblock tests ────────────────────────────────────────────────────

describe('ledger_reopen_cancelled_wp — cascade reblock on downstream dependents', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reopen-cancelled-wp-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('blocks downstream READY dependents after reopening the CANCELLED WP', async () => {
    // WP-001 was CANCELLED. WP-002 depends on WP-001 but was READY (it was erroneously allowed).
    // After reopen, WP-002 should become BLOCKED.
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'CANCELLED',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'READY',
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
      })
    );

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'Reopen to allow downstream to reblock properly',
      },
      tempDir
    );

    // WP-002 should now be BLOCKED (it depended on WP-001 which is now non-terminal again)
    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
  });

  it('does not reblock downstream BLOCKED dependents (already blocked)', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'CANCELLED',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'BLOCKED',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'BLOCKED',
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
        blocked_by: { type: 'dependency', description: 'WP-001 not complete', blocking_work_package: 'WP-001' },
      })
    );

    const result = await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'test',
      },
      tempDir
    );

    // Tool should succeed and WP-002 remains BLOCKED (no error)
    expect((result as any).isError).toBeFalsy();
    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
  });

  it('blocks downstream IN_PROGRESS dependents after reopening the CANCELLED WP', async () => {
    // WP-001 was CANCELLED. WP-002 depends on WP-001 but was IN_PROGRESS.
    // After reopen, WP-002 should become BLOCKED.
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          file: 'work/WP-001.md',
          status: 'CANCELLED',
          assigned_to: null,
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: null, dependencies: [] })
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail({
        work_package_id: 'WP-002',
        work_package_file: 'work/WP-002.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
      })
      // Note: makeWpDetail defaults pipelines to []. propagateDependencyReblock calls
      // autoCancelActivePipelines when re-blocking this WP, but finds nothing to cancel
      // here. The pipeline auto-cancel side-effect is covered in work-package.test.ts
      // (see 'auto-cancels IN_PROGRESS pipeline' and 'auto-cancels ALL concurrent
      // IN_PROGRESS pipelines' in the propagateDependencyReblock suite).
    );

    await reopenCancelledWp(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        reason: 'Reopen to ensure downstream IN_PROGRESS gets reblocked',
      },
      tempDir
    );

    // WP-002 should now be BLOCKED (its upstream dep WP-001 is now non-terminal again)
    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
  });
});

// ─── State machine invariant test ────────────────────────────────────────────

describe('ledger_reopen_cancelled_wp — state machine invariant', () => {
  it('isValidStatusTransition still rejects CANCELLED → READY directly', async () => {
    // This test verifies that reopenCancelledWp is a genuine administrative bypass,
    // not a state machine modification. The CANCELLED terminal invariant must remain
    // intact for all other call sites that depend on it: isTerminalStatus() (used for
    // pending_work_packages counter arithmetic and synthesis gating),
    // propagateDependencyUnblock (dependency satisfaction logic), and any future code
    // that checks isTerminalStatus('CANCELLED'). If any expectation below fails,
    // the reopenCancelledWp implementation has inadvertently modified validators.ts.
    const { isValidStatusTransition } = await import('../../src/schema/validators.js');
    expect(isValidStatusTransition('CANCELLED', 'READY')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'IN_PROGRESS')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'BLOCKED')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'COMPLETE')).toBe(false);
  });
});
