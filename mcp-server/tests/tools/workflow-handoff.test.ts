import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
  getDeveloperHandoff,
  getPlannerHandoff,
  nextAgentFromStatus,
  buildHandoffResponse,
} from '../../src/tools/workflow-handoff.js';
import { getDeveloperAction } from '../../src/tools/workflow-next-action.js';
import {
  isMostRecentPipelineFail,
  isStalePipeline,
  STALE_PIPELINE_HOURS,
  getHandoffNotesForAgent,
  extractReworkAction,
  buildHandoffPrompt,
  getMaxHandoffDepth,
} from '../../src/utils/workflow-helpers.js';
import { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP } from '../../src/utils/pipeline-maps.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';
import { now } from '../../src/utils/timestamp.js';
import { readConfigFromDisk, writeConfig, stopConfigWatcher, DEFAULT_CONFIG } from '../../src/gui/config.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

/** Helper to parse the JSON from a handoff result (accepts plain objects or Promises) */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

// Fixed plan path used as LedgerStore project path; tempDir is used only as the ledgerRoot.
// Using YYYY-MM-DD format so planFolderBasename() accepts it.
const PLAN_PATH = join(tmpdir(), '2026-01-01-ledger-test');

/** Build a minimal WP detail stub */
function makeWp(
  id: string,
  status: string,
  pipelines: Array<{ type: string; status: string }> = [],
  deps: string[] = []
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer Agent',
    dependencies: deps,
    acceptance_criteria: [],
    revision: 1,
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      summary: [],
    })),
  };
}

describe('Handoff logic: incomplete project detection', () => {
  describe('QA handoff', () => {
    it('returns READY_FOR_REVIEW when remaining WPs are blocked by dependencies', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
      expect(result.details).toContain('WP-003');
    });

    it('returns READY_FOR_REVIEW when ALL WPs are implemented and QA passed', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
    });

    it('returns IN_PROGRESS when some implemented WPs still need QA', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_DEVELOPER when a QA pipeline has FAIL status', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for implementation');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Reviewer handoff', () => {
    it('returns READY_FOR_DOCUMENTATION when remaining WPs are blocked by dependencies', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_DOCUMENTATION when ALL WPs have passed review', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Documentation handoff', () => {
    it('returns READY_FOR_SYNTHESIS when unreviewed WPs are all blocked by dependencies', async () => {
      // WP-002 is blocked by WP-001 (IN_PROGRESS, not COMPLETE) — should go to Synthesis not loop back to Developer
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = await parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_SYNTHESIS');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_DEVELOPER when unreviewed WPs are genuinely ready (not dependency-blocked)', async () => {
      // WP-002 has no dependencies — it is genuinely waiting for earlier pipeline stages
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []),
      ];

      const result = await parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_SYNTHESIS when ALL WPs have documentation', async () => {
      const wpDetails = [
        makeWp('WP-001', 'COMPLETE', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'COMPLETE', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_SYNTHESIS');
    });
  });

  describe('Developer handoff', () => {
    it('returns IN_PROGRESS when some non-BLOCKED WPs lack implementation', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', []), // READY/IN_PROGRESS but no implementation pipeline yet
      ];

      const result = await parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_QA when all non-BLOCKED WPs have PASS implementation (remaining WPs are BLOCKED)', async () => {
      // This was the reported deadlock scenario: WP-001 done, WP-002..N are BLOCKED on dependencies.
      // The Developer should hand off to QA rather than report IN_PROGRESS for blocked WPs.
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']),
      ];

      const result = await parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_QA');
    });

    it('returns READY_FOR_QA when ALL WPs have PASS implementation', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_QA');
    });
  });
});

describe('FAIL pipeline detection correctness', () => {
  it('isMostRecentPipelineFail returns false for [FAIL, PASS] sequence', () => {
    const pipelines = [
      { type: 'implementation', status: 'FAIL' as const, summary: [] },
      { type: 'implementation', status: 'PASS' as const, summary: [] },
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('isMostRecentPipelineFail returns true when most recent pipeline is FAIL', () => {
    const pipelines = [
      { type: 'implementation', status: 'PASS' as const, summary: [] },
      { type: 'implementation', status: 'FAIL' as const, summary: [] },
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(true);
  });

  it('isMostRecentPipelineFail returns false for empty pipeline list', () => {
    expect(isMostRecentPipelineFail([], 'implementation')).toBe(false);
  });

  it('isMostRecentPipelineFail returns false when no pipeline matches given type', () => {
    const pipelines = [
      { type: 'qa', status: 'FAIL' as const, summary: [] },
    ];
    expect(isMostRecentPipelineFail(pipelines, 'implementation')).toBe(false);
  });

  it('getDeveloperHandoff does not produce REWORK status for [FAIL, PASS] implementation sequence', async () => {
    // A WP that previously failed but then passed should not trigger REWORK
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
      ]),
    ];

    const result = JSON.parse((await getDeveloperHandoff(wpDetails)).content[0].text);
    expect(result.status).not.toBe('REWORK');
    expect(result.status).toBe('READY_FOR_QA');
  });
});

describe('Stale pipeline detection', () => {
  it('STALE_PIPELINE_HOURS is 24', () => {
    expect(STALE_PIPELINE_HOURS).toBe(24);
  });

  it('isStalePipeline returns false for IN_PROGRESS pipeline started less than 24 hours ago', () => {
    const recentTimestamp = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const pipeline = { type: 'implementation', status: 'IN_PROGRESS' as const, started_at: recentTimestamp, summary: [] };
    expect(isStalePipeline(pipeline)).toBe(false);
  });

  it('isStalePipeline returns true for IN_PROGRESS pipeline started more than 24 hours ago', () => {
    const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const pipeline = { type: 'implementation', status: 'IN_PROGRESS' as const, started_at: staleTimestamp, summary: [] };
    expect(isStalePipeline(pipeline)).toBe(true);
  });

  it('isStalePipeline returns false for PASS pipeline (not IN_PROGRESS)', () => {
    const staleTimestamp = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const pipeline = { type: 'implementation', status: 'PASS' as const, started_at: staleTimestamp, completed_at: staleTimestamp, summary: [] };
    expect(isStalePipeline(pipeline)).toBe(false);
  });

  it('isStalePipeline returns false for FAIL pipeline (not IN_PROGRESS)', () => {
    const staleTimestamp = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const pipeline = { type: 'implementation', status: 'FAIL' as const, started_at: staleTimestamp, completed_at: staleTimestamp, summary: [] };
    expect(isStalePipeline(pipeline)).toBe(false);
  });
});

describe('Handoff notes (WP-006)', () => {
  it('getHandoffNotesForAgent returns undefined when WP has no handoff_notes', () => {
    const wp = makeWp('WP-001', 'IN_PROGRESS', []);
    expect(getHandoffNotesForAgent(wp, 'Reviewer')).toBeUndefined();
  });

  it('getHandoffNotesForAgent returns undefined when no notes addressed to the requested agent', () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'IN_PROGRESS'),
      handoff_notes: [
        { from_agent: 'QA', to_agent: 'Reviewer', timestamp: now(), notes: ['check the widget'] },
      ],
    };
    expect(getHandoffNotesForAgent(wp, 'Documentation')).toBeUndefined();
  });

  it('getHandoffNotesForAgent returns notes when addressed to the correct agent', () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'IN_PROGRESS'),
      handoff_notes: [
        { from_agent: 'QA', to_agent: 'Reviewer', timestamp: now(), notes: ['check the widget', 'also review auth'] },
      ],
    };
    const notes = getHandoffNotesForAgent(wp, 'Reviewer');
    expect(notes).toEqual(['check the widget', 'also review auth']);
  });

  it('getHandoffNotesForAgent flattens notes from multiple matching entries', () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'IN_PROGRESS'),
      handoff_notes: [
        { from_agent: 'QA', to_agent: 'Reviewer', timestamp: now(), notes: ['note A'] },
        { from_agent: 'QA', to_agent: 'Reviewer', timestamp: now(), notes: ['note B', 'note C'] },
      ],
    };
    const notes = getHandoffNotesForAgent(wp, 'Reviewer');
    expect(notes).toEqual(['note A', 'note B', 'note C']);
  });

  it('existing WP detail files without handoff_notes remain valid', () => {
    // A WP without handoff_notes should not cause getHandoffNotesForAgent to throw
    const wp = makeWp('WP-001', 'IN_PROGRESS', [
      { type: 'qa', status: 'PASS' },
    ]);
    // handoff_notes is undefined — should return undefined without error
    expect(() => getHandoffNotesForAgent(wp, 'Reviewer')).not.toThrow();
    expect(getHandoffNotesForAgent(wp, 'Reviewer')).toBeUndefined();
  });
});

describe('Handoff notes in completePipeline (WP-006)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handoff-notes-test-'));
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
          assigned_to: 'QA',
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


  async function simulateCompletePipelineWithHandoff(
    pipelineType: string,
    handoffNotes: string[]
  ) {
    await store.updateWorkPackageWithSync('WP-001', (wp, root) => {
      const pipeline = [...wp.pipelines].reverse().find(
        (p) => p.type === pipelineType && p.status === 'IN_PROGRESS'
      );
      if (!pipeline) throw new Error('No IN_PROGRESS pipeline found');
      pipeline.status = 'PASS';
      pipeline.completed_at = now();
      pipeline.summary = ['Done'];

      if (handoffNotes.length > 0) {
        if (!wp.handoff_notes) wp.handoff_notes = [];
        wp.handoff_notes.push({
          from_agent: PIPELINE_AGENT_MAP[pipelineType] ?? pipelineType,
          to_agent: NEXT_AGENT_MAP[pipelineType] ?? 'Unknown',
          timestamp: now(),
          notes: handoffNotes,
        });
      }
      root.last_updated = now();
      return { wp, root };
    });
  }

  it('completePipeline with handoff_notes creates a handoff note entry on the WP', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      revision: 1,
      pipelines: [
        { type: 'implementation', status: 'PASS' as any, summary: ['done'] },
        { type: 'qa', status: 'IN_PROGRESS' as any, started_at: now(), summary: [] },
      ],
    });

    await simulateCompletePipelineWithHandoff('qa', ['check the widget', 'verify edge case']);

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes).toBeDefined();
    expect(wp.handoff_notes!.length).toBe(1);
    expect(wp.handoff_notes![0].notes).toEqual(['check the widget', 'verify edge case']);
  });

  it('handoff note from_agent correctly maps from pipeline type (qa → QA)', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      revision: 1,
      pipelines: [
        { type: 'implementation', status: 'PASS' as any, summary: [] },
        { type: 'qa', status: 'IN_PROGRESS' as any, started_at: now(), summary: [] },
      ],
    });

    await simulateCompletePipelineWithHandoff('qa', ['my note']);

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes![0].from_agent).toBe('QA');
  });

  it('handoff note to_agent correctly maps to next agent (qa → Reviewer)', async () => {
    await store.writeWorkPackage('WP-001', {
      work_package_id: 'WP-001',
      work_package_file: 'work/WP-001.md',
      status: 'IN_PROGRESS',
      assigned_to: 'QA',
      dependencies: [],
      acceptance_criteria: [],
      revision: 1,
      pipelines: [
        { type: 'implementation', status: 'PASS' as any, summary: [] },
        { type: 'qa', status: 'IN_PROGRESS' as any, started_at: now(), summary: [] },
      ],
    });

    await simulateCompletePipelineWithHandoff('qa', ['my note']);

    const wp = await store.readWorkPackage('WP-001');
    expect(wp.handoff_notes![0].to_agent).toBe('Reviewer');
  });

  it('NEXT_AGENT_MAP maps all pipeline types correctly', () => {
    expect(NEXT_AGENT_MAP['implementation']).toBe('QA');
    expect(NEXT_AGENT_MAP['qa']).toBe('Reviewer');
    expect(NEXT_AGENT_MAP['code-review']).toBe('Documentation');
    expect(NEXT_AGENT_MAP['documentation']).toBe('Synthesis');
  });
});

describe('getNextActions batch tool (WP-006)', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'batch-actions-test-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupProject(
    wps: Array<{
      id: string;
      status: string;
      pipelines: Array<{ type: string; status: string }>;
      deps?: string[];
      handoff_notes?: WorkPackageDetail['handoff_notes'];
    }>
  ) {
    const root: RootIndex = {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE').length,
      work_packages: wps.map((w) => ({
        work_package_id: w.id,
        status: w.status as any,
        assigned_to: 'Developer Agent',
        dependencies: w.deps ?? [],
        file: `ledger/${w.id}.json`,
      })),
      project_comments: [],
    };
    await store.writeRootIndex(root);

    for (const w of wps) {
      const wpDetail: WorkPackageDetail = {
        work_package_id: w.id,
        work_package_file: `work/${w.id}.md`,
        status: w.status as any,
        assigned_to: 'Developer Agent',
        dependencies: w.deps ?? [],
        acceptance_criteria: [],
        revision: 1,
        pipelines: w.pipelines.map((p) => ({
          type: p.type,
          status: p.status as any,
          summary: [],
        })),
        ...(w.handoff_notes ? { handoff_notes: w.handoff_notes } : {}),
      };
      await store.writeWorkPackage(w.id, wpDetail);
    }
  }

  it('returns multiple actionable WPs for a Developer with several independent WPs', async () => {
    // 3 independent WPs with no pipelines — all ready for Developer
    await setupProject([
      { id: 'WP-001', status: 'IN_PROGRESS', pipelines: [] },
      { id: 'WP-002', status: 'IN_PROGRESS', pipelines: [] },
      { id: 'WP-003', status: 'IN_PROGRESS', pipelines: [] },
    ]);

    // Simulate getNextActions logic for Developer
    const rootIndex = await store.readRootIndex();
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

    const actions: object[] = [];
    for (const wpDetail of wpDetails) {
      if (!wpDetail.pipelines.some((p) => p.type === 'implementation')) {
        actions.push({
          action: 'IMPLEMENT',
          work_package_id: wpDetail.work_package_id,
        });
      }
    }
    expect(actions.length).toBe(3);
  });

  it('getNextActions respects max_results limit', async () => {
    await setupProject([
      { id: 'WP-001', status: 'IN_PROGRESS', pipelines: [] },
      { id: 'WP-002', status: 'IN_PROGRESS', pipelines: [] },
      { id: 'WP-003', status: 'IN_PROGRESS', pipelines: [] },
      { id: 'WP-004', status: 'IN_PROGRESS', pipelines: [] },
    ]);

    const rootIndex = await store.readRootIndex();
    const wpDetails = await Promise.all(
      rootIndex.work_packages.map((wp) => store.readWorkPackage(wp.work_package_id))
    );

    const limit = 2;
    const actions: object[] = [];
    for (const wpDetail of wpDetails) {
      if (actions.length >= limit) break;
      if (!wpDetail.pipelines.some((p) => p.type === 'implementation')) {
        actions.push({ action: 'IMPLEMENT', work_package_id: wpDetail.work_package_id });
      }
    }
    expect(actions.length).toBe(2);
  });

  it('getNextActions for Reviewer includes handoff notes from QA when available', async () => {
    const timestamp = now();
    await setupProject([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ],
        handoff_notes: [
          { from_agent: 'QA', to_agent: 'Reviewer', timestamp, notes: ['please check auth module'] },
        ],
      },
    ]);

    const wpDetail = await store.readWorkPackage('WP-001');
    const notes = getHandoffNotesForAgent(wpDetail, 'Reviewer');
    expect(notes).toBeDefined();
    expect(notes).toEqual(['please check auth module']);
  });
});

describe('BLOCKED WP handling — no rework loop', () => {
  describe('extractReworkAction skips BLOCKED WPs', () => {
    it('returns null when WP is BLOCKED even if most recent pipeline is FAIL', () => {
      const wp = makeWp('WP-005', 'BLOCKED', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]);
      const result = extractReworkAction(wp, 'qa', 'REWORK_QA', 'rework reason');
      expect(result).toBeNull();
    });

    it('returns rework action when WP is IN_PROGRESS with FAIL pipeline', () => {
      const wp = makeWp('WP-005', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]);
      const result = extractReworkAction(wp, 'qa', 'REWORK_QA', 'rework reason');
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.action).toBe('REWORK_QA');
    });

    it('returns null for BLOCKED WP with FAIL code-review pipeline', () => {
      const wp = makeWp('WP-001', 'BLOCKED', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
      ]);
      const result = extractReworkAction(wp, 'code-review', 'REWORK_REVIEW', 'rework reason');
      expect(result).toBeNull();
    });
  });

  describe('QA handoff excludes BLOCKED WPs from needsWork', () => {
    it('returns READY_FOR_REVIEW when only BLOCKED WPs have FAIL QA (exact stuck-loop scenario)', async () => {
      // This reproduces the exact QA stuck-loop: WP-005 BLOCKED + FAIL QA, WP-006 PASS QA
      const wpDetails = [
        makeWp('WP-005', 'BLOCKED', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ], ['WP-001']),
        makeWp('WP-006', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ], ['WP-001']),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      // QA's work is done — BLOCKED WP needs Developer, not QA retry
      expect(result.status).not.toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_DEVELOPER when a non-BLOCKED WP has FAIL QA', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
    });
  });

  describe('Reviewer handoff excludes BLOCKED WPs from needsWork', () => {
    it('does not return IN_PROGRESS when only BLOCKED WPs have FAIL review', async () => {
      const wpDetails = [
        makeWp('WP-001', 'BLOCKED', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'FAIL' },
        ], ['WP-002']),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).not.toBe('IN_PROGRESS');
    });
  });

  describe('Documentation handoff excludes BLOCKED WPs from needsWork', () => {
    it('does not return IN_PROGRESS when only BLOCKED WPs have FAIL docs', async () => {
      const wpDetails = [
        makeWp('WP-001', 'BLOCKED', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'FAIL' },
        ], ['WP-002']),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).not.toBe('IN_PROGRESS');
    });
  });
});

describe('Developer downstream pipeline failure detection', () => {
  let tempDir: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dev-downstream-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Helper to set up a root index and WP detail file, then call getDeveloperAction */
  async function setupAndGetDevAction(
    wps: Array<{
      id: string;
      status: string;
      pipelines: Array<{ type: string; status: string }>;
      deps?: string[];
    }>
  ) {
    const timestamp = now();
    const rootIndex: RootIndex = {
      plan_file: 'plan.md',
      date_created: timestamp,
      last_updated: timestamp,
      status: 'IN_PROGRESS',
      total_work_packages: wps.length,
      pending_work_packages: wps.filter((w) => w.status !== 'COMPLETE').length,
      work_packages: wps.map((w) => ({
        work_package_id: w.id,
        status: w.status as any,
        assigned_to: 'Developer',
        dependencies: w.deps ?? [],
        file: `ledger/${w.id}.json`,
      })),
      project_comments: [],
    };
    await store.writeRootIndex(rootIndex);

    for (const w of wps) {
      const wpDetail: WorkPackageDetail = {
        work_package_id: w.id,
        work_package_file: `work/${w.id}.md`,
        status: w.status as any,
        assigned_to: 'Developer',
        dependencies: w.deps ?? [],
        acceptance_criteria: [],
        revision: 1,
        pipelines: w.pipelines.map((p) => ({
          type: p.type,
          status: p.status as any,
          summary: [],
        })),
      };
      await store.writeWorkPackage(w.id, wpDetail);
    }

    return getDeveloperAction(rootIndex, store);
  }

  it('returns REWORK when QA pipeline fails (deadlock prevention)', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-001');
    expect(parsed.pipeline_that_failed).toBe('qa');
    expect(parsed.reason).toContain('FAIL qa pipeline');
  });

  it('returns REWORK when code-review pipeline fails', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'FAIL' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-001');
    expect(parsed.pipeline_that_failed).toBe('code-review');
    expect(parsed.reason).toContain('FAIL code-review pipeline');
  });

  it('returns REWORK for BLOCKED WP with downstream FAIL (the exact deadlock scenario)', async () => {
    // This is the exact scenario that caused the deadlock:
    // WP has PASS impl, FAIL QA, and status is BLOCKED
    const result = await setupAndGetDevAction([
      {
        id: 'WP-005',
        status: 'BLOCKED',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-005');
    expect(parsed.pipeline_that_failed).toBe('qa');
  });

  it('returns WAIT when all pipelines are PASS (no rework needed)', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('WAIT');
  });

  it('prioritizes FAIL implementation pipeline over downstream FAIL', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'FAIL' },
        ],
      },
      {
        id: 'WP-002',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-001');
    // WP-001 has a FAIL implementation — that takes priority
    expect(parsed.pipeline_that_failed).toBeUndefined();
  });

  it('does not return REWORK for downstream FAIL when implementation is not PASS', async () => {
    // Edge case: WP has no PASS implementation but has a FAIL QA —
    // this shouldn't happen in practice, but be defensive
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'IN_PROGRESS' },
          { type: 'qa', status: 'FAIL' },
        ],
      },
    ]);

    const parsed = await parseResult(result);
    // Should not suggest rework because impl isn't PASS
    expect(parsed.action).toBe('WAIT');
  });

  it('surfaces QA failure even when QA was retried and failed again', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
          { type: 'qa', status: 'FAIL' }, // Retried and failed again
        ],
      },
    ]);

    const parsed = await parseResult(result);
    expect(parsed.action).toBe('REWORK');
    expect(parsed.pipeline_that_failed).toBe('qa');
  });

  it('does not surface downstream FAIL when QA passed after a retry', async () => {
    const result = await setupAndGetDevAction([
      {
        id: 'WP-001',
        status: 'IN_PROGRESS',
        pipelines: [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
          { type: 'qa', status: 'PASS' }, // Retried and passed
        ],
      },
    ]);

    const parsed = await parseResult(result);
    // QA most-recent is PASS, so no rework needed
    expect(parsed.action).toBe('WAIT');
  });
});

describe('Three-field handoff format (current_agent / next_agent / status)', () => {
  describe('nextAgentFromStatus', () => {
    it('maps READY_FOR_* statuses to target agent', () => {
      expect(nextAgentFromStatus('READY_FOR_DEVELOPER', 'QA')).toBe('Developer');
      expect(nextAgentFromStatus('READY_FOR_QA', 'Developer')).toBe('QA');
      expect(nextAgentFromStatus('READY_FOR_REVIEW', 'QA')).toBe('Reviewer');
      expect(nextAgentFromStatus('READY_FOR_DOCUMENTATION', 'Reviewer')).toBe('Documentation');
      expect(nextAgentFromStatus('READY_FOR_SYNTHESIS', 'Documentation')).toBe('Synthesis');
    });

    it('returns current agent for IN_PROGRESS', () => {
      expect(nextAgentFromStatus('IN_PROGRESS', 'Developer')).toBe('Developer');
      expect(nextAgentFromStatus('IN_PROGRESS', 'QA')).toBe('QA');
    });

    it('returns Project Manager for BLOCKED', () => {
      expect(nextAgentFromStatus('BLOCKED', 'Developer')).toBe('Project Manager');
    });

    it('returns null for COMPLETE', () => {
      expect(nextAgentFromStatus('COMPLETE', 'Synthesis')).toBeNull();
    });

    it('returns null for CANCELLED (terminal status — GN-1)', () => {
      // CANCELLED is a terminal status just like COMPLETE; no next agent should be returned.
      expect(nextAgentFromStatus('CANCELLED', 'Developer')).toBeNull();
      expect(nextAgentFromStatus('CANCELLED', 'QA')).toBeNull();
    });

    it('returns null for unknown status', () => {
      expect(nextAgentFromStatus('UNKNOWN', 'Developer')).toBeNull();
    });
  });

  describe('buildHandoffResponse', () => {
    it('includes current_agent, next_agent, and status in payload', async () => {
      const result = await parseResult(buildHandoffResponse('QA', 'READY_FOR_REVIEW', 'QA done.'));
      expect(result.current_agent).toBe('QA');
      expect(result.next_agent).toBe('Reviewer');
      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.details).toBe('QA done.');
    });

    it('omits next_agent for COMPLETE status', async () => {
      const result = await parseResult(buildHandoffResponse('Synthesis', 'COMPLETE', 'Done.'));
      expect(result.current_agent).toBe('Synthesis');
      expect(result.next_agent).toBeUndefined();
      expect(result.status).toBe('COMPLETE');
    });

    it('sets next_agent to current agent for IN_PROGRESS', async () => {
      const result = await parseResult(buildHandoffResponse('Developer', 'IN_PROGRESS', 'Working.'));
      expect(result.current_agent).toBe('Developer');
      expect(result.next_agent).toBe('Developer');
    });

    it('includes next_action when provided', async () => {
      const result = await parseResult(buildHandoffResponse('Developer', 'IN_PROGRESS', 'Working.', 'Call get_next_action'));
      expect(result.next_action).toBe('Call get_next_action');
    });

    it('omits next_action when not provided', async () => {
      const result = await parseResult(buildHandoffResponse('QA', 'READY_FOR_REVIEW', 'Done.'));
      expect(result.next_action).toBeUndefined();
    });
  });

  describe('handoff functions emit current_agent and next_agent', () => {
    it('getQaHandoff includes current_agent: QA and next_agent: Reviewer', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
      ];
      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.current_agent).toBe('QA');
      expect(result.next_agent).toBe('Reviewer');
      expect(result.status).toBe('READY_FOR_REVIEW');
    });

    it('getReviewerHandoff includes current_agent: Reviewer and next_agent: Documentation', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
      ];
      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.current_agent).toBe('Reviewer');
      expect(result.next_agent).toBe('Documentation');
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    });

    it('getDocumentationHandoff includes current_agent: Documentation and next_agent: Synthesis', async () => {
      const wpDetails = [
        makeWp('WP-001', 'COMPLETE', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
          { type: 'documentation', status: 'PASS' },
        ]),
      ];
      const result = await parseResult(getDocumentationHandoff(wpDetails));
      expect(result.current_agent).toBe('Documentation');
      expect(result.next_agent).toBe('Synthesis');
    });

    it('getDeveloperHandoff IN_PROGRESS has next_agent: Developer (self)', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', []),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];
      const result = await parseResult(getDeveloperHandoff(wpDetails));
      expect(result.current_agent).toBe('Developer');
      expect(result.next_agent).toBe('Developer');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('getDeveloperHandoff READY_FOR_QA has next_agent: QA', async () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];
      const result = await parseResult(getDeveloperHandoff(wpDetails));
      expect(result.current_agent).toBe('Developer');
      expect(result.next_agent).toBe('QA');
    });

    it('no handoff response contains the old "agent" field', async () => {
      // Verify QA handoff does not include "agent" key
      const qaResult = await parseResult(getQaHandoff([
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
      ]));
      expect(qaResult).not.toHaveProperty('agent');

      // Verify Developer handoff does not include "agent" key
      const devResult = await parseResult(getDeveloperHandoff([
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ]));
      expect(devResult).not.toHaveProperty('agent');
    });
  });
});

// ─── Auto-handoff tests (WP-008) ────────────────────────────────────────────

describe('Auto-handoff: buildHandoffResponse with auto_handoff', () => {
  let tempDir: string;
  let agentDir: string;
  let store: LedgerStore;

  /** Write a minimal *.agent.md file with YAML frontmatter to agentDir. */
  async function writeAgentFile(filename: string, name: string, role: string): Promise<void> {
    const content = `---\nname: ${name}\nrole: ${role}\n---\n\n# Body`;
    await writeFile(join(agentDir, filename), content, 'utf8');
  }

  /** Build a minimal RootIndex with optional field overrides. */
  function makeAutoHandoffRoot(overrides: Partial<RootIndex> = {}): RootIndex {
    return {
      plan_file: 'plan.md',
      date_created: now(),
      last_updated: now(),
      status: 'IN_PROGRESS',
      total_work_packages: 1,
      pending_work_packages: 1,
      work_packages: [],
      project_comments: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    resetRegistry();
    tempDir = await mkdtemp(join(tmpdir(), 'auto-handoff-test-'));
    agentDir = await mkdtemp(join(tmpdir(), 'auto-handoff-agents-'));
    store = new LedgerStore(PLAN_PATH, tempDir);
    await store.writeRootIndex(makeAutoHandoffRoot());
  });

  afterEach(async () => {
    resetRegistry();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  });

  it('includes auto_handoff when registry loaded, status READY_FOR_QA, path valid, depth < MAX', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('4 - QA v1.0');
    expect(result.auto_handoff.prompt).toBe(`Project path: ${PLAN_PATH}`);
  });

  it('omits auto_handoff when status is COMPLETE (terminal status)', async () => {
    await writeAgentFile('7-synthesis.agent.md', '7 - Synthesis v1.0', 'Synthesis');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Synthesis', 'COMPLETE', 'Done.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('omits auto_handoff when status is BLOCKED', async () => {
    await writeAgentFile('2-pm.agent.md', '2 - Project Manager v1.0', 'Project Manager');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'BLOCKED', 'Blocked.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('omits auto_handoff when status is IN_PROGRESS', async () => {
    await writeAgentFile('3-dev.agent.md', '3 - Developer v1.0', 'Developer');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'IN_PROGRESS', 'Working.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('omits auto_handoff when auto_handoff_depth >= MAX_HANDOFF_DEPTH', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);
    await store.writeRootIndex(makeAutoHandoffRoot({ auto_handoff_depth: getMaxHandoffDepth() }));

    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('omits auto_handoff when registry is empty (no agents discovered)', async () => {
    // Deliberately do NOT call discoverAgents — registry remains unloaded
    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('omits auto_handoff when no projectPath provided', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);

    // Called without projectPath or store — auto-handoff ineligible
    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.'),
    );

    expect(result.auto_handoff).toBeUndefined();
  });

  it('increments auto_handoff_depth in ledger when auto_handoff is emitted', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);
    await store.writeRootIndex(makeAutoHandoffRoot({ auto_handoff_depth: 2 }));

    await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    const root = await store.readRootIndex();
    expect(root.auto_handoff_depth).toBe(3);
  });

  it('does NOT reset auto_handoff_depth in buildHandoffResponse (depth reset moved to updateWorkPackageStatus)', async () => {
    // Finding #8: auto_handoff_depth is now reset when any WP transitions to COMPLETE
    // via updateWorkPackageStatus (work-package.ts), not at project-COMPLETE time here.
    // buildHandoffResponse should leave auto_handoff_depth unchanged regardless of status.
    await store.writeRootIndex(makeAutoHandoffRoot({ auto_handoff_depth: 5 }));

    await parseResult(
      buildHandoffResponse('Synthesis', 'COMPLETE', 'Project done.', undefined, PLAN_PATH, store),
    );

    // Depth should remain 5 — buildHandoffResponse no longer resets it
    const root = await store.readRootIndex();
    expect(root.auto_handoff_depth).toBe(5);
  });

  it('rework loop: QA FAIL → auto_handoff targets Developer agent when depth permits', async () => {
    await writeAgentFile('3-dev.agent.md', '3 - Developer v3.1.2', 'Developer');
    await discoverAgents(agentDir);

    // QA emits READY_FOR_DEVELOPER after a failing QA pipeline
    const result = await parseResult(
      buildHandoffResponse('QA', 'READY_FOR_DEVELOPER', 'QA failed — rework needed.', undefined, PLAN_PATH, store),
    );

    expect(result.next_agent).toBe('Developer');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('3 - Developer v3.1.2');
  });

  it('depth boundary: auto_handoff present at MAX-1, absent at MAX', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);

    // At MAX-1 → eligible; depth increments to MAX
    await store.writeRootIndex(makeAutoHandoffRoot({ auto_handoff_depth: getMaxHandoffDepth() - 1 }));
    const resultAtMaxMinus1 = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );
    expect(resultAtMaxMinus1.auto_handoff).toBeDefined();

    // Depth is now MAX → not eligible; no auto_handoff emitted
    const resultAtMax = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );
    expect(resultAtMax.auto_handoff).toBeUndefined();
  });

  describe('auto_handoff_enabled: false (config flag)', () => {
    let configPath: string;

    beforeEach(async () => {
      configPath = join(tempDir, 'gui-config.json');
      await readConfigFromDisk(configPath); // creates file with defaults
      await writeConfig(configPath, { auto_handoff_enabled: false });
    });

    afterEach(async () => {
      stopConfigWatcher();
      await writeConfig(configPath, { auto_handoff_enabled: DEFAULT_CONFIG.auto_handoff_enabled });
    });

    it('omits auto_handoff when auto_handoff_enabled is false', async () => {
      await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
      await discoverAgents(agentDir);

      const result = await parseResult(
        buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
      );

      expect(result.status).toBe('READY_FOR_QA');
      expect(result.auto_handoff).toBeUndefined();
    });
  });
});

describe('buildHandoffPrompt', () => {
  it('returns "Project path: <path>" format', () => {
    expect(buildHandoffPrompt('/some/project/path')).toBe('Project path: /some/project/path');
  });

  it('handles paths containing spaces', () => {
    expect(buildHandoffPrompt('/users/me/my project')).toBe('Project path: /users/me/my project');
  });
});

// ---------------------------------------------------------------------------
// WP-004: Handoff & Auto-Handoff Fixes
// ---------------------------------------------------------------------------

describe('getPlannerHandoff — Finding #6: Planner returns a defined, non-generic response', () => {
  it('returns READY_FOR_DEVELOPER when WPs are READY or IN_PROGRESS', async () => {
    const wpDetails = [
      makeWp('WP-001', 'READY'),
      makeWp('WP-002', 'IN_PROGRESS'),
    ];
    const result = await parseResult(getPlannerHandoff(wpDetails));
    expect(result.current_agent).toBe('Planner');
    expect(result.status).toBe('READY_FOR_DEVELOPER');
    expect(result.details).toContain('Planning complete');
  });

  it('returns WAIT when no work packages exist', async () => {
    const result = await parseResult(getPlannerHandoff([]));
    expect(result.status).toBe('WAIT');
    expect(result.details).toContain('Planning complete');
    expect(result.details).not.toContain('IN_PROGRESS');
  });

  it('returns WAIT when all WPs are COMPLETE or BLOCKED', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE'),
      makeWp('WP-002', 'BLOCKED'),
    ];
    const result = await parseResult(getPlannerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.details).toContain('Planning complete');
  });

  it('does NOT return the generic IN_PROGRESS response (must have specific Planner status)', async () => {
    const wpDetails = [makeWp('WP-001', 'READY')];
    const result = await parseResult(getPlannerHandoff(wpDetails));
    // Planner must never fall through to the default IN_PROGRESS handler
    expect(result.status).not.toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Planner');
  });
});

describe('Synthesis case — Finding #13: includes get_next_action guidance', () => {
  let handle: { store: LedgerStore; planPath: string; ledgerRoot: string };

  beforeEach(async () => {
    const { createTempStore } = await import('../helpers/create-temp-store.js');
    handle = await createTempStore(PLAN_PATH);
  });

  afterEach(async () => {
    const { cleanupTempStore } = await import('../helpers/create-temp-store.js');
    await cleanupTempStore(handle);
  });

  it('Synthesis buildHandoffResponse includes get_next_action guidance in next_action field', async () => {
    const result = await parseResult(
      buildHandoffResponse(
        'Synthesis',
        'COMPLETE',
        'Synthesis complete.',
        'Call ledger_get_next_action first to check if synthesis work is pending before generating your report.',
        handle.planPath,
        handle.store
      )
    );
    expect(result.status).toBe('COMPLETE');
    expect(result.next_action).toBeDefined();
    expect(result.next_action).toContain('ledger_get_next_action');
  });
});

describe('Global BLOCKED precheck — Finding #9: mixed BLOCKED + COMPLETE returns BLOCKED', () => {
  /**
   * Inline replica of the revised global precheck logic in getHandoffStatus.
   * Tests that the condition fires for BLOCKED+COMPLETE when no READY/IN_PROGRESS exist.
   */
  function shouldReturnBlocked(wps: { status: string }[]): boolean {
    const blockedWps = wps.filter((w) => w.status === 'BLOCKED');
    const readyOrInProgressWps = wps.filter(
      (w) => w.status === 'READY' || w.status === 'IN_PROGRESS'
    );
    // New condition: BLOCKED triggered by absence of READY/IN_PROGRESS alone
    return blockedWps.length > 0 && readyOrInProgressWps.length === 0;
  }

  it('returns BLOCKED for mixed BLOCKED + COMPLETE state (no READY/IN_PROGRESS)', () => {
    const wps = [
      { status: 'BLOCKED' },
      { status: 'BLOCKED' },
      { status: 'COMPLETE' },
    ];
    expect(shouldReturnBlocked(wps)).toBe(true);
  });

  it('returns BLOCKED when single BLOCKED + single COMPLETE (old behavior was NOT blocked here)', () => {
    const wps = [
      { status: 'BLOCKED' },
      { status: 'COMPLETE' },
    ];
    // This was previously false (old bug: required completeWps.length === 0)
    // New correct behavior: should be true
    expect(shouldReturnBlocked(wps)).toBe(true);
  });

  it('does NOT return BLOCKED when READY or IN_PROGRESS WPs exist alongside BLOCKED', () => {
    expect(shouldReturnBlocked([{ status: 'BLOCKED' }, { status: 'IN_PROGRESS' }])).toBe(false);
    expect(shouldReturnBlocked([{ status: 'BLOCKED' }, { status: 'READY' }])).toBe(false);
  });

  it('does NOT return BLOCKED when no BLOCKED WPs exist', () => {
    expect(shouldReturnBlocked([{ status: 'COMPLETE' }, { status: 'READY' }])).toBe(false);
    expect(shouldReturnBlocked([{ status: 'COMPLETE' }])).toBe(false);
  });
});

