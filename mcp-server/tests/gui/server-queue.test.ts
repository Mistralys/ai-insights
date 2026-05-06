/**
 * Integration smoke test for GET /api/orchestrator/queue in gui/server.ts (WP-005).
 *
 * Verifies:
 *   AC-1: Integration test sends GET request to /api/orchestrator/queue through handleRequest().
 *   AC-2: Test receives a valid response (200 with JSON array).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleRequest } from '../../gui/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startTestServer(
  ledgerRoot: string,
  configPath: string,
  logsDir: string,
): Promise<{ server: Server; baseUrl: string }> {
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

describe('GET /api/orchestrator/queue — WP-005', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'queue-test-ledger-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'queue-test-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');
    ({ server, baseUrl } = await startTestServer(ledgerRoot, configPath, logsDir));
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
    await rm(logsDir, { recursive: true, force: true });
  });

  it('AC-1/AC-2: returns 200 with a JSON array for an empty queue', async () => {
    const res = await fetch(`${baseUrl}/api/orchestrator/queue`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
