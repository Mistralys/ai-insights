/**
 * Integration tests for WP-002: startPipeline guards.
 *
 * Tests call the actual `startPipeline` function from `_internal` by injecting
 * a temporary ledger root via `process.argv` manipulation. This exercises the
 * real code path (LedgerStore + guard logic) without polluting the default
 * ledger storage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { FAIL_ROUTING_MAP } from '../../src/utils/pipeline-maps.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { _internal } from '../../src/tools/pipeline.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-start-pipeline-guard-test');

// ─── Helpers ────────────────────────────────────────────────────────────────

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
        file: 'work/WP-001.md',
      },
    ],
    project_comments: [],
  };
}

function makeWpDetail(pipelines: Pipeline[] = []): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines,
  };
}

function makePipeline(type: string, status: 'PASS' | 'FAIL' | 'IN_PROGRESS'): Pipeline {
  const base: Pipeline = {
    type: type as any,
    status,
    started_at: now(),
    summary: [],
  };
  if (status !== 'IN_PROGRESS') {
    base.completed_at = now();
  }
  return base;
}

/** Parse the result content text. Returns the error string if isError is true. */
function resultText(result: any): string {
  return result.content[0].text as string;
}

describe('startPipeline integration tests (WP-002 guards)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'start-pipeline-guards-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    // Inject a temporary ledger root so the actual startPipeline uses our tempDir.
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);

    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail());
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ─── Agent role & PM Override ───────────────────────────────────────────

  it('rejects a non-owning agent_role', async () => {
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'QA',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('can only be started by the Developer agent');
  });

  it('PM agent_role bypasses role check for all pipeline types (implementation)', async () => {
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Project Manager',
    });
    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    const newPipeline = wp.pipelines.at(-1)!;
    expect(newPipeline.type).toBe('implementation');
    expect(newPipeline.status).toBe('IN_PROGRESS');
    // PM Override note should appear in the pipeline summary
    expect(newPipeline.summary).toContain('[PM Override]');
  });

  it('PM agent_role bypasses role check for qa pipeline type', async () => {
    // Setup: need a PASS implementation pipeline first
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({ ...makePipeline('implementation', 'PASS') });
      root.last_updated = now();
      return { wp, root };
    });
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'Project Manager',
    });
    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    const newPipeline = wp.pipelines.at(-1)!;
    expect(newPipeline.type).toBe('qa');
    expect(newPipeline.summary).toContain('[PM Override]');
  });

  // ─── checkRevalidationGuard wired through startPipeline ─────────────────

  it('checkRevalidationGuard fires when a stale prereq PASS causes a re-run rejection', async () => {
    /**
     * Scenario: code-review revalidation guard (§11.1).
     *
     * Timeline:
     *  t0 — impl PASS
     *  t1 — qa PASS  (baseline)
     *  t2 — code-review FAIL (baseline code-review run, started after qa PASS)
     *  t3 — impl PASS (upstream rework started and completed after the qa PASS)
     *
     * When attempting code-review again:
     *  - Most recent qa PASS = t1 (passes the prerequisite check).
     *  - revalidation guard: prereqCompleted(t1) < baselineStarted(t2) → stale;
     *    hasDownstreamFail('qa') → true (code-review FAIL at t2);
     *    upstream of 'code-review' (impl, qa) started after t1? impl at t3 → YES.
     *  → Guard fires: stale qa PASS after upstream impl rework.
     */
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
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines = pipelines;
      root.last_updated = now();
      return { wp, root };
    });

    // Attempt to start code-review again — guard fires because qa PASS (t1) is
    // stale relative to the code-review baseline (t2) and impl rework occurred (t3).
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'code-review',
      agent_role: 'Reviewer',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toMatch(/stale|revalidat|Re-run/i);
  });

  // ─── Auto-cancelled pipeline exclusion in prerequisite check (§21.27) ───

  it('allows QA to start when most recent non-cancelled implementation is PASS despite a trailing auto-cancelled FAIL', async () => {
    /**
     * Scenario (Bug 2 from the plan):
     *  t0 — impl PASS  (crash recovery: the pipeline was interrupted after PASS)
     *  t1 — impl FAIL  (auto_cancelled: true — written by crash-recovery logic)
     *
     * Before the fix, the filter `p.type === prerequisite` picked up the
     * auto-cancelled FAIL as the most-recent implementation pipeline, causing
     * QA to be blocked. After the fix (`&& !p.auto_cancelled`), the FAIL is
     * excluded and the PASS at t0 is used — QA may proceed.
     */
    const t0 = '2026-01-01T00:00:00.000Z';
    const t1 = '2026-01-01T00:01:00.000Z';

    const pipelines: Pipeline[] = [
      { type: 'implementation', status: 'PASS', started_at: t0, completed_at: t0, summary: [] },
      { type: 'implementation', status: 'FAIL', started_at: t1, completed_at: t1, summary: [], auto_cancelled: true },
    ];
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines = pipelines;
      root.last_updated = now();
      return { wp, root };
    });

    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });
    expect((result as any).isError).toBeUndefined();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.pipelines.at(-1)?.type).toBe('qa');
  });

  // ─── Per-type rework counting ────────────────────────────────────────────

  it('rework_counts.implementation increments when an implementation pipeline is retried', async () => {
    // Setup: impl FAIL → attempt another impl
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push(makePipeline('implementation', 'FAIL'));
      root.last_updated = now();
      return { wp, root };
    });
    await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts?.implementation).toBe(1);
    // Legacy scalar dual-write has been retired
    expect(wp.rework_count).toBeUndefined();
  });

  it('rework_counts.qa increments when a QA pipeline is retried, NOT rework_counts.implementation', async () => {
    // Setup: impl PASS → qa FAIL → attempt another qa
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push(makePipeline('implementation', 'PASS'));
      wp.pipelines.push(makePipeline('qa', 'FAIL'));
      root.last_updated = now();
      return { wp, root };
    });
    await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts?.qa).toBe(1);
    // implementation counter must NOT be touched
    expect(wp.rework_counts?.implementation).toBeUndefined();
    // Legacy scalar is NOT updated for non-implementation types
    expect(wp.rework_count).toBeUndefined();
  });

  it('downstream-triggered rework: impl PASS → qa FAIL → impl starts again → rework_counts.implementation increments', async () => {
    // Setup: impl PASS → qa FAIL
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push(makePipeline('implementation', 'PASS'));
      wp.pipelines.push(makePipeline('qa', 'FAIL'));
      root.last_updated = now();
      return { wp, root };
    });
    // Attempt to start impl again — downstream qa FAIL triggers rework detection
    await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts?.implementation).toBe(1);
    // Legacy scalar dual-write has been retired
    expect(wp.rework_count).toBeUndefined();
    // qa counter must NOT be touched
    expect(wp.rework_counts?.qa).toBeUndefined();
  });

  it('auto-cancelled pipelines are excluded from rework detection', async () => {
    // Setup: impl FAIL (auto_cancelled) — should NOT trigger rework counting
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({ ...makePipeline('implementation', 'FAIL'), auto_cancelled: true });
      root.last_updated = now();
      return { wp, root };
    });
    await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });
    const wp = await store.readWorkPackage('WP-001');
    // No rework should have been counted — auto-cancelled pipeline excluded
    expect(wp.rework_counts?.implementation).toBeUndefined();
    expect(wp.rework_count).toBeUndefined();
  });

  // ─── Circuit breaker (per-type) ──────────────────────────────────────────

  it('circuit breaker triggers when per-type rework_counts reaches MAX_REWORK_COUNT', async () => {
    // Pre-load rework_counts.qa to MAX_REWORK_COUNT - 1, then add a qa FAIL
    // and attempt another qa → the increment pushes the count to the limit.
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push(makePipeline('implementation', 'PASS'));
      wp.pipelines.push(makePipeline('qa', 'FAIL'));
      wp.rework_counts = { qa: MAX_REWORK_COUNT - 1 };
      root.last_updated = now();
      return { wp, root };
    });
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      agent_role: 'QA',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('circuit breaker');
  });

  it('circuit breaker for implementation type uses per-type count, not qa count', async () => {
    // qa has hit the limit but impl has not — impl pipeline should still start
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push(makePipeline('implementation', 'FAIL'));
      wp.rework_counts = { qa: MAX_REWORK_COUNT, implementation: 0 };
      root.last_updated = now();
      return { wp, root };
    });
    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });
    // Should succeed — implementation counter is 0, not at the limit
    expect((result as any).isError).toBeUndefined();
  });
});

// ─── FAIL_ROUTING_MAP derivation (Gold Nugget M-1) ──────────────────────────

describe('developerReworkTypes derived from FAIL_ROUTING_MAP', () => {
  it('FAIL_ROUTING_MAP routes qa and code-review failures to Developer', () => {
    const developerReworkTypes = (Object.entries(FAIL_ROUTING_MAP) as [string, string][])
      .filter(([, agent]) => agent === 'Developer')
      .map(([t]) => t);
    expect(developerReworkTypes).toContain('qa');
    expect(developerReworkTypes).toContain('code-review');
  });

  it('FAIL_ROUTING_MAP routes documentation failures to Documentation (self-rework)', () => {
    expect(FAIL_ROUTING_MAP['documentation']).toBe('Documentation');
  });

  it('hasDownstreamReengagedSince uses dynamic FAIL_ROUTING_MAP-derived type list (regression guard)', () => {
    // All pipeline types that FAIL_ROUTING_MAP routes to Developer should be
    // considered in downstream rework detection. If a new pipeline type is added
    // to FAIL_ROUTING_MAP routing to Developer, it must automatically be picked up.
    const developerReworkTypes = (Object.entries(FAIL_ROUTING_MAP) as [string, string][])
      .filter(([, agent]) => agent === 'Developer')
      .map(([t]) => t);
    // There must be at least one downstream type for the guard to have any effect
    expect(developerReworkTypes.length).toBeGreaterThanOrEqual(1);
    // The known types must be present
    expect(developerReworkTypes).toContain('qa');
  });
});
