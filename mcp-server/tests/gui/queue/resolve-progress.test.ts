/**
 * Tests for src/gui/queue/resolve-progress.ts — WP-001
 *
 * Verifies:
 *   AC-1: resolveProgress() returns a ProgressResolution object with the
 *         correct fields (summary, lastAction, logFilename, hasStageActivity).
 *   AC-2: summary matches existing behavior (same string as before the refactor).
 *   AC-3: lastAction contains the action field of the entry that produced summary.
 *   AC-4: logFilename contains the basename of the JSONL file read.
 *   AC-5: hasStageActivity is true when lastAction is non-null and not 'run_start'.
 *   (formatProgressEntry behavior tested inline via resolveProgress results.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveProgress,
  formatProgressEntry,
  type ProgressResolution,
} from '../../../src/gui/queue/resolve-progress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup(): Promise<{ tempDir: string; logsDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'rp-test-'));
  const logsDir = tempDir;
  return { tempDir, logsDir };
}

async function teardown(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

async function writeJsonlLog(
  logsDir: string,
  prefix: string,
  slug: string,
  entries: unknown[],
): Promise<string> {
  const filename = `${prefix}-${slug}.jsonl`;
  const content  = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(join(logsDir, filename), content, 'utf-8');
  return filename;
}

/** Assert the shape of an empty / no-activity resolution. */
function expectEmpty(result: ProgressResolution): void {
  expect(result.summary).toBeNull();
  expect(result.lastAction).toBeNull();
  expect(result.hasStageActivity).toBe(false);
}

// ---------------------------------------------------------------------------
// AC-1 / AC-4: ProgressResolution shape — no log file
// ---------------------------------------------------------------------------

describe('resolveProgress — no log file', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('returns a ProgressResolution with all null/false fields when no log file exists', async () => {
    const result = await resolveProgress(logsDir, 'nonexistent-slug');
    expectEmpty(result);
    expect(result.logFilename).toBeNull();
  });

  it('returns ProgressResolution with null fields when logs directory is missing', async () => {
    const result = await resolveProgress(join(tempDir, 'no-such-dir'), 'slug');
    expectEmpty(result);
    expect(result.logFilename).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-4: logFilename is the basename of the JSONL file
// ---------------------------------------------------------------------------

describe('resolveProgress — AC-4: logFilename', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('logFilename is the basename (not a full path) of the JSONL file', async () => {
    const slug     = '2026-05-06-feat';
    const filename = await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.logFilename).toBe(filename);
    expect(result.logFilename).not.toContain('/');
  });

  it('logFilename is non-null even when file contains only heartbeats (no summary)', async () => {
    const slug     = '2026-05-06-heartbeat';
    const filename = await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'heartbeat' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.logFilename).toBe(filename);
    expect(result.summary).toBeNull();
  });

  it('picks the lexicographically newest JSONL file for the slug', async () => {
    const slug = '2026-05-06-two-logs';
    await writeJsonlLog(logsDir, '20260506T090000', slug, [{ action: 'run_start' }]);
    const newerFilename = await writeJsonlLog(logsDir, '20260506T110000', slug, [
      { action: 'stage_start', stage: 'qa' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.logFilename).toBe(newerFilename);
    expect(result.summary).toBe('Starting qa');
  });
});

// ---------------------------------------------------------------------------
// AC-2: summary matches existing behavior
// ---------------------------------------------------------------------------

describe('resolveProgress — AC-2: summary string', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('summary is null when all entries are heartbeats', async () => {
    const slug = '2026-05-06-hb-only';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'heartbeat' },
      { action: 'heartbeat' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBeNull();
  });

  it('summary reflects the last summarisable entry (skips trailing heartbeats)', async () => {
    const slug = '2026-05-06-trailing-hb';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'developer', wp_id: 'WP-001' },
      { action: 'heartbeat' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBe('Starting developer for WP-001');
  });

  it('summary uses the last entry when there are no trailing non-summarisable events', async () => {
    const slug = '2026-05-06-clean';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'qa' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBe('Starting qa');
  });

  it('summary is "Run started" for a log with only run_start', async () => {
    const slug = '2026-05-06-run-start-only';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [{ action: 'run_start' }]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBe('Run started');
  });
});

// ---------------------------------------------------------------------------
// AC-3: lastAction
// ---------------------------------------------------------------------------

describe('resolveProgress — AC-3: lastAction', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('lastAction is null when no summarisable entry exists', async () => {
    const slug = '2026-05-06-no-summary';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [{ action: 'heartbeat' }]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBeNull();
  });

  it('lastAction is "run_start" for a log ending with run_start', async () => {
    const slug = '2026-05-06-last-run-start';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [{ action: 'run_start' }]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBe('run_start');
  });

  it('lastAction is "stage_start" when stage_start is the last summarisable event', async () => {
    const slug = '2026-05-06-last-stage-start';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'developer' },
      { action: 'heartbeat' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBe('stage_start');
  });

  it('lastAction is "stage_complete" when stage_complete is the last summarisable event', async () => {
    const slug = '2026-05-06-last-stage-complete';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'stage_start', stage: 'developer' },
      { action: 'stage_complete', stage: 'developer', result: 'PASS' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBe('stage_complete');
  });
});

// ---------------------------------------------------------------------------
// AC-5: hasStageActivity
// ---------------------------------------------------------------------------

describe('resolveProgress — AC-5: hasStageActivity', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('hasStageActivity is false when no summarisable entry exists', async () => {
    const slug = '2026-05-06-no-act';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [{ action: 'heartbeat' }]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.hasStageActivity).toBe(false);
  });

  it('hasStageActivity is false when lastAction is "run_start"', async () => {
    const slug = '2026-05-06-run-start';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
      { action: 'heartbeat' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBe('run_start');
    expect(result.hasStageActivity).toBe(false);
  });

  it('hasStageActivity is true when lastAction is "stage_start"', async () => {
    const slug = '2026-05-06-stage-start';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'run_start' },
      { action: 'stage_start', stage: 'developer' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.hasStageActivity).toBe(true);
  });

  it('hasStageActivity is true when lastAction is "stage_complete"', async () => {
    const slug = '2026-05-06-stage-complete';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'stage_start', stage: 'developer' },
      { action: 'stage_complete', stage: 'developer', result: 'PASS' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.hasStageActivity).toBe(true);
  });

  it('hasStageActivity is true when lastAction is "run_end"', async () => {
    const slug = '2026-05-06-run-end';
    await writeJsonlLog(logsDir, '20260506T100000', slug, [
      { action: 'stage_start', stage: 'developer' },
      { action: 'run_end', result: 'SUCCESS' },
    ]);
    const result = await resolveProgress(logsDir, slug);
    expect(result.lastAction).toBe('run_end');
    expect(result.hasStageActivity).toBe(true);
  });

  it('hasStageActivity is false when log file is absent', async () => {
    const result = await resolveProgress(logsDir, 'no-log-slug');
    expect(result.hasStageActivity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatProgressEntry — event type mappings (re-exported from new module)
// ---------------------------------------------------------------------------

describe('formatProgressEntry — event type mappings', () => {
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

  it('stage_complete with result and wp_id', () => {
    expect(
      formatProgressEntry({ action: 'stage_complete', stage: 'qa', result: 'PASS', wp_id: 'WP-002' }),
    ).toBe('qa complete — PASS (WP-002)');
  });

  it('run_end with result', () => {
    expect(formatProgressEntry({ action: 'run_end', result: 'COMPLETE' })).toBe(
      'Run ended: COMPLETE',
    );
  });

  it('heartbeat → null', () => {
    expect(formatProgressEntry({ action: 'heartbeat' })).toBeNull();
  });

  it('unknown action → null', () => {
    expect(formatProgressEntry({ action: 'unknown_action' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WP-C: Edge-case coverage — malformed JSONL lines and empty log files
// ---------------------------------------------------------------------------

describe('resolveProgress — malformed JSONL lines', () => {
  let tempDir: string;
  let logsDir: string;

  beforeEach(async () => {
    ({ tempDir, logsDir } = await setup());
  });

  afterEach(async () => {
    await teardown(tempDir);
  });

  it('skips a malformed last line and returns the preceding valid entry', async () => {
    const slug     = '2026-05-06-malformed-last';
    const filename = `20260506T120000-${slug}.jsonl`;
    // Valid stage_start line followed by an invalid JSON line.
    const content  = JSON.stringify({ action: 'stage_start', stage: 'developer' }) + '\n'
                   + 'not valid json {\n';
    await writeFile(join(logsDir, filename), content, 'utf-8');
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBe('Starting developer');
    expect(result.lastAction).toBe('stage_start');
    expect(result.logFilename).toBe(filename);
  });

  it('returns empty resolution with logFilename set when all lines are malformed', async () => {
    const slug     = '2026-05-06-all-malformed';
    const filename = `20260506T120000-${slug}.jsonl`;
    await writeFile(join(logsDir, filename), 'not json\n{broken\n', 'utf-8');
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBeNull();
    expect(result.lastAction).toBeNull();
    expect(result.logFilename).toBe(filename);
    expect(result.hasStageActivity).toBe(false);
  });

  it('returns empty resolution with logFilename set for a 0-byte log file', async () => {
    const slug     = '2026-05-06-empty-log';
    const filename = `20260506T120000-${slug}.jsonl`;
    await writeFile(join(logsDir, filename), '', 'utf-8');
    const result = await resolveProgress(logsDir, slug);
    expect(result.summary).toBeNull();
    expect(result.lastAction).toBeNull();
    expect(result.logFilename).toBe(filename);
    expect(result.hasStageActivity).toBe(false);
  });
});

