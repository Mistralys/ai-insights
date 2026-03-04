/**
 * Integration tests for WP-003: completePipeline guards.
 *
 * Tests the WP status guard, agent-role-match guard, and PM Override
 * path for completePipeline. Uses the same process.argv injection
 * pattern as start-pipeline-guards.test.ts.
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

const PLAN_PATH = join(tmpdir(), '2026-01-01-complete-pipeline-guard-test');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRootIndex(wpStatus: string = 'IN_PROGRESS'): RootIndex {
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
        status: wpStatus as any,
        assigned_to: 'Developer',
        dependencies: [],
        file: 'work/WP-001.md',
      },
    ],
    project_comments: [],
  };
}

function makeWpDetail(
  status: string = 'IN_PROGRESS',
  extra: Partial<WorkPackageDetail> = {}
): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines: [
      { type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] },
    ],
    ...extra,
  };
}

function resultText(result: any): string {
  return result.content[0].text as string;
}

describe('completePipeline integration tests (WP-003 guards)', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'complete-pipeline-guards-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ─── WP status guard ─────────────────────────────────────────────────────

  it('WP not IN_PROGRESS rejects with an actionable message', async () => {
    await store.writeRootIndex(makeRootIndex('BLOCKED'));
    await store.writeWorkPackage('WP-001', makeWpDetail('BLOCKED'));

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('IN_PROGRESS');
    expect(resultText(result)).toContain('WP-001');
  });

  it('WP in READY status also rejects', async () => {
    await store.writeRootIndex(makeRootIndex('READY'));
    await store.writeWorkPackage('WP-001', {
      ...makeWpDetail('READY'),
      pipelines: [{ type: 'implementation', status: 'IN_PROGRESS', started_at: now(), summary: [] }],
    });

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('READY');
  });

  // ─── Agent role match guard ───────────────────────────────────────────────

  it('Agent role mismatch throws (Developer completing a qa pipeline)', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', {
      pipelines: [
        { type: 'implementation', status: 'PASS', completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    }));

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'Developer',
    });
    expect((result as any).isError).toBe(true);
    expect(resultText(result)).toContain('must be completed by QA');
    expect(resultText(result)).toContain("agent_role: 'Developer'");
  });

  it('correct agent role succeeds (QA completing a qa pipeline)', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', {
      assigned_to: 'QA',
      pipelines: [
        { type: 'implementation', status: 'PASS', completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    }));

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['done'],
      agent_role: 'QA',
    });
    expect((result as any).isError).toBeUndefined();
  });

  // ─── PM Override ─────────────────────────────────────────────────────────

  it('PM (Project Manager) is allowed to complete any pipeline type', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail());

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'implementation',
      status: 'PASS',
      summary: ['PM completing this'],
      agent_role: 'Project Manager',
    });
    expect((result as any).isError).toBeUndefined();
  });

  it('PM completing a qa pipeline is allowed', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', {
      assigned_to: 'QA',
      pipelines: [
        { type: 'implementation', status: 'PASS', completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    }));

    const result = await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['PM override'],
      agent_role: 'Project Manager',
    });
    expect((result as any).isError).toBeUndefined();
  });

  it('from_agent in handoff note reflects PM identity when PM Override is active', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', {
      assigned_to: 'QA',
      pipelines: [
        { type: 'implementation', status: 'PASS', completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    }));

    await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['PM override'],
      agent_role: 'Project Manager',
      handoff_notes: ['Completed by PM override'],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes).toBeDefined();
    expect(wp.handoff_notes![0].from_agent).toBe('Project Manager (PM Override)');
  });

  it('from_agent in handoff note is normal agent name when NOT PM Override', async () => {
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', makeWpDetail('IN_PROGRESS', {
      assigned_to: 'QA',
      pipelines: [
        { type: 'implementation', status: 'PASS', completed_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ],
    }));

    await _internal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: 'qa',
      status: 'PASS',
      summary: ['QA done'],
      agent_role: 'QA',
      handoff_notes: ['All checks passed'],
    });

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes![0].from_agent).toBe('QA');
  });
});
