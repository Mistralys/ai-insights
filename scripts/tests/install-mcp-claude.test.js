/**
 * scripts/tests/install-mcp-claude.test.js
 *
 * Claude Code registration diagnostics in scripts/install-mcp-global.js.
 * `child_process` and the `claude` PATH probe are mocked so no real CLI is invoked.
 *
 * Verified behaviour:
 *   - A successful `claude mcp add` is only reported as registered once
 *     `claude mcp get central_pm` confirms the entry.
 *   - A missing CLI, a failed add, and an unverifiable add are surfaced through
 *     the error channel (never the plain log channel) and reflected in install()'s return value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { spawnSyncMock, cliAvailableMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  cliAvailableMock: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawnSync: spawnSyncMock,
}));
vi.mock('../lib/claude-cli.js', () => ({ isClaudeCliAvailable: cliAvailableMock }));

import { installClaudeCode, install } from '../install-mcp-global.js';

const DIST = path.resolve(import.meta.dirname, '../../mcp-server/dist/index.js');

/** Route mocked `claude` invocations by their subcommand (`list`, `add`, `get`, `remove`). */
function mockClaude(handlers) {
  spawnSyncMock.mockImplementation((_cmd, args) => {
    const handler = handlers[args[1]];
    return handler ? handler(args) : { status: 0, stdout: '', stderr: '' };
  });
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-mcp-claude-'));
  spawnSyncMock.mockReset();
  cliAvailableMock.mockReset();
  cliAvailableMock.mockReturnValue(true);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('installClaudeCode()', () => {
  it('reports verified when `claude mcp get` finds the entry', () => {
    mockClaude({ list: () => ({ status: 0, stdout: 'other: x\n' }), get: () => ({ status: 0, stdout: 'central_pm:' }) });
    const result = installClaudeCode({ shimBaseDir: tmpDir });
    expect(result.status).toBe(0);
    expect(result.verified).toBe(true);
  });

  it('reports unverified when add exits 0 but get cannot find the entry', () => {
    mockClaude({
      list: () => ({ status: 0, stdout: '' }),
      get: () => ({ status: 1, stderr: 'No MCP server named "central_pm"' }),
    });
    const result = installClaudeCode({ shimBaseDir: tmpDir });
    expect(result.status).toBe(0);
    expect(result.verified).toBe(false);
    expect(result.verifyOutput).toContain('No MCP server named');
  });

  it('does not run the verification step when add fails', () => {
    mockClaude({ list: () => ({ status: 0, stdout: '' }), add: () => ({ status: 1, stderr: 'boom' }) });
    const result = installClaudeCode({ shimBaseDir: tmpDir });
    expect(result.status).toBe(1);
    expect(result.verified).toBe(false);
    expect(spawnSyncMock.mock.calls.some(([, args]) => args[1] === 'get')).toBe(false);
  });

  it('surfaces a spawn error message', () => {
    mockClaude({
      list: () => ({ status: 0, stdout: '' }),
      add: () => ({ status: null, error: new Error('spawn claude ENOENT') }),
    });
    const result = installClaudeCode({ shimBaseDir: tmpDir });
    expect(result.status).toBe(1);
    expect(result.error).toContain('ENOENT');
  });

  it('returns skipped when the claude CLI is not on PATH', () => {
    cliAvailableMock.mockReturnValue(false);
    expect(installClaudeCode({ shimBaseDir: tmpDir })).toEqual({ skipped: true, reason: 'claude CLI not found' });
  });
});

// install() pre-flights on mcp-server/dist; skip the flow tests when it is not built.
describe.skipIf(!fs.existsSync(DIST))('install() Claude Code reporting', () => {
  function run(handlers) {
    mockClaude(handlers);
    const log = vi.fn();
    const error = vi.fn();
    const result = install({ shimBaseDir: tmpDir, mcpPath: path.join(tmpDir, 'mcp.json'), log, error });
    return { result, log, error };
  }

  it('logs success on the log channel when registration is verified', () => {
    const { result, error, log } = run({
      list: () => ({ status: 0, stdout: '' }),
      get: () => ({ status: 0, stdout: 'central_pm:' }),
    });
    expect(result.claudeCode).toBe('registered');
    expect(error).not.toHaveBeenCalled();
    expect(log.mock.calls.some(([m]) => m.includes('Claude Code registered'))).toBe(true);
  });

  it('reports a skipped registration as an error with a manual command', () => {
    cliAvailableMock.mockReturnValue(false);
    const { result, error } = run({});
    expect(result.claudeCode).toBe('skipped');
    expect(error.mock.calls[0][0]).toMatch(/SKIPPED[\s\S]*claude mcp add/);
  });

  it('reports an unverified registration as failed', () => {
    const { result, error } = run({
      list: () => ({ status: 0, stdout: '' }),
      get: () => ({ status: 1, stderr: 'not found' }),
    });
    expect(result.claudeCode).toBe('failed');
    expect(error.mock.calls[0][0]).toContain('NOT VERIFIED');
  });

  it('includes CLI stderr when the add command fails', () => {
    const { result, error } = run({
      list: () => ({ status: 0, stdout: '' }),
      add: () => ({ status: 2, stderr: 'permission denied' }),
    });
    expect(result.claudeCode).toBe('failed');
    expect(error.mock.calls[0][0]).toMatch(/FAILED \(exit 2\)[\s\S]*permission denied/);
  });
});
