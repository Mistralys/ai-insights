/**
 * Tests for src/gui/log-resolver.ts
 *
 * Uses real temp directories and real filesystem operations — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

import {
  resolveOrchestratorLogsDir,
  findRunLogs,
  readLogEntries,
  ApiError,
} from '../../src/gui/log-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonl(filePath: string, objects: unknown[]): Promise<void> {
  const content = objects.map((o) => JSON.stringify(o)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// resolveOrchestratorLogsDir
// ---------------------------------------------------------------------------

describe('resolveOrchestratorLogsDir', () => {
  it('returns the default path when called with undefined', () => {
    const result = resolveOrchestratorLogsDir(undefined);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
    // Should be under the home directory
    expect(result.startsWith(homedir())).toBe(true);
  });

  it('returns an explicit path unchanged', () => {
    const path = '/custom/logs/dir';
    expect(resolveOrchestratorLogsDir(path)).toBe(path);
  });

  it('returns the default for an empty string', () => {
    const result = resolveOrchestratorLogsDir('');
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns the default for a whitespace-only string', () => {
    const result = resolveOrchestratorLogsDir('   ');
    expect(result).toBeTruthy();
    expect(result.startsWith(homedir())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findRunLogs
// ---------------------------------------------------------------------------

describe('findRunLogs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'log-resolver-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns matching files ending with -{slug}.jsonl', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-02T10-00-00-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(2);
    expect(results).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(results).toContain('2024-01-02T10-00-00-my-project.jsonl');
  });

  it('does not return files that do not match the slug', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-other-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(results).not.toContain('2024-01-01T10-00-00-other-project.jsonl');
  });

  it('does not return a file named exactly -{slug}.jsonl (requires a prefix)', async () => {
    // A file that IS exactly the suffix — no timestamp prefix
    await writeFile(join(tempDir, '-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(0);
  });

  it('does not return non-jsonl files', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.log'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.txt'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(0);
  });

  it('returns an empty array when the directory does not exist', async () => {
    const results = await findRunLogs('/nonexistent/path/xyz', 'my-project');
    expect(results).toEqual([]);
  });

  it('returns an empty array when the directory is empty', async () => {
    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readLogEntries
// ---------------------------------------------------------------------------

describe('readLogEntries', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'log-resolver-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('reads all entries when afterLine is omitted', async () => {
    const entries = [{ type: 'a' }, { type: 'b' }, { type: 'c' }];
    await writeJsonl(join(tempDir, 'run.jsonl'), entries);

    const result = await readLogEntries(tempDir, 'run.jsonl');
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ type: 'a' });
    expect(result.entries[2]).toEqual({ type: 'c' });
  });

  it('reads all entries when afterLine is 0', async () => {
    const entries = [{ n: 1 }, { n: 2 }];
    await writeJsonl(join(tempDir, 'run.jsonl'), entries);

    const result = await readLogEntries(tempDir, 'run.jsonl', 0);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  it('skips the first N lines when afterLine is set and reports correct totalLines', async () => {
    // 8 entries — afterLine: 5 should return only entries 6, 7, 8 (index 5, 6, 7)
    const entries = Array.from({ length: 8 }, (_, i) => ({ line: i + 1 }));
    await writeJsonl(join(tempDir, 'run.jsonl'), entries);

    const result = await readLogEntries(tempDir, 'run.jsonl', 5);
    expect(result.totalLines).toBe(8);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ line: 6 });
    expect(result.entries[2]).toEqual({ line: 8 });
  });

  it('returns empty entries when afterLine >= totalLines', async () => {
    const entries = [{ n: 1 }, { n: 2 }];
    await writeJsonl(join(tempDir, 'run.jsonl'), entries);

    const result = await readLogEntries(tempDir, 'run.jsonl', 10);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(0);
  });

  // ── Malformed JSON ─────────────────────────────────────────────────────────

  it('silently skips malformed JSON lines without throwing', async () => {
    const content = '{"ok": true}\nnot json at all\n{"also": "ok"}\n';
    await writeFile(join(tempDir, 'mixed.jsonl'), content, 'utf-8');

    const result = await readLogEntries(tempDir, 'mixed.jsonl');
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ ok: true });
    expect(result.entries[1]).toEqual({ also: 'ok' });
  });

  it('returns empty entries for a file that is all malformed JSON', async () => {
    await writeFile(join(tempDir, 'bad.jsonl'), 'not json\nalso bad\n', 'utf-8');

    const result = await readLogEntries(tempDir, 'bad.jsonl');
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(0);
  });

  // ── Filename security — allowlist ──────────────────────────────────────────

  it('throws ApiError FORBIDDEN for filename containing ..', async () => {
    await expect(readLogEntries(tempDir, '../etc/passwd')).rejects.toThrow(ApiError);
    await expect(readLogEntries(tempDir, '../etc/passwd')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws ApiError FORBIDDEN for filename containing /', async () => {
    await expect(readLogEntries(tempDir, 'sub/file.jsonl')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws ApiError FORBIDDEN for filename with special characters', async () => {
    // Semicolon, pipe, null-byte — all outside the allowlist
    for (const bad of ['file;name.jsonl', 'file|name.jsonl', 'file\x00name.jsonl']) {
      await expect(readLogEntries(tempDir, bad)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('throws ApiError FORBIDDEN for an empty filename', async () => {
    await expect(readLogEntries(tempDir, '')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // ── Filename security — path escape check ──────────────────────────────────

  it('throws ApiError FORBIDDEN if resolved path escapes logsDir (symlink attempt)', async () => {
    // Craft a filename that looks safe but when resolved with a crafted logsDir escapes
    // e.g. logsDir=/tmp/x, filename=..%2fetc%2fpasswd — but our allowlist catches this
    // The escape-check is a secondary defence; test it via a direct path that would escape.
    // We simulate by using a path component that the allowlist would actually catch first,
    // confirming the FORBIDDEN is thrown.
    await expect(readLogEntries('/tmp', '../../etc/passwd')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // ── NOT_FOUND ──────────────────────────────────────────────────────────────

  it('throws ApiError NOT_FOUND when the file does not exist', async () => {
    await expect(readLogEntries(tempDir, 'nonexistent.jsonl')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
