/**
 * Tests for WP-002: runner metadata written to .meta.json and root index
 * during initializeProject.
 *
 * Verifies:
 * - After initializeProject, root index contains runner, runner_client, runner_version (AC1, AC2)
 * - After initializeProject, .meta.json also contains the runner fields (AC1, AC2)
 * - When getClientInfo() returns undefined, runner defaults to 'unknown' without throwing (AC3)
 * - No errors when runner fields are absent (backward compat, AC4)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir } from 'fs/promises';

// Mock index.ts BEFORE importing the tool under test.
// This controls what getClientInfo() returns during initializeProject.
let mockClientInfo: { name: string; version: string } | undefined = {
  name: 'langchain-mcp-adapters',
  version: '0.1.0',
};

vi.mock('../../src/utils/client-info.js', () => ({
  getClientInfo: () => mockClientInfo,
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
// AC1 + AC2: runner fields appear in root index AND .meta.json
// ---------------------------------------------------------------------------

describe('initializeProject – runner fields in root index and .meta.json (AC1, AC2)', () => {
  let planDir: string;
  let tempLedgerRoot: string;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'wp002-runner-'));
    planDir = join(tmpdir(), '2026-03-20-runner-test');
    await mkdir(planDir, { recursive: true });
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    // Use orchestrator client for these tests
    mockClientInfo = { name: 'langchain-mcp-adapters', version: '0.2.5' };
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  });

  it('root index returned in response contains runner fields (AC1)', async () => {
    const result = await initializeProject({ project_path: planDir, plan_file: 'plan.md' });
    expect((result as any).isError).toBeFalsy();

    const { parsed } = parseResult(result);
    const data = parsed as Record<string, unknown>;
    expect(data.runner).toBe('orchestrator');
    expect(data.runner_client).toBe('langchain-mcp-adapters');
    expect(data.runner_version).toBe('0.2.5');
  });

  it('root index on disk contains runner fields (AC1)', async () => {
    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.runner).toBe('orchestrator');
    expect(root.runner_client).toBe('langchain-mcp-adapters');
    expect(root.runner_version).toBe('0.2.5');
  });

  it('.meta.json on disk contains runner fields (AC2)', async () => {
    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const meta = await store.readProjectMeta();
    expect(meta.runner).toBe('orchestrator');
    expect(meta.runner_client).toBe('langchain-mcp-adapters');
    expect(meta.runner_version).toBe('0.2.5');
  });

  it('classifies VS Code client correctly (AC1)', async () => {
    mockClientInfo = { name: 'Visual Studio Code', version: '1.99.0' };

    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.runner).toBe('vscode');
    expect(root.runner_client).toBe('Visual Studio Code');
    expect(root.runner_version).toBe('1.99.0');
  });

  it('classifies Claude Code client correctly (AC1)', async () => {
    mockClientInfo = { name: 'claude-code', version: '0.2.1' };

    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.runner).toBe('claude-code');
    expect(root.runner_client).toBe('claude-code');
  });
});

// ---------------------------------------------------------------------------
// AC3: undefined clientInfo defaults gracefully
// ---------------------------------------------------------------------------

describe('initializeProject – undefined clientInfo defaults to unknown (AC3)', () => {
  let planDir: string;
  let tempLedgerRoot: string;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'wp002-runner-undef-'));
    planDir = join(tmpdir(), '2026-03-20-runner-undef-test');
    await mkdir(planDir, { recursive: true });
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    // Simulate no client identity
    mockClientInfo = undefined;
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  });

  it('does not throw when getClientInfo() returns undefined (AC3)', async () => {
    await expect(
      initializeProject({ project_path: planDir, plan_file: 'plan.md' })
    ).resolves.toBeDefined();
  });

  it('runner defaults to "unknown" when getClientInfo() returns undefined (AC3)', async () => {
    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.runner).toBe('unknown');
    expect(root.runner_client).toBe('');
    expect(root.runner_version).toBe('');
  });

  it('.meta.json runner defaults to "unknown" when clientInfo is undefined (AC3)', async () => {
    await initializeProject({ project_path: planDir, plan_file: 'plan.md' });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const meta = await store.readProjectMeta();
    expect(meta.runner).toBe('unknown');
    expect(meta.runner_client).toBe('');
    expect(meta.runner_version).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AC5: No stdout output (stderr-only logging)
// ---------------------------------------------------------------------------

describe('initializeProject – runner logging goes to stderr only (AC5)', () => {
  let planDir: string;
  let tempLedgerRoot: string;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'wp002-runner-stdout-'));
    planDir = join(tmpdir(), '2026-03-20-runner-stdout-test');
    await mkdir(planDir, { recursive: true });
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
    mockClientInfo = { name: 'langchain-mcp-adapters', version: '0.2.5' };
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  });

  it('initializeProject does not write runner info to stdout (AC5)', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await initializeProject({ project_path: planDir, plan_file: 'plan.md' });
      // Verify no stdout writes contain runner info
      const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0]));
      const runnerInStdout = stdoutCalls.some(
        (s) => s.includes('runner') || s.includes('langchain')
      );
      expect(runnerInStdout).toBe(false);
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
