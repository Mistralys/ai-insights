import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-test-project');

function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: 'plan.md',
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
      expect(result.plan_file).toBe('plan.md');
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
      expect(parsed.plan_file).toBe('plan.md');
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
