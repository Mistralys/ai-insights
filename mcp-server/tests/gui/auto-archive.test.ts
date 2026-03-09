/**
 * Tests for src/gui/auto-archive.ts (WP-003)
 *
 * Uses real temp directories to create fixtures on disk. The auto-archive
 * module reads the ledger through LedgerStore, so tests create genuine meta
 * files and verify the status transitions after runAutoArchive returns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runAutoArchive, startAutoArchiveTimer, stopAutoArchiveTimer, _resetTimerForTesting } from '../../src/gui/auto-archive.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoot(
  status: RootIndex['status'],
  overrides: Partial<RootIndex> = {}
): RootIndex {
  const ts = now();
  return {
    plan_file: 'plan.md',
    date_created: ts,
    last_updated: ts,
    status,
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

/** Creates a project in the ledger root with the given status. */
async function createProject(
  ledgerRoot: string,
  slug: string,
  status: RootIndex['status'] = 'IN_PROGRESS'
): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  await mkdir(planPath, { recursive: true });
  const store = new LedgerStore(planPath, ledgerRoot);
  await store.writeRootIndex(makeRoot(status));
  return store;
}

/**
 * Patches the `last_updated` field in the project's `.meta.json` to a
 * backdated ISO timestamp. This simulates a project that has not been
 * touched in `daysAgo` days.
 */
async function backdateProject(store: LedgerStore, daysAgo: number): Promise<void> {
  const metaPath = store.metaPath();
  const raw = await readFile(metaPath, 'utf-8');
  const meta = JSON.parse(raw) as Record<string, unknown>;
  const staleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  meta['last_updated'] = staleDate;
  await writeFile(metaPath, JSON.stringify(meta), 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('runAutoArchive', () => {
  let ledgerRoot: string;
  const createdPlanDirs: string[] = [];

  function trackPlanDir(slug: string): void {
    createdPlanDirs.push(join(tmpdir(), slug));
  }

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'auto-archive-ledger-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
    // Clean up any plan dirs that were created for this test
    for (const dir of createdPlanDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array when no projects exist', async () => {
    const result = await runAutoArchive(ledgerRoot, 6);
    expect(result).toEqual([]);
  });

  it('returns empty array and performs no writes when maxAgeDays === 0', async () => {
    const slug = '2026-01-01-complete-old';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'COMPLETE');
    await backdateProject(store, 30); // stale by 30 days

    const result = await runAutoArchive(ledgerRoot, 0);
    expect(result).toEqual([]);

    // Status must be unchanged
    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('COMPLETE');
  });

  it('archives COMPLETE projects older than the threshold', async () => {
    const slug = '2026-01-02-stale-complete';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'COMPLETE');
    await backdateProject(store, 10); // stale by 10 days, threshold is 6

    const result = await runAutoArchive(ledgerRoot, 6);
    expect(result).toContain(slug);
    expect(result).toHaveLength(1);

    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('ARCHIVED');
  });

  it('skips COMPLETE projects newer than the threshold', async () => {
    const slug = '2026-01-03-recent-complete';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'COMPLETE');
    // Do NOT backdate — last_updated is fresh

    const result = await runAutoArchive(ledgerRoot, 6);
    expect(result).toEqual([]);

    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('COMPLETE');
  });

  it('skips projects with IN_PROGRESS status even when stale', async () => {
    const slug = '2026-01-04-stale-in-progress';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'IN_PROGRESS');
    await backdateProject(store, 30);

    const result = await runAutoArchive(ledgerRoot, 6);
    expect(result).toEqual([]);

    const meta = await store.readProjectMeta();
    expect(meta.status).toBe('IN_PROGRESS');
  });

  it('skips projects with READY status even when stale', async () => {
    const slug = '2026-01-05-stale-ready';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'READY');
    await backdateProject(store, 30);

    expect(await runAutoArchive(ledgerRoot, 6)).toEqual([]);
    expect((await store.readProjectMeta()).status).toBe('READY');
  });

  it('skips projects with BLOCKED status even when stale', async () => {
    const slug = '2026-01-06-stale-blocked';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'BLOCKED');
    await backdateProject(store, 30);

    expect(await runAutoArchive(ledgerRoot, 6)).toEqual([]);
    expect((await store.readProjectMeta()).status).toBe('BLOCKED');
  });

  it('skips projects already in ARCHIVED status', async () => {
    const slug = '2026-01-07-already-archived';
    trackPlanDir(slug);
    const store = await createProject(ledgerRoot, slug, 'ARCHIVED');
    await backdateProject(store, 90);

    expect(await runAutoArchive(ledgerRoot, 6)).toEqual([]);
    expect((await store.readProjectMeta()).status).toBe('ARCHIVED');
  });

  it('processes multiple projects and returns only the archived slugs', async () => {
    const staleSlug = '2026-01-08-stale';
    const freshSlug = '2026-01-08-fresh';
    const inProgressSlug = '2026-01-08-active';
    trackPlanDir(staleSlug);
    trackPlanDir(freshSlug);
    trackPlanDir(inProgressSlug);

    const staleStore = await createProject(ledgerRoot, staleSlug, 'COMPLETE');
    const freshStore = await createProject(ledgerRoot, freshSlug, 'COMPLETE');
    await createProject(ledgerRoot, inProgressSlug, 'IN_PROGRESS');

    await backdateProject(staleStore, 14);
    // freshStore is not backdated — stays fresh

    const result = await runAutoArchive(ledgerRoot, 6);
    expect(result).toContain(staleSlug);
    expect(result).not.toContain(freshSlug);
    expect(result).not.toContain(inProgressSlug);

    expect((await staleStore.readProjectMeta()).status).toBe('ARCHIVED');
    expect((await freshStore.readProjectMeta()).status).toBe('COMPLETE');
  });

  it('continues archiving remaining projects when one archive operation fails', async () => {
    const failSlug = '2026-01-09-fail-project';
    const successSlug = '2026-01-09-success-project';
    trackPlanDir(failSlug);
    trackPlanDir(successSlug);

    const failStore = await createProject(ledgerRoot, failSlug, 'COMPLETE');
    const successStore = await createProject(ledgerRoot, successSlug, 'COMPLETE');

    await backdateProject(failStore, 20);
    await backdateProject(successStore, 20);

    // Corrupt the fail project's root index so writeRootIndex will throw
    await writeFile(
      join(failStore.storageDir, 'project-ledger.json'),
      'not valid json',
      'utf-8'
    );

    const result = await runAutoArchive(ledgerRoot, 6);
    // The good project should still be archived
    expect(result).toContain(successSlug);
    expect((await successStore.readProjectMeta()).status).toBe('ARCHIVED');
  });
});

// ---------------------------------------------------------------------------
// Timer management tests
// ---------------------------------------------------------------------------

describe('startAutoArchiveTimer / stopAutoArchiveTimer', () => {
  beforeEach(() => {
    stopAutoArchiveTimer();
    _resetTimerForTesting();
  });

  afterEach(() => {
    stopAutoArchiveTimer();
    _resetTimerForTesting();
  });

  it('stopAutoArchiveTimer is a no-op when no timer is running', () => {
    expect(() => stopAutoArchiveTimer()).not.toThrow();
  });

  it('startAutoArchiveTimer does not throw when ledger root does not exist', () => {
    const ledgerRoot = join(tmpdir(), 'nonexistent-timer-test-ledger');
    // The initial tick runs async; errors are caught internally and logged to stderr
    expect(() => startAutoArchiveTimer(ledgerRoot, 600_000)).not.toThrow();
  });

  it('calling startAutoArchiveTimer twice does not start a second timer (idempotent)', () => {
    const ledgerRoot = join(tmpdir(), 'timer-double-start');
    startAutoArchiveTimer(ledgerRoot, 600_000);
    // Second call should be a no-op — no error thrown
    expect(() => startAutoArchiveTimer(ledgerRoot, 600_000)).not.toThrow();
  });

  it('stopAutoArchiveTimer clears the interval and can be called again safely', () => {
    const ledgerRoot = join(tmpdir(), 'timer-stop-test');
    startAutoArchiveTimer(ledgerRoot, 600_000);
    stopAutoArchiveTimer();
    // Calling stop again should be safe
    expect(() => stopAutoArchiveTimer()).not.toThrow();
  });
});
