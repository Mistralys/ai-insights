import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { withLock } from '../../src/storage/file-lock.js';
import type { RootIndex, WorkPackageSummary } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-cascade-reblock-test');

describe('Cascade-block dependents on WP reopen', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cascade-reblock-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Inline replica of propagateDependencyReblock logic */
  async function simulateReblock(reopenedWpId: string): Promise<void> {
    await withLock(tempDir, async () => {
      const rootIndex = await store.readRootIndex();

      const candidates = rootIndex.work_packages.filter(
        (wp) =>
          wp.status !== 'COMPLETE' &&
          wp.status !== 'BLOCKED' &&
          wp.dependencies.includes(reopenedWpId)
      );

      if (candidates.length === 0) return;

      for (const candidate of candidates) {
        const wpDetail = await store.readWorkPackage(candidate.work_package_id);

        wpDetail.status = 'BLOCKED';
        wpDetail.blocked_by = {
          type: 'dependency',
          description: `Dependency ${reopenedWpId} was reopened`,
          blocking_work_package: reopenedWpId,
        };

        const summary = rootIndex.work_packages.find(
          (s) => s.work_package_id === candidate.work_package_id
        );
        if (summary) {
          summary.status = 'BLOCKED';
        }

        await store.writeWorkPackage(candidate.work_package_id, wpDetail);
      }

      rootIndex.pending_work_packages = rootIndex.work_packages.filter(
        (wp) => wp.status !== 'COMPLETE'
      ).length;
      rootIndex.last_updated = now();
      await store.writeRootIndex(rootIndex);
    });
  }

  function makeWpSummary(id: string, status: string, deps: string[] = []): WorkPackageSummary {
    return {
      work_package_id: id,
      status: status as any,
      assigned_to: 'Developer',
      dependencies: deps,
      file: `ledger/${id}.json`,
    };
  }

  function makeWpDetail(id: string, status: string, deps: string[] = []): WorkPackageDetail {
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

  async function setupProject(wpSummaries: WorkPackageSummary[], wpDetails: WorkPackageDetail[]) {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wpSummaries.length,
      pending_work_packages: wpSummaries.filter((wp) => wp.status !== 'COMPLETE').length,
      work_packages: wpSummaries,
      project_comments: [],
    };
    await store.writeRootIndex(root);
    for (const wp of wpDetails) {
      await store.writeWorkPackage(wp.work_package_id, wp);
    }
  }

  it('blocks READY dependent when upstream WP is reopened', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),  // reopened
        makeWpSummary('WP-002', 'READY', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'READY', ['WP-001']),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
    expect(wp2.blocked_by).toBeDefined();
    expect(wp2.blocked_by!.type).toBe('dependency');
    expect(wp2.blocked_by!.blocking_work_package).toBe('WP-001');
  });

  it('blocks IN_PROGRESS dependent when upstream WP is reopened', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'IN_PROGRESS', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'IN_PROGRESS', ['WP-001']),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
    expect(wp2.blocked_by!.blocking_work_package).toBe('WP-001');
  });

  it('does NOT block COMPLETE dependent', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'COMPLETE', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'COMPLETE', ['WP-001']),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('COMPLETE');
    expect(wp2.blocked_by).toBeUndefined();
  });

  it('does NOT block already-BLOCKED dependent', async () => {
    const wp2Detail = makeWpDetail('WP-002', 'BLOCKED', ['WP-001']);
    wp2Detail.blocked_by = { type: 'dependency', description: 'Already blocked' };

    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'BLOCKED', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        wp2Detail,
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');
    // Original blocker preserved, not overwritten
    expect(wp2.blocked_by!.description).toBe('Already blocked');
  });

  it('only blocks direct dependents (not transitive)', async () => {
    // WP-001 → WP-002 → WP-003
    // Reopening WP-001 should block WP-002 but NOT WP-003 (WP-003 depends on WP-002, not WP-001)
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'READY', ['WP-001']),
        makeWpSummary('WP-003', 'READY', ['WP-002']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'READY', ['WP-001']),
        makeWpDetail('WP-003', 'READY', ['WP-002']),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('BLOCKED');

    const wp3 = await store.readWorkPackage('WP-003');
    expect(wp3.status).toBe('READY'); // Not directly dependent on WP-001
  });

  it('updates root index pending count', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'READY', ['WP-001']),
        makeWpSummary('WP-003', 'COMPLETE', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'READY', ['WP-001']),
        makeWpDetail('WP-003', 'COMPLETE', ['WP-001']),
      ]
    );

    await simulateReblock('WP-001');

    const root = await store.readRootIndex();
    // WP-001 (IN_PROGRESS) and WP-002 (now BLOCKED) are pending. WP-003 (COMPLETE) is not.
    expect(root.pending_work_packages).toBe(2);

    // Verify root summary status was updated
    const wp2Summary = root.work_packages.find((wp) => wp.work_package_id === 'WP-002');
    expect(wp2Summary!.status).toBe('BLOCKED');
  });

  it('does nothing when no dependents exist', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'READY', []),  // no dependency on WP-001
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'READY', []),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    expect(wp2.status).toBe('READY');
  });

  it('blocks multiple READY/IN_PROGRESS dependents at once', async () => {
    await setupProject(
      [
        makeWpSummary('WP-001', 'IN_PROGRESS', []),
        makeWpSummary('WP-002', 'READY', ['WP-001']),
        makeWpSummary('WP-003', 'IN_PROGRESS', ['WP-001']),
      ],
      [
        makeWpDetail('WP-001', 'IN_PROGRESS', []),
        makeWpDetail('WP-002', 'READY', ['WP-001']),
        makeWpDetail('WP-003', 'IN_PROGRESS', ['WP-001']),
      ]
    );

    await simulateReblock('WP-001');

    const wp2 = await store.readWorkPackage('WP-002');
    const wp3 = await store.readWorkPackage('WP-003');
    expect(wp2.status).toBe('BLOCKED');
    expect(wp3.status).toBe('BLOCKED');
    expect(wp2.blocked_by!.blocking_work_package).toBe('WP-001');
    expect(wp3.blocked_by!.blocking_work_package).toBe('WP-001');
  });
});
