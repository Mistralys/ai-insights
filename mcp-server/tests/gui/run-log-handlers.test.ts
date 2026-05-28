/**
 * Tests for src/gui/handlers/run-log-handlers.ts
 *
 * Uses real temp directories and real filesystem operations — no mocks.
 * Covers handleListRunLogs and handleGetRunLog, including security guards,
 * dual-source merge/deduplication, and source routing between the orchestrator
 * live logs directory and the ledger archive directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
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
  let logsDir: string;
  let orchestratorLogsDir: string;

  beforeEach(async () => {
    logsDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-logs-'));
    orchestratorLogsDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-orch-'));
  });

  afterEach(async () => {
    await rm(logsDir, { recursive: true, force: true });
    await rm(orchestratorLogsDir, { recursive: true, force: true });
  });

  // ── Security: slug validation ──────────────────────────────────────────────

  it('throws ApiError NOT_FOUND for a slug containing /', async () => {
    await expect(handleListRunLogs('bad/slug', 'my-repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a slug containing ..', async () => {
    await expect(handleListRunLogs('..', 'my-repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a slug containing ../ traversal', async () => {
    await expect(handleListRunLogs('../etc', 'my-repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for an empty slug', async () => {
    await expect(handleListRunLogs('', 'my-repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // ── Security: repoName validation (AC2) ─────────────────────────────────

  it('throws ApiError NOT_FOUND for a repoName containing / (AC2)', async () => {
    await expect(handleListRunLogs('my-project', 'bad/repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a repoName containing .. (AC2)', async () => {
    await expect(handleListRunLogs('my-project', '..', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for a repoName with uppercase letters (AC2)', async () => {
    await expect(handleListRunLogs('my-project', 'My-Repo', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError NOT_FOUND for an empty repoName (AC2)', async () => {
    await expect(handleListRunLogs('my-project', '', logsDir, orchestratorLogsDir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects invalid repoName before any filesystem access occurs (AC2)', async () => {
    // Use a non-existent logsDir — the guard must throw before attempting filesystem I/O
    const nonExistentDir = join(logsDir, 'does', 'not', 'exist');
    await expect(
      handleListRunLogs('my-project', 'INVALID_REPO', nonExistentDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects invalid slug before any filesystem access occurs (AC3)', async () => {
    const nonExistentDir = join(logsDir, 'does', 'not', 'exist');
    await expect(
      handleListRunLogs('INVALID_SLUG', 'my-repo', nonExistentDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns an empty array when no matching files exist', async () => {
    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toEqual([]);
  });

  it('returns an empty array when the directory is empty', async () => {
    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(0);
  });

  it('returns matching filenames for a valid slug', async () => {
    await writeFile(join(logsDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');
    await writeFile(join(logsDir, '2024-01-02T10-00-00-my-project.jsonl'), '', 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
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
    await writeFile(join(logsDir, '2024-01-01T10-00-00-other-project.jsonl'), '', 'utf-8');
    await writeFile(join(logsDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(1);
    const filenames = result.map((r) => r.filename);
    expect(filenames).toContain('2024-01-01T10-00-00-my-project.jsonl');
    expect(filenames).not.toContain('2024-01-01T10-00-00-other-project.jsonl');
  });

  it('sets is_active: false for a completed run', async () => {
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(logsDir, '20260323T120000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_active).toBe(false);
  });

  it('sets is_active: true for an in-progress run', async () => {
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'step_start', step_name: 'qa' }) + '\n';
    await writeFile(join(logsDir, '20260323T130000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_active).toBe(true);
  });

  it('passes through is_dry_run: true for a dry-run log file', async () => {
    const content = JSON.stringify({ action: 'run_start', dry_run: true }) + '\n' +
                    JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(logsDir, '20260324T100000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_dry_run).toBe(true);
  });

  it('passes through is_dry_run: false for a regular (non-dry-run) log file', async () => {
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(logsDir, '20260324T110000-my-project.jsonl'), content, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.is_dry_run).toBe(false);
  });

  // ── Integration: dual-source merge and deduplication ───────────────────────

  it('active run visible from orchestratorLogsDir (not yet archived)', async () => {
    // Active run only exists in the live orchestrator directory (not archived yet).
    const activeContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                          JSON.stringify({ action: 'step_start', step_name: 'qa' }) + '\n';
    await writeFile(join(orchestratorLogsDir, '20260323T140000-my-project.jsonl'), activeContent, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    const filenames = result.map((r) => r.filename);
    expect(filenames).toContain('20260323T140000-my-project.jsonl');
    const entry = result.find((r) => r.filename === '20260323T140000-my-project.jsonl');
    expect(entry!.is_active).toBe(true);
  });

  it('completed run visible from logsDir (archive)', async () => {
    // Completed run has been archived into logsDir.
    const completedContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                             JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(logsDir, '20260322T100000-my-project.jsonl'), completedContent, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    const filenames = result.map((r) => r.filename);
    expect(filenames).toContain('20260322T100000-my-project.jsonl');
    const entry = result.find((r) => r.filename === '20260322T100000-my-project.jsonl');
    expect(entry!.is_active).toBe(false);
  });

  it('same filename in both dirs → deduplicated in response', async () => {
    // The same completed file exists in both orchestratorLogsDir and logsDir.
    const completedContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                             JSON.stringify({ action: 'run_end' }) + '\n';
    const filename = '20260322T100000-my-project.jsonl';
    await writeFile(join(logsDir, filename), completedContent, 'utf-8');
    await writeFile(join(orchestratorLogsDir, filename), completedContent, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    const matching = result.filter((r) => r.filename === filename);
    // Must appear exactly once in the merged result.
    expect(matching).toHaveLength(1);
  });

  it('logsDir entry takes precedence over orchestratorLogsDir for same filename', async () => {
    // orchestratorLogsDir has the file as active; logsDir has it as completed
    // (self-healed by a previous request). logsDir should win.
    const filename = '20260322T100000-my-project.jsonl';
    const activeContent = JSON.stringify({ action: 'run_start' }) + '\n';
    const completedContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                             JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(orchestratorLogsDir, filename), activeContent, 'utf-8');
    await writeFile(join(logsDir, filename), completedContent, 'utf-8');

    const result = await handleListRunLogs('my-project', 'my-repo', logsDir, orchestratorLogsDir);
    const entry = result.find((r) => r.filename === filename);
    expect(entry).toBeDefined();
    // logsDir (archive) wins: run is marked completed
    expect(entry!.is_active).toBe(false);
  });

  // ── AC1: logsDir resolves to namespaced path ──────────────────────────────

  it('correctly uses a namespaced logsDir ({ledgerRoot}/{repoName}/{slug}/orchestrator/logs) (AC1)', async () => {
    const ledgerRoot = await mkdtemp(join(tmpdir(), 'run-log-handlers-ledger-'));
    const repoName = 'ai-insights';
    const slug = 'my-project';
    const namespacedLogsDir = join(ledgerRoot, repoName, slug, 'orchestrator', 'logs');
    await mkdir(namespacedLogsDir, { recursive: true });
    await writeFile(join(namespacedLogsDir, '2024-01-01T10-00-00-my-project.jsonl'), '', 'utf-8');

    try {
      const result = await handleListRunLogs(slug, repoName, namespacedLogsDir, orchestratorLogsDir);
      expect(result).toHaveLength(1);
      expect(result[0]!.filename).toBe('2024-01-01T10-00-00-my-project.jsonl');
    } finally {
      await rm(ledgerRoot, { recursive: true, force: true });
    }
  });

  // ── AC4: legacy migration uses namespaced logsDir as destination ─────────────

  it('migrates orphaned logs from a legacy flat dir into the namespaced logsDir (AC4)', async () => {
    const ledgerRoot = await mkdtemp(join(tmpdir(), 'run-log-handlers-ledger2-'));
    const repoName = 'my-repo';
    const slug = 'my-project';
    const namespacedLogsDir = join(ledgerRoot, repoName, slug, 'orchestrator', 'logs');
    const legacyFlatDir = join(ledgerRoot, slug); // old flat layout: {ledgerRoot}/{slug}/
    // Create a log file in the legacy location only
    await mkdir(legacyFlatDir, { recursive: true });
    await writeFile(join(legacyFlatDir, '2024-06-01T10-00-00-my-project.jsonl'), '', 'utf-8');
    // namespacedLogsDir does not exist yet

    try {
      const result = await handleListRunLogs(
        slug,
        repoName,
        namespacedLogsDir,
        orchestratorLogsDir,
        legacyFlatDir,
      );
      // Legacy file must have been migrated into namespacedLogsDir and returned
      const filenames = result.map((r) => r.filename);
      expect(filenames).toContain('2024-06-01T10-00-00-my-project.jsonl');
    } finally {
      await rm(ledgerRoot, { recursive: true, force: true });
    }
  });

  // ── assertSafeSlug throws ApiError — type assertion (AC2) ─────────────────

  it('invalid slug throws an instance of ApiError (not a plain Error)', async () => {
    await expect(
      handleListRunLogs('INVALID_SLUG', 'my-repo', logsDir, orchestratorLogsDir)
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('invalid repoName throws an instance of ApiError (not a plain Error)', async () => {
    await expect(
      handleListRunLogs('my-project', 'INVALID_REPO', logsDir, orchestratorLogsDir)
    ).rejects.toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// handleGetRunLog
// ---------------------------------------------------------------------------

describe('handleGetRunLog', () => {
  let logsDir: string;
  let orchestratorLogsDir: string;

  beforeEach(async () => {
    logsDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-logs-'));
    orchestratorLogsDir = await mkdtemp(join(tmpdir(), 'run-log-handlers-orch-'));
  });

  afterEach(async () => {
    await rm(logsDir, { recursive: true, force: true });
    await rm(orchestratorLogsDir, { recursive: true, force: true });
  });

  // ── Security: slug validation ──────────────────────────────────────────────

  it('throws ApiError NOT_FOUND for a slug containing /', async () => {
    await expect(
      handleGetRunLog('bad/slug', 'my-repo', 'run.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws ApiError NOT_FOUND for a slug containing ..', async () => {
    await expect(
      handleGetRunLog('..', 'my-repo', 'run.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Security: repoName validation (AC2/AC3) ─────────────────────────────

  it('throws ApiError NOT_FOUND for a repoName containing / (AC2)', async () => {
    await expect(
      handleGetRunLog('my-project', 'bad/repo', 'run.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws ApiError NOT_FOUND for a repoName with uppercase letters (AC2)', async () => {
    await expect(
      handleGetRunLog('my-project', 'My-Repo', 'run.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Security: filename validation (FORBIDDEN) ──────────────────────────────

  it('throws ApiError FORBIDDEN for a filename containing ..', async () => {
    await expect(
      handleGetRunLog('my-project', 'my-repo', '../etc/passwd', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws ApiError FORBIDDEN for a filename containing /', async () => {
    await expect(
      handleGetRunLog('my-project', 'my-repo', 'sub/file.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws ApiError FORBIDDEN for a malicious filename with special characters', async () => {
    for (const bad of ['file;name.jsonl', 'file|name.jsonl', 'file\x00name.jsonl']) {
      await expect(
        handleGetRunLog('my-project', 'my-repo', bad, logsDir, orchestratorLogsDir)
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('throws ApiError FORBIDDEN for an empty filename', async () => {
    await expect(
      handleGetRunLog('my-project', 'my-repo', '', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ── NOT_FOUND: valid filename but file does not exist ─────────────────────

  it('throws ApiError NOT_FOUND when a valid filename does not exist on disk', async () => {
    await expect(
      handleGetRunLog('my-project', 'my-repo', 'nonexistent.jsonl', logsDir, orchestratorLogsDir)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns entries and totalLines for a valid log file', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const entries = [{ type: 'start' }, { type: 'step' }, { type: 'end' }];
    await writeJsonl(join(logsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
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
    await writeJsonl(join(logsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir, 3);
    expect(result.totalLines).toBe(5);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ line: 4 });
    expect(result.entries[1]).toEqual({ line: 5 });
  });

  it('returns empty entries array and correct totalLines when afterLine >= totalLines', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const entries = [{ n: 1 }, { n: 2 }];
    await writeJsonl(join(logsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir, 10);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(0);
  });

  it('silently skips malformed JSON lines without throwing', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    const content = '{"ok": true}\nnot-json\n{"also": "ok"}\n';
    await writeFile(join(logsDir, logFile), content, 'utf-8');

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
    expect(result.totalLines).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ ok: true });
    expect(result.entries[1]).toEqual({ also: 'ok' });
  });

  it('returns zero entries and zero totalLines for an empty file', async () => {
    const logFile = '2024-01-01T10-00-00-my-project.jsonl';
    await writeFile(join(logsDir, logFile), '', 'utf-8');

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
    expect(result.totalLines).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  // ── Integration: source routing ────────────────────────────────────────────

  it('active run reads from orchestratorLogsDir (not yet in logsDir)', async () => {
    // The active run log only exists in the live orchestrator directory.
    const logFile = '20260323T140000-my-project.jsonl';
    const entries = [{ action: 'run_start' }, { action: 'step_start', step_name: 'qa' }];
    await writeJsonl(join(orchestratorLogsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ action: 'run_start' });
    expect(result.entries[1]).toEqual({ action: 'step_start', step_name: 'qa' });
  });

  it('completed run reads from logsDir (archive) when only in archive', async () => {
    // Completed run has been archived into logsDir and is no longer in orchestratorLogsDir.
    const logFile = '20260322T100000-my-project.jsonl';
    const entries = [{ action: 'run_start' }, { action: 'run_end' }];
    await writeJsonl(join(logsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
    expect(result.totalLines).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]).toEqual({ action: 'run_end' });
  });

  it('reads from logsDir (archive) when file exists in both dirs and archive is current', async () => {
    // File exists in both directories with the same content and the archive copy is current.
    // resolveLogSource should return logsDir (archiveDir) without re-copying.
    const logFile = '20260321T090000-my-project.jsonl';
    const entries = [{ action: 'run_start' }, { action: 'run_end' }];
    await writeJsonl(join(logsDir, logFile), entries);
    await writeJsonl(join(orchestratorLogsDir, logFile), entries);

    const result = await handleGetRunLog('my-project', 'my-repo', logFile, logsDir, orchestratorLogsDir);
    expect(result.totalLines).toBe(2);
    expect(result.entries[1]).toEqual({ action: 'run_end' });
  });
});
