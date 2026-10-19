/**
 * Unit tests for applyPipelineStart() (src/utils/pipeline-start.ts) — the
 * shared start-guard chain used by both ledger_start_pipeline (pipeline.ts)
 * and ledger_begin_work (begin-work.ts).
 *
 * Unlike start-pipeline-guards.test.ts and begin-work.test.ts, these tests
 * call applyPipelineStart() directly against in-memory WorkPackageDetail /
 * RootIndex fixtures — no LedgerStore, no filesystem, no process.argv
 * manipulation — since the function is pure given its inputs (it mutates
 * the passed-in wp/root objects and either returns an outcome or throws).
 */
import { describe, it, expect } from 'vitest';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { applyPipelineStart, type PipelineStartRequest } from '../../src/utils/pipeline-start.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

function makeRoot(): RootIndex {
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
        file: 'work/WP-001.md',
      },
    ],
    project_comments: [],
  };
}

function makeWp(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

function pl(
  type: string,
  status: 'PASS' | 'FAIL' | 'IN_PROGRESS',
  autoCancelled = false,
): Pipeline {
  const base: Pipeline = {
    type: type as any,
    status,
    started_at: now(),
    summary: [],
  };
  if (status !== 'IN_PROGRESS') {
    base.completed_at = now();
  }
  if (autoCancelled) {
    base.auto_cancelled = true;
  }
  return base;
}

function req(overrides: Partial<PipelineStartRequest> = {}): PipelineStartRequest {
  return {
    wp: makeWp(),
    root: makeRoot(),
    workPackageId: 'WP-001',
    type: 'implementation',
    agentRole: 'Developer',
    ...overrides,
  };
}

describe('applyPipelineStart — role rejection and PM-override', () => {
  it('rejects a non-owning agentRole with the exact message', () => {
    expect(() => applyPipelineStart(req({ agentRole: 'QA' }))).toThrow(
      "Pipeline type 'implementation' can only be started by the Developer agent. You provided agent_role: 'QA'."
    );
  });

  it("'Project Manager' bypasses the role check and tags the pipeline summary with [PM Override]", () => {
    const wp = makeWp();
    const root = makeRoot();
    const outcome = applyPipelineStart(req({ wp, root, agentRole: 'Project Manager' }));

    expect(outcome.kind).toBe('started');
    const newPipeline = wp.pipelines.at(-1)!;
    expect(newPipeline.type).toBe('implementation');
    expect(newPipeline.summary).toContain('[PM Override]');
  });
});

describe('applyPipelineStart — non-IN_PROGRESS rejection', () => {
  it('rejects when wp.status is not IN_PROGRESS, with the exact message', () => {
    const wp = makeWp({ status: 'READY' });
    expect(() => applyPipelineStart(req({ wp }))).toThrow(
      'Cannot start pipeline for work package WP-001: work package status is READY. ' +
        'Only IN_PROGRESS work packages can have pipelines started.'
    );
  });
});

describe('applyPipelineStart — inactive-stage rejection', () => {
  it('rejects a type not present in active_pipeline_stages', () => {
    const wp = makeWp({ active_pipeline_stages: ['implementation', 'qa'] as any });
    expect(() => applyPipelineStart(req({ wp, type: 'code-review' as any, agentRole: 'Reviewer' }))).toThrow(
      "Cannot start pipeline 'code-review' for work package WP-001: this pipeline type is not in the WP's active stages. " +
        'Active stages: implementation → qa.'
    );
  });
});

describe('applyPipelineStart — duplicate-IN_PROGRESS rejection', () => {
  it('rejects when a pipeline of the same type is already IN_PROGRESS', () => {
    const wp = makeWp({ pipelines: [pl('implementation', 'IN_PROGRESS')] });
    expect(() => applyPipelineStart(req({ wp }))).toThrow(
      'Cannot start pipeline: a pipeline of type "implementation" is already IN_PROGRESS for work package WP-001. ' +
        'Complete the existing pipeline before starting a new one.'
    );
  });
});

describe('applyPipelineStart — prerequisite guard', () => {
  it('rejects when the prerequisite pipeline is missing entirely', () => {
    const wp = makeWp({ pipelines: [] });
    expect(() => applyPipelineStart(req({ wp, type: 'qa' as any, agentRole: 'QA' }))).toThrow(
      "Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first. " +
        'Active pipeline order: implementation → qa → code-review → documentation.'
    );
  });

  it('rejects when the most recent prerequisite is non-PASS', () => {
    const wp = makeWp({ pipelines: [pl('implementation', 'FAIL')] });
    expect(() => applyPipelineStart(req({ wp, type: 'qa' as any, agentRole: 'QA' }))).toThrow(
      "Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first."
    );
  });

  it('ignores an auto_cancelled prerequisite FAIL and uses the preceding PASS', () => {
    const wp = makeWp({
      pipelines: [pl('implementation', 'PASS'), pl('implementation', 'FAIL', true)],
    });
    const outcome = applyPipelineStart(req({ wp, type: 'qa' as any, agentRole: 'QA' }));
    expect(outcome.kind).toBe('started');
    expect(wp.pipelines.at(-1)?.type).toBe('qa');
  });
});

describe('applyPipelineStart — revalidation rejection', () => {
  it('rejects a stale prerequisite PASS after upstream rework (§11.1)', () => {
    const t0 = '2026-01-01T00:00:00.000Z';
    const t1 = '2026-01-01T00:01:00.000Z';
    const t2 = '2026-01-01T00:02:00.000Z';
    const t3 = '2026-01-01T00:03:00.000Z';

    const pipelines: Pipeline[] = [
      { type: 'implementation', status: 'PASS', started_at: t0, completed_at: t0, summary: [] },
      { type: 'qa', status: 'PASS', started_at: t1, completed_at: t1, summary: [] },
      { type: 'code-review', status: 'FAIL', started_at: t2, completed_at: t2, summary: [] },
      { type: 'implementation', status: 'PASS', started_at: t3, completed_at: t3, summary: [] },
    ];
    const wp = makeWp({ pipelines });

    expect(() =>
      applyPipelineStart(req({ wp, type: 'code-review' as any, agentRole: 'Reviewer' }))
    ).toThrow(/stale|revalidat|Re-run/i);
  });
});

describe('applyPipelineStart — rework-count increments', () => {
  it('increments rework_counts for a direct FAIL retry of the same type', () => {
    const wp = makeWp({ pipelines: [pl('implementation', 'FAIL')] });
    applyPipelineStart(req({ wp }));
    expect(wp.rework_counts?.implementation).toBe(1);
  });

  it('increments rework_counts.implementation for a downstream FAIL (qa FAIL after impl PASS)', () => {
    const wp = makeWp({ pipelines: [pl('implementation', 'PASS'), pl('qa', 'FAIL')] });
    applyPipelineStart(req({ wp }));
    expect(wp.rework_counts?.implementation).toBe(1);
    expect(wp.rework_counts?.qa).toBeUndefined();
  });
});

describe('applyPipelineStart — circuit breaker', () => {
  it("returns { kind: 'tripped' } when the increment reaches MAX_REWORK_COUNT, persists the counter, and appends no pipeline", () => {
    const wp = makeWp({
      pipelines: [pl('implementation', 'FAIL')],
      rework_counts: { implementation: MAX_REWORK_COUNT - 1 },
    });
    const pipelineCountBefore = wp.pipelines.length;

    const outcome = applyPipelineStart(req({ wp }));

    expect(outcome).toEqual({
      kind: 'tripped',
      message: expect.stringContaining('Rework circuit breaker'),
    });
    expect(wp.rework_counts?.implementation).toBe(MAX_REWORK_COUNT);
    expect(wp.pipelines).toHaveLength(pipelineCountBefore);
  });

  it('throws when the stored count is already at MAX_REWORK_COUNT (no increment needed)', () => {
    const wp = makeWp({
      pipelines: [pl('implementation', 'PASS')],
      rework_counts: { implementation: MAX_REWORK_COUNT },
    });
    expect(() => applyPipelineStart(req({ wp }))).toThrow(/Rework circuit breaker/);
  });
});

describe('applyPipelineStart — success path', () => {
  it('appends the pipeline and updates assigned_to on both the WP detail and the root summary, plus root.last_updated', () => {
    const wp = makeWp({ assigned_to: 'Developer' });
    // now() has second-level precision — null out last_updated beforehand so
    // a real assignment (vs. an untouched undefined) is the observable signal.
    const root: RootIndex = { ...makeRoot(), last_updated: undefined as unknown as string };

    const outcome = applyPipelineStart(req({ wp, root, agentRole: 'Developer' }));

    expect(outcome.kind).toBe('started');
    expect(wp.pipelines).toHaveLength(1);
    expect(wp.pipelines[0]!.type).toBe('implementation');
    expect(wp.pipelines[0]!.status).toBe('IN_PROGRESS');
    expect(wp.assigned_to).toBe('Developer');
    expect(root.work_packages[0]!.assigned_to).toBe('Developer');
    expect(typeof root.last_updated).toBe('string');
    expect(root.last_updated).not.toHaveLength(0);
  });
});
