/**
 * Tests for getProjectLedgerStatus() namespaced-path support — WP-007
 *
 * Verifies:
 *   WP-007 AC-1: getProjectLedgerStatus() uses namespaced path when expectedRepo is non-null
 *                i.e. <ledgerRoot>/<expectedRepo>/<slug>/project-ledger.json
 *   WP-007 AC-2: getProjectLedgerStatus() falls back to flat path when expectedRepo is null
 *                i.e. <ledgerRoot>/<slug>/project-ledger.json (backward compatibility)
 *   WP-007 AC-5: getQueue() passes entry.expectedRepo to getProjectLedgerStatus(),
 *                so an entry with a non-null expectedRepo resolves via the namespaced
 *                ledger directory.
 *
 * Uses real temporary directories for all filesystem operations.
 * No mocks or spies are used — this is pure I/O verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getProjectLedgerStatus, getQueue } from '../../src/gui/queue/get-queue.js';
import { QUEUE_FILENAME } from '../../src/gui/queue/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestEnv {
  tempDir:    string;
  logsDir:    string;
  ledgerRoot: string;
}

async function setup(): Promise<TestEnv> {
  const tempDir    = await mkdtemp(join(tmpdir(), 'ledger-status-test-'));
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
 * Creates a project-ledger.json at the given directory path.
 */
async function writeLedger(dir: string, extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'project-ledger.json'),
    JSON.stringify({ synthesis_generated: false, ...extra }),
    'utf-8',
  );
}

/**
 * Writes a minimal .run-queue.json with a single entry.
 * Uses PID 999_999_999 — almost certainly not alive — to avoid signal noise.
 */
async function writeQueueEntry(
  logsDir:      string,
  slug:         string,
  expectedRepo: string | null,
): Promise<void> {
  const entry = {
    id:           `test-${slug}`,
    pid:          999_999_999,
    planPath:     `/fake/plans/${slug}`,
    expectedSlug: slug,
    expectedRepo,
    startedAt:    '2026-05-31T00:00:00Z',
    status:       'pending',
  };
  await writeFile(join(logsDir, QUEUE_FILENAME), JSON.stringify([entry]), 'utf-8');
}

// ---------------------------------------------------------------------------
// AC-1: namespaced path when expectedRepo is non-null
// ---------------------------------------------------------------------------

describe('getProjectLedgerStatus — AC-1: namespaced path when expectedRepo is non-null', () => {
  let env: TestEnv;

  beforeEach(async () => { env = await setup(); });
  afterEach(async ()  => { await teardown(env.tempDir); });

  it('returns exists:true when ledger is at <ledgerRoot>/<repo>/<slug>/project-ledger.json', async () => {
    const repo = 'my-repo';
    const slug = '2026-05-31-my-feature';
    // Place ledger at the namespaced path.
    await writeLedger(join(env.ledgerRoot, repo, slug));

    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, repo);

    expect(result.exists).toBe(true);
    expect(result.synthesisGenerated).toBe(false);
  });

  it('returns exists:false when ledger is at the flat path but expectedRepo is non-null', async () => {
    const repo = 'my-repo';
    const slug = '2026-05-31-my-feature';
    // Place ledger at the FLAT path (wrong location for a namespaced lookup).
    await writeLedger(join(env.ledgerRoot, slug));

    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, repo);

    // Namespaced lookup must not fall through to the flat path — the file must
    // be at <ledgerRoot>/<repo>/<slug>/project-ledger.json to be found.
    expect(result.exists).toBe(false);
    expect(result.synthesisGenerated).toBe(false);
  });

  it('returns synthesisGenerated:true when the namespaced ledger has synthesis_generated:true', async () => {
    const repo = 'workspace-a';
    const slug = '2026-05-31-synthesis-done';
    await writeLedger(join(env.ledgerRoot, repo, slug), { synthesis_generated: true });

    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, repo);

    expect(result.exists).toBe(true);
    expect(result.synthesisGenerated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2: flat path when expectedRepo is null (backward compatibility)
// ---------------------------------------------------------------------------

describe('getProjectLedgerStatus — AC-2: flat path when expectedRepo is null', () => {
  let env: TestEnv;

  beforeEach(async () => { env = await setup(); });
  afterEach(async ()  => { await teardown(env.tempDir); });

  it('returns exists:true when ledger is at <ledgerRoot>/<slug>/project-ledger.json', async () => {
    const slug = '2026-05-31-legacy-project';
    await writeLedger(join(env.ledgerRoot, slug));

    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, null);

    expect(result.exists).toBe(true);
    expect(result.synthesisGenerated).toBe(false);
  });

  it('returns exists:false when no ledger file exists at the flat path', async () => {
    const slug = '2026-05-31-missing-project';
    // Intentionally do NOT create any ledger file.

    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, null);

    expect(result.exists).toBe(false);
    expect(result.synthesisGenerated).toBe(false);
  });

  it('does not find a ledger at the namespaced path when expectedRepo is null', async () => {
    const repo = 'some-repo';
    const slug = '2026-05-31-namespaced-only';
    // Place ledger at the namespaced path only.
    await writeLedger(join(env.ledgerRoot, repo, slug));

    // Null expectedRepo should NOT fall through to the namespaced location.
    const result = await getProjectLedgerStatus(env.ledgerRoot, slug, null);

    expect(result.exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-5: getQueue() passes entry.expectedRepo to getProjectLedgerStatus()
// ---------------------------------------------------------------------------

describe('getQueue — AC-5: passes entry.expectedRepo to getProjectLedgerStatus()', () => {
  let env: TestEnv;

  beforeEach(async () => { env = await setup(); });
  afterEach(async ()  => { await teardown(env.tempDir); });

  it('resolves projectExists:true for an entry with non-null expectedRepo via namespaced path', async () => {
    const repo = 'my-workspace';
    const slug = '2026-05-31-namespaced-entry';

    // Write ledger at the NAMESPACED path only.
    await writeLedger(join(env.ledgerRoot, repo, slug));
    await writeQueueEntry(env.logsDir, slug, repo);

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.projectExists).toBe(true);
    expect(entries[0]!.expectedRepo).toBe(repo);
    expect(entries[0]!.expectedSlug).toBe(slug);
  });

  it('resolves projectExists:false for an entry with non-null expectedRepo when ledger is only at flat path', async () => {
    const repo = 'my-workspace';
    const slug = '2026-05-31-flat-only';

    // Write ledger at the FLAT path only — wrong location for a namespaced entry.
    await writeLedger(join(env.ledgerRoot, slug));
    await writeQueueEntry(env.logsDir, slug, repo);

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.projectExists).toBe(false);
    expect(entries[0]!.expectedRepo).toBe(repo);
  });

  it('resolves projectExists:true for a legacy entry with null expectedRepo via flat path', async () => {
    const slug = '2026-05-31-legacy-null';

    // Write ledger at the flat path (legacy behavior).
    await writeLedger(join(env.ledgerRoot, slug));
    await writeQueueEntry(env.logsDir, slug, null);

    const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.projectExists).toBe(true);
    expect(entries[0]!.expectedRepo).toBeNull();
    expect(entries[0]!.expectedSlug).toBe(slug);
  });
});
