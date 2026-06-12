/**
 * Tests for src/gui/queue/get-queue.ts — WP-005 + WP-001 (rework) + this plan AC-2
 *
 * Verifies:
 *   AC-1 (WP-005): getQueue() returns entries with projectExists: true when the
 *         project ledger file exists on disk.
 *   AC-2 (WP-005): getQueue() returns entries with projectExists: false when no
 *         project ledger file exists for the entry's expectedSlug.
 *   AC-3 (WP-001 rework — validator): isRawQueueEntry() rejects entries whose
 *         expectedSlug is an empty string or a whitespace-only string (e.g. '   ').
 *         getQueue() returns an empty array for such malformed entries.
 *   AC-2 (this plan): getProjectLedgerStatus() returns { exists: false, synthesisGenerated: false }
 *         when slug or expectedRepo fails assertSafeSegment() (path-traversal or empty).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getQueue, getProjectLedgerStatus } from '../../../src/gui/queue/get-queue.js';
import { QUEUE_FILENAME } from '../../../src/gui/queue/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestEnv {
  tempDir: string;
  logsDir: string;
  ledgerRoot: string;
}

async function setup(): Promise<TestEnv> {
  const tempDir    = await mkdtemp(join(tmpdir(), 'get-queue-test-'));
  const logsDir    = join(tempDir, 'logs');
  const ledgerRoot = join(tempDir, 'ledger');
  await mkdir(logsDir,    { recursive: true });
  await mkdir(ledgerRoot, { recursive: true });
  return { tempDir, logsDir, ledgerRoot };
}

async function teardown(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

/**
 * Writes a minimal `.run-queue.json` with a single entry whose PID is
 * intentionally unreachable. Avoid PID 0 — `process.kill(0, 0)` targets the
 * current process group on POSIX systems. Use a very large integer that is
 * almost certainly unused instead.
 */
async function writeQueue(logsDir: string, slug: string, pid = 999_999_999): Promise<void> {
  const entry = {
    id:          'test-id-1',
    pid,
    planPath:    `/fake/plans/${slug}`,
    expectedSlug: slug,
    startedAt:   '2026-05-20T00:00:00Z',
    status:      'pending',
  };
  await writeFile(join(logsDir, QUEUE_FILENAME), JSON.stringify([entry]), 'utf-8');
}

/**
 * Creates a minimal project-ledger.json at `<ledgerRoot>/<slug>/project-ledger.json`.
 */
async function createProjectLedger(ledgerRoot: string, slug: string): Promise<void> {
  const projectDir = join(ledgerRoot, slug);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'project-ledger.json'),
    JSON.stringify({ synthesis_generated: false }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// AC-1: projectExists is true when the ledger file exists
// ---------------------------------------------------------------------------

describe('getQueue — AC-1: projectExists is true when ledger file exists', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await teardown(env.tempDir);
  });

  it('returns projectExists: true for an entry whose project ledger exists', async () => {
    const slug = '2026-05-20-my-feature';
    await writeQueue(env.logsDir, slug);
    await createProjectLedger(env.ledgerRoot, slug);

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(1);
    expect(entries[0].projectExists).toBe(true);
    expect(entries[0].expectedSlug).toBe(slug);
  });
});

// ---------------------------------------------------------------------------
// AC-2: projectExists is false when the ledger file does not exist
// ---------------------------------------------------------------------------

describe('getQueue — AC-2: projectExists is false when ledger file is absent', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await teardown(env.tempDir);
  });

  it('returns projectExists: false for an entry with no project ledger on disk', async () => {
    const slug = '2026-05-20-no-ledger';
    await writeQueue(env.logsDir, slug);
    // Intentionally do NOT create a project ledger for this slug.

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(1);
    expect(entries[0].projectExists).toBe(false);
    expect(entries[0].expectedSlug).toBe(slug);
  });
});

// ---------------------------------------------------------------------------
// AC-3 (rework): isRawQueueEntry rejects entries with empty-string expectedSlug
// ---------------------------------------------------------------------------

describe('getQueue — validator: rejects entry with empty expectedSlug', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await teardown(env.tempDir);
  });

  it('filters out an entry whose expectedSlug is an empty string', async () => {
    // Write a queue with one entry that has an empty expectedSlug.
    const invalidEntry = {
      id:           'test-empty-slug',
      pid:          999_999_999,
      planPath:     '/fake/plans/empty-slug',
      expectedSlug: '',
      startedAt:    '2026-05-20T00:00:00Z',
      status:       'pending',
    };
    await writeFile(
      join(env.logsDir, QUEUE_FILENAME),
      JSON.stringify([invalidEntry]),
      'utf-8',
    );

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(0);
  });

  it('filters out an entry whose expectedSlug is whitespace-only', async () => {
    // Write a queue with one entry that has a whitespace-only expectedSlug.
    const invalidEntry = {
      id:           'test-whitespace-slug',
      pid:          999_999_999,
      planPath:     '/fake/plans/whitespace-slug',
      expectedSlug: '   ',
      startedAt:    '2026-05-20T00:00:00Z',
      status:       'pending',
    };
    await writeFile(
      join(env.logsDir, QUEUE_FILENAME),
      JSON.stringify([invalidEntry]),
      'utf-8',
    );

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getProjectLedgerStatus — path-segment guard (this plan AC-2)
// ---------------------------------------------------------------------------

describe('getProjectLedgerStatus — path-segment guard (this plan AC-2)', () => {
  let tempDir: string;
  let ledgerRoot: string;

  beforeEach(async () => {
    tempDir    = await mkdtemp(join(tmpdir(), 'gpl-guard-test-'));
    ledgerRoot = join(tempDir, 'ledger');
    await mkdir(ledgerRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns { exists: false } for a traversal slug (..)', async () => {
    const result = await getProjectLedgerStatus(ledgerRoot, '..');
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });

  it('returns { exists: false } for a traversal slug with path separators', async () => {
    const result = await getProjectLedgerStatus(ledgerRoot, '../etc');
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });

  it('returns { exists: false } for an empty-string slug', async () => {
    const result = await getProjectLedgerStatus(ledgerRoot, '');
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });

  it('returns { exists: false } for a traversal expectedRepo (..)', async () => {
    const result = await getProjectLedgerStatus(ledgerRoot, '2026-05-20-my-feature', '..');
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });

  it('returns { exists: false } for an uppercase expectedRepo (fails assertSafeSegment)', async () => {
    const result = await getProjectLedgerStatus(ledgerRoot, '2026-05-20-my-feature', 'MyRepo');
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });

  it('passes through to disk when slug and expectedRepo are safe', async () => {
    // Confirm a safe slug still resolves (returns false because file doesn't exist).
    const result = await getProjectLedgerStatus(ledgerRoot, '2026-05-20-my-feature', null);
    expect(result).toEqual({ exists: false, synthesisGenerated: false });
  });
});

// ---------------------------------------------------------------------------
// Deduplication: when multiple entries share the same (expectedRepo, expectedSlug)
// pair, only the most recently started entry is returned.
// ---------------------------------------------------------------------------

describe('getQueue — deduplication: keeps only the most recent entry per slug', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await teardown(env.tempDir);
  });

  it('returns only the most recent entry when two entries share the same slug', async () => {
    const slug = '2026-06-01-wizard-preselection-api';
    // Both PIDs are unreachable. Project ledger exists → both entries resolve to
    // effectiveStatus: 'started' (dead process + project exists → 'started').
    const entries = [
      {
        id:           'old-run',
        pid:          999_999_998,
        planPath:     `/fake/plans/${slug}/plan.md`,
        expectedSlug: slug,
        startedAt:    '2026-05-01T00:00:00Z',
        status:       'pending',
      },
      {
        id:           'new-run',
        pid:          999_999_999,
        planPath:     `/fake/plans/${slug}/plan.md`,
        expectedSlug: slug,
        startedAt:    '2026-06-01T00:00:00Z',
        status:       'pending',
      },
    ];
    await writeFile(join(env.logsDir, QUEUE_FILENAME), JSON.stringify(entries), 'utf-8');
    await createProjectLedger(env.ledgerRoot, slug);

    const result = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('new-run');
    expect(result[0]!.effectiveStatus).toBe('started');
  });

  it('keeps a single entry unchanged when there is no duplicate', async () => {
    const slug = '2026-06-01-no-duplicate';
    const entry = {
      id:           'only-run',
      pid:          999_999_998,
      planPath:     `/fake/plans/${slug}/plan.md`,
      expectedSlug: slug,
      startedAt:    '2026-05-01T00:00:00Z',
      status:       'pending',
    };
    await writeFile(join(env.logsDir, QUEUE_FILENAME), JSON.stringify([entry]), 'utf-8');

    const result = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('only-run');
  });

  it('keeps entries with different slugs independently', async () => {
    const slug1 = '2026-06-01-project-alpha';
    const slug2 = '2026-06-01-project-beta';
    const entries = [
      {
        id:           'alpha-run',
        pid:          999_999_998,
        planPath:     `/fake/plans/${slug1}/plan.md`,
        expectedSlug: slug1,
        startedAt:    '2026-06-01T00:00:00Z',
        status:       'pending',
      },
      {
        id:           'beta-run',
        pid:          999_999_997,
        planPath:     `/fake/plans/${slug2}/plan.md`,
        expectedSlug: slug2,
        startedAt:    '2026-06-01T00:00:00Z',
        status:       'pending',
      },
    ];
    await writeFile(join(env.logsDir, QUEUE_FILENAME), JSON.stringify(entries), 'utf-8');

    const result = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id).sort()).toEqual(['alpha-run', 'beta-run']);
  });
});
