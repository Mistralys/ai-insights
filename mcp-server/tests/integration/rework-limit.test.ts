/**
 * Tool-driven rework-limit integration test.
 *
 * Walks a work package to the rework limit using only real tool handlers
 * (no seeded counters), proves the refused start persists the trip, checks the
 * limit actions for Developer / QA / PM, then cancels the limited WP and runs the
 * project through to synthesis. A second describe covers a legacy verifier-only
 * chain, which can only be seeded through the store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { _internal as beginWorkInternal } from '../../src/tools/begin-work.js';
import { _internal as pipelineInternal } from '../../src/tools/pipeline.js';
import { _internal as wpInternal } from '../../src/tools/work-package.js';
import { _internal as nextActionInternal } from '../../src/tools/workflow-next-action.js';
import { _internal as lifecycleInternal } from '../../src/tools/project-lifecycle.js';
import { SYNTHESIS_ARCHIVE_FILENAME } from '../../src/utils/constants.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-rework-limit-test');

// ─── Argument types derived from the real tool handlers ────────────────────
// (rather than hand-maintained duplicates) so a schema change here surfaces
// as a type error in this test instead of silently drifting.
type BeginWorkArgs = Parameters<typeof beginWorkInternal.beginWork>[0];
type CompletePipelineArgs = Parameters<typeof pipelineInternal.completePipeline>[0];
type CompleteSynthesisArgs = Parameters<typeof lifecycleInternal.completeSynthesis>[0];
type PipelineTypeArg = BeginWorkArgs['type'];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function json(result: ToolResult): any {
  return JSON.parse(result.content[0].text);
}

function emptyRoot(): RootIndex {
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

/**
 * Registers beforeEach/afterEach hooks that create a temporary ledger root
 * (named via `mkdtemp(prefix)`), inject it into `process.argv` for the
 * duration of each test, and construct a LedgerStore against PLAN_PATH.
 * Must be called synchronously inside a `describe()` body (vitest requires
 * beforeEach/afterEach registration at describe-callback time).
 *
 * Returns a holder object whose `tempDir`/`store` fields are populated
 * before each test runs and read by the test body and any helpers closing
 * over it.
 */
function useTempLedger(prefix: string): { tempDir: string; store: LedgerStore } {
  const ledger = {} as { tempDir: string; store: LedgerStore };
  let originalArgv: string[];

  beforeEach(async () => {
    ledger.tempDir = await mkdtemp(join(tmpdir(), prefix));
    ledger.store = new LedgerStore(PLAN_PATH, ledger.tempDir);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', ledger.tempDir);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(ledger.tempDir, { recursive: true, force: true });
  });

  return ledger;
}

describe('Rework limit — tool-driven walk', () => {
  const ledger = useTempLedger('rework-limit-');

  const nextAction = async (role: string) =>
    json(await nextActionInternal.getNextAction({ project_path: PLAN_PATH, agent_role: role }) as ToolResult);

  const begin = (id: string, type: PipelineTypeArg, role: string) =>
    beginWorkInternal.beginWork({
      project_path: PLAN_PATH,
      work_package_id: id,
      type,
      agent_role: role,
    }) as Promise<ToolResult>;

  const complete = (
    id: string,
    type: PipelineTypeArg,
    role: string,
    status: 'PASS' | 'FAIL',
    extra: Partial<CompletePipelineArgs> = {},
  ) =>
    pipelineInternal.completePipeline({
      project_path: PLAN_PATH,
      work_package_id: id,
      type,
      agent_role: role,
      status,
      summary: [`${type} ${status}`],
      ...(type === 'implementation' ? { artifacts: { files_modified: ['src/x.ts'] } } : {}),
      ...extra,
    } satisfies CompletePipelineArgs) as Promise<ToolResult>;

  async function createWp(stages: string[], dependencies: string[]): Promise<void> {
    const result = (await wpInternal.createWorkPackage(
      {
        project_path: PLAN_PATH,
        assigned_to: 'Developer',
        dependencies,
        title: 'WP',
        description: 'Rework limit walk.',
        acceptance_criteria: ['Works'],
        active_pipeline_stages: stages,
      },
      ledger.tempDir,
    )) as ToolResult;
    expect(result.isError).toBeFalsy();
  }

  it('persists the trip on the refused fifth start, surfaces limit actions, and reaches synthesis after a PM cancel', async () => {
    await ledger.store.writeRootIndex(emptyRoot());
    await createWp(['implementation', 'qa'], []);
    await createWp(['implementation'], ['WP-001']);

    // The first start is not a rework, so MAX_REWORK_COUNT full PASS / FAIL cycles leave the counter
    // at MAX_REWORK_COUNT - 1; the next start is the one that trips the breaker.
    for (let cycle = 0; cycle < MAX_REWORK_COUNT; cycle++) {
      const started = await begin('WP-001', 'implementation', 'Developer');
      expect(started.isError, started.content[0].text).toBeFalsy();
      const impl = await complete('WP-001', 'implementation', 'Developer', 'PASS');
      expect(impl.isError, impl.content[0].text).toBeFalsy();
      const qaStarted = await begin('WP-001', 'qa', 'QA');
      expect(qaStarted.isError, qaStarted.content[0].text).toBeFalsy();
      const qa = await complete('WP-001', 'qa', 'QA', 'FAIL');
      expect(qa.isError, qa.content[0].text).toBeFalsy();
    }

    expect((await ledger.store.readWorkPackage('WP-001')).rework_counts?.implementation).toBe(MAX_REWORK_COUNT - 1);

    // The next implementation start is refused, and the refusal is persisted.
    const refused = await begin('WP-001', 'implementation', 'Developer');
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/Rework circuit breaker/);
    expect((await ledger.store.readWorkPackage('WP-001')).rework_counts?.implementation).toBe(MAX_REWORK_COUNT);

    const dev = await nextAction('Developer');
    expect(dev.action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect(dev.work_package_id).toBe('WP-001');

    const qa = await nextAction('QA');
    expect(qa.action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');

    const pm = await nextAction('Project Manager');
    expect(pm.action).toBe('REVIEW_REWORK_LIMIT');
    expect(pm.work_package_id).toBe('WP-001');
    expect(pm.pipeline_type).toBe('implementation');
    expect(pm.rework_count).toBe(MAX_REWORK_COUNT);
    expect(pm.max_rework_count).toBe(MAX_REWORK_COUNT);

    // PM cancels the limited WP; the dependent becomes READY.
    const cancelled = (await wpInternal.updateWorkPackageStatus(
      { project_path: PLAN_PATH, work_package_id: 'WP-001', status: 'CANCELLED', agent: 'Project Manager' },
      ledger.tempDir,
    )) as ToolResult;
    expect(cancelled.isError, cancelled.content[0].text).toBeFalsy();
    expect((await ledger.store.readWorkPackage('WP-002')).status).toBe('READY');

    // WP-002 runs to completion.
    expect((await begin('WP-002', 'implementation', 'Developer')).isError).toBeFalsy();
    const done = await complete('WP-002', 'implementation', 'Developer', 'PASS', {
      acceptance_criteria_updates: [{ criterion: 'Works', met: true }],
    });
    expect(done.isError, done.content[0].text).toBeFalsy();
    const completed = (await wpInternal.updateWorkPackageStatus(
      { project_path: PLAN_PATH, work_package_id: 'WP-002', status: 'COMPLETE', agent: 'Documentation' },
      ledger.tempDir,
    )) as ToolResult;
    expect(completed.isError, completed.content[0].text).toBeFalsy();

    const synthesisArgs: CompleteSynthesisArgs = {
      project_path: PLAN_PATH,
      agent_role: 'Synthesis',
      // Required by CompleteSynthesisSchema (min 10 chars); not asserted on below —
      // only isError and the resulting root status are checked.
      outcome_summary: 'Rework limit walk reached synthesis after a PM cancellation of WP-001.',
      // z.infer<CompleteSynthesisSchema> is the post-default (zod-output) type, so
      // TS requires this even though the real MCP call path (through .parse())
      // fills it from z.string().optional().default(...) — calling _internal
      // directly bypasses that parse step, so the value is supplied explicitly here.
      synthesis_file: SYNTHESIS_ARCHIVE_FILENAME,
    };
    const synthesis = (await lifecycleInternal.completeSynthesis(
      synthesisArgs,
      ledger.tempDir,
    )) as ToolResult;
    expect(synthesis.isError, synthesis.content[0].text).toBeFalsy();
    expect((await ledger.store.readRootIndex()).status).toBe('COMPLETE');
  });
});

describe('Rework limit — legacy verifier-only chain', () => {
  const ledger = useTempLedger('rework-limit-legacy-');

  it('persists rework_counts.qa at the limit and routes QA / Reviewer / PM limit actions', async () => {
    // createWorkPackage rejects verifier-only chains, so seed through the store.
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Works', met: false }],
      revision: 0,
      pipelines: [],
      active_pipeline_stages: ['qa', 'code-review'],
    };
    const root = emptyRoot();
    root.status = 'IN_PROGRESS';
    root.total_work_packages = 1;
    root.pending_work_packages = 1;
    root.work_packages = [
      { work_package_id: 'WP-001', file: 'work/WP-001.md', status: 'IN_PROGRESS', assigned_to: 'QA', dependencies: [] },
    ];
    await ledger.store.writeRootIndex(root);
    await ledger.store.writeWorkPackage('WP-001', wp);

    const begin = () =>
      beginWorkInternal.beginWork({
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        type: 'qa',
        agent_role: 'QA',
      }) as Promise<ToolResult>;

    // MAX_REWORK_COUNT QA FAIL / begin_work(qa) cycles: the first start is not a rework, each later start is.
    for (let cycle = 0; cycle < MAX_REWORK_COUNT; cycle++) {
      const started = await begin();
      expect(started.isError, started.content[0].text).toBeFalsy();
      const failed = (await pipelineInternal.completePipeline({
        project_path: PLAN_PATH,
        work_package_id: 'WP-001',
        type: 'qa',
        agent_role: 'QA',
        status: 'FAIL',
        summary: ['qa FAIL'],
      } satisfies CompletePipelineArgs)) as ToolResult;
      expect(failed.isError, failed.content[0].text).toBeFalsy();
    }
    expect((await ledger.store.readWorkPackage('WP-001')).rework_counts?.qa).toBe(MAX_REWORK_COUNT - 1);

    const refused = await begin();
    expect(refused.isError).toBe(true);
    expect((await ledger.store.readWorkPackage('WP-001')).rework_counts?.qa).toBe(MAX_REWORK_COUNT);

    const action = async (role: string) =>
      json((await nextActionInternal.getNextAction({ project_path: PLAN_PATH, agent_role: role })) as ToolResult);

    expect((await action('QA')).action).toBe('BLOCK_FOR_REWORK_LIMIT');
    expect((await action('Reviewer')).action).toBe('WAIT_FOR_UPSTREAM_REWORK_LIMIT');
    const pm = await action('Project Manager');
    expect(pm.action).toBe('REVIEW_REWORK_LIMIT');
    expect(pm.pipeline_type).toBe('qa');
  });
});
