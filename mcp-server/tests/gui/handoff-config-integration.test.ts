/**
 * Integration test: runtime config changes affect buildHandoffResponse behavior.
 *
 * Verifies that:
 *   1. `auto_handoff_enabled: false` (written to disk + picked up by the watcher) suppresses
 *      auto_handoff without restarting the MCP server.
 *   2. `max_handoff_depth` changes take effect at runtime via the same watcher mechanism.
 *
 * Uses real temp directories, real fs.watch(), and real agent fixture files.
 * No filesystem mocks are used.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  readConfigFromDisk,
  startConfigWatcher,
  stopConfigWatcher,
  __resetForTesting,
} from '../../src/gui/config.js';
import { buildHandoffResponse } from '../../src/tools/workflow-handoff.js';
import { LedgerStore } from '../../src/storage/ledger-store.js';
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';
import { now } from '../../src/utils/timestamp.js';
import { atomicWriteJson } from '../../src/storage/atomic-writer.js';
import { AGENT_NAMES } from '../../src/utils/constants.js';
import type { RootIndex } from '../../src/schema/root-index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    auto_handoff_depth: 0,
    ...overrides,
  };
}

/** Writes a minimal *.agent.md with YAML frontmatter. */
async function writeAgentFile(
  dir: string,
  filename: string,
  name: string,
  role: string,
): Promise<void> {
  const content = `---\nname: ${name}\nrole: ${role}\n---\n\n# Agent`;
  await writeFile(join(dir, filename), content, 'utf8');
}

/** Parse JSON from a buildHandoffResponse result. */
async function parseHandoff(result: Awaited<ReturnType<typeof buildHandoffResponse>>) {
  return JSON.parse(result.content[0]!.text);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('handoff-config integration: runtime config monitoring', () => {
  let tempDir: string;       // plan path (project identifier)
  let agentDir: string;      // temp directory for agent files
  let ledgerRoot: string;    // temp ledger storage root
  let configPath: string;    // path to gui-config.json
  let store: LedgerStore;

  beforeEach(async () => {
    resetRegistry();
    __resetForTesting(); // reset config cache + stop any lingering watcher

    // The plan-folder basename must start with a date pattern (YYYY-MM-DD-) so that
    // validatePlanPath accepts it in the complete workflow path if exercised.
    tempDir = await mkdtemp(join(tmpdir(), '2026-02-22-handoff-config-int-'));
    agentDir = await mkdtemp(join(tmpdir(), 'handoff-config-agents-'));
    ledgerRoot = await mkdtemp(join(tmpdir(), 'handoff-config-ledger-'));
    configPath = join(ledgerRoot, 'gui-config.json');

    store = new LedgerStore(tempDir, ledgerRoot);

    // Register agents so isRegistryLoaded() == true and getAgentHandle() works
    await writeAgentFile(agentDir, '3-dev.agent.md', '3 - Developer v3', 'Developer');
    await writeAgentFile(agentDir, '4-qa.agent.md',  '4 - QA v1',        'QA');
    await discoverAgents(agentDir);

    // Seed root index with depth 0
    await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));

    // Initialize config with defaults (auto_handoff_enabled: true)
    await readConfigFromDisk(configPath);
    startConfigWatcher(configPath);
  });

  afterEach(async () => {
    stopConfigWatcher();
    resetRegistry();
    __resetForTesting();
    await rm(tempDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(ledgerRoot, { recursive: true, force: true });
  });

  // ─── auto_handoff_enabled toggle ─────────────────────────────────────────

  describe('auto_handoff_enabled toggle', () => {
    it('auto_handoff is present in response when auto_handoff_enabled is true (default)', async () => {
      const response = await buildHandoffResponse(
        'Developer',
        'READY_FOR_QA',
        'Implementation complete.',
        undefined,
        tempDir,
        store,
      );
      const payload = await parseHandoff(response);

      expect(payload.status).toBe('READY_FOR_QA');
      expect(payload.auto_handoff).toBeDefined();
      expect(payload.auto_handoff.agent_name).toContain('QA');
      expect(payload.auto_handoff.cc_agent_name).toBe(AGENT_NAMES['QA'].claude_code.agent_name);
      expect(payload.auto_handoff.vs_agent_name).toBe(AGENT_NAMES['QA'].vscode.agent_name);
      expect(payload.auto_handoff.da_agent_name).toBe(AGENT_NAMES['QA'].deep_agents.agent_name);
    });

    it('auto_handoff is absent after writing auto_handoff_enabled: false to config', async () => {
      // Reset depth so future calls start fresh
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));

      // Write disabled config to disk — watcher will pick it up
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: false,
        max_handoff_depth: 10,
        ledger_root: '',
      });

      await wait(400); // debounce + I/O buffer

      const response = await buildHandoffResponse(
        'Developer',
        'READY_FOR_QA',
        'Implementation complete.',
        undefined,
        tempDir,
        store,
      );
      const payload = await parseHandoff(response);

      expect(payload.status).toBe('READY_FOR_QA');
      expect(payload.auto_handoff).toBeUndefined();
    });

    it('auto_handoff reappears after re-enabling auto_handoff_enabled', async () => {
      // 1. Disable
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: false,
        max_handoff_depth: 10,
        ledger_root: '',
      });
      await wait(400);

      // 2. Re-enable
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: true,
        max_handoff_depth: 10,
        ledger_root: '',
      });
      await wait(400);

      // Reset depth counter so we don't hit the depth cap
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 0 }));

      const response = await buildHandoffResponse(
        'Developer',
        'READY_FOR_QA',
        'Implementation complete.',
        undefined,
        tempDir,
        store,
      );
      const payload = await parseHandoff(response);

      expect(payload.auto_handoff).toBeDefined();
    });
  });

  // ─── max_handoff_depth toggle ────────────────────────────────────────────

  describe('max_handoff_depth runtime change', () => {
    it('suppresses auto_handoff when current depth equals max_handoff_depth', async () => {
      // Set config max to 2, and set the stored depth to 2 (at the limit)
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: true,
        max_handoff_depth: 2,
        ledger_root: '',
      });
      await wait(400);

      // depth: 2, max: 2 → effectiveMaxDepth(0) = max(2,0) = 2 → 2 < 2 is false → no handoff
      // Uses total_work_packages:0 so the config value is the sole ceiling (no WP-scaling).
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 2, total_work_packages: 0 }));

      const response = await buildHandoffResponse(
        'Developer',
        'READY_FOR_QA',
        'Implementation complete.',
        undefined,
        tempDir,
        store,
      );
      const payload = await parseHandoff(response);

      expect(payload.auto_handoff).toBeUndefined();
    });

    it('auto_handoff reappears after increasing max_handoff_depth beyond current depth', async () => {
      // Start with max=2, depth=2 (at cap — no handoff)
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: true,
        max_handoff_depth: 2,
        ledger_root: '',
      });
      await wait(400);
      // Uses total_work_packages:0 so effectiveMaxDepth == configMax (no WP-scaling)
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 2, total_work_packages: 0 }));

      // Verify no handoff at cap
      const before = await buildHandoffResponse(
        'Developer', 'READY_FOR_QA', 'Test.', undefined, tempDir, store,
      );
      const beforePayload = await parseHandoff(before);
      expect(beforePayload.auto_handoff).toBeUndefined();

      // Raise max to 5 — now depth:2 < max:5 → handoff should trigger
      await atomicWriteJson(configPath, {
        auto_handoff_enabled: true,
        max_handoff_depth: 5,
        ledger_root: '',
      });
      await wait(400);

      // Reset depth to 2 (the write above didn't change depth); keep total_work_packages:0
      await store.writeRootIndex(makeRoot({ auto_handoff_depth: 2, total_work_packages: 0 }));

      const after = await buildHandoffResponse(
        'Developer', 'READY_FOR_QA', 'Test.', undefined, tempDir, store,
      );
      const afterPayload = await parseHandoff(after);

      expect(afterPayload.auto_handoff).toBeDefined();
    });
  });
});
