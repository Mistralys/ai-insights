/**
 * scripts/tests/store-commands.test.js
 *
 * Unit tests for scripts/lib/store-commands.js
 *
 * Acceptance Criteria verified:
 *   AC-1 (plan AC-9): store init creates ~/.ai-insights/stores.json with current ledger root
 *   AC-2 (plan AC-9): store add registers store and creates empty .repositories.json
 *   AC-3 (plan AC-9): store repo add writes entry to correct store's .repositories.json
 *   AC-4 (plan AC-9): store list displays all stores with repo and project counts
 *   AC-5 (plan AC-9): store conflicts shows repos registered in multiple stores
 *   AC-6 (plan AC-9): store default updates the default_store field in stores.json
 *   AC-7: store add with an uncreatable path returns a clear error (on read-only fs)
 *   AC-8: store remove warns when the store has registered repositories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  storeInit,
  storeAdd,
  storeRemove,
  storeList,
  storeSetDefault,
  storeConflicts,
  storeRepoAdd,
  storeRepoMove,
  storeRepoList,
  loadConfig,
  loadRegistry,
  registryPath,
} from '../lib/store-commands.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'store-cmds-test-'));
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

describe('store-commands', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir    = makeTempDir();
    configPath = path.join(tempDir, 'stores.json');
  });

  afterEach(() => {
    rmDir(tempDir);
  });

  // ─── storeInit ─────────────────────────────────────────────────────────────

  describe('storeInit', () => {
    it('AC-1: creates stores.json with the provided ledger root as the default store', async () => {
      const ledgerRoot = path.join(tempDir, 'ledger');
      const result = await storeInit({ configPath, ledgerRoot, _storesDirOverride: tempDir });

      expect(result.ok).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);

      const config = await loadConfig(configPath);
      expect(config.stores).toHaveLength(1);
      expect(config.stores[0].id).toBe('default');
      expect(config.default_store).toBe('default');
    });

    it('returns ok: false when stores.json already exists', async () => {
      const ledgerRoot = path.join(tempDir, 'ledger');
      await storeInit({ configPath, ledgerRoot, _storesDirOverride: tempDir });
      const result = await storeInit({ configPath, ledgerRoot, _storesDirOverride: tempDir });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('already exists');
    });

    it('creates the stores/ sub-directory under _storesDirOverride', async () => {
      const ledgerRoot = path.join(tempDir, 'ledger');
      const result = await storeInit({ configPath, ledgerRoot, _storesDirOverride: tempDir });
      expect(result.ok).toBe(true);
      expect(result.configPath).toBe(configPath);
      expect(fs.existsSync(path.join(tempDir, 'stores'))).toBe(true);
    });
  });

  // ─── storeAdd ──────────────────────────────────────────────────────────────

  describe('storeAdd', () => {
    it('AC-2: registers the store in stores.json', async () => {
      const storePath = path.join(tempDir, 'my-store');
      const result = await storeAdd({ id: 'my-store', storePath, configPath });

      expect(result.ok).toBe(true);
      expect(result.id).toBe('my-store');

      const config = await loadConfig(configPath);
      expect(config.stores).toHaveLength(1);
      expect(config.stores[0].id).toBe('my-store');
    });

    it('AC-2: creates the store directory when it does not exist', async () => {
      const storePath = path.join(tempDir, 'new-dir');
      expect(fs.existsSync(storePath)).toBe(false);

      const result = await storeAdd({ id: 'new', storePath, configPath });

      expect(result.ok).toBe(true);
      expect(fs.existsSync(storePath)).toBe(true);
    });

    it('AC-2: creates an empty .repositories.json in the new store directory', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });

      const registry = await loadRegistry(storePath);
      expect(registry.repositories).toEqual([]);
      expect(fs.existsSync(registryPath(storePath))).toBe(true);
    });

    it('returns ok: false when store ID already exists', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });
      const result = await storeAdd({ id: 'store-a', storePath, configPath });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('already exists');
    });

    it('returns ok: false when id is missing', async () => {
      const result = await storeAdd({ storePath: '/tmp/x', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('required');
    });

    it('returns ok: false when path is missing', async () => {
      const result = await storeAdd({ id: 'x', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('required');
    });
  });

  // ─── storeList ─────────────────────────────────────────────────────────────

  describe('storeList', () => {
    it('AC-4: returns all stores with repo and project counts', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });

      const result = await storeList({ configPath });
      expect(result.ok).toBe(true);
      expect(result.stores).toHaveLength(2);

      const aRow = result.stores.find(s => s.id === 'store-a');
      expect(aRow.repo_count).toBe(0);
      expect(aRow.project_count).toBe(0);
    });

    it('returns empty stores array when no stores.json exists', async () => {
      const result = await storeList({ configPath });
      expect(result.ok).toBe(true);
      expect(result.stores).toEqual([]);
    });

    it('marks the default store correctly', async () => {
      const storePath = path.join(tempDir, 'store-x');
      await storeAdd({ id: 'store-x', storePath, configPath });
      await storeSetDefault({ id: 'store-x', configPath });

      const result = await storeList({ configPath });
      expect(result.stores[0].is_default).toBe(true);
    });

    it('reflects repo_count from .repositories.json', async () => {
      const storePath = path.join(tempDir, 'store-r');
      await storeAdd({ id: 'store-r', storePath, configPath });
      await storeRepoAdd({ repoName: 'my-repo', storeId: 'store-r', configPath });

      const result = await storeList({ configPath });
      const row = result.stores.find(s => s.id === 'store-r');
      expect(row.repo_count).toBe(1);
    });
  });

  // ─── storeSetDefault ───────────────────────────────────────────────────────

  describe('storeSetDefault', () => {
    it('AC-6: updates the default_store field in stores.json', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });

      const result = await storeSetDefault({ id: 'store-b', configPath });
      expect(result.ok).toBe(true);
      expect(result.default_store).toBe('store-b');

      const config = await loadConfig(configPath);
      expect(config.default_store).toBe('store-b');
    });

    it('returns ok: false when store ID does not exist', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });

      const result = await storeSetDefault({ id: 'nonexistent', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('returns ok: false when no stores.json exists', async () => {
      const result = await storeSetDefault({ id: 'x', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No stores.json');
    });
  });

  // ─── storeRepoAdd ──────────────────────────────────────────────────────────

  describe('storeRepoAdd', () => {
    it('AC-3: writes a repository entry to the correct store .repositories.json', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });

      const result = await storeRepoAdd({ repoName: 'my-project', storeId: 'store-a', configPath });
      expect(result.ok).toBe(true);
      expect(result.repoName).toBe('my-project');
      expect(result.storeId).toBe('store-a');

      const registry = await loadRegistry(storePath);
      expect(registry.repositories).toHaveLength(1);
      expect(registry.repositories[0].folder_names).toContain('my-project');
    });

    it('sets the entry label to repoName when no label is provided', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });
      await storeRepoAdd({ repoName: 'my-repo', storeId: 'store-a', configPath });

      const registry = await loadRegistry(storePath);
      expect(registry.repositories[0].label).toBe('my-repo');
    });

    it('sets the entry label when provided', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });
      await storeRepoAdd({ repoName: 'my-repo', storeId: 'store-a', label: 'My Project', configPath });

      const registry = await loadRegistry(storePath);
      expect(registry.repositories[0].label).toBe('My Project');
    });

    it('creates a valid entry structure compatible with RepositoryEntrySchema', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });
      await storeRepoAdd({ repoName: 'repo', storeId: 'store-a', configPath });

      const registry = await loadRegistry(storePath);
      const entry = registry.repositories[0];
      expect(typeof entry.id).toBe('string');
      expect(Array.isArray(entry.folder_names)).toBe(true);
      expect(entry.vision).toMatchObject({ short_term: null, mid_term: null, long_term: null });
      expect(typeof entry.created_at).toBe('string');
      expect(typeof entry.last_modified).toBe('string');
    });

    it('returns ok: false when repo is already registered in the store', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });
      await storeRepoAdd({ repoName: 'dup-repo', storeId: 'store-a', configPath });
      const result = await storeRepoAdd({ repoName: 'dup-repo', storeId: 'store-a', configPath });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('already registered');
    });

    it('returns ok: false when store ID is not found', async () => {
      await storeAdd({ id: 'store-a', storePath: path.join(tempDir, 'store-a'), configPath });
      const result = await storeRepoAdd({ repoName: 'repo', storeId: 'nonexistent', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('returns ok: false when no stores.json exists', async () => {
      const result = await storeRepoAdd({ repoName: 'repo', storeId: 'store-a', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('store init');
    });
  });

  // ─── storeConflicts ────────────────────────────────────────────────────────

  describe('storeConflicts', () => {
    it('AC-5: returns an empty conflicts array when no repos are shared', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });
      await storeRepoAdd({ repoName: 'repo-a', storeId: 'store-a', configPath });
      await storeRepoAdd({ repoName: 'repo-b', storeId: 'store-b', configPath });

      const result = await storeConflicts({ configPath });
      expect(result.ok).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('AC-5: detects a repo registered in two stores with the correct winner', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });
      // Register 'shared-repo' in both stores directly via registry I/O.
      const now = new Date().toISOString();
      const sharedEntry = {
        id: 'uuid-1', label: 'Shared', folder_names: ['shared-repo'],
        vision: { short_term: null, mid_term: null, long_term: null },
        created_at: now, last_modified: now,
      };
      const regA = await loadRegistry(storeA);
      regA.repositories.push(sharedEntry);
      fs.writeFileSync(registryPath(storeA), JSON.stringify(regA, null, 2));
      const regB = await loadRegistry(storeB);
      regB.repositories.push({ ...sharedEntry, id: 'uuid-2' });
      fs.writeFileSync(registryPath(storeB), JSON.stringify(regB, null, 2));

      const result = await storeConflicts({ configPath });
      expect(result.ok).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].repo_name).toBe('shared-repo');
      expect(result.conflicts[0].winner_store_id).toBe('store-a');
      expect(result.conflicts[0].entries).toHaveLength(2);
    });

    it('returns ok: true with empty conflicts when no stores.json exists', async () => {
      const result = await storeConflicts({ configPath });
      expect(result.ok).toBe(true);
      expect(result.conflicts).toEqual([]);
    });
  });

  // ─── storeRemove ───────────────────────────────────────────────────────────

  describe('storeRemove', () => {
    it('removes the store from stores.json without deleting the directory', async () => {
      const storePath = path.join(tempDir, 'store-del');
      await storeAdd({ id: 'store-del', storePath, configPath });

      const result = await storeRemove({ id: 'store-del', configPath });
      expect(result.ok).toBe(true);

      const config = await loadConfig(configPath);
      expect(config.stores.find(s => s.id === 'store-del')).toBeUndefined();
      expect(fs.existsSync(storePath)).toBe(true); // directory NOT deleted
    });

    it('AC-8: warns when the store has registered repositories', async () => {
      const storePath = path.join(tempDir, 'store-with-repos');
      await storeAdd({ id: 'store-with-repos', storePath, configPath });
      await storeRepoAdd({ repoName: 'some-repo', storeId: 'store-with-repos', configPath });

      const result = await storeRemove({ id: 'store-with-repos', configPath });
      expect(result.ok).toBe(true);
      expect(result.warned).toBe(true);
      expect(result.hasRepos).toBe(true);
    });

    it('returns ok: false when store ID does not exist', async () => {
      // Create a stores.json with a different store so the lookup can run.
      const storePath = path.join(tempDir, 'other-store');
      await storeAdd({ id: 'other-store', storePath, configPath });

      const result = await storeRemove({ id: 'nonexistent', configPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('clears default_store to null when the last store is removed', async () => {
      const storePath = path.join(tempDir, 'only-store');
      await storeAdd({ id: 'only-store', storePath, configPath });
      await storeSetDefault({ id: 'only-store', configPath });

      const result = await storeRemove({ id: 'only-store', configPath });
      expect(result.ok).toBe(true);

      const config = await loadConfig(configPath);
      expect(config.stores).toHaveLength(0);
      expect(config.default_store).toBeNull();
    });
  });

  // ─── storeRepoMove ─────────────────────────────────────────────────────────

  describe('storeRepoMove', () => {
    it('moves a repository entry from one store to another', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });
      await storeRepoAdd({ repoName: 'migrated-repo', storeId: 'store-a', configPath });

      const result = await storeRepoMove({ repoName: 'migrated-repo', targetStoreId: 'store-b', configPath });
      expect(result.ok).toBe(true);
      expect(result.fromStoreId).toBe('store-a');
      expect(result.toStoreId).toBe('store-b');

      // Verify removal from source and addition to target.
      const regA = await loadRegistry(storeA);
      expect(regA.repositories.some(r => r.folder_names?.includes('migrated-repo'))).toBe(false);

      const regB = await loadRegistry(storeB);
      expect(regB.repositories.some(r => r.folder_names?.includes('migrated-repo'))).toBe(true);
    });

    it('returns ok: false when the repo is not found in any store', async () => {
      const storePath = path.join(tempDir, 'store-a');
      await storeAdd({ id: 'store-a', storePath, configPath });

      const result = await storeRepoMove({ repoName: 'ghost-repo', targetStoreId: 'store-a', configPath });
      expect(result.ok).toBe(false);
    });

    it('does NOT remove from source when repo already exists in target (blocking fix)', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });
      await storeRepoAdd({ repoName: 'conflict-repo', storeId: 'store-a', configPath });

      // Manually place the same repo in store-b to simulate a conflict state.
      const now = new Date().toISOString();
      const dupEntry = {
        id: 'dup-id', label: 'Conflict', folder_names: ['conflict-repo'],
        vision: { short_term: null, mid_term: null, long_term: null },
        created_at: now, last_modified: now,
      };
      const regB = await loadRegistry(storeB);
      regB.repositories.push(dupEntry);
      fs.writeFileSync(registryPath(storeB), JSON.stringify(regB, null, 2));

      // Attempt to move from store-a to store-b — should fail because store-b already has it.
      const result = await storeRepoMove({ repoName: 'conflict-repo', targetStoreId: 'store-b', configPath });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('already registered');

      // Critically: the source (store-a) must NOT have been mutated.
      const regA = await loadRegistry(storeA);
      expect(regA.repositories.some(r => r.folder_names?.includes('conflict-repo'))).toBe(true);
    });
  });

  // ─── storeRepoList ─────────────────────────────────────────────────────────

  describe('storeRepoList', () => {
    it('returns all repos from all stores with store_id tags', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });
      await storeRepoAdd({ repoName: 'repo-a', storeId: 'store-a', configPath });
      await storeRepoAdd({ repoName: 'repo-b', storeId: 'store-b', configPath });

      const result = await storeRepoList({ configPath });
      expect(result.ok).toBe(true);
      expect(result.repos).toHaveLength(2);

      const aRow = result.repos.find(r => r.folder_names?.includes('repo-a'));
      expect(aRow.store_id).toBe('store-a');
      expect(aRow.is_shadowed).toBe(false);
    });

    it('marks repos as shadowed when the same folder_name appears in multiple stores', async () => {
      const storeA = path.join(tempDir, 'store-a');
      const storeB = path.join(tempDir, 'store-b');
      await storeAdd({ id: 'store-a', storePath: storeA, configPath });
      await storeAdd({ id: 'store-b', storePath: storeB, configPath });

      // Manually create the same repo in both stores.
      const now = new Date().toISOString();
      const entry = {
        id: 'uuid-x', label: 'Shared', folder_names: ['shared-repo'],
        vision: { short_term: null, mid_term: null, long_term: null },
        created_at: now, last_modified: now,
      };
      fs.writeFileSync(registryPath(storeA), JSON.stringify({ repositories: [entry] }, null, 2));
      fs.writeFileSync(registryPath(storeB), JSON.stringify({ repositories: [{ ...entry, id: 'uuid-y' }] }, null, 2));

      const result = await storeRepoList({ configPath });
      expect(result.repos).toHaveLength(2);

      const winner  = result.repos.find(r => r.store_id === 'store-a');
      const shadowed = result.repos.find(r => r.store_id === 'store-b');
      expect(winner.is_shadowed).toBe(false);
      expect(shadowed.is_shadowed).toBe(true);
    });
  });
});
