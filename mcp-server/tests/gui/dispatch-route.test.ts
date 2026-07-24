/**
 * Unit tests for dispatchRoute() in gui/server.ts (WP-002).
 *
 * Exercises dispatchRoute() in isolation using a real createServer() / fetch
 * pattern with synthetic Route arrays — no handleRequest(), no IncomingMessage
 * or ServerResponse mocks.
 *
 * Verified scenarios:
 *   AC-2: Query-parameter injection — handler receives URLSearchParams with expected entries.
 *   AC-3: No query string — handler receives an empty URLSearchParams.
 *   AC-4: noBody: true route — handler receives undefined as the body argument.
 *   AC-5: statusCode: 204 route — HTTP 204 with an empty body.
 *   AC-6: Handler throwing ApiError — mapped status code and error JSON.
 *   AC-7: Handler throwing a generic Error — HTTP 500, INTERNAL_ERROR code,
 *          process.stderr.write called.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute, apiErrorToStatus } from '../../gui/server.js';
import { ApiError } from '../../gui/api.js';
import type { Route } from '../../gui/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Starts a minimal test server that calls dispatchRoute() with the supplied
 * route table. If no route matches, responds with HTTP 404. Listens on an
 * ephemeral port (0) on loopback.
 */
function startDispatchServer(routes: Route[]): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const method = req.method?.toUpperCase() ?? 'GET';
      const url = req.url ?? '/';

      dispatchRoute(req, res, method, url, 0, routes).then((matched) => {
        if (!matched) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no route matched' } }));
        }
      }).catch((err) => {
        // This branch is not reachable in normal operation: dispatchRoute() catches all
        // handler errors internally (ApiError, PayloadTooLargeError, generic Error) and
        // always resolves its promise with a boolean. It is kept as a safety net for any
        // future refactor that changes that contract.
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('dispatchRoute() — WP-002', () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    if (server) await stopServer(server);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC-2: Query-parameter injection
  // -------------------------------------------------------------------------

  it('passes URLSearchParams with expected entries when query string is present', async () => {
    let capturedQuery: URLSearchParams | undefined;

    const routes: Route[] = [
      {
        method: 'GET',
        path: '/test',
        noBody: true,
        handler: async (_body, _groups, query) => {
          capturedQuery = query;
          return { ok: true };
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/test?key=value&foo=bar`);
    expect(res.status).toBe(200);
    expect(capturedQuery).toBeInstanceOf(URLSearchParams);
    expect(capturedQuery!.get('key')).toBe('value');
    expect(capturedQuery!.get('foo')).toBe('bar');
  });

  // -------------------------------------------------------------------------
  // AC-3: No query string — empty URLSearchParams
  // -------------------------------------------------------------------------

  it('passes an empty URLSearchParams when there is no query string', async () => {
    let capturedQuery: URLSearchParams | undefined;

    const routes: Route[] = [
      {
        method: 'GET',
        path: '/test',
        noBody: true,
        handler: async (_body, _groups, query) => {
          capturedQuery = query;
          return { ok: true };
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/test`);
    expect(res.status).toBe(200);
    expect(capturedQuery).toBeInstanceOf(URLSearchParams);
    expect([...capturedQuery!.entries()]).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-4: noBody: true — handler receives undefined as the body argument
  // -------------------------------------------------------------------------

  it('passes undefined as the body argument when noBody is true', async () => {
    let capturedBody: unknown = 'SENTINEL';

    const routes: Route[] = [
      {
        method: 'POST',
        path: '/no-body',
        noBody: true,
        handler: async (body) => {
          capturedBody = body;
          return { ok: true };
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/no-body`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(capturedBody).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // AC-5: statusCode: 204 — HTTP 204 with empty body
  // -------------------------------------------------------------------------

  it('returns HTTP 204 with an empty body for a route with statusCode: 204', async () => {
    const routes: Route[] = [
      {
        method: 'DELETE',
        path: '/item',
        noBody: true,
        statusCode: 204,
        handler: async () => {
          return undefined;
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/item`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  // -------------------------------------------------------------------------
  // AC-6: Handler throwing ApiError — mapped status code and error JSON
  // -------------------------------------------------------------------------

  it('returns the mapped status code and error JSON when the handler throws ApiError', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/fail-api',
        noBody: true,
        handler: async () => {
          throw new ApiError('NOT_FOUND', 'Resource not found.');
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/fail-api`);
    expect(res.status).toBe(apiErrorToStatus('NOT_FOUND'));
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Resource not found.');
  });

  // -------------------------------------------------------------------------
  // AC-7: Handler throwing a generic Error — HTTP 500, INTERNAL_ERROR,
  //        process.stderr.write called
  // -------------------------------------------------------------------------

  it('returns HTTP 500 with INTERNAL_ERROR and calls process.stderr.write for a generic Error', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const routes: Route[] = [
      {
        method: 'GET',
        path: '/fail-generic',
        noBody: true,
        handler: async () => {
          throw new Error('something went wrong');
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/fail-generic`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(stderrSpy).toHaveBeenCalled();
    const stderrOutput = stderrSpy.mock.calls.map((args) => String(args[0])).join('');
    expect(stderrOutput).toMatch(/server/);
  });
});
