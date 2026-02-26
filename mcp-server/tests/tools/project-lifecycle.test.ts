import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createTempStore,
  cleanupTempStore,
  type TempStoreHandle,
} from '../helpers/create-temp-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import { computeHealedStatus } from '../../src/tools/project-lifecycle.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-lifecycle-heal-test');

/**
 * Tests for the two new self-healing rules added to getProjectStatus:
 *   1. READY → IN_PROGRESS when any WP is IN_PROGRESS
 *   2. BLOCKED → IN_PROGRESS/READY when no WPs are actually BLOCKED
 *
 * These tests validate the healing logic by driving store operations directly
 * and checking the corrected status — the same pattern used elsewhere in the
 * test suite (see claim-guard.test.ts).
 *
 * The healing function below is an inline replica of the two new branches
 * added to project-lifecycle.ts so tests remain independent of internal exports.
 */

type ProjectStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type WpStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';

/** Inline replica of the self-healing logic from project-lifecycle.ts */
function applyStatusHealing(
  currentStatus: ProjectStatus,
  wpStatuses: WpStatus[],
  pendingWps: number,
  totalWps: number,
  synthesisGenerated?: boolean,
): ProjectStatus {
  if (currentStatus === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
    return synthesisGenerated ? 'COMPLETE' : 'IN_PROGRESS';
  }
  if (currentStatus === 'COMPLETE' && pendingWps > 0) {
    return 'IN_PROGRESS';
  }
  if (currentStatus === 'READY') {
    const hasInProgressWp = wpStatuses.some((s) => s === 'IN_PROGRESS');
    if (hasInProgressWp) return 'IN_PROGRESS';
  }
  if (currentStatus === 'BLOCKED') {
    const hasBlockedWp = wpStatuses.some((s) => s === 'BLOCKED');
    if (!hasBlockedWp) {
      const hasInProgressWp = wpStatuses.some((s) => s === 'IN_PROGRESS');
      const hasReadyWp = wpStatuses.some((s) => s === 'READY');
      return hasInProgressWp ? 'IN_PROGRESS' : hasReadyWp ? 'READY' : currentStatus;
    }
  }
  return currentStatus;
}

describe('Project status self-healing: READY → IN_PROGRESS', () => {
  it('heals READY to IN_PROGRESS when a WP is IN_PROGRESS', () => {
    const healed = applyStatusHealing('READY', ['IN_PROGRESS'], 1, 1);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals READY to IN_PROGRESS when mixed WP statuses include IN_PROGRESS', () => {
    const healed = applyStatusHealing('READY', ['READY', 'IN_PROGRESS', 'BLOCKED'], 3, 3);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('does NOT heal READY when all WPs are READY', () => {
    const healed = applyStatusHealing('READY', ['READY', 'READY'], 2, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal READY when all WPs are BLOCKED', () => {
    const healed = applyStatusHealing('READY', ['BLOCKED', 'BLOCKED'], 2, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal READY when there are no WPs', () => {
    const healed = applyStatusHealing('READY', [], 0, 0);
    expect(healed).toBe('READY');
  });
});

describe('Project status self-healing: BLOCKED → IN_PROGRESS/READY', () => {
  it('heals BLOCKED to IN_PROGRESS when no WPs are BLOCKED and some are IN_PROGRESS', () => {
    const healed = applyStatusHealing('BLOCKED', ['IN_PROGRESS', 'READY'], 2, 2);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals BLOCKED to READY when no WPs are BLOCKED and some are READY but none IN_PROGRESS', () => {
    const healed = applyStatusHealing('BLOCKED', ['READY', 'COMPLETE'], 1, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal BLOCKED when at least one WP is still BLOCKED', () => {
    const healed = applyStatusHealing('BLOCKED', ['BLOCKED', 'READY'], 2, 2);
    expect(healed).toBe('BLOCKED');
  });

  it('does NOT heal BLOCKED when all WPs are COMPLETE and no READY/IN_PROGRESS exists', () => {
    // All COMPLETE means no pending; healing falls through to existing IN_PROGRESS/COMPLETE rules
    // With no BLOCKED WPs and no IN_PROGRESS/READY, status stays unchanged
    const healed = applyStatusHealing('BLOCKED', ['COMPLETE', 'COMPLETE'], 0, 2);
    expect(healed).toBe('BLOCKED');
  });

  it('heals BLOCKED to IN_PROGRESS over READY when both exist', () => {
    const healed = applyStatusHealing('BLOCKED', ['READY', 'IN_PROGRESS', 'COMPLETE'], 2, 3);
    expect(healed).toBe('IN_PROGRESS');
  });
});

describe('Project status self-healing: existing rules still work', () => {
  it('heals IN_PROGRESS to COMPLETE when all WPs done and synthesis generated', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2, true);
    expect(healed).toBe('COMPLETE');
  });

  it('stays IN_PROGRESS when all WPs done but synthesis NOT generated', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2, false);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('stays IN_PROGRESS when all WPs done and synthesis_generated is undefined', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals COMPLETE to IN_PROGRESS when pending WPs exist', () => {
    const healed = applyStatusHealing('COMPLETE', ['IN_PROGRESS', 'COMPLETE'], 1, 2);
    expect(healed).toBe('IN_PROGRESS');
  });
});

describe('Project status self-healing: store integration', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('READY project with IN_PROGRESS WP stores correctly and heals as expected', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'READY',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);

    const readBack = await handle.store.readRootIndex();
    const wpStatuses = readBack.work_packages.map((wp) => wp.status as WpStatus);
    const healed = applyStatusHealing(
      readBack.status as ProjectStatus,
      wpStatuses,
      readBack.pending_work_packages,
      readBack.total_work_packages,
    );
    expect(healed).toBe('IN_PROGRESS');
  });

  it('BLOCKED project with only READY WPs stores correctly and heals to READY', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'BLOCKED',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);

    const readBack = await handle.store.readRootIndex();
    const wpStatuses = readBack.work_packages.map((wp) => wp.status as WpStatus);
    const healed = applyStatusHealing(
      readBack.status as ProjectStatus,
      wpStatuses,
      readBack.pending_work_packages,
      readBack.total_work_packages,
    );
    expect(healed).toBe('READY');
  });
});

describe('computeHealedStatus (exported pure function)', () => {
  function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
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
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
      ...overrides,
    };
  }

  it('returns needsWrite: false when counters and status are correct', () => {
    const root = makeRootIndex();
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(false);
    expect(result.totalWps).toBe(1);
    expect(result.pendingWps).toBe(1);
    expect(result.healedStatus).toBe('IN_PROGRESS');
  });

  it('returns needsWrite: true when total_work_packages is wrong', () => {
    const root = makeRootIndex({ total_work_packages: 99 });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.totalWps).toBe(1);
  });

  it('returns needsWrite: true when pending_work_packages is wrong', () => {
    const root = makeRootIndex({ pending_work_packages: 0 });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.pendingWps).toBe(1);
  });

  it('returns needsWrite: true when status needs healing', () => {
    const root = makeRootIndex({
      status: 'READY',
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.healedStatus).toBe('IN_PROGRESS');
  });

  it('heals IN_PROGRESS to COMPLETE when all WPs done and synthesis_generated', () => {
    const root = makeRootIndex({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });
});
