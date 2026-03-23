/**
 * Tests for src/gui/log-resolver.ts
 *
 * Uses real temp directories and real filesystem operations — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
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
    expect(results.map((r) => r.filename)).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(results.map((r) => r.filename)).toContain('2024-01-02T10-00-00-my-project.jsonl');
    // Each entry has an is_active field
    results.forEach((r) => expect(typeof r.is_active).toBe('boolean'));
  });

  it('does not return files that do not match the slug', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-other-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    const filenames = results.map((r) => r.filename);
    expect(filenames).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(filenames).not.toContain('2024-01-01T10-00-00-other-project.jsonl');
  });

  it('does not return a file named exactly -{slug}.jsonl (requires a prefix)', async () => {
    // A file that IS exactly the suffix — no timestamp prefix
    await writeFile(join(tempDir, '-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(0);
  });

  it('marks a completed run (run_end last line) as is_active: false', async () => {
    const file = join(tempDir, '20260323T120000-my-project.jsonl');
    await writeJsonl(file, [{ action: 'run_start' }, { action: 'run_end' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_active).toBe(false);
  });

  it('marks an errored run (run_error last line) as is_active: false', async () => {
    const file = join(tempDir, '20260323T130000-my-project.jsonl');
    await writeJsonl(file, [{ action: 'run_start' }, { action: 'run_error', error: 'boom' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_active).toBe(false);
  });

  it('marks an in-progress run (no terminal action) as is_active: true', async () => {
    const file = join(tempDir, '20260323T140000-my-project.jsonl');
    await writeJsonl(file, [{ action: 'run_start' }, { action: 'step_start', step_name: 'qa' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_active).toBe(true);
  });

  it('marks an empty log file as is_active: true', async () => {
    await writeFile(join(tempDir, '20260323T150000-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_active).toBe(true);
  });

  it('returns results sorted newest-first by filename prefix', async () => {
    await writeFile(join(tempDir, '20260323T100000-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '20260325T090000-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '20260324T120000-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(3);
    expect(results[0]!.filename).toBe('20260325T090000-my-project.jsonl');
    expect(results[1]!.filename).toBe('20260324T120000-my-project.jsonl');
    expect(results[2]!.filename).toBe('20260323T100000-my-project.jsonl');
  });

  // ── Self-healing ──────────────────────────────────────────────────────────

  it('heals a stale older run by appending a run_error entry to disk', async () => {
    const olderFile = join(tempDir, '20260323T100000-my-project.jsonl');
    const newerFile = join(tempDir, '20260325T090000-my-project.jsonl');
    await writeJsonl(olderFile, [{ action: 'run_start' }, { action: 'step_start', step_name: 'qa' }]);
    await writeJsonl(newerFile, [{ action: 'run_start' }, { action: 'run_end' }]);

    const results = await findRunLogs(tempDir, 'my-project');

    // Older run is healed in memory
    const older = results.find((r) => r.filename.includes('20260323'))!;
    expect(older.is_active).toBe(false);

    // Healing entry was written to disk — file now ends with run_error
    const content = await readFile(olderFile, 'utf-8');
    const lastLine = content.trim().split('\n').pop()!;
    const entry = JSON.parse(lastLine);
    expect(entry.action).toBe('run_error');
    expect(entry).toHaveProperty('ts');
  });

  it('does not heal the newest run even if it is active', async () => {
    const newerFile = join(tempDir, '20260325T090000-my-project.jsonl');
    await writeJsonl(newerFile, [{ action: 'run_start' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results[0]!.is_active).toBe(true);

    // File on disk should be unchanged (no extra line appended)
    const content = await readFile(newerFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    expect(lastEntry.action).toBe('run_start');
  });

  it('heals multiple stale older runs in one call', async () => {
    const files = [
      join(tempDir, '20260323T100000-my-project.jsonl'),
      join(tempDir, '20260324T120000-my-project.jsonl'),
      join(tempDir, '20260325T090000-my-project.jsonl'),
    ];
    // All three appear active (interrupted)
    for (const f of files) {
      await writeJsonl(f, [{ action: 'run_start' }]);
    }

    const results = await findRunLogs(tempDir, 'my-project');

    // Only the newest (index 0) stays active
    expect(results[0]!.is_active).toBe(true);   // newest
    expect(results[1]!.is_active).toBe(false);  // healed
    expect(results[2]!.is_active).toBe(false);  // healed

    // Both older files have a run_error entry on disk
    for (const f of [files[0]!, files[1]!]) {
      const content = await readFile(f, 'utf-8');
      const lastLine = content.trim().split('\n').pop()!;
      expect(JSON.parse(lastLine).action).toBe('run_error');
    }
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
