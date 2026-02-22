/**
 * Tests for gui/api.ts (API route handlers)
 *
 * Uses real temp directories via createTempStore. LedgerStore is used directly
 * to build fixtures on disk; handlers are called with the resulting ledgerRoot
 * and slug values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleListProjects,
  handleGetProject,
  handleListWorkPackages,
  handleGetWorkPackage,
  handleDeleteProject,
  handleGetConfig,
  handleUpdateConfig,
  ApiError,
} from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import {
  readConfigFromDisk,
  writeConfig,
  __resetForTesting,
} from '../../src/gui/config.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid RootIndex. */
function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

/** Build a minimal valid WorkPackageDetail. */
function makeWp(id: string): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: 'READY',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 1,
    pipelines: [],
  };
}

/**
 * Creates a project fixture in the given ledgerRoot.
 * Returns the slug (used as the identifier in API handler calls).
 */
async function createProject(
  ledgerRoot: string,
  slug: string,
  rootOverrides: Partial<RootIndex> = {}
): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, ledgerRoot);
  await store.writeRootIndex(makeRoot(rootOverrides));
  return store;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('gui/api.ts', () => {
  let ledgerRoot: string;
  let configPath: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-test-ledger-'));
    configPath = join(ledgerRoot, 'gui-config.json');
    __resetForTesting();
    await readConfigFromDisk(configPath); // seed defaults into cache
  });

  afterEach(async () => {
    __resetForTesting();
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ─── handleListProjects ──────────────────────────────────────────────────

  describe('handleListProjects', () => {
    it('returns empty array when no projects exist', async () => {
      const result = await handleListProjects(ledgerRoot);
      expect(result).toEqual([]);
    });

    it('returns summaries for all projects in the ledger', async () => {
      await createProject(ledgerRoot, '2026-01-01-alpha');
      await createProject(ledgerRoot, '2026-01-02-beta');

      const result = await handleListProjects(ledgerRoot);
      expect(result).toHaveLength(2);
      const slugs = result.map((p) => p.slug);
      expect(slugs).toContain('2026-01-01-alpha');
      expect(slugs).toContain('2026-01-02-beta');
    });
  });

  // ─── handleGetProject ────────────────────────────────────────────────────

  describe('handleGetProject', () => {
    it('returns root index + meta for an existing project', async () => {
      await createProject(ledgerRoot, '2026-01-01-test');

      const result = await handleGetProject(ledgerRoot, '2026-01-01-test');

      expect(result.plan_file).toBe('plan.md');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.meta).toBeDefined();
      expect(result.meta.slug).toBe('2026-01-01-test');
    });

    it('throws NOT_FOUND for an unknown project slug', async () => {
      await expect(handleGetProject(ledgerRoot, '2026-01-01-non-existent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─── handleListWorkPackages ──────────────────────────────────────────────

  describe('handleListWorkPackages', () => {
    it('returns WP summary array for a project with work packages', async () => {
      await createProject(ledgerRoot, '2026-01-01-with-wps', {
        total_work_packages: 2,
        pending_work_packages: 2,
        work_packages: [
          { work_package_id: 'WP-001', status: 'READY', assigned_to: 'Developer', dependencies: [], file: 'ledger/WP-001.json' },
          { work_package_id: 'WP-002', status: 'READY', assigned_to: 'QA', dependencies: ['WP-001'], file: 'ledger/WP-002.json' },
        ],
      });

      const result = await handleListWorkPackages(ledgerRoot, '2026-01-01-with-wps');

      expect(result).toHaveLength(2);
      expect(result[0]!.work_package_id).toBe('WP-001');
      expect(result[1]!.work_package_id).toBe('WP-002');
    });

    it('throws NOT_FOUND for a missing project', async () => {
      await expect(
        handleListWorkPackages(ledgerRoot, '2026-01-01-does-not-exist')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleGetWorkPackage ────────────────────────────────────────────────

  describe('handleGetWorkPackage', () => {
    it('returns full WP detail for an existing WP', async () => {
      const store = await createProject(ledgerRoot, '2026-01-01-wp-detail');
      await store.writeWorkPackage('WP-001', makeWp('WP-001'));

      const result = await handleGetWorkPackage(ledgerRoot, '2026-01-01-wp-detail', 'WP-001');

      expect(result.work_package_id).toBe('WP-001');
      expect(result.status).toBe('READY');
    });

    it('throws NOT_FOUND for a missing WP in an existing project', async () => {
      await createProject(ledgerRoot, '2026-01-01-no-wps');

      await expect(
        handleGetWorkPackage(ledgerRoot, '2026-01-01-no-wps', 'WP-999')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws NOT_FOUND when the project itself does not exist', async () => {
      await expect(
        handleGetWorkPackage(ledgerRoot, '2026-01-01-ghost-project', 'WP-001')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleDeleteProject ─────────────────────────────────────────────────

  describe('handleDeleteProject', () => {
    it('deletes a COMPLETE project and returns { deleted: true, slug }', async () => {
      await createProject(ledgerRoot, '2026-01-01-done', { status: 'COMPLETE' });

      const result = await handleDeleteProject(ledgerRoot, '2026-01-01-done');

      expect(result).toEqual({ deleted: true, slug: '2026-01-01-done' });

      // Directory must no longer exist
      const projectDir = join(ledgerRoot, '2026-01-01-done');
      await expect(access(projectDir)).rejects.toThrow();
    });

    it('throws FORBIDDEN for an IN_PROGRESS project', async () => {
      await createProject(ledgerRoot, '2026-01-01-active', { status: 'IN_PROGRESS' });

      await expect(
        handleDeleteProject(ledgerRoot, '2026-01-01-active')
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Directory must still exist
      const projectDir = join(ledgerRoot, '2026-01-01-active');
      await expect(access(projectDir)).resolves.toBeUndefined();
    });

    it('throws FORBIDDEN for a READY project', async () => {
      await createProject(ledgerRoot, '2026-01-01-ready', { status: 'READY' });

      await expect(
        handleDeleteProject(ledgerRoot, '2026-01-01-ready')
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('throws NOT_FOUND for a project that does not exist', async () => {
      await expect(
        handleDeleteProject(ledgerRoot, '2026-01-01-phantom-project')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleGetConfig ─────────────────────────────────────────────────────

  describe('handleGetConfig', () => {
    it('returns the current in-memory config', async () => {
      const result = await handleGetConfig(configPath);

      expect(result.auto_handoff_enabled).toBe(true);
      expect(result.max_handoff_depth).toBe(10);
    });
  });

  // ─── handleUpdateConfig ──────────────────────────────────────────────────

  describe('handleUpdateConfig', () => {
    it('persists a valid partial update and returns the updated config', async () => {
      const result = await handleUpdateConfig(configPath, {
        auto_handoff_enabled: false,
      });

      expect(result.auto_handoff_enabled).toBe(false);
      expect(result.max_handoff_depth).toBe(10); // default preserved
    });

    it('throws VALIDATION_ERROR for an invalid type (max_handoff_depth: string)', async () => {
      await expect(
        handleUpdateConfig(configPath, { max_handoff_depth: 'abc' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('does not persist ledger_root changes — stripped by the handler', async () => {
      const beforeRoot = (await handleGetConfig(configPath)).ledger_root;

      await handleUpdateConfig(configPath, { ledger_root: '/evil/path' } as any);

      const afterRoot = (await handleGetConfig(configPath)).ledger_root;
      expect(afterRoot).toBe(beforeRoot);
      expect(afterRoot).not.toBe('/evil/path');
    });
  });
});
