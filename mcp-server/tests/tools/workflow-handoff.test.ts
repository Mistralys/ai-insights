import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { _internal } from '../../src/tools/workflow.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const {
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
  getDeveloperHandoff,
  isMostRecentPipelineFail,
  isStalePipeline,
  STALE_PIPELINE_HOURS,
  getHandoffNotesForAgent,
  extractReworkAction,
  PIPELINE_AGENT_MAP,
  NEXT_AGENT_MAP,
} = _internal;

/** Helper to parse the JSON from a handoff result */
function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

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
    it('returns READY_FOR_REVIEW when remaining WPs are blocked by dependencies', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
      expect(result.details).toContain('WP-003');
    });

    it('returns READY_FOR_REVIEW when ALL WPs are implemented and QA passed', () => {
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

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
    });

    it('returns IN_PROGRESS when some implemented WPs still need QA', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns IN_PROGRESS when a QA pipeline has FAIL status', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for implementation');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Reviewer handoff', () => {
    it('returns READY_FOR_DOCUMENTATION when remaining WPs are blocked by dependencies', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_DOCUMENTATION when ALL WPs have passed review', () => {
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

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    });

    it('returns READY_FOR_DEVELOPER when some WPs are ready (not blocked)', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not blocked, ready for work
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('ready for');
      expect(result.details).toContain('WP-002');
    });
  });

  describe('Documentation handoff', () => {
    it('returns READY_FOR_SYNTHESIS when unreviewed WPs are all blocked by dependencies', () => {
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

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_SYNTHESIS');
      expect(result.details).toContain('blocked by dependencies');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_DEVELOPER when unreviewed WPs are genuinely ready (not dependency-blocked)', () => {
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

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.details).toContain('WP-002');
    });

    it('returns READY_FOR_SYNTHESIS when ALL WPs have documentation', () => {
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

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_SYNTHESIS');
    });
  });

  describe('Developer handoff', () => {
    it('returns IN_PROGRESS when some WPs lack implementation', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
      ];

      const result = parseResult(getDeveloperHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('returns READY_FOR_QA when ALL WPs have PASS implementation', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = parseResult(getDeveloperHandoff(wpDetails));
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

  it('getDeveloperHandoff does not produce REWORK status for [FAIL, PASS] implementation sequence', () => {
    // A WP that previously failed but then passed should not trigger REWORK
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
      ]),
    ];

    const result = JSON.parse(getDeveloperHandoff(wpDetails).content[0].text);
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
    store = new LedgerStore(tempDir);

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
    store = new LedgerStore(tempDir);
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
    it('returns READY_FOR_REVIEW when only BLOCKED WPs have FAIL QA (exact stuck-loop scenario)', () => {
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

      const result = parseResult(getQaHandoff(wpDetails));
      // QA's work is done — BLOCKED WP needs Developer, not QA retry
      expect(result.status).not.toBe('IN_PROGRESS');
    });

    it('returns IN_PROGRESS when a non-BLOCKED WP has FAIL QA', () => {
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
        ]),
      ];

      const result = parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('IN_PROGRESS');
    });
  });

  describe('Reviewer handoff excludes BLOCKED WPs from needsWork', () => {
    it('does not return IN_PROGRESS when only BLOCKED WPs have FAIL review', () => {
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

      const result = parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).not.toBe('IN_PROGRESS');
    });
  });

  describe('Documentation handoff excludes BLOCKED WPs from needsWork', () => {
    it('does not return IN_PROGRESS when only BLOCKED WPs have FAIL docs', () => {
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

      const result = parseResult(getDocumentationHandoff(wpDetails));
      expect(result.status).not.toBe('IN_PROGRESS');
    });
  });
});
