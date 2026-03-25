import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { getQaAction, getReviewerAction, getDocumentationAction, getProjectManagerAction, getDeveloperAction, _internal } from '../../src/tools/workflow-next-action.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';
import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';
import { makeWorkPackageDetail, makePipeline } from '../helpers/fixtures.js';
import type { TempStoreHandle } from '../helpers/create-temp-store.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

/** Helper to parse the JSON from a tool result */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

// Fixed plan path; using YYYY-MM-DD format so planFolderBasename() accepts it.
const PLAN_PATH = join(tmpdir(), '2026-01-01-next-action-test');


/** Write a root index and a list of WP detail files to the temp store, then return the root index. */
async function setupStore(
  handle: TempStoreHandle,
  wps: WorkPackageDetail[]
): Promise<RootIndex> {
  const timestamp = '2026-01-01T08:00:00';
  const rootIndex: RootIndex = {
    plan_file: 'plan.md',
    date_created: timestamp,
    last_updated: timestamp,
    status: 'IN_PROGRESS',
    total_work_packages: wps.length,
    pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE').length,
    work_packages: wps.map((w) => ({
      work_package_id: w.work_package_id,
      status: w.status,
      assigned_to: w.assigned_to,
      dependencies: w.dependencies,
      file: `ledger/${w.work_package_id}.json`,
    })),
    project_comments: [],
  };
  await handle.store.writeRootIndex(rootIndex);
  for (const wp of wps) {
    await handle.store.writeWorkPackage(wp.work_package_id, wp);
  }
  return rootIndex;
}

// ---------------------------------------------------------------------------
// Temporal re-engagement tests (Finding #2)
// ---------------------------------------------------------------------------

describe('getQaAction — temporal re-engagement after Developer rework', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RUN_QA when a new implementation PASS was added after the last QA pipeline', async () => {
    // Rework cycle scenario:
    //  T1: first implementation PASS completed
    //  T2: QA started (covers first impl PASS)
    //  T3: Developer reworks → new implementation PASS completed AFTER T2
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS',  '2026-01-01T08:00:00', '2026-01-01T09:00:00'), // T1
      makePipeline('qa',             'PASS',  '2026-01-01T10:00:00', '2026-01-01T11:00:00'), // T2 start
      makePipeline('code-review',    'FAIL',  '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // New implementation PASS (rework) — completed at T3 = 14:00, which is AFTER qa started_at = 10:00
      makePipeline('implementation', 'PASS',  '2026-01-01T13:30:00', '2026-01-01T14:00:00'), // T3
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when implementation PASS was completed before existing QA (no rework needed)', async () => {
    // Normal cycle: single implementation PASS, then QA PASS — no rework
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });

  it('returns RUN_QA for first-run when only implementation PASS exists', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });
});

describe('getReviewerAction — temporal re-engagement after Developer rework', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RUN_REVIEW when a new QA PASS was added after the last code-review pipeline', async () => {
    // Rework cycle: code-review FAILed, Developer reworked, QA re-passed, now Reviewer should re-engage
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS',  '2026-01-01T07:00:00', '2026-01-01T08:00:00'),
      makePipeline('qa',             'PASS',  '2026-01-01T09:00:00', '2026-01-01T10:00:00'),
      // code-review started at T3 = 11:00
      makePipeline('code-review',    'FAIL',  '2026-01-01T11:00:00', '2026-01-01T12:00:00'),
      // New QA PASS completed at 14:00, AFTER code-review started_at = 11:00 → Reviewer re-engages
      makePipeline('qa',             'PASS',  '2026-01-01T13:00:00', '2026-01-01T14:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_REVIEW');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when QA PASS was completed before existing code-review (no rework needed)', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('qa',          'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('code-review', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// BLOCKED guard tests (Finding #7)
// ---------------------------------------------------------------------------

describe('getQaAction — excludes BLOCKED WPs from new-work suggestions', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_QA for a BLOCKED WP that has a PASS implementation', async () => {
    const wp = makeWorkPackageDetail({ status: 'BLOCKED', acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    // BLOCKED WP must not appear as new QA work
    expect(result.action).not.toBe('RUN_QA');
  });

  it('returns RUN_QA for a non-BLOCKED WP while skipping the BLOCKED one', async () => {
    const blocked = makeWorkPackageDetail({ status: 'BLOCKED', acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const ready = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [blocked, ready]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-002');
  });
});

describe('getReviewerAction — excludes BLOCKED WPs from new-work suggestions', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_REVIEW for a BLOCKED WP that has a PASS QA pipeline', async () => {
    const wp = makeWorkPackageDetail({ status: 'BLOCKED', acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RUN_REVIEW');
  });
});

describe('getDocumentationAction — excludes BLOCKED WPs from new-work suggestions', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return WRITE_DOCS for a BLOCKED WP that has a PASS code-review pipeline', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'BLOCKED',
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).not.toBe('WRITE_DOCS');
  });

  it('returns WRITE_DOCS for a non-BLOCKED WP that has a PASS code-review pipeline', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });
});

// ---------------------------------------------------------------------------
// PM action logic tests (§14.1.2)
// ---------------------------------------------------------------------------

describe('PM action logic', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // Case 1: BLOCKED WP with technical blocker → UNBLOCK_WP
  it('returns UNBLOCK_WP for a BLOCKED WP with blocked_by.type = "technical"', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ status: 'BLOCKED', acceptance_criteria: [], pipelines: [], blocked_by: { type: 'technical', description: 'requires a specialist decision' }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('UNBLOCK_WP');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 2: BLOCKED WP with dependency blocker → does NOT return UNBLOCK_WP
  it('does NOT return UNBLOCK_WP for a BLOCKED WP with blocked_by.type = "dependency"', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ status: 'BLOCKED', acceptance_criteria: [], pipelines: [], blocked_by: { type: 'dependency', description: 'waiting on WP-000', blocking_work_package: 'WP-000' },
      dependencies: ['WP-000'], });
    // WP-000 is still READY (not terminal), so canStartWorkPackage returns false
    const dep: WorkPackageDetail = makeWorkPackageDetail({ work_package_id: 'WP-000', work_package_file: 'work/WP-000.md', status: 'READY', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [dep, wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).not.toBe('UNBLOCK_WP');
  });

  // Case 3: IN_PROGRESS WP with rework_counts.qa at MAX → REVIEW_REWORK_LIMIT
  it('returns REVIEW_REWORK_LIMIT when rework_counts.qa has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { qa: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('REVIEW_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 4: IN_PROGRESS WP with a stale IN_PROGRESS pipeline (>24h) → REVIEW_STALE
  it('returns REVIEW_STALE for an IN_PROGRESS WP with a stale pipeline', async () => {
    // started_at is 48h ago
    const staleStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', staleStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('REVIEW_STALE');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 5: IN_PROGRESS WP, no IN_PROGRESS pipelines, last effective pipeline completed >24h ago → REVIEW_ABANDONED
  it('returns REVIEW_ABANDONED when the last effective pipeline completed >24h ago', async () => {
    const oldCompleted = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const oldStarted = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', oldStarted, oldCompleted),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('REVIEW_ABANDONED');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 6: IN_PROGRESS WP, no pipelines, status_changed_at < 24h ago (grace period) → does NOT return REVIEW_ABANDONED
  it('does NOT return REVIEW_ABANDONED when status_changed_at is within the grace period', async () => {
    const recentlyClaimed = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], status_changed_at: recentlyClaimed, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).not.toBe('REVIEW_ABANDONED');
  });

  // Case 7: BLOCKED WP, absent blocked_by, all deps COMPLETE → REPAIR_ORPHAN_BLOCKED
  it('returns REPAIR_ORPHAN_BLOCKED when a BLOCKED WP has no blocked_by and its dep is COMPLETE', async () => {
    const dep: WorkPackageDetail = makeWorkPackageDetail({ status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const wp: WorkPackageDetail = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', status: 'BLOCKED', acceptance_criteria: [], pipelines: [], dependencies: ['WP-001'], });
    const rootIndex = await setupStore(handle, [dep, wp]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('REPAIR_ORPHAN_BLOCKED');
    expect(result.work_package_id).toBe('WP-002');
  });

  // Case 8: All WPs COMPLETE → WAIT
  it('returns WAIT when all work packages are COMPLETE', async () => {
    const wp1 = makeWorkPackageDetail({ status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const wp2 = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp1, wp2]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });

  // Case 9: Priority ordering — UNBLOCK_WP (P1) fires before REVIEW_REWORK_LIMIT (P2)
  it('returns UNBLOCK_WP (P1) before REVIEW_REWORK_LIMIT (P2) when both conditions are present', async () => {
    // WP-001 has rework limit hit (would trigger P2)
    const wp1: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { implementation: MAX_REWORK_COUNT }, });
    // WP-002 has a technical blocker (triggers P1)
    const wp2: WorkPackageDetail = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', status: 'BLOCKED', acceptance_criteria: [], pipelines: [], blocked_by: { type: 'technical', description: 'needs architectural decision' }, });
    const rootIndex = await setupStore(handle, [wp1, wp2]);
    const result = await parseResult(getProjectManagerAction(rootIndex, handle.store));

    expect(result.action).toBe('UNBLOCK_WP');
    expect(result.work_package_id).toBe('WP-002');
  });
});

// ---------------------------------------------------------------------------
// Developer action logic tests (§14.2)
// ---------------------------------------------------------------------------

describe('Developer action logic', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // Case 1: rework_counts.implementation at MAX → BLOCK_FOR_REWORK_LIMIT
  it('returns BLOCK_FOR_REWORK_LIMIT when rework_counts.implementation has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { implementation: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 2: Active non-stale implementation pipeline → CONTINUE_PIPELINE
  it('returns CONTINUE_PIPELINE for an active non-stale IN_PROGRESS implementation pipeline', async () => {
    const recentStart = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30min ago
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', recentStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('CONTINUE_PIPELINE');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 3: Most recent implementation FAIL + separate WP with no pipeline → REWORK (not IMPLEMENT)
  it('returns REWORK (P4) before IMPLEMENT (P6) when first WP has a failed implementation pipeline', async () => {
    const wp1 = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'FAIL', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const wp2 = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp1, wp2]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 4: Implementation PASS, downstream FAIL, hasDownstreamReengagedSince = false → WAIT_FOR_DOWNSTREAM
  it('returns WAIT_FOR_DOWNSTREAM when downstream FAIL exists but developer already re-passed and downstream has not re-engaged', async () => {
    // Scenario: impl-1 PASS (T1=09:00), qa-1 FAIL (q-started T2=09:30), impl-2 rework PASS (T3=10:30)
    // → most recent impl PASS completed_at=10:30, most recent qa started_at=09:30
    // → qa started (09:30) < impl-2 completed (10:30) → hasDownstreamReengagedSince = false
    // → WAIT_FOR_DOWNSTREAM (fix delivered, waiting for QA to re-run)
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'), // impl-1 completed 09:00
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'), // qa-1 started 09:30, failed 10:00
      makePipeline('implementation', 'PASS', '2026-01-01T10:00:00', '2026-01-01T10:30:00'), // impl-2 rework completed 10:30
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_DOWNSTREAM');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 5: Implementation PASS (impl-2), qa FAIL, qa-2 started after impl-2 → REWORK
  it('returns REWORK (P5) when downstream FAIL and downstream re-engaged after last impl PASS', async () => {
    // Scenario: impl-2 completed at T3, qa-2 FAIL started at T4 (AFTER T3)
    // -> hasDownstreamReengagedSince = true -> REWORK
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS',  '2026-01-01T08:00:00', '2026-01-01T09:00:00'), // impl-1
      makePipeline('qa',             'FAIL',  '2026-01-01T09:30:00', '2026-01-01T10:00:00'), // qa-1 FAIL
      makePipeline('implementation', 'PASS',  '2026-01-01T10:30:00', '2026-01-01T11:00:00'), // impl-2 rework
      makePipeline('qa',             'FAIL',  '2026-01-01T11:30:00', '2026-01-01T12:00:00'), // qa-2 started AFTER impl-2
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 6: No implementation pipeline at all (IN_PROGRESS) → IMPLEMENT
  it('returns IMPLEMENT for an IN_PROGRESS WP with no implementation pipeline', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('IMPLEMENT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 7: READY WP assigned to Developer, deps satisfied → CLAIM_WP
  it('returns CLAIM_WP for a READY WP assigned to Developer with satisfied dependencies', async () => {
    const wp = makeWorkPackageDetail({ status: 'READY', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('CLAIM_WP');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 8: All WPs COMPLETE → WAIT
  it('returns WAIT when all work packages are COMPLETE', async () => {
    const wp1 = makeWorkPackageDetail({ status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const wp2 = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp1, wp2]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });

  // Case 9: FAIL implementation (P4) fires before no-pipeline WP (P6)
  it('returns REWORK (P4) before IMPLEMENT (P6) when both conditions present across two WPs', async () => {
    // Same as case 3 but confirm explicitly it's a priority ordering test
    const wpFail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'FAIL', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const wpNoPipeline = makeWorkPackageDetail({ work_package_id: 'WP-002', work_package_file: 'work/WP-002.md', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wpFail, wpNoPipeline]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    // P4 should fire for WP-001 before P6 fires for WP-002
    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });
});

// ---------------------------------------------------------------------------
// QA action logic tests (§14.3)
// ---------------------------------------------------------------------------

describe('QA action logic', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // Case 1: rework_counts.qa at MAX → BLOCK_FOR_REWORK_LIMIT
  it('returns BLOCK_FOR_REWORK_LIMIT when rework_counts.qa has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { qa: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 2: rework_counts.implementation at MAX → WAIT_FOR_UPSTREAM_REWORK_LIMIT
  it('returns WAIT_FOR_UPSTREAM_REWORK_LIMIT when rework_counts.implementation has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { implementation: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 3: Active non-stale QA pipeline → CONTINUE_PIPELINE
  it('returns CONTINUE_PIPELINE for an active non-stale IN_PROGRESS QA pipeline', async () => {
    const recentStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('qa', 'IN_PROGRESS', recentStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('CONTINUE_PIPELINE');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 4: Prior QA FAIL + new impl PASS (re-engagement) → RUN_QA (P4 path)
  it('returns RUN_QA (re-engagement, P4) when prior QA FAIL exists and new impl PASS is available', async () => {
    // impl-1 PASS, qa-1 FAIL, impl-2 PASS (after qa-1 started) → re-engagement
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T10:30:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 5: No prior QA + impl PASS (first-run) → RUN_QA (P6 path)
  it('returns RUN_QA (first-run, P6) when no prior QA pipeline exists and impl PASS is available', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 6: Most recent QA FAIL, no new upstream pass → WAIT_FOR_REWORK
  it('returns WAIT_FOR_REWORK when most recent QA is FAIL and no new impl PASS exists', async () => {
    // impl PASS then qa FAIL — no new impl PASS after qa started → no re-engagement
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 7: READY WP assigned to QA → CLAIM_WP
  it('returns CLAIM_WP for a READY WP assigned to QA', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ status: 'READY', acceptance_criteria: [], pipelines: [], assigned_to: 'QA' });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('CLAIM_WP');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 8: All WPs at rest → WAIT
  it('returns WAIT when all work packages are COMPLETE', async () => {
    const wp = makeWorkPackageDetail({ status: 'COMPLETE', acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// Reviewer action logic tests (§14.4)
// ---------------------------------------------------------------------------

describe('Reviewer action logic', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // Case 9: rework_counts["code-review"] at MAX → BLOCK_FOR_REWORK_LIMIT
  it('returns BLOCK_FOR_REWORK_LIMIT when rework_counts["code-review"] has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { 'code-review': MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 10: rework_counts.qa at MAX → WAIT_FOR_UPSTREAM_REWORK_LIMIT
  it('returns WAIT_FOR_UPSTREAM_REWORK_LIMIT when rework_counts.qa has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { qa: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 11: rework_counts.implementation at MAX → WAIT_FOR_UPSTREAM_REWORK_LIMIT
  it('returns WAIT_FOR_UPSTREAM_REWORK_LIMIT when rework_counts.implementation has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { implementation: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 12: Prior review FAIL + new QA PASS → RUN_REVIEW (re-engagement)
  it('returns RUN_REVIEW (re-engagement, P4) when prior code-review FAIL and new QA PASS available', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS',  '2026-01-01T07:00:00', '2026-01-01T08:00:00'),
      makePipeline('qa',             'PASS',  '2026-01-01T09:00:00', '2026-01-01T10:00:00'),
      makePipeline('code-review',    'FAIL',  '2026-01-01T11:00:00', '2026-01-01T12:00:00'),
      makePipeline('qa',             'PASS',  '2026-01-01T13:00:00', '2026-01-01T14:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_REVIEW');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 13: No prior review + QA PASS (first-run) → RUN_REVIEW (P6)
  it('returns RUN_REVIEW (first-run, P6) when no prior code-review and QA PASS is available', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_REVIEW');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 14: Most recent code-review FAIL, no new QA PASS → WAIT_FOR_REWORK
  it('returns WAIT_FOR_REWORK when code-review is FAIL and no new QA PASS since then', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('qa',          'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('code-review', 'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 15: READY WP assigned to Reviewer → CLAIM_WP
  it('returns CLAIM_WP for a READY WP assigned to Reviewer', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ status: 'READY', acceptance_criteria: [], pipelines: [], assigned_to: 'Reviewer' });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('CLAIM_WP');
    expect(result.work_package_id).toBe('WP-001');
  });
});

// ---------------------------------------------------------------------------
// Documentation action logic tests (§14.5)
// ---------------------------------------------------------------------------

describe('Documentation action logic', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // Case 1: rework_counts.documentation at MAX → BLOCK_FOR_REWORK_LIMIT
  it('returns BLOCK_FOR_REWORK_LIMIT when rework_counts.documentation has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { documentation: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 2: rework_counts["code-review"] at MAX → WAIT_FOR_UPSTREAM_REWORK_LIMIT
  it('returns WAIT_FOR_UPSTREAM_REWORK_LIMIT when rework_counts["code-review"] has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { 'code-review': MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 3: rework_counts.implementation at MAX → WAIT_FOR_UPSTREAM_REWORK_LIMIT
  it('returns WAIT_FOR_UPSTREAM_REWORK_LIMIT when rework_counts.implementation has reached MAX_REWORK_COUNT', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [], rework_counts: { implementation: MAX_REWORK_COUNT }, });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 4: Active non-stale documentation pipeline → CONTINUE_PIPELINE
  it('returns CONTINUE_PIPELINE for an active non-stale IN_PROGRESS documentation pipeline', async () => {
    const recentStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('documentation', 'IN_PROGRESS', recentStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('CONTINUE_PIPELINE');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 5: Most recent documentation FAIL with new code-review PASS → REWORK (P4 before P6)
  it('returns REWORK (P4) before WRITE_DOCS (P6) when doc FAIL and code-review PASS are both present', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS',        '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS',        '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review',    'PASS',        '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      makePipeline('documentation',  'FAIL',        '2026-01-01T14:00:00', '2026-01-01T15:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 6: Doc PASS, all criteria met, doc completed_at > impl started_at → FINALIZE_WP
  it('returns FINALIZE_WP when doc PASS, all criteria met, and freshness check passes', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('documentation',  'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ], acceptance_criteria: [{ criterion: 'All docs updated', met: true }], });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('FINALIZE_WP');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 7: Doc PASS, freshness OK, one criterion met: false → UPDATE_CRITERIA
  it('returns UPDATE_CRITERIA when doc PASS and fresh but at least one criterion is not met', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('documentation',  'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      ], acceptance_criteria: [
        { criterion: 'All docs updated', met: true },
        { criterion: 'README updated', met: false },
      ], });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('UPDATE_CRITERIA');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 8: Doc PASS but stale (completed_at < latest impl started_at) → WRITE_DOCS (via P6)
  it('falls through to WRITE_DOCS when doc PASS exists but is stale (new impl PASS since doc)', async () => {
    // doc PASS at T4(=11:00), impl-2 starts at T5(=12:00) → doc is stale; new code-review PASS at T7 re-triggers P6
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('documentation',  'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'), // stale: completed before impl-2's started_at
      makePipeline('implementation', 'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'), // impl-2: started AFTER doc completed
      makePipeline('code-review',    'PASS', '2026-01-01T14:00:00', '2026-01-01T15:00:00'), // new code-review after doc → re-engages P6
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 9: Code-review PASS, no documentation pipeline (first-run) → WRITE_DOCS
  it('returns WRITE_DOCS when code-review PASS exists and no documentation pipeline has run', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 10: Code-review PASS (re-engagement) + prior doc FAIL + NEW code-review PASS after doc started → WRITE_DOCS
  it('returns WRITE_DOCS (re-engagement, P6) when prior doc FAIL and new code-review PASS available after doc started', async () => {
    // New code-review PASS (T12) appears AFTER doc started (T10) → hasNewUpstreamPassSince=true → P4 guard fails → P6 fires
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('code-review',   'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('documentation', 'FAIL', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review',   'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'), // new code-review PASS after doc started
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });

  // Case 11: READY WP assigned to Documentation → CLAIM_WP
  it('returns CLAIM_WP for a READY WP assigned to Documentation', async () => {
    const wp: WorkPackageDetail = makeWorkPackageDetail({ status: 'READY', acceptance_criteria: [], pipelines: [], assigned_to: 'Documentation' });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('CLAIM_WP');
    expect(result.work_package_id).toBe('WP-001');
  });
});

// ---------------------------------------------------------------------------
// Integration — full pipeline lifecycle (impl → qa-fail → rework → qa-pass)
// ---------------------------------------------------------------------------
//
// Verifies 5 canonical lifecycle states × 2 agent perspectives (Developer + QA).
// Each state builds a WP with progressively extended pipeline history and asserts
// the correct action for both agents — 10 assertions total.
//
// Timeline of pipeline timestamps used throughout:
//   T1=08:00 impl-1 started    T2=09:00 impl-1 completed (PASS)
//   T3=09:30 qa-1 started      T4=10:00 qa-1 completed   (FAIL)
//   T5=10:30 impl-2 started    T6=11:00 impl-2 completed (PASS)
//   T7=11:30 qa-2 started      T8=12:00 qa-2 completed   (PASS)
// ---------------------------------------------------------------------------

describe('Integration — full pipeline lifecycle (impl → qa-fail → rework → qa-pass)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // State 1 — Fresh: IN_PROGRESS WP, no pipelines yet
  it('[State 1 / Developer] returns IMPLEMENT for a fresh WP with no pipelines', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('IMPLEMENT');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('[State 1 / QA] returns WAIT for a fresh WP with no impl PASS', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });

  // State 2 — impl-1 PASS: single implementation pipeline completed successfully
  it('[State 2 / Developer] returns WAIT after impl-1 PASS while QA has not yet started', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    // WAIT responses do not include a work_package_id (no action required)
    expect(result.action).toBe('WAIT');
  });

  it('[State 2 / QA] returns RUN_QA (first-run) after impl-1 PASS', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  // State 3 — qa-1 FAIL: QA started at T3=09:30 (after impl-1 completed T2=09:00) and failed
  //   Developer: hasDownstreamReengagedSince = true (qa-1 started after impl-1 completed) → REWORK
  //   QA:        most recent qa is FAIL, no new impl PASS since qa-1 started → WAIT_FOR_REWORK
  it('[State 3 / Developer] returns REWORK when qa-1 FAILed and re-engaged after impl-1 PASS', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('[State 3 / QA] returns WAIT_FOR_REWORK when qa-1 FAILed and no new impl PASS yet', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });

  // State 4 — impl-2 PASS: rework delivered (impl-2 completed T6=11:00, after qa-1 started T3=09:30)
  //   Developer: qa hasn't re-run since impl-2 (qa started T3 < impl-2 completed T6)
  //              hasDownstreamReengagedSince = false → WAIT_FOR_DOWNSTREAM
  //   QA:        new impl PASS (T6=11:00) exists after qa-1 started (T3=09:30)
  //              hasNewUpstreamPassSince = true → RUN_QA (re-engagement)
  it('[State 4 / Developer] returns WAIT_FOR_DOWNSTREAM after impl-2 PASS (fix delivered, QA not yet re-run)', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T10:30:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_DOWNSTREAM');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('[State 4 / QA] returns RUN_QA (re-engagement) after impl-2 PASS landed after qa-1 started', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T10:30:00', '2026-01-01T11:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  // State 5 — qa-2 PASS: full rework cycle complete
  //   Developer: most recent impl PASS, most recent downstream (qa-2) PASS → no failure to address → WAIT
  //   QA:        most recent qa PASS, no new impl PASS since qa-2 started (T7=11:30 > T6=11:00) → WAIT
  it('[State 5 / Developer] returns WAIT after qa-2 PASS (full rework cycle complete)', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T10:30:00', '2026-01-01T11:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T11:30:00', '2026-01-01T12:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    // WAIT responses do not include a work_package_id (no action required for Developer)
    expect(result.action).toBe('WAIT');
  });

  it('[State 5 / QA] returns WAIT after qa-2 PASS (no new impl PASS since qa-2 started)', async () => {
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      makePipeline('implementation', 'PASS', '2026-01-01T10:30:00', '2026-01-01T11:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T11:30:00', '2026-01-01T12:00:00'),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });
});

// ─── getDocumentationAction — hasDependencyBlocked integration (WP-003) ──────
//
// Exercises the end-to-end path through getDocumentationAction where a WP is
// BLOCKED by a dependency constraint. The WP has all prerequisite pipelines
// (impl/qa/code-review PASS) so it would normally be eligible for WRITE_DOCS,
// but the dependency-block guard must prevent that.
//
// This test uses canonical fixtures from tests/helpers/ only (makeWorkPackageDetail,
// makePipeline from fixtures.ts; createTempStore/cleanupTempStore from
// create-temp-store.ts) — no local factory functions per §55.

describe('getDocumentationAction — BLOCKED-by-dependency guard (hasDependencyBlocked integration)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return WRITE_DOCS for a WP that is BLOCKED by dependency, even when all upstream pipelines PASS', async () => {
    // WP-001: BLOCKED (type=dependency) — has all 3 required PASS pipelines, so would be
    // eligible for docs if not blocked. The hasDependencyBlocked/BLOCKED guard must skip it.
    const blockedWp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'BLOCKED',
      dependencies: ['WP-002'],
      blocked_by: {
        type: 'dependency',
        description: 'Waiting for WP-002 to be unblocked',
        blocking_work_package: 'WP-002',
      },
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });

    // WP-002: BLOCKED (the upstream blocker)
    const blockerWp = makeWorkPackageDetail({
      work_package_id: 'WP-002',
      status: 'BLOCKED',
      dependencies: [],
      blocked_by: { type: 'technical', description: 'Waiting on external API' },
      pipelines: [],
    });

    const rootIndex: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T08:00:00',
      last_updated: '2026-01-01T13:00:00',
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'BLOCKED',
          assigned_to: 'Documentation',
          dependencies: ['WP-002'],
          file: 'ledger/WP-001.json',
        },
        {
          work_package_id: 'WP-002',
          status: 'BLOCKED',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-002.json',
        },
      ],
      project_comments: [],
    };

    await handle.store.writeRootIndex(rootIndex);
    await handle.store.writeWorkPackage('WP-001', blockedWp);
    await handle.store.writeWorkPackage('WP-002', blockerWp);

    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    // BLOCKED WPs (including those blocked by dependency) must not receive WRITE_DOCS
    expect(result.action).not.toBe('WRITE_DOCS');
  });

  it('returns WRITE_DOCS for WP-001 once it is no longer BLOCKED (regression guard)', async () => {
    // Same WP but now IN_PROGRESS (unblocked) — confirms the guard is not over-zealous
    const unblockedWp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      dependencies: ['WP-002'],
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
        makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      ],
    });

    const rootIndex: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T08:00:00',
      last_updated: '2026-01-01T13:00:00',
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Documentation',
          dependencies: ['WP-002'],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };

    await handle.store.writeRootIndex(rootIndex);
    await handle.store.writeWorkPackage('WP-001', unblockedWp);

    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });
});

// ---------------------------------------------------------------------------
// FIX-05 — RESUME_OR_CANCEL for stale pipelines (§14.2–§14.5, P2)
// ---------------------------------------------------------------------------

describe('Developer action — RESUME_OR_CANCEL for stale implementation pipeline (FIX-05)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RESUME_OR_CANCEL when Developer has a stale IN_PROGRESS implementation pipeline (>24h)', async () => {
    const staleStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', staleStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).toBe('RESUME_OR_CANCEL');
    expect(result.work_package_id).toBe('WP-001');
    expect(result.pipeline_type).toBe('implementation');
    expect(result.age_hours).toBeGreaterThanOrEqual(47);
  });

  it('does NOT return RESUME_OR_CANCEL for a non-stale implementation pipeline (<24h)', async () => {
    const recentStart = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30min ago
    const wp = makeWorkPackageDetail({ acceptance_criteria: [], pipelines: [
      makePipeline('implementation', 'IN_PROGRESS', recentStart),
    ] });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDeveloperAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RESUME_OR_CANCEL');
  });
});

describe('QA action — RESUME_OR_CANCEL for stale QA pipeline (FIX-05)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RESUME_OR_CANCEL when QA has a stale IN_PROGRESS qa pipeline (>24h)', async () => {
    const staleStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({
      assigned_to: 'QA',
      acceptance_criteria: [],
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'IN_PROGRESS', staleStart),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RESUME_OR_CANCEL');
    expect(result.work_package_id).toBe('WP-001');
    expect(result.pipeline_type).toBe('qa');
    expect(result.age_hours).toBeGreaterThanOrEqual(47);
  });
});

// ---------------------------------------------------------------------------
// FIX-13 — PM returns CREATE_WORK_PACKAGES when project has zero WPs (§21.2)
// ---------------------------------------------------------------------------

describe('PM action — CREATE_WORK_PACKAGES when project has zero work packages (FIX-13)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns CREATE_WORK_PACKAGES when there are no work packages', async () => {
    // Set up an empty project (zero WPs)
    const rootIndex: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T08:00:00',
      last_updated: '2026-01-01T08:00:00',
      status: 'READY',
      total_work_packages: 0,
      pending_work_packages: 0,
      work_packages: [],
      project_comments: [],
    };
    await handle.store.writeRootIndex(rootIndex);

    // getNextAction creates its own LedgerStore — inject ledger root via process.argv
    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Project Manager' })
      );
      expect(result.action).toBe('CREATE_WORK_PACKAGES');
    } finally {
      process.argv = originalArgv;
    }
  });
});

// ---------------------------------------------------------------------------
// max_results — batch collector mode
// ---------------------------------------------------------------------------

describe('getNextActionsCollector — batch mode via max_results', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns an "actions" array when called via getNextActionsCollector', async () => {
    // Three independent READY WPs assigned to Developer
    const wps = [
      makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-002', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-003', status: 'READY', pipelines: [] }),
    ];
    const rootIndex = await setupStore(handle, wps);

    const result = await parseResult(_internal.getNextActionsCollector(rootIndex, handle.store, 'Developer', 3));
    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.total).toBe(3);
    expect(result.actions).toHaveLength(3);
    for (const action of result.actions) {
      expect(action.action).toBe('IMPLEMENT');
    }
  });

  it('limits results to max_results count', async () => {
    const wps = [
      makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-002', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-003', status: 'READY', pipelines: [] }),
    ];
    const rootIndex = await setupStore(handle, wps);

    const result = await parseResult(_internal.getNextActionsCollector(rootIndex, handle.store, 'Developer', 2));
    expect(result.actions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('returns fewer items than limit when fewer WPs are actionable', async () => {
    // Only one READY WP
    const wps = [
      makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY', pipelines: [] }),
    ];
    const rootIndex = await setupStore(handle, wps);

    const result = await parseResult(_internal.getNextActionsCollector(rootIndex, handle.store, 'Developer', 5));
    expect(result.actions).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('returns empty actions array for non-applicable roles (Project Manager)', async () => {
    const wps = [makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY', pipelines: [] })];
    const rootIndex = await setupStore(handle, wps);

    const result = await parseResult(_internal.getNextActionsCollector(rootIndex, handle.store, 'Project Manager', 5));
    expect(result.actions).toHaveLength(0);
    expect(result.reason).toContain('not applicable');
  });

  it('stops fetching WPs after limit actions are found (sequential early-exit)', async () => {
    // Set up 5 READY WPs — only the first 2 need to be read when limit is 2
    const wps = [
      makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-002', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-003', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-004', status: 'READY', pipelines: [] }),
      makeWorkPackageDetail({ work_package_id: 'WP-005', status: 'READY', pipelines: [] }),
    ];
    const rootIndex = await setupStore(handle, wps);

    // Spy on store.readWorkPackage to count actual disk reads
    const readSpy = vi.spyOn(handle.store, 'readWorkPackage');

    const result = await parseResult(_internal.getNextActionsCollector(rootIndex, handle.store, 'Developer', 2));

    // Should have returned exactly 2 actions
    expect(result.actions).toHaveLength(2);
    expect(result.total).toBe(2);

    // Sequential early-exit: only 2 WPs should have been read, not all 5
    expect(readSpy).toHaveBeenCalledTimes(2);

    readSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handoff_status embedding in WAIT responses (§WP-004)
// ---------------------------------------------------------------------------

describe('getNextAction — handoff_status embedded in WAIT responses', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
    // Reset the agent registry to prevent state leakage into sibling tests (constraint 28).
    resetRegistry();
  });

  it('embeds handoff_status when Developer has no more work (WAIT → READY_FOR_QA)', async () => {
    // WP-001: Developer, IN_PROGRESS, PASS implementation → no more work for Developer
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      pipelines: [makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00')],
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Developer' })
      );
      expect(result.action).toBe('WAIT');
      expect(result.handoff_status).toBeDefined();
      expect(result.handoff_status.current_agent).toBe('Developer');
      expect(result.handoff_status.next_agent).toBe('QA');
      expect(result.handoff_status.status).toBe('READY_FOR_QA');
    } finally {
      process.argv = originalArgv;
    }
  });

  it('does not embed handoff_status in non-WAIT responses', async () => {
    // WP-001: Developer, READY → CLAIM_WP / IMPLEMENT (not WAIT)
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'READY',
      assigned_to: 'Developer',
      pipelines: [],
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Developer' })
      );
      expect(result.action).not.toBe('WAIT');
      expect(result.handoff_status).toBeUndefined();
    } finally {
      process.argv = originalArgv;
    }
  });

  it('handoff_status.auto_handoff is absent when agent registry is not loaded (test environment default)', async () => {
    // WP-001: Developer, IN_PROGRESS, PASS implementation → WAIT with handoff_status but no auto_handoff
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      pipelines: [makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00')],
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Developer' })
      );
      expect(result.action).toBe('WAIT');
      expect(result.handoff_status).toBeDefined();
      // auto_handoff absent: agent registry is not loaded in the test environment
      expect(result.handoff_status.auto_handoff).toBeUndefined();
    } finally {
      process.argv = originalArgv;
    }
  });

  it('handoff_status.auto_handoff present when agent registry is loaded (synthesis #10)', async () => {
    // Load a mock agent registry with a QA handle so that auto_handoff is populated.
    const agentsDir = await mkdtemp(join(tmpdir(), 'mock-agents-'));
    try {
      // Write a minimal .agent.md file for the QA role.
      await writeFile(
        join(agentsDir, 'qa.agent.md'),
        ['---', 'name: Mock QA Agent', 'role: QA', '---', '', '# QA Agent'].join('\n'),
        'utf8',
      );
      await discoverAgents(agentsDir);

      const wp = makeWorkPackageDetail({
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer',
        pipelines: [makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00')],
      });
      await setupStore(handle, [wp]);

      const originalArgv = [...process.argv];
      process.argv.push('--ledger-dir', handle.ledgerRoot);
      try {
        const result = await parseResult(
          _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Developer' })
        );
        expect(result.action).toBe('WAIT');
        expect(result.handoff_status).toBeDefined();
        // next_agent is present at the handoff_status level
        expect(result.handoff_status.next_agent).toBe('QA');
        // auto_handoff is present because the registry is loaded and QA has a known handle
        expect(result.handoff_status.auto_handoff).toBeDefined();
        // agent_name (VS Code handle) and prompt are the two auto_handoff fields
        expect(result.handoff_status.auto_handoff.agent_name).toBeTypeOf('string');
        expect(result.handoff_status.auto_handoff.prompt).toBeTypeOf('string');
      } finally {
        process.argv = originalArgv;
      }
    } finally {
      // Clean up the temp agents directory regardless of test outcome.
      await rm(agentsDir, { recursive: true, force: true });
    }
  });

  it('embeds handoff_status in PM WAIT response (bug fix: PM case was missing embedHandoffStatusInWait)', async () => {
    // Set up a project with one WP that is IN_PROGRESS with an active (non-stale)
    // IN_PROGRESS pipeline — no PM-priority actions fire (no blockers, no stale
    // pipelines, no rework violations), so PM falls through to WAIT.
    // Use a dynamic recent timestamp (1 hour ago) so the pipeline is never stale.
    const recentStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      pipelines: [makePipeline('implementation', 'IN_PROGRESS', recentStart)],
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ project_path: PLAN_PATH, agent_role: 'Project Manager' })
      );
      expect(result.action).toBe('WAIT');
      expect(result.handoff_status).toBeDefined();
      expect(result.handoff_status.current_agent).toBe('Project Manager');
    } finally {
      process.argv = originalArgv;
    }
  });
});

// ---------------------------------------------------------------------------
// WP-005: cwd_path auto-detection (end-to-end)
// ---------------------------------------------------------------------------

describe('getNextAction — cwd_path auto-detection (WP-005)', () => {
  // Use a plan path that is properly nested 4 levels under a project root
  // so that inferProjectRootFromPlanPath() can round-trip back to projectRoot.
  let projectRoot: string;
  let planPath: string;
  let handle: TempStoreHandle;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'cwd-proj-root-'));
    planPath = join(projectRoot, 'docs', 'agents', 'plans', '2026-01-01-cwd-e2e');
    handle = await createTempStore(planPath);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns a valid action when cwd_path is passed instead of project_path', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'READY',
      assigned_to: 'Developer',
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const result = await parseResult(
        _internal.getNextAction({ cwd_path: projectRoot, agent_role: 'Developer' })
      );
      // READY WP → CLAIM_WP action (claim before implement)
      expect(result.action).toBe('CLAIM_WP');
      expect(result.work_package_id).toBe('WP-001');
    } finally {
      process.argv = originalArgv;
    }
  });

  it('returns an error when cwd_path does not match any project', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'READY',
      assigned_to: 'Developer',
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      const rawResult = await _internal.getNextAction({ cwd_path: '/nonexistent/path/not/a/project', agent_role: 'Developer' });
      // Error responses are plain text (not JSON) with isError: true
      expect((rawResult as any).isError).toBe(true);
      expect((rawResult as any).content[0].text).toMatch(/No project found/i);
    } finally {
      process.argv = originalArgv;
    }
  });

  it('uses project_path when both project_path and cwd_path are provided', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'READY',
      assigned_to: 'Developer',
    });
    await setupStore(handle, [wp]);

    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', handle.ledgerRoot);
    try {
      // project_path takes precedence over cwd_path — should succeed, not error
      const result = await parseResult(
        _internal.getNextAction({ project_path: planPath, cwd_path: '/some/other/path', agent_role: 'Developer' })
      );
      expect(result.action).toBe('CLAIM_WP');
      expect(result.work_package_id).toBe('WP-001');
    } finally {
      process.argv = originalArgv;
    }
  });
});

// ---------------------------------------------------------------------------
// Security Auditor — respects active_pipeline_stages (dynamic pipeline engine)
// ---------------------------------------------------------------------------

describe('getSecurityAuditorAction — active_pipeline_stages filtering', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns WAIT when no WP has security-audit in active stages (default 4-stage)', async () => {
    // WP uses DEFAULT_PIPELINE_STAGES (no active_pipeline_stages field) → no security-audit
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      pipelines: [makePipeline({ type: 'implementation', status: 'PASS' })],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));
    expect(result.action).toBe('WAIT');
  });

  it('returns WAIT when WP explicitly omits security-audit from active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));
    expect(result.action).toBe('WAIT');
  });

  it('returns RUN_SECURITY_AUDIT when qa PASS and security-audit is in all-6 active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Security Auditor',
      active_pipeline_stages: ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));
    expect(result.action).toBe('RUN_SECURITY_AUDIT');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when qa not yet PASS for a WP with security-audit in active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      active_pipeline_stages: ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'IN_PROGRESS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));
    // No qualifying WP (qa not yet PASS) → should return WAIT
    expect(result.action).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// Release Engineer — respects active_pipeline_stages (dynamic pipeline engine)
// ---------------------------------------------------------------------------

describe('getReleaseEngineerAction — active_pipeline_stages filtering', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns WAIT when no WP has release-engineering in active stages (default 4-stage)', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Reviewer',
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
        makePipeline({ type: 'code-review', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getReleaseEngineerAction(rootIndex, handle.store));
    expect(result.action).toBe('WAIT');
  });

  it('returns WAIT when WP explicitly omits release-engineering from active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Reviewer',
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
        makePipeline({ type: 'code-review', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getReleaseEngineerAction(rootIndex, handle.store));
    expect(result.action).toBe('WAIT');
  });

  it('returns RUN_RELEASE_ENGINEERING when code-review PASS and release-engineering is in all-6 active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Release Engineer',
      active_pipeline_stages: ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
        makePipeline({ type: 'security-audit', status: 'PASS' }),
        makePipeline({ type: 'code-review', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getReleaseEngineerAction(rootIndex, handle.store));
    expect(result.action).toBe('RUN_RELEASE_ENGINEERING');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when code-review not yet PASS for a WP with release-engineering in active stages', async () => {
    const wp = makeWorkPackageDetail({
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Reviewer',
      active_pipeline_stages: ['implementation', 'qa', 'code-review', 'release-engineering', 'documentation'],
      pipelines: [
        makePipeline({ type: 'implementation', status: 'PASS' }),
        makePipeline({ type: 'qa', status: 'PASS' }),
        makePipeline({ type: 'code-review', status: 'IN_PROGRESS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getReleaseEngineerAction(rootIndex, handle.store));
    // No qualifying WP (code-review not yet PASS) → WAIT
    expect(result.action).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// First-active-stage loop prevention — regression tests (§21.66)
//
// When a pipeline type is the FIRST active stage (e.g., qa in ["qa","code-review"]),
// resolvePrerequisite() returns null. At P4/P5 re-engagement, null must resolve to
// false ("no upstream to re-engage from"), not true ("always re-engage"). Returning
// true would create an infinite loop: after the PASS, P4 re-fires unconditionally.
// ---------------------------------------------------------------------------

describe('first-active-stage loop prevention — Reviewer P4 (§21.66 regression)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_REVIEW after code-review PASS when code-review is the first active stage', async () => {
    // Reproduces the infinite-loop scenario: code-review is first in active_pipeline_stages,
    // so resolvePrerequisite("code-review", stages) === null. With the old bug (null → true),
    // P4 re-engagement would fire unconditionally after the PASS, looping forever.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'Reviewer',
      active_pipeline_stages: ['code-review', 'documentation'],
      pipelines: [
        makePipeline({ type: 'code-review', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RUN_REVIEW');
    expect(result.action).toBe('WAIT');
  });
});

describe('first-active-stage loop prevention — QA P4 (§21.66 regression)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_QA after qa PASS when qa is the first active stage', async () => {
    // Reproduces the infinite-loop scenario: qa is first in active_pipeline_stages,
    // so resolvePrerequisite("qa", stages) === null. With the old bug (null → true),
    // P4 re-engagement would fire unconditionally after the PASS, looping forever.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      active_pipeline_stages: ['qa', 'code-review'],
      pipelines: [
        makePipeline({ type: 'qa', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RUN_QA');
    expect(result.action).toBe('WAIT');
  });
});

describe('first-active-stage loop prevention — Security Auditor P4 (§21.66 regression)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_SECURITY_AUDIT after security-audit PASS when security-audit is the first active stage', async () => {
    // Reproduces the infinite-loop scenario: security-audit is first in active_pipeline_stages,
    // so resolvePrerequisite("security-audit", stages) === null. With the old bug (null → true),
    // P4 re-engagement would fire unconditionally after the PASS, looping forever.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'Security Auditor',
      active_pipeline_stages: ['security-audit', 'code-review'],
      pipelines: [
        makePipeline({ type: 'security-audit', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RUN_SECURITY_AUDIT');
    expect(result.action).toBe('WAIT');
  });
});

describe('first-active-stage loop prevention — Release Engineer P5 (§21.66 regression)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does NOT return RUN_RELEASE_ENGINEERING after release-engineering PASS when release-engineering is the first active stage', async () => {
    // Reproduces the infinite-loop scenario: release-engineering is first in active_pipeline_stages,
    // so resolvePrerequisite("release-engineering", stages) === null. With the old bug (null → true),
    // P5 re-engagement would fire unconditionally after the PASS, looping forever.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'Release Engineer',
      active_pipeline_stages: ['release-engineering', 'documentation'],
      pipelines: [
        makePipeline({ type: 'release-engineering', status: 'PASS' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);

    const result = await parseResult(_internal.getReleaseEngineerAction(rootIndex, handle.store));

    expect(result.action).not.toBe('RUN_RELEASE_ENGINEERING');
    expect(result.action).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// First-active-stage self-rework deadlock tests (§21.67)
// ---------------------------------------------------------------------------

describe('first-active-stage self-rework fallback — QA P4b (§21.67)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RUN_QA (self-rework) when qa is the first active stage and most recent QA is FAIL', async () => {
    // QA is the first active stage → FAIL routing falls back to QA (self-rework).
    // P4b should fire instead of P5 WAIT_FOR_REWORK.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      active_pipeline_stages: ['qa', 'code-review'],
      pipelines: [
        makePipeline({ type: 'qa', status: 'FAIL', started_at: '2026-01-01T09:00:00', completed_at: '2026-01-01T10:00:00' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.reason).toContain('self-rework');
  });

  it('returns WAIT_FOR_REWORK when qa is NOT the first active stage and most recent QA is FAIL', async () => {
    // Standard WP with implementation active → QA FAIL routes to Developer, not self-rework.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      pipelines: [
        makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
        makePipeline('qa', 'FAIL', '2026-01-01T09:30:00', '2026-01-01T10:00:00'),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT_FOR_REWORK');
  });

  it('returns RUN_QA (first run, P6) when qa is the first active stage with no prior QA pipeline', async () => {
    // First run — no prior QA pipeline, QA is first active stage → P6 fires.
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      active_pipeline_stages: ['qa', 'code-review'],
      pipelines: [],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
  });
});

describe('first-active-stage self-rework fallback — Reviewer P4b (§21.67)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RUN_REVIEW (self-rework) when code-review is the first active stage and most recent review is FAIL', async () => {
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'Reviewer',
      active_pipeline_stages: ['code-review'],
      pipelines: [
        makePipeline({ type: 'code-review', status: 'FAIL', started_at: '2026-01-01T09:00:00', completed_at: '2026-01-01T10:00:00' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_REVIEW');
    expect(result.reason).toContain('self-rework');
  });
});

describe('first-active-stage self-rework fallback — Security Auditor P4b (§21.67)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('returns RUN_SECURITY_AUDIT (self-rework) when security-audit is the first active stage and most recent audit is FAIL', async () => {
    const wp = makeWorkPackageDetail({
      status: 'IN_PROGRESS',
      assigned_to: 'Security Auditor',
      active_pipeline_stages: ['security-audit', 'code-review'],
      pipelines: [
        makePipeline({ type: 'security-audit', status: 'FAIL', started_at: '2026-01-01T09:00:00', completed_at: '2026-01-01T10:00:00' }),
      ],
    });
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(_internal.getSecurityAuditorAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_SECURITY_AUDIT');
    expect(result.reason).toContain('self-rework');
  });
});
