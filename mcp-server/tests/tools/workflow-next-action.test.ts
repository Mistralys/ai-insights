import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { getQaAction, getReviewerAction, getDocumentationAction } from '../../src/tools/workflow-next-action.js';
import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';
import type { TempStoreHandle } from '../helpers/create-temp-store.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

/** Helper to parse the JSON from a tool result */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

// Fixed plan path; using YYYY-MM-DD format so planFolderBasename() accepts it.
const PLAN_PATH = join(tmpdir(), '2026-01-01-next-action-test');

/** Build a Pipeline stub with optional timestamps. */
function makePipeline(
  type: string,
  status: string,
  started_at?: string,
  completed_at?: string
): Pipeline {
  return {
    type,
    status: status as any,
    summary: [],
    ...(started_at ? { started_at } : {}),
    ...(completed_at ? { completed_at } : {}),
  };
}

/** Build a minimal WP detail with typed pipelines. */
function makeWpDetail(
  id: string,
  status: string,
  pipelines: Pipeline[]
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 1,
    pipelines,
  };
}

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
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS',  '2026-01-01T08:00:00', '2026-01-01T09:00:00'), // T1
      makePipeline('qa',             'PASS',  '2026-01-01T10:00:00', '2026-01-01T11:00:00'), // T2 start
      makePipeline('code-review',    'FAIL',  '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
      // New implementation PASS (rework) — completed at T3 = 14:00, which is AFTER qa started_at = 10:00
      makePipeline('implementation', 'PASS',  '2026-01-01T13:30:00', '2026-01-01T14:00:00'), // T3
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_QA');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when implementation PASS was completed before existing QA (no rework needed)', async () => {
    // Normal cycle: single implementation PASS, then QA PASS — no rework
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    expect(result.action).toBe('WAIT');
  });

  it('returns RUN_QA for first-run when only implementation PASS exists', async () => {
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ]);
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
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS',  '2026-01-01T07:00:00', '2026-01-01T08:00:00'),
      makePipeline('qa',             'PASS',  '2026-01-01T09:00:00', '2026-01-01T10:00:00'),
      // code-review started at T3 = 11:00
      makePipeline('code-review',    'FAIL',  '2026-01-01T11:00:00', '2026-01-01T12:00:00'),
      // New QA PASS completed at 14:00, AFTER code-review started_at = 11:00 → Reviewer re-engages
      makePipeline('qa',             'PASS',  '2026-01-01T13:00:00', '2026-01-01T14:00:00'),
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getReviewerAction(rootIndex, handle.store));

    expect(result.action).toBe('RUN_REVIEW');
    expect(result.work_package_id).toBe('WP-001');
  });

  it('returns WAIT when QA PASS was completed before existing code-review (no rework needed)', async () => {
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('qa',          'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('code-review', 'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ]);
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
    const wp = makeWpDetail('WP-001', 'BLOCKED', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getQaAction(rootIndex, handle.store));

    // BLOCKED WP must not appear as new QA work
    expect(result.action).not.toBe('RUN_QA');
  });

  it('returns RUN_QA for a non-BLOCKED WP while skipping the BLOCKED one', async () => {
    const blocked = makeWpDetail('WP-001', 'BLOCKED', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ]);
    const ready = makeWpDetail('WP-002', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
    ]);
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
    const wp = makeWpDetail('WP-001', 'BLOCKED', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
    ]);
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
    const wp = makeWpDetail('WP-001', 'BLOCKED', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).not.toBe('WRITE_DOCS');
  });

  it('returns WRITE_DOCS for a non-BLOCKED WP that has a PASS code-review pipeline', async () => {
    const wp = makeWpDetail('WP-001', 'IN_PROGRESS', [
      makePipeline('implementation', 'PASS', '2026-01-01T08:00:00', '2026-01-01T09:00:00'),
      makePipeline('qa',             'PASS', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
      makePipeline('code-review',    'PASS', '2026-01-01T12:00:00', '2026-01-01T13:00:00'),
    ]);
    const rootIndex = await setupStore(handle, [wp]);
    const result = await parseResult(getDocumentationAction(rootIndex, handle.store));

    expect(result.action).toBe('WRITE_DOCS');
    expect(result.work_package_id).toBe('WP-001');
  });
});
