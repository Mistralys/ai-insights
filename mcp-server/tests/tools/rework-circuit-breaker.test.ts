import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { getDeveloperAction } from '../../src/tools/workflow-next-action.js';
import { _internal } from '../../src/tools/pipeline.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-circuit-breaker-test');

/** Helper to parse the JSON from an action result */
function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

/** Build a minimal WP detail */
function makeWpDetail(
  id: string,
  status: string,
  pipelines: Pipeline[] = [],
  reworkCount?: number,
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines,
    ...(reworkCount !== undefined
      ? { rework_counts: { implementation: reworkCount } }
      : {}),
  };
}

describe('MAX_REWORK_COUNT constant', () => {
  it('is exported and equals 5', () => {
    expect(MAX_REWORK_COUNT).toBe(5);
  });
});

describe('Circuit breaker in start_pipeline (live _internal)', () => {
  let tempDir: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'circuit-breaker-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempDir);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempDir, { recursive: true, force: true });
  });

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
          file: 'work/WP-001.md',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
        },
      ],
      project_comments: [],
    };
  }

  it('allows pipeline start when rework_counts.implementation < MAX_REWORK_COUNT', async () => {
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [], MAX_REWORK_COUNT - 1),
    );

    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    // Should succeed — still under the limit
    expect((result as any).isError).toBeFalsy();
  });

  it('rejects pipeline start when rework_counts.implementation reaches MAX via increment', async () => {
    await store.writeRootIndex(makeRoot());

    // WP at MAX_REWORK_COUNT - 1 with a FAIL pipeline; increment pushes it to MAX
    const failPipeline: Pipeline = {
      type: 'implementation',
      status: 'FAIL',
      started_at: now(),
      completed_at: now(),
      summary: ['Failed'],
    };
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [failPipeline], MAX_REWORK_COUNT - 1),
    );

    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/Rework circuit breaker/);
  });

  it('rejects when rework_counts.implementation is already at MAX_REWORK_COUNT (no increment needed)', async () => {
    await store.writeRootIndex(makeRoot());

    // WP already at MAX — even with a PASS pipeline, circuit breaker fires
    const passPipeline: Pipeline = {
      type: 'implementation',
      status: 'PASS',
      started_at: now(),
      completed_at: now(),
      summary: ['Passed'],
    };
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [passPipeline], MAX_REWORK_COUNT),
    );

    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toMatch(/circuit breaker/i);
  });

  it('error message contains guidance to cancel or restructure', async () => {
    await store.writeRootIndex(makeRoot());
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [], MAX_REWORK_COUNT),
    );

    const result = await _internal.startPipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain('CANCELLED');
    expect(text).toContain('restructuring');
  });
});

describe('BLOCK_FOR_REWORK_LIMIT in getDeveloperAction', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'circuit-action-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('surfaces BLOCK_FOR_REWORK_LIMIT for WP at max rework count', async () => {
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
          file: 'work/WP-001.md',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [], MAX_REWORK_COUNT),
    );

    const result = await getDeveloperAction(root, store);
    const parsed = parseResult(result);

    expect(parsed.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(parsed.work_package_id).toBe('WP-001');
    expect(parsed.rework_count).toBe(MAX_REWORK_COUNT);
    expect(parsed.max_rework_count).toBe(MAX_REWORK_COUNT);
  });

  it('does not surface BLOCK_FOR_REWORK_LIMIT for BLOCKED WPs', async () => {
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
          file: 'work/WP-001.md',
          status: 'BLOCKED',
          assigned_to: 'Developer',
          dependencies: [],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'BLOCKED', [], MAX_REWORK_COUNT),
    );

    const result = await getDeveloperAction(root, store);
    const parsed = parseResult(result);

    // Should be WAIT (no actionable WPs), not BLOCK_FOR_REWORK_LIMIT
    expect(parsed.action).toBe('WAIT');
  });

  it('does not surface BLOCK_FOR_REWORK_LIMIT for CANCELLED WPs', async () => {
    const root: RootIndex = {
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
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'CANCELLED', [], MAX_REWORK_COUNT),
    );

    const result = await getDeveloperAction(root, store);
    const parsed = parseResult(result);

    expect(parsed.action).toBe('WAIT');
  });

  it('BLOCK_FOR_REWORK_LIMIT takes priority over IMPLEMENT', async () => {
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
          file: 'work/WP-001.md',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
        },
        {
          work_package_id: 'WP-002',
          file: 'work/WP-002.md',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'IN_PROGRESS', [], MAX_REWORK_COUNT),
    );
    await store.writeWorkPackage(
      'WP-002',
      makeWpDetail('WP-002', 'READY'),
    );

    const result = await getDeveloperAction(root, store);
    const parsed = parseResult(result);

    // BLOCK_FOR_REWORK_LIMIT should come before IMPLEMENT
    expect(parsed.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(parsed.work_package_id).toBe('WP-001');
  });

  it('regular rework_count below limit does not trigger block', async () => {
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
          file: 'work/WP-001.md',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(
      'WP-001',
      makeWpDetail('WP-001', 'READY', [], MAX_REWORK_COUNT - 1),
    );

    const result = await getDeveloperAction(root, store);
    const parsed = parseResult(result);

    // Should get CLAIM_WP (READY WP → claim before implement), not BLOCK_FOR_REWORK_LIMIT
    expect(parsed.action).toBe('CLAIM_WP');
  });
});
