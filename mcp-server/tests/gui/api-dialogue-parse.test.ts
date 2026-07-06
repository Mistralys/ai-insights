/**
 * Tests for the updated dialogue/chunk parse regexes and wpId filter in api.ts.
 * Covers:
 *  - `project-` prefix filenames are parsed correctly by both handlers
 *  - `WP-\d+` prefix filenames continue to parse correctly (regression guard)
 *  - `wpId="project"` is accepted as a valid filter value
 *  - Legacy invalid wpId values are still rejected
 *  - The `revision` field is populated correctly from the filename
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { handleListDialogues, handleListChunks } from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { PLAN_ARCHIVE_FILENAME, DIALOGUES_DIR, CHUNKS_DIR } from '../../src/utils/constants.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let ledgerRoot: string;

function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: PLAN_ARCHIVE_FILENAME,
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
    ...overrides,
  };
}

async function createProject(slug: string): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, ledgerRoot);
  await store.writeRootIndex(makeRoot());
  return store;
}

async function createDialoguesDir(slug: string): Promise<string> {
  const store = await createProject(slug);
  const dir = join(store.storageDir, DIALOGUES_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createChunksDir(slug: string): Promise<string> {
  const store = await createProject(slug);
  const dir = join(store.storageDir, CHUNKS_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

beforeEach(async () => {
  ledgerRoot = await mkdtemp(join(tmpdir(), 'api-dlg-parse-test-'));
});

afterEach(async () => {
  await rm(ledgerRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Parse regex — dialogue filenames
// ---------------------------------------------------------------------------

describe('DIALOGUE_PARSE_RE — project- prefix', () => {
  const slug = '2026-07-03-parse-dialogue-project';

  it('parses project-pm-r0.md correctly', async () => {
    const dir = await createDialoguesDir(slug);
    await writeFile(join(dir, 'project-pm-r0.md'), 'content');

    const result = await handleListDialogues(ledgerRoot, slug);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: 'project-pm-r0.md',
      wp_id: 'project',
      stage: 'pm',
      revision: 0,
    });
  });

  it('parses project-synthesis-r0.md correctly', async () => {
    const dir = await createDialoguesDir(slug + '-syn');
    await writeFile(join(dir, 'project-synthesis-r0.md'), 'content');

    const result = await handleListDialogues(ledgerRoot, slug + '-syn');
    expect(result[0]).toMatchObject({
      filename: 'project-synthesis-r0.md',
      wp_id: 'project',
      stage: 'synthesis',
      revision: 0,
    });
  });

  it('parses project-pm-r2.md with correct revision number', async () => {
    const dir = await createDialoguesDir(slug + '-rev');
    await writeFile(join(dir, 'project-pm-r2.md'), 'content');

    const result = await handleListDialogues(ledgerRoot, slug + '-rev');
    expect(result[0]).toMatchObject({ revision: 2 });
  });
});

describe('DIALOGUE_PARSE_RE — WP-\\d+ prefix (regression)', () => {
  const slug = '2026-07-03-parse-dialogue-wp';

  it('continues to parse WP-001-developer-r0.md correctly', async () => {
    const dir = await createDialoguesDir(slug);
    await writeFile(join(dir, 'WP-001-developer-r0.md'), 'content');

    const result = await handleListDialogues(ledgerRoot, slug);
    expect(result[0]).toMatchObject({
      filename: 'WP-001-developer-r0.md',
      wp_id: 'WP-001',
      stage: 'developer',
      revision: 0,
    });
  });

  it('parses WP-042-qa-r3.md with correct revision number', async () => {
    const dir = await createDialoguesDir(slug + '-r3');
    await writeFile(join(dir, 'WP-042-qa-r3.md'), 'content');

    const result = await handleListDialogues(ledgerRoot, slug + '-r3');
    expect(result[0]).toMatchObject({ wp_id: 'WP-042', stage: 'qa', revision: 3 });
  });
});

// ---------------------------------------------------------------------------
// Parse regex — chunk filenames
// ---------------------------------------------------------------------------

describe('CHUNK_PARSE_RE — project- prefix', () => {
  const slug = '2026-07-03-parse-chunk-project';

  it('parses project-pm-r0.jsonl correctly', async () => {
    const dir = await createChunksDir(slug);
    await writeFile(join(dir, 'project-pm-r0.jsonl'), '{}');

    const result = await handleListChunks(ledgerRoot, slug);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: 'project-pm-r0.jsonl',
      wp_id: 'project',
      stage: 'pm',
      revision: 0,
    });
  });

  it('parses project-synthesis-r0.jsonl correctly', async () => {
    const dir = await createChunksDir(slug + '-syn');
    await writeFile(join(dir, 'project-synthesis-r0.jsonl'), '{}');

    const result = await handleListChunks(ledgerRoot, slug + '-syn');
    expect(result[0]).toMatchObject({
      filename: 'project-synthesis-r0.jsonl',
      wp_id: 'project',
      stage: 'synthesis',
      revision: 0,
    });
  });

  it('parses project-pm-r1.jsonl with correct revision number', async () => {
    const dir = await createChunksDir(slug + '-rev');
    await writeFile(join(dir, 'project-pm-r1.jsonl'), '{}');

    const result = await handleListChunks(ledgerRoot, slug + '-rev');
    expect(result[0]).toMatchObject({ revision: 1 });
  });
});

describe('CHUNK_PARSE_RE — WP-\\d+ prefix (regression)', () => {
  const slug = '2026-07-03-parse-chunk-wp';

  it('continues to parse WP-001-developer-r0.jsonl correctly', async () => {
    const dir = await createChunksDir(slug);
    await writeFile(join(dir, 'WP-001-developer-r0.jsonl'), '{}');

    const result = await handleListChunks(ledgerRoot, slug);
    expect(result[0]).toMatchObject({
      filename: 'WP-001-developer-r0.jsonl',
      wp_id: 'WP-001',
      stage: 'developer',
      revision: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// wpId="project" filter acceptance
// ---------------------------------------------------------------------------

describe('wpId="project" filter', () => {
  const slug = '2026-07-03-wp-filter-project';

  it('handleListDialogues accepts wpId="project" and returns only project- entries', async () => {
    const dir = await createDialoguesDir(slug);
    await writeFile(join(dir, 'project-pm-r0.md'), 'pm content');
    await writeFile(join(dir, 'project-synthesis-r0.md'), 'synthesis content');
    await writeFile(join(dir, 'WP-001-developer-r0.md'), 'wp content');

    const result = await handleListDialogues(ledgerRoot, slug, 'project');
    expect(result.map((e) => e.filename)).toEqual([
      'project-pm-r0.md',
      'project-synthesis-r0.md',
    ]);
    expect(result.every((e) => e.wp_id === 'project')).toBe(true);
  });

  it('handleListChunks accepts wpId="project" and returns only project- entries', async () => {
    const dir = await createChunksDir(slug + '-chunks');
    await writeFile(join(dir, 'project-pm-r0.jsonl'), '{}');
    await writeFile(join(dir, 'WP-001-developer-r0.jsonl'), '{}');

    const result = await handleListChunks(ledgerRoot, slug + '-chunks', 'project');
    expect(result.map((e) => e.filename)).toEqual(['project-pm-r0.jsonl']);
  });

  it('handleListDialogues still rejects non-project, non-WP wpId values', async () => {
    const dir = await createDialoguesDir(slug + '-inv');
    await writeFile(join(dir, 'WP-001-developer-r0.md'), 'content');

    for (const badWpId of ['../etc', 'WP-', 'WP-abc', 'not-a-wp-id', ' project', 'project ']) {
      const result = await handleListDialogues(ledgerRoot, slug + '-inv', badWpId);
      expect(result).toEqual([], `expected [] for wpId: ${JSON.stringify(badWpId)}`);
    }
  });

  it('handleListChunks still rejects invalid wpId values', async () => {
    const dir = await createChunksDir(slug + '-inv-chunks');
    await writeFile(join(dir, 'project-pm-r0.jsonl'), '{}');

    for (const badWpId of ['../etc', 'WP-', 'not-a-wp-id', 'PROJECT']) {
      const result = await handleListChunks(ledgerRoot, slug + '-inv-chunks', badWpId);
      expect(result).toEqual([], `expected [] for wpId: ${JSON.stringify(badWpId)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Mixed WP + project entries (no filter)
// ---------------------------------------------------------------------------

describe('mixed WP + project entries — no filter', () => {
  const slug = '2026-07-03-mixed-dialogues';

  it('returns both WP and project entries sorted alphabetically', async () => {
    const dir = await createDialoguesDir(slug);
    await writeFile(join(dir, 'WP-001-developer-r0.md'), 'wp content');
    await writeFile(join(dir, 'project-pm-r0.md'), 'pm content');
    await writeFile(join(dir, 'project-synthesis-r0.md'), 'synthesis content');

    const result = await handleListDialogues(ledgerRoot, slug);
    // Sorted alphabetically: WP-001-... < project-pm-... < project-synthesis-...
    expect(result.map((e) => e.filename)).toEqual([
      'WP-001-developer-r0.md',
      'project-pm-r0.md',
      'project-synthesis-r0.md',
    ]);
    expect(result[0]!.wp_id).toBe('WP-001');
    expect(result[1]!.wp_id).toBe('project');
    expect(result[2]!.wp_id).toBe('project');
  });
});
