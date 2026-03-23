import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
} from '../../src/tools/workflow-handoff.js';
import {
  getQaAction,
  getReviewerAction,
  getDocumentationAction,
} from '../../src/tools/workflow-next-action.js';
import { FAIL_ROUTING_MAP, NEXT_AGENT_MAP } from '../../src/utils/pipeline-maps.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail, Pipeline } from '../../src/schema/work-package.js';

const PLAN_PATH = join(tmpdir(), '2026-01-01-rework-loop-test');

/** Helper to parse the JSON from a handoff/action result */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

/** Build a minimal WP detail */
function makeWp(
  id: string,
  status: string,
  pipelines: Array<{ type: string; status: string; started_at?: string; completed_at?: string }> = [],
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
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      started_at: p.started_at ?? now(),
      ...(p.completed_at ? { completed_at: p.completed_at } : {}),
      summary: [],
    })) as Pipeline[],
  };
}

describe('FAIL_ROUTING_MAP', () => {
  it('routes QA/code-review/implementation FAIL to Developer', () => {
    expect(FAIL_ROUTING_MAP['qa']).toBe('Developer');
    expect(FAIL_ROUTING_MAP['code-review']).toBe('Developer');
    expect(FAIL_ROUTING_MAP['implementation']).toBe('Developer');
  });

  it('routes documentation FAIL to Documentation (self-rework)', () => {
    expect(FAIL_ROUTING_MAP['documentation']).toBe('Documentation');
  });
});

describe('FAIL handoff routing (handoff_notes to_agent)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rework-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);

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
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('complete_pipeline FAIL sets handoff_note to_agent via FAIL_ROUTING_MAP', async () => {
    // Set up a WP with a PASS implementation and an IN_PROGRESS QA pipeline
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ] as Pipeline[],
    };
    await store.writeWorkPackage('WP-001', wp);

    // Simulate completing pipeline with FAIL + handoff notes
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = wp.pipelines.find((p) => p.type === 'qa' && p.status === 'IN_PROGRESS');
      if (pipeline) {
        pipeline.status = 'FAIL';
        pipeline.completed_at = now();
        pipeline.summary = ['Test X failed'];
      }
      // This mimics what complete_pipeline does with FAIL_ROUTING_MAP
      const toAgent = FAIL_ROUTING_MAP['qa'];
      wp.handoff_notes = [
        {
          from_agent: 'QA',
          to_agent: toAgent,
          timestamp: now(),
          notes: ['Fix test X'],
        },
      ];
      root.last_updated = now();
      return { wp, root };
    });

    const updated = await store.readWorkPackage('WP-001');
    expect(updated.handoff_notes).toBeDefined();
    expect(updated.handoff_notes![0].to_agent).toBe('Developer');
  });

  it('complete_pipeline PASS sets handoff_note to_agent via NEXT_AGENT_MAP', async () => {
    const wp: WorkPackageDetail = {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: now(), summary: [] },
        { type: 'qa', status: 'IN_PROGRESS', started_at: now(), summary: [] },
      ] as Pipeline[],
    };
    await store.writeWorkPackage('WP-001', wp);

    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = wp.pipelines.find((p) => p.type === 'qa' && p.status === 'IN_PROGRESS');
      if (pipeline) {
        pipeline.status = 'PASS';
        pipeline.completed_at = now();
        pipeline.summary = ['All tests passed'];
      }
      const toAgent = NEXT_AGENT_MAP['qa'];
      wp.handoff_notes = [
        {
          from_agent: 'QA',
          to_agent: toAgent,
          timestamp: now(),
          notes: ['Ready for review'],
        },
      ];
      root.last_updated = now();
      return { wp, root };
    });

    const updated = await store.readWorkPackage('WP-001');
    expect(updated.handoff_notes).toBeDefined();
    expect(updated.handoff_notes![0].to_agent).toBe('Reviewer');
  });
});

describe('QA handoff returns READY_FOR_DEVELOPER on FAIL', () => {
  it('returns READY_FOR_DEVELOPER when all QA pipelines are FAIL (no new/in-progress work)', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
    ];

    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
    expect(result.next_agent).toBe('Developer');
  });

  it('returns IN_PROGRESS when there are WPs still needing QA (no pipeline yet)', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        // No QA pipeline yet → QA still has work
      ]),
    ];

    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('Reviewer handoff returns READY_FOR_DEVELOPER on FAIL', () => {
  it('returns READY_FOR_DEVELOPER when all code-review pipelines are FAIL', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
      ]),
    ];

    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
    expect(result.next_agent).toBe('Developer');
  });
});

describe('Documentation handoff stays IN_PROGRESS on FAIL (self-rework)', () => {
  it('returns IN_PROGRESS when documentation pipeline FAILs', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'FAIL' },
      ]),
    ];

    const result = await parseResult(getDocumentationHandoff(wpDetails));
    // Documentation handles its own FAIL → stays IN_PROGRESS
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('QA/Reviewer next-action returns WAIT_FOR_REWORK on FAIL (no self-rework)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rework-na-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupRoot(wps: WorkPackageDetail[]) {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.length,
      work_packages: wps.map((wp) => ({
        work_package_id: wp.work_package_id,
        status: wp.status,
        assigned_to: wp.assigned_to,
        dependencies: wp.dependencies,
        file: `ledger/${wp.work_package_id}.json`,
      })),
      project_comments: [],
    };
    await store.writeRootIndex(root);
    for (const wp of wps) {
      await store.writeWorkPackage(wp.work_package_id, wp);
    }
    return root;
  }

  it('QA returns WAIT_FOR_REWORK when most-recent QA pipeline is FAIL', async () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', [
      { type: 'implementation', status: 'PASS' },
      { type: 'qa', status: 'FAIL' },
    ]);
    const root = await setupRoot([wp]);

    const result = await parseResult(getQaAction(root, store));
    expect(result.action).toBe('WAIT_FOR_REWORK');
    expect(result.reason).toContain('FAIL QA pipeline');
    expect(result.reason).toContain('fail-target agent must rework');
  });

  it('Reviewer returns WAIT_FOR_REWORK when most-recent code-review pipeline is FAIL', async () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', [
      { type: 'implementation', status: 'PASS' },
      { type: 'qa', status: 'PASS' },
      { type: 'code-review', status: 'FAIL' },
    ]);
    const root = await setupRoot([wp]);

    const result = await parseResult(getReviewerAction(root, store));
    expect(result.action).toBe('WAIT_FOR_REWORK');
    expect(result.reason).toContain('FAIL code-review pipeline');
    expect(result.reason).toContain('fail-target agent must rework');
  });

  it('Documentation returns REWORK when most-recent documentation pipeline is FAIL', async () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', [
      { type: 'implementation', status: 'PASS' },
      { type: 'qa', status: 'PASS' },
      { type: 'code-review', status: 'PASS' },
      { type: 'documentation', status: 'FAIL' },
    ]);
    const root = await setupRoot([wp]);

    const result = await parseResult(getDocumentationAction(root, store));
    expect(result.action).toBe('REWORK');
    expect(result.work_package_id).toBe('WP-001');
  });
});

describe('Full FAIL → Developer rework → QA re-trigger → PASS flow', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rework-flow-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates the full rework cycle end-to-end', async () => {
    // --- PHASE 1: Initial setup with PASS implementation ---
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
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'Developer',
      dependencies: [],
      acceptance_criteria: [{ criterion: 'Tests pass', met: false }],
      revision: 0,
      pipelines: [
        { type: 'implementation', status: 'PASS', started_at: '2026-01-01T10:00:00', completed_at: '2026-01-01T10:30:00', summary: ['Implemented'] },
      ] as Pipeline[],
    };
    await store.writeWorkPackage('WP-001', wp);

    // --- PHASE 2: QA runs and FAILs ---
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({
        type: 'qa',
        status: 'FAIL',
        started_at: '2026-01-01T11:00:00',
        completed_at: '2026-01-01T11:30:00',
        summary: ['Test X failed'],
      } as Pipeline);
      root.last_updated = now();
      return { wp, root };
    });

    // QA handoff should route to Developer
    const wp2 = await store.readWorkPackage('WP-001');
    const qaHandoff = await parseResult(getQaHandoff([wp2]));
    expect(qaHandoff.status).toBe('READY_FOR_DEVELOPER');

    // QA next-action should return WAIT
    const root2 = await store.readRootIndex();
    const qaAction = await parseResult(getQaAction(root2, store));
    expect(qaAction.action).toBe('WAIT_FOR_REWORK');
    expect(qaAction.reason).toContain('fail-target agent must rework');

    // --- PHASE 3: Developer reworks (new PASS implementation) ---
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({
        type: 'implementation',
        status: 'PASS',
        started_at: '2026-01-01T12:00:00',
        completed_at: '2026-01-01T12:30:00',
        summary: ['Fixed test X issue'],
      } as Pipeline);
      root.last_updated = now();
      return { wp, root };
    });

    // --- PHASE 4: QA re-triggers (sees new upstream PASS) and PASSes ---
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      wp.pipelines.push({
        type: 'qa',
        status: 'PASS',
        started_at: '2026-01-01T13:00:00',
        completed_at: '2026-01-01T13:30:00',
        summary: ['All tests passed'],
      } as Pipeline);
      root.last_updated = now();
      return { wp, root };
    });

    // QA handoff should now route to Reviewer
    const wp4 = await store.readWorkPackage('WP-001');
    const qaHandoff2 = await parseResult(getQaHandoff([wp4]));
    expect(qaHandoff2.status).toBe('READY_FOR_REVIEW');
  });
});
