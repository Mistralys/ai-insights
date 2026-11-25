/**
 * Server-level tests for the /api/tasks routes: wiring, status codes, guards
 * and the route table.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ctx = vi.hoisted(() => ({ stores: [] as Array<{ id: string; path: string; label: string }> }));

vi.mock('../../src/storage/store-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/storage/store-context.js')>(
    '../../src/storage/store-context.js',
  );
  return {
    ...actual,
    isStoreContextInitialized: () => true,
    getStoreRouter: () => ({
      getAllStores: () => ctx.stores,
      getAllStorePaths: () => ctx.stores.map((s) => s.path),
      isMultiStoreMode: () => ctx.stores.length > 1,
      resolveDefaultStore: () => ctx.stores[0]!.path,
    }),
  };
});

import { handleRequest, getRouteDescriptors } from '../../gui/server.js';
import { requireLoopbackRequest, requireJsonContentType } from '../../gui/route-guards.js';

function startTestServer(root: string): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, root, join(root, 'config.json'), 0, join(root, 'logs')).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
      else reject(new Error('no port'));
    });
    server.on('error', reject);
  });
}

describe('task routes', () => {
  let root: string;
  let server: Server;
  let baseUrl: string;

  const json = { 'Content-Type': 'application/json' };

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = json) {
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'task-routes-'));
    const storeA = join(root, 'a');
    const storeB = join(root, 'b');
    await mkdir(storeA);
    await mkdir(storeB);
    ctx.stores = [
      { id: 'a', path: storeA, label: 'Store A' },
      { id: 'b', path: storeB, label: 'Store B' },
    ];
    ({ server, baseUrl } = await startTestServer(root));
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });

  it('POST returns 201 and GET lists the task with its color', async () => {
    const created = await call('POST', '/api/tasks', { text: 'First', color: 'violet' });
    expect(created.status).toBe(201);
    const list = await call('GET', '/api/tasks');
    expect(list.status).toBe(200);
    expect(Object.keys(list.body).sort()).toEqual(['settings', 'store_errors', 'stores', 'tasks']);
    expect(list.body.tasks[0].color).toBe('violet');
    expect(list.body.stores[0]).toEqual({ id: 'a', label: 'Store A', is_default: true });
  });

  it('validates bodies, ids, stores and strict keys', async () => {
    expect((await call('POST', '/api/tasks', { text: 'x', bogus: 1 })).status).toBe(400);
    expect((await call('POST', '/api/tasks', { text: 'x', color: '#8b5cf6' })).status).toBe(400);
    expect((await call('POST', '/api/tasks', { text: 'x', store_id: 'nope' })).status).toBe(404);
    const bad = await call('PATCH', '/api/tasks/not-a-uuid', { text: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Invalid task id.');
    expect((await call('PATCH', `/api/tasks/${randomUUID()}`, { text: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/tasks/${randomUUID()}`)).status).toBe(404);
  });

  it('PATCH persists and DELETE removes', async () => {
    const created = (await call('POST', '/api/tasks', { text: 'T' })).body;
    const patched = await call('PATCH', `/api/tasks/${created.id}`, { color: 'violet' });
    expect(patched.status).toBe(200);
    expect(patched.body.color).toBe('violet');
    expect((await call('PATCH', `/api/tasks/${created.id}`, { color: '' })).status).toBe(200);
    expect((await call('PATCH', `/api/tasks/${created.id}`, { color: null })).status).toBe(400);

    expect((await call('DELETE', `/api/tasks/${created.id}`)).status).toBe(200);
    expect((await call('GET', '/api/tasks')).body.tasks).toHaveLength(0);
  });

  it('POST /api/tasks/order is routed to reorder, not an :id route', async () => {
    const t1 = (await call('POST', '/api/tasks', { text: 'one', store_id: 'a' })).body;
    const t2 = (await call('POST', '/api/tasks', { text: 'two', store_id: 'b' })).body;
    const out = await call('POST', '/api/tasks/order', {
      assignments: [
        { id: t1.id, priority: 50 },
        { id: t2.id, priority: 60 },
      ],
    });
    expect(out.status).toBe(200);
    expect(out.body.updated).toHaveLength(2);
    expect(out.body.failed).toEqual([]);
    expect((await call('POST', '/api/tasks/order', { assignments: [] })).status).toBe(400);
  });

  it('mutations reject a foreign Origin with 403; GET does not', async () => {
    const evil = { ...json, Origin: 'http://evil.example' };
    expect((await call('POST', '/api/tasks', { text: 'x' }, evil)).status).toBe(403);
    expect((await call('POST', '/api/tasks/order', { assignments: [] }, evil)).status).toBe(403);
    expect((await call('PATCH', `/api/tasks/${randomUUID()}`, {}, evil)).status).toBe(403);
    expect((await call('DELETE', `/api/tasks/${randomUUID()}`, undefined, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/tasks', undefined, { Origin: 'http://evil.example' })).status).toBe(200);
  });

  it('body routes reject a non-JSON content type with 415', async () => {
    const res = await fetch(baseUrl + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"text":"x"}',
    });
    expect(res.status).toBe(415);
  });

  describe('route table', () => {
    const taskRoutes = () =>
      getRouteDescriptors().filter((r) => {
        const p = typeof r.path === 'string' ? r.path : r.path.source;
        return p.includes('/api/tasks') || p.includes('\\/api\\/tasks');
      });

    it('guards every mutation and leaves GET open', () => {
      const routes = taskRoutes();
      expect(routes).toHaveLength(5);
      for (const r of routes) {
        if (r.method === 'GET') {
          expect(r.guards).toBeUndefined();
          continue;
        }
        expect(r.guards).toContain(requireLoopbackRequest);
        if (r.method === 'DELETE') expect(r.guards).not.toContain(requireJsonContentType);
        else expect(r.guards).toContain(requireJsonContentType);
      }
    });

    it('declares POST /api/tasks/order before the :id routes and POST /api/tasks with 201', () => {
      const routes = getRouteDescriptors();
      const idx = (m: string, p: string) => routes.findIndex((r) => r.method === m && r.path === p);
      expect(idx('POST', '/api/tasks/order')).toBeGreaterThanOrEqual(0);
      expect(routes[idx('POST', '/api/tasks')]!.statusCode).toBe(201);
    });
  });
});
