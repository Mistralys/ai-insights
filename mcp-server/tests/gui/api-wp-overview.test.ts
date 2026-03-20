/**
 * Tests for handleGetWorkPackageOverview in gui/api.ts
 *
 * Uses real temp directories via LedgerStore to build fixtures on disk.
 * Covers happy paths, fallback to default stages, pipeline status resolution,
 * AC progress, corrupt/missing WP detail file handling, and blocked_by
 * propagation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleGetWorkPackageOverview, ApiError } from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { DEFAULT_PIPELINE_STAGES, CANONICAL_PIPELINE_ORDERING } from '../../src/utils/pipeline-maps.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

function makeWp(id: string, overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: 'READY',
    assigned_to: null,
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

/**
 * Creates a project fixture in ledgerRoot with the given WPs.
 * Returns a tuple of [store, slug] where slug is the project slug used by handlers.
 */
async function setupProject(
  ledgerRoot: string,
  slug: string,
  wps: WorkPackageDetail[],
  rootOverrides: Partial<RootIndex> = {}
): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, ledgerRoot);

  const wpSummaries = wps.map((wp) => ({
    work_package_id: wp.work_package_id,
    status: wp.status,
    assigned_to: wp.assigned_to,
    dependencies: wp.dependencies,
    file: `${wp.work_package_id}.json`,
  }));

  await store.writeRootIndex(
    makeRoot({
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((wp) => !['COMPLETE', 'CANCELLED'].includes(wp.status))
        .length,
      work_packages: wpSummaries,
      ...rootOverrides,
    })
  );

  for (const wp of wps) {
    await store.writeWorkPackage(wp.work_package_id, wp);
  }

  return store;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handleGetWorkPackageOverview', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'wp-overview-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── NOT_FOUND cases ────────────────────────────────────────────────────

  it('throws NOT_FOUND for a non-existent project', async () => {
    await expect(
      handleGetWorkPackageOverview(ledgerRoot, '2026-01-01-no-such-project')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND for path-traversal slug', async () => {
    await expect(
      handleGetWorkPackageOverview(ledgerRoot, '../evil')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ─── Empty project ───────────────────────────────────────────────────────

  it('returns an empty array when the project has no WPs', async () => {
    const slug = '2026-01-01-empty';
    await setupProject(ledgerRoot, slug, []);
    const result = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(result).toEqual([]);
  });

  // ─── Default stage fallback ──────────────────────────────────────────────

  it('falls back to DEFAULT_PIPELINE_STAGES when active_pipeline_stages is absent', async () => {
    const slug = '2026-01-01-defaults';
    const wp = makeWp('WP-001'); // no active_pipeline_stages
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);

    expect(entry).toBeDefined();
    const stageTypes = entry!.pipeline_stages.map((s) => s.type);
    expect(stageTypes).toEqual([...DEFAULT_PIPELINE_STAGES]);
  });

  // ─── Custom active_pipeline_stages ───────────────────────────────────────

  it('uses active_pipeline_stages when present and orders per CANONICAL_PIPELINE_ORDERING', async () => {
    const slug = '2026-01-01-custom-stages';
    const wp = makeWp('WP-001', {
      // Deliberately provided out of canonical order — must be re-ordered
      active_pipeline_stages: ['security-audit', 'implementation', 'qa'],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);

    expect(entry).toBeDefined();
    const stageTypes = entry!.pipeline_stages.map((s) => s.type);
    // Canonical order: implementation → qa → security-audit
    expect(stageTypes).toEqual(['implementation', 'qa', 'security-audit']);
  });

  // ─── Pipeline status resolution ──────────────────────────────────────────

  it('maps PASS pipeline to "pass" status', async () => {
    const slug = '2026-01-01-status-pass';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation'],
      pipelines: [
        { type: 'implementation', status: 'PASS', summary: ['done'], started_at: now(), completed_at: now() },
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const stage = entry!.pipeline_stages.find((s) => s.type === 'implementation');
    expect(stage?.status).toBe('pass');
  });

  it('maps IN_PROGRESS pipeline to "in-progress" status', async () => {
    const slug = '2026-01-01-status-inprogress';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation'],
      pipelines: [
        { type: 'implementation', status: 'IN_PROGRESS', summary: [], started_at: now() },
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const stage = entry!.pipeline_stages.find((s) => s.type === 'implementation');
    expect(stage?.status).toBe('in-progress');
  });

  it('maps FAIL pipeline to "fail" status', async () => {
    const slug = '2026-01-01-status-fail';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation'],
      pipelines: [
        { type: 'implementation', status: 'FAIL', summary: ['failed'], started_at: now(), completed_at: now() },
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const stage = entry!.pipeline_stages.find((s) => s.type === 'implementation');
    expect(stage?.status).toBe('fail');
  });

  it('uses "pending" for stages with no pipeline entry', async () => {
    const slug = '2026-01-01-status-pending';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation', 'qa'],
      pipelines: [
        { type: 'implementation', status: 'PASS', summary: ['done'], started_at: now(), completed_at: now() },
        // no qa pipeline entry
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const qaStage = entry!.pipeline_stages.find((s) => s.type === 'qa');
    expect(qaStage?.status).toBe('pending');
  });

  it('uses the latest pipeline entry when multiple entries exist for the same type (rework)', async () => {
    const slug = '2026-01-01-rework';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation'],
      pipelines: [
        { type: 'implementation', status: 'FAIL', summary: ['first attempt'], started_at: now(), completed_at: now() },
        { type: 'implementation', status: 'PASS', summary: ['rework'], started_at: now(), completed_at: now() },
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const stage = entry!.pipeline_stages.find((s) => s.type === 'implementation');
    // Latest entry is PASS — should win
    expect(stage?.status).toBe('pass');
  });

  // ─── Agent mapping ───────────────────────────────────────────────────────

  it('maps stage types to correct agent names via PIPELINE_AGENT_MAP', async () => {
    const slug = '2026-01-01-agents';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation', 'qa', 'security-audit', 'code-review'],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    const stages = entry!.pipeline_stages;

    expect(stages.find((s) => s.type === 'implementation')?.agent).toBe('Developer');
    expect(stages.find((s) => s.type === 'qa')?.agent).toBe('QA');
    expect(stages.find((s) => s.type === 'security-audit')?.agent).toBe('Security Auditor');
    expect(stages.find((s) => s.type === 'code-review')?.agent).toBe('Reviewer');
  });

  // ─── Acceptance criteria progress ────────────────────────────────────────

  it('computes acceptance criteria progress correctly', async () => {
    const slug = '2026-01-01-ac';
    const wp = makeWp('WP-001', {
      acceptance_criteria: [
        { criterion: 'AC 1', met: true },
        { criterion: 'AC 2', met: false },
        { criterion: 'AC 3', met: true },
      ],
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.acceptance_criteria).toEqual({ met: 2, total: 3 });
  });

  it('returns { met: 0, total: 0 } when acceptance_criteria is empty', async () => {
    const slug = '2026-01-01-ac-empty';
    const wp = makeWp('WP-001', { acceptance_criteria: [] });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.acceptance_criteria).toEqual({ met: 0, total: 0 });
  });

  // ─── Rework counts ───────────────────────────────────────────────────────

  it('propagates rework_counts per stage', async () => {
    const slug = '2026-01-01-rework-counts';
    const wp = makeWp('WP-001', {
      active_pipeline_stages: ['implementation', 'qa'],
      rework_counts: { implementation: 2, qa: 1 },
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.pipeline_stages.find((s) => s.type === 'implementation')?.rework_count).toBe(2);
    expect(entry!.pipeline_stages.find((s) => s.type === 'qa')?.rework_count).toBe(1);
  });

  it('returns rework_count of 0 when rework_counts is absent', async () => {
    const slug = '2026-01-01-no-rework';
    const wp = makeWp('WP-001', { active_pipeline_stages: ['implementation'] });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.pipeline_stages[0]?.rework_count).toBe(0);
  });

  // ─── blocked_by propagation ──────────────────────────────────────────────

  it('propagates blocked_by when WP is blocked', async () => {
    const slug = '2026-01-01-blocked';
    const wp = makeWp('WP-001', {
      status: 'BLOCKED',
      blocked_by: { type: 'dependency', description: 'Waiting on WP-002' },
    });
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.blocked_by).toEqual({ type: 'dependency', description: 'Waiting on WP-002' });
  });

  it('omits blocked_by when WP is not blocked', async () => {
    const slug = '2026-01-01-not-blocked';
    const wp = makeWp('WP-001');
    await setupProject(ledgerRoot, slug, [wp]);

    const [entry] = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(entry!.blocked_by).toBeUndefined();
  });

  // ─── Error tolerance ─────────────────────────────────────────────────────

  it('skips a corrupt WP detail file and returns other WPs', async () => {
    const slug = '2026-01-01-corrupt';
    const wp1 = makeWp('WP-001');
    const wp2 = makeWp('WP-002');
    const store = await setupProject(ledgerRoot, slug, [wp1, wp2]);

    // Overwrite WP-002 with invalid JSON
    const corruptPath = join(store.storageDir, 'WP-002.json');
    await writeFile(corruptPath, '{ invalid json !!!', 'utf-8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true as unknown as boolean);
    const result = await handleGetWorkPackageOverview(ledgerRoot, slug);

    // WP-001 should be present; WP-002 should have been skipped
    expect(result).toHaveLength(1);
    expect(result[0]!.work_package_id).toBe('WP-001');
    // A warning should have been written to stderr
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[handleGetWorkPackageOverview] Skipping WP "WP-002"')
    );
  });

  it('skips a missing WP detail file and returns other WPs', async () => {
    const slug = '2026-01-01-missing';
    const wp1 = makeWp('WP-001');
    const store = await setupProject(ledgerRoot, slug, [wp1]);

    // Inject a WP-002 summary into the root index without creating its detail file
    const rootIndex = await store.readRootIndex();
    await store.writeRootIndex({
      ...rootIndex,
      total_work_packages: 2,
      work_packages: [
        ...rootIndex.work_packages,
        { work_package_id: 'WP-002', status: 'READY', assigned_to: null, dependencies: [], file: 'WP-002.json' },
      ],
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true as unknown as boolean);
    const result = await handleGetWorkPackageOverview(ledgerRoot, slug);

    expect(result).toHaveLength(1);
    expect(result[0]!.work_package_id).toBe('WP-001');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[handleGetWorkPackageOverview] Skipping WP "WP-002"')
    );
  });

  // ─── Multiple WPs — ordering preserved ──────────────────────────────────

  it('returns entries in the order they appear in the root index', async () => {
    const slug = '2026-01-01-multi';
    const wps = [makeWp('WP-001'), makeWp('WP-002'), makeWp('WP-003')];
    await setupProject(ledgerRoot, slug, wps);

    const result = await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(result.map((e) => e.work_package_id)).toEqual(['WP-001', 'WP-002', 'WP-003']);
  });

  // ─── STDIO discipline ────────────────────────────────────────────────────

  it('never writes to process.stdout', async () => {
    const slug = '2026-01-01-stdio';
    const wp = makeWp('WP-001');
    await setupProject(ledgerRoot, slug, [wp]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true as unknown as boolean);
    await handleGetWorkPackageOverview(ledgerRoot, slug);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
