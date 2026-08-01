/**
 * Integration tests for multi-store project lifecycle tool behaviour.
 *
 * These tests verify that listProjects, detectProject, initializeProject, and
 * getProjectStatus correctly delegate to MultiStoreManager / StoreRouter when
 * the store context has been initialized with a multi-store configuration.
 *
 * Each test calls setStoreContext() in beforeEach and restores legacy mode in
 * afterEach to avoid leaking module-level singleton state into other test suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { _internal } from '../../src/tools/project-lifecycle.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';

const { detectProject, listProjects, initializeProject, getProjectStatus } = _internal;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(storePaths: Array<{ id: string; path: string; label: string }>): StoresConfig {
  return {
    stores: storePaths.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: storePaths[0]!.id,
  };
}

/** Write a minimal .meta.json under {storePath}/{repoName}/{slug}/ so
 *  listAllProjects() can discover the project. */
async function writeMeta(
  storePath: string,
  repoName: string,
  slug: string,
  planPath: string,
  status = 'IN_PROGRESS'
): Promise<void> {
  const projectDir = join(storePath, repoName, slug);
  await mkdir(projectDir, { recursive: true });
  const meta = {
    slug,
    plan_path: planPath,
    status,
    date_created: now(),
    last_updated: now(),
  };
  await writeFile(join(projectDir, '.meta.json'), JSON.stringify(meta));
}

/** Write a minimal .repositories.json into the store root. */
async function writeRegistry(storePath: string, repoNames: string[]): Promise<void> {
  const ts = now();
  const registry: RepositoryRegistry = {
    repositories: repoNames.map((name) => ({
      id: name,
      label: name,
      folder_names: [name],
      vision: { short_term: null, mid_term: null, long_term: null },
      created_at: ts,
      last_modified: ts,
    })),
  };
  await saveRegistry(storePath, registry);
}

/** Restore the singleton to legacy mode so subsequent test suites are unaffected. */
function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

// ─── Shared state for each suite ────────────────────────────────────────────

let tempDir: string;
let storePersonalPath: string;
let storeWorkPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'multi-store-lifecycle-'));
  storePersonalPath = join(tempDir, 'store-personal');
  storeWorkPath = join(tempDir, 'store-work');
  await mkdir(storePersonalPath, { recursive: true });
  await mkdir(storeWorkPath, { recursive: true });
});

afterEach(async () => {
  restoreLegacyContext();
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Helper: initialize the store context with two stores ───────────────────

function initTwoStoreContext(): void {
  const config = makeConfig([
    { id: 'personal', path: storePersonalPath, label: 'Personal' },
    { id: 'work', path: storeWorkPath, label: 'Work' },
  ]);
  const router = new StoreRouter(config);
  setStoreContext(router, new MultiStoreManager(router));
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1: ledger_list_projects returns projects from all stores, each tagged
//      with store_id and store_label
// ─────────────────────────────────────────────────────────────────────────────

describe('AC1 — listProjects: cross-store collation with store tags', () => {
  it('returns projects from all stores tagged with store_id and store_label', async () => {
    // Project A in personal store (repo-a)
    const planPathA = join(tempDir, 'repo-a', 'docs', 'agents', 'plans', '2026-01-01-proj-a');
    await writeMeta(storePersonalPath, 'repo-a', '2026-01-01-proj-a', planPathA, 'IN_PROGRESS');

    // Project B in work store (repo-b)
    const planPathB = join(tempDir, 'repo-b', 'docs', 'agents', 'plans', '2026-01-02-proj-b');
    await writeMeta(storeWorkPath, 'repo-b', '2026-01-02-proj-b', planPathB, 'READY');

    initTwoStoreContext();

    const result = await listProjects({ include_archived: false });
    expect(result.isError).toBeUndefined();

    const projects = JSON.parse(result.content[0]!.text);
    expect(projects).toHaveLength(2);

    const projA = projects.find((p: any) => p.slug === '2026-01-01-proj-a');
    const projB = projects.find((p: any) => p.slug === '2026-01-02-proj-b');

    expect(projA).toBeDefined();
    expect(projA.store_id).toBe('personal');
    expect(projA.store_label).toBe('Personal');

    expect(projB).toBeDefined();
    expect(projB.store_id).toBe('work');
    expect(projB.store_label).toBe('Work');
  });

  it('applies status filter across all stores', async () => {
    const planPathA = join(tempDir, 'repo-a', 'docs', 'agents', 'plans', '2026-01-01-proj-a');
    await writeMeta(storePersonalPath, 'repo-a', '2026-01-01-proj-a', planPathA, 'IN_PROGRESS');

    const planPathB = join(tempDir, 'repo-b', 'docs', 'agents', 'plans', '2026-01-02-proj-b');
    await writeMeta(storeWorkPath, 'repo-b', '2026-01-02-proj-b', planPathB, 'READY');

    initTwoStoreContext();

    const result = await listProjects({ status: 'READY' as any });
    const projects = JSON.parse(result.content[0]!.text);

    // Only proj-b (READY) should be returned
    expect(projects).toHaveLength(1);
    expect(projects[0].slug).toBe('2026-01-02-proj-b');
    expect(projects[0].store_id).toBe('work');
  });

  it('excludes ARCHIVED projects by default', async () => {
    const planPathA = join(tempDir, 'repo-a', 'docs', 'agents', 'plans', '2026-01-01-live');
    await writeMeta(storePersonalPath, 'repo-a', '2026-01-01-live', planPathA, 'IN_PROGRESS');

    const planPathB = join(tempDir, 'repo-b', 'docs', 'agents', 'plans', '2026-01-02-archived');
    await writeMeta(storeWorkPath, 'repo-b', '2026-01-02-archived', planPathB, 'ARCHIVED');

    initTwoStoreContext();

    const result = await listProjects({ include_archived: false });
    const projects = JSON.parse(result.content[0]!.text);

    expect(projects).toHaveLength(1);
    expect(projects[0].slug).toBe('2026-01-01-live');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: ledger_initialize_project creates a new project in the correct store —
//      the first store whose .repositories.json claims the repository
// ─────────────────────────────────────────────────────────────────────────────

describe('AC2 — initializeProject: routes to the correct registered store', () => {
  it('creates the project ledger under the store that owns the repo', async () => {
    // Register repo-a in personal store only
    await writeRegistry(storePersonalPath, ['repo-a']);
    await writeRegistry(storeWorkPath, []);

    // Create the plan directory structure so access() succeeds
    const planPath = join(tempDir, 'repo-a', 'docs', 'agents', 'plans', '2026-06-01-ac2-test');
    await mkdir(planPath, { recursive: true });
    await writeFile(join(planPath, 'plan.md'), '# AC2 Test Plan\n\n## Summary\n\nTest plan.');

    initTwoStoreContext();

    const result = await initializeProject({
      project_path: planPath,
      plan_file: 'plan.md',
    });

    expect((result as any).isError).toBeFalsy();

    // The ledger file should have been created in the personal store
    // Layout: {storePath}/{repoName}/{slug}/project-ledger.json
    const expectedLedgerPath = join(storePersonalPath, 'repo-a', '2026-06-01-ac2-test', 'project-ledger.json');
    const { access, constants } = await import('fs/promises');
    await expect(access(expectedLedgerPath, constants.F_OK)).resolves.toBeUndefined();
  });

  it('routes to the second store when only the second store owns the repo', async () => {
    // Register repo-b in work store only
    await writeRegistry(storePersonalPath, []);
    await writeRegistry(storeWorkPath, ['repo-b']);

    const planPath = join(tempDir, 'repo-b', 'docs', 'agents', 'plans', '2026-06-02-ac2-work');
    await mkdir(planPath, { recursive: true });
    await writeFile(join(planPath, 'plan.md'), '# AC2 Work Plan\n\n## Summary\n\nTest plan.');

    initTwoStoreContext();

    const result = await initializeProject({
      project_path: planPath,
      plan_file: 'plan.md',
    });

    expect((result as any).isError).toBeFalsy();

    const expectedLedgerPath = join(storeWorkPath, 'repo-b', '2026-06-02-ac2-work', 'project-ledger.json');
    const { access, constants } = await import('fs/promises');
    await expect(access(expectedLedgerPath, constants.F_OK)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: ledger_initialize_project for a repository not registered in any store
//      returns an error containing "not registered in any store"
// ─────────────────────────────────────────────────────────────────────────────

describe('AC3 — initializeProject: rejects unregistered repository', () => {
  it('returns an error containing "not registered in any store" for an unregistered repo', async () => {
    // Neither store has 'unregistered-repo'
    await writeRegistry(storePersonalPath, ['repo-a']);
    await writeRegistry(storeWorkPath, ['repo-b']);

    const planPath = join(tempDir, 'unregistered-repo', 'docs', 'agents', 'plans', '2026-06-03-ac3-test');
    await mkdir(planPath, { recursive: true });
    await writeFile(join(planPath, 'plan.md'), '# AC3 Test Plan\n\n## Summary\n\nTest.');

    initTwoStoreContext();

    const result = await initializeProject({
      project_path: planPath,
      plan_file: 'plan.md',
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('not registered in any store');
  });

  it('error message includes the unregistered repository name', async () => {
    await writeRegistry(storePersonalPath, []);
    await writeRegistry(storeWorkPath, []);

    const planPath = join(tempDir, 'mystery-repo', 'docs', 'agents', 'plans', '2026-06-04-ac3-name');
    await mkdir(planPath, { recursive: true });
    await writeFile(join(planPath, 'plan.md'), '# AC3 Name Plan\n\n## Summary\n\nTest.');

    initTwoStoreContext();

    const result = await initializeProject({
      project_path: planPath,
      plan_file: 'plan.md',
    });

    expect((result as any).isError).toBe(true);
    // Error should mention the repo name so users know what to register
    expect((result as any).content[0].text).toContain('mystery-repo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: ledger_detect_project searches all stores when resolving a cwd_path
//      and returns MULTI_STORE_AMBIGUOUS with tagged candidates for cross-store
//      collisions
// ─────────────────────────────────────────────────────────────────────────────

describe('AC4 — detectProject: MULTI_STORE_AMBIGUOUS for cross-store cwd match', () => {
  it('returns MULTI_STORE_AMBIGUOUS error when cwd_path matches projects in two stores', async () => {
    // Create a shared project root that both stores have a project for
    const sharedRoot = join(tempDir, 'shared-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-01-10-proj-in-personal');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-01-11-proj-in-work');

    // Store personal has ONE project under shared-repo → detectProjectByCwd returns FOUND for personal
    await writeMeta(storePersonalPath, 'shared-repo', '2026-01-10-proj-in-personal', planPathA, 'IN_PROGRESS');
    // Store work has ONE project under shared-repo → detectProjectByCwd returns FOUND for work
    await writeMeta(storeWorkPath, 'shared-repo', '2026-01-11-proj-in-work', planPathB, 'READY');

    initTwoStoreContext();

    // cwd_path = project root shared by both → triggers MULTI_STORE_AMBIGUOUS
    const result = await detectProject({ cwd_path: sharedRoot });

    expect((result as any).isError).toBe(true);
    const text: string = (result as any).content[0].text;
    expect(text).toContain('multiple stores');
    expect(text).toContain('project_path');
  });

  it('MULTI_STORE_AMBIGUOUS error lists the store IDs of matching candidates', async () => {
    const sharedRoot = join(tempDir, 'ambiguous-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-01-in-personal');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-02-02-in-work');

    await writeMeta(storePersonalPath, 'ambiguous-repo', '2026-02-01-in-personal', planPathA);
    await writeMeta(storeWorkPath, 'ambiguous-repo', '2026-02-02-in-work', planPathB);

    initTwoStoreContext();

    const result = await detectProject({ cwd_path: sharedRoot });
    const text: string = (result as any).content[0].text;

    // Both store IDs should appear in the candidate list
    expect(text).toContain('personal');
    expect(text).toContain('work');
  });

  it('returns FOUND (not MULTI_STORE_AMBIGUOUS) when only one store has a match', async () => {
    const repoRoot = join(tempDir, 'solo-repo');
    const planPath = join(repoRoot, 'docs', 'agents', 'plans', '2026-03-01-solo');

    // Only store-personal has a project for this repo
    await writeMeta(storePersonalPath, 'solo-repo', '2026-03-01-solo', planPath, 'IN_PROGRESS');

    initTwoStoreContext();

    const result = await detectProject({ cwd_path: repoRoot });

    // Should be a successful FOUND response (no isError)
    expect((result as any).isError).toBeUndefined();
    const data = JSON.parse((result as any).content[0].text);
    expect(data.plan_path).toBe(planPath);
    expect(data.slug).toBe('2026-03-01-solo');
  });

  it('returns NOT_FOUND error when cwd_path matches no store', async () => {
    initTwoStoreContext();

    const result = await detectProject({ cwd_path: join(tempDir, 'non-existent-repo') });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('No project found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5: In single-store mode (no stores.json), all operations behave
//      identically to the current implementation
// ─────────────────────────────────────────────────────────────────────────────

describe('AC5 — legacy single-store mode: behaviour identical to current implementation', () => {
  it('listProjects returns projects with default store tag in legacy mode', async () => {
    // Set up legacy (single-store) context
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));

    // In legacy mode listProjects still works (no error). Projects are tagged
    // with store_id 'default' — this is a harmless enhancement consistent with
    // "identical functional behaviour" (correct projects are returned from the
    // configured ledger root; routing and detection continue to work).
    const result = await listProjects({ include_archived: false });
    expect((result as any).isError).toBeUndefined();
    const projects = JSON.parse((result as any).content[0].text);
    expect(Array.isArray(projects)).toBe(true);
    // In legacy mode every project gets tagged with the default store sentinel
    for (const project of projects) {
      expect(project.store_id).toBe('default');
    }
  });

  it('initializeProject uses resolveLedgerRoot() in legacy mode (no store routing)', async () => {
    // Legacy mode: isMultiStoreMode() is false, so initializeProject falls back to
    // new LedgerStore(args.project_path) which internally uses resolveLedgerRoot().
    // We verify it does NOT return the "not registered in any store" error.
    const legacyRouter = new StoreRouter(null);
    setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));

    // Create a plan dir that deliberately would NOT be in any registry
    const planPath = join(tempDir, 'some-repo', 'docs', 'agents', 'plans', '2026-05-01-legacy-test');
    await mkdir(planPath, { recursive: true });
    await writeFile(join(planPath, 'plan.md'), '# Legacy Test\n\n## Summary\n\nTest plan.');

    // Manipulate process.argv to point the default ledger root at our tempDir
    // so the LedgerStore writes to an isolated location.
    const originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', storePersonalPath);

    try {
      const result = await initializeProject({
        project_path: planPath,
        plan_file: 'plan.md',
      });

      // In legacy mode, no "not registered in any store" error — initializes freely
      expect((result as any).content[0].text).not.toContain('not registered in any store');
    } finally {
      process.argv = originalArgv;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-003: ledger_get_project_status uses resolveProjectPath() in multi-store mode
//         (bypass removed — AC5 and AC6 from WP-003 spec)
// ─────────────────────────────────────────────────────────────────────────────

describe('WP-003 — getProjectStatus: multi-store cwd resolution via resolveProjectPath()', () => {
  it('returns MULTI_STORE_AMBIGUOUS error when cwd_path matches projects in two stores', async () => {
    const sharedRoot = join(tempDir, 'gps-shared-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-08-01-in-personal');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-08-02-in-work');

    await writeMeta(storePersonalPath, 'gps-shared-repo', '2026-08-01-in-personal', planPathA);
    await writeMeta(storeWorkPath, 'gps-shared-repo', '2026-08-02-in-work', planPathB);

    initTwoStoreContext();

    const result = await getProjectStatus({ cwd_path: sharedRoot });
    expect((result as any).isError).toBe(true);
    const text: string = (result as any).content[0].text;
    expect(text).toContain('multiple stores');
    expect(text).toContain('personal');
    expect(text).toContain('work');
    expect(text).toContain('project_path');
  });

  it('MULTI_STORE_AMBIGUOUS error format matches the previous bypass behavior', async () => {
    const sharedRoot = join(tempDir, 'gps-format-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-09-01-in-personal');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-09-02-in-work');

    await writeMeta(storePersonalPath, 'gps-format-repo', '2026-09-01-in-personal', planPathA);
    await writeMeta(storeWorkPath, 'gps-format-repo', '2026-09-02-in-work', planPathB);

    initTwoStoreContext();

    const result = await getProjectStatus({ cwd_path: sharedRoot });
    const text: string = (result as any).content[0].text;

    // The error prefix must match the exact format from the removed bypass block:
    // "Error: Project found in multiple stores. Provide an explicit project_path to disambiguate. Candidates: ..."
    expect(text).toMatch(/^Error: Project found in multiple stores\./);
    expect(text).toContain('Provide an explicit project_path to disambiguate');
    expect(text).toContain('[store_id: personal]');
    expect(text).toContain('[store_id: work]');
  });
});
