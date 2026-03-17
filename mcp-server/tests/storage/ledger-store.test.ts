import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../../src/utils/constants.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';
import { makeWorkPackageDetail } from '../helpers/fixtures.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-test-project');

function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: PLAN_ARCHIVE_FILENAME,
    date_created: '2026-02-16 10:00:00',
    last_updated: '2026-02-16 10:00:00',
    status: 'READY',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

describe('LedgerStore', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-test-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  describe('existence checks', () => {
    it('rootIndexExists returns false when no file', async () => {
      expect(await store.rootIndexExists()).toBe(false);
    });

    it('rootIndexExists returns true after writing', async () => {
      await store.writeRootIndex(makeRootIndex());
      expect(await store.rootIndexExists()).toBe(true);
    });

    it('wpDetailExists returns false when no file', async () => {
      expect(await store.wpDetailExists('WP-001')).toBe(false);
    });

    it('wpDetailExists returns true after writing', async () => {
      await store.writeWorkPackage('WP-001', makeWorkPackageDetail());
      expect(await store.wpDetailExists('WP-001')).toBe(true);
    });
  });

  describe('readRootIndex', () => {
    it('reads and validates a valid root index', async () => {
      const data = makeRootIndex({ status: 'IN_PROGRESS', total_work_packages: 1 });
      await store.writeRootIndex(data);

      const result = await store.readRootIndex();
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.total_work_packages).toBe(1);
      expect(result.plan_file).toBe(PLAN_ARCHIVE_FILENAME);
    });

    it('throws when file does not exist', async () => {
      await expect(store.readRootIndex()).rejects.toThrow('Root index not found');
    });

    it('throws on malformed JSON', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(store.storageDir, { recursive: true });
      await writeFile(join(store.storageDir, 'project-ledger.json'), '{ invalid json !!!', 'utf-8');
      await expect(store.readRootIndex()).rejects.toThrow('Malformed JSON');
    });

    it('throws on schema validation failure', async () => {
      const path = join(store.storageDir, 'project-ledger.json');
      await atomicWriteJson(path, { status: 'INVALID', random: 'data' });
      await expect(store.readRootIndex()).rejects.toThrow('validation failed');
    });
  });

  describe('readWorkPackage', () => {
    it('reads and validates a valid work package', async () => {
      const data = makeWorkPackageDetail({ status: 'IN_PROGRESS' });
      await store.writeWorkPackage('WP-001', data);

      const result = await store.readWorkPackage('WP-001');
      expect(result.work_package_id).toBe('WP-001');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('throws when file does not exist', async () => {
      await expect(store.readWorkPackage('WP-999')).rejects.toThrow(
        'Work package WP-999 not found'
      );
    });

    it('migration: rework_count scalar → rework_counts map (legacy file)', async () => {
      // Write a legacy file with only rework_count (no rework_counts)
      const data = makeWorkPackageDetail({ rework_count: 3 });
      await store.writeWorkPackage('WP-001', data);

      const result = await store.readWorkPackage('WP-001');
      expect(result.rework_counts).toEqual({
        implementation: 3,
        qa: 0,
        'code-review': 0,
        documentation: 0,
      });
      expect(result.rework_count).toBeUndefined();
    });

    it('migration: no migration when both rework_count and rework_counts are present', async () => {
      const existing = { implementation: 1, qa: 2, 'code-review': 0, documentation: 0 };
      const data = makeWorkPackageDetail({ rework_count: 3, rework_counts: existing });
      await store.writeWorkPackage('WP-001', data);

      const result = await store.readWorkPackage('WP-001');
      // rework_counts must remain unchanged
      expect(result.rework_counts).toEqual(existing);
    });

    it('migration: no migration when neither field is present', async () => {
      const data = makeWorkPackageDetail(); // no rework_count, no rework_counts
      await store.writeWorkPackage('WP-001', data);

      const result = await store.readWorkPackage('WP-001');
      expect(result.rework_count).toBeUndefined();
      expect(result.rework_counts).toBeUndefined();
    });

    it('migration is in-memory only — file on disk retains original rework_count', async () => {
      const data = makeWorkPackageDetail({ rework_count: 3 });
      await store.writeWorkPackage('WP-001', data);

      // Trigger migration via read
      await store.readWorkPackage('WP-001');

      // The file on disk must still contain the original rework_count
      const raw = await readFile(join(store.storageDir, 'WP-001.json'), 'utf-8');
      const onDisk = JSON.parse(raw);
      expect(onDisk.rework_count).toBe(3);
      expect(onDisk.rework_counts).toBeUndefined();
    });
  });

  describe('writeRootIndex', () => {
    it('writes valid data atomically', async () => {
      const data = makeRootIndex();
      await store.writeRootIndex(data);

      const raw = await readFile(join(store.storageDir, 'project-ledger.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.plan_file).toBe(PLAN_ARCHIVE_FILENAME);
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('rejects invalid data before writing', async () => {
      const invalid = { status: 'INVALID' } as unknown as RootIndex;
      await expect(store.writeRootIndex(invalid)).rejects.toThrow();
      // File should not exist
      expect(await store.rootIndexExists()).toBe(false);
    });
  });

  describe('writeWorkPackage', () => {
    it('creates storageDir automatically', async () => {
      await store.writeWorkPackage('WP-001', makeWorkPackageDetail());
      const raw = await readFile(join(store.storageDir, 'WP-001.json'), 'utf-8');
      expect(JSON.parse(raw).work_package_id).toBe('WP-001');
    });
  });

  describe('archiveDocuments', () => {
    beforeEach(async () => {
      // Ensure planPath dir and storageDir both exist
      const { mkdir } = await import('fs/promises');
      await mkdir(store.planPath, { recursive: true });
      await mkdir(store.storageDir, { recursive: true });
    });

    afterEach(async () => {
      // Clean up any files written to planPath during tests
      const { readdir: rd, rm: rmf } = await import('fs/promises');
      try {
        const entries = await rd(store.planPath);
        for (const entry of entries) {
          await rmf(join(store.planPath, entry), { force: true });
        }
      } catch {
        // planPath may not exist — ignore
      }
    });

    it('copy succeeds: archives a present file and returns it in archived', async () => {
      const { writeFile } = await import('fs/promises');
      const content = '# Plan\n\nHello world.';
      await writeFile(join(store.planPath, PLAN_ARCHIVE_FILENAME), content, 'utf-8');

      const result = await store.archiveDocuments([PLAN_ARCHIVE_FILENAME]);

      expect(result.archived).toEqual([PLAN_ARCHIVE_FILENAME]);
      expect(result.skipped).toEqual([]);

      const destContent = await readFile(join(store.storageDir, PLAN_ARCHIVE_FILENAME), 'utf-8');
      expect(destContent).toBe(content);
    });

    it('source missing: skips gracefully without throwing', async () => {
      const result = await store.archiveDocuments(['missing.md']);

      expect(result.archived).toEqual([]);
      expect(result.skipped).toEqual(['missing.md']);
    });

    it('mixed: archives present file, skips missing file', async () => {
      const { writeFile } = await import('fs/promises');
      await writeFile(join(store.planPath, PLAN_ARCHIVE_FILENAME), '# Plan', 'utf-8');

      const result = await store.archiveDocuments([PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME]);

      expect(result.archived).toEqual([PLAN_ARCHIVE_FILENAME]);
      expect(result.skipped).toEqual([SYNTHESIS_ARCHIVE_FILENAME]);
    });

    it('empty array: returns empty archived and skipped', async () => {
      const result = await store.archiveDocuments([]);

      expect(result.archived).toEqual([]);
      expect(result.skipped).toEqual([]);
    });

    it('non-ENOENT I/O error is re-thrown (destination is a directory → EISDIR)', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      // Source exists so the copy is attempted
      await writeFile(join(store.planPath, PLAN_ARCHIVE_FILENAME), '# Plan', 'utf-8');
      // Destination is a directory — copyFile will fail with EISDIR on Linux/macOS
      // or EPERM on Windows (both are non-ENOENT errors that should be re-thrown)
      await mkdir(join(store.storageDir, PLAN_ARCHIVE_FILENAME), { recursive: true });

      await expect(store.archiveDocuments([PLAN_ARCHIVE_FILENAME])).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Error &&
          'code' in err &&
          ((err as NodeJS.ErrnoException).code === 'EISDIR' ||
            (err as NodeJS.ErrnoException).code === 'EPERM'),
      );
    });
  });

  describe('updateWorkPackageWithSync', () => {
    beforeEach(async () => {
      // Set up a project with one work package
      const root = makeRootIndex({
        status: 'IN_PROGRESS',
        total_work_packages: 1,
        pending_work_packages: 1,
        work_packages: [
          {
            work_package_id: 'WP-001',
            status: 'READY',
            assigned_to: 'Developer',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
      });
      await store.writeRootIndex(root);
      await store.writeWorkPackage('WP-001', makeWorkPackageDetail({ status: 'READY' }));
    });

    it('updates both WP and root index atomically', async () => {
      await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
        wp.status = 'IN_PROGRESS';
        const summary = root.work_packages.find(
          (s) => s.work_package_id === 'WP-001'
        );
        if (summary) summary.status = 'IN_PROGRESS';
        return { wp, root };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('IN_PROGRESS');

      const root = await store.readRootIndex();
      expect(root.work_packages[0].status).toBe('IN_PROGRESS');
    });

    it('rolls back on updater error (files unchanged)', async () => {
      await expect(
        store.updateWorkPackageWithSync('WP-001', () => {
          throw new Error('Simulated failure');
        })
      ).rejects.toThrow('Simulated failure');

      // Both files should be unchanged
      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('READY');

      const root = await store.readRootIndex();
      expect(root.work_packages[0].status).toBe('READY');
    });

    it('throws when WP does not exist', async () => {
      await expect(
        store.updateWorkPackageWithSync('WP-999', (wp, root) => ({ wp, root }))
      ).rejects.toThrow('Work package WP-999 not found');
    });
  });

  describe('createWorkPackageWithSync', () => {
    beforeEach(async () => {
      // Seed an empty project root index (no WPs yet)
      await store.writeRootIndex(makeRootIndex({
        status: 'IN_PROGRESS',
        total_work_packages: 0,
        pending_work_packages: 0,
      }));
    });

    it('writes both WP detail and updated root index atomically', async () => {
      const returnedId = await store.createWorkPackageWithSync((root) => {
        const wp = makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY' });
        const updatedRoot = {
          ...root,
          total_work_packages: 1,
          pending_work_packages: 1,
          work_packages: [
            { work_package_id: 'WP-001', status: 'READY' as const, assigned_to: null, dependencies: [], file: 'ledger/WP-001.json' },
          ],
        };
        return { wpId: 'WP-001', wp, root: updatedRoot };
      });

      expect(returnedId).toBe('WP-001');

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.status).toBe('READY');

      const root = await store.readRootIndex();
      expect(root.total_work_packages).toBe(1);
      expect(root.work_packages[0]!.work_package_id).toBe('WP-001');
    });

    it('auto-stamps last_updated on the created WP', async () => {
      // now() truncates to seconds, so floor beforeCall to the same granularity
      const beforeCall = new Date(Math.floor(Date.now() / 1000) * 1000);

      await store.createWorkPackageWithSync((root) => {
        const wp = makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY' });
        // Deliberately omit last_updated — the method should auto-stamp it
        delete (wp as Partial<typeof wp>).last_updated;
        return {
          wpId: 'WP-001',
          wp,
          root: { ...root, total_work_packages: 1, pending_work_packages: 1, work_packages: [] },
        };
      });

      const wp = await store.readWorkPackage('WP-001');
      expect(wp.last_updated).toBeDefined();

      // The timestamp must be parseable and represent a time >= before the call
      const stamped = new Date(wp.last_updated!.replace(' ', 'T'));
      expect(stamped.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
    });

    it('validates the WP detail via schema — rejects invalid status', async () => {
      await expect(
        store.createWorkPackageWithSync((root) => {
          const wp = makeWorkPackageDetail({ work_package_id: 'WP-001' });
          // @ts-expect-error — intentionally invalid for test
          wp.status = 'NOT_A_STATUS';
          return { wpId: 'WP-001', wp, root };
        })
      ).rejects.toThrow();

      // WP file must NOT have been written
      expect(await store.wpDetailExists('WP-001')).toBe(false);
    });

    it('rolls back on creator error (files unchanged)', async () => {
      await expect(
        store.createWorkPackageWithSync(() => {
          throw new Error('Simulated creator failure');
        })
      ).rejects.toThrow('Simulated creator failure');

      // WP must not exist; root index must be unchanged
      expect(await store.wpDetailExists('WP-001')).toBe(false);
      const root = await store.readRootIndex();
      expect(root.total_work_packages).toBe(0);
    });

    it('syncs .meta.json after creation', async () => {
      // Seed .meta.json so writeProjectMeta can update it
      await store.writeProjectMeta('plan.md', 'IN_PROGRESS');

      await store.createWorkPackageWithSync((root) => {
        const wp = makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'READY' });
        return {
          wpId: 'WP-001',
          wp,
          root: { ...root, total_work_packages: 1, pending_work_packages: 1, work_packages: [] },
        };
      });

      const meta = await store.readProjectMeta();
      expect(meta.total_work_packages).toBe(1);
    });

    it('returns the generated WP ID from the creator callback', async () => {
      const id = await store.createWorkPackageWithSync((root) => ({
        wpId: 'WP-042',
        wp: makeWorkPackageDetail({ work_package_id: 'WP-042', status: 'READY' }),
        root: { ...root, total_work_packages: 1, pending_work_packages: 1, work_packages: [] },
      }));

      expect(id).toBe('WP-042');
      expect(await store.wpDetailExists('WP-042')).toBe(true);
    });
  });

  describe('batchUpdateWorkPackagesWithSync', () => {
    beforeEach(async () => {
      // Set up a project with two work packages
      const root = makeRootIndex({
        status: 'IN_PROGRESS',
        total_work_packages: 2,
        pending_work_packages: 2,
        work_packages: [
          {
            work_package_id: 'WP-001',
            status: 'BLOCKED',
            assigned_to: 'Developer',
            dependencies: ['WP-002'],
            file: '.ledger/WP-001.json',
          },
          {
            work_package_id: 'WP-002',
            status: 'READY',
            assigned_to: 'Developer',
            dependencies: [],
            file: '.ledger/WP-002.json',
          },
        ],
      });
      await store.writeRootIndex(root);
      await store.writeWorkPackage('WP-001', makeWorkPackageDetail({ work_package_id: 'WP-001', status: 'BLOCKED' }));
      await store.writeWorkPackage('WP-002', makeWorkPackageDetail({ work_package_id: 'WP-002', status: 'READY' }));
    });

    it('updates multiple WPs and root index atomically', async () => {
      await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
        const wp1 = await readWp('WP-001');
        wp1.status = 'READY';
        const wp2 = await readWp('WP-002');
        wp2.status = 'IN_PROGRESS';

        const updatedRoot = { ...root };
        updatedRoot.work_packages = updatedRoot.work_packages.map((s) => {
          if (s.work_package_id === 'WP-001') return { ...s, status: 'READY' as const };
          if (s.work_package_id === 'WP-002') return { ...s, status: 'IN_PROGRESS' as const };
          return s;
        });

        const updatedWps = new Map([
          ['WP-001', wp1],
          ['WP-002', wp2],
        ]);
        return { updatedWps, root: updatedRoot };
      });

      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.status).toBe('READY');

      const wp2 = await store.readWorkPackage('WP-002');
      expect(wp2.status).toBe('IN_PROGRESS');

      const root = await store.readRootIndex();
      expect(root.work_packages.find((s) => s.work_package_id === 'WP-001')?.status).toBe('READY');
      expect(root.work_packages.find((s) => s.work_package_id === 'WP-002')?.status).toBe('IN_PROGRESS');
    });

    it('auto-stamps last_updated on every updated WP', async () => {
      const beforeCall = new Date(Math.floor(Date.now() / 1000) * 1000);

      await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
        const wp1 = await readWp('WP-001');
        wp1.status = 'READY';
        // Deliberately set last_updated to a stale value — the method must overwrite it
        wp1.last_updated = '2020-01-01 00:00:00';

        const updatedWps = new Map([['WP-001', wp1]]);
        return { updatedWps, root };
      });

      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.last_updated).toBeDefined();
      const stamped = new Date(wp1.last_updated!.replace(' ', 'T'));
      expect(stamped.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
    });

    it('validates each WP via schema — rejects invalid status, leaves files unchanged', async () => {
      const originalWp1 = await store.readWorkPackage('WP-001');

      await expect(
        store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
          const wp1 = await readWp('WP-001');
          // @ts-expect-error — intentionally invalid for test
          wp1.status = 'NOT_A_STATUS';
          const updatedWps = new Map([['WP-001', wp1]]);
          return { updatedWps, root };
        })
      ).rejects.toThrow();

      // WP-001 must be unchanged on disk
      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.status).toBe(originalWp1.status);
    });

    it('mid-batch validation failure — first WP not written when second WP is invalid', async () => {
      // If WP-001 passes validation but WP-002 has an invalid status, neither
      // WP file should be written (validate-all-then-write-all semantics).
      const originalWp1 = await store.readWorkPackage('WP-001');
      const originalWp2 = await store.readWorkPackage('WP-002');

      await expect(
        store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
          const wp1 = await readWp('WP-001');
          wp1.status = 'READY'; // valid — would pass on its own

          const wp2 = await readWp('WP-002');
          // @ts-expect-error — intentionally invalid for test
          wp2.status = 'NOT_A_STATUS'; // invalid — must cause full rollback

          return { updatedWps: new Map([['WP-001', wp1], ['WP-002', wp2]]), root };
        })
      ).rejects.toThrow();

      // WP-001 must be unchanged even though it was valid — no partial write
      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.status).toBe(originalWp1.status);

      // WP-002 must also be unchanged
      const wp2 = await store.readWorkPackage('WP-002');
      expect(wp2.status).toBe(originalWp2.status);
    });

    it('rolls back on callback error (files unchanged)', async () => {
      await expect(
        store.batchUpdateWorkPackagesWithSync(async () => {
          throw new Error('Simulated batch failure');
        })
      ).rejects.toThrow('Simulated batch failure');

      // Both WPs must be unchanged
      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.status).toBe('BLOCKED');

      const wp2 = await store.readWorkPackage('WP-002');
      expect(wp2.status).toBe('READY');

      const root = await store.readRootIndex();
      expect(root.work_packages.find((s) => s.work_package_id === 'WP-001')?.status).toBe('BLOCKED');
    });

    it('handles empty updatedWps — writes root index and syncs meta without touching WP files', async () => {
      await store.writeProjectMeta('plan.md', 'IN_PROGRESS');

      const beforeRoot = await store.readRootIndex();

      await store.batchUpdateWorkPackagesWithSync(async (root) => {
        const updatedRoot = { ...root, last_updated: '2030-01-01 00:00:00' };
        return { updatedWps: new Map(), root: updatedRoot };
      });

      // Root index must be updated
      const afterRoot = await store.readRootIndex();
      expect(afterRoot.last_updated).toBe('2030-01-01 00:00:00');

      // WP files must be unchanged
      const wp1 = await store.readWorkPackage('WP-001');
      expect(wp1.status).toBe(beforeRoot.work_packages[0]!.status);
    });

    it('provides readWp helper that reads WP detail inside the lock', async () => {
      let readWpResult: import('../../src/schema/work-package.js').WorkPackageDetail | undefined;

      await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
        readWpResult = await readWp('WP-002');
        return { updatedWps: new Map(), root };
      });

      expect(readWpResult).toBeDefined();
      expect(readWpResult!.work_package_id).toBe('WP-002');
      expect(readWpResult!.status).toBe('READY');
    });

    it('syncs .meta.json exactly once after all WP writes', async () => {
      await store.writeProjectMeta('plan.md', 'IN_PROGRESS', {
        total_work_packages: 2,
        pending_work_packages: 2,
      });

      await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
        const wp1 = await readWp('WP-001');
        wp1.status = 'READY';

        const updatedRoot = {
          ...root,
          total_work_packages: 2,
          pending_work_packages: 1,
          work_packages: root.work_packages.map((s) =>
            s.work_package_id === 'WP-001' ? { ...s, status: 'READY' as const } : s
          ),
        };

        return { updatedWps: new Map([['WP-001', wp1]]), root: updatedRoot };
      });

      const meta = await store.readProjectMeta();
      expect(meta.pending_work_packages).toBe(1);
    });
  });
});

// ==================== detectProjectByCwd ====================

describe('LedgerStore.detectProjectByCwd', () => {
  let tempLedgerRoot: string;

  // Synthetic plan paths following the {project-root}/docs/agents/plans/{slug} convention.
  // tmpdir() is used so the paths are valid absolute paths on the current platform.
  const planPathA = join(tmpdir(), 'project-a', 'docs', 'agents', 'plans', '2026-02-15-alpha');
  const planPathB = join(tmpdir(), 'project-b', 'docs', 'agents', 'plans', '2026-02-16-beta');

  // Normalized project roots (forward slashes — the same normalization inferProjectRootFromPlanPath uses)
  const projectRootA = join(tmpdir(), 'project-a').replace(/\\/g, '/');
  const projectRootB = join(tmpdir(), 'project-b').replace(/\\/g, '/');

  // Seed one project (A) into the shared temp ledger root
  async function seedProjectA(): Promise<void> {
    const storeA = new LedgerStore(planPathA, tempLedgerRoot);
    await storeA.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'IN_PROGRESS');
  }

  // Seed both projects into the shared temp ledger root
  async function seedBothProjects(): Promise<void> {
    const storeA = new LedgerStore(planPathA, tempLedgerRoot);
    await storeA.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'IN_PROGRESS');
    const storeB = new LedgerStore(planPathB, tempLedgerRoot);
    await storeB.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'READY');
  }

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'detect-test-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('returns FOUND when cwdPath is a subdirectory inside the project root', async () => {
    await seedProjectA();
    const cwdPath = join(tmpdir(), 'project-a', 'src', 'tools');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.plan_path).toBe(planPathA);
    }
  });

  it('returns FOUND when cwdPath exactly equals the project root', async () => {
    await seedProjectA();
    const cwdPath = join(tmpdir(), 'project-a');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('FOUND');
  });

  it('returns FOUND when cwdPath is the plan folder itself', async () => {
    await seedProjectA();
    const result = await LedgerStore.detectProjectByCwd(planPathA, tempLedgerRoot);
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe('2026-02-15-alpha');
    }
  });

  it('returns NOT_FOUND when no project root is an ancestor of cwdPath', async () => {
    await seedProjectA();
    const cwdPath = join(tmpdir(), 'completely-different-directory', 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when the ledger has no projects', async () => {
    // tempLedgerRoot is empty
    const cwdPath = join(tmpdir(), 'project-a', 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('NOT_FOUND');
  });

  it('does NOT match when cwdPath is a parent (ancestor) of the project root', async () => {
    await seedProjectA();
    // Providing the parent of project-a (i.e. tmpdir()) should NOT match project-a
    const cwdPath = tmpdir();
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    // tmpdir() is a parent of project-a's root, not a descendant — should not match
    expect(result.status).toBe('NOT_FOUND');
  });

  it('auto-resolves to FOUND when one project has clearly more recent activity (> 6h gap)', async () => {
    // Both projects share the same root so both are candidates, but D is 4 days
    // newer than C — the gap >> 6h → best=[D], unlikely=[C], so D is auto-resolved.
    const sharedRoot = join(tmpdir(), 'shared-root-gap');
    const planPathC = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-15-proj-c');
    const planPathD = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-16-proj-d');

    const storeC = new LedgerStore(planPathC, tempLedgerRoot);
    await atomicWriteJson(storeC.metaPath(), {
      slug: '2026-02-15-proj-c',
      plan_path: planPathC,
      status: 'IN_PROGRESS',
      date_created: '2026-03-01T10:00:00Z',
      last_updated: '2026-03-01T10:00:00Z',
    });
    const storeD = new LedgerStore(planPathD, tempLedgerRoot);
    await atomicWriteJson(storeD.metaPath(), {
      slug: '2026-02-16-proj-d',
      plan_path: planPathD,
      status: 'READY',
      date_created: '2026-03-05T10:00:00Z',
      last_updated: '2026-03-05T10:00:00Z',
    });

    const cwdPath = join(sharedRoot, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    // Single best match → auto-resolved to FOUND
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe('2026-02-16-proj-d');
    }
  });

  it('returns AMBIGUOUS with all candidates in "best" when activity timestamps are within 6 hours', async () => {
    // Both projects share the same root and have timestamps 2 hours apart — no gap.
    const sharedRoot = join(tmpdir(), 'shared-root-close');
    const planPathE = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-15-proj-e');
    const planPathF = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-16-proj-f');

    const storeE = new LedgerStore(planPathE, tempLedgerRoot);
    await atomicWriteJson(storeE.metaPath(), {
      slug: '2026-02-15-proj-e',
      plan_path: planPathE,
      status: 'IN_PROGRESS',
      date_created: '2026-03-05T08:00:00Z',
      last_updated: '2026-03-05T08:00:00Z',  // 2h before F
    });
    const storeF = new LedgerStore(planPathF, tempLedgerRoot);
    await atomicWriteJson(storeF.metaPath(), {
      slug: '2026-02-16-proj-f',
      plan_path: planPathF,
      status: 'READY',
      date_created: '2026-03-05T10:00:00Z',
      last_updated: '2026-03-05T10:00:00Z',
    });

    const cwdPath = join(sharedRoot, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      // Both are within 6h → both in best, none in unlikely
      expect(result.best).toHaveLength(2);
      expect(result.unlikely).toHaveLength(0);
      // Most recent first
      expect(result.best[0]!.slug).toBe('2026-02-16-proj-f');
      expect(result.best[1]!.slug).toBe('2026-02-15-proj-e');
    }
  });

  it('returns AMBIGUOUS with correct best/unlikely split at the 6-hour boundary', async () => {
    // Three projects sharing the same root: G (most recent), H (1h older), I (8h older).
    // G and H are within 6h of each other → best=[G,H]; I is > 6h behind H → unlikely=[I].
    const sharedRoot = join(tmpdir(), 'shared-root-split');
    const planPathG = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-15-proj-g');
    const planPathH = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-16-proj-h');
    const planPathI = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-17-proj-i');

    const storeG = new LedgerStore(planPathG, tempLedgerRoot);
    await atomicWriteJson(storeG.metaPath(), {
      slug: '2026-02-15-proj-g',
      plan_path: planPathG,
      status: 'IN_PROGRESS',
      date_created: '2026-03-05T10:00:00Z',
      last_updated: '2026-03-05T10:00:00Z',
    });
    const storeH = new LedgerStore(planPathH, tempLedgerRoot);
    await atomicWriteJson(storeH.metaPath(), {
      slug: '2026-02-16-proj-h',
      plan_path: planPathH,
      status: 'IN_PROGRESS',
      date_created: '2026-03-05T09:00:00Z',
      last_updated: '2026-03-05T09:00:00Z',  // 1h behind G
    });
    const storeI = new LedgerStore(planPathI, tempLedgerRoot);
    await atomicWriteJson(storeI.metaPath(), {
      slug: '2026-02-17-proj-i',
      plan_path: planPathI,
      status: 'READY',
      date_created: '2026-03-05T01:00:00Z',
      last_updated: '2026-03-05T01:00:00Z',  // 8h behind H
    });

    const cwdPath = join(sharedRoot, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      expect(result.best.map((c) => c.slug)).toEqual(['2026-02-15-proj-g', '2026-02-16-proj-h']);
      expect(result.unlikely.map((c) => c.slug)).toEqual(['2026-02-17-proj-i']);
    }
  });

  it('returns FOUND for the correct project and ignores the other when two distinct projects exist', async () => {
    await seedBothProjects();
    const cwdPath = join(tmpdir(), 'project-b', 'tests');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe('2026-02-16-beta');
    }
  });

  // --- ARCHIVED project exclusion ---

  it('returns NOT_FOUND when the only matching project is ARCHIVED', async () => {
    // Project A with ARCHIVED status
    const storeA = new LedgerStore(planPathA, tempLedgerRoot);
    await storeA.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'ARCHIVED');

    const cwdPath = join(tmpdir(), 'project-a', 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('NOT_FOUND');
  });

  it('skips archived projects and returns the non-archived one when both share a root', async () => {
    // Project A: ARCHIVED; Project B: IN_PROGRESS, both share tmpdir() root.
    // We need two projects under the same root by using slightly different plan paths.
    const sharedRoot2 = join(tmpdir(), 'shared-root-archive');
    const planPathX = join(sharedRoot2, 'docs', 'agents', 'plans', '2026-01-01-archived');
    const planPathY = join(sharedRoot2, 'docs', 'agents', 'plans', '2026-01-02-active');

    const storeX = new LedgerStore(planPathX, tempLedgerRoot);
    await atomicWriteJson(storeX.metaPath(), {
      slug: '2026-01-01-archived',
      plan_path: planPathX,
      status: 'ARCHIVED',
      date_created: '2026-01-01T10:00:00Z',
      last_updated: '2026-01-01T10:00:00Z',
    });

    const storeY = new LedgerStore(planPathY, tempLedgerRoot);
    await atomicWriteJson(storeY.metaPath(), {
      slug: '2026-01-02-active',
      plan_path: planPathY,
      status: 'IN_PROGRESS',
      date_created: '2026-01-02T10:00:00Z',
      last_updated: '2026-01-02T10:00:00Z',
    });

    const cwdPath = join(sharedRoot2, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe('2026-01-02-active');
    }
  });
});

// ==================== updateTitle ====================

describe('LedgerStore.updateTitle', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'title-test-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    // Seed a meta.json so readProjectMeta() works in updateTitle
    await store.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'IN_PROGRESS');
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('sets the title field and returns the updated ProjectMeta', async () => {
    const result = await store.updateTitle('My Title');

    expect(result.title).toBe('My Title');
    expect(result.slug).toBe(store.slug);
  });

  it('does not mutate last_updated (title rename is cosmetic, not a content update)', async () => {
    const meta = await store.readProjectMeta();
    const before = meta.last_updated;

    const result = await store.updateTitle('Updated Title');

    expect(result.last_updated).toBe(before);
  });

  it('persists the title to disk (readable after the call)', async () => {
    await store.updateTitle('Persisted Title');

    const rawMeta = JSON.parse(await readFile(store.metaPath(), 'utf-8')) as { title?: string };
    expect(rawMeta.title).toBe('Persisted Title');
  });

  it('overwrites a previous title with a new one', async () => {
    await store.updateTitle('First Title');
    const result = await store.updateTitle('Second Title');

    expect(result.title).toBe('Second Title');

    const rawMeta = JSON.parse(await readFile(store.metaPath(), 'utf-8')) as { title?: string };
    expect(rawMeta.title).toBe('Second Title');
  });
});

// ==================== renameSlug ====================

describe('LedgerStore.renameSlug', () => {
  const OLD_SLUG = '2026-03-05-rename-slug-old';
  const NEW_SLUG = '2026-03-05-rename-slug-new';
  const OLD_PLAN_PATH = join(tmpdir(), OLD_SLUG);
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'rename-slug-test-'));
    store = new LedgerStore(OLD_PLAN_PATH, tempLedgerRoot);
    // Seed .meta.json so the old storage dir exists and is valid.
    await store.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'IN_PROGRESS');
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('happy path: old dir no longer exists; new dir exists on disk', async () => {
    await store.renameSlug(NEW_SLUG);

    await expect(access(join(tempLedgerRoot, NEW_SLUG))).resolves.toBeUndefined();
    await expect(access(join(tempLedgerRoot, OLD_SLUG))).rejects.toThrow();
  });

  it('happy path: updates slug in .meta.json to the new slug', async () => {
    await store.renameSlug(NEW_SLUG);

    const raw = JSON.parse(
      await readFile(join(tempLedgerRoot, NEW_SLUG, '.meta.json'), 'utf-8')
    ) as { slug: string };
    expect(raw.slug).toBe(NEW_SLUG);
  });

  it('preserves other meta fields (plan_path, status, date_created, last_updated)', async () => {
    const metaBefore = await store.readProjectMeta();

    await store.renameSlug(NEW_SLUG);

    const raw = JSON.parse(
      await readFile(join(tempLedgerRoot, NEW_SLUG, '.meta.json'), 'utf-8')
    ) as Record<string, unknown>;
    expect(raw['plan_path']).toBe(metaBefore.plan_path);
    expect(raw['status']).toBe(metaBefore.status);
    expect(raw['date_created']).toBe(metaBefore.date_created);
    expect(raw['last_updated']).toBe(metaBefore.last_updated);
  });

  it('rejects same slug with a descriptive error; directory is untouched', async () => {
    await expect(store.renameSlug(OLD_SLUG)).rejects.toThrow(/already/i);
    // Original dir must still exist.
    await expect(access(join(tempLedgerRoot, OLD_SLUG))).resolves.toBeUndefined();
  });

  it('rejects invalid slug patterns with a validation error; filesystem is untouched', async () => {
    await expect(store.renameSlug('my slug!')).rejects.toThrow(/invalid/i);
    await expect(store.renameSlug('../escape')).rejects.toThrow(/invalid/i);
    await expect(store.renameSlug('')).rejects.toThrow(/invalid/i);
    // Original dir must be untouched.
    await expect(access(join(tempLedgerRoot, OLD_SLUG))).resolves.toBeUndefined();
  });

  it('rejects when target dir already exists; original dir is intact', async () => {
    // Create the target dir ahead of time to simulate a conflict.
    const conflictStore = new LedgerStore(join(tmpdir(), NEW_SLUG), tempLedgerRoot);
    await conflictStore.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'READY');

    await expect(store.renameSlug(NEW_SLUG)).rejects.toThrow(/already in use/i);
    // Old dir must be untouched.
    await expect(access(join(tempLedgerRoot, OLD_SLUG))).resolves.toBeUndefined();
  });

  it('returns updated ProjectMeta with new slug; other fields preserved', async () => {
    const metaBefore = await store.readProjectMeta();

    const result = await store.renameSlug(NEW_SLUG);

    expect(result.slug).toBe(NEW_SLUG);
    expect(result.plan_path).toBe(metaBefore.plan_path);
    expect(result.status).toBe(metaBefore.status);
    expect(result.date_created).toBe(metaBefore.date_created);
    expect(result.last_updated).toBe(metaBefore.last_updated);
  });
});
