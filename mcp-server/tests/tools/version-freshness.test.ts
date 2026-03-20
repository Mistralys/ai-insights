/**
 * Tests for MCP server version freshness check in initializeProject.
 *
 * Verifies that:
 * - initializeProject refuses to create a ledger when the running server
 *   version differs from the on-disk package.json version (stale instance).
 * - initializeProject succeeds normally when versions match.
 * - The root index includes `server_version` after successful initialization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir } from 'fs/promises';

// Mock the server-version module BEFORE importing the tool under test.
// By default, SERVER_VERSION and readPackageVersion() return the same value.
const MOCK_SERVER_VERSION = '1.14.1';
let mockDiskVersion = MOCK_SERVER_VERSION;

vi.mock('../../src/utils/server-version.js', () => ({
  SERVER_VERSION: MOCK_SERVER_VERSION,
  readPackageVersion: () => mockDiskVersion,
}));

// Import AFTER the mock is established
const { _internal } = await import('../../src/tools/project-lifecycle.js');
const { initializeProject } = _internal;

import { LedgerStore } from '../../src/storage/ledger-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: unknown): { text: string; parsed?: unknown; isError?: boolean } {
  const r = result as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content[0].text;
  try {
    return { text, parsed: JSON.parse(text), isError: r.isError };
  } catch {
    return { text, isError: r.isError };
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('initializeProject — server version freshness check', () => {
  let planDir: string;
  let ledgerRoot: string;
  let originalArgv: string[];

  beforeEach(async () => {
    planDir = join(tmpdir(), '2026-01-01-version-freshness-test');
    await mkdir(planDir, { recursive: true });
    ledgerRoot = await mkdtemp(join(tmpdir(), 'version-freshness-ledger-'));
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', ledgerRoot);

    // Default: versions match (not stale)
    mockDiskVersion = MOCK_SERVER_VERSION;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(planDir, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects with isError when running version differs from disk version (stale)', async () => {
    mockDiskVersion = '99.0.0'; // simulate a newer package.json on disk

    const result = await initializeProject({ project_path: planDir, plan_file: 'plan.md' });
    const { text, isError } = parseResult(result);

    expect(isError).toBe(true);
    expect(text).toContain('Stale MCP server instance');
    expect(text).toContain(MOCK_SERVER_VERSION);
    expect(text).toContain('99.0.0');
  });

  it('does not create a ledger when the server is stale', async () => {
    mockDiskVersion = '99.0.0';

    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, ledgerRoot);
    const exists = await store.rootIndexExists();
    expect(exists).toBe(false);
  });

  it('succeeds when running version matches disk version', async () => {
    mockDiskVersion = MOCK_SERVER_VERSION; // same as running version

    const result = await initializeProject({ project_path: planDir, plan_file: 'plan.md' });
    const { isError } = parseResult(result);

    expect(isError).toBeFalsy();
  });

  it('writes server_version to the root index on success', async () => {
    mockDiskVersion = MOCK_SERVER_VERSION;

    const result = await initializeProject({ project_path: planDir, plan_file: 'plan.md' });
    const { parsed, isError } = parseResult(result);

    expect(isError).toBeFalsy();
    expect((parsed as any).server_version).toBe(MOCK_SERVER_VERSION);

    // Also verify the persisted data
    const store = new LedgerStore(planDir, ledgerRoot);
    const index = await store.readRootIndex();
    expect(index.server_version).toBe(MOCK_SERVER_VERSION);
  });
});
