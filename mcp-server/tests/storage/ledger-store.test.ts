import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../../src/utils/constants.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

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

function makeWpDetail(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    work_package_file: 'work/WP-001.md',
    status: 'READY',
    assigned_to: 'Developer Agent',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'Tests pass', met: false }],
    revision: 1,
    pipelines: [],
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
      await store.writeWorkPackage('WP-001', makeWpDetail());
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
      const data = makeWpDetail({ status: 'IN_PROGRESS' });
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
      await store.writeWorkPackage('WP-001', makeWpDetail());
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
      // Destination is a directory — copyFile will fail with EISDIR, not ENOENT
      await mkdir(join(store.storageDir, PLAN_ARCHIVE_FILENAME), { recursive: true });

      await expect(store.archiveDocuments([PLAN_ARCHIVE_FILENAME])).rejects.toMatchObject({
        code: 'EISDIR',
      });
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
            assigned_to: 'Developer Agent',
            dependencies: [],
            file: '.ledger/WP-001.json',
          },
        ],
      });
      await store.writeRootIndex(root);
      await store.writeWorkPackage('WP-001', makeWpDetail());
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

  it('returns AMBIGUOUS with both candidates when two projects both match cwdPath', async () => {
    // Plant both projects under the same artificial shared root so both match
    // when cwdPath equals that shared root.
    // We achieve this by using plan paths that share the same project root.
    const sharedRoot = join(tmpdir(), 'shared-root');
    const planPathC = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-15-proj-c');
    const planPathD = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-16-proj-d');

    const storeC = new LedgerStore(planPathC, tempLedgerRoot);
    await storeC.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'IN_PROGRESS');
    const storeD = new LedgerStore(planPathD, tempLedgerRoot);
    await storeD.writeProjectMeta(PLAN_ARCHIVE_FILENAME, 'READY');

    // Both C and D derive the same project root (sharedRoot), so both match
    const cwdPath = join(sharedRoot, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);
    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      expect(result.candidates).toHaveLength(2);
      const slugs = result.candidates.map((c) => c.slug).sort();
      expect(slugs).toEqual(['2026-02-15-proj-c', '2026-02-16-proj-d']);
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
});
