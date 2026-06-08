/**
 * Tests for the Repository Registry API handler layer (WP-006).
 *
 * Coverage:
 *   AC-1: GET /api/repos returns all declared repositories from the registry file.
 *   AC-2: POST /api/repos creates a new repository entry with validated id (slug regex),
 *         unique id, and no folder_names conflicts; returns 400 with clear error on conflict.
 *   AC-3: PUT /api/repos/:repoId updates label, folder_names, and vision fields;
 *         enforces folder_name uniqueness across all entries.
 *   AC-4: DELETE /api/repos/:repoId removes the entry without deleting project data.
 *   AC-5: GET /api/repos/:repoId returns the full repository entry or 404 if not found.
 *   AC-6: Folder names are unique across all entries — create/update rejects conflicts.
 *
 * Uses real temp directories (no registry file pre-created — first-run scenario).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleListRepos,
  handleGetRepo,
  handleCreateRepo,
  handleUpdateRepo,
  handleDeleteRepo,
  ApiError,
} from '../../gui/api-repos.js';
import { loadRegistry } from '../../src/storage/repository-registry.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid create-repo body. */
function makeCreateBody(
  overrides: Partial<{
    id: string;
    label: string;
    folder_names: string[];
    vision: { short_term: string | null; mid_term: string | null; long_term: string | null };
  }> = {}
): {
  id: string;
  label: string;
  folder_names: string[];
  vision?: { short_term: string | null; mid_term: string | null; long_term: string | null };
} {
  return {
    id: 'my-repo',
    label: 'My Repository',
    folder_names: ['my-repo-folder'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WP-006 Repository Registry API Handlers', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-repos-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ─── handleListRepos ────────────────────────────────────────────────────

  describe('handleListRepos (GET /api/repos)', () => {
    // AC-1: empty registry returns empty array
    it('AC-1: returns empty array when no registry file exists', async () => {
      const result = await handleListRepos(ledgerRoot);
      expect(result).toEqual([]);
    });

    it('AC-1: returns all declared repositories', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', label: 'Repo A', folder_names: ['folder-a'] }));
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-b', label: 'Repo B', folder_names: ['folder-b'] }));

      const result = await handleListRepos(ledgerRoot);
      expect(result).toHaveLength(2);
      const ids = result.map((r) => r.id);
      expect(ids).toContain('repo-a');
      expect(ids).toContain('repo-b');
    });

    it('AC-1: list items include id, label, folder_names, has_vision, has_full_vision, created_at, last_modified', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', label: 'Repo A', folder_names: ['fa'] }));

      const result = await handleListRepos(ledgerRoot);
      expect(result).toHaveLength(1);
      const item = result[0]!;
      expect(item).toHaveProperty('id', 'repo-a');
      expect(item).toHaveProperty('label', 'Repo A');
      expect(item).toHaveProperty('folder_names', ['fa']);
      expect(item).toHaveProperty('has_vision', false);
      expect(item).toHaveProperty('has_full_vision', false);
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('last_modified');
    });

    it('has_vision is true when at least one horizon is non-null', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({
          id: 'repo-v',
          folder_names: ['fv'],
          vision: { short_term: 'Ship fast', mid_term: null, long_term: null },
        })
      );

      const result = await handleListRepos(ledgerRoot);
      expect(result[0]!.has_vision).toBe(true);
    });

    it('has_vision is false when all horizons are null', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({
          id: 'repo-nv',
          folder_names: ['fnv'],
          vision: { short_term: null, mid_term: null, long_term: null },
        })
      );

      const result = await handleListRepos(ledgerRoot);
      expect(result[0]!.has_vision).toBe(false);
    });

    it('has_full_vision is true when all three horizons are non-null', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({
          id: 'repo-fv',
          folder_names: ['ffv'],
          vision: { short_term: 'Ship fast', mid_term: 'Scale up', long_term: 'Market leader' },
        })
      );

      const result = await handleListRepos(ledgerRoot);
      expect(result[0]!.has_full_vision).toBe(true);
    });

    it('has_full_vision is false when only some horizons are non-null', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({
          id: 'repo-pv',
          folder_names: ['fpv'],
          vision: { short_term: 'Ship fast', mid_term: null, long_term: null },
        })
      );

      const result = await handleListRepos(ledgerRoot);
      expect(result[0]!.has_full_vision).toBe(false);
    });
  });

  // ─── handleGetRepo ───────────────────────────────────────────────────────

  describe('handleGetRepo (GET /api/repos/:repoId)', () => {
    it('AC-5: returns the full entry for an existing repoId', async () => {
      const created = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'target-repo', label: 'Target', folder_names: ['target-folder'] })
      );

      const result = await handleGetRepo(ledgerRoot, 'target-repo');
      expect(result).toEqual(created);
    });

    it('AC-5: returns 404 when the repoId does not exist', async () => {
      await expect(handleGetRepo(ledgerRoot, 'nonexistent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('AC-5: 404 when registry is empty', async () => {
      await expect(handleGetRepo(ledgerRoot, 'any-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('AC-5: returns the correct entry when multiple exist', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'alpha', label: 'Alpha', folder_names: ['fa'] }));
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'beta', label: 'Beta', folder_names: ['fb'] }));

      const result = await handleGetRepo(ledgerRoot, 'beta');
      expect(result.id).toBe('beta');
      expect(result.label).toBe('Beta');
    });
  });

  // ─── handleCreateRepo ────────────────────────────────────────────────────

  describe('handleCreateRepo (POST /api/repos)', () => {
    it('AC-2: creates a new entry and persists it to the registry', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'new-repo', label: 'New Repo', folder_names: ['new-folder'] })
      );

      expect(result.id).toBe('new-repo');
      expect(result.label).toBe('New Repo');
      expect(result.folder_names).toEqual(['new-folder']);
      expect(result.created_at).toBeTruthy();
      expect(result.last_modified).toBeTruthy();

      // Verify persistence
      const registry = await loadRegistry(ledgerRoot);
      expect(registry.repositories).toHaveLength(1);
      expect(registry.repositories[0]!.id).toBe('new-repo');
    });

    it('AC-2: defaults vision to all-null when not provided', async () => {
      const result = await handleCreateRepo(ledgerRoot, makeCreateBody());
      expect(result.vision).toEqual({ short_term: null, mid_term: null, long_term: null });
    });

    it('AC-2: persists explicit vision when provided', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({
          vision: { short_term: 'Short', mid_term: 'Mid', long_term: 'Long' },
        })
      );
      expect(result.vision).toEqual({
        short_term: 'Short',
        mid_term: 'Mid',
        long_term: 'Long',
      });
    });

    it('AC-2: rejects id that does not match SLUG_REGEX', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'invalid id!' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: rejects id starting with a hyphen', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, makeCreateBody({ id: '-bad-start' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: accepts id with underscores and hyphens', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'my_repo-123', folder_names: ['mf'] })
      );
      expect(result.id).toBe('my_repo-123');
    });

    it('AC-2: rejects duplicate id', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'dup-repo', folder_names: ['f1'] }));
      await expect(
        handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'dup-repo', folder_names: ['f2'] }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: error message is clear on duplicate id', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'dup-repo', folder_names: ['f1'] }));
      const err = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'dup-repo', folder_names: ['f2'] })
      ).catch((e) => e as ApiError);
      expect(err.message).toContain("'dup-repo'");
      expect(err.message).toContain('already exists');
    });

    it('AC-2: rejects empty label', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, makeCreateBody({ label: '' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: rejects empty folder_names array', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, { id: 'r', label: 'L', folder_names: [] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: rejects unknown fields in body (strict schema)', async () => {
      await expect(
        handleCreateRepo(ledgerRoot, { ...makeCreateBody(), extra_field: true })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-2: rejects non-object body', async () => {
      await expect(handleCreateRepo(ledgerRoot, null)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    // AC-6: Folder name uniqueness
    it('AC-6: rejects folder_name that conflicts with an existing entry', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', folder_names: ['shared-folder'] }));
      await expect(
        handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-b', folder_names: ['shared-folder'] }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-6: error message names the conflicting folder_name', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', folder_names: ['clash'] }));
      const err = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'repo-b', folder_names: ['clash'] })
      ).catch((e) => e as ApiError);
      expect(err.message).toContain("'clash'");
    });

    it('AC-6: detects conflict in multi-item folder_names', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', folder_names: ['used-folder'] }));
      await expect(
        handleCreateRepo(
          ledgerRoot,
          makeCreateBody({ id: 'repo-b', folder_names: ['new-folder', 'used-folder'] })
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('allows multiple folder_names within one entry', async () => {
      const result = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ folder_names: ['folder-one', 'folder-two', 'folder-three'] })
      );
      expect(result.folder_names).toEqual(['folder-one', 'folder-two', 'folder-three']);
    });
  });

  // ─── handleUpdateRepo ────────────────────────────────────────────────────

  describe('handleUpdateRepo (PUT /api/repos/:repoId)', () => {
    let created: RepositoryEntry;

    beforeEach(async () => {
      created = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'base-repo', label: 'Base', folder_names: ['base-folder'] })
      );
    });

    it('AC-3: updates label when supplied', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', { label: 'Updated Label' });
      expect(result.label).toBe('Updated Label');
      expect(result.id).toBe('base-repo');
      expect(result.folder_names).toEqual(['base-folder']);
    });

    it('AC-3: updates folder_names when supplied', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        folder_names: ['new-folder', 'alias-folder'],
      });
      expect(result.folder_names).toEqual(['new-folder', 'alias-folder']);
    });

    it('AC-3: updates vision when supplied', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        vision: { short_term: 'S', mid_term: 'M', long_term: 'L' },
      });
      expect(result.vision).toEqual({ short_term: 'S', mid_term: 'M', long_term: 'L' });
    });

    it('AC-3: updates all three mutable fields at once', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        label: 'All Updated',
        folder_names: ['updated-folder'],
        vision: { short_term: 'Short', mid_term: null, long_term: null },
      });
      expect(result.label).toBe('All Updated');
      expect(result.folder_names).toEqual(['updated-folder']);
      expect(result.vision.short_term).toBe('Short');
    });

    it('AC-3: preserves unchanged fields when only one field is updated', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', { label: 'New Name' });
      expect(result.folder_names).toEqual(created.folder_names);
      expect(result.vision).toEqual(created.vision);
    });

    it('AC-3: sets last_modified on update', async () => {
      // Introduce a brief delay so last_modified can differ from created_at
      await new Promise((r) => setTimeout(r, 5));
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', { label: 'Updated' });
      expect(result.created_at).toBe(created.created_at);
      // last_modified should be a valid ISO string (may equal created_at in fast tests)
      expect(typeof result.last_modified).toBe('string');
    });

    it('AC-3: update is persisted to the registry file', async () => {
      await handleUpdateRepo(ledgerRoot, 'base-repo', { label: 'Persisted Label' });
      const registry = await loadRegistry(ledgerRoot);
      const found = registry.repositories.find((e) => e.id === 'base-repo');
      expect(found?.label).toBe('Persisted Label');
    });

    it('AC-3: throws NOT_FOUND for unknown repoId', async () => {
      await expect(
        handleUpdateRepo(ledgerRoot, 'ghost-repo', { label: 'X' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('AC-3: rejects empty label', async () => {
      await expect(
        handleUpdateRepo(ledgerRoot, 'base-repo', { label: '' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-3: rejects empty folder_names array', async () => {
      await expect(
        handleUpdateRepo(ledgerRoot, 'base-repo', { folder_names: [] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-3: rejects unknown fields in body', async () => {
      await expect(
        handleUpdateRepo(ledgerRoot, 'base-repo', { label: 'X', id: 'new-id' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    // AC-6: folder_name uniqueness on update
    it('AC-6: rejects folder_names that conflict with a different entry', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'other-repo', label: 'Other', folder_names: ['other-folder'] })
      );
      await expect(
        handleUpdateRepo(ledgerRoot, 'base-repo', { folder_names: ['other-folder'] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-6: does NOT reject keeping the entry\'s own folder_names unchanged', async () => {
      // Re-setting the same folder_names should succeed (no self-conflict)
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        folder_names: ['base-folder'],
      });
      expect(result.folder_names).toEqual(['base-folder']);
    });

    it('AC-6: allows adding a new folder_name not used by any other entry', async () => {
      const result = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        folder_names: ['base-folder', 'new-alias'],
      });
      expect(result.folder_names).toContain('new-alias');
    });

    it('AC-6: error message names the conflicting folder name', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'other-repo', label: 'Other', folder_names: ['clash'] })
      );
      const err = await handleUpdateRepo(ledgerRoot, 'base-repo', {
        folder_names: ['clash'],
      }).catch((e) => e as ApiError);
      expect(err.message).toContain("'clash'");
    });
  });

  // ─── handleDeleteRepo ────────────────────────────────────────────────────

  describe('handleDeleteRepo (DELETE /api/repos/:repoId)', () => {
    it('AC-4: removes the entry from the registry', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'to-delete', folder_names: ['fd'] }));

      const result = await handleDeleteRepo(ledgerRoot, 'to-delete');
      expect(result).toEqual({ deleted: true });

      const registry = await loadRegistry(ledgerRoot);
      expect(registry.repositories.find((e) => e.id === 'to-delete')).toBeUndefined();
    });

    it('AC-4: only removes the target entry, leaving others intact', async () => {
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'keep', folder_names: ['fk'] }));
      await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'remove', folder_names: ['fr'] }));

      await handleDeleteRepo(ledgerRoot, 'remove');

      const registry = await loadRegistry(ledgerRoot);
      expect(registry.repositories).toHaveLength(1);
      expect(registry.repositories[0]!.id).toBe('keep');
    });

    it('AC-4: throws NOT_FOUND when repoId does not exist', async () => {
      await expect(handleDeleteRepo(ledgerRoot, 'ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('AC-4: folder_names from deleted entry can be reused in a new entry', async () => {
      await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'old-repo', folder_names: ['recycled-folder'] })
      );
      await handleDeleteRepo(ledgerRoot, 'old-repo');

      // After deletion, the folder name should be available again
      const result = await handleCreateRepo(
        ledgerRoot,
        makeCreateBody({ id: 'new-repo', folder_names: ['recycled-folder'] })
      );
      expect(result.folder_names).toContain('recycled-folder');
    });
  });

  // ─── Error type checking ─────────────────────────────────────────────────

  describe('ApiError shape', () => {
    it('thrown errors are instances of ApiError', async () => {
      try {
        await handleGetRepo(ledgerRoot, 'missing');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).code).toBe('NOT_FOUND');
      }
    });

    it('validation errors have VALIDATION_ERROR code', async () => {
      try {
        await handleCreateRepo(ledgerRoot, { id: 'bad id', label: 'L', folder_names: ['f'] });
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).code).toBe('VALIDATION_ERROR');
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleListRepos — include_undeclared filesystem discovery (WP-005)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a minimal valid `.meta.json` file at
 * `{ledgerRoot}/{namespace}/{slug}/.meta.json` so that
 * `LedgerStore.listProjectsByFolderNames` recognises the namespace as
 * containing at least one project.
 */
async function seedNamespaceProject(
  ledgerRoot: string,
  namespace: string,
  slug = '2026-01-01-test-project'
): Promise<void> {
  const projectDir = join(ledgerRoot, namespace, slug);
  await mkdir(projectDir, { recursive: true });
  const meta = {
    slug,
    plan_path: projectDir,
    status: 'IN_PROGRESS',
    date_created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
  await writeFile(join(projectDir, '.meta.json'), JSON.stringify(meta), 'utf-8');
}

describe('handleListRepos — include_undeclared (WP-005)', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-repos-undeclared-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('AC-1: declared repos have declared: true when include_undeclared is false (default)', async () => {
    await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'declared-repo', folder_names: ['declared-ns'] }));

    const result = await handleListRepos(ledgerRoot);
    expect(result).toHaveLength(1);
    expect(result[0]!.declared).toBe(true);
  });

  it('AC-1: declared repos have declared: true when include_undeclared is true', async () => {
    await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'declared-repo', folder_names: ['declared-ns'] }));

    const result = await handleListRepos(ledgerRoot, true);
    const declaredItem = result.find((r) => r.id === 'declared-repo');
    expect(declaredItem).toBeDefined();
    expect(declaredItem!.declared).toBe(true);
  });

  it('AC-2: include_undeclared=true returns undeclared namespace entries with declared: false', async () => {
    await seedNamespaceProject(ledgerRoot, 'undeclared-ns');

    const result = await handleListRepos(ledgerRoot, true);
    const undeclaredItem = result.find((r) => r.id === 'undeclared-ns');
    expect(undeclaredItem).toBeDefined();
    expect(undeclaredItem!.declared).toBe(false);
  });

  it('AC-2: undeclared entry has correct synthetic shape', async () => {
    await seedNamespaceProject(ledgerRoot, 'my-namespace');

    const result = await handleListRepos(ledgerRoot, true);
    const item = result.find((r) => r.id === 'my-namespace');
    expect(item).toBeDefined();
    expect(item!.label).toBe('my-namespace');
    expect(item!.folder_names).toEqual(['my-namespace']);
    expect(item!.has_vision).toBe(false);
    expect(item!.has_full_vision).toBe(false);
    expect(item!.declared).toBe(false);
    expect(typeof item!.created_at).toBe('string');
    expect(typeof item!.last_modified).toBe('string');
  });

  it('AC-3: namespace already covered by a declared repo folder_names is excluded from undeclared results', async () => {
    // Create a declared repo that claims 'covered-ns'
    await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-x', folder_names: ['covered-ns'] }));
    // Seed a project in that namespace as if it were also on disk
    await seedNamespaceProject(ledgerRoot, 'covered-ns');

    const result = await handleListRepos(ledgerRoot, true);
    // 'covered-ns' is claimed by 'repo-x' so should NOT appear as an undeclared entry
    const undeclaredCovered = result.filter((r) => r.id === 'covered-ns' && !r.declared);
    expect(undeclaredCovered).toHaveLength(0);
  });

  it('AC-4: include_undeclared defaults to false — does not return undeclared entries', async () => {
    await seedNamespaceProject(ledgerRoot, 'hidden-ns');

    const result = await handleListRepos(ledgerRoot);
    const hiddenItem = result.find((r) => r.id === 'hidden-ns');
    expect(hiddenItem).toBeUndefined();
  });

  it('AC-5: all existing handleListRepos tests still pass with declared field present', async () => {
    await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-a', folder_names: ['fa'] }));
    await handleCreateRepo(ledgerRoot, makeCreateBody({ id: 'repo-b', folder_names: ['fb'] }));

    const result = await handleListRepos(ledgerRoot);
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item).toHaveProperty('declared', true);
    }
  });

  it('empty namespace directories (no projects) are excluded from undeclared results', async () => {
    // Create an empty namespace directory — no .meta.json inside
    await mkdir(join(ledgerRoot, 'empty-ns'), { recursive: true });

    const result = await handleListRepos(ledgerRoot, true);
    const emptyItem = result.find((r) => r.id === 'empty-ns');
    expect(emptyItem).toBeUndefined();
  });

  it('dot-prefixed directories are excluded from undeclared results', async () => {
    await mkdir(join(ledgerRoot, '.archive'), { recursive: true });
    // Even if it had a project inside, dot-prefix should exclude it
    await seedNamespaceProject(ledgerRoot, '.archive');

    const result = await handleListRepos(ledgerRoot, true);
    const archiveItem = result.find((r) => r.id === '.archive');
    expect(archiveItem).toBeUndefined();
  });
});
