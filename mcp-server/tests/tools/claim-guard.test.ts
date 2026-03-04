import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTempStore, cleanupTempStore, type TempStoreHandle } from '../helpers/create-temp-store.js';
import { now } from '../../src/utils/timestamp.js';
import {
  isValidStatusTransition,
  canStartWorkPackage,
} from '../../src/schema/validators.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-claim-guard-test');

/**
 * Replicates the claim_work_package tool handler logic (including the
 * assignment guard) against a real temp store, following the same pattern
 * as full-workflow.test.ts.
 *
 * The assignment guard was added to prevent agents from silently
 * re-assigning WPs outside their remit — the root cause of the
 * 2026-02-22 workflow failure.
 */

/**
 * Inline replica of the claim guard logic from work-package.ts.
 * Keeps tests independent of _internal exports while validating the
 * same invariants that the real tool handler enforces.
 */
function claimWorkPackageGuard(
  wp: WorkPackageDetail,
  agent: string,
  override?: boolean,
): string | null {
  if (wp.status !== 'READY') {
    return `Cannot claim work package ${wp.work_package_id}: current status is ${wp.status}. Only READY work packages can be claimed.`;
  }
  if (wp.assigned_to && wp.assigned_to !== agent && !override) {
    return (
      `Cannot claim work package ${wp.work_package_id}: it is assigned to "${wp.assigned_to}" but you are "${agent}".\n\n` +
      `If you need to re-assign this WP, pass override: true. ` +
      `Otherwise, only claim work packages assigned to your role.`
    );
  }
  return null;
}

describe('claim_work_package assignment guard', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);

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
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
        {
          work_package_id: 'WP-002',
          status: 'READY',
          assigned_to: 'Documentation',
          dependencies: [],
          file: 'ledger/WP-002.json',
        },
      ],
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);

    const wp1: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'READY',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Feature works', met: false }],
      revision: 0,
      pipelines: [],
    };
    await handle.store.writeWorkPackage('WP-001', wp1);

    const wp2: WorkPackageDetail = {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'READY',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Docs written', met: false }],
      revision: 0,
      pipelines: [],
    };
    await handle.store.writeWorkPackage('WP-002', wp2);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  // -- Pure guard logic tests --

  it('allows claiming a WP assigned to the same agent', () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'READY',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    };
    const error = claimWorkPackageGuard(wp, 'Developer');
    expect(error).toBeNull();
  });

  it('rejects claiming a WP assigned to a different agent', () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'READY',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    };
    const error = claimWorkPackageGuard(wp, 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain('assigned to "Documentation"');
    expect(error).toContain('you are "Developer"');
    expect(error).toContain('override: true');
  });

  it('allows cross-agent claim when override is true', () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-002',
      work_package_file: 'work/WP-002.md',
      status: 'READY',
      assigned_to: 'Documentation',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    };
    const error = claimWorkPackageGuard(wp, 'Developer', true);
    expect(error).toBeNull();
  });

  it('allows claiming a WP with empty assigned_to', () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'READY',
      assigned_to: '',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    };
    const error = claimWorkPackageGuard(wp, 'QA');
    expect(error).toBeNull();
  });

  it('rejects claiming a non-READY WP regardless of agent match', () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [],
    };
    const error = claimWorkPackageGuard(wp, 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain('current status is IN_PROGRESS');
  });

  // -- Integration tests using real store --

  it('same-agent claim succeeds through store', async () => {
    await handle.store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const guardError = claimWorkPackageGuard(wp, 'Developer');
      expect(guardError).toBeNull();

      expect(isValidStatusTransition(wp.status, 'IN_PROGRESS')).toBe(true);
      const depCheck = canStartWorkPackage(wp, root.work_packages);
      expect(depCheck.allowed).toBe(true);

      wp.status = 'IN_PROGRESS';
      wp.assigned_to = 'Developer';
      const summary = root.work_packages.find(s => s.work_package_id === 'WP-001')!;
      summary.status = 'IN_PROGRESS';
      summary.assigned_to = 'Developer';
      root.last_updated = now();

      return { wp, root };
    });

    const wp = await handle.store.readWorkPackage('WP-001');
    expect(wp.status).toBe('IN_PROGRESS');
    expect(wp.assigned_to).toBe('Developer');
  });

  it('cross-agent claim is blocked through store', async () => {
    const wp = await handle.store.readWorkPackage('WP-002');
    const guardError = claimWorkPackageGuard(wp, 'Developer');
    expect(guardError).not.toBeNull();
    expect(guardError).toContain('assigned to "Documentation"');

    // WP should remain unchanged
    const wpAfter = await handle.store.readWorkPackage('WP-002');
    expect(wpAfter.status).toBe('READY');
    expect(wpAfter.assigned_to).toBe('Documentation');
  });

  it('cross-agent claim with override succeeds through store', async () => {
    await handle.store.updateWorkPackageWithSync('WP-002', (wp, root) => {
      const guardError = claimWorkPackageGuard(wp, 'Developer', true);
      expect(guardError).toBeNull();

      wp.status = 'IN_PROGRESS';
      wp.assigned_to = 'Developer';
      const summary = root.work_packages.find(s => s.work_package_id === 'WP-002')!;
      summary.status = 'IN_PROGRESS';
      summary.assigned_to = 'Developer';
      root.last_updated = now();

      return { wp, root };
    });

    const wp = await handle.store.readWorkPackage('WP-002');
    expect(wp.status).toBe('IN_PROGRESS');
    expect(wp.assigned_to).toBe('Developer');
  });
});
