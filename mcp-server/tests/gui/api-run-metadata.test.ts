/**
 * Tests for handleGetRunMetadata in gui/api.ts — WP-002 (handler-level)
 * and GET /api/projects/:repo/:slug/run-metadata in gui/server.ts — WP-002 (namespaced HTTP route)
 *
 * Acceptance criteria (handler-level):
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
 * Acceptance criteria (namespaced HTTP route — WP-002 rework):
 *   AC-NS-1: GET /api/projects/:repo/:slug/run-metadata returns the same JSON as
 *            GET /api/projects/:slug/run-metadata for a valid namespaced project.
 *   AC-NS-2: Returns 404 for unknown repo/slug combinations (no .meta.json).
 *   AC-NS-3: Returns 404 for path-traversal attempts in repo or slug segments.
 *
 * Uses real temp directories and LedgerStore to seed fixture data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleGetRunMetadata, ApiError } from '../../gui/api.js';
import { handleRequest } from '../../gui/server.js';
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

// ---------------------------------------------------------------------------
// HTTP-level helpers for namespaced route tests
// ---------------------------------------------------------------------------

/**
 * Spins up a temporary HTTP server bound to a random port that delegates every
 * request to handleRequest().
 */
function startTestServer(
  ledgerRoot: string,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const configPath = join(ledgerRoot, 'gui-config.json');
    const logsDir = join(ledgerRoot, 'orchestrator', 'logs');
    const server = createServer((req, res) => {
      handleRequest(req, res, ledgerRoot, configPath, 0, logsDir).catch((err) => {
        process.stderr.write(`[test-server] Unhandled: ${String(err)}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'error' } }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
      } else {
        reject(new Error('Could not determine server port'));
      }
    });

    server.on('error', reject);
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/**
 * Writes a minimal .meta.json for a namespaced project at
 * {ledgerRoot}/{repo}/{slug}/.meta.json and an optional
 * .orchestrator-run.json at the given planPath.
 *
 * planPath MUST end with a segment matching {YYYY-MM-DD}-{name} — the
 * LedgerStore constructor validates this pattern via planFolderBasename().
 * Use a date-prefixed name such as '2026-01-01-my-project' as the last segment.
 */
async function writeNamespacedProject(
  ledgerRoot: string,
  repo: string,
  slug: string,
  planPath: string,
  runMetadata?: object,
): Promise<void> {
  const projectDir = join(ledgerRoot, repo, slug);
  await mkdir(projectDir, { recursive: true });
  const meta = {
    slug,
    plan_path: planPath,
    status: 'IN_PROGRESS',
    date_created: '2026-01-01T00:00:00Z',
    last_updated: '2026-01-01T00:00:00Z',
    repository_name: repo,
  };
  await writeFile(join(projectDir, '.meta.json'), JSON.stringify(meta), 'utf-8');

  if (runMetadata !== undefined) {
    await mkdir(planPath, { recursive: true });
    await writeFile(
      join(planPath, '.orchestrator-run.json'),
      JSON.stringify(runMetadata),
      'utf-8',
    );
  }
}

// ---------------------------------------------------------------------------
// Suite: namespaced HTTP route — GET /api/projects/:repo/:slug/run-metadata
// ---------------------------------------------------------------------------

describe('GET /api/projects/:repo/:slug/run-metadata — namespaced HTTP route', () => {
  let ledgerRoot: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-run-metadata-ns-test-'));
    const result = await startTestServer(ledgerRoot);
    server = result.server;
    baseUrl = result.baseUrl;
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ── AC-NS-1: Happy path — same JSON as the single-segment route ──────────

  it('AC-NS-1: returns HTTP 200 with the same parsed JSON as the flat route', async () => {
    // planPath must end with a YYYY-MM-DD-name segment (LedgerStore validation)
    const planPath = join(ledgerRoot, '2026-01-01-ns-test-active');
    const metaPayload = {
      thread_id: 'ns-thread-abc',
      plan_path: planPath,
      slug: 'my-project',
      started_at: '2026-05-31T10:00:00+00:00',
      is_resume: false,
      dry_run: false,
      result: null,
      error: null,
      duration_s: null,
    };
    await writeNamespacedProject(ledgerRoot, 'my-repo', 'my-project', planPath, metaPayload);

    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/my-repo/my-project/run-metadata`,
    );

    expect(status).toBe(200);
    expect((body as { thread_id: string }).thread_id).toBe('ns-thread-abc');
    expect((body as { result: null }).result).toBeNull();
  });

  it('AC-NS-1: returns HTTP 200 with terminal result when run has completed', async () => {
    const planPath = join(ledgerRoot, '2026-01-01-ns-test-completed');
    const metaPayload = { thread_id: 'done-thread', result: 'SUCCESS', duration_s: 30 };
    await writeNamespacedProject(ledgerRoot, 'my-repo', 'completed-project', planPath, metaPayload);

    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/my-repo/completed-project/run-metadata`,
    );

    expect(status).toBe(200);
    expect((body as { result: string }).result).toBe('SUCCESS');
    expect((body as { duration_s: number }).duration_s).toBe(30);
  });

  // ── AC-NS-2: Unknown repo/slug returns 404 ───────────────────────────────

  it('AC-NS-2: returns 404 when .meta.json does not exist for the repo/slug', async () => {
    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/nonexistent-repo/unknown-slug/run-metadata`,
    );

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('AC-NS-2: returns 404 when .meta.json exists but .orchestrator-run.json is absent', async () => {
    // planPath must use valid YYYY-MM-DD-name format even though no run file is written
    const planPath = join(ledgerRoot, '2026-01-01-ns-test-no-run-file');
    // Write project without run metadata
    await writeNamespacedProject(ledgerRoot, 'my-repo', 'no-run-meta', planPath, undefined);
    // Ensure planPath dir exists (but no .orchestrator-run.json)
    await mkdir(planPath, { recursive: true });

    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/my-repo/no-run-meta/run-metadata`,
    );

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  // ── AC-NS-3: Path-traversal attempts return 404 ──────────────────────────

  it('AC-NS-3: returns 404 for a path-traversal attempt in the repo segment', async () => {
    // ".." in the repo segment fails SAFE_SLUG_REGEX → NOT_FOUND before any FS access
    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/bad..repo/my-project/run-metadata`,
    );

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('AC-NS-3: returns 404 for a path-traversal attempt in the slug segment', async () => {
    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/my-repo/bad..slug/run-metadata`,
    );

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('AC-NS-3: returns 404 for URL-encoded slash in the repo segment', async () => {
    const { status, body } = await httpGet(
      `${baseUrl}/api/projects/bad%2Frepo/my-project/run-metadata`,
    );

    // %2F decodes to '/' which fails SAFE_SLUG_REGEX → 404
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
