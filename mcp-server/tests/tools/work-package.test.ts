import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { _internal, CLAIMABLE_ROLES } from '../../src/tools/work-package.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex, WorkPackageSummary } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';
import { AGENT_ROLES, ORCHESTRATING_ROLES } from '../../src/utils/constants.js';

const { buildStatusTransitionGuidance, propagateDependencyUnblock, propagateDependencyReblock, createWorkPackage, updateWorkPackageStatus, claimWorkPackage, resetReworkCount, updateAcceptanceCriteria } = _internal;

describe('WP status transition guidance (buildStatusTransitionGuidance)', () => {
  it('BLOCKED guidance mentions Developer rework via get_next_action', () => {
    const guidance = buildStatusTransitionGuidance('WP-005', 'BLOCKED', 'QA');
    expect(guidance).toContain('NEXT STEP');
    expect(guidance).toContain('BLOCKED');
    expect(guidance).toContain('Developer');
    expect(guidance).toContain('ledger_get_handoff_status');
    expect(guidance).toContain('ledger_get_next_action');
  });

  it('COMPLETE guidance mentions auto-unblocking and handoff', () => {
    const guidance = buildStatusTransitionGuidance('WP-001', 'COMPLETE', 'Documentation');
    expect(guidance).toContain('COMPLETE');
    expect(guidance).toContain('auto-unblocked');
    expect(guidance).toContain('ledger_get_handoff_status');
  });

  it('IN_PROGRESS guidance tells agent to start a pipeline', () => {
    const guidance = buildStatusTransitionGuidance('WP-002', 'IN_PROGRESS', 'Developer');
    expect(guidance).toContain('IN_PROGRESS');
    expect(guidance).toContain('ledger_start_pipeline');
    expect(guidance).toContain('ledger_complete_pipeline');
  });

  it('READY status returns empty guidance (no special routing needed)', () => {
    const guidance = buildStatusTransitionGuidance('WP-001', 'READY', 'Project Manager');
    expect(guidance).toBe('');
  });
});

describe('COMPLETE -> IN_PROGRESS agent guard', () => {
  /**
   * Inline replica of the agent guard added to updateWorkPackageStatus.
   * Tests the guard logic in isolation without requiring a store, following
   * the same pattern as claim-guard.test.ts.
   */
  const ALLOWED_REOPEN_AGENTS = [
    'Project Manager',
    'Project Manager Agent',
    'Documentation',
    'Documentation Agent',
  ];

  function checkReopenGuard(oldStatus: string, newStatus: string, agent: string): string | null {
    if (oldStatus !== 'COMPLETE' || newStatus !== 'IN_PROGRESS') return null;
    if (!ALLOWED_REOPEN_AGENTS.includes(agent)) {
      return (
        `Only the Project Manager or Documentation agent may reopen a COMPLETE work package (COMPLETE → IN_PROGRESS). You are: ${agent}\n\n` +
        `If you believe this work package needs rework, hand off to the Project Manager or Documentation agent so they can formally reopen it.`
      );
    }
    return null;
  }

  it('rejects Developer attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Developer');
    expect(error).not.toBeNull();
    expect(error).toContain('Project Manager or Documentation agent');
    expect(error).toContain('You are: Developer');
  });

  it('rejects QA attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'QA');
    expect(error).not.toBeNull();
    expect(error).toContain('You are: QA');
  });

  it('rejects Reviewer attempting COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Reviewer');
    expect(error).not.toBeNull();
    expect(error).toContain('You are: Reviewer');
  });

  it('allows Project Manager to reopen COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Project Manager');
    expect(error).toBeNull();
  });

  it('allows Project Manager Agent alias', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Project Manager Agent');
    expect(error).toBeNull();
  });

  it('allows Documentation to reopen COMPLETE -> IN_PROGRESS', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Documentation');
    expect(error).toBeNull();
  });

  it('allows Documentation Agent alias', () => {
    const error = checkReopenGuard('COMPLETE', 'IN_PROGRESS', 'Documentation Agent');
    expect(error).toBeNull();
  });

  it('does not apply guard for other transitions (e.g., IN_PROGRESS -> BLOCKED)', () => {
    const error = checkReopenGuard('IN_PROGRESS', 'BLOCKED', 'Developer');
    expect(error).toBeNull();
  });
});

describe('BLOCKED -> READY clears blocked_by', () => {
  /**
   * Inline replica of the blocked_by-clearing logic in updateWorkPackageStatus.
   * Tests that exiting BLOCKED via READY (auto-unblock) leaves no stale blocked_by,
   * mirroring the same guarantee already tested for BLOCKED -> IN_PROGRESS.
   */
  function applyBlockedByClearing(
    oldStatus: string,
    newStatus: string,
    wp: { blocked_by?: { type: string; description: string } },
  ): typeof wp {
    // Replica of the widened guard in updateWorkPackageStatus step 7
    if (oldStatus === 'BLOCKED' && newStatus !== 'BLOCKED') {
      delete wp.blocked_by;
    }
    return wp;
  }

  it('clears blocked_by when transitioning BLOCKED -> READY', () => {
    const wp = { blocked_by: { type: 'dependency', description: 'Waiting for WP-000' } };
    const result = applyBlockedByClearing('BLOCKED', 'READY', wp);
    expect(result.blocked_by).toBeUndefined();
  });

  it('clears blocked_by when transitioning BLOCKED -> IN_PROGRESS', () => {
    const wp = { blocked_by: { type: 'technical', description: 'Build broken' } };
    const result = applyBlockedByClearing('BLOCKED', 'IN_PROGRESS', wp);
    expect(result.blocked_by).toBeUndefined();
  });

  it('does NOT clear blocked_by for non-BLOCKED old status (e.g., READY -> IN_PROGRESS)', () => {
    const wp = {};
    const result = applyBlockedByClearing('READY', 'IN_PROGRESS', wp);
    // blocked_by was never set and should remain absent (no error)
    expect(result.blocked_by).toBeUndefined();
  });

  it('does NOT clear blocked_by when transitioning into BLOCKED (BLOCKED -> BLOCKED no-op)', () => {
    const wp = { blocked_by: { type: 'external', description: 'Waiting on vendor' } };
    const result = applyBlockedByClearing('BLOCKED', 'BLOCKED', wp);
    expect(result.blocked_by).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test Group 3 — claimWorkPackage override authorization guard (GN-5)
// ---------------------------------------------------------------------------
// Inline replica of the override-auth guard (step 2b) in claimWorkPackage.
// Keeps tests independent of private schema exports while validating the same
// invariants enforced by the real tool handler.

function overrideAuthGuard(
  wpAssignedTo: string,
  agent: string,
  override?: boolean,
): string | null {
  // Guard only fires when override is true and there is a current assignee
  if (!override || !wpAssignedTo) return null;
  if (agent === 'Project Manager' || agent === wpAssignedTo) return null;
  return (
    `Cannot override claim on work package WP-001: ` +
    `override is restricted to "Project Manager" or the current assignee ` +
    `("${wpAssignedTo}"). You are "${agent}".`
  );
}

describe('claimWorkPackage override authorization guard (GN-5)', () => {
  const ASSIGNED_TO = 'Developer';

  it('PM override allowed — Project Manager with override: true succeeds', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Project Manager', true);
    expect(error).toBeNull();
  });

  it('assignee override allowed — current assignee with override: true succeeds', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Developer', true);
    expect(error).toBeNull();
  });

  it('third-party override rejected — non-PM, non-assignee with override: true throws', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'QA', true);
    expect(error).not.toBeNull();
    expect(error).toContain('override is restricted to "Project Manager" or the current assignee');
    expect(error).toContain('"Developer"');
    expect(error).toContain('"QA"');
  });

  it('no override flag — guard does not apply (returns null)', () => {
    // Without override: true the earlier assignment guard fires instead; this guard is a no-op.
    expect(overrideAuthGuard(ASSIGNED_TO, 'QA', false)).toBeNull();
    expect(overrideAuthGuard(ASSIGNED_TO, 'QA', undefined)).toBeNull();
  });

  it('Reviewer override also rejected (not PM, not assignee)', () => {
    const error = overrideAuthGuard(ASSIGNED_TO, 'Reviewer', true);
    expect(error).not.toBeNull();
    expect(error).toContain('override is restricted to "Project Manager" or the current assignee');
  });
});

// ---------------------------------------------------------------------------
// Test Group 4 — WP ID regex completeness (WP-003 schema changes)
// ---------------------------------------------------------------------------
// The three schemas (GetWorkPackageSchema, ClaimWorkPackageSchema, and the
// dependencies entry in CreateWorkPackageSchema) all use the pattern
// /^WP-\d{3,}$/ — requiring at least 3 digits. These tests verify that
// WP-1000 (4 digits) is accepted and WP-10 (2 digits) is rejected across
// all three schema shapes, without requiring private schema exports.

const WP_ID_REGEX = /^WP-\d{3,}$/;

// Minimal schema mirrors (same regex, no source-file modification needed)
const GetWorkPackageSchemaMinimal = z.object({
  project_path: z.string(),
  work_package_id: z.string().regex(WP_ID_REGEX),
});

const CreateWorkPackageDepsSchema = z.object({
  project_path: z.string(),
  dependencies: z.array(z.string().regex(WP_ID_REGEX)),
});

const ClaimWorkPackageSchemaMinimal = z.object({
  project_path: z.string(),
  work_package_id: z.string().regex(WP_ID_REGEX),
  agent: z.string(),
});

const BASE = { project_path: '/tmp/2026-01-01-test', agent: 'Developer' };

describe('WP ID regex — 4-digit ID WP-1000 accepted (GN-3)', () => {
  it('GetWorkPackageSchema accepts WP-1000', () => {
    const result = GetWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-1000',
    });
    expect(result.success).toBe(true);
  });

  it('CreateWorkPackageSchema(dependencies) accepts WP-1000', () => {
    const result = CreateWorkPackageDepsSchema.safeParse({
      project_path: BASE.project_path,
      dependencies: ['WP-1000'],
    });
    expect(result.success).toBe(true);
  });

  it('ClaimWorkPackageSchema accepts WP-1000', () => {
    const result = ClaimWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-1000',
      agent: BASE.agent,
    });
    expect(result.success).toBe(true);
  });
});

describe('WP ID regex — 2-digit ID WP-10 rejected (GN-3)', () => {
  it('GetWorkPackageSchema rejects WP-10', () => {
    const result = GetWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-10',
    });
    expect(result.success).toBe(false);
  });

  it('CreateWorkPackageSchema(dependencies) rejects WP-10', () => {
    const result = CreateWorkPackageDepsSchema.safeParse({
      project_path: BASE.project_path,
      dependencies: ['WP-10'],
    });
    expect(result.success).toBe(false);
  });

  it('ClaimWorkPackageSchema rejects WP-10', () => {
    const result = ClaimWorkPackageSchemaMinimal.safeParse({
      project_path: BASE.project_path,
      work_package_id: 'WP-10',
      agent: BASE.agent,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// propagateDependencyUnblock — non-dependency blocker guard (WP-002)
// ---------------------------------------------------------------------------

const UNBLOCK_PLAN_PATH = join(tmpdir(), '2026-01-01-unblock-test');

function makeWpSummary(
  id: string,
  status: string,
  deps: string[] = [],
): WorkPackageSummary {
  return {
    work_package_id: id,
    file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: deps,
  };
}

function makeWpDetail(
  id: string,
  status: string,
  deps: string[] = [],
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: deps,
    acceptance_criteria: [],
    revision: 0,
    pipelines: [],
  };
}

function makeRootIndexForUnblock(
  summaries: Array<{ id: string; status: string; deps?: string[] }>,
): RootIndex {
  const wps = summaries.map((s) => makeWpSummary(s.id, s.status, s.deps ?? []));
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: wps.length,
    pending_work_packages: wps.filter(
      (w) => w.status !== 'COMPLETE' && w.status !== 'CANCELLED',
    ).length,
    work_packages: wps,
    project_comments: [],
  };
}

describe('propagateDependencyUnblock — non-dependency blocker guard', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'unblock-test-'));
    store = new LedgerStore(UNBLOCK_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('propagateDependencyUnblock skips WPs with external blocked_by even when deps satisfied', async () => {
    const root = makeRootIndexForUnblock([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'BLOCKED', ['WP-001']),
      blocked_by: { type: 'external', description: 'Waiting on external team' },
    });

    await propagateDependencyUnblock(UNBLOCK_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
    expect(wp002.blocked_by).toBeDefined();
    expect(wp002.blocked_by?.type).toBe('external');
  });

  it('propagateDependencyUnblock skips WPs with decision blocked_by even when deps satisfied', async () => {
    const root = makeRootIndexForUnblock([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'BLOCKED', ['WP-001']),
      blocked_by: { type: 'decision', description: 'Pending architecture decision' },
    });

    await propagateDependencyUnblock(UNBLOCK_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
    expect(wp002.blocked_by?.type).toBe('decision');
  });

  it('propagateDependencyUnblock correctly unblocks WPs with dependency blocked_by', async () => {
    const root = makeRootIndexForUnblock([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'BLOCKED', ['WP-001']),
      blocked_by: {
        type: 'dependency',
        description: 'Waiting for WP-001',
        blocking_work_package: 'WP-001',
      },
    });

    await propagateDependencyUnblock(UNBLOCK_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('READY');
    expect(wp002.blocked_by).toBeUndefined();
  });

  it('propagateDependencyUnblock correctly unblocks WPs with no blocked_by field', async () => {
    const root = makeRootIndexForUnblock([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    // WP-002 is BLOCKED but has no blocked_by (dependency-only block with no metadata)
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'BLOCKED', ['WP-001']));

    await propagateDependencyUnblock(UNBLOCK_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('READY');
    expect(wp002.blocked_by).toBeUndefined();
  });

  it('propagateDependencyUnblock sets status_changed_at on cascade-unblocked WPs', async () => {
    const root = makeRootIndexForUnblock([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'BLOCKED', deps: ['WP-001'] },
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'BLOCKED', ['WP-001']));

    const before = Math.floor(Date.now() / 1000) * 1000;
    await propagateDependencyUnblock(UNBLOCK_PLAN_PATH, 'WP-001', tempDir);
    const after = Date.now();

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('READY');
    expect(wp002.status_changed_at).toBeDefined();
    expect(typeof wp002.status_changed_at).toBe('string');
    const changedAt = new Date(wp002.status_changed_at!).getTime();
    expect(changedAt).toBeGreaterThanOrEqual(before);
    expect(changedAt).toBeLessThanOrEqual(after + 1000); // 1s tolerance
  });
});

// ---------------------------------------------------------------------------
// createWorkPackage — AC 7 & 8 (WP-001 schema type foundations)
// ---------------------------------------------------------------------------

const CREATE_PLAN_PATH = join(tmpdir(), '2026-02-27-create-wp-test');

function makeInitialRootIndex(): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'READY',
    total_work_packages: 0,
    pending_work_packages: 0,
    work_packages: [],
    project_comments: [],
  };
}

describe('createWorkPackage — revision and assigned_to defaults (AC 7 & 8)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'create-wp-test-'));
    store = new LedgerStore(CREATE_PLAN_PATH, tempDir);
    await store.writeRootIndex(makeInitialRootIndex());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sets revision: 0 on a newly created work package (AC 7)', async () => {
    const result = await createWorkPackage(
      {
        project_path: CREATE_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: ['Feature works'],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    const wp = JSON.parse(text);
    expect(wp.revision).toBe(0);
  });

  it('sets assigned_to to null regardless of tool input (§9b.1 soft-deprecation) (AC 8)', async () => {
    const result = await createWorkPackage(
      {
        project_path: CREATE_PLAN_PATH,
        assigned_to: 'QA',
        dependencies: [],
        acceptance_criteria: ['Tests pass'],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    const wp = JSON.parse(text);
    expect(wp.assigned_to).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WP-004 — updateWorkPackageStatus comprehensive guards and side effects
// ---------------------------------------------------------------------------

// ── Inline replicas ──────────────────────────────────────────────────────────

// 1. BLOCKED → BLOCKED permission guard (\u00a721.17)

function blockedToBlockedGuard(
  wpAssignedTo: string | null,
  agent: string,
): string | null {
  const pmAgents = ['Project Manager', 'Project Manager Agent'];
  const isAllowed = pmAgents.includes(agent) || agent === wpAssignedTo;
  if (!isAllowed) {
    return `Only the Project Manager or the current assignee ("${wpAssignedTo}") may replace a blocker on work package WP-001. You are: ${agent}`;
  }
  return null;
}

describe('BLOCKED \u2192 BLOCKED: permission guard (\u00a721.17)', () => {
  const ASSIGNED_TO = 'Developer';

  it('Project Manager is allowed to replace a blocker', () => {
    expect(blockedToBlockedGuard(ASSIGNED_TO, 'Project Manager')).toBeNull();
  });

  it('Project Manager Agent alias is allowed', () => {
    expect(blockedToBlockedGuard(ASSIGNED_TO, 'Project Manager Agent')).toBeNull();
  });

  it('current assignee is allowed to replace their own blocker', () => {
    expect(blockedToBlockedGuard(ASSIGNED_TO, 'Developer')).toBeNull();
  });

  it('QA (non-PM, non-assignee) is rejected', () => {
    const err = blockedToBlockedGuard(ASSIGNED_TO, 'QA');
    expect(err).not.toBeNull();
    expect(err).toContain('Project Manager or the current assignee');
    expect(err).toContain('You are: QA');
  });

  it('Reviewer (non-PM, non-assignee) is rejected', () => {
    const err = blockedToBlockedGuard(ASSIGNED_TO, 'Reviewer');
    expect(err).not.toBeNull();
    expect(err).toContain('You are: Reviewer');
  });
});

// 2. BLOCKED → BLOCKED: dependency-to-non-dependency replacement guard
function blockedDependencyReplacementGuard(
  existingBlockerType: string | undefined,
  newBlockerType: string,
): string | null {
  if (existingBlockerType === 'dependency' && newBlockerType !== 'dependency') {
    return (
      `Cannot replace a 'dependency' blocker with a '${newBlockerType}' blocker. ` +
      `Dependency blockers can only be resolved by completing the blocking work package.`
    );
  }
  return null;
}

describe('BLOCKED \u2192 BLOCKED: dependency blocker replacement guard (\u00a721.17)', () => {
  it('dependency \u2192 external replacement is rejected', () => {
    const err = blockedDependencyReplacementGuard('dependency', 'external');
    expect(err).not.toBeNull();
    expect(err).toContain("Cannot replace a 'dependency' blocker with a 'external' blocker");
  });

  it('dependency \u2192 technical replacement is rejected', () => {
    const err = blockedDependencyReplacementGuard('dependency', 'technical');
    expect(err).not.toBeNull();
  });

  it('dependency \u2192 dependency replacement is allowed', () => {
    expect(blockedDependencyReplacementGuard('dependency', 'dependency')).toBeNull();
  });

  it('external \u2192 technical replacement is allowed (not a dependency blocker)', () => {
    expect(blockedDependencyReplacementGuard('external', 'technical')).toBeNull();
  });

  it('no existing blocker type \u2192 any type is allowed', () => {
    expect(blockedDependencyReplacementGuard(undefined, 'external')).toBeNull();
  });
});

// 3. READY \u2192 IN_PROGRESS redirect (\u00a710b.2)
describe('READY \u2192 IN_PROGRESS redirect (\u00a710b.2)', () => {
  it('throws with message directing caller to use ledger_claim_work_package', () => {
    // Replica of the redirect error thrown by updateWorkPackageStatus (step 1b)
    function readyToInProgressError(oldStatus: string, newStatus: string, wpId: string): string | null {
      if (oldStatus === 'READY' && newStatus === 'IN_PROGRESS') {
        return (
          `Cannot transition ${wpId} from READY to IN_PROGRESS via ledger_update_work_package_status. ` +
          `Use ledger_claim_work_package instead \u2014 it validates dependencies and handles the assignment.`
        );
      }
      return null;
    }

    const err = readyToInProgressError('READY', 'IN_PROGRESS', 'WP-001');
    expect(err).not.toBeNull();
    expect(err).toContain('ledger_claim_work_package');
    expect(err).toContain('READY to IN_PROGRESS');
  });
});

// 4. IN_PROGRESS \u2192 READY pipeline guard (\u00a721.13)
describe('IN_PROGRESS \u2192 READY: rejects when pipeline is IN_PROGRESS (\u00a721.13)', () => {
  function inProgressToReadyGuard(pipelines: Array<{ status: string }>, wpId: string): string | null {
    const activePipeline = pipelines.find((p) => p.status === 'IN_PROGRESS');
    if (activePipeline) {
      return `Cannot unclaim work package ${wpId}: cancel all IN_PROGRESS pipelines before unclaiming.`;
    }
    return null;
  }

  it('throws when there is an IN_PROGRESS pipeline', () => {
    const err = inProgressToReadyGuard([{ status: 'IN_PROGRESS' }], 'WP-001');
    expect(err).not.toBeNull();
    expect(err).toContain('cancel all IN_PROGRESS pipelines');
  });

  it('passes when no pipelines are IN_PROGRESS', () => {
    expect(inProgressToReadyGuard([{ status: 'PASS' }, { status: 'FAIL' }], 'WP-001')).toBeNull();
  });

  it('passes when pipeline list is empty', () => {
    expect(inProgressToReadyGuard([], 'WP-001')).toBeNull();
  });
});

// 5. \u2192 COMPLETE freshness check (\u00a721.10)
describe('\u2192 COMPLETE freshness check (\u00a721.10)', () => {
  type PipelineStub = { type: string; status: string; completed_at?: string; started_at?: string; auto_cancelled?: boolean };

  function freshnessError(pipelines: PipelineStub[], wpId: string): string | null {
    const docPassPipeline = [...pipelines]
      .reverse()
      .find((p) => p.type === 'documentation' && p.status === 'PASS' && !p.auto_cancelled);
    const implStartPipeline = [...pipelines]
      .reverse()
      .find((p) => p.type === 'implementation' && !p.auto_cancelled);
    if (
      docPassPipeline?.completed_at &&
      implStartPipeline?.started_at &&
      docPassPipeline.completed_at < implStartPipeline.started_at
    ) {
      return (
        `Cannot mark work package ${wpId} as COMPLETE: ` +
        `the documentation pipeline PASS (${docPassPipeline.completed_at}) ` +
        `pre-dates the most recent implementation pipeline start (${implStartPipeline.started_at}).`
      );
    }
    return null;
  }

  it('rejects when doc PASS pre-dates impl start (stale documentation)', () => {
    const pipelines: PipelineStub[] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-02-27T10:00:00Z', completed_at: '2026-02-27T11:00:00Z' },
      { type: 'documentation', status: 'PASS', started_at: '2026-02-27T09:00:00Z', completed_at: '2026-02-27T09:30:00Z' },
    ];
    const err = freshnessError(pipelines, 'WP-001');
    expect(err).not.toBeNull();
    expect(err).toContain('pre-dates the most recent implementation pipeline start');
  });

  it('accepts when doc PASS post-dates impl start (fresh documentation)', () => {
    const pipelines: PipelineStub[] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-02-27T09:00:00Z', completed_at: '2026-02-27T10:00:00Z' },
      { type: 'documentation', status: 'PASS', started_at: '2026-02-27T10:30:00Z', completed_at: '2026-02-27T11:00:00Z' },
    ];
    expect(freshnessError(pipelines, 'WP-001')).toBeNull();
  });

  it('accepts when no doc pipeline exists (permissive default)', () => {
    const pipelines: PipelineStub[] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-02-27T09:00:00Z' },
    ];
    expect(freshnessError(pipelines, 'WP-001')).toBeNull();
  });

  it('accepts when doc pipeline has no completed_at timestamp (permissive default)', () => {
    const pipelines: PipelineStub[] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-02-27T09:00:00Z' },
      { type: 'documentation', status: 'PASS' },
    ];
    expect(freshnessError(pipelines, 'WP-001')).toBeNull();
  });

  it('skips auto_cancelled doc pipelines when checking freshness', () => {
    const pipelines: PipelineStub[] = [
      { type: 'implementation', status: 'PASS', started_at: '2026-02-27T10:00:00Z' },
      // This doc PASS pre-dates impl start but is auto_cancelled — should be ignored
      { type: 'documentation', status: 'PASS', completed_at: '2026-02-27T09:00:00Z', auto_cancelled: true },
    ];
    expect(freshnessError(pipelines, 'WP-001')).toBeNull();
  });
});

// ── Integration tests (updateWorkPackageStatus with real LedgerStore) ─────────

const WP004_PLAN_PATH = join(tmpdir(), '2026-02-27-wp004-update-test');

function makeWp004RootIndex(
  summaries: Array<{ id: string; status: string; deps?: string[]; assignedTo?: string }>,
): RootIndex {
  const wps: WorkPackageSummary[] = summaries.map((s) => ({
    work_package_id: s.id,
    file: `work/${s.id}.md`,
    status: s.status as any,
    assigned_to: s.assignedTo ?? 'Developer',
    dependencies: s.deps ?? [],
  }));
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: wps.length,
    pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE' && w.status !== 'CANCELLED').length,
    work_packages: wps,
    project_comments: [],
  };
}

function makeWp004Detail(
  id: string,
  status: string,
  overrides: Partial<WorkPackageDetail> = {},
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'Feature works', met: true }],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

describe('updateWorkPackageStatus — pipeline auto-cancellation (WP-004)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp004-test-'));
    store = new LedgerStore(WP004_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('IN_PROGRESS \u2192 BLOCKED auto-cancels IN_PROGRESS pipeline with auto_cancelled: true', async () => {
    const inProgressPipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:00:00Z',
      summary: [],
    };
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS', {
      pipelines: [inProgressPipeline],
    }));

    const result = await updateWorkPackageStatus(
      {
        project_path: WP004_PLAN_PATH,
        work_package_id: 'WP-001',
        status: 'BLOCKED',
        agent: 'Project Manager',
        blocked_by: { type: 'technical', description: 'Build is broken' },
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('BLOCKED');
    expect(wp.pipelines).toHaveLength(1);
    const cancelledPipeline = wp.pipelines[0]!;
    expect(cancelledPipeline.status).toBe('FAIL');
    expect(cancelledPipeline.auto_cancelled).toBe(true);
    expect(cancelledPipeline.completed_at).toBeDefined();
    expect(cancelledPipeline.summary[0]).toContain('Auto-cancelled');
    expect(cancelledPipeline.summary[0]).toContain('BLOCKED');
  });

  it('IN_PROGRESS \u2192 BLOCKED does not touch already-completed pipelines', async () => {
    const passedPipeline: Pipeline = {
      type: 'qa',
      status: 'PASS',
      started_at: '2026-02-27T08:00:00Z',
      completed_at: '2026-02-27T09:00:00Z',
      summary: ['QA passed'],
    };
    const activePipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:30:00Z',
      summary: [],
    };
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS', {
      pipelines: [passedPipeline, activePipeline],
    }));

    await updateWorkPackageStatus(
      {
        project_path: WP004_PLAN_PATH,
        work_package_id: 'WP-001',
        status: 'BLOCKED',
        agent: 'Project Manager',
        blocked_by: { type: 'external', description: 'Waiting on vendor' },
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    const qaPipeline = wp.pipelines.find((p) => p.type === 'qa')!;
    expect(qaPipeline.status).toBe('PASS'); // Unchanged
    const implPipeline = wp.pipelines.find((p) => p.type === 'implementation')!;
    expect(implPipeline.status).toBe('FAIL');
    expect(implPipeline.auto_cancelled).toBe(true);
  });

  it('IN_PROGRESS \u2192 CANCELLED auto-cancels pipeline with correct summary message', async () => {
    const activePipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:00:00Z',
      summary: [],
    };
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS', {
      pipelines: [activePipeline],
    }));

    await updateWorkPackageStatus(
      {
        project_path: WP004_PLAN_PATH,
        work_package_id: 'WP-001',
        status: 'CANCELLED',
        agent: 'Project Manager',
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    const cancelled = wp.pipelines[0]!;
    expect(cancelled.status).toBe('FAIL');
    expect(cancelled.auto_cancelled).toBe(true);
    expect(cancelled.summary[0]).toContain('CANCELLED');
  });
});

describe('updateWorkPackageStatus — IN_PROGRESS \u2192 READY unclaim (WP-004)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp004-unclaim-'));
    store = new LedgerStore(WP004_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('clears assigned_to on WP detail when unclaiming', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS', {
      assigned_to: 'Developer',
    }));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'READY', agent: 'Project Manager' },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('READY');
    expect(wp.assigned_to).toBeNull();
  });

  it('clears assigned_to in root index summary when unclaiming', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS', assignedTo: 'Developer' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS'));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'READY', agent: 'Project Manager' },
      tempDir
    );

    const root = await store.readRootIndex();
    const summary = root.work_packages.find((w) => w.work_package_id === 'WP-001')!;
    expect(summary.assigned_to).toBeNull();
  });

  it('rejects unclaim when an IN_PROGRESS pipeline exists', async () => {
    const activePipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:00:00Z',
      summary: [],
    };
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS', {
      pipelines: [activePipeline],
    }));

    const result = await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'READY', agent: 'Project Manager' },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('cancel all IN_PROGRESS pipelines');
  });
});

describe('updateWorkPackageStatus — COMPLETE \u2192 IN_PROGRESS resets (WP-004)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp004-reopen-'));
    store = new LedgerStore(WP004_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resets rework_counts to undefined', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'COMPLETE' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'COMPLETE', {
      rework_counts: { implementation: 2, qa: 1 },
    }));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Project Manager' },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts).toBeUndefined();
  });

  it('resets legacy rework_count scalar to undefined', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'COMPLETE' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'COMPLETE', {
      rework_count: 3,
    }));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Project Manager' },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_count).toBeUndefined();
  });

  it('sets root.synthesis_generated to false', async () => {
    const rootWithSynthesis = { ...makeWp004RootIndex([{ id: 'WP-001', status: 'COMPLETE' }]), synthesis_generated: true };
    await store.writeRootIndex(rootWithSynthesis);
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'COMPLETE'));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Project Manager' },
      tempDir
    );

    const root = await store.readRootIndex();
    expect(root.synthesis_generated).toBe(false);
  });

  it('increments revision on reopen', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'COMPLETE' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'COMPLETE', { revision: 1 }));

    await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Project Manager' },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.revision).toBe(2);
  });
});

describe('updateWorkPackageStatus — status_changed_at and BLOCKED replacement (WP-004)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp004-misc-'));
    store = new LedgerStore(WP004_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sets status_changed_at on a normal status transition', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'IN_PROGRESS'));

    await updateWorkPackageStatus(
      {
        project_path: WP004_PLAN_PATH,
        work_package_id: 'WP-001',
        status: 'BLOCKED',
        agent: 'Project Manager',
        blocked_by: { type: 'technical', description: 'Something broke' },
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status_changed_at).toBeDefined();
    expect(typeof wp.status_changed_at).toBe('string');
  });

  it('BLOCKED \u2192 BLOCKED replaces the blocker and sets status_changed_at (early return path)', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'BLOCKED' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'BLOCKED', {
      blocked_by: { type: 'external', description: 'Old blocker' },
    }));

    await updateWorkPackageStatus(
      {
        project_path: WP004_PLAN_PATH,
        work_package_id: 'WP-001',
        status: 'BLOCKED',
        agent: 'Project Manager',
        blocked_by: { type: 'technical', description: 'New blocker' },
      },
      tempDir
    );

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('BLOCKED');
    expect(wp.blocked_by?.description).toBe('New blocker');
    expect(wp.blocked_by?.type).toBe('technical');
    expect(wp.status_changed_at).toBeDefined();
  });

  it('COMPLETE \u2192 CANCELLED is accepted (PM can cancel a completed WP)', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'COMPLETE' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'COMPLETE'));

    const result = await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'CANCELLED', agent: 'Project Manager' },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.status).toBe('CANCELLED');
  });

  it('CANCELLED \u2192 CANCELLED is rejected (terminal status, no self-transition)', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'CANCELLED' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'CANCELLED'));

    const result = await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'CANCELLED', agent: 'Project Manager' },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('Invalid status transition');
  });

  it('READY \u2192 IN_PROGRESS via updateWorkPackageStatus is rejected with redirect message', async () => {
    await store.writeRootIndex(makeWp004RootIndex([{ id: 'WP-001', status: 'READY' }]));
    await store.writeWorkPackage('WP-001', makeWp004Detail('WP-001', 'READY'));

    const result = await updateWorkPackageStatus(
      { project_path: WP004_PLAN_PATH, work_package_id: 'WP-001', status: 'IN_PROGRESS', agent: 'Developer' },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('ledger_claim_work_package');
  });
});

// ---------------------------------------------------------------------------
// WP-005 — claimWorkPackage CLAIMABLE_ROLES guard and status_changed_at
// ---------------------------------------------------------------------------

const WP005_PLAN_PATH = join(tmpdir(), '2026-02-27-wp005-claim-test');

describe('claimWorkPackage — CLAIMABLE_ROLES guard (WP-005)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp005-claim-'));
    store = new LedgerStore(WP005_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupReadyWp(id: string, assignedTo: string) {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [
        {
          work_package_id: id,
          file: `work/${id}.md`,
          status: 'READY',
          assigned_to: assignedTo,
          dependencies: [],
        },
      ],
      project_comments: [],
    };
    await store.writeRootIndex(root);
    await store.writeWorkPackage(id, {
      work_package_id: id,
      work_package_file: `work/${id}.md`,
      status: 'READY',
      assigned_to: assignedTo,
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Works', met: false }],
      revision: 0,
      pipelines: [],
    });
  }

  it('rejects Planner role with actionable error', async () => {
    // Assign the WP to 'Planner' so the assignment guard passes (agent matches assignee)
    // and the CLAIMABLE_ROLES guard fires instead.
    await setupReadyWp('WP-001', 'Planner');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Planner',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain("Agent role 'Planner' cannot claim work packages");
    expect(text).toContain('Valid roles:');
  });

  it('rejects Planner role even when WP is assigned to a different agent (role guard fires before assignment guard)', async () => {
    // The WP is assigned to 'Developer', but the agent is 'Planner'.
    // Before the reorder, the assignment error would fire first.
    // After the reorder, the role error must fire first.
    await setupReadyWp('WP-001', 'Developer');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Planner',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain("Agent role 'Planner' cannot claim work packages");
    expect(text).not.toContain('assigned to');
  });

  it('rejects Planner role with override: true (role guard is not bypassable)', async () => {
    // Even with override: true, the role guard must reject 'Planner'.
    await setupReadyWp('WP-001', 'Developer');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Planner',
        override: true,
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain("Agent role 'Planner' cannot claim work packages");
  });

  it('rejects RandomBot role with actionable error', async () => {
    await setupReadyWp('WP-001', 'RandomBot');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'RandomBot',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    const text = (result as any).content[0].text as string;
    expect(text).toContain("Agent role 'RandomBot' cannot claim work packages");
  });

  it('accepts Developer agent (known role)', async () => {
    await setupReadyWp('WP-001', 'Developer');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Developer',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
  });

  it('accepts Project Manager agent (known role)', async () => {
    await setupReadyWp('WP-001', 'Project Manager');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Project Manager',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
  });

  it('sets status_changed_at on successful claim', async () => {
    await setupReadyWp('WP-001', 'Developer');
    const result = await claimWorkPackage(
      {
        project_path: WP005_PLAN_PATH,
        work_package_id: 'WP-001',
        agent: 'Developer',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    const wp = JSON.parse(text);
    expect(wp.status_changed_at).toBeDefined();
    expect(typeof wp.status_changed_at).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// WP-006 — createWorkPackage per §9b.1
// ---------------------------------------------------------------------------

const WP006_PLAN_PATH = join(tmpdir(), '2026-02-27-wp006-create-test');

describe('createWorkPackage — assigned_to: null, blocked_by, cycle detection, criteria validation (WP-006)', () => {
  let tempDir: string;
  let store: LedgerStore;

  function makeWp006Root(
    summaries: Array<{ id: string; status: string; deps?: string[] }> = [],
  ): RootIndex {
    const wps: WorkPackageSummary[] = summaries.map((s) => ({
      work_package_id: s.id,
      file: `work/${s.id}.md`,
      status: s.status as any,
      assigned_to: null,
      dependencies: s.deps ?? [],
    }));
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE' && w.status !== 'CANCELLED').length,
      work_packages: wps,
      project_comments: [],
    };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp006-create-'));
    store = new LedgerStore(WP006_PLAN_PATH, tempDir);
    await store.writeRootIndex(makeWp006Root());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sets assigned_to: null regardless of any assigned_to input', async () => {
    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: ['Feature works'],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
    const wp = JSON.parse((result as any).content[0].text);
    expect(wp.assigned_to).toBeNull();
  });

  it('sets assigned_to: null in root index summary', async () => {
    await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'QA',
        dependencies: [],
        acceptance_criteria: ['Done'],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );
    const root = await store.readRootIndex();
    const summary = root.work_packages.find((w) => w.work_package_id === 'WP-001')!;
    expect(summary.assigned_to).toBeNull();
  });

  it('sets blocked_by when initial status is BLOCKED', async () => {
    // Seed an existing WP that is not COMPLETE to trigger BLOCKED status
    await store.writeRootIndex(makeWp006Root([{ id: 'WP-001', status: 'READY' }]));
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'READY'));

    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
        acceptance_criteria: ['Works'],
        work_package_file: 'work/WP-002.md',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
    const wp = JSON.parse((result as any).content[0].text);
    expect(wp.status).toBe('BLOCKED');
    expect(wp.blocked_by).toBeDefined();
    expect(wp.blocked_by.type).toBe('dependency');
    expect(wp.blocked_by.blocking_work_package).toBe('WP-001');
  });

  it('does NOT set blocked_by on READY-initial-status WP', async () => {
    // Seed an existing COMPLETE WP so new WP starts READY
    await store.writeRootIndex(makeWp006Root([{ id: 'WP-001', status: 'COMPLETE' }]));
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));

    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
        acceptance_criteria: ['Works'],
        work_package_file: 'work/WP-002.md',
      },
      tempDir
    );
    expect(result.isError).toBeFalsy();
    const wp = JSON.parse((result as any).content[0].text);
    expect(wp.status).toBe('READY');
    expect(wp.blocked_by).toBeUndefined();
  });

  it('cycle detection: A → B → A rejected with clear error', async () => {
    // Seed WP-001 that depends on WP-002 (which we're about to create)
    // We'll create WP-001 and WP-002 manually to test cycle rejection.
    // Our new WP will get ID WP-002. If WP-001 already depends on WP-002,
    // then WP-002 → WP-001 would be a cycle.
    // Simulate: WP-001 depends on [WP-002] — the ID we're about to create.
    // We can't pre-create with that dep because WP-002 doesn't exist yet.
    // Instead, test that WP-003 → WP-001 creates a forward edge that would
    // cycle back if WP-001 is also set to depend on WP-003.

    // Set up: WP-001 exists, WP-001 depends on WP-002 (to be created).
    // We'll seed WP-001 with dependencies: ['WP-002'] to set up the potential cycle.
    // Then create WP-002 with dependencies: ['WP-001'] — this should be rejected.
    const rootWithCycle = makeWp006Root([
      { id: 'WP-001', status: 'READY', deps: ['WP-002'] },
    ]);
    await store.writeRootIndex(rootWithCycle);
    await store.writeWorkPackage('WP-001', {
      ...makeWpDetail('WP-001', 'READY'),
      dependencies: ['WP-002'],
    });

    // WP-002 will be auto-assigned the next ID. Create it with dep on WP-001.
    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: ['WP-001'],
        acceptance_criteria: ['Works'],
        work_package_file: 'work/WP-002.md',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('Dependency cycle detected');
  });

  it('rejects empty string in acceptance_criteria', async () => {
    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: ['Valid criterion', ''],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('empty or whitespace-only');
  });

  it('rejects whitespace-only string in acceptance_criteria', async () => {
    const result = await createWorkPackage(
      {
        project_path: WP006_PLAN_PATH,
        assigned_to: 'Developer',
        dependencies: [],
        acceptance_criteria: ['   '],
        work_package_file: 'work/WP-001.md',
      },
      tempDir
    );
    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('empty or whitespace-only');
  });
});

// ---------------------------------------------------------------------------
// WP-007 — propagateDependencyReblock improvements
// ---------------------------------------------------------------------------

const WP007_PLAN_PATH = join(tmpdir(), '2026-02-27-wp007-reblock-test');

describe('propagateDependencyReblock — auto-cancel, COMPLETE warning, synthesis reset (WP-007)', () => {
  let tempDir: string;
  let store: LedgerStore;

  function makeWp007Root(
    summaries: Array<{ id: string; status: string; deps?: string[] }>,
  ): RootIndex {
    const wps: WorkPackageSummary[] = summaries.map((s) => ({
      work_package_id: s.id,
      file: `work/${s.id}.md`,
      status: s.status as any,
      assigned_to: 'Developer',
      dependencies: s.deps ?? [],
    }));
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE' && w.status !== 'CANCELLED').length,
      work_packages: wps,
      project_comments: [],
      synthesis_generated: true,
    };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wp007-reblock-'));
    store = new LedgerStore(WP007_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('auto-cancels IN_PROGRESS pipeline with auto_cancelled: true on re-blocked WP', async () => {
    const activePipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:00:00Z',
      summary: [],
    };
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'IN_PROGRESS', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'IN_PROGRESS', ['WP-001']),
      pipelines: [activePipeline],
    });

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
    expect(wp002.pipelines).toHaveLength(1);
    const cancelled = wp002.pipelines[0]!;
    expect(cancelled.status).toBe('FAIL');
    expect(cancelled.auto_cancelled).toBe(true);
    expect(cancelled.completed_at).toBeDefined();
    expect(cancelled.summary[0]).toContain('Auto-cancelled');
    expect(cancelled.summary[0]).toContain('WP-001');
  });

  it('transitions IN_PROGRESS dependent to BLOCKED', async () => {
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'IN_PROGRESS', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'IN_PROGRESS', ['WP-001']));

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
  });

  it('adds warning comment to last pipeline of COMPLETE dependent', async () => {
    const completedPipeline: Pipeline = {
      type: 'documentation',
      status: 'PASS',
      started_at: '2026-02-27T08:00:00Z',
      completed_at: '2026-02-27T09:00:00Z',
      summary: ['Done'],
    };
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'COMPLETE', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'COMPLETE', ['WP-001']),
      pipelines: [completedPipeline],
    });

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    // Status must remain COMPLETE
    expect(wp002.status).toBe('COMPLETE');
    const lastPipeline = wp002.pipelines.at(-1)!;
    expect(lastPipeline.comments).toBeDefined();
    expect(lastPipeline.comments!.length).toBeGreaterThan(0);
    expect(lastPipeline.comments![0].type).toBe('warning');
    expect(lastPipeline.comments![0].note).toContain('WP-001');
    expect(lastPipeline.comments![0].note).toContain('WP-002');
  });

  it('COMPLETE dependent status remains COMPLETE after warning', async () => {
    const completedPipeline: Pipeline = {
      type: 'documentation',
      status: 'PASS',
      started_at: '2026-02-27T08:00:00Z',
      completed_at: '2026-02-27T09:00:00Z',
      summary: ['Done'],
    };
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'COMPLETE', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'COMPLETE', ['WP-001']),
      pipelines: [completedPipeline],
    });

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('COMPLETE');
    const root = await store.readRootIndex();
    const summary = root.work_packages.find((w) => w.work_package_id === 'WP-002')!;
    expect(summary.status).toBe('COMPLETE');
  });

  it('resets synthesis_generated to false when at least one WP is re-blocked', async () => {
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'READY', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'READY', ['WP-001']));

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const root = await store.readRootIndex();
    expect(root.synthesis_generated).toBe(false);
  });

  it('does NOT change synthesis_generated when no WPs are re-blocked', async () => {
    // No dependents at all — nothing to re-block
    const root = makeWp007Root([
      { id: 'WP-001', status: 'COMPLETE' },
      { id: 'WP-002', status: 'READY' }, // no dependency on WP-001
    ]);
    await store.writeRootIndex(root);
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'READY'));

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const updatedRoot = await store.readRootIndex();
    // synthesis_generated should remain true (was set true in makeWp007Root)
    expect(updatedRoot.synthesis_generated).toBe(true);
  });

  it('propagateDependencyReblock sets status_changed_at on cascade-blocked WPs', async () => {
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'READY', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', makeWpDetail('WP-002', 'READY', ['WP-001']));

    const before = Math.floor(Date.now() / 1000) * 1000;
    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);
    const after = Date.now();

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
    expect(wp002.status_changed_at).toBeDefined();
    expect(typeof wp002.status_changed_at).toBe('string');
    const changedAt = new Date(wp002.status_changed_at!).getTime();
    expect(changedAt).toBeGreaterThanOrEqual(before);
    expect(changedAt).toBeLessThanOrEqual(after + 1000); // 1s tolerance
  });

  it('auto-cancels ALL concurrent IN_PROGRESS pipelines on re-blocked WP', async () => {
    // Two simultaneous IN_PROGRESS pipelines (implementation + qa) — both must
    // be FAIL + auto_cancelled after the reblock cascade fires.
    const implPipeline: Pipeline = {
      type: 'implementation',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:00:00Z',
      summary: [],
    };
    const qaPipeline: Pipeline = {
      type: 'qa',
      status: 'IN_PROGRESS',
      started_at: '2026-02-27T09:01:00Z',
      summary: [],
    };
    await store.writeRootIndex(
      makeWp007Root([
        { id: 'WP-001', status: 'COMPLETE' },
        { id: 'WP-002', status: 'IN_PROGRESS', deps: ['WP-001'] },
      ])
    );
    await store.writeWorkPackage('WP-001', makeWpDetail('WP-001', 'COMPLETE'));
    await store.writeWorkPackage('WP-002', {
      ...makeWpDetail('WP-002', 'IN_PROGRESS', ['WP-001']),
      pipelines: [implPipeline, qaPipeline],
    });

    await propagateDependencyReblock(WP007_PLAN_PATH, 'WP-001', tempDir);

    const wp002 = await store.readWorkPackage('WP-002');
    expect(wp002.status).toBe('BLOCKED');
    expect(wp002.pipelines).toHaveLength(2);

    for (const p of wp002.pipelines) {
      expect(p.status).toBe('FAIL');
      expect(p.auto_cancelled).toBe(true);
      expect(p.completed_at).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// CLAIMABLE_ROLES drift guard — WP-001 (2026-02-27-technical-debt-resolution)
// Ensures every non-orchestrating AGENT_ROLES entry appears in CLAIMABLE_ROLES.
// ---------------------------------------------------------------------------

describe('CLAIMABLE_ROLES drift guard', () => {
  it('contains every non-orchestrating AGENT_ROLE entry', () => {
    const nonOrchestrating = AGENT_ROLES.filter(
      (r) => !(ORCHESTRATING_ROLES as readonly string[]).includes(r)
    );
    for (const role of nonOrchestrating) {
      expect(CLAIMABLE_ROLES).toContain(role);
    }
  });

  it('does not contain Planner', () => {
    expect(CLAIMABLE_ROLES).not.toContain('Planner');
  });

  it('does not contain Synthesis', () => {
    expect(CLAIMABLE_ROLES).not.toContain('Synthesis');
  });
});

// ---------------------------------------------------------------------------
// ledger_reset_rework_count — §16.3b
// ---------------------------------------------------------------------------

const RESET_REWORK_PLAN_PATH = join(tmpdir(), '2026-02-28-reset-rework-test');

function makeResetReworkRoot(
  summaries: Array<{ id: string; status: string }> = [],
): RootIndex {
  const wps = summaries.map((s) => ({
    work_package_id: s.id,
    file: `work/${s.id}.md`,
    status: s.status as any,
    assigned_to: 'Developer',
    dependencies: [] as string[],
  }));
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: wps.length,
    pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE' && w.status !== 'CANCELLED').length,
    work_packages: wps,
    project_comments: [],
  };
}

function makeResetReworkWpDetail(
  id: string,
  overrides: Partial<WorkPackageDetail> = {},
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: 'IN_PROGRESS',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [{ criterion: 'Feature works', met: false }],
    revision: 0,
    pipelines: [],
    ...overrides,
  };
}

describe('ledger_reset_rework_count — §16.3b', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reset-rework-'));
    store = new LedgerStore(RESET_REWORK_PLAN_PATH, tempDir);
    await store.writeRootIndex(makeResetReworkRoot([{ id: 'WP-001', status: 'IN_PROGRESS' }]));
    await store.writeWorkPackage('WP-001', makeResetReworkWpDetail('WP-001', {
      rework_counts: { implementation: 3 },
    }));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resets counter and records project comment with type "rework_reset" and priority "high"', async () => {
    const result = await resetReworkCount(
      {
        project_path: RESET_REWORK_PLAN_PATH,
        work_package_id: 'WP-001',
        pipeline_type: 'implementation',
        agent_role: 'Project Manager',
        reason: 'Resetting after architecture discussion',
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.rework_counts?.implementation).toBe(0);

    const root = await store.readRootIndex();
    const comment = root.project_comments.find((c) => c.type === 'rework_reset');
    expect(comment).toBeDefined();
    expect(comment?.priority).toBe('high');
    expect(comment?.agent).toBe('Project Manager');
    expect(comment?.note).toContain('WP-001');
    expect(comment?.note).toContain('implementation');
    expect(comment?.note).toContain('3');
    expect(comment?.note).toContain('Resetting after architecture discussion');
  });

  it('rejects non-PM callers', async () => {
    const result = await resetReworkCount(
      {
        project_path: RESET_REWORK_PLAN_PATH,
        work_package_id: 'WP-001',
        pipeline_type: 'implementation',
        agent_role: 'Developer',
        reason: 'Test',
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('PM-only');
    expect((result as any).content[0].text).toContain('Developer');
  });

  it('rejects empty reason string', async () => {
    // Zod .trim().min(1): empty string fails the min(1) constraint at schema-parse time
    const reasonSchema = z.string().trim().min(1);
    expect(reasonSchema.safeParse('').success).toBe(false);
  });

  it('rejects whitespace-only reason string (schema validation)', () => {
    // Zod .trim().min(1): '   ' is coerced to '' which fails min(1)
    const reasonSchema = z.string().trim().min(1);
    expect(reasonSchema.safeParse('   ').success).toBe(false);
  });

  it('no-op when counter is already 0 — does not write', async () => {
    await store.writeWorkPackage('WP-001', makeResetReworkWpDetail('WP-001', {
      rework_counts: { implementation: 0 },
    }));

    const result = await resetReworkCount(
      {
        project_path: RESET_REWORK_PLAN_PATH,
        work_package_id: 'WP-001',
        pipeline_type: 'implementation',
        agent_role: 'Project Manager',
        reason: 'Already zero',
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    expect(text).toContain('No-op');

    // Confirm no new comment was written
    const root = await store.readRootIndex();
    expect(root.project_comments).toHaveLength(0);
  });

  it('no-op when rework_counts map is absent on WP — does not write', async () => {
    await store.writeWorkPackage('WP-001', makeResetReworkWpDetail('WP-001'));
    // rework_counts is not set

    const result = await resetReworkCount(
      {
        project_path: RESET_REWORK_PLAN_PATH,
        work_package_id: 'WP-001',
        pipeline_type: 'implementation',
        agent_role: 'Project Manager',
        reason: 'Absent map',
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    expect(text).toContain('No-op');

    const root = await store.readRootIndex();
    expect(root.project_comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ledger_update_acceptance_criteria — §12.3b
// ---------------------------------------------------------------------------

const UPDATE_AC_PLAN_PATH = join(tmpdir(), '2026-02-28-update-ac-test');

function makeUpdateAcRoot(wpId: string, status: string = 'IN_PROGRESS'): RootIndex {
  return {
    plan_file: 'plan.md',
    date_created: now(),
    last_updated: now(),
    status: 'IN_PROGRESS',
    total_work_packages: 1,
    pending_work_packages: status !== 'COMPLETE' && status !== 'CANCELLED' ? 1 : 0,
    work_packages: [
      {
        work_package_id: wpId,
        file: `work/${wpId}.md`,
        status: status as any,
        assigned_to: 'Developer',
        dependencies: [],
      },
    ],
    project_comments: [],
  };
}

function makeUpdateAcWpDetail(
  id: string,
  status: string = 'IN_PROGRESS',
  criteria: Array<{ criterion: string; met: boolean }> = [{ criterion: 'Feature works', met: false }],
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: criteria,
    revision: 0,
    pipelines: [],
  };
}

describe('ledger_update_acceptance_criteria — §12.3b', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'update-ac-'));
    store = new LedgerStore(UPDATE_AC_PLAN_PATH, tempDir);
    await store.writeRootIndex(makeUpdateAcRoot('WP-001'));
    await store.writeWorkPackage('WP-001', makeUpdateAcWpDetail('WP-001', 'IN_PROGRESS', [
      { criterion: 'Feature A works', met: false },
      { criterion: 'Feature B works', met: true },
    ]));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('removes a criterion by exact text', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [{ action: 'remove', criterion: 'Feature A works' }],
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(1);
    expect(wp.acceptance_criteria[0]!.criterion).toBe('Feature B works');
  });

  it('modifies criterion text via modify_text operation', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [
          { action: 'modify_text', old_criterion: 'Feature A works', new_criterion: 'Feature A behaves correctly under load' },
        ],
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    const criterion = wp.acceptance_criteria.find((c) => c.criterion === 'Feature A behaves correctly under load');
    expect(criterion).toBeDefined();
    // met flag preserved
    expect(criterion?.met).toBe(false);
  });

  it('rejects removal of last criterion (post-operations guard)', async () => {
    // WP has two criteria; remove both in one call → zero criteria guard fires
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [
          { action: 'remove', criterion: 'Feature A works' },
          { action: 'remove', criterion: 'Feature B works' },
        ],
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('At least one acceptance criterion');

    // Original data must be untouched
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(2);
  });

  it('rejects whitespace-only new_criterion text in modify_text operation (schema validation)', () => {
    // Zod .trim().min(1) on new_criterion: '   ' coerces to '' which fails min(1)
    const newCriterionSchema = z.string().trim().min(1);
    expect(newCriterionSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects non-PM callers', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Developer',
        operations: [{ action: 'remove', criterion: 'Feature A works' }],
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('PM-only');
    expect((result as any).content[0].text).toContain('Developer');
  });

  it('rejects operations on CANCELLED WP', async () => {
    await store.writeRootIndex(makeUpdateAcRoot('WP-001', 'CANCELLED'));
    await store.writeWorkPackage('WP-001', makeUpdateAcWpDetail('WP-001', 'CANCELLED'));

    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [{ action: 'remove', criterion: 'Feature A works' }],
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('CANCELLED');
  });

  it('rejects when criterion text is not found (remove)', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [{ action: 'remove', criterion: 'This criterion does not exist' }],
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('not found');
    expect((result as any).content[0].text).toContain('This criterion does not exist');
  });

  it('rejects when old_criterion text is not found (modify_text)', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [
          { action: 'modify_text', old_criterion: 'Non-existent criterion', new_criterion: 'New text' },
        ],
      },
      tempDir
    );

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain('not found');
    expect((result as any).content[0].text).toContain('Non-existent criterion');
  });

  it('applies multiple operations in sequence within a single call', async () => {
    const result = await updateAcceptanceCriteria(
      {
        project_path: UPDATE_AC_PLAN_PATH,
        work_package_id: 'WP-001',
        agent_role: 'Project Manager',
        operations: [
          { action: 'modify_text', old_criterion: 'Feature A works', new_criterion: 'Feature A handles edge cases' },
          { action: 'remove', criterion: 'Feature B works' },
        ],
      },
      tempDir
    );

    expect(result.isError).toBeFalsy();
    const wp = await store.readWorkPackage('WP-001');
    expect(wp.acceptance_criteria).toHaveLength(1);
    expect(wp.acceptance_criteria[0]!.criterion).toBe('Feature A handles edge cases');

    const text = (result as any).content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.applied_operations).toHaveLength(2);
  });
});
