/**
 * Tests for the ledger_list_projects tool handler — specifically the
 * include_archived and ARCHIVED exclusion behavior added in WP-004.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { _internal } from '../../src/tools/project-lifecycle.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME } from '../../src/utils/constants.js';

const { listProjects } = _internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedProject(
  tempLedgerRoot: string,
  slug: string,
  status: string
): Promise<void> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, tempLedgerRoot);
  await store.writeProjectMeta(PLAN_ARCHIVE_FILENAME, status);
}

function parseResult(result: Awaited<ReturnType<typeof listProjects>>): Array<{ slug: string; status: string }> {
  const text = result.content[0]!.text;
  return JSON.parse(text) as Array<{ slug: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('listProjects — ARCHIVED exclusion', () => {
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'list-projects-test-'));
  });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('excludes ARCHIVED projects by default', async () => {
    await seedProject(tempLedgerRoot, '2026-01-01-active', 'IN_PROGRESS');
    await seedProject(tempLedgerRoot, '2026-01-02-archived', 'ARCHIVED');

    const result = await listProjects({}, tempLedgerRoot);
    const items = parseResult(result);

    expect(items.map((p) => p.status)).not.toContain('ARCHIVED');
    expect(items.some((p) => p.slug === '2026-01-01-active')).toBe(true);
    expect(items.some((p) => p.slug === '2026-01-02-archived')).toBe(false);
  });

  it('includes ARCHIVED projects when include_archived: true', async () => {
    await seedProject(tempLedgerRoot, '2026-01-01-active', 'COMPLETE');
    await seedProject(tempLedgerRoot, '2026-01-02-archived', 'ARCHIVED');

    const result = await listProjects({ include_archived: true }, tempLedgerRoot);
    const items = parseResult(result);

    expect(items.some((p) => p.slug === '2026-01-01-active')).toBe(true);
    expect(items.some((p) => p.slug === '2026-01-02-archived')).toBe(true);
  });

  it('returns only ARCHIVED projects when status: "ARCHIVED" is set', async () => {
    await seedProject(tempLedgerRoot, '2026-01-01-active', 'COMPLETE');
    await seedProject(tempLedgerRoot, '2026-01-02-archived', 'ARCHIVED');

    const result = await listProjects({ status: 'ARCHIVED' as any }, tempLedgerRoot);
    const items = parseResult(result);

    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('ARCHIVED');
    expect(items[0]!.slug).toBe('2026-01-02-archived');
  });

  it('does not return ARCHIVED projects when filtering by a non-ARCHIVED status', async () => {
    await seedProject(tempLedgerRoot, '2026-01-01-complete', 'COMPLETE');
    await seedProject(tempLedgerRoot, '2026-01-02-archived', 'ARCHIVED');

    const result = await listProjects({ status: 'COMPLETE' }, tempLedgerRoot);
    const items = parseResult(result);

    expect(items.every((p) => p.status === 'COMPLETE')).toBe(true);
  });

  it('returns empty array when all projects are ARCHIVED and include_archived is not set', async () => {
    await seedProject(tempLedgerRoot, '2026-01-01-arch1', 'ARCHIVED');
    await seedProject(tempLedgerRoot, '2026-01-02-arch2', 'ARCHIVED');

    const result = await listProjects({}, tempLedgerRoot);
    const items = parseResult(result);

    expect(items).toHaveLength(0);
  });

  it('returns empty array when no projects exist', async () => {
    const result = await listProjects({}, tempLedgerRoot);
    const items = parseResult(result);
    expect(items).toHaveLength(0);
  });
});
