import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import {
  createTempStore,
  cleanupTempStore,
  type TempStoreHandle,
} from '../helpers/create-temp-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import { computeHealedStatus, InitializeProjectSchema } from '../../src/tools/project-lifecycle.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-lifecycle-heal-test');

/**
 * Tests for the two new self-healing rules added to getProjectStatus:
 *   1. READY → IN_PROGRESS when any WP is IN_PROGRESS
 *   2. BLOCKED → IN_PROGRESS/READY when no WPs are actually BLOCKED
 *
 * These tests validate the healing logic by driving store operations directly
 * and checking the corrected status — the same pattern used elsewhere in the
 * test suite (see claim-guard.test.ts).
 *
 * The healing function below is an inline replica of the two new branches
 * added to project-lifecycle.ts so tests remain independent of internal exports.
 */

type ProjectStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type WpStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';

/** Inline replica of the self-healing logic from project-lifecycle.ts */
function applyStatusHealing(
  currentStatus: ProjectStatus,
  wpStatuses: WpStatus[],
  pendingWps: number,
  totalWps: number,
  synthesisGenerated?: boolean,
): ProjectStatus {
  if (currentStatus === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0) {
    return synthesisGenerated ? 'COMPLETE' : 'IN_PROGRESS';
  }
  if (currentStatus === 'COMPLETE' && pendingWps > 0) {
    return 'IN_PROGRESS';
  }
  if (currentStatus === 'READY') {
    const hasInProgressWp = wpStatuses.some((s) => s === 'IN_PROGRESS');
    if (hasInProgressWp) return 'IN_PROGRESS';
  }
  if (currentStatus === 'BLOCKED') {
    const hasBlockedWp = wpStatuses.some((s) => s === 'BLOCKED');
    if (!hasBlockedWp) {
      const hasInProgressWp = wpStatuses.some((s) => s === 'IN_PROGRESS');
      const hasReadyWp = wpStatuses.some((s) => s === 'READY');
      return hasInProgressWp ? 'IN_PROGRESS' : hasReadyWp ? 'READY' : currentStatus;
    }
  }
  return currentStatus;
}

describe('Project status self-healing: READY → IN_PROGRESS', () => {
  it('heals READY to IN_PROGRESS when a WP is IN_PROGRESS', () => {
    const healed = applyStatusHealing('READY', ['IN_PROGRESS'], 1, 1);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals READY to IN_PROGRESS when mixed WP statuses include IN_PROGRESS', () => {
    const healed = applyStatusHealing('READY', ['READY', 'IN_PROGRESS', 'BLOCKED'], 3, 3);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('does NOT heal READY when all WPs are READY', () => {
    const healed = applyStatusHealing('READY', ['READY', 'READY'], 2, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal READY when all WPs are BLOCKED', () => {
    const healed = applyStatusHealing('READY', ['BLOCKED', 'BLOCKED'], 2, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal READY when there are no WPs', () => {
    const healed = applyStatusHealing('READY', [], 0, 0);
    expect(healed).toBe('READY');
  });
});

describe('Project status self-healing: BLOCKED → IN_PROGRESS/READY', () => {
  it('heals BLOCKED to IN_PROGRESS when no WPs are BLOCKED and some are IN_PROGRESS', () => {
    const healed = applyStatusHealing('BLOCKED', ['IN_PROGRESS', 'READY'], 2, 2);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals BLOCKED to READY when no WPs are BLOCKED and some are READY but none IN_PROGRESS', () => {
    const healed = applyStatusHealing('BLOCKED', ['READY', 'COMPLETE'], 1, 2);
    expect(healed).toBe('READY');
  });

  it('does NOT heal BLOCKED when at least one WP is still BLOCKED', () => {
    const healed = applyStatusHealing('BLOCKED', ['BLOCKED', 'READY'], 2, 2);
    expect(healed).toBe('BLOCKED');
  });

  it('does NOT heal BLOCKED when all WPs are COMPLETE and no READY/IN_PROGRESS exists', () => {
    // All COMPLETE means no pending; healing falls through to existing IN_PROGRESS/COMPLETE rules
    // With no BLOCKED WPs and no IN_PROGRESS/READY, status stays unchanged
    const healed = applyStatusHealing('BLOCKED', ['COMPLETE', 'COMPLETE'], 0, 2);
    expect(healed).toBe('BLOCKED');
  });

  it('heals BLOCKED to IN_PROGRESS over READY when both exist', () => {
    const healed = applyStatusHealing('BLOCKED', ['READY', 'IN_PROGRESS', 'COMPLETE'], 2, 3);
    expect(healed).toBe('IN_PROGRESS');
  });
});

describe('Project status self-healing: existing rules still work', () => {
  it('heals IN_PROGRESS to COMPLETE when all WPs done and synthesis generated', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2, true);
    expect(healed).toBe('COMPLETE');
  });

  it('stays IN_PROGRESS when all WPs done but synthesis NOT generated', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2, false);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('stays IN_PROGRESS when all WPs done and synthesis_generated is undefined', () => {
    const healed = applyStatusHealing('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], 0, 2);
    expect(healed).toBe('IN_PROGRESS');
  });

  it('heals COMPLETE to IN_PROGRESS when pending WPs exist', () => {
    const healed = applyStatusHealing('COMPLETE', ['IN_PROGRESS', 'COMPLETE'], 1, 2);
    expect(healed).toBe('IN_PROGRESS');
  });
});

describe('Project status self-healing: store integration', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('READY project with IN_PROGRESS WP stores correctly and heals as expected', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'READY',
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
    await handle.store.writeRootIndex(root);

    const readBack = await handle.store.readRootIndex();
    const wpStatuses = readBack.work_packages.map((wp) => wp.status as WpStatus);
    const healed = applyStatusHealing(
      readBack.status as ProjectStatus,
      wpStatuses,
      readBack.pending_work_packages,
      readBack.total_work_packages,
    );
    expect(healed).toBe('IN_PROGRESS');
  });

  it('BLOCKED project with only READY WPs stores correctly and heals to READY', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'BLOCKED',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'READY',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);

    const readBack = await handle.store.readRootIndex();
    const wpStatuses = readBack.work_packages.map((wp) => wp.status as WpStatus);
    const healed = applyStatusHealing(
      readBack.status as ProjectStatus,
      wpStatuses,
      readBack.pending_work_packages,
      readBack.total_work_packages,
    );
    expect(healed).toBe('READY');
  });
});

describe('computeHealedStatus (exported pure function)', () => {
  function makeRootIndex(overrides: Partial<RootIndex> = {}): RootIndex {
    return {
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
      ...overrides,
    };
  }

  it('returns needsWrite: false when counters and status are correct', () => {
    const root = makeRootIndex();
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(false);
    expect(result.totalWps).toBe(1);
    expect(result.pendingWps).toBe(1);
    expect(result.healedStatus).toBe('IN_PROGRESS');
  });

  it('returns needsWrite: true when total_work_packages is wrong', () => {
    const root = makeRootIndex({ total_work_packages: 99 });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.totalWps).toBe(1);
  });

  it('returns needsWrite: true when pending_work_packages is wrong', () => {
    const root = makeRootIndex({ pending_work_packages: 0 });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.pendingWps).toBe(1);
  });

  it('returns needsWrite: true when status needs healing', () => {
    const root = makeRootIndex({
      status: 'READY',
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(true);
    expect(result.healedStatus).toBe('IN_PROGRESS');
  });

  it('heals IN_PROGRESS to COMPLETE when all WPs done and synthesis_generated', () => {
    const root = makeRootIndex({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('heals READY project to COMPLETE when all WPs terminal and synthesis_generated', () => {
    const root = makeRootIndex({
      status: 'READY',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('heals BLOCKED project to COMPLETE when no WPs are blocked, all terminal, synthesis generated', () => {
    const root = makeRootIndex({
      status: 'BLOCKED',
      total_work_packages: 2,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
        {
          work_package_id: 'WP-002',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: ['WP-001'],
          file: 'ledger/WP-002.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('does NOT heal READY project to COMPLETE when synthesis not yet generated', () => {
    const root = makeRootIndex({
      status: 'READY',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: false,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'COMPLETE',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        },
      ],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('READY');
    // pending_work_packages stored as 0 in override but root fixture stores 1 — needsWrite just for counter
    expect(result.healedStatus).not.toBe('COMPLETE');
  });
});
/* ----------------------------------------------------------
   Schema: initializeProject — plan_file constraint
   ---------------------------------------------------------- */
describe('initializeProject: plan_file Zod constraint', () => {
  it('rejects a non-plan.md plan_file value with a Zod validation error', () => {
    const result = InitializeProjectSchema.safeParse({
      project_path: join(tmpdir(), '2026-01-01-schema-test'),
      plan_file: 'design.md',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const planFileError = result.error.issues.find((i) => i.path.includes('plan_file'));
      expect(planFileError).toBeDefined();
    }
  });

  it('accepts plan.md as a valid plan_file value', () => {
    const result = InitializeProjectSchema.safeParse({
      project_path: join(tmpdir(), '2026-01-01-schema-test'),
      plan_file: 'plan.md',
    });
    expect(result.success).toBe(true);
  });
});

/* ----------------------------------------------------------
   Integration: initializeProject — document archiving
   ---------------------------------------------------------- */
describe('initializeProject: document archiving', () => {
  let planDir: string;
  let ledgerRoot: string;
  let store: LedgerStore;

  /** Base root index used to initialise the store for each test */
  function makeBaseRootIndex(planFile: string): RootIndex {
    const ts = now();
    return {
      plan_file: planFile,
      date_created: ts,
      last_updated: ts,
      status: 'READY',
      total_work_packages: 0,
      pending_work_packages: 0,
      work_packages: [],
      project_comments: [],
    };
  }

  /**
   * Inline simulation of the archiving side-effect added to initializeProject().
   * Writes the root index and .meta.json, then calls archiveDocuments.
   */
  async function simulateInitializeProject(planFile: string) {
    const rootIndex = makeBaseRootIndex(planFile);
    await store.writeRootIndex(rootIndex);
    await store.writeProjectMeta(planFile);
    const archiveResult = await store.archiveDocuments([planFile]);
    return {
      ...rootIndex,
      archived_documents: archiveResult.archived,
      archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
    };
  }

  beforeEach(async () => {
    planDir = await mkdtemp(join(tmpdir(), '2026-01-01-lc-archive-'));
    ledgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-'));
    store = new LedgerStore(planDir, ledgerRoot);
  });

  afterEach(async () => {
    await rm(planDir, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('plan archived on init: plan.md appears in ledger storage dir with identical content', async () => {
    const content = '# My Plan\n\nThis is the plan document.';
    await writeFile(join(planDir, 'plan.md'), content, 'utf8');

    const result = await simulateInitializeProject('plan.md');

    expect(result.archived_documents).toEqual(['plan.md']);
    expect(result.archive_skipped).toBeUndefined();

    const archivedContent = await readFile(join(store.storageDir, 'plan.md'), 'utf8');
    expect(archivedContent).toBe(content);
  });

  it('plan missing on init: tool succeeds; response includes archive_skipped', async () => {
    // plan.md does NOT exist in planDir
    const result = await simulateInitializeProject('plan.md');

    expect(result.archive_skipped).toEqual(['plan.md']);
    expect(result.archived_documents).toEqual([]);
  });

  it('archive info in response: response always includes archived_documents field', async () => {
    await writeFile(join(planDir, 'plan.md'), '# Plan', 'utf8');

    const result = await simulateInitializeProject('plan.md');

    expect(Array.isArray(result.archived_documents)).toBe(true);
  });
});

/* ----------------------------------------------------------
   Integration: completeSynthesis — document archiving
   ---------------------------------------------------------- */
describe('completeSynthesis: document archiving', () => {
  let planDir: string;
  let ledgerRoot: string;
  let store: LedgerStore;

  /**
   * Inline simulation of the archiving side-effect added to completeSynthesis().
   * Reads the root index, updates synthesis flag, writes it back, then archives.
   */
  async function simulateCompleteSynthesis(synthesisFile: string) {
    const rootIndex = await store.readRootIndex();
    rootIndex.synthesis_generated = true;
    rootIndex.last_updated = now();

    const pendingWps = rootIndex.work_packages.filter(
      (wp) => !(['COMPLETE', 'CANCELLED'] as string[]).includes(wp.status)
    ).length;
    if (pendingWps === 0 && rootIndex.work_packages.length > 0) {
      rootIndex.status = 'COMPLETE';
    }

    await store.writeRootIndex(rootIndex);
    const archiveResult = await store.archiveDocuments([synthesisFile]);
    return {
      synthesis_generated: true,
      project_status: rootIndex.status,
      archived_documents: archiveResult.archived,
      archive_skipped: archiveResult.skipped.length > 0 ? archiveResult.skipped : undefined,
    };
  }

  function makeCompleteRootIndex(): RootIndex {
    const ts = now();
    return {
      plan_file: 'plan.md',
      date_created: ts,
      last_updated: ts,
      status: 'IN_PROGRESS',
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
  }

  beforeEach(async () => {
    planDir = await mkdtemp(join(tmpdir(), '2026-01-01-synthesis-archive-'));
    ledgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-'));
    store = new LedgerStore(planDir, ledgerRoot);
    await store.writeRootIndex(makeCompleteRootIndex());
  });

  afterEach(async () => {
    await rm(planDir, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  it('synthesis archived on complete: synthesis.md appears in ledger storage dir', async () => {
    const content = '# Synthesis\n\nProject complete.';
    await writeFile(join(planDir, 'synthesis.md'), content, 'utf8');

    const result = await simulateCompleteSynthesis('synthesis.md');

    expect(result.archived_documents).toEqual(['synthesis.md']);
    expect(result.archive_skipped).toBeUndefined();

    const archivedContent = await readFile(join(store.storageDir, 'synthesis.md'), 'utf8');
    expect(archivedContent).toBe(content);
  });

  it('missing synthesis file: tool succeeds; response includes archive_skipped', async () => {
    // synthesis.md does NOT exist in planDir
    const result = await simulateCompleteSynthesis('synthesis.md');

    expect(result.archive_skipped).toEqual(['synthesis.md']);
    expect(result.archived_documents).toEqual([]);
    expect(result.synthesis_generated).toBe(true);
  });

  it('custom synthesis_file: report.md is archived when specified', async () => {
    const content = '# Custom Report';
    await writeFile(join(planDir, 'report.md'), content, 'utf8');

    const result = await simulateCompleteSynthesis('report.md');

    expect(result.archived_documents).toEqual(['report.md']);

    const archivedContent = await readFile(join(store.storageDir, 'report.md'), 'utf8');
    expect(archivedContent).toBe(content);
  });

  it('plan NOT re-archived at synthesis: only the synthesis file is archived', async () => {
    // Both plan.md and synthesis.md exist in planDir
    await writeFile(join(planDir, 'plan.md'), '# Plan', 'utf8');
    await writeFile(join(planDir, 'synthesis.md'), '# Synthesis', 'utf8');

    const result = await simulateCompleteSynthesis('synthesis.md');

    // Only synthesis.md should be archived, not plan.md
    expect(result.archived_documents).toEqual(['synthesis.md']);
    expect(result.archived_documents).not.toContain('plan.md');
  });
});