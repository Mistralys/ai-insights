/**
 * scripts/tests/backfill-duration.test.js
 *
 * Unit tests for scripts/backfill-duration.js
 *
 * Acceptance Criteria verified:
 *   AC-12: scripts/backfill-duration.js populates active_ms and pipeline_runs for
 *          pre-existing projects, including projects that already have duration_ms;
 *          is idempotent across repeat runs; and writes nothing under --dry-run.
 *
 * The script has no CLI guard around its top-level `main()` call, so it is exercised
 * as a subprocess via spawnSync (the same pattern used by
 * scripts/tests/generate-agents-overview.test.js) rather than imported directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'backfill-duration.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempStore() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-duration-test-'));
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Creates a flat-layout project directory (storeRoot/slug/) with a root index,
 * a .meta.json, and one WP-001.json detail file carrying the given pipelines.
 *
 * @param {string} storeRoot
 * @param {string} slug
 * @param {object} opts
 * @param {string} [opts.dateCreated]
 * @param {string|null} [opts.synthesisGeneratedAt]
 * @param {object} [opts.metaOverrides]
 * @param {Array<object>} [opts.pipelines]
 */
function makeProject(storeRoot, slug, opts = {}) {
  const {
    dateCreated = '2026-01-01T10:00:00.000Z',
    synthesisGeneratedAt = '2026-01-01T10:10:00.000Z',
    metaOverrides = {},
    pipelines = [{ type: 'implementation', status: 'PASS', duration_ms: 1000, summary: [] }],
  } = opts;

  const projectDir = path.join(storeRoot, slug);
  fs.mkdirSync(projectDir, { recursive: true });

  const rootIndex = {
    plan_file: 'plan.md',
    date_created: dateCreated,
    last_updated: synthesisGeneratedAt ?? dateCreated,
    status: synthesisGeneratedAt ? 'COMPLETE' : 'IN_PROGRESS',
    synthesis_generated_at: synthesisGeneratedAt,
    total_work_packages: 1,
    pending_work_packages: 0,
    work_packages: [
      {
        work_package_id: 'WP-001',
        status: 'COMPLETE',
        assigned_to: 'Developer',
        dependencies: [],
        file: 'ledger/WP-001.json',
      },
    ],
    project_comments: [],
  };
  fs.writeFileSync(path.join(projectDir, 'project-ledger.json'), JSON.stringify(rootIndex, null, 2));

  const meta = {
    slug,
    plan_path: path.join(projectDir, 'plan.md'),
    status: rootIndex.status,
    date_created: dateCreated,
    last_updated: rootIndex.last_updated,
    ...metaOverrides,
  };
  fs.writeFileSync(path.join(projectDir, '.meta.json'), JSON.stringify(meta, null, 2));

  fs.writeFileSync(
    path.join(projectDir, 'WP-001.json'),
    JSON.stringify(
      {
        work_package_id: 'WP-001',
        status: 'COMPLETE',
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: [],
        revision: 0,
        pipelines,
      },
      null,
      2
    )
  );

  return projectDir;
}

function readMeta(projectDir) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, '.meta.json'), 'utf8'));
}

/**
 * Runs the backfill script as a subprocess against `storeRoot`, isolating it from any
 * real ~/.ai-insights/stores.json by pointing HOME at an empty temp directory so
 * LEDGER_ROOT is the only store-discovery path taken.
 *
 * @param {string} storeRoot
 * @param {string[]} [args]
 */
function runBackfill(storeRoot, args = []) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-duration-home-'));
  try {
    const result = spawnSync('node', [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, HOME: fakeHome, LEDGER_ROOT: storeRoot },
      encoding: 'utf8',
    });
    return result;
  } finally {
    rmDir(fakeHome);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('backfill-duration', () => {
  let storeRoot;

  beforeEach(() => {
    storeRoot = makeTempStore();
  });

  afterEach(() => {
    rmDir(storeRoot);
  });

  it('populates active_ms and pipeline_runs for a synthesised project with no cached fields (AC-12)', () => {
    const projectDir = makeProject(storeRoot, '2026-01-01-fresh', {
      pipelines: [
        { type: 'implementation', status: 'PASS', duration_ms: 1000, summary: [] },
        { type: 'qa', status: 'PASS', duration_ms: 2000, summary: [] },
      ],
    });

    const result = runBackfill(storeRoot);
    expect(result.status).toBe(0);

    const meta = readMeta(projectDir);
    expect(meta.active_ms).toBe(3000);
    expect(meta.pipeline_runs).toBe(2);
    expect(typeof meta.duration_ms).toBe('number');
  });

  it('still populates active_ms/pipeline_runs for a project that already has duration_ms (AC-12)', () => {
    const projectDir = makeProject(storeRoot, '2026-01-02-has-duration', {
      metaOverrides: { duration_ms: 600000 },
      pipelines: [{ type: 'implementation', status: 'PASS', duration_ms: 4000, summary: [] }],
    });

    const result = runBackfill(storeRoot);
    expect(result.status).toBe(0);

    const meta = readMeta(projectDir);
    expect(meta.duration_ms).toBe(600000); // untouched — already cached
    expect(meta.active_ms).toBe(4000);
    expect(meta.pipeline_runs).toBe(1);
  });

  it('writes active_ms: null when no pipeline in the project carries a duration', () => {
    const projectDir = makeProject(storeRoot, '2026-01-03-no-active-time', {
      pipelines: [{ type: 'implementation', status: 'CANCELLED', summary: [] }],
    });

    const result = runBackfill(storeRoot);
    expect(result.status).toBe(0);

    const meta = readMeta(projectDir);
    expect(meta.active_ms).toBeNull();
    expect(meta.pipeline_runs).toBe(0);
  });

  it('is a no-op on a second run once both fields are cached', () => {
    const projectDir = makeProject(storeRoot, '2026-01-04-idempotent');

    runBackfill(storeRoot);
    const firstMeta = readMeta(projectDir);

    const second = runBackfill(storeRoot);
    expect(second.status).toBe(0);
    const secondMeta = readMeta(projectDir);

    expect(secondMeta).toEqual(firstMeta);
  });

  it('tolerates an unreadable WP detail file without failing the run', () => {
    const projectDir = makeProject(storeRoot, '2026-01-05-unreadable-wp');
    fs.writeFileSync(path.join(projectDir, 'WP-001.json'), 'not valid json');

    const result = runBackfill(storeRoot, ['--verbose']);
    expect(result.status).toBe(0);

    const meta = readMeta(projectDir);
    expect(meta.active_ms).toBeNull();
    expect(meta.pipeline_runs).toBe(0);
  });

  it('writes nothing under --dry-run', () => {
    const projectDir = makeProject(storeRoot, '2026-01-06-dry-run');
    const before = readMeta(projectDir);

    const result = runBackfill(storeRoot, ['--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dry-run');

    const after = readMeta(projectDir);
    expect(after).toEqual(before);
  });

  it('skips a project that has not synthesised', () => {
    const projectDir = makeProject(storeRoot, '2026-01-07-no-synthesis', {
      synthesisGeneratedAt: null,
    });

    const result = runBackfill(storeRoot);
    expect(result.status).toBe(0);

    const meta = readMeta(projectDir);
    expect(meta.active_ms).toBeUndefined();
    expect(meta.pipeline_runs).toBeUndefined();
  });
});
