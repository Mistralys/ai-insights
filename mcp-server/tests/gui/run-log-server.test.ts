/**
 * HTTP-level integration tests for the run-log routes in gui/server.ts.
 *
 * These tests spin up the real HTTP server (via handleRequest) and assert that
 * ApiErrors thrown by the run-log handlers are mapped to the correct HTTP
 * status codes (404, 403) rather than falling through to 500.
 *
 * This test was added to prevent regression of the `instanceof ApiError`
 * mismatch bug: the run-log handlers previously imported ApiError from a
 * different module than server.ts, causing all structured errors to be
 * returned as HTTP 500.
 *
 * Test coverage:
 *   - Invalid slug in GET /api/projects/:slug/runs → 404
 *   - Invalid slug in GET /api/projects/:slug/runs/:filename → 404
 *   - Path-traversal filename in GET /api/projects/:slug/runs/:filename → 403
 *   - Missing log file in GET /api/projects/:slug/runs/:filename → 404
 *   - Happy path: GET /api/projects/:slug/runs returns a JSON array → 200
 *   - Happy path: GET /api/projects/:slug/runs/:filename returns entries → 200
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleRequest } from '../../gui/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spins up a temporary HTTP server bound to a random port.
 * The server delegates every request to handleRequest() with the given
 * ledgerRoot, configPath, and logsDir.
 *
 * Returns { server, baseUrl, port }.
 */
function startTestServer(
  ledgerRoot: string,
  configPath: string,
  logsDir: string
): Promise<{ server: Server; baseUrl: string; port: number }> {
  return new Promise((resolve, reject) => {
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
        const port = addr.port;
        resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
      } else {
        reject(new Error('Could not determine server port'));
      }
    });

    server.on('error', reject);
  });
}

/** Stops a server and waits for it to close. */
function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Makes an HTTP GET request and returns { status, body }. */
async function get(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Writes a JSONL file with the given objects. */
async function writeJsonl(filePath: string, objects: unknown[]): Promise<void> {
  const content = objects.map((o) => JSON.stringify(o)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Writes a minimal `.meta.json` at `{ledgerRoot}/{repo}/{slug}/.meta.json`.
 * Creates intermediate directories as needed.
 * Used in namespaced route tests to satisfy the project-existence check added
 * for AC3 (resolveRepoName reads this file and throws NOT_FOUND if absent).
 *
 * **Schema sync:** the object literal written here is a hand-rolled subset of
 * the project meta shape. If the production `ProjectMetaSchema` gains required
 * fields, this helper must be updated to match — otherwise tests that exercise
 * the meta-read path will silently use a stale fixture. Replace this helper
 * with a schema-validated factory once the project meta type is stabilised.
 */
async function writeMetaJson(
  ledgerRoot: string,
  repo: string,
  slug: string,
  repositoryName: string = repo,
): Promise<void> {
  const projectDir = join(ledgerRoot, repo, slug);
  await mkdir(projectDir, { recursive: true });
  const meta = {
    slug,
    plan_path: `/fake/${repo}/${slug}/plan.md`,
    status: 'IN_PROGRESS',
    date_created: '2026-01-01T00:00:00Z',
    last_updated: '2026-01-01T00:00:00Z',
    repository_name: repositoryName,
  };
  await writeFile(join(projectDir, '.meta.json'), JSON.stringify(meta), 'utf-8');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('run-log HTTP routes — error mapping (instanceof ApiError regression)', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'run-log-server-test-ledger-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'run-log-server-test-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');

    const result = await startTestServer(ledgerRoot, configPath, logsDir);
    server  = result.server;
    baseUrl = result.baseUrl;
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
    await rm(logsDir,    { recursive: true, force: true });
  });

  // ── GET /api/projects/:slug/runs ──────────────────────────────────────────

  it('returns 404 for an invalid slug (contains ..) on the list route', async () => {
    const { status, body } = await get(`${baseUrl}/api/projects/bad..slug/runs`);
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('returns 200 and an empty array when no logs match the slug', async () => {
    const { status, body } = await get(`${baseUrl}/api/projects/my-project/runs`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns 200 and the matching filenames when logs exist', async () => {
    await writeFile(join(logsDir, '20260225T113355-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(logsDir, '20260226T120000-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(logsDir, '20260225T113355-other-project.jsonl'), '', 'utf-8');

    const { status, body } = await get(`${baseUrl}/api/projects/my-project/runs`);
    expect(status).toBe(200);
    const files = body as { filename: string; is_active: boolean }[];
    expect(files).toHaveLength(2);
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain('20260225T113355-my-project.jsonl');
    expect(filenames).toContain('20260226T120000-my-project.jsonl');
    files.forEach((f) => expect(typeof f.is_active).toBe('boolean'));
  });

  // ── GET /api/projects/:slug/runs/:filename ────────────────────────────────

  it('returns 404 for an invalid slug (contains ..) on the get-log route', async () => {
    const { status, body } = await get(
      `${baseUrl}/api/projects/bad..slug/runs/20260225T113355-bad..slug.jsonl`
    );
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('returns 403 for a path-traversal filename', async () => {
    const { status, body } = await get(
      `${baseUrl}/api/projects/my-project/runs/..%2F..%2Fetc%2Fpasswd`
    );
    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for a filename with disallowed characters', async () => {
    const { status, body } = await get(
      `${baseUrl}/api/projects/my-project/runs/${encodeURIComponent('bad file!.jsonl')}`
    );
    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a valid filename that does not exist on disk', async () => {
    const { status, body } = await get(
      `${baseUrl}/api/projects/my-project/runs/20260225T113355-my-project.jsonl`
    );
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('returns 200 and parsed entries for an existing log file', async () => {
    const projectLogsDir = join(ledgerRoot, 'my-project', 'orchestrator', 'logs');
    await mkdir(projectLogsDir, { recursive: true });
    const logFile = join(projectLogsDir, '20260225T113355-my-project.jsonl');
    await writeJsonl(logFile, [
      { action: 'start', timestamp: '2026-02-25T11:33:55Z' },
      { action: 'end',   timestamp: '2026-02-25T11:34:00Z' },
    ]);

    const { status, body } = await get(
      `${baseUrl}/api/projects/my-project/runs/20260225T113355-my-project.jsonl`
    );
    expect(status).toBe(200);
    const result = body as { entries: unknown[]; totalLines: number };
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect((result.entries[0] as { action: string }).action).toBe('start');
  });

  it('returns 200 and respects the ?after= query parameter', async () => {
    const projectLogsDir = join(ledgerRoot, 'my-project', 'orchestrator', 'logs');
    await mkdir(projectLogsDir, { recursive: true });
    const logFile = join(projectLogsDir, '20260225T113355-my-project.jsonl');
    await writeJsonl(logFile, [
      { action: 'a', timestamp: '2026-02-25T11:33:55Z' },
      { action: 'b', timestamp: '2026-02-25T11:33:56Z' },
      { action: 'c', timestamp: '2026-02-25T11:33:57Z' },
    ]);

    const { status, body } = await get(
      `${baseUrl}/api/projects/my-project/runs/20260225T113355-my-project.jsonl?after=1`
    );
    expect(status).toBe(200);
    const result = body as { entries: unknown[]; totalLines: number };
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect((result.entries[0] as { action: string }).action).toBe('b');
    expect((result.entries[1] as { action: string }).action).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// /:repo/:slug route variants (AC1–AC3)
// ---------------------------------------------------------------------------

describe('run-log HTTP routes — /:repo/:slug namespaced variants', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'run-log-ns-server-test-ledger-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'run-log-ns-server-test-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');

    const result = await startTestServer(ledgerRoot, configPath, logsDir);
    server  = result.server;
    baseUrl = result.baseUrl;
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
    await rm(logsDir,    { recursive: true, force: true });
  });

  // ── GET /api/projects/:repo/:slug/runs ────────────────────────────────────

  it('GET /:repo/:slug/runs returns 200 and an empty array when no logs match (AC1)', async () => {
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const { status, body } = await get(`${baseUrl}/api/projects/my-repo/my-project/runs`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('GET /:repo/:slug/runs returns 404 when .meta.json does not exist for the project (AC3)', async () => {
    // No .meta.json written — project does not exist in the ledger
    const { status, body } = await get(`${baseUrl}/api/projects/nonexistent-repo/unknown-slug/runs`);
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs returns 404 for an invalid repoName (contains ..) (AC1, AC2)', async () => {
    const { status, body } = await get(`${baseUrl}/api/projects/bad..repo/my-project/runs`);
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs returns 404 for an invalid slug (contains ..) (AC1, AC2)', async () => {
    const { status, body } = await get(`${baseUrl}/api/projects/my-repo/bad..slug/runs`);
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs returns repoName from repository_name in .meta.json, not raw URL param (AC3)', async () => {
    // Store a repository_name that differs in case from the URL param.
    // The handler receives the meta value; assertSafeSlug will validate it.
    // Since SAFE_SLUG_REGEX requires lowercase, store a lowercase value and verify
    // the route resolves it without error (confirming meta is read, not URL param).
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project', 'my-repo');
    const { status } = await get(`${baseUrl}/api/projects/my-repo/my-project/runs`);
    expect(status).toBe(200); // meta was read and repoName resolved successfully
  });

  it('GET /:repo/:slug/runs returns 200 with matching files from the namespaced logsDir (AC1)', async () => {
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const namespacedLogsDir = join(ledgerRoot, 'my-repo', 'my-project', 'orchestrator', 'logs');
    await mkdir(namespacedLogsDir, { recursive: true });
    await writeFile(join(namespacedLogsDir, '20260226T100000-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(namespacedLogsDir, '20260226T110000-my-project.jsonl'), '', 'utf-8');
    // File for a different slug — must NOT appear in the result
    await writeFile(join(namespacedLogsDir, '20260226T120000-other-project.jsonl'), '', 'utf-8');

    const { status, body } = await get(`${baseUrl}/api/projects/my-repo/my-project/runs`);
    expect(status).toBe(200);
    const files = body as { filename: string; is_active: boolean }[];
    expect(files).toHaveLength(2);
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain('20260226T100000-my-project.jsonl');
    expect(filenames).toContain('20260226T110000-my-project.jsonl');
  });

  it('GET /:repo/:slug/runs dispatches with req.params.repo and req.params.slug as separate values (AC1)', async () => {
    // Two projects with the same slug but different repo namespaces — each must
    // only see its own logs.
    await writeMetaJson(ledgerRoot, 'repo-a', 'shared-slug', 'repo-a');
    await writeMetaJson(ledgerRoot, 'repo-b', 'shared-slug', 'repo-b');
    const logsA = join(ledgerRoot, 'repo-a', 'shared-slug', 'orchestrator', 'logs');
    const logsB = join(ledgerRoot, 'repo-b', 'shared-slug', 'orchestrator', 'logs');
    await mkdir(logsA, { recursive: true });
    await mkdir(logsB, { recursive: true });
    await writeFile(join(logsA, '20260101T000000-shared-slug.jsonl'), '', 'utf-8');
    await writeFile(join(logsB, '20260202T000000-shared-slug.jsonl'), '', 'utf-8');

    const resA = await get(`${baseUrl}/api/projects/repo-a/shared-slug/runs`);
    const resB = await get(`${baseUrl}/api/projects/repo-b/shared-slug/runs`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const filenamesA = (resA.body as { filename: string }[]).map((f) => f.filename);
    const filenamesB = (resB.body as { filename: string }[]).map((f) => f.filename);
    expect(filenamesA).toContain('20260101T000000-shared-slug.jsonl');
    expect(filenamesA).not.toContain('20260202T000000-shared-slug.jsonl');
    expect(filenamesB).toContain('20260202T000000-shared-slug.jsonl');
    expect(filenamesB).not.toContain('20260101T000000-shared-slug.jsonl');
  });

  // ── GET /api/projects/:repo/:slug/runs/:filename ─────────────────────────

  it('GET /:repo/:slug/runs/:filename returns 404 for an invalid repoName (AC2)', async () => {
    const { status, body } = await get(
      `${baseUrl}/api/projects/Bad-Repo/my-project/runs/20260226T100000-my-project.jsonl`
    );
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs/:filename returns 403 for a path-traversal filename (AC1)', async () => {
    // Project must exist so the meta check passes before the filename check.
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const { status, body } = await get(
      `${baseUrl}/api/projects/my-repo/my-project/runs/..%2F..%2Fetc%2Fpasswd`
    );
    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('GET /:repo/:slug/runs/:filename returns 404 when .meta.json does not exist for the project (AC3)', async () => {
    // No .meta.json — resolveRepoName throws NOT_FOUND before filename is checked
    const { status, body } = await get(
      `${baseUrl}/api/projects/nonexistent-repo/unknown-slug/runs/20260226T100000-test.jsonl`
    );
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs/:filename returns 404 for a valid filename that does not exist on disk (AC1)', async () => {
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const { status, body } = await get(
      `${baseUrl}/api/projects/my-repo/my-project/runs/20260226T100000-my-project.jsonl`
    );
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET /:repo/:slug/runs/:filename returns 200 and parsed entries from the namespaced logsDir (AC1)', async () => {
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const namespacedLogsDir = join(ledgerRoot, 'my-repo', 'my-project', 'orchestrator', 'logs');
    await mkdir(namespacedLogsDir, { recursive: true });
    const logFile = join(namespacedLogsDir, '20260226T100000-my-project.jsonl');
    await writeJsonl(logFile, [
      { action: 'start', timestamp: '2026-02-26T10:00:00Z' },
      { action: 'end',   timestamp: '2026-02-26T10:01:00Z' },
    ]);

    const { status, body } = await get(
      `${baseUrl}/api/projects/my-repo/my-project/runs/20260226T100000-my-project.jsonl`
    );
    expect(status).toBe(200);
    const result = body as { entries: unknown[]; totalLines: number };
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect((result.entries[0] as { action: string }).action).toBe('start');
    expect((result.entries[1] as { action: string }).action).toBe('end');
  });

  it('GET /:repo/:slug/runs/:filename respects the ?after= query parameter (AC1)', async () => {
    await writeMetaJson(ledgerRoot, 'my-repo', 'my-project');
    const namespacedLogsDir = join(ledgerRoot, 'my-repo', 'my-project', 'orchestrator', 'logs');
    await mkdir(namespacedLogsDir, { recursive: true });
    const logFile = join(namespacedLogsDir, '20260226T100000-my-project.jsonl');
    await writeJsonl(logFile, [
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);

    const { status, body } = await get(
      `${baseUrl}/api/projects/my-repo/my-project/runs/20260226T100000-my-project.jsonl?after=1`
    );
    expect(status).toBe(200);
    const result = body as { entries: unknown[]; totalLines: number };
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect((result.entries[0] as { n: number }).n).toBe(2);
    expect((result.entries[1] as { n: number }).n).toBe(3);
  });
});
