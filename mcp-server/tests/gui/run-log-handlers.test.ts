/**
 * Tests for src/gui/handlers/run-log-handlers.ts
 *
 * Uses real temp directories and real filesystem operations — no mocks.
 * Covers handleListRunLogs and handleGetRunLog, including security guards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  handleListRunLogs,
  handleGetRunLog,
} from '../../src/gui/handlers/run-log-handlers.js';
import { ApiError } from '../../src/gui/log-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeJsonl(filePath: string, objects: unknown[]): Promise<void> {
  const content = objects.map((o) => JSON.stringify(o)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// handleListRunLogs
// ---------------------------------------------------------------------------

describe('handleListRunLogs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Security: slug validation ──────────────────────────────────────────────

  it('throws ApiError NOT_FOUND for a slug containing /', async () => {
    await expect(handleListRunLogs('bad/slug', tempDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a slug containing ..', async () => {
    await expect(handleListRunLogs('..', tempDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a slug containing ../ traversal', async () => {
    await expect(handleListRunLogs('../etc', tempDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for an empty slug', async () => {
    await expect(handleListRunLogs('', tempDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns an empty array when no matching files exist', async () => {
    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toEqual([]);
  });

  it('returns an empty array when the directory is empty', async () => {
    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toHaveLength(0);
  });

  it('returns matching filenames for a valid slug', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-02T10-00-00-my-project.jsonl'), '', 'utf-8');

    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toHaveLength(2);
    const filenames = result.map((r) => r.filename);
    expect(filenames).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(filenames).toContain('2024-01-02T10-00-00-my-project.jsonl');
    // Each entry has the expected shape
    result.forEach((r) => {
      expect(typeof r.filename).toBe('string');
      expect(typeof r.is_active).toBe('boolean');
    });
  });

  it('does not return files for a different slug', async () => {
    await writeFile(join(tempDir, '2024-01-01T10-00-00-other-project.jsonl'), '', 'utf-8');
    await writeFile(join(tempDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');

    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toHaveLength(1);
    const filenames = result.map((r) => r.filename);
    expect(filenames).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(filenames).not.toContain('2024-01-01T10-00-00-other-project.jsonl');
  });

  it('sets is_active: false for a completed run', async () => {
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(tempDir, '20260323T120000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_active).toBe(false);
  });

  it('sets is_active: true for an in-progress run', async () => {
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'step_start', step_name: 'qa' }) + '\n';
    await writeFile(join(tempDir, '20260323T130000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGetRunLog
// ---------------------------------------------------------------------------

describe('handleGetRunLog', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Security: slug validation ──────────────────────────────────────────────

  it('throws ApiError NOT_FOUND for a slug containing /', async () => {
    await expect(
      handleGetRunLog('bad/slug', 'run.jsonl', tempDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws ApiError NOT_FOUND for a slug containing ..', async () => {
    await expect(
      handleGetRunLog('..', 'run.jsonl', tempDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Security: filename validation (FORBIDDEN) ──────────────────────────────

  it('throws ApiError FORBIDDEN for a filename containing ..', async () => {
    await expect(
      handleGetRunLog('my-project', '../etc/passwd', tempDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws ApiError FORBIDDEN for a filename containing /', async () => {
    await expect(
      handleGetRunLog('my-project', 'sub/file.jsonl', tempDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws ApiError FORBIDDEN for a malicious filename with special characters', async () => {
    for (const bad of ['file;name.jsonl', 'file|name.jsonl', 'file\x00name.jsonl']) {
      await expect(
        handleGetRunLog('my-project', bad, tempDir)
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('throws ApiError FORBIDDEN for an empty filename', async () => {
    await expect(
      handleGetRunLog('my-project', '', tempDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ── NOT_FOUND: valid filename but file does not exist ─────────────────────

  it('throws ApiError NOT_FOUND when a valid filename does not exist on disk', async () => {
    await expect(
      handleGetRunLog('my-project', 'nonexistent.jsonl', tempDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns entries and totalLines for a valid log file', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const entries = [{ type: 'start' }, { type: 'step' }, { type: 'end' }];
    await writeJsonl(join(tempDir, logFile), entries);

    const result = await handleGetRunLog('my-project', logFile, tempDir);
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('totalLines');
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ type: 'start' });
    expect(result.entries[2]).toEqual({ type: 'end' });
  });

  it('returns only entries after the specified afterLine offset', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const entries = Array.from({ length: 5 }, (_, i) => ({ line: i + 1 }));
    await writeJsonl(join(tempDir, logFile), entries);

    const result = await handleGetRunLog('my-project', logFile, tempDir, 3);
    expect(result.totalLines).toBe(5);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ line: 4 });
    expect(result.entries[1]).toEqual({ line: 5 });
  });

  it('returns empty entries array and correct totalLines when afterLine >= totalLines', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const entries = [{ n: 1 }, { n: 2 }];
    await writeJsonl(join(tempDir, logFile), entries);

    const result = await handleGetRunLog('my-project', logFile, tempDir, 10);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(0);
  });

  it('silently skips malformed JSON lines without throwing', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const content = '{"ok": true}\nnot-json\n{"also": "ok"}\n';
    await writeFile(join(tempDir, logFile), content, 'utf-8');

    const result = await handleGetRunLog('my-project', logFile, tempDir);
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ ok: true });
    expect(result.entries[1]).toEqual({ also: 'ok' });
  });

  it('returns zero entries and zero totalLines for an empty file', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    await writeFile(join(tempDir, logFile), '', 'utf-8');

    const result = await handleGetRunLog('my-project', logFile, tempDir);
    expect(result.totalLines).toBe(0);
    expect(result.entries).toHaveLength(0);
  });
});
