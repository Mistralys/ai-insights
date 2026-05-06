/**
 * Body size-cap tests for gui/server.ts (WP-002)
 *
 * Verifies:
 *   AC-2: readBody() rejects payloads that declare a Content-Length > MAX_BODY_BYTES.
 *   AC-3: readBody() rejects payloads that exceed MAX_BODY_BYTES via streaming byte count.
 *   AC-4: handleRequest() returns 413 for Payload Too Large errors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleRequest, MAX_BODY_BYTES } from '../../gui/server.js';

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

/**
 * Sends a raw HTTP request over a plain TCP socket and returns the
 * status code extracted from the first response line.
 *
 * fetch validates Content-Length/body consistency and rejects before
 * sending when they do not match, so this helper is needed to exercise
 * the Content-Length pre-check path.
 */
function getRawStatus(host: string, port: number, rawRequest: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port }, () => {
      socket.write(rawRequest);
    });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      // Once we have the status line we can bail out.
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

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Body size cap — WP-002', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;
  let port: number;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'body-limit-ledger-'));
    logsDir    = await mkdtemp(join(tmpdir(), 'body-limit-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');
    ({ server, baseUrl, port } = await startTestServer(ledgerRoot, configPath, logsDir));
  });

  afterEach(async () => {
    await stopServer(server);
  });

  it('MAX_BODY_BYTES is 1_048_576 (1 MiB)', () => {
    expect(MAX_BODY_BYTES).toBe(1_048_576);
  });

  it('AC-2: returns 413 when Content-Length exceeds MAX_BODY_BYTES (pre-check)', async () => {
    // Use a raw TCP socket because fetch validates Content-Length vs. body size
    // client-side and throws before sending the request if they mismatch.
    const rawRequest = [
      'PUT /api/config HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Content-Type: application/json',
      `Content-Length: ${MAX_BODY_BYTES + 1}`,
      'Connection: close',
      '',
      '',  // no body — server should reject before reading any data
    ].join('\r\n');

    const status = await getRawStatus('127.0.0.1', port, rawRequest);
    expect(status).toBe(413);
  });

  it('AC-2: pre-check path drains socket cleanly when body data follows', async () => {
    // Send a request with Content-Length > MAX_BODY_BYTES AND some actual body bytes.
    // The req.resume() call should drain the socket so the 413 is sent without hanging.
    const bodyChunk = 'x'.repeat(1024);
    const rawRequest = [
      'PUT /api/config HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Content-Type: application/json',
      `Content-Length: ${MAX_BODY_BYTES + 1}`,
      'Connection: close',
      '',
      bodyChunk,
    ].join('\r\n');

    const status = await getRawStatus('127.0.0.1', port, rawRequest);
    expect(status).toBe(413);
  });

  it('AC-3 / AC-4: returns 413 when streaming body exceeds MAX_BODY_BYTES', async () => {
    // Build a body that is MAX_BODY_BYTES + 1 bytes without a Content-Length header,
    // so the streaming byte-count fallback is exercised rather than the pre-check.
    const oversizedBody = Buffer.alloc(MAX_BODY_BYTES + 1, 'x');

    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedBody,
      // @ts-expect-error — duplex required for streaming bodies in Node.js fetch
      duplex: 'half',
    });
    await res.text().catch(() => {});
    expect(res.status).toBe(413);
  });
});
