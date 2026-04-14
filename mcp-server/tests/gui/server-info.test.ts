/**
 * Integration tests for GET /api/server-info in gui/server.ts (WP-003).
 *
 * Verifies:
 *   - 200 JSON response with stale, bootVersions, diskVersions fields
 *   - stale: false when boot versions match disk versions
 *   - stale: true when any boot version differs from the current disk version
 *   - CORS and security headers are present on the response
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleRequest } from '../../gui/server.js';
import { captureWorkspaceVersions } from '../../src/utils/workspace-versions.js';
import type { WorkspaceVersions } from '../../src/utils/workspace-versions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startTestServer(
  ledgerRoot: string,
  configPath: string,
  logsDir: string,
  bootVersions?: WorkspaceVersions,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, ledgerRoot, configPath, 0, logsDir, bootVersions ?? null).catch(
        (err) => {
          process.stderr.write(`[test-server] Unhandled: ${String(err)}\n`);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'error' } }));
          }
        },
      );
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

describe('GET /api/server-info — WP-003', () => {
  let ledgerRoot: string;
  let logsDir: string;
  let configPath: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'server-info-test-ledger-'));
    logsDir = await mkdtemp(join(tmpdir(), 'server-info-test-logs-'));
    configPath = join(ledgerRoot, 'gui-config.json');
  });

  afterEach(async () => {
    await stopServer(server);
    await rm(ledgerRoot, { recursive: true, force: true });
    await rm(logsDir, { recursive: true, force: true });
  });

  it('returns 200 with stale, bootVersions, diskVersions fields', async () => {
    ({ server, baseUrl } = await startTestServer(ledgerRoot, configPath, logsDir));

    const res = await fetch(`${baseUrl}/api/server-info`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      stale: boolean;
      bootVersions: WorkspaceVersions;
      diskVersions: WorkspaceVersions;
    };
    expect(typeof body.stale).toBe('boolean');
    expect(body.bootVersions).toHaveProperty('mcpServer');
    expect(body.bootVersions).toHaveProperty('personas');
    expect(body.bootVersions).toHaveProperty('orchestrator');
    expect(body.diskVersions).toHaveProperty('mcpServer');
    expect(body.diskVersions).toHaveProperty('personas');
    expect(body.diskVersions).toHaveProperty('orchestrator');
  });

  it('returns stale: false when boot versions match disk versions', async () => {
    // Capture the real current disk versions to use as bootVersions.
    const currentVersions = captureWorkspaceVersions();
    ({ server, baseUrl } = await startTestServer(ledgerRoot, configPath, logsDir, currentVersions));

    const res = await fetch(`${baseUrl}/api/server-info`);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(false);
  });

  it('returns stale: true when MCP server boot version differs from disk', async () => {
    const currentVersions = captureWorkspaceVersions();
    const staleBootVersions: WorkspaceVersions = {
      ...currentVersions,
      mcpServer: '0.0.0-stale-test',
    };
    ({ server, baseUrl } = await startTestServer(
      ledgerRoot,
      configPath,
      logsDir,
      staleBootVersions,
    ));

    const res = await fetch(`${baseUrl}/api/server-info`);
    const body = (await res.json()) as {
      stale: boolean;
      bootVersions: WorkspaceVersions;
      diskVersions: WorkspaceVersions;
    };
    expect(body.stale).toBe(true);
    expect(body.bootVersions.mcpServer).toBe('0.0.0-stale-test');
    expect(body.diskVersions.mcpServer).toBe(currentVersions.mcpServer);
  });

  it('returns stale: true when personas boot version differs from disk', async () => {
    const currentVersions = captureWorkspaceVersions();
    const staleBootVersions: WorkspaceVersions = {
      ...currentVersions,
      personas: '0.0.0-stale-test',
    };
    ({ server, baseUrl } = await startTestServer(
      ledgerRoot,
      configPath,
      logsDir,
      staleBootVersions,
    ));

    const res = await fetch(`${baseUrl}/api/server-info`);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it('returns stale: true when orchestrator boot version differs from disk', async () => {
    const currentVersions = captureWorkspaceVersions();
    const staleBootVersions: WorkspaceVersions = {
      ...currentVersions,
      orchestrator: '0.0.0-stale-test',
    };
    ({ server, baseUrl } = await startTestServer(
      ledgerRoot,
      configPath,
      logsDir,
      staleBootVersions,
    ));

    const res = await fetch(`${baseUrl}/api/server-info`);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it('applies CORS and security headers to the response', async () => {
    ({ server, baseUrl } = await startTestServer(ledgerRoot, configPath, logsDir));

    const res = await fetch(`${baseUrl}/api/server-info`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
