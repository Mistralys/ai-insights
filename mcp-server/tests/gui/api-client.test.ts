// @vitest-environment jsdom

/**
 * Tests for gui/public/api-client.js — run log methods and server-info endpoint.
 *
 * Uses jsdom + vm.runInThisContext to load the browser-side script, then mocks
 * globalThis.fetch to assert the URLs and options that API methods produce.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Load client script
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');
const apiClientJs = readFileSync(join(publicDir, 'api-client.js'), 'utf-8');

// Execute once so the API var is available globally (as in a browser)
beforeAll(() => {
  vm.runInThisContext(apiClientJs);
});

// Declare globalThis.API for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var API: {
    getRunLogs: (slug: string) => Promise<unknown>;
    getRunLogEntries: (slug: string, filename: string, afterLine?: number) => Promise<unknown>;
    [key: string]: (...args: unknown[]) => Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Installs a mock `fetch` on globalThis that resolves with the provided JSON
 * body and records the most-recent call arguments.
 */
function mockFetch(responseBody: unknown = null, status = 200) {
  const calls: { url: string; opts: RequestInit }[] = [];
  const mockFn = vi.fn(async (url: string, opts: RequestInit) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    };
  });
  // jsdom exposes globalThis.fetch — replace it for the duration of the test
  (globalThis as unknown as Record<string, unknown>)['fetch'] = mockFn;
  return calls;
}

// ---------------------------------------------------------------------------
// getRunLogs
// ---------------------------------------------------------------------------

describe('API.getRunLogs', () => {
  it('calls GET /api/projects/{slug}/runs', async () => {
    const calls = mockFetch([]);

    await globalThis.API.getRunLogs('my-slug');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/projects/my-slug/runs');
    expect(calls[0]!.opts.method).toBe('GET');
  });

  it('encodes the slug via encodeURIComponent', async () => {
    const calls = mockFetch([]);

    await globalThis.API.getRunLogs('slug with spaces');

    expect(calls[0]!.url).toBe('/api/projects/slug%20with%20spaces/runs');
  });
});

// ---------------------------------------------------------------------------
// getRunLogEntries
// ---------------------------------------------------------------------------

describe('API.getRunLogEntries', () => {
  it('calls GET /api/projects/{slug}/runs/{filename} without ?after when afterLine is omitted', async () => {
    const calls = mockFetch({ entries: [], totalLines: 0 });

    await globalThis.API.getRunLogEntries('my-slug', 'file.jsonl');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/projects/my-slug/runs/file.jsonl');
    expect(calls[0]!.url).not.toContain('?after=');
  });

  it('appends ?after={afterLine} when afterLine is provided', async () => {
    const calls = mockFetch({ entries: [], totalLines: 10 });

    await globalThis.API.getRunLogEntries('my-slug', '20260225T113355-my-slug.jsonl', 5);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/projects/my-slug/runs/20260225T113355-my-slug.jsonl?after=5');
  });

  it('encodes the filename via encodeURIComponent', async () => {
    const calls = mockFetch({ entries: [], totalLines: 0 });

    // A filename with a space — unlikely in practice but must be safe
    await globalThis.API.getRunLogEntries('my-slug', 'file name.jsonl');

    expect(calls[0]!.url).toBe('/api/projects/my-slug/runs/file%20name.jsonl');
  });

  it('encodes the slug via encodeURIComponent', async () => {
    const calls = mockFetch({ entries: [], totalLines: 0 });

    await globalThis.API.getRunLogEntries('slug/with/slashes', 'file.jsonl');

    expect(calls[0]!.url).toBe('/api/projects/slug%2Fwith%2Fslashes/runs/file.jsonl');
  });

  it('appends ?after=0 when afterLine is explicitly 0 (valid offset)', async () => {
    // afterLine: 0 is a legitimate value meaning "skip 0 lines" — include it in the URL
    const calls = mockFetch({ entries: [], totalLines: 5 });

    await globalThis.API.getRunLogEntries('my-slug', 'file.jsonl', 0);

    expect(calls[0]!.url).toContain('?after=0');
  });
});

// ---------------------------------------------------------------------------
// getServerInfo
// ---------------------------------------------------------------------------

describe('API.getServerInfo', () => {
  it('calls GET /api/server-info and resolves to the server-info payload', async () => {
    const payload = { stale: false, bootVersions: {}, diskVersions: {} };
    const calls = mockFetch(payload);

    const result = await globalThis.API.getServerInfo();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/server-info');
    expect(calls[0]!.opts.method).toBe('GET');
    expect(result).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator methods
// ---------------------------------------------------------------------------

describe('API.orchestratorStart', () => {
  it('sends POST /api/orchestrator/start with planPath and dryRun in body', async () => {
    const calls = mockFetch({ started: true, pid: 99, checks: [] });

    await globalThis.API.orchestratorStart('/path/to/plan.md', false);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/orchestrator/start');
    expect(calls[0]!.opts.method).toBe('POST');
    expect(calls[0]!.opts.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(calls[0]!.opts.body as string);
    expect(body).toEqual({ planPath: '/path/to/plan.md', dryRun: false });
  });

  it('passes dryRun: true when requested', async () => {
    const calls = mockFetch({ started: false, checks: [] });

    await globalThis.API.orchestratorStart('/path/to/plan.md', true);

    const body = JSON.parse(calls[0]!.opts.body as string);
    expect(body.dryRun).toBe(true);
  });
});

describe('API.orchestratorGetQueue', () => {
  it('sends GET /api/orchestrator/queue', async () => {
    const calls = mockFetch([]);

    await globalThis.API.orchestratorGetQueue();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/orchestrator/queue');
    expect(calls[0]!.opts.method).toBe('GET');
  });
});

describe('API.orchestratorKill', () => {
  it('sends POST /api/orchestrator/kill/{id}', async () => {
    const calls = mockFetch(null, 204);

    await globalThis.API.orchestratorKill('abc-123');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/orchestrator/kill/abc-123');
    expect(calls[0]!.opts.method).toBe('POST');
  });

  it('encodes the entry ID in the URL', async () => {
    const calls = mockFetch(null, 204);

    await globalThis.API.orchestratorKill('id/with/slashes');

    expect(calls[0]!.url).toBe('/api/orchestrator/kill/id%2Fwith%2Fslashes');
  });
});

describe('API.orchestratorDismiss', () => {
  it('sends POST /api/orchestrator/dismiss/{id}', async () => {
    const calls = mockFetch(null, 204);

    await globalThis.API.orchestratorDismiss('abc-123');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/orchestrator/dismiss/abc-123');
    expect(calls[0]!.opts.method).toBe('POST');
  });

  it('encodes the entry ID in the URL', async () => {
    const calls = mockFetch(null, 204);

    await globalThis.API.orchestratorDismiss('id/with/slashes');

    expect(calls[0]!.url).toBe('/api/orchestrator/dismiss/id%2Fwith%2Fslashes');
  });
});
