import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT, computePassedStages } from '../../src/utils/workflow-helpers.js';
import { _internal } from '../../src/tools/work-package-admin.js';
import { _internal as nextActionInternal } from '../../src/tools/workflow-next-action.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-update-pipeline-stages-test');

const { updatePipelineStages } = _internal;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRoot(extras?: Partial<RootIndex>): RootIndex {
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
        file: 'work/WP-001.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer',
        dependencies: [],
        active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      },
    ],
    project_comments: [],
    ...extras,
  };
}

function makeWpDetail(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'All tests pass', met: false }],
    revision: 0,
    pipelines: [],
    active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
    ...overrides,
  };
}

function parseResult(result: unknown): any {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  try {
    return JSON.parse(r.content[0]!.text);
  } catch {
    return { raw: r.content[0]!.text };
  }
}

function wpFilePath(store: LedgerStore): string {
  return join(store.storageDir, 'WP-001.json');
}

describe('ledger_update_pipeline_stages — guard order and PM-only (AC-02, AC-03)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage('WP-001', makeWpDetail());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects non-PM callers with isError: true and leaves the WP file byte-identical (AC-02)', async () => {
    const before = await readFile(wpFilePath(store), 'utf-8');

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        stages: ['implementation', 'qa'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('PM-only');

    const after = await readFile(wpFilePath(store), 'utf-8');
    expect(after).toBe(before);
  });

  it('a non-PM caller with an invalid list still gets the PM-only error (guard 1 before guard 2)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        stages: [],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('PM-only');
    expect((result as any).content[0].text).not.toMatch(/cannot be empty/);
  });

  it('rejects an empty stages list (AC-03)', async () => {
    const before = await readFile(wpFilePath(store), 'utf-8');

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: [],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/cannot be empty/);
    expect(await readFile(wpFilePath(store), 'utf-8')).toBe(before);
  });

  it('rejects an unknown stage name (AC-03)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'bogus-stage'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/Invalid pipeline stage/);
  });

  it('rejects a duplicate stage (AC-03)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'implementation', 'qa'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/Duplicate pipeline stage/);
  });

  it('rejects an out-of-canonical-order list (AC-03)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['qa', 'implementation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/out of canonical order/);
  });

  it('rejects a fail-route coverage gap (AC-03)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['qa', 'code-review'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/cannot fix its own FAIL results/);
  });

  it('an invalid list on a CANCELLED WP gets the validation error, not the CANCELLED error (guard 2 before guard 3)', async () => {
    await store.writeWorkPackage('WP-001', makeWpDetail({ status: 'CANCELLED' }));
    const root = await store.readRootIndex();
    root.work_packages[0]!.status = 'CANCELLED';
    await store.writeRootIndex(root);

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: [],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/cannot be empty/);
    expect((result as any).content[0].text).not.toMatch(/CANCELLED work package/);
  });
});

describe('ledger_update_pipeline_stages — status guards (AC-06, AC-07, AC-09)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects a call on a CANCELLED WP (AC-06)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.status = 'CANCELLED';
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ status: 'CANCELLED' }));

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('CANCELLED');
  });

  it('rejects a call on a WP with an IN_PROGRESS pipeline, naming the running type (AC-07)', async () => {
    const root = makeRoot();
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({
        pipelines: [{ type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] }],
      })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'code-review'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('"qa"');
    expect((result as any).content[0].text).toMatch(/IN_PROGRESS/);
  });

  it('rejects a COMPLETE WP with the reopen message, not the removal-guard message, even when the requested list removes an already-passed stage (AC-09)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.status = 'COMPLETE';
    root.pending_work_packages = 0;
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({
        status: 'COMPLETE',
        pipelines: [
          { type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
          { type: 'qa', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
          { type: 'code-review', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
          { type: 'documentation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] },
        ],
      })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        // Removes 'qa', which already has a PASS pipeline record.
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('COMPLETE');
    expect((result as any).content[0].text).toContain('ledger_update_work_package_status');
    expect((result as any).content[0].text).not.toMatch(/executed pipeline/);
  });
});

describe('ledger_update_pipeline_stages — removal guard and assigned_to clean-up (AC-08, AC-08b)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects removal of a stage with a non-auto_cancelled pipeline record (AC-08)', async () => {
    const root = makeRoot();
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({
        pipelines: [{ type: 'qa', status: 'FAIL', started_at: now(), completed_at: now(), summary: [] }],
      })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/executed pipeline/);
  });

  it('allows removal of a never-run stage (AC-08)', async () => {
    const root = makeRoot();
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ pipelines: [] }));

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.active_pipeline_stages).toEqual(['implementation', 'code-review', 'documentation']);
  });

  it('allows removal of a stage whose only pipeline record is auto_cancelled (AC-08)', async () => {
    const root = makeRoot();
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({
        pipelines: [
          { type: 'qa', status: 'FAIL', started_at: now(), summary: [], auto_cancelled: true },
        ],
      })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
  });

  it('nulls assigned_to (WP detail and root summary) when the removed never-run stage is owned by the current assignee (AC-08b)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.assigned_to = 'QA';
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ assigned_to: 'QA', pipelines: [] }));

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        // Removes 'qa' — owned by QA, the WP's current assignee.
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.assigned_to).toBeNull();
    const afterRoot = await store.readRootIndex();
    expect(afterRoot.work_packages[0]!.assigned_to).toBeNull();
  });

  it('leaves assigned_to unchanged when a different never-run stage is removed, not the one the assignee owns (AC-08b)', async () => {
    const root = makeRoot();
    root.work_packages[0]!.assigned_to = 'Reviewer';
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail({ assigned_to: 'Reviewer', pipelines: [] }));

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        // Removes 'qa' (Reviewer owns 'code-review', not 'qa') — assigned_to stays put.
        stages: ['implementation', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.assigned_to).toBe('Reviewer');
  });
});

describe('ledger_update_pipeline_stages — successful write surface (AC-04, AC-05, AC-11, AC-18)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage('WP-001', makeWpDetail());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes the canonicalised list to both documents and matches computePassedStages (AC-04)', async () => {
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({
        pipelines: [{ type: 'implementation', status: 'PASS', started_at: now(), completed_at: now(), summary: [] }],
      })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const body = parseResult(result);
    expect(body.new_stages).toEqual(['implementation', 'qa', 'security-audit', 'code-review', 'documentation']);

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.active_pipeline_stages).toEqual(['implementation', 'qa', 'security-audit', 'code-review', 'documentation']);

    const rootAfter = await store.readRootIndex();
    const summary = rootAfter.work_packages.find((s) => s.work_package_id === 'WP-001')!;
    expect(summary.active_pipeline_stages).toEqual(['implementation', 'qa', 'security-audit', 'code-review', 'documentation']);
    expect(summary.passed_stages).toBe(computePassedStages(wp, summary.active_pipeline_stages));
  });

  it('appends exactly one pipeline_stages_updated project comment naming previous, new, and reason (AC-05)', async () => {
    const reason = 'Original list omitted security-audit by mistake';

    await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
        reason,
      },
      tempDir
    );

    const root = await store.readRootIndex();
    const comments = root.project_comments.filter((c) => c.type === 'pipeline_stages_updated');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.note).toContain(reason);
    expect(comments[0]!.note).toContain('implementation, qa, code-review, documentation');
    expect(comments[0]!.note).toContain('implementation, qa, security-audit, code-review, documentation');
  });

  it('returns soft warnings from validateActiveStages without blocking the write (AC-11)', async () => {
    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const body = parseResult(result);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.some((w: string) => /single-stage/.test(w))).toBe(true);
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.active_pipeline_stages).toEqual(['implementation']);
  });

  it('re-stages a WP whose rework_counts.qa is at MAX_REWORK_COUNT with counters unchanged, naming ledger_reset_rework_count (AC-18)', async () => {
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ rework_counts: { qa: MAX_REWORK_COUNT } })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const body = parseResult(result);
    expect(body.next_step).toContain('ledger_reset_rework_count');
    expect(body.next_step).toMatch(/qa/);

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts?.qa).toBe(MAX_REWORK_COUNT);
  });

  it('does not mention ledger_reset_rework_count when no counter is at the limit', async () => {
    await store.writeWorkPackage('WP-001', makeWpDetail({ rework_counts: { qa: 1 } }));

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
        reason: 'test',
      },
      tempDir
    );

    const body = parseResult(result);
    expect(body.next_step).not.toContain('ledger_reset_rework_count');
    expect(body.next_step).toContain('ledger_get_next_action');
  });
});

describe('ledger_update_pipeline_stages — legacy pre-v2.6.0 chain repair (AC-03, AC-04)', () => {
  let tempDir: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-pipeline-stages-legacy-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempDir);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("a seeded pre-v2.6.0 ['qa', 'code-review'] WP re-staged to ['implementation', 'qa', 'code-review'] yields a Developer recommendation of IMPLEMENT", async () => {
    // Pre-v2.6.0 WPs could be created with a verifier-only chain missing 'implementation'.
    // validateActiveStages' Rule 5 (fail-route coverage) would reject this chain today,
    // but a WP seeded before that rule existed can still carry it.
    const root = makeRoot();
    root.work_packages[0]!.active_pipeline_stages = ['qa', 'code-review'];
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail({ active_pipeline_stages: ['qa', 'code-review'], pipelines: [] })
    );

    const result = await updatePipelineStages(
      {
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        stages: ['implementation', 'qa', 'code-review'],
        reason: 'Repair pre-v2.6.0 WP missing the implementation stage.',
      },
      tempDir
    );

    expect((result as any).isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.active_pipeline_stages).toEqual(['implementation', 'qa', 'code-review']);

    const nextAction = JSON.parse(
      (
        (await nextActionInternal.getNextAction({
          project_path: PLAN_PATH,
          agent_role: 'Developer',
        })) as { content: Array<{ text: string }> }
      ).content[0]!.text
    );
    expect(nextAction.action).toBe('IMPLEMENT');
    expect(nextAction.work_package_id).toBe('WP-001');
  });
});
