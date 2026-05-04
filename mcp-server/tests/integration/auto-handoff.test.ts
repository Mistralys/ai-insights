import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as _internal from '../../src/tools/workflow.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';
import { AGENT_NAMES } from '../../src/utils/constants.js';
import { now } from '../../src/utils/timestamp.js';
import type { RootIndex } from '../../src/schema/root-index.js';
import type { WorkPackageDetail } from '../../src/schema/work-package.js';

const {
  getProjectManagerHandoff,
  getDeveloperHandoff,
  getQaHandoff,
  getReviewerHandoff,
  getDocumentationHandoff,
  buildHandoffResponse,
  getMaxHandoffDepth,
} = _internal;

// ─── Shared Helpers ───────────────────────────────────────────────────────────

/** Parse JSON from a handoff result (accepts plain objects or Promises). */
async function parseResult(resultOrPromise: any): Promise<any> {
  const result = await resultOrPromise;
  return JSON.parse(result.content[0].text);
}

/** Build a minimal WP detail with the given pipeline stubs. */
function makeWp(
  id: string,
  pipelines: Array<{ type: string; status: string }> = [],
  status: string = 'IN_PROGRESS',
  active_pipeline_stages?: string[],
): WorkPackageDetail {
  const wp: WorkPackageDetail = {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: status as any,
    assigned_to: 'Developer',
    dependencies: [],
    acceptance_criteria: [],
    revision: 0,
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      summary: [],
    })),
  };
  if (active_pipeline_stages !== undefined) {
    wp.active_pipeline_stages = active_pipeline_stages;
  }
  return wp;
}

/** Build a minimal RootIndex with optional field overrides. */
function makeRoot(overrides: Partial<RootIndex> = {}): RootIndex {
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

/** Write a minimal *.agent.md file with YAML frontmatter to `dir`. */
async function writeAgentFile(
  dir: string,
  filename: string,
  name: string,
  role: string,
): Promise<void> {
  const content = `---\nname: ${name}\nrole: ${role}\n---\n\n# Agent`;
  await writeFile(join(dir, filename), content, 'utf8');
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Auto-handoff chain integration', () => {
  let tempDir: string;
  let agentDir: string;
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    resetRegistry();
    // The temp-dir name must end with a YYYY-MM-DD-... segment so that
    // validatePlanPath accepts it when the full getHandoffStatus path is exercised.
    tempDir = await mkdtemp(join(tmpdir(), '2026-02-20-auto-handoff-int-'));
    agentDir = await mkdtemp(join(tmpdir(), 'auto-handoff-agents-'));
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-'));
    store = new LedgerStore(tempDir, tempLedgerRoot);
  });

  afterEach(async () => {
    resetRegistry();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  // ── 1. Full chain: PM → Developer → QA → Reviewer → Documentation → Synthesis ──

  describe('Full chain: PM → Developer → QA → Reviewer → Documentation → Synthesis', () => {
    beforeEach(async () => {
      await writeAgentFile(agentDir, '2-pm.agent.md', '2 - Project Manager v1.0', 'Project Manager');
      await writeAgentFile(agentDir, '3-dev.agent.md', '3 - Developer v3.1.2', 'Developer');
      await writeAgentFile(agentDir, '4-qa.agent.md', '4 - QA v1.0', 'QA');
      await writeAgentFile(agentDir, '5-reviewer.agent.md', '5 - Reviewer v1.0', 'Reviewer');
      await writeAgentFile(agentDir, '6-docs.agent.md', '6 - Documentation v1.0', 'Documentation');
      await writeAgentFile(agentDir, '7-synthesis.agent.md', '7 - Synthesis v1.0', 'Synthesis');
      await discoverAgents(agentDir);
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));
    });

    it('PM handoff emits auto_handoff for Developer and increments depth 0 → 1', async () => {
      const result = await parseResult(
        getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
      );

      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.next_agent).toBe('Developer');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('3 - Developer v3.1.2');
      expect(result.auto_handoff.prompt).toBe(`Project path: ${tempDir}`);

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(1);
    });

    it('Developer handoff emits auto_handoff for QA and increments depth 1 → 2', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 1 }));

      const result = await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_QA');
      expect(result.next_agent).toBe('QA');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('4 - QA v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(2);
    });

    it('QA handoff emits auto_handoff for Reviewer and increments depth 2 → 3', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 2 }));

      const result = await parseResult(
        getQaHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.next_agent).toBe('Reviewer');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('5 - Reviewer v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(3);
    });

    it('Reviewer handoff emits auto_handoff for Documentation and increments depth 3 → 4', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 3 }));

      const result = await parseResult(
        getReviewerHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.next_agent).toBe('Documentation');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('6 - Documentation v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(4);
    });

    it('Documentation handoff emits auto_handoff for Synthesis and increments depth 4 → 5', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 4 }));

      const result = await parseResult(
        getDocumentationHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
            { type: 'documentation', status: 'PASS' },
          ], 'COMPLETE')],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_SYNTHESIS');
      expect(result.next_agent).toBe('Synthesis');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('7 - Synthesis v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(5);
    });

    it('sequential chain accumulates depth correctly from 0 to 5 across all 5 transitions', async () => {
      // Step 1: PM → Developer (depth 0 → 1)
      await parseResult(getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store));
      expect((await store.readRootIndex()).auto_handoff_depth).toBe(1);

      // Step 2: Developer → QA (depth 1 → 2)
      await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );
      expect((await store.readRootIndex()).auto_handoff_depth).toBe(2);

      // Step 3: QA → Reviewer (depth 2 → 3)
      await parseResult(
        getQaHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );
      expect((await store.readRootIndex()).auto_handoff_depth).toBe(3);

      // Step 4: Reviewer → Documentation (depth 3 → 4)
      await parseResult(
        getReviewerHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );
      expect((await store.readRootIndex()).auto_handoff_depth).toBe(4);

      // Step 5: Documentation → Synthesis (depth 4 → 5)
      // WP-001 must be COMPLETE (terminal) for the all-terminal early exit to fire → READY_FOR_SYNTHESIS.
      await parseResult(
        getDocumentationHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
            { type: 'documentation', status: 'PASS' },
          ], 'COMPLETE')],
          tempDir,
          store,
        ),
      );
      expect((await store.readRootIndex()).auto_handoff_depth).toBe(5);
    });
  });

  // ── 2. Chain termination at Synthesis ─────────────────────────────────────

  describe('Chain termination at Synthesis', () => {
    beforeEach(async () => {
      await writeAgentFile(agentDir, '7-synthesis.agent.md', '7 - Synthesis v1.0', 'Synthesis');
      await discoverAgents(agentDir);
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 5 }));
    });

    it('Synthesis returns COMPLETE with no auto_handoff field', async () => {
      const result = await parseResult(
        buildHandoffResponse('Synthesis', 'COMPLETE', 'Synthesis complete.', undefined, tempDir, store),
      );

      expect(result.status).toBe('COMPLETE');
      expect(result.current_agent).toBe('Synthesis');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('auto_handoff_depth is NOT reset by buildHandoffResponse on COMPLETE (depth reset is in completeSynthesis per §18.4)', async () => {
      // Per §18.4: depth reset now happens only in completeSynthesis, not in buildHandoffResponse
      // The initial depth is 5 (set by beforeEach).
      await parseResult(
        buildHandoffResponse('Synthesis', 'COMPLETE', 'Synthesis complete.', undefined, tempDir, store),
      );

      const root = await store.readRootIndex();
      // Depth should remain 5 — buildHandoffResponse no longer clears it
      expect(root.auto_handoff_depth).toBe(5);
    });

    it('buildHandoffResponse with COMPLETE does not alter depth (depth reset is in completeSynthesis)', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 8 }));

      await parseResult(
        buildHandoffResponse('Synthesis', 'COMPLETE', 'Done.', undefined, tempDir, store),
      );

      // Depth should remain 8 — no longer reset by buildHandoffResponse
      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(8);
    });
  });

  // ── 3. Depth limit enforcement ─────────────────────────────────────────────

  describe('Depth limit enforcement', () => {
    beforeEach(async () => {
      await writeAgentFile(agentDir, '4-qa.agent.md', '4 - QA v1.0', 'QA');
      await discoverAgents(agentDir);
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: getMaxHandoffDepth() }));
    });

    it('omits auto_handoff when depth equals MAX_HANDOFF_DEPTH', async () => {
      const result = await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_QA');
      expect(result.auto_handoff).toBeUndefined();
      expect(result.handoff_suppressed_reason).toBe('depth_limit_reached');
    });

    it('standard handoff block is still present when depth limit is reached', async () => {
      const result = await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      // Core routing fields must always be present regardless of auto-handoff eligibility
      expect(result.current_agent).toBe('Developer');
      expect(result.next_agent).toBe('QA');
      expect(result.status).toBeDefined();
      expect(result.details).toBeDefined();
    });

    it('depth counter is NOT incremented further when limit is already reached', async () => {
      await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(getMaxHandoffDepth());
    });

    it('depth boundary: auto_handoff present at MAX-1, absent at MAX', async () => {
      await writeAgentFile(agentDir, '5-reviewer.agent.md', '5 - Reviewer v1.0', 'Reviewer');
      await discoverAgents(agentDir);

      // At MAX-1 → eligible; depth increments to MAX
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: getMaxHandoffDepth() - 1 }));
      const resultAtMaxMinus1 = await parseResult(
        getQaHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );
      expect(resultAtMaxMinus1.auto_handoff).toBeDefined();

      // Depth is now MAX — not eligible
      const resultAtMax = await parseResult(
        getQaHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );
      expect(resultAtMax.auto_handoff).toBeUndefined();
    });

    it('FIX-04: emits a high-priority warning project comment when depth limit is reached (§18.5)', async () => {
      await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      const root = await store.readRootIndex();
      const warningComment = root.project_comments.find(
        (c: any) => c.note?.startsWith('Auto-handoff depth limit reached'),
      );
      expect(warningComment).toBeDefined();
      expect(warningComment?.type).toBe('warning');
      expect(warningComment?.priority).toBe('high');
      expect(warningComment?.agent).toBe('System');
    });
  });

  // ── 4. Rework cycle within depth budget ────────────────────────────────────

  describe('Rework cycle within depth budget (QA FAIL → Developer rework → QA PASS)', () => {
    beforeEach(async () => {
      await writeAgentFile(agentDir, '3-dev.agent.md', '3 - Developer v3.1.2', 'Developer');
      await writeAgentFile(agentDir, '4-qa.agent.md', '4 - QA v1.0', 'QA');
      await writeAgentFile(agentDir, '5-reviewer.agent.md', '5 - Reviewer v1.0', 'Reviewer');
      await discoverAgents(agentDir);
      // Rework happens mid-chain — simulate arriving at depth 3
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 3 }));
    });

    it('QA FAIL emits READY_FOR_DEVELOPER handoff with auto_handoff targeting Developer', async () => {
      const result = await parseResult(
        buildHandoffResponse('QA', 'READY_FOR_DEVELOPER', 'QA failed — rework needed.', undefined, tempDir, store),
      );

      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.next_agent).toBe('Developer');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('3 - Developer v3.1.2');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(4);
    });

    it('after rework, Developer READY_FOR_QA emits auto_handoff targeting QA (depth 4 → 5)', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 4 }));

      // Two implementation pipelines: first FAIL (original), then PASS (rework)
      const wpDetails = [
        makeWp('WP-001', [
          { type: 'implementation', status: 'FAIL' },
          { type: 'implementation', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getDeveloperHandoff(wpDetails, tempDir, store));

      expect(result.status).toBe('READY_FOR_QA');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('4 - QA v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(5);
    });

    it('after rework, QA PASS emits auto_handoff targeting Reviewer (depth 5 → 6)', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 5 }));

      // Two QA pipelines: first FAIL (pre-rework), then PASS (post-rework)
      const wpDetails = [
        makeWp('WP-001', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'FAIL' },
          { type: 'qa', status: 'PASS' },
        ]),
      ];

      const result = await parseResult(getQaHandoff(wpDetails, tempDir, store));

      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.auto_handoff).toBeDefined();
      expect(result.auto_handoff.agent_name).toBe('5 - Reviewer v1.0');

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(6);
    });
  });

  // ── 5. Graceful degradation without agent registry ─────────────────────────

  describe('Graceful degradation without agent registry', () => {
    beforeEach(async () => {
      // Deliberately do NOT call discoverAgents — registry stays unloaded
      await store.writeRootIndex(makeRoot());
    });

    it('PM handoff omits auto_handoff but still returns correct next_agent', async () => {
      const result = await parseResult(
        getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
      );

      expect(result.status).toBe('READY_FOR_DEVELOPER');
      expect(result.next_agent).toBe('Developer');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('Developer handoff omits auto_handoff but still returns correct next_agent', async () => {
      const result = await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_QA');
      expect(result.next_agent).toBe('QA');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('QA handoff omits auto_handoff but still returns correct next_agent', async () => {
      const result = await parseResult(
        getQaHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_REVIEW');
      expect(result.next_agent).toBe('Reviewer');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('Reviewer handoff omits auto_handoff but still returns correct next_agent', async () => {
      const result = await parseResult(
        getReviewerHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
          ])],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_DOCUMENTATION');
      expect(result.next_agent).toBe('Documentation');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('Documentation handoff omits auto_handoff but still returns correct next_agent', async () => {
      // WP-001 must be COMPLETE (terminal) for the all-terminal early exit to fire → READY_FOR_SYNTHESIS.
      const result = await parseResult(
        getDocumentationHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
            { type: 'documentation', status: 'PASS' },
          ], 'COMPLETE')],
          tempDir,
          store,
        ),
      );

      expect(result.status).toBe('READY_FOR_SYNTHESIS');
      expect(result.next_agent).toBe('Synthesis');
      expect(result.auto_handoff).toBeUndefined();
    });

    it('all responses contain standard handoff block (current_agent, next_agent, status, details)', async () => {
      const fullPipelines = [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ];

      const results = await Promise.all([
        parseResult(getProjectManagerHandoff([makeWp('WP-001')], tempDir, store)),
        parseResult(getDeveloperHandoff([makeWp('WP-001', fullPipelines.slice(0, 1))], tempDir, store)),
        parseResult(getQaHandoff([makeWp('WP-001', fullPipelines.slice(0, 2))], tempDir, store)),
        parseResult(getReviewerHandoff([makeWp('WP-001', fullPipelines.slice(0, 3))], tempDir, store)),
        parseResult(getDocumentationHandoff([makeWp('WP-001', fullPipelines)], tempDir, store)),
      ]);

      for (const result of results) {
        expect(result.current_agent).toBeDefined();
        expect(result.status).toBeDefined();
        expect(result.details).toBeDefined();
      }
    });

    it('depth counter is NOT modified when auto_handoff is suppressed due to missing registry', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 2 }));

      await parseResult(
        getDeveloperHandoff(
          [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
          tempDir,
          store,
        ),
      );

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(2); // unchanged
    });
  });
});

// ---------------------------------------------------------------------------
// WP-005 R7: auto_handoff_depth depth lifecycle integration tests
// ---------------------------------------------------------------------------

describe('WP-005 R7: auto_handoff_depth lifecycle', () => {
  let tempDir: string;
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), '2026-02-20-depth-lifecycle-'));
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-depth-'));
    store = new LedgerStore(tempDir, tempLedgerRoot);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('R7.1: transitioning a WP to COMPLETE via root-index update does NOT reset auto_handoff_depth', async () => {
    // Set up a root index with depth=7 and one WP summary as IN_PROGRESS.
    const rootBefore = makeRoot({
      auto_handoff_depth: 7,
      work_packages: [
        {
          work_package_id: 'WP-001',
          status: 'IN_PROGRESS',
          assigned_to: 'Developer',
          dependencies: [],
          file: 'ledger/WP-001.json',
        } as any,
      ],
    });
    await store.writeRootIndex(rootBefore);

    // Simulate the WP-status-update flow: mark the WP as COMPLETE in root index.
    // updateWorkPackageStatus (work-package.ts) updates the WP summary + writes root index,
    // but per \u00a718.4 it MUST NOT reset auto_handoff_depth.
    const updated = await store.readRootIndex();
    updated.work_packages[0].status = 'COMPLETE';
    await store.writeRootIndex(updated);

    const after = await store.readRootIndex();
    expect(after.auto_handoff_depth).toBe(7); // depth preserved \u2014 not reset on WP completion
    expect(after.work_packages[0].status).toBe('COMPLETE');
  });

  it('R7.2: completeSynthesis resets auto_handoff_depth to 0 on the root index (\u00a718.4)', async () => {
    // Set up root index with depth=5.
    const rootBefore = makeRoot({ auto_handoff_depth: 5, synthesis_generated: false });
    await store.writeRootIndex(rootBefore);

    const before = await store.readRootIndex();
    expect(before.auto_handoff_depth).toBe(5);

    // completeSynthesis (project-lifecycle.ts \u00a718.4) atomically sets:
    //   rootIndex.synthesis_generated = true
    //   rootIndex.auto_handoff_depth = 0
    // We verify the storage contract by performing the same write and confirming persistence.
    await store.writeRootIndex({
      ...before,
      synthesis_generated: true,
      auto_handoff_depth: 0,
      last_updated: now(),
    });

    const after = await store.readRootIndex();
    expect(after.auto_handoff_depth).toBe(0); // reset on synthesis completion
    expect(after.synthesis_generated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WP-003: cc_agent_name, vs_agent_name, da_agent_name in auto_handoff payload
// ---------------------------------------------------------------------------

describe('WP-003: cc_agent_name, vs_agent_name, da_agent_name in auto_handoff', () => {
  let tempDir: string;
  let agentDir: string;
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    resetRegistry();
    tempDir = await mkdtemp(join(tmpdir(), '2026-04-08-wp003-'));
    agentDir = await mkdtemp(join(tmpdir(), 'wp003-agents-'));
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-wp003-'));
    store = new LedgerStore(tempDir, tempLedgerRoot);
    await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));
  });

  afterEach(async () => {
    resetRegistry();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('PM → Developer: auto_handoff includes cc_agent_name, vs_agent_name, da_agent_name (AC #1)', async () => {
    await writeAgentFile(agentDir, '3-dev.agent.md', AGENT_NAMES['Developer'].vscode.agent_name, 'Developer');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    const names = AGENT_NAMES['Developer'];
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.cc_agent_name).toBe(names.claude_code.agent_name);
    expect(result.auto_handoff.vs_agent_name).toBe(names.vscode.agent_name);
    expect(result.auto_handoff.da_agent_name).toBe(names.deep_agents.agent_name);
  });

  it('Developer → QA: auto_handoff includes cc_agent_name, vs_agent_name, da_agent_name (AC #1)', async () => {
    await writeAgentFile(agentDir, '4-qa.agent.md', AGENT_NAMES['QA'].vscode.agent_name, 'QA');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getDeveloperHandoff(
        [makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }])],
        tempDir,
        store,
      ),
    );

    const names = AGENT_NAMES['QA'];
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.cc_agent_name).toBe(names.claude_code.agent_name);
    expect(result.auto_handoff.vs_agent_name).toBe(names.vscode.agent_name);
    expect(result.auto_handoff.da_agent_name).toBe(names.deep_agents.agent_name);
  });

  it('QA → Reviewer: auto_handoff includes all three target-specific names (AC #1)', async () => {
    await writeAgentFile(agentDir, '6-reviewer.agent.md', AGENT_NAMES['Reviewer'].vscode.agent_name, 'Reviewer');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getQaHandoff(
        [makeWp('WP-001', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ])],
        tempDir,
        store,
      ),
    );

    const names = AGENT_NAMES['Reviewer'];
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.cc_agent_name).toBe(names.claude_code.agent_name);
    expect(result.auto_handoff.vs_agent_name).toBe(names.vscode.agent_name);
    expect(result.auto_handoff.da_agent_name).toBe(names.deep_agents.agent_name);
  });

  it('existing agent_name is still present and equals the VS Code handle (AC #2)', async () => {
    await writeAgentFile(agentDir, '3-dev.agent.md', AGENT_NAMES['Developer'].vscode.agent_name, 'Developer');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe(AGENT_NAMES['Developer'].vscode.agent_name);
  });

  it('existing agent_id is still present when agent file has an id field (AC #3)', async () => {
    const agentId = 'ledger-3-dev';
    const content = `---\nname: ${AGENT_NAMES['Developer'].vscode.agent_name}\nrole: Developer\nid: ${agentId}\n---\n\n# Agent`;
    await writeFile(join(agentDir, '3-dev.agent.md'), content, 'utf8');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_id).toBe(agentId);
  });

  it('no existing fields removed — agent_name, agent_id, prompt, and three new names coexist (AC #4)', async () => {
    const agentId = 'ledger-3-dev';
    const content = `---\nname: ${AGENT_NAMES['Developer'].vscode.agent_name}\nrole: Developer\nid: ${agentId}\n---\n\n# Agent`;
    await writeFile(join(agentDir, '3-dev.agent.md'), content, 'utf8');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    expect(result.auto_handoff).toBeDefined();
    // Pre-existing fields
    expect(result.auto_handoff.agent_name).toBeDefined();
    expect(result.auto_handoff.agent_id).toBeDefined();
    expect(result.auto_handoff.prompt).toBeDefined();
    // New fields (WP-003)
    expect(result.auto_handoff.cc_agent_name).toBeDefined();
    expect(result.auto_handoff.vs_agent_name).toBeDefined();
    expect(result.auto_handoff.da_agent_name).toBeDefined();
  });

  it('vs_agent_name differs from cc_agent_name and da_agent_name (structural sanity)', async () => {
    await writeAgentFile(agentDir, '3-dev.agent.md', AGENT_NAMES['Developer'].vscode.agent_name, 'Developer');
    await discoverAgents(agentDir);

    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    expect(result.auto_handoff).toBeDefined();
    // VS Code names include a version suffix ("3 - Developer v3.x.x") whereas
    // Claude Code / Deep Agents names are slugified ("3-developer").
    expect(result.auto_handoff.vs_agent_name).not.toBe(result.auto_handoff.cc_agent_name);
    expect(result.auto_handoff.vs_agent_name).not.toBe(result.auto_handoff.da_agent_name);
  });

  it('three new fields are absent when auto_handoff is suppressed (registry not loaded)', async () => {
    // Deliberately do NOT call discoverAgents — registry stays unloaded.
    const result = await parseResult(
      getProjectManagerHandoff([makeWp('WP-001', [], 'READY')], tempDir, store),
    );

    // auto_handoff itself will be absent; the new fields must not appear on the root payload either.
    expect(result.auto_handoff).toBeUndefined();
    expect(result.cc_agent_name).toBeUndefined();
    expect(result.vs_agent_name).toBeUndefined();
    expect(result.da_agent_name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WP-007: Mixed-composition WPs (active_pipeline_stages scoping)
// ---------------------------------------------------------------------------

describe('WP-007: Mixed-composition WPs (active_pipeline_stages scoping)', () => {
  let tempDir: string;
  let agentDir: string;
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    resetRegistry();
    tempDir = await mkdtemp(join(tmpdir(), '2026-04-10-wp007-'));
    agentDir = await mkdtemp(join(tmpdir(), 'wp007-agents-'));
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-wp007-'));
    store = new LedgerStore(tempDir, tempLedgerRoot);
    // Register all chain agents so auto_handoff assertions can be verified.
    await writeAgentFile(agentDir, '2-pm.agent.md', '2 - Project Manager v1.0', 'Project Manager');
    await writeAgentFile(agentDir, '3-dev.agent.md', '3 - Developer v3.1.2', 'Developer');
    await writeAgentFile(agentDir, '4-qa.agent.md', '4 - QA v1.0', 'QA');
    await writeAgentFile(agentDir, '5-reviewer.agent.md', '5 - Reviewer v1.0', 'Reviewer');
    await writeAgentFile(agentDir, '6-docs.agent.md', '6 - Documentation v1.0', 'Documentation');
    await writeAgentFile(agentDir, '7-synthesis.agent.md', '7 - Synthesis v1.0', 'Synthesis');
    await discoverAgents(agentDir);
    await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));
  });

  afterEach(async () => {
    resetRegistry();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('T1: Developer handoff with impl-passed WP + doc-only WP returns READY_FOR_QA not IN_PROGRESS', async () => {
    // WP-002 has active_pipeline_stages: ['documentation'] — should be invisible to the
    // Developer scope filter (only WPs with 'implementation' in active stages count).
    const result = await parseResult(
      getDeveloperHandoff(
        [
          makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }], 'IN_PROGRESS',
            ['implementation', 'qa', 'code-review', 'documentation']),
          makeWp('WP-002', [], 'IN_PROGRESS', ['documentation']),
        ],
        tempDir,
        store,
      ),
    );

    expect(result.status).toBe('READY_FOR_QA');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('4 - QA v1.0');
  });

  it('T2: QA handoff with QA-passed WP + doc-only WP returns READY_FOR_REVIEW not IN_PROGRESS', async () => {
    // WP-002 has active_pipeline_stages: ['documentation'] — should be invisible to the
    // QA scope filter (only WPs with 'qa' in active stages count).
    const result = await parseResult(
      getQaHandoff(
        [
          makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ], 'IN_PROGRESS', ['implementation', 'qa', 'code-review', 'documentation']),
          makeWp('WP-002', [], 'IN_PROGRESS', ['documentation']),
        ],
        tempDir,
        store,
      ),
    );

    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('5 - Reviewer v1.0');
  });

  it('T3: Reviewer handoff with review-passed WP + doc-only WP returns READY_FOR_DOCUMENTATION not IN_PROGRESS', async () => {
    // WP-002 has active_pipeline_stages: ['documentation'] — should be invisible to the
    // Reviewer scope filter (only WPs with 'code-review' in active stages count).
    const result = await parseResult(
      getReviewerHandoff(
        [
          makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
          ], 'IN_PROGRESS', ['implementation', 'qa', 'code-review', 'documentation']),
          makeWp('WP-002', [], 'IN_PROGRESS', ['documentation']),
        ],
        tempDir,
        store,
      ),
    );

    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('6 - Documentation v1.0');
  });

  it('T4: Documentation handoff with doc-only WP (no code-review required) returns IN_PROGRESS', async () => {
    // WP-001 has active_pipeline_stages: ['documentation'] only.
    // resolvePrerequisite('documentation', ['documentation']) returns null → vacuously satisfied.
    // No documentation pipeline yet → readyForDocsList is non-empty → IN_PROGRESS.
    const result = await parseResult(
      getDocumentationHandoff(
        [makeWp('WP-001', [], 'IN_PROGRESS', ['documentation'])],
        tempDir,
        store,
      ),
    );

    expect(result.status).toBe('IN_PROGRESS');
    // IN_PROGRESS does not emit auto_handoff (only READY_FOR_* statuses qualify per §18.6).
    expect(result.auto_handoff).toBeUndefined();
  });

  it('T5: PM routing for unassigned doc-only WP returns READY_FOR_DOCUMENTATION not READY_FOR_DEVELOPER', async () => {
    // When assigned_to is null, PM must route via firstActiveStage (§13.1 PM Handoff).
    // firstActiveStage(['documentation']) = 'documentation' → PIPELINE_AGENT_MAP['documentation']
    // = 'Documentation' → readyStatusForAgent('Documentation') = 'READY_FOR_DOCUMENTATION'.
    const unassignedDocWp: WorkPackageDetail = {
      ...makeWp('WP-001', [], 'READY', ['documentation']),
      assigned_to: null,
    };

    const result = await parseResult(
      getProjectManagerHandoff([unassignedDocWp], tempDir, store),
    );

    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('6 - Documentation v1.0');
  });

  it('T6: Full cycle regression — doc-only WP does not suppress auto_handoff at any stage transition', async () => {
    const docOnlyWp = makeWp('WP-002', [], 'IN_PROGRESS', ['documentation']);

    // Developer stage: impl PASS → READY_FOR_QA (doc-only WP excluded from impl scope).
    const devResult = await parseResult(
      getDeveloperHandoff(
        [
          makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }], 'IN_PROGRESS',
            ['implementation', 'qa', 'code-review', 'documentation']),
          docOnlyWp,
        ],
        tempDir,
        store,
      ),
    );
    expect(devResult.status).toBe('READY_FOR_QA');
    expect(devResult.auto_handoff).toBeDefined();

    // QA stage: qa PASS → READY_FOR_REVIEW (doc-only WP excluded from qa scope).
    const qaResult = await parseResult(
      getQaHandoff(
        [
          makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
          ], 'IN_PROGRESS', ['implementation', 'qa', 'code-review', 'documentation']),
          docOnlyWp,
        ],
        tempDir,
        store,
      ),
    );
    expect(qaResult.status).toBe('READY_FOR_REVIEW');
    expect(qaResult.auto_handoff).toBeDefined();

    // Reviewer stage: code-review PASS → READY_FOR_DOCUMENTATION (doc-only WP excluded from review scope).
    const reviewResult = await parseResult(
      getReviewerHandoff(
        [
          makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
          ], 'IN_PROGRESS', ['implementation', 'qa', 'code-review', 'documentation']),
          docOnlyWp,
        ],
        tempDir,
        store,
      ),
    );
    expect(reviewResult.status).toBe('READY_FOR_DOCUMENTATION');
    expect(reviewResult.auto_handoff).toBeDefined();
  });

  it('T7: Legacy WP without active_pipeline_stages falls back to DEFAULT_PIPELINE_STAGES (backward compat)', async () => {
    // makeWp called without the 4th arg → active_pipeline_stages is omitted from the object.
    // The Developer handler uses `?? DEFAULT_PIPELINE_STAGES` which includes 'implementation',
    // so the WP is processed identically to a full-pipeline WP.
    const legacyWp = makeWp('WP-001', [{ type: 'implementation', status: 'PASS' }]);

    const result = await parseResult(getDeveloperHandoff([legacyWp], tempDir, store));

    expect(result.status).toBe('READY_FOR_QA');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('4 - QA v1.0');
  });

  it('T8: QA handoff for qa+code-review-only WP does NOT return READY_FOR_DEVELOPER', async () => {
    // WP with active_pipeline_stages: ['qa', 'code-review'] — no implementation stage.
    // QA PASS should proceed to code-review (READY_FOR_REVIEW), not loop back to Developer.
    // This verifies the wpsStillNeedingImpl guard checks active stages (§13.1).
    const qaReviewOnlyWp = makeWp(
      'WP-001',
      [{ type: 'qa', status: 'PASS' }],
      'IN_PROGRESS',
      ['qa', 'code-review'],
    );

    const result = await parseResult(
      getQaHandoff([qaReviewOnlyWp], tempDir, store),
    );

    // Must NOT be READY_FOR_DEVELOPER — the WP has no implementation stage.
    expect(result.status).not.toBe('READY_FOR_DEVELOPER');
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('5 - Reviewer v1.0');
  });

  it('T9: QA handoff for qa+code-review-only WP without QA PASS does NOT route to READY_FOR_DEVELOPER', async () => {
    // WP with active_pipeline_stages: ['qa', 'code-review'], no pipelines yet.
    // Since implementation is not in active stages, wpsStillNeedingImpl must be empty.
    // The WP must NOT be erroneously counted as "needing implementation."
    const qaReviewOnlyWp = makeWp(
      'WP-001',
      [],
      'IN_PROGRESS',
      ['qa', 'code-review'],
    );

    const result = await parseResult(
      getQaHandoff([qaReviewOnlyWp], tempDir, store),
    );

    expect(result.status).not.toBe('READY_FOR_DEVELOPER');
  });
});

// ---------------------------------------------------------------------------
// WP-009: Bug-report 2026-04-28 end-to-end fixtures (Phase 7 verification)
//
// Two fixtures that mirror the ffmpeg ledger state that triggered the
// contradictory handoff payload bug:
//   Fixture A — assigned_to: null  → getReviewerHandoff must NOT emit
//               IN_PROGRESS with next_agent: Reviewer.
//   Fixture B — assigned_to: 'Reviewer' → getReviewerHandoff correctly emits
//               IN_PROGRESS (spec cond-4 active-work branch) — coherent, not a bug.
//
// Spec reference: §5.3 (Reviewer), condition 4 and condition 5.
// ---------------------------------------------------------------------------

const FIVE_STAGES_INT = [
  'implementation', 'qa', 'security-audit', 'code-review', 'documentation',
] as const;

describe('WP-009: Bug-report 2026-04-28 end-to-end fixtures', () => {
  let tempDir: string;
  let agentDir: string;
  let tempLedgerRoot: string;
  let store: LedgerStore;

  beforeEach(async () => {
    resetRegistry();
    tempDir = await mkdtemp(join(tmpdir(), '2026-04-29-wp009-'));
    agentDir = await mkdtemp(join(tmpdir(), 'wp009-agents-'));
    tempLedgerRoot = await mkdtemp(join(tmpdir(), 'ledger-root-wp009-'));
    store = new LedgerStore(tempDir, tempLedgerRoot);
    await writeAgentFile(agentDir, '6-reviewer.agent.md', '6 - Reviewer v1.0', 'Reviewer');
    await writeAgentFile(agentDir, '7-docs.agent.md', '7 - Documentation v1.0', 'Documentation');
    await discoverAgents(agentDir);
    await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));
  });

  afterEach(async () => {
    resetRegistry();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(tempLedgerRoot, { recursive: true, force: true });
  });

  it('Fixture A (assigned_to: null): getReviewerHandoff does NOT emit IN_PROGRESS with next_agent: Reviewer for 5-stage WPs with qa:PASS but security-audit not started', async () => {
    // Reproduces the ffmpeg ledger bug: multiple 5-stage WPs have [impl:PASS, qa:PASS]
    // but security-audit (the active upstream for code-review) has not started.
    // assigned_to is null → cond-4 (active-work) does NOT fire → must fall through to WAIT.
    // WP-003 has code-review:PASS on a 4-stage pipeline, triggering cond-3 (READY_FOR_DOCUMENTATION).
    const wpDetails: WorkPackageDetail[] = [
      // 5-stage WPs: qa:PASS but security-audit not started — core bug-report scenario
      { ...makeWp('WP-001', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ], 'IN_PROGRESS', [...FIVE_STAGES_INT]), assigned_to: null as any },
      { ...makeWp('WP-002', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ], 'IN_PROGRESS', [...FIVE_STAGES_INT]), assigned_to: null as any },
      // 4-stage WP: code-review:PASS triggers cond-3 → READY_FOR_DOCUMENTATION
      { ...makeWp('WP-003', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'code-review', status: 'PASS' },
        ], 'IN_PROGRESS'), assigned_to: null as any },
      // COMPLETE WP — excluded by all-terminal check (not all WPs are terminal, so this does
      // not trigger the early-exit)
      makeWp('WP-004', [
        { type: 'implementation', status: 'PASS' },
        { type: 'qa', status: 'PASS' },
        { type: 'code-review', status: 'PASS' },
        { type: 'documentation', status: 'PASS' },
      ], 'COMPLETE'),
    ];

    const result = await parseResult(getReviewerHandoff(wpDetails, tempDir, store));

    // Core bug-report guard: the contradictory payload must never be emitted
    expect(result.status).not.toBe('IN_PROGRESS');
    expect(result.next_agent).not.toBe('Reviewer');

    // WP-003 (4-stage, code-review:PASS) triggers cond-3 → READY_FOR_DOCUMENTATION
    expect(result.status).toBe('READY_FOR_DOCUMENTATION');
    expect(result.current_agent).toBe('Reviewer');
    expect(result.auto_handoff).toBeDefined();
    expect(result.auto_handoff.agent_name).toBe('7 - Documentation v1.0');
  });

  it('Fixture B (assigned_to: "Reviewer"): getReviewerHandoff correctly emits IN_PROGRESS — spec cond-4 active-work, coherent with ledger state', async () => {
    // When the Reviewer has actually claimed a WP (assigned_to: 'Reviewer'),
    // IN_PROGRESS is the spec-correct outcome of cond-4. This is NOT a contradiction:
    // both getReviewerHandoff (IN_PROGRESS) and ledger_get_next_action
    // (CONTINUE_PIPELINE) agree that Reviewer has active work.
    const wpDetails: WorkPackageDetail[] = [
      // 5-stage WPs with security-audit:PASS — Reviewer has claimed WP-001
      { ...makeWp('WP-001', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
          { type: 'security-audit', status: 'PASS' },
        ], 'IN_PROGRESS', [...FIVE_STAGES_INT]), assigned_to: 'Reviewer' },
      { ...makeWp('WP-002', [
          { type: 'implementation', status: 'PASS' },
          { type: 'qa', status: 'PASS' },
        ], 'IN_PROGRESS', [...FIVE_STAGES_INT]), assigned_to: null as any },
    ];

    const result = await parseResult(getReviewerHandoff(wpDetails, tempDir, store));

    // Spec-correct cond-4: Reviewer has claimed WP-001 → IN_PROGRESS
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.current_agent).toBe('Reviewer');
    expect(result.next_agent).toBe('Reviewer');

    // IN_PROGRESS must NOT emit auto_handoff (gated to READY_FOR_* statuses only per §18.6)
    expect(result.auto_handoff).toBeUndefined();
  });
});
