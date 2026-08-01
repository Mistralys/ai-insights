/**
 * Tests for api-stores.ts handlers.
 *
 * Coverage:
 *   handleGetStoresEnriched  — enriched store list (replaces handleGetStores)
 *   handleAddStore           — add a new store with directory creation
 *   handleImportStore        — import existing directory as a store
 *   handleUpdateStore        — update store label
 *   handleRemoveStore        — remove store, default reassignment, last-store guard
 *   handleSetDefaultStore    — set default store
 *   handleReorderStores      — reorder stores
 *
 * Mock strategy:
 *   - vi.mock store-registry.js: loadStoresConfig / saveStoresConfig mocked;
 *     expandStorePath kept real (pure function, no I/O).
 *   - vi.mock store-context.js: reloadStoreContext / isStoreContextInitialized /
 *     getMultiStoreManager mocked.
 *   - vi.mock node:child_process: execFile mocked to control git detection.
 *   - Real temp directories for mkdir / writeFile / LedgerStore / loadRegistry I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock store-registry BEFORE importing handlers (vi.mock is hoisted).
// expandStorePath is kept real via importActual.
// ---------------------------------------------------------------------------
vi.mock('../../src/storage/store-registry.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/storage/store-registry.js')>();
  return {
    ...actual,
    loadStoresConfig: vi.fn().mockResolvedValue(null),
    saveStoresConfig: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Mock store-context BEFORE importing handlers.
// ---------------------------------------------------------------------------
vi.mock('../../src/storage/store-context.js', () => ({
  reloadStoreContext: vi.fn().mockResolvedValue(null),
  isStoreContextInitialized: vi.fn<[], boolean>().mockReturnValue(false),
  getStoreRouter: vi.fn(),
  getMultiStoreManager: vi.fn(),
  setStoreContext: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:child_process BEFORE importing handlers.
// Default: git not installed (ENOENT) so tests are isolated from the local
// git environment unless explicitly configured per test.
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import {
  handleGetStoresEnriched,
  handleAddStore,
  handleImportStore,
  handleUpdateStore,
  handleRemoveStore,
  handleSetDefaultStore,
  handleReorderStores,
} from '../../gui/api-stores.js';
import {
  loadStoresConfig,
  saveStoresConfig,
} from '../../src/storage/store-registry.js';
import {
  reloadStoreContext,
  isStoreContextInitialized,
  getMultiStoreManager,
} from '../../src/storage/store-context.js';
import { execFile } from 'node:child_process';
import type { StoresConfig } from '../../src/schema/store-config.js';

const mockLoadStoresConfig  = vi.mocked(loadStoresConfig);
const mockSaveStoresConfig  = vi.mocked(saveStoresConfig);
const mockReloadContext     = vi.mocked(reloadStoreContext);
const mockIsInitialized     = vi.mocked(isStoreContextInitialized);
const mockGetMultiStoreMgr  = vi.mocked(getMultiStoreManager);
const mockExecFile          = vi.mocked(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeds a minimal project .meta.json file (namespaced layout). */
async function seedProject(storePath: string, repoName: string, slug: string): Promise<void> {
  const dir = join(storePath, repoName, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, '.meta.json'),
    JSON.stringify({
      slug,
      plan_path: `/fake/${repoName}/plans/${slug}/plan.md`,
      status: 'IN_PROGRESS',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-01T00:00:00Z',
    }),
    'utf-8'
  );
}

/** Seeds a repository entry into the .repositories.json registry. */
async function seedRepository(storePath: string, repoId: string, label: string): Promise<void> {
  const registryPath = join(storePath, '.repositories.json');
  let existing: { repositories: unknown[] } = { repositories: [] };
  try {
    const raw = await readFile(registryPath, 'utf-8');
    existing = JSON.parse(raw) as { repositories: unknown[] };
  } catch {
    // Start fresh
  }
  existing.repositories.push({
    id: repoId,
    label,
    folder_names: [repoId],
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  });
  await writeFile(registryPath, JSON.stringify(existing), 'utf-8');
}

/**
 * Configures mockExecFile to simulate a git repo with optional ahead/behind.
 * Callbacks pass { stdout, stderr } as a single value so that promisify(execFile)
 * resolves with the expected object shape (matching Node's custom promisify symbol).
 */
function setupGitSuccess(ahead = 0, behind = 0): void {
  let callCount = 0;
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: (...args: unknown[]) => void) => {
      callCount++;
      if (callCount % 2 === 1) {
        // git rev-parse --git-dir: repo detected
        callback(null, { stdout: '.git', stderr: '' });
      } else {
        // git rev-list --left-right --count: return ahead/behind
        callback(null, { stdout: `${ahead}\t${behind}\n`, stderr: '' });
      }
      return {} as ReturnType<typeof execFile>;
    }
  );
}

/** Configures mockExecFile to simulate git not installed (ENOENT). */
function setupGitNotInstalled(): void {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: (...args: unknown[]) => void) => {
      const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      callback(err);
      return {} as ReturnType<typeof execFile>;
    }
  );
}

/** Configures mockExecFile: rev-parse succeeds but rev-list fails (no upstream). */
function setupGitNoUpstream(): void {
  let callCount = 0;
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: (...args: unknown[]) => void) => {
      callCount++;
      if (callCount % 2 === 1) {
        callback(null, { stdout: '.git', stderr: '' });
      } else {
        const err = Object.assign(new Error('fatal: no upstream'), { code: 128 });
        callback(err);
      }
      return {} as ReturnType<typeof execFile>;
    }
  );
}

/** Builds a minimal StoresConfig for use in tests. */
function makeConfig(
  stores: Array<{ id: string; path: string; label?: string }>,
  defaultStore?: string
): StoresConfig {
  return {
    stores: stores.map((s) => ({
      id: s.id,
      path: s.path,
      ...(s.label ? { label: s.label } : {}),
    })),
    default_store: defaultStore ?? stores[0]!.id,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('api-stores handlers', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-stores-'));
    vi.clearAllMocks();
    mockLoadStoresConfig.mockResolvedValue(null);
    mockIsInitialized.mockReturnValue(false);
    setupGitNotInstalled();
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ─── handleGetStoresEnriched ─────────────────────────────────────────────

  describe('handleGetStoresEnriched()', () => {
    describe('legacy mode (loadStoresConfig returns null)', () => {
      it('returns exactly one store entry', async () => {
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result).toHaveLength(1);
      });

      it('returns the default store descriptor', async () => {
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]).toMatchObject({
          id: 'default',
          label: 'Default Store',
          path: ledgerRoot,
          is_default: true,
        });
      });

      it('reports zero project_count on an empty store', async () => {
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.project_count).toBe(0);
      });

      it('reports zero repository_count on an empty store', async () => {
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.repository_count).toBe(0);
      });

      it('reflects seeded projects in project_count', async () => {
        await seedProject(ledgerRoot, 'my-repo', '2026-01-01-test-plan');
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.project_count).toBe(1);
      });

      it('reflects seeded repositories in repository_count', async () => {
        await seedRepository(ledgerRoot, 'my-repo', 'My Repo');
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.repository_count).toBe(1);
      });

      it('returns is_git: false when git is not installed (ENOENT)', async () => {
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.is_git).toBe(false);
        expect(result[0]!.ahead).toBeUndefined();
        expect(result[0]!.behind).toBeUndefined();
      });

      it('returns is_git: true with ahead/behind when store is a git repo', async () => {
        setupGitSuccess(1, 2);
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.is_git).toBe(true);
        expect(result[0]!.ahead).toBe(1);
        expect(result[0]!.behind).toBe(2);
      });

      it('omits ahead/behind when no upstream tracking branch exists', async () => {
        setupGitNoUpstream();
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.is_git).toBe(true);
        expect(result[0]!.ahead).toBeUndefined();
        expect(result[0]!.behind).toBeUndefined();
      });
    });

    describe('multi-store mode (loadStoresConfig returns non-null config)', () => {
      let storeA: string;
      let storeB: string;

      beforeEach(async () => {
        storeA = await mkdtemp(join(tmpdir(), 'store-a-'));
        storeB = await mkdtemp(join(tmpdir(), 'store-b-'));
      });

      afterEach(async () => {
        await rm(storeA, { recursive: true, force: true });
        await rm(storeB, { recursive: true, force: true });
      });

      it('returns one entry per configured store', async () => {
        mockLoadStoresConfig.mockResolvedValue(
          makeConfig([{ id: 'store-a', path: storeA }, { id: 'store-b', path: storeB }])
        );
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result).toHaveLength(2);
      });

      it('entries carry id, label (fallback to id), path, and is_default', async () => {
        mockLoadStoresConfig.mockResolvedValue(
          makeConfig(
            [
              { id: 'store-a', path: storeA, label: 'Store A' },
              { id: 'store-b', path: storeB },
            ],
            'store-a'
          )
        );
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]).toMatchObject({ id: 'store-a', label: 'Store A', path: storeA, is_default: true });
        expect(result[1]).toMatchObject({ id: 'store-b', label: 'store-b', path: storeB, is_default: false });
      });

      it('counts are per-store and independent', async () => {
        await seedProject(storeA, 'repo-a', '2026-01-01-plan-one');
        await seedProject(storeA, 'repo-a', '2026-01-02-plan-two');
        await seedRepository(storeB, 'repo-b', 'Repo B');

        mockLoadStoresConfig.mockResolvedValue(
          makeConfig([{ id: 'store-a', path: storeA }, { id: 'store-b', path: storeB }])
        );
        const result = await handleGetStoresEnriched(ledgerRoot);
        const a = result.find((s) => s.id === 'store-a')!;
        const b = result.find((s) => s.id === 'store-b')!;
        expect(a.project_count).toBe(2);
        expect(a.repository_count).toBe(0);
        expect(b.project_count).toBe(0);
        expect(b.repository_count).toBe(1);
      });

      it('returns is_git: false for all stores when git is not installed', async () => {
        mockLoadStoresConfig.mockResolvedValue(
          makeConfig([{ id: 'store-a', path: storeA }, { id: 'store-b', path: storeB }])
        );
        const result = await handleGetStoresEnriched(ledgerRoot);
        expect(result[0]!.is_git).toBe(false);
        expect(result[1]!.is_git).toBe(false);
      });
    });
  });

  // ─── handleAddStore ──────────────────────────────────────────────────────

  describe('handleAddStore()', () => {
    it('saves config, reloads context, and returns store list', async () => {
      const storeDir = join(ledgerRoot, 'new-store');
      mockLoadStoresConfig.mockResolvedValue(null);

      const result = await handleAddStore({ id: 'new-store', path: storeDir });

      expect(mockSaveStoresConfig).toHaveBeenCalledOnce();
      expect(mockReloadContext).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'new-store', is_default: true });
    });

    it('creates stores.json when none exists (first-store scenario)', async () => {
      const storeDir = join(ledgerRoot, 'first-store');
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleAddStore({ id: 'first-store', path: storeDir });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores).toHaveLength(1);
      expect(savedConfig.stores[0]!.id).toBe('first-store');
      expect(savedConfig.default_store).toBe('first-store');
    });

    it('creates .repositories.json when directory has none', async () => {
      const storeDir = join(ledgerRoot, 'new-store');
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleAddStore({ id: 'new-store', path: storeDir });

      const content = await readFile(join(storeDir, '.repositories.json'), 'utf-8');
      expect(JSON.parse(content)).toEqual({ repositories: [] });
    });

    it('does not overwrite existing .repositories.json', async () => {
      const storeDir = join(ledgerRoot, 'existing-store');
      await mkdir(storeDir, { recursive: true });
      const existingContent = JSON.stringify({
        repositories: [{
          id: 'r1', label: 'Repo 1', folder_names: ['r1'],
          vision: { short_term: null, mid_term: null, long_term: null },
          created_at: '2026-01-01T00:00:00Z', last_modified: '2026-01-01T00:00:00Z',
        }],
      });
      await writeFile(join(storeDir, '.repositories.json'), existingContent, 'utf-8');
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleAddStore({ id: 'existing-store', path: storeDir });

      const afterContent = await readFile(join(storeDir, '.repositories.json'), 'utf-8');
      expect(afterContent).toBe(existingContent);
    });

    it('appends store when config already exists', async () => {
      const existingDir = join(ledgerRoot, 'existing');
      const newDir = join(ledgerRoot, 'new');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'existing', path: existingDir }])
      );

      await handleAddStore({ id: 'new-store', path: newDir });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores).toHaveLength(2);
      expect(savedConfig.stores[1]!.id).toBe('new-store');
    });

    it('trims label and stores it', async () => {
      const storeDir = join(ledgerRoot, 'labeled-store');
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleAddStore({ id: 'labeled-store', path: storeDir, label: '  My Store  ' });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores[0]!.label).toBe('My Store');
    });

    it('rejects duplicate store id with CONFLICT', async () => {
      const existingDir = join(ledgerRoot, 'existing');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'existing', path: existingDir }])
      );

      await expect(
        handleAddStore({ id: 'existing', path: join(ledgerRoot, 'other') })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects duplicate store path with CONFLICT', async () => {
      const sharedDir = join(ledgerRoot, 'shared');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'existing', path: sharedDir }])
      );

      await expect(
        handleAddStore({ id: 'new-id', path: sharedDir })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects a relative path with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);

      await expect(
        handleAddStore({ id: 'my-store', path: 'relative/path' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects reserved id "import" with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleAddStore({ id: 'import', path: join(ledgerRoot, 'import') })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('"import"') });
    });

    it('rejects reserved id "order" with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleAddStore({ id: 'order', path: join(ledgerRoot, 'order') })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects reserved id "conflicts" with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleAddStore({ id: 'conflicts', path: join(ledgerRoot, 'conflicts') })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an invalid slug id with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleAddStore({ id: '-invalid', path: join(ledgerRoot, 'store') })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects whitespace-only label with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleAddStore({ id: 'my-store', path: join(ledgerRoot, 'store'), label: '   ' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  // ─── handleImportStore ───────────────────────────────────────────────────

  describe('handleImportStore()', () => {
    it('registers an existing directory and returns wrapped response with stores array', async () => {
      const existingDir = join(ledgerRoot, 'existing-store');
      await mkdir(existingDir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(null);

      const result = await handleImportStore({ id: 'existing-store', path: existingDir });

      expect(result).toHaveProperty('stores');
      expect(mockSaveStoresConfig).toHaveBeenCalledOnce();
      expect(mockReloadContext).toHaveBeenCalledOnce();
    });

    it('preserves existing valid .repositories.json without overwriting', async () => {
      const existingDir = join(ledgerRoot, 'import-store');
      await mkdir(existingDir, { recursive: true });
      const registryContent = JSON.stringify({
        repositories: [{
          id: 'r1', label: 'Repo', folder_names: ['r1'],
          vision: { short_term: null, mid_term: null, long_term: null },
          created_at: '2026-01-01T00:00:00Z', last_modified: '2026-01-01T00:00:00Z',
        }],
      });
      await writeFile(join(existingDir, '.repositories.json'), registryContent, 'utf-8');
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleImportStore({ id: 'import-store', path: existingDir });

      const afterContent = await readFile(join(existingDir, '.repositories.json'), 'utf-8');
      expect(afterContent).toBe(registryContent);
    });

    it('creates stores.json when none exists (first-store)', async () => {
      const existingDir = join(ledgerRoot, 'first-import');
      await mkdir(existingDir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(null);

      await handleImportStore({ id: 'first-import', path: existingDir });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.default_store).toBe('first-import');
    });

    it('warns on corrupted .repositories.json (malformed JSON) without blocking import', async () => {
      const existingDir = join(ledgerRoot, 'corrupt-store');
      await mkdir(existingDir, { recursive: true });
      await writeFile(join(existingDir, '.repositories.json'), 'not valid json', 'utf-8');
      mockLoadStoresConfig.mockResolvedValue(null);

      const result = await handleImportStore({ id: 'corrupt-store', path: existingDir });

      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('could not be validated');
      expect(mockSaveStoresConfig).toHaveBeenCalledOnce();
    });

    it('returns warning when .repositories.json fails schema validation', async () => {
      const existingDir = join(ledgerRoot, 'schema-invalid-store');
      await mkdir(existingDir, { recursive: true });
      await writeFile(join(existingDir, '.repositories.json'), JSON.stringify({ wrong: true }), 'utf-8');
      mockLoadStoresConfig.mockResolvedValue(null);

      const result = await handleImportStore({ id: 'schema-invalid-store', path: existingDir });

      expect(result.warning).toBeDefined();
    });

    it('returns no warning when .repositories.json is absent', async () => {
      const existingDir = join(ledgerRoot, 'clean-store');
      await mkdir(existingDir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(null);

      const result = await handleImportStore({ id: 'clean-store', path: existingDir });

      expect(result.warning).toBeUndefined();
    });

    it('rejects a non-existent directory with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleImportStore({ id: 'missing', path: join(ledgerRoot, 'does-not-exist') })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects duplicate store id with CONFLICT', async () => {
      const existingDir = join(ledgerRoot, 'existing');
      await mkdir(existingDir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'existing', path: existingDir }])
      );

      await expect(
        handleImportStore({ id: 'existing', path: existingDir })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects duplicate store path with CONFLICT', async () => {
      const sharedDir = join(ledgerRoot, 'shared');
      await mkdir(sharedDir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'existing', path: sharedDir }])
      );

      await expect(
        handleImportStore({ id: 'new-id', path: sharedDir })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects relative path with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleImportStore({ id: 'my-store', path: 'relative/path' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects reserved id "import" with VALIDATION_ERROR', async () => {
      const dir = join(ledgerRoot, 'import-dir');
      await mkdir(dir, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(null);
      await expect(
        handleImportStore({ id: 'import', path: dir })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  // ─── handleUpdateStore ───────────────────────────────────────────────────

  describe('handleUpdateStore()', () => {
    it('updates the label and saves config', async () => {
      const storeDir = join(ledgerRoot, 'my-store');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'my-store', path: storeDir, label: 'Old Label' }])
      );

      const result = await handleUpdateStore('my-store', { label: 'New Label' });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores[0]!.label).toBe('New Label');
      expect(mockReloadContext).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
    });

    it('trims label before saving', async () => {
      const storeDir = join(ledgerRoot, 'my-store');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'my-store', path: storeDir }])
      );

      await handleUpdateStore('my-store', { label: '  Trimmed  ' });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores[0]!.label).toBe('Trimmed');
    });

    it('rejects whitespace-only label with VALIDATION_ERROR', async () => {
      const storeDir = join(ledgerRoot, 'my-store');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'my-store', path: storeDir }])
      );

      await expect(
        handleUpdateStore('my-store', { label: '   ' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects absent label field with VALIDATION_ERROR', async () => {
      const storeDir = join(ledgerRoot, 'my-store');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'my-store', path: storeDir }])
      );

      await expect(
        handleUpdateStore('my-store', {})
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects unknown store id with NOT_FOUND', async () => {
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: join(ledgerRoot, 'a') }])
      );

      await expect(
        handleUpdateStore('unknown', { label: 'Something' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects when no stores.json exists with NOT_FOUND', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);

      await expect(
        handleUpdateStore('any-store', { label: 'Something' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleRemoveStore ───────────────────────────────────────────────────

  describe('handleRemoveStore()', () => {
    it('removes a store, saves config, reloads context', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }], 'store-b')
      );

      const { stores, warned } = await handleRemoveStore('store-a');

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores).toHaveLength(1);
      expect(savedConfig.stores[0]!.id).toBe('store-b');
      expect(mockReloadContext).toHaveBeenCalledOnce();
      expect(warned).toBe(false);
      expect(stores).toHaveLength(1);
    });

    it('reassigns default_store to first remaining store when default is removed', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }], 'store-a')
      );

      await handleRemoveStore('store-a');

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.default_store).toBe('store-b');
    });

    it('preserves default_store when a non-default store is removed', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }], 'store-a')
      );

      await handleRemoveStore('store-b');

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.default_store).toBe('store-a');
    });

    it('sets warned: true when removed store has registered repositories', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      await seedRepository(dirA, 'my-repo', 'My Repo');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }])
      );

      const { warned } = await handleRemoveStore('store-a');

      expect(warned).toBe(true);
    });

    it('rejects removing the last store with VALIDATION_ERROR', async () => {
      const dirA = join(ledgerRoot, 'only-store');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'only-store', path: dirA }])
      );

      await expect(handleRemoveStore('only-store')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects unknown store id with NOT_FOUND', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }])
      );

      await expect(handleRemoveStore('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleSetDefaultStore ───────────────────────────────────────────────

  describe('handleSetDefaultStore()', () => {
    it('sets the default_store field and reloads context', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }], 'store-a')
      );

      const result = await handleSetDefaultStore('store-b');

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.default_store).toBe('store-b');
      expect(mockReloadContext).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
    });

    it('rejects unknown store id with NOT_FOUND', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }])
      );

      await expect(handleSetDefaultStore('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects when no stores.json exists with NOT_FOUND', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);

      await expect(handleSetDefaultStore('any')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── handleReorderStores ─────────────────────────────────────────────────

  describe('handleReorderStores()', () => {
    it('reorders stores and saves config', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      const dirC = join(ledgerRoot, 'store-c');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([
          { id: 'store-a', path: dirA },
          { id: 'store-b', path: dirB },
          { id: 'store-c', path: dirC },
        ])
      );

      const result = await handleReorderStores({ order: ['store-c', 'store-a', 'store-b'] });

      const savedConfig = mockSaveStoresConfig.mock.calls[0]?.[0] as StoresConfig;
      expect(savedConfig.stores.map((s) => s.id)).toEqual(['store-c', 'store-a', 'store-b']);
      expect(mockReloadContext).toHaveBeenCalledOnce();
      expect(result).toHaveLength(3);
    });

    it('rejects order array that is too short (omission) with VALIDATION_ERROR', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }])
      );

      await expect(
        handleReorderStores({ order: ['store-a'] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects order array with duplicates (length mismatch) with VALIDATION_ERROR', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }])
      );

      await expect(
        handleReorderStores({ order: ['store-a', 'store-a', 'store-b'] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects order array containing an unknown store id with VALIDATION_ERROR', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      const dirB = join(ledgerRoot, 'store-b');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }, { id: 'store-b', path: dirB }])
      );

      await expect(
        handleReorderStores({ order: ['store-a', 'unknown'] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects empty order array when stores exist with VALIDATION_ERROR', async () => {
      const dirA = join(ledgerRoot, 'store-a');
      mockLoadStoresConfig.mockResolvedValue(
        makeConfig([{ id: 'store-a', path: dirA }])
      );

      await expect(
        handleReorderStores({ order: [] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects when no stores.json exists with VALIDATION_ERROR', async () => {
      mockLoadStoresConfig.mockResolvedValue(null);

      await expect(
        handleReorderStores({ order: ['store-a'] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
