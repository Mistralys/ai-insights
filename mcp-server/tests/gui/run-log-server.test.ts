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
