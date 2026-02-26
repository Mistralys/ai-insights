import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { getDeveloperAction } from '../../src/tools/workflow-next-action.js';
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
    revision: 1,
    pipelines,
    ...(reworkCount !== undefined ? { rework_count: reworkCount } : {}),
  };
}

describe('MAX_REWORK_COUNT constant', () => {
  it('is exported and equals 5', () => {
    expect(MAX_REWORK_COUNT).toBe(5);
  });
});

describe('Circuit breaker in start_pipeline (simulated)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'circuit-breaker-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Simulate the startPipeline logic including circuit breaker.
   * Mirrors the actual code in pipeline.ts.
   */
  async function simulateStartPipeline(
    wpId: string,
    pipelineType: string,
  ): Promise<void> {
    await store.updateWorkPackageWithSync(wpId, (wp, root) => {
      // Rework count increment
      const sameTypePipelines = wp.pipelines.filter((p) => p.type === pipelineType);
      const mostRecent = sameTypePipelines.at(-1);
      if (mostRecent?.status === 'FAIL') {
        wp.rework_count = (wp.rework_count ?? 0) + 1;
      }

      // Circuit breaker
      if ((wp.rework_count ?? 0) >= MAX_REWORK_COUNT) {
        throw new Error(
          `Rework circuit breaker: ${wpId} has reached the maximum rework count (${MAX_REWORK_COUNT}). ` +
          `Consider cancelling this work package (transition to CANCELLED) or restructuring the approach.`,
        );
      }

      wp.pipelines.push({
        type: pipelineType,
        status: 'IN_PROGRESS',
        started_at: now(),
        summary: [],
      });
      root.last_updated = now();
      return { wp, root };
    });
  }

  async function simulateCompletePipeline(
    wpId: string,
    pipelineType: string,
    status: 'PASS' | 'FAIL',
  ): Promise<void> {
    await store.updateWorkPackageWithSync(wpId, (wp, root) => {
      const pipeline = [...wp.pipelines]
        .reverse()
        .find((p) => p.type === pipelineType && p.status === 'IN_PROGRESS');
      if (!pipeline) throw new Error(`No IN_PROGRESS ${pipelineType} pipeline`);
      pipeline.status = status;
      pipeline.completed_at = now();
      pipeline.summary = [status === 'PASS' ? 'Completed' : 'Failed'];
      root.last_updated = now();
      return { wp, root };
    });
  }

  it('allows pipeline start when rework_count < MAX_REWORK_COUNT', async () => {
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
      makeWpDetail('WP-001', 'IN_PROGRESS', [], MAX_REWORK_COUNT - 1),
    );

    // Should not throw — still under the limit
    await expect(
      simulateStartPipeline('WP-001', 'implementation'),
    ).resolves.not.toThrow();
  });

  it('rejects pipeline start when rework_count reaches MAX_REWORK_COUNT via increment', async () => {
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

    // WP at MAX_REWORK_COUNT - 1 with a FAIL pipeline, so increment will push it to MAX
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

    await expect(
      simulateStartPipeline('WP-001', 'implementation'),
    ).rejects.toThrow(/Rework circuit breaker/);
  });

  it('rejects when rework_count is already at MAX_REWORK_COUNT (no increment needed)', async () => {
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

    // WP already at MAX_REWORK_COUNT — even with a PASS pipeline, it should be rejected
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

    await expect(
      simulateStartPipeline('WP-001', 'implementation'),
    ).rejects.toThrow(/circuit breaker/i);
  });

  it('error message contains guidance to cancel or restructure', async () => {
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

    try {
      await simulateStartPipeline('WP-001', 'implementation');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('CANCELLED');
      expect(err.message).toContain('restructuring');
    }
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

    // Should get IMPLEMENT, not BLOCK_FOR_REWORK_LIMIT
    expect(parsed.action).toBe('IMPLEMENT');
  });
});
