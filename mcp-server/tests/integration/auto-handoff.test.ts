import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as _internal from '../../src/tools/workflow.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';
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
  MAX_HANDOFF_DEPTH,
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
): WorkPackageDetail {
  return {
    work_package_id: id,
    work_package_file: `work/${id}.md`,
    status: 'IN_PROGRESS',
    assigned_to: 'Developer Agent',
    dependencies: [],
    acceptance_criteria: [],
    revision: 1,
    pipelines: pipelines.map((p) => ({
      type: p.type,
      status: p.status as any,
      summary: [],
    })),
  };
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
        getProjectManagerHandoff([makeWp('WP-001')], tempDir, store),
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
          ])],
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
      await parseResult(getProjectManagerHandoff([makeWp('WP-001')], tempDir, store));
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
      await parseResult(
        getDocumentationHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
            { type: 'documentation', status: 'PASS' },
          ])],
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

    it('auto_handoff_depth is reset to 0 after Synthesis emits COMPLETE', async () => {
      await parseResult(
        buildHandoffResponse('Synthesis', 'COMPLETE', 'Synthesis complete.', undefined, tempDir, store),
      );

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(0);
    });

    it('depth reset happens even when starting from a non-zero depth', async () => {
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 8 }));

      await parseResult(
        buildHandoffResponse('Synthesis', 'COMPLETE', 'Done.', undefined, tempDir, store),
      );

      const root = await store.readRootIndex();
      expect(root.auto_handoff_depth).toBe(0);
    });
  });

  // ── 3. Depth limit enforcement ─────────────────────────────────────────────

  describe('Depth limit enforcement', () => {
    beforeEach(async () => {
      await writeAgentFile(agentDir, '4-qa.agent.md', '4 - QA v1.0', 'QA');
      await discoverAgents(agentDir);
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: MAX_HANDOFF_DEPTH }));
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
      expect(root.auto_handoff_depth).toBe(MAX_HANDOFF_DEPTH);
    });

    it('depth boundary: auto_handoff present at MAX-1, absent at MAX', async () => {
      await writeAgentFile(agentDir, '5-reviewer.agent.md', '5 - Reviewer v1.0', 'Reviewer');
      await discoverAgents(agentDir);

      // At MAX-1 → eligible; depth increments to MAX
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: MAX_HANDOFF_DEPTH - 1 }));
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
        getProjectManagerHandoff([makeWp('WP-001')], tempDir, store),
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
      const result = await parseResult(
        getDocumentationHandoff(
          [makeWp('WP-001', [
            { type: 'implementation', status: 'PASS' },
            { type: 'qa', status: 'PASS' },
            { type: 'code-review', status: 'PASS' },
            { type: 'documentation', status: 'PASS' },
          ])],
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
