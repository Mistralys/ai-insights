/**
 * Verifies that the `.knowledge/` directory is not returned by LedgerStore.listAllProjects().
 *
 * The `.knowledge/` directory uses the dot-prefix convention that LedgerStore uses to
 * skip control directories (e.g., `.archive/`). This test confirms the convention
 * holds for the knowledge store directory so that knowledge data is never surfaced as
 * a project entry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { now } from '../../src/utils/timestamp.js';

describe('KnowledgeStore — excluded from listAllProjects', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'knowledge-exclusion-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  async function createProjectMeta(slug: string): Promise<void> {
    const projectDir = join(tempLedgerRoot, slug);
    await mkdir(projectDir, { recursive: true });
    await atomicWriteJson(join(projectDir, '.meta.json'), {
      slug,
      plan_path: join('/tmp', slug),
      status: 'IN_PROGRESS' as const,
      date_created: now(),
      last_updated: now(),
    });
  }

  it('.knowledge/ directory is not included in listAllProjects results', async () => {
    // Set up one real project
    await createProjectMeta('2026-05-28-real-project');

    // Write an insight to trigger .knowledge/ directory creation
    const manager = new KnowledgeStoreManager(tempLedgerRoot);
    await manager.addInsight({
      scope: 'global',
      title: 'Test insight',
      content: 'Content for test insight.',
      category: 'testing',
      tags: ['test'],
      source: 'WP-002',
      created_at: now(),
      confidence: 0.8,
    });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    const slugs = projects.map((p) => p.slug);

    // The real project must be listed
    expect(slugs).toContain('2026-05-28-real-project');

    // The .knowledge directory must NOT be listed
    expect(slugs).not.toContain('.knowledge');
  });

  it('.knowledge/ is excluded even without a .meta.json inside it', async () => {
    // Manually create .knowledge/ without a .meta.json
    await mkdir(join(tempLedgerRoot, '.knowledge'), { recursive: true });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    const slugs = projects.map((p) => p.slug);
    expect(slugs).not.toContain('.knowledge');
  });

  it('.knowledge/ with a .meta.json inside it is still excluded (dot-prefix rule)', async () => {
    // Even if someone manually adds a .meta.json inside .knowledge/, it must be excluded
    const knowledgeDir = join(tempLedgerRoot, '.knowledge');
    await mkdir(knowledgeDir, { recursive: true });
    await atomicWriteJson(join(knowledgeDir, '.meta.json'), {
      slug: '.knowledge',
      plan_path: join('/tmp', '.knowledge'),
      status: 'IN_PROGRESS' as const,
      date_created: now(),
      last_updated: now(),
    });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    const slugs = projects.map((p) => p.slug);
    expect(slugs).not.toContain('.knowledge');
  });

  it('other dot-prefixed directories are also excluded (convention check)', async () => {
    // Create a real project and a dot-prefixed directory
    await createProjectMeta('2026-05-28-legit-project');

    const dotDir = join(tempLedgerRoot, '.some-control-dir');
    await mkdir(dotDir, { recursive: true });
    await atomicWriteJson(join(dotDir, '.meta.json'), {
      slug: '.some-control-dir',
      plan_path: join('/tmp', '.some-control-dir'),
      status: 'READY' as const,
      date_created: now(),
      last_updated: now(),
    });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    const slugs = projects.map((p) => p.slug);

    expect(slugs).toContain('2026-05-28-legit-project');
    expect(slugs).not.toContain('.some-control-dir');
  });
});
