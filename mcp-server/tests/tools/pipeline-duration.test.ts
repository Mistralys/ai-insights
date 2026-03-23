/**
 * Unit tests for WP-009: duration_ms computation in completePipeline.
 *
 * Tests that duration_ms is correctly computed from started_at, absent when
 * started_at is missing, and absent (without error) when started_at is invalid.
 * Uses the same process.argv injection pattern as complete-pipeline-guards.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { _internal } from '../../src/tools/pipeline.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-pipeline-duration-test');

describe('pipeline duration_ms computation', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'pipeline-duration-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);

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
          file: 'work/WP-001.md',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  async function writeWpWithPipeline(startedAt?: string): Promise<void> {
    const pipeline: WorkPackageDetail['pipelines'][number] = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      summary: [],
      ...(startedAt !== undefined ? { started_at: startedAt } : {}),
    };
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [pipeline],
    };
    await store.writeWorkPackage('WP-001', wp);
  }

  it('duration_ms is computed correctly when started_at is present', async () => {
    const startedAt = new Date(Date.now() - 5000).toISOString();
    await writeWpWithPipeline(startedAt);

    await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });

    const wp = await store.readWorkPackage('WP-001');
    const pipeline = wp.pipelines.find((p) => p.type === 'implementation' && p.status === 'PASS');
    expect(pipeline?.duration_ms).toBeDefined();
    // started_at is ~5s ago; allow ±1s tolerance
    expect(pipeline!.duration_ms!).toBeGreaterThanOrEqual(4000);
    expect(pipeline!.duration_ms!).toBeLessThanOrEqual(6000);
  });

  it('duration_ms is absent when started_at is missing', async () => {
    await writeWpWithPipeline(/* no started_at */);

    await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });

    const wp = await store.readWorkPackage('WP-001');
    const pipeline = wp.pipelines.find((p) => p.type === 'implementation' && p.status === 'PASS');
    expect(pipeline?.duration_ms).toBeUndefined();
  });

  it('duration_ms is absent and no error is thrown for invalid started_at', async () => {
    // Bypass Zod validation by using the store directly with a known-invalid date string
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        // Cast to bypass type-level ISO string constraint — the storage layer
        // accepts any string and the computation guard handles non-parseable values.
        { type: 'implementation', status: 'IN_PROGRESS', started_at: 'not-a-valid-date' as any, summary: [] },
      ],
    };
    await store.writeWorkPackage('WP-001', wp);

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();
    const completed = await store.readWorkPackage('WP-001');
    const pipeline = completed.pipelines.find(
      (p) => p.type === 'implementation' && p.status === 'PASS'
    );
    expect(pipeline?.duration_ms).toBeUndefined();
  });
});
