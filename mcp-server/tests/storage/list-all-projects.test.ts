/**
 * Tests for LedgerStore.listAllProjects() two-level namespace scan.
 *
 * Covers:
 *   - New namespaced layout: {ledgerRoot}/{repoName}/{slug}/
 *   - Old flat layout: {ledgerRoot}/{slug}/  (backward compat)
 *   - Mixed layouts in the same ledger root
 *   - Dot-prefixed entry filtering at both depth-1 and depth-2
 *   - Empty namespace directories
 *   - Same slug in different repo namespaces (the key collision-prevention use case)
 *   - detectProjectByCwd() continues to work via delegation to listAllProjects()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { now } from '../../src/utils/timestamp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a project in the OLD flat layout: {ledgerRoot}/{slug}/.meta.json
 */
async function createFlatProject(
  ledgerRoot: string,
  slug: string,
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' = 'IN_PROGRESS',
  projectRoot = '/home/user/flat-project'
): Promise<void> {
  const dir = join(ledgerRoot, slug);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(join(dir, '.meta.json'), {
    slug,
    plan_path: `${projectRoot}/docs/agents/plans/${slug}`,
    status,
    date_created: now(),
    last_updated: now(),
  });
}

/**
 * Creates a project in the NEW namespaced layout: {ledgerRoot}/{repoName}/{slug}/.meta.json
 */
async function createNamespacedProject(
  ledgerRoot: string,
  repoName: string,
  slug: string,
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' = 'IN_PROGRESS'
): Promise<void> {
  const dir = join(ledgerRoot, repoName, slug);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(join(dir, '.meta.json'), {
    slug,
    plan_path: `/home/user/${repoName}/docs/agents/plans/${slug}`,
    status,
    date_created: now(),
    last_updated: now(),
    repository_name: repoName,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LedgerStore.listAllProjects — two-level namespace scan', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'list-ns-test-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // AC1: New namespaced layout
  it('returns projects stored at {ledgerRoot}/{repoName}/{slug}/ (new namespaced layout)', async () => {
    await createNamespacedProject(tempLedgerRoot, 'repo-a', '2026-01-01-alpha');
    await createNamespacedProject(tempLedgerRoot, 'repo-a', '2026-02-01-beta');
    await createNamespacedProject(tempLedgerRoot, 'repo-b', '2026-03-01-gamma');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(3);
    const slugs = projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(['2026-01-01-alpha', '2026-02-01-beta', '2026-03-01-gamma']);
  });

  // AC2: Old flat layout (backward compat during migration window)
  it('returns projects stored at {ledgerRoot}/{slug}/ (old flat layout, backward compat)', async () => {
    await createFlatProject(tempLedgerRoot, '2026-01-01-flat-alpha');
    await createFlatProject(tempLedgerRoot, '2026-02-01-flat-beta');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(2);
    const slugs = projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(['2026-01-01-flat-alpha', '2026-02-01-flat-beta']);
  });

  // AC2: Mixed old flat and new namespaced layouts coexisting in the same root
  it('returns projects from both old flat and new namespaced layouts in the same ledger root', async () => {
    await createFlatProject(tempLedgerRoot, '2026-01-01-flat-legacy');
    await createNamespacedProject(tempLedgerRoot, 'my-repo', '2026-02-01-namespaced');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(2);
    const slugs = projects.map((p) => p.slug).sort();
    expect(slugs).toEqual(['2026-01-01-flat-legacy', '2026-02-01-namespaced']);
  });

  // AC3: Dot-prefixed entries skipped at depth 1
  it('skips dot-prefixed directories at depth 1 (.archive and similar)', async () => {
    await createNamespacedProject(tempLedgerRoot, 'my-repo', '2026-01-01-visible');

    // .archive directory at depth 1 — should never be treated as a project or namespace
    const archiveDir = join(tempLedgerRoot, '.archive');
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      join(archiveDir, '.meta.json'),
      JSON.stringify({
        slug: '.archive',
        plan_path: '/tmp/.archive',
        status: 'COMPLETE',
        date_created: now(),
        last_updated: now(),
      }),
      'utf-8'
    );

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.slug).toBe('2026-01-01-visible');
  });

  // AC3: Dot-prefixed entries skipped at depth 2 (within a namespace directory)
  it('skips dot-prefixed directories at depth 2 within a namespace', async () => {
    await createNamespacedProject(tempLedgerRoot, 'my-repo', '2026-01-01-valid');

    // A dot-prefixed project dir inside a namespace — should be skipped
    const dotProjectDir = join(tempLedgerRoot, 'my-repo', '.hidden-project');
    await mkdir(dotProjectDir, { recursive: true });
    await writeFile(
      join(dotProjectDir, '.meta.json'),
      JSON.stringify({
        slug: '.hidden-project',
        plan_path: '/tmp/.hidden-project',
        status: 'IN_PROGRESS',
        date_created: now(),
        last_updated: now(),
      }),
      'utf-8'
    );

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.slug).toBe('2026-01-01-valid');
  });

  // Empty namespace directory (depth-1 dir with no subdirectories at all)
  it('silently skips an empty namespace directory with no subdirectories', async () => {
    await createNamespacedProject(tempLedgerRoot, 'my-repo', '2026-01-01-alpha');
    await mkdir(join(tempLedgerRoot, 'empty-namespace'), { recursive: true });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.slug).toBe('2026-01-01-alpha');
  });

  // Namespace directory whose subdirectories have no valid .meta.json
  it('silently skips a namespace whose subdirectories have no valid .meta.json', async () => {
    await createNamespacedProject(tempLedgerRoot, 'my-repo', '2026-01-01-valid');
    // Add a slug directory with no .meta.json inside the namespace
    await mkdir(join(tempLedgerRoot, 'my-repo', '2026-02-01-no-meta'), { recursive: true });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.slug).toBe('2026-01-01-valid');
  });

  // Key collision-prevention use case: same slug in two different repo namespaces
  it('returns projects with the same slug from different repo namespaces without collision', async () => {
    await createNamespacedProject(tempLedgerRoot, 'repo-a', '2026-04-23-create-comtype');
    await createNamespacedProject(tempLedgerRoot, 'repo-b', '2026-04-23-create-comtype');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);

    expect(projects).toHaveLength(2);
    const repoNames = projects.map((p) => p.repository_name).sort();
    expect(repoNames).toEqual(['repo-a', 'repo-b']);
    // Both slugs are identical but from different namespaces
    expect(projects.every((p) => p.slug === '2026-04-23-create-comtype')).toBe(true);
  });

  // AC4: detectProjectByCwd() works correctly via delegation to listAllProjects()
  it('detectProjectByCwd() resolves a project stored in the namespaced layout', async () => {
    // plan_path follows {project-root}/docs/agents/plans/{slug} — 4 levels up = project-root.
    // Use tmpdir() so the path is a valid absolute path on the current platform.
    const projectRoot = join(tmpdir(), 'my-ns-project');
    const slug = '2026-05-01-detect-ns';
    const planPath = join(projectRoot, 'docs', 'agents', 'plans', slug);

    // Use LedgerStore constructor to write the meta at the correct namespaced path.
    // The constructor derives repoName from the plan path, so storageDir will be:
    // {tempLedgerRoot}/{repoName}/{slug}/
    const store = new LedgerStore(planPath, tempLedgerRoot);
    await store.writeProjectMeta('plan.md', 'IN_PROGRESS');

    // cwdPath is inside the project root
    const cwdPath = join(projectRoot, 'src', 'tools');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);

    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe(slug);
    }
  });

  // AC4: detectProjectByCwd() works correctly with old flat layout too (regression guard)
  it('detectProjectByCwd() resolves a project stored in the old flat layout', async () => {
    // Create a project in the old flat layout manually (bypassing LedgerStore constructor,
    // which now writes to the namespaced path)
    const projectRoot = join(tmpdir(), 'old-flat-project');
    const slug = '2026-01-15-flat-detect';
    const dir = join(tempLedgerRoot, slug);
    await mkdir(dir, { recursive: true });
    await atomicWriteJson(join(dir, '.meta.json'), {
      slug,
      plan_path: join(projectRoot, 'docs', 'agents', 'plans', slug),
      status: 'IN_PROGRESS',
      date_created: now(),
      last_updated: now(),
    });

    const cwdPath = join(projectRoot, 'src');
    const result = await LedgerStore.detectProjectByCwd(cwdPath, tempLedgerRoot);

    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') {
      expect(result.meta.slug).toBe(slug);
    }
  });
});
