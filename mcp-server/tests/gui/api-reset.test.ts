/**
 * Tests for handleResetProject in gui/api.ts
 *
 * Uses real temp directories via LedgerStore to build fixtures on disk.
 * Covers dry-run analysis, apply with decisions, validation errors, and
 * edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleResetProject, handleGetProjectHealth, ApiError } from '../../gui/api.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
  return {
    plan_file: 'plan.md',
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

function makeWp(
  id: string,
  status: string,
  assignedTo: string | null,
  passedStages: string[]
): WorkPackageDetail {
  const pipelines = passedStages.map((type) => ({
    type,
    status: 'PASS' as const,
    started_at: '2026-03-01T00:00:00Z',
    completed_at: '2026-03-01T01:00:00Z',
    summary: [`Completed ${type}`],
  }));

  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as WorkPackageDetail['status'],
    assigned_to: assignedTo,
    dependencies: [],
    acceptance_criteria: [
      { criterion: 'Test criterion A', met: true },
      { criterion: 'Test criterion B', met: true },
    ],
    revision: 1,
    pipelines,
  };
}

async function setupProject(
  ledgerRoot: string,
  slug: string,
  wps: WorkPackageDetail[],
  rootOverrides: Partial<RootIndex> = {}
): Promise<LedgerStore> {
  const planPath = join(tmpdir(), slug);
  const store = new LedgerStore(planPath, ledgerRoot);

  const wpSummaries = wps.map((wp) => ({
    work_package_id: wp.work_package_id,
    status: wp.status,
    assigned_to: wp.assigned_to,
    dependencies: wp.dependencies,
    file: `${wp.work_package_id}.json`,
  }));

  await store.writeRootIndex(makeRoot({
    total_work_packages: wps.length,
    pending_work_packages: wps.filter((wp) => !['COMPLETE', 'CANCELLED'].includes(wp.status)).length,
    work_packages: wpSummaries,
    ...rootOverrides,
  }));

  for (const wp of wps) {
    await store.writeWorkPackage(wp.work_package_id, wp);
  }

  return store;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handleResetProject', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-reset-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ─── Dry-run mode ────────────────────────────────────────────────────────

  describe('dry_run: true', () => {
    it('returns diagnosis without performing any writes', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-project', [wp], { status: 'COMPLETE' });

      const result = await handleResetProject(ledgerRoot, '2026-01-01-test-project', { dry_run: true });

      // Should return diagnosis
      expect(result).toHaveProperty('work_packages');
      expect(result).toHaveProperty('work_packages_needing_reset', 1);
      expect(result).not.toHaveProperty('applied');

      // Verify no writes occurred: root index should still say COMPLETE
      const rootAfter = await store.readRootIndex();
      expect(rootAfter.status).toBe('COMPLETE');
    });

    it('correctly diagnoses a project with mixed WP states', async () => {
      const wps = [
        makeWp('WP-001', 'COMPLETE', 'Documentation', ['implementation', 'qa', 'code-review', 'documentation']),
        makeWp('WP-002', 'COMPLETE', 'Developer', ['implementation']),
      ];
      await setupProject(ledgerRoot, '2026-01-01-mixed-project', wps, { status: 'COMPLETE' });

      const result = await handleResetProject(ledgerRoot, '2026-01-01-mixed-project', { dry_run: true }) as any;

      expect(result.work_packages_needing_reset).toBe(1);
      expect(result.work_packages_healthy).toBe(1);
      expect(result.work_packages[0].suggested_action).toBe('skip');
      expect(result.work_packages[1].suggested_action).toBe('reset');
    });
  });

  // ─── Apply mode ──────────────────────────────────────────────────────────

  describe('dry_run: false', () => {
    it('applies reset decisions and returns result', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-project', [wp], { status: 'COMPLETE' });

      const result = await handleResetProject(ledgerRoot, '2026-01-01-test-project', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'reset', reset_criteria: true },
        },
      }) as any;

      expect(result.applied).toBe(true);
      expect(result.work_packages_reset).toEqual(['WP-001']);
      expect(result.work_packages_skipped).toEqual([]);

      // Verify WP was updated
      const wpAfter = await store.readWorkPackage('WP-001');
      expect(wpAfter.status).toBe('IN_PROGRESS');
      expect(wpAfter.assigned_to).toBe('QA');
      expect(wpAfter.acceptance_criteria.every((ac) => ac.met === false)).toBe(true);

      // Verify root index was updated
      const rootAfter = await store.readRootIndex();
      expect(rootAfter.status).toBe('IN_PROGRESS');
      expect(rootAfter.synthesis_generated).toBe(false);
    });

    it('preserves criteria when reset_criteria: false', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-criteria', [wp], { status: 'COMPLETE' });

      await handleResetProject(ledgerRoot, '2026-01-01-test-criteria', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'reset', reset_criteria: false },
        },
      });

      const wpAfter = await store.readWorkPackage('WP-001');
      expect(wpAfter.acceptance_criteria[0]!.met).toBe(true);
      expect(wpAfter.acceptance_criteria[1]!.met).toBe(true);
    });

    it('handles cancel decision', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-cancel', [wp], { status: 'COMPLETE' });

      const result = await handleResetProject(ledgerRoot, '2026-01-01-test-cancel', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'cancel' },
        },
      }) as any;

      expect(result.work_packages_cancelled).toEqual(['WP-001']);

      const wpAfter = await store.readWorkPackage('WP-001');
      expect(wpAfter.status).toBe('CANCELLED');
    });

    it('skips WPs absent from decisions map', async () => {
      const wps = [
        makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']),
        makeWp('WP-002', 'COMPLETE', 'Developer', ['implementation']),
      ];
      const store = await setupProject(ledgerRoot, '2026-01-01-test-skip', wps, { status: 'COMPLETE' });

      const result = await handleResetProject(ledgerRoot, '2026-01-01-test-skip', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'reset' },
          // WP-002 absent → default to skip
        },
      }) as any;

      expect(result.work_packages_reset).toEqual(['WP-001']);
      expect(result.work_packages_skipped).toContain('WP-002');

      // WP-002 should still be COMPLETE
      const wp2After = await store.readWorkPackage('WP-002');
      expect(wp2After.status).toBe('COMPLETE');
    });

    it('adds project comment documenting the reset', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-comment', [wp], { status: 'COMPLETE' });

      await handleResetProject(ledgerRoot, '2026-01-01-test-comment', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'reset' },
        },
      });

      const rootAfter = await store.readRootIndex();
      const lastComment = rootAfter.project_comments[rootAfter.project_comments.length - 1];
      expect(lastComment).toBeDefined();
      expect(lastComment!.type).toBe('admin_action');
      expect(lastComment!.agent).toBe('GUI');
      expect(lastComment!.note).toContain('WP-001');
    });

    it('preserves existing pipelines after reset', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(ledgerRoot, '2026-01-01-test-pipelines', [wp], { status: 'COMPLETE' });

      await handleResetProject(ledgerRoot, '2026-01-01-test-pipelines', {
        dry_run: false,
        decisions: { 'WP-001': { action: 'reset' } },
      });

      const wpAfter = await store.readWorkPackage('WP-001');
      expect(wpAfter.pipelines).toHaveLength(1);
      expect(wpAfter.pipelines[0]!.type).toBe('implementation');
      expect(wpAfter.pipelines[0]!.status).toBe('PASS');
    });

    it('persists reset_at to disk on reset action; does not set it on cancel', async () => {
      const wpReset = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      const wpCancel = makeWp('WP-002', 'COMPLETE', 'Developer', ['implementation']);
      const store = await setupProject(
        ledgerRoot,
        '2026-01-01-test-reset-at',
        [wpReset, wpCancel],
        { status: 'COMPLETE' }
      );

      await handleResetProject(ledgerRoot, '2026-01-01-test-reset-at', {
        dry_run: false,
        decisions: {
          'WP-001': { action: 'reset' },
          'WP-002': { action: 'cancel' },
        },
      });

      const wp1After = await store.readWorkPackage('WP-001');
      expect(wp1After.reset_at).toBeDefined();
      expect(typeof wp1After.reset_at).toBe('string');
      expect(wp1After.reset_at!.length).toBeGreaterThan(0);
      // reset_at must equal status_changed_at (both set to the same mutation timestamp)
      expect(wp1After.reset_at).toBe(wp1After.status_changed_at);

      const wp2After = await store.readWorkPackage('WP-002');
      expect(wp2After.reset_at).toBeUndefined();
    });
  });

  // ─── Validation errors ───────────────────────────────────────────────────

  describe('validation errors', () => {
    it('rejects apply without decisions', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      await setupProject(ledgerRoot, '2026-01-01-test-no-decisions', [wp], { status: 'COMPLETE' });

      await expect(
        handleResetProject(ledgerRoot, '2026-01-01-test-no-decisions', {
          dry_run: false,
          // no decisions
        })
      ).rejects.toThrow();
    });

    it('rejects malformed body', async () => {
      await expect(
        handleResetProject(ledgerRoot, '2026-01-01-test-malformed', 'not an object')
      ).rejects.toThrow();
    });

    it('rejects invalid decision action', async () => {
      const wp = makeWp('WP-001', 'COMPLETE', 'Developer', ['implementation']);
      await setupProject(ledgerRoot, '2026-01-01-test-invalid-action', [wp], { status: 'COMPLETE' });

      await expect(
        handleResetProject(ledgerRoot, '2026-01-01-test-invalid-action', {
          dry_run: false,
          decisions: { 'WP-001': { action: 'invalid' } },
        })
      ).rejects.toThrow();
    });

    it('returns 404 for non-existent project', async () => {
      try {
        await handleResetProject(ledgerRoot, '2026-01-01-nonexistent', { dry_run: true });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('NOT_FOUND');
      }
    });

    it('returns 404 for invalid slug with path traversal', async () => {
      try {
        await handleResetProject(ledgerRoot, '../etc', { dry_run: true });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('NOT_FOUND');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// handleGetProjectHealth
// ---------------------------------------------------------------------------

describe('handleGetProjectHealth', () => {
  let ledgerRoot: string;

  beforeEach(async () => {
    ledgerRoot = await mkdtemp(join(tmpdir(), 'api-health-test-'));
  });

  afterEach(async () => {
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('returns zero needing-reset count for a fully healthy project', async () => {
    const allStages = ['implementation', 'qa', 'code-review', 'documentation'];
    const slug = '2026-01-01-health-test';
    await setupProject(ledgerRoot, slug, [
      makeWp('WP-001', 'COMPLETE', null, allStages),
      makeWp('WP-002', 'COMPLETE', null, allStages),
    ]);

    const result = await handleGetProjectHealth(ledgerRoot, slug);

    expect(result.work_packages_needing_reset).toBe(0);
    expect(result.total_work_packages).toBe(2);
  });

  it('returns correct needing-reset count for a broken project', async () => {
    const allStages = ['implementation', 'qa', 'code-review', 'documentation'];
    const slug = '2026-01-01-health-broken';
    await setupProject(ledgerRoot, slug, [
      makeWp('WP-001', 'IN_PROGRESS', null, []),          // no stages — needs reset
      makeWp('WP-002', 'COMPLETE',    null, allStages),   // healthy
    ]);

    const result = await handleGetProjectHealth(ledgerRoot, slug);

    expect(result.work_packages_needing_reset).toBe(1);
    expect(result.work_packages_healthy).toBe(1);
    expect(result.total_work_packages).toBe(2);
  });

  it('returns 404 for a non-existent slug', async () => {
    try {
      await handleGetProjectHealth(ledgerRoot, '2026-01-01-nonexistent');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('NOT_FOUND');
    }
  });

  it('returns 400 for an invalid slug with path traversal characters', async () => {
    try {
      await handleGetProjectHealth(ledgerRoot, '../etc/passwd');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      // assertSafeSlug throws NOT_FOUND (matches existing handler behaviour)
      expect((err as ApiError).code).toBe('NOT_FOUND');
    }
  });
});
