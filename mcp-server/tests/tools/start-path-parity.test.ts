/**
 * Parity suite: `ledger_start_pipeline` and `ledger_begin_work` maintain two
 * copies of the start-guard chain. Each scenario runs once through each tool
 * on an identical IN_PROGRESS WP and asserts the same outcome (`isError`) and
 * the same persisted `rework_counts`, so the copies cannot silently drift.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import { MAX_REWORK_COUNT } from '../../src/utils/workflow-helpers.js';
import { _internal as pipelineInternal } from '../../src/tools/pipeline.js';
import { _internal as beginWorkInternal } from '../../src/tools/begin-work.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-start-path-parity-test');

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:01:00.000Z';

function pl(
  type: string,
  status: 'PASS' | 'FAIL',
  at: string,
  autoCancelled = false,
): Pipeline {
  return {
    type: type as any,
    status,
    started_at: at,
    completed_at: at,
    summary: [],
    ...(autoCancelled ? { auto_cancelled: true } : {}),
  };
}

function makeRootIndex(): RootIndex {
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
  };
}

interface Scenario {
  name: string;
  type: 'implementation' | 'qa';
  agent_role: 'Developer' | 'QA';
  pipelines: Pipeline[];
  reworkCount?: number;
  expectError: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'auto-cancelled prerequisite FAIL is ignored',
    type: 'qa',
    agent_role: 'QA',
    pipelines: [pl('implementation', 'PASS', T0), pl('implementation', 'FAIL', T1, true)],
    expectError: false,
  },
  {
    name: 'genuine FAIL prerequisite is rejected',
    type: 'qa',
    agent_role: 'QA',
    pipelines: [pl('implementation', 'PASS', T0), pl('implementation', 'FAIL', T1)],
    expectError: true,
  },
  {
    name: 'auto-cancelled same-type run is not counted as rework',
    type: 'implementation',
    agent_role: 'Developer',
    pipelines: [pl('implementation', 'FAIL', T0, true)],
    expectError: false,
  },
  {
    name: 'rework trip at MAX-1 is refused and persisted',
    type: 'implementation',
    agent_role: 'Developer',
    pipelines: [pl('implementation', 'FAIL', T0)],
    reworkCount: MAX_REWORK_COUNT - 1,
    expectError: true,
  },
  {
    name: 'WP already at MAX is refused',
    type: 'implementation',
    agent_role: 'Developer',
    pipelines: [pl('implementation', 'FAIL', T0)],
    reworkCount: MAX_REWORK_COUNT,
    expectError: true,
  },
];

type Tool = 'startPipeline' | 'beginWork';

describe('start-path parity: startPipeline vs beginWork', () => {
  let tempLedgerRoot: string;
  let store: LedgerStore;
  let originalArgv: string[];

  beforeEach(async () => {
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'start-path-parity-'));
    store = new LedgerStore(PLAN_PATH, tempLedgerRoot);
    originalArgv = [...process.argv];
    process.argv.push('--ledger-dir', tempLedgerRoot);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  async function run(scenario: Scenario, tool: Tool) {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: scenario.pipelines.map((p) => ({ ...p })),
      ...(scenario.reworkCount !== undefined
        ? { rework_counts: { implementation: scenario.reworkCount } }
        : {}),
    };
    await store.writeRootIndex(makeRootIndex());
    await store.writeWorkPackage('WP-001', wp);

    const args = {
      project_path: PLAN_PATH,
      work_package_id: 'WP-001',
      type: scenario.type,
      agent_role: scenario.agent_role,
    };
    const result: any =
      tool === 'startPipeline'
        ? await pipelineInternal.startPipeline(args as any)
        : await beginWorkInternal.beginWork(args as any);
    const stored = await store.readWorkPackage('WP-001');
    return { isError: result.isError === true, reworkCounts: stored.rework_counts ?? {} };
  }

  for (const scenario of SCENARIOS) {
    it(`agrees on: ${scenario.name}`, async () => {
      const viaStart = await run(scenario, 'startPipeline');
      const viaBegin = await run(scenario, 'beginWork');

      expect(viaStart.isError).toBe(scenario.expectError);
      expect(viaBegin.isError).toBe(viaStart.isError);
      expect(viaBegin.reworkCounts).toEqual(viaStart.reworkCounts);
    });
  }
});
