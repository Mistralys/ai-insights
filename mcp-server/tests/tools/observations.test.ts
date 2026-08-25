import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';
import { _internal } from '../../src/tools/observations.js';

const { AddObservationSchema, addObservation } = _internal;

// Base valid input for AddObservationSchema (work_package_id varied per test)
const base = {
  project_path: '/tmp/test-project',
  pipeline_type: 'implementation',
  type: 'improvement',
  priority: 'low',
  note: 'test note',
} as const;

// ─── AddObservationSchema work_package_id regex (WP-\d{3,}) ────────────────

describe('AddObservationSchema work_package_id regex (WP-\\d{3,})', () => {
  it('accepts a standard 3-digit WP ID (WP-001)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-001' })).not.toThrow();
  });

  it('accepts a 3-digit WP ID at upper boundary (WP-999)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-999' })).not.toThrow();
  });

  it('accepts a 4-digit WP ID (WP-1000)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-1000' })).not.toThrow();
  });

  it('accepts a 5-digit WP ID (WP-12345)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-12345' })).not.toThrow();
  });

  it('rejects a 1-digit WP ID (WP-1)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-1' })).toThrow();
  });

  it('rejects a 2-digit WP ID (WP-12)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-12' })).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: '' })).toThrow();
  });

  it('rejects a lowercase prefix (wp-001)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'wp-001' })).toThrow();
  });

  it('rejects missing prefix (just digits)', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: '001' })).toThrow();
  });

  it('rejects WP- with no digits', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-' })).toThrow();
  });

  it('rejects a trailing-alpha WP ID (WP-123abc) — L-6', () => {
    expect(() => AddObservationSchema.parse({ ...base, work_package_id: 'WP-123abc' })).toThrow();
  });
});

// ─── Store-backed addObservation tests (loc field persistence) ──────────────

const PLAN_PATH = join(tmpdir(), '2026-01-01-obs-loc-test');

describe('addObservation — loc field persistence', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'obs-loc-test-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);

    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);

    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        {
          type: 'implementation',
          status: 'IN_PROGRESS',
          started_at: now(),
          summary: [],
        },
      ],
    };
    await store.writeWorkPackage('WP-001', wp);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('persists the loc field when provided', async () => {
    const result = await addObservation({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      pipeline_type: 'implementation',
      type: 'code-smell',
      priority: 'medium',
      note: 'Parser mixes concerns',
      loc: 'src/utils/parser.ts',
    });
    expect((result as any).isError).toBeFalsy();

    const wp = await store.readWorkPackage('WP-001');
    const comment = wp.pipelines[0]!.comments?.[0];
    expect(comment).toBeDefined();
    expect(comment!.loc).toBe('src/utils/parser.ts');
    expect(comment!.note).toBe('Parser mixes concerns');
  });

  it('omits loc from the comment when not provided', async () => {
    const result = await addObservation({
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      pipeline_type: 'implementation',
      type: 'improvement',
      priority: 'low',
      note: 'Clean code',
    });
    expect((result as any).isError).toBeFalsy();

    const wp = await store.readWorkPackage('WP-001');
    const comment = wp.pipelines[0]!.comments?.[0];
    expect(comment).toBeDefined();
    expect(comment!).not.toHaveProperty('loc');
  });
});
