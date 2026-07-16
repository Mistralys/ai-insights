/**
 * Tests for the ?format=structured query parameter on the /rendered chunk routes.
 *
 * AC-06: Automated tests exist for the ?format=structured query parameter on
 * both the deprecated and namespaced /rendered routes.
 *
 * Uses the same HTTP-server test pattern as server-knowledge-routes.test.ts:
 * spin up a real server with handleRequest(), make HTTP requests, verify the
 * response shape.  A real temporary ledger root with a real chunk file is used
 * to exercise the complete request path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleRequest } from '../../gui/server.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import { readConfigFromDisk, __resetForTesting } from '../../src/gui/config.js';
import { now } from '../../src/utils/timestamp.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal valid JSONL chunk with a single AIMessageChunk producing a text block. */
const SAMPLE_JSONL =
  JSON.stringify({ chunk_format: 1, stream_mode: 'messages', langgraph_stream_version: 'v2' }) +
  '\n' +
  JSON.stringify({
    ns: [],
    msg: { type: 'AIMessageChunk', id: 'msg-1', content: 'hello world' },
    metadata: {},
  }) +
  '\n';

/** Chunk filename that passes CHUNK_FILENAME_RE: /^[A-Za-z0-9_-]+\.jsonl$/ */
const CHUNK_FILENAME = 'test-chunk.jsonl';

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

// ---------------------------------------------------------------------------
// Response shape types (used in test assertions instead of inline casts)
// ---------------------------------------------------------------------------

type StructuredBody = { blocks: unknown[] };
type DialogueBody = { content: string };

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------

function startTestServer(
  ledgerRoot: string,
  configPath: string,
  logsDir: string,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, ledgerRoot, configPath, 0, logsDir).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: String(err) } }));
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

async function get(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('?format=structured — /rendered route query parameter', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;
  /** slug used in all tests — must match SAFE_SLUG_REGEX AND the plan folder pattern YYYY-MM-DD-{name} */
  const SLUG = '2026-01-01-test';
  /** repo name — must match SAFE_SLUG_REGEX (= the 'unknown' bucket for tmpdir planPaths) */
  const REPO = 'unknown';

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'route-structured-test-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'route-structured-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');

    // Initialise config
    __resetForTesting();
    await readConfigFromDisk(configPath);

    // Create the project in the namespaced storage directory.
    // Using planPath = join(tmpdir(), SLUG) causes deriveRepoName() to return 'unknown'
    // (no docs/agents path component), so storageDir = {ledgerRoot}/unknown/{SLUG}/.
    const planPath = join(tmpdir(), SLUG);
    const store = new LedgerStore(planPath, ledgerRoot);
    await store.writeRootIndex(makeRoot());

    // Create the chunk file inside the project's orchestrator/chunks directory.
    const chunksDir = join(ledgerRoot, REPO, SLUG, 'orchestrator', 'chunks');
    await mkdir(chunksDir, { recursive: true });
    await writeFile(join(chunksDir, CHUNK_FILENAME), SAMPLE_JSONL, 'utf-8');

    ({ server, baseUrl } = await startTestServer(ledgerRoot, configPath, logsDir));
  });

  afterEach(async () => {
    __resetForTesting();
    if (server) await stopServer(server);
    if (ledgerRoot) await rm(ledgerRoot, { recursive: true, force: true });
    if (logsDir)    await rm(logsDir,    { recursive: true, force: true });
  });

  // ─── Deprecated (non-namespaced) route ───────────────────────────────────

  describe('deprecated route: GET /api/projects/:slug/chunks/:filename/rendered', () => {
    it('returns { blocks: Array } when ?format=structured is present', async () => {
      const { status, body } = await get(
        baseUrl,
        `/api/projects/${SLUG}/chunks/${CHUNK_FILENAME}/rendered?format=structured`,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ blocks: expect.any(Array) });
      expect((body as StructuredBody).blocks.length).toBeGreaterThanOrEqual(1);
    });

    it('returns { content: string } when ?format=structured is absent (default format)', async () => {
      const { status, body } = await get(
        baseUrl,
        `/api/projects/${SLUG}/chunks/${CHUNK_FILENAME}/rendered`,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ content: expect.any(String) });
      expect((body as DialogueBody).content).toContain('hello world');
    });

    it('returns { content: string } for an unrecognised format value', async () => {
      const { status, body } = await get(
        baseUrl,
        `/api/projects/${SLUG}/chunks/${CHUNK_FILENAME}/rendered?format=unknown`,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ content: expect.any(String) });
    });
  });

  // ─── Namespaced route ─────────────────────────────────────────────────────

  describe('namespaced route: GET /api/projects/:repo/:slug/chunks/:filename/rendered', () => {
    it('returns { blocks: Array } when ?format=structured is present', async () => {
      const { status, body } = await get(
        baseUrl,
        `/api/projects/${REPO}/${SLUG}/chunks/${CHUNK_FILENAME}/rendered?format=structured`,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ blocks: expect.any(Array) });
      expect((body as StructuredBody).blocks.length).toBeGreaterThanOrEqual(1);
    });

    it('returns { content: string } when ?format=structured is absent (default format)', async () => {
      const { status, body } = await get(
        baseUrl,
        `/api/projects/${REPO}/${SLUG}/chunks/${CHUNK_FILENAME}/rendered`,
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ content: expect.any(String) });
      expect((body as DialogueBody).content).toContain('hello world');
    });
  });
});
