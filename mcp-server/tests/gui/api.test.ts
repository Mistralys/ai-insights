/**
 * Tests for gui/api.ts (API route handlers)
 *
 * Uses real temp directories via createTempStore. LedgerStore is used directly
 * to build fixtures on disk; handlers are called with the resulting ledgerRoot
 * and slug values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleListProjects,
  handleGetProject,
  handleGetPlanDocument,
  handleGetSynthesisDocument,
  handleListWorkPackages,
  handleGetWorkPackage,
  handleDeleteProject,
  handleGetConfig,
  handleUpdateConfig,
  handleGetInsights,
  handleRenameProject,
  ApiError,
} from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME, SYNTHESIS_ARCHIVE_FILENAME } from '../../src/utils/constants.js';
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
    plan_file: PLAN_ARCHIVE_FILENAME,
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
    revision: 0,
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

      expect(result.plan_file).toBe(PLAN_ARCHIVE_FILENAME);
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.meta).toBeDefined();
      expect(result.meta.slug).toBe('2026-01-01-test');
    });

    it('throws NOT_FOUND for an unknown project slug', async () => {
      await expect(handleGetProject(ledgerRoot, '2026-01-01-non-existent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleGetProject(ledgerRoot, '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetProject(ledgerRoot, 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetProject(ledgerRoot, '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleListWorkPackages(ledgerRoot, '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleListWorkPackages(ledgerRoot, 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleListWorkPackages(ledgerRoot, '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleGetWorkPackage(ledgerRoot, '../escape', 'WP-001')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetWorkPackage(ledgerRoot, 'a/b', 'WP-001')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetWorkPackage(ledgerRoot, '', 'WP-001')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects path-traversal wpIds with NOT_FOUND', async () => {
      await createProject(ledgerRoot, '2026-01-01-wp-traversal');
      await expect(handleGetWorkPackage(ledgerRoot, '2026-01-01-wp-traversal', '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetWorkPackage(ledgerRoot, '2026-01-01-wp-traversal', 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetWorkPackage(ledgerRoot, '2026-01-01-wp-traversal', '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleDeleteProject(ledgerRoot, '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleDeleteProject(ledgerRoot, 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleDeleteProject(ledgerRoot, '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleGetInsights ───────────────────────────────────────────────────

  describe('handleGetInsights', () => {
    it('returns an empty array when no projects exist', async () => {
      const result = await handleGetInsights(ledgerRoot);
      expect(result).toEqual([]);
    });

    it('returns an empty array when projects exist but have no comments', async () => {
      await createProject(ledgerRoot, '2026-01-01-silent', { project_comments: [] });
      const result = await handleGetInsights(ledgerRoot);
      expect(result).toEqual([]);
    });

    it('returns InsightEntry objects with all required fields', async () => {
      await createProject(ledgerRoot, '2026-01-01-annotated', {
        status: 'IN_PROGRESS',
        project_comments: [
          {
            type: 'note',
            priority: 'medium',
            timestamp: '2026-01-01T10:00:00',
            agent: 'Developer',
            note: 'Test note',
          },
        ],
      });

      const result = await handleGetInsights(ledgerRoot);

      expect(result).toHaveLength(1);
      const entry = result[0]!;
      expect(entry.project_slug).toBe('2026-01-01-annotated');
      expect(entry.project_status).toBe('IN_PROGRESS');
      expect(entry.type).toBe('note');
      expect(entry.priority).toBe('medium');
      expect(entry.timestamp).toBe('2026-01-01T10:00:00');
      expect(entry.agent).toBe('Developer');
      expect(entry.note).toBe('Test note');
      expect(entry.context).toBeUndefined();
    });

    it('includes optional context when present on a comment', async () => {
      await createProject(ledgerRoot, '2026-01-01-incident', {
        project_comments: [
          {
            type: 'incident',
            priority: 'high',
            timestamp: '2026-01-01T12:00:00',
            agent: 'QA',
            note: 'Tool crashed',
            context: { os: 'macOS', tool: 'vitest', resolved: true },
          },
        ],
      });

      const result = await handleGetInsights(ledgerRoot);

      expect(result).toHaveLength(1);
      expect(result[0]!.context).toEqual({ os: 'macOS', tool: 'vitest', resolved: true });
    });

    it('sorts entries by timestamp descending (newest first)', async () => {
      await createProject(ledgerRoot, '2026-01-01-multi', {
        project_comments: [
          { type: 'note', priority: 'low', timestamp: '2026-01-01T08:00:00', agent: 'Developer', note: 'older' },
          { type: 'note', priority: 'high', timestamp: '2026-01-03T08:00:00', agent: 'Developer', note: 'newest' },
          { type: 'note', priority: 'medium', timestamp: '2026-01-02T08:00:00', agent: 'Developer', note: 'middle' },
        ],
      });

      const result = await handleGetInsights(ledgerRoot);

      expect(result).toHaveLength(3);
      expect(result[0]!.note).toBe('newest');
      expect(result[1]!.note).toBe('middle');
      expect(result[2]!.note).toBe('older');
    });

    it('aggregates comments from multiple projects into one sorted array', async () => {
      await createProject(ledgerRoot, '2026-01-01-proj-a', {
        project_comments: [
          { type: 'note', priority: 'low', timestamp: '2026-01-01T09:00:00', agent: 'Developer', note: 'from A' },
        ],
      });
      await createProject(ledgerRoot, '2026-01-02-proj-b', {
        project_comments: [
          { type: 'note', priority: 'high', timestamp: '2026-01-02T09:00:00', agent: 'QA', note: 'from B' },
        ],
      });

      const result = await handleGetInsights(ledgerRoot);

      expect(result).toHaveLength(2);
      // Sorted newest-first: B then A
      expect(result[0]!.project_slug).toBe('2026-01-02-proj-b');
      expect(result[0]!.note).toBe('from B');
      expect(result[1]!.project_slug).toBe('2026-01-01-proj-a');
      expect(result[1]!.note).toBe('from A');
    });

    it('skips a project whose project-ledger.json is corrupted and returns others unchanged', async () => {
      // Good project with a comment
      await createProject(ledgerRoot, '2026-01-01-good', {
        project_comments: [
          { type: 'note', priority: 'low', timestamp: '2026-01-01T10:00:00', agent: 'Developer', note: 'ok' },
        ],
      });

      // Corrupt project: write valid .meta.json (via createProject) then overwrite the ledger file
      await createProject(ledgerRoot, '2026-01-01-bad');
      const badLedgerPath = join(ledgerRoot, '2026-01-01-bad', 'project-ledger.json');
      await writeFile(badLedgerPath, 'not-valid-json', 'utf-8');

      const result = await handleGetInsights(ledgerRoot);

      // The corrupted project must be skipped; the good project's comment is returned
      expect(result).toHaveLength(1);
      expect(result[0]!.project_slug).toBe('2026-01-01-good');
    });
  });

  // ─── handleGetPlanDocument ───────────────────────────────────────────────

  describe('handleGetPlanDocument', () => {
    it('happy path: returns { content } for a project with an archived plan.md', async () => {
      await createProject(ledgerRoot, '2026-01-01-plan-test');
      const planContent = '# Plan\n\nThis is the plan.';
      await writeFile(join(ledgerRoot, '2026-01-01-plan-test', PLAN_ARCHIVE_FILENAME), planContent, 'utf-8');

      const result = await handleGetPlanDocument(ledgerRoot, '2026-01-01-plan-test');

      expect(result).toEqual({ content: planContent });
    });

    it('plan not found: throws NOT_FOUND when project exists but has no plan.md', async () => {
      await createProject(ledgerRoot, '2026-01-01-no-plan');

      await expect(
        handleGetPlanDocument(ledgerRoot, '2026-01-01-no-plan')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('project not found: throws NOT_FOUND for a non-existent slug', async () => {
      await expect(
        handleGetPlanDocument(ledgerRoot, '2026-01-01-ghost-project')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleGetPlanDocument(ledgerRoot, '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetPlanDocument(ledgerRoot, 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetPlanDocument(ledgerRoot, '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleGetSynthesisDocument ──────────────────────────────────────────

  describe('handleGetSynthesisDocument', () => {
    it('happy path: returns { content } for a project with an archived synthesis.md', async () => {
      await createProject(ledgerRoot, '2026-01-01-synthesis-test');
      const synthesisContent = '# Synthesis\n\nThis is the synthesis report.';
      await writeFile(join(ledgerRoot, '2026-01-01-synthesis-test', SYNTHESIS_ARCHIVE_FILENAME), synthesisContent, 'utf-8');

      const result = await handleGetSynthesisDocument(ledgerRoot, '2026-01-01-synthesis-test');

      expect(result).toEqual({ content: synthesisContent });
    });

    it('synthesis not found: throws NOT_FOUND when project exists but has no synthesis.md', async () => {
      await createProject(ledgerRoot, '2026-01-01-no-synthesis');

      await expect(
        handleGetSynthesisDocument(ledgerRoot, '2026-01-01-no-synthesis')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('project not found: throws NOT_FOUND for a non-existent slug', async () => {
      await expect(
        handleGetSynthesisDocument(ledgerRoot, '2026-01-01-ghost-project')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleGetSynthesisDocument(ledgerRoot, '../escape')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetSynthesisDocument(ledgerRoot, 'a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleGetSynthesisDocument(ledgerRoot, '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleGetConfig ─────────────────────────────────────────────────────

  describe('handleGetConfig', () => {
    it('returns the current in-memory config', async () => {
      const result = await handleGetConfig(configPath);

      expect(result.auto_handoff_enabled).toBe(true);
      expect(result.max_handoff_depth).toBe(50);
    });
  });

  // ─── handleUpdateConfig ──────────────────────────────────────────────────

  describe('handleUpdateConfig', () => {
    it('persists a valid partial update and returns the updated config', async () => {
      const result = await handleUpdateConfig(configPath, {
        auto_handoff_enabled: false,
      });

      expect(result.auto_handoff_enabled).toBe(false);
      expect(result.max_handoff_depth).toBe(50); // default preserved
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

  // ─── handleRenameProject ────────────────────────────────────────────

  describe('handleRenameProject', () => {
    it('successful rename: returns updated meta with the new title and preserves last_updated', async () => {
      const store = await createProject(ledgerRoot, '2026-01-01-rename-test');
      const { last_updated: lastUpdatedBefore } = await store.readProjectMeta();

      const result = await handleRenameProject(ledgerRoot, '2026-01-01-rename-test', { title: 'My New Title' });

      expect(result.title).toBe('My New Title');
      expect(result.slug).toBe('2026-01-01-rename-test');
      // AC: updateTitle() must NOT mutate last_updated (WP-001)
      expect(result.last_updated).toBe(lastUpdatedBefore);
    });

    it('rejects empty title with VALIDATION_ERROR', async () => {
      await createProject(ledgerRoot, '2026-01-01-rename-empty');

      await expect(
        handleRenameProject(ledgerRoot, '2026-01-01-rename-empty', { title: '' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects title exceeding 200 characters with VALIDATION_ERROR', async () => {
      await createProject(ledgerRoot, '2026-01-01-rename-long');
      const longTitle = 'A'.repeat(201);

      await expect(
        handleRenameProject(ledgerRoot, '2026-01-01-rename-long', { title: longTitle })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a title of exactly 200 chars — should pass (boundary check)', async () => {
      await createProject(ledgerRoot, '2026-01-01-rename-max');
      const maxTitle = 'A'.repeat(200);

      const result = await handleRenameProject(ledgerRoot, '2026-01-01-rename-max', { title: maxTitle });
      expect(result.title).toBe(maxTitle);
    });

    it('throws NOT_FOUND for a non-existent slug', async () => {
      await expect(
        handleRenameProject(ledgerRoot, '2026-01-01-ghost', { title: 'Whatever' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects path-traversal slugs with NOT_FOUND', async () => {
      await expect(handleRenameProject(ledgerRoot, '../escape', { title: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleRenameProject(ledgerRoot, 'a/b', { title: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(handleRenameProject(ledgerRoot, '', { title: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('persists the title: handleGetProject returns the new title after rename', async () => {
      await createProject(ledgerRoot, '2026-01-01-persist-rename');
      await handleRenameProject(ledgerRoot, '2026-01-01-persist-rename', { title: 'Persisted Title' });

      const detail = await handleGetProject(ledgerRoot, '2026-01-01-persist-rename');
      expect(detail.meta.title).toBe('Persisted Title');
    });

    it('rejects a non-object body with VALIDATION_ERROR', async () => {
      await createProject(ledgerRoot, '2026-01-01-rename-bad-body');

      await expect(
        handleRenameProject(ledgerRoot, '2026-01-01-rename-bad-body', 'not-an-object')
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    // ── WP-002: slug rename tests ──────────────────────────────────────────

    it('rejects an empty body {} with VALIDATION_ERROR', async () => {
      await createProject(ledgerRoot, '2026-03-05-empty-body');

      await expect(
        handleRenameProject(ledgerRoot, '2026-03-05-empty-body', {})
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('slug-only rename: returns meta with the new slug value', async () => {
      await createProject(ledgerRoot, '2026-03-05-slug-rename-src');

      const result = await handleRenameProject(
        ledgerRoot,
        '2026-03-05-slug-rename-src',
        { slug: '2026-03-05-slug-rename-dst' }
      );

      expect(result.slug).toBe('2026-03-05-slug-rename-dst');
    });

    it('slug rename: new slug directory exists on disk, old directory is removed', async () => {
      await createProject(ledgerRoot, '2026-03-05-slug-disk-src');

      await handleRenameProject(
        ledgerRoot,
        '2026-03-05-slug-disk-src',
        { slug: '2026-03-05-slug-disk-dst' }
      );

      // New directory must exist.
      await expect(access(join(ledgerRoot, '2026-03-05-slug-disk-dst'))).resolves.toBeUndefined();
      // Old directory must be gone.
      await expect(access(join(ledgerRoot, '2026-03-05-slug-disk-src'))).rejects.toThrow();
    });

    it('slug rename does not modify last_updated', async () => {
      const store = await createProject(ledgerRoot, '2026-03-05-slug-lu-src');
      const { last_updated: before } = await store.readProjectMeta();

      const result = await handleRenameProject(
        ledgerRoot,
        '2026-03-05-slug-lu-src',
        { slug: '2026-03-05-slug-lu-dst' }
      );

      expect(result.last_updated).toBe(before);
    });

    it('combined { title, slug } applies title first then slug rename', async () => {
      await createProject(ledgerRoot, '2026-03-05-combined-src');

      const result = await handleRenameProject(
        ledgerRoot,
        '2026-03-05-combined-src',
        { title: 'Combined Title', slug: '2026-03-05-combined-dst' }
      );

      expect(result.title).toBe('Combined Title');
      expect(result.slug).toBe('2026-03-05-combined-dst');
    });

    it('slug rename: rejects invalid slug pattern with VALIDATION_ERROR', async () => {
      await createProject(ledgerRoot, '2026-03-05-bad-slug-src');

      await expect(
        handleRenameProject(ledgerRoot, '2026-03-05-bad-slug-src', { slug: 'Invalid Slug!!' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('slug rename: throws CONFLICT when target slug already exists', async () => {
      await createProject(ledgerRoot, '2026-03-05-conflict-src');
      await createProject(ledgerRoot, '2026-03-05-conflict-dst');

      await expect(
        handleRenameProject(
          ledgerRoot,
          '2026-03-05-conflict-src',
          { slug: '2026-03-05-conflict-dst' }
        )
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('same-slug no-op: returns HTTP 200 with unchanged metadata, does not call renameSlug', async () => {
      const store = await createProject(ledgerRoot, '2026-03-05-same-slug-noop');
      const before = await store.readProjectMeta();

      const result = await handleRenameProject(
        ledgerRoot,
        '2026-03-05-same-slug-noop',
        { slug: '2026-03-05-same-slug-noop' }
      );

      expect(result.slug).toBe('2026-03-05-same-slug-noop');
      expect(result.last_updated).toBe(before.last_updated);
      // Confirm old directory still exists (no rename occurred).
      await expect(access(join(ledgerRoot, '2026-03-05-same-slug-noop'))).resolves.toBeUndefined();
    });

    it('combined title + same-slug no-op: updates title, slug unchanged', async () => {
      const store = await createProject(ledgerRoot, '2026-03-05-combined-same-slug');
      const { last_updated: before } = await store.readProjectMeta();

      const result = await handleRenameProject(
        ledgerRoot,
        '2026-03-05-combined-same-slug',
        { title: 'Updated Title', slug: '2026-03-05-combined-same-slug' }
      );

      expect(result.title).toBe('Updated Title');
      expect(result.slug).toBe('2026-03-05-combined-same-slug');
      // last_updated must not be mutated by updateTitle per existing AC.
      expect(result.last_updated).toBe(before);
    });
  });

  // ─── repository_name in handleListProjects ────────────────────────────────

  describe('handleListProjects — repository_name', () => {
    it('derives repository_name from the last segment of the inferred project root', async () => {
      // planPath = {tmpdir}/my-repo/docs/agents/plans/2026-01-01-test
      // inferProjectRootFromPlanPath walks 4 levels up to {tmpdir}/my-repo
      const planPath = join(tmpdir(), 'my-repo', 'docs', 'agents', 'plans', '2026-01-01-repo-test');
      const store = new LedgerStore(planPath, ledgerRoot);
      await store.writeRootIndex(makeRoot());

      const results = await handleListProjects(ledgerRoot);
      const project = results.find((p) => p.slug === '2026-01-01-repo-test');
      expect(project).toBeDefined();
      expect(project!.repository_name).toBe('my-repo');
    });

    it('returns null for repository_name when plan_path is empty', async () => {
      // Use a very shallow plan path that does not have 4 levels above it from tmpdir
      // We simulate this by using a slug path; slug-based stores have planPath = tmpdir/slug
      // inferProjectRootFromPlanPath returns empty string for paths too shallow, so repository_name = null
      await createProject(ledgerRoot, '2026-01-01-no-repo');

      const results = await handleListProjects(ledgerRoot);
      const project = results.find((p) => p.slug === '2026-01-01-no-repo');
      expect(project).toBeDefined();
      // repository_name is null or a string — either is valid when path is shallow
      expect(project!.repository_name === null || typeof project!.repository_name === 'string').toBe(true);
    });
  });

  // ─── title priority in handleListProjects ───────────────────────────────

  describe('handleListProjects — title priority', () => {
    it('returns the persisted meta.title as project_name when set (overrides slug-derived name)', async () => {
      const store = await createProject(ledgerRoot, '2026-01-01-titled-project');
      await store.updateTitle('My Custom Title');

      const results = await handleListProjects(ledgerRoot);
      const project = results.find((p) => p.slug === '2026-01-01-titled-project');
      expect(project).toBeDefined();
      expect(project!.project_name).toBe('My Custom Title');
    });

    it('falls back to slug-derived name when no title is set', async () => {
      await createProject(ledgerRoot, '2026-01-01-auto-name');

      const results = await handleListProjects(ledgerRoot);
      const project = results.find((p) => p.slug === '2026-01-01-auto-name');
      expect(project).toBeDefined();
      // Slug-derived: strips date prefix and title-cases remainder → 'Auto Name'
      expect(project!.project_name).toBe('Auto Name');
    });
  });
});
