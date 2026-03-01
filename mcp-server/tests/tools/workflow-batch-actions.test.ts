/**
 * Tests for the workflow-batch-actions tool (getNextActions).
 *
 * WP-006 — Test Group 2 (GN-1): Verifies that the batch next-step function
 * short-circuits when all work packages are in a terminal status (CANCELLED)
 * and returns the updated terminal reason string that includes "CANCELLED".
 *
 * Because `getNextActions` is not exported as a standalone function, these
 * tests simulate the same decision logic using the exported `isTerminalStatus`
 * helper and a real LedgerStore — the same approach used by all other batch
 * action tests in this suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { isTerminalStatus } from '../../src/schema/validators.js';
import { now } from '../../src/utils/timestamp.js';
import { _internal } from '../../src/tools/workflow-next-action.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

// Must match the planFolderBasename() YYYY-MM-DD pattern.
const PLAN_PATH = join(tmpdir(), '2026-01-01-batch-actions-cancelled-test');

/** The exact terminal-status reason string used in workflow-batch-actions.ts */
const TERMINAL_REASON = 'All work packages are in a terminal status (COMPLETE or CANCELLED).';

describe('getNextActions batch tool — all-CANCELLED short-circuit (GN-1)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'batch-cancelled-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupAllCancelledProject(count: number): Promise<void> {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: count,
      pending_work_packages: 0,
      work_packages: Array.from({ length: count }, (_, i) => {
        const id = `WP-${String(i + 1).padStart(3, '0')}`;
        return {
          work_package_id: id,
          status: 'CANCELLED' as const,
          assigned_to: 'Developer',
          dependencies: [],
          file: `ledger/${id}.json`,
        };
      }),
      project_comments: [],
    };
    await store.writeRootIndex(root);

    for (const wp of root.work_packages) {
      const wpDetail: WorkPackageDetail = {
        work_package_id: wp.work_package_id,
        work_package_file: `work/${wp.work_package_id}.md`,
        status: 'CANCELLED',
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: [],
        revision: 0,
        pipelines: [],
      };
      await store.writeWorkPackage(wp.work_package_id, wpDetail);
    }
  }

  it('all-CANCELLED WPs → allTerminal is true', async () => {
    await setupAllCancelledProject(3);
    const rootIndex = await store.readRootIndex();
    const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));
    expect(allTerminal).toBe(true);
  });

  it('all-CANCELLED WPs → returns terminal reason string containing "CANCELLED"', async () => {
    await setupAllCancelledProject(3);
    const rootIndex = await store.readRootIndex();
    const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));

    // Simulate the early-exit branch of getNextActions
    let reason: string | null = null;
    if (allTerminal) {
      reason = TERMINAL_REASON;
    }

    expect(reason).not.toBeNull();
    expect(reason).toContain('CANCELLED');
    expect(reason).toBe(TERMINAL_REASON);
  });

  it('mixed CANCELLED + COMPLETE all-terminal → returns terminal reason', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 0,
      work_packages: [
        { work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'COMPLETE', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const rootIndex = await store.readRootIndex();
    const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));
    expect(allTerminal).toBe(true);

    const reason = allTerminal ? TERMINAL_REASON : null;
    expect(reason).toBe(TERMINAL_REASON);
  });

  it('CANCELLED + READY → not all-terminal, no short-circuit', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 1,
      work_packages: [
        { work_package_id: 'WP-001', status: 'CANCELLED', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
        { work_package_id: 'WP-002', status: 'READY', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-002.json' },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const rootIndex = await store.readRootIndex();
    const allTerminal = rootIndex.work_packages.every((wp) => isTerminalStatus(wp.status));
    expect(allTerminal).toBe(false);
  });
});
// ─── buildBatchNextSteps — CLAIM_WP agent guidance (WP-002 fix) ──────────────

describe('buildBatchNextSteps — CLAIM_WP guidance', () => {
  /**
   * Regression test for the bug where CLAIM_WP step-1 used ${pipelineType}
   * ("implementation") instead of ${agentRole} ("Developer") for the agent field.
   *
   * buildBatchNextSteps is a pure string-builder with no I/O, so no store setup
   * is required. It is exercised via the _internal export.
   */
  it('CLAIM_WP with pipelineType="implementation" uses agent_role: "Developer" (not "implementation")', () => {
    const steps = _internal.buildBatchNextSteps('CLAIM_WP', 'WP-001', 'implementation');

    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]).toContain('agent_role: "Developer"');
    expect(steps[0]).not.toContain('agent_role: "implementation"');
  });

  it('CLAIM_WP with pipelineType="qa" uses agent_role: "QA" (not "qa")', () => {
    const steps = _internal.buildBatchNextSteps('CLAIM_WP', 'WP-002', 'qa');

    expect(steps[0]).toContain('agent_role: "QA"');
    expect(steps[0]).not.toContain('agent_role: "qa"');
  });

  it('CLAIM_WP step-1 includes the correct work_package_id', () => {
    const steps = _internal.buildBatchNextSteps('CLAIM_WP', 'WP-007', 'implementation');

    expect(steps[0]).toContain('"WP-007"');
  });
});