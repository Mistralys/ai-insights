/**
 * Tests for handleGetRunMetadata in gui/api.ts — WP-002
 *
 * Acceptance criteria:
 *   AC-1: GET /api/projects/:slug/run-metadata returns HTTP 200 with parsed
 *         metadata JSON when the file exists.
 *   AC-2: Returns HTTP 404 when the metadata file does not exist on disk.
 *   AC-3: Returns HTTP 404 when the project has no meta.plan_path in the
 *         ledger (project not found).
 *   AC-4: Rejects an unsafe slug with HTTP 400 (path-traversal guard via
 *         assertSafeSlug() — surfaced as NOT_FOUND per helper convention).
 *   AC-5: File path is constructed as path.join(planPath, '.orchestrator-run.json')
 *         where planPath is the stored meta.plan_path value.
 *
 * Uses real temp directories and LedgerStore to seed fixture data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleGetRunMetadata, ApiError } from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
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

async function createProject(
  ledgerRoot: string,
  slug: string,
  rootOverrides: Partial<RootIndex> = {}
): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, ledgerRoot);
  await store.writeRootIndex(makeRoot(rootOverrides));
  return store;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handleGetRunMetadata', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-run-metadata-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ── AC-1: Happy path — file exists, returns parsed JSON ─────────────────

  it('AC-1: returns parsed metadata JSON when file exists', async () => {
    const store = await createProject(ledgerRoot, '2026-01-01-run-meta-test');
    await mkdir(store.planPath, { recursive: true });

    const metaPayload = {
      thread_id: 'abc-123',
      plan_path: store.planPath,
      slug: '2026-01-01-run-meta-test',
      started_at: '2026-05-31T10:00:00+00:00',
      is_resume: false,
      dry_run: false,
      log_filename: 'run.jsonl',
      pid: 9999,
      result: null,
      error: null,
      duration_s: null,
    };
    await writeFile(
      join(store.planPath, '.orchestrator-run.json'),
      JSON.stringify(metaPayload),
      'utf-8'
    );

    const result = await handleGetRunMetadata(ledgerRoot, '2026-01-01-run-meta-test');

    expect(result).toMatchObject({
      thread_id: 'abc-123',
      is_resume: false,
      dry_run: false,
      result: null,
      error: null,
      duration_s: null,
    });
  });

  it('AC-1: returns correct result when metadata has a terminal result', async () => {
    const store = await createProject(ledgerRoot, '2026-01-01-success-run');
    await mkdir(store.planPath, { recursive: true });

    const metaPayload = {
      thread_id: 'done-thread',
      result: 'SUCCESS',
      error: null,
      duration_s: 42.5,
    };
    await writeFile(
      join(store.planPath, '.orchestrator-run.json'),
      JSON.stringify(metaPayload),
      'utf-8'
    );

    const result = await handleGetRunMetadata(ledgerRoot, '2026-01-01-success-run') as typeof metaPayload;

    expect(result).toMatchObject({ result: 'SUCCESS', duration_s: 42.5 });
  });

  // ── AC-2: Metadata file absent — NOT_FOUND ───────────────────────────────

  it('AC-2: throws NOT_FOUND when project exists but metadata file is absent', async () => {
    // Create project but do NOT write .orchestrator-run.json
    await createProject(ledgerRoot, '2026-01-01-no-meta-file');

    await expect(
      handleGetRunMetadata(ledgerRoot, '2026-01-01-no-meta-file')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-2: NOT_FOUND error is an ApiError instance', async () => {
    await createProject(ledgerRoot, '2026-01-01-no-meta-file-b');

    const err = await handleGetRunMetadata(ledgerRoot, '2026-01-01-no-meta-file-b').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NOT_FOUND');
  });

  // ── AC-3: Project not in ledger — NOT_FOUND ──────────────────────────────

  it('AC-3: throws NOT_FOUND for a non-existent project slug', async () => {
    await expect(
      handleGetRunMetadata(ledgerRoot, '2026-01-01-ghost-project')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── AC-4: Unsafe slug — path-traversal guard ─────────────────────────────

  it('AC-4: rejects slug with path separator (slash) with NOT_FOUND', async () => {
    await expect(
      handleGetRunMetadata(ledgerRoot, 'a/b')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-4: rejects slug with double-dot traversal with NOT_FOUND', async () => {
    await expect(
      handleGetRunMetadata(ledgerRoot, '../escape')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AC-4: rejects empty slug with NOT_FOUND', async () => {
    await expect(
      handleGetRunMetadata(ledgerRoot, '')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── AC-5: Path construction from meta.plan_path ──────────────────────────

  it('AC-5: reads file from plan_path directory, not ledger storage directory', async () => {
    const store = await createProject(ledgerRoot, '2026-01-01-path-check');

    // Verify planPath and storageDir are distinct locations
    expect(store.planPath).not.toBe(store.storageDir);

    // Write the metadata file to planPath (correct location)
    await mkdir(store.planPath, { recursive: true });
    const metaPayload = { thread_id: 'path-test', result: null };
    await writeFile(
      join(store.planPath, '.orchestrator-run.json'),
      JSON.stringify(metaPayload),
      'utf-8'
    );

    // Handler should find it at planPath
    const result = await handleGetRunMetadata(ledgerRoot, '2026-01-01-path-check') as typeof metaPayload;
    expect(result).toMatchObject({ thread_id: 'path-test' });
  });

  it('AC-5: does NOT find file written to storageDir (must be at planPath)', async () => {
    const store = await createProject(ledgerRoot, '2026-01-01-path-check-b');

    // Write to storageDir instead of planPath — must NOT be found
    await writeFile(
      join(store.storageDir, '.orchestrator-run.json'),
      JSON.stringify({ thread_id: 'wrong-dir' }),
      'utf-8'
    );

    // planPath has no .orchestrator-run.json → NOT_FOUND
    await expect(
      handleGetRunMetadata(ledgerRoot, '2026-01-01-path-check-b')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
