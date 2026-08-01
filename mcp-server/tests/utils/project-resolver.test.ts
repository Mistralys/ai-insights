import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import {
  resolveProjectPath,
  formatCandidateList,
} from '../../src/utils/project-resolver.js';

// ---------------------------------------------------------------------------
// resolveProjectPath
// ---------------------------------------------------------------------------

describe('resolveProjectPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns project_path directly when provided (validates format)', async () => {
    const valid = '/tmp/2026-02-16-my-project';
    const result = await resolveProjectPath({ project_path: valid });
    expect(result).toBe(valid);
  });

  it('throws when project_path is provided but has invalid format', async () => {
    await expect(
      resolveProjectPath({ project_path: '/tmp/invalid-no-date' })
    ).rejects.toThrow('Invalid project path format');
  });

  it('returns plan_path from LedgerStore.detectProjectByCwd when cwd_path is provided and FOUND', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'FOUND',
      meta: {
        plan_path: '/projects/docs/agents/plans/2026-03-01-my-project',
        slug: '2026-03-01-my-project',
        title: 'My Project',
        status: 'IN_PROGRESS',
        codebase_root: '/projects',
        date_created: '2026-03-01T00:00:00Z',
        last_updated: '2026-03-01T00:00:00Z',
      },
    } as any);

    const result = await resolveProjectPath({ cwd_path: '/projects' });
    expect(result).toBe('/projects/docs/agents/plans/2026-03-01-my-project');
    expect(LedgerStore.detectProjectByCwd).toHaveBeenCalledWith('/projects');
  });

  it('throws with candidates list when cwd_path matches multiple projects (AMBIGUOUS)', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'AMBIGUOUS',
      best: [
        { plan_path: '/a/docs/plans/2026-02-01-beta', slug: '2026-02-01-beta', status: 'IN_PROGRESS', date_created: '2026-03-05T10:00:00Z', last_updated: '2026-03-05T10:00:00Z' },
      ],
      unlikely: [
        { plan_path: '/a/docs/plans/2026-01-01-alpha', slug: '2026-01-01-alpha', status: 'READY', date_created: '2026-02-01T10:00:00Z', last_updated: '2026-02-01T10:00:00Z' },
      ],
    } as any);

    await expect(
      resolveProjectPath({ cwd_path: '/a' })
    ).rejects.toThrow('Multiple projects match');
  });

  it('throws NOT_FOUND error when cwd_path does not match any project', async () => {
    vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'NOT_FOUND',
    } as any);

    await expect(
      resolveProjectPath({ cwd_path: '/nonexistent' })
    ).rejects.toThrow('No project found for cwd_path');
  });

  it('uses project_path when both project_path and cwd_path are provided', async () => {
    const spy = vi.spyOn(LedgerStore, 'detectProjectByCwd');
    const validPlan = '/tmp/2026-02-16-my-project';
    const result = await resolveProjectPath({ project_path: validPlan, cwd_path: '/any/workspace' });
    expect(result).toBe(validPlan);
    // LedgerStore must NOT be called — project_path takes precedence
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when neither project_path nor cwd_path is provided', async () => {
    await expect(resolveProjectPath({})).rejects.toThrow(
      'Either project_path or cwd_path is required.'
    );
  });
});

// ---------------------------------------------------------------------------
// formatCandidateList
// ---------------------------------------------------------------------------

function makeMeta(slug: string, plan_path: string, last_updated = '2026-01-01T00:00:00Z') {
  return { slug, plan_path, status: 'READY' as const, date_created: '2026-01-01T00:00:00Z', last_updated };
}

// Fixed reference point so relative-time labels are deterministic.
const FIXED_NOW = new Date('2026-03-06T12:00:00Z');

describe('formatCandidateList', () => {
  it('lists only a "Best matches" section when unlikely is empty', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('Best matches:');
    expect(result).toContain('2026-03-05-alpha');
    expect(result).not.toContain('Unlikely');
  });

  it('includes an "Unlikely" section when unlikely candidates are present', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    expect(result).toContain('Best matches:');
    expect(result).toContain('2026-03-05-alpha');
    expect(result).toContain('Unlikely');
    expect(result).toContain('2026-01-01-old');
  });

  it('renders best entries before unlikely entries', () => {
    const best = [makeMeta('2026-03-05-alpha', '/root/docs/plans/2026-03-05-alpha')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    expect(result.indexOf('2026-03-05-alpha')).toBeLessThan(result.indexOf('2026-01-01-old'));
  });

  it('includes the plan_path of each candidate', () => {
    const best = [makeMeta('2026-03-05-alpha', '/my/project/docs/plans/2026-03-05-alpha')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('/my/project/docs/plans/2026-03-05-alpha');
  });

  it('appends a relative time label to each best match entry', () => {
    // 21 minutes before FIXED_NOW
    const best = [makeMeta('2026-03-06-recent', '/root/docs/plans/2026-03-06-recent', '2026-03-06T11:39:00Z')];
    const result = formatCandidateList(best, [], FIXED_NOW);
    expect(result).toContain('last active 21mn ago');
  });

  it('does NOT append a time label to unlikely entries', () => {
    const best = [makeMeta('2026-03-06-recent', '/root/docs/plans/2026-03-06-recent', '2026-03-06T11:39:00Z')];
    const unlikely = [makeMeta('2026-01-01-old', '/root/docs/plans/2026-01-01-old', '2026-01-01T00:00:00Z')];
    const result = formatCandidateList(best, unlikely, FIXED_NOW);
    // The unlikely line should be a plain "  - path (slug)" with no time label
    const unlikelyLine = result.split('\n').find(l => l.includes('2026-01-01-old'))!;
    expect(unlikelyLine).not.toContain('last active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-003: resolveProjectPath — multi-store mode
// ─────────────────────────────────────────────────────────────────────────────

function makeStoreConfig(stores: Array<{ id: string; path: string; label: string }>): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: stores[0]!.id,
  };
}

/** Write a minimal .meta.json under {storePath}/{repoName}/{slug}/ */
async function writeMetaForResolver(
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

function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

describe('resolveProjectPath — multi-store mode', () => {
  let tempDir: string;
  let storeAPath: string;
  let storeBPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'resolver-multi-store-'));
    storeAPath = join(tempDir, 'store-a');
    storeBPath = join(tempDir, 'store-b');
    await mkdir(storeAPath, { recursive: true });
    await mkdir(storeBPath, { recursive: true });
  });

  afterEach(async () => {
    restoreLegacyContext();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  function initTwoStoreContext(): void {
    const config = makeStoreConfig([
      { id: 'store-a', path: storeAPath, label: 'Store A' },
      { id: 'store-b', path: storeBPath, label: 'Store B' },
    ]);
    const router = new StoreRouter(config);
    setStoreContext(router, new MultiStoreManager(router));
  }

  it('detects a project in a non-default store when multi-store mode is active', async () => {
    // Project exists only in store-b (not the default store-a)
    const repoRoot = join(tempDir, 'repo-b');
    const planPath = join(repoRoot, 'docs', 'agents', 'plans', '2026-05-01-proj-b');
    await writeMetaForResolver(storeBPath, 'repo-b', '2026-05-01-proj-b', planPath);

    initTwoStoreContext();

    const result = await resolveProjectPath({ cwd_path: repoRoot });
    expect(result).toBe(planPath);
  });

  it('detects a project in the default store when multi-store mode is active', async () => {
    // Project exists in store-a (the default store)
    const repoRoot = join(tempDir, 'repo-a');
    const planPath = join(repoRoot, 'docs', 'agents', 'plans', '2026-05-02-proj-a');
    await writeMetaForResolver(storeAPath, 'repo-a', '2026-05-02-proj-a', planPath);

    initTwoStoreContext();

    const result = await resolveProjectPath({ cwd_path: repoRoot });
    expect(result).toBe(planPath);
  });

  it('throws with MULTI_STORE_AMBIGUOUS when cwd_path matches projects in multiple stores', async () => {
    const sharedRoot = join(tempDir, 'shared-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-06-01-in-a');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-06-02-in-b');

    await writeMetaForResolver(storeAPath, 'shared-repo', '2026-06-01-in-a', planPathA);
    await writeMetaForResolver(storeBPath, 'shared-repo', '2026-06-02-in-b', planPathB);

    initTwoStoreContext();

    await expect(
      resolveProjectPath({ cwd_path: sharedRoot })
    ).rejects.toThrow('Project found in multiple stores');
  });

  it('MULTI_STORE_AMBIGUOUS error includes store IDs of all matching candidates', async () => {
    const sharedRoot = join(tempDir, 'ambiguous-repo');
    const planPathA = join(sharedRoot, 'docs', 'agents', 'plans', '2026-07-01-in-a');
    const planPathB = join(sharedRoot, 'docs', 'agents', 'plans', '2026-07-02-in-b');

    await writeMetaForResolver(storeAPath, 'ambiguous-repo', '2026-07-01-in-a', planPathA);
    await writeMetaForResolver(storeBPath, 'ambiguous-repo', '2026-07-02-in-b', planPathB);

    initTwoStoreContext();

    let thrownError: Error | undefined;
    try {
      await resolveProjectPath({ cwd_path: sharedRoot });
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toContain('store-a');
    expect(thrownError!.message).toContain('store-b');
    expect(thrownError!.message).toContain('project_path');
  });

  it('throws NOT_FOUND error when cwd_path matches no store in multi-store mode', async () => {
    initTwoStoreContext();

    await expect(
      resolveProjectPath({ cwd_path: join(tempDir, 'non-existent-repo') })
    ).rejects.toThrow('No project found for cwd_path');
  });

  it('uses LedgerStore.detectProjectByCwd directly (single-store fallback) when store context is not initialized', async () => {
    // restoreLegacyContext() sets StoreRouter(null), making isMultiStoreMode() false.
    // The combined guard (isStoreContextInitialized() && isMultiStoreMode()) evaluates to
    // false, so resolveProjectPath() falls through to the single-store LedgerStore path.
    const spy = vi.spyOn(LedgerStore, 'detectProjectByCwd').mockResolvedValueOnce({
      status: 'FOUND',
      meta: {
        plan_path: '/legacy/docs/agents/plans/2026-01-01-legacy',
        slug: '2026-01-01-legacy',
        status: 'IN_PROGRESS',
        date_created: '2026-01-01T00:00:00Z',
        last_updated: '2026-01-01T00:00:00Z',
      },
    } as any);

    // Restore legacy context so isMultiStoreMode() = false → single-store path is taken
    restoreLegacyContext();

    const result = await resolveProjectPath({ cwd_path: '/legacy' });
    expect(result).toBe('/legacy/docs/agents/plans/2026-01-01-legacy');
    // Should be called with just cwdPath (single-store path, no store prefix)
    expect(spy).toHaveBeenCalledWith('/legacy');
  });
});
