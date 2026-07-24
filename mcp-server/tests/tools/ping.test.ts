/**
 * Tests for ledger_ping tool.
 *
 * Verifies that:
 * - ledger_ping returns status "ok" with the expected fields.
 * - stale is false when versions match.
 * - stale is true with instruction when versions differ.
 * - uptime_seconds is a non-negative integer.
 * - stale is null with instruction when readPackageVersion() throws.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server-version module BEFORE importing the tool under test.
// By default, SERVER_VERSION and readPackageVersion() return the same value.
const MOCK_SERVER_VERSION = '1.14.0';
let mockDiskVersion: string | null = MOCK_SERVER_VERSION;
let mockReadThrows = false;

vi.mock('../../src/utils/server-version.js', () => ({
  SERVER_VERSION: MOCK_SERVER_VERSION,
  readPackageVersion: () => {
    if (mockReadThrows) {
      throw Object.assign(new Error('package.json not found'), { code: 'ENOENT' });
    }
    return mockDiskVersion;
  },
}));

// Import AFTER the mock is established
const { _internal } = await import('../../src/tools/ping.js');
const { ping } = _internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: { type: string; text: string }[] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ledger_ping', () => {
  beforeEach(() => {
    mockDiskVersion = MOCK_SERVER_VERSION;
    mockReadThrows = false;
  });

  it('returns status "ok" when versions are fresh', async () => {
    const result = await ping();
    const parsed = parseResult(result);

    expect(parsed.status).toBe('ok');
    expect(parsed.server_version).toBe(MOCK_SERVER_VERSION);
    expect(typeof parsed.uptime_seconds).toBe('number');
    expect('stale' in parsed).toBe(true);
  });

  it('returns stale: false when versions match', async () => {
    mockDiskVersion = MOCK_SERVER_VERSION;

    const result = await ping();
    const parsed = parseResult(result);

    expect(parsed.stale).toBe(false);
    expect(parsed.instruction).toBeUndefined();
  });

  it('returns stale: true with instruction when versions differ', async () => {
    mockDiskVersion = '1.14.1';

    const result = await ping();
    const parsed = parseResult(result);

    expect(parsed.status).toBe('warn');
    expect(parsed.stale).toBe(true);
    expect(typeof parsed.instruction).toBe('string');
    expect(parsed.instruction as string).toContain('1.14.0');
    expect(parsed.instruction as string).toContain('1.14.1');
    expect(parsed.instruction as string).toContain('restart the MCP server');
  });

  it('uptime_seconds is a non-negative integer', async () => {
    const result = await ping();
    const parsed = parseResult(result);

    const uptime = parsed.uptime_seconds as number;
    expect(Number.isInteger(uptime)).toBe(true);
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns stale: null with instruction when readPackageVersion() throws', async () => {
    mockReadThrows = true;

    const result = await ping();
    const parsed = parseResult(result);

    expect(parsed.status).toBe('warn');
    expect(parsed.stale).toBeNull();
    expect(typeof parsed.instruction).toBe('string');
    expect(parsed.instruction as string).toContain('package.json');
  });
});
