import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';
import { isTerminalStatus } from '../../src/schema/validators.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-synthesis-terminal-test');

/** Helper to parse the JSON from a tool result */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

describe('synthesis_generated flag on root index schema', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'synthesis-flag-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('root index without synthesis_generated is valid (backward compatible)', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    const read = await store.readRootIndex();
    expect(read.synthesis_generated).toBeUndefined();
  });

  it('root index with synthesis_generated=true is valid', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'COMPLETE',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
      synthesis_generated: true,
    };
    await store.writeRootIndex(root);
    const read = await store.readRootIndex();
    expect(read.synthesis_generated).toBe(true);
  });
});

describe('GENERATE_SYNTHESIS guard logic', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'synthesis-guard-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Simulate the guard logic inline (mirrors workflow-next-action.ts) */
  function getSynthesisAction(rootIndex: RootIndex): { action: string; reason: string } {
    const allComplete = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));
    if (allComplete) {
      if (rootIndex.synthesis_generated) {
        return { action: 'WAIT', reason: 'Synthesis report has already been generated. Nothing to do.' };
      }
      return { action: 'GENERATE_SYNTHESIS', reason: 'All work packages are COMPLETE. Generate synthesis report.' };
    }
    return { action: 'WAIT', reason: 'Not all work packages are COMPLETE. Wait for all WPs to finish.' };
  }

  it('returns GENERATE_SYNTHESIS when all WPs complete and flag absent', () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    const result = getSynthesisAction(root);
    expect(result.action).toBe('GENERATE_SYNTHESIS');
  });

  it('returns GENERATE_SYNTHESIS when flag is explicitly false', () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
      synthesis_generated: false,
    };
    const result = getSynthesisAction(root);
    expect(result.action).toBe('GENERATE_SYNTHESIS');
  });

  it('returns WAIT when synthesis_generated is true', () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'COMPLETE',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
      synthesis_generated: true,
    };
    const result = getSynthesisAction(root);
    expect(result.action).toBe('WAIT');
    expect(result.reason).toContain('already been generated');
  });

  it('returns WAIT when not all WPs are complete (regardless of flag)', () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
    const result = getSynthesisAction(root);
    expect(result.action).toBe('WAIT');
    expect(result.reason).toContain('Not all');
  });
});

describe('Self-healing with synthesis_generated flag', () => {
  /** Inline replica of updated self-healing logic */
  function healStatus(
    currentStatus: string,
    pendingWps: number,
    totalWps: number,
    synthesisGenerated?: boolean,
  ): string {
    if (currentStatus === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
      return synthesisGenerated ? 'COMPLETE' : 'IN_PROGRESS';
    }
    if (currentStatus === 'COMPLETE' && pendingWps > 0) {
      return 'IN_PROGRESS';
    }
    return currentStatus;
  }

  it('does NOT heal to COMPLETE when all WPs done but synthesis not generated', () => {
    expect(healStatus('IN_PROGRESS', 0, 2)).toBe('IN_PROGRESS');
    expect(healStatus('IN_PROGRESS', 0, 2, false)).toBe('IN_PROGRESS');
    expect(healStatus('IN_PROGRESS', 0, 2, undefined)).toBe('IN_PROGRESS');
  });

  it('heals to COMPLETE when all WPs done AND synthesis_generated is true', () => {
    expect(healStatus('IN_PROGRESS', 0, 2, true)).toBe('COMPLETE');
  });

  it('still heals COMPLETE → IN_PROGRESS when pending WPs exist', () => {
    expect(healStatus('COMPLETE', 1, 2)).toBe('IN_PROGRESS');
    expect(healStatus('COMPLETE', 1, 2, true)).toBe('IN_PROGRESS');
  });
});

describe('ledger_complete_synthesis tool', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'synthesis-tool-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Simulate complete_synthesis logic inline (mirrors project-lifecycle.ts) */
  async function simulateCompleteSynthesis(): Promise<{ synthesis_generated: boolean; project_status: string }> {
    const rootIndex = await store.readRootIndex();
    rootIndex.synthesis_generated = true;
    rootIndex.last_updated = now();

    const pendingWps = rootIndex.work_packages.filter((wp) => !isTerminalStatus(wp.status)).length;
    if (pendingWps === 0 && rootIndex.work_packages.length > 0) {
      rootIndex.status = 'COMPLETE';
    }

    await store.writeRootIndex(rootIndex);
    return { synthesis_generated: true, project_status: rootIndex.status };
  }

  it('sets synthesis_generated to true and project to COMPLETE when all WPs done', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const result = await simulateCompleteSynthesis();
    expect(result.synthesis_generated).toBe(true);
    expect(result.project_status).toBe('COMPLETE');

    // Verify persisted
    const read = await store.readRootIndex();
    expect(read.synthesis_generated).toBe(true);
    expect(read.status).toBe('COMPLETE');
  });

  it('sets synthesis_generated to true but keeps IN_PROGRESS when pending WPs exist', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'IN_PROGRESS', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const result = await simulateCompleteSynthesis();
    expect(result.synthesis_generated).toBe(true);
    expect(result.project_status).toBe('IN_PROGRESS');
  });

  it('is idempotent — calling twice does not break state', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    await simulateCompleteSynthesis();
    const result2 = await simulateCompleteSynthesis();
    expect(result2.synthesis_generated).toBe(true);
    expect(result2.project_status).toBe('COMPLETE');
  });

  it('transitions project to COMPLETE when WPs are a mix of COMPLETE and CANCELLED', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 3,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'CANCELLED', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
        { work_package_id: 'WP-003', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-003.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const result = await simulateCompleteSynthesis();
    expect(result.synthesis_generated).toBe(true);
    expect(result.project_status).toBe('COMPLETE');
  });
});
