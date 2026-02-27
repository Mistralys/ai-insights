import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { withLock } from '../../src/storage/file-lock.js';
import { isValidStatusTransition, canStartWorkPackage } from '../../src/schema/validators.js';
import { computeHealedStatus } from '../../src/tools/project-lifecycle.js';
import type { RootIndex, WorkPackageSummary } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-cancelled-status-test');

/** Build a minimal WP detail */
function makeWpDetail(
  id: string,
  status: string,
  deps: string[] = [],
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: deps,
    acceptance_criteria: [],
    revision: 1,
    pipelines: [],
  };
}

/** Build a minimal root index with given WP summaries */
function makeRootIndex(
  summaries: Array<{ id: string; status: string; deps?: string[] }>,
): RootIndex {
  const wps: WorkPackageSummary[] = summaries.map((s) => ({
    work_package_id: s.id,
    file: `work/${s.id}.md`,
    status: s.status as any,
    assigned_to: 'Developer',
    dependencies: s.deps ?? [],
  }));
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: wps.length,
    pending_work_packages: wps.filter(
      (wp) => wp.status !== 'COMPLETE' && wp.status !== 'CANCELLED',
    ).length,
    work_packages: wps,
    project_comments: [],
  };
}

describe('CANCELLED status transitions', () => {
  it('READY → CANCELLED is valid', () => {
    expect(isValidStatusTransition('READY', 'CANCELLED')).toBe(true);
  });

  it('IN_PROGRESS → CANCELLED is valid', () => {
    expect(isValidStatusTransition('IN_PROGRESS', 'CANCELLED')).toBe(true);
  });

  it('BLOCKED → CANCELLED is valid', () => {
    expect(isValidStatusTransition('BLOCKED', 'CANCELLED')).toBe(true);
  });

  it('CANCELLED is terminal (no outward transitions)', () => {
    expect(isValidStatusTransition('CANCELLED', 'READY')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'IN_PROGRESS')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'BLOCKED')).toBe(false);
    expect(isValidStatusTransition('CANCELLED', 'COMPLETE')).toBe(false);
  });

  it('COMPLETE → CANCELLED is not valid', () => {
    expect(isValidStatusTransition('COMPLETE', 'CANCELLED')).toBe(false);
  });
});

describe('CANCELLED dependency satisfaction', () => {
  it('CANCELLED WPs satisfy dependencies (like COMPLETE)', () => {
    const rootIndex = makeRootIndex([
      { id: 'WP-001', status: 'CANCELLED' },
      { id: 'WP-002', status: 'READY', deps: ['WP-001'] },
    ]);

    const wp002 = rootIndex.work_packages.find((w) => w.work_package_id === 'WP-002')!;
    const result = canStartWorkPackage(wp002, rootIndex.work_packages);
    expect(result.allowed).toBe(true);
  });

  it('non-COMPLETE/CANCELLED deps block starting', () => {
    const rootIndex = makeRootIndex([
      { id: 'WP-001', status: 'IN_PROGRESS' },
      { id: 'WP-002', status: 'READY', deps: ['WP-001'] },
    ]);

    const wp002 = rootIndex.work_packages.find((w) => w.work_package_id === 'WP-002')!;
    const result = canStartWorkPackage(wp002, rootIndex.work_packages);
    expect(result.allowed).toBe(false);
  });
});

describe('CANCELLED WPs in pending_work_packages counter', () => {
  it('CANCELLED WPs are not counted as pending', () => {
    const rootIndex = makeRootIndex([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'CANCELLED' },
      { id: 'WP-003', status: 'IN_PROGRESS' },
    ]);

    // Manually compute pending like the code does
    const pending = rootIndex.work_packages.filter(
      (wp) => wp.status !== 'COMPLETE' && wp.status !== 'CANCELLED',
    ).length;
    expect(pending).toBe(1); // Only WP-003
  });
});

describe('computeHealedStatus excludes CANCELLED from pending', () => {
  it('treats CANCELLED like COMPLETE for pending count', () => {
    const rootIndex = makeRootIndex([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'CANCELLED' },
      { id: 'WP-003', status: 'IN_PROGRESS' },
    ]);

    const healed = computeHealedStatus(rootIndex);
    expect(healed.pendingWps).toBe(1);
  });

  it('all COMPLETE + CANCELLED yields zero pending', () => {
    const rootIndex = makeRootIndex([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'CANCELLED' },
    ]);

    const healed = computeHealedStatus(rootIndex);
    expect(healed.pendingWps).toBe(0);
  });
});

describe('CANCELLED triggers dependency unblock (integration test pattern)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cancelled-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('cancelling a WP unblocks dependents (simulated propagateDependencyUnblock)', async () => {
    // Setup: WP-001 is IN_PROGRESS, WP-002 depends on it and is BLOCKED
    const root: RootIndex = makeRootIndex([
      { id: 'WP-001', status: 'IN_PROGRESS' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'IN_PROGRESS'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'BLOCKED', ['WP-001']),
      blocked_by: {
        type: 'dependency',
        description: 'Dependency WP-001 not complete',
        blocking_work_package: 'WP-001',
      },
    });

    // Simulate: WP-001 transitions to CANCELLED, which triggers unblock propagation
    await withLock(tempDir, async () => {
      const rootIndex = await store.readRootIndex();

      // Mark WP-001 as CANCELLED
      const wp001Summary = rootIndex.work_packages.find((w) => w.work_package_id === 'WP-001')!;
      wp001Summary.status = 'CANCELLED';

      // Simulate propagateDependencyUnblock for CANCELLED
      const blockedDeps = rootIndex.work_packages.filter(
        (wp) =>
          wp.status === 'BLOCKED' &&
          wp.dependencies.includes('WP-001'),
      );

      for (const dep of blockedDeps) {
        const allDepsMet = dep.dependencies.every((depId) => {
          const depWp = rootIndex.work_packages.find((w) => w.work_package_id === depId);
          return depWp?.status === 'COMPLETE' || depWp?.status === 'CANCELLED';
        });

        if (allDepsMet) {
          dep.status = 'READY';
          const wpDetail = await store.readWorkPackage(dep.work_package_id);
          wpDetail.status = 'READY';
          delete (wpDetail as any).blocked_by;
          await store.writeWorkPackage(dep.work_package_id, wpDetail);
        }
      }

      await store.writeRootIndex(rootIndex);
    });

    // Verify: WP-002 is now READY
    const updatedRoot = await store.readRootIndex();
    const wp002 = updatedRoot.work_packages.find((w) => w.work_package_id === 'WP-002')!;
    expect(wp002.status).toBe('READY');
  });
});
