import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadRegistry,
  saveRegistry,
  findByFolderName,
  getAllFolderNames,
} from '../../src/storage/repository-registry.js';
import type { RepositoryRegistry, RepositoryEntry } from '../../src/schema/repository-registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<RepositoryEntry> = {}): RepositoryEntry {
  return {
    id: 'my-repo',
    label: 'My Repository',
    folder_names: ['my-repo'],
    vision: {
      short_term: null,
      mid_term: null,
      long_term: null,
    },
    created_at: '2026-06-01T00:00:00Z',
    last_modified: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeRegistry(overrides: Partial<RepositoryRegistry> = {}): RepositoryRegistry {
  return {
    repositories: [],
    ...overrides,
  };
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('repository-registry storage module', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'repo-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ─── loadRegistry ──────────────────────────────────────────────────────

  describe('loadRegistry', () => {
    it('returns { repositories: [] } when .repositories.json does not exist', async () => {
      const result = await loadRegistry(tempLedgerRoot);
      expect(result).toEqual({ repositories: [] });
    });

    it('does not throw when the file does not exist', async () => {
      await expect(loadRegistry(tempLedgerRoot)).resolves.not.toThrow();
    });

    it('correctly parses a valid .repositories.json file and returns typed RepositoryRegistry', async () => {
      const entry = makeEntry({
        id: 'acme-web',
        label: 'Acme Web App',
        folder_names: ['acme-web', 'acme'],
        vision: {
          short_term: 'Ship MVP',
          mid_term: 'Expand feature set',
          long_term: null,
        },
      });
      const registry: RepositoryRegistry = { repositories: [entry] };
      await writeFile(
        join(tempLedgerRoot, '.repositories.json'),
        JSON.stringify(registry, null, 2) + '\n',
        'utf-8'
      );

      const result = await loadRegistry(tempLedgerRoot);
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].id).toBe('acme-web');
      expect(result.repositories[0].label).toBe('Acme Web App');
      expect(result.repositories[0].folder_names).toEqual(['acme-web', 'acme']);
      expect(result.repositories[0].vision.short_term).toBe('Ship MVP');
      expect(result.repositories[0].vision.long_term).toBeNull();
    });

    it('returns { repositories: [] } when the file contains malformed JSON', async () => {
      await writeFile(
        join(tempLedgerRoot, '.repositories.json'),
        '{ invalid json !!!',
        'utf-8'
      );

      const result = await loadRegistry(tempLedgerRoot);
      expect(result).toEqual({ repositories: [] });
    });

    it('returns { repositories: [] } when the file fails schema validation', async () => {
      await writeFile(
        join(tempLedgerRoot, '.repositories.json'),
        JSON.stringify({ repositories: [{ id: '!!invalid-slug!!', label: '' }] }),
        'utf-8'
      );

      const result = await loadRegistry(tempLedgerRoot);
      expect(result).toEqual({ repositories: [] });
    });

    it('parses a registry with an empty repositories array', async () => {
      const registry: RepositoryRegistry = { repositories: [] };
      await writeFile(
        join(tempLedgerRoot, '.repositories.json'),
        JSON.stringify(registry),
        'utf-8'
      );

      const result = await loadRegistry(tempLedgerRoot);
      expect(result).toEqual({ repositories: [] });
    });

    it('parses a registry with multiple entries', async () => {
      const registry: RepositoryRegistry = {
        repositories: [
          makeEntry({ id: 'repo-a', label: 'Repo A', folder_names: ['a'] }),
          makeEntry({ id: 'repo-b', label: 'Repo B', folder_names: ['b'] }),
        ],
      };
      await writeFile(
        join(tempLedgerRoot, '.repositories.json'),
        JSON.stringify(registry),
        'utf-8'
      );

      const result = await loadRegistry(tempLedgerRoot);
      expect(result.repositories).toHaveLength(2);
      expect(result.repositories[0].id).toBe('repo-a');
      expect(result.repositories[1].id).toBe('repo-b');
    });
  });

  // ─── saveRegistry ──────────────────────────────────────────────────────

  describe('saveRegistry', () => {
    it('writes the registry atomically — file is present after save', async () => {
      const registry = makeRegistry({
        repositories: [makeEntry({ id: 'saved-repo', folder_names: ['saved'] })],
      });

      await saveRegistry(tempLedgerRoot, registry);

      const content = await readFile(
        join(tempLedgerRoot, '.repositories.json'),
        'utf-8'
      );
      const parsed = JSON.parse(content);
      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.repositories[0].id).toBe('saved-repo');
    });

    it('round-trips through loadRegistry after saveRegistry', async () => {
      const entry = makeEntry({
        id: 'round-trip',
        label: 'Round Trip Repo',
        folder_names: ['rt', 'round-trip'],
        vision: { short_term: 'Q1 goal', mid_term: null, long_term: null },
      });
      const registry: RepositoryRegistry = { repositories: [entry] };

      await saveRegistry(tempLedgerRoot, registry);
      const loaded = await loadRegistry(tempLedgerRoot);

      expect(loaded.repositories).toHaveLength(1);
      expect(loaded.repositories[0].id).toBe('round-trip');
      expect(loaded.repositories[0].folder_names).toEqual(['rt', 'round-trip']);
      expect(loaded.repositories[0].vision.short_term).toBe('Q1 goal');
    });

    it('writes the registry atomically — no partial writes corrupt the file', async () => {
      // Write an initial valid registry
      const initial: RepositoryRegistry = {
        repositories: [makeEntry({ id: 'initial', folder_names: ['init'] })],
      };
      await saveRegistry(tempLedgerRoot, initial);

      // Overwrite with updated registry — atomic write ensures reader always
      // sees either the old or the new complete file, never a partial write
      const updated: RepositoryRegistry = {
        repositories: [
          makeEntry({ id: 'initial', folder_names: ['init'] }),
          makeEntry({ id: 'added-later', folder_names: ['added'] }),
        ],
      };
      await saveRegistry(tempLedgerRoot, updated);

      // After the second save, the file must be a valid, complete registry
      const content = await readFile(
        join(tempLedgerRoot, '.repositories.json'),
        'utf-8'
      );
      const parsed: RepositoryRegistry = JSON.parse(content);
      expect(parsed.repositories).toHaveLength(2);
      expect(parsed.repositories[1].id).toBe('added-later');
    });

    it('creates the ledgerRoot directory if it does not exist', async () => {
      const nestedRoot = join(tempLedgerRoot, 'nested', 'root');
      const registry = makeRegistry();

      // Should not throw even though nestedRoot does not exist yet
      await saveRegistry(nestedRoot, registry);

      const content = await readFile(
        join(nestedRoot, '.repositories.json'),
        'utf-8'
      );
      expect(JSON.parse(content)).toEqual({ repositories: [] });
    });

    it('throws when the registry fails schema validation', async () => {
      // Inject invalid data by bypassing TypeScript types
      const invalid = { repositories: [{ id: '!!bad slug!!' }] } as unknown as RepositoryRegistry;
      await expect(saveRegistry(tempLedgerRoot, invalid)).rejects.toThrow();
    });
  });

  // ─── findByFolderName ──────────────────────────────────────────────────

  describe('findByFolderName', () => {
    it('returns the correct entry when the folder name is the only name in the array', () => {
      const entry = makeEntry({ id: 'single', folder_names: ['single-folder'] });
      const registry = makeRegistry({ repositories: [entry] });

      expect(findByFolderName(registry, 'single-folder')).toEqual(entry);
    });

    it('returns the correct entry when the folder name appears in the first position', () => {
      const entry = makeEntry({ id: 'multi', folder_names: ['first', 'second', 'third'] });
      const registry = makeRegistry({ repositories: [entry] });

      expect(findByFolderName(registry, 'first')).toEqual(entry);
    });

    it('returns the correct entry when the folder name appears in a middle position', () => {
      const entry = makeEntry({ id: 'multi', folder_names: ['first', 'second', 'third'] });
      const registry = makeRegistry({ repositories: [entry] });

      expect(findByFolderName(registry, 'second')).toEqual(entry);
    });

    it('returns the correct entry when the folder name appears in the last position', () => {
      const entry = makeEntry({ id: 'multi', folder_names: ['first', 'second', 'third'] });
      const registry = makeRegistry({ repositories: [entry] });

      expect(findByFolderName(registry, 'third')).toEqual(entry);
    });

    it('returns null when no entry folder_names contains the given name', () => {
      const registry = makeRegistry({
        repositories: [
          makeEntry({ id: 'repo-a', folder_names: ['aaa'] }),
          makeEntry({ id: 'repo-b', folder_names: ['bbb'] }),
        ],
      });

      expect(findByFolderName(registry, 'not-here')).toBeNull();
    });

    it('returns null for an empty registry', () => {
      const registry = makeRegistry({ repositories: [] });
      expect(findByFolderName(registry, 'anything')).toBeNull();
    });

    it('returns the first matching entry when multiple entries share a folder name (degenerate case)', () => {
      // Duplicate folder names should not occur in practice, but the function
      // must not crash — it returns the first match.
      const entryA = makeEntry({ id: 'repo-a', folder_names: ['shared', 'unique-a'] });
      const entryB = makeEntry({ id: 'repo-b', folder_names: ['shared', 'unique-b'] });
      const registry = makeRegistry({ repositories: [entryA, entryB] });

      const result = findByFolderName(registry, 'shared');
      expect(result?.id).toBe('repo-a');
    });

    it('performs case-sensitive matching', () => {
      const entry = makeEntry({ id: 'case-repo', folder_names: ['MyRepo'] });
      const registry = makeRegistry({ repositories: [entry] });

      expect(findByFolderName(registry, 'myrepo')).toBeNull();
      expect(findByFolderName(registry, 'MYREPO')).toBeNull();
      expect(findByFolderName(registry, 'MyRepo')).toEqual(entry);
    });
  });

  // ─── getAllFolderNames ─────────────────────────────────────────────────

  describe('getAllFolderNames', () => {
    it('returns all folder names for an entry with a single folder name', () => {
      const entry = makeEntry({ folder_names: ['only-folder'] });
      expect(getAllFolderNames(entry)).toEqual(['only-folder']);
    });

    it('returns all folder names for an entry with multiple folder names', () => {
      const entry = makeEntry({ folder_names: ['alpha', 'beta', 'gamma'] });
      expect(getAllFolderNames(entry)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('returns a copy — mutating the result does not affect the entry', () => {
      const entry = makeEntry({ folder_names: ['original'] });
      const names = getAllFolderNames(entry);
      names.push('injected');

      expect(entry.folder_names).toEqual(['original']);
    });
  });
});
