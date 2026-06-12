import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import {
  createTempStore,
  cleanupTempStore,
  type TempStoreHandle,
} from '../helpers/create-temp-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import { computeHealedStatus, _internal, InitializeProjectSchema, CompleteSynthesisSchema } from '../../src/tools/project-lifecycle.js';
import { SPEC_VERSION } from '../../src/utils/constants.js';

const { completeSynthesis, initializeProject, getProjectStatus } = _internal;
import { LedgerStore } from '../../src/storage/ledger-store.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-lifecycle-heal-test');

/**
 * Tests for the self-healing rules in computeHealedStatus.
 *
 * These tests validate the 16-rule healing logic by calling the production
 * computeHealedStatus function directly (publicly exported from
 * project-lifecycle.ts). No inline replicas.
 */

type ProjectStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type WpStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED';

/**
 * Helper: builds a minimal RootIndex and calls computeHealedStatus.
 * Derives totalWps and pendingWps from wpStatuses automatically.
 */
function healStatus(
  currentStatus: ProjectStatus,
  wpStatuses: WpStatus[],
  synthesisGenerated?: boolean,
): ProjectStatus {
  const rootIndex = {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: currentStatus,
    total_work_packages: wpStatuses.length,
    pending_work_packages: wpStatuses.filter(
      (s) => s !== 'COMPLETE' && s !== 'CANCELLED'
    ).length,
    work_packages: wpStatuses.map((s, i) => ({
      work_package_id: `WP-${String(i + 1).padStart(3, '0')}`,
      file: `work/WP-${String(i + 1).padStart(3, '0')}.md`,
      status: s,
      assigned_to: 'Developer' as const,
      dependencies: [],
    })),
    project_comments: [],
    ...(synthesisGenerated !== undefined ? { synthesis_generated: synthesisGenerated } : {}),
  };
  return computeHealedStatus(rootIndex as any).healedStatus as ProjectStatus;
}

describe('Project status self-healing: READY → IN_PROGRESS', () => {
  it('heals READY to IN_PROGRESS when a WP is IN_PROGRESS', () => {
    expect(healStatus('READY', ['IN_PROGRESS'])).toBe('IN_PROGRESS');
  });

  it('heals READY to IN_PROGRESS when mixed WP statuses include IN_PROGRESS', () => {
    expect(healStatus('READY', ['READY', 'IN_PROGRESS', 'BLOCKED'])).toBe('IN_PROGRESS');
  });

  it('does NOT heal READY when all WPs are READY', () => {
    expect(healStatus('READY', ['READY', 'READY'])).toBe('READY');
  });

  it('heals READY to BLOCKED when all WPs are BLOCKED (Rule 3b)', () => {
    // Rule 3b: READY AND pending>0 AND !hasReadyWp AND !hasInProgressWp → BLOCKED
    expect(healStatus('READY', ['BLOCKED', 'BLOCKED'])).toBe('BLOCKED');
  });

  it('does NOT heal READY when there are no WPs', () => {
    expect(healStatus('READY', [])).toBe('READY');
  });

  it('heals READY to IN_PROGRESS when pending==0 and synthesis not generated (Rule 1b)', () => {
    expect(healStatus('READY', ['COMPLETE', 'COMPLETE'], false)).toBe('IN_PROGRESS');
  });

  it('heals READY to COMPLETE when pending==0 and synthesis generated (Rule 1)', () => {
    expect(healStatus('READY', ['COMPLETE', 'COMPLETE'], true)).toBe('COMPLETE');
  });
});

describe('Project status self-healing: BLOCKED → IN_PROGRESS/READY', () => {
  it('heals BLOCKED to IN_PROGRESS when some WPs are IN_PROGRESS (Rule 4)', () => {
    expect(healStatus('BLOCKED', ['IN_PROGRESS', 'READY'])).toBe('IN_PROGRESS');
  });

  it('heals BLOCKED to READY when no WPs are IN_PROGRESS but some are READY (Rule 4b)', () => {
    expect(healStatus('BLOCKED', ['READY', 'COMPLETE'])).toBe('READY');
  });

  it('heals BLOCKED to READY even when some WPs are BLOCKED if READY WPs exist (Rule 4b)', () => {
    // Rule 4b: BLOCKED AND hasReadyWp AND !hasInProgressWp → READY
    expect(healStatus('BLOCKED', ['BLOCKED', 'READY'])).toBe('READY');
  });

  it('heals BLOCKED to IN_PROGRESS when all WPs are COMPLETE and synthesis not generated (Rule 5b)', () => {
    // Rule 5b: BLOCKED AND pending==0 AND total>0 AND NOT synthesis_generated → IN_PROGRESS
    expect(healStatus('BLOCKED', ['COMPLETE', 'COMPLETE'], false)).toBe('IN_PROGRESS');
  });

  it('heals BLOCKED to IN_PROGRESS over READY when both exist (Rule 4)', () => {
    expect(healStatus('BLOCKED', ['READY', 'IN_PROGRESS', 'COMPLETE'])).toBe('IN_PROGRESS');
  });

  it('heals BLOCKED to COMPLETE when all WPs done and synthesis generated (Rule 5a)', () => {
    expect(healStatus('BLOCKED', ['COMPLETE', 'COMPLETE'], true)).toBe('COMPLETE');
  });
});

describe('Project status self-healing: existing rules still work', () => {
  it('heals IN_PROGRESS to COMPLETE when all WPs done and synthesis generated', () => {
    expect(healStatus('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], true)).toBe('COMPLETE');
  });

  it('stays IN_PROGRESS when all WPs done but synthesis NOT generated', () => {
    expect(healStatus('IN_PROGRESS', ['COMPLETE', 'COMPLETE'], false)).toBe('IN_PROGRESS');
  });

  it('stays IN_PROGRESS when all WPs done and synthesis_generated is undefined', () => {
    expect(healStatus('IN_PROGRESS', ['COMPLETE', 'COMPLETE'])).toBe('IN_PROGRESS');
  });

  it('heals COMPLETE to IN_PROGRESS when pending WPs exist', () => {
    expect(healStatus('COMPLETE', ['IN_PROGRESS', 'COMPLETE'])).toBe('IN_PROGRESS');
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
    const result = computeHealedStatus(readBack);
    expect(result.healedStatus).toBe('IN_PROGRESS');
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
    const result = computeHealedStatus(readBack);
    expect(result.healedStatus).toBe('READY');
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
    // Rule 1b: READY + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS
    // (awaiting synthesis — project should not skip to COMPLETE)
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.healedStatus).not.toBe('COMPLETE');
  });
});
// ---------------------------------------------------------------------------
// §17.2 Healing rules — exhaustive coverage using computeHealedStatus directly
// ---------------------------------------------------------------------------

describe('computeHealedStatus — §17.2 healing rules', () => {
  function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
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

  function wp(id: string, status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED') {
    return {
      work_package_id: id,
      status,
      assigned_to: 'Developer',
      dependencies: [] as string[],
      file: `ledger/${id}.json`,
    };
  }

  it('Rule 1 (IN_PROGRESS): (IN_PROGRESS) + pending=0 + total>0 + synthesis_generated → COMPLETE', () => {
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 1 (READY): (READY) + pending=0 + total>0 + synthesis_generated → COMPLETE', () => {
    const root = makeRoot({
      status: 'READY',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 1b: READY + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'READY',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: false,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 1c: IN_PROGRESS + pending=0 + total>0 + !synthesis_generated → preserve IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: false,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    // needsWrite may be true due to counter mismatch (pending_work_packages stored as 0 but root has pending=0)
    // Status is IN_PROGRESS → IN_PROGRESS, so status diff won't trigger it; only counter mismatch matters.
    expect(result.pendingWps).toBe(0);
  });

  it('Rule 2: COMPLETE + pending>0 → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'COMPLETE',
      total_work_packages: 2,
      pending_work_packages: 1,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'COMPLETE'), wp('WP-002', 'IN_PROGRESS')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 2b: COMPLETE + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'COMPLETE',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: false,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 3: READY + any WP IN_PROGRESS → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'READY',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [wp('WP-001', 'IN_PROGRESS'), wp('WP-002', 'READY')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 3b: READY + pending>0 + no WP READY/IN_PROGRESS → BLOCKED', () => {
    const root = makeRoot({
      status: 'READY',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [wp('WP-001', 'BLOCKED'), wp('WP-002', 'BLOCKED')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('BLOCKED');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 3c: IN_PROGRESS + pending>0 + no WP READY/IN_PROGRESS → BLOCKED', () => {
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [wp('WP-001', 'BLOCKED'), wp('WP-002', 'BLOCKED')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('BLOCKED');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 4: BLOCKED + any WP IN_PROGRESS → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'BLOCKED',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [wp('WP-001', 'IN_PROGRESS'), wp('WP-002', 'BLOCKED')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 4b: BLOCKED + any WP READY (none IN_PROGRESS) → READY', () => {
    const root = makeRoot({
      status: 'BLOCKED',
      total_work_packages: 2,
      pending_work_packages: 2,
      work_packages: [wp('WP-001', 'READY'), wp('WP-002', 'BLOCKED')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('READY');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 5a: BLOCKED + pending=0 + total>0 + synthesis_generated → COMPLETE', () => {
    const root = makeRoot({
      status: 'BLOCKED',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('COMPLETE');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 5b: BLOCKED + pending=0 + total>0 + !synthesis_generated → IN_PROGRESS', () => {
    const root = makeRoot({
      status: 'BLOCKED',
      total_work_packages: 1,
      pending_work_packages: 0,
      synthesis_generated: false,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 6b (IN_PROGRESS): IN_PROGRESS + total=0 → READY', () => {
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 0,
      pending_work_packages: 0,
      work_packages: [],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('READY');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 6b (BLOCKED): BLOCKED + total=0 → READY', () => {
    const root = makeRoot({
      status: 'BLOCKED',
      total_work_packages: 0,
      pending_work_packages: 0,
      work_packages: [],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('READY');
    expect(result.needsWrite).toBe(true);
  });

  it('Rule 6c: COMPLETE + total=0 → READY', () => {
    const root = makeRoot({
      status: 'COMPLETE',
      total_work_packages: 0,
      pending_work_packages: 0,
      synthesis_generated: true,
      work_packages: [],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('READY');
    expect(result.needsWrite).toBe(true);
  });

  it('synthesis_generated corruption: synthesis_generated=true + pending>0 → reset flag, needsWrite=true', () => {
    // synthesis_generated is true but WP-001 is IN_PROGRESS (still pending)
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'IN_PROGRESS')],
    });
    const result = computeHealedStatus(root);
    // With corruption reset, synthesisGenerated=false and pending>0 →
    // Rule 1c: IN_PROGRESS + pending>0 doesn't match Rule 1c (which needs pending=0).
    // Actually pending>0 falls through to Rule 3c: IN_PROGRESS + pending>0 + !hasReady + !hasInProgress?
    // WP-001 IS IN_PROGRESS, so hasInProgressWp=true. Rule 3c requires !hasInProgressWp → doesn't match.
    // No rule fires → healedStatus stays IN_PROGRESS. But corruptionDetected=true → needsWrite=true.
    expect(result.needsWrite).toBe(true);
    expect(result.corruptionDetected).toBe(true);
    expect(result.healedStatus).toBe('IN_PROGRESS'); // status unchanged but write needed to reset flag
  });

  it('corruption round-trip: after write callback resets synthesis_generated, second call returns needsWrite=false', () => {
    // First call — simulate the state before healing write
    const rootBefore = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      synthesis_generated: true,
      work_packages: [wp('WP-001', 'IN_PROGRESS')],
    });
    const first = computeHealedStatus(rootBefore);
    expect(first.corruptionDetected).toBe(true);
    expect(first.needsWrite).toBe(true);

    // Simulate the write callback applying all freshHealed fields, including
    // resetting synthesis_generated=false when corruptionDetected is true.
    const rootAfterWrite = makeRoot({
      status: first.healedStatus,
      total_work_packages: first.totalWps,
      pending_work_packages: first.pendingWps,
      // write callback conditional: if (freshHealed.corruptionDetected) fresh.synthesis_generated = false
      synthesis_generated: first.corruptionDetected ? false : rootBefore.synthesis_generated,
      work_packages: [wp('WP-001', 'IN_PROGRESS')],
    });

    // Second call — counters and status are already correct, flag is reset
    const second = computeHealedStatus(rootAfterWrite);
    expect(second.corruptionDetected).toBe(false);
    expect(second.needsWrite).toBe(false);
  });

  it('no-op: correct IN_PROGRESS state with actual pending WPs → needsWrite=false', () => {
    const root = makeRoot({
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [wp('WP-001', 'IN_PROGRESS')],
    });
    const result = computeHealedStatus(root);
    expect(result.needsWrite).toBe(false);
    expect(result.healedStatus).toBe('IN_PROGRESS');
    expect(result.totalWps).toBe(1);
    expect(result.pendingWps).toBe(1);
  });

  it('CANCELLED project falls through all rules unchanged', () => {
    const root = makeRoot({
      status: 'CANCELLED' as any,
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [wp('WP-001', 'COMPLETE')],
    });
    const result = computeHealedStatus(root);
    expect(result.healedStatus).toBe('CANCELLED');
  });
});

describe('completeSynthesis — §19.1 guards', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeTerminalRoot(overrides: Partial<RootIndex> = {}): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
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
      ...overrides,
    };
  }

  it('rejects caller when agent_role is not "Synthesis" or "Project Manager"', async () => {
    await handle.store.writeRootIndex(makeTerminalRoot());
    for (const role of ['Developer', 'QA', 'Reviewer', 'Documentation', 'random-role']) {
      const result = await completeSynthesis(
        { project_path: PLAN_PATH, agent_role: role },
        handle.ledgerRoot,
      );
      expect(result.isError, `expected isError for role "${role}"`).toBe(true);
      expect(result.content[0].text).toContain('agent_role');
      expect(result.content[0].text).toContain(role);
    }
  });

  it('rejects when project has zero work packages', async () => {
    await handle.store.writeRootIndex(
      makeTerminalRoot({ total_work_packages: 0, pending_work_packages: 0, work_packages: [] }),
    );
    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no work packages');
  });

  it('rejects when pending WPs remain (uses freshly computed counter, not stale)', async () => {
    // pending_work_packages counter is 0 (stale) but WP-002 is still IN_PROGRESS
    await handle.store.writeRootIndex(
      makeTerminalRoot({
        total_work_packages: 2,
        pending_work_packages: 0, // deliberately stale
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
            status: 'IN_PROGRESS', // non-terminal — must be caught by fresh counter
            assigned_to: 'Developer',
            dependencies: [],
            file: 'ledger/WP-002.json',
          },
        ],
      }),
    );
    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('pending');
  });

  it('succeeds for "Synthesis" agent when all WPs terminal', async () => {
    await handle.store.writeRootIndex(
      makeTerminalRoot({
        status: 'IN_PROGRESS',
        total_work_packages: 2,
        pending_work_packages: 0,
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
            status: 'CANCELLED',
            assigned_to: 'Developer',
            dependencies: [],
            file: 'ledger/WP-002.json',
          },
        ],
      }),
    );
    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.synthesis_generated).toBe(true);
    expect(data.project_status).toBe('COMPLETE');
  });

  it('succeeds for "Project Manager" agent when all WPs terminal (PM override)', async () => {
    await handle.store.writeRootIndex(makeTerminalRoot());
    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Project Manager' },
      handle.ledgerRoot,
    );
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.synthesis_generated).toBe(true);
    expect(data.project_status).toBe('COMPLETE');
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

// ---------------------------------------------------------------------------
// FIX-14 — initializeProject rejects re-initialization when ledger exists (§5.1)
// ---------------------------------------------------------------------------

describe('initializeProject — rejects re-initialization when ledger exists (FIX-14)', () => {
  let tempLedgerRoot: string;
  let planDir: string;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'fix14-reinit-'));
    // Plan path must end with a YYYY-MM-DD-... slug so validatePlanPath accepts it
    planDir = join(tmpdir(), '2026-02-28-fix14-reinit-test');
    await mkdir(planDir, { recursive: true });
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
    // planDir is fixed (no YYYY-MM-DD random suffix); remove it explicitly
    await rm(planDir, { recursive: true, force: true });
  });

  it('rejects a second initializeProject call when the ledger already exists', async () => {
    // First call: should succeed and create the ledger
    const firstResult = await initializeProject({
      project_path: planDir,
      plan_file: 'plan.md',
    });
    expect((firstResult as any).isError).toBeFalsy();

    // Second call on the same path: should be rejected
    const secondResult = await initializeProject({
      project_path: planDir,
      plan_file: 'plan.md',
    });
    expect((secondResult as any).isError).toBe(true);
    expect((secondResult as any).content[0].text).toContain('already exists');
  });
});

// ---------------------------------------------------------------------------
// Regression — MCP extra-argument leak (_ledgerRoot type guard)
// Bug reported: 2026-03-01 (docs/agents/plans/2026-03-01-.../pm-findings.md)
// ---------------------------------------------------------------------------
// completeSynthesis had `_ledgerRoot?: string` as a second parameter.
// The MCP SDK passes a RequestHandlerExtra object as the second argument,
// which is truthy and gets captured by _ledgerRoot. LedgerStore's constructor
// then calls `path.join(extra_object, slug)` which throws a path TypeError.
//
// Fix: defensive type guard `const ledgerRoot = typeof _ledgerRoot === 'string'
//      ? _ledgerRoot : undefined` plus a registration wrapper.
//
// This test confirms the guard works by calling completeSynthesis directly
// with a fake extra object and verifying no path TypeError surfaces.
// ---------------------------------------------------------------------------
describe('completeSynthesis — _ledgerRoot defensive type guard (regression 2026-03-01)', () => {
  const FAKE_EXTRA = {
    requestId: 'mcp-test-extra-obj',
    signal: new AbortController().signal,
    authInfo: undefined,
  } as unknown as string;

  const GHOST_PLAN = join(tmpdir(), '2026-03-01-lifecycle-extra-leak-regression');

  it('does not produce a path TypeError when extra object is the second arg', async () => {
    const result = await completeSynthesis(
      { project_path: GHOST_PLAN, agent_role: 'Synthesis' },
      FAKE_EXTRA
    );
    const text = (result as any)?.content?.[0]?.text ?? '';
    expect(/path.*argument.*must.*be.*type.*string/i.test(text)).toBe(false);
    expect(/received an instance of object/i.test(text)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getProjectStatus — pipeline_health sub-object
// ---------------------------------------------------------------------------

describe('getProjectStatus — pipeline_health', () => {
  const HEALTH_PLAN = join(tmpdir(), '2026-03-04-lifecycle-pipeline-health-test');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(HEALTH_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeWpDetail(
    id: string,
    status: WorkPackageDetail['status'],
    passedStages: string[]
  ): WorkPackageDetail {
    return {
      work_package_id: id,
      work_package_file: `work/${id}.md`,
      status,
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Test', met: true }],
      revision: 1,
      pipelines: passedStages.map((type) => ({
        type,
        status: 'PASS' as const,
        started_at: '2026-03-01T00:00:00Z',
        completed_at: '2026-03-01T01:00:00Z',
        summary: [`Completed ${type}`],
      })),
    };
  }

  async function writeProject(wps: WorkPackageDetail[]): Promise<void> {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((w) => !['COMPLETE', 'CANCELLED'].includes(w.status)).length,
      work_packages: wps.map((w) => ({
        work_package_id: w.work_package_id,
        status: w.status,
        assigned_to: w.assigned_to,
        dependencies: [],
        file: `${w.work_package_id}.json`,
      })),
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);
    for (const wp of wps) {
      await handle.store.writeWorkPackage(wp.work_package_id, wp);
    }
  }

  function parseHealth(result: any): { wps_with_all_stages_pass: number; wps_missing_stages: number; total_stages_missing: number } {
    const text = result?.content?.[0]?.text ?? '{}';
    const data = JSON.parse(text);
    return data.pipeline_health;
  }

  it('returns wps_missing_stages: 0 for a healthy project (all 4 stages PASS)', async () => {
    const allStages = ['implementation', 'qa', 'code-review', 'documentation'];
    await writeProject([
      makeWpDetail('WP-001', 'COMPLETE', allStages),
      makeWpDetail('WP-002', 'COMPLETE', allStages),
    ]);

    const result = await getProjectStatus({ project_path: HEALTH_PLAN }, handle.ledgerRoot);
    const health = parseHealth(result);

    expect(health.wps_with_all_stages_pass).toBe(2);
    expect(health.wps_missing_stages).toBe(0);
    expect(health.total_stages_missing).toBe(0);
  });

  it('returns correct counts for a broken project (only implementation PASS)', async () => {
    await writeProject([
      makeWpDetail('WP-001', 'IN_PROGRESS', ['implementation']),
      makeWpDetail('WP-002', 'IN_PROGRESS', ['implementation']),
    ]);

    const result = await getProjectStatus({ project_path: HEALTH_PLAN }, handle.ledgerRoot);
    const health = parseHealth(result);

    expect(health.wps_missing_stages).toBe(2);
    expect(health.total_stages_missing).toBe(6); // 2 WPs × 3 missing stages each
    expect(health.wps_with_all_stages_pass).toBe(0);
  });

  it('excludes CANCELLED WPs from both counts', async () => {
    const allStages = ['implementation', 'qa', 'code-review', 'documentation'];
    await writeProject([
      makeWpDetail('WP-001', 'COMPLETE',   allStages),
      makeWpDetail('WP-002', 'CANCELLED',  []),        // should be excluded
    ]);

    const result = await getProjectStatus({ project_path: HEALTH_PLAN }, handle.ledgerRoot);
    const health = parseHealth(result);

    expect(health.wps_with_all_stages_pass).toBe(1);  // only WP-001
    expect(health.wps_missing_stages).toBe(0);
    expect(health.total_stages_missing).toBe(0);
  });

  it('silently skips unreadable WP detail files', async () => {
    // Write a root index referencing WP-001 but never write the WP file
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
          file: 'WP-001.json',
        },
      ],
      project_comments: [],
    };
    await handle.store.writeRootIndex(root);
    // Intentionally do NOT write WP-001 detail file

    const result = await getProjectStatus({ project_path: HEALTH_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();
    const health = parseHealth(result);
    // Skipped WP contributes nothing to counts
    expect(health.wps_with_all_stages_pass).toBe(0);
    expect(health.wps_missing_stages).toBe(0);
    expect(health.total_stages_missing).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WP-007 — Self-Healing: legacy field repair + forward-compatibility
// Steps 10–12 from plan.md (spec v2.3.0 / v2.4.0 compliance)
// ---------------------------------------------------------------------------

/* ----------------------------------------------------------
   Unit: computeHealedStatus — legacySynthesisTimestampRepair flag
   ---------------------------------------------------------- */
describe('computeHealedStatus — legacySynthesisTimestampRepair flag', () => {
  function makeCompletedRoot(overrides: Partial<RootIndex> = {}): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-02-01T00:00:00Z',
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
      synthesis_generated: true,
      ...overrides,
    };
  }

  it('returns legacySynthesisTimestampRepair=true when synthesis_generated=true and synthesis_generated_at is undefined', () => {
    const root = makeCompletedRoot({ synthesis_generated_at: undefined });
    const result = computeHealedStatus(root);
    expect(result.legacySynthesisTimestampRepair).toBe(true);
    expect(result.needsWrite).toBe(true);
  });

  it('returns legacySynthesisTimestampRepair=true when synthesis_generated=true and synthesis_generated_at is null', () => {
    const root = makeCompletedRoot({ synthesis_generated_at: null });
    const result = computeHealedStatus(root);
    expect(result.legacySynthesisTimestampRepair).toBe(true);
    expect(result.needsWrite).toBe(true);
  });

  it('returns legacySynthesisTimestampRepair=false when synthesis_generated_at is already present', () => {
    const root = makeCompletedRoot({ synthesis_generated_at: '2026-01-10T12:00:00Z' });
    const result = computeHealedStatus(root);
    expect(result.legacySynthesisTimestampRepair).toBe(false);
  });

  it('returns legacySynthesisTimestampRepair=false when synthesis_generated is false', () => {
    const root = makeCompletedRoot({ synthesis_generated: false, synthesis_generated_at: undefined });
    const result = computeHealedStatus(root);
    expect(result.legacySynthesisTimestampRepair).toBe(false);
  });

  it('returns legacySynthesisTimestampRepair=false when corruptionDetected overrides synthesis_generated', () => {
    // synthesis_generated=true but pending>0 triggers corruption detection
    const root = makeCompletedRoot({
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
      synthesis_generated_at: undefined,
    });
    const result = computeHealedStatus(root);
    expect(result.corruptionDetected).toBe(true);
    expect(result.legacySynthesisTimestampRepair).toBe(false);
  });
});

/* ----------------------------------------------------------
   Integration: AC1 + AC2 — synthesis_generated_at backfill + repair comment
   ---------------------------------------------------------- */
describe('getProjectStatus — legacy synthesis_generated_at repair (AC1 + AC2)', () => {
  const LEGACY_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp007-legacy-synthesis');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(LEGACY_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeLegacyRoot(lastUpdated: string): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: lastUpdated,
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
      synthesis_generated: true,
      // synthesis_generated_at deliberately absent (legacy ledger)
    };
  }

  it('AC1: backfills synthesis_generated_at to last_updated for a legacy ledger', async () => {
    const LAST_UPDATED = '2026-02-10T09:30:00Z';
    await handle.store.writeRootIndex(makeLegacyRoot(LAST_UPDATED));

    const result = await getProjectStatus({ project_path: LEGACY_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();

    const data = JSON.parse((result as any).content[0].text);
    expect(data.synthesis_generated_at).toBe(LAST_UPDATED);
  });

  it('AC2: emits a soft warning project comment when synthesis_generated_at is backfilled', async () => {
    await handle.store.writeRootIndex(makeLegacyRoot('2026-02-10T09:30:00Z'));

    const result = await getProjectStatus({ project_path: LEGACY_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((result as any).content[0].text);

    const repairComment = data.project_comments.find(
      (c: any) => c.note === 'Self-healed: backfilled synthesis_generated_at from last_updated',
    );
    expect(repairComment).toBeDefined();
    expect(repairComment.type).toBe('warning');
  });
});

/* ----------------------------------------------------------
   Integration: AC3 — ledger_version backfill
   ---------------------------------------------------------- */
describe('getProjectStatus — legacy ledger_version backfill (AC3)', () => {
  const LEGACY_VERSION_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp007-legacy-version');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(LEGACY_VERSION_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('AC3: silently backfills ledger_version to SPEC_VERSION when absent', async () => {
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
      // ledger_version deliberately absent (legacy ledger)
    };
    await handle.store.writeRootIndex(root);

    const result = await getProjectStatus({ project_path: LEGACY_VERSION_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();

    const data = JSON.parse((result as any).content[0].text);
    expect(data.ledger_version).toBe(SPEC_VERSION);
  });

  it('AC3: backfill does not emit a project comment (silent migration)', async () => {
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
    await handle.store.writeRootIndex(root);

    const result = await getProjectStatus({ project_path: LEGACY_VERSION_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((result as any).content[0].text);

    const versionBackfillComment = data.project_comments.find(
      (c: any) => c.note?.includes('ledger_version'),
    );
    expect(versionBackfillComment).toBeUndefined();
  });
});

/* ----------------------------------------------------------
   Integration: AC4 — forward-compatibility warning
   ---------------------------------------------------------- */
describe('getProjectStatus — forward-compatibility warning (AC4)', () => {
  const FWD_COMPAT_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp007-fwd-compat');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(FWD_COMPAT_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeVersionRoot(ledgerVersion: string): RootIndex {
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
      ledger_version: ledgerVersion,
    };
  }

  it('AC4: emits a warning comment when ledger_version is higher than SPEC_VERSION', async () => {
    await handle.store.writeRootIndex(makeVersionRoot('9.9.9'));

    const result = await getProjectStatus({ project_path: FWD_COMPAT_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((result as any).content[0].text);

    const fwdWarning = data.project_comments.find(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarning).toBeDefined();
    expect(fwdWarning.type).toBe('warning');
    expect(fwdWarning.note).toContain('9.9.9');
    expect(fwdWarning.note).toContain(SPEC_VERSION);
  });

  it('AC4: does NOT emit forward-compat warning when ledger_version equals SPEC_VERSION', async () => {
    await handle.store.writeRootIndex(makeVersionRoot(SPEC_VERSION));

    const result = await getProjectStatus({ project_path: FWD_COMPAT_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((result as any).content[0].text);

    const fwdWarning = data.project_comments.find(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarning).toBeUndefined();
  });

  it('AC4: does NOT emit forward-compat warning when ledger_version is lower than SPEC_VERSION', async () => {
    await handle.store.writeRootIndex(makeVersionRoot('1.0.0'));

    const result = await getProjectStatus({ project_path: FWD_COMPAT_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((result as any).content[0].text);

    const fwdWarning = data.project_comments.find(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarning).toBeUndefined();
  });

  it('does NOT emit false forward-compat warning for pre-release version "2.5.0-beta" (semver guard)', async () => {
    // "2.5.0-beta" splits to [2, 5, NaN] — the isFinite guard should skip the comparison
    await handle.store.writeRootIndex(makeVersionRoot('2.5.0-beta'));

    const result = await getProjectStatus({ project_path: FWD_COMPAT_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();

    const data = JSON.parse((result as any).content[0].text);
    const fwdWarning = data.project_comments.find(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarning).toBeUndefined();
  });

  it('still triggers forward-compat warning for "3.0.0" (semver guard does not suppress valid warnings)', async () => {
    await handle.store.writeRootIndex(makeVersionRoot('3.0.0'));

    const result = await getProjectStatus({ project_path: FWD_COMPAT_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();

    const data = JSON.parse((result as any).content[0].text);
    const fwdWarning = data.project_comments.find(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarning).toBeDefined();
  });
});

/* ----------------------------------------------------------
   Integration: AC5 — atomicity (both repairs in one write)
   ---------------------------------------------------------- */
describe('getProjectStatus — self-healing atomicity (AC5)', () => {
  const ATOMIC_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp007-atomic');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(ATOMIC_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('AC5: synthesis_generated_at and ledger_version are both repaired after a single read', async () => {
    // A ledger missing both fields — both must be repaired in the same atomic write.
    const LAST_UPDATED = '2026-02-10T08:00:00Z';
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: LAST_UPDATED,
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
      synthesis_generated: true,
      // Both synthesis_generated_at and ledger_version deliberately absent
    };
    await handle.store.writeRootIndex(root);

    const result = await getProjectStatus({ project_path: ATOMIC_PLAN }, handle.ledgerRoot);
    expect((result as any).isError).toBeFalsy();

    const data = JSON.parse((result as any).content[0].text);
    // Both fields must be repaired in the same pass
    expect(data.synthesis_generated_at).toBe(LAST_UPDATED);
    expect(data.ledger_version).toBe(SPEC_VERSION);
  });
});

/* ----------------------------------------------------------
   Integration: AC6 — no duplicate comments on repeated reads
   ---------------------------------------------------------- */
describe('getProjectStatus — no duplicate repair comments (AC6)', () => {
  const NO_DUP_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp007-no-dup');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(NO_DUP_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('AC6: synthesis_generated_at repair comment is added only once on repeated reads', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-02-01T00:00:00Z',
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
      synthesis_generated: true,
    };
    await handle.store.writeRootIndex(root);

    // First read — fires the repair
    await getProjectStatus({ project_path: NO_DUP_PLAN }, handle.ledgerRoot);
    // Second read — must not duplicate the comment
    const secondResult = await getProjectStatus({ project_path: NO_DUP_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((secondResult as any).content[0].text);

    const repairComments = data.project_comments.filter(
      (c: any) => c.note === 'Self-healed: backfilled synthesis_generated_at from last_updated',
    );
    expect(repairComments).toHaveLength(1);
  });

  it('AC6: forward-compat warning comment is added only once on repeated reads', async () => {
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
      ledger_version: '9.9.9',
    };
    await handle.store.writeRootIndex(root);

    // First read — fires the forward-compat warning
    await getProjectStatus({ project_path: NO_DUP_PLAN }, handle.ledgerRoot);
    // Second read — must not duplicate the comment
    const secondResult = await getProjectStatus({ project_path: NO_DUP_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((secondResult as any).content[0].text);

    const fwdWarnings = data.project_comments.filter(
      (c: any) => c.note?.includes('newer than the current server spec version'),
    );
    expect(fwdWarnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rework WP-001 — Lock consolidation + TOCTOU symmetry
// ---------------------------------------------------------------------------
describe('getProjectStatus — single writeRootIndex call for multiple repairs (WP-001)', () => {
  const LOCK_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp001-lock-consolidation');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(LOCK_PLAN);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempStore(handle);
  });

  it('fires exactly one writeRootIndex call when multiple repairs are needed simultaneously', async () => {
    // A ledger that triggers multiple repairs: status correction, synthesis_generated_at backfill,
    // ledger_version backfill, and synthesis repair comment — all in one pass.
    const LAST_UPDATED = '2026-02-10T08:00:00Z';
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: LAST_UPDATED,
      status: 'IN_PROGRESS', // needs healing to COMPLETE (pending==0, synthesis_generated==true)
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
      synthesis_generated: true,
      // Both synthesis_generated_at and ledger_version deliberately absent
    };
    await handle.store.writeRootIndex(root);

    // Spy on writeRootIndex prototype to count write calls during getProjectStatus
    const writeSpy = vi.spyOn(LedgerStore.prototype, 'writeRootIndex');

    await getProjectStatus({ project_path: LOCK_PLAN }, handle.ledgerRoot);

    // All repairs must happen in a single write call (consolidated lock)
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getProjectStatus — synthesis timestamp repair comment deduplication (WP-001)', () => {
  const DEDUP_PLAN = join(tmpdir(), '2026-03-17-lifecycle-wp001-synth-dedup');
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(DEDUP_PLAN);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  it('does not produce duplicate synthesis timestamp repair comments on repeated calls', async () => {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-02-01T00:00:00Z',
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
      synthesis_generated: true,
      // synthesis_generated_at deliberately absent — triggers repair
    };
    await handle.store.writeRootIndex(root);

    // First call triggers the repair and adds comment
    await getProjectStatus({ project_path: DEDUP_PLAN }, handle.ledgerRoot);
    // Second call — synthesis_generated_at is now present, so repair should not re-fire
    await getProjectStatus({ project_path: DEDUP_PLAN }, handle.ledgerRoot);
    // Third call for good measure
    const thirdResult = await getProjectStatus({ project_path: DEDUP_PLAN }, handle.ledgerRoot);
    const data = JSON.parse((thirdResult as any).content[0].text);

    const repairComments = data.project_comments.filter(
      (c: any) => c.note === 'Self-healed: backfilled synthesis_generated_at from last_updated',
    );
    expect(repairComments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WP-008 — completeSynthesis sets synthesis_generated_at
// ---------------------------------------------------------------------------
describe('completeSynthesis — sets synthesis_generated_at (WP-008)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeAllDoneRoot(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
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

  it('sets synthesis_generated_at to a non-null ISO timestamp on success', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    const before = Date.now();
    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );
    const after = Date.now();

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.synthesis_generated_at).toBeDefined();
    expect(typeof data.synthesis_generated_at).toBe('string');
    const ts = new Date(data.synthesis_generated_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it('persists synthesis_generated_at in the root index on disk', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );

    const root = await handle.store.readRootIndex();
    expect(root.synthesis_generated).toBe(true);
    expect(root.synthesis_generated_at).toBeDefined();
    expect(typeof root.synthesis_generated_at).toBe('string');
    expect(root.synthesis_generated_at!.length).toBeGreaterThan(0);
  });

  it('includes synthesis_generated_at in the response JSON', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis' },
      handle.ledgerRoot,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('synthesis_generated_at');
    expect(data.synthesis_generated_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WP-008 — initializeProject sets ledger_version
// ---------------------------------------------------------------------------
describe('initializeProject — sets ledger_version to SPEC_VERSION (WP-008)', () => {
  let planDir: string;
  let originalArgv: string[];
  let tempLedgerRoot: string;

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'wp008-init-version-'));
    planDir = join(tmpdir(), '2026-03-17-wp008-init-version-test');
    await mkdir(planDir, { recursive: true });
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  });

  it('new project ledger contains ledger_version equal to SPEC_VERSION', async () => {
    const result = await initializeProject({
      project_path: planDir,
      plan_file: 'plan.md',
    });

    expect((result as any).isError).toBeFalsy();
    const data = JSON.parse((result as any).content[0].text);
    expect(data.ledger_version).toBe(SPEC_VERSION);
  });

  it('persists ledger_version on disk after initialization', async () => {
    await initializeProject({
      project_path: planDir,
      plan_file: 'plan.md',
    });

    const store = new LedgerStore(planDir, tempLedgerRoot);
    const root = await store.readRootIndex();
    expect(root.ledger_version).toBe(SPEC_VERSION);
  });
});

// ---------------------------------------------------------------------------
// WP-004 — completeSynthesis persists outcome_summary
// ---------------------------------------------------------------------------
describe('completeSynthesis — outcome_summary persistence (WP-004)', () => {
  let handle: TempStoreHandle;

  beforeEach(async () => {
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    await cleanupTempStore(handle);
  });

  function makeAllDoneRoot(): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
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

  const SAMPLE_SUMMARY =
    'Implemented the outcome_summary parameter. The field is now required by the schema and is persisted to both the root index and .meta.json enrichment cache. No notable limitations.';

  it('CompleteSynthesisSchema rejects input when outcome_summary is missing', () => {
    // Test Zod schema validation directly — outcome_summary is required
    const result = CompleteSynthesisSchema.safeParse({
      project_path: PLAN_PATH,
      agent_role: 'Synthesis',
      // outcome_summary intentionally omitted
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const outcomeSummaryError = result.error.issues.find((i) => i.path.includes('outcome_summary'));
      expect(outcomeSummaryError).toBeDefined();
    }
  });

  it('CompleteSynthesisSchema rejects outcome_summary shorter than 10 characters', () => {
    const result = CompleteSynthesisSchema.safeParse({
      project_path: PLAN_PATH,
      agent_role: 'Synthesis',
      outcome_summary: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('outcome_summary'));
      expect(issue).toBeDefined();
    }
  });

  it('CompleteSynthesisSchema accepts outcome_summary of at least 10 characters', () => {
    const result = CompleteSynthesisSchema.safeParse({
      project_path: PLAN_PATH,
      agent_role: 'Synthesis',
      outcome_summary: 'A valid summary of at least ten characters.',
    });
    expect(result.success).toBe(true);
  });

  it('persists outcome_summary to root index on disk after completeSynthesis', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis', outcome_summary: SAMPLE_SUMMARY },
      handle.ledgerRoot,
    );

    expect(result.isError).toBeUndefined();
    const root = await handle.store.readRootIndex();
    expect(root.outcome_summary).toBe(SAMPLE_SUMMARY);
  });

  it('persists outcome_summary to .meta.json after completeSynthesis', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis', outcome_summary: SAMPLE_SUMMARY },
      handle.ledgerRoot,
    );

    const meta = await handle.store.readProjectMeta();
    expect(meta.outcome_summary).toBe(SAMPLE_SUMMARY);
  });

  it('existing completeSynthesis functionality still works with outcome_summary present', async () => {
    await handle.store.writeRootIndex(makeAllDoneRoot());

    const result = await completeSynthesis(
      { project_path: PLAN_PATH, agent_role: 'Synthesis', outcome_summary: SAMPLE_SUMMARY },
      handle.ledgerRoot,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.synthesis_generated).toBe(true);
    expect(data.project_status).toBe('COMPLETE');
    expect(data.synthesis_generated_at).toBeDefined();

    const root = await handle.store.readRootIndex();
    expect(root.synthesis_generated).toBe(true);
    expect(root.status).toBe('COMPLETE');
  });
});
