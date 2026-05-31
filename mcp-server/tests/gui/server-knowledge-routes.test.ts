/**
 * WP-009 QA: Server-level routing tests for the 5 knowledge HTTP endpoints.
 *
 * These tests exercise the HTTP dispatch layer in gui/server.ts — specifically
 * that each route is correctly wired, that query-string parameters are parsed
 * and forwarded to the handler, that the two body-parsing routes (PATCH and
 * POST /move) use handleRequest() special-case branches, and that the three
 * body-free routes (GET, DELETE, POST /promote) are dispatched through
 * matchRoute().
 *
 * AC coverage:
 *   AC-1  GET /api/knowledge — routes through matchRoute(), all query params parsed
 *   AC-2  DELETE /api/knowledge/:id — routes through matchRoute(), scope/repository_name from QS
 *   AC-3  POST /api/knowledge/:id/promote — routes through matchRoute(), scope/repository_name from QS
 *   AC-4  PATCH /api/knowledge/:id — special case in handleRequest(), body parsing + error handling
 *   AC-5  POST /api/knowledge/:id/move — special case in handleRequest(), body parsing + error handling
 *   AC-6  Two-tier dispatch pattern (body-free in matchRoute, body-parsing in handleRequest)
 *   AC-7  Knowledge routes do not interfere with existing routes (insights, projects, orchestrator)
 *
 * Edge cases:
 *   - PATCH with oversized body returns 413
 *   - POST /move with oversized body returns 413
 *   - PATCH with invalid JSON body returns 400
 *   - POST /move with invalid JSON body returns 400
 *   - GET /api/knowledge with no query params returns 200 JSON array (empty store)
 *   - DELETE /api/knowledge/:id without scope returns 400 VALIDATION_ERROR
 *   - POST /api/knowledge/:id/promote with scope=global returns 400 VALIDATION_ERROR
 *   - Unrelated routes (GET /api/insights, GET /api/projects) still return 200/404, not confused
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';

import { handleRequest, MAX_BODY_BYTES } from '../../gui/server.js';
import { KnowledgeStoreManager } from '../../src/storage/knowledge-store.js';
import type { Insight } from '../../src/schema/knowledge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startTestServer(
  ledgerRoot: string,
  configPath: string,
  logsDir: string,
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
        resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port });
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

/** Send a raw HTTP request over TCP and return the response status code. */
function getRawStatus(host: string, port: number, rawRequest: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port }, () => {
      socket.write(rawRequest);
    });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const sofar = Buffer.concat(chunks).toString('utf-8');
      const m = sofar.match(/^HTTP\/\d\.\d (\d{3})/);
      if (m) {
        socket.destroy();
        resolve(parseInt(m[1]!, 10));
      }
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const sofar = Buffer.concat(chunks).toString('utf-8');
      const m = sofar.match(/^HTTP\/\d\.\d (\d{3})/);
      if (m) resolve(parseInt(m[1]!, 10));
      else reject(new Error('No HTTP status line received'));
    });
  });
}

/** Minimal valid insight input. */
function makeInsightInput(overrides: Partial<Omit<Insight, 'id'>> = {}): Omit<Insight, 'id'> {
  return {
    scope: 'global',
    title: 'Test insight',
    content: 'Test content',
    category: 'general',
    tags: [],
    source: 'qa-test',
    created_at: '2026-01-01T00:00:00Z',
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WP-009 — Knowledge route wiring in gui/server.ts', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;
  let port: number;
  let manager: KnowledgeStoreManager;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'wp009-knowledge-route-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'wp009-knowledge-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');
    ({ server, baseUrl, port } = await startTestServer(ledgerRoot, configPath, logsDir));
    manager = new KnowledgeStoreManager(ledgerRoot);
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
    await rm(logsDir, { recursive: true, force: true });
  });

  // ─── AC-1: GET /api/knowledge ────────────────────────────────────────────

  describe('GET /api/knowledge (AC-1)', () => {
    it('returns 200 with empty array when store is empty', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    });

    it('returns 200 with all insights when store has entries', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global A' }));
      await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'my-repo', title: 'Repository B' }));
      const res = await fetch(`${baseUrl}/api/knowledge`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(2);
    });

    it('forwards scope query param to handler', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
      await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'x', title: 'Repository' }));
      const res = await fetch(`${baseUrl}/api/knowledge?scope=global`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(1);
      expect(body[0]!.scope).toBe('global');
    });

    it('forwards scope+repository_name query params to handler', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'alpha', title: 'Alpha' }));
      await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'beta', title: 'Beta' }));
      const res = await fetch(`${baseUrl}/api/knowledge?scope=repository&repository_name=alpha`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(1);
      expect(body[0]!.title).toBe('Alpha');
    });

    it('forwards category query param to handler', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Best practice', category: 'best-practice' }));
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Other', category: 'general' }));
      const res = await fetch(`${baseUrl}/api/knowledge?category=best-practice`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(1);
      expect(body[0]!.title).toBe('Best practice');
    });

    it('forwards tags query param to handler', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Node insight', tags: ['node', 'backend'] }));
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Other', tags: ['frontend'] }));
      const res = await fetch(`${baseUrl}/api/knowledge?tags=node`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(1);
      expect(body[0]!.title).toBe('Node insight');
    });

    it('forwards query param (full-text search) to handler', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Use atomic commits', content: 'Keep commits small.' }));
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Documentation matters', content: 'Write clear docs.' }));
      const res = await fetch(`${baseUrl}/api/knowledge?query=atomic`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(1);
      expect(body[0]!.title).toBe('Use atomic commits');
    });

    it('forwards limit and offset query params to handler', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.addInsight(makeInsightInput({ scope: 'global', title: `Insight ${i}` }));
      }
      const res = await fetch(`${baseUrl}/api/knowledge?limit=2&offset=1`);
      expect(res.status).toBe(200);
      const body = await res.json() as Insight[];
      expect(body).toHaveLength(2);
    });

    it('returns 400 VALIDATION_ERROR for unknown scope value', async () => {
      await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Global' }));
      const res = await fetch(`${baseUrl}/api/knowledge?scope=bogus`);
      // Handler now rejects unrecognised scope values with VALIDATION_ERROR
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── AC-2: DELETE /api/knowledge/:id ─────────────────────────────────────

  describe('DELETE /api/knowledge/:id (AC-2)', () => {
    it('returns 200 null after successful deletion (global scope)', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'global' }));
      const res = await fetch(`${baseUrl}/api/knowledge/${insight.id}?scope=global`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });

    it('returns 200 null after successful deletion (repository scope)', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'my-repo' }));
      const res = await fetch(
        `${baseUrl}/api/knowledge/${insight.id}?scope=repository&repository_name=my-repo`,
        { method: 'DELETE' }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });

    it('returns 400 when scope query param is missing', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/999`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when insight does not exist', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/9999?scope=global`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('forwards repository_name from query string to handler', async () => {
      // Without repository_name when scope=repository, should return 400
      const res = await fetch(`${baseUrl}/api/knowledge/1?scope=repository`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── AC-3: POST /api/knowledge/:id/promote ────────────────────────────────

  describe('POST /api/knowledge/:id/promote (AC-3)', () => {
    it('promotes a repository-scoped insight to global and returns 200', async () => {
      const insight = await manager.addInsight(
        makeInsightInput({ scope: 'repository', repository_name: 'my-repo' })
      );
      const res = await fetch(
        `${baseUrl}/api/knowledge/${insight.id}/promote?scope=repository&repository_name=my-repo`,
        { method: 'POST' }
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Insight;
      expect(body.scope).toBe('global');
    });

    it('returns 400 VALIDATION_ERROR when scope=global (already global)', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'global' }));
      const res = await fetch(
        `${baseUrl}/api/knowledge/${insight.id}/promote?scope=global`,
        { method: 'POST' }
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when scope is missing', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1/promote`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('forwards scope and repository_name query params to handler', async () => {
      // scope=repository but missing repository_name → 400
      const res = await fetch(
        `${baseUrl}/api/knowledge/1/promote?scope=repository`,
        { method: 'POST' }
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── AC-4: PATCH /api/knowledge/:id ──────────────────────────────────────

  describe('PATCH /api/knowledge/:id (AC-4)', () => {
    it('returns 200 with updated insight on valid body', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'global', title: 'Original title' }));
      const res = await fetch(`${baseUrl}/api/knowledge/${insight.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global', title: 'Updated title' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Insight;
      expect(body.title).toBe('Updated title');
    });

    it('returns 400 VALIDATION_ERROR on invalid JSON body', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'this is not json',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when body has unknown fields', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'global' }));
      const res = await fetch(`${baseUrl}/api/knowledge/${insight.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global', unknown_field: 'oops' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when insight does not exist', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/9999`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global', title: 'New title' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 413 when body exceeds MAX_BODY_BYTES (Content-Length pre-check)', async () => {
      const rawRequest = [
        `PATCH /api/knowledge/1 HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Content-Type: application/json',
        `Content-Length: ${MAX_BODY_BYTES + 1}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      const status = await getRawStatus('127.0.0.1', port, rawRequest);
      expect(status).toBe(413);
    });

    it('returns 413 when streaming body exceeds MAX_BODY_BYTES', async () => {
      const oversizedBody = Buffer.alloc(MAX_BODY_BYTES + 1, 'x');
      const res = await fetch(`${baseUrl}/api/knowledge/1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedBody,
        // @ts-expect-error — duplex required for streaming bodies in Node.js fetch
        duplex: 'half',
      });
      await res.text().catch(() => {});
      expect(res.status).toBe(413);
    });
  });

  // ─── AC-5: POST /api/knowledge/:id/move ──────────────────────────────────

  describe('POST /api/knowledge/:id/move (AC-5)', () => {
    it('returns 200 with moved insight on valid body (global → repository)', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'global' }));
      const res = await fetch(`${baseUrl}/api/knowledge/${insight.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_scope: 'global',
          repository_name: 'target-repo',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Insight;
      expect(body.scope).toBe('repository');
      expect(body.repository_name).toBe('target-repo');
    });

    it('returns 400 VALIDATION_ERROR on invalid JSON body', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when body is missing required fields', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_scope: 'global' }), // missing repository_name
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when source_repository_name missing for repository source', async () => {
      const insight = await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'source-repo' }));
      const res = await fetch(`${baseUrl}/api/knowledge/${insight.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_scope: 'repository', // source_repository_name missing
          repository_name: 'target-repo',
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 413 when body exceeds MAX_BODY_BYTES (Content-Length pre-check)', async () => {
      const rawRequest = [
        `POST /api/knowledge/1/move HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Content-Type: application/json',
        `Content-Length: ${MAX_BODY_BYTES + 1}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      const status = await getRawStatus('127.0.0.1', port, rawRequest);
      expect(status).toBe(413);
    });

    it('returns 413 when streaming body exceeds MAX_BODY_BYTES', async () => {
      const oversizedBody = Buffer.alloc(MAX_BODY_BYTES + 1, 'x');
      const res = await fetch(`${baseUrl}/api/knowledge/1/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedBody,
        // @ts-expect-error — duplex required for streaming bodies in Node.js fetch
        duplex: 'half',
      });
      await res.text().catch(() => {});
      expect(res.status).toBe(413);
    });
  });

  // ─── AC-6 & AC-7: No route interference + two-tier dispatch ─────────────

  describe('Route isolation — knowledge routes do not shadow existing routes (AC-6, AC-7)', () => {
    it('GET /api/insights still responds (does not conflict with GET /api/knowledge)', async () => {
      // /api/insights returns 200 (may have empty data)
      const res = await fetch(`${baseUrl}/api/insights`);
      expect(res.status).toBe(200);
    });

    it('GET /api/projects still responds (does not conflict with GET /api/knowledge)', async () => {
      const res = await fetch(`${baseUrl}/api/projects`);
      expect(res.status).toBe(200);
    });

    it('unknown route returns 404, not knowledge route', async () => {
      const res = await fetch(`${baseUrl}/api/knowledgex`);
      expect(res.status).toBe(404);
    });

    it('GET /api/knowledge/:id returns 404 (not a valid route — no GET for single item)', async () => {
      // There is no GET /api/knowledge/:id route; should 404
      const res = await fetch(`${baseUrl}/api/knowledge/1`);
      expect(res.status).toBe(404);
    });

    it('PATCH /api/knowledge/:id/extra returns 404 (no such route — too many segments)', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1/extra`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // The regex /^\/api\/knowledge\/([^/]+)$/ does NOT match /api/knowledge/1/extra
      expect(res.status).toBe(404);
    });

    it('POST /api/knowledge/:id/promote does not consume body (body-free route)', async () => {
      // Even when a body is present, promote route is handled by matchRoute() (body-free).
      // The handler validates scope from QS — no body consumed.
      const insight = await manager.addInsight(makeInsightInput({ scope: 'repository', repository_name: 'p' }));
      const res = await fetch(
        `${baseUrl}/api/knowledge/${insight.id}/promote?scope=repository&repository_name=p`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unexpected: 'body' }), // body is ignored
        }
      );
      // Should succeed — the body is irrelevant for matchRoute() handlers
      expect(res.status).toBe(200);
    });
  });

  // ─── Edge cases: ID validation ───────────────────────────────────────────

  describe('Edge cases — ID validation', () => {
    it('GET /api/knowledge returns 200 regardless (no ID in path)', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge`);
      expect(res.status).toBe(200);
    });

    it('PATCH /api/knowledge/not-a-number returns 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/not-a-number`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('DELETE /api/knowledge/0 returns 400 VALIDATION_ERROR (zero is invalid)', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/0?scope=global`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/knowledge/1.5/promote returns 400 VALIDATION_ERROR (float ID)', async () => {
      const res = await fetch(`${baseUrl}/api/knowledge/1.5/promote?scope=repository&repository_name=p`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
