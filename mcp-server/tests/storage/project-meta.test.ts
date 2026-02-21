import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import { now } from '../../src/utils/timestamp.js';

// Fixed plan path with valid YYYY-MM-DD slug; tempLedgerRoot is used as the ledger root.
const PLAN_PATH = join(tmpdir(), '2026-01-15-meta-test');

function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
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

describe('ProjectMeta — writeProjectMeta / readProjectMeta', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'meta-test-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('writeProjectMeta creates a valid .meta.json with correct fields on first write', async () => {
    await store.writeProjectMeta('plan.md', 'IN_PROGRESS');

    const meta = await store.readProjectMeta();
    expect(meta.slug).toBe('2026-01-15-meta-test');
    expect(meta.plan_path).toBe(PLAN_PATH);
    expect(meta.status).toBe('IN_PROGRESS');
    expect(typeof meta.date_created).toBe('string');
    expect(typeof meta.last_updated).toBe('string');
  });

  it('writeProjectMeta updates status and last_updated on subsequent call', async () => {
    await store.writeProjectMeta('plan.md', 'IN_PROGRESS');
    const first = await store.readProjectMeta();

    // Small delay ensures timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    await store.writeProjectMeta('', 'COMPLETE');
    const second = await store.readProjectMeta();

    expect(second.status).toBe('COMPLETE');
    expect(second.date_created).toBe(first.date_created); // preserved
    expect(second.slug).toBe(first.slug);                 // preserved
    expect(second.plan_path).toBe(first.plan_path);       // preserved
  });

  it('readProjectMeta returns validated ProjectMeta', async () => {
    await store.writeProjectMeta('plan.md', 'READY');
    const meta = await store.readProjectMeta();

    expect(meta).toMatchObject({
      slug: '2026-01-15-meta-test',
      plan_path: PLAN_PATH,
      status: 'READY',
    });
    expect(meta.date_created).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(meta.last_updated).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('readProjectMeta throws when .meta.json is missing', async () => {
    await expect(store.readProjectMeta()).rejects.toThrow('Project meta not found');
  });

  it('readProjectMeta throws on malformed JSON', async () => {
    await mkdir(store.storageDir, { recursive: true });
    await writeFile(store.metaPath(), '{ bad json ???', 'utf-8');
    await expect(store.readProjectMeta()).rejects.toThrow('Malformed JSON');
  });

  it('readProjectMeta throws on schema validation failure', async () => {
    await mkdir(store.storageDir, { recursive: true });
    await atomicWriteJson(store.metaPath(), { slug: 'x', status: 'INVALID_STATUS' });
    await expect(store.readProjectMeta()).rejects.toThrow('validation failed');
  });

  it('writeRootIndex auto-syncs .meta.json', async () => {
    await store.writeRootIndex(makeRootIndex({ status: 'READY' }));
    const meta = await store.readProjectMeta();
    expect(meta.slug).toBe('2026-01-15-meta-test');
    expect(meta.status).toBe('READY');
  });

  it('updateWorkPackageWithSync auto-syncs .meta.json status', async () => {
    await store.writeRootIndex(makeRootIndex({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [{
        work_package_id: 'WP-001',
        status: 'IN_PROGRESS',
        assigned_to: 'Developer',
        dependencies: [],
        file: 'ledger/WP-001.json',
      }],
    }));
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 1,
      pipelines: [],
    });

    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.status = 'COMPLETE';
      root.status = 'COMPLETE';
      root.pending_work_packages = 0;
      const summary = root.work_packages.find((s) => s.work_package_id === 'WP-001');
      if (summary) summary.status = 'COMPLETE';
      return { wp, root };
    });

    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('COMPLETE');
  });
});

describe('LedgerStore.listAllProjects', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'list-projects-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  async function createProjectMeta(
    slug: string,
    status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED'
  ): Promise<void> {
    const projectDir = join(tempLedgerRoot, slug);
    await mkdir(projectDir, { recursive: true });
    await atomicWriteJson(join(projectDir, '.meta.json'), {
      slug,
      plan_path: join('/tmp', slug),
      status,
      date_created: now(),
      last_updated: now(),
    });
  }

  it('returns all projects from multiple subdirectories', async () => {
    await createProjectMeta('2026-01-01-project-a', 'IN_PROGRESS');
    await createProjectMeta('2026-02-01-project-b', 'READY');
    await createProjectMeta('2026-03-01-project-c', 'COMPLETE');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    expect(projects).toHaveLength(3);
    const slugs = projects.map((p) => p.slug).sort();
    expect(slugs).toEqual([
      '2026-01-01-project-a',
      '2026-02-01-project-b',
      '2026-03-01-project-c',
    ]);
  });

  it('excludes .archive/ subdirectory', async () => {
    await createProjectMeta('2026-01-01-active', 'IN_PROGRESS');

    // Create an .archive/ subdirectory with a project inside
    const archiveDir = join(tempLedgerRoot, '.archive', '2026-01-01-archived');
    await mkdir(archiveDir, { recursive: true });
    await atomicWriteJson(join(join(tempLedgerRoot, '.archive'), '.meta.json'), {
      slug: '.archive',
      plan_path: '/tmp/.archive',
      status: 'COMPLETE' as const,
      date_created: now(),
      last_updated: now(),
    });

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    const slugs = projects.map((p) => p.slug);
    expect(slugs).not.toContain('.archive');
    expect(slugs).toContain('2026-01-01-active');
  });

  it('skips subdirectories with no .meta.json without throwing', async () => {
    await createProjectMeta('2026-01-01-has-meta', 'IN_PROGRESS');

    // Create a directory with no .meta.json
    await mkdir(join(tempLedgerRoot, '2026-02-01-no-meta'), { recursive: true });

    // Should not throw; just skip the entry without .meta.json
    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    expect(projects).toHaveLength(1);
    expect(projects[0].slug).toBe('2026-01-01-has-meta');
  });

  it('skips subdirectories with invalid (malformed) .meta.json without throwing', async () => {
    await createProjectMeta('2026-01-01-valid', 'IN_PROGRESS');

    const badDir = join(tempLedgerRoot, '2026-02-01-invalid');
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, '.meta.json'), '{ bad json', 'utf-8');

    const projects = await LedgerStore.listAllProjects(tempLedgerRoot);
    expect(projects).toHaveLength(1);
    expect(projects[0].slug).toBe('2026-01-01-valid');
  });

  it('returns an empty array when the ledger root does not exist', async () => {
    const nonExistentRoot = join(tempLedgerRoot, 'does-not-exist');
    const projects = await LedgerStore.listAllProjects(nonExistentRoot);
    expect(projects).toEqual([]);
  });

  it('status filter works as applied by the tool handler', async () => {
    await createProjectMeta('2026-01-01-in-progress', 'IN_PROGRESS');
    await createProjectMeta('2026-02-01-ready', 'READY');
    await createProjectMeta('2026-03-01-complete', 'COMPLETE');

    // Simulate tool-handler-level filtering (as in listProjects())
    const all = await LedgerStore.listAllProjects(tempLedgerRoot);
    const filtered = all.filter((p) => p.status === 'IN_PROGRESS');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].slug).toBe('2026-01-01-in-progress');
  });
});
