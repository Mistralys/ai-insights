/**
 * Tests for src/gui/log-resolver.ts
 *
 * Uses real temp directories and real filesystem operations — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  findRunLogs,
  readLogEntries,
  migrateOrphanedLogs,
  archiveCompletedLogs,
  resolveLogSource,
  readLogStatus,
  ApiError,
} from '../../src/gui/log-resolver.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Offset (ms) used with utimes() when arranging mtime relationships in tests.
 * Must be large enough to exceed the 1-second mtime resolution on some
 * filesystems (e.g. HFS+ on macOS), while remaining well below any timeout.
 */
const MTIME_OFFSET_MS = 5_000;

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

  it('matches files written with a 40-char truncated slug (backward compat)', async () => {
    // Slugs longer than 40 chars were previously truncated by the orchestrator's
    // _slugify(label, max_len=40). Files written by old builds use the truncated
    // form in their filename but the project ledger stores the full slug.
    const fullSlug = '2026-03-24-orchestrator-log-source-routing'; // 42 chars
    const truncSlug = fullSlug.slice(0, 40); // 'routi' not 'routing'
    const filename = `20260324T124936-${truncSlug}.jsonl`;
    await writeFile(join(tempDir, filename), '', 'utf-8');

    const results = await findRunLogs(tempDir, fullSlug);
    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe(filename);
  });

  it('does not match unrelated short slugs when truncated-slug backward compat is active', async () => {
    // A different project whose slug happens to be 40 chars should not be matched
    // when looking up the 42-char slug.
    const fullSlug = '2026-03-24-orchestrator-log-source-routing'; // 42 chars
    const unrelatedSlug = 'completely-different-short-project';
    await writeFile(join(tempDir, `20260324T124936-${unrelatedSlug}.jsonl`), '', 'utf-8');

    const results = await findRunLogs(tempDir, fullSlug);
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

  // ── is_dry_run population ─────────────────────────────────────────────────

  it('sets is_dry_run: true when first line is run_start with dry_run: true', async () => {
    const file = join(tempDir, '20260324T100000-my-project.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', dry_run: true, ts: '2026-03-24T10:00:00Z' },
      { action: 'run_end' },
    ]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_dry_run).toBe(true);
  });

  it('sets is_dry_run: false when first line is run_start without dry_run', async () => {
    const file = join(tempDir, '20260324T100000-my-project.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', ts: '2026-03-24T10:00:00Z' },
      { action: 'run_end' },
    ]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_dry_run).toBe(false);
  });

  it('sets is_dry_run: false when first line is run_start with dry_run: false', async () => {
    const file = join(tempDir, '20260324T110000-my-project.jsonl');
    await writeJsonl(file, [{ action: 'run_start', dry_run: false }, { action: 'run_end' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results[0]!.is_dry_run).toBe(false);
  });

  it('sets is_dry_run: false for an empty log file', async () => {
    await writeFile(join(tempDir, '20260324T120000-my-project.jsonl'), '', 'utf-8');

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_dry_run).toBe(false);
  });

  it('sets is_dry_run: false when first line is malformed JSON', async () => {
    await writeFile(
      join(tempDir, '20260324T130000-my-project.jsonl'),
      'not-valid-json\n{"action":"run_end"}\n',
      'utf-8',
    );

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(1);
    expect(results[0]!.is_dry_run).toBe(false);
  });

  it('sets is_dry_run: false when first line is not a run_start event', async () => {
    const file = join(tempDir, '20260324T140000-my-project.jsonl');
    await writeJsonl(file, [{ action: 'step_start', dry_run: true }, { action: 'run_end' }]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results[0]!.is_dry_run).toBe(false);
  });

  it('every returned entry has an is_dry_run boolean field', async () => {
    await writeFile(join(tempDir, '20260324T090000-my-project.jsonl'), '', 'utf-8');
    await writeJsonl(join(tempDir, '20260324T095900-my-project.jsonl'), [
      { action: 'run_start', dry_run: true },
    ]);

    const results = await findRunLogs(tempDir, 'my-project');
    expect(results).toHaveLength(2);
    results.forEach((r) => expect(typeof r.is_dry_run).toBe('boolean'));
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

// ---------------------------------------------------------------------------
// migrateOrphanedLogs
// ---------------------------------------------------------------------------

describe('migrateOrphanedLogs', () => {
  let destDir: string;
  let srcDir: string;

  beforeEach(async () => {
    destDir = await mkdtemp(join(tmpdir(), 'migrate-dest-'));
    srcDir = await mkdtemp(join(tmpdir(), 'migrate-src-'));
  });

  afterEach(async () => {
    await rm(destDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
  });

  it('copies matching files from srcDir into destDir', async () => {
    await writeFile(join(srcDir, '20260323T100000-my-project.jsonl'), 'data', 'utf-8');

    const count = await migrateOrphanedLogs(destDir, srcDir, 'my-project');

    expect(count).toBe(1);
    const destContent = await readFile(join(destDir, '20260323T100000-my-project.jsonl'), 'utf-8');
    expect(destContent).toBe('data');
  });

  it('source file still exists after migration (not moved — copyFile not rename)', async () => {
    const srcFile = join(srcDir, '20260323T100000-my-project.jsonl');
    await writeFile(srcFile, 'original', 'utf-8');

    await migrateOrphanedLogs(destDir, srcDir, 'my-project');

    // Source must still be readable — the file was copied, not moved.
    const srcContent = await readFile(srcFile, 'utf-8');
    expect(srcContent).toBe('original');
  });

  it('returns 0 and skips migration when destDir already has matching files', async () => {
    // destDir already has one matching file → migration is a no-op.
    await writeFile(join(destDir, '20260322T080000-my-project.jsonl'), 'old', 'utf-8');
    await writeFile(join(srcDir, '20260323T100000-my-project.jsonl'), 'new', 'utf-8');

    const count = await migrateOrphanedLogs(destDir, srcDir, 'my-project');

    expect(count).toBe(0);
    // The new source file must NOT have been copied — destDir already had logs.
    await expect(stat(join(destDir, '20260323T100000-my-project.jsonl'))).rejects.toThrow();
  });

  it('returns 0 when srcDir does not exist', async () => {
    const count = await migrateOrphanedLogs(destDir, '/nonexistent/path/xyz', 'my-project');
    expect(count).toBe(0);
  });

  it('returns 0 when srcDir has no matching files for the slug', async () => {
    await writeFile(join(srcDir, '20260323T100000-other-project.jsonl'), 'data', 'utf-8');
    const count = await migrateOrphanedLogs(destDir, srcDir, 'my-project');
    expect(count).toBe(0);
  });

  it('creates destDir when it does not yet exist', async () => {
    const newDest = join(destDir, 'subdir', 'logs');
    await writeFile(join(srcDir, '20260323T100000-my-project.jsonl'), 'data', 'utf-8');

    await migrateOrphanedLogs(newDest, srcDir, 'my-project');

    const destContent = await readFile(join(newDest, '20260323T100000-my-project.jsonl'), 'utf-8');
    expect(destContent).toBe('data');
  });
});

// ---------------------------------------------------------------------------
// archiveCompletedLogs
// ---------------------------------------------------------------------------

describe('archiveCompletedLogs', () => {
  let archiveDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    archiveDir = await mkdtemp(join(tmpdir(), 'archive-dest-'));
    sourceDir = await mkdtemp(join(tmpdir(), 'archive-src-'));
  });

  afterEach(async () => {
    await rm(archiveDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  it('active run in sourceDir → not copied to archiveDir', async () => {
    // File ends with run_start (no terminal action) — the run is active.
    const filename = '20260323T100000-my-project.jsonl';
    const activeContent = JSON.stringify({ action: 'run_start' }) + '\n';
    await writeFile(join(sourceDir, filename), activeContent, 'utf-8');

    const archived = await archiveCompletedLogs(archiveDir, sourceDir, 'my-project');

    expect(archived).toHaveLength(0);
    // archiveDir should not have the file.
    await expect(stat(join(archiveDir, filename))).rejects.toThrow();
  });

  it('completed run not in archive → copied to archiveDir', async () => {
    const filename = '20260323T110000-my-project.jsonl';
    const completedContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                             JSON.stringify({ action: 'run_end' }) + '\n';
    await writeFile(join(sourceDir, filename), completedContent, 'utf-8');

    const archived = await archiveCompletedLogs(archiveDir, sourceDir, 'my-project');

    expect(archived).toContain(filename);
    const archiveContent = await readFile(join(archiveDir, filename), 'utf-8');
    expect(archiveContent).toBe(completedContent);
  });

  it('completed run with newer source → archive refreshed', async () => {
    const filename = '20260323T120000-my-project.jsonl';
    const oldContent = JSON.stringify({ action: 'run_start' }) + '\n' +
                       JSON.stringify({ action: 'run_end' }) + '\n';
    const newContent = oldContent + JSON.stringify({ action: 'run_end', note: 'updated' }) + '\n';

    // Write the archive copy first, then write a newer source file.
    await writeFile(join(archiveDir, filename), oldContent, 'utf-8');

    // Wait a tick to ensure mtime differs, then write a "newer" source.
    // We use utimes to manually set the source mtime ahead of the archive.
    await writeFile(join(sourceDir, filename), newContent, 'utf-8');
    const archiveStat = await stat(join(archiveDir, filename));
    const futureTime = new Date(archiveStat.mtimeMs + MTIME_OFFSET_MS);
    await utimes(join(sourceDir, filename), futureTime, futureTime);

    const archived = await archiveCompletedLogs(archiveDir, sourceDir, 'my-project');

    expect(archived).toContain(filename);
    const refreshedContent = await readFile(join(archiveDir, filename), 'utf-8');
    expect(refreshedContent).toBe(newContent);
  });

  it('completed run with current archive → no-op (not re-copied)', async () => {
    const filename = '20260323T130000-my-project.jsonl';
    const content = JSON.stringify({ action: 'run_start' }) + '\n' +
                    JSON.stringify({ action: 'run_end' }) + '\n';

    // Write both files with identical content.
    await writeFile(join(sourceDir, filename), content, 'utf-8');
    await writeFile(join(archiveDir, filename), content, 'utf-8');

    // Set archive mtime >= source mtime so no copy is needed.
    const sourceStat = await stat(join(sourceDir, filename));
    const laterTime = new Date(sourceStat.mtimeMs + MTIME_OFFSET_MS);
    await utimes(join(archiveDir, filename), laterTime, laterTime);

    const archived = await archiveCompletedLogs(archiveDir, sourceDir, 'my-project');

    // No file should have been copied (archive is already current).
    expect(archived).toHaveLength(0);
  });

  it('returns empty array when sourceDir does not exist', async () => {
    const archived = await archiveCompletedLogs(archiveDir, '/nonexistent/path/xyz', 'my-project');
    expect(archived).toHaveLength(0);
  });

  it('returns empty array when sourceDir has no matching files', async () => {
    await writeFile(join(sourceDir, '20260323T100000-other-slug.jsonl'), 'data', 'utf-8');
    const archived = await archiveCompletedLogs(archiveDir, sourceDir, 'my-project');
    expect(archived).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readLogStatus
// ---------------------------------------------------------------------------

describe('readLogStatus', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'log-resolver-read-status-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('is_dry_run: false + is_active: false for a completed non-dry-run', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', ts: '2026-03-24T10:00:00Z' },
      { action: 'run_end', ts: '2026-03-24T10:01:00Z' },
    ]);

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(false);
    expect(status.is_active).toBe(false);
  });

  it('is_dry_run: true + is_active: false for a completed dry run', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', dry_run: true, ts: '2026-03-24T10:00:00Z' },
      { action: 'run_end', ts: '2026-03-24T10:01:00Z' },
    ]);

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(true);
    expect(status.is_active).toBe(false);
  });

  it('is_dry_run: false + is_active: true for an in-progress non-dry-run', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', ts: '2026-03-24T10:00:00Z' },
      { action: 'stage_start', ts: '2026-03-24T10:00:05Z' },
    ]);

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(false);
    expect(status.is_active).toBe(true);
  });

  it('is_dry_run: true + is_active: true for an in-progress dry run (combined case)', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeJsonl(file, [
      { action: 'run_start', dry_run: true, ts: '2026-03-24T10:00:00Z' },
      { action: 'stage_start', ts: '2026-03-24T10:00:05Z' },
    ]);

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(true);
    expect(status.is_active).toBe(true);
  });

  it('returns { is_active: false, is_dry_run: false } for an unreadable file', async () => {
    const status = await readLogStatus(join(tempDir, 'nonexistent.jsonl'));
    expect(status.is_dry_run).toBe(false);
    expect(status.is_active).toBe(false);
  });

  it('returns { is_active: true, is_dry_run: false } for an empty file', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeFile(file, '', 'utf-8');

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(false);
    expect(status.is_active).toBe(true);
  });

  it('returns is_dry_run: false when first line is malformed JSON', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeFile(file, 'not-valid-json\n{"action":"run_end"}\n', 'utf-8');

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(false);
    expect(status.is_active).toBe(false); // last line is run_end
  });

  it('returns is_active: true when last line is malformed JSON (fail-safe)', async () => {
    const file = join(tempDir, 'run.jsonl');
    await writeFile(file, '{"action":"run_start","dry_run":true}\nnot-valid-json\n', 'utf-8');

    const status = await readLogStatus(file);
    expect(status.is_dry_run).toBe(true);
    expect(status.is_active).toBe(true); // cannot confirm completion — treated as active
  });
});

// ---------------------------------------------------------------------------
// resolveLogSource
// ---------------------------------------------------------------------------

describe('resolveLogSource', () => {
  let archiveDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    archiveDir = await mkdtemp(join(tmpdir(), 'resolve-archive-'));
    sourceDir = await mkdtemp(join(tmpdir(), 'resolve-source-'));
  });

  afterEach(async () => {
    await rm(archiveDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  it('file only in archiveDir → returns archiveDir', async () => {
    const filename = '20260322T100000-my-project.jsonl';
    await writeFile(join(archiveDir, filename), 'data', 'utf-8');

    const result = await resolveLogSource(archiveDir, sourceDir, filename);

    expect(result).toBe(archiveDir);
  });

  it('file only in sourceDir → returns sourceDir', async () => {
    const filename = '20260323T140000-my-project.jsonl';
    await writeFile(join(sourceDir, filename), 'live data', 'utf-8');

    const result = await resolveLogSource(archiveDir, sourceDir, filename);

    expect(result).toBe(sourceDir);
  });

  it('file in both with newer source → copies source to archive and returns archiveDir', async () => {
    const filename = '20260323T120000-my-project.jsonl';
    const oldContent = 'old archive';
    const newContent = 'newer source content';

    await writeFile(join(archiveDir, filename), oldContent, 'utf-8');
    await writeFile(join(sourceDir, filename), newContent, 'utf-8');

    // Make source mtime newer than archive.
    const archiveStat = await stat(join(archiveDir, filename));
    const futureTime = new Date(archiveStat.mtimeMs + MTIME_OFFSET_MS);
    await utimes(join(sourceDir, filename), futureTime, futureTime);

    const result = await resolveLogSource(archiveDir, sourceDir, filename);

    expect(result).toBe(archiveDir);
    // Archive should now contain the refreshed content from source.
    const archiveContent = await readFile(join(archiveDir, filename), 'utf-8');
    expect(archiveContent).toBe(newContent);
  });

  it('file in both with current archive (archive mtime >= source) → returns archiveDir without re-copying', async () => {
    const filename = '20260321T090000-my-project.jsonl';
    const sourceContent = 'source data';
    const archiveContent = 'archive data (already current)';

    await writeFile(join(sourceDir, filename), sourceContent, 'utf-8');
    await writeFile(join(archiveDir, filename), archiveContent, 'utf-8');

    // Make archive mtime >= source mtime.
    const sourceStat = await stat(join(sourceDir, filename));
    const laterTime = new Date(sourceStat.mtimeMs + MTIME_OFFSET_MS);
    await utimes(join(archiveDir, filename), laterTime, laterTime);

    const result = await resolveLogSource(archiveDir, sourceDir, filename);

    expect(result).toBe(archiveDir);
    // Archive content must not have been overwritten.
    const content = await readFile(join(archiveDir, filename), 'utf-8');
    expect(content).toBe(archiveContent);
  });

  it('file in neither directory → returns archiveDir (so caller gets NOT_FOUND from archiveDir)', async () => {
    const result = await resolveLogSource(archiveDir, sourceDir, 'nonexistent.jsonl');
    // When neither exists, the function returns archiveDir (fall-through path).
    expect(result).toBe(archiveDir);
  });
});
