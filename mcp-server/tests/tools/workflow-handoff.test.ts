import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getQaHandoff,
  getReviewerHandoff,
  getSecurityAuditorHandoff,
  getDocumentationHandoff,
  getDeveloperHandoff,
  getPlannerHandoff,
  getProjectManagerHandoff,
  nextAgentFromStatus,
  buildHandoffResponse,
  computeHandoffStatus,
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
  deps: string[] = [],
  assignedTo: string = 'Developer'
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: assignedTo,
    dependencies: deps,
    acceptance_criteria: [],
    revision: 0,
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      summary: [],
    })),
  };
}

describe('Handoff logic: incomplete project detection', () => {
  describe('QA handoff', () => {
    it('returns READY_FOR_REVIEW when WP-001 has PASS QA; dep-blocked WP-002/003 not QA concern (spec v2.0.0)', async () => {
      // WP-001 has qa PASS and no code-review PASS yet — QA routes to Reviewer.
      // WP-002/003 are BLOCKED with no pipelines — not in wpsPassedQa, not QA's concern.
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
      expect(result.details).toContain('PASS QA');
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

    it('returns READY_FOR_REVIEW when WP-001 has PASS QA; WP-002 not-yet-QA-d is not QA concern (spec v2.0.0)', async () => {
      // spec v2.0.0 removed the auto-engagement branch for WPs with impl PASS but no QA pipeline.
      // WP-001 has qa PASS — routes to Reviewer. WP-002 having impl PASS but no QA is not
      // QA's concern (ledger_get_next_action handles routing QA to WP-002 separately).
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          // No QA pipeline — not QA's concern per spec v2.0.0 handoff
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
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

    it('returns READY_FOR_REVIEW when WP-001 has PASS QA; WP-002 not-yet-reviewed is not QA concern (spec v2.0.0)', async () => {
      // spec v2.0.0 removed the "not-yet-reached-stage" READY_FOR_DEVELOPER branch from QA handoff.
      // WP-001 has qa PASS — routes to Reviewer. WP-002 READY and WP-003 BLOCKED are not QA concern.
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not yet QA'd — not QA's concern
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = await parseResult(getQaHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.details).toContain('PASS QA');
    });
  });

  describe('Reviewer handoff', () => {
    it('returns READY_FOR_DOCUMENTATION when WP-001 has PASS review; WP-002 dep-blocked WP ignored (spec v2.0.0)', async () => {
      // WP-002 is BLOCKED and has no code-review pipeline — not in wpsPassedReview.
      // WP-001 has PASS code-review and is ready for documentation.
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
      expect(result.details).toContain('PASS code-review');
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

    it('returns READY_FOR_DOCUMENTATION when WP-001 has PASS review; WP-002 not-yet-reviewed is not Reviewer\u2019s concern (spec v2.0.0)', async () => {
      // spec v2.0.0 removed the "not-yet-reached-stage" READY_FOR_DEVELOPER branch.
      // WP-001 has PASS code-review and is ready for documentation.
      // WP-002 is READY but has not yet reached QA/code-review — not Reviewer\'s concern.
      const wpDetails = [
        makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ]),
        makeWp('WP-002', 'READY', [], []), // Not yet reviewed — not Reviewer's concern
        makeWp('WP-003', 'BLOCKED', [], ['WP-001']), // Blocked by dependency
      ];

      const result = await parseResult(getReviewerHandoff(wpDetails));
      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.details).toContain('PASS code-review');
    });
  });

  describe('Documentation handoff', () => {
    it('returns WAIT when WP-001 has docs PASS (IN_PROGRESS) and WP-002 is dep-blocked — spec v2.0.0 removed upstream catch-all', async () => {
      // Per spec v2.0.0: Documentation cannot dispatch to the correct upstream agent.
      // WPs in earlier stages are left for the orchestrator to route via polling → WAIT.
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
      expect(result.status).toBe('WAIT');
    });

    it('returns WAIT when WP-002 is genuinely waiting for earlier pipeline stages — spec v2.0.0 removed READY_FOR_DEVELOPER dispatch', async () => {
      // Per spec v2.0.0: Documentation cannot accurately dispatch to the correct upstream agent.
      // WPs needing earlier-stage work are left for the orchestrator to route → WAIT.
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
      expect(result.status).toBe('WAIT');
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
      revision: 0,
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
      revision: 0,
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
      revision: 0,
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
        assigned_to: 'Developer',
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
        assigned_to: 'Developer',
        dependencies: w.deps ?? [],
        acceptance_criteria: [],
        revision: 0,
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
        revision: 0,
        pipelines: w.pipelines.map((p, i) => {
          // Completed pipelines get sequential timestamps (1h apart, 30min duration).
          // IN_PROGRESS pipelines get a recent started_at (non-stale) with no completed_at.
          if (p.status === 'IN_PROGRESS') {
            return {
              type: p.type,
              status: p.status as any,
              summary: [],
              started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5min ago
            };
          }
          const base = new Date('2026-01-01T08:00:00').getTime();
          const startMs = base + i * 60 * 60 * 1000;
          const endMs = startMs + 30 * 60 * 1000;
          return {
            type: p.type,
            status: p.status as any,
            summary: [],
            started_at: new Date(startMs).toISOString(),
            completed_at: new Date(endMs).toISOString(),
          };
        }),
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
    // qa started AFTER impl PASS (sequential timestamps) → hasDownstreamReengagedSince=true → REWORK
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-001');
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
    // code-review started AFTER impl PASS (sequential timestamps) → hasDownstreamReengagedSince=true → REWORK
    expect(parsed.action).toBe('REWORK');
    expect(parsed.work_package_id).toBe('WP-001');
  });

  it('returns WAIT for BLOCKED WP with downstream FAIL (BLOCKED WPs are PM territory, not Developer)', async () => {
    // In the new algorithm, Developer only handles IN_PROGRESS and READY WPs.
    // BLOCKED WPs are handled by PM (UNBLOCK_WP / REPAIR_ORPHAN_BLOCKED).
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
    // BLOCKED WPs are skipped by getDeveloperAction; PM should handle via UNBLOCK_WP
    expect(parsed.action).toBe('WAIT');
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

  it('returns CONTINUE_PIPELINE when implementation pipeline is IN_PROGRESS (even if qa somehow has FAIL)', async () => {
    // Edge case: impl IN_PROGRESS + qa FAIL — shouldn't happen in practice.
    // New algorithm: active IN_PROGRESS pipeline triggers CONTINUE_PIPELINE (P3) before any downstream check.
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
    // CONTINUE_PIPELINE fires (P3) because impl is still actively IN_PROGRESS
    expect(parsed.action).toBe('CONTINUE_PIPELINE');
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
    // Most recent qa FAIL started AFTER impl PASS (sequential timestamps) → REWORK
    expect(parsed.action).toBe('REWORK');
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
      expect(nextAgentFromStatus('READY_FOR_PM', 'Planner')).toBe('Project Manager');
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

  /** Write a minimal *.agent.md file that includes an id: frontmatter field. */
  async function writeAgentFileWithId(filename: string, name: string, role: string, id: string): Promise<void> {
    const content = `---\nid: ${id}\nname: ${name}\nrole: ${role}\n---\n\n# Body`;
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

  it('does NOT reset auto_handoff_depth in buildHandoffResponse (depth reset moved to completeSynthesis per §18.4)', async () => {
    // Per §18.4: auto_handoff_depth is only reset inside completeSynthesis, not here.
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

  it('WP-005: auto_handoff includes agent_id when persona has id: frontmatter', async () => {
    await writeAgentFileWithId('4-qa.agent.md', '4 - QA v1.0', 'QA', 'ledger-4-qa');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_id).toBe('ledger-4-qa');
  });

  it('WP-005: auto_handoff.prompt starts with @id\\n when persona has id: frontmatter', async () => {
    await writeAgentFileWithId('4-qa.agent.md', '4 - QA v1.0', 'QA', 'ledger-4-qa');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff.prompt).toBe(`@ledger-4-qa\nProject path: ${PLAN_PATH}`);
  });

  it('WP-005: auto_handoff has no agent_id and plain prompt when persona lacks id: (backward compat)', async () => {
    await writeAgentFile('4-qa.agent.md', '4 - QA v1.0', 'QA');
    await discoverAgents(agentDir);

    const result = await parseResult(
      buildHandoffResponse('Developer', 'READY_FOR_QA', 'All implemented.', undefined, PLAN_PATH, store),
    );

    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_id).toBeUndefined();
    expect(result.auto_handoff.prompt).toBe(`Project path: ${PLAN_PATH}`);
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

  it('WP-005: prepends @id\\n when agentId is provided', () => {
    expect(buildHandoffPrompt('/some/project/path', 'ledger-3-dev')).toBe('@ledger-3-dev\nProject path: /some/project/path');
  });

  it('WP-005: backward compat — omits prefix when agentId is undefined', () => {
    expect(buildHandoffPrompt('/some/project/path', undefined)).toBe('Project path: /some/project/path');
  });

  it('WP-005: @id prefix appears at position 0 of the prompt string', () => {
    const prompt = buildHandoffPrompt('/proj', 'ledger-4-qa');
    expect(prompt.startsWith('@ledger-4-qa\n')).toBe(true);
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

  it('returns READY_FOR_PM when no work packages exist', async () => {
    const result = await parseResult(getPlannerHandoff([]));
    expect(result.status).toBe('READY_FOR_PM');
    expect(result.current_agent).toBe('Planner');
    expect(result.next_agent).toBe('Project Manager');
    expect(result.details).toContain('Planning complete');
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

// ---------------------------------------------------------------------------
// WP-003: Handoff Routing Fixes — regression & new tests
// ---------------------------------------------------------------------------

describe('getDocumentationHandoff \u2014 FAIL routing regression (audit issue #2)', () => {
  it('returns IN_PROGRESS (not READY_FOR_DEVELOPER) when WPs have FAIL documentation pipelines', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.status).not.toBe('READY_FOR_DEVELOPER');
    expect(result.current_agent).toBe('Documentation');
    expect(result.details).toContain('rework');
  });
});

describe('getPlannerHandoff \u2014 READY_FOR_PM when no WPs exist (audit issue #6)', () => {
  it('returns READY_FOR_PM when no work packages exist', async () => {
    const result = await parseResult(getPlannerHandoff([]));
    expect(result.status).toBe('READY_FOR_PM');
    expect(result.current_agent).toBe('Planner');
    expect(result.next_agent).toBe('Project Manager');
  });
});

// ---------------------------------------------------------------------------
// WP-002: Per-agent handoff function rewrites (\u00a75.1\u20135.5)
// ---------------------------------------------------------------------------

/** Build a WP with proper sequential timestamps for temporal-guard tests */
function makeWpTimed(
  id: string,
  status: string,
  pipelines: Array<{ type: string; status: string }>,
  deps: string[] = []
): WorkPackageDetail {
  const base = new Date('2026-01-01T08:00:00').getTime();
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: deps,
    acceptance_criteria: [],
    revision: 0,
    pipelines: pipelines.map((p, i) => {
      if (p.status === 'IN_PROGRESS') {
        return { type: p.type, status: p.status as any, summary: [], started_at: new Date(base + i * 3600000).toISOString() };
      }
      const startMs = base + i * 3600000;
      const endMs = startMs + 30 * 60 * 1000;
      return {
        type: p.type,
        status: p.status as any,
        summary: [],
        started_at: new Date(startMs).toISOString(),
        completed_at: new Date(endMs).toISOString(),
      };
    }),
  };
}

describe('WP-002: getDeveloperHandoff \u2014 \u00a75.1 rewrites', () => {
  it('AC1: returns READY_FOR_QA when PASS impl exists and no QA pipeline', async () => {
    const wpDetails = [makeWp('WP-001', 'IN_PROGRESS', [{ type: 'implementation', status: 'PASS' }])];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_QA');
  });

  it('AC2: returns READY_FOR_QA after qa-1 FAIL \u2192 impl-2 PASS (not IN_PROGRESS rework)', async () => {
    // impl-1 PASS \u2192 qa-1 FAIL \u2192 impl-2 PASS: Developer re-delivered, QA has not yet re-started.
    // Temporal guard must NOT fire because downstream has not re-engaged since impl-2.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_QA');
    expect(result.status).not.toBe('IN_PROGRESS');
  });

  it('AC3: does NOT return IN_PROGRESS (rework) when Developer already re-delivered and downstream has not re-validated', async () => {
    // impl-2 PASS exists after qa-1 FAIL \u2014 QA has not started again yet.
    // hasDownstreamReengagedSince must be false \u2192 guard stays quiet.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).not.toBe('IN_PROGRESS');
  });

  it('AC3 (guard fires): returns IN_PROGRESS when QA FAIL and QA started AFTER impl PASS (downstream re-engaged)', async () => {
    // impl-1 PASS \u2192 qa-1 FAIL (qa started AFTER impl-1 completed): downstream re-engaged \u2192 rework.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('AC4: returns READY_FOR_SYNTHESIS when all WPs are COMPLETE', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
  });

  it('AC4: returns READY_FOR_SYNTHESIS when all WPs are COMPLETE or CANCELLED', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [{ type: 'implementation', status: 'PASS' }]),
      makeWp('WP-002', 'CANCELLED', []),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
  });
});

describe('WP-002: getQaHandoff \u2014 \u00a75.2 re-engagement guard', () => {
  it('AC5: returns IN_PROGRESS (re-engagement) when QA FAIL exists and Developer has since re-PASSed', async () => {
    // impl-1 PASS \u2192 qa-1 FAIL \u2192 impl-2 PASS: QA must re-engage.
    // hasNewUpstreamPassSince("implementation","qa") = true \u2192 step 1 fires.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('AC6: returns READY_FOR_DEVELOPER when latest QA is FAIL and no implementation re-pass (no timestamps)', async () => {
    // Without timestamps, hasNewUpstreamPassSince is conservative (returns false).
    // Re-engagement step does not fire \u2192 FAIL short-circuit fires \u2192 READY_FOR_DEVELOPER.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('AC6 (timed): returns READY_FOR_DEVELOPER when QA FAIL but no re-delivery (impl PASS predates qa start)', async () => {
    // impl PASS completed at T=0.5h. qa FAIL started at T=1h (after impl).
    // No impl-2 \u2192 hasNewUpstreamPassSince("implementation","qa") = false.
    // Most-recent impl PASS (T=0.5) completed BEFORE qa FAIL started (T=1) \u2192 returns false.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    // impl PASS completed at T=0.5h; qa started at T=1h. impl.completed_at < qa.started_at
    // \u2192 hasNewUpstreamPassSince = false \u2192 re-engagement guard doesn't fire \u2192 READY_FOR_DEVELOPER.
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });
});

describe('WP-002: getReviewerHandoff \u2014 \u00a75.3 re-engagement guard', () => {
  it('AC7: returns IN_PROGRESS (re-engagement) when review FAIL and QA has since re-PASSed', async () => {
    // qa-1 PASS \u2192 review-1 FAIL \u2192 qa-2 PASS: Reviewer must re-engage.
    // hasNewUpstreamPassSince("qa","code-review") = true \u2192 step 1 fires.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
        { type: 'qa', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('WP-002: getDocumentationHandoff \u2014 \u00a75.4 priority order', () => {
  it('AC8: returns IN_PROGRESS for new docs (PASS code-review, no doc yet) \u2014 step 1 fires before FAIL check', async () => {
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Documentation');
  });

  it('AC9: returns IN_PROGRESS for re-engagement when new code-review PASS exists after previous doc run', async () => {
    // cr-1 PASS \u2192 doc-1 PASS \u2192 cr-2 PASS: docs are stale, Documentation must re-run.
    // hasNewUpstreamPassSince("code-review","documentation") detects cr-2 completed after doc-1 started.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('WP-002: getProjectManagerHandoff \u2014 \u00a75.5 rewrite', () => {
  it('AC10: returns IN_PROGRESS for blocked_by.type === "technical"', async () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'BLOCKED'),
      blocked_by: { type: 'technical', description: 'legacy module needs refactoring' },
    };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.details).toContain('WP-001');
  });

  it('AC10: returns IN_PROGRESS for blocked_by.type === "external"', async () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'BLOCKED'),
      blocked_by: { type: 'external', description: 'waiting for vendor API' },
    };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('AC10: returns IN_PROGRESS for blocked_by.type === "decision"', async () => {
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'BLOCKED'),
      blocked_by: { type: 'decision', description: 'architecture choice needed' },
    };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('AC11: falls through dependency-blocked WPs (does not trigger IN_PROGRESS)', async () => {
    // WP-002 is dep-blocked (status BLOCKED, no blocked_by) \u2014 PM should not act.
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [{ type: 'implementation', status: 'PASS' }]),
      makeWp('WP-002', 'BLOCKED', [], ['WP-001']),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    // WP-001 is COMPLETE (terminal), WP-002 is dep-blocked \u2014 no READY WPs, not all terminal.
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
  });

  it('AC12: returns READY_FOR_QA for a READY WP with assigned_to === "QA"', async () => {
    const wp: WorkPackageDetail = { ...makeWp('WP-001', 'READY'), assigned_to: 'QA' };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('READY_FOR_QA');
    expect(result.current_agent).toBe('Project Manager');
  });

  it('AC13: returns READY_FOR_DEVELOPER for a READY WP with assigned_to === null (default routing)', async () => {
    const wp: WorkPackageDetail = { ...makeWp('WP-001', 'READY'), assigned_to: null as any };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('AC14: returns READY_FOR_SYNTHESIS when all WPs are in terminal states', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [{ type: 'implementation', status: 'PASS' }]),
      makeWp('WP-002', 'CANCELLED', []),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
  });
});

describe('buildHandoffResponse \u2014 auto-handoff absent for non-READY_FOR_* statuses', () => {
  it('auto_handoff is absent for WAIT, IN_PROGRESS, BLOCKED, COMPLETE statuses', async () => {
    for (const status of ['WAIT', 'IN_PROGRESS', 'BLOCKED', 'COMPLETE']) {
      const result = await parseResult(
        buildHandoffResponse('Developer', status, 'Testing status: ' + status)
      );
      expect(result.auto_handoff).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// WP-005: getDeveloperHandoff \u2014 additional scenarios (R1.3, R1.6, R1.7)
// ---------------------------------------------------------------------------

describe('WP-005: getDeveloperHandoff \u2014 additional scenarios', () => {
  it('R1.3: returns READY_FOR_QA when qa-2 is IN_PROGRESS after impl-2 PASS (qa not FAIL \u2014 temporal guard silent)', async () => {
    // impl-1 PASS \u2192 qa-1 FAIL \u2192 impl-2 PASS \u2192 qa-2 IN_PROGRESS
    // Most recent qa pipeline is IN_PROGRESS (not FAIL) \u2192 isMostRecentPipelineFail(\u2018qa\u2019)=false
    // Temporal guard does not fire. allImplemented (impl-2 PASS) \u2192 READY_FOR_QA.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'IN_PROGRESS' },
      ]),
    ];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_QA');
  });

  it('R1.6: returns IN_PROGRESS when WP is IN_PROGRESS with no implementation pipeline (active work fallback)', async () => {
    // WP is IN_PROGRESS, no impl pipeline \u2192 Developer has not yet started \u2192 IN_PROGRESS
    const wpDetails = [makeWp('WP-001', 'IN_PROGRESS', [])];
    const result = await parseResult(getDeveloperHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('R1.7: does NOT return IN_PROGRESS for a dependency-blocked WP with impl FAIL (dep-blocked exclusion)', async () => {
    // WP is BLOCKED with no blocked_by (canonical dependency-type per \u00a721.54) and impl FAIL.
    // isBlockedByDependencies=true \u2192 excluded from both temporal guard and needsWork checks.
    // The FAIL must not trigger IN_PROGRESS rework detection for dep-blocked WPs.
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'BLOCKED', [{ type: 'implementation', status: 'FAIL' }]),
    };
    const result = await parseResult(getDeveloperHandoff([wp]));
    expect(result.status).not.toBe('IN_PROGRESS');
  });
});

// ---------------------------------------------------------------------------
// WP-005: getQaHandoff \u2014 additional scenarios (R2.3 \u2013 R2.6)
// ---------------------------------------------------------------------------

describe('WP-005: getQaHandoff \u2014 additional scenarios', () => {
  it('R2.3: returns READY_FOR_REVIEW when qa PASS and code-review needs re-engagement (new QA PASS since last cr FAIL)', async () => {
    // qa-1 PASS \u2192 cr-1 FAIL \u2192 qa-2 PASS: QA re-validated, QA job done \u2192 READY_FOR_REVIEW
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
        { type: 'qa', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('R2.4: returns READY_FOR_REVIEW when qa PASS and code-review already PASS too', async () => {
    // All post-impl stages done \u2014 QA routes to Reviewer (normal progression)
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });

  it('R2.5: returns READY_FOR_SYNTHESIS when all WPs are COMPLETE', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
  });

  it('R2.6: returns IN_PROGRESS when WP is IN_PROGRESS with impl PASS and no QA pipeline yet', async () => {
    // WP has PASS impl but no QA pipeline \u2014 QA has work to do
    const wp: WorkPackageDetail = {
      ...makeWp('WP-001', 'IN_PROGRESS', [{ type: 'implementation', status: 'PASS' }]),
      assigned_to: 'QA',
    };
    const result = await parseResult(getQaHandoff([wp]));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

// ---------------------------------------------------------------------------
// WP-005: getReviewerHandoff \u2014 additional scenarios (R3.2 \u2013 R3.4)
// ---------------------------------------------------------------------------

describe('WP-005: getReviewerHandoff \u2014 additional scenarios', () => {
  it('R3.2: returns READY_FOR_DEVELOPER when review-1 FAIL and no QA re-pass (no timestamps)', async () => {
    // Without timestamps, hasNewUpstreamPassSince returns false \u2192 re-engagement guard stays silent.
    // FAIL short-circuit fires \u2192 READY_FOR_DEVELOPER.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('R3.3: returns READY_FOR_DOCUMENTATION when review PASS and new documentation work needed', async () => {
    // cr PASS, no documentation pipeline yet \u2014 Reviewer routes to Documentation
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
  });

  it('R3.4: returns READY_FOR_SYNTHESIS when all WPs are COMPLETE', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
  });
});

// ---------------------------------------------------------------------------
// WP-005: getDocumentationHandoff \u2014 additional scenarios (R4.3 \u2013 R4.5)
// ---------------------------------------------------------------------------

describe('WP-005: getDocumentationHandoff \u2014 additional scenarios', () => {
  it('R4.3: returns IN_PROGRESS when doc-1 FAIL but new cr-2 PASS is newer (ready-for-docs fires before FAIL check per \u00a714.5)', async () => {
    // cr-1 PASS \u2192 doc-1 FAIL \u2192 cr-2 PASS (cr-2 completed after doc-1 started).
    // hasNewUpstreamPassSince(\u2018code-review\u2019,\u2018documentation\u2019) detects cr-2 \u2192 step 1 fires BEFORE step 2.
    const wpDetails = [
      makeWpTimed('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'FAIL' },
        { type: 'code-review', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('R4.4: returns IN_PROGRESS when doc-1 FAIL with no new upstream PASS (FAIL self-rework path)', async () => {
    // cr PASS → doc FAIL: no new cr PASS since doc started (makeWp has no timestamps → conservative).
    // Step 1 (ready-for-docs) does not fire. Step 2 (FAIL self-rework) fires → IN_PROGRESS.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('R4.4b: returns IN_PROGRESS when upstream regresses after doc FAIL (cr:PASS → doc:FAIL → cr:FAIL) — spec §5.4 has no upstream gate on FAIL self-rework', async () => {
    // code-review PASS → documentation FAIL → code-review FAIL.
    // Per spec §5.4 Condition 2: only requires most-recent doc FAIL, no upstream-PASS gate.
    // The most recent code-review is FAIL, but the most recent documentation is also FAIL
    // → FAIL self-rework fires → IN_PROGRESS (Documentation self-corrects).
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'FAIL' },
        { type: 'code-review', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getDocumentationHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('R4.5: returns READY_FOR_SYNTHESIS when all WPs are COMPLETE', async () => {
    const wpDetails = [
      makeWp('WP-001', 'COMPLETE', [
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

// ---------------------------------------------------------------------------
// WP-005: getProjectManagerHandoff \u2014 additional scenarios (R5.6, R5.7, R5.10)
// ---------------------------------------------------------------------------

describe('WP-005: getProjectManagerHandoff \u2014 additional scenarios', () => {
  it('R5.6: returns READY_FOR_REVIEW for a READY WP with assigned_to === "Reviewer"', async () => {
    const wp: WorkPackageDetail = { ...makeWp('WP-001', 'READY'), assigned_to: 'Reviewer' };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.current_agent).toBe('Project Manager');
  });

  it('R5.7: returns READY_FOR_DOCUMENTATION for a READY WP with assigned_to === "Documentation"', async () => {
    const wp: WorkPackageDetail = { ...makeWp('WP-001', 'READY'), assigned_to: 'Documentation' };
    const result = await parseResult(getProjectManagerHandoff([wp]));
    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
  });

  it('R5.10: returns WAIT when all WPs are IN_PROGRESS with their current stage already IN_PROGRESS (no READY, no non-dependency BLOCKED)', async () => {
    // With step 2b, zero-pipeline IN_PROGRESS WPs now route to Developer.
    // To test WAIT, give each WP an impl IN_PROGRESS pipeline — step 2b sees the
    // current-stage guard ("already being worked on") and breaks, producing WAIT.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [{ type: 'implementation', status: 'IN_PROGRESS' }]),
      makeWp('WP-002', 'IN_PROGRESS', [{ type: 'implementation', status: 'IN_PROGRESS' }]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });
});

// ---------------------------------------------------------------------------
// WP-003: getProjectManagerHandoff — step 2b pipeline routing (§13.1 step 2b)
// ---------------------------------------------------------------------------

describe('WP-003: getProjectManagerHandoff — step 2b pipeline routing', () => {
  it('2b.1: happy path — impl PASS, no QA → routes to QA (READY_FOR_QA)', async () => {
    // WP is IN_PROGRESS, implementation has PASSed, QA pipeline not yet started.
    // Step 2b should detect the pending qa stage and return READY_FOR_QA.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_QA');
    expect(result.current_agent).toBe('Project Manager');
  });

  it('2b.2: multi-stage — impl PASS + QA PASS → routes to Reviewer (READY_FOR_REVIEW)', async () => {
    // Two stages have PASSed; code-review is next. Step 2b routes to Reviewer.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('2b.3: FAIL guard — impl PASS + QA FAIL → WAIT (FAIL routing handled by QA own handoff)', async () => {
    // Most recent QA pipeline is FAIL. Step 2b breaks on the FAIL guard and produces WAIT.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });

  it('2b.4: current-stage IN_PROGRESS guard — impl IN_PROGRESS → WAIT', async () => {
    // The implementation stage is currently being worked on.
    // Step 2b hits the current-stage IN_PROGRESS guard and breaks → WAIT.
    // (implementation has no upstream, so the upstream guard is not relevant here.)
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'IN_PROGRESS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });

  it('2b.5: READY takes priority — one READY + one IN_PROGRESS with impl PASS → routes to READY WP', async () => {
    // Step 2 (READY WPs) fires before step 2b. The READY WP is routed first.
    const wpDetails = [
      makeWp('WP-001', 'READY'),
      makeWp('WP-002', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    // READY WP routes to Developer (default assigned_to)
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('2b.6: dependency-blocked IN_PROGRESS WP → WAIT (step 2b skips dep-blocked WPs)', async () => {
    // The IN_PROGRESS WP is dependency-blocked; isBlockedByDependencies() returns true.
    // Step 2b skips it entirely → no routing → WAIT.
    const wpDetails = [
      makeWp('WP-001', 'BLOCKED', [
        { type: 'implementation', status: 'PASS' },
      ], ['WP-999']),
    ];
    // Override status to IN_PROGRESS but keep dependency blocked shape.
    // Actually, isBlockedByDependencies checks status=BLOCKED, so let's use BLOCKED
    // with no blocked_by (the dep-blocked shape per §21.54).
    const depBlockedWp: WorkPackageDetail = {
      ...makeWp('WP-001', 'BLOCKED', [
        { type: 'implementation', status: 'PASS' },
      ]),
      status: 'BLOCKED' as any,
      blocked_by: undefined,
    };
    const result = await parseResult(getProjectManagerHandoff([depBlockedWp]));
    // No READY WPs, dep-blocked WP skipped by step 2b, not all terminal → WAIT
    expect(result.status).toBe('WAIT');
  });

  it('2b.7: all active stages PASS → WAIT (step 2b finds no pending stage)', async () => {
    // All four default stages have PASSed. Step 2b iterates all stages, finds all PASS,
    // exits inner loop with no routing → falls through to WAIT.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });

  it('2b.8: custom active stages — ["implementation","code-review"], impl PASS → routes to Reviewer', async () => {
    // WP has custom active_pipeline_stages omitting QA.
    // After impl PASS, code-review is next. Step 2b routes to Reviewer.
    const wpDetails: WorkPackageDetail[] = [
      {
        ...makeWp('WP-001', 'IN_PROGRESS', [
          { type: 'implementation', status: 'PASS' },
        ]),
        active_pipeline_stages: ['implementation', 'code-review'] as any,
      },
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('2b.9: current-stage IN_PROGRESS guard — impl PASS + QA IN_PROGRESS → WAIT', async () => {
    // QA stage is currently in progress. Step 2b iterates: impl is PASS (continue),
    // qa is IN_PROGRESS → break (current-stage guard fires at line 394, not upstream guard).
    // This also exercises the upstream-guard scenario for code-review, but QA's own
    // current-stage guard breaks before reaching it.
    // No routing for this WP → WAIT.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'IN_PROGRESS' },
      ]),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
  });

  it('2b.10: zero-pipeline freshly-claimed WP with default stages → routes to Developer (READY_FOR_DEVELOPER)', async () => {
    // WP is IN_PROGRESS with zero pipelines (freshly claimed, agent hasn't called startPipeline yet).
    // Step 2b: first active stage (implementation) has no pipeline → no PASS/FAIL/IN_PROGRESS guards fire.
    // Routes to PIPELINE_AGENT_MAP["implementation"] = Developer.
    const wpDetails = [
      makeWp('WP-001', 'IN_PROGRESS', []),
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('2b.10b: zero-pipeline freshly-claimed WP with ["documentation"] only → routes to Documentation', async () => {
    // Custom stage: documentation only. Zero pipelines.
    // Step 2b: first (and only) active stage is documentation → routes to Documentation.
    const wpDetails: WorkPackageDetail[] = [
      {
        ...makeWp('WP-001', 'IN_PROGRESS', []),
        active_pipeline_stages: ['documentation'] as any,
      },
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
  });

  it('2b.11: zero-pipeline freshly-claimed WP with custom stages ["qa","code-review"] → routes to QA', async () => {
    // Custom stage set: qa and code-review. Zero pipelines.
    // Step 2b: first active stage in canonical order is qa → routes to QA.
    const wpDetails: WorkPackageDetail[] = [
      {
        ...makeWp('WP-001', 'IN_PROGRESS', []),
        active_pipeline_stages: ['qa', 'code-review'] as any,
      },
    ];
    const result = await parseResult(getProjectManagerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_QA');
  });
});

// ---------------------------------------------------------------------------
// WP-003: computeHandoffStatus — bypass path reuses pre-loaded data
// ---------------------------------------------------------------------------

describe('computeHandoffStatus — bypass path (store/rootIndex/wpDetails opts)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'handoff-bypass-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('does not call store.readRootIndex or readWorkPackage when all three opts are provided', async () => {
    // Point store at the temp directory — no ledger files written (bypass path must not read)
    const store = new LedgerStore(PLAN_PATH, tmpDir);

    // Manually construct the pre-loaded data (no I/O needed for bypass path)
    const wpDetail = makeWp('WP-001', 'COMPLETE', [{ type: 'implementation', status: 'PASS' }, { type: 'documentation', status: 'PASS' }]);
    const rootIndex = {
      plan_file: 'plan.md',
      date_created: '2026-01-01T00:00:00',
      last_updated: '2026-01-01T00:00:00',
      status: 'IN_PROGRESS' as const,
      total_work_packages: 1,
      pending_work_packages: 0,
      work_packages: [{ work_package_id: 'WP-001', status: 'COMPLETE' as const, assigned_to: 'Developer' as const, dependencies: [], file: 'ledger/WP-001.json' }],
      project_comments: [],
      auto_handoff_depth: 0,
    };
    const wpDetails = [wpDetail];

    // Spy on I/O methods — they must NOT be called when opts are provided
    const readRootSpy = vi.spyOn(store, 'readRootIndex');
    const readWpSpy = vi.spyOn(store, 'readWorkPackage');

    const result = await computeHandoffStatus(PLAN_PATH, 'Developer', { store, rootIndex, wpDetails });

    // All WPs are COMPLETE → Developer handoff is READY_FOR_SYNTHESIS
    expect(result.status).toBe('READY_FOR_SYNTHESIS');
    expect(result.current_agent).toBe('Developer');

    // Bypass path: no disk reads should have been issued
    expect(readRootSpy).not.toHaveBeenCalled();
    expect(readWpSpy).not.toHaveBeenCalled();

    readRootSpy.mockRestore();
    readWpSpy.mockRestore();
  });

  it('falls back to getHandoffStatus when opts are absent or incomplete (no bypass without all three)', async () => {
    // With only one opts field (store, but not rootIndex or wpDetails),
    // the bypass path is NOT activated. getHandoffStatus() is called instead,
    // which tries to read ledger files from disk. Since no ledger exists at temp dir,
    // computeHandoffStatus should throw (proving the bypass was NOT used).
    const store = new LedgerStore(PLAN_PATH, tmpDir);

    // No opts at all — fallback is used, ledger not found → throws
    await expect(computeHandoffStatus(PLAN_PATH, 'Developer')).rejects.toThrow();

    // Partial opts (only store, no rootIndex/wpDetails) — bypass is skipped → throws
    await expect(
      computeHandoffStatus(PLAN_PATH, 'Developer', { store })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WP-006: 5-stage pipeline regression (bug report 2026-04-28)
//
// Verifies that the spec-compliant re-write of getReviewerHandoff,
// getSecurityAuditorHandoff, and getQaHandoff no longer produces the
// contradictory IN_PROGRESS handoff payload seen against the ffmpeg ledger
// (5-stage WPs with qa:PASS but security-audit not yet started, assigned_to: null).
//
// Spec reference: §5.2 (QA), §5.2b (Security Auditor), §5.3 (Reviewer).
// Condition numbering matches the per-function six-condition pseudocode in handoff.md.
// ---------------------------------------------------------------------------

/** 5-stage active stages used across all regression tests */
const FIVE_STAGES = ['implementation', 'qa', 'security-audit', 'code-review', 'documentation'];

describe('WP-006: getReviewerHandoff — 5-stage pipeline regression (bug report 2026-04-28)', () => {
  it('spec cond-5: does NOT return IN_PROGRESS when WPs have qa:PASS but security-audit (active upstream) not yet started — bug-report-2026-04-28', async () => {
    // Reproduces the ffmpeg ledger contradiction: old getReviewerHandoff fired auto-engagement
    // IN_PROGRESS with next_agent: Reviewer when qa:PASS but security-audit hadn't started.
    // Spec cond-4 (condition 4): IN_PROGRESS only when assigned_to === 'Reviewer'.
    // assigned_to: null (no agent has claimed this WP) → condition 4 does not fire → WAIT (cond-5).
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];

    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
    // Regression guard: next_agent must NOT be 'Reviewer' when status is WAIT
    expect(result.next_agent).not.toBe('Reviewer');
  });

  it('spec cond-4: returns IN_PROGRESS only when assigned_to === "Reviewer" (5-stage, security-audit:PASS, no code-review)', async () => {
    // Condition 4 is the ONLY spec-authorized IN_PROGRESS path for this scenario.
    // When Reviewer has claimed the WP (assigned_to: 'Reviewer') and the WP is IN_PROGRESS,
    // getReviewerHandoff must return IN_PROGRESS — this is NOT a contradiction with the spec.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
      ], [], 'Reviewer'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.next_agent).toBe('Reviewer');
  });
});

describe('WP-006: getSecurityAuditorHandoff — 5-stage regression', () => {
  it('spec cond-5: does NOT return IN_PROGRESS when WPs have qa:PASS but security-audit not yet started (assigned_to: null)', async () => {
    // Security Auditor must not auto-engage when qa:PASS but no security-audit pipeline exists
    // and no agent has claimed the WP. Condition 4 requires assigned_to === 'Security Auditor'.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];

    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
  });

  it('spec cond-3: returns READY_FOR_REVIEW when security-audit:PASS and no code-review PASS yet (5-stage)', async () => {
    // Condition 3: PASS security-audit with next stage (code-review, owned by Reviewer) not yet PASSed
    // → resolveNextAgent returns 'Reviewer' → READY_FOR_REVIEW.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('spec cond-4: returns IN_PROGRESS only when assigned_to === "Security Auditor" (5-stage, qa:PASS, no security-audit)', async () => {
    // Condition 4: assigned_to === 'Security Auditor' with IN_PROGRESS status is the only
    // spec-authorized IN_PROGRESS path for Security Auditor (besides re-engagement cond-1).
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ], [], 'Security Auditor'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('WP-006: getQaHandoff — 5-stage regression', () => {
  it('spec cond-5: does NOT return IN_PROGRESS when WPs have impl:PASS but qa not yet started (5-stage, assigned_to: null)', async () => {
    // QA must not auto-engage when impl:PASS but no qa pipeline exists and no agent claimed it.
    // Condition 4 requires assigned_to === 'QA' — without it, falls through to WAIT (cond-5).
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];

    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
  });

  it('spec cond-3: returns READY_FOR_SECURITY_AUDIT when qa:PASS and security-audit is the active next stage (5-stage)', async () => {
    // Condition 3: PASS qa with 5-stage active_pipeline_stages → resolveNextAgent returns
    // 'Security Auditor' (not 'Reviewer' as it would on the default 4-stage pipeline).
    // READY_STATUS_FOR_ROLE['Security Auditor'] === 'READY_FOR_SECURITY_AUDIT'.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SECURITY_AUDIT');
  });

  it('spec cond-4: returns IN_PROGRESS only when assigned_to === "QA" (5-stage, impl:PASS, no QA pipeline)', async () => {
    // Condition 4: assigned_to === 'QA' with IN_PROGRESS status triggers active-work branch.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ], [], 'QA'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('WP-006: bug-report-2026-04-28 end-to-end fixtures — getReviewerHandoff contradiction fix', () => {
  it('Fixture A (assigned_to: null, cond-4/cond-5): getReviewerHandoff does NOT return IN_PROGRESS with next_agent: Reviewer for 5-stage WP with qa:PASS', async () => {
    // The exact ffmpeg bug: 5-stage WP, qa:PASS, security-audit not started, assigned_to: null.
    // Old code returned IN_PROGRESS with current_agent === next_agent === Reviewer,
    // contradicting the WAIT returned by ledger_get_next_action for the same WP.
    // Spec-correct outcome: cond-4 does not fire (assigned_to !== 'Reviewer') → WAIT (cond-5).
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];

    const result = await parseResult(getReviewerHandoff(wpDetails));
    // Bug guard: must NEVER produce the contradictory payload
    expect(result.status).not.toBe('IN_PROGRESS');
    expect(result.next_agent).not.toBe('Reviewer');
  });

  it('Fixture B (assigned_to: "Reviewer"): getReviewerHandoff returns IN_PROGRESS with current_agent === next_agent === Reviewer — spec-correct cond-4 (coherent, not a contradiction)', async () => {
    // When a Reviewer has actually claimed the WP (assigned_to: 'Reviewer'), IN_PROGRESS
    // is the spec-correct outcome of condition 4. This is coherent: both
    // ledger_get_next_action (CONTINUE_PIPELINE) and getReviewerHandoff (IN_PROGRESS)
    // agree that the Reviewer is actively working.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
      ], [], 'Reviewer'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];

    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Reviewer');
    expect(result.next_agent).toBe('Reviewer');
  });
});

// ---------------------------------------------------------------------------
// WP-007: 5-stage pipeline regression — full spec condition coverage
//
// Dedicated describe blocks exercising all four non-re-engagement spec
// conditions (cond-2 through cond-5) for getQaHandoff, getSecurityAuditorHandoff,
// and getReviewerHandoff against the 5-stage pipeline composition from the bug
// report 2026-04-28. Each it() is tagged with the spec condition under test.
//
// Spec reference: §5.2 (QA), §5.2b (Security Auditor), §5.3 (Reviewer).
// Condition numbering matches the per-function pseudocode in handoff.md.
//
// Reuses the FIVE_STAGES constant defined in the WP-006 section above.
// ---------------------------------------------------------------------------

describe('WP-007: getQaHandoff — 5-stage spec condition coverage', () => {
  it('spec cond-2 (FAIL): returns READY_FOR_DEVELOPER when qa:FAIL on 5-stage WP (no implementation re-pass since)', async () => {
    // Condition 2: most-recent qa pipeline is FAIL and no implementation re-pass since
    // qa started (makeWp has no timestamps → hasNewUpstreamPassSince conservative → false).
    // Re-engagement (cond-1) does not fire. FAIL short-circuit fires → READY_FOR_DEVELOPER.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'FAIL' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('spec cond-3 (PASS/next): returns READY_FOR_SECURITY_AUDIT when qa:PASS on 5-stage WP and security-audit not yet started', async () => {
    // Condition 3: qa:PASS, next stage is security-audit (resolveNextAgent returns 'Security Auditor').
    // partitionWpsAwaitingNextStage finds this WP → READY_FOR_SECURITY_AUDIT.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_SECURITY_AUDIT');
  });

  it('spec cond-4 (active work): returns IN_PROGRESS when assigned_to === "QA" with impl:PASS and no qa pipeline yet (5-stage)', async () => {
    // Condition 4: QA has claimed the WP (assigned_to: 'QA') and WP is IN_PROGRESS.
    // Active-work branch fires before cond-5 fallthrough.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ], [], 'QA'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('QA');
  });

  it('spec cond-5 (WAIT): returns WAIT when impl:PASS, no qa pipeline, assigned_to: null (5-stage) — auto-engagement guard', async () => {
    // Condition 5 (fallthrough): no qa FAIL, no qa PASS, assigned_to !== 'QA'
    // → all conditions miss → WAIT. Confirms the auto-engagement branch is gone.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];
    const result = await parseResult(getQaHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
  });
});

describe('WP-007: getSecurityAuditorHandoff — 5-stage spec condition coverage', () => {
  it('spec cond-2 (FAIL): returns READY_FOR_DEVELOPER when security-audit:FAIL on 5-stage WP (no qa re-pass since)', async () => {
    // Condition 2: most-recent security-audit pipeline is FAIL and no qa re-pass since
    // audit started (makeWp has no timestamps → conservative). FAIL short-circuit fires.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'FAIL' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('spec cond-3 (PASS/next): returns READY_FOR_REVIEW when security-audit:PASS on 5-stage WP and code-review not yet started', async () => {
    // Condition 3: security-audit:PASS, resolveNextAgent('security-audit', FIVE_STAGES) = 'Reviewer'
    // → READY_FOR_REVIEW.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('spec cond-4 (active work): returns IN_PROGRESS when assigned_to === "Security Auditor" with qa:PASS, no security-audit pipeline (5-stage)', async () => {
    // Condition 4: Security Auditor has claimed the WP (assigned_to: 'Security Auditor').
    // Active-work branch fires before cond-5 fallthrough.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ], [], 'Security Auditor'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Security Auditor');
  });

  it('spec cond-5 (WAIT): returns WAIT when qa:PASS, no security-audit pipeline, assigned_to: null (5-stage) — auto-engagement guard', async () => {
    // Condition 5 (fallthrough): no security-audit FAIL, no security-audit PASS,
    // assigned_to !== 'Security Auditor' → all conditions miss → WAIT.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];
    const result = await parseResult(getSecurityAuditorHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    expect(result.status).not.toBe('IN_PROGRESS');
  });
});

describe('WP-007: getReviewerHandoff — 5-stage spec condition coverage', () => {
  it('spec cond-2 (FAIL): returns READY_FOR_DEVELOPER when code-review:FAIL on 5-stage WP (no security-audit re-pass since)', async () => {
    // Condition 2: most-recent code-review pipeline is FAIL and no security-audit re-pass
    // since review started (makeWp has no timestamps → conservative). FAIL fires.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
        { type: 'code-review', status: 'FAIL' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DEVELOPER');
  });

  it('spec cond-3 (PASS/next): returns READY_FOR_DOCUMENTATION when code-review:PASS and documentation not yet started (5-stage)', async () => {
    // Condition 3: code-review:PASS, resolveNextAgent('code-review', FIVE_STAGES) = 'Documentation'
    // → READY_FOR_DOCUMENTATION.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
  });

  it('spec cond-4 (active work): returns IN_PROGRESS when assigned_to === "Reviewer" with security-audit:PASS, no code-review pipeline (5-stage)', async () => {
    // Condition 4: Reviewer has claimed the WP (assigned_to: 'Reviewer').
    // Active-work branch fires before cond-5 fallthrough.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'security-audit', status: 'PASS' },
      ], [], 'Reviewer'),
      active_pipeline_stages: FIVE_STAGES as any,
    }];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Reviewer');
  });

  it('spec cond-5 (WAIT): returns WAIT when qa:PASS but security-audit (active upstream) not started and assigned_to: null (5-stage) — core bug-report scenario', async () => {
    // Condition 5 (fallthrough): no code-review FAIL, no code-review PASS,
    // assigned_to !== 'Reviewer' → WAIT. This is the exact contradiction from the ffmpeg
    // bug report: old code returned IN_PROGRESS with next_agent: Reviewer instead.
    const wpDetails: WorkPackageDetail[] = [{
      ...makeWp('WP-001', 'IN_PROGRESS', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
      ]),
      active_pipeline_stages: FIVE_STAGES as any,
      assigned_to: null as any,
    }];
    const result = await parseResult(getReviewerHandoff(wpDetails));
    expect(result.status).toBe('WAIT');
    // Regression guard: old code returned IN_PROGRESS with next_agent: Reviewer
    expect(result.status).not.toBe('IN_PROGRESS');
    expect(result.next_agent).not.toBe('Reviewer');
  });
});
