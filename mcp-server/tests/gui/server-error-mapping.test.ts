/**
 * apiErrorToStatus() mapping tests for gui/server.ts (WP-006)
 *
 * Verifies:
 *   AC-1: apiErrorToStatus('CONFLICT') returns 409.
 *   AC-2: CONFLICT errors are not silently swallowed by the default 500 branch.
 *   AC-08 (WP-005): a VALIDATION_ERROR thrown with a `details` payload still
 *          serializes on the wire as `{ error: { code, message } }` only —
 *          `details` never reaches the response body.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

import { apiErrorToStatus, dispatchRoute } from '../../gui/server.js';
import type { Route } from '../../gui/server.js';
import { ApiError } from '../../src/gui/errors.js';

describe('apiErrorToStatus()', () => {
  it("returns 404 for 'NOT_FOUND'", () => {
    expect(apiErrorToStatus('NOT_FOUND')).toBe(404);
  });

  it("returns 403 for 'FORBIDDEN'", () => {
    expect(apiErrorToStatus('FORBIDDEN')).toBe(403);
  });

  it("returns 400 for 'VALIDATION_ERROR'", () => {
    expect(apiErrorToStatus('VALIDATION_ERROR')).toBe(400);
  });

  it("returns 409 for 'CONFLICT' (not 500)", () => {
    expect(apiErrorToStatus('CONFLICT')).toBe(409);
  });

  it('returns 500 for an unknown error code', () => {
    expect(apiErrorToStatus('UNKNOWN_CODE')).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// AC-08 (WP-005): details never serialized on the wire
// ---------------------------------------------------------------------------

function startDispatchServer(routes: Route[]): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const method = req.method?.toUpperCase() ?? 'GET';
      const url = req.url ?? '/';
      dispatchRoute(req, res, method, url, 0, routes).catch(() => {
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

describe('sendError() wire shape — details never serialized', () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  it('serializes a VALIDATION_ERROR with details as { error: { code, message } } only', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/fail-validation',
        noBody: true,
        handler: async () => {
          throw new ApiError('VALIDATION_ERROR', 'temporary_prefix: must be 1-8 characters.', {
            fieldErrors: { temporary_prefix: ['secret-received-value'] },
          });
        },
      },
    ];

    ({ server, baseUrl } = await startDispatchServer(routes));

    const res = await fetch(`${baseUrl}/fail-validation`);
    expect(res.status).toBe(400);

    const rawText = await res.text();
    expect(rawText).not.toContain('secret-received-value');
    expect(rawText).not.toContain('fieldErrors');
    expect(rawText).not.toContain('details');

    const body = JSON.parse(rawText) as { error: { code: string; message: string } };
    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('temporary_prefix: must be 1-8 characters.');
  });
});
