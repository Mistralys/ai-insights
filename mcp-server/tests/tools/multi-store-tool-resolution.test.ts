/**
 * Integration tests for multi-store handler store resolution (WP-004).
 *
 * Verifies that all fixed MCP tool handlers correctly route to the registered
 * non-default store when multi-store mode is active. Each test creates an
 * isolated two-store context, registers a repository in the secondary store,
 * and asserts that the handler reads/writes data from the secondary store —
 * never from the default store.
 *
 * Cross-cutting assertion: no phantom directory appears in the default store
 * after any handler operation when the repository is registered in the
 * secondary store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setStoreContext } from '../../src/storage/store-context.js';
import { StoreRouter } from '../../src/storage/store-router.js';
import { MultiStoreManager } from '../../src/storage/multi-store-manager.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { now } from '../../src/utils/timestamp.js';
import type { StoresConfig } from '../../src/schema/store-config.js';
import type { RepositoryRegistry } from '../../src/schema/repository-registry.js';
import { _internal as lifecycleInternal } from '../../src/tools/project-lifecycle.js';
import { _internal as wpInternal } from '../../src/tools/work-package.js';
import { _internal as pipelineInternal } from '../../src/tools/pipeline.js';
import { _internal as beginWorkInternal } from '../../src/tools/begin-work.js';
import { _internal as observationsInternal } from '../../src/tools/observations.js';
import { _internal as handoffInternal } from '../../src/tools/workflow-handoff.js';
import { _internal as nextActionInternal } from '../../src/tools/workflow-next-action.js';

const {
  initializeProject,
  completeSynthesis,
} = lifecycleInternal;

const {
  getWorkPackage,
  listWorkPackages,
  createWorkPackage,
  claimWorkPackage,
  updateWorkPackageStatus,
  resetReworkCount,
  reopenCancelledWp,
  updateAcceptanceCriteria,
} = wpInternal;

const {
  startPipeline,
  completePipeline,
  cancelPipeline,
  updatePipelineProgress,
} = pipelineInternal;

const { beginWork } = beginWorkInternal;
const { addObservation, addProjectComment } = observationsInternal;
const { getHandoffStatus } = handoffInternal;
const { getNextAction } = nextActionInternal;

// ─── Constants ────────────────────────────────────────────────────────────────

const REPO_NAME = 'test-repo';
const SLUG = '2026-08-01-tool-resolution-test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(
  stores: Array<{ id: string; path: string; label: string }>
): StoresConfig {
  return {
    stores: stores.map((s) => ({ id: s.id, path: s.path, label: s.label })),
    default_store: stores[0]!.id,
  };
}

async function writeRegistry(storePath: string, repoNames: string[]): Promise<void> {
  const ts = now();
  const registry: RepositoryRegistry = {
    repositories: repoNames.map((name) => ({
      id: name,
      label: name,
      folder_names: [name],
      vision: { short_term: null, mid_term: null, long_term: null },
      created_at: ts,
      last_modified: ts,
    })),
  };
  await saveRegistry(storePath, registry);
}

function restoreLegacyContext(): void {
  const legacyRouter = new StoreRouter(null);
  setStoreContext(legacyRouter, new MultiStoreManager(legacyRouter));
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

// ─── Shared State ─────────────────────────────────────────────────────────────

let tempDir: string;
let storeDefaultPath: string;
let storeSecondaryPath: string;
let planPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'multi-store-tool-'));
  storeDefaultPath = join(tempDir, 'store-default');
  storeSecondaryPath = join(tempDir, 'store-secondary');
  planPath = join(tempDir, REPO_NAME, 'docs', 'agents', 'plans', SLUG);

  await mkdir(storeDefaultPath, { recursive: true });
  await mkdir(storeSecondaryPath, { recursive: true });
  await mkdir(planPath, { recursive: true });
  await writeFile(join(planPath, 'plan.md'), '# Test Plan\n\n## Summary\n\nA test plan for multi-store routing.');
});

afterEach(async () => {
  restoreLegacyContext();
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Context Setup ────────────────────────────────────────────────────────────

function initTwoStoreContext(): void {
  const config = makeConfig([
    { id: 'default', path: storeDefaultPath, label: 'Default' },
    { id: 'secondary', path: storeSecondaryPath, label: 'Secondary' },
  ]);
  const router = new StoreRouter(config);
  setStoreContext(router, new MultiStoreManager(router));
}

/**
 * Initialize a project in the secondary store and add a work package.
 * Returns a WP ID in READY status.
 */
async function setupProjectWithWP(acList: string[] = ['All tasks complete.']): Promise<string> {
  // Register REPO_NAME in secondary store only
  await writeRegistry(storeDefaultPath, []);
  await writeRegistry(storeSecondaryPath, [REPO_NAME]);
  initTwoStoreContext();

  // Initialize project in secondary store
  await initializeProject({ project_path: planPath, plan_file: 'plan.md' });

  // Create a WP
  const wpResult = await createWorkPackage({
    project_path: planPath,
    title: 'Test WP',
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: acList,
    work_package_file: 'work/WP-001.md',
  });
  const wpData = parseResult(wpResult) as { work_package_id: string };
  return wpData.work_package_id;
}

/**
 * Move a WP to IN_PROGRESS state.
 */
async function moveToInProgress(wpId: string): Promise<void> {
  await claimWorkPackage({ project_path: planPath, work_package_id: wpId, agent: 'Developer' });
}

/**
 * Start an implementation pipeline on a WP.
 */
async function addImplementationPipeline(wpId: string): Promise<void> {
  await startPipeline({ project_path: planPath, work_package_id: wpId, type: 'implementation', agent_role: 'Developer' });
}

/** Expected secondary store ledger path for the test project. */
function secondaryLedgerPath(): string {
  return join(storeSecondaryPath, REPO_NAME, SLUG);
}

/** Default store path that must remain empty (no phantom directory). */
function defaultStorePath(): string {
  return join(storeDefaultPath, REPO_NAME);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. getWorkPackage — reads WP from the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('getWorkPackage — resolves to non-default store', () => {
  it('reads the work package from the secondary store', async () => {
    const wpId = await setupProjectWithWP();

    const result = await getWorkPackage({ project_path: planPath, work_package_id: wpId });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { work_package_id: string; title: string };
    expect(wp.work_package_id).toBe(wpId);
    expect(wp.title).toBe('Test WP');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. listWorkPackages — reads from the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('listWorkPackages — resolves to non-default store', () => {
  it('returns the work package created in the secondary store', async () => {
    await setupProjectWithWP();

    const result = await listWorkPackages({ project_path: planPath });

    expect((result as any).isError).toBeFalsy();
    const wps = parseResult(result) as Array<{ title: string }>;
    expect(Array.isArray(wps)).toBe(true);
    expect(wps.some((wp) => wp.title === 'Test WP')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. claimWorkPackage — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('claimWorkPackage — resolves to non-default store', () => {
  it('transitions a WP to IN_PROGRESS in the secondary store', async () => {
    const wpId = await setupProjectWithWP();

    const result = await claimWorkPackage({
      project_path: planPath,
      work_package_id: wpId,
      agent: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { status: string };
    expect(wp.status).toBe('IN_PROGRESS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. updateWorkPackageStatus — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('updateWorkPackageStatus — resolves to non-default store', () => {
  it('cancels a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();

    const result = await updateWorkPackageStatus({
      project_path: planPath,
      work_package_id: wpId,
      status: 'CANCELLED',
      agent: 'Project Manager',
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { status: string };
    expect(wp.status).toBe('CANCELLED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. resetReworkCount — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('resetReworkCount — resolves to non-default store', () => {
  it('resets rework count on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();
    await moveToInProgress(wpId);

    const result = await resetReworkCount({
      project_path: planPath,
      work_package_id: wpId,
      pipeline_type: 'implementation',
      agent_role: 'Project Manager',
      reason: 'Test reset',
    });

    expect((result as any).isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. reopenCancelledWp — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('reopenCancelledWp — resolves to non-default store', () => {
  it('reopens a CANCELLED WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();
    await updateWorkPackageStatus({
      project_path: planPath,
      work_package_id: wpId,
      status: 'CANCELLED',
      agent: 'Project Manager',
    });

    const result = await reopenCancelledWp({
      project_path: planPath,
      work_package_id: wpId,
      agent_role: 'Project Manager',
      reason: 'Reopening for test',
    });

    expect((result as any).isError).toBeFalsy();
    const data = parseResult(result) as { final_status: string };
    expect(data.final_status).toBe('READY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. updateAcceptanceCriteria — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('updateAcceptanceCriteria — resolves to non-default store', () => {
  it('modifies AC text on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP(['Original criterion text.']);

    const result = await updateAcceptanceCriteria({
      project_path: planPath,
      work_package_id: wpId,
      agent_role: 'Project Manager',
      operations: [
        {
          action: 'modify_text',
          old_criterion: 'Original criterion text.',
          new_criterion: 'Updated criterion text.',
        },
      ],
    });

    expect((result as any).isError).toBeFalsy();
    const data = parseResult(result) as { applied_operations: Array<unknown> };
    expect(data.applied_operations.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. beginWork — atomically claims WP and starts pipeline in correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('beginWork — resolves to non-default store', () => {
  it('claims and starts a pipeline on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();

    const result = await beginWork({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();
    const data = parseResult(result) as { claimed: boolean; status: string };
    expect(data.claimed).toBe(true);
    expect(data.status).toBe('IN_PROGRESS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. startPipeline — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('startPipeline — resolves to non-default store', () => {
  it('starts an implementation pipeline on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();
    await moveToInProgress(wpId);

    const result = await startPipeline({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      agent_role: 'Developer',
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { pipelines: Array<{ type: string; status: string }> };
    const impl = wp.pipelines.find((p) => p.type === 'implementation');
    expect(impl?.status).toBe('IN_PROGRESS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. completePipeline — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('completePipeline — resolves to non-default store', () => {
  it('completes an implementation pipeline on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP(['All tasks complete.']);
    await moveToInProgress(wpId);
    await addImplementationPipeline(wpId);

    const result = await completePipeline({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      agent_role: 'Developer',
      status: 'PASS',
      summary: 'Implementation done.',
      acceptance_criteria_updates: [{ criterion: 'All tasks complete.', met: true }],
      comments: [{ type: 'improvement', priority: 'low', note: 'No observations.' }],
    });

    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content[0].text;
    expect(text).toContain('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. cancelPipeline — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelPipeline — resolves to non-default store', () => {
  it('cancels an implementation pipeline on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();
    await moveToInProgress(wpId);
    await addImplementationPipeline(wpId);

    const result = await cancelPipeline({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      reason: 'Cancelled for test.',
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { pipelines: Array<{ type: string; status: string }> };
    const impl = wp.pipelines.find((p) => p.type === 'implementation');
    expect(impl?.status).toBe('FAIL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. updatePipelineProgress — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('updatePipelineProgress — resolves to non-default store', () => {
  it('updates pipeline summary on a WP in the secondary store', async () => {
    const wpId = await setupProjectWithWP();
    await moveToInProgress(wpId);
    await addImplementationPipeline(wpId);

    const result = await updatePipelineProgress({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      summary: ['Progress: step 1 done.'],
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { pipelines: Array<{ type: string; summary: string[] }> };
    const impl = wp.pipelines.find((p) => p.type === 'implementation');
    expect(impl?.summary).toContain('Progress: step 1 done.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. addObservation — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('addObservation — resolves to non-default store', () => {
  it('adds an observation to a pipeline in the secondary store', async () => {
    const wpId = await setupProjectWithWP(['All tasks complete.']);
    await moveToInProgress(wpId);
    await addImplementationPipeline(wpId);

    // Complete pipeline first so addObservation can reference it
    await completePipeline({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      agent_role: 'Developer',
      status: 'PASS',
      summary: 'Done.',
      acceptance_criteria_updates: [{ criterion: 'All tasks complete.', met: true }],
      comments: [{ type: 'improvement', priority: 'low', note: 'Clean.' }],
    });

    const result = await addObservation({
      project_path: planPath,
      work_package_id: wpId,
      pipeline_type: 'implementation',
      type: 'refactor',
      priority: 'low',
      note: 'Secondary-store observation.',
    });

    expect((result as any).isError).toBeFalsy();
    const wp = parseResult(result) as { pipelines: Array<{ type: string; comments?: Array<{ note: string }> }> };
    const impl = wp.pipelines.find((p) => p.type === 'implementation');
    const obs = impl?.comments?.find((c) => c.note === 'Secondary-store observation.');
    expect(obs).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. addProjectComment — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('addProjectComment — resolves to non-default store', () => {
  it('adds a project-level comment in the secondary store', async () => {
    await setupProjectWithWP();

    const result = await addProjectComment({
      project_path: planPath,
      type: 'note',
      priority: 'low',
      agent: 'Developer',
      note: 'A note for the secondary-store project.',
    });

    expect((result as any).isError).toBeFalsy();
    const root = parseResult(result) as { project_comments?: Array<{ note: string }> };
    const comment = root.project_comments?.find((c) => c.note === 'A note for the secondary-store project.');
    expect(comment).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. getHandoffStatus — reads from the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('getHandoffStatus — resolves to non-default store', () => {
  it('returns handoff status based on project state in the secondary store', async () => {
    await setupProjectWithWP();

    const result = await getHandoffStatus({
      project_path: planPath,
      current_agent: 'Developer',
    });

    // Should not error — it read from the correct secondary store
    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    // The result should mention "Developer" (or agent information from the real project)
    expect(text).toContain('Developer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. getNextAction — reads from the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('getNextAction — resolves to non-default store', () => {
  it('returns next action based on project state in the secondary store', async () => {
    await setupProjectWithWP();

    const result = await getNextAction({
      project_path: planPath,
      agent_role: 'Developer',
    });

    // Should not error — it read from the correct secondary store
    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    // IMPLEMENT or CLAIM_WP action expected
    expect(text).toMatch(/IMPLEMENT|CLAIM_WP/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. completeSynthesis — writes to the correct store
// ─────────────────────────────────────────────────────────────────────────────

describe('completeSynthesis — resolves to non-default store', () => {
  it('marks synthesis as generated in the secondary store', async () => {
    const wpId = await setupProjectWithWP(['All tasks complete.']);

    // Cancel the WP so it is in a terminal state (allows completeSynthesis to proceed)
    await updateWorkPackageStatus({
      project_path: planPath,
      work_package_id: wpId,
      status: 'CANCELLED',
      agent: 'Project Manager',
    });

    // Write a synthesis.md so the archive step has a file to copy
    await writeFile(join(planPath, 'synthesis.md'), '# Synthesis\n\nAll done.');

    const result = await completeSynthesis({
      agent_role: 'Synthesis',
      synthesis_file: 'synthesis.md',
      outcome_summary: 'All handlers verified against the secondary store.',
      project_path: planPath,
    });

    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content[0].text as string;
    expect(text).toContain('synthesis_generated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting: no phantom directory in the default store
// ─────────────────────────────────────────────────────────────────────────────

describe('Phantom directory assertion — default store remains clean', () => {
  it('creates no repo directory under the default store after all handler operations', async () => {
    const wpId = await setupProjectWithWP(['Done.']);
    await moveToInProgress(wpId);
    await addImplementationPipeline(wpId);

    // Exercise a mix of read and write handlers
    await getWorkPackage({ project_path: planPath, work_package_id: wpId });
    await listWorkPackages({ project_path: planPath });
    await updatePipelineProgress({
      project_path: planPath,
      work_package_id: wpId,
      type: 'implementation',
      summary: ['phantom-check step'],
    });
    await addProjectComment({
      project_path: planPath,
      type: 'note',
      priority: 'low',
      agent: 'Developer',
      note: 'Phantom check note.',
    });
    await getHandoffStatus({ project_path: planPath, current_agent: 'Developer' });
    await getNextAction({ project_path: planPath, agent_role: 'Developer' });

    // No directory for REPO_NAME must exist under the default store
    expect(existsSync(defaultStorePath())).toBe(false);

    // The ledger MUST exist in the secondary store
    expect(existsSync(secondaryLedgerPath())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createWorkPackage — write routing in multi-store mode
// ─────────────────────────────────────────────────────────────────────────────

describe('createWorkPackage — write routing (multi-store mode)', () => {
  it('rejects with a user-friendly error when repo is not registered in any store', async () => {
    // Set up two stores but deliberately leave REPO_NAME unregistered in both
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, []);
    initTwoStoreContext();

    const result = await createWorkPackage({
      project_path: planPath,
      title: 'Unregistered WP',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: ['Test passes.'],
      work_package_file: 'work/WP-001.md',
    });

    expect((result as any).isError).toBe(true);
    expect(result.content[0]!.text).toContain('not registered in any store');
    expect(result.content[0]!.text).toContain(REPO_NAME);
  });

  it('succeeds when repo is registered in the secondary store (AC-03, AC-04)', async () => {
    // REPO_NAME registered only in the secondary store
    await writeRegistry(storeDefaultPath, []);
    await writeRegistry(storeSecondaryPath, [REPO_NAME]);
    initTwoStoreContext();

    // Initialize a project so createWorkPackage has a ledger to write to
    await initializeProject({ project_path: planPath, plan_file: 'plan.md' });

    const result = await createWorkPackage({
      project_path: planPath,
      title: 'Routed WP',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: ['All done.'],
      work_package_file: 'work/WP-001.md',
    });

    expect((result as any).isError).toBeFalsy();
    const wpData = parseResult(result) as { work_package_id: string };
    expect(wpData.work_package_id).toBe('WP-001');

    // WP must be in secondary store, not default store
    expect(existsSync(join(storeSecondaryPath, REPO_NAME, SLUG))).toBe(true);
    expect(existsSync(defaultStorePath())).toBe(false);
  });

  it('works in single-store / legacy mode via test-override path (AC-04)', async () => {
    // Initialize the project in multi-store mode so the ledger dir exists in storeSecondaryPath
    const wpId = await setupProjectWithWP(['First WP done.']);

    // Switch to legacy mode: no store context
    restoreLegacyContext();

    // createWorkPackage should still work when _ledgerRoot is supplied directly
    const result = await createWorkPackage(
      {
        project_path: planPath,
        title: 'Legacy WP',
        assigned_to: 'Developer',
        dependencies: [wpId],
        acceptance_criteria: ['Test passes.'],
        work_package_file: 'work/WP-002.md',
      },
      storeSecondaryPath,
    );

    expect((result as any).isError).toBeFalsy();
    const wpData = parseResult(result) as { work_package_id: string };
    expect(wpData.work_package_id).toBe('WP-002');
  });
});
