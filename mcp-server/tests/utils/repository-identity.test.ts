/**
 * Tests for `src/utils/repository-identity.ts` (WP-010).
 *
 * Coverage:
 *   - Precedence order: explicit → declared → derived.
 *   - `source` field reports which tier applied.
 *   - A declared `repository_id` resolves even when the directory basename
 *     matches no `folder_names` entry (AC-14).
 *   - A declared `repository_id` matching no entry in any store errors,
 *     naming the id and the stores searched, with no fallback (AC-15).
 *   - An invalid declaration errors rather than falling back.
 *   - The derived tier matches `deriveRepoNameFromCwd()` for a bare
 *     workspace root (AC-01, AC-18b).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { resolveRepositoryIdentity } from '../../src/utils/repository-identity.js';
import { deriveRepoNameFromCwd } from '../../src/utils/ledger-root.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';

function makeEntry(id: string, folderNames: string[] = [id]): RepositoryEntry {
  return {
    id,
    label: id,
    folder_names: folderNames,
    vision: { short_term: null, mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  };
}

describe('resolveRepositoryIdentity', () => {
  let tempDir: string;
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    process.argv = originalArgv;
    // Restore legacy single-store mode so other test files aren't affected.
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
  });

  async function setLedgerRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), 'repo-identity-test-'));
    const ledgerRoot = join(tempDir, 'ledger');
    await mkdir(ledgerRoot, { recursive: true });
    process.argv = [...process.argv, '--ledger-dir', ledgerRoot];
    return ledgerRoot;
  }

  // ─── Explicit tier ────────────────────────────────────────────────────

  it('resolves the explicit tier when repository_name is provided, regardless of cwd_path', async () => {
    const result = await resolveRepositoryIdentity('/some/cwd', 'my-explicit-repo');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.identity.repositoryName).toBe('my-explicit-repo');
      expect(result.identity.source).toBe('explicit');
      expect(result.identity.declaration).toBeNull();
    }
  });

  it('errors when neither cwd_path nor repository_name is provided', async () => {
    const result = await resolveRepositoryIdentity(undefined, undefined);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/cwd_path|repository_name/i);
    }
  });

  // ─── Derived tier ─────────────────────────────────────────────────────

  it('resolves the derived tier for an undeclared project, matching deriveRepoNameFromCwd()', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'repo-identity-test-'));
    const projectRoot = join(tempDir, 'my-workspace-root');
    await mkdir(projectRoot, { recursive: true });

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.identity.source).toBe('derived');
      expect(result.identity.declaration).toBeNull();
      expect(result.identity.repositoryName).toBe(deriveRepoNameFromCwd(projectRoot));
    }
  });

  // ─── Declared tier ────────────────────────────────────────────────────

  it('resolves the declared tier by repository_id even when the directory basename matches no folder_names entry', async () => {
    const ledgerRoot = await setLedgerRoot();
    await saveRegistry(ledgerRoot, {
      repositories: [makeEntry('my-repo-id', ['some-other-folder-name'])],
    });

    const projectRoot = join(tempDir, 'a-completely-different-basename');
    await mkdir(join(projectRoot, '.ledger'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ledger', 'settings.json'),
      JSON.stringify({ schema_version: 1, repository_id: 'my-repo-id' }),
      'utf-8'
    );

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.identity.source).toBe('declared');
      expect(result.identity.repositoryName).toBe('my-repo-id');
      expect(result.identity.declaration).not.toBeNull();
      expect(result.identity.declaration!.entry.id).toBe('my-repo-id');
      expect(result.identity.declaration!.projectRoot).toBe(projectRoot);
    }
  });

  it('resolves the declared tier from a nested cwd_path beneath the declared project root', async () => {
    const ledgerRoot = await setLedgerRoot();
    await saveRegistry(ledgerRoot, { repositories: [makeEntry('my-repo-id')] });

    const projectRoot = join(tempDir, 'declared-project');
    await mkdir(join(projectRoot, '.ledger'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ledger', 'settings.json'),
      JSON.stringify({ schema_version: 1, repository_id: 'my-repo-id' }),
      'utf-8'
    );
    const nested = join(projectRoot, 'src', 'nested', 'dir');
    await mkdir(nested, { recursive: true });

    const result = await resolveRepositoryIdentity(nested, undefined);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.identity.source).toBe('declared');
      expect(result.identity.declaration!.projectRoot).toBe(projectRoot);
    }
  });

  it('errors, naming the id and store searched, when the declared repository_id matches no entry in any store', async () => {
    const ledgerRoot = await setLedgerRoot();
    await saveRegistry(ledgerRoot, { repositories: [] });

    const projectRoot = join(tempDir, 'declared-project');
    await mkdir(join(projectRoot, '.ledger'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ledger', 'settings.json'),
      JSON.stringify({ schema_version: 1, repository_id: 'ghost-repo' }),
      'utf-8'
    );

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('ghost-repo');
      expect(result.message).toContain(ledgerRoot);
      expect(result.message).not.toMatch(/fall ?back/i);
    }
  });

  it('does not fall back to the derived tier when the declared id is unresolvable', async () => {
    const ledgerRoot = await setLedgerRoot();
    await saveRegistry(ledgerRoot, { repositories: [] });

    const projectRoot = join(tempDir, 'declared-project');
    await mkdir(join(projectRoot, '.ledger'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ledger', 'settings.json'),
      JSON.stringify({ schema_version: 1, repository_id: 'ghost-repo' }),
      'utf-8'
    );

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    // Even though deriveRepoNameFromCwd(projectRoot) would succeed, the
    // declared tier's failure must not be masked by a silent fallback.
    expect(result.kind).toBe('error');
  });

  it('errors on an invalid declaration rather than silently falling back to the derived tier', async () => {
    await setLedgerRoot();

    const projectRoot = join(tempDir, 'malformed-project');
    await mkdir(join(projectRoot, '.ledger'), { recursive: true });
    await writeFile(join(projectRoot, '.ledger', 'settings.json'), '{ not valid json', 'utf-8');

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('.ledger');
    }
  });

  it('falls through to the derived tier for a project root with no .ledger/settings.json', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'repo-identity-test-'));
    const projectRoot = join(tempDir, 'plain-project');
    await mkdir(projectRoot, { recursive: true });

    const result = await resolveRepositoryIdentity(projectRoot, undefined);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.identity.source).toBe('derived');
    }
  });
});
