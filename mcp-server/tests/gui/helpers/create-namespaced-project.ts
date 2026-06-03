/**
 * Shared test fixture factory: createNamespacedProject
 *
 * ## Purpose
 * Provides a reusable factory that creates a properly structured namespaced
 * project fixture for GUI tests, ensuring tests use the two-level
 * `{ledgerRoot}/{repo}/{slug}/` storage layout rather than the legacy flat
 * `{ledgerRoot}/{slug}/` form.
 *
 * ## planPath constraint
 * The `LedgerStore` derives the repository namespace from the plan folder path
 * by walking four directory levels up (`{project-root}/docs/agents/plans/{slug}`).
 * This factory constructs a synthetic planPath of the form:
 *
 *   `{os.tmpdir()}/{tempDirPrefix}/{repo}/docs/agents/plans/{slug}`
 *
 * where `{slug}` **must** match the `YYYY-MM-DD-{name}` pattern enforced by
 * `planFolderBasename()`. For example:
 *
 *   slug = `'2026-01-15-my-feature'`  ✓
 *   slug = `'my-feature'`             ✗  (throws on LedgerStore construction)
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   createNamespacedProject,
 *   cleanupNamespacedProject,
 *   type NamespacedProjectHandle,
 * } from './helpers/create-namespaced-project.js';
 *
 * let handle: NamespacedProjectHandle;
 *
 * beforeEach(async () => {
 *   handle = await createNamespacedProject('my-repo', '2026-01-15-my-feature');
 * });
 *
 * afterEach(async () => {
 *   await cleanupNamespacedProject(handle);
 * });
 *
 * it('reads a project by (repo, slug)', async () => {
 *   const result = await handleGetProject(handle.ledgerRoot, handle.repo, handle.slug);
 *   expect(result.status).toBe('IN_PROGRESS');
 * });
 * ```
 *
 * ## Convention contract
 * Every GUI test that needs a namespaced project fixture MUST obtain the
 * `ledgerRoot` from this factory rather than constructing a bare `join(tmpdir(),
 * slug)` planPath. The latter produces an `'unknown'` repoName in LedgerStore
 * and breaks the two-level namespace layout required by namespaced API routes.
 */

import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../../src/storage/ledger-store.js';
import { now } from '../../../src/utils/timestamp.js';
import type { RootIndex } from '../../../src/schema/root-index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link createNamespacedProject}.
 * Carries all the identifiers needed to call API handlers and clean up
 * the temporary directory after the test.
 */
export interface NamespacedProjectHandle {
  /** Repository namespace (e.g. `'my-repo'`). */
  repo: string;
  /**
   * Plan folder slug, must match `YYYY-MM-DD-{name}`.
   * (e.g. `'2026-01-15-my-feature'`).
   */
  slug: string;
  /**
   * Absolute path to the temporary ledger root directory.
   * Pass this as the `ledgerRoot` argument to API handler calls in tests.
   *
   * Layout on disk:
   *   `{ledgerRoot}/{repo}/{slug}/project-ledger.json`
   *   `{ledgerRoot}/{repo}/{slug}/.meta.json`
   */
  ledgerRoot: string;
  /**
   * Synthetic plan folder path passed to LedgerStore.
   *
   * Follows the `{project-root}/docs/agents/plans/{slug}` convention so that
   * `deriveRepoName(planPath)` resolves to `repo`.
   *
   * The path does **not** need to exist on disk — it is a pure identifier.
   */
  planPath: string;
  /**
   * Pre-constructed LedgerStore for use in beforeEach / test body.
   *
   * > **Caution — shared in-memory state:** This `LedgerStore` instance is
   * > constructed once during fixture setup and shared with whatever reference
   * > the test body holds. If a test (or the code-under-test) mutates the
   * > store's in-memory cache before making assertions, those assertions may
   * > reflect the mutated state rather than the persisted on-disk data,
   * > producing false positives.
   * >
   * > For isolation-sensitive reads, construct a **fresh** `LedgerStore` from
   * > the handle's `planPath` and `ledgerRoot` rather than reusing this
   * > instance:
   * >
   * > ```ts
   * > const freshStore = new LedgerStore(handle.planPath, handle.ledgerRoot);
   * > const index = await freshStore.readRootIndex();
   * > ```
   */
  store: LedgerStore;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid RootIndex for use in fixture setup. */
function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  const ts = now();
  return {
    plan_file: 'plan.md',
    date_created: ts,
    last_updated: ts,
    status: 'IN_PROGRESS',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a namespaced project fixture in a fresh temporary `ledgerRoot`.
 *
 * The factory:
 *  1. Allocates a `mkdtemp` directory as the `ledgerRoot`.
 *  2. Constructs a synthetic `planPath` of the form
 *     `{ledgerRoot}/{repo}/docs/agents/plans/{slug}` so that
 *     `LedgerStore.repoName` resolves to `repo` and
 *     `LedgerStore.storageDir` resolves to `{ledgerRoot}/{repo}/{slug}/`.
 *  3. Writes a minimal `project-ledger.json` and `.meta.json` to disk via
 *     `LedgerStore.writeRootIndex()`.
 *  4. Returns a {@link NamespacedProjectHandle} for use in test assertions and
 *     cleanup.
 *
 * @param repo - Repository namespace key (e.g. `'my-repo'`). Must be a
 *   valid **lowercase** alphanumeric + hyphens string (the same format enforced
 *   by `assertSafeSegment`). Passing an uppercase value does **not** throw —
 *   it silently produces a lowercased `repoName` via `deriveRepoName`, which
 *   can cause subtle assertion mismatches. For example:
 *   `repo = 'MyRepo'` → `handle.store.repoName === 'myrepo'`.
 * @param slug - Plan folder slug, **must** match `YYYY-MM-DD-{name}`
 *   (e.g. `'2026-01-15-my-feature'`). LedgerStore enforces this pattern.
 * @param rootOverrides - Optional partial RootIndex fields to merge into the
 *   default fixture (e.g. to set `status`, `total_work_packages`, etc.).
 * @param prefix - Optional prefix for the temporary directory name.
 *   Defaults to `'ns-project-test-'`.
 * @returns A {@link NamespacedProjectHandle} containing all identifiers needed
 *   to call API handlers and clean up afterwards.
 */
export async function createNamespacedProject(
  repo: string,
  slug: string,
  rootOverrides: Partial<RootIndex> = {},
  prefix = 'ns-project-test-'
): Promise<NamespacedProjectHandle> {
  // 1. Allocate an isolated ledger root.
  const ledgerRoot = await mkdtemp(join(tmpdir(), prefix));

  // 2. Build a synthetic planPath that makes deriveRepoName() return `repo`.
  //    Convention: {project-root}/docs/agents/plans/{slug}
  //    We use {ledgerRoot}/{repo} as the synthetic project root so the path
  //    is self-contained within the temp directory.
  const planPath = join(ledgerRoot, repo, 'docs', 'agents', 'plans', slug);

  // 3. Construct LedgerStore — this resolves storageDir to
  //    {ledgerRoot}/{repo}/{slug}/ automatically via deriveRepoName().
  const store = new LedgerStore(planPath, ledgerRoot);

  // 4. Seed the fixture with a valid root index (and .meta.json side-effect).
  await store.writeRootIndex(makeRoot(rootOverrides));

  return { repo, slug, ledgerRoot, planPath, store };
}

/**
 * Removes the temporary `ledgerRoot` directory created by
 * {@link createNamespacedProject}. Safe to call even if the directory was
 * never written to or has already been removed.
 */
export async function cleanupNamespacedProject(
  handle: NamespacedProjectHandle
): Promise<void> {
  await rm(handle.ledgerRoot, { recursive: true, force: true });
}
