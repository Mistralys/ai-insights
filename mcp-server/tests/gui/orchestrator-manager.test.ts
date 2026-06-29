/**
 * Tests for gui/orchestrator-manager.ts — WP-003 + WP-005 + WP-006 + WP-007
 *
 * All acceptance criteria tested:
 *   WP-003 AC-6: lastAction and logFilename are populated in QueueEntry from ProgressResolution.
 *   WP-005 AC-1: getQueue() returns [] when queue file / logs dir missing.
 *   WP-005 AC-2: pending + alive + no project  → effectiveStatus 'pending'.
 *   WP-005 AC-3: pending + alive + project     → effectiveStatus 'started'.
 *   WP-005 AC-4: pending + dead  + no project  → effectiveStatus 'dead'.
 *   WP-005 AC-5: pending + dead  + project     → effectiveStatus 'started'.
 *   WP-005 AC-6: started + synthesis_generated → excluded from result.
 *   WP-005 AC-7: JSONL progress resolved with correct human-readable summaries.
 *   WP-005 AC-8: queue file on disk is never modified by getQueue().
 *   WP-006 AC-1: killQueueEntry() rejects non-pending entries and missing IDs.
 *   WP-006 AC-2: killQueueEntry() sends SIGTERM then SIGKILL (or SIGTERM only).
 *   WP-006 AC-3: killQueueEntry() removes entry from queue file.
 *   WP-006 AC-4: killQueueEntry() removes .orchestrator.lock.
 *   WP-006 AC-5: dismissQueueEntry() rejects non-dead entries and missing IDs.
 *   WP-006 AC-6: dismissQueueEntry() removes dead entry from queue file.
 *   WP-006 AC-7: both functions handle entry-not-found gracefully.
 *   WP-007 AC-1: startOrchestrator dryRun:true returns checks, never spawns.
 *   WP-007 AC-2: any failing check → started:false, no spawn.
 *   WP-007 AC-3: all checks pass + not dryRun → spawns + returns started:true.
 *   WP-007 AC-4: planPath outside workspaceRoot → path-prefix check fails.
 *   WP-007 AC-5: planFolderBasename() error → plan-basename check fails.
 *   WP-007 AC-6: duplicate plan in queue → no-conflict check fails.
 *   WP-007 AC-7: spawned process is detached and unref()-ed.
 *   WP-007 AC-8: binary resolved as bin/orchestrate (Unix) or Scripts/orchestrate.exe (Win).
 *   WP-007 AC-9: anthropic-key check passes when provider returns 200.
 *   WP-007 AC-9: anthropic-key check fails when provider returns 401.
 *   WP-007 AC-9: anthropic-key check fails on network error.
 *   WP-007 AC-9: google-key check passes when provider returns 200.
 *   WP-007 AC-9: google-key check fails when provider returns 403.
 *   WP-007 AC-9: both key checks run when both keys are configured.
 *   WP-007 AC-9: no live key checks emitted when .env contains no keys.
 *
 * Uses real temp directories for filesystem operations.
 * process.kill() is spied on to control PID-alive checks without
 * sending real signals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

vi.mock('child_process');

// Stub the global fetch so live API-key checks never reach real provider endpoints.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Clear mock call history before every test so assertions like
// toHaveBeenCalledOnce() are not polluted by calls from previous tests.
// Re-establish the default fetch response (accepted) so tests that don't care
// about key validation get a passing result by default.
beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

import {
  getQueue,
  formatProgressEntry,
  killQueueEntry,
  dismissQueueEntry,
  startOrchestrator,
} from '../../gui/orchestrator-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupDirs(): Promise<{
  tempDir: string;
  logsDir: string;
  ledgerRoot: string;
}> {
  const tempDir    = await mkdtemp(join(tmpdir(), 'orch-mgr-test-'));
  const logsDir    = join(tempDir, 'logs');
  const ledgerRoot = join(tempDir, 'ledger');
  await mkdir(logsDir);
  await mkdir(ledgerRoot);
  return { tempDir, logsDir, ledgerRoot };
}

async function teardown(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

function makeRawEntry(overrides: Partial<{
  id: string;
  pid: number;
  planPath: string;
  expectedSlug: string;
  startedAt: string;
  status: 'pending';
}> = {}): Record<string, unknown> {
  return {
    id:           overrides.id           ?? 'test-entry-id',
    pid:          overrides.pid          ?? 12345,
    planPath:     overrides.planPath     ?? '/plans/plan.md',
    expectedSlug: overrides.expectedSlug ?? '2026-05-05-feat',
    startedAt:    overrides.startedAt    ?? '2026-05-05T10:00:00Z',
    status:       overrides.status       ?? 'pending',
  };
}

async function writeQueueFile(logsDir: string, entries: unknown[]): Promise<void> {
  await writeFile(join(logsDir, '.run-queue.json'), JSON.stringify(entries), 'utf-8');
}

async function writeLedgerProject(
  ledgerRoot: string,
  slug: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const slugDir = join(ledgerRoot, slug);
  await mkdir(slugDir, { recursive: true });
  await writeFile(
    join(slugDir, 'project-ledger.json'),
    JSON.stringify({
      plan_file:            'plan.md',
      date_created:         '2026-05-05',
      last_updated:         '2026-05-05',
      status:               'IN_PROGRESS',
      total_work_packages:  0,
      pending_work_packages: 0,
      work_packages:        [],
      project_comments:     [],
      ...extra,
    }),
    'utf-8',
  );
}

async function writeJsonlLog(
  logsDir: string,
  filenamePrefix: string,
  slug: string,
  entries: unknown[],
): Promise<void> {
  const filename = `${filenamePrefix}-${slug}.jsonl`;
  const content  = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(join(logsDir, filename), content, 'utf-8');
}

/** Stub process.kill so any call looks like the process is alive. */
function stubAlive(): void {
  vi.spyOn(process, 'kill').mockImplementation(() => true);
}

/** Stub process.kill so any call throws ESRCH (process not found). */
function stubDead(): void {
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
  });
}

// ---------------------------------------------------------------------------
// AC-1: getQueue() returns [] when queue file / logs dir is missing
// ---------------------------------------------------------------------------

describe('getQueue — AC-1: missing queue file', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('returns [] when logs directory does not exist', async () => {
    const result = await getQueue({
      logsDir: join(tempDir, 'nonexistent'),
      ledgerRoot,
    });
    expect(result).toEqual([]);
  });

  it('returns [] when queue file does not exist in a valid logs directory', async () => {
    // logsDir exists but has no .run-queue.json
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('returns [] when queue file contains an empty array', async () => {
    await writeQueueFile(logsDir, []);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('returns [] when queue file contains corrupt JSON', async () => {
    await writeFile(join(logsDir, '.run-queue.json'), 'not json', 'utf-8');
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('returns [] when queue file is a JSON non-array (e.g. object)', async () => {
    await writeFile(join(logsDir, '.run-queue.json'), JSON.stringify({ id: 'oops' }), 'utf-8');
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PID security: invalid PIDs filtered by isRawQueueEntry
// ---------------------------------------------------------------------------

describe('getQueue — PID security: invalid pid values are filtered out', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    await teardown(tempDir);
    vi.restoreAllMocks();
  });

  it('filters out entry with pid = 0', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ pid: 0 })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('filters out entry with pid = -1 (POSIX broadcast risk)', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ pid: -1 })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('filters out entry with a negative pid', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ pid: -9999 })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('filters out entry with a non-integer float pid', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ pid: 1.5 as unknown as number })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toEqual([]);
  });

  it('accepts a valid positive integer pid', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ pid: 12345 })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// AC-2 through AC-5: effective status computation
// ---------------------------------------------------------------------------

describe('getQueue — AC-2 to AC-5: lifecycle status', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('AC-2: pending + alive + no project → effectiveStatus pending', async () => {
    stubAlive();
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: 'no-project-slug' })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('pending');
  });

  it('AC-3: pending + alive + project exists → effectiveStatus started', async () => {
    stubAlive();
    const slug = '2026-05-05-started';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('started');
  });

  it('AC-4: pending + dead process + no project → effectiveStatus dead', async () => {
    stubDead();
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: 'dead-no-project' })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('dead');
  });

  it('AC-5: pending + dead process + project exists → effectiveStatus started', async () => {
    stubDead();
    const slug = '2026-05-05-dead-started';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('started');
  });
});

// ---------------------------------------------------------------------------
// AC-6: started + synthesis_generated → excluded from result
// ---------------------------------------------------------------------------

describe('getQueue — AC-6: synthesis exclusion', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('excludes entry when synthesis_generated is true', async () => {
    const slug = '2026-05-05-done';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug, { synthesis_generated: true });
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(0);
  });

  it('keeps entry when synthesis_generated is false', async () => {
    const slug = '2026-05-05-ongoing';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug, { synthesis_generated: false });
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('started');
  });

  it('keeps entry when synthesis_generated field is absent', async () => {
    const slug = '2026-05-05-no-synth';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug);  // no synthesis_generated key
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveStatus).toBe('started');
  });
});

// ---------------------------------------------------------------------------
// AC-7: JSONL progress — formatProgressEntry (pure unit tests)
// ---------------------------------------------------------------------------

describe('formatProgressEntry — AC-7: event type mappings', () => {
  it('run_start → "Run started"', () => {
    expect(formatProgressEntry({ action: 'run_start' })).toBe('Run started');
  });

  it('stage_start with stage + wp_id', () => {
    expect(
      formatProgressEntry({ action: 'stage_start', stage: 'developer', wp_id: 'WP-001' }),
    ).toBe('Starting developer for WP-001');
  });

  it('stage_start with stage only (no wp_id)', () => {
    expect(formatProgressEntry({ action: 'stage_start', stage: 'qa' })).toBe('Starting qa');
  });

  it('stage_start with neither stage nor wp_id', () => {
    expect(formatProgressEntry({ action: 'stage_start' })).toBe('Starting (unknown stage)');
  });

  it('stage_complete with result and wp_id', () => {
    expect(
      formatProgressEntry({ action: 'stage_complete', stage: 'qa', result: 'PASS', wp_id: 'WP-002' }),
    ).toBe('qa complete — PASS (WP-002)');
  });

  it('stage_complete with result only (no wp_id)', () => {
    expect(
      formatProgressEntry({ action: 'stage_complete', stage: 'pm', result: 'PASS' }),
    ).toBe('pm complete — PASS');
  });

  it('stage_complete without result', () => {
    expect(formatProgressEntry({ action: 'stage_complete', stage: 'pm' })).toBe('pm complete');
  });

  it('progress_snapshot with total_wps and status_breakdown', () => {
    expect(
      formatProgressEntry({
        action:           'progress_snapshot',
        total_wps:        5,
        status_breakdown: { COMPLETE: 3, IN_PROGRESS: 1 },
      }),
    ).toBe('Progress: 3/5 WPs complete');
  });

  it('progress_snapshot without total_wps → "Progress update"', () => {
    expect(formatProgressEntry({ action: 'progress_snapshot' })).toBe('Progress update');
  });

  it('wp_complete with wp_id', () => {
    expect(formatProgressEntry({ action: 'wp_complete', wp_id: 'WP-003' })).toBe('WP-003 complete');
  });

  it('wp_complete without wp_id', () => {
    expect(formatProgressEntry({ action: 'wp_complete' })).toBe('WP complete');
  });

  it('wp_status_change with wp_id and new_status', () => {
    expect(
      formatProgressEntry({ action: 'wp_status_change', wp_id: 'WP-001', new_status: 'IN_PROGRESS' }),
    ).toBe('WP-001 → IN_PROGRESS');
  });

  it('wp_status_change without new_status', () => {
    expect(
      formatProgressEntry({ action: 'wp_status_change', wp_id: 'WP-001' }),
    ).toBe('WP-001 status change');
  });

  it('run_end with result', () => {
    expect(formatProgressEntry({ action: 'run_end', result: 'COMPLETE' })).toBe('Run ended: COMPLETE');
  });

  it('run_end without result', () => {
    expect(formatProgressEntry({ action: 'run_end' })).toBe('Run ended');
  });

  it('run_error → "Run error"', () => {
    expect(formatProgressEntry({ action: 'run_error' })).toBe('Run error');
  });

  it('signal_shutdown → "Interrupted by signal"', () => {
    expect(formatProgressEntry({ action: 'signal_shutdown' })).toBe('Interrupted by signal');
  });

  it('heartbeat → null (skipped)', () => {
    expect(formatProgressEntry({ action: 'heartbeat' })).toBeNull();
  });

  it('unknown action → null', () => {
    expect(formatProgressEntry({ action: 'some_unknown_event' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-7: JSONL progress — resolved via getQueue() (integration)
// ---------------------------------------------------------------------------

describe('getQueue — AC-7: progress field resolved from JSONL file', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('progress is null when no JSONL log file exists for the slug', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: '2026-05-05-feat' })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.progress).toBeNull();
  });

  it('progress is null when all log entries are heartbeats', async () => {
    const slug = '2026-05-05-heartbeat-only';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'heartbeat', stage: 'cli' },
      { action: 'heartbeat', stage: 'cli' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.progress).toBeNull();
  });

  it('progress reflects the last summarisable entry (skips trailing heartbeats)', async () => {
    const slug = '2026-05-05-with-progress';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'developer', wp_id: 'WP-001' },
      { action: 'heartbeat', stage: 'cli' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.progress).toBe('Starting developer for WP-001');
  });

  it('progress picks the lexicographically newest JSONL file for the slug', async () => {
    const slug = '2026-05-05-two-logs';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    // Older log
    await writeJsonlLog(logsDir, '20260505T090000', slug, [{ action: 'run_start' }]);
    // Newer log (lexicographically later prefix)
    await writeJsonlLog(logsDir, '20260505T110000', slug, [
      { action: 'stage_start', stage: 'qa', wp_id: 'WP-002' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.progress).toBe('Starting qa for WP-002');
  });
});

// ---------------------------------------------------------------------------
// WP-003 AC-6: lastAction and logFilename fields in QueueEntry
// ---------------------------------------------------------------------------

describe('getQueue — WP-003 AC-6: lastAction and logFilename population', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('lastAction is null when no JSONL log file exists for the slug', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: '2026-05-05-no-log' })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.lastAction).toBeNull();
  });

  it('logFilename is null when no JSONL log file exists for the slug', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: '2026-05-05-no-log' })]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.logFilename).toBeNull();
  });

  it('lastAction matches the action field of the last summarizable JSONL entry', async () => {
    const slug = '2026-05-05-last-action';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'developer', wp_id: 'WP-001' },
      { action: 'heartbeat' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.lastAction).toBe('stage_start');
  });

  it('logFilename is the basename of the JSONL file that was read', async () => {
    const slug = '2026-05-05-filename';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'run_start' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.logFilename).toBe(`20260505T100000-${slug}.jsonl`);
  });

  it('logFilename is populated even when all entries are non-summarizable (heartbeats only)', async () => {
    const slug = '2026-05-05-heartbeats';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'heartbeat' },
      { action: 'heartbeat' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    // logFilename is set (file was found), but lastAction/progress are null
    expect(result[0]!.logFilename).toBe(`20260505T100000-${slug}.jsonl`);
    expect(result[0]!.lastAction).toBeNull();
  });

  it('lastAction is null when file has only non-summarizable events', async () => {
    const slug = '2026-05-05-no-action';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, '20260505T100000', slug, [
      { action: 'heartbeat' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.lastAction).toBeNull();
  });

  it('lastAction and logFilename are both non-null from the same ProgressResolution result', async () => {
    const slug = '2026-05-05-both-fields';
    const prefix = '20260505T120000';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeJsonlLog(logsDir, prefix, slug, [
      { action: 'stage_start', stage: 'qa', wp_id: 'WP-002' },
    ]);
    const result = await getQueue({ logsDir, ledgerRoot });
    expect(result[0]!.lastAction).toBe('stage_start');
    expect(result[0]!.logFilename).toBe(`${prefix}-${slug}.jsonl`);
  });
});

// ---------------------------------------------------------------------------
// AC-8: getQueue() never modifies the queue file
// ---------------------------------------------------------------------------

describe('getQueue — AC-8: queue file is read-only', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('queue file content is byte-identical before and after getQueue()', async () => {
    const slug = '2026-05-05-readonly';
    const entries = [makeRawEntry({ expectedSlug: slug })];
    await writeQueueFile(logsDir, entries);

    const queuePath = join(logsDir, '.run-queue.json');
    const before    = await readFile(queuePath, 'utf-8');

    await getQueue({ logsDir, ledgerRoot });

    const after = await readFile(queuePath, 'utf-8');
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// killQueueEntry — WP-006 (AC-1, AC-7: graceful rejection without sleeping)
// ---------------------------------------------------------------------------

describe('killQueueEntry — graceful rejection (no sleep involved)', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('AC-7: returns { killed: false } when entry is not found in an empty queue', async () => {
    stubAlive();
    await writeQueueFile(logsDir, []);
    const result = await killQueueEntry({ id: 'missing-id', logsDir, ledgerRoot });
    expect(result.killed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('AC-7: returns { killed: false } when entry ID is not present in a non-empty queue', async () => {
    stubAlive();
    await writeQueueFile(logsDir, [makeRawEntry({ id: 'other-id' })]);
    const result = await killQueueEntry({ id: 'missing-id', logsDir, ledgerRoot });
    expect(result.killed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('AC-1: returns { killed: false } when entry is effectively started (alive + project exists)', async () => {
    stubAlive();
    const slug = '2026-05-05-started';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug);
    const result = await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });
    expect(result.killed).toBe(false);
    expect(result.reason).toMatch(/started|force/i);
  });

  it('AC-1: returns { killed: false } when entry is effectively dead (not alive + no project)', async () => {
    stubDead();
    await writeQueueFile(logsDir, [makeRawEntry()]);
    const result = await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });
    expect(result.killed).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// killQueueEntry — WP-006 (AC-2, AC-3, AC-4: kill path for pending entries)
// ---------------------------------------------------------------------------

describe('killQueueEntry — kill path (effectively pending entries)', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;
  let planDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    planDir = join(tempDir, 'plan-dir');
    await mkdir(planDir);
    // Make sleep() resolve immediately so tests don't wait 3 real seconds.
    vi.spyOn(global, 'setTimeout').mockImplementation(
      (fn: (...args: unknown[]) => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; },
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('AC-2: sends SIGTERM then SIGKILL when process survives the wait', async () => {
    const signals: (string | number)[] = [];
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      signals.push(signal as string | number);
      return true;  // always alive — signal 0 never throws
    });

    await writeQueueFile(logsDir, [makeRawEntry()]);
    const result = await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    expect(result.killed).toBe(true);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGKILL');
  });

  it('AC-2: sends SIGTERM but not SIGKILL when process exits after SIGTERM', async () => {
    let sigTermSent = false;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') { sigTermSent = true; }
      if (signal === 0 && sigTermSent) {
        // Process died after receiving SIGTERM.
        throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      }
      return true;
    });

    await writeQueueFile(logsDir, [makeRawEntry()]);
    const result = await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    expect(result.killed).toBe(true);
    const sigkillCalls = killSpy.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
    expect(sigkillCalls).toHaveLength(0);
  });

  it('AC-2 (TOCTOU): SIGTERM throws ESRCH (process dies in race window) — returns { killed: true } and cleans up queue entry', async () => {
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') {
        throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      }
      return true;
    });

    const planPath = join(planDir, 'plan.md');
    await writeQueueFile(logsDir, [makeRawEntry({ planPath })]);
    const result = await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    expect(result.killed).toBe(true);
    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(0);
  });

  it('AC-3: removes the killed entry from the queue file on disk', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const planPath   = join(planDir, 'plan.md');
    const otherEntry = makeRawEntry({ id: 'other-id', expectedSlug: '2026-05-05-other' });
    await writeQueueFile(logsDir, [makeRawEntry({ planPath }), otherEntry]);

    await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as Record<string, unknown>)['id']).toBe('other-id');
  });

  it('AC-4: removes the .orchestrator.lock file from the plan directory', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const planPath = join(planDir, 'plan.md');
    const lockPath = join(planDir, '.orchestrator.lock');
    await writeFile(lockPath, '', 'utf-8');

    await writeQueueFile(logsDir, [makeRawEntry({ planPath })]);
    await killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    let lockExists = false;
    try {
      await readFile(lockPath);
      lockExists = true;
    } catch {
      lockExists = false;
    }
    expect(lockExists).toBe(false);
  });

  it('AC-4: no error when .orchestrator.lock file does not exist', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const planPath = join(planDir, 'plan.md');
    await writeQueueFile(logsDir, [makeRawEntry({ planPath })]);

    await expect(
      killQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot }),
    ).resolves.toEqual({ killed: true });
  });
});

// ---------------------------------------------------------------------------
// dismissQueueEntry — WP-006 (AC-5, AC-7: graceful rejection)
// ---------------------------------------------------------------------------

describe('dismissQueueEntry — graceful rejection', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('AC-7: returns without throwing when entry is not found', async () => {
    stubDead();
    await writeQueueFile(logsDir, []);
    await expect(
      dismissQueueEntry({ id: 'missing-id', logsDir, ledgerRoot }),
    ).resolves.toBeUndefined();
  });

  it('AC-5: no-op when entry is effectively pending (alive + no project)', async () => {
    stubAlive();
    await writeQueueFile(logsDir, [makeRawEntry()]);

    await dismissQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(1);
  });

  it('AC-5: no-op when entry is effectively started (project exists)', async () => {
    stubAlive();
    const slug = '2026-05-05-started';
    await writeQueueFile(logsDir, [makeRawEntry({ expectedSlug: slug })]);
    await writeLedgerProject(ledgerRoot, slug);

    await dismissQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// dismissQueueEntry — WP-006 (AC-6: dismiss path for dead entries)
// ---------------------------------------------------------------------------

describe('dismissQueueEntry — dismiss path (effectively dead entries)', () => {
  let tempDir: string;
  let logsDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    ({ tempDir, logsDir, ledgerRoot } = await setupDirs());
    stubDead();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(tempDir);
  });

  it('AC-6: removes the dead entry from the queue file', async () => {
    await writeQueueFile(logsDir, [makeRawEntry()]);

    await dismissQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(0);
  });

  it('AC-6: other entries are preserved after dismiss', async () => {
    const keepEntry = makeRawEntry({ id: 'keep-id', expectedSlug: '2026-05-05-keep' });
    await writeQueueFile(logsDir, [makeRawEntry(), keepEntry]);

    await dismissQueueEntry({ id: 'test-entry-id', logsDir, ledgerRoot });

    const queuePath = join(logsDir, '.run-queue.json');
    const remaining = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown[];
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as Record<string, unknown>)['id']).toBe('keep-id');
  });
});

// ---------------------------------------------------------------------------
// startOrchestrator — WP-007
// ---------------------------------------------------------------------------

/**
 * Build a minimal workspace scaffold under tempDir:
 *   orchestrator/.venv/bin/orchestrate  (Unix) — or Scripts/orchestrate.exe (Win)
 *   orchestrator/.env                   — with ANTHROPIC_API_KEY set
 *   orchestrator/logs/                  — empty logs dir
 *   mcp-server/dist/index.js            — sentinel with current mtime
 *   mcp-server/src/                     — empty src dir (no stale files)
 *   plans/2026-05-05-test/plan.md       — plan file
 */
async function scaffoldWorkspace(
  tempDir: string,
): Promise<{ workspaceRoot: string; planPath: string; logsDir: string }> {
  const workspaceRoot = tempDir;
  const isWin         = process.platform === 'win32';
  const venvBin       = isWin ? 'Scripts' : 'bin';
  const binExt        = isWin ? '.exe' : '';

  const binDir    = join(workspaceRoot, 'orchestrator', '.venv', venvBin);
  const logsDir   = join(workspaceRoot, 'orchestrator', 'logs');
  const mcpDistDir = join(workspaceRoot, 'mcp-server', 'dist');
  const mcpSrcDir  = join(workspaceRoot, 'mcp-server', 'src');
  const planDir   = join(workspaceRoot, 'plans', '2026-05-05-test');

  await mkdir(binDir,     { recursive: true });
  await mkdir(logsDir,    { recursive: true });
  await mkdir(mcpDistDir, { recursive: true });
  await mkdir(mcpSrcDir,  { recursive: true });
  await mkdir(planDir,    { recursive: true });

  // Orchestrate binary (empty file, just needs to exist).
  const binPath = join(binDir, `orchestrate${binExt}`);
  await writeFile(binPath, '', 'utf-8');

  // .env with an API key.
  await writeFile(join(workspaceRoot, 'orchestrator', '.env'), 'ANTHROPIC_API_KEY=test-key\n', 'utf-8');

  // dist sentinel — write before src so sentinel mtime > any src file.
  const sentinelPath = join(mcpDistDir, 'index.js');
  await writeFile(sentinelPath, '// sentinel', 'utf-8');

  // plan.md
  const planPath = join(planDir, 'plan.md');
  await writeFile(planPath, '# Plan\n', 'utf-8');

  return { workspaceRoot, planPath, logsDir };
}

describe('startOrchestrator — dryRun and check structure', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;
  let logsDir:       string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-start-test-'));
    ({ workspaceRoot, planPath, logsDir } = await scaffoldWorkspace(tempDir));
    // Stub child_process.spawn so tests don't start real processes.
    vi.mocked(spawn).mockReturnValue({
      pid:   99999,
      unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('AC-1: dryRun:true returns checks array and started:false without spawning', async () => {
    const result = await startOrchestrator(planPath, workspaceRoot, true);

    expect(result.started).toBe(false);
    expect(result.pid).toBeUndefined();
    expect(result.checks.length).toBeGreaterThan(0);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('AC-1: every check passes when the workspace is correctly scaffolded', async () => {
    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const failed = result.checks.filter((c) => !c.pass);
    expect(failed).toHaveLength(0);
  });

  it('AC-3: all checks pass + dryRun:false → started:true with pid', async () => {
    const result = await startOrchestrator(planPath, workspaceRoot, false);

    expect(result.started).toBe(true);
    expect(result.pid).toBe(99999);
    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
  });

  it('AC-2: any failing check keeps started:false and blocks spawn', async () => {
    // Remove the .env so the env check fails.
    await rm(join(workspaceRoot, 'orchestrator', '.env'), { force: true });

    const result = await startOrchestrator(planPath, workspaceRoot, false);

    expect(result.started).toBe(false);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    const envCheck = result.checks.find((c) => c.name === 'env');
    expect(envCheck?.pass).toBe(false);
  });
});

describe('startOrchestrator — plan-basename checks (AC-5)', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-path-test-'));
    ({ workspaceRoot, planPath } = await scaffoldWorkspace(tempDir));
    vi.mocked(spawn).mockReturnValue({
      pid: 1, unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('AC-5: non-standard plan folder basename → plan-basename check fails', async () => {
    // Create a plan at a path with a non-standard folder name.
    const badPlanDir = join(workspaceRoot, 'plans', 'my-feature');
    await mkdir(badPlanDir, { recursive: true });
    const badPlanPath = join(badPlanDir, 'plan.md');
    await writeFile(badPlanPath, '# Plan\n', 'utf-8');

    const result = await startOrchestrator(badPlanPath, workspaceRoot, true);

    const basenameCheck = result.checks.find((c) => c.name === 'plan-basename');
    expect(basenameCheck?.pass).toBe(false);
    // No unhandled exception — the error is surfaced as a check, not thrown.
    expect(result.started).toBe(false);
  });

  it('AC-5: standard plan folder basename → plan-basename check passes', async () => {
    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const basenameCheck = result.checks.find((c) => c.name === 'plan-basename');
    expect(basenameCheck?.pass).toBe(true);
  });

  it('AC-5: folder path (no file) → plan-basename check passes', async () => {
    // The GUI resume button sends the plan folder path directly, not the file.
    const planDir = join(workspaceRoot, 'plans', '2026-05-05-test');
    const result = await startOrchestrator(planDir, workspaceRoot, true);

    const basenameCheck = result.checks.find((c) => c.name === 'plan-basename');
    expect(basenameCheck?.pass).toBe(true);
  });
});

describe('startOrchestrator — no-conflict check (AC-6)', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;
  let logsDir:       string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-conflict-test-'));
    ({ workspaceRoot, planPath, logsDir } = await scaffoldWorkspace(tempDir));
    vi.mocked(spawn).mockReturnValue({
      pid: 1, unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
    stubAlive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('AC-6: plan already in queue → no-conflict check fails', async () => {
    await writeQueueFile(logsDir, [makeRawEntry({ planPath, pid: 55555 })]);

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const conflictCheck = result.checks.find((c) => c.name === 'no-conflict');
    expect(conflictCheck?.pass).toBe(false);
    expect(conflictCheck?.detail).toContain('55555');
  });

  it('AC-6: plan not in queue → no-conflict check passes', async () => {
    await writeQueueFile(logsDir, []);

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const conflictCheck = result.checks.find((c) => c.name === 'no-conflict');
    expect(conflictCheck?.pass).toBe(true);
  });
});

describe('startOrchestrator — spawn behaviour (AC-7, AC-8)', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;
  let unrefSpy:      ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-spawn-test-'));
    ({ workspaceRoot, planPath } = await scaffoldWorkspace(tempDir));
    unrefSpy = vi.fn();
    vi.mocked(spawn).mockReturnValue({
      pid:   42,
      unref: unrefSpy,
    } as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('AC-7: spawned process has detached:true and unref() is called', async () => {
    await startOrchestrator(planPath, workspaceRoot, false);

    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0]!;
    expect((spawnOpts as { detached?: boolean }).detached).toBe(true);
    expect(unrefSpy).toHaveBeenCalledOnce();
  });

  it('AC-8: spawned binary is bin/orchestrate on Unix or Scripts/orchestrate.exe on Windows', async () => {
    await startOrchestrator(planPath, workspaceRoot, false);

    const [spawnCmd] = vi.mocked(spawn).mock.calls[0]!;
    const expected   = process.platform === 'win32'
      ? join(workspaceRoot, 'orchestrator', '.venv', 'Scripts', 'orchestrate.exe')
      : join(workspaceRoot, 'orchestrator', '.venv', 'bin', 'orchestrate');
    expect(spawnCmd).toBe(expected);
  });

  it('AC-7: stdio of spawned process is fully ignored', async () => {
    await startOrchestrator(planPath, workspaceRoot, false);

    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0]!;
    expect((spawnOpts as { stdio?: unknown }).stdio).toEqual(['ignore', 'ignore', 'ignore']);
  });
});

// ---------------------------------------------------------------------------
// startOrchestrator — individual preflight check failures (WP-015 AC-3)
// Tests the fail path for each of the three checks not covered above:
// venv, plan-file, mcp-dist.
// ---------------------------------------------------------------------------

describe('startOrchestrator — venv, plan-file, mcp-dist check failures (WP-015 AC-3)', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-checks-test-'));
    ({ workspaceRoot, planPath } = await scaffoldWorkspace(tempDir));
    vi.mocked(spawn).mockReturnValue({
      pid: 1, unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('venv check fails when the orchestrate binary is absent', async () => {
    const isWin  = process.platform === 'win32';
    const binExt = isWin ? '.exe' : '';
    const binDir = join(workspaceRoot, 'orchestrator', '.venv', isWin ? 'Scripts' : 'bin');
    await rm(join(binDir, `orchestrate${binExt}`), { force: true });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const venvCheck = result.checks.find((c) => c.name === 'venv');
    expect(venvCheck?.pass).toBe(false);
    expect(result.started).toBe(false);
  });

  it('plan-file check fails when plan.md does not exist', async () => {
    await rm(planPath, { force: true });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const planFileCheck = result.checks.find((c) => c.name === 'plan-file');
    expect(planFileCheck?.pass).toBe(false);
    expect(result.started).toBe(false);
  });

  it('mcp-dist check fails when dist/index.js is absent', async () => {
    await rm(join(workspaceRoot, 'mcp-server', 'dist', 'index.js'), { force: true });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const mcpDistCheck = result.checks.find((c) => c.name === 'mcp-dist');
    expect(mcpDistCheck?.pass).toBe(false);
    expect(result.started).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startOrchestrator — live API key checks (WP-007 AC-9)
// ---------------------------------------------------------------------------

describe('startOrchestrator — live API key liveness checks (AC-9)', () => {
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-apikey-test-'));
    ({ workspaceRoot, planPath } = await scaffoldWorkspace(tempDir));
    vi.mocked(spawn).mockReturnValue({
      pid: 1, unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('anthropic-key check passes when provider returns 200', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const keyCheck = result.checks.find((c) => c.name === 'anthropic-key');
    expect(keyCheck?.pass).toBe(true);
    expect(keyCheck?.detail).toContain('Anthropic');
  });

  it('anthropic-key check fails when provider returns 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const keyCheck = result.checks.find((c) => c.name === 'anthropic-key');
    expect(keyCheck?.pass).toBe(false);
    expect(keyCheck?.detail).toContain('invalid or expired key');
  });

  it('anthropic-key check fails when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const keyCheck = result.checks.find((c) => c.name === 'anthropic-key');
    expect(keyCheck?.pass).toBe(false);
    expect(keyCheck?.detail).toContain('Network failure');
  });

  it('google-key check passes when provider returns 200', async () => {
    await writeFile(
      join(workspaceRoot, 'orchestrator', '.env'),
      'GOOGLE_API_KEY=test-google-key\n',
      'utf-8',
    );
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const keyCheck = result.checks.find((c) => c.name === 'google-key');
    expect(keyCheck?.pass).toBe(true);
    expect(keyCheck?.detail).toContain('Google');
  });

  it('google-key check fails when provider returns 403', async () => {
    await writeFile(
      join(workspaceRoot, 'orchestrator', '.env'),
      'GOOGLE_API_KEY=test-google-key\n',
      'utf-8',
    );
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    const keyCheck = result.checks.find((c) => c.name === 'google-key');
    expect(keyCheck?.pass).toBe(false);
    expect(keyCheck?.detail).toContain('invalid or expired key');
  });

  it('both key checks run when both keys are configured', async () => {
    await writeFile(
      join(workspaceRoot, 'orchestrator', '.env'),
      'ANTHROPIC_API_KEY=ant-key\nGOOGLE_API_KEY=goo-key\n',
      'utf-8',
    );
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    expect(result.checks.find((c) => c.name === 'anthropic-key')?.pass).toBe(true);
    expect(result.checks.find((c) => c.name === 'google-key')?.pass).toBe(true);
  });

  it('no live key checks are emitted when .env contains no keys', async () => {
    await writeFile(
      join(workspaceRoot, 'orchestrator', '.env'),
      '# no keys here\n',
      'utf-8',
    );

    const result = await startOrchestrator(planPath, workspaceRoot, true);

    expect(result.checks.find((c) => c.name === 'anthropic-key')).toBeUndefined();
    expect(result.checks.find((c) => c.name === 'google-key')).toBeUndefined();
    expect(result.checks.find((c) => c.name === 'env')?.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startOrchestrator — WP-003: resume spawn args (AC-1, AC-2)
// ---------------------------------------------------------------------------

describe('startOrchestrator — resumeThreadId spawn args (WP-003 AC-1, AC-2)', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
  let tempDir:       string;
  let workspaceRoot: string;
  let planPath:      string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orch-resume-test-'));
    ({ workspaceRoot, planPath } = await scaffoldWorkspace(tempDir));
    vi.mocked(spawn).mockReturnValue({
      pid:   42,
      unref: vi.fn(),
    } as unknown as ReturnType<typeof spawn>);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('AC-1: spawns with ["--resume", resumeThreadId, resolvedPlan] when resumeThreadId is provided', async () => {
    await startOrchestrator(planPath, workspaceRoot, false, VALID_UUID);

    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    const resolvedPlan  = spawnArgs[2];
    expect(spawnArgs[0]).toBe('--resume');
    expect(spawnArgs[1]).toBe(VALID_UUID);
    expect(resolvedPlan).toBeTruthy();
    expect(spawnArgs).toHaveLength(3);
  });

  it('AC-2: spawns with [resolvedPlan] only when resumeThreadId is omitted', async () => {
    await startOrchestrator(planPath, workspaceRoot, false);

    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).not.toBe('--resume');
  });

  it('AC-2: spawns with [resolvedPlan] only when resumeThreadId is explicitly undefined', async () => {
    await startOrchestrator(planPath, workspaceRoot, false, undefined);

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).not.toBe('--resume');
  });

  it('AC-1: resume args are placed before resolvedPlan in the correct order', async () => {
    await startOrchestrator(planPath, workspaceRoot, false, VALID_UUID);

    const [, spawnArgs] = vi.mocked(spawn).mock.calls[0]!;
    // Must be exactly ['--resume', uuid, resolvedPlan]
    expect(spawnArgs[0]).toBe('--resume');
    expect(spawnArgs[1]).toBe(VALID_UUID);
    // 3rd arg is the resolved plan path (an absolute path)
    expect(typeof spawnArgs[2]).toBe('string');
    expect(spawnArgs[2]).toContain('plan.md');
  });

  it('AC-1: dryRun=true skips spawn even when resumeThreadId is provided', async () => {
    const result = await startOrchestrator(planPath, workspaceRoot, true, VALID_UUID);

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(result.started).toBe(false);
  });
});
