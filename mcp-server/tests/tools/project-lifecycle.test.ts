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
import { computeHealedStatus, _internal, InitializeProjectSchema } from '../../src/tools/project-lifecycle.js';

const { completeSynthesis } = _internal;
import { LedgerStore } from '../../src/storage/ledger-store.js';

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
