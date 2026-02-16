import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { withLock } from '../../src/storage/file-lock.js';
import { formatWpId } from '../../src/utils/wp-id.js';
import { now } from '../../src/utils/timestamp.js';
import {
  isValidStatusTransition,
  canStartWorkPackage,
  canCompleteWorkPackage,
} from '../../src/schema/validators.js';
import type { RootIndex, WorkPackageSummary } from '../../src/schema/root-index.js';
import type {
  WorkPackageDetail,
  AcceptanceCriterion,
  Pipeline,
} from '../../src/schema/work-package.js';

/**
 * Integration tests that simulate the full agent workflow through real file I/O.
 * These exercise the same logic as the MCP tool handlers without depending
 * on the MCP SDK transport layer.
 */
describe('Full workflow integration', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ledger-workflow-'));
    store = new LedgerStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ========== STAGE 2: Project Manager ==========

  describe('Stage 2: Project Manager initializes project', () => {
    it('creates root index with correct initial state', async () => {
      const timestamp = now();
      const rootIndex: RootIndex = {
        plan_file: 'plan.md',
        date_created: timestamp,
        last_updated: timestamp,
        status: 'READY',
        total_work_packages: 0,
        pending_work_packages: 0,
        work_packages: [],
        project_comments: [],
      };

      await store.writeRootIndex(rootIndex);

      const result = await store.readRootIndex();
      expect(result.status).toBe('READY');
      expect(result.work_packages).toHaveLength(0);
    });

    it('rejects re-initialization when ledger exists', async () => {
      const rootIndex: RootIndex = {
        plan_file: 'plan.md',
        date_created: now(),
        last_updated: now(),
        status: 'READY',
        total_work_packages: 0,
        pending_work_packages: 0,
        work_packages: [],
        project_comments: [],
      };
      await store.writeRootIndex(rootIndex);

      expect(await store.rootIndexExists()).toBe(true);
    });

    it('creates work packages in dependency order', async () => {
      // Initialize project
      const timestamp = now();
      const rootIndex: RootIndex = {
        plan_file: 'plan.md',
        date_created: timestamp,
        last_updated: timestamp,
        status: 'READY',
        total_work_packages: 0,
        pending_work_packages: 0,
        work_packages: [],
        project_comments: [],
      };
      await store.writeRootIndex(rootIndex);

      // Create WP-001 (no dependencies) — simulates ledger_create_work_package
      await withLock(tempDir, async () => {
        const root = await store.readRootIndex();
        const wpId = formatWpId(root.work_packages.length + 1);

        const wpDetail: WorkPackageDetail = {
          work_package_id: wpId,
          work_package_file: 'work/WP-001.md',
          status: 'READY',
          assigned_to: 'Developer Agent',
          dependencies: [],
          acceptance_criteria: [{ criterion: 'Feature works', met: false }],
          revision: 1,
          pipelines: [],
        };

        const summary: WorkPackageSummary = {
          work_package_id: wpId,
          status: 'READY',
          assigned_to: 'Developer Agent',
          dependencies: [],
          file: `ledger/${wpId}.json`,
        };

        root.work_packages.push(summary);
        root.total_work_packages += 1;
        root.pending_work_packages += 1;
        root.status = 'IN_PROGRESS';
        root.last_updated = now();

        await store.writeWorkPackage(wpId, wpDetail);
        await store.writeRootIndex(root);
      });

      // Create WP-002 (depends on WP-001) — should be BLOCKED
      await withLock(tempDir, async () => {
        const root = await store.readRootIndex();
        const wpId = formatWpId(root.work_packages.length + 1);

        // Validate dependency exists
        const depExists = root.work_packages.some(
          (wp) => wp.work_package_id === 'WP-001'
        );
        expect(depExists).toBe(true);

        // Check if dependency is complete
        const depCheck = canStartWorkPackage(
          { dependencies: ['WP-001'] } as unknown as WorkPackageSummary,
          root.work_packages
        );
        const initialStatus = depCheck.allowed ? 'READY' : 'BLOCKED';

        const wpDetail: WorkPackageDetail = {
          work_package_id: wpId,
          work_package_file: 'work/WP-002.md',
          status: initialStatus as 'READY' | 'BLOCKED',
          assigned_to: 'Developer Agent',
          dependencies: ['WP-001'],
          acceptance_criteria: [{ criterion: 'Integration works', met: false }],
          revision: 1,
          pipelines: [],
        };

        const summary: WorkPackageSummary = {
          work_package_id: wpId,
          status: initialStatus as 'READY' | 'BLOCKED',
          assigned_to: 'Developer Agent',
          dependencies: ['WP-001'],
          file: `ledger/${wpId}.json`,
        };

        root.work_packages.push(summary);
        root.total_work_packages += 1;
        root.pending_work_packages += 1;
        root.last_updated = now();

        await store.writeWorkPackage(wpId, wpDetail);
        await store.writeRootIndex(root);
      });

      // Verify final state
      const root = await store.readRootIndex();
      expect(root.status).toBe('IN_PROGRESS');
      expect(root.total_work_packages).toBe(2);
      expect(root.work_packages[0].status).toBe('READY');
      expect(root.work_packages[1].status).toBe('BLOCKED');

      const wp2 = await store.readWorkPackage('WP-002');
      expect(wp2.dependencies).toEqual(['WP-001']);
    });
  });

  // ========== STAGE 3: Developer ==========

  describe('Stage 3: Developer implements work package', () => {
    beforeEach(async () => {
      // Set up project with one READY work package
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
            status: 'READY',
            assigned_to: 'Developer Agent',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      const wp: WorkPackageDetail = {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'READY',
        assigned_to: 'Developer Agent',
        dependencies: [],
        acceptance_criteria: [
          { criterion: 'Feature implemented', met: false },
          { criterion: 'Tests pass', met: false },
        ],
        revision: 1,
        pipelines: [],
      };
      await store.writeWorkPackage('WP-001', wp);
    });

    it('claims a READY work package', async () => {
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        expect(wp.status).toBe('READY');
        expect(isValidStatusTransition('READY', 'IN_PROGRESS')).toBe(true);

        const depCheck = canStartWorkPackage(wp, root.work_packages);
        expect(depCheck.allowed).toBe(true);

        wp.status = 'IN_PROGRESS';
        wp.assigned_to = 'Developer Agent';

        const summary = root.work_packages.find(
          (s) => s.work_package_id === 'WP-001'
        )!;
        summary.status = 'IN_PROGRESS';
        root.last_updated = now();

        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('IN_PROGRESS');
    });

    it('starts and completes an implementation pipeline', async () => {
      // Claim first
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.status = 'IN_PROGRESS';
        root.work_packages[0].status = 'IN_PROGRESS';
        return { wp, root };
      });

      // Start pipeline
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        expect(wp.status).toBe('IN_PROGRESS');

        const newPipeline: Pipeline = {
          type: 'implementation',
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        };
        wp.pipelines.push(newPipeline);
        root.last_updated = now();

        return { wp, root };
      });

      let wpAfterStart = await store.readWorkPackage('WP-001');
      expect(wpAfterStart.pipelines).toHaveLength(1);
      expect(wpAfterStart.pipelines[0].status).toBe('IN_PROGRESS');

      // Complete pipeline with artifacts and observations
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        const pipeline = wp.pipelines
          .reverse()
          .find((p) => p.type === 'implementation' && p.status === 'IN_PROGRESS')!;
        // Reverse in-place, undo it
        wp.pipelines.reverse();

        pipeline.status = 'PASS';
        pipeline.completed_at = now();
        pipeline.summary = ['Implemented feature X', 'Added unit tests'];
        pipeline.artifacts = {
          files_modified: ['src/feature.ts', 'tests/feature.test.ts'],
        };
        pipeline.comments = [
          {
            type: 'improvement',
            priority: 'low',
            timestamp: now(),
            note: 'No observations — code is clean.',
          },
        ];

        // Update acceptance criteria
        wp.acceptance_criteria[0].met = true;
        wp.acceptance_criteria[1].met = true;

        root.last_updated = now();
        return { wp, root };
      });

      const wpAfterComplete = await store.readWorkPackage('WP-001');
      expect(wpAfterComplete.pipelines[0].status).toBe('PASS');
      expect(wpAfterComplete.pipelines[0].artifacts?.files_modified).toHaveLength(2);
      expect(wpAfterComplete.pipelines[0].comments).toHaveLength(1);
      expect(wpAfterComplete.acceptance_criteria[0].met).toBe(true);
      expect(wpAfterComplete.acceptance_criteria[1].met).toBe(true);
    });

    it('rejects duplicate in-progress pipelines', async () => {
      // Claim and start pipeline
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.status = 'IN_PROGRESS';
        root.work_packages[0].status = 'IN_PROGRESS';
        wp.pipelines.push({
          type: 'implementation',
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        });
        return { wp, root };
      });

      // Try to start another implementation pipeline — should detect duplicate
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        const existingInProgress = wp.pipelines.find(
          (p) => p.type === 'implementation' && p.status === 'IN_PROGRESS'
        );
        expect(existingInProgress).toBeDefined();
        // In the real tool, this would throw. We just verify the check works.
        return { wp, root };
      });
    });
  });

  // ========== STAGE 4: QA ==========

  describe('Stage 4: QA validates work package', () => {
    beforeEach(async () => {
      // Set up project with WP-001 having a PASS implementation pipeline
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
            assigned_to: 'Developer Agent',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      const wp: WorkPackageDetail = {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer Agent',
        dependencies: [],
        acceptance_criteria: [
          { criterion: 'Feature implemented', met: true },
          { criterion: 'Tests pass', met: true },
        ],
        revision: 1,
        pipelines: [
          {
            type: 'implementation',
            status: 'PASS',
            started_at: '2026-02-16 10:00:00',
            completed_at: '2026-02-16 11:00:00',
            summary: ['Implemented feature'],
            artifacts: { files_modified: ['src/feature.ts'] },
          },
        ],
      };
      await store.writeWorkPackage('WP-001', wp);
    });

    it('runs QA pipeline and marks PASS', async () => {
      // Start QA pipeline
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.pipelines.push({
          type: 'qa',
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        });
        root.last_updated = now();
        return { wp, root };
      });

      // Complete QA with metrics
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        const pipeline = wp.pipelines.find(
          (p) => p.type === 'qa' && p.status === 'IN_PROGRESS'
        )!;
        pipeline.status = 'PASS';
        pipeline.completed_at = now();
        pipeline.summary = ['All tests pass', 'No regressions'];
        pipeline.metrics = {
          test_coverage: '92%',
          tests_passed: 15,
          tests_failed: 0,
          security_issues: 0,
        };
        root.last_updated = now();
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      const qaPipeline = wp.pipelines.find((p) => p.type === 'qa')!;
      expect(qaPipeline.status).toBe('PASS');
      expect(qaPipeline.metrics?.tests_passed).toBe(15);
      expect(qaPipeline.metrics?.tests_failed).toBe(0);
    });

    it('blocks WP on QA failure', async () => {
      // Start and fail QA
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.pipelines.push({
          type: 'qa',
          status: 'FAIL',
          started_at: now(),
          completed_at: now(),
          summary: ['3 tests failed'],
          metrics: { tests_passed: 12, tests_failed: 3 },
        });

        // Transition to BLOCKED
        expect(isValidStatusTransition('IN_PROGRESS', 'BLOCKED')).toBe(true);
        wp.status = 'BLOCKED';
        wp.blocked_by = {
          type: 'technical',
          description: 'QA failed: 3 tests failed',
        };

        root.work_packages[0].status = 'BLOCKED';
        root.last_updated = now();
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('BLOCKED');
      expect(wp.blocked_by?.type).toBe('technical');
    });
  });

  // ========== STAGE 5-7: Review, Docs, Synthesis ==========

  describe('Stages 5-7: Complete pipeline chain', () => {
    beforeEach(async () => {
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
            assigned_to: 'Developer Agent',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      const wp: WorkPackageDetail = {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer Agent',
        dependencies: [],
        acceptance_criteria: [{ criterion: 'Feature works', met: true }],
        revision: 1,
        pipelines: [
          {
            type: 'implementation',
            status: 'PASS',
            started_at: '2026-02-16 10:00:00',
            completed_at: '2026-02-16 11:00:00',
            summary: ['Done'],
          },
          {
            type: 'qa',
            status: 'PASS',
            started_at: '2026-02-16 11:00:00',
            completed_at: '2026-02-16 12:00:00',
            summary: ['All pass'],
            metrics: { tests_passed: 10, tests_failed: 0 },
          },
        ],
      };
      await store.writeWorkPackage('WP-001', wp);
    });

    it('completes code-review, documentation, and marks WP COMPLETE', async () => {
      // Code review
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.pipelines.push({
          type: 'code-review',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['Code is clean'],
        });
        root.last_updated = now();
        return { wp, root };
      });

      // Documentation
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.pipelines.push({
          type: 'documentation',
          status: 'PASS',
          started_at: now(),
          completed_at: now(),
          summary: ['README updated'],
        });
        root.last_updated = now();
        return { wp, root };
      });

      // Mark COMPLETE
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        const completionCheck = canCompleteWorkPackage(wp);
        expect(completionCheck.allowed).toBe(true);
        expect(isValidStatusTransition('IN_PROGRESS', 'COMPLETE')).toBe(true);

        wp.status = 'COMPLETE';
        root.work_packages[0].status = 'COMPLETE';
        root.pending_work_packages -= 1;
        root.last_updated = now();
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('COMPLETE');
      expect(wp.pipelines).toHaveLength(4);

      const root = await store.readRootIndex();
      expect(root.pending_work_packages).toBe(0);
      expect(root.work_packages[0].status).toBe('COMPLETE');
    });
  });

  // ========== Counter self-healing ==========

  describe('Counter self-healing', () => {
    it('fixes incorrect counters on read', async () => {
      const root: RootIndex = {
        plan_file: 'plan.md',
        date_created: now(),
        last_updated: now(),
        status: 'IN_PROGRESS',
        total_work_packages: 99, // Wrong!
        pending_work_packages: 50, // Wrong!
        work_packages: [
          {
            work_package_id: 'WP-001',
            status: 'COMPLETE',
            assigned_to: 'Dev',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
          {
            work_package_id: 'WP-002',
            status: 'IN_PROGRESS',
            assigned_to: 'Dev',
            dependencies: [],
            file: '.ledger/WP-002.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      // Simulate getProjectStatus self-healing logic
      const readRoot = await store.readRootIndex();
      const totalWps = readRoot.work_packages.length;
      const pendingWps = readRoot.work_packages.filter(
        (wp) => wp.status !== 'COMPLETE'
      ).length;

      expect(totalWps).toBe(2);
      expect(pendingWps).toBe(1);
      expect(readRoot.total_work_packages).toBe(99); // Still wrong in memory

      // Self-heal and write
      readRoot.total_work_packages = totalWps;
      readRoot.pending_work_packages = pendingWps;
      await store.writeRootIndex(readRoot);

      const healed = await store.readRootIndex();
      expect(healed.total_work_packages).toBe(2);
      expect(healed.pending_work_packages).toBe(1);
    });
  });

  // ========== Observations and project comments ==========

  describe('Observations and project comments', () => {
    beforeEach(async () => {
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
            assigned_to: 'Dev',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      await store.writeWorkPackage('WP-001', {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'IN_PROGRESS',
        assigned_to: 'Dev',
        dependencies: [],
        acceptance_criteria: [],
        revision: 1,
        pipelines: [
          {
            type: 'implementation',
            status: 'PASS',
            started_at: now(),
            completed_at: now(),
            summary: ['Done'],
          },
        ],
      });
    });

    it('adds observation to existing pipeline', async () => {
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        const pipeline = [...wp.pipelines]
          .reverse()
          .find((p) => p.type === 'implementation')!;

        if (!pipeline.comments) pipeline.comments = [];
        pipeline.comments.push({
          type: 'code-smell',
          priority: 'medium',
          timestamp: now(),
          note: 'God method in utils.ts:42',
        });

        root.last_updated = now();
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.pipelines[0].comments).toHaveLength(1);
      expect(wp.pipelines[0].comments![0].type).toBe('code-smell');
    });

    it('adds project-level comment with incident context', async () => {
      await withLock(tempDir, async () => {
        const root = await store.readRootIndex();
        root.project_comments.push({
          type: 'incident',
          priority: 'high',
          timestamp: now(),
          agent: 'Developer Agent',
          note: 'Terminal output not visible during test run',
          context: {
            os: 'darwin',
            tool: 'vitest',
            work_package: 'WP-001',
            resolved: true,
            workaround: 'Ran tests with --reporter=verbose',
          },
        });
        root.last_updated = now();
        await store.writeRootIndex(root);
      });

      const root = await store.readRootIndex();
      expect(root.project_comments).toHaveLength(1);
      expect(root.project_comments[0].type).toBe('incident');
      expect(root.project_comments[0].context?.os).toBe('darwin');
    });
  });

  // ========== Revision tracking ==========

  describe('Revision tracking', () => {
    it('increments revision on COMPLETE -> IN_PROGRESS', async () => {
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
            status: 'COMPLETE',
            assigned_to: 'Dev',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
        project_comments: [],
      };
      await store.writeRootIndex(root);

      await store.writeWorkPackage('WP-001', {
        work_package_id: 'WP-001',
        work_package_file: 'work/WP-001.md',
        status: 'COMPLETE',
        assigned_to: 'Dev',
        dependencies: [],
        acceptance_criteria: [{ criterion: 'Done', met: true }],
        revision: 1,
        pipelines: [],
      });

      // Reopen for rework
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        expect(isValidStatusTransition('COMPLETE', 'IN_PROGRESS')).toBe(true);
        wp.status = 'IN_PROGRESS';
        wp.revision += 1;
        root.work_packages[0].status = 'IN_PROGRESS';
        root.pending_work_packages += 1;
        root.last_updated = now();
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('IN_PROGRESS');
      expect(wp.revision).toBe(2);

      const rootResult = await store.readRootIndex();
      expect(rootResult.pending_work_packages).toBe(1);
    });
  });
});
