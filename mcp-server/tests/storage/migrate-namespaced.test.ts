import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateToNamespacedLayout } from '../../src/storage/migrate-namespaced.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeFlatProject(
  ledgerRoot: string,
  slug: string,
  repositoryName?: string | null
): Promise<void> {
  const projectDir = join(ledgerRoot, slug);
  await mkdir(projectDir, { recursive: true });

  const meta: Record<string, unknown> = { slug, plan_path: `/some/path/${slug}` };
  if (repositoryName !== undefined) {
    meta['repository_name'] = repositoryName;
  }
  await writeFile(join(projectDir, '.meta.json'), JSON.stringify(meta), 'utf-8');
  // Also add a stub ledger file so we can verify content was moved
  await writeFile(join(projectDir, 'project-ledger.json'), JSON.stringify({ slug }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('migrateToNamespacedLayout', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'migrate-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('migrates flat-layout projects to repo-namespaced directories', async () => {
    await makeFlatProject(ledgerRoot, '2026-01-01-alpha', 'my-repo');
    await makeFlatProject(ledgerRoot, '2026-02-01-beta', 'my-repo');

    const result = await migrateToNamespacedLayout(ledgerRoot);

    expect(result.skipped).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.moved).toHaveLength(2);
    expect(result.moved).toContain('my-repo/2026-01-01-alpha');
    expect(result.moved).toContain('my-repo/2026-02-01-beta');

    // Verify directories are at new locations
    const contentAlpha = await readFile(
      join(ledgerRoot, 'my-repo', '2026-01-01-alpha', 'project-ledger.json'),
      'utf-8'
    );
    expect(JSON.parse(contentAlpha).slug).toBe('2026-01-01-alpha');

    const contentBeta = await readFile(
      join(ledgerRoot, 'my-repo', '2026-02-01-beta', 'project-ledger.json'),
      'utf-8'
    );
    expect(JSON.parse(contentBeta).slug).toBe('2026-02-01-beta');
  });

  it('falls back to unknown/ when repository_name is absent', async () => {
    // No repository_name key at all
    await makeFlatProject(ledgerRoot, '2026-03-01-no-repo');

    const result = await migrateToNamespacedLayout(ledgerRoot);

    expect(result.skipped).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.moved).toContain('unknown/2026-03-01-no-repo');

    const content = await readFile(
      join(ledgerRoot, 'unknown', '2026-03-01-no-repo', 'project-ledger.json'),
      'utf-8'
    );
    expect(JSON.parse(content).slug).toBe('2026-03-01-no-repo');
  });

  it('falls back to unknown/ when repository_name is null', async () => {
    await makeFlatProject(ledgerRoot, '2026-03-02-null-repo', null);

    const result = await migrateToNamespacedLayout(ledgerRoot);

    expect(result.moved).toContain('unknown/2026-03-02-null-repo');
  });

  it('falls back to unknown/ when repository_name is empty string', async () => {
    await makeFlatProject(ledgerRoot, '2026-03-03-empty-repo', '');

    const result = await migrateToNamespacedLayout(ledgerRoot);

    expect(result.moved).toContain('unknown/2026-03-03-empty-repo');
  });

  it('is idempotent: second call skips when storage_version >= 2', async () => {
    await makeFlatProject(ledgerRoot, '2026-04-01-gamma', 'acme');

    const first = await migrateToNamespacedLayout(ledgerRoot);
    expect(first.skipped).toBe(false);
    expect(first.moved).toHaveLength(1);

    const second = await migrateToNamespacedLayout(ledgerRoot);
    expect(second.skipped).toBe(true);
    expect(second.moved).toHaveLength(0);
    expect(second.errors).toHaveLength(0);
  });

  it('writes .migration-state.json with storage_version: 2 after a successful run', async () => {
    await makeFlatProject(ledgerRoot, '2026-05-01-delta', 'org');

    await migrateToNamespacedLayout(ledgerRoot);

    const state = JSON.parse(
      await readFile(join(ledgerRoot, '.migration-state.json'), 'utf-8')
    ) as { storage_version: number };
    expect(state.storage_version).toBe(2);
  });

  it('removes the sentinel file after a successful run', async () => {
    await makeFlatProject(ledgerRoot, '2026-05-02-epsilon', 'org');

    await migrateToNamespacedLayout(ledgerRoot);

    await expect(
      readFile(join(ledgerRoot, '.migration-in-progress'), 'utf-8')
    ).rejects.toThrow();
  });

  it('skips depth-1 dirs that lack .meta.json (already-namespaced dirs)', async () => {
    // Simulate an already-migrated ledger: only namespace dirs exist at depth-1
    await mkdir(join(ledgerRoot, 'my-repo', '2026-06-01-already-moved'), { recursive: true });
    await writeFile(
      join(ledgerRoot, 'my-repo', '2026-06-01-already-moved', '.meta.json'),
      JSON.stringify({ slug: '2026-06-01-already-moved' }),
      'utf-8'
    );

    const result = await migrateToNamespacedLayout(ledgerRoot);

    // No flat-layout projects found — nothing to move
    expect(result.skipped).toBe(false);
    expect(result.moved).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('leaves original directory untouched and skips state write when a move fails', async () => {
    await makeFlatProject(ledgerRoot, '2026-07-01-will-fail', 'my-repo');
    await makeFlatProject(ledgerRoot, '2026-07-02-ok', 'my-repo');

    // Place a regular FILE at the would-be target path to cause rename to fail
    // (rename(dir, file) fails with ENOTDIR/EEXIST on POSIX).
    await mkdir(join(ledgerRoot, 'my-repo'), { recursive: true });
    await writeFile(join(ledgerRoot, 'my-repo', '2026-07-01-will-fail'), 'blocker', 'utf-8');

    const result = await migrateToNamespacedLayout(ledgerRoot);

    // One error, one successful move
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.slug).toBe('2026-07-01-will-fail');
    expect(result.moved).toContain('my-repo/2026-07-02-ok');

    // Original flat dir for the failed project must still exist
    const originalMeta = await readFile(
      join(ledgerRoot, '2026-07-01-will-fail', '.meta.json'),
      'utf-8'
    );
    expect(JSON.parse(originalMeta).slug).toBe('2026-07-01-will-fail');

    // storage_version must NOT have been written
    await expect(
      readFile(join(ledgerRoot, '.migration-state.json'), 'utf-8')
    ).rejects.toThrow();
  });

  it('resumes correctly after a partial migration (sentinel present from prior crash)', async () => {
    await makeFlatProject(ledgerRoot, '2026-08-01-project-a', 'resumable');
    await makeFlatProject(ledgerRoot, '2026-08-02-project-b', 'resumable');

    // Simulate crash: manually move project-a (as if partially done) and leave sentinel
    await mkdir(join(ledgerRoot, 'resumable', '2026-08-01-project-a'), { recursive: true });
    await writeFile(
      join(ledgerRoot, 'resumable', '2026-08-01-project-a', '.meta.json'),
      JSON.stringify({ slug: '2026-08-01-project-a' }),
      'utf-8'
    );
    // Remove the old flat dir for project-a to simulate completed move
    await rm(join(ledgerRoot, '2026-08-01-project-a'), { recursive: true });
    // Leave sentinel file
    await writeFile(join(ledgerRoot, '.migration-in-progress'), 'crash at 2026-08-01T00:00:00Z', 'utf-8');

    const result = await migrateToNamespacedLayout(ledgerRoot);

    expect(result.skipped).toBe(false);
    expect(result.errors).toHaveLength(0);
    // Only project-b needed moving (project-a target already existed)
    expect(result.moved).toContain('resumable/2026-08-02-project-b');
    expect(result.moved).not.toContain('resumable/2026-08-01-project-a');

    // Both now at namespaced paths
    await expect(
      readFile(join(ledgerRoot, 'resumable', '2026-08-02-project-b', '.meta.json'), 'utf-8')
    ).resolves.toBeDefined();
  });
});
